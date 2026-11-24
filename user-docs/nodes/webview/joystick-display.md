# Joystick Display

Displays joystick direction and magnitude with configurable outer and inner disk styling.

## Inputs

| Port | Type | What it receives |
|---|---|---|
| `Parent` | `web.element` | parent element to place this element into |
| `Use User Input` | `bool` | when true, user input updates the joystick; otherwise only the axis inputs drive it |
| `Axis 1` | `int` `float` | horizontal axis value in the -1..1 range |
| `Axis 2` | `int` `float` | vertical axis value in the -1..1 range |

## Outputs

| Port | Type | What it emits |
|---|---|---|
| `Element` | `web.element` | the rendered web element |
| `Axis 1` | `float` | current horizontal axis value |
| `Axis 2` | `float` | current vertical axis value |
| `Changed` | `bool` | true for one tick when the resolved value changes |

## Parameters

| Control | Type | Default | Effect |
|---|---|---|---|
| `Outer Radius (px)` | number | `64` | outer disk radius in pixels |
| `Outer Stroke Width (px)` | number | `2` | outer ring stroke width in pixels |
| `Outer Stroke Color` | color | `#8db5ff` | outer ring stroke color |
| `Outer Fill Color` | color | `#0f1526` | outer ring fill color |
| `Inner Radius (px)` | number | `10` | inner disk radius in pixels |
| `Inner Fill Color` | color | `#70d6ff` | inner disk fill color |
| `Show Degree Marks` | checkbox | on | show degree tick marks around the outer ring |
| `Degree Mark Interval` | dropdown | `30°` | spacing between degree marks in degrees |
| `Degree Mark Color` | color | `#7fa1d6` | color of the degree marks |
| `Recenter On Release` | checkbox | on | return the joystick to center when released |

## Behaviour

- Both phases: init registers the widget, the loop pushes the axes; the page renders the stick at the
  position it receives.
- `Use User Input` true lets a drag on the page drive the stick; false makes it a pure display of
  `Axis 1` and `Axis 2`.
- Axes run from −1 to 1, so feed them from `Range Convert` or `Math` rather than raw sensor values.
- `Changed` is a single flag for both axes: moving either one sets it for exactly one tick.
- `Recenter On Release` returns the knob to the middle when the user lets go, and `Show Degree Marks`
  with `Degree Mark Interval` adds a scale around the ring.

## Example

1. Wire a `Column` slot into `Parent` and keep the default outer and inner radii.
2. Wire two axes from `Range Convert` and read them back from `Axis 1` and `Axis 2`.
3. Turn `Use User Input` on and wire `Changed` into a `Variable Write` to store the latest stick
   position.

## See also

- [Web view package](index.md) — the `changed` contract
- [Radar Display](radar-display.md) — a polar display without input
- [Value Input](web-view-number-input.md) — numeric entry instead of a stick

