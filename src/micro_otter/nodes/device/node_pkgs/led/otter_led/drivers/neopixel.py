# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

"""NeoPixel strip driver with in-place buffer rendering."""

import sys

try:
    import neopixel as _neopixel
    from machine import Pin

    _IMPORT_ERROR = None
except ImportError as err:  # pragma: no cover - host fallback
    _neopixel = None
    Pin = None
    _IMPORT_ERROR = err

_ON_MICROPYTHON = sys.implementation.name == 'micropython'


def _warn_once(warned, message):
    """Emit ``[warning] led: message`` at most once, tracked by the ``warned`` set."""
    if message in warned:
        return
    warned.add(message)
    print('[warning] led: {}'.format(message))

_ORDER_INDEX = {'R': 0, 'G': 1, 'B': 2, 'W': 3}
_DEFAULT_ORDER = (1, 0, 2, 3)  # G, R, B, W; mirrors neopixel.NeoPixel.ORDER


def _order_to_indices(order, has_white):
    """Convert a color-order string or sequence into channel indices.

    Args:
        order: Wire order such as ``'GRB'``, ``'RGBW'``, or a tuple/list of
            channel indices. ``None`` selects the MicroPython default.
        has_white: Whether the color model includes a white channel. When true
            and the order has three entries, the white channel index is
            appended as the fourth byte.

    Returns:
        A tuple of channel indices in transmission order.

    Raises:
        ValueError: If the order uses an unknown letter, has the wrong length,
            or does not use each required channel exactly once.
    """
    required = 4 if has_white else 3
    if order is None:
        return _DEFAULT_ORDER[:required]

    if isinstance(order, str):
        normalized = order.upper().strip()
        if has_white and len(normalized) == 3:
            normalized += 'W'
        indices = []
        for letter in normalized:
            index = _ORDER_INDEX.get(letter)
            if index is None:
                raise ValueError(f'unknown order letter {letter}')
            indices.append(index)
        indices = tuple(indices)
    else:
        try:
            indices = tuple(order)
        except TypeError as err:
            raise ValueError('order must be a string or a sequence of indices') from err
        if has_white and len(indices) == 3:
            indices += (3,)

    if len(indices) != required:
        raise ValueError(f'order must contain {required} entries')
    if sorted(indices) != list(range(required)):
        raise ValueError('order must use each channel exactly once')
    return indices


def _render_payload(channels, has_white, count, order_indices, target=None, warn=None):
    """Quantize 0..1 channel values into wire-order bytes.

    Channels that are ``None`` are treated as all-zero. A channel that is a
    number (``int``/``float``) is broadcast to every LED. Any other value must
    be a sized, indexable sequence, otherwise a ``ValueError`` is raised. When
    connected arrays have differing lengths, only the shortest is emitted and
    the remaining pixels stay dark.

    Array-likeness is probed with ``len()`` and one index access, never with
    ``hasattr(channel, '__getitem__')``: MicroPython does not expose the
    special methods of its built-in types as attributes, so ``hasattr`` returns
    ``False`` for ``array.array``, ``bytearray`` and ``list`` and would reject
    every real channel on the device.

    Args:
        channels: Sequence of channel arrays or scalar values. A channel may be
            ``None``.
        has_white: Whether the color model includes a white channel.
        count: Number of LED slots to emit, or ``None`` to emit only the
            shortest connected channel.
        order_indices: Validated channel index permutation in wire order.
        target: Optional bytearray to write into. When ``None``, a new
            bytearray is allocated. On hardware this is ``neopixel.buf``.
        warn: Optional callable receiving a diagnostic message when the channel
            lengths disagree with ``count`` (short arrays stay dark, long
            arrays are truncated).

    Returns:
        The bytearray containing the quantized wire-order bytes.

    Raises:
        ValueError: If fewer channels than required are supplied, the order
            length does not match the color model, a channel is neither a
            number nor indexable, or the target length does not match
            ``count * required``.
    """
    required = 4 if has_white else 3
    if len(channels) < required:
        raise ValueError(f'expected {required} channels, got {len(channels)}')
    if len(order_indices) != required:
        raise ValueError(f'order must contain {required} entries')

    value_count = None
    shortest_index = None
    lengths = [None] * required
    for index in range(required):
        channel = channels[index]
        if channel is None or isinstance(channel, (int, float)):
            continue
        if isinstance(channel, str):
            raise ValueError(
                f'channel {index} must be an array of values in 0..1 '
                f'(e.g. a vars.array), got str'
            )
        try:
            length = len(channel)
            if length:
                channel[0]
        except (TypeError, IndexError, KeyError):
            raise ValueError(
                f'channel {index} must be an array of values in 0..1 '
                f'(e.g. a vars.array), got {type(channel).__name__}'
            ) from None
        lengths[index] = length
        if value_count is None or length < value_count:
            value_count = length
            shortest_index = index

    if count is not None:
        frame_count = int(count)
    elif value_count is not None:
        frame_count = value_count
    else:
        frame_count = 0
    if frame_count < 0:
        frame_count = 0

    if warn is not None and value_count is not None and count is not None:
        if value_count < frame_count:
            warn(
                f'count={frame_count} but channel {shortest_index} has {value_count} values; '
                f'the remaining {frame_count - value_count} LEDs stay dark'
            )
        elif value_count > frame_count:
            warn(
                f'count={frame_count} truncates channel {shortest_index} ({value_count} values)'
            )

    expected = frame_count * required
    if target is None:
        target = bytearray(expected)
    elif len(target) != expected:
        raise ValueError(f'expected target of length {expected}, got {len(target)}')

    pos = 0
    for i in range(frame_count):
        for index in order_indices:
            channel = channels[index]
            length = lengths[index]
            if channel is None:
                value = 0.0
            elif length is None:
                value = float(channel)
            elif i < length:
                value = channel[i]
            else:
                value = 0.0
            if not (value > 0.0):
                value = 0.0
            elif value > 1.0:
                value = 1.0
            target[pos] = int(value * 255.0 + 0.5)
            pos += 1

    return target


def build_payload(channels, order='GRB', has_white=False, count=None):
    """Quantize 0..1 float channels into a WS2812/SK6812 byte stream.

    This pure helper is used on hosts without hardware and by tests.

    Args:
        channels: Sequence of 3 (RGB) or 4 (RGBW) channel arrays, or ``None``
            entries for unconnected channels.
        order: Wire order such as ``'GRB'`` or ``'RGBW'``. For ``has_white``,
            a three-letter order is extended with ``W``.
        has_white: Whether the color model includes a white channel.
        count: Optional number of LED slots to emit. When omitted, the payload
            covers only the shortest connected channel.

    Returns:
        A ``bytearray`` with quantized wire-order bytes.

    Raises:
        ValueError: If the order or channel count is invalid.
    """
    if not channels:
        return bytearray()
    return _render_payload(
        channels,
        has_white,
        count,
        _order_to_indices(order, has_white),
    )


class NeoPixel:
    """Drive an addressable WS2812/SK6812 strip via MicroPython's neopixel module."""

    def __init__(self, pin, count, order='GRB', has_white=False):
        """Create a NeoPixel strip driver.

        Args:
            pin: Data pin driving the strip.
            count: Number of LEDs in the strip.
            order: Wire order such as ``'GRB'`` or ``'RGBW'``. For ``has_white``,
                a three-letter order is extended with ``W``.
            has_white: Whether the strip uses an RGBW color model.
        """
        self.count = int(count)
        if self.count < 0:
            self.count = 0
        self.order = order
        self.has_white = bool(has_white)
        self._order_indices = _order_to_indices(order, self.has_white)
        self._np = None
        self._hw_buf = None
        self._scratch = None
        self.unavailable_reason = None
        self._warnings = set()
        self._last = None

        if _IMPORT_ERROR is not None:
            if _ON_MICROPYTHON:
                raise RuntimeError(
                    'LED driver unavailable: this firmware does not freeze the '
                    'micropython-lib neopixel driver; flash an image that includes it '
                    f'or use the PWM driver ({_IMPORT_ERROR})'
                )
            self.unavailable_reason = str(_IMPORT_ERROR)
            return

        if self.count == 0:
            return

        bpp = 4 if self.has_white else 3
        self._np = _neopixel.NeoPixel(Pin(pin), self.count, bpp=bpp)
        # Every image we build freezes micropython-lib's pure-Python ``neopixel``,
        # whose ``buf`` *is* the wire buffer, so rendering straight into it is the
        # path that runs on hardware (no per-frame allocation or copy).
        buf = getattr(self._np, 'buf', None)
        if buf is not None and len(buf) == self.count * bpp:
            self._hw_buf = buf
        else:
            # Portability guard, not a target of ours: an implementation without
            # ``buf`` gets one reusable scratch buffer and the indexed API below.
            self._scratch = bytearray(self.count * bpp)

    def write(self, channels, force=False):
        """Quantize the channel arrays and transmit them to the strip.

        On hardware the quantized bytes are rendered straight into
        ``neopixel.buf`` whenever the driver exposes a buffer of the right size
        -- always the case for the micropython-lib driver our ESP32 images
        freeze -- so no frame buffer is allocated and no copy is needed.
        Implementations without ``buf`` are fed per pixel through the
        documented ``np[i] = (r, g, b[, w])`` API from a reused scratch buffer;
        that branch is a portability guard covered by unit tests only, not by
        our targets. An identical frame is skipped because a WS2812/SK6812 strip
        latches its last value (a write costs ~30 µs per LED); pass
        ``force=True`` to retransmit unconditionally, for example after the
        strip lost power while the loop kept running. On hosts without hardware
        the generated payload is returned for testing and a one-time warning is
        printed.

        Args:
            channels: Sequence of channel arrays or scalar values with ``None``
                for unconnected channels.
            force: When true, transmit even if the frame is unchanged.

        Returns:
            The quantized payload on hosts without hardware, otherwise ``None``.
        """
        if self._np is None:
            if self.unavailable_reason is not None:
                _warn_once(
                    self._warnings,
                    f'{type(self).__name__}: hardware unavailable '
                    f'({self.unavailable_reason}); simulating on host',
                )
                return build_payload(channels, self.order, self.has_white, self.count)
            return None

        required = 4 if self.has_white else 3

        def emit(message):
            _warn_once(self._warnings, f'{type(self).__name__}: {message}')

        payload = _render_payload(
            channels,
            self.has_white,
            self.count,
            self._order_indices,
            self._hw_buf if self._hw_buf is not None else self._scratch,
            emit,
        )

        if not force and self._last == payload:
            return None

        if self._hw_buf is None:
            for i in range(self.count):
                base = i * required
                pixel = [0] * required
                for wire_pos, channel_index in enumerate(self._order_indices):
                    pixel[channel_index] = payload[base + wire_pos]
                self._np[i] = tuple(pixel)
        self._np.write()
        self._last = bytes(payload)
        return None
