# Noise

Adds white noise (static) that follows the input voice level.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Level` | `float` | static level in dB: relative to the input when Envelope Follow is on, otherwise relative to full scale |
| `Threshold` | `float` | input amplitude (dBFS) above which static is added |
| `Envelope Follow` | `bool` | when true, the static amplitude follows the input level; when false, it is relative to full scale |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | audio block with added noise |

## Behaviour

- Adds white static from a pseudo-random generator on top of the incoming block.
- `Threshold` is the input level in dBFS above which static appears — the default of −60 means it is
  always audible, a higher value gates the noise to loud passages.
- `Level` is the static level in dB: with `Envelope Follow` on (the default) it is relative to the
  smoothed input envelope, with the switch off it is relative to full scale.
- Registers as a filter at its wiring position; the loop copies `Level`, `Threshold`,
  `Envelope Follow` and `Enabled`.
- `Enabled` off fades to dry, so the static disappears without a click.

## Example

1. Leave `Threshold` at −60 and raise `Level` towards 0 dB to hear the character.
2. Set `Threshold` to −20 for static that only appears on loud syllables.
3. Turn `Envelope Follow` off for constant hiss regardless of the input.

## See also

- [Audio package](index.md) — dB conventions and the LFSR source
- [Square Fuzz](square-fuzz.md) — the other envelope-tracking effect
- [Gain](gain.md) — set the level before the threshold is judged

