import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

function createInteractionForInvalidConnection({ canConnectResult }) {
    const invalidCalls = [];

    const interaction = new GraphPanelInteraction({
        viewport: {
            viewport: { scale: 1, translateX: 0, translateY: 0 },
            screenToWorld(point) {
                return point;
            },
            setViewport() {},
        },
        constants: { GRID_SPACING: 32 },
        selection: {
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
        },
        hitTestNode: () => null,
        hitTestConnector: () => null,
        onInvalidate: () => {},
        getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
        setCursor: () => {},
        clampToGrid: (x, y) => ({ x, y }),
        graph: {
            getConnections() {
                return [];
            },
            canConnect() {
                return canConnectResult;
            },
            addConnection() {
                throw new Error('addConnection should not be called for invalid case');
            },
        },
        nodeUiMap: new Map(),
        connectionsUi: {
            hoverConnector: {
                nodeId: 'target',
                index: 0,
                kind: 'input',
                pos: { x: 20, y: 20 },
            },
            setHoverConnector() {},
            setTempConnection() {},
            showInvalidConnection(payload) {
                invalidCalls.push(payload);
            },
        },
        clipboardManager: { hasData: () => false },
        logger: () => {},
    });

    interaction.interaction.draggingConnection = {
        start: {
            nodeId: 'source',
            index: 0,
            kind: 'output',
            pos: { x: 10, y: 10 },
        },
        currentPos: { x: 20, y: 20 },
    };

    return { interaction, invalidCalls };
}

describe('GraphPanelInteraction invalid connection feedback', () => {
    it('shows invalid connection feedback when canConnect rejects the connection', () => {
        const { interaction, invalidCalls } = createInteractionForInvalidConnection({
            canConnectResult: {
                valid: false,
                message: 'Recursive connection detected',
            },
        });

        interaction.endDragConnection();

        assert.equal(invalidCalls.length, 1);
        assert.equal(invalidCalls[0].message, 'Recursive connection detected');
        assert.deepEqual(invalidCalls[0].start, { x: 10, y: 10 });
        assert.deepEqual(invalidCalls[0].end, { x: 20, y: 20 });
    });

    it('does not show invalid feedback for max-connection limits when user-action add path handles pruning', () => {
        const invalidCalls = [];
        const addConnectionCalls = [];

        const interaction = new GraphPanelInteraction({
            viewport: {
                viewport: { scale: 1, translateX: 0, translateY: 0 },
                screenToWorld(point) {
                    return point;
                },
                setViewport() {},
            },
            constants: { GRID_SPACING: 32 },
            selection: {
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
            },
            hitTestNode: () => null,
            hitTestConnector: () => null,
            onInvalidate: () => {},
            getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
            setCursor: () => {},
            clampToGrid: (x, y) => ({ x, y }),
            graph: {
                getConnections() {
                    return [];
                },
                canConnect() {
                    return {
                        valid: false,
                        message:
                            "Output connection limit exceeded for type 'web.element': maxConnections=1, currentConnections=1",
                    };
                },
                addConnectionFromUserAction(connection) {
                    addConnectionCalls.push(connection);
                },
                addConnection() {
                    throw new Error('addConnection fallback should not be called');
                },
            },
            nodeUiMap: new Map(),
            connectionsUi: {
                hoverConnector: {
                    nodeId: 'target',
                    index: 0,
                    kind: 'input',
                    pos: { x: 20, y: 20 },
                },
                setHoverConnector() {},
                setTempConnection() {},
                showInvalidConnection(payload) {
                    invalidCalls.push(payload);
                },
            },
            clipboardManager: { hasData: () => false },
            logger: () => {},
        });

        interaction.interaction.draggingConnection = {
            start: {
                nodeId: 'source',
                index: 0,
                kind: 'output',
                pos: { x: 10, y: 10 },
            },
            currentPos: { x: 20, y: 20 },
        };

        interaction.endDragConnection();

        assert.equal(invalidCalls.length, 0);
        assert.equal(addConnectionCalls.length, 1);
        assert.deepEqual(addConnectionCalls[0], {
            fromNode: 'source',
            fromIndex: 0,
            toNode: 'target',
            toIndex: 0,
        });
    });

    it('creates connection via real NodeGraph user-action API without undefined-this errors', () => {
        const invalidCalls = [];
        const graph = new NodeGraph({ id: 'graph-real-add-connection' });
        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'any' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['any'] }],
        });

        const interaction = new GraphPanelInteraction({
            viewport: {
                viewport: { scale: 1, translateX: 0, translateY: 0 },
                screenToWorld(point) {
                    return point;
                },
                setViewport() {},
            },
            constants: { GRID_SPACING: 32 },
            selection: {
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
            },
            hitTestNode: () => null,
            hitTestConnector: () => null,
            onInvalidate: () => {},
            getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
            setCursor: () => {},
            clampToGrid: (x, y) => ({ x, y }),
            graph,
            nodeUiMap: new Map(),
            connectionsUi: {
                hoverConnector: {
                    nodeId: target.id,
                    index: 0,
                    kind: 'input',
                    pos: { x: 20, y: 20 },
                },
                setHoverConnector() {},
                setTempConnection() {},
                showInvalidConnection(payload) {
                    invalidCalls.push(payload);
                },
            },
            clipboardManager: { hasData: () => false },
            logger: () => {},
        });

        interaction.interaction.draggingConnection = {
            start: {
                nodeId: source.id,
                index: 0,
                kind: 'output',
                pos: { x: 10, y: 10 },
            },
            currentPos: { x: 20, y: 20 },
        };

        interaction.endDragConnection();

        assert.equal(invalidCalls.length, 0);
        assert.deepEqual(graph.getConnections(), [
            { fromNode: source.id, fromIndex: 0, toNode: target.id, toIndex: 0 },
        ]);
    });
});
