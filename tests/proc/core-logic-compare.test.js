import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nodeDefinitionsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
);
const coreGeneratorsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/core/node_generators.js'
);

function loadCoreDefinitions() {
    return JSON.parse(readFileSync(nodeDefinitionsPath, 'utf8'));
}

describe('core node definitions - compare and logic nodes', () => {
    it('defines compare and logic with expected operators and ports', () => {
        const definitions = loadCoreDefinitions();
        const nodeTypes = definitions?.nodeTypes || {};

        assert.ok(nodeTypes.compare, 'Missing compare node definition');
        assert.ok(nodeTypes.logic, 'Missing logic node definition');
        assert.equal(nodeTypes['branching-node'], undefined, 'branching-node must be removed');

        const compareOps =
            nodeTypes.compare.controls
                ?.find((control) => control.id === 'operation')
                ?.options?.map((option) => option.value) || [];
        assert.deepEqual(compareOps, [
            'less_than',
            'less_than_equal',
            'equal',
            'greater_than',
            'greater_than_equal',
        ]);

        const compareInputDefaults = (nodeTypes.compare.inputs || []).map(
            (input) => input.defaultControl?.type
        );
        assert.deepEqual(compareInputDefaults, ['number', 'number']);

        const logicOps =
            nodeTypes.logic.controls
                ?.find((control) => control.id === 'operation')
                ?.options?.map((option) => option.value) || [];
        assert.deepEqual(logicOps, ['and', 'or', 'not', 'nor', 'nand', 'xor']);

        const logicInputDefaultControls = (nodeTypes.logic.inputs || []).map(
            (input) => input.defaultControl?.type
        );
        assert.deepEqual(logicInputDefaultControls, ['dropdown', 'dropdown']);

        const logicInputDefaultOptions = (nodeTypes.logic.inputs || []).map((input) =>
            (input.defaultControl?.options || []).map((option) => option.value)
        );
        assert.deepEqual(logicInputDefaultOptions, [
            [true, false],
            [true, false],
        ]);
    });

    it('defines constant node selectable data type controls and dynamic output type mapping', () => {
        const definitions = loadCoreDefinitions();
        const constNode = definitions?.nodeTypes?.const;
        assert.ok(constNode, 'Missing const node definition');

        const controls = constNode.controls || [];
        const valueTypeControl = controls.find((control) => control.id === 'valueType');
        assert.ok(valueTypeControl, 'Missing const valueType dropdown');

        const typeOptions = (valueTypeControl.options || []).map((option) => option.value);
        assert.deepEqual(typeOptions, ['float', 'int', 'bool', 'string']);

        const output = constNode.outputs?.[0];
        assert.equal(output.outputType, 'float');
        assert.deepEqual(output.initialTypes, ['float']);

        const optionOutputTypesByValue = Object.fromEntries(
            (valueTypeControl.options || []).map((option) => [
                option.value,
                option.outputTypes?.out0 || null,
            ])
        );
        assert.deepEqual(optionOutputTypesByValue, {
            float: ['float'],
            int: ['int'],
            bool: ['bool'],
            string: ['string'],
        });

        const valueControlIds = ['floatValue', 'intValue', 'boolValue', 'stringValue'];
        valueControlIds.forEach((controlId) => {
            const valueControl = controls.find((control) => control.id === controlId);
            assert.ok(valueControl, `Missing const ${controlId} control`);
            assert.equal(
                valueControl.layout,
                'stacked',
                `Expected const ${controlId} layout to be stacked`
            );
        });
    });
});

describe('core node generators - compare and logic nodes', () => {
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

        const generatorUrl = pathToFileURL(coreGeneratorsPath);
        await import(`${generatorUrl.href}?test=core-logic-compare`);
    });

    after(() => {
        if (originalSelf === undefined) {
            delete globalThis.self;
        } else {
            globalThis.self = originalSelf;
        }

        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }

        if (originalNodeCodeGenerators === undefined) {
            delete globalThis.NodeCodeGenerators;
        } else {
            globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        }

        if (originalNodeInitGenerators === undefined) {
            delete globalThis.NodeInitGenerators;
        } else {
            globalThis.NodeInitGenerators = originalNodeInitGenerators;
        }
    });

    it('emits compare statement using epsilon for equality', () => {
        const generator = globalThis.NodeCodeGenerators.compareNode;
        assert.equal(globalThis.NodeCodeGenerators.branchingNode, undefined);
        const result = generator({
            inputs: ['left_value', 'right_value'],
            outputs: ['compare_out'],
            outputsMeta: [{ connected: true }],
            node: {
                controlValues: {
                    operation: 'equal',
                    epsilon: 0.25,
                },
            },
        });

        assert.match(result.statement, /abs\(\(left_value\) - \(right_value\)\) <= \(0.25\)/);
        assert.deepEqual(result.outputs, ['compare_out']);
    });

    it('emits unary and binary logic statements', () => {
        const generator = globalThis.NodeCodeGenerators.logicNode;

        const notResult = generator({
            inputs: ['flag'],
            outputs: ['logic_out'],
            outputsMeta: [{ connected: true }],
            node: { controlValues: { operation: 'not' } },
        });
        assert.equal(notResult.statement, 'logic_out = (not bool(flag))');

        const xorResult = generator({
            inputs: ['a', 'b'],
            outputs: ['logic_out'],
            outputsMeta: [{ connected: true }],
            node: { controlValues: { operation: 'xor' } },
        });
        assert.equal(xorResult.statement, 'logic_out = (bool(a) != bool(b))');
    });
});
