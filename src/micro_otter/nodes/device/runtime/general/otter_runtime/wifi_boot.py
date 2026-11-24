# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Boot-time WiFi bring-up and station supervision for the general runtime.

This module is the single place where boot-time interface bring-up happens:
it brings up the access point first (reachable in about a second and keeps the
device administrable while the station connects), then the station, and reports
transport facts only (``host_ip``, ``sta_connected``, ``ap_active``). Service
enablement is the network-service controller's concern, not this module's.

A failed station connect never falls back to the access point and never raises;
it records an error and leaves the retrying to ``station_supervisor()``.
"""

import uasyncio as asyncio

from tools.wifi_manager import (
    DEFAULT_AP_CHANNEL,
    DEFAULT_AP_MAX_CLIENTS,
    WifiUnavailableError,
    connect_station,
    maybe_create_interface,
    start_access_point,
)

WIFI_STA_RETRY_INTERVAL_MS = 30000
WIFI_STA_RETRY_LOG_EVERY = 10
_RETURN_BEFORE_STATION_CONNECT = True


def _emit(level, message):
    print("[{}]".format(level), message)


def _info(message):
    """Always-on diagnostic line for locating hangs on the serial console."""
    _emit("info", message)


def _success(message):
    """Interface came up: the boot path asked for it and it worked."""
    _emit("success", message)


def _warn(message):
    """An interface is unavailable; boot continues on whatever did come up."""
    _emit("warning", message)


def _error(message):
    """An interface failed to come up for a reason other than being absent."""
    _emit("error", message)


def _notify_status(status_callback, state, **fields):
    if not callable(status_callback):
        return
    try:
        status_callback(state, **fields)
    except Exception:
        pass


def _resolve_ip(ipconfig):
    if isinstance(ipconfig, (list, tuple)) and ipconfig:
        return ipconfig[0]
    return ""


def _station_ip(sta_interface):
    """Best-effort station IP from the live interface; '' when unavailable."""
    try:
        return _resolve_ip(sta_interface.ifconfig())
    except Exception:
        return ""


async def bring_up_wifi(profiles, *, status_callback=None):
    """Bring up the interfaces requested by the WiFi profiles.

    Args:
        profiles: Mapping with 'sta' and 'ap' profile dicts (see
            tools.wifi_manager.load_wifi_profiles()).
        status_callback: Optional ``fn(state, **fields)`` logging hook.

    Returns:
        Dict of transport facts (``host_ip``, ``sta_connected``, ``ap_active``,
        interfaces, and per-mode errors); see the ``result`` keys below. It does
        not decide which services run — that is the controller's concern.
        Failures are reported in ``errors`` and never raised.
    """
    ap_profile = profiles.get("ap") or {}
    sta_profile = profiles.get("sta") or {}

    _info(
        "wifi-boot: bring_up_wifi ap_enabled={} ap_ssid={} sta_enabled={} sta_ssid={} early_return={}".format(
            bool(ap_profile.get("enabled")),
            ap_profile.get("ssid", ""),
            bool(sta_profile.get("enabled")),
            sta_profile.get("ssid", ""),
            _RETURN_BEFORE_STATION_CONNECT,
        )
    )

    errors = {"sta": None, "ap": None}
    result = {
        "sta_enabled": bool(sta_profile.get("enabled")),
        "ap_enabled": bool(ap_profile.get("enabled")),
        "sta_ssid": sta_profile.get("ssid", ""),
        "sta_password": sta_profile.get("password", ""),
        "sta_connected": False,
        "sta_ip": "",
        "sta_interface": None,
        "ap_ssid": ap_profile.get("ssid", ""),
        "ap_password": ap_profile.get("password", ""),
        "ap_active": False,
        "ap_ip": "",
        "ap_interface": None,
        "host_ip": "0.0.0.0",
        "retry_count": 0,
        "errors": errors,
    }

    # Access point first: it is reachable within about a second and keeps the
    # device administrable while the station connection is being negotiated.
    if result["ap_enabled"]:
        ap_interface = maybe_create_interface("ap")
        if ap_interface is None:
            errors["ap"] = "ap interface unsupported"
            _warn("wifi-boot: AP interface unsupported")
        else:
            result["ap_interface"] = ap_interface
            _info(
                "wifi-boot: starting AP ssid={} channel={} max_clients={}".format(
                    result["ap_ssid"],
                    ap_profile.get("channel", DEFAULT_AP_CHANNEL),
                    ap_profile.get("max_clients", DEFAULT_AP_MAX_CLIENTS),
                )
            )
            try:
                ipconfig = await start_access_point(
                    ap_interface,
                    result["ap_ssid"],
                    result["ap_password"],
                    channel=ap_profile.get("channel", DEFAULT_AP_CHANNEL),
                    max_clients=ap_profile.get("max_clients", DEFAULT_AP_MAX_CLIENTS),
                    status_callback=status_callback,
                )
            except Exception as exc:
                errors["ap"] = str(exc)
                _error("wifi-boot: AP start failed ({})".format(exc))
            else:
                result["ap_active"] = True
                result["ap_ip"] = _resolve_ip(ipconfig)
                _success("wifi-boot: AP started ip={}".format(result["ap_ip"]))

    # Then the station. A failure only produces an error entry; there is no
    # access-point fallback, the supervisor keeps retrying in the background.
    if result["sta_enabled"]:
        sta_interface = maybe_create_interface("sta")
        if sta_interface is None:
            errors["sta"] = "sta interface unsupported"
            _warn("wifi-boot: STA interface unsupported")
        else:
            result["sta_interface"] = sta_interface
            if not _RETURN_BEFORE_STATION_CONNECT:
                _info("wifi-boot: connecting station ssid={}".format(result["sta_ssid"]))
                try:
                    ipconfig = await connect_station(
                        sta_interface,
                        result["sta_ssid"],
                        result["sta_password"],
                        status_callback=status_callback,
                    )
                except WifiUnavailableError as exc:
                    errors["sta"] = str(exc)
                    _warn("wifi-boot: station connect unavailable ({})".format(exc))
                except Exception as exc:
                    errors["sta"] = str(exc)
                    _warn("wifi-boot: station connect failed ({})".format(exc))
                else:
                    result["sta_connected"] = True
                    result["sta_ip"] = _resolve_ip(ipconfig)
                    _success("wifi-boot: station connected ip={}".format(result["sta_ip"]))
            else:
                _info("wifi-boot: returning before station connect (AP-first)")

    if result["sta_connected"]:
        result["host_ip"] = result["sta_ip"] or "0.0.0.0"
    elif result["ap_active"]:
        result["host_ip"] = result["ap_ip"] or "0.0.0.0"

    _info(
        "wifi-boot: bring_up_wifi done host_ip={} sta_connected={} ap_active={}".format(
            result["host_ip"], result["sta_connected"], result["ap_active"]
        )
    )

    return result

def _station_is_connected(sta_interface):
    try:
        return bool(sta_interface.isconnected())
    except Exception:
        return False


async def _record_station_connected(
    result, station_ip, *, on_late_connect=None, status_callback=None
):
    """Record a live station link and tell the caller about it once.

    Shared by the reconnect path and the adoption path so the two can never
    drift: both have to update the same three transport facts, clear the stale
    station error, announce the event and re-sync the caller's services.
    """
    result["sta_connected"] = True
    result["sta_ip"] = station_ip
    result["host_ip"] = station_ip
    errors = result.get("errors")
    if isinstance(errors, dict):
        errors["sta"] = None
    _notify_status(
        status_callback,
        "station-late-connect",
        ip=station_ip,
        message="Station connected after boot",
    )
    if callable(on_late_connect):
        await on_late_connect(station_ip)


async def _supervise_station_once(
    result, *, on_late_connect, on_transport_down, status_callback
):
    """Run one supervisor iteration; never raises for connection errors."""
    sta_interface = result.get("sta_interface")
    if sta_interface is None:
        return

    if result.get("sta_connected"):
        if _station_is_connected(sta_interface):
            return  # still healthy
        # Link dropped while we thought we were connected.
        result["sta_connected"] = False
        result["sta_ip"] = ""
        result["host_ip"] = result.get("ap_ip", "") if result.get("ap_active") else "0.0.0.0"
        _notify_status(status_callback, "station-link-down", message="Station link dropped")
        if callable(on_transport_down):
            await on_transport_down()
        # fall through to the reconnect attempt below
    elif _station_is_connected(sta_interface):
        # Already associated (e.g. after a soft reset, where the radio was never
        # torn down): adopt the live link instead of returning, otherwise the
        # caller never learns that the transport is up and stops its services.
        station_ip = _station_ip(sta_interface) or "0.0.0.0"
        _success("wifi-boot: station already connected, adopted ip={}".format(station_ip))
        await _record_station_connected(
            result,
            station_ip,
            on_late_connect=on_late_connect,
            status_callback=status_callback,
        )
        return

    try:
        ipconfig = await connect_station(
            sta_interface,
            result.get("sta_ssid", ""),
            result.get("sta_password", ""),
            status_callback=status_callback,
        )
    except Exception as exc:
        result["retry_count"] = result.get("retry_count", 0) + 1
        attempt = result["retry_count"]
        if attempt == 1 or attempt % WIFI_STA_RETRY_LOG_EVERY == 0:
            _notify_status(
                status_callback,
                "retry-failed",
                attempt=attempt,
                message="Station reconnect failed: {}".format(exc),
            )
        return

    result["retry_count"] = result.get("retry_count", 0) + 1
    station_ip = _resolve_ip(ipconfig) or "0.0.0.0"
    await _record_station_connected(
        result,
        station_ip,
        on_late_connect=on_late_connect,
        status_callback=status_callback,
    )


async def station_supervisor(
    result,
    *,
    on_late_connect=None,
    on_transport_down=None,
    retry_interval_ms=WIFI_STA_RETRY_INTERVAL_MS,
    status_callback=None,
):
    """Retry a failed station connection in the background.

    There is no access-point fallback: the runtime logs the failures to the
    serial console (throttled to attempt 1 and every 10th attempt) and keeps the
    device reachable through whichever interface did come up. On a late success
    ``on_late_connect(ip)`` is awaited once so the caller can re-sync services
    with the new IP; supervision continues afterwards so a dropped link is
    re-established without a reboot. A detected connected→disconnected drop
    awaits ``on_transport_down()`` once before the reconnect attempt; detection
    latency is one retry interval.

    Args:
        result: Bring-up result from ``bring_up_wifi()``; updated in place.
        on_late_connect: Optional coroutine ``fn(ip)`` called on a late success.
        on_transport_down: Optional coroutine ``fn()`` called on a detected link drop.
        retry_interval_ms: Delay between attempts (default 30 s).
        status_callback: Optional ``fn(state, **fields)`` logging hook.
    """
    if not result.get("sta_enabled") or result.get("sta_interface") is None:
        return

    _info(
        "wifi-boot: station supervisor started (retry_interval_ms={})".format(
            retry_interval_ms
        )
    )

    while True:
        try:
            await _supervise_station_once(
                result,
                on_late_connect=on_late_connect,
                on_transport_down=on_transport_down,
                status_callback=status_callback,
            )
        except BaseException as exc:
            # Safety net: the supervisor task must never die, otherwise a single
            # unexpected error would strand the device until the next reset.
            _notify_status(
                status_callback,
                "retry-failed",
                message="Station supervisor iteration failed: {}".format(exc),
            )
        await asyncio.sleep_ms(retry_interval_ms)
