# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

try:  # pragma: no cover - deployed package layout
    from otter_audio_viper.mix_ramp import MixRamp
except ImportError:  # host tests import the package modules flat
    from mix_ramp import MixRamp


if micropython is not None:
    @micropython.viper
    def _crush(buf, drop: int, cur: int, target: int, step: int):
        p = ptr16(buf)
        n = int(len(buf))
        half = 1 << (drop - 1)
        for i in range(n):
            v = int(p[i])
            if v > 32767:
                v -= 65536
            neg = 0
            if v < 0:
                a = -v
                neg = 1
            else:
                a = v
            q = ((a + half) >> drop) << drop
            if q > 32768:
                q = 32768
            m = a + (((q - a) * cur) >> 15)
            if neg:
                m = -m
            if m > 32767:
                m = 32767
            elif m < -32768:
                m = -32768
            p[i] = m
            if cur < target:
                cur += step
                if cur > target:
                    cur = target
            elif cur > target:
                cur -= step
                if cur < target:
                    cur = target
else:
    def _crush(buf, drop, cur, target, step):
        """Round each sample magnitude to the nearest ``1 << drop`` step."""
        half = 1 << (drop - 1)
        for i in range(len(buf)):
            v = buf[i]
            if v < 0:
                a = -v
                neg = 1
            else:
                a = v
                neg = 0
            q = ((a + half) >> drop) << drop
            if q > 32768:
                q = 32768
            m = a + (((q - a) * cur) >> 15)
            if neg:
                m = -m
            if m > 32767:
                m = 32767
            elif m < -32768:
                m = -32768
            buf[i] = m
            if cur < target:
                cur += step
                if cur > target:
                    cur = target
            elif cur > target:
                cur -= step
                if cur < target:
                    cur = target


class Bitcrusher:
    """Reduce bit depth by quantizing each sample to a coarser grid.

    ``bits`` counts the *dropped* low bits (1 = nearly transparent, 15 = extreme
    lo-fi, default 4), so the quantization step is ``1 << bits`` counts and the
    effective resolution is ``16 - bits``. Quantization rounds the sample
    magnitude to the nearest step and restores the sign afterwards, which keeps
    the output exactly sign-symmetric: a symmetric input keeps zero DC instead of
    drifting toward the negative rail (truncating ``(v >> n) << n`` rectifies
    quiet samples to 0 and biases every block negative — the audible crackle).
    Samples saturate to the int16 range.

    ``mix`` (0..1, default 1) is the dry/wet blend: 0 is a bit-exact pass-through,
    1 is the full crush, values in between keep the voice intelligible. ``mix``
    and ``enabled`` fade over ~128 samples via ``MixRamp``, so toggling the effect
    or dragging the slider never clicks. The inner loop is viper-compiled
    on-device with a pure-Python fallback and performs no heap allocation.
    """

    def __init__(self, block_samples=256):
        self.block_samples = block_samples
        self.bits = 4
        self.mix = 1.0
        self.enabled = True
        self._mix_ramp = MixRamp()

    def process(self, buf):
        ramp = self._mix_ramp
        ramp.mix = self.mix
        ramp.enabled = self.enabled
        ramp.update()
        if ramp.cur == 0 and ramp.target == 0:
            return
        drop = int(self.bits)
        if drop < 1:
            drop = 1
        elif drop > 15:
            drop = 15
        _crush(buf, drop, ramp.cur, ramp.target, ramp.step)
        ramp.advance(len(buf))
