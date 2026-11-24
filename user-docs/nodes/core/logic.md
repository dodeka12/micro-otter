# Logic

Applies boolean logic operations to input values.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `A` | `bool` | first boolean operand |
| `B` | `bool` | second boolean operand |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Result` | `bool` | result of the selected logic operation |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Operation` | dropdown | `AND` | logic operation to apply |

## Behaviour

- `AND`, `OR`, `XOR`, `NAND` and `NOR` use both inputs; `NOT` reads only `A` and ignores `B` — a wire
  on `B` stays but is never read.
- Both inputs are coerced with `bool(...)`, so a numeric 0 is false and any other number is true.
- An unwired input falls back to its inline checkbox, which starts off.
- One boolean per pass, no state and no init code.
- An unwired output emits no code.

## Example

1. `AND` a motion signal with a `Time Between` window to light an LED only at night.
2. `NOT` an `Enabled` flag to drive a status LED that is on while something is off.
3. `XOR` two switches for a two-way staircase light.

## See also

- [Core package](index.md) — value nodes and inline defaults
- [Compare](compare.md) — produce the booleans this node combines
- [Select](select.md) — choose a value from a boolean instead of combining them

