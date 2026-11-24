import json
from pathlib import Path

LINEAGE_PATH = Path("src/micro_otter/nodes/device/firmware/runtime_lineage.json")


def _iter_node_package_maps(payload: dict):
    for target_entries in payload.get("lineage", {}).values():
        if not isinstance(target_entries, dict):
            continue
        for entry in target_entries.values():
            if not isinstance(entry, dict):
                continue
            node_packages = entry.get("nodePackages")
            if isinstance(node_packages, dict):
                yield node_packages


def test_runtime_lineage_uses_audio_as_the_package_key():
    payload = json.loads(LINEAGE_PATH.read_text(encoding="utf-8"))

    maps = list(_iter_node_package_maps(payload))
    assert maps, "expected at least one lineage entry with nodePackages"

    all_keys = {key for node_packages in maps for key in node_packages}
    assert "audio" in all_keys, "expected the audio package key in lineage nodePackages"
    assert "otter_audio_viper" not in all_keys, (
        "expected no otter_audio_viper package key in lineage nodePackages"
    )
