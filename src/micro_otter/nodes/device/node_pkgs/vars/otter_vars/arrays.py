# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import array
import math
import random

# The module defines ``round`` below, which shadows the builtin inside this module.
# Binding the builtin first keeps the array operation able to call it.
_builtin_round = round


def _clamp01(value):
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _apply_clamp(result, clamp):
    if clamp:
        for i in range(len(result)):
            result[i] = _clamp01(result[i])
    return result


def _target(buf, inplace):
    """Return the buffer the operation may write into.

    With ``inplace`` the caller-provided array is returned unchanged so the
    operation mutates it. Otherwise a fresh copy of the same length and type is
    returned, leaving the input untouched.
    """
    if inplace:
        return buf
    return array.array('f', buf)


def _is_scalar(value):
    return isinstance(value, (int, float))


def _operands(a, b):
    a_is_scalar = _is_scalar(a)
    b_is_scalar = _is_scalar(b)
    if a_is_scalar and b_is_scalar:
        return [float(a)], [float(b)]
    if a_is_scalar:
        return [float(a)] * len(b), b
    if b_is_scalar:
        return a, [float(b)] * len(a)
    if len(a) != len(b):
        raise ValueError('array length mismatch')
    return a, b


def generate(buf, count):
    count = max(int(count), 0)
    if buf is not None and len(buf) == count:
        return buf
    return array.array('f', [0.0] * count)


def _floor_clamp(value, n):
    """Floor ``value`` and clamp it into ``0..n-1``.

    Called by the range-based modify functions to turn a connector-supplied index into a
    valid buffer position.
    """
    position = int(math.floor(value))
    if position < 0:
        return 0
    if position >= n:
        return n - 1
    return position


def _resolve_span(n, start, width):
    """Resolve a start index and width into an inclusive ``(first, last)`` span.

    ``start`` and ``width`` are floored. A positive ``width`` selects that many indices
    starting at ``start``; ``width == 0`` selects only the start index; a negative
    ``width`` counts back from the end (``-1`` → the last index, ``-2`` → the
    penultimate). The span always includes at least the start index.
    """
    first = _floor_clamp(start, n)
    width = int(math.floor(width))
    if width >= 1:
        last = first + width - 1
    elif width == 0:
        last = first
    else:
        last = n + width
        if last < first:
            last = first
    if last >= n:
        last = n - 1
    if last < first:
        last = first
    return first, last


def _wave_span(n, start, period, period_count):
    """Resolve a wave's start index and sample count.

    The wave runs for ``period * period_count`` samples from the resolved ``start`` index,
    clamped to the end of the buffer. Returns ``(first, samples)``.
    """
    first = _floor_clamp(start, n)
    remaining = n - first
    length = float(period) * float(period_count)
    if length < 0.0:
        length = 0.0
    if length > remaining:
        length = remaining
    return first, int(length)


def fill(buf, value, start=0, width=-1, clamp=False, inplace=False):
    """Fill ``buf`` with ``value`` over the span resolved from ``start`` and ``width``.

    A positive ``width`` fills that many indices; ``width == 0`` fills only the start
    index; a negative ``width`` counts back from the end (``-1`` fills to the last index,
    ``-2`` to the penultimate). At least the start index is always written. ``clamp``
    applies the usual ``0..1`` limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    value = float(value)
    first, last = _resolve_span(n, start, width)
    for i in range(first, last + 1):
        buf[i] = value
    return _apply_clamp(buf, clamp)


def ramp(buf, start=0, width=-1, lo=0.0, hi=1.0, clamp=False, inplace=False):
    """Fill ``buf`` with a linear ramp from ``lo`` to ``hi`` over a span.

    ``start`` and ``width`` resolve the index span (see ``_resolve_span``); the first index
    of the span gets ``lo`` and the last gets ``hi``. Elements outside the span keep their
    input value. ``clamp`` applies the usual ``0..1`` limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    first, last = _resolve_span(n, start, width)
    lo = float(lo)
    hi = float(hi)
    span = last - first
    for i in range(first, last + 1):
        t = 0.0 if span == 0 else (i - first) / span
        buf[i] = lo + (hi - lo) * t
    return _apply_clamp(buf, clamp)


def steps(buf, start=0, step_width=1, num_steps=2, lo=0.0, hi=1.0, clamp=False, inplace=False):
    """Fill ``num_steps`` staircase plateaus into ``buf``.

    The k-th step (``k`` in ``0..num_steps-1``) fills the ``step_width`` indices starting at
    ``start + k * step_width`` with a value linearly interpolated from ``lo`` (first step)
    to ``hi`` (last step), so every index of a step shares that value. Indices outside every
    step keep their input value, and a step that runs past either buffer edge is clipped.
    ``step_width`` is floored and clamped to at least ``1``; ``num_steps`` is floored and
    clamped to at least ``1``. ``clamp`` applies the usual ``0..1`` limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    start = int(math.floor(start))
    step_width = int(math.floor(step_width))
    if step_width < 1:
        step_width = 1
    num_steps = max(int(math.floor(num_steps)), 1)
    lo = float(lo)
    hi = float(hi)
    for k in range(num_steps):
        t = 0.0 if num_steps == 1 else k / (num_steps - 1)
        value = lo + (hi - lo) * t
        first = start + k * step_width
        last = first + step_width
        if last <= 0 or first >= n:
            continue
        if first < 0:
            first = 0
        if last > n:
            last = n
        for i in range(first, last):
            buf[i] = value
    return _apply_clamp(buf, clamp)


def hat(buf, start=0, width=-1, lo=0.0, hi=1.0, clamp=False, inplace=False):
    """Fill ``buf`` with a top-hat pulse over the span resolved from ``start``/``width``.

    Indices inside the span get ``hi``; every other element gets ``lo``. ``clamp`` applies
    the usual ``0..1`` limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    first, last = _resolve_span(n, start, width)
    lo = float(lo)
    hi = float(hi)
    for i in range(n):
        buf[i] = hi if first <= i <= last else lo
    return _apply_clamp(buf, clamp)


def sin_wave(buf, start=0, period=30.0, period_count=1.0, phase=0.0, amplitude=0.5, offset=0.5, clamp=False, inplace=False):
    """Fill ``buf`` with a sine wave over ``period_count`` periods of ``period`` samples.

    The wave begins at the resolved ``start`` index and runs for ``period * period_count``
    samples, clamped to the end of the buffer; indices outside that span keep their input
    value. ``period`` is the length of one period in samples (a float, so partial periods
    are possible) and ``phase`` is a radian offset. ``clamp`` applies the usual ``0..1``
    limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    first, samples = _wave_span(n, start, period, period_count)
    period = float(period)
    phase = float(phase)
    amplitude = float(amplitude)
    offset = float(offset)
    for i in range(first, first + samples):
        t = 0.0 if period == 0.0 else (i - first) / period
        buf[i] = offset + amplitude * math.sin(2.0 * math.pi * t + phase)
    return _apply_clamp(buf, clamp)


def square_wave(buf, start=0, period=30.0, period_count=1.0, phase=0.0, amplitude=0.5, offset=0.5, clamp=False, inplace=False):
    """Fill ``buf`` with a square wave over ``period_count`` periods of ``period`` samples.

    The wave begins at the resolved ``start`` index and runs for ``period * period_count``
    samples, clamped to the end of the buffer; indices outside that span keep their input
    value. ``period`` is the length of one period in samples (a float, so partial periods
    are possible) and ``phase`` is a radian offset. ``clamp`` applies the usual ``0..1``
    limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    first, samples = _wave_span(n, start, period, period_count)
    period = float(period)
    phase = float(phase)
    amplitude = float(amplitude)
    offset = float(offset)
    for i in range(first, first + samples):
        t = 0.0 if period == 0.0 else (i - first) / period
        angle = (2.0 * math.pi * t + phase) % (2.0 * math.pi)
        buf[i] = offset + (amplitude if angle < math.pi else -amplitude)
    return _apply_clamp(buf, clamp)


def sawtooth_wave(buf, start=0, period=30.0, period_count=1.0, phase=0.0, amplitude=0.5, offset=0.5, clamp=False, inplace=False):
    """Fill ``buf`` with a sawtooth wave over ``period_count`` periods of ``period`` samples.

    The wave begins at the resolved ``start`` index and runs for ``period * period_count``
    samples, clamped to the end of the buffer; indices outside that span keep their input
    value. ``period`` is the length of one period in samples (a float, so partial periods
    are possible) and ``phase`` is a radian offset. ``clamp`` applies the usual ``0..1``
    limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    first, samples = _wave_span(n, start, period, period_count)
    period = float(period)
    phase = float(phase)
    amplitude = float(amplitude)
    offset = float(offset)
    for i in range(first, first + samples):
        t = 0.0 if period == 0.0 else (i - first) / period
        frac = (t + phase / (2.0 * math.pi)) % 1.0
        buf[i] = offset + amplitude * (2.0 * frac - 1.0)
    return _apply_clamp(buf, clamp)


def _reverse(buf, start, end):
    while start < end:
        tmp = buf[start]
        buf[start] = buf[end]
        buf[end] = tmp
        start += 1
        end -= 1


def shift(buf, amount, wrap=True, clamp=False, inplace=False):
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    amount = int(amount)
    if wrap:
        k = amount % n
        if k:
            _reverse(buf, 0, n - 1)
            _reverse(buf, 0, k - 1)
            _reverse(buf, k, n - 1)
    else:
        if amount >= n or amount <= -n:
            for i in range(n):
                buf[i] = 0.0
        elif amount > 0:
            for j in range(n - 1, amount - 1, -1):
                buf[j] = buf[j - amount]
            for j in range(amount):
                buf[j] = 0.0
        elif amount < 0:
            for j in range(n + amount):
                buf[j] = buf[j - amount]
            for j in range(n + amount, n):
                buf[j] = 0.0
    return _apply_clamp(buf, clamp)


def repeat(buf, count, clamp=False):
    """Repeat ``buf`` as ``count`` consecutive blocks.

    A negative ``count`` yields an empty array rather than an error, and a
    ``None`` buffer yields an empty ``array('f')``. The result is always a
    fresh array whose length differs from the input, so the function
    deliberately takes no ``inplace`` argument.
    """
    if buf is None:
        return array.array('f')
    count = int(count)
    if count < 0:
        count = 0
    n = len(buf)
    total = n * count
    result = array.array('f', [0.0] * total)
    for k in range(total):
        result[k] = buf[k % n]
    return _apply_clamp(result, clamp)


def ping_pong(buf, count, clamp=False):
    """Repeat ``buf`` as ``count`` blocks alternating forward and backward.

    Consecutive blocks repeat the endpoints, so ``[1, 2, 3]`` with
    ``count = 2`` yields ``[1, 2, 3, 3, 2, 1]`` and the result length is
    ``len(buf) * count``. A negative ``count`` yields an empty array, and the
    result is always a fresh array, so there is no ``inplace`` argument.
    """
    if buf is None:
        return array.array('f')
    count = int(count)
    if count < 0:
        count = 0
    n = len(buf)
    total = n * count
    result = array.array('f', [0.0] * total)
    for k in range(total):
        block = k // n
        offset = k % n
        result[k] = buf[offset] if block % 2 == 0 else buf[n - 1 - offset]
    return _apply_clamp(result, clamp)


def concat(buf, other, clamp=False):
    """Concatenate ``other`` after ``buf`` into a fresh array.

    ``None`` operands count as empty arrays, so an unconnected ``vars.array``
    connector contributes nothing and the result length is always
    ``len(buf) + len(other)``. The result is a fresh array, so there is no
    ``inplace`` argument.
    """
    if buf is None:
        buf = array.array('f')
    if other is None:
        other = array.array('f')
    na = len(buf)
    nb = len(other)
    result = array.array('f', [0.0] * (na + nb))
    for i in range(na):
        result[i] = buf[i]
    for j in range(nb):
        result[na + j] = other[j]
    return _apply_clamp(result, clamp)


def interlace(buf, other, step=1, offset=0, clamp=False):
    """Merge two arrays, inserting one ``other`` value every ``step`` output slots.

    One ``other`` value is placed at every ``step``-th output index, the first at output
    index ``offset``: ``step`` is floored to at least ``1`` and
    ``start = int(offset) % step``, so a negative offset wraps. The output length is
    always ``len(buf) + len(other)``; ``other`` values without an aligned slot are
    appended at the end, and ``other`` fills the remainder once ``buf`` is exhausted.
    ``None`` operands count as empty arrays.
    """
    if buf is None:
        buf = array.array('f')
    if other is None:
        other = array.array('f')
    na = len(buf)
    nb = len(other)
    step = int(step)
    if step < 1:
        step = 1
    start = int(offset) % step
    result = array.array('f', [0.0] * (na + nb))
    ia = 0
    ib = 0
    for k in range(na + nb):
        if ib < nb and (k - start) % step == 0:
            result[k] = other[ib]
            ib += 1
        elif ia < na:
            result[k] = buf[ia]
            ia += 1
        elif ib < nb:
            result[k] = other[ib]
            ib += 1
    return _apply_clamp(result, clamp)


def _bounds(lo, hi):
    """Return ``lo``/``hi`` as floats with reversed bounds swapped."""
    lo = float(lo)
    hi = float(hi)
    if lo > hi:
        lo, hi = hi, lo
    return lo, hi


def random_uniform_value(lo=0.0, hi=1.0, integer=False):
    """Return one uniform sample in ``lo..hi``.

    Reversed bounds are swapped. ``integer`` rounds the sample to the
    nearest whole number through the captured builtin, because this module
    defines its own ``round`` array operation.
    """
    lo, hi = _bounds(lo, hi)
    value = random.uniform(lo, hi)
    return int(_builtin_round(value)) if integer else value


def random_normal_value(mean=0.0, stddev=1.0, lo=0.0, hi=1.0, integer=False):
    """Return one normal sample cut to ``lo..hi``.

    ``stddev`` is treated as an absolute value, ``stddev == 0`` returns
    ``mean``, reversed bounds are swapped, and samples outside ``lo..hi``
    are cut to the nearest bound (a truncated normal, not rejection
    sampling). ``integer`` rounds the result to the nearest whole number.
    """
    mean = float(mean)
    stddev = abs(float(stddev))
    lo, hi = _bounds(lo, hi)
    value = mean if stddev == 0 else mean + stddev * _standard_normal()
    if value < lo:
        value = lo
    elif value > hi:
        value = hi
    return int(_builtin_round(value)) if integer else value


def random_uniform(buf, lo=0.0, hi=1.0, clamp=False, inplace=False):
    """Fill ``buf`` with uniformly distributed values in ``lo..hi``.

    ``None`` yields an empty ``array('f')``. Reversed bounds are swapped, and
    ``clamp`` applies the usual ``0..1`` limit after generation. The samples
    come from the shared module-level ``random`` state, which only the
    ``random-seed`` node reseeds.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    lo, hi = _bounds(lo, hi)
    for i in range(len(buf)):
        buf[i] = random.uniform(lo, hi)
    return _apply_clamp(buf, clamp)


def _standard_normal():
    """Return a standard normal sample using the Box-Muller transform.

    MicroPython does not provide ``random.gauss`` or
    ``random.normalvariate``. ``1.0 - random.random()`` keeps ``u1``
    strictly positive.
    """
    u1 = 1.0 - random.random()
    u2 = random.random()
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def random_normal(buf, mean=0.0, stddev=1.0, lo=0.0, hi=1.0, clamp=False, inplace=False):
    """Fill ``buf`` with normally distributed values cut to ``lo..hi``.

    Samples come from ``_standard_normal`` and are scaled by ``mean`` and
    ``stddev``. Values outside ``lo..hi`` are cut to the nearest bound (a
    clamped/truncated normal, not rejection sampling). ``stddev`` is treated
    as an absolute value, reversed bounds are swapped, and ``clamp`` applies
    the usual ``0..1`` limit after the cut. The samples come from the shared
    module-level ``random`` state, which only the ``random-seed`` node
    reseeds.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    mean = float(mean)
    stddev = abs(float(stddev))
    lo, hi = _bounds(lo, hi)
    n = len(buf)
    if n == 0:
        return buf
    for i in range(n):
        value = mean if stddev == 0 else mean + stddev * _standard_normal()
        if value < lo:
            value = lo
        elif value > hi:
            value = hi
        buf[i] = value
    return _apply_clamp(buf, clamp)


_seed_values = {}


def reseed(enabled, seed, key=None):
    """Seed the shared random generator once per enabled/seed state.

    ``key`` scopes the remembered state to one generated seed node. While
    the node stays enabled and ``seed`` does not change the call is a no-op,
    so random values keep advancing instead of restarting every pass.
    Disabling forgets the state, so re-enabling seeds again. Without
    ``key`` every call seeds.
    """
    if not enabled:
        if key is not None:
            _seed_values.pop(key, None)
        return
    value = int(seed)
    if key is not None:
        if _seed_values.get(key) == value:
            return
        _seed_values[key] = value
    random.seed(value)


def _resolve_index(index, n, mode):
    """Resolve ``index`` to a valid position in ``0..n-1`` using ``mode``.

    ``clamp`` snaps out-of-range positions to the nearest edge; ``wrap`` maps them
    into range with modulo. Called only by ``set`` and ``set_indices`` to turn a
    connector-supplied index into a writable slot.
    """
    position = int(index)
    if mode == 'wrap':
        return position % n
    if position < 0:
        return 0
    if position >= n:
        return n - 1
    return position


def _slide(buf, amount, fill=0.0):
    """Shift ``buf`` in place by ``amount`` slots, filling the freed slots with ``fill``.

    A positive ``amount`` moves the values towards the start and fills the last
    ``amount`` slots; a negative ``amount`` moves them towards the end and fills the
    first ``-amount`` slots. The magnitude is clamped to ``len(buf)``, so a larger
    request fills the whole buffer. Called only by ``_shift_position`` when a
    ``mode='shift'`` write lands outside the buffer.
    """
    n = len(buf)
    amount = int(amount)
    if amount >= n or amount <= -n:
        for i in range(n):
            buf[i] = fill
    elif amount > 0:
        for j in range(n - amount):
            buf[j] = buf[j + amount]
        for j in range(n - amount, n):
            buf[j] = fill
    elif amount < 0:
        for j in range(n - 1, -amount - 1, -1):
            buf[j] = buf[j + amount]
        for j in range(-amount):
            buf[j] = fill


def _shift_position(buf, position, fill=0.0):
    """Resolve ``position`` into a writable slot, sliding ``buf`` out of the way.

    A negative ``position`` slides the buffer right by ``-position`` slots and resolves
    to the first slot; a ``position`` at or past ``len(buf)`` slides it left by the
    deficit beyond the last slot and resolves to the last one; an in-range position is
    returned unchanged without moving anything. Called only by
    ``_resolve_write_position`` for ``mode='shift'``.
    """
    n = len(buf)
    if position < 0:
        _slide(buf, position, fill)
        return 0
    if position >= n:
        _slide(buf, position - (n - 1), fill)
        return n - 1
    return position


def _resolve_write_position(buf, index, mode, fill=0.0):
    """Resolve ``index`` into a writable slot of ``buf``, honouring ``mode``.

    ``shift`` slides the buffer by the index deficit and fills the vacated slots with
    ``fill`` before returning the slot the write lands on; every other mode keeps the
    ``clamp``/``wrap`` resolution of ``_resolve_index`` and ignores ``fill``. Called
    only by ``set`` and ``set_indices``.
    """
    if mode == 'shift':
        return _shift_position(buf, int(index), fill)
    return _resolve_index(index, len(buf), mode)


def set(buf, index, value, mode='clamp', fill=0.0, clamp=False, inplace=False):
    """Write ``value`` into ``buf`` at ``index``, or copy an array value in.

    With a scalar ``value`` the single element at the resolved ``index`` is replaced.
    With an array ``value`` the values are copied into ``buf`` starting at the resolved
    ``index``: ``mode='wrap'`` wraps writes to the beginning when the run overruns the
    end, ``mode='clamp'`` stops at the end. At most ``len(buf)`` elements are ever
    written, so a sub-array longer than the target never overwrites the start cell a
    second time. ``mode='shift'`` slides the array by the deficit of an out-of-range
    index and writes on the edge it slid towards, and ``fill`` is the value written
    into the slots that slide vacates. ``clamp`` applies the usual ``0..1`` limit after
    writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0:
        return buf
    if _is_scalar(value):
        buf[_resolve_write_position(buf, index, mode, fill)] = float(value)
    else:
        start = _resolve_write_position(buf, index, mode, fill)
        count = min(len(value), n)
        if mode == 'wrap':
            for j in range(count):
                buf[(start + j) % n] = float(value[j])
        else:
            for j in range(min(count, n - start)):
                buf[start + j] = float(value[j])
    return _apply_clamp(buf, clamp)


def set_indices(buf, indices, value, mode='clamp', fill=0.0, clamp=False, inplace=False):
    """Write ``value`` at the positions listed in ``indices``.

    Each entry of ``indices`` is floored to an integer and resolved with ``mode``
    (``clamp``/``wrap``/``shift``). A scalar ``value`` is written at every resolved
    position; an array ``value`` writes ``value[j]`` at ``indices[j]`` for the first
    ``min(len(indices), len(value))`` positions. ``mode='shift'`` resolves the entries
    sequentially, so each out-of-range entry slides the buffer as the earlier writes
    left it, and ``fill`` is the value written into the slots a slide vacates. ``clamp``
    applies the usual ``0..1`` limit after writing.
    """
    if buf is None:
        return array.array('f')
    buf = _target(buf, inplace)
    n = len(buf)
    if n == 0 or indices is None:
        return buf
    index_list = [indices] if _is_scalar(indices) else indices
    scalar_value = _is_scalar(value)
    count = len(index_list) if scalar_value else min(len(index_list), len(value))
    for j in range(count):
        position = _resolve_write_position(buf, math.floor(index_list[j]), mode, fill)
        buf[position] = float(value if scalar_value else value[j])
    return _apply_clamp(buf, clamp)


def _binary(a, b, operation, clamp=False):
    left, right = _operands(a, b)
    n = len(left)
    result = array.array('f', [0.0] * n)
    for i in range(n):
        result[i] = operation(left[i], right[i])
    return _apply_clamp(result, clamp)


def _unary(buf, transform, clamp=False):
    if _is_scalar(buf):
        result = array.array('f', [float(transform(float(buf)))])
    else:
        result = array.array('f', [0.0] * len(buf))
        for i in range(len(buf)):
            result[i] = transform(buf[i])
    return _apply_clamp(result, clamp)


def _reduce_array(value):
    """Return a fresh float array for a reduction.

    ``None`` becomes an empty array and a scalar becomes a one-element array,
    so the reduction functions share one shape rule. A caller-provided array is
    copied because the reductions may sort their working data.
    """
    if value is None:
        return array.array('f')
    if _is_scalar(value):
        return array.array('f', [float(value)])
    return array.array('f', value)


def _reduce_result(value, clamp):
    """Wrap one reduction result in a length-one array and apply ``clamp``."""
    return _apply_clamp(array.array('f', [float(value)]), clamp)


def _percent_share(n, percent):
    """Resolve ``percent`` into a clamped count of ``1..n`` elements.

    A missing or non-numeric value falls back to the full array. The count uses
    ``ceil`` so a non-zero share always includes at least one element.
    """
    try:
        value = float(percent)
    except (TypeError, ValueError):
        value = 100.0
    if value != value:
        value = 100.0
    if value < 0.0:
        value = 0.0
    elif value > 100.0:
        value = 100.0

    share = int(math.ceil(n * value / 100.0))
    if share < 1:
        return 1
    if share > n:
        return n
    return share


def _to_radians(value, angle_unit):
    if angle_unit == 'radians':
        return value
    if angle_unit == 'percent':
        return value * (2.0 * math.pi)
    return value * (math.pi / 180.0)   # degrees, and the fallback


def _from_radians(value, angle_unit):
    if angle_unit == 'radians':
        return value
    if angle_unit == 'percent':
        return value / (2.0 * math.pi)
    return value * (180.0 / math.pi)   # degrees, and the fallback


def add(a, b, clamp=False):
    return _binary(a, b, lambda x, y: x + y, clamp)


def sub(a, b, clamp=False):
    return _binary(a, b, lambda x, y: x - y, clamp)


def mul(a, b, clamp=False):
    return _binary(a, b, lambda x, y: x * y, clamp)


def div(a, b, clamp=False):
    def _divide(x, y):
        return x / y if y != 0 else 0.0

    return _binary(a, b, _divide, clamp)


def mod(a, b, clamp=False):
    def _modulus(x, y):
        return x % y if y != 0 else 0.0

    return _binary(a, b, _modulus, clamp)


def power(a, b, clamp=False):
    """Raise ``a`` to the power of ``b`` element-wise.

    Scalar and array operands broadcast like the other binary operations, so a
    scalar pair returns a length-1 ``array('f')``. An invalid domain, such as a
    negative base with a fractional exponent, raises ``ValueError``.

    Args:
        a: Base operand, either a scalar or an array.
        b: Exponent operand, either a scalar or an array.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the element-wise powers.
    """
    return _binary(a, b, math.pow, clamp)


def root(a, b, clamp=False):
    """Return the real principal n-th root of ``a`` with degree ``b`` element-wise.

    Scalar and array operands broadcast like the other binary operations, so a
    scalar pair returns a length-1 ``array('f')``. The radicand must be
    non-negative, so a negative value raises ``ValueError``; a degree of ``0``
    raises ``ZeroDivisionError`` from the reciprocal exponent.

    Args:
        a: Radicand operand, either a scalar or an array.
        b: Degree of the root, either a scalar or an array.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the element-wise n-th roots.
    """
    return _binary(a, b, lambda x, n: math.pow(x, 1.0 / n), clamp)


def sqrt(buf, clamp=False):
    return _unary(buf, math.sqrt, clamp)


def square(buf, clamp=False):
    return _unary(buf, lambda value: value * value, clamp)


def fraction(buf, clamp=False):
    return _unary(buf, lambda value: value % 1.0, clamp)


def exp(buf, clamp=False):
    return _unary(buf, math.exp, clamp)


def ln(buf, clamp=False):
    """Return the natural logarithm of every value.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. ``math.log`` raises ``ValueError`` for
    zero or a negative value.

    Args:
        buf: Scalar or array of values whose natural logarithm is taken.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the natural logarithms.
    """
    return _unary(buf, math.log, clamp)


def log(a, b, clamp=False):
    """Return the logarithm of ``a`` to the base ``b`` element-wise.

    Scalar and array operands broadcast like the other binary operations. A
    non-positive value or base raises ``ValueError``, while a base of exactly
    ``1`` raises the ``ZeroDivisionError`` that ``math.log(x, 1)`` reports.

    Args:
        a: Operand whose logarithm is taken, either a scalar or an array.
        b: Base operand, either a scalar or an array.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the element-wise logarithms.
    """
    return _binary(a, b, math.log, clamp)


def floor(buf, clamp=False):
    return _unary(buf, math.floor, clamp)


def ceil(buf, clamp=False):
    return _unary(buf, math.ceil, clamp)


def round(buf, decimals=0, clamp=False):
    # MicroPython's builtin ``round`` accepts an ``ndigits`` argument, which
    # keeps the result as accurate as the core ``math`` node's ``round(v, n)``.
    digits = int(decimals)
    if digits < 0:
        digits = 0
    if digits == 0:
        return _unary(buf, _builtin_round, clamp)
    return _unary(buf, lambda value: _builtin_round(value, digits), clamp)


def length(buf):
    """Return the number of elements in ``buf``.

    A ``None`` or empty buffer has length ``0``; a scalar counts as one element
    because reductions treat scalars as a one-element array.
    """
    if buf is None:
        return 0
    if _is_scalar(buf):
        return 1
    return len(buf)


def mean(buf, clamp=False):
    """Return the arithmetic mean as a length-one ``array('f')``.

    ``None`` and an empty buffer return ``0.0``. A scalar is treated as a
    one-element array. ``clamp`` limits the result to ``0..1``.
    """
    values = _reduce_array(buf)
    if len(values) == 0:
        return _reduce_result(0.0, clamp)
    return _reduce_result(sum(values) / len(values), clamp)


def median(buf, clamp=False):
    """Return the median as a length-one ``array('f')``.

    ``None`` and an empty buffer return ``0.0``. A scalar is treated as a
    one-element array. An even-length input returns the average of the two
    middle values. ``clamp`` limits the result to ``0..1``.
    """
    ordered = sorted(_reduce_array(buf))
    count = len(ordered)
    if count == 0:
        return _reduce_result(0.0, clamp)
    middle = count // 2
    if count % 2:
        return _reduce_result(ordered[middle], clamp)
    return _reduce_result((ordered[middle - 1] + ordered[middle]) / 2.0, clamp)


def mo_min(buf, percent=100.0, clamp=False):
    """Return the lowest value within the highest ``percent`` percent of elements.

    The selected share is ``ceil(n * percent / 100)`` clamped to ``1..n``.
    ``percent=100`` returns the plain minimum; ``percent=0`` returns the highest
    element. ``None`` and an empty buffer return ``0.0``. The ``mo_`` prefix
    keeps this module from shadowing Python's builtin ``min``.
    """
    values = _reduce_array(buf)
    count = len(values)
    if count == 0:
        return _reduce_result(0.0, clamp)
    share = _percent_share(count, percent)
    if share >= count:
        return _reduce_result(min(values), clamp)
    ordered = sorted(values)
    return _reduce_result(ordered[count - share], clamp)


def mo_max(buf, percent=100.0, clamp=False):
    """Return the highest value within the lowest ``percent`` percent of elements.

    The selected share is ``ceil(n * percent / 100)`` clamped to ``1..n``.
    ``percent=100`` returns the plain maximum; ``percent=0`` returns the lowest
    element. ``None`` and an empty buffer return ``0.0``. The ``mo_`` prefix
    keeps this module from shadowing Python's builtin ``max``.
    """
    values = _reduce_array(buf)
    count = len(values)
    if count == 0:
        return _reduce_result(0.0, clamp)
    share = _percent_share(count, percent)
    if share >= count:
        return _reduce_result(max(values), clamp)
    ordered = sorted(values)
    return _reduce_result(ordered[share - 1], clamp)


def sin(buf, angle_unit='degrees', clamp=False):
    return _unary(buf, lambda value: math.sin(_to_radians(value, angle_unit)), clamp)


def cos(buf, angle_unit='degrees', clamp=False):
    return _unary(buf, lambda value: math.cos(_to_radians(value, angle_unit)), clamp)


def tan(buf, angle_unit='degrees', clamp=False):
    return _unary(buf, lambda value: math.tan(_to_radians(value, angle_unit)), clamp)


def asin(buf, angle_unit='degrees', clamp=False):
    return _unary(
        buf,
        lambda value: _from_radians(math.asin(value), angle_unit),
        clamp,
    )


def acos(buf, angle_unit='degrees', clamp=False):
    return _unary(
        buf,
        lambda value: _from_radians(math.acos(value), angle_unit),
        clamp,
    )


def atan(buf, angle_unit='degrees', clamp=False):
    """Return the arctangent of every value in the selected angle unit.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. Every real value is in the domain, so
    no input raises; the result is converted from radians to ``angle_unit``.

    Args:
        buf: Scalar or array of values whose arctangent is taken.
        angle_unit: ``'degrees'`` (default), ``'radians'`` or ``'percent'``.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the arctangents.
    """
    return _unary(
        buf,
        lambda value: _from_radians(math.atan(value), angle_unit),
        clamp,
    )


def atan2(a, b, angle_unit='degrees', clamp=False):
    return _binary(
        a,
        b,
        lambda y, x: _from_radians(math.atan2(y, x), angle_unit),
        clamp,
    )


def sinh(buf, clamp=False):
    """Return the hyperbolic sine of every value.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. Every real value is in the domain and
    there is no angle unit.

    Args:
        buf: Scalar or array of values whose hyperbolic sine is taken.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the hyperbolic sines.
    """
    return _unary(buf, math.sinh, clamp)


def cosh(buf, clamp=False):
    """Return the hyperbolic cosine of every value.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. Every real value is in the domain and
    there is no angle unit.

    Args:
        buf: Scalar or array of values whose hyperbolic cosine is taken.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the hyperbolic cosines.
    """
    return _unary(buf, math.cosh, clamp)


def tanh(buf, clamp=False):
    """Return the hyperbolic tangent of every value.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. Every real value is in the domain and
    there is no angle unit.

    Args:
        buf: Scalar or array of values whose hyperbolic tangent is taken.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the hyperbolic tangents.
    """
    return _unary(buf, math.tanh, clamp)


def asinh(buf, clamp=False):
    """Return the inverse hyperbolic sine of every value.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. Every real value is in the domain and
    there is no angle unit.

    Args:
        buf: Scalar or array of values whose inverse hyperbolic sine is taken.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the inverse hyperbolic sines.
    """
    return _unary(buf, math.asinh, clamp)


def acosh(buf, clamp=False):
    """Return the inverse hyperbolic cosine of every value.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. Values below ``1`` raise
    ``ValueError``; there is no angle unit.

    Args:
        buf: Scalar or array of values whose inverse hyperbolic cosine is taken.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the inverse hyperbolic cosines.
    """
    return _unary(buf, math.acosh, clamp)


def atanh(buf, clamp=False):
    """Return the inverse hyperbolic tangent of every value.

    Accepts a scalar or an array and always returns an ``array('f')``, so a
    scalar input yields a length-1 array. Values outside ``-1 < x < 1`` raise
    ``ValueError``; there is no angle unit.

    Args:
        buf: Scalar or array of values whose inverse hyperbolic tangent is taken.
        clamp: Clamp every result into ``0..1`` when true.

    Returns:
        A new ``array('f')`` holding the inverse hyperbolic tangents.
    """
    return _unary(buf, math.atanh, clamp)


def select(buf, index, default=0.0, mode='default'):
    """Return one element of ``buf``, resolved by ``mode``.

    ``index`` is truncated to an integer, so ``2.9`` reads element ``2``. An
    index inside ``0 .. len-1`` always returns its element. An index outside
    that range returns ``default`` in ``'default'`` mode, the first or last
    element in ``'clamp'`` mode, and wraps around the array in ``'wrap'``
    mode. A ``None`` or empty buffer has no element to read and therefore
    returns ``default`` in every mode.
    """
    if buf is None:
        return default
    count = len(buf)
    if count == 0:
        return default
    position = int(index)
    if mode == 'wrap':
        return buf[position % count]
    if 0 <= position < count:
        return buf[position]
    if mode == 'clamp':
        if position < 0:
            return buf[0]
        return buf[count - 1]
    return default
