"""Unit tests for otter_webview.input_control module."""

import pytest
from src.micro_otter.nodes.device.node_pkgs.webview.otter_webview.input_control import (
    DualInputControl,
    SelectControl,
    _values_equal,
    consume_frontend_index,
    consume_frontend_value,
    normalize_frontend_updates,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_consume_fn(payload_map):
    """Return a consume callable that returns `payload_map` for any key list."""

    def _consume(keys, clear_after_read=True):
        return payload_map

    return _consume


def _scalar_payload(key, value):
    """Return a payload map with a scalar value dict under `key`."""
    return {key: {"value": value}}


# ---------------------------------------------------------------------------
# consume_frontend_value
# ---------------------------------------------------------------------------


class TestConsumeFrontendValue:
    def test_returns_none_when_consume_fn_not_callable(self):
        result = consume_frontend_value("not_callable", "some_key")
        assert result is None

    def test_returns_none_when_consume_fn_is_none(self):
        assert consume_frontend_value(None, "key") is None

    def test_returns_none_when_frontend_key_empty(self):
        fn = _make_consume_fn({"": {"value": 42}})
        assert consume_frontend_value(fn, "") is None

    def test_returns_none_when_frontend_key_not_string(self):
        fn = _make_consume_fn({1: {"value": 42}})
        assert consume_frontend_value(fn, 1) is None

    def test_returns_none_when_payload_map_is_none(self):
        fn = _make_consume_fn(None)
        assert consume_frontend_value(fn, "key") is None

    def test_returns_none_when_payload_map_not_dict(self):
        fn = _make_consume_fn("bad")
        assert consume_frontend_value(fn, "key") is None

    def test_returns_none_when_key_missing_from_payload_map(self):
        fn = _make_consume_fn({"other_key": {"value": 5}})
        assert consume_frontend_value(fn, "key") is None

    def test_returns_none_when_payload_entry_not_dict(self):
        fn = _make_consume_fn({"key": "not_a_dict"})
        assert consume_frontend_value(fn, "key") is None

    def test_returns_value_from_payload(self):
        fn = _make_consume_fn(_scalar_payload("my_key", 3.14))
        result = consume_frontend_value(fn, "my_key")
        assert result == pytest.approx(3.14)

    def test_returns_string_value(self):
        fn = _make_consume_fn(_scalar_payload("k", "hello"))
        assert consume_frontend_value(fn, "k") == "hello"

    def test_returns_none_when_consume_fn_raises(self):
        def _bad_fn(keys, clear_after_read=True):
            raise RuntimeError("boom")

        assert consume_frontend_value(_bad_fn, "key") is None

    def test_value_is_none_when_not_present_in_payload(self):
        fn = _make_consume_fn({"k": {}})  # no 'value' key
        assert consume_frontend_value(fn, "k") is None


# ---------------------------------------------------------------------------
# _values_equal
# ---------------------------------------------------------------------------


class TestValuesEqual:
    def test_equal_floats(self):
        assert _values_equal(1.0, 1.0) is True

    def test_floats_within_epsilon(self):
        assert _values_equal(1.0, 1.0 + 1e-10) is True

    def test_floats_beyond_epsilon(self):
        assert _values_equal(1.0, 1.0 + 1e-8) is False

    def test_int_and_float_equivalent(self):
        assert _values_equal(2, 2.0) is True

    def test_equal_strings(self):
        assert _values_equal("abc", "abc") is True

    def test_unequal_strings(self):
        assert _values_equal("abc", "def") is False

    def test_non_numeric_string_vs_int_not_equal(self):
        # "abc" cannot be converted to float; falls back to direct equality
        assert _values_equal("abc", 1) is False


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# DualInputControl — construction
# ---------------------------------------------------------------------------


class TestDualInputControlInit:
    def test_scalar_initial_value_stored_as_output(self):
        ctrl = DualInputControl(5.0)
        assert ctrl.output_value == pytest.approx(5.0)

    def test_scalar_initial_value_unchanged_on_first_no_op_tick(self):
        ctrl = DualInputControl(10)
        out, push = ctrl.update(10, None, "k")
        assert out == 10
        assert push is False

    def test_string_initial_value(self):
        ctrl = DualInputControl("hello")
        assert ctrl.output_value == "hello"

    def test_tuple_initial_value_stored_as_output(self):
        ctrl = DualInputControl((0.5, -0.5))
        assert ctrl.output_value == (0.5, -0.5)


# ---------------------------------------------------------------------------
# DualInputControl.update — scalar path
# ---------------------------------------------------------------------------


class TestDualInputControlScalar:
    # --- connector changes, no frontend ---

    def test_connector_change_only_returns_connector_value(self):
        ctrl = DualInputControl(0.0)
        out, push = ctrl.update(5.0, _make_consume_fn({}), "k")
        assert out == pytest.approx(5.0)
        assert push is True

    def test_connector_change_updates_output_value_property(self):
        ctrl = DualInputControl(0.0)
        ctrl.update(7.0, _make_consume_fn({}), "k")
        assert ctrl.output_value == pytest.approx(7.0)

    def test_connector_unchanged_no_frontend_returns_previous_output(self):
        ctrl = DualInputControl(3.0)
        out, push = ctrl.update(3.0, _make_consume_fn({}), "k")
        assert out == pytest.approx(3.0)
        assert push is False

    # --- frontend changes, no connector change ---

    def test_frontend_change_only_returns_frontend_value(self):
        ctrl = DualInputControl(0.0)
        fn = _make_consume_fn(_scalar_payload("k", 9.0))
        out, push = ctrl.update(0.0, fn, "k")
        assert out == pytest.approx(9.0)
        assert push is False

    def test_frontend_change_does_not_set_push(self):
        ctrl = DualInputControl(0.0)
        fn = _make_consume_fn(_scalar_payload("k", 9.0))
        _, push = ctrl.update(0.0, fn, "k")
        assert push is False

    def test_frontend_change_updates_output_value_property(self):
        ctrl = DualInputControl(0.0)
        fn = _make_consume_fn(_scalar_payload("k", 4.5))
        ctrl.update(0.0, fn, "k")
        assert ctrl.output_value == pytest.approx(4.5)

    # --- both change in the same tick: frontend wins ---

    def test_both_changed_frontend_wins(self):
        ctrl = DualInputControl(0.0)
        fn = _make_consume_fn(_scalar_payload("k", 3.0))
        out, push = ctrl.update(7.0, fn, "k")
        assert out == pytest.approx(3.0)  # frontend wins
        assert push is False

    def test_both_changed_output_value_is_frontend(self):
        ctrl = DualInputControl(0.0)
        fn = _make_consume_fn(_scalar_payload("k", 3.0))
        ctrl.update(7.0, fn, "k")
        assert ctrl.output_value == pytest.approx(3.0)

    # --- neither changed ---

    def test_neither_changed_returns_previous_output(self):
        ctrl = DualInputControl(2.0)
        fn = _make_consume_fn(_scalar_payload("k", 5.0))
        ctrl.update(2.0, fn, "k")  # frontend wins, output = 5.0
        fn2 = _make_consume_fn(_scalar_payload("k", 5.0))
        out, push = ctrl.update(2.0, fn2, "k")  # same values again
        assert out == pytest.approx(5.0)
        assert push is False

    # --- epsilon boundary ---

    def test_connector_within_epsilon_not_considered_changed(self):
        ctrl = DualInputControl(1.0)
        close = 1.0 + 5e-10
        out, push = ctrl.update(close, _make_consume_fn({}), "k")
        assert push is False
        assert out == pytest.approx(1.0)

    def test_connector_beyond_epsilon_considered_changed(self):
        ctrl = DualInputControl(1.0)
        farther = 1.0 + 1e-8
        out, push = ctrl.update(farther, _make_consume_fn({}), "k")
        assert push is True

    # --- string values ---

    def test_string_connector_change(self):
        ctrl = DualInputControl("a")
        out, push = ctrl.update("b", _make_consume_fn({}), "k")
        assert out == "b"
        assert push is True

    def test_string_frontend_change(self):
        ctrl = DualInputControl("a")
        fn = _make_consume_fn(_scalar_payload("k", "c"))
        out, push = ctrl.update("a", fn, "k")
        assert out == "c"
        assert push is False

    # --- output_value property ---

    def test_output_value_property_reflects_last_update(self):
        ctrl = DualInputControl(0.0)
        ctrl.update(99.0, _make_consume_fn({}), "k")
        assert ctrl.output_value == pytest.approx(99.0)

    # --- sync epoch force-publish ---

    def test_first_tick_with_sync_epoch_pushes(self):
        ctrl = DualInputControl(10)
        out, push = ctrl.update(10, None, "k", sync_epoch=0)
        assert out == 10
        assert push is True

    def test_same_sync_epoch_does_not_push_again(self):
        ctrl = DualInputControl(10)
        ctrl.update(10, None, "k", sync_epoch=0)
        out, push = ctrl.update(10, None, "k", sync_epoch=0)
        assert out == 10
        assert push is False

    def test_sync_epoch_change_pushes_once(self):
        ctrl = DualInputControl(10)
        ctrl.update(10, None, "k", sync_epoch=0)
        ctrl.update(10, None, "k", sync_epoch=0)
        out, push = ctrl.update(10, None, "k", sync_epoch=1)
        assert out == 10
        assert push is True
        out, push = ctrl.update(10, None, "k", sync_epoch=1)
        assert push is False


# ---------------------------------------------------------------------------
# DualInputControl.update — tuple path
# ---------------------------------------------------------------------------


class TestDualInputControlTuple:
    def test_frontend_wins_when_provided(self):
        ctrl = DualInputControl((0.0, 0.0))
        result, source = ctrl.update((0.5, 0.5), (1.0, -1.0))
        assert source == "frontend"
        assert result == (1.0, -1.0)

    def test_connector_wins_when_no_frontend_and_connector_changed(self):
        ctrl = DualInputControl((0.0, 0.0))
        result, source = ctrl.update((0.3, -0.7), None)
        assert source == "connector"
        assert abs(result[0] - 0.3) < 1e-9
        assert abs(result[1] + 0.7) < 1e-9

    def test_unchanged_when_no_frontend_and_connector_same(self):
        ctrl = DualInputControl((0.3, -0.7))
        result, source = ctrl.update((0.3, -0.7), None)
        assert source == "unchanged"
        assert abs(result[0] - 0.3) < 1e-9
        assert abs(result[1] + 0.7) < 1e-9

    def test_frontend_beats_simultaneous_connector_change(self):
        ctrl = DualInputControl((0.0, 0.0))
        result, source = ctrl.update((0.5, -0.5), (1.0, 1.0))
        assert source == "frontend"
        assert result == (1.0, 1.0)

    def test_connector_wins_after_user_releases(self):
        ctrl = DualInputControl((0.0, 0.0))
        ctrl.update((0.0, 0.0), (0.3, 0.4))  # user acted
        result, source = ctrl.update((-0.8, 0.6), None)  # user idle, connector changes
        assert source == "connector"
        assert abs(result[0] + 0.8) < 1e-9
        assert abs(result[1] - 0.6) < 1e-9

    def test_output_value_property_returns_tuple(self):
        ctrl = DualInputControl((0.0, 0.0))
        ctrl.update((0.5, 0.5), None)
        assert ctrl.output_value == (0.5, 0.5)


# ---------------------------------------------------------------------------
# DualInputControl — bounds
# ---------------------------------------------------------------------------


class TestDualInputControlBounds:
    def test_constructor_clamps_initial_value_above_maximum(self):
        ctrl = DualInputControl(150, 0, 100)
        assert ctrl.output_value == pytest.approx(100)

    def test_constructor_clamps_initial_value_below_minimum(self):
        ctrl = DualInputControl(-5, 0, 100)
        assert ctrl.output_value == pytest.approx(0)

    def test_constructor_keeps_initial_value_inside_bounds(self):
        ctrl = DualInputControl(7, 0, 100)
        assert ctrl.output_value == 7

    def test_connector_value_above_maximum_is_clamped(self):
        ctrl = DualInputControl(0, 0, 100)
        out, push = ctrl.update(250, _make_consume_fn({}), "k")
        assert out == pytest.approx(100)
        assert push is True

    def test_connector_value_below_minimum_is_clamped(self):
        ctrl = DualInputControl(0, -2.5, 2.5)
        out, _ = ctrl.update(-9.0, _make_consume_fn({}), "k")
        assert out == pytest.approx(-2.5)

    def test_frontend_value_is_clamped(self):
        ctrl = DualInputControl(0, 0, 100)
        fn = _make_consume_fn(_scalar_payload("k", 500))
        out, push = ctrl.update(0, fn, "k")
        assert out == pytest.approx(100)
        assert push is False

    def test_frontend_value_below_minimum_is_clamped(self):
        ctrl = DualInputControl(0, 0, 100)
        fn = _make_consume_fn(_scalar_payload("k", -1))
        out, _ = ctrl.update(0, fn, "k")
        assert out == pytest.approx(0)

    def test_unbounded_control_keeps_large_values(self):
        ctrl = DualInputControl(0)
        out, _ = ctrl.update(100000.0, _make_consume_fn({}), "k")
        assert out == pytest.approx(100000.0)

    def test_non_numeric_scalar_is_not_clamped(self):
        ctrl = DualInputControl("a", 0, 100)
        out, _ = ctrl.update("b", _make_consume_fn({}), "k")
        assert out == "b"

    def test_tuple_outputs_are_not_clamped(self):
        ctrl = DualInputControl((0.0, 0.0), 5, 10)
        out, source = ctrl.update((20.0, -20.0), None)
        assert source == "connector"
        assert out == (20.0, -20.0)

    def test_inverted_bounds_are_normalized(self):
        ctrl = DualInputControl(500, 100, 0)
        assert ctrl.output_value == pytest.approx(100)
        out, _ = ctrl.update(-3, _make_consume_fn({}), "k")
        assert out == pytest.approx(0)

    def test_non_finite_bounds_disable_clamping(self):
        ctrl = DualInputControl(500, float("-inf"), float("inf"))
        assert ctrl.output_value == 500

    def test_non_numeric_bound_disables_clamping(self):
        ctrl = DualInputControl(500, "low", 100)
        assert ctrl.output_value == 500


# ---------------------------------------------------------------------------
# DualInputControl — output_changed
# ---------------------------------------------------------------------------


class TestDualInputControlOutputChanged:
    def test_first_tick_never_reports_change(self):
        ctrl = DualInputControl(0.0)
        ctrl.update(5.0, _make_consume_fn({}), "k")
        assert ctrl.output_changed is False

    def test_first_tick_with_frontend_never_reports_change(self):
        ctrl = DualInputControl(0.0)
        fn = _make_consume_fn(_scalar_payload("k", 5.0))
        ctrl.update(0.0, fn, "k")
        assert ctrl.output_changed is False

    def test_second_tick_connector_change_reports_change(self):
        ctrl = DualInputControl(0.0)
        ctrl.update(0.0, _make_consume_fn({}), "k")
        ctrl.update(5.0, _make_consume_fn({}), "k")
        assert ctrl.output_changed is True

    def test_unchanged_tick_clears_previous_change(self):
        ctrl = DualInputControl(0.0)
        ctrl.update(0.0, _make_consume_fn({}), "k")
        ctrl.update(5.0, _make_consume_fn({}), "k")
        ctrl.update(5.0, _make_consume_fn({}), "k")
        assert ctrl.output_changed is False

    def test_frontend_change_reports_change(self):
        ctrl = DualInputControl(0.0)
        ctrl.update(0.0, _make_consume_fn(_scalar_payload("k", 1.0)), "k")
        ctrl.update(0.0, _make_consume_fn(_scalar_payload("k", 2.0)), "k")
        assert ctrl.output_changed is True

    def test_forced_publish_is_not_a_change(self):
        ctrl = DualInputControl(10)
        ctrl.update(10, None, "k", sync_epoch=0)
        out, push = ctrl.update(10, None, "k", sync_epoch=1)
        assert push is True
        assert out == 10
        assert ctrl.output_changed is False

    def test_clamp_to_same_bound_is_not_a_change(self):
        ctrl = DualInputControl(0, 0, 100)
        ctrl.update(150, _make_consume_fn({}), "k")
        ctrl.update(200, _make_consume_fn({}), "k")
        assert ctrl.output_changed is False

    def test_clamp_from_bound_to_inside_range_is_a_change(self):
        ctrl = DualInputControl(0, 0, 100)
        ctrl.update(150, _make_consume_fn({}), "k")
        ctrl.update(42, _make_consume_fn({}), "k")
        assert ctrl.output_changed is True

    def test_tuple_connector_change_reports_change(self):
        ctrl = DualInputControl((0.0, 0.0))
        ctrl.update((0.0, 0.0), None)
        ctrl.update((0.5, -0.5), None)
        assert ctrl.output_changed is True

    def test_tuple_unchanged_tick_clears_change(self):
        ctrl = DualInputControl((0.0, 0.0))
        ctrl.update((0.0, 0.0), None)
        ctrl.update((0.5, -0.5), None)
        ctrl.update((0.5, -0.5), None)
        assert ctrl.output_changed is False

    def test_tuple_first_tick_never_reports_change(self):
        ctrl = DualInputControl((0.0, 0.0))
        ctrl.update((0.5, -0.5), None)
        assert ctrl.output_changed is False


# ---------------------------------------------------------------------------
# consume_frontend_index
# ---------------------------------------------------------------------------


class TestConsumeFrontendIndex:
    def test_returns_none_when_not_callable(self):
        assert consume_frontend_index(None, "k") is None

    def test_returns_none_when_key_invalid(self):
        assert consume_frontend_index(_make_consume_fn({}), "") is None

    def test_returns_index_from_payload(self):
        fn = _make_consume_fn({"k": {"index": 2}})
        assert consume_frontend_index(fn, "k") == 2

    def test_returns_none_when_index_missing(self):
        fn = _make_consume_fn({"k": {"value": 1}})
        assert consume_frontend_index(fn, "k") is None


# ---------------------------------------------------------------------------
# SelectControl
# ---------------------------------------------------------------------------


def _make_select(default_index=0):
    return SelectControl(["a", "b", "c"], ["A", "B", "C"], default_index)


class TestSelectControl:
    def test_construction_clamps_default_index(self):
        ctrl = SelectControl(["a", "b"], ["A", "B"], 99)
        assert ctrl._selected_index == 1

    def test_empty_options_do_not_raise(self):
        ctrl = SelectControl([], [], 0)
        assert ctrl._selected_index == 0
        assert ctrl.output_value is None
        assert ctrl.output_label == ""

    def test_find_option_index(self):
        ctrl = _make_select()
        assert ctrl._find_option_index("b") == 1
        assert ctrl._find_option_index("zz") is None

    def test_backend_match_updates_selection_and_pushes(self):
        ctrl = _make_select()
        out_value, out_label, push = ctrl.update("b", _make_consume_fn({}), "k")
        assert push is True
        assert out_value == "b"
        assert out_label == "B"

    def test_backend_no_match_retains_selection(self):
        ctrl = _make_select()
        ctrl.update("b", _make_consume_fn({}), "k")
        out_value, out_label, push = ctrl.update("zz", _make_consume_fn({}), "k")
        assert push is False
        assert out_value == "b"

    def test_frontend_index_selects_option(self):
        ctrl = _make_select()
        fn = _make_consume_fn({"k": {"index": 2}})
        out_value, out_label, push = ctrl.update("a", fn, "k")
        assert push is False
        assert out_value == "c"
        assert out_label == "C"

    def test_frontend_index_out_of_range_clamped(self):
        ctrl = _make_select()
        fn = _make_consume_fn({"k": {"index": 50}})
        out_value, _, _ = ctrl.update("a", fn, "k")
        assert out_value == "c"

    def test_output_properties(self):
        ctrl = _make_select()
        assert ctrl.output_value == "a"
        assert ctrl.output_label == "A"

    # --- sync epoch force-publish ---

    def test_first_tick_with_sync_epoch_pushes_when_no_backend_match(self):
        ctrl = SelectControl(["1", "2"], ["A", "B"], 0)
        out_value, out_label, push = ctrl.update(
            "", _make_consume_fn({}), "k", sync_epoch=0
        )
        assert push is True
        assert out_value == "1"
        assert out_label == "A"

    def test_same_sync_epoch_does_not_push_again(self):
        ctrl = SelectControl(["1", "2"], ["A", "B"], 0)
        ctrl.update("", _make_consume_fn({}), "k", sync_epoch=0)
        out_value, out_label, push = ctrl.update(
            "", _make_consume_fn({}), "k", sync_epoch=0
        )
        assert push is False
        assert out_value == "1"
        assert out_label == "A"

    # --- output_changed ---

    def test_output_changed_false_on_first_tick(self):
        ctrl = _make_select()
        ctrl.update("b", _make_consume_fn({}), "k")
        assert ctrl.output_changed is False

    def test_output_changed_true_when_backend_selects_other_option(self):
        ctrl = _make_select()
        ctrl.update("a", _make_consume_fn({}), "k")
        ctrl.update("c", _make_consume_fn({}), "k")
        assert ctrl.output_changed is True

    def test_output_changed_true_when_frontend_selects_other_option(self):
        ctrl = _make_select()
        ctrl.update("a", _make_consume_fn({}), "k")
        fn = _make_consume_fn({"k": {"index": 1}})
        ctrl.update("a", fn, "k")
        assert ctrl.output_changed is True

    def test_output_changed_clears_on_unchanged_tick(self):
        ctrl = _make_select()
        ctrl.update("a", _make_consume_fn({}), "k")
        ctrl.update("b", _make_consume_fn({}), "k")
        ctrl.update("b", _make_consume_fn({}), "k")
        assert ctrl.output_changed is False

    def test_output_changed_false_for_forced_publish(self):
        ctrl = _make_select()
        ctrl.update("a", _make_consume_fn({}), "k", sync_epoch=0)
        _, _, push = ctrl.update("a", _make_consume_fn({}), "k", sync_epoch=1)
        assert push is True
        assert ctrl.output_changed is False


# ---------------------------------------------------------------------------
# normalize_frontend_updates
# ---------------------------------------------------------------------------


class TestNormalizeFrontendUpdates:
    def test_returns_empty_for_non_dict(self):
        assert normalize_frontend_updates("bad") == {}
        assert normalize_frontend_updates(None) == {}

    def test_extracts_frontend_keys(self):
        payload = {
            "frontend:wv_bind_strinput_a": {"kind": "string-input", "value": "hi"},
            "frontend:wv_bind_numinput_b": {"kind": "number-input", "value": 5},
            "clearAfterRead": True,
            "activePageId": "page-1",
        }
        result = normalize_frontend_updates(payload)
        assert result == {
            "frontend:wv_bind_strinput_a": {"kind": "string-input", "value": "hi"},
            "frontend:wv_bind_numinput_b": {"kind": "number-input", "value": 5},
        }

    def test_ignores_non_string_keys(self):
        payload = {1: {"value": 1}, "frontend:wv_bind_slider_c": {"value": 3}}
        result = normalize_frontend_updates(payload)
        assert result == {"frontend:wv_bind_slider_c": {"value": 3}}
