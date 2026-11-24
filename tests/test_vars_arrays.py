import array
import math
import pathlib
import sys

import pytest

VARS_PKG_ROOT = pathlib.Path('src/micro_otter/nodes/device/node_pkgs/vars').resolve()


def array_from(values):
    """Build the ``array('f')`` buffer the runtime operations consume."""
    return array.array('f', values)



@pytest.fixture()
def arrays():
    sys.path.insert(0, str(VARS_PKG_ROOT))
    import otter_vars.arrays as a

    yield a
    sys.path.remove(str(VARS_PKG_ROOT))


def test_generate_reuses_matching_buffer(arrays):
    buf = arrays.generate(None, 5)
    assert len(buf) == 5
    assert list(buf) == [0.0] * 5
    assert arrays.generate(buf, 5) is buf
    assert arrays.generate(buf, 3) is not buf


def test_fill_writes_in_place_when_requested(arrays):
    buf = arrays.generate(None, 5)
    out = arrays.fill(buf, 0.5, inplace=True)
    assert out is buf
    assert list(buf) == [0.5] * 5
    assert list(arrays.fill(buf, 1.5, clamp=True, inplace=True)) == [1.0] * 5


def test_fill_copies_by_default(arrays):
    buf = arrays.generate(None, 3)
    buf[0] = 0.25
    out = arrays.fill(buf, 0.5)
    assert out is not buf
    assert list(buf) == [0.25, 0.0, 0.0]
    assert list(out) == [0.5, 0.5, 0.5]


def test_sources_write_in_place(arrays):
    assert list(arrays.ramp(arrays.generate(None, 4), 0, -1, 0.0, 3.0, inplace=True)) == [
        0.0,
        1.0,
        2.0,
        3.0,
    ]
    assert list(arrays.ramp(arrays.generate(None, 4), 0, -1, 0.0, 3.0, clamp=True)) == [
        0.0,
        1.0,
        1.0,
        1.0,
    ]
    assert list(arrays.steps(arrays.generate(None, 5), 0, 2, 3, 0.0, 1.0)) == [
        0.0,
        0.0,
        0.5,
        0.5,
        1.0,
    ]
    assert list(arrays.hat(arrays.generate(None, 5), 2.0, 2.0, 0.0, 1.0)) == [
        0.0,
        0.0,
        1.0,
        1.0,
        0.0,
    ]
    assert list(arrays.sin_wave(arrays.generate(None, 1), 0, 1, 1, 0.0, 1.0, 0.0)) == [0.0]


def test_steps_fill_the_whole_step_width(arrays):
    assert list(arrays.steps(arrays.generate(None, 8), 0, 2, 3, 0.0, 1.0)) == [
        0.0,
        0.0,
        0.5,
        0.5,
        1.0,
        1.0,
        0.0,
        0.0,
    ]
    assert list(arrays.steps(arrays.generate(None, 8), 0, 3, 2, 0.0, 1.0)) == [
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        0.0,
        0.0,
    ]


def test_steps_clip_plateaus_at_the_buffer_edges(arrays):
    assert list(arrays.steps(arrays.generate(None, 4), 1, 2, 3, 0.0, 1.0)) == [
        0.0,
        0.0,
        0.0,
        0.5,
    ]
    assert list(arrays.steps(arrays.generate(None, 4), -1, 2, 3, 0.0, 1.0)) == [
        0.0,
        0.5,
        0.5,
        1.0,
    ]


def test_sources_copy_the_input_by_default(arrays):
    operations = [
        lambda buf: arrays.fill(buf, 0.5),
        lambda buf: arrays.ramp(buf, 0, -1, 0.0, 1.0),
        lambda buf: arrays.steps(buf, 0, 1, 3, 0.0, 1.0),
        lambda buf: arrays.hat(buf, 0, -1, 0.0, 1.0),
        lambda buf: arrays.sin_wave(buf, 0, 4, 1),
        lambda buf: arrays.shift(buf, 1),
        lambda buf: arrays.random_uniform(buf, 0.0, 1.0),
        lambda buf: arrays.random_normal(buf, 0.5, 0.15, 0.0, 1.0),
    ]
    for operation in operations:
        src = arrays.generate(None, 4)
        src[0] = 0.25
        out = operation(src)
        assert out is not src
        assert list(src) == [0.25, 0.0, 0.0, 0.0]
        assert len(out) == 4


def test_sources_mutate_the_input_when_inplace(arrays):
    operations = [
        lambda buf: arrays.fill(buf, 0.5, inplace=True),
        lambda buf: arrays.ramp(buf, 0, -1, 0.0, 1.0, inplace=True),
        lambda buf: arrays.steps(buf, 0, 1, 3, 0.0, 1.0, inplace=True),
        lambda buf: arrays.hat(buf, 0, -1, 0.0, 1.0, inplace=True),
        lambda buf: arrays.sin_wave(buf, 0, 4, 1, inplace=True),
        lambda buf: arrays.shift(buf, 1, inplace=True),
    ]
    for operation in operations:
        src = arrays.generate(None, 4)
        src[0] = 0.25
        out = operation(src)
        assert out is src
        assert list(src) != [0.25, 0.0, 0.0, 0.0]


def test_sources_accept_none_buffer(arrays):
    assert list(arrays.fill(None, 1.0)) == []
    assert list(arrays.ramp(None, 0.0, 1.0)) == []
    assert list(arrays.steps(None, 0, 1.0)) == []
    assert list(arrays.hat(None, 0.0, 1.0)) == []
    assert list(arrays.sin_wave(None, 0.0)) == []
    assert list(arrays.random_uniform(None, 0.0, 1.0)) == []
    assert list(arrays.random_normal(None, 0.5, 0.15, 0.0, 1.0)) == []


def test_shift_circular_vs_linear(arrays):
    src = arrays.generate(None, 4)
    src[0] = 1.0
    assert list(arrays.shift(src, -1, wrap=True)) == [0.0, 0.0, 0.0, 1.0]

    src = arrays.generate(None, 4)
    src[0] = 1.0
    assert list(arrays.shift(src, -1, wrap=False)) == [0.0, 0.0, 0.0, 0.0]


def test_shift_large_amounts_and_none(arrays):
    src = arrays.generate(None, 3)
    src[0] = 1.0
    assert list(arrays.shift(src, 3, wrap=False)) == [0.0, 0.0, 0.0]
    assert list(arrays.shift(None, 1)) == []


def test_repeat_repeats_blocks(arrays):
    src = array_from([1.0, 2.0, 3.0])
    assert list(arrays.repeat(src, 2)) == [1.0, 2.0, 3.0, 1.0, 2.0, 3.0]
    assert list(arrays.repeat(src, 0)) == []
    assert list(arrays.repeat(src, -2)) == []
    assert list(arrays.repeat(None, 3)) == []


def test_repeat_clamps_and_leaves_the_source_untouched(arrays):
    src = array_from([1.5, 0.5])
    assert list(arrays.repeat(src, 2, clamp=True)) == [1.0, 0.5, 1.0, 0.5]
    assert list(src) == [1.5, 0.5]


def test_ping_pong_alternates_blocks(arrays):
    src = array_from([1.0, 2.0, 3.0])
    assert list(arrays.ping_pong(src, 2)) == [1.0, 2.0, 3.0, 3.0, 2.0, 1.0]
    assert list(arrays.ping_pong(src, 3)) == [
        1.0,
        2.0,
        3.0,
        3.0,
        2.0,
        1.0,
        1.0,
        2.0,
        3.0,
    ]
    assert list(arrays.ping_pong(array_from([0.5]), 3)) == [0.5, 0.5, 0.5]


def test_ping_pong_empty_cases_clamp_and_source(arrays):
    src = array_from([1.5, 0.5])
    assert list(arrays.ping_pong(src, 2, clamp=True)) == [1.0, 0.5, 0.5, 1.0]
    assert list(src) == [1.5, 0.5]
    assert list(arrays.ping_pong(src, 0)) == []
    assert list(arrays.ping_pong(src, -1)) == []
    assert list(arrays.ping_pong(None, 2)) == []


def test_concat_appends_the_second_array(arrays):
    first = array_from([1.0, 2.0])
    second = array_from([3.0, 4.0, 5.0])
    assert list(arrays.concat(first, second)) == [1.0, 2.0, 3.0, 4.0, 5.0]
    assert list(arrays.concat(None, second)) == [3.0, 4.0, 5.0]
    assert list(arrays.concat(first, None)) == [1.0, 2.0]
    assert list(arrays.concat(None, None)) == []
    assert list(arrays.concat(array_from([]), second)) == [3.0, 4.0, 5.0]
    assert list(arrays.concat(first, array_from([]))) == [1.0, 2.0]


def test_concat_clamps_and_leaves_both_inputs_untouched(arrays):
    first = array_from([1.5, -1.0])
    second = array_from([0.5, 2.0])
    assert list(arrays.concat(first, second, clamp=True)) == [1.0, 0.0, 0.5, 1.0]
    assert list(first) == [1.5, -1.0]
    assert list(second) == [0.5, 2.0]


def test_interlace_inserts_other_values_on_the_step_grid(arrays):
    src = array_from([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    other = array_from([9.0, 8.0, 7.0])
    assert list(arrays.interlace(src, other, 2, 1)) == [
        1.0,
        9.0,
        2.0,
        8.0,
        3.0,
        7.0,
        4.0,
        5.0,
        6.0,
    ]
    assert list(arrays.interlace(src, other, 2, 0)) == [
        9.0,
        1.0,
        8.0,
        2.0,
        7.0,
        3.0,
        4.0,
        5.0,
        6.0,
    ]
    assert list(arrays.interlace(src, other, 1)) == [
        9.0,
        8.0,
        7.0,
        1.0,
        2.0,
        3.0,
        4.0,
        5.0,
        6.0,
    ]
    assert list(arrays.interlace(src, other, 2, -1)) == list(
        arrays.interlace(src, other, 2, 1)
    )


def test_interlace_clamps_step_and_offset(arrays):
    src = array_from([1.0, 2.0])
    other = array_from([9.0, 8.0])
    assert list(arrays.interlace(src, other, 0)) == [9.0, 8.0, 1.0, 2.0]
    assert list(arrays.interlace(src, other, -3)) == [9.0, 8.0, 1.0, 2.0]
    assert list(arrays.interlace(src, other, 10, 0)) == [9.0, 1.0, 2.0, 8.0]


def test_interlace_handles_none_and_empty_operands(arrays):
    other = array_from([9.0, 8.0])
    assert list(arrays.interlace(None, other, 2, 1)) == [9.0, 8.0]
    assert list(arrays.interlace(array_from([]), other, 2, 1)) == [9.0, 8.0]
    assert list(arrays.interlace(array_from([1.0, 2.0]), array_from([]), 2, 1)) == [
        1.0,
        2.0,
    ]
    assert list(arrays.interlace(None, None, 2, 1)) == []
    assert list(arrays.interlace(array_from([1.0]), None, 2, 1)) == [1.0]


def test_interlace_clamps_and_leaves_both_inputs_untouched(arrays):
    src = array_from([1.5, 0.5])
    other = array_from([2.0])
    assert list(arrays.interlace(src, other, 1, 0, clamp=True)) == [1.0, 1.0, 0.5]
    assert list(src) == [1.5, 0.5]
    assert list(other) == [2.0]


def test_interlace_always_returns_the_sum_of_both_lengths(arrays):
    cases = [
        (array_from([1.0, 2.0, 3.0]), array_from([9.0, 8.0]), 2, 1),
        (array_from([1.0, 2.0, 3.0]), array_from([9.0]), 5, 3),
        (array_from([]), array_from([9.0, 8.0]), 3, -2),
        (array_from([1.0]), array_from([]), 2, 0),
    ]
    for buf, other, step, offset in cases:
        assert len(arrays.interlace(buf, other, step, offset)) == len(buf) + len(other)


def test_random_uniform_value_stays_within_range(arrays):
    arrays.random.seed(1234)
    for _ in range(500):
        assert -2.0 <= arrays.random_uniform_value(-2.0, 3.0) <= 3.0


def test_random_uniform_value_swaps_reversed_bounds(arrays):
    arrays.random.seed(1234)
    for _ in range(200):
        assert -2.0 <= arrays.random_uniform_value(3.0, -2.0) <= 3.0


def test_random_uniform_value_constant_range(arrays):
    assert arrays.random_uniform_value(0.75, 0.75) == 0.75


def test_random_uniform_value_integer_rounds_to_int(arrays):
    arrays.random.seed(1234)
    for _ in range(200):
        value = arrays.random_uniform_value(-2.0, 3.0, integer=True)
        assert isinstance(value, int)
        assert -2 <= value <= 3


def test_random_normal_value_cuts_to_bounds(arrays):
    arrays.random.seed(1234)
    for _ in range(200):
        assert 0.0 <= arrays.random_normal_value(10.0, 0.01, 0.0, 1.0) <= 1.0


def test_random_normal_value_zero_stddev_returns_mean(arrays):
    assert arrays.random_normal_value(0.25, 0.0, 0.0, 1.0) == 0.25


def test_random_normal_value_treats_stddev_as_absolute(arrays):
    arrays.random.seed(1234)
    positive = [arrays.random_normal_value(0.0, 0.2, -10.0, 10.0) for _ in range(50)]
    arrays.random.seed(1234)
    negative = [arrays.random_normal_value(0.0, -0.2, -10.0, 10.0) for _ in range(50)]
    assert positive == negative


def test_random_normal_value_integer_rounds_to_int(arrays):
    arrays.random.seed(1234)
    for _ in range(200):
        value = arrays.random_normal_value(0.5, 0.15, 0.0, 1.0, integer=True)
        assert isinstance(value, int)
        assert 0 <= value <= 1


def test_random_uniform_stays_within_range(arrays):
    arrays.random.seed(1234)
    src = arrays.random_uniform(arrays.generate(None, 500), -2.0, 3.0)
    assert all(-2.0 <= value <= 3.0 for value in src)
    assert len(set(src)) > 1


def test_random_uniform_swaps_reversed_bounds(arrays):
    arrays.random.seed(1234)
    src = arrays.random_uniform(arrays.generate(None, 200), 3.0, -2.0)
    assert all(-2.0 <= value <= 3.0 for value in src)


def test_random_uniform_constant_range(arrays):
    src = arrays.random_uniform(arrays.generate(None, 4), 0.75, 0.75)
    assert list(src) == pytest.approx([0.75] * 4)


def test_random_uniform_applies_clamp(arrays):
    arrays.random.seed(1234)
    src = arrays.random_uniform(arrays.generate(None, 200), -10.0, 10.0, clamp=True)
    assert all(0.0 <= value <= 1.0 for value in src)


def test_random_uniform_mutates_the_input_when_inplace(arrays):
    arrays.random.seed(1234)
    src = arrays.generate(None, 5)
    src[0] = 0.25
    out = arrays.random_uniform(src, -2.0, 3.0, inplace=True)
    assert out is src
    assert all(-2.0 <= value <= 3.0 for value in src)


def test_random_normal_stays_within_cut_range(arrays):
    arrays.random.seed(1234)
    src = arrays.random_normal(arrays.generate(None, 500), 0.0, 1.0, -2.0, 2.0)
    assert all(-2.0 <= value <= 2.0 for value in src)


def test_random_normal_swaps_reversed_bounds(arrays):
    arrays.random.seed(1234)
    src = arrays.random_normal(arrays.generate(None, 200), 0.0, 0.01, 1.0, -1.0)
    assert all(-1.0 <= value <= 1.0 for value in src)


def test_random_normal_mean_and_spread(arrays):
    arrays.random.seed(1234)
    values = list(arrays.random_normal(arrays.generate(None, 4000), 0.0, 1.0, -20.0, 20.0))
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    assert mean == pytest.approx(0.0, abs=0.1)
    assert math.sqrt(variance) == pytest.approx(1.0, abs=0.1)


def test_random_normal_zero_stddev_returns_the_mean(arrays):
    src = arrays.random_normal(arrays.generate(None, 4), 0.25, 0.0, 0.0, 1.0)
    assert list(src) == pytest.approx([0.25] * 4)


def test_random_normal_cuts_values_to_the_bounds(arrays):
    arrays.random.seed(1234)
    src = arrays.random_normal(arrays.generate(None, 50), 0.0, 0.01, 5.0, 6.0)
    assert list(src) == pytest.approx([5.0] * 50)

    arrays.random.seed(1234)
    src = arrays.random_normal(arrays.generate(None, 50), 10.0, 0.01, 0.0, 1.0)
    assert list(src) == pytest.approx([1.0] * 50)


def test_random_normal_treats_stddev_as_absolute(arrays):
    arrays.random.seed(1234)
    positive = list(arrays.random_normal(arrays.generate(None, 50), 0.0, 0.2, -10.0, 10.0))
    arrays.random.seed(1234)
    negative = list(arrays.random_normal(arrays.generate(None, 50), 0.0, -0.2, -10.0, 10.0))
    assert negative == pytest.approx(positive)


def test_random_normal_applies_clamp(arrays):
    arrays.random.seed(1234)
    src = arrays.random_normal(arrays.generate(None, 500), 0.0, 10.0, -100.0, 100.0, clamp=True)
    assert all(0.0 <= value <= 1.0 for value in src)


def test_random_normal_mutates_the_input_when_inplace(arrays):
    arrays.random.seed(1234)
    src = arrays.generate(None, 5)
    src[0] = 0.25
    out = arrays.random_normal(src, 0.5, 0.15, 0.0, 1.0, inplace=True)
    assert out is src
    assert all(0.0 <= value <= 1.0 for value in src)


def test_binary_broadcasts_scalar_and_array(arrays):
    src = arrays.fill(arrays.generate(None, 3), 0.5)
    assert list(arrays.add(src, 1.0)) == [1.5, 1.5, 1.5]
    assert list(arrays.add(1.0, src)) == [1.5, 1.5, 1.5]


def test_scalar_scalar_returns_length_one(arrays):
    arr = arrays.add(1, 2)
    assert len(arr) == 1
    assert list(arr) == [3.0]


def test_binary_mismatch_raises(arrays):
    with pytest.raises(ValueError):
        arrays.add(arrays.generate(None, 2), arrays.generate(None, 3))


def test_mod_broadcasts_scalar_and_array(arrays):
    src = arrays.fill(arrays.generate(None, 3), 5.5)
    assert list(arrays.mod(src, 2.0)) == pytest.approx([1.5, 1.5, 1.5])
    assert list(arrays.mod(5.5, src)) == pytest.approx([0.0, 0.0, 0.0])
    assert list(arrays.mod(arrays.generate(None, 3), -2.0)) == pytest.approx([0.0, 0.0, 0.0])


def test_mod_maps_elementwise(arrays):
    src = arrays.generate(None, 4)
    src[0] = 7.0
    src[1] = -7.0
    src[2] = 2.5
    src[3] = 0.5
    assert list(arrays.mod(src, 3.0)) == pytest.approx([1.0, 2.0, 2.5, 0.5])


def test_mod_scalar_scalar_returns_length_one(arrays):
    arr = arrays.mod(7, 3)
    assert len(arr) == 1
    assert list(arr) == pytest.approx([1.0])


def test_mod_by_zero_returns_zero(arrays):
    assert list(arrays.mod(5.0, 0.0)) == pytest.approx([0.0])
    assert list(arrays.mod(arrays.generate(None, 2), 0.0)) == pytest.approx([0.0, 0.0])


def test_mod_mismatch_raises(arrays):
    with pytest.raises(ValueError):
        arrays.mod(arrays.generate(None, 2), arrays.generate(None, 3))


def test_mod_applies_clamp(arrays):
    assert list(arrays.mod(7.5, 2.0)) == pytest.approx([1.5])
    assert list(arrays.mod(7.5, 2.0, clamp=True)) == pytest.approx([1.0])


def test_power_broadcasts_scalar_and_array(arrays):
    scalar = arrays.power(2.0, 3.0)
    assert len(scalar) == 1
    assert scalar.typecode == 'f'
    assert list(scalar) == pytest.approx([8.0])

    src = arrays.fill(arrays.generate(None, 3), 2.0)
    assert list(arrays.power(src, 3.0)) == pytest.approx([8.0, 8.0, 8.0])
    assert list(arrays.power(2.0, src)) == pytest.approx([4.0, 4.0, 4.0])


def test_power_maps_arrays_elementwise(arrays):
    base = arrays.generate(None, 3)
    base[0] = 2.0
    base[1] = 3.0
    base[2] = 4.0
    exponent = arrays.fill(arrays.generate(None, 3), 2.0)
    assert list(arrays.power(base, exponent)) == pytest.approx([4.0, 9.0, 16.0])


def test_power_applies_clamp(arrays):
    assert list(arrays.power(3.0, 3.0)) == pytest.approx([27.0])
    assert list(arrays.power(3.0, 3.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.power(0.5, 2.0, clamp=True)) == pytest.approx([0.25])


def test_power_invalid_domain_raises(arrays):
    with pytest.raises(ValueError):
        arrays.power(-8.0, 0.5)


def test_power_mismatch_raises(arrays):
    with pytest.raises(ValueError):
        arrays.power(arrays.generate(None, 2), arrays.generate(None, 3))


def test_root_returns_the_real_principal_root(arrays):
    square = arrays.root(9.0, 2.0)
    assert len(square) == 1
    assert square.typecode == 'f'
    assert list(square) == pytest.approx([3.0])
    assert list(arrays.root(27.0, 3.0)) == pytest.approx([3.0])


def test_root_broadcasts_scalar_and_array(arrays):
    radicand = arrays.generate(None, 3)
    radicand[0] = 4.0
    radicand[1] = 9.0
    radicand[2] = 16.0
    assert list(arrays.root(radicand, 2.0)) == pytest.approx([2.0, 3.0, 4.0])

    degree = arrays.generate(None, 3)
    degree[0] = 1.0
    degree[1] = 2.0
    degree[2] = 4.0
    assert list(arrays.root(16.0, degree)) == pytest.approx([16.0, 4.0, 2.0])


def test_root_maps_arrays_elementwise(arrays):
    radicand = arrays.generate(None, 3)
    radicand[0] = 8.0
    radicand[1] = 27.0
    radicand[2] = 64.0
    degree = arrays.fill(arrays.generate(None, 3), 3.0)
    assert list(arrays.root(radicand, degree)) == pytest.approx([2.0, 3.0, 4.0])


def test_root_applies_clamp(arrays):
    assert list(arrays.root(27.0, 3.0)) == pytest.approx([3.0])
    assert list(arrays.root(27.0, 3.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.root(0.25, 2.0, clamp=True)) == pytest.approx([0.5])


def test_root_invalid_domain_raises(arrays):
    with pytest.raises(ValueError):
        arrays.root(-8.0, 3.0)


def test_root_zero_degree_raises_zero_division(arrays):
    with pytest.raises(ZeroDivisionError):
        arrays.root(8.0, 0.0)


def test_root_mismatch_raises(arrays):
    with pytest.raises(ValueError):
        arrays.root(arrays.generate(None, 2), arrays.generate(None, 3))


def test_ln_returns_the_natural_logarithm(arrays):
    scalar = arrays.ln(math.e)
    assert len(scalar) == 1
    assert scalar.typecode == 'f'
    assert list(scalar) == pytest.approx([1.0])


def test_ln_maps_arrays_elementwise(arrays):
    src = arrays.generate(None, 3)
    src[0] = 1.0
    src[1] = math.e
    src[2] = math.e ** 2
    assert list(arrays.ln(src)) == pytest.approx([0.0, 1.0, 2.0])


def test_ln_applies_clamp(arrays):
    assert list(arrays.ln(0.5)) == pytest.approx([math.log(0.5)])
    assert list(arrays.ln(0.5, clamp=True)) == pytest.approx([0.0])


def test_ln_invalid_domain_raises(arrays):
    with pytest.raises(ValueError):
        arrays.ln(0.0)
    with pytest.raises(ValueError):
        arrays.ln(-1.0)


def test_log_returns_the_logarithm_to_a_base(arrays):
    scalar = arrays.log(8.0, 2.0)
    assert len(scalar) == 1
    assert scalar.typecode == 'f'
    assert list(scalar) == pytest.approx([3.0])


def test_log_broadcasts_scalar_and_array(arrays):
    src = arrays.fill(arrays.generate(None, 3), 8.0)
    assert list(arrays.log(src, 2.0)) == pytest.approx([3.0, 3.0, 3.0])
    assert list(arrays.log(8.0, src)) == pytest.approx(
        [math.log(8.0, 8.0)] * 3
    )


def test_log_maps_arrays_elementwise(arrays):
    value = arrays.generate(None, 3)
    value[0] = 1.0
    value[1] = 8.0
    value[2] = 100.0
    base = arrays.fill(arrays.generate(None, 3), 10.0)
    assert list(arrays.log(value, base)) == pytest.approx([0.0, math.log(8.0, 10.0), 2.0])


def test_log_applies_clamp(arrays):
    assert list(arrays.log(8.0, 2.0)) == pytest.approx([3.0])
    assert list(arrays.log(8.0, 2.0, clamp=True)) == pytest.approx([1.0])


def test_log_invalid_domain_raises(arrays):
    with pytest.raises(ValueError):
        arrays.log(-8.0, 2.0)
    with pytest.raises(ValueError):
        arrays.log(8.0, 0.0)
    with pytest.raises(ValueError):
        arrays.log(0.0, 2.0)


def test_log_with_base_one_raises_zero_division(arrays):
    with pytest.raises(ZeroDivisionError):
        arrays.log(8.0, 1.0)


def test_log_mismatch_raises(arrays):
    with pytest.raises(ValueError):
        arrays.log(arrays.generate(None, 2), arrays.generate(None, 3))


def test_unary_math_functions_broadcast_scalars(arrays):
    assert list(arrays.sqrt(9.0)) == pytest.approx([3.0])
    assert list(arrays.square(3.0)) == pytest.approx([9.0])
    assert list(arrays.fraction(1.25)) == pytest.approx([0.25])
    assert list(arrays.exp(0.0)) == pytest.approx([1.0])
    for result in (arrays.sqrt(9.0), arrays.square(3.0), arrays.fraction(1.25), arrays.exp(0.0)):
        assert len(result) == 1


def test_unary_math_functions_map_arrays_elementwise(arrays):
    src = arrays.generate(None, 4)
    src[0] = 0.0
    src[1] = 1.0
    src[2] = 4.0
    src[3] = 9.0
    assert list(arrays.sqrt(src)) == pytest.approx([0.0, 1.0, 2.0, 3.0])
    assert list(arrays.square(src)) == pytest.approx([0.0, 1.0, 16.0, 81.0])
    assert list(arrays.exp(src)) == pytest.approx([1.0, math.e, math.e ** 4.0, math.e ** 9.0])


def test_fraction_handles_negative_values(arrays):
    assert list(arrays.fraction(1.25)) == pytest.approx([0.25])
    assert list(arrays.fraction(-1.25)) == pytest.approx([0.75])
    src = arrays.generate(None, 3)
    src[0] = 2.5
    src[1] = -2.5
    src[2] = 3.0
    assert list(arrays.fraction(src)) == pytest.approx([0.5, 0.5, 0.0])


def test_exp_of_zero_is_one(arrays):
    assert list(arrays.exp(0)) == pytest.approx([1.0])


def test_floor_and_ceil_round_to_integers(arrays):
    assert list(arrays.floor(1.7)) == pytest.approx([1.0])
    assert list(arrays.floor(-1.2)) == pytest.approx([-2.0])
    assert list(arrays.ceil(1.2)) == pytest.approx([2.0])
    assert list(arrays.ceil(-1.7)) == pytest.approx([-1.0])


def test_floor_and_ceil_keep_exact_integers(arrays):
    assert list(arrays.floor(3.0)) == pytest.approx([3.0])
    assert list(arrays.ceil(3.0)) == pytest.approx([3.0])


def test_floor_and_ceil_map_arrays_elementwise(arrays):
    src = arrays.generate(None, 4)
    src[0] = 1.2
    src[1] = 1.8
    src[2] = -1.2
    src[3] = -1.8
    assert list(arrays.floor(src)) == pytest.approx([1.0, 1.0, -2.0, -2.0])
    assert list(arrays.ceil(src)) == pytest.approx([2.0, 2.0, -1.0, -1.0])


def test_floor_and_ceil_apply_clamp(arrays):
    assert list(arrays.floor(4.7, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.ceil(-0.5, clamp=True)) == pytest.approx([0.0])


def test_round_defaults_to_whole_numbers(arrays):
    assert list(arrays.round(2.4)) == pytest.approx([2.0])
    assert list(arrays.round(2.6)) == pytest.approx([3.0])
    assert list(arrays.round(-2.4)) == pytest.approx([-2.0])


def test_round_keeps_the_requested_decimal_places(arrays):
    assert list(arrays.round(2.345, decimals=2)) == pytest.approx([2.35])
    assert list(arrays.round(2.345, decimals=1)) == pytest.approx([2.3])
    assert list(arrays.round(-2.345, decimals=2)) == pytest.approx([-2.35])
    assert list(arrays.round(2.345, decimals=6)) == pytest.approx([2.345])


def test_round_treats_negative_decimals_as_whole_numbers(arrays):
    assert list(arrays.round(2.6, decimals=-2)) == pytest.approx([3.0])


def test_round_maps_arrays_elementwise_and_returns_scalar_broadcast(arrays):
    src = arrays.generate(None, 3)
    src[0] = 1.234
    src[1] = 2.567
    src[2] = -3.5
    assert list(arrays.round(src, decimals=1)) == pytest.approx([1.2, 2.6, -3.5])
    assert len(arrays.round(1.234, decimals=2)) == 1


def test_round_applies_clamp(arrays):
    assert list(arrays.round(3.7, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.round(-0.4, clamp=True)) == pytest.approx([0.0])


def test_module_round_keeps_the_builtin_reachable(arrays):
    # The module defines ``round`` itself, so the builtin is aliased before the definition.
    assert arrays._builtin_round is not arrays.round
    assert arrays._builtin_round(2.6) == 3


def test_unary_math_functions_apply_clamp(arrays):
    assert list(arrays.sqrt(4.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.sqrt(0.25, clamp=True)) == pytest.approx([0.5])
    assert list(arrays.square(2.0, clamp=True)) == pytest.approx([1.0])


def test_sqrt_of_negative_raises(arrays):
    with pytest.raises(ValueError):
        arrays.sqrt(-1.0)
    src = arrays.generate(None, 2)
    src[1] = -4.0
    with pytest.raises(ValueError):
        arrays.sqrt(src)


def test_forward_trig_uses_degrees_by_default(arrays):
    assert list(arrays.sin(90.0)) == pytest.approx([1.0])
    assert list(arrays.cos(0.0)) == pytest.approx([1.0])
    assert list(arrays.tan(45.0)) == pytest.approx([1.0])
    assert list(arrays.sin(90.0, angle_unit='degrees')) == pytest.approx([1.0])


def test_forward_trig_accepts_radians(arrays):
    assert list(arrays.sin(math.pi / 2.0, angle_unit='radians')) == pytest.approx([1.0])
    assert list(arrays.cos(math.pi, angle_unit='radians')) == pytest.approx([-1.0])
    assert list(arrays.tan(math.pi / 4.0, angle_unit='radians')) == pytest.approx([1.0])


def test_forward_trig_accepts_percent_cycles(arrays):
    assert list(arrays.sin(0.25, angle_unit='percent')) == pytest.approx([1.0])
    assert list(arrays.cos(0.5, angle_unit='percent')) == pytest.approx([-1.0])
    assert list(arrays.tan(0.125, angle_unit='percent')) == pytest.approx([1.0])


def test_inverse_trig_returns_degrees(arrays):
    assert list(arrays.asin(1.0)) == pytest.approx([90.0])
    assert list(arrays.acos(1.0)) == pytest.approx([0.0])
    assert list(arrays.atan(1.0)) == pytest.approx([45.0])
    assert list(arrays.asin(0.5, angle_unit='degrees')) == pytest.approx([30.0])


def test_inverse_trig_returns_radians(arrays):
    assert list(arrays.asin(1.0, angle_unit='radians')) == pytest.approx([math.pi / 2.0])
    assert list(arrays.acos(0.0, angle_unit='radians')) == pytest.approx([math.pi / 2.0])
    assert list(arrays.atan(1.0, angle_unit='radians')) == pytest.approx([math.pi / 4.0])


def test_inverse_trig_returns_percent_cycles(arrays):
    assert list(arrays.asin(1.0, angle_unit='percent')) == pytest.approx([0.25])
    assert list(arrays.acos(-1.0, angle_unit='percent')) == pytest.approx([0.5])
    assert list(arrays.atan(1.0, angle_unit='percent')) == pytest.approx([0.125])


def test_atan_maps_arrays_elementwise(arrays):
    src = arrays.generate(None, 3)
    src[0] = -1.0
    src[1] = 0.0
    src[2] = 1.0
    assert list(arrays.atan(src)) == pytest.approx([-45.0, 0.0, 45.0])
    assert list(arrays.atan(1e6)) == pytest.approx([90.0])


def test_atan2_argument_order_and_units(arrays):
    assert list(arrays.atan2(1.0, 1.0, angle_unit='degrees')) == pytest.approx([45.0])
    assert list(arrays.atan2(1.0, 1.0, angle_unit='radians')) == pytest.approx([math.pi / 4.0])
    assert list(arrays.atan2(1.0, 1.0, angle_unit='percent')) == pytest.approx([0.125])
    assert list(arrays.atan2(0.0, -1.0, angle_unit='degrees')) == pytest.approx([180.0])


def test_trig_angle_unit_falls_back_to_degrees(arrays):
    assert list(arrays.sin(90.0, angle_unit=None)) == pytest.approx([1.0])
    assert list(arrays.sin(90.0, angle_unit='gradians')) == pytest.approx([1.0])


def test_inverse_trig_applies_clamp(arrays):
    assert list(arrays.asin(1.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.acos(-1.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.atan(1.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.asin(0.5)) == pytest.approx([30.0])


def test_atan2_mismatch_raises(arrays):
    with pytest.raises(ValueError):
        arrays.atan2(arrays.generate(None, 2), arrays.generate(None, 3))


def test_asin_out_of_range_raises(arrays):
    with pytest.raises(ValueError):
        arrays.asin(2.0)


# The MicroPython build uses MICROPY_FLOAT_IMPL_FLOAT, so array('f') results are
# single precision; the tolerance below keeps the expectations meaningful there.
HYPERBOLIC_TOLERANCE = {'rel': 1e-5, 'abs': 1e-6}


def test_hyperbolic_functions_broadcast_scalars(arrays):
    assert list(arrays.sinh(0.0)) == pytest.approx([0.0])
    assert list(arrays.cosh(0.0)) == pytest.approx([1.0])
    assert list(arrays.tanh(0.0)) == pytest.approx([0.0])
    assert list(arrays.asinh(0.0)) == pytest.approx([0.0])
    assert list(arrays.acosh(1.0)) == pytest.approx([0.0])
    assert list(arrays.atanh(0.0)) == pytest.approx([0.0])
    for result in (
        arrays.sinh(0.0),
        arrays.cosh(0.0),
        arrays.tanh(0.0),
        arrays.asinh(0.0),
        arrays.acosh(1.0),
        arrays.atanh(0.0),
    ):
        assert len(result) == 1
        assert result.typecode == 'f'


def test_hyperbolic_functions_round_trip(arrays):
    assert list(arrays.sinh(arrays.asinh(2.0))) == pytest.approx(
        [2.0], **HYPERBOLIC_TOLERANCE
    )
    assert list(arrays.cosh(arrays.acosh(2.0))) == pytest.approx(
        [2.0], **HYPERBOLIC_TOLERANCE
    )
    assert list(arrays.tanh(arrays.atanh(0.5))) == pytest.approx(
        [0.5], **HYPERBOLIC_TOLERANCE
    )


def test_hyperbolic_functions_map_arrays_elementwise(arrays):
    src = arrays.generate(None, 3)
    src[0] = -1.0
    src[1] = 0.0
    src[2] = 1.0
    assert list(arrays.sinh(src)) == pytest.approx(
        [-math.sinh(1.0), 0.0, math.sinh(1.0)], **HYPERBOLIC_TOLERANCE
    )
    assert list(arrays.cosh(src)) == pytest.approx(
        [math.cosh(1.0), 1.0, math.cosh(1.0)], **HYPERBOLIC_TOLERANCE
    )
    assert list(arrays.asinh(src)) == pytest.approx(
        [math.asinh(-1.0), 0.0, math.asinh(1.0)], **HYPERBOLIC_TOLERANCE
    )


def test_hyperbolic_functions_apply_clamp(arrays):
    assert list(arrays.sinh(1.0)) == pytest.approx([math.sinh(1.0)])
    assert list(arrays.sinh(1.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.cosh(-1.0, clamp=True)) == pytest.approx([1.0])
    assert list(arrays.tanh(-1.0)) == pytest.approx([math.tanh(-1.0)])
    assert list(arrays.tanh(-1.0, clamp=True)) == pytest.approx([0.0])
    assert list(arrays.asinh(0.5, clamp=True)) == pytest.approx([math.asinh(0.5)])
    assert list(arrays.atanh(0.5, clamp=True)) == pytest.approx([math.atanh(0.5)])


def test_inverse_hyperbolic_functions_reject_out_of_domain(arrays):
    with pytest.raises(ValueError):
        arrays.acosh(0.5)
    with pytest.raises(ValueError):
        arrays.atanh(1.0)
    with pytest.raises(ValueError):
        arrays.atanh(-1.0)


def _sample_buffer(arrays):
    buf = arrays.generate(None, 4)
    buf[0] = 1.0
    buf[1] = 2.0
    buf[2] = 3.0
    buf[3] = 4.0
    return buf


def test_select_returns_element_in_range(arrays):
    buf = _sample_buffer(arrays)
    assert arrays.select(buf, 0) == 1.0
    assert arrays.select(buf, 1) == 2.0
    assert arrays.select(buf, 3) == 4.0


def test_select_truncates_float_index(arrays):
    buf = _sample_buffer(arrays)
    assert arrays.select(buf, 2.9) == 3.0
    assert arrays.select(buf, 1.99) == 2.0


def test_select_default_mode_returns_default_out_of_range(arrays):
    buf = _sample_buffer(arrays)
    assert arrays.select(buf, -1, -5.0) == -5.0
    assert arrays.select(buf, 4, -5.0) == -5.0
    assert arrays.select(buf, 99, -5.0) == -5.0
    assert arrays.select(buf, 99) == 0.0


def test_select_unknown_mode_behaves_like_default(arrays):
    buf = _sample_buffer(arrays)
    assert arrays.select(buf, 99, -5.0, mode='nonsense') == -5.0
    assert arrays.select(buf, 2, -5.0, mode='nonsense') == 3.0
    assert arrays.select(buf, 99, -5.0, mode=None) == -5.0


def test_select_clamp_snaps_to_edges(arrays):
    buf = _sample_buffer(arrays)
    assert arrays.select(buf, -7, mode='clamp') == 1.0
    assert arrays.select(buf, -1, mode='clamp') == 1.0
    assert arrays.select(buf, 4, mode='clamp') == 4.0
    assert arrays.select(buf, 99, mode='clamp') == 4.0


def test_select_wrap_wraps_both_directions(arrays):
    buf = _sample_buffer(arrays)
    assert arrays.select(buf, -1, mode='wrap') == 4.0
    assert arrays.select(buf, -7, mode='wrap') == 2.0
    assert arrays.select(buf, 4, mode='wrap') == 1.0
    assert arrays.select(buf, 5, mode='wrap') == 2.0
    assert arrays.select(buf, 7, mode='wrap') == 4.0
    assert arrays.select(buf, 2, mode='wrap') == 3.0


def test_select_handles_empty_and_missing_buffers(arrays):
    empty = arrays.generate(None, 0)
    for mode in ('default', 'clamp', 'wrap'):
        assert arrays.select(None, 0, -5.0, mode=mode) == -5.0
        assert arrays.select(empty, 0, -5.0, mode=mode) == -5.0
        assert arrays.select(empty, -3, -5.0, mode=mode) == -5.0


def test_select_ignores_default_for_in_range_index(arrays):
    buf = _sample_buffer(arrays)
    for mode in ('default', 'clamp', 'wrap'):
        assert arrays.select(buf, 2, -5.0, mode=mode) == 3.0


def test_set_scalar_value(arrays):
    buf = arrays.generate(None, 4)
    out = arrays.set(buf, 2, 0.75)
    assert out is not buf
    assert list(out) == [0.0, 0.0, 0.75, 0.0]
    assert list(buf) == [0.0, 0.0, 0.0, 0.0]


def test_set_scalar_clamps_out_of_range_index(arrays):
    buf = arrays.generate(None, 4)
    assert list(arrays.set(buf, 9, 1.0, mode='clamp')) == [0.0, 0.0, 0.0, 1.0]
    assert list(arrays.set(buf, -3, 1.0, mode='clamp')) == [1.0, 0.0, 0.0, 0.0]


def test_set_scalar_wraps_out_of_range_index(arrays):
    buf = arrays.generate(None, 4)
    assert list(arrays.set(buf, 5, 1.0, mode='wrap')) == [0.0, 1.0, 0.0, 0.0]
    assert list(arrays.set(buf, -1, 1.0, mode='wrap')) == [0.0, 0.0, 0.0, 1.0]


def test_set_subarray_stops_at_end(arrays):
    src = arrays.generate(None, 4)
    values = arrays.generate(None, 3)
    values[0] = 1.0
    values[1] = 2.0
    values[2] = 3.0
    out = arrays.set(src, 2, values, mode='clamp')
    assert list(out) == [0.0, 0.0, 1.0, 2.0]


def test_set_subarray_wraps_at_end(arrays):
    src = arrays.generate(None, 4)
    values = arrays.generate(None, 3)
    values[0] = 1.0
    values[1] = 2.0
    values[2] = 3.0
    out = arrays.set(src, 2, values, mode='wrap')
    assert list(out) == [3.0, 0.0, 1.0, 2.0]


def test_set_subarray_never_overwrites_start_twice(arrays):
    src = arrays.generate(None, 3)
    values = arrays.generate(None, 5)
    values[0] = 1.0
    values[1] = 2.0
    values[2] = 3.0
    values[3] = 4.0
    values[4] = 5.0
    out = arrays.set(src, 1, values, mode='wrap')
    assert list(out) == [3.0, 1.0, 2.0]


def test_set_indices_scalar_value(arrays):
    src = arrays.generate(None, 4)
    indices = arrays.generate(None, 2)
    indices[0] = 0.0
    indices[1] = 3.0
    assert list(arrays.set_indices(src, indices, 0.5)) == [0.5, 0.0, 0.0, 0.5]


def test_set_indices_floors_float_indices(arrays):
    src = arrays.generate(None, 4)
    indices = arrays.generate(None, 2)
    indices[0] = 2.9
    indices[1] = 2.1
    assert list(arrays.set_indices(src, indices, 1.0)) == [0.0, 0.0, 1.0, 0.0]


def test_set_indices_floor_then_clamp_negative(arrays):
    src = arrays.generate(None, 4)
    indices = arrays.generate(None, 1)
    indices[0] = -1.9
    assert list(arrays.set_indices(src, indices, 1.0, mode='clamp')) == [1.0, 0.0, 0.0, 0.0]


def test_set_indices_wrap_mode(arrays):
    src = arrays.generate(None, 4)
    indices = arrays.generate(None, 1)
    indices[0] = 6.0
    assert list(arrays.set_indices(src, indices, 1.0, mode='wrap')) == [0.0, 0.0, 1.0, 0.0]


def test_set_indices_array_value(arrays):
    src = arrays.generate(None, 4)
    indices = arrays.generate(None, 3)
    indices[0] = 0.0
    indices[1] = 1.0
    indices[2] = 2.0
    values = arrays.generate(None, 2)
    values[0] = 5.0
    values[1] = 6.0
    assert list(arrays.set_indices(src, indices, values)) == [5.0, 6.0, 0.0, 0.0]


def test_set_accepts_none_and_empty_buffers(arrays):
    assert list(arrays.set(None, 0, 1.0)) == []
    assert list(arrays.set_indices(None, arrays.generate(None, 1), 1.0)) == []
    assert list(arrays.set(arrays.generate(None, 0), 0, 1.0)) == []
    assert list(arrays.set_indices(arrays.generate(None, 0), arrays.generate(None, 1), 1.0)) == []


def test_set_shift_in_range_index_does_not_slide(arrays):
    src = _sample_buffer(arrays)
    out = arrays.set(src, 2, 9.0, mode='shift', fill=0.5)
    assert list(out) == [1.0, 2.0, 9.0, 4.0]
    assert list(src) == [1.0, 2.0, 3.0, 4.0]


def test_set_shift_one_place_slide_hides_the_fill(arrays):
    assert list(arrays.set(_sample_buffer(arrays), 4, 9.0, mode='shift', fill=0.5)) == [
        2.0,
        3.0,
        4.0,
        9.0,
    ]


def test_set_shift_fills_the_slots_the_slide_vacates(arrays):
    assert list(arrays.set(_sample_buffer(arrays), 5, 9.0, mode='shift', fill=0.5)) == [
        3.0,
        4.0,
        0.5,
        9.0,
    ]
    assert list(arrays.set(_sample_buffer(arrays), 6, 9.0, mode='shift', fill=0.5)) == [
        4.0,
        0.5,
        0.5,
        9.0,
    ]


def test_set_shift_deficit_at_least_the_length_fills_every_slot(arrays):
    assert list(arrays.set(_sample_buffer(arrays), 9, 9.0, mode='shift', fill=0.5)) == [
        0.5,
        0.5,
        0.5,
        9.0,
    ]


def test_set_shift_negative_index_slides_right(arrays):
    assert list(arrays.set(_sample_buffer(arrays), -1, 9.0, mode='shift', fill=0.5)) == [
        9.0,
        1.0,
        2.0,
        3.0,
    ]
    assert list(arrays.set(_sample_buffer(arrays), -2, 9.0, mode='shift', fill=0.5)) == [
        9.0,
        0.5,
        1.0,
        2.0,
    ]
    assert list(arrays.set(_sample_buffer(arrays), -4, 9.0, mode='shift', fill=0.5)) == [
        9.0,
        0.5,
        0.5,
        0.5,
    ]


def test_set_shift_defaults_the_fill_to_zero(arrays):
    assert list(arrays.set(_sample_buffer(arrays), 5, 9.0, mode='shift')) == [
        3.0,
        4.0,
        0.0,
        9.0,
    ]


def test_set_shift_subarray_stops_at_the_end(arrays):
    values = array_from([7.0, 8.0])
    assert list(arrays.set(_sample_buffer(arrays), 5, values, mode='shift', fill=0.5)) == [
        3.0,
        4.0,
        0.5,
        7.0,
    ]


def test_set_shift_inplace_mutates_the_caller_buffer(arrays):
    src = _sample_buffer(arrays)
    out = arrays.set(src, 5, 9.0, mode='shift', fill=0.5, inplace=True)
    assert out is src
    assert list(src) == [3.0, 4.0, 0.5, 9.0]


def test_set_indices_shift_resolves_each_entry_sequentially(arrays):
    indices = array_from([-1.0, 6.0])
    out = arrays.set_indices(_sample_buffer(arrays), indices, 9.0, mode='shift', fill=0.5)
    assert list(out) == [3.0, 0.5, 0.5, 9.0]


def test_set_fill_is_ignored_for_clamp_and_wrap(arrays):
    assert list(arrays.set(_sample_buffer(arrays), 9, 1.0, mode='clamp', fill=0.5)) == [
        1.0,
        2.0,
        3.0,
        1.0,
    ]
    assert list(arrays.set(_sample_buffer(arrays), 9, 1.0, mode='wrap', fill=0.5)) == [
        1.0,
        1.0,
        3.0,
        4.0,
    ]


def test_set_shift_accepts_none_and_empty_buffers(arrays):
    assert list(arrays.set(None, 5, 1.0, mode='shift', fill=0.5)) == []
    assert list(arrays.set(arrays.generate(None, 0), 5, 1.0, mode='shift', fill=0.5)) == []


def test_fill_partial_range_leaves_edges(arrays):
    src = arrays.generate(None, 5)
    src[0] = 0.25
    src[4] = 0.75
    out = arrays.fill(src, 0.5, start=1, width=3)
    assert list(out) == [0.25, 0.5, 0.5, 0.5, 0.75]
    assert list(src) == [0.25, 0.0, 0.0, 0.0, 0.75]


def test_fill_width_semantics(arrays):
    assert list(arrays.fill(arrays.generate(None, 3), 1.0)) == [1.0, 1.0, 1.0]
    assert list(arrays.fill(arrays.generate(None, 3), 1.0, start=0, width=-1)) == [1.0, 1.0, 1.0]
    assert list(arrays.fill(arrays.generate(None, 5), 1.0, start=2, width=2)) == [
        0.0,
        0.0,
        1.0,
        1.0,
        0.0,
    ]
    assert list(arrays.fill(arrays.generate(None, 5), 1.0, start=2, width=0)) == [
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
    ]
    assert list(arrays.fill(arrays.generate(None, 5), 1.0, start=2, width=-1)) == [
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
    ]
    assert list(arrays.fill(arrays.generate(None, 5), 1.0, start=2, width=-2)) == [
        0.0,
        0.0,
        1.0,
        1.0,
        0.0,
    ]
    # a very negative width still writes at least the start index
    assert list(arrays.fill(arrays.generate(None, 5), 1.0, start=3, width=-10)) == [
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
    ]


def test_hat_top_hat_shape(arrays):
    assert list(arrays.hat(arrays.generate(None, 6), 2, 3, 0.0, 1.0)) == [
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        0.0,
    ]
    assert list(arrays.hat(arrays.generate(None, 4), 0, 0, 0.0, 1.0)) == [1.0, 0.0, 0.0, 0.0]


def test_square_wave_shape(arrays):
    buf = arrays.square_wave(arrays.generate(None, 4), 0, 4, 1, 0.0, 0.5, 0.5)
    assert list(buf) == [1.0, 1.0, 0.0, 0.0]


def test_sawtooth_wave_shape(arrays):
    buf = arrays.sawtooth_wave(arrays.generate(None, 4), 0, 4, 1, 0.0, 0.5, 0.5)
    assert list(buf) == [0.0, 0.25, 0.5, 0.75]


def test_wave_start_index_leaves_prefix(arrays):
    src = arrays.generate(None, 6)
    src[0] = 9.0
    src[1] = 8.0
    out = arrays.sawtooth_wave(src, 2, 4, 1, 0.0, 0.5, 0.5)
    assert out[0] == 9.0
    assert out[1] == 8.0
    assert list(out[2:]) == [0.0, 0.25, 0.5, 0.75]


def test_wave_partial_period_count(arrays):
    src = arrays.generate(None, 6)
    src[5] = 8.0
    out = arrays.sawtooth_wave(src, 0, 4, 0.5, 0.0, 0.5, 0.5)
    assert list(out) == [0.0, 0.25, 0.0, 0.0, 0.0, 8.0]


def test_wave_clamped_to_array_length(arrays):
    src = arrays.generate(None, 4)
    src[0] = 9.0
    out = arrays.sawtooth_wave(src, 1, 4, 5, 0.0, 0.5, 0.5)
    assert list(out) == [9.0, 0.0, 0.25, 0.5]


def test_reseed_disabled_is_a_no_op(arrays):
    arrays.random.seed(99)
    expected = arrays.random.random()
    arrays.random.seed(99)
    arrays.reseed(False, 5, key='disabled')
    assert arrays.random.random() == expected


def test_reseed_seeds_once_per_key(arrays):
    arrays.reseed(True, 21, key='once')
    first = arrays.random.random()
    arrays.reseed(True, 21, key='once')
    assert arrays.random.random() != first


def test_reseed_reseeds_when_seed_changes(arrays):
    arrays.reseed(True, 3, key='changing')
    arrays.random.seed(17)
    expected = arrays.random.random()
    arrays.reseed(True, 17, key='changing')
    assert arrays.random.random() == expected


def test_reseed_seeds_again_after_disable(arrays):
    arrays.reseed(True, 8, key='toggle')
    first = arrays.random.random()
    arrays.reseed(False, 8, key='toggle')
    arrays.random.random()
    arrays.reseed(True, 8, key='toggle')
    assert arrays.random.random() == first


def test_reseed_keys_are_independent(arrays):
    arrays.reseed(True, 5, key='key-a')
    arrays.random.seed(5)
    expected = arrays.random.random()
    arrays.reseed(True, 5, key='key-b')
    assert arrays.random.random() == expected


def test_reseed_without_key_always_seeds(arrays):
    arrays.reseed(True, 13)
    first = arrays.random.random()
    arrays.reseed(True, 13)
    assert arrays.random.random() == first


def test_random_array_functions_follow_the_global_rng(arrays):
    arrays.random.seed(7)
    first = arrays.random_uniform(arrays.generate(None, 8), 0.0, 1.0)
    arrays.random.seed(7)
    second = arrays.random_uniform(arrays.generate(None, 8), 0.0, 1.0)
    assert list(first) == list(second)
    arrays.random.seed(7)
    first_normal = arrays.random_normal(arrays.generate(None, 8), 0.5, 0.15, 0.0, 1.0)
    arrays.random.seed(7)
    second_normal = arrays.random_normal(arrays.generate(None, 8), 0.5, 0.15, 0.0, 1.0)
    assert list(first_normal) == list(second_normal)


def test_length_counts_none_empty_scalar_and_array_elements(arrays):
    assert arrays.length(None) == 0
    assert arrays.length(array_from([])) == 0
    assert arrays.length(7) == 1
    assert arrays.length(1.5) == 1
    assert arrays.length(array_from([1.0, 2.0, 3.0])) == 3


def test_mean_averages_values_and_handles_empty_scalar_and_clamp(arrays):
    assert list(arrays.mean(array_from([1.0, 2.0, 6.0]))) == [3.0]
    assert list(arrays.mean(None)) == [0.0]
    assert list(arrays.mean(array_from([]))) == [0.0]
    assert list(arrays.mean(4.0)) == [4.0]
    assert list(arrays.mean(array_from([10.0, 20.0]), clamp=True)) == [1.0]


def test_median_sorts_and_averages_the_middle_pair(arrays):
    assert list(arrays.median(array_from([9.0, 1.0, 5.0]))) == [5.0]
    assert list(arrays.median(array_from([4.0, 1.0, 3.0, 2.0]))) == [2.5]
    assert list(arrays.median(None)) == [0.0]
    assert list(arrays.median(array_from([]))) == [0.0]
    assert list(arrays.median(7.0)) == [7.0]
    assert list(arrays.median(array_from([10.0, 20.0, 30.0]), clamp=True)) == [1.0]


def test_reductions_copy_the_input(arrays):
    buf = array_from([3.0, 1.0, 2.0])
    for reduce in (arrays.mean, arrays.median, arrays.mo_min, arrays.mo_max):
        reduce(buf)
    assert list(buf) == [3.0, 1.0, 2.0]


def test_min_max_select_the_percent_share_with_ceil(arrays):
    values = array_from([10.0, 1.0, 9.0, 2.0, 8.0, 3.0, 7.0, 4.0, 6.0, 5.0])

    assert list(arrays.mo_max(values, 100)) == [10.0]
    assert list(arrays.mo_min(values, 100)) == [1.0]
    assert list(arrays.mo_max(values, 0)) == [1.0]
    assert list(arrays.mo_min(values, 0)) == [10.0]
    assert list(arrays.mo_max(values, 50)) == [5.0]
    assert list(arrays.mo_min(values, 50)) == [6.0]
    assert list(arrays.mo_max(values, 25)) == [3.0]
    assert list(arrays.mo_min(values, 25)) == [8.0]
    assert list(arrays.mo_max(values, 11)) == [2.0]
    assert list(arrays.mo_min(values, 11)) == [9.0]


def test_min_max_normalise_percent_bounds_and_empty_inputs(arrays):
    values = array_from([0.25, 1.5, 0.75])

    assert list(arrays.mo_max(values, -10)) == [0.25]
    assert list(arrays.mo_min(values, -10)) == [1.5]
    assert list(arrays.mo_max(values, 150)) == [1.5]
    assert list(arrays.mo_min(values, 150)) == [0.25]
    for invalid in (None, 'bad', float('nan')):
        assert list(arrays.mo_max(values, invalid)) == [1.5]
        assert list(arrays.mo_min(values, invalid)) == [0.25]

    assert list(arrays.mo_max(None)) == [0.0]
    assert list(arrays.mo_min(None)) == [0.0]
    assert list(arrays.mo_max(array_from([]))) == [0.0]
    assert list(arrays.mo_min(array_from([]))) == [0.0]
    assert list(arrays.mo_max(2.0)) == [2.0]
    assert list(arrays.mo_min(2.0)) == [2.0]
    assert list(arrays.mo_max(values, clamp=True)) == [1.0]
    assert list(arrays.mo_min(values, clamp=True)) == [0.25]


def test_reduction_names_do_not_shadow_python_builtins(arrays):
    assert hasattr(arrays, 'length')
    assert hasattr(arrays, 'mean')
    assert hasattr(arrays, 'median')
    assert hasattr(arrays, 'mo_min')
    assert hasattr(arrays, 'mo_max')
    assert not hasattr(arrays, 'min')
    assert not hasattr(arrays, 'max')
