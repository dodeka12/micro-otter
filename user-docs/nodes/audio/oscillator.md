# Oscillator

Generates a periodic test signal (sine, square, triangle, or sawtooth) as an audio block source.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | optional input signal |
| `Frequency` | `float` `int` | signal frequency in Hz |
| `Phase` | `float` `int` | initial phase offset in degrees (0 to 360) |
| `Mix` | `float` | oscillation level (0.0 to 1.0) |
| `Saturate` | `bool` | when true, the mixed sum is clamped to the 16-bit range; when false, it wraps |
| `Enabled` | `bool` | enable or disable signal generation (outputs silence when disabled) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | generated mono audio block (16-bit samples) |
| `Level` | `float` | current output signal level (0.0 to 1.0) |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Wave` | dropdown | `Sine` | waveform shape |
| `Sample Rate` | dropdown | `16 kHz` | audio sample rate in Hz |
| `Block Samples` | dropdown | `256` | number of samples per audio block |

## Behaviour

- With `Block` unconnected the node is a source on the chain: its buffer is filled with the waveform
  and becomes the primary buffer if it is the first source, otherwise it is mixed into the primary one.
- With `Block` connected it is a filter: the waveform is added on top of the incoming block at that
  position in the chain, which is how a tone is mixed into a voice.
- `Wave` picks the waveform, `Frequency` sets it in Hz, `Phase` offsets it in degrees and `Mix` scales
  it; `Saturate` clamps at full scale rather than wrapping around.
- `Level` reports the current amplitude each pass; the samples themselves never enter the graph.
- A 512-entry wavetable and an integer phase accumulator produce the tone, so it sounds the same at any
  block size and costs no allocation per sample.

## Example

1. Leave `Block` unwired, set `Frequency` 440 with `Wave` sine and wire the output through `I2S Output`
   for a test tone.
2. Wire `I2S Input` into `Block` and lower `Mix` to 0.2 to add a quiet tone to a voice.
3. Wire `Level` into a `Logic` threshold if a warning should fire when the tone is audible.

## See also

- [Audio package](index.md) — primary/secondary sources and mix-in filters
- [Ring Modulator](ring-mod.md) — a carrier instead of an audible tone
- [I2S Output](i2s-output.md) — the sink this source ends at

