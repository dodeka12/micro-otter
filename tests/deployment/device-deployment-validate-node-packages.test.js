// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

// ---------------------------------------------------------------------------
// window mock for URL parsing in collection-deployment helpers
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
// Minimal mocks
// ---------------------------------------------------------------------------

class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this._state = 'disconnected';
    }

    isConnected() {
        return this._state === 'connected';
    }

    getState() {
        return this._state;
    }

    connect() {
        this._state = 'connected';
        this.dispatchEvent(
            new CustomEvent('statechange', {
                detail: { state: 'connected', previousState: 'disconnected' },
            })
        );
    }

    getDeviceInfoData() {
        return null;
    }

    async loadDeviceInfo() {
        return DeviceState.fromDeviceInfo({});
    }

    async executeCode() {
        return '';
    }

    async readTextFile() {
        throw new Error('ENOENT');
    }

    async writeTextFile() {}

    async ensureDirectory() {}

    async deleteFile() {}

    async softReset() {}

    async hardReset() {}
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
    t(key, params = {}) {
        // Return a string encoding key + params for easy assertion
        const paramStr = Object.keys(params).length
            ? ':' +
              Object.entries(params)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(',')
            : '';
        return key + paramStr;
    }
}

class MockViewManager {
    async showFormDialog() {
        return { confirmed: false };
    }
}

class MockRuntimeCollection {
    constructor(runtime = null) {
        this._runtime = runtime;
    }

    getRuntime() {
        return this._runtime;
    }
}

// ---------------------------------------------------------------------------
// Collection helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal collection mock using the given node type IDs.
 * @param {string[]} [nodeTypeIds] - Node type IDs returned by the fake graph
 * @param {string} [runtimeId] - Device runtime ID the fake collection reports
 */
function makeCollection(nodeTypeIds = ['servo.output'], runtimeId = 'general') {
    return {
        getDeviceRuntimeId() {
            return runtimeId;
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

/**
 * Build a minimal runtime mock.
 * @param {object} opts - Runtime mock options
 * @param {string[]} [opts.globalPackageIds] - Globally-bundled package IDs
 * @param {Array<{id, version, mpAssets}>} [opts.packages] - Host node packages
 * @param {boolean} [opts.allNodeTypesFound] - Whether getNodeType returns something
 */
function makeRuntime({ globalPackageIds = [], packages = [], allNodeTypesFound = true } = {}) {
    return {
        getNodeType(nodeTypeId) {
            return allNodeTypesFound ? { id: nodeTypeId } : null;
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

/**
 * Build a DeviceDeployment instance with the given options.
 * @param {object} [opts] - Deployment-mock options
 * @param {object|null} [opts.runtime] - Runtime mock handed to the fake runtime collection
 * @param {object} [opts.stateOverrides] - Device-state fields to override
 */
function makeDeployment({ runtime = null, stateOverrides = {} } = {}) {
    const mockConnection = new MockDeviceConnection();
    const mockI18n = new MockI18nService();
    const runtimeCollection = new MockRuntimeCollection(runtime);

    const deployment = new DeviceDeployment({
        deviceConnection: mockConnection,
        collectionManager: new MockCollectionManager(),
        runtimeCollection,
        transpiler: new MockTranspiler(),
        i18nService: mockI18n,
        viewManager: new MockViewManager(),
    });

    if (Object.keys(stateOverrides).length) {
        deployment._updateDeviceState(stateOverrides);
    }

    return deployment;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateNodePackages — return type', () => {
    it('returns { compatible, errors, warnings, shadowPackages } with arrays', () => {
        const runtime = makeRuntime({ allNodeTypesFound: true });
        const deployment = makeDeployment({ runtime });
        const result = deployment.validateNodePackages(makeCollection());

        assert.ok('compatible' in result);
        assert.ok(Array.isArray(result.errors));
        assert.ok(Array.isArray(result.warnings));
        assert.ok(
            Array.isArray(result.shadowPackages),
            'shadowPackages must always be an array so callers can gate on its length'
        );
        assert.equal(result.shadowPackages.length, 0);
    });

    it('compatible is true when no errors and no warnings', () => {
        const runtime = makeRuntime({ allNodeTypesFound: true });
        const deployment = makeDeployment({ runtime });
        const result = deployment.validateNodePackages(makeCollection());

        assert.equal(result.compatible, true);
        assert.equal(result.errors.length, 0);
    });

    it('returns warnings array empty when no warnings', () => {
        const runtime = makeRuntime({ allNodeTypesFound: true });
        const deployment = makeDeployment({ runtime });
        const result = deployment.validateNodePackages(makeCollection());

        assert.equal(result.warnings.length, 0);
    });

    it('node type not found still returns warnings array', () => {
        const runtime = makeRuntime({ allNodeTypesFound: false });
        const deployment = makeDeployment({ runtime });
        const result = deployment.validateNodePackages(makeCollection());

        assert.equal(result.compatible, false);
        assert.ok(result.errors.some((e) => e.includes('Node type not found')));
        assert.ok(Array.isArray(result.warnings));
    });
});

describe('validateNodePackages — function graph node types', () => {
    it('does not report function-graph-managed ids as missing node types', () => {
        const collection = makeCollection([
            'function_graph.graph-6',
            'graph.function.input',
            'graph.function.output',
        ]);
        const runtime = makeRuntime({ allNodeTypesFound: false });
        const deployment = makeDeployment({ runtime });

        const result = deployment.validateNodePackages(collection);

        assert.equal(result.compatible, true);
        assert.deepEqual(result.errors, []);
    });

    it('still reports a real unknown node type next to function-graph ids', () => {
        const collection = makeCollection([
            'function_graph.graph-6',
            'graph.function.input',
            'mystery.mystery-node',
        ]);
        const runtime = makeRuntime({ allNodeTypesFound: false });
        const deployment = makeDeployment({ runtime });

        const result = deployment.validateNodePackages(collection);

        assert.equal(result.compatible, false);
        assert.deepEqual(result.errors, ['Node type not found: mystery.mystery-node']);
    });
});

describe('validateNodePackages — version warnings (embedded mode)', () => {
    function makeEmbeddedDeployment({
        globalPackageIds,
        packages,
        devicePackages,
        firmwareVersions,
    }) {
        const runtime = makeRuntime({ globalPackageIds, packages, allNodeTypesFound: true });
        const stateOverrides = {
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            embeddedPackagesSummary: devicePackages
                ? {
                      totalPackages: devicePackages.length,
                      totalFiles: 0,
                      totalBytes: 0,
                      packages: devicePackages.map((p) => ({ name: p.id, version: p.version })),
                  }
                : null,
            firmwareConstituentVersions: firmwareVersions
                ? {
                      micropythonVersion: null,
                      runtimeSourceVersion: null,
                      runtimeFirmwareVersion: null,
                      deviceToolsVersion: null,
                      nodePackages: firmwareVersions,
                  }
                : null,
        };
        return makeDeployment({ runtime, stateOverrides });
    }

    it('no warning when device version equals host version', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.0' }],
            devicePackages: [{ id: 'servo', version: '1.0.0' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 0);
        assert.equal(result.compatible, true);
        assert.equal(
            result.shadowPackages.length,
            0,
            'a current firmware package must not be listed for shadowing'
        );
    });

    it('lists the outdated package in shadowPackages with its reason', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.1' }],
            devicePackages: [{ id: 'servo', version: '1.0.0' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.deepEqual(
            result.shadowPackages.map((entry) => entry.packageId),
            ['servo']
        );
        assert.equal(result.shadowPackages[0].reason, 'firmware-outdated');
        assert.equal(result.warnings.length, result.shadowPackages.length);
    });

    it('warning when device patch version is older than host (1.0.0 → 1.0.1)', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.1' }],
            devicePackages: [{ id: 'servo', version: '1.0.0' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('deployment.packageVersionOutdated'));
        assert.ok(result.warnings[0].includes('servo'));
        assert.equal(result.compatible, true, 'version warning should not affect compatibility');
    });

    it('warning when device minor version is older than host (1.0.0 → 1.1.0)', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.1.0' }],
            devicePackages: [{ id: 'servo', version: '1.0.0' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 1);
    });

    it('warning when device major version is older than host (1.0.0 → 2.0.0)', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '2.0.0' }],
            devicePackages: [{ id: 'servo', version: '1.0.0' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 1);
    });

    it('no warning when device version is NEWER than host', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.0' }],
            devicePackages: [{ id: 'servo', version: '2.0.0' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 0);
    });

    it('warns with the unknown-version key when the device version is not strict semver', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.0' }],
            devicePackages: [{ id: 'servo', version: 'dev-build' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('deployment.packageVersionUnknown'));
    });

    it('warns with the unknown-version key when the host version is not strict semver', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: 'nightly' }],
            devicePackages: [{ id: 'servo', version: '1.0.0' }],
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('deployment.packageVersionUnknown'));
    });

    it('warns with the unknown-version key when no version source is readable', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.1' }],
            devicePackages: null,
            firmwareVersions: null,
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('deployment.packageVersionUnknown'));
        assert.ok(result.warnings[0].includes('servo'));
        assert.ok(!result.warnings[0].includes('deployment.packageVersionOutdated'));
    });

    it('uses firmwareConstituentVersions.nodePackages as fallback when embeddedPackagesSummary is null', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.1' }],
            devicePackages: null,
            firmwareVersions: { servo: '1.0.0' },
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('deployment.packageVersionOutdated'));
    });

    it('no warning in dynamic mode even when device version is older', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['servo'],
            packages: [{ id: 'servo', version: '1.0.1' }],
            allNodeTypesFound: true,
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeEmbedded: false,
                runtimeDeploymentMode: 'dynamic',
                embeddedPackagesSummary: {
                    totalPackages: 1,
                    totalFiles: 1,
                    totalBytes: 100,
                    packages: [{ name: 'servo', version: '1.0.0' }],
                },
            },
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.warnings.length, 0, 'dynamic mode: no version warnings');
    });

    it('no warning for package not used by collection', () => {
        const deployment = makeEmbeddedDeployment({
            globalPackageIds: ['servo', 'unused'],
            packages: [
                { id: 'servo', version: '1.0.1' },
                { id: 'unused', version: '2.0.0' },
            ],
            devicePackages: [
                { id: 'servo', version: '1.0.0' },
                { id: 'unused', version: '1.0.0' },
            ],
        });
        // Collection only uses servo, not unused
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        // Only servo gets a warning, unused does not
        assert.equal(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('servo'));
        assert.ok(!result.warnings.some((w) => w.includes('unused')));
    });
});

describe('validateNodePackages — file availability errors', () => {
    /**
     * Build URL for an mpAsset file in the test environment.
     * We use a simple path that matches what _extractLibraryPathFromUrl expects.
     * /device/node_pkgs/<pkgId>/libs/<file> → libs/<file>
     * @param {string} pkgId - Runtime node package ID
     * @param {string} libPath - Path of the library file inside the package
     * @returns {string} Asset URL used by the fetch mock
     */
    function makeAssetUrl(pkgId, libPath) {
        return `/device/node_pkgs/${pkgId}/${libPath}`;
    }

    function makeEmbeddedWithInventory({
        globalPackageIds = [],
        packages = [],
        inventory = null,
        allNodeTypesFound = true,
    } = {}) {
        const runtime = makeRuntime({ globalPackageIds, packages, allNodeTypesFound });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedInventory: inventory,
            },
        });
        // Override isLibraryAvailableOnHost to always return true by default in these tests
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;
        return deployment;
    }

    it('no error when globally-bundled file is present in firmware inventory', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const deployment = makeEmbeddedWithInventory({
            globalPackageIds: [pkgId],
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            inventory: {
                files: [
                    {
                        path: libPath,
                        packageId: pkgId,
                        packageVersion: '1.0.0',
                        fileKind: 'py',
                        source: 'embedded',
                    },
                ],
            },
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.errors.length, 0);
        assert.equal(result.compatible, true);
    });

    it('no error when the firmware inventory reports the precompiled .mpy alias', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const deployment = makeEmbeddedWithInventory({
            globalPackageIds: [pkgId],
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            inventory: {
                files: [
                    {
                        path: libPath.replace(/\.py$/, '.mpy'),
                        packageId: pkgId,
                        packageVersion: '1.0.0',
                        fileKind: 'mpy',
                        source: 'embedded',
                    },
                ],
            },
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.errors.length, 0);
        assert.equal(result.compatible, true);
    });

    it('warns instead of erroring when a globally-bundled file is absent from firmware inventory', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const deployment = makeEmbeddedWithInventory({
            globalPackageIds: [pkgId],
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            inventory: { files: [] }, // file absent
        });
        // Equal firmware + host versions with the file missing from the inventory ⇒ incomplete.
        deployment._updateDeviceState({
            embeddedPackagesSummary: {
                totalPackages: 1,
                totalFiles: 0,
                totalBytes: 0,
                packages: [{ name: pkgId, version: '1.0.0' }],
            },
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.compatible, true);
        assert.ok(
            result.warnings.some((e) => e.includes('deployment.packageIncomplete')),
            'Expected packageIncomplete warning'
        );
    });

    it('no error when globally-bundled file absent but embeddedInventory is null (cannot verify)', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const deployment = makeEmbeddedWithInventory({
            globalPackageIds: [pkgId],
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            inventory: null, // null → cannot verify
        });
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.errors.length, 0, 'null inventory should not block');
        assert.equal(result.compatible, true);
    });

    it('no error when non-globally-bundled file is available on host', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const runtime = makeRuntime({
            globalPackageIds: [], // servo is NOT globally bundled
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            allNodeTypesFound: true,
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: { runtimeEmbedded: true, runtimeDeploymentMode: 'embedded' },
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.errors.length, 0);
    });

    it('error when non-globally-bundled file is absent from host', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const runtime = makeRuntime({
            globalPackageIds: [], // servo is NOT globally bundled
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            allNodeTypesFound: true,
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: { runtimeEmbedded: true, runtimeDeploymentMode: 'embedded' },
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => false;
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.compatible, false);
        assert.ok(
            result.errors.some((e) => e.includes('deployment.packageFileMissingFromHost')),
            'Expected packageFileMissingFromHost error'
        );
    });

    it('dynamic mode: no error when all files available on host', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const runtime = makeRuntime({
            globalPackageIds: [pkgId], // globally bundled in dynamic makes no difference
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            allNodeTypesFound: true,
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: { runtimeEmbedded: false, runtimeDeploymentMode: 'dynamic' },
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.errors.length, 0);
        assert.equal(result.compatible, true);
    });

    it('dynamic mode: error when required file absent from host', () => {
        const pkgId = 'servo';
        const libPath = 'libs/otter_servo/servo.py';
        const runtime = makeRuntime({
            globalPackageIds: [pkgId],
            packages: [
                {
                    id: pkgId,
                    version: '1.0.0',
                    mpAssets: { '*': [makeAssetUrl(pkgId, libPath)] },
                },
            ],
            allNodeTypesFound: true,
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: { runtimeEmbedded: false, runtimeDeploymentMode: 'dynamic' },
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => false;
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.compatible, false);
        assert.ok(
            result.errors.some((e) => e.includes('deployment.packageFileMissingFromHost')),
            'Expected packageFileMissingFromHost error in dynamic mode'
        );
    });

    it('no error when collection uses no node types with mpAssets', () => {
        const runtime = makeRuntime({ allNodeTypesFound: true });
        const deployment = makeDeployment({ runtime });
        // No packages with mpAssets → no file checks
        const result = deployment.validateNodePackages(makeCollection(['servo.output']));
        assert.equal(result.errors.length, 0);
        assert.equal(result.compatible, true);
    });
});

describe('validateNodePackages — non-firmware RAM warning', () => {
    function makeNonFirmwareDeployment({
        globalPackageIds = [],
        packages = [],
        embedded = true,
    } = {}) {
        const runtime = makeRuntime({ globalPackageIds, packages, allNodeTypesFound: true });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeEmbedded: embedded,
                runtimeDeploymentMode: embedded ? 'embedded' : 'dynamic',
                embeddedInventory: { files: [] },
            },
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;
        return deployment;
    }

    function nonFirmwareWarnings(warnings) {
        return warnings.filter((w) => w.startsWith('deployment.packageNotInFirmware'));
    }

    it('warns once for an in-use package the firmware does not bundle', () => {
        const deployment = makeNonFirmwareDeployment({
            packages: [
                {
                    id: 'servo',
                    version: '1.0.0',
                    mpAssets: { '*': ['/device/node_pkgs/servo/libs/otter_servo/servo.py'] },
                },
            ],
        });

        const result = deployment.validateNodePackages(makeCollection(['servo.output']));

        const warnings = nonFirmwareWarnings(result.warnings);
        assert.equal(warnings.length, 1);
        assert.ok(warnings[0].includes('packageId=servo'));
        assert.equal(result.compatible, true, 'the RAM warning must never block the deploy');
    });

    it('warns only once for several nodes of the same non-firmware package', () => {
        const deployment = makeNonFirmwareDeployment({
            packages: [
                {
                    id: 'servo',
                    version: '1.0.0',
                    mpAssets: {
                        '*': [
                            '/device/node_pkgs/servo/libs/otter_servo/servo.py',
                            '/device/node_pkgs/servo/libs/otter_servo/pid.py',
                        ],
                    },
                },
            ],
        });

        const result = deployment.validateNodePackages(
            makeCollection(['servo.output', 'servo.pid', 'servo.input'])
        );

        assert.equal(nonFirmwareWarnings(result.warnings).length, 1);
    });

    it('does not warn for a package the firmware bundles', () => {
        const deployment = makeNonFirmwareDeployment({
            globalPackageIds: ['servo'],
            packages: [
                {
                    id: 'servo',
                    version: '1.0.0',
                    mpAssets: { '*': ['/device/node_pkgs/servo/libs/otter_servo/servo.py'] },
                },
            ],
        });

        const result = deployment.validateNodePackages(makeCollection(['servo.output']));

        assert.equal(nonFirmwareWarnings(result.warnings).length, 0);
    });

    it('does not warn in dynamic mode where source upload is the normal case', () => {
        const deployment = makeNonFirmwareDeployment({
            embedded: false,
            packages: [
                {
                    id: 'servo',
                    version: '1.0.0',
                    mpAssets: { '*': ['/device/node_pkgs/servo/libs/otter_servo/servo.py'] },
                },
            ],
        });

        const result = deployment.validateNodePackages(makeCollection(['servo.output']));

        assert.equal(nonFirmwareWarnings(result.warnings).length, 0);
    });
});

describe('validateNodePackages — audio package id derivation', () => {
    it('resolves audio.* node types without a not-found error', () => {
        const runtime = makeRuntime({ allNodeTypesFound: true });
        const deployment = makeDeployment({ runtime });
        const result = deployment.validateNodePackages(
            makeCollection(['audio.oscillator', 'audio.i2s-output'])
        );

        assert.equal(result.compatible, true);
        assert.equal(result.errors.length, 0);
    });

    it('warns against the audio package key in embedded mode', () => {
        const runtime = makeRuntime({
            globalPackageIds: ['audio'],
            packages: [{ id: 'audio', version: '0.36.0' }],
            allNodeTypesFound: true,
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: {
                    totalPackages: 1,
                    totalFiles: 0,
                    totalBytes: 0,
                    packages: [{ name: 'audio', version: '0.35.0' }],
                },
            },
        });

        const result = deployment.validateNodePackages(makeCollection(['audio.oscillator']));

        assert.equal(result.errors.length, 0);
        assert.equal(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('deployment.packageVersionOutdated'));
        assert.ok(result.warnings[0].includes('audio'));
    });
});

describe('validateNodePackages — requiredPackages expansion', () => {
    function makeWebviewRuntime({
        requiredPackages = ['vars'],
        globalPackageIds = [],
        webviewVersion = '1.27.0',
        varsVersion = '0.16.0',
    } = {}) {
        return makeRuntime({
            globalPackageIds,
            packages: [
                {
                    id: 'webview',
                    version: webviewVersion,
                    requiredPackages,
                    mpAssets: {
                        '*': ['/device/node_pkgs/webview/libs/webview/__init__.py'],
                    },
                },
                {
                    id: 'vars',
                    version: varsVersion,
                    mpAssets: { '*': ['/device/node_pkgs/vars/otter_vars/store.py'] },
                },
            ],
            allNodeTypesFound: true,
        });
    }

    function makeWebviewCollection() {
        return makeCollection(['webview.web-view-number-input']);
    }

    it('reports required package ids as used', () => {
        const runtime = makeWebviewRuntime();
        const deployment = makeDeployment({ runtime });

        const ids = deployment._collectUsedNodePackageIds(makeWebviewCollection(), runtime);

        assert.deepEqual([...ids].sort(), ['vars', 'webview']);
    });

    it('requests the wildcard asset set of required packages', () => {
        const runtime = makeWebviewRuntime();
        const deployment = makeDeployment({ runtime });

        const keys = deployment._collectUsedNodePackageAssetKeys(makeWebviewCollection(), runtime);

        assert.deepEqual([...(keys.get('vars') || [])], ['*']);
    });

    it('checks required package assets during dynamic validation', () => {
        const deployment = makeDeployment({ runtime: makeWebviewRuntime() });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => false;

        const result = deployment.validateNodePackages(makeWebviewCollection());

        assert.ok(
            result.errors.some((e) => e.includes('otter_vars/store.py')),
            'Expected the required package file to be validated'
        );
    });

    it('accepts a webview-only collection when required package assets exist', () => {
        const deployment = makeDeployment({ runtime: makeWebviewRuntime() });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;

        const result = deployment.validateNodePackages(makeWebviewCollection());

        assert.equal(result.compatible, true);
        assert.equal(result.errors.length, 0);
    });

    it('warns for an outdated required package in embedded mode', () => {
        const runtime = makeWebviewRuntime({
            globalPackageIds: ['vars'],
            varsVersion: '0.16.0',
        });
        const deployment = makeDeployment({
            runtime,
            stateOverrides: {
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                embeddedPackagesSummary: {
                    totalPackages: 1,
                    totalFiles: 1,
                    totalBytes: 100,
                    packages: [{ name: 'vars', version: '0.15.0' }],
                },
                embeddedInventory: { files: [] },
            },
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;

        const result = deployment.validateNodePackages(makeWebviewCollection());

        assert.ok(result.warnings.some((w) => w.includes('deployment.packageVersionOutdated')));
        assert.ok(result.warnings.some((w) => w.includes('vars')));
    });

    it('ignores unknown required package ids', () => {
        const deployment = makeDeployment({
            runtime: makeWebviewRuntime({ requiredPackages: ['missing'] }),
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;

        const result = deployment.validateNodePackages(makeWebviewCollection());

        assert.equal(result.errors.length, 0);
        assert.ok(!result.warnings.some((w) => w.includes('missing')));
    });
});

// ---------------------------------------------------------------------------
// Cross-entry-point consistency: the compatibility warnings and the deploy-time
// override plan come from the same analysis, so they can never disagree.
// ---------------------------------------------------------------------------

describe('validateNodePackages ↔ _computeEmbeddedOverridePlan consistency', () => {
    /**
     * Build a deployment that can answer both questions.
     * @param {object} [opts] - Deployment options
     * @param {string[]} [opts.globalPackageIds] - Globally-bundled package ids
     * @param {Array<{id: string, version: string, mpAssets?: object}>} [opts.packages] - Host packages
     * @param {Array<{id: string, version: string}>|null} [opts.devicePackages] - Firmware packages
     * @param {Record<string, string>|null} [opts.firmwareVersions] - Fallback firmware versions
     * @param {boolean} [opts.embedded] - Whether the device runs an embedded runtime
     * @returns {object} DeviceDeployment instance with both version sources applied
     */
    function makeConsistencyDeployment({
        globalPackageIds = [],
        packages = [],
        devicePackages = null,
        firmwareVersions = null,
        embedded = true,
    } = {}) {
        const runtime = makeRuntime({ globalPackageIds, packages, allNodeTypesFound: true });
        return makeDeployment({
            runtime,
            stateOverrides: {
                runtimeId: 'general',
                runtimeEmbedded: embedded,
                runtimeDeploymentMode: embedded ? 'embedded' : 'dynamic',
                embeddedPackagesSummary: devicePackages
                    ? {
                          totalPackages: devicePackages.length,
                          totalFiles: 0,
                          totalBytes: 0,
                          packages: devicePackages.map((p) => ({
                              name: p.id,
                              version: p.version,
                          })),
                      }
                    : null,
                firmwareConstituentVersions: firmwareVersions
                    ? {
                          micropythonVersion: null,
                          runtimeSourceVersion: null,
                          runtimeFirmwareVersion: null,
                          deviceToolsVersion: null,
                          nodePackages: firmwareVersions,
                      }
                    : null,
            },
        });
    }

    /**
     * Extract the package ids of all outdated-package warnings.
     * @param {string[]} warnings - Warning strings from validateNodePackages
     * @returns {Set<string>} Warned package ids
     */
    function warnedPackageIds(warnings) {
        const ids = new Set();
        for (const warning of warnings) {
            if (
                !warning.startsWith('deployment.packageVersionOutdated') &&
                !warning.startsWith('deployment.packageVersionUnknown')
            ) {
                continue;
            }
            const match = /packageId=([^,]+)/.exec(warning);
            if (match) {
                ids.add(match[1]);
            }
        }
        return ids;
    }

    it('warns about exactly the packages whose files the override plan uploads', () => {
        const deployment = makeConsistencyDeployment({
            globalPackageIds: ['vars', 'webview'],
            packages: [
                {
                    id: 'webview',
                    version: '1.27.0',
                    mpAssets: {
                        '*': ['/device/node_pkgs/webview/otter_webview/panel.py'],
                    },
                },
                {
                    id: 'vars',
                    version: '0.20.0',
                    mpAssets: {
                        '*': ['/device/node_pkgs/vars/otter_vars/__init__.py'],
                        'array-generate': ['/device/node_pkgs/vars/otter_vars/array.py'],
                    },
                },
            ],
            devicePackages: [
                { id: 'webview', version: '1.27.0' },
                { id: 'vars', version: '0.19.0' },
            ],
        });
        const collection = makeCollection(['webview.panel', 'vars.array-generate']);
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;

        const { warnings } = deployment.validateNodePackages(collection);
        const overridePaths = deployment._computeEmbeddedOverridePlan(collection)?.overridePaths ?? null;

        const warned = warnedPackageIds(warnings);
        const planned = new Set(
            overridePaths.map((p) => (p.startsWith('otter_vars/') ? 'vars' : 'webview'))
        );

        assert.deepEqual([...warned], ['vars']);
        assert.deepEqual([...planned], ['vars']);
    });

    it('warns and shadows the package when no version source exists', () => {
        const deployment = makeConsistencyDeployment({
            globalPackageIds: ['vars'],
            packages: [
                {
                    id: 'vars',
                    version: '0.20.0',
                    mpAssets: {
                        '*': ['/device/node_pkgs/vars/otter_vars/__init__.py'],
                        'array-generate': ['/device/node_pkgs/vars/otter_vars/array.py'],
                    },
                },
            ],
            devicePackages: null,
            firmwareVersions: null,
        });
        deployment._collectionDeployment.isLibraryAvailableOnHost = () => true;
        const collection = makeCollection(['vars.array-generate']);

        const { warnings } = deployment.validateNodePackages(collection);

        assert.deepEqual([...warnedPackageIds(warnings)], ['vars']);
        assert.deepEqual(deployment._computeEmbeddedOverridePlan(collection)?.overridePaths ?? null, [
            'otter_vars/__init__.py',
            'otter_vars/array.py',
        ]);
    });

    it('reports no warnings and an empty plan when the firmware is not outdated', () => {
        const deployment = makeConsistencyDeployment({
            globalPackageIds: ['vars'],
            packages: [{ id: 'vars', version: '0.20.0' }],
            devicePackages: [{ id: 'vars', version: '0.21.0' }],
        });
        const collection = makeCollection(['vars.array-generate']);

        const { warnings } = deployment.validateNodePackages(collection);

        assert.equal(warnedPackageIds(warnings).size, 0);
        assert.deepEqual(deployment._computeEmbeddedOverridePlan(collection)?.overridePaths ?? null, []);
    });

    it('reports no warnings and an empty plan in dynamic mode', () => {
        const deployment = makeConsistencyDeployment({
            globalPackageIds: ['vars'],
            packages: [{ id: 'vars', version: '0.20.0' }],
            devicePackages: [{ id: 'vars', version: '0.19.0' }],
            embedded: false,
        });
        const collection = makeCollection(['vars.array-generate']);

        const { warnings } = deployment.validateNodePackages(collection);

        assert.equal(warnedPackageIds(warnings).size, 0);
        assert.deepEqual(deployment._computeEmbeddedOverridePlan(collection)?.overridePaths ?? null, []);
    });

    it('interpolates packageId, deviceVersion and hostVersion into the warning', () => {
        const deployment = makeConsistencyDeployment({
            globalPackageIds: ['vars'],
            packages: [{ id: 'vars', version: '0.20.0' }],
            devicePackages: [{ id: 'vars', version: '0.19.0' }],
        });

        const { warnings } = deployment.validateNodePackages(
            makeCollection(['vars.array-generate'])
        );
        const outdated = warnings.filter((w) => w.startsWith('deployment.packageVersionOutdated'));

        assert.equal(outdated.length, 1);
        assert.ok(outdated[0].includes('packageId=vars'));
        assert.ok(outdated[0].includes('deviceVersion=0.19.0'));
        assert.ok(outdated[0].includes('hostVersion=0.20.0'));
    });

    it('reports an error instead of an empty plan when the embedded runtime cannot be resolved', () => {
        const deployment = makeDeployment({
            runtime: null,
            stateOverrides: {
                runtimeId: 'board-only-runtime',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
            },
        });

        const result = deployment.validateNodePackages(makeCollection(['vars.array-generate']));

        assert.equal(result.compatible, false);
        assert.deepEqual(result.warnings, []);
        assert.ok(
            result.errors.some((error) => error.startsWith('Cannot resolve the embedded runtime:')),
            'embedded mode must never degrade to "nothing to shadow" silence'
        );
        assert.equal(
            deployment._computeEmbeddedOverridePlan(makeCollection(['vars.array-generate'])),
            null
        );
    });
});

