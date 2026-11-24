# Line Graph

Plots a single-series line graph with automatic or manual axis ranges.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Title` | `string` | graph title; the control value is used while the input is unconnected |
| `X Values` | `vars.array` | optional x values; unconnected falls back to the original y indices |
| `Y Values` | `vars.array` | values to plot; an empty or unconnected array draws an empty graph instead of failing |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Y Range Mode` | dropdown | `Automatic` | derive the y axis range from the data or use the manual bounds below |
| `Minimum Y` | number | `-1` | lower y axis bound; only used when the y range mode is manual |
| `Maximum Y` | number | `1` | upper y axis bound; only used when the y range mode is manual |
| `X Range Mode` | dropdown | `Automatic` | derive the x axis range from the data or use the manual bounds below |
| `Minimum X` | number | `0` | lower x axis bound; only used when the x range mode is manual |
| `Maximum X` | number | `1` | upper x axis bound; only used when the x range mode is manual |
| `Height (px)` | number | `240` | canvas height in CSS pixels |
| `X Label` | text | `empty` | X axis caption; put units in the text |
| `Y Label` | text | `empty` | Y axis caption; put units in the text |
| `Line Color` | color | `#70d6ff` | colour of the plotted line and points |
| `Tick Count` | number | `5` | target tick count per axis |
| `Max Points` | number | `256` | number of newest points kept per series; older points are dropped on the device |

## Behaviour

- Both phases: init registers the canvas, the loop pushes the x/y arrays; only the newest `Max Points`
  per series are kept and older points are dropped.
- `X Values` unconnected plots the y values against their sample index; an empty or unconnected
  `Y Values` draws an empty graph instead of failing.
- `Y Range Mode` and `X Range Mode` `Automatic` derive the bounds from the data; `Manual` uses the
  four min/max controls, which is what a stable scale needs.
- `Height (px)`, `Tick Count`, `Line Color`, `X Label` and `Y Label` shape the look; put units in the
  labels because the axis numbers carry none.
- One series per node: several lines need several `Line Graph` nodes in the tree.

## Example

1. Wire `ADC Block` `Samples` into `Y Values` and leave `X Values` unwired for a sample-index axis.
2. Set `Y Range Mode` `Manual` with 0 and 3.3 so the trace does not breathe with the data.
3. Keep `Max Points` at or above the block size, or the oldest samples of each block are dropped.

## See also

- [Web view package](index.md) — displays and the plotting contract
- [ADC Block](../core/adc-array.md) — the block that usually feeds it
- [Value Table](value-table.md) — the latest numbers next to the curve

