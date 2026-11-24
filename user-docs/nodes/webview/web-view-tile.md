# Tile

Structural tile container with a bordered card layout.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Title` | text | `empty` | title shown at the top of the tile |

## Behaviour

- Init phase only: registers a bordered card; the loop contributes nothing.
- `Title` is a static caption set at build time — changing it needs a redeploy.
- `Element` feeds one child, so put a `Column` inside the tile to stack several controls in one card.
- `Parent` takes one element; the tile is a visual grouping only and adds no data flow of its own.
- Cards nest, but two levels are enough for most pages and keep the layout readable.

## Example

1. Wire a `Column` slot into `Parent` and type the card caption into `Title`.
2. Put a `Value Table` and a `Slider` into the `Column` below the tile.
3. Use one tile per topic — sensors, actuators, settings — instead of one long page.

## See also

- [Web view package](index.md) — layout elements
- [Column](column.md) — the element that fills a tile
- [Title Content](title-content.md) — a heading inside the card

