# View Size Constraint Propagation

The view system supports automatic propagation of size constraints (minWidth, maxWidth, minHeight, maxHeight) from child views to parent containers. This ensures that container views like SplitView respect the size requirements of their nested content.

## Overview

1. **ViewBase** provides constraint properties (`minWidth`, `maxWidth`, `minHeight`, `maxHeight`)
2. **TabbedView** dynamically adopts constraints from its active child view
3. **SplitView** enforces constraints during splitter drag operations

## TabbedView Constraint Adoption

TabbedView automatically adopts the size constraints of its active tab view and propagates them to parent containers:

```ts
// NodePaletteView has the default constraints minWidth: 200, maxWidth: 420
const nodePaletteView = new NodePaletteView();

// TabbedView automatically adopts minWidth: 200 when NodePaletteView is active
const tabbedView = new TabbedView({
    // No need to specify minWidth here
});
tabbedView.addView(nodePaletteView);

// When added to SplitView, the constraint is enforced
const splitView = new SplitView({
    views: [otherView, tabbedView], // tabbedView has minWidth: 200 from NodePaletteView
});
```

### Implementation Details

- `_updateConstraintsFromActiveView()` is called automatically when:
    - A view is added via `addView()` and becomes active
    - The active tab changes via `selectView()` or tab click
    - A view is mounted via `_setMountedView()`
- The method reads the active view's constraints and adopts them:

    ```ts
    this._minWidth = activeView.minWidth;
    this._maxWidth = activeView.maxWidth;
    this._minHeight = activeView.minHeight;
    this._maxHeight = activeView.maxHeight;
    ```

- After updating, `_notifySplitViewConstraints()` is called to propagate to parent

### Dynamic Constraint Updates

When switching between tabs with different constraints, TabbedView dynamically updates:

```ts
// Tab 1: minWidth: 380
// Tab 2: minWidth: 500
// Tab 3: no constraints

// User clicks Tab 1 → TabbedView.minWidth = 380
// User clicks Tab 2 → TabbedView.minWidth = 500
// User clicks Tab 3 → TabbedView.minWidth = null
```

## SplitView Constraint Enforcement

SplitView reads constraints from direct child views and enforces them during resize:

```ts
const splitView = new SplitView({
    orientation: 'horizontal',
    views: [
        new CollectionView({ minWidth: 300 }), // Left pane: min 300px
        new NodePaletteView({ minWidth: 380 }), // Right pane: min 380px
    ],
});
```

### Enforcement Points

- During splitter drag: Prevents pane from shrinking below `minWidth`/`minHeight`
- During window resize: Respects constraints when recalculating ratios
- During programmatic ratio changes: Validates constraints before applying

### Constraint Reading

SplitView uses `_getPaneConstraints(view)` to read constraints:

1. First checks `_paneConstraints` Map (set via CustomEvent from child)
2. Falls back to reading `view.minWidth`/`maxWidth` directly
3. Uses `_paneMinSize(index)` to calculate effective minimum size

### Ratio-to-Flex Conversion

`SplitView` keeps `_ratios` normalized to one across all panes, but writes `flexGrow` as
`ratio × _flexGrowScale()`, where `_flexGrowScale()` is `1 / min(positive ratios)`. The factors are
therefore expressed in units of the smallest pane, and every pane weighs at least one.

That scaling is what makes a content-capped (`maxHeight`) pane work: CSS distributes the space a
frozen pane releases only in proportion to the factors of the panes that are still unfrozen, and
hands out just `sum × free space` when that subset sums to less than one. With bare normalized ratios
the last unfrozen pane received only its own fraction of the released space, so it kept scrolling
while the remainder sat empty below the split. Because every factor is at least 1, any non-empty set
of unfrozen panes reaches a sum of at least 1 and the released space always lands on a pane that can
use it. The transparent residual filler uses the same scale, so it still absorbs only
`1 - sum(ratios)` and never competes with the panes.

`_renderChildren()` re-applies the final ratios after the panes attach, because attaching a pane
publishes its constraints and can already recalculate `_ratios` mid-loop; without that last apply the
panes could keep the pre-attach snapshot and under-fill the split.

The span and target-share arithmetic is delegated to the pure solver in
[split-view-sizing.md](split-view-sizing.md): `_availableSpan` uses `computePaneSpan` (with the 6px /
4px splitter constant), and `_applyTargetShare` uses `resolvePaneSizes` with an `authoritative` mode
for maximize/minimize/relative/drag and a `fair` mode for `desiredSize` hints.

### Constraint Scaling Behavior

SplitView applies automatic constraint scaling when the total minimum sizes exceed available space:

- **`_minSizeScale()`**: Returns a scale factor (e.g., 0.8) when constraints are too large
    - Example: 300px + 380px = 680px, but only 600px available → scale = 600/680 ≈ 0.88
    - Prevents impossible layouts where constraints can't be satisfied
- **`_paneMinSize(index)`**: Returns scaled minimum size for layout calculations
    - Used for initial layout and window resize operations
    - Example: 380px constraint → 380 × 0.88 ≈ 334px effective minimum
- **`_baseMinSize(index)`**: Returns unscaled constraint value from view properties
    - Used during interactive splitter drag operations
    - Enforces actual constraint values without scaling
    - Rationale: Users should feel the constraint "pushback" during interaction

### Why Different Methods for Different Scenarios

```ts
// During splitter drag (interactive operation)
const minSizeA = Math.max(8, this._baseMinSize(index)); // Unscaled: respects actual 380px
const minSizeB = Math.max(8, this._baseMinSize(index + 1));

// During initial layout (non-interactive)
const effectiveMin = this._paneMinSize(index); // Scaled: allows 334px to fit tight layouts
```

Interactive drag uses unscaled constraints so users feel the actual size limits, while automated layout uses scaled constraints to handle edge cases gracefully.

### Debugging

Enable logging to see constraint propagation:

```ts
const view = new TabbedView({
    logger: console, // Logs constraint updates
});

// Console output:
// [TabbedView] constraints-updated { viewId: 'view-123', minWidth: 380, ... }
// [SplitView] layoutChange { source: 'constraints', ... }
```

## Best Practices

### Fixed-Height Children (Toolbars) and Re-Mounted Roots

A `ToolbarView` locks its own height, so it reports identical `minHeight`/`maxHeight`
(`setHeightConstraints({ minHeight: h, maxHeight: h })`). Consequences:

- A `SplitView` row that contains a toolbar can never change size — the splitter is inert chrome.
  When a view only needs "fixed strip above a flexible area", prefer a plain flex column
  (`display: flex; flex-direction: column`) with `flex: 0 0 auto` for the strip and
  `flex: 1 1 auto` for the content. This is what `GraphPanelView` does with
  `div.graph-panel-view__toolbar` + `div.graph-panel-view__canvas`
  (see [GraphPanelView Architecture](graph-panel-view-architecture.md#dom-layout)).
- Do not override the toolbar's height in CSS; `ToolbarView` writes it inline and a competing
  rule only produces layout jitter.

When the **last** constrained pane in a `SplitView` becomes unconstrained (a collapsed section
expands to `minHeight`/`maxHeight: null`, leaving no other fixed or capped pane), the view
re-equalizes the flexible panes instead of keeping the released pane's fixed-height ratio. Without
this, a section that started collapsed would keep the tiny share it held at its header height and
appear to "not open".

`ViewBase.mountContent(node)` is `container.replaceChildren(node)`, i.e. the container's children
are replaced on every `render()`. A view that must keep DOM state across a detach/attach cycle
(a canvas and its 2D context, for example) therefore has to hold on to a persistent root element
and re-mount that same element, instead of recreating its content each time.

### Setting Constraints

```ts
// ✅ GOOD: Set constraints on leaf views
const nodePalette = new NodePaletteView({
    minWidth: 280, // Palette default is 200; small icon tiles stay at 32-36px, wider panes wrap
    maxWidth: 420, // into more columns instead of enlarging the icons
});

// ✅ GOOD: Let TabbedView adopt constraints automatically
const tabs = new TabbedView();
tabs.addView(nodePalette); // TabbedView now has minWidth: 280

// ❌ AVOID: Hardcoding constraints on container views
const tabs = new TabbedView({
    minWidth: 380, // Hardcoded! Won't adapt when switching tabs
});
```

### Nested Containers

For deeply nested views, constraints propagate through multiple levels:

```ts
// Deep nesting: SplitView → TabbedView → NodePaletteView
NodePaletteView (minWidth: 200, maxWidth: 420)
  ↓ (adopted by)
TabbedView (minWidth: 200, maxWidth: 420)
  ↓ (enforced by)
SplitView (prevents pane from shrinking below 200px / growing beyond 420px)
```

### Multiple Tabs

When adding multiple tabs with different constraints:

```ts
const tabs = new TabbedView();
tabs.addView(new NodePaletteView({ minWidth: 380 })); // Tab 1
tabs.addView(new TextView({ minWidth: 200 })); // Tab 2
tabs.addView(new GraphPanelView()); // Tab 3 (no constraint)

// TabbedView.minWidth changes based on active tab:
// Tab 1 active → minWidth: 380
// Tab 2 active → minWidth: 200
// Tab 3 active → minWidth: null
```

## Related Documentation

- [View System Overview](view-system-overview.md) - Architecture overview
- [ViewBase Lifecycle](view-api-reference.md) - View lifecycle
- [ViewBase Desired Size Guide](viewbase-desired-size-guide.md) - Size preferences
- [SplitView Sizing Solver](split-view-sizing.md) - The pure pane-size solver and splitter thickness contract
- [API Reference](view-api-reference.md) - Constraint API details
