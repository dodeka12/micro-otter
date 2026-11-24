"""
Custom settings helpers for general runtime.

Provides functions for managing WiFi and webserver settings
that can be called from the custom runtime view.
"""

import json
import os

try:
    from tools.wifi_manager import (
        DEFAULT_AP_CHANNEL,
        DEFAULT_AP_MAX_CLIENTS,
        DEFAULT_AP_SSID,
        DEFAULT_RECONNECT_INTERVAL_S,
        WifiSettingsError,
        load_wifi_profiles,
        load_wifi_reconnect_interval,
        save_wifi_profiles,
        wifi_status_snapshot,
    )
except ImportError:  # pragma: no cover - host tooling without the device tools package
    DEFAULT_AP_CHANNEL = 6
    DEFAULT_AP_MAX_CLIENTS = 4
    DEFAULT_AP_SSID = 'MicroOtter-AP'
    DEFAULT_RECONNECT_INTERVAL_S = 30
    WifiSettingsError = None
    load_wifi_profiles = None
    load_wifi_reconnect_interval = None
    save_wifi_profiles = None
    wifi_status_snapshot = None

from otter_runtime.settings_store import (
    MQTT_SETTINGS_FILE,
    WEBSERVER_SETTINGS_FILE,
    write_settings,
)

WIFI_TOOLS_ERROR = 'WiFi tools unavailable'


def _to_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

# Settings file paths
# Note: Relative paths resolve from the device root (/) where main.py executes
WIFI_SETTINGS_FILE = '/wifi_settings.json'


def create_wifi_settings(
    sta_enabled,
    sta_ssid,
    sta_password,
    ap_enabled,
    ap_ssid,
    ap_password,
    ap_channel=DEFAULT_AP_CHANNEL,
    ap_max_clients=DEFAULT_AP_MAX_CLIENTS,
    reconnect_interval_s=DEFAULT_RECONNECT_INTERVAL_S,
):
    """
    Create or update the independent station and access-point WiFi profiles.

    Validation is owned by tools.wifi_manager: disabled profiles are never
    validated, so saving a fully disabled document always succeeds.

    Args:
        sta_enabled: Whether the station profile is enabled
        sta_ssid: Station network name (SSID)
        sta_password: Station network password
        ap_enabled: Whether the access-point profile is enabled
        ap_ssid: Access-point name (SSID), defaults to the manager default when empty
        ap_password: Access-point password (empty or 8-63 characters)

    Returns:
        JSON string with success status and message
    """
    if save_wifi_profiles is None:
        return json.dumps({
            'success': False,
            'error': WIFI_TOOLS_ERROR
        })

    try:
        profiles = {
            'sta': {
                'enabled': bool(sta_enabled),
                'ssid': str(sta_ssid or '').strip(),
                'password': str(sta_password or '')
            },
            'ap': {
                'enabled': bool(ap_enabled),
                'ssid': str(ap_ssid or '').strip(),
                'password': str(ap_password or ''),
                'channel': _to_int(ap_channel, DEFAULT_AP_CHANNEL),
                'max_clients': _to_int(ap_max_clients, DEFAULT_AP_MAX_CLIENTS),
            }
        }

        save_wifi_profiles(
            profiles,
            reconnect_interval_s=reconnect_interval_s,
            file_path=WIFI_SETTINGS_FILE,
        )

        return json.dumps({
            'success': True,
            'message': 'WiFi settings saved. Hard reset and reconnect required.',
            'dialog': {
                'type': 'info',
                'title': 'generalRuntime.wifiSettings.restartRequiredTitle',
                'message': 'generalRuntime.wifiSettings.restartRequiredMessage'
            }
        })

    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })


def _wifi_status_fragment(mode, info):
    """
    Build one human-readable status fragment for a single profile.

    Args:
        mode: 'sta' or 'ap'
        info: Per-interface status dict from wifi_status_snapshot()

    Returns:
        String describing the interface state
    """
    detail = info.get('status_label') or ''

    if info.get('connected'):
        ip = info.get('ip') or 'unknown'
        if mode == 'sta':
            return f"STA connected (IP: {ip})"
        return f"AP active (IP: {ip})"

    if mode == 'sta':
        if detail:
            return f"STA enabled, not connected ({detail})"
        return "STA enabled, not connected"

    return "AP enabled, not active"


def check_wifi_status():
    """
    Check current WiFi connection status.

    Reads the status snapshot produced by tools.wifi_manager, so no WiFi
    interface is opened when both profiles are disabled.

    Returns:
        JSON string with connection status, state, and IP info
    """
    if wifi_status_snapshot is None:
        return json.dumps({
            'success': False,
            'status': f"Error: {WIFI_TOOLS_ERROR}",
            'error': WIFI_TOOLS_ERROR
        })

    try:
        snapshot = wifi_status_snapshot(WIFI_SETTINGS_FILE)
        sta = snapshot.get('sta') or {}
        ap = snapshot.get('ap') or {}

        status_parts = []
        if sta.get('enabled'):
            status_parts.append(_wifi_status_fragment('sta', sta))
        if ap.get('enabled'):
            status_parts.append(_wifi_status_fragment('ap', ap))

        if not status_parts:
            status_parts.append("WiFi disabled")

        status = " | ".join(status_parts)

        return json.dumps({
            'success': True,
            'status': status,
            'sta_enabled': bool(sta.get('enabled')),
            'sta_active': bool(sta.get('active')),
            'sta_connected': bool(sta.get('connected')),
            'sta_ip': sta.get('ip', ''),
            'ap_enabled': bool(ap.get('enabled')),
            'ap_active': bool(ap.get('active')),
            'ap_ip': ap.get('ip', ''),
            'mode': snapshot.get('mode', 'sta'),
            'modes': snapshot.get('modes', [])
        })

    except Exception as e:
        return json.dumps({
            'success': False,
            'status': f"Error: {str(e)}",
            'error': str(e)
        })


def _wifi_settings_payload(configured, profiles, reconnect_interval_s):
    """
    Build the view/API payload for the given WiFi profiles.

    Args:
        configured: Whether the settings document exists on disk
        profiles: Mapping with 'sta' and 'ap' profile dicts
        reconnect_interval_s: station reconnect interval in seconds

    Returns:
        JSON string with per-mode fields and the legacy informational mirrors
    """
    sta = profiles.get('sta') or {}
    ap = profiles.get('ap') or {}
    sta_enabled = bool(sta.get('enabled'))
    ap_enabled = bool(ap.get('enabled'))

    return json.dumps({
        'success': True,
        'configured': configured,
        'sta_enabled': sta_enabled,
        'sta_ssid': sta.get('ssid', ''),
        'sta_password': sta.get('password', ''),
        'ap_enabled': ap_enabled,
        'ap_ssid': ap.get('ssid', DEFAULT_AP_SSID),
        'ap_password': ap.get('password', ''),
        'ap_channel': ap.get('channel', DEFAULT_AP_CHANNEL),
        'ap_max_clients': ap.get('max_clients', DEFAULT_AP_MAX_CLIENTS),
        'wifi_reconnect_interval_s': reconnect_interval_s,
        # Legacy informational mirrors - the per-mode fields above are authoritative
        'mode': 'sta' if sta_enabled else 'ap',
        'enabled': sta_enabled or ap_enabled
    })


def read_wifi_settings():
    """
    Read the station and access-point WiFi profiles.
    
    Returns:
        JSON string with per-mode WiFi settings or default values
    """
    if load_wifi_profiles is None:
        return json.dumps({
            'success': False,
            'error': WIFI_TOOLS_ERROR
        })

    defaults = {
        'sta': {'enabled': False, 'ssid': '', 'password': ''},
        'ap': {
            'enabled': False,
            'ssid': DEFAULT_AP_SSID,
            'password': '',
            'channel': DEFAULT_AP_CHANNEL,
            'max_clients': DEFAULT_AP_MAX_CLIENTS,
        }
    }

    try:
        # Check if file exists (MicroPython compatible)
        try:
            os.stat(WIFI_SETTINGS_FILE)
        except OSError:
            # File doesn't exist - report defaults and mark WiFi as not configured.
            return _wifi_settings_payload(False, defaults, DEFAULT_RECONNECT_INTERVAL_S)

        return _wifi_settings_payload(
            True,
            load_wifi_profiles(WIFI_SETTINGS_FILE),
            load_wifi_reconnect_interval(WIFI_SETTINGS_FILE),
        )

    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })


def create_webserver_settings(enable, port=80):
    """
    Create or update webserver settings.
    
    Args:
        enable: Boolean to enable/disable webserver
        port: HTTP port (1-65535)
    
    Returns:
        JSON string with success status and message
    """
    try:
        # Validate inputs
        port = int(port)
        if port < 1 or port > 65535:
            return json.dumps({
                'success': False,
                'error': 'Port must be between 1 and 65535'
            })

        # Create settings object
        settings = {
            'enable': bool(enable),
            'port': port
        }

        # Write to file
        write_settings(WEBSERVER_SETTINGS_FILE, settings)

        return json.dumps({
            'success': True,
            'message': 'Webserver settings saved successfully'
        })

    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })


def read_webserver_settings():
    """
    Read webserver settings from file.
    
    Returns:
        JSON string with webserver settings or default values
    """
    try:
        # Check if file exists (MicroPython compatible)
        try:
            os.stat(WEBSERVER_SETTINGS_FILE)
        except OSError:
            # File doesn't exist - return default values
            return json.dumps({
                'success': True,
                'enable': True,
                'port': 80
            })

        # Read from file
        with open(WEBSERVER_SETTINGS_FILE) as f:
            settings = json.load(f)

        return json.dumps({
            'success': True,
            'enable': settings.get('enable', True),
            'port': settings.get('port', 80)
        })

    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })


def create_mqtt_settings(
    enabled,
    host,
    port=1883,
    client_id='',
    user='',
    password='',
    keepalive=60,
    pump_delay_ms=50,
    resync_interval_s=30
):
    """
    Create or update MQTT settings.

    Args:
        enabled: Boolean to enable/disable MQTT
        host: MQTT broker host
        port: MQTT broker port (1-65535)
        client_id: Optional MQTT client id
        user: Optional MQTT username
        password: Optional MQTT password
        keepalive: MQTT keepalive in seconds
        pump_delay_ms: Message pump poll delay in milliseconds
        resync_interval_s: Service resync interval in seconds

    Returns:
        JSON string with success status and message
    """
    try:
        port = int(port)
        if port < 1 or port > 65535:
            return json.dumps({
                'success': False,
                'error': 'Port must be between 1 and 65535'
            })

        keepalive = int(keepalive)
        pump_delay_ms = int(pump_delay_ms)
        if pump_delay_ms < 1:
            return json.dumps({
                'success': False,
                'error': 'Pump delay must be at least 1 ms'
            })

        resync_interval_s = int(resync_interval_s)
        if resync_interval_s < 1:
            return json.dumps({
                'success': False,
                'error': 'Resync interval must be at least 1 second'
            })

        settings = {
            'enabled': bool(enabled),
            'host': str(host or ''),
            'port': port,
            'client_id': str(client_id or ''),
            'user': str(user or ''),
            'password': str(password or ''),
            'keepalive': keepalive,
            'pump_delay_ms': pump_delay_ms,
            'resync_interval_s': resync_interval_s
        }

        write_settings(MQTT_SETTINGS_FILE, settings)

        return json.dumps({
            'success': True,
            'message': 'MQTT settings saved successfully'
        })

    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })


def read_mqtt_settings():
    """
    Read MQTT settings from file.

    Returns:
        JSON string with MQTT settings or default values
    """
    try:
        try:
            os.stat(MQTT_SETTINGS_FILE)
        except OSError:
            return json.dumps({
                'success': True,
                'configured': False,
                'enabled': False,
                'host': '',
                'port': 1883,
                'client_id': '',
                'user': '',
                'password': '',
                'keepalive': 60,
                'pump_delay_ms': 50,
                'resync_interval_s': 30
            })

        with open(MQTT_SETTINGS_FILE) as f:
            settings = json.load(f)

        return json.dumps({
            'success': True,
            'configured': True,
            'enabled': settings.get('enabled', False),
            'host': settings.get('host', ''),
            'port': settings.get('port', 1883),
            'client_id': settings.get('client_id', ''),
            'user': settings.get('user', ''),
            'password': settings.get('password', ''),
            'keepalive': settings.get('keepalive', 60),
            'pump_delay_ms': settings.get('pump_delay_ms', 50),
            'resync_interval_s': settings.get('resync_interval_s', 30)
        })

    except Exception as e:
        return json.dumps({
            'success': False,
            'error': str(e)
        })


def read_runtime_settings():
    """
    Read WiFi, webserver and MQTT settings in a single response.

    Returns:
        JSON string with merged runtime settings
    """
    wifi = json.loads(read_wifi_settings())
    webserver = json.loads(read_webserver_settings())
    mqtt = json.loads(read_mqtt_settings())

    if wifi.get('success') is False:
        return json.dumps(wifi)
    if webserver.get('success') is False:
        return json.dumps(webserver)
    if mqtt.get('success') is False:
        return json.dumps(mqtt)

    result = {
        'success': True,
        'wifi_sta_enabled': wifi.get('sta_enabled', False),
        'wifi_sta_ssid': wifi.get('sta_ssid', ''),
        'wifi_sta_password': wifi.get('sta_password', ''),
        'wifi_ap_enabled': wifi.get('ap_enabled', False),
        'wifi_ap_ssid': wifi.get('ap_ssid', ''),
        'wifi_ap_password': wifi.get('ap_password', ''),
        'wifi_ap_channel': wifi.get('ap_channel', DEFAULT_AP_CHANNEL),
        'wifi_ap_max_clients': wifi.get('ap_max_clients', DEFAULT_AP_MAX_CLIENTS),
        'wifi_reconnect_interval_s': wifi.get('wifi_reconnect_interval_s', DEFAULT_RECONNECT_INTERVAL_S),
        'webserver_enable': webserver.get('enable', True),
        'webserver_port': webserver.get('port', 80),
        'mqtt_enabled': mqtt.get('enabled', False),
        'mqtt_host': mqtt.get('host', ''),
        'mqtt_port': mqtt.get('port', 1883),
        'mqtt_client_id': mqtt.get('client_id', ''),
        'mqtt_user': mqtt.get('user', ''),
        'mqtt_password': mqtt.get('password', ''),
        'mqtt_keepalive': mqtt.get('keepalive', 60),
        'mqtt_pump_delay_ms': mqtt.get('pump_delay_ms', 50),
        'mqtt_resync_interval_s': mqtt.get('resync_interval_s', 30)
    }

    if wifi.get('configured') is False:
        result['status'] = 'generalRuntime.wifiSettings.notConfigured'
    else:
        result['status'] = 'generalRuntime.customView.downloadSuccess'

    return json.dumps(result)


def _warning_dialog(title_key, message_key):
    """
    Build one warning dialog directive for a custom view response.

    Called only by `_disabled_section_warnings`, which decides when a warning is due;
    the renderer shows the result as a modal with a warning icon and the given i18n
    keys, so the device never sends user-facing prose.

    Args:
        title_key: i18n key of the dialog headline
        message_key: i18n key of the dialog body

    Returns:
        Dialog dict in the custom view response protocol (`type`, `title`, `message`)
    """
    return {
        'type': 'warning',
        'title': title_key,
        'message': message_key
    }


def _disabled_section_warnings(
    sta_enabled,
    sta_ssid,
    sta_password,
    ap_enabled,
    ap_ssid,
    ap_password,
    mqtt_enabled,
    mqtt_host,
    mqtt_user,
    mqtt_password
):
    """
    Collect warnings for credentials that were saved while their section is disabled.

    A disabled section keeps the values that are uploaded with it but never uses them:
    the station stays offline, the access point does not start and the broker is never
    contacted. The MQTT section is collapsed by default, so a user who fills it in,
    forgets the checkbox and uploads sees a plain success message while nothing reaches
    the network. Each configured-but-disabled section therefore reports itself.

    Args:
        sta_enabled: Whether the station profile is enabled
        sta_ssid: Station network name (SSID)
        sta_password: Station network password
        ap_enabled: Whether the access-point profile is enabled
        ap_ssid: Access-point name (SSID)
        ap_password: Access-point password
        mqtt_enabled: Whether MQTT is enabled
        mqtt_host: MQTT broker host
        mqtt_user: MQTT username
        mqtt_password: MQTT password

    Returns:
        List of warning dialog dicts, empty when nothing is configured but disabled
    """
    warnings = []

    if not sta_enabled and str(sta_ssid or '').strip() and str(sta_password or ''):
        warnings.append(_warning_dialog(
            'generalRuntime.customView.disabledSectionTitle',
            'generalRuntime.customView.wifiStaDisabledWarning'
        ))

    if not ap_enabled and str(ap_ssid or '').strip() and str(ap_password or ''):
        warnings.append(_warning_dialog(
            'generalRuntime.customView.disabledSectionTitle',
            'generalRuntime.customView.wifiApDisabledWarning'
        ))

    mqtt_configured = (
        str(mqtt_host or '').strip() or str(mqtt_user or '') or str(mqtt_password or '')
    )
    if not mqtt_enabled and mqtt_configured:
        warnings.append(_warning_dialog(
            'generalRuntime.customView.disabledSectionTitle',
            'generalRuntime.customView.mqttDisabledWarning'
        ))

    return warnings


def create_runtime_settings(
    wifi_sta_enabled,
    wifi_sta_ssid,
    wifi_sta_password,
    wifi_ap_enabled,
    wifi_ap_ssid,
    wifi_ap_password,
    wifi_ap_channel=DEFAULT_AP_CHANNEL,
    wifi_ap_max_clients=DEFAULT_AP_MAX_CLIENTS,
    wifi_reconnect_interval_s=DEFAULT_RECONNECT_INTERVAL_S,
    webserver_enable=True,
    webserver_port=80,
    mqtt_enabled=False,
    mqtt_host='',
    mqtt_port=1883,
    mqtt_client_id='',
    mqtt_user='',
    mqtt_password='',
    mqtt_keepalive=60,
    mqtt_pump_delay_ms=50,
    mqtt_resync_interval_s=30
):
    """
    Save WiFi, webserver and MQTT settings in a single action.

    The response carries the WiFi restart hint in `dialog` and one warning dialog per
    section whose credentials were saved although the section is disabled (see
    `_disabled_section_warnings`), so a forgotten checkbox is visible in the view.

    Returns:
        JSON string with success status, the restart hint and any warning dialogs
    """
    wifi_result = json.loads(
        create_wifi_settings(
            wifi_sta_enabled,
            wifi_sta_ssid,
            wifi_sta_password,
            wifi_ap_enabled,
            wifi_ap_ssid,
            wifi_ap_password,
            ap_channel=wifi_ap_channel,
            ap_max_clients=wifi_ap_max_clients,
            reconnect_interval_s=wifi_reconnect_interval_s,
        )
    )
    if wifi_result.get('success') is False:
        return json.dumps(wifi_result)

    webserver_result = json.loads(
        create_webserver_settings(webserver_enable, webserver_port)
    )
    if webserver_result.get('success') is False:
        return json.dumps(webserver_result)

    mqtt_result = json.loads(
        create_mqtt_settings(
            mqtt_enabled,
            mqtt_host,
            mqtt_port,
            mqtt_client_id,
            mqtt_user,
            mqtt_password,
            mqtt_keepalive,
            mqtt_pump_delay_ms,
            resync_interval_s=mqtt_resync_interval_s,
        )
    )
    if mqtt_result.get('success') is False:
        return json.dumps(mqtt_result)

    result = {
        'success': True,
        'message': 'generalRuntime.customView.uploadSuccess',
        'dialog': wifi_result.get('dialog')
    }

    warnings = _disabled_section_warnings(
        wifi_sta_enabled,
        wifi_sta_ssid,
        wifi_sta_password,
        wifi_ap_enabled,
        wifi_ap_ssid,
        wifi_ap_password,
        mqtt_enabled,
        mqtt_host,
        mqtt_user,
        mqtt_password
    )
    if warnings:
        # `dialogs` is shown after `dialog`, so the restart hint stays the first box.
        result['dialogs'] = warnings

    return json.dumps(result)
