# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
import uasyncio as asyncio


async def run() -> None:
    count = 0
    while True:
        print(f"[user] Main loop: Doing nothing... {count}")
        count += 1
        await asyncio.sleep_ms(1000)
