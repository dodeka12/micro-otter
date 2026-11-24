import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    DeviceTargetInfo,
    asPinId,
    normalizeBusId,
} from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

describe('device-target conventions', () => {
    it('coerces numeric bus/port ids to canonical string ids', () => {
        assert.equal(normalizeBusId(0, 'i2c'), 'i2c0');
        assert.equal(normalizeBusId(2, 'i2c'), 'i2c2');
        assert.equal(normalizeBusId(0, 'uart'), 'uart0');
        assert.equal(normalizeBusId(1, 'uart'), 'uart1');
    });

    it('maps short SPI aliases to canonical bus ids', () => {
        assert.equal(normalizeBusId('v', 'spi'), 'vspi');
        assert.equal(normalizeBusId('f', 'spi'), 'fspi');
    });

    it('passes through unknown strings and rejects invalid input', () => {
        assert.equal(normalizeBusId('custom0', 'i2c'), 'custom0');
        assert.equal(normalizeBusId('', 'i2c'), null);
        assert.equal(normalizeBusId(null, 'i2c'), null);
        assert.equal(normalizeBusId(0, 'spi'), null);
    });

    it('normalizes numeric and numeric-string pin ids', () => {
        assert.equal(asPinId(7), 7);
        assert.equal(asPinId('7'), 7);
    });

    it('accepts non-numeric string pin ids for port-based boards', () => {
        assert.equal(asPinId('PA0'), 'PA0');
        assert.equal(asPinId('GP0'), 'GP0');
    });

    it('normalizes port+pin tuples to a stable string key', () => {
        assert.equal(asPinId({ port: 'B', pin: 1 }), 'B1');
        assert.equal(asPinId({ port: 'A', pin: 0 }), 'A0');
    });

    it('rejects invalid pin ids', () => {
        assert.equal(asPinId(null), null);
        assert.equal(asPinId(undefined), null);
        assert.equal(asPinId({}), null);
        assert.equal(asPinId(Number.NaN), null);
    });

    it('coerces pin-level numeric bus ids via DeviceTargetInfo', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            pinCapabilities: {
                21: { i2c: { bus: 0, roles: ['sda'] } },
                1: { uart: { port: 0, roles: ['tx'] } },
                5: { spi: { bus: 'v', roles: ['cs'] } },
            },
        });

        assert.equal(target.pinCapabilities.get(21).i2c.bus, 'i2c0');
        assert.equal(target.pinCapabilities.get(1).uart.port, 'uart0');
        assert.equal(target.pinCapabilities.get(5).spi.bus, 'vspi');
    });

    it('normalizes metadata default bus ids to canonical strings', () => {
        const target = new DeviceTargetInfo({
            id: 'esp32-test',
            metadata: { defaultI2cBus: 0, defaultUart: 0, defaultSpiBus: 'f' },
        });

        assert.equal(target.metadata.defaultI2cBus, 'i2c0');
        assert.equal(target.metadata.defaultUart, 'uart0');
        assert.equal(target.metadata.defaultSpiBus, 'fspi');
    });
});

describe('device-target pin claims', () => {
    const KNOWN_ROLE_PREFIXES = ['console.', 'usb.', 'onboard.led'];

    async function loadClaims(fileName) {
        const payload = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            fileName
        );
        const target = new DeviceTargetInfo(payload);
        const claims = [];
        for (const pin of target.pinCapabilities.values()) {
            for (const claim of pin.claims) {
                claims.push({ id: pin.id, ...claim });
            }
        }
        return claims;
    }

    it('every claim is well-formed', async () => {
        for (const file of [
            'esp32_s2.json',
            'esp32_s3.json',
            'esp32_wroom.json',
            'arduino_uno.json',
        ]) {
            const claims = await loadClaims(file);
            for (const claim of claims) {
                assert.ok(
                    KNOWN_ROLE_PREFIXES.some((prefix) => claim.role.startsWith(prefix)),
                    `${file}: unexpected role '${claim.role}'`
                );
                assert.ok(claim.conflicts.length > 0, `${file}: empty conflicts for '${claim.role}'`);
                assert.ok(claim.severity === 'info' || claim.severity === 'warn');
                assert.ok(typeof claim.note === 'string' && claim.note.length > 0);
            }
        }
    });

    it('esp32 targets carry the console/usb claims and no onboard.led', async () => {
        const s3 = await loadClaims('esp32_s3.json');
        assert.deepEqual(
            s3.map((claim) => claim.role).sort(),
            ['console.rx', 'console.tx', 'usb.dminus', 'usb.dplus']
        );

        const s2 = await loadClaims('esp32_s2.json');
        assert.deepEqual(
            s2.map((claim) => claim.role).sort(),
            ['console.rx', 'console.tx', 'usb.dminus', 'usb.dplus']
        );

        const wroom = await loadClaims('esp32_wroom.json');
        assert.deepEqual(
            wroom.map((claim) => claim.role).sort(),
            ['console.rx', 'console.tx']
        );
    });

    it('arduino_uno declares an onboard.led claim on D13', async () => {
        const claims = await loadClaims('arduino_uno.json');
        assert.deepEqual(claims, [
            {
                id: 13,
                role: 'onboard.led',
                conflicts: ['digital.output'],
                severity: 'info',
                note: 'Also drives the built-in LED indicator (with series resistor).',
            },
        ]);
    });
});
