"""Shared input-control runtime helpers for webview input nodes.

DualInputControl implements dual-source value resolution for both scalar and
N-tuple values: a backend connector value and a user-submitted frontend value
compete for control under a last-changed-wins policy with frontend winning
when both change in the same tick.

Value equality (scalar path):
    Numeric values are compared with epsilon (1e-9).  Non-numeric fall back to
    direct equality (``a == b``).  Works for both float and string inputs.

Value equality (tuple path):
    Element-wise epsilon comparison (1e-9 per element) for float tuples.

Bounds:
    ``DualInputControl(initial, minimum, maximum)`` clamps every scalar value
    that becomes the output — the constructor default, the connector value and
    the user-submitted frontend value — to the inclusive ``[minimum, maximum]``
    range.  Non-numeric values and tuple values pass through untouched, and
    ``minimum``/``maximum`` both default to ``None`` (no clamping) so nodes
    without bounds keep their previous behaviour.

Change tracking:
    ``output_changed`` is True only on a tick whose resolved output differs from
    the previous tick's resolved output.  It stays False on the first tick of an
    instance and on forced sync-epoch publishes, so it reports
    *value* changes rather than *publish* events.

Usage in generated code — scalar path (number-input, checkbox):

    # init
    _wv_numinput = __import__('otter_webview.input_control', fromlist=['DualInputControl'])
    node_ctrl = _wv_numinput.DualInputControl(default_value, 0, 100)

    # loop
    output_value, push = node_ctrl.update(backend_value, consume_fn, frontend_key)
    if push:
        publish_fn({...})
    changed = node_ctrl.output_changed

Usage — tuple path (joystick, multi-axis nodes):

    # init
    ctrl = DualInputControl((0.0, 0.0))

    # loop
    (axis1, axis2), source = ctrl.update((conn_axis1, conn_axis2), frontend_pair_or_none)
"""

_TRACE = False


def consume_frontend_value(consume_fn, frontend_key):
    """Consume a scalar frontend payload value for the given key.

    Returns the value associated with the ``"value"`` key in the payload dict,
    or ``None`` when unavailable.

    Mirrors ``joystick.consume_frontend_payload`` but extracts a single scalar
    instead of returning the entire payload dict.
    """
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

    value = payload.get("value")
    if _TRACE:
        print("[data] wv-input:", "consume_frontend_value", frontend_key, value)
    return value


def _values_equal(a, b):
    """Compare two values for effective equality.

    Uses epsilon comparison for numeric pairs; falls back to direct equality for
    mixed or non-numeric types.
    """
    try:
        return abs(float(a) - float(b)) <= 1e-9
    except (TypeError, ValueError):
        return a == b


def _tup_equal(left, right, epsilon=1e-9):
    """Element-wise epsilon equality for float tuples of the same length."""
    if len(left) != len(right):
        return False
    for a, b in zip(left, right):
        if abs(a - b) > epsilon:
            return False
    return True


def _as_finite_number(value):
    """Return ``value`` as a finite float, or ``None`` when not convertible.

    Rejects non-numeric types, NaN and positive/negative infinity so callers can
    treat "not a usable bound or value" as a single condition.
    """
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    if numeric in (float("inf"), float("-inf")):
        return None
    return numeric


def _normalize_bounds(minimum, maximum):
    """Return a ``(low, high)`` float pair, or ``(None, None)`` when unbounded.

    Both bounds are required; a missing, non-numeric or non-finite bound
    disables clamping.  Inverted bounds are swapped so
    ``DualInputControl(value, 100, 0)`` behaves like ``(value, 0, 100)``.
    """
    low = _as_finite_number(minimum)
    high = _as_finite_number(maximum)
    if low is None or high is None:
        return (None, None)
    if low > high:
        return (high, low)
    return (low, high)


class DualInputControl:
    """Dual-source value holder for scalar or N-tuple webview input nodes.

    Instantiated once at firmware init; ``update()`` is called every loop tick.

    Policy: last-changed-wins with **frontend winning** when both sources change
    in the same tick.

    ``minimum``/``maximum`` bound the scalar output; see the module docstring.
    """

    def __init__(self, initial_values, minimum=None, maximum=None):
        self._is_scalar = not isinstance(initial_values, tuple)
        self._prev_connector = initial_values
        self._prev_frontend = None  # None = no frontend value received yet
        self._minimum, self._maximum = _normalize_bounds(minimum, maximum)
        self._output = self._clamp_scalar(initial_values)
        self._last_sync_epoch = None
        self._has_updated = False
        self._output_changed = False

    def update(
        self,
        connector_values,
        consume_fn_or_frontend=None,
        frontend_key=None,
        sync_epoch=None,
    ):
        """Resolve the active output value for this loop tick.

        Scalar path (number-input, checkbox):
            ``update(backend_value, consume_fn, frontend_key, sync_epoch=None)``
            Returns ``(output_value, push)`` where ``push`` is True when the
            browser UI needs an update because the connector value changed or
            the sync epoch changed (forcing an initial-state publish).

        Tuple path (joystick, multi-axis):
            ``update(connector_values, frontend_values)``
            ``frontend_values`` is a pre-extracted tuple or None.
            Returns ``(output_values, source)`` where source is one of
            ``"frontend"``, ``"connector"``, or ``"unchanged"``.

        ``output_changed`` is reset at the start of every tick and set only when
        this tick's resolved output differs from the previous tick's resolved
        output; ``_has_updated`` marks that a tick has completed so the first
        tick never reports a change.
        """
        self._output_changed = False
        if self._is_scalar:
            result = self._update_scalar(
                connector_values, consume_fn_or_frontend, frontend_key, sync_epoch
            )
        else:
            result = self._update_tuple(connector_values, consume_fn_or_frontend)
        self._has_updated = True
        return result

    def _update_scalar(self, backend_value, consume_fn, frontend_key, sync_epoch=None):
        """Resolve one scalar tick and return ``(output_value, push)``.

        Values are clamped to the configured bounds before they become the
        output; change tracking compares the previous resolved output with the
        new one, so a connector jump that clamps to the same value is not a
        change.
        """
        force_publish = sync_epoch is not None and sync_epoch != self._last_sync_epoch
        if sync_epoch is not None:
            self._last_sync_epoch = sync_epoch

        if _TRACE and force_publish:
            print("[data] wv-input:", "force-publish", frontend_key, "sync_epoch", sync_epoch)

        frontend_raw = consume_frontend_value(consume_fn, frontend_key)

        frontend_changed = frontend_raw is not None and (
            self._prev_frontend is None
            or not _values_equal(frontend_raw, self._prev_frontend)
        )
        connector_changed = not _values_equal(backend_value, self._prev_connector)

        self._prev_connector = backend_value

        if frontend_changed:
            self._prev_frontend = frontend_raw
            return (self._set_scalar_output(frontend_raw), False)

        if connector_changed:
            if frontend_raw is not None:
                self._prev_frontend = frontend_raw
            return (self._set_scalar_output(backend_value), True)

        if force_publish:
            return (self._output, True)

        return (self._output, False)

    def _update_tuple(self, connector_values, frontend_values):
        """Resolve one tuple tick and return ``(output_values, source)``."""
        prev_connector = self._prev_connector
        previous_output = self._output
        self._prev_connector = connector_values

        if frontend_values is not None:
            self._output = frontend_values
            self._track_tuple_change(previous_output)
            return (self._output, "frontend")

        if not _tup_equal(connector_values, prev_connector):
            self._output = connector_values
            self._track_tuple_change(previous_output)
            return (self._output, "connector")

        return (self._output, "unchanged")

    def _track_tuple_change(self, previous_output):
        """Flag a tuple output change when a tick has already completed.

        The tuple path cannot reuse ``_values_equal`` because the values are
        tuples; comparing them element-wise needs ``_tup_equal``.
        """
        if not self._has_updated:
            return
        if not _tup_equal(self._output, previous_output):
            self._output_changed = True

    def _clamp_scalar(self, value):
        """Clamp a scalar value to the configured bounds.

        Returns ``value`` unchanged when the control is unbounded, when the
        value is a tuple (the tuple path never clamps), or when it is not a
        finite number.
        """
        if not self._is_scalar or self._minimum is None or self._maximum is None:
            return value
        numeric = _as_finite_number(value)
        if numeric is None:
            return value
        if numeric < self._minimum:
            return self._minimum
        if numeric > self._maximum:
            return self._maximum
        return value

    def _set_scalar_output(self, value):
        """Clamp ``value``, store it as the output and flag a real change."""
        previous_output = self._output
        resolved = self._clamp_scalar(value)
        self._output = resolved
        if self._has_updated and not _values_equal(previous_output, resolved):
            self._output_changed = True
        return resolved

    @property
    def output_value(self):
        """Return the current resolved output value (scalar or tuple)."""
        return self._output

    @property
    def output_changed(self):
        """Return True when the last completed tick changed the output value.

        Always False on the first tick of an instance — even when that tick
        resolves a value different from the constructor default — and always
        False on forced sync-epoch publishes, which re-send an unchanged value.
        Read it after ``update()`` and before the next tick.
        """
        return self._output_changed


def consume_frontend_index(consume_fn, frontend_key):
    """Consume a frontend option index payload for the given key.

    Mirrors ``consume_frontend_value`` but extracts the ``"index"`` field used
    by the select node's frontend payload instead of the ``"value"`` field.
    """
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

    index = payload.get("index")
    if _TRACE:
        print("[data] wv-input:", "consume_frontend_index", frontend_key, index)
    return index


class SelectControl(DualInputControl):
    """Dual-source select control (dropdown).

    Subclasses ``DualInputControl`` for the shared last-changed-wins /
    frontend-wins policy, but overrides ``update()`` because the frontend
    payload carries an option *index* (not a scalar value) and the node
    exposes two outputs (value + label).

    The ``_option_values``, ``_option_labels``, and ``_selected_index``
    attributes are public data attributes: generated loop code updates them
    directly so wired connectors can change the option set at runtime.
    """

    def __init__(self, option_values, option_labels, default_index):
        self._option_values = list(option_values) if option_values else []
        self._option_labels = list(option_labels) if option_labels else []
        self._selected_index = self._clamp_index(default_index)
        self._prev_backend = None
        self._output_value = None
        self._output_label = ""
        self._last_sync_epoch = None
        self._has_updated = False
        self._output_changed = False
        self._refresh_outputs()

    def _clamp_index(self, index):
        if not self._option_values:
            return 0
        try:
            i = int(index)
        except (TypeError, ValueError):
            i = 0
        if i < 0:
            return 0
        if i >= len(self._option_values):
            return len(self._option_values) - 1
        return i

    def _find_option_index(self, value):
        for i in range(len(self._option_values)):
            if self._option_values[i] == value:
                return i
        return None

    def _refresh_outputs(self):
        """Recompute the value/label outputs from the selected index.

        Flags ``output_changed`` when a completed tick sees a different resolved
        value; the initial refresh from ``__init__`` runs before the first tick
        and therefore never reports a change.
        """
        previous_value = self._output_value
        idx = self._selected_index
        self._output_value = (
            self._option_values[idx] if self._option_values else None
        )
        self._output_label = (
            self._option_labels[idx] if self._option_labels else ""
        )
        self._output = self._output_value
        if self._has_updated and not _values_equal(previous_value, self._output_value):
            self._output_changed = True

    def update(self, backend_value, consume_fn, frontend_key, sync_epoch=None):
        """Resolve the selected option for this loop tick.

        Returns ``(output_value, output_label, push)`` where ``push`` is truthy
        when a backend value change or a sync-epoch change should be pushed to
        the browser (the latter forces an initial-state publish).

        ``output_changed`` is reset at the start of every tick and set only when
        this tick resolves a different option value than the previous tick.
        """
        self._output_changed = False
        force_publish = sync_epoch is not None and sync_epoch != self._last_sync_epoch
        if sync_epoch is not None:
            self._last_sync_epoch = sync_epoch

        if _TRACE and force_publish:
            print("[data] wv-input:", "force-publish-select", frontend_key, "sync_epoch", sync_epoch)

        frontend_index = consume_frontend_index(consume_fn, frontend_key)
        if frontend_index is not None:
            self._selected_index = self._clamp_index(frontend_index)
            self._prev_backend = backend_value
            self._refresh_outputs()
            self._has_updated = True
            return (self._output_value, self._output_label, False)

        push = False
        if backend_value != self._prev_backend:
            self._prev_backend = backend_value
            matched = self._find_option_index(backend_value)
            if matched is not None:
                self._selected_index = matched
                push = True

        self._refresh_outputs()
        if force_publish and not push:
            push = True
        self._has_updated = True
        return (self._output_value, self._output_label, push)

    @property
    def output_value(self):
        return self._output_value

    @property
    def output_label(self):
        return self._output_label


def normalize_frontend_updates(request_payload):
    """Extract input-control frontend updates for transient store publish.

    Input-control nodes post their user values under top-level
    ``frontend:wv_bind_<type>_...`` keys.  The refresh hook calls this
    normalizer with the parsed POST body and publishes the returned dict into
    the transient web data store, where loop code consumes it via
    ``consume_webview_values_keys``.
    """
    if not isinstance(request_payload, dict):
        return {}

    normalized = {}
    for key, value in request_payload.items():
        if isinstance(key, str) and key.startswith("frontend:"):
            normalized[key] = value
    if _TRACE:
        print("[data] wv-input:", "normalize_frontend_updates", list(normalized.keys()))
    return normalized
