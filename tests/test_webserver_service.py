import asyncio
import importlib.util
import sys
import types
from pathlib import Path

import pytest

DEVICE_ROOT = Path(__file__).resolve().parents[1] / "src" / "micro_otter" / "nodes" / "device"
OTTER_RUNTIME_ROOT = DEVICE_ROOT / "runtime" / "general" / "otter_runtime"
WEBSERVER_SERVICE_PATH = OTTER_RUNTIME_ROOT / "webserver_service.py"


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
        self.server = server
        self.enable_server = enable_server
        self.port = port
        self.web_server = None
        self.start_calls = 0
        self.shutdown_calls = 0
        self.set_host_ip_values = []
        self.wait_timeouts = []
        self.instances.append(self)

    def set_host_ip(self, ip):
        self.set_host_ip_values.append(ip)
        self.host_ip = ip

    def start_server(self):
        self.start_calls += 1
        self.web_server = object()
        return True

    async def wait_until_server_ready(self, timeout_ms=None):
        self.wait_timeouts.append(timeout_ms)
        return True

    async def shutdown(self):
        self.shutdown_calls += 1
        self.web_server = None


@pytest.fixture()
def env(monkeypatch):
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

    otter_runtime.settings_store = settings_store
    otter_runtime.service_controller = service_controller
    otter_runtime.web_interface = web_interface
    monkeypatch.setitem(sys.modules, "otter_runtime.settings_store", settings_store)
    monkeypatch.setitem(sys.modules, "otter_runtime.service_controller", service_controller)
    monkeypatch.setitem(sys.modules, "otter_runtime.web_interface", web_interface)

    module = _load_module_from_file("webserver_service_under_test", WEBSERVER_SERVICE_PATH)
    return types.SimpleNamespace(module=module, web_interface=web_interface)


def test_transport_ready_is_network_independent(env):
    # The webserver must start before any transport exists so that
    # WEB_INTERFACE is available to the audio main loop in STA-only mode.
    service = env.module.WebServerService({"enable": True})

    assert service.transport_ready({}) is True
    assert service.transport_ready({"sta_connected": False, "ap_active": False}) is True


def test_enabled_follows_settings(env):
    assert env.module.WebServerService({"enable": False, "port": 8080}).enabled() is False
    assert env.module.WebServerService({"enable": True}).enabled() is True


def test_start_constructs_interface_with_port_and_publishes(env):
    service = env.module.WebServerService({"enable": True, "port": 8080})

    asyncio.run(service.start({"host_ip": "1.2.3.4"}))

    assert len(FakeWebInterface.instances) == 1
    interface = FakeWebInterface.instances[0]
    assert interface.host_ip == "1.2.3.4"
    assert interface.enable_server is False
    assert interface.port == 8080
    assert env.web_interface.WEB_INTERFACE is interface
    assert service.running() is True


def test_running_is_false_before_start(env):
    service = env.module.WebServerService({"enable": True})

    assert service.running() is False


def test_second_start_reuses_interface(env):
    service = env.module.WebServerService({"enable": True})

    asyncio.run(service.start({"host_ip": "1.2.3.4"}))
    asyncio.run(service.start({"host_ip": "5.6.7.8"}))

    assert len(FakeWebInterface.instances) == 1
    interface = FakeWebInterface.instances[0]
    assert interface.set_host_ip_values == ["5.6.7.8"]
    assert interface.start_calls == 2


def test_stop_shuts_down_and_clears_web_interface(env):
    service = env.module.WebServerService({"enable": True})
    asyncio.run(service.start({"host_ip": "1.2.3.4"}))
    interface = FakeWebInterface.instances[0]

    asyncio.run(service.stop())

    assert interface.shutdown_calls == 1
    assert env.web_interface.WEB_INTERFACE is None
    assert service.running() is False
