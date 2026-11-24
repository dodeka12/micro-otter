import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

describe('Arduino Uno proof-of-extensibility target', () => {
    it('loads through DeviceTargetInfo with core fields only', async () => {
        const payload = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'arduino_uno.json'
        );
        const target = new DeviceTargetInfo(payload);

        assert.equal(target.pinCapabilities.get(3).pwm.output, true);
        assert.equal(target.pinCapabilities.get(2).pwm, null);
        assert.equal(target.hasPinCapability(3, 'pwm.output'), true);
        assert.equal(target.hasPinCapability(2, 'pwm.output'), false);
        assert.equal(target.hasPinCapability(18, 'i2c.sda'), true);
        assert.equal(target.hasPinCapability(14, 'adc'), true);
    });
});
