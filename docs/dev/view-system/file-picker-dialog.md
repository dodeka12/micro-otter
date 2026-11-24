# File Picker Dialog

`js/views/file-picker-dialog-view.ts` — one `ModalDialogView` subclass that returns a **path on the
server's machine**, never file contents. Two behaviours of one component:

- `mode: 'file'` picks a package/archive.
- `mode: 'directory'` picks a destination folder.

The browser cannot expose a filesystem path, so the dialog lists directories through an injected
`listDirectory` function (the `fs.list` side channel) and returns the absolute path the caller sends
in a job frame. It never uses `<input type="file">`, `FileReader`, `fetch`, or a raw `WebSocket`.

## Options

| Field | Type | Meaning |
|-------|------|---------|
| `mode` | `'file' \| 'directory'` | Behaviour; default `'file'`. |
| `title` | string | Dialog title. |
| `hint` | string \| null | Explainer sentence; defaulted per mode (see below). |
| `confirmLabel` / `cancelLabel` | string | Footer labels. |
| `extensions` | string[] | File suffixes to list; empty means every file. |
| `path` | string \| null | Initial directory; `null` means the server's default. |
| `listDirectory` | `FsListProvider` | Injected transport; the only server call. |
| `i18nService` / `logger` | — | Shared view services. |

## Defaulted explainer (D12)

The dialog always shows one sentence explaining where it looks:

- `mode: 'file'` → `firmwareBuild.filePicker.hint`
  ("Browsing the computer running the Micro-Otter server. The selected path is sent to the server;
  no file contents leave the picker.")
- `mode: 'directory'` → `firmwareBuild.filePicker.hintDirectory`
  ("Choose a folder on the computer running the Micro-Otter server.")

A caller-supplied `hint` always wins.

## Confirm rules

- `mode: 'file'`: the selected file row's absolute path; nothing selected throws
  `firmwareBuild.filePicker.noSelection` (swallowed by `confirm()` and shown on the error line).
- `mode: 'directory'`: the **currently shown** directory; an unloaded directory throws the same key.

The confirm event is `ModalDialogView.Confirm.v1` with `{ path, kind }`.

## Listing model

One in-flight `fs.list` request correlated by `requestId`; a superseded response is ignored. The
roots (`home`, `workspace`, `root`) come from the `fs.list.result` payload, `kind: "symlink"` rows
are shown but disabled, and errors render per `fs-*` code on the error line.

## Mounting

The caller opens it with `viewManager.showModal(dialog, { scrim: true })` and reads the answer from
the dialog's own `confirm` / `cancel` / `close` events. It is registered in `view-factory.ts` as
`FilePickerDialogView`.
