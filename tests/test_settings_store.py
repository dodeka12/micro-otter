import importlib.util
import json
from pathlib import Path

SETTINGS_STORE_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "runtime"
    / "general"
    / "otter_runtime"
    / "settings_store.py"
)


def _load_settings_store():
    spec = importlib.util.spec_from_file_location("settings_store_under_test", SETTINGS_STORE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _write(path, value):
    if isinstance(value, str):
        path.write_text(value, encoding="utf-8")
    else:
        path.write_text(json.dumps(value), encoding="utf-8")


def test_read_settings_missing_path_returns_defaults_copy(tmp_path):
    store = _load_settings_store()
    defaults = {"enable": True, "port": 80}

    result = store.read_settings(str(tmp_path / "missing.json"), defaults)

    assert result == defaults
    assert result is not defaults


def test_read_settings_does_not_mutate_defaults(tmp_path):
    store = _load_settings_store()
    defaults = {"enable": True, "port": 80}

    store.read_settings(str(tmp_path / "missing.json"), defaults)

    assert defaults == {"enable": True, "port": 80}


def test_read_settings_merges_file_values_and_ignores_unknown_keys(tmp_path):
    store = _load_settings_store()
    path = tmp_path / "settings.json"
    _write(path, {"enable": False, "port": 8080, "unknown": "ignored"})

    result = store.read_settings(str(path), {"enable": True, "port": 80})

    assert result == {"enable": False, "port": 8080}


def test_read_settings_invalid_json_returns_defaults(tmp_path):
    store = _load_settings_store()
    path = tmp_path / "settings.json"
    _write(path, "not valid json {")

    result = store.read_settings(str(path), {"enable": True, "port": 80})

    assert result == {"enable": True, "port": 80}


def test_read_settings_non_dict_document_returns_defaults(tmp_path):
    store = _load_settings_store()
    defaults = {"enable": True, "port": 80}

    for value in ([1, 2, 3], 42, "text", None):
        path = tmp_path / "settings.json"
        _write(path, value)
        assert store.read_settings(str(path), defaults) == defaults


def test_write_settings_round_trips(tmp_path):
    store = _load_settings_store()
    path = str(tmp_path / "settings.json")

    store.write_settings(path, {"enable": False, "port": 8080})

    assert store.read_settings(path, {"enable": True, "port": 80}) == {
        "enable": False,
        "port": 8080,
    }


def test_read_settings_with_non_string_default_key(tmp_path):
    store = _load_settings_store()

    result = store.read_settings(str(tmp_path / "missing.json"), {1: "value"})

    assert result == {1: "value"}


def test_constants_and_defaults_are_exposed():
    store = _load_settings_store()

    assert store.WEBSERVER_SETTINGS_FILE == "/webserver_settings.json"
    assert store.MQTT_SETTINGS_FILE == "/mqtt_settings.json"
    assert store.WEBSERVER_SETTINGS_DEFAULTS == {"enable": True, "port": 80}
