import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { validateNodeCapabilities } from '../../src/micro_otter/nodes/html/js/core/node-capability-validator.js';
import { validateGraphResources } from '../../src/micro_otter/nodes/html/js/core/graph-resource-validator.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

describe('DeviceTargetInfo open pin set', () => {
    it('marks an open target and exposes the pin range', () => {
        const target = new DeviceTargetInfo({ targetId: 'generic', openPins: { min: 0, max: 255 } });
        assert.equal(target.isOpenPinSet, true);
        assert.deepEqual(target.pinRange, { min: 0, max: 255 });
    });

    it('returns the full range for any capability key', () => {
        const target = new DeviceTargetInfo({ targetId: 'generic', openPins: { min: 0, max: 7 } });
        assert.deepEqual(target.getPinsForCapability('i2s.bclk'), [0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('synthesizes a permissive pin capability for any pin in range', () => {
        const target = new DeviceTargetInfo({ targetId: 'generic', openPins: { min: 0, max: 255 } });
        const pin = target.getPinCapability(12);
        assert.equal(pin.digital.input, true);
        assert.equal(pin.digital.output, true);
        assert.deepEqual(pin.pull, ['up', 'down']);
        assert.equal(pin.fixedPull, null);
        assert.equal(target.getPinCapability(256), null);
    });

    it('reports any in-range pin as capable', () => {
        const target = new DeviceTargetInfo({ targetId: 'generic', openPins: { min: 0, max: 255 } });
        assert.equal(target.hasPinCapability(200, 'digital.input'), true);
        assert.equal(target.hasPinCapability(256, 'digital.input'), false);
    });

    it('rejects invalid ranges', () => {
        assert.equal(new DeviceTargetInfo({ openPins: { min: 5, max: 2 } }).isOpenPinSet, false);
        assert.equal(new DeviceTargetInfo({ openPins: { min: -1, max: 5 } }).isOpenPinSet, false);
        assert.equal(new DeviceTargetInfo({}).isOpenPinSet, false);
    });

    it('loads the generic_micropython target as an open pin set', async () => {
        const payload = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'generic_micropython.json'
        );
        const target = new DeviceTargetInfo(payload);
        assert.equal(target.isOpenPinSet, true);
        assert.deepEqual(target.pinRange, { min: 0, max: 255 });
        assert.equal(target.getPinsForCapability('i2s.bclk').length, 256);
        assert.equal(target.resources.i2s.controllers, 2);
    });
});

describe('open pin set validation bypass', () => {
    it('bypasses per-node capability validation', () => {
        const result = validateNodeCapabilities({
            node: { id: 'n1', controlValues: { pin: 200 } },
            nodeType: {
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'digital.input' }],
            },
            capabilities: { capabilityToPins: {}, openPins: { min: 0, max: 255 } },
            targetId: 'generic',
        });
        assert.equal(result.bypassed, true);
        assert.deepEqual(result.issues, []);
    });

    it('bypasses graph resource validation', () => {
        const target = new DeviceTargetInfo({ targetId: 'generic', openPins: { min: 0, max: 255 } });
        const issues = validateGraphResources({
            target,
            graphNodes: [{ id: 'n1' }],
            nodeTypesByNodeId: {
                n1: { resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'digital.input' }] },
            },
        });
        assert.deepEqual(issues, []);
    });

    it('does not bypass a regular target without openPins', () => {
        const result = validateNodeCapabilities({
            node: { id: 'n1', controlValues: { pin: 99 } },
            nodeType: {
                resourceUsage: [{ kind: 'pin', controlId: 'pin', capability: 'digital.input' }],
            },
            capabilities: { capabilityToPins: { 'digital.input': [1, 2] } },
            targetId: 'esp32',
        });
        assert.equal(result.bypassed, false);
        assert.ok(result.issues.length > 0);
    });
});
