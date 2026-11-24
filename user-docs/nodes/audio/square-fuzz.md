# Square Fuzz

Squares the waveform to a square wave that follows the input, with a dB wet level and a dry/wet mix.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Level` | `int` `float` | gain of the squared wave in dB (0 dB = unity, negative attenuates); the dry share is untouched |
| `Mix` | `int` `float` | dry/wet blend: 0 leaves the input untouched, 1 is the full square wave |
| `Envelope Follow` | `bool` | when true, the square wave level follows the input; when false, samples are snapped to full scale |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | processed audio block |

## Behaviour

- Squares each sample and blends it back with the dry signal: `Mix` 0 is a bit-exact pass-through, 1 is
  the full square wave, and values in between keep the voice intelligible.
- The blend works on magnitudes and restores the sign, so the output stays free of a DC offset.
- `Envelope Follow` on (the default) scales the fuzz with the smoothed input envelope so it tracks the
  voice; off snaps every sample to full scale.
- `Level` is the gain of the squared path only, −60…0 dB with a default of −6 — at `Mix` 1 it simply
  trims the output.
- Registers as a filter at its wiring position; `Enabled` off fades to bit-exact dry in about 8 ms.

## Example

1. Start with `Mix` 0.5, `Level` −6 and `Envelope Follow` on for an aggressive but readable voice.
2. Turn `Envelope Follow` off for a constant wall of square wave.
3. Sweep `Mix` from 0 to 1 from a `Slider` to hear where the voice disappears.

## See also

- [Audio package](index.md) — wet-path level and the magnitude blend
- [Overdrive](overdrive.md) — softer clipping with a drive control
- [Noise](noise.md) — envelope-tracked static on top of the voice

