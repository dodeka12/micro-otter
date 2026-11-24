# Voltage Divider

Scales an input voltage by a resistor divider ratio to recover the source voltage.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Value` | `float` `int` `double` | measured voltage at the divider midpoint |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Voltage` | `float` | recovered source voltage |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Top Resistor (kΩ)` | number | `100` | top divider resistor in kΩ (toward the source) |
| `Bottom Resistor (kΩ)` | number | `22` | bottom divider resistor in kΩ (toward ground) |

## Behaviour

- Pure loop calculation with no pin and no init code: `Voltage = Value × (Top + Bottom) ÷ Bottom`.
- The defaults 100 kΩ and 22 kΩ give a factor of about 5.55, so a 0.6 V tap reads as 3.3 V.
- `Bottom Resistor (kΩ)` must never be 0 — the division would fail on the device.
- The ADC input impedance loads high-value dividers, so stay in the kΩ range rather than the MΩ range.
- It only rescales; clamp the result with `Range Adapt` when a noisy tap can overshoot.

## Example

1. Wire an `ADC Input` reading the divider midpoint into `Value`.
2. Set both resistor values to what you soldered, for example 100 and 22.
3. Wire `Voltage` into `Compare` or a sensor entity to report the pack or supply voltage.

## See also

- [Core package](index.md) — analog range and calibration
- [ADC Input](adc-input.md) — the reading this node rescales
- [Battery Monitor](../power/battery-monitor.md) — a divider monitor with thresholds built in

