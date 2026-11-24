import importlib.util
import sys
from pathlib import Path

WEB_DATA_STORE_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
    / "web_data_store.py"
)


def _load_web_data_store_module():
    original_micropython = sys.modules.get("micropython")
    import types

    micropython_module = types.ModuleType("micropython")
    micropython_module.const = lambda value: value
    sys.modules["micropython"] = micropython_module
    try:
        spec = importlib.util.spec_from_file_location(
            "web_data_store_under_test", WEB_DATA_STORE_PATH
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        if original_micropython is None:
            del sys.modules["micropython"]
        else:
            sys.modules["micropython"] = original_micropython


def test_set_value_rejects_new_key_when_store_at_capacity():
    module = _load_web_data_store_module()
    store = module.WebDataStore(max_entries=2)

    assert store.set_value("a", 1) is True
    assert store.set_value("b", 2) is True
    # third new key must be rejected
    assert store.set_value("c", 3) is False
    assert store.get_value("c") is None


def test_set_value_allows_update_of_existing_key_at_capacity():
    module = _load_web_data_store_module()
    store = module.WebDataStore(max_entries=2)

    store.set_value("a", 1)
    store.set_value("b", 2)
    # updating an existing key must succeed even at capacity
    assert store.set_value("a", 99) is True
    assert store.get_value("a") == 99


def test_default_max_entries_is_256():
    module = _load_web_data_store_module()
    store = module.WebDataStore()
    assert store._max_entries == 256


def test_set_many_stops_inserting_new_keys_at_capacity():
    module = _load_web_data_store_module()
    store = module.WebDataStore(max_entries=2)

    count = store.set_many({"x": 1, "y": 2, "z": 3})
    # Only 2 of 3 new keys can be accepted
    assert count == 2
    assert store.get_value("z") is None
