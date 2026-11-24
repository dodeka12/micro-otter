"""Radar runtime helpers for webview nodes."""

from .utils import clamp, to_float


_STATE_STORE = {}
_DEBUG_ENABLED = False
_DEBUG_SAMPLE_EVERY = 20
_DEBUG_COUNTERS = {
   "state_store": 0,
   "ensure_slices": 0,
   "apply_piece_update": 0,
}

def _debug(message, *, force=False):
    if not _DEBUG_ENABLED:
        return
    if force:
        print("[data] radar:", message)


def _debug_sample(counter_name, message):
    if not _DEBUG_ENABLED:
        return
    count = _DEBUG_COUNTERS.get(counter_name, 0) + 1
    _DEBUG_COUNTERS[counter_name] = count
    if count == 1 or (count % _DEBUG_SAMPLE_EVERY) == 0:
        print("[data] radar:", "{} #{} {}".format(counter_name, count, message))

def state_store():
    """Return the shared radar state store."""
    _debug_sample("state_store", "keys={}".format(len(_STATE_STORE)))
    return _STATE_STORE


def reset_state_store():
    """Reset the shared radar state store."""
    _debug("reset_state_store clearing={} keys".format(len(_STATE_STORE)), force=True)
    _STATE_STORE.clear()

def ensure_slices(state_store, state_key, piece_count, initial_radius):
    """Ensure a radar slice list exists for a key and return it."""
    _debug_sample(
        "ensure_slices",
        "state_key={} piece_count={} initial_radius={}".format(
            state_key,
            piece_count,
            initial_radius,
        ),
    )
    if not isinstance(state_store, dict):
        _debug("ensure_slices invalid state_store type={}".format(type(state_store)), force=True)
        raise TypeError("state_store must be a dict")
    if not isinstance(state_key, str) or not state_key:
        _debug("ensure_slices invalid state_key={}".format(state_key), force=True)
        raise ValueError("state_key must be a non-empty string")

    safe_piece_count = int(to_float(piece_count, 24))
    if safe_piece_count < 1:
        safe_piece_count = 1

    safe_initial_radius = clamp(to_float(initial_radius, 0.0), 0.0, 1.0)

    slices = state_store.get(state_key)
    if not isinstance(slices, list) or len(slices) != safe_piece_count:
        _debug(
            "ensure_slices allocate key={} size={} init={}".format(
                state_key,
                safe_piece_count,
                safe_initial_radius,
            ),
            force=True,
        )
        slices = [safe_initial_radius] * safe_piece_count

    state_store[state_key] = slices
    return slices

def apply_piece_update(slices, piece_index_value, piece_radius_value, initial_radius):
    """Apply one piece update and return (piece_index, piece_radius, slices_copy)."""
    _debug_sample(
        "apply_piece_update",
        "len={} piece_index_value={} piece_radius_value={} initial_radius={}".format(
            len(slices) if isinstance(slices, list) else "n/a",
            piece_index_value,
            piece_radius_value,
            initial_radius,
        ),
    )
    if not isinstance(slices, list) or len(slices) == 0:
        _debug("apply_piece_update invalid slices={}".format(type(slices)), force=True)
        raise ValueError("slices must be a non-empty list")

    piece_count = len(slices)
    safe_initial_radius = clamp(to_float(initial_radius, 0.0), 0.0, 1.0)

    try:
        piece_index = int(to_float(piece_index_value, 0.0) // 1)
    except Exception:
        piece_index = 0

    if piece_index < 0:
        piece_index = 0
    if piece_index >= piece_count:
        piece_index = piece_count - 1

    piece_radius = clamp(to_float(piece_radius_value, safe_initial_radius), 0.0, 1.0)
    slices[piece_index] = piece_radius

    if piece_radius_value != piece_radius:
        _debug_sample(
            "apply_piece_update",
            "clamped radius raw={} clamped={} index={}".format(
                piece_radius_value,
                piece_radius,
                piece_index,
            ),
        )

    return piece_index, piece_radius, list(slices)
