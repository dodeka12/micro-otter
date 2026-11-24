import asyncio
import importlib.util
import sys
import types
from pathlib import Path

import pytest

DEVICE_ROOT = Path(__file__).resolve().parents[1] / "src" / "micro_otter" / "nodes" / "device"
OTTER_RUNTIME_ROOT = DEVICE_ROOT / "runtime" / "general" / "otter_runtime"
MQTT_SERVICE_PATH = OTTER_RUNTIME_ROOT / "mqtt_service.py"


def _load_module_from_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeRuntime:
    def __init__(self):
        self.enabled = True
        self.connected = False
        self.start_calls = 0
        self.disconnect_calls = 0

    def start(self):
        self.start_calls += 1
        self.connected = True

    def disconnect(self):
        self.disconnect_calls += 1
        self.connected = False


@pytest.fixture()
def env(monkeypatch):
    otter_runtime = types.ModuleType("otter_runtime")
    otter_runtime.__path__ = [str(OTTER_RUNTIME_ROOT)]
    monkeypatch.setitem(sys.modules, "otter_runtime", otter_runtime)

    service_controller = _load_module_from_file(
        "otter_runtime.service_controller", OTTER_RUNTIME_ROOT / "service_controller.py"
    )
    otter_runtime.service_controller = service_controller
    monkeypatch.setitem(sys.modules, "otter_runtime.service_controller", service_controller)

    fake_runtime = FakeRuntime()
    otter_mqtt = types.ModuleType("otter_mqtt")
    runtime = types.ModuleType("otter_mqtt.runtime")
    runtime.ensure_runtime = lambda: fake_runtime
    otter_mqtt.runtime = runtime
    monkeypatch.setitem(sys.modules, "otter_mqtt", otter_mqtt)
    monkeypatch.setitem(sys.modules, "otter_mqtt.runtime", runtime)

    module = _load_module_from_file("mqtt_service_under_test", MQTT_SERVICE_PATH)
    return types.SimpleNamespace(
        module=module, service_controller=service_controller, fake_runtime=fake_runtime
    )


def test_enabled_delegates_to_runtime(env):
    service = env.module.MqttService()

    assert service.enabled() is True

    env.fake_runtime.enabled = False
    assert service.enabled() is False


def test_running_follows_runtime_connected(env):
    service = env.module.MqttService()

    assert service.running() is False

    asyncio.run(service.start({"sta_connected": True}))
    assert service.running() is True


def test_transport_ready_requires_station(env):
    service = env.module.MqttService()

    assert service.transport_ready({"sta_connected": True}) is True
    assert service.transport_ready({"sta_connected": False, "ap_active": True}) is False
    assert service.transport_ready({}) is False


def test_start_is_idempotent(env):
    service = env.module.MqttService()

    asyncio.run(service.start({"sta_connected": True}))
    asyncio.run(service.start({"sta_connected": True}))

    assert env.fake_runtime.start_calls == 2


def test_stop_disconnects_and_clears_runtime(env):
    service = env.module.MqttService()
    asyncio.run(service.start({"sta_connected": True}))
    assert service.running() is True

    asyncio.run(service.stop())

    assert env.fake_runtime.disconnect_calls == 1
    assert service.running() is False


def test_start_logs_state_and_result(env, capsys):
    service = env.module.MqttService()

    asyncio.run(service.start({"sta_connected": True}))

    lines = [
        line
        for line in capsys.readouterr().out.splitlines()
        if "mqtt-service:" in line
    ]
    assert lines == [
        "[info] mqtt-service: importing otter_mqtt.runtime",
        "[info] mqtt-service: runtime ready enabled=True",
        "[info] mqtt-service: start sta_connected=True enabled=True running=False",
        "[success] mqtt-service: start done connected=True",
    ]


def test_start_logs_not_connected_when_runtime_stays_down(env, capsys):
    # The fake runtime records the call but never reports "connected".
    env.fake_runtime.start = lambda: None
    service = env.module.MqttService()

    asyncio.run(service.start({"sta_connected": True}))

    out = capsys.readouterr().out
    assert "[warning] mqtt-service: start done connected=False" in out
    assert "see the mqtt runtime lines above" in out
    assert service.running() is False


def test_stop_logs_connection_state(env, capsys):
    service = env.module.MqttService()
    asyncio.run(service.start({"sta_connected": True}))
    capsys.readouterr()

    asyncio.run(service.stop())

    lines = [
        line
        for line in capsys.readouterr().out.splitlines()
        if line.startswith("[info] mqtt-service:")
    ]
    assert lines == [
        "[info] mqtt-service: stop connected=True",
        "[info] mqtt-service: stopped",
    ]


def test_import_failure_is_logged_once(env, monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "otter_mqtt.runtime", None)
    service = env.module.MqttService()

    assert service.enabled() is False
    assert service.enabled() is False

    out = capsys.readouterr().out
    assert out.count("[error] mqtt-service: runtime import failed") == 1
    assert "[info] mqtt-service: importing otter_mqtt.runtime" in out
    assert service.running() is False


def test_start_without_runtime_logs_and_returns(env, monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "otter_mqtt.runtime", None)
    service = env.module.MqttService()

    asyncio.run(service.start({"sta_connected": True}))

    out = capsys.readouterr().out
    assert "[warning] mqtt-service: start done connected=False (runtime unavailable)" in out
    assert env.fake_runtime.start_calls == 0


def test_disabled_reason_names_the_settings_file(env):
    env.fake_runtime.enabled = False
    service = env.module.MqttService()

    assert service.enabled() is False
    assert service.disabled_reason() == "enabled=false in /mqtt_settings.json"


def test_disabled_reason_uses_the_runtime_settings_path(env, monkeypatch):
    env.fake_runtime.enabled = False
    monkeypatch.setattr(
        sys.modules["otter_mqtt.runtime"], "MQTT_SETTINGS_FILE", "/data/mqtt.json", raising=False
    )
    service = env.module.MqttService()

    assert service.disabled_reason() == "enabled=false in /data/mqtt.json"


def test_disabled_reason_is_none_when_enabled(env):
    service = env.module.MqttService()

    assert service.enabled() is True
    assert service.disabled_reason() is None


def test_disabled_reason_reports_an_import_failure(env, monkeypatch):
    monkeypatch.setitem(sys.modules, "otter_mqtt.runtime", None)
    service = env.module.MqttService()

    assert service.enabled() is False
    assert service.disabled_reason() == "runtime import failed"
