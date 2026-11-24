import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelRendering } from '../../src/micro_otter/nodes/html/js/views/graph-panel-rendering.js';

function createRenderContext() {
    return {
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fill() {},
        fillRect() {},
        closePath() {},
        strokeStyle: '',
        lineWidth: 0,
        lineCap: '',
        fillStyle: '',
    };
}

function createNodeUi(bounds) {
    return {
        drawCount: 0,
        selectedValues: [],
        getBounds: () => bounds,
        setSelected(selected) {
            this.selectedValues.push(selected);
        },
        draw() {
            this.drawCount += 1;
        },
    };
}

describe('GraphPanelRendering viewport culling', () => {
    it('skips clearly offscreen nodes and keeps partially visible nodes (including selected)', () => {
        const connectionDrawCalls = [];
        const rendering = new GraphPanelRendering({
            constants: {},
            viewport: {
                screenToWorld: (point) => point,
            },
            connectionsUi: {
                drawConnections: (_ctx, options) => {
                    connectionDrawCalls.push(options);
                },
                drawTempConnection: () => {},
            },
        });

        const visibleNode = createNodeUi({ x: 10, y: 10, width: 20, height: 20 });
        const partialSelectedNode = createNodeUi({ x: -6, y: 12, width: 18, height: 18 });
        const offscreenNode = createNodeUi({ x: 180, y: 180, width: 20, height: 20 });

        const nodeUiMap = new Map([
            ['visible', visibleNode],
            ['partial-selected', partialSelectedNode],
            ['offscreen', offscreenNode],
        ]);

        rendering.render(createRenderContext(), 100, 100, {
            showGrid: false,
            nodeUiMap,
            nodeOrderList: ['visible', 'partial-selected', 'offscreen'],
            selectedNodeIds: new Set(['partial-selected']),
        });

        assert.equal(visibleNode.drawCount, 1);
        assert.equal(partialSelectedNode.drawCount, 1);
        assert.equal(offscreenNode.drawCount, 0);

        assert.equal(partialSelectedNode.selectedValues.at(-1), true);
        assert.equal(visibleNode.selectedValues.at(-1), false);

        assert.equal(connectionDrawCalls.length, 1);
        assert.ok(connectionDrawCalls[0].viewportBounds);
    });

    it('keeps drawing nodes without getBounds to avoid false-negative culling', () => {
        const rendering = new GraphPanelRendering({
            constants: {},
            viewport: {
                screenToWorld: (point) => point,
            },
            connectionsUi: {
                drawConnections: () => {},
                drawTempConnection: () => {},
            },
        });

        const nodeWithoutBounds = {
            drawCount: 0,
            setSelected() {},
            draw() {
                this.drawCount += 1;
            },
        };

        rendering.render(createRenderContext(), 100, 100, {
            showGrid: false,
            nodeUiMap: new Map([['node-a', nodeWithoutBounds]]),
            nodeOrderList: ['node-a'],
            selectedNodeIds: new Set(),
        });

        assert.equal(nodeWithoutBounds.drawCount, 1);
    });

    it('forwards interaction quality mode to connection rendering', () => {
        const connectionDrawCalls = [];
        const rendering = new GraphPanelRendering({
            constants: {},
            viewport: {
                screenToWorld: (point) => point,
            },
            connectionsUi: {
                drawConnections: (_ctx, options) => {
                    connectionDrawCalls.push(options);
                },
                drawTempConnection: () => {},
            },
        });

        rendering.render(createRenderContext(), 100, 100, {
            showGrid: false,
            nodeUiMap: new Map(),
            nodeOrderList: [],
            selectedNodeIds: new Set(),
            qualityMode: 'interaction',
        });

        assert.equal(connectionDrawCalls.length, 1);
        assert.equal(connectionDrawCalls[0].qualityMode, 'interaction');
    });

    it('forwards temp connection start metadata for typed drag coloring', () => {
        const tempConnectionCalls = [];
        const rendering = new GraphPanelRendering({
            constants: {},
            viewport: {
                screenToWorld: (point) => point,
            },
            connectionsUi: {
                drawConnections: () => {},
                drawTempConnection: (_ctx, tempConnection, qualityMode) => {
                    tempConnectionCalls.push({ tempConnection, qualityMode });
                },
            },
        });

        rendering.drawTempConnection(
            createRenderContext(),
            {
                start: { x: 10, y: 10 },
                end: { x: 80, y: 30 },
                startKind: 'output',
                startNodeId: 'const-1',
                startIndex: 0,
            },
            'full'
        );

        assert.equal(tempConnectionCalls.length, 1);
        assert.equal(tempConnectionCalls[0].qualityMode, 'full');
        assert.equal(tempConnectionCalls[0].tempConnection.startNodeId, 'const-1');
        assert.equal(tempConnectionCalls[0].tempConnection.startIndex, 0);
    });
});
