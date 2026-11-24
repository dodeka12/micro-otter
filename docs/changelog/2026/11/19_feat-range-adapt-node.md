# Changes since version 1.29.0

## New Features
- **Range Adapt node** — Adds a core node that clamps, wraps, ping-pongs, or falls back to a
  default when a value leaves its configured range, with optional inversion.

## Bug Fixes
- **Array Set step plateaus** — `Step Width` now fills every index of a step with its
  interpolated value instead of writing only the step's first index and leaving the rest of
  the plateau at the input value.
