# Power package

Pack voltage monitoring for battery-powered builds: one ADC channel behind a resistor divider, a
voltage output and two threshold flags.

## Setup

| Requirement | Detail |
|---|---|
| ADC pin | only Wi-Fi-safe ADC pins are offered, so the monitor cannot disturb the radio |
| Divider ratio | `Top Resistor (kΩ)` and `Bottom Resistor (kΩ)` are the two resistor values in kilo-ohms, default 100 and 22 |
| Pack shape | `Cells` is the series cell count, 1–8, default 4 |
| Thresholds | `Warn V/cell` default 3.4 and `Cutoff V/cell` default 3.1, both 2.5–4.5 |
| Companion packages | none |

- The node computes the pack voltage as `measured × (Top + Bottom) ÷ Bottom`, then divides by
  `Cells` to compare against the per-cell thresholds.
- Thresholds are per cell on purpose: a 4-cell pack warns at 13.6 V and cuts at 12.4 V with the
  defaults, and the same node works for a single cell by setting `Cells` to 1.
- The resistor values are what turn a 100 kΩ/22 kΩ pair into the right number. When `Voltage` looks
  wrong, measure the divider output with a multimeter and adjust `Top Resistor (kΩ)` until the node
  agrees, rather than trusting the resistor markings — a 5 % resistor is already 0.6 V off at 12 V.

## Nodes

| Node | What it does |
|---|---|
| [Battery Monitor](battery-monitor.md) | reads the divided pack voltage and outputs `Voltage`, `Warn` and `Low` |

## Shared concepts

- `Warn` is true at or below the warning threshold, `Low` at or below the cut-off; wire `Low` to a
  `Digital Output` or a sleep request, never to a graph that keeps running forever.
- A LiPo pack sags under load, so a `Low` flag on a heavy load is not the same as an empty pack; add a
  few loop passes of hysteresis in your graph if the flag flaps.

## Related

- [core package](../core/index.md) — `ADC Input` for a raw reading without the divider maths
- [hass package](../hass/index.md) — publish the voltage as a sensor
- [Settings view](../../app/settings-view.md) — ADC pins and their capabilities
