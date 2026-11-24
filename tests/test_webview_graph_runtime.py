import importlib
import sys
from array import array
from pathlib import Path

import pytest

GRAPH_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "node_pkgs"
    / "webview"
    / "otter_webview"
    / "graph.py"
)

WEBVIEW_PACKAGE_ROOT = GRAPH_PATH.parents[1]


def _load_graph_module():
    root_str = str(WEBVIEW_PACKAGE_ROOT)
    added_path = False
    if root_str not in sys.path:
        sys.path.insert(0, root_str)
        added_path = True
    try:
        module = importlib.import_module("otter_webview.graph")
        return importlib.reload(module)
    finally:
        if added_path:
            try:
                sys.path.remove(root_str)
            except ValueError:
                pass


def test_build_series_uses_indices_when_x_is_missing():
    module = _load_graph_module()

    series_x, series_y = module.build_series(None, [10, 20, 30])

    assert series_x == [0.0, 1.0, 2.0]
    assert series_y == [10.0, 20.0, 30.0]


def test_build_series_pairs_x_and_y_values():
    module = _load_graph_module()

    series_x, series_y = module.build_series([0.5, 1.5, 2.5], [4, 5, 6])

    assert series_x == [0.5, 1.5, 2.5]
    assert series_y == [4.0, 5.0, 6.0]


def test_build_series_stops_at_shorter_x_series():
    module = _load_graph_module()

    series_x, series_y = module.build_series([1, 2], [10, 20, 30, 40])

    assert series_x == [1.0, 2.0]
    assert series_y == [10.0, 20.0]


def test_build_series_treats_empty_x_as_index_fallback():
    module = _load_graph_module()

    series_x, series_y = module.build_series([], [7, 8])

    assert series_x == [0.0, 1.0]
    assert series_y == [7.0, 8.0]


@pytest.mark.parametrize("y_values", [None, []])
def test_build_series_returns_empty_lists_without_y_values(y_values):
    module = _load_graph_module()

    series_x, series_y = module.build_series([1, 2, 3], y_values)

    assert series_x == []
    assert series_y == []


def test_build_series_caps_to_newest_points():
    module = _load_graph_module()

    series_x, series_y = module.build_series(None, [1, 2, 3, 4, 5], 3)

    assert series_x == [2.0, 3.0, 4.0]
    assert series_y == [3.0, 4.0, 5.0]


def test_build_series_keeps_original_indices_after_tail_cap():
    module = _load_graph_module()

    series_x, series_y = module.build_series(None, [10, 11, 12, 13, 14, 15], 2)

    assert series_x == [4.0, 5.0]
    assert series_y == [14.0, 15.0]


def test_build_series_drops_pairs_with_non_finite_y_values():
    module = _load_graph_module()

    series_x, series_y = module.build_series(
        [0, 1, 2, 3, 4],
        [10, float("nan"), 30, float("inf"), 50],
    )

    assert series_x == [0.0, 2.0, 4.0]
    assert series_y == [10.0, 30.0, 50.0]


def test_build_series_drops_pairs_with_non_finite_x_values():
    module = _load_graph_module()

    series_x, series_y = module.build_series([0, float("inf"), 2, float("nan")], [1, 2, 3, 4])

    assert series_x == [0.0, 2.0]
    assert series_y == [1.0, 3.0]


def test_build_series_drops_non_finite_values_inside_tail_window():
    module = _load_graph_module()

    series_x, series_y = module.build_series(None, [1, 2, 3, float("nan"), 5, 6], 3)

    assert series_x == [4.0, 5.0]
    assert series_y == [5.0, 6.0]


def test_build_series_accepts_array_array_inputs():
    module = _load_graph_module()

    series_x, series_y = module.build_series(
        array("f", [0.5, 1.5]),
        array("f", [10.0, 20.0]),
    )

    assert series_x == [0.5, 1.5]
    assert series_y == [10.0, 20.0]


def test_build_series_converts_numeric_strings_to_floats():
    module = _load_graph_module()

    series_x, series_y = module.build_series(["1", "2"], ["3.5", "4"])

    assert series_x == [1.0, 2.0]
    assert series_y == [3.5, 4.0]


def test_build_series_drops_unparsable_values():
    module = _load_graph_module()

    series_x, series_y = module.build_series([0, "bad", 2], [1, 2, object()])

    assert series_x == [0.0]
    assert series_y == [1.0]


@pytest.mark.parametrize(
    ("max_points", "expected_count", "expected_first_index"),
    [
        (0, 1, 9),
        (-5, 1, 9),
        (1, 1, 9),
        (2048, 10, 0),
        (2049, 10, 0),
        ("not-a-number", 10, 0),
    ],
)
def test_build_series_normalizes_max_points(max_points, expected_count, expected_first_index):
    module = _load_graph_module()
    y_values = list(range(10))

    series_x, series_y = module.build_series(None, y_values, max_points)

    assert len(series_x) == expected_count
    assert len(series_y) == expected_count
    assert series_x[0] == float(expected_first_index)
    assert series_y[0] == float(expected_first_index)


def test_build_series_clamps_large_max_points_above_limit():
    module = _load_graph_module()

    series_x, series_y = module.build_series(None, list(range(2100)), 5000)

    assert len(series_x) == module.MAX_POINTS_LIMIT
    assert len(series_y) == module.MAX_POINTS_LIMIT
    assert series_x[0] == float(2100 - module.MAX_POINTS_LIMIT)
    assert series_y[-1] == 2099.0


def test_build_series_returns_independent_lists_without_mutating_inputs():
    module = _load_graph_module()
    x_values = [1, 2, 3]
    y_values = [4, 5, 6]

    first_x, first_y = module.build_series(x_values, y_values, 2)
    second_x, second_y = module.build_series(x_values, y_values, 2)

    assert first_x is not second_x
    assert first_y is not second_y
    first_x.append(99.0)
    first_y.append(99.0)
    assert second_x == [2.0, 3.0]
    assert second_y == [5.0, 6.0]
    assert x_values == [1, 2, 3]
    assert y_values == [4, 5, 6]
