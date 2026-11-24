import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { SplitView } from '../../src/micro_otter/nodes/html/js/views/split-view.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';

class PaneView extends ViewBase {
    constructor({ minHeight = null, maxHeight = null } = {}) {
        super({ minHeight, maxHeight });
    }

    render(container) {
        container.replaceChildren(document.createElement('div'));
    }
}

function flexiblePane() {
    return new PaneView();
}

function fixedPane(height = 32) {
    return new PaneView({ minHeight: height, maxHeight: height });
}

function cappedPane(maxHeight) {
    return new PaneView({ minHeight: 32, maxHeight });
}

describe('SplitView splitter movability', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        container.style.width = '1200px';
        container.style.height = '800px';
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        dom.window.close();
    });

    function splitters() {
        return Array.from(container.querySelectorAll('.split-view__splitter'));
    }

    it('keeps splitters movable around a middle collapsed pane', () => {
        const view = new SplitView({
            orientation: 'vertical',
            views: [flexiblePane(), fixedPane(32), flexiblePane()],
        });
        view.attachTo(container);

        const els = splitters();
        assert.equal(els.length, 2);
        for (const el of els) {
            assert.ok(!el.classList.contains('split-view__splitter--disabled'));
            assert.ok(!el.classList.contains('split-view__splitter--inactive'));
            assert.notEqual(el.style.pointerEvents, 'none');
        }
    });

    it('disables every splitter when all panes are collapsed', () => {
        const view = new SplitView({
            orientation: 'vertical',
            views: [fixedPane(32), fixedPane(32), fixedPane(32)],
        });
        view.attachTo(container);

        const els = splitters();
        assert.equal(els.length, 2);
        for (const el of els) {
            assert.ok(el.classList.contains('split-view__splitter--disabled'));
            assert.ok(el.classList.contains('split-view__splitter--inactive'));
            assert.equal(el.style.pointerEvents, 'none');
        }
    });

    it('disables splitters when a fixed pane leaves no flexible pane on the other side', () => {
        const view = new SplitView({
            orientation: 'vertical',
            views: [fixedPane(32), flexiblePane(), fixedPane(32)],
        });
        view.attachTo(container);

        const els = splitters();
        assert.equal(els.length, 2);
        for (const el of els) {
            assert.ok(el.classList.contains('split-view__splitter--disabled'));
            assert.ok(el.classList.contains('split-view__splitter--inactive'));
        }
    });

    it('keeps splitters enabled in an all-flexible split', () => {
        const view = new SplitView({
            orientation: 'vertical',
            views: [flexiblePane(), flexiblePane(), flexiblePane()],
        });
        view.attachTo(container);

        const els = splitters();
        assert.equal(els.length, 2);
        for (const el of els) {
            assert.ok(!el.classList.contains('split-view__splitter--disabled'));
        }
    });

    it('caps all panes below the available span when every pane has a max height', () => {
        const originalGetBoundingClientRect =
            dom.window.HTMLElement.prototype.getBoundingClientRect;

        try {
            dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
                const isSplitView = this.classList?.contains('split-view');
                return {
                    width: 800,
                    height: isSplitView ? 600 : 0,
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 800,
                    bottom: isSplitView ? 600 : 0,
                    toJSON: () => ({}),
                };
            };

            const view = new SplitView({
                orientation: 'vertical',
                views: [cappedPane(114), cappedPane(154), cappedPane(194)],
            });
            view.attachTo(container);

            const panes = Array.from(container.querySelectorAll('.split-view__pane'));
            const factors = panes.map((pane) => Number(pane.style.flexGrow));
            const filler = container.querySelector('.split-view__filler');

            assert.ok(filler, 'a residual filler should be present');
            // Factors are expressed in units of the smallest cap (114px), so every positive ratio
            // lands at 1 or above and CSS distributes the space released by capped panes in full
            // (Flexbox §9.7 only grants `sum x free space` when the unfrozen factors sum below 1).
            assert.ok(
                factors.every((factor) => factor >= 1 - 1e-9),
                `every pane factor should be at least 1 (got ${factors.join(', ')})`
            );
            assert.ok(Math.abs(factors[0] - 1) < 1e-6);
            assert.ok(Math.abs(factors[1] - 154 / 114) < 0.01);
            assert.ok(Math.abs(factors[2] - 194 / 114) < 0.01);
            assert.ok(
                Math.abs(Number(filler.style.flexGrow) - 126 / 114) < 0.01,
                'filler should only absorb the unused ratio'
            );
            assert.ok(
                Math.abs(
                    factors.reduce((sum, factor) => sum + factor, 0) +
                        Number(filler.style.flexGrow) -
                        588 / 114
                ) < 0.01,
                'pane and filler flex factors should add up to the scale (span / smallest cap)'
            );
        } finally {
            dom.window.HTMLElement.prototype.getBoundingClientRect =
                originalGetBoundingClientRect;
        }
    });

    it('removes the filler once a constrained pane becomes fixed', () => {
        const originalGetBoundingClientRect =
            dom.window.HTMLElement.prototype.getBoundingClientRect;

        try {
            dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
                const isSplitView = this.classList?.contains('split-view');
                return {
                    width: 800,
                    height: isSplitView ? 600 : 0,
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 800,
                    bottom: isSplitView ? 600 : 0,
                    toJSON: () => ({}),
                };
            };

            const view = new SplitView({
                orientation: 'vertical',
                views: [cappedPane(114), cappedPane(154), cappedPane(194)],
            });
            view.attachTo(container);

            assert.ok(container.querySelector('.split-view__filler'));

            view.views[0].setHeightConstraints({ minHeight: 32, maxHeight: 32 });

            const panes = Array.from(container.querySelectorAll('.split-view__pane'));
            const factors = panes.map((pane) => Number(pane.style.flexGrow));

            assert.equal(view._filler, null);
            assert.equal(container.querySelector('.split-view__filler'), null);
            // With pane 0 fixed the splitter next to it becomes inactive (4px), so 590px is
            // available. The fixed 32px pane sets the unit and the two flexible panes share the
            // remaining 558px: 558 / 2 / 32 = 8.71875 each.
            const flexibleFactor = (590 - 32) / 2 / 32;
            assert.ok(Math.abs(factors[0] - 1) < 1e-6);
            assert.ok(Math.abs(factors[1] - flexibleFactor) < 0.01);
            assert.ok(Math.abs(factors[2] - flexibleFactor) < 0.01);
            assert.ok(
                Math.abs(factors.reduce((sum, factor) => sum + factor, 0) - 590 / 32) < 0.01,
                'flex factors should add up to the scale (span / fixed pane size)'
            );
        } finally {
            dom.window.HTMLElement.prototype.getBoundingClientRect =
                originalGetBoundingClientRect;
        }
    });

    it('excludes host border and padding from the available span', () => {
        const originalGetBoundingClientRect =
            dom.window.HTMLElement.prototype.getBoundingClientRect;

        try {
            dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
                const isSplitView = this.classList?.contains('split-view');
                return {
                    width: 800,
                    height: isSplitView ? 600 : 0,
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 800,
                    bottom: isSplitView ? 600 : 0,
                    toJSON: () => ({}),
                };
            };

            const view = new SplitView({
                orientation: 'vertical',
                views: [flexiblePane(), flexiblePane(), flexiblePane()],
            });
            view.attachTo(container);

            const host = container.querySelector('.split-view');
            host.style.borderTopWidth = '1px';
            host.style.borderBottomWidth = '1px';
            host.style.borderStyle = 'solid';
            host.style.paddingTop = '1px';
            host.style.paddingBottom = '1px';

            assert.equal(view._availableSpan(), 584);
        } finally {
            dom.window.HTMLElement.prototype.getBoundingClientRect =
                originalGetBoundingClientRect;
        }
    });

    it('_hasFlexiblePane reports flexible panes on either side of a splitter', () => {
        const view = new SplitView({
            orientation: 'vertical',
            views: [flexiblePane(), fixedPane(32), flexiblePane()],
        });
        view.attachTo(container);

        assert.equal(view._hasFlexiblePane(0, 1), true);
        assert.equal(view._hasFlexiblePane(1, 2), true);
        assert.equal(view._hasFlexiblePane(1, 1), false);
    });

    it('_nearestFlexiblePane skips fixed panes', () => {
        const view = new SplitView({
            orientation: 'vertical',
            views: [flexiblePane(), fixedPane(32), flexiblePane()],
        });
        view.attachTo(container);

        assert.equal(view._nearestFlexiblePane(0, -1), 0);
        assert.equal(view._nearestFlexiblePane(1, -1), 0);
        assert.equal(view._nearestFlexiblePane(1, 1), 2);
        assert.equal(view._nearestFlexiblePane(2, 1), 2);
    });

    it('drags resize the nearest flexible panes and keep a middle collapsed pane fixed', () => {
        const a = flexiblePane();
        const b = fixedPane(32);
        const c = flexiblePane();
        const view = new SplitView({
            orientation: 'vertical',
            minPaneSize: 8,
            views: [a, b, c],
        });
        view.attachTo(container);

        container.querySelectorAll('.split-view__pane').forEach((pane) => {
            pane.getBoundingClientRect = () => ({ width: 1200, height: 100, top: 0, left: 0 });
        });

        const before = [...view._ratios];

        view._beginDrag({ preventDefault() {}, clientX: 0, clientY: 0 }, 0);

        const move = new dom.window.Event('pointermove');
        Object.defineProperty(move, 'clientX', { value: 0 });
        Object.defineProperty(move, 'clientY', { value: 20 });
        dom.window.dispatchEvent(move);

        dom.window.dispatchEvent(new dom.window.Event('pointerup'));

        assert.notEqual(view._ratios[0], before[0]);
        assert.equal(view._ratios[1], before[1]);
        assert.notEqual(view._ratios[2], before[2]);
    });
});
