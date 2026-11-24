import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

WIFI_MANAGER_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "tools"
    / "wifi_manager.py"
)


def _load_wifi_manager_module(network_module=None):
    uasyncio_module = types.ModuleType("uasyncio")

    async def sleep_ms(_ms):
        return None

    uasyncio_module.sleep_ms = sleep_ms

    sys.modules["uasyncio"] = uasyncio_module
    sys.modules["ujson"] = json
    if network_module is None:
        sys.modules.pop("network", None)
    else:
        sys.modules["network"] = network_module

    spec = importlib.util.spec_from_file_location("wifi_manager_under_test", WIFI_MANAGER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class _NeverConnectedSta:
    def __init__(self):
        self._active = False

    def active(self, state=None):
        if state is None:
            return self._active
        self._active = bool(state)
        return self._active

    def isconnected(self):
        return False

    def disconnect(self):
        return None

    def connect(self, _ssid, _password):
        return None

    def status(self):
        return 201


class _WrongPasswordSta(_NeverConnectedSta):
    pass


class _ScriptedInterface:
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


class _FakeNetwork(types.ModuleType):
    """Counter-based `network` stub recording every WLAN construction."""

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
        self._interfaces = interfaces or {}
        self.created = []

    def WLAN(self, mode):  # noqa: N802 - mirrors the firmware API name
        self.created.append(mode)
        return self._interfaces[mode]


def test_connect_station_times_out_instead_of_blocking():
    wifi_manager = _load_wifi_manager_module()

    tick_values = iter([0, 700])
    wifi_manager._ticks_ms = lambda: next(tick_values, 700)
    wifi_manager._ticks_diff = lambda current, previous: current - previous

    sta = _NeverConnectedSta()

    with pytest.raises(wifi_manager.WifiUnavailableError, match="timed out"):
        asyncio.run(
            wifi_manager.connect_station(
                sta,
                "TestNet",
                "TestPassword123",
                timeout_ms=500,
            )
        )


def test_connect_station_fails_fast_on_terminal_status():
    wifi_manager = _load_wifi_manager_module()

    wifi_manager._read_station_status = lambda _iface: (202, "wrong-password")
    wifi_manager._ticks_ms = lambda: 0
    wifi_manager._ticks_diff = lambda current, previous: current - previous

    sta = _WrongPasswordSta()

    with pytest.raises(wifi_manager.WifiUnavailableError, match="wrong-password"):
        asyncio.run(
            wifi_manager.connect_station(
                sta,
                "TestNet",
                "WrongPassword",
                timeout_ms=5000,
            )
        )


def _write_settings(path, payload):
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_save_wifi_profiles_round_trip_writes_version_and_mirrors(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"

    wifi_manager.save_wifi_profiles(
        {
            "sta": {"enabled": True, "ssid": "home-net", "password": "secret123"},
            "ap": {"enabled": True, "ssid": "MicroOtter-AP", "password": "otter12345"},
        },
        file_path=str(settings_path),
    )

    document = json.loads(settings_path.read_text(encoding="utf-8"))
    assert document["version"] == 2
    assert document["profiles"]["sta"]["enabled"] is True
    assert document["profiles"]["ap"]["ssid"] == "MicroOtter-AP"
    assert document["modes"] == ["sta", "ap"]
    assert document["mode"] == "sta"
    assert document["enabled"] is True
    assert document["ssid"] == "home-net"
    assert document["password"] == "secret123"


def test_save_wifi_profiles_allows_disabling_wiFi(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"

    stored = wifi_manager.save_wifi_profiles(
        {"sta": {"enabled": False, "ssid": "", "password": ""}},
        file_path=str(settings_path),
    )

    assert stored["sta"]["enabled"] is False
    document = json.loads(settings_path.read_text(encoding="utf-8"))
    assert document["enabled"] is False
    assert document["modes"] == []
    assert document["mode"] == "sta"


def test_save_wifi_profiles_rejects_enabled_station_without_ssid(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"

    with pytest.raises(wifi_manager.WifiSettingsError, match="SSID"):
        wifi_manager.save_wifi_profiles(
            {"sta": {"enabled": True, "ssid": "", "password": "secret123"}},
            file_path=str(settings_path),
        )


def test_save_wifi_profiles_validates_only_enabled_profiles(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"

    wifi_manager.save_wifi_profiles(
        {"ap": {"enabled": False, "ssid": "", "password": "short"}},
        file_path=str(settings_path),
    )

    with pytest.raises(wifi_manager.WifiSettingsError, match="8-63"):
        wifi_manager.save_wifi_profiles(
            {"ap": {"enabled": True, "ssid": "", "password": "short"}},
            file_path=str(settings_path),
        )

    wifi_manager.save_wifi_profiles(
        {"ap": {"enabled": True, "ssid": "", "password": ""}},
        file_path=str(settings_path),
    )
    document = json.loads(settings_path.read_text(encoding="utf-8"))
    assert document["profiles"]["ap"]["ssid"] == wifi_manager.DEFAULT_AP_SSID
    assert document["mode"] == "ap"


def test_load_wifi_profiles_migrates_legacy_document(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {"ssid": "home-net", "password": "12345678", "mode": "sta", "enabled": True},
    )

    profiles = wifi_manager.load_wifi_profiles(str(settings_path))

    assert set(profiles) == {"sta", "ap"}
    assert profiles["sta"] == {
        "enabled": True,
        "ssid": "home-net",
        "password": "12345678",
    }
    assert profiles["ap"]["enabled"] is False
    assert profiles["ap"]["ssid"] == wifi_manager.DEFAULT_AP_SSID


def test_save_wifi_profiles_preserves_mode_missing_from_partial_save(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"

    wifi_manager.save_wifi_profiles(
        {
            "sta": {"enabled": True, "ssid": "home-net", "password": "secret123"},
            "ap": {"enabled": True, "ssid": "Boat-AP", "password": "otter12345"},
        },
        file_path=str(settings_path),
    )
    wifi_manager.save_wifi_profiles(
        {"sta": {"enabled": True, "ssid": "home-net-2", "password": "secret123"}},
        file_path=str(settings_path),
    )

    document = json.loads(settings_path.read_text(encoding="utf-8"))
    assert document["profiles"]["ap"]["ssid"] == "Boat-AP"
    assert document["profiles"]["ap"]["password"] == "otter12345"


def test_load_wifi_settings_returns_legacy_view_over_profiles(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {"ssid": "home-net", "password": "12345678", "mode": "sta", "enabled": True},
    )

    settings = wifi_manager.load_wifi_settings(file_path=str(settings_path))

    assert settings["ssid"] == "home-net"
    assert settings["password"] == "12345678"
    assert settings["mode"] == "sta"
    assert settings["enabled"] is True
    assert settings["modes"] == ["sta"]
    assert settings["profiles"]["ap"]["enabled"] is False


def test_load_wifi_settings_requires_station_ssid_only_when_requested(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {"profiles": {"sta": {"enabled": True, "ssid": "", "password": ""}}},
    )

    with pytest.raises(wifi_manager.WifiSettingsError, match="Station mode requires"):
        wifi_manager.load_wifi_settings(file_path=str(settings_path))

    settings = wifi_manager.load_wifi_settings(
        file_path=str(settings_path),
        require_station_credentials=False,
    )
    assert settings["mode"] == "sta"
    assert settings["enabled"] is True


def test_save_wifi_settings_preserves_other_mode(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"

    wifi_manager.save_wifi_settings(
        "home-net", "secret123", "sta", file_path=str(settings_path)
    )
    wifi_manager.save_wifi_settings(
        "Boat-AP", "otter12345", "ap", enabled=True, file_path=str(settings_path)
    )

    document = json.loads(settings_path.read_text(encoding="utf-8"))
    assert document["profiles"]["sta"] == {
        "enabled": True,
        "ssid": "home-net",
        "password": "secret123",
    }
    assert document["profiles"]["ap"]["enabled"] is True
    assert document["modes"] == ["sta", "ap"]


def test_wifi_status_snapshot_makes_no_interface_when_all_profiles_disabled(tmp_path):
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {
            "profiles": {
                "sta": {"enabled": False, "ssid": "", "password": ""},
                "ap": {"enabled": False, "ssid": "MicroOtter-AP", "password": ""},
            }
        },
    )
    fake_network = _FakeNetwork()
    wifi_manager = _load_wifi_manager_module(fake_network)

    snapshot = wifi_manager.wifi_status_snapshot(file_path=str(settings_path))

    assert fake_network.created == []
    assert snapshot["enabled"] is False
    assert snapshot["modes"] == []
    assert snapshot["sta"]["active"] is False
    assert snapshot["ap"]["active"] is False
    assert snapshot["sta"]["enabled"] is False
    assert snapshot["ap"]["enabled"] is False
    assert "error" not in snapshot


def test_wifi_status_snapshot_reports_both_interfaces_independently(tmp_path):
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {
            "profiles": {
                "sta": {"enabled": True, "ssid": "home-net", "password": "secret123"},
                "ap": {"enabled": True, "ssid": "Boat-AP", "password": "otter12345"},
            }
        },
    )
    fake_network = _FakeNetwork()
    fake_network._interfaces = {
        0: _ScriptedInterface(active=True, connected=True, ip="192.168.1.50", status=5),
        1: _ScriptedInterface(active=True, connected=False, ip="192.168.4.1"),
    }
    wifi_manager = _load_wifi_manager_module(fake_network)

    snapshot = wifi_manager.wifi_status_snapshot(file_path=str(settings_path))

    assert fake_network.created == [0, 1]
    assert snapshot["enabled"] is True
    assert snapshot["modes"] == ["sta", "ap"]
    assert snapshot["mode"] == "sta"
    assert snapshot["ip"] == "192.168.1.50"
    assert snapshot["sta"] == {
        "enabled": True,
        "active": True,
        "connected": True,
        "ip": "192.168.1.50",
        "ssid": "home-net",
        "status_code": 5,
        "status_label": "got-ip",
    }
    assert snapshot["ap"]["enabled"] is True
    assert snapshot["ap"]["active"] is True
    assert snapshot["ap"]["ip"] == "192.168.4.1"
    assert snapshot["ap"]["ssid"] == "Boat-AP"


def test_wifi_status_snapshot_mirrors_access_point_when_station_disabled(tmp_path):
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {
            "profiles": {
                "sta": {"enabled": False, "ssid": "", "password": ""},
                "ap": {"enabled": True, "ssid": "Boat-AP", "password": "otter12345"},
            }
        },
    )
    fake_network = _FakeNetwork()
    fake_network._interfaces = {
        1: _ScriptedInterface(active=True, connected=False, ip="192.168.4.1"),
    }
    wifi_manager = _load_wifi_manager_module(fake_network)

    snapshot = wifi_manager.wifi_status_snapshot(file_path=str(settings_path))

    assert fake_network.created == [1]
    assert snapshot["enabled"] is True
    assert snapshot["modes"] == ["ap"]
    assert snapshot["mode"] == "ap"
    assert snapshot["ssid"] == "Boat-AP"
    assert snapshot["ip"] == "192.168.4.1"
    assert snapshot["connected"] is True
    assert snapshot["sta"]["active"] is False
    assert snapshot["searching"] is False


def test_wifi_status_snapshot_tolerates_incomplete_station_profile(tmp_path):
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {
            "profiles": {
                "sta": {"enabled": True, "ssid": "", "password": ""},
                "ap": {"enabled": False, "ssid": "MicroOtter-AP", "password": ""},
            }
        },
    )
    fake_network = _FakeNetwork()
    fake_network._interfaces = {0: _ScriptedInterface(active=True, connected=False, status=0)}
    wifi_manager = _load_wifi_manager_module(fake_network)

    snapshot = wifi_manager.wifi_status_snapshot(file_path=str(settings_path))

    assert "error" not in snapshot
    assert snapshot["sta"]["enabled"] is True
    assert snapshot["sta"]["connected"] is False
    assert snapshot["searching"] is True


def test_load_wifi_reconnect_interval_reads_and_clamps(tmp_path):
    wifi_manager = _load_wifi_manager_module()

    assert wifi_manager.load_wifi_reconnect_interval(str(tmp_path / "missing.json")) == 30

    path = _write_settings(tmp_path / "wifi_settings.json", {"reconnect_interval_s": 45})
    assert wifi_manager.load_wifi_reconnect_interval(str(path)) == 45

    low = _write_settings(tmp_path / "low.json", {"reconnect_interval_s": 0})
    assert wifi_manager.load_wifi_reconnect_interval(str(low)) == 1

    high = _write_settings(tmp_path / "high.json", {"reconnect_interval_s": 9999})
    assert wifi_manager.load_wifi_reconnect_interval(str(high)) == 600


def test_save_wifi_profiles_writes_and_preserves_reconnect_interval(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"
    profiles = {"sta": {"enabled": True, "ssid": "home-net", "password": "secret123"}}

    wifi_manager.save_wifi_profiles(
        profiles, reconnect_interval_s=60, file_path=str(settings_path)
    )
    document = json.loads(settings_path.read_text(encoding="utf-8"))
    assert document["reconnect_interval_s"] == 60
    assert document["profiles"]["sta"]["ssid"] == "home-net"

    wifi_manager.save_wifi_profiles(profiles, file_path=str(settings_path))
    document = json.loads(settings_path.read_text(encoding="utf-8"))
    assert document["reconnect_interval_s"] == 60


class _RecordingAp:
    def __init__(self, *, reject_extras=False):
        self._active = False
        self._reject_extras = reject_extras
        self.config_calls = []

    def active(self, state=None):
        if state is None:
            return self._active
        self._active = bool(state)
        return self._active

    def config(self, **kwargs):
        self.config_calls.append(dict(kwargs))
        if self._reject_extras and ("channel" in kwargs or "max_clients" in kwargs):
            raise OSError("unsupported argument")
        return None

    def ifconfig(self):
        return ("192.168.4.1", "255.255.255.0", "192.168.4.1", "8.8.8.8")


class _FakeApNetwork(types.ModuleType):
    AP_IF = 1
    AUTH_OPEN = 0
    AUTH_WPA_WPA2_PSK = 3

    def __init__(self, ap):
        super().__init__("network")
        self._ap = ap

    def WLAN(self, mode):  # noqa: N802 - mirrors the firmware API name
        return self._ap


def test_load_wifi_profiles_defaults_ap_channel_and_max_clients(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = _write_settings(
        tmp_path / "wifi_settings.json",
        {
            "version": 2,
            "profiles": {
                "sta": {"enabled": False, "ssid": "", "password": ""},
                "ap": {"enabled": True, "ssid": "Boat-AP", "password": ""},
            },
        },
    )

    profiles = wifi_manager.load_wifi_profiles(file_path=str(settings_path))

    assert profiles["ap"]["channel"] == 6
    assert profiles["ap"]["max_clients"] == 4


def test_validate_profile_rejects_bad_ap_channel_and_max_clients():
    wifi_manager = _load_wifi_manager_module()

    with pytest.raises(wifi_manager.WifiSettingsError, match="channel"):
        wifi_manager._validate_profile(
            "ap",
            {"enabled": True, "ssid": "X", "password": "", "channel": 0, "max_clients": 4},
        )
    with pytest.raises(wifi_manager.WifiSettingsError, match="max clients"):
        wifi_manager._validate_profile(
            "ap",
            {"enabled": True, "ssid": "X", "password": "", "channel": 6, "max_clients": 9},
        )


def test_save_wifi_profiles_round_trips_ap_channel_and_max_clients(tmp_path):
    wifi_manager = _load_wifi_manager_module()
    settings_path = tmp_path / "wifi_settings.json"

    wifi_manager.save_wifi_profiles(
        {
            "ap": {
                "enabled": True,
                "ssid": "Boat-AP",
                "password": "",
                "channel": 11,
                "max_clients": 2,
            }
        },
        file_path=str(settings_path),
    )

    profiles = wifi_manager.load_wifi_profiles(file_path=str(settings_path))
    assert profiles["ap"]["channel"] == 11
    assert profiles["ap"]["max_clients"] == 2


def test_start_access_point_passes_channel_and_max_clients():
    ap = _RecordingAp()
    wifi_manager = _load_wifi_manager_module(network_module=_FakeApNetwork(ap))

    asyncio.run(wifi_manager.start_access_point(ap, "Boat-AP", ""))

    assert ap.config_calls
    assert ap.config_calls[0]["channel"] == 6
    assert ap.config_calls[0]["max_clients"] == 4


def test_start_access_point_falls_back_when_config_rejects_extras():
    ap = _RecordingAp(reject_extras=True)
    wifi_manager = _load_wifi_manager_module(network_module=_FakeApNetwork(ap))

    ipconfig = asyncio.run(wifi_manager.start_access_point(ap, "Boat-AP", ""))

    assert ipconfig == ("192.168.4.1", "255.255.255.0", "192.168.4.1", "8.8.8.8")
    assert ap.config_calls
    assert all(
        "channel" not in call and "max_clients" not in call for call in ap.config_calls[1:]
    )
