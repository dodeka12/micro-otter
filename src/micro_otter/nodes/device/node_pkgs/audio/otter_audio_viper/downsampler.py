# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import array
import math

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

try:  # pragma: no cover - deployed package layout
    from otter_audio_viper.mix_ramp import MixRamp
except ImportError:  # host tests import the package modules flat
    from mix_ramp import MixRamp

_LP_ONE = 32768


def _aa_coeff(rate, hold):
    """Q15 one-pole coefficient for the anti-alias cutoff ``rate / (2 * hold)``."""
    if rate < 1:
        rate = 16000
    if hold < 1:
        hold = 1
    fc = rate / (2.0 * hold)
    a = int((1.0 - math.exp(-2.0 * math.pi * fc / rate)) * _LP_ONE)
    if a < 1:
        a = 1
    elif a > 32767:
        a = 32767
    return a


# The hold phase, the held sample and the two anti-alias filter states are the
# only cross-block state. They are carried explicitly so the decimation grid is
# continuous: resetting the phase per block (``i % hold``) produced a 62.5 Hz
# buzz for every ``hold`` that does not divide the block length.
if micropython is not None:
    @micropython.viper
    def _hold(
        buf, hold: int, cur: int, target: int, step: int, aa: int, a: int, phase: int, state
    ) -> int:
        p = ptr16(buf)
        n = int(len(buf))
        s = ptr16(state)
        held = int(s[0])
        if held > 32767:
            held -= 65536
        lp0 = int(s[1])
        if lp0 > 32767:
            lp0 -= 65536
        lp1 = int(s[2])
        if lp1 > 32767:
            lp1 -= 65536
        for i in range(n):
            v = int(p[i])
            if v > 32767:
                v -= 65536
            src = v
            if aa:
                lp0 += (((v - lp0) * a) + 16384) >> 15
                lp1 += (((lp0 - lp1) * a) + 16384) >> 15
                src = lp1
            if phase == 0:
                held = src
            m = v + (((held - v) * cur) >> 15)
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
            phase += 1
            if phase >= hold:
                phase = 0
        s[0] = held
        s[1] = lp0
        s[2] = lp1
        return phase
else:
    def _hold(buf, hold, cur, target, step, aa, a, phase, state):
        """Sample-and-hold with optional 2-pole anti-alias and a dry/wet ramp."""
        held = state[0]
        lp0 = state[1]
        lp1 = state[2]
        for i in range(len(buf)):
            v = buf[i]
            src = v
            if aa:
                lp0 += (((v - lp0) * a) + 16384) >> 15
                lp1 += (((lp0 - lp1) * a) + 16384) >> 15
                src = lp1
            if phase == 0:
                held = src
            m = v + (((held - v) * cur) >> 15)
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
            phase += 1
            if phase >= hold:
                phase = 0
        state[0] = held
        state[1] = lp0
        state[2] = lp1
        return phase


class Downsampler:
    """Sample-and-hold decimator with a hold grid that spans block boundaries.

    ``hold`` is the number of times each captured sample is repeated (1 = no
    change, default 4). It is clamped to ``1 .. len(buf)``: a hold longer than
    the block used to emit a full-scale block-rate square wave.

    Both the hold phase and the held sample persist across blocks, so the
    decimation grid never restarts at a block boundary — the previous per-block
    ``i % hold`` reset produced a 62.5 Hz buzz for 57 of the 64 slider values.

    Before a sample is captured the input is band-limited by two cascaded
    one-pole low passes at ``rate / (2 * hold)`` (≈12 dB/oct of alias suppression
    for two multiply-adds per sample, measured −11.8 dB of folded energy at
    ``hold = 4`` on an HF-only source versus −6.2 dB for one pole and no
    filtering). ``antiAlias = False`` skips the filter for the raw, aliasing-heavy
    character; the filter is skipped for ``hold == 1`` anyway, since nothing is
    decimated. The filter runs on every input sample and its two states persist
    across blocks, and its coefficient is cached per ``(rate, hold)``.

    ``mix`` (0..1, default 1) blends the held sample with the dry input: 0 is a
    bit-exact pass-through, so the effect also works as a sample-rate-reduction
    fader. ``mix`` and ``enabled`` fade over ~128 samples via ``MixRamp``. The
    inner loop is viper-compiled on-device, uses fixed-point integer math and
    performs no heap allocation (its state lives in one preallocated array).
    """

    def __init__(self, rate=16000, block_samples=256):
        self.rate = rate
        self.block_samples = block_samples
        self.hold = 4
        self.mix = 1.0
        self.antiAlias = True
        self.enabled = True
        self._mix_ramp = MixRamp()
        self._state = array.array('h', [0, 0, 0])  # held, lp0, lp1
        self._phase = 0
        self._coeff = 0
        self._coeff_key = None

    def _update_coeff(self, hold):
        key = (self.rate, hold)
        if key != self._coeff_key:
            self._coeff = _aa_coeff(self.rate, hold)
            self._coeff_key = key

    def process(self, buf):
        ramp = self._mix_ramp
        ramp.mix = self.mix
        ramp.enabled = self.enabled
        ramp.update()
        if ramp.cur == 0 and ramp.target == 0:
            return
        size = len(buf)
        hold = int(self.hold)
        if hold < 1:
            hold = 1
        elif hold > size:
            hold = size
        if hold < 1:
            return
        if self._phase >= hold:
            self._phase = 0
        aa = 0
        coeff = 0
        if self.antiAlias and hold > 1:
            aa = 1
            self._update_coeff(hold)
            coeff = self._coeff
        self._phase = _hold(
            buf, hold, ramp.cur, ramp.target, ramp.step, aa, coeff, self._phase, self._state
        )
        ramp.advance(size)
