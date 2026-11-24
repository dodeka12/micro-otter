// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Cross-graph sync of placed function-call nodes.
 *
 * A call node (`function_graph.<graphId>`) is a snapshot of its function graph's interface.
 * These tests cover the reconciler that rebuilds the snapshot and re-points its wiring when
 * the source signature changes, both on fake graphs (pure remap rules) and on a real
 * `Collection` with a function graph and a consumer graph.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';
import {
    buildFunctionNodeTypeId,
    normalizeFunctionSignature,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-signature.js';
import { buildFunctionConnectorDescriptors } from '../../src/micro_otter/nodes/html/js/data/graph-function-nodes.js';
import {
    FunctionCallNodeReconciler,
    buildFunctionCallConnectorPatch,
    reconcileFunctionInputDefaults,
    remapFunctionConnectorIndex,
    remapFunctionInputDefaults,
} from '../../src/micro_otter/nodes/html/js/nodes/function-consistency.js';

/**
 * Build a call node payload from a function graph's current signature.
 * @param {string} graphId - Id of the function graph.
 * @param {object} signature - Signature of that graph.
 * @param {string} id - Node id to assign.
 * @returns {object} Payload for `NodeGraph.addNode`.
 */
function callNodePayload(graphId, signature, id) {
    return {
        id,
        type: buildFunctionNodeTypeId(graphId),
        title: 'Call',
        icon: signature.icon,
        x: 0,
        y: 0,
        inputs: buildFunctionConnectorDescriptors(signature.inputs, 'input'),
        outputs: buildFunctionConnectorDescriptors(signature.outputs, 'output'),
        controlValues: {},
        inputDefaults: {},
    };
}

/**
 * Build the signature of a graph with the given ports.
 * @param {string[]} inputNames - Input port names.
 * @param {string[]} outputNames - Output port names.
 * @returns {object} Normalized signature with `any`-typed ports.
 */
function signatureOf(inputNames, outputNames = []) {
    return normalizeFunctionSignature({
        inputs: inputNames.map((name) => ({ name, types: ['any'] })),
        outputs: outputNames.map((name) => ({ name, types: ['any'] })),
    });
}

describe('remapFunctionConnectorIndex', () => {
    it('follows an explicit mapping', () => {
        const mapping = { kind: 'input', fromOldToNew: [2, 0, 1] };
        assert.equal(remapFunctionConnectorIndex(mapping, 0, 3), 2);
        assert.equal(remapFunctionConnectorIndex(mapping, 1, 3), 0);
        assert.equal(remapFunctionConnectorIndex(mapping, 2, 3), 1);
    });

    it('drops a wire whose connector was removed', () => {
        const mapping = { kind: 'input', fromOldToNew: [0, null, 1] };
        assert.equal(remapFunctionConnectorIndex(mapping, 1, 2), null);
        assert.equal(remapFunctionConnectorIndex(mapping, 2, 2), 1);
    });

    it('keeps the stored index without a mapping and drops out-of-range wires', () => {
        assert.equal(remapFunctionConnectorIndex(null, 1, 3), 1);
        assert.equal(remapFunctionConnectorIndex(null, 2, 2), null);
    });

    it('rejects invalid indices', () => {
        assert.equal(remapFunctionConnectorIndex(null, -1, 3), null);
        assert.equal(remapFunctionConnectorIndex(null, 0.5, 3), null);
        assert.equal(remapFunctionConnectorIndex(null, 5, 3), null);
    });
});

describe('remapFunctionInputDefaults', () => {
    it('moves a default value with its connector', () => {
        const mapping = { kind: 'input', fromOldToNew: [1, 0] };
        assert.deepEqual(remapFunctionInputDefaults({ in_0: 'a', in_1: 'b' }, mapping), {
            in_1: 'a',
            in_0: 'b',
        });
    });

    it('drops the value of a removed connector and keeps foreign keys', () => {
        const mapping = { kind: 'input', fromOldToNew: [0, null, 1] };
        assert.deepEqual(
            remapFunctionInputDefaults({ in_0: 'a', in_1: 'b', in_2: 'c', other: 1 }, mapping),
            { in_0: 'a', in_1: 'c', other: 1 }
        );
    });

    it('reports nothing to do for identity, output mappings and missing maps', () => {
        const identity = { kind: 'input', fromOldToNew: [0, 1] };
        assert.equal(remapFunctionInputDefaults({ in_0: 'a' }, identity), null);
        assert.equal(
            remapFunctionInputDefaults({ in_0: 'a' }, { kind: 'output', fromOldToNew: [1, 0] }),
            null
        );
        assert.equal(remapFunctionInputDefaults({ in_0: 'a' }, null), null);
        assert.equal(remapFunctionInputDefaults(null, { kind: 'input', fromOldToNew: [0] }), null);
    });
});

describe('reconcileFunctionInputDefaults', () => {
    it('clamps a stored numeric default into the new bounds', () => {
        const signature = normalizeFunctionSignature({
            inputs: [
                { name: 'A', types: ['int'], default: { type: 'int', value: 4, min: 0, max: 10 } },
            ],
        });

        assert.deepEqual(reconcileFunctionInputDefaults({ in_0: 500 }, signature), { in_0: 10 });
    });

    it('drops a stored default that cannot match the new control kind', () => {
        const signature = normalizeFunctionSignature({
            inputs: [{ name: 'A', types: ['int'] }],
        });

        assert.deepEqual(reconcileFunctionInputDefaults({ in_0: 'x' }, signature), {});
    });

    it('keeps text-control defaults and foreign keys unchanged', () => {
        const signature = normalizeFunctionSignature({
            inputs: [{ name: 'A', types: ['any'] }],
        });

        assert.equal(reconcileFunctionInputDefaults({ in_0: 7, other: 1 }, signature), null);
    });
});

describe('buildFunctionCallConnectorPatch', () => {
    it('builds both connector sides from the signature', () => {
        const signature = signatureOf(['A'], ['R']);
        const patch = buildFunctionCallConnectorPatch({ inputs: [], outputs: [] }, signature);

        assert.deepEqual(
            patch.inputs.map((entry) => entry.id),
            ['in_0']
        );
        assert.deepEqual(
            patch.outputs.map((entry) => entry.id),
            ['out_0']
        );
        assert.deepEqual(patch.inputs[0].allowedTypes, ['any']);
    });

    it('reports no patch when the node is already current', () => {
        const signature = signatureOf(['A'], ['R']);
        const node = {
            icon: signature.icon,
            inputs: buildFunctionConnectorDescriptors(signature.inputs, 'input', {
                withDefaults: true,
            }),
            outputs: buildFunctionConnectorDescriptors(signature.outputs, 'output'),
        };

        assert.deepEqual(buildFunctionCallConnectorPatch(node, signature), {});
    });

    it('ignores connector metadata the signature does not own', () => {
        const signature = signatureOf(['A']);
        const node = {
            icon: signature.icon,
            inputs: [
                {
                    ...buildFunctionConnectorDescriptors(signature.inputs, 'input', {
                        withDefaults: true,
                    })[0],
                    icon: 'x',
                },
            ],
            outputs: [],
        };

        assert.deepEqual(buildFunctionCallConnectorPatch(node, signature), {});
    });

    it('patches the default control when the signature bounds change', () => {
        const signature = normalizeFunctionSignature({
            inputs: [
                {
                    name: 'A',
                    types: ['int'],
                    default: { type: 'int', value: 4, min: 1, max: 10 },
                },
            ],
        });
        const node = {
            inputs: buildFunctionConnectorDescriptors(signature.inputs, 'input', {
                withDefaults: true,
            }),
            outputs: [],
        };
        const edited = normalizeFunctionSignature({
            inputs: [
                {
                    name: 'A',
                    types: ['int'],
                    default: { type: 'int', value: 4, min: 2, max: 10 },
                },
            ],
        });

        const patch = buildFunctionCallConnectorPatch(node, edited);

        assert.deepEqual(patch.inputs, [
            {
                id: 'in_0',
                name: 'A',
                allowedTypes: ['int'],
                defaultControl: { type: 'number', label: 'A', default: 4, min: 2, max: 10 },
            },
        ]);
    });

    it('patches a stored icon that differs from the signature', () => {
        const signature = signatureOf(['A']);
        const node = {
            icon: 'mdi:thermometer',
            inputs: buildFunctionConnectorDescriptors(signature.inputs, 'input', {
                withDefaults: true,
            }),
            outputs: [],
        };

        assert.deepEqual(buildFunctionCallConnectorPatch(node, signature), {
            icon: 'mdi:function',
        });
    });

    it('adds the default icon to a node that stores none', () => {
        const signature = signatureOf(['A']);
        const node = {
            inputs: buildFunctionConnectorDescriptors(signature.inputs, 'input', {
                withDefaults: true,
            }),
            outputs: [],
        };

        assert.deepEqual(buildFunctionCallConnectorPatch(node, signature), {
            icon: 'mdi:function',
        });
    });
});

describe('FunctionCallNodeReconciler', () => {
    /**
     * Build a fake graph that stores nodes and connections in memory.
     * @param {string} id - Graph id.
     * @param {object[]} nodes - Initial nodes.
     * @returns {object} Fake graph with its mutation log.
     */
    function fakeGraph(id, nodes) {
        const state = { nodes: nodes.map((node) => ({ ...node })), connections: [] };
        const updates = [];
        return {
            getId: () => id,
            getNodes: () => state.nodes.map((node) => ({ ...node })),
            getConnections: () => state.connections.map((connection) => ({ ...connection })),
            updateNode(nodeId, patch) {
                updates.push({ nodeId, patch });
                const node = state.nodes.find((entry) => entry.id === nodeId);
                Object.assign(node, patch);
                return node;
            },
            addConnection(connection) {
                state.connections.push({ ...connection });
                return connection;
            },
            removeConnection(fromNode, fromIndex, toNode, toIndex) {
                const before = state.connections.length;
                state.connections = state.connections.filter(
                    (connection) =>
                        !(
                            connection.fromNode === fromNode &&
                            connection.fromIndex === fromIndex &&
                            connection.toNode === toNode &&
                            connection.toIndex === toIndex
                        )
                );
                return state.connections.length !== before;
            },
            state,
            updates,
        };
    }

    it('rebuilds connectors and moves the wires of a reordered input list', () => {
        const signature = signatureOf(['A', 'B']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        graph.state.connections.push(
            { fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 },
            { fromNode: 'src', fromIndex: 1, toNode: 'call', toIndex: 1 }
        );

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: signatureOf(['B', 'A']),
            previousSignature: signature,
            indexMapping: { kind: 'input', fromOldToNew: [1, 0] },
        });

        assert.deepEqual(
            graph.state.nodes[0].inputs.map((input) => input.name),
            ['B', 'A']
        );
        assert.deepEqual(
            graph.state.connections.map((connection) => connection.toIndex),
            [1, 0]
        );
    });

    it('drops the wire of a removed input and shifts the ones after it', () => {
        const signature = signatureOf(['A', 'B', 'C']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        for (let index = 0; index < 3; index += 1) {
            graph.state.connections.push({
                fromNode: 'src',
                fromIndex: index,
                toNode: 'call',
                toIndex: index,
            });
        }

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: signatureOf(['A', 'C']),
            indexMapping: { kind: 'input', fromOldToNew: [0, null, 1] },
        });

        assert.deepEqual(
            graph.state.nodes[0].inputs.map((input) => input.name),
            ['A', 'C']
        );
        assert.deepEqual(graph.state.connections, [
            { fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 },
            { fromNode: 'src', fromIndex: 2, toNode: 'call', toIndex: 1 },
        ]);
    });

    it('adds a connector without touching existing wires', () => {
        const signature = signatureOf(['A']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        graph.state.connections.push({ fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 });

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: signatureOf(['A', 'B']),
            indexMapping: null,
        });

        assert.deepEqual(
            graph.state.nodes[0].inputs.map((input) => input.name),
            ['A', 'B']
        );
        assert.deepEqual(graph.state.connections, [
            { fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 },
        ]);
    });

    it('renames connectors without moving wires', () => {
        const signature = signatureOf(['A']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        graph.state.connections.push({ fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 });

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({ graphId: 'fn', functionSignature: signatureOf(['Renamed']) });

        assert.equal(graph.state.nodes[0].inputs[0].name, 'Renamed');
        assert.deepEqual(graph.state.connections, [
            { fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 },
        ]);
    });

    it('remaps outgoing wires when the output list is reordered', () => {
        const signature = signatureOf([], ['X', 'Y']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        graph.state.connections.push(
            { fromNode: 'call', fromIndex: 0, toNode: 'sink', toIndex: 0 },
            { fromNode: 'call', fromIndex: 1, toNode: 'sink', toIndex: 1 }
        );

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: signatureOf([], ['Y', 'X']),
            indexMapping: { kind: 'output', fromOldToNew: [1, 0] },
        });

        assert.deepEqual(
            graph.state.nodes[0].outputs.map((output) => output.name),
            ['Y', 'X']
        );
        assert.deepEqual(
            graph.state.connections.map((connection) => ({
                fromIndex: connection.fromIndex,
                toIndex: connection.toIndex,
            })),
            [
                { fromIndex: 1, toIndex: 0 },
                { fromIndex: 0, toIndex: 1 },
            ]
        );
    });

    it('moves the default value of a reordered input with its connector', () => {
        const signature = signatureOf(['A', 'B']);
        const callNode = {
            ...callNodePayload('fn', signature, 'call'),
            inputDefaults: { in_0: 7 },
        };
        const graph = fakeGraph('consumer', [callNode]);

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: signatureOf(['B', 'A']),
            indexMapping: { kind: 'input', fromOldToNew: [1, 0] },
        });

        assert.deepEqual(graph.state.nodes[0].inputDefaults, { in_1: 7 });
    });

    it('is idempotent when the same change is replayed', () => {
        const signature = signatureOf(['A', 'B']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        graph.state.connections.push({ fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 });

        const change = {
            graphId: 'fn',
            functionSignature: signatureOf(['B', 'A']),
            indexMapping: { kind: 'input', fromOldToNew: [1, 0] },
        };
        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile(change);
        reconciler.reconcile(change);

        assert.deepEqual(graph.state.connections, [
            { fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 1 },
        ]);
    });

    it('patches the icon of an icon-only change and leaves connections untouched', () => {
        const signature = signatureOf(['A']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        graph.state.connections.push({ fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 });

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: { ...signature, icon: 'mdi:thermometer' },
            indexMapping: null,
        });

        assert.equal(graph.state.nodes[0].icon, 'mdi:thermometer');
        assert.deepEqual(graph.state.connections, [
            { fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 },
        ]);
    });

    it('patches the icon and the connectors together on a combined change', () => {
        const signature = signatureOf(['A', 'B']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);
        graph.state.connections.push({ fromNode: 'src', fromIndex: 0, toNode: 'call', toIndex: 0 });

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: { ...signatureOf(['B', 'A']), icon: 'mdi:thermometer' },
            indexMapping: { kind: 'input', fromOldToNew: [1, 0] },
        });

        assert.equal(graph.state.nodes[0].icon, 'mdi:thermometer');
        assert.deepEqual(
            graph.state.nodes[0].inputs.map((input) => input.name),
            ['B', 'A']
        );
        assert.deepEqual(
            graph.state.connections.map((connection) => connection.toIndex),
            [1]
        );
    });

    it('leaves a node whose icon already matches alone', () => {
        const signature = signatureOf(['A']);
        const node = {
            ...callNodePayload('fn', signature, 'call'),
            inputs: buildFunctionConnectorDescriptors(signature.inputs, 'input', {
                withDefaults: true,
            }),
        };
        const graph = fakeGraph('consumer', [node]);

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({
            graphId: 'fn',
            functionSignature: signature,
            indexMapping: null,
        });

        assert.deepEqual(graph.updates, []);
    });

    it('leaves nodes of other function graphs alone', () => {
        const otherSignature = signatureOf(['A']);
        const graph = fakeGraph('consumer', [callNodePayload('other-fn', otherSignature, 'call')]);

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({ graphId: 'fn', functionSignature: signatureOf(['B']) });

        assert.deepEqual(
            graph.state.nodes[0].inputs.map((input) => input.name),
            ['A']
        );
        assert.deepEqual(graph.updates, []);
    });

    it('ignores changes without a graph id', () => {
        const signature = signatureOf(['A']);
        const graph = fakeGraph('consumer', [callNodePayload('fn', signature, 'call')]);

        const reconciler = new FunctionCallNodeReconciler(() => [graph]);
        reconciler.reconcile({ functionSignature: signatureOf(['B']) });

        assert.equal(graph.updates.length, 0);
    });
});

describe('Collection function-call node sync', () => {
    /**
     * Build a collection with a function graph and a consumer graph that calls it.
     *
     * The consumer holds a placed call node wired to three source outputs and to two sink
     * inputs, so every remap direction can be observed.
     * @returns {object} Collection, both graphs and the placed node ids.
     */
    function buildTwoGraphCollection() {
        const functionGraph = new NodeGraph({
            id: 'fn-graph',
            name: 'Fn',
            executionType: 'function',
        });
        functionGraph.setFunctionPorts('input', [
            { name: 'A', types: ['any'] },
            { name: 'B', types: ['any'] },
            { name: 'C', types: ['any'] },
        ]);
        functionGraph.setFunctionPorts('output', [
            { name: 'R', types: ['any'] },
            { name: 'S', types: ['any'] },
        ]);

        const consumer = new NodeGraph({ id: 'consumer-graph', name: 'Consumer' });
        const source = consumer.addNode({
            type: 'test-source',
            title: 'Source',
            outputs: [
                { id: 'o0', name: 'O0', outputType: 'any' },
                { id: 'o1', name: 'O1', outputType: 'any' },
                { id: 'o2', name: 'O2', outputType: 'any' },
            ],
        });
        const call = consumer.addNode(
            callNodePayload('fn-graph', functionGraph.getFunctionSignature(), 'call')
        );
        const sink = consumer.addNode({
            type: 'test-sink',
            title: 'Sink',
            inputs: [
                { id: 'i0', name: 'I0', allowedTypes: ['any'] },
                { id: 'i1', name: 'I1', allowedTypes: ['any'] },
            ],
        });

        for (let index = 0; index < 3; index += 1) {
            consumer.addConnection({
                fromNode: source.id,
                fromIndex: index,
                toNode: call.id,
                toIndex: index,
            });
        }
        for (let index = 0; index < 2; index += 1) {
            consumer.addConnection({
                fromNode: call.id,
                fromIndex: index,
                toNode: sink.id,
                toIndex: index,
            });
        }

        const collection = new Collection({
            id: generateUuidV4(),
            title: 'Function call sync',
            graphs: [functionGraph, consumer],
            activeGraphIdx: 0,
        });

        return {
            collection,
            functionGraph: collection.getGraphs()['fn-graph'],
            consumer: collection.getGraphs()['consumer-graph'],
            callId: call.id,
            sourceId: source.id,
            sinkId: sink.id,
        };
    }

    /**
     * Read the placed call node from the consumer graph.
     * @param {object} consumer - Consumer graph.
     * @returns {object} The call node.
     */
    function callNodeOf(consumer) {
        return consumer.getNodes().find((node) => node.type === 'function_graph.fn-graph');
    }

    /**
     * Read the incoming wires of the call node as source-index → call-index pairs.
     * @param {object} consumer - Consumer graph.
     * @param {string} callId - Id of the call node.
     * @returns {Array<{fromIndex: number, toIndex: number}>} Pairs sorted by source index.
     */
    function inputWires(consumer, callId) {
        return consumer
            .getConnections()
            .filter((connection) => connection.toNode === callId)
            .map((connection) => ({
                fromIndex: connection.fromIndex,
                toIndex: connection.toIndex,
            }))
            .sort((left, right) => left.fromIndex - right.fromIndex);
    }

    /**
     * Read the outgoing wires of the call node as call-index → sink-index pairs.
     * @param {object} consumer - Consumer graph.
     * @param {string} callId - Id of the call node.
     * @returns {Array<{fromIndex: number, toIndex: number}>} Pairs sorted by call index.
     */
    function outputWires(consumer, callId) {
        return consumer
            .getConnections()
            .filter((connection) => connection.fromNode === callId)
            .map((connection) => ({
                fromIndex: connection.fromIndex,
                toIndex: connection.toIndex,
            }))
            .sort((left, right) => left.fromIndex - right.fromIndex);
    }

    it('rebuilds the call node and follows a reordered input port', () => {
        const { functionGraph, consumer, callId } = buildTwoGraphCollection();

        assert.equal(functionGraph.moveFunctionPort('input', 0, 2), true);

        assert.deepEqual(
            callNodeOf(consumer).inputs.map((input) => input.name),
            ['B', 'C', 'A']
        );
        assert.deepEqual(inputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 2 },
            { fromIndex: 1, toIndex: 0 },
            { fromIndex: 2, toIndex: 1 },
        ]);
    });

    it('drops the wire of a removed input and shifts the survivors', () => {
        const { functionGraph, consumer, callId } = buildTwoGraphCollection();

        assert.equal(functionGraph.removeFunctionPort('input', 'in_1').port.name, 'B');

        assert.deepEqual(
            callNodeOf(consumer).inputs.map((input) => input.name),
            ['A', 'C']
        );
        assert.deepEqual(inputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 0 },
            { fromIndex: 2, toIndex: 1 },
        ]);
    });

    it('appends a new input without moving existing wires', () => {
        const { functionGraph, consumer, callId } = buildTwoGraphCollection();

        functionGraph.addFunctionPort('input', { name: 'D', types: ['any'] });

        assert.deepEqual(
            callNodeOf(consumer).inputs.map((input) => input.name),
            ['A', 'B', 'C', 'D']
        );
        assert.deepEqual(inputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 0 },
            { fromIndex: 1, toIndex: 1 },
            { fromIndex: 2, toIndex: 2 },
        ]);
    });

    it('renames a connector without moving wires', () => {
        const { functionGraph, consumer, callId } = buildTwoGraphCollection();

        functionGraph.updateFunctionPort('input', 'in_1', { name: 'Beta' });

        assert.deepEqual(
            callNodeOf(consumer).inputs.map((input) => input.name),
            ['A', 'Beta', 'C']
        );
        assert.deepEqual(inputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 0 },
            { fromIndex: 1, toIndex: 1 },
            { fromIndex: 2, toIndex: 2 },
        ]);
    });

    it('changes connector types without moving wires', () => {
        const { functionGraph, consumer, callId } = buildTwoGraphCollection();

        functionGraph.updateFunctionPort('input', 'in_0', { types: ['float'] });

        assert.deepEqual(callNodeOf(consumer).inputs[0].allowedTypes, ['float']);
        assert.deepEqual(inputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 0 },
            { fromIndex: 1, toIndex: 1 },
            { fromIndex: 2, toIndex: 2 },
        ]);
    });

    it('follows a reordered output port', () => {
        const { functionGraph, consumer, callId } = buildTwoGraphCollection();

        assert.equal(functionGraph.moveFunctionPort('output', 0, 1), true);

        assert.deepEqual(
            callNodeOf(consumer).outputs.map((output) => output.name),
            ['S', 'R']
        );
        assert.deepEqual(outputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 1 },
            { fromIndex: 1, toIndex: 0 },
        ]);
    });

    it('leaves the call node untouched on a category-only edit', () => {
        const { functionGraph, consumer, callId } = buildTwoGraphCollection();

        functionGraph.setFunctionCategory('math');

        assert.deepEqual(
            callNodeOf(consumer).inputs.map((input) => input.name),
            ['A', 'B', 'C']
        );
        assert.deepEqual(inputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 0 },
            { fromIndex: 1, toIndex: 1 },
            { fromIndex: 2, toIndex: 2 },
        ]);
        assert.deepEqual(outputWires(consumer, callId), [
            { fromIndex: 0, toIndex: 0 },
            { fromIndex: 1, toIndex: 1 },
        ]);
    });

    it('syncs the icon of a placed call node on an icon edit', () => {
        const { functionGraph, consumer } = buildTwoGraphCollection();

        functionGraph.setFunctionIcon('mdi:thermometer');

        assert.equal(callNodeOf(consumer).icon, 'mdi:thermometer');
    });

    it('syncs a call node placed inside the function graph itself', () => {
        const { functionGraph } = buildTwoGraphCollection();
        const selfCall = functionGraph.addNode(
            callNodePayload('fn-graph', functionGraph.getFunctionSignature(), 'self-call')
        );
        const source = functionGraph.addNode({
            type: 'test-source',
            title: 'Source',
            outputs: [{ id: 'o0', name: 'O0', outputType: 'any' }],
        });
        functionGraph.addConnection({
            fromNode: source.id,
            fromIndex: 0,
            toNode: selfCall.id,
            toIndex: 0,
        });

        functionGraph.moveFunctionPort('input', 0, 2);

        const node = functionGraph.getNodes().find((entry) => entry.id === selfCall.id);
        assert.deepEqual(
            node.inputs.map((input) => input.name),
            ['B', 'C', 'A']
        );
        assert.equal(
            functionGraph.getConnections().find((connection) => connection.toNode === selfCall.id)
                .toIndex,
            2
        );
    });
});
