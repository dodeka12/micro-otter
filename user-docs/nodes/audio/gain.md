# Gain

Applies gain in dB with clipping.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Volume` | `float` | gain in dB: 0 = unity, +6 = ×2, −6 = ×0.5 |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | processed audio block |

## Behaviour

- Registers as a filter at its wiring position; the graph loop only copies `Volume` and `Enabled` once
  per pass.
- `Volume` is a dB value: 0 is unity, +6 doubles the amplitude, −6 halves it, and results saturate at
  the 16-bit range instead of wrapping.
- `Enabled` off fades to bit-exact dry in about 8 ms, so toggling does not click.
- Two gain nodes stack: the second multiplies what the first left behind.
- Parameter changes apply at block boundaries, 16 ms with the default block size at 16 kHz.

## Example

1. Put it first in the chain with `Volume` 0 to confirm the input is audible at all.
2. Lower `Volume` to −12 dB before an `Overdrive` so the clipping stage is driven by a sane level.
3. Wire a `Slider` into `Volume` for a volume control on the web page.

## See also

- [Audio package](index.md) — dB convention and the dry/wet ramp
- [Overdrive](overdrive.md) — gain plus hard clipping
- [Filter](filter.md) — shaping the band after the level stage

