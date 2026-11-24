// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for the header icon of ModalDialogView: it accepts an `IconProvider` value (an
// inlined `data:` URI), a served path, or a text/emoji glyph, and it must never print a
// registered icon's base64 document as text.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ModalDialogView } from '../../src/micro_otter/nodes/html/js/views/modal-dialog-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

/**
 * Minimal dialog subclass, because `ModalDialogView._buildBody()` is abstract.
 */
class IconDialogFixture extends ModalDialogView {
    /**
     * @returns {HTMLElement} Body element of the fixture dialog.
     */
    _buildBody() {
        const body = document.createElement('div');
        body.className = 'icon-dialog-fixture__body';
        return body;
    }
}

describe('ModalDialogView — header icon', () => {
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
     * Attach a fixture dialog carrying the given icon.
     * @param {string|null} icon Icon value.
     * @returns {HTMLElement} The `.modal-dialog__icon` host element.
     */
    function attachWithIcon(icon) {
        const dialog = new IconDialogFixture({ title: 'Fixture', icon });
        dialog.attachTo(container);
        return container.querySelector('.modal-dialog__icon');
    }

    it('renders an inlined IconProvider value as an image, never as text', () => {
        const iconEl = attachWithIcon(IconProvider.cable);

        const img = iconEl.querySelector('img.modal-dialog__icon-img');
        assert.ok(img, 'the header icon must render an <img>');
        assert.equal(img.getAttribute('src'), IconProvider.cable);
        assert.equal(iconEl.textContent, '', 'no base64 document may appear as text');
    });

    it('keeps a text or emoji glyph as text', () => {
        const iconEl = attachWithIcon('🔌');

        assert.equal(iconEl.textContent, '🔌');
        assert.equal(iconEl.querySelector('img'), null);
    });

    it('hides the icon host when no icon is supplied', () => {
        const iconEl = attachWithIcon(null);

        assert.equal(iconEl.style.display, 'none');
        assert.equal(iconEl.children.length, 0);
    });

    it('marks the icon host as decorative', () => {
        const iconEl = attachWithIcon(IconProvider.cable);

        assert.equal(iconEl.getAttribute('aria-hidden'), 'true');
        assert.equal(iconEl.querySelector('img').getAttribute('alt'), '');
    });
});
