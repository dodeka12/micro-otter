# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import array
import math

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

_TABLE_SIZE = 512


def _build_lut():
    """One cycle of a Q7.8 sine (-256..256) as a 512-entry table."""
    lut = array.array('h', [0] * _TABLE_SIZE)
    for i in range(_TABLE_SIZE):
        lut[i] = int(round(math.sin(2 * math.pi * i / _TABLE_SIZE) * 256))
    return lut


if micropython is not None:
    @micropython.viper
    def _ring(buf, lut, inc: int, depth_q15: int, phase: int) -> int:
        p = ptr16(buf)
        t = ptr16(lut)
        n = int(len(buf))
        for i in range(n):
            v = int(p[i])
            if v > 32767:
                v -= 65536
            idx = (phase >> 7) & 511
            frac = phase & 127
            a = int(t[idx])
            if a > 32767:
                a -= 65536
            b = int(t[(idx + 1) & 511])
            if b > 32767:
                b -= 65536
            c = a + (((b - a) * frac) >> 7)
            m = 256 + (((c - 256) * depth_q15) >> 15)
            if m < -256:
                m = -256
            elif m > 256:
                m = 256
            x = (v * m) >> 8
            if x > 32767:
                x = 32767
            elif x < -32768:
                x = -32768
            p[i] = x
            phase = (phase + inc) & 0xFFFF
        return phase
else:
    def _ring(buf, lut, inc, depth_q15, phase):
        for i in range(len(buf)):
            v = buf[i]
            idx = (phase >> 7) & 511
            frac = phase & 127
            a = lut[idx]
            b = lut[(idx + 1) & 511]
            c = a + (((b - a) * frac) >> 7)
            m = 256 + (((c - 256) * depth_q15) >> 15)
            if m < -256:
                m = -256
            elif m > 256:
                m = 256
            x = (v * m) >> 8
            if x > 32767:
                x = 32767
            elif x < -32768:
                x = -32768
            buf[i] = x
            phase = (phase + inc) & 0xFFFF
        return phase


class RingMod:
    """Ring modulator: multiplies each sample by an interpolated sine carrier.

    ``frequency`` is the carrier frequency in Hz; ``depth`` blends from the dry
    signal (0, bit-exact pass-through) through amplitude modulation to full ring
    modulation (1). The carrier is a 512-entry Q7.8 sine table driven by a 16.16
    phase accumulator, so the per-sample loop is integer-only and allocation-free.
    """

    def __init__(self, rate=16000, block_samples=256):
        self.rate = rate
        self.block_samples = block_samples
        self.frequency = 150.0
        self.depth = 1.0
        self.enabled = True
        self._lut = _build_lut()
        self._phase = 0
        self._inc = 0
        self._freq_cached = None
        self._depth_q15 = 32768

    def _update(self):
        if self.frequency != self._freq_cached:
            freq = self.frequency
            if freq < 1.0:
                freq = 1.0
            rate = self.rate if self.rate > 0 else 16000
            self._inc = (int(freq * 65536 / rate) & 0xFFFF) or 1
            self._freq_cached = self.frequency
        depth_q15 = int(self.depth * 32768)
        if depth_q15 < 0:
            depth_q15 = 0
        elif depth_q15 > 32768:
            depth_q15 = 32768
        self._depth_q15 = depth_q15

    def process(self, buf):
        if not self.enabled:
            return
        self._update()
        self._phase = _ring(buf, self._lut, self._inc, self._depth_q15, self._phase)
