import sys
import types
from pathlib import Path

POWER_PKG = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "power"
    / "otter_power"
)
sys.path.insert(0, str(POWER_PKG))

# Stub `machine` before importing the battery module.
_machine = types.ModuleType("machine")


class _FakePin:
    def __init__(self, num):
        self.num = num


class _FakeADC:
    def __init__(self, pin):
        self._value = 0

    def atten(self, db):
        pass

    def read_u16(self):
        return self._value


_machine.Pin = _FakePin
_machine.ADC = _FakeADC
_machine.ADC.ATTN_11DB = 3
sys.modules["machine"] = _machine

from battery import BatteryMonitor  # noqa: E402


def test_battery_full_scale():
    mon = BatteryMonitor(adc_pin=1, top_k=100.0, bottom_k=22.0, cells=4,
                         warn_v_cell=3.4, cut_v_cell=3.1)
    mon._adc._value = 65535
    mon.update()
    assert abs(mon.voltage - 18.3) < 0.001
    assert mon.warn is False
    assert mon.low is False
    assert mon.critical is False


def test_battery_low_and_critical():
    mon = BatteryMonitor(adc_pin=1, top_k=100.0, bottom_k=22.0, cells=4,
                         warn_v_cell=3.4, cut_v_cell=3.1)
    target_v_adc = 12.0 / (122.0 / 22.0)
    mon._adc._value = int(target_v_adc / 3.3 * 65535)
    mon.update()
    assert abs(mon.voltage - 12.0) < 0.01
    assert mon.warn is True
    assert mon.low is True
    assert mon.critical is True


def test_battery_warn_only():
    mon = BatteryMonitor(adc_pin=1, top_k=100.0, bottom_k=22.0, cells=4,
                         warn_v_cell=3.4, cut_v_cell=3.1)
    target_v_adc = 13.0 / (122.0 / 22.0)
    mon._adc._value = int(target_v_adc / 3.3 * 65535)
    mon.update()
    assert abs(mon.voltage - 13.0) < 0.01
    assert mon.warn is True
    assert mon.low is False
    assert mon.critical is False
