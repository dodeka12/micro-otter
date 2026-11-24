"""Line graph runtime helpers for webview nodes."""

import math

from .utils import to_float


DEFAULT_MAX_POINTS = 256
MAX_POINTS_LIMIT = 2048


def _normalize_max_points(max_points):
    """Return the point cap as an integer clamped to ``1..MAX_POINTS_LIMIT``."""
    numeric = to_float(max_points, DEFAULT_MAX_POINTS)
    if not math.isfinite(numeric):
        numeric = float(DEFAULT_MAX_POINTS)
    point_cap = int(numeric)
    if point_cap < 1:
        return 1
    if point_cap > MAX_POINTS_LIMIT:
        return MAX_POINTS_LIMIT
    return point_cap


def _sequence_length(values):
    """Return ``len(values)`` for sequence-like input, or ``0`` when absent."""
    if values is None:
        return 0
    try:
        return int(len(values))
    except Exception:
        return 0


def _as_finite_float(value):
    """Return ``float(value)`` or ``None`` when conversion fails or is not finite."""
    try:
        numeric = float(value)
    except Exception:
        return None
    if not math.isfinite(numeric):
        return None
    return numeric


def build_series(x_values, y_values, max_points=DEFAULT_MAX_POINTS):
    """Return equal-length finite ``(x_values, y_values)`` lists capped to the newest points.

    An absent or empty ``y`` series yields two empty lists. An absent or empty
    ``x`` series falls back to the original zero-based ``y`` indices, so a
    tail-capped series keeps x values ``start..n-1`` instead of restarting at
    ``0``. When both series exist they are paired only up to the shorter length;
    values are never padded or repeated. Pairs whose ``x`` or ``y`` value is not
    finite are dropped together, after the pairing window is fixed, so fewer
    than ``max_points`` pairs may remain. Only the last ``max_points`` positions
    of that window are considered.
    """
    point_cap = _normalize_max_points(max_points)

    y_length = _sequence_length(y_values)
    if y_length <= 0:
        return [], []

    x_length = _sequence_length(x_values)
    pair_count = min(x_length, y_length) if x_length > 0 else y_length

    start_index = pair_count - point_cap
    if start_index < 0:
        start_index = 0

    series_x = []
    series_y = []
    for index in range(start_index, pair_count):
        y_value = _as_finite_float(y_values[index])
        if x_length > 0:
            x_value = _as_finite_float(x_values[index])
        else:
            x_value = float(index)
        if x_value is None or y_value is None:
            continue
        series_x.append(x_value)
        series_y.append(y_value)

    return series_x, series_y
