# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import array
import math

try:
    from micropython import const
except ImportError:  # pragma: no cover - host fallback
    const = lambda value: value

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

_WAVETABLE_SIZE = const(512)
_WAVETABLE_MASK = const(_WAVETABLE_SIZE - 1)

_PHASE_SHIFT = 14
_PHASE_SCALE = 1 << _PHASE_SHIFT
_PHASE_CYCLE = _WAVETABLE_SIZE << _PHASE_SHIFT


def _clamp16(v):
    if v > 32767:
        return 32767
    if v < -32768:
        return -32768
    return v


if micropython is not None:
    @micropython.viper
    def _fill(buf, table, inc: int, phase: int, shift: int, mask: int, cycle: int):
        p = ptr16(buf)
        t = ptr16(table)
        n = int(len(buf))
        frac_mask = (1 << shift) - 1
        peak = 0
        for i in range(n):
            idx = (phase >> shift) & mask
            a = int(t[idx])
            if a > 32767:
                a -= 65536
            b = int(t[(idx + 1) & mask])
            if b > 32767:
                b -= 65536
            v = a + (((b - a) * (phase & frac_mask)) >> shift)
            p[i] = v
            av = v if v >= 0 else -v
            if av > peak:
                peak = av
            phase += inc
            if phase >= cycle:
                phase %= cycle
        return phase, peak

    @micropython.viper
    def _mix(buf, table, inc: int, phase: int, shift: int, mask: int, cycle: int, saturate: int) -> int:
        p = ptr16(buf)
        t = ptr16(table)
        n = int(len(buf))
        frac_mask = (1 << shift) - 1
        for i in range(n):
            idx = (phase >> shift) & mask
            a = int(t[idx])
            if a > 32767:
                a -= 65536
            b = int(t[(idx + 1) & mask])
            if b > 32767:
                b -= 65536
            s = a + (((b - a) * (phase & frac_mask)) >> shift)
            v = int(p[i])
            if v > 32767:
                v -= 65536
            v += s
            if saturate:
                if v > 32767:
                    v = 32767
                elif v < -32768:
                    v = -32768
            else:
                v &= 0xFFFF
                if v > 32767:
                    v -= 65536
            p[i] = v
            phase += inc
            if phase >= cycle:
                phase %= cycle
        return phase
else:
    def _fill(buf, table, inc, phase, shift, mask, cycle):
        frac_mask = (1 << shift) - 1
        peak = 0
        for i in range(len(buf)):
            idx = (phase >> shift) & mask
            a = table[idx]
            b = table[(idx + 1) & mask]
            v = a + (((b - a) * (phase & frac_mask)) >> shift)
            buf[i] = v
            av = v if v >= 0 else -v
            if av > peak:
                peak = av
            phase += inc
            if phase >= cycle:
                phase %= cycle
        return phase, peak

    def _mix(buf, table, inc, phase, shift, mask, cycle, saturate):
        frac_mask = (1 << shift) - 1
        for i in range(len(buf)):
            idx = (phase >> shift) & mask
            a = table[idx]
            b = table[(idx + 1) & mask]
            s = a + (((b - a) * (phase & frac_mask)) >> shift)
            v = int(buf[i]) + s
            if saturate:
                if v > 32767:
                    v = 32767
                elif v < -32768:
                    v = -32768
            else:
                v &= 0xFFFF
                if v > 32767:
                    v -= 65536
            buf[i] = v
            phase += inc
            if phase >= cycle:
                phase %= cycle
        return phase


class Oscillator:
    """Dual-mode test signal: a source or a mix-in filter.

    When used as a source (read()) it fills its own buffer with the scaled
    waveform. When used as a filter (process()) it adds the scaled waveform on
    top of an incoming buffer.

    Waveform samples come from a precomputed single-cycle wavetable with
    linear interpolation between adjacent entries, so the per-sample inner
    loop avoids transcendental calls (``math.sin``) on the microcontroller.
    The phase accumulator and mix scaling are fixed-point integers, so the
    streaming loop performs no floating-point work and no heap allocation.
    """

    def __init__(self, rate=16000, block_samples=256, wave='sine'):
        self.rate = rate
        self.block_samples = block_samples
        self.buffer = array.array('h', [0] * block_samples)
        self.wave = wave
        self.frequency = 440.0
        self.phase = 0.0
        self.mix = 1.0
        self.saturate = True
        self.enabled = True
        self.level = 0.0
        self._phase = 0
        self._last_phase = None
        self._inc = 0
        self._last_frequency = None
        self._last_rate = None
        self._table = array.array('h', [0] * _WAVETABLE_SIZE)
        self._scaled_table = array.array('h', [0] * _WAVETABLE_SIZE)
        self._table_wave = None
        self._scaled_mix = None
        self._rebuild_table()

    def _rebuild_table(self):
        wave = self.wave
        table = self._table
        n = _WAVETABLE_SIZE
        if wave == 'square':
            half = n // 2
            for i in range(half):
                table[i] = 32767
            for i in range(half, n):
                table[i] = -32768
        elif wave == 'triangle':
            for i in range(n):
                p = i / n
                table[i] = _clamp16(int((4.0 * abs(p - 0.5) - 1.0) * 32768.0))
        elif wave == 'sawtooth':
            for i in range(n):
                p = i / n
                table[i] = _clamp16(int((2.0 * p - 1.0) * 32768.0))
        else:
            for i in range(n):
                p = i / n
                table[i] = _clamp16(int(math.sin(p * 6.283185307179586) * 32768.0))
        self._table_wave = wave
        self._scaled_mix = None
        self._update_inc()

    def _ensure_scaled_table(self):
        if self._table_wave != self.wave:
            self._rebuild_table()
        if self._scaled_mix != self.mix:
            mix = self.mix
            src = self._table
            dst = self._scaled_table
            for i in range(_WAVETABLE_SIZE):
                dst[i] = _clamp16(int(src[i] * mix))
            self._scaled_mix = mix

    def _update_inc(self):
        if self.frequency != self._last_frequency or self.rate != self._last_rate:
            self._inc = int(self.frequency * _PHASE_CYCLE / self.rate)
            self._last_frequency = self.frequency
            self._last_rate = self.rate

    async def read(self):
        """Source mode: fill self.buffer with the scaled waveform."""
        return await self.read_into(self.buffer)

    async def read_into(self, buf):
        """Source mode: fill the provided buffer with the scaled waveform."""
        if not self.enabled:
            for i in range(len(buf)):
                buf[i] = 0
            self.level = 0.0
            return 0
        self._ensure_scaled_table()
        self._reseed_phase()
        self._update_inc()
        phase, peak = _fill(
            buf,
            self._scaled_table,
            self._inc,
            self._phase,
            _PHASE_SHIFT,
            _WAVETABLE_MASK,
            _PHASE_CYCLE,
        )
        self._phase = phase
        self.level = peak / 32768.0
        return len(buf) * 2

    def process(self, buf):
        """Filter mode: add the scaled waveform into the incoming buffer."""
        if not self.enabled:
            return
        self._ensure_scaled_table()
        self._reseed_phase()
        self._update_inc()
        self._phase = _mix(
            buf,
            self._scaled_table,
            self._inc,
            self._phase,
            _PHASE_SHIFT,
            _WAVETABLE_MASK,
            _PHASE_CYCLE,
            1 if self.saturate else 0,
        )
        self.level = self.mix

    def _reseed_phase(self):
        if self.phase != self._last_phase:
            self._phase = int((self.phase % 360.0) / 360.0 * _PHASE_CYCLE)
            self._last_phase = self.phase

    def _clamp(self, v):
        return _clamp16(v)

    def _wrap(self, v):
        v &= 0xFFFF
        if v > 32767:
            v -= 65536
        return v

