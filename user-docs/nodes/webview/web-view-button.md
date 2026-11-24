# Button

Button that outputs true for one cycle when pressed, then resets to false.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |
| `Value` | `bool` | true for one cycle when pressed |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Label` | text | `Press` | text shown on the button |

## Behaviour

- `Value` is true for exactly one pass per press and falls back to false on the next pass without a
  press, so it drives edge-triggered logic rather than a level.
- There is no `changed` output: the press itself is the event.
- The button does not debounce and holds no state, so a repeated click is a repeated pulse.
- `Label` is set at build time; changing it needs a redeploy.
- A press is held until the graph reads it, so one pulse is delivered per press even when the graph is
  busy for several passes.

## Example

1. Wire a `Column` slot into `Parent` and set `Label` to `Save`.
2. Wire `Value` into the `Save` input of `Web Value Store Save` to persist the controls on demand.
3. Wire `Value` into `Post Signal` to wake an `event` graph with one press.

## See also

- [Web view package](index.md) — presses and the `changed` contract
- [Checkbox](web-view-checkbox.md) — a state that stays on
- [Web Value Store Save](web-store-save.md) — the usual consumer of a press

