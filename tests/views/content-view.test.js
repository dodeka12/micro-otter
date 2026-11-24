// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ContentView } from '../../src/micro_otter/nodes/html/js/views/content-view.js';

describe('ContentView', () => {
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

    it('throws when renderFn is missing', () => {
        assert.throws(() => new ContentView(), /renderFn function/);
    });

    it('throws when renderFn does not return an HTMLElement', () => {
        const view = new ContentView({ renderFn: () => 'not-an-element' });

        assert.throws(() => view.attachTo(container), /must return an HTMLElement/);
    });

    it('renders content inside content-view-wrapper', () => {
        const view = new ContentView({
            renderFn: () => {
                const el = document.createElement('div');
                el.className = 'inner-content';
                el.textContent = 'Hello ContentView';
                return el;
            },
        });

        view.attachTo(container);

        const wrapper = container.querySelector('.content-view-wrapper');
        const content = container.querySelector('.inner-content');

        assert.ok(wrapper, 'wrapper should exist');
        assert.ok(content, 'rendered content should exist');
        assert.equal(content.textContent, 'Hello ContentView');
    });

    it('invokes renderFn each time it attaches', () => {
        let renderCount = 0;
        const view = new ContentView({
            renderFn: () => {
                renderCount += 1;
                const el = document.createElement('div');
                el.textContent = `render-${renderCount}`;
                return el;
            },
        });

        view.attachTo(container);
        assert.equal(renderCount, 1);

        view.detach();
        view.attachTo(container);
        assert.equal(renderCount, 2);
    });
});
