# Changes since version 1.26.0

## Refactor
- **Compact CollapsibleView headers** — every section header is now 28 px tall by default (was a mix
  of 30 px and 32 px per view) and the per-view `headerHeight` overrides are removed, so Firmware,
  Deployment, Settings, Target Config, and Device Connection share one compact header; only the
  Firmware log sub-sections keep their deliberate 24 px height.
- **Stronger header surfaces** — the base `CollapsibleView` header moved one step up to
  `--mo-surface-2`, and the `nested` variant to `var(--mo-surface-3, #1c2a40)`, so a sub-section
  header still reads as one level above its parent pane.
- **Dropped the unused view-layout save/restore** — the serialized view tree in `config.viewLayout`
  was restored on start-up and then immediately replaced by the layout built from code, so it is no
  longer written or read; the visible layout does not change.
