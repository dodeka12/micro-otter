"""Tests for the hello example add-on: device module and definition docs."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ADDON_ROOT = Path(__file__).resolve().parents[1] / "examples" / "addons" / "node_pkgs" / "hello"


def _load_module(name: str, path: Path):
    """Import a device module by file path so the host never needs ``micropython``."""

    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_greeting():
    module = _load_module("moa_hello", ADDON_ROOT / "moa_hello" / "__init__.py")
    assert module.greeting() == "hello from the example add-on"


def test_node_definition_contract():
    definitions = json.loads((ADDON_ROOT / "node_definitions.json").read_text(encoding="utf-8"))
    greet = definitions["nodeTypes"]["greet"]

    assert greet["implementations"]["python"] == {
        "type": "code-generator",
        "value": "NodeCodeGenerators.moaHelloGreet",
    }
    assert greet["category"] == "debugging"

    # The palette icon travels with the package, so a copied add-on keeps its glyph.
    icon = greet["icon"]
    assert icon == "icons/waving_hand_24dp.svg"
    assert (ADDON_ROOT / icon).is_file(), f"{icon} is missing from the hello package"

    for field in ("info", "title"):
        assert set(greet[field]) == {"en", "de"}

    output = greet["outputs"][0]
    assert output["id"] == "value"
    assert output["outputType"] == "string"
    assert "en" in output["description"] and "de" in output["description"]

    generators = (ADDON_ROOT / "node_generators.js").read_text(encoding="utf-8")
    assert "NodeCodeGenerators.moaHelloGreet" in generators
