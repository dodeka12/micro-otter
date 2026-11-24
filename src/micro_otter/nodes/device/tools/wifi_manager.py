# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Reusable WiFi helpers for Micro Otter device tooling."""

import uasyncio as asyncio
import ujson as json

try:
    import utime as _time
except ImportError:  # pragma: no cover - host tooling fallback
    _time = None

try:
    import network  # type: ignore
except ImportError:  # pragma: no cover - host environments may lack network
    network = None  # type: ignore

WIFI_SETTINGS_FILE = "/wifi_settings.json"
WIFI_SETTINGS_VERSION = 2
VALID_WIFI_MODES = ("sta", "ap")
WIFI_PROFILE_MODES = ("sta", "ap")
DEFAULT_AP_SSID = "MicroOtter-AP"
DEFAULT_AP_CHANNEL = 6
DEFAULT_AP_MAX_CLIENTS = 4
STATION_CONNECT_TIMEOUT_MS = 20000
DEFAULT_RECONNECT_INTERVAL_S = 30
RECONNECT_INTERVAL_MIN_S = 1
RECONNECT_INTERVAL_MAX_S = 600

_STATUS_NAME_MAP = {}
if network is not None:  # pragma: no branch - depends on firmware
    _status_pairs = (
        ("STAT_IDLE", "idle"),
        ("STAT_CONNECTING", "connecting"),
        ("STAT_WRONG_PASSWORD", "wrong-password"),
        ("STAT_NO_AP_FOUND", "no-ap-found"),
        ("STAT_CONNECT_FAIL", "connect-fail"),
        ("STAT_GOT_IP", "got-ip"),
        ("STAT_IDLE", "idle"),
        ("STAT_DISCONNECTED", "link-down"),
    )
    for attr, label in _status_pairs:
        value = getattr(network, attr, None)
        if value is not None:
            _STATUS_NAME_MAP[value] = label


class WifiSettingsError(Exception):
    """Raised when WiFi settings cannot be loaded or validated."""


class WifiUnavailableError(Exception):
    """Raised when the requested WiFi interface is not available."""


def _ticks_ms():
    if _time and hasattr(_time, "ticks_ms"):
        return _time.ticks_ms()
    try:  # pragma: no cover - host fallback
        import time as _host_time

        return int(_host_time.time() * 1000)
    except Exception:  # pragma: no cover - extreme fallback
        return 0


def _ticks_diff(current, previous):
    if _time and hasattr(_time, "ticks_diff"):
        return _time.ticks_diff(current, previous)
    return current - previous


#: Status states whose fallback console line reports a failure. The tag of every
#: other state is derived in :func:`_state_level`; both use canonical device log
#: prefixes (see docs/dev/device-communication/log-prefix-conventions.md).
_STATE_FAILURE_SUFFIXES = ("error", "timeout", "failed")


def _state_level(state):
    """Canonical log prefix for a status state name (``station-connected``, ...)."""
    text = str(state or "")
    if text.endswith("connected"):
        return "success"
    if text.endswith(_STATE_FAILURE_SUFFIXES):
        return "error"
    if text.endswith("recover") or text.endswith("disconnect"):
        return "warning"
    return "info"


def _log_wifi(message, level="info"):
    print(f"[{level}] wifi: {message}")


def _notify_status(callback, state, *, message=None, **fields):
    payload = dict(fields)
    if message is not None:
        payload.setdefault("message", message)
    level = _state_level(state)
    if callable(callback):
        try:
            callback(state, **payload)
        except Exception:
            # Fall back to direct logging if the callback fails.
            if message:
                _log_wifi(message, level)
            else:
                _log_wifi(f"WiFi state update: {state}", level)
    else:
        if message:
            _log_wifi(message, level)
        else:
            _log_wifi(f"WiFi state update: {state}", level)


def _read_station_status(iface):
    if iface is None or not hasattr(iface, "status"):
        return None, ""
    try:
        status_code = iface.status()
    except Exception:
        return None, ""
    status_label = _STATUS_NAME_MAP.get(status_code)
    if status_label is None and status_code in (0, None):
        status_label = "idle"
    elif status_label is None:
        status_label = "unknown"
    return status_code, status_label


def _normalize_mode(value):
    if not value:
        return "sta"
    normalized = str(value).strip().lower()
    if normalized not in VALID_WIFI_MODES:
        raise WifiSettingsError(
            "WiFi mode must be either 'sta' (station) or 'ap' (access point)."
        )
    return normalized


def _normalize_enabled(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"false", "0", "no", "off", "disabled"}:
            return False
        if normalized in {"true", "1", "yes", "on", "enabled"}:
            return True
    if value is None:
        return True
    return bool(value)


def _normalize_int(value, default):
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _empty_profile(mode):
    """Return a disabled profile for one mode (`sta` or `ap`)."""
    profile = {
        "enabled": False,
        "ssid": DEFAULT_AP_SSID if mode == "ap" else "",
        "password": "",
    }
    if mode == "ap":
        profile["channel"] = DEFAULT_AP_CHANNEL
        profile["max_clients"] = DEFAULT_AP_MAX_CLIENTS
    return profile


def _normalize_profile(mode, raw):
    """Coerce an arbitrary profile mapping into `{enabled, ssid, password}`."""
    if not isinstance(raw, dict):
        return _empty_profile(mode)

    enabled_raw = raw.get("enabled", False)
    enabled = False if enabled_raw is None else _normalize_enabled(enabled_raw)

    ssid_raw = raw.get("ssid")
    ssid = "" if ssid_raw is None else str(ssid_raw).strip()
    if mode == "ap" and not ssid:
        ssid = DEFAULT_AP_SSID

    password_raw = raw.get("password")
    password = "" if password_raw is None else str(password_raw)

    profile = {"enabled": enabled, "ssid": ssid, "password": password}
    if mode == "ap":
        profile["channel"] = _normalize_int(raw.get("channel"), DEFAULT_AP_CHANNEL)
        profile["max_clients"] = _normalize_int(raw.get("max_clients"), DEFAULT_AP_MAX_CLIENTS)
    return profile


def _validate_profile(mode, profile):
    """Validate one profile in place.

    Disabled profiles are never validated, which is what allows storing an
    empty SSID/password pair when a mode is switched off.
    """
    if not profile["enabled"]:
        return profile

    ssid = profile["ssid"]
    if mode == "ap" and not ssid:
        ssid = DEFAULT_AP_SSID
        profile["ssid"] = ssid
    if not ssid or len(ssid) > 32:
        raise WifiSettingsError("WiFi SSID must be 1-32 characters.")
    for char in ssid:
        if not (" " <= char <= "~"):
            raise WifiSettingsError("WiFi SSID must contain printable ASCII characters only.")

    password = profile["password"]
    if password and (len(password) < 8 or len(password) > 63):
        raise WifiSettingsError("WiFi password must be 8-63 characters or empty.")

    if mode == "ap":
        channel = profile.get("channel", DEFAULT_AP_CHANNEL)
        if not isinstance(channel, int) or channel < 1 or channel > 13:
            raise WifiSettingsError("Access point channel must be 1-13.")
        profile["channel"] = channel
        max_clients = profile.get("max_clients", DEFAULT_AP_MAX_CLIENTS)
        if not isinstance(max_clients, int) or max_clients < 1 or max_clients > 8:
            raise WifiSettingsError("Access point max clients must be 1-8.")
        profile["max_clients"] = max_clients

    return profile


def _derive_legacy_fields(profiles):
    """Derive the legacy flat fields from the authoritative profiles mapping."""
    sta = profiles.get("sta") or _empty_profile("sta")
    ap = profiles.get("ap") or _empty_profile("ap")

    modes = [mode for mode in WIFI_PROFILE_MODES if (profiles.get(mode) or {}).get("enabled")]

    # `mode` must stay inside the legacy ("sta", "ap") domain: interface creation
    # and the host probe tooling branch on it and must never see "both"/"none".
    if sta["enabled"]:
        primary_mode = "sta"
        primary = sta
    elif ap["enabled"]:
        primary_mode = "ap"
        primary = ap
    else:
        primary_mode = "sta"
        primary = sta

    return {
        "modes": modes,
        "mode": primary_mode,
        "enabled": bool(sta["enabled"] or ap["enabled"]),
        "ssid": primary["ssid"],
        "password": primary["password"],
    }


def _read_wifi_profiles(file_path):
    """Parse and normalize the settings document without validating it."""
    try:
        with open(file_path) as settings_file:
            settings = json.loads(settings_file.read())
    except Exception:
        raise WifiSettingsError(
            "WiFi settings file not found or invalid. Set SSID and password and restart."
        )

    if not isinstance(settings, dict):
        raise WifiSettingsError(
            "WiFi settings file not found or invalid. Set SSID and password and restart."
        )

    raw_profiles = settings.get("profiles")
    profiles = {}
    if isinstance(raw_profiles, dict):
        for mode in WIFI_PROFILE_MODES:
            profiles[mode] = _normalize_profile(mode, raw_profiles.get(mode))
    else:
        legacy_mode = _normalize_mode(settings.get("mode", "sta"))
        legacy_profile = _normalize_profile(
            legacy_mode,
            {
                "enabled": settings.get("enabled", True),
                "ssid": settings.get("ssid"),
                "password": settings.get("password"),
            },
        )
        for mode in WIFI_PROFILE_MODES:
            profiles[mode] = legacy_profile if mode == legacy_mode else _empty_profile(mode)

    return profiles


def _normalize_reconnect_interval(value):
    try:
        interval = int(value)
    except (TypeError, ValueError):
        interval = DEFAULT_RECONNECT_INTERVAL_S
    return max(RECONNECT_INTERVAL_MIN_S, min(RECONNECT_INTERVAL_MAX_S, interval))


def load_wifi_reconnect_interval(file_path: str = WIFI_SETTINGS_FILE):
    """Read the top-level station reconnect interval in seconds, clamped.

    A missing/invalid document or field yields the default; never raises.
    """
    try:
        with open(file_path) as settings_file:
            settings = json.loads(settings_file.read())
    except Exception:
        return DEFAULT_RECONNECT_INTERVAL_S
    return _normalize_reconnect_interval(settings.get("reconnect_interval_s"))


def load_wifi_profiles(file_path: str = WIFI_SETTINGS_FILE):
    """Load and validate the two-profile WiFi settings document.

    Legacy documents without a `profiles` mapping are migrated on read: the flat
    `mode`/`enabled`/`ssid`/`password` fields seed that mode's profile and the
    other profile is returned disabled.

    Returns:
        `{"sta": {enabled, ssid, password}, "ap": {enabled, ssid, password}}`

    Raises:
        WifiSettingsError: when the file is missing, unreadable, invalid or a
            profile that is enabled fails validation.
    """
    profiles = _read_wifi_profiles(file_path)
    for mode in WIFI_PROFILE_MODES:
        _validate_profile(mode, profiles[mode])
    return profiles


def save_wifi_profiles(profiles, *, reconnect_interval_s=None, file_path: str = WIFI_SETTINGS_FILE):
    """Store the two-profile WiFi settings document.

    Accepts a partial mapping: a mode missing from `profiles` keeps the profile
    currently stored on disk, so the device view can persist only the mode it
    shows without discarding the other one.

    Args:
        profiles: mapping of mode ("sta"/"ap") to profile mappings.
        reconnect_interval_s: optional station reconnect interval in seconds;
            when None the stored value is preserved, otherwise it is clamped
            to ``RECONNECT_INTERVAL_MIN_S..RECONNECT_INTERVAL_MAX_S``.
        file_path: settings document to write.

    Returns:
        The merged profile mapping that was stored.

    Raises:
        WifiSettingsError: when validation fails or the file cannot be written.
    """
    try:
        stored = load_wifi_profiles(file_path)
    except WifiSettingsError:
        stored = {mode: _empty_profile(mode) for mode in WIFI_PROFILE_MODES}

    raw = profiles if isinstance(profiles, dict) else {}
    merged = {}
    for mode in WIFI_PROFILE_MODES:
        if mode in raw:
            merged[mode] = _normalize_profile(mode, raw[mode])
        else:
            merged[mode] = stored[mode]

    for mode in WIFI_PROFILE_MODES:
        _validate_profile(mode, merged[mode])

    if reconnect_interval_s is None:
        interval = load_wifi_reconnect_interval(file_path)
    else:
        interval = _normalize_reconnect_interval(reconnect_interval_s)

    payload = {"version": WIFI_SETTINGS_VERSION, "profiles": merged}
    payload.update(_derive_legacy_fields(merged))
    payload["reconnect_interval_s"] = interval

    try:
        with open(file_path, "w") as settings_file:
            settings_file.write(json.dumps(payload))
    except Exception:
        raise WifiSettingsError("Failed to save WiFi settings.")

    return merged


def load_wifi_settings(
    *,
    file_path: str = WIFI_SETTINGS_FILE,
    require_station_credentials: bool = True,
):
    """Back-compatible flat view over the profile document.

    Kept for `set_wifi.py`, `wifi_probe.py` and `wifi_diag.py`, which still read
    the legacy keys. The returned `mode` stays inside the legacy ("sta", "ap")
    domain and `ssid`/`password` mirror the primary profile.
    """
    profiles = _read_wifi_profiles(file_path)

    if (
        require_station_credentials
        and profiles["sta"]["enabled"]
        and not profiles["sta"]["ssid"]
    ):
        raise WifiSettingsError("Station mode requires both SSID and password.")

    for mode in WIFI_PROFILE_MODES:
        if mode == "sta" and not require_station_credentials:
            # Tolerant path for status tooling: an incomplete station profile must
            # not prevent reading the stored access-point profile.
            continue
        _validate_profile(mode, profiles[mode])

    derived = _derive_legacy_fields(profiles)

    return {
        "ssid": derived["ssid"],
        "password": derived["password"],
        "mode": derived["mode"],
        "enabled": derived["enabled"],
        "modes": derived["modes"],
        "profiles": profiles,
    }


def save_wifi_settings(
    ssid: str,
    password: str,
    mode: str = "sta",
    *,
    enabled: bool = True,
    file_path: str = WIFI_SETTINGS_FILE,
):
    """Back-compatible single-profile writer.

    Writes only the requested mode, so the other mode's credentials survive -
    this is what `set_wifi.py` relies on.
    """
    normalized_mode = _normalize_mode(mode)
    profile = {
        "enabled": _normalize_enabled(enabled),
        "ssid": ssid,
        "password": password,
    }
    return save_wifi_profiles({normalized_mode: profile}, file_path=file_path)


def maybe_create_interface(mode: str):
    if network is None or not hasattr(network, "WLAN"):
        return None

    interface_modes = []
    if mode == "ap":
        if hasattr(network.WLAN, "IF_AP"):
            interface_modes.append(network.WLAN.IF_AP)
        if hasattr(network, "AP_IF"):
            interface_modes.append(network.AP_IF)
    else:
        if hasattr(network.WLAN, "IF_STA"):
            interface_modes.append(network.WLAN.IF_STA)
        if hasattr(network, "STA_IF"):
            interface_modes.append(network.STA_IF)

    for iface_mode in interface_modes:
        try:
            return network.WLAN(iface_mode)
        except (AttributeError, OSError, ValueError):
            continue
    return None


def _interface_ipconfig(wlan):
    getters = []
    if hasattr(wlan, "ipconfig"):
        getters.append(lambda: wlan.ipconfig("addr4"))
    if hasattr(wlan, "ifconfig"):
        getters.append(wlan.ifconfig)
    for getter in getters:
        try:
            config = getter()
        except Exception:
            continue
        if isinstance(config, (tuple, list)) and config:
            return config
    return None


async def connect_station(
    sta_if,
    ssid: str,
    password: str,
    status_callback=None,
    timeout_ms: int = STATION_CONNECT_TIMEOUT_MS,
):
    if sta_if is None:
        _notify_status(
            status_callback,
            "station-error",
            message="WiFi station interface unavailable",
            mode="sta",
            enabled=True,
            ssid=ssid,
        )
        raise WifiUnavailableError("WiFi station interface unavailable")
    try:
        sta_if.active(True)
    except OSError:
        _notify_status(
            status_callback,
            "station-error",
            message="WiFi station interface cannot be activated",
            mode="sta",
            enabled=True,
            ssid=ssid,
        )
        raise WifiUnavailableError("WiFi station interface cannot be activated")

    try:
        if sta_if.isconnected():
            _notify_status(
                status_callback,
                "station-disconnect",
                message="Station already connected; disconnecting before reconnect.",
                mode="sta",
                enabled=True,
                ssid=ssid,
            )
        sta_if.disconnect()
    except Exception:
        pass

    await asyncio.sleep_ms(200)

    _notify_status(
        status_callback,
        "station-start",
        message=f"Station connecting to '{ssid}'",
        mode="sta",
        enabled=True,
        ssid=ssid,
    )
    connect_error = None
    for attempt in range(2):
        try:
            sta_if.connect(ssid, password)
            connect_error = None
            break
        except OSError as exc:
            connect_error = exc
            if attempt == 0:
                _notify_status(
                    status_callback,
                    "station-recover",
                    message=f"Station connect failed ({exc}); resetting interface and retrying.",
                    mode="sta",
                    enabled=True,
                    ssid=ssid,
                )
                try:
                    sta_if.active(False)
                except Exception:
                    pass
                await asyncio.sleep_ms(250)
                try:
                    sta_if.active(True)
                except OSError:
                    break
                await asyncio.sleep_ms(350)
                continue
            break

    if connect_error is not None:
        _notify_status(
            status_callback,
            "station-error",
            message=f"Station connect failed: {connect_error}",
            mode="sta",
            enabled=True,
            ssid=ssid,
        )
        raise WifiUnavailableError(f"WiFi station connect failed: {connect_error}") from connect_error

    last_status_code = None
    last_log = _ticks_ms()
    start_ticks = last_log
    while True:
        try:
            if sta_if.isconnected():
                break
        except OSError as exc:
            _notify_status(
                status_callback,
                "station-error",
                message=f"Station state error: {exc}",
                mode="sta",
                enabled=True,
                ssid=ssid,
            )
            raise WifiUnavailableError(f"WiFi station state error: {exc}") from exc
        await asyncio.sleep_ms(500)
        status_code, status_label = _read_station_status(sta_if)
        now = _ticks_ms()

        if status_label in ("wrong-password", "connect-fail"):
            detail = f"Station connection failed: {status_label} (code {status_code})"
            _notify_status(
                status_callback,
                "station-error",
                message=detail,
                mode="sta",
                enabled=True,
                ssid=ssid,
                status_code=status_code,
                status_label=status_label,
                elapsed_ms=_ticks_diff(now, start_ticks),
            )
            raise WifiUnavailableError(detail)

        elapsed_ms = _ticks_diff(now, start_ticks)
        if timeout_ms and elapsed_ms >= timeout_ms:
            detail = (
                f"Station connection timed out after {elapsed_ms} ms"
                f" (last status: {status_label or 'unknown'}, code {status_code})"
            )
            _notify_status(
                status_callback,
                "station-timeout",
                message=detail,
                mode="sta",
                enabled=True,
                ssid=ssid,
                status_code=status_code,
                status_label=status_label,
                elapsed_ms=elapsed_ms,
            )
            raise WifiUnavailableError(detail)

        if status_code != last_status_code or _ticks_diff(now, last_log) >= 5000:
            if status_label and status_label != "unknown":
                detail = f"Station status: {status_label} (code {status_code})"
            elif status_code is not None:
                detail = f"Station status code: {status_code}"
            else:
                detail = "Station status: awaiting update"
            _notify_status(
                status_callback,
                "station-search",
                message=detail,
                mode="sta",
                enabled=True,
                ssid=ssid,
                status_code=status_code,
                status_label=status_label,
                elapsed_ms=elapsed_ms,
            )
            last_status_code = status_code
            last_log = now
    _notify_status(
        status_callback,
        "station-connected",
        message="Station connected to network.",
        mode="sta",
        enabled=True,
        ssid=ssid,
    )

    ipconfig = _interface_ipconfig(sta_if)
    ip_payload = ipconfig[0] if isinstance(ipconfig, (list, tuple)) and ipconfig else ""
    _notify_status(
        status_callback,
        "station-ip",
        message=f"Station IP configuration: {ipconfig}",
        mode="sta",
        enabled=True,
        ssid=ssid,
        ip=ip_payload,
        ipconfig=list(ipconfig) if isinstance(ipconfig, (list, tuple)) else ipconfig,
    )
    return ipconfig


async def start_access_point(
    ap_if,
    ssid: str,
    password: str,
    *,
    channel=DEFAULT_AP_CHANNEL,
    max_clients=DEFAULT_AP_MAX_CLIENTS,
    status_callback=None,
):
    if ap_if is None:
        _notify_status(
            status_callback,
            "ap-error",
            message="WiFi access point interface unavailable",
            mode="ap",
            enabled=True,
            ssid=ssid,
        )
        raise WifiUnavailableError("WiFi access point interface unavailable")
    try:
        ap_if.active(True)
    except OSError:
        _notify_status(
            status_callback,
            "ap-error",
            message="WiFi access point interface cannot be activated",
            mode="ap",
            enabled=True,
            ssid=ssid,
        )
        raise WifiUnavailableError("WiFi access point interface cannot be activated")

    config = {"essid": ssid}
    if password:
        config["password"] = password
        auth_attr = getattr(network, "AUTH_WPA_WPA2_PSK", None)
        if auth_attr is None:
            auth_attr = getattr(network, "AUTH_WPA2_PSK", None)
        if auth_attr is not None:
            config["authmode"] = auth_attr
        elif len(password) < 8:
            raise WifiSettingsError(
                "Access point passwords must be at least 8 characters long."
            )
    else:
        open_auth = getattr(network, "AUTH_OPEN", None)
        if open_auth is not None:
            config["authmode"] = open_auth

    if channel:
        config["channel"] = channel
    if max_clients:
        config["max_clients"] = max_clients

    try:
        ap_if.config(**config)
    except Exception:
        # Some firmware builds reject channel/max_clients; fall back to the
        # essential configuration so the AP still comes up.
        essential = {
            key: value for key, value in config.items() if key not in ("channel", "max_clients")
        }
        if essential == config:
            _notify_status(
                status_callback,
                "ap-error",
                message="Failed to configure access point interface",
                mode="ap",
                enabled=True,
                ssid=ssid,
            )
            raise WifiUnavailableError("Failed to configure access point interface")
        _notify_status(
            status_callback,
            "ap-recover",
            message="Access point rejected channel/max_clients; using firmware defaults",
            mode="ap",
            enabled=True,
            ssid=ssid,
        )
        try:
            ap_if.config(**essential)
        except Exception:
            _notify_status(
                status_callback,
                "ap-error",
                message="Failed to configure access point interface",
                mode="ap",
                enabled=True,
                ssid=ssid,
            )
            raise WifiUnavailableError("Failed to configure access point interface")

    _notify_status(
        status_callback,
        "ap-start",
        message=f"Access point '{ssid}' configured.",
        mode="ap",
        enabled=True,
        ssid=ssid,
    )
    await asyncio.sleep_ms(200)
    ipconfig = _interface_ipconfig(ap_if)
    ip_payload = ipconfig[0] if isinstance(ipconfig, (list, tuple)) and ipconfig else ""
    _notify_status(
        status_callback,
        "ap-ready",
        message=f"Access point IP configuration: {ipconfig}",
        mode="ap",
        enabled=True,
        ssid=ssid,
        ip=ip_payload,
        ipconfig=list(ipconfig) if isinstance(ipconfig, (list, tuple)) else ipconfig,
    )
    return ipconfig


def _blank_interface_status():
    return {
        "enabled": False,
        "active": False,
        "connected": False,
        "ip": "",
        "ssid": "",
        "status_code": None,
        "status_label": "",
    }


def _station_interface_status(iface, ssid=""):
    status = _blank_interface_status()
    status["enabled"] = True
    status["ssid"] = ssid
    try:
        status["active"] = bool(iface.active())
    except Exception:
        status["active"] = False

    config = _interface_ipconfig(iface)
    if config and config[0]:
        status["ip"] = config[0]

    try:
        connected = bool(iface.isconnected())
    except Exception:
        connected = False
    if not connected and status["ip"] and status["ip"] not in {"0.0.0.0", ""}:
        connected = True
    status["connected"] = connected

    status_code, status_label = _read_station_status(iface)
    status["status_code"] = status_code
    status["status_label"] = status_label
    return status


def _access_point_interface_status(iface, ssid=""):
    status = _blank_interface_status()
    status["enabled"] = True
    status["ssid"] = ssid
    try:
        status["active"] = bool(iface.active())
    except Exception:
        status["active"] = False

    config = _interface_ipconfig(iface)
    if config and config[0]:
        status["ip"] = config[0]

    status["connected"] = bool(status["active"] and status["ip"])
    if status["connected"]:
        status["status_label"] = "active"
    elif status["active"]:
        status["status_label"] = "starting"
    else:
        status["status_label"] = "inactive"
    return status


def wifi_status_snapshot(file_path: str = WIFI_SETTINGS_FILE):
    """Report the state of both WiFi interfaces.

    The top-level legacy keys mirror the primary profile (station when it is
    enabled, otherwise the access point) so existing consumers such as
    `wifi_probe.py` keep working. `sta`/`ap` always carry the per-interface view.
    No `WLAN` object is constructed while both profiles are disabled.
    """
    result = {
        "active": False,
        "connected": False,
        "ip": "",
        "mode": "sta",
        "enabled": True,
        "ssid": "",
        "modes": [],
        "searching": False,
        "status_code": None,
        "status_label": "",
        "profiles": {mode: _empty_profile(mode) for mode in WIFI_PROFILE_MODES},
        "sta": _blank_interface_status(),
        "ap": _blank_interface_status(),
    }
    try:
        settings = load_wifi_settings(
            file_path=file_path, require_station_credentials=False
        )
    except WifiSettingsError as exc:
        result["error"] = str(exc)
        result["enabled"] = False
        return result

    profiles = settings["profiles"]
    result["profiles"] = profiles
    result["modes"] = settings["modes"]
    result["mode"] = settings["mode"]
    result["enabled"] = settings["enabled"]
    result["ssid"] = settings["ssid"]

    for mode in WIFI_PROFILE_MODES:
        result[mode]["enabled"] = bool(profiles[mode]["enabled"])
        result[mode]["ssid"] = profiles[mode]["ssid"]

    if not result["enabled"]:
        return result

    if network is None or not hasattr(network, "WLAN"):
        if "error" not in result:
            result["error"] = "network module unavailable"
        return result

    if profiles["sta"]["enabled"]:
        sta_if = maybe_create_interface("sta")
        if sta_if is None:
            result["error"] = "sta interface unsupported"
        else:
            result["sta"].update(
                _station_interface_status(sta_if, profiles["sta"]["ssid"])
            )

    if profiles["ap"]["enabled"]:
        ap_if = maybe_create_interface("ap")
        if ap_if is None:
            result["error"] = "ap interface unsupported"
        else:
            result["ap"].update(
                _access_point_interface_status(ap_if, profiles["ap"]["ssid"])
            )

    primary = "sta" if profiles["sta"]["enabled"] else "ap"
    primary_status = result[primary]
    result["mode"] = primary
    result["active"] = primary_status["active"]
    result["connected"] = primary_status["connected"]
    result["ip"] = primary_status["ip"]
    result["status_code"] = primary_status["status_code"]
    result["status_label"] = primary_status["status_label"]
    if primary == "sta" and result["active"] and not result["connected"]:
        result["searching"] = result["status_label"] in {"idle", "connecting", "unknown"}
    return result


def write_wifi_status_json(file_path: str = WIFI_SETTINGS_FILE):
    payload = wifi_status_snapshot(file_path=file_path)
    print(json.dumps(payload))
