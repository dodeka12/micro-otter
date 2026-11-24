import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/time');
const definitionsPath = path.join(packageRoot, 'node_definitions.json');

const EXPECTED_IDS = [
    'time-service',
    'time-status',
    'time-clock-parts',
    'time-date-parts',
    'time-between',
    'time-format',
];

const ICON_FILES = [
    'icons/schedule_24dp.svg',
    'icons/sync_24dp.svg',
    'icons/timer_24dp.svg',
    'icons/calendar_month_24dp.svg',
    'icons/hourglass_bottom_24dp.svg',
    'icons/text_fields_24dp.svg',
];

const KNOWN_INPUT_IDS = new Set(['server', 'interval', 'timezone', 'enabled', 'epoch']);

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

describe('time node definitions', () => {
    it('defines exactly the six node types', () => {
        assert.deepEqual(Object.keys(nodeTypes()).sort(), [...EXPECTED_IDS].sort());
    });

    it('shares the package category, colour and i18n conventions', () => {
        for (const [id, definition] of Object.entries(nodeTypes())) {
            hasBothLanguages(definition.title, `${id}.title`);
            hasBothLanguages(definition.info, `${id}.info`);
            assert.equal(definition.category, 'time', `${id} category`);
            assert.equal(definition.color, '#5b7fc7', `${id} color`);
            assert.equal(definition.executionPhase, 'loop', `${id} executionPhase`);
            assert.ok(
                ['square', 'round'].includes(definition.shape),
                `${id} shape must be square or round, got '${definition.shape}'`
            );
        }
    });

    it('points every node at one of the six shipped icons', () => {
        for (const [id, definition] of Object.entries(nodeTypes())) {
            assert.ok(ICON_FILES.includes(definition.icon), `${id} icon '${definition.icon}'`);
            assert.ok(
                existsSync(path.join(packageRoot, definition.icon)),
                `${id} icon '${definition.icon}' must exist on disk`
            );
        }
    });

    it('gives every connector an id, an i18n name and a loop phase', () => {
        for (const [id, definition] of Object.entries(nodeTypes())) {
            const inputIds = new Set();
            for (const input of definition.inputs || []) {
                assert.equal(typeof input.id, 'string', `${id} input id`);
                assert.ok(!inputIds.has(input.id), `${id} has a duplicate input '${input.id}'`);
                inputIds.add(input.id);
                assert.ok(KNOWN_INPUT_IDS.has(input.id), `${id} has an unknown input '${input.id}'`);
                hasBothLanguages(input.name, `${id}.${input.id}.name`);
                hasBothLanguages(input.description, `${id}.${input.id}.description`);
                assert.equal(input.phase, 'loop', `${id}.${input.id} phase`);
                assert.ok(input.defaultControl, `${id}.${input.id} needs a defaultControl`);
                assert.notEqual(
                    input.defaultControl.default,
                    undefined,
                    `${id}.${input.id} defaultControl needs a default`
                );
            }
            for (const output of definition.outputs || []) {
                assert.equal(typeof output.id, 'string', `${id} output id`);
                hasBothLanguages(output.name, `${id}.${output.id}.name`);
                hasBothLanguages(output.description, `${id}.${output.id}.description`);
                assert.equal(typeof output.outputType, 'string', `${id}.${output.id} outputType`);
            }
            if ((definition.outputs || []).length === 0) {
                assert.deepEqual(definition.outputs, [], `${id} must declare an empty output list`);
            }
        }
    });

    it('declares the networking requirement on time-service only', () => {
        for (const [id, definition] of Object.entries(nodeTypes())) {
            if (id === 'time-service') {
                assert.deepEqual(definition.requiredCapabilities, [['wifi', 'ethernet']]);
            } else {
                assert.equal(
                    definition.requiredCapabilities,
                    undefined,
                    `${id} must not declare requiredCapabilities`
                );
            }
        }
    });
});

describe('time node definitions - per node', () => {
    it('time-service has four inputs, no outputs and starts the service', () => {
        const def = nodeTypes()['time-service'];
        assert.deepEqual(
            def.inputs.map((input) => input.id),
            ['server', 'interval', 'timezone', 'enabled']
        );
        assert.deepEqual(
            def.inputs.map((input) => input.defaultControl.default),
            ['pool.ntp.org', 60, 0, true]
        );
        assert.equal(def.inputs[0].defaultControl.type, 'text');
        assert.equal(def.inputs[1].defaultControl.min, 1);
        assert.equal(def.inputs[1].defaultControl.max, 1440);
        assert.equal(def.inputs[2].defaultControl.min, -12);
        assert.equal(def.inputs[2].defaultControl.max, 14);
        assert.equal(def.inputs[2].defaultControl.step, 0.5);
        assert.equal(def.inputs[3].defaultControl.type, 'checkbox');
        assert.deepEqual(def.outputs, []);
        assert.equal(def.initFunction, 'init_time');
        assert.equal(
            def.initImplementations.python.value,
            'NodeInitGenerators.timeService'
        );
        assert.equal(def.implementations.python.value, 'NodeCodeGenerators.timeService');
    });

    it('time-status reports epoch, synced and age without inputs', () => {
        const def = nodeTypes()['time-status'];
        assert.deepEqual(def.inputs, []);
        assert.deepEqual(
            def.outputs.map((output) => output.id),
            ['epoch', 'synced', 'age']
        );
        assert.deepEqual(
            def.outputs.map((output) => output.outputType),
            ['int', 'bool', 'int']
        );
    });

    it('time-clock-parts and time-date-parts share the sentinel inputs', () => {
        for (const id of ['time-clock-parts', 'time-date-parts']) {
            const def = nodeTypes()[id];
            assert.deepEqual(
                def.inputs.map((input) => input.id),
                ['epoch', 'timezone'],
                `${id} input ids`
            );
            assert.equal(def.inputs[0].defaultControl.default, -1, `${id} epoch default`);
            assert.equal(def.inputs[0].defaultControl.min, -1, `${id} epoch min`);
            assert.equal(def.inputs[1].defaultControl.default, -100, `${id} timezone default`);
            assert.equal(def.inputs[1].defaultControl.min, -100, `${id} timezone min`);
            assert.equal(def.inputs[1].defaultControl.step, 0.5, `${id} timezone step`);
        }
        assert.deepEqual(
            nodeTypes()['time-clock-parts'].outputs.map((output) => output.id),
            ['hour', 'minute', 'second']
        );
        assert.deepEqual(
            nodeTypes()['time-date-parts'].outputs.map((output) => output.id),
            ['year', 'month', 'day', 'weekday']
        );
    });

    it('time-between has HH:MM controls and a single bool output', () => {
        const def = nodeTypes()['time-between'];
        const controls = Object.fromEntries(def.controls.map((control) => [control.id, control]));
        assert.deepEqual(Object.keys(controls), ['start', 'end']);
        assert.equal(controls.start.type, 'text');
        assert.equal(controls.end.type, 'text');
        assert.match(controls.start.default, /^\d{1,2}:\d{2}$/);
        assert.match(controls.end.default, /^\d{1,2}:\d{2}$/);
        assert.equal(def.outputs.length, 1);
        assert.equal(def.outputs[0].id, 'active');
        assert.equal(def.outputs[0].outputType, 'bool');
    });

    it('time-format has a pattern control and a single string output', () => {
        const def = nodeTypes()['time-format'];
        assert.equal(def.controls.length, 1);
        assert.equal(def.controls[0].id, 'pattern');
        assert.equal(def.controls[0].type, 'text');
        assert.ok(def.controls[0].default.includes('%H'));
        assert.equal(def.outputs.length, 1);
        assert.equal(def.outputs[0].id, 'text');
        assert.equal(def.outputs[0].outputType, 'string');
    });
});
