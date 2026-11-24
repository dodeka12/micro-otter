import importlib
import pathlib
import sys
import types

import pytest

STDMO_PKG_ROOT = pathlib.Path('src/micro_otter/nodes/device/node_pkgs/stdmo').resolve()


class _FakePWM:
    """Minimal machine.PWM stand-in; only the members Servo touches."""

    def __init__(self, pin, freq=50):
        self.pin = pin
        self._freq = freq

    def freq(self):
        return self._freq

    def duty_u16(self, value):
        self.duty = value


@pytest.fixture(scope='module')
def servo_callable():
    """Import the callable with fake machine/time modules and no real hardware."""
    fake_machine = types.ModuleType('machine')
    fake_machine.PWM = _FakePWM
    fake_machine.Pin = lambda number: number

    fake_time = types.ModuleType('time')
    ticks = [1000]

    def ticks_ms():
        ticks[0] += 1000
        return ticks[0]

    fake_time.ticks_ms = ticks_ms
    fake_time.ticks_diff = lambda later, earlier: later - earlier

    saved = {name: sys.modules.get(name) for name in ('machine', 'time')}
    sys.modules['machine'] = fake_machine
    sys.modules['time'] = fake_time
    sys.modules.pop('otter_stdmo.servo', None)
    sys.modules.pop('otter_stdmo.servo_callable', None)
    sys.path.insert(0, str(STDMO_PKG_ROOT))

    module = importlib.import_module('otter_stdmo.servo_callable')

    yield module

    sys.path.remove(str(STDMO_PKG_ROOT))
    sys.modules.pop('otter_stdmo.servo', None)
    sys.modules.pop('otter_stdmo.servo_callable', None)
    for name, value in saved.items():
        if value is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = value


def _recording_node(servo_callable, monkeypatch):
    """Build a node whose Servo.set_angle records calls instead of touching PWM."""
    calls = []

    def fake_set_angle(self, angle):
        calls.append(angle)

    monkeypatch.setattr(servo_callable.Servo, 'set_angle', fake_set_angle)
    return servo_callable.ServoNodeFn(controls={'pin': 4}), calls


def test_enabled_true_drives_the_servo(servo_callable, monkeypatch):
    node, calls = _recording_node(servo_callable, monkeypatch)

    assert node(True, 30.0) == 30.0
    assert calls == [30.0]


def test_enabled_false_skips_the_write_but_returns_the_angle(
    servo_callable, monkeypatch
):
    node, calls = _recording_node(servo_callable, monkeypatch)

    assert node(False, 30.0) == 30.0
    assert calls == []


def test_enabled_true_drives_the_servo_again(servo_callable, monkeypatch):
    node, calls = _recording_node(servo_callable, monkeypatch)

    assert node(True, 30.0) == 30.0
    assert calls == [30.0]
