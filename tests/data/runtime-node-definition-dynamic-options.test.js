import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildRuntimeNodeTypeSnapshot,
    collectRuntimeDefinitionNodePatches,
} from '../../src/micro_otter/nodes/html/js/data/runtime-node-definition-migration.js';

describe('runtime node definition dynamic control schema', () => {
    it('passes dynamicOptions through the runtime snapshot', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot(
            {
                controls: [
                    {
                        id: 'pin',
                        type: 'dropdown',
                        label: 'Pin',
                        defaultValue: 1,
                        dynamicOptions: {
                            source: 'targetPinsForCapability',
                            capabilityKey: 'dac',
                        },
                    },
                    {
                        id: 'i2sId',
                        type: 'dropdown',
                        label: 'I2S Peripheral',
                        defaultValue: 0,
                        dynamicOptions: {
                            source: 'targetResourceValues',
                            resourceGroup: 'i2s',
                            resourceKey: 'controllers',
                        },
                    },
                ],
            },
            'node'
        );

        assert.deepEqual(snapshot.controls[0].dynamicOptions, {
            source: 'targetPinsForCapability',
            capabilityKey: 'dac',
        });
        assert.deepEqual(snapshot.controls[1].dynamicOptions, {
            source: 'targetResourceValues',
            resourceGroup: 'i2s',
            resourceKey: 'controllers',
        });
    });

    it('omits dynamicOptions when a control does not declare it', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot(
            {
                controls: [{ id: 'pin', type: 'number', label: 'Pin', defaultValue: 1 }],
            },
            'node'
        );
        assert.equal(snapshot.controls[0].dynamicOptions, undefined);
    });
});

describe('runtime node definition union output typing', () => {
    const unionOutput = {
        id: 'value',
        name: 'Value',
        outputType: 'any',
        initialTypes: ['bool', 'int', 'float', 'string', 'core.tuple'],
        typeInputSources: ['trueValue', 'falseValue'],
    };

    it('passes typeInputSources through the runtime snapshot', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot({ outputs: [unionOutput] }, 'node');

        assert.deepEqual(snapshot.outputs[0].typeInputSources, ['trueValue', 'falseValue']);
        assert.equal(snapshot.outputs[0].outputType, 'any');
    });

    it('drops the retired snake_case alias', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot(
            {
                outputs: [
                    {
                        id: 'value',
                        name: 'Value',
                        outputType: 'any',
                        type_input_sources: [' a ', '', 3, 'b'],
                    },
                ],
            },
            'node'
        );

        assert.equal(snapshot.outputs[0].typeInputSources, undefined);
        assert.equal(snapshot.outputs[0].outputType, 'any');
    });

    it('drops an empty declaration', () => {
        const snapshot = buildRuntimeNodeTypeSnapshot(
            { outputs: [{ id: 'value', name: 'Value', outputType: 'bool', typeInputSources: [] }] },
            'node'
        );

        assert.equal(snapshot.outputs[0].typeInputSources, undefined);
        assert.equal(snapshot.outputs[0].outputType, 'bool');
    });

    it('treats a typeInputSources-only difference as a definition change', () => {
        const node = {
            id: 'n1',
            type: 'core-select',
            outputs: [{ ...unionOutput, typeInputSources: ['trueValue'] }],
            inputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: {},
        };

        const result = collectRuntimeDefinitionNodePatches({
            nodes: [node],
            getNodeType: () => ({ title: 'Select', outputs: [unionOutput], inputs: [], controls: [] }),
        });

        assert.equal(result.updatedNodeIds.includes('n1'), true);
        const diagnostic = result.diagnostics.find((entry) => entry.nodeId === 'n1');
        assert.ok(diagnostic, 'missing diagnostic');
        assert.ok(diagnostic.changedFields.includes('outputs'));
        const patch = result.patches.find((entry) => entry.nodeId === 'n1');
        assert.deepEqual(patch.patch.outputs[0].typeInputSources, ['trueValue', 'falseValue']);
    });

    it('keeps an identical declaration patch-free', () => {
        const node = {
            id: 'n1',
            type: 'core-select',
            outputs: [{ ...unionOutput, typeInputSources: ['trueValue', 'falseValue'] }],
            inputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: {},
            typeName: 'Select',
        };

        const result = collectRuntimeDefinitionNodePatches({
            nodes: [node],
            getNodeType: () => ({ title: 'Select', outputs: [unionOutput], inputs: [], controls: [] }),
        });

        const diagnostic = result.diagnostics.find((entry) => entry.nodeId === 'n1');
        const changedFields = diagnostic ? diagnostic.changedFields : [];
        assert.equal(changedFields.includes('outputs'), false);
    });

    it('repairs a union output whose representative type was reset to initialTypes[0]', () => {
        const node = {
            id: 'n1',
            type: 'core-select',
            outputs: [{ ...unionOutput, outputType: 'bool' }],
            inputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: {},
            typeName: 'Select',
        };

        const result = collectRuntimeDefinitionNodePatches({
            nodes: [node],
            getNodeType: () => ({ title: 'Select', outputs: [unionOutput], inputs: [], controls: [] }),
        });

        const diagnostic = result.diagnostics.find((entry) => entry.nodeId === 'n1');
        assert.ok(
            diagnostic?.changedFields.includes('outputs'),
            'union output type was not compared'
        );
        const patch = result.patches.find((entry) => entry.nodeId === 'n1');
        assert.ok(patch, 'missing patch');
        assert.equal(patch.patch.outputs[0].outputType, 'any');
    });
});
