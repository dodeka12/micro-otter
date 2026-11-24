// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Regression test for the embedded source-override redeploy bug.
//
// Deploy #1 uploads a source override into user space. Deploy #2 used to skip those files as
// "available-dynamic" because they were recorded in the hash manifest, which dropped them from
// the prepared plan and made the stale cleanup delete them. These tests run the real chain
// (_prepareNodeLibrariesUpload -> hash staging -> _getStaleCollectionPaths -> delete) twice and
// pin both the invariant and the two legitimate removal paths.
//
// The chain also covers `_prepareNodeLibrariesUpload -> _firmwareOwnedPackageFolders ->
// _removeStaleLibraryFolders`: once the firmware ships every file of the package, the whole
// `otter_vars/` folder must disappear — even when the hash manifest never recorded one of its
// files. A leftover folder still shadows the firmware and resurfaces as
// `ImportError: no module named 'otter_vars.arrays'`.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';
import { calculateFileHash } from '../../src/micro_otter/nodes/html/js/deployment/deployment-utils.js';

const MANIFEST_PATH = '/.micro-otter-sync-manifest';

const OVERRIDE_PATHS = ['otter_vars/__init__.py', 'otter_vars/arrays.py', 'otter_vars/math.py'];

const ASSET_URLS = {
    'otter_vars/__init__.py': '/device/node_pkgs/vars/otter_vars/__init__.py',
    'otter_vars/arrays.py': '/device/node_pkgs/vars/otter_vars/arrays.py',
    'otter_vars/math.py': '/device/node_pkgs/vars/otter_vars/math.py',
};

const FILE_CONTENT = {
    'otter_vars/__init__.py': '# vars init\n',
    'otter_vars/arrays.py': '# vars arrays\n',
    'otter_vars/math.py': '# vars math\n',
};

let originalFetch;
let originalWindow;
let originalLog;

beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWindow = globalThis.window;
    originalLog = globalThis.__microOtterLog;
    globalThis.window = { location: { origin: 'http://localhost' } };

    globalThis.__capturedLogs = [];
    globalThis.__microOtterLog = {
        log(scope, reason, level, ...data) {
            globalThis.__capturedLogs.push({ scope, reason, level, data });
        },
    };

    globalThis.fetch = async (url) => {
        const key = String(url);
        const devicePath = Object.keys(ASSET_URLS).find((p) => ASSET_URLS[p] === key);
        if (!devicePath) {
            return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
        }
        return { ok: true, text: async () => FILE_CONTENT[devicePath], json: async () => ({}) };
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

/**
 * Captured log entries for one reason.
 * @param {string} reason - Log reason to find
 * @returns {object[]} Matching entries
 */
function logEntries(reason) {
    return (globalThis.__capturedLogs || []).filter((entry) => entry.reason === reason);
}

/**
 * Folder removals that were meant to delete a whole tree.
 * `_removeStaleCollectionFiles()` prunes emptied folders first (`recursive: false`), so a full
 * deploy records both kinds; these tests assert on the tree removals.
 * @param {Array<{path: string, options: object}>} calls - Recorded folder removals
 * @returns {Array<{path: string, options: object}>} Tree removals only
 */
function recursiveRemovals(calls) {
    return calls.filter((call) => call.options?.recursive !== false);
}

/**
 * Build a deployment whose device belongs to the override scenario.
 * @param {object} [opts] - Fixture options
 * @param {Array<{path: string}>} [opts.inventoryFiles] - Files the firmware actually ships
 * @param {object|null} [opts.manifest] - Hash manifest returned by the device (`null` = ENOENT)
 * @param {number} [opts.removeFolderResult] - Removed entry count reported for a folder removal
 * @param {Error|null} [opts.removeFolderError] - Error thrown by a folder removal instead
 * @returns {{deployment: CollectionDeployment, deletedPaths: string[], removedFolderCalls: Array<{path: string, options: object}>}} Deployment plus spies
 */
function makeDeployment({
    inventoryFiles = [],
    manifest = null,
    removeFolderResult = 1,
    removeFolderError = null,
} = {}) {
    const deletedPaths = [];
    const removedFolderCalls = [];
    const deployment = new CollectionDeployment({
        deviceConnection: {
            async readTextFile(path) {
                if (path !== MANIFEST_PATH) {
                    return '';
                }
                if (manifest === null) {
                    const error = new Error('ENOENT: no such file');
                    throw error;
                }
                return JSON.stringify(manifest);
            },
            async writeTextFile() {},
            async sendFile() {},
            async calculateHash() {
                return 'hash';
            },
            async softReset() {},
            async deleteFile(path) {
                deletedPaths.push(path);
            },
            async deleteFolderRecursive() {},
            async removeFolder(path, options = {}) {
                removedFolderCalls.push({ path, options });
                if (removeFolderError) {
                    throw removeFolderError;
                }
                return removeFolderResult;
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
                totalEntries: 3,
                embeddedEntries: 3,
                dynamicEntries: 0,
                overriddenEntries: 0,
            },
            embeddedInventory: {
                files: inventoryFiles.map((file) => ({
                    ...file,
                    source: file.source || 'embedded',
                })),
            },
            embeddedPackagesSummary: {
                totalPackages: 1,
                totalFiles: 0,
                totalBytes: 0,
                packages: [{ name: 'vars', version: '1.2.0' }],
            },
            deviceTargetInfo: { id: 'esp32' },
        },
        updateDeviceState() {},
        collectionManager: {
            getNodeType(nodeTypeId) {
                if (nodeTypeId !== 'vars-array-modify') {
                    return null;
                }
                return {
                    implementations: {
                        python: { dependencies: ['otter_vars.arrays'] },
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
                    nodePackagesGlobal: ['vars'],
                    nodePackages: [
                        {
                            id: 'vars',
                            manifest: { version: '1.2.0' },
                            mpAssets: {
                                '*': Object.values(ASSET_URLS),
                            },
                        },
                    ],
                };
            },
        },
        transpiler: {},
    });

    return { deployment, deletedPaths, removedFolderCalls };
}

/**
 * Build a collection whose single graph uses the vars package.
 * @param {string[]} [nodeTypes] - Node types of the graph
 * @returns {object} Collection mock
 */
function makeCollection(nodeTypes = ['vars-array-modify']) {
    return {
        getGraphArray() {
            return [
                {
                    getNodes() {
                        return nodeTypes.map((type, index) => ({ id: `n${index}`, type }));
                    },
                },
            ];
        },
    };
}

/**
 * Build a collection hash manifest that records the given device paths.
 * @param {Record<string, string>} hashes - Device path → content hash
 * @returns {object} Manifest as returned by HashManifestManager.load()
 */
function makeManifest(hashes) {
    return {
        version: '1.0.0',
        created: '2026-02-12T10:00:00Z',
        updated: '2026-02-12T10:00:00Z',
        collection: { files: hashes },
    };
}

/**
 * Build a manifest whose recorded hashes match the uploaded override content.
 * @param {Record<string, string>} overrides - Device paths whose recorded hash deviates
 * @returns {Promise<object>} Manifest for {@link makeDeployment}
 */
async function makeOverrideManifest(overrides = {}) {
    const hashes = {};
    for (const devicePath of OVERRIDE_PATHS) {
        hashes[devicePath] = Object.prototype.hasOwnProperty.call(overrides, devicePath)
            ? overrides[devicePath]
            : await calculateFileHash(FILE_CONTENT[devicePath]);
    }
    return makeManifest(hashes);
}

/**
 * Run one deploy's library planning phase.
 *
 * Covers the whole chain the folder cleanup depends on:
 * `_prepareNodeLibrariesUpload → _firmwareOwnedPackageFolders → _getStaleCollectionPaths`.
 * @param {CollectionDeployment} deployment - Deployment under test
 * @param {object} [options] - Options forwarded to `_prepareNodeLibrariesUpload`
 * @param {string[]} [nodeTypes] - Node types of the collection graph
 * @returns {Promise<{uploads: string[], stale: string[], folders: Array<[string, string]>}>} Planned paths, stale paths and firmware-owned folders
 */
async function planDeploy(deployment, options = {}, nodeTypes = ['vars-array-modify']) {
    await deployment._prepareNodeLibrariesUpload(makeCollection(nodeTypes), options);

    const uploads = deployment._preparedFiles.libraries.map((file) => file.devicePath).sort();
    const stale = deployment
        ._getStaleCollectionPaths(deployment._hashManager.getFiles('collection'))
        .slice()
        .sort();
    const folders = Array.from(deployment._firmwareOwnedPackageFolders.entries());

    return { uploads, stale, folders };
}

describe('CollectionDeployment — embedded source override redeploy', () => {
    it('keeps an uploaded override in the plan and deletes nothing on the next deploy', async () => {
        // --- Deploy 1: empty manifest, user approves the override -------------------------
        const first = makeDeployment();
        const firstPlan = await planDeploy(first.deployment, {
            embeddedLibraryOverridePaths: OVERRIDE_PATHS,
        });

        assert.deepEqual(firstPlan.uploads, OVERRIDE_PATHS);
        assert.deepEqual(firstPlan.stale, []);
        const tags = first.deployment._preparedFiles.libraries.map((file) => file.manifestTag);
        assert.deepEqual(
            tags,
            OVERRIDE_PATHS.map(() => 'override-embedded')
        );

        // --- Deploy 2: the same files are now recorded in the hash manifest ----------------
        // `otter_vars/math.py` keeps a foreign hash so the hash layer still re-uploads it.
        const manifest = await makeOverrideManifest({ 'otter_vars/math.py': 'stale-hash' });
        const second = makeDeployment({ manifest });
        const secondPlan = await planDeploy(second.deployment, {
            embeddedLibraryOverridePaths: OVERRIDE_PATHS,
        });

        assert.deepEqual(
            secondPlan.uploads,
            OVERRIDE_PATHS,
            'a manifest entry must never remove a file from the plan'
        );
        assert.deepEqual(secondPlan.stale, [], 'the override must not be deleted as stale');

        const toUpload = second.deployment._hashManager.getFilesToUpload('collection').sort();
        assert.deepEqual(
            toUpload,
            ['otter_vars/math.py'],
            'only the hash layer suppresses re-uploads of unchanged content'
        );

        const removed = await second.deployment._removeStaleCollectionFiles(secondPlan.stale);
        assert.equal(removed, 0);
        assert.deepEqual(second.deletedPaths, []);
    });

    it('deletes the override once the firmware ships the same files', async () => {
        const manifest = await makeOverrideManifest();
        const { deployment, deletedPaths } = makeDeployment({
            manifest,
            inventoryFiles: OVERRIDE_PATHS.map((path) => ({ path })),
        });

        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: [] });

        assert.deepEqual(plan.uploads, [], 'the firmware copy is used, no source is uploaded');
        assert.deepEqual(
            plan.stale,
            OVERRIDE_PATHS,
            'the firmware can replace every file, so the user-space copies are removed'
        );

        await deployment._removeStaleCollectionFiles(plan.stale);
        assert.deepEqual(deletedPaths.slice().sort(), OVERRIDE_PATHS);
    });

    it('deletes an unused package even when the firmware does not ship it', async () => {
        const manifest = await makeOverrideManifest();
        const { deployment, deletedPaths } = makeDeployment({ manifest });

        // Graph no longer uses the vars package, so nothing of it is a candidate library.
        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: [] }, [
            'math-add',
        ]);

        assert.deepEqual(plan.uploads, []);
        assert.deepEqual(
            deployment._candidateLibraryPaths.size,
            0,
            'no library of the package is still needed'
        );
        assert.deepEqual(plan.stale, OVERRIDE_PATHS, 'user-space garbage is cleaned up');

        await deployment._removeStaleCollectionFiles(plan.stale);
        assert.deepEqual(
            deletedPaths.slice().sort(),
            OVERRIDE_PATHS,
            'only paths of the unused package may be deleted'
        );
    });

    it('removes the package folder once the firmware ships every file', async () => {
        const manifest = await makeOverrideManifest();
        const { deployment, removedFolderCalls } = makeDeployment({
            manifest,
            inventoryFiles: OVERRIDE_PATHS.map((path) => ({ path })),
        });

        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: [] });

        assert.deepEqual(plan.uploads, [], 'the firmware copy is used, no source is uploaded');
        assert.deepEqual(plan.stale, OVERRIDE_PATHS);
        assert.deepEqual(plan.folders, [['otter_vars', 'vars']]);

        await deployment._removeStaleCollectionFiles(plan.stale);
        const removedFolders = await deployment._removeStaleLibraryFolders();

        assert.equal(removedFolders, 1);
        assert.deepEqual(recursiveRemovals(removedFolderCalls), [
            { path: 'otter_vars', options: {} },
        ]);
    });

    it('removes a leftover package folder the hash manifest never recorded', async () => {
        // The reported failure: the device holds `otter_vars/` but has no sync manifest, so the
        // per-file subtraction has nothing to subtract and the folder used to stay for ever.
        const { deployment, removedFolderCalls } = makeDeployment({
            manifest: null,
            inventoryFiles: OVERRIDE_PATHS.map((path) => ({ path })),
        });

        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: [] });

        assert.deepEqual(plan.stale, [], 'no manifest entry ⇒ nothing for the subtraction');
        assert.deepEqual(plan.folders, [['otter_vars', 'vars']]);

        await deployment._removeStaleCollectionFiles(plan.stale);
        const removedFolders = await deployment._removeStaleLibraryFolders();

        assert.equal(removedFolders, 1, 'the folder is the only thing that removes the shadow');
        assert.deepEqual(recursiveRemovals(removedFolderCalls), [
            { path: 'otter_vars', options: {} },
        ]);
    });

    it('treats a second deploy after the cleanup as a no-op', async () => {
        const { deployment, removedFolderCalls } = makeDeployment({
            manifest: null,
            inventoryFiles: OVERRIDE_PATHS.map((path) => ({ path })),
            removeFolderResult: 0,
        });

        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: [] });
        assert.deepEqual(plan.folders, [['otter_vars', 'vars']]);

        const removedFolders = await deployment._removeStaleLibraryFolders();

        assert.equal(removedFolders, 0, 'nothing existed, so nothing changed');
        assert.deepEqual(
            removedFolderCalls,
            [{ path: 'otter_vars', options: {} }],
            'the attempt is still made'
        );
        assert.equal(
            logEntries('collection-library-folder-removed').length,
            0,
            'a no-op removal must not look like a change'
        );
    });

    it('keeps the package folder while an override is active', async () => {
        const { deployment, removedFolderCalls } = makeDeployment({
            inventoryFiles: OVERRIDE_PATHS.map((path) => ({ path })),
        });

        const plan = await planDeploy(deployment, {
            embeddedLibraryOverridePaths: OVERRIDE_PATHS,
        });

        assert.deepEqual(plan.uploads, OVERRIDE_PATHS);
        assert.deepEqual(plan.folders, [], 'the folder *is* the override');

        assert.equal(await deployment._removeStaleLibraryFolders(), 0);
        assert.deepEqual(removedFolderCalls, []);
    });

    it('shadows instead of blocking a package with an incomplete inventory', async () => {
        // A firmware-bundled package whose version is current but whose inventory misses a file
        // is shadowed as a whole (source upload), not hard-blocked — and the whole-package
        // approval is what authorises that upload. The folder is not half-owned: every file is
        // uploaded, so the user-space copies win.
        const { deployment } = makeDeployment({
            inventoryFiles: OVERRIDE_PATHS.slice(0, 2).map((path) => ({ path })),
        });

        // Without an approval the deploy must abort instead of keeping the firmware copy.
        await assert.rejects(
            () => planDeploy(deployment, { embeddedLibraryOverridePaths: [] }),
            (error) => {
                assert.equal(error.name, 'EmbeddedOverrideApprovalRequiredError');
                assert.deepEqual(error.packageIds, ['vars']);
                return true;
            }
        );

        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: OVERRIDE_PATHS });
        assert.deepEqual(
            plan.uploads.slice().sort(),
            OVERRIDE_PATHS.slice().sort(),
            'the whole package is uploaded as source'
        );
        assert.deepEqual(plan.folders, [], 'no folder is firmware-owned when the package is shadowed');
    });

    it('treats a precompiled .mpy firmware inventory as providing the declared .py files', async () => {
        // A firmware built in compiled-mpy mode lists `x/y.mpy` where the node package declares
        // `x/y.py`. The safety net and the stale-cleanup guard must accept the `.mpy` alias, so
        // the deploy proceeds and the firmware-owned folder decision removes the user-space copies.
        const manifest = await makeOverrideManifest();
        const { deployment, deletedPaths } = makeDeployment({
            manifest,
            inventoryFiles: OVERRIDE_PATHS.map((path) => ({
                path: path.replace(/\.py$/, '.mpy'),
            })),
        });

        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: [] });

        assert.deepEqual(plan.uploads, [], 'the firmware .mpy copy is used, no source is uploaded');
        assert.deepEqual(
            plan.stale,
            OVERRIDE_PATHS,
            'the firmware can replace every file, so the user-space copies are removed'
        );
        assert.deepEqual(plan.folders, [['otter_vars', 'vars']], 'the whole folder is firmware-owned');

        await deployment._removeStaleCollectionFiles(plan.stale);
        assert.deepEqual(deletedPaths.slice().sort(), OVERRIDE_PATHS);
    });

    it('keeps deploying when the folder removal fails', async () => {
        const manifest = await makeOverrideManifest();
        const { deployment, deletedPaths } = makeDeployment({
            manifest,
            inventoryFiles: OVERRIDE_PATHS.map((path) => ({ path })),
            removeFolderError: new Error('EPERM'),
        });

        const plan = await planDeploy(deployment, { embeddedLibraryOverridePaths: [] });

        const removedFiles = await deployment._removeStaleCollectionFiles(plan.stale);
        const removedFolders = await deployment._removeStaleLibraryFolders();

        assert.equal(removedFiles, OVERRIDE_PATHS.length);
        assert.deepEqual(
            deletedPaths.slice().sort(),
            OVERRIDE_PATHS,
            'the file deletions still happened'
        );
        assert.equal(removedFolders, 0);

        const failureLogs = logEntries('collection-library-folder-remove-failed');
        assert.equal(failureLogs.length, 1);
        assert.equal(failureLogs[0].level, 'warn');
        assert.equal(failureLogs[0].data[0].path, 'otter_vars');
        assert.match(failureLogs[0].data[0].error, /EPERM/);
    });
});
