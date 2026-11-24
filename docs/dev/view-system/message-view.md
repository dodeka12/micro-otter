# MessageView

A short text message with semantic tone and an optional panel surface. Extends
`ViewBase`.

File: `js/views/message-view.ts`, theme: `styles/standard/message-view.css`.

## Overview

Use `MessageView` for inline descriptions, setup/status lines, and validation feedback.
It is text-only: longer help belongs in `MarkdownView`, and running-operation progress
belongs in `ProgressBarView`.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `text` | `string` | `''` | Message text |
| `tone` | `'default'\|'muted'\|'info'\|'success'\|'warning'\|'error'` | `'default'` | Semantic colour |
| `variant` | `'plain'\|'panel'` | `'plain'` | Inline text or bordered surface |
| `role` | `'status'\|'alert'\|'none'` | `'none'` | ARIA role and live region |
| `hidden` | `boolean` | `false` | Start hidden |

## Methods

- `setText(text)`
- `setTone(tone)`
- `setVariant(variant)`
- `setRole(role)` — `status` gets `aria-live="polite"`, `alert` gets
  `aria-live="assertive"`, `none` removes both attributes.
- `setHidden(hidden)` — toggles the native `hidden` attribute.

## Example

```ts
const status = new MessageView({
    text: 'Saving…',
    tone: 'info',
    variant: 'panel',
    role: 'status',
});
status.attachTo(host);

status.setText('Saved');
status.setTone('success');
status.setRole('status');
```
