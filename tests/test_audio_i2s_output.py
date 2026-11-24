import array
import asyncio
import sys
import types
from pathlib import Path

AUDIO_PKG = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "audio"
    / "otter_audio_viper"
)
sys.path.insert(0, str(AUDIO_PKG))

# Stub `machine` and `uasyncio` before importing i2s_output (which hard-imports both).
class _FakePin:
    OUT = 0

    def __init__(self, num, mode=None):
        self.num = num
        self.mode = mode
        self.values = []

    def value(self, value=None):
        if value is None:
            return self.values[-1] if self.values else None
        self.values.append(value)


class _FakeI2S:
    TX = 1
    RX = 0
    MONO = 0

    def __init__(self, i2s_id=0, **kwargs):
        self.i2s_id = i2s_id
        self.kwargs = kwargs


_machine = types.ModuleType('machine')
_machine.Pin = _FakePin
_machine.I2S = _FakeI2S
sys.modules['machine'] = _machine


class _FakeStreamWriter:
    def __init__(self, i2s):
        self.i2s = i2s
        self.writes = []
        self.drains = 0

    def write(self, buf):
        self.writes.append(list(buf))

    async def drain(self):
        self.drains += 1


_uasyncio = types.ModuleType('uasyncio')
_uasyncio.StreamWriter = _FakeStreamWriter
# Keep the stub usable by modules that import `uasyncio` themselves (e.g.
# `audio_chain`), so test collection order cannot break them.
_uasyncio.create_task = asyncio.create_task
_uasyncio.sleep = asyncio.sleep
_uasyncio.sleep_ms = lambda ms: asyncio.sleep(ms / 1000)
sys.modules['uasyncio'] = _uasyncio

from i2s_output import I2SOutput  # noqa: E402


def _make_output(**kwargs):
    out = I2SOutput(block_samples=4, sd_pin=12, **kwargs)
    out._writer = _FakeStreamWriter(out._i2s)
    return out


def test_output_starts_muted_and_unmutes_on_first_write():
    out = _make_output()
    assert out._sd.values == [0]
    assert out._amp_on is False

    asyncio.run(out.write(array.array('h', [0, 0, 0, 0])))

    assert out._sd.values == [0, 1]
    assert out._amp_on is True
    assert out._writer.drains == 1


def test_output_unmutes_only_once():
    out = _make_output()
    for _ in range(3):
        asyncio.run(out.write(array.array('h', [1, 2, 3, 4])))
    assert out._sd.values == [0, 1]
    assert out._writer.drains == 3


def test_output_disabled_write_keeps_amplifier_muted():
    out = _make_output()
    out.enabled = False
    asyncio.run(out.write(array.array('h', [1, 2, 3, 4])))
    assert out._sd.values == [0]
    assert out._writer.writes == []
    assert out._writer.drains == 0


def test_output_mute_and_enable_drive_shutdown_pin():
    out = _make_output()
    asyncio.run(out.write(array.array('h', [1, 2, 3, 4])))
    out.mute()
    assert out.enabled is False
    assert out._sd.values == [0, 1, 0]

    out.enable()
    assert out.enabled is True
    assert out._sd.values == [0, 1, 0, 1]


def test_output_without_sd_pin_is_a_noop():
    out = I2SOutput(block_samples=4)
    out._writer = _FakeStreamWriter(out._i2s)
    assert out._sd is None
    asyncio.run(out.write(array.array('h', [1, 2, 3, 4])))
    assert out._amp_on is True
    assert out._writer.writes == [[1, 2, 3, 4]]


def test_output_gain_pin_follows_gain_high():
    out = _make_output(gain_pin=13)
    assert out._gain.values == [1]
    out.gain_high = False
    assert out._gain.values == [1, 0]
    out.gain_high = True
    assert out._gain.values == [1, 0, 1]
