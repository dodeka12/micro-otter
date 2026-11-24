// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for Phase 4.5 Step 4: safety-net file-availability check in
// _prepareNodeLibrariesUpload (collection-deployment.ts).
//
// The check iterates libPathToPackageId (mpAssets-derived files only) and
// verifies that each file is actually deployable before starting uploads:
//   - Globally-bundled in embedded mode → must be in embeddedInventory
//   - Non-globally-bundled / dynamic mode → must be findable via _findLibraryUrl

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

// ---------------------------------------------------------------------------
// window mock (required for URL parsing inside collection-deployment helpers)
// ---------------------------------------------------------------------------
let originalWindow;
beforeEach(() => {
    originalWindow = globalThis.window;
    globalThis.window = { location: { origin: 'http://localhost' } };
});
afterEach(() => {
    if (originalWindow === undefined) {
        delete globalThis.window;
    } else {
        globalThis.window = originalWindow;
    }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssetUrl(pkgId, libPath) {
    return `/device/node_pkgs/${pkgId}/${libPath}`;
}

/**
 * Build a minimal CollectionDeployment for the safety-net tests.
 * @param {object} opts - Fake deployment options assembled by {@link makeDeployment}
 * @param {string[]} opts.globalPackageIds - Package IDs bundled in firmware
 * @param {Array<{id, mpAssets}>} opts.packages - Runtime node packages
 * @param {object|null} opts.inventory - embeddedInventory ({files}) or null
 * @param {boolean} opts.embedded - Whether runtime is embedded
 */
function makeDeployment({
    globalPackageIds = [],
    packages = [],
    inventory = null,
    embedded = true,
} = {}) {
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
            runtimeVersion: embedded ? '1.0.0' : null,
            runtimeEmbedded: embedded,
            runtimeDeploymentMode: embedded ? 'embedded' : 'dynamic',
            deviceTargetInfo: { id: 'esp32' },
            embeddedInventory: inventory,
        },
        updateDeviceState() {},
        collectionManager: {
            getNodeType(_nodeTypeId) {
                // Return a stub with no Python implementation dependencies
                return { implementations: { python: { value: '' } } };
            },
        },
        runtimeCollection: {
            getRuntime(runtimeId) {
                if (runtimeId !== 'general') return null;
                return {
                    id: 'general',
                    version: embedded ? '1.0.0' : null,
                    resolvedFilesystem: [],
                    nodePackages: packages.map((p) => ({
                        id: p.id,
                        mpAssets: p.mpAssets || {},
                    })),
                    nodePackagesGlobal: globalPackageIds,
                };
            },
        },
        transpiler: {},
    });
}

/**
 * Build a minimal collection using the given node type IDs.
 * @param {string[]} nodeTypeIds - Node type IDs the fake collection should expose
 */
function makeCollection(nodeTypeIds = ['servo.output']) {
    return {
        getDeviceRuntimeId() {
            return 'general';
        },
        getGraphArray() {
            return [
                {
                    getNodes() {
                        return nodeTypeIds.map((t, i) => ({ id: `node-${i}`, type: t }));
                    },
                },
            ];
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_prepareNodeLibrariesUpload — safety-net file check (phase 4.5 step 4)', () => {
    describe('no packages used in collection', () => {
        it('resolves with zero libraries when no mpAssets are referenced', async () => {
            const deployment = makeDeployment({
                globalPackageIds: ['servo'],
                packages: [],
                inventory: null,
                embedded: true,
            });
            // Collection uses 'servo.output' but runtime has no packages → nothing to check
            const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {});
            assert.equal(count, 0);
        });
    });

    describe('globally-bundled file checks (embedded mode)', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';

        function makeEmbeddedWithPackage(inventory) {
            return makeDeployment({
                globalPackageIds: [pkgId],
                packages: [
                    {
                        id: pkgId,
                        mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                    },
                ],
                inventory,
                embedded: true,
            });
        }

        it('does not throw when globally-bundled file is present in firmware inventory', async () => {
            const deployment = makeEmbeddedWithPackage({
                files: [
                    {
                        path: libPath,
                        packageId: pkgId,
                        packageVersion: '1.0.0',
                        fileKind: 'py',
                        source: 'embedded',
                    },
                ],
            });

            // The fetch mock is needed only for the upload loop; the safety-net check
            // passes before any fetch occurs when the file is found in inventory.
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (_url) => ({
                ok: true,
                statusText: 'OK',
                text: async () => '# servo\n',
                arrayBuffer: async () => new ArrayBuffer(0),
            });

            try {
                // A firmware-bundled package without versions is shadowed, so the consent gate
                // must have approved its complete asset set.
                const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {
                    embeddedLibraryOverridePaths: [libPath],
                });
                assert.equal(count, 1, 'Expected 1 library file (the servo.py)');
            } finally {
                if (originalFetch === undefined) delete globalThis.fetch;
                else globalThis.fetch = originalFetch;
            }
        });

        it('does not throw when the firmware inventory reports the precompiled .mpy alias', async () => {
            const deployment = makeEmbeddedWithPackage({
                files: [
                    {
                        path: libPath.replace(/\.py$/, '.mpy'),
                        packageId: pkgId,
                        packageVersion: '1.0.0',
                        fileKind: 'mpy',
                        source: 'embedded',
                    },
                ],
            });

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (_url) => ({
                ok: true,
                statusText: 'OK',
                text: async () => '# servo\n',
                arrayBuffer: async () => new ArrayBuffer(0),
            });

            try {
                const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {
                    embeddedLibraryOverridePaths: [libPath],
                });
                assert.equal(count, 1, 'Expected the firmware-provided .mpy to satisfy the .py path');
            } finally {
                if (originalFetch === undefined) delete globalThis.fetch;
                else globalThis.fetch = originalFetch;
            }
        });

        it('shadows instead of blocking when globally-bundled file is absent from firmware inventory', async () => {
            const deployment = makeEmbeddedWithPackage({ files: [] }); // file absent

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                statusText: 'OK',
                text: async () => '# servo\n',
                arrayBuffer: async () => new ArrayBuffer(0),
            });

            try {
                // The package is shadowed as a whole (source upload), not hard-blocked — and an
                // approved whole-package shadow is what authorises the upload.
                const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {
                    embeddedLibraryOverridePaths: [libPath],
                });
                assert.equal(count, 1);
            } finally {
                if (originalFetch === undefined) delete globalThis.fetch;
                else globalThis.fetch = originalFetch;
            }
        });

        it('does not throw when embeddedInventory is null (cannot verify)', async () => {
            const deployment = makeEmbeddedWithPackage(null); // null → cannot verify

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                statusText: 'OK',
                text: async () => '# servo\n',
                arrayBuffer: async () => new ArrayBuffer(0),
            });

            try {
                await assert.doesNotReject(() =>
                    deployment._prepareNodeLibrariesUpload(makeCollection(), {
                        embeddedLibraryOverridePaths: [libPath],
                    })
                );
            } finally {
                if (originalFetch === undefined) delete globalThis.fetch;
                else globalThis.fetch = originalFetch;
            }
        });
    });

    describe('non-globally-bundled file checks (embedded mode)', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';

        it('does not throw when non-globally-bundled mpAssets file is present on host', async () => {
            // servo is NOT globally bundled → file must come from host
            // _findLibraryUrl will find it in nodePackages.mpAssets → success
            const deployment = makeDeployment({
                globalPackageIds: [], // servo not globally bundled
                packages: [
                    {
                        id: pkgId,
                        mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                    },
                ],
                inventory: null,
                embedded: true,
            });

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                statusText: 'OK',
                text: async () => '# servo\n',
                arrayBuffer: async () => new ArrayBuffer(0),
            });

            try {
                const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {});
                assert.equal(count, 1);
            } finally {
                if (originalFetch === undefined) delete globalThis.fetch;
                else globalThis.fetch = originalFetch;
            }
        });
    });

    describe('dynamic mode file checks', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';

        it('does not throw in dynamic mode when mpAssets file is present on host', async () => {
            const deployment = makeDeployment({
                globalPackageIds: [pkgId], // globally-bundled in config, but irrelevant in dynamic mode
                packages: [
                    {
                        id: pkgId,
                        mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                    },
                ],
                inventory: null,
                embedded: false, // dynamic mode
            });

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                statusText: 'OK',
                text: async () => '# servo\n',
                arrayBuffer: async () => new ArrayBuffer(0),
            });

            try {
                const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {});
                assert.equal(count, 1);
            } finally {
                if (originalFetch === undefined) delete globalThis.fetch;
                else globalThis.fetch = originalFetch;
            }
        });
    });

    describe('error message format', () => {
        it('shadows all missing files instead of blocking when the host can supply them', async () => {
            const pkgId = 'servo';
            const libPaths = ['libs/servo/a.py', 'libs/servo/b.py'];

            const deployment = makeDeployment({
                globalPackageIds: [pkgId],
                packages: [
                    {
                        id: pkgId,
                        mpAssets: {
                            '*': libPaths.map((lp) => makeAssetUrl(pkgId, lp)),
                        },
                    },
                ],
                inventory: { files: [] }, // both absent
                embedded: true,
            });

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                statusText: 'OK',
                text: async () => '# servo\n',
                arrayBuffer: async () => new ArrayBuffer(0),
            });

            try {
                const count = await deployment._prepareNodeLibrariesUpload(makeCollection(), {
                    embeddedLibraryOverridePaths: libPaths,
                });
                assert.equal(count, 2);
            } finally {
                if (originalFetch === undefined) delete globalThis.fetch;
                else globalThis.fetch = originalFetch;
            }
        });
    });
});

// ---------------------------------------------------------------------------
// Whole-package completion of embedded overrides and override-aware safety net.
// ---------------------------------------------------------------------------

describe('_prepareNodeLibrariesUpload — embedded override package completion', () => {
    const pkgId = 'vars';
    const usedPath = 'otter_vars/array.py';
    const storePath = 'otter_vars/store.py';
    const initPath = 'otter_vars/__init__.py';

    /**
     * Build a deployment whose `vars` package declares one used and two unused files.
     * @param {object|null} [inventory] - embeddedInventory passed to the device state
     * @returns {CollectionDeployment} Deployment under test
     */
    function makeVarsDeployment(inventory = { files: [] }) {
        return makeDeployment({
            globalPackageIds: [pkgId],
            packages: [
                {
                    id: pkgId,
                    mpAssets: {
                        '*': [makeAssetUrl(pkgId, storePath), makeAssetUrl(pkgId, initPath)],
                        'array-generate': [makeAssetUrl(pkgId, usedPath)],
                    },
                },
            ],
            inventory,
            embedded: true,
        });
    }

    /**
     * Replace the scoped logger with a capturing stub.
     * @returns {{logs: Array<object>, restore: () => void}} Captured log entries and restore hook
     */
    function captureLogs() {
        const logs = [];
        const original = globalThis.__microOtterLog;
        globalThis.__microOtterLog = {
            log(scope, reason, level, ...data) {
                logs.push({ scope, reason, level, data });
            },
        };
        return {
            logs,
            restore() {
                if (original === undefined) {
                    delete globalThis.__microOtterLog;
                } else {
                    globalThis.__microOtterLog = original;
                }
            },
        };
    }

    function installFetch() {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            statusText: 'OK',
            text: async () => '# vars\n',
            arrayBuffer: async () => new ArrayBuffer(0),
        });
        return () => {
            if (originalFetch === undefined) delete globalThis.fetch;
            else globalThis.fetch = originalFetch;
        };
    }

    it('refuses a partial override instead of silently keeping the firmware copy', async () => {
        const deployment = makeVarsDeployment();
        const restoreFetch = installFetch();
        const captured = captureLogs();

        try {
            await assert.rejects(
                () =>
                    deployment._prepareNodeLibrariesUpload(
                        makeCollection(['vars.array-generate']),
                        { embeddedLibraryOverridePaths: [usedPath] }
                    ),
                (error) => {
                    assert.equal(error.name, 'EmbeddedOverrideApprovalRequiredError');
                    assert.deepEqual(error.packageIds, ['vars']);
                    assert.deepEqual(error.missingPaths, [initPath, storePath]);
                    return true;
                }
            );

            assert.deepEqual(
                deployment._preparedFiles.libraries,
                [],
                'nothing may be prepared before the gate has approved the whole package'
            );
            const expanded = captured.logs
                .filter((entry) => entry.reason === 'collection-library-override-package-expanded')
                .map((entry) => entry.data[0].path)
                .sort();
            assert.deepEqual(expanded, [initPath, storePath], 'the gap stays observable in the log');
        } finally {
            captured.restore();
            restoreFetch();
        }
    });

    it('does not expand when the override list already covers the package', async () => {
        const deployment = makeVarsDeployment();
        const restoreFetch = installFetch();
        const captured = captureLogs();

        try {
            const count = await deployment._prepareNodeLibrariesUpload(
                makeCollection(['vars.array-generate']),
                { embeddedLibraryOverridePaths: [initPath, storePath, usedPath] }
            );

            assert.equal(count, 3);
            assert.equal(
                captured.logs.filter(
                    (entry) => entry.reason === 'collection-library-override-package-expanded'
                ).length,
                0
            );
        } finally {
            captured.restore();
            restoreFetch();
        }
    });

    it('accepts an override path that is absent from embeddedInventory', async () => {
        // The firmware inventory knows nothing about the newer package files: an override must
        // still be deployable because the host supplies those files.
        const deployment = makeVarsDeployment({ files: [] });
        const restoreFetch = installFetch();

        try {
            const count = await deployment._prepareNodeLibrariesUpload(
                makeCollection(['vars.array-generate']),
                { embeddedLibraryOverridePaths: [initPath, storePath, usedPath] }
            );
            assert.equal(count, 3);
        } finally {
            restoreFetch();
        }
    });

    it('blocks an override path that the host cannot supply', async () => {
        const deployment = makeVarsDeployment();
        const restoreFetch = installFetch();

        try {
            await assert.rejects(
                () =>
                    deployment._prepareNodeLibrariesUpload(makeCollection(['vars.array-generate']), {
                        embeddedLibraryOverridePaths: [
                            initPath,
                            storePath,
                            usedPath,
                            'otter_vars/missing.py',
                        ],
                    }),
                (err) => {
                    assert.ok(err instanceof Error);
                    assert.ok(err.message.includes('Deployment blocked'));
                    assert.ok(err.message.includes('otter_vars/missing.py'));
                    return true;
                }
            );
        } finally {
            restoreFetch();
        }
    });
});

