import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    getVisibleInputEntries,
    getVisibleOutputEntries,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const definitionsPath = path.join(coreRoot, 'node_definitions.json');
const generatorsPath = path.join(coreRoot, 'node_generators.js');

const TYPE_ID = 'range-adapt';
const OUTPUT_NAME = 'node_1_out0';
const NUMERIC_TYPES = ['float', 'int'];
// Connector order of the shipped definition. Saved graphs address connectors by index, so these
// literals must stay in sync with the definition and must never be reordered.
const INPUT_IDS = ['value', 'default', 'min', 'max', 'invert'];
const INPUT_INDEX = Object.fromEntries(INPUT_IDS.map((id, index) => [id, index]));
// Python expressions the transpiler emits for unconnected connectors (its defaultControl
// literals: min 0, max 100, invert False).
const DEFAULT_INPUTS = ['0', '0', '0', '100', 'False'];

/**
 * Load the shipped range-adapt node definition.
 * @returns {object} The node definition.
 */
function loadDefinition() {
    return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes[TYPE_ID];
}

/**
 * Return the dropdown control that owns the four range-adapt modes.
 * @returns {object} The `mode` control definition.
 */
function modeControl() {
    return loadDefinition().controls.find((control) => control.id === 'mode');
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

/**
 * Add a range-adapt node built from the shipped definition.
 * @param {NodeGraph} graph - Target graph.
 * @param {object} [controlValues] - Initial control values.
 * @returns {object} The cloned node data.
 */
function addRangeAdaptNode(graph, controlValues = {}) {
    const definition = loadDefinition();
    return graph.addNode({
        id: 'range-adapt',
        type: 'core-range-adapt',
        inputs: (definition.inputs || []).map((input) => ({ ...input })),
        outputs: (definition.outputs || []).map((output) => ({ ...output })),
        controls: (definition.controls || []).map((control) => ({ ...control })),
        controlValues,
    });
}

describe('core range-adapt node definition', () => {
    it('declares the shipped node metadata', () => {
        const definition = loadDefinition();

        assert.deepEqual(definition.title, { en: 'Range Adapt', de: 'Bereich anpassen' });
        assert.equal(definition.category, 'calculation');
        assert.equal(definition.color, '#6b8b9e');
        assert.equal(definition.shape, 'square');
        assert.equal(definition.icon, 'icons/linear_scale_24dp.svg');
        assert.deepEqual(definition.implementations.python, {
            type: 'code-generator',
            value: 'NodeCodeGenerators.rangeAdaptNode',
        });
    });

    it('reads value, default, min, max, and invert as connectors', () => {
        const definition = loadDefinition();

        assert.deepEqual(
            definition.inputs.map((input) => input.id),
            INPUT_IDS
        );

        const byId = Object.fromEntries(definition.inputs.map((input) => [input.id, input]));
        ['value', 'default', 'min', 'max'].forEach((id) => {
            const input = byId[id];
            assert.deepEqual(input.allowedTypes, NUMERIC_TYPES, `${id} allowedTypes`);
            assert.deepEqual(input.initialTypes, NUMERIC_TYPES, `${id} initialTypes`);
            assert.equal(input.defaultControl?.type, 'number', `${id} defaultControl type`);
        });

        assert.equal(byId.value.defaultControl.default, 0, 'value default');
        assert.equal(byId.default.defaultControl.default, 0, 'default default');
        assert.equal(byId.min.defaultControl.default, 0, 'min default');
        assert.equal(byId.max.defaultControl.default, 100, 'max default');

        assert.deepEqual(byId.invert.allowedTypes, ['bool'], 'invert allowedTypes');
        assert.equal(byId.invert.initialTypes, undefined, 'invert initialTypes');
        assert.equal(byId.invert.defaultControl?.type, 'checkbox', 'invert defaultControl type');
        assert.equal(byId.invert.defaultControl.default, false, 'invert default');
    });

    it('exposes one float value output that follows both numeric inputs', () => {
        const definition = loadDefinition();

        assert.equal(definition.outputs.length, 1);
        const [value] = definition.outputs;
        assert.equal(value.id, 'value');
        assert.equal(value.outputType, 'float');
        assert.deepEqual(value.initialTypes, NUMERIC_TYPES);
        assert.deepEqual(value.typeInputSources, ['value', 'default']);
    });

    it('keeps only the mode control and moves the rest to connectors', () => {
        const definition = loadDefinition();

        assert.deepEqual(
            definition.controls.map((control) => control.id),
            ['mode']
        );

        const [mode] = definition.controls;
        assert.equal(mode.type, 'dropdown');
        assert.equal(mode.default, 'clamp');
        assert.equal(mode.affectsInputs, true);

        ['min', 'max', 'invert'].forEach((id) => {
            assert.equal(
                definition.controls.some((control) => control.id === id),
                false,
                `'${id}' must be an input connector, not a control`
            );
            assert.ok(
                definition.inputs.some((input) => input.id === id),
                `missing the '${id}' input connector`
            );
        });
    });

    it('declares activeInputs on every mode option', () => {
        const options = modeControl().options;

        assert.deepEqual(
            options.map((option) => option.value),
            ['clamp', 'wrap', 'ping-pong', 'to-default']
        );

        const byValue = Object.fromEntries(options.map((option) => [option.value, option]));
        const adapted = ['value', 'min', 'max', 'invert'];
        assert.deepEqual(byValue.clamp.activeInputs, adapted);
        assert.deepEqual(byValue.wrap.activeInputs, adapted);
        assert.deepEqual(byValue['ping-pong'].activeInputs, adapted);
        assert.deepEqual(byValue['to-default'].activeInputs, INPUT_IDS);

        const inputIds = new Set(loadDefinition().inputs.map((input) => input.id));
        options.forEach((option) => {
            assert.ok(
                Array.isArray(option.activeInputs) && option.activeInputs.length > 0,
                `mode '${option.value}' must declare activeInputs`
            );
            option.activeInputs.forEach((id) => {
                assert.ok(
                    inputIds.has(id),
                    `mode '${option.value}' activates unknown input '${id}'`
                );
            });
        });
    });

    it('labels every user-visible string bilingually', () => {
        const labels = collectDefinitionLabels();

        assert.ok(labels.length >= 20, 'expected the full label set');
        labels.forEach(({ label, where }) => assertBilingual(label, where));
    });

    it('documents the inclusive bounds and the wrap boundary convention', () => {
        const { info } = loadDefinition();

        assert.match(info.en, /include both bounds/);
        assert.match(info.en, /upper bound back to the lower bound/);
        assert.match(info.de, /schließen beide Grenzen ein/);
    });
});

describe('core range-adapt connector visibility', () => {
    ['clamp', 'wrap', 'ping-pong'].forEach((mode) => {
        it(`shows the value, bounds, and invert inputs in ${mode} mode`, () => {
            const graph = new NodeGraph({ id: `graph-range-visible-${mode}` });
            const node = addRangeAdaptNode(graph, { mode });
            const inputs = getVisibleInputEntries(node);

            assert.deepEqual(
                inputs.map((entry) => entry.entry.id),
                ['value', 'min', 'max', 'invert']
            );
            assert.deepEqual(
                inputs.map((entry) => entry.index),
                [0, 2, 3, 4]
            );
        });
    });

    it('shows the value, default, and adapted inputs in to-default mode', () => {
        const graph = new NodeGraph({ id: 'graph-range-visible-default' });
        const node = addRangeAdaptNode(graph, { mode: 'to-default' });
        const inputs = getVisibleInputEntries(node);

        assert.deepEqual(
            inputs.map((entry) => entry.entry.id),
            INPUT_IDS
        );
        assert.deepEqual(
            inputs.map((entry) => entry.index),
            INPUT_IDS.map((id) => INPUT_INDEX[id])
        );
    });

    it('keeps the single value output visible', () => {
        const graph = new NodeGraph({ id: 'graph-range-visible-output' });
        const node = addRangeAdaptNode(graph);
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

describe('core range-adapt connector typing against the shipped definition', () => {
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

    it('accepts int and float sources at the numeric inputs and rejects strings', () => {
        const graph = new NodeGraph({ id: 'graph-range-types' });
        const node = addRangeAdaptNode(graph);
        const intSource = addTypedSource(graph, 'int-source', 'int');
        const floatSource = addTypedSource(graph, 'float-source', 'float');
        const stringSource = addTypedSource(graph, 'string-source', 'string');

        ['value', 'default', 'min', 'max'].forEach((id) => {
            const inputIndex = INPUT_INDEX[id];
            assert.equal(
                graph.canConnect(intSource.id, 0, node.id, inputIndex).valid,
                true,
                `${id} int`
            );
            assert.equal(
                graph.canConnect(floatSource.id, 0, node.id, inputIndex).valid,
                true,
                `${id} float`
            );

            const rejection = graph.canConnect(stringSource.id, 0, node.id, inputIndex);
            assert.equal(rejection.valid, false);
            assert.equal(
                rejection.message,
                "Type mismatch: Cannot connect 'string' to input accepting [float, int]"
            );
        });
    });

    it('accepts bool sources only at the invert input', () => {
        const graph = new NodeGraph({ id: 'graph-range-invert-types' });
        const node = addRangeAdaptNode(graph);
        const boolSource = addTypedSource(graph, 'bool-source', 'bool');
        const intSource = addTypedSource(graph, 'int-source', 'int');

        assert.equal(graph.canConnect(boolSource.id, 0, node.id, INPUT_INDEX.invert).valid, true);

        const rejection = graph.canConnect(intSource.id, 0, node.id, INPUT_INDEX.invert);
        assert.equal(rejection.valid, false);
        assert.equal(
            rejection.message,
            "Type mismatch: Cannot connect 'int' to input accepting [bool]"
        );

        const stringSource = addTypedSource(graph, 'string-source', 'string');
        assert.equal(
            graph.canConnect(stringSource.id, 0, node.id, INPUT_INDEX.invert).valid,
            false
        );
        // `bool` still widens into the numeric connectors through the implicit int conversion.
        assert.equal(graph.canConnect(boolSource.id, 0, node.id, INPUT_INDEX.min).valid, true);
    });

    it('does not widen the output type from the bounds or invert inputs', () => {
        const graph = new NodeGraph({ id: 'graph-range-adapted-union' });
        const node = addRangeAdaptNode(graph);
        const intSource = addTypedSource(graph, 'int-source', 'int');
        const floatSource = addTypedSource(graph, 'float-source', 'float');
        const boolSource = addTypedSource(graph, 'bool-source', 'bool');

        graph.addConnection({
            fromNode: intSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: INPUT_INDEX.value,
        });
        graph.addConnection({
            fromNode: floatSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: INPUT_INDEX.min,
        });
        graph.addConnection({
            fromNode: floatSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: INPUT_INDEX.max,
        });
        graph.addConnection({
            fromNode: boolSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: INPUT_INDEX.invert,
        });

        // Only `value` and `default` feed the output union, so the extra numeric connections and
        // the bool switch must not leak into it.
        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['int']);

        const intTarget = addTypedTarget(graph, 'int-target', ['int']);
        assert.equal(graph.canConnect(node.id, 0, intTarget.id, 0).valid, true);
    });

    it('falls back to the deduplicated primary type when nothing is connected', () => {
        const graph = new NodeGraph({ id: 'graph-range-unconnected' });
        const node = addRangeAdaptNode(graph);

        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['float']);

        const floatTarget = addTypedTarget(graph, 'float-target', ['float']);
        assert.equal(graph.canConnect(node.id, 0, floatTarget.id, 0).valid, true);

        const stringTarget = addTypedTarget(graph, 'string-target', ['string']);
        assert.equal(graph.canConnect(node.id, 0, stringTarget.id, 0).valid, false);
    });

    it('follows a connected int source', () => {
        const graph = new NodeGraph({ id: 'graph-range-int' });
        const node = addRangeAdaptNode(graph);
        const intSource = addTypedSource(graph, 'int-source', 'int');

        graph.addConnection({
            fromNode: intSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: 0,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['int']);

        const intTarget = addTypedTarget(graph, 'int-target', ['int']);
        assert.equal(graph.canConnect(node.id, 0, intTarget.id, 0).valid, true);
    });

    it('follows a connected float source', () => {
        const graph = new NodeGraph({ id: 'graph-range-float' });
        const node = addRangeAdaptNode(graph);
        const floatSource = addTypedSource(graph, 'float-source', 'float');

        graph.addConnection({
            fromNode: floatSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: 0,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['float']);
    });

    it('keeps int and float members in connection order', () => {
        const graph = new NodeGraph({ id: 'graph-range-mixed' });
        // `default` is only an active input in `to-default` mode, so the union
        // must be read with both inputs visible.
        const node = addRangeAdaptNode(graph, { mode: 'to-default' });
        const intSource = addTypedSource(graph, 'int-source', 'int');
        const floatSource = addTypedSource(graph, 'float-source', 'float');

        graph.addConnection({
            fromNode: intSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: 0,
        });
        graph.addConnection({
            fromNode: floatSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: 1,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['int', 'float']);

        const floatTarget = addTypedTarget(graph, 'float-target', ['float']);
        assert.equal(graph.canConnect(node.id, 0, floatTarget.id, 0).valid, true);

        const intTarget = addTypedTarget(graph, 'int-target', ['int']);
        assert.equal(graph.canConnect(node.id, 0, intTarget.id, 0).valid, false);
    });

    it('ignores a hidden default source in clamp mode', () => {
        const graph = new NodeGraph({ id: 'graph-range-clamp-hidden' });
        const node = addRangeAdaptNode(graph, { mode: 'clamp' });
        const intSource = addTypedSource(graph, 'int-source', 'int');
        const floatSource = addTypedSource(graph, 'float-source', 'float');

        graph.addConnection({
            fromNode: intSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: 0,
        });
        // `default` stays wired in persisted data but is not an active input in
        // clamp mode, so it must not widen the output type.
        graph.addConnection({
            fromNode: floatSource.id,
            fromIndex: 0,
            toNode: node.id,
            toIndex: 1,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(node.id, 0), ['int']);

        // An int-only target is only admissible while `float` is absent from the
        // union, so this also guards against the hidden source leaking back in.
        const intTarget = addTypedTarget(graph, 'int-target', ['int']);
        assert.equal(graph.canConnect(node.id, 0, intTarget.id, 0).valid, true);
    });
});

describe('core range-adapt generator', () => {
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
        await import(`${url.href}?test=core-range-adapt-node`);
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
     * Build the `inputsMeta` entries of node `1`.
     * @param {number[]} connected - Connected connector indices.
     * @returns {Array<{id: string, connected: boolean}>} One entry per connector, in order.
     */
    function inputsMeta(connected = []) {
        return INPUT_IDS.map((id, index) => ({ id, connected: connected.includes(index) }));
    }

    /**
     * Build a generator context for node `1` with a connected value output.
     * @param {object} overrides - Context overrides.
     * @returns {object} The generator context.
     */
    function context(overrides = {}) {
        return {
            node: { id: '1', controlValues: {} },
            inputs: DEFAULT_INPUTS.slice(),
            outputs: [OUTPUT_NAME],
            outputsMeta: [{ id: 'value', connected: true }],
            inputsMeta: inputsMeta(),
            helpers: {},
            ...overrides,
        };
    }

    /**
     * Run the generator for node `1`.
     * @param {object} controlValues - Control values.
     * @param {object} [options] - Generator options.
     * @param {object} [options.inputs] - Python expressions keyed by connector id.
     * @param {number[]} [options.connected] - Connected connector indices.
     * @returns {{statement: string, outputs: string[]}} Generator result.
     */
    function generate(controlValues, { inputs = {}, connected = [] } = {}) {
        const expressions = DEFAULT_INPUTS.map((fallback, index) => {
            const id = INPUT_IDS[index];
            return Object.prototype.hasOwnProperty.call(inputs, id) ? inputs[id] : fallback;
        });
        return globalThis.NodeCodeGenerators.rangeAdaptNode(
            context({
                node: { id: '1', controlValues },
                inputs: expressions,
                inputsMeta: inputsMeta(connected),
            })
        );
    }

    it('registers the generator', () => {
        assert.equal(typeof globalThis.NodeCodeGenerators.rangeAdaptNode, 'function');
    });

    it('requires a node in the context', () => {
        assert.throws(
            () => globalThis.NodeCodeGenerators.rangeAdaptNode({ inputs: [], outputs: [] }),
            /rangeAdaptNode generator requires context\.node/
        );
    });

    it('emits the unconnected comment when the output is disconnected', () => {
        const result = globalThis.NodeCodeGenerators.rangeAdaptNode(
            context({ outputsMeta: [{ id: 'value', connected: false }] })
        );

        assert.equal(result.statement, '# range-adapt output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('emits the bounds, the swap, and the clamp body in order', () => {
        const result = generate({ mode: 'clamp' }, { inputs: { min: '10', max: '20' } });

        assert.deepEqual(result.outputs, [OUTPUT_NAME]);
        assert.equal(
            result.statement,
            [
                '_range_value_1 = 0',
                '_range_low_1 = 10',
                '_range_high_1 = 20',
                'if _range_high_1 < _range_low_1: _range_low_1, _range_high_1 = ' +
                    '_range_high_1, _range_low_1',
                'if _range_value_1 < _range_low_1:',
                '    node_1_out0 = _range_low_1',
                'elif _range_value_1 > _range_high_1:',
                '    node_1_out0 = _range_high_1',
                'else:',
                '    node_1_out0 = _range_value_1',
            ].join('\n')
        );
    });

    it('mirrors the value after the swap and before the mode body', () => {
        const { statement } = generate(
            { mode: 'clamp' },
            { inputs: { value: '12', invert: 'True' }, connected: [INPUT_INDEX.invert] }
        );
        const lines = statement.split('\n');
        const swapIndex = lines.findIndex((line) => line.startsWith('if _range_high_1'));
        const invertIndex = lines.findIndex((line) =>
            line.includes('_range_value_1 = _range_low_1 + _range_high_1 - _range_value_1')
        );
        const modeIndex = lines.findIndex((line) => line.startsWith('if _range_value_1 <'));

        assert.ok(swapIndex >= 0, 'missing the bounds swap');
        assert.ok(invertIndex > swapIndex, 'invert must follow the swap');
        assert.ok(modeIndex > invertIndex, 'the mode body must follow invert');
        assert.match(
            statement,
            /if bool\(True\):\n {4}_range_value_1 = _range_low_1 \+ _range_high_1/
        );
    });

    it('reads the bounds and the value as Python expressions', () => {
        const { statement } = generate(
            { mode: 'to-default' },
            {
                inputs: {
                    value: 'sensor_raw',
                    default: '7',
                    min: 'sensor_low',
                    max: 'sensor_high',
                },
                connected: [
                    INPUT_INDEX.value,
                    INPUT_INDEX.default,
                    INPUT_INDEX.min,
                    INPUT_INDEX.max,
                ],
            }
        );

        assert.match(statement, /^_range_value_1 = sensor_raw$/m);
        assert.match(statement, /^_range_low_1 = sensor_low$/m);
        assert.match(statement, /^_range_high_1 = sensor_high$/m);
        assert.match(statement, /\n {4}node_1_out0 = 7/);
    });

    it('never reads the default input outside to-default mode', () => {
        const { statement } = generate(
            { mode: 'clamp' },
            { inputs: { value: '5', default: '99' }, connected: [INPUT_INDEX.value] }
        );

        assert.doesNotMatch(statement, /99/);
    });

    it('normalizes the snake_case and legacy ping-pong spellings', () => {
        const canonical = generate({ mode: 'ping-pong' }).statement;

        assert.equal(generate({ mode: 'ping_pong' }).statement, canonical);
        assert.equal(generate({ mode: 'pingpong' }).statement, canonical);
    });

    it('falls back to clamp for unknown modes', () => {
        const clamp = generate({ mode: 'clamp' }).statement;

        assert.equal(generate({ mode: 'bogus' }).statement, clamp);
        assert.equal(generate({}).statement, clamp);
    });

    it('falls back to the inline bounds when an input expression is empty', () => {
        const { statement } = generate(
            { mode: 'clamp' },
            { inputs: { value: '', default: '', min: '', max: '', invert: '' } }
        );

        assert.match(statement, /^_range_value_1 = 0$/m);
        assert.match(statement, /^_range_low_1 = 0$/m);
        assert.match(statement, /^_range_high_1 = 100$/m);
        assert.doesNotMatch(statement, /if bool\(/);
    });

    it('skips the mirror when the uninverted checkbox default is read', () => {
        const { statement } = generate({ mode: 'clamp' });

        assert.doesNotMatch(statement, /if bool\(/);
        assert.doesNotMatch(statement, /_range_low_1 \+ _range_high_1/);
    });

    it('guards the mirror behind a connected invert input', () => {
        const { statement } = generate(
            { mode: 'clamp' },
            { inputs: { value: '12', invert: 'node_2_out0' }, connected: [INPUT_INDEX.invert] }
        );

        assert.match(statement, /^if bool\(node_2_out0\):$/m);
        assert.match(
            statement,
            /^ {4}_range_value_1 = _range_low_1 \+ _range_high_1 - _range_value_1$/m
        );
    });

    it('guards the mirror behind an inline true invert literal', () => {
        const { statement } = generate(
            { mode: 'clamp' },
            { inputs: { value: '12', invert: 'True' } }
        );

        assert.match(statement, /^if bool\(True\):$/m);
        assert.match(
            statement,
            /^ {4}_range_value_1 = _range_low_1 \+ _range_high_1 - _range_value_1$/m
        );
    });

    it('guards a zero-width range in the span-based modes', () => {
        ['wrap', 'ping-pong'].forEach((mode) => {
            const { statement } = generate({ mode }, { inputs: { min: '10', max: '10' } });

            assert.match(statement, /_range_span_1 = _range_high_1 - _range_low_1/);
            assert.match(statement, /if _range_span_1 == 0:\n {4}node_1_out0 = _range_low_1/);
        });
    });

    it('emits only plain MicroPython arithmetic', () => {
        ['clamp', 'wrap', 'ping-pong', 'to-default'].forEach((mode) => {
            const { statement } = generate({ mode });

            assert.doesNotMatch(statement, /\bimport\b/);
            assert.doesNotMatch(statement, /\bmath\./);
            assert.doesNotMatch(statement, /\bround\(/);
            assert.doesNotMatch(statement, /\bfloat\(/);
        });
    });

    /**
     * Run one generated statement under CPython.
     * @param {object} controlValues - Control values.
     * @param {object} inputs - Python expressions keyed by connector id.
     * @returns {string} `repr()` of the generated output value.
     */
    function evaluate(controlValues, inputs) {
        const connected = INPUT_IDS.filter((id) =>
            Object.prototype.hasOwnProperty.call(inputs, id)
        ).map((id) => INPUT_INDEX[id]);
        const result = generate(controlValues, { inputs, connected });
        assert.deepEqual(result.outputs, [OUTPUT_NAME], 'the value output must stay connected');

        const script = `${result.statement}\nprint(repr(${OUTPUT_NAME}))\n`;
        return execFileSync(process.env.PYTHON || 'python3', ['-c', script], {
            encoding: 'utf8',
            stdio: 'pipe',
        }).trim();
    }

    it('clamps below, inside, and above the bounds', () => {
        const controls = { mode: 'clamp' };
        const bounds = { min: '0', max: '100' };

        assert.equal(evaluate(controls, { ...bounds, value: '-10' }), '0');
        assert.equal(evaluate(controls, { ...bounds, value: '0' }), '0');
        assert.equal(evaluate(controls, { ...bounds, value: '25' }), '25');
        assert.equal(evaluate(controls, { ...bounds, value: '100' }), '100');
        assert.equal(evaluate(controls, { ...bounds, value: '150' }), '100');
    });

    it('swaps reversed clamp bounds', () => {
        const controls = { mode: 'clamp' };
        const bounds = { min: '100', max: '0' };

        assert.equal(evaluate(controls, { ...bounds, value: '-5' }), '0');
        assert.equal(evaluate(controls, { ...bounds, value: '50' }), '50');
        assert.equal(evaluate(controls, { ...bounds, value: '120' }), '100');
    });

    it('pins every clamp value to the single bound when min equals max', () => {
        const controls = { mode: 'clamp' };
        const bounds = { min: '10', max: '10' };

        ['5', '10', '20'].forEach((value) => {
            assert.equal(evaluate(controls, { ...bounds, value }), '10', `input ${value}`);
        });
    });

    it('inverts before clamping', () => {
        const controls = { mode: 'clamp' };
        const bounds = { min: '10', max: '20', invert: 'True' };

        assert.equal(evaluate(controls, { ...bounds, value: '10' }), '20');
        assert.equal(evaluate(controls, { ...bounds, value: '12' }), '18');
        assert.equal(evaluate(controls, { ...bounds, value: '20' }), '10');
        assert.equal(evaluate(controls, { ...bounds, value: '25' }), '10');
    });

    it('preserves int and float clamp representations', () => {
        assert.equal(evaluate({ mode: 'clamp' }, { value: '25', min: '0', max: '100' }), '25');
        assert.equal(evaluate({ mode: 'clamp' }, { value: '12.5', min: '0', max: '100' }), '12.5');
        assert.equal(evaluate({ mode: 'clamp' }, { value: '0.1', min: '0.5', max: '2.5' }), '0.5');
    });

    it('follows the connector expressions of the bounds and the invert switch', () => {
        assert.equal(
            evaluate({ mode: 'clamp' }, { value: '12', min: '2 * 5', max: '25 - 5', invert: '1' }),
            '18'
        );
    });

    it('wraps values around the range', () => {
        const controls = { mode: 'wrap' };
        const bounds = { min: '0', max: '100' };

        assert.equal(evaluate(controls, { ...bounds, value: '120' }), '20');
        assert.equal(evaluate(controls, { ...bounds, value: '-10' }), '90');
        assert.equal(evaluate(controls, { ...bounds, value: '50' }), '50');
        assert.equal(evaluate(controls, { ...bounds, value: '100' }), '0');
    });

    it('swaps reversed wrap bounds', () => {
        const controls = { mode: 'wrap' };
        const bounds = { min: '100', max: '0' };

        assert.equal(evaluate(controls, { ...bounds, value: '-5' }), '95');
        assert.equal(evaluate(controls, { ...bounds, value: '50' }), '50');
        assert.equal(evaluate(controls, { ...bounds, value: '120' }), '20');
    });

    it('returns the single wrap bound when the span is zero', () => {
        const controls = { mode: 'wrap' };
        const bounds = { min: '10', max: '10' };

        ['5', '10', '25'].forEach((value) => {
            assert.equal(evaluate(controls, { ...bounds, value }), '10', `input ${value}`);
        });
    });

    it('keeps the float precision of a wrapped value', () => {
        assert.equal(evaluate({ mode: 'wrap' }, { value: '12.5', min: '0', max: '100' }), '12.5');
        assert.equal(evaluate({ mode: 'wrap' }, { value: '12.5', min: '0', max: '10' }), '2.5');
        assert.equal(evaluate({ mode: 'wrap' }, { value: '120', min: '0', max: '100' }), '20');
    });

    it('ping-pongs values back and forth across the range', () => {
        const controls = { mode: 'ping-pong' };
        const bounds = { min: '0', max: '100' };

        assert.equal(evaluate(controls, { ...bounds, value: '120' }), '80');
        assert.equal(evaluate(controls, { ...bounds, value: '-20' }), '20');
        assert.equal(evaluate(controls, { ...bounds, value: '250' }), '50');
        assert.equal(evaluate(controls, { ...bounds, value: '300' }), '100');
        assert.equal(evaluate(controls, { ...bounds, value: '50' }), '50');
    });

    it('swaps reversed ping-pong bounds', () => {
        const controls = { mode: 'ping-pong' };
        const bounds = { min: '100', max: '0' };

        assert.equal(evaluate(controls, { ...bounds, value: '-20' }), '20');
        assert.equal(evaluate(controls, { ...bounds, value: '120' }), '80');
    });

    it('returns the single ping-pong bound when the span is zero', () => {
        const controls = { mode: 'ping-pong' };
        const bounds = { min: '10', max: '10' };

        ['5', '10', '25'].forEach((value) => {
            assert.equal(evaluate(controls, { ...bounds, value }), '10', `input ${value}`);
        });
    });

    it('passes in-range values and falls back outside the to-default bounds', () => {
        const controls = { mode: 'to-default' };
        const bounds = { min: '0', max: '100', default: '7' };

        assert.equal(evaluate(controls, { ...bounds, value: '0' }), '0');
        assert.equal(evaluate(controls, { ...bounds, value: '25' }), '25');
        assert.equal(evaluate(controls, { ...bounds, value: '100' }), '100');
        assert.equal(evaluate(controls, { ...bounds, value: '-5' }), '7');
        assert.equal(evaluate(controls, { ...bounds, value: '105' }), '7');
    });

    it('uses the inline zero when the default input is empty', () => {
        const controls = { mode: 'to-default' };
        const bounds = { min: '0', max: '100', default: '' };

        assert.equal(evaluate(controls, { ...bounds, value: '-1' }), '0');
        assert.equal(evaluate(controls, { ...bounds, value: '25' }), '25');
    });

    it('keeps the default expression and its float precision', () => {
        assert.equal(
            evaluate({ mode: 'to-default' }, { value: '-1', default: '7.5', min: '0', max: '100' }),
            '7.5'
        );
        assert.equal(
            evaluate(
                { mode: 'to-default' },
                { value: '-1', default: '0.5', min: '0.5', max: '2.5' }
            ),
            '0.5'
        );
    });

    it('applies the inclusive to-default test when min equals max', () => {
        const controls = { mode: 'to-default' };
        const bounds = { min: '10', max: '10', default: '7' };

        assert.equal(evaluate(controls, { ...bounds, value: '10' }), '10');
        assert.equal(evaluate(controls, { ...bounds, value: '11' }), '7');
        assert.equal(evaluate(controls, { ...bounds, value: '9' }), '7');
    });

    it('inverts before the range test in the span-based modes', () => {
        assert.equal(
            evaluate({ mode: 'wrap' }, { value: '30', min: '0', max: '100', invert: 'True' }),
            '70'
        );
        assert.equal(
            evaluate({ mode: 'ping-pong' }, { value: '30', min: '0', max: '100', invert: 'True' }),
            '70'
        );
    });

    it('inverts the value but never the default in to-default mode', () => {
        const controls = { mode: 'to-default' };
        const bounds = { min: '10', max: '20', default: '7', invert: 'True' };

        assert.equal(evaluate(controls, { ...bounds, value: '12' }), '18');
        assert.equal(evaluate(controls, { ...bounds, value: '25' }), '7');
    });

    it('transpiles a range-adapt node feeding the core print node', async () => {
        const code = await transpileRangeAdapt({ mode: 'wrap' });
        const normalized = code.replace(/\s+/g, ' ');

        assert.match(normalized, /_range_value_1 = 0/);
        assert.match(
            normalized,
            /node_1_out0 = _range_low_1 \+ \(_range_value_1 - _range_low_1\) % _range_span_1/
        );
        assert.match(normalized, /print\('\[user\] ', 'Value', ': ', node_1_out0\)/);
    });

    it('indents the multi-line mode body under the generated loop', async () => {
        const code = await transpileRangeAdapt({ mode: 'wrap' });

        assert.match(code, /\n {8}_range_value_1 = 0\n/);
        assert.match(code, /\n {8}if _range_span_1 == 0:\n {12}node_1_out0 = _range_low_1\n/);
        assert.match(code, /\n {12}node_1_out0 = _range_low_1 \+ \(/);
    });

    it('uses the inline zero for an unconnected default input', async () => {
        const code = await transpileRangeAdapt({ mode: 'to-default' });

        assert.match(code, /\n {12}node_1_out0 = 0\n/);
        assert.match(code, /\n {12}node_1_out0 = _range_value_1\n/);
    });

    it('omits the mirror branch for the unchecked invert default', async () => {
        const code = await transpileRangeAdapt({ mode: 'wrap' });

        assert.doesNotMatch(
            code,
            /_range_value_1 = _range_low_1 \+ _range_high_1 - _range_value_1/
        );
    });

    it('transpiles the inline defaults of the bounds and invert inputs', async () => {
        const code = await transpileRangeAdapt(
            { mode: 'clamp' },
            { min: 10, max: 20, invert: true }
        );
        const normalized = code.replace(/\s+/g, ' ');

        assert.match(normalized, /_range_low_1 = 10/);
        assert.match(normalized, /_range_high_1 = 20/);
        assert.match(
            normalized,
            /if bool\(True\): _range_value_1 = _range_low_1 \+ _range_high_1 - _range_value_1/
        );
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
 * @param {object} [inputDefaults] - Inline defaults keyed by input id.
 * @returns {MockNodeData} The mock node.
 */
function buildNode(type, id, runtime, controlValues = {}, inputDefaults = {}) {
    const definition = runtime.getNodeType(type);
    return new MockNodeData({
        id,
        type,
        inputs: (definition.inputs || []).map((input) => ({ ...input })),
        outputs: (definition.outputs || []).map((output) => ({ ...output })),
        controls: (definition.controls || []).map((control) => ({ ...control })),
        controlValues,
        inputDefaults,
    });
}

/**
 * Transpile a single range-adapt node feeding the core print node.
 * @param {object} controlValues - Range-adapt control values.
 * @param {object} [inputDefaults] - Inline defaults for the input connectors.
 * @returns {Promise<string>} The generated MicroPython code.
 */
async function transpileRangeAdapt(controlValues = {}, inputDefaults = {}) {
    const runtime = buildRuntime();
    const graph = new MockNodeGraph('g', 'RangeAdaptGraph');
    graph.addNode('1', buildNode(TYPE_ID, '1', runtime, controlValues, inputDefaults));
    graph.addNode('2', buildNode('print', '2', runtime, {}));
    graph.addConnection({ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 2 });

    const collection = new MockCollection(TYPE_ID);
    collection.addGraph('g', graph);

    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
    return result.code;
}
