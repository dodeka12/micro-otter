// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ButtonControl } from '../../src/micro_otter/nodes/html/js/views/controls/custom-runtime-controls.js';

describe('ButtonControl.setLabel', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.HTMLButtonElement = dom.window.HTMLButtonElement;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
        delete global.HTMLButtonElement;
        dom?.window?.close();
    });

    it('renders the initial label', () => {
        const control = new ButtonControl({ label: 'Start' });
        control.render(container);
        assert.equal(container.querySelector('.custom-control__button-label').textContent, 'Start');
    });

    it('updates the visible label without recreating the button', () => {
        const control = new ButtonControl({ label: 'Start' });
        control.render(container);
        const button = container.querySelector('button');

        control.setLabel('Cancel');
        assert.equal(button.querySelector('.custom-control__button-label').textContent, 'Cancel');
        assert.equal(container.querySelector('button'), button);
    });

    it('refreshes title and aria-label for icon-only buttons', () => {
        const control = new ButtonControl({ label: 'Close', iconOnly: true });
        control.render(container);
        const button = container.querySelector('button');
        assert.equal(button.getAttribute('aria-label'), 'Close');

        control.setLabel('Open');
        assert.equal(button.title, 'Open');
        assert.equal(button.getAttribute('aria-label'), 'Open');
    });

    it('is a no-op before render', () => {
        const control = new ButtonControl({ label: 'Start' });
        assert.doesNotThrow(() => control.setLabel('Cancel'));
    });
});
