import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

function createSelection(selectedIds = []) {
    const selectedNodes = new Set(selectedIds);
    return {
        selectedNodes,
        selectionBox: null,
        _isBoxSelecting: false,
        startBoxSelection() {},
        updateBoxSelection() {},
        finishBoxSelection() {
            return [];
        },
        clearSelection() {
            selectedNodes.clear();
        },
        addToSelection(nodeId) {
            selectedNodes.add(nodeId);
        },
        getSelectedNodeIds() {
            return Array.from(selectedNodes);
        },
    };
}

function createInteraction(graph, selection) {
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
    });
}


function createEvent({ clientX, clientY, ctrlKey = true, altKey = false }) {
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

/**
 * Register a lightweight NodeUi stub so dragged nodes can report and mutate their position.
 * @param {GraphPanelInteraction} interaction - Interaction under test.
 * @param {string} nodeId - Node ID to register.
 * @param {{x: number, y: number}} position - Initial node position.
 * @returns {{getPosition: () => {x: number, y: number}}} Position accessor for assertions.
 */
function registerNodeUi(interaction, nodeId, position) {
    const state = { x: position.x, y: position.y, width: 140, height: 90 };
    interaction.nodeUiMap.set(nodeId, {
        getNodeData: () => state,
        setPosition(x, y) {
            state.x = x;
            state.y = y;
        },
    });
    return {
        getPosition: () => ({ x: state.x, y: state.y }),
    };
}

/**
 * Build a graph with one draggable node plus its NodeUi stub.
 * @param {{x: number, y: number}} position - Node origin.
 * @returns {object} Graph, node, nodeUi, interaction and selection handles.
 */
function createSingleNodeSetup(position = { x: 100, y: 100 }) {
    const graph = new NodeGraph({ id: 'graph-ctrl-copy' });
    const node = graph.addNode({ type: 'source', x: position.x, y: position.y });

    const selection = createSelection([]);
    const interaction = createInteraction(graph, selection);
    interaction.hitTestNode = () => ({ id: node.id, ...position, width: 140, height: 90 });
    const nodeUi = registerNodeUi(interaction, node.id, position);

    return { graph, node, nodeUi, interaction, selection };
}

/**
 * Duplicate nodes into the graph at their current positions, mimicking the clipboard path.
 * @param {NodeGraph} graph - Target graph.
 * @param {string[][]} calls - Collector for the received node ID lists.
 * @returns {(nodeIds: string[]) => {originalNodeIds: string[], newNodeIds: string[]}} Copy callback.
 */
function createDuplicateCallback(graph, calls) {
    return (nodeIds) => {
        calls.push(nodeIds);
        const newNodeIds = nodeIds.map((nodeId) => {
            const original = graph.getNode(nodeId);
            return graph.addNode({ type: original.type, x: original.x, y: original.y }).id;
        });
        return { originalNodeIds: nodeIds, newNodeIds };
    };
}

describe('GraphPanelInteraction ctrl+drag copy', () => {
    it('copies the pressed node on ctrl+drag and drags the copy', () => {
        const { graph, node, nodeUi, interaction } = createSingleNodeSetup();
        const copyCalls = [];
        const historyEvents = [];
        const selectionEvents = [];

        const context = {
            duplicateNodesForDrag: createDuplicateCallback(graph, copyCalls),
            beginHistoryGroup: (description) => historyEvents.push({ type: 'begin', description }),
            endHistoryGroup: () => historyEvents.push({ type: 'end' }),
            setSelectionNodeIds: (nodeIds, description) =>
                selectionEvents.push({ nodeIds, description }),
        };

        interaction.handleMouseDown(createEvent({ clientX: 120, clientY: 120 }), context);

        // Nothing is copied until the pointer actually moves.
        assert.deepEqual(copyCalls, []);
        assert.equal(interaction.interaction.draggingNodeId, null);
        assert.equal(interaction.interaction.panning, null);

        interaction.handleMouseMove(createEvent({ clientX: 160, clientY: 120 }), context);

        assert.deepEqual(copyCalls, [[node.id]]);
        assert.equal(graph.getNodes().length, 2);
        assert.deepEqual(historyEvents, [
            { type: 'begin', description: 'Ctrl+Drag copy nodes' },
            { type: 'end' },
        ]);

        const copyNodeId = interaction.interaction.draggingNodeId;
        assert.notEqual(copyNodeId, node.id);
        assert.deepEqual(selectionEvents, [
            { nodeIds: [copyNodeId], description: 'Select copied nodes' },
        ]);

        const copyNodeUi = registerNodeUi(interaction, copyNodeId, { x: 100, y: 100 });
        interaction.handleMouseMove(createEvent({ clientX: 200, clientY: 160 }), context);

        assert.deepEqual(copyNodeUi.getPosition(), { x: 180, y: 140 });
        assert.deepEqual(nodeUi.getPosition(), { x: 100, y: 100 });
        assert.deepEqual(
            { x: graph.getNode(node.id).x, y: graph.getNode(node.id).y },
            { x: 100, y: 100 }
        );
    });

    it('copies the whole selection when a selected node is ctrl+dragged', () => {
        const position = { x: 100, y: 100 };
        const { graph, node, interaction, selection } = createSingleNodeSetup(position);
        const secondNode = graph.addNode({ type: 'sink', x: 300, y: 220 });
        registerNodeUi(interaction, secondNode.id, { x: 300, y: 220 });
        selection.selectedNodes.add(node.id);
        selection.selectedNodes.add(secondNode.id);

        const copyCalls = [];
        const selectionEvents = [];
        const context = {
            duplicateNodesForDrag: createDuplicateCallback(graph, copyCalls),
            setSelectionNodeIds: (nodeIds, description) =>
                selectionEvents.push({ nodeIds, description }),
        };

        interaction.handleMouseDown(createEvent({ clientX: 120, clientY: 120 }), context);

        assert.deepEqual(interaction._pendingCopyDrag?.nodeIds, [node.id, secondNode.id]);

        interaction.handleMouseMove(createEvent({ clientX: 150, clientY: 120 }), context);

        assert.deepEqual(copyCalls, [[node.id, secondNode.id]]);
        assert.equal(graph.getNodes().length, 4);

        const copiedNodeIds = selectionEvents[0].nodeIds;
        assert.equal(copiedNodeIds.length, 2);
        assert.deepEqual(selectionEvents[0].description, 'Select copied nodes');
        // The copy of the pressed node is the one that follows the pointer.
        assert.equal(interaction.interaction.draggingNodeId, copiedNodeIds[0]);
        assert.deepEqual(Array.from(interaction._dragStartPositions.keys()), copiedNodeIds);
        assert.deepEqual({ x: graph.getNode(node.id).x, y: graph.getNode(node.id).y }, position);
    });

    it('keeps ctrl+click as a selection toggle when the pointer does not move', () => {
        const { graph, node, interaction } = createSingleNodeSetup();
        const copyCalls = [];
        const toggledNodeIds = [];

        const context = {
            duplicateNodesForDrag: createDuplicateCallback(graph, copyCalls),
            toggleSelection: (nodeId) => toggledNodeIds.push(nodeId),
        };

        interaction.handleMouseDown(createEvent({ clientX: 120, clientY: 120 }), context);
        interaction.handleMouseUp(context);

        assert.deepEqual(toggledNodeIds, [node.id]);
        assert.deepEqual(copyCalls, []);
        assert.equal(graph.getNodes().length, 1);
        assert.equal(interaction.interaction.draggingNodeId, null);
    });

    it('falls back to dragging the original node when copying fails', () => {
        const { graph, node, interaction } = createSingleNodeSetup();
        const context = {
            duplicateNodesForDrag: () => null,
        };

        interaction.handleMouseDown(createEvent({ clientX: 120, clientY: 120 }), context);
        interaction.handleMouseMove(createEvent({ clientX: 150, clientY: 120 }), context);

        assert.equal(graph.getNodes().length, 1);
        assert.equal(interaction.interaction.draggingNodeId, node.id);
        assert.deepEqual(Array.from(interaction._dragStartPositions.keys()), [node.id]);
    });
});
