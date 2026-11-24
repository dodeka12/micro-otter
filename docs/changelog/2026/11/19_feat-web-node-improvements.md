# Changes since version 1.28.1

## New Features
- **Number input bounds** — the Web View number input gains `Min Value`, `Max Value`
  and `Step` controls (defaults `0`, `100`, `1`); the configured default, device-side
  values and typed values are all clamped to the inclusive range, the spinner honours
  the bounds and step, and typed values are never snapped to a step.
- **`changed` outputs for Web View controls** — the number input, string input, slider,
  checkbox, select and joystick expose a boolean `changed` output that is true for
  exactly one tick when the resolved value changes; select tracks the option value
  rather than its label, the joystick sets one flag when either axis moves, and the
  button is unchanged.
- **Equal-width row columns** — columns placed directly inside a row now share the row
  width equally, and a wide control inside a column shrinks instead of stretching the
  row.
