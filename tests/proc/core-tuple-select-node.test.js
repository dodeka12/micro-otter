import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { getVisibleInputEntries } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const definitionsPath = path.join(coreRoot, 'node_definitions.json');
const generatorsPath = path.join(coreRoot, 'node_generators.js');

const TYPE_ID = 'tuple-select';
const OUTPUT_NAME = 'result';

/**
 * Load the shipped tuple-select node definition.
 * @returns {object} The node definition.
 */
function loadDefinition() {
    return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes[TYPE_ID];
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

describe('core tuple-select definition', () => {
    it('declares the shipped node metadata', () => {
        const definition = loadDefinition();

        assert.deepEqual(definition.title, { en: 'Tuple Select', de: 'Tupel-Auswahl' });
        assert.equal(definition.category, 'data');
        assert.equal(definition.color, '#4a6fa5');
        assert.equal(definition.shape, 'square');
        assert.equal(definition.icon, 'icons/format_list_numbered_24dp.svg');
        assert.deepEqual(definition.implementations.python, {
            type: 'code-generator',
            value: 'NodeCodeGenerators.tupleSelectNode',
        });
    });

    it('reads one tuple, one index, and one default in that order', () => {
        const definition = loadDefinition();

        assert.deepEqual(
            definition.inputs.map((input) => input.id),
            ['tuple', 'index', 'default']
        );

        const [tupleInput, indexInput, defaultInput] = definition.inputs;
        assert.deepEqual(tupleInput.allowedTypes, ['core.tuple']);
        assert.deepEqual(tupleInput.initialTypes, ['core.tuple']);
        assert.equal(tupleInput.defaultControl, undefined);

        assert.deepEqual(indexInput.allowedTypes, ['int', 'float']);
        assert.deepEqual(indexInput.initialTypes, ['int', 'float']);
        assert.deepEqual(indexInput.defaultControl, {
            type: 'number',
            label: { en: 'Index', de: 'Index' },
            min: 0,
            max: 100000,
            step: 1,
            default: 0,
        });

        assert.deepEqual(defaultInput.allowedTypes, ['int']);
        assert.deepEqual(defaultInput.initialTypes, ['int']);
        assert.deepEqual(defaultInput.defaultControl, {
            type: 'number',
            label: { en: 'Default', de: 'Standardwert' },
            min: -100000,
            max: 100000,
            step: 1,
            default: 0,
        });
    });

    it('exposes one element value output typed any', () => {
        const definition = loadDefinition();

        assert.equal(definition.outputs.length, 1);
        const [value] = definition.outputs;
        assert.equal(value.id, 'value');
        assert.equal(value.outputType, 'any');
        // A static output adopts initialTypes[0] as its live type, so a
        // heterogeneous element list here would mistype the connector and every
        // input reachable from it.
        assert.deepEqual(value.initialTypes, ['any']);
        assert.equal(value.typeInputSources, undefined);
    });

    it('exposes the index-mode dropdown and its visible inputs', () => {
        const definition = loadDefinition();

        assert.equal(definition.controls.length, 1);
        const [control] = definition.controls;
        assert.equal(control.type, 'dropdown');
        assert.equal(control.id, 'indexMode');
        assert.equal(control.affectsInputs, true);
        assert.equal(control.default, 'default');
        assert.deepEqual(
            control.options.map((option) => option.value),
            ['default', 'clamp', 'wrap']
        );
        assert.deepEqual(
            control.options.map((option) => option.activeInputs),
            [
                ['tuple', 'index', 'default'],
                ['tuple', 'index'],
                ['tuple', 'index'],
            ]
        );

        assertBilingual(control.label, 'indexMode label');
        assertBilingual(control.description, 'indexMode description');
        control.options.forEach((option) => {
            assertBilingual(option.label, `indexMode option '${option.value}' label`);
        });
    });

    it('documents zero-based positions, truncation, and the index modes', () => {
        const definition = loadDefinition();

        assertBilingual(definition.title, 'tuple-select title');
        assertBilingual(definition.info, 'tuple-select info');
        definition.inputs.forEach((input) => {
            assertBilingual(input.name, `${TYPE_ID} input '${input.id}' name`);
            assertBilingual(input.description, `${TYPE_ID} input '${input.id}' description`);
        });
        definition.outputs.forEach((output) => {
            assertBilingual(output.name, `${TYPE_ID} output '${output.id}' name`);
            assertBilingual(output.description, `${TYPE_ID} output '${output.id}' description`);
        });

        const description = definition.inputs[1].description.en;
        assert.match(description, /zero-based/i);
        assert.match(description, /truncated/i);
        assert.match(definition.info.en, /index mode/i);

        const control = definition.controls[0];
        assert.match(control.description.en, /clamp/i);
        assert.match(control.description.en, /wrap/i);

        const defaultDescription = definition.inputs[2].description.en;
        assert.match(defaultDescription, /default value/i);
    });
});

describe('core tuple-select generator', () => {
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
        await import(`${url.href}?test=core-tuple-select-node`);
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
     * Build a generator context for the tuple-select node.
     * @param {object} options - Context overrides plus an optional `mode` shorthand.
     * @param {string|null} [options.mode] - `indexMode` control value to apply.
     * @returns {object} Generator context.
     */
    function context({ mode, ...overrides } = {}) {
        let node = overrides.node || { id: 'select', controlValues: {} };
        if (mode !== undefined) {
            node = {
                ...node,
                controlValues: { ...(node.controlValues || {}), indexMode: mode },
            };
        }
        return {
            ...overrides,
            node,
            inputs: overrides.inputs ?? ['node_source_out0', '0'],
            outputs: overrides.outputs ?? [OUTPUT_NAME],
            outputsMeta: overrides.outputsMeta ?? [{ id: 'value', connected: true }],
            helpers: overrides.helpers ?? {},
        };
    }

    /**
     * Render the expected three-line tuple-select statement for one index mode.
     * @param {object} options - Expected statement options.
     * @param {string} [options.tuple] - Raw tuple input expression.
     * @param {string} [options.index] - Raw index input expression.
     * @param {string} [options.defaultValue] - Default input expression.
     * @param {string} [options.mode] - Normalized index mode.
     * @returns {string} Expected generated statement.
     */
    function expectedStatement({
        tuple = 'node_source_out0',
        index = '0',
        defaultValue = '0',
        mode = 'default',
    } = {}) {
        const head =
            `_tuple_select = ${tuple}\n` +
            `_index_select = int(${index}) if isinstance(${index}, (int, float)) else `;

        if (mode === 'clamp') {
            return (
                `${head}None\n` +
                `${OUTPUT_NAME} = _tuple_select[max(0, min(_index_select, len(_tuple_select) - 1))] ` +
                `if isinstance(_tuple_select, tuple) and _index_select is not None ` +
                `and len(_tuple_select) > 0 else None`
            );
        }

        if (mode === 'wrap') {
            return (
                `${head}None\n` +
                `${OUTPUT_NAME} = _tuple_select[_index_select % len(_tuple_select)] ` +
                `if isinstance(_tuple_select, tuple) and _index_select is not None ` +
                `and len(_tuple_select) > 0 else None`
            );
        }

        return (
            `${head}-1\n` +
            `${OUTPUT_NAME} = _tuple_select[_index_select] ` +
            `if isinstance(_tuple_select, tuple) and 0 <= _index_select ` +
            `< len(_tuple_select) else ${defaultValue}`
        );
    }

    it('registers the generator', () => {
        assert.equal(typeof globalThis.NodeCodeGenerators.tupleSelectNode, 'function');
    });

    it('assigns the tuple and the truncated index before the read', () => {
        const result = globalThis.NodeCodeGenerators.tupleSelectNode(context());

        assert.equal(result.statement, expectedStatement());
        assert.deepEqual(result.outputs, [OUTPUT_NAME]);
    });

    it('falls back to the literal 0 default and index 0 when all inputs are missing', () => {
        const result = globalThis.NodeCodeGenerators.tupleSelectNode(context({ inputs: [] }));

        assert.equal(result.statement, expectedStatement({ tuple: 'None', index: '0' }));
        assert.deepEqual(result.outputs, [OUTPUT_NAME]);
    });

    it('reads the wired default connector in Default Value mode', () => {
        const result = globalThis.NodeCodeGenerators.tupleSelectNode(
            context({ inputs: ['(10, 20, 30)', '5', 'node_fallback_out0'] })
        );

        assert.equal(
            result.statement,
            expectedStatement({
                tuple: '(10, 20, 30)',
                index: '5',
                defaultValue: 'node_fallback_out0',
            })
        );
        assert.deepEqual(result.outputs, [OUTPUT_NAME]);
    });

    it('clamps the index into the tuple bounds', () => {
        const { statement } = globalThis.NodeCodeGenerators.tupleSelectNode(
            context({ mode: 'clamp' })
        );

        assert.equal(statement, expectedStatement({ mode: 'clamp' }));
        assert.match(statement, /max\(0, min\(_index_select, len\(_tuple_select\) - 1\)\)/);
        assert.match(statement, /else None$/);
    });

    it('wraps the index modulo the tuple length', () => {
        const { statement } = globalThis.NodeCodeGenerators.tupleSelectNode(
            context({ mode: 'wrap' })
        );

        assert.equal(statement, expectedStatement({ mode: 'wrap' }));
        assert.match(statement, /_index_select % len\(_tuple_select\)/);
        assert.match(statement, /else None$/);
    });

    it('falls back to Default Value for unknown or missing modes', () => {
        /**
         * Render the statement for one raw control value.
         * @param {string|null|undefined} mode - Raw `indexMode` control value.
         * @returns {string} Generated statement.
         */
        const statementFor = (mode) =>
            globalThis.NodeCodeGenerators.tupleSelectNode(context({ mode })).statement;

        [undefined, null, '', 'bogus', 'constructor', ' default '].forEach((mode) => {
            assert.equal(
                statementFor(mode),
                expectedStatement(),
                `mode ${JSON.stringify(mode)} should read Default Value mode`
            );
        });
        assert.equal(statementFor('Clamp'), expectedStatement({ mode: 'clamp' }));
        assert.equal(statementFor(' WRAP '), expectedStatement({ mode: 'wrap' }));
    });

    it('emits a comment when the value output is not connected', () => {
        const result = globalThis.NodeCodeGenerators.tupleSelectNode(
            context({ outputsMeta: [{ id: 'value', connected: false }] })
        );

        assert.equal(result.statement, '# tuple-select output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('requires a node', () => {
        assert.throws(
            () => globalThis.NodeCodeGenerators.tupleSelectNode({ inputs: [], outputs: [] }),
            /tupleSelectNode generator requires context\.node/
        );
    });

    it('emits only MicroPython-safe builtins and guards', () => {
        ['default', 'clamp', 'wrap'].forEach((mode) => {
            const { statement } = globalThis.NodeCodeGenerators.tupleSelectNode(
                context({ mode })
            );

            assert.match(statement, /isinstance\(_tuple_select, tuple\)/);
            assert.match(statement, /isinstance\(0, \(int, float\)\)/);
            assert.doesNotMatch(statement, /\bimport\b/);
            assert.doesNotMatch(statement, /\barray\b/);
            assert.doesNotMatch(statement, /\bmath\./);
            assert.doesNotMatch(statement, /vars\.array/);

            if (mode === 'default') {
                assert.match(statement, /0 <= _index_select < len\(_tuple_select\)/);
            } else {
                assert.doesNotMatch(statement, /0 <= _index_select/);
                assert.match(statement, /_index_select is not None and len\(_tuple_select\) > 0/);
                assert.match(statement, /else None$/);
            }
        });

        const clampStatement = globalThis.NodeCodeGenerators.tupleSelectNode(
            context({ mode: 'clamp' })
        ).statement;
        assert.match(clampStatement, /max\(0, min\(/);

        const wrapStatement = globalThis.NodeCodeGenerators.tupleSelectNode(
            context({ mode: 'wrap' })
        ).statement;
        assert.match(wrapStatement, /% len\(_tuple_select\)/);
    });
    /**
     * Execute one generated tuple-select statement under CPython.
     * @param {object} overrides - Generator context overrides.
     * @param {string} [mode] - `indexMode` control value.
     * @returns {string} `repr()` of the generated output value.
     */
    function evaluateGenerated(overrides, mode) {
        const result = globalThis.NodeCodeGenerators.tupleSelectNode(context({ mode, ...overrides }));
        assert.deepEqual(result.outputs, [OUTPUT_NAME]);

        const script = `${result.statement}\nprint(repr(${OUTPUT_NAME}))\n`;
        return execFileSync(process.env.PYTHON || 'python3', ['-c', script], {
            encoding: 'utf8',
            stdio: 'pipe',
        }).trim();
    }

    it('reads the first and the last position', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '0'] }), '10');
        assert.equal(evaluateGenerated({ inputs: ['(1, 2, 3, 4, 5, 6, 7, 8)', '7'] }), '8');
    });

    it('returns the default value at and beyond the tuple length', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '3'] }), '0');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '8'] }), '0');
    });

    it('returns the default value for negative indices', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '-1'] }), '0');
    });

    it('truncates float indices', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '2.9'] }), '30');
    });

    it('returns the default value for non-numeric indices', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', "'abc'"] }), '0');
    });

    it('returns the default value when the tuple input is not a tuple', () => {
        assert.equal(evaluateGenerated({ inputs: ['7', '0'] }), '0');
        assert.equal(evaluateGenerated({ inputs: ['None', '0'] }), '0');
    });

    it('defaults a missing index to position 0', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20)'] }), '10');
    });

    it('uses the wired default value in Default Value mode', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '5', '99'] }), '99');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '-1', '42'] }), '42');
        assert.equal(evaluateGenerated({ inputs: ['7', '0', '42'] }), '42');
    });

    it('clamps out-of-range positions', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '3'] }, 'clamp'), '30');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '8'] }, 'clamp'), '30');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '-5'] }, 'clamp'), '10');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '2.9'] }, 'clamp'), '30');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', "'abc'"] }, 'clamp'), 'None');
        assert.equal(evaluateGenerated({ inputs: ['()', '0'] }, 'clamp'), 'None');
        assert.equal(evaluateGenerated({ inputs: ['7', '0'] }, 'clamp'), 'None');
    });

    it('wraps out-of-range positions', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '3'] }, 'wrap'), '10');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '4'] }, 'wrap'), '20');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '8'] }, 'wrap'), '30');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '-1'] }, 'wrap'), '30');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '-4'] }, 'wrap'), '30');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', "'abc'"] }, 'wrap'), 'None');
        assert.equal(evaluateGenerated({ inputs: ['()', '0'] }, 'wrap'), 'None');
    });

    it('ignores the retained default connector in clamp and wrap mode', () => {
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '5', '99'] }, 'clamp'), '30');
        assert.equal(evaluateGenerated({ inputs: ['(10, 20, 30)', '5', '99'] }, 'wrap'), '30');
    });
});

/**
 * Add the shipped tuple-select node to a graph.
 * @param {NodeGraph} graph - Target graph.
 * @param {object} controlValues - Initial control values.
 * @returns {object} The added node.
 */
function addTupleSelect(graph, controlValues = {}) {
    const definition = loadDefinition();
    return graph.addNode({
        id: TYPE_ID,
        type: TYPE_ID,
        inputs: definition.inputs.map((input) => ({ ...input })),
        outputs: definition.outputs.map((output) => ({ ...output })),
        controls: (definition.controls || []).map((control) => ({ ...control })),
        controlValues,
    });
}

/**
 * Add a single-output source node with one declared output type.
 * @param {NodeGraph} graph - Target graph.
 * @param {string} id - Node id.
 * @param {string} outputType - Declared output type.
 * @returns {object} The added node.
 */
function addTypedSource(graph, id, outputType) {
    return graph.addNode({
        id,
        type: 'source',
        outputs: [{ id: 'out0', outputType }],
    });
}

describe('core tuple-select connector typing', () => {
    it('accepts core.tuple and rejects scalars on the tuple input', () => {
        const graph = new NodeGraph({ id: 'graph-tuple-select-tuple-input' });
        const select = addTupleSelect(graph);

        const tupleSource = addTypedSource(graph, 'tuple-source', 'core.tuple');
        assert.equal(graph.canConnect(tupleSource.id, 0, select.id, 0).valid, true);

        const stringSource = addTypedSource(graph, 'string-source', 'string');
        const rejection = graph.canConnect(stringSource.id, 0, select.id, 0);
        assert.equal(rejection.valid, false);
        assert.match(rejection.message, /core\.tuple/);
    });

    it('accepts int and float indices and rejects other types', () => {
        const graph = new NodeGraph({ id: 'graph-tuple-select-index-input' });
        const select = addTupleSelect(graph);

        const intSource = addTypedSource(graph, 'int-source', 'int');
        const floatSource = addTypedSource(graph, 'float-source', 'float');
        const stringSource = addTypedSource(graph, 'string-source', 'string');

        assert.equal(graph.canConnect(intSource.id, 0, select.id, 1).valid, true);
        assert.equal(graph.canConnect(floatSource.id, 0, select.id, 1).valid, true);
        assert.equal(graph.canConnect(stringSource.id, 0, select.id, 1).valid, false);
    });

    it('resolves the value output as any and stays connectable', () => {
        const graph = new NodeGraph({ id: 'graph-tuple-select-output' });
        const select = addTupleSelect(graph);

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['any']);

        const boolTarget = graph.addNode({
            id: 'bool-target',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['bool'] }],
        });
        assert.equal(graph.canConnect(select.id, 0, boolTarget.id, 0).valid, true);
    });
});

describe('core tuple-select visible inputs', () => {
    it('shows the tuple, index, and default connectors in default mode', () => {
        const graph = new NodeGraph({ id: 'graph-tuple-select-visible-default' });
        const node = addTupleSelect(graph, { indexMode: 'default' });
        const inputs = getVisibleInputEntries(node);

        assert.deepEqual(
            inputs.map((entry) => entry.entry.id),
            ['tuple', 'index', 'default']
        );
        assert.deepEqual(
            inputs.map((entry) => entry.index),
            [0, 1, 2]
        );
    });

    ['clamp', 'wrap'].forEach((mode) => {
        it(`hides the default connector in ${mode} mode`, () => {
            const graph = new NodeGraph({ id: `graph-tuple-select-visible-${mode}` });
            const node = addTupleSelect(graph, { indexMode: mode });
            const inputs = getVisibleInputEntries(node);

            assert.deepEqual(
                inputs.map((entry) => entry.entry.id),
                ['tuple', 'index']
            );
            assert.deepEqual(
                inputs.map((entry) => entry.index),
                [0, 1]
            );
        });
    });

    it('keeps the hidden connector in the node input list', () => {
        const graph = new NodeGraph({ id: 'graph-tuple-select-visible-retained' });
        const node = addTupleSelect(graph, { indexMode: 'clamp' });

        assert.deepEqual(
            node.inputs.map((input) => input.id),
            ['tuple', 'index', 'default']
        );
    });
});

