// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { DataTableView } from '../../src/micro_otter/nodes/html/js/views/data-table-view.js';

describe('DataTableView', () => {
    let dom;
    let document;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        document = dom.window.document;

        global.document = document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
        dom?.window?.close();
    });

    it('renders key/value rows without a header', () => {
        const view = new DataTableView({
            columns: [{ label: '' }, { label: '' }],
            rows: [
                { cells: [{ text: 'Name' }, { text: 'Alice' }] },
                { cells: [{ text: 'Age' }, { text: 42 }] },
            ],
        });
        view.attachTo(container);

        assert.equal(container.querySelector('thead'), null);

        const rows = container.querySelectorAll('tbody tr');
        assert.equal(rows.length, 2);

        const firstCell = rows[0].querySelector('td');
        assert.equal(firstCell.textContent, 'Name');
        assert.ok(firstCell.classList.contains('data-table-view__cell--label'));
        assert.equal(rows[1].querySelectorAll('td')[1].textContent, '42');
    });

    it('renders a header when columns have labels', () => {
        const view = new DataTableView({
            columns: [{ label: 'Package' }, { label: 'Version' }],
            rows: [{ cells: [{ text: 'core' }, { text: '1.0.0' }] }],
        });
        view.attachTo(container);

        const thead = container.querySelector('thead');
        assert.ok(thead);

        const headers = Array.from(thead.querySelectorAll('th')).map((th) => th.textContent);
        assert.deepEqual(headers, ['Package', 'Version']);
    });

    it('resolves record-based rows by column key', () => {
        const view = new DataTableView({
            columns: [{ key: 'name', label: 'Name' }, { key: 'version', label: 'Version' }],
            rows: [{ record: { name: 'webview', version: '1.2.0' } }],
        });
        view.attachTo(container);

        const cells = Array.from(container.querySelectorAll('tbody tr td')).map(
            (td) => td.textContent
        );
        assert.deepEqual(cells, ['webview', '1.2.0']);
    });

    it('applies dense, striped and caption options', () => {
        const view = new DataTableView({
            caption: 'Summary',
            columns: [{ label: '' }, { label: '' }],
            rows: [{ cells: [{ text: 'A' }, { text: 'B' }] }],
            striped: true,
        });
        view.attachTo(container);

        const table = container.querySelector('table');
        assert.ok(table.classList.contains('data-table-view'));
        assert.ok(table.classList.contains('data-table-view--dense'));
        assert.ok(table.classList.contains('data-table-view--striped'));
        assert.equal(table.querySelector('caption').textContent, 'Summary');
    });
});
