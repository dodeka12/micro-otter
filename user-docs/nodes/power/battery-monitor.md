# Battery Monitor

Reads a resistor-divided pack voltage via ADC and outputs the pack voltage plus warning and low-battery flags.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Voltage` | `float` | measured pack voltage in volts |
| `Warn` | `bool` | true when the pack is at or below the warning threshold (per-cell) |
| `Low` | `bool` | true when the pack is at or below the cutoff threshold |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `ADC Pin` | dropdown | `1` | ADC pin connected to the voltage-divider midpoint |
| `Top Resistor (kΩ)` | number | `100` | top divider resistor in kΩ (toward the pack) |
| `Bottom Resistor (kΩ)` | number | `22` | bottom divider resistor in kΩ (toward ground) |
| `Cells` | number | `4` | number of series cells in the pack |
| `Warn V/cell` | number | `3.4` | per-cell voltage below which the pack is flagged low (warning) |
| `Cutoff V/cell` | number | `3.1` | per-cell voltage at which the pack is considered empty (cutoff) |

## Behaviour

- Init phase: opens the ADC on `ADC Pin` with 11 dB attenuation, so 0–3.3 V maps onto the full
  reading, and latches the divider ratio.
- Loop: one sample per pass, then `Voltage`, `Warn` and `Low`; each output is generated only when
  wired.
- `Voltage` is the raw reading scaled by 3.3 V and multiplied by `(Top + Bottom) ÷ Bottom` — there is
  no averaging, so a noisy supply shows up directly in the value.
- Both flags compare the voltage per cell (`Voltage ÷ Cells`) and are true *at or below* the
  threshold, so a pack sitting exactly at 12.4 V already reports `Low`.
- The thresholds are independent: raising `Warn V/cell` above `Cutoff V/cell` makes both flags true
  at the same time instead of raising an error.

## Example

1. Wire the divider midpoint to an ADC pin and set `Top Resistor (kΩ)` and `Bottom Resistor (kΩ)` to
   the values you actually soldered.
2. Set `Cells` to the series count of the pack — 1 for a single cell, 4 for a 4S pack.
3. Wire `Voltage` into a sensor entity and `Low` into the logic that stores state and shuts down.

## See also

- [Power package](index.md) — divider maths and threshold defaults
- [ADC Input](../core/adc-input.md) — the raw voltage without the divider scaling
- [HA Sensor](../hass/hass-sensor.md) — publish `Voltage` and `Low` to Home Assistant

