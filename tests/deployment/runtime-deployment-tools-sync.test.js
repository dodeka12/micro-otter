import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { RuntimeDeployment } from '../../src/micro_otter/nodes/html/js/deployment/runtime-deployment.js';
import { calculateFileHash } from '../../src/micro_otter/nodes/html/js/deployment/deployment-utils.js';
import { createFetchJsonResponse } from '../helpers/globals-harness.js';

function createFetchFromMap(responseMap) {
    return async (url) => {
        const key = String(url);
        const response = responseMap[key];
        if (!response) {
            return {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: async () => {
                    throw new Error('Not Found');
                },
                text: async () => '',
            };
        }
        return response;
    };
}

async function withMockWindowOrigin(origin, callback) {
    const originalWindow = globalThis.window;
    globalThis.window = {
        location: {
            origin,
        },
    };

    try {
        return await callback();
    } finally {
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    }
}

function createHarness({
    runtimeVersion = '1.1.0',
    readManifest,
    readDeviceJson,
    resolvedFilesystem = [],
    runtimeManifestOverrides = {},
    readTextFiles = {},
    listFilesMap = {},
} = {}) {
    const sentFiles = [];
    const writes = [];
    const statePatches = [];
    const operationOrder = [];
    const deletedFiles = [];
    let hardResetCount = 0;

    const deviceConnection = {
        async hardReset() {
            hardResetCount += 1;
        },
        async softReset() {},
        async deleteFile(path) {
            deletedFiles.push(path);
            operationOrder.push(`delete:${path}`);
        },
        async deleteFolderRecursive() {},
        async deleteFileSystem() {},
        async readTextFile(path) {
            if (path === '/.micro-otter-sync-manifest') {
                if (typeof readManifest === 'string') {
                    return readManifest;
                }
                const error = new Error('ENOENT: no such file');
                throw error;
            }
            if (path === '/device.json') {
                if (typeof readDeviceJson === 'string') {
                    return readDeviceJson;
                }
                const error = new Error('ENOENT: no such file');
                throw error;
            }
            if (Object.prototype.hasOwnProperty.call(readTextFiles, path)) {
                return readTextFiles[path];
            }
            throw new Error(`Unexpected readTextFile path: ${path}`);
        },
        async listFiles(path = '/') {
            if (Object.prototype.hasOwnProperty.call(listFilesMap, path)) {
                return listFilesMap[path];
            }
            throw new Error(`ENOENT: no such directory: ${path}`);
        },
        async writeTextFile(path, content) {
            writes.push({ path, content });
        },
        async sendFile(path, content) {
            sentFiles.push({ path, content });
            operationOrder.push(`send:${path}`);
        },
    };

    const deviceState = {
        connected: true,
        hasMicroPython: true,
        runtimeInstalled: true,
        runtimeVersion: '1.0.0',
        runtimeId: 'general',
    };

    const runtimeCollection = {
        getRuntime(runtimeId) {
            return {
                id: runtimeId,
                name: 'General Runtime',
                version: runtimeVersion,
                manifest: {
                    preservedPaths: [],
                    nodeLibraries: { alwaysInclude: [] },
                    ...runtimeManifestOverrides,
                },
                resolvedFilesystem,
            };
        },
    };

    const deployment = new RuntimeDeployment({
        deviceConnection,
        deviceState,
        updateDeviceState(patch) {
            statePatches.push(patch);
            Object.assign(deviceState, patch);
        },
        runtimeCollection,
    });

    return {
        deployment,
        sentFiles,
        writes,
        statePatches,
        deletedFiles,
        operationOrder,
        getHardResetCount() {
            return hardResetCount;
        },
    };
}

describe('RuntimeDeployment tools sync migration', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        if (originalFetch === undefined) {
            delete globalThis.fetch;
            return;
        }
        globalThis.fetch = originalFetch;
    });

    it('prepareUpgrade counts only changed tools files via hash manifest comparison', async () => {
        const unchangedContent = 'print("same")\n';
        const changedContent = 'print("changed")\n';
        const unchangedHash = await calculateFileHash(unchangedContent);

        const existingManifest = {
            version: '1.0.0',
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-01-01T00:00:00.000Z',
            tools: {
                files: {
                    'tools/lib/same.py': unchangedHash,
                },
            },
            runtime: {
                files: {},
            },
        };

        const { deployment } = createHarness({
            readManifest: JSON.stringify(existingManifest),
        });

        globalThis.fetch = createFetchFromMap({
            '/device/tools/manifest.json': createFetchJsonResponse({
                files: ['lib/same.py', 'lib/new.py'],
            }),
            '/device/tools/lib/same.py': {
                ok: true,
                statusText: 'OK',
                text: async () => unchangedContent,
                json: async () => ({}),
            },
            '/device/tools/lib/new.py': {
                ok: true,
                statusText: 'OK',
                text: async () => changedContent,
                json: async () => ({}),
            },
        });

        const prep = await deployment.prepareUpgrade('general');

        assert.equal(prep.runtimeCount, 0);
        assert.equal(prep.toolsCount, 1);
        assert.equal(prep.totalFiles, 1);
    });

    it('upgradeRuntime uploads changed tools, saves manifest, and emits typed event', async () => {
        const changedToolContent = 'def ping():\n    return True\n';

        const existingManifest = {
            version: '1.0.0',
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-01-01T00:00:00.000Z',
            tools: {
                files: {
                    'tools/lib/device_runtime.py': 'outdated-hash',
                },
            },
            runtime: {
                files: {},
            },
        };

        const { deployment, sentFiles, writes, statePatches, getHardResetCount } = createHarness({
            readManifest: JSON.stringify(existingManifest),
            readDeviceJson: JSON.stringify({ targetId: 'esp32-s3' }),
            runtimeVersion: '2.0.0',
        });

        globalThis.fetch = createFetchFromMap({
            '/device/tools/manifest.json': createFetchJsonResponse({
                files: ['lib/device_runtime.py'],
            }),
            '/device/tools/lib/device_runtime.py': {
                ok: true,
                statusText: 'OK',
                text: async () => changedToolContent,
                json: async () => ({}),
            },
        });

        let runtimeUpgradedEvent = null;
        deployment.addEventListener('runtime-upgraded', (event) => {
            runtimeUpgradedEvent = event;
        });

        await deployment.upgradeRuntime('general');

        assert.equal(sentFiles.length, 1);
        assert.equal(sentFiles[0].path, 'tools/lib/device_runtime.py');
        assert.equal(sentFiles[0].content, changedToolContent);

        const manifestWrite = writes.find((entry) => entry.path === '/.micro-otter-sync-manifest');
        assert.ok(manifestWrite, 'Expected sync manifest write');

        const deviceMarkerWrite = writes.find((entry) => entry.path === '/device.json');
        assert.ok(deviceMarkerWrite, 'Expected /device.json runtime marker write');
        assert.match(deviceMarkerWrite.content, /"targetId"\s*:\s*"esp32-s3"/);

        assert.equal(getHardResetCount(), 1);

        assert.ok(statePatches.some((patch) => patch.connected === false));
        assert.ok(statePatches.some((patch) => patch.runtimeVersion === '2.0.0'));

        assert.ok(runtimeUpgradedEvent);
        assert.equal(
            runtimeUpgradedEvent.detail.payloadTypeId,
            'RuntimeDeployment.RuntimeUpgraded.v1'
        );
        assert.equal(runtimeUpgradedEvent.detail.runtimeId, 'general');
        assert.equal(runtimeUpgradedEvent.detail.filesChanged, 1);
    });

    it('prepareInstall surfaces tools manifest fetch failure without device/network side effects', async () => {
        const { deployment } = createHarness();

        globalThis.fetch = createFetchFromMap({});

        await assert.rejects(async () => {
            await deployment.prepareInstall('general');
        }, /Failed to fetch tools manifest/i);
    });

    it('prepareInstall selects profile-matched .mpy artifacts when availability indicates precompiled support', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const { deployment } = createHarness({
                resolvedFilesystem: ['/device/runtime/general/main.py'],
            });

            globalThis.fetch = createFetchFromMap({
                '/device/tools/manifest.json': createFetchJsonResponse({
                    files: ['lib/device_runtime.py'],
                }),
                '/device/tools/lib/__mpycache__/abc123def456/device_runtime.mpy': {
                    ok: true,
                    statusText: 'OK',
                    arrayBuffer: async () => new TextEncoder().encode('tool-mpy').buffer,
                    text: async () => 'tool-mpy',
                    json: async () => ({}),
                },
                'http://localhost/device/tools/lib/__mpycache__/abc123def456/device_runtime.mpy': {
                    ok: true,
                    statusText: 'OK',
                    arrayBuffer: async () => new TextEncoder().encode('tool-mpy').buffer,
                    text: async () => 'tool-mpy',
                    json: async () => ({}),
                },
                '/device/runtime/general/__mpycache__/abc123def456/main.mpy': {
                    ok: true,
                    statusText: 'OK',
                    arrayBuffer: async () => new TextEncoder().encode('runtime-mpy').buffer,
                    text: async () => 'runtime-mpy',
                    json: async () => ({}),
                },
                'http://localhost/device/runtime/general/__mpycache__/abc123def456/main.mpy': {
                    ok: true,
                    statusText: 'OK',
                    arrayBuffer: async () => new TextEncoder().encode('runtime-mpy').buffer,
                    text: async () => 'runtime-mpy',
                    json: async () => ({}),
                },
            });

            const prep = await deployment.prepareInstall('general', {
                mpyCompileProfile: { hash: 'abc123def456' },
                mpyAvailability: {
                    tools: { hasProfile: true },
                    runtime: { hasProfile: true },
                },
            });

            assert.equal(prep.toolsCount, 1);
            assert.equal(prep.runtimeCount, 1);
            assert.equal(
                deployment._preparedFiles.tools[0].devicePath,
                'tools/lib/device_runtime.mpy'
            );
            assert.equal(deployment._preparedFiles.runtime[0].devicePath, 'main.mpy');
            assert.ok(deployment._preparedFiles.tools[0].content instanceof Uint8Array);
            assert.ok(deployment._preparedFiles.runtime[0].content instanceof Uint8Array);
        });
    });

    it('prepareInstall keeps runtime files listed in mpySourceExcludes as .py', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const { deployment } = createHarness({
                resolvedFilesystem: [
                    '/device/runtime/general/main.py',
                    '/device/runtime/general/app/main_loop.py',
                ],
                runtimeManifestOverrides: {
                    mpySourceExcludes: ['main.py', 'app/main_loop.py'],
                },
            });

            globalThis.fetch = createFetchFromMap({
                '/device/tools/manifest.json': createFetchJsonResponse({
                    files: [],
                }),
                '/device/runtime/general/main.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'print("runtime main")\n',
                    json: async () => ({}),
                },
                '/device/runtime/general/app/main_loop.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'print("runtime loop")\n',
                    json: async () => ({}),
                },
            });

            const prep = await deployment.prepareInstall('general', {
                mpyCompileProfile: { hash: 'abc123def456' },
                mpyAvailability: {
                    tools: { hasProfile: true },
                    runtime: { hasProfile: true },
                },
            });

            assert.equal(prep.runtimeCount, 2);
            assert.deepEqual(
                deployment._preparedFiles.runtime.map((entry) => entry.devicePath).sort(),
                ['app/main_loop.py', 'main.py']
            );
            assert.ok(typeof deployment._preparedFiles.runtime[0].content === 'string');
            assert.ok(typeof deployment._preparedFiles.runtime[1].content === 'string');
        });
    });

    it('prepareRefresh skips app/main_loop.py when preserveCollection is enabled', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const { deployment } = createHarness({
                resolvedFilesystem: [
                    '/device/runtime/general/main.py',
                    '/device/runtime/general/app/main_loop.py',
                ],
            });

            globalThis.fetch = createFetchFromMap({
                '/device/runtime/general/main.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'print("runtime main")\n',
                    json: async () => ({}),
                },
                '/device/runtime/general/app/main_loop.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'print("default loop")\n',
                    json: async () => ({}),
                },
            });

            const prep = await deployment.prepareRefresh('general', { preserveCollection: true });

            assert.equal(prep.runtimeCount, 1);
            assert.equal(prep.totalFiles, 1);
            assert.deepEqual(
                deployment._preparedFiles.runtime.map((entry) => entry.devicePath),
                ['main.py']
            );
        });
    });

    it('removes main.py before uploading main.mpy', async () => {
        const { deployment, sentFiles, deletedFiles, operationOrder } = createHarness();

        const mpyContent = new Uint8Array([1, 2, 3]);
        await deployment._uploadFile('main.mpy', 'main.mpy', mpyContent);

        assert.deepEqual(deletedFiles, ['main.py']);
        assert.equal(sentFiles.length, 1);
        assert.equal(sentFiles[0].path, 'main.mpy');
        assert.deepEqual(operationOrder.slice(0, 2), ['delete:main.py', 'send:main.mpy']);
    });

    it('prepareUpgrade skips app/main_loop.py when preserveCollection is enabled', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const existingMainHash = await calculateFileHash('print("existing main")\n');
            const existingLoopHash = await calculateFileHash('print("existing loop")\n');

            const existingManifest = {
                version: '1.0.0',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                tools: {
                    files: {},
                },
                runtime: {
                    files: {
                        'main.py': existingMainHash,
                        'app/main_loop.py': existingLoopHash,
                    },
                },
            };

            const { deployment } = createHarness({
                readManifest: JSON.stringify(existingManifest),
                resolvedFilesystem: [
                    '/device/runtime/general/main.py',
                    '/device/runtime/general/app/main_loop.py',
                ],
            });

            globalThis.fetch = createFetchFromMap({
                '/device/tools/manifest.json': createFetchJsonResponse({
                    files: [],
                }),
                '/device/runtime/general/main.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'print("changed main")\n',
                    json: async () => ({}),
                },
                '/device/runtime/general/app/main_loop.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'print("changed loop")\n',
                    json: async () => ({}),
                },
            });

            const prep = await deployment.prepareUpgrade('general', {
                preserveCollection: true,
            });

            assert.equal(prep.runtimeCount, 1);
            assert.equal(prep.toolsCount, 0);
            assert.equal(prep.totalFiles, 1);
            assert.deepEqual(
                deployment._preparedFiles.runtime.map((entry) => entry.devicePath),
                ['main.py']
            );
        });
    });

    it('preserveCollection keeps collection libraries under libs excluding runtime-managed files', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const { deployment } = createHarness({
                resolvedFilesystem: [
                    '/device/runtime/general/main.py',
                    '/device/runtime/general/libs/__init__.py',
                    '/device/runtime/general/libs/runtime/http_request.py',
                ],
                readTextFiles: {
                    'collection/node_graph_cln.json': '{"name":"Demo"}',
                    'app/main_loop.py': 'print("main loop")\n',
                    'libs/stdmo/__init__.py': '# stdmo\n',
                    'libs/stdmo/servo.py': '# servo\n',
                },
                listFilesMap: {
                    '/libs': [
                        { name: '__init__.py', type: 'file', size: 0 },
                        { name: 'runtime', type: 'dir', size: 0 },
                        { name: 'stdmo', type: 'dir', size: 0 },
                    ],
                    '/libs/runtime': [{ name: 'http_request.py', type: 'file', size: 0 }],
                    '/libs/stdmo': [
                        { name: '__init__.py', type: 'file', size: 0 },
                        { name: 'servo.py', type: 'file', size: 0 },
                    ],
                },
            });

            const runtime = deployment._runtimeCollection.getRuntime('general');
            const preserved = await deployment._preserveCollectionData(runtime);

            assert.ok(preserved);
            assert.equal(preserved.metadata, '{"name":"Demo"}');
            assert.equal(preserved.mainLoop, 'print("main loop")\n');
            assert.deepEqual(preserved.libraries.map((entry) => entry.path).sort(), [
                'libs/stdmo/__init__.py',
                'libs/stdmo/servo.py',
            ]);
        });
    });
});
