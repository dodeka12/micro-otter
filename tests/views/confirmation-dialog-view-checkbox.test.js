// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for the optional checkbox of ConfirmationDialogView and for
// ViewManager.showConfirmationWithCheckbox(), which reports the dialog answer
// together with the checkbox state.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ConfirmationDialogView } from '../../src/micro_otter/nodes/html/js/views/confirmation-dialog-view.js';
import { ViewManager } from '../../src/micro_otter/nodes/html/js/views/view-manager.js';

describe('ConfirmationDialogView — optional checkbox', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    it('renders no checkbox when no label is supplied', () => {
        const dialog = new ConfirmationDialogView({ message: 'Plain confirmation' });
        dialog.attachTo(container);

        assert.equal(dialog.checkboxChecked, false);
        assert.equal(container.querySelectorAll('.confirmation-dialog__checkbox').length, 0);
    });

    it('renders the label text together with the checkbox', () => {
        const dialog = new ConfirmationDialogView({
            message: 'Shadow firmware?',
            checkboxLabel: 'Remember for this version',
        });
        dialog.attachTo(container);

        const option = container.querySelector('.confirmation-dialog__option');
        assert.ok(option, 'checkbox row must be rendered');
        assert.ok(option.textContent.includes('Remember for this version'));
        assert.equal(dialog.checkboxChecked, false);
    });

    it('honours the initial checked state', () => {
        const dialog = new ConfirmationDialogView({
            message: 'Shadow firmware?',
            checkboxLabel: 'Remember for this version',
            checkboxChecked: true,
        });
        dialog.attachTo(container);

        const checkbox = container.querySelector('.confirmation-dialog__checkbox');
        assert.equal(checkbox.checked, true);
        assert.equal(dialog.checkboxChecked, true);
    });

    it('reflects user interaction through the public accessor', () => {
        const dialog = new ConfirmationDialogView({
            message: 'Shadow firmware?',
            checkboxLabel: 'Remember for this version',
        });
        dialog.attachTo(container);

        const checkbox = container.querySelector('.confirmation-dialog__checkbox');
        checkbox.checked = true;
        assert.equal(dialog.checkboxChecked, true);
    });

    it('keeps the checkbox across serialize/deserialize', () => {
        const dialog = new ConfirmationDialogView({
            message: 'Shadow firmware?',
            checkboxLabel: 'Remember for this version',
            checkboxChecked: true,
        });

        const restored = ConfirmationDialogView.deserialize(dialog.serialize());

        assert.equal(restored.checkboxLabel, 'Remember for this version');
        assert.equal(restored.checkboxChecked, true);
    });

    it('serializes an absent checkbox as null', () => {
        const dialog = new ConfirmationDialogView({ message: 'Plain confirmation' });

        assert.equal(dialog.serialize().checkboxLabel, null);
        assert.equal(dialog.serialize().checkboxChecked, false);
    });

    it('renders an optional table through DataTableView', () => {
        const dialog = new ConfirmationDialogView({
            message: 'Outdated packages',
            table: {
                columns: [{ label: 'Package' }, { label: 'Firmware version' }, { label: 'Host version' }],
                rows: [{ cells: [{ text: 'vars' }, { text: '0.19.0' }, { text: '0.20.0' }] }],
            },
        });
        dialog.attachTo(container);

        const table = container.querySelector('.confirmation-dialog__table table.data-table-view');
        assert.ok(table, 'the table must render through DataTableView');
        assert.deepEqual(
            [...table.querySelectorAll('th')].map((cell) => cell.textContent),
            ['Package', 'Firmware version', 'Host version']
        );
        assert.deepEqual(
            [...table.querySelectorAll('td')].map((cell) => cell.textContent),
            ['vars', '0.19.0', '0.20.0']
        );

        dialog.detach();
    });
});


describe('ViewManager — showConfirmationWithCheckbox', () => {
    let dom;
    let container;
    let manager;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
        manager = new ViewManager({ mount: container });
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    it('resolves confirmed plus the ticked checkbox', async () => {
        const pending = manager.showConfirmationWithCheckbox({
            title: 'Shadow firmware?',
            message: 'Host sources will replace the firmware copy.',
            checkboxLabel: 'Remember for this version',
        });

        const checkbox = document.querySelector('.confirmation-dialog__checkbox');
        assert.ok(checkbox, 'checkbox must be rendered');
        checkbox.checked = true;
        document.querySelector('.modal-dialog__btn--primary').click();

        assert.deepEqual(await pending, { confirmed: true, checkboxChecked: true });
    });

    it('resolves confirmed plus the unticked checkbox', async () => {
        const pending = manager.showConfirmationWithCheckbox({
            title: 'Shadow firmware?',
            message: 'Host sources will replace the firmware copy.',
            checkboxLabel: 'Remember for this version',
        });

        document.querySelector('.modal-dialog__btn--primary').click();

        assert.deepEqual(await pending, { confirmed: true, checkboxChecked: false });
    });

    it('resolves confirmed=false on cancel', async () => {
        const pending = manager.showConfirmationWithCheckbox({
            title: 'Shadow firmware?',
            message: 'Host sources will replace the firmware copy.',
            checkboxLabel: 'Remember for this version',
        });

        document.querySelector('.modal-dialog__btn--ghost').click();

        assert.deepEqual(await pending, { confirmed: false, checkboxChecked: false });
    });

    it('keeps showConfirmation resolving a plain boolean', async () => {
        const pending = manager.showConfirmation({
            title: 'Delete file?',
            message: 'Cannot be undone.',
        });

        document.querySelector('.modal-dialog__btn--primary').click();

        assert.equal(await pending, true);
    });

    it('defaults disableEscape to false and honours true', () => {
        assert.equal(new ConfirmationDialogView({ message: 'a' }).disableEscape, false);
        assert.equal(new ConfirmationDialogView({ message: 'a', disableEscape: true }).disableEscape, true);
    });
});
