# Changes since version 1.25.0

## New Features

- **The graph canvas remembers your view** — pan and zoom are written back to the graph document
  (debounced by 250 ms and flushed on tab, graph, or panel switch), so reopening a graph, switching
  to its tab, or reloading the page restores exactly where you left it. Opening a graph never writes
  to it, so merely looking at a graph does not create a new version.
- **New graphs open centered** — a graph without a stored view opens on the middle of its content
  (nodes plus documentation areas) at the workspace default zoom, and an empty graph opens on the
  center of the grid instead of its top-left corner.

## Bug Fixes

- **Wheel zoom is gentler** — one wheel notch now zooms 5 % instead of 10 %, so trackpad and wheel
  zooming stay controllable with the pointer still anchored to the same spot; the grid bounds clamp
  as before.
