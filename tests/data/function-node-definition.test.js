// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Generated node definitions for function graphs.
 *
 * Covers the type-id helpers, the connector mapping from the declared signature, the
 * two implementation arities, and the collection listing rules (enabled function graphs
 * only, self-call exclusion, dedupe).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    FUNCTION_NODE_PACKAGE_ID,
    FUNCTION_NODE_PACKAGE_NAME,
    buildFunctionNodeDefinition,
    isFunctionNodeTypeId,
    listFunctionNodeDefinitions,
    resolveFunctionGraphId,
    resolveFunctionNodeDefinition,
} from '../../src/micro_otter/nodes/html/js/data/function-node-definition.js';
import { buildNodeInfoContent } from '../../src/micro_otter/nodes/html/js/views/node-info-content.js';
import {
    DEFAULT_FUNCTION_ICON,
    FUNCTION_NODE_COLOR,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-signature.js';

/**
 * Minimal function-graph stub.
 * @param {object} [options] - Graph fields.
 * @returns {object} Graph stub.
 */
function createGraph({
    id = 'fn-1',
    name = 'Scale Values',
    executionType = 'function',
    enabled = true,
    category = 'math',
    icon = undefined,
    description = undefined,
    inputs = [],
    outputs = [],
    withTypeId = true,
} = {}) {
    const signature = { category, inputs, outputs };
    if (icon !== undefined) {
        signature.icon = icon;
    }
    if (description !== undefined) {
        signature.description = description;
    }
    const graph = {
        getId: () => id,
        getName: () => name,
        getExecutionType: () => executionType,
        getEnabled: () => enabled,
        getFunctionCategory: () => category,
        getFunctionSignature: () => signature,
    };
    if (withTypeId) {
        graph.getFunctionNodeTypeId = () => `function_graph.${id}`;
    }
    return graph;
}

describe('function node definitions', () => {
    it('describes one function graph as a palette node', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({
                inputs: [{ name: 'pin', types: ['int'] }],
                outputs: [{ name: 'result', types: ['float'] }],
            })
        );

        assert.equal(definition.type, 'function_graph.fn-1');
        assert.equal(definition.packageId, FUNCTION_NODE_PACKAGE_ID);
        assert.equal(definition.packageId, 'function');
        assert.equal(definition.category, 'math');
        assert.deepEqual(definition.title, { en: 'Scale Values' });
        assert.equal(definition.icon, DEFAULT_FUNCTION_ICON);
        assert.equal(definition.color, FUNCTION_NODE_COLOR);
        assert.deepEqual(definition.implementations, {});
    });

    it('keeps a stored signature icon on the definition', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({ icon: 'mdi:thermometer' })
        );

        assert.equal(definition.icon, 'mdi:thermometer');
    });

    it('derives the type id from the graph id when the accessor is missing', () => {
        const definition = buildFunctionNodeDefinition(createGraph({ withTypeId: false }));

        assert.equal(definition.type, 'function_graph.fn-1');
    });

    it('falls back to the default category', () => {
        const definition = buildFunctionNodeDefinition(createGraph({ category: '  ' }));

        assert.equal(definition.category, 'function');
        assert.equal(FUNCTION_NODE_PACKAGE_NAME, 'Function');
    });

    it('maps signature ports onto connector descriptors', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({
                inputs: [
                    { name: 'pin', types: ['int'] },
                    { name: 'gain', types: ['float', 'int'] },
                ],
                outputs: [{ name: 'result', types: ['any'] }],
            })
        );

        assert.deepEqual(definition.inputs, [
            {
                id: 'in_0',
                name: 'pin',
                allowedTypes: ['int'],
                defaultControl: { type: 'number', label: 'pin', default: 0 },
            },
            {
                id: 'in_1',
                name: 'gain',
                allowedTypes: ['float', 'int'],
                defaultControl: { type: 'number', label: 'gain', default: 0 },
            },
        ]);
        assert.deepEqual(definition.outputs, [
            { id: 'out_0', name: 'result', allowedTypes: ['any'] },
        ]);
    });

    it('emits checkbox and text default controls and keeps numeric bounds', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({
                inputs: [
                    { name: 'enabled', types: ['bool'] },
                    { name: 'label', types: ['string'] },
                    {
                        name: 'amount',
                        types: ['int', 'float'],
                        default: { type: 'float', value: 0.5, min: 0, max: 1, step: 0.1 },
                    },
                ],
            })
        );

        assert.deepEqual(
            definition.inputs.map((input) => input.defaultControl),
            [
                { type: 'checkbox', label: 'enabled', default: false },
                { type: 'text', label: 'label', default: '' },
                { type: 'number', label: 'amount', default: 0.5, min: 0, max: 1, step: 0.1 },
            ]
        );
        assert.deepEqual(
            definition.inputs.map((input) => input.allowedTypes),
            [['bool'], ['string'], ['float', 'int']]
        );
    });

    it('accepts a graph without ports', () => {
        const definition = buildFunctionNodeDefinition(createGraph());

        assert.deepEqual(definition.inputs, []);
        assert.deepEqual(definition.outputs, []);
        assert.deepEqual(definition.implementations, {});
    });

    it('emits a zero-argument call for a name-only graph', () => {
        const definition = buildFunctionNodeDefinition(createGraph(), {
            pythonFunctionName: '_fn_scale',
        });

        assert.deepEqual(definition.implementations.python, {
            type: 'regex',
            value: 'await _fn_scale()',
        });
    });

    it('emits one placeholder per input for the call expression', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({
                inputs: [
                    { name: 'pin', types: ['int'] },
                    { name: 'gain', types: ['float'] },
                ],
            }),
            { pythonFunctionName: '_fn_scale' }
        );

        assert.deepEqual(definition.implementations.python, {
            type: 'regex',
            value: 'await _fn_scale({{in0}}, {{in1}})',
        });
    });

    it('ignores a blank python function name', () => {
        const definition = buildFunctionNodeDefinition(createGraph(), {
            pythonFunctionName: '   ',
        });

        assert.deepEqual(definition.implementations, {});
    });

    it('carries the signature description and port documentation into the definition', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({
                description: '  does *math*  ',
                inputs: [{ name: 'pin', types: ['int'], documentation: ' reads **pin** ' }],
                outputs: [{ name: 'result', types: ['float'] }],
            })
        );

        assert.equal(definition.info, 'does *math*');
        assert.equal(definition.inputs[0].description, 'reads **pin**');
        assert.equal('description' in definition.outputs[0], false);
    });

    it('omits info and connector description when empty', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({ inputs: [{ name: 'pin', types: ['int'] }] })
        );

        assert.equal('info' in definition, false);
        assert.equal('description' in definition.inputs[0], false);
    });

    it('round-trips info and connector descriptions through buildNodeInfoContent', () => {
        const definition = buildFunctionNodeDefinition(
            createGraph({
                description: 'does *math*',
                inputs: [{ name: 'pin', types: ['int'], documentation: 'reads **pin**' }],
                outputs: [{ name: 'result', types: ['float'], documentation: 'the result' }],
            })
        );

        const content = buildNodeInfoContent(definition, 'en');
        assert.equal(content.info, 'does *math*');
        assert.equal(content.inputs[0].description, 'reads **pin**');
        assert.equal(content.outputs[0].description, 'the result');
    });

    it('recognizes generated ids and round-trips the graph id', () => {
        assert.equal(isFunctionNodeTypeId('function_graph.fn-1'), true);
        assert.equal(resolveFunctionGraphId('function_graph.fn-1'), 'fn-1');
        assert.equal(isFunctionNodeTypeId('function_graph.'), false);
        assert.equal(resolveFunctionGraphId('function_graph.   '), null);
        assert.equal(isFunctionNodeTypeId('console'), false);
        assert.equal(resolveFunctionGraphId(undefined), null);
    });
});

describe('function node definition listing', () => {
    it('lists only enabled function graphs of the collection', () => {
        const collection = {
            getGraphArray: () => [
                createGraph({ id: 'fn-1', name: 'First' }),
                createGraph({ id: 'loop-1', name: 'Loop', executionType: 'continuous' }),
                createGraph({ id: 'fn-2', name: 'Disabled', enabled: false }),
                createGraph({ id: 'fn-3', name: 'Third' }),
            ],
        };

        const definitions = listFunctionNodeDefinitions(collection);

        assert.deepEqual(
            definitions.map((definition) => definition.type),
            ['function_graph.fn-1', 'function_graph.fn-3']
        );
    });

    it('never lists the graph being edited', () => {
        const collection = {
            getGraphArray: () => [createGraph({ id: 'fn-1' }), createGraph({ id: 'fn-2' })],
        };

        const definitions = listFunctionNodeDefinitions(collection, { excludeGraphId: 'fn-1' });

        assert.deepEqual(
            definitions.map((definition) => definition.type),
            ['function_graph.fn-2']
        );
    });

    it('skips graphs without a usable id and duplicate definitions', () => {
        const collection = {
            getGraphArray: () => [
                { getName: () => 'No id', getExecutionType: () => 'function' },
                createGraph({ id: 'fn-1' }),
                createGraph({ id: 'fn-1' }),
                null,
            ],
        };

        const definitions = listFunctionNodeDefinitions(collection);

        assert.equal(definitions.length, 1);
        assert.equal(definitions[0].type, 'function_graph.fn-1');
    });

    it('answers an empty list without a collection', () => {
        assert.deepEqual(listFunctionNodeDefinitions(null), []);
        assert.deepEqual(listFunctionNodeDefinitions({}), []);
    });

    it('resolves one definition by type id and rejects stale ids', () => {
        const collection = {
            getGraphArray: () => [createGraph({ id: 'fn-1', name: 'Scale' })],
        };

        assert.equal(
            resolveFunctionNodeDefinition(collection, 'function_graph.fn-1')?.title.en,
            'Scale'
        );
        assert.equal(resolveFunctionNodeDefinition(collection, 'function_graph.gone'), null);
        assert.equal(resolveFunctionNodeDefinition(collection, 'console'), null);
        assert.equal(resolveFunctionNodeDefinition(null, 'function_graph.fn-1'), null);
    });
});
