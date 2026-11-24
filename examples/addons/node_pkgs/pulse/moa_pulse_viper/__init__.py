# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
"""Pulse example add-on viper implementation.

Selected only on targets that advertise the ``viper`` capability. Exposes the same
:func:`high` API as the base ``moa_pulse`` module, so the generated program can call
either module unchanged.
"""

try:
    import micropython
except ImportError:  # pragma: no cover - host fallback
    micropython = None


if micropython is not None:

    @micropython.viper
    def high(ticks: int, interval: int, duty: int) -> int:
        """Return 1 while the square wave is high and 0 while it is low.

        Viper-native equivalent of :func:`moa_pulse.high` using 32-bit machine
        integers. ``duty`` is expected in the 0..100 range (the generator clamps it);
        ``interval`` must be positive and small enough that ``elapsed * 100`` does not
        overflow a 32-bit integer (about 21 million milliseconds).
        """

        if interval <= 0:
            return 0
        elapsed = ticks % interval
        return 1 if elapsed * 100 < interval * duty else 0

else:

    def high(ticks: int, interval: int, duty: int) -> int:
        """Host fallback mirroring :func:`moa_pulse.high` for CPython tests."""

        period = int(interval)
        if period <= 0:
            return 0
        elapsed = int(ticks) % period
        return 1 if elapsed * 100 < period * int(duty) else 0
