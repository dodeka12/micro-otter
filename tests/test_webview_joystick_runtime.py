import importlib
import sys
from pathlib import Path

JOYSTICK_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "webview"
    / "otter_webview"
    / "joystick.py"
)

WEBVIEW_PACKAGE_ROOT = JOYSTICK_PATH.parents[1]


def _load_joystick_module():
    root_str = str(WEBVIEW_PACKAGE_ROOT)
    added_path = False
    if root_str not in sys.path:
        sys.path.insert(0, root_str)
        added_path = True
    try:
        module = importlib.import_module("otter_webview.joystick")
        return importlib.reload(module)
    finally:
        if added_path:
            try:
                sys.path.remove(root_str)
            except ValueError:
                pass


def test_apply_user_input_accepts_axis_frontend_payload():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    axis1, axis2 = module.apply_user_input(
        state,
        {"axis1": 1.0, "axis2": 0.0},
        True,
    )

    assert abs(axis1 - 1.0) < 1e-9
    assert abs(axis2 - 0.0) < 1e-9


def test_apply_user_input_clamps_each_axis_independently():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    axis1, axis2 = module.apply_user_input(
        state,
        {"axis1": 2.0, "axis2": 2.0},
        True,
    )

    assert abs(axis1 - 1.0) < 1e-9
    assert abs(axis2 - 1.0) < 1e-9


def test_apply_user_input_uses_connector_values_when_disabled():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    state["axis1"] = 0.3
    state["axis2"] = -0.4

    axis1, axis2 = module.apply_user_input(state, {"axis1": 1.0, "axis2": 1.0}, False)

    assert abs(axis1 - 0.3) < 1e-9
    assert abs(axis2 + 0.4) < 1e-9


def test_resolve_output_values_prefers_changed_frontend_values():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    axis1, axis2 = module.resolve_output_values(
        state,
        {"axis1": 1.0, "axis2": 0.0},
        0.1,
        -0.1,
        True,
    )

    assert abs(axis1 - 1.0) < 1e-9
    assert abs(axis2 - 0.0) < 1e-9
    assert abs(state["frontendAxis1"] - 1.0) < 1e-9
    assert abs(state["frontendAxis2"] - 0.0) < 1e-9
    assert abs(state["outputAxis1"] - 1.0) < 1e-9
    assert abs(state["outputAxis2"] - 0.0) < 1e-9


def test_resolve_output_values_uses_connector_when_frontend_missing():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    axis1, axis2 = module.resolve_output_values(state, None, 0.4, -0.7, True)

    assert abs(axis1 - 0.4) < 1e-9
    assert abs(axis2 + 0.7) < 1e-9
    assert abs(state["inputAxis1"] - 0.4) < 1e-9
    assert abs(state["inputAxis2"] + 0.7) < 1e-9


def test_resolve_output_values_keeps_output_when_nothing_changed():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    first_axis1, first_axis2 = module.resolve_output_values(
        state,
        {"axis1": 0.25, "axis2": -0.5},
        0.25,
        -0.5,
        True,
    )
    second_axis1, second_axis2 = module.resolve_output_values(
        state,
        {"axis1": 0.25, "axis2": -0.5},
        0.25,
        -0.5,
        True,
    )

    assert abs(first_axis1 - second_axis1) < 1e-9
    assert abs(first_axis2 - second_axis2) < 1e-9
    assert abs(state["outputAxis1"] - first_axis1) < 1e-9
    assert abs(state["outputAxis2"] - first_axis2) < 1e-9


def test_resolve_output_values_connector_wins_when_user_inactive_and_connector_changes():
    # Last-changed-wins: after user stops moving, connector changes should take effect.
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    # Cycle 1: user moves joystick — frontend wins.
    module.resolve_output_values(
        state,
        {"axis1": 0.1, "axis2": 0.2},
        0.1,
        0.2,
        True,
    )
    # Cycle 2: user stops moving (no frontend payload), connector changes — connector wins.
    axis1, axis2 = module.resolve_output_values(
        state,
        None,
        -0.8,
        0.6,
        True,
    )

    assert abs(axis1 + 0.8) < 1e-9
    assert abs(axis2 - 0.6) < 1e-9


def test_resolve_output_values_prefers_connector_when_user_mode_disabled():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    module.resolve_output_values(
        state,
        {"axis1": 0.1, "axis2": 0.2},
        0.1,
        0.2,
        False,
    )
    axis1, axis2 = module.resolve_output_values(
        state,
        {"axis1": 0.9, "axis2": -0.9},
        -0.8,
        0.6,
        False,
    )

    assert abs(axis1 + 0.8) < 1e-9
    assert abs(axis2 - 0.6) < 1e-9


def test_normalize_frontend_updates_maps_axis_pairs_to_transient_store_keys():
    module = _load_joystick_module()

    normalized = module.normalize_frontend_updates(
        {
            "joystickUpdates": {
                "joy-a": {"axis1": 2.0, "axis2": -2.0},
            }
        }
    )

    assert set(normalized.keys()) == {"frontend:joystick:joy-a"}
    assert abs(normalized["frontend:joystick:joy-a"]["axis1"] - 1.0) < 1e-9
    assert abs(normalized["frontend:joystick:joy-a"]["axis2"] + 1.0) < 1e-9


def test_normalize_frontend_updates_ignores_malformed_axis_payloads():
    module = _load_joystick_module()

    normalized = module.normalize_frontend_updates(
        {
            "joystickUpdates": {
                "joy-axis1-only": {"axis1": 0.5},
                "joy-axis2-only": {"axis2": -0.25},
                "": {"axis1": 0.1, "axis2": 0.2},
            }
        }
    )

    assert normalized == {}


def test_ensure_state_initializes_output_changed_false():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")

    assert state["outputChanged"] is False


def test_ensure_state_keeps_existing_output_changed_value():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    state["outputChanged"] = True

    again = module.ensure_state(module.state_store(), "joy:test")

    assert again["outputChanged"] is True


def test_resolve_output_values_first_tick_is_not_a_change():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    module.resolve_output_values(state, {"axis1": 0.5, "axis2": 0.5}, 0.0, 0.0, True)

    assert state["outputChanged"] is False


def test_resolve_output_values_reports_connector_axis_change():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    module.resolve_output_values(state, None, 0.0, 0.0, True)
    module.resolve_output_values(state, None, 0.4, -0.6, True)

    assert state["outputChanged"] is True


def test_resolve_output_values_clears_change_on_unchanged_tick():
    module = _load_joystick_module()
    module.reset_state_store()

    state = module.ensure_state(module.state_store(), "joy:test")
    module.resolve_output_values(state, None, 0.0, 0.0, True)
    module.resolve_output_values(state, None, 0.4, -0.6, True)
    module.resolve_output_values(state, None, 0.4, -0.6, True)

    assert state["outputChanged"] is False
