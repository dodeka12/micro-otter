# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import array

import uasyncio as asyncio
from machine import I2S, Pin

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None


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
else:
    def _peak(buf):
        peak = 0
        for v in buf:
            a = v if v >= 0 else -v
            if a > peak:
                peak = a
        return peak


class I2SInput:
    def __init__(self, i2s_id=0, bclk_pin=4, ws_pin=5, data_pin=7,
                 rate=16000, bits=16, block_samples=256, ibuf_blocks=8):
        self.block_samples = block_samples
        self.bits = bits
        bytes_per_sample = bits // 8
        self.buffer = array.array('h', [0] * block_samples)
        self.level = 0.0
        self.enabled = True
        self.short_reads = 0
        self._mv0 = None
        self._mv1 = None
        self._mv_buf0 = None
        self._mv_buf1 = None
        self._i2s = I2S(
            i2s_id,
            sck=Pin(bclk_pin),
            ws=Pin(ws_pin),
            sd=Pin(data_pin),
            mode=I2S.RX,
            bits=bits,
            format=I2S.MONO,
            rate=rate,
            ibuf=block_samples * bytes_per_sample * ibuf_blocks,
        )
        self._reader = asyncio.StreamReader(self._i2s)

    async def read(self):
        return await self.read_into(self.buffer)

    def _view_for(self, buf):
        """Return a cached memoryview for ``buf`` (two alternating buffers max)."""
        if self._mv_buf0 is buf:
            return self._mv0
        if self._mv_buf1 is buf:
            return self._mv1
        # A buffer we have not seen yet: evict slot 1 and slide slot 0 down.
        self._mv_buf1 = self._mv_buf0
        self._mv1 = self._mv0
        self._mv_buf0 = buf
        self._mv0 = memoryview(buf)
        return self._mv0

    async def read_into(self, buf):
        """Fill ``buf`` with a full block of samples.

        ``asyncio.StreamReader.readinto`` (asyncio I2S mode) may return a
        partial read, so loop until the whole buffer has been filled. The
        memoryview is cached per buffer and the tail is zero-filled on a short
        read, so stale samples from the previous block never leak into output.
        """
        if not self.enabled:
            for i in range(len(buf)):
                buf[i] = 0
            self.level = 0.0
            return 0
        mv = self._view_for(buf)
        sample_count = len(buf)
        samples_read = 0
        while samples_read < sample_count:
            view = mv if samples_read == 0 else mv[samples_read:]
            got = await self._reader.readinto(view)
            if not got:
                for i in range(samples_read, sample_count):
                    buf[i] = 0
                self.short_reads += 1
                break
            samples_read += got // 2
        self._update_level(buf)
        return samples_read * 2

    def _update_level(self, buf):
        self.level = _peak(buf) / 32768.0
