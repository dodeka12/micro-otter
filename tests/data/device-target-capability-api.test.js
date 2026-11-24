import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';

describe('DeviceTargetInfo capability API', () => {
    it('returns true when pin belongs to capability pin list', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            capabilityToPins: {
                'pwm.output': [5, 6, '7'],
            },
        });

        assert.equal(target.hasPinCapability(6, 'pwm.output'), true);
        assert.equal(target.hasPinCapability('7', 'pwm.output'), true);
        assert.equal(target.hasPinCapability(8, 'pwm.output'), false);
    });

    it('supports nested capability payloads', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            capabilityToPins: {
                i2c: [
                    {
                        sda: 21,
                        scl: 22,
                    },
                ],
            },
        });

        assert.equal(target.hasPinCapability(21, 'i2c'), true);
        assert.equal(target.hasPinCapability(22, 'i2c'), true);
        assert.equal(target.hasPinCapability(23, 'i2c'), false);
    });

    it('returns false for missing capability or invalid pin', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            capabilityToPins: {
                'pwm.output': [5],
            },
        });

        assert.equal(target.hasPinCapability(null, 'pwm.output'), false);
        assert.equal(target.hasPinCapability('abc', 'pwm.output'), false);
        assert.equal(target.hasPinCapability(5, ''), false);
        assert.equal(target.hasPinCapability(5, 'adc.read'), false);
    });
});

describe('DeviceTargetInfo granular capability keys', () => {
    it('derives role-level keys for uart, i2c and spi', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            pinCapabilities: {
                1: { uart: { port: 'uart0', roles: ['tx'] } },
                3: { uart: { port: 'uart0', roles: ['rx'] } },
                21: { i2c: { bus: 'i2c0', roles: ['sda'] } },
                22: { i2c: { bus: 'i2c0', roles: ['scl'] } },
                5: { spi: { bus: 'vspi', roles: ['cs'] } },
            },
        });

        assert.equal(target.hasPinCapability(1, 'uart.tx'), true);
        assert.equal(target.hasPinCapability(3, 'uart.rx'), true);
        assert.equal(target.hasPinCapability(1, 'uart.rx'), false);
        assert.equal(target.hasPinCapability(21, 'i2c.sda'), true);
        assert.equal(target.hasPinCapability(22, 'i2c.scl'), true);
        assert.equal(target.hasPinCapability(21, 'i2c.scl'), false);
        assert.equal(target.hasPinCapability(5, 'spi.cs'), true);
    });

    it('derives unit-level adc keys', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            pinCapabilities: {
                1: { adc: { unit: 1, channel: 0 } },
                11: { adc: { unit: 2, channel: 0 } },
            },
        });

        assert.equal(target.hasPinCapability(1, 'adc.unit1'), true);
        assert.equal(target.hasPinCapability(11, 'adc.unit2'), true);
        assert.equal(target.hasPinCapability(1, 'adc.unit2'), false);
        assert.equal(target.hasPinCapability(1, 'adc.wifiSafe'), true);
        assert.equal(target.hasPinCapability(11, 'adc.wifiSafe'), false);
    });

    it('emits bus-qualified keys only when the flag is on', () => {
        const base = {
            id: 'esp32-test',
            pinCapabilities: {
                21: { i2c: { bus: 'i2c0', roles: ['sda'] } },
            },
        };

        const off = new DeviceTargetInfo(base);
        assert.equal(off.hasPinCapability(21, 'i2c.i2c0.sda'), false);

        const on = new DeviceTargetInfo(base, { emitBusQualifiedKeys: true });
        assert.equal(on.hasPinCapability(21, 'i2c.i2c0.sda'), true);
        assert.equal(on.hasPinCapability(21, 'i2c.i2c1.sda'), false);
    });
});

describe('DeviceTargetInfo multi-role pins', () => {
    it('derives every role key from a multi-role pin', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            pinCapabilities: {
                4: { uart: { roles: ['tx', 'rx'] }, i2s: { roles: ['bclk', 'ws'] } },
                5: { i2c: { roles: ['sda', 'scl'] } },
                6: { spi: { roles: ['mosi', 'miso', 'sck', 'cs'] } },
            },
        });

        assert.equal(target.hasPinCapability(4, 'uart.tx'), true);
        assert.equal(target.hasPinCapability(4, 'uart.rx'), true);
        assert.equal(target.hasPinCapability(4, 'i2s.bclk'), true);
        assert.equal(target.hasPinCapability(4, 'i2s.ws'), true);
        assert.equal(target.hasPinCapability(5, 'i2c.sda'), true);
        assert.equal(target.hasPinCapability(5, 'i2c.scl'), true);
        assert.equal(target.hasPinCapability(6, 'spi.mosi'), true);
        assert.equal(target.hasPinCapability(6, 'spi.miso'), true);
        assert.equal(target.hasPinCapability(6, 'spi.sck'), true);
        assert.equal(target.hasPinCapability(6, 'spi.cs'), true);

        assert.equal(target.hasPinCapability(4, 'uart'), true);
        assert.equal(target.hasPinCapability(5, 'i2c'), true);
        assert.equal(target.hasPinCapability(6, 'spi'), true);
        assert.equal(target.hasPinCapability(4, 'i2s'), true);
    });
});

describe('DeviceTargetInfo pin claims', () => {
    it('parses claims with defaults and drops invalid entries', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            pinCapabilities: {
                1: {
                    claims: [
                        { role: 'console.tx', conflicts: ['digital.output'], severity: 'info', note: 'n' },
                        { conflicts: ['pwm.output'] },
                        { role: 'foo', conflicts: [], severity: 'bogus' },
                        'not-an-object',
                    ],
                },
            },
        });

        const claims = target.pinCapabilities.get(1).claims;
        assert.equal(claims.length, 2);
        assert.deepEqual(claims[0], {
            role: 'console.tx',
            conflicts: ['digital.output'],
            severity: 'info',
            note: 'n',
        });
        assert.deepEqual(claims[1], { role: 'foo', conflicts: [], severity: 'warn', note: null });
    });

    it('returns an empty claims list for payloads without claims', () => {
        const target = new DeviceTargetInfo({ id: 't', pinCapabilities: { 1: {} } });
        assert.deepEqual(target.pinCapabilities.get(1).claims, []);
    });

    it('hasClaimConflict matches specific or empty conflicts', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            pinCapabilities: {
                1: { claims: [{ role: 'a', conflicts: ['digital.output'], severity: 'warn' }] },
                2: { claims: [{ role: 'b', conflicts: [], severity: 'info' }] },
            },
        });

        assert.equal(target.hasClaimConflict(1, 'digital.output').length, 1);
        assert.deepEqual(target.hasClaimConflict(1, 'digital.input'), []);
        assert.equal(target.hasClaimConflict(2, 'digital.output').length, 1);
        assert.equal(target.hasClaimConflict(2, 'digital.input').length, 1);
        assert.deepEqual(target.hasClaimConflict(99, 'digital.output'), []);
        assert.deepEqual(target.hasClaimConflict(1, ''), []);
    });
});


describe('DeviceTargetInfo derived irq capability', () => {
    it('derives irq from the digital input pins only', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            pinCapabilities: {
                1: { digital: { input: true, output: false } },
                2: { digital: { input: true, output: false } },
                3: { digital: { input: false, output: true } },
                4: { adc: { unit: 1, channel: 0 } },
            },
        });

        assert.deepEqual(target.getPinsForCapability('irq'), [1, 2]);
        assert.equal(target.hasPinCapability(1, 'irq'), true);
        assert.equal(target.hasPinCapability(3, 'irq'), false);
        assert.equal(target.hasPinCapability(4, 'irq'), false);
    });

    it('reports every pin of an open pin set as irq capable', () => {
        const target = new DeviceTargetInfo({ targetId: 'generic', openPins: { min: 0, max: 7 } });

        assert.deepEqual(target.getPinsForCapability('irq'), [0, 1, 2, 3, 4, 5, 6, 7]);
        assert.equal(target.hasPinCapability(6, 'irq'), true);
    });

    it('keeps an explicit capabilityToPins payload authoritative', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            capabilityToPins: { irq: [9] },
            pinCapabilities: { 1: { digital: { input: true } } },
        });

        assert.deepEqual(target.getPinsForCapability('irq'), [9]);
        assert.equal(target.hasPinCapability(1, 'irq'), false);
        assert.equal(target.hasPinCapability(9, 'irq'), true);
    });
});
