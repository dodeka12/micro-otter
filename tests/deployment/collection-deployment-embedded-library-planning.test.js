import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';
import { HashManifestManager } from '../../src/micro_otter/nodes/html/js/deployment/hash-manifest-manager.js';

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

function createDeployment(deviceStateOverrides = {}) {
    return new CollectionDeployment({
        deviceConnection: {
            async readTextFile() {
                return '';
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
            runtimeDeploymentMode: 'dynamic',
            runtimeEmbedded: false,
            effectiveInventorySummary: null,
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
            },
            ...deviceStateOverrides,
        },
        updateDeviceState() {},
        collectionManager: {
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
}

describe('CollectionDeployment embedded library planning', () => {
    it('skips embedded-provided libraries during preparation when inventory says they are available', async () => {
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
                const deployment = createDeployment({
                    runtimeDeploymentMode: 'embedded',
                    runtimeEmbedded: true,
                    effectiveInventorySummary: {
                        totalEntries: 10,
                        embeddedEntries: 10,
                        dynamicEntries: 0,
                        overriddenEntries: 0,
                    },
                });

                let stagedHashes = 0;
                deployment._hashManager = {
                    async load() {},
                    getFiles() {
                        return {};
                    },
                    async prepareFile() {
                        stagedHashes += 1;
                        return {
                            needsUpload: true,
                            hash: 'hash',
                        };
                    },
                };

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'stdmo-servo' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);

                assert.equal(count, 0);
                assert.deepEqual(deployment._preparedFiles.libraries, []);
                assert.equal(stagedHashes, 0);
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('keeps dynamic mode library preparation behavior unchanged', async () => {
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
                const deployment = createDeployment({
                    runtimeDeploymentMode: 'dynamic',
                    runtimeEmbedded: false,
                    effectiveInventorySummary: {
                        totalEntries: 10,
                        embeddedEntries: 10,
                        dynamicEntries: 0,
                        overriddenEntries: 0,
                    },
                });

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'stdmo-servo' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection);

                assert.equal(count, 1);
                assert.deepEqual(
                    deployment._preparedFiles.libraries.map((file) => file.devicePath),
                    ['otter_stdmo/servo.py']
                );
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('requires explicit override paths to upload embedded-provided libraries and tags them', async () => {
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
                const deployment = createDeployment({
                    runtimeDeploymentMode: 'embedded',
                    runtimeEmbedded: true,
                    effectiveInventorySummary: {
                        totalEntries: 10,
                        embeddedEntries: 10,
                        dynamicEntries: 0,
                        overriddenEntries: 0,
                    },
                });

                deployment._hashManager = {
                    async load() {},
                    getFiles() {
                        return {};
                    },
                    async prepareFile() {
                        return {
                            needsUpload: true,
                            hash: 'hash',
                        };
                    },
                };

                const collection = {
                    id: 'collection-embedded-override',
                    getTitle() {
                        return 'Embedded Override';
                    },
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'stdmo-servo' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection, {
                    embeddedLibraryOverridePaths: ['otter_stdmo/servo.py'],
                });

                assert.equal(count, 1);
                assert.equal(
                    deployment._preparedFiles.libraries[0].devicePath,
                    'otter_stdmo/servo.py'
                );
                assert.equal(
                    deployment._preparedFiles.libraries[0].manifestTag,
                    'override-embedded'
                );

                const metadata = deployment._buildCollectionManifestMetadata(collection);
                assert.deepEqual(metadata.libraryPathTags, {
                    'otter_stdmo/servo.py': 'override-embedded',
                });
            } finally {
                if (originalFetch === undefined) {
                    delete globalThis.fetch;
                } else {
                    globalThis.fetch = originalFetch;
                }
            }
        });
    });

    it('plans a library that the hash manifest already records and only reports it as inventory', async () => {
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
                const deployment = createDeployment({
                    runtimeDeploymentMode: 'embedded',
                    runtimeEmbedded: true,
                    effectiveInventorySummary: {
                        totalEntries: 10,
                        embeddedEntries: 10,
                        dynamicEntries: 0,
                        overriddenEntries: 0,
                    },
                });

                // The manifest still knows the file from the previous deploy. Before the fix this
                // alone made the path "available-dynamic" and dropped it from the plan, so the
                // stale cleanup removed it on this deploy.
                deployment._hashManager = {
                    async load() {},
                    getFiles() {
                        return {
                            'otter_stdmo/servo.py': 'hash',
                            'app/main.py': 'hash',
                        };
                    },
                    async prepareFile() {
                        return {
                            needsUpload: false,
                            hash: 'hash',
                        };
                    },
                };

                const collection = {
                    getGraphArray() {
                        return [
                            {
                                getNodes() {
                                    return [{ type: 'stdmo-servo' }];
                                },
                            },
                        ];
                    },
                };

                const count = await deployment._prepareNodeLibrariesUpload(collection, {
                    embeddedLibraryOverridePaths: ['otter_stdmo/servo.py'],
                });

                assert.equal(count, 1);
                assert.deepEqual(
                    deployment._preparedFiles.libraries.map((file) => file.devicePath),
                    ['otter_stdmo/servo.py']
                );
                assert.equal(
                    deployment._preparedFiles.libraries[0].manifestTag,
                    'override-embedded'
                );
                assert.ok(
                    deployment._dynamicLibraryPathsOnDevice.has('otter_stdmo/servo.py'),
                    'the on-device inventory is still recorded for display'
                );
                assert.equal(
                    deployment._dynamicLibraryPathsOnDevice.has('app/main.py'),
                    false,
                    'non-library manifest paths are not part of the library inventory'
                );
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

describe('CollectionDeployment on-device library inventory accessor', () => {
    function createManifestManager(readTextFile) {
        return new HashManifestManager({
            readTextFile,
            async writeTextFile() {},
        });
    }

    it('returns only library paths from the manifest, sorted', async () => {
        const deployment = createDeployment({ runtimeDeploymentMode: 'embedded', runtimeEmbedded: true });
        deployment._hashManager = createManifestManager(async () =>
            JSON.stringify({
                version: '1.0.0',
                created: '2026-02-12T10:00:00Z',
                updated: '2026-02-12T10:00:00Z',
                collection: {
                    files: {
                        'otter_vars/arrays.py': 'hash-a',
                        'app/main.py': 'hash-b',
                        'otter_stdmo/servo.py': 'hash-c',
                        'libs/third_party.py': 'hash-d',
                    },
                },
            })
        );

        const paths = await deployment.getDynamicLibraryPathsOnDevice();

        assert.deepEqual(paths, [
            'libs/third_party.py',
            'otter_stdmo/servo.py',
            'otter_vars/arrays.py',
        ]);
        assert.equal(deployment._dynamicLibraryPathsOnDevice.size, 3);
    });

    it('returns an empty list instead of throwing when the manifest is unreadable', async () => {
        const deployment = createDeployment({ runtimeDeploymentMode: 'embedded', runtimeEmbedded: true });
        deployment._hashManager = createManifestManager(async () => {
            throw new Error('device I/O failure');
        });

        const paths = await deployment.getDynamicLibraryPathsOnDevice();

        assert.deepEqual(paths, []);
        assert.equal(deployment._dynamicLibraryPathsOnDevice.size, 0);
    });
});
