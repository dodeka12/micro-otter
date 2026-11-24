// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Container lifecycle regressions for TabbedView.
 *
 * Every attached view owns exactly one `.tabbed-view__view-container` wrapper. Removing or
 * replacing views must remove that wrapper too; an orphaned wrapper keeps flex space and makes
 * the surviving graph fill only half of the pane.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { TabbedView } from '../../src/micro_otter/nodes/html/js/views/tabbed-view.js';

class TestView extends ViewBase {
    render(container) {
        container.replaceChildren(document.createElement('div'));
    }
}

function makeViews(ids) {
    return ids.map((id) => new TestView({ id, title: id.toUpperCase() }));
}

describe('TabbedView view-container lifecycle', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
        global.requestAnimationFrame = () => 0;
        global.cancelAnimationFrame = () => {};

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        dom.window.close();
        global.window = undefined;
        global.document = undefined;
    });

    function wrappers() {
        return container.querySelectorAll('.tabbed-view__view-container');
    }

    it('keeps one wrapper after removing the active view', () => {
        const view = new TabbedView({
            views: makeViews(['graph-1', 'graph-2']),
            activeId: 'graph-1',
        });
        view.attachTo(container);
        view.selectView('graph-2');
        view.selectView('graph-1');

        assert.equal(wrappers().length, 2);

        const removed = view.removeView('graph-1');

        assert.ok(removed);
        assert.equal(wrappers().length, 1, 'Expected the removed view wrapper to be dropped');
        assert.equal(view.activeId, 'graph-2');
        assert.equal(view.views[0].container, wrappers()[0]);
        assert.equal(wrappers()[0].style.display, '');

        view.detach();
    });

    it('removes the wrapper of an inactive view without disturbing the active one', () => {
        const view = new TabbedView({
            views: makeViews(['graph-1', 'graph-2']),
            activeId: 'graph-1',
        });
        view.attachTo(container);
        view.selectView('graph-2');

        const activeWrapper = view.views[1].container;
        assert.equal(wrappers().length, 2);

        view.removeView('graph-1');

        assert.equal(wrappers().length, 1);
        assert.equal(wrappers()[0], activeWrapper);
        assert.equal(view.activeId, 'graph-2');

        view.detach();
    });

    it('replaces every old wrapper through setViews', () => {
        const view = new TabbedView({
            views: makeViews(['old-1', 'old-2']),
            activeId: 'old-1',
        });
        view.attachTo(container);
        view.selectView('old-2');
        assert.equal(wrappers().length, 2);

        view.setViews(makeViews(['new-1', 'new-2']), 'new-1');

        assert.equal(wrappers().length, 1, 'Expected setViews to remove old wrappers');
        assert.equal(view.activeId, 'new-1');
        assert.equal(wrappers()[0], view.views[0].container);

        view.detach();
    });

    it('leaves no wrapper behind when the last view is removed', () => {
        const view = new TabbedView({
            views: makeViews(['graph-1']),
            activeId: 'graph-1',
        });
        view.attachTo(container);

        view.removeView('graph-1');

        assert.equal(view.views.length, 0);
        assert.equal(view.activeId, null);
        assert.equal(wrappers().length, 0);

        view.detach();
    });
});
