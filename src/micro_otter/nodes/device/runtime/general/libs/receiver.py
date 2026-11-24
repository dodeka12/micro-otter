# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

from machine import Pin, time_pulse_us
import machine
import time


class Receiver:
    def __init__(
        self,
        pin_num: int,
        timeout: int = 20000,
        pulse_width_range: tuple[int, int] = (1000, 2000),
        calib_values: tuple[int, int, int] = (1000, 1500, 2000),
        calib_mid_null_width: int = 50,
        out_min: float = -100,
        out_max: float = 100,
        num_samples: int = 5,
    ) -> None:
        """Initialize the receiver on the specified pin.

        Uses median filtering to reduce WiFi interference on pulse width measurements.

        Args:
            pin_num (int): GPIO pin number connected to the receiver signal.
            timeout (int): Maximum time to wait for a pulse in microseconds.
            num_samples (int): Number of samples to take for median filtering (default: 5).
        """
        self.pin = Pin(pin_num, Pin.IN)
        self.timeout = timeout
        self.pulse_width_range = pulse_width_range
        self.calib_pw_min, self.calib_pw_mid, self.calib_pw_max = calib_values
        self.calib_mid_half_null_width = calib_mid_null_width // 2
        self.out_min: float = out_min
        self.out_max: float = out_max
        self.out_mid: float = (self.out_min + self.out_max) / 2
        self.num_samples = num_samples
        self.last_valid_value: float = self.out_mid
        self.last_valid_pulse_width: int = self.calib_pw_mid

    def has_signal(self) -> bool:
        """Check if pin is receiving PWM signal by testing with short timeout.

        Returns:
            bool: True if signal detected, False otherwise.
        """
        # Quick test with 3ms timeout (RC signals repeat every 20ms)
        test_pulse = time_pulse_us(self.pin, 1, 3000)
        return test_pulse > 0

    def read_pulse_width(self) -> int:
        """Read the pulse width from the receiver signal with median filtering.

        Takes multiple samples and returns the median value to filter out
        WiFi interference and sporadic timing glitches.

        Returns:
            int: Pulse width in microseconds, or -1 if timeout occurs.
        """
        # First check if there's a signal to avoid long timeout
        # if not self.has_signal():
        #     return -1

        pw1 = time_pulse_us(self.pin, 1, self.timeout)
        pw2 = time_pulse_us(self.pin, 1, self.timeout)
        return max(pw1, pw2)

    # readings = []

    #     # Temporarily disable interrupts for more accurate timing
    #     # This is a brief disable per sample, not across all samples
    #     for _ in range(self.num_samples):
    #         state = machine.disable_irq()
    #         try:
    #             pw = time_pulse_us(self.pin, 1, self.timeout)
    #         finally:
    #             machine.enable_irq(state)

    #         # Only keep valid readings
    #         if pw > 0:
    #             readings.append(pw)

    #     # Return median to filter out outliers caused by WiFi interference
    #     if readings:
    #         readings.sort()
    #         median_idx = len(readings) // 2
    #         return readings[median_idx]

    #     return -1

    def is_signal_valid(self) -> bool:
        """Check if the received signal is valid based on pulse width.

        Returns:
            bool: True if the signal is valid, False otherwise.
        """
        pulse_width = self.read_pulse_width()
        return self.pulse_width_range[0] <= pulse_width <= self.pulse_width_range[1]

    def map_to_output(self, pulse_width: int) -> float:
        """Map the pulse width to a specified output range.

        Args:
            pulse_width (int): The pulse width to map.
            out_min (float): Minimum of the output range.
            out_max (float): Maximum of the output range.

        Returns:
            float: Mapped value in the output range.
        """
        if pulse_width < self.calib_pw_mid - self.calib_mid_half_null_width:
            pulse_width = int(max(pulse_width, self.calib_pw_min))
            pw_min = self.calib_pw_min
            pw_max = self.calib_pw_mid - self.calib_mid_half_null_width
            eff_out_min = self.out_min
            eff_out_max = self.out_mid
        elif pulse_width > self.calib_pw_mid + self.calib_mid_half_null_width:
            pulse_width = int(min(pulse_width, self.calib_pw_max))
            pw_min = self.calib_pw_mid + self.calib_mid_half_null_width
            pw_max = self.calib_pw_max
            eff_out_min = self.out_mid
            eff_out_max = self.out_max
        else:
            return self.out_mid

        mapped_value = (pulse_width - pw_min) * (eff_out_max - eff_out_min) / (
            pw_max - pw_min
        ) + eff_out_min
        return mapped_value

    def get_value(self) -> float:
        """Get the mapped value of the current pulse width.

        The input pulse width is read and then mapped to the specified output range.
        The input pulse is clamped based on calibration values.

        If no signal is detected, returns the last valid value (or neutral if never valid).

        Returns:
            float: Mapped value in the output range.
        """
        pulse_width = self.read_pulse_width()

        # If no signal detected, return neutral value
        if pulse_width < 0:
            return self.out_mid

        # Check if pulse width is in valid range
        if self.pulse_width_range[0] <= pulse_width <= self.pulse_width_range[1]:
            self.last_valid_pulse_width = pulse_width
            self.last_valid_value = self.map_to_output(pulse_width)
            return self.last_valid_value

        # Invalid pulse width, return last valid value
        return self.last_valid_value
