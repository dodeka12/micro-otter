import array
import asyncio
import math
import sys
from pathlib import Path

import pytest

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

import audio_chain  # noqa: E402
import bitcrusher  # noqa: E402
import downsampler  # noqa: E402
import filter  # noqa: E402
import gain  # noqa: E402
import noise  # noqa: E402
import oscillator  # noqa: E402
import overdrive  # noqa: E402
import pitch_shifter  # noqa: E402
import ring_mod  # noqa: E402
import square_fuzz  # noqa: E402
from audio_chain import AudioChain  # noqa: E402


def test_overdrive_clamps():
    fx = overdrive.Overdrive()
    fx.drive = 40
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert list(buf) == [32767, -32768, 32767, -32768]


def test_overdrive_unity_at_zero_db():
    fx = overdrive.Overdrive()
    fx.drive = 0
    buf = array.array('h', [1000, -1000])
    fx.process(buf)
    assert list(buf) == [1000, -1000]


def test_overdrive_drive_db_scales():
    fx = overdrive.Overdrive()
    fx.drive = 6
    buf = array.array('h', [1000, 30000])
    fx.process(buf)
    assert 1900 <= buf[0] <= 2100
    assert buf[1] == 32767


def test_bitcrusher_defaults():
    fx = bitcrusher.Bitcrusher()
    assert fx.bits == 4
    assert fx.mix == 1.0
    assert fx.enabled is True


def test_bitcrusher_rounds_to_the_nearest_step():
    fx = bitcrusher.Bitcrusher()
    fx.bits = 8
    buf = array.array('h', [0x1234, 0x12AB, 0x127F, 0x1280])
    fx.process(buf)
    # 0x1234 sits on the grid, 0x12AB rounds up, and a tie rounds up.
    assert list(buf) == [0x1200, 0x1300, 0x1200, 0x1300]


def test_bitcrusher_is_sign_symmetric():
    fx = bitcrusher.Bitcrusher()
    fx.bits = 8
    buf = array.array('h', [1, -1, 255, -255, 256, -256, 32767, -32768])
    fx.process(buf)
    assert list(buf) == [0, 0, 256, -256, 256, -256, 32767, -32768]


def test_bitcrusher_symmetric_input_keeps_zero_dc():
    # 1000 Hz at 16 kHz is exactly 16 cycles per 256-sample block: input DC == 0.
    sig = [int(800 * math.sin(2 * math.pi * 1000 * n / 16000)) for n in range(256)]
    assert sum(sig) == 0

    for bits in (4, 8, 10, 12):
        fx = bitcrusher.Bitcrusher()
        fx.bits = bits
        buf = array.array('h', sig)
        fx.process(buf)
        # Truncating `(v >> n) << n` left a -460.8 DC offset at bits=10.
        assert sum(buf) == 0, f'bits={bits} introduced a DC offset'


def test_bitcrusher_default_is_audible_but_crushed():
    fx = bitcrusher.Bitcrusher()
    buf = array.array('h', list(range(-16000, 16000, 32)))
    fx.process(buf)
    # Four dropped bits put every sample on a 16-count grid.
    assert all(v % 16 == 0 for v in buf)
    assert len(set(buf)) > 2


def test_bitcrusher_max_drop_is_not_silent():
    fx = bitcrusher.Bitcrusher()
    fx.bits = 15
    buf = array.array('h', [32767, -32768, 1, -1, 0])
    fx.process(buf)
    assert list(buf) == [32767, -32768, 0, 0, 0]


def test_bitcrusher_clamps_bits_to_1_15():
    fx = bitcrusher.Bitcrusher()

    fx.bits = 0
    buf = array.array('h', [0x1235])
    fx.process(buf)
    assert buf[0] == 0x1236  # drop clamped to 1: nearest even count

    fx.bits = 99.0
    buf = array.array('h', [0x1235, -1, 32767])
    fx.process(buf)
    assert buf[0] == 0  # drop clamped to 15
    assert buf[1] == 0
    assert buf[2] == 32767


def test_bitcrusher_mix_zero_is_bit_exact_pass_through():
    fx = bitcrusher.Bitcrusher()
    fx.bits = 8
    fx.mix = 0.0
    buf = array.array('h', [1234, -4321, 30000, -30000, 0, 32767, -32768])
    fx.process(buf)
    assert list(buf) == [1234, -4321, 30000, -30000, 0, 32767, -32768]


def test_bitcrusher_mix_blends_dry_and_crushed():
    wet = array.array('h', [4660, -4660])
    fx = bitcrusher.Bitcrusher()
    fx.bits = 8
    fx.process(wet)
    assert list(wet) == [0x1200, -0x1200]

    fx = bitcrusher.Bitcrusher()
    fx.bits = 8
    fx.mix = 0.5
    half = array.array('h', [4660, -4660])
    fx.process(half)
    # Exactly half-way from the dry sample (4660) to the crushed one (4608).
    assert list(half) == [4634, -4634]


def test_bitcrusher_enabled_fades_instead_of_stepping():
    sig = [int(20000 * math.sin(2 * math.pi * 1000 * n / 16000)) for n in range(256)]
    fx = bitcrusher.Bitcrusher()
    fx.bits = 8
    wet = array.array('h', sig)
    fx.process(wet)
    wet = list(wet)
    assert wet != sig

    fx.enabled = False
    off = array.array('h', sig)
    fx.process(off)
    assert off[0] == wet[0]  # the fade starts at the wet signal...
    assert off[-1] == sig[-1]  # ...and ends bit-exact dry

    fx.enabled = True
    on = array.array('h', sig)
    fx.process(on)
    assert on[0] == sig[0]  # the fade-in starts dry...
    assert on[-1] == wet[-1]  # ...and is complete inside one block

    sig_step = max(abs(sig[i + 1] - sig[i]) for i in range(len(sig) - 1))
    for buf in (off, on):
        step = max(abs(buf[i + 1] - buf[i]) for i in range(len(buf) - 1))
        assert step <= sig_step + 512  # one ramp step at most, i.e. no click



def test_square_fuzz_squares_proportional_to_input():
    fx = square_fuzz.SquareFuzz()
    buf = array.array('h', [20000, -20000, 5, -5, 0])
    fx.process(buf)
    assert buf[0] > 0
    assert buf[1] < 0
    assert buf[2] > 0
    assert buf[3] < 0
    assert abs(buf[0]) < 32768


def test_square_fuzz_silence_stays_silent():
    fx = square_fuzz.SquareFuzz()
    buf = array.array('h', [0] * 256)
    fx.process(buf)
    assert all(v == 0 for v in buf)


def test_square_fuzz_does_not_amplify_quiet_input():
    fx = square_fuzz.SquareFuzz()
    for _ in range(4):
        buf = array.array('h', [10, -10] * 128)
        fx.process(buf)
        assert all(abs(v) <= 32 for v in buf)


def test_square_fuzz_envelope_follow_off_binarizes():
    fx = square_fuzz.SquareFuzz()
    fx.level = 0
    fx.mix = 1.0
    fx.envelopeFollow = False
    buf = array.array('h', [5, -5, 0])
    fx.process(buf)
    assert list(buf) == [32767, -32767, 32767]


def test_square_fuzz_level_attenuates_snapped_output():
    fx = square_fuzz.SquareFuzz()
    fx.level = -6.0
    fx.mix = 1.0
    fx.envelopeFollow = False
    buf = array.array('h', [32767, -32768, 0])
    fx.process(buf)
    assert 16000 <= buf[0] <= 17000
    assert buf[1] == -buf[0]
    assert buf[2] == buf[0]


def test_square_fuzz_level_envelope_follow_scales():
    fx = square_fuzz.SquareFuzz()
    fx.level = -6.0
    fx.mix = 1.0
    for _ in range(12):
        buf = array.array('h', [20000, -20000] * 128)
        fx.process(buf)
    assert 8500 <= abs(buf[0]) <= 11000


def test_square_fuzz_level_keeps_silence_silent():
    fx = square_fuzz.SquareFuzz()
    fx.level = 0.0
    buf = array.array('h', [0] * 256)
    fx.process(buf)
    assert all(v == 0 for v in buf)


def test_square_fuzz_level_clamps_to_db_range():
    fx = square_fuzz.SquareFuzz()
    fx.mix = 1.0
    fx.envelopeFollow = False

    fx.level = 6.0
    buf = array.array('h', [32767, -32768, 0])
    fx.process(buf)
    assert list(buf) == [32767, -32767, 32767]

    fx.level = -200.0
    buf = array.array('h', [32767, -32768, 0])
    fx.process(buf)
    assert buf[0] <= 32
    assert buf[1] >= -32


def test_square_fuzz_mix_zero_is_bit_exact_pass_through():
    fx = square_fuzz.SquareFuzz()
    fx.mix = 0.0
    fx.envelopeFollow = False
    buf = array.array('h', [1234, -4321, 30000, -30000, 0])
    fx.process(buf)
    assert list(buf) == [1234, -4321, 30000, -30000, 0]


def test_square_fuzz_mix_blends_dry_and_square():
    fx = square_fuzz.SquareFuzz()
    fx.level = 0.0
    fx.envelopeFollow = False
    fx.mix = 1.0
    full = array.array('h', [10000, -10000])
    fx.process(full)
    assert list(full) == [32767, -32767]

    fx = square_fuzz.SquareFuzz()
    fx.level = 0.0
    fx.envelopeFollow = False
    fx.mix = 0.5
    half = array.array('h', [10000, -10000])
    fx.process(half)
    # Half-way between the dry sample and the full square wave.
    assert 10000 < half[0] < 32767
    assert half[1] == -half[0]


def test_square_fuzz_mix_clamps_to_unit_range():
    fx = square_fuzz.SquareFuzz()
    fx.level = 0.0
    fx.envelopeFollow = False
    fx.mix = -1.0
    buf = array.array('h', [10000, -10000])
    fx.process(buf)
    assert list(buf) == [10000, -10000]

    fx = square_fuzz.SquareFuzz()
    fx.level = 0.0
    fx.envelopeFollow = False
    fx.mix = 2.0
    buf = array.array('h', [10000, -10000])
    fx.process(buf)
    assert list(buf) == [32767, -32767]


def test_square_fuzz_default_mix_softens_the_square():
    fx = square_fuzz.SquareFuzz()
    assert fx.mix == 0.5
    fx.level = 0.0
    fx.envelopeFollow = False
    buf = array.array('h', [12000, -12000])
    fx.process(buf)
    # Louder than the dry input, but well short of a full square wave.
    assert 12000 < abs(buf[0]) < 32767


def test_square_fuzz_level_scales_only_the_wet_share():
    def run(level):
        fx = square_fuzz.SquareFuzz()
        fx.level = level
        fx.envelopeFollow = False
        fx.mix = 0.5
        buf = array.array('h', [10000, -10000])
        fx.process(buf)
        return list(buf)

    loud = run(0.0)
    quiet = run(-6.0)
    # mix 0.5 keeps half of the 10000-count dry sample in both cases; only the
    # squared part follows `level`.
    assert 21370 <= loud[0] <= 21400
    assert 13200 <= quiet[0] <= 13220
    assert quiet[0] < loud[0]
    assert quiet[1] == -quiet[0]


def test_square_fuzz_enabled_fades_instead_of_stepping():
    sig = [int(20000 * math.sin(2 * math.pi * 1000 * n / 16000)) for n in range(256)]
    fx = square_fuzz.SquareFuzz()
    fx.level = 0.0
    fx.mix = 1.0
    fx.envelopeFollow = False
    wet = array.array('h', sig)
    fx.process(wet)
    wet = list(wet)
    assert wet != sig

    fx.enabled = False
    off = array.array('h', sig)
    fx.process(off)

    fx.enabled = True
    on = array.array('h', sig)
    fx.process(on)

    # Every sample must be the Q15 blend of dry and fully-wet at the ramp
    # position of that sample: a hard switch would jump straight to the target.
    step = fx._mix_ramp.step
    for i in range(len(sig)):
        down = 32768 - i * step
        if down < 0:
            down = 0
        assert abs(off[i] - (sig[i] + ((wet[i] - sig[i]) * down >> 15))) <= 2
        up = i * step
        if up > 32768:
            up = 32768
        assert abs(on[i] - (sig[i] + ((wet[i] - sig[i]) * up >> 15))) <= 2

    assert off[-1] == sig[-1]  # the fade-out is complete within one block
    assert on[-1] == wet[-1]  # and so is the fade-in


def test_ring_mod_depth_zero_passes_through():
    fx = ring_mod.RingMod(rate=16000, block_samples=256)
    fx.depth = 0.0
    buf = array.array('h', [1000, -1000, 30000, -30000, 0])
    fx.process(buf)
    assert list(buf) == [1000, -1000, 30000, -30000, 0]


def test_ring_mod_dc_input_produces_carrier():
    fx = ring_mod.RingMod(rate=16000, block_samples=256)
    fx.frequency = 1000.0
    fx.depth = 1.0
    buf = array.array('h', [10000] * 256)
    fx.process(buf)
    assert max(buf) == 10000
    assert min(buf) == -10000
    crossings = sum(1 for i in range(1, 256) if (buf[i - 1] < 0) != (buf[i] < 0))
    assert crossings >= 30


def test_ring_mod_sidebands_only():
    rate = 16000
    fx = ring_mod.RingMod(rate=rate, block_samples=2048)
    fx.frequency = 1500.0
    fx.depth = 1.0
    sig = array.array(
        'h', [int(8000 * math.sin(2 * math.pi * 500 * n / rate)) for n in range(2048)]
    )
    fx.process(sig)

    def mag(buf, freq):
        re = sum(buf[n] * math.cos(2 * math.pi * freq * n / rate) for n in range(2048))
        im = sum(buf[n] * math.sin(2 * math.pi * freq * n / rate) for n in range(2048))
        return math.hypot(re, im)

    assert mag(sig, 500) < 100000  # input frequency suppressed
    assert mag(sig, 1500) < 100000  # carrier suppressed
    assert mag(sig, 1000) > 3000000  # lower sideband present
    assert mag(sig, 2000) > 3000000  # upper sideband present


def test_ring_mod_silence_stays_silent():
    fx = ring_mod.RingMod(rate=16000, block_samples=64)
    buf = array.array('h', [0] * 64)
    fx.process(buf)
    assert all(v == 0 for v in buf)


def test_ring_mod_full_scale_stays_in_int16():
    fx = ring_mod.RingMod(rate=16000, block_samples=256)
    fx.frequency = 1000.0
    fx.depth = 1.0
    buf = array.array('h', [-32768] * 256)
    fx.process(buf)
    assert all(-32768 <= v <= 32767 for v in buf)
    assert min(buf) == -32768
    assert max(buf) == 32767


def test_ring_mod_depth_half_is_amplitude_modulation():
    fx = ring_mod.RingMod(rate=16000, block_samples=256)
    fx.frequency = 1000.0
    fx.depth = 0.5
    buf = array.array('h', [10000] * 256)
    fx.process(buf)
    assert 0 <= min(buf)
    assert max(buf) == 10000


def test_ring_mod_phase_continues_across_blocks():
    direct = ring_mod.RingMod(rate=16000, block_samples=512)
    direct.frequency = 220.0
    long_buf = array.array('h', [5000] * 512)
    direct.process(long_buf)

    fx = ring_mod.RingMod(rate=16000, block_samples=256)
    fx.frequency = 220.0
    b1 = array.array('h', [5000] * 256)
    fx.process(b1)
    b2 = array.array('h', [5000] * 256)
    fx.process(b2)

    assert list(b1) + list(b2) == list(long_buf)


def test_ring_mod_disabled_passes_through():
    fx = ring_mod.RingMod(rate=16000, block_samples=64)
    fx.enabled = False
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert list(buf) == [1000, -1000, 30000, -30000]


def test_downsampler_defaults():
    fx = downsampler.Downsampler()
    assert fx.hold == 4
    assert fx.mix == 1.0
    assert fx.antiAlias is True
    assert fx.rate == 16000
    assert fx.enabled is True


def test_downsampler_holds():
    fx = downsampler.Downsampler()
    fx.antiAlias = False
    fx.hold = 2
    buf = array.array('h', [1, 2, 3, 4, 5])
    fx.process(buf)
    assert list(buf) == [1, 1, 3, 3, 5]


def test_downsampler_edge_cases():
    fx = downsampler.Downsampler()
    fx.antiAlias = False

    fx.hold = 1
    buf = array.array('h', [1, 2, 3, 4])
    fx.process(buf)
    assert list(buf) == [1, 2, 3, 4]

    fx.hold = 10
    buf = array.array('h', [7, 2, 3, 4, 5])
    fx.process(buf)
    assert list(buf) == [7, 7, 7, 7, 7]

    fx.hold = 0
    buf = array.array('h', [1, 2, 3])
    fx.process(buf)
    assert list(buf) == [1, 2, 3]  # clamped to hold == 1


def test_downsampler_hold_phase_spans_block_boundaries():
    rate = 16000
    sig = [int(8000 * math.sin(2 * math.pi * 1777 * n / rate)) for n in range(1536)]
    for hold in (2, 3, 5, 6, 7):
        direct = downsampler.Downsampler(rate=rate, block_samples=1536)
        direct.hold = hold
        direct.antiAlias = False
        long_buf = array.array('h', sig)
        direct.process(long_buf)

        fx = downsampler.Downsampler(rate=rate, block_samples=256)
        fx.hold = hold
        fx.antiAlias = False
        blocks = []
        for start in range(0, 1536, 256):
            buf = array.array('h', sig[start : start + 256])
            fx.process(buf)
            blocks.extend(buf)

        # A per-block `i % hold` reset broke every hold that does not divide 256.
        assert blocks == list(long_buf), f'hold={hold} restarted its phase per block'


def test_downsampler_hold_is_clamped_to_the_block_length():
    fx = downsampler.Downsampler()
    fx.antiAlias = False
    fx.hold = 300
    buf = array.array('h', [100, 200] * 128)
    fx.process(buf)
    # One capture per block instead of a full-scale block-rate square wave.
    assert set(buf) == {100}
    assert fx.hold == 300  # the control keeps its value


def test_downsampler_mix_zero_is_bit_exact_pass_through():
    fx = downsampler.Downsampler()
    fx.hold = 8
    fx.mix = 0.0
    buf = array.array('h', [1234, -4321, 30000, -30000, 0, 7, -9, 11])
    fx.process(buf)
    assert list(buf) == [1234, -4321, 30000, -30000, 0, 7, -9, 11]


def test_downsampler_mix_blends_dry_and_held():
    sig = [1000, 5000, 9000, 13000] * 2

    fx = downsampler.Downsampler()
    fx.antiAlias = False
    fx.hold = 4
    fx.mix = 0.5
    half = array.array('h', sig)
    fx.process(half)
    # Held value is 1000 throughout; each sample sits half-way to it.
    assert list(half) == [1000, 3000, 5000, 7000, 1000, 3000, 5000, 7000]


def test_downsampler_antialias_reduces_folded_energy():
    rate = 16000
    n = 4096
    hf = [
        int(
            4000
            * (math.sin(2 * math.pi * 5000 * k / rate) + math.sin(2 * math.pi * 6000 * k / rate))
            / 2
        )
        for k in range(n)
    ]

    def folded_rms(anti_alias):
        fx = downsampler.Downsampler(rate=rate, block_samples=n)
        fx.hold = 4
        fx.antiAlias = anti_alias
        buf = array.array('h', hf)
        fx.process(buf)
        alias = 5000 - rate / 4 * round(5000 / (rate / 4))  # folded to 1000 Hz
        re = sum(buf[i] * math.cos(2 * math.pi * alias * i / rate) for i in range(n))
        im = sum(buf[i] * math.sin(2 * math.pi * alias * i / rate) for i in range(n))
        return math.hypot(re, im) / n

    raw = folded_rms(False)
    filtered = folded_rms(True)
    assert raw > 500
    assert filtered < raw * 0.32  # at least 10 dB less folded energy


def test_downsampler_antialias_off_matches_the_raw_hold():
    rate = 16000
    sig = [int(8000 * math.sin(2 * math.pi * 1777 * n / rate)) for n in range(512)]
    fx = downsampler.Downsampler(rate=rate, block_samples=512)
    fx.hold = 5
    fx.antiAlias = False
    buf = array.array('h', sig)
    fx.process(buf)
    assert list(buf) == [sig[i - (i % 5)] for i in range(512)]


def test_downsampler_antialias_is_skipped_for_hold_one():
    fx = downsampler.Downsampler()
    fx.hold = 1
    buf = array.array('h', [1234, -4321, 30000, -30000, 0])
    fx.process(buf)
    assert list(buf) == [1234, -4321, 30000, -30000, 0]


def test_downsampler_antialias_coefficient_is_clamped_and_tracks_hold():
    shallow = downsampler._aa_coeff(16000, 2)
    steep = downsampler._aa_coeff(16000, 8)
    steeper = downsampler._aa_coeff(16000, 64)
    assert 1 <= steeper < steep < shallow <= 32767
    assert shallow == 25956


def test_downsampler_hold_change_keeps_the_phase_in_range():
    fx = downsampler.Downsampler()
    fx.antiAlias = False
    fx.hold = 8
    buf = array.array('h', [1000] * 256)
    fx.process(buf)
    assert fx._phase < 8

    fx.hold = 3
    buf = array.array('h', [1000] * 8)
    fx.process(buf)
    assert 0 <= fx._phase < 3


def test_downsampler_enabled_fades_instead_of_stepping():
    sig = [int(20000 * math.sin(2 * math.pi * 1000 * n / 16000)) for n in range(256)]
    fx = downsampler.Downsampler()
    fx.antiAlias = False
    fx.hold = 8
    wet = array.array('h', sig)
    fx.process(wet)
    wet = list(wet)
    assert wet != sig

    fx.enabled = False
    off = array.array('h', sig)
    fx.process(off)
    assert off[0] == wet[0]
    assert off[-1] == sig[-1]

    fx.enabled = True
    on = array.array('h', sig)
    fx.process(on)
    assert on[0] == sig[0]
    assert on[-1] == wet[-1]

    sig_step = max(abs(sig[i + 1] - sig[i]) for i in range(len(sig) - 1))
    for buf in (off, on):
        step = max(abs(buf[i + 1] - buf[i]) for i in range(len(buf) - 1))
        assert step <= sig_step + 512



def test_gain_scales_and_clamps():
    fx = gain.Gain()
    fx.volume = 6
    buf = array.array('h', [1000, 30000])
    fx.process(buf)
    assert 1900 <= buf[0] <= 2100
    assert buf[1] == 32767


def test_gain_db_curve():
    fx = gain.Gain()

    fx.volume = 0
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert list(buf) == [1000, -1000, 30000, -30000]

    fx.volume = 6
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert 1900 <= buf[0] <= 2100
    assert -2100 <= buf[1] <= -1900
    assert buf[2] == 32767
    assert buf[3] == -32768

    fx.volume = -6
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert 450 <= buf[0] <= 550
    assert -550 <= buf[1] <= -450
    assert 14500 <= buf[2] <= 15500
    assert -15500 <= buf[3] <= -14500


def test_pitch_shifter_bypass_at_zero():
    fx = pitch_shifter.PitchShifter()
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert list(buf) == [1000, -1000, 30000, -30000]


def test_filter_removes_dc():
    fx = filter.Filter()
    for _ in range(8):
        buf = array.array('h', [1000] * 256)
        fx.process(buf)
    assert all(abs(v) < 100 for v in buf)


def test_filter_band_pass():
    fx = filter.Filter()
    n = 256
    for _ in range(12):
        buf = array.array(
            'h', [round(10000 * math.sin(2 * math.pi * 1000 * i / 16000)) for i in range(n)]
        )
        fx.process(buf)
    rms_mid = math.sqrt(sum(v * v for v in buf) / n)
    for _ in range(12):
        buf = array.array(
            'h', [round(10000 * math.sin(2 * math.pi * 8000 * i / 16000)) for i in range(n)]
        )
        fx.process(buf)
    rms_high = math.sqrt(sum(v * v for v in buf) / n)
    assert rms_mid > 3000
    assert rms_high < rms_mid * 0.5


def test_filter_disabled_bypasses():
    fx = filter.Filter()
    fx.enabled = False
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert list(buf) == [1000, -1000, 30000, -30000]


def test_noise_default_passes_through():
    fx = noise.Noise()
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert list(buf) == [1000, -1000, 30000, -30000]


def test_noise_adds_signal_and_preserves_length():
    fx = noise.Noise()
    fx.level = 0
    buf = array.array('h', [10000] * 256)
    fx.process(buf)
    assert len(buf) == 256
    assert any(v != 10000 for v in buf)


def test_noise_level_is_relative_to_input():
    fx = noise.Noise()
    fx.level = -20
    loud = array.array('h', [20000] * 256)
    fx.process(loud)
    # Static is a small fraction of the voice level, not full scale.
    assert all(15000 <= v <= 25000 for v in loud)


def test_noise_envelope_follow_off_is_absolute():
    fx = noise.Noise()
    fx.level = -20
    fx.envelopeFollow = False
    quiet = array.array('h', [100] * 256)
    fx.process(quiet)
    # Absolute mode: static is fixed relative to full scale, dominating quiet input.
    assert any(abs(v) > 1000 for v in quiet)


def test_noise_disabled_bypasses():
    fx = noise.Noise()
    fx.level = 0
    fx.enabled = False
    buf = array.array('h', [1000, -1000])
    fx.process(buf)
    assert list(buf) == [1000, -1000]


def test_noise_gate_threshold():
    fx = noise.Noise()
    fx.level = 0
    fx.threshold = -20

    for _ in range(20):
        quiet = array.array('h', [0] * 256)
        fx.process(quiet)
    assert all(v == 0 for v in quiet)

    for _ in range(20):
        loud = array.array('h', [20000] * 256)
        fx.process(loud)
    assert any(v != 20000 for v in loud)


def test_noise_gate_opens_quickly():
    fx = noise.Noise()
    fx.level = 0
    fx.threshold = -10

    # The gate should be clearly open (some samples changed) within a few blocks
    # of sustained loud input; it must not take hundreds of ms to come up.
    for _ in range(4):
        loud = array.array('h', [20000] * 256)
        fx.process(loud)
    assert any(v != 20000 for v in loud)


def test_noise_gate_closes_after_silence():
    fx = noise.Noise()
    fx.level = 0
    fx.threshold = -10

    for _ in range(8):
        loud = array.array('h', [20000] * 256)
        fx.process(loud)
    assert any(v != 20000 for v in loud)

    # After input drops to silence the gate must close (return to pass-through)
    # within a bounded number of blocks rather than lingering for seconds.
    closed_after = None
    for i in range(64):
        quiet = array.array('h', [0] * 256)
        fx.process(quiet)
        if all(v == 0 for v in quiet):
            closed_after = i
            break
    assert closed_after is not None


def test_pitch_shifter_disabled_bypasses():
    fx = pitch_shifter.PitchShifter()
    fx.semitones = 12.0
    fx.enabled = False
    buf = array.array('h', [1000, -1000])
    fx.process(buf)
    assert list(buf) == [1000, -1000]


def test_pitch_shifter_shifts_signal():
    fx = pitch_shifter.PitchShifter(delay_samples=512)
    fx.semitones = 12.0
    n = 256
    last_input = None
    for _ in range(8):
        buf = array.array(
            'h', [round(10000 * math.sin(2 * math.pi * 440 * i / 16000)) for i in range(n)]
        )
        last_input = list(buf)
        fx.process(buf)
    assert any(v != 0 for v in buf)
    assert list(buf) != last_input


class FakeSource:
    def __init__(self, buf):
        self.buffer = buf
        self.reads = 0

    async def read(self):
        self.reads += 1


class FakeSink:
    def __init__(self):
        self.writes = 0
        self.blocks = []

    async def write(self, buf):
        self.writes += 1
        self.blocks.append(list(buf))


def _steady_chain():
    """Build an AudioChain with startup gating disabled (steady-state pipeline tests)."""
    chain = AudioChain()
    chain.warmup_blocks = 0
    chain.fade_in_blocks = 0
    return chain


def test_audio_chain_startup_writes_silence_and_skips_filters():
    src = FakeSource(array.array('h', [1234, -2345, 3456]))
    sink = FakeSink()
    chain = AudioChain()
    chain.set_source(src)
    chain.set_sink(sink)

    seen = []
    chain.add_filter(type('F', (), {'process': lambda self, b: seen.append(list(b))})())

    for _ in range(chain.warmup_blocks):
        asyncio.run(chain.run_block())

    assert chain.warmup_blocks >= 1
    # Filters never see the stale power-on data, and the sink gets silence.
    assert seen == []
    assert sink.writes == chain.warmup_blocks
    assert all(v == 0 for block in sink.blocks for v in block)


def test_audio_chain_fades_in_from_silence_to_full_scale():
    level = 20000
    src = FakeSource(array.array('h', [level] * 4))
    sink = FakeSink()
    chain = AudioChain()
    chain.set_source(src)
    chain.set_sink(sink)

    for _ in range(chain.warmup_blocks + chain.fade_in_blocks + 1):
        asyncio.run(chain.run_block())

    fade_blocks = sink.blocks[chain.warmup_blocks:chain.warmup_blocks + chain.fade_in_blocks]
    fade_samples = [v for block in fade_blocks for v in block]
    assert fade_samples[0] == 0
    assert fade_samples == sorted(fade_samples)
    assert 0 < fade_samples[-1] < level
    # The block after the fade window is back at unity gain.
    assert sink.blocks[chain.warmup_blocks + chain.fade_in_blocks] == [level] * 4


def test_audio_chain_warmup_keeps_double_buffer_pipeline():
    src = FakeSource(array.array('h', [5, -5]))
    sink = FakeSink()
    chain = AudioChain()
    chain.set_source(src)
    chain.set_sink(sink)

    for _ in range(3):
        asyncio.run(chain.run_block())

    # One priming read plus one prefetch per block, regardless of gating.
    assert src.reads == 4
    assert sink.writes == 3


class FlakySource:
    """Primary source whose Nth read (1-based) raises."""

    def __init__(self, buf):
        self.buffer = buf
        self.reads = 0
        self.fail_on_read = None

    async def read_into(self, buf):
        self.reads += 1
        if self.reads == self.fail_on_read:
            raise RuntimeError('boom')
        for i in range(len(buf)):
            buf[i] = 1
        return len(buf) * 2


class ShortReadSource:
    """Primary source that returns one sample short of a full block."""

    def __init__(self, buf):
        self.buffer = buf
        self.reads = 0

    async def read_into(self, buf):
        self.reads += 1
        for i in range(len(buf)):
            buf[i] = 1
        return (len(buf) - 1) * 2


def test_audio_chain_order():
    buf = array.array('h', [0, 1, 2])
    src = FakeSource(buf)
    sink = FakeSink()
    chain = _steady_chain()
    chain.set_source(src)
    chain.set_sink(sink)

    seen = []
    chain.add_filter(type('F', (), {'process': lambda self, b: seen.append('f1')})())
    chain.add_filter(type('F', (), {'process': lambda self, b: seen.append('f2')})())

    asyncio.run(chain.run_block())
    # One read primes the current block, one fills the pending (next) block.
    assert src.reads == 2
    assert sink.writes == 1
    assert seen == ['f1', 'f2']


def test_audio_chain_reuses_working_buffers():
    src = FakeSource(array.array('h', [1, 2, 3]))
    sink = FakeSink()
    chain = _steady_chain()
    chain.set_source(src)
    chain.set_sink(sink)

    seen = []
    chain.add_filter(type('F', (), {'process': lambda self, b: seen.append(b)})())

    asyncio.run(chain.run_block())
    asyncio.run(chain.run_block())
    asyncio.run(chain.run_block())

    assert len(seen) == 3
    assert seen[0] is seen[2]
    assert seen[1] is not seen[0]


def _assert_pass_through(fx, **params):
    for key, value in params.items():
        setattr(fx, key, value)
    fx.enabled = False
    buf = array.array('h', [1000, -1000, 30000, -30000])
    fx.process(buf)
    assert list(buf) == [1000, -1000, 30000, -30000]


def test_disabled_effects_pass_through():
    _assert_pass_through(overdrive.Overdrive(), drive=100.0)
    _assert_pass_through(bitcrusher.Bitcrusher(), bits=4)
    _assert_pass_through(square_fuzz.SquareFuzz())
    _assert_pass_through(downsampler.Downsampler(), hold=2)
    _assert_pass_through(gain.Gain(), volume=10.0)


def test_audio_chain_mixes_all_sources_into_first_buffer():
    buf_a = array.array('h', [1, 2, 3])
    buf_b = array.array('h', [10, 20, 30])
    src_a = FakeSource(buf_a)
    src_b = FakeSource(buf_b)
    sink = FakeSink()
    chain = _steady_chain()
    chain.add_source(src_a)
    chain.add_source(src_b)
    chain.set_sink(sink)

    written = []
    chain.add_filter(type('F', (), {'process': lambda self, b: written.append(list(b))})())

    asyncio.run(chain.run_block())
    # Primary source is read twice: once to prime, once for the pending block.
    assert src_a.reads == 2
    assert src_b.reads == 1
    assert sink.writes == 1
    assert written == [[11, 22, 33]]


def test_audio_chain_double_buffer_produces_consecutive_blocks():
    buf = array.array('h', [1, 2, 3])
    src = FakeSource(buf)
    sink = FakeSink()
    chain = _steady_chain()
    chain.set_source(src)
    chain.set_sink(sink)

    written = []
    chain.add_filter(type('F', (), {'process': lambda self, b: written.append(list(b))})())

    asyncio.run(chain.run_block())
    asyncio.run(chain.run_block())

    # First call primes and reads the pending block; second call reads the next
    # pending block and produces the second output block from the alternate buffer.
    assert src.reads == 3
    assert sink.writes == 2
    assert written == [[1, 2, 3], [1, 2, 3]]


def test_audio_chain_mix_saturates_at_int16_bounds():
    buf_a = array.array('h', [30000, -30000])
    buf_b = array.array('h', [30000, -30000])
    src_a = FakeSource(buf_a)
    src_b = FakeSource(buf_b)
    sink = FakeSink()
    chain = _steady_chain()
    chain.add_source(src_a)
    chain.add_source(src_b)
    chain.set_sink(sink)

    written = []
    chain.add_filter(type('F', (), {'process': lambda self, b: written.append(list(b))})())

    asyncio.run(chain.run_block())
    assert written == [[32767, -32768]]


def test_audio_chain_creates_one_task_per_block(monkeypatch):
    calls = []
    orig = audio_chain.asyncio.create_task

    def counting(coro):
        calls.append(coro)
        return orig(coro)

    monkeypatch.setattr(audio_chain.asyncio, 'create_task', counting)

    src = FakeSource(array.array('h', [1, 2, 3]))
    sink = FakeSink()
    chain = _steady_chain()
    chain.set_source(src)
    chain.set_sink(sink)

    asyncio.run(chain.run_block())
    asyncio.run(chain.run_block())

    assert len(calls) == 2


def test_audio_chain_recovers_after_prefetch_error():
    src = FlakySource(array.array('h', [1, 2, 3]))
    src.fail_on_read = 2
    sink = FakeSink()
    chain = _steady_chain()
    chain.set_source(src)
    chain.set_sink(sink)

    with pytest.raises(RuntimeError):
        asyncio.run(chain.run_block())

    assert chain._pending is None

    asyncio.run(chain.run_block())  # must not raise; chain is not wedged
    assert chain.blocks == 1


def test_audio_chain_counts_short_reads():
    src = ShortReadSource(array.array('h', [1, 2, 3]))
    sink = FakeSink()
    chain = _steady_chain()
    chain.set_source(src)
    chain.set_sink(sink)

    asyncio.run(chain.run_block())

    assert chain.short_reads >= 1
    assert chain.blocks == 1
    assert chain.last_block_us >= 0
    assert chain.max_block_us >= chain.last_block_us


def test_oscillator_sine_phase_zero_starts_at_zero():
    osc = oscillator.Oscillator(rate=1000, block_samples=2, wave='sine')
    osc.frequency = 1.0
    osc.phase = 0.0
    asyncio.run(osc.read())
    assert osc.buffer[0] == 0


def test_oscillator_sine_interpolates_between_table_entries():
    osc = oscillator.Oscillator(rate=1000, block_samples=2, wave='sine')
    osc.frequency = 1.0
    osc.phase = 0.0
    asyncio.run(osc.read())
    # The second sample lands on a fractional phase; interpolation fills it in
    # (a nearest-neighbour lookup would snap back to table[0] == 0).
    assert osc.buffer[1] == 205


def test_oscillator_sine_phase_ninety_peaks():
    osc = oscillator.Oscillator(rate=1000, block_samples=1, wave='sine')
    osc.frequency = 1.0
    osc.phase = 90.0
    asyncio.run(osc.read())
    assert osc.buffer[0] == 32767


def test_oscillator_square():
    osc = oscillator.Oscillator(rate=1000, block_samples=2, wave='square')
    osc.frequency = 1.0
    osc.phase = 0.0
    asyncio.run(osc.read())
    assert osc.buffer[0] == 32767


def test_oscillator_triangle():
    osc = oscillator.Oscillator(rate=1000, block_samples=1, wave='triangle')
    osc.frequency = 1.0
    osc.phase = 90.0
    asyncio.run(osc.read())
    assert osc.buffer[0] == 0


def test_oscillator_sawtooth():
    osc = oscillator.Oscillator(rate=1000, block_samples=1, wave='sawtooth')
    osc.frequency = 1.0
    osc.phase = 0.0
    asyncio.run(osc.read())
    assert osc.buffer[0] == -32768


def test_audio_chain_double_buffer_oscillator_continuous():
    direct = oscillator.Oscillator(rate=16000, block_samples=256, wave='sine')
    direct.frequency = 440.0
    big = array.array('h', [0] * 256)
    asyncio.run(direct.read_into(big))

    osc = oscillator.Oscillator(rate=16000, block_samples=64, wave='sine')
    osc.frequency = 440.0
    sink = FakeSink()
    chain = _steady_chain()
    chain.set_source(osc)
    chain.set_sink(sink)

    written = []
    chain.add_filter(type('F', (), {'process': lambda self, b: written.append(list(b))})())

    for _ in range(4):
        asyncio.run(chain.run_block())

    assert [x for block in written for x in block] == list(big)


def test_oscillator_disabled_silence():
    osc = oscillator.Oscillator(rate=1000, block_samples=2, wave='sine')
    osc.enabled = False
    asyncio.run(osc.read())
    assert list(osc.buffer) == [0, 0]
    assert osc.level == 0.0

def test_oscillator_filter_mix_zero_passes_through():
    osc = oscillator.Oscillator(rate=1000, block_samples=2, wave='square')
    osc.frequency = 1.0
    osc.phase = 0.0
    osc.mix = 0.0
    buf = array.array('h', [1000, -1000])
    osc.process(buf)
    assert list(buf) == [1000, -1000]


def test_oscillator_filter_adds_and_saturates():
    osc = oscillator.Oscillator(rate=1000, block_samples=2, wave='square')
    osc.frequency = 1.0
    osc.phase = 0.0
    osc.mix = 1.0
    osc.saturate = True
    buf = array.array('h', [1000])
    osc.process(buf)
    assert list(buf) == [32767]


def test_oscillator_filter_wraps_when_not_saturating():
    osc = oscillator.Oscillator(rate=1000, block_samples=1, wave='square')
    osc.frequency = 1.0
    osc.phase = 0.0
    osc.mix = 1.0
    osc.saturate = False
    buf = array.array('h', [30000])
    osc.process(buf)
    assert list(buf) == [-2769]


def test_oscillator_filter_disabled_passes_through():
    osc = oscillator.Oscillator(rate=1000, block_samples=1, wave='square')
    osc.enabled = False
    buf = array.array('h', [1000])
    osc.process(buf)
    assert list(buf) == [1000]
