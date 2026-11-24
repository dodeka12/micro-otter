# View-System Reuse Rules

The web UI is built from shared, themed components under `src/micro_otter/nodes/html/js/views/`.
Always reuse them; never hand-roll DOM, and never attach dialogs to `document.body`. A "use the view
system" instruction that does not name a specific component is not specific enough — name the
component and its file path.

## Reuse map

| Need | Reuse (component → file) |
|------|--------------------------|
| Yes/no or destructive confirmation (whole-app, scrim) | `ViewManager.showConfirmation` / `showConfirmationWithCheckbox` → `view-manager.ts` |
| Error / info message (whole-app, scrim) | `ViewManager.showError` / `showInfo` → `view-manager.ts` |
| Custom modal | `ViewManager.showModal` + a `ModalDialogView` subclass → `view-manager.ts`, `modal-dialog-view.ts` |
| Floating/transient window over the whole app (e.g. a progress banner) | `ViewManager.addOverlay` + `OverlayWindow` (`closable`, `showHeader`, `draggable`, `resizable`) → `view-manager.ts`, `overlay-window.ts` |
| Progress of ONE running operation (label, stage, elapsed, optional Cancel) | `ProgressBarView` → `progress-bar-view.ts` (text only — no bar is drawn) |
| Two determinate percentages with labels and messages (overall + detail) | `ProgressDetailView` → `progress-detail-view.ts` (pure content — the host owns the surface) |
| Progress of one device write operation (deploy/sync/remove/runtime) | `ViewManager.showModal` + `DeploymentProgressDialogView` → `deployment-progress-dialog-view.ts` (hosts `ProgressDetailView`; one surface for every trigger) |
| Progress of a device connect attempt | `ViewManager.showModal` + `ConnectingProgressDialogView` → `connecting-progress-dialog-view.ts` (hosts `ProgressDetailView`; shown by `DeviceConnectionDialogView.open()`) |
| Tabular data | `DataTableView` → `data-table-view.ts` |
| Toolbar + buttons / checkbox / text | `ToolbarView` + `ButtonControl` / `CheckboxControl` / `TextControl` → `toolbar-view.ts`, `controls/custom-runtime-controls.ts` |
| Dropdown | `DropdownControl` → `controls/dropdown-control.ts` — renders an optional left-hand title from its `label` option (`.dropdown-control__label`, associated with the trigger through `aria-labelledby`); `setLabel(label)` replaces that title after render and is the way to set a custom title or re-translate it, while `ariaLabel` stays for title-less compact hosts |
| Searchable MDI icon choice (labelled field + glyph grid) | `MdiIconPickerControl` → `controls/mdi-icon-picker-control.ts` — `portal: 'body'` for settings/dialogs, `portal: 'inline'` inside the node editor; stores any `<set>:<name>` string verbatim and fires `onChange` |
| Editable Markdown (rendered preview + Edit button → textarea) | `MarkdownEditorControl` → `controls/markdown-editor-control.ts` — allowlisted preview via `renderAreaMarkdown()`; commit on Done/blur/Ctrl/Cmd+Enter, Escape cancels; `onChange` fires only on a real change |
| Collapsible section | `CollapsibleView` → `collapsible-view.ts` |
| Vertical/horizontal layout of views or elements | `StackView` → `stack-view.ts` |
| Inline description, status, or error text | `MessageView` → `message-view.ts` |
| Code / log output | `CodeView` → `code-view.ts` |
| Log that keeps growing while a job runs | `CodeView` + `setCode(text, { follow: true })` → `code-view.ts` |
| Rendered Markdown / help text | `MarkdownView` → `markdown-view.ts` (safe allowlisted HTML via `js/core/markdown-renderer.ts`) |
| Serial port list + names | `serial-ports.ts` (`fetchSerialPorts`, `serialPortOptions`) → `js/serial/serial-ports.ts` |
| The one device connection surface | The title-bar cable badge in `workspace-view.ts` + `DeviceConnectionDialogView` → `device-connection-dialog-view.ts` (never a second connect control) |

## Rules

1. **Name it.** A plan step or code change that touches the UI must name the exact component and file
   path it reuses (e.g. "use `DataTableView` (`data-table-view.ts`) for the table").
2. **No hand-rolled dialogs.** Confirmation, error, and info dialogs go through
   `ViewManager.showConfirmation` / `showError` / `showInfo` / `showModal`. Never attach a
   `ConfirmationDialogView` (or any dialog) to `document.body` — it has no scrim or modal-layer
   positioning and does not appear.
3. **Progress stays in its section.** A running operation reports progress with
   `ProgressBarView` (`progress-bar-view.ts`) inside the section that started it, so the rest of the
   app stays interactive. The whole-app overlay layer is for floating/transient windows, not for
   blocking a long job — a job that must survive tab switches keeps its state in the owning view, not
   in an overlay.
   **Device-write exception:** a device write (collection deploy/sync/remove, runtime
   install/upgrade/remove/refresh) reports through the one modal `DeploymentProgressDialogView`
   (`deployment-progress-dialog-view.ts`) instead, because the device accepts only one writer, the
   trigger may be the title bar — which owns no section — and the operation must not be startable
   twice while it runs. Do not add a second progress surface for a write.
4. **New components are structural changes.** Creating a new `js/views/*` component is allowed only
   when no existing component provides the behaviour (e.g. `ProgressBarView` — `ToolbarView`'s
   progress bar is toolbar-bound, determinate-only, and has no label, status or cancel affordance). It
   must be general and reusable — its own JSDoc, a generic unit test, and a `docs/dev/view-system/`
   note — never a feature-specific one-off.
5. **Keep feature panels presentational.** A feature panel composes shared components and calls back
   into its owning view for dialogs and jobs; it does not open its own dialogs.
6. **Match the variant, not just the component.** When you add to an existing row, toolbar, or panel,
   copy the neighbouring call site's whole option set (`style`, `iconOnly`, `height`, wrapper class)
   rather than picking "the right" variant: a `primary` button among `secondary` siblings is the only
   one of its kind on screen, and a view-scoped override of a shared class restyles only one copy.
   When two call sites must render identically, assert the parity in a test (compare the rendered
   `classList`). See the [Coding Style Guide](../guides/coding-style-guide.md) (*Reuse Before
   Writing*, *Preserve Approved Design*).
7. **A growing log follows its tail.** `TextView.setText` and `CodeView.setCode` take
   `{ follow: true }` (`text-view.ts`, `code-view.ts`) for text that a running job appends to: a reader
   at the end keeps the end in view, and a reader who scrolled back keeps their place. Without the flag
   an update re-renders the text from its first line — the content is replaced, not appended to — so a
   long job looks frozen even though lines are arriving.
8. **A capped log box scrolls, it does not clip.** `CodeView` scrolls inside
   `.view-code__scroll-wrapper`, whose `height: 100%` only means "as tall as the host" when the host has
   a height of its own. Inside an auto-height host the wrapper grows with its text, never overflows, and
   a `max-height` on `.view-code` (which is `overflow: hidden`) deletes every line past the cap with no
   scrollbar to reach it. So cap the box with `max-height` on `.view-code` and let the wrapper inherit
   it — `code-view.css` declares `max-height: inherit` for exactly that, and
   `tests/views/code-view-scroll-cap.test.js` pins it. The Firmware tab's log boxes
   (`firmware-build-view.css`) are the reference case.
