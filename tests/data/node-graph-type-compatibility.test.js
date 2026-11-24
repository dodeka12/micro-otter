import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    resolveUnionOutputType,
} from '../../src/micro_otter/nodes/html/js/data/type-conversions.js';

/** The shipped core constant node definition. */
const CONSTANT_DEFINITION = JSON.parse(
    readFileSync(
        path.resolve('src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'),
        'utf8'
    )
).nodeTypes.const;

/**
 * Add a constant node built from the shipped definition.
 * @param {NodeGraph} graph - Target graph.
 * @param {object} controlValues - Stored control values.
 * @param {string} [id] - Node id.
 * @returns {object} The added node data.
 */
function addConstantNode(graph, controlValues, id = 'constant') {
    return graph.addNode({
        id,
        type: 'const',
        inputs: CONSTANT_DEFINITION.inputs.map((input) => ({ ...input })),
        outputs: CONSTANT_DEFINITION.outputs.map((output) => ({ ...output })),
        controls: CONSTANT_DEFINITION.controls.map((control) => ({ ...control })),
        controlValues,
    });
}

function createGraphForCompatibility(outputType, allowedTypes) {
    const graph = new NodeGraph({ id: 'graph-compat' });
    const source = graph.addNode({
        id: 'source',
        type: 'source',
        outputs: [{ id: 'out0', outputType }],
    });
    const target = graph.addNode({
        id: 'target',
        type: 'target',
        inputs: [{ id: 'in0', allowedTypes }],
    });

    return { graph, source, target };
}

describe('NodeGraph type compatibility', () => {
    it('allows int output to float input', () => {
        const { graph, source, target } = createGraphForCompatibility('int', ['float']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('rejects float output to int input', () => {
        const { graph, source, target } = createGraphForCompatibility('float', ['int']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, false);
        assert.match(validation.message, /Type mismatch/);
    });

    it('allows bool output to int input via implicit conversion', () => {
        const { graph, source, target } = createGraphForCompatibility('bool', ['int']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('allows bool output to float input via implicit conversion', () => {
        const { graph, source, target } = createGraphForCompatibility('bool', ['float']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('allows bool output to double input via implicit conversion', () => {
        const { graph, source, target } = createGraphForCompatibility('bool', ['double']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('rejects non-canonical type names with an explicit error', () => {
        const { graph, source, target } = createGraphForCompatibility('number', ['float']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, false);
        assert.match(validation.message, /Invalid type configuration/i);
    });

    it('accepts namespaced custom type ids in generic compatibility checks', () => {
        const { graph, source, target } = createGraphForCompatibility('web.element', [
            'web.element',
        ]);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('accepts namespaced custom type ids with underscores and dashes', () => {
        const { graph, source, target } = createGraphForCompatibility('web-view.element_ref', [
            'web-view.element_ref',
        ]);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('rejects legacy object-prefixed custom type ids', () => {
        const { graph, source, target } = createGraphForCompatibility('object:web.element', [
            'object:web.element',
        ]);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, false);
        assert.match(validation.message, /Invalid type configuration/i);
    });

    it('allows any input to accept typed output', () => {
        const { graph, source, target } = createGraphForCompatibility('bool', ['any']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('allows any output to connect to typed input', () => {
        const { graph, source, target } = createGraphForCompatibility('any', ['string']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('rejects structure output when target accepts wildcard any', () => {
        const { graph, source, target } = createGraphForCompatibility('web.element', ['any']);
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return { kind: 'structure' };
            }
            return { kind: 'value' };
        });

        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, false);
        assert.match(validation.message, /Type mismatch/);
    });

    it('rejects wildcard any output when input type is structure-kind', () => {
        const { graph, source, target } = createGraphForCompatibility('any', ['web.element']);
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return { kind: 'structure' };
            }
            return { kind: 'value' };
        });

        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, false);
        assert.match(validation.message, /Type mismatch/);
    });

    it('keeps explicit structure type matches valid regardless of kind', () => {
        const { graph, source, target } = createGraphForCompatibility('web.element', [
            'web.element',
        ]);
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return { kind: 'structure' };
            }
            return { kind: 'value' };
        });

        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, true);
    });

    it('rejects connection that would create a cycle', () => {
        const graph = new NodeGraph({ id: 'graph-cycle' });
        const nodeA = graph.addNode({
            id: 'A',
            type: 'nodeA',
            inputs: [{ id: 'in0', allowedTypes: ['any'] }],
            outputs: [{ id: 'out0', outputType: 'any' }],
        });
        const nodeB = graph.addNode({
            id: 'B',
            type: 'nodeB',
            inputs: [{ id: 'in0', allowedTypes: ['any'] }],
            outputs: [{ id: 'out0', outputType: 'any' }],
        });
        const nodeC = graph.addNode({
            id: 'C',
            type: 'nodeC',
            inputs: [{ id: 'in0', allowedTypes: ['any'] }],
            outputs: [{ id: 'out0', outputType: 'any' }],
        });

        graph.addConnection({ fromNode: nodeA.id, fromIndex: 0, toNode: nodeB.id, toIndex: 0 });
        graph.addConnection({ fromNode: nodeB.id, fromIndex: 0, toNode: nodeC.id, toIndex: 0 });

        const validation = graph.canConnect(nodeC.id, 0, nodeA.id, 0);
        assert.equal(validation.valid, false);
        assert.match(validation.message, /cycle|recursive/i);
    });

    it('disallows duplicate identical edges globally', () => {
        const graph = new NodeGraph({ id: 'graph-duplicate-edge' });
        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'any' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['any'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const validation = graph.canConnect(source.id, 0, target.id, 0);
        assert.equal(validation.valid, false);
        assert.equal(validation.message, 'Duplicate connection is not allowed');
    });

    it('allows revalidation of an existing edge when allowExistingConnectionMatch is true', () => {
        const graph = new NodeGraph({ id: 'graph-duplicate-edge-revalidation' });
        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'any' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['any'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const validation = graph.canConnect(source.id, 0, target.id, 0, {
            allowExistingConnectionMatch: true,
        });
        assert.equal(validation.valid, true);
    });

    it('rejects new connection when output maxConnections limit is reached', () => {
        const graph = new NodeGraph({ id: 'graph-output-limit' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        output: { maxConnections: 1 },
                    },
                };
            }
            return null;
        });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const targetA = graph.addNode({
            id: 'targetA',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });
        const targetB = graph.addNode({
            id: 'targetB',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: targetA.id, toIndex: 0 });

        const validation = graph.canConnect(source.id, 0, targetB.id, 0);
        assert.equal(validation.valid, false);
        assert.equal(
            validation.message,
            "Output connection limit exceeded for type 'web.element': maxConnections=1, currentConnections=1"
        );
    });

    it('allows additional connections when output maxConnections is set to 0', () => {
        const graph = new NodeGraph({ id: 'graph-output-unbounded' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        output: { maxConnections: 0 },
                    },
                };
            }
            return null;
        });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const targetA = graph.addNode({
            id: 'targetA',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });
        const targetB = graph.addNode({
            id: 'targetB',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: targetA.id, toIndex: 0 });

        const validation = graph.canConnect(source.id, 0, targetB.id, 0);
        assert.equal(validation.valid, true);
    });

    it('enforces fixed output maxConnections when set to 2', () => {
        const graph = new NodeGraph({ id: 'graph-output-limit-two' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        output: { maxConnections: 2 },
                    },
                };
            }
            return null;
        });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const targetA = graph.addNode({
            id: 'targetA',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });
        const targetB = graph.addNode({
            id: 'targetB',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });
        const targetC = graph.addNode({
            id: 'targetC',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: targetA.id, toIndex: 0 });

        const secondValidation = graph.canConnect(source.id, 0, targetB.id, 0);
        assert.equal(secondValidation.valid, true);

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: targetB.id, toIndex: 0 });

        const thirdValidation = graph.canConnect(source.id, 0, targetC.id, 0);
        assert.equal(thirdValidation.valid, false);
        assert.equal(
            thirdValidation.message,
            "Output connection limit exceeded for type 'web.element': maxConnections=2, currentConnections=2"
        );
    });

    it('rejects new connection when input maxConnections limit is reached', () => {
        const graph = new NodeGraph({ id: 'graph-input-limit' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        input: { maxConnections: 1 },
                    },
                };
            }
            return null;
        });

        const sourceA = graph.addNode({
            id: 'sourceA',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceB = graph.addNode({
            id: 'sourceB',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: sourceA.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const validation = graph.canConnect(sourceB.id, 0, target.id, 0);
        assert.equal(validation.valid, false);
        assert.equal(
            validation.message,
            "Input connection limit exceeded for type 'web.element': maxConnections=1, currentConnections=1"
        );
    });

    it('allows additional connections when input maxConnections is greater than one', () => {
        const graph = new NodeGraph({ id: 'graph-input-limit-two' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        input: { maxConnections: 2 },
                    },
                };
            }
            return null;
        });

        const sourceA = graph.addNode({
            id: 'sourceA',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceB = graph.addNode({
            id: 'sourceB',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceC = graph.addNode({
            id: 'sourceC',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: sourceA.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const secondValidation = graph.canConnect(sourceB.id, 0, target.id, 0);
        assert.equal(secondValidation.valid, true);

        graph.addConnection({ fromNode: sourceB.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const thirdValidation = graph.canConnect(sourceC.id, 0, target.id, 0);
        assert.equal(thirdValidation.valid, false);
        assert.equal(
            thirdValidation.message,
            "Input connection limit exceeded for type 'web.element': maxConnections=2, currentConnections=2"
        );
    });

    it('enforces fixed input maxConnections when set to 4', () => {
        const graph = new NodeGraph({ id: 'graph-input-limit-four' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        input: { maxConnections: 4 },
                    },
                };
            }
            return null;
        });

        const sourceA = graph.addNode({
            id: 'sourceA',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceB = graph.addNode({
            id: 'sourceB',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceC = graph.addNode({
            id: 'sourceC',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceD = graph.addNode({
            id: 'sourceD',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceE = graph.addNode({
            id: 'sourceE',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: sourceA.id, fromIndex: 0, toNode: target.id, toIndex: 0 });
        graph.addConnection({ fromNode: sourceB.id, fromIndex: 0, toNode: target.id, toIndex: 0 });
        graph.addConnection({ fromNode: sourceC.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const fourthValidation = graph.canConnect(sourceD.id, 0, target.id, 0);
        assert.equal(fourthValidation.valid, true);

        graph.addConnection({ fromNode: sourceD.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const fifthValidation = graph.canConnect(sourceE.id, 0, target.id, 0);
        assert.equal(fifthValidation.valid, false);
        assert.equal(
            fifthValidation.message,
            "Input connection limit exceeded for type 'web.element': maxConnections=4, currentConnections=4"
        );
    });

    it('replaces oldest outgoing connection on user action when output maxConnections is reached', () => {
        const graph = new NodeGraph({ id: 'graph-user-action-output-prune' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        output: { maxConnections: 1 },
                    },
                };
            }
            return null;
        });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const targetA = graph.addNode({
            id: 'targetA',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });
        const targetB = graph.addNode({
            id: 'targetB',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: targetA.id, toIndex: 0 });

        graph.addConnectionFromUserAction({
            fromNode: source.id,
            fromIndex: 0,
            toNode: targetB.id,
            toIndex: 0,
        });

        assert.deepEqual(graph.getConnections(), [
            { fromNode: source.id, fromIndex: 0, toNode: targetB.id, toIndex: 0 },
        ]);
    });

    it('replaces oldest incoming connection on user action when input maxConnections is reached', () => {
        const graph = new NodeGraph({ id: 'graph-user-action-input-prune' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return {
                    connectionPolicy: {
                        input: { maxConnections: 1 },
                    },
                };
            }
            return null;
        });

        const sourceA = graph.addNode({
            id: 'sourceA',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceB = graph.addNode({
            id: 'sourceB',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            id: 'target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: sourceA.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        graph.addConnectionFromUserAction({
            fromNode: sourceB.id,
            fromIndex: 0,
            toNode: target.id,
            toIndex: 0,
        });

        assert.deepEqual(graph.getConnections(), [
            { fromNode: sourceB.id, fromIndex: 0, toNode: target.id, toIndex: 0 },
        ]);
    });

    it('applies dropdown outputTypes mapping and prunes incompatible outgoing connections', () => {
        const graph = new NodeGraph({ id: 'graph-dropdown-output-types' });

        const source = graph.addNode({
            id: 'source',
            type: 'typed-source',
            controls: [
                {
                    id: 'valueType',
                    type: 'dropdown',
                    default: 'float',
                    options: [
                        {
                            value: 'float',
                            outputTypes: { out0: ['float'] },
                        },
                        {
                            value: 'string',
                            outputTypes: { out0: ['string'] },
                        },
                    ],
                },
            ],
            controlValues: { valueType: 'float' },
            outputs: [{ id: 'out0', outputType: 'float', initialTypes: ['float'] }],
        });

        const sinkFloat = graph.addNode({
            id: 'sinkFloat',
            type: 'sink-float',
            inputs: [{ id: 'in0', allowedTypes: ['float'] }],
        });

        graph.addConnection({
            fromNode: source.id,
            fromIndex: 0,
            toNode: sinkFloat.id,
            toIndex: 0,
        });
        assert.equal(graph.getConnections().length, 1);

        graph.updateNode(source.id, {
            controlValues: { valueType: 'string' },
        });

        const updatedSource = graph.getNode(source.id);
        assert.equal(updatedSource.getOutputType('out0'), 'string');
        assert.equal(graph.getConnections().length, 0);
    });

    it('applies dropdown inputTypes mapping and prunes incompatible incoming connections', () => {
        const graph = new NodeGraph({ id: 'graph-dropdown-input-types' });

        const source = graph.addNode({
            id: 'source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'float' }],
        });

        const target = graph.addNode({
            id: 'target',
            type: 'typed-target',
            controls: [
                {
                    id: 'mode',
                    type: 'dropdown',
                    default: 'numeric',
                    options: [
                        {
                            value: 'numeric',
                            inputTypes: { in0: ['float'] },
                        },
                        {
                            value: 'boolean',
                            inputTypes: { in0: ['bool'] },
                        },
                    ],
                },
            ],
            controlValues: { mode: 'numeric' },
            inputs: [{ id: 'in0', allowedTypes: ['float'], initialTypes: ['float'] }],
        });

        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: target.id, toIndex: 0 });
        assert.equal(graph.getConnections().length, 1);

        graph.updateNode(target.id, {
            controlValues: { mode: 'boolean' },
        });

        const updatedTarget = graph.getNode(target.id);
        assert.deepEqual(updatedTarget.getInputAllowedTypes('in0'), ['bool']);
        assert.equal(graph.getConnections().length, 0);
    });

    it('resets connector types from initialTypes before applying option overrides', () => {
        const graph = new NodeGraph({ id: 'graph-initial-types-reset' });

        const typedNode = graph.addNode({
            id: 'typedNode',
            type: 'typed-node',
            controls: [
                {
                    id: 'mode',
                    type: 'dropdown',
                    default: 'string-mode',
                    options: [
                        {
                            value: 'string-mode',
                            inputTypes: { in0: ['string'] },
                            outputTypes: { out0: ['string'] },
                        },
                    ],
                },
            ],
            controlValues: { mode: 'string-mode' },
            inputs: [{ id: 'in0', allowedTypes: ['bool'], initialTypes: ['float'] }],
            outputs: [{ id: 'out0', outputType: 'bool', initialTypes: ['float'] }],
        });

        assert.deepEqual(typedNode.getInputAllowedTypes('in0'), ['string']);
        assert.equal(typedNode.getOutputType('out0'), 'string');

        graph.updateNode(typedNode.id, {
            controls: [],
            controlValues: {},
        });

        assert.deepEqual(typedNode.getInputAllowedTypes('in0'), ['float']);
        assert.equal(typedNode.getOutputType('out0'), 'float');
    });

    it('ignores the option mapping of a dropdown the mode control hides', () => {
        const graph = new NodeGraph({ id: 'graph-hidden-dropdown-types' });
        const source = addConstantNode(graph, {
            valueMode: 'special',
            valueType: 'bool',
            boolValue: true,
            specialValue: 'pi',
        });

        assert.deepEqual(
            source.getOutputType('out0'),
            'float',
            'the hidden valueType mapping must not force a bool output'
        );
    });

    it('applies the mapping of a dropdown the mode control reveals', () => {
        const graph = new NodeGraph({ id: 'graph-revealed-dropdown-types' });
        const source = addConstantNode(graph, {
            valueMode: 'custom',
            valueType: 'int',
            intValue: 3,
            specialValue: 'pi',
        });
        const sinkInt = graph.addNode({
            id: 'sinkInt',
            type: 'sink-int',
            inputs: [{ id: 'in0', allowedTypes: ['int'] }],
        });

        assert.equal(source.getOutputType('out0'), 'int');
        assert.equal(graph.canConnect(source.id, 0, sinkInt.id, 0).valid, true);
        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: sinkInt.id, toIndex: 0 });
        assert.equal(graph.getConnections().length, 1);

        graph.updateNode(source.id, {
            controlValues: { ...source.controlValues, valueMode: 'special' },
        });

        assert.equal(graph.getNode(source.id).getOutputType('out0'), 'float');
        assert.equal(graph.getConnections().length, 0);

        graph.updateNode(source.id, {
            controlValues: { ...source.controlValues, valueMode: 'custom' },
        });

        assert.equal(graph.getNode(source.id).getOutputType('out0'), 'int');
        assert.equal(graph.canConnect(source.id, 0, sinkInt.id, 0).valid, true);
    });
});

describe('NodeGraph canConnect excludeConnections', () => {
    it('ignores an excluded edge for input maxConnections', () => {
        const graph = new NodeGraph({ id: 'graph-exclude-input' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return { connectionPolicy: { input: { maxConnections: 1 } } };
            }
            return null;
        });

        const sourceA = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceB = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        const occupying = graph.addConnection({
            fromNode: sourceA.id,
            fromIndex: 0,
            toNode: target.id,
            toIndex: 0,
        });

        const rejected = graph.canConnect(sourceB.id, 0, target.id, 0);
        assert.equal(rejected.valid, false);
        assert.match(rejected.message, /Input connection limit exceeded/);

        const allowed = graph.canConnect(sourceB.id, 0, target.id, 0, {
            excludeConnections: [occupying],
        });
        assert.equal(allowed.valid, true);
    });

    it('ignores an excluded duplicate edge', () => {
        const graph = new NodeGraph({ id: 'graph-exclude-duplicate' });
        const source = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        const existing = graph.addConnection({
            fromNode: source.id,
            fromIndex: 0,
            toNode: target.id,
            toIndex: 0,
        });

        assert.equal(graph.canConnect(source.id, 0, target.id, 0).valid, false);
        assert.equal(
            graph.canConnect(source.id, 0, target.id, 0, { excludeConnections: [existing] }).valid,
            true
        );
    });

    it('still enforces limits for non-excluded edges', () => {
        const graph = new NodeGraph({ id: 'graph-exclude-non-excluded' });
        graph.setDataTypeDefinitionLookup((typeId) => {
            if (typeId === 'web.element') {
                return { connectionPolicy: { input: { maxConnections: 1 } } };
            }
            return null;
        });

        const sourceA = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const sourceB = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'web.element' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['web.element'] }],
        });

        graph.addConnection({ fromNode: sourceA.id, fromIndex: 0, toNode: target.id, toIndex: 0 });

        const unrelated = { fromNode: 'missing', fromIndex: 0, toNode: 'other', toIndex: 0 };
        const rejected = graph.canConnect(sourceB.id, 0, target.id, 0, {
            excludeConnections: [unrelated],
        });
        assert.equal(rejected.valid, false);
        assert.match(rejected.message, /Input connection limit exceeded/);
    });
});

const UNION_OUTPUT = {
    id: 'value',
    outputType: 'any',
    initialTypes: ['bool', 'int', 'float', 'string'],
    typeInputSources: ['trueValue', 'falseValue'],
};

function createSelectNode(graph, id = 'select') {
    return graph.addNode({
        id,
        type: 'core-select',
        inputs: [
            { id: 'condition', allowedTypes: ['bool'] },
            {
                id: 'trueValue',
                allowedTypes: ['float', 'int', 'bool', 'string', 'core.tuple'],
            },
            {
                id: 'falseValue',
                allowedTypes: ['float', 'int', 'bool', 'string', 'core.tuple'],
            },
        ],
        outputs: [{ ...UNION_OUTPUT }],
    });
}

function createUnionGraph({ sourceTypes = [], targetAllowedTypes = ['string'] } = {}) {
    const graph = new NodeGraph({ id: 'graph-union' });
    const select = createSelectNode(graph);

    sourceTypes.forEach((type, index) => {
        const source = graph.addNode({
            id: `src${index}`,
            type: 'source',
            outputs: [{ id: 'out0', outputType: type }],
        });
        graph.addConnection({
            fromNode: source.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: index + 1,
        });
    });

    const target = graph.addNode({
        id: 'target',
        type: 'target',
        inputs: [{ id: 'in0', allowedTypes: targetAllowedTypes }],
    });

    return { graph, select, target };
}

describe('NodeGraph union output typing', () => {
    it('resolves an ordinary output to its declared type', () => {
        const { graph, source } = createGraphForCompatibility('float', ['float']);
        assert.deepEqual(graph.getResolvedOutputTypes(source.id, 0), ['float']);
    });

    it("reports the declared inputs' primary types for an unconnected union output", () => {
        const { graph, select } = createUnionGraph();
        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['float']);
    });

    it('reports distinct primary types in declaration order for an unconnected union', () => {
        const graph = new NodeGraph({ id: 'graph-union-unconnected-distinct' });
        const select = graph.addNode({
            id: 'select',
            type: 'core-select',
            inputs: [
                { id: 'condition', allowedTypes: ['bool'] },
                { id: 'trueValue', allowedTypes: ['float'] },
                { id: 'falseValue', allowedTypes: ['string'] },
            ],
            outputs: [{ ...UNION_OUTPUT }],
        });

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['float', 'string']);
    });

    it('returns only connected candidates when a union is partially wired', () => {
        const graph = new NodeGraph({ id: 'graph-union-partial' });
        const select = graph.addNode({
            id: 'select',
            type: 'core-select',
            inputs: [
                { id: 'condition', allowedTypes: ['bool'] },
                { id: 'trueValue', allowedTypes: ['float'] },
                { id: 'falseValue', allowedTypes: ['string'] },
            ],
            outputs: [{ ...UNION_OUTPUT }],
        });
        const boolSource = graph.addNode({
            id: 'bool-source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'bool' }],
        });

        graph.addConnection({
            fromNode: boolSource.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: 1,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['bool']);
    });

    it('collapses two bool sources to one bool', () => {
        const { graph, select } = createUnionGraph({ sourceTypes: ['bool', 'bool'] });
        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['bool']);
    });

    it('keeps the declaration order of distinct sources', () => {
        const { graph, select } = createUnionGraph({ sourceTypes: ['int', 'float'] });
        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['int', 'float']);
    });

    it('merges a mixed bool and string pair', () => {
        const { graph, select } = createUnionGraph({ sourceTypes: ['bool', 'string'] });
        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['bool', 'string']);
    });

    it('keeps a tuple and a scalar as two candidates with an any representative', () => {
        const { graph, select } = createUnionGraph({ sourceTypes: ['core.tuple', 'float'] });

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['core.tuple', 'float']);
        assert.equal(
            resolveUnionOutputType(graph.getResolvedOutputTypes(select.id, 0)),
            'any'
        );
    });

    it('resolves chained unions transitively', () => {
        const graph = new NodeGraph({ id: 'graph-chain' });
        const inner = createSelectNode(graph, 'inner');
        const outer = createSelectNode(graph, 'outer');
        const boolSource = graph.addNode({
            id: 'bool-source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'bool' }],
        });
        const stringSource = graph.addNode({
            id: 'string-source',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'string' }],
        });

        graph.addConnection({
            fromNode: boolSource.id,
            fromIndex: 0,
            toNode: inner.id,
            toIndex: 1,
        });
        graph.addConnection({
            fromNode: stringSource.id,
            fromIndex: 0,
            toNode: inner.id,
            toIndex: 2,
        });
        graph.addConnection({
            fromNode: inner.id,
            fromIndex: 0,
            toNode: outer.id,
            toIndex: 1,
        });
        graph.addConnection({
            fromNode: boolSource.id,
            fromIndex: 0,
            toNode: outer.id,
            toIndex: 2,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(outer.id, 0), ['bool', 'string']);
    });

    it('returns any for a missing node without throwing', () => {
        const { graph } = createUnionGraph();
        assert.deepEqual(graph.getResolvedOutputTypes('gone', 0), ['any']);
        assert.deepEqual(graph.getResolvedOutputTypes('select', 5), ['any']);
    });
});

describe('NodeGraph union output connection validation', () => {
    it('keeps the exact single-type message for a fixed output', () => {
        const { graph, source, target } = createGraphForCompatibility('bool', ['string']);
        const validation = graph.canConnect(source.id, 0, target.id, 0);

        assert.equal(validation.valid, false);
        assert.equal(
            validation.message,
            "Type mismatch: Cannot connect 'bool' to input accepting [string]"
        );
    });

    it('still allows int to float', () => {
        const { graph, source, target } = createGraphForCompatibility('int', ['float']);
        assert.equal(graph.canConnect(source.id, 0, target.id, 0).valid, true);
    });

    it('refuses an unconnected union whose primary type does not fit the target', () => {
        const { graph, select, target } = createUnionGraph({ targetAllowedTypes: ['string'] });
        assert.equal(graph.canConnect(select.id, 0, target.id, 0).valid, false);
    });

    it('accepts a bool-only union at a bool input', () => {
        const { graph, select, target } = createUnionGraph({
            sourceTypes: ['bool'],
            targetAllowedTypes: ['bool'],
        });
        assert.equal(graph.canConnect(select.id, 0, target.id, 0).valid, true);
    });

    it('refuses a bool-only union at a string input with the single-type wording', () => {
        const { graph, select, target } = createUnionGraph({
            sourceTypes: ['bool'],
            targetAllowedTypes: ['string'],
        });
        const validation = graph.canConnect(select.id, 0, target.id, 0);

        assert.equal(validation.valid, false);
        assert.equal(
            validation.message,
            "Type mismatch: Cannot connect 'bool' to input accepting [string]"
        );
    });

    it('refuses a mixed union at both incompatible inputs', () => {
        const { graph, select, target } = createUnionGraph({
            sourceTypes: ['bool', 'string'],
            targetAllowedTypes: ['string'],
        });
        const stringValidation = graph.canConnect(select.id, 0, target.id, 0);
        assert.equal(stringValidation.valid, false);
        assert.match(stringValidation.message, /union 'bool \| string'/);

        const boolTarget = graph.addNode({
            id: 'bool-target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['bool'] }],
        });
        const boolValidation = graph.canConnect(select.id, 0, boolTarget.id, 0);
        assert.equal(boolValidation.valid, false);
        assert.match(boolValidation.message, /union 'bool \| string'/);
    });

    it('accepts int/float members at a float input but not at an int input', () => {
        const { graph, select, target } = createUnionGraph({
            sourceTypes: ['int', 'float'],
            targetAllowedTypes: ['float'],
        });
        assert.equal(graph.canConnect(select.id, 0, target.id, 0).valid, true);

        const intTarget = graph.addNode({
            id: 'int-target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['int'] }],
        });
        assert.equal(graph.canConnect(select.id, 0, intTarget.id, 0).valid, false);
    });

    it('requires every tuple/scalar candidate to fit the target input', () => {
        const { graph, select, target } = createUnionGraph({
            sourceTypes: ['core.tuple', 'float'],
            targetAllowedTypes: ['core.tuple', 'float'],
        });
        assert.equal(graph.canConnect(select.id, 0, target.id, 0).valid, true);

        const tupleTarget = graph.addNode({
            id: 'tuple-target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['core.tuple'] }],
        });
        const tupleValidation = graph.canConnect(select.id, 0, tupleTarget.id, 0);
        assert.equal(tupleValidation.valid, false);
        assert.match(tupleValidation.message, /union 'core\.tuple \| float'/);

        const floatTarget = graph.addNode({
            id: 'float-target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['float'] }],
        });
        assert.equal(graph.canConnect(select.id, 0, floatTarget.id, 0).valid, false);
    });

    it('still reports a cycle before resolving union types', () => {
        const graph = new NodeGraph({ id: 'graph-cycle' });
        const loop = createSelectNode(graph, 'loop');

        const validation = graph.canConnect(loop.id, 0, loop.id, 1);

        assert.equal(validation.valid, false);
        assert.match(validation.message, /cycle/i);
    });
});



