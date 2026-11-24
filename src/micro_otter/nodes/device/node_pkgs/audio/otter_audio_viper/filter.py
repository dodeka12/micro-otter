# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import math

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

_FILTER_SHIFT = 12
_FILTER_ONE = 1 << _FILTER_SHIFT


if micropython is not None:
    @micropython.viper
    def _run_filter(buf, a_hp: int, a_lp: int, lp_low: int, lp_high: int, shift: int):
        p = ptr16(buf)
        n = int(len(buf))
        for i in range(n):
            x = int(p[i])
            if x > 32767:
                x -= 65536
            lp_low += (a_hp * (x - lp_low)) >> shift
            hp = x - lp_low
            lp_high += (a_lp * (hp - lp_high)) >> shift
            out = lp_high
            if out > 32767:
                out = 32767
            elif out < -32768:
                out = -32768
            p[i] = out
        return lp_low, lp_high
else:
    def _run_filter(buf, a_hp, a_lp, lp_low, lp_high, shift):
        for i in range(len(buf)):
            x = buf[i]
            lp_low += (a_hp * (x - lp_low)) >> shift
            hp = x - lp_low
            lp_high += (a_lp * (hp - lp_high)) >> shift
            out = lp_high
            if out > 32767:
                out = 32767
            elif out < -32768:
                out = -32768
            buf[i] = out
        return lp_low, lp_high


class Filter:
    """Band-pass filter (one-pole high-pass + one-pole low-pass).

    ``low_hz`` sets the high-pass edge (removes low frequencies) and
    ``high_hz`` sets the low-pass edge (removes high frequencies). Coefficients
    are cached fixed-point values, so the per-sample loop is integer-only and
    allocation-free.
    """

    def __init__(self, rate=16000, block_samples=256):
        self.rate = rate
        self.block_samples = block_samples
        self.low_hz = 300.0
        self.high_hz = 3000.0
        self.enabled = True
        self._a_hp = 0
        self._a_lp = _FILTER_ONE
        self._lp_low = 0
        self._lp_high = 0
        self._last_low_hz = None
        self._last_high_hz = None
        self._last_rate = None
        self._update_coeffs()

    def _update_coeffs(self):
        if (
            self.low_hz != self._last_low_hz
            or self.high_hz != self._last_high_hz
            or self.rate != self._last_rate
        ):
            self._a_hp = int(
                (1.0 - math.exp(-6.283185307179586 * self.low_hz / self.rate))
                * _FILTER_ONE
            )
            self._a_lp = int(
                (1.0 - math.exp(-6.283185307179586 * self.high_hz / self.rate))
                * _FILTER_ONE
            )
            self._last_low_hz = self.low_hz
            self._last_high_hz = self.high_hz
            self._last_rate = self.rate

    def process(self, buf):
        if not self.enabled:
            return
        self._update_coeffs()
        self._lp_low, self._lp_high = _run_filter(
            buf, self._a_hp, self._a_lp, self._lp_low, self._lp_high, _FILTER_SHIFT
        )
