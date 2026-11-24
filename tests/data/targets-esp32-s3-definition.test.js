// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

describe('ESP32-S3 target definition', () => {
    it('defines the chip-level esp32_s3 base', async () => {
        const target = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'esp32_s3.json'
        );

        assert.equal(target.targetId, 'esp32_s3');
        assert.equal(target.displayName, 'ESP32-S3');

        const info = new DeviceTargetInfo(target);
        assert.equal(info.pinCapabilities.size, 45);
        assert.equal(info.pinCapabilities.get(26).reserved.reason, 'psram');
        assert.equal(info.getPinsForCapability('dac'), null);
        assert.equal(info.generalCapabilities.viper.supported, true);
        assert.equal(info.resources.pwm.channels, 8);
    });
});
