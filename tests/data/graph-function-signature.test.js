// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Unit tests for the function-signature model (`data/graph-function-signature.ts`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_FUNCTION_CATEGORY,
    DEFAULT_FUNCTION_ICON,
    FUNCTION_NODE_COLOR,
    FUNCTION_NODE_TYPE_PREFIX,
    MAX_FUNCTION_PORT_NAME_LENGTH,
    MAX_FUNCTION_PORTS,
    NUMERIC_FUNCTION_PORT_TYPES,
    buildFunctionInputDefaultControl,
    buildFunctionNodeTypeId,
    buildFunctionParameterNames,
    buildFunctionPortAllowedTypes,
    createEmptyFunctionSignature,
    createFunctionPortId,
    isNumericFunctionPortType,
    isEmptyFunctionSignature,
    normalizeFunctionCategory,
    normalizeFunctionDescription,
    normalizeFunctionIcon,
    normalizeFunctionPort,
    normalizeFunctionPortDefault,
    normalizeFunctionPortName,
    normalizeFunctionPortTypes,
    normalizeFunctionPorts,
    normalizeFunctionSignature,
    resolveFunctionPortDefault,
    resolveFunctionPortDefaultControlType,
    sanitizeFunctionPortName,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-signature.js';

describe('createFunctionPortId', () => {
    it('derives the id from the port kind and position', () => {
        assert.equal(createFunctionPortId('input', 0), 'in_0');
        assert.equal(createFunctionPortId('input', 7), 'in_7');
        assert.equal(createFunctionPortId('output', 0), 'out_0');
        assert.equal(createFunctionPortId('output', 3), 'out_3');
    });

    it('clamps unusable indices instead of throwing', () => {
        assert.equal(createFunctionPortId('input', -4), 'in_0');
        assert.equal(createFunctionPortId('input', 2.9), 'in_2');
        assert.equal(createFunctionPortId('output', Number.NaN), 'out_0');
    });
});

describe('normalizeFunctionPortTypes', () => {
    it('falls back to any for missing or empty selections', () => {
        assert.deepEqual(normalizeFunctionPortTypes(undefined), ['any']);
        assert.deepEqual(normalizeFunctionPortTypes(null), ['any']);
        assert.deepEqual(normalizeFunctionPortTypes([]), ['any']);
        assert.deepEqual(normalizeFunctionPortTypes('int'), ['any']);
    });

    it('collapses any selection containing any to any alone', () => {
        assert.deepEqual(normalizeFunctionPortTypes(['int', 'any']), ['any']);
        assert.deepEqual(normalizeFunctionPortTypes(['any', 'string', 'float']), ['any']);
    });

    it('removes duplicate type ids and keeps declaration order', () => {
        assert.deepEqual(normalizeFunctionPortTypes(['string', 'int', 'string']), [
            'string',
            'int',
        ]);
    });

    it('ignores unknown or invalid type ids instead of throwing', () => {
        assert.deepEqual(normalizeFunctionPortTypes(['int', 'nope', 42, null]), ['int']);
        assert.deepEqual(normalizeFunctionPortTypes(['nope']), ['any']);
    });

    it('accepts namespaced type ids', () => {
        assert.deepEqual(normalizeFunctionPortTypes(['audio.sample', 'int']), [
            'audio.sample',
            'int',
        ]);
    });
});

describe('normalizeFunctionPortName', () => {
    it('trims and collapses inner whitespace', () => {
        assert.equal(normalizeFunctionPortName('  hall   sensor  '), 'hall sensor');
        assert.equal(normalizeFunctionPortName('Temperatur\n'), 'Temperatur');
    });

    it('truncates to the name-length limit', () => {
        assert.equal(
            normalizeFunctionPortName('a'.repeat(MAX_FUNCTION_PORT_NAME_LENGTH + 10)),
            'a'.repeat(MAX_FUNCTION_PORT_NAME_LENGTH)
        );
    });

    it('returns an empty name for unusable values', () => {
        assert.equal(normalizeFunctionPortName(undefined), '');
        assert.equal(normalizeFunctionPortName(null), '');
        assert.equal(normalizeFunctionPortName(42), '');
        assert.equal(normalizeFunctionPortName('   '), '');
    });
});

describe('sanitizeFunctionPortName', () => {
    it('produces an identifier fragment from spaces and punctuation', () => {
        assert.equal(sanitizeFunctionPortName('Hall Sensor'), 'hall_sensor');
        assert.equal(sanitizeFunctionPortName('  value-2  '), 'value_2');
    });

    it('strips umlauts and other non-ascii characters', () => {
        assert.equal(sanitizeFunctionPortName('Temperatur Größe'), 'temperatur_gr_e');
        assert.equal(sanitizeFunctionPortName('Größe'), 'gr_e');
    });

    it('returns an empty fragment when nothing usable remains', () => {
        assert.equal(sanitizeFunctionPortName('---'), '');
        assert.equal(sanitizeFunctionPortName(undefined), '');
    });
});

describe('buildFunctionParameterNames', () => {
    it('derives one parameter name per input port', () => {
        const names = buildFunctionParameterNames([
            { name: 'Temperature' },
            { name: 'Hall Sensor' },
        ]);

        assert.deepEqual(names, ['_in0_temperature', '_in1_hall_sensor']);
    });

    it('falls back to the index when a name has no usable characters', () => {
        assert.deepEqual(buildFunctionParameterNames([{ name: '' }, { name: '???' }]), [
            '_in0',
            '_in1',
        ]);
    });

    it('keeps duplicate names distinct through the index prefix', () => {
        const ports = [{ name: 'value' }, { name: 'Value' }, { name: 'value' }];

        assert.deepEqual(buildFunctionParameterNames(ports), [
            '_in0_value',
            '_in1_value',
            '_in2_value',
        ]);
        assert.deepEqual(buildFunctionParameterNames(ports), buildFunctionParameterNames(ports));
    });

    it('never treats output ports as parameters', () => {
        assert.deepEqual(
            buildFunctionParameterNames([{ id: 'out_0', name: 'x', types: ['int'] }]),
            ['_in0_x']
        );
    });

    it('returns an empty list for unusable input', () => {
        assert.deepEqual(buildFunctionParameterNames(undefined), []);
        assert.deepEqual(buildFunctionParameterNames(null), []);
        assert.deepEqual(buildFunctionParameterNames([]), []);
    });
});

describe('normalizeFunctionPort and normalizeFunctionPorts', () => {
    it('re-derives the port id from its position', () => {
        const port = normalizeFunctionPort(
            { id: 'stale-id', name: ' Value ', types: ['int'] },
            'output',
            2
        );

        assert.deepEqual(port, { id: 'out_2', name: 'Value', types: ['int'] });
    });

    it('normalizes unknown port shapes to an empty any-typed port', () => {
        assert.deepEqual(normalizeFunctionPort(null, 'input', 0), {
            id: 'in_0',
            name: '',
            types: ['any'],
            default: { type: 'any', value: '' },
        });
    });

    it('returns an empty list for non-arrays', () => {
        assert.deepEqual(normalizeFunctionPorts(undefined, 'input'), []);
        assert.deepEqual(normalizeFunctionPorts('nope', 'output'), []);
    });

    it('truncates to the port cap', () => {
        const many = Array.from({ length: MAX_FUNCTION_PORTS + 5 }, (_, index) => ({
            name: `p${index}`,
        }));
        const ports = normalizeFunctionPorts(many, 'input');

        assert.equal(MAX_FUNCTION_PORTS, 32);
        assert.equal(ports.length, MAX_FUNCTION_PORTS);
        assert.equal(ports[MAX_FUNCTION_PORTS - 1].id, `in_${MAX_FUNCTION_PORTS - 1}`);
    });
});

describe('function port defaults', () => {
    it('recognizes the numeric data types', () => {
        assert.deepEqual(NUMERIC_FUNCTION_PORT_TYPES, ['int', 'float', 'double']);
        assert.equal(isNumericFunctionPortType('int'), true);
        assert.equal(isNumericFunctionPortType('float'), true);
        assert.equal(isNumericFunctionPortType('double'), true);
        assert.equal(isNumericFunctionPortType('bool'), false);
        assert.equal(isNumericFunctionPortType('any'), false);
        assert.equal(isNumericFunctionPortType(42), false);
    });

    it('maps data types onto the node-package control kinds', () => {
        assert.equal(resolveFunctionPortDefaultControlType('int'), 'number');
        assert.equal(resolveFunctionPortDefaultControlType('float'), 'number');
        assert.equal(resolveFunctionPortDefaultControlType('double'), 'number');
        assert.equal(resolveFunctionPortDefaultControlType('bool'), 'checkbox');
        assert.equal(resolveFunctionPortDefaultControlType('string'), 'text');
        assert.equal(resolveFunctionPortDefaultControlType('any'), 'text');
        assert.equal(resolveFunctionPortDefaultControlType('audio.sample'), 'text');
    });

    it('synthesizes the type zero value when no default is stored', () => {
        assert.deepEqual(normalizeFunctionPortDefault(undefined, ['int']), {
            type: 'int',
            value: 0,
        });
        assert.deepEqual(normalizeFunctionPortDefault(null, ['bool']), {
            type: 'bool',
            value: false,
        });
        assert.deepEqual(normalizeFunctionPortDefault(undefined, ['string']), {
            type: 'string',
            value: '',
        });
        assert.deepEqual(normalizeFunctionPortDefault(undefined, ['any']), {
            type: 'any',
            value: '',
        });
    });

    it('falls back to the first declared type when the chosen type is removed', () => {
        assert.deepEqual(
            normalizeFunctionPortDefault({ type: 'string', value: 'x' }, ['int', 'float']),
            { type: 'int', value: 0 }
        );
    });

    it('coerces the value to the chosen type and truncates ints', () => {
        assert.deepEqual(normalizeFunctionPortDefault({ type: 'int', value: 2.9 }, ['int']), {
            type: 'int',
            value: 2,
        });
        assert.deepEqual(normalizeFunctionPortDefault({ type: 'float', value: '3.5' }, ['float']), {
            type: 'float',
            value: 3.5,
        });
        assert.deepEqual(normalizeFunctionPortDefault({ type: 'bool', value: 'true' }, ['bool']), {
            type: 'bool',
            value: true,
        });
        assert.deepEqual(normalizeFunctionPortDefault({ type: 'string', value: 42 }, ['string']), {
            type: 'string',
            value: '42',
        });
    });

    it('keeps finite bounds and clamps the value into them', () => {
        assert.deepEqual(
            normalizeFunctionPortDefault({ type: 'int', value: 5, min: 0, max: 10, step: 2 }, [
                'int',
            ]),
            { type: 'int', value: 5, min: 0, max: 10, step: 2 }
        );
        assert.deepEqual(
            normalizeFunctionPortDefault({ type: 'int', value: -4, min: 0, max: 10 }, ['int']),
            { type: 'int', value: 0, min: 0, max: 10 }
        );
        // `step` is a UI increment, not a value constraint: an off-lattice value is clamped
        // into the bounds but never quantized onto the step lattice.
        assert.deepEqual(
            normalizeFunctionPortDefault({ type: 'int', value: 50, min: 0, max: 10, step: 4 }, [
                'int',
            ]),
            { type: 'int', value: 10, min: 0, max: 10, step: 4 }
        );
        assert.deepEqual(
            normalizeFunctionPortDefault({ type: 'int', value: 5, min: 10, max: 0, step: -1 }, [
                'int',
            ]),
            { type: 'int', value: 5 }
        );
        assert.deepEqual(
            normalizeFunctionPortDefault({ type: 'float', value: 5, min: Number.NaN, max: 'x' }, [
                'float',
            ]),
            { type: 'float', value: 5 }
        );
    });

    it('resolves an effective default and orders the allowed types around it', () => {
        const port = { id: 'in_0', name: 'gain', types: ['int', 'float'] };
        assert.deepEqual(resolveFunctionPortDefault(port), { type: 'int', value: 0 });
        assert.deepEqual(buildFunctionPortAllowedTypes(port), ['int', 'float']);

        const reordered = {
            id: 'in_0',
            name: 'gain',
            types: ['int', 'float'],
            default: { type: 'float', value: 1.5 },
        };
        assert.deepEqual(buildFunctionPortAllowedTypes(reordered), ['float', 'int']);
    });

    it('builds the default control a call node mirrors', () => {
        assert.deepEqual(
            buildFunctionInputDefaultControl({
                id: 'in_0',
                name: 'gain',
                types: ['int'],
                default: { type: 'int', value: 4, min: 1, max: 15, step: 1 },
            }),
            { type: 'number', label: 'gain', default: 4, min: 1, max: 15, step: 1 }
        );
        assert.deepEqual(
            buildFunctionInputDefaultControl({
                id: 'in_0',
                name: 'enabled',
                types: ['bool'],
                default: { type: 'bool', value: true },
            }),
            { type: 'checkbox', label: 'enabled', default: true }
        );
        assert.deepEqual(
            buildFunctionInputDefaultControl({
                id: 'in_0',
                name: '',
                types: ['any'],
                default: { type: 'any', value: '' },
            }),
            { type: 'text', default: '' }
        );
    });
});

describe('normalizeFunctionCategory', () => {
    it('trims the category and falls back to function', () => {
        assert.equal(normalizeFunctionCategory(' Math '), 'Math');
        assert.equal(normalizeFunctionCategory(''), DEFAULT_FUNCTION_CATEGORY);
        assert.equal(normalizeFunctionCategory('   '), DEFAULT_FUNCTION_CATEGORY);
        assert.equal(normalizeFunctionCategory(undefined), DEFAULT_FUNCTION_CATEGORY);
        assert.equal(DEFAULT_FUNCTION_CATEGORY, 'function');
    });
});

describe('function icon defaults and normalization', () => {
    it('exposes the default icon and the broken-white node color', () => {
        assert.equal(DEFAULT_FUNCTION_ICON, 'mdi:function');
        assert.equal(FUNCTION_NODE_COLOR, '#837e73');
    });

    it('trims a stored icon and keeps its semantic form', () => {
        assert.equal(normalizeFunctionIcon(' mdi:thermometer '), 'mdi:thermometer');
        assert.equal(normalizeFunctionIcon('mdi:function'), 'mdi:function');
    });

    it('preserves icons from foreign sets instead of rejecting them', () => {
        assert.equal(normalizeFunctionIcon('ph:thermometer'), 'ph:thermometer');
        assert.equal(normalizeFunctionIcon('hue:light'), 'hue:light');
    });

    it('falls back to the default for empty or unusable values', () => {
        assert.equal(normalizeFunctionIcon(undefined), DEFAULT_FUNCTION_ICON);
        assert.equal(normalizeFunctionIcon(null), DEFAULT_FUNCTION_ICON);
        assert.equal(normalizeFunctionIcon(''), DEFAULT_FUNCTION_ICON);
        assert.equal(normalizeFunctionIcon('   '), DEFAULT_FUNCTION_ICON);
    });
});

describe('normalizeFunctionSignature', () => {
    it('creates an empty signature for unknown shapes', () => {
        const expected = {
            category: DEFAULT_FUNCTION_CATEGORY,
            icon: DEFAULT_FUNCTION_ICON,
            inputs: [],
            outputs: [],
        };

        assert.deepEqual(normalizeFunctionSignature(undefined), expected);
        assert.deepEqual(normalizeFunctionSignature(null), expected);
        assert.deepEqual(normalizeFunctionSignature('nope'), expected);
        assert.deepEqual(normalizeFunctionSignature({}), expected);
    });

    it('carries the default icon on an empty signature', () => {
        assert.equal(createEmptyFunctionSignature().icon, DEFAULT_FUNCTION_ICON);
    });

    it('keeps a stored icon', () => {
        assert.equal(normalizeFunctionSignature({ icon: ' mdi:thermometer ' }).icon, 'mdi:thermometer');
    });

    it('normalizes both port lists and keeps the category', () => {
        const signature = normalizeFunctionSignature({
            category: ' Math ',
            inputs: [{ name: ' A ', types: ['int', 'int'] }],
            outputs: [{ name: ' B ', types: ['any', 'float'] }],
        });

        assert.deepEqual(signature, {
            category: 'Math',
            icon: DEFAULT_FUNCTION_ICON,
            inputs: [{ id: 'in_0', name: 'A', types: ['int'], default: { type: 'int', value: 0 } }],
            outputs: [{ id: 'out_0', name: 'B', types: ['any'] }],
        });
    });

    it('treats a customized category, a customized icon or a declared port as non-empty', () => {
        assert.equal(isEmptyFunctionSignature(undefined), true);
        assert.equal(isEmptyFunctionSignature(createEmptyFunctionSignature()), true);
        assert.equal(
            isEmptyFunctionSignature({ category: 'Math', inputs: [], outputs: [] }),
            false
        );
        assert.equal(
            isEmptyFunctionSignature({ icon: 'mdi:thermometer', inputs: [], outputs: [] }),
            false
        );
        assert.equal(
            isEmptyFunctionSignature({
                category: 'Math',
                inputs: [{ id: 'in_0', name: 'A', types: ['int'] }],
                outputs: [],
            }),
            false
        );
    });
});

describe('normalizeFunctionDescription', () => {
    it('trims surrounding whitespace but preserves inner line breaks', () => {
        assert.equal(
            normalizeFunctionDescription('  line one\n\nline two  '),
            'line one\n\nline two'
        );
        assert.equal(normalizeFunctionDescription('\t**bold**\n'), '**bold**');
    });

    it('returns an empty string for blank or missing values', () => {
        assert.equal(normalizeFunctionDescription(undefined), '');
        assert.equal(normalizeFunctionDescription(null), '');
        assert.equal(normalizeFunctionDescription(''), '');
        assert.equal(normalizeFunctionDescription('   '), '');
    });
});

describe('function description and port documentation', () => {
    it('keeps a non-empty port documentation and drops blank values', () => {
        assert.deepEqual(
            normalizeFunctionPort(
                { name: 'A', types: ['int'], documentation: '  reads **pin**  ' },
                'input',
                0
            ),
            {
                id: 'in_0',
                name: 'A',
                types: ['int'],
                default: { type: 'int', value: 0 },
                documentation: 'reads **pin**',
            }
        );
        assert.deepEqual(
            normalizeFunctionPort({ name: 'A', types: ['int'], documentation: '   ' }, 'output', 1),
            { id: 'out_1', name: 'A', types: ['int'] }
        );
    });

    it('carries a non-empty description and omits it when blank', () => {
        assert.deepEqual(normalizeFunctionSignature({ description: '  does *math*  ' }), {
            category: DEFAULT_FUNCTION_CATEGORY,
            icon: DEFAULT_FUNCTION_ICON,
            inputs: [],
            outputs: [],
            description: 'does *math*',
        });
        assert.equal('description' in normalizeFunctionSignature({ description: '   ' }), false);
        assert.equal('description' in createEmptyFunctionSignature(), false);
    });

    it('treats a description-only signature as non-empty', () => {
        assert.equal(isEmptyFunctionSignature({ description: 'does math' }), false);
        assert.equal(isEmptyFunctionSignature({ description: '   ' }), true);
    });
});

describe('buildFunctionNodeTypeId', () => {
    it('prefixes the graph id', () => {
        assert.equal(buildFunctionNodeTypeId('graph-1'), 'function_graph.graph-1');
        assert.equal(buildFunctionNodeTypeId('  graph-2  '), 'function_graph.graph-2');
        assert.equal(FUNCTION_NODE_TYPE_PREFIX, 'function_graph.');
    });

    it('rejects missing graph ids', () => {
        assert.throws(() => buildFunctionNodeTypeId(''), TypeError);
        assert.throws(() => buildFunctionNodeTypeId('   '), TypeError);
        assert.throws(() => buildFunctionNodeTypeId(undefined), TypeError);
        assert.throws(() => buildFunctionNodeTypeId(42), TypeError);
    });
});
