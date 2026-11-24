// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import TargetResolver from '../../src/micro_otter/nodes/html/js/data/target-resolver.js';
import { loadJsonFixture } from '../helpers/fixtures/loaders.js';

function targetPath() {
    return ['src', 'micro_otter', 'nodes', 'device', 'targets', 'esp32_s3_mini.json'];
}

describe('ESP32-S3 Mini target definition', () => {
    it('defines esp32_s3_mini as a delta over esp32_s3', async () => {
        const target = await loadJsonFixture(...targetPath());

        assert.equal(target.targetId, 'esp32_s3_mini');
        assert.equal(target.displayName, 'ESP32-S3 Mini');
        assert.equal(target.baseTargetId, 'esp32_s3');
        assert.equal('pinCapabilities' in target, false);
        assert.equal('generalCapabilities' in target, false);
        assert.ok(target.targetData);
    });

    it('resolves to the chip-level map through the resolver', async () => {
        const mini = await loadJsonFixture(...targetPath());
        const base = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'esp32_s3.json'
        );

        const resolver = new TargetResolver();
        resolver.setShippedTargets([
            { id: 'esp32_s3', payload: base },
            { id: 'esp32_s3_mini', payload: mini },
        ]);

        const resolved = resolver.resolve('esp32_s3_mini');
        assert.ok(resolved);
        assert.equal(resolved.buildBaseId, 'esp32_s3');

        const target = new DeviceTargetInfo(resolved.payload);
        assert.equal(target.pinCapabilities.size, 45);
        assert.equal(target.pinCapabilities.get(26).reserved.reason, 'psram');
        assert.equal(target.getPinsForCapability('touch').length, 14);
        assert.equal(target.getPinsForCapability('dac'), null);
        assert.equal(target.hasPinCapability(26, 'digital.output'), false);
    });

    it('registers the target in targets/index.json', async () => {
        const index = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'index.json'
        );

        const entry = index.targets.find((candidate) => candidate.id === 'esp32_s3_mini');
        assert.ok(entry);
        assert.equal(entry.file, 'esp32_s3_mini.json');
        assert.equal(entry.displayName, 'ESP32-S3 Mini');
    });
});
