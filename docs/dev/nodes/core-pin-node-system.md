# Core Pin Node System

This document describes the `core` package nodes that touch physical MCU pins and the one helper
that conditions their readings: `adc-input`, `adc-array` (ADC Block), `dac-output`, `digital-input`,
`digital-output`, and `voltage-divider`.

## Scope

- Definitions: `src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json`
- Generators: `src/micro_otter/nodes/device/node_pkgs/core/node_generators.js`
- Capability checks: `src/micro_otter/nodes/device/node_pkgs/core/node_capabilities.js`
- Runtime module: `machine` (`ADC`, `DAC`, `Pin`)

These nodes are documented together because they share the same three mechanisms:

- **Pin claims.** Each hardware node declares `resourceUsage` with `kind: "pin"` and the capability
  the pin must offer, so `validateGraphResources` can reject two nodes claiming one pin and the pin
  picker can filter the target's pin map.
- **The `machine` import.** Init builds the peripheral object (`ADC`, `DAC`, `Pin`); the loop only
  reads or writes it.
- **The init/loop generator split.** Every hardware node is `category: "hardware"`,
  `executionPhase: "both"`, with `initImplementations.python` → `NodeInitGenerators.<name>`
  and `implementations.python` → `NodeCodeGenerators.<name>`.

The `pin` control is a dynamic dropdown filled by `targetPinsForCapability` with the
`capabilityKey` named in the control, which is the same capability the node's `resourceUsage`
claims.

## Pin nodes at a glance

| Node | Capability | Controls | Init statement | Loop statement |
|------|------------|----------|----------------|----------------|
| `adc-input` | `adc.wifiSafe` | `pin` (default `1`) | `_adc_1 = ADC(Pin(1))` + `_adc_1.atten(ADC.ATTN_11DB)` | `node_1_out0 = _adc_1.read_u16() / 65535.0 * 3.3` |
| `adc-array` | `adc.wifiSafe` | `pin` (`1`), `sampleRate` (`5000`), `blockSamples` (`64`) | ADC + `_adc_blk_buf_1 = _array.array('f', [0.0] * 64)` | paced capture loop, see [`adc-array`](#adc-array-adc-block) |
| `dac-output` | `dac` | `pin` (default `25`) | `_dac_1 = DAC(Pin(25))` | `if bool(True): _dac_1.write(int(max(0.0, min(3.3, (0))) / 3.3 * 255))` |
| `digital-input` | `digital.input` | `pin` (`0`), `pull` (`null`/`up`/`down`) | `_pin_1 = Pin(0, Pin.IN)` (+ `Pin.PULL_UP`/`Pin.PULL_DOWN`) | `node_1_out0 = bool(_pin_1.value())` |
| `digital-output` | `digital.output` | `pin` (default `2`) | `_pin_1 = Pin(2, Pin.OUT)` | `if bool(True): _pin_1.value(False)` |

`dac-output` and `digital-output` gate their write with `if bool(<enabled>)`, where the `enabled`
input is connector 0 and an unconnected or blank input defaults to `True` (a connected or literal
input is used verbatim). The DAC quantizes the clamped `0.0..3.3` float to `0..255`.

## `adc-array` (ADC Block)

The block node samples one ADC pin at a fixed rate into a buffer that is allocated **once** in the
init phase and reused by every loop pass, publishing the buffer on a `vars.array` output.

### Controls

| Control | Values | Default | Notes |
|---------|--------|---------|-------|
| `pin` | target pins with `adc.wifiSafe` | `1` | dynamic options via `targetPinsForCapability` |
| `sampleRate` | `1000`, `2000`, `5000`, `10000` (Hz) | `5000` | sample period = `round(1_000_000 / sampleRate)` µs |
| `blockSamples` | `16`, `32`, `64`, `128` | `64` | samples captured per loop pass |

Stale or unknown control values fall back to the defaults (`resolveAdcBlockSamples`,
`resolveAdcBlockRate`), and a missing/`null` `pin` falls back to `1`.

### Output

One output, `samples`: `outputType: "vars.array"`, `initialTypes: ["vars.array"]`,
`phase: "loop"`. There are no inputs.

### Generated code

Init (default controls, node id `1`):

```python
_adc_blk_1 = ADC(Pin(1))
_adc_blk_1.atten(ADC.ATTN_11DB)
_adc_blk_buf_1 = _array.array('f', [0.0] * 64)
```

Loop (default controls, node id `1`):

```python
_adc_blk_next_1 = time.ticks_us()
for _adc_blk_i_1 in range(64):
    _adc_blk_buf_1[_adc_blk_i_1] = _adc_blk_1.read_u16() / 65535.0 * 3.3
    _adc_blk_next_1 = time.ticks_add(_adc_blk_next_1, 200)
    _adc_blk_wait_1 = time.ticks_diff(_adc_blk_next_1, time.ticks_us())
    if _adc_blk_wait_1 > 0:
        time.sleep_us(_adc_blk_wait_1)
node_1_out0 = _adc_blk_buf_1
```

Imports registered by the init generator: `from machine import ADC, Pin`,
`import array as _array`, `import time`. Variable names are `<prefix>_<id>`: `_adc_blk_` (ADC
instance), `_adc_blk_buf_` (buffer), `_adc_blk_next_` (absolute deadline), `_adc_blk_wait_`
(remaining wait), `_adc_blk_i_` (index).

The loop uses only `read_u16`, `ticks_us`, `ticks_add`, `ticks_diff`, and `sleep_us`, each with an
on-device precedent in this repository: `read_u16`/`ADC.ATTN_11DB` in the `adcInput` generator,
`time.ticks_us`/`ticks_diff` in `device/node_pkgs/audio/otter_audio_viper/audio_chain.py`,
`time.sleep_us` in `device/runtime/general/libs/ultrasonic.py`, and `ticks_add` in the transpiler's
own loop cadence (`src/micro_otter/nodes/html/js/proc/transpiler.ts`).

### Pacing

The deadline is absolute, not relative:

1. `next = time.ticks_us()` before the first sample.
2. After every sample, `next` advances by exactly one period with `time.ticks_add`, so the schedule
   does not depend on how long the read took.
3. The remaining time is `ticks_diff(next, time.ticks_us())` and is slept only when positive. An
   overrun yields a negative difference and simply skips the sleep instead of drifting or bursting.

`ticks_*` also handles the wrapping 30-bit MicroPython tick counter. Because the whole block runs
synchronously inside the graph coroutine, the transpiler's cadence sees one long pass; it resets
its own `_next_run_ms` after an overrun (`else: _next_run_ms = _utime.ticks_ms()`), so a blocking
capture does not trigger catch-up passes.

### Block time and rate ceiling

The block lasts `blockSamples / sampleRate`:

- defaults: 64 samples at 5 kHz ≈ 12.8 ms per pass;
- shortest: 16 samples at 10 kHz ≈ 1.6 ms;
- longest: 128 samples at 1 kHz = 128 ms.

The capture blocks the entire graph for that long, so a long block starves the other nodes and
pauses Web View refreshes. 10 kHz is the highest offered rate because the per-sample MicroPython
work must fit inside a 100 µs period on ESP32-class devices; raise the ceiling only with a measured
budget, and change the option list in the node definition (not the generator) when doing so.

### Buffer reuse

One `array('f')` is allocated per device start. The loop overwrites it in place and republishes the
same object every pass, so there is no per-pass allocation; a consumer that needs the previous block
must copy it. `array('f', ...)` matches the `vars.array` runtime representation documented in
`docs/dev/nodes/vars-node-system.md` and `vars/otter_vars/arrays.py`.

### Attenuation and pin claims

Attenuation is fixed at `ADC.ATTN_11DB` (0–3.3 V nominal, uncalibrated); there is no attenuation
control, so two nodes needing different input ranges need different pins. The node's
`resourceUsage` declares `adc.wifiSafe`, so `validateGraphResources` reports a duplicate-pin
issue when the pin is also claimed by another ADC node, and transpile/deploy is blocked instead of
silently sharing one attenuation setting.

### Wiring to the Web View graph

- `samples` → `graph-display`'s `y` input; leave `x` unconnected, the runtime plots against the
  sample index.
- `yRangeMode: "manual"` with `minY: 0` and `maxY: 3.3` gives a stable scale.
- Keep `maxPoints` (default `256`) at or above `blockSamples`, otherwise the oldest samples of a
  128-sample block are tailed away.

The plotting contract is owned by the `graph-display` entry in
`src/micro_otter/nodes/device/node_pkgs/webview/node_definitions.json` and documented in
`docs/dev/nodes/webview-node-system.md`.

### Out of scope

This version has no trigger input, no `actualRate`/`overflows` reporting, no decimation, and no
background capture (the block runs inline). The emitted shape is the stepping stone to a later
`otter_core` helper module.

## Voltage divider helper

`voltage-divider` (`category: "calculation"`) conditions an ADC voltage: `topK` (default `100`) and
`bottomK` (default `22`) emit `out0 = (value) * ((topK) + (bottomK)) / (bottomK)`, i.e. it scales
a divider tap back to the source voltage. It has no pin claim and no init statement, so it is pure
loop code and can sit between any `float` producer and consumer.


## Pitfalls

- **The first block is captured during initialization.** Hardware nodes are
  `executionPhase: "both"`, so the transpiler emits the node in the init plan and again in the loop
  plan. The loop-phase statement therefore appears twice in the generated program: once in the
  `# Initialization` section of the graph function and once inside `while True:`. The startup copy
  costs one extra block time (≈13 ms with the defaults) and primes the output before the loop
  starts; it is expected, not a duplicate-capture bug.
- **An unconnected output still allocates.** Only the loop generator checks `isOutputConnected`;
  the init generator always emits the `ADC`, `atten`, and buffer allocation, and the loop section
  contains only `# adc block output not connected`. Deleting the node is what removes the
  allocation.
- **Publishing a shared buffer.** Because the same `array('f')` is republished every pass, a
  consumer that stores the reference (for example a `vars` store slot read later) sees whichever
  block was captured most recently. Copy the samples if a history is needed.

## Tests

| File | Coverage |
|------|----------|
| `tests/proc/core-pin-nodes.test.js` | generator statements for every pin node, the `adc-array` init block and paced loop (rates, block sizes, stale fallbacks, unconnected guard), and the `graph-display` `samples → y` contract |
| `tests/proc/core-pin-transpiler.test.js` | end-to-end transpile of the reference pin graph plus `adc-array → var-write` chains (default, 10 kHz/128 samples, two independent blocks, unconnected output) |

```bash
node --import tsx --test tests/proc/core-pin-nodes.test.js \
  tests/proc/core-pin-transpiler.test.js
npm run check:device-syntax
npm run test:node
npm run typecheck
```

`check:device-syntax` covers the MicroPython body in `node_generators.js`; `AGENTS.md` requires
re-verifying any `machine`, `time`, or `array` member against the pinned MicroPython implementation
and encoding new assumptions in `tests/test_device_micropython_api_guard.py`.

