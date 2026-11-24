import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

const definitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const coreDefinitions = JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;

/**
 * Read the shipped core definition for one node type.
 * @param {string} typeId - Node type id such as `select-index`.
 * @returns {object} The definition object from `node_definitions.json`.
 */
function definitionOf(typeId) {
    const definition = coreDefinitions[typeId];
    assert.ok(definition, `missing core definition for '${typeId}'`);
    return definition;
}

/**
 * Add a core node built from its shipped definition.
 * @param {NodeGraph} graph - Graph receiving the node.
 * @param {string} typeId - Node type id such as `select-index`.
 * @param {string} id - Instance id.
 * @param {object} [controlValues] - Optional dropdown selection overrides.
 * @returns {object} The added node.
 */
function addCoreNode(graph, typeId, id, controlValues) {
    const definition = definitionOf(typeId);
    return graph.addNode({
        ...definition,
        id,
        type: `core.${typeId}`,
        controlValues: controlValues ? { ...controlValues } : {},
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
 * Connect a source output to the connector with the given id.
 * @param {NodeGraph} graph - Graph receiving the connection.
 * @param {object} source - Source node.
 * @param {object} target - Target node.
 * @param {string} inputId - Target input id.
 * @returns {number} The target input index that was used.
 */
function connectToInputId(graph, source, target, inputId) {
    const inputIndex = target.inputs.findIndex((input) => input.id === inputId);
    assert.ok(inputIndex >= 0, `missing input '${inputId}' on '${target.id}'`);
    graph.addConnection({
        fromNode: source.id,
        fromIndex: 0,
        toNode: target.id,
        toIndex: inputIndex,
    });
    return inputIndex;
}

describe('NodeGraph union typing with static sources', () => {
    it('keeps the select union independent of any dropdown', () => {
        const graph = new NodeGraph({ id: 'graph-static-union' });
        const select = addCoreNode(graph, 'select', 'select');
        const boolSource = addSource(graph, 'bool-source', 'bool');
        const stringSource = addSource(graph, 'string-source', 'string');

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['any']);

        connectToInputId(graph, boolSource, select, 'trueValue');
        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['bool']);

        connectToInputId(graph, stringSource, select, 'falseValue');
        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['bool', 'string']);
    });
});

describe('NodeGraph union typing with active inputs', () => {
    it('unions only the values inside the active count', () => {
        const graph = new NodeGraph({ id: 'graph-active-union' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 3 });
        const floatSource = addSource(graph, 'float-source', 'float');
        const stringSource = addSource(graph, 'string-source', 'string');

        connectToInputId(graph, floatSource, mux, 'value_1');
        connectToInputId(graph, stringSource, mux, 'value_3');

        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['float', 'string']);
    });

    it('drops values that fall outside a lowered count', () => {
        const graph = new NodeGraph({ id: 'graph-active-union-lower' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 3 });
        const floatSource = addSource(graph, 'float-source', 'float');
        const stringSource = addSource(graph, 'string-source', 'string');

        connectToInputId(graph, floatSource, mux, 'value_1');
        connectToInputId(graph, stringSource, mux, 'value_3');
        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['float', 'string']);

        graph.updateNode(mux.id, { controlValues: { count: 2 } });
        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['float']);
    });

    it('restores a hidden value when the count grows again', () => {
        const graph = new NodeGraph({ id: 'graph-active-union-raise' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 2 });
        const floatSource = addSource(graph, 'float-source', 'float');
        const stringSource = addSource(graph, 'string-source', 'string');

        connectToInputId(graph, floatSource, mux, 'value_1');
        const hiddenInputIndex = connectToInputId(graph, stringSource, mux, 'value_3');
        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['float']);

        graph.updateNode(mux.id, { controlValues: { count: 3 } });
        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['float', 'string']);

        const stillHiddenAtSameIndex = mux.inputs.findIndex((input) => input.id === 'value_3');
        assert.equal(stillHiddenAtSameIndex, hiddenInputIndex);
    });

    it('ignores a wired value that the active count hides', () => {
        const graph = new NodeGraph({ id: 'graph-active-union-hidden' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 2 });
        const stringSource = addSource(graph, 'string-source', 'string');

        connectToInputId(graph, stringSource, mux, 'value_3');

        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['any']);
    });

    it('ignores a wired value whose dropdown hides it when it is the only connection', () => {
        const graph = new NodeGraph({ id: 'graph-active-union-hidden-only' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 4 });
        const tupleSource = addSource(graph, 'tuple-source', 'core.tuple');

        connectToInputId(graph, tupleSource, mux, 'value_4');
        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['core.tuple']);

        graph.updateNode(mux.id, { controlValues: { count: 3 } });
        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0), ['any']);
    });
});

describe('NodeGraph union connection policy with active inputs', () => {
    it('rejects a target that cannot accept every active candidate', () => {
        const graph = new NodeGraph({ id: 'graph-active-reject' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 3 });
        const floatSource = addSource(graph, 'float-source', 'float');
        const stringSource = addSource(graph, 'string-source', 'string');
        const floatSink = addSink(graph, 'float-sink', ['float']);
        const stringSink = addSink(graph, 'string-sink', ['string']);

        connectToInputId(graph, floatSource, mux, 'value_1');
        connectToInputId(graph, stringSource, mux, 'value_3');

        [floatSink, stringSink].forEach((sink) => {
            const validation = graph.canConnect(mux.id, 0, sink.id, 0);
            assert.equal(validation.valid, false);
            assert.match(validation.message, /Type mismatch: Cannot connect union/);
            assert.match(validation.message, /'float \| string'/);
        });
    });

    it('admits a single-candidate target once the other candidate is hidden', () => {
        const graph = new NodeGraph({ id: 'graph-active-narrow' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 3 });
        const floatSource = addSource(graph, 'float-source', 'float');
        const stringSource = addSource(graph, 'string-source', 'string');
        const floatSink = addSink(graph, 'float-sink', ['float']);
        const stringSink = addSink(graph, 'string-sink', ['string']);

        connectToInputId(graph, floatSource, mux, 'value_1');
        connectToInputId(graph, stringSource, mux, 'value_3');
        graph.updateNode(mux.id, { controlValues: { count: 2 } });

        assert.equal(graph.canConnect(mux.id, 0, floatSink.id, 0).valid, true);
        assert.equal(graph.canConnect(mux.id, 0, stringSink.id, 0).valid, false);
    });

    it('drops an existing target connection when a raised count widens the union', () => {
        const graph = new NodeGraph({ id: 'graph-active-prune' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 2 });
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
        assert.equal(graph.getConnections().length, 3);

        graph.updateNode(mux.id, { controlValues: { count: 3 } });

        assert.equal(
            graph.getConnections().filter((conn) => conn.toNode === floatSink.id).length,
            0
        );
        assert.equal(graph.canConnect(mux.id, 0, floatSink.id, 0).valid, false);

        graph.updateNode(mux.id, { controlValues: { count: 2 } });
        assert.equal(graph.canConnect(mux.id, 0, floatSink.id, 0).valid, true);
    });

    it('stops at an already-visited union instead of recursing forever', () => {
        const graph = new NodeGraph({ id: 'graph-active-cycle' });
        const mux = addCoreNode(graph, 'select-index', 'mux', { count: 2 });
        const floatSource = addSource(graph, 'float-source', 'float');
        connectToInputId(graph, floatSource, mux, 'value_1');

        // Graph cycles are rejected on connect, so the guard is exercised directly by
        // seeding the path a re-entrant resolution would carry.
        assert.deepEqual(graph.getResolvedOutputTypes(mux.id, 0, new Set([`${mux.id}|0`])), [
            'any',
        ]);
    });
});
