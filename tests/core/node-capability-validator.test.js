// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    isCustomTargetSelection,
    validateNodeCapabilities,
} from '../../src/micro_otter/nodes/html/js/core/node-capability-validator.js';

describe('node-capability-validator', () => {
    it('does not bypass capability checks for the removed custom target id', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-1' },
            nodeType: { requiredCapabilities: ['pwm.output'] },
            capabilities: { capabilityToPins: {} },
            targetId: 'custom',
        });

        assert.equal(result.bypassed, false);
    });

    it('bypasses capability checks when capability metadata marks custom target', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-1' },
            nodeType: { requiredCapabilities: ['adc.read'] },
            capabilities: {
                capabilityToPins: {},
                metadata: { isCustomTarget: true },
            },
            targetId: 'esp32-s3-devkit',
        });

        assert.equal(result.bypassed, true);
        assert.deepEqual(result.issues, []);
    });

    it('reports missing required capabilities when no custom check is provided', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-1' },
            nodeType: { requiredCapabilities: ['adc.read', 'i2c.sda'] },
            capabilities: {
                capabilityToPins: {
                    'adc.read': [{ pinId: 1 }],
                },
            },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].source, 'requiredCapabilities');
        assert.equal(result.issues[0].capability, 'i2c.sda');
    });

    it('evaluates requiredCapabilities alongside a custom capability check', () => {
        const nodeType = {
            requiredCapabilities: ['adc.read'],
            getCapabilityCheckHandler() {
                return () => ({ valid: true });
            },
        };

        const result = validateNodeCapabilities({
            node: { id: 'node-2' },
            nodeType,
            capabilities: { capabilityToPins: {} },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].capability, 'adc.read');
        assert.equal(result.issues[0].source, 'requiredCapabilities');
    });

    it('normalizes field-level custom check issues', () => {
        const nodeType = {
            getCapabilityCheckHandler() {
                return () => ([
                    {
                        scope: 'control',
                        controlId: 'pin',
                        capability: 'pwm.output',
                        message: 'Selected pin does not support PWM output',
                    },
                ]);
            },
        };

        const result = validateNodeCapabilities({
            node: { id: 'node-3' },
            nodeType,
            capabilities: { capabilityToPins: {} },
            targetId: 'esp32',
        });

        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].nodeId, 'node-3');
        assert.equal(result.issues[0].scope, 'control');
        assert.equal(result.issues[0].controlId, 'pin');
        assert.equal(result.issues[0].source, 'capabilityCheck');
    });

    it('provides nodeData and deviceTarget context to custom handlers', () => {
        const nodeType = {
            getCapabilityCheckHandler() {
                return ({ nodeData, deviceTarget }) => {
                    const pin = nodeData?.controlValues?.pin;
                    if (deviceTarget?.hasPinCapability?.(pin, 'pwm.output')) {
                        return [];
                    }
                    return [
                        {
                            scope: 'control',
                            controlId: 'pin',
                            capability: 'pwm.output',
                            message: `Pin ${pin} does not support PWM output`,
                        },
                    ];
                };
            },
        };

        const result = validateNodeCapabilities({
            node: { id: 'node-4', controlValues: { pin: 3 } },
            nodeType,
            capabilities: { capabilityToPins: { 'pwm.output': [5, 6] } },
            targetId: 'esp32',
        });

        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].scope, 'control');
        assert.equal(result.issues[0].controlId, 'pin');
    });

    it('provides validationContext to custom capability handlers', () => {
        const nodeType = {
            getCapabilityCheckHandler() {
                return ({ validationContext }) => {
                    const graphId = validationContext?.graphId || 'unknown';
                    return [
                        {
                            scope: 'node',
                            message: `context:${graphId}`,
                        },
                    ];
                };
            },
        };

        const result = validateNodeCapabilities({
            node: { id: 'node-ctx' },
            nodeType,
            capabilities: { capabilityToPins: {} },
            targetId: 'esp32',
            validationContext: {
                graphId: 'graph-a',
                graphNodes: [{ id: 'node-ctx' }],
                graphConnections: [],
                nodeTypesByNodeId: {},
            },
        });

        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].message, 'context:graph-a');
        assert.equal(result.issues[0].source, 'capabilityCheck');
    });

    it('provides backward-compatible node/capabilities aliases to custom handlers', () => {
        let capturedNode = null;
        let capturedCapabilities = null;
        let capturedDeviceTarget = null;

        const nodeType = {
            getCapabilityCheckHandler() {
                return ({ node, capabilities, deviceTarget }) => {
                    capturedNode = node;
                    capturedCapabilities = capabilities;
                    capturedDeviceTarget = deviceTarget;
                    return { valid: true };
                };
            },
        };

        const nodeData = { id: 'node-alias', controlValues: { pin: 7 } };
        const capabilitySnapshot = {
            id: 'esp32-s3',
            capabilityToPins: { 'pwm.output': [7] },
            metadata: {},
        };

        const result = validateNodeCapabilities({
            node: nodeData,
            nodeType,
            capabilities: capabilitySnapshot,
            targetId: 'esp32-s3',
        });

        assert.equal(result.issues.length, 0);
        assert.equal(capturedNode, nodeData);
        assert.equal(capturedCapabilities, capturedDeviceTarget);
        assert.equal(capturedCapabilities.id, 'esp32-s3');
    });

    it('reports phase mismatch when output and input phases are incompatible', () => {
        const sourceNodeType = {
            executionPhase: 'init',
            outputs: [{ id: 'out0', phase: 'init' }],
        };
        const targetNodeType = {
            executionPhase: 'loop',
            inputs: [{ id: 'in0', phase: 'loop' }],
        };

        const result = validateNodeCapabilities({
            node: { id: 'node-target' },
            nodeType: targetNodeType,
            capabilities: { capabilityToPins: {} },
            targetId: 'esp32',
            validationContext: {
                graphId: 'graph-phase',
                graphNodes: [
                    { id: 'node-source' },
                    { id: 'node-target' },
                ],
                graphConnections: [
                    {
                        fromNode: 'node-source',
                        fromIndex: 0,
                        toNode: 'node-target',
                        toIndex: 0,
                    },
                ],
                nodeTypesByNodeId: {
                    'node-source': sourceNodeType,
                    'node-target': targetNodeType,
                },
            },
        });

        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].source, 'capabilityCheck');
        assert.match(result.issues[0].message, /Phase mismatch/);
    });

    it('no longer identifies a custom target id, but keeps the legacy metadata flag', () => {
        assert.equal(isCustomTargetSelection('custom', null), false);
        assert.equal(
            isCustomTargetSelection('esp32', {
                metadata: { isCustomTarget: true },
            }),
            true
        );
        assert.equal(isCustomTargetSelection('esp32', { metadata: {} }), false);
    });

    it('reports a missing general capability (viper) when unsupported', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-viper' },
            nodeType: { requiredCapabilities: ['viper'] },
            capabilities: { capabilityToPins: {}, generalCapabilities: {} },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].capability, 'viper');
        assert.equal(result.issues[0].message, 'Missing required capability: viper');
    });

    it('accepts a general capability (viper) when the target supports it', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-viper' },
            nodeType: { requiredCapabilities: ['viper'] },
            capabilities: {
                capabilityToPins: {},
                generalCapabilities: { viper: { supported: true } },
            },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.deepEqual(result.issues, []);
    });

    it('accepts an OR-group when at least one alternative is supported', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-web' },
            nodeType: { requiredCapabilities: [['wifi', 'ethernet']] },
            capabilities: {
                capabilityToPins: {},
                generalCapabilities: { wifi: { supported: true } },
            },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.deepEqual(result.issues, []);
    });

    it('reports an OR-group as missing when all alternatives are unsupported', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-web' },
            nodeType: { requiredCapabilities: [['wifi', 'ethernet']] },
            capabilities: { capabilityToPins: {}, generalCapabilities: {} },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].capability, 'wifi or ethernet');
        assert.equal(result.issues[0].message, 'Missing required capability: wifi or ethernet');
    });

    it('treats a general capability with supported:false as missing', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-viper' },
            nodeType: { requiredCapabilities: ['viper'] },
            capabilities: {
                capabilityToPins: {},
                generalCapabilities: { viper: { supported: false } },
            },
            targetId: 'esp32',
        });

        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].capability, 'viper');
    });

    it('falls back to the pin-capability check for unknown capability ids', () => {
        const result = validateNodeCapabilities({
            node: { id: 'node-unknown' },
            nodeType: { requiredCapabilities: ['some.unknown'] },
            capabilities: { capabilityToPins: { 'some.unknown': [1] } },
            targetId: 'esp32',
        });

        assert.equal(result.bypassed, false);
        assert.deepEqual(result.issues, []);
    });

    it('reports an advisory claim conflict for a claimed pin', () => {
        const result = validateNodeCapabilities({
            node: { id: 'n', controlValues: { pin: 43 } },
            nodeType: {
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'digital.output' }],
            },
            capabilities: {
                pinCapabilities: {
                    43: {
                        digital: { output: true },
                        claims: [
                            {
                                role: 'console.tx',
                                conflicts: ['digital.output'],
                                severity: 'warn',
                                note: 'UART0 TX bridged to the USB serial console; driving it as an output disables the console.',
                            },
                        ],
                    },
                },
            },
            targetId: 'esp32-s3-mini',
        });

        assert.equal(result.bypassed, false);
        assert.equal(result.issues.length, 1);
        assert.equal(result.issues[0].source, 'requiredCapabilities');
        assert.equal(result.issues[0].severity, 'warn');
        assert.match(result.issues[0].message, /UART0 TX \(console\)/);
    });

    it('does not report a claim conflict for a non-matching capability or unclaimed pin', () => {
        const capabilities = {
            pinCapabilities: {
                43: {
                    digital: { output: true },
                    claims: [
                        { role: 'console.tx', conflicts: ['pwm.output'], severity: 'warn', note: 'n' },
                    ],
                },
                21: { digital: { output: true } },
            },
        };

        const mismatched = validateNodeCapabilities({
            node: { id: 'n', controlValues: { pin: 43 } },
            nodeType: {
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'digital.output' }],
            },
            capabilities,
            targetId: 'esp32-s3-mini',
        });
        assert.deepEqual(mismatched.issues, []);

        const unclaimed = validateNodeCapabilities({
            node: { id: 'n', controlValues: { pin: 21 } },
            nodeType: {
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'digital.output' }],
            },
            capabilities,
            targetId: 'esp32-s3-mini',
        });
        assert.deepEqual(unclaimed.issues, []);
    });

describe('derived capability requirements', () => {
    /** Node type with one pin entry and optional declaration/condition. */
    function pinNodeType({ capability = 'dac', requiredCapabilities, controls, requiredWhen } = {}) {
        return {
            requiredCapabilities,
            controls: controls || [{ id: 'pin' }],
            resourceUsage: [
                {
                    kind: 'pin',
                    controlId: 'pin',
                    capability,
                    ...(requiredWhen ? { requiredWhen } : {}),
                },
            ],
        };
    }

    /** Validate one node against a literal target snapshot. */
    function issuesFor(nodeType, node, capabilities) {
        return validateNodeCapabilities({
            node: { id: 'n1', controlValues: node },
            nodeType,
            capabilities,
            targetId: 'stub',
        }).issues;
    }

    const dacLess = { capabilityToPins: { 'digital.output': [2] } };
    const dacCapable = { capabilityToPins: { dac: [25, 26] } };

    it('reports one node issue instead of a per-pin line when the target has no DAC', () => {
        const issues = issuesFor(pinNodeType(), { pin: 25 }, dacLess);

        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'node');
        assert.equal(issues[0].capability, 'dac');
        assert.equal(issues[0].message, 'Missing required capability: dac');
        assert.equal(issues[0].source, 'requiredCapabilities');
        assert.equal(
            issues.some((issue) => /does not support/.test(issue.message)),
            false
        );
    });

    it('reports the same node issue for a cleared or unset pin', () => {
        for (const controlValues of [{ pin: null }, {}]) {
            const issues = issuesFor(pinNodeType(), controlValues, dacLess);
            assert.equal(issues.length, 1, JSON.stringify(controlValues));
            assert.equal(issues[0].message, 'Missing required capability: dac');
        }
    });

    it('reports nothing when the target has DAC pins and the pin is valid', () => {
        assert.deepEqual(issuesFor(pinNodeType(), { pin: 25 }, dacCapable), []);
    });

    it('keeps the per-pin line for a genuinely bad pin on a DAC-capable target', () => {
        const issues = issuesFor(pinNodeType(), { pin: 1 }, dacCapable);

        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'control');
        assert.equal(issues[0].message, 'Pin 1 does not support dac.');
        assert.equal(
            issues.some((issue) => issue.scope === 'node'),
            false
        );
    });

    it('keeps the per-pin line when an OR-group alternative is available', () => {
        const nodeType = pinNodeType({ requiredCapabilities: [['dac', 'pwm.output']] });
        const issues = issuesFor(nodeType, { pin: 25 }, { capabilityToPins: { 'pwm.output': [2] } });

        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'control');
        assert.equal(issues[0].message, 'Pin 25 does not support dac.');
    });

    it('suppresses the per-pin line when the whole OR-group is missing', () => {
        const nodeType = pinNodeType({ requiredCapabilities: [['dac', 'pwm.output']] });
        const issues = issuesFor(nodeType, { pin: 25 }, dacLess);

        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'node');
        assert.equal(issues[0].message, 'Missing required capability: dac or pwm.output');
    });

    it('suppresses a handler-emitted line for a missing capability', () => {
        const original = globalThis.NodeCapabilityChecks;
        try {
            globalThis.NodeCapabilityChecks = {
                dacStub: () => [
                    {
                        scope: 'control',
                        controlId: 'pin',
                        capability: 'dac',
                        message: 'Pin 25 does not support dac.',
                    },
                ],
            };

            const nodeType = {
                capabilityCheck: 'NodeCapabilityChecks.dacStub',
                controls: [{ id: 'pin' }],
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'dac' }],
            };
            const issues = issuesFor(nodeType, { pin: 25 }, dacLess);

            assert.equal(issues.length, 1);
            assert.equal(issues[0].message, 'Missing required capability: dac');
        } finally {
            globalThis.NodeCapabilityChecks = original;
        }
    });

    it('keeps handler findings beside the declaration (servo shape)', () => {
        const original = globalThis.NodeCapabilityChecks;
        try {
            globalThis.NodeCapabilityChecks = {
                servoStub: () => [
                    {
                        scope: 'control',
                        controlId: 'pin',
                        capability: 'pwm.output',
                        message: 'Pin 5 does not support PWM on the active target.',
                    },
                    {
                        scope: 'node',
                        message: 'Pin 5 does not support PWM on the active target.',
                    },
                ],
            };

            const nodeType = {
                requiredCapabilities: ['pwm.output'],
                capabilityCheck: 'NodeCapabilityChecks.servoStub',
            };
            const issues = issuesFor(nodeType, { pin: 5 }, dacLess);
            const nodeScoped = issues.filter((issue) => issue.scope === 'node');

            assert.equal(nodeScoped.length, 2);
            assert.ok(nodeScoped.some((issue) => issue.source === 'requiredCapabilities'));
            assert.ok(nodeScoped.some((issue) => issue.source === 'capabilityCheck'));
            assert.equal(
                issues.some(
                    (issue) =>
                        issue.scope === 'control' &&
                        /Pin 5 does not support PWM/.test(issue.message)
                ),
                false
            );
        } finally {
            globalThis.NodeCapabilityChecks = original;
        }
    });

    it('never requires a pin whose control is optional', () => {
        const nodeType = pinNodeType({
            controls: [{ id: 'pin', dynamicOptions: { allowNone: true } }],
        });

        assert.deepEqual(issuesFor(nodeType, {}, dacLess), []);
        assert.deepEqual(issuesFor(nodeType, { pin: 25 }, dacLess), []);
    });

    it('requires a conditional pin only while the condition matches', () => {
        const nodeType = pinNodeType({
            controls: [{ id: 'pin' }, { id: 'mode' }],
            requiredWhen: { controlId: 'mode', equals: 'output' },
        });

        const matched = issuesFor(nodeType, { pin: 25, mode: 'output' }, dacLess);
        assert.equal(matched.length, 1);
        assert.equal(matched[0].message, 'Missing required capability: dac');

        assert.deepEqual(issuesFor(nodeType, { pin: 25, mode: 'input' }, dacLess), []);
    });

    it('stays bypassed on an open pin set', () => {
        const result = validateNodeCapabilities({
            node: { id: 'n1', controlValues: { pin: 25 } },
            nodeType: pinNodeType(),
            capabilities: { openPins: { min: 0, max: 255 } },
            targetId: 'stub',
        });

        assert.equal(result.bypassed, true);
        assert.deepEqual(result.issues, []);
    });
});

});
