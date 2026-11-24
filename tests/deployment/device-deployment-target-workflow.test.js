// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';
import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';
import { isCompleteActiveTargetPayload } from '../../src/micro_otter/nodes/html/js/data/target-payload.js';

class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this.files = new Map();
        this.connected = true;
        this.deviceInfoTargetId = 'esp32_wroom';
        this.includeTargetInDeviceInfo = false;
        this.allowedWebTargetIds = null;
        this.loadDeviceInfoCalls = 0;
        this.disconnectCalls = 0;
        this.suppressTargetReadback = false;
    }

    setAllowedWebTargetIds(ids) {
        this.allowedWebTargetIds = ids;
    }

    setDeviceInfoTarget(targetId) {
        this.deviceInfoTargetId = targetId;
        this.includeTargetInDeviceInfo = true;
    }

    enableDeviceInfoTarget() {
        this.includeTargetInDeviceInfo = true;
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
        this.loadDeviceInfoCalls += 1;
        const targetInfo = this.includeTargetInDeviceInfo
            ? {
                  id: this.deviceInfoTargetId,
                  displayName: this.deviceInfoTargetId,
                  capabilityMap: {},
              }
            : null;

        return DeviceState.fromDeviceInfo({
            runtime: {
                id: 'general',
                name: 'General Runtime',
                version: '1.0.0',
                description: 'General runtime',
                customView: null,
            },
            target: targetInfo,
            firmware: {
                allowedWebTargetIds: this.allowedWebTargetIds,
            },
        });
    }

    async executeCode(code) {
        if (code.includes('print(1+1)')) {
            return '2';
        }
        if (code.includes('OTTER_MPY_PROBE_START') && code.includes('OTTER_MPY_PROBE_END')) {
            return [
                'OTTER_MPY_PROBE_START',
                JSON.stringify({
                    versionMajor: 1,
                    versionMinor: 22,
                    versionPatch: 1,
                    mpyAbi: 6,
                    platform: 'esp32',
                    machine: 'ESP32 module',
                    release: '1.22.1',
                    maxsize: 2147483647,
                    wordBits: 31,
                    smallIntBits: 31,
                }),
                'OTTER_MPY_PROBE_END',
            ].join('\n');
        }
        return '3.4.0; MicroPython v1.22.1';
    }

    async ensureDirectory() {}

    async writeTextFile(path, content) {
        this.files.set(path, String(content));

        if (this.suppressTargetReadback) {
            return;
        }

        if (path === '/device/targets/active_target.json') {
            try {
                const parsed = JSON.parse(String(content));
                const targetId = parsed?.targetId || parsed?.id;
                if (typeof targetId === 'string' && targetId.trim().length > 0) {
                    this.deviceInfoTargetId = targetId;
                    this.includeTargetInDeviceInfo = true;
                }
            } catch {
                // Malformed JSON is a real device condition; keep the previous target info
                // instead of failing the fake write.
            }
            return;
        }

        if (path === '/device.json') {
            try {
                const parsed = JSON.parse(String(content));
                const targetId = parsed?.targetId;
                if (typeof targetId === 'string' && targetId.trim().length > 0) {
                    this.deviceInfoTargetId = targetId;
                    this.includeTargetInDeviceInfo = true;
                }
            } catch {
                // Same as above: an unparsable /device.json must not break the write.
            }
        }
    }

    async readTextFile(path) {
        if (!this.files.has(path)) {
            throw new Error(`File not found: ${path}`);
        }
        return this.files.get(path);
    }

    async sendFile(path, content) {
        this.files.set(
            path,
            typeof content === 'string' ? content : new TextDecoder().decode(content)
        );
    }

    async deleteFolderRecursive() {}
    async deleteFile() {}
    async disconnect() {
        this.disconnectCalls += 1;
        this.connected = false;
    }
    async hardReset() {}
    async softReset() {}
    async exitRawRepl() {}
    async calculateHash() {
        return null;
    }
}

class MockViewManager {
    constructor() {
        this.formCalls = [];
        this.lastError = null;
        this.formResult = {
            confirmed: true,
            formData: {
                target: 'esp32_wroom',
                userDescription: '',
            },
        };
    }

    async showFormDialog(options) {
        this.formCalls.push(options);
        return this.formResult;
    }

    async showError(options) {
        this.lastError = options;
    }

    setFormResult(result) {
        this.formResult = result;
    }
}

function createI18n() {
    return {
        t(key, params = {}) {
            if (key === 'deployment.errors.targetMismatch') {
                return `Collection target ${params.collectionTarget} does not match device target ${params.deviceTarget}`;
            }
            return key;
        },
    };
}

function createRuntimeCollection() {
    const targets = [
        { id: 'esp32_wroom', displayName: 'ESP32-WROOM', description: 'WROOM target' },
        { id: 'esp32_c3', displayName: 'ESP32-C3', description: 'C3 target' },
        { id: 'esp32_s3', displayName: 'ESP32-S3', description: 'S3 target' },
    ];

    const runtime = {
        id: 'general',
        name: 'General Runtime',
        version: '1.0.0',
        description: 'General runtime',
        manifest: { preservedPaths: [], nodeLibraries: { alwaysInclude: [] } },
        resolvedFilesystem: ['http://localhost/device/runtime/general/runtime/main.py'],
        getAvailableTargets() {
            return targets;
        },
        getDeviceTarget(targetId) {
            return targets.find((target) => target.id === targetId) || null;
        },
        getEffectiveTargetPayload(targetId) {
            return {
                targetId,
                displayName: 'Effective',
                description: 'Effective payload',
                pinCapabilities: { 2: { label: 'GPIO2' } },
            };
        },
        getNodeType() {
            return null;
        },
    };

    return {
        getRuntime(runtimeId) {
            if (runtimeId === 'general') {
                return runtime;
            }
            return null;
        },
    };
}

function createCollection(targetId) {
    return {
        id: 'collection-1',
        getId() {
            return 'collection-1';
        },
        getTitle() {
            return 'Target Workflow Collection';
        },
        getVersionString() {
            return '1.0.0';
        },
        getTargetId() {
            return targetId;
        },
        getDeviceRuntimeId() {
            return 'general';
        },
        getGraphArray() {
            return [];
        },
    };
}

function createCollectionManager() {
    return {
        async transpileCollection() {
            return { code: 'print("ok")', assets: { packages: {} } };
        },
        getNodeType() {
            return null;
        },
    };
}

describe('device deployment target workflow migration coverage', () => {
    let deployment;
    let deviceConnection;
    let viewManager;
    let originalFetch;
    let originalWindow;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        originalWindow = globalThis.window;

        globalThis.window = { location: { origin: 'http://localhost' } };

        globalThis.fetch = async (url) => {
            const href = String(url);
            if (href.endsWith('/device/tools/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return { files: [] };
                    },
                };
            }
            if (href.endsWith('/device/runtime/general/runtime/main.py')) {
                return {
                    ok: true,
                    async text() {
                        return 'print("runtime")';
                    },
                };
            }
            throw new Error(`Unexpected fetch URL: ${href}`);
        };

        deviceConnection = new MockDeviceConnection();
        viewManager = new MockViewManager();

        deployment = new DeviceDeployment({
            deviceConnection,
            collectionManager: createCollectionManager(),
            runtimeCollection: createRuntimeCollection(),
            transpiler: {},
            i18nService: createI18n(),
            viewManager,
            logger: console,
        });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        deployment.destroy();
    });

    it('installs runtime with target selection and persists target metadata', async () => {
        await deployment.detectMicroPython();

        await deployment.installRuntime('general');

        const targetDialogs = viewManager.formCalls.filter((dialog) =>
            Array.isArray(dialog.fields)
                ? dialog.fields.some((field) => field.id === 'target')
                : false
        );
        assert.equal(targetDialogs.length, 1);

        const uploadedTargetJson = deviceConnection.files.get('/device/targets/active_target.json');
        assert.ok(uploadedTargetJson);

        const uploadedTarget = JSON.parse(uploadedTargetJson);
        assert.equal(uploadedTarget.id, 'esp32_wroom');
        assert.equal(uploadedTarget.targetId, 'esp32_wroom');
        assert.equal(uploadedTarget.configVersion, 1);
        assert.equal('capabilities' in uploadedTarget, false);

        const deviceJson = JSON.parse(deviceConnection.files.get('/device.json'));
        assert.equal(deviceJson.targetId, 'esp32_wroom');
        assert.equal(deviceJson.targetConfigPath, '/device/targets/active_target.json');
        assert.equal(deviceJson.targetUserDescription, '');

        const state = deployment.getDeviceState();
        assert.ok(state.deviceTargetInfo);
        assert.equal(state.deviceTargetInfo.id, 'esp32_wroom');
    });

    it('uploads the effective payload with real pin capabilities', async () => {
        await deployment._uploadTargetConfiguration('esp32_wroom', 'general');

        const uploaded = JSON.parse(
            deviceConnection.files.get('/device/targets/active_target.json')
        );
        assert.equal(uploaded.targetId, 'esp32_wroom');
        assert.equal(uploaded.pinCapabilities[2].label, 'GPIO2');
        assert.equal('_descriptors' in uploaded, false);
        assert.equal('capabilityRegistry' in uploaded, false);
    });

    it('writes a self-sufficient active target payload without a capabilities shim', async () => {
        await deployment._uploadTargetConfiguration('esp32_wroom', 'general');

        const writtenJson = deviceConnection.files.get('/device/targets/active_target.json');
        assert.ok(writtenJson);

        const written = JSON.parse(writtenJson);
        assert.equal('capabilities' in written, false);
        assert.equal(isCompleteActiveTargetPayload(written), true);
    });

    it('keeps dynamic runtime install ownership in DeviceDeployment when no compiled firmware is reported', async () => {
        deployment._updateDeviceState({ connected: true, hasMicroPython: true });

        deviceConnection.dispatchEvent(
            new CustomEvent('device-initialization-status', {
                detail: {
                    initializationVerdict: 'ready-for-runtime-install',
                    onboardingActionable: false,
                    runtimeDeploymentMode: 'dynamic',
                    runtimePresent: false,
                    specificTargetPresent: false,
                },
            })
        );

        let installRuntimeCalls = 0;
        deployment._runtimeDeployment.installRuntime = async () => {
            installRuntimeCalls += 1;
        };

        await deployment.installRuntime('general');

        assert.equal(installRuntimeCalls, 1);
        const targetDialogs = viewManager.formCalls.filter((dialog) =>
            Array.isArray(dialog.fields)
                ? dialog.fields.some((field) => field.id === 'target')
                : false
        );
        assert.equal(targetDialogs.length, 1);
    });

    it('filters target selection options using allowed target ids', async () => {
        await deployment._promptTargetSelection('general', {
            allowedTargetIds: ['esp32_c3'],
        });

        assert.equal(viewManager.formCalls.length, 1);
        const dialog = viewManager.formCalls[0];
        const targetField = dialog.fields.find((field) => field.id === 'target');

        assert.ok(targetField);
        assert.deepEqual(targetField.options, [{ value: 'esp32_c3', label: 'ESP32-C3' }]);
    });

    it('pre-selects the current target and its description in the target dialog', async () => {
        await deployment._promptTargetSelection('general', {
            currentTargetId: 'esp32_c3',
        });

        assert.equal(viewManager.formCalls.length, 1);
        const dialog = viewManager.formCalls[0];
        const targetField = dialog.fields.find((field) => field.id === 'target');
        const descriptionField = dialog.fields.find(
            (field) => field.id === 'targetDescription'
        );

        assert.equal(targetField.default, 'esp32_c3');
        assert.equal(descriptionField.value, 'C3 target');
    });

    it('falls back to the first target when currentTargetId is unknown', async () => {
        await deployment._promptTargetSelection('general', {
            currentTargetId: 'unknown_target',
        });

        assert.equal(viewManager.formCalls.length, 1);
        const dialog = viewManager.formCalls[0];
        const targetField = dialog.fields.find((field) => field.id === 'target');
        const descriptionField = dialog.fields.find(
            (field) => field.id === 'targetDescription'
        );

        assert.equal(targetField.default, 'esp32_wroom');
        assert.equal(descriptionField.value, 'WROOM target');
    });

    it('reconfigures the device target and persists the updated values', async () => {
        deployment._updateDeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeId: 'general',
            deviceTargetInfo: new DeviceTargetInfo({
                id: 'esp32_wroom',
                displayName: 'ESP32-WROOM',
                instanceData: { userDescription: 'Old description' },
            }),
        });

        viewManager.setFormResult({
            confirmed: true,
            formData: { target: 'esp32_c3', userDescription: 'Workshop device' },
        });

        await deployment.reconfigureDeviceTarget();

        const uploadedTarget = JSON.parse(
            deviceConnection.files.get('/device/targets/active_target.json')
        );
        assert.equal(uploadedTarget.id, 'esp32_c3');

        const deviceJson = JSON.parse(deviceConnection.files.get('/device.json'));
        assert.equal(deviceJson.targetId, 'esp32_c3');
        assert.equal(deviceJson.targetUserDescription, 'Workshop device');

        const state = deployment.getDeviceState();
        assert.equal(state.deviceTargetInfo.id, 'esp32_c3');
    });

    it('does not write anything when target reconfigure is cancelled', async () => {
        deployment._updateDeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeId: 'general',
            deviceTargetInfo: new DeviceTargetInfo({ id: 'esp32_wroom' }),
        });

        viewManager.setFormResult({ confirmed: false, formData: null });

        await deployment.reconfigureDeviceTarget();

        assert.equal(deviceConnection.files.has('/device/targets/active_target.json'), false);
        assert.equal(deviceConnection.files.has('/device.json'), false);
    });


    it('does not trigger onboarding side-effects directly from initialization-status event', async () => {
        deployment._updateDeviceState({ connected: true });
        const loadCallsBefore = deviceConnection.loadDeviceInfoCalls;

        await Promise.resolve();
        await Promise.resolve();

        deviceConnection.dispatchEvent(
            new CustomEvent('device-initialization-status', {
                detail: {
                    initializationVerdict: 'needs-onboarding',
                    onboardingActionable: true,
                    runtimeDeploymentMode: 'embedded',
                    runtimePresent: true,
                    specificTargetPresent: false,
                },
            })
        );

        await Promise.resolve();
        await Promise.resolve();

        assert.equal(viewManager.formCalls.length, 0);
        assert.equal(viewManager.lastError, null);
        assert.equal(deviceConnection.loadDeviceInfoCalls, loadCallsBefore);
    });

    it('does not orchestrate onboarding from connection onboarding-required events', async () => {
        let responded = false;

        deviceConnection.dispatchEvent(
            new CustomEvent('device-onboarding-required', {
                detail: {
                    respond: () => {
                        responded = true;
                    },
                    runtimeIdentity: {
                        id: 'general',
                        name: 'General Runtime',
                        version: '1.0.0',
                    },
                    targetConstraints: {
                        allowedTargetIds: ['esp32_wroom'],
                    },
                },
            })
        );

        await Promise.resolve();
        await Promise.resolve();

        assert.equal(responded, false);
        assert.equal(viewManager.formCalls.length, 0);
    });

    it('routes initial detection through the same connection initialization handler', async () => {
        let handleConnectCalls = 0;
        deployment._handleDeviceConnect = async () => {
            handleConnectCalls += 1;
        };

        await deployment._scheduleInitialDetection();

        assert.equal(handleConnectCalls, 1);
    });

    it('does not prompt during refresh when specific target is already set', async () => {
        deviceConnection.setDeviceInfoTarget('esp32_wroom');
        deployment._updateDeviceState({ connected: true });

        await deployment.refreshDeviceInfo();

        const hasTargetDialog = viewManager.formCalls.some((dialog) =>
            Array.isArray(dialog.fields)
                ? dialog.fields.some((field) => field.id === 'target')
                : false
        );
        assert.equal(hasTargetDialog, false);
    });

    it('runs deploy preflight before target compatibility validation when onboarding is required', async () => {
        deployment._updateDeviceState({
            connected: true,
            runtimeInstalled: true,
            runtimeId: 'general',
            deviceTargetInfo: null,
        });
        deployment._latestInitializationStatus = {
            initializationVerdict: 'needs-onboarding',
            onboardingActionable: true,
            runtimeDeploymentMode: 'embedded',
            runtimePresent: true,
            specificTargetPresent: false,
        };

        let preflightRan = false;
        deployment._runDeployInitializationPreflight = async () => {
            preflightRan = true;
            deployment._updateDeviceState({
                deviceTargetInfo: {
                    id: 'esp32_wroom',
                    displayName: 'ESP32-WROOM',
                    instanceData: {},
                },
            });
        };

        deployment._validateTargetCompatibility = (collectionTargetId, deviceTargetId) => {
            assert.equal(preflightRan, true);
            assert.equal(viewManager.formCalls.length, 0);
            assert.equal(deviceTargetId, 'esp32_wroom');
        };

        deployment._resolveRuntimeDeployRoutingDecision = async () => ({
            mode: 'dynamic',
            source: 'fallback',
        });
        deployment._resolveMpyCompileProfile = async () => ({ probe: {}, hash: 'abc123' });
        deployment._resolveMpyAvailabilityReport = async () => ({
            hash: 'abc123',
            tools: {
                required: false,
                hasProfile: true,
                manifestPath: '/device/tools/manifest.json',
            },
            runtime: {
                required: false,
                hasProfile: true,
                manifestPath: '/device/runtime/general/manifest.json',
            },
            nodePackages: [],
        });
        deployment._resolveMpyFallbackDecision = async () => 'source';
        deployment._applyMpyFallbackDecision = (report) => report;
        deployment._collectionDeployment.deployCollection = async () => 0;

        await assert.doesNotReject(async () => {
            await deployment.deployCollection(createCollection('esp32_wroom'), { force: true });
        });
    });

    it('returns explicit onboarding-required diagnostics when target selection is cancelled', async () => {
        deployment._latestInitializationStatus = {
            initializationVerdict: 'needs-onboarding',
            onboardingActionable: true,
            runtimeDeploymentMode: 'embedded',
            runtimePresent: true,
            specificTargetPresent: false,
        };

        deployment.refreshDeviceInfo = async () => {
            throw new Error('deployment.errors.targetSelectionCancelled');
        };

        await assert.rejects(async () => {
            await deployment._runDeployInitializationPreflight();
        }, /Onboarding required before deployment/);
    });

    it('rejects deployment when collection target and device target mismatch', async () => {
        deviceConnection.enableDeviceInfoTarget();
        await deployment.refreshDeviceInfo();

        await assert.rejects(async () => {
            await deployment.deployCollection(createCollection('esp32_c3'), { force: true });
        }, /does not match/i);

        assert.ok(viewManager.lastError);
    });

    it('allows deployment when collection target matches device target', async () => {
        deviceConnection.enableDeviceInfoTarget();
        await deployment.refreshDeviceInfo();

        await assert.doesNotReject(async () => {
            await deployment.deployCollection(createCollection('esp32_wroom'), { force: true });
        });
    });

    it('rejects deployment when device target does not match collection target', async () => {
        deviceConnection.setDeviceInfoTarget('esp32_s3');
        await deployment.refreshDeviceInfo();

        await assert.rejects(async () => {
            await deployment.deployCollection(createCollection('esp32_wroom'), { force: true });
        }, /does not match/i);
    });

    it('rejects deploying a mismatched collection to a standard-target device', async () => {
        deviceConnection.enableDeviceInfoTarget();
        await deployment.refreshDeviceInfo();

        await assert.rejects(async () => {
            await deployment.deployCollection(createCollection('esp32_c3'), { force: true });
        }, /does not match/i);
    });

    it('allows a compatible collection target under an allowed-target filter', async () => {
        deviceConnection.enableDeviceInfoTarget();
        deviceConnection.setAllowedWebTargetIds(['esp32_wroom']);
        await deployment.refreshDeviceInfo();

        await assert.doesNotReject(async () => {
            await deployment.deployCollection(createCollection('esp32_wroom'), { force: true });
        });
    });

    it('refuses an incompatible collection target with target-not-compatible', async () => {
        deviceConnection.enableDeviceInfoTarget();
        deviceConnection.setAllowedWebTargetIds(['esp32_wroom']);
        await deployment.refreshDeviceInfo();

        await assert.rejects(async () => {
            await deployment.deployCollection(createCollection('esp32_s3'), { force: true });
        }, (error) => error?.code === 'target-not-compatible');
    });
});
