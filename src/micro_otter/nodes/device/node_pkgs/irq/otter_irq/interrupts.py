# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Module-level registry of GPIO interrupt channels for the ``irq`` package.

The module is used as a singleton (``import otter_irq.interrupts as _otter_irq``),
so every channel lives in the module-global ``_CHANNELS`` map and survives a
reload of ``app.main_loop``. That is why generated code calls
:func:`begin_generation` once per program: it detaches the stale pins of the
previous incarnation before the generated init block creates the channels again.

``machine`` is deliberately *not* imported here. The generated init block builds
the ``Pin`` object and passes it in, together with a ``Pin.IRQ_*`` constant, so
this module stays importable on CPython and testable with a fake pin.

ISR discipline (the handler runs on the interrupt context):

* the handler is a bound method stored once on the instance, so
  ``pin.irq(handler=...)`` never allocates a bound method;
* the body is a gate, an optional debounce, a masked integer increment and one
  ``ThreadSafeFlag.set()`` - no string work, no containers, no logging.
"""

try:
    import uasyncio as _asyncio
except ImportError:  # pragma: no cover - fallback for host tooling
    import asyncio as _asyncio

try:
    import utime as _time
except ImportError:  # pragma: no cover - fallback for host tooling
    import time as _time

#: Counter wrap mask. MicroPython small ints are 31 bit, so the ISR increments
#: through this mask instead of growing a big integer on the heap.
_COUNT_MASK = 0x3FFFFFFF

#: Every live channel, keyed by its trimmed interrupt name. Insertion ordered.
_CHANNELS = {}


def _ticks_ms():
    """Return the current monotonic millisecond count.

    Uses ``utime.ticks_ms`` on the board and falls back to ``int(time() * 1000)``
    on the host, exactly like ``runtime/general/otter_main.py``.
    """
    if hasattr(_time, 'ticks_ms'):
        return _time.ticks_ms()
    if hasattr(_time, 'time'):
        return int(_time.time() * 1000)
    return 0


def _ticks_diff(current, previous):
    """Return ``current - previous`` in milliseconds, wrap-safe on the board."""
    if hasattr(_time, 'ticks_diff'):
        return _time.ticks_diff(current, previous)
    return current - previous


class _HostFlag:
    """``ThreadSafeFlag`` stand-in for CPython, which has no such class.

    ``asyncio.Event`` behaves the same way for the one property this module
    needs: :meth:`wait` returns immediately when the flag was set before the
    call and consumes that set, so a second wait blocks again.
    """

    def __init__(self):
        """Create the backing event in the cleared state."""
        self._event = _asyncio.Event()

    def set(self):
        """Raise the flag; safe to call from a signal-style context on the host."""
        self._event.set()

    async def wait(self):
        """Return once the flag is set, then clear it again."""
        await self._event.wait()
        self._event.clear()


def _new_flag():
    """Return a ``ThreadSafeFlag`` when the runtime has one, else a `_HostFlag`."""
    flag_type = getattr(_asyncio, 'ThreadSafeFlag', None)
    if flag_type is None:
        return _HostFlag()
    return flag_type()


class InterruptInput:
    """One GPIO interrupt channel: ISR gate, edge counter and awaiting flag."""

    def __init__(self, name, pin, trigger, debounce_ms=0):
        """Store the channel configuration; the caller arms ``pin`` afterwards.

        ``trigger`` is the already resolved ``Pin.IRQ_*`` constant, so this class
        never needs ``machine``. ``handler`` is a single bound method created
        here and reused by every ``pin.irq(handler=...)`` call.
        """
        self.name = name
        self.pin = pin
        self.trigger = trigger
        self.debounce_ms = debounce_ms
        self._enabled = True
        self._count = 0
        self._seen = 0
        self._last_ms = 0
        self._flag = _new_flag()
        self.handler = self._isr

    def _isr(self, _pin):
        """Count one interrupt edge; runs in interrupt context.

        Allocates nothing: the gate is a boolean, the debounce is one
        ``ticks_diff`` on two integers, the counter increment is masked to stay a
        small int and the wake-up is a pre-bound ``set`` on the flag. The ``pin``
        argument the runtime passes is ignored on purpose.
        """
        if not self._enabled:
            return
        if self.debounce_ms > 0:
            now = _ticks_ms()
            if _ticks_diff(now, self._last_ms) < self.debounce_ms:
                return
            self._last_ms = now
        self._count = (self._count + 1) & _COUNT_MASK
        self._flag.set()

    def take(self):
        """Return ``True`` once per observed batch of edges, ``False`` otherwise.

        The ISR counter is compared with a main-context cursor, so a burst of
        edges reports ``True`` exactly once and ``False`` afterwards. This never
        touches the flag: polling (continuous) graphs can use ``take()`` without
        consuming the wake-up an ``irq`` graph is waiting for.
        """
        if self._count == self._seen:
            return False
        self._seen = self._count
        return True

    def count(self):
        """Return the number of edges seen since :func:`create_input`."""
        return self._count

    def state(self):
        """Return the current pin level as a boolean."""
        return bool(self.pin.value())

    async def wait(self):
        """Wait for the next edge, returning immediately for a latched one.

        A ``ThreadSafeFlag`` supports a single waiter: only the task that runs
        the channel's graph may await this, otherwise a wake-up is lost.
        """
        await self._flag.wait()

    def set_enabled(self, enabled):
        """Arm or detach the pin interrupt; a no-op when the state is unchanged.

        Disabling clears the ISR gate *before* detaching the pin, enabling sets
        it *before* re-attaching, so no edge can slip through the half-applied
        state. The early return keeps the ``interrupt-enable`` node free to call
        this on every loop iteration without a syscall.
        """
        if enabled == self._enabled:
            return
        if enabled:
            self._enabled = True
            self.pin.irq(handler=self.handler, trigger=self.trigger)
        else:
            self._enabled = False
            self.pin.irq(handler=None)

    def detach(self):
        """Detach the pin interrupt without touching the counter or the flag."""
        self.pin.irq(handler=None)


def create_input(name, pin, trigger, debounce_ms=0):
    """Create the channel called ``name``, arm ``pin`` and return the channel.

    A second call with the same name replaces the previous entry and re-arms
    that pin. An empty name is a programming error and raises ``ValueError``.
    """
    trimmed = name
    if isinstance(trimmed, str):
        trimmed = trimmed.strip()
    if not trimmed:
        raise ValueError('interrupt name is required')
    channel = InterruptInput(trimmed, pin, trigger, debounce_ms)
    _CHANNELS[trimmed] = channel
    pin.irq(handler=channel.handler, trigger=trigger)
    return channel


def get_input(name):
    """Return the channel registered under ``name``, or ``None``."""
    return _CHANNELS.get(name)


def set_enabled(name, enabled):
    """Enable or disable the channel ``name``; ``False`` when it is unknown."""
    channel = _CHANNELS.get(name)
    if channel is None:
        return False
    channel.set_enabled(bool(enabled))
    return True


async def wait(name):
    """Await the next edge of the channel ``name``.

    Raises ``KeyError`` for an unknown name: the transpiler validates every
    ``irq`` binding before generating code, so an unknown name here is a
    programming error rather than a user mistake.
    """
    channel = _CHANNELS.get(name)
    if channel is None:
        raise KeyError('no interrupt input named ' + str(name))
    await channel.wait()


def begin_generation():
    """Detach every channel, in registration order, and empty the registry.

    Called once per generated ``app/main_loop.py`` through the shared-init block.
    ``otter_irq.interrupts`` itself is never reloaded by
    ``otter_runtime.module_utils.reload_module``, so the previous incarnation's
    channels would otherwise keep their pins armed against a dead event loop.
    """
    for channel in _CHANNELS.values():
        channel.detach()
    _CHANNELS.clear()
