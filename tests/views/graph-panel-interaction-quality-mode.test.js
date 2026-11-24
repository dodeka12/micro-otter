import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';

function createMouseEvent({
    button = 0,
    clientX = 64,
    clientY = 64,
    altKey = false,
    shiftKey = false,
    ctrlKey = false,
    metaKey = false,
} = {}) {
    return {
        button,
        clientX,
        clientY,
        altKey,
        shiftKey,
        ctrlKey,
        metaKey,
        preventDefault() {},
    };
}

function createInteraction({ hitTestNode = () => null, hitTestConnector = () => null } = {}) {
    const qualityTransitions = [];

    const selection = {
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

    const graph = {
        getConnections() {
            return [];
        },
        getNode() {
            return null;
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
        hitTestNode,
        hitTestConnector,
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
        setInteractionQualityMode: (active) => qualityTransitions.push(active ? 'interaction' : 'full'),
        logger: () => {},
    });

    return { interaction, qualityTransitions };
}

describe('GraphPanelInteraction quality mode transitions', () => {
    it('enters interaction mode on pan start and exits on mouse up', () => {
        const { interaction, qualityTransitions } = createInteraction();

        interaction.handleMouseDown(createMouseEvent(), {
            attachDocumentDragListeners() {},
        });
        interaction.handleMouseUp({
            detachDocumentDragListeners() {},
        });

        assert.deepEqual(qualityTransitions, ['interaction', 'full']);
    });

    it('enters interaction mode on connection drag and exits on mouse up', () => {
        const { interaction, qualityTransitions } = createInteraction({
            hitTestConnector: () => ({
                nodeId: 'source',
                index: 0,
                kind: 'output',
                pos: { x: 10, y: 20 },
            }),
        });

        interaction.handleMouseDown(createMouseEvent(), {
            attachDocumentDragListeners() {},
        });
        interaction.handleMouseUp({
            detachDocumentDragListeners() {},
        });

        assert.deepEqual(qualityTransitions, ['interaction', 'full']);
    });

    it('restores full mode when interactions are cancelled', () => {
        const { interaction, qualityTransitions } = createInteraction();

        interaction.handleMouseDown(createMouseEvent(), {
            attachDocumentDragListeners() {},
        });
        interaction.cancelInteractions({
            detachDocumentDragListeners() {},
        });

        assert.deepEqual(qualityTransitions, ['interaction', 'full']);
    });

    it('applies box-selection through setSelectionNodeIds callback', () => {
        const { interaction } = createInteraction();

        interaction.selection._isBoxSelecting = true;
        interaction.selection.selectionBox = {
            start: { x: 0, y: 0 },
            end: { x: 100, y: 100 },
        };
        interaction.selection.finishBoxSelection = () => ['node-a', 'node-b'];

        const selectionSnapshots = [];
        interaction.handleMouseUp({
            setSelectionNodeIds(nodeIds, description) {
                selectionSnapshots.push({ nodeIds, description });
            },
        });

        assert.deepEqual(selectionSnapshots, [
            {
                nodeIds: ['node-a', 'node-b'],
                description: 'Box selection',
            },
        ]);
    });
});
