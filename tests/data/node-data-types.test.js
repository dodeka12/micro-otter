// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';

describe('NodeData - Data Type Support', () => {
    describe('getInputAllowedTypes()', () => {
        it('should return allowedTypes for an input', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                inputs: [
                    { id: 'in0', name: 'Input 1', allowedTypes: ['float'] },
                    { id: 'in1', name: 'Input 2', allowedTypes: ['string', 'float'] },
                ],
            });

            assert.deepEqual(node.getInputAllowedTypes('in0'), ['float']);
            assert.deepEqual(node.getInputAllowedTypes('in1'), ['string', 'float']);
        });

        it('should throw if input not found', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                inputs: [{ id: 'in0', name: 'Input', allowedTypes: ['float'] }],
            });

            assert.throws(() => {
                node.getInputAllowedTypes('nonexistent');
            }, /Input 'nonexistent' not found/);
        });

        it('should throw if allowedTypes missing', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                inputs: [{ id: 'in0', name: 'Input' }],
            });

            assert.throws(() => {
                node.getInputAllowedTypes('in0');
            }, /missing required allowedTypes/);
        });

        it('should throw if allowedTypes is empty array', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                inputs: [{ id: 'in0', name: 'Input', allowedTypes: [] }],
            });

            assert.throws(() => {
                node.getInputAllowedTypes('in0');
            }, /missing required allowedTypes/);
        });
    });

    describe('getOutputType()', () => {
        it('should return outputType for an output', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                outputs: [
                    { id: 'out0', name: 'Output 1', outputType: 'float' },
                    { id: 'out1', name: 'Output 2', outputType: 'rgbColor' },
                ],
            });

            assert.equal(node.getOutputType('out0'), 'float');
            assert.equal(node.getOutputType('out1'), 'rgbColor');
        });

        it('should throw if output not found', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                outputs: [{ id: 'out0', name: 'Output', outputType: 'float' }],
            });

            assert.throws(() => {
                node.getOutputType('nonexistent');
            }, /Output 'nonexistent' not found/);
        });

        it('should throw if outputType missing', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                outputs: [{ id: 'out0', name: 'Output' }],
            });

            assert.throws(() => {
                node.getOutputType('out0');
            }, /missing required outputType/);
        });

        it('ignores the retired type_input_source key and uses the declared outputType', () => {
            const node = new NodeData({
                id: 1,
                type: 'branching-node',
                inputs: [
                    { id: 'value', name: 'Value', allowedTypes: ['float', 'unknown'] },
                ],
                outputs: [
                    { id: 'true', name: 'True', outputType: 'any', type_input_source: 'value' },
                ],
            });

            assert.equal(node.getOutputType('true'), 'any');
        });

        it('should keep the declared outputType for a union output', () => {
            const node = new NodeData({
                id: 1,
                type: 'core-select',
                inputs: [
                    { id: 'condition', name: 'Condition', allowedTypes: ['bool'] },
                    { id: 'trueValue', name: 'True', allowedTypes: ['float', 'string'] },
                    { id: 'falseValue', name: 'False', allowedTypes: ['bool'] },
                ],
                outputs: [
                    {
                        id: 'value',
                        name: 'Value',
                        outputType: 'any',
                        initialTypes: ['bool', 'int', 'float', 'string', 'core.tuple'],
                        typeInputSources: ['trueValue', 'falseValue'],
                    },
                ],
            });

            assert.equal(node.getOutputType('value'), 'any');
        });
    });

    describe('Multiple outputs', () => {
        it('should support nodes with multiple outputs', () => {
            const node = new NodeData({
                id: 1,
                type: 'rgbExtractor',
                outputs: [
                    { id: 'red', name: 'Red', outputType: 'float' },
                    { id: 'green', name: 'Green', outputType: 'float' },
                    { id: 'blue', name: 'Blue', outputType: 'float' },
                ],
            });

            assert.equal(node.outputs.length, 3);
            assert.equal(node.getOutputType('red'), 'float');
            assert.equal(node.getOutputType('green'), 'float');
            assert.equal(node.getOutputType('blue'), 'float');
        });

        it('should support nodes with different output types', () => {
            const node = new NodeData({
                id: 1,
                type: 'dataConverter',
                outputs: [
                    { id: 'out0', name: 'Number', outputType: 'float' },
                    { id: 'out1', name: 'String', outputType: 'string' },
                    { id: 'out2', name: 'Color', outputType: 'rgbColor' },
                ],
            });

            assert.equal(node.getOutputType('out0'), 'float');
            assert.equal(node.getOutputType('out1'), 'string');
            assert.equal(node.getOutputType('out2'), 'rgbColor');
        });
    });

    describe('Serialization', () => {
        it('should preserve input allowedTypes through toData()', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                inputs: [
                    { id: 'in0', name: 'Input', allowedTypes: ['float', 'string'] },
                ],
            });

            const data = node.toData();
            assert.deepEqual(data.inputs[0].allowedTypes, ['float', 'string']);
        });

        it('should preserve output outputType through toData()', () => {
            const node = new NodeData({
                id: 1,
                type: 'test',
                outputs: [
                    { id: 'out0', name: 'Output', outputType: 'rgbColor' },
                ],
            });

            const data = node.toData();
            assert.equal(data.outputs[0].outputType, 'rgbColor');
        });

        it('should round-trip type information through fromData()', () => {
            const original = new NodeData({
                id: 1,
                type: 'test',
                inputs: [
                    { id: 'in0', name: 'Input', allowedTypes: ['float'] },
                ],
                outputs: [
                    { id: 'out0', name: 'Output', outputType: 'string' },
                ],
            });

            const restored = NodeData.fromData(original.toData());
            assert.deepEqual(restored.getInputAllowedTypes('in0'), ['float']);
            assert.equal(restored.getOutputType('out0'), 'string');
        });
    });
});
