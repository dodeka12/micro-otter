# Value Input

Numeric input field.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Title` | `string` | text shown next to the control |
| `Value` | `float` | value shown when the control is created |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |
| `Value` | `float` | current value of the control |
| `Changed` | `bool` | true for one tick when the resolved value changes |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Min Value` | number | `0` | minimum number value |
| `Max Value` | number | `100` | maximum number value |
| `Step` | number | `1` | increment between number-input steps |
| `Max Digits` | number | `6` | maximum number of digits the user can enter |
| `Persist` | checkbox | off | keeps the value in the in-memory web control store |

## Behaviour

- `Value` is what the device considers current: the connected input, else the inline default. The
  browser shows that value until the user types, and the wired value takes over again when it changes.
- `Min Value` and `Max Value` clamp the default, the connected value and anything typed; inverted
  bounds are swapped, and `Step` only sets the spinner increment — an off-step value is accepted as
  typed.
- `Max Digits` limits how much the user can type, so a wide range stays usable on a phone.
- `Changed` is true for exactly one tick when the value changes; it is false on the first tick and on
  a forced republish after a page reload.
- `Persist` keeps the value in the reserved `_webcontrol` store: it survives page reloads, not a
  reboot — pair it with `Web Value Store Save` and `Web Value Store Load` for that.

## Example

1. Wire a `Column` slot into `Parent` and set `Title` to `Setpoint`.
2. Set `Min Value` 15 and `Max Value` 30 with `Step` 0.5 for a temperature setpoint.
3. Wire `Changed` into a `Variable Write` so the store only updates when the user changes something.

## See also

- [Web view package](index.md) — input controls, bounds and persistence
- [Slider](web-view-slider.md) — the same value as a drag control
- [Web Value Store Save](web-store-save.md) — keep persisted values across a reboot

