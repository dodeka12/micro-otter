"""Callable servo node implementation used by the transpiler's function path.

This class follows the callable-instance contract: the constructor receives
connector metadata and control values; __call__ runs per tick and returns a
tuple aligned to the node's outputs.
"""

from otter_stdmo.servo import Servo

try:
    import traceback
except ImportError:  # pragma: no cover - MicroPython variants may not include traceback
    traceback = None


def _log_exception(context: str, exc: Exception) -> None:
    print(f"[error] servo-node: {context} ({exc})")
    if traceback is None:
        return
    try:
        traceback.print_exception(type(exc), exc, exc.__traceback__)
    except Exception:
        pass


class ServoNodeFn:
    """Per-tick servo node callable.

    ``enabled`` only gates the hardware write; the angle output is always returned.
    """

    def __init__(self, inputs_meta=None, outputs_meta=None, controls=None):
        controls = controls or {}
        try:
            self.pin = controls.get("pin", 0)
            self.min_us = controls.get("minUs", 1000)
            self.max_us = controls.get("maxUs", 2000)
            self.range_min = controls.get("rangeMin", -90)
            self.range_max = controls.get("rangeMax", 90)
            self.max_rate = controls.get("maxRate", 180)
            self._servo = Servo(
                self.pin,
                freq=50,
                min_us=self.min_us,
                max_us=self.max_us,
                angle_range=[self.range_min, self.range_max],
                max_angle_change_per_sec=self.max_rate,
            )
        except Exception as exc:
            _log_exception("init failed", exc)
            raise

    def __call__(self, enabled, angle):
        """Drive the servo and return the angle for ``angleOut``.

        ``enabled=False`` skips only the hardware write; the return value still
        flows to ``angleOut`` so downstream nodes keep their dataflow.
        """
        try:
            if bool(enabled):
                self._servo.set_angle(angle)
            return float(angle)
        except Exception as exc:
            _log_exception(f"execution failed (angle={angle})", exc)
            raise
