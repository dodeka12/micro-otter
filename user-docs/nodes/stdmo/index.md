# Servo package

Drives one hobby servo from a PWM pin with angle limits and a slew-rate limit, so a jump in the target
angle becomes a sweep instead of a slam.

## Setup

| Requirement | Detail |
|---|---|
| Pin | a GPIO number, 0–40; the pin must support PWM |
| Pulse range | `Min µs` default 1000 and `Max µs` default 2000 for the full travel |
| Angle range | `Range Min` default −90 and `Range Max` default 90 degrees, mapped onto the pulse range |
| Speed | `Max °/s` default 180; the output never moves faster than this |
| Power | the servo needs its own supply; a servo on the 3.3 V rail browns out the board |

- `Min µs` and `Max µs` describe the servo, `Range Min` and `Range Max` describe the mechanics:
  a linkage that only allows ±45° should keep the pulse range and narrow the angle range.
- A servo that buzzes at the ends is usually asking for 500–2500 µs; widen the pulse range before you
  blame the firmware.
- The node remembers the angle it last wrote and only moves toward a new target at `Max °/s`, which
  is also what keeps the current draw inside a small supply.

## Nodes

| Node | What it does |
|---|---|
| [Servo](servo.md) | sets the angle of one servo, rate-limited, and reports the angle it was asked for |

## Shared concepts

- `Angle` in is the target; `Angle` out echoes that target, it is not a measured position. During a
  rate-limited sweep the arm reaches it over several passes while the output already shows it.
- While `Enabled` is false only the hardware write is skipped: `Angle` still emits the value, so a
  disabled servo still moves through your graph's logic.
- The pulse train is fixed at 50 Hz, the standard hobby-servo frame rate, and the node updates at most
  every 20 ms.
- The pin is a plain number, not a dropdown over the target's capabilities: a wrong pin is only
  rejected by the device, not by the editor.

## Related

- [core package](../core/index.md) — `Range Adapt` and `Select` for shaping the angle
- [led package](../led/index.md) — other PWM outputs
- [Settings view](../../app/settings-view.md) — which GPIOs the target exposes
