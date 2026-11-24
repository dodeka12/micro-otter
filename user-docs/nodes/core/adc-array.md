# ADC Block

Captures a block of ADC samples at a fixed rate and outputs the block as an array.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Samples` | `vars.array` | captured voltages (0-3.3 V), oldest sample first |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `ADC Pin` | dropdown | `1` | ADC pin to sample |
| `Sample Rate` | dropdown | `5 kHz` | samples per second |
| `Samples per Block` | dropdown | `64` | array length |

## Behaviour

- Init allocates one float buffer of `Samples per Block` entries; the loop overwrites it in place and
  republishes the same array every pass, so nothing is allocated per pass.
- The capture runs inline and paces itself with an absolute deadline, so the graph is blocked for the
  whole block: `Samples per Block ÷ Sample Rate` — about 12.8 ms with the defaults.
- Because the buffer is reused, a consumer that stores the reference (a `Variable Write`, for example)
  sees the newest block, not the one it stored.
- `Sample Rate` and `Samples per Block` are fixed option lists; the longest block (128 samples at
  1 kHz) blocks the graph for 128 ms and pauses web-view refreshes.
- Start-up captures one extra block during init, and the node claims its ADC pin so two blocks cannot
  share one pin.

## Example

1. Set `ADC Pin` and keep 5 kHz with 64 samples for a first waveform.
2. Wire `Samples` into `Line Graph` with a fixed y range of 0–3.3 V and leave x unconnected.
3. Feed the same array into `Array Math` `Maximum` to track peaks without plotting.

## See also

- [Core package](index.md) — pin claims and block timing
- [ADC Input](adc-input.md) — a single reading per pass
- [Line Graph](../webview/graph-display.md) — the usual consumer of a block

