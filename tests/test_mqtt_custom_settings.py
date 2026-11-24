import importlib.util
import json
import pathlib

import pytest
from tests.helpers.device_tools_env import CountingNetwork, install_device_tools

CUSTOM_SETTINGS_PATH = pathlib.Path(
    'src/micro_otter/nodes/device/runtime/general/otter_runtime/custom_settings.py'
).resolve()


@pytest.fixture()
def custom_settings(tmp_path, monkeypatch):
    install_device_tools(monkeypatch, CountingNetwork())

    spec = importlib.util.spec_from_file_location(
        'otter_runtime_custom_settings', CUSTOM_SETTINGS_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    monkeypatch.setattr(module, 'MQTT_SETTINGS_FILE', str(tmp_path / 'mqtt_settings.json'))
    monkeypatch.setattr(
        module, "WEBSERVER_SETTINGS_FILE", str(tmp_path / "webserver_settings.json")
    )
    monkeypatch.setattr(module, 'WIFI_SETTINGS_FILE', str(tmp_path / 'wifi_settings.json'))
    return module


def test_mqtt_settings_round_trip(custom_settings):
    result = json.loads(
        custom_settings.create_mqtt_settings(True, 'broker.local', 8883, '', 'u', 'p', 30, 120)
    )
    assert result['success'] is True

    read = json.loads(custom_settings.read_mqtt_settings())
    assert read['success'] is True
    assert read['configured'] is True
    assert read['enabled'] is True
    assert read['host'] == 'broker.local'
    assert read['port'] == 8883
    assert read['user'] == 'u'
    assert read['password'] == 'p'
    assert read['keepalive'] == 30
    assert read['pump_delay_ms'] == 120


def test_read_runtime_settings_includes_mqtt_defaults(custom_settings):
    result = json.loads(custom_settings.read_runtime_settings())
    assert result['success'] is True
    assert result['mqtt_enabled'] is False
    assert result['mqtt_port'] == 1883
    assert result['mqtt_pump_delay_ms'] == 50


def test_mqtt_settings_resync_interval_round_trip(custom_settings):
    result = json.loads(
        custom_settings.create_mqtt_settings(
            True, 'broker.local', 8883, '', 'u', 'p', 30, 120, resync_interval_s=45
        )
    )
    assert result['success'] is True

    read = json.loads(custom_settings.read_mqtt_settings())
    assert read['resync_interval_s'] == 45


def test_mqtt_settings_rejects_zero_resync_interval(custom_settings):
    result = json.loads(
        custom_settings.create_mqtt_settings(True, 'broker.local', resync_interval_s=0)
    )
    assert result['success'] is False
    assert 'Resync interval' in result['error']


def test_read_runtime_settings_includes_resync_interval_default(custom_settings):
    result = json.loads(custom_settings.read_runtime_settings())
    assert result['mqtt_resync_interval_s'] == 30
