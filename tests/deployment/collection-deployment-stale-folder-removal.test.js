// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Phase 3: package folders the firmware owns wholesale are removed as folders, and only a folder
// that really existed counts as a device change (so a no-op sync stays free of a soft reset).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

const REMOVED_LOG = 'collection-library-folder-removed';
const FAILED_LOG = 'collection-library-folder-remove-failed';
const KEEP_PLANNED_LOG = 'collection-library-folder-keep-planned';

let originalLog;

/**
 * Deployment whose connection records folder/file removals.
 * @param {object} [options] - Fixture options
 * @param {(path: string) => Promise<number>} [options.removeFolder] - Folder removal implementation
 * @param {boolean} [options.withRemoveFolder] - Omit `removeFolder` to model an older connection
 * @returns {object} Deployment plus spies
 */
function createDeployment({ removeFolder, withRemoveFolder = true } = {}) {
    const folderCalls = [];
    const deletedFiles = [];
    const deletedFolders = [];

    const removeFolderImpl =
        removeFolder ||
        (async () => {
            return 2;
        });

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
            deletedFiles.push(path);
        },
        async deleteFolderRecursive(path) {
            deletedFolders.push(path);
        },
    };

    if (withRemoveFolder) {
        connection.removeFolder = async (path, options) => {
            folderCalls.push({ path, options });
            return removeFolderImpl(path, options);
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
                return { implementations: {} };
            },
        },
        runtimeCollection: {
            getRuntime() {
                return { id: 'general', version: '1.0.0', resolvedFilesystem: [] };
            },
        },
        transpiler: {},
    });

    return { deployment, folderCalls, deletedFiles, deletedFolders };
}

/**
 * @param {string} reason - Log reason to find
 * @returns {object[]} Matching log entries
 */
function entriesFor(reason) {
    return (globalThis.__capturedLogs || []).filter((entry) => entry.reason === reason);
}

/**
 * Set the firmware-owned snapshot without running a preparation.
 * @param {CollectionDeployment} deployment - Deployment under test
 * @param {Array<[string, string]>} folders - Folder / package id pairs
 * @returns {void}
 */
function setFolders(deployment, folders) {
    deployment._firmwareOwnedPackageFolders = new Map(folders);
}

beforeEach(() => {
    originalLog = globalThis.__microOtterLog;
    globalThis.__capturedLogs = [];
    globalThis.__microOtterLog = {
        log(scope, reason, level, ...data) {
            globalThis.__capturedLogs.push({ scope, reason, level, data });
        },
    };
});

afterEach(() => {
    if (originalLog === undefined) {
        delete globalThis.__microOtterLog;
    } else {
        globalThis.__microOtterLog = originalLog;
    }
    delete globalThis.__capturedLogs;
});
describe('CollectionDeployment stale library folder removal', () => {
    it('removes a firmware-owned folder and reports the removal', async () => {
        const { deployment, folderCalls } = createDeployment({ removeFolder: async () => 3 });
        setFolders(deployment, [['otter_vars', 'vars']]);

        const removed = await deployment._removeStaleLibraryFolders();

        assert.equal(removed, 1);
        assert.deepEqual(
            folderCalls.map((call) => call.path),
            ['otter_vars']
        );

        const removedLogs = entriesFor(REMOVED_LOG);
        assert.equal(removedLogs.length, 1);
        assert.equal(removedLogs[0].data[0].path, 'otter_vars');
        assert.equal(removedLogs[0].data[0].packageId, 'vars');
        assert.equal(removedLogs[0].data[0].removedEntries, 3);
        assert.equal(removedLogs[0].data[0].removalReported, true);
        assert.equal(
            deployment._firmwareOwnedPackageFolders.size,
            0,
            'the snapshot is released after the cleanup'
        );
    });

    it('does not count a folder that no longer exists as a change', async () => {
        const { deployment } = createDeployment({ removeFolder: async () => 0 });
        setFolders(deployment, [['otter_vars', 'vars']]);

        const removed = await deployment._removeStaleLibraryFolders();

        assert.equal(removed, 0, 'a no-op sync must not force a soft reset');
        assert.equal(entriesFor(REMOVED_LOG).length, 0);
        assert.equal(entriesFor(FAILED_LOG).length, 0);
    });

    it('keeps a folder the prepared plan still writes into', async () => {
        const { deployment, folderCalls } = createDeployment({ removeFolder: async () => 1 });
        setFolders(deployment, [
            ['otter_vars', 'vars'],
            ['otter_led', 'led'],
        ]);
        deployment._preparedFiles.libraries = [
            { devicePath: 'otter_vars/arrays.py', url: '/u', content: '# x\n' },
        ];

        const removed = await deployment._removeStaleLibraryFolders();

        assert.equal(removed, 1);
        assert.deepEqual(
            folderCalls.map((call) => call.path),
            ['otter_led'],
            'a planned path owns its folder'
        );

        const keepLogs = entriesFor(KEEP_PLANNED_LOG);
        assert.equal(keepLogs.length, 1);
        assert.equal(keepLogs[0].data[0].path, 'otter_vars');
        assert.equal(keepLogs[0].data[0].packageId, 'vars');
    });

    it('warns and continues when one folder cannot be removed', async () => {
        const { deployment } = createDeployment({
            removeFolder: async (path) => {
                if (path === 'otter_vars') {
                    throw new Error('EPERM');
                }
                return 1;
            },
        });
        setFolders(deployment, [
            ['otter_vars', 'vars'],
            ['otter_led', 'led'],
        ]);

        const removed = await deployment._removeStaleLibraryFolders();

        assert.equal(removed, 1, 'the second folder is still removed');

        const failedLogs = entriesFor(FAILED_LOG);
        assert.equal(failedLogs.length, 1);
        assert.equal(failedLogs[0].level, 'warn');
        assert.equal(failedLogs[0].data[0].path, 'otter_vars');
        assert.match(failedLogs[0].data[0].error, /EPERM/);
    });

    it('falls back to deleteFolderRecursive on a connection without removeFolder', async () => {
        const { deployment, deletedFolders } = createDeployment({ withRemoveFolder: false });
        setFolders(deployment, [['otter_vars', 'vars']]);

        const removed = await deployment._removeStaleLibraryFolders();

        assert.equal(removed, 1);
        assert.deepEqual(deletedFolders, ['otter_vars']);

        const removedLogs = entriesFor(REMOVED_LOG);
        assert.equal(removedLogs.length, 1);
        assert.equal(removedLogs[0].data[0].removalReported, false);
        assert.equal(removedLogs[0].data[0].removedEntries, 0);
    });

    it('never passes a non-package path to removeFolder', async () => {
        const { deployment, folderCalls, deletedFiles } = createDeployment({
            removeFolder: async () => 1,
        });
        setFolders(deployment, [
            ['libs/shared', 'shared'],
            ['otter_vars', 'vars'],
        ]);

        await deployment._removeStaleLibraryFolders();

        assert.deepEqual(folderCalls.map((call) => call.path).sort(), [
            'libs/shared',
            'otter_vars',
        ]);
        assert.deepEqual(deletedFiles, [], 'no per-file deletion happens here');
    });

    it('removes a frozen variant stale folder and releases the snapshot', async () => {
        const { deployment, folderCalls } = createDeployment({
            removeFolder: async () => 5,
        });
        deployment._stalePackageFolders = new Set(['moa_pulse']);

        const removed = await deployment._removeStaleLibraryFolders();

        assert.equal(removed, 1);
        assert.deepEqual(folderCalls.map((call) => call.path), ['moa_pulse']);
        assert.equal(
            deployment._stalePackageFolders.size,
            0,
            'the stale-folder snapshot is released after the cleanup'
        );
    });
});

// Sync wiring: a folder removal is a device change, so the sync must soft-reset and reload the
// module search path. Without the folder nothing changed, and the sync must stay silent.
describe('CollectionDeployment sync wiring for folder removal', () => {
    const LIBRARY_PATH = 'otter_stdmo/servo.py';
    const LIBRARY_URL = '/device/node_pkgs/stdmo/otter_stdmo/servo.py';

    let originalFetch;
    let originalWindow;

    /**
     * @param {object} [options] - Fixture options
     * @param {string[]} [options.nodePackagesGlobal] - Firmware-bundled package ids
     * @returns {object} Deployment plus spies
     */
    function createSyncDeployment({ nodePackagesGlobal = ['stdmo'] } = {}) {
        const folderCalls = [];
        const softResets = [];

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
                async softReset(options) {
                    softResets.push(options);
                },
                async deleteFile() {},
                async deleteFolderRecursive() {},
                async removeFolder(path, options) {
                    folderCalls.push({ path, options });
                    return 2;
                },
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
                embeddedInventory: { files: [{ path: LIBRARY_PATH, source: 'embedded' }] },
                embeddedPackagesSummary: {
                    totalPackages: 1,
                    totalFiles: 1,
                    totalBytes: 0,
                    packages: [{ name: 'stdmo', version: '1.0.0' }],
                },
                deviceTargetInfo: { id: 'esp32', capabilityToPins: {}, generalCapabilities: {} },
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
                        implementations: { python: { dependencies: ['otter_stdmo.servo'] } },
                    };
                },
            },
            runtimeCollection: {
                getRuntime() {
                    return {
                        id: 'general',
                        version: '1.0.0',
                        resolvedFilesystem: [],
                        nodePackagesGlobal,
                        nodePackages: [
                            { id: 'stdmo', manifest: { version: '1.0.0' }, mpAssets: { '*': [LIBRARY_URL] } },
                        ],
                    };
                },
            },
            transpiler: {},
        });

        // Only the folder removal may count as a change in this scenario.
        deployment._uploadPreparedCollectionFiles = async () => 0;
        deployment._uploadPreparedLibraries = async () => 0;
        deployment._delay = async () => {};

        return { deployment, folderCalls, softResets };
    }

    /**
     * @returns {object} Collection double
     */
    function createCollection() {
        return {
            getId() {
                return 'collection-sync-folder';
            },
            getTitle() {
                return 'Sync Folder';
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

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        originalWindow = globalThis.window;
        globalThis.window = { location: { origin: 'http://localhost' } };
        globalThis.fetch = async (url) => {
            if (String(url) !== LIBRARY_URL) {
                return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
            }
            return {
                ok: true,
                statusText: 'OK',
                text: async () => 'class Servo:\n    pass\n',
                json: async () => ({}),
            };
        };
    });

    afterEach(() => {
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
    });

    it('counts the folder removal as a change so the sync soft-resets', async () => {
        const { deployment, folderCalls, softResets } = createSyncDeployment();

        const changes = await deployment.syncCollectionFiles(createCollection(), {
            deviceHashes: { 'app/main_loop.py': 'old-main' },
        });

        assert.deepEqual(
            folderCalls.map((call) => call.path),
            ['otter_stdmo']
        );
        assert.equal(changes, 1, 'the removed folder is the only change');
        assert.equal(softResets.length, 1, 'the device must reload the module search path');

        const savedLogs = entriesFor('collection-hashes-saved');
        assert.equal(savedLogs.length, 1);
        assert.equal(savedLogs[0].data[0].staleLibraryFoldersRemoved, 1);
    });

    it('stays quiet when the folder is left to the firmware', async () => {
        const { deployment, folderCalls, softResets } = createSyncDeployment({
            nodePackagesGlobal: [],
        });

        const changes = await deployment.syncCollectionFiles(createCollection(), {
            deviceHashes: { 'app/main_loop.py': 'old-main' },
        });

        assert.deepEqual(folderCalls, []);
        assert.equal(changes, 0);
        assert.equal(softResets.length, 0, 'nothing changed, so no reset');
        assert.equal(entriesFor('no-files-changed').length, 1);
    });
});
