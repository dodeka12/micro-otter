# LED RGB Strip (PWM)

Drives a non-addressable RGB LED or strip whose red, green, and blue channels are wired to three separate PWM pins.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the LED output is not updated |
| `Red` | `float` `int` | red level (0..1) |
| `Green` | `float` `int` | green level (0..1) |
| `Blue` | `float` `int` | blue level (0..1) |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Red Pin` | dropdown | `0` | PWM pin for the red channel |
| `Green Pin` | dropdown | `1` | PWM pin for the green channel |
| `Blue Pin` | dropdown | `2` | PWM pin for the blue channel |

## Behaviour

- Init phase: claims the three PWM pins at 1 kHz; loop: writes the duty cycles while `Enabled` is
  true.
- Each input is clamped to 0..1 and mapped onto the PWM range, so a value above 1 is simply full
  brightness and a negative value is off.
- An unwired channel falls back to its inline value, which starts at 0 — a strip with only `Red`
  wired shows a red channel and no green or blue.
- A duty triple identical to the previous one is not re-applied; the LEDs latch their last level.
- The three pins may be on the same port, but they must be PWM-capable pins of the target.

## Example

1. Set `Red Pin`, `Green Pin` and `Blue Pin` to the three PWM pins wired to the strip's inputs.
2. Feed `Red`, `Green` and `Blue` from `Math` or from `Array Generate`-backed variables in 0..1.
3. Wire `Enabled` from a switch to keep the colour while the rest of the graph reconfigures.

## See also

- [LED package](index.md) — pin and range requirements
- [LED Strip (NeoPixel)](led-neopixel-output.md) — addressable strips instead of three PWM channels
- [Single LED](led-single-output.md) — one PWM channel

