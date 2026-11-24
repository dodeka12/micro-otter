import pathlib
import sys

import pytest

LED_PKG_ROOT = pathlib.Path('src/micro_otter/nodes/device/node_pkgs/led').resolve()


@pytest.fixture(scope='module')
def drivers():
    sys.path.insert(0, str(LED_PKG_ROOT))
    from otter_led.drivers import neopixel, pwm_strip, single

    yield neopixel, pwm_strip, single
    sys.path.remove(str(LED_PKG_ROOT))


def _arr(*values):
    import array

    return array.array('f', [float(value) for value in values])


class _SlotlessArray:
    """Sequence that hides its dunder attributes, like a MicroPython built-in.

    MicroPython does not expose the special methods of its built-in types
    (``array.array``, ``bytearray``, ``list``) as attributes, so
    ``hasattr(obj, '__getitem__')`` is ``False`` on a device while ``len()``
    and indexing still work. This class reproduces that behaviour on CPython,
    where ``hasattr`` would otherwise return ``True``.
    """

    def __init__(self, *values):
        object.__setattr__(self, '_values', [float(value) for value in values])

    def __len__(self):
        return len(self._values)

    def __getitem__(self, index):
        return self._values[index]

    def __getattribute__(self, name):
        if name.startswith('__') and name.endswith('__'):
            raise AttributeError(name)
        return object.__getattribute__(self, name)


def test_build_payload_rgb_order(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [_arr(1, 0), _arr(0, 1), _arr(0, 0)],
        order='GRB',
        has_white=False,
    )
    assert list(payload) == [0, 255, 0, 255, 0, 0]


def test_build_payload_rgbw(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [_arr(1, 0), _arr(0, 1), _arr(0, 0), _arr(0, 0)],
        order='RGBW',
        has_white=True,
    )
    assert list(payload) == [255, 0, 0, 0, 0, 255, 0, 0]


def test_build_payload_rgbw_appends_white_for_three_letter_order(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [_arr(1, 0), _arr(0, 1), _arr(0, 0), _arr(0, 1)],
        order='GRB',
        has_white=True,
    )
    assert list(payload) == [0, 255, 0, 0, 255, 0, 0, 255]


def test_build_payload_unconnected_channels_are_zero(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [_arr(1, 0), None, None],
        order='GRB',
        has_white=False,
    )
    assert list(payload) == [0, 255, 0, 0, 0, 0]


def test_build_payload_reduces_to_shortest_channel(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [_arr(1, 1, 1), _arr(1, 1), _arr(1, 1, 1)],
        order='RGB',
        has_white=False,
    )
    assert list(payload) == [255, 255, 255, 255, 255, 255]


def test_build_payload_pads_to_count(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [_arr(1, 1), _arr(1, 1), _arr(1, 1)],
        order='RGB',
        has_white=False,
        count=3,
    )
    assert list(payload) == [255, 255, 255, 255, 255, 255, 0, 0, 0]


def test_build_payload_all_unconnected_channels(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [None, None, None],
        order='GRB',
        has_white=False,
        count=2,
    )
    assert list(payload) == [0, 0, 0, 0, 0, 0]


def test_build_payload_clamps_and_rounds(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload(
        [_arr(-0.5, 0.5, 1.5), _arr(0, 0, 0), _arr(0, 0, 0)],
        order='RGB',
        has_white=False,
    )
    assert list(payload) == [0, 0, 0, 128, 0, 0, 255, 0, 0]


def test_build_payload_rejects_invalid_order(drivers):
    neopixel, _, _ = drivers
    with pytest.raises(ValueError):
        neopixel.build_payload(
            [_arr(1), _arr(1), _arr(1)], order='XYZ', has_white=False
        )
    with pytest.raises(ValueError):
        neopixel.build_payload(
            [_arr(1), _arr(1), _arr(1)], order='GRBW', has_white=False
        )


def test_neopixel_host_construction_is_guarded(drivers):
    neopixel, _, _ = drivers
    strip = neopixel.NeoPixel(2, 2, order='GRB', has_white=False)
    payload = strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    assert list(payload) == [0, 255, 0, 255, 0, 0]


def test_neopixel_host_write_handles_unconnected_channels(drivers):
    neopixel, _, _ = drivers
    strip = neopixel.NeoPixel(2, 2, order='GRB', has_white=False)
    payload = strip.write([_arr(1, 0), None, None])
    assert list(payload) == [0, 255, 0, 0, 0, 0]


def test_neopixel_device_path_writes_buffer_in_place(drivers, monkeypatch):
    neopixel, _, _ = drivers

    class FakeNeoPixel:
        instances = []

        def __init__(self, pin, n, bpp=3):
            self.pin = pin
            self.n = n
            self.bpp = bpp
            self.buf = bytearray(n * bpp)
            self.writes = 0
            FakeNeoPixel.instances.append(self)

        def write(self):
            self.writes += 1

    class FakeNeoPixelModule:
        NeoPixel = FakeNeoPixel

    FakeNeoPixel.instances.clear()
    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', None)
    monkeypatch.setattr(neopixel, 'Pin', lambda pin: pin, raising=False)
    monkeypatch.setattr(neopixel, '_neopixel', FakeNeoPixelModule, raising=False)

    strip = neopixel.NeoPixel(2, 2, order='RGB', has_white=False)
    fake = FakeNeoPixel.instances[-1]
    first_buf = fake.buf

    assert strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)]) is None
    assert fake.buf is first_buf
    assert list(fake.buf) == [255, 0, 0, 0, 255, 0]
    assert fake.writes == 1

    strip.write([_arr(0, 1), _arr(0, 0), _arr(1, 0)])
    assert fake.buf is first_buf
    assert fake.writes == 2


def test_duty_conversion_and_construct(drivers):
    _, pwm_strip, single = drivers
    assert pwm_strip.duty_from_float(0.0) == 0
    assert pwm_strip.duty_from_float(0.5) == 512
    assert pwm_strip.duty_from_float(1.0) == 1023

    strip = pwm_strip.PwmStrip(1, 2, 3)
    led = single.SingleLed(4)
    strip.write(0.0, 0.5, 1.0)
    led.write(1.0)


def test_neopixel_host_warns_once(drivers, capsys):
    neopixel, _, _ = drivers
    strip = neopixel.NeoPixel(2, 2, order='GRB', has_white=False)
    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    out = capsys.readouterr().out
    assert out.count('hardware unavailable') == 1
    assert isinstance(strip.unavailable_reason, str) and strip.unavailable_reason


def test_neopixel_missing_module_raises_on_micropython(drivers, monkeypatch):
    neopixel, _, _ = drivers
    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', ImportError("No module named 'neopixel'"))
    monkeypatch.setattr(neopixel, '_ON_MICROPYTHON', True)
    with pytest.raises(RuntimeError, match='neopixel'):
        neopixel.NeoPixel(2, 2)


def test_build_payload_scalar_broadcast(drivers):
    neopixel, _, _ = drivers
    payload = neopixel.build_payload([0.5, None, None], order='GRB', has_white=False, count=2)
    assert list(payload) == [0, 128, 0, 0, 128, 0]


def test_build_payload_rejects_string_channel(drivers):
    neopixel, _, _ = drivers
    with pytest.raises(ValueError, match='channel 0'):
        neopixel.build_payload(['abc', None, None], order='GRB', has_white=False)


def test_build_payload_accepts_slotless_array_like(drivers):
    """A channel must be accepted without probing ``__getitem__`` via hasattr.

    MicroPython hides built-in special methods from ``hasattr``, so the
    documented `array.array` channel input looked like a non-sequence there and
    every frame raised ``ValueError`` on the device.
    """
    neopixel, _, _ = drivers
    channel = _SlotlessArray(1, 0)
    assert not hasattr(channel, '__getitem__')

    payload = neopixel.build_payload(
        [channel, _SlotlessArray(0, 1), _SlotlessArray(0, 0)],
        order='GRB',
        has_white=False,
    )
    assert list(payload) == [0, 255, 0, 255, 0, 0]


def test_build_payload_rejects_unsized_channel(drivers):
    neopixel, _, _ = drivers
    with pytest.raises(ValueError, match='channel 1 must be an array.*got object'):
        neopixel.build_payload([_arr(1), object(), None], order='GRB', has_white=False)


def test_neopixel_renders_into_the_hardware_buffer(drivers, monkeypatch):
    """The ``buf`` path must render in place, never pixel by pixel."""
    neopixel, _, _ = drivers
    instances = []

    class FakeNeoPixel:
        def __init__(self, pin, n, bpp=3):
            self.buf = bytearray(n * bpp)
            self.writes = 0
            instances.append(self)

        def __setitem__(self, index, value):
            raise AssertionError('the buffer path must not set pixels one by one')

        def write(self):
            self.writes += 1

    class FakeModule:
        NeoPixel = FakeNeoPixel

    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', None)
    monkeypatch.setattr(neopixel, 'Pin', lambda pin: pin)
    monkeypatch.setattr(neopixel, '_neopixel', FakeModule)

    strip = neopixel.NeoPixel(2, 2, order='GRB', has_white=False)
    fake = instances[-1]

    assert strip._hw_buf is fake.buf
    assert strip._scratch is None

    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    assert list(fake.buf) == [0, 255, 0, 255, 0, 0]
    assert fake.writes == 1


def test_neopixel_per_pixel_path_reuses_scratch(drivers, monkeypatch):
    """Without ``buf`` the driver feeds the indexed API from a reused buffer."""
    neopixel, _, _ = drivers
    instances = []

    class FakeNeoPixel:
        def __init__(self, pin, n, bpp=3):
            self.pixels = {}
            self.writes = 0
            instances.append(self)

        def __setitem__(self, index, value):
            self.pixels[index] = tuple(value)

        def write(self):
            self.writes += 1

    class FakeModule:
        NeoPixel = FakeNeoPixel

    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', None)
    monkeypatch.setattr(neopixel, 'Pin', lambda pin: pin)
    monkeypatch.setattr(neopixel, '_neopixel', FakeModule)

    strip = neopixel.NeoPixel(2, 2, order='BGR', has_white=False)
    fake = instances[-1]

    assert strip._hw_buf is None
    scratch = strip._scratch
    assert isinstance(scratch, bytearray) and len(scratch) == 6

    # BGR wire order must still arrive as RGB tuples at the pixel API.
    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    assert fake.pixels == {0: (255, 0, 0), 1: (0, 255, 0)}
    assert strip._scratch is scratch

    strip.write([_arr(0, 1), _arr(0, 0), _arr(1, 0)])
    assert fake.pixels == {0: (0, 0, 255), 1: (255, 0, 0)}
    assert strip._scratch is scratch
    assert fake.writes == 2


def test_neopixel_length_mismatch_warns_once(drivers, capsys, monkeypatch):
    neopixel, _, _ = drivers

    class FakeNeoPixel:
        def __init__(self, pin, n, bpp=3):
            self.buf = bytearray(n * bpp)
            self.writes = 0

        def write(self):
            self.writes += 1

    class FakeModule:
        NeoPixel = FakeNeoPixel

    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', None)
    monkeypatch.setattr(neopixel, 'Pin', lambda pin: pin)
    monkeypatch.setattr(neopixel, '_neopixel', FakeModule)

    strip = neopixel.NeoPixel(2, 3, order='RGB', has_white=False)
    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    out = capsys.readouterr().out
    assert out.count('stay dark') == 1
    assert 'count=3 but channel' in out


def test_neopixel_truncation_warns(drivers, capsys, monkeypatch):
    neopixel, _, _ = drivers

    class FakeNeoPixel:
        def __init__(self, pin, n, bpp=3):
            self.buf = bytearray(n * bpp)
            self.writes = 0

        def write(self):
            self.writes += 1

    class FakeModule:
        NeoPixel = FakeNeoPixel

    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', None)
    monkeypatch.setattr(neopixel, 'Pin', lambda pin: pin)
    monkeypatch.setattr(neopixel, '_neopixel', FakeModule)

    strip = neopixel.NeoPixel(2, 2, order='RGB', has_white=False)
    strip.write([_arr(1, 1, 1), _arr(1, 1, 1), _arr(1, 1, 1)])
    out = capsys.readouterr().out
    assert 'count=2 truncates channel' in out


def test_neopixel_count_zero_skips_hardware(drivers, monkeypatch):
    neopixel, _, _ = drivers
    instances = []

    class FakeNeoPixel:
        def __init__(self, pin, n, bpp=3):
            self.buf = bytearray(n * bpp)
            instances.append(self)

    class FakeModule:
        NeoPixel = FakeNeoPixel

    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', None)
    monkeypatch.setattr(neopixel, 'Pin', lambda pin: pin)
    monkeypatch.setattr(neopixel, '_neopixel', FakeModule)

    strip = neopixel.NeoPixel(2, 0)
    assert strip.write([_arr(1), _arr(1), _arr(1)]) is None
    assert instances == []


def test_pwm_strip_rejects_non_int_pin(drivers):
    _, pwm_strip, _ = drivers
    with pytest.raises(ValueError, match='red_pin'):
        pwm_strip.PwmStrip('x', 2, 3)
    with pytest.raises(ValueError, match='blue_pin'):
        pwm_strip.PwmStrip(1, 2, 'x')


def test_single_rejects_non_int_pin(drivers):
    _, _, single = drivers
    with pytest.raises(ValueError, match='pin'):
        single.SingleLed('x')


def test_pwm_strip_host_write_warns_once(drivers, capsys):
    _, pwm_strip, _ = drivers
    strip = pwm_strip.PwmStrip(1, 2, 3)
    strip.write(0.0, 0.5, 1.0)
    strip.write(0.0, 0.5, 1.0)
    out = capsys.readouterr().out
    assert out.count('hardware unavailable') == 1


def test_pwm_strip_fake_duty(drivers, monkeypatch):
    _, pwm_strip, _ = drivers
    duty_calls = []

    class FakePwm:
        def __init__(self, pin, freq=1000):
            self.pin = pin
            self.freq = freq

        def duty(self, value):
            duty_calls.append((self.pin, value))

    monkeypatch.setattr(pwm_strip, '_IMPORT_ERROR', None)
    monkeypatch.setattr(pwm_strip, 'Pin', lambda pin: pin)
    monkeypatch.setattr(pwm_strip, 'PWM', FakePwm)

    strip = pwm_strip.PwmStrip(1, 2, 3)
    duty_calls.clear()
    strip.write(0.0, 0.5, 1.0)
    assert duty_calls == [(1, 0), (2, 512), (3, 1023)]


def test_neopixel_throttles_identical_frames(drivers, monkeypatch):
    neopixel, _, _ = drivers
    instances = []

    class FakeNeoPixel:
        def __init__(self, pin, n, bpp=3):
            self.buf = bytearray(n * bpp)
            self.writes = 0
            instances.append(self)

        def write(self):
            self.writes += 1

    class FakeModule:
        NeoPixel = FakeNeoPixel

    monkeypatch.setattr(neopixel, '_IMPORT_ERROR', None)
    monkeypatch.setattr(neopixel, 'Pin', lambda pin: pin)
    monkeypatch.setattr(neopixel, '_neopixel', FakeModule)

    strip = neopixel.NeoPixel(2, 2, order='RGB', has_white=False)
    fake = instances[-1]

    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    strip.write([_arr(1, 0), _arr(0, 1), _arr(0, 0)])
    assert fake.writes == 1

    strip.write([_arr(0, 1), _arr(0, 0), _arr(1, 0)])
    assert fake.writes == 2

    strip.write([_arr(0, 1), _arr(0, 0), _arr(1, 0)], force=True)
    assert fake.writes == 3


def test_pwm_strip_throttles_identical_duty(drivers, monkeypatch):
    _, pwm_strip, _ = drivers
    duty_calls = []

    class FakePwm:
        def __init__(self, pin, freq=1000):
            self.pin = pin

        def duty(self, value):
            duty_calls.append((self.pin, value))

    monkeypatch.setattr(pwm_strip, '_IMPORT_ERROR', None)
    monkeypatch.setattr(pwm_strip, 'Pin', lambda pin: pin)
    monkeypatch.setattr(pwm_strip, 'PWM', FakePwm)

    strip = pwm_strip.PwmStrip(1, 2, 3)
    duty_calls.clear()
    strip.write(0.0, 0.5, 1.0)
    strip.write(0.0, 0.5, 1.0)
    assert duty_calls == [(1, 0), (2, 512), (3, 1023)]

    strip.write(1.0, 0.5, 0.0)
    assert duty_calls == [(1, 0), (2, 512), (3, 1023), (1, 1023), (2, 512), (3, 0)]


def test_single_throttles_identical_duty(drivers, monkeypatch):
    _, _, single = drivers
    duty_calls = []

    class FakePwm:
        def __init__(self, pin, freq=1000):
            self.pin = pin

        def duty(self, value):
            duty_calls.append(value)

    monkeypatch.setattr(single, '_IMPORT_ERROR', None)
    monkeypatch.setattr(single, 'Pin', lambda pin: pin)
    monkeypatch.setattr(single, 'PWM', FakePwm)

    led = single.SingleLed(4)
    duty_calls.clear()
    led.write(0.5)
    led.write(0.5)
    assert duty_calls == [512]

    led.write(1.0)
    assert duty_calls == [512, 1023]
