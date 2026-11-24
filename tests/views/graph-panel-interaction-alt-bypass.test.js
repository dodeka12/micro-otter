import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

function createSelection() {
    return {
        selectedNodes: new Set(),
        selectionBox: null,
        _isBoxSelecting: false,
        startBoxSelection() {},
        updateBoxSelection() {},
        finishBoxSelection() {
            return [];
        },
        clearSelection() {},
        addToSelection() {},
        getSelectedNodeIds() {
            return [];
        },
    };
}

function createInteraction(graph, overrides = {}) {
    return new GraphPanelInteraction({
        viewport: {
            viewport: { scale: 1, translateX: 0, translateY: 0 },
            screenToWorld(point) {
                return point;
            },
            setViewport() {},
        },
        constants: { GRID_SPACING: 32 },
        selection: createSelection(),
        hitTestNode: () => null,
        hitTestConnector: () => null,
        hitTestConnection: () => null,
        onInvalidate: () => {},
        getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
        setCursor: () => {},
        clampToGrid: (x, y) => ({ x, y }),
        graph,
        nodeUiMap: new Map(),
        connectionsUi: {
            hoverConnector: null,
            setHoverConnector() {},
            setHoverConnection() {},
            setTempConnection() {},
        },
        clipboardManager: { hasData: () => false },
        logger: () => {},
        ...overrides,
    });
}

function createGestureEvent({ clientX, clientY, altKey = false, ctrlKey = false }) {
    return {
        preventDefault() {},
        clientX,
        clientY,
        button: 0,
        altKey,
        ctrlKey,
        metaKey: false,
        shiftKey: false,
        buttons: 1,
    };
}

function createElementGraph() {
    const graph = new NodeGraph({ id: 'graph-bypass' });
    graph.setDataTypeDefinitionLookup((typeId) =>
        typeId === 'web.element'
            ? { connectionPolicy: { input: { maxConnections: 1 } } }
            : null
    );
    return graph;
}


describe('GraphPanelInteraction alt+drag bypass with real NodeGraph', () => {
    it('bypasses a pass-through node under input maxConnections=1', () => {
        const graph = createElementGraph();
        const source = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const insert = graph.addNode({
            type: 'insert',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: insert.id, toIndex: 0 });
        graph.addConnection({ fromNode: insert.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const interaction = createInteraction(graph);
        assert.equal(interaction._canBypassNode(insert.id), true);
        assert.equal(interaction._tryBypassNode(insert.id), true);

        const connections = graph.getConnections();
        assert.equal(connections.length, 1);
        assert.deepEqual(connections[0], {
            fromNode: source.id,
            fromIndex: 0,
            toNode: target.id,
            toIndex: 0,
        });
    });

    it('preserves the downstream input index', () => {
        const graph = createElementGraph();
        const source = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const insert = graph.addNode({
            type: 'insert',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [
                { id: 'in0', allowedTypes: ['web.bool'] },
                { id: 'in1', allowedTypes: ['web.element'] },
            ],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: insert.id, toIndex: 0 });
        graph.addConnection({ fromNode: insert.id, fromIndex: 0, toNode: target.id, toIndex: 1 });

        const interaction = createInteraction(graph);
        assert.equal(interaction._tryBypassNode(insert.id), true);

        const connections = graph.getConnections();
        assert.equal(connections.length, 1);
        assert.equal(connections[0].toNode, target.id);
        assert.equal(connections[0].toIndex, 1);
        assert.equal(connections[0].fromNode, source.id);
    });

    it('bypasses every outgoing edge for a fan-out node', () => {
        const graph = createElementGraph();
        const source = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const insert = graph.addNode({
            type: 'insert',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
            outputs: [
                { id: 'out0', outputType: 'web.element' },
                { id: 'out1', outputType: 'web.element' },
            ],
        });
        const targetA = graph.addNode({
            type: 'targetA',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });
        const targetB = graph.addNode({
            type: 'targetB',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: insert.id, toIndex: 0 });
        graph.addConnection({ fromNode: insert.id, fromIndex: 0, toNode: targetA.id, toIndex: 0 });
        graph.addConnection({ fromNode: insert.id, fromIndex: 1, toNode: targetB.id, toIndex: 0 });

        const interaction = createInteraction(graph);
        assert.equal(interaction._tryBypassNode(insert.id), true);

        const connections = graph.getConnections();
        assert.equal(connections.length, 2);
        assert.ok(
            connections.some((conn) => conn.fromNode === source.id && conn.toNode === targetA.id)
        );
        assert.ok(
            connections.some((conn) => conn.fromNode === source.id && conn.toNode === targetB.id)
        );
    });
});


describe('GraphPanelInteraction alt+drag bypass edge cases', () => {
    function createFakeGraph({ connections, canConnect, failOnAdd = () => false }) {
        const list = [...connections];
        return {
            getConnections() {
                return [...list];
            },
            getNode(nodeId) {
                return { id: nodeId, inputs: [{ id: 'in0' }], outputs: [{ id: 'out0' }] };
            },
            canConnect,
            addConnection(connection) {
                if (failOnAdd(connection)) {
                    throw new Error('addConnection failed');
                }
                list.push({ ...connection });
            },
            removeConnection(fromNode, fromIndex, toNode, toIndex) {
                const before = list.length;
                const remaining = list.filter(
                    (conn) =>
                        !(
                            conn.fromNode === fromNode &&
                            conn.fromIndex === fromIndex &&
                            conn.toNode === toNode &&
                            conn.toIndex === toIndex
                        )
                );
                list.length = 0;
                list.push(...remaining);
                return remaining.length !== before;
            },
        };
    }

    it('rolls back when adding a bypass edge fails', () => {
        const original = [
            { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
            { fromNode: 'insert', fromIndex: 0, toNode: 'target', toIndex: 0 },
        ];
        const graph = createFakeGraph({
            connections: original,
            canConnect() {
                return { valid: true };
            },
            failOnAdd: (connection) =>
                connection.fromNode === 'source' && connection.toNode === 'target',
        });
        const interaction = createInteraction(graph);

        assert.equal(interaction._tryBypassNode('insert'), false);
        assert.deepEqual(graph.getConnections(), original);
    });

    it('returns false when a node has only an incoming connection', () => {
        const graph = createFakeGraph({
            connections: [{ fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 }],
            canConnect() {
                return { valid: true };
            },
        });
        const interaction = createInteraction(graph);

        assert.equal(interaction._canBypassNode('insert'), false);
        assert.equal(interaction._tryBypassNode('insert'), false);
    });
});

describe('GraphPanelInteraction alt+drag gesture', () => {
    function createPassThroughGraph() {
        const graph = createElementGraph();
        const source = graph.addNode({
            type: 'source',
            x: 0,
            y: 0,
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const insert = graph.addNode({
            type: 'insert',
            x: 100,
            y: 100,
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            type: 'target',
            x: 300,
            y: 100,
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: insert.id, toIndex: 0 });
        graph.addConnection({ fromNode: insert.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        return { graph, source, insert, target };
    }

    it('bypasses the node once an alt+drag passes the movement threshold', () => {
        const { graph, source, insert, target } = createPassThroughGraph();
        const interaction = createInteraction(graph, {
            hitTestNode: () => ({ id: insert.id, x: 100, y: 100, width: 140, height: 90 }),
        });

        const historyEvents = [];
        const historyContext = {
            beginHistoryGroup: (description) => historyEvents.push({ type: 'begin', description }),
            endHistoryGroup: () => historyEvents.push({ type: 'end' }),
        };

        interaction.handleMouseDown(
            createGestureEvent({ clientX: 120, clientY: 120, altKey: true }),
            historyContext
        );

        // No movement yet: the bypass is deferred.
        assert.equal(graph.getConnections().length, 2);

        interaction.handleMouseMove(
            createGestureEvent({ clientX: 130, clientY: 120, altKey: true }),
            historyContext
        );

        assert.deepEqual(graph.getConnections(), [
            { fromNode: source.id, fromIndex: 0, toNode: target.id, toIndex: 0 },
        ]);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Alt+Drag bypass node' },
            { type: 'end' },
        ]);
        assert.equal(interaction.interaction.draggingNodeId, insert.id);
    });

    it('keeps alt+click as a selection toggle when the pointer does not move', () => {
        const { graph, insert } = createPassThroughGraph();
        const interaction = createInteraction(graph, {
            hitTestNode: () => ({ id: insert.id, x: 100, y: 100, width: 140, height: 90 }),
        });

        const toggledNodeIds = [];
        const selectionContext = {
            toggleSelection: (nodeId) => toggledNodeIds.push(nodeId),
        };

        interaction.handleMouseDown(
            createGestureEvent({ clientX: 120, clientY: 120, altKey: true }),
            selectionContext
        );
        interaction.handleMouseUp(selectionContext);

        assert.deepEqual(toggledNodeIds, [insert.id]);
        assert.equal(graph.getConnections().length, 2);
        assert.equal(interaction.interaction.draggingNodeId, null);
    });

    it('does not bypass on ctrl+drag any more', () => {
        const { graph, insert } = createPassThroughGraph();
        const interaction = createInteraction(graph, {
            hitTestNode: () => ({ id: insert.id, x: 100, y: 100, width: 140, height: 90 }),
        });

        const copy = graph.addNode({ type: 'insert', x: 100, y: 100 });
        const duplicateCalls = [];

        interaction.handleMouseDown(
            createGestureEvent({ clientX: 120, clientY: 120, ctrlKey: true }),
            {}
        );
        interaction.handleMouseMove(createGestureEvent({ clientX: 140, clientY: 120, ctrlKey: true }), {
            duplicateNodesForDrag: (nodeIds) => {
                duplicateCalls.push(nodeIds);
                return { originalNodeIds: [insert.id], newNodeIds: [copy.id] };
            },
        });

        assert.deepEqual(duplicateCalls, [[insert.id]]);
        assert.equal(graph.getConnections().length, 2);
        assert.equal(interaction._pendingAltBypass, null);
        assert.equal(interaction.interaction.draggingNodeId, copy.id);
    });
});
