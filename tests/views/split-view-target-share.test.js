// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file SplitView target-share contract tests
 * Covers `_applyTargetShare` routing: authoritative actions keep their power and capture the
 * restore baseline, while `desiredSize` hints are capped and leave `_previousRatios` untouched.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { SplitView } from '../../src/micro_otter/nodes/html/js/views/split-view.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';

class PaneView extends ViewBase {
    render(container) {
        container.replaceChildren(document.createElement('div'));
    }
}

describe('SplitView target-share contract', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        const original = dom.window.HTMLElement.prototype.getBoundingClientRect;
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
        container._originalGetBoundingClientRect = original;
    });

    afterEach(() => {
        dom.window.HTMLElement.prototype.getBoundingClientRect =
            container._originalGetBoundingClientRect;
        container?.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        dom.window.close();
    });

    function threeFlexible() {
        return new SplitView({
            orientation: 'vertical',
            minPaneSize: 32,
            views: [new PaneView(), new PaneView(), new PaneView()],
        });
    }

    it('maximize still squeezes siblings to their minimum share', () => {
        const view = threeFlexible();
        view.attachTo(container);

        assert.equal(view._applyMaximize(0), true);
        const minShare = 32 / 588;
        assert.ok(Math.abs(view._ratios[1] - minShare) < 1e-6, 'sibling 1 at min share');
        assert.ok(Math.abs(view._ratios[2] - minShare) < 1e-6, 'sibling 2 at min share');
        assert.ok(view._ratios[0] > minShare);
    });

    it('relative resize distributes leftover across sibling headroom', () => {
        const view = threeFlexible();
        view.attachTo(container);

        assert.equal(view._applyRelative(0, 0.5), true);
        const minShare = 32 / 588;
        assert.ok(view._ratios[1] > minShare, 'sibling 1 grows above its minimum');
        assert.ok(view._ratios[2] > minShare, 'sibling 2 grows above its minimum');
        assert.ok(Math.abs(view._ratios.reduce((a, r) => a + r, 0) - 1) < 1e-6);
    });

    it('rejects an authoritative request that would starve siblings', () => {
        const view = threeFlexible();
        view.attachTo(container);
        const before = [...view._ratios];

        // 99% of the span leaves less than the two siblings' 32px minimums combined.
        assert.equal(view._applyTargetShare(0, 0.99, 'maximize'), false);
        assert.deepEqual(view._ratios, before, 'ratios are unchanged on rejection');
    });

    it('desiredSize hints do not capture the restore baseline', () => {
        const view = threeFlexible();
        view.attachTo(container);

        assert.equal(view._applyTargetShare(0, 0.3, 'desiredSize'), true);
        assert.equal(view._previousRatios, null, 'a hint must not clobber the drag baseline');
    });

    it('maximize captures the restore baseline', () => {
        const view = threeFlexible();
        view.attachTo(container);

        assert.equal(view._applyTargetShare(0, 0.3, 'maximize'), true);
        assert.ok(Array.isArray(view._previousRatios), 'an authoritative action captures the baseline');
    });
});
