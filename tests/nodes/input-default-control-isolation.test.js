// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: Input Default Control Value Isolation
 *
 * Verifies that multiple inputs with default controls store their values independently.
 * Regression test for bug where changing one default input value would affect others.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { NodeControlNumber } from '../../src/micro_otter/nodes/html/js/data/node-control-number.js';
import { NodeControlText } from '../../src/micro_otter/nodes/html/js/data/node-control-text.js';

describe('Input Default Control Value Isolation', () => {
    let graph;
    let nodeData;
    let nodeUi;

    beforeEach(() => {
        // Create a node with multiple inputs, each having a default control
        nodeData = new NodeData({
            id: 'test-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value A',
                    defaultControl: new NodeControlNumber({
                        id: 'value', // Same control type/id - potential conflict
                        type: 'number',
                        label: 'Value A',
                        default: 10,
                        min: 0,
                        max: 100,
                    }),
                },
                {
                    id: 'in1',
                    name: 'Value B',
                    defaultControl: new NodeControlNumber({
                        id: 'value', // Same control type/id - potential conflict
                        type: 'number',
                        label: 'Value B',
                        default: 20,
                        min: 0,
                        max: 100,
                    }),
                },
            ],
            outputs: [{ id: 'out0', name: 'Result' }],
            controls: [],
            controlValues: {},
            inputDefaults: {},
        });

        graph = new NodeGraph('test-graph');
        const addedNode = graph.addNode(nodeData);
        const nodeId = addedNode.id;

        nodeUi = new NodeUi(graph, nodeId, {
            selected: false,
        });
    });

    it('should store default input values independently', () => {
        // Verify initial values are separate
        const control0 = nodeUi.inputDefaultControlInstances.get('in0');
        const control1 = nodeUi.inputDefaultControlInstances.get('in1');

        assert.ok(control0, 'Control for in0 should exist');
        assert.ok(control1, 'Control for in1 should exist');

        assert.strictEqual(control0.getValue(), 10, 'in0 should have default value 10');
        assert.strictEqual(control1.getValue(), 20, 'in1 should have default value 20');
    });

    it('should not affect other inputs when changing one default control value', () => {
        const control0 = nodeUi.inputDefaultControlInstances.get('in0');
        const control1 = nodeUi.inputDefaultControlInstances.get('in1');

        // Change first input's value
        control0.setValue(50);

        // Verify only the first input changed
        assert.strictEqual(control0.getValue(), 50, 'in0 should have new value 50');
        assert.strictEqual(control1.getValue(), 20, 'in1 should still have value 20');

        // Change second input's value
        control1.setValue(75);

        // Verify both values are now different
        assert.strictEqual(control0.getValue(), 50, 'in0 should still have value 50');
        assert.strictEqual(control1.getValue(), 75, 'in1 should have new value 75');
    });

    it('should store values in nodeData.inputDefaults with correct keys', () => {
        const control0 = nodeUi.inputDefaultControlInstances.get('in0');
        const control1 = nodeUi.inputDefaultControlInstances.get('in1');

        control0.setValue(30);
        control1.setValue(40);

        // Get the actual NodeData from the graph (not the local variable)
        const actualNodeData = nodeUi.getNodeData();

        // Verify values are stored with input IDs as keys
        assert.strictEqual(
            actualNodeData.inputDefaults.in0,
            30,
            'inputDefaults should store in0 value with key "in0"'
        );
        assert.strictEqual(
            actualNodeData.inputDefaults.in1,
            40,
            'inputDefaults should store in1 value with key "in1"'
        );
    });

    it('should use input ID as control ID, not control definition ID', () => {
        const control0 = nodeUi.inputDefaultControlInstances.get('in0');
        const control1 = nodeUi.inputDefaultControlInstances.get('in1');

        // The control definitions both have id: 'value', but controls should use input IDs
        assert.strictEqual(
            control0.controlData.id,
            'in0',
            'Control for in0 should use input ID "in0"'
        );
        assert.strictEqual(
            control1.controlData.id,
            'in1',
            'Control for in1 should use input ID "in1"'
        );
    });

    it('should handle three or more inputs with default controls', () => {
        // Create a node with three inputs
        const multiInputNode = new NodeData({
            id: 'multi-input-node',
            type: 'complex',
            inputs: [
                {
                    id: 'in0',
                    name: 'A',
                    defaultControl: new NodeControlNumber({
                        id: 'val',
                        type: 'number',
                        default: 1,
                    }),
                },
                {
                    id: 'in1',
                    name: 'B',
                    defaultControl: new NodeControlNumber({
                        id: 'val',
                        type: 'number',
                        default: 2,
                    }),
                },
                {
                    id: 'in2',
                    name: 'C',
                    defaultControl: new NodeControlNumber({
                        id: 'val',
                        type: 'number',
                        default: 3,
                    }),
                },
            ],
            outputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: {},
        });

        const addedMultiNode = graph.addNode(multiInputNode);
        const multiNodeId = addedMultiNode.id;
        const multiUi = new NodeUi(graph, multiNodeId);

        const ctrl0 = multiUi.inputDefaultControlInstances.get('in0');
        const ctrl1 = multiUi.inputDefaultControlInstances.get('in1');
        const ctrl2 = multiUi.inputDefaultControlInstances.get('in2');

        // Set different values
        ctrl0.setValue(10);
        ctrl1.setValue(20);
        ctrl2.setValue(30);

        // Verify all are independent
        assert.strictEqual(ctrl0.getValue(), 10);
        assert.strictEqual(ctrl1.getValue(), 20);
        assert.strictEqual(ctrl2.getValue(), 30);
    });

    it('supports editable text input defaults (print title style)', () => {
        const printLikeNode = new NodeData({
            id: 'print-node',
            type: 'print',
            inputs: [
                {
                    id: 'title',
                    name: 'Title',
                    defaultControl: new NodeControlText({
                        id: 'title',
                        type: 'text',
                        default: 'Value',
                    }),
                },
                {
                    id: 'in0',
                    name: 'Value',
                },
            ],
            outputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: {},
        });

        const addedNode = graph.addNode(printLikeNode);
        const printUi = new NodeUi(graph, addedNode.id);
        const titleControl = printUi.inputDefaultControlInstances.get('title');

        assert.ok(titleControl, 'Text default control for title should exist');
        assert.equal(titleControl.getValue(), 'Value');

        titleControl.setValue('Serial');

        const actualNodeData = printUi.getNodeData();
        assert.equal(actualNodeData.inputDefaults.title, 'Serial');
    });

    it('keeps an input default control out of controlValues', () => {
        const control0 = nodeUi.inputDefaultControlInstances.get('in0');
        const actualNodeData = nodeUi.getNodeData();

        control0.setValue(42);
        nodeUi.onControlChanged('in0', 42, 10);

        assert.equal(actualNodeData.inputDefaults.in0, 42);
        assert.deepEqual(actualNodeData.controlValues, {});
    });

    it('keeps a control out of inputDefaults', () => {
        const nodeDataWithControl = new NodeData({
            id: 'control-node',
            type: 'math',
            inputs: [],
            outputs: [],
            controls: [{ id: 'mode', type: 'text', default: 'a' }],
            controlValues: { mode: 'a' },
            inputDefaults: {},
        });
        const addedNode = graph.addNode(nodeDataWithControl);
        const controlUi = new NodeUi(graph, addedNode.id);
        const actualNodeData = controlUi.getNodeData();

        // A control instance writes its own `controlValues` entry before it notifies.
        actualNodeData.controlValues.mode = 'b';
        controlUi.onControlChanged('mode', 'b', 'a');

        assert.equal(actualNodeData.controlValues.mode, 'b');
        assert.deepEqual(actualNodeData.inputDefaults, {});
    });

    it('clamps a declared number default into its bounds via nested constraints', () => {
        const node = new NodeData({
            id: 'nested-clamp-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    defaultControl: {
                        type: 'number',
                        default: 250,
                        constraints: { min: 0, max: 100 },
                    },
                },
            ],
            outputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: {},
        });

        const added = graph.addNode(node);
        const ui = new NodeUi(graph, added.id);
        const control = ui.inputDefaultControlInstances.get('in0');

        assert.strictEqual(ui.getNodeData().inputDefaults.in0, 100);
        assert.strictEqual(control.getValue(), 100);
    });

    it('repairs a stale stored default that now falls outside the declared bounds', () => {
        const node = new NodeData({
            id: 'stale-clamp-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    defaultControl: new NodeControlNumber({
                        id: 'value',
                        type: 'number',
                        default: 10,
                        min: 0,
                        max: 100,
                    }),
                },
            ],
            outputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: { in0: 250 },
        });

        const added = graph.addNode(node);
        const ui = new NodeUi(graph, added.id);
        const control = ui.inputDefaultControlInstances.get('in0');

        assert.strictEqual(ui.getNodeData().inputDefaults.in0, 100);
        assert.strictEqual(control.getValue(), 100);
    });

    it('leaves an in-range stored default and non-number defaults untouched', () => {
        const node = new NodeData({
            id: 'inrange-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'A',
                    defaultControl: new NodeControlNumber({
                        id: 'value',
                        type: 'number',
                        default: 10,
                        min: 0,
                        max: 100,
                    }),
                },
                {
                    id: 'in1',
                    name: 'B',
                    defaultControl: new NodeControlText({
                        id: 'value',
                        type: 'text',
                        default: 'hello',
                    }),
                },
            ],
            outputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: { in0: 42, in1: 'world' },
        });

        const added = graph.addNode(node);
        const ui = new NodeUi(graph, added.id);

        assert.strictEqual(ui.getNodeData().inputDefaults.in0, 42);
        assert.strictEqual(ui.getNodeData().inputDefaults.in1, 'world');
    });
});
