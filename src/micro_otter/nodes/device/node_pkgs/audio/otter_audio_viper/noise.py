# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import math

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

_NOISE_SHIFT = 12
_NOISE_ONE = 1 << _NOISE_SHIFT
_NOISE_MIN_DB = -60.0


if micropython is not None:
    @micropython.viper
    def _add_noise(buf, level: int, state: int) -> int:
        p = ptr16(buf)
        n = int(len(buf))
        shift = 12  # _NOISE_SHIFT
        for i in range(n):
            state = (state >> 1) ^ (-(state & 1) & 0xB400)
            noise = state - 32768
            v = int(p[i])
            if v > 32767:
                v -= 65536
            v += (noise * level) >> shift
            if v > 32767:
                v = 32767
            elif v < -32768:
                v = -32768
            p[i] = v
        return state

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
else:
    def _add_noise(buf, level, state):
        shift = _NOISE_SHIFT
        for i in range(len(buf)):
            state = (state >> 1) ^ (-(state & 1) & 0xB400)
            n = state - 32768
            v = buf[i] + ((n * level) >> shift)
            if v > 32767:
                v = 32767
            elif v < -32768:
                v = -32768
            buf[i] = v
        return state

    def _peak(buf):
        peak = 0
        for v in buf:
            a = v if v >= 0 else -v
            if a > peak:
                peak = a
        return peak


class Noise:
    """White-noise injector (static) with an input gate.

    ``level`` and ``threshold`` are dB values. ``level`` scales the injected
    static relative to the smoothed input envelope when ``envelopeFollow`` is
    true (default), or relative to full scale (dBFS) when false. ``threshold``
    is the dBFS input amplitude above which static is added (-60 dB = always
    on). The gate uses a smoothed input envelope to avoid clicks, and
    per-sample work is integer-only and allocation-free.
    """

    def __init__(self, block_samples=256):
        self.block_samples = block_samples
        self.level = _NOISE_MIN_DB
        self.threshold = _NOISE_MIN_DB
        self.envelopeFollow = True
        self.enabled = True
        self._state = 0xACE1
        self._level = 0
        self._threshold = 0
        self._last_level = None
        self._last_threshold = None
        self._env = 0
        self._gate = 0

    def _update_params(self):
        if self.level != self._last_level:
            if self.level <= _NOISE_MIN_DB:
                self._level = 0
            else:
                db = max(min(self.level, 0.0), _NOISE_MIN_DB)
                self._level = int(math.pow(10.0, db / 20.0) * _NOISE_ONE)
            self._last_level = self.level
        if self.threshold != self._last_threshold:
            db = max(min(self.threshold, 0.0), _NOISE_MIN_DB)
            self._threshold = int(math.pow(10.0, db / 20.0) * 32768.0)
            self._last_threshold = self.threshold

    def process(self, buf):
        if not self.enabled:
            return
        self._update_params()
        if self._level == 0:
            return

        peak = _peak(buf)

        if peak > self._env:
            self._env += (peak - self._env) >> 1
        else:
            self._env -= (self._env - peak) >> 3

        target = _NOISE_ONE if self._env >= self._threshold else 0
        if target > self._gate:
            self._gate += (target - self._gate) >> 1
        else:
            self._gate += (target - self._gate) >> 2

        effective = (self._level * self._gate) >> _NOISE_SHIFT
        if self.envelopeFollow:
            # Scale by the smoothed input envelope (0..32767 -> 0..1) so the
            # static tracks the voice level rather than a fixed absolute hiss.
            effective = (effective * self._env) >> 15
        if effective == 0:
            return
        self._state = _add_noise(buf, effective, self._state)
