# DataTableView

## Overview

`DataTableView` is a reusable, theme-able `ViewBase` leaf component for rendering tabular data.
It renders a native HTML `<table>` and is styled through the Standard Compact Dark theme via
`data-table-view.css`.

It supports two common layouts:

- **Key/value tables** — two columns, no header; the first column is automatically styled as a
  muted label column.
- **Multi-column tables** — an optional header row plus any number of data columns.

## Options

| Option | Type | Description |
|--------|------|-------------|
| `columns` | `DataTableColumn[]` | Column definitions (`key`, `label`, `headerClassName`, `cellClassName`, `align`). |
| `rows` | `DataTableRow[]` | Row data as positional `cells` or keyed `record`. |
| `caption` | `string \| number \| null \| undefined` | Optional `<caption>` rendered above the table. |
| `header` | `boolean \| null` | Force the header row on/off; defaults to auto (header shown when any column has a label). |
| `dense` | `boolean` | Compact padding (default `true`). |
| `striped` | `boolean` | Zebra row striping (default `false`). |
| `fixed` | `boolean` | Use `table-layout: fixed` (default `false`). |

## API

- `setColumns(columns: DataTableColumn[])`
- `setRows(rows: DataTableRow[])`
- `clearRows()`
- `updateCell(rowIndex, colIndex, cell)`

## Theming

`DataTableView` is styled exclusively through the `--mo-*` CSS variables defined by the active
theme, so it follows theme switching automatically.

Key classes:

- `.data-table-view`
- `.data-table-view--dense`
- `.data-table-view--striped`
- `.data-table-view__cell--label`

## Use Cases

- Deploy view device information panel (key/value tables).
- Runtime constituent versions and node package tables.
- Any capability/configuration listing that needs label/value or columnar rendering.
