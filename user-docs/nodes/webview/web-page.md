# Web Page

Defines an explicit page under the root page.

## Inputs

None — the node has no inputs.

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Page Name` | text | `empty` | unique page path shown in the URL |

## Behaviour

- Init phase only: registers the page route for `Page Name` and creates the page element under the root.
- `Page Name` becomes the URL path, so keep it short and free of spaces and slashes.
- Any number of pages are allowed; each one adds exactly one route next to the root page.
- The page element needs a `Web Root` in the collection — without it the graph rule reports missing
  root ownership instead of deploying a page nobody can reach.
- `Element` feeds one child; branch further with a `Column` or `Row`.

## Example

1. Set `Page Name` to `settings` and wire `Element` into the tree that belongs on that page.
2. Keep the root page for the live values and the extra page for configuration.
3. Link between pages from your own HTML or by typing the URL — the build does not add a menu.

## See also

- [Web view package](index.md) — pages, routes and root ownership
- [Web Root](web-root.md) — the node that owns the routes
- [Tile](web-view-tile.md) — a card that groups a page's controls

