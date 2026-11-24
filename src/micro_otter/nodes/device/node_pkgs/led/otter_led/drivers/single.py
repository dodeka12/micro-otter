# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

"""Single PWM LED driver."""

import sys

from .pwm_strip import _warn_once, duty_from_float

try:
    from machine import PWM, Pin

    _IMPORT_ERROR = None
except ImportError as err:  # pragma: no cover - host fallback
    PWM = None
    Pin = None
    _IMPORT_ERROR = err

_ON_MICROPYTHON = sys.implementation.name == 'micropython'


class SingleLed:
    """Drive a single-color LED from one PWM output."""

    def __init__(self, pin, freq=1000):
        self._pwm = None
        self.unavailable_reason = None
        self._warnings = set()
        self._last = None

        if not isinstance(pin, int):
            raise ValueError(f'pin must be an int, got {type(pin).__name__}')

        if _IMPORT_ERROR is not None:
            if _ON_MICROPYTHON:
                raise RuntimeError(
                    'LED driver unavailable: firmware is missing the machine module; '
                    f'PWM output cannot be driven ({_IMPORT_ERROR})'
                )
            self.unavailable_reason = str(_IMPORT_ERROR)
            return

        self._pwm = PWM(Pin(pin), freq=freq)
        self._pwm.duty(0)

    def write(self, value):
        """Apply the brightness duty cycle, skipping a frame when unchanged.

        The LED hardware latches its last duty cycle, so an identical value is
        not re-applied.
        """
        if self._pwm is None:
            if self.unavailable_reason is not None:
                _warn_once(
                    self._warnings,
                    f'{type(self).__name__}: hardware unavailable '
                    f'({self.unavailable_reason}); simulating on host',
                )
            return
        duty = duty_from_float(value)
        if duty == self._last:
            return
        self._pwm.duty(duty)
        self._last = duty
