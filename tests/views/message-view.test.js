// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file MessageView tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { MessageView } from '../../src/micro_otter/nodes/html/js/views/message-view.js';

describe('MessageView', () => {
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

    it('renders plain default text', () => {
        const view = new MessageView({ text: 'Hello' });
        view.attachTo(container);

        const root = container.querySelector('.message-view');
        assert.equal(root.textContent, 'Hello');
        assert.ok(root.classList.contains('message-view--default'));
        assert.ok(root.classList.contains('message-view--plain'));
        assert.equal(root.hasAttribute('role'), false);
    });

    it('applies tone, variant, and role', () => {
        const view = new MessageView({
            text: 'Failed',
            tone: 'error',
            variant: 'panel',
            role: 'alert',
        });
        view.attachTo(container);

        const root = container.querySelector('.message-view');
        assert.ok(root.classList.contains('message-view--error'));
        assert.ok(root.classList.contains('message-view--panel'));
        assert.equal(root.getAttribute('role'), 'alert');
        assert.equal(root.getAttribute('aria-live'), 'assertive');
    });

    it('updates text and presentation in place', () => {
        const view = new MessageView();
        view.attachTo(container);

        view.setText('Loading');
        view.setTone('info');
        view.setVariant('panel');
        view.setRole('status');

        const root = container.querySelector('.message-view');
        assert.equal(root.textContent, 'Loading');
        assert.ok(root.classList.contains('message-view--info'));
        assert.ok(root.classList.contains('message-view--panel'));
        assert.equal(root.getAttribute('role'), 'status');
        assert.equal(root.getAttribute('aria-live'), 'polite');
    });

    it('hides and shows the message', () => {
        const view = new MessageView({ text: 'Hidden', hidden: true });
        view.attachTo(container);

        const root = container.querySelector('.message-view');
        assert.equal(root.hidden, true);

        view.setHidden(false);
        assert.equal(root.hidden, false);
    });

    it('can remove the role again', () => {
        const view = new MessageView({ role: 'status' });
        view.attachTo(container);

        view.setRole('none');
        const root = container.querySelector('.message-view');
        assert.equal(root.hasAttribute('role'), false);
        assert.equal(root.hasAttribute('aria-live'), false);
    });
});
