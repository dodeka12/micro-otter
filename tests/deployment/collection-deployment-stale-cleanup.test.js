// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

const LIBRARY_PATH = 'otter_stdmo/servo.py';
const LIBRARY_URL = '/device/node_pkgs/stdmo/otter_stdmo/servo.py';

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
            runtimeDeploymentMode: 'embedded',
            runtimeEmbedded: true,
            effectiveInventorySummary: {
                totalEntries: 10,
                embeddedEntries: 10,
                dynamicEntries: 0,
                overriddenEntries: 0,
            },
            embeddedInventory: {
                files: [{ path: LIBRARY_PATH, source: 'embedded' }],
            },
            embeddedPackagesSummary: {
                totalPackages: 1,
                totalFiles: 1,
                totalBytes: 0,
                packages: [{ name: 'stdmo', version: '1.0.0' }],
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
                    resolvedFilesystem: [LIBRARY_URL],
                    nodePackagesGlobal: ['stdmo'],
                    nodePackages: [
                        {
                            id: 'stdmo',
                            manifest: { version: '1.0.0' },
                            mpAssets: {
                                '*': [LIBRARY_URL],
                            },
                        },
                    ],
                };
            },
        },
        transpiler: {},
    });
}

function createCollection() {
    return {
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
}

/**
 * Run a library preparation for the servo package and return the stale paths reported for the
 * given on-device manifest, using a hash manager whose files never need a re-upload.
 * @param {CollectionDeployment} deployment - Deployment under test
 * @param {Record<string, string>} deviceHashes - On-device manifest paths
 * @param {object} [options] - Options forwarded to `_prepareNodeLibrariesUpload`
 * @returns {Promise<string[]>} Stale collection paths
 */
async function prepareAndCollectStale(deployment, deviceHashes, options = {}) {
    deployment._hashManager = {
        async load() {},
        getFiles() {
            return {};
        },
        async prepareFile() {
            return { needsUpload: false, hash: 'hash' };
        },
    };

    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    globalThis.window = { location: { origin: 'http://localhost' } };
    globalThis.fetch = async () => ({
        ok: true,
        statusText: 'OK',
        text: async () => 'class Servo:\n    pass\n',
        json: async () => ({}),
    });

    try {
        await deployment._prepareNodeLibrariesUpload(createCollection(), options);
        return deployment._getStaleCollectionPaths(deviceHashes);
    } finally {
        if (originalFetch === undefined) {
            delete globalThis.fetch;
        } else {
            globalThis.fetch = originalFetch;
        }
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    }
}

function captureLogs() {
    const entries = [];
    globalThis.__microOtterLog = {
        log(scope, reason, level, ...data) {
            entries.push({ scope, reason, level, data });
        },
    };
    return entries;
}

function releaseLogs() {
    delete globalThis.__microOtterLog;
}

const GUARD_REASON = 'collection-library-stale-keep-firmware-missing';

describe('CollectionDeployment stale collection paths', () => {
    it('deletes a needed firmware-provided library when the firmware inventory lists it', async () => {
        const deployment = createDeployment();
        const logs = captureLogs();

        try {
            const stale = await prepareAndCollectStale(deployment, {
                'app/main.py': 'hash',
                [LIBRARY_PATH]: 'hash',
            });

            assert.deepEqual(stale.sort(), ['app/main.py', LIBRARY_PATH]);
            assert.equal(
                logs.some((entry) => entry.reason === GUARD_REASON),
                false,
                'the firmware can replace the file, so the guard must not fire'
            );
        } finally {
            releaseLogs();
        }
    });

    it('keeps a needed library when the firmware inventory does not list it', async () => {
        const deployment = createDeployment({
            embeddedInventory: {
                files: [{ path: 'otter_stdmo/other.py' }],
            },
        });
        const logs = captureLogs();

        try {
            const stale = await prepareAndCollectStale(
                deployment,
                { 'app/main.py': 'hash', [LIBRARY_PATH]: 'hash' },
                { embeddedLibraryOverridePaths: [LIBRARY_PATH] }
            );

            // The package is shadowed as a whole (source upload), so the file stays on the device.
            assert.deepEqual(stale, ['app/main.py']);
            assert.equal(
                logs.some((entry) => entry.reason === GUARD_REASON),
                false,
                'the file is re-uploaded as source, so the stale guard does not fire'
            );
        } finally {
            releaseLogs();
        }
    });

    it('keeps a needed library when the firmware inventory is unavailable', async () => {
        const deployment = createDeployment({ embeddedInventory: null });
        const logs = captureLogs();

        try {
            const stale = await prepareAndCollectStale(deployment, {
                'app/main.py': 'hash',
                [LIBRARY_PATH]: 'hash',
            });

            assert.deepEqual(stale, ['app/main.py']);
            const guardLog = logs.find((entry) => entry.reason === GUARD_REASON);
            assert.ok(guardLog, 'the guard must log the unknown inventory');
            assert.equal(guardLog.data[0].reason, 'inventory-unavailable');
        } finally {
            releaseLogs();
        }
    });

    it('deletes a library the graph no longer needs even when the firmware lacks it', async () => {
        const deployment = createDeployment({
            embeddedInventory: {
                files: [{ path: 'otter_stdmo/other.py' }],
            },
        });
        const logs = captureLogs();

        try {
            const stale = await prepareAndCollectStale(
                deployment,
                { 'app/main.py': 'hash', 'otter_vars/arrays.py': 'hash' },
                { embeddedLibraryOverridePaths: [LIBRARY_PATH] }
            );

            assert.deepEqual(stale.sort(), ['app/main.py', 'otter_vars/arrays.py']);
            assert.equal(
                logs.some((entry) => entry.reason === GUARD_REASON),
                false,
                'an unused library is user-space garbage and needs no guard'
            );
        } finally {
            releaseLogs();
        }
    });

    it('never guards in dynamic mode because every needed library is uploaded', async () => {
        const deployment = createDeployment({
            runtimeDeploymentMode: 'dynamic',
            runtimeEmbedded: false,
            embeddedInventory: {
                files: [{ path: 'otter_stdmo/other.py' }],
            },
        });
        const logs = captureLogs();

        try {
            const stale = await prepareAndCollectStale(deployment, {
                'app/main.py': 'hash',
                'otter_vars/arrays.py': 'hash',
                [LIBRARY_PATH]: 'hash',
            });

            // The needed library is part of the plan in dynamic mode, so it is never stale.
            assert.deepEqual(stale.sort(), ['app/main.py', 'otter_vars/arrays.py']);
            assert.equal(
                logs.some((entry) => entry.reason === GUARD_REASON),
                false
            );
        } finally {
            releaseLogs();
        }
    });
});

// Rule B: deleting a package's files must not leave the (now empty) package folder behind, because
// an empty directory still wins the import and shadows the firmware module.
describe('CollectionDeployment stale file removal prunes empty package folders', () => {
    /**
     * Deployment whose connection records file and folder removals.
     * @param {object} [options] - Fixture options
     * @param {(path: string) => Promise<number>} [options.removeFolder] - Folder removal behaviour
     * @param {string[]} [options.failingDeletes] - File paths whose deletion must fail
     * @param {boolean} [options.withRemoveFolder] - Omit `removeFolder` to model an older connection
     * @returns {object} Deployment plus spies
     */
    function createPruningDeployment({
        removeFolder,
        failingDeletes = [],
        withRemoveFolder = true,
    } = {}) {
        const deletedFiles = [];
        const folderCalls = [];
        const deletedFolders = [];

        const connection = {
            async readTextFile() {
                return '';
            },
            async writeTextFile() {},
            async sendFile() {},
            async calculateHash() {
                return 'hash';
            },
            async softReset() {},
            async deleteFile(path) {
                if (failingDeletes.includes(path)) {
                    throw new Error('ENOENT: no such file');
                }
                deletedFiles.push(path);
            },
            async deleteFolderRecursive(path) {
                deletedFolders.push(path);
            },
        };

        if (withRemoveFolder) {
            connection.removeFolder = async (path, options) => {
                folderCalls.push({ path, options });
                return removeFolder ? removeFolder(path, options) : 1;
            };
        }

        const deployment = new CollectionDeployment({
            deviceConnection: connection,
            deviceState: {
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                runtimeVersion: '1.0.0',
                runtimeDeploymentMode: 'embedded',
                runtimeEmbedded: true,
                embeddedInventory: { files: [] },
                deviceTargetInfo: { id: 'esp32' },
            },
            updateDeviceState() {},
            collectionManager: {
                getNodeType() {
                    return null;
                },
            },
            runtimeCollection: {
                getRuntime() {
                    return { id: 'general', version: '1.0.0', resolvedFilesystem: [] };
                },
            },
            transpiler: {},
        });

        deployment._hashManager = {
            async load() {},
            getFiles() {
                return {};
            },
            removeFile() {},
            async prepareFile() {
                return { needsUpload: false, hash: 'hash' };
            },
            commitStaging() {},
            async save() {},
        };

        return { deployment, deletedFiles, folderCalls, deletedFolders };
    }

    it('prunes the emptied package folder after removing its files', async () => {
        const { deployment, deletedFiles, folderCalls } = createPruningDeployment();
        const logs = captureLogs();

        try {
            const removed = await deployment._removeStaleCollectionFiles([
                'otter_vars/arrays.py',
                'otter_vars/__init__.py',
            ]);

            assert.equal(removed, 2, 'the return value stays the file count');
            assert.deepEqual(deletedFiles, ['otter_vars/arrays.py', 'otter_vars/__init__.py']);
            assert.deepEqual(folderCalls, [{ path: 'otter_vars', options: { recursive: false } }]);
            assert.ok(
                logs.some(
                    (entry) =>
                        entry.reason === 'collection-folder-removed' &&
                        entry.data[0].path === 'otter_vars'
                ),
                'the pruned folder is logged'
            );
        } finally {
            releaseLogs();
        }
    });

    it('prunes deepest first for a nested package', async () => {
        const { deployment, folderCalls } = createPruningDeployment();

        await deployment._removeStaleCollectionFiles([
            'otter_led/drivers/neopixel.py',
            'otter_led/__init__.py',
        ]);

        assert.deepEqual(
            folderCalls.map((call) => call.path),
            ['otter_led/drivers', 'otter_led']
        );
    });

    it('never prunes libs itself, app/ or collection/', async () => {
        const { deployment, folderCalls } = createPruningDeployment();

        await deployment._removeStaleCollectionFiles([
            'libs/foo.py',
            'app/main.py',
            'collection/node_graph_cln.json',
            'libs/x/a.py',
        ]);

        assert.deepEqual(
            folderCalls.map((call) => call.path),
            ['libs/x'],
            'only package folders are pruned'
        );
    });

    it('does not log a removal when the folder is still populated', async () => {
        const { deployment } = createPruningDeployment({ removeFolder: async () => 0 });
        const logs = captureLogs();

        try {
            await deployment._removeStaleCollectionFiles(['otter_vars/arrays.py']);

            assert.equal(
                logs.some((entry) => entry.reason === 'collection-folder-removed'),
                false
            );
            assert.equal(
                logs.some((entry) => entry.reason === 'collection-folder-keep-non-empty'),
                false
            );
        } finally {
            releaseLogs();
        }
    });

    it('tolerates a failing prune and keeps the file removal', async () => {
        const { deployment } = createPruningDeployment({
            removeFolder: async () => {
                throw new Error('EPERM');
            },
        });
        const logs = captureLogs();

        try {
            const removed = await deployment._removeStaleCollectionFiles(['otter_vars/arrays.py']);

            assert.equal(removed, 1);
            const failure = logs.find(
                (entry) => entry.reason === 'collection-folder-keep-non-empty'
            );
            assert.ok(failure, 'the failure is logged');
            assert.equal(failure.data[0].path, 'otter_vars');
            assert.match(failure.data[0].error, /EPERM/);
        } finally {
            releaseLogs();
        }
    });

    it('prunes only the files that were really removed', async () => {
        const { deployment, folderCalls } = createPruningDeployment({
            failingDeletes: ['otter_vars/arrays.py'],
        });

        const removed = await deployment._removeStaleCollectionFiles([
            'otter_vars/arrays.py',
            'otter_led/__init__.py',
        ]);

        assert.equal(removed, 1);
        assert.deepEqual(
            folderCalls.map((call) => call.path),
            ['otter_led'],
            'a folder whose file survived must not be pruned'
        );
    });

    it('makes no device call for an empty stale list', async () => {
        const { deployment, deletedFiles, folderCalls } = createPruningDeployment();

        assert.equal(await deployment._removeStaleCollectionFiles([]), 0);
        assert.deepEqual(deletedFiles, []);
        assert.deepEqual(folderCalls, []);
    });

    it('falls back to deleteFile (rmdir-only) on a connection without removeFolder', async () => {
        const { deployment, deletedFolders } = createPruningDeployment({
            withRemoveFolder: false,
        });

        await deployment._removeStaleCollectionFiles(['otter_vars/arrays.py']);

        assert.deepEqual(deletedFolders, [], 'pruning must never remove a folder tree');
    });
});
