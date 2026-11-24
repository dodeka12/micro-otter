# Web Root

Defines the root of a web view tree and creates the default root page.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Root` | `web.element` | the root web element of the page |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Page Title` | text | `Micro Otter` | title shown in the browser tab |
| `Refresh (ms)` | number | `1000` | how often the page pulls fresh values from the device, in milliseconds |

## Behaviour

- Init phase only: registers the root element, its `/` route and the page title; the loop contributes
  nothing.
- Exactly one `Web Root` is allowed per graph — a second one is badged and the build rejects it — and a
  collection with pages needs one root somewhere.
- `Page Title` is the browser tab title; `Refresh (ms)` is how often the open page asks the device for
  fresh values, so it sets the update rate of every control and display below it.
- `Root` feeds one child element; every `web.element` output accepts a single consumer, so branch the
  tree with a `Column` or `Row`.
- The root is registered at init: changing the title or the refresh rate needs a redeploy, not a page
  reload.

## Example

1. Add one `Web Root` and set `Page Title` and `Refresh (ms)` — 1000 ms suits most dashboards.
2. Wire `Root` into a `Column` and build the page downwards from there.
3. Add a `Web Page` when the build needs a second URL.

## See also

- [Web view package](index.md) — the element tree and the refresh contract
- [Web Page](web-page.md) — additional routes under the same root
- [Row](row.md), [Column](column.md) — the two layout elements that branch the tree

