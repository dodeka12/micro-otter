// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Opt-in tab context-menu requests for TabbedView.
 *
 * TabbedView is generic: it only reports the clicked tab and viewport anchor. Consumers such as
 * CollectionView decide which actions belong in the menu.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AppEvent } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
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

describe('TabbedView tab context menu', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.Element = dom.window.Element;
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

    function createView({ tabContextMenu = true } = {}) {
        const view = new TabbedView({
            views: makeViews(['graph-1', 'graph-2']),
            activeId: 'graph-1',
            tabContextMenu,
        });
        view.attachTo(container);
        return view;
    }

    function tabFor(viewId) {
        return container.querySelector(`.tabbed-view__tab[data-view-id="${viewId}"]`);
    }

    it('emits TabContextMenu.v1 without changing the active tab', () => {
        const view = createView();
        const received = [];
        view.on('tab-context-menu', (event) => received.push(event));

        const event = new dom.window.MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 123,
            clientY: 45,
        });
        tabFor('graph-2').dispatchEvent(event);

        assert.equal(received.length, 1);
        const appEvent = received[0];
        assert.ok(appEvent instanceof AppEvent);
        assert.equal(appEvent.name, 'tab-context-menu');
        assert.equal(appEvent.detail.payloadTypeId, 'TabbedView.TabContextMenu.v1');
        assert.equal(appEvent.detail.viewId, 'graph-2');
        assert.equal(appEvent.detail.view, view.views[1]);
        assert.equal(appEvent.detail.clientX, 123);
        assert.equal(appEvent.detail.clientY, 45);
        assert.equal(appEvent.detail.nativeEvent, event);
        assert.equal(event.defaultPrevented, true);
        assert.equal(view.activeId, 'graph-1', 'Right-click must not activate the tab');

        view.detach();
    });

    it('supports Shift+F10 with the tab rectangle as anchor', () => {
        const view = createView();
        const received = [];
        view.on('tab-context-menu', (event) => received.push(event));

        const tab = tabFor('graph-1');
        tab.getBoundingClientRect = () => ({
            left: 20,
            right: 120,
            top: 10,
            bottom: 40,
            width: 100,
            height: 30,
            x: 20,
            y: 10,
            toJSON: () => ({}),
        });

        const event = new dom.window.KeyboardEvent('keydown', {
            key: 'F10',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        tab.dispatchEvent(event);

        assert.equal(received.length, 1);
        assert.equal(received[0].detail.viewId, 'graph-1');
        assert.equal(received[0].detail.clientX, 20);
        assert.equal(received[0].detail.clientY, 42);
        assert.equal(event.defaultPrevented, true);

        view.detach();
    });

    it('leaves the native context menu alone unless the feature is enabled', () => {
        const view = createView({ tabContextMenu: false });
        const received = [];
        view.on('tab-context-menu', (event) => received.push(event));

        const tab = tabFor('graph-1');
        assert.equal(tab.hasAttribute('aria-haspopup'), false);

        const event = new dom.window.MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 10,
            clientY: 20,
        });
        tab.dispatchEvent(event);

        assert.equal(received.length, 0);
        assert.equal(event.defaultPrevented, false);

        view.detach();
    });
});
