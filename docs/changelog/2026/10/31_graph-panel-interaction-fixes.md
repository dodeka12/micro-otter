# Changes since version 1.23.0

## New Features
- **Selection glow** — selecting a node now highlights its connections and its one-hop neighbours
  with a soft glow so the local topology reads at a glance. The effect is disabled while dragging to
  keep interactions smooth.
- **Active node on top** — the active (last selected/clicked) node is always drawn and hit-tested
  above all other nodes, matching what the user expects when selecting a node that overlaps others.

## Bug Fixes
- **"Snap to Grid" now actually snaps** — `clampToGrid` previously only clamped positions into the
  world bounds; it never quantized to the grid spacing, so the context-menu toggle had no effect.
  Node positions now snap to `GRID_SPACING` during drag (single and multi-node), palette drop, and
  paste, and stay free when the toggle is off.
- **Dropping a node onto a connection works again** — the splice was silently rejected for any data
  type with `connectionPolicy.input.maxConnections = 1` because the replacement edge was validated
  while the old edge still occupied the target input. `canConnect` now accepts
  `excludeConnections`, and drop-insert uses it, so `source → target` becomes
  `source → inserted → target` on release.
- **Ctrl+drag node bypass works again** — dragging a pass-through node out of a connection while
  holding Ctrl/⌘ now wires its upstream directly to its downstream (preserving the original
  downstream input index). The same validation-order bug broke it; it is now deferred until the
  pointer moves more than 4 px so Ctrl+Click still toggles selection.
