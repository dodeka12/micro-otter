# Pitch Shifter

Shifts voice pitch up or down in semitones without changing speed.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Semitones` | `float` `int` | pitch shift in semitones (−12 = one octave down, +12 = one octave up) |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | pitch-shifted audio block |

## Behaviour

- `Semitones` shifts the pitch without changing the speed; 0 bypasses the effect with a bit-exact
  pass-through.
- The shift uses a dual-tap delay line with linear interpolation and a crossfade, so it needs no FFT
  and adds no latency beyond the block it is processing.
- Registers as a filter at its wiring position; the loop only copies `Semitones` and `Enabled`, and
  `Enabled` off fades to dry in about 8 ms.
- Large shifts smear transients and add a metallic edge; keeping the shift within an octave sounds
  most natural on voice.
- The effect is monophonic like the whole chain: it processes the one shared buffer.

## Example

1. Set `Semitones` 12 for an octave up, or −12 for an octave down.
2. Wire a `Slider` into `Semitones` to bend the voice while audio keeps running.
3. Use 0 with `Enabled` toggling for an A/B comparison of the effect.

## See also

- [Audio package](index.md) — the delay-line and crossfade design
- [Ring Modulator](ring-mod.md) — a different pitch-colouring effect
- [Filter](filter.md) — shape the result after shifting

