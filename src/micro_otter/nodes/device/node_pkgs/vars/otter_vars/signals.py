# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Named pulse signals for cross-graph triggers.

A signal is a short-lived name that a ``signal-post`` node raises and that an
``event`` graph watches. The module is a module-level singleton behind
``ensure_signals()``, so the generated code reads ``_signals.define(...)``,
``_signals.wait(...)``, ``_signals.post(...)`` and ``_signals.edge(...)``.

``_pending[key]`` only ever holds names from that key's watch list (``post()``
fans out through ``_watchers``, which ``define()`` built), so
``len(pending) == len(names)`` is a valid ``all`` test. ``wait()`` and
``fired()`` may assume ``define()`` ran first; ``post()`` must tolerate unknown
names.

Each listener key gets its own private ``asyncio.Event`` plus a pending set. A
shared event would let one listener starve another (``Event.clear()`` is
global), and a ``clear()``-after-check order would reopen a lost-wakeup window,
so ``wait()`` clears the event before checking the pending set.
"""

import uasyncio as asyncio


class Signals:
    """Collection-wide pulse signals consumed by ``event`` graphs."""

    def __init__(self):
        # One private doorbell per listener key; the pending set is the truth.
        self._events = {}
        # Names posted since the last ``wait()``, per listener key.
        self._pending = {}
        # Names consumed by the last ``wait()``, per listener key.
        self._fired = {}
        # ``(unique_names, normalized_mode)`` watch spec, per listener key.
        self._spec = {}
        # Watching keys per signal name, rebuilt by ``define()``.
        self._watchers = {}

    def define(self, key, names, mode):
        """Register or reset one listener key.

        ``names`` is deduplicated preserving order; ``mode`` is normalized to
        exactly ``'all'`` or ``'any'``. Re-calling for the same key resets only
        that key.
        """
        unique = []
        for name in names:
            if name not in unique:
                unique.append(name)

        normalized = "all" if mode == "all" else "any"

        self._events[key] = asyncio.Event()
        self._pending[key] = set()
        self._fired[key] = ()
        self._spec[key] = (unique, normalized)
        for name in unique:
            watchers = self._watchers.get(name)
            if watchers is None:
                watchers = set()
                self._watchers[name] = watchers
            watchers.add(key)

    def post(self, name):
        """Raise ``name`` for every listener watching it; unknown names no-op."""
        watchers = self._watchers.get(name)
        if not watchers:
            return
        for key in watchers:
            self._pending[key].add(name)
            self._events[key].set()

    async def wait(self, key):
        """Suspend until the key's ``any``/``all`` condition is satisfied.

        Clears the doorbell before checking the pending set, then consumes all
        pending names into ``_fired`` and returns ``True``. The ``while True:``
        loop re-arms the wait after an ``all``-mode partial wake-up.
        """
        event = self._events[key]
        pending = self._pending[key]
        names, mode = self._spec[key]

        while True:
            event.clear()
            if pending and (mode == "any" or len(pending) == len(names)):
                self._fired[key] = tuple(pending)
                pending.clear()
                return True
            await event.wait()

    def fired(self, key):
        """Return the names consumed by the last ``wait()``, or ``()``."""
        return self._fired.get(key, ())


_signals = None
_edges = {}


def ensure_signals():
    """Return the module-level singleton, creating it on first use."""
    global _signals
    if _signals is None:
        _signals = Signals()
    return _signals


def define(key, names, mode):
    """Delegate to the singleton's :meth:`Signals.define`."""
    ensure_signals().define(key, names, mode)


def post(name):
    """Delegate to the singleton's :meth:`Signals.post`."""
    ensure_signals().post(name)


def fired(key):
    """Delegate to the singleton's :meth:`Signals.fired`."""
    return ensure_signals().fired(key)


async def wait(key):
    """Delegate to the singleton's :meth:`Signals.wait`."""
    return await ensure_signals().wait(key)


def edge(key, current):
    """Return ``True`` only on a ``False -> True`` transition for ``key``.

    Per-key previous state lets signal edge detection live here without any
    per-node generated init state.
    """
    prev = _edges.get(key, False)
    triggered = bool(current) and not prev
    _edges[key] = bool(current)
    return triggered
