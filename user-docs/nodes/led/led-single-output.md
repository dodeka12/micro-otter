# Single LED

Drives a single-color LED from one PWM pin.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the LED output is not updated |
| `Value` | `float` `int` | brightness (0..1) |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `PWM Pin` | dropdown | `2` | PWM pin driving the LED |

## Behaviour

- Init phase: claims the PWM pin at 1 kHz and starts at duty 0; loop: writes the brightness while
  `Enabled` is true.
- `Value` is clamped to 0..1 before it becomes a duty cycle, so `0` is off and anything at or above
  `1` is full brightness.
- Unwired, `Value` uses its inline control, which starts at 0 — the node is dark until a value
  arrives.
- A repeated brightness is not re-applied; the LED keeps its latched level.
- `Enabled` stops the write only: the last level stays on, so use 0 rather than disabling when the LED
  must go dark.

## Example

1. Set `PWM Pin` to the GPIO the LED is wired to through its series resistor.
2. Feed `Value` from `Math`, a `Variable Read` or an `ADC Input` divided down to 0..1.
3. Wire a heartbeat: a `Range Adapt` from a counter gives a slow breathing effect without extra
   nodes.

## See also

- [LED package](index.md) — the 0–1 level convention
- [LED RGB Strip (PWM)](led-pwm-strip-output.md) — three channels on three pins
- [Math](../core/math.md) — scaling a signal into 0..1

