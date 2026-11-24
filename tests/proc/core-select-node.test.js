import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    getVisibleInputEntries,
    getVisibleOutputEntries,
} from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';

const definitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const generatorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_generators.js'
);

const UNION_INITIAL_TYPES = ['bool', 'int', 'float', 'string', 'core.tuple'];

function loadSelectDefinition() {
    const nodeTypes = JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes;
    return { nodeTypes, select: nodeTypes.select };
}

describe('core select node definition', () => {
    it('declares the condition, true value and false value in order', () => {
        const { select } = loadSelectDefinition();
        assert.ok(select, 'missing select node');

        assert.deepEqual(
            select.inputs.map((input) => input.id),
            ['condition', 'trueValue', 'falseValue']
        );
        assert.deepEqual(
            select.outputs.map((output) => output.id),
            ['value']
        );
        assert.deepEqual(select.title, { en: 'Select', de: 'Auswahl' });
        assert.equal(select.category, 'logic');
        assert.equal(select.color, '#5e7bb0');
        assert.equal(select.shape, 'square');
        assert.equal(select.icon, 'icons/arrow_split_24dp.svg');
        assert.equal(select.implementations.python.type, 'code-generator');
        assert.equal(select.implementations.python.value, 'NodeCodeGenerators.selectNode');
    });

    it('drops the channels control and every per-channel connector', () => {
        const { select } = loadSelectDefinition();

        assert.equal(select.controls, undefined);
        assert.equal(
            select.inputs.some((input) => /_\d+$/.test(input.id)),
            false
        );
        assert.equal(
            select.outputs.some((output) => /_\d+$/.test(output.id)),
            false
        );
    });

    it('keeps the bool condition and the ON/OFF value defaults', () => {
        const { select } = loadSelectDefinition();
        const [condition, trueValue, falseValue] = select.inputs;

        assert.deepEqual(condition.allowedTypes, ['bool']);
        assert.equal(condition.defaultControl.type, 'checkbox');
        assert.equal(condition.defaultControl.default, true);

        assert.deepEqual(trueValue.allowedTypes, ['any']);
        assert.equal(trueValue.defaultControl.type, 'text');
        assert.equal(trueValue.defaultControl.default, 'ON');

        assert.deepEqual(falseValue.allowedTypes, ['any']);
        assert.equal(falseValue.defaultControl.type, 'text');
        assert.equal(falseValue.defaultControl.default, 'OFF');
    });

    it('names and describes the single value pair without channel wording', () => {
        const { select } = loadSelectDefinition();
        const [, trueValue, falseValue] = select.inputs;

        assert.deepEqual(trueValue.name, { en: 'True Value', de: 'Wahr-Wert' });
        assert.deepEqual(falseValue.name, { en: 'False Value', de: 'Falsch-Wert' });

        select.inputs.forEach((input) => {
            const wording = [
                input.name.en,
                input.name.de,
                input.description.en,
                input.description.de,
            ].join(' ');
            assert.doesNotMatch(
                wording,
                /channel|Kanal/i,
                `input '${input.id}' still mentions a channel`
            );
        });
    });

    it('types the value output as the union of both value inputs', () => {
        const { select } = loadSelectDefinition();
        const [output] = select.outputs;

        assert.equal(output.outputType, 'any');
        assert.deepEqual(output.initialTypes, UNION_INITIAL_TYPES);
        assert.deepEqual(output.typeInputSources, ['trueValue', 'falseValue']);
    });
});

describe('core select node generator', () => {
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
        await import(`${url.href}?test=core-select-node`);
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

    function context(overrides = {}) {
        return {
            node: { id: 'select', controlValues: {} },
            inputs: ['flag', 'ON', 'OFF'],
            outputs: ['node_select_out0'],
            outputsMeta: [{ id: 'value', connected: true }],
            helpers: {},
            ...overrides,
        };
    }

    it('registers the generator', () => {
        assert.equal(typeof globalThis.NodeCodeGenerators.selectNode, 'function');
    });

    it('emits one conditional expression', () => {
        const result = globalThis.NodeCodeGenerators.selectNode(context());

        assert.equal(result.statement, 'node_select_out0 = (ON) if bool(flag) else (OFF)');
        assert.deepEqual(result.outputs, ['node_select_out0']);
    });

    it('ignores stale extra outputsMeta entries and inputs beyond the value pair', () => {
        const result = globalThis.NodeCodeGenerators.selectNode(
            context({
                inputs: ['flag', 'A', 'B', 'C', 'D'],
                outputs: ['node_select_out0', 'node_select_out1'],
                outputsMeta: [
                    { id: 'value', connected: true },
                    { id: 'value_2', connected: true },
                ],
            })
        );

        assert.equal(result.statement, 'node_select_out0 = (A) if bool(flag) else (B)');
        assert.deepEqual(result.outputs, ['node_select_out0']);
    });

    it('falls back to None for empty value inputs and False for an empty condition', () => {
        const result = globalThis.NodeCodeGenerators.selectNode(
            context({ inputs: ['', '', ''] })
        );

        assert.equal(result.statement, 'node_select_out0 = (None) if bool(False) else (None)');
    });

    it('skips an unconnected output', () => {
        const result = globalThis.NodeCodeGenerators.selectNode(
            context({ outputsMeta: [{ id: 'value', connected: false }] })
        );

        assert.equal(result.statement, '# select output not connected');
        assert.deepEqual(result.outputs, []);
    });

    it('requires a node in the context', () => {
        assert.throws(
            () => globalThis.NodeCodeGenerators.selectNode({ inputs: [], outputs: [] }),
            /selectNode generator requires context\.node/
        );
    });
});


function addSelectNode(graph, id = 'select', definition = loadSelectDefinition().select) {
    return graph.addNode({
        id,
        type: 'core-select',
        inputs: (definition.inputs || []).map((input) => ({ ...input })),
        outputs: (definition.outputs || []).map((output) => ({ ...output })),
        controls: [],
        controlValues: {},
    });
}

function addTypedSource(graph, id, outputType) {
    return graph.addNode({
        id,
        type: 'source',
        outputs: [{ id: 'out0', outputType }],
    });
}

function addTypedTarget(graph, id, allowedTypes) {
    return graph.addNode({
        id,
        type: 'target',
        inputs: [{ id: 'in0', allowedTypes }],
    });
}

describe('core select union typing against the shipped definition', () => {
    it('connects anywhere while nothing is wired', () => {
        const graph = new NodeGraph({ id: 'graph-select' });
        const select = addSelectNode(graph);
        const target = addTypedTarget(graph, 'target', ['string']);

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['any']);
        assert.equal(graph.canConnect(select.id, 0, target.id, 0).valid, true);
    });

    it('keeps the declared representative type on the value output', () => {
        const graph = new NodeGraph({ id: 'graph-select-representative' });
        const select = addSelectNode(graph);
        const [output] = select.outputs;

        assert.equal(output.outputType, 'any', "output 'value' must not adopt initialTypes[0]");
        assert.equal(select.getOutputType(output.id), 'any');
    });

    it('refuses a string target when both value inputs carry bool', () => {
        const graph = new NodeGraph({ id: 'graph-select-bool' });
        const select = addSelectNode(graph);
        const boolSource = addTypedSource(graph, 'bool-source', 'bool');

        [1, 2].forEach((toIndex) => {
            graph.addConnection({
                fromNode: boolSource.id,
                fromIndex: 0,
                toNode: select.id,
                toIndex,
            });
        });

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['bool']);

        const boolTarget = addTypedTarget(graph, 'bool-target', ['bool']);
        assert.equal(graph.canConnect(select.id, 0, boolTarget.id, 0).valid, true);

        const stringTarget = addTypedTarget(graph, 'string-target', ['string']);
        const validation = graph.canConnect(select.id, 0, stringTarget.id, 0);
        assert.equal(validation.valid, false);
        assert.equal(
            validation.message,
            "Type mismatch: Cannot connect 'bool' to input accepting [string]"
        );
    });


    it('widens int and float members at a float input only', () => {
        const graph = new NodeGraph({ id: 'graph-select-numeric' });
        const select = addSelectNode(graph);
        const intSource = addTypedSource(graph, 'int-source', 'int');
        const floatSource = addTypedSource(graph, 'float-source', 'float');

        graph.addConnection({
            fromNode: intSource.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: 1,
        });
        graph.addConnection({
            fromNode: floatSource.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: 2,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['int', 'float']);

        const floatTarget = addTypedTarget(graph, 'float-target', ['float']);
        assert.equal(graph.canConnect(select.id, 0, floatTarget.id, 0).valid, true);

        const intTarget = addTypedTarget(graph, 'int-target', ['int']);
        assert.equal(graph.canConnect(select.id, 0, intTarget.id, 0).valid, false);
    });

    it('keeps a tuple and a scalar as separate union candidates', () => {
        const graph = new NodeGraph({ id: 'graph-select-tuple' });
        const select = addSelectNode(graph);
        const tupleSource = addTypedSource(graph, 'tuple-source', 'core.tuple');
        const floatSource = addTypedSource(graph, 'float-source', 'float');

        graph.addConnection({
            fromNode: tupleSource.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: 1,
        });
        graph.addConnection({
            fromNode: floatSource.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: 2,
        });

        assert.deepEqual(graph.getResolvedOutputTypes(select.id, 0), ['core.tuple', 'float']);
        assert.equal(select.getOutputType('value'), 'any');

        const bothTarget = addTypedTarget(graph, 'both-target', ['core.tuple', 'float']);
        assert.equal(graph.canConnect(select.id, 0, bothTarget.id, 0).valid, true);

        const tupleTarget = addTypedTarget(graph, 'tuple-target', ['core.tuple']);
        assert.equal(graph.canConnect(select.id, 0, tupleTarget.id, 0).valid, false);

        const floatTarget = addTypedTarget(graph, 'float-target', ['float']);
        assert.equal(graph.canConnect(select.id, 0, floatTarget.id, 0).valid, false);
    });

    it('falls back when a stale definition lost typeInputSources', () => {
        const stale = loadSelectDefinition().select;
        const staleOutputs = stale.outputs.map((output) => {
            const copy = { ...output };
            delete copy.typeInputSources;
            return copy;
        });

        const graph = new NodeGraph({ id: 'graph-select-stale' });
        const select = addSelectNode(graph, 'select', { ...stale, outputs: staleOutputs });
        const boolSource = addTypedSource(graph, 'bool-source', 'bool');

        graph.addConnection({
            fromNode: boolSource.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: 1,
        });

        // Without the declaration the graph normalizes the output to the first
        // `initialTypes` entry ("bool"); the point is that nothing throws and the
        // output type stays usable.
        const resolved = graph.getResolvedOutputTypes(select.id, 0);
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0], 'bool');

        const boolTarget = addTypedTarget(graph, 'bool-target', ['bool']);
        assert.equal(graph.canConnect(select.id, 0, boolTarget.id, 0).valid, true);
    });
});

describe('core select connector visibility', () => {
    it('shows exactly the three inputs and the one output', () => {
        const graph = new NodeGraph({ id: 'graph-select-visibility' });
        const select = addSelectNode(graph);
        const node = graph.getNode(select.id);

        const inputs = getVisibleInputEntries(node);
        assert.deepEqual(
            inputs.map((entry) => entry.entry.id),
            ['condition', 'trueValue', 'falseValue']
        );
        assert.deepEqual(
            inputs.map((entry) => entry.index),
            [0, 1, 2]
        );

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

