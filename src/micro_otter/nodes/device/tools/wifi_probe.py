"""Helper utilities for resilient WiFi status inspection.

This module is intentionally synchronous so it can be invoked from
raw REPL / tooling scripts (for example, over WebSerial) to emit the
same JSON payload as ``wifi_manager.write_wifi_status_json`` while
optionally attempting to re-establish a station connection if the
interface is idle.
"""

import ujson as json

try:
    import uasyncio as _asyncio
except ImportError:  # pragma: no cover - desktops do not ship uasyncio
    _asyncio = None

from tools import wifi_manager


def _has_valid_ip(value):
    return bool(value) and value not in {"0.0.0.0", "", None}


def _station_should_retry(snapshot):
    if snapshot.get("mode") != "sta":
        return False
    if snapshot.get("enabled") is False:
        return False
    if snapshot.get("status_label") in {"connecting", "got-ip"}:
        # Already mid-connection; let the caller poll again later.
        return False
    if snapshot.get("active") and _has_valid_ip(snapshot.get("ip")):
        return False
    return True


def _load_settings():
    try:
        return wifi_manager.load_wifi_settings(require_station_credentials=False)
    except wifi_manager.WifiSettingsError:  # type: ignore[attr-defined]
        return None


def _station_credentials_available(settings):
    if not settings:
        return False
    if settings.get("mode") != "sta":
        return False
    if settings.get("enabled", True) is False:
        return False
    return bool((settings.get("ssid") or "").strip()) and bool(
        settings.get("password") or ""
    )


def _attempt_station_reconnect(settings):
    if _asyncio is None:
        return False
    iface = wifi_manager.maybe_create_interface("sta")
    if iface is None:
        return False

    async def _runner():
        await wifi_manager.connect_station(
            iface,
            settings.get("ssid", ""),
            settings.get("password", ""),
        )

    try:
        _asyncio.run(_runner())
        return True
    except Exception as exc:  # pragma: no cover - surfaced via console logs on device
        print("[WiFiDiag] Station reconnect failed:")
        try:
            import sys  # lazy import to avoid CPython penalty

            sys.print_exception(exc)
        except Exception:  # pragma: no cover - sys may be unavailable
            print(exc)
        return False


def ensure_wifi_status(auto_connect=True):
    """Return a dict describing the current WiFi status.

    When ``auto_connect`` is True and station mode is enabled but idle,
    the helper will try to re-run ``connect_station`` synchronously so
    tooling can obtain a fresh IP without rebooting the device.
    """

    snapshot = wifi_manager.wifi_status_snapshot()
    if not auto_connect or not _station_should_retry(snapshot):
        return snapshot

    settings = _load_settings()
    if not _station_credentials_available(settings):
        return snapshot

    if _attempt_station_reconnect(settings):
        snapshot = wifi_manager.wifi_status_snapshot()
    return snapshot


def write_wifi_status_json(auto_connect=True):
    payload = ensure_wifi_status(auto_connect=auto_connect)
    print(json.dumps(payload))
