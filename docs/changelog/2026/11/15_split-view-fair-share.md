# Changes since version 1.25.0

## Bug Fixes
- **A re-expanded split-view section no longer reclaims its maximized height** — after maximizing
  a collapsible section with the solo (`+`) action, collapsing it, and re-expanding it, the section
  keeps at most its equal share instead of pushing every other expanded section down to its header,
  so their content stays visible.

## Refactor
- **SplitView pane sizing moved into a pure solver** — the span, equal-distribution, and
  fair/authoritative request math lives in `js/views/split-view-sizing.ts`, and the rendered
  splitter thickness (6px active / 4px inactive, border-box) is a single constant shared with the
  CSS; `desiredSize` hints are capped at the equal share while maximize/minimize/drag stay
  authoritative.
