import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

function buildTarget() {
    return new DeviceTargetInfo({
        targetId: 'esp32-test',
        pinCapabilities: {
            1: { label: 'GPIO1', adc: { unit: 1, channel: 0, resolution_bits: 12 } },
            11: { label: 'GPIO11', adc: { unit: 2, wifiConflict: true } },
            4: { label: 'GPIO4', i2s: { controller: 0, roles: ['bclk'] } },
            25: { label: 'GPIO25', dac: { channel: 1, resolution_bits: 8 } },
            2: { label: 'GPIO2', touch: { channel: 2 }, rtc: { gpio: true } },
            5: {
                label: 'GPIO5',
                digital: { input: true, output: true, openDrain: true },
                pullValuesOhm: { up: 45000, down: 45000 },
            },
            0: { label: 'GPIO0', strapping: { role: 'boot', safeLevel: 'high' } },
            26: { label: 'GPIO26', reserved: { reason: 'psram' } },
            3: {
                label: 'GPIO3',
                voltage: { maxV: 3.3, tolerant5v: false, analogMaxV: 3.3 },
                peripherals: { can: { bus: 'can0', role: 'rx' } },
            },
            9: {
                label: 'GPIO9',
                digital: { input: true, output: true },
                pull: ['up'],
                fixedPull: 'up',
            },
        },
    });
}

describe('DeviceTargetInfo extended pin fields', () => {
    it('normalizes adc unit and wifi conflict', () => {
        const target = buildTarget();

        assert.equal(target.pinCapabilities.get(1).adc.unit, 1);
        assert.equal(target.pinCapabilities.get(1).adc.channel, 0);
        assert.equal(target.pinCapabilities.get(11).adc.unit, 2);
        assert.equal(target.pinCapabilities.get(11).adc.wifiConflict, true);
    });

    it('normalizes i2s, dac, touch and rtc capabilities', () => {
        const target = buildTarget();

        assert.deepEqual(target.pinCapabilities.get(4).i2s, { controller: 0, roles: ['bclk'] });
        assert.deepEqual(target.pinCapabilities.get(25).dac, { channel: 1, resolution_bits: 8 });
        assert.deepEqual(target.pinCapabilities.get(2).touch, { channel: 2 });
        assert.deepEqual(target.pinCapabilities.get(2).rtc, { gpio: true });
    });

    it('normalizes open-drain, pull values, strapping, reserved and voltage', () => {
        const target = buildTarget();

        assert.equal(target.pinCapabilities.get(5).digital.openDrain, true);
        assert.deepEqual(target.pinCapabilities.get(5).pullValuesOhm, { up: 45000, down: 45000 });
        assert.deepEqual(target.pinCapabilities.get(0).strapping, {
            role: 'boot',
            safeLevel: 'high',
        });
        assert.deepEqual(target.pinCapabilities.get(26).reserved, { reason: 'psram' });
        assert.deepEqual(target.pinCapabilities.get(3).voltage, {
            maxV: 3.3,
            analogMaxV: 3.3,
        });
    });

    it('defaults new fields to null/false/{} when absent', () => {
        const target = new DeviceTargetInfo({
            targetId: 'esp32-test',
            pinCapabilities: { 7: { label: 'GPIO7' } },
        });

        const pin = target.pinCapabilities.get(7);
        assert.equal(pin.digital.openDrain, false);
        assert.equal(pin.pullValuesOhm, null);
        assert.equal(pin.adc, null);
        assert.equal(pin.dac, null);
        assert.equal(pin.touch, null);
        assert.equal(pin.i2s, null);
        assert.equal(pin.rtc, null);
        assert.equal(pin.strapping, null);
        assert.equal(pin.reserved, null);
        assert.equal(pin.voltage, null);
        assert.deepEqual(pin.peripherals, {});
        assert.equal(pin.fixedPull, null);
    });

    it('normalizes fixedPull to up/down or null', () => {
        const target = buildTarget();
        assert.equal(target.pinCapabilities.get(9).fixedPull, 'up');

        const bogus = new DeviceTargetInfo({
            targetId: 'esp32-test',
            pinCapabilities: {
                1: { label: 'GPIO1', fixedPull: 'bogus' },
                2: { label: 'GPIO2', fixedPull: 'down' },
                3: { label: 'GPIO3' },
            },
        });
        assert.equal(bogus.pinCapabilities.get(1).fixedPull, null);
        assert.equal(bogus.pinCapabilities.get(2).fixedPull, 'down');
        assert.equal(bogus.pinCapabilities.get(3).fixedPull, null);
    });

    it('rejects invalid enum/number values with safe defaults', () => {
        const target = new DeviceTargetInfo({
            targetId: 'esp32-test',
            pinCapabilities: {
                1: { adc: { unit: 3 } },
                2: { strapping: { role: 'boot', safeLevel: 'nope' } },
                3: { i2s: { roles: [] } },
            },
        });

        assert.equal(target.pinCapabilities.get(1).adc, null);
        assert.equal(target.pinCapabilities.get(2).strapping, null);
        assert.equal(target.pinCapabilities.get(3).i2s, null);
    });

    it('derives keys for new aggregates and peripherals', () => {
        const target = buildTarget();

        assert.equal(target.hasPinCapability(4, 'i2s'), true);
        assert.equal(target.hasPinCapability(4, 'i2s.bclk'), true);
        assert.equal(target.hasPinCapability(25, 'dac'), true);
        assert.equal(target.hasPinCapability(2, 'touch'), true);
        assert.equal(target.hasPinCapability(2, 'rtc'), true);
        assert.equal(target.hasPinCapability(3, 'can'), true);
        assert.equal(target.hasPinCapability(3, 'can.rx'), true);
        assert.equal(target.hasPinCapability(3, 'can.tx'), false);
    });

    it('migrates esp32_wroom.json to the extended schema', async () => {
        const payload = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'esp32_wroom.json'
        );
        const target = new DeviceTargetInfo(payload);

        assert.equal(target.pinCapabilities.get(32).adc.unit, 1);
        assert.equal(target.pinCapabilities.get(25).dac.channel, 1);
        assert.equal(target.pinCapabilities.get(0).strapping.role, 'boot');
        assert.equal(target.metadata.defaultI2cBus, 'i2c0');
        assert.equal(target.metadata.defaultSpiBus, 'vspi');

        assert.equal(target.resources.pwm.channels, 16);
        assert.equal(target.resources.pwm.timers, 8);
        assert.equal(target.resources.adc.units, 2);
        assert.deepEqual(target.resources.adc.channelsPerUnit, { '1': 8, '2': 10 });
        assert.deepEqual(target.resources.adc.wifiConflictedUnits, [2]);
        assert.equal(target.resources.dac.channels, 2);
        assert.equal(target.resources.touch.channels, 10);
        assert.equal(target.resources.uart.ports, 3);
        assert.equal(target.resources.i2c.buses, 2);
        assert.equal(target.resources.spi.buses, 2);
        assert.equal(target.resources.i2s.controllers, 2);
    });
});
