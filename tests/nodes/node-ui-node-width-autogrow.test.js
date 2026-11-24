// Copyright (c) 2026 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: automatic node width growth.
 *
 * Verifies that `NodeUi.ensureNodeWidth()` widens a node until its connector rows can
 * host their input default controls, never shrinks it, and is idempotent.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { NodeControlNumber } from '../../src/micro_otter/nodes/html/js/data/node-control-number.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import {
    CONNECTOR_LABEL_OFFSET,
    CONNECTOR_OVERLAP,
    CONNECTOR_ROW_RESERVED_GAP,
    INPUT_DEFAULT_CONTROL_MIN_WIDTH,
    NODE_BODY_PADDING,
    NODE_HEADER_HEIGHT,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-constants.js';
import {
    computeNodeMinContentWidth,
    getInputDefaultControlBounds,
    measureConnectorLabelWidth,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';

const ROW_INSET = CONNECTOR_OVERLAP + CONNECTOR_LABEL_OFFSET;

function createDefaultControl(label = 'In') {
    return new NodeControlNumber({
        id: 'value',
        type: 'number',
        label,
        default: 0,
        min: 0,
        max: 100,
    });
}

function createNodeData(overrides = {}) {
    return new NodeData({
        id: 'node-1',
        type: 'math',
        width: 140,
        controls: [],
        controlValues: {},
        inputDefaults: {},
        outputs: [{ id: 'out0', name: 'Envelope Follow' }],
        ...overrides,
    });
}

function createGraphWithSpy(nodeData) {
    const graph = new NodeGraph('test-graph');
    const addedNode = graph.addNode(nodeData);
    const updateCalls = [];
    const originalUpdateNode = graph.updateNode.bind(graph);

    graph.updateNode = (nodeId, patch, previous) => {
        updateCalls.push({ nodeId, patch });
        return originalUpdateNode(nodeId, patch, previous);
    };

    return { graph, nodeId: addedNode.id, updateCalls };
}

function createMockContext() {
    return {
        save() {},
        restore() {},
        beginPath() {},
        roundRect() {},
        closePath() {},
        fill() {},
        stroke() {},
        clip() {},
        fillRect() {},
        drawImage() {},
        moveTo() {},
        lineTo() {},
        translate() {},
        rotate() {},
        scale() {},
        fillText() {},
        strokeRect() {},
        measureText(text) {
            return { width: String(text).length * 7 };
        },
        set fillStyle(_value) {},
        set strokeStyle(_value) {},
        set lineWidth(_value) {},
        set globalAlpha(_value) {},
        set textAlign(_value) {},
        set textBaseline(_value) {},
        set font(_value) {},
        lineCap: 'round',
        lineJoin: 'round',
    };
}

describe('NodeUi automatic width growth', () => {
    let nodeData;
    let graph;
    let nodeId;
    let updateCalls;
    let nodeUi;

    beforeEach(() => {
        nodeData = createNodeData({
            inputs: [{ id: 'in0', name: 'In', defaultControl: createDefaultControl() }],
        });
        const created = createGraphWithSpy(nodeData);
        graph = created.graph;
        nodeId = created.nodeId;
        updateCalls = created.updateCalls;
        nodeUi = new NodeUi(graph, nodeId);
    });

    it('reports the content-derived minimum width', () => {
        const expected =
            ROW_INSET +
            INPUT_DEFAULT_CONTROL_MIN_WIDTH +
            CONNECTOR_ROW_RESERVED_GAP +
            measureConnectorLabelWidth('Envelope Follow') +
            ROW_INSET;

        assert.equal(nodeUi.getMinContentWidth(), expected);
        assert.equal(expected, 207);
    });

    it('widens a too narrow node to the content minimum', () => {
        nodeUi.ensureNodeWidth();

        const width = nodeUi.getNodeData().width;
        assert.equal(width, nodeUi.getMinContentWidth());
        assert.equal(updateCalls.length, 1);
        assert.deepEqual(updateCalls[0].patch, { width });
    });

    it('keeps the control usable and clear of the output label after growing', () => {
        nodeUi.ensureNodeWidth();

        const data = nodeUi.getNodeData();
        const outputLabelWidth = measureConnectorLabelWidth('Envelope Follow');
        const inputY = data.y + NODE_HEADER_HEIGHT + NODE_BODY_PADDING + 7;
        const expectedBounds = getInputDefaultControlBounds({
            nodeX: data.x,
            nodeWidth: data.width,
            inputConnectorX: data.x + CONNECTOR_OVERLAP,
            inputCenterY: inputY,
            rowHasOpposingOutput: true,
            opposingOutputLabelWidth: outputLabelWidth,
        });

        assert.ok(expectedBounds.width >= INPUT_DEFAULT_CONTROL_MIN_WIDTH);
        assert.equal(
            expectedBounds.x + expectedBounds.width,
            data.x + data.width - ROW_INSET - outputLabelWidth - CONNECTOR_ROW_RESERVED_GAP
        );

        const hit = nodeUi.hitTestControl({
            x: expectedBounds.x + expectedBounds.width / 2,
            y: inputY,
        });
        assert.equal(hit?.controlId, 'in0');
        assert.deepEqual(hit?.bounds, expectedBounds);
    });

    it('is idempotent', () => {
        nodeUi.ensureNodeWidth();
        nodeUi.ensureNodeWidth();
        nodeUi.ensureNodeWidth();

        assert.equal(updateCalls.length, 1);
    });

    it('never shrinks a wider node', () => {
        nodeUi.getNodeData().width = 400;

        nodeUi.ensureNodeWidth();

        assert.equal(nodeUi.getNodeData().width, 400);
        assert.equal(updateCalls.length, 0);
    });

    it('leaves collapsed nodes untouched', () => {
        nodeUi.getNodeData().collapsed = true;

        nodeUi.ensureNodeWidth();

        assert.equal(nodeUi.getNodeData().width, 140);
        assert.equal(updateCalls.length, 0);
    });

    it('leaves nodes without connector rows untouched', () => {
        const plainNode = createNodeData({ outputs: [] });
        const created = createGraphWithSpy(plainNode);
        const plainUi = new NodeUi(created.graph, created.nodeId);

        plainUi.ensureNodeWidth();

        assert.equal(plainUi.getMinContentWidth(), 0);
        assert.equal(plainUi.getNodeData().width, 140);
        assert.equal(created.updateCalls.length, 0);
    });

    it('grows the node when it is drawn', () => {
        nodeUi.draw(createMockContext());

        assert.equal(nodeUi.getNodeData().width, nodeUi.getMinContentWidth());

        const widthCalls = updateCalls.filter((call) =>
            Object.prototype.hasOwnProperty.call(call.patch, 'width')
        );
        assert.equal(widthCalls.length, 1);
    });
});

describe('NodeUi control-driven width growth', () => {
    const controls = [
        { id: 'count', type: 'number', label: 'Count', default: 4 },
        {
            id: 'model',
            type: 'dropdown',
            label: 'Color Model',
            default: 'rgb',
            options: [{ value: 'rgb', label: 'RGB' }],
        },
        { id: 'pin', type: 'text', label: 'Data Pin', default: 'gpio1' },
        {
            id: 'order',
            type: 'dropdown',
            label: 'Color Order',
            default: 'rgb',
            options: [{ value: 'rgb', label: 'RGB' }],
        },
    ];

    const controlValues = { count: 4, model: 'rgb', pin: 'gpio1', order: 'rgb' };

    function createControlNode(overrides = {}) {
        const nodeData = createNodeData({ controls, controlValues, outputs: [], ...overrides });
        const created = createGraphWithSpy(nodeData);
        return { ...created, nodeData, nodeUi: new NodeUi(created.graph, created.nodeId) };
    }

    it('reports the control minimum and grows to it exactly', () => {
        const { nodeData, nodeUi } = createControlNode();
        const expected = computeNodeMinContentWidth(nodeData);

        assert.ok(expected > 140, 'four controls must exceed the default node width');
        assert.equal(nodeUi.getMinContentWidth(), expected);

        nodeUi.ensureNodeWidth();

        assert.equal(nodeUi.getNodeData().width, expected);
    });

    it('requests the widened node only once across repeated draws', () => {
        const { nodeUi, updateCalls } = createControlNode();

        nodeUi.draw(createMockContext());
        nodeUi.draw(createMockContext());

        const widthCalls = updateCalls.filter((call) =>
            Object.prototype.hasOwnProperty.call(call.patch, 'width')
        );
        assert.equal(widthCalls.length, 1);
    });

    it('leaves a narrow checkbox-only node at its constructed width', () => {
        const { nodeUi, updateCalls } = createControlNode({
            controls: [{ id: 'enabled', type: 'checkbox', label: 'On', default: false }],
            controlValues: { enabled: false },
        });

        nodeUi.ensureNodeWidth();

        assert.ok(nodeUi.getMinContentWidth() < 140);
        assert.equal(nodeUi.getNodeData().width, 140);
        assert.equal(
            updateCalls.filter((call) => Object.prototype.hasOwnProperty.call(call.patch, 'width'))
                .length,
            0
        );
    });

    it('returns zero and leaves collapsed control nodes untouched', () => {
        const { nodeUi, updateCalls } = createControlNode({ collapsed: true });

        nodeUi.ensureNodeWidth();

        assert.equal(nodeUi.getMinContentWidth(), 0);
        assert.equal(nodeUi.getNodeData().width, 140);
        assert.equal(updateCalls.length, 0);
    });
});
