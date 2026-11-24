# Ring Modulator

Multiplies the signal by a sine carrier for metallic, bell-like sidebands.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Frequency` | `float` `int` | carrier frequency in Hz |
| `Depth` | `float` | 0 = dry, 1 = full ring modulation (intermediate values give amplitude modulation at the carrier rate) |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | ring-modulated audio block |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Sample Rate` | dropdown | `16 kHz` | audio sample rate in Hz |

## Behaviour

- Multiplies the signal with an interpolated sine carrier at `Frequency` (10–4000 Hz, default 150) and
  produces metallic, bell-like sidebands.
- `Depth` 0 is a bit-exact pass-through, 1 is full ring modulation, and values in between give
  amplitude modulation at the carrier rate.
- The carrier phase advances per block and persists across blocks, so the tone has no restart artefact
  at block boundaries.
- `Sample Rate` must match the chain's rate; the phase increment is derived from it.
- Registers as a filter at its wiring position; `Enabled` off fades to dry in about 8 ms.

## Example

1. Set `Frequency` around 150 Hz with `Depth` 1 for a classic ring-mod sound.
2. Lower `Depth` to 0.3 for a tremolo-like amplitude modulation.
3. Detune `Frequency` to an inharmonic value such as 173 Hz for a bell character.

## See also

- [Audio package](index.md) — the carrier table and phase accumulator
- [Oscillator](oscillator.md) — a full oscillator rather than a carrier
- [Filter](filter.md) — the other sample-rate dependent effect

