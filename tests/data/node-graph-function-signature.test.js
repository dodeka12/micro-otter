// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Function-signature persistence and event tests for the real `NodeGraph` model.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

describe('NodeGraph function execution type', () => {
    it('accepts function as an execution type and round-trips it', () => {
        const graph = new NodeGraph({ id: 'graph-fn', executionType: 'function' });

        assert.equal(graph.getExecutionType(), 'function');
        assert.equal(graph.toData().executionType, 'function');
        assert.equal(new NodeGraph(graph.toData()).getExecutionType(), 'function');
    });
});

describe('NodeGraph function signature', () => {
    it('starts empty with the default category', () => {
        const graph = new NodeGraph({ id: 'graph-empty' });

        assert.deepEqual(graph.getFunctionSignature(), {
            category: 'function',
            icon: 'mdi:function',
            inputs: [],
            outputs: [],
        });
        assert.equal(graph.getFunctionCategory(), 'function');
        assert.equal(graph.getFunctionIcon(), 'mdi:function');
        assert.deepEqual(graph.getFunctionInputPorts(), []);
        assert.deepEqual(graph.getFunctionOutputPorts(), []);
        assert.equal(graph.getFunctionNodeTypeId(), 'function_graph.graph-empty');
    });

    it('emits one functionSignature event per real change', () => {
        const graph = new NodeGraph({ id: 'graph-events', executionType: 'function' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'functionSignature') {
                events.push(event);
            }
        });

        graph.setFunctionCategory(' Math ');
        graph.setFunctionCategory('Math');
        graph.setFunctionPorts('input', [{ name: ' A ', types: ['int'] }]);

        assert.equal(events.length, 2);

        const categoryEvent = assertAppEventPayloadType(
            events[0],
            'NodeGraph.FunctionSignatureChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(categoryEvent.detail.graphId, 'graph-events');
        assert.equal(categoryEvent.detail.functionSignature.category, 'Math');

        const portsEvent = assertAppEventPayloadType(
            events[1],
            'NodeGraph.FunctionSignatureChanged.v1',
            'NodeGraph listener'
        );
        assert.deepEqual(portsEvent.detail.functionSignature.inputs, [
            { id: 'in_0', name: 'A', types: ['int'], default: { type: 'int', value: 0 } },
        ]);
    });

    it('only replaces the port list that was addressed', () => {
        const graph = new NodeGraph({
            id: 'graph-lists',
            executionType: 'function',
            functionSignature: {
                category: 'Math',
                inputs: [{ name: 'A', types: ['int'] }],
                outputs: [{ name: 'Sum', types: ['int'] }],
            },
        });

        graph.setFunctionPorts('output', [{ name: 'Product', types: ['float'] }]);

        assert.deepEqual(graph.getFunctionInputPorts(), [
            { id: 'in_0', name: 'A', types: ['int'], default: { type: 'int', value: 0 } },
        ]);
        assert.deepEqual(graph.getFunctionOutputPorts(), [
            { id: 'out_0', name: 'Product', types: ['float'] },
        ]);
        assert.equal(graph.getFunctionCategory(), 'Math');
    });

    it('re-derives port ids when a port moves', () => {
        const graph = new NodeGraph({
            id: 'graph-move',
            executionType: 'function',
            functionSignature: {
                inputs: [
                    { name: 'A', types: ['int'] },
                    { name: 'B', types: ['int'] },
                ],
            },
        });

        const reordered = graph.getFunctionInputPorts().reverse();
        graph.setFunctionPorts('input', reordered);

        assert.deepEqual(graph.getFunctionInputPorts(), [
            { id: 'in_0', name: 'B', types: ['int'], default: { type: 'int', value: 0 } },
            { id: 'in_1', name: 'A', types: ['int'], default: { type: 'int', value: 0 } },
        ]);
    });

    it('returns copies that cannot mutate graph state', () => {
        const graph = new NodeGraph({
            id: 'graph-copy',
            executionType: 'function',
            functionSignature: { inputs: [{ name: 'A', types: ['int'] }] },
        });

        const signature = graph.getFunctionSignature();
        signature.category = 'Mutated';
        signature.inputs[0].types.push('string');
        signature.inputs.push({ id: 'in_1', name: 'B', types: ['int'] });

        assert.equal(graph.getFunctionCategory(), 'function');
        assert.deepEqual(graph.getFunctionInputPorts(), [
            { id: 'in_0', name: 'A', types: ['int'], default: { type: 'int', value: 0 } },
        ]);
    });

    it('round-trips the signature through toData and fromData', () => {
        const graph = new NodeGraph({
            id: 'graph-round-trip',
            executionType: 'function',
            functionSignature: {
                category: 'Math',
                inputs: [{ name: 'A', types: ['int', 'float'] }],
                outputs: [{ name: 'Sum', types: ['int'] }],
            },
        });

        const data = graph.toData();
        assert.deepEqual(data.functionSignature, {
            category: 'Math',
            icon: 'mdi:function',
            inputs: [
                {
                    id: 'in_0',
                    name: 'A',
                    types: ['int', 'float'],
                    default: { type: 'int', value: 0 },
                },
            ],
            outputs: [{ id: 'out_0', name: 'Sum', types: ['int'] }],
        });

        const reloaded = NodeGraph.fromData(data);
        assert.deepEqual(reloaded.getFunctionSignature(), data.functionSignature);
    });

    it('stores, normalizes and emits icon changes', () => {
        const graph = new NodeGraph({ id: 'graph-icon', executionType: 'function' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'functionSignature') {
                events.push(event);
            }
        });

        graph.setFunctionIcon(' mdi:thermometer ');
        graph.setFunctionIcon('mdi:thermometer');

        assert.equal(graph.getFunctionIcon(), 'mdi:thermometer');
        assert.equal(graph.getFunctionSignature().icon, 'mdi:thermometer');
        assert.equal(events.length, 1);

        const iconEvent = assertAppEventPayloadType(
            events[0],
            'NodeGraph.FunctionSignatureChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(iconEvent.detail.functionSignature.icon, 'mdi:thermometer');
        assert.equal(iconEvent.detail.previousSignature.icon, 'mdi:function');
        assert.equal(iconEvent.detail.indexMapping, null);
    });

    it('falls back to the default icon for blank input', () => {
        const graph = new NodeGraph({
            id: 'graph-icon-blank',
            executionType: 'function',
            functionSignature: { icon: 'mdi:thermometer' },
        });

        graph.setFunctionIcon('   ');

        assert.equal(graph.getFunctionIcon(), 'mdi:function');
    });

    it('round-trips a custom icon through toData and fromData', () => {
        const graph = new NodeGraph({
            id: 'graph-icon-round-trip',
            executionType: 'function',
            functionSignature: { icon: 'mdi:thermometer' },
        });

        const data = graph.toData();
        assert.equal(data.functionSignature.icon, 'mdi:thermometer');
        assert.equal(NodeGraph.fromData(data).getFunctionIcon(), 'mdi:thermometer');
    });

    it('serializes a non-function graph whose only custom field is the icon', () => {
        const graph = new NodeGraph({
            id: 'graph-icon-only',
            functionSignature: { icon: 'mdi:thermometer' },
        });

        assert.equal(graph.toData().functionSignature.icon, 'mdi:thermometer');
    });

    it('keeps legacy graphs free of the signature key', () => {
        const graph = new NodeGraph({ id: 'graph-legacy' });
        const data = graph.toData();

        assert.equal(Object.prototype.hasOwnProperty.call(data, 'functionSignature'), false);
        assert.equal(new NodeGraph(data).getFunctionCategory(), 'function');
    });

    it('serializes a default-icon graph without the signature key', () => {
        const graph = new NodeGraph({
            id: 'graph-default-icon',
            functionSignature: { icon: 'mdi:function' },
        });

        const data = graph.toData();

        assert.equal(Object.prototype.hasOwnProperty.call(data, 'functionSignature'), false);
        assert.equal(new NodeGraph(data).getFunctionIcon(), 'mdi:function');
    });

    it('keeps a signature that survived a switch away from the function type', () => {
        const graph = new NodeGraph({
            id: 'graph-switch',
            executionType: 'function',
            functionSignature: { inputs: [{ name: 'A', types: ['int'] }] },
        });

        graph.setExecutionType('continuous');

        assert.equal(graph.toData().functionSignature.inputs.length, 1);
    });

    it('stores, normalizes and emits description changes', () => {
        const graph = new NodeGraph({ id: 'graph-description', executionType: 'function' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'functionSignature') {
                events.push(event);
            }
        });

        graph.setFunctionDescription('  does math\n\nin place  ');
        graph.setFunctionDescription('does math\n\nin place');

        assert.equal(graph.getFunctionDescription(), 'does math\n\nin place');
        assert.equal(graph.getFunctionSignature().description, 'does math\n\nin place');
        assert.equal(events.length, 1);

        const descriptionEvent = assertAppEventPayloadType(
            events[0],
            'NodeGraph.FunctionSignatureChanged.v1',
            'NodeGraph listener'
        );
        assert.equal(descriptionEvent.detail.functionSignature.description, 'does math\n\nin place');
        assert.equal(descriptionEvent.detail.previousSignature.description, undefined);
        assert.equal(descriptionEvent.detail.indexMapping, null);
    });

    it('returns an empty description when none is declared', () => {
        const graph = new NodeGraph({ id: 'graph-description-empty' });

        assert.equal(graph.getFunctionDescription(), '');
    });

    it('clears the description for blank input', () => {
        const graph = new NodeGraph({
            id: 'graph-description-clear',
            executionType: 'function',
            functionSignature: { description: 'does math' },
        });

        graph.setFunctionDescription('   ');

        assert.equal(graph.getFunctionDescription(), '');
        assert.equal('description' in graph.getFunctionSignature(), false);
    });

    it('patches a port documentation through updateFunctionPort', () => {
        const graph = new NodeGraph({
            id: 'graph-port-doc',
            executionType: 'function',
            functionSignature: { inputs: [{ name: 'A', types: ['int'] }] },
        });

        const updated = graph.updateFunctionPort('input', 'in_0', {
            documentation: ' reads **pin** ',
        });

        assert.equal(updated.documentation, 'reads **pin**');
        assert.deepEqual(graph.getFunctionInputPorts()[0], {
            id: 'in_0',
            name: 'A',
            types: ['int'],
            default: { type: 'int', value: 0 },
            documentation: 'reads **pin**',
        });
    });

    it('round-trips description and documentation through toData and fromData', () => {
        const graph = new NodeGraph({
            id: 'graph-doc-round-trip',
            executionType: 'function',
            functionSignature: {
                description: '  does *math*  ',
                inputs: [{ name: 'A', types: ['int'], documentation: ' input **a** ' }],
                outputs: [{ name: 'Sum', types: ['int'] }],
            },
        });

        const data = graph.toData();
        assert.equal(data.functionSignature.description, 'does *math*');
        assert.equal(data.functionSignature.inputs[0].documentation, 'input **a**');
        assert.equal('documentation' in data.functionSignature.outputs[0], false);

        const reloaded = NodeGraph.fromData(data);
        assert.equal(reloaded.getFunctionDescription(), 'does *math*');
        assert.equal(reloaded.getFunctionInputPorts()[0].documentation, 'input **a**');
    });

    it('serializes a non-function graph whose only custom field is the description', () => {
        const graph = new NodeGraph({
            id: 'graph-description-only',
            functionSignature: { description: 'does math' },
        });

        assert.equal(graph.toData().functionSignature.description, 'does math');
    });
});
