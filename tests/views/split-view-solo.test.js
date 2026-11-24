// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file SplitView solo-request contract tests
 * Covers the `splitview:solo-request` pane-channel request used by CollapsibleView.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { SPLIT_VIEW_EVENTS, SplitView } from '../../src/micro_otter/nodes/html/js/views/split-view.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { CollapsibleView } from '../../src/micro_otter/nodes/html/js/views/collapsible-view.js';

class DummyView extends ViewBase {
    render(containerEl) {
        const el = document.createElement('div');
        el.className = 'dummy-view';
        containerEl.replaceChildren(el);
    }
}

describe('SplitView solo request contract', () => {
    let dom;
    let document;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
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

    it('publishes the solo-request event name', () => {
        assert.equal(SPLIT_VIEW_EVENTS.soloRequest, 'splitview:solo-request');
    });

    it('expands the requester and collapses the other collapsible panes', () => {
        const a = new CollapsibleView({ headerTitle: 'A', collapsed: true });
        const b = new CollapsibleView({ headerTitle: 'B' });
        const c = new CollapsibleView({ headerTitle: 'C', collapsed: true });
        const split = new SplitView({ id: 'split-root', views: [a, b, c] });
        split.attachTo(container);

        const detail = a.requestSplitViewSolo();

        assert.equal(detail.handled, true);
        assert.equal(detail.hosted, true);
        assert.equal(detail.hostId, 'split-root');
        assert.equal(detail.viewId, a.id);
        assert.equal(detail.paneIndex, 0);
        assert.deepEqual(detail.collapsedViewIds, [b.id, c.id]);
        assert.equal(a.collapsed, false, 'requester expands');
        assert.equal(b.collapsed, true, 'expanded sibling collapses');
        assert.equal(c.collapsed, true, 'already-collapsed sibling stays collapsed');
    });

    it('always dispatches, even when the requester is already expanded', () => {
        const a = new CollapsibleView({ headerTitle: 'A' });
        const b = new CollapsibleView({ headerTitle: 'B' });
        const split = new SplitView({ views: [a, b] });
        split.attachTo(container);

        let expandCalls = 0;
        const expand = a.expand.bind(a);
        a.expand = () => {
            expandCalls += 1;
            expand();
        };

        const detail = a.requestSplitViewSolo();

        assert.equal(expandCalls, 1, 'host applies expand through the public API');
        assert.equal(detail.handled, true);
        assert.equal(a.collapsed, false);
        assert.equal(b.collapsed, true, 'a second solo request re-collapses the sibling');
    });

    it('leaves non-collapsible panes untouched', () => {
        const a = new CollapsibleView({ headerTitle: 'A' });
        const dummy = new DummyView({ title: 'Dummy' });
        const split = new SplitView({ views: [a, dummy] });
        split.attachTo(container);

        const detail = a.requestSplitViewSolo();

        assert.equal(detail.handled, true);
        assert.deepEqual(detail.collapsedViewIds, []);
        assert.equal(a.collapsed, false);
        assert.ok(dummy.isAttached, 'non-collapsible pane keeps its state');
    });

    it('reports an unhandled request when the view is not hosted', () => {
        const a = new CollapsibleView({ headerTitle: 'A' });

        const detail = a.requestSplitViewSolo();

        assert.equal(detail.handled, false);
        assert.equal(detail.hosted, false);
    });

    it('stops handling requests after the pane is removed', () => {
        const a = new CollapsibleView({ headerTitle: 'A' });
        const b = new CollapsibleView({ headerTitle: 'B' });
        const split = new SplitView({ views: [a, b] });
        split.attachTo(container);

        split.removeView(a);
        const detail = a.requestSplitViewSolo();

        assert.equal(detail.handled, false);
        assert.equal(detail.hosted, false);
        assert.equal(b.collapsed, false);
    });

    it('reports the solo request as a layout change', () => {
        const a = new CollapsibleView({ headerTitle: 'A' });
        const b = new CollapsibleView({ headerTitle: 'B' });
        const split = new SplitView({ views: [a, b] });
        split.attachTo(container);

        const changes = [];
        split.on('layoutChange', (event) => {
            changes.push(event.detail);
        });

        a.requestSplitViewSolo();

        const soloChange = changes.find((change) => change.source === 'solo');
        assert.ok(soloChange, 'a solo-sourced layout change is emitted');
        assert.equal(soloChange.viewId, a.id);
        assert.equal(soloChange.count, 2);
    });

    it('keeps nested SplitViews independent', () => {
        const outerPane = new CollapsibleView({ headerTitle: 'Outer' });
        const innerA = new CollapsibleView({ headerTitle: 'Inner A' });
        const innerB = new CollapsibleView({ headerTitle: 'Inner B' });
        const innerSplit = new SplitView({ id: 'inner-split', views: [innerA, innerB] });
        const outerSplit = new SplitView({ id: 'outer-split', views: [outerPane, innerSplit] });
        outerSplit.attachTo(container);

        const detail = innerA.requestSplitViewSolo();

        assert.equal(detail.hostId, 'inner-split');
        assert.equal(innerB.collapsed, true);
        assert.equal(innerA.collapsed, false);
        assert.equal(outerPane.collapsed, false, 'outer pane is not part of the inner host');
    });
});
