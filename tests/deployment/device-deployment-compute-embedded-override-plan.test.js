// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';

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

class MockDeviceConnection extends EventTarget {
    isConnected() {
        return false;
    }
    getState() {
        return 'disconnected';
    }
    getDeviceInfoData() {
        return null;
    }
    async readTextFile() {
        throw new Error('ENOENT');
    }
    async writeTextFile() {}
}

class MockCollectionManager {
    getNodeType() {
        return null;
    }
}

class MockTranspiler {
    transpile() {
        return { code: '' };
    }
}

class MockI18nService {
    t(key) {
        return key;
    }
}

class MockViewManager {
    async showFormDialog() {
        return { confirmed: false };
    }
}

function makeRuntime({ globalPackageIds = [], packages = [] } = {}) {
    return {
        getNodeType() {
            return null;
        },
        nodePackagesGlobal: globalPackageIds,
        nodePackages: packages.map((p) => ({
            id: p.id,
            manifest: { version: p.version || null },
            mpAssets: p.mpAssets || {},
            requiredPackages: p.requiredPackages,
        })),
    };
}

function makeDeployment({ runtime = null, stateOverrides = {} } = {}) {
    const deployment = new DeviceDeployment({
        deviceConnection: new MockDeviceConnection(),
        collectionManager: new MockCollectionManager(),
        runtimeCollection: {
            getRuntime: () => runtime,
        },
        transpiler: new MockTranspiler(),
        i18nService: new MockI18nService(),
        viewManager: new MockViewManager(),
    });
    if (Object.keys(stateOverrides).length) {
        deployment._updateDeviceState(stateOverrides);
    }
    return deployment;
}

function makeCollection(nodeTypeIds = ['webview.panel']) {
    return {
        getDeviceRuntimeId() {
            return 'general';
        },
        getId() {
            return 'col-1';
        },
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

const webviewMpAssets = {
    '*': [
        '/device/node_pkgs/webview/otter_webview/__init__.py',
        '/device/node_pkgs/webview/otter_webview/panel.py',
    ],
};
const coreMpAssets = {
    '*': ['/device/node_pkgs/core/otter_core/__init__.py'],
};
const varsMpAssets = {
    '*': ['/device/node_pkgs/vars/otter_vars/store.py'],
};

/**
 * Return the override paths of the embedded preflight plan.
 *
 * Keeps the historical assertions readable: `null` still means "no runtime resolves", and an
 * empty array still means "nothing has to be shadowed".
 * @param {DeviceDeployment} deployment - Deployment under test
 * @param {object} collection - Collection mock
 * @returns {string[]|null} Planned override paths, or null when no runtime resolves
 */
function overridePaths(deployment, collection) {
    return deployment._computeEmbeddedOverridePlan(collection)?.overridePaths ?? null;
}

describe('_computeEmbeddedOverridePlan', () => {
    it('returns empty array when not in embedded mode', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview'],
            packages: [{ id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets }],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: false,
                runtimeDeploymentMode: 'dynamic',
                embeddedPackagesSummary: {
                    totalPackages: 1,
                    totalFiles: 0,
                    totalBytes: 0,
                    packages: [{ name: 'webview', version: '1.3.1' }],
                },
            },
        });

        const result = overridePaths(deployment, makeCollection(['webview.panel']));
        assert.deepEqual(result, []);
    });

    it('returns null when runtime is not found', () => {
        const deployment = makeDeployment({
            runtime: null,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
            },
        });

        const result = overridePaths(deployment, makeCollection());
        assert.equal(result, null);
    });

    it('shadows every in-use firmware package when no package version source is readable', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview'],
            packages: [{ id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets }],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: null,
                firmwareConstituentVersions: null,
            },
        });

        const result = overridePaths(deployment,
            makeCollection(['webview.panel'])
        );
        assert.deepEqual(result, ['otter_webview/__init__.py', 'otter_webview/panel.py']);
    });

    it('shadows nothing without a version source when no firmware package is in use', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview'],
            packages: [{ id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets }],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: null,
                firmwareConstituentVersions: null,
            },
        });

        const result = overridePaths(deployment, makeCollection(['math.add']));
        assert.deepEqual(result, []);
    });

    it('reports the sentinel device version when the host package has no version either', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview'],
            packages: [{ id: 'webview', mpAssets: webviewMpAssets }],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: null,
                firmwareConstituentVersions: null,
            },
        });

        const plan = deployment._resolveOutdatedEmbeddedPackages(
            makeCollection(['webview.panel']),
            runtime
        );

        assert.deepEqual(plan.outdated, [
            {
                packageId: 'webview',
                deviceVersion: 'unknown',
                hostVersion: 'unknown',
                reason: 'firmware-unknown',
            },
        ]);
    });

    it('returns empty array when no package is globally bundled', () => {
        const runtime = makeRuntime({
            globalPackageIds: [],
            packages: [{ id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets }],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: null,
                firmwareConstituentVersions: null,
            },
        });

        const result = overridePaths(deployment, makeCollection(['webview.panel']));
        assert.deepEqual(result, []);
    });

    it('returns empty array when all globally-bundled packages are up-to-date', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview', 'core'],
            packages: [
                { id: 'webview', version: '1.3.1', mpAssets: webviewMpAssets },
                { id: 'core', version: '1.0.0', mpAssets: coreMpAssets },
            ],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: {
                    totalPackages: 2,
                    totalFiles: 0,
                    totalBytes: 0,
                    packages: [
                        { name: 'webview', version: '1.3.1' }, // same version
                        { name: 'core', version: '1.0.0' }, // same version
                    ],
                },
            },
        });

        const result = overridePaths(deployment,
            makeCollection(['webview.panel', 'core.node'])
        );
        assert.deepEqual(result, []);
    });

    it('returns paths only for the outdated package, not the up-to-date one', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview', 'core'],
            packages: [
                { id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets }, // host is newer
                { id: 'core', version: '1.0.0', mpAssets: coreMpAssets }, // same version
            ],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: {
                    totalPackages: 2,
                    totalFiles: 0,
                    totalBytes: 0,
                    packages: [
                        { name: 'webview', version: '1.3.1' }, // firmware is older
                        { name: 'core', version: '1.0.0' }, // same version
                    ],
                },
            },
        });

        const result = overridePaths(deployment,
            makeCollection(['webview.panel', 'core.node'])
        );

        assert.ok(Array.isArray(result), 'should return an array');
        // webview paths should be included
        assert.ok(result.includes('otter_webview/__init__.py'), 'should include webview init');
        assert.ok(result.includes('otter_webview/panel.py'), 'should include webview panel');
        // core paths should NOT be included
        assert.ok(!result.includes('otter_core/__init__.py'), 'should not include core files');
    });

    it('uses firmwareConstituentVersions as fallback when embeddedPackagesSummary is null', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview'],
            packages: [{ id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets }],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: null,
                firmwareConstituentVersions: {
                    micropythonVersion: null,
                    runtimeSourceVersion: null,
                    runtimeFirmwareVersion: null,
                    deviceToolsVersion: null,
                    nodePackages: { webview: '1.3.1' }, // outdated
                },
            },
        });

        const result = overridePaths(deployment, makeCollection(['webview.panel']));

        assert.ok(Array.isArray(result));
        assert.ok(result.includes('otter_webview/__init__.py'));
    });

    it('does not include paths for packages not used by the collection', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['webview', 'unused'],
            packages: [
                { id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets },
                {
                    id: 'unused',
                    version: '2.0.0',
                    mpAssets: { '*': ['/device/node_pkgs/unused/otter_unused/__init__.py'] },
                },
            ],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: {
                    totalPackages: 2,
                    totalFiles: 0,
                    totalBytes: 0,
                    packages: [
                        { name: 'webview', version: '1.3.1' },
                        { name: 'unused', version: '1.0.0' }, // outdated, but not used
                    ],
                },
            },
        });

        // Collection only uses webview, not unused
        const result = overridePaths(deployment, makeCollection(['webview.panel']));

        assert.ok(Array.isArray(result));
        assert.ok(
            !result.includes('otter_unused/__init__.py'),
            'unused package must not be in result'
        );
    });

    it('includes override paths for required packages of an in-use package', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['vars'],
            packages: [
                {
                    id: 'webview',
                    version: '1.27.0',
                    requiredPackages: ['vars'],
                    mpAssets: webviewMpAssets,
                },
                { id: 'vars', version: '0.16.0', mpAssets: varsMpAssets },
            ],
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: {
                    totalPackages: 2,
                    totalFiles: 0,
                    totalBytes: 0,
                    packages: [
                        { name: 'webview', version: '1.27.0' },
                        { name: 'vars', version: '0.15.0' }, // firmware is older
                    ],
                },
            },
        });

        const result = overridePaths(deployment, makeCollection(['webview.panel']));

        assert.ok(Array.isArray(result));
        assert.ok(result.includes('otter_vars/store.py'), 'should include required package files');
    });
});

// ---------------------------------------------------------------------------
// Whole-package expansion: an override always ships the complete package,
// because MicroPython resolves submodules only inside the winning `__path__`.
// ---------------------------------------------------------------------------

describe('_computeEmbeddedOverridePlan — whole package expansion', () => {
    /**
     * Build an embedded deployment for the given host packages and firmware versions.
     * @param {object} opts - Package and version configuration
     * @param {string[]} [opts.globalPackageIds] - Globally-bundled package ids
     * @param {Array<{id: string, version: string, mpAssets?: object}>} [opts.packages] - Host packages
     * @param {Array<{name: string, version: string}>} [opts.devicePackages] - Firmware packages
     * @returns {DeviceDeployment} Deployment with the embedded device state applied
     */
    function makeEmbeddedDeployment({
        globalPackageIds = ['vars'],
        packages = [],
        devicePackages = [{ name: 'vars', version: '0.19.0' }],
    } = {}) {
        const runtime = makeRuntime({ globalPackageIds, packages });
        return makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: {
                    totalPackages: devicePackages.length,
                    totalFiles: 0,
                    totalBytes: 0,
                    packages: devicePackages,
                },
            },
        });
    }

    it('uploads every file of an outdated package, not only the asset keys in use', () => {
        const deployment = makeEmbeddedDeployment({
            packages: [
                {
                    id: 'vars',
                    version: '0.20.0',
                    mpAssets: {
                        '*': [
                            '/device/node_pkgs/vars/otter_vars/__init__.py',
                            '/device/node_pkgs/vars/otter_vars/store.py',
                            '/device/node_pkgs/vars/otter_vars/types.py',
                        ],
                        'array-generate': ['/device/node_pkgs/vars/otter_vars/array.py'],
                    },
                },
            ],
        });

        const result = overridePaths(deployment,
            makeCollection(['vars.array-generate'])
        );

        assert.deepEqual(result, [
            'otter_vars/__init__.py',
            'otter_vars/array.py',
            'otter_vars/store.py',
            'otter_vars/types.py',
        ]);
    });

    it('includes package files whose mpAssets are only keyed per node type', () => {
        const deployment = makeEmbeddedDeployment({
            packages: [
                {
                    id: 'vars',
                    version: '0.20.0',
                    mpAssets: {
                        '*': [],
                        'array-modify': ['/device/node_pkgs/vars/otter_vars/array.py'],
                    },
                },
            ],
        });

        const result = overridePaths(deployment, makeCollection(['vars.array-generate']));

        assert.deepEqual(result, ['otter_vars/array.py']);
    });

    it('unions and sorts the files of multiple outdated packages', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['vars', 'webview'],
            packages: [
                {
                    id: 'webview',
                    version: '1.28.0',
                    mpAssets: {
                        '*': [
                            '/device/node_pkgs/webview/otter_webview/panel.py',
                            '/device/node_pkgs/webview/otter_webview/__init__.py',
                        ],
                    },
                },
                {
                    id: 'vars',
                    version: '0.20.0',
                    mpAssets: {
                        '*': [
                            '/device/node_pkgs/vars/otter_vars/store.py',
                            '/device/node_pkgs/webview/otter_webview/__init__.py',
                        ],
                    },
                },
            ],
            devicePackages: [
                { name: 'webview', version: '1.27.0' },
                { name: 'vars', version: '0.19.0' },
            ],
        });

        const result = overridePaths(deployment,
            makeCollection(['webview.panel', 'vars.array-generate'])
        );

        assert.deepEqual(result, [
            'otter_vars/store.py',
            'otter_webview/__init__.py',
            'otter_webview/panel.py',
        ]);
    });

    it('ignores asset urls that resolve to no device path', () => {
        const deployment = makeEmbeddedDeployment({
            packages: [
                {
                    id: 'vars',
                    version: '0.20.0',
                    mpAssets: {
                        '*': [
                            '/other/place/not_a_library.py',
                            '/device/node_pkgs/vars/otter_vars/store.py',
                        ],
                    },
                },
            ],
        });

        const result = overridePaths(deployment,
            makeCollection(['vars.array-generate'])
        );

        assert.deepEqual(result, ['otter_vars/store.py']);
    });
});


// ---------------------------------------------------------------------------
// One runtime: the preflight resolves a single runtime, reports where that runtime
// id came from, and the compatibility warnings read the same plan.
// ---------------------------------------------------------------------------

describe('_computeEmbeddedOverridePlan — runtime resolution', () => {
    /**
     * Capture DeviceDeployment log entries while a test runs.
     * @returns {{entries: Array<object>, restore: () => void}} Captured entries and restore hook
     */
    function captureLogs() {
        const entries = [];
        const original = globalThis.__microOtterLog;
        globalThis.__microOtterLog = {
            log(scope, reason, level, ...data) {
                entries.push({ scope, reason, level, data });
            },
        };
        return {
            entries,
            restore() {
                if (original === undefined) {
                    delete globalThis.__microOtterLog;
                } else {
                    globalThis.__microOtterLog = original;
                }
            },
        };
    }

    /**
     * Build an embedded deployment whose runtime collection only knows some runtime ids.
     * @param {object} [opts] - Deployment options
     * @param {string[]} [opts.knownRuntimeIds] - Runtime ids the fake collection can answer
     * @param {object} [opts.stateOverrides] - Device-state fields to override
     * @returns {DeviceDeployment} Deployment under test
     */
    function makeResolutionDeployment({ knownRuntimeIds = ['general'], stateOverrides = {} } = {}) {
        const runtime = makeRuntime({
            globalPackageIds: ['webview'],
            packages: [{ id: 'webview', version: '1.4.1', mpAssets: webviewMpAssets }],
        });
        const deployment = new DeviceDeployment({
            deviceConnection: new MockDeviceConnection(),
            collectionManager: new MockCollectionManager(),
            runtimeCollection: {
                getRuntime: (runtimeId) =>
                    knownRuntimeIds.includes(runtimeId) ? runtime : null,
            },
            transpiler: new MockTranspiler(),
            i18nService: new MockI18nService(),
            viewManager: new MockViewManager(),
        });
        deployment._updateDeviceState({
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            embeddedPackagesSummary: {
                totalPackages: 1,
                totalFiles: 2,
                totalBytes: 0,
                packages: [{ name: 'webview', version: '1.3.1' }],
            },
            ...stateOverrides,
        });
        return deployment;
    }

    it('reports the device state as the runtime source when it resolves', () => {
        const deployment = makeResolutionDeployment({
            stateOverrides: { runtimeId: 'general' },
        });
        const captured = captureLogs();

        try {
            const preflight = deployment._computeEmbeddedOverridePlan(
                makeCollection(['webview.panel'])
            );

            assert.equal(preflight.runtimeId, 'general');
            assert.equal(preflight.runtimeIdSource, 'device-state');

            const log = captured.entries.find(
                (entry) => entry.reason === 'collection-embedded-override-preflight'
            );
            assert.ok(log, 'the preflight must be logged');
            const payload = log.data[0];
            assert.equal(payload.runtimeId, 'general');
            assert.equal(payload.runtimeIdSource, 'device-state');
            assert.equal(payload.collectionRuntimeId, 'general');
            assert.equal(payload.runtimeEmbedded, true);
            assert.equal(payload.fileCount, 2);
            assert.deepEqual(payload.packages, [
                {
                    packageId: 'webview',
                    reason: 'firmware-outdated',
                    deviceVersion: '1.3.1',
                    hostVersion: '1.4.1',
                },
            ]);
        } finally {
            captured.restore();
        }
    });

    it('falls back to the collection runtime and says so when the device id is unknown', () => {
        const deployment = makeResolutionDeployment({ stateOverrides: { runtimeId: null } });

        const preflight = deployment._computeEmbeddedOverridePlan(
            makeCollection(['webview.panel'])
        );

        assert.equal(preflight.runtimeId, 'general');
        assert.equal(preflight.runtimeIdSource, 'collection');
        assert.deepEqual(preflight.overridePaths, [
            'otter_webview/__init__.py',
            'otter_webview/panel.py',
        ]);
    });

    it('falls back when the device reports a runtime the workspace does not know', () => {
        const deployment = makeResolutionDeployment({
            stateOverrides: { runtimeId: 'board-only-runtime' },
        });

        const preflight = deployment._computeEmbeddedOverridePlan(
            makeCollection(['webview.panel'])
        );

        assert.equal(preflight.runtimeId, 'general');
        assert.equal(preflight.runtimeIdSource, 'collection');
    });

    it('returns null and logs the failure when no runtime resolves', () => {
        const deployment = makeResolutionDeployment({
            knownRuntimeIds: [],
            stateOverrides: { runtimeId: 'board-only-runtime' },
        });
        const captured = captureLogs();

        try {
            const preflight = deployment._computeEmbeddedOverridePlan(makeCollection());

            assert.equal(preflight, null);
            const log = captured.entries.find(
                (entry) => entry.reason === 'collection-embedded-override-preflight'
            );
            assert.ok(log, 'even an unresolved preflight must be observable');
            assert.equal(log.data[0].resolved, false);
            assert.equal(log.data[0].runtimeId, null);
            assert.equal(log.data[0].collectionRuntimeId, 'general');
            assert.equal(log.data[0].runtimeEmbedded, true);
        } finally {
            captured.restore();
        }
    });
});
