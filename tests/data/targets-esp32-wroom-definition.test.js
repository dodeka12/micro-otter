import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

function targetPath() {
    return ['src', 'micro_otter', 'nodes', 'device', 'targets', 'esp32_wroom.json'];
}

describe('ESP32-WROOM target definition', () => {
    it('exposes matrix-routed pins, touch, and both ADC units', async () => {
        const payload = await loadJsonFixture(...targetPath());
        const target = new DeviceTargetInfo(payload);

        for (const key of ['i2s.bclk', 'i2c.sda', 'uart.tx', 'spi.sck']) {
            const pins = target.getPinsForCapability(key);
            assert.ok(Array.isArray(pins) && pins.length > 15, `${key} should have many pins`);
        }

        assert.equal(target.getPinsForCapability('touch').length, 10);
        assert.equal(target.getPinsForCapability('adc.unit1').length, 6);
        assert.equal(target.getPinsForCapability('adc.unit2').length, 10);
        assert.equal(target.getPinsForCapability('dac').length, 2);

        // input-only pins (34-39) are not output-routed
        assert.equal(target.hasPinCapability(34, 'i2s.dout'), false);
        assert.equal(target.hasPinCapability(34, 'i2s.din'), true);
        assert.equal(target.hasPinCapability(34, 'i2c.sda'), false);
        assert.equal(target.hasPinCapability(34, 'uart.rx'), true);
        assert.equal(target.hasPinCapability(34, 'uart.tx'), false);

        // flash pins (6-11) are not routable
        assert.equal(target.hasPinCapability(6, 'digital.output'), false);
        assert.equal(target.hasPinCapability(6, 'i2s.bclk'), false);
    });
});
