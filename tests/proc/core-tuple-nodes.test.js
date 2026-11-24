import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    getVisibleInputEntries,
    getVisibleOutputEntries,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';

const coreRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/core');
const definitionsPath = path.join(coreRoot, 'node_definitions.json');
const generatorsPath = path.join(coreRoot, 'node_generators.js');

const POSITION_COUNTS = [2, 3, 4, 5, 6, 7, 8];

const TUPLE_NODES = [
    {
        typeId: 'compose',
        titleEn: 'Compose',
        titleDe: 'Zusammensetzen',
        icon: 'icons/call_merge_24dp.svg',
        generator: 'composeNode',
    },
    {
        typeId: 'decompose',
        titleEn: 'Decompose',
        titleDe: 'Zerlegen',
        icon: 'icons/call_split_24dp.svg',
        generator: 'decomposeNode',
    },
];

/**
 * Load the shipped core tuple node definitions.
 * @returns {{compose: object, decompose: object}} Both definitions.
 */
function loadTupleDefinitions() {
    const nodeTypes = JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;
    return { compose: nodeTypes.compose, decompose: nodeTypes.decompose };
}

/**
 * Build the expected positional connector ids for one node family.
 * @param {number} count - Number of active positions.
 * @returns {string[]} Connector ids `item_1..item_<count>`.
 */
function expectedPositionIds(count) {
    return Array.from({ length: count }, (_, index) => `item_${index + 1}`);
}

/**
 * Map a label object to its two language values.
 * @param {object} value - Bilingual `{ en, de }` object.
 * @returns {string[]} English and German text.
 */
function languageValues(value) {
    return [value?.en, value?.de];
}

/**
 * Assert that a bilingual label carries non-empty English and German text.
 * @param {object} label - Bilingual label object.
 * @param {string} where - Failure context.
 * @returns {void}
 */
function assertBilingual(label, where) {
    const [en, de] = languageValues(label);
    assert.equal(typeof en, 'string', `${where} misses an English label`);
    assert.equal(typeof de, 'string', `${where} misses a German label`);
    assert.ok(en.trim().length > 0, `${where} has an empty English label`);
    assert.ok(de.trim().length > 0, `${where} has an empty German label`);
}

describe('core tuple node definitions', () => {
    it('defines both nodes as data-category code generators with icons', () => {
        const definitions = loadTupleDefinitions();

        TUPLE_NODES.forEach(({ typeId, titleEn, titleDe, icon, generator }) => {
            const definition = definitions[typeId];
            assert.ok(definition, `missing ${typeId} definition`);
            assert.deepEqual(definition.title, { en: titleEn, de: titleDe });
            assert.equal(definition.category, 'data');
            assert.equal(definition.color, '#4a6fa5');
            assert.equal(definition.shape, 'square');
            assert.equal(definition.icon, icon);
            assert.deepEqual(definition.implementations.python, {
                type: 'code-generator',
                value: `NodeCodeGenerators.${generator}`,
            });
            assertBilingual(definition.info, `${typeId} info`);
        });
    });

    it('labels every connector and control in both languages', () => {
        const definitions = loadTupleDefinitions();

        Object.entries(definitions).forEach(([typeId, definition]) => {
            definition.inputs.forEach((input) => {
                assertBilingual(input.name, `${typeId} input '${input.id}' name`);
                assertBilingual(input.description, `${typeId} input '${input.id}' description`);
            });
            definition.outputs.forEach((output) => {
                assertBilingual(output.name, `${typeId} output '${output.id}' name`);
                assertBilingual(output.description, `${typeId} output '${output.id}' description`);
            });
            definition.controls.forEach((control) => {
                assertBilingual(control.label, `${typeId} control '${control.id}' label`);
                assertBilingual(control.description, `${typeId} control '${control.id}' description`);
                control.options.forEach((option) => {
                    assertBilingual(option.label, `${typeId} option '${option.value}' label`);
                });
            });
        });
    });

    it('wires compose through core.tuple', () => {
        const { compose } = loadTupleDefinitions();

        assert.deepEqual(
            compose.inputs.map((input) => input.id),
            expectedPositionIds(8)
        );
        compose.inputs.forEach((input) => {
            assert.deepEqual(input.allowedTypes, ['any']);
            assert.deepEqual(input.initialTypes, ['any']);
            assert.equal(input.defaultControl, undefined);
        });

        const [tupleOutput] = compose.outputs;
        assert.equal(tupleOutput.id, 'tuple');
        assert.equal(tupleOutput.outputType, 'core.tuple');
        assert.deepEqual(tupleOutput.initialTypes, ['core.tuple']);
    });

    it('reads decompose from core.tuple into any outputs', () => {
        const { decompose } = loadTupleDefinitions();

        assert.deepEqual(
            decompose.inputs.map((input) => input.id),
            ['tuple']
        );
        assert.deepEqual(decompose.inputs[0].allowedTypes, ['core.tuple']);
        assert.deepEqual(decompose.inputs[0].initialTypes, ['core.tuple']);

        assert.deepEqual(
            decompose.outputs.map((output) => output.id),
            expectedPositionIds(8)
        );
        decompose.outputs.forEach((output) => {
            assert.equal(output.outputType, 'any');
            // A static output adopts initialTypes[0] as its live type, so the
            // heterogeneous element positions must not suggest a scalar type.
            assert.deepEqual(output.initialTypes, ['any']);
            assert.equal(output.typeInputSources, undefined);
        });
    });

    it('exposes one shared 2..8 positions dropdown defaulting to two', () => {
        const definitions = loadTupleDefinitions();

        Object.entries(definitions).forEach(([typeId, definition]) => {
            assert.equal(definition.controls.length, 1);
            const [count] = definition.controls;
            assert.equal(count.type, 'dropdown');
            assert.equal(count.id, 'count');
            assert.equal(count.default, 2);
            assert.deepEqual(
                count.options.map((option) => option.value),
                POSITION_COUNTS
            );
            assert.deepEqual(
                count.options.map((option) => option.label.en),
                POSITION_COUNTS.map(String)
            );
            assert.equal(
                typeId === 'compose' ? count.affectsInputs : count.affectsOutputs,
                true
            );
        });
    });

    it('activates exactly the selected positions', () => {
        const { compose, decompose } = loadTupleDefinitions();

        compose.controls[0].options.forEach((option) => {
            assert.deepEqual(option.activeInputs, expectedPositionIds(option.value));
            assert.equal(option.activeOutputs, undefined);
        });
        decompose.controls[0].options.forEach((option) => {
            assert.deepEqual(option.activeOutputs, expectedPositionIds(option.value));
            assert.equal(option.activeInputs, undefined);
        });

        assert.deepEqual(
            compose.controls[0].options.find((option) => option.value === 2).activeInputs,
            ['item_1', 'item_2']
        );
        assert.deepEqual(
            compose.controls[0].options.find((option) => option.value === 8).activeInputs,
            expectedPositionIds(8)
        );
    });
});

/**
 * Assert that a package icon is a single-line, themed 24dp SVG.
 * @param {string} icon - Package-relative icon path.
 * @param {string} where - Failure context.
 * @returns {void}
 */
function assertSingleLineThemedIcon(icon, where) {
    assert.ok(icon.endsWith('_24dp.svg'), `${where} icon must keep the _24dp suffix`);
    const iconPath = path.join(coreRoot, icon);
    assert.ok(existsSync(iconPath), `${where} icon ${icon} is missing`);

    const svg = readFileSync(iconPath, 'utf8');
    assert.equal(svg.trimEnd().split('\n').length, 1, `${icon} must stay a single line`);
    assert.match(svg, /fill="#e3e3e3"/, `${icon} misses the standard fill`);
    assert.match(svg, /viewBox="0 0 24 24"/, `${icon} must keep the 24x24 viewBox`);
}

describe('core tuple node icons', () => {
    TUPLE_NODES.forEach(({ typeId, icon }) => {
        it(`${typeId} ships a single-line themed 24dp icon`, () => {
            assertSingleLineThemedIcon(icon, typeId);
        });
    });

    it('tuple-select ships a single-line themed 24dp icon', () => {
        assertSingleLineThemedIcon('icons/format_list_numbered_24dp.svg', 'tuple-select');
    });

    it('does not reuse the select icon for either node', () => {
        TUPLE_NODES.forEach(({ typeId, icon }) => {
            assert.notEqual(icon, 'icons/arrow_split_24dp.svg', `${typeId} reuses the select icon`);
        });
        assert.notEqual(TUPLE_NODES[0].icon, TUPLE_NODES[1].icon);
    });
});

describe('core tuple node generators', () => {
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
        await import(`${url.href}?test=core-tuple-nodes`);
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
     * Build a generator context for one tuple node.
     * @param {object} overrides - Context fields to override.
     * @returns {object} Generator context.
     */
    function context(overrides = {}) {
        return {
            node: { id: 'compose', controlValues: { count: 2 } },
            inputs: ['a', 'b'],
            outputs: ['node_compose_out0'],
            outputsMeta: [{ id: 'tuple', connected: true }],
            helpers: {},
            ...overrides,
        };
    }

    it('registers both generators', () => {
        assert.equal(typeof globalThis.NodeCodeGenerators.composeNode, 'function');
        assert.equal(typeof globalThis.NodeCodeGenerators.decomposeNode, 'function');
    });

    it('composes two positions into a trailing-comma tuple literal', () => {
        const result = globalThis.NodeCodeGenerators.composeNode(context());

        assert.equal(result.statement, 'node_compose_out0 = (a, b,)');
        assert.deepEqual(result.outputs, ['node_compose_out0']);
    });

    it('composes all eight positions', () => {
        const result = globalThis.NodeCodeGenerators.composeNode(
            context({
                node: { id: 'compose', controlValues: { count: 8 } },
                inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
            })
        );

        assert.equal(result.statement, 'node_compose_out0 = (a, b, c, d, e, f, g, h,)');
        assert.deepEqual(result.outputs, ['node_compose_out0']);
    });

    it('composes empty or missing inputs as None', () => {
        const empty = globalThis.NodeCodeGenerators.composeNode(
            context({ inputs: ['', 'b'] })
        );
        assert.equal(empty.statement, 'node_compose_out0 = (None, b,)');

        const missing = globalThis.NodeCodeGenerators.composeNode(
            context({ node: { id: 'compose', controlValues: { count: 4 } }, inputs: ['a'] })
        );
        assert.equal(missing.statement, 'node_compose_out0 = (a, None, None, None,)');
    });

    it('coerces and clamps the compose position count to 2..8', () => {
        const tooLow = globalThis.NodeCodeGenerators.composeNode(
            context({ node: { id: 'compose', controlValues: { count: 1 } } })
        );
        assert.equal(tooLow.statement, 'node_compose_out0 = (a, b,)');

        const tooHigh = globalThis.NodeCodeGenerators.composeNode(
            context({
                node: { id: 'compose', controlValues: { count: 12 } },
                inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
            })
        );
        assert.equal(tooHigh.statement, 'node_compose_out0 = (a, b, c, d, e, f, g, h,)');

        const fractional = globalThis.NodeCodeGenerators.composeNode(
            context({
                node: { id: 'compose', controlValues: { count: '3.9' } },
                inputs: ['a', 'b', 'c'],
            })
        );
        assert.equal(fractional.statement, 'node_compose_out0 = (a, b, c,)');

        const missing = globalThis.NodeCodeGenerators.composeNode(
            context({ node: { id: 'compose', controlValues: {} } })
        );
        assert.equal(missing.statement, 'node_compose_out0 = (a, b,)');
    });

    it('skips an unconnected compose output', () => {
        const result = globalThis.NodeCodeGenerators.composeNode(
            context({ outputsMeta: [{ id: 'tuple', connected: false }] })
        );

        assert.equal(result.statement, '# compose output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('requires a node for compose', () => {
        assert.throws(
            () => globalThis.NodeCodeGenerators.composeNode({ inputs: [], outputs: [] }),
            /composeNode generator requires context\.node/
        );
    });

    /**
     * Build a decompose generator context.
     * @param {object} overrides - Context fields to override.
     * @returns {object} Generator context.
     */
    function decomposeContext(overrides = {}) {
        return {
            node: { id: 'decompose', controlValues: { count: 2 } },
            inputs: ['node_source_out0'],
            outputs: ['node_decompose_out0', 'node_decompose_out1'],
            outputsMeta: [
                { id: 'item_1', connected: true },
                { id: 'item_2', connected: true },
            ],
            helpers: {},
            ...overrides,
        };
    }

    /**
     * Render one guarded decompose read line.
     * @param {number} index - Zero-based tuple position.
     * @returns {string} Expected generated line.
     */
    function guardedRead(index) {
        return (
            `node_decompose_out${index} = ` +
            `_tuple_decompose[${index}] if isinstance(_tuple_decompose, tuple) ` +
            `and len(_tuple_decompose) > ${index} else None`
        );
    }

    it('decomposes two positions through one node-scoped temporary', () => {
        const result = globalThis.NodeCodeGenerators.decomposeNode(decomposeContext());

        assert.equal(
            result.statement,
            '_tuple_decompose = node_source_out0\n' +
                `${guardedRead(0)}\n${guardedRead(1)}`
        );
        assert.deepEqual(result.outputs, ['node_decompose_out0', 'node_decompose_out1']);
    });

    it('decomposes all eight positions', () => {
        const outputs = [];
        const outputsMeta = [];
        for (let index = 0; index < 8; index += 1) {
            outputs.push(`node_decompose_out${index}`);
            outputsMeta.push({ id: `item_${index + 1}`, connected: true });
        }

        const result = globalThis.NodeCodeGenerators.decomposeNode(
            decomposeContext({
                node: { id: 'decompose', controlValues: { count: 8 } },
                outputs,
                outputsMeta,
            })
        );

        const expectedLines = ['_tuple_decompose = node_source_out0'];
        for (let index = 0; index < 8; index += 1) {
            expectedLines.push(guardedRead(index));
        }

        assert.equal(result.statement, expectedLines.join('\n'));
        assert.deepEqual(result.outputs, outputs);
    });

    it('still emits the None temporary when the tuple input is missing', () => {
        const result = globalThis.NodeCodeGenerators.decomposeNode(
            decomposeContext({ inputs: [] })
        );

        assert.equal(
            result.statement,
            '_tuple_decompose = None\n' + `${guardedRead(0)}\n${guardedRead(1)}`
        );
    });

    it('skips unconnected decompose outputs', () => {
        const result = globalThis.NodeCodeGenerators.decomposeNode(
            decomposeContext({
                outputsMeta: [
                    { id: 'item_1', connected: false },
                    { id: 'item_2', connected: true },
                ],
            })
        );

        assert.equal(result.statement, '_tuple_decompose = node_source_out0\n' + guardedRead(1));
        assert.deepEqual(result.outputs, ['node_decompose_out1']);
    });

    it('ignores connected outputs beyond the selected position count', () => {
        const result = globalThis.NodeCodeGenerators.decomposeNode(
            decomposeContext({
                outputs: [
                    'node_decompose_out0',
                    'node_decompose_out1',
                    'node_decompose_out2',
                ],
                outputsMeta: [
                    { id: 'item_1', connected: true },
                    { id: 'item_2', connected: true },
                    { id: 'item_3', connected: true },
                ],
            })
        );

        assert.equal(
            result.statement,
            '_tuple_decompose = node_source_out0\n' +
                `${guardedRead(0)}\n${guardedRead(1)}`
        );
        assert.deepEqual(result.outputs, ['node_decompose_out0', 'node_decompose_out1']);
    });

    it('emits a comment when no decompose output is connected', () => {
        const result = globalThis.NodeCodeGenerators.decomposeNode(
            decomposeContext({
                outputsMeta: [
                    { id: 'item_1', connected: false },
                    { id: 'item_2', connected: false },
                ],
            })
        );

        assert.equal(result.statement, '# decompose output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('requires a node for decompose', () => {
        assert.throws(
            () => globalThis.NodeCodeGenerators.decomposeNode({ inputs: [], outputs: [] }),
            /decomposeNode generator requires context\.node/
        );
    });

    it('emits only MicroPython-safe tuple syntax', () => {
        const composed = globalThis.NodeCodeGenerators.composeNode(
            context({
                node: { id: 'compose', controlValues: { count: 8 } },
                inputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
            })
        );

        const outputs = [];
        const outputsMeta = [];
        for (let index = 0; index < 8; index += 1) {
            outputs.push(`node_decompose_out${index}`);
            outputsMeta.push({ id: `item_${index + 1}`, connected: true });
        }
        const decomposed = globalThis.NodeCodeGenerators.decomposeNode(
            decomposeContext({
                node: { id: 'decompose', controlValues: { count: 8 } },
                outputs,
                outputsMeta,
            })
        );

        const statements = `${composed.statement}\n${decomposed.statement}`;
        assert.doesNotMatch(statements, /\bmath\./);
        assert.doesNotMatch(statements, /\barray\b/);
        assert.doesNotMatch(statements, /\bimport\b/);
        assert.doesNotMatch(statements, /\btuple\(/);
        assert.match(statements, /isinstance\(_tuple_decompose, tuple\)/);
    });
});

/**
 * Add a shipped tuple node definition to a graph.
 * @param {NodeGraph} graph - Target graph.
 * @param {string} typeId - `compose` or `decompose`.
 * @param {object} controlValues - Initial control values.
 * @returns {object} The added node.
 */
function addTupleNode(graph, typeId, controlValues = { count: 2 }) {
    const definition = loadTupleDefinitions()[typeId];
    return graph.addNode({
        id: typeId,
        type: typeId,
        inputs: definition.inputs.map((input) => ({ ...input })),
        outputs: definition.outputs.map((output) => ({ ...output })),
        controls: definition.controls.map((control) => ({ ...control })),
        controlValues: { ...controlValues },
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

/**
 * Add a single-input target node with accepted input types.
 * @param {NodeGraph} graph - Target graph.
 * @param {string} id - Node id.
 * @param {string[]} allowedTypes - Accepted input types.
 * @returns {object} The added node.
 */
function addTypedTarget(graph, id, allowedTypes) {
    return graph.addNode({
        id,
        type: 'target',
        inputs: [{ id: 'in0', allowedTypes }],
    });
}

describe('core tuple node connectors', () => {
    it('shows only the selected compose positions', () => {
        const graph = new NodeGraph({ id: 'graph-compose-visibility' });
        const compose = addTupleNode(graph, 'compose');

        /**
         * Read the visible compose inputs for one position count.
         * @param {number} count - Selected position count.
         * @returns {object[]} Visible input entries.
         */
        function visibleInputs(count) {
            graph.updateNode(compose.id, { controlValues: { count } });
            return getVisibleInputEntries(graph.getNode(compose.id));
        }

        const two = visibleInputs(2);
        assert.deepEqual(
            two.map((entry) => entry.entry.id),
            ['item_1', 'item_2']
        );
        assert.deepEqual(
            two.map((entry) => entry.index),
            [0, 1]
        );

        const eight = visibleInputs(8);
        assert.deepEqual(
            eight.map((entry) => entry.entry.id),
            expectedPositionIds(8)
        );
        assert.deepEqual(
            eight.map((entry) => entry.index),
            [0, 1, 2, 3, 4, 5, 6, 7]
        );
    });

    it('shows only the selected decompose positions', () => {
        const graph = new NodeGraph({ id: 'graph-decompose-visibility' });
        const decompose = addTupleNode(graph, 'decompose');

        /**
         * Read the visible decompose outputs for one position count.
         * @param {number} count - Selected position count.
         * @returns {object[]} Visible output entries.
         */
        function visibleOutputs(count) {
            graph.updateNode(decompose.id, { controlValues: { count } });
            return getVisibleOutputEntries(graph.getNode(decompose.id));
        }

        const two = visibleOutputs(2);
        assert.deepEqual(
            two.map((entry) => entry.entry.id),
            ['item_1', 'item_2']
        );
        assert.deepEqual(
            two.map((entry) => entry.index),
            [0, 1]
        );

        const eight = visibleOutputs(8);
        assert.deepEqual(
            eight.map((entry) => entry.entry.id),
            expectedPositionIds(8)
        );
        assert.deepEqual(
            eight.map((entry) => entry.index),
            [0, 1, 2, 3, 4, 5, 6, 7]
        );
    });

    it('keeps core.tuple on compose and any on decompose', () => {
        const graph = new NodeGraph({ id: 'graph-tuple-typing' });
        const compose = addTupleNode(graph, 'compose');
        const decompose = addTupleNode(graph, 'decompose');

        assert.deepEqual(graph.getResolvedOutputTypes(compose.id, 0), ['core.tuple']);
        assert.equal(graph.canConnect(compose.id, 0, decompose.id, 0).valid, true);

        decompose.outputs.forEach((output, index) => {
            assert.equal(
                output.outputType,
                'any',
                `output '${output.id}' must not adopt a scalar live type`
            );
            assert.deepEqual(graph.getResolvedOutputTypes(decompose.id, index), ['any']);
        });

        const boolTarget = addTypedTarget(graph, 'bool-target', ['bool']);
        assert.equal(graph.canConnect(decompose.id, 0, boolTarget.id, 0).valid, true);

        const stringSource = addTypedSource(graph, 'string-source', 'string');
        const rejection = graph.canConnect(stringSource.id, 0, decompose.id, 0);
        assert.equal(rejection.valid, false);
        assert.match(rejection.message, /core\.tuple/);
    });
});
