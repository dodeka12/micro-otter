import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { validateGraphResources } from '../../src/micro_otter/nodes/html/js/core/graph-resource-validator.js';

function makeTarget(resources) {
    return new DeviceTargetInfo({
        targetId: 'esp32-s3',
        resources,
        pinCapabilities: {
            1: { adc: { unit: 1 } },
            11: { adc: { unit: 2 } },
            5: { pwm: { output: true } },
            6: { pwm: { output: true } },
            7: { pwm: { output: true } },
        },
    });
}

describe('validateGraphResources', () => {
    it('detects pin-function conflicts', () => {
        const target = makeTarget({ pwm: { channels: 8 } });
        const issues = validateGraphResources({
            target,
            graphNodes: [
                { id: 'a', controlValues: { pin: 5 } },
                { id: 'b', controlValues: { pin: 5 } },
            ],
            nodeTypesByNodeId: {
                a: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
                b: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'adc.unit1' }] },
            },
        });

        assert.ok(issues.some((issue) => /multiple capabilities/.test(issue.message)));
    });

    it('flags same-capability reuse of a pin as a duplicate', () => {
        const target = makeTarget({ pwm: { channels: 8 } });
        const issues = validateGraphResources({
            target,
            graphNodes: [
                { id: 'a', controlValues: { pin: 5 } },
                { id: 'b', controlValues: { pin: 5 } },
            ],
            nodeTypesByNodeId: {
                a: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
                b: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
            },
        });

        assert.equal(issues.length, 1);
        assert.match(issues[0].message, /Pin 5 is used as pwm\.output by 2 nodes/);
    });

    it('does not emit a duplicate issue for a single node on a pin', () => {
        const target = makeTarget({ pwm: { channels: 8 } });
        const issues = validateGraphResources({
            target,
            graphNodes: [{ id: 'a', controlValues: { pin: 5 } }],
            nodeTypesByNodeId: {
                a: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
            },
        });

        assert.equal(issues.length, 0);
    });

    it('warns when shared-pool limits are exceeded', () => {
        const target = makeTarget({ pwm: { channels: 2 } });
        const issues = validateGraphResources({
            target,
            graphNodes: [
                { id: 'a', controlValues: { pin: 5 } },
                { id: 'b', controlValues: { pin: 6 } },
                { id: 'c', controlValues: { pin: 7 } },
            ],
            nodeTypesByNodeId: {
                a: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
                b: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
                c: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
            },
        });

        assert.ok(issues.some((issue) => /pwm\.channels/.test(issue.message)));
    });

    it('silences pool exhaustion when the limit is null', () => {
        const target = makeTarget({ pwm: { channels: null } });
        const issues = validateGraphResources({
            target,
            graphNodes: [
                { id: 'a', controlValues: { pin: 5 } },
                { id: 'b', controlValues: { pin: 6 } },
                { id: 'c', controlValues: { pin: 7 } },
            ],
            nodeTypesByNodeId: {
                a: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
                b: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
                c: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'pwm.output' }] },
            },
        });

        assert.equal(issues.length, 0);
    });

    it('enforces per-instance limits independently', () => {
        const target = new DeviceTargetInfo({
            targetId: 'esp32-s3',
            resources: { adc: { channelsPerUnit: { 1: 2, 2: 3 } } },
            pinCapabilities: {
                1: { adc: { unit: 1 } },
                2: { adc: { unit: 1 } },
                3: { adc: { unit: 1 } },
                11: { adc: { unit: 2 } },
                12: { adc: { unit: 2 } },
                13: { adc: { unit: 2 } },
                14: { adc: { unit: 2 } },
            },
        });
        const pins = [1, 2, 3, 11, 12, 13, 14];
        const nodeTypes = Object.fromEntries(
            pins.map((pin) => [
                `n${pin}`,
                {
                    resourceUsage: [
                        {
                            kind: 'pin',
                            controlId: 'pin',
                            capability: pin < 10 ? 'adc.unit1' : 'adc.unit2',
                        },
                    ],
                },
            ])
        );
        const graphNodes = pins.map((pin) => ({ id: `n${pin}`, controlValues: { pin } }));

        const issues = validateGraphResources({ target, graphNodes, nodeTypesByNodeId: nodeTypes });

        assert.ok(
            issues.some(
                (issue) =>
                    /adc\.channelsPerUnit/.test(issue.message) && /instance '1'/.test(issue.message)
            )
        );
        assert.ok(
            issues.some(
                (issue) =>
                    /adc\.channelsPerUnit/.test(issue.message) && /instance '2'/.test(issue.message)
            )
        );
    });

    it('does not flag per-instance usage within an asymmetric limit', () => {
        const target = new DeviceTargetInfo({
            targetId: 'esp32-s3',
            resources: { adc: { channelsPerUnit: { 1: 2, 2: 3 } } },
            pinCapabilities: {
                1: { adc: { unit: 1 } },
                2: { adc: { unit: 1 } },
                11: { adc: { unit: 2 } },
                12: { adc: { unit: 2 } },
                13: { adc: { unit: 2 } },
            },
        });
        const pins = [1, 2, 11, 12, 13];
        const nodeTypes = Object.fromEntries(
            pins.map((pin) => [
                `n${pin}`,
                {
                    resourceUsage: [
                        {
                            kind: 'pin',
                            controlId: 'pin',
                            capability: pin < 10 ? 'adc.unit1' : 'adc.unit2',
                        },
                    ],
                },
            ])
        );
        const graphNodes = pins.map((pin) => ({ id: `n${pin}`, controlValues: { pin } }));

        const issues = validateGraphResources({ target, graphNodes, nodeTypesByNodeId: nodeTypes });

        assert.equal(issues.length, 0);
    });

    it('fires the ADC2/WiFi constraint only when both conditions hold', () => {
        const target = makeTarget({});
        const nodeTypes = {
            adc: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'adc.unit2' }] },
            wifi: { requiredCapabilities: ['wifi'] },
        };

        const withWifi = validateGraphResources({
            target,
            graphNodes: [
                { id: 'adc', controlValues: { pin: 11 } },
                { id: 'wifi', controlValues: {} },
            ],
            nodeTypesByNodeId: nodeTypes,
        });
        assert.ok(withWifi.some((issue) => /forbidden while wifi/.test(issue.message)));

        const withoutWifi = validateGraphResources({
            target,
            graphNodes: [{ id: 'adc', controlValues: { pin: 11 } }],
            nodeTypesByNodeId: { adc: nodeTypes.adc },
        });
        assert.equal(withoutWifi.length, 0);
    });

    it('produces no issues when nothing declares resourceUsage', () => {
        const target = makeTarget({});
        const issues = validateGraphResources({
            target,
            graphNodes: [{ id: 'a', controlValues: { pin: 5 } }],
            nodeTypesByNodeId: { a: { requiredCapabilities: ['pwm.output'] } },
        });

        assert.equal(issues.length, 0);
    });

    it('counts i2s controllers by bus usage, not by pin roles', () => {
        const target = makeTarget({ i2s: { controllers: 2 } });

        const micResourceUsage = [
            { kind: 'pin', controlId: 'bclkPin', capability: 'i2s.bclk' },
            { kind: 'pin', controlId: 'wsPin', capability: 'i2s.ws' },
            { kind: 'pin', controlId: 'dataPin', capability: 'i2s.din' },
            { kind: 'bus', type: 'i2s', controlId: 'i2sId' },
        ];
        const spkResourceUsage = [
            { kind: 'pin', controlId: 'bclkPin', capability: 'i2s.bclk' },
            { kind: 'pin', controlId: 'wsPin', capability: 'i2s.ws' },
            { kind: 'pin', controlId: 'dataPin', capability: 'i2s.dout' },
            { kind: 'bus', type: 'i2s', controlId: 'i2sId' },
        ];

        const mic = { id: 'mic', controlValues: { i2sId: 0, bclkPin: 4, wsPin: 5, dataPin: 7 } };
        const spk = { id: 'spk', controlValues: { i2sId: 1, bclkPin: 14, wsPin: 13, dataPin: 6 } };

        const issues = validateGraphResources({
            target,
            graphNodes: [mic, spk],
            nodeTypesByNodeId: {
                mic: { resourceUsage: micResourceUsage },
                spk: { resourceUsage: spkResourceUsage },
            },
        });
        assert.equal(issues.length, 0);

        const third = { id: 'third', controlValues: { i2sId: 2, bclkPin: 16, wsPin: 15, dataPin: 7 } };
        const withThird = validateGraphResources({
            target,
            graphNodes: [mic, spk, third],
            nodeTypesByNodeId: {
                mic: { resourceUsage: micResourceUsage },
                spk: { resourceUsage: spkResourceUsage },
                third: { resourceUsage: micResourceUsage },
            },
        });
        assert.ok(withThird.some((issue) => /i2s\.controllers/.test(issue.message)));
    });

    it('flags I2S clock-pin sharing across different controllers', () => {
        const target = makeTarget({ i2s: { controllers: 2 } });
        const micResourceUsage = [
            { kind: 'pin', controlId: 'bclkPin', capability: 'i2s.bclk' },
            { kind: 'pin', controlId: 'wsPin', capability: 'i2s.ws' },
            { kind: 'pin', controlId: 'dataPin', capability: 'i2s.din' },
            { kind: 'bus', type: 'i2s', controlId: 'i2sId' },
        ];
        const spkResourceUsage = [
            { kind: 'pin', controlId: 'bclkPin', capability: 'i2s.bclk' },
            { kind: 'pin', controlId: 'wsPin', capability: 'i2s.ws' },
            { kind: 'pin', controlId: 'dataPin', capability: 'i2s.dout' },
            { kind: 'bus', type: 'i2s', controlId: 'i2sId' },
        ];

        const issues = validateGraphResources({
            target,
            graphNodes: [
                { id: 'mic', controlValues: { i2sId: 0, bclkPin: 4, wsPin: 5, dataPin: 7 } },
                { id: 'spk', controlValues: { i2sId: 1, bclkPin: 4, wsPin: 5, dataPin: 6 } },
            ],
            nodeTypesByNodeId: {
                mic: { resourceUsage: micResourceUsage },
                spk: { resourceUsage: spkResourceUsage },
            },
        });

        assert.ok(issues.some((issue) => /I2S controllers/.test(issue.message)));
        assert.ok(issues.some((issue) => /BCLK pin/.test(issue.message)));
        assert.ok(issues.some((issue) => /WS pin/.test(issue.message)));
    });

    it('does not flag distinct I2S clock pins across controllers', () => {
        const target = makeTarget({ i2s: { controllers: 2 } });
        const micResourceUsage = [
            { kind: 'pin', controlId: 'bclkPin', capability: 'i2s.bclk' },
            { kind: 'pin', controlId: 'wsPin', capability: 'i2s.ws' },
            { kind: 'pin', controlId: 'dataPin', capability: 'i2s.din' },
            { kind: 'bus', type: 'i2s', controlId: 'i2sId' },
        ];
        const spkResourceUsage = [
            { kind: 'pin', controlId: 'bclkPin', capability: 'i2s.bclk' },
            { kind: 'pin', controlId: 'wsPin', capability: 'i2s.ws' },
            { kind: 'pin', controlId: 'dataPin', capability: 'i2s.dout' },
            { kind: 'bus', type: 'i2s', controlId: 'i2sId' },
        ];

        const issues = validateGraphResources({
            target,
            graphNodes: [
                { id: 'mic', controlValues: { i2sId: 0, bclkPin: 4, wsPin: 5, dataPin: 7 } },
                { id: 'spk', controlValues: { i2sId: 1, bclkPin: 14, wsPin: 13, dataPin: 6 } },
            ],
            nodeTypesByNodeId: {
                mic: { resourceUsage: micResourceUsage },
                spk: { resourceUsage: spkResourceUsage },
            },
        });

        assert.equal(issues.length, 0);
    });

    it('flags out-of-range i2s controller ids', () => {
        const target = makeTarget({ i2s: { controllers: 2 } });
        const nodeTypes = {
            mic: { resourceUsage: [{ kind: 'bus', type: 'i2s', controlId: 'i2sId' }] },
        };

        const issues = validateGraphResources({
            target,
            graphNodes: [{ id: 'mic', controlValues: { i2sId: 2 } }],
            nodeTypesByNodeId: nodeTypes,
        });

        assert.ok(issues.some((issue) => /out of range/.test(issue.message)));
    });

    it('flags exclusive bus reuse (two i2s nodes on the same controller)', () => {
        const target = makeTarget({ i2s: { controllers: 2 } });
        const resourceUsage = [
            { kind: 'pin', controlId: 'bclkPin', capability: 'i2s.bclk' },
            { kind: 'pin', controlId: 'wsPin', capability: 'i2s.ws' },
            { kind: 'pin', controlId: 'dataPin', capability: 'i2s.din' },
            { kind: 'bus', type: 'i2s', controlId: 'i2sId' },
        ];
        const mic = { id: 'mic', controlValues: { i2sId: 0, bclkPin: 4, wsPin: 5, dataPin: 7 } };
        const mic2 = { id: 'mic2', controlValues: { i2sId: 0, bclkPin: 4, wsPin: 5, dataPin: 7 } };

        const issues = validateGraphResources({
            target,
            graphNodes: [mic, mic2],
            nodeTypesByNodeId: {
                mic: { resourceUsage },
                mic2: { resourceUsage },
            },
        });

        assert.ok(issues.some((issue) => /exclusive/.test(issue.message)));
    });
});
