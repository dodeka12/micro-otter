// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

type DataTableCellValue = string | number | null | undefined;

export interface DataTableCell {
    text?: DataTableCellValue;
    node?: Node;
    className?: string;
    title?: string;
    data?: Record<string, string>;
}

export interface DataTableColumn {
    key?: string;
    label?: DataTableCellValue;
    headerClassName?: string;
    cellClassName?: string;
    align?: 'start' | 'end' | 'center';
}

export interface DataTableRow {
    cells?: DataTableCell[];
    record?: Record<string, DataTableCellValue | Node>;
    className?: string;
}

export interface DataTableViewOptions {
    columns?: DataTableColumn[];
    rows?: DataTableRow[];
    caption?: DataTableCellValue;
    header?: boolean;
    dense?: boolean;
    striped?: boolean;
    fixed?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
}

/**
 * DataTableView renders tabular data as a themed HTML table.
 *
 * It supports key/value tables (two columns, no header) and multi-column tables
 * (header row). The first column is styled as a muted label column by default.
 */
export class DataTableView extends ViewBase {
    columns: DataTableColumn[];
    rows: DataTableRow[];
    caption: DataTableCellValue;
    header: boolean | null;
    dense: boolean;
    striped: boolean;
    fixed: boolean;

    constructor({
        columns = [],
        rows = [],
        caption = null,
        header = null,
        dense = true,
        striped = false,
        fixed = false,
        title = 'Table',
        icon = null,
        id = null,
        logger = null,
    }: DataTableViewOptions = {}) {
        super({ title, icon, id, logger });
        this.columns = columns;
        this.rows = rows;
        this.caption = caption;
        this.header = header;
        this.dense = dense;
        this.striped = striped;
        this.fixed = fixed;
    }

    setColumns(columns: DataTableColumn[]): void {
        this.columns = columns;
        this._rerender();
    }

    setRows(rows: DataTableRow[]): void {
        this.rows = rows;
        this._rerender();
    }

    clearRows(): void {
        this.rows = [];
        this._rerender();
    }

    updateCell(rowIndex: number, colIndex: number, cell: DataTableCell): void {
        const row = this.rows[rowIndex];
        if (!row) {
            return;
        }

        if (!row.cells) {
            row.cells = [];
        }

        while (row.cells.length <= colIndex) {
            row.cells.push({ text: '' });
        }
        row.cells[colIndex] = cell;

        this._rerender();
    }

    render(container: HTMLElement): void {
        void container;

        const table = document.createElement('table');
        table.className = 'data-table-view';
        if (this.dense) {
            table.classList.add('data-table-view--dense');
        }
        if (this.striped) {
            table.classList.add('data-table-view--striped');
        }
        if (this.fixed) {
            table.style.tableLayout = 'fixed';
        }

        if (this.caption !== null && this.caption !== undefined) {
            const caption = document.createElement('caption');
            caption.textContent = this._stringify(this.caption);
            table.appendChild(caption);
        }

        if (this._shouldRenderHeader()) {
            table.appendChild(this._renderHeader());
        }

        const body = document.createElement('tbody');
        for (const row of this.rows) {
            body.appendChild(this._renderRow(row));
        }
        table.appendChild(body);

        this.mountContent(table);
        this._log('render', {
            columns: this.columns.length,
            rows: this.rows.length,
            header: this._shouldRenderHeader(),
        });
    }

    private _shouldRenderHeader(): boolean {
        if (this.header !== null) {
            return this.header;
        }
        return this.columns.some((column) => this._hasLabel(column.label));
    }

    private _renderHeader(): HTMLTableSectionElement {
        const head = document.createElement('thead');
        const row = document.createElement('tr');

        for (const column of this.columns) {
            const th = document.createElement('th');
            th.textContent = this._stringify(column.label);
            if (column.headerClassName) {
                th.className = column.headerClassName;
            }
            if (column.align) {
                th.style.textAlign = column.align;
            }
            row.appendChild(th);
        }

        head.appendChild(row);
        return head;
    }

    private _renderRow(data: DataTableRow): HTMLTableRowElement {
        const row = document.createElement('tr');
        if (data.className) {
            row.className = data.className;
        }

        const cells = this._resolveCells(data);
        this.columns.forEach((column, index) => {
            row.appendChild(this._renderCell(cells[index], column, index));
        });

        return row;
    }

    private _resolveCells(row: DataTableRow): Array<DataTableCellValue | Node | DataTableCell> {
        if (row.cells) {
            return row.cells;
        }
        if (row.record) {
            return this.columns.map((column) =>
                column.key ? (row.record?.[column.key] ?? null) : null
            );
        }
        return [];
    }

    private _renderCell(
        value: DataTableCellValue | Node | DataTableCell | undefined,
        column: DataTableColumn,
        index: number
    ): HTMLTableCellElement {
        const cell = this._toCell(value);
        const td = document.createElement('td');

        if (cell.text !== null && cell.text !== undefined) {
            td.textContent = this._stringify(cell.text);
        }
        if (cell.node) {
            td.appendChild(cell.node);
        }

        const classes: string[] = [];
        if (index === 0) {
            classes.push('data-table-view__cell--label');
        }
        if (column.cellClassName) {
            classes.push(column.cellClassName);
        }
        if (cell.className) {
            classes.push(cell.className);
        }
        if (classes.length) {
            td.className = classes.join(' ');
        }

        if (column.align) {
            td.style.textAlign = column.align;
        }
        if (cell.title) {
            td.title = cell.title;
        }
        if (cell.data) {
            for (const [key, value] of Object.entries(cell.data)) {
                td.dataset[key] = value;
            }
        }

        return td;
    }

    private _toCell(value: DataTableCellValue | Node | DataTableCell | undefined): DataTableCell {
        if (
            value &&
            typeof value === 'object' &&
            typeof (value as { nodeType?: unknown }).nodeType === 'number'
        ) {
            return { node: value as Node };
        }

        if (value && typeof value === 'object') {
            const record = value as DataTableCell;
            if (
                'text' in record ||
                'node' in record ||
                'title' in record ||
                'className' in record ||
                'data' in record
            ) {
                return record;
            }
        }

        return { text: value as DataTableCellValue };
    }

    private _hasLabel(value: DataTableCellValue): boolean {
        return value !== null && value !== undefined && String(value).trim().length > 0;
    }

    private _stringify(value: DataTableCellValue): string {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    }

    private _rerender(): void {
        if (this.container) {
            this.render(this.container);
        }
    }
}
