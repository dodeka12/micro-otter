import asyncio
import importlib.util
import sys
import types
from pathlib import Path

WIFI_BOOT_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
    / "wifi_boot.py"
)


class _RecordingWifiManager(types.ModuleType):
    """Stub of the on-device `tools.wifi_manager` module."""

    DEFAULT_AP_CHANNEL = 6
    DEFAULT_AP_MAX_CLIENTS = 4

    def __init__(self):
        super().__init__("tools.wifi_manager")
        self.calls = []
        self.interfaces = {"sta": object(), "ap": object()}
        self.connect_error = None
        self.connect_result = ("192.168.1.50", "255.255.255.0", "192.168.1.1", "8.8.8.8")
        self.ap_error = None
        self.ap_result = ("192.168.4.1", "255.255.255.0", "192.168.4.1", "8.8.8.8")

    def maybe_create_interface(self, mode):
        self.calls.append(("maybe_create_interface", mode))
        return self.interfaces.get(mode)

    async def start_access_point(
        self,
        iface,
        ssid,
        password,
        *,
        channel=DEFAULT_AP_CHANNEL,
        max_clients=DEFAULT_AP_MAX_CLIENTS,
        status_callback=None,
    ):
        self.calls.append(("start_access_point", ssid))
        if self.ap_error is not None:
            raise self.ap_error
        return self.ap_result

    async def connect_station(self, iface, ssid, password, status_callback=None):
        self.calls.append(("connect_station", ssid))
        if self.connect_error is not None:
            raise self.connect_error
        if hasattr(iface, "connected"):
            iface.connected = True
        return self.connect_result


def _load_wifi_boot_module(sleep_ms=None):
    uasyncio_module = types.ModuleType("uasyncio")

    if sleep_ms is None:

        async def sleep_ms(_ms):
            return None

    uasyncio_module.sleep_ms = sleep_ms

    tools_module = types.ModuleType("tools")
    wifi_manager = _RecordingWifiManager()
    wifi_manager.WifiUnavailableError = type("WifiUnavailableError", (Exception,), {})
    tools_module.wifi_manager = wifi_manager

    original_modules = {
        "uasyncio": sys.modules.get("uasyncio"),
        "tools": sys.modules.get("tools"),
        "tools.wifi_manager": sys.modules.get("tools.wifi_manager"),
    }

    sys.modules["uasyncio"] = uasyncio_module
    sys.modules["tools"] = tools_module
    sys.modules["tools.wifi_manager"] = wifi_manager

    try:
        spec = importlib.util.spec_from_file_location("wifi_boot_under_test", WIFI_BOOT_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
    finally:
        for name, original in original_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original

    return module, wifi_manager


def _profiles(*, sta_enabled=False, sta_ssid="", sta_password="", ap_enabled=False,
              ap_ssid="MicroOtter-AP", ap_password=""):
    return {
        "sta": {"enabled": sta_enabled, "ssid": sta_ssid, "password": sta_password},
        "ap": {"enabled": ap_enabled, "ssid": ap_ssid, "password": ap_password},
    }


def test_bring_up_starts_access_point_before_station():
    module, wifi_manager = _load_wifi_boot_module()
    module._RETURN_BEFORE_STATION_CONNECT = False

    asyncio.run(
        module.bring_up_wifi(
            _profiles(
                sta_enabled=True,
                sta_ssid="home-net",
                sta_password="secret123",
                ap_enabled=True,
                ap_ssid="Boat-AP",
                ap_password="otter12345",
            )
        )
    )

    assert wifi_manager.calls == [
        ("maybe_create_interface", "ap"),
        ("start_access_point", "Boat-AP"),
        ("maybe_create_interface", "sta"),
        ("connect_station", "home-net"),
    ]


def test_bring_up_prefers_station_ip_for_host_ip():
    module, _wifi_manager = _load_wifi_boot_module()
    module._RETURN_BEFORE_STATION_CONNECT = False

    result = asyncio.run(
        module.bring_up_wifi(
            _profiles(
                sta_enabled=True,
                sta_ssid="home-net",
                sta_password="secret123",
                ap_enabled=True,
                ap_ssid="Boat-AP",
                ap_password="otter12345",
            )
        )
    )

    assert result["sta_connected"] is True
    assert result["sta_ip"] == "192.168.1.50"
    assert result["ap_active"] is True
    assert result["ap_ip"] == "192.168.4.1"
    assert result["host_ip"] == "192.168.1.50"
    assert "enable_server" not in result
    assert result["errors"] == {"sta": None, "ap": None}


def test_bring_up_reports_station_failure_without_fallback():
    module, wifi_manager = _load_wifi_boot_module()
    module._RETURN_BEFORE_STATION_CONNECT = False
    wifi_manager.connect_error = wifi_manager.WifiUnavailableError("station timed out")

    result = asyncio.run(
        module.bring_up_wifi(
            _profiles(sta_enabled=True, sta_ssid="home-net", sta_password="secret123")
        )
    )

    assert result["sta_connected"] is False
    assert result["sta_ip"] == ""
    assert result["host_ip"] == "0.0.0.0"
    assert "enable_server" not in result
    assert result["errors"]["sta"] == "station timed out"
    assert result["errors"]["ap"] is None


def test_bring_up_access_point_only_never_connects_station():
    module, wifi_manager = _load_wifi_boot_module()

    result = asyncio.run(
        module.bring_up_wifi(
            _profiles(ap_enabled=True, ap_ssid="Boat-AP", ap_password="otter12345")
        )
    )

    assert not any(call[0] == "connect_station" for call in wifi_manager.calls)
    assert result["sta_connected"] is False
    assert result["ap_active"] is True
    assert result["host_ip"] == "192.168.4.1"
    assert "enable_server" not in result


def test_bring_up_with_both_profiles_disabled_touches_no_interface():
    module, wifi_manager = _load_wifi_boot_module()

    result = asyncio.run(module.bring_up_wifi(_profiles()))

    assert wifi_manager.calls == []
    assert result["host_ip"] == "0.0.0.0"
    assert "enable_server" not in result
    assert result["sta_enabled"] is False
    assert result["ap_enabled"] is False


def test_bring_up_keeps_errors_independent_when_access_point_fails():
    module, wifi_manager = _load_wifi_boot_module()
    module._RETURN_BEFORE_STATION_CONNECT = False
    wifi_manager.ap_error = RuntimeError("ap start failed")

    result = asyncio.run(
        module.bring_up_wifi(
            _profiles(
                sta_enabled=True,
                sta_ssid="home-net",
                sta_password="secret123",
                ap_enabled=True,
                ap_ssid="Boat-AP",
                ap_password="otter12345",
            )
        )
    )

    assert result["ap_active"] is False
    assert result["ap_ip"] == ""
    assert result["errors"]["ap"] == "ap start failed"
    assert result["errors"]["sta"] is None
    assert result["sta_connected"] is True
    assert result["host_ip"] == "192.168.1.50"
    assert "enable_server" not in result


def test_bring_up_returns_after_ap_without_station_connect_when_flagged():
    module, wifi_manager = _load_wifi_boot_module()

    result = asyncio.run(
        module.bring_up_wifi(
            _profiles(
                sta_enabled=True,
                sta_ssid="home-net",
                sta_password="secret123",
                ap_enabled=True,
                ap_ssid="Boat-AP",
                ap_password="otter12345",
            )
        )
    )

    assert wifi_manager.calls == [
        ("maybe_create_interface", "ap"),
        ("start_access_point", "Boat-AP"),
        ("maybe_create_interface", "sta"),
    ]
    assert result["sta_connected"] is False
    assert result["sta_interface"] is wifi_manager.interfaces["sta"]
    assert result["ap_active"] is True
    assert result["host_ip"] == "192.168.4.1"
    assert "enable_server" not in result


class _StopSupervisor(Exception):
    """Raised by the scripted sleep to end an endless supervisor loop."""


class _ScriptedStaInterface:
    def __init__(self, connected=False):
        self.connected = connected
        self.ipconfig = ("192.168.1.50", "255.255.255.0", "192.168.1.1", "8.8.8.8")
        self.ifconfig_error = None

    def isconnected(self):
        return self.connected

    def ifconfig(self):
        if self.ifconfig_error is not None:
            raise self.ifconfig_error
        return self.ipconfig


def _make_sleep_recorder(limit):
    recorded = []

    async def sleep_ms(ms):
        recorded.append(ms)
        if len(recorded) >= limit:
            raise _StopSupervisor()

    return sleep_ms, recorded


def _supervisor_result(sta_interface, *, sta_enabled=True):
    return {
        "sta_enabled": sta_enabled,
        "sta_interface": sta_interface,
        "sta_ssid": "home-net",
        "sta_password": "secret123",
        "sta_connected": False,
        "sta_ip": "",
        "host_ip": "0.0.0.0",
        "ap_active": False,
        "ap_ip": "",
        "retry_count": 0,
        "errors": {"sta": "timed out", "ap": None},
    }


def _run_supervisor(module, result, **kwargs):
    try:
        asyncio.run(module.station_supervisor(result, **kwargs))
    except _StopSupervisor:
        pass


def test_supervisor_retries_at_the_configured_interval():
    sleep_ms, recorded = _make_sleep_recorder(1)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    wifi_manager.connect_error = wifi_manager.WifiUnavailableError("timed out")
    result = _supervisor_result(_ScriptedStaInterface(False))

    _run_supervisor(module, result, retry_interval_ms=30000)

    assert [call for call in wifi_manager.calls if call[0] == "connect_station"] == [
        ("connect_station", "home-net")
    ]
    assert recorded == [30000]
    assert result["retry_count"] == 1
    assert result["sta_connected"] is False


def test_supervisor_publishes_late_connect_only_once():
    sleep_ms, recorded = _make_sleep_recorder(3)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    result = _supervisor_result(_ScriptedStaInterface(False))
    late_ips = []

    async def on_late_connect(ip):
        late_ips.append(ip)

    _run_supervisor(module, result, on_late_connect=on_late_connect)

    assert late_ips == ["192.168.1.50"]
    assert result["sta_connected"] is True
    assert result["sta_ip"] == "192.168.1.50"
    assert result["host_ip"] == "192.168.1.50"
    assert result["errors"]["sta"] is None
    assert recorded == [30000, 30000, 30000]
    connect_calls = [call for call in wifi_manager.calls if call[0] == "connect_station"]
    assert len(connect_calls) == 1


def test_supervisor_keeps_retrying_and_throttles_failure_logs():
    sleep_ms, recorded = _make_sleep_recorder(9)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    wifi_manager.connect_error = wifi_manager.WifiUnavailableError("timed out")
    result = _supervisor_result(_ScriptedStaInterface(False))
    states = []

    def status_callback(state, **fields):
        states.append((state, fields.get("attempt")))

    _run_supervisor(module, result, status_callback=status_callback)

    connect_calls = [call for call in wifi_manager.calls if call[0] == "connect_station"]
    assert len(connect_calls) == 9
    assert recorded == [30000] * 9
    assert result["retry_count"] == 9
    assert result["sta_connected"] is False
    assert states == [("retry-failed", 1)]


def test_supervisor_returns_without_sleeping_when_station_disabled():
    sleep_ms, recorded = _make_sleep_recorder(1)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    result = _supervisor_result(_ScriptedStaInterface(False), sta_enabled=False)

    asyncio.run(module.station_supervisor(result))

    assert recorded == []
    assert wifi_manager.calls == []


def test_supervisor_returns_when_station_interface_missing():
    module, _wifi_manager = _load_wifi_boot_module()
    result = _supervisor_result(None)

    asyncio.run(module.station_supervisor(result))

    assert result["retry_count"] == 0


def test_supervisor_honours_custom_retry_interval():
    sleep_ms, recorded = _make_sleep_recorder(1)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    wifi_manager.connect_error = wifi_manager.WifiUnavailableError("timed out")
    result = _supervisor_result(_ScriptedStaInterface(False))

    _run_supervisor(module, result, retry_interval_ms=12345)

    assert recorded == [12345]


def _connected_result(sta_interface, *, ap_active=False, ap_ip=""):
    return {
        "sta_enabled": True,
        "sta_interface": sta_interface,
        "sta_ssid": "home-net",
        "sta_password": "secret123",
        "sta_connected": True,
        "sta_ip": "192.168.1.50",
        "host_ip": "192.168.1.50",
        "ap_active": ap_active,
        "ap_ip": ap_ip,
        "retry_count": 0,
        "errors": {"sta": None, "ap": None},
    }


def test_supervisor_detects_link_drop_and_notifies_transport_down():
    sleep_ms, _recorded = _make_sleep_recorder(1)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    wifi_manager.connect_error = wifi_manager.WifiUnavailableError("still down")
    interface = _ScriptedStaInterface(False)
    result = _connected_result(interface, ap_active=True, ap_ip="192.168.4.1")
    transport_down_calls = []

    async def on_transport_down():
        transport_down_calls.append(True)

    _run_supervisor(module, result, on_transport_down=on_transport_down)

    assert transport_down_calls == [True]
    assert result["sta_connected"] is False
    assert result["sta_ip"] == ""
    assert result["host_ip"] == "192.168.4.1"


def test_supervisor_reconnects_and_relinks_after_drop():
    sleep_ms, _recorded = _make_sleep_recorder(1)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    interface = _ScriptedStaInterface(False)
    result = _connected_result(interface)
    late_ips = []
    transport_down_calls = []

    async def on_late_connect(ip):
        late_ips.append(ip)

    async def on_transport_down():
        transport_down_calls.append(True)

    _run_supervisor(
        module,
        result,
        on_late_connect=on_late_connect,
        on_transport_down=on_transport_down,
    )

    assert transport_down_calls == [True]
    assert late_ips == ["192.168.1.50"]
    assert result["sta_connected"] is True
    assert result["host_ip"] == "192.168.1.50"


def test_supervisor_adopts_already_connected_station():
    sleep_ms, recorded = _make_sleep_recorder(1)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    result = _supervisor_result(_ScriptedStaInterface(True))
    late_ips = []
    states = []

    async def on_late_connect(ip):
        late_ips.append(ip)

    def status_callback(state, **fields):
        states.append((state, fields.get("ip")))

    _run_supervisor(
        module,
        result,
        on_late_connect=on_late_connect,
        status_callback=status_callback,
    )

    assert result["sta_connected"] is True
    assert result["sta_ip"] == "192.168.1.50"
    assert result["host_ip"] == "192.168.1.50"
    assert result["errors"]["sta"] is None
    assert late_ips == ["192.168.1.50"]
    assert states == [("station-late-connect", "192.168.1.50")]
    assert result["retry_count"] == 0
    assert recorded == [30000]
    assert not any(call[0] == "connect_station" for call in wifi_manager.calls)


def test_supervisor_adoption_is_idempotent():
    sleep_ms, recorded = _make_sleep_recorder(3)
    module, wifi_manager = _load_wifi_boot_module(sleep_ms)
    result = _supervisor_result(_ScriptedStaInterface(True))
    late_ips = []
    states = []

    async def on_late_connect(ip):
        late_ips.append(ip)

    def status_callback(state, **fields):
        states.append(state)

    _run_supervisor(
        module,
        result,
        on_late_connect=on_late_connect,
        status_callback=status_callback,
    )

    assert late_ips == ["192.168.1.50"]
    assert states == ["station-late-connect"]
    assert recorded == [30000, 30000, 30000]
    assert not any(call[0] == "connect_station" for call in wifi_manager.calls)


def test_supervisor_adoption_without_ipconfig(capsys):
    sleep_ms, _recorded = _make_sleep_recorder(1)
    module, _wifi_manager = _load_wifi_boot_module(sleep_ms)
    interface = _ScriptedStaInterface(True)
    interface.ifconfig_error = OSError("no ipconfig")
    result = _supervisor_result(interface)
    late_ips = []

    async def on_late_connect(ip):
        late_ips.append(ip)

    _run_supervisor(module, result, on_late_connect=on_late_connect)

    assert result["sta_connected"] is True
    assert result["sta_ip"] == "0.0.0.0"
    assert result["host_ip"] == "0.0.0.0"
    assert late_ips == ["0.0.0.0"]
    out = capsys.readouterr().out
    assert "wifi-boot: station already connected, adopted ip=0.0.0.0" in out


def test_supervisor_adoption_prefers_station_ip_over_ap():
    sleep_ms, _recorded = _make_sleep_recorder(1)
    module, _wifi_manager = _load_wifi_boot_module(sleep_ms)
    result = _supervisor_result(_ScriptedStaInterface(True))
    result["ap_active"] = True
    result["ap_ip"] = "192.168.4.1"
    late_ips = []

    async def on_late_connect(ip):
        late_ips.append(ip)

    _run_supervisor(module, result, on_late_connect=on_late_connect)

    assert late_ips == ["192.168.1.50"]
    assert result["sta_ip"] == "192.168.1.50"
    assert result["host_ip"] == "192.168.1.50"


def test_supervisor_adoption_clears_previous_station_error():
    sleep_ms, _recorded = _make_sleep_recorder(1)
    module, _wifi_manager = _load_wifi_boot_module(sleep_ms)
    result = _supervisor_result(_ScriptedStaInterface(True))
    assert result["errors"]["sta"] == "timed out"

    _run_supervisor(module, result)

    assert result["errors"]["sta"] is None
    assert result["errors"]["ap"] is None

