# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Pulse example add-on base implementation (pure MicroPython).

Defines :func:`high`, the single function the generated program calls for every
``pulse.tick`` node. The base variant stages this module; the viper variant stages
``moa_pulse_viper`` instead, and the generated program imports whichever one the
firmware build made available.
"""


def high(ticks: int, interval: int, duty: int) -> int:
    """Return 1 while the square wave is high and 0 while it is low.

    ``ticks`` is a millisecond tick count (``time.ticks_ms()``). ``interval`` is the
    full period in milliseconds and ``duty`` the percentage of the period spent high.
    The phase wraps on ``interval`` so the caller passes the raw tick count unchanged.
    An interval of zero or less reports the line as low. The fixed-point comparison
    ``elapsed * 100 < interval * duty`` avoids floating point so the same math also
    works in viper, and keeps ``elapsed * 100`` within a 32-bit integer for any
    interval up to about 21 million milliseconds.
    """

    period = int(interval)
    if period <= 0:
        return 0
    elapsed = int(ticks) % period
    return 1 if elapsed * 100 < period * int(duty) else 0
