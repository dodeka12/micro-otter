class _NullLock:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _create_lock():
    return _NullLock()


class WebDataRegistry:
    def __init__(self):
        self._values_by_page = {}
        self._bindings_by_page = {}
        self._dirty_keys_by_page = {}
        self._lock = _create_lock()

    def set_value(self, page_id, key, value):
        with self._lock:
            page_values = self._values_by_page.setdefault(page_id, {})
            page_values[key] = value
            dirty_keys = self._dirty_keys_by_page.setdefault(page_id, set())
            dirty_keys.add(key)

    def bind_key_to_element(self, page_id, key, element_id):
        with self._lock:
            page_bindings = self._bindings_by_page.setdefault(page_id, {})
            page_bindings[key] = element_id
            dirty_keys = self._dirty_keys_by_page.setdefault(page_id, set())
            dirty_keys.add(key)

    def snapshot_page(self, page_id):
        with self._lock:
            page_values = self._values_by_page.get(page_id, {})
            page_bindings = self._bindings_by_page.get(page_id, {})
            return {
                "values": dict(page_values),
                "bindings": dict(page_bindings),
            }

    def delta_page(self, page_id):
        with self._lock:
            dirty_keys = self._dirty_keys_by_page.get(page_id, set())
            if not dirty_keys:
                return {
                    "values": {},
                    "bindings": {},
                }

            page_values = self._values_by_page.get(page_id, {})
            page_bindings = self._bindings_by_page.get(page_id, {})

            value_delta = {}
            binding_delta = {}
            for key in dirty_keys:
                if key in page_values:
                    value_delta[key] = page_values[key]
                if key in page_bindings:
                    binding_delta[key] = page_bindings[key]

            dirty_keys.clear()

            return {
                "values": value_delta,
                "bindings": binding_delta,
            }
