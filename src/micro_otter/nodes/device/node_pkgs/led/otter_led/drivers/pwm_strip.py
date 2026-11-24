# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

"""PWM RGB strip driver."""

import sys

try:
    from machine import PWM, Pin

    _IMPORT_ERROR = None
except ImportError as err:  # pragma: no cover - host fallback
    PWM = None
    Pin = None
    _IMPORT_ERROR = err

_ON_MICROPYTHON = sys.implementation.name == 'micropython'


def _warn_once(warned, message):
    """Emit ``[warning] led: message`` at most once, tracked by the ``warned`` set."""
    if message in warned:
        return
    warned.add(message)
    print('[warning] led: {}'.format(message))


def duty_from_float(value, max_duty=1023):
    if value < 0.0:
        value = 0.0
    elif value > 1.0:
        value = 1.0
    return int(value * max_duty + 0.5)


class PwmStrip:
    """Drive a three-channel RGB LED via three PWM outputs."""

    def __init__(self, red_pin, green_pin, blue_pin, freq=1000):
        self._pwms = []
        self.unavailable_reason = None
        self._warnings = set()
        self._last = None

        for name, pin_id in (
            ('red_pin', red_pin),
            ('green_pin', green_pin),
            ('blue_pin', blue_pin),
        ):
            if not isinstance(pin_id, int):
                raise ValueError(f'{name} must be an int, got {type(pin_id).__name__}')

        if _IMPORT_ERROR is not None:
            if _ON_MICROPYTHON:
                raise RuntimeError(
                    'LED driver unavailable: firmware is missing the machine module; '
                    f'PWM output cannot be driven ({_IMPORT_ERROR})'
                )
            self.unavailable_reason = str(_IMPORT_ERROR)
            return

        for pin_id in (red_pin, green_pin, blue_pin):
            pwm = PWM(Pin(pin_id), freq=freq)
            pwm.duty(0)
            self._pwms.append(pwm)

    def write(self, r, g, b):
        """Apply the RGB duty cycles, skipping a frame when unchanged.

        The LED hardware latches its last duty cycle, so an identical triple is
        not re-applied.
        """
        if not self._pwms:
            if self.unavailable_reason is not None:
                _warn_once(
                    self._warnings,
                    f'{type(self).__name__}: hardware unavailable '
                    f'({self.unavailable_reason}); simulating on host',
                )
            return
        duties = tuple(duty_from_float(value) for value in (r, g, b))
        if duties == self._last:
            return
        for pwm, duty in zip(self._pwms, duties):
            pwm.duty(duty)
        self._last = duties
