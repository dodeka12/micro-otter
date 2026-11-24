"""Tests for the pulse example add-on: device modules and definition docs."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ADDON_ROOT = Path(__file__).resolve().parents[1] / "examples" / "addons" / "node_pkgs" / "pulse"


def _load_module(name: str, path: Path):
    """Import a device module by file path so the host never needs ``micropython``."""

    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _high_cases():
    """(ticks, interval, duty, expected) triples covering the phase boundaries."""

    return [
        (0, 1000, 50, 1),
        (499, 1000, 50, 1),
        (500, 1000, 50, 0),
        (999, 1000, 50, 0),
        (1000, 1000, 50, 1),
        (0, 0, 50, 0),
        (0, 1000, 0, 0),
        (0, 1000, 100, 1),
    ]


@pytest.fixture(scope="module")
def pulse_modules():
    """Load the base and viper (host-fallback) implementations once per run."""

    base = _load_module("moa_pulse", ADDON_ROOT / "moa_pulse" / "__init__.py")
    viper = _load_module("moa_pulse_viper", ADDON_ROOT / "moa_pulse_viper" / "__init__.py")
    return base, viper


def test_base_and_viper_agree(pulse_modules):
    base, viper = pulse_modules
    for ticks, interval, duty, expected in _high_cases():
        assert base.high(ticks, interval, duty) == expected
        assert viper.high(ticks, interval, duty) == expected


def test_node_definition_contract():
    definitions = json.loads((ADDON_ROOT / "node_definitions.json").read_text(encoding="utf-8"))
    tick = definitions["nodeTypes"]["tick"]

    assert tick["implementations"]["python"] == {
        "type": "code-generator",
        "value": "NodeCodeGenerators.moaPulseTick",
    }
    assert tick["category"] == "time"

    # The palette icon travels with the package, so a copied add-on keeps its glyph.
    icon = tick["icon"]
    assert icon == "icons/vital_signs_24dp.svg"
    assert (ADDON_ROOT / icon).is_file(), f"{icon} is missing from the pulse package"

    for field in ("info", "title"):
        assert set(tick[field]) == {"en", "de"}

    input_ids = [entry["id"] for entry in tick["inputs"]]
    output_ids = [entry["id"] for entry in tick["outputs"]]
    control_ids = [entry["id"] for entry in tick["controls"]]

    assert input_ids == ["value", "interval"]
    assert output_ids == ["out"]
    assert control_ids == ["duty", "invert"]

    output = tick["outputs"][0]
    assert output["typeInputSources"] == ["value"]
    assert output["typeInputSources"][0] in input_ids

    for entry in tick["inputs"] + tick["outputs"] + tick["controls"]:
        assert "en" in entry["description"]
        assert "de" in entry["description"]

    generators = (ADDON_ROOT / "node_generators.js").read_text(encoding="utf-8")
    assert "NodeCodeGenerators.moaPulseTick" in generators
