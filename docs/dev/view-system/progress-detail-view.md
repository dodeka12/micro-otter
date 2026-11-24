# Progress Detail View

`ProgressDetailView` (`js/views/progress-detail-view.ts`) is the reusable, two-tier determinate
progress display: an overall bar and a detail bar, each with an owner-supplied label and message
line, separated by a divider. It is pure content — the host owns the surface, padding and placement.

The sole consumer today is
[`DeploymentProgressDialogView`](deployment-progress-dialog.md), which hosts it inside the
device-write modal. Any other view that reports real percentages can compose it the same way.

## Why not `ProgressBarView`

[`ProgressBarView`](view-system-overview.md) is deliberately **text-only**: its JSDoc explains
that a percentage bar would be invisible or lying for the indeterminate `WS /firmware` protocol.
`ProgressDetailView` is the counterpart for sources that report an honest `0…100 %`. The boundary is:

| Need | Component |
|------|-----------|
| Stage, elapsed time and an optional Cancel for an indeterminate operation | `ProgressBarView` — text only |
| One or two determinate percentages with labels and messages | `ProgressDetailView` |
| A device-write progress surface with a phase line and a non-dismissible header | `DeploymentProgressDialogView`, which hosts `ProgressDetailView` |

Do not add a percentage to `ProgressBarView`; do not add operation vocabulary (phases, file names,
locale keys) to `ProgressDetailView`.

## Composition

```text
.progress-detail-view                         (root, width: 100%, box-sizing: border-box)
├── .progress-detail-view__tier               (overall)
│   ├── .progress-detail-view__label
│   ├── .progress-detail-view__bar-wrapper
│   │   └── .progress-detail-view__bar        (role="progressbar")
│   └── .progress-detail-view__text
├── .progress-detail-view__divider            (role="presentation")
└── .progress-detail-view__tier               (detail)
    ├── .progress-detail-view__label
    ├── .progress-detail-view__bar-wrapper
    │   └── .progress-detail-view__bar        (role="progressbar")
    └── .progress-detail-view__text
```

The root is a column flex container with `gap: 8px`; each tier stacks its label, bar and message
with `gap: 6px`. The divider has `margin: 0`, so the root gap reproduces the spacing the previous
dialog-local divider expressed as `margin: 8px 0`. The component declares **no** `position`, `inset`
or `z-index`, and no background, border, radius or padding on the root.

## API

| Member | Effect |
|--------|--------|
| `new ProgressDetailView({ overallLabel, detailLabel, overallMessage, detailMessage })` | Creates the component; all strings are already translated |
| `setOverall(progress, message)` | Overall bar width, `aria-valuenow`, `aria-valuetext` and message line |
| `setDetail(progress, message)` | Same for the detail tier, independent of the overall tier |
| `setMessages(overallMessage, detailMessage)` | Replaces both message lines, **keeps both widths** (terminal-error shape) |
| `setOverallLabel(label)` | Replaces the overall label and its bar's `aria-label` |
| `setDetailLabel(label)` | Replaces the detail label and its bar's `aria-label` |
| `get overall` / `get detail` | Snapshot copies of `{ progress, message }` |
| `serialize()` / `ProgressDetailView.deserialize()` | Round-trips both labels and both tier snapshots |

Both bars expose `role="progressbar"`, `aria-label` (the tier label), `aria-valuemin="0"`,
`aria-valuemax="100"`, `aria-valuenow` (the percentage) and `aria-valuetext` (the message).

### Clamping contract

`progress` is clamped to `0…100`. A non-finite value (`NaN`, `Infinity`) keeps the previous width
while the message still updates, so a coarse tracker that sends a bad percentage cannot make the bar
jump or vanish. Clamping lives in this component; hosts pass the reported number through unchanged.

## State and repaint

The component stores both labels and both tier states. Rendered elements are cached separately and
dropped in `beforeDetach()`, so a setter that fires while detached only updates state.
`render()` rebuilds the DOM and calls `#sync()` at the end, which repaints labels, ARIA attributes,
bar widths and message lines from the stored state. A re-attached host therefore shows the live
snapshot instead of an empty shell; no host-side replay code is needed.

## Styling

The stylesheet is `styles/standard/progress-detail-view.css`, registered as `progress-detail-view`
in `styles/themes.json` and in `DEFAULT_THEME_STYLES` (`js/views/view-theme-registry.ts`). The class
is registered with `ViewFactory` as `ProgressDetailView`.

The bar wrapper uses `box-sizing: border-box` and `height: 8px`, which reproduces the previous
content-box `height: 6px` plus 2 × 1px border while keeping the border inside the host. Keeping the
root `width: 100%` + `box-sizing: border-box` is what lets a padded host such as the modal surface
avoid overflow.

## Tests

`tests/views/progress-detail-view.test.js` covers the structure and ARIA contract, independent tier
updates, the clamping matrix, message replacement without width changes, label updates,
detach/re-attach repaint, serialization, `ViewFactory` registration, and the plain-content CSS
invariants. The dialog suite (`tests/views/deployment-progress-dialog-view.test.js`) pins the
composition and the absence of bar rules in the dialog stylesheet.
