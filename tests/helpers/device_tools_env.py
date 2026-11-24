"""Host-side shims for loading device runtime modules in unit tests.

The runtime modules under ``src/micro_otter/nodes/device`` import MicroPython-only
modules (``uasyncio``, ``ujson``, ``network``) and the on-device ``tools`` package.
This helper installs the shims and a ``tools`` package pointing at the device
directory, so tests exercise the real ``tools.wifi_manager`` implementation.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

DEVICE_ROOT = (
    Path(__file__).resolve().parents[2] / "src" / "micro_otter" / "nodes" / "device"
)
WIFI_MANAGER_PATH = DEVICE_ROOT / "tools" / "wifi_manager.py"
OTTER_RUNTIME_ROOT = DEVICE_ROOT / "runtime" / "general" / "otter_runtime"
SETTINGS_STORE_PATH = OTTER_RUNTIME_ROOT / "settings_store.py"


def install_micropython_shims(monkeypatch, network_module=None):
    """Register ``uasyncio``/``ujson``/``network`` shims for the test session."""

    uasyncio_module = types.ModuleType("uasyncio")

    async def sleep_ms(_ms):
        return None

    uasyncio_module.sleep_ms = sleep_ms
    uasyncio_module.wait_for = asyncio.wait_for
    uasyncio_module.TimeoutError = asyncio.TimeoutError
    uasyncio_module.Event = asyncio.Event
    monkeypatch.setitem(sys.modules, "uasyncio", uasyncio_module)
    monkeypatch.setitem(sys.modules, "ujson", json)

    if network_module is None:
        monkeypatch.delitem(sys.modules, "network", raising=False)
    else:
        monkeypatch.setitem(sys.modules, "network", network_module)


def install_settings_store(monkeypatch):
    """Expose ``otter_runtime.settings_store`` and return the module."""

    otter_runtime_package = types.ModuleType("otter_runtime")
    otter_runtime_package.__path__ = [str(OTTER_RUNTIME_ROOT)]
    monkeypatch.setitem(sys.modules, "otter_runtime", otter_runtime_package)

    spec = importlib.util.spec_from_file_location(
        "otter_runtime.settings_store", SETTINGS_STORE_PATH
    )
    settings_store = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(settings_store)

    otter_runtime_package.settings_store = settings_store
    monkeypatch.setitem(sys.modules, "otter_runtime.settings_store", settings_store)
    return settings_store


def install_device_tools(monkeypatch, network_module=None):
    """Expose the device ``tools`` package and return its ``wifi_manager`` module."""

    install_micropython_shims(monkeypatch, network_module)

    tools_package = types.ModuleType("tools")
    tools_package.__path__ = [str(DEVICE_ROOT / "tools")]
    monkeypatch.setitem(sys.modules, "tools", tools_package)

    spec = importlib.util.spec_from_file_location("tools.wifi_manager", WIFI_MANAGER_PATH)
    wifi_manager = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(wifi_manager)

    tools_package.wifi_manager = wifi_manager
    monkeypatch.setitem(sys.modules, "tools.wifi_manager", wifi_manager)

    install_settings_store(monkeypatch)
    return wifi_manager


class CountingNetwork(types.ModuleType):
    """`network` stub that records every `WLAN(...)` construction."""

    STA_IF = 0
    AP_IF = 1
    STAT_IDLE = 0
    STAT_CONNECTING = 1
    STAT_WRONG_PASSWORD = 2
    STAT_NO_AP_FOUND = 3
    STAT_CONNECT_FAIL = 4
    STAT_GOT_IP = 5

    def __init__(self, interfaces=None):
        super().__init__("network")
        self.interfaces = interfaces or {}
        self.created = []

    def WLAN(self, mode):  # noqa: N802 - mirrors the firmware API name
        self.created.append(mode)
        return self.interfaces.get(mode)


class ScriptedInterface:
    """Minimal WLAN stand-in with a scripted IP configuration."""

    def __init__(self, *, active=True, connected=False, ip="", status=5):
        self._active = active
        self._connected = connected
        self._ip = ip
        self._status = status

    def active(self, state=None):
        if state is None:
            return self._active
        self._active = bool(state)
        return self._active

    def isconnected(self):
        return self._connected

    def status(self):
        return self._status

    def ifconfig(self):
        return (self._ip or "0.0.0.0", "255.255.255.0", "192.168.1.1", "8.8.8.8")
