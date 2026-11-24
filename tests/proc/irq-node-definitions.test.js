import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/irq');
const definitionsPath = path.join(packageRoot, 'node_definitions.json');

const EXPECTED_IDS = ['interrupt-enable', 'interrupt-input'];
const ICON_FILES = ['icons/bolt_24dp.svg', 'icons/toggle_on_24dp.svg'];
const TRIGGER_VALUES = ['rising', 'falling', 'change', 'low', 'high'];

function readDefinitions() {
    return JSON.parse(readFileSync(definitionsPath, 'utf8'));
}

function nodeTypes() {
    return readDefinitions().nodeTypes;
}

function hasBothLanguages(value, label) {
    assert.equal(typeof value, 'object', `${label} must be an i18n object`);
    assert.ok(value.en, `${label} needs an 'en' text`);
    assert.ok(value.de, `${label} needs a 'de' text`);
}

function controlsOf(nodeId) {
    return Object.fromEntries(nodeTypes()[nodeId].controls.map((control) => [control.id, control]));
}

describe('irq node definitions', () => {
    it('defines exactly the two node types', () => {
        assert.deepEqual(Object.keys(nodeTypes()).sort(), EXPECTED_IDS);
    });

    it('shares the package category, colour, shape and i18n conventions', () => {
        for (const [id, definition] of Object.entries(nodeTypes())) {
            hasBothLanguages(definition.title, `${id}.title`);
            hasBothLanguages(definition.info, `${id}.info`);
            assert.equal(definition.category, 'hardware', `${id} category`);
            assert.equal(definition.color, '#5b7fc7', `${id} color`);
            assert.equal(definition.shape, 'square', `${id} shape`);
            assert.ok(ICON_FILES.includes(definition.icon), `${id} icon '${definition.icon}'`);
            assert.ok(
                existsSync(path.join(packageRoot, definition.icon)),
                `${id} icon '${definition.icon}' must exist on disk`
            );
        }
    });

    it('keeps every visible text bilingual', () => {
        for (const [id, definition] of Object.entries(nodeTypes())) {
            for (const input of definition.inputs || []) {
                hasBothLanguages(input.name, `${id}.${input.id}.name`);
                hasBothLanguages(input.description, `${id}.${input.id}.description`);
                hasBothLanguages(input.defaultControl.label, `${id}.${input.id}.label`);
            }
            for (const output of definition.outputs || []) {
                hasBothLanguages(output.name, `${id}.${output.id}.name`);
                hasBothLanguages(output.description, `${id}.${output.id}.description`);
            }
            for (const control of definition.controls || []) {
                hasBothLanguages(control.label, `${id}.${control.id}.label`);
                hasBothLanguages(control.description, `${id}.${control.id}.description`);
                for (const option of control.options || []) {
                    hasBothLanguages(option.label, `${id}.${control.id}.options.label`);
                }
            }
        }
    });

    it('interrupt-input exposes the five documented controls', () => {
        const controls = controlsOf('interrupt-input');

        assert.deepEqual(Object.keys(controls), [
            'pin',
            'trigger',
            'pull',
            'debounceMs',
            'triggerName',
        ]);

        assert.equal(controls.pin.type, 'dropdown');
        assert.equal(controls.pin.default, 0);
        assert.deepEqual(controls.pin.dynamicOptions, {
            source: 'targetPinsForCapability',
            capabilityKey: 'irq',
        });

        assert.equal(controls.trigger.type, 'dropdown');
        assert.equal(controls.trigger.default, 'rising');
        assert.deepEqual(
            controls.trigger.options.map((option) => option.value),
            TRIGGER_VALUES
        );

        assert.equal(controls.pull.type, 'dropdown');
        assert.equal(controls.pull.default, null);
        assert.deepEqual(controls.pull.dynamicOptions, {
            source: 'targetPinPull',
            dependsOn: ['pin'],
            includeUndefined: true,
        });

        assert.equal(controls.debounceMs.type, 'number');
        assert.equal(controls.debounceMs.default, 0);
        assert.equal(controls.debounceMs.min, 0);
        assert.equal(controls.debounceMs.max, 10000);
        assert.equal(controls.debounceMs.step, 1);

        assert.equal(controls.triggerName.type, 'text');
        assert.equal(controls.triggerName.default, '');
    });

    it('interrupt-input requires the irq pin capability and runs in the shared init block', () => {
        const definition = nodeTypes()['interrupt-input'];

        assert.equal(definition.executionPhase, 'both');
        assert.deepEqual(definition.inputs, []);
        assert.deepEqual(definition.resourceUsage, [
            { kind: 'pin', controlId: 'pin', capability: 'irq' },
        ]);
        assert.equal(definition.capabilityCheck, undefined);
        assert.equal(definition.initFunction, 'init_irq_generation');
        assert.deepEqual(definition.initImplementations, {
            python: { type: 'code-generator', value: 'NodeInitGenerators.interruptInput' },
        });
        assert.deepEqual(definition.implementations, {
            python: { type: 'code-generator', value: 'NodeCodeGenerators.interruptInput' },
        });
    });

    it('interrupt-input outputs triggered, count and state in order', () => {
        const definition = nodeTypes()['interrupt-input'];

        assert.deepEqual(
            definition.outputs.map((output) => output.id),
            ['triggered', 'count', 'state']
        );
        assert.deepEqual(
            definition.outputs.map((output) => output.outputType),
            ['bool', 'int', 'bool']
        );
        assert.deepEqual(
            definition.outputs.map((output) => output.initialTypes),
            [['bool'], ['int'], ['bool']]
        );
    });

    it('interrupt-enable gates one bool input by interrupt name', () => {
        const definition = nodeTypes()['interrupt-enable'];

        assert.equal(definition.executionPhase, 'loop');
        assert.deepEqual(definition.outputs, []);
        assert.equal(definition.resourceUsage, undefined);
        assert.equal(definition.initImplementations, undefined);
        assert.equal(definition.initFunction, undefined);
        assert.deepEqual(definition.implementations, {
            python: { type: 'code-generator', value: 'NodeCodeGenerators.interruptEnable' },
        });

        assert.equal(definition.inputs.length, 1);
        const enabled = definition.inputs[0];
        assert.equal(enabled.id, 'enabled');
        assert.deepEqual(enabled.allowedTypes, ['bool']);
        assert.deepEqual(enabled.initialTypes, ['bool']);
        assert.equal(enabled.phase, 'loop');
        assert.equal(enabled.defaultControl.type, 'checkbox');
        assert.equal(enabled.defaultControl.default, true);

        const controls = controlsOf('interrupt-enable');
        assert.deepEqual(Object.keys(controls), ['triggerName']);
        assert.equal(controls.triggerName.type, 'dropdown');
        assert.equal(controls.triggerName.default, '');
        assert.deepEqual(controls.triggerName.dynamicOptions, { source: 'irqTriggerNames' });
    });
});
