// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { FormDialogView } from '../../src/micro_otter/nodes/html/js/views/form-dialog-view.js';

describe('FormDialogView helpers', () => {
    let dom;
    let document;
    let window;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;
        global.HTMLElement = window.HTMLElement;
        global.HTMLInputElement = window.HTMLInputElement;
        global.HTMLSelectElement = window.HTMLSelectElement;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
        delete global.HTMLInputElement;
        delete global.HTMLSelectElement;
    });

    it('returns field values from getFieldValue()', () => {
        const dialog = new FormDialogView({
            title: 'Test',
            fields: [
                {
                    id: 'name',
                    type: 'text',
                    label: 'Name',
                    defaultValue: 'Alpha',
                },
                {
                    id: 'runtime',
                    type: 'dropdown',
                    label: 'Runtime',
                    options: [
                        { value: 'general', label: 'General' },
                        { value: 'custom', label: 'Custom' },
                    ],
                    defaultValue: 'custom',
                },
                {
                    id: 'active',
                    type: 'checkbox',
                    label: 'Active',
                    defaultValue: true,
                },
            ],
        });

        dialog.attachTo(container);

        assert.equal(dialog.getFieldValue('name'), 'Alpha');
        assert.equal(dialog.getFieldValue('runtime'), 'custom');
        assert.equal(dialog.getFieldValue('active'), true);
        assert.equal(dialog.getFieldValue('missing'), null);
    });

    it('fires onFieldChange() handlers for dropdowns', () => {
        const dialog = new FormDialogView({
            title: 'Test',
            fields: [
                {
                    id: 'runtime',
                    type: 'dropdown',
                    label: 'Runtime',
                    options: [
                        { value: 'general', label: 'General' },
                        { value: 'custom', label: 'Custom' },
                    ],
                    defaultValue: 'general',
                },
            ],
        });

        dialog.attachTo(container);

        let lastValue = null;
        dialog.onFieldChange('runtime', ({ value }) => {
            lastValue = value;
        });

        const select = container.querySelector('select');
        select.value = 'custom';
        select.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(lastValue, 'custom');
    });

    it('updates dropdown options via setDropdownOptions()', () => {
        const dialog = new FormDialogView({
            title: 'Test',
            fields: [
                {
                    id: 'target',
                    type: 'dropdown',
                    label: 'Target',
                    options: [{ value: 'esp32', label: 'ESP32' }],
                    defaultValue: 'esp32',
                },
            ],
        });

        dialog.attachTo(container);

        const updated = dialog.setDropdownOptions(
            'target',
            [
                { value: 'nano', label: 'Nano' },
                { value: 'pico', label: 'Pico' },
            ],
            { includeEmpty: false, selectedValue: 'pico' }
        );

        assert.equal(updated, true);

        const select = container.querySelector('select');
        assert.ok(select, 'Select element should exist');
        assert.equal(select.options.length, 2);
        assert.equal(select.value, 'pico');
        assert.equal(dialog.getFieldValue('target'), 'pico');
    });

    it('renders a field description as an aria-describedby hint', () => {
        const dialog = new FormDialogView({
            title: 'Test',
            fields: [
                {
                    id: 'forceUpload',
                    type: 'checkbox',
                    label: 'Force upload',
                    description: 'Rewrites every deployed file.',
                    defaultValue: false,
                },
            ],
        });

        dialog.attachTo(container);

        const input = container.querySelector('#form-field-forceUpload');
        const hint = container.querySelector('.form-dialog__field-hint');
        assert.ok(input, 'the checkbox must be rendered');
        assert.ok(hint, 'the description must be rendered as a hint');
        assert.equal(hint.textContent, 'Rewrites every deployed file.');
        assert.ok(
            hint.classList.contains('form-dialog__field-hint--checkbox'),
            'checkbox hints are indented under the label'
        );
        assert.equal(input.getAttribute('aria-describedby'), hint.id);
        assert.equal(dialog.getFieldValue('forceUpload'), false);
    });

    it('renders no hint when a field has no description', () => {
        const dialog = new FormDialogView({
            title: 'Test',
            fields: [
                {
                    id: 'name',
                    type: 'text',
                    label: 'Name',
                    defaultValue: 'Alpha',
                },
            ],
        });

        dialog.attachTo(container);

        assert.equal(container.querySelector('.form-dialog__field-hint'), null);
        const input = container.querySelector('#form-field-name');
        assert.equal(input.getAttribute('aria-describedby'), null);
    });
});
