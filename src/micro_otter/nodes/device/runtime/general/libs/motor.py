# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

from machine import PWM, Pin
import time


class Motor:
    def __init__(
        self,
        pwm_pin_num: int,
        in1_pin_num: int,
        in2_pin_num: int,
        freq: int = 100,
        max_speed_change_per_sec: float = 3.0,
    ) -> None:
        """Initialize the motor control.

        Args:
            pwm_pin_num (int): GPIO pin number for PWM control.
            in1_pin_num (int): GPIO pin number for IN1 control.
            in2_pin_num (int): GPIO pin number for IN2 control.
            freq (int): Frequency for PWM signal.
        """
        self.pwm = PWM(Pin(pwm_pin_num), freq=freq)
        self.in1_pin = Pin(in1_pin_num, Pin.OUT)
        self.in2_pin = Pin(in2_pin_num, Pin.OUT)

        self.max_speed_change_per_sec = max_speed_change_per_sec
        self.speed: float = 0.0  # Speed as a percentage (-100 to 100)
        self.prev_speed_set_ticks_ms: int = 0
        self.set_speed(0.0)

    def set_speed(self, speed: float) -> None:
        """Set the motor speed and direction.

        Args:
            speed (float): Speed percentage (-1 to 1). Negative for reverse.
        """
        now_ticks_ms = time.ticks_ms()
        ticks_diff_ms = time.ticks_diff(now_ticks_ms, self.prev_speed_set_ticks_ms)
        if ticks_diff_ms < 20:
            return  # Limit speed updates to every 20 ms
        self.prev_speed_set_ticks_ms = now_ticks_ms

        speed = float(max(-1.0, min(1.0, speed)))  # Clamp speed to -100 to 100
        speed_gradient = (speed - self.speed) * 1000.0 / ticks_diff_ms
        if abs(speed_gradient) > self.max_speed_change_per_sec:
            speed = (
                self.speed
                + (speed_gradient / abs(speed_gradient))
                * (ticks_diff_ms / 1000.0)
                * self.max_speed_change_per_sec
            )

        self.speed = speed
        if speed >= 0:
            self.in1_pin.value(1)  # Forward
            self.in2_pin.value(0)
        else:
            self.in1_pin.value(0)  # Reverse
            self.in2_pin.value(1)

        duty_cycle_u16 = int(abs(speed) * 65535)
        if duty_cycle_u16 > 1000:
            duty_cycle_u16 += 5000  # Avoid very low duty cycles
        else:
            duty_cycle_u16 = 0
        # clamp to max 65535
        duty_cycle_u16 = min(duty_cycle_u16, 65535)

        self.pwm.duty_u16(duty_cycle_u16)

    def stop(self) -> None:
        """Stop the motor."""
        self.pwm.duty_u16(0)
        self.in1_pin.value(0)
        self.in2_pin.value(0)
        self.speed = 0
