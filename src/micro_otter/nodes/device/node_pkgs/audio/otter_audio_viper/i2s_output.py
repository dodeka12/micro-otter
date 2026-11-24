# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import uasyncio as asyncio
from machine import I2S, Pin


class I2SOutput:
    """I2S speaker sink with optional amplifier control pins.

    The amplifier is kept muted (``sd_pin`` low) until the first block has been
    written, so it cannot pop into an unprimed I2S TX DMA ring at power-on. The
    chain's warm-up phase writes silence first, so the amplifier is unmuted onto
    a DMA ring that already contains silence.
    """

    def __init__(self, i2s_id=1, bclk_pin=4, ws_pin=5, data_pin=6,
                 rate=16000, bits=16, block_samples=256,
                 sd_pin=None, gain_pin=None, gain_high=True, ibuf_blocks=8):
        self.block_samples = block_samples
        bytes_per_sample = bits // 8
        self._i2s = I2S(
            i2s_id,
            sck=Pin(bclk_pin),
            ws=Pin(ws_pin),
            sd=Pin(data_pin),
            mode=I2S.TX,
            bits=bits,
            format=I2S.MONO,
            rate=rate,
            ibuf=block_samples * bytes_per_sample * ibuf_blocks,
        )
        self._writer = asyncio.StreamWriter(self._i2s)
        self._sd = Pin(sd_pin, Pin.OUT) if sd_pin is not None else None
        # The gain pin selects the amplifier gain. Its effect is hardware
        # dependent, so it is exposed as a boolean: high vs. low.
        self._gain = Pin(gain_pin, Pin.OUT) if gain_pin is not None else None
        self._gain_high = True
        self.enabled = True
        self._amp_on = False
        if self._sd is not None:
            # Start muted; `write()` unmutes once audio actually flows.
            self._sd.value(0)
        self.gain_high = gain_high

    @property
    def gain_high(self):
        return self._gain_high

    @gain_high.setter
    def gain_high(self, value):
        self._gain_high = bool(value)
        if self._gain is not None:
            self._gain.value(1 if self._gain_high else 0)

    def _set_amp(self, on):
        """Drive the shutdown pin: high unmutes the amplifier, low mutes it.

        No-op when the node has no `sd_pin` assigned. Called by `enable`,
        `mute` and the first `write` after a mute.
        """
        self._amp_on = on
        if self._sd is not None:
            self._sd.value(1 if on else 0)

    def enable(self):
        """Unmute the amplifier and resume writing output blocks."""
        self.enabled = True
        self._set_amp(True)

    def mute(self):
        """Mute the amplifier and stop writing output blocks."""
        self.enabled = False
        self._set_amp(False)

    async def write(self, buf):
        if not self.enabled:
            return
        if not self._amp_on:
            self._set_amp(True)
        self._writer.write(buf)
        await self._writer.drain()
