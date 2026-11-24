// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ButtonControl } from '../../src/micro_otter/nodes/html/js/views/controls/custom-runtime-controls.js';

describe('ButtonControl.setIcon', () => {
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

    /**
     * Find the rendered glyph.
     * @param {HTMLElement} host Render host.
     * @returns {HTMLImageElement | null} The glyph image, if any.
     */
    function glyph(host) {
        return host.querySelector('.custom-control__button-icon');
    }

    it('renders the initial glyph before the label', () => {
        const control = new ButtonControl({ label: 'Build', icon: '/a.svg' });
        control.render(container);

        const image = glyph(container);
        assert.ok(image);
        assert.ok(image.getAttribute('src').endsWith('/a.svg'));

        const children = [...container.querySelector('button').children];
        assert.equal(children.indexOf(image), 0);
        assert.equal(children[1].className, 'custom-control__button-label');
    });

    it('swaps the glyph without recreating the button', () => {
        const control = new ButtonControl({ label: 'Build', icon: '/a.svg' });
        control.render(container);
        const button = container.querySelector('button');
        const image = glyph(container);

        control.setIcon('/b.svg');

        assert.equal(container.querySelector('button'), button);
        assert.equal(glyph(container), image);
        assert.ok(image.getAttribute('src').endsWith('/b.svg'));
        assert.equal(button.querySelectorAll('.custom-control__button-icon').length, 1);
    });

    it('adds a glyph to a button rendered without one', () => {
        const control = new ButtonControl({ label: 'Build' });
        control.render(container);
        assert.equal(glyph(container), null);

        control.setIcon('/b.svg');

        const button = container.querySelector('button');
        const image = glyph(container);
        assert.ok(image);
        assert.ok(image.getAttribute('src').endsWith('/b.svg'));
        assert.equal([...button.children].indexOf(image), 0);
        assert.equal(button.children[1].className, 'custom-control__button-label');
    });

    it('removes the glyph when the icon is null', () => {
        const control = new ButtonControl({ label: 'Build', icon: '/a.svg' });
        control.render(container);

        control.setIcon(null);

        assert.equal(glyph(container), null);
        assert.equal(container.querySelector('.custom-control__button-label').textContent, 'Build');
    });

    it('treats a blank icon as no glyph', () => {
        const control = new ButtonControl({ label: 'Build', icon: '/a.svg' });
        control.render(container);

        control.setIcon('   ');

        assert.equal(glyph(container), null);
    });

    it('stores the icon when called before render', () => {
        const control = new ButtonControl({ label: 'Build' });
        assert.doesNotThrow(() => control.setIcon('/c.svg'));

        control.render(container);

        const image = glyph(container);
        assert.ok(image);
        assert.ok(image.getAttribute('src').endsWith('/c.svg'));
    });

    it('keeps the accessible name of an icon-only button', () => {
        const control = new ButtonControl({ label: 'Cancel', icon: '/a.svg', iconOnly: true });
        control.render(container);
        const button = container.querySelector('button');

        control.setIcon('/close.svg');

        assert.equal(button.title, 'Cancel');
        assert.equal(button.getAttribute('aria-label'), 'Cancel');
        assert.equal(button.querySelectorAll('.custom-control__button-label').length, 0);
        assert.ok(glyph(button).getAttribute('src').endsWith('/close.svg'));
    });
});
