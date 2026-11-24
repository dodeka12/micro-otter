// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';

class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this.connected = false;
        this.executeCodeCalls = [];
    }

    isConnected() {
        return this.connected;
    }

    getState() {
        return this.connected ? 'connected' : 'disconnected';
    }

    getDeviceInfoData() {
        return null;
    }

    async loadDeviceInfo() {
        return {
            runtime: null,
            collection: null,
        };
    }

    async executeCode(code) {
        this.executeCodeCalls.push(code);
        return [
            'noise before',
            'OTTER_MPY_PROBE_START',
            '{"versionMajor":1,"versionMinor":27,"versionPatch":0,"versionSuffix":"","mpyAbi":11014,"platform":"esp32","machine":"ESP32 module","release":"1.27.0","maxsize":2147483647,"wordBits":31,"smallIntBits":31}',
            'OTTER_MPY_PROBE_END',
            'noise after',
        ].join('\n');
    }

    async hardReset() {}
    async softReset() {}
    async deleteFile() {}
    async deleteFolderRecursive() {}
    async deleteFileSystem() {}
    async sendFile() {}
    async ensureDirectory() {}
    async writeTextFile() {}
    async readTextFile() {
        return '{}';
    }
}

function createRuntimeCollection() {
    const runtime = {
        id: 'general',
        name: 'General Runtime',
        version: '1.0.0',
        manifest: {},
        nodePackages: [],
        getNodeType() {
            return null;
        },
        getDeviceTarget(targetId) {
            return {
                id: targetId,
                displayName: targetId,
            };
        },
    };

    return {
        getRuntime(runtimeId) {
            if (runtimeId !== 'general') {
                return null;
            }

            return runtime;
        },
    };
}

function createCollection() {
    return {
        id: 'cln-1',
        getId() {
            return 'cln-1';
        },
        getTitle() {
            return 'Probe Collection';
        },
        getVersionString() {
            return '1.0.0';
        },
        getTargetId() {
            return 'esp32_wroom';
        },
        getDeviceRuntimeId() {
            return 'general';
        },
        getGraphArray() {
            return [];
        },
    };
}

function createI18nService() {
    return {
        t(key, params = {}) {
            if (key === 'deployment.errors.targetMismatch') {
                return `Collection target ${params.collectionTarget} does not match device target ${params.deviceTarget}`;
            }
            return key;
        },
    };
}

function createViewManager() {
    return {
        formCalls: [],
        nextConfirmed: false,
        async showFormDialog() {
            this.formCalls.push(true);
            return { confirmed: this.nextConfirmed, formData: {} };
        },
        async showError() {},
    };
}

describe('DeviceDeployment MPY probe integration', () => {
    let deployment;
    let deviceConnection;
    let originalFetch;
    let viewManager;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        deviceConnection = new MockDeviceConnection();
        viewManager = createViewManager();
        deployment = new DeviceDeployment({
            deviceConnection,
            collectionManager: {
                getNodeType() {
                    return null;
                },
            },
            runtimeCollection: createRuntimeCollection(),
            transpiler: {},
            i18nService: createI18nService(),
            viewManager,
        });

        deployment._updateDeviceState({
            connected: true,
            runtimeInstalled: true,
            runtimeId: 'general',
            runtimeVersion: '1.0.0',
            deviceTargetInfo: {
                id: 'esp32_wroom',
                displayName: 'ESP32-WROOM',
            },
        });
        deviceConnection.connected = true;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('probes compile parameters before deployCollection and forwards probe result', async () => {
        const collection = createCollection();
        let receivedOptions = null;

        deployment._collectionDeployment.deployCollection = async (_collection, options) => {
            receivedOptions = options;
            return 1;
        };

        await deployment.deployCollection(collection, { force: true });

        assert.equal(deviceConnection.executeCodeCalls.length, 1);
        assert.match(deviceConnection.executeCodeCalls[0], /OTTER_MPY_PROBE_START/);
        assert.ok(receivedOptions);
        assert.equal(receivedOptions.mpyProbe.smallIntBits, 31);
        assert.equal(receivedOptions.mpyProbe.mpyAbi, 11014);
        assert.equal(typeof receivedOptions.mpyCompileProfile.hash, 'string');
        assert.ok(receivedOptions.mpyCompileProfile.hash.length > 0);
        assert.equal(receivedOptions.mpyCompileProfile.compileParams.emit, 'bytecode');
        assert.equal(typeof receivedOptions.mpyAvailability, 'object');
    });

    it('probes compile parameters before syncCollectionFiles and forwards probe result', async () => {
        const collection = createCollection();
        let receivedOptions = null;

        deployment._collectionDeployment.syncCollectionFiles = async (_collection, options) => {
            receivedOptions = options;
            return 0;
        };

        await deployment.syncCollectionFiles(collection, { includeFullDefinition: false });

        assert.equal(deviceConnection.executeCodeCalls.length, 1);
        assert.ok(receivedOptions);
        assert.equal(receivedOptions.mpyProbe.platform, 'esp32');
        assert.equal(receivedOptions.mpyCompileProfile.compileParams.smallIntBits, 31);
        assert.equal(typeof receivedOptions.mpyAvailability, 'object');
    });

    it('resolves manifest availability for tools, runtime, and node packages', async () => {
        const targetHash = 'abc123def456';
        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.manifest = {
            mpyCompileProfiles: {
                [targetHash]: {
                    emit: 'bytecode',
                },
            },
        };
        runtime.nodePackages = [
            {
                id: 'webview',
                packageRoot: '/device/node_pkgs/webview/',
                manifest: {
                    mpyCompileProfiles: {
                        [targetHash]: {
                            emit: 'bytecode',
                        },
                    },
                },
            },
        ];

        globalThis.fetch = async (url) => {
            const href = String(url);
            if (href === '/device/tools/manifest.json') {
                return {
                    ok: true,
                    async json() {
                        return {
                            mpyCompileProfiles: {
                                [targetHash]: {
                                    emit: 'bytecode',
                                },
                            },
                        };
                    },
                };
            }
            throw new Error(`Unexpected fetch URL: ${href}`);
        };

        const report = await deployment._resolveMpyAvailabilityReport({
            runtimeId: 'general',
            hash: targetHash,
            includeTools: true,
            includeRuntime: true,
            includeNodePackages: true,
            collection: createCollection(),
        });

        assert.equal(report.tools.hasProfile, true);
        assert.equal(report.runtime.hasProfile, true);
        assert.equal(report.nodePackages.length, 1);
        assert.equal(report.nodePackages[0].packageId, 'webview');
        assert.equal(report.nodePackages[0].hasProfile, true);
    });

    it('prefers manifest profile hash for bytecode compatibility matching', async () => {
        const targetHash = '052d85852e60';
        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.manifest = {
            mpyCompileProfiles: {
                [targetHash]: {
                    mpyCrossVersion:
                        'MicroPython v1.27.0-dirty on 2026-04-08; mpy-cross emitting mpy v6.3',
                    emit: 'bytecode',
                    smallIntBits: 31,
                    march: null,
                    marchFlags: null,
                },
            },
        };

        const collection = createCollection();
        let receivedOptions = null;

        deployment._collectionDeployment.deployCollection = async (_collection, options) => {
            receivedOptions = options;
            return 1;
        };

        await deployment.deployCollection(collection, { force: true });

        assert.ok(receivedOptions);
        assert.equal(receivedOptions.mpyCompileProfile.hash, targetHash);
        assert.equal(receivedOptions.mpyCompileProfile.compileParams.emit, 'bytecode');
        assert.equal(receivedOptions.mpyCompileProfile.compileParams.march, null);
    });

    it('cancels deployment before delegate call when fallback dialog is canceled', async () => {
        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.manifest = { mpyCompileProfiles: {} };
        runtime.nodePackages = [
            {
                id: 'webview',
                packageRoot: '/device/node_pkgs/webview/',
                manifest: {
                    mpyCompileProfiles: {},
                },
            },
        ];

        const collection = {
            ...createCollection(),
            getGraphArray() {
                return [
                    {
                        getNodes() {
                            return [{ type: 'webview.web-root' }];
                        },
                    },
                ];
            },
        };

        let delegateCalled = false;
        deployment._collectionDeployment.deployCollection = async (_collection, _options) => {
            delegateCalled = true;
            return 0;
        };

        await assert.rejects(async () => {
            await deployment.deployCollection(collection, { force: true });
        }, /Deployment canceled/i);

        assert.equal(viewManager.formCalls.length, 1);
        assert.equal(delegateCalled, false);
    });

    it('uses source fallback when dialog is confirmed and disables MPY profile usage', async () => {
        viewManager.nextConfirmed = true;

        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.manifest = { mpyCompileProfiles: {} };
        runtime.nodePackages = [
            {
                id: 'webview',
                packageRoot: '/device/node_pkgs/webview/',
                manifest: {
                    mpyCompileProfiles: {},
                },
            },
        ];

        const collection = {
            ...createCollection(),
            getGraphArray() {
                return [
                    {
                        getNodes() {
                            return [{ type: 'webview.web-root' }];
                        },
                    },
                ];
            },
        };

        let receivedOptions = null;
        deployment._collectionDeployment.deployCollection = async (_collection, options) => {
            receivedOptions = options;
            return 0;
        };

        await deployment.deployCollection(collection, { force: true });

        assert.equal(viewManager.formCalls.length, 1);
        assert.ok(receivedOptions);
        assert.equal(receivedOptions.mpyFallbackDecision, 'source');
        assert.equal(receivedOptions.mpyAvailability.nodePackages[0].hasProfile, false);
    });

    it('prompts fallback when required node-package mpy artifacts are missing', async () => {
        viewManager.nextConfirmed = true;

        const targetHash = '052d85852e60';
        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.manifest = {
            mpyCompileProfiles: {
                [targetHash]: {
                    mpyCrossVersion:
                        'MicroPython v1.27.0-dirty on 2026-04-08; mpy-cross emitting mpy v6.3',
                    emit: 'bytecode',
                    smallIntBits: 31,
                    march: null,
                    marchFlags: null,
                },
            },
        };
        runtime.nodePackages = [
            {
                id: 'core',
                packageRoot: '/device/node_pkgs/core/',
                manifest: {
                    mpyCompileProfiles: {
                        [targetHash]: {
                            emit: 'bytecode',
                        },
                    },
                },
                mpAssets: {
                    memoryInfo: [
                        '/device/node_pkgs/core/libs/core/__init__.py',
                        '/device/node_pkgs/core/libs/core/system.py',
                    ],
                },
            },
        ];

        globalThis.fetch = async (url) => {
            const href = String(url);
            if (href === '/device/tools/manifest.json') {
                return {
                    ok: true,
                    async json() {
                        return {
                            mpyCompileProfiles: {
                                [targetHash]: {
                                    emit: 'bytecode',
                                },
                            },
                        };
                    },
                };
            }

            if (href.includes('/device/node_pkgs/core/libs/core/__mpycache__/052d85852e60/')) {
                return {
                    ok: false,
                    status: 404,
                    async json() {
                        return {};
                    },
                };
            }

            throw new Error(`Unexpected fetch URL: ${href}`);
        };

        const collection = {
            ...createCollection(),
            getGraphArray() {
                return [
                    {
                        getNodes() {
                            return [{ type: 'core.memoryInfo' }];
                        },
                    },
                ];
            },
        };

        let receivedOptions = null;
        deployment._collectionDeployment.deployCollection = async (_collection, options) => {
            receivedOptions = options;
            return 0;
        };

        await deployment.deployCollection(collection, { force: true });

        assert.equal(viewManager.formCalls.length, 1);
        assert.ok(receivedOptions);
        assert.equal(receivedOptions.mpyFallbackDecision, 'source');
        assert.equal(receivedOptions.mpyAvailability.nodePackages[0].packageId, 'core');
        assert.equal(receivedOptions.mpyAvailability.nodePackages[0].hasProfile, false);
    });

    it('reports required packages in the mpy availability report', async () => {
        const targetHash = '052d85852e60';
        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.nodePackages = [
            {
                id: 'webview',
                packageRoot: '/device/node_pkgs/webview/',
                manifest: {
                    mpyCompileProfiles: {
                        [targetHash]: {
                            emit: 'bytecode',
                        },
                    },
                },
                requiredPackages: ['vars'],
            },
            {
                id: 'vars',
                packageRoot: '/device/node_pkgs/vars/',
                manifest: {
                    mpyCompileProfiles: {
                        [targetHash]: {
                            emit: 'bytecode',
                        },
                    },
                },
                mpAssets: {
                    '*': ['/device/node_pkgs/vars/otter_vars/store.py'],
                },
            },
        ];

        const missingArtifactSuffix = `/device/node_pkgs/vars/otter_vars/__mpycache__/${targetHash}/store.mpy`;
        globalThis.fetch = async (url) => {
            const href = String(url);
            if (href.includes(missingArtifactSuffix)) {
                return {
                    ok: false,
                    status: 404,
                    async json() {
                        return {};
                    },
                };
            }
            throw new Error(`Unexpected fetch URL: ${href}`);
        };

        const collection = {
            ...createCollection(),
            getGraphArray() {
                return [
                    {
                        getNodes() {
                            return [{ type: 'webview.web-view-number-input' }];
                        },
                    },
                ];
            },
        };

        const report = await deployment._resolveMpyAvailabilityReport({
            runtimeId: 'general',
            hash: targetHash,
            includeTools: false,
            includeRuntime: false,
            includeNodePackages: true,
            collection,
        });

        const varsEntry = report.nodePackages.find((entry) => entry.packageId === 'vars');
        assert.ok(varsEntry, 'Expected the required package in the mpy availability report');
        assert.equal(varsEntry.hasProfile, false);
    });

    it('prefers a version-matching mpy profile over stale profiles with identical selector params', () => {
        const staleHash = '052d85852e60';
        const currentHash = '99b7e0eba38c';
        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.manifest = {
            mpyCompileProfiles: {
                [staleHash]: {
                    mpyCrossVersion:
                        'MicroPython v1.27.0-dirty on 2026-04-08; mpy-cross emitting mpy v6.3',
                    emit: 'bytecode',
                    smallIntBits: 31,
                    march: null,
                    marchFlags: null,
                },
                [currentHash]: {
                    mpyCrossVersion:
                        'MicroPython v1.29.0 on 2026-11-01; mpy-cross emitting mpy v6.3',
                    emit: 'bytecode',
                    smallIntBits: 31,
                    march: null,
                    marchFlags: null,
                },
            },
        };

        const match = deployment._resolveManifestMpyCompileProfile(
            'general',
            { emit: 'bytecode', smallIntBits: 31, march: null, marchFlags: null },
            'MicroPython v1.29.0'
        );

        assert.ok(match);
        assert.equal(match.hash, currentHash);
    });

    it('returns null when no mpy profile matches the probed MicroPython version', () => {
        const staleHash = '052d85852e60';
        const runtime = deployment._runtimeCollection.getRuntime('general');
        runtime.manifest = {
            mpyCompileProfiles: {
                [staleHash]: {
                    mpyCrossVersion:
                        'MicroPython v1.27.0-dirty on 2026-04-08; mpy-cross emitting mpy v6.3',
                    emit: 'bytecode',
                    smallIntBits: 31,
                    march: null,
                    marchFlags: null,
                },
            },
        };

        const match = deployment._resolveManifestMpyCompileProfile(
            'general',
            { emit: 'bytecode', smallIntBits: 31, march: null, marchFlags: null },
            'MicroPython v1.29.0'
        );

        assert.equal(match, null);
    });

    it('infers xtensawin for ESP32 native emit (not the ESP8266 xtensa ABI)', () => {
        assert.equal(
            deployment._inferMpyMarch({ platform: 'esp32', machine: 'ESP32 module' }, 'native'),
            'xtensawin'
        );
        assert.equal(
            deployment._inferMpyMarch({ platform: 'esp32', machine: 'ESP32-C3' }, 'native'),
            'rv32imc'
        );
        assert.equal(
            deployment._inferMpyMarch({ platform: 'esp32', machine: 'ESP32 module' }, 'bytecode'),
            null
        );
    });
});
