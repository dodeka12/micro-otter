# DAC Output

Writes an analog voltage (0-3.3 V) to a DAC pin.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the DAC output is not updated |
| `Value` | `float` `int` `double` | voltage to write (0-3.3 V) |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `DAC Pin` | dropdown | `25` | DAC pin to write |

## Behaviour

- Init builds the DAC on the selected pin; the loop writes the clamped voltage on every pass while
  `Enabled` is true.
- `Value` is clamped to 0–3.3 V and quantized to 0–255, so a step is about 13 mV and finer changes are
  invisible.
- `Enabled` off leaves the pin at its last voltage — it does not return it to 0.
- Only targets that declare a DAC pin offer this node; the pin dropdown lists exactly those.
- The output has 8-bit resolution even though the input is a float, so do the smoothing in the graph.

## Example

1. Set `DAC Pin` to the pin that carries the analog output.
2. Feed `Value` from `Range Convert` to map a percentage onto 0–3.3 V.
3. Wire a bool into `Enabled` to hold the last voltage while a graph reconfigures.

## See also

- [Core package](index.md) — DAC availability per target
- [ADC Input](adc-input.md) — the matching analog input
- [Array Set](../vars/array-set.md) — build a waveform to step the DAC through

