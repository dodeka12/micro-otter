# Select

Dropdown select with up to 8 configurable options, each with a label and a typed value.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Title` | `string` | text shown next to the control |
| `Value` | `string` `int` `float` `bool` | value shown when the control is created |
| `Label 1` | `string` | label of option 1 |
| `Value 1` | `string` `int` `float` `bool` | value of option 1 |
| `Label 2` | `string` | label of option 2 |
| `Value 2` | `string` `int` `float` `bool` | value of option 2 |
| `Label 3` | `string` | label of option 3 |
| `Value 3` | `string` `int` `float` `bool` | value of option 3 |
| `Label 4` | `string` | label of option 4 |
| `Value 4` | `string` `int` `float` `bool` | value of option 4 |
| `Label 5` | `string` | label of option 5 |
| `Value 5` | `string` `int` `float` `bool` | value of option 5 |
| `Label 6` | `string` | label of option 6 |
| `Value 6` | `string` `int` `float` `bool` | value of option 6 |
| `Label 7` | `string` | label of option 7 |
| `Value 7` | `string` `int` `float` `bool` | value of option 7 |
| `Label 8` | `string` | label of option 8 |
| `Value 8` | `string` `int` `float` `bool` | value of option 8 |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |
| `Value` | `any` | current value of the selected option |
| `Label` | `string` | label of the selected option |
| `Changed` | `bool` | true for one tick when the resolved value changes |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Options` | dropdown | `1` | number of options |
| `Default Index` | number | `0` | index of the initially selected option |
| `Persist` | checkbox | off | keeps the selected option in the in-memory web control store |

## Behaviour

- `Options` shows 1–8 option slots; each slot has a `Label N` (text) and a `Value N`
  (string, int, float or bool), so an option can carry a number as well as a caption.
- `Value` emits the selected option's value and `Label` its caption; the value type follows the option,
  so a numeric option feeds a `float` input directly.
- `Default Index` picks the initially selected option; an index outside the option list falls back to
  the `Value` input, which is also what a page shows before the first push.
- `Changed` compares the selected **value**, so two options with the same value do not toggle it.
- `Persist` stores the option **index**, not the value: reordering options in a later build changes what
  an already persisted selection means.

## Example

1. Wire a `Column` slot into `Parent` and set `Options` 3.
2. Set the labels to `Off`, `Low`, `High` and the values to 0, 1 and 2.
3. Wire `Value` into `Select by Index` or into an audio `Gain` through `Range Convert`.

## See also

- [Web view package](index.md) — the select persist rule and `changed`
- [Checkbox](web-view-checkbox.md) — two states only
- [Value Input](web-view-number-input.md) — free numbers instead of options

