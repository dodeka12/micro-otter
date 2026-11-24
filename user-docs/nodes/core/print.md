# Print

Prints the latest value it receives to the console while Enabled is true.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Enabled` | `bool` | print only while this input is true |
| `Title` | `string` | text printed before the value |
| `Value` | `any` | value to print |

## Outputs

None — the node has no outputs.

## Behaviour

- Loop: prints one line per pass as `[user] <Title>: <Value>` while `Enabled` is true; the `[user]` tag
  sets the line apart in the console.
- `Title` is a `string` input with an inline default of `Value`, so a dozen prints stay distinguishable.
- `Value` is `any`: numbers, strings, booleans, arrays and tuples print as their Python text.
- While disabled nothing is printed, but `Value` is still produced upstream — the node gates the line,
  not the graph.
- In a fast `continuous` graph it prints hundreds of lines per second; raise the graph's sleep or gate
  the node with a condition when the console must stay readable.

## Example

1. Wire a sensor reading into `Value` and set `Title` to `temp`.
2. Wire a bool into `Enabled` so only interesting passes appear in the console.
3. Print a `Compose` tuple to see several values on one line.

## See also

- [Core package](index.md) — `Enabled` and the console conventions
- [Console view](../../app/console-view.md) — where the lines appear
- [Memory Info](memoryInfo.md) — a value worth printing during a leak hunt

