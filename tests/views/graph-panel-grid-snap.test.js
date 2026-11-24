import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelViewport } from '../../src/micro_otter/nodes/html/js/views/graph-panel-viewport.js';
import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';

function createViewport(constants = { GRID_SPACING: 32, GRID_MAJOR_INTERVAL: 5 }) {
    return new GraphPanelViewport({
        constants,
        workspace: { config: {} },
        maxGridMajorIntervals: { width: 32, height: 16 },
    });
}

function createMouseEvent({ clientX = 0, clientY = 0, button = 0 } = {}) {
    return {
        button,
        clientX,
        clientY,
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault() {},
    };
}

function createInteraction({ snapNodePosition, selectedNodeIds = ['a'], nodeUiEntries }) {
    const positions = new Map();
    const nodeUiMap = new Map();
    for (const [nodeId, { x, y, width = 140, height = 90 }] of nodeUiEntries) {
        const state = { x, y, width, height };
        positions.set(nodeId, state);
        nodeUiMap.set(nodeId, {
            getNodeData() {
                return { ...state };
            },
            setPosition(nextX, nextY) {
                state.x = nextX;
                state.y = nextY;
            },
        });
    }

    const selection = {
        selectedNodes: new Set(selectedNodeIds),
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
            return [...selectedNodeIds];
        },
    };

    const viewport = {
        viewport: { scale: 1, translateX: 0, translateY: 0 },
        screenToWorld(point) {
            return point;
        },
        setViewport() {},
    };

    const graph = {
        getConnections() {
            return [];
        },
        getNode(nodeId) {
            const entry = positions.get(nodeId);
            return entry ? { id: nodeId, ...entry } : null;
        },
        canConnect() {
            return { valid: true };
        },
        addConnection() {},
        removeConnection() {
            return false;
        },
        startNodeDrag() {},
        endNodeDrag() {},
    };

    const interaction = new GraphPanelInteraction({
        viewport,
        constants: { GRID_SPACING: 32 },
        selection,
        hitTestNode: () => ({ id: 'a', x: 0, y: 0, width: 140, height: 90 }),
        hitTestConnector: () => null,
        hitTestConnection: () => null,
        onInvalidate: () => {},
        getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
        setCursor: () => {},
        clampToGrid: (x, y) => ({ x, y }),
        snapNodePosition,
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

    return { interaction, positions };
}

describe('GraphPanelViewport snapToGrid', () => {
    it('snaps to the nearest GRID_SPACING multiple', () => {
        const viewport = createViewport();
        assert.deepEqual(viewport.snapToGrid(101.7, 87.3), { x: 96, y: 96 });
    });

    it('clamps snapped positions back into the grid bounds', () => {
        const viewport = createViewport();
        assert.deepEqual(viewport.snapToGrid(-40, -25), { x: 0, y: 0 });
        assert.deepEqual(viewport.snapToGrid(5090, 0, 140, 90), { x: 4980, y: 0 });
    });

    it('honours an explicit spacing override', () => {
        const viewport = createViewport();
        assert.deepEqual(viewport.snapToGrid(101.7, 87.3, 0, 0, 10), { x: 100, y: 90 });
    });
});

describe('GraphPanelInteraction grid snapping', () => {
    it('snaps a single-node drag when snapNodePosition is provided', () => {
        const { interaction, positions } = createInteraction({
            snapNodePosition: (x, y) => ({
                x: Math.round(x / 32) * 32,
                y: Math.round(y / 32) * 32,
            }),
            nodeUiEntries: [['a', { x: 0, y: 0 }]],
        });

        interaction.handleMouseDown(createMouseEvent({ clientX: 0, clientY: 0 }), {
            attachDocumentDragListeners() {},
        });
        interaction.handleMouseMove(createMouseEvent({ clientX: 45, clientY: 45 }), {});

        assert.deepEqual(positions.get('a'), { x: 32, y: 32, width: 140, height: 90 });
    });

    it('preserves raw floats for a single-node drag without snapNodePosition', () => {
        const { interaction, positions } = createInteraction({
            snapNodePosition: undefined,
            nodeUiEntries: [['a', { x: 0, y: 0 }]],
        });

        interaction.handleMouseDown(createMouseEvent({ clientX: 0, clientY: 0 }), {
            attachDocumentDragListeners() {},
        });
        interaction.handleMouseMove(createMouseEvent({ clientX: 45, clientY: 45 }), {});

        assert.deepEqual(positions.get('a'), { x: 45, y: 45, width: 140, height: 90 });
    });

    it('applies one identical delta to all nodes in a multi-node drag', () => {
        const { interaction, positions } = createInteraction({
            snapNodePosition: (x, y) => ({
                x: Math.round(x / 32) * 32,
                y: Math.round(y / 32) * 32,
            }),
            selectedNodeIds: ['a', 'b'],
            nodeUiEntries: [
                ['a', { x: 0, y: 0 }],
                ['b', { x: 10, y: 20 }],
            ],
        });

        interaction.handleMouseDown(createMouseEvent({ clientX: 0, clientY: 0 }), {
            attachDocumentDragListeners() {},
        });
        interaction.handleMouseMove(createMouseEvent({ clientX: 45, clientY: 45 }), {});

        assert.deepEqual(positions.get('a'), { x: 32, y: 32, width: 140, height: 90 });
        assert.deepEqual(positions.get('b'), { x: 42, y: 52, width: 140, height: 90 });
    });
});

describe('GraphPanelViewport bounds clamping', () => {
    it('leaves clampToGrid as bounds-only clamping', () => {
        const viewport = createViewport();
        assert.deepEqual(viewport.clampToGrid(101.7, 87.3), { x: 101.7, y: 87.3 });
    });
});
