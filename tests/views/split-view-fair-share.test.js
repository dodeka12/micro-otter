// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file SplitView fair-share regression test
 *
 * Reproduces the reported bug: maximize one section with the solo (+) action, collapse it, expand
 * two other sections, then expand the maximized one. Before the fix the re-expanded pane re-claimed
 * its solo height and pinned every sibling to its 32px header; after the fix the hint is capped at
 * the pane's equal share and all expanded sections keep visible content.
 *
 * jsdom has no layout engine, so a local `layoutPanes()` helper resolves the flexbox geometry from
 * the inline `flex-grow` / `min-height` / `max-height` styles and the splitter constant from
 * `split-view-sizing.ts`, keeping the test's expected numbers pinned to the real CSS.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { SplitView } from '../../src/micro_otter/nodes/html/js/views/split-view.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';
import { CollapsibleView } from '../../src/micro_otter/nodes/html/js/views/collapsible-view.js';
import { SPLIT_VIEW_SPLITTER_THICKNESS } from '../../src/micro_otter/nodes/html/js/views/split-view-sizing.js';

class DummyView extends ViewBase {
    render(container) {
        container.replaceChildren(document.createElement('div'));
    }
}

describe('SplitView fair-share regression', () => {
    let dom;
    let container;
    let heights;
    let originalGetBoundingClientRect;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);

        heights = new Map();
        originalGetBoundingClientRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
        dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
            const classList = this.classList;
            if (classList?.contains('split-view')) {
                return { width: 800, height: 800, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 800, toJSON: () => ({}) };
            }
            if (classList?.contains('split-view__pane')) {
                const height = heights.get(this) ?? 0;
                return { width: 800, height, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, toJSON: () => ({}) };
            }
            return originalGetBoundingClientRect.call(this);
        };

        Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
            configurable: true,
            get() {
                if (this.classList?.contains('split-view__pane')) {
                    return heights.get(this) ?? 0;
                }
                return 0;
            },
        });
    });

    afterEach(() => {
        dom.window.HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        delete dom.window.HTMLElement.prototype.offsetHeight;
        container?.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        dom.window.close();
    });

    /**
     * Resolve the flexbox layout from the pane inline styles (jsdom has no layout engine) and
     * record the resulting heights for the stubbed geometry readers.
     * @param {SplitView} split Split view under test.
     * @param {number} hostSpan Host content-box extent along the split axis.
     * @returns {number[]} One rendered pane height per pane.
     */
    function layoutPanes(split, hostSpan) {
        const panes = split._panes;
        const splitters = split._splitters;
        let available = hostSpan;
        for (const splitter of splitters) {
            available -= splitter.classList.contains('split-view__splitter--inactive')
                ? SPLIT_VIEW_SPLITTER_THICKNESS.inactive
                : SPLIT_VIEW_SPLITTER_THICKNESS.active;
        }

        const grow = panes.map((pane) => Number(pane.style.flexGrow) || 0);
        const minSizes = panes.map((pane) => {
            const value = Number.parseFloat(pane.style.minHeight);
            return Number.isFinite(value) ? value : 0;
        });
        const maxSizes = panes.map((pane) => {
            const value = Number.parseFloat(pane.style.maxHeight);
            return Number.isFinite(value) ? value : Infinity;
        });

        const sizes = new Array(panes.length).fill(0);
        const frozen = new Array(panes.length).fill(false);

        for (let iter = 0; iter < 32; iter++) {
            const unfrozen = [];
            for (let i = 0; i < panes.length; i++) {
                if (!frozen[i]) unfrozen.push(i);
            }
            if (unfrozen.length === 0) break;
            const totalGrow = unfrozen.reduce((sum, i) => sum + grow[i], 0);
            if (totalGrow <= 0) break;
            const free = available - sizes.reduce((sum, size) => sum + size, 0);
            if (Math.abs(free) < 1e-6) break;

            let changed = false;
            for (const i of unfrozen) {
                const next = sizes[i] + free * (grow[i] / totalGrow);
                const clamped = Math.max(minSizes[i], Math.min(next, maxSizes[i]));
                if (Math.abs(clamped - sizes[i]) > 1e-6) {
                    sizes[i] = clamped;
                    changed = true;
                }
                if (clamped <= minSizes[i] + 1e-6 || clamped >= maxSizes[i] - 1e-6) {
                    frozen[i] = true;
                }
            }
            if (!changed) break;
        }

        for (let i = 0; i < panes.length; i++) {
            sizes[i] = Math.max(minSizes[i], Math.min(sizes[i], maxSizes[i]));
            heights.set(panes[i], sizes[i]);
        }
        return sizes;
    }

    function makeSections() {
        return Array.from({ length: 5 }, (_, i) => new CollapsibleView({
            headerTitle: `S${i}`,
            headerHeight: 32,
            contentView: new DummyView(),
        }));
    }

    it('caps a re-expanded maximized pane at its equal share', () => {
        const sections = makeSections();
        const split = new SplitView({ orientation: 'vertical', minPaneSize: 32, gap: 0, views: sections });
        split.attachTo(container);

        const available = 800 - 4 * SPLIT_VIEW_SPLITTER_THICKNESS.active; // 776

        // Initial: five equal shares.
        let heightsNow = layoutPanes(split, 800);
        assert.ok(Math.abs(heightsNow[0] - available / 5) < 1, 'initial equal share');

        // Solo S0 (the "+" action), then collapse it, expand S2 and S4, then re-expand S0.
        sections[0].requestSplitViewSolo();
        heightsNow = layoutPanes(split, 800);
        const soloHeight = heightsNow[0];
        assert.ok(soloHeight > 600, `S0 should own most of the space while solo (got ${soloHeight})`);

        sections[0].collapse();
        layoutPanes(split, 800);

        sections[2].expand();
        layoutPanes(split, 800);

        sections[4].expand();
        layoutPanes(split, 800);

        sections[0].expand();
        heightsNow = layoutPanes(split, 800);

        // The previously-maximized pane must no longer be maximized: it keeps at most the equal
        // share left after the two collapsed sections take their 32px headers.
        const expectedEqual = (available - 2 * 32) / 3;
        assert.ok(
            Math.abs(heightsNow[0] - expectedEqual) < 1,
            `S0 should be capped at the equal share (~${expectedEqual}), got ${heightsNow[0]}`
        );
        assert.ok(heightsNow[0] < soloHeight - 100, 'S0 must not reclaim its solo height');

        // Collapsed siblings stay at their header height; expanded ones keep visible content.
        assert.ok(Math.abs(heightsNow[1] - 32) < 1e-6, 'S1 stays collapsed at 32px');
        assert.ok(Math.abs(heightsNow[3] - 32) < 1e-6, 'S3 stays collapsed at 32px');
        for (const index of [0, 2, 4]) {
            assert.ok(heightsNow[index] > 33, `expanded pane ${index} keeps visible content`);
        }

        // The layout still fills the host exactly.
        const sum = heightsNow.reduce((total, height) => total + height, 0);
        assert.ok(Math.abs(sum - available) < 1, `sizes sum to ${available} (got ${sum})`);

        // The stale hint is preserved by CollapsibleView but capped by SplitView.
        assert.equal(sections[0].getDesiredSize().height, soloHeight);
    });

    it('keeps a second collapse/expand cycle fair', () => {
        const sections = makeSections();
        const split = new SplitView({ orientation: 'vertical', minPaneSize: 32, gap: 0, views: sections });
        split.attachTo(container);

        sections[0].requestSplitViewSolo();
        layoutPanes(split, 800);
        sections[0].collapse();
        layoutPanes(split, 800);
        sections[0].expand();
        const first = layoutPanes(split, 800);

        sections[0].collapse();
        layoutPanes(split, 800);
        sections[0].expand();
        const second = layoutPanes(split, 800);

        assert.ok(Math.abs(first[0] - second[0]) < 1, 'a second cycle does not re-maximize S0');
    });
});
