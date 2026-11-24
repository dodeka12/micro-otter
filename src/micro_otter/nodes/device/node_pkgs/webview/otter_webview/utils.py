"""Shared utility helpers for webview runtime modules."""


def to_float(value, fallback=0.0):
    """Convert a value to float, returning fallback when conversion fails."""
    try:
        return float(value)
    except Exception:
        return float(fallback)


def to_bool(value, fallback=False):
    """Convert a value to bool with support for common string tokens."""
    if value is None:
        return bool(fallback)

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("1", "true", "yes", "on"):
            return True
        if normalized in ("0", "false", "no", "off"):
            return False

    return bool(value)


def clamp(value, min_value, max_value):
    """Clamp a value to the inclusive [min_value, max_value] range."""
    if value < min_value:
        return min_value
    if value > max_value:
        return max_value
    return value


def normalize_angle_deg(angle_deg):
    """Normalize an angle in degrees to the [0.0, 360.0) range."""
    angle = to_float(angle_deg, 0.0)
    while angle < 0.0:
        angle += 360.0
    while angle >= 360.0:
        angle -= 360.0
    return angle
