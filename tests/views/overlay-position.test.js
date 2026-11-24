// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for the pure anchored-position math used by side-opening child menus.
 *
 * The helper does no measuring itself, so these tests feed explicit rectangles and viewports.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { computeAnchoredPosition } from '../../src/micro_otter/nodes/html/js/views/overlay-position.js';

const VIEWPORT = { width: 1024, height: 768 };
const CHILD = { width: 200, height: 100 };

/**
 * Build a rectangle from its top-left corner and size.
 * @param {number} left - Left offset.
 * @param {number} top - Top offset.
 * @param {number} width - Rect width.
 * @param {number} height - Rect height.
 * @returns {object} Rectangle with left/right/top/bottom.
 */
function rect(left, top, width, height) {
    return { left, top, right: left + width, bottom: top + height };
}

describe('computeAnchoredPosition', () => {
    it('opens to the right when the child fits there', () => {
        const placed = computeAnchoredPosition(rect(100, 100, 120, 20), CHILD, {
            viewport: VIEWPORT,
        });
        assert.deepEqual(placed, { x: 222, y: 100, side: 'right' });
    });

    it('flips to the left at the right edge', () => {
        const placed = computeAnchoredPosition(rect(900, 100, 90, 20), CHILD, {
            viewport: VIEWPORT,
        });
        assert.equal(placed.side, 'left');
        assert.equal(placed.x, 698, 'left edge of the child sits left of the anchor');
    });

    it('respects an explicit left placement', () => {
        const placed = computeAnchoredPosition(rect(500, 100, 100, 20), CHILD, {
            viewport: VIEWPORT,
            placement: 'left',
        });
        assert.deepEqual(placed, { x: 298, y: 100, side: 'left' });
    });

    it('flips back to the right when a left placement does not fit', () => {
        const placed = computeAnchoredPosition(rect(20, 100, 100, 20), CHILD, {
            viewport: VIEWPORT,
            placement: 'left',
        });
        assert.equal(placed.side, 'right');
        assert.equal(placed.x, 122);
    });

    it('clamps the child at the bottom edge', () => {
        const placed = computeAnchoredPosition(rect(100, 700, 120, 20), CHILD, {
            viewport: VIEWPORT,
        });
        assert.equal(placed.y, 660, 'bottom margin keeps the child inside the viewport');
        assert.equal(placed.side, 'right');
    });

    it('never returns a negative position', () => {
        const placed = computeAnchoredPosition(rect(100, 0, 180, 20), CHILD, {
            viewport: { width: 300, height: 200 },
        });
        assert.equal(placed.side, 'left', 'left side has more room but not enough for the child');
        assert.equal(placed.x, 0, 'child is pushed to the left edge instead of going negative');
        assert.equal(placed.y, 8);
    });

    it('honours gap and margin', () => {
        const placed = computeAnchoredPosition(rect(0, 0, 0, 0), CHILD, {
            viewport: VIEWPORT,
            gap: 10,
            margin: 20,
        });
        assert.equal(placed.x, 10, 'gap separates anchor and child');
        assert.equal(placed.y, 20, 'margin keeps the child away from the top edge');

        const atEdge = computeAnchoredPosition(rect(900, 0, 90, 20), CHILD, {
            viewport: VIEWPORT,
            margin: 20,
        });
        assert.equal(atEdge.side, 'left');
        assert.equal(atEdge.x, 698);
    });

    it('picks the roomier side when neither side fits', () => {
        const placed = computeAnchoredPosition(rect(120, 50, 20, 20), CHILD, {
            viewport: { width: 300, height: 200 },
        });
        assert.equal(placed.side, 'right');
        assert.equal(placed.x, 92, 'child is pushed back inside the viewport');
        assert.equal(placed.y, 50);
    });

    it('falls back to the window viewport when none is passed', () => {
        const harness = createDomHarness();

        try {
            const placed = computeAnchoredPosition(rect(0, 0, 0, 0), CHILD);
            assert.deepEqual(placed, { x: 2, y: 8, side: 'right' });
            assert.equal(harness.window.innerWidth, 1024, 'JSDOM reports the default viewport');
        } finally {
            harness.cleanup();
        }
    });
});
