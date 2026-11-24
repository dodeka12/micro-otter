# LED Node System

This document describes how the `led` node package is modeled, transpiled, and executed at runtime.

## Scope

The package lives under `src/micro_otter/nodes/device/node_pkgs/led/`:

- Node definitions: `node_definitions.json`
- Generators: `node_generators.js`
- Capability checks: `node_capabilities.js`
- Runtime: `otter_led/drivers/*`

## Data type

LED drivers consume `vars.array` channel values declared by the `vars` package. Array generation, modification, element-wise math and element reads live in `vars` (`array-generate`, `array-modify`, `array-math`, `array-select`, `otter_vars/arrays.py`).

## Value convention

- Array elements and scalar LED levels are `float` in `0.0..1.0`.
- Drivers quantize to `0..255` (NeoPixel) or PWM duty at the output boundary.

## Drivers

- `otter_led/drivers/neopixel.py` — `build_payload(channels, order='GRB', has_white=False, count=None)` (pure, host-testable quantization + wire order) and `NeoPixel(pin, count, order='GRB', has_white=False)`. `write(channels, force=False)` renders the frame **straight into** the strip's `buf` bytearray when the frozen pure-Python `neopixel` shim exposes one of length `count * bpp` (*every image we ship does*), and otherwise fills a reused scratch buffer that is copied to the strip through the documented `np[i] = (r, g, b[, w])` API before `np.write()`. `buf` is **not** part of the contract and is never assumed.
- `otter_led/drivers/pwm_strip.py` — `PwmStrip(red_pin, green_pin, blue_pin)` with `write(r, g, b)`.
- `otter_led/drivers/single.py` — `SingleLed(pin)` with `write(value)`.

The NeoPixel driver treats a `None` channel as all-zero; a scalar (`int`/`float`) channel is
broadcast to every LED; and connected arrays are reduced to the shortest connected channel.
`count` is the physical LED count: array values beyond `count` are truncated, missing values stay
dark, and a mismatch emits a one-time warning. A three-letter `order` is extended with `W` for
RGBW strips (`GRB` → `GRBW`).

On a host interpreter the hardware modules are unavailable: the driver warns once per instance and
simulates (returning the quantized payload). On MicroPython a missing `neopixel`/`machine` module
raises `RuntimeError` at construction — it is a firmware defect, not a silent no-op.

Identical frames are skipped: a WS2812/SK6812 strip latches its last value (a write costs ~30 µs
per LED), and `write(..., force=True)` retransmits unconditionally (e.g. after the strip lost
power while the loop kept running). PWM drivers apply the same dirty check to their duty cycles.

## Pitfalls

- `neopixel.buf` is **not** a documented API. It is present in every image we build (MicroPython
  1.29's `esp32` port freezes micropython-lib's pure-Python driver for both `esp32` and `esp32s3`),
  so the in-place fast path is the only one that runs on hardware; the per-pixel fallback is
  unit-tested only. Never *require* `buf` — keep the indexed-API path working. Re-verify with
  `grep MICROPY_PY_NEOPIXEL` (no hits in 1.29) and `ls ports/esp32/build-*/frozen_mpy/neopixel.mpy`.
- **Never probe array-likeness with `hasattr(obj, '__getitem__')`.** MicroPython does not expose the
  special methods of its built-in types as attributes, so `hasattr` is `False` for `array.array`,
  `bytearray` and `list` — a `hasattr` check silently rejects every real channel on the device
  while passing on CPython. Test sequence behaviour with `len()` and one index access inside
  `try/except (TypeError, IndexError, KeyError)` instead.
- `digital.output` capability does **not** mean the pin is free — it may be claimed (console,
  native USB, onboard LED); the target `claims` surface those advisories in the pin picker and
  validation.
- A wrong pin produces no error at all — only a dark strip. Verify the physical pin against the
  target.

## Node set

- `led-neopixel-output` — `colorModel` (single/rgb/rgbw), `order`, `pin` (dynamic `digital.output`), `count`; array inputs `channel0..channel3`.
- `led-pwm-strip-output` — `redPin`/`greenPin`/`bluePin` (dynamic `pwm.output`); float inputs `r`/`g`/`b`.
- `led-single-output` — `pin` (dynamic `pwm.output`); float input `value`.

Outputs are `executionPhase: "both"`: init creates the driver instance, loop calls `write`.

## Generated code shape

```python
import otter_vars.arrays as _arr
import otter_vars.store as _store
from otter_led.drivers.neopixel import NeoPixel

async def init():
    node_1_out0 = _arr.fill(60, 0.5, clamp=False)
    _store.set('default', 'buf', node_1_out0)
    _np_3 = NeoPixel(pin=2, count=60, order='GRB', has_white=False)

async def main():
    while True:
        node_2_out0 = _store.get('default', 'buf', 0)
        _np_3.write([node_2_out0, node_2_out0, node_2_out0])
        await asyncio.sleep_ms(100)
```

## Capability note

The NeoPixel data pin is selected with the existing `digital.output` capability (pin selection only). Signal generation uses MicroPython's built-in `neopixel` module (RMT on ESP32), so the target firmware must freeze the micropython-lib `neopixel` driver — both of our images (`esp32`, `esp32s3`) do. There is no `neopixel` C module and therefore no `MICROPY_PY_NEOPIXEL` build flag in MicroPython 1.29. A dedicated `neopixel` pin *capability* is deferred because `DeviceTargetInfo.#buildCapabilityToPins` is hardcoded and would need a core change to support arbitrary top-level pin fields.
