// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Programmatic tab reordering for TabbedView.
 *
 * Covers the reorder flags, movable-block invariant, `tab-moved` payload and
 * serialization of `reorderable` / `tabMovability` without any pointer handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { AppEvent, assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
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

function makeView(id, options = {}) {
    return new TestView({ id, title: id.toUpperCase(), ...options });
}

function makeViews(ids = ['v0', 'v1', 'v2', 'v3']) {
    return ids.map((id) => makeView(id));
}

function idsOf(view) {
    return view.views.map((entry) => entry.id);
}

function createReorderable(ids = ['v0', 'v1', 'v2', 'v3'], options = {}) {
    const views = makeViews(ids);
    return new TabbedView({
        views,
        activeId: ids[0],
        reorderable: true,
        ...options,
    });
}

describe('TabbedView reorder flags', () => {
    it('defaults to non-reorderable and coerces option values to boolean', () => {
        assert.equal(new TabbedView().reorderable, false);
        assert.equal(new TabbedView({ reorderable: true }).reorderable, true);
        assert.equal(new TabbedView({ reorderable: 0 }).reorderable, false);
        assert.equal(new TabbedView({ reorderable: null }).reorderable, false);
        assert.equal(new TabbedView({ reorderable: undefined }).reorderable, false);
    });

    it('documents tab-moved and never uses a v2 payload id', () => {
        const source = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/js/views/tabbed-view.ts',
                import.meta.url
            ),
            'utf8'
        );

        assert.match(source, /tab-moved` -> `payloadTypeId: TabbedView\.TabMoved\.v1/);
        assert.match(source, /super\('TabbedView\.TabMoved\.v1'\)/);
        assert.doesNotMatch(source, /TabbedView\.TabMoved\.v2/);
    });
});

describe('TabbedView per-tab movability', () => {
    it('reads movable from the view and defaults missing flags to movable', () => {
        const view = new TabbedView({
            views: [makeView('v0', { movable: false }), makeView('v1'), makeView('v2', { movable: true })],
        });

        assert.equal(view.isViewMovable('v0'), false);
        assert.equal(view.isViewMovable('v1'), true);
        assert.equal(view.isViewMovable('v2'), true);
        assert.equal(view.isViewMovable('unknown'), true);
        assert.equal(view.isViewMovable(''), false);
    });

    it('preserves surviving flags and defaults new ids in setViews()', () => {
        const view = new TabbedView({
            views: [makeView('v0', { movable: false }), makeView('v1')],
        });

        view.setViews([makeView('v0'), makeView('v2')]);

        assert.equal(view.isViewMovable('v0'), false);
        assert.equal(view.isViewMovable('v2'), true);
        assert.equal(view.isViewMovable('v1'), true);
    });

    it('prunes flags for removed ids so a re-added tab is movable again', () => {
        const view = new TabbedView({ views: [makeView('v0')] });
        view.setViewMovable('v0', false);

        view.setViews([makeView('v1')]);
        view.setViews([makeView('v0')]);

        assert.equal(view.isViewMovable('v0'), true);
    });

    it('honours the addView movable override and the view default', () => {
        const view = new TabbedView();

        view.addView(makeView('v0'), 0, false, true, false);
        view.addView(makeView('v1', { movable: false }), 1, false, true);
        view.addView(makeView('v2', { movable: false }), 2, false, true, true);

        assert.equal(view.isViewMovable('v0'), false);
        assert.equal(view.isViewMovable('v1'), false);
        assert.equal(view.isViewMovable('v2'), true);
    });

    it('forgets a pin when the tab is removed', () => {
        const view = new TabbedView({ views: [makeView('v0')] });
        view.setViewMovable('v0', false);

        view.removeView('v0');
        view.addView(makeView('v0'), 0, false, true);

        assert.equal(view.isViewMovable('v0'), true);
    });
});

describe('TabbedView movability edge cases', () => {
    it('re-renders the strip when setViewMovable() changes a flag', () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        const container = document.createElement('div');
        document.body.appendChild(container);
        const view = createReorderable(['v0', 'v1']);
        view.attachTo(container);

        const before = container.querySelector('.tabbed-view__tab[data-view-id="v0"]');
        view.setViewMovable('v0', false);
        const after = container.querySelector('.tabbed-view__tab[data-view-id="v0"]');

        assert.notEqual(before, after);
        assert.equal(view.isViewMovable('v0'), false);

        view.detach();
        dom.window.close();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.ResizeObserver;
    });

    it('ignores unknown ids and duplicate ids without throwing', () => {
        const view = createReorderable(['v0']);
        view.setViewMovable('missing', false);
        assert.equal(view.isViewMovable('missing'), true);

        const first = makeView('dup', { movable: false });
        const second = makeView('dup', { movable: true });
        view.setViews([first, second]);
        assert.equal(view.isViewMovable('dup'), true);
    });

    it('keeps structural movability independent of reorderable', () => {
        const view = new TabbedView({
            views: [makeView('v0', { movable: false }), makeView('v1')],
            reorderable: false,
        });

        assert.equal(view.isViewMovable('v0'), false);
        assert.equal(view.isViewMovable('v1'), true);
    });
});

describe('TabbedView.moveView', () => {
    it('moves tabs forward and backward by id', () => {
        const view = createReorderable();

        assert.equal(view.moveView('v0', 3), true);
        assert.deepEqual(idsOf(view), ['v1', 'v2', 'v3', 'v0']);

        assert.equal(view.moveView('v3', 0), true);
        assert.deepEqual(idsOf(view), ['v3', 'v1', 'v2', 'v0']);

        assert.equal(view.moveView('v0', 2), true);
        assert.deepEqual(idsOf(view), ['v3', 'v1', 'v0', 'v2']);
    });

    it('accepts a view instance and a numeric index as target', () => {
        const view = createReorderable();
        const v1 = view.views[1];

        assert.equal(view.moveView(v1, 3), true);
        assert.deepEqual(idsOf(view), ['v0', 'v2', 'v3', 'v1']);

        assert.equal(view.moveView(0, 2), true);
        assert.deepEqual(idsOf(view), ['v2', 'v3', 'v0', 'v1']);
    });

    it('treats toIndex as the final index, not an insertion gap', () => {
        const view = createReorderable();

        assert.equal(view.moveView('v0', 2), true);
        assert.deepEqual(idsOf(view), ['v1', 'v2', 'v0', 'v3']);
    });

    it('clamps out-of-range indices and rejects same-position moves', () => {
        const view = createReorderable();

        assert.equal(view.moveView('v2', -5), true);
        assert.deepEqual(idsOf(view), ['v2', 'v0', 'v1', 'v3']);

        assert.equal(view.moveView('v2', 999), true);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v3', 'v2']);

        assert.equal(view.moveView('v0', 0), false);
        assert.equal(view.moveView('v2', 3), false);
    });

    it('stops a forward move before an immovable tab', () => {
        const view = createReorderable();
        view.setViewMovable('v1', false);

        assert.equal(view.moveView('v0', 3), false);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);

        // v1 is a wall in both directions, so v2 also cannot cross it.
        assert.equal(view.moveView('v2', 0), false);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
    });

    it('stops a backward move before an immovable tab', () => {
        const view = createReorderable();
        view.setViewMovable('v2', false);

        assert.equal(view.moveView('v3', 0), false);
        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);

        assert.equal(view.moveView('v1', 0), true);
        assert.deepEqual(idsOf(view), ['v1', 'v0', 'v2', 'v3']);
    });

    it('refuses to move an immovable tab', () => {
        const view = createReorderable();
        view.setViewMovable('v1', false);
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        assert.equal(view.moveView('v1', 3), false);

        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
        assert.equal(events.length, 0);
    });
});

describe('TabbedView.moveView rejections', () => {
    it('rejects unknown ids, out-of-range indices and non-integer targets', () => {
        const view = createReorderable();
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        assert.equal(view.moveView('missing', 1), false);
        assert.equal(view.moveView(-1, 1), false);
        assert.equal(view.moveView(4, 1), false);
        for (const toIndex of [NaN, 1.5, Infinity, -Infinity]) {
            assert.equal(view.moveView('v0', toIndex), false);
        }

        assert.deepEqual(idsOf(view), ['v0', 'v1', 'v2', 'v3']);
        assert.equal(events.length, 0);
    });

    it('rejects moves on empty and single-view TabbedViews', () => {
        const empty = new TabbedView({ reorderable: true });
        assert.equal(empty.moveView('v0', 0), false);

        const single = new TabbedView({ views: [makeView('v0')], reorderable: true });
        assert.equal(single.moveView('v0', 1), false);
        assert.deepEqual(idsOf(single), ['v0']);
    });

    it('allows programmatic moves when reorderable is false', () => {
        const view = createReorderable(['v0', 'v1', 'v2'], { reorderable: false });
        const events = [];
        view.on('tab-moved', (event) => events.push(event));

        assert.equal(view.reorderable, false);
        assert.equal(view.moveView('v0', 2), true);
        assert.deepEqual(idsOf(view), ['v1', 'v2', 'v0']);
        assert.equal(events.length, 1);
    });
});

describe('TabbedView.moveView invariants', () => {
    it('keeps the active view mounted and per-tab state unchanged', () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        const container = document.createElement('div');
        document.body.appendChild(container);
        const view = createReorderable();
        view.setViewMovable('v2', false);
        view.attachTo(container);
        view.selectView('v1');

        const active = view.getActiveView();
        const closableBefore = new Map(
            view.views.map((entry) => [entry.id, view._isClosable(entry.id)])
        );
        const movableBefore = new Map(
            view.views.map((entry) => [entry.id, view.isViewMovable(entry.id)])
        );

        assert.equal(view.moveView('v0', 3), true);

        assert.equal(view.activeId, 'v1');
        assert.equal(view.getActiveView(), active);
        assert.ok(container.querySelector('.tabbed-view__content').contains(active.container));
        view.views.forEach((entry) => {
            assert.equal(view._isClosable(entry.id), closableBefore.get(entry.id));
            assert.equal(view.isViewMovable(entry.id), movableBefore.get(entry.id));
        });

        view.detach();
        dom.window.close();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.ResizeObserver;
    });

    it('emits one tab-moved event with the final index after the DOM re-render', () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        const container = document.createElement('div');
        document.body.appendChild(container);
        const view = createReorderable();
        view.attachTo(container);

        const events = [];
        view.on('tab-moved', (event) => {
            events.push(event);
            const domOrder = Array.from(
                container.querySelectorAll('.tabbed-view__tab[data-view-id]')
            ).map((tab) => tab.dataset.viewId);
            assert.deepEqual(domOrder, ['v1', 'v2', 'v3', 'v0']);
        });

        assert.equal(view.moveView('v0', 3), true);

        assert.equal(events.length, 1);
        assert.ok(events[0] instanceof AppEvent);
        const validated = assertAppEventPayloadType(
            events[0],
            'TabbedView.TabMoved.v1',
            [
                {
                    name: 'viewId',
                    validate: (value) => value === 'v0',
                    expected: 'view id',
                },
                { name: 'fromIndex', validate: (value) => value === 0, expected: 'zero' },
                { name: 'toIndex', validate: (value) => value === 3, expected: 'last index' },
            ],
            'TabbedView tab-moved listener'
        );
        assert.equal(validated.detail.viewId, 'v0');
        assert.equal(validated.detail.fromIndex, 0);
        assert.equal(validated.detail.toIndex, 3);
        assert.equal(validated.detail.view, view.views[3]);
        assert.equal(validated.detail.payloadTypeId, 'TabbedView.TabMoved.v1');

        view.detach();
        dom.window.close();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.ResizeObserver;
    });
});

describe('TabbedView reorder serialization', () => {
    it('serializes reorderable and tabMovability in tab order', () => {
        const view = createReorderable();
        view.setViewMovable('v1', false);

        const data = view.serialize();

        assert.equal(data.reorderable, true);
        assert.deepEqual(data.tabMovability, [
            { id: 'v0', movable: true },
            { id: 'v1', movable: false },
            { id: 'v2', movable: true },
            { id: 'v3', movable: true },
        ]);
        assert.equal('movable' in data.views[0], false);
        assert.equal('movable' in data.views[1], false);
    });

    it('round-trips order, active id, closability, reorderable and movability', () => {
        const view = createReorderable();
        view.setViewMovable('v2', false);
        view.moveView('v0', 3);
        const restored = TabbedView.deserialize(view.serialize());

        assert.deepEqual(idsOf(restored), ['v1', 'v0', 'v2', 'v3']);
        assert.equal(restored.activeId, view.activeId);
        assert.equal(restored.reorderable, true);
        assert.equal(restored.isViewMovable('v2'), false);
        assert.equal(restored.isViewMovable('v1'), true);
        assert.equal(restored._isClosable('v0'), view._isClosable('v0'));
    });

    it('preserves a pinned middle tab across a round-trip', () => {
        const view = createReorderable();
        view.setViewMovable('v2', false);

        const restored = TabbedView.deserialize(view.serialize());

        assert.equal(restored.isViewMovable('v2'), false);
        assert.equal(restored.moveView('v1', 3), false);
        assert.deepEqual(idsOf(restored), ['v0', 'v1', 'v2', 'v3']);
        assert.equal(restored.moveView('v0', 1), true);
        assert.deepEqual(idsOf(restored), ['v1', 'v0', 'v2', 'v3']);
        assert.equal(restored.moveView('v3', 0), false);
        assert.deepEqual(idsOf(restored), ['v1', 'v0', 'v2', 'v3']);
    });

    it('restores legacy payloads as non-reorderable with all tabs movable', () => {
        const legacy = {
            type: 'TabbedView',
            title: 'Legacy',
            views: [
                { id: 'v0', title: 'V0' },
                { id: 'v1', title: 'V1' },
            ],
            activeId: 'v0',
        };

        const view = TabbedView.deserialize(legacy);

        assert.equal(view.reorderable, false);
        assert.equal(view.isViewMovable('v0'), true);
        assert.equal(view.isViewMovable('v1'), true);
        assert.equal(view.moveView('v0', 1), true);
        assert.deepEqual(idsOf(view), ['v1', 'v0']);
    });

    it('tolerates malformed tabMovability entries', () => {
        const base = {
            type: 'TabbedView',
            title: 'Malformed',
            views: [
                { id: 'v0', title: 'V0' },
                { id: 'v1', title: 'V1' },
            ],
        };

        for (const tabMovability of [null, 'x', [null], [{ id: 1 }]]) {
            const view = TabbedView.deserialize({ ...base, tabMovability });
            assert.equal(view.isViewMovable('v0'), true);
            assert.equal(view.isViewMovable('v1'), true);
        }

        const coerced = TabbedView.deserialize({
            ...base,
            tabMovability: [
                { id: 'v0', movable: false },
                { id: 'v1', movable: 'no' },
            ],
        });
        assert.equal(coerced.isViewMovable('v0'), false);
        // Boolean('no') is true; this documents the deliberate coercion, not validation.
        assert.equal(coerced.isViewMovable('v1'), true);
    });

    it('lets the last duplicate tabMovability entry win', () => {
        const view = TabbedView.deserialize({
            type: 'TabbedView',
            title: 'Duplicates',
            views: [{ id: 'v0', title: 'V0' }],
            tabMovability: [
                { id: 'v0', movable: true },
                { id: 'v0', movable: false },
            ],
        });

        assert.equal(view.isViewMovable('v0'), false);
    });

    it('handles an empty views array without throwing', () => {
        const view = TabbedView.deserialize({
            type: 'TabbedView',
            title: 'Empty',
            views: [],
            reorderable: true,
            tabMovability: [{ id: 'ghost', movable: false }],
        });

        assert.deepEqual(idsOf(view), []);
        assert.equal(view.isViewMovable('ghost'), true);
    });
});

