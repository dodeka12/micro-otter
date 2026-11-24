// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Phase 2 of the embedded package folder cleanup: `_prepareNodeLibrariesUpload()` must end with a
// trustworthy snapshot of the package folders it leaves entirely to the firmware. Nothing is
// removed here — these tests pin the *decision*, including every reason a folder is kept.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';
import { resolveFirmwareModulePlan } from '../../src/micro_otter/nodes/html/js/deployment/embedded-module-plan.js';

const FOLDER_LOG = 'collection-firmware-owned-package-folders';
const KEEP_MISSING_LOG = 'collection-library-folder-keep-firmware-missing';
const KEEP_PLANNED_LOG = 'collection-library-folder-keep-planned';

const VARS_PATHS = ['otter_vars/__init__.py', 'otter_vars/arrays.py', 'otter_vars/math.py'];

/**
 * Build a runtime `nodePackages` entry whose asset URLs live under `/device/node_pkgs/<id>/`.
 * @param {string} id - Package id
 * @param {string[]} paths - Library paths the package declares
 * @returns {{id: string, mpAssets: Record<string, string[]>}} Runtime package descriptor
 */
function makePackage(id, paths) {
    const urls = paths.map((path) => `/device/node_pkgs/${id}/${path}`);
    return { id, manifest: { version: '1.0.0' }, mpAssets: { '*': urls } };
}

/**
 * Graph double that reports exactly the given node type ids.
 * @param {string[]} nodeTypes - Node type ids
 * @returns {object} Collection double
 */
function makeCollection(nodeTypes) {
    return {
        getGraphArray() {
            return [
                {
                    getNodes() {
                        return nodeTypes.map((type) => ({ type }));
                    },
                },
            ];
        },
    };
}

/**
 * Convert the collected folder map into a plain object for assertions.
 * @param {CollectionDeployment} deployment - Deployment under test
 * @returns {Record<string, string>} Folder → package id
 */
function folderMap(deployment) {
    return Object.fromEntries(deployment._firmwareOwnedPackageFolders.entries());
}

/**
 * Captured log entries from the current test.
 * @returns {Array<{reason: string, level: string, data: unknown[]}>} Log entries
 */
function logs() {
    return globalThis.__capturedLogs || [];
}

/**
 * @param {string} reason - Log reason to find
 * @returns {object[]} Matching entries
 */
function entriesFor(reason) {
    return logs().filter((entry) => entry.reason === reason);
}

let originalFetch;
let originalWindow;
let originalLog;

/**
 * Build a deployment wired to a fixture device, without running any preparation.
 * @param {object} fixture - Fixture description
 * @param {object[]} [fixture.nodePackages] - Runtime node packages
 * @param {string[]} [fixture.nodePackagesGlobal] - Firmware-bundled package ids
 * @param {string[]} [fixture.inventoryFiles] - Paths the firmware inventory reports
 * @param {object|null} [fixture.embeddedInventory] - Explicit inventory override
 * @param {number} [fixture.embeddedEntries] - `effectiveInventorySummary.embeddedEntries`
 * @param {boolean} [fixture.runtimeEmbedded] - Embedded (default) or dynamic runtime mode
 * @returns {CollectionDeployment} Deployment under test
 */
function createDeployment({
    nodePackages = [],
    nodePackagesGlobal = [],
    inventoryFiles = [],
    embeddedInventory = undefined,
    embeddedEntries = undefined,
    runtimeEmbedded = true,
}) {
    const deployment = new CollectionDeployment({
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
            runtimeDeploymentMode: runtimeEmbedded ? 'embedded' : 'dynamic',
            runtimeEmbedded,
            effectiveInventorySummary: {
                totalEntries: 10,
                embeddedEntries:
                    embeddedEntries !== undefined ? embeddedEntries : inventoryFiles.length,
                dynamicEntries: 0,
                overriddenEntries: 0,
            },
            embeddedInventory:
                embeddedInventory !== undefined
                    ? embeddedInventory
                    : {
                          files: inventoryFiles.map((path) => ({
                              path,
                              source: 'embedded',
                          })),
                      },
            embeddedPackagesSummary: {
                totalPackages: nodePackagesGlobal.length,
                totalFiles: 0,
                totalBytes: 0,
                packages: nodePackagesGlobal.map((id) => ({ name: id, version: '1.0.0' })),
            },
            deviceTargetInfo: { id: 'esp32' },
        },
        updateDeviceState() {},
        collectionManager: {
            getNodeType() {
                return { implementations: {} };
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
                    nodePackages,
                    nodePackagesGlobal,
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
        async prepareFile() {
            return { needsUpload: true, hash: 'hash' };
        },
    };

    return deployment;
}

/**
 * Run the real library preparation for a fixture and return the deployment.
 * @param {object} fixture - Fixture description (see `createDeployment`)
 * @param {string[]} [fixture.nodeTypes] - Node type ids present in the graph
 * @param {object} [fixture.options] - Options passed to `_prepareNodeLibrariesUpload`
 * @returns {Promise<CollectionDeployment>} The deployment after preparation
 */
async function prepareDeployment({ nodeTypes = [], options = {}, ...fixture } = {}) {
    const deployment = createDeployment(fixture);
    await deployment._prepareNodeLibrariesUpload(makeCollection(nodeTypes), options);
    return deployment;
}

beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWindow = globalThis.window;
    originalLog = globalThis.__microOtterLog;

    globalThis.window = { location: { origin: 'http://localhost' } };
    globalThis.fetch = async (url) => {
        const key = String(url);
        if (!key.includes('/node_pkgs/') && !key.includes('/runtime/')) {
            return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
        }
        return {
            ok: true,
            statusText: 'OK',
            text: async () => '# module\n',
            arrayBuffer: async () => new Uint8Array([0]).buffer,
            json: async () => ({}),
        };
    };

    globalThis.__capturedLogs = [];
    globalThis.__microOtterLog = {
        log(scope, reason, level, ...data) {
            globalThis.__capturedLogs.push({ scope, reason, level, data });
        },
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
    if (originalLog === undefined) {
        delete globalThis.__microOtterLog;
    } else {
        globalThis.__microOtterLog = originalLog;
    }
    delete globalThis.__capturedLogs;
});

describe('CollectionDeployment firmware-owned package folders', () => {
    it('collects the package folder when the firmware ships every needed file', async () => {
        const deployment = await prepareDeployment({
            nodeTypes: ['vars-math'],
            nodePackages: [makePackage('vars', VARS_PATHS)],
            nodePackagesGlobal: ['vars'],
            inventoryFiles: VARS_PATHS,
        });

        assert.deepEqual(folderMap(deployment), { otter_vars: 'vars' });

        const folderLogs = entriesFor(FOLDER_LOG);
        assert.equal(folderLogs.length, 1, 'the snapshot must be logged once');
        assert.deepEqual(folderLogs[0].data[0].folders, [
            { path: 'otter_vars', packageId: 'vars' },
        ]);
        assert.equal(entriesFor(KEEP_MISSING_LOG).length, 0);
        assert.equal(entriesFor(KEEP_PLANNED_LOG).length, 0);
    });

    it('collects nothing while an override uploads the package', async () => {
        const deployment = await prepareDeployment({
            nodeTypes: ['vars-math'],
            nodePackages: [makePackage('vars', VARS_PATHS)],
            nodePackagesGlobal: ['vars'],
            inventoryFiles: VARS_PATHS,
            options: { embeddedLibraryOverridePaths: VARS_PATHS },
        });

        assert.deepEqual(folderMap(deployment), {}, 'the folder *is* the override');
        assert.equal(
            entriesFor('collection-library-override-package-expanded').length,
            0,
            'a complete approval covers every path, so nothing is expanded'
        );
        assert.deepEqual(
            deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
            VARS_PATHS.slice().sort(),
            'every file of the package is planned'
        );
        assert.equal(entriesFor(KEEP_PLANNED_LOG).length, 0);
    });

    it('keeps the folder when the inventory is unavailable', async () => {
        const deployment = await prepareDeployment({
            nodeTypes: ['vars-math'],
            nodePackages: [makePackage('vars', VARS_PATHS)],
            nodePackagesGlobal: ['vars'],
            // The summary still reports embedded entries (the runtime declares them), but the
            // detailed inventory probe failed — the only state in which this branch is reached.
            embeddedInventory: null,
            embeddedEntries: VARS_PATHS.length,
        });

        assert.deepEqual(folderMap(deployment), {});

        const keepLogs = entriesFor(KEEP_MISSING_LOG);
        assert.equal(keepLogs.length, 0);
    });

    it('shadows instead of blocking when the inventory misses a needed file', async () => {
        // A firmware-bundled package whose version is current but whose inventory misses a file
        // is shadowed as a whole (source upload), not hard-blocked — once the consent gate
        // approved that whole-package shadow.
        const deployment = await prepareDeployment({
            nodeTypes: ['vars-math'],
            nodePackages: [makePackage('vars', VARS_PATHS)],
            nodePackagesGlobal: ['vars'],
            inventoryFiles: ['otter_vars/__init__.py', 'otter_vars/arrays.py'],
            options: { embeddedLibraryOverridePaths: VARS_PATHS },
        });

        assert.deepEqual(folderMap(deployment), {});
        assert.deepEqual(
            deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
            VARS_PATHS.slice().sort(),
            'the whole package is uploaded as source'
        );
    });

    it('collects nothing for a package the firmware does not bundle', async () => {
        const deployment = await prepareDeployment({
            nodeTypes: ['vars-math'],
            nodePackages: [makePackage('vars', VARS_PATHS)],
            nodePackagesGlobal: [],
            inventoryFiles: VARS_PATHS,
            embeddedEntries: 0,
        });

        assert.deepEqual(folderMap(deployment), {});
        assert.equal(entriesFor(KEEP_MISSING_LOG).length, 0);
        assert.deepEqual(
            deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
            VARS_PATHS.slice().sort(),
            'the package is uploaded as source'
        );
    });

    it('collects the package root only for a nested layout', async () => {
        const ledPaths = ['otter_led/__init__.py', 'otter_led/drivers/neopixel.py'];

        const deployment = await prepareDeployment({
            nodeTypes: ['led-neopixel'],
            nodePackages: [makePackage('led', ledPaths)],
            nodePackagesGlobal: ['led'],
            inventoryFiles: ledPaths,
        });

        assert.deepEqual(folderMap(deployment), { otter_led: 'led' });
    });

    it('maps libs/<name>/ files to libs/<name> and bare libs files to nothing', async () => {
        const shared = await prepareDeployment({
            nodeTypes: ['shared-thing'],
            nodePackages: [makePackage('shared', ['libs/shared/__init__.py'])],
            nodePackagesGlobal: ['shared'],
            inventoryFiles: ['libs/shared/__init__.py'],
        });

        assert.deepEqual(folderMap(shared), { 'libs/shared': 'shared' });

        const bare = await prepareDeployment({
            nodeTypes: ['bare-thing'],
            nodePackages: [makePackage('bare', ['libs/bare.py'])],
            nodePackagesGlobal: ['bare'],
            inventoryFiles: ['libs/bare.py'],
        });

        assert.deepEqual(folderMap(bare), {}, 'a bare libs/ file has no package folder to own');
    });

    it('collects nothing in dynamic runtime mode', async () => {
        const deployment = await prepareDeployment({
            nodeTypes: ['vars-math'],
            nodePackages: [makePackage('vars', VARS_PATHS)],
            nodePackagesGlobal: ['vars'],
            inventoryFiles: VARS_PATHS,
            runtimeEmbedded: false,
        });

        assert.deepEqual(folderMap(deployment), {});
        assert.equal(entriesFor(KEEP_MISSING_LOG).length, 0);
        assert.equal(entriesFor(KEEP_PLANNED_LOG).length, 0);
        assert.deepEqual(entriesFor(FOLDER_LOG)[0].data[0].folders, []);
    });

    it('collects nothing for a package the graph no longer imports', async () => {
        const deployment = await prepareDeployment({
            nodeTypes: ['other-node'],
            nodePackages: [makePackage('vars', VARS_PATHS)],
            nodePackagesGlobal: ['vars'],
            inventoryFiles: VARS_PATHS,
        });

        assert.equal(
            deployment._candidateLibraryPaths.size,
            0,
            'the package is not part of the plan at all'
        );
        assert.deepEqual(folderMap(deployment), {});
        assert.equal(entriesFor(KEEP_MISSING_LOG).length, 0);
    });
});

// The remaining guard branches cannot be reached through the full preparation: the safety net
// blocks a deploy whose firmware copy is incomplete, and the fetch loop plans every file it
// uploads. They are exercised directly so the decision logic stays pinned if that changes.
describe('CollectionDeployment firmware-owned package folder guards', () => {
    /**
     * @param {object} fixture - Fixture description for `createDeployment`
     * @param {string[]} candidatePaths - Library paths the graph needs
     * @param {Map<string, string[]>} packagePaths - Package asset paths per package
     * @param {string[]} [plannedPaths] - Library paths this deploy uploads
     * @param {string[]} [globalIds] - Firmware-bundled package ids
     * @returns {Map<string, string>} Collected folders
     */
    function collect(fixture, candidatePaths, packagePaths, plannedPaths = [], globalIds = []) {
        const deployment = createDeployment(fixture);
        deployment._candidateLibraryPaths = new Set(candidatePaths);

        const pathToPackageId = new Map();
        for (const [pkg, paths] of packagePaths) {
            for (const path of paths) {
                pathToPackageId.set(path, pkg);
            }
        }
        const inventoryFiles = fixture.inventoryFiles ?? [];
        const plan = resolveFirmwareModulePlan({
            embeddedMode: fixture.runtimeEmbedded !== false,
            declaredPaths: candidatePaths,
            pathToPackageId,
            packageAssetPaths: packagePaths,
            globalPackageIds: new Set(globalIds),
            inventoryPaths:
                fixture.embeddedInventory === null ? null : new Set(inventoryFiles),
            firmwareVersions: new Map(globalIds.map((id) => [id, '1.0.0'])),
            hostVersions: new Map(globalIds.map((id) => [id, '1.0.0'])),
            hostHasPath: () => true,
        });

        return deployment._collectFirmwareOwnedPackageFolders({
            embeddedMode: fixture.runtimeEmbedded !== false,
            packageAssetPathsByPackage: packagePaths,
            firmwareOwnedPackageIds: plan.firmwareOwnedPackageIds,
            plannedLibraryPaths: new Set(plannedPaths),
        });
    }

    it('treats a precompiled .mpy inventory entry as the declared .py module', () => {
        const folders = collect(
            {
                inventoryFiles: [
                    'otter_vars/__init__.mpy',
                    'otter_vars/arrays.mpy',
                    'otter_vars/math.mpy',
                ],
            },
            VARS_PATHS,
            new Map([['vars', VARS_PATHS]]),
            [],
            ['vars']
        );

        assert.deepEqual(Object.fromEntries(folders.entries()), { otter_vars: 'vars' });
    });

    it('keeps the folder when the inventory misses a needed file', () => {
        const folders = collect(
            { inventoryFiles: ['otter_vars/__init__.py', 'otter_vars/arrays.py'] },
            VARS_PATHS,
            new Map([['vars', VARS_PATHS]]),
            [],
            ['vars']
        );

        assert.deepEqual(Object.fromEntries(folders.entries()), {});
    });

    it('keeps a folder another package still uploads into', () => {
        const sharedPaths = ['libs/shared/firmware_part.py'];

        const folders = collect(
            { inventoryFiles: sharedPaths },
            sharedPaths,
            new Map([['firmware-pkg', sharedPaths]]),
            ['libs/shared/host_part.py'],
            ['firmware-pkg']
        );

        assert.deepEqual(Object.fromEntries(folders.entries()), {});

        const keepLogs = entriesFor(KEEP_PLANNED_LOG);
        assert.equal(keepLogs.length, 1);
        assert.equal(keepLogs[0].data[0].path, 'libs/shared');
        assert.equal(keepLogs[0].data[0].packageId, 'firmware-pkg');
    });
});
