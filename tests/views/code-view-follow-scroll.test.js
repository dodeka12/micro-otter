// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { CodeView } from '../../src/micro_otter/nodes/html/js/views/code-view.js';
import { TextView } from '../../src/micro_otter/nodes/html/js/views/text-view.js';

/**
 * Stubbed text geometry. jsdom has no layout, so the scrollable height and the
 * visible height are fixed for every element in the document; the offset the
 * browser would clamp stays the plain value jsdom stores.
 */
const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 200;

/** Return the element `CodeView` scrolls inside. */
function codeScroller(container) {
    return container.querySelector('.view-code__scroll-wrapper');
}

describe('followed text updates', () => {
    let dom;
    let container;
    /** Visible height of every element; 0 models a collapsed log section. */
    let visibleHeight;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        visibleHeight = CLIENT_HEIGHT;

        Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get: () => (visibleHeight === 0 ? 0 : SCROLL_HEIGHT),
        });
        Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get: () => visibleHeight,
        });

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.document;
        delete global.HTMLElement;
        dom?.window?.close();
    });

    it('keeps the end of a followed CodeView in view, although the text is rebuilt', () => {
        const view = new CodeView({ language: 'text' });
        view.attachTo(container);

        const before = codeScroller(container);
        assert.ok(before, 'the code view renders a scroll wrapper');
        before.scrollTop = SCROLL_HEIGHT;
        assert.equal(before.scrollTop, SCROLL_HEIGHT);

        view.setCode('line 1\nline 2\nline 3\n', { follow: true });

        const after = codeScroller(container);
        assert.notEqual(after, before, 'an update re-renders the text into a new wrapper');
        assert.equal(after.textContent, 'line 1\nline 2\nline 3\n');
        assert.equal(after.scrollTop, SCROLL_HEIGHT, 'the tail stays in view');
    });

    it('holds the offset of a reader who scrolled back from the end', () => {
        const view = new CodeView({ language: 'text' });
        view.attachTo(container);

        codeScroller(container).scrollTop = 300;
        view.setCode('line 1\nline 2\n', { follow: true });

        assert.equal(codeScroller(container).scrollTop, 300);
    });

    it('snaps to the end while the reader sits just inside the follow tolerance', () => {
        const view = new CodeView({ language: 'text' });
        view.attachTo(container);

        // 40 px above the end of a 800 px range: still reading the tail.
        codeScroller(container).scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - 40;
        view.setCode('line 1\nline 2\n', { follow: true });

        assert.equal(codeScroller(container).scrollTop, SCROLL_HEIGHT);
    });

    it('holds a deliberately higher offset instead of jumping to the end', () => {
        const view = new CodeView({ language: 'text' });
        view.attachTo(container);

        // 100 px above the end: the reader deliberately scrolled up.
        codeScroller(container).scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - 100;
        view.setCode('line 1\nline 2\n', { follow: true });

        assert.equal(codeScroller(container).scrollTop, SCROLL_HEIGHT - CLIENT_HEIGHT - 100);
    });

    it('keeps following across a collapsed section that had no geometry', () => {
        const view = new CodeView({ language: 'text' });
        view.attachTo(container);

        // Collapsed: the box reports 0/0/0, so the only record that the log is
        // being followed is the offset the last update pinned.
        visibleHeight = 0;
        view.setCode('line 1\n', { follow: true });
        assert.equal(codeScroller(container).scrollTop, 0);

        // Expanded again: the next update goes back to the tail.
        visibleHeight = CLIENT_HEIGHT;
        view.setCode('line 1\nline 2\n', { follow: true });
        assert.equal(codeScroller(container).scrollTop, SCROLL_HEIGHT);
    });

    it('starts an unfollowed update again from the top', () => {
        const view = new CodeView({ language: 'text' });
        view.attachTo(container);

        codeScroller(container).scrollTop = 400;
        view.setCode('replacement\n');

        assert.equal(codeScroller(container).scrollTop, 0);
    });

    it('follows the scroll element of a TextView', () => {
        const view = new TextView({ text: 'first' });
        view.attachTo(container);

        const before = container.firstElementChild;
        before.scrollTop = SCROLL_HEIGHT;
        view.setText('first\nsecond\n', { follow: true });

        const after = container.firstElementChild;
        assert.notEqual(after, before);
        assert.equal(after.scrollTop, SCROLL_HEIGHT);
    });
});
