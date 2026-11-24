// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeData } from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import NodeControlBase from '../../src/micro_otter/nodes/html/js/data/node-control-base.js';
import NodeControlNumber from '../../src/micro_otter/nodes/html/js/data/node-control-number.js';

describe('NodeData Input Enrichment', () => {
    it('should enrich inputs with defaultControl from plain object', () => {
        const nodeData = new NodeData({
            id: 'test-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    defaultControl: {
                        id: 'in0',
                        type: 'number',
                        label: 'Value',
                        default: 42,
                        min: 0,
                        max: 100,
                    },
                },
                {
                    id: 'in1',
                    name: 'Factor',
                },
            ],
        });

        assert.equal(nodeData.inputs.length, 2);

        // First input should have defaultControl as NodeControlBase instance
        const input0 = nodeData.inputs[0];
        assert.ok(input0.defaultControl, 'Input 0 should have defaultControl');
        assert.ok(
            input0.defaultControl instanceof NodeControlBase,
            'defaultControl should be NodeControlBase instance'
        );
        assert.ok(
            input0.defaultControl instanceof NodeControlNumber,
            'defaultControl should be NodeControlNumber instance'
        );
        assert.equal(input0.defaultControl.id, 'in0');
        assert.equal(input0.defaultControl.type, 'number');
        assert.equal(input0.defaultControl.defaultValue, 42);

        // Second input should not have defaultControl
        const input1 = nodeData.inputs[1];
        assert.equal(input1.defaultControl, undefined, 'Input 1 should not have defaultControl');
    });

    it('should preserve existing NodeControlBase instance in defaultControl', () => {
        const existingControl = new NodeControlNumber({
            id: 'in0',
            type: 'number',
            label: 'Value',
            default: 99,
        });

        const nodeData = new NodeData({
            id: 'test-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    defaultControl: existingControl,
                },
            ],
        });

        // Should preserve the same instance
        assert.strictEqual(
            nodeData.inputs[0].defaultControl,
            existingControl,
            'Should preserve existing NodeControlBase instance'
        );
    });

    it('should serialize inputs with defaultControl back to plain objects', () => {
        const nodeData = new NodeData({
            id: 'test-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    defaultControl: {
                        id: 'in0',
                        type: 'number',
                        label: 'Value',
                        default: 42,
                        min: 0,
                        max: 100,
                    },
                },
            ],
        });

        const serialized = nodeData.toData();

        assert.ok(serialized.inputs, 'Serialized data should have inputs');
        assert.equal(serialized.inputs.length, 1);

        const input0 = serialized.inputs[0];
        assert.ok(input0.defaultControl, 'Serialized input should have defaultControl');
        assert.ok(
            !(input0.defaultControl instanceof NodeControlBase),
            'Serialized defaultControl should be plain object, not NodeControlBase instance'
        );
        assert.equal(input0.defaultControl.id, 'in0');
        assert.equal(input0.defaultControl.type, 'number');
        assert.equal(input0.defaultControl.default, 42);
    });

    it('should handle round-trip: serialize then deserialize', () => {
        const original = new NodeData({
            id: 'test-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    defaultControl: {
                        id: 'in0',
                        type: 'number',
                        label: 'Value',
                        default: 42,
                        min: 0,
                        max: 100,
                    },
                },
            ],
        });

        // Serialize to plain object
        const serialized = original.toData();

        // Deserialize back to NodeData
        const restored = new NodeData(serialized);

        // Should have enriched defaultControl again
        assert.ok(
            restored.inputs[0].defaultControl instanceof NodeControlBase,
            'Restored defaultControl should be NodeControlBase instance'
        );
        assert.equal(restored.inputs[0].defaultControl.defaultValue, 42);
    });

    it('should handle inputs without defaultControl', () => {
        const nodeData = new NodeData({
            id: 'test-node',
            type: 'math',
            inputs: [
                {
                    id: 'in0',
                    name: 'Value',
                    // No defaultControl
                },
            ],
        });

        assert.equal(nodeData.inputs[0].defaultControl, undefined);

        // Serialization should work fine
        const serialized = nodeData.toData();
        assert.equal(serialized.inputs[0].defaultControl, undefined);
    });

    it('should handle empty inputs array', () => {
        const nodeData = new NodeData({
            id: 'test-node',
            type: 'math',
            inputs: [],
        });

        assert.deepEqual(nodeData.inputs, []);
        assert.deepEqual(nodeData.toData().inputs, []);
    });

    it('should handle missing inputs property', () => {
        const nodeData = new NodeData({
            id: 'test-node',
            type: 'math',
            // No inputs property
        });

        assert.deepEqual(nodeData.inputs, []);
        assert.deepEqual(nodeData.toData().inputs, []);
    });
});
