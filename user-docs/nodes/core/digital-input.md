# Digital Input

Reads a digital pin and outputs its boolean value.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `bool` | current digital pin value |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Pin` | dropdown | `0` | digital pin to read |
| `Pull Resistor` | dropdown | empty | optional internal pull resistor |

## Behaviour

- Init configures the pin as an input, with `Pull Resistor` `up` or `down` when one is selected; the
  loop reads the level once per pass.
- Without a pull resistor a floating pin reads noise — select one, or rely on an external resistor.
- The reading is raw: there is no debounce and no edge detection, so a bouncing button produces
  several values.
- The pin must be a digital input of the target; a claimed pin (console, native USB) is flagged in the
  picker.
- The node claims its pin, so a second digital input on the same pin is reported as a conflict.

## Example

1. Set `Pin` and `Pull Resistor` `up` for a button wired to ground.
2. Wire `Value` into `Logic` with a `Time` gate to debounce in the graph.
3. Feed `Value` into an `Interrupt Enable` chain when a press must wake a graph instead of being
   polled.

## See also

- [Core package](index.md) — pins and their capabilities
- [Interrupt Input](../irq/interrupt-input.md) — edge-triggered input with debounce
- [Digital Output](digital-output.md) — the matching output

