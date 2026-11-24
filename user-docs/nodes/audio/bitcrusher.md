# Bitcrusher

Quantizes each sample by dropping low bits for lo-fi digital grit.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Block` | `audio.block` | input audio block |
| `Bits to Drop` | `int` `float` | low bits rounded away per sample: 4 ≈ 12-bit, 8 ≈ 8-bit, 15 = 1-bit square |
| `Mix` | `int` `float` | dry/wet blend: 0 passes the input through untouched, 1 is the full crush |
| `Enabled` | `bool` | when false, the effect is bypassed and audio passes through unchanged |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Block` | `audio.block` | processed audio block |

## Behaviour

- `Bits to Drop` counts the low bits that are removed: 1 is subtle, 4 (the default) is roughly 12-bit,
  8 is 8-bit and 15 leaves a 1-bit signal.
- Quantization rounds each sample's magnitude and restores the sign afterwards, so the crushed signal
  keeps zero DC and saturates instead of collapsing to silence at high settings.
- `Mix` blends dry and crushed: 0 is the untouched input, 1 is the fully crushed signal.
- Registers as a filter at its wiring position; the loop only copies `Bits to Drop`, `Mix` and
  `Enabled`, and `Enabled` off fades to dry in about 8 ms.
- Changes land at block boundaries, so dragging the bits slider steps audibly rather than gliding.

## Example

1. Put it after `Gain` with `Mix` 1 and `Bits to Drop` 4 for a first lo-fi pass.
2. Raise `Bits to Drop` towards 12 for a radio-like texture, then pull `Mix` back to 0.4.
3. Feed `Bits to Drop` from a `Slider` to sweep the resolution while audio runs.

## See also

- [Audio package](index.md) — bit depth, mix and the allocation contract
- [Downsampler](downsampler.md) — the other lo-fi effect, in the time domain
- [Square Fuzz](square-fuzz.md) — extreme clipping rather than quantization

