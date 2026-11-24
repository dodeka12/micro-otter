# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import array
import time

try:
    import uasyncio as asyncio
except ImportError:  # pragma: no cover - host fallback
    import asyncio

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None

try:
    _ticks_us = time.ticks_us
    _ticks_diff = time.ticks_diff
except AttributeError:  # pragma: no cover - host fallback
    _ticks_us = lambda: int(time.perf_counter() * 1000000)
    _ticks_diff = lambda a, b: a - b


if micropython is not None:
    @micropython.viper
    def _copy(dst, src):
        d = ptr16(dst)
        s = ptr16(src)
        n = int(len(dst))
        m = int(len(src))
        if n > m:
            n = m
        for i in range(n):
            d[i] = s[i]

    @micropython.viper
    def _zero(dst):
        p = ptr16(dst)
        n = int(len(dst))
        for i in range(n):
            p[i] = 0

    @micropython.viper
    def _ramp(dst, start: int, step: int):
        p = ptr16(dst)
        n = int(len(dst))
        g = start
        for i in range(n):
            if g > 32768:
                g = 32768
            v = int(p[i])
            if v > 32767:
                v -= 65536
            p[i] = (v * g) >> 15
            g += step

    @micropython.viper
    def _mix(dst, src):
        d = ptr16(dst)
        s = ptr16(src)
        n = int(len(dst))
        m = int(len(src))
        if n > m:
            n = m
        for i in range(n):
            a = int(d[i])
            if a > 32767:
                a -= 65536
            b = int(s[i])
            if b > 32767:
                b -= 65536
            v = a + b
            if v > 32767:
                v = 32767
            elif v < -32768:
                v = -32768
            d[i] = v
else:
    def _copy(dst, src):
        for i in range(min(len(dst), len(src))):
            dst[i] = src[i]

    def _zero(dst):
        """Zero every sample of a 16-bit buffer (host fallback for the viper loop)."""
        for i in range(len(dst)):
            dst[i] = 0

    def _ramp(dst, start, step):
        """Apply a Q15 gain that starts at ``start`` and grows by ``step`` per sample."""
        g = start
        for i in range(len(dst)):
            if g > 32768:
                g = 32768
            dst[i] = (dst[i] * g) >> 15
            g += step

    def _mix(dst, src):
        for i in range(min(len(dst), len(src))):
            v = int(dst[i]) + int(src[i])
            if v > 32767:
                v = 32767
            elif v < -32768:
                v = -32768
            dst[i] = v


class AudioChain:
    """Shared streaming runtime for audio nodes.

    Sources are read in registration order and mixed into the first source's
    buffer, which becomes the working buffer that flows through the filters and
    into the sink. Node init code registers sources/filters/sink here; a
    generated asyncio task calls run_block() in a loop.

    The primary source is double-buffered: the next block is read into the
    alternate buffer while the current block is being mixed, filtered, and
    written. This overlaps a real-time source's blocking read (e.g. an I2S
    microphone) with CPU processing instead of serialising the two.

    Startup gating keeps power-on transients out of the speaker. The first
    ``warmup_blocks`` blocks are replaced with silence before reaching the sink
    and the filter chain does not run, which discards stale I2S RX DMA content
    and the microphone's power-on pop (and fills the TX DMA ring with silence
    rather than undefined memory). The following ``fade_in_blocks`` blocks are
    ramped from 0 to unity gain, so the output never steps discontinuously from
    silence to full level. Set both to 0 to write the first block immediately.
    """

    def __init__(self):
        self._sources = []
        self._filters = []
        self._sink = None
        self._bufs = None
        self._active = 0
        self._pending = None
        self._read_primary = None
        self._read_primary_src = None
        self.warmup_blocks = 2
        self.fade_in_blocks = 3
        self.blocks = 0
        self.short_reads = 0
        self.read_errors = 0
        self.last_block_us = 0
        self.max_block_us = 0

    def set_source(self, src):
        """Set the primary source (first buffer in the chain)."""
        if src in self._sources:
            self._sources.remove(src)
        self._sources.insert(0, src)

    def add_source(self, src):
        """Append an additional source (mixed into the primary buffer)."""
        self._sources.append(src)

    def add_filter(self, filt):
        self._filters.append(filt)

    def set_sink(self, sink):
        self._sink = sink

    async def run_block(self):
        if not self._sources or self._sink is None:
            return

        primary = self._sources[0]
        if self._read_primary is None or self._read_primary_src is not primary:
            self._read_primary = self._make_read_primary()
            self._read_primary_src = primary

        t0 = _ticks_us()

        if self._bufs is None:
            n = len(primary.buffer)
            self._bufs = (array.array('h', [0] * n), array.array('h', [0] * n))
            self._active = 0
            got = await self._read_primary(self._bufs[0])
            if got is not None and got < n * 2:
                self.short_reads += 1

        if self._pending is None:
            self._pending = asyncio.create_task(
                self._read_primary(self._bufs[self._active ^ 1])
            )

        sources = self._sources
        cur = self._bufs[self._active]

        if self.blocks < self.warmup_blocks:
            # Discard the block the source just produced: it is either stale DMA
            # content or the microphone's power-on transient. Writing silence
            # also primes the TX DMA ring instead of leaving it undefined.
            _zero(cur)
        else:
            for src in sources[1:]:
                await src.read()
                self._mix_into(cur, src.buffer)

            for filt in self._filters:
                filt.process(cur)

            self._apply_fade_in(cur, self.blocks - self.warmup_blocks)

        expected = len(cur) * 2
        try:
            await self._sink.write(cur)
            got = await self._pending
        finally:
            self._pending = None
            self._active ^= 1

        if got is not None and got < expected:
            self.short_reads += 1

        self.blocks += 1
        elapsed = _ticks_diff(_ticks_us(), t0)
        self.last_block_us = elapsed
        if elapsed > self.max_block_us:
            self.max_block_us = elapsed

    def _apply_fade_in(self, buf, index):
        """Ramp ``buf`` from silence to unity gain over the fade-in window.

        Args:
            buf: Working 16-bit sample buffer, modified in place.
            index: Zero-based fade block number (``blocks - warmup_blocks``).

        The per-sample step is derived from the whole fade length, so consecutive
        blocks continue one continuous ramp. No-op outside the fade window; called
        only by `run_block`.
        """
        total_blocks = self.fade_in_blocks
        if total_blocks <= 0 or index < 0 or index >= total_blocks:
            return
        n = len(buf)
        total_samples = total_blocks * n
        if total_samples <= 0:
            return
        step = (32768 + total_samples - 1) // total_samples
        _ramp(buf, index * n * step, step)

    def _make_read_primary(self):
        primary = self._sources[0]
        read_into = getattr(primary, 'read_into', None)
        if callable(read_into):
            return read_into

        async def read_and_copy(buf):
            await primary.read()
            self._copy_into(buf, primary.buffer)

        return read_and_copy

    @staticmethod
    def _copy_into(dst, src):
        _copy(dst, src)

    @staticmethod
    def _mix_into(dst, src):
        """Add src into dst in place, saturating to the 16-bit signed range."""
        _mix(dst, src)
