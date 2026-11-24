import importlib.util
import json
import pathlib
import types

import pytest
from tests.helpers.device_tools_env import (
    CountingNetwork,
    ScriptedInterface,
    install_device_tools,
)

CUSTOM_SETTINGS_PATH = pathlib.Path(
    'src/micro_otter/nodes/device/runtime/general/otter_runtime/custom_settings.py'
).resolve()


@pytest.fixture()
def wifi_env(tmp_path, monkeypatch):
    network_stub = CountingNetwork()
    wifi_manager = install_device_tools(monkeypatch, network_stub)
    return types.SimpleNamespace(
        network=network_stub,
        wifi_manager=wifi_manager,
        settings_path=tmp_path / 'wifi_settings.json',
    )


@pytest.fixture()
def custom_settings(wifi_env, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        'otter_runtime_custom_settings_wifi', CUSTOM_SETTINGS_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    monkeypatch.setattr(module, 'WIFI_SETTINGS_FILE', str(wifi_env.settings_path))
    return module


def _write_profiles(wifi_env, sta, ap):
    wifi_env.settings_path.write_text(
        json.dumps({'version': 2, 'profiles': {'sta': sta, 'ap': ap}}),
        encoding='utf-8',
    )


def test_check_wifi_status_reports_disabled_without_touching_interfaces(
    custom_settings, wifi_env
):
    _write_profiles(
        wifi_env,
        {'enabled': False, 'ssid': '', 'password': ''},
        {'enabled': False, 'ssid': '', 'password': ''},
    )

    result = json.loads(custom_settings.check_wifi_status())

    assert result['success'] is True
    assert result['status'] == 'WiFi disabled'
    assert result['sta_enabled'] is False
    assert result['ap_enabled'] is False
    assert result['modes'] == []
    assert wifi_env.network.created == []


def test_create_wifi_settings_writes_station_profile(custom_settings, wifi_env):
    result = json.loads(
        custom_settings.create_wifi_settings(True, 'home-net', 'secret123', False, '', '')
    )

    assert result['success'] is True
    assert result['dialog']['title'] == 'generalRuntime.wifiSettings.restartRequiredTitle'
    assert result['dialog']['message'] == 'generalRuntime.wifiSettings.restartRequiredMessage'

    document = json.loads(wifi_env.settings_path.read_text(encoding='utf-8'))
    assert document['version'] == 2
    assert document['profiles']['sta'] == {
        'enabled': True,
        'ssid': 'home-net',
        'password': 'secret123',
    }
    assert document['profiles']['ap']['enabled'] is False
    assert document['profiles']['ap']['ssid'] == custom_settings.DEFAULT_AP_SSID


def test_create_wifi_settings_allows_disabling_every_profile(custom_settings, wifi_env):
    result = json.loads(custom_settings.create_wifi_settings(False, '', '', False, '', ''))

    assert result['success'] is True

    document = json.loads(wifi_env.settings_path.read_text(encoding='utf-8'))
    assert document['profiles']['sta']['enabled'] is False
    assert document['profiles']['ap']['enabled'] is False
    assert document['enabled'] is False
    assert document['modes'] == []


def test_create_wifi_settings_rejects_enabled_station_without_ssid(custom_settings, wifi_env):
    result = json.loads(custom_settings.create_wifi_settings(True, '', '', False, '', ''))

    assert result['success'] is False
    assert 'SSID' in result['error']
    assert not wifi_env.settings_path.exists()


def test_create_wifi_settings_keeps_access_point_credentials_across_saves(
    custom_settings, wifi_env
):
    first = json.loads(
        custom_settings.create_wifi_settings(
            True, 'home-net', 'secret123', True, 'Boat-AP', 'otter12345'
        )
    )
    assert first['success'] is True

    second = json.loads(
        custom_settings.create_wifi_settings(
            True, 'home-net', 'secret123', False, 'Boat-AP', 'otter12345'
        )
    )
    assert second['success'] is True

    document = json.loads(wifi_env.settings_path.read_text(encoding='utf-8'))
    assert document['profiles']['ap']['enabled'] is False
    assert document['profiles']['ap']['ssid'] == 'Boat-AP'
    assert document['profiles']['ap']['password'] == 'otter12345'

    _write_profiles(
        wifi_env,
        {'enabled': True, 'ssid': 'home-net', 'password': 'secret123'},
        {'enabled': True, 'ssid': 'Boat-AP', 'password': 'otter12345'},
    )
    wifi_env.network.interfaces = {
        0: ScriptedInterface(active=True, connected=True, ip='192.168.1.42', status=5),
        1: ScriptedInterface(active=True, connected=False, ip='192.168.4.1'),
    }

    result = json.loads(custom_settings.check_wifi_status())

    assert result['success'] is True
    assert result['status'] == 'STA connected (IP: 192.168.1.42) | AP active (IP: 192.168.4.1)'
    assert result['sta_enabled'] is True
    assert result['sta_connected'] is True
    assert result['sta_ip'] == '192.168.1.42'
    assert result['ap_enabled'] is True
    assert result['ap_active'] is True
    assert result['ap_ip'] == '192.168.4.1'
    assert result['mode'] == 'sta'
    assert result['modes'] == ['sta', 'ap']
    assert wifi_env.network.created == [0, 1]


def test_check_wifi_status_reports_failed_station_attempt(custom_settings, wifi_env):
    _write_profiles(
        wifi_env,
        {'enabled': True, 'ssid': 'home-net', 'password': 'secret123'},
        {'enabled': False, 'ssid': '', 'password': ''},
    )
    wifi_env.network.interfaces = {
        0: ScriptedInterface(active=True, connected=False, status=3),
    }

    result = json.loads(custom_settings.check_wifi_status())

    assert result['status'] == 'STA enabled, not connected (no-ap-found)'
    assert result['sta_enabled'] is True
    assert result['sta_connected'] is False
    assert result['ap_enabled'] is False
    assert wifi_env.network.created == [0]


def test_check_wifi_status_reports_inactive_access_point(custom_settings, wifi_env):
    _write_profiles(
        wifi_env,
        {'enabled': False, 'ssid': '', 'password': ''},
        {'enabled': True, 'ssid': 'Boat-AP', 'password': 'otter12345'},
    )
    wifi_env.network.interfaces = {1: ScriptedInterface(active=False, connected=False)}

    result = json.loads(custom_settings.check_wifi_status())

    assert result['status'] == 'AP enabled, not active'
    assert result['ap_enabled'] is True
    assert result['ap_active'] is False
    assert wifi_env.network.created == [1]


@pytest.fixture()
def runtime_paths(custom_settings, wifi_env, monkeypatch):
    root = wifi_env.settings_path.parent
    monkeypatch.setattr(
        custom_settings, 'WEBSERVER_SETTINGS_FILE', str(root / 'webserver_settings.json')
    )
    monkeypatch.setattr(
        custom_settings, 'MQTT_SETTINGS_FILE', str(root / 'mqtt_settings.json')
    )
    return root


def test_create_wifi_settings_saves_an_access_point_only_profile(
    custom_settings, wifi_env
):
    created = json.loads(
        custom_settings.create_wifi_settings(False, '', '', True, 'Boat-AP', 'otter12345')
    )

    assert created['success'] is True

    document = json.loads(wifi_env.settings_path.read_text(encoding='utf-8'))
    assert document['profiles']['sta'] == {'enabled': False, 'ssid': '', 'password': ''}
    assert document['profiles']['ap'] == {
        'enabled': True,
        'ssid': 'Boat-AP',
        'password': 'otter12345',
        'channel': 6,
        'max_clients': 4,
    }
    assert document['modes'] == ['ap']
    assert document['mode'] == 'ap'
    assert document['enabled'] is True
    assert document['ssid'] == 'Boat-AP'


def test_create_wifi_settings_round_trips_ap_channel_and_max_clients(custom_settings, wifi_env):
    created = json.loads(
        custom_settings.create_wifi_settings(
            False, '', '', True, 'Boat-AP', '', ap_channel=11, ap_max_clients=2
        )
    )

    assert created['success'] is True

    result = json.loads(custom_settings.read_wifi_settings())
    assert result['ap_channel'] == 11
    assert result['ap_max_clients'] == 2


def test_read_wifi_settings_reports_ap_tuning_defaults(custom_settings):
    result = json.loads(custom_settings.read_wifi_settings())

    assert result['success'] is True
    assert result['ap_channel'] == 6
    assert result['ap_max_clients'] == 4


def test_create_wifi_settings_accepts_an_open_access_point(custom_settings, wifi_env):
    created = json.loads(
        custom_settings.create_wifi_settings(False, '', '', True, 'Boat-AP', '')
    )

    assert created['success'] is True

    document = json.loads(wifi_env.settings_path.read_text(encoding='utf-8'))
    assert document['profiles']['ap']['password'] == ''

    result = json.loads(custom_settings.read_wifi_settings())
    assert result['ap_enabled'] is True
    assert result['ap_ssid'] == 'Boat-AP'
    assert result['ap_password'] == ''


def test_read_wifi_settings_round_trip(custom_settings):
    created = json.loads(
        custom_settings.create_wifi_settings(
            True, 'home-net', 'secret123', True, 'Boat-AP', 'otter12345'
        )
    )
    assert created['success'] is True

    result = json.loads(custom_settings.read_wifi_settings())

    assert result['success'] is True
    assert result['configured'] is True
    assert result['sta_enabled'] is True
    assert result['sta_ssid'] == 'home-net'
    assert result['sta_password'] == 'secret123'
    assert result['ap_enabled'] is True
    assert result['ap_ssid'] == 'Boat-AP'
    assert result['ap_password'] == 'otter12345'
    assert result['mode'] == 'sta'
    assert result['enabled'] is True


def test_read_wifi_settings_without_file_reports_defaults(custom_settings):
    result = json.loads(custom_settings.read_wifi_settings())

    assert result['success'] is True
    assert result['configured'] is False
    assert result['sta_enabled'] is False
    assert result['sta_ssid'] == ''
    assert result['sta_password'] == ''
    assert result['ap_enabled'] is False
    assert result['ap_ssid'] == custom_settings.DEFAULT_AP_SSID
    assert result['ap_password'] == ''
    assert result['enabled'] is False


def test_read_wifi_settings_reports_corrupted_document(custom_settings, wifi_env):
    wifi_env.settings_path.write_text('{not json', encoding='utf-8')

    result = json.loads(custom_settings.read_wifi_settings())

    assert result['success'] is False
    assert result['error']


def test_read_runtime_settings_exposes_per_mode_wifi_fields(
    custom_settings, runtime_paths
):
    json.loads(
        custom_settings.create_wifi_settings(
            True, 'home-net', 'secret123', False, '', ''
        )
    )

    result = json.loads(custom_settings.read_runtime_settings())

    assert result['success'] is True
    assert result['wifi_sta_enabled'] is True
    assert result['wifi_sta_ssid'] == 'home-net'
    assert result['wifi_sta_password'] == 'secret123'
    assert result['wifi_ap_enabled'] is False
    assert result['wifi_ap_ssid'] == custom_settings.DEFAULT_AP_SSID
    assert result['wifi_ap_password'] == ''
    assert result['webserver_enable'] is True
    assert result['webserver_port'] == 80
    assert result['mqtt_enabled'] is False
    assert result['mqtt_port'] == 1883
    assert result['status'] == 'generalRuntime.customView.downloadSuccess'


def test_read_runtime_settings_marks_unconfigured_wifi(custom_settings, runtime_paths):
    result = json.loads(custom_settings.read_runtime_settings())

    assert result['success'] is True
    assert result['status'] == 'generalRuntime.wifiSettings.notConfigured'
    assert result['wifi_sta_enabled'] is False
    assert result['wifi_ap_enabled'] is False


def test_create_runtime_settings_propagates_wifi_error(custom_settings, runtime_paths):
    result = json.loads(
        custom_settings.create_runtime_settings(True, '', '', False, '', '')
    )

    assert result['success'] is False
    assert 'SSID' in result['error']
    assert not (runtime_paths / 'webserver_settings.json').exists()
    assert not (runtime_paths / 'mqtt_settings.json').exists()


def test_create_runtime_settings_writes_an_access_point_only_configuration(
    custom_settings, runtime_paths
):
    result = json.loads(
        custom_settings.create_runtime_settings(
            False,
            '',
            '',
            True,
            'Boat-AP',
            '',
            webserver_enable=True,
            webserver_port=80,
        )
    )

    assert result['success'] is True

    document = json.loads(
        (runtime_paths / 'wifi_settings.json').read_text(encoding='utf-8')
    )
    assert document['profiles']['sta'] == {'enabled': False, 'ssid': '', 'password': ''}
    assert document['profiles']['ap'] == {
        'enabled': True,
        'ssid': 'Boat-AP',
        'password': '',
        'channel': 6,
        'max_clients': 4,
    }
    assert document['modes'] == ['ap']
    assert document['mode'] == 'ap'

    read_back = json.loads(custom_settings.read_runtime_settings())
    assert read_back['wifi_sta_enabled'] is False
    assert read_back['wifi_ap_enabled'] is True
    assert read_back['wifi_ap_ssid'] == 'Boat-AP'
    assert read_back['wifi_ap_password'] == ''


def test_create_runtime_settings_writes_all_settings_files(custom_settings, runtime_paths):
    result = json.loads(
        custom_settings.create_runtime_settings(
            True,
            'home-net',
            'secret123',
            False,
            '',
            '',
            webserver_enable=True,
            webserver_port=8080,
            mqtt_enabled=True,
            mqtt_host='broker.local',
            mqtt_port=1884,
            mqtt_client_id='otter',
            mqtt_user='u',
            mqtt_password='p',
            mqtt_keepalive=30,
            mqtt_pump_delay_ms=120,
        )
    )

    assert result['success'] is True
    assert result['message'] == 'generalRuntime.customView.uploadSuccess'
    assert result['dialog']['title'] == 'generalRuntime.wifiSettings.restartRequiredTitle'

    webserver = json.loads((runtime_paths / 'webserver_settings.json').read_text(encoding='utf-8'))
    assert webserver == {'enable': True, 'port': 8080}

    mqtt = json.loads((runtime_paths / 'mqtt_settings.json').read_text(encoding='utf-8'))
    assert mqtt['enabled'] is True
    assert mqtt['host'] == 'broker.local'
    assert mqtt['port'] == 1884
    assert mqtt['keepalive'] == 30
    assert mqtt['pump_delay_ms'] == 120


def test_create_runtime_settings_warns_about_disabled_station_credentials(
    custom_settings, runtime_paths
):
    result = json.loads(
        custom_settings.create_runtime_settings(
            False,
            'home-net',
            'secret123',
            False,
            '',
            '',
        )
    )

    assert result['success'] is True
    dialogs = result['dialogs']
    assert len(dialogs) == 1
    assert dialogs[0]['type'] == 'warning'
    assert dialogs[0]['title'] == 'generalRuntime.customView.disabledSectionTitle'
    assert dialogs[0]['message'] == 'generalRuntime.customView.wifiStaDisabledWarning'
    assert result['dialog']['title'] == 'generalRuntime.wifiSettings.restartRequiredTitle'


def test_create_runtime_settings_warns_about_disabled_access_point_password(
    custom_settings, runtime_paths
):
    result = json.loads(
        custom_settings.create_runtime_settings(
            True,
            'home-net',
            'secret123',
            False,
            'MicroOtter-AP',
            'otter12345',
        )
    )

    assert result['success'] is True
    assert [dialog['message'] for dialog in result['dialogs']] == [
        'generalRuntime.customView.wifiApDisabledWarning'
    ]


def test_create_runtime_settings_warns_about_disabled_mqtt_settings(
    custom_settings, runtime_paths
):
    result = json.loads(
        custom_settings.create_runtime_settings(
            True,
            'home-net',
            'secret123',
            False,
            '',
            '',
            mqtt_enabled=False,
            mqtt_host='192.168.43.41',
            mqtt_user='mqtt-user',
            mqtt_password='mqtt-password',
        )
    )

    assert result['success'] is True
    assert [dialog['message'] for dialog in result['dialogs']] == [
        'generalRuntime.customView.mqttDisabledWarning'
    ]

    mqtt = json.loads((runtime_paths / 'mqtt_settings.json').read_text(encoding='utf-8'))
    assert mqtt['enabled'] is False
    assert mqtt['host'] == '192.168.43.41'
    assert mqtt['user'] == 'mqtt-user'


def test_create_runtime_settings_reports_every_disabled_section(custom_settings, runtime_paths):
    result = json.loads(
        custom_settings.create_runtime_settings(
            False,
            'home-net',
            'secret123',
            False,
            'Boat-AP',
            'otter12345',
            mqtt_enabled=False,
            mqtt_host='broker.local',
        )
    )

    assert result['success'] is True
    assert [dialog['message'] for dialog in result['dialogs']] == [
        'generalRuntime.customView.wifiStaDisabledWarning',
        'generalRuntime.customView.wifiApDisabledWarning',
        'generalRuntime.customView.mqttDisabledWarning',
    ]


def test_create_runtime_settings_has_no_warning_dialogs_when_everything_is_enabled(
    custom_settings, runtime_paths
):
    result = json.loads(
        custom_settings.create_runtime_settings(
            True,
            'home-net',
            'secret123',
            True,
            'Boat-AP',
            'otter12345',
            mqtt_enabled=True,
            mqtt_host='broker.local',
            mqtt_user='mqtt-user',
            mqtt_password='mqtt-password',
        )
    )

    assert result['success'] is True
    assert 'dialogs' not in result


def test_create_wifi_settings_persists_reconnect_interval(custom_settings, wifi_env):
    result = json.loads(
        custom_settings.create_wifi_settings(
            True, 'home-net', 'secret123', False, '', '', reconnect_interval_s=45
        )
    )

    assert result['success'] is True
    document = json.loads(wifi_env.settings_path.read_text(encoding='utf-8'))
    assert document['reconnect_interval_s'] == 45


def test_read_wifi_settings_reports_reconnect_interval_default(custom_settings):
    result = json.loads(custom_settings.read_wifi_settings())
    assert result['wifi_reconnect_interval_s'] == 30


def test_create_runtime_settings_round_trips_intervals(custom_settings, runtime_paths):
    result = json.loads(
        custom_settings.create_runtime_settings(
            True,
            'home-net',
            'secret123',
            False,
            '',
            '',
            wifi_reconnect_interval_s=45,
            mqtt_resync_interval_s=25,
        )
    )
    assert result['success'] is True

    read_back = json.loads(custom_settings.read_runtime_settings())
    assert read_back['wifi_reconnect_interval_s'] == 45
    assert read_back['mqtt_resync_interval_s'] == 25
