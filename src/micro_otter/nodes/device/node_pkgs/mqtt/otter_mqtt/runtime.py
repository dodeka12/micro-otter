# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

try:
    import ujson as json
except ImportError:  # pragma: no cover - host fallback
    import json

try:
    import os
except ImportError:  # pragma: no cover
    os = None

try:
    import utime as _time
except ImportError:  # pragma: no cover - host fallback
    try:
        import time as _time
    except ImportError:
        _time = None

try:
    import uasyncio as asyncio
except ImportError:  # pragma: no cover - host fallback
    try:
        import asyncio
    except ImportError:
        asyncio = None

try:
    import machine as _machine
except ImportError:  # pragma: no cover
    _machine = None

try:
    from otter_mqtt.umqtt.simple import MQTTClient
except ImportError:  # pragma: no cover - host/dev fallback
    MQTTClient = None

MQTT_SETTINGS_FILE = '/mqtt_settings.json'

_LOG_SOURCE = 'mqtt'


def _log(level, message):
    """Emit one ``[level] mqtt: message`` line the web console can filter.

    ``level`` must be a canonical device log prefix (see
    docs/dev/device-communication/log-prefix-conventions.md); anything else would
    be shown under ``raw``.
    """
    print('[{}] {}: {}'.format(level, _LOG_SOURCE, message))


def _info(message):
    """Normal progress of the mqtt runtime."""
    _log('info', message)


def _success(message):
    """An mqtt operation completed (connected, subscribed, published)."""
    _log('success', message)


def _warning(message):
    """Degraded, but the runtime keeps working (defaults, retries, fallbacks)."""
    _log('warning', message)


def _error(message):
    """An mqtt operation failed."""
    _log('error', message)


def _data(message):
    """Payload and value dumps: high volume, filtered out by default."""
    _log('data', message)

# CONNACK return codes as reported by umqtt.simple.MQTTException.
_CONNACK_ERRORS = {
    1: 'unacceptable-protocol',
    2: 'identifier-rejected',
    3: 'server-unavailable',
    4: 'bad-username-or-password',
    5: 'not-authorized',
}

_DEFAULT_SETTINGS = {
    'enabled': False,
    'host': '',
    'port': 1883,
    'client_id': '',
    'user': '',
    'password': '',
    'keepalive': 60,
    'pump_delay_ms': 50,
    'resync_interval_s': 30,
}


def _ticks_ms():
    """Millisecond clock: MicroPython ticks, host wall clock, or 0 when absent."""
    if _time is None:
        return 0
    ticks_ms = getattr(_time, 'ticks_ms', None)
    if ticks_ms is not None:
        return ticks_ms()
    try:
        return int(_time.time() * 1000)
    except Exception:
        return 0


def _ticks_diff(new, old):
    """Wraparound-safe tick difference (MicroPython) or plain subtraction."""
    if _time is not None:
        ticks_diff = getattr(_time, 'ticks_diff', None)
        if ticks_diff is not None:
            return ticks_diff(new, old)
    return new - old


def _elapsed_ms(start):
    """Milliseconds since `start`, or 0 when no start tick was recorded."""
    if not start:
        return 0
    return _ticks_diff(_ticks_ms(), start)


def _describe_error(exc):
    """Render an exception as `<Type>: <message>` plus a CONNACK reason if known."""
    message = '{}: {}'.format(type(exc).__name__, exc)
    reason = None
    if type(exc).__name__ == 'MQTTException':
        args = getattr(exc, 'args', ())
        if args:
            try:
                reason = _CONNACK_ERRORS.get(int(args[0]))
            except (TypeError, ValueError):
                reason = None
    if reason is None:
        return message
    return '{} ({})'.format(message, reason)


def _target(settings):
    """Render the broker endpoint being used, never the credentials."""
    try:
        port = int(settings.get('port') or 1883)
    except (TypeError, ValueError):
        port = 1883
    return 'mqtt://{}:{}'.format(settings.get('host') or '<empty>', port)


def _describe_settings(path, settings):
    """One-line summary of the settings source. Never prints the password."""
    return (
        "settings: file={} loaded enabled={} host='{}' port={} client_id={} "
        'user={} password={} keepalive={} pump_delay_ms={} resync_interval_s={}'
    ).format(
        path,
        bool(settings.get('enabled', False)),
        settings.get('host') or '',
        settings.get('port') or 1883,
        settings.get('client_id') or 'auto',
        settings.get('user') or 'none',
        'set' if settings.get('password') else 'unset',
        settings.get('keepalive') or 60,
        settings.get('pump_delay_ms') or 50,
        settings.get('resync_interval_s') or 30,
    )


def _truncate(text, limit=32):
    """Shorten a payload for a log line so a large payload cannot flood the console."""
    text = str(text)
    if len(text) <= limit:
        return text
    return text[:limit] + '...'


def _drop_socket(client):
    """Best-effort close of a half-open client socket; never raises."""
    sock = getattr(client, 'sock', None)
    if sock is None:
        return
    try:
        sock.close()
    except Exception:
        pass


def _station_link_up():
    """Whether the WiFi station link is up, or None when the platform cannot tell.

    ``init_mqtt()`` runs about two seconds after boot - before a station that was
    configured by a hard reset has finished associating - and ``MQTTClient.connect()``
    blocks in ``getaddrinfo``/``connect``/``read`` until the network gives up. An early
    attempt therefore either fails or stalls startup, and nothing is published or
    registered until the service controller retries. Gating ``start()`` on the station
    link keeps the first attempt on a usable network.

    ``None`` means "unknown" (host tests, or a board without a ``WLAN`` interface) and
    keeps the unconditional path, so the gate can never block a working setup.
    """
    if _machine is None:
        return None
    wlan = getattr(_machine, 'WLAN', None)
    if wlan is None:
        return None
    try:
        station = wlan(getattr(wlan, 'STA_IF', 0))
        isconnected = getattr(station, 'isconnected', None)
        if isconnected is None:
            return None
        return bool(isconnected())
    except Exception:
        return None


def _describe_link(link):
    """Render `_station_link_up()` for a log line."""
    if link is None:
        return 'unknown'
    return 'up' if link else 'down'


def _load_settings(path=None):
    settings = dict(_DEFAULT_SETTINGS)
    settings_path = path or MQTT_SETTINGS_FILE
    try:
        if os is not None:
            try:
                os.stat(settings_path)
            except OSError:
                _info('settings: file={} not found, using defaults'.format(settings_path))
                return settings
        with open(settings_path, 'r') as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            for key in _DEFAULT_SETTINGS:
                if key in data:
                    settings[key] = data[key]
    except Exception as exc:
        _warning('settings: load failed ({}), using defaults'.format(_describe_error(exc)))
        return settings
    _info(_describe_settings(settings_path, settings))
    return settings


def _decode_bytes(value):
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode('utf-8')
        except Exception:
            return str(value)
    return str(value)


def _generate_client_id():
    if _machine is not None and hasattr(_machine, 'unique_id'):
        try:
            return 'otter-' + _machine.unique_id().hex()
        except Exception:
            pass
    return 'otter-mqtt'


class MqttRuntime:
    def __init__(self, settings=None, client_factory=None):
        self._settings = settings if settings is not None else _load_settings()
        self._client_factory = client_factory
        self._client = None
        self._connected = False
        self._subscriptions = []
        self._publish_topics = []
        self._messages = {}
        self._consumed = {}
        self._coerced = {}
        self._last_publish = {}
        self._seq = 0
        self._connect_epoch = 0
        self._pump_task = None
        self._last_tx_ms = 0
        self._will = None  # (topic, payload_bytes, retain, qos)
        self._deferred = {}  # key -> (topic, payload_bytes, retain, qos, if_changed)
        self._connect_hooks = []
        self._message_hooks = []
        # Diagnostics de-dupe sets: one line per topic, never per message.
        self._log_topics = set()
        self._log_publish_skips = set()
        self._log_publish_failures = set()
        self._log_publish_ok = set()
        self._log_deferred_failures = set()
        self._log_deferred_queued = set()

    @property
    def enabled(self):
        return bool(self._settings.get('enabled', False))

    @property
    def connected(self):
        return self._connected

    @property
    def resync_interval_s(self):
        try:
            return max(1, int(self._settings.get('resync_interval_s', 30)))
        except (TypeError, ValueError):
            return 30

    def register_subscription(self, topic, qos=0):
        key = (topic, int(qos))
        qos = int(qos)
        if key in self._subscriptions:
            _info("register: subscription topic='{}' qos={} (duplicate ignored)".format(topic, qos))
            return
        self._subscriptions.append(key)
        if self._connected and self._client is not None:
            _info("register: subscription topic='{}' qos={} (immediate)".format(topic, qos))
            try:
                self._client.subscribe(topic, qos)
            except Exception as exc:
                _error(
                    "subscribe failed '{}' qos={} ({})".format(topic, qos, _describe_error(exc))
                )
            else:
                _success("subscribe: '{}' qos={} ok".format(topic, qos))
        else:
            _info("register: subscription topic='{}' qos={} (deferred)".format(topic, qos))

    def register_publish(self, topic, qos=0):
        key = (topic, int(qos))
        if key not in self._publish_topics:
            self._publish_topics.append(key)
            _info("register: publish topic='{}' qos={}".format(topic, int(qos)))

    def configure_will(self, topic, payload, retain=True, qos=0):
        """Let the broker publish payload on topic when this link dies."""
        self._will = (str(topic), self._encode_payload(payload), bool(retain), int(qos))
        _info(
            "will: configured topic='{}' retain={} qos={}".format(topic, bool(retain), int(qos))
        )

    def clear_will(self):
        """Forget a configured will; the next connection carries none."""
        if self._will is not None:
            _info('will: cleared')
        self._will = None

    def _apply_will(self, client):
        """Attach the configured will to a fresh client before it connects.

        ``umqtt.simple`` only records the will into the CONNECT packet, so it has to
        happen before ``connect()`` and on every new client object.
        """
        if self._will is None:
            return False
        topic, payload, retain, qos = self._will
        setter = getattr(client, 'set_last_will', None)
        if setter is None:
            _warning('will: client does not support set_last_will, ignored')
            return False
        setter(topic, payload, retain=retain, qos=qos)
        return True

    def publish_deferred(self, topic, payload, qos=0, retain=True, key=None, if_changed=None):
        """Publish now when connected and again after every successful connect.

        ``if_changed`` only suppresses the *immediate* publish; a connect replay always
        publishes, because the broker may have lost the retained value meanwhile.
        """
        entry = (str(topic), self._encode_payload(payload), bool(retain), int(qos), if_changed)
        memo_key = key or topic
        self._deferred[memo_key] = entry
        if self._connected and self._client is not None:
            self._publish_deferred_entry(entry, allow_if_changed=True)
            return
        # One line per key: a disconnected graph would otherwise repeat this on every
        # loop iteration. Seeing the queue grow while offline is what proves the app
        # reached its announce path before the broker was reachable.
        if memo_key not in self._log_deferred_queued:
            self._log_deferred_queued.add(memo_key)
            _info(
                "publish: queued (not connected) topic='{}' queued={}".format(
                    topic, len(self._deferred)
                )
            )

    def clear_deferred(self, key=None):
        """Drop one deferred entry, or every entry when key is None."""
        if key is None:
            self._deferred.clear()
        else:
            self._deferred.pop(key, None)

    def _publish_deferred_entry(self, entry, allow_if_changed=False):
        topic, payload, retain, qos, memo_key = entry
        if not self.enabled or not self._connected or self._client is None:
            return
        if allow_if_changed and memo_key is not None:
            if self._last_publish.get(memo_key) == payload:
                return
        try:
            self._client.publish(topic, payload, retain=bool(retain), qos=int(qos))
        except Exception as exc:
            if topic not in self._log_deferred_failures:
                self._log_deferred_failures.add(topic)
                _error(
                    "publish failed (deferred) topic='{}' ({})".format(
                        topic, _describe_error(exc)
                    )
                )
        else:
            # Replays never consult the memo, but they do record it: an immediate
            # publish right after a reconnect must not repeat the replayed payload.
            if memo_key is not None:
                self._last_publish[memo_key] = payload
            self._last_tx_ms = _ticks_ms()
            if topic not in self._log_publish_ok:
                self._log_publish_ok.add(topic)
                _success(
                    "publish: first ok topic='{}' qos={} retain={} payload='{}'".format(
                        topic, int(qos), bool(retain), _truncate(_decode_bytes(payload))
                    )
                )

    def on_connect(self, callback):
        """Run callback after every successful connect (subscribe + replay done)."""
        if callback not in self._connect_hooks:
            self._connect_hooks.append(callback)

    def _run_connect_hooks(self):
        """Invoke every connect hook; a failing hook never aborts the connection."""
        for callback in list(self._connect_hooks):
            try:
                callback()
            except Exception as exc:
                _error('connect hook failed ({})'.format(_describe_error(exc)))

    def on_message(self, callback):
        """Run callback(topic, payload) for every message the pump receives.

        Hooks persist across reconnects like the connect hooks, run synchronously
        inside the pump (so a hook must be short and must never call ``check_msg()``),
        and one raising hook only emits an ``[error]`` line — the pump keeps running
        and the message stays readable through the pull API.
        """
        if callback not in self._message_hooks:
            self._message_hooks.append(callback)

    def _run_message_hooks(self, topic, payload):
        """Invoke every message hook; a failing hook never stops the pump."""
        for callback in list(self._message_hooks):
            try:
                callback(topic, payload)
            except Exception as exc:
                _error('message hook failed ({})'.format(_describe_error(exc)))

    def start(self):
        link = _station_link_up()
        _info(
            'start: requested enabled={} connected={} wifi={}'.format(
                self.enabled, self._connected, _describe_link(link)
            )
        )
        if not self.enabled:
            _info('start: skipped, disabled by settings ({})'.format(MQTT_SETTINGS_FILE))
            return
        if self._connected:
            _info('start: skipped, already connected')
            return
        if link is False:
            # The station link is still coming up (a hard reset reassociates after
            # init_mqtt() ran). Keep the runtime untouched: the service controller
            # starts it once the link is up, and every deferred payload is replayed
            # then, so nothing has to be announced twice.
            _info(
                'start: deferred, wifi station link is down'
                ' (the network service controller starts mqtt once it connects)'
            )
            return

        try:
            port = int(self._settings.get('port') or 1883)
        except (TypeError, ValueError):
            port = 1883
        try:
            keepalive = int(self._settings.get('keepalive') or 60)
        except (TypeError, ValueError):
            keepalive = 60

        host = self._settings.get('host') or ''
        user = self._settings.get('user') or None
        password = self._settings.get('password') or None
        if user and password is None:
            # umqtt.simple calls len(password): None would raise TypeError.
            password = ''
            _info('connect: user configured without password, sending empty password')
        elif password is not None and user is None:
            password = None
            _info('connect: password ignored (no username configured)')

        client_id = self._settings.get('client_id') or ''
        client = None
        if self._client_factory is not None:
            client = self._client_factory(self._settings)
        elif MQTTClient is not None:
            if not client_id:
                client_id = _generate_client_id()
            client = MQTTClient(
                client_id,
                host,
                port=port,
                user=user,
                password=password,
                keepalive=keepalive,
            )
        else:
            _warning(
                'start: skipped, umqtt client unavailable'
                ' (otter_mqtt.umqtt.simple not importable)'
            )
            return

        self._client = client
        _info(
            'connect: {} client_id={} keepalive={} user={} password={}'.format(
                _target(self._settings),
                client_id or 'custom',
                keepalive,
                user or 'none',
                'set' if password else 'unset',
            )
        )

        started_ms = _ticks_ms()
        try:
            client.set_callback(self._on_message)
            # The will travels inside CONNECT, so it must be recorded on the fresh
            # client object before connect() runs (again on every reconnect).
            self._apply_will(client)
            client.connect()
            for topic, qos in self._subscriptions:
                client.subscribe(topic, qos)
                _success("subscribe: '{}' qos={} ok".format(topic, qos))
            self._connected = True
        except Exception as exc:
            _error(
                'connect failed {} ({} ms) {}'.format(
                    _target(self._settings), _elapsed_ms(started_ms), _describe_error(exc)
                )
            )
            # Drop the half-open client so a later retry does not leak its socket.
            self._release_client(client)
            self._mark_disconnected()
            return

        _success(
            'connect: ok {} ({} ms)'.format(_target(self._settings), _elapsed_ms(started_ms))
        )
        self._last_tx_ms = _ticks_ms()
        # One "publish: first ok" line per topic per connection proves the link
        # works after every (re)connect without ever logging per value.
        self._log_publish_ok.clear()
        # Re-assert every deferred payload: a broker restart (or a broker without
        # persistence) may have dropped the retained values meanwhile. The count is
        # logged once per connect: it is the quickest way to tell "connected but the
        # app never queued anything" from "announcing what the app queued".
        deferred_entries = self._deferred
        if deferred_entries:
            _info(
                'connect: re-announcing {} deferred topic(s)'
                ' (discovery, state and availability)'.format(len(deferred_entries))
            )
        for entry in deferred_entries.values():
            self._publish_deferred_entry(entry)
        self._connect_epoch += 1
        self._run_connect_hooks()
        self._start_pump()

    def _pump_delay_ms(self):
        try:
            return max(1, int(self._settings.get('pump_delay_ms', 50)))
        except (TypeError, ValueError):
            return 50

    def _keepalive_ms(self):
        try:
            return max(0, int(self._settings.get('keepalive') or 0)) * 1000
        except (TypeError, ValueError):
            return 0

    def _keepalive_tick(self, now=None):
        """Send PINGREQ after half the keepalive window without outbound traffic.

        `umqtt.simple.check_msg()` already consumes the PINGRESP (0xd0) and returns
        None for it, so the vendored client needs no change. Returns False when the
        ping failed and the caller has to tear the link down.
        """
        client = self._client
        keepalive_ms = self._keepalive_ms()
        if client is None or keepalive_ms <= 0 or not hasattr(client, 'ping'):
            return True
        if now is None:
            now = _ticks_ms()
        if not self._last_tx_ms:
            self._last_tx_ms = now
            return True
        if _ticks_diff(now, self._last_tx_ms) < keepalive_ms // 2:
            return True
        try:
            client.ping()
        except Exception as exc:
            _error('keepalive ping failed ({})'.format(_describe_error(exc)))
            return False
        self._last_tx_ms = now
        return True

    def _release_client(self, client=None):
        """Drop the current client and close its socket (never raises)."""
        client = self._client if client is None else client
        _drop_socket(client)
        self._client = None

    @staticmethod
    def _is_missing_loop_error(exc):
        """True for the `RuntimeError` uasyncio/asyncio raise without a loop."""
        if not isinstance(exc, RuntimeError):
            return False
        message = str(exc).lower()
        return 'no running event loop' in message or 'no event loop' in message

    def _teardown_pump(self):
        """Tear the link down from inside the pump task, which then returns."""
        self._release_client()
        self._pump_task = None
        self._mark_disconnected()

    def _start_pump(self):
        if asyncio is None:
            _info('pump: not started (no asyncio module)')
            return
        if self._pump_task is not None:
            return
        if hasattr(asyncio, 'get_running_loop'):
            try:
                asyncio.get_running_loop()
            except Exception:
                _info('pump: not started (no running event loop)')
                return
        coro = self._pump()
        try:
            self._pump_task = asyncio.create_task(coro)
        except Exception as exc:
            self._pump_task = None
            close = getattr(coro, 'close', None)
            if close is not None:
                try:
                    close()
                except Exception:
                    pass
            if self._is_missing_loop_error(exc):
                # uasyncio without `get_running_loop`, or a start outside the loop.
                _info('pump: not started (no running event loop)')
            else:
                _error('pump: start failed ({})'.format(_describe_error(exc)))
            return
        _info(
            'pump: started delay_ms={} keepalive_ms={}'.format(
                self._pump_delay_ms(), self._keepalive_ms()
            )
        )

    def _stop_pump(self):
        task = self._pump_task
        self._pump_task = None
        if task is not None:
            try:
                task.cancel()
            except Exception:
                pass

    def disconnect(self):
        """Cleanly close the connection and stop the pump. Idempotent."""
        _info('disconnect: requested connected={}'.format(self._connected))
        client = self._client
        if client is not None:
            try:
                client.disconnect()
            except Exception as exc:
                _error('disconnect: close failed ({})'.format(_describe_error(exc)))
        self._client = None
        self._stop_pump()
        self._mark_disconnected()
        _info('disconnect: done')

    def _mark_disconnected(self):
        if self._connected:
            self._connect_epoch += 1
        self._connected = False
        # The next connection must re-send current values: the broker may have
        # lost retained state and the graph may not change again soon.
        self._last_publish.clear()

    async def _pump(self):
        delay_ms = self._pump_delay_ms()
        while self._client is not None:
            try:
                self._client.check_msg()
            except Exception as exc:
                _error('connection lost ({})'.format(_describe_error(exc)))
                self._teardown_pump()
                return
            # A quiet connection must be kept alive: the broker drops it after
            # ~1.5x the keepalive window when no packet arrives.
            if not self._keepalive_tick():
                _warning('keepalive: link torn down after failed ping')
                self._teardown_pump()
                return
            if hasattr(asyncio, 'sleep_ms'):
                await asyncio.sleep_ms(delay_ms)
            else:
                await asyncio.sleep(delay_ms / 1000.0)
        _info('pump: stopped (client cleared)')

    def _on_message(self, topic, msg):
        topic_str = _decode_bytes(topic)
        payload = _decode_bytes(msg)
        self._messages[topic_str] = {
            'payload': payload,
            'seq': self._seq,
            'epoch': self._connect_epoch,
        }
        self._seq += 1
        self._run_message_hooks(topic_str, payload)
        # Only the first payload per topic is logged: the pump must stay quiet.
        if topic_str not in self._log_topics:
            self._log_topics.add(topic_str)
            _data(
                "message: topic='{}' payload='{}' (first on this topic)".format(
                    topic_str, _truncate(payload)
                )
            )

    def _entry_is_usable(self, entry):
        return entry is not None and entry.get('epoch') == self._connect_epoch

    def _coerced_value(self, topic, value_type, json_key):
        entry = self._messages.get(topic)
        if entry is None:
            return None
        cache_key = (topic, value_type, json_key)
        seq = entry['seq']
        cached = self._coerced.get(cache_key)
        if cached is not None and cached[0] == seq:
            return cached[1]
        value = coerce(entry['payload'], value_type, json_key)
        self._coerced[cache_key] = (seq, value)
        return value

    def publish(self, topic, value, qos=0, retain=False, if_changed=None):
        """Publish one value; ``if_changed`` skips repeats since the last success."""
        if not self.enabled:
            return
        payload = self._encode_payload(value)
        if if_changed is not None and self._last_publish.get(if_changed) == payload:
            return
        if not self._connected or self._client is None:
            if topic not in self._log_publish_skips:
                self._log_publish_skips.add(topic)
                _info("publish: skipped (not connected) topic='{}'".format(topic))
            return
        try:
            self._client.publish(topic, payload, retain=bool(retain), qos=int(qos))
        except Exception as exc:
            if topic not in self._log_publish_failures:
                self._log_publish_failures.add(topic)
                _error("publish failed topic='{}' ({})".format(topic, _describe_error(exc)))
        else:
            # Only a publish that reached the broker may suppress the next one:
            # recording it earlier would lose the value for the whole session.
            if if_changed is not None:
                self._last_publish[if_changed] = payload
            # A successful publish proves the link is alive: restart the keepalive clock.
            self._last_tx_ms = _ticks_ms()
            if topic not in self._log_publish_ok:
                self._log_publish_ok.add(topic)
                _success(
                    "publish: first ok topic='{}' qos={} retain={} payload='{}'".format(
                        topic, int(qos), bool(retain), _truncate(_decode_bytes(payload))
                    )
                )

    @staticmethod
    def _encode_payload(value):
        if isinstance(value, (bytes, bytearray)):
            return bytes(value)
        if isinstance(value, bool):
            return b'true' if value else b'false'
        if isinstance(value, str):
            return value.encode('utf-8')
        return str(value).encode('utf-8')

    def latest(self, topic):
        entry = self._messages.get(topic)
        return entry['payload'] if entry else None

    def has_new(self, topic, key=None):
        entry = self._messages.get(topic)
        if not entry:
            return False
        return entry['seq'] > self._consumed.get(key or topic, -1)

    def take_latest(self, topic, key=None):
        consumer = key or topic
        entry = self._messages.get(topic)
        if not entry:
            return None
        if entry['seq'] <= self._consumed.get(consumer, -1):
            return None
        self._consumed[consumer] = entry['seq']
        return entry['payload']

    def take_updated(self, topic, value_type='string', json_key='', key=None,
                     require_connected=False):
        entry = self._messages.get(topic)
        consumer = key or topic
        if entry is None or (require_connected and not self._entry_is_usable(entry)):
            return False
        if entry['seq'] <= self._consumed.get(consumer, -1):
            return False
        self._consumed[consumer] = entry['seq']
        return self._coerced_value(topic, value_type, json_key) is not None

    def latest_value(self, topic, value_type='string', json_key='', default=None,
                     require_connected=False):
        entry = self._messages.get(topic)
        if entry is not None and (not require_connected or self._entry_is_usable(entry)):
            value = self._coerced_value(topic, value_type, json_key)
            if value is not None:
                return value
        return _default_value(value_type, default)


def json_payload(value):
    """Encode value as JSON bytes; falls back to str() once, with one log line."""
    try:
        try:
            # Compact separators keep the wire format identical on the host and on
            # MicroPython, where ujson is compact by default.
            text = json.dumps(value, separators=(',', ':'))
        except TypeError:
            # Older MicroPython builds take no keyword arguments for dumps.
            text = json.dumps(value)
        return text.encode('utf-8')
    except Exception as exc:
        _error(
            'json: encode failed for {} ({})'.format(type(value).__name__, _describe_error(exc))
        )
        return MqttRuntime._encode_payload(str(value))


def json_value(payload):
    """Decode JSON payload to a Python value; returns None on failure."""
    if payload is None:
        return None
    try:
        text = (
            payload.decode('utf-8')
            if isinstance(payload, (bytes, bytearray))
            else str(payload)
        )
        return json.loads(text)
    except Exception as exc:
        _error('json: decode failed ({})'.format(_describe_error(exc)))
        return None


def coerce(payload, value_type='string', json_key=''):
    if payload is None:
        return None

    text = _decode_bytes(payload)
    if json_key:
        try:
            data = json.loads(text)
            if not isinstance(data, dict):
                return None
            value = data.get(json_key)
        except Exception:
            return None
        if value is None:
            return None
    else:
        value = text

    if value_type == 'string':
        return value if isinstance(value, str) else str(value)
    if value_type == 'int':
        try:
            return int(float(value))
        except Exception:
            return None
    if value_type == 'float':
        try:
            return float(value)
        except Exception:
            return None
    if value_type == 'bool':
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            return lowered in ('true', '1', 'yes', 'on')
        try:
            return bool(float(value))
        except Exception:
            return None
    return value


def _type_default(value_type):
    if value_type == 'int':
        return 0
    if value_type == 'float':
        return 0.0
    if value_type == 'bool':
        return False
    return ''


def _default_value(value_type, default):
    if default is not None:
        value = coerce(default, value_type)
        if value is not None:
            return value
    return _type_default(value_type)


_RUNTIME = None


def ensure_runtime():
    global _RUNTIME
    if _RUNTIME is None:
        _RUNTIME = MqttRuntime(_load_settings())
    return _RUNTIME


def register_subscription(topic, qos=0):
    return ensure_runtime().register_subscription(topic, qos)


def register_publish(topic, qos=0):
    return ensure_runtime().register_publish(topic, qos)


def configure_will(topic, payload, retain=True, qos=0):
    return ensure_runtime().configure_will(topic, payload, retain=retain, qos=qos)


def clear_will():
    return ensure_runtime().clear_will()


def publish_deferred(topic, payload, qos=0, retain=True, key=None, if_changed=None):
    return ensure_runtime().publish_deferred(
        topic, payload, qos=qos, retain=retain, key=key, if_changed=if_changed
    )


def clear_deferred(key=None):
    return ensure_runtime().clear_deferred(key)


def on_connect(callback):
    return ensure_runtime().on_connect(callback)


def on_message(callback):
    return ensure_runtime().on_message(callback)


def start():
    return ensure_runtime().start()


def publish(topic, value, qos=0, retain=False, if_changed=None):
    return ensure_runtime().publish(topic, value, qos=qos, retain=retain, if_changed=if_changed)


def latest(topic):
    return ensure_runtime().latest(topic)


def latest_value(topic, value_type='string', json_key='', default=None, require_connected=False):
    return ensure_runtime().latest_value(topic, value_type, json_key, default, require_connected)


def take_latest(topic, key=None):
    return ensure_runtime().take_latest(topic, key)


def take_updated(topic, value_type='string', json_key='', key=None, require_connected=False):
    return ensure_runtime().take_updated(topic, value_type, json_key, key, require_connected)


def has_new(topic, key=None):
    return ensure_runtime().has_new(topic, key)


def is_connected():
    return ensure_runtime().connected

