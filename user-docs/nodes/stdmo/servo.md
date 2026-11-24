# Servo

Sets the angle of a servo motor via PWM.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the servo is not driven |
| `Angle` | `float` `int` `double` | desired servo angle (range min..max) |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Angle` | `float` | current servo angle |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `PWM Pin` | number | `0` | PWM pin driving the servo |
| `Min µs` | number | `1000` | pulse width for the minimum angle, in µs |
| `Max µs` | number | `2000` | pulse width for the maximum angle, in µs |
| `Range Min` | number | `-90` | angle mapped to the minimum pulse width |
| `Range Max` | number | `90` | angle mapped to the maximum pulse width |
| `Max °/s` | number | `180` | maximum rate of change in degrees per second |

## Behaviour

- The servo is constructed once at init, so a pin the board cannot drive fails at boot instead of
  doing nothing.
- Runs every loop pass at a fixed 50 Hz frame rate and never writes more than once per 20 ms.
- `Angle` is clamped into `Range Min`..`Range Max` and then mapped linearly onto `Min µs`..`Max µs`;
  equal range ends are a runtime error, so leave at least one degree of span.
- The written angle moves toward the target no faster than `Max °/s`: a jump becomes a sweep across
  several passes, which keeps the current draw inside a small supply.
- `Enabled` gates only the PWM write — `Angle` still emits the requested angle, so downstream logic
  keeps running while the servo is off.

`Angle` echoes the angle the node was asked to drive, not a measured position: during a rate-limited
sweep the arm lags the output by design.

## Example

1. Set `PWM Pin` to the GPIO carrying the signal wire, and feed the servo from its own supply with a
   shared ground.
2. Feed `Angle` from `Math` or from a slider input, in degrees inside `Range Min`..`Range Max`.
3. Lower `Max °/s` for a linkage that must not snap; raise it only once the supply can take the
   current.

## See also

- [Servo package](index.md) — pulse range versus mechanical range
- [Range Adapt](../core/range-adapt.md), [Math](../core/math.md) — shaping the angle before it arrives
- [LED RGB Strip (PWM)](../led/led-pwm-strip-output.md) — the other PWM output in the palette

