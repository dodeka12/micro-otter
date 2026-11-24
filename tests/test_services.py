import asyncio
import importlib.util
import sys
import types
from pathlib import Path

import pytest

DEVICE_ROOT = Path(__file__).resolve().parents[1] / "src" / "micro_otter" / "nodes" / "device"
OTTER_RUNTIME_ROOT = DEVICE_ROOT / "runtime" / "general" / "otter_runtime"
SERVICES_PATH = OTTER_RUNTIME_ROOT / "services.py"


def _load_module_from_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeWebInterface:
    instances = []

    def __init__(self, host_ip, server=None, enable_server=True, port=80):
        self.host_ip = host_ip
        self.enable_server = enable_server
        self.port = port
        self.web_server = None
        self.instances.append(self)

    def set_host_ip(self, ip):
        self.host_ip = ip

    def start_server(self):
        self.web_server = object()
        return True

    async def wait_until_server_ready(self, timeout_ms=None):
        return True

    async def shutdown(self):
        self.web_server = None


class FakeRuntime:
    def __init__(self):
        self.enabled = True
        self.connected = False

    def start(self):
        self.connected = True

    def disconnect(self):
        self.connected = False


@pytest.fixture()
def services_env(tmp_path, monkeypatch):
    FakeWebInterface.instances = []

    otter_runtime = types.ModuleType("otter_runtime")
    otter_runtime.__path__ = [str(OTTER_RUNTIME_ROOT)]
    monkeypatch.setitem(sys.modules, "otter_runtime", otter_runtime)

    settings_store = _load_module_from_file(
        "otter_runtime.settings_store", OTTER_RUNTIME_ROOT / "settings_store.py"
    )
    service_controller = _load_module_from_file(
        "otter_runtime.service_controller", OTTER_RUNTIME_ROOT / "service_controller.py"
    )

    web_interface = types.ModuleType("otter_runtime.web_interface")
    web_interface.WebInterface = FakeWebInterface
    web_interface.WEB_INTERFACE = None

    otter_mqtt = types.ModuleType("otter_mqtt")
    runtime = types.ModuleType("otter_mqtt.runtime")
    runtime.ensure_runtime = lambda: FakeRuntime()
    otter_mqtt.runtime = runtime

    monkeypatch.setitem(sys.modules, "otter_runtime.settings_store", settings_store)
    monkeypatch.setitem(sys.modules, "otter_runtime.service_controller", service_controller)
    monkeypatch.setitem(sys.modules, "otter_runtime.web_interface", web_interface)
    monkeypatch.setitem(sys.modules, "otter_mqtt", otter_mqtt)
    monkeypatch.setitem(sys.modules, "otter_mqtt.runtime", runtime)
    otter_runtime.settings_store = settings_store
    otter_runtime.service_controller = service_controller
    otter_runtime.web_interface = web_interface

    webserver_service = _load_module_from_file(
        "otter_runtime.webserver_service", OTTER_RUNTIME_ROOT / "webserver_service.py"
    )
    mqtt_service = _load_module_from_file(
        "otter_runtime.mqtt_service", OTTER_RUNTIME_ROOT / "mqtt_service.py"
    )
    monkeypatch.setitem(sys.modules, "otter_runtime.webserver_service", webserver_service)
    monkeypatch.setitem(sys.modules, "otter_runtime.mqtt_service", mqtt_service)
    otter_runtime.webserver_service = webserver_service
    otter_runtime.mqtt_service = mqtt_service

    monkeypatch.setattr(
        webserver_service, "WEBSERVER_SETTINGS_FILE", str(tmp_path / "webserver_settings.json")
    )

    services = _load_module_from_file("otter_runtime.services", SERVICES_PATH)
    return types.SimpleNamespace(
        services=services,
        webserver_service=webserver_service,
        mqtt_service=mqtt_service,
        tmp_path=tmp_path,
    )


def test_build_runtime_services_order_and_webserver_settings(services_env):
    settings_path = services_env.tmp_path / "webserver_settings.json"
    settings_path.write_text('{"enable": false, "port": 8080}', encoding="utf-8")

    built = services_env.services.build_runtime_services()

    assert isinstance(built[0], services_env.webserver_service.WebServerService)
    assert isinstance(built[1], services_env.mqtt_service.MqttService)
    assert built[0].enabled() is False

    asyncio.run(built[0].start({"host_ip": "1.2.3.4"}))
    assert FakeWebInterface.instances[0].port == 8080


def test_build_runtime_services_webserver_enabled_default(services_env):
    built = services_env.services.build_runtime_services()

    assert built[0].enabled() is True
