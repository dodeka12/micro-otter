# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import time
import math


class Oscillation:
    def __init__(
        self,
        amplitude_range: tuple[float, float],
        frequency: float,
        offset: float = 0.0,
    ) -> None:
        """Initialize the oscillation parameters.

        Args:
            amplitude (float): Amplitude of the oscillation.
            frequency (float): Frequency of the oscillation in Hz.
            offset (float): Offset value to shift the oscillation.
        """
        self.amplitude_range = amplitude_range  # (min, max)
        self.frequency = frequency
        self.offset = offset
        self.mid_amplitude = (self.amplitude_range[0] + self.amplitude_range[1]) / 2.0
        self.start_time = time.ticks_ms()

    def get_value(self) -> float:
        """Get the current value of the oscillation.

        Returns:
            float: Current oscillation value.
        """
        elapsed_time_ms = time.ticks_diff(time.ticks_ms(), self.start_time)
        elapsed_time_s = elapsed_time_ms / 1000.0

        amplitude_half_range = (self.amplitude_range[1] - self.amplitude_range[0]) / 2.0

        oscillation_value = self.mid_amplitude + amplitude_half_range * math.sin(
            2 * math.pi * self.frequency * elapsed_time_s
        )
        return oscillation_value + self.offset
