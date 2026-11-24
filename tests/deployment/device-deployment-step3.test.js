// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

/**
 * Mock DeviceConnection for testing DeviceDeployment with DeviceState
 */
class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this._state = 'disconnected';
        this._textFiles = new Map();
        this._writtenFiles = new Map();
        this._writeCounts = new Map();
        this._embeddedApiPayload = null;
        this._embeddedApiError = 'module not found';
        this._bootstrapSetupStatusPayload = null;
        this._bootstrapSetupStatusError = 'module not found';
        this._bootstrapSetupApplyPayload = null;
        this._bootstrapSetupApplyError = 'module not found';
        this._executedCodeHistory = [];
        this._deviceInfoData = null;
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

    disconnect() {
        const prevState = this._state;
        this._state = 'disconnected';
        this.dispatchEvent(
            new CustomEvent('statechange', {
                detail: { state: 'disconnected', previousState: prevState },
            })
        );
    }

    async loadDeviceInfo() {
        if (!this.isConnected()) {
            throw new Error('Not connected');
        }

        const embeddedPayload = this._embeddedApiError
            ? null
            : this._embeddedApiPayload || {
                  runtime: {
                      mode: 'embedded',
                      id: 'embedded-general',
                      name: 'Embedded General Runtime',
                      version: '1.2.3-embedded',
                      description: 'Embedded firmware runtime',
                  },
                  packagesSummary: {
                      totalPackages: 2,
                      totalFiles: 5,
                      totalBytes: 1024,
                  },
              };

        const runtimeMode =
            embeddedPayload?.runtime?.mode === 'embedded'
                ? 'embedded'
                : embeddedPayload?.runtime?.mode === 'dynamic'
                  ? 'dynamic'
                  : 'dynamic';
        const runtimeEmbedded = runtimeMode === 'embedded';

        const bootstrapSetupStatus =
            runtimeEmbedded && !this._bootstrapSetupStatusError
                ? this._bootstrapSetupStatusPayload || {
                      schemaVersion: 1,
                      ready: true,
                      files: [],
                      missingOrInvalid: [],
                      errors: [],
                  }
                : null;

        const info = {
            microPythonVersion: '1.22.1',
            runtime: {
                id: 'test-runtime',
                name: 'Test Runtime',
                version: '1.0.0',
                description: 'Mock runtime',
                customView: null,
            },
            target: {
                id: 'esp32-test',
                displayName: 'ESP32 Test Board',
            },
            collection: {
                name: 'TestCollection',
                version: '2.0.0',
            },
            runtimeDeploymentMode: runtimeMode,
            runtimeEmbedded,
            embeddedRuntimeIdentity: runtimeEmbedded
                ? {
                      id: embeddedPayload?.runtime?.id || null,
                      name: embeddedPayload?.runtime?.name || null,
                      version: embeddedPayload?.runtime?.version || null,
                      description: embeddedPayload?.runtime?.description || null,
                  }
                : null,
            embeddedPackagesSummary: runtimeEmbedded
                ? embeddedPayload?.packagesSummary || null
                : null,
            bootstrapSetupStatus,
            bootstrapSetupReady: bootstrapSetupStatus?.ready ?? null,
        };

        this._deviceInfoData = info;

        // Return DeviceState instance as per Step 2
        return DeviceState.fromDeviceInfo(info);
    }

    getDeviceInfoData() {
        return this._deviceInfoData;
    }

    async readTextFile(path) {
        if (!this._textFiles.has(path)) {
            throw new Error(`ENOENT: ${path}`);
        }
        return this._textFiles.get(path);
    }

    async writeTextFile(path, content) {
        this._writtenFiles.set(path, content);
        this._textFiles.set(path, content);
        this._writeCounts.set(path, (this._writeCounts.get(path) || 0) + 1);
    }

    async ensureDirectory() {}

    async executeCode(code) {
        this._executedCodeHistory.push(String(code || ''));

        if (typeof code === 'string' && code.includes('OTTER_MPY_PROBE_START')) {
            return [
                'OTTER_MPY_PROBE_START',
                JSON.stringify({
                    versionMajor: 1,
                    versionMinor: 22,
                    versionPatch: 1,
                    versionSuffix: null,
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

        if (typeof code === 'string' && code.includes('OTTER_EMBEDDED_API_START')) {
            const envelope = this._embeddedApiError
                ? { ok: false, error: this._embeddedApiError }
                : {
                      ok: true,
                      payload: this._embeddedApiPayload || {
                          runtime: {
                              mode: 'embedded',
                              id: 'embedded-general',
                              name: 'Embedded General Runtime',
                              version: '1.2.3-embedded',
                              description: 'Embedded firmware runtime',
                          },
                          packagesSummary: {
                              totalPackages: 2,
                              totalFiles: 5,
                              totalBytes: 1024,
                          },
                          inventory: {
                              schemaVersion: 1,
                              files: [],
                          },
                      },
                  };
            return [
                'OTTER_EMBEDDED_API_START',
                JSON.stringify(envelope),
                'OTTER_EMBEDDED_API_END',
            ].join('\n');
        }

        if (typeof code === 'string' && code.includes('OTTER_BOOTSTRAP_SETUP_API_START')) {
            const envelope = this._bootstrapSetupStatusError
                ? { ok: false, error: this._bootstrapSetupStatusError }
                : {
                      ok: true,
                      payload: this._bootstrapSetupStatusPayload || {
                          schemaVersion: 1,
                          ready: true,
                          files: [
                              { path: '/manifest.json', exists: true, valid: true },
                              { path: '/device.json', exists: true, valid: true },
                              {
                                  path: '/device/targets/active_target.json',
                                  exists: true,
                                  valid: true,
                              },
                              { path: '/app/main_loop.py', exists: true, valid: true },
                          ],
                          missingOrInvalid: [],
                          errors: [],
                      },
                  };
            return [
                'OTTER_BOOTSTRAP_SETUP_API_START',
                JSON.stringify(envelope),
                'OTTER_BOOTSTRAP_SETUP_API_END',
            ].join('\n');
        }

        if (typeof code === 'string' && code.includes('OTTER_BOOTSTRAP_APPLY_API_START')) {
            const envelope = this._bootstrapSetupApplyError
                ? { ok: false, error: this._bootstrapSetupApplyError }
                : {
                      ok: true,
                      payload: this._bootstrapSetupApplyPayload || {
                          schemaVersion: 1,
                          ok: true,
                          results: [
                              { path: '/manifest.json', action: 'updated' },
                              { path: '/device.json', action: 'updated' },
                              {
                                  path: '/device/targets/active_target.json',
                                  action: 'updated',
                              },
                              { path: '/app/main_loop.py', action: 'unchanged' },
                          ],
                          errors: [],
                      },
                  };
            return [
                'OTTER_BOOTSTRAP_APPLY_API_START',
                JSON.stringify(envelope),
                'OTTER_BOOTSTRAP_APPLY_API_END',
            ].join('\n');
        }

        return '';
    }

    setTextFile(path, value) {
        this._textFiles.set(path, value);
    }

    getWrittenTextFile(path) {
        return this._writtenFiles.get(path);
    }

    getWriteCount(path) {
        return this._writeCounts.get(path) || 0;
    }

    setEmbeddedApiPayload(payload) {
        this._embeddedApiPayload = payload;
        this._embeddedApiError = null;
    }

    setEmbeddedApiError(errorMessage) {
        this._embeddedApiError = errorMessage;
    }

    setBootstrapSetupStatusPayload(payload) {
        this._bootstrapSetupStatusPayload = payload;
        this._bootstrapSetupStatusError = null;
    }

    setBootstrapSetupStatusError(errorMessage) {
        this._bootstrapSetupStatusError = errorMessage;
    }

    setBootstrapSetupApplyPayload(payload) {
        this._bootstrapSetupApplyPayload = payload;
        this._bootstrapSetupApplyError = null;
    }

    setBootstrapSetupApplyError(errorMessage) {
        this._bootstrapSetupApplyError = errorMessage;
    }

    getExecutedCodeHistory() {
        return [...this._executedCodeHistory];
    }

    setDeviceInfoData(value) {
        this._deviceInfoData = value;
    }
}

/**
 * Mock CollectionManager
 */
class MockCollectionManager {
    getActiveCollection() {
        return null;
    }
}

/**
 * Mock DeviceRuntimeCollection
 */
class MockRuntimeCollection {
    constructor(runtime = null) {
        this._runtime = runtime;
    }

    getAllRuntimes() {
        return [];
    }

    getRuntime() {
        return this._runtime;
    }
}

/**
 * Mock Transpiler
 */
class MockTranspiler {
    transpile() {
        return { code: '' };
    }
}

/**
 * Mock I18nService
 */
class MockI18nService {
    t(key) {
        return key;
    }
}

/**
 * Mock ViewManager
 */
class MockViewManager {
    constructor() {
        this._formResult = {
            confirmed: true,
            formData: {
                target: 'esp32-test',
                userDescription: '',
            },
        };
    }

    showDialog() {
        return Promise.resolve();
    }

    async showFormDialog() {
        return this._formResult;
    }

    setFormResult(result) {
        this._formResult = result;
    }
}

describe('DeviceDeployment - Step 3: DeviceState Integration', () => {
    let deviceDeployment;
    let mockDeviceConnection;
    let mockCollectionManager;
    let mockRuntimeCollection;
    let mockTranspiler;
    let mockI18nService;
    let mockViewManager;

    beforeEach(() => {
        mockDeviceConnection = new MockDeviceConnection();
        mockCollectionManager = new MockCollectionManager();
        mockRuntimeCollection = new MockRuntimeCollection();
        mockTranspiler = new MockTranspiler();
        mockI18nService = new MockI18nService();
        mockViewManager = new MockViewManager();

        deviceDeployment = new DeviceDeployment({
            deviceConnection: mockDeviceConnection,
            collectionManager: mockCollectionManager,
            runtimeCollection: mockRuntimeCollection,
            transpiler: mockTranspiler,
            i18nService: mockI18nService,
            viewManager: mockViewManager,
        });
    });

    describe('getDeviceState()', () => {
        it('should return DeviceState instance', () => {
            const state = deviceDeployment.getDeviceState();

            assert.ok(state instanceof DeviceState, 'Should return DeviceState instance');
        });

        it('should return immutable DeviceState instance', () => {
            const state = deviceDeployment.getDeviceState();

            // Verify getters are read-only
            assert.throws(() => {
                state.connected = true;
            }, TypeError);
        });

        it('should initialize with default DeviceState values', () => {
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.connected, false);
            assert.equal(state.hasMicroPython, null);
            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.runtimeId, null);
            assert.equal(state.collectionDeployed, false);
        });

        it('should always return same instance reference until updated', () => {
            const state1 = deviceDeployment.getDeviceState();
            const state2 = deviceDeployment.getDeviceState();

            assert.equal(state1, state2);
        });
    });

    describe('_updateDeviceState()', () => {
        it('should create new immutable DeviceState instance', () => {
            const originalState = deviceDeployment.getDeviceState();

            deviceDeployment._updateDeviceState({ connected: true });

            const newState = deviceDeployment.getDeviceState();

            // Should be different instances
            assert.notEqual(originalState, newState);

            // Original should be unchanged
            assert.equal(originalState.connected, false);

            // New should have update
            assert.equal(newState.connected, true);
        });

        it('should preserve unmodified fields', () => {
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeId: 'runtime-1',
            });

            const state = deviceDeployment.getDeviceState();

            assert.equal(state.connected, true);
            assert.equal(state.hasMicroPython, true);
            assert.equal(state.runtimeId, 'runtime-1');

            // Update only one field
            deviceDeployment._updateDeviceState({ connected: false });

            const updatedState = deviceDeployment.getDeviceState();

            // Modified field
            assert.equal(updatedState.connected, false);

            // Preserved fields
            assert.equal(updatedState.hasMicroPython, true);
            assert.equal(updatedState.runtimeId, 'runtime-1');
        });

        it('should emit device-state-changed event with DeviceState instance', (t, done) => {
            deviceDeployment.addEventListener('device-state-changed', (event) => {
                const { state, changedFields, previousState } = event.detail;

                assert.ok(state instanceof DeviceState, 'Event should pass DeviceState instance');
                assert.ok(
                    previousState instanceof DeviceState,
                    'Event should pass previous DeviceState'
                );
                assert.ok(Array.isArray(changedFields), 'Event should include changedFields array');
                assert.ok(
                    changedFields.includes('connected'),
                    'changedFields should include "connected"'
                );

                assert.equal(state.connected, true);
                assert.equal(previousState.connected, false);

                done();
            });

            deviceDeployment._updateDeviceState({ connected: true });
        });

        it('should include changedFields in event detail', (t, done) => {
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
            });

            deviceDeployment.addEventListener('device-state-changed', (event) => {
                const { changedFields } = event.detail;

                assert.ok(changedFields.includes('runtimeId'), 'Should detect runtimeId change');
                assert.ok(
                    changedFields.includes('runtimeName'),
                    'Should detect runtimeName change'
                );
                assert.ok(
                    !changedFields.includes('connected'),
                    'Should not include unchanged fields'
                );

                done();
            });

            deviceDeployment._updateDeviceState({
                runtimeId: 'new-runtime',
                runtimeName: 'New Runtime',
            });
        });

        it('should handle multiple consecutive updates', () => {
            deviceDeployment._updateDeviceState({ connected: true });
            const state1 = deviceDeployment.getDeviceState();

            deviceDeployment._updateDeviceState({ hasMicroPython: true });
            const state2 = deviceDeployment.getDeviceState();

            deviceDeployment._updateDeviceState({ runtimeId: 'runtime-1' });
            const state3 = deviceDeployment.getDeviceState();

            // All should be different instances
            assert.notEqual(state1, state2);
            assert.notEqual(state2, state3);
            assert.notEqual(state1, state3);

            // Final state should have all updates
            assert.equal(state3.connected, true);
            assert.equal(state3.hasMicroPython, true);
            assert.equal(state3.runtimeId, 'runtime-1');
        });
    });

    describe('refreshDeviceInfo()', () => {
        beforeEach(() => {
            // Connect device first
            mockDeviceConnection.connect();
            deviceDeployment._updateDeviceState({ connected: true });
        });

        it('should update state with DeviceState from loadDeviceInfo', async () => {
            await deviceDeployment.refreshDeviceInfo();

            const state = deviceDeployment.getDeviceState();

            assert.ok(state instanceof DeviceState);
            assert.equal(state.runtimeInstalled, true);
            assert.equal(state.runtimeId, 'test-runtime');
            assert.equal(state.runtimeName, 'Test Runtime');
            assert.equal(state.runtimeVersion, '1.0.0');
            assert.equal(state.runtimeDeploymentMode, 'dynamic');
            assert.equal(state.runtimeEmbedded, false);
            assert.equal(state.embeddedPackagesSummary, null);
            assert.equal(state.collectionDeployed, true);
            assert.equal(state.collectionName, 'TestCollection');
            assert.equal(state.collectionVersion, '2.0.0');
        });

        it('should populate firmwareConstituentVersions from firmware info', async () => {
            const constituentVersions = {
                micropythonVersion: '1.27.0',
                runtimeSourceVersion: '1.11.0',
                runtimeFirmwareVersion: '0.1.0',
                deviceToolsVersion: '0.0.0',
                nodePackages: { core: '1.0.1', stdmo: '1.0.0', webview: '1.0.0' },
            };

            mockDeviceConnection.loadDeviceInfo = async function () {
                return DeviceState.fromDeviceInfo({
                    microPythonVersion: '1.27.0',
                    runtime: { id: 'general', name: 'Micro-Otter', version: '1.11.0' },
                    runtimeDeploymentMode: 'dynamic',
                    runtimeEmbedded: false,
                    firmware: {
                        fullVersion: '1.27.0-esp32-general-0.1.0',
                        runtimeFirmwareVersion: '0.1.0',
                        constituentVersions,
                    },
                });
            };

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.firmwareFullVersion, '1.27.0-esp32-general-0.1.0');
            assert.equal(state.runtimeFirmwareVersion, '0.1.0');
            assert.ok(state.firmwareConstituentVersions !== null);
            assert.equal(state.firmwareConstituentVersions.micropythonVersion, '1.27.0');
            assert.equal(state.firmwareConstituentVersions.runtimeSourceVersion, '1.11.0');
            assert.equal(state.firmwareConstituentVersions.runtimeFirmwareVersion, '0.1.0');
            assert.equal(state.firmwareConstituentVersions.deviceToolsVersion, '0.0.0');
            assert.deepEqual(state.firmwareConstituentVersions.nodePackages, {
                core: '1.0.1',
                stdmo: '1.0.0',
                webview: '1.0.0',
            });
        });

        it('should populate allowedWebTargetIds from firmware info', async () => {
            mockDeviceConnection.loadDeviceInfo = async function () {
                return DeviceState.fromDeviceInfo({
                    microPythonVersion: '1.27.0',
                    runtime: { id: 'general', name: 'Micro-Otter', version: '1.11.0' },
                    runtimeDeploymentMode: 'embedded',
                    runtimeEmbedded: true,
                    firmware: {
                        fullVersion: '1.27.0-esp32-general-0.1.0',
                        allowedWebTargetIds: ['esp32_wroom', 'esp32_s3_mini'],
                    },
                });
            };

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.deepEqual(state.allowedWebTargetIds, ['esp32_wroom', 'esp32_s3_mini']);
        });

        it('should keep allowedWebTargetIds empty when firmware info omits it', async () => {
            mockDeviceConnection.loadDeviceInfo = async function () {
                return DeviceState.fromDeviceInfo({
                    microPythonVersion: '1.27.0',
                    runtime: { id: 'general', name: 'Micro-Otter', version: '1.11.0' },
                    runtimeDeploymentMode: 'dynamic',
                    runtimeEmbedded: false,
                    firmware: {
                        fullVersion: '1.27.0-esp32-general-0.1.0',
                    },
                });
            };

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.allowedWebTargetIds, null);
        });

        it('should detect embedded mode from metadata API payload and apply runtime identity', async () => {
            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'embedded-general',
                    name: 'Embedded General Runtime',
                    version: '1.2.3-embedded',
                    description: 'Embedded firmware runtime',
                },
                packagesSummary: {
                    totalPackages: 3,
                    totalFiles: 12,
                    totalBytes: 4096,
                    packages: [{ name: 'pkg.alpha', version: '1.0.0', files: 4, bytes: 1024 }],
                },
                inventory: { schemaVersion: 1, files: [] },
            });
            mockDeviceConnection.setBootstrapSetupStatusPayload({
                schemaVersion: 1,
                ready: false,
                files: [
                    { path: '/manifest.json', exists: true, valid: true },
                    { path: '/device.json', exists: true, valid: true },
                    {
                        path: '/device/targets/active_target.json',
                        exists: false,
                        valid: false,
                        reason: 'missing',
                    },
                    { path: '/app/main_loop.py', exists: true, valid: true },
                ],
                missingOrInvalid: [
                    { path: '/device/targets/active_target.json', reason: 'missing' },
                ],
                errors: [],
            });

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.runtimeDeploymentMode, 'embedded');
            assert.equal(state.runtimeEmbedded, true);
            assert.equal(state.runtimeId, 'embedded-general');
            assert.equal(state.runtimeName, 'Embedded General Runtime');
            assert.equal(state.runtimeVersion, '1.2.3-embedded');
            assert.equal(state.runtimeDescription, 'Embedded firmware runtime');
            assert.equal(state.embeddedPackagesSummary.totalPackages, 3);
            assert.equal(state.embeddedPackagesSummary.totalFiles, 12);
            assert.equal(state.embeddedPackagesSummary.totalBytes, 4096);
            assert.equal(state.bootstrapSetupReady, false);
            assert.equal(state.bootstrapSetupStatus.ready, false);
            assert.equal(state.bootstrapSetupStatus.missingOrInvalid.length, 1);
        });

        it('should fall back to dynamic mode when metadata API is unavailable', async () => {
            mockDeviceConnection.setEmbeddedApiError('module not found');

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.runtimeDeploymentMode, 'dynamic');
            assert.equal(state.runtimeEmbedded, false);
            assert.equal(state.embeddedPackagesSummary, null);
            assert.equal(state.bootstrapSetupReady, null);
            assert.equal(state.bootstrapSetupStatus, null);
            assert.equal(state.runtimeId, 'test-runtime');
            assert.equal(state.runtimeName, 'Test Runtime');
            assert.equal(state.runtimeVersion, '1.0.0');
        });

        it('should keep bootstrap setup status null when setup status API is unavailable', async () => {
            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'embedded-general',
                    name: 'Embedded General Runtime',
                    version: '1.2.3-embedded',
                    description: 'Embedded firmware runtime',
                },
                packagesSummary: {
                    totalPackages: 3,
                    totalFiles: 12,
                    totalBytes: 4096,
                    packages: [],
                },
                inventory: { schemaVersion: 1, files: [] },
            });
            mockDeviceConnection.setBootstrapSetupStatusError('module not found');

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.runtimeDeploymentMode, 'embedded');
            assert.equal(state.bootstrapSetupReady, null);
            assert.equal(state.bootstrapSetupStatus, null);
        });

        it('should preserve connection status when updating from loadDeviceInfo', async () => {
            // DeviceConnection.loadDeviceInfo() always sets connected=true in DeviceState
            // but DeviceDeployment should preserve its own connection tracking

            await deviceDeployment.refreshDeviceInfo();

            const state = deviceDeployment.getDeviceState();

            assert.equal(state.connected, true, 'Should preserve connection status');
        });

        it('should emit device-info-loaded event with DeviceState', async () => {
            let eventEmitted = false;
            let eventDetail = null;

            deviceDeployment.addEventListener('device-info-loaded', (event) => {
                eventEmitted = true;
                eventDetail = event.detail;
                assert.equal(event.detail.payloadTypeId, 'DeviceDeployment.DeviceInfoLoaded.v1');
            });

            await deviceDeployment.refreshDeviceInfo();

            assert.ok(eventEmitted, 'Event should have been emitted');
            assert.ok(eventDetail.state instanceof DeviceState);
            assert.ok(Array.isArray(eventDetail.changedFields));
            assert.equal(typeof eventDetail.hasChanges, 'boolean');
        });

        it('should detect changed fields after refresh', async () => {
            // Set initial state
            deviceDeployment._updateDeviceState({
                runtimeId: 'old-runtime',
                runtimeInstalled: true,
            });

            let eventDetail = null;

            deviceDeployment.addEventListener('device-info-loaded', (event) => {
                eventDetail = event.detail;
            });

            await deviceDeployment.refreshDeviceInfo();

            assert.ok(eventDetail !== null, 'Event should have been emitted');
            assert.equal(eventDetail.hasChanges, true);
            assert.ok(
                eventDetail.changedFields.includes('runtimeId'),
                'Should detect runtimeId change'
            );
        });

        it('should throw if not connected', async () => {
            deviceDeployment._updateDeviceState({ connected: false });

            await assert.rejects(async () => await deviceDeployment.refreshDeviceInfo(), {
                message: 'Device not connected',
            });
        });

        it('should return summary with runtime, collection, target info', async () => {
            const result = await deviceDeployment.refreshDeviceInfo();

            assert.ok(result.runtime !== null);
            assert.equal(result.runtime.id, 'test-runtime');
            assert.equal(result.runtime.name, 'Test Runtime');
            assert.equal(result.runtime.version, '1.0.0');

            assert.ok(result.collection !== null);
            assert.equal(result.collection.name, 'TestCollection');
            assert.equal(result.collection.version, '2.0.0');

            assert.ok(result.target !== null);
            assert.equal(result.target.id, 'esp32-test');
            assert.equal(result.target.displayName, 'ESP32 Test Board');
        });

        it('should handle missing runtime gracefully', async () => {
            // Override loadDeviceInfo to return state without runtime
            mockDeviceConnection.loadDeviceInfo = async function () {
                const info = {
                    microPythonVersion: '1.22.1',
                    target: { id: 'esp32-test' },
                };
                return DeviceState.fromDeviceInfo(info);
            };

            const result = await deviceDeployment.refreshDeviceInfo();

            assert.equal(result.runtime, null);

            const state = deviceDeployment.getDeviceState();
            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.runtimeId, null);
        });

        it('should handle missing collection gracefully', async () => {
            // Override loadDeviceInfo to return state without collection
            mockDeviceConnection.loadDeviceInfo = async function () {
                const info = {
                    microPythonVersion: '1.22.1',
                    runtime: { id: 'test-runtime' },
                    target: { id: 'esp32-test' },
                };
                return DeviceState.fromDeviceInfo(info);
            };

            const result = await deviceDeployment.refreshDeviceInfo();

            assert.equal(result.collection, null);

            const state = deviceDeployment.getDeviceState();
            assert.equal(state.collectionDeployed, false);
            assert.equal(state.collectionName, null);
        });
    });

    describe('embedded metadata consumption via DeviceConnection cache', () => {
        beforeEach(() => {
            mockDeviceConnection.connect();
            deviceDeployment._updateDeviceState({ connected: true });
        });

        it('refreshDeviceInfo consumes embedded runtime metadata from DeviceConnection cache', async () => {
            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'embedded-general',
                    name: 'Embedded General Runtime',
                    version: '1.2.3-embedded',
                    description: 'Embedded firmware runtime',
                },
                packagesSummary: {
                    totalPackages: 2,
                    totalFiles: 5,
                    totalBytes: 1024,
                },
                inventory: {
                    schemaVersion: 1,
                    files: [],
                },
            });

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.runtimeDeploymentMode, 'embedded');
            assert.equal(state.runtimeEmbedded, true);
            assert.equal(state.embeddedPackagesSummary?.totalPackages, 2);
        });

        it('refreshDeviceInfo applies embedded runtime identity from DeviceConnection cache', async () => {
            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'embedded-general',
                    name: 'Embedded General Runtime',
                    version: '1.2.3-embedded',
                    description: 'Embedded firmware runtime',
                },
                packagesSummary: {
                    totalPackages: 3,
                    totalFiles: 12,
                    totalBytes: 4096,
                    packages: [{ name: 'pkg.alpha', version: '1.0.0', files: 4, bytes: 1024 }],
                },
            });

            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();

            assert.equal(state.runtimeDeploymentMode, 'embedded');
            assert.equal(state.runtimeEmbedded, true);
            assert.equal(state.runtimeId, 'embedded-general');
            assert.equal(state.runtimeVersion, '1.2.3-embedded');
            assert.equal(state.embeddedPackagesSummary?.totalPackages, 3);
            assert.equal(state.embeddedPackagesSummary?.totalFiles, 12);
            assert.equal(state.embeddedPackagesSummary?.totalBytes, 4096);
        });

        it('refreshDeviceInfo falls back to dynamic metadata from DeviceConnection cache', async () => {
            mockDeviceConnection.setEmbeddedApiError('module not found');
            await deviceDeployment.refreshDeviceInfo();
            const state = deviceDeployment.getDeviceState();
            assert.equal(state.runtimeDeploymentMode, 'dynamic');
            assert.equal(state.runtimeEmbedded, false);
        });

        it('resolves embedded routing decision from DeviceConnection cache metadata', async () => {
            mockDeviceConnection.setDeviceInfoData({
                runtimeDeploymentMode: 'embedded',
                runtime: { id: 'embedded-general' },
            });

            const decision = await deviceDeployment._resolveRuntimeDeployRoutingDecision();
            assert.equal(decision.mode, 'embedded');
            assert.equal(decision.source, 'api');
        });

        it('falls back to dynamic routing decision when cache mode is missing', async () => {
            mockDeviceConnection.setEmbeddedApiError('module not found');
            mockDeviceConnection.setDeviceInfoData({ runtimeDeploymentMode: null });
            const decision = await deviceDeployment._resolveRuntimeDeployRoutingDecision();
            assert.equal(decision.mode, 'dynamic');
            assert.equal(decision.source, 'fallback');
        });

        it('returns undetermined routing decision when the cache reports unknown mode', async () => {
            mockDeviceConnection.setDeviceInfoData({
                runtimeDeploymentMode: 'unknown',
                runtime: { id: 'general' },
            });

            const decision = await deviceDeployment._resolveRuntimeDeployRoutingDecision();
            assert.equal(decision.mode, 'undetermined');
            assert.equal(decision.source, 'fallback');
        });


        it('uses dynamic routing decision when DeviceConnection cache reports dynamic mode', async () => {
            mockDeviceConnection.setDeviceInfoData({
                runtimeDeploymentMode: 'dynamic',
                runtime: { id: 'general' },
            });

            const decision = await deviceDeployment._resolveRuntimeDeployRoutingDecision();
            assert.equal(decision.mode, 'dynamic');
            assert.equal(decision.source, 'api');
        });
    });

    describe('Immutability Verification', () => {
        it('should not allow direct state modification through getDeviceState', () => {
            const state = deviceDeployment.getDeviceState();

            assert.throws(() => {
                state.connected = true;
            }, TypeError);

            assert.throws(() => {
                state.runtimeId = 'hacked';
            }, TypeError);
        });

        it('should maintain separate state instances across updates', () => {
            const states = [];

            for (let i = 0; i < 5; i++) {
                deviceDeployment._updateDeviceState({ runtimeId: `runtime-${i}` });
                states.push(deviceDeployment.getDeviceState());
            }

            // All should be different instances
            for (let i = 0; i < states.length; i++) {
                for (let j = i + 1; j < states.length; j++) {
                    assert.notEqual(states[i], states[j]);
                }
            }

            // Each should have its own value
            for (let i = 0; i < states.length; i++) {
                assert.equal(states[i].runtimeId, `runtime-${i}`);
            }
        });
    });

    describe('Event Integration', () => {
        it('should emit events with DeviceState instances for all updates', (t, done) => {
            let eventCount = 0;
            const expectedUpdates = 3;

            deviceDeployment.addEventListener('device-state-changed', (event) => {
                eventCount++;

                assert.ok(event.detail.state instanceof DeviceState);
                assert.ok(event.detail.previousState instanceof DeviceState);
                assert.ok(Array.isArray(event.detail.changedFields));

                if (eventCount === expectedUpdates) {
                    done();
                }
            });

            deviceDeployment._updateDeviceState({ connected: true });
            deviceDeployment._updateDeviceState({ hasMicroPython: true });
            deviceDeployment._updateDeviceState({ runtimeId: 'runtime-1' });
        });
    });

    describe('Collection deployment migration coverage', () => {
        it('deployCollection does not invoke DeviceConnection.loadDeviceInfo fallback read path', async () => {
            let loadDeviceInfoCalls = 0;
            mockDeviceConnection.loadDeviceInfo = async function () {
                loadDeviceInfoCalls += 1;
                throw new Error('Unexpected secondary read path invocation');
            };

            deviceDeployment._updateDeviceState({
                connected: true,
                runtimeInstalled: false,
                runtimeId: null,
                deviceTargetInfo: {
                    id: 'esp32-test',
                    displayName: 'ESP32 Test Board',
                    getPinsForCapability() {
                        return [12, 13];
                    },
                },
            });

            mockDeviceConnection.setDeviceInfoData({
                runtime: {
                    id: 'general',
                    name: 'General Runtime',
                    version: '1.0.0',
                    targetId: 'esp32-test',
                },
                target: {
                    id: 'esp32-test',
                    displayName: 'ESP32 Test Board',
                },
            });

            deviceDeployment._collectionDeployment.deployCollection = async () => 2;

            await deviceDeployment.deployCollection(createCollectionForDeployment());

            assert.equal(loadDeviceInfoCalls, 0);
        });

        it('listInstalledRuntime returns null without calling DeviceConnection.loadDeviceInfo', async () => {
            let loadDeviceInfoCalls = 0;
            mockDeviceConnection.loadDeviceInfo = async function () {
                loadDeviceInfoCalls += 1;
                throw new Error('Unexpected secondary read path invocation');
            };

            deviceDeployment._updateDeviceState({ connected: true, runtimeInstalled: false });
            mockDeviceConnection.setDeviceInfoData(null);

            const runtime = await deviceDeployment.listInstalledRuntime();

            assert.equal(runtime, null);
            assert.equal(loadDeviceInfoCalls, 0);
        });

        it('deployCollection adopts runtime from DeviceConnection cached device info', async () => {
            let emittedPayloadTypeId = null;

            deviceDeployment.addEventListener('collection-deployed', (event) => {
                emittedPayloadTypeId = event.detail.payloadTypeId;
            });

            deviceDeployment._updateDeviceState({
                connected: true,
                runtimeInstalled: false,
                runtimeId: null,
                deviceTargetInfo: {
                    id: 'esp32-test',
                    displayName: 'ESP32 Test Board',
                    getPinsForCapability() {
                        return [12, 13];
                    },
                },
            });

            mockDeviceConnection.setDeviceInfoData({
                runtime: {
                    id: 'general',
                    name: 'General Runtime',
                    version: '1.0.0',
                    targetId: 'esp32-test',
                },
                target: {
                    id: 'esp32-test',
                    displayName: 'ESP32 Test Board',
                },
            });

            deviceDeployment._collectionDeployment.deployCollection = async () => 2;

            const filesUploaded = await deviceDeployment.deployCollection(
                createCollectionForDeployment()
            );

            assert.equal(filesUploaded, 2);
            assert.equal(deviceDeployment.getDeviceState().runtimeInstalled, true);
            assert.equal(deviceDeployment.getDeviceState().runtimeId, 'general');
            assert.equal(emittedPayloadTypeId, 'DeviceDeployment.CollectionDeployed.v1');
        });

        it('validateCollectionCompatibility reports missing required capabilities', async () => {
            const runtimeWithCapabilityRequirements = {
                getNodeType(nodeTypeId) {
                    if (nodeTypeId !== 'servo') {
                        return null;
                    }
                    return { requiredCapabilities: ['pwm.output'] };
                },
                getDeviceTarget() {
                    return { id: 'esp32-test', displayName: 'ESP32 Test Board' };
                },
            };

            deviceDeployment._runtimeCollection = new MockRuntimeCollection(
                runtimeWithCapabilityRequirements
            );
            deviceDeployment._updateDeviceState({
                connected: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                deviceTargetInfo: {
                    id: 'esp32-test',
                    displayName: 'ESP32 Test Board',
                    getPinsForCapability() {
                        return [];
                    },
                },
            });

            const result = await deviceDeployment.validateCollectionCompatibility(
                createCollectionForDeployment()
            );

            assert.equal(result.compatible, false);
            assert.ok(result.errors.some((error) => error.includes('pwm.output')));
        });

        it('validateNodePackages reports missing node type in runtime', () => {
            const runtimeWithoutServoNode = {
                getNodeType() {
                    return null;
                },
            };

            deviceDeployment._runtimeCollection = new MockRuntimeCollection(
                runtimeWithoutServoNode
            );

            const result = deviceDeployment.validateNodePackages(createCollectionForDeployment());

            assert.equal(result.compatible, false);
            assert.ok(result.errors.some((error) => error.includes('Node type not found: servo')));
        });

        it('routes embedded runtime upgrade through firmware bootstrap setup API', async () => {
            mockDeviceConnection.connect();

            const embeddedRuntime = {
                id: 'general',
                name: 'General Runtime',
                version: '1.0.0',
                description: 'Embedded runtime',
                target: { id: 'esp32-test' },
            };

            deviceDeployment._runtimeCollection = new MockRuntimeCollection(embeddedRuntime);
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                runtimeVersion: '1.0.0',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
            });

            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'general',
                    name: 'General Runtime',
                    version: '1.0.0',
                    description: 'Embedded runtime',
                },
                packagesSummary: { totalPackages: 1, totalFiles: 2, totalBytes: 512 },
                inventory: { schemaVersion: 1, files: [] },
            });
            mockDeviceConnection.setBootstrapSetupStatusPayload({
                schemaVersion: 1,
                ready: true,
                files: [
                    { path: '/manifest.json', exists: true, valid: true },
                    { path: '/device.json', exists: true, valid: true },
                    { path: '/device/targets/active_target.json', exists: true, valid: true },
                    { path: '/app/main_loop.py', exists: true, valid: true },
                ],
                missingOrInvalid: [],
                errors: [],
            });
            mockDeviceConnection.setBootstrapSetupApplyPayload({
                schemaVersion: 1,
                ok: true,
                results: [
                    { path: '/manifest.json', action: 'updated' },
                    { path: '/device.json', action: 'updated' },
                    { path: '/device/targets/active_target.json', action: 'created' },
                    { path: '/app/main_loop.py', action: 'unchanged' },
                ],
                errors: [],
            });

            let delegatedUpgradeCalled = false;
            deviceDeployment._runtimeDeployment.upgradeRuntime = async () => {
                delegatedUpgradeCalled = true;
            };

            let compatibilityPayloadType = null;
            deviceDeployment.addEventListener(
                'runtime-embedded-compatibility-deployed',
                (event) => {
                    compatibilityPayloadType = event.detail.payloadTypeId;
                }
            );

            await deviceDeployment.upgradeRuntime('general', { preserveCollection: true });

            assert.equal(delegatedUpgradeCalled, false);
            assert.equal(mockDeviceConnection.getWriteCount('/manifest.json'), 0);
            assert.equal(mockDeviceConnection.getWriteCount('/device.json'), 0);
            assert.equal(mockDeviceConnection.getWriteCount('/main.py'), 0);
            assert.equal(
                compatibilityPayloadType,
                'DeviceDeployment.RuntimeEmbeddedCompatibilityDeployed.v1'
            );
            assert.equal(deviceDeployment.getDeviceState().runtimeDeploymentMode, 'embedded');
            assert.equal(deviceDeployment.getDeviceState().runtimeEmbedded, true);
            assert.equal(deviceDeployment.getDeviceState().bootstrapSetupReady, true);
        });

        it('sends no target metadata to the embedded bootstrap setup apply API', async () => {
            mockDeviceConnection.connect();

            const embeddedRuntime = {
                id: 'general',
                name: 'General Runtime',
                version: '1.0.0',
                description: 'Embedded runtime',
                target: {
                    id: 'esp32_wroom',
                    compile: { board: 'esp32', port: 'esp32' },
                    mappingRuleId: 'esp32-default',
                    mappingSource: 'compile_target_mappings.json',
                    mappingConfidence: 'exact',
                },
            };

            deviceDeployment._runtimeCollection = new MockRuntimeCollection(embeddedRuntime);
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                runtimeVersion: '1.0.0',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                deviceTargetInfo: {
                    id: 'esp32_wroom',
                    displayName: 'ESP32-WROOM',
                    description: 'ESP32 target',
                    metadata: { configVersion: 1 },
                    capabilityToPins: { 'pwm.output': [18, 19] },
                },
            });

            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'general',
                    name: 'General Runtime',
                    version: '1.0.0',
                    description: 'Embedded runtime',
                },
                packagesSummary: { totalPackages: 1, totalFiles: 2, totalBytes: 512 },
                inventory: { schemaVersion: 1, files: [] },
            });
            mockDeviceConnection.setBootstrapSetupStatusPayload({
                schemaVersion: 1,
                ready: true,
                files: [
                    { path: '/manifest.json', exists: true, valid: true },
                    { path: '/device.json', exists: true, valid: true },
                    { path: '/device/targets/active_target.json', exists: true, valid: true },
                    { path: '/app/main_loop.py', exists: true, valid: true },
                ],
                missingOrInvalid: [],
                errors: [],
            });
            mockDeviceConnection.setBootstrapSetupApplyPayload({
                schemaVersion: 1,
                ok: true,
                results: [
                    { path: '/manifest.json', action: 'updated' },
                    { path: '/device.json', action: 'updated' },
                    { path: '/device/targets/active_target.json', action: 'updated' },
                    { path: '/app/main_loop.py', action: 'unchanged' },
                ],
                errors: [],
            });

            await deviceDeployment.upgradeRuntime('general', { preserveCollection: true });

            const applyCallCode = mockDeviceConnection
                .getExecutedCodeHistory()
                .find((entry) => entry.includes('OTTER_BOOTSTRAP_APPLY_API_START'));

            assert.ok(applyCallCode);
            assert.ok(applyCallCode.includes('apply_bootstrap_setup(_options)'));
            assert.equal(applyCallCode.includes('targetMetadata'), false);

            const optionsLiteral = applyCallCode.match(/_options = (\{.*\})/);
            assert.ok(optionsLiteral);
            assert.deepEqual(JSON.parse(optionsLiteral[1]), { force: false });
        });

        it('does not use host target prompt path during API-only embedded bootstrap', async () => {
            mockDeviceConnection.connect();

            const embeddedRuntime = {
                id: 'general',
                name: 'General Runtime',
                version: '1.0.0',
                description: 'Embedded runtime',
                target: { id: 'esp32-test' },
            };

            deviceDeployment._runtimeCollection = new MockRuntimeCollection(embeddedRuntime);
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: false,
                runtimeId: 'general',
                runtimeVersion: '1.0.0',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
                deviceTargetInfo: null,
            });

            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'general',
                    name: 'General Runtime',
                    version: '1.0.0',
                    description: 'Embedded runtime',
                },
                packagesSummary: { totalPackages: 1, totalFiles: 2, totalBytes: 512 },
                inventory: { schemaVersion: 1, files: [] },
            });
            mockDeviceConnection.setBootstrapSetupApplyPayload({
                schemaVersion: 1,
                ok: true,
                results: [
                    { path: '/manifest.json', action: 'updated' },
                    { path: '/device.json', action: 'updated' },
                    { path: '/device/targets/active_target.json', action: 'created' },
                    { path: '/app/main_loop.py', action: 'unchanged' },
                ],
                errors: [],
            });
            mockDeviceConnection.setBootstrapSetupStatusPayload({
                schemaVersion: 1,
                ready: true,
                files: [
                    { path: '/manifest.json', exists: true, valid: true },
                    { path: '/device.json', exists: true, valid: true },
                    { path: '/device/targets/active_target.json', exists: true, valid: true },
                    { path: '/app/main_loop.py', exists: true, valid: true },
                ],
                missingOrInvalid: [],
                errors: [],
            });

            deviceDeployment._promptTargetSelection = async () => {
                throw new Error('Host target prompt must not be used');
            };

            await deviceDeployment.upgradeRuntime('general', { preserveCollection: true });

            assert.equal(
                mockDeviceConnection.getWriteCount('/device/targets/active_target.json'),
                0
            );
            assert.equal(deviceDeployment.getDeviceState().bootstrapSetupReady, true);
        });

        it('surfaces setup API errors and aborts embedded bootstrap upgrade', async () => {
            const embeddedRuntime = {
                id: 'general',
                name: 'General Runtime',
                version: '1.0.0',
                description: 'Embedded runtime',
                target: { id: 'esp32-test' },
            };

            deviceDeployment._runtimeCollection = new MockRuntimeCollection(embeddedRuntime);
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                runtimeVersion: '1.0.0',
                runtimeEmbedded: true,
                runtimeDeploymentMode: 'embedded',
            });

            mockDeviceConnection.setEmbeddedApiPayload({
                runtime: {
                    mode: 'embedded',
                    id: 'general',
                    name: 'General Runtime',
                    version: '1.0.0',
                    description: 'Embedded runtime',
                },
                packagesSummary: { totalPackages: 1, totalFiles: 2, totalBytes: 512 },
                inventory: { schemaVersion: 1, files: [] },
            });

            mockDeviceConnection.setBootstrapSetupApplyPayload({
                schemaVersion: 1,
                ok: false,
                results: [{ path: '/manifest.json', action: 'error', reason: 'write-failed' }],
                errors: [
                    {
                        category: 'filesystem',
                        message: 'write failed',
                        path: '/manifest.json',
                    },
                ],
            });

            await assert.rejects(
                async () =>
                    await deviceDeployment.upgradeRuntime('general', { preserveCollection: true }),
                {
                    message: /write failed/,
                }
            );
            assert.equal(mockDeviceConnection.getWriteCount('/manifest.json'), 0);
            assert.equal(mockDeviceConnection.getWriteCount('/device.json'), 0);
            assert.equal(mockDeviceConnection.getWriteCount('/main.py'), 0);
        });

        it('keeps dynamic mode runtime upgrade delegation unchanged', async () => {
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
                runtimeId: 'general',
                runtimeVersion: '1.0.0',
                runtimeEmbedded: false,
                runtimeDeploymentMode: 'dynamic',
            });

            mockDeviceConnection.setEmbeddedApiError('module not found');

            deviceDeployment._resolveMpyCompileProfile = async () => ({
                hash: 'v6',
                probe: { mpyAbi: 6 },
            });
            deviceDeployment._resolveMpyAvailabilityReport = async () => ({ available: true });
            deviceDeployment._resolveMpyFallbackDecision = async () => 'use-source';
            deviceDeployment._applyMpyFallbackDecision = (report) => report;

            let delegatedArgs = null;
            deviceDeployment._runtimeDeployment.upgradeRuntime = async (runtimeId, options) => {
                delegatedArgs = { runtimeId, options };
            };

            await deviceDeployment.upgradeRuntime('general', { preserveCollection: true });

            assert.ok(delegatedArgs);
            assert.equal(delegatedArgs.runtimeId, 'general');
            assert.equal(delegatedArgs.options.preserveCollection, true);
            assert.equal(delegatedArgs.options.mpyCompileProfile.hash, 'v6');
            assert.deepEqual(delegatedArgs.options.mpyAvailability, { available: true });
            assert.equal(mockDeviceConnection.getWriteCount('/manifest.json'), 0);
            assert.equal(mockDeviceConnection.getWriteCount('/device.json'), 0);
            assert.equal(mockDeviceConnection.getWriteCount('/main.py'), 0);
        });
    });
});

function createCollectionForDeployment() {
    return {
        getId() {
            return 'collection-1';
        },
        getTitle() {
            return 'Test Collection';
        },
        getTargetId() {
            return 'esp32-test';
        },
        getDeviceRuntimeId() {
            return 'general';
        },
        getGraphArray() {
            return [
                {
                    getNodes() {
                        return [{ id: 'node-1', type: 'servo' }];
                    },
                },
            ];
        },
    };
}
