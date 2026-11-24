// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for the globally-bundled package skip pre-check added to
// _prepareNodeLibrariesUpload in collection-deployment.ts.
//
// When embeddedLibraryOverridePaths is explicitly provided (not undefined):
//   - Files from globally-bundled packages NOT in the override list are skipped
//     unconditionally (regardless of effectiveInventorySummary).
//   - Files from globally-bundled packages IN the override list are uploaded.
// When embeddedLibraryOverridePaths is undefined:
//   - Old behaviour is preserved (falls through to _evaluateEffectiveLibraryAvailability).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

let originalFetch;
let originalWindow;

beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWindow = globalThis.window;
    globalThis.window = { location: { origin: 'http://localhost' } };
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

function createFetchFromMap(responseMap) {
    return async (url) => {
        const key = String(url);
        const response = responseMap[key];
        if (!response) {
            return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
        }
        return response;
    };
}

function makeDeployment(deviceStateOverrides = {}, runtimeOverrides = {}) {
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
            effectiveInventorySummary: null, // intentionally null to test pre-check bypass
            embeddedPackagesSummary: {
                totalPackages: 2,
                totalFiles: 3,
                totalBytes: 0,
                packages: [
                    { name: 'webview', version: '1.3.1' },
                    { name: 'core', version: '1.0.0' },
                ],
            },
            embeddedInventory: {
                files: [
                    { path: 'otter_webview/__init__.py', source: 'embedded' },
                    { path: 'otter_webview/panel.py', source: 'embedded' },
                    { path: 'otter_core/base.py', source: 'embedded' },
                ],
            },
            deviceTargetInfo: { id: 'esp32' },
            ...deviceStateOverrides,
        },
        updateDeviceState() {},
        collectionManager: {
            getNodeType(nodeTypeId) {
                const impls = {
                    'webview-panel': {
                        implementations: { python: { dependencies: ['otter_webview.panel'] } },
                    },
                    'core-node': {
                        implementations: { python: { dependencies: ['otter_core.base'] } },
                    },
                };
                return impls[nodeTypeId] || null;
            },
        },
        runtimeCollection: {
            getRuntime(runtimeId) {
                if (runtimeId !== 'general') return null;
                return {
                    id: 'general',
                    version: '1.0.0',
                    resolvedFilesystem: [],
                    nodePackagesGlobal: ['webview', 'core'],
                    ...runtimeOverrides,
                    nodePackages: runtimeOverrides.nodePackages || [
                        {
                            id: 'webview',
                            manifest: { version: '1.3.1' },
                            mpAssets: {
                                '*': [
                                    '/device/node_pkgs/webview/otter_webview/__init__.py',
                                    '/device/node_pkgs/webview/otter_webview/panel.py',
                                ],
                            },
                        },
                        {
                            id: 'core',
                            manifest: { version: '1.0.0' },
                            mpAssets: {
                                '*': ['/device/node_pkgs/core/otter_core/base.py'],
                            },
                        },
                    ],
                };
            },
        },
        transpiler: {},
    });
}

function makeCollection(nodeTypeIds = ['webview-panel', 'core-node']) {
    return {
        getGraphArray() {
            return [
                {
                    getNodes() {
                        return nodeTypeIds.map((t, i) => ({ id: `n${i}`, type: t }));
                    },
                },
            ];
        },
    };
}

describe('_prepareNodeLibrariesUpload — globally-bundled package skip pre-check', () => {
    it('skips all globally-bundled files when override list is explicitly empty (no outdated packages)', async () => {
        globalThis.fetch = createFetchFromMap({
            '/device/node_pkgs/webview/otter_webview/__init__.py': {
                ok: true,
                text: async () => '# webview init\n',
            },
            '/device/node_pkgs/webview/otter_webview/panel.py': {
                ok: true,
                text: async () => '# webview panel\n',
            },
            '/device/node_pkgs/core/otter_core/base.py': {
                ok: true,
                text: async () => '# core base\n',
            },
        });

        const deployment = makeDeployment();
        deployment._hashManager = {
            async load() {},
            getFiles() {
                return {};
            },
            async prepareFile() {
                return { needsUpload: true, hash: 'hash' };
            },
        };

        const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {
            embeddedLibraryOverridePaths: [], // explicitly empty = no packages outdated
        });

        assert.equal(count, 0, 'No files should be prepared when all packages are up-to-date');
        assert.deepEqual(deployment._preparedFiles.libraries, []);
    });

    it('uploads only the outdated (webview) package files when core is not in the override list', async () => {
        globalThis.fetch = createFetchFromMap({
            '/device/node_pkgs/webview/otter_webview/__init__.py': {
                ok: true,
                text: async () => '# webview init\n',
            },
            '/device/node_pkgs/webview/otter_webview/panel.py': {
                ok: true,
                text: async () => '# webview panel\n',
            },
            '/device/node_pkgs/core/otter_core/base.py': {
                ok: true,
                text: async () => '# core base\n',
            },
        });

        const deployment = makeDeployment();
        deployment._hashManager = {
            async load() {},
            getFiles() {
                return {};
            },
            async prepareFile() {
                return { needsUpload: true, hash: 'hash' };
            },
        };

        // webview is outdated → its paths go in the override list; core is up-to-date
        const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {
            embeddedLibraryOverridePaths: ['otter_webview/__init__.py', 'otter_webview/panel.py'],
        });

        const uploadedPaths = deployment._preparedFiles.libraries.map((f) => f.devicePath);

        assert.ok(
            uploadedPaths.includes('otter_webview/__init__.py'),
            'webview init should be uploaded'
        );
        assert.ok(
            uploadedPaths.includes('otter_webview/panel.py'),
            'webview panel should be uploaded'
        );
        assert.ok(!uploadedPaths.includes('otter_core/base.py'), 'core file must NOT be uploaded');
        assert.equal(count, 2, 'Only the 2 webview files should be prepared');
    });

    it('skips current packages even when no override list is provided', async () => {
        globalThis.fetch = createFetchFromMap({
            '/device/node_pkgs/webview/otter_webview/__init__.py': {
                ok: true,
                text: async () => '# webview init\n',
            },
            '/device/node_pkgs/webview/otter_webview/panel.py': {
                ok: true,
                text: async () => '# webview panel\n',
            },
            '/device/node_pkgs/core/otter_core/base.py': {
                ok: true,
                text: async () => '# core base\n',
            },
        });

        const deployment = makeDeployment();
        deployment._hashManager = {
            async load() {},
            getFiles() {
                return {};
            },
            async prepareFile() {
                return { needsUpload: true, hash: 'hash' };
            },
        };

        // No override list: the plan derives currency from version + inventory alone.
        const count = await deployment._prepareNodeLibrariesUpload(makeCollection());

        assert.equal(count, 0, 'every package is current, so nothing is uploaded');
    });

    it('does not re-add globally bundled required package files in embedded mode', async () => {
        globalThis.fetch = createFetchFromMap({
            '/device/node_pkgs/webview/otter_webview/__init__.py': {
                ok: true,
                text: async () => '# webview init\n',
            },
            '/device/node_pkgs/vars/otter_vars/__init__.py': {
                ok: true,
                text: async () => '# vars init\n',
            },
            '/device/node_pkgs/vars/otter_vars/store.py': {
                ok: true,
                text: async () => '# vars store\n',
            },
            '/device/node_pkgs/vars/otter_vars/arrays.py': {
                ok: true,
                text: async () => '# vars arrays\n',
            },
        });

        const deployment = makeDeployment(
            {
                embeddedPackagesSummary: {
                    totalPackages: 2,
                    totalFiles: 4,
                    totalBytes: 0,
                    packages: [
                        { name: 'webview', version: '1.31.0' },
                        { name: 'vars', version: '0.16.0' },
                    ],
                },
                embeddedInventory: {
                    files: [
                        { path: 'otter_webview/__init__.py', source: 'embedded' },
                        { path: 'otter_vars/__init__.py', source: 'embedded' },
                        { path: 'otter_vars/store.py', source: 'embedded' },
                        { path: 'otter_vars/arrays.py', source: 'embedded' },
                    ],
                },
            },
            {
                nodePackagesGlobal: ['webview', 'vars'],
                nodePackages: [
                    {
                        id: 'webview',
                        manifest: { version: '1.31.0' },
                        requiredPackages: ['vars'],
                        mpAssets: {
                            '*': ['/device/node_pkgs/webview/otter_webview/__init__.py'],
                        },
                    },
                    {
                        id: 'vars',
                        manifest: { version: '0.16.0' },
                        mpAssets: {
                            '*': [
                                '/device/node_pkgs/vars/otter_vars/__init__.py',
                                '/device/node_pkgs/vars/otter_vars/store.py',
                                '/device/node_pkgs/vars/otter_vars/arrays.py',
                            ],
                        },
                    },
                ],
            }
        );
        deployment._hashManager = {
            async load() {},
            getFiles() {
                return {};
            },
            async prepareFile() {
                return { needsUpload: true, hash: 'hash' };
            },
        };

        const count = await deployment._prepareNodeLibrariesUpload(
            makeCollection(['webview.web-view-number-input']),
            { embeddedLibraryOverridePaths: ['otter_webview/__init__.py'] }
        );

        const uploads = deployment._preparedFiles.libraries.map((file) => file.devicePath);

        assert.deepEqual(uploads, ['otter_webview/__init__.py']);
        assert.equal(count, 1, 'Globally bundled required package files must not be re-uploaded');
    });

    it('uploads required package files exactly once in dynamic mode', async () => {
        globalThis.fetch = createFetchFromMap({
            '/device/node_pkgs/webview/otter_webview/__init__.py': {
                ok: true,
                text: async () => '# webview init\n',
            },
            '/device/node_pkgs/vars/otter_vars/__init__.py': {
                ok: true,
                text: async () => '# vars init\n',
            },
            '/device/node_pkgs/vars/otter_vars/store.py': {
                ok: true,
                text: async () => '# vars store\n',
            },
            '/device/node_pkgs/vars/otter_vars/arrays.py': {
                ok: true,
                text: async () => '# vars arrays\n',
            },
        });

        const deployment = makeDeployment(
            { runtimeEmbedded: false, runtimeDeploymentMode: 'dynamic' },
            {
                nodePackagesGlobal: [],
                nodePackages: [
                    {
                        id: 'webview',
                        manifest: { version: '1.31.0' },
                        requiredPackages: ['vars'],
                        mpAssets: {
                            '*': ['/device/node_pkgs/webview/otter_webview/__init__.py'],
                        },
                    },
                    {
                        id: 'vars',
                        manifest: { version: '0.16.0' },
                        mpAssets: {
                            '*': [
                                '/device/node_pkgs/vars/otter_vars/__init__.py',
                                '/device/node_pkgs/vars/otter_vars/store.py',
                                '/device/node_pkgs/vars/otter_vars/arrays.py',
                            ],
                        },
                    },
                ],
            }
        );
        deployment._hashManager = {
            async load() {},
            getFiles() {
                return {};
            },
            async prepareFile() {
                return { needsUpload: true, hash: 'hash' };
            },
        };

        const count = await deployment._prepareNodeLibrariesUpload(
            makeCollection(['webview.web-view-number-input', 'vars.var-read'])
        );

        const uploads = deployment._preparedFiles.libraries
            .map((file) => file.devicePath)
            .sort();

        assert.deepEqual(uploads, [
            'otter_vars/__init__.py',
            'otter_vars/arrays.py',
            'otter_vars/store.py',
            'otter_webview/__init__.py',
        ]);
        assert.equal(count, 4);
        assert.equal(new Set(uploads).size, uploads.length, 'Expected no duplicate uploads');
    });
});
