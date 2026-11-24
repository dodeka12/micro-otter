// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Precedence tests: documentation areas must not steal node, connector, pan or box-select input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';

function createInteraction({ nodeHit = null, connectorHit = null, areaHit = null } = {}) {
    const calls = {
        areaMouseDown: [],
        areaDoubleClick: [],
        areaActivate: [],
        contextMenu: [],
        detach: 0,
        cursor: [],
    };
    const node = { id: 'node-1', x: 20, y: 20, width: 160, height: 90 };

    const selection = {
        selectedNodes: new Set(),
        selectionBox: null,
        _isBoxSelecting: false,
        startBoxSelection() {
            calls.boxSelectionStarted = (calls.boxSelectionStarted || 0) + 1;
        },
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
        viewport: { scale: 1, translateX: 0, translateY: 0 },
        screenToWorld: (point) => point,
        setViewport() {},
    };

    const graph = {
        getNode: () => ({ ...node }),
        getConnections: () => [],
        canConnect: () => ({ valid: true }),
        startNodeDrag() {},
        endNodeDrag() {},
        updateNode() {},
    };

    const interaction = new GraphPanelInteraction({
        viewport,
        constants: { GRID_SPACING: 32 },
        selection,
        hitTestNode: () => nodeHit,
        hitTestConnector: () => connectorHit,
        hitTestConnection: () => null,
        onInvalidate: () => {},
        getCanvasPosScreenFromEvent: (event) => ({ x: event.clientX, y: event.clientY }),
        setCursor: (cursor) => calls.cursor.push(cursor),
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

    const context = {
        hitTestDocumentationArea: () => areaHit,
        onDocumentationAreaMouseDown: (hit, event) => calls.areaMouseDown.push({ hit, event }),
        onDocumentationAreaDoubleClick: (hit) => calls.areaDoubleClick.push(hit),
        onDocumentationAreaActivate: (areaId) => calls.areaActivate.push(areaId),
        showContextMenu: (type) => calls.contextMenu.push(type),
        detachDocumentDragListeners: () => {
            calls.detach += 1;
        },
        attachDocumentDragListeners: () => {},
    };

    return { interaction, context, calls, selection };
}

function mouseEvent(overrides = {}) {
    return {
        button: 0,
        clientX: 30,
        clientY: 30,
        detail: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault() {},
        stopPropagation() {},
        ...overrides,
    };
}

describe('GraphPanelInteraction documentation-area precedence', () => {
    it('starts an area gesture when the pointer hits an area', () => {
        const areaHit = { areaId: 'area-1', zone: 'header' };
        const { interaction, context, calls } = createInteraction({ areaHit });

        const result = interaction.handleMouseDown(mouseEvent(), context);

        assert.deepEqual(result, { handled: true });
        assert.equal(calls.areaMouseDown.length, 1);
        assert.equal(calls.areaMouseDown[0].hit.areaId, 'area-1');
        assert.equal(interaction.interaction.panning, null);
        assert.equal(calls.boxSelectionStarted, undefined);
    });

    it('lets a node inside an area win', () => {
        const areaHit = { areaId: 'area-1', zone: 'body' };
        const { interaction, context, calls } = createInteraction({
            nodeHit: { id: 'node-1', x: 20, y: 20 },
            areaHit,
        });

        interaction.handleMouseDown(mouseEvent(), context);

        assert.equal(calls.areaMouseDown.length, 0);
        assert.equal(interaction.interaction.draggingNodeId, 'node-1');
    });

    it('lets a connector inside an area win', () => {
        const areaHit = { areaId: 'area-1', zone: 'body' };
        const { interaction, context, calls } = createInteraction({
            connectorHit: {
                nodeId: 'node-1',
                index: 0,
                kind: 'output',
                type: 'float',
                pos: { x: 1, y: 1 },
            },
            areaHit,
        });

        interaction.handleMouseDown(mouseEvent(), context);

        assert.equal(calls.areaMouseDown.length, 0);
        assert.ok(interaction.interaction.draggingConnection);
    });

    it('keeps Shift+drag inside an area as box selection', () => {
        const areaHit = { areaId: 'area-1', zone: 'body' };
        const { interaction, context, calls } = createInteraction({ areaHit });

        interaction.handleMouseDown(mouseEvent({ shiftKey: true }), context);

        assert.equal(calls.areaMouseDown.length, 0);
        assert.equal(calls.boxSelectionStarted, 1);
    });

    it('keeps Alt+drag inside an area as panning', () => {
        const areaHit = { areaId: 'area-1', zone: 'body' };
        const { interaction, context, calls } = createInteraction({ areaHit });

        interaction.handleMouseDown(mouseEvent({ altKey: true }), context);

        assert.equal(calls.areaMouseDown.length, 0);
        assert.ok(interaction.interaction.panning);
    });

    it('opens the documentation-area context menu on right click', () => {
        const areaHit = { areaId: 'area-1', zone: 'header' };
        const { interaction, context, calls } = createInteraction({ areaHit });

        const result = interaction.handleMouseDown(mouseEvent({ button: 2 }), context);

        assert.deepEqual(result, { handled: true });
        assert.deepEqual(calls.areaActivate, ['area-1']);
        assert.deepEqual(calls.contextMenu, ['documentation-area']);
    });

    it('opens the editor request on a double click in the body', () => {
        const areaHit = { areaId: 'area-1', zone: 'body' };
        const { interaction, context, calls } = createInteraction({ areaHit });

        interaction.handleMouseDown(mouseEvent({ detail: 2 }), context);

        assert.equal(calls.areaDoubleClick.length, 1);
        assert.equal(calls.areaMouseDown.length, 0);
    });

    it('hands pointer moves to the area gesture when it consumes them', () => {
        const { interaction, context, calls } = createInteraction({ areaHit: null });
        const seen = [];
        context.onDocumentationAreaPointerMove = (posWorld) => {
            seen.push(posWorld);
            return true;
        };

        const result = interaction.handleMouseMove(mouseEvent({ clientX: 44, clientY: 55 }), context);

        assert.deepEqual(result, { handled: true });
        assert.deepEqual(seen, [{ x: 44, y: 55 }]);
        assert.equal(calls.cursor.length, 0);
    });

    it('ends the gesture on mouse up and detaches the document listeners', () => {
        const { interaction, context, calls } = createInteraction({ areaHit: null });
        context.onDocumentationAreaPointerUp = () => true;

        const result = interaction.handleMouseUp(context);

        assert.deepEqual(result, { handled: true });
        assert.equal(calls.detach, 1);
        assert.deepEqual(calls.cursor, ['grab']);
    });

    it('declines area keys first and stops the node shortcuts', () => {
        const harness = createDomHarness();
        const { interaction, context } = createInteraction({ areaHit: null });
        const seen = [];
        context.onDocumentationAreaKeyDown = (event) => {
            seen.push(event.key);
            return event.key === 'Delete';
        };

        const handled = interaction.handleKeyDown(
            { key: 'Delete', ctrlKey: false, metaKey: false, preventDefault() {} },
            context
        );

        assert.equal(handled, true);
        assert.deepEqual(seen, ['Delete']);
        harness.cleanup();
    });
});
