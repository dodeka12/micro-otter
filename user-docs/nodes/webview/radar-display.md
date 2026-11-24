# Radar Display

Displays a configurable partial-disk radar visualization with up to 360 slices.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Piece Index` | `int` `float` | index of the radar piece to highlight |
| `Piece Radius` | `int` `float` | normalized radius (0..1) of the radar piece |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Max Radius (px)` | number | `64` | maximum radius of the radar disk in pixels |
| `Start Angle (deg)` | number | `-90` | start angle of the visible arc in degrees |
| `End Angle (deg)` | number | `90` | end angle of the visible arc in degrees |
| `Pieces` | number | `24` | number of segments in the radar disk |
| `Fill Color` | color | `#70d6ff` | fill color of the segments |
| `Initial Radius` | number | `0` | initial normalized radius (0..1) of the displayed pieces |

## Behaviour

- Both phases: init registers the canvas, the loop pushes `Piece Index` and `Piece Radius` on every
  pass.
- `Pieces` divides the visible arc into segments and `Piece Index` counts them from `Start Angle`, so
  keep the index below `Pieces`.
- `Piece Radius` is normalised: 0 is the centre, 1 reaches `Max Radius (px)`; the highlighted piece
  fills from the centre outwards.
- `Start Angle` and `End Angle` cut a partial disk — the defaults −90° to 90° draw the left half, and
  the full 0°–360° range draws a complete radar.
- `Fill Color` and `Initial Radius` set the look; the browser draws only what the node pushes, so the
  canvas needs no client code of its own.

## Example

1. Wire a `Column` slot into `Parent` and set `Pieces` 24 with a 0°–360° arc.
2. Drive `Piece Index` from a counter and `Piece Radius` from a sensor reading to sweep the radar.
3. Set `Initial Radius` 0 so the display starts empty before the first push.

## See also

- [Web view package](index.md) — displays and their pushes
- [Joystick Display](joystick-display.md) — the other canvas display
- [Line Graph](graph-display.md) — time series instead of a polar picture

