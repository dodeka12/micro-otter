# Variable Read

Reads the current value of a named store entry, or the fallback input when missing.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Store` | `string` | name of the store namespace to read from |
| `Default` | `float` `int` `bool` `string` `vars.array` | value used when the store entry does not exist |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Value` | `any` | current value of the store entry |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Name` | dropdown, required | empty | use an existing variable of the selected store, or declare a new one |
| `New store` | text | `empty` | namespace used when “New store…” is selected above |
| `Variable name` | text | `empty` | name of the variable this node declares, used when “Declare variable…” is selected above |

## Behaviour

- Loop: reads the entry on every pass; a missing entry returns the `Default` input instead of raising,
  so the first pass of a fresh device already has a usable value.
- `Value` is typed `any`, so it carries a number, string, bool or a whole array; the downstream
  connector decides what it can accept.
- `Store` is a string input: leave it on its dropdown, wire a string into it, or pick `New store…` and
  type the namespace — an empty or unwired value falls back to `default`.
- `Name` must be declared for exactly one store: two nodes declaring the same variable in one store
  are flagged on both, and renaming a declaration rewrites every reader and writer.
- Namespaces starting with `_` are package-owned (`_webcontrol`) and never appear in the picker.

## Example

1. Pick the store and `Name`, and set the inline `Default` to the value a fresh device should read.
2. Wire `Value` into `Math`, a `Web Value Write` or a `Print`.
3. Leave `Default` unwired when the entry is written before it is first read.

## See also

- [Vars package](index.md) — the store model and reserved namespaces
- [Variable Write](var-write.md) — the node that creates the entry
- [Store Save](var-store-save.md), [Store Load](var-store-load.md) — persistence across reboots

