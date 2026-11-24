import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateNodeCapabilities } from '../../src/micro_otter/nodes/html/js/core/node-capability-validator.js';
import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';

describe('node resource usage validation', () => {
    it('round-trips resourceUsage through NodeType', () => {
        const nodeType = NodeType.fromDefinition({
            type: 'servo',
            resourceUsage: [
                {
                    kind: 'pin',
                    controlId: 'pin',
                    capability: 'pwm.output',
                    value: { frequency_hz: 50 },
                },
            ],
        });

        const serialized = nodeType.toDefinition();
        assert.deepEqual(serialized.resourceUsage, [
            { kind: 'pin', controlId: 'pin', capability: 'pwm.output', value: { frequency_hz: 50 } },
        ]);
    });

    it('checks granular capability membership for declared usage', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-1', controlValues: { pin: 1 } },
            nodeType: {
                requiredCapabilities: [],
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'adc.unit1' }],
            },
            capabilities: {
                capabilityToPins: { 'adc.unit1': [1] },
                pinCapabilities: { 1: { adc: { unit: 1 } } },
            },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.deepEqual(result.issues, []);
    });

    it('reports a missing declared usage capability at node level', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-2', controlValues: { pin: 11 } },
            nodeType: {
                requiredCapabilities: [],
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'adc.unit1' }],
            },
            capabilities: {
                capabilityToPins: { 'adc.unit2': [11] },
                pinCapabilities: { 11: { adc: { unit: 2 } } },
            },
            targetId: 'esp32',
        });

        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].scope, 'node');
        assert.equal(result.issues[0].capability, 'adc.unit1');
        assert.equal(result.issues[0].message, 'Missing required capability: adc.unit1');
    });

    it('emits strapping and reserved warnings for declared pin usage', () => {
        const strapping = validateNodeCapabilities({
            node: { id: 'node-3', controlValues: { pin: 0 } },
            nodeType: {
                requiredCapabilities: [],
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }],
            },
            capabilities: {
                capabilityToPins: { 'pwm.output': [0] },
                pinCapabilities: { 0: { strapping: { role: 'boot' }, pwm: { output: true } } },
            },
            targetId: 'esp32',
        });

        assert.ok(strapping.issues.some((issue) => /strapping/.test(issue.message)));

        const reserved = validateNodeCapabilities({
            node: { id: 'node-3b', controlValues: { pin: 26 } },
            nodeType: {
                requiredCapabilities: [],
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }],
            },
            capabilities: {
                capabilityToPins: { 'pwm.output': [26] },
                pinCapabilities: { 26: { reserved: { reason: 'psram' }, pwm: { output: true } } },
            },
            targetId: 'esp32',
        });

        assert.ok(reserved.issues.some((issue) => /reserved/.test(issue.message)));
    });

    it('emits a warning when declared PWM frequency exceeds the pin range', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-4', controlValues: { pin: 5 } },
            nodeType: {
                requiredCapabilities: [],
                resourceUsage: [
                    {
                        kind: 'pin',
                        controlId: 'pin',
                        capability: 'pwm.output',
                        value: { frequency_hz: 100000 },
                    },
                ],
            },
            capabilities: {
                capabilityToPins: { 'pwm.output': [5] },
                pinCapabilities: {
                    5: { pwm: { output: true, frequency_hz: { min: 1, max: 80000 } } },
                },
            },
            targetId: 'esp32',
        });

        assert.ok(result.issues.some((issue) => /exceeds the pin maximum/.test(issue.message)));
    });
});
