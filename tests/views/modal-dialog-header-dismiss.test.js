// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for the optional header dismiss button of ModalDialogView: every existing dialog keeps
// its `×`, while a dialog that reports a running, non-cancellable operation passes
// `showDismiss: false` and is closed only programmatically.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ModalDialogView } from '../../src/micro_otter/nodes/html/js/views/modal-dialog-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

/**
 * Minimal dialog subclass, because `ModalDialogView._buildBody()` is abstract.
 */
class BodyOnlyDialogFixture extends ModalDialogView {
    /**
     * @returns {HTMLElement} Empty body element of the fixture dialog.
     */
    _buildBody() {
        const body = document.createElement('div');
        body.className = 'body-only-dialog-fixture__body';
        return body;
    }
}

/**
 * Fixture with neither a dismiss button nor footer buttons, so the dialog has zero focusable
 * elements — the state a header-only progress dialog is in.
 */
class HeaderOnlyDialogFixture extends BodyOnlyDialogFixture {
    /**
     * @returns {HTMLElement} Empty footer, so the dialog has no focusable elements at all.
     */
    _buildFooter() {
        const footer = document.createElement('div');
        footer.className = 'header-only-dialog-fixture__footer';
        footer.hidden = true;
        return footer;
    }
}

describe('ModalDialogView — header dismiss button', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
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

    /**
     * Attach a fixture dialog and return it.
     * @param {object} [options] Fixture options forwarded to the constructor.
     * @returns {BodyOnlyDialogFixture} The attached dialog.
     */
    function mount(options = {}) {
        const dialog = new BodyOnlyDialogFixture({
            title: 'Fixture',
            autofocus: false,
            ...options,
        });
        dialog.attachTo(container);
        return dialog;
    }

    /**
     * Collect the names of the view events emitted while `action` runs.
     * @param {BodyOnlyDialogFixture} dialog Attached dialog.
     * @param {() => void} action Action that should emit the events.
     * @returns {string[]} Emitted event names in order.
     */
    function recordEvents(dialog, action) {
        const seen = [];
        for (const name of ['confirm', 'cancel', 'close']) {
            dialog.on(name, () => seen.push(name));
        }
        action();
        return seen;
    }

    /**
     * Dispatch a keydown event on the dialog element.
     * @param {string} key Key name, e.g. `Escape` or `Tab`.
     * @param {object} [init] Extra `KeyboardEvent` fields.
     */
    function pressKey(key, init = {}) {
        const modal = container.querySelector('.modal-dialog');
        modal.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', { key, bubbles: true, ...init })
        );
    }

    it('renders one dismiss button by default and serializes showDismiss as true', () => {
        const dialog = mount();

        const buttons = container.querySelectorAll('.modal-dialog__btn--icon');
        assert.equal(buttons.length, 1, 'exactly one dismiss button');
        assert.equal(buttons[0].textContent, '×');
        assert.equal(buttons[0].getAttribute('title'), 'Close dialog');
        assert.equal(dialog.showDismiss, true);
        assert.equal(dialog.serialize().showDismiss, true);
    });

    it('renders no dismiss button when showDismiss is false, keeping icon and title', () => {
        mount({ showDismiss: false, icon: IconProvider.cable });

        assert.equal(
            container.querySelector('.modal-dialog__btn--icon'),
            null,
            'no close affordance for a non-cancellable operation'
        );
        assert.ok(container.querySelector('.modal-dialog__icon img'), 'header icon still rendered');
        assert.equal(
            container.querySelector('.modal-dialog__title').textContent,
            'Fixture',
            'title still rendered'
        );
    });

    it('reports showDismiss false from serialize()', () => {
        const dialog = mount({ showDismiss: false });

        assert.equal(dialog.showDismiss, false);
        assert.equal(dialog.serialize().showDismiss, false);
    });

    it('keeps the Escape-to-cancel policy independent of showDismiss', () => {
        const dialog = mount({ showDismiss: false });

        const events = recordEvents(dialog, () => pressKey('Escape'));

        assert.deepEqual(events, ['cancel', 'close'], 'no × button, but Escape still cancels');
    });

    it('does not throw on Tab when the dialog has no focusable elements', () => {
        const dialog = new HeaderOnlyDialogFixture({
            title: 'Fixture',
            showDismiss: false,
            autofocus: false,
        });
        dialog.attachTo(container);
        const before = document.activeElement;

        assert.doesNotThrow(() => pressKey('Tab'));

        assert.equal(document.activeElement, before, 'focus does not move out of an empty trap');
    });

    it('still emits close when a non-dismissible dialog is closed programmatically', () => {
        const dialog = mount({ showDismiss: false });

        const events = recordEvents(dialog, () => dialog.close());

        assert.deepEqual(events, ['close']);
    });
});
