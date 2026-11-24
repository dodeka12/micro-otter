# LED package

Single LEDs, three-pin RGB strips and addressable WS2812/SK6812 strips, all fed with levels in the
0–1 range.

## Setup

| Requirement | Detail |
|---|---|
| Data pin (addressable) | one pin with the digital-output capability |
| PWM pins (RGB, single) | each channel needs a pin with the PWM capability |
| Channel data | addressable strips take `vars.array` inputs; arrays come from the [vars package](../vars/index.md) or from `ADC Block` |
| Array length | every channel array must hold `Count` entries; an unconnected channel counts as 0 |
| Colour range | 0.0 to 1.0 per channel |

## Nodes

| Node | What it does |
|---|---|
| [LED Strip (NeoPixel)](led-neopixel-output.md) | drives an addressable WS2812/SK6812 strip from one data pin |
| [LED RGB Strip (PWM)](led-pwm-strip-output.md) | drives a non-addressable RGB LED or strip from three PWM pins |
| [Single LED](led-single-output.md) | drives one single-colour LED from one PWM pin with brightness |

## Shared concepts

- `Color Model` picks what the channels mean: `Single color` uses `Channel 0` for all three bytes,
  `RGB` uses channels 0–2, `RGBW` uses 0–3 and sends the white byte last.
- `Color Order` matches the hardware — a wrong order shows as swapped red and green; for RGBW a
  three-letter order is extended with `W` automatically.
- A single on-board RGB LED is a NeoPixel with `Count` 1, not three PWM pins.
- A frame that did not change is not transmitted again; the hardware latches its last value, so a
  static pattern costs almost nothing per loop pass.
- All three nodes keep their last output while `Enabled` is false; nothing is written and the strip
  stays as it is.

## Related

- [vars package](../vars/index.md) — arrays and the store entries that hold patterns
- [core package](../core/index.md) — analog inputs and math for colour effects
- [Settings view](../../app/settings-view.md) — pins and their capabilities
