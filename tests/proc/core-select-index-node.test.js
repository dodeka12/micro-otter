import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const definitionsPath = path.join(coreRoot, 'node_definitions.json');
const generatorsPath = path.join(coreRoot, 'node_generators.js');

const TYPE_ID = 'select-index';
const OUTPUT_NAME = 'node_5_out0';

/**
 * Load the shipped select-index node definition.
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

describe('core select-index definition', () => {
    it('declares the shipped node metadata', () => {
        const definition = loadDefinition();

        assert.deepEqual(definition.title, { en: 'Select by Index', de: 'Auswahl nach Index' });
        assert.equal(definition.category, 'logic');
        assert.equal(definition.color, '#5e7bb0');
        assert.equal(definition.shape, 'square');
        assert.equal(definition.icon, 'icons/format_list_numbered_24dp.svg');
        assert.deepEqual(definition.implementations.python, {
            type: 'code-generator',
            value: 'NodeCodeGenerators.selectIndexNode',
        });
    });

    it('keeps the index connector at position 0 and the values at 1 to 8', () => {
        const definition = loadDefinition();

        assert.deepEqual(
            definition.inputs.map((input) => input.id),
            ['index', 'value_1', 'value_2', 'value_3', 'value_4', 'value_5', 'value_6', 'value_7', 'value_8']
        );
    });

    it('types the index as numeric and gives every value an integer default control', () => {
        const definition = loadDefinition();
        const [index, ...values] = definition.inputs;

        assert.deepEqual(index.allowedTypes, ['int', 'float']);
        assert.deepEqual(index.initialTypes, ['int', 'float']);

        const { label, ...numbers } = index.defaultControl;
        assert.deepEqual(numbers, { type: 'number', min: 0, max: 7, step: 1, default: 0 });
        assertBilingual(label, 'select-index index defaultControl label');

        values.forEach((input) => {
            assert.deepEqual(input.allowedTypes, ['any'], `${input.id} must accept any type`);
            assert.deepEqual(input.initialTypes, ['any'], `${input.id} must start as any`);

            const { label: valueLabel, ...valueNumbers } = input.defaultControl;
            assert.deepEqual(
                valueNumbers,
                { type: 'number', min: 0, max: 255, step: 1, default: 0 },
                `${input.id} must declare an integer default control`
            );
            assertBilingual(valueLabel, `select-index ${input.id} defaultControl label`);
        });
    });

    it('documents every connector in both languages', () => {
        const definition = loadDefinition();

        assertBilingual(definition.title, 'select-index title');
        assertBilingual(definition.info, 'select-index info');
        definition.inputs.forEach((input) => {
            assertBilingual(input.name, `${TYPE_ID} input '${input.id}' name`);
            assertBilingual(input.description, `${TYPE_ID} input '${input.id}' description`);
            assert.deepEqual(input.allowedTypes, input.initialTypes, `${input.id} type mismatch`);
        });
        definition.outputs.forEach((output) => {
            assertBilingual(output.name, `${TYPE_ID} output '${output.id}' name`);
            assertBilingual(output.description, `${TYPE_ID} output '${output.id}' description`);
        });
    });
});

describe('core select-index output and count control', () => {
    it('unions the eight value inputs into one any output', () => {
        const definition = loadDefinition();

        assert.equal(definition.outputs.length, 1);
        const [value] = definition.outputs;
        assert.equal(value.id, 'value');
        assert.equal(value.outputType, 'any');
        assert.deepEqual(value.initialTypes, ['bool', 'int', 'float', 'string', 'core.tuple']);
        assert.deepEqual(value.typeInputSources, [
            'value_1',
            'value_2',
            'value_3',
            'value_4',
            'value_5',
            'value_6',
            'value_7',
            'value_8',
        ]);
    });

    it('reveals two to eight values through one count dropdown', () => {
        const definition = loadDefinition();
        const inputIds = definition.inputs.map((input) => input.id);

        assert.equal(definition.controls.length, 1);
        const [count] = definition.controls;
        assert.equal(count.id, 'count');
        assert.equal(count.type, 'dropdown');
        assert.equal(count.affectsInputs, true);
        assert.equal(count.default, 2);
        assertBilingual(count.label, 'select-index count label');
        assert.deepEqual(
            count.options.map((option) => option.value),
            [2, 3, 4, 5, 6, 7, 8]
        );

        count.options.forEach((option) => {
            const expected = [
                'index',
                ...Array.from({ length: option.value }, (_, offset) => `value_${offset + 1}`),
            ];
            assert.deepEqual(option.activeInputs, expected, `option ${option.value} input list`);
            assert.ok(
                option.activeInputs.includes('index'),
                `option ${option.value} must keep the index connector`
            );
            option.activeInputs.forEach((inputId) => {
                assert.ok(
                    inputIds.includes(inputId),
                    `option ${option.value} names unknown '${inputId}'`
                );
            });
        });
    });
});

describe('core select-index generator', () => {
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
        await import(`${url.href}?test=core-select-index-node`);
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
     * Build a generator context for the select-index node.
     * @param {object} overrides - Context fields to override.
     * @returns {object} Generator context.
     */
    function context(overrides = {}) {
        return {
            node: { id: '5', controlValues: { count: 3 } },
            inputs: ['node_1_out0', 'node_2_out0', 'node_3_out0', 'node_4_out0'],
            outputs: [OUTPUT_NAME],
            outputsMeta: [{ id: 'value', connected: true }],
            helpers: {},
            ...overrides,
        };
    }

    /**
     * Render the expected select-index statement.
     * @param {object} options - Statement options.
     * @param {number} options.count - Active value count.
     * @param {string[]} options.inputs - Raw input references, index first.
     * @param {string} options.id - Node id used in the sanitized temp names.
     * @returns {string} Expected generated statement.
     */
    function expectedStatement({
        count = 3,
        inputs = ['node_1_out0', 'node_2_out0', 'node_3_out0', 'node_4_out0'],
        id = '5',
    } = {}) {
        const lines = [
            `_select_raw_${id} = ${inputs[0]}`,
            `_select_index_${id} = int(_select_raw_${id}) if ` +
                `isinstance(_select_raw_${id}, (int, float)) and -1 < _select_raw_${id} < ${count} else -1`,
            `${OUTPUT_NAME} = None`,
        ];
        for (let position = 0; position < count; position += 1) {
            lines.push(
                `${position === 0 ? 'if' : 'elif'} _select_index_${id} == ${position}:`,
                `    ${OUTPUT_NAME} = ${inputs[position + 1]}`
            );
        }
        return lines.join('\n');
    }

    it('registers the generator', () => {
        assert.equal(typeof globalThis.NodeCodeGenerators.selectIndexNode, 'function');
    });

    it('emits the guard, the None default and one branch per active value', () => {
        const result = globalThis.NodeCodeGenerators.selectIndexNode(context());

        assert.equal(result.statement, expectedStatement());
        assert.deepEqual(result.outputs, [OUTPUT_NAME]);
    });

    it('sanitizes the node id inside the temp names', () => {
        const result = globalThis.NodeCodeGenerators.selectIndexNode(
            context({ node: { id: 'flow/9', controlValues: { count: 3 } } })
        );

        assert.equal(result.statement, expectedStatement({ id: 'flow_9' }));
        assert.doesNotMatch(result.statement, /flow\/9/);
    });

    it('clamps the count dropdown to two through eight', () => {
        const cases = [
            [1, 2],
            [0, 2],
            [99, 8],
            ['x', 2],
            [4.7, 4],
        ];

        cases.forEach(([count, expected]) => {
            const { statement } = globalThis.NodeCodeGenerators.selectIndexNode(
                context({ node: { id: '5', controlValues: { count } } })
            );

            const guard = statement.match(/and -1 < _select_raw_5 < (\d+) else -1/);
            assert.equal(Number(guard[1]), expected, `count ${count} guard bound`);
            assert.equal(
                statement.match(/^(?:if|elif) /gm).length,
                expected,
                `count ${count} branch count`
            );
            assert.deepEqual(
                statement
                    .match(/^(?:if|elif) _select_index_5 == (\d+):/gm)
                    .map((line) => line.match(/== (\d+):/)[1]),
                Array.from({ length: expected }, (_, offset) => String(offset)),
                `count ${count} branch order`
            );
        });
    });

    it('never references a value input the count hides', () => {
        const { statement } = globalThis.NodeCodeGenerators.selectIndexNode(
            context({ node: { id: '5', controlValues: { count: 2 } } })
        );

        assert.doesNotMatch(statement, /node_4_out0/);
        assert.match(statement, /node_3_out0/);
    });

    it('falls back to index 0 and the integer default when the inputs are missing', () => {
        const result = globalThis.NodeCodeGenerators.selectIndexNode(context({ inputs: [] }));

        assert.equal(
            result.statement,
            expectedStatement({ inputs: ['0', '0', '0', '0'] })
        );
        assert.deepEqual(result.outputs, [OUTPUT_NAME]);
    });

    it('emits a comment when the value output is not connected', () => {
        const result = globalThis.NodeCodeGenerators.selectIndexNode(
            context({ outputsMeta: [{ id: 'value', connected: false }] })
        );

        assert.equal(result.statement, '# select-index output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('requires a node', () => {
        [null, {}].forEach((broken) => {
            assert.throws(
                () => globalThis.NodeCodeGenerators.selectIndexNode(broken),
                /selectIndexNode generator requires context\.node/
            );
        });
    });

    /**
     * Execute one generated select-index statement under CPython.
     * @param {object} overrides - Generator context overrides.
     * @returns {string} `repr()` of the generated output value.
     */
    function evaluateGenerated(overrides) {
        const result = globalThis.NodeCodeGenerators.selectIndexNode(context(overrides));
        assert.deepEqual(result.outputs, [OUTPUT_NAME]);

        const script = `${result.statement}\nprint(repr(${OUTPUT_NAME}))\n`;
        return execFileSync(process.env.PYTHON || 'python3', ['-c', script], {
            encoding: 'utf8',
            stdio: 'pipe',
        }).trim();
    }

    /**
     * Build a count-3 context whose value inputs are Python expressions.
     * @param {string} indexExpression - Python expression for the index input.
     * @param {string[]} values - Python expressions for value_1 … value_3.
     * @returns {object} Generator context overrides.
     */
    function withIndex(indexExpression, values = ['10', '20', '30']) {
        return { inputs: [indexExpression, ...values] };
    }

    describe('runtime semantics under CPython', () => {
        it('forwards the value at the given index', () => {
            assert.equal(evaluateGenerated(withIndex('0')), '10');
            assert.equal(evaluateGenerated(withIndex('1')), '20');
            assert.equal(evaluateGenerated(withIndex('2')), '30');
        });

        it('truncates fractional indices toward zero', () => {
            assert.equal(evaluateGenerated(withIndex('2.9')), '30');
            assert.equal(evaluateGenerated(withIndex('-0.5')), '10');
        });

        it('yields None outside the active range', () => {
            assert.equal(evaluateGenerated(withIndex('-1')), 'None');
            assert.equal(evaluateGenerated(withIndex('3')), 'None');
        });

        it('yields None for non-numeric and non-finite indices without raising', () => {
            assert.equal(evaluateGenerated(withIndex('None')), 'None');
            assert.equal(evaluateGenerated(withIndex("'1'")), 'None');
            assert.equal(evaluateGenerated(withIndex("float('nan')")), 'None');
            assert.equal(evaluateGenerated(withIndex("float('inf')")), 'None');
        });

        it('forwards the integer default for an active but unconnected value', () => {
            assert.equal(evaluateGenerated(withIndex('1', ['10', '0', '30'])), '0');
            assert.equal(
                evaluateGenerated({ inputs: ['1', '10', undefined, '30'] }),
                '0',
                'the generator fallback must match the integer default control'
            );
        });

        it('runs the unconnected output statement as a no-op comment', () => {
            const { statement } = globalThis.NodeCodeGenerators.selectIndexNode(
                context({ outputsMeta: [{ id: 'value', connected: false }] })
            );

            const output = execFileSync(
                process.env.PYTHON || 'python3',
                ['-c', `${statement}\nprint('ok')\n`],
                { encoding: 'utf8', stdio: 'pipe' }
            ).trim();
            assert.equal(output, 'ok');
        });
    });
});


