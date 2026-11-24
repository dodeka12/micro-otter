# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import math

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

_GAIN_SHIFT = 10
_GAIN_ONE = 1 << _GAIN_SHIFT


if micropython is not None:
    @micropython.viper
    def _apply(buf, scale: int, shift: int):
        p = ptr16(buf)
        n = int(len(buf))
        for i in range(n):
            v = int(p[i])
            if v > 32767:
                v -= 65536
            x = v * scale >> shift
            if x > 32767:
                x = 32767
            elif x < -32768:
                x = -32768
            p[i] = x
else:
    def _apply(buf, scale, shift):
        for i in range(len(buf)):
            x = (buf[i] * scale) >> shift
            if x > 32767:
                x = 32767
            elif x < -32768:
                x = -32768
            buf[i] = x


class Gain:
    """Exponential gain (volume) with hard clipping.

    ``volume`` is a dB value: 0 dB is unity, +6 dB doubles amplitude, and -6 dB
    halves it. The per-sample multiply is fixed-point so the streaming loop
    performs no floating-point work or heap allocation. The inner loop is
    viper-compiled on-device with a pure-Python fallback for the host.
    """

    def __init__(self, block_samples=256):
        self.block_samples = block_samples
        self.volume = 0.0
        self.enabled = True
        self._scale = _GAIN_ONE
        self._last_volume = None

    def _update_scale(self):
        if self.volume != self._last_volume:
            db = max(min(self.volume, 12.0), -12.0)
            self._scale = int(math.pow(10.0, db / 20.0) * _GAIN_ONE)
            self._last_volume = self.volume

    def process(self, buf):
        if not self.enabled:
            return
        self._update_scale()
        _apply(buf, self._scale, _GAIN_SHIFT)
