// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for the structural function input/output node descriptors.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_OUTPUT_NODE_TYPE,
    FUNCTION_STRUCTURAL_NODE_META,
    FUNCTION_STRUCTURAL_NODE_TYPES,
    buildFunctionConnectorDescriptors,
    buildFunctionStructuralConnectorPatch,
    buildFunctionStructuralNodePayload,
    isFunctionInputNodeType,
    isFunctionStructuralNodeType,
    resolveFunctionStructuralNodePosition,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-nodes.js';
import { FUNCTION_NODE_COLOR } from '../../src/micro_otter/nodes/html/js/data/graph-function-signature.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

/** Signature used by the payload tests. */
const SIGNATURE = {
    category: 'Math',
    inputs: [
        { id: 'in_0', name: 'A', types: ['int', 'float'] },
        { id: 'in_1', name: 'B', types: ['any'] },
    ],
    outputs: [{ id: 'out_0', name: 'Sum', types: ['int'] }],
};

describe('structural node type guards', () => {
    it('recognizes exactly the two structural types', () => {
        assert.deepEqual(FUNCTION_STRUCTURAL_NODE_TYPES, [
            'graph.function.input',
            'graph.function.output',
        ]);
        assert.equal(isFunctionStructuralNodeType(FUNCTION_INPUT_NODE_TYPE), true);
        assert.equal(isFunctionStructuralNodeType(FUNCTION_OUTPUT_NODE_TYPE), true);
        assert.equal(isFunctionStructuralNodeType('stdmo.digital-input'), false);
        assert.equal(isFunctionStructuralNodeType(null), false);
        assert.equal(isFunctionInputNodeType(FUNCTION_INPUT_NODE_TYPE), true);
        assert.equal(isFunctionInputNodeType(FUNCTION_OUTPUT_NODE_TYPE), false);
    });
});

describe('FUNCTION_STRUCTURAL_NODE_META', () => {
    it('uses existing icons and the shared function node color', () => {
        const input = FUNCTION_STRUCTURAL_NODE_META[FUNCTION_INPUT_NODE_TYPE];
        const output = FUNCTION_STRUCTURAL_NODE_META[FUNCTION_OUTPUT_NODE_TYPE];

        assert.equal(input.kind, 'input');
        assert.equal(output.kind, 'output');
        assert.equal(input.icon, 'input');
        assert.equal(output.icon, 'output');
        assert.equal(IconProvider.has(input.icon), true);
        assert.equal(IconProvider.has(output.icon), true);
        assert.equal(input.color, FUNCTION_NODE_COLOR);
        assert.equal(output.color, FUNCTION_NODE_COLOR);
        assert.ok(input.width > 0);
        assert.ok(input.title.en.length > 0 && input.title.de.length > 0);
    });
});

describe('buildFunctionConnectorDescriptors', () => {
    it('keeps the port id and copies the allowed types', () => {
        const descriptors = buildFunctionConnectorDescriptors(SIGNATURE.inputs, 'input');

        assert.deepEqual(descriptors, [
            { id: 'in_0', name: 'A', allowedTypes: ['int', 'float'] },
            { id: 'in_1', name: 'B', allowedTypes: ['any'] },
        ]);
    });

    it('never emits empty allowedTypes', () => {
        const descriptors = buildFunctionConnectorDescriptors(
            [{ id: 'out_0', name: 'X', types: [] }],
            'output'
        );

        assert.deepEqual(descriptors[0].allowedTypes, ['any']);
    });

    it('re-derives an id that does not match the requested side', () => {
        const descriptors = buildFunctionConnectorDescriptors(
            [{ id: 'out_9', name: 'X', types: ['int'] }],
            'input'
        );

        assert.equal(descriptors[0].id, 'in_0');
    });
});

describe('buildFunctionStructuralNodePayload', () => {
    it('mirrors the declared inputs as outputs of the input node', () => {
        const payload = buildFunctionStructuralNodePayload(FUNCTION_INPUT_NODE_TYPE, SIGNATURE, {
            x: 10,
            y: 20,
        });

        assert.equal(payload.type, FUNCTION_INPUT_NODE_TYPE);
        assert.equal(payload.x, 10);
        assert.equal(payload.y, 20);
        assert.deepEqual(payload.inputs, []);
        assert.deepEqual(payload.outputs, [
            { id: 'in_0', name: 'A', allowedTypes: ['int', 'float'] },
            { id: 'in_1', name: 'B', allowedTypes: ['any'] },
        ]);
        assert.deepEqual(payload.controls, []);
        assert.deepEqual(payload.controlValues, {});
        assert.deepEqual(payload.inputDefaults, {});
    });

    it('mirrors the declared outputs as inputs of the output node', () => {
        const payload = buildFunctionStructuralNodePayload(FUNCTION_OUTPUT_NODE_TYPE, SIGNATURE, {
            x: 0,
            y: 0,
        });

        assert.equal(payload.type, FUNCTION_OUTPUT_NODE_TYPE);
        assert.deepEqual(payload.outputs, []);
        assert.deepEqual(payload.inputs, [
            { id: 'out_0', name: 'Sum', allowedTypes: ['int'] },
        ]);
        assert.equal(typeof payload.icon, 'string');
        assert.ok(payload.icon.length > 0);
    });

    it('rejects a non-structural type id', () => {
        assert.throws(
            () => buildFunctionStructuralNodePayload('stdmo.digital-input', SIGNATURE, { x: 0, y: 0 }),
            TypeError
        );
    });
});

describe('buildFunctionStructuralConnectorPatch', () => {
    it('patches only the side the node mirrors', () => {
        assert.deepEqual(buildFunctionStructuralConnectorPatch(FUNCTION_INPUT_NODE_TYPE, SIGNATURE), {
            outputs: [
                { id: 'in_0', name: 'A', allowedTypes: ['int', 'float'] },
                { id: 'in_1', name: 'B', allowedTypes: ['any'] },
            ],
        });
        assert.deepEqual(buildFunctionStructuralConnectorPatch(FUNCTION_OUTPUT_NODE_TYPE, SIGNATURE), {
            inputs: [{ id: 'out_0', name: 'Sum', allowedTypes: ['int'] }],
        });
    });
});


describe('resolveFunctionStructuralNodePosition', () => {
    it('places the input node left of the left-most node', () => {
        const nodes = [
            { x: 100, y: 40, width: 140 },
            { x: 300, y: 10, width: 160 },
        ];

        assert.deepEqual(resolveFunctionStructuralNodePosition(nodes, FUNCTION_INPUT_NODE_TYPE), {
            x: 100 - 40 - FUNCTION_STRUCTURAL_NODE_META[FUNCTION_INPUT_NODE_TYPE].width,
            y: 40,
        });
    });

    it('places the output node right of the right-most node', () => {
        const nodes = [
            { x: 100, y: 40, width: 140 },
            { x: 300, y: 10, width: 160 },
        ];

        assert.deepEqual(resolveFunctionStructuralNodePosition(nodes, FUNCTION_OUTPUT_NODE_TYPE), {
            x: 300 + 160 + 40,
            y: 10,
        });
    });

    it('falls back to fixed origins for an empty graph', () => {
        const inputWidth = FUNCTION_STRUCTURAL_NODE_META[FUNCTION_INPUT_NODE_TYPE].width;

        assert.deepEqual(resolveFunctionStructuralNodePosition([], FUNCTION_INPUT_NODE_TYPE), {
            x: 0,
            y: 0,
        });
        assert.deepEqual(resolveFunctionStructuralNodePosition([], FUNCTION_OUTPUT_NODE_TYPE), {
            x: inputWidth + 40,
            y: 0,
        });
    });

    it('is deterministic and ignores unusable nodes', () => {
        const nodes = [
            { x: Number.NaN, y: 0, width: 140 },
            null,
            { x: 50, y: 70, width: 140 },
        ];

        const first = resolveFunctionStructuralNodePosition(nodes, FUNCTION_INPUT_NODE_TYPE);
        const second = resolveFunctionStructuralNodePosition(nodes, FUNCTION_INPUT_NODE_TYPE);

        assert.deepEqual(first, second);
        assert.equal(first.y, 70);
    });

    it('rejects a non-structural type id', () => {
        assert.throws(() => resolveFunctionStructuralNodePosition([], 'stdmo.lamp'), TypeError);
    });
});

