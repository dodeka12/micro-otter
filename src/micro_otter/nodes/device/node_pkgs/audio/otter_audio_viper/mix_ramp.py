# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

_MIX_ONE = 32768
_FADE_SAMPLES = 128


class MixRamp:
    """Q15 dry/wet ramp shared by the block effects.

    ``mix`` is the user-facing control (0..1): 0 leaves the signal bit-exact
    (dry), 1 applies the full effect (wet). ``enabled`` mirrors the node's bypass
    switch. ``update()`` turns both into a Q15 ``target`` which is 0 whenever the
    effect is disabled, so switching the effect off fades to the dry signal
    instead of stepping at a block boundary.

    The per-sample loops receive ``cur``/``target``/``step`` as plain ints and
    move ``cur`` toward ``target`` by ``step`` for every sample they process.
    ``advance()`` repeats that arithmetic in O(1), so a node can store the new
    position without its loop having to return it. Nothing here allocates, and
    the loop itself does not need to touch this object.

    The first ``update()`` snaps ``cur`` to ``target``: values set before the
    first block are applied immediately, later changes fade over
    ``fade_samples`` samples (128 ≈ 8 ms at 16 kHz) so dragging a slider or
    toggling the effect never clicks.
    """

    def __init__(self, fade_samples=_FADE_SAMPLES):
        fade = int(fade_samples)
        if fade < 1:
            fade = 1
        self.fade_samples = fade
        step = _MIX_ONE // fade
        self.step = step if step > 0 else 1
        self.mix = 1.0
        self.enabled = True
        self.target = self._to_q15(1.0)
        self.cur = self.target
        self._pending = True

    @staticmethod
    def _to_q15(value):
        """Clamp ``value`` to 0..1 and return it as Q15."""
        if value < 0.0:
            value = 0.0
        elif value > 1.0:
            value = 1.0
        return int(value * _MIX_ONE)

    def update(self):
        """Recompute ``target`` from ``mix``/``enabled``; returns it as Q15."""
        if self.enabled:
            self.target = self._to_q15(self.mix)
        else:
            self.target = 0
        if self._pending:
            self.cur = self.target
            self._pending = False
        return self.target

    def advance(self, samples):
        """Move ``cur`` by ``samples`` ramp steps toward ``target`` (O(1))."""
        cur = self.cur
        target = self.target
        if cur == target or samples <= 0:
            return cur
        delta = int(samples) * self.step
        if cur < target:
            cur += delta
            if cur > target:
                cur = target
        else:
            cur -= delta
            if cur < target:
                cur = target
        self.cur = cur
        return cur
