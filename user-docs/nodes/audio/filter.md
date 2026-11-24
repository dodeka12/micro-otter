# Filter

Band-pass filter (high-pass + low-pass) for radio/telephone-style voice.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Low Cutoff` | `float` `int` | high-pass cutoff in Hz (removes frequencies below this) |
| `High Cutoff` | `float` `int` | low-pass cutoff in Hz (removes frequencies above this) |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | filtered audio block |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Sample Rate` | dropdown | `16 kHz` | audio sample rate in Hz |

## Behaviour

- Builds a band-pass from a one-pole high-pass at `Low Cutoff` and a one-pole low-pass at
  `High Cutoff`; both cutoffs are in Hz.
- `Sample Rate` must match the chain's rate, because the coefficients are derived from it — a wrong
  value moves the band to the wrong frequencies instead of failing.
- `Low Cutoff` above `High Cutoff` leaves nothing between the two stages: keep low < high.
- Registers as a filter at its wiring position; the loop copies the two cutoffs and `Enabled`, and
  `Enabled` off fades to dry in about 8 ms.
- Two filters in a chain multiply their responses, so narrow bands can be stacked.

## Example

1. Set `Low Cutoff` 300 and `High Cutoff` 3000 for a voice band that cuts rumble and hiss.
2. Narrow the band to 800–2000 Hz for a telephone character.
3. Wire `High Cutoff` from a `Slider` for a sweeping low-pass effect.

## See also

- [Audio package](index.md) — the coefficient caching and sample-rate requirement
- [Ring Modulator](ring-mod.md) — also needs the sample rate for its carrier
- [Downsampler](downsampler.md) — its own anti-alias filter, tied to the hold rate

