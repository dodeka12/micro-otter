# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Namespaced, flash-persistable variable store.

The store is a module-level singleton that maps ``store name -> variable name ->
value``. Each namespace can be saved to / loaded from ``var_store/<name>.json``
via ``save()`` / ``load()``. ``load()`` fully replaces the named namespace in
memory; a missing or invalid file leaves the namespace untouched and returns
``False``. ``array.array('f', ...)`` values round-trip through the JSON file via
a tagged marker so persisted arrays are usable without conversion.
"""

try:
    import ujson as json
except ImportError:  # pragma: no cover - host fallback
    import json  # type: ignore

try:
    import uos as _os
except ImportError:  # pragma: no cover - host fallback
    import os as _os  # type: ignore

import array

_STORE_DIR = "var_store"
_ARRAY_MARKER = "__otter_array__"
_TMP_SUFFIX = ".tmp"
_ALLOWED_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
)


class VarStore:
    """Namespaced synchronous variable store shared across graphs."""

    def __init__(self):
        self._stores = {}

    def get(self, store, name, default=None):
        namespace = self._stores.get(store)
        if namespace is None:
            return default
        return namespace.get(name, default)

    def set(self, store, name, value):
        namespace = self._stores.get(store)
        if namespace is None:
            namespace = {}
            self._stores[store] = namespace
        namespace[name] = value

    def has(self, store, name):
        namespace = self._stores.get(store)
        return namespace is not None and name in namespace

    def replace(self, store, values):
        self._stores[store] = values

    def items(self, store):
        return self._stores.get(store, {})


_store = None


def ensure_store():
    """Return the module-level singleton, creating it on first use."""
    global _store
    if _store is None:
        _store = VarStore()
    return _store


def get(store, name, default=None):
    return ensure_store().get(store, name, default)


def set(store, name, value):
    ensure_store().set(store, name, value)


def has(store, name):
    return ensure_store().has(store, name)


def _sanitize_store_name(name):
    """Validate and return a store name safe to use as a file name."""
    if not isinstance(name, str) or not name:
        raise ValueError("empty store name")
    for char in name:
        if char not in _ALLOWED_CHARS:
            raise ValueError("invalid store name: {!r}".format(name))
    return name


def _store_path(name):
    return "{}/{}.json".format(_STORE_DIR, _sanitize_store_name(name))


def _ensure_dir(dir_path):
    try:
        _os.mkdir(dir_path)
    except OSError:
        pass


def _encode_value(value):
    if isinstance(value, array.array):
        return {_ARRAY_MARKER: list(value)}
    return value


def _decode_value(value):
    if (
        isinstance(value, dict)
        and len(value) == 1
        and _ARRAY_MARKER in value
        and isinstance(value[_ARRAY_MARKER], list)
    ):
        return array.array("f", [float(item) for item in value[_ARRAY_MARKER]])
    return value


def save(store):
    """Persist the named namespace to ``var_store/<name>.json``.

    Returns ``True`` when the file was written. The write is atomic (tmp file +
    rename) and ``array.array`` values are encoded so they survive the JSON
    round-trip.
    """
    name = _sanitize_store_name(store)
    data = ensure_store().items(name)
    payload = {key: _encode_value(value) for key, value in data.items()}
    print("[info] var-store: saving '{}' ({} value(s))".format(name, len(payload)))

    try:
        _ensure_dir(_STORE_DIR)
        path = _store_path(name)
        tmp_path = path + _TMP_SUFFIX
        with open(tmp_path, "w") as handle:
            json.dump(payload, handle)

        try:
            _os.rename(tmp_path, path)
        except OSError:
            try:
                _os.remove(path)
            except OSError:
                pass
            _os.rename(tmp_path, path)
    except Exception as exc:
        print("[error] var-store: save failed '{}' ({})".format(name, exc))
        return False

    return True


def load(store):
    """Load ``var_store/<name>.json`` and fully replace that namespace.

    Returns ``True`` on success and ``False`` when the file is missing or
    invalid; in that case the namespace is left untouched. Encoded arrays are
    reconstructed as ``array.array('f', ...)``.
    """
    name = _sanitize_store_name(store)
    path = _store_path(name)
    print("[info] var-store: loading '{}'".format(name))

    try:
        with open(path, "r") as handle:
            payload = json.load(handle)
    except Exception as exc:
        print("[error] var-store: load failed '{}' ({})".format(name, exc))
        return False

    if not isinstance(payload, dict):
        print("[error] var-store: load failed '{}' (invalid payload)".format(name))
        return False

    decoded = {str(key): _decode_value(value) for key, value in payload.items()}
    ensure_store().replace(name, decoded)
    print("[info] var-store: loaded '{}' ({} value(s))".format(name, len(decoded)))
    return True


class SaveTrigger:
    """Rising-edge detector: True only on a ``False -> True`` transition."""

    def __init__(self):
        self._prev = False

    def update(self, current):
        triggered = bool(current) and not self._prev
        self._prev = bool(current)
        return triggered


_triggers = {}


def edge_trigger(key, current):
    """Return ``True`` on a ``False -> True`` edge for ``key``.

    Per-key previous state lets save/load nodes trigger once per rising edge
    without per-node generated init state.
    """
    trigger = _triggers.get(key)
    if trigger is None:
        trigger = SaveTrigger()
        _triggers[key] = trigger
    return trigger.update(current)

