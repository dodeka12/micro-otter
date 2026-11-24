# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import math

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

try:  # pragma: no cover - deployed package layout
    from otter_audio_viper.mix_ramp import MixRamp
except ImportError:  # host tests import the package modules flat
    from mix_ramp import MixRamp

_LEVEL_ONE = 1 << 15


if micropython is not None:
    @micropython.viper
    def _peak(buf) -> int:
        p = ptr16(buf)
        n = int(len(buf))
        peak = 0
        for i in range(n):
            v = int(p[i])
            if v > 32767:
                v -= 65536
            a = v if v >= 0 else -v
            if a > peak:
                peak = a
        return peak

    @micropython.viper
    def _square(buf, amp: int, cur: int, target: int, step: int):
        p = ptr16(buf)
        n = int(len(buf))
        for i in range(n):
            v = int(p[i])
            if v > 32767:
                v -= 65536
            neg = 0
            if v < 0:
                v = -v
                neg = 1
            # Blend magnitudes so the result stays exactly sign-symmetric.
            m = v + (((amp - v) * cur) >> 15)
            if neg:
                p[i] = -m
            else:
                if m > 32767:
                    m = 32767
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
    def _peak(buf):
        peak = 0
        for v in buf:
            a = v if v >= 0 else -v
            if a > peak:
                peak = a
        return peak

    def _square(buf, amp, cur, target, step):
        """Blend every sample magnitude from the dry signal (``cur = 0``) to a
        square wave of amplitude ``amp`` (``cur = 32768``). ``cur`` is Q15 and
        steps toward ``target`` once per sample; the blend is done on magnitudes
        so the output stays sign-symmetric (no DC offset)."""
        for i in range(len(buf)):
            v = buf[i]
            if v < 0:
                v = -v
                m = v + (((amp - v) * cur) >> 15)
                buf[i] = -m
            else:
                m = v + (((amp - v) * cur) >> 15)
                if m > 32767:
                    m = 32767
                buf[i] = m
            if cur < target:
                cur += step
                if cur > target:
                    cur = target
            elif cur > target:
                cur -= step
                if cur < target:
                    cur = target


class SquareFuzz:
    """Square-wave fuzz that follows the input envelope.

    When ``envelopeFollow`` is true (default) the square wave's amplitude tracks
    the smoothed input peak, so quiet input stays quiet. When false, every
    sample is snapped to full scale (+/-32767).

    ``level`` is a dB value (0 dB = unity, negative attenuates) applied to the
    squared wave only, i.e. it is the gain of the *wet* path: at ``mix = 1`` it
    acts as an output trim, at ``mix < 1`` it sets how hot the fuzz component is
    while the dry share passes untouched. The scale is cached in Q15, so the
    per-sample loop stays integer-only.

    ``mix`` (0..1, default 0.5) blends the dry input with the squared wave: 0
    leaves the signal bit-exact, 1 replaces every sample with the square wave,
    and values in between keep the voice intelligible while still adding fuzz
    character. The blend is applied to magnitudes and the sign restored, so the
    output stays exactly sign-symmetric (no DC offset). ``mix`` and ``enabled``
    fade over ~128 samples via ``MixRamp``, so toggling the effect or dragging
    the slider never clicks.
    """

    def __init__(self, block_samples=256):
        self.block_samples = block_samples
        self.level = -6.0
        self.mix = 0.5
        self.envelopeFollow = True
        self.enabled = True
        self._env = 0
        self._scale = None
        self._last_level = None
        self._mix_ramp = MixRamp()

    def _update_scale(self):
        """Cache ``level`` (dB) as a Q15 wet-path amplitude scale."""
        if self.level != self._last_level:
            db = max(min(self.level, 0.0), -60.0)
            scale = int(math.pow(10.0, db / 20.0) * _LEVEL_ONE)
            self._scale = 0 if scale < 0 else (_LEVEL_ONE if scale > _LEVEL_ONE else scale)
            self._last_level = self.level

    def process(self, buf):
        ramp = self._mix_ramp
        ramp.mix = self.mix
        ramp.enabled = self.enabled
        ramp.update()
        if ramp.cur == 0 and ramp.target == 0:
            # mix 0 (or bypassed) is a bit-exact pass-through; skip the peak scan.
            return
        self._update_scale()
        peak = _peak(buf)
        if peak > self._env:
            self._env += (peak - self._env) >> 2
        else:
            self._env -= (self._env - peak) >> 5
        if self.envelopeFollow:
            amp = (self._env * self._scale) >> 15
            if amp > 32767:
                amp = 32767
        else:
            amp = (32767 * self._scale) >> 15
        _square(buf, amp, ramp.cur, ramp.target, ramp.step)
        ramp.advance(len(buf))
