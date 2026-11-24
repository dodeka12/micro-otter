# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

from machine import Pin, time_pulse_us
import time


class Ultrasonic:
    def __init__(
        self,
        trigger_pin_num: int,
        echo_pin_num: int,
        timeout: int = 20000,
    ) -> None:
        """Initialize the ultrasonic sensor.

        Args:
            trigger_pin_num (int): GPIO pin number for the trigger signal.
            echo_pin_num (int): GPIO pin number for the echo signal.
            timeout (int): Maximum time to wait for an echo in microseconds.
        """
        self.trigger_pin = Pin(trigger_pin_num, Pin.OUT)
        self.echo_pin = Pin(echo_pin_num, Pin.IN)
        self.timeout = timeout

    def measure_distance(self) -> float:
        """Measure the distance using the ultrasonic sensor.

        Returns:
            float: Distance in centimeters, or -1 if timeout occurs.
        """
        # Send a 10us pulse to trigger the measurement
        self.trigger_pin.value(0)
        time.sleep_us(2)
        self.trigger_pin.value(1)
        time.sleep_us(10)
        self.trigger_pin.value(0)

        # Measure the duration of the echo pulse
        pulse_duration = time_pulse_us(self.echo_pin, 1, self.timeout)
        if pulse_duration < 0:
            return -1.0  # Timeout occurred

        # Calculate distance in centimeters
        distance_cm = (pulse_duration / 2) / 29.1
        return distance_cm
