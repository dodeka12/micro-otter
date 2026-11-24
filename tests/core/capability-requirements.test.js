import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    evaluateRequiredCapabilities,
    createPackageCapabilityContext,
    getResourceValue,
    resolveNodeCapabilityRequirements,
} from '../../src/micro_otter/nodes/html/js/core/capability-requirements.js';
import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../fixtures/capability-requirements.json'), 'utf8')
);

function buildContext(capabilities) {
    const statusOf = (capability) => capabilities?.[capability] ?? 'pin-absent';
    return {
        isGeneral(capability) {
            return statusOf(capability).startsWith('general');
        },
        hasGeneralCapability(capability) {
            return statusOf(capability) === 'general-supported';
        },
        hasPinCapability(capability) {
            return statusOf(capability) === 'pin-present';
        },
    };
}

describe('evaluateRequiredCapabilities', () => {
    for (const testCase of fixture.cases) {
        it(testCase.name, () => {
            const result = evaluateRequiredCapabilities(
                testCase.requirements,
                buildContext(testCase.capabilities)
            );
            assert.equal(result.satisfied, testCase.satisfied);
            assert.deepEqual(result.missing, testCase.missing);
        });
    }

    it('treats a non-array requirement list as empty', () => {
        assert.equal(evaluateRequiredCapabilities(null, buildContext({})).satisfied, true);
        assert.equal(evaluateRequiredCapabilities('viper', buildContext({})).satisfied, true);
    });
});

describe('getResourceValue', () => {
    it('reads dotted resource paths', () => {
        const resources = { i2s: { controllers: 2 }, pwm: { channels: 8 } };
        assert.equal(getResourceValue(resources, 'i2s.controllers'), 2);
        assert.equal(getResourceValue(resources, 'pwm.channels'), 8);
        assert.equal(getResourceValue(resources, 'pwm.missing'), null);
        assert.equal(getResourceValue(null, 'i2s.controllers'), null);
    });
});

describe('resolveNodeCapabilityRequirements', () => {
    function pinNode(controlValues = { pin: 25 }) {
        return { id: 'n1', controlValues };
    }

    function nodeType({ requiredCapabilities, controls, resourceUsage } = {}) {
        return { requiredCapabilities, controls, resourceUsage };
    }

    const dacEntry = { kind: 'pin', controlId: 'pin', capability: 'dac' };

    it('derives a requirement from a pin entry', () => {
        const result = resolveNodeCapabilityRequirements(
            nodeType({ controls: [{ id: 'pin' }], resourceUsage: [dacEntry] }),
            pinNode({ pin: 25 })
        );
        assert.deepEqual(result, ['dac']);
    });

    it('treats an allowNone control as optional', () => {
        const result = resolveNodeCapabilityRequirements(
            nodeType({
                controls: [
                    {
                        id: 'pin',
                        dynamicOptions: {
                            source: 'targetPinsForCapability',
                            capabilityKey: 'dac',
                            allowNone: true,
                        },
                    },
                ],
                resourceUsage: [dacEntry],
            }),
            pinNode({ pin: 25 })
        );
        assert.deepEqual(result, []);
    });

    it('returns an empty list for empty or absent declarations', () => {
        assert.deepEqual(
            resolveNodeCapabilityRequirements(nodeType({ resourceUsage: [] }), pinNode()),
            []
        );
        assert.deepEqual(resolveNodeCapabilityRequirements(nodeType(), pinNode()), []);
    });

    it('ignores bus entries and incomplete pin entries', () => {
        const resourceUsage = [
            { kind: 'bus', type: 'i2c', bus: 'i2c0' },
            { kind: 'pin', controlId: 'pin' },
            { kind: 'pin', capability: 'dac' },
        ];
        assert.deepEqual(
            resolveNodeCapabilityRequirements(nodeType({ resourceUsage }), pinNode()),
            []
        );
    });

    it('puts declared requirements before derived ones', () => {
        const result = resolveNodeCapabilityRequirements(
            nodeType({ requiredCapabilities: ['viper'], resourceUsage: [dacEntry] }),
            pinNode()
        );
        assert.deepEqual(result, ['viper', 'dac']);
    });

    it('preserves an OR-group declaration as one group', () => {
        const result = resolveNodeCapabilityRequirements(
            nodeType({
                requiredCapabilities: [['wifi', 'ethernet']],
                resourceUsage: [dacEntry],
            }),
            pinNode()
        );
        assert.equal(result.length, 2);
        assert.deepEqual(result[0], ['wifi', 'ethernet']);
        assert.equal(result[1], 'dac');
    });

    it('does not duplicate a declared key', () => {
        const result = resolveNodeCapabilityRequirements(
            nodeType({ requiredCapabilities: ['dac'], resourceUsage: [dacEntry] }),
            pinNode()
        );
        assert.deepEqual(result, ['dac']);
    });

    it('collapses repeated keys into one group', () => {
        const resourceUsage = [
            { kind: 'pin', controlId: 'redPin', capability: 'pwm.output' },
            { kind: 'pin', controlId: 'greenPin', capability: 'pwm.output' },
            { kind: 'pin', controlId: 'bluePin', capability: 'pwm.output' },
        ];
        assert.deepEqual(
            resolveNodeCapabilityRequirements(nodeType({ resourceUsage }), pinNode()),
            ['pwm.output']
        );
    });

    it('honours a requiredWhen equals condition', () => {
        const resourceUsage = [
            { ...dacEntry, requiredWhen: { controlId: 'mode', equals: 'output' } },
        ];
        assert.deepEqual(
            resolveNodeCapabilityRequirements(
                nodeType({ resourceUsage }),
                pinNode({ pin: 25, mode: 'output' })
            ),
            ['dac']
        );
        assert.deepEqual(
            resolveNodeCapabilityRequirements(
                nodeType({ resourceUsage }),
                pinNode({ pin: 25, mode: 'input' })
            ),
            []
        );
        assert.deepEqual(
            resolveNodeCapabilityRequirements(nodeType({ resourceUsage }), pinNode({ pin: 25 })),
            []
        );
    });

    it('honours a requiredWhen in condition', () => {
        const resourceUsage = [
            {
                ...dacEntry,
                requiredWhen: { controlId: 'mode', in: ['output', 'bidirectional'] },
            },
        ];
        assert.deepEqual(
            resolveNodeCapabilityRequirements(
                nodeType({ resourceUsage }),
                pinNode({ pin: 25, mode: 'bidirectional' })
            ),
            ['dac']
        );
        assert.deepEqual(
            resolveNodeCapabilityRequirements(
                nodeType({ resourceUsage }),
                pinNode({ pin: 25, mode: 'input' })
            ),
            []
        );
    });

    it('derives a condition that names an unknown control when the value matches', () => {
        const resourceUsage = [{ ...dacEntry, requiredWhen: { controlId: 'ghost', equals: 'on' } }];
        const result = resolveNodeCapabilityRequirements(
            nodeType({ controls: [{ id: 'pin' }], resourceUsage }),
            pinNode({ pin: 25, ghost: 'on' })
        );
        assert.deepEqual(result, ['dac']);
    });

    it('returns an empty list without throwing for malformed input', () => {
        assert.deepEqual(resolveNodeCapabilityRequirements(null, null), []);
        assert.deepEqual(resolveNodeCapabilityRequirements(undefined, undefined), []);
        assert.deepEqual(
            resolveNodeCapabilityRequirements(
                nodeType({ controls: [{ id: 'pin' }], resourceUsage: [dacEntry] }),
                null
            ),
            ['dac']
        );
    });
});

describe('createPackageCapabilityContext', () => {
    it('resolves presence from the ESP32-S3 target', () => {
        const s3 = JSON.parse(
            fs.readFileSync(
                path.join(
                    __dirname,
                    '../../src/micro_otter/nodes/device/targets/esp32_s3.json'
                ),
                'utf8'
            )
        );
        const target = new DeviceTargetInfo(s3);
        const context = createPackageCapabilityContext(target);

        assert.equal(context.isGeneral('viper'), true);
        assert.equal(context.isGeneral('wifi'), true);
        assert.equal(context.isGeneral('ethernet'), true);
        assert.equal(context.isGeneral('i2s'), false);

        assert.equal(context.hasGeneralCapability('viper'), true);
        assert.equal(context.hasGeneralCapability('wifi'), true);
        assert.equal(context.hasGeneralCapability('ethernet'), false);

        assert.equal(context.hasPinCapability('i2s'), true);
        assert.equal(context.hasPinCapability('i2c'), true);
        assert.equal(context.hasPinCapability('spi'), true);
        assert.equal(context.hasPinCapability('uart'), true);
    });
});
