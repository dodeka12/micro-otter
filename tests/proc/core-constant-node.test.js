import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { buildControlValuesForRuntimeSnapshot } from '../../src/micro_otter/nodes/html/js/data/runtime-node-definition-migration.js';
import { getVisibleControls } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import { Transpiler } from '../../src/micro_otter/nodes/html/js/proc/transpiler.js';
import { formatLiteral } from '../../src/micro_otter/nodes/html/js/proc/transpiler-helpers.js';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const definitionsPath = path.join(coreRoot, 'node_definitions.json');
const generatorsPath = path.join(coreRoot, 'node_generators.js');

const TYPE_ID = 'const';
const PRINT_TYPE_ID = 'print';
const CONTROL_ORDER = [
    'valueMode',
    'valueType',
    'floatValue',
    'intValue',
    'boolValue',
    'stringValue',
    'specialValue',
];
const CUSTOM_CONTROL_IDS = ['valueType', 'floatValue', 'intValue', 'boolValue', 'stringValue'];
const VALUE_TYPES = ['float', 'int', 'bool', 'string'];

/** Special constants as the generator must emit them, keyed by dropdown value. */
const SPECIAL_LITERALS = {
    pi: '3.141592653589793',
    e: '2.718281828459045',
    deg_to_rad: '0.017453292519943295',
    rad_to_deg: '57.29577951308232',
};
const SPECIAL_VALUES = Object.keys(SPECIAL_LITERALS);

/** Custom-mode control values with the literal `formatLiteral()` must emit. */
const CUSTOM_LITERALS = [
    [{ valueType: 'float', floatValue: 2.5 }, '2.5'],
    [{ valueType: 'int', intValue: -7.8 }, '-7'],
    [{ valueType: 'bool', boolValue: true }, 'True'],
    [{ valueType: 'string', stringValue: "otter's" }, "'otter\\'s'"],
    [{ valueType: 'bool', boolValue: false }, 'False'],
];

/** Defaults the definition declares for the custom-mode value controls. */
const CUSTOM_DEFAULTS = {
    valueType: 'float',
    floatValue: 50,
    intValue: 50,
    boolValue: false,
    stringValue: 'Hello',
};

/**
 * Load the shipped constant node definition.
 * @returns {object} The node definition.
 */
function loadDefinition() {
    return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes[TYPE_ID];
}

/**
 * Collect the definition controls keyed by control id.
 * @returns {Record<string, object>} Controls of the constant node.
 */
function controlsById() {
    return Object.fromEntries(loadDefinition().controls.map((control) => [control.id, control]));
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

/**
 * Add a constant node built from the shipped definition.
 * @param {NodeGraph} graph - Target graph.
 * @param {object} [options] - Node options.
 * @param {string} [options.id] - Node id.
 * @param {object} [options.controlValues] - Initial control values.
 * @returns {object} The cloned node data.
 */
function addConstantNode(graph, { id = 'constant', controlValues = {} } = {}) {
    const definition = loadDefinition();
    return graph.addNode({
        id,
        type: `core-${TYPE_ID}`,
        inputs: [],
        outputs: (definition.outputs || []).map((output) => ({ ...output })),
        controls: (definition.controls || []).map((control) => ({ ...control })),
        controlValues,
    });
}

/**
 * Add a sink node whose single input accepts exactly one data type.
 * @param {NodeGraph} graph - Target graph.
 * @param {string} allowedType - The only type the input accepts.
 * @returns {object} The cloned sink node data.
 */
function addTypedSink(graph, allowedType) {
    return graph.addNode({
        id: 'sink',
        type: 'test-typed-sink',
        inputs: [{ id: 'in0', allowedTypes: [allowedType], initialTypes: [allowedType] }],
        outputs: [],
    });
}

describe('core constant node definition', () => {
    it('declares the shipped node metadata', () => {
        const definition = loadDefinition();

        assert.deepEqual(definition.title, { en: 'Constant', de: 'Konstante' });
        assert.equal(definition.category, 'data');
        assert.equal(definition.color, '#4a6fa5');
        assert.equal(definition.shape, 'square');
        assert.equal(definition.icon, 'icons/input_24dp.svg');
        assert.deepEqual(definition.implementations.python, {
            type: 'code-generator',
            value: 'NodeCodeGenerators.constNode',
        });
        assert.deepEqual(definition.initImplementations.python, {
            type: 'code-generator',
            value: 'NodeInitGenerators.constNode',
        });
    });

    it('has no inputs and one static float output', () => {
        const definition = loadDefinition();

        assert.deepEqual(definition.inputs, []);
        assert.equal(definition.outputs.length, 1);
        const [value] = definition.outputs;
        assert.equal(value.id, 'out0');
        assert.equal(value.outputType, 'float');
        assert.deepEqual(value.initialTypes, ['float']);
        assert.equal(value.typeInputSources, undefined);
    });

    it('puts the mode dropdown first and the special value dropdown last', () => {
        assert.deepEqual(
            loadDefinition().controls.map((control) => control.id),
            CONTROL_ORDER
        );
    });

    it('switches between the custom and the special control blocks', () => {
        const valueMode = controlsById().valueMode;

        assert.equal(valueMode.type, 'dropdown');
        assert.equal(valueMode.default, 'custom');
        assert.equal(valueMode.affectsControls, true);
        assert.equal(valueMode.affectsInputs, undefined);
        assert.deepEqual(
            valueMode.options.map((option) => option.value),
            ['custom', 'special']
        );

        const byValue = Object.fromEntries(valueMode.options.map((option) => [option.value, option]));
        assert.deepEqual(byValue.custom.activeControls, CUSTOM_CONTROL_IDS);
        assert.deepEqual(byValue.special.activeControls, ['specialValue']);
        assert.equal(byValue.custom.outputTypes, undefined);
        assert.deepEqual(byValue.special.outputTypes, { out0: ['float'] });
    });

    it('keeps the value type dropdown tied to one value control per option', () => {
        const valueType = controlsById().valueType;

        assert.equal(valueType.type, 'dropdown');
        assert.equal(valueType.default, CUSTOM_DEFAULTS.valueType);
        assert.equal(valueType.affectsControls, true);
        assert.deepEqual(
            valueType.options.map((option) => option.value),
            VALUE_TYPES
        );

        valueType.options.forEach((option) => {
            assert.deepEqual(
                option.activeControls,
                [`${option.value}Value`],
                `valueType '${option.value}' activeControls`
            );
            assert.deepEqual(
                option.outputTypes,
                { out0: [option.value] },
                `valueType '${option.value}' outputTypes`
            );
        });

        const customControls = controlsById();
        Object.entries(CUSTOM_DEFAULTS).forEach(([id, defaultValue]) => {
            if (id === 'valueType') {
                return;
            }
            assert.equal(
                customControls[id].default,
                defaultValue,
                `custom control '${id}' default`
            );
        });
    });

    it('offers the four special constants with Pi as the default', () => {
        const specialValue = controlsById().specialValue;

        assert.equal(specialValue.type, 'dropdown');
        assert.equal(specialValue.default, 'pi');
        assert.equal(specialValue.affectsControls, undefined);
        assert.equal(specialValue.affectsInputs, undefined);
        assert.deepEqual(
            specialValue.options.map((option) => option.value),
            SPECIAL_VALUES
        );
    });

    it('labels every user-visible string bilingually', () => {
        const labels = collectDefinitionLabels();

        assert.ok(labels.length >= 25, 'expected the full label set');
        labels.forEach(({ label, where }) => assertBilingual(label, where));
    });

    it('documents both modes in the info and output descriptions', () => {
        const definition = loadDefinition();

        assert.match(definition.info.en, /special constant/);
        assert.match(definition.info.de, /Spezialkonstante/);
        assert.match(definition.outputs[0].description.en, /special constant/);
        assert.match(definition.outputs[0].description.de, /Spezialkonstante/);
    });
});

describe('core constant node control visibility', () => {
    it('shows the custom block in custom mode', () => {
        assert.deepEqual(visibleControlIds({}), ['valueMode', 'valueType', 'floatValue']);
        assert.deepEqual(visibleControlIds({ valueMode: 'custom' }), [
            'valueMode',
            'valueType',
            'floatValue',
        ]);
    });

    it('shows the value control of the selected custom data type', () => {
        assert.deepEqual(visibleControlIds({ valueType: 'int' }), [
            'valueMode',
            'valueType',
            'intValue',
        ]);
        assert.deepEqual(visibleControlIds({ valueType: 'bool' }), [
            'valueMode',
            'valueType',
            'boolValue',
        ]);
        assert.deepEqual(visibleControlIds({ valueType: 'string' }), [
            'valueMode',
            'valueType',
            'stringValue',
        ]);
    });

    it('hides every custom control in special mode', () => {
        assert.deepEqual(visibleControlIds({ valueMode: 'special' }), ['valueMode', 'specialValue']);
        assert.deepEqual(
            visibleControlIds({ valueMode: 'special', valueType: 'int', specialValue: 'e' }),
            ['valueMode', 'specialValue']
        );
    });
});

describe('core constant node connector typing', () => {
    it('types the output after the selected custom data type', () => {
        VALUE_TYPES.forEach((valueType) => {
            const graph = new NodeGraph({ id: `graph-const-${valueType}` });
            const node = addConstantNode(graph, { controlValues: { valueType } });

            assert.equal(node.getOutputType('out0'), valueType);
        });
    });

    it('defaults to the float data type when no controls are stored', () => {
        const graph = new NodeGraph({ id: 'graph-const-default' });
        const node = addConstantNode(graph);

        assert.equal(node.getOutputType('out0'), 'float');
    });

    it('forces a float output in special mode even when a custom type is stored', () => {
        const graph = new NodeGraph({ id: 'graph-const-special' });
        const node = addConstantNode(graph, {
            controlValues: { valueMode: 'special', valueType: 'int', specialValue: 'e' },
        });

        assert.equal(node.getOutputType('out0'), 'float');
    });

    it('prunes an int-only connection when the node switches to special mode', () => {
        const graph = new NodeGraph({ id: 'graph-const-prune' });
        const node = addConstantNode(graph, {
            controlValues: { valueType: 'int', intValue: 3 },
        });
        const sink = addTypedSink(graph, 'int');

        assert.equal(node.getOutputType('out0'), 'int');
        assert.equal(graph.canConnect(node.id, 0, sink.id, 0).valid, true);
        graph.addConnection({ fromNode: node.id, fromIndex: 0, toNode: sink.id, toIndex: 0 });
        assert.equal(graph.getConnections().length, 1);

        graph.updateNode(node.id, {
            controlValues: { valueMode: 'special', specialValue: 'pi', valueType: 'int' },
        });

        assert.equal(node.getOutputType('out0'), 'float');
        assert.equal(graph.getConnections().length, 0, 'the int-only connection must be pruned');

        graph.updateNode(node.id, {
            controlValues: { valueMode: 'custom', valueType: 'int', intValue: 3 },
        });

        assert.equal(node.getOutputType('out0'), 'int');
        assert.equal(graph.canConnect(node.id, 0, sink.id, 0).valid, true);
    });
});

describe('core constant node migration', () => {
    it('seeds custom mode for a node saved before the mode control existed', () => {
        const values = buildControlValuesForRuntimeSnapshot(
            loadDefinition().controls,
            { valueType: 'int', intValue: 7 },
            ['valueType', 'floatValue', 'intValue', 'boolValue', 'stringValue'].map((id) => ({ id }))
        );

        assert.equal(values.valueMode, 'custom');
        assert.equal(values.valueType, 'int');
        assert.equal(values.intValue, 7);
        assert.equal(values.specialValue, 'pi');
    });

    it('keeps a stored special mode and its constant', () => {
        const stored = {
            valueMode: 'special',
            valueType: 'int',
            floatValue: 50,
            intValue: 3,
            boolValue: false,
            stringValue: 'Hello',
            specialValue: 'e',
        };
        const values = buildControlValuesForRuntimeSnapshot(
            loadDefinition().controls,
            stored,
            CONTROL_ORDER.map((id) => ({ id }))
        );

        assert.deepEqual(values, stored);
    });

    it('drops control ids the current definition no longer declares', () => {
        const values = buildControlValuesForRuntimeSnapshot(
            loadDefinition().controls,
            { valueMode: 'special', specialValue: 'deg_to_rad', legacyValue: 1 }
        );

        assert.equal(Object.prototype.hasOwnProperty.call(values, 'legacyValue'), false);
        assert.equal(values.valueMode, 'special');
        assert.equal(values.specialValue, 'deg_to_rad');
    });
});

describe('core constant node generator', () => {
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
        await import(`${url.href}?test=core-constant-node-generator`);
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
     * Build the helpers the init generator receives from the transpiler.
     * @returns {{imports: string[], helpers: object}} Collected imports plus helpers.
     */
    function createHelpers() {
        const imports = [];
        return {
            imports,
            helpers: {
                registerImport: (statement) => imports.push(statement),
                formatLiteral: (value) => formatLiteral(value),
                createOutputName: (index) => `node_1_out${index}`,
            },
        };
    }

    /**
     * Run the init generator for one constant node.
     * @param {object} controlValues - Stored control values.
     * @param {string} [id] - Node id.
     * @returns {{statement: string, imports: string[]}} Statement plus registered imports.
     */
    function generateInit(controlValues, id = '1') {
        const { imports, helpers } = createHelpers();
        const statement = globalThis.NodeInitGenerators.constNode({
            node: { id, controlValues },
            helpers,
        });
        return { statement, imports };
    }

    it('wraps every custom constant in const()', () => {
        CUSTOM_LITERALS.forEach(([controlValues, literal]) => {
            const { statement } = generateInit(controlValues);

            assert.equal(
                statement,
                `CONST_NODE_1 = const(${literal})`,
                JSON.stringify(controlValues)
            );
            assert.doesNotMatch(statement, /math\./);
        });
    });

    it('emits the special constants as float literals', () => {
        SPECIAL_VALUES.forEach((value) => {
            const { statement } = generateInit({ valueMode: 'special', specialValue: value });

            assert.equal(statement, `CONST_NODE_1 = const(${SPECIAL_LITERALS[value]})`, value);
            assert.doesNotMatch(statement, /math\./);
        });
    });

    it('falls back to Pi for an unknown special value', () => {
        const { statement } = generateInit({ valueMode: 'special', specialValue: 'tau' });

        assert.equal(statement, `CONST_NODE_1 = const(${SPECIAL_LITERALS.pi})`);
    });

    it('ignores the stored custom value and type in special mode', () => {
        const { statement } = generateInit({
            valueMode: 'special',
            valueType: 'int',
            intValue: 4,
            specialValue: 'e',
        });

        assert.equal(statement, `CONST_NODE_1 = const(${SPECIAL_LITERALS.e})`);
    });

    it('registers the micropython const import for every node', () => {
        const custom = generateInit({ valueType: 'int', intValue: 5 });
        const special = generateInit({ valueMode: 'special', specialValue: 'pi' });

        assert.deepEqual(custom.imports, ['from micropython import const']);
        assert.deepEqual(special.imports, ['from micropython import const']);
    });

    it('derives the constant name from the node id', () => {
        const { statement } = generateInit({ valueType: 'float', floatValue: 1.5 }, 'node-7');

        assert.equal(statement, 'CONST_NODE_node_7 = const(1.5)');
    });

    it('emits the constant reference into the loop body', () => {
        const connected = globalThis.NodeCodeGenerators.constNode({
            node: { id: '1', controlValues: { valueMode: 'special', specialValue: 'pi' } },
            outputs: ['o'],
            outputsMeta: [{ id: 'out0', connected: true }],
        });
        assert.deepEqual(connected, { statement: 'o = CONST_NODE_1', outputs: ['o'] });

        const disconnected = globalThis.NodeCodeGenerators.constNode({
            node: { id: '1', controlValues: {} },
            outputs: ['o'],
            outputsMeta: [{ id: 'out0', connected: false }],
        });
        assert.deepEqual(disconnected, {
            statement: '# const output not connected',
            outputs: [],
        });
    });

    it('requires a node context in both generators', () => {
        assert.throws(
            () => globalThis.NodeInitGenerators.constNode({}),
            /constNode init generator requires context\.node/
        );
        assert.throws(
            () => globalThis.NodeCodeGenerators.constNode({}),
            /constNode generator requires context\.node/
        );
    });
});

describe('core constant node transpilation', () => {
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
        await import(`${url.href}?test=core-constant-node-transpilation`);
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

    it('imports const once and wraps every node value', async () => {
        const code = await transpileConstants([
            { valueType: 'float', floatValue: 2.5 },
            { valueMode: 'special', specialValue: 'pi' },
        ]);
        const normalized = code.replace(/\s+/g, ' ');

        assert.equal(code.split('from micropython import const').length - 1, 1);
        assert.match(normalized, /CONST_NODE_1 = const\(2\.5\)/);
        assert.match(normalized, /CONST_NODE_3 = const\(3\.141592653589793\)/);
        assert.doesNotMatch(code, /CONST_NODE_1 = 2\.5/);
    });

    it('uses the constant identifiers inside the graph loop', async () => {
        const code = await transpileConstants([
            { valueType: 'int', intValue: 7 },
            { valueMode: 'special', specialValue: 'e' },
        ]);

        assert.match(code, /\n {8}node_1_out0 = CONST_NODE_1\n/);
        assert.match(code, /\n {8}node_3_out0 = CONST_NODE_3\n/);
        assert.match(code, /print\('\[user\] ', 'Value', ': ', node_1_out0\)/);
        assert.match(code, /print\('\[user\] ', 'Value', ': ', node_3_out0\)/);
    });

    it('runs the generated code on MicroPython and prints every special constant', async (t) => {
        const code = await transpileConstants(
            SPECIAL_VALUES.map((value) => ({ valueMode: 'special', specialValue: value }))
        );
        const interpreter = resolveMicroPython();

        if (!interpreter) {
            t.skip(
                'MicroPython interpreter not found; set MICROPYTHON or MICRO_OTTER_MICROPYTHON_ROOT'
            );
            return;
        }

        // The generated entry point loops forever, so drive it as a task and stop it again.
        const probe = [
            code,
            '',
            'import uasyncio as _asyncio',
            '',
            'async def _probe():',
            '    _task = _asyncio.create_task(run())',
            '    await _asyncio.sleep_ms(250)',
            '    _task.cancel()',
            '',
            '_asyncio.run(_probe())',
            '',
        ].join('\n');
        const output = execFileSync(interpreter, ['-c', probe], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 20000,
        });
        const lines = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, SPECIAL_VALUES.length);

        assert.equal(lines.length, SPECIAL_VALUES.length, output);
        SPECIAL_VALUES.forEach((value, index) => {
            const match = /^\[user\]\s+Value\s+:\s+(\S+)$/.exec(lines[index]);
            assert.ok(match, `unexpected print line for '${value}': ${lines[index]}`);

            const expected = Number(SPECIAL_LITERALS[value]);
            const actual = Number(match[1]);
            assert.ok(
                Math.abs(actual - expected) <= Math.abs(expected) * 1e-9,
                `'${value}' printed ${match[1]} instead of ${expected}`
            );
        });
    });
});

/**
 * Transpile one graph holding constant nodes that each feed a core print node.
 * @param {object[]} controlValuesList - One control-value set per constant node.
 * @returns {Promise<string>} The generated MicroPython code.
 */
async function transpileConstants(controlValuesList) {
    const runtime = buildRuntime();
    const graph = new MockNodeGraph('g', 'ConstantGraph');

    controlValuesList.forEach((controlValues, index) => {
        const constId = String(index * 2 + 1);
        const printId = String(index * 2 + 2);
        graph.addNode(constId, buildNode(TYPE_ID, constId, runtime, controlValues));
        graph.addNode(printId, buildNode(PRINT_TYPE_ID, printId, runtime, {}));
        graph.addConnection({ fromNode: constId, fromIndex: 0, toNode: printId, toIndex: 2 });
    });

    const collection = new MockCollection('constant');
    collection.addGraph('g', graph);

    const transpiler = new Transpiler({ logger: { log: () => {}, debug: () => {} } });
    const result = await transpiler.transpile(collection, { deviceRuntime: runtime });
    return result.code;
}

/**
 * Locate a MicroPython unix-port interpreter for running the generated code.
 * @returns {string|null} Interpreter path, or null when none is installed.
 */
function resolveMicroPython() {
    const explicit = process.env.MICROPYTHON;
    if (explicit && explicit.trim()) {
        return explicit.trim();
    }

    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) {
            continue;
        }
        const candidate = path.join(dir, 'micropython');
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    const roots = [process.env.MICRO_OTTER_MICROPYTHON_ROOT, '/opt/micropython'].filter(Boolean);
    for (const root of roots) {
        const candidate = path.join(root, 'ports', 'unix', 'build-standard', 'micropython');
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}
class MockNodeData {
    /**
     * @param {object} options - Node shape.
     * @param {string} options.id - Node id.
     * @param {string} options.type - Node type id.
     * @param {object[]} [options.inputs] - Input definitions.
     * @param {object[]} [options.outputs] - Output definitions.
     * @param {object[]} [options.controls] - Control definitions.
     * @param {object} [options.controlValues] - Control values.
     */
    constructor({ id, type, inputs = [], outputs = [], controls = [], controlValues = {} }) {
        this.id = id;
        this.type = type;
        this.title = type;
        this.inputs = inputs;
        this.outputs = outputs;
        this.controls = controls;
        this.controlValues = controlValues;
        this.inputDefaults = {};
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


