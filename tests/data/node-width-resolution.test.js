import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import {
    LEGACY_DEFAULT_NODE_WIDTH,
    clampNodeWidth,
    resolveEffectiveMinWidth,
    resolveNodeWidth,
} from '../../src/micro_otter/nodes/html/js/data/node-width.js';

describe('node-width resolution utility', () => {
    it('applies precedence: instance width -> default width -> legacy fallback', () => {
        assert.equal(resolveNodeWidth({ instanceWidth: 210, defaultWidth: 180 }), 210);
        assert.equal(resolveNodeWidth({ instanceWidth: null, defaultWidth: 180 }), 180);
        assert.equal(
            resolveNodeWidth({ instanceWidth: null, defaultWidth: null }),
            LEGACY_DEFAULT_NODE_WIDTH
        );
    });

    it('treats missing or invalid instance width as absent', () => {
        assert.equal(resolveNodeWidth({ instanceWidth: NaN, defaultWidth: 170 }), 170);
        assert.equal(resolveNodeWidth({ instanceWidth: -10, defaultWidth: 170 }), 170);
        assert.equal(resolveNodeWidth({ instanceWidth: 0, defaultWidth: 170 }), 170);
    });

    it('clamps resolved width against provided bounds', () => {
        assert.equal(resolveNodeWidth({ instanceWidth: 80, minWidth: 120 }), 120);
        assert.equal(resolveNodeWidth({ instanceWidth: 420, maxWidth: 260 }), 260);
        assert.equal(resolveNodeWidth({ instanceWidth: 200, minWidth: 160, maxWidth: 240 }), 200);
    });

    it('normalizes width values to integer pixels', () => {
        assert.equal(resolveNodeWidth({ instanceWidth: 180.6 }), 181);
        assert.equal(clampNodeWidth(99.4, { minWidth: 100.6, maxWidth: null }), 101);
    });
});

describe('resolveEffectiveMinWidth utility', () => {
    it('takes the stricter of the node type minimum and the content minimum', () => {
        assert.equal(resolveEffectiveMinWidth(120, 180), 180);
        assert.equal(resolveEffectiveMinWidth(200, 160), 200);
        assert.equal(resolveEffectiveMinWidth(140, 140), 140);
    });

    it('uses whichever bound is usable', () => {
        assert.equal(resolveEffectiveMinWidth(120, undefined), 120);
        assert.equal(resolveEffectiveMinWidth(undefined, 180), 180);
        assert.equal(resolveEffectiveMinWidth(null, 0), 0);
    });

    it('returns null when neither bound is usable', () => {
        assert.equal(resolveEffectiveMinWidth(undefined, undefined), null);
        assert.equal(resolveEffectiveMinWidth(Number.NaN, Number.POSITIVE_INFINITY), null);
        assert.equal(resolveEffectiveMinWidth(-20, -1), null);
        assert.equal(resolveEffectiveMinWidth('120', 100), 100);
    });

    it('feeds the node width resolution with the content minimum', () => {
        assert.equal(
            resolveNodeWidth({ instanceWidth: 60, minWidth: resolveEffectiveMinWidth(120, 180) }),
            180
        );
        assert.equal(
            resolveNodeWidth({ instanceWidth: 240, minWidth: resolveEffectiveMinWidth(120, 180) }),
            240
        );
    });
});

describe('NodeData width normalization', () => {
    it('normalizes loaded width through shared resolver path', () => {
        const missingWidthNode = NodeData.fromData({ id: '1', type: 'test' });
        assert.equal(missingWidthNode.width, LEGACY_DEFAULT_NODE_WIDTH);

        const invalidWidthNode = NodeData.fromData({ id: '2', type: 'test', width: -1 });
        assert.equal(invalidWidthNode.width, LEGACY_DEFAULT_NODE_WIDTH);

        const roundedWidthNode = NodeData.fromData({ id: '3', type: 'test', width: 199.7 });
        assert.equal(roundedWidthNode.width, 200);
    });
});
