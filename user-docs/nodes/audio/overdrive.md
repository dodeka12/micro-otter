# Overdrive

Applies gain and hard clipping to each audio block.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Drive` | `float` | drive gain in dB applied before hard clipping (0 dB = clean) |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | processed audio block |

## Behaviour

- Registers as a filter at its wiring position; the streamed samples never pass through the graph loop,
  which only copies `Drive` and `Enabled` once per pass.
- `Drive` is a dB gain applied before hard clipping: 0 dB is clean, higher values square the waveform
  off and raise the average level.
- `Enabled` off fades to bit-exact dry in about 8 ms instead of switching, so a toggle does not click.
- Parameter changes take effect at block boundaries — 16 ms with the default 256 samples at 16 kHz.
- Input and output are both `audio.block`, so the effect sits inside one chain and cannot feed two
  sinks.

## Example

1. Place it between `I2S Input` and `I2S Output` as the only effect to hear the raw character.
2. Raise `Drive` from 0 dB to 12 dB and watch the output level meter of the input stop tracking peaks.
3. Feed `Drive` from a `Slider` so the drive can be dialled while audio keeps running.

## See also

- [Audio package](index.md) — the streaming chain and the dry/wet ramps
- [Gain](gain.md) — clean level without the clipping stage
- [Square Fuzz](square-fuzz.md) — a harder, envelope-tracked square wave

