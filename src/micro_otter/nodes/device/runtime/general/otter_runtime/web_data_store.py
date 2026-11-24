# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

try:
    from micropython import const
except ImportError:  # pragma: no cover - host fallback
    const = lambda value: value  # noqa: E731

_DEFAULT_MAX_STORE_ENTRIES = const(256)


class WebDataStore:
    """Minimal reusable key-value store for webview runtime refresh handlers."""

    def __init__(self, max_entries=None) -> None:
        self._values = {}
        self._max_entries = int(max_entries) if max_entries is not None else _DEFAULT_MAX_STORE_ENTRIES

    def set_value(self, key, value) -> bool:
        if not isinstance(key, str):
            return False

        normalized_key = key.strip()
        if not normalized_key:
            return False

        if normalized_key not in self._values and len(self._values) >= self._max_entries:
            return False

        self._values[normalized_key] = value
        return True

    def set_many(self, values) -> int:
        if not isinstance(values, dict):
            return 0

        updated_count = 0
        for key, value in values.items():
            if self.set_value(key, value):
                updated_count += 1

        return updated_count

    def get_value(self, key, default=None):
        if not isinstance(key, str):
            return default

        normalized_key = key.strip()
        if not normalized_key:
            return default

        return self._values.get(normalized_key, default)

    def pop_value(self, key, default=None):
        if not isinstance(key, str):
            return default

        normalized_key = key.strip()
        if not normalized_key:
            return default

        return self._values.pop(normalized_key, default)

    def clear(self) -> None:
        self._values.clear()

    def snapshot(self) -> dict:
        return dict(self._values)

    def remove_keys(self, keys) -> int:
        if not isinstance(keys, (list, tuple, set)):
            return 0

        removed_count = 0
        for key in keys:
            if not isinstance(key, str):
                continue

            normalized_key = key.strip()
            if not normalized_key:
                continue

            if normalized_key in self._values:
                self._values.pop(normalized_key, None)
                removed_count += 1

        return removed_count

    def consume_keys(self, keys, clear_after_read=True) -> dict:
        if not isinstance(keys, (list, tuple, set)):
            return {}

        consumed = {}
        for key in keys:
            if not isinstance(key, str):
                continue

            normalized_key = key.strip()
            if not normalized_key:
                continue

            if normalized_key not in self._values:
                continue

            if clear_after_read:
                consumed[normalized_key] = self._values.pop(normalized_key)
            else:
                consumed[normalized_key] = self._values.get(normalized_key)

        return consumed
