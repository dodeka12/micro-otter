# LED Strip (NeoPixel)

Drives an addressable WS2812/SK6812 (NeoPixel) strip from a single data pin.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the LED output is not updated |
| `Channel 0` | `vars.array` | single-color intensity or red channel |
| `Channel 1` | `vars.array` | green channel |
| `Channel 2` | `vars.array` | blue channel |
| `Channel 3` | `vars.array` | white channel (RGBW only) |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Data Pin` | dropdown | `2` | data pin driving the strip |
| `Count` | number | `60` | number of LEDs in the strip |
| `Color Order` | dropdown | `GRB` | color order of the strip protocol |
| `Color Model` | dropdown | `RGB` | how channel values are interpreted: Single color uses Channel 0 for all three color bytes (a scalar or an array of length Count); RGB uses Channels 0–2; RGBW uses Channels 0–3 |

## Behaviour

- Init phase: builds the strip from `Data Pin`, `Count`, `Color Order` and `Color Model`; loop: writes
  one frame per pass while `Enabled` is true.
- Channel values are floats in 0..1 and are quantized to bytes at the driver boundary — feeding 0–255
  values gives a strip that is fully lit from 1 upward.
- `Single color` sends `Channel 0` to all three color bytes, so one scalar or one array of
  length `Count` already lights the whole strip.
- An unwired channel counts as 0, a scalar channel is broadcast to every LED, arrays shorter than
  `Count` leave the remaining LEDs dark and longer arrays are truncated with a one-time warning.
- A frame identical to the previous one is not transmitted again: the strip latches its last frame,
  so a static pattern costs almost nothing per pass.

## Example

1. Set `Data Pin` to the strip's data line, `Count` to the number of LEDs, then match `Color Order` and
   `Color Model` to the strip (a wrong order shows as swapped red and green).
2. Feed `Channel 0`–`Channel 2` from three `Array Generate` nodes for a first RGB sweep.
3. For an onboard RGB LED set `Count` to 1 and feed the channels with arrays of length 1.

## See also

- [LED package](index.md) — colour models, colour order and the 0–1 range
- [Array Generate](../vars/array-generate.md), [Array Modify](../vars/array-modify.md) — building the
  channel arrays
- [Single LED](led-single-output.md) — one colour over one PWM pin

