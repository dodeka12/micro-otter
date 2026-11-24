import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RuntimeDeployment } from '../../src/micro_otter/nodes/html/js/deployment/runtime-deployment.js';
import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

function createRuntimeDeployment() {
    const runtimeState = {
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
                version: '1.1.0',
                manifest: { preservedPaths: [] },
            };
        },
    };

    const deployment = new RuntimeDeployment({
        deviceConnection: {
            async hardReset() {},
            async softReset() {},
        },
        deviceState: runtimeState,
        updateDeviceState() {},
        runtimeCollection,
    });

    deployment._hashManager = {
        commitStaging() {},
        async save() {},
    };

    return deployment;
}

function createCollectionDeployment() {
    const collectionState = {
        connected: true,
        runtimeInstalled: true,
        runtimeId: 'general',
    };

    const softResetCalls = [];
    const deployment = new CollectionDeployment({
        deviceConnection: {
            isExecutionRunning() {
                return true;
            },
            async softReset(options = {}) {
                softResetCalls.push(options);
            },
            async exitRawRepl() {},
            async writeTextFile() {},
        },
        deviceState: collectionState,
        updateDeviceState() {},
        collectionManager: {
            async transpileCollection() {
                return { code: 'print(1)', assets: {} };
            },
        },
        runtimeCollection: {
            getRuntime(runtimeId) {
                return {
                    id: runtimeId,
                    resolvedFilesystem: [],
                };
            },
        },
        transpiler: {},
    });

    deployment._hashManager = {
        async load() {},
        getFiles() {
            return {};
        },
        commitStaging() {},
        async save() {},
    };

    deployment._testSoftResetCalls = softResetCalls;

    return deployment;
}

describe('RuntimeDeployment and CollectionDeployment event contracts', () => {
    it('RuntimeDeployment emits typed runtime-installed payload on refresh', async () => {
        const deployment = createRuntimeDeployment();

        deployment.prepareRefresh = async () => ({
            totalFiles: 0,
            runtimeCount: 0,
            libsCount: 0,
        });
        deployment._preserveRuntimePaths = async () => new Map();
        deployment._uploadPreparedRuntimeFiles = async () => {};
        deployment._uploadPreparedLibraries = async () => {};
        deployment._restoreRuntimePaths = async () => {};
        deployment._delay = async () => {};

        let received = null;
        deployment.addEventListener('runtime-installed', (event) => {
            received = event;
        });

        await deployment.refreshRuntime('general', {});

        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'RuntimeDeployment.RuntimeInstalled.v1');
        assert.equal(received.detail.runtimeId, 'general');
        assert.equal(received.detail.refresh, true);
    });

    it('RuntimeDeployment emits typed operation-error payload on remove failure', async () => {
        const deployment = createRuntimeDeployment();
        deployment._deleteRuntimeFiles = async () => {
            throw new Error('remove failed');
        };

        let received = null;
        deployment.addEventListener('operation-error', (event) => {
            received = event;
        });

        await assert.rejects(async () => {
            await deployment.removeRuntime({});
        });

        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'RuntimeDeployment.OperationError.v1');
        assert.equal(received.detail.operation, 'runtime-remove');
        assert.equal(received.detail.error, 'remove failed');
    });

    it('CollectionDeployment emits typed collection-deployed payload on force deploy', async () => {
        const deployment = createCollectionDeployment();

        deployment.prepareDeployCollection = async () => ({
            totalFiles: 2,
            collectionFiles: 2,
            libraries: 0,
        });
        deployment._preparedFiles.collection = [
            { devicePath: 'app/main_loop.py', content: 'print(1)' },
            { devicePath: 'collection/node_graph_cln.json', content: '{}' },
        ];
        deployment._uploadGeneratedCode = async () => {};
        deployment._uploadFile = async () => {};
        deployment._uploadPreparedLibraries = async () => {};
        deployment._delay = async () => {};

        const collection = {
            getTitle() {
                return 'Test Collection';
            },
            getVersionString() {
                return '1.2.3';
            },
        };

        let received = null;
        deployment.addEventListener('collection-deployed', (event) => {
            received = event;
        });

        const totalFiles = await deployment.deployCollection(collection, { force: true });

        assert.equal(totalFiles, 2);
        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'CollectionDeployment.CollectionDeployed.v1');
        assert.equal(received.detail.collection, collection);
        assert.deepEqual(deployment._testSoftResetCalls, [{ startRunning: true }]);
    });

    it('CollectionDeployment emits typed collection-removed payload', async () => {
        const deployment = createCollectionDeployment();
        deployment._deleteCollectionFiles = async () => {};

        let received = null;
        deployment.addEventListener('collection-removed', (event) => {
            received = event;
        });

        await deployment.removeCollection({});

        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'CollectionDeployment.CollectionRemoved.v1');
    });

    it('CollectionDeployment restores default runtime main loop and index on remove', async () => {
        const deployment = createCollectionDeployment();
        deployment._deleteCollectionFiles = async () => {};

        const writes = [];
        deployment._deviceConnection.writeTextFile = async (path, content) => {
            writes.push({ path, content });
        };

        deployment._runtimeCollection = {
            getRuntime(runtimeId) {
                return {
                    id: runtimeId,
                    resolvedFilesystem: [
                        '/device/runtime/general/app/main_loop.py',
                        '/device/runtime/general/html/index.html',
                    ],
                };
            },
        };

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url) => {
            const href = String(url);
            if (href.endsWith('/device/runtime/general/app/main_loop.py')) {
                return {
                    ok: true,
                    statusText: 'OK',
                    async text() {
                        return 'print("default loop")\n';
                    },
                };
            }
            if (href.endsWith('/device/runtime/general/html/index.html')) {
                return {
                    ok: true,
                    statusText: 'OK',
                    async text() {
                        return '<!doctype html><html></html>';
                    },
                };
            }
            throw new Error(`Unexpected fetch URL: ${href}`);
        };

        try {
            await deployment.removeCollection({});
        } finally {
            if (originalFetch === undefined) {
                delete globalThis.fetch;
            } else {
                globalThis.fetch = originalFetch;
            }
        }

        assert.deepEqual(writes.map((entry) => entry.path).sort(), [
            'app/main_loop.py',
            'html/index.html',
        ]);
    });

    it('CollectionDeployment emits typed operation-error payload on remove failure', async () => {
        const deployment = createCollectionDeployment();
        deployment._deleteCollectionFiles = async () => {
            throw new Error('collection remove failed');
        };

        let received = null;
        deployment.addEventListener('operation-error', (event) => {
            received = event;
        });

        await assert.rejects(async () => {
            await deployment.removeCollection({});
        });

        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'CollectionDeployment.OperationError.v1');
        assert.equal(received.detail.operation, 'collection-remove');
        assert.equal(received.detail.error, 'collection remove failed');
    });
});
