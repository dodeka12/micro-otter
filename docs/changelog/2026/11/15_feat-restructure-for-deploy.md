# Changes since version 1.25.0

## New Features

- **A reusable two-tier progress display** — the new `ProgressDetailView`
  (`js/views/progress-detail-view.ts`, stylesheet `progress-detail-view.css`) renders an overall bar
  and a detail bar, each with an owner-supplied label and message line, separated by a divider. It
  is pure content: no surface, padding, radius or positioning, and its root is
  `width: 100%; box-sizing: border-box`, so any host can embed it. The deployment progress dialog
  now hosts it instead of hand-rolling two tiers, and the determinate bar visuals moved there
  unchanged. The `ProgressBarView` boundary is documented: that view stays text-only for
  indeterminate operations.
- **Documentation areas gain a text-size preset and a cleaner header** — the title is centred, the
  burger is larger and vertically centred on the title line, and clicking outside an open editor now
  commits it even though the canvas suppresses the default focus change. A new **Font Size** submenu
  offers **Small** / **Normal** / **Large** (9/11/14 px) for the Markdown body and headings while the
  title stays at 16 px. The preset is translated in English and German and survives save/load,
  undo/redo, duplication and clipboard paste.
- **A new `array-set` node and a slimmer `array-modify`** — the `vars` package gains an `array-set`
  node that writes values into an array: set a single value or a sub-array at an index, set values at
  a list of indices, fill a `start..end` range, ramp between `min` and `max`, top-hat between a
  start index and a width, sine/square/sawtooth waves, and random uniform/normal fills. Index
  resolution offers clamp and wrap modes, and a sub-array longer than the target never overwrites
  its own start cell.
- **Random value and random seed nodes** — the `vars` package gains a `random-value` node that emits
  one uniform or normal sample per pass as a float or a rounded integer, and a `random-seed` node
  that seeds the global random generator every random node shares: the seed applies once while the
  node stays enabled, again when the seed changes, and again after re-enabling. Both use new
  `casino` and `key` Material Symbols icons.

## Breaking Changes

- **`array-modify` now only shifts** — the fill, ramp, steps, hat, sine, random uniform and random
  normal modes moved to the new `array-set` node, so graphs that used those modes on `array-modify`
  must recreate them with `array-set`. The `array-math` icon changed to `combine_columns`,
  `array-set` uses `cell_merge`, and `array-select` reuses the old `array-math` icon (`view_array`).
- **`array-set` no longer has a seed input** — the connector is gone and
  `otter_vars.arrays.random_uniform` / `random_normal` dropped their `seed` parameter, so random
  fills follow the shared global generator; a graph that relied on the array seed must add a
  `random-seed` node.

## Bug Fixes

- **The deployment progress dialog no longer overflows its surface** — the nested body used
  `width: min(520px, 100%)` plus `padding: 10px 12px` without `box-sizing`, so its content-box
  `100%` plus the padding spilled 24px past the modal surface. The body is now a plain
  `width: 100%; box-sizing: border-box` container with no second background or radius; the phase
  line and the hosted progress detail sit directly on the modal surface.
- **A runtime-provided view no longer appears twice** — `DeviceDeploymentView` no longer loads its
  own copy of a runtime's custom view into an absolutely positioned overlay. Runtime views remain
  owned by `DeviceConnectionView`, so the deployment tab has one runtime-status pane and no
  duplicate custom-view host or `deployment.customViewError` path.

## Refactor

- **The Deployment tab uses the standard view shell** — the tab is now one vertical `SplitView`
  with five collapsible panes in reading order: **Deployment Actions**, **Device Information**,
  **Runtime Information**, **Collection on Device**, and **Collection Comparison**. The toolbar is
  nested in the first pane instead of sitting in its own host above the split, every pane uses the
  shared 32px fit-content header, and the status pane bodies no longer repeat the section titles.
  While disconnected, the same split shows a single Markdown **Deployment Help** pane built from
  `CollapsibleView`, `ContentView`, and `MarkdownView`, matching the Firmware tab's help treatment;
  connecting swaps in the five deployment panes without replacing the split. The new
  `deployment.toolbarTitle` and `deployment.helpTitle` strings are translated in English and
  German, and stale `.deployment-status-panel` / `.deployment-compatibility-panel` / `.status-item`
  styles are gone.
