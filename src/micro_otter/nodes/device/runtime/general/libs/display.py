# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

from machine import Pin, SoftI2C
import gc
import time

from drivers.sh1106.sh1106 import SH1106_I2C as DisplayDriver
from gui.widgets.meter import Meter
from gui.core.writer import Writer
from gui.core.nanogui import refresh
from gui.widgets.label import Label
from gui.core.colors import init_color_constants

# Fonts
import gui.fonts.arial10 as font_arial10
import gui.fonts.courier20 as font_fixed
import gui.fonts.font6 as font_small


class Display:
    def __init__(
        self,
        width: int,
        height: int,
        scl_num: int,
        sda_num: int,
        rotate: int = 0,
        address: int = 0x3C,
    ):
        self.i2c_bus = SoftI2C(scl=Pin(scl_num), sda=Pin(sda_num))
        self.display = DisplayDriver(
            width=width, height=height, i2c=self.i2c_bus, addr=address
        )
        init_color_constants(self.display)
        self.display.fill(0)
        self.display.show()

    def clear(self):
        refresh(self.display, clear=True)

    def refresh(self):
        refresh(self.display)

    def show_text(self, text, x=0, y=0):
        self.display.text(text, x, y)
        self.refresh()

    # def show_image(self, image_data):
    #     self.display.image(image_data)
    #     self.display.show()

    # def meter(self):
    #     self.clear()
    #     wri = Writer(self.display, font_arial10, verbose=False)
    #     m0 = Meter(wri, 5, 2, height=50, divisions=4, legends=("0.0", "0.5", "1.0"))
    #     m1 = Meter(wri, 5, 44, height=50, divisions=4, legends=("-1", "0", "+1"))
    #     m2 = Meter(wri, 5, 86, height=50, divisions=4, legends=("-1", "0", "+1"))
    #     steps = 10
    #     random = xorshift64star(2**24 - 1)
    #     for n in range(steps + 1):
    #         m0.value(random() / 16777216)
    #         m1.value(n / steps)
    #         m2.value(1 - n / steps)
    #         refresh(ssd)
    #         utime.sleep(1)
