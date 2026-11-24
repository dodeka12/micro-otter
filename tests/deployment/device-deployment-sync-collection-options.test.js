// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';

// Regression coverage for the sync path gap that caused firmware-bundled
// (embedded) `otter_*` modules to be re-uploaded on sync: DeviceDeployment
// .syncCollectionFiles() must forward `embeddedLibraryOverridePaths` computed by
// `_computeEmbeddedOverridePlan(collection)` exactly like deployCollection().

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
    async showConfirmation() {
        return true;
    }
}

function makeDeployment() {
    return new DeviceDeployment({
        deviceConnection: new MockDeviceConnection(),
        collectionManager: new MockCollectionManager(),
        runtimeCollection: { getRuntime: () => null },
        transpiler: new MockTranspiler(),
        i18nService: new MockI18nService(),
        viewManager: new MockViewManager(),
    });
}

function makeCollection() {
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
                        return [{ id: 'n0', type: 'webview.panel' }];
                    },
                },
            ];
        },
    };
}

function stubResolutionMethods(deployment) {
    deployment._resolveRuntimeDeployRoutingDecision = async () => ({
        mode: 'embedded',
        source: 'api',
    });
    deployment._resolveMpyCompileProfile = async () => ({ hash: 'h', probe: { mpyAbi: 6 } });
    deployment._resolveMpyAvailabilityReport = async () => ({ available: true });
    deployment._resolveMpyFallbackDecision = async () => 'use-source';
    deployment._applyMpyFallbackDecision = (report) => report;
}

describe('DeviceDeployment.syncCollectionFiles', () => {
    it('forwards embeddedLibraryOverridePaths computed from the collection', async () => {
        const deployment = makeDeployment();
        stubResolutionMethods(deployment);
        // The gate itself is covered by its own test file; here only the forwarding matters.
        deployment._resolveEmbeddedSourceOverrides = async () => ['otter_webview/__init__.py'];

        let receivedOptions = null;
        deployment._collectionDeployment.syncCollectionFiles = async (_collection, options) => {
            receivedOptions = options;
            return 0;
        };

        const collection = makeCollection();
        await deployment.syncCollectionFiles(collection, { includeFullDefinition: true });

        assert.ok(receivedOptions, 'syncCollectionFiles should be delegated');
        assert.equal(receivedOptions.includeFullDefinition, true);
        assert.deepEqual(receivedOptions.embeddedLibraryOverridePaths, [
            'otter_webview/__init__.py',
        ]);
    });

    it('omits embeddedLibraryOverridePaths when the gate returns null', async () => {
        const deployment = makeDeployment();
        stubResolutionMethods(deployment);
        deployment._resolveEmbeddedSourceOverrides = async () => null;

        let receivedOptions = null;
        deployment._collectionDeployment.syncCollectionFiles = async (_collection, options) => {
            receivedOptions = options;
            return 0;
        };

        await deployment.syncCollectionFiles(makeCollection(), {});

        assert.ok(receivedOptions, 'syncCollectionFiles should be delegated');
        assert.equal('embeddedLibraryOverridePaths' in receivedOptions, false);
    });
});

describe('DeviceDeployment override plan forwarding stability', () => {
    const overridePaths = ['otter_vars/__init__.py', 'otter_vars/arrays.py', 'otter_vars/math.py'];

    function makeEmbeddedDeployment() {
        const runtime = {
            getNodeType() {
                return null;
            },
            nodePackagesGlobal: ['vars'],
            nodePackages: [
                {
                    id: 'vars',
                    manifest: { version: '0.20.0' },
                    mpAssets: {
                        '*': [
                            '/device/node_pkgs/vars/otter_vars/__init__.py',
                            '/device/node_pkgs/vars/otter_vars/arrays.py',
                            '/device/node_pkgs/vars/otter_vars/math.py',
                        ],
                    },
                },
            ],
        };

        const deployment = new DeviceDeployment({
            deviceConnection: new MockDeviceConnection(),
            collectionManager: new MockCollectionManager(),
            runtimeCollection: { getRuntime: () => runtime },
            transpiler: new MockTranspiler(),
            i18nService: new MockI18nService(),
            viewManager: {
                async showConfirmationWithCheckbox() {
                    return { confirmed: true, checkboxChecked: false };
                },
            },
        });

        deployment._updateDeviceState({
            runtimeId: 'general',
            runtimeInstalled: true,
            runtimeEmbedded: true,
            runtimeDeploymentMode: 'embedded',
            embeddedPackagesSummary: {
                totalPackages: 1,
                totalFiles: 3,
                totalBytes: 100,
                packages: [{ name: 'vars', version: '0.19.0' }],
            },
            firmwareConstituentVersions: null,
            deviceTargetInfo: { id: 'generic_micropython' },
        });

        stubResolutionMethods(deployment);

        const collection = {
            getDeviceRuntimeId() {
                return 'general';
            },
            getTargetId() {
                return 'generic_micropython';
            },
            getId() {
                return 'col-1';
            },
            getTitle() {
                return 'Collection';
            },
            getGraphArray() {
                return [
                    {
                        getNodes() {
                            return [{ id: 'n0', type: 'vars.array-modify' }];
                        },
                    },
                ];
            },
        };

        return { deployment, collection };
    }

    it('forwards the identical plan on consecutive deploys and syncs', async () => {
        const { deployment, collection } = makeEmbeddedDeployment();
        const received = [];
        deployment._collectionDeployment.deployCollection = async (_collection, options) => {
            received.push(options.embeddedLibraryOverridePaths);
            return 3;
        };
        deployment._collectionDeployment.syncCollectionFiles = async (_collection, options) => {
            received.push(options.embeddedLibraryOverridePaths);
            return 3;
        };

        await deployment.deployCollection(collection);
        await deployment.deployCollection(collection);
        await deployment.syncCollectionFiles(collection, {});
        await deployment.syncCollectionFiles(collection, {});

        assert.equal(received.length, 4);
        for (const forwarded of received) {
            assert.deepEqual(
                forwarded,
                overridePaths,
                'every entry point must forward the same complete plan'
            );
        }
        assert.deepEqual(received[0], overridePaths, 'later runs must not mutate the first plan');
        assert.notEqual(received[0], received[1], 'each run forwards its own array');
    });
});

describe('DeviceDeployment.getDynamicLibraryPathsOnDevice', () => {
    it('forwards to the collection deployment and returns its value unchanged', async () => {
        const deployment = makeDeployment();
        const expected = ['otter_stdmo/servo.py', 'otter_vars/arrays.py'];
        let called = 0;
        deployment._collectionDeployment.getDynamicLibraryPathsOnDevice = async () => {
            called += 1;
            return expected;
        };

        const paths = await deployment.getDynamicLibraryPathsOnDevice();

        assert.equal(called, 1, 'the accessor must delegate, not duplicate the lookup');
        assert.deepEqual(paths, expected);
        assert.equal(paths, expected, 'the accessor returns the delegated array unchanged');
    });

    it('propagates an empty inventory unchanged', async () => {
        const deployment = makeDeployment();
        deployment._collectionDeployment.getDynamicLibraryPathsOnDevice = async () => [];

        assert.deepEqual(await deployment.getDynamicLibraryPathsOnDevice(), []);
    });
});

describe('DeviceDeployment.syncCollectionFiles — override request', () => {
    it('forwards overrideFirmwarePackages as a forced shadow request', async () => {
        const deployment = makeDeployment();
        stubResolutionMethods(deployment);

        let gateOptions = null;
        deployment._resolveEmbeddedSourceOverrides = async (_collection, options) => {
            gateOptions = options;
            return ['otter_vars/store.py'];
        };
        let received = null;
        deployment._collectionDeployment.syncCollectionFiles = async (_collection, options) => {
            received = options;
            return 1;
        };

        await deployment.syncCollectionFiles(makeCollection(), {
            overrideFirmwarePackages: true,
        });

        assert.deepEqual(gateOptions, { forceShadow: true });
        assert.deepEqual(received.embeddedLibraryOverridePaths, ['otter_vars/store.py']);
        assert.equal(received.embeddedOverrideMode, 'forced');
    });

    it('leaves the gate in approval mode when the option is absent', async () => {
        const deployment = makeDeployment();
        stubResolutionMethods(deployment);

        let gateOptions = null;
        deployment._resolveEmbeddedSourceOverrides = async (_collection, options) => {
            gateOptions = options;
            return [];
        };
        let received = null;
        deployment._collectionDeployment.syncCollectionFiles = async (_collection, options) => {
            received = options;
            return 1;
        };

        await deployment.syncCollectionFiles(makeCollection(), {});

        assert.deepEqual(gateOptions, { forceShadow: false });
        assert.equal('embeddedOverrideMode' in received, false);
    });
});
