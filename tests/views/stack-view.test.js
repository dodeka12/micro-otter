// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file StackView tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { StackView } from '../../src/micro_otter/nodes/html/js/views/stack-view.js';
import { TextView } from '../../src/micro_otter/nodes/html/js/views/text-view.js';

describe('StackView', () => {
    let dom;
    let document;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        document = dom.window.document;

        global.window = dom.window;
        global.document = document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        dom?.window?.close();
    });

    it('renders a vertical stack by default with theme spacing', () => {
        const stack = new StackView({ gap: 8, padding: 6 });
        stack.attachTo(container);

        const root = container.querySelector('.stack-view');
        assert.ok(root.classList.contains('stack-view--vertical'));
        assert.equal(root.style.getPropertyValue('--stack-view-gap'), '8px');
        assert.equal(root.style.getPropertyValue('--stack-view-padding'), '6px');
        assert.equal(root.style.alignItems, 'stretch');
    });

    it('renders a horizontal wrapping stack with a fill modifier', () => {
        const stack = new StackView({
            orientation: 'horizontal',
            wrap: true,
            fill: true,
            align: 'flex-end',
        });
        stack.attachTo(container);

        const root = container.querySelector('.stack-view');
        assert.ok(root.classList.contains('stack-view--horizontal'));
        assert.ok(root.classList.contains('stack-view--wrap'));
        assert.ok(root.classList.contains('stack-view--fill'));
        assert.equal(root.style.alignItems, 'flex-end');
    });

    it('attaches view children and raw elements', () => {
        const stack = new StackView();
        const text = new TextView({ text: 'child' });
        const element = document.createElement('div');
        element.className = 'raw-child';

        stack.addView(text, { itemId: 'text' });
        stack.addElement(element, { itemId: 'raw' });
        stack.attachTo(container);

        assert.ok(text.isAttached, 'view child is attached');
        assert.equal(container.querySelector('.view-text').textContent, 'child');
        assert.ok(container.querySelector('.raw-child'));
        assert.ok(container.querySelector('[data-item-id="text"]'));
        assert.ok(container.querySelector('[data-item-id="raw"]'));
    });

    it('applies hidden, grow, and width to an item', () => {
        const stack = new StackView({ orientation: 'horizontal' });
        const element = document.createElement('input');
        element.dataset.controlId = 'name';
        const item = stack.addElement(element, { itemId: 'name', grow: true, width: 120 });
        stack.attachTo(container);

        assert.ok(item.element.classList.contains('stack-view__item--grow'));
        assert.ok(item.element.classList.contains('stack-view__item--fixed'));
        assert.equal(item.element.style.width, '120px');

        item.setHidden(true);
        assert.equal(item.element.hidden, true);
        assert.equal(element.hidden, true);
        assert.ok(container.querySelector('[data-control-id="name"][hidden]'));

        item.setHidden(false);
        item.setGrow(false);
        item.setWidth(null);
        assert.equal(item.element.hidden, false);
        assert.equal(element.hidden, false);
        assert.equal(item.element.classList.contains('stack-view__item--grow'), false);
        assert.equal(item.element.classList.contains('stack-view__item--fixed'), false);
        assert.equal(item.element.style.width, '');
    });

    it('supports the striped variant', () => {
        const stack = new StackView({ striped: true });
        stack.addElement(document.createElement('div'));
        stack.attachTo(container);

        assert.ok(container.querySelector('.stack-view--striped'));
    });

    it('detaches child views and clears items', () => {
        const stack = new StackView();
        const text = new TextView({ text: 'child' });
        stack.addView(text);
        stack.attachTo(container);

        stack.detach();

        assert.equal(text.isAttached, false);
    });
});
