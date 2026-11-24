import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

function createGraph({
    initialConnections,
    canConnect,
    nodeById,
}) {
    const connections = [...initialConnections];

    return {
        connections,
        startNodeDragCalls: [],
        endNodeDragCalls: [],
        getConnections() {
            return [...connections];
        },
        getNode(nodeId) {
            return nodeById[nodeId] || null;
        },
        canConnect,
        addConnection(connection) {
            connections.push({ ...connection });
        },
        removeConnection(fromNode, fromIndex, toNode, toIndex) {
            const before = connections.length;
            const remaining = connections.filter(
                (connection) =>
                    !(
                        connection.fromNode === fromNode &&
                        connection.fromIndex === fromIndex &&
                        connection.toNode === toNode &&
                        connection.toIndex === toIndex
                    )
            );
            connections.length = 0;
            connections.push(...remaining);
            return remaining.length !== before;
        },
        removeNode(nodeId) {
            const before = connections.length;
            const remaining = connections.filter(
                (connection) => connection.fromNode !== nodeId && connection.toNode !== nodeId
            );
            connections.length = 0;
            connections.push(...remaining);
            return before !== remaining.length || Boolean(nodeById[nodeId]);
        },
        startNodeDrag(nodeId) {
            this.startNodeDragCalls.push(nodeId);
        },
        endNodeDrag(nodeId) {
            this.endNodeDragCalls.push(nodeId);
        },
    };
}

function createInteraction({
    graph,
    hitTestConnection,
    hitTestNode = () => null,
    selectedNodeIds = ['insert'],
    nodeUiEntries = null,
}) {
    const normalizedSelectedNodeIds = [...selectedNodeIds];
    const selection = {
        selectedNodes: new Set(normalizedSelectedNodeIds),
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
            return [...normalizedSelectedNodeIds];
        },
    };

    const viewport = {
        viewport: {
            scale: 1,
            translateX: 0,
            translateY: 0,
        },
        screenToWorld(point) {
            return point;
        },
        setViewport() {},
    };

    const nodeUiMap = nodeUiEntries
        ? new Map(nodeUiEntries)
        : new Map([
              [
                  'insert',
                  {
                      getNodeData() {
                          return { id: 'insert', x: 100, y: 100, width: 140, height: 90 };
                      },
                      setPosition() {},
                      _connectorPositions(kind) {
                          if (kind === 'output') {
                              return [{ x: 180, y: 145 }];
                          }
                          return [];
                      },
                  },
              ],
          ]);

    const hoverConnectionCalls = [];

    const interaction = new GraphPanelInteraction({
        viewport,
        constants: { GRID_SPACING: 32 },
        selection,
        hitTestNode,
        hitTestConnector: () => null,
        hitTestConnection,
        onInvalidate: () => {},
        getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
        setCursor: () => {},
        clampToGrid: (x, y) => ({ x, y }),
        graph,
        nodeUiMap,
        connectionsUi: {
            hoverConnector: null,
            setHoverConnector() {},
            setHoverConnection(connection) {
                hoverConnectionCalls.push(connection);
            },
            setTempConnection() {},
        },
        clipboardManager: { hasData: () => false },
        logger: () => {},
    });

    return { interaction, hoverConnectionCalls };
}

describe('GraphPanelInteraction insert-on-drop', () => {
    it('rewires then deletes selected node on ctrl+delete', () => {
        global.document = { activeElement: null };

        const graph = createGraph({
            initialConnections: [
                { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
                { fromNode: 'insert', fromIndex: 0, toNode: 'target', toIndex: 2 },
            ],
            nodeById: {
                source: { outputs: [{ id: 'out-0' }] },
                insert: {
                    x: 10,
                    y: 20,
                    inputs: [{ id: 'insert-in-0' }],
                    outputs: [{ id: 'insert-out-0' }],
                },
                target: { inputs: [{ id: 'in-0' }, { id: 'in-1' }, { id: 'in-2' }] },
            },
            canConnect(fromNode, fromIndex, toNode, toIndex) {
                if (
                    fromNode === 'source' &&
                    fromIndex === 0 &&
                    toNode === 'target' &&
                    toIndex === 2
                ) {
                    return { valid: true };
                }
                return { valid: false };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => null,
        });

        let deleteSelectedCalled = false;
        const historyEvents = [];
        const result = interaction.handleKeyDown(
            {
                key: 'Delete',
                ctrlKey: true,
                metaKey: false,
                preventDefault() {},
            },
            {
                beginHistoryGroup(description) {
                    historyEvents.push({ type: 'begin', description });
                },
                deleteSelected() {
                    deleteSelectedCalled = true;
                    graph.removeNode('insert');
                },
                endHistoryGroup() {
                    historyEvents.push({ type: 'end' });
                },
            }
        );

        assert.equal(result, true);
        assert.equal(deleteSelectedCalled, true);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Ctrl+Delete bypass node' },
            { type: 'end' },
        ]);
        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 2 },
        ]);
    });

    it('deletes selected node on ctrl+delete when rewiring is not available', () => {
        global.document = { activeElement: null };

        const graph = createGraph({
            initialConnections: [
                { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
            ],
            nodeById: {
                source: { outputs: [{ id: 'out-0' }] },
                insert: {
                    x: 10,
                    y: 20,
                    inputs: [{ id: 'insert-in-0' }],
                    outputs: [{ id: 'insert-out-0' }],
                },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => null,
        });

        interaction.handleKeyDown(
            {
                key: 'Delete',
                ctrlKey: true,
                metaKey: false,
                preventDefault() {},
            },
            {
                deleteSelected() {
                    graph.removeNode('insert');
                },
            }
        );

        assert.deepEqual(graph.getConnections(), []);
    });

    it('inserts an unconnected dragged node into a compatible connection', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect(fromNode, fromIndex, toNode, toIndex) {
                if (
                    fromNode === 'source' &&
                    fromIndex === 0 &&
                    toNode === 'insert' &&
                    toIndex === 0
                ) {
                    return { valid: true };
                }
                if (
                    fromNode === 'insert' &&
                    fromIndex === 0 &&
                    toNode === 'target' &&
                    toIndex === 0
                ) {
                    return { valid: true };
                }
                return { valid: false };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => ({ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }),
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction.handleMouseMove({ clientX: 100, clientY: 100, buttons: 1 });

        const historyEvents = [];
        interaction.handleMouseUp({
            beginHistoryGroup(description) {
                historyEvents.push({ type: 'begin', description });
            },
            endHistoryGroup() {
                historyEvents.push({ type: 'end' });
            },
        });

        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
            { fromNode: 'insert', fromIndex: 0, toNode: 'target', toIndex: 0 },
        ]);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Drag-insert node into connection' },
            { type: 'end' },
        ]);
    });

    it('does not insert when the dragged node is already connected', () => {
        const graph = createGraph({
            initialConnections: [
                { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 },
                { fromNode: 'insert', fromIndex: 0, toNode: 'other', toIndex: 0 },
            ],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => ({ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }),
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction.handleMouseMove({ clientX: 100, clientY: 100, buttons: 1 });
        interaction.handleMouseUp();

        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 },
            { fromNode: 'insert', fromIndex: 0, toNode: 'other', toIndex: 0 },
        ]);
    });

    it('does not insert when compatibility checks fail', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect(fromNode, fromIndex, toNode, toIndex) {
                if (
                    fromNode === 'source' &&
                    fromIndex === 0 &&
                    toNode === 'insert' &&
                    toIndex === 0
                ) {
                    return { valid: true };
                }
                if (
                    fromNode === 'insert' &&
                    fromIndex === 0 &&
                    toNode === 'target' &&
                    toIndex === 0
                ) {
                    return { valid: false, message: 'type mismatch' };
                }
                return { valid: false };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => ({ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }),
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction.handleMouseMove({ clientX: 100, clientY: 100, buttons: 1 });
        interaction.handleMouseUp();

        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 },
        ]);
    });

    it('does not insert on a click without drag movement', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        let hitTestConnectionCalls = 0;
        const { interaction } = createInteraction({
            graph,
            hitTestConnection() {
                hitTestConnectionCalls += 1;
                return { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 };
            },
        });

        interaction.interaction.draggingNodeId = 'insert';
        const historyEvents = [];
        interaction.handleMouseUp({
            beginHistoryGroup(description) {
                historyEvents.push({ type: 'begin', description });
            },
            endHistoryGroup() {
                historyEvents.push({ type: 'end' });
            },
        });

        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 },
        ]);
        assert.deepEqual(historyEvents, []);
        assert.equal(hitTestConnectionCalls, 0);
    });

    it('uses the last drag pointer on release', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const connection = {
            fromNode: 'source',
            fromIndex: 0,
            toNode: 'target',
            toIndex: 0,
        };
        const probes = [];
        const { interaction } = createInteraction({
            graph,
            hitTestConnection(posWorld) {
                probes.push({ x: posWorld.x, y: posWorld.y });
                return Math.hypot(posWorld.x - 250, posWorld.y - 150) <= 3 ? connection : null;
            },
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction.handleMouseMove({ clientX: 250, clientY: 150, buttons: 1 });
        const probesBeforeRelease = probes.length;
        interaction.handleMouseUp();

        assert.ok(probes.length > probesBeforeRelease);
        assert.deepEqual(probes.at(-1), { x: 250, y: 150 });
        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
            { fromNode: 'insert', fromIndex: 0, toNode: 'target', toIndex: 0 },
        ]);
    });

    it('clears the insert preview during a multi-node drag', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
                other: { inputs: [], outputs: [] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const connection = {
            fromNode: 'source',
            fromIndex: 0,
            toNode: 'target',
            toIndex: 0,
        };
        let hitTestConnectionCalls = 0;
        const { interaction, hoverConnectionCalls } = createInteraction({
            graph,
            hitTestConnection() {
                hitTestConnectionCalls += 1;
                return connection;
            },
            nodeUiEntries: [
                [
                    'insert',
                    {
                        getNodeData() {
                            return { id: 'insert', x: 100, y: 100, width: 140, height: 90 };
                        },
                        setPosition() {},
                    },
                ],
                [
                    'other',
                    {
                        getNodeData() {
                            return { id: 'other', x: 300, y: 300, width: 140, height: 90 };
                        },
                        setPosition() {},
                    },
                ],
            ],
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction._dragStartPositions = new Map([
            ['insert', { x: 100, y: 100 }],
            ['other', { x: 300, y: 300 }],
        ]);

        interaction.handleMouseMove({ clientX: 100, clientY: 100, buttons: 1 });

        assert.equal(hoverConnectionCalls.at(-1), null);
        assert.equal(hitTestConnectionCalls, 0);
    });

    it('keeps the preview for a single-entry drag start map', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const connection = {
            fromNode: 'source',
            fromIndex: 0,
            toNode: 'target',
            toIndex: 0,
        };
        const { interaction, hoverConnectionCalls } = createInteraction({
            graph,
            hitTestConnection: () => connection,
            nodeUiEntries: [
                [
                    'insert',
                    {
                        getNodeData() {
                            return { id: 'insert', x: 100, y: 100, width: 140, height: 90 };
                        },
                        setPosition() {},
                    },
                ],
            ],
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction._dragStartPositions = new Map([['insert', { x: 100, y: 100 }]]);

        interaction.handleMouseMove({ clientX: 100, clientY: 100, buttons: 1 });

        assert.deepEqual(hoverConnectionCalls.at(-1), connection);
    });

    it('previews hovered connection while dragging over a valid insertion target', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const { interaction, hoverConnectionCalls } = createInteraction({
            graph,
            hitTestConnection: () => ({ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }),
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction.handleMouseMove({ clientX: 100, clientY: 100, buttons: 1 });

        assert.deepEqual(hoverConnectionCalls.at(-1), {
            fromNode: 'source',
            fromIndex: 0,
            toNode: 'target',
            toIndex: 0,
        });
    });

    it('clears hovered connection preview when insertion is invalid', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: false };
            },
        });

        const { interaction, hoverConnectionCalls } = createInteraction({
            graph,
            hitTestConnection: () => ({ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }),
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction.handleMouseMove({ clientX: 100, clientY: 100, buttons: 1 });

        assert.equal(hoverConnectionCalls.at(-1), null);
    });

    it('probes the pointer position instead of the node centre', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const connection = {
            fromNode: 'source',
            fromIndex: 0,
            toNode: 'target',
            toIndex: 0,
        };
        const probes = [];
        const { interaction, hoverConnectionCalls } = createInteraction({
            graph,
            hitTestConnection(posWorld) {
                probes.push({ x: posWorld.x, y: posWorld.y });
                return Math.hypot(posWorld.x - 320, posWorld.y - 200) <= 3 ? connection : null;
            },
        });

        interaction.interaction.draggingNodeId = 'insert';
        interaction.interaction.dragOffset = { x: 0, y: 0 };
        interaction.handleMouseMove({ clientX: 320, clientY: 200, buttons: 1 });

        assert.deepEqual(probes.at(-1), { x: 320, y: 200 });
        assert.deepEqual(hoverConnectionCalls.at(-1), connection);
    });

    it('does not probe when no pointer position is known', () => {
        const graph = createGraph({
            initialConnections: [{ fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 }],
            nodeById: {
                source: { inputs: [] },
                target: { inputs: [{ id: 'in-0' }] },
                insert: { inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        let hitTestConnectionCalls = 0;
        const { interaction } = createInteraction({
            graph,
            hitTestConnection() {
                hitTestConnectionCalls += 1;
                return { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 0 };
            },
        });

        assert.equal(interaction._getInsertableConnectionPreview('insert'), null);
        assert.equal(hitTestConnectionCalls, 0);
    });

    it('rewires pass-through node on alt+drag preserving the downstream input index', () => {
        const graph = createGraph({
            initialConnections: [
                { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
                { fromNode: 'insert', fromIndex: 0, toNode: 'target', toIndex: 2 },
            ],
            nodeById: {
                source: { outputs: [{ id: 'out-0' }] },
                insert: {
                    x: 10,
                    y: 20,
                    inputs: [{ id: 'insert-in-0' }],
                    outputs: [{ id: 'insert-out-0' }],
                },
                target: { inputs: [{ id: 'in-0' }, { id: 'in-1' }, { id: 'in-2' }] },
            },
            canConnect(fromNode, fromIndex, toNode, toIndex) {
                if (
                    fromNode === 'source' &&
                    fromIndex === 0 &&
                    toNode === 'target' &&
                    toIndex === 2
                ) {
                    return { valid: true };
                }
                return { valid: false };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => null,
            hitTestNode: () => ({ id: 'insert', x: 10, y: 20, width: 140, height: 90 }),
        });

        const historyEvents = [];
        const historyContext = {
            beginHistoryGroup(description) {
                historyEvents.push({ type: 'begin', description });
            },
            endHistoryGroup() {
                historyEvents.push({ type: 'end' });
            },
        };

        interaction.handleMouseDown(
            {
                preventDefault() {},
                clientX: 20,
                clientY: 20,
                button: 0,
                altKey: true,
                ctrlKey: false,
                metaKey: false,
                shiftKey: false,
            },
            historyContext
        );

        // No movement yet: the rewire is deferred, so nothing changed.
        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
            { fromNode: 'insert', fromIndex: 0, toNode: 'target', toIndex: 2 },
        ]);

        interaction.handleMouseMove(
            {
                preventDefault() {},
                clientX: 30,
                clientY: 20,
                button: 0,
                altKey: true,
                ctrlKey: false,
                metaKey: false,
                shiftKey: false,
            },
            historyContext
        );

        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'target', toIndex: 2 },
        ]);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Alt+Drag bypass node' },
            { type: 'end' },
        ]);
        assert.deepEqual(graph.startNodeDragCalls, ['insert']);
        assert.equal(interaction.interaction.draggingNodeId, 'insert');
    });

    it('falls back to canvas panning on alt+drag when bypassing is not possible', () => {
        const graph = createGraph({
            initialConnections: [
                { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
            ],
            nodeById: {
                source: { outputs: [{ id: 'out-0' }] },
                insert: { x: 10, y: 20, inputs: [{ id: 'insert-in-0' }], outputs: [{ id: 'insert-out-0' }] },
            },
            canConnect() {
                return { valid: true };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => null,
            hitTestNode: () => ({ id: 'insert', x: 10, y: 20, width: 140, height: 90 }),
        });

        interaction.handleMouseDown(
            {
                preventDefault() {},
                clientX: 20,
                clientY: 20,
                button: 0,
                altKey: true,
                ctrlKey: false,
                metaKey: false,
                shiftKey: false,
            },
            {}
        );

        // Without an outgoing connection there is nothing to bypass, so Alt+drag keeps its
        // previous meaning and pans the canvas instead of moving the node.
        assert.ok(interaction.interaction.panning);
        assert.equal(interaction.interaction.draggingNodeId, null);
        assert.deepEqual(graph.getConnections(), [
            { fromNode: 'source', fromIndex: 0, toNode: 'insert', toIndex: 0 },
        ]);
    });

    it('groups multi-node drag into a single history operation', () => {
        const graph = createGraph({
            initialConnections: [],
            nodeById: {
                a: { id: 'a', x: 20, y: 30, width: 140, height: 90 },
                b: { id: 'b', x: 70, y: 80, width: 140, height: 90 },
            },
            canConnect() {
                return { valid: false };
            },
        });

        const { interaction } = createInteraction({
            graph,
            hitTestConnection: () => null,
            hitTestNode: () => ({ id: 'a', x: 20, y: 30, width: 140, height: 90 }),
            selectedNodeIds: ['a', 'b'],
            nodeUiEntries: [
                [
                    'a',
                    {
                        getNodeData() {
                            return { id: 'a', x: 20, y: 30, width: 140, height: 90 };
                        },
                        setPosition() {},
                    },
                ],
                [
                    'b',
                    {
                        getNodeData() {
                            return { id: 'b', x: 70, y: 80, width: 140, height: 90 };
                        },
                        setPosition() {},
                    },
                ],
            ],
        });

        interaction.handleMouseDown(
            {
                preventDefault() {},
                clientX: 24,
                clientY: 36,
                button: 0,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                shiftKey: false,
            },
            {}
        );

        const historyEvents = [];
        interaction.handleMouseUp({
            beginHistoryGroup(description) {
                historyEvents.push({ type: 'begin', description });
            },
            endHistoryGroup() {
                historyEvents.push({ type: 'end' });
            },
        });

        assert.deepEqual(graph.startNodeDragCalls, ['a', 'b']);
        assert.deepEqual(graph.endNodeDragCalls, ['a', 'b']);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Move multiple nodes' },
            { type: 'end' },
        ]);
    });
});

describe('GraphPanelInteraction insert-on-drop with real NodeGraph', () => {
    function createRealGraph() {
        const graph = new NodeGraph({ id: 'graph-insert' });
        graph.setDataTypeDefinitionLookup((typeId) =>
            typeId === 'web.element'
                ? { connectionPolicy: { input: { maxConnections: 1 } } }
                : null
        );

        const source = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const inserted = graph.addNode({
            type: 'insert',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: target.id, toIndex: 0 });
        return { graph, source, inserted, target };
    }

    function createRealInteraction(graph, insertedId, hitTestConnection) {
        const selection = {
            selectedNodes: new Set([insertedId]),
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
                return [insertedId];
            },
        };

        const nodeUiMap = new Map([
            [
                insertedId,
                {
                    getNodeData() {
                        return { id: insertedId, x: 100, y: 100, width: 140, height: 90 };
                    },
                    setPosition() {},
                },
            ],
        ]);

        return new GraphPanelInteraction({
            viewport: {
                viewport: { scale: 1, translateX: 0, translateY: 0 },
                screenToWorld(point) {
                    return point;
                },
                setViewport() {},
            },
            constants: { GRID_SPACING: 32 },
            selection,
            hitTestNode: () => null,
            hitTestConnector: () => null,
            hitTestConnection,
            onInvalidate: () => {},
            getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
            setCursor: () => {},
            clampToGrid: (x, y) => ({ x, y }),
            graph,
            nodeUiMap,
            connectionsUi: {
                hoverConnector: null,
                setHoverConnector() {},
                setHoverConnection() {},
                setTempConnection() {},
            },
            clipboardManager: { hasData: () => false },
            logger: () => {},
        });
    }

    it('splices an unconnected node into a connection under input maxConnections=1', () => {
        const { graph, source, inserted, target } = createRealGraph();
        const connection = graph.getConnections()[0];

        const interaction = createRealInteraction(graph, inserted.id, () => connection);

        const preview = interaction._getInsertableConnectionPreview(inserted.id, {
            x: 170,
            y: 145,
        });
        assert.deepEqual(preview, connection);

        assert.equal(
            interaction._tryInsertNodeIntoConnection(inserted.id, { x: 170, y: 145 }),
            true
        );

        const connections = graph.getConnections();
        assert.equal(connections.length, 2);
        assert.ok(
            connections.some(
                (conn) => conn.fromNode === source.id && conn.toNode === inserted.id
            )
        );
        assert.ok(
            connections.some(
                (conn) => conn.fromNode === inserted.id && conn.toNode === target.id
            )
        );
    });

    it('refuses to insert an already-connected node', () => {
        const { graph, inserted, target } = createRealGraph();
        const other = graph.addNode({
            type: 'other',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        graph.addConnection({ fromNode: other.id, fromIndex: 0, toNode: inserted.id, toIndex: 0 });

        const connection = graph.getConnections().find((conn) => conn.toNode === target.id);
        const interaction = createRealInteraction(graph, inserted.id, () => connection);

        assert.equal(
            interaction._getInsertableConnectionPreview(inserted.id, { x: 170, y: 145 }),
            null
        );
        assert.equal(
            interaction._tryInsertNodeIntoConnection(inserted.id, { x: 170, y: 145 }),
            false
        );
        assert.equal(graph.getConnections().length, 2);
    });

    it('rejects a type-mismatched inserted node', () => {
        const { graph, inserted } = createRealGraph();
        const connection = graph.getConnections()[0];

        // Give the inserted node an incompatible output type by rebuilding it.
        graph.removeNode(inserted.id);
        const incompatible = graph.addNode({
            type: 'insert',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
            outputs: [{ id: 'out0', outputType: 'web.bool' }],
        });

        const interaction = createRealInteraction(graph, incompatible.id, () => connection);

        assert.equal(
            interaction._getInsertableConnectionPreview(incompatible.id, { x: 170, y: 145 }),
            null
        );
        assert.equal(
            interaction._tryInsertNodeIntoConnection(incompatible.id, { x: 170, y: 145 }),
            false
        );
    });
});

