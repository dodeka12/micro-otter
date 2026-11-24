// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for GraphPanelView._alignNodesToGrid() (duck-typed view, no DOM).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

const GRID_STEP = 32;

function createGraph(nodes) {
    const nodeMap = new Map(nodes.map((node) => [node.id, { ...node }]));
    const calls = { updateNode: [], startNodeDrag: [], endNodeDrag: [] };

    return {
        calls,
        nodeMap,
        getNodeIds: () => [...nodeMap.keys()],
        getNode: (nodeId) => nodeMap.get(nodeId) || null,
        startNodeDrag: (nodeId) => calls.startNodeDrag.push(nodeId),
        endNodeDrag: (nodeId) => calls.endNodeDrag.push(nodeId),
        updateNode: (nodeId, patch) => {
            calls.updateNode.push({ nodeId, patch });
            const node = nodeMap.get(nodeId);
            if (node) {
                Object.assign(node, patch);
            }
        },
    };
}

function createHistoryManager(events, { onUpdate = null } = {}) {
    return {
        beginGroup: (description) => events.push({ type: 'begin', description }),
        endGroup: () => events.push({ type: 'end' }),
        onUpdate,
    };
}

function createViewLike({ graph, historyManager = null, renderPanel = () => {} }) {
    return {
        graph,
        collection: historyManager ? { getHistoryManager: () => historyManager } : null,
        viewportModule: {
            snapToGrid: (x, y, width = 0, height = 0) => ({
                x: Math.round(x / GRID_STEP) * GRID_STEP,
                y: Math.round(y / GRID_STEP) * GRID_STEP,
                width,
                height,
            }),
        },
        t: (key) => key,
        renderPanel,
    };
}

describe('GraphPanelView._alignNodesToGrid', () => {
    it('snaps every off-grid node in a single history group', () => {
        const graph = createGraph([
            { id: 'node-a', x: 5, y: 3, width: 100, height: 50 },
            { id: 'node-b', x: 40, y: 70, width: 100, height: 50 },
            { id: 'node-c', x: 11, y: 17, width: 80, height: 40 },
        ]);
        const historyEvents = [];
        let renderCalls = 0;
        const viewLike = createViewLike({
            graph,
            historyManager: createHistoryManager(historyEvents),
            renderPanel: () => {
                renderCalls += 1;
            },
        });

        GraphPanelView.prototype._alignNodesToGrid.call(viewLike);

        assert.deepEqual(graph.calls.updateNode, [
            { nodeId: 'node-a', patch: { x: 0, y: 0 } },
            { nodeId: 'node-b', patch: { x: 32, y: 64 } },
            { nodeId: 'node-c', patch: { x: 0, y: 32 } },
        ]);
        assert.deepEqual(graph.calls.startNodeDrag, ['node-a', 'node-b', 'node-c']);
        assert.deepEqual(graph.calls.endNodeDrag, ['node-a', 'node-b', 'node-c']);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'graph.toolbar.alignToGridUndo' },
            { type: 'end' },
        ]);
        assert.equal(renderCalls, 1, 'Expected a single repaint');
    });

    it('is a silent no-op when every node is already aligned', () => {
        const graph = createGraph([
            { id: 'node-a', x: 0, y: 0, width: 100, height: 50 },
            { id: 'node-b', x: 64, y: 32, width: 100, height: 50 },
        ]);
        const historyEvents = [];
        let renderCalls = 0;
        const viewLike = createViewLike({
            graph,
            historyManager: createHistoryManager(historyEvents),
            renderPanel: () => {
                renderCalls += 1;
            },
        });

        GraphPanelView.prototype._alignNodesToGrid.call(viewLike);

        assert.deepEqual(graph.calls.updateNode, []);
        assert.deepEqual(historyEvents, []);
        assert.equal(renderCalls, 0);
    });

    it('only writes nodes that are off grid', () => {
        const graph = createGraph([
            { id: 'aligned', x: 32, y: 32, width: 100, height: 50 },
            { id: 'offgrid', x: 47, y: 3, width: 100, height: 50 },
        ]);
        const historyEvents = [];
        const viewLike = createViewLike({
            graph,
            historyManager: createHistoryManager(historyEvents),
        });

        GraphPanelView.prototype._alignNodesToGrid.call(viewLike);

        assert.deepEqual(graph.calls.updateNode, [
            { nodeId: 'offgrid', patch: { x: 32, y: 0 } },
        ]);
        assert.deepEqual(graph.calls.startNodeDrag, ['offgrid']);
        assert.deepEqual(graph.calls.endNodeDrag, ['offgrid']);
    });

    it('still moves nodes when no history manager is available', () => {
        const graph = createGraph([{ id: 'node-a', x: 5, y: 5, width: 100, height: 50 }]);
        const viewLike = createViewLike({ graph, historyManager: null });

        assert.doesNotThrow(() => GraphPanelView.prototype._alignNodesToGrid.call(viewLike));
        assert.equal(graph.calls.updateNode.length, 1);
    });

    it('returns silently when the graph is missing or incomplete', () => {
        let renderCalls = 0;
        const renderPanel = () => {
            renderCalls += 1;
        };

        assert.doesNotThrow(() =>
            GraphPanelView.prototype._alignNodesToGrid.call(
                createViewLike({ graph: null, renderPanel })
            )
        );
        assert.doesNotThrow(() =>
            GraphPanelView.prototype._alignNodesToGrid.call(
                createViewLike({ graph: { getNode: () => null }, renderPanel })
            )
        );
        assert.equal(renderCalls, 0);
    });

    it('closes the history group even when a node update throws', () => {
        const historyEvents = [];
        const graph = createGraph([
            { id: 'node-a', x: 5, y: 5, width: 100, height: 50 },
            { id: 'node-b', x: 47, y: 47, width: 100, height: 50 },
        ]);
        const originalUpdateNode = graph.updateNode;
        graph.updateNode = (nodeId, patch) => {
            if (nodeId === 'node-b') {
                throw new Error('update failed');
            }
            originalUpdateNode(nodeId, patch);
        };
        const viewLike = createViewLike({
            graph,
            historyManager: createHistoryManager(historyEvents),
        });

        assert.throws(
            () => GraphPanelView.prototype._alignNodesToGrid.call(viewLike),
            /update failed/
        );
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'graph.toolbar.alignToGridUndo' },
            { type: 'end' },
        ]);
    });
});
