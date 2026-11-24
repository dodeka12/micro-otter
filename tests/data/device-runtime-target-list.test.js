// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import DeviceRuntime from '../../src/micro_otter/nodes/html/js/data/device-runtime.js';

function jsonResponse(data) {
    return { ok: true, status: 200, json: async () => data };
}

function makeFetch() {
    return async (input) => {
        const url = String(input);
        if (url.endsWith('manifest.json')) {
            return jsonResponse({ id: 'general', nodePackages: { global: [], local: [] } });
        }
        if (url.endsWith('compile_target_mappings.json')) {
            return jsonResponse({
                schemaVersion: 1,
                rules: [
                    {
                        id: 's3',
                        webTargetId: 'esp32_s3',
                        compile: { board: 'ESP32_GENERIC_S3', port: 'esp32' },
                    },
                ],
            });
        }
        if (url.endsWith('index.json')) {
            return jsonResponse({
                version: 1,
                targets: [
                    { id: 'esp32_s3', file: 'esp32_s3.json' },
                    { id: 'esp32_s3_mini', file: 'esp32_s3_mini.json' },
                ],
            });
        }
        if (url.endsWith('esp32_s3.json')) {
            return jsonResponse({
                targetId: 'esp32_s3',
                displayName: 'ESP32-S3',
                pinCapabilities: { 1: { label: 'GPIO1', digital: { input: true, output: true } } },
            });
        }
        if (url.endsWith('esp32_s3_mini.json')) {
            return jsonResponse({
                targetId: 'esp32_s3_mini',
                displayName: 'ESP32-S3 Mini',
                baseTargetId: 'esp32_s3',
                targetData: { pinCapabilities: { 2: { label: 'GPIO2' } } },
            });
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
}

describe('DeviceRuntime effective target list', () => {
    it('resolves shipped derived targets to their effective payload', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(makeFetch(), null, '/device/targets');

        const mini = runtime.getDeviceTarget('esp32_s3_mini');
        assert.ok(mini);
        assert.equal(mini.displayName, 'ESP32-S3 Mini');
        assert.equal(mini.getPinCapability(1).label, 'GPIO1');
        assert.equal(mini.getPinCapability(2).label, 'GPIO2');

        assert.deepEqual(runtime.getCompileTarget('esp32_s3_mini'), {
            board: 'ESP32_GENERIC_S3',
            port: 'esp32',
        });
        assert.equal(runtime.getTargetBuildBaseId('esp32_s3_mini'), 'esp32_s3');

        const payload = runtime.getEffectiveTargetPayload('esp32_s3_mini');
        assert.ok(payload);
        assert.equal(payload.targetId, 'esp32_s3_mini');
    });

    it('includes user targets in the onboarding list, deduped by id', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(makeFetch(), null, '/device/targets');
        runtime.setUserTargets([
            {
                id: 'my_s3',
                displayName: 'My S3',
                version: '1.0.0',
                source: 'user',
                created: '2026-11-14',
                baseTargetId: 'esp32_s3',
                targetData: { id: 'my_s3', targetId: 'my_s3' },
            },
        ]);

        const ids = runtime.listOnboardingTargets().map((target) => target.id);
        assert.ok(ids.includes('esp32_s3'));
        assert.ok(ids.includes('esp32_s3_mini'));
        assert.ok(ids.includes('my_s3'));
        assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
    });
});
