import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

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

function createCollectionDeployment(deviceStateOverrides = {}) {
    const uploadedPaths = [];

    const deployment = new CollectionDeployment({
        deviceConnection: {
            isExecutionRunning() {
                return false;
            },
            async readTextFile() {
                throw new Error('ENOENT: no such file');
            },
            async writeTextFile() {},
            async sendFile() {},
            async calculateHash() {
                return 'hash';
            },
            async softReset() {},
            async deleteFile() {},
            async deleteFolderRecursive() {},
        },
        deviceState: {
            connected: true,
            runtimeInstalled: true,
            runtimeId: 'general',
            runtimeVersion: '1.0.0',
            runtimeDeploymentMode: 'embedded',
            runtimeEmbedded: true,
            effectiveInventorySummary: {
                totalEntries: 10,
                embeddedEntries: 10,
                dynamicEntries: 0,
                overriddenEntries: 0,
            },
            embeddedPackagesSummary: {
                totalPackages: 1,
                totalFiles: 1,
                totalBytes: 0,
                packages: [{ name: 'stdmo', version: '1.0.0' }],
            },
            embeddedInventory: {
                files: [{ path: 'otter_stdmo/servo.py', source: 'embedded' }],
            },
            deviceTargetInfo: {
                id: 'esp32',
                capabilityToPins: {},
                generalCapabilities: {},
                metadata: {},
            },
            ...deviceStateOverrides,
        },
        updateDeviceState() {},
        collectionManager: {
            async transpileCollection() {
                return { code: 'print("sync")\n', assets: {} };
            },
            getNodeType(nodeTypeId) {
                if (nodeTypeId !== 'stdmo-servo') {
                    return null;
                }
                return {
                    implementations: {
                        python: {
                            dependencies: ['otter_stdmo.servo'],
                        },
                    },
                };
            },
        },
        runtimeCollection: {
            getRuntime(runtimeId) {
                if (runtimeId !== 'general') {
                    return null;
                }
                return {
                    id: 'general',
                    version: '1.0.0',
                    resolvedFilesystem: [],
                    nodePackagesGlobal: ['stdmo'],
                    nodePackages: [
                        {
                            id: 'stdmo',
                            manifest: { version: '1.0.0' },
                            mpAssets: {
                                '*': ['/device/node_pkgs/stdmo/otter_stdmo/servo.py'],
                            },
                        },
                    ],
                };
            },
        },
        transpiler: {},
    });

    deployment._uploadFile = async (_sourcePath, devicePath) => {
        uploadedPaths.push(devicePath);
    };

    deployment._delay = async () => {};

    return { deployment, uploadedPaths };
}

function createCollection() {
    return {
        id: 'collection-sync-embedded',
        getId() {
            return 'collection-sync-embedded';
        },
        getTitle() {
            return 'Sync Embedded';
        },
        getVersionString() {
            return '1.0.0';
        },
        getGraphArray() {
            return [
                {
                    getNodes() {
                        return [{ id: 'node-1', type: 'stdmo-servo', controlValues: {} }];
                    },
                },
            ];
        },
    };
}

describe('CollectionDeployment embedded sync behavior', () => {
    it('skips embedded-provided libraries by default during sync', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/stdmo/otter_stdmo/servo.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class Servo:\n    pass\n',
                    json: async () => ({}),
                },
            });

            try {
                const { deployment, uploadedPaths } = createCollectionDeployment();

                await deployment.syncCollectionFiles(createCollection(), {
                    deviceHashes: {
                        'app/main_loop.py': 'old-main',
                        'collection/node_graph_cln.json': 'old-meta',
                    },
                });

                assert.equal(uploadedPaths.includes('otter_stdmo/servo.py'), false);
                assert.equal(uploadedPaths.includes('app/main_loop.py'), true);
                assert.equal(uploadedPaths.includes('collection/node_graph_cln.json'), true);
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('uploads embedded library path during sync when explicit override is provided', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/stdmo/otter_stdmo/servo.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class Servo:\n    pass\n',
                    json: async () => ({}),
                },
            });

            try {
                const { deployment, uploadedPaths } = createCollectionDeployment();

                await deployment.syncCollectionFiles(createCollection(), {
                    deviceHashes: {
                        'app/main_loop.py': 'old-main',
                        'collection/node_graph_cln.json': 'old-meta',
                    },
                    embeddedLibraryOverridePaths: ['otter_stdmo/servo.py'],
                });

                assert.equal(uploadedPaths.includes('otter_stdmo/servo.py'), true);
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('preserves dynamic runtime sync behavior and still uploads required libraries', async () => {
        await withMockWindowOrigin('http://localhost', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = createFetchFromMap({
                '/device/node_pkgs/stdmo/otter_stdmo/servo.py': {
                    ok: true,
                    statusText: 'OK',
                    text: async () => 'class Servo:\n    pass\n',
                    json: async () => ({}),
                },
            });

            try {
                const { deployment, uploadedPaths } = createCollectionDeployment({
                    runtimeDeploymentMode: 'dynamic',
                    runtimeEmbedded: false,
                });

                await deployment.syncCollectionFiles(createCollection(), {
                    deviceHashes: {
                        'app/main_loop.py': 'old-main',
                        'collection/node_graph_cln.json': 'old-meta',
                    },
                });

                assert.equal(uploadedPaths.includes('otter_stdmo/servo.py'), true);
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });
});
