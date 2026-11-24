# MarkdownEditorControl

A general, reusable editable-Markdown control for settings forms. It shows the Markdown source as a
rendered, allowlisted preview plus an **Edit** button; clicking Edit replaces the preview with a
`<textarea>` and a **Done** button.

- File: `js/views/controls/markdown-editor-control.ts`.
- Stylesheet: `styles/standard/controls/markdown-editor-control.css`, imported by
  `graph-settings-view.css`.
- Extends `ViewBase`; modelled on `MdiIconPickerControl` (same options-object shape, `render(container)`
  lifecycle, `beforeDetach()` cleanup).

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `label` | `string` | `''` | Rendered as `.markdown-editor__label` above the preview. |
| `value` | `string` | `''` | Initial Markdown source. |
| `placeholder` | `string` | `''` | Textarea placeholder while editing. |
| `disabled` | `boolean` | `false` | Disables the buttons and the textarea. |
| `editLabel` / `doneLabel` / `emptyText` | `string` | i18n keys | Accessible button labels and the empty hint; fall back to English when the key or i18n service is missing. |
| `i18nService` / `logger` | — | `null` | Standard `ViewBase` plumbing. |

## API

- `render(container)` — builds the `.markdown-editor` wrapper (label, header with the Edit/Done
  buttons, body with the preview + empty hint + textarea).
- `getValue(): string` / `setValue(value | null | undefined)` — read/replace the source; `setValue`
  re-renders the preview only while **not** editing and never fires `onChange`.
- `setDisabled(boolean)`, `onChange(cb | null)`, `beforeDetach()`.

## Behaviour

- **View mode** shows the rendered preview (or the `emptyText` hint when the value is blank) and the
  Edit `ButtonControl` (`iconOnly: true`, `style: 'secondary'`, `IconProvider.edit`).
- **Edit mode** hides the preview/hint, shows the `<textarea>` (seeded with the current value,
  `spellcheck = false`) and a Done `ButtonControl` (`IconProvider.check`).
- **Commit** happens on Done click, textarea blur, or Ctrl/Cmd+Enter; **Escape cancels** and restores
  the previous value. `onChange` fires at most once per commit, and only when the value actually
  changed.

The preview renders through `renderAreaMarkdown()` (`js/core/render-documentation-markdown.ts`), the
same allowlisted, KaTeX-aware renderer the documentation areas use — never `marked.parse()` directly.
The edit flow mirrors `GraphPanelDocumentationLayer`'s `showEditor`/`commitEditor`/`cancelEditor`
contract (`spellcheck=false`, blur/Ctrl/Cmd+Enter commit, Escape cancel); that canvas-specific layer is
left unchanged. The control is used by `GraphSettingsView` for the function-graph **description** row
and each port row's **documentation** field.
