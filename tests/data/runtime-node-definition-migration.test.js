import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import NodeType from '../../src/micro_otter/nodes/html/js/data/node-type.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    buildControlValuesForRuntimeSnapshot,
    buildRuntimeNodeTypeSnapshot,
    collectRuntimeDefinitionNodePatches,
} from '../../src/micro_otter/nodes/html/js/data/runtime-node-definition-migration.js';

const DEVICE = '__device__';

function flagsControl(overrides = {}) {
    return {
        id: 'availabilityFlags',
        type: 'multi-dropdown',
        label: 'Available Flags',
        defaultValue: [DEVICE],
        default: [DEVICE],
        valueMigration: { fromControl: 'availability', entry: DEVICE },
        ...overrides,
    };
}

function valuesFor(legacyValues) {
    return buildControlValuesForRuntimeSnapshot([flagsControl()], legacyValues);
}

/**
 * Load the shipped `core.select` definition used as the migration target.
 * @returns {Record<string, unknown>} The current select node type.
 */
function readSelectDefinition() {
    const definitionsPath = path.resolve(
        'src/micro_otter/nodes/device/node_pkgs/core/node_definitions.json'
    );
    return JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes.select;
}

/**
 * Build the retired ten-channel select connectors: channel 1 keeps the bare ids,
 * channels 2..10 are suffixed.
 * @returns {{inputs: Array<Record<string, unknown>>, outputs: Array<Record<string, unknown>>}}
 *   The legacy connector lists.
 */
function legacySelectConnectors() {
    const inputs = [{ id: 'condition', name: { en: 'Condition' }, allowedTypes: ['bool'] }];
    const outputs = [];

    for (let channel = 1; channel <= 10; channel += 1) {
        const suffix = channel === 1 ? '' : `_${channel}`;
        inputs.push(
            {
                id: `trueValue${suffix}`,
                name: { en: `True ${channel}` },
                allowedTypes: ['any'],
            },
            {
                id: `falseValue${suffix}`,
                name: { en: `False ${channel}` },
                allowedTypes: ['any'],
            }
        );
        outputs.push({
            id: channel === 1 ? 'value' : `value_${channel}`,
            name: { en: 'Value' },
            outputType: 'any',
        });
    }

    return { inputs, outputs };
}

describe('runtime control value migration', () => {
    it('carries valueMigration through the runtime snapshot', () => {
        const direct = buildRuntimeNodeTypeSnapshot({ controls: [flagsControl()] }, 'hass-sensor');
        assert.deepEqual(direct.controls[0].valueMigration, {
            fromControl: 'availability',
            entry: DEVICE,
        });

        const viaControlDefinition = buildRuntimeNodeTypeSnapshot(
            {
                controls: [
                    {
                        id: 'availabilityFlags',
                        type: 'multi-dropdown',
                        label: 'Available Flags',
                        defaultValue: [DEVICE],
                        definition: {
                            valueMigration: { fromControl: 'availability', entry: DEVICE },
                        },
                    },
                ],
            },
            'hass-sensor'
        );
        assert.deepEqual(viaControlDefinition.controls[0].valueMigration, {
            fromControl: 'availability',
            entry: DEVICE,
        });
    });

    it('migrates every legacy availability shape', () => {
        assert.deepEqual(valuesFor({ availability: true }), {
            availabilityFlags: [DEVICE],
        });
        assert.deepEqual(valuesFor({ availability: true, availabilityFlags: ['heating'] }), {
            availabilityFlags: [DEVICE, 'heating'],
        });
        assert.deepEqual(valuesFor({ availability: false }), {
            availabilityFlags: [],
        });
        assert.deepEqual(valuesFor({ availability: false, availabilityFlags: ['heating'] }), {
            availabilityFlags: ['heating'],
        });
        assert.deepEqual(valuesFor({}), {
            availabilityFlags: [DEVICE],
        });
        assert.deepEqual(valuesFor({ availabilityFlags: [] }), {
            availabilityFlags: [],
        });
    });

    it('drops the legacy control and cleans the migrated list', () => {
        const values = valuesFor({
            availability: true,
            availabilityFlags: [' heating ', 'heating', '', null, DEVICE],
        });

        assert.deepEqual(values, { availabilityFlags: [DEVICE, 'heating'] });
        assert.equal(Object.prototype.hasOwnProperty.call(values, 'availability'), false);
    });

    it('removes the device entry when the legacy control is off', () => {
        assert.deepEqual(
            valuesFor({ availability: false, availabilityFlags: [DEVICE, 'heating'] }),
            { availabilityFlags: ['heating'] }
        );
    });

    it('splits a legacy comma-separated flag string', () => {
        const values = buildControlValuesForRuntimeSnapshot([flagsControl()], {
            availability: true,
            availabilityFlags: ' heating, pump ,heating ',
        });

        assert.deepEqual(values, { availabilityFlags: [DEVICE, 'heating', 'pump'] });
    });

    it('clones array defaults instead of sharing the definition array', () => {
        const control = flagsControl({
            valueMigration: undefined,
            default: [DEVICE],
            defaultValue: [DEVICE],
        });
        const first = buildControlValuesForRuntimeSnapshot([control], {});
        const second = buildControlValuesForRuntimeSnapshot([control], {});

        assert.deepEqual(first, { availabilityFlags: [DEVICE] });
        assert.notEqual(first.availabilityFlags, control.default);
        assert.notEqual(first.availabilityFlags, second.availabilityFlags);

        first.availabilityFlags.push('heating');
        assert.deepEqual(second, { availabilityFlags: [DEVICE] });
    });
});

describe('runtime control legacy defaults', () => {
    function authorityControl(overrides = {}) {
        return {
            id: 'authority',
            type: 'dropdown',
            label: 'Authority',
            defaultValue: 'device',
            default: 'device',
            legacyDefault: 'homeassistant',
            ...overrides,
        };
    }

    const savedControls = (...ids) => ids.map((id) => ({ id }));

    it('seeds legacyDefault for a node saved before the control existed', () => {
        const values = buildControlValuesForRuntimeSnapshot(
            [authorityControl()],
            {},
            savedControls('objectId', 'name')
        );

        assert.deepEqual(values, { authority: 'homeassistant' });
    });

    it('seeds default for a node that already carries the control', () => {
        const values = buildControlValuesForRuntimeSnapshot(
            [authorityControl()],
            {},
            savedControls('objectId', 'authority')
        );

        assert.deepEqual(values, { authority: 'device' });
    });

    it('seeds default when the saved controls are unknown (node creation)', () => {
        assert.deepEqual(buildControlValuesForRuntimeSnapshot([authorityControl()], {}), {
            authority: 'device',
        });
    });

    it('keeps a stored value in every case', () => {
        const stored = { authority: 'device' };

        assert.deepEqual(
            buildControlValuesForRuntimeSnapshot([authorityControl()], stored, savedControls()),
            stored
        );
        assert.deepEqual(
            buildControlValuesForRuntimeSnapshot(
                [authorityControl()],
                stored,
                savedControls('authority')
            ),
            stored
        );
        assert.deepEqual(
            buildControlValuesForRuntimeSnapshot([authorityControl()], stored),
            stored
        );
    });

    it('leaves controls without legacyDefault on their default', () => {
        const control = authorityControl({ id: 'reportState', default: true });
        delete control.legacyDefault;

        const values = buildControlValuesForRuntimeSnapshot(
            [authorityControl(), control],
            {},
            savedControls('objectId')
        );

        assert.deepEqual(values, { authority: 'homeassistant', reportState: true });
    });

    it('keeps the availability migration on its default while the authority migrates', () => {
        const values = buildControlValuesForRuntimeSnapshot(
            [flagsControl(), authorityControl()],
            { availability: true },
            savedControls('availability')
        );

        assert.deepEqual(values, { availabilityFlags: [DEVICE], authority: 'homeassistant' });
    });

    it('clones a list legacyDefault instead of sharing the definition array', () => {
        const control = authorityControl({ default: ['a'], legacyDefault: [DEVICE] });
        const first = buildControlValuesForRuntimeSnapshot([control], {}, savedControls());
        const second = buildControlValuesForRuntimeSnapshot([control], {}, savedControls());

        assert.deepEqual(first, { authority: [DEVICE] });
        assert.notEqual(first.authority, control.legacyDefault);
        assert.notEqual(first.authority, second.authority);
    });

    it('carries legacyDefault through the runtime snapshot', () => {
        const direct = buildRuntimeNodeTypeSnapshot(
            { controls: [authorityControl()] },
            'hass-number'
        );
        assert.equal(direct.controls[0].legacyDefault, 'homeassistant');

        const viaControlDefinition = buildRuntimeNodeTypeSnapshot(
            {
                controls: [
                    {
                        id: 'authority',
                        type: 'dropdown',
                        label: 'Authority',
                        defaultValue: 'device',
                        definition: { legacyDefault: 'homeassistant' },
                    },
                ],
            },
            'hass-number'
        );
        assert.equal(viaControlDefinition.controls[0].legacyDefault, 'homeassistant');
    });

    it('migrates a saved writable node through the patch collector', () => {
        const node = {
            id: 'n1',
            type: 'hass-number',
            typeName: 'HA Number',
            inputs: [],
            outputs: [],
            controls: savedControls('objectId', 'availabilityMode', 'availabilityFlags'),
            controlValues: {
                objectId: 'target',
                availabilityMode: 'all',
                availabilityFlags: [DEVICE],
            },
            inputDefaults: {},
        };

        const result = collectRuntimeDefinitionNodePatches({
            nodes: [node],
            getNodeType: () => ({
                title: 'HA Number',
                inputs: [],
                outputs: [],
                controls: [authorityControl(), flagsControl()],
            }),
        });

        const patch = result.patches.find((entry) => entry.nodeId === 'n1');
        assert.ok(patch, 'missing patch');
        assert.equal(patch.patch.controlValues.authority, 'homeassistant');
        assert.deepEqual(patch.patch.controlValues.availabilityFlags, [DEVICE]);
    });
});

describe('runtime definition node patches with value migration', () => {
    it('migrates a node loaded with the old availability control', () => {
        const node = {
            id: 'n1',
            type: 'hass-sensor',
            typeName: 'HA Sensor',
            inputs: [],
            outputs: [],
            controls: [],
            controlValues: { objectId: 'temperature', availability: true, availabilityFlags: [] },
            inputDefaults: {},
        };

        const result = collectRuntimeDefinitionNodePatches({
            nodes: [node],
            getNodeType: () => ({
                title: 'HA Sensor',
                inputs: [],
                outputs: [],
                controls: [flagsControl()],
            }),
        });

        assert.ok(result.updatedNodeIds.includes('n1'), 'node was not updated');
        const patch = result.patches.find((entry) => entry.nodeId === 'n1');
        assert.ok(patch, 'missing patch');
        assert.deepEqual(patch.patch.controlValues, {
            availabilityFlags: [DEVICE],
        });
        assert.equal(
            Object.prototype.hasOwnProperty.call(patch.patch.controlValues, 'availability'),
            false
        );
    });

    it('leads saved side-effect nodes with the enabled input', () => {
        const cases = [
            {
                package: 'core',
                typeId: 'core.digital-output',
                originalInputs: ['value'],
                inputDefaults: { value: true },
            },
            {
                package: 'hass',
                typeId: 'hass.hass-sensor',
                originalInputs: ['value'],
                inputDefaults: { value: 1 },
            },
            {
                package: 'mqtt',
                typeId: 'mqtt.mqtt-write',
                originalInputs: ['value'],
                inputDefaults: { value: 'x' },
            },
            {
                package: 'vars',
                typeId: 'vars.var-write',
                originalInputs: ['store', 'value'],
                inputDefaults: { store: 'presets', value: 1 },
            },
            {
                package: 'vars',
                typeId: 'vars.var-store-save',
                originalInputs: ['save', 'name'],
                inputDefaults: { save: true, name: 'presets' },
            },
            {
                package: 'webview',
                typeId: 'webview.web-store-save',
                originalInputs: ['save'],
                inputDefaults: { save: false },
            },
            {
                package: 'led',
                typeId: 'led.led-neopixel-output',
                originalInputs: ['channel0', 'channel1', 'channel2', 'channel3'],
                inputDefaults: { channel0: 0.5 },
            },
            {
                package: 'stdmo',
                typeId: 'stdmo.servo',
                originalInputs: ['angle'],
                inputDefaults: { angle: 30 },
            },
        ];

        cases.forEach(({ package: packageId, typeId, originalInputs, inputDefaults }) => {
            const nodeName = typeId.split('.')[1];
            const definitionsPath = path.resolve(
                `src/micro_otter/nodes/device/node_pkgs/${packageId}/node_definitions.json`
            );
            const definition = JSON.parse(readFileSync(definitionsPath, 'utf8')).nodeTypes[
                nodeName
            ];
            const node = {
                id: `${nodeName}-saved`,
                type: typeId,
                typeName: definition.title,
                inputs: originalInputs.map((inputId) => ({
                    id: inputId,
                    name: { en: inputId },
                })),
                outputs: [],
                controls: [],
                controlValues: {},
                inputDefaults: { ...inputDefaults },
            };

            const result = collectRuntimeDefinitionNodePatches({
                nodes: [node],
                getNodeType: () => new NodeType({ ...definition, type: typeId }, ''),
            });

            const patch = result.patches.find((entry) => entry.nodeId === node.id);
            assert.ok(patch, `${typeId} missing patch`);
            assert.deepEqual(
                patch.patch.inputs.map((input) => input.id),
                ['enabled', ...originalInputs],
                `${typeId} must lead with enabled`
            );
            const enabledInput = patch.patch.inputs[0];
            assert.equal(enabledInput.defaultControl.type, 'checkbox');
            assert.equal(enabledInput.defaultControl.defaultValue, true);
            assert.deepEqual(patch.patch.inputDefaults, inputDefaults);
            assert.equal(
                Object.prototype.hasOwnProperty.call(patch.patch.inputDefaults, 'enabled'),
                false,
                `${typeId} migration must not seed the enabled default`
            );
        });
    });

    it('reduces a legacy multi-channel select node to the single-channel layout', () => {
        const selectDefinition = readSelectDefinition();
        const { inputs, outputs } = legacySelectConnectors();
        const node = {
            id: 'select-1',
            type: 'core.select',
            typeName: { en: 'Select', de: 'Auswahl' },
            inputs,
            outputs,
            controls: [{ id: 'channels', type: 'dropdown', default: 1 }],
            controlValues: { channels: 2 },
            inputDefaults: {
                condition: true,
                trueValue: 'ON',
                falseValue: 'OFF',
                trueValue_2: 'B',
                falseValue_2: 'C',
            },
        };

        const result = collectRuntimeDefinitionNodePatches({
            nodes: [node],
            getNodeType: () => new NodeType({ ...selectDefinition, type: 'core.select' }, ''),
        });

        const patch = result.patches.find((entry) => entry.nodeId === 'select-1');
        assert.ok(patch, 'missing patch');
        assert.deepEqual(
            patch.patch.inputs.map((input) => input.id),
            ['condition', 'trueValue', 'falseValue']
        );
        assert.deepEqual(
            patch.patch.outputs.map((output) => output.id),
            ['value']
        );
        assert.deepEqual(patch.patch.outputs[0].typeInputSources, ['trueValue', 'falseValue']);
        assert.deepEqual(patch.patch.controls, []);
        assert.equal(
            Object.prototype.hasOwnProperty.call(patch.patch.controlValues, 'channels'),
            false,
            'the retired channels control value must be dropped'
        );
        assert.deepEqual(patch.patch.inputDefaults, {
            condition: true,
            trueValue: 'ON',
            falseValue: 'OFF',
        });

        const diagnostic = result.diagnostics.find((entry) => entry.nodeId === 'select-1');
        assert.ok(diagnostic, 'missing diagnostic');
        ['controls', 'inputs', 'outputs', 'controlValues', 'inputDefaults'].forEach((field) => {
            assert.equal(
                diagnostic.changedFields.includes(field),
                true,
                `diagnostic must report '${field}'`
            );
        });
    });
});

describe('legacy select connector pruning', () => {
    it('drops connections to the connectors the single-channel layout removed', () => {
        const selectDefinition = readSelectDefinition();
        const { inputs, outputs } = legacySelectConnectors();

        const graph = new NodeGraph({ id: 'graph-select-migration' });
        const select = graph.addNode({ id: 'select-1', type: 'core.select', inputs, outputs });
        const source = graph.addNode({
            id: 'source-1',
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'bool' }],
        });
        const target = graph.addNode({
            id: 'target-1',
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['any'] }],
        });

        // Input 4 is channel 2's false value and output 1 is channel 2's output.
        graph.addConnection({
            fromNode: source.id,
            fromIndex: 0,
            toNode: select.id,
            toIndex: 4,
        });
        graph.addConnection({
            fromNode: select.id,
            fromIndex: 1,
            toNode: target.id,
            toIndex: 0,
        });

        const { patches } = collectRuntimeDefinitionNodePatches({
            nodes: graph.getNodes(),
            getNodeType: () => new NodeType({ ...selectDefinition, type: 'core.select' }, ''),
        });

        patches.forEach((entry) => {
            graph.updateNode(entry.nodeId, entry.patch);
        });

        assert.equal(graph.getNode(select.id).inputs.length, 3);
        assert.equal(graph.getNode(select.id).outputs.length, 1);
        assert.deepEqual(graph.getConnections(), []);
    });
});

describe('runtime icon path migration', () => {
    it('passes an mdi icon through unchanged', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot({ icon: 'mdi:function' }, 'fn-type');

        assert.equal(snapshot.icon, 'mdi:function');
    });

    it('still rewrites a legacy /runtime/ icon path', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot(
            { icon: '/runtime/icons/light.svg' },
            'fn-type'
        );

        assert.equal(snapshot.icon, '/device/runtime/icons/light.svg');
    });

    it('still rewrites a legacy runtime/ icon path without the leading slash', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot(
            { icon: 'runtime/icons/light.svg' },
            'fn-type'
        );

        assert.equal(snapshot.icon, '/device/runtime/icons/light.svg');
    });
});
