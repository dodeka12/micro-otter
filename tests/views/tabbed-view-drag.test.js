// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Pointer and keyboard reordering interaction for TabbedView.
 *
 * JSDOM has no PointerEvent constructor, so tests build plain Events and define the
 * pointer fields explicitly. The implementation deliberately avoids `setPointerCapture`
 * and uses window listeners, which keeps this style of test representative.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { TabbedView } from '../../src/micro_otter/nodes/html/js/views/tabbed-view.js';

class TestView extends ViewBase {
    constructor(options = {}) {
        super(options);
        if (options.movable !== undefined) {
            this.movable = options.movable;
        }
    }

    render(container) {
        container.replaceChildren(document.createElement('div'));
    }
}

function makeViews(ids) {
    return ids.map((id) => new TestView({ id, title: id.toUpperCase() }));
}

function idsOf(view) {
    return view.views.map((entry) => entry.id);
}

describe('TabbedView tab drag interaction', () => {
    let dom;
    let container;
    let attached;

    function createView(ids = ['v0', 'v1', 'v2', 'v3'], options = {}) {
        const view = new TabbedView({
            views: makeViews(ids),
            activeId: ids[0],
            reorderable: true,
            ...options,
        });
        view.attachTo(container);
        attached.push(view);
        return view;
    }

    function stubHorizontalRects() {
        const tabs = Array.from(container.querySelectorAll('.tabbed-view__tab[data-view-id]'));
        tabs.forEach((tab, index) => {
            tab.getBoundingClientRect = () => ({
                left: index * 100,
                right: (index + 1) * 100,
                top: 0,
                bottom: 30,
            });
        });
        return tabs;
    }

    function stubVerticalRects() {
        const tabs = Array.from(container.querySelectorAll('.tabbed-view__tab[data-view-id]'));
        tabs.forEach((tab, index) => {
            tab.getBoundingClientRect = () => ({
                left: 0,
                right: 30,
                top: index * 100,
                bottom: (index + 1) * 100,
            });
        });
        return tabs;
    }

    function tabFor(viewId) {
        return container.querySelector(`.tabbed-view__tab[data-view-id="${viewId}"]`);
    }

    function startDrag(view, viewId, { x = 10, y = 10, pointerId = 1, target = null } = {}) {
        view._beginTabDrag(
            {
                button: 0,
                isPrimary: true,
                pointerId,
                clientX: x,
                clientY: y,
                target: target ?? tabFor(viewId),
            },
            viewId
        );
    }

    function firePointer(type, { x = 0, y = 0, pointerId = 1 } = {}) {
        const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clientX', { value: x });
        Object.defineProperty(event, 'clientY', { value: y });
        Object.defineProperty(event, 'pointerId', { value: pointerId });
        dom.window.dispatchEvent(event);
        return event;
    }

    function fireKey(target, key, options = {}) {
        const event = new dom.window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...options,
        });
        target.dispatchEvent(event);
        return event;
    }

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
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

        container = document.createElement('div');
        document.body.appendChild(container);
        attached = [];
    });

    afterEach(() => {
        attached?.forEach((view) => {
            view._cancelTabDrag();
            view.detach();
        });
        container?.remove();
        dom.window.close();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.Element;
        delete global.EventTarget;
        delete global.ResizeObserver;
    });

    it('records an inactive drag and cancels cleanly', () => {
        const view = createView();
        stubHorizontalRects();

        startDrag(view, 'v0');

        assert.equal(view._tabDragState.viewId, 'v0');
        assert.equal(view._tabDragState.active, false);
        assert.ok(view._tabDragMoveHandler);
        assert.ok(view._tabDragEndHandler);
        assert.ok(view._tabDragCancelHandler);
        assert.ok(view._tabDragKeyHandler);
        assert.ok(view._tabDragBlurHandler);

        view._cancelTabDrag();

        assert.equal(view._tabDragState, null);
        assert.equal(view._tabDragMoveHandler, null);
        assert.equal(view._tabDragEndHandler, null);
        assert.equal(view._tabDragCancelHandler, null);
        assert.equal(view._tabDragKeyHandler, null);
        assert.equal(view._tabDragBlurHandler, null);
        assert.equal(view._host.classList.contains('tabbed-view--dragging'), false);

        firePointer('pointermove', { x: 300, y: 10 });
        firePointer('pointerup', { x: 300, y: 10 });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
    });

    it('is a no-op when no drag is active', () => {
        const view = createView();
        assert.doesNotThrow(() => view._cancelTabDrag());
        assert.equal(view._tabDragState, null);
    });

    it('cancels on Escape, pointercancel and window blur', () => {
        for (const cancel of ['escape', 'pointercancel', 'blur']) {
            const view = createView();
            stubHorizontalRects();
            startDrag(view, 'v0');
            firePointer('pointermove', { x: 300, y: 10 });
            assert.equal(view._tabDragState.active, true);

            if (cancel === 'escape') {
                dom.window.dispatchEvent(
                    new dom.window.KeyboardEvent('keydown', {
                        key: 'Escape',
                        bubbles: true,
                        cancelable: true,
                    })
                );
            } else if (cancel === 'pointercancel') {
                firePointer('pointercancel', { pointerId: 1 });
            } else {
                dom.window.dispatchEvent(new dom.window.Event('blur'));
            }

            assert.equal(view._tabDragState, null);
            assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
            view.detach();
            attached = attached.filter((entry) => entry !== view);
        }
    });

    it('cancels an in-flight drag before detaching', () => {
        const view = createView();
        stubHorizontalRects();
        startDrag(view, 'v0');
        firePointer('pointermove', { x: 300, y: 10 });

        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        view.detach();
        attached = attached.filter((entry) => entry !== view);

        assert.equal(view._tabDragState, null);
        assert.equal(view._tabDragMoveHandler, null);
        firePointer('pointermove', { x: 390, y: 10 });
        firePointer('pointerup', { x: 390, y: 10 });
        assert.equal(events.length, 0);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
    });

    it('leaves order, active id and tab state untouched when cancelled', () => {
        const view = createView();
        stubHorizontalRects();
        view.setViewMovable('v2', false);
        const movableBefore = view.views.map((entry) => view.isViewMovable(entry.id));
        const activeBefore = view.activeId;

        startDrag(view, 'v0');
        firePointer('pointermove', { x: 390, y: 10 });
        view._cancelTabDrag();

        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
        assert.equal(view.activeId, activeBefore);
        assert.deepEqual(
            view.views.map((entry) => view.isViewMovable(entry.id)),
            movableBefore
        );
    });


    it('computes insertion gaps from horizontal tab midpoints', () => {
        const view = createView();
        stubHorizontalRects();

        assert.equal(view._computeTabDropGap('v0', 10, 10), 0);
        assert.equal(view._computeTabDropGap('v0', 90, 10), 1);
        assert.equal(view._computeTabDropGap('v0', 110, 10), 1);
        assert.equal(view._computeTabDropGap('v0', 190, 10), 2);
        assert.equal(view._computeTabDropGap('v0', 390, 10), 4);
    });

    it('converts gaps to final indices through moveView()', () => {
        const view = createView();
        stubHorizontalRects();
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        startDrag(view, 'v0');
        firePointer('pointermove', { x: 300, y: 10 });
        firePointer('pointerup', { x: 300, y: 10 });

        assert.deepEqual(idsOf(view), ['v1', 'v2', 'v0', 'v3']);
        assert.equal(events.length, 1);
        assert.equal(events[0].detail.toIndex, 2);
    });

    it('moves a trailing tab into a leading gap', () => {
        const view = createView();
        stubHorizontalRects();

        startDrag(view, 'v3', { x: 300, y: 10 });
        firePointer('pointermove', { x: 90, y: 10 });
        firePointer('pointerup', { x: 90, y: 10 });

        assert.deepEqual(idsOf(view), ['v0', 'v3', 'v1', 'v2']);
    });

    it('does not reorder when dropping in the source gap', () => {
        const view = createView();
        stubHorizontalRects();
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        startDrag(view, 'v1');
        firePointer('pointermove', { x: 110, y: 10 });
        assert.equal(view._tabDragState.dropIndex, 1);
        firePointer('pointerup', { x: 110, y: 10 });

        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
        assert.equal(events.length, 0);
    });

    it('uses clientY and top/bottom for a vertical strip', () => {
        const view = createView(undefined, { tabPosition: 'left' });
        stubVerticalRects();

        assert.equal(view._computeTabDropGap('v0', 10, 10), 0);
        assert.equal(view._computeTabDropGap('v0', 10, 190), 2);
        // Horizontal movement alone does not change the vertical gap.
        assert.equal(view._computeTabDropGap('v0', 400, 10), 0);
    });

    it('never offers a gap outside the movable block', () => {
        const view = createView();
        view.setViewMovable('v2', false);
        stubHorizontalRects();

        // v3 is its own block: pointer left of it is still gap 3 / final 3.
        assert.equal(view._computeTabDropGap('v3', 0, 10), 3);
        startDrag(view, 'v3');
        firePointer('pointermove', { x: 0, y: 10 });
        firePointer('pointerup', { x: 0, y: 10 });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);

        // v0 can move inside [v0, v1] but not past v2.
        assert.equal(view._computeTabDropGap('v0', 390, 10), 2);
        startDrag(view, 'v0');
        firePointer('pointermove', { x: 390, y: 10 });
        firePointer('pointerup', { x: 390, y: 10 });
        assert.deepEqual(idsOf(view), ['v1', 'v0', 'v2', 'v3']);
    });

    it('keeps two movable blocks separate', () => {
        const view = createView(['v0', 'v1', 'v2', 'v3', 'v4']);
        view.setViewMovable('v2', false);
        stubHorizontalRects();

        startDrag(view, 'v3');
        firePointer('pointermove', { x: 0, y: 10 });
        firePointer('pointerup', { x: 0, y: 10 });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3', 'v4']);

        startDrag(view, 'v0');
        firePointer('pointermove', { x: 490, y: 10 });
        firePointer('pointerup', { x: 490, y: 10 });
        assert.deepEqual(idsOf(view), ['v1', 'v0', 'v2', 'v3', 'v4']);
    });

    it('refuses to start a drag on an immovable tab and handles missing DOM', () => {
        const view = createView();
        view.setViewMovable('v1', false);
        stubHorizontalRects();

        assert.equal(view._computeTabDropGap('v1', 10, 10), null);
        startDrag(view, 'v1');
        assert.equal(view._tabDragState, null);

        view.detach();
        attached = attached.filter((entry) => entry !== view);
        assert.equal(view._computeTabDropGap('v0', 10, 10), null);
    });


    it('requires the 4px threshold before activating', () => {
        const view = createView();
        stubHorizontalRects();
        startDrag(view, 'v0', { x: 10, y: 10 });

        firePointer('pointermove', { x: 12, y: 11 });
        assert.equal(view._tabDragState.active, false);
        assert.equal(view._host.classList.contains('tabbed-view--dragging'), false);
        assert.equal(container.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').length, 0);

        firePointer('pointerup', { x: 12, y: 11 });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);

        startDrag(view, 'v0', { x: 10, y: 10 });
        firePointer('pointermove', { x: 20, y: 10 });
        assert.equal(view._tabDragState.active, true);
        assert.equal(view._host.classList.contains('tabbed-view--dragging'), true);
    });

    it('paints only one insertion indicator and repaints cleanly', () => {
        const view = createView();
        stubHorizontalRects();
        const tabs = [...container.querySelectorAll('.tabbed-view__tab[data-view-id]')];

        startDrag(view, 'v0');
        firePointer('pointermove', { x: 300, y: 10 });

        assert.equal(tabs[0].classList.contains('is-dragging'), true);
        assert.equal(tabs[0].classList.contains('is-drop-before'), false);
        assert.equal(
            container.querySelectorAll('.is-dragging').length,
            1
        );
        assert.equal(
            container.querySelectorAll('.is-drop-before, .is-drop-after').length,
            1
        );

        firePointer('pointermove', { x: 390, y: 10 });

        assert.equal(tabs[0].classList.contains('is-dragging'), true);
        assert.equal(
            container.querySelectorAll('.is-drop-before, .is-drop-after').length,
            1
        );
        assert.equal(tabs[3].classList.contains('is-drop-after'), true);

        firePointer('pointerup', { x: 390, y: 10 });
        assert.equal(container.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').length, 0);
    });

    it('shows no indicator for a no-op gap', () => {
        const view = createView();
        stubHorizontalRects();

        startDrag(view, 'v1');
        firePointer('pointermove', { x: 110, y: 10 });

        assert.equal(container.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').length, 0);
    });

    it('commits exactly one move on pointerup after the threshold', () => {
        const view = createView();
        stubHorizontalRects();
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        startDrag(view, 'v0');
        firePointer('pointermove', { x: 390, y: 10 });
        firePointer('pointerup', { x: 390, y: 10 });

        assert.deepEqual(idsOf(view), ['v1', 'v2', 'v3', 'v0']);
        assert.equal(events.length, 1);
        assert.equal(events[0].detail.toIndex, 3);
    });

    it('ignores events from a different pointer id', () => {
        const view = createView();
        stubHorizontalRects();
        startDrag(view, 'v0', { pointerId: 1 });

        firePointer('pointermove', { x: 390, y: 10, pointerId: 2 });
        assert.equal(view._tabDragState.active, false);

        firePointer('pointerup', { x: 390, y: 10, pointerId: 2 });
        assert.notEqual(view._tabDragState, null);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);

        view._cancelTabDrag();
    });

    it('does not start a drag for non-primary or non-left pointers', () => {
        const view = createView();
        stubHorizontalRects();

        view._beginTabDrag(
            {
                button: 2,
                isPrimary: true,
                pointerId: 1,
                clientX: 10,
                clientY: 10,
                target: tabFor('v0'),
            },
            'v0'
        );
        assert.equal(view._tabDragState, null);

        view._beginTabDrag(
            {
                button: 0,
                isPrimary: false,
                pointerId: 1,
                clientX: 10,
                clientY: 10,
                target: tabFor('v0'),
            },
            'v0'
        );
        assert.equal(view._tabDragState, null);
    });

    it('does not start a drag from interactive child controls', () => {
        const view = createView();
        stubHorizontalRects();
        const close = container.querySelector('.tabbed-view__tab-close');

        startDrag(view, 'v0', { target: close });

        assert.equal(view._tabDragState, null);
    });


    it('reorders with Alt+ArrowRight and moves focus with the tab', () => {
        const view = createView();
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        const event = fireKey(tabFor('v0'), 'ArrowRight', { altKey: true });

        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(idsOf(view), ['v1', 'v0', 'v2', 'v3']);
        assert.equal(events.length, 1);
        assert.equal(document.activeElement.dataset.viewId, 'v0');
    });

    it('reorders with Alt+ArrowLeft and stops at boundaries', () => {
        const view = createView();

        fireKey(tabFor('v3'), 'ArrowLeft', { altKey: true });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v3', 'v2']);

        fireKey(tabFor('v0'), 'ArrowLeft', { altKey: true });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v3', 'v2']);
    });

    it('uses Up/Down in a vertical strip and ignores horizontal arrows', () => {
        const view = createView(undefined, { tabPosition: 'left' });

        fireKey(tabFor('v0'), 'ArrowDown', { altKey: true });
        assert.deepEqual(idsOf(view), ['v1', 'v0', 'v2', 'v3']);

        fireKey(tabFor('v0'), 'ArrowUp', { altKey: true });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);

        fireKey(tabFor('v0'), 'ArrowRight', { altKey: true });
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
    });

    it('leaves plain arrow keys unclaimed', () => {
        const view = createView();

        const event = fireKey(tabFor('v0'), 'ArrowRight');

        assert.equal(event.defaultPrevented, false);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
    });

    it('does not claim Alt+Arrow on an immovable tab or a wall', () => {
        const view = createView();
        view.setViewMovable('v1', false);
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        const pinned = fireKey(tabFor('v1'), 'ArrowRight', { altKey: true });
        assert.equal(pinned.defaultPrevented, false);

        tabFor('v0').focus();
        const walled = fireKey(tabFor('v0'), 'ArrowRight', { altKey: true });
        assert.equal(walled.defaultPrevented, true);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
        assert.equal(events.length, 0);
        assert.equal(document.activeElement.dataset.viewId, 'v0');
    });

    it('does not handle Alt+Arrow when reorderable is false', () => {
        const view = createView(undefined, { reorderable: false });

        const event = fireKey(tabFor('v0'), 'ArrowRight', { altKey: true });

        assert.equal(event.defaultPrevented, false);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
    });

    it('keeps Enter and Space activation working', () => {
        const view = createView();

        const enter = fireKey(tabFor('v1'), 'Enter');
        assert.equal(enter.defaultPrevented, true);
        assert.equal(view.activeId, 'v1');

        const space = fireKey(tabFor('v2'), ' ');
        assert.equal(space.defaultPrevented, true);
        assert.equal(view.activeId, 'v2');
    });

    it('renders drag affordances and orientation-aware ARIA only on movable tabs', () => {
        const view = createView();
        view.setViewMovable('v2', false);

        const v0 = tabFor('v0');
        const v2 = tabFor('v2');
        assert.equal(v0.classList.contains('tabbed-view__tab--draggable'), true);
        assert.equal(v2.classList.contains('tabbed-view__tab--draggable'), false);
        assert.equal(v0.getAttribute('aria-roledescription'), 'sortable tab');
        assert.equal(v0.getAttribute('aria-keyshortcuts'), 'Alt+ArrowLeft Alt+ArrowRight');
        assert.equal(v2.getAttribute('aria-roledescription'), null);
    });

    it('uses Up/Down ARIA shortcuts in a vertical strip', () => {
        createView(undefined, { tabPosition: 'left' });
        assert.equal(
            tabFor('v0').getAttribute('aria-keyshortcuts'),
            'Alt+ArrowUp Alt+ArrowDown'
        );
    });
});

describe('TabbedView drag styles', () => {
    it('declares the drag affordances, indicator and touch-action rules', () => {
        const css = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/styles/standard/tabbed-view.css',
                import.meta.url
            ),
            'utf8'
        );

        for (const selector of [
            '.tabbed-view__tab--draggable',
            '.is-dragging',
            '.is-drop-before',
            '.is-drop-after',
            '.tabbed-view--dragging',
            '.tabbed-view__tab.is-active',
        ]) {
            assert.ok(css.includes(selector), `missing ${selector}`);
        }
        assert.match(css, /\.tabbed-view__tab--draggable\s*\{[^}]*touch-action:\s*pan-y/s);
        assert.match(
            css,
            /\.tabbed-view__tab--draggable\.tabbed-view__tab--vertical\s*\{[^}]*touch-action:\s*pan-x/s
        );
        assert.match(css, /var\(--mo-tab-drop-indicator/);
        const draggingRule = css.match(/\.tabbed-view__tab\.is-dragging\s*\{[^}]*\}/s)?.[0] ?? '';
        assert.ok(draggingRule.length > 0, 'missing .is-dragging rule');
        assert.doesNotMatch(draggingRule, /display:\s*none/);
        assert.match(css, /prefers-reduced-motion:\s*reduce/);
    });
});
