// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Function port APIs on `NodeGraph`: index-safe wiring, connector sync, singleton nodes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_OUTPUT_NODE_TYPE,
    resolveFunctionStructuralNodePosition,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-nodes.js';
import { MAX_FUNCTION_PORTS } from '../../src/micro_otter/nodes/html/js/data/graph-function-signature.js';

/**
 * Build a function graph with one consumer node whose inputs accept any type.
 * @param {number} inputCount - Number of consumer inputs to create.
 * @returns {{graph: object, consumerId: string}} Graph and consumer node id.
 */
function buildPortGraph(inputCount = 3) {
    const graph = new NodeGraph({ id: 'graph-ports', executionType: 'function' });
    graph.setFunctionPorts(
        'input',
        Array.from({ length: inputCount }, (_, index) => ({
            name: `P${index}`,
            types: ['any'],
        }))
    );

    const consumer = graph.addNode({
        type: 'test-consumer',
        title: 'Consumer',
        x: 400,
        y: 0,
        inputs: Array.from({ length: inputCount }, (_, index) => ({
            id: `in${index}`,
            name: `In ${index}`,
            allowedTypes: ['any'],
        })),
        outputs: [],
    });

    return { graph, consumerId: consumer.id };
}

/**
 * Read the connector indices the input node currently drives.
 * @param {object} graph - Graph under test.
 * @returns {Array<{fromIndex: number, toIndex: number}>} Connections of the input node.
 */
function inputConnections(graph) {
    const node = graph.getFunctionStructuralNode('input');
    return graph
        .getConnections()
        .filter((connection) => connection.fromNode === node.id)
        .map((connection) => ({ fromIndex: connection.fromIndex, toIndex: connection.toIndex }));
}

describe('NodeGraph structural node singletons', () => {
    it('creates at most one node per kind', () => {
        const graph = new NodeGraph({ id: 'graph-singleton', executionType: 'function' });

        const first = graph.ensureFunctionStructuralNode('input');
        const second = graph.ensureFunctionStructuralNode('input');

        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(first.node.id, second.node.id);
        assert.equal(first.node.type, FUNCTION_INPUT_NODE_TYPE);
        assert.equal(graph.getNodes().length, 1);

        graph.ensureFunctionStructuralNode('output');
        assert.equal(graph.getNodes().length, 2);
        assert.equal(graph.getFunctionStructuralNode('output').type, FUNCTION_OUTPUT_NODE_TYPE);
    });

    it('uses an explicit position when it creates a structural node', () => {
        const graph = new NodeGraph({ id: 'graph-explicit-position', executionType: 'function' });

        const input = graph.ensureFunctionStructuralNode('input', { x: 320, y: 240 });
        const output = graph.ensureFunctionStructuralNode('output', { x: 640, y: 480 });

        assert.equal(input.created, true);
        assert.equal(input.node.x, 320);
        assert.equal(input.node.y, 240);
        assert.equal(output.created, true);
        assert.equal(output.node.x, 640);
        assert.equal(output.node.y, 480);
    });

    it('keeps the first position when an existing node is ensured again', () => {
        const graph = new NodeGraph({ id: 'graph-position-kept', executionType: 'function' });
        graph.ensureFunctionStructuralNode('input', { x: 320, y: 240 });

        const second = graph.ensureFunctionStructuralNode('input', { x: 900, y: 900 });

        assert.equal(second.created, false);
        assert.equal(second.node.x, 320);
        assert.equal(second.node.y, 240);
        assert.equal(graph.getNodes().length, 1);
    });

    it('falls back to the deterministic placement without a position', () => {
        const graph = new NodeGraph({ id: 'graph-position-fallback', executionType: 'function' });

        const input = graph.ensureFunctionStructuralNode('input');
        assert.deepEqual(
            { x: input.node.x, y: input.node.y },
            resolveFunctionStructuralNodePosition([], FUNCTION_INPUT_NODE_TYPE)
        );

        const output = graph.ensureFunctionStructuralNode('output');
        assert.deepEqual(
            { x: output.node.x, y: output.node.y },
            resolveFunctionStructuralNodePosition([input.node], FUNCTION_OUTPUT_NODE_TYPE)
        );
    });

    it('removes the structural node and its wiring', () => {
        const { graph, consumerId } = buildPortGraph(1);
        const { node } = graph.ensureFunctionStructuralNode('input');
        graph.addConnection({ fromNode: node.id, fromIndex: 0, toNode: consumerId, toIndex: 0 });

        assert.equal(graph.removeFunctionStructuralNode('input'), true);
        assert.equal(graph.removeFunctionStructuralNode('input'), false);
        assert.equal(graph.getFunctionStructuralNode('input'), null);
        assert.equal(graph.getConnections().length, 0);
    });
});

describe('NodeGraph addFunctionPort', () => {
    it('appends a port with the next index-derived id', () => {
        const graph = new NodeGraph({ id: 'graph-add', executionType: 'function' });

        const added = graph.addFunctionPort('input', { name: 'Hall Sensor', types: ['int'] });

        assert.deepEqual(added, {
            index: 0,
            port: {
                id: 'in_0',
                name: 'Hall Sensor',
                types: ['int'],
                default: { type: 'int', value: 0 },
            },
        });
        assert.deepEqual(graph.getFunctionInputPorts(), [
            {
                id: 'in_0',
                name: 'Hall Sensor',
                types: ['int'],
                default: { type: 'int', value: 0 },
            },
        ]);
    });

    it('normalizes a missing port to an empty any-typed port', () => {
        const graph = new NodeGraph({ id: 'graph-add-empty', executionType: 'function' });

        const added = graph.addFunctionPort('output');

        assert.deepEqual(added.port, { id: 'out_0', name: '', types: ['any'] });
    });

    it('stops at the port cap', () => {
        const graph = new NodeGraph({ id: 'graph-cap', executionType: 'function' });
        for (let index = 0; index < MAX_FUNCTION_PORTS; index += 1) {
            graph.addFunctionPort('input', { name: `P${index}` });
        }

        assert.equal(graph.addFunctionPort('input', { name: 'Overflow' }), null);
        assert.equal(graph.getFunctionInputPorts().length, MAX_FUNCTION_PORTS);
    });

    it('grows the structural node connectors', () => {
        const graph = new NodeGraph({ id: 'graph-connectors', executionType: 'function' });
        graph.ensureFunctionStructuralNode('input');

        graph.addFunctionPort('input', { name: 'A', types: ['int'] });
        graph.addFunctionPort('input', { name: 'B', types: ['float'] });

        const node = graph.getFunctionStructuralNode('input');
        assert.equal(node.outputs.length, 2);
        assert.deepEqual(
            node.outputs.map((output) => output.id),
            ['in_0', 'in_1']
        );
        assert.deepEqual(
            node.outputs.map((output) => output.allowedTypes),
            [['int'], ['float']]
        );
        assert.deepEqual(node.inputs, []);
    });
});

describe('NodeGraph updateFunctionPort', () => {
    it('renames a port without touching wiring', () => {
        const { graph, consumerId } = buildPortGraph(2);
        const { node } = graph.ensureFunctionStructuralNode('input');
        graph.setFunctionPorts('input', [
            { name: 'A', types: ['any'] },
            { name: 'B', types: ['any'] },
        ]);
        graph.addConnection({ fromNode: node.id, fromIndex: 1, toNode: consumerId, toIndex: 1 });

        const updated = graph.updateFunctionPort('input', 'in_1', { name: 'Renamed' });

        assert.equal(updated.name, 'Renamed');
        assert.deepEqual(inputConnections(graph), [{ fromIndex: 1, toIndex: 1 }]);
        assert.equal(graph.getFunctionStructuralNode('input').outputs[1].name, 'Renamed');
    });

    it('normalizes types and keeps any exclusive', () => {
        const graph = new NodeGraph({ id: 'graph-update-types', executionType: 'function' });
        graph.addFunctionPort('output', { name: 'Result', types: ['int'] });

        const updated = graph.updateFunctionPort('output', 'out_0', {
            types: ['int', 'any', 'int'],
        });

        assert.deepEqual(updated.types, ['any']);
    });

    it('ignores an unknown port id', () => {
        const graph = new NodeGraph({ id: 'graph-update-missing', executionType: 'function' });
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            assert.equal(graph.updateFunctionPort('input', 'in_9', { name: 'X' }), null);
        } finally {
            console.warn = originalWarn;
        }
    });
});

describe('NodeGraph removeFunctionPort', () => {
    it('removes itself and prunes exactly that connector index', () => {
        const { graph, consumerId } = buildPortGraph(3);
        const { node } = graph.ensureFunctionStructuralNode('input');
        for (let index = 0; index < 3; index += 1) {
            graph.addConnection({
                fromNode: node.id,
                fromIndex: index,
                toNode: consumerId,
                toIndex: index,
            });
        }

        const removed = graph.removeFunctionPort('input', 'in_1');

        assert.equal(removed.index, 1);
        assert.equal(removed.port.name, 'P1');
        assert.deepEqual(
            inputConnections(graph).sort((a, b) => a.fromIndex - b.fromIndex),
            [
                { fromIndex: 0, toIndex: 0 },
                { fromIndex: 1, toIndex: 2 },
            ]
        );
        assert.deepEqual(
            graph.getFunctionInputPorts().map((port) => port.name),
            ['P0', 'P2']
        );
        assert.deepEqual(
            graph.getFunctionStructuralNode('input').outputs.map((output) => output.name),
            ['P0', 'P2']
        );
    });

    it('ignores an unknown port id', () => {
        const graph = new NodeGraph({ id: 'graph-remove-missing', executionType: 'function' });
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            assert.equal(graph.removeFunctionPort('output', 'out_9'), null);
        } finally {
            console.warn = originalWarn;
        }
    });
});

describe('NodeGraph moveFunctionPort', () => {
    it('reorders the ports and keeps wiring attached to the moved connector', () => {
        const { graph, consumerId } = buildPortGraph(3);
        const { node } = graph.ensureFunctionStructuralNode('input');
        graph.addConnection({ fromNode: node.id, fromIndex: 0, toNode: consumerId, toIndex: 0 });
        graph.addConnection({ fromNode: node.id, fromIndex: 2, toNode: consumerId, toIndex: 2 });

        assert.equal(graph.moveFunctionPort('input', 0, 2), true);

        assert.deepEqual(
            graph.getFunctionInputPorts().map((port) => port.name),
            ['P1', 'P2', 'P0']
        );
        assert.deepEqual(
            inputConnections(graph).sort((a, b) => a.fromIndex - b.fromIndex),
            [
                { fromIndex: 1, toIndex: 2 },
                { fromIndex: 2, toIndex: 0 },
            ]
        );
    });

    it('rejects out-of-range or no-op moves', () => {
        const graph = new NodeGraph({ id: 'graph-move-invalid', executionType: 'function' });
        graph.addFunctionPort('input', { name: 'Only' });

        assert.equal(graph.moveFunctionPort('input', 0, 0), false);
        assert.equal(graph.moveFunctionPort('input', 0, 5), false);
        assert.equal(graph.moveFunctionPort('input', -1, 0), false);
        assert.equal(graph.moveFunctionPort('input', 0.5, 0), false);
    });
});
