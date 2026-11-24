# Digital Output

Writes a boolean value to a digital output pin.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | when off, the digital output is not driven |
| `Value` | `bool` | value to write to the pin |

## Outputs

None — the node has no outputs.

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Pin` | dropdown | `2` | digital pin to write |

## Behaviour

- Init configures the pin as an output; the loop writes `Value` on every pass while `Enabled` is true.
- `Enabled` off stops the write: the pin keeps the level it had, it is not driven low.
- Until the first pass writes it, the pin sits at the level the board sets at reset, which may be high.
- The pin must be free; an onboard LED, the console UART or native USB pins are flagged in the picker.
- The node claims its pin, so two digital outputs on one pin are reported as a conflict.

## Example

1. Set `Pin` to the GPIO the LED or relay driver is wired to.
2. Wire `Value` from `Compare` so a threshold switches the pin.
3. Wire a bool into `Enabled` to hold the current level while the graph reloads.

## See also

- [Core package](index.md) — pins and their capabilities
- [Digital Input](digital-input.md) — the matching input
- [LED package](../led/index.md) — PWM and addressable outputs

