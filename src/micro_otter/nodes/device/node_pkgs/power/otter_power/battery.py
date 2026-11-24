# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

from machine import ADC, Pin


class BatteryMonitor:
    def __init__(self, adc_pin=1, top_k=100.0, bottom_k=22.0, cells=4,
                 warn_v_cell=3.4, cut_v_cell=3.1):
        self._adc = ADC(Pin(adc_pin))
        self._adc.atten(ADC.ATTN_11DB)
        self._ratio = (top_k + bottom_k) / bottom_k
        self.cells = cells
        self.warn_v_cell = warn_v_cell
        self.cut_v_cell = cut_v_cell
        self.voltage = 0.0
        self.warn = False
        self.low = False
        self.critical = False

    def update(self):
        raw = self._adc.read_u16()
        v_adc = raw / 65535.0 * 3.3
        self.voltage = v_adc * self._ratio
        v_cell = self.voltage / self.cells
        self.warn = v_cell <= self.warn_v_cell
        self.low = v_cell <= self.cut_v_cell
        self.critical = self.low
        return self.voltage
