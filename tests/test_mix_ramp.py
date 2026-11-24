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

from mix_ramp import MixRamp  # noqa: E402


def test_mix_target_is_q15_and_clamped():
    ramp = MixRamp()

    ramp.mix = 0.5
    assert ramp.update() == 16384

    ramp.mix = -1.0
    assert ramp.update() == 0

    ramp.mix = 2.0
    assert ramp.update() == 32768

    ramp.mix = 1.0
    ramp.enabled = False
    assert ramp.update() == 0


def test_first_update_snaps_to_the_target():
    ramp = MixRamp()
    ramp.mix = 0.25
    assert ramp.update() == 8192
    assert ramp.cur == 8192


def test_fade_takes_exactly_fade_samples():
    ramp = MixRamp()
    ramp.update()  # snap at full wet
    ramp.mix = 0.0
    ramp.update()

    assert ramp.advance(ramp.fade_samples - 1) > 0
    assert ramp.advance(1) == 0
    assert ramp.cur == 0


def test_advance_matches_sample_by_sample_stepping():
    for fade in (4, 128):
        ramp = MixRamp(fade_samples=fade)
        ramp.update()

        manual = ramp.cur
        ramp.mix = 0.0
        ramp.update()
        for _ in range(3):
            ramp.advance(7)  # 21 samples in total
        for _ in range(21):
            manual -= ramp.step
            if manual < 0:
                manual = 0
        assert ramp.cur == manual

        ramp.mix = 1.0
        ramp.update()
        up = ramp.cur
        ramp.advance(3)
        for _ in range(3):
            up += ramp.step
        if up > 32768:
            up = 32768
        assert ramp.cur == up


def test_advance_never_overshoots_in_either_direction():
    ramp = MixRamp(fade_samples=8)
    ramp.update()

    ramp.mix = 0.0
    ramp.update()
    assert ramp.advance(1000) == 0
    assert ramp.cur == 0

    ramp.mix = 1.0
    ramp.update()
    assert ramp.advance(1000) == 32768
    assert ramp.cur == 32768

    assert ramp.advance(0) == 32768
    assert ramp.advance(-5) == 32768


def test_step_stays_positive_for_extreme_fade_lengths():
    assert MixRamp(fade_samples=0).step >= 1
    assert MixRamp(fade_samples=-3).fade_samples == 1
    assert MixRamp(fade_samples=1000000).step >= 1


def test_default_ramp_geometry():
    # 128 samples at 16 kHz is ~8 ms: long enough to hide a slider step, short
    # enough not to smear a musical change.
    ramp = MixRamp()
    assert ramp.fade_samples == 128
    assert ramp.step == 256
    assert ramp.cur == 32768
