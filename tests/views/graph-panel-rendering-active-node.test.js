import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    GraphPanelRendering,
    orderNodeIdsForDrawing,
    orderNodeIdsForHitTesting,
} from '../../src/micro_otter/nodes/html/js/views/graph-panel-rendering.js';

function createContext() {
    return {
        save() {},
        restore() {},
        beginPath() {},
        roundRect() {},
        fill() {},
        stroke() {},
        fillRect() {},
        strokeStyle: '',
        lineWidth: 0,
        fillStyle: '',
    };
}

function createNodeUi(id, drawOrder) {
    return {
        setSelected() {},
        getBounds() {
            return { x: 0, y: 0, width: 100, height: 50 };
        },
        draw() {
            drawOrder.push(id);
        },
    };
}

function createRendering() {
    return new GraphPanelRendering({
        constants: {},
        viewport: {
            screenToWorld: (point) => point,
        },
        connectionsUi: {
            drawConnections() {},
            drawTempConnection() {},
        },
    });
}

describe('orderNodeIdsForDrawing', () => {
    it('moves the active node to the end', () => {
        assert.deepEqual(orderNodeIdsForDrawing(['a', 'b', 'c'], 'b'), ['a', 'c', 'b']);
    });

    it('ignores an unknown or missing active node', () => {
        assert.deepEqual(orderNodeIdsForDrawing(['a', 'b'], 'z'), ['a', 'b']);
        assert.deepEqual(orderNodeIdsForDrawing(['a', 'b'], null), ['a', 'b']);
        assert.deepEqual(orderNodeIdsForDrawing(['a', 'b'], undefined), ['a', 'b']);
    });

    it('handles an empty list', () => {
        assert.deepEqual(orderNodeIdsForDrawing([], 'a'), []);
    });
});

describe('orderNodeIdsForHitTesting', () => {
    it('checks the active node first, then reverse draw order', () => {
        assert.deepEqual(orderNodeIdsForHitTesting(['a', 'b', 'c'], 'b'), ['b', 'c', 'a']);
    });

    it('falls back to reverse draw order without an active node', () => {
        assert.deepEqual(orderNodeIdsForHitTesting(['a', 'b', 'c'], null), ['c', 'b', 'a']);
    });

    it('ignores an unknown active node', () => {
        assert.deepEqual(orderNodeIdsForHitTesting(['a', 'b', 'c'], 'z'), ['c', 'b', 'a']);
    });
});

describe('GraphPanelRendering.drawNodes active node ordering', () => {
    it('draws the active node last', () => {
        const rendering = createRendering();
        const drawOrder = [];
        const nodeUiMap = new Map([
            ['a', createNodeUi('a', drawOrder)],
            ['b', createNodeUi('b', drawOrder)],
            ['c', createNodeUi('c', drawOrder)],
        ]);

        rendering.drawNodes(createContext(), {
            nodeUiMap,
            nodeOrderList: ['a', 'b', 'c'],
            selectedNodeIds: new Set(),
            activeNodeId: 'b',
        });

        assert.deepEqual(drawOrder, ['a', 'c', 'b']);
    });
});
