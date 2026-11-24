import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { getVisibleControls, getVisibleInputs } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';

const defsPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/vars/node_definitions.json');

function loadNodeTypes() {
    return JSON.parse(readFileSync(defsPath, 'utf8')).nodeTypes;
}

function operationOption(math, value) {
    const operation = math.controls.find((control) => control.id === 'operation');
    const option = operation.options.find((candidate) => candidate.value === value);
    assert.ok(option, `missing array-math operation option ${value}`);
    return option;
}

function indexModeOptions(select) {
    const control = select.controls.find((candidate) => candidate.id === 'indexMode');
    assert.ok(control, 'missing indexMode control');
    return control.options.map((option) => [option.value, option.activeInputs]);
}

describe('vars node definitions', () => {
    it('defines var-read and var-write without var-declare', () => {
        const nodeTypes = loadNodeTypes();
        assert.ok(nodeTypes['var-read']);
        assert.ok(nodeTypes['var-write']);
        assert.equal(nodeTypes['var-declare'], undefined);
        assert.equal(nodeTypes['var-read'].implementations.python.type, 'code-generator');
        assert.equal(nodeTypes['var-write'].implementations.python.type, 'code-generator');
    });

    it('varRead exposes a store string input, a fallback value input, and a name picker', () => {
        const read = loadNodeTypes()['var-read'];
        assert.equal(read.outputs[0].outputType, 'any');
        assert.deepEqual(read.outputs[0].initialTypes, ['any']);
        assert.deepEqual(
            read.inputs.map((input) => input.id),
            ['store', 'value']
        );
        assert.deepEqual(read.inputs[0].allowedTypes, ['string']);
        assert.equal(read.inputs[0].defaultControl.type, 'dropdown');
        assert.equal(read.inputs[0].defaultControl.default, 'default');
        assert.ok(read.inputs[1].allowedTypes.includes('vars.array'));
        assert.deepEqual(
            read.controls.map((control) => control.id),
            ['name', 'customStore', 'customName']
        );
    });

    it('var-write exposes a store string input, a value input, and a name picker', () => {
        const write = loadNodeTypes()['var-write'];
        assert.deepEqual(
            write.inputs.map((input) => input.id),
            ['enabled', 'store', 'value']
        );
        assert.deepEqual(write.inputs[1].allowedTypes, ['string']);
        assert.equal(write.inputs[1].defaultControl.type, 'dropdown');
        assert.equal(write.inputs[1].defaultControl.default, 'default');
        assert.ok(write.inputs[2].allowedTypes.includes('vars.array'));
        assert.deepEqual(
            write.controls.map((control) => control.id),
            ['name', 'customStore', 'customName']
        );
    });

    it('labels the name picker as use-or-declare for var-read and var-write', () => {
        for (const id of ['var-read', 'var-write']) {
            const node = loadNodeTypes()[id];
            const name = node.controls.find((control) => control.id === 'name');
            const customName = node.controls.find((control) => control.id === 'customName');

            assert.equal(
                name.description.en,
                'Use an existing variable of the selected store, or declare a new one.'
            );
            assert.equal(name.dynamicOptions.newLabel.en, 'Declare variable\u2026');
            assert.equal(customName.label.en, 'Variable name');
            assert.equal(
                customName.description.en,
                'Name of the variable this node declares, used when \u201cDeclare variable\u2026\u201d is selected above.'
            );
        }
    });

    it('defines var-store-save and var-store-load with bool trigger + string name inputs', () => {
        const nodeTypes = loadNodeTypes();
        for (const id of ['var-store-save', 'var-store-load']) {
            assert.ok(nodeTypes[id], `missing ${id}`);
            assert.equal(nodeTypes[id].implementations.python.type, 'code-generator');
            assert.deepEqual(nodeTypes[id].outputs, []);
            assert.deepEqual(
                nodeTypes[id].inputs.map((input) => input.id),
                id === 'var-store-save' ? ['enabled', 'save', 'name'] : ['load', 'name']
            );
            const inputs = nodeTypes[id].inputs;
            assert.equal(inputs[0].allowedTypes[0], 'bool');
            if (id === 'var-store-save') {
                assert.equal(inputs[1].allowedTypes[0], 'bool');
            }
            const nameIndex = id === 'var-store-save' ? 2 : 1;
            assert.equal(inputs[nameIndex].allowedTypes[0], 'string');
            assert.equal(inputs[nameIndex].defaultControl.default, 'default');
        }
    });

    it('leads the variable writes with a bool enabled gate', () => {
        const nodeTypes = loadNodeTypes();
        for (const id of ['var-write', 'var-store-save']) {
            const inputs = nodeTypes[id].inputs;
            const enabled = inputs[0];
            assert.equal(enabled.id, 'enabled', `${id} enabled id`);
            assert.deepEqual(enabled.allowedTypes, ['bool']);
            assert.deepEqual(enabled.initialTypes, ['bool']);
            assert.equal(enabled.defaultControl.type, 'checkbox');
            assert.equal(enabled.defaultControl.default, true);
            assert.ok(enabled.description.en.length > 0);
            assert.ok(enabled.description.de.length > 0);
        }
        assert.deepEqual(
            nodeTypes['var-read'].inputs.map((input) => input.id),
            ['store', 'value']
        );
        assert.deepEqual(
            nodeTypes['var-store-load'].inputs.map((input) => input.id),
            ['load', 'name']
        );
    });

    it('defines the general array nodes with vars.array outputs and clamp default false', () => {
        const nodeTypes = loadNodeTypes();
        for (const id of ['array-generate', 'array-math', 'array-modify']) {
            assert.ok(nodeTypes[id], `missing ${id}`);
            assert.equal(nodeTypes[id].implementations.python.type, 'code-generator');
        }
        assert.equal(nodeTypes['array-shift'], undefined);
        assert.equal(nodeTypes['array-math'].outputs[0].outputType, 'vars.array');
        for (const id of ['array-math', 'array-modify']) {
            const clamp = nodeTypes[id].controls.find((control) => control.id === 'clamp');
            assert.equal(clamp.default, false);
        }
    });

    it('array-math inputs accept float, int, bool and array operands with matching initialTypes', () => {
        const math = loadNodeTypes()['array-math'];
        for (const input of math.inputs) {
            assert.deepEqual(input.allowedTypes, ['float', 'int', 'bool', 'vars.array']);
            assert.deepEqual(input.initialTypes, input.allowedTypes);
        }
        assert.equal(math.outputs[0].outputType, 'vars.array');
    });

    it('keeps every array-math input type after adding the node to a graph', () => {
        const def = loadNodeTypes()['array-math'];
        const graph = new NodeGraph({ id: 'graph-array-math-types' });

        const node = graph.addNode({
            id: 'math',
            type: 'vars.array-math',
            inputs: JSON.parse(JSON.stringify(def.inputs)),
            outputs: JSON.parse(JSON.stringify(def.outputs)),
            controls: JSON.parse(JSON.stringify(def.controls)),
        });

        assert.deepEqual(node.getInputAllowedTypes('a'), ['float', 'int', 'bool', 'vars.array']);
        assert.deepEqual(node.getInputAllowedTypes('b'), ['float', 'int', 'bool', 'vars.array']);

        const source = graph.addNode({
            id: 'source',
            type: 'vars.array-source',
            outputs: [{ id: 'out', outputType: 'vars.array' }],
        });

        assert.equal(graph.canConnect(source.id, 0, node.id, 0).valid, true);
        assert.equal(graph.canConnect(source.id, 0, node.id, 1).valid, true);
    });

    it('array-math exposes the full operation set with visibility metadata', () => {
        const math = loadNodeTypes()['array-math'];
        const operation = math.controls.find((control) => control.id === 'operation');
        assert.equal(operation.affectsInputs, true);
        assert.equal(operation.affectsControls, true);
        assert.equal(operation.default, 'add');
        assert.deepEqual(
            operation.options.map((option) => option.value),
            [
                'add',
                'subtract',
                'multiply',
                'divide',
                'modulus',
                'power',
                'root',
                'sqrt',
                'square',
                'fraction',
                'exp',
                'ln',
                'log',
                'floor',
                'ceil',
                'round',
                'sin',
                'cos',
                'tan',
                'asin',
                'acos',
                'atan',
                'atan2',
                'sinh',
                'cosh',
                'tanh',
                'asinh',
                'acosh',
                'atanh',
                'length',
                'min',
                'max',
                'mean',
                'median',
            ]
        );

        for (const value of [
            'add',
            'subtract',
            'multiply',
            'divide',
            'modulus',
            'power',
            'root',
            'log',
            'atan2',
        ]) {
            assert.deepEqual(
                operationOption(math, value).activeInputs,
                ['a', 'b'],
                `wrong inputs for ${value}`
            );
        }
        for (const value of [
            'sqrt',
            'square',
            'fraction',
            'exp',
            'ln',
            'floor',
            'ceil',
            'round',
            'sin',
            'cos',
            'tan',
            'asin',
            'acos',
            'atan',
            'sinh',
            'cosh',
            'tanh',
            'asinh',
            'acosh',
            'atanh',
            'length',
            'min',
            'max',
            'mean',
            'median',
        ]) {
            assert.deepEqual(
                operationOption(math, value).activeInputs,
                ['a'],
                `wrong inputs for ${value}`
            );
        }

        for (const value of [
            'add',
            'subtract',
            'multiply',
            'divide',
            'modulus',
            'power',
            'root',
            'log',
            'sqrt',
            'square',
            'fraction',
            'exp',
            'ln',
            'floor',
            'ceil',
            'sinh',
            'cosh',
            'tanh',
            'asinh',
            'acosh',
            'atanh',
        ]) {
            assert.deepEqual(
                operationOption(math, value).activeControls,
                ['clamp'],
                `wrong controls for ${value}`
            );
        }
        assert.deepEqual(
            operationOption(math, 'round').activeControls,
            ['clamp', 'decimalPlaces'],
            'round must expose the decimal places control next to clamp'
        );
        assert.deepEqual(
            operationOption(math, 'length').activeControls,
            [],
            'length must not expose optional controls'
        );
        for (const value of ['min', 'max']) {
            assert.deepEqual(
                operationOption(math, value).activeControls,
                ['clamp', 'percent'],
                `${value} must expose the percent control next to clamp`
            );
        }
        for (const value of ['mean', 'median']) {
            assert.deepEqual(
                operationOption(math, value).activeControls,
                ['clamp'],
                `${value} must expose clamp`
            );
        }
        for (const value of ['length', 'min', 'max', 'mean', 'median']) {
            assert.deepEqual(
                operationOption(math, value).activeInputs,
                ['a'],
                `${value} must hide the second operand`
            );
        }
        assert.deepEqual(operationOption(math, 'length').outputTypes, { out: ['int'] });
        for (const value of ['min', 'max', 'mean', 'median']) {
            assert.deepEqual(
                operationOption(math, value).outputTypes,
                { out: ['float'] },
                `${value} must report a float output`
            );
        }
        for (const value of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2']) {
            assert.deepEqual(
                operationOption(math, value).activeControls,
                ['clamp', 'angleUnit'],
                `wrong controls for ${value}`
            );
        }
        for (const value of ['sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']) {
            assert.ok(
                !operationOption(math, value).activeControls.includes('angleUnit'),
                `${value} must not expose the angle unit control`
            );
        }
        for (const value of [
            'sin',
            'cos',
            'tan',
            'asin',
            'acos',
            'atan',
            'atan2',
            'sinh',
            'cosh',
            'tanh',
            'asinh',
            'acosh',
            'atanh',
        ]) {
            assert.equal(
                operationOption(math, value).label.en,
                value,
                `${value} must use the English shorthand label`
            );
            assert.equal(
                operationOption(math, value).label.de,
                value,
                `${value} must use the German shorthand label`
            );
        }
    });

    it('array-math exposes an angleUnit dropdown that defaults to degrees', () => {
        const math = loadNodeTypes()['array-math'];
        assert.deepEqual(
            math.controls.map((control) => control.id),
            ['operation', 'angleUnit', 'decimalPlaces', 'percent', 'clamp']
        );

        const angleUnit = math.controls.find((control) => control.id === 'angleUnit');
        assert.equal(angleUnit.type, 'dropdown');
        assert.equal(angleUnit.default, 'degrees');
        assert.deepEqual(
            angleUnit.options.map((option) => option.value),
            ['degrees', 'radians', 'percent']
        );
        assert.deepEqual(
            angleUnit.options.map((option) => option.label.en),
            ['Degrees', 'Radians', 'Percent (0-1)']
        );
        assert.equal(angleUnit.label.en, 'Angle Unit');
        assert.equal(angleUnit.label.de, 'Winkeleinheit');
        assert.equal(angleUnit.description.en, 'Unit for trigonometric operations.');
        assert.equal(angleUnit.description.de, 'Einheit für trigonometrische Operationen.');
    });

    it('array-math exposes a decimalPlaces number control for the round operation', () => {
        const math = loadNodeTypes()['array-math'];
        const decimalPlaces = math.controls.find((control) => control.id === 'decimalPlaces');

        assert.ok(decimalPlaces, 'missing decimalPlaces control on array-math');
        assert.equal(decimalPlaces.type, 'number');
        assert.equal(decimalPlaces.default, 0);
        assert.equal(decimalPlaces.min, 0);
        assert.equal(decimalPlaces.max, 6);
        assert.equal(decimalPlaces.step, 1);
        assert.equal(decimalPlaces.label.en, 'Decimal Places');
        assert.equal(decimalPlaces.label.de, 'Dezimalstellen');
        assert.equal(
            decimalPlaces.description.en,
            'Number of decimal places kept by the Round operation.'
        );
        assert.equal(
            decimalPlaces.description.de,
            'Anzahl der Nachkommastellen, die die Operation Runden behält.'
        );
    });

    it('array-math exposes a percent number control for min and max', () => {
        const math = loadNodeTypes()['array-math'];
        const percent = math.controls.find((control) => control.id === 'percent');

        assert.ok(percent, 'missing percent control on array-math');
        assert.equal(percent.type, 'number');
        assert.equal(percent.default, 100);
        assert.equal(percent.min, 0);
        assert.equal(percent.max, 100);
        assert.equal(percent.step, 1);
        assert.equal(percent.label.en, 'Percent');
        assert.equal(percent.label.de, 'Prozent');
        assert.equal(
            percent.description.en,
            'Portion of the array used by Minimum/Maximum; 100 uses the full array and 0 selects one element.'
        );
        assert.equal(
            percent.description.de,
            'Anteil des Arrays, den Minimum/Maximum verwendet; 100 nutzt das ganze Array und 0 wählt ein Element.'
        );
    });

    it('array-math reductions reveal only input a and retype the output dynamically', () => {
        const math = loadNodeTypes()['array-math'];
        const cases = [
            ['length', ['a'], ['operation'], { out: ['int'] }],
            ['min', ['a'], ['operation', 'percent', 'clamp'], { out: ['float'] }],
            ['max', ['a'], ['operation', 'percent', 'clamp'], { out: ['float'] }],
            ['mean', ['a'], ['operation', 'clamp'], { out: ['float'] }],
            ['median', ['a'], ['operation', 'clamp'], { out: ['float'] }],
        ];

        for (const [operation, expectedInputs, expectedControls, expectedOutputTypes] of cases) {
            const nodeData = {
                inputs: math.inputs,
                controls: math.controls,
                controlValues: { operation },
            };
            assert.deepEqual(
                getVisibleInputs(nodeData).map((input) => input.id),
                expectedInputs,
                `visible inputs for ${operation}`
            );
            assert.deepEqual(
                getVisibleControls(nodeData).map((control) => control.id),
                expectedControls,
                `visible controls for ${operation}`
            );
            assert.deepEqual(
                operationOption(math, operation).outputTypes,
                expectedOutputTypes,
                `output types for ${operation}`
            );
        }

        const graph = new NodeGraph({ id: 'graph-array-math-reduction-types' });
        const node = graph.addNode({
            id: 'math',
            type: 'vars.array-math',
            inputs: JSON.parse(JSON.stringify(math.inputs)),
            outputs: JSON.parse(JSON.stringify(math.outputs)),
            controls: JSON.parse(JSON.stringify(math.controls)),
        });

        assert.equal(node.getOutputType('out'), 'vars.array');
        graph.updateNode(node.id, { controlValues: { operation: 'length' } });
        assert.equal(graph.getNode(node.id).getOutputType('out'), 'int');
        for (const operation of ['min', 'max', 'mean', 'median']) {
            graph.updateNode(node.id, { controlValues: { operation } });
            assert.equal(
                graph.getNode(node.id).getOutputType('out'),
                'float',
                `${operation} must report a float output`
            );
        }
        graph.updateNode(node.id, { controlValues: { operation: 'add' } });
        assert.equal(graph.getNode(node.id).getOutputType('out'), 'vars.array');
    });

    it('array-generate exposes only a count input and a buffer init implementation', () => {
        const generate = loadNodeTypes()['array-generate'];
        assert.deepEqual(
            generate.inputs.map((input) => input.id),
            ['count']
        );
        assert.equal(generate.outputs[0].outputType, 'vars.array');
        assert.deepEqual(generate.controls, []);
        assert.equal(generate.initImplementations.python.value, 'NodeInitGenerators.arrayGenerate');
    });

    it('array-modify exposes five modes with their inputs and controls', () => {
        const modify = loadNodeTypes()['array-modify'];
        assert.deepEqual(
            modify.inputs.map((input) => input.id),
            ['in', 'amount', 'other', 'count', 'step', 'offset']
        );
        const inputs = Object.fromEntries(modify.inputs.map((input) => [input.id, input]));
        assert.deepEqual(inputs.other.allowedTypes, ['vars.array']);
        assert.deepEqual(inputs.other.initialTypes, ['vars.array']);
        assert.deepEqual(inputs.other.name, { en: 'Other Array', de: 'Zweites Array' });
        assert.equal(inputs.other.defaultControl, undefined);
        for (const id of ['count', 'step', 'offset']) {
            assert.deepEqual(inputs[id].allowedTypes, ['float', 'int'], `allowedTypes for ${id}`);
            assert.equal(inputs[id].defaultControl.type, 'number', `defaultControl type for ${id}`);
            for (const locale of ['en', 'de']) {
                assert.ok(
                    inputs[id].defaultControl.label[locale],
                    `missing ${locale} defaultControl label for ${id}`
                );
                assert.ok(inputs[id].name[locale], `missing ${locale} name for ${id}`);
                assert.ok(inputs[id].description[locale], `missing ${locale} description for ${id}`);
            }
        }
        assert.deepEqual(
            {
                min: inputs.count.defaultControl.min,
                max: inputs.count.defaultControl.max,
                step: inputs.count.defaultControl.step,
                default: inputs.count.defaultControl.default,
            },
            { min: 0, max: 1000, step: 1, default: 1 }
        );
        assert.deepEqual(
            {
                min: inputs.step.defaultControl.min,
                max: inputs.step.defaultControl.max,
                step: inputs.step.defaultControl.step,
                default: inputs.step.defaultControl.default,
            },
            { min: 1, max: 1000, step: 1, default: 2 }
        );
        assert.deepEqual(
            {
                min: inputs.offset.defaultControl.min,
                max: inputs.offset.defaultControl.max,
                step: inputs.offset.defaultControl.step,
                default: inputs.offset.defaultControl.default,
            },
            { min: 0, max: 1000, step: 1, default: 0 }
        );
        assert.deepEqual(
            modify.controls.map((control) => control.id),
            ['modifyType', 'wrap', 'clamp', 'inplace']
        );
        const modifyType = modify.controls.find((control) => control.id === 'modifyType');
        assert.equal(modifyType.type, 'dropdown');
        assert.equal(modifyType.default, 'shift');
        assert.equal(modifyType.affectsInputs, true);
        assert.equal(modifyType.affectsControls, true);
        assert.deepEqual(
            modifyType.options.map((option) => [
                option.value,
                option.activeInputs,
                option.activeControls,
            ]),
            [
                ['shift', ['in', 'amount'], ['wrap', 'clamp', 'inplace']],
                ['repeat', ['in', 'count'], ['clamp']],
                ['pingPong', ['in', 'count'], ['clamp']],
                ['concat', ['in', 'other'], ['clamp']],
                ['interlace', ['in', 'other', 'step', 'offset'], ['clamp']],
            ]
        );
        for (const option of modifyType.options) {
            for (const locale of ['en', 'de']) {
                assert.ok(option.label[locale], `missing ${locale} label for ${option.value}`);
            }
        }
        assert.equal(modify.controls.find((control) => control.id === 'wrap').default, true);
        assert.equal(modify.controls.find((control) => control.id === 'clamp').default, false);
        assert.equal(modify.controls.find((control) => control.id === 'inplace').default, false);
        assert.equal(modify.implementations.python.value, 'NodeCodeGenerators.arrayModify');
        assert.equal(modify.icon, 'icons/view_apps_24dp.svg');
    });

    it('array-modify reveals only the inputs of the selected mode', () => {
        const modify = loadNodeTypes()['array-modify'];
        const cases = [
            ['shift', ['in', 'amount'], ['modifyType', 'wrap', 'clamp', 'inplace']],
            ['repeat', ['in', 'count'], ['modifyType', 'clamp']],
            ['pingPong', ['in', 'count'], ['modifyType', 'clamp']],
            ['concat', ['in', 'other'], ['modifyType', 'clamp']],
            ['interlace', ['in', 'other', 'step', 'offset'], ['modifyType', 'clamp']],
        ];

        for (const [mode, expectedInputs, expectedControls] of cases) {
            const nodeData = {
                inputs: modify.inputs,
                controls: modify.controls,
                controlValues: { modifyType: mode },
            };
            assert.deepEqual(
                getVisibleInputs(nodeData).map((input) => input.id),
                expectedInputs,
                `visible inputs for ${mode}`
            );
            assert.deepEqual(
                getVisibleControls(nodeData).map((control) => control.id),
                expectedControls,
                `visible controls for ${mode}`
            );
        }
    });

    it('array-set exposes the full input order and setType visibility matrix', () => {
        const set = loadNodeTypes()['array-set'];
        assert.deepEqual(
            set.inputs.map((input) => input.id),
            [
                'in',
                'index',
                'value',
                'indices',
                'start',
                'width',
                'stepWidth',
                'numSteps',
                'min',
                'max',
                'period',
                'periodCount',
                'phase',
                'amplitude',
                'offset',
                'mean',
                'stdDev',
                'fillValue',
            ]
        );
        const inputs = Object.fromEntries(set.inputs.map((input) => [input.id, input]));
        assert.deepEqual(inputs.value.allowedTypes, ['float', 'int', 'vars.array']);
        assert.deepEqual(inputs.indices.allowedTypes, ['vars.array']);
        assert.equal(inputs.start.defaultControl.type, 'number');
        assert.equal(inputs.start.defaultControl.default, 0);
        assert.equal(inputs.width.defaultControl.type, 'number');
        assert.equal(inputs.width.defaultControl.default, -1);
        assert.equal(inputs.period.defaultControl.type, 'number');
        assert.equal(inputs.period.defaultControl.default, 30);
        assert.equal(inputs.periodCount.defaultControl.type, 'number');
        assert.equal(inputs.periodCount.defaultControl.default, 1);
        assert.equal(inputs.index.defaultControl.type, 'number');
        assert.equal(inputs.index.defaultControl.default, 0);
        assert.deepEqual(inputs.fillValue.allowedTypes, ['float', 'int']);
        assert.equal(inputs.fillValue.defaultControl.type, 'number');
        assert.equal(inputs.fillValue.defaultControl.default, 0);
        assert.equal(inputs.fillValue.defaultControl.step, 0.01);
        assert.equal(inputs.fillValue.defaultControl.min, -100000);
        assert.equal(inputs.fillValue.defaultControl.max, 100000);
        const setType = set.controls.find((control) => control.id === 'setType');
        assert.equal(setType.affectsInputs, true);
        assert.equal(setType.affectsControls, true);
        assert.equal(setType.default, 'set');
        assert.deepEqual(
            setType.options.map((option) => option.value),
            [
                'set',
                'setIndices',
                'fill',
                'ramp',
                'steps',
                'hat',
                'sin',
                'square',
                'sawtooth',
                'randomUniform',
                'randomNormal',
            ]
        );
        const active = Object.fromEntries(
            setType.options.map((option) => [
                option.value,
                { activeInputs: option.activeInputs, activeControls: option.activeControls },
            ])
        );
        assert.deepEqual(active.set, {
            activeInputs: ['in', 'index', 'value', 'fillValue'],
            activeControls: ['indexMode', 'inplace', 'clamp'],
        });
        assert.deepEqual(active.setIndices, {
            activeInputs: ['in', 'indices', 'value', 'fillValue'],
            activeControls: ['indexMode', 'inplace', 'clamp'],
        });
        assert.deepEqual(active.fill, {
            activeInputs: ['in', 'value', 'start', 'width'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.ramp, {
            activeInputs: ['in', 'start', 'width', 'min', 'max'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.steps, {
            activeInputs: ['in', 'start', 'stepWidth', 'numSteps', 'min', 'max'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.hat, {
            activeInputs: ['in', 'start', 'width', 'min', 'max'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.sin, {
            activeInputs: ['in', 'start', 'period', 'periodCount', 'phase', 'amplitude', 'offset'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.square, {
            activeInputs: ['in', 'start', 'period', 'periodCount', 'phase', 'amplitude', 'offset'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.sawtooth, {
            activeInputs: ['in', 'start', 'period', 'periodCount', 'phase', 'amplitude', 'offset'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.randomUniform, {
            activeInputs: ['in', 'min', 'max'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(active.randomNormal, {
            activeInputs: ['in', 'min', 'max', 'mean', 'stdDev'],
            activeControls: ['inplace', 'clamp'],
        });
        assert.deepEqual(
            setType.options
                .filter((option) => (option.activeInputs || []).includes('fillValue'))
                .map((option) => option.value),
            ['set', 'setIndices']
        );
        for (const [mode, expectedInputs] of [
            ['set', ['in', 'index', 'value', 'fillValue']],
            ['setIndices', ['in', 'value', 'indices', 'fillValue']],
            ['fill', ['in', 'value', 'start', 'width']],
        ]) {
            assert.deepEqual(
                getVisibleInputs({
                    inputs: set.inputs,
                    controls: set.controls,
                    controlValues: { setType: mode },
                }).map((input) => input.id),
                expectedInputs,
                `visible inputs for ${mode}`
            );
        }
    });

    it('array-set offers clamp/wrap/shift index modes and an inplace checkbox', () => {
        const set = loadNodeTypes()['array-set'];
        assert.deepEqual(
            set.controls.map((control) => control.id),
            ['setType', 'indexMode', 'inplace', 'clamp']
        );
        const indexMode = set.controls.find((control) => control.id === 'indexMode');
        assert.equal(indexMode.type, 'dropdown');
        assert.equal(indexMode.default, 'clamp');
        assert.deepEqual(
            indexMode.options.map((option) => option.value),
            ['clamp', 'wrap', 'shift']
        );
        const inplace = set.controls.find((control) => control.id === 'inplace');
        assert.equal(inplace.type, 'checkbox');
        assert.equal(inplace.default, false);
        assert.equal(set.controls.find((control) => control.id === 'clamp').default, false);
        assert.equal(set.implementations.python.value, 'NodeCodeGenerators.arraySet');
        assert.equal(set.icon, 'icons/cell_merge_24dp.svg');
    });

    it('array-select reads one element with a default input and a float output', () => {
        const select = loadNodeTypes()['array-select'];
        assert.ok(select, 'missing array-select');
        assert.equal(select.implementations.python.type, 'code-generator');
        assert.equal(select.implementations.python.value, 'NodeCodeGenerators.arraySelect');
        assert.equal(select.category, 'data');
        assert.equal(select.icon, 'icons/view_array_24dp.svg');
        assert.deepEqual(
            select.inputs.map((input) => input.id),
            ['array', 'index', 'default']
        );
        const inputs = Object.fromEntries(select.inputs.map((input) => [input.id, input]));
        assert.deepEqual(inputs.array.allowedTypes, ['vars.array']);
        assert.equal(inputs.array.defaultControl, undefined);
        assert.deepEqual(inputs.index.allowedTypes, ['float', 'int']);
        assert.equal(inputs.index.defaultControl.type, 'number');
        assert.equal(inputs.index.defaultControl.step, 1);
        assert.equal(inputs.index.defaultControl.default, 0);
        assert.deepEqual(inputs.default.allowedTypes, ['float', 'int']);
        assert.equal(inputs.default.defaultControl.type, 'number');
        assert.equal(inputs.default.defaultControl.step, 0.01);
        assert.equal(inputs.default.defaultControl.default, 0);
        assert.deepEqual(
            select.outputs.map((output) => output.id),
            ['value']
        );
        assert.equal(select.outputs[0].outputType, 'float');
        assert.deepEqual(select.outputs[0].initialTypes, ['float']);
    });

    it('array-select indexMode hides the default input for clamp and wrap', () => {
        const select = loadNodeTypes()['array-select'];
        assert.deepEqual(
            select.controls.map((control) => control.id),
            ['indexMode']
        );
        const control = select.controls[0];
        assert.equal(control.type, 'dropdown');
        assert.equal(control.affectsInputs, true);
        assert.equal(control.default, 'default');
        assert.deepEqual(indexModeOptions(select), [
            ['default', ['array', 'index', 'default']],
            ['clamp', ['array', 'index']],
            ['wrap', ['array', 'index']],
        ]);
        for (const option of control.options) {
            assert.ok(option.label.en && option.label.de, `missing label for ${option.value}`);
        }
        assert.ok(control.label.en && control.label.de);
        assert.ok(control.description.en && control.description.de);
        assert.ok(select.title.en && select.title.de);
        assert.ok(select.info.en && select.info.de);
    });
    it('random-value exposes uniform and normal inputs with a dynamic output type', () => {
        const random = loadNodeTypes()['random-value'];
        assert.ok(random, 'missing random-value');
        assert.deepEqual(
            random.inputs.map((input) => input.id),
            ['min', 'max', 'mean', 'stdDev']
        );
        const inputs = Object.fromEntries(random.inputs.map((input) => [input.id, input]));
        assert.equal(inputs.min.defaultControl.type, 'number');
        assert.equal(inputs.min.defaultControl.default, 0);
        assert.equal(inputs.max.defaultControl.default, 1);
        assert.equal(inputs.mean.defaultControl.default, 0.5);
        assert.equal(inputs.stdDev.defaultControl.type, 'number');
        assert.equal(inputs.stdDev.defaultControl.min, 0);
        assert.equal(inputs.stdDev.defaultControl.default, 0.15);
        for (const input of random.inputs) {
            assert.deepEqual(input.allowedTypes, ['float', 'int']);
            assert.deepEqual(input.initialTypes, input.allowedTypes);
            assert.equal(input.phase, 'loop');
        }
        const distribution = random.controls.find((control) => control.id === 'distribution');
        assert.equal(distribution.type, 'dropdown');
        assert.equal(distribution.default, 'uniform');
        assert.equal(distribution.affectsInputs, true);
        assert.deepEqual(
            distribution.options.map((option) => [option.value, option.activeInputs]),
            [
                ['uniform', ['min', 'max']],
                ['normal', ['min', 'max', 'mean', 'stdDev']],
            ]
        );
        const valueType = random.controls.find((control) => control.id === 'valueType');
        assert.equal(valueType.type, 'dropdown');
        assert.equal(valueType.default, 'float');
        assert.deepEqual(
            valueType.options.map((option) => option.value),
            ['float', 'int']
        );
        assert.equal(random.outputs.length, 1);
        const output = random.outputs[0];
        assert.equal(output.id, 'out');
        assert.equal(output.phase, 'loop');
        assert.equal(output.outputTypeControl, 'valueType');
        assert.deepEqual(output.outputTypeByControlValue, { float: 'float', int: 'int' });
        assert.equal(random.icon, 'icons/casino_24dp.svg');
        assert.equal(random.implementations.python.value, 'NodeCodeGenerators.randomValue');
        assert.ok(random.title.en && random.title.de);
        assert.ok(random.info.en && random.info.de);
    });

    it('random-seed seeds the shared generator without outputs', () => {
        const seed = loadNodeTypes()['random-seed'];
        assert.ok(seed, 'missing random-seed');
        assert.deepEqual(
            seed.inputs.map((input) => input.id),
            ['enabled', 'seed']
        );
        const inputs = Object.fromEntries(seed.inputs.map((input) => [input.id, input]));
        assert.deepEqual(inputs.enabled.allowedTypes, ['bool']);
        assert.deepEqual(inputs.enabled.initialTypes, ['bool']);
        assert.equal(inputs.enabled.defaultControl.type, 'checkbox');
        assert.equal(inputs.enabled.defaultControl.default, true);
        assert.deepEqual(inputs.seed.allowedTypes, ['float', 'int']);
        assert.deepEqual(inputs.seed.initialTypes, ['float', 'int']);
        assert.equal(inputs.seed.defaultControl.type, 'number');
        assert.equal(inputs.seed.defaultControl.min, 0);
        assert.equal(inputs.seed.defaultControl.default, 0);
        assert.deepEqual(seed.outputs, []);
        assert.deepEqual(seed.controls, []);
        assert.equal(seed.executionPhase, 'loop');
        assert.equal(seed.icon, 'icons/key_24dp.svg');
        assert.equal(seed.implementations.python.value, 'NodeCodeGenerators.randomSeed');
        assert.ok(seed.title.en && seed.title.de);
        assert.ok(seed.info.en && seed.info.de);
    });

    it('var-read and var-write declare the store and name pickers', () => {
        const nodeTypes = loadNodeTypes();
        for (const type of ['var-read', 'var-write']) {
            const def = nodeTypes[type];
            const store = def.inputs.find((input) => input.id === 'store');
            const storeDefaults = store.defaultControl;

            assert.equal(storeDefaults.type, 'dropdown');
            assert.equal(storeDefaults.default, 'default');
            assert.equal(storeDefaults.affectsControls, true);
            assert.equal(storeDefaults.dynamicOptions.source, 'varStores');
            assert.deepEqual(storeDefaults.dynamicOptions.newStoreControls, ['customStore']);
            assert.ok(storeDefaults.dynamicOptions.newLabel.en);
            assert.ok(storeDefaults.dynamicOptions.newLabel.de);

            const name = def.controls.find((control) => control.id === 'name');
            assert.equal(name.type, 'dropdown');
            assert.equal(name.required, true);
            assert.equal(name.default, '');
            assert.equal(name.affectsControls, true);
            assert.equal(name.dynamicOptions.source, 'varNames');
            assert.deepEqual(name.dynamicOptions.dependsOn, ['store']);
            assert.deepEqual(name.dynamicOptions.newNameControls, ['customName']);
            assert.ok(name.dynamicOptions.newLabel.en);
            assert.ok(name.dynamicOptions.newLabel.de);
        }
    });

    it('var-read and var-write declare one text companion control per picker', () => {
        const nodeTypes = loadNodeTypes();
        for (const type of ['var-read', 'var-write']) {
            const def = nodeTypes[type];
            const storeDefaults = def.inputs.find((input) => input.id === 'store').defaultControl;
            const name = def.controls.find((control) => control.id === 'name');

            // Ids come from the descriptors, so a rename cannot drift away from the pickers.
            const companionIds = [
                ...storeDefaults.dynamicOptions.newStoreControls,
                ...name.dynamicOptions.newNameControls,
            ];
            for (const id of companionIds) {
                const matches = def.controls.filter((control) => control.id === id);
                assert.equal(matches.length, 1, `${type} must declare ${id} exactly once`);
                assert.equal(matches[0].type, 'text');
                assert.equal(matches[0].default, '');
                assert.ok(matches[0].label.en && matches[0].label.de);
                assert.ok(matches[0].description.en && matches[0].description.de);
            }
        }
    });

    it('keeps the var-read / var-write order and implementations', () => {
        const nodeTypes = loadNodeTypes();
        const expectations = {
            'var-read': {
                inputs: ['store', 'value'],
                controls: ['name', 'customStore', 'customName'],
                generator: 'NodeCodeGenerators.varRead',
            },
            'var-write': {
                inputs: ['enabled', 'store', 'value'],
                controls: ['name', 'customStore', 'customName'],
                generator: 'NodeCodeGenerators.varWrite',
            },
        };

        for (const [type, expected] of Object.entries(expectations)) {
            const def = nodeTypes[type];
            assert.deepEqual(
                def.inputs.map((input) => input.id),
                expected.inputs
            );
            assert.deepEqual(
                def.controls.map((control) => control.id),
                expected.controls
            );
            assert.equal(def.implementations.python.type, 'code-generator');
            assert.equal(def.implementations.python.value, expected.generator);
        }
    });

    it('every node type loads through NodeType', () => {
        const nodeTypes = loadNodeTypes();
        for (const [id, def] of Object.entries(nodeTypes)) {
            const nodeType = new NodeType({ ...def, type: `vars.${id}` }, '');
            assert.ok(nodeType.toDefinition());
        }
    });
});
