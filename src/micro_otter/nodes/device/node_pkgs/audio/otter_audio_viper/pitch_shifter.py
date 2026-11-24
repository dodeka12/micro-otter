# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import array

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

_TAP_SHIFT = 12
_TAP_ONE = 1 << _TAP_SHIFT


if micropython is not None:
    @micropython.viper
    def _shift_block(buf, delay, mask: int, ratio: int, write: int, d0: int,
                     delay_samples: int, half: int, half_shift: int, shift: int):
        p = ptr16(buf)
        d = ptr16(delay)
        n = int(len(buf))
        frac_mask = (1 << shift) - 1
        d_q = delay_samples << shift
        half_q = half << shift
        step = (1 << shift) - ratio
        for i in range(n):
            d[write] = p[i]
            write = (write + 1) & mask
            d0 += step
            if d0 < 0:
                d0 += d_q
            elif d0 >= d_q:
                d0 -= d_q
            d1 = d0 + half_q
            if d1 >= d_q:
                d1 -= d_q
            rp0 = (write << shift) - d0
            idx0 = (rp0 >> shift) & mask
            frac0 = rp0 & frac_mask
            a0 = int(d[idx0])
            if a0 > 32767:
                a0 -= 65536
            b0 = int(d[(idx0 + 1) & mask])
            if b0 > 32767:
                b0 -= 65536
            s0 = a0 + (((b0 - a0) * frac0) >> shift)
            rp1 = (write << shift) - d1
            idx1 = (rp1 >> shift) & mask
            frac1 = rp1 & frac_mask
            a1 = int(d[idx1])
            if a1 > 32767:
                a1 -= 65536
            b1 = int(d[(idx1 + 1) & mask])
            if b1 > 32767:
                b1 -= 65536
            s1 = a1 + (((b1 - a1) * frac1) >> shift)
            tri0 = d0 if d0 < half_q else (d_q - d0)
            w0 = tri0 >> shift
            w1 = half - w0
            p[i] = (s0 * w0 + s1 * w1) >> half_shift
        return write, d0
else:
    def _shift_block(buf, delay, mask, ratio, write, d0, delay_samples, half, half_shift, shift):
        frac_mask = (1 << shift) - 1
        d_q = delay_samples << shift
        half_q = half << shift
        step = (1 << shift) - ratio
        for i in range(len(buf)):
            delay[write] = buf[i]
            write = (write + 1) & mask
            d0 += step
            if d0 < 0:
                d0 += d_q
            elif d0 >= d_q:
                d0 -= d_q
            d1 = d0 + half_q
            if d1 >= d_q:
                d1 -= d_q
            rp0 = (write << shift) - d0
            idx0 = (rp0 >> shift) & mask
            frac0 = rp0 & frac_mask
            a0 = delay[idx0]
            b0 = delay[(idx0 + 1) & mask]
            s0 = a0 + (((b0 - a0) * frac0) >> shift)
            rp1 = (write << shift) - d1
            idx1 = (rp1 >> shift) & mask
            frac1 = rp1 & frac_mask
            a1 = delay[idx1]
            b1 = delay[(idx1 + 1) & mask]
            s1 = a1 + (((b1 - a1) * frac1) >> shift)
            tri0 = d0 if d0 < half_q else (d_q - d0)
            w0 = tri0 >> shift
            w1 = half - w0
            buf[i] = (s0 * w0 + s1 * w1) >> half_shift
        return write, d0


class PitchShifter:
    """Real-time pitch shifter (time-domain, fixed-point).

    Shifts pitch in semitones without changing playback speed using a
    dual-tap delay line with linear interpolation and crossfade. ``semitones``
    of 0 bypasses the effect; negative values deepen the voice and positive
    values raise it. The per-sample loop is integer-only (no float or heap
    allocation).
    """

    def __init__(self, block_samples=256, delay_samples=1024):
        self.block_samples = block_samples
        self.semitones = 0.0
        self.enabled = True
        self._delay_samples = delay_samples
        self._mask = delay_samples - 1
        self._half = delay_samples >> 1
        half_shift = 0
        h = self._half
        while h > 1:
            h >>= 1
            half_shift += 1
        self._half_shift = half_shift
        self._delay = array.array('h', [0] * delay_samples)
        self._write = 0
        self._d0 = 0
        self._ratio = _TAP_ONE
        self._last_semitones = None
        self._active = False
        self._reset()

    def _reset(self):
        for i in range(self._delay_samples):
            self._delay[i] = 0
        self._write = 0
        self._d0 = (self._delay_samples - 1) << _TAP_SHIFT

    def _update_ratio(self):
        if self.semitones != self._last_semitones:
            self._ratio = int((2.0 ** (self.semitones / 12.0)) * _TAP_ONE)
            self._last_semitones = self.semitones

    def process(self, buf):
        if not self.enabled:
            return
        self._update_ratio()
        if self._ratio == _TAP_ONE:
            if self._active:
                self._reset()
                self._active = False
            return
        if not self._active:
            self._reset()
            self._active = True

        self._write, self._d0 = _shift_block(
            buf,
            self._delay,
            self._mask,
            self._ratio,
            self._write,
            self._d0,
            self._delay_samples,
            self._half,
            self._half_shift,
            _TAP_SHIFT,
        )
