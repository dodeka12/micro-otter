import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';

function createResizeInteraction({
    edge = 'right',
    connectorHit = null,
    resizeNodeWidth = null,
} = {}) {
    const node = { id: 'node-1', x: 100, y: 80, width: 160, height: 90 };
    const updateCalls = [];
    const startNodeDragCalls = [];
    const setCursorCalls = [];

    const graph = {
        getNode(nodeId) {
            return nodeId === node.id ? node : null;
        },
        getConnections() {
            return [];
        },
        canConnect() {
            return { valid: true };
        },
        startNodeDrag(nodeId) {
            startNodeDragCalls.push(nodeId);
        },
        endNodeDrag() {},
        updateNode(nodeId, patch) {
            updateCalls.push({ nodeId, patch: { ...patch } });
            Object.assign(node, patch);
        },
    };

    const selection = {
        selectedNodes: new Set([node.id]),
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
            return [node.id];
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

    const interaction = new GraphPanelInteraction({
        viewport,
        constants: { GRID_SPACING: 32 },
        selection,
        hitTestNode: () => ({ ...node }),
        hitTestResizeHandle: () => ({ nodeId: node.id, edge }),
        hitTestConnector: () => connectorHit,
        hitTestConnection: () => null,
        onInvalidate: () => {},
        getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
        setCursor: (cursor) => setCursorCalls.push(cursor),
        clampToGrid: (x, y) => ({ x, y }),
        graph,
        nodeUiMap: new Map([[node.id, { getNodeData: () => node, setPosition() {} }]]),
        connectionsUi: {
            hoverConnector: null,
            setHoverConnector() {},
            setHoverConnection() {},
            setTempConnection() {},
        },
        clipboardManager: { hasData: () => false },
        resizeNodeWidth,
        logger: () => {},
    });

    return {
        interaction,
        node,
        updateCalls,
        startNodeDragCalls,
        setCursorCalls,
    };
}

describe('GraphPanelInteraction resize gestures', () => {
    it('starts side resize interaction instead of node drag when resize handle is hit', () => {
        const { interaction, startNodeDragCalls } = createResizeInteraction({ edge: 'right' });

        interaction.handleMouseDown(
            {
                button: 0,
                clientX: 120,
                clientY: 100,
                altKey: false,
                shiftKey: false,
                ctrlKey: false,
                metaKey: false,
                preventDefault() {},
            },
            {
                attachDocumentDragListeners() {},
                selectSingleNode() {},
                canvas: null,
            }
        );

        assert.equal(interaction.interaction.resizingNode?.nodeId, 'node-1');
        assert.equal(interaction.interaction.draggingNodeId, null);
        assert.deepEqual(startNodeDragCalls, []);
    });

    it('updates node width from right-edge drag', () => {
        const { interaction, node, updateCalls } = createResizeInteraction({ edge: 'right' });

        interaction.handleMouseDown(
            {
                button: 0,
                clientX: 120,
                clientY: 100,
                altKey: false,
                shiftKey: false,
                ctrlKey: false,
                metaKey: false,
                preventDefault() {},
            },
            { attachDocumentDragListeners() {}, selectSingleNode() {}, canvas: null }
        );

        interaction.handleMouseMove(
            {
                clientX: 150,
                clientY: 100,
                buttons: 1,
            },
            { gridEnabled: false }
        );

        assert.equal(node.width, 190);
        assert.equal(node.x, 100);
        assert.equal(updateCalls.length, 0);

        interaction.handleMouseUp({});

        assert.equal(updateCalls.length, 1);
        assert.equal(updateCalls[0].patch.width, 190);
    });

    it('updates node x and width from left-edge drag', () => {
        const { interaction, node } = createResizeInteraction({ edge: 'left' });

        interaction.handleMouseDown(
            {
                button: 0,
                clientX: 120,
                clientY: 100,
                altKey: false,
                shiftKey: false,
                ctrlKey: false,
                metaKey: false,
                preventDefault() {},
            },
            { attachDocumentDragListeners() {}, selectSingleNode() {}, canvas: null }
        );

        interaction.handleMouseMove(
            {
                clientX: 140,
                clientY: 100,
                buttons: 1,
            },
            { gridEnabled: false }
        );

        assert.equal(node.width, 140);
        assert.equal(node.x, 120);
    });

    it('prioritizes connector drag over resize-handle hit', () => {
        const { interaction } = createResizeInteraction({
            edge: 'right',
            connectorHit: {
                nodeId: 'node-1',
                index: 0,
                kind: 'output',
                type: 'output',
                pos: { x: 160, y: 100 },
            },
        });

        interaction.handleMouseDown(
            {
                button: 0,
                clientX: 120,
                clientY: 100,
                altKey: false,
                shiftKey: false,
                ctrlKey: false,
                metaKey: false,
                preventDefault() {},
            },
            { attachDocumentDragListeners() {}, selectSingleNode() {}, canvas: null }
        );

        assert.equal(interaction.interaction.draggingConnection?.start.nodeId, 'node-1');
        assert.equal(interaction.interaction.resizingNode, null);
    });

    it('uses shared resize callback when provided', () => {
        const resizeCalls = [];
        const { interaction, updateCalls } = createResizeInteraction({
            edge: 'right',
            resizeNodeWidth: (payload) => {
                resizeCalls.push(payload);
                return true;
            },
        });

        interaction.handleMouseDown(
            {
                button: 0,
                clientX: 120,
                clientY: 100,
                altKey: false,
                shiftKey: false,
                ctrlKey: false,
                metaKey: false,
                preventDefault() {},
            },
            { attachDocumentDragListeners() {}, selectSingleNode() {}, canvas: null }
        );

        interaction.handleMouseMove(
            {
                clientX: 150,
                clientY: 100,
                buttons: 1,
            },
            { gridEnabled: false }
        );

        interaction.handleMouseUp({});

        assert.equal(resizeCalls.length, 2);
        assert.equal(resizeCalls[0].nodeId, 'node-1');
        assert.equal(resizeCalls[0].edge, 'right');
        assert.equal(resizeCalls[0].commit, false);
        assert.equal(resizeCalls[1].commit, true);
        assert.equal(updateCalls.length, 0);
    });

    it('triggers non-pointer resize callback via keyboard shortcuts', () => {
        global.document = { activeElement: null };

        const { interaction } = createResizeInteraction();
        const deltas = [];

        const handledIncrease = interaction.handleKeyDown(
            {
                key: ']',
                ctrlKey: false,
                metaKey: false,
                preventDefault() {},
            },
            {
                resizeSelectedNodeWidth(delta) {
                    deltas.push(delta);
                },
            }
        );

        const handledDecrease = interaction.handleKeyDown(
            {
                key: '[',
                ctrlKey: false,
                metaKey: false,
                preventDefault() {},
            },
            {
                resizeSelectedNodeWidth(delta) {
                    deltas.push(delta);
                },
            }
        );

        assert.equal(handledIncrease, true);
        assert.equal(handledDecrease, true);
        assert.deepEqual(deltas, [10, -10]);
    });
});
