"""Chain-level artifact checks for the lo-fi effects.

The unit tests in ``test_audio_dsp.py`` pin the per-effect arithmetic; these run
the effects inside an ``AudioChain`` (a source, the filters, a sink) so the
block-to-block state handling is exercised exactly as it is on the device.
"""

import array
import asyncio
import math
import sys
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

import bitcrusher  # noqa: E402
import downsampler  # noqa: E402
from audio_chain import AudioChain  # noqa: E402

RATE = 16000
BLOCK = 256


class ToneSource:
    """Replays a precomputed signal, block after block."""

    def __init__(self, samples):
        self.samples = samples
        self.pos = 0
        # AudioChain sizes its working buffers from the primary source's buffer.
        self.buffer = array.array('h', [0] * BLOCK)

    async def read_into(self, buf):
        n = len(buf)
        for i in range(n):
            buf[i] = self.samples[(self.pos + i) % len(self.samples)]
        self.pos += n
        return n * 2


class BlockSink:
    def __init__(self):
        self.blocks = []

    async def write(self, buf):
        self.blocks.append(list(buf))

    def flat(self):
        out = []
        for block in self.blocks:
            out.extend(block)
        return out


def _chain(samples, *filters):
    """Build a steady-state chain (startup gating disabled) around ``filters``."""
    chain = AudioChain()
    chain.warmup_blocks = 0
    chain.fade_in_blocks = 0
    chain.set_source(ToneSource(samples))
    for fx in filters:
        chain.add_filter(fx)
    sink = BlockSink()
    chain.set_sink(sink)
    return chain, sink


def _run(chain, blocks):
    for _ in range(blocks):
        asyncio.run(chain.run_block())


def _tone(freq, amp, length):
    return [int(amp * math.sin(2 * math.pi * freq * n / RATE)) for n in range(length)]


def _max_step(samples):
    return max(abs(samples[i + 1] - samples[i]) for i in range(len(samples) - 1))


def test_chain_bitcrusher_output_has_no_dc():
    # 1000 Hz at 16 kHz is exactly 16 cycles per block, so the source has zero DC.
    source = _tone(1000, 800, BLOCK)
    assert sum(source) == 0

    fx = bitcrusher.Bitcrusher()
    fx.bits = 10
    chain, sink = _chain(source, fx)
    _run(chain, 4)

    out = sink.flat()
    assert len(out) == 4 * BLOCK
    # Truncating `(v >> n) << n` biased every block by -460.8 counts.
    assert sum(out) == 0


def test_chain_downsampler_keeps_the_hold_grid_across_blocks():
    source = _tone(1777, 8000, 8 * BLOCK)

    for hold in (3, 5, 6, 7):
        reference = downsampler.Downsampler(rate=RATE, block_samples=8 * BLOCK)
        reference.hold = hold
        reference.antiAlias = False
        long_buf = array.array('h', source)
        reference.process(long_buf)

        fx = downsampler.Downsampler(rate=RATE, block_samples=BLOCK)
        fx.hold = hold
        fx.antiAlias = False
        chain, sink = _chain(source, fx)
        _run(chain, 8)

        assert sink.flat() == list(long_buf), f'hold={hold} restarted per block'


def test_chain_antialias_reduces_folded_energy():
    rate = RATE
    n = 8 * BLOCK
    source = [
        int(
            4000
            * (math.sin(2 * math.pi * 5000 * k / rate) + math.sin(2 * math.pi * 6000 * k / rate))
            / 2
        )
        for k in range(n)
    ]
    alias = 5000 - rate / 4 * round(5000 / (rate / 4))

    def folded_rms(anti_alias):
        fx = downsampler.Downsampler(rate=rate, block_samples=BLOCK)
        fx.hold = 4
        fx.antiAlias = anti_alias
        chain, sink = _chain(source, fx)
        _run(chain, 8)
        out = sink.flat()
        re = sum(out[i] * math.cos(2 * math.pi * alias * i / rate) for i in range(n))
        im = sum(out[i] * math.sin(2 * math.pi * alias * i / rate) for i in range(n))
        return math.hypot(re, im) / n

    raw = folded_rms(False)
    filtered = folded_rms(True)
    assert raw > 500
    assert filtered < raw * 0.32


def _blend_reference(dry, wet, switch_block):
    """Per-sample Q15 dry/wet blend for a chain that goes dry at ``switch_block``."""
    step = 32768 // 128
    cur = 32768
    target = 32768
    out = []
    for i in range(len(dry)):
        if i == switch_block * BLOCK:
            target = 0
        out.append(dry[i] + ((wet[i] - dry[i]) * cur >> 15))
        if cur < target:
            cur += step
            if cur > target:
                cur = target
        elif cur > target:
            cur -= step
            if cur < target:
                cur = target
    return out


def _bypass_toggle_trace(make, source, blocks=4):
    """Return (dry, wet, toggled) traces for one filter factory and one source."""
    chain, sink = _chain(source, make())
    _run(chain, blocks)
    wet = sink.flat()

    dry_fx = make()
    dry_fx.enabled = False
    chain, sink = _chain(source, dry_fx)
    _run(chain, blocks)
    dry = sink.flat()

    fx = make()
    chain, sink = _chain(source, fx)
    for block in range(blocks):
        fx.enabled = block < 2  # fade out at block 2, then stay dry
        asyncio.run(chain.run_block())
    return dry, wet, sink.flat()


def test_chain_bypass_toggle_fades_instead_of_stepping():
    # A triangle that moves by one count per sample: the only discontinuities in
    # the trace can come from the bypass switch itself.
    source = []
    for n in range(4 * BLOCK):
        pos = n % 16000
        source.append(pos if pos < 8000 else 16000 - pos)

    def crush():
        fx = bitcrusher.Bitcrusher()
        fx.bits = 14  # 16384-count grid: up to 8192 counts of dry/wet difference
        return fx

    dry, wet, toggled = _bypass_toggle_trace(crush, source)
    assert toggled != wet and toggled != dry

    expected = _blend_reference(dry, wet, 2)
    worst = max(abs(toggled[i] - expected[i]) for i in range(len(expected)))
    assert worst <= 2, f'bitcrusher bypass stepped by {worst} counts'
    # Disabled blocks are bit-exact dry.
    assert toggled[3 * BLOCK :] == dry[3 * BLOCK :]

    def hold():
        fx = downsampler.Downsampler(rate=RATE, block_samples=BLOCK)
        fx.hold = 64
        fx.antiAlias = False
        return fx

    dry, wet, toggled = _bypass_toggle_trace(hold, source)
    assert toggled != wet

    expected = _blend_reference(dry, wet, 2)
    worst = max(abs(toggled[i] - expected[i]) for i in range(len(expected)))
    assert worst <= 2, f'downsampler bypass stepped by {worst} counts'
    assert toggled[3 * BLOCK :] == dry[3 * BLOCK :]
