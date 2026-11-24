// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

/** Load the shipped ESP32-S2 target payload. */
async function loadTarget() {
    return loadJsonFixture(
        'src',
        'micro_otter',
        'nodes',
        'device',
        'targets',
        'esp32_s2.json'
    );
}

describe('ESP32-S2 target definition', () => {
    it('defines a standalone esp32_s2 target', async () => {
        const target = await loadTarget();

        assert.equal(target.targetId, 'esp32_s2');
        assert.equal(target.displayName, 'ESP32-S2');
        assert.equal(target.baseTargetId, undefined);
        assert.equal(target.openPins, undefined);
    });

    it('declares 43 pins and omits GPIO22-25', async () => {
        const info = new DeviceTargetInfo(await loadTarget());

        assert.equal(info.pinCapabilities.size, 43);
        for (const missing of [22, 23, 24, 25]) {
            assert.equal(info.pinCapabilities.has(missing), false, `GPIO${missing}`);
        }
    });

    it('exposes the two DAC channels on GPIO17/GPIO18', async () => {
        const info = new DeviceTargetInfo(await loadTarget());

        assert.deepEqual(info.getPinsForCapability('dac'), [17, 18]);
        assert.equal(info.hasPinCapability(17, 'dac'), true);
        assert.equal(info.hasPinCapability(18, 'dac'), true);
    });

    it('maps ADC units and touch channels', async () => {
        const info = new DeviceTargetInfo(await loadTarget());

        assert.equal(info.getPinsForCapability('touch').length, 14);
        assert.equal(info.getPinsForCapability('adc.unit1').length, 10);
        assert.equal(info.getPinsForCapability('adc.unit2').length, 10);
    });

    it('reserves GPIO26-32 for flash', async () => {
        const info = new DeviceTargetInfo(await loadTarget());

        assert.equal(info.hasPinCapability(26, 'digital.output'), false);
        assert.equal(info.pinCapabilities.get(26).reserved.reason, 'flash');
    });

    it('keeps GPIO46 input-only with uart rx and a fixed pull-down', async () => {
        const info = new DeviceTargetInfo(await loadTarget());
        const pin = info.pinCapabilities.get(46);

        assert.equal(info.hasPinCapability(46, 'digital.output'), false);
        assert.equal(info.hasPinCapability(46, 'uart.rx'), true);
        assert.equal(pin.fixedPull, 'down');
    });

    it('declares DAC, PWM and radio resources', async () => {
        const info = new DeviceTargetInfo(await loadTarget());

        assert.equal(info.resources.dac.channels, 2);
        assert.equal(info.resources.pwm.channels, 8);
        assert.equal(info.generalCapabilities.bluetooth.supported, false);
        assert.equal(info.generalCapabilities.wifi.generation, 4);
    });

    it('is registered in the shipped target index', async () => {
        const index = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'index.json'
        );
        const entry = index.targets.find((candidate) => candidate.id === 'esp32_s2');

        assert.ok(entry, 'esp32_s2 must be listed in targets/index.json');
        assert.equal(entry.file, 'esp32_s2.json');
        assert.equal(entry.displayName, 'ESP32-S2');
        assert.deepEqual(entry.runtimeModes, ['embedded']);
    });
});
