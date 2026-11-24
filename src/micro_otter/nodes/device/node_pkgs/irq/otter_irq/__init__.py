# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""GPIO interrupt registry backing the ``irq`` node package.

``interrupts`` owns one :class:`interrupts.InterruptInput` per named interrupt
channel, attaches the pin interrupts without allocating inside the ISR and
provides the ``ThreadSafeFlag`` wait used by ``irq``-mode graphs.
"""

from . import interrupts

__all__ = ['interrupts']
