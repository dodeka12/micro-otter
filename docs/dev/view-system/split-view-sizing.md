# SplitView Sizing Solver

The pane-size arithmetic behind `SplitView` lives in a DOM-free module,
`src/micro_otter/nodes/html/js/views/split-view-sizing.ts`, so the space-distribution rules can be
unit-tested without a layout engine. SplitView delegates to it for the available-span calculation,
for `_applyTargetShare` (maximize / minimize / relative / drag / `desiredSize` hints), and for the
flex-grow scaling and residual filler.

## Splitter Thickness

`SPLIT_VIEW_SPLITTER_THICKNESS = { active: 6, inactive: 4 }` is the single source of truth for the
rendered splitter box. The matching CSS in `styles/standard/split-view.css` declares the boxes with
`box-sizing: border-box` at exactly these sizes:

- `.split-view__splitter` (active) — 6px on the split axis (`6px` content-box equivalent: 4px +
  2 × 1px border).
- `.split-view__splitter--inactive` — 4px on the split axis (`4px` content-box equivalent: 2px +
  2 × 1px border).

Changing the splitter size requires changing both the CSS and this constant together; the test
`tests/views/split-view-sizing.test.js` pins the constant, and the splitter suites pin the rendered
span.

## Content Inset

`contentInsetStart` (px, default `0`) indents the panes from the host's logical inline-start edge
without moving the host itself. `SplitView.render()` publishes it as `--split-inset-start`, and
`split-view.css` applies it as `padding-inline-start`
(`var(--split-inset-start, var(--mo-padding, 0px))`, so splits without the option keep the host
padding). Negative and non-finite values are clamped to `0`, and the option round-trips through
`serialize()`/`deserialize()`. The graph settings' port lists use it to indent their parameter panes
under the *Inputs* / *Outputs* headers.

`contentInsetTop` is the block-start counterpart (px, default `0`): it pushes the panes down from
the host's block-start edge, published as `--split-inset-top` and applied as `padding-block-start`.
The graph settings' port lists use it to separate the first parameter pane from the section header
above the split. It shares the clamping and serialization behaviour of `contentInsetStart`.

## Content Inset Guide

`contentInsetGuide` (boolean, default `false`) draws a vertical guide line in the leading inset
gutter left free by `contentInsetStart`, so the indented panes read as children of the section
header rendered above the split. It is published to CSS as the `split-view--inset-guide` host class;
`split-view.css` renders the line with a `::before` rule that runs from `contentInsetTop` to the
host's block end at the inline-start edge, so the panes themselves are never overlapped. Logical
properties keep the line on the correct side in RTL. The option round-trips through
`serialize()`/`deserialize()` and is only meaningful together with a non-zero `contentInsetStart`.

Note that panes are flex items sized by the split ratios. A split embedded in an auto-height form
(as in the graph settings) must therefore also make its panes content-sized in CSS; the split's
inline `flex-*` values otherwise pin every pane to `minPaneSize`.

## Pane Spec

`SplitViewPaneSpec` is the static sizing fact about one pane:

```ts
{ minSize: number; maxSize: number; fixed: boolean }
```

`minSize`/`maxSize` are in px along the split axis (`Infinity` means unconstrained) and come from the
already-scaled `SplitView._paneMinSize` / `_paneMaxSize`, so `_minSizeScale`'s tight-layout scaling
stays authoritative. `fixed` reuses `_isPaneFixed` (min == max, i.e. a collapsed section).

## Equal Distribution

`distributeEqual(available, panes)` water-fills the span: fixed panes take their minimum verbatim,
the rest share the remainder equally, and a freeze loop (max 10 rounds) pins any pane that would
exceed its `maxSize` or fall below its `minSize` and re-equalizes the rest. When the frozen minimums
exceed the span, the flexible minimums are scaled down proportionally so the result never exceeds
`available`.

## Request Modes

`resolvePaneSizes(available, panes, request?)` returns one size per pane (or `null`):

- **No request** — `distributeEqual` (the equal layout).
- **`authoritative`** (maximize / minimize / relative / splitter drag / explicit resize) — the
  requested pane takes `request.size` clamped to its own min/max, siblings keep their minimums and
  share any leftover capacity in proportion to their `maxSize - minSize` headroom. If the request
  cannot fit without pushing a sibling below its minimum, the function returns `null` and the caller
  keeps the current layout.
- **`fair`** (`desiredSize` hints) — the hint is capped at the requesting pane's equal share
  (computed with `distributeEqual`), then the split is re-equalized with the requester's maximum
  tightened to that cap. A hint at or above the equal share leaves the equal layout untouched; a
  smaller hint releases the remainder to the other flexible panes equally. The hint can never starve
  a sibling below its minimum.

The two modes encode the split between user intent and a child's suggestion: maximizing or dragging a
splitter may squeeze siblings to their header height, but a `CollapsibleView` restoring its
pre-collapse height must not.

## SplitView Integration

| SplitView method | Module call |
|---|---|
| `_availableSpan()` | `computePaneSpan({ hostSpan, gap, splitterMovable })` |
| `_applyTargetShare()` | `resolvePaneSizes(available, _paneSizingSpecs(), { index, size, mode })`, then `sizesToShares` |
| `_flexGrowScale()` | `scaledFlexFactors(_ratios)` |
| `_maybeAddFiller()` | `fillerFlexFactor(_ratios)` |

`_normalizeRatios` keeps its existing normalization (equal fallback + max-size capping) and its
fixed-aware branch, because it must preserve the user's drag proportions and never cap flexible panes
in the fixed-aware branch; only the splitter constant and the target-share math moved into the
module.

## Regression

`tests/views/split-view-fair-share.test.js` drives the reported sequence — solo one section, collapse
it, expand two others, re-expand the first — through a local flexbox resolution helper and asserts the
previously-maximized pane keeps at most its equal share, the collapsed siblings stay at their header
height, the expanded siblings keep visible content, and the panes still sum to the available span.

| step | rendered pane heights (host 800px, header 32px, gap 0) |
|---|---|
| initial | 155, 155, 155, 155, 155 |
| solo S0 | 648, 32, 32, 32, 32 |
| collapse S0 | 32, 32, 32, 32, 32 |
| expand S2 | 32, 32, 648, 32, 32 |
| expand S4 | 32, 32, 340, 32, 340 |
| expand S0 | **237, 32, 237, 32, 237** |
