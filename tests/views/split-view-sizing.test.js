// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for the pure SplitView sizing solver
 * @module tests/views/split-view-sizing
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    SPLIT_VIEW_SPLITTER_THICKNESS,
    computePaneSpan,
    distributeEqual,
    fillerFlexFactor,
    resolvePaneSizes,
    scaledFlexFactors,
    sizesToShares,
} from '../../src/micro_otter/nodes/html/js/views/split-view-sizing.js';

/** Build a pane spec with sensible defaults. */
function pane({ min = 0, max = Infinity, fixed = false } = {}) {
    return { minSize: min, maxSize: max, fixed };
}

/** Assert two number arrays are close within a tolerance. */
function assertClose(actual, expected, tolerance = 1e-6, message = '') {
    assert.equal(actual.length, expected.length, `${message} length mismatch`);
    for (let i = 0; i < actual.length; i++) {
        assert.ok(
            Math.abs(actual[i] - expected[i]) <= tolerance,
            `${message} index ${i}: expected ${expected[i]}, got ${actual[i]}`
        );
    }
}

describe('split-view-sizing splitter thickness', () => {
    it('declares 6px active and 4px inactive splitter boxes', () => {
        assert.equal(SPLIT_VIEW_SPLITTER_THICKNESS.active, 6);
        assert.equal(SPLIT_VIEW_SPLITTER_THICKNESS.inactive, 4);
    });
});

describe('computePaneSpan', () => {
    it('subtracts 6px per movable splitter with no gap', () => {
        assert.equal(computePaneSpan({ hostSpan: 600, gap: 0, splitterMovable: [true, true] }), 588);
    });

    it('mixes active and inactive splitter thicknesses', () => {
        assert.equal(computePaneSpan({ hostSpan: 600, gap: 0, splitterMovable: [false, true] }), 590);
    });

    it('subtracts gaps between every pair of adjacent flex items', () => {
        // 2 splitters => 4 inter-item gaps of 4px each.
        assert.equal(computePaneSpan({ hostSpan: 600, gap: 4, splitterMovable: [true, true] }), 572);
    });

    it('clamps the span at zero when the splitter space exceeds the host', () => {
        assert.equal(computePaneSpan({ hostSpan: 5, gap: 0, splitterMovable: [true, true] }), 0);
    });
});

describe('distributeEqual', () => {
    it('splits space equally when every pane is unconstrained', () => {
        assertClose(distributeEqual(800, Array.from({ length: 5 }, () => pane())), [
            160, 160, 160, 160, 160,
        ]);
    });

    it('gives fixed panes their minimum and re-equalizes the rest', () => {
        const panes = [pane({ min: 32 }), pane({ min: 32, max: 32, fixed: true }), pane({ min: 32 })];
        assertClose(distributeEqual(590, panes), [279, 32, 279]);
    });

    it('freezes panes at their maxSize and hands the remainder to the others', () => {
        const panes = [
            pane({ min: 32, max: 114 }),
            pane({ min: 32, max: 154 }),
            pane({ min: 32, max: 194 }),
        ];
        const sizes = distributeEqual(588, panes);
        assertClose(sizes, [114, 154, 194]);
        assert.ok(sizes.reduce((a, s) => a + s, 0) <= 588, 'sum must not exceed the span');
    });

    it('enforces a minSize above the equal share', () => {
        const panes = [pane({ min: 100 }), pane({ min: 0 })];
        assertClose(distributeEqual(120, panes), [100, 20]);
    });

    it('scales minimums down proportionally when the layout is tight', () => {
        const panes = [pane({ min: 80 }), pane({ min: 80 }), pane({ min: 80 })];
        const sizes = distributeEqual(120, panes);
        assertClose(sizes, [40, 40, 40]);
        assert.ok(sizes.reduce((a, s) => a + s, 0) <= 120);
    });

    it('returns zeros for a non-positive span', () => {
        assert.deepEqual(distributeEqual(0, [pane(), pane()]), [0, 0]);
        assert.deepEqual(distributeEqual(-10, [pane(), pane()]), [0, 0]);
    });

    it('handles a single pane', () => {
        assertClose(distributeEqual(300, [pane({ min: 10 })]), [300]);
    });
});


describe('resolvePaneSizes', () => {
    const five = () => Array.from({ length: 5 }, () => pane({ min: 32 }));

    it('caps a fair hint at the equal share', () => {
        const sizes = resolvePaneSizes(776, five(), { index: 0, size: 656, mode: 'fair' });
        assert.ok(sizes, 'a fair request always resolves');
        assert.ok(Math.abs(sizes[0] - 776 / 5) < 1e-6, `granted ${sizes[0]}, expected ~155.2`);
        assert.ok(sizes.every((s) => s >= 32));
    });

    it('honours a fair hint below the equal share and redistributes equally', () => {
        const panes = [pane({ min: 0 }), pane({ min: 0 }), pane({ min: 0 })];
        const sizes = resolvePaneSizes(300, panes, { index: 0, size: 60, mode: 'fair' });
        assertClose(sizes, [60, 120, 120]);
    });

    it('re-equalizes around fixed siblings when the fair hint exceeds the equal share', () => {
        const panes = [
            pane({ min: 32 }),
            pane({ min: 32, max: 32, fixed: true }),
            pane({ min: 32 }),
            pane({ min: 32, max: 32, fixed: true }),
            pane({ min: 32 }),
        ];
        const sizes = resolvePaneSizes(776, panes, { index: 0, size: 648, mode: 'fair' });
        assert.ok(sizes, 'a fair request always resolves');
        assert.ok(Math.abs(sizes[0] - (776 - 64) / 3) < 1e-6);
        assert.equal(sizes[1], 32);
        assert.equal(sizes[3], 32);
    });

    it('lets an authoritative request squeeze siblings to their minimum', () => {
        const sizes = resolvePaneSizes(776, five(), { index: 0, size: 648, mode: 'authoritative' });
        assert.ok(sizes, 'an authoritative request that fits resolves');
        assertClose(sizes, [648, 32, 32, 32, 32]);
    });

    it('distributes authoritative leftover across sibling headroom', () => {
        const panes = [pane({ min: 32 }), pane({ min: 32 }), pane({ min: 32 })];
        const sizes = resolvePaneSizes(300, panes, { index: 0, size: 100, mode: 'authoritative' });
        assert.ok(sizes, 'an authoritative request that fits resolves');
        assertClose(sizes, [100, 100, 100]);
    });

    it('rejects an authoritative request that cannot fit', () => {
        const panes = [pane({ min: 60 }), pane({ min: 60 })];
        const sizes = resolvePaneSizes(100, panes, { index: 0, size: 50, mode: 'authoritative' });
        assert.equal(sizes, null);
    });

    it('rejects an out-of-range request index', () => {
        assert.equal(resolvePaneSizes(100, [pane()], { index: 3, size: 50, mode: 'fair' }), null);
    });

    it('returns equal distribution when no request is given', () => {
        const sizes = resolvePaneSizes(300, [pane({ min: 0 }), pane({ min: 0 })]);
        assertClose(sizes, [150, 150]);
    });
});

describe('sizesToShares', () => {
    it('converts sizes to shares of the available span', () => {
        assertClose(sizesToShares([150, 150], 300), [0.5, 0.5]);
    });

    it('returns zeros when the span is not positive', () => {
        assert.deepEqual(sizesToShares([150, 150], 0), [0, 0]);
        assert.deepEqual(sizesToShares([150, 150], -1), [0, 0]);
    });
});

describe('scaledFlexFactors', () => {
    it('lifts the smallest positive share to one', () => {
        assert.equal(scaledFlexFactors([0.2, 0.2, 0.2, 0.2, 0.2]), 5);
        assert.ok(scaledFlexFactors([0.5, 0.25]) === 4);
    });

    it('returns one when there are no positive shares', () => {
        assert.equal(scaledFlexFactors([]), 1);
        assert.equal(scaledFlexFactors([0, 0]), 1);
    });
});

describe('fillerFlexFactor', () => {
    it('matches the splitter-test filler expectation for three capped panes', () => {
        const shares = [114 / 588, 154 / 588, 194 / 588];
        assert.ok(Math.abs(fillerFlexFactor(shares) - 126 / 114) < 1e-9);
    });

    it('is zero when the shares already fill the span', () => {
        assert.equal(fillerFlexFactor([0.5, 0.5]), 0);
    });
});
