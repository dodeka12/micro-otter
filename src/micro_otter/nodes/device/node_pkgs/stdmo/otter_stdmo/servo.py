# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import time

from machine import PWM, Pin

try:
    import traceback
except ImportError:  # pragma: no cover - MicroPython variants may not include traceback
    traceback = None


def _log_exception(context: str, exc: Exception) -> None:
    print(f"[error] servo: {context} ({exc})")
    if traceback is None:
        return
    try:
        traceback.print_exception(type(exc), exc, exc.__traceback__)
    except Exception:
        pass


class Servo:
    def __init__(
        self,
        pwm_pin_num: int,
        freq: int = 50,
        min_us: int = 1000,
        max_us: int = 2000,
        angle_range: tuple[int, int] = [-90, 90],
        max_angle_change_per_sec: float = 180.0,
    ) -> None:
        """Initialize the servo control.

        Args:
            pwm_pin_num (int): GPIO pin number for PWM control.
            freq (int): Frequency for PWM signal.
            min_us (int): Minimum pulse width in microseconds.
            max_us (int): Maximum pulse width in microseconds.
            angle_range (tuple[int, int]): Total range of motion in degrees. Tuple is [min_angle, max_angle].
        """
        try:
            self.pwm = PWM(Pin(pwm_pin_num), freq=freq)
            self.min_us = min_us
            self.max_us = max_us
            self.angle_range = angle_range
            self.angle: float = 0.0
            self.max_angle_change_per_sec = max_angle_change_per_sec
            self.prev_angle_set_ticks_ms: int = 0
        except Exception as exc:
            _log_exception(f"init failed (pin={pwm_pin_num})", exc)
            raise

    def set_angle(self, angle: float) -> None:
        """Set the servo angle.

        Args:
            angle (float): Desired angle in degrees (0 to angle_range).
        """
        try:
            now_ticks_ms = time.ticks_ms()
            ticks_diff_ms = time.ticks_diff(now_ticks_ms, self.prev_angle_set_ticks_ms)
            if ticks_diff_ms < 20:
                return  # Limit angle updates to every 20 ms
            self.prev_angle_set_ticks_ms = now_ticks_ms

            angle = float(
                max(self.angle_range[0], min(self.angle_range[1], angle))
            )  # Clamp angle to range
            angle_gradient = (angle - self.angle) * 1000.0 / ticks_diff_ms
            if abs(angle_gradient) > self.max_angle_change_per_sec:
                angle = (
                    self.angle
                    + (angle_gradient / abs(angle_gradient))
                    * (ticks_diff_ms / 1000.0)
                    * self.max_angle_change_per_sec
                )

            self.angle = angle
            angle_span = self.angle_range[1] - self.angle_range[0]
            if angle_span == 0:
                raise ValueError("angle_range must have a non-zero span")

            pulse_width_us = int(
                self.min_us
                + (self.angle - self.angle_range[0])
                * (self.max_us - self.min_us)
                / angle_span
            )
            duty_cycle = int(pulse_width_us * 65535 / (1000000 / self.pwm.freq()))
            self.pwm.duty_u16(duty_cycle)
        except Exception as exc:
            _log_exception(f"set_angle failed (angle={angle})", exc)
            raise
