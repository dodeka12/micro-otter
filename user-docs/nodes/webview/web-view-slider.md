# Slider

Horizontal slider.

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
| `Min Value` | number | `0` | minimum slider value |
| `Max Value` | number | `100` | maximum slider value |
| `Step` | number | `1` | increment between slider steps |
| `Persist` | checkbox | off | keeps the value in the in-memory web control store |

## Behaviour

- `Value` is clamped into `Min Value`..`Max Value` for the default, the connected value and anything
  the user drags; inverted bounds are swapped.
- `Step` sets the granularity of the slider, so a 0–255 range with `Step` 1 gives every value.
- `Changed` is true for exactly one tick when the value changes; it is false on the first tick and on a
  forced republish after a page reload.
- `Persist` stores the clamped value in `_webcontrol`; a persisted value outside a later-changed range
  is clamped again on the next read.
- The slider is horizontal and fills the width of its slot, so it fits a `Column` row directly.

## Example

1. Wire a `Column` slot into `Parent` and set `Title` to `Brightness`.
2. Use `Min Value` 0, `Max Value` 1 and `Step` 0.01 for a level that feeds an LED driver.
3. Wire `Value` into `Gain` `Volume` after a `Range Convert` to decibels.

## See also

- [Web view package](index.md) — input controls and bounds
- [Value Input](web-view-number-input.md) — typed entry with the same bounds
- [Web Value Store Save](web-store-save.md) — persist the slider position across a reboot

