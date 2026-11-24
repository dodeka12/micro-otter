# ADC Input

Reads an analog pin via the ADC and outputs the measured voltage (0-3.3 V).

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Voltage` | `float` | measured voltage at the ADC pin (0-3.3 V) |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `ADC Pin` | dropdown | `1` | ADC pin to read |

## Behaviour

- Init builds the ADC on the selected pin at 11 dB attenuation, which gives the 0–3.3 V range; the
  loop reads it once per pass.
- `Voltage` is the raw 16-bit reading scaled by 3.3 V — uncalibrated, so treat it as a level rather
  than as a voltmeter.
- The pin dropdown only offers Wi-Fi-safe ADC pins, and two ADC nodes on one pin block the deploy
  instead of silently sharing an attenuation setting.
- `Voltage` is generated only when wired, but the ADC object itself is created either way — delete the
  node to free the pin.
- Start-up captures one extra reading, because the node contributes code to the init phase as well.

## Example

1. Set `ADC Pin` to the pin the sensor is wired to.
2. Wire `Voltage` into `Math` to apply calibration, or into `Range Convert` for a percentage.
3. Compare the result against a threshold to switch a `Digital Output`.

## See also

- [Core package](index.md) — analog pins and the 0–3.3 V range
- [ADC Block](adc-array.md) — a whole sampled block instead of one reading
- [Voltage Divider](voltage-divider.md) — recover a source voltage from a divider tap

