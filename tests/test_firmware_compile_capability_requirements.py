import json
from pathlib import Path

from micro_otter.tools.firmware_compile.capability_requirements import evaluate_requirements

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "capability-requirements.json"


def _build_context(capabilities):
    def status_of(capability):
        return capabilities.get(capability, "pin-absent")

    def is_general(capability):
        return status_of(capability).startswith("general")

    def has_general_capability(capability):
        return status_of(capability) == "general-supported"

    def has_pin_capability(capability):
        return status_of(capability) == "pin-present"

    return is_general, has_general_capability, has_pin_capability


def test_evaluate_requirements_parity_cases():
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for case in payload["cases"]:
        is_general, has_general, has_pin = _build_context(case["capabilities"])
        satisfied, missing = evaluate_requirements(
            case["requirements"], is_general, has_general, has_pin
        )
        assert satisfied == case["satisfied"], case["name"]
        assert missing == case["missing"], case["name"]


def test_evaluate_requirements_treats_non_list_as_empty():
    def is_general(_capability):
        return False

    def has_general(_capability):
        return False

    def has_pin(_capability):
        return False

    assert evaluate_requirements(None, is_general, has_general, has_pin) == (True, [])
    assert evaluate_requirements("viper", is_general, has_general, has_pin) == (True, [])
