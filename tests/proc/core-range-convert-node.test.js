import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    getVisibleControls,
    getVisibleInputEntries,
    getVisibleOutputEntries,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const definitionsPath = path.join(coreRoot, 'node_definitions.json');
const generatorsPath = path.join(coreRoot, 'node_generators.js');

const TYPE_ID = 'range-convert';
const OUTPUT_NAME = 'node_1_out0';
const NUMERIC_TYPES = ['float', 'int'];
const BASE_INPUT_IDS = ['value', 'inMin', 'inMax', 'outMin', 'outMax'];
const INPUT_ORDER = [...BASE_INPUT_IDS, 'power', 'sigma', 'steps'];
const INPUT_DEFAULTS = {
    value: 0,
    inMin: 0,
    inMax: 100,
    outMin: 0,
    outMax: 100,
    power: 2,
    sigma: 0.5,
    steps: 4,
};
const DEFAULT_INPUTS = ['0', '0', '100', '0', '100', '2', '0.5', '4'];

const PROLOGUE_LINES = [
    '_map_value_1 = 0',
    '_map_in_min_1 = 0',
    '_map_in_max_1 = 100',
    '_map_out_min_1 = 0',
    '_map_out_max_1 = 100',
    'if _map_in_max_1 == _map_in_min_1:',
    '    _map_t_1 = 0.0',
    'else:',
    '    _map_t_1 = (_map_value_1 - _map_in_min_1) / (_map_in_max_1 - _map_in_min_1)',
    'if _map_t_1 < 0:',
    '    _map_t_1 = 0.0',
    'elif _map_t_1 > 1:',
    '    _map_t_1 = 1.0',
];

const STEPPED_HEADER = [
    '_map_steps_1 = int(4)',
    'if _map_steps_1 < 1:',
    '    _map_steps_1 = 1',
    '_map_scaled_1 = _map_t_1 * _map_steps_1',
];

const STEPPED_TAILS = {
    floor: [
        'node_1_out0 = _map_out_min_1 + int(_map_scaled_1) / _map_steps_1 * ' +
            '(_map_out_max_1 - _map_out_min_1)',
    ],
    nearest: [
        'node_1_out0 = _map_out_min_1 + int(_map_scaled_1 + 0.5) / _map_steps_1 * ' +
            '(_map_out_max_1 - _map_out_min_1)',
    ],
    ceil: [
        '_map_level_1 = int(_map_scaled_1)',
        'if _map_level_1 < _map_scaled_1:',
        '    _map_level_1 = _map_level_1 + 1',
        'node_1_out0 = _map_out_min_1 + _map_level_1 / _map_steps_1 * ' +
            '(_map_out_max_1 - _map_out_min_1)',
    ],
};

const MODE_TAILS = {
    linear: ['node_1_out0 = _map_out_min_1 + _map_t_1 * (_map_out_max_1 - _map_out_min_1)'],
    power: [
        '_map_power_1 = 2',
        'if _map_power_1 <= 0:',
        '    _map_power_1 = 1',
        'node_1_out0 = _map_out_min_1 + (_map_t_1 ** _map_power_1) * ' +
            '(_map_out_max_1 - _map_out_min_1)',
    ],
    exponential: [
        '_map_sigma_1 = 0.5',
        'if _map_sigma_1 < 0.01:',
        '    _map_sigma_1 = 0.01',
        '_map_exp_den_1 = pow(2.718281828459045, 1 / _map_sigma_1) - 1',
        'if _map_exp_den_1 == 0:',
        '    node_1_out0 = _map_out_min_1 + _map_t_1 * (_map_out_max_1 - _map_out_min_1)',
        'else:',
        '    node_1_out0 = _map_out_min_1 + (pow(2.718281828459045, _map_t_1 / _map_sigma_1) - 1)' +
            ' / _map_exp_den_1 * (_map_out_max_1 - _map_out_min_1)',
    ],
    stepped: [...STEPPED_HEADER, ...STEPPED_TAILS.floor],
};

/**
 * Build the exact statement the generator must emit for one conversion mode.
 * @param {string} mode - Conversion mode id.
 * @param {string} [quantization] - Stepped quantization mode; defaults to `floor`.
 * @returns {string} Expected Python statement.
 */
function expectedStatement(mode, quantization = 'floor') {
    const tails =
        mode === 'stepped' ? [...STEPPED_HEADER, ...STEPPED_TAILS[quantization]] : MODE_TAILS[mode];
    return [...PROLOGUE_LINES, ...tails].join('\n');
}

/**
 * Build the eight input expressions, overriding the requested ids.
 * @param {object} overrides - Python expressions keyed by input id.
 * @returns {string[]} Eight input expressions in declaration order.
 */
function inputsWith(overrides = {}) {
    return INPUT_ORDER.map((id, index) =>
        overrides[id] === undefined ? DEFAULT_INPUTS[index] : String(overrides[id])
    );
}

/**
 * Load the shipped range-convert node definition.
 * @returns {object} The node definition.
 */
function loadDefinition() {
    return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes[TYPE_ID];
}

/**
 * Return the dropdown control that owns the four conversion modes.
 * @returns {object} The `conversion` control definition.
 */
function conversionControl() {
    return loadDefinition().controls.find((control) => control.id === 'conversion');
}

/**
 * Assert that a bilingual label carries non-empty English and German text.
 * @param {object} label - Bilingual label object.
 * @param {string} where - Failure context.
 * @returns {void}
 */
function assertBilingual(label, where) {
    assert.equal(typeof label?.en, 'string', `${where} misses an English label`);
    assert.equal(typeof label?.de, 'string', `${where} misses a German label`);
    assert.ok(label.en.trim().length > 0, `${where} has an empty English label`);
    assert.ok(label.de.trim().length > 0, `${where} has an empty German label`);
}

/**
 * Collect every bilingual label the definition ships.
 * @returns {Array<{label: object, where: string}>} Label plus failure context.
 */
function collectDefinitionLabels() {
    const definition = loadDefinition();
    const labels = [
        { label: definition.title, where: `${TYPE_ID} title` },
        { label: definition.info, where: `${TYPE_ID} info` },
    ];

    definition.inputs.forEach((input) => {
        labels.push({ label: input.name, where: `${TYPE_ID} input '${input.id}' name` });
        labels.push({
            label: input.description,
            where: `${TYPE_ID} input '${input.id}' description`,
        });
        labels.push({
            label: input.defaultControl?.label,
            where: `${TYPE_ID} input '${input.id}' defaultControl label`,
        });
    });

    definition.outputs.forEach((output) => {
        labels.push({ label: output.name, where: `${TYPE_ID} output '${output.id}' name` });
        labels.push({
            label: output.description,
            where: `${TYPE_ID} output '${output.id}' description`,
        });
    });

    definition.controls.forEach((control) => {
        labels.push({ label: control.label, where: `${TYPE_ID} control '${control.id}' label` });
        labels.push({
            label: control.description,
            where: `${TYPE_ID} control '${control.id}' description`,
        });
        (control.options || []).forEach((option) => {
            labels.push({
                label: option.label,
                where: `${TYPE_ID} control '${control.id}' option '${option.value}' label`,
            });
        });
    });

    return labels;
}

describe('core range-convert node definition', () => {
    it('declares the shipped node metadata', () => {
        const definition = loadDefinition();

        assert.deepEqual(definition.title, { en: 'Range Convert', de: 'Bereich umrechnen' });
        assert.equal(definition.category, 'calculation');
        assert.equal(definition.color, '#6b8b9e');
        assert.equal(definition.shape, 'square');
        assert.equal(definition.icon, 'icons/fit_page_width_24dp.svg');
        assert.deepEqual(definition.implementations.python, {
            type: 'code-generator',
            value: 'NodeCodeGenerators.rangeConvertNode',
        });
    });

    it('reads the eight inputs in mapping order with the pinned defaults', () => {
        const definition = loadDefinition();

        assert.deepEqual(
            definition.inputs.map((input) => input.id),
            INPUT_ORDER
        );

        definition.inputs.forEach((input) => {
            assert.deepEqual(input.allowedTypes, NUMERIC_TYPES, `${input.id} allowedTypes`);
            assert.deepEqual(input.initialTypes, NUMERIC_TYPES, `${input.id} initialTypes`);
            assert.equal(input.defaultControl?.type, 'number', `${input.id} defaultControl type`);
            assert.equal(
                input.defaultControl?.default,
                INPUT_DEFAULTS[input.id],
                `${input.id} defaultControl default`
            );
            assert.ok(
                input.defaultControl.min < input.defaultControl.default &&
                    input.defaultControl.default < input.defaultControl.max,
                `${input.id} default must sit between min and max`
            );
        });
    });

    it('exposes one static float value output', () => {
        const definition = loadDefinition();

        assert.equal(definition.outputs.length, 1);
        const [value] = definition.outputs;
        assert.equal(value.id, 'value');
        assert.equal(value.outputType, 'float');
        assert.deepEqual(value.initialTypes, ['float']);
        assert.equal(value.typeInputSources, undefined);
    });

    it('defaults the conversion dropdown to linear and redraws the inputs', () => {
        const definition = loadDefinition();

        assert.deepEqual(
            definition.controls.map((control) => control.id),
            ['conversion', 'quantization']
        );

        const [conversion] = definition.controls;
        assert.equal(conversion.type, 'dropdown');
        assert.equal(conversion.default, 'linear');
        assert.equal(conversion.affectsInputs, true);
        assert.equal(conversion.affectsControls, true);
        assert.deepEqual(
            conversion.options.map((option) => option.value),
            ['linear', 'power', 'exponential', 'stepped']
        );
    });

    it('shows the quantization dropdown only for the stepped conversion', () => {
        const [conversion, quantization] = loadDefinition().controls;
        const byValue = Object.fromEntries(
            conversion.options.map((option) => [option.value, option])
        );

        assert.deepEqual(byValue.stepped.activeControls, ['quantization']);
        ['linear', 'power', 'exponential'].forEach((value) => {
            assert.equal(byValue[value].activeControls, undefined, value);
        });

        assert.equal(quantization.type, 'dropdown');
        assert.equal(quantization.default, 'floor');
        assert.deepEqual(
            quantization.options.map((option) => option.value),
            ['floor', 'nearest', 'ceil']
        );
    });

    it('declares activeInputs on every conversion option', () => {
        const options = conversionControl().options;

        const byValue = Object.fromEntries(options.map((option) => [option.value, option]));
        assert.deepEqual(byValue.linear.activeInputs, BASE_INPUT_IDS);
        assert.deepEqual(byValue.power.activeInputs, [...BASE_INPUT_IDS, 'power']);
        assert.deepEqual(byValue.exponential.activeInputs, [...BASE_INPUT_IDS, 'sigma']);
        assert.deepEqual(byValue.stepped.activeInputs, [...BASE_INPUT_IDS, 'steps']);

        const inputIds = new Set(loadDefinition().inputs.map((input) => input.id));
        options.forEach((option) => {
            assert.ok(
                Array.isArray(option.activeInputs) && option.activeInputs.length > 0,
                `conversion '${option.value}' must declare activeInputs`
            );
            option.activeInputs.forEach((id) => {
                assert.ok(
                    inputIds.has(id),
                    `conversion '${option.value}' references unknown input '${id}'`
                );
            });
        });
    });

    it('labels every user-visible string bilingually', () => {
        const labels = collectDefinitionLabels();

        assert.ok(labels.length >= 30, 'expected the full label set');
        labels.forEach(({ label, where }) => assertBilingual(label, where));
    });

    it('documents the clamp, the reversed-bound, and the quantization semantics', () => {
        const { info } = loadDefinition();

        assert.match(info.en, /clamped/);
        assert.match(info.en, /Reversed bounds invert/);
        assert.match(info.en, /Quantization/);
        assert.match(info.de, /begrenzt/);
        assert.match(info.de, /Quantisierung/);
    });
});

describe('core range-convert control visibility', () => {
    /**
     * Resolve the visible control ids for one control-value combination.
     * @param {object} controlValues - Stored control values.
     * @returns {string[]} Visible control ids in declaration order.
     */
    function visibleControlIds(controlValues) {
        return getVisibleControls({
            controls: loadDefinition().controls,
            controlValues,
        }).map((control) => control.id);
    }

    it('hides the quantization dropdown outside stepped mode', () => {
        assert.deepEqual(visibleControlIds({}), ['conversion']);
        assert.deepEqual(visibleControlIds({ conversion: 'linear' }), ['conversion']);
        assert.deepEqual(visibleControlIds({ conversion: 'power' }), ['conversion']);
        assert.deepEqual(visibleControlIds({ conversion: 'exponential' }), ['conversion']);
    });

    it('shows the quantization dropdown in stepped mode', () => {
        assert.deepEqual(visibleControlIds({ conversion: 'stepped' }), [
            'conversion',
            'quantization',
        ]);
        assert.deepEqual(visibleControlIds({ conversion: 'stepped', quantization: 'ceil' }), [
            'conversion',
            'quantization',
        ]);
    });
});

describe('core range-convert connector visibility', () => {
    /**
     * Add a range-convert node built from the shipped definition.
     * @param {NodeGraph} graph - Target graph.
     * @param {object} controlValues - Initial control values.
     * @returns {object} The cloned node data.
     */
    function addRangeConvertNode(graph, controlValues = {}) {
        const definition = loadDefinition();
        return graph.addNode({
            id: 'range-convert',
            type: 'core-range-convert',
            inputs: (definition.inputs || []).map((input) => ({ ...input })),
            outputs: (definition.outputs || []).map((output) => ({ ...output })),
            controls: (definition.controls || []).map((control) => ({ ...control })),
            controlValues,
        });
    }

    it('shows the five range inputs in the implicit default mode', () => {
        const graph = new NodeGraph({ id: 'graph-range-convert-visible-default' });
        const node = addRangeConvertNode(graph);
        const inputs = getVisibleInputEntries(node);

        assert.deepEqual(
            inputs.map((entry) => entry.entry.id),
            BASE_INPUT_IDS
        );
        assert.deepEqual(
            inputs.map((entry) => entry.index),
            [0, 1, 2, 3, 4]
        );
    });

    it('shows only the five range inputs in linear mode', () => {
        const graph = new NodeGraph({ id: 'graph-range-convert-visible-linear' });
        const node = addRangeConvertNode(graph, { conversion: 'linear' });
        const inputs = getVisibleInputEntries(node);

        assert.deepEqual(
            inputs.map((entry) => entry.entry.id),
            BASE_INPUT_IDS
        );
        assert.deepEqual(
            inputs.map((entry) => entry.index),
            [0, 1, 2, 3, 4]
        );
    });

    [
        ['power', 'power', 5],
        ['exponential', 'sigma', 6],
        ['stepped', 'steps', 7],
    ].forEach(([mode, parameterId, parameterIndex]) => {
        it(`appends the ${parameterId} input in ${mode} mode`, () => {
            const graph = new NodeGraph({ id: `graph-range-convert-visible-${mode}` });
            const node = addRangeConvertNode(graph, { conversion: mode });
            const inputs = getVisibleInputEntries(node);

            assert.deepEqual(
                inputs.map((entry) => entry.entry.id),
                [...BASE_INPUT_IDS, parameterId]
            );
            assert.deepEqual(
                inputs.map((entry) => entry.index),
                [0, 1, 2, 3, 4, parameterIndex]
            );
        });
    });

    it('keeps the single value output visible', () => {
        const graph = new NodeGraph({ id: 'graph-range-convert-visible-output' });
        const node = addRangeConvertNode(graph);
        const outputs = getVisibleOutputEntries(node);

        assert.deepEqual(
            outputs.map((entry) => entry.entry.id),
            ['value']
        );
        assert.deepEqual(
            outputs.map((entry) => entry.index),
            [0]
        );
    });
});

describe('core range-convert connector typing against the shipped definition', () => {
    /**
     * Add a range-convert node built from the shipped definition.
     * @param {NodeGraph} graph - Target graph.
     * @returns {object} The cloned node data.
     */
    function addRangeConvertNode(graph) {
        const definition = loadDefinition();
        return graph.addNode({
            id: 'range-convert',
            type: 'core-range-convert',
            inputs: (definition.inputs || []).map((input) => ({ ...input })),
            outputs: (definition.outputs || []).map((output) => ({ ...output })),
            controls: (definition.controls || []).map((control) => ({ ...control })),
            controlValues: {},
        });
    }

    /**
     * Add a source node with one statically typed output.
     * @param {NodeGraph} graph - Target graph.
     * @param {string} id - Source id.
     * @param {string} outputType - Output type.
     * @returns {object} The cloned node data.
     */
    function addTypedSource(graph, id, outputType) {
        return graph.addNode({
            id,
            type: 'source',
            outputs: [{ id: 'out0', outputType }],
        });
    }

    /**
     * Add a target node with one typed input.
     * @param {NodeGraph} graph - Target graph.
     * @param {string} id - Target id.
     * @param {string[]} allowedTypes - Accepted input types.
     * @returns {object} The cloned node data.
     */
    function addTypedTarget(graph, id, allowedTypes) {
        return graph.addNode({
            id,
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes }],
        });
    }

    it('accepts int and float sources at all eight inputs and rejects strings', () => {
        const graph = new NodeGraph({ id: 'graph-range-convert-types' });
        const node = addRangeConvertNode(graph);
        const intSource = addTypedSource(graph, 'int-source', 'int');
        const floatSource = addTypedSource(graph, 'float-source', 'float');
        const stringSource = addTypedSource(graph, 'string-source', 'string');

        INPUT_ORDER.forEach((inputId, inputIndex) => {
            assert.equal(
                graph.canConnect(intSource.id, 0, node.id, inputIndex).valid,
                true,
                `${inputId} must accept int`
            );
            assert.equal(
                graph.canConnect(floatSource.id, 0, node.id, inputIndex).valid,
                true,
                `${inputId} must accept float`
            );

            const rejection = graph.canConnect(stringSource.id, 0, node.id, inputIndex);
            assert.equal(rejection.valid, false, `${inputId} must reject string`);
            assert.equal(
                rejection.message,
                "Type mismatch: Cannot connect 'string' to input accepting [float, int]"
            );
        });
    });

    it('resolves the unconnected output to float', () => {
        const graph = new NodeGraph({ id: 'graph-range-convert-unconnected' });
        const node = addRangeConvertNode(graph);

        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['float']);

        const floatTarget = addTypedTarget(graph, 'float-target', ['float']);
        assert.equal(graph.canConnect(node.id, 0, floatTarget.id, 0).valid, true);

        const stringTarget = addTypedTarget(graph, 'string-target', ['string']);
        assert.equal(graph.canConnect(node.id, 0, stringTarget.id, 0).valid, false);
    });

    it('keeps the float output when an int source feeds the value input', () => {
        const graph = new NodeGraph({ id: 'graph-range-convert-int' });
        const node = addRangeConvertNode(graph);
        const intSource = addTypedSource(graph, 'int-source', 'int');

        graph.addConnection({
            fromNode: intSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: 0,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['float']);
    });

    it('feeds a float consumer but not an int-only consumer', () => {
        const graph = new NodeGraph({ id: 'graph-range-convert-consumers' });
        const node = addRangeConvertNode(graph);

        const floatTarget = addTypedTarget(graph, 'float-target', ['float']);
        assert.equal(graph.canConnect(node.id, 0, floatTarget.id, 0).valid, true);

        const intTarget = addTypedTarget(graph, 'int-target', ['int']);
        const rejection = graph.canConnect(node.id, 0, intTarget.id, 0);
        assert.equal(rejection.valid, false);
        assert.equal(
            rejection.message,
            "Type mismatch: Cannot connect 'float' to input accepting [int]"
        );
    });
});

describe('core range-convert generator', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};

        const url = pathToFileURL(generatorsPath);
        await import(`${url.href}?test=core-range-convert-node`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        if (originalNodeInitGenerators === undefined) delete globalThis.NodeInitGenerators;
        else globalThis.NodeInitGenerators = originalNodeInitGenerators;
    });

    /**
     * Build a generator context for node `1` with a connected value output.
     * @param {object} overrides - Context overrides.
     * @returns {object} The generator context.
     */
    function context(overrides = {}) {
        return {
            node: { id: '1', controlValues: {} },
            inputs: ['0', '0', '100', '0', '100'],
            outputs: [OUTPUT_NAME],
            outputsMeta: [{ id: 'value', connected: true }],
            helpers: {},
            ...overrides,
        };
    }

    /**
     * Run the generator for node `1` with the given controls and inputs.
     * @param {object} controlValues - Control values.
     * @param {string[]} inputs - Python input expressions.
     * @returns {{statement: string, outputs: string[]}} Generator result.
     */
    function generate(controlValues, inputs = ['0', '0', '100', '0', '100']) {
        return globalThis.NodeCodeGenerators.rangeConvertNode(
            context({ node: { id: '1', controlValues }, inputs })
        );
    }

    it('registers the generator', () => {
        assert.equal(typeof globalThis.NodeCodeGenerators.rangeConvertNode, 'function');
    });

    it('requires a node in the context', () => {
        assert.throws(
            () => globalThis.NodeCodeGenerators.rangeConvertNode({ inputs: [], outputs: [] }),
            /rangeConvertNode generator requires context\.node/
        );
    });

    it('emits the unconnected comment when the output is disconnected', () => {
        const result = globalThis.NodeCodeGenerators.rangeConvertNode(
            context({ outputsMeta: [{ id: 'value', connected: false }] })
        );

        assert.equal(result.statement, '# range-convert output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('emits the exact prologue for the default linear mode', () => {
        const result = generate({});

        assert.deepEqual(result.outputs, [OUTPUT_NAME]);
        assert.equal(result.statement, expectedStatement('linear'));
    });

    it('emits the exact tail for each conversion mode', () => {
        Object.keys(MODE_TAILS).forEach((mode) => {
            assert.equal(generate({ conversion: mode }).statement, expectedStatement(mode), mode);
        });
    });

    it('emits the exact stepped tail for each quantization mode', () => {
        Object.keys(STEPPED_TAILS).forEach((quantization) => {
            const result = generate({ conversion: 'stepped', quantization });
            assert.equal(
                result.statement,
                expectedStatement('stepped', quantization),
                quantization
            );
        });
    });

    it('normalizes quantization aliases and falls back to floor', () => {
        const stepped = (quantization) =>
            generate({ conversion: 'stepped', quantization }).statement;

        assert.equal(stepped('Floor'), expectedStatement('stepped', 'floor'));
        assert.equal(stepped('NEAREST'), expectedStatement('stepped', 'nearest'));
        assert.equal(stepped('round'), expectedStatement('stepped', 'nearest'));
        assert.equal(stepped('Ceil'), expectedStatement('stepped', 'ceil'));
        assert.equal(stepped('ceiling'), expectedStatement('stepped', 'ceil'));
        assert.equal(stepped('up'), expectedStatement('stepped', 'ceil'));
        assert.equal(stepped('bogus'), expectedStatement('stepped', 'floor'));
        assert.equal(stepped(undefined), expectedStatement('stepped', 'floor'));
        assert.equal(stepped(null), expectedStatement('stepped', 'floor'));
    });

    it('ignores the quantization control outside stepped mode', () => {
        ['linear', 'power', 'exponential'].forEach((mode) => {
            assert.equal(
                generate({ conversion: mode, quantization: 'ceil' }).statement,
                expectedStatement(mode),
                mode
            );
        });
    });

    it('reads the bounds and the value as Python expressions', () => {
        const { statement } = generate({}, ['sensor_raw', '0', '1023', '0', '3.3']);

        assert.match(statement, /^_map_value_1 = sensor_raw$/m);
        assert.match(statement, /^_map_in_max_1 = 1023$/m);
        assert.match(statement, /^_map_out_max_1 = 3.3$/m);
    });

    it('reads only the selected conversion parameter', () => {
        const inputs = ['50', '0', '100', '0', '100', '7', '8', '9'];

        const linear = generate({}, inputs).statement;
        assert.doesNotMatch(linear, /_map_power_1|_map_sigma_1|_map_steps_1/);

        const power = generate({ conversion: 'power' }, inputs).statement;
        assert.match(power, /^_map_power_1 = 7$/m);
        assert.doesNotMatch(power, /_map_sigma_1|_map_steps_1/);

        const exponential = generate({ conversion: 'exponential' }, inputs).statement;
        assert.match(exponential, /^_map_sigma_1 = 8$/m);
        assert.doesNotMatch(exponential, /_map_power_1|_map_steps_1/);

        const stepped = generate({ conversion: 'stepped' }, inputs).statement;
        assert.match(stepped, /^_map_steps_1 = int\(9\)$/m);
        assert.doesNotMatch(stepped, /_map_power_1|_map_sigma_1/);
    });

    it('normalizes case, snake_case, and the legacy aliases', () => {
        assert.equal(generate({ conversion: 'POWER' }).statement, expectedStatement('power'));
        assert.equal(generate({ conversion: 'Stepped' }).statement, expectedStatement('stepped'));
        assert.equal(generate({ conversion: 'gamma' }).statement, expectedStatement('power'));
        assert.equal(generate({ conversion: 'GAMMA' }).statement, expectedStatement('power'));
        assert.equal(generate({ conversion: 'exp' }).statement, expectedStatement('exponential'));
        assert.equal(generate({ conversion: 'Exp' }).statement, expectedStatement('exponential'));
    });

    it('falls back to linear for unknown or missing conversions', () => {
        assert.equal(generate({ conversion: 'bogus' }).statement, expectedStatement('linear'));
        assert.equal(generate({}).statement, expectedStatement('linear'));
        assert.equal(
            generate({ conversion: 'power-transfer' }).statement,
            expectedStatement('linear')
        );
    });

    it('falls back to the definition defaults when inputs are missing', () => {
        const result = globalThis.NodeCodeGenerators.rangeConvertNode({
            node: { id: '1', controlValues: {} },
            outputs: [OUTPUT_NAME],
            outputsMeta: [{ id: 'value', connected: true }],
        });

        assert.equal(result.statement, expectedStatement('linear'));
        assert.match(result.statement, /^_map_value_1 = 0$/m);
        assert.match(result.statement, /^_map_in_min_1 = 0$/m);
        assert.match(result.statement, /^_map_in_max_1 = 100$/m);
        assert.match(result.statement, /^_map_out_min_1 = 0$/m);
        assert.match(result.statement, /^_map_out_max_1 = 100$/m);
        assert.match(generate({ conversion: 'power' }, []).statement, /^_map_power_1 = 2$/m);
        assert.match(
            generate({ conversion: 'exponential' }, []).statement,
            /^_map_sigma_1 = 0\.5$/m
        );
        assert.match(
            generate({ conversion: 'stepped' }, []).statement,
            /^_map_steps_1 = int\(4\)$/m
        );
    });

    it('emits only plain MicroPython arithmetic', () => {
        Object.keys(MODE_TAILS).forEach((mode) => {
            const { statement } = generate({ conversion: mode });

            assert.doesNotMatch(statement, /\bimport\b/);
            assert.doesNotMatch(statement, /\bmath\./);
            assert.doesNotMatch(statement, /\bround\(/);
            assert.doesNotMatch(statement, /\bfloat\(/);
            if (mode === 'exponential') {
                assert.match(statement, /pow\(2\.718281828459045, /);
            } else {
                assert.doesNotMatch(statement, /pow\(/);
            }
        });

        Object.keys(STEPPED_TAILS).forEach((quantization) => {
            const { statement } = generate({ conversion: 'stepped', quantization });

            assert.doesNotMatch(statement, /\bimport\b/);
            assert.doesNotMatch(statement, /\bmath\./);
            assert.doesNotMatch(statement, /\bround\(/);
            assert.doesNotMatch(statement, /\bfloat\(/);
            assert.doesNotMatch(statement, /pow\(/);
        });
    });

    /**
     * Run one generated statement under CPython.
     * @param {object} controlValues - Control values.
     * @param {string[]} inputs - Python input expressions.
     * @returns {string} `repr()` of the generated output value.
     */
    function evaluate(controlValues, inputs = DEFAULT_INPUTS) {
        const result = generate(controlValues, inputs);
        assert.deepEqual(result.outputs, [OUTPUT_NAME], 'the value output must stay connected');

        const script = `${result.statement}\nprint(repr(${OUTPUT_NAME}))\n`;
        return execFileSync(process.env.PYTHON || 'python3', ['-c', script], {
            encoding: 'utf8',
            stdio: 'pipe',
        }).trim();
    }

    it('maps linearly and clamps both ends', () => {
        assert.equal(evaluate({}, inputsWith({ value: 25 })), '25.0');
        assert.equal(evaluate({}, inputsWith({ value: 25, outMin: -50, outMax: 50 })), '-25.0');
        assert.equal(
            evaluate({}, inputsWith({ value: 512, inMax: 1023, outMax: 3.3 })),
            '1.6516129032258065'
        );
        assert.equal(evaluate({}, inputsWith({ value: -10 })), '0.0');
        assert.equal(evaluate({}, inputsWith({ value: 150 })), '100.0');
    });

    it('keeps a float result when every input is an integer', () => {
        assert.equal(evaluate({}, ['25', '0', '100', '0', '100']), '25.0');
    });

    it('inverts reversed linear bounds without swapping them', () => {
        assert.equal(evaluate({}, inputsWith({ value: 25, inMin: 100, inMax: 0 })), '75.0');
        assert.equal(evaluate({}, inputsWith({ value: 25, outMin: 100, outMax: 0 })), '75.0');
    });

    it('maps a zero-width linear input range to outMin', () => {
        const inputs = inputsWith({ value: 80, inMin: 50, inMax: 50, outMin: 20, outMax: 30 });

        assert.equal(evaluate({}, inputs), '20.0');
    });

    it('applies the power transfer and floors a non-positive exponent', () => {
        assert.equal(evaluate({ conversion: 'power' }, inputsWith({ value: 50 })), '25.0');
        assert.equal(
            evaluate({ conversion: 'power' }, inputsWith({ value: 50, power: 0.5 })),
            '70.71067811865476'
        );
        assert.equal(
            evaluate({ conversion: 'power' }, inputsWith({ value: 25, power: 0 })),
            '25.0'
        );
        assert.equal(
            evaluate({ conversion: 'power' }, inputsWith({ value: 50, outMin: 100, outMax: 0 })),
            '75.0'
        );
    });

    it('applies the scale-free exponential transfer', () => {
        const controls = { conversion: 'exponential' };

        assert.equal(evaluate(controls, inputsWith({ value: 10 })), '3.465343780550409');
        assert.equal(evaluate(controls, inputsWith({ value: 25 })), '10.153632409155183');
        assert.equal(evaluate(controls, inputsWith({ value: 50 })), '26.89414213699951');
        assert.equal(evaluate(controls, inputsWith({ value: 75 })), '54.49457660765887');
        assert.equal(evaluate(controls, inputsWith({ value: 50, sigma: 1 })), '37.75406687981455');
    });

    it('floors a small or negative sigma and survives a huge sigma', () => {
        const controls = { conversion: 'exponential' };

        assert.equal(
            evaluate(controls, inputsWith({ value: 50, sigma: 0 })),
            '1.928749847963923e-20'
        );
        assert.equal(
            evaluate(controls, inputsWith({ value: 50, sigma: -2 })),
            '1.928749847963923e-20'
        );
        assert.equal(evaluate(controls, inputsWith({ value: 50, sigma: '1e9' })), '50.0');
    });

    it('pins the exponential endpoints and a reversed exponential input', () => {
        const controls = { conversion: 'exponential' };

        assert.equal(evaluate(controls, inputsWith({ value: 0 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 100 })), '100.0');
        assert.equal(
            evaluate(controls, inputsWith({ value: 25, inMin: 100, inMax: 0 })),
            '54.49457660765887'
        );
    });

    it('keeps each level until the next step starts', () => {
        const controls = { conversion: 'stepped' };

        assert.equal(evaluate(controls, inputsWith({ value: 0 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 12 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 12.5 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 50 })), '50.0');
        assert.equal(evaluate(controls, inputsWith({ value: 63 })), '50.0');
        assert.equal(evaluate(controls, inputsWith({ value: 99.9 })), '75.0');
        assert.equal(evaluate(controls, inputsWith({ value: 100 })), '100.0');
    });

    it('reaches the top level only at the input maximum in floor mode', () => {
        const controls = { conversion: 'stepped' };
        const inputs = (value) => inputsWith({ value, inMin: 0, inMax: 10, steps: 10 });

        assert.equal(evaluate(controls, inputs(0)), '0.0');
        assert.equal(evaluate(controls, inputs(0.99)), '0.0');
        assert.equal(evaluate(controls, inputs(1)), '10.0');
        assert.equal(evaluate(controls, inputs(1.5)), '10.0');
        assert.equal(evaluate(controls, inputs(9.99)), '90.0');
        assert.equal(evaluate(controls, inputs(10)), '100.0');
    });

    it('selects the closest level in nearest quantization', () => {
        const controls = { conversion: 'stepped', quantization: 'nearest' };

        assert.equal(evaluate(controls, inputsWith({ value: 12 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 12.5 })), '25.0');
        assert.equal(evaluate(controls, inputsWith({ value: 50 })), '50.0');
        assert.equal(evaluate(controls, inputsWith({ value: 63 })), '75.0');
        assert.equal(evaluate(controls, inputsWith({ value: 99.9 })), '100.0');
        assert.equal(evaluate(controls, inputsWith({ value: 100 })), '100.0');
    });

    it('switches to the next level at the step start in ceil quantization', () => {
        const controls = { conversion: 'stepped', quantization: 'ceil' };

        assert.equal(evaluate(controls, inputsWith({ value: 0 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 12 })), '25.0');
        assert.equal(evaluate(controls, inputsWith({ value: 12.5 })), '25.0');
        assert.equal(evaluate(controls, inputsWith({ value: 50 })), '50.0');
        assert.equal(evaluate(controls, inputsWith({ value: 62.5 })), '75.0');
        assert.equal(evaluate(controls, inputsWith({ value: 100 })), '100.0');
    });

    it('uses the stepped count input, truncating fractions and flooring at one', () => {
        const controls = { conversion: 'stepped' };

        assert.equal(evaluate(controls, inputsWith({ value: 50, steps: 3 })), '33.33333333333333');
        assert.equal(
            evaluate(controls, inputsWith({ value: 50, steps: 3.7 })),
            '33.33333333333333'
        );
        assert.equal(evaluate(controls, inputsWith({ value: 50, steps: 1 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 25, steps: 1 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 50, steps: 0 })), '0.0');
        assert.equal(evaluate(controls, inputsWith({ value: 100, steps: 0 })), '100.0');
    });

    it('applies the stepped count to the nearest quantization', () => {
        const controls = { conversion: 'stepped', quantization: 'nearest' };

        assert.equal(
            evaluate(controls, inputsWith({ value: 50, steps: 3.7 })),
            '66.66666666666666'
        );
    });

    it('keeps the stepped levels inside offset and reversed output bounds', () => {
        const controls = { conversion: 'stepped' };

        assert.equal(evaluate(controls, inputsWith({ value: 12, outMin: 10, outMax: 20 })), '10.0');
        assert.equal(evaluate(controls, inputsWith({ value: 25, outMin: 10, outMax: 20 })), '12.5');
        assert.equal(evaluate(controls, inputsWith({ value: 25, outMin: 100, outMax: 0 })), '75.0');
    });

    it('transpiles a range-convert node feeding the core print node', async () => {
        const code = await transpileRangeConvert({});
        const normalized = code.replace(/\s+/g, ' ');

        assert.match(normalized, /_map_value_1 = 0/);
        assert.match(
            normalized,
            /node_1_out0 = _map_out_min_1 \+ _map_t_1 \* \(_map_out_max_1 - _map_out_min_1\)/
        );
        assert.match(normalized, /print\('\[user\] ', 'Value', ': ', node_1_out0\)/);
    });

    it('indents the multi-line transfer body under the generated loop', async () => {
        const code = await transpileRangeConvert({});

        assert.match(code, /\n {8}_map_value_1 = 0\n/);
        assert.match(code, /\n {8}if _map_in_max_1 == _map_in_min_1:\n {12}_map_t_1 = 0\.0\n/);
        assert.match(code, /\n {8}node_1_out0 = _map_out_min_1 \+ _map_t_1 \* \(/);
    });

    it('emits the selected mode parameter in the transpiled block', async () => {
        const stepped = await transpileRangeConvert({ conversion: 'stepped' });
        assert.match(stepped, /\n {8}_map_steps_1 = int\(4\)\n/);
        assert.match(stepped, /\n {8}_map_scaled_1 = _map_t_1 \* _map_steps_1\n/);
        assert.doesNotMatch(stepped, /_map_level_1/);

        const ceil = await transpileRangeConvert({ conversion: 'stepped', quantization: 'ceil' });
        assert.match(ceil, /\n {8}_map_level_1 = int\(_map_scaled_1\)\n/);

        const exponential = await transpileRangeConvert({ conversion: 'exponential' });
        assert.match(exponential, /\n {8}_map_sigma_1 = 0\.5\n/);
    });
});
class MockNodeData {
    /**
     * @param {object} options - Node shape.
     * @param {string} options.id - Node id.
     * @param {string} options.type - Node type id.
     * @param {object[]} [options.inputs] - Input definitions.
     * @param {object[]} [options.outputs] - Output definitions.
     * @param {object[]} [options.controls] - Control definitions.
     * @param {object} [options.controlValues] - Control values.
     * @param {object} [options.inputDefaults] - Inline input defaults.
     */
    constructor({
        id,
        type,
        inputs = [],
        outputs = [],
        controls = [],
        controlValues = {},
        inputDefaults = {},
    }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = inputs;
        this.outputs = outputs;
        this.controls = controls;
        this.controlValues = controlValues;
        this.inputDefaults = { ...inputDefaults };
    }

    getId() {
        return this.id;
    }

    getType() {
        return this.type;
    }
}

class MockNodeGraph {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.nodes = new Map();
        this.connections = [];
    }

    getId() {
        return this.id;
    }

    getName() {
        return this.name;
    }

    getTriggerInterval() {
        return 100;
    }

    getNodes() {
        const result = {};
        this.nodes.forEach((node, nodeId) => {
            result[nodeId] = node;
        });
        return result;
    }

    addNode(nodeId, node) {
        this.nodes.set(nodeId, node);
    }

    getConnections() {
        return this.connections.slice();
    }

    addConnection(connection) {
        this.connections.push({ ...connection });
    }
}

class MockCollection {
    constructor(id) {
        this.id = id;
        this.graphs = new Map();
    }

    getId() {
        return this.id;
    }

    getVersion() {
        return '1.0.0';
    }

    getVersionString() {
        return '1.0.0';
    }

    getTitle() {
        return this.id;
    }

    getGraphs() {
        const result = {};
        this.graphs.forEach((graph, graphId) => {
            result[graphId] = graph;
        });
        return result;
    }

    addGraph(graphId, graph) {
        this.graphs.set(graphId, graph);
    }
}

class MockRuntime {
    constructor() {
        this.definitions = new Map();
    }

    addNodeDefinition(type, definition) {
        this.definitions.set(type, definition);
    }

    getNodeType(type) {
        return this.definitions.get(type) || null;
    }
}

/**
 * Build a mock device runtime carrying every shipped core node definition.
 * @returns {MockRuntime} Runtime with the core definitions registered.
 */
function buildRuntime() {
    const runtime = new MockRuntime();
    const definitions = JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;
    for (const [type, definition] of Object.entries(definitions)) {
        runtime.addNodeDefinition(type, {
            ...definition,
            packageId: 'core',
            mpAssets: [],
            mpModuleRoots: [''],
        });
    }
    return runtime;
}

/**
 * Build one mock graph node from its shipped definition.
 * @param {string} type - Node type id.
 * @param {string} id - Node id.
 * @param {MockRuntime} runtime - Runtime providing the definition.
 * @param {object} controlValues - Control values.
 * @returns {MockNodeData} The mock node.
 */
function buildNode(type, id, runtime, controlValues = {}) {
    const definition = runtime.getNodeType(type);
    return new MockNodeData({
        id,
        type,
        inputs: (definition.inputs || []).map((input) => ({ ...input })),
        outputs: (definition.outputs || []).map((output) => ({ ...output })),
        controls: (definition.controls || []).map((control) => ({ ...control })),
        controlValues,
    });
}

/**
 * Transpile a single range-convert node feeding the core print node.
 * @param {object} controlValues - Range-convert control values.
 * @returns {Promise<string>} The generated MicroPython code.
 */
async function transpileRangeConvert(controlValues = {}) {
    const runtime = buildRuntime();
    const graph = new MockNodeGraph('g', 'RangeConvertGraph');
    graph.addNode('1', buildNode(TYPE_ID, '1', runtime, controlValues));
    graph.addNode('2', buildNode('print', '2', runtime, {}));
    graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 2 });

    const collection = new MockCollection(TYPE_ID);
    collection.addGraph('g', graph);

    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
    return result.code;
}
