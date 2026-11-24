// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GraphPanelInteraction } from '../../src/micro_otter/nodes/html/js/views/graph-panel-interaction.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';
import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';

const CONTROL_POINT = { x: 10, y: 10 };
const TOP_CONTROL = { controlId: 'top-control' };
const LOWER_CONTROL = { controlId: 'lower-control' };

function createSelection(selectedNodeIds = []) {
    return {
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
}

function createNodeUi(
    id,
    { bodyHit = false, controlHit = null, handleClickResult = false, handleClickCalls = [] } = {}
) {
    return {
        getNodeData() {
            return { id, x: 0, y: 0 };
        },
        setPosition() {},
        hitTestNode() {
            return bodyHit;
        },
        hitTestControl() {
            return controlHit;
        },
        handleClick() {
            handleClickCalls.push(id);
            return handleClickResult;
        },
    };
}

function createInteraction({ nodeUiMap = new Map(), ...overrides } = {}) {
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
        graph: {},
        nodeUiMap,
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

class GraphStub extends AppEventEmitter {
    id = 'graph-control-order';

    getName() {
        return 'Graph Control Order';
    }

    getNodes() {
        return [];
    }

    getNodeIds() {
        return [];
    }

    getNode() {
        return null;
    }

    getConnections() {
        return [];
    }
}

function createMouseDownEvent() {
    return {
        preventDefault() {},
        clientX: CONTROL_POINT.x,
        clientY: CONTROL_POINT.y,
        button: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        buttons: 1,
    };
}

describe('GraphPanelInteraction node control z-order hit testing', () => {
    it('returns the front-most node control when it owns the point', () => {
        const top = createNodeUi('top', { bodyHit: true, controlHit: TOP_CONTROL });
        const lower = createNodeUi('lower', { bodyHit: true, controlHit: LOWER_CONTROL });
        const interaction = createInteraction({
            nodeUiMap: new Map([
                ['top', top],
                ['lower', lower],
            ]),
            getNodeHitTestOrder: () => ['top', 'lower'],
        });

        const hit = interaction._hitTestNodeControl(CONTROL_POINT);

        assert.equal(hit?.nodeId, 'top');
        assert.deepEqual(hit?.controlHit, TOP_CONTROL);
    });

    it('blocks a lower control when a higher node body covers the point', () => {
        const top = createNodeUi('top', { bodyHit: true });
        const lower = createNodeUi('lower', { bodyHit: true, controlHit: LOWER_CONTROL });
        const interaction = createInteraction({
            nodeUiMap: new Map([
                ['top', top],
                ['lower', lower],
            ]),
            getNodeHitTestOrder: () => ['top', 'lower'],
        });

        const hit = interaction._hitTestNodeControl(CONTROL_POINT);

        assert.equal(hit, null);
    });

    it('returns a lower control when no higher node body covers the point', () => {
        const top = createNodeUi('top', { bodyHit: false });
        const lower = createNodeUi('lower', { bodyHit: true, controlHit: LOWER_CONTROL });
        const interaction = createInteraction({
            nodeUiMap: new Map([
                ['top', top],
                ['lower', lower],
            ]),
            getNodeHitTestOrder: () => ['top', 'lower'],
        });

        const hit = interaction._hitTestNodeControl(CONTROL_POINT);

        assert.equal(hit?.nodeId, 'lower');
        assert.deepEqual(hit?.controlHit, LOWER_CONTROL);
    });

    it('checks a node control before its body hit when both match', () => {
        const top = createNodeUi('top', { bodyHit: true, controlHit: TOP_CONTROL });
        const lower = createNodeUi('lower', { bodyHit: true, controlHit: LOWER_CONTROL });
        const interaction = createInteraction({
            nodeUiMap: new Map([
                ['top', top],
                ['lower', lower],
            ]),
            getNodeHitTestOrder: () => ['top', 'lower'],
        });

        const hit = interaction._hitTestNodeControl(CONTROL_POINT);

        assert.equal(hit?.nodeId, 'top');
        assert.deepEqual(hit?.controlHit, TOP_CONTROL);
    });

    it('keeps a front-most control selectable when it spills outside its own node body', () => {
        const top = createNodeUi('top', { bodyHit: false, controlHit: TOP_CONTROL });
        const lower = createNodeUi('lower', { bodyHit: true, controlHit: LOWER_CONTROL });
        const interaction = createInteraction({
            nodeUiMap: new Map([
                ['top', top],
                ['lower', lower],
            ]),
            getNodeHitTestOrder: () => ['top', 'lower'],
        });

        const hit = interaction._hitTestNodeControl(CONTROL_POINT);

        assert.equal(hit?.nodeId, 'top');
        assert.deepEqual(hit?.controlHit, TOP_CONTROL);
    });

    it('uses reverse map order as a fallback when no order callback is supplied', () => {
        const top = createNodeUi('top', { bodyHit: true, controlHit: TOP_CONTROL });
        const lower = createNodeUi('lower', { bodyHit: true, controlHit: LOWER_CONTROL });
        const interaction = createInteraction({
            nodeUiMap: new Map([
                ['lower', lower],
                ['top', top],
            ]),
        });

        const hit = interaction._hitTestNodeControl(CONTROL_POINT);

        assert.equal(hit?.nodeId, 'top');
        assert.deepEqual(hit?.controlHit, TOP_CONTROL);
    });
});

describe('GraphPanelInteraction control-click regression', () => {
    it('drags the higher node title bar instead of opening a covered lower control', () => {
        const lowerHandleClickCalls = [];
        const topHandleClickCalls = [];
        const startNodeDragCalls = [];
        const topNode = { id: 'top', x: 0, y: 0, width: 100, height: 100 };
        const topUi = createNodeUi('top', {
            bodyHit: true,
            handleClickCalls: topHandleClickCalls,
        });
        const lowerUi = createNodeUi('lower', {
            bodyHit: true,
            controlHit: LOWER_CONTROL,
            handleClickCalls: lowerHandleClickCalls,
        });
        const interaction = createInteraction({
            nodeUiMap: new Map([
                ['top', topUi],
                ['lower', lowerUi],
            ]),
            selection: createSelection(['top']),
            getNodeHitTestOrder: () => ['top', 'lower'],
            hitTestNode: () => topNode,
            graph: {
                getNode(nodeId) {
                    return nodeId === 'top' ? topNode : null;
                },
                getConnections() {
                    return [];
                },
                startNodeDrag(nodeId) {
                    startNodeDragCalls.push(nodeId);
                },
                endNodeDrag() {},
            },
        });

        const result = interaction.handleMouseDown(createMouseDownEvent(), {
            canvas: {},
            selectSingleNode() {},
            attachDocumentDragListeners() {},
            setActiveNode() {},
        });

        assert.deepEqual(result, { handled: true });
        assert.deepEqual(lowerHandleClickCalls, []);
        assert.deepEqual(topHandleClickCalls, ['top']);
        assert.deepEqual(startNodeDragCalls, ['top']);
        assert.equal(interaction.interaction.draggingNodeId, 'top');
    });

    it('promotes the node owning a pressed control to active', () => {
        const activeNodeCalls = [];
        const selectedNodeCalls = [];
        const topUi = createNodeUi('top', {
            bodyHit: true,
            controlHit: TOP_CONTROL,
            handleClickResult: true,
        });
        const interaction = createInteraction({
            nodeUiMap: new Map([['top', topUi]]),
            selection: createSelection(['other']),
            getNodeHitTestOrder: () => ['top'],
        });

        const result = interaction.handleMouseDown(createMouseDownEvent(), {
            canvas: {},
            setActiveNode(nodeId) {
                activeNodeCalls.push(nodeId);
            },
            selectSingleNode(nodeId) {
                selectedNodeCalls.push(nodeId);
            },
        });

        assert.deepEqual(result, { handled: true });
        assert.deepEqual(activeNodeCalls, ['top']);
        assert.deepEqual(selectedNodeCalls, ['top']);
    });
});

describe('GraphPanelView control hit-test ordering', () => {
    it('supplies the current canonical node order to the interaction module', () => {
        const view = new GraphPanelView({
            graph: new GraphStub(),
            collection: {
                getTargetId() {
                    return null;
                },
                getDeviceRuntimeId() {
                    return 'general';
                },
            },
        });

        try {
            view.nodeOrderList = ['lower', 'top'];
            view.activeNodeId = 'top';
            assert.deepEqual(view.interactionModule?.getNodeHitTestOrder?.(), ['top', 'lower']);

            view.activeNodeId = 'lower';
            assert.deepEqual(view.interactionModule?.getNodeHitTestOrder?.(), ['lower', 'top']);
        } finally {
            view.dispose();
        }
    });
});
