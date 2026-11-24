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

# Stub `machine` and `uasyncio` before importing i2s_input (which hard-imports both).
_machine = types.ModuleType('machine')


class _FakePin:
    def __init__(self, num):
        self.num = num


class _FakeI2S:
    RX = 0
    MONO = 0

    def __init__(self, i2s_id=0, **kwargs):
        self.i2s_id = i2s_id


_machine.Pin = _FakePin
_machine.I2S = _FakeI2S
sys.modules['machine'] = _machine

_uasyncio = types.ModuleType('uasyncio')


class _FakeStreamReader:
    def __init__(self, i2s):
        self.i2s = i2s
        # Queue of samples to deliver per readinto call; empty means "return 0".
        self.chunks = []
        self.calls = []

    async def readinto(self, mv):
        self.calls.append(len(mv))
        if not self.chunks:
            return 0
        n = min(self.chunks.pop(0), len(mv))
        for i in range(n):
            mv[i] = 1
        return n * 2


_uasyncio.StreamReader = _FakeStreamReader
# Keep the stub usable by modules that import `uasyncio` themselves (e.g.
# `audio_chain`), so test collection order cannot break them.
_uasyncio.create_task = asyncio.create_task
_uasyncio.sleep = asyncio.sleep
_uasyncio.sleep_ms = lambda ms: asyncio.sleep(ms / 1000)
sys.modules['uasyncio'] = _uasyncio

from i2s_input import I2SInput  # noqa: E402


def _make_input(block_samples=4):
    src = I2SInput(block_samples=block_samples)
    src._reader = _FakeStreamReader(src._i2s)
    return src


def test_read_into_accumulates_partial_reads():
    src = _make_input(block_samples=4)
    src._reader.chunks = [2, 2]
    buf = array.array('h', [0, 0, 0, 0])
    got = asyncio.run(src.read_into(buf))
    assert got == 8
    assert list(buf) == [1, 1, 1, 1]


def test_read_into_zero_fills_tail_after_partial_then_empty():
    src = _make_input(block_samples=4)
    src._reader.chunks = [1, 0]
    buf = array.array('h', [9, 9, 9, 9])
    got = asyncio.run(src.read_into(buf))
    assert list(buf) == [1, 0, 0, 0]
    assert got == 2
    assert src.short_reads == 1


def test_read_into_reuses_memoryview_across_alternating_buffers():
    src = _make_input(block_samples=4)
    src._reader.chunks = [4, 4, 4]
    a = array.array('h', [0] * 4)
    b = array.array('h', [0] * 4)

    asyncio.run(src.read_into(a))
    mv_a = src._mv0
    asyncio.run(src.read_into(b))
    assert src._mv1 is mv_a  # a's view slid to the second slot
    asyncio.run(src.read_into(a))
    assert src._mv1 is mv_a  # a's view reused, not recreated
    assert src._mv0 is not src._mv1


def test_read_into_disabled_zeroes_and_clears_level():
    src = _make_input(block_samples=2)
    src.enabled = False
    buf = array.array('h', [9, 9])
    got = asyncio.run(src.read_into(buf))
    assert got == 0
    assert list(buf) == [0, 0]
    assert src.level == 0.0


def test_read_into_returns_bytes_read():
    src = _make_input(block_samples=4)
    src._reader.chunks = [3, 0]
    buf = array.array('h', [0] * 4)
    got = asyncio.run(src.read_into(buf))
    assert got == 6
