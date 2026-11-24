import pathlib
import sys

import pytest

VARS_PKG_ROOT = pathlib.Path("src/micro_otter/nodes/device/node_pkgs/vars").resolve()


@pytest.fixture()
def store():
    sys.path.insert(0, str(VARS_PKG_ROOT))
    import otter_vars.store as s

    s._store = None
    s._triggers = {}
    yield s
    sys.path.remove(str(VARS_PKG_ROOT))


def test_set_creates_entry_on_first_write(store):
    store.set("default", "buf", 3.0)
    assert store.get("default", "buf") == 3.0


def test_get_unknown_returns_default(store):
    assert store.get("default", "missing") is None
    assert store.get("default", "missing", 0) == 0


def test_namespaces_are_isolated(store):
    store.set("a", "buf", 1)
    store.set("b", "buf", 2)
    assert store.get("a", "buf") == 1
    assert store.get("b", "buf") == 2
    assert store.has("a", "buf") is True
    assert store.has("a", "other") is False


def test_sanitize_store_name_accepts_safe_names(store):
    assert store._sanitize_store_name("default") == "default"
    assert store._sanitize_store_name("a.b_c-1") == "a.b_c-1"


def test_sanitize_store_name_rejects_unsafe_names(store):
    for bad in ["", "../x", "a/b", "a b", "a:b"]:
        with pytest.raises(ValueError):
            store._sanitize_store_name(bad)


def test_save_then_load_roundtrip_scalars(store, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    store.set("default", "a", 3.5)
    store.set("default", "b", True)
    assert store.save("default") is True
    assert (tmp_path / "var_store" / "default.json").exists()

    store._store = None
    assert store.load("default") is True
    assert store.get("default", "a") == 3.5
    assert store.get("default", "b") is True


def test_array_roundtrips_as_array(store, tmp_path, monkeypatch):
    import array

    monkeypatch.chdir(tmp_path)
    store.set("default", "arr", array.array("f", [1.0, 2.0, 3.0]))
    assert store.save("default") is True

    store._store = None
    assert store.load("default") is True
    loaded = store.get("default", "arr")
    assert isinstance(loaded, array.array)
    assert list(loaded) == [1.0, 2.0, 3.0]


def test_load_replaces_namespace(store, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    store.set("default", "a", 1)
    store.set("default", "b", 2)
    assert store.save("default") is True

    store._store = None
    store.set("default", "stale", 99)
    assert store.load("default") is True
    assert store.get("default", "a") == 1
    assert store.get("default", "b") == 2
    assert store.has("default", "stale") is False


def test_load_missing_file_returns_false_and_preserves(store, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    store.set("default", "keep", 7)
    assert store.load("default") is False
    assert store.get("default", "keep") == 7


def test_load_invalid_json_returns_false_and_preserves(store, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "var_store").mkdir()
    (tmp_path / "var_store" / "default.json").write_text("{not json")
    store.set("default", "keep", 7)
    assert store.load("default") is False
    assert store.get("default", "keep") == 7


def test_edge_trigger_requires_false_before_retrigger(store):
    assert store.edge_trigger("k", False) is False
    assert store.edge_trigger("k", True) is True
    assert store.edge_trigger("k", True) is False
    assert store.edge_trigger("k", False) is False
    assert store.edge_trigger("k", True) is True


def test_edge_trigger_is_per_key(store):
    assert store.edge_trigger("a", True) is True
    assert store.edge_trigger("b", True) is True

