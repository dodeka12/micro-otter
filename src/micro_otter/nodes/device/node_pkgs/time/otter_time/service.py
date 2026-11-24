# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""One collection-wide NTP clock with a derived epoch.

The module is used as a singleton (``import otter_time.service as _time_srv``), so
all state lives in module globals and every function is idempotent:

* ``start()`` (called once from the generated init block) launches one background
  ``uasyncio`` task that fetches SNTP time, keeps the epoch as
  ``fetched_epoch + monotonic delta`` and sets the device clock to local time;
* ``configure(...)`` (called from the generated loop) only stores the configured
  values, so the loop body never fetches and never blocks;
* the conversion helpers ``epoch_or_now(...)`` and ``timezone_from_argument(...)``
  implement the two input sentinels of the node package in exactly one place.

The SNTP query is hand-written instead of using ``ntptime``: ``ntptime`` ignores
the configured server on several ports and does not return the fetched value, so
the epoch could not be derived from it.
"""

import otter_time.parts as _parts

try:
    import socket as _socket
except ImportError:  # pragma: no cover - fallback for host ports without sockets
    _socket = None

try:
    import utime as _time
except ImportError:  # pragma: no cover - fallback for host tooling
    try:
        import time as _time
    except ImportError:
        _time = None

try:
    import uasyncio as _asyncio
except ImportError:  # pragma: no cover - fallback for host tooling
    try:
        import asyncio as _asyncio
    except ImportError:
        _asyncio = None

try:
    from tools.runtime_log import log_plain as _log_plain
except ImportError:  # pragma: no cover - host/dev runs without the device tools
    _log_plain = None

DEFAULT_SERVER = 'pool.ntp.org'
DEFAULT_INTERVAL_MINUTES = 60
MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 1440
DEFAULT_TIMEZONE_HOURS = 0
#: A timezone argument at or below this value means "inherit the service offset".
TIMEZONE_INHERIT = -100
MIN_TIMEZONE_HOURS = -12
MAX_TIMEZONE_HOURS = 14

#: Seconds between the NTP era (1900-01-01) and the Unix epoch (1970-01-01).
NTP_EPOCH_DELTA = 2208988800
NTP_PORT = 123
NTP_PACKET_SIZE = 48
#: LI 0, VN 3, mode 3 (client) plus 47 zero bytes of padding.
NTP_REQUEST = b'\x1b' + b'\x00' * (NTP_PACKET_SIZE - 1)
DEFAULT_TIMEOUT_MS = 1500

#: Retry schedule before the first successful sync.
MIN_BACKOFF_SECONDS = 2
MAX_BACKOFF_SECONDS = 60
#: Long sleeps are chunked so a configuration change applies within a second.
SLEEP_CHUNK_SECONDS = 1
DISABLED_SLEEP_SECONDS = 1

#: Source named in every plain device log line of this module.
LOG_SOURCE = 'time'

_enabled = True
_server = DEFAULT_SERVER
_interval_minutes = DEFAULT_INTERVAL_MINUTES
_timezone_hours = DEFAULT_TIMEZONE_HOURS

_synced = False
_synced_at = 0
_epoch_base = 0
_epoch_mark = 0

_task = None
_config_dirty = False


def _log(level, message):
    """Emit one plain device log line with the ``time`` source."""
    if _log_plain is not None:
        _log_plain(level, LOG_SOURCE, message)
        return
    print(LOG_SOURCE + ': ' + message)


def _info(message):
    """Report normal progress of the clock service."""
    _log('info', message)


def _warn(message):
    """Report a failed attempt that will be retried."""
    _log('warning', message)


def _describe_exception(exc):
    """Fold an exception into one physical line (log lines must not wrap)."""
    try:
        text = type(exc).__name__ + ': ' + str(exc)
    except Exception:
        text = 'unprintable exception'
    text = text.replace('\r', ' ').replace('\n', ' ').strip()
    return text or 'no details'


def query_ntp(host, timeout_ms=DEFAULT_TIMEOUT_MS):
    """Return the current UTC epoch from the SNTP server *host*.

    ``host`` may be blank, in which case :data:`DEFAULT_SERVER` is used so a
    mistyped server does not stop every sync cycle. Raises ``OSError`` on short
    or malformed responses; the socket is always closed.
    """
    if _socket is None:
        raise OSError('socket module unavailable')
    target = '' if host is None else str(host).strip()
    if not target:
        target = DEFAULT_SERVER
    addresses = _socket.getaddrinfo(target, NTP_PORT)
    if not addresses:
        raise OSError('no address for ' + target)
    family, socktype, _proto, _canonname, sockaddr = addresses[0]
    sock = _socket.socket(family, socktype)
    try:
        try:
            sock.settimeout(timeout_ms / 1000)
        except (AttributeError, OSError):
            pass
        sock.sendto(NTP_REQUEST, sockaddr)
        data = sock.recv(NTP_PACKET_SIZE)
        if data is None or len(data) < NTP_PACKET_SIZE:
            raise OSError('short NTP response')
        seconds = (data[40] << 24) | (data[41] << 16) | (data[42] << 8) | data[43]
        if seconds == 0:
            raise OSError('empty NTP timestamp')
        return seconds - NTP_EPOCH_DELTA
    finally:
        try:
            sock.close()
        except Exception:
            pass


def _clamp_interval(value):
    """Clamp an interval in minutes into :data:`MIN_INTERVAL_MINUTES` … 1440."""
    try:
        minutes = int(round(float(value)))
    except (TypeError, ValueError):
        return DEFAULT_INTERVAL_MINUTES
    if minutes < MIN_INTERVAL_MINUTES:
        return MIN_INTERVAL_MINUTES
    if minutes > MAX_INTERVAL_MINUTES:
        return MAX_INTERVAL_MINUTES
    return minutes


def _normalize_timezone(value):
    """Resolve a raw timezone argument into a UTC offset in hours.

    Below :data:`MIN_TIMEZONE_HOURS` the argument means "inherit the service
    offset" (that is how the ``-100`` sentinel and any mistyped negative value
    behave); above :data:`MAX_TIMEZONE_HOURS` it is clamped so the arithmetic
    stays inside real-world offsets.
    """
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return _timezone_hours
    if numeric <= TIMEZONE_INHERIT or numeric < MIN_TIMEZONE_HOURS:
        return _timezone_hours
    if numeric > MAX_TIMEZONE_HOURS:
        return float(MAX_TIMEZONE_HOURS)
    return numeric


def configure(server=None, interval_minutes=None, timezone_hours=None, enabled=None):
    """Store the configuration; never fetch and never block.

    The generated loop calls this once per pass, so it must stay a cheap state
    update. ``None`` leaves a value untouched, which is what the generator emits
    for an input it could not resolve.
    """
    global _server, _interval_minutes, _timezone_hours, _enabled, _config_dirty

    if server is not None:
        text = str(server).strip()
        if text != _server:
            _server = text
            _config_dirty = True
    if interval_minutes is not None:
        minutes = _clamp_interval(interval_minutes)
        if minutes != _interval_minutes:
            _interval_minutes = minutes
            _config_dirty = True
    if timezone_hours is not None:
        offset = _normalize_timezone(timezone_hours)
        if offset != _timezone_hours:
            _timezone_hours = offset
            _config_dirty = True
    if enabled is not None:
        _enabled = bool(enabled)
    if _enabled:
        start()


def enabled():
    """Return whether the background task should fetch time."""
    return _enabled


def server():
    """Return the configured SNTP server (always non-empty)."""
    return _server


def interval_minutes():
    """Return the configured sync interval in minutes (1 … 1440)."""
    return _interval_minutes


def interval_seconds():
    """Return the configured sync interval in seconds."""
    return _interval_minutes * 60


def timezone():
    """Return the configured collection timezone as a UTC offset in hours."""
    return _timezone_hours


def timezone_from_argument(value):
    """Resolve a node's ``timezone`` input into a UTC offset in hours.

    ``-100`` (and anything below the valid range) means "inherit the timezone of
    the ``time-service`` node"; a value in −12 … +14 is a literal offset. The
    comparison is numeric, so the float literal the transpiler emits for a
    ``-100`` control (``-100.0``) behaves exactly like the integer.
    """
    if value is None:
        return _timezone_hours
    return _normalize_timezone(value)


def epoch_or_now(value):
    """Resolve a node's ``epoch`` input into a UTC epoch in seconds.

    ``-1`` (and any other negative value) means "use the device clock", i.e. the
    epoch the service derives from its last sync. The comparison is numeric so
    the float literal ``-1.0`` behaves exactly like the integer.
    """
    if value is None:
        return now()
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return now()
    if numeric < 0:
        return now()
    return numeric


def synced():
    """Return whether the service has synchronised at least once."""
    return _synced


def age():
    """Return the seconds since the last successful sync, or ``-1`` before it."""
    if not _synced:
        return -1
    return now() - _synced_at


def epoch():
    """Return the current UTC epoch in seconds."""
    return now()


def _monotonic_ms():
    """Return a monotonic millisecond counter (MicroPython ticks first)."""
    if _time is None:
        return 0
    if hasattr(_time, 'ticks_ms'):
        return _time.ticks_ms()
    try:
        return int(_time.monotonic() * 1000)
    except (AttributeError, OSError):
        return 0


def _ticks_delta_ms(newer, older):
    """Return ``newer - older`` in milliseconds, wrap-safe on MicroPython."""
    if _time is not None and hasattr(_time, 'ticks_diff'):
        return _time.ticks_diff(newer, older)
    return newer - older


def _port_clock():
    """Return the port's own wall clock in seconds (``0`` when unavailable)."""
    if _time is None:
        return 0
    try:
        return int(_time.time())
    except (AttributeError, OSError, OverflowError):
        return 0


def apply_epoch(value):
    """Adopt *value* as the epoch base and mark the service as synchronised."""
    global _epoch_base, _epoch_mark, _synced, _synced_at
    _epoch_base = int(value)
    _epoch_mark = _monotonic_ms()
    _synced = True
    _synced_at = _epoch_base


def now():
    """Return the current UTC epoch in seconds.

    Always derived (``fetched_epoch + ticks_diff``) instead of read back from
    ``time.time()``, so the package is independent of the port's epoch base.
    Before the first sync the port's own clock is used as a fallback.
    """
    if not _synced:
        return _port_clock()
    elapsed_ms = _ticks_delta_ms(_monotonic_ms(), _epoch_mark)
    return _epoch_base + elapsed_ms // 1000


def _next_backoff(value):
    """Return the doubled retry delay, capped at :data:`MAX_BACKOFF_SECONDS`."""
    doubled = value * 2
    if doubled > MAX_BACKOFF_SECONDS:
        return MAX_BACKOFF_SECONDS
    return doubled


def _network_ready():
    """Return whether a network interface looks connected (``True`` if unknown).

    Ports without a ``network`` module (unix, host tooling) report ready so the
    fetch is attempted and the failure is visible in the log instead of the
    service silently idling forever.
    """
    try:
        import network
    except ImportError:
        return True
    try:
        station = network.WLAN(network.STA_IF)
        if station is not None and station.isconnected():
            return True
    except Exception:
        pass
    try:
        lan = network.LAN()
        if lan is not None:
            address = lan.ifconfig()[0]
            if address and address != '0.0.0.0':
                return True
    except Exception:
        pass
    return False


def _set_device_clock(value):
    """Set the device clock to the local time of *value*, best effort.

    Local time (UTC + the collection timezone) is what a wall clock on the device
    should show, while the internal epoch stays UTC-derived. MicroPython's RTC
    uses ``1``–``7`` for Monday–Sunday, so the ISO weekday index is shifted by
    one. Ports without a settable RTC (the unix port, for example) keep running
    on the derived epoch, so every failure is swallowed.
    """
    try:
        import machine
    except ImportError:
        return False
    try:
        year_value, month_value, day_value, weekday_value = _parts.date_parts(
            value, _timezone_hours
        )
        hour_value, minute_value, second_value = _parts.clock_parts(value, _timezone_hours)
        machine.RTC().datetime(
            (
                year_value,
                month_value,
                day_value,
                weekday_value + 1,
                hour_value,
                minute_value,
                second_value,
                0,
            )
        )
        return True
    except (AttributeError, OSError, ValueError):
        return False


def _sync_once():
    """Fetch the time once and apply it; returns ``True`` on success."""
    try:
        fetched = query_ntp(server())
    except Exception as exc:
        _warn('sync failed, will retry: ' + _describe_exception(exc))
        return False
    apply_epoch(fetched)
    _set_device_clock(now())
    _info('clock synchronised')
    return True


async def _sleep_interval():
    """Sleep one sync interval in chunks, breaking out early on a config change."""
    global _config_dirty
    _config_dirty = False
    remaining = interval_seconds()
    while remaining > 0:
        if remaining > SLEEP_CHUNK_SECONDS:
            chunk = SLEEP_CHUNK_SECONDS
        else:
            chunk = remaining
        await _asyncio.sleep(chunk)
        remaining -= chunk
        if _config_dirty:
            _config_dirty = False
            break


async def _run():
    """Fetch time in the background until the task is cancelled.

    The first success is retried on the short backoff schedule (2, 4, 8 … 60 s);
    after that every fetch waits the configured interval. Nothing in the graph's
    loop body waits for this task.
    """
    backoff = MIN_BACKOFF_SECONDS
    while True:
        if not _enabled:
            await _asyncio.sleep(DISABLED_SLEEP_SECONDS)
            continue
        if not _network_ready():
            await _asyncio.sleep(backoff)
            backoff = _next_backoff(backoff)
            continue
        if _sync_once():
            backoff = MIN_BACKOFF_SECONDS
            await _sleep_interval()
        else:
            await _asyncio.sleep(backoff)
            backoff = _next_backoff(backoff)


def start():
    """Start the background sync task if it is not running yet.

    Idempotent, so the generated init block may call it once per ``time-service``
    node. Without a running event loop (host tooling, unit tests) no task is
    created; the next :func:`configure` call from inside the graph loop retries,
    which keeps this function free of any blocking fetch.
    """
    global _task
    if _task is not None:
        return _task
    if _asyncio is None:
        return None
    coroutine = _run()
    try:
        _task = _asyncio.create_task(coroutine)
    except Exception:
        _task = None
        try:
            coroutine.close()
        except (AttributeError, RuntimeError):
            pass
    return _task


def stop():
    """Cancel the background sync task (tests and keyed teardown)."""
    global _task
    task = _task
    _task = None
    if task is None:
        return
    try:
        task.cancel()
    except Exception:
        pass
