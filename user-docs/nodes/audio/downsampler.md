# Downsampler

Sample-and-hold decimator with an anti-aliased, block-continuous hold grid.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Hold` | `int` `float` | number of times each held sample is repeated (1 = no change, clamped to the block length) |
| `Mix` | `int` `float` | dry/wet blend: 0 passes the input through untouched, 1 is the full sample-and-hold |
| `Anti-Alias` | `bool` | band-limit the input before decimating; switch off for raw, aliasing grit |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | processed audio block |

## Behaviour

- `Hold` is the number of samples each value is repeated for, 1–64 and clamped to the block length;
  the hold grid carries across blocks, so the decimation rate stays steady instead of restarting every
  block.
- `Anti-Alias` on (the default) band-limits the input with two cascaded low passes at half the hold
  rate before sampling; off gives the raw, aliasing-heavy character. It is skipped entirely for
  `Hold` 1, where nothing is decimated.
- `Mix` blends dry and held signal, so the effect can be dialled in rather than switched.
- Registers as a filter at its wiring position; `Enabled` off fades to dry in about 8 ms.
- `Hold` is clamped to the block length, so a value above it decimates the whole block to a single held
  sample instead of producing a full-scale square wave.

## Example

1. Set `Hold` 4 with `Anti-Alias` on for a mild radio effect.
2. Raise `Hold` to 16 and turn `Anti-Alias` off for the classic aliased buzz.
3. Automate `Hold` from a `Slider` to hear the decimation step through its values.

## See also

- [Audio package](index.md) — the cross-block hold grid and the anti-alias filter
- [Bitcrusher](bitcrusher.md) — resolution reduction instead of time decimation
- [Pitch Shifter](pitch-shifter.md) — another delay-line effect with crossfades

