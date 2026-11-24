# Audio Runtime Generation Contract

How the audio and power node packages emit firmware for the Voice-Distort chain. This document
describes the generated-code contract produced by the Phase 4 generators
(`audio/node_generators.js`, `power/node_generators.js`) and consumed by the transpiler.

## Overview

The audio chain runs entirely through a single shared `AudioChain` instance (`otter_audio_viper/audio_chain.py`)
rather than through transpiler output variables. The `audio.block` connector only enforces 1:1 chain
topology; the sample buffer itself is pumped by an asyncio task:

```
sources[0..n].read() -> [filter.process() ...] -> sink.write()
```

The transpiler does two things:

1. **Registers the chain** in topological (wiring) order inside a shared init function.
2. **Starts one `_audio_task`** coroutine that loops `run_block()` forever.

## Shared init: `init_audio`

Every audio node declares `initFunction: "init_audio"`, so its init generator's contribution is
grouped into one `async def init_audio():` function. Contributions are emitted in topological order,
which yields the correct wiring order automatically:

```
async def init_audio():
    global _i2s_in_voice_1, _od_voice_2, _bit_voice_3, _gain_voice_4, _i2s_out_voice_5
    AUDIO_CHAIN = AudioChain()
    async def _audio_task():
        while True:
            await AUDIO_CHAIN.run_block()
    _i2s_in_voice_1 = I2SInput(i2s_id=0, bclk_pin=4, ws_pin=5, data_pin=7, ...)
    AUDIO_CHAIN.add_source(_i2s_in_voice_1)
    _od_voice_2 = Overdrive()
    AUDIO_CHAIN.add_filter(_od_voice_2)
    ...
    _i2s_out_voice_5 = I2SOutput(...)
    AUDIO_CHAIN.set_sink(_i2s_out_voice_5)
    asyncio.create_task(_audio_task())
```

Key points:

- Instance names are graph-scoped: `audio/node_generators.js#varName()` emits
  `<prefix>_<scope>_<id>` (`_i2s_in_voice_1`), where `<scope>` is the graph's generated Python
  function name from `context.graph.scope`. Every graph's contributions merge into the same
  collection-wide `init_audio` while node ids restart in each graph, so a bare `_od_2` from two graphs
  would be one variable. A generator context without a graph scope keeps the bare `<prefix>_<id>`
  name for unit tests.
- `AUDIO_CHAIN`, `_audio_task` and `_audio_started` are deliberately **program-wide singletons** and
  stay unscoped — the chain is one device-wide object, and the identical bootstrap block emitted by
  every source is de-duplicated, so it exists exactly once.
- `AUDIO_CHAIN = AudioChain()` and the `_audio_task` definition are emitted as a shared-init
  **block** (`initPriority: 0`) by the `registerSource()` helper used by the `i2s-input` and
  `oscillator` init generators. Init blocks run before every execute block, so `AUDIO_CHAIN` always
  exists before any source/filter/sink registers against it — even when an unwired filter sorts
  before the first source. Identical blocks from multiple sources are de-duplicated by the
  transpiler.
- `registerSource()` always emits `AUDIO_CHAIN.add_source(inst)`. Sources are registered in
  topological order, so the first source appended becomes the primary working buffer (`_sources[0]`),
  and later sources are mixed into it.
- `add_filter` is emitted by each effect's init generator (`overdrive`, `bitcrusher`, `square-fuzz`,
  `downsampler`, `gain`, `pitch-shifter`, `filter`, `ring-mod`, `noise`).
- `set_sink` and `asyncio.create_task(_audio_task())` are emitted by `NodeInitGenerators.i2sOutput`
  (the sink is always last in topological order, so the task starts only after every filter is
  registered).
- `_audio_task` is defined inline (nested) inside `init_audio`; the closure captures `AUDIO_CHAIN`.
- The generated module auto-imports `uasyncio as asyncio` (transpiler-wide).

## Loop code

Each node's `implementations` code generator copies its loop-phase inputs into the shared instance
once per tick; no per-sample calls are emitted inside the streaming loop:

```
_od_voice_2.drive = <drive expr>
_od_voice_2.enabled = <enabled expr>
node_1_out1 = _i2s_in_voice_1.level      # i2s-input level meter
_bat_6.update()                 # battery monitor
node_6_out0 = _bat_6.voltage
node_6_out1 = _bat_6.warn
node_6_out2 = _bat_6.low
```

The battery monitor is graph-local: `power` declares no shared `initFunction`, so its `_bat_6`
initialization lands in the graph's own `# Initialization` section and needs no scope.

The streaming loop itself lives in the driver (`AudioChain.run_block`), not in generated code.

## Helper generator

`NodeHelperGenerators.audioRuntime` is a no-op that returns `null`. The `AUDIO_CHAIN` bootstrap and
`_audio_task` are emitted inline by the init generators (the transpiler helper-generator path is for
file/webserver artifacts, which audio does not need).

## Asyncio coexistence

`AudioChain.run_block()` awaits `StreamReader.readinto` (mic) and `StreamWriter.drain` (speaker), so
the generated graph loops and the web interface keep running between audio blocks. No
`sleep_ms(0)` busy-yield is required.

The primary source is double-buffered: `run_block()` reads the next block into the alternate buffer
while the current block is mixed, filtered, and written. The microphone's `read_into()` loops until
a full block has been read, because `asyncio` I2S `readinto()` may otherwise return a partial block
and leave stale samples in the buffer tail.

## Startup gating

`AudioChain` keeps power-on transients out of the speaker with two public, windowed knobs that are
read on every block (set them before the first block, or from init code):

- `warmup_blocks` (default 2) — the first N blocks the source produces are replaced with silence
  (`_zero`) before reaching the sink, and neither the secondary sources nor the filter chain run, so
  no effect state is primed from garbage. This discards the undefined content an I²S RX DMA ring
  holds until it has wrapped plus the microphone pre-amplifier's power-on pop, and it fills the TX
  DMA ring with zeros instead of stale memory. Without it the first block went straight to the
  speaker and every effect amplified it — square-fuzz binarized it to near full scale, which was the
  loud startup glitch.
- `fade_in_blocks` (default 3) — the next N blocks are ramped from 0 to unity gain by `_ramp`, using
  a Q15 per-sample step derived from the whole fade length (`ceil(32768 / (fade_in_blocks · block
  samples))`), so consecutive blocks continue one continuous ramp instead of restarting it.

Both are applied to the working buffer right before the sink write, so the prefetch/double-buffer
pipeline, short-read accounting and block counters keep running unchanged during the warm-up: gating
costs no extra reads and no heap allocations. A graph that must reproduce the very first block
unchanged (e.g. a deterministic oscillator test signal) sets both counters to 0.

## Imports

- `from otter_audio.audio_chain import AudioChain`
- `from otter_audio.i2s_input import I2SInput`
- `from otter_audio.i2s_output import I2SOutput`
- `from otter_audio.oscillator import Oscillator`
- `from otter_audio.<effect> import <EffectClass>` for each used effect
- `from otter_power.battery import BatteryMonitor`

## I2S output shutdown and gain pins

`I2SOutput` accepts two optional amplifier control pins, both driven as digital outputs:

- `sd_pin` — shutdown/mute. Held **low** (`0`) from construction until the first block is written,
  then driven high (`1`) by `write()`; `mute()` drives it low and `enable()` high. Because the chain's
  warm-up phase writes silence first, the amplifier is unmuted onto a TX DMA ring that already
  contains silence instead of popping into undefined memory. Omitted (`None`) when the node's
  `sdPin` is "None".
- `gain_pin` / `gain_high` — gain select. When a `gainPin` is assigned, the pin is driven high
  (`gain_high=True`) or low (`gain_high=False`) according to the node's `gainLevel` boolean input.
  Because the gain pin's effect is hardware dependent, the level is exposed as a loop-phase boolean
  input connector (default `true`) rather than a fixed dB value, so other nodes can drive it.

`NodeInitGenerators.i2sOutput` emits `sd_pin=` and `gain_pin=` kwargs (deterministically `None` for
unassigned pins); `NodeCodeGenerators.i2sOutput` copies the `gainLevel` input to the `gain_high`
property each loop tick.


## Oscillator (dual-mode)

- `from otter_audio.oscillator import Oscillator` — a test-signal generator (sine/square/triangle/
  sawtooth) with `frequency` (Hz), `phase` (degrees), `wave`, `mix` (0–1), `saturate`, `enabled`,
  and a `level` meter.
- When its `block` input is **unconnected**, it is a source: its init generator registers it via
  `registerSource` (`AUDIO_CHAIN.add_source(_osc_N)`; sources are appended in topological order so
  the first one becomes the primary buffer), and `read()` fills its own buffer with the scaled
  waveform.
- When its `block` input is **connected**, it is a filter: its init generator emits
  `AUDIO_CHAIN.add_filter(_osc_N)`, and `process(buf)` adds the scaled waveform on top of `buf`
  (`mix` scales the oscillation; `saturate` selects clamp vs two's-complement wrap).
- `Oscillator` generates samples from a precomputed single-cycle wavetable (512 entries) with a
  fixed-point integer phase accumulator and a pre-scaled mix table, so the per-sample streaming
  loop performs only integer table lookups — no `math.sin` and no floating-point/GC work.

## Effect DSP notes

- `gain.volume` is a dB value: `0` is unity, `+6` doubles amplitude, `−6` halves it. The node's loop
  generator default is `0` (unity).
- `bitcrusher` quantizes each sample's **magnitude** to the nearest `1 << bits` step and restores
  the sign afterwards. `bits` counts the *dropped* low bits (1–15, default **4** ≈ 12-bit;
  8 ≈ 8-bit; 15 = 1-bit), so the effective resolution is `16 − bits`. Rounding the magnitude keeps
  the output exactly sign-symmetric: a symmetric input keeps **zero DC**. The older reference
  shift `(v >> bits) << bits` truncated toward −∞, which rectified quiet samples to 0 and left a
  constant −460.8-count DC offset at `bits = 10` (55 % of the samples clipped to zero, SNR ≈ 0.7 dB
  at an 800-count peak) — that rectification was the crackle. Samples saturate to the int16 range,
  so max crush keeps a 1-bit ±full-scale signal instead of going silent.
- `downsampler` decimates with a hold grid that **spans block boundaries**: the hold phase and the
  held sample are carried across calls (like `RingMod`'s phase accumulator), so the grid never
  restarts at a block start. The previous per-block `i % hold` reset made only the hold values that
  divide the block length periodic and produced a 62.5 Hz block-rate buzz for the other 57 slider
  positions. `hold` (1–64, default 4) is clamped to `1 .. len(buf)`; a larger value used to emit a
  full-scale block-rate square wave. Before a sample is captured the input is band-limited by two
  cascaded one-pole low passes at `rate / (2 · hold)` — measured −11.8 dB of folded energy at
  `hold = 4` on an HF-only source, versus −6.2 dB for one pole and none without a filter — and
  `antiAlias = false` removes the filter for the raw, aliasing-heavy character (the filter is
  skipped for `hold == 1`, where nothing is decimated). The cutoff needs the sample rate, so the
  init generator emits `Downsampler(rate=…)` (16000 unless the node carries a `sampleRate` control).

- `overdrive.drive` is a dB value (0 dB = unity) applied before hard clipping; like `gain`, it scales
  with a cached fixed-point multiplier so its per-sample loop performs no floating-point work or heap
  allocation (see the allocation contract below).
- `pitch-shifter` shifts pitch in semitones without changing speed using a fixed-point dual-tap
  delay line with linear interpolation and crossfade (time-domain, no FFT). `semitones = 0`
  bypasses the effect.
- `filter` is a band-pass (one-pole high-pass at `low_hz` + one-pole low-pass at `high_hz`) with
  cached Q12 coefficients; it needs a `sampleRate` control to compute coefficients.
- `noise` adds white static from a 16-bit LFSR. Its `level` and `threshold` are dB: `level` scales
  the static relative to the smoothed input envelope when `envelopeFollow` is on (default) or to
  full scale when off, and `threshold` is the dBFS input above which static appears (−60 = always on).
- `square-fuzz` squares each sample's sign and, when `envelopeFollow` is on (default), scales the
  result by the smoothed input envelope so it tracks the voice; when off it snaps samples to full
  scale. A `level` control (−60…0 dB, default −6) is the gain of the **wet (squared) path only** —
  the dry share passes untouched — so at `mix = 1` it acts as an output trim while at `mix < 1` it
  sets how hot the fuzz component is (the Q15 scale is cached per `level` change).
  A `mix` control (0…1, default 0.5) blends the dry sample with the square wave using the family
  blend `out = a + ((wet − a) · mix_q15 >> 15)` on magnitudes, `a = |v|` and `wet = amp`:
  `0` is a bit-exact pass-through, `1` is the full square wave, and values in between keep the voice
  intelligible while adding fuzz character. The blend is applied to magnitudes and the sign is
  restored afterwards, so the output stays exactly sign-symmetric (no DC offset); `mix = 0` returns
  before the peak scan.

### Dry/wet ramps (`mix` and `enabled`)

Every effect in the package takes a `mix` control (0…1) plus the boolean `enabled`, and neither is
applied as a step at a block boundary — a step is audible as a click when the effect is toggled and
as zipper noise while a slider is dragged (the web controls update once per loop iteration, i.e.
every 256 samples = 16 ms at 16 kHz).

`mix_ramp.MixRamp` owns that behaviour. `update()` converts `mix`/`enabled` into a Q15 `target`
(`0` whenever the effect is disabled, so bypassing fades to bit-exact dry), and the per-sample loop
moves `cur` toward `target` by `step = 32768 // 128` (≈ 8 ms fade at 16 kHz) once per sample, which
costs one add/compare per sample. `advance(samples)` repeats that arithmetic in O(1) so the wrapper
stores the new position without the viper loop returning two values; the loops therefore take
`cur`/`target`/`step` as plain ints and never touch the object. The first `update()` **snaps**
`cur` to `target`, so parameters configured before the first block (the generated init phase) apply
immediately and only later changes fade. `cur = 0` is a bit-exact pass-through in all three effects.


## Ring Modulator

- `ring-mod` multiplies each sample by an interpolated sine carrier, producing metallic, bell-like
  sidebands. It uses a 512-entry Q7.8 sine table (9-bit index / 7-bit fraction) driven by a 16.16
  phase accumulator that persists across blocks. `frequency` sets the carrier in Hz (10–4000,
  default 150); `depth` blends the modulation coefficient `m = 256 + ((c − 256) · depth_q15 >> 15)`,
  so `depth = 0` is a bit-exact pass-through, `depth = 1` is full ring modulation, and intermediate
  values give amplitude modulation at the carrier rate; output is `(v · m) >> 8` clamped to int16.
  It needs a `sampleRate` control to derive the phase increment.

The hot per-sample loops of all effects — `gain`, `overdrive`, `square-fuzz`, `downsampler`,
`bitcrusher`, `pitch-shifter`, `filter`, `noise`, `ring-mod`, `oscillator`, the `AudioChain`
mix/copy/zero/ramp helpers, and the `i2s-input` level scan — are viper-compiled on-device (see
[Viper / fallback code pattern](#viper--fallback-code-pattern)).

## Viper requirement

The `audio` package declares `requiredCapabilities: ["viper"]` in its manifest (the package id
`audio` is the stable node-type namespace, while the viper implementation lives in the
`otter_audio_viper` module inside the `audio` package folder), and the
DSP nodes (`gain`, `overdrive`, `bitcrusher`, `square-fuzz`, `downsampler`, `pitch-shifter`,
`filter`, `noise`, `ring-mod`, `oscillator`) each declare `requiredCapabilities: ["viper"]`. A target whose
`generalCapabilities` lacks `viper: { supported: true }` therefore excludes the package from
firmware builds and flags the nodes during deploy validation. The I2S nodes are gated by their pin
`resourceUsage` instead.

## Viper / fallback code pattern

Each hot per-sample loop is written twice at module level: a `@micropython.viper` version (using
`ptr16` on the `array('h')` buffer) selected when `import micropython` succeeds, and a pure-Python
version of the same name selected on the CPython host. The guard keys on `import micropython`
(rather than `from micropython import viper`, which always fails — `viper` is a compiler-recognized
decorator, not a runtime attribute). `ptr16` reads are zero-extended, so the viper loops
sign-extend via `int(p[i])` + `if v > 32767: v -= 65536` before signed arithmetic — including when
they read a small `array('h')` state array (`downsampler` keeps its filter memory there). A viper
function that returns a value must annotate it (`-> int`), otherwise the return type defaults to
`object` and `mpy-cross` rejects the module; `tests/test_firmware_compile_mpy_precompile_device.py`
compiles the package with the real `mpy-cross`, so a viper typing error fails the suite on the host.


## Multi-source primary/secondary rule

Sources are registered via `add_source` in topological order; the **first** source appended becomes
the primary working buffer (`_sources[0]`). Additional sources are mixed (summed with 16-bit
saturation) into the primary buffer each block, so every source is audible. To apply the oscillator
as a *position-dependent* mix-in (input signal + oscillation) rather than a parallel source, wire
one source's `block` output into an oscillator's `block` input (the oscillator then acts as a
mix-in filter at that point).

## Allocation contract

The streaming path must not allocate heap memory per sample; doing so causes
GC pauses that underrun the I²S buffer. Buffers and lookup tables are
allocated once at init (all per-sample loops are integer-only and allocation-free):

- `AudioChain` allocates its two working buffers on the first block and reuses
  them forever. Per block it performs exactly one `asyncio.create_task` for the
  prefetch (the irreducible asyncio cost — every `await` of a coroutine
  allocates a frame) and caches the primary source's `read_into` callable so no
  per-block `getattr` or wrapper coroutine is created. It counts short reads,
  survives a failed prefetch (clears `_pending` in `finally`), and publishes
  `blocks` / `short_reads` / `read_errors` / `last_block_us` / `max_block_us`
  for on-device diagnosis. The generated `_audio_task` wraps `run_block()` in
  `try`/`except` and backs off on error, so a transient I²S error drops one
  block instead of killing audio.
- Effects (`oscillator`, `gain`, `overdrive`, `bitcrusher`, `square_fuzz`,
  `downsampler`, `pitch-shifter`, `filter`, `noise`, `ring-mod`) use fixed-point integer math in their per-sample
  loops, so no float objects are created per sample. Control-derived scale/step/table values are
  recomputed only when their controlling input changes. Cross-block state lives in preallocated
  objects: `downsampler` keeps its hold phase as an int and its held sample plus the two anti-alias
  filter states in one `array('h')` it mutates in place, and every effect keeps its dry/wet ramp
  position as an int (`MixRamp`), so no tuple is returned or created per block.

- `i2s_input` caches one `memoryview` per buffer (two slots for the chain's two
  alternating buffers) and only slices for the remainder on a rare partial
  read; `i2s_output` performs no Python per-sample allocation.

The I²S DMA ring (`ibuf` = 8 blocks, ≈128 ms at 16 kHz / 256 samples) absorbs the
small, constant number of short-lived asyncio objects created per block, so a GC
sweep cannot underrun the output in normal operation.

## Known limitations

- MicroPython `machine.I2S` is controller-only (master), so two I2S controllers must not share
  BCLK/WS pins (see `graph-resource-validation.md`).
- The oscillator mixes at its position in the chain (input + oscillation). Mixing two separate
  *processed* chains (e.g. two effects chains) still requires a full DAG and is out of scope.
