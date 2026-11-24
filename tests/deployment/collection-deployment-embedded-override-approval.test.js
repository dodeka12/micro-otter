// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Fail-closed approval: a shadow package may only reach the upload phase when the consent gate
// approved every one of its files. A missing or partial approval aborts the deploy instead of
// silently keeping the firmware's frozen copy.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

const VARS_PATHS = ['otter_vars/__init__.py', 'otter_vars/store.py'];

let originalFetch;
let originalWindow;
let originalLog;

beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWindow = globalThis.window;
    originalLog = globalThis.__microOtterLog;
    globalThis.window = { location: { origin: 'http://localhost' } };
    globalThis.fetch = async (url) => {
        const key = String(url);
        if (!key.includes('/node_pkgs/')) {
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
});

afterEach(() => {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLog === undefined) delete globalThis.__microOtterLog;
    else globalThis.__microOtterLog = originalLog;
});

/**
 * Capture CollectionDeployment log entries.
 * @returns {Array<{reason: string, level: string, data: unknown[]}>} Captured entries
 */
function captureLogs() {
    const entries = [];
    globalThis.__microOtterLog = {
        log(scope, reason, level, ...data) {
            entries.push({ scope, reason, level, data });
        },
    };
    return entries;
}

/**
 * Build a CollectionDeployment whose firmware bundles `vars`.
 * @param {object} [opts] - Fixture options
 * @param {string} [opts.deviceVersion] - Firmware `vars` version
 * @param {string} [opts.hostVersion] - Host `vars` version
 * @param {boolean} [opts.embedded] - Embedded (default) or dynamic runtime mode
 * @returns {CollectionDeployment} Deployment under test
 */
function makeDeployment({ deviceVersion = '0.19.0', hostVersion = '0.20.0', embedded = true } = {}) {
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
            runtimeDeploymentMode: embedded ? 'embedded' : 'dynamic',
            runtimeEmbedded: embedded,
            effectiveInventorySummary: {
                totalEntries: VARS_PATHS.length,
                embeddedEntries: VARS_PATHS.length,
                dynamicEntries: 0,
                overriddenEntries: 0,
            },
            embeddedInventory: {
                files: VARS_PATHS.map((path) => ({ path, source: 'embedded' })),
            },
            embeddedPackagesSummary: {
                totalPackages: 1,
                totalFiles: VARS_PATHS.length,
                totalBytes: 0,
                packages: [{ name: 'vars', version: deviceVersion }],
            },
            deviceTargetInfo: { id: 'esp32' },
        },
        updateDeviceState() {},
        collectionManager: {
            getNodeType() {
                return null;
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
                            manifest: { version: hostVersion },
                            mpAssets: {
                                '*': VARS_PATHS.map((path) => `/device/node_pkgs/vars/${path}`),
                            },
                        },
                    ],
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
 * Build a collection whose graph uses the vars package.
 * @param {string[]} [nodeTypes] - Node types of the graph
 * @returns {object} Collection mock
 */
function makeCollection(nodeTypes = ['vars.array-generate']) {
    return {
        getDeviceRuntimeId: () => 'general',
        getGraphArray: () => [
            {
                getNodes: () => nodeTypes.map((type, index) => ({ id: `n${index}`, type })),
            },
        ],
    };
}

describe('CollectionDeployment — embedded override approval', () => {
    it('aborts a shadow upload that has no approval and uploads nothing', async () => {
        const deployment = makeDeployment();
        captureLogs();

        await assert.rejects(
            () => deployment._prepareNodeLibrariesUpload(makeCollection(), {}),
            (error) => {
                assert.equal(error.name, 'EmbeddedOverrideApprovalRequiredError');
                assert.equal(error.code, 'EMBEDDED_OVERRIDE_APPROVAL_REQUIRED');
                assert.deepEqual(error.packageIds, ['vars']);
                assert.deepEqual(error.missingPaths, VARS_PATHS);
                assert.match(error.message, /approval is missing for vars/);
                assert.match(error.message, /2 unapproved files/);
                return true;
            }
        );

        assert.deepEqual(deployment._preparedFiles.libraries, [], 'no file may be prepared');
    });

    it('uploads and tags the whole package when the approval covers every file', async () => {
        const deployment = makeDeployment();

        const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {
            embeddedLibraryOverridePaths: VARS_PATHS,
        });

        assert.equal(count, VARS_PATHS.length);
        assert.deepEqual(
            deployment._preparedFiles.libraries.map((file) => file.devicePath).sort(),
            VARS_PATHS
        );
        assert.deepEqual(
            deployment._preparedFiles.libraries.map((file) => file.manifestTag),
            VARS_PATHS.map(() => 'override-embedded')
        );
    });

    it('aborts a partially approved package', async () => {
        const deployment = makeDeployment();

        await assert.rejects(
            () =>
                deployment._prepareNodeLibrariesUpload(makeCollection(), {
                    embeddedLibraryOverridePaths: [VARS_PATHS[0]],
                }),
            (error) => {
                assert.equal(error.name, 'EmbeddedOverrideApprovalRequiredError');
                assert.deepEqual(error.packageIds, ['vars']);
                assert.deepEqual(error.missingPaths, [VARS_PATHS[1]]);
                return true;
            }
        );

        assert.deepEqual(deployment._preparedFiles.libraries, []);
    });

    it('logs an auditable forced run without approving paths implicitly', async () => {
        const deployment = makeDeployment();
        const logs = captureLogs();

        await assert.rejects(
            () =>
                deployment._prepareNodeLibrariesUpload(makeCollection(), {
                    embeddedOverrideMode: 'forced',
                }),
            (error) => error.name === 'EmbeddedOverrideApprovalRequiredError'
        );

        const forced = makeDeployment();
        const count = await forced._prepareNodeLibrariesUpload(makeCollection(), {
            embeddedLibraryOverridePaths: VARS_PATHS,
            embeddedOverrideMode: 'forced',
        });

        assert.equal(count, VARS_PATHS.length);
        const forcedLogs = logs.filter(
            (entry) => entry.reason === 'collection-library-override-forced'
        );
        assert.equal(forcedLogs.length, 1);
        assert.deepEqual(forcedLogs[0].data[0].packageIds, ['vars']);
        assert.equal(forcedLogs[0].data[0].fileCount, VARS_PATHS.length);
    });

    it('neither aborts nor uploads when the firmware package is current', async () => {
        const deployment = makeDeployment({ deviceVersion: '0.21.0' });

        const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {});

        assert.equal(count, 0);
        assert.deepEqual(deployment._preparedFiles.libraries, []);
    });
});
