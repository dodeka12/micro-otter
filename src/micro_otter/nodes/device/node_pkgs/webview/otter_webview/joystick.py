"""Joystick runtime helpers for webview nodes.

State is managed through a DualInputControl instance stored in the state dict,
using last-changed-wins resolution with frontend winning on tie.
"""

from .input_control import DualInputControl
from .utils import clamp, to_float

try:
    import gc as _gc
except Exception:  # pragma: no cover - MicroPython always provides gc
    _gc = None


_STATE_STORE = {}
_DEBUG_ENABLED = False
_DEBUG_EVERY_N = 100
_DEBUG_COUNTER = 0
FRONTEND_JOYSTICK_KEY_PREFIX = "frontend:joystick:"


def state_store():
    """Return the shared joystick state store."""
    return _STATE_STORE


def reset_state_store():
    """Reset the shared joystick state store."""
    _STATE_STORE.clear()


def set_debug(enabled, every_n=25):
    """Enable or disable joystick debug logging.

    When enabled, logs are throttled to every N calls.
    """

    global _DEBUG_ENABLED, _DEBUG_EVERY_N
    _DEBUG_ENABLED = bool(enabled)
    try:
        resolved_every_n = int(every_n)
    except Exception:
        resolved_every_n = 25
    _DEBUG_EVERY_N = resolved_every_n if resolved_every_n > 0 else 1


def _debug_log(event, state_key=None, axis1=None, axis2=None, use_user_input=None):
    if not _DEBUG_ENABLED:
        return

    parts = ["[data] webview-joystick:", event]
    if state_key is not None:
        parts.append("state_key=")
        parts.append(state_key)
    if use_user_input is not None:
        parts.append("use_user_input=")
        parts.append(bool(use_user_input))
    if axis1 is not None:
        parts.append("axis1=")
        parts.append(axis1)
    if axis2 is not None:
        parts.append("axis2=")
        parts.append(axis2)
    if _gc is not None:
        try:
            parts.append("mem_free=")
            parts.append(_gc.mem_free())
            parts.append("mem_alloc=")
            parts.append(_gc.mem_alloc())
        except Exception:
            pass
    print(*parts)


def _debug_tick(event, state_key=None, axis1=None, axis2=None, use_user_input=None):
    global _DEBUG_COUNTER
    if not _DEBUG_ENABLED:
        return
    _DEBUG_COUNTER += 1
    if _DEBUG_COUNTER != 1 and (_DEBUG_COUNTER % _DEBUG_EVERY_N) != 0:
        return
    _debug_log(
        event,
        state_key=state_key,
        axis1=axis1,
        axis2=axis2,
        use_user_input=use_user_input,
    )


def _sanitize_axis_pair(axis1_value, axis2_value):
    axis1 = clamp(to_float(axis1_value, 0.0), -1.0, 1.0)
    axis2 = clamp(to_float(axis2_value, 0.0), -1.0, 1.0)
    return axis1, axis2


def _axis_pair_equal(left_axis1, left_axis2, right_axis1, right_axis2, epsilon=1e-9):
    return (
        abs(left_axis1 - right_axis1) <= epsilon
        and abs(left_axis2 - right_axis2) <= epsilon
    )


def _frontend_axis_pair(frontend_payload):
    if not isinstance(frontend_payload, dict):
        return None

    return _sanitize_axis_pair(
        frontend_payload.get("axis1", 0.0),
        frontend_payload.get("axis2", 0.0),
    )


def normalize_frontend_updates(request_payload):
    """Normalize joystick frontend request updates for transient store publish."""
    if not isinstance(request_payload, dict):
        return {}

    raw_updates = request_payload.get("joystickUpdates")
    if not isinstance(raw_updates, dict):
        return {}

    normalized = {}
    for payload_key, update in raw_updates.items():
        if not isinstance(payload_key, str):
            continue

        payload_key = payload_key.strip()
        if not payload_key:
            continue

        if not isinstance(update, dict):
            continue

        # Axis-only contract requires complete axis pairs.
        if "axis1" not in update or "axis2" not in update:
            continue

        axis1, axis2 = _sanitize_axis_pair(
            update.get("axis1", 0.0),
            update.get("axis2", 0.0),
        )

        normalized[f"{FRONTEND_JOYSTICK_KEY_PREFIX}{payload_key}"] = {
            "axis1": axis1,
            "axis2": axis2,
        }

    return normalized


def ensure_state(state_store, state_key):
    """Ensure a joystick state record exists and return it."""
    if not isinstance(state_store, dict):
        state_store = _STATE_STORE
    if not isinstance(state_key, str) or not state_key:
        state_key = "joystick:default"

    state = state_store.get(state_key)
    if not isinstance(state, dict):
        state = {}

    if not isinstance(state.get("ctrl"), DualInputControl):
        initial_axis1 = clamp(to_float(state.get("axis1", 0.0), 0.0), -1.0, 1.0)
        initial_axis2 = clamp(to_float(state.get("axis2", 0.0), 0.0), -1.0, 1.0)
        state["ctrl"] = DualInputControl((initial_axis1, initial_axis2))
        state["axis1"] = initial_axis1
        state["axis2"] = initial_axis2
        # New control means a new change baseline; an existing state keeps its
        # value so the next tick still reports the last real axis change.
        state["outputChanged"] = False

    state_store[state_key] = state
    _debug_tick(
        "ensure_state",
        state_key=state_key,
        axis1=state.get("axis1", 0.0),
        axis2=state.get("axis2", 0.0),
    )
    return state


def resolve_output_values(
    state,
    frontend_payload,
    connector_axis1_value,
    connector_axis2_value,
    use_user_input,
):
    """Resolve joystick output values using DualInputControl last-changed-wins logic.

    1. If user-input mode is active and a frontend payload arrived this cycle,
       frontend wins (user is actively moving the joystick).
    2. Otherwise, if connector inputs changed since last cycle, connector wins.
    3. If neither source changed, keep previous output unchanged.

    Stores ``state["outputChanged"]`` from the control's one-tick change flag so
    generated loop code can drive a ``changed`` output.
    """

    if not isinstance(state, dict):
        raise TypeError("state must be a dict")

    connector_axis1, connector_axis2 = apply_connector_input(
        connector_axis1_value,
        connector_axis2_value,
    )

    frontend_axis_pair = _frontend_axis_pair(frontend_payload) if use_user_input else None

    ctrl = state["ctrl"]
    (output_axis1, output_axis2), source = ctrl.update(
        (connector_axis1, connector_axis2),
        frontend_axis_pair,
    )

    state["inputAxis1"] = connector_axis1
    state["inputAxis2"] = connector_axis2
    if frontend_axis_pair is not None:
        state["frontendAxis1"] = frontend_axis_pair[0]
        state["frontendAxis2"] = frontend_axis_pair[1]
    state["outputAxis1"] = output_axis1
    state["outputAxis2"] = output_axis2
    state["axis1"] = output_axis1
    state["axis2"] = output_axis2
    state["outputChanged"] = ctrl.output_changed

    _debug_tick(
        "resolve_output_values:%s" % source,
        axis1=output_axis1,
        axis2=output_axis2,
        use_user_input=bool(use_user_input),
    )
    return output_axis1, output_axis2


def consume_frontend_payload(consume_fn, frontend_key):
    """Consume a joystick frontend payload for the given key."""
    if not callable(consume_fn):
        return None
    if not isinstance(frontend_key, str) or not frontend_key:
        return None

    try:
        payload_map = consume_fn([frontend_key], clear_after_read=True)
    except Exception:
        return None

    if not isinstance(payload_map, dict):
        return None

    payload = payload_map.get(frontend_key)
    if not isinstance(payload, dict):
        return None

    return payload


def apply_user_input(state, frontend_payload, use_user_input):
    """Apply new-method user payload and return sanitized axis tuple."""
    if not isinstance(state, dict):
        raise TypeError("state must be a dict")

    if not use_user_input:
        axis1 = state.get("axis1", 0.0)
        axis2 = state.get("axis2", 0.0)
        axis1, axis2 = apply_connector_input(axis1, axis2)
        _debug_tick(
            "apply_user_input:connector-fallback",
            axis1=axis1,
            axis2=axis2,
            use_user_input=False,
        )
        return axis1, axis2

    if not isinstance(frontend_payload, dict):
        axis1 = state.get("axis1", 0.0)
        axis2 = state.get("axis2", 0.0)
        axis1, axis2 = apply_connector_input(axis1, axis2)
        _debug_tick(
            "apply_user_input:no-frontend",
            axis1=axis1,
            axis2=axis2,
            use_user_input=True,
        )
        return axis1, axis2

    axis1 = frontend_payload.get("axis1", state.get("axis1", 0.0))
    axis2 = frontend_payload.get("axis2", state.get("axis2", 0.0))
    axis1, axis2 = apply_connector_input(axis1, axis2)
    _debug_tick(
        "apply_user_input:fallback",
        axis1=axis1,
        axis2=axis2,
        use_user_input=True,
    )
    return axis1, axis2


def apply_connector_input(axis1_value, axis2_value):
    """Normalize connector axis input and return axis tuple."""
    return _sanitize_axis_pair(axis1_value, axis2_value)


def write_state(state, axis1, axis2):
    """Write joystick values back to state and return the state dict."""
    if not isinstance(state, dict):
        raise TypeError("state must be a dict")

    state["axis1"] = clamp(to_float(axis1, 0.0), -1.0, 1.0)
    state["axis2"] = clamp(to_float(axis2, 0.0), -1.0, 1.0)
    _debug_tick(
        "write_state",
        axis1=state["axis1"],
        axis2=state["axis2"],
    )
    return state
