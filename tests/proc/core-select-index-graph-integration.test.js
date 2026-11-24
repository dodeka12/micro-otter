import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { resolveUnionOutputType } from '../../src/micro_otter/nodes/html/js/data/type-conversions.js';

const definitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const coreDefinitions = JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;

/**
 * Read the shipped `core.select-index` definition.
 * @returns {object} The definition object from `node_definitions.json`.
 */
function selectIndexDefinition() {
    const definition = coreDefinitions['select-index'];
    assert.ok(definition, "missing core definition for 'select-index'");
    return definition;
}

/**
 * Add the shipped select-index node with one selected `count`.
 * @param {NodeGraph} graph - Graph receiving the node.
 * @param {string} id - Instance id.
 * @param {number} count - Active value count from the dropdown.
 * @returns {object} The added node.
 */
function addMux(graph, id, count) {
    return graph.addNode({
        ...selectIndexDefinition(),
        id,
        type: 'core.select-index',
        controlValues: { count },
    });
}

/**
 * Add a single-output source node with a fixed output type.
 * @param {NodeGraph} graph - Graph receiving the node.
 * @param {string} id - Instance id.
 * @param {string} outputType - Declared output type.
 * @returns {object} The added node.
 */
function addSource(graph, id, outputType) {
    return graph.addNode({
        id,
        type: 'source',
        outputs: [{ id: 'out0', outputType }],
    });
}

/**
 * Add a single-input sink node accepting a fixed set of types.
 * @param {NodeGraph} graph - Graph receiving the node.
 * @param {string} id - Instance id.
 * @param {string[]} allowedTypes - Types the sink input accepts.
 * @returns {object} The added node.
 */
function addSink(graph, id, allowedTypes) {
    return graph.addNode({
        id,
        type: 'target',
        inputs: [{ id: 'in0', allowedTypes }],
    });
}

/**
 * Resolve the connector index of one input id on a node.
 * @param {object} node - Node owning the input.
 * @param {string} inputId - Input id such as `value_3`.
 * @returns {number} Zero-based input index.
 */
function inputIndexOf(node, inputId) {
    const index = node.inputs.findIndex((input) => input.id === inputId);
    assert.ok(index >= 0, `missing input '${inputId}' on '${node.id}'`);
    return index;
}

/**
 * Connect a source output to a named mux input.
 * @param {NodeGraph} graph - Graph receiving the connection.
 * @param {object} source - Source node.
 * @param {object} mux - Mux node.
 * @param {string} inputId - Mux input id.
 * @returns {number} The mux input index that was used.
 */
function connectToInputId(graph, source, mux, inputId) {
    const toIndex = inputIndexOf(mux, inputId);
    graph.addConnection({
        fromNode: source.id,
        fromIndex: 0,
        toNode: mux.id,
        toIndex,
    });
    return toIndex;
}

describe('core.select-index graph integration', () => {
    it('builds nine connectors in definition order', () => {
        const graph = new NodeGraph({ id: 'graph-mux-shape' });
        const mux = addMux(graph, 'mux', 2);

        assert.deepEqual(
            mux.inputs.map((input) => input.id),
            [
                'index',
                'value_1',
                'value_2',
                'value_3',
                'value_4',
                'value_5',
                'value_6',
                'value_7',
                'value_8',
            ]
        );
        assert.deepEqual(mux.inputs[0].allowedTypes, ['int', 'float']);
        mux.inputs.slice(1).forEach((input) => {
            assert.deepEqual(input.allowedTypes, ['any']);
        });
        assert.deepEqual(mux.controlValues, { count: 2 });
    });

    it('accepts scalar and tuple producers on every value connector', () => {
        const graph = new NodeGraph({ id: 'graph-mux-accept-values' });
        const mux = addMux(graph, 'mux', 8);
        const types = ['int', 'float', 'string', 'bool', 'core.tuple', 'int', 'float', 'string'];

        types.forEach((outputType, offset) => {
            const inputId = `value_${offset + 1}`;
            const source = addSource(graph, `source-${offset + 1}`, outputType);
            const validation = graph.canConnect(source.id, 0, mux.id, inputIndexOf(mux, inputId));
            assert.equal(validation.valid, true, `${outputType} must connect to ${inputId}`);

            connectToInputId(graph, source, mux, inputId);
            const wired = graph.getConnections().filter((connection) => connection.toNode === mux.id);
            assert.equal(wired.length, offset + 1);
        });

        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), [
            'int',
            'float',
            'string',
            'bool',
            'core.tuple',
        ]);
    });


    it('accepts int and float indices and rejects a string index', () => {
        const graph = new NodeGraph({ id: 'graph-mux-index-types' });
        const mux = addMux(graph, 'mux', 2);
        const intSource = addSource(graph, 'int-source', 'int');
        const floatSource = addSource(graph, 'float-source', 'float');
        const stringSource = addSource(graph, 'string-source', 'string');

        assert.equal(graph.canConnect(intSource.id, 0, mux.id, 0).valid, true);
        assert.equal(graph.canConnect(floatSource.id, 0, mux.id, 0).valid, true);

        const validation = graph.canConnect(stringSource.id, 0, mux.id, 0);
        assert.equal(validation.valid, false);
        assert.equal(
            validation.message,
            "Type mismatch: Cannot connect 'string' to input accepting [int, float]"
        );
    });

    it('widens the union and prunes targets when the count grows', () => {
        const graph = new NodeGraph({ id: 'graph-mux-widen' });
        const mux = addMux(graph, 'mux', 2);
        const floatSource = addSource(graph, 'float-source', 'float');
        const stringSource = addSource(graph, 'string-source', 'string');
        const floatSink = addSink(graph, 'float-sink', ['float']);

        connectToInputId(graph, floatSource, mux, 'value_1');
        connectToInputId(graph, stringSource, mux, 'value_3');
        graph.addConnection({
            fromNode: mux.id,
            fromIndex: 0,
            toNode: floatSink.id,
            toIndex: 0,
        });
        assert.equal(
            graph.getConnections().filter(
                (connection) => connection.fromNode === mux.id && connection.toNode === floatSink.id
            ).length,
            1
        );

        graph.updateNode(mux.id, { controlValues: { count: 3 } });

        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['float', 'string']);
        assert.equal(
            graph.getConnections().filter((connection) => connection.toNode === floatSink.id)
                .length,
            0
        );
        assert.equal(graph.canConnect(mux.id, 0, floatSink.id, 0).valid, false);

        graph.updateNode(mux.id, { controlValues: { count: 2 } });

        assert.equal(graph.canConnect(mux.id, 0, floatSink.id, 0).valid, true);
    });

    it('does not type the output from a value the count hides', () => {
        const graph = new NodeGraph({ id: 'graph-mux-hidden' });
        const mux = addMux(graph, 'mux', 2);
        const tupleSource = addSource(graph, 'tuple-source', 'core.tuple');

        connectToInputId(graph, tupleSource, mux, 'value_5');

        const resolved = graph.getResolvedOutputTypes(mux.id, 0);
        assert.deepEqual(resolved, ['any']);
        assert.equal(resolveUnionOutputType(resolved), 'any');
        assert.notEqual(resolveUnionOutputType(resolved), 'core.tuple');
    });
});
