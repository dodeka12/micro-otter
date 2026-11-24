import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import DeviceRuntime from '../../src/micro_otter/nodes/html/js/data/device-runtime.js';

function jsonResponse(data) {
    return { ok: true, status: 200, json: async () => data };
}

function makeFetch({ mapping }) {
    return async (input) => {
        const url = String(input);
        if (url.endsWith('manifest.json')) {
            return jsonResponse({ id: 'general', nodePackages: { global: [], local: [] } });
        }
        if (url.endsWith('compile_target_mappings.json')) {
            if (mapping === null) {
                return { ok: false, status: 404, json: async () => ({}) };
            }
            return jsonResponse(mapping);
        }
        if (url.endsWith('index.json')) {
            return jsonResponse({
                version: 1,
                targets: [{ id: 'esp32_s3_mini', file: 'esp32_s3_mini.json' }],
            });
        }
        if (url.endsWith('esp32_s3_mini.json')) {
            return jsonResponse({ targetId: 'esp32_s3_mini', displayName: 'ESP32-S3 Mini' });
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
}

describe('DeviceRuntime compile target resolution', () => {
    it('resolves a specific target to its compile board and port', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                mapping: {
                    schemaVersion: 1,
                    rules: [
                        {
                            id: 's3-mini',
                            webTargetId: 'esp32_s3_mini',
                            compile: { board: 'ESP32_GENERIC_S3', port: 'esp32' },
                        },
                        { id: 'custom', webTargetId: 'custom', compile: { board: '*', port: '*' } },
                    ],
                },
            }),
            null,
            '/device/targets'
        );

        assert.deepEqual(runtime.getCompileTarget('esp32_s3_mini'), {
            board: 'ESP32_GENERIC_S3',
            port: 'esp32',
        });
    });

    it('resolves the backend-typed compile section (params.port)', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                mapping: {
                    schemaVersion: 1,
                    rules: [
                        {
                            id: 's3-mini',
                            webTargetId: 'esp32_s3_mini',
                            compile: {
                                board: 'ESP32_GENERIC_S3',
                                backend: 'esp-idf',
                                params: { port: 'esp32' },
                            },
                        },
                        {
                            id: 'custom',
                            webTargetId: 'custom',
                            compile: { board: '*', backend: 'esp-idf', params: { port: '*' } },
                        },
                    ],
                },
            }),
            null,
            '/device/targets'
        );

        assert.deepEqual(runtime.getCompileTarget('esp32_s3_mini'), {
            board: 'ESP32_GENERIC_S3',
            port: 'esp32',
        });
        assert.equal(runtime.getCompileTarget('custom'), null);
    });

    it('returns null for wildcard and unknown targets', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                mapping: {
                    schemaVersion: 1,
                    rules: [
                        {
                            id: 's3-mini',
                            webTargetId: 'esp32_s3_mini',
                            compile: { board: 'ESP32_GENERIC_S3', port: 'esp32' },
                        },
                        { id: 'custom', webTargetId: 'custom', compile: { board: '*', port: '*' } },
                        {
                            id: 'generic',
                            webTargetId: 'generic_micropython',
                            compile: { board: '*', port: '*' },
                        },
                    ],
                },
            }),
            null,
            '/device/targets'
        );

        assert.equal(runtime.getCompileTarget('custom'), null);
        assert.equal(runtime.getCompileTarget('generic_micropython'), null);
        assert.equal(runtime.getCompileTarget('unknown'), null);
    });

    it('does not throw when the mapping file is missing', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(makeFetch({ mapping: null }), null, '/device/targets');

        assert.equal(runtime.getCompileTarget('esp32_s3_mini'), null);
    });

    it('resolves a derived user target through its base target id', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                mapping: {
                    schemaVersion: 1,
                    rules: [
                        {
                            id: 's3-mini',
                            webTargetId: 'esp32_s3_mini',
                            compile: { board: 'ESP32_GENERIC_S3', port: 'esp32' },
                        },
                    ],
                },
            }),
            null,
            '/device/targets'
        );
        runtime.setUserTargets([
            {
                id: 'derived_s3',
                displayName: 'Derived S3',
                version: '1.0.0',
                source: 'user',
                created: '2026-11-13',
                baseTargetId: 'esp32_s3_mini',
                targetData: { id: 'derived_s3' },
            },
        ]);

        assert.deepEqual(runtime.getCompileTarget('derived_s3'), {
            board: 'ESP32_GENERIC_S3',
            port: 'esp32',
        });
        assert.equal(runtime.getTargetBuildBaseId('derived_s3'), 'esp32_s3_mini');
    });

    it('returns null for a target with no base as before', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                mapping: {
                    schemaVersion: 1,
                    rules: [
                        {
                            id: 's3-mini',
                            webTargetId: 'esp32_s3_mini',
                            compile: { board: 'ESP32_GENERIC_S3', port: 'esp32' },
                        },
                    ],
                },
            }),
            null,
            '/device/targets'
        );
        runtime.setUserTargets([
            {
                id: 'standalone',
                displayName: 'Standalone',
                version: '1.0.0',
                source: 'user',
                created: '2026-11-13',
                baseTargetId: null,
                targetData: { id: 'standalone' },
            },
        ]);

        assert.equal(runtime.getCompileTarget('standalone'), null);
        assert.equal(runtime.getTargetBuildBaseId('standalone'), null);
    });
});
