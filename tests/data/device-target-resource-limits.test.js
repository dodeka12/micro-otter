import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';

describe('DeviceTargetInfo resources', () => {
    it('normalizes resource counts to integers and null for invalid values', () => {
        const target = new DeviceTargetInfo({
            targetId: 'esp32-test',
            resources: {
                pwm: { channels: 8, timers: 4 },
                adc: { units: 2, channelsPerUnit: 10, wifiConflictedUnits: [2] },
                i2s: { controllers: 2, junk: 'nope' },
            },
        });

        assert.deepEqual(target.resources.pwm, { channels: 8, timers: 4 });
        assert.deepEqual(target.resources.adc, {
            units: 2,
            channelsPerUnit: 10,
            wifiConflictedUnits: [2],
        });
        assert.deepEqual(target.resources.i2s, { controllers: 2, junk: null });
    });

    it('normalizes per-instance resource limit maps', () => {
        const target = new DeviceTargetInfo({
            targetId: 'esp32-test',
            resources: {
                adc: { channelsPerUnit: { 1: 8, 2: 10 } },
                dma: { streams: { a: 'x', 1: 4 } },
                invalid: { counts: { x: 'y' } },
            },
        });

        assert.deepEqual(target.resources.adc.channelsPerUnit, { '1': 8, '2': 10 });
        assert.deepEqual(target.resources.dma.streams, { '1': 4 });
        assert.equal(target.resources.invalid.counts, null);
    });

    it('defaults to an empty map when resources are absent', () => {
        const target = new DeviceTargetInfo({ targetId: 'esp32-test' });

        assert.deepEqual(target.resources, {});
    });

    it('preserves general capability granularity through a round-trip', () => {
        const generalCapabilities = {
            wifi: { supported: true, generation: 6, coexistsWithBle: true },
            bluetooth: { supported: true, version: '5', le: true },
            concurrency: { cores: 2, threading: true, async: true },
        };
        const target = new DeviceTargetInfo({
            targetId: 'esp32-test',
            generalCapabilities,
        });

        assert.deepEqual(target.generalCapabilities, generalCapabilities);
    });

    it('flags viper on Xtensa ESP32 targets and omits it on generic', () => {
        const readTarget = (file) =>
            JSON.parse(readFileSync(path.resolve('src/micro_otter/nodes/device/targets', file), 'utf8'));

        assert.deepEqual(readTarget('esp32_wroom.json').generalCapabilities.viper, {
            supported: true,
        });
        assert.deepEqual(readTarget('esp32_s3.json').generalCapabilities.viper, {
            supported: true,
        });
        assert.equal(readTarget('generic_micropython.json').generalCapabilities.viper, undefined);
    });
});
