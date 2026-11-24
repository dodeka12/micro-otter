// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Unit tests for DeviceDeployment class - Phase 1
 *
 * Tests cover:
 * - Device state management
 * - MicroPython detection
 * - File operations (upload, download, delete, list)
 * - Connection event handling
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

describe('DeviceDeployment - Phase 1', () => {
    let deviceDeployment;
    let mockDeviceConnection;
    let mockCollectionManager;
    let mockTranspiler;
    let mockI18nService;

    beforeEach(() => {
        // Create mocks
        mockDeviceConnection = createMockDeviceConnection();
        mockCollectionManager = createMockCollectionManager();
        mockTranspiler = createMockTranspiler();
        mockI18nService = createMockI18nService();

        // Create instance
        deviceDeployment = new DeviceDeployment({
            deviceConnection: mockDeviceConnection,
            collectionManager: mockCollectionManager,
            transpiler: mockTranspiler,
            i18nService: mockI18nService,
            logger: console.log,
        });
    });

    afterEach(() => {
        deviceDeployment.destroy();
    });

    describe('Device State Management', () => {
        it('should initialize with disconnected state', () => {
            const state = deviceDeployment.getDeviceState();
            assert.ok(state instanceof DeviceState);
            assert.equal(state.connected, false);
            assert.equal(state.hasMicroPython, null);
            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.runtimeVersion, null);
            assert.equal(state.runtimeId, null);
            assert.equal(state.collectionDeployed, false);
            assert.equal(state.collectionName, null);
            assert.equal(state.collectionVersion, null);
            assert.equal(state.deviceTargetInfo, null);
        });

        it('should update state and emit event', (t, done) => {
            deviceDeployment.addEventListener('device-state-changed', (event) => {
                assert.equal(event.detail.payloadTypeId, 'DeviceDeployment.DeviceStateChanged.v1');
                assert.ok(event.detail.state instanceof DeviceState);
                assert.equal(event.detail.state.connected, true);
                assert.ok(event.detail.changedFields.includes('connected'));
                assert.equal(event.detail.previousState.connected, false);
                done();
            });

            deviceDeployment._updateDeviceState({ connected: true });
        });

        it('should provide immutable state instance', () => {
            const state = deviceDeployment.getDeviceState();
            assert.throws(() => {
                state.connected = true;
            }, TypeError);
        });

        it('should emit changes with previous and current state', (t, done) => {
            deviceDeployment._updateDeviceState({ runtimeInstalled: true });

            deviceDeployment.addEventListener('device-state-changed', (event) => {
                assert.equal(event.detail.previousState.runtimeInstalled, true);
                assert.equal(event.detail.state.runtimeInstalled, false);
                assert.ok(event.detail.changedFields.includes('runtimeInstalled'));
                done();
            });

            deviceDeployment._updateDeviceState({ runtimeInstalled: false });
        });
    });

    describe('Connection State Queries', () => {
        it('should return false for isConnected() initially', () => {
            assert.equal(deviceDeployment.isConnected(), false);
        });

        it('should return true for isConnected() when connected', () => {
            mockDeviceConnection.setState('connected');
            assert.equal(deviceDeployment.isConnected(), true);
        });

        it('should return null for hasMicroPython() initially', () => {
            assert.equal(deviceDeployment.hasMicroPython(), null);
        });

        it('should return true for hasMicroPython() when detected', () => {
            deviceDeployment._updateDeviceState({ hasMicroPython: true });
            assert.equal(deviceDeployment.hasMicroPython(), true);
        });

        it('should return false for hasMicroPython() when not detected', () => {
            deviceDeployment._updateDeviceState({ hasMicroPython: false });
            assert.equal(deviceDeployment.hasMicroPython(), false);
        });
    });

    describe('MicroPython Detection', () => {
        it('should detect MicroPython successfully', async () => {
            mockDeviceConnection.executeCode = async (code) => {
                if (code.includes('print(1+1)')) {
                    return '2';
                }
                return '3.4.0; MicroPython v1.20.0 on 2023-04-26';
            };

            deviceDeployment._updateDeviceState({ connected: true });

            const detected = await deviceDeployment.detectMicroPython();

            assert.equal(detected, true);
            assert.equal(deviceDeployment.hasMicroPython(), true);
            assert.equal(deviceDeployment.getMicroPythonVersion(), '3.4.0');
        });

        it('should handle missing REPL prompt', async () => {
            mockDeviceConnection.executeCode = async () => {
                throw new Error('No response');
            };

            deviceDeployment._updateDeviceState({ connected: true });

            const detected = await deviceDeployment.detectMicroPython();

            assert.equal(detected, false);
            assert.equal(deviceDeployment.hasMicroPython(), false);
        });

        it('should mark version as unknown when parsing fails', async () => {
            mockDeviceConnection.executeCode = async (code) => {
                if (code.includes('print(1+1)')) {
                    return '2';
                }
                return 'No version info';
            };

            deviceDeployment._updateDeviceState({ connected: true });

            const detected = await deviceDeployment.detectMicroPython();

            assert.equal(detected, true);
            assert.equal(deviceDeployment.hasMicroPython(), true);
            assert.equal(deviceDeployment.getMicroPythonVersion(), 'unknown');
        });

        it('should handle version detection failure', async () => {
            mockDeviceConnection.executeCode = async (code) => {
                if (code.includes('print(1+1)')) {
                    return '2';
                }
                throw new Error('Version query failed');
            };

            deviceDeployment._updateDeviceState({ connected: true });

            const detected = await deviceDeployment.detectMicroPython();

            assert.equal(detected, true);
            assert.equal(deviceDeployment.hasMicroPython(), true);
            assert.equal(deviceDeployment.getMicroPythonVersion(), null);
        });

        it('should throw if device not connected', async () => {
            await assert.rejects(async () => await deviceDeployment.detectMicroPython(), {
                message: 'Device not connected',
            });
        });

        it('should handle REPL check errors gracefully', async () => {
            mockDeviceConnection.executeCode = async () => {
                throw new Error('Connection lost');
            };

            deviceDeployment._updateDeviceState({ connected: true });

            const detected = await deviceDeployment.detectMicroPython();

            assert.equal(detected, false);
        });
    });

    describe('Connection Events', () => {
        it('should handle device connect event', async () => {
            // Mock MicroPython detection to succeed
            mockDeviceConnection.sendControlC = async () => {};
            mockDeviceConnection.waitForPrompt = async () => '>>> ';
            mockDeviceConnection.executeCode = async () => 'MicroPython v1.20.0';
            deviceDeployment.refreshDeviceInfo = async () => {};
            mockDeviceConnection.setState('connected');

            const connectEvent = new CustomEvent('statechange', {
                detail: { state: 'connected', previousState: 'disconnected', port: 'COM3' },
            });

            await deviceDeployment._handleDeviceConnect(connectEvent);

            assert.equal(deviceDeployment.isConnected(), true);
            assert.equal(deviceDeployment.hasMicroPython(), true);
        });

        it('should handle device disconnect event', () => {
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
                runtimeVersion: '1.0.0',
            });

            const disconnectEvent = new CustomEvent('statechange', {
                detail: { state: 'disconnected', previousState: 'connected' },
            });

            deviceDeployment._handleDeviceDisconnect(disconnectEvent);

            const state = deviceDeployment.getDeviceState();
            assert.equal(state.connected, false);
            assert.equal(state.hasMicroPython, null);
            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.runtimeVersion, null);
        });

        it('should handle disconnect statechange after error transition', () => {
            deviceDeployment._updateDeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
            });

            const stateChangeListener = mockDeviceConnection.listeners.statechange[0];
            assert.ok(stateChangeListener);

            stateChangeListener({
                detail: { state: 'disconnected', previousState: 'error' },
            });

            const state = deviceDeployment.getDeviceState();
            assert.equal(state.connected, false);
            assert.equal(state.hasMicroPython, null);
            assert.equal(state.runtimeInstalled, false);
        });
    });

    describe('Event Listener Management', () => {
        it('should set up listeners on construction', () => {
            // Verify listeners were added
            assert.ok(mockDeviceConnection.listeners.statechange.length > 0);
        });
    });
});

// ============================================================================
// Mock Factory Functions
// ============================================================================

function createMockDeviceConnection() {
    let connectionState = 'disconnected';
    const listeners = {
        statechange: [],
    };

    return {
        listeners, // Expose for testing
        setState: (state) => {
            connectionState = state;
        },
        get connected() {
            return connectionState === 'connected';
        },
        isConnected: () => connectionState === 'connected',
        getState: () => connectionState,
        addEventListener: (event, handler) => {
            if (listeners[event]) {
                listeners[event].push(handler);
            }
        },
        removeEventListener: (event, handler) => {
            if (listeners[event]) {
                const index = listeners[event].indexOf(handler);
                if (index > -1) {
                    listeners[event].splice(index, 1);
                }
            }
        },
        sendControlC: async () => {},
        waitForPrompt: async () => '>>> ',
        executeCode: async () => '2',
        uploadFile: async () => {},
        downloadFile: async () => '',
    };
}

function createMockCollectionManager() {
    return {
        transpileCollection: async () => ({
            code: 'print("Generated code")',
            assets: { packages: {} },
        }),
    };
}

function createMockTranspiler() {
    return {};
}

function createMockI18nService() {
    return {
        t: (key) => key,
    };
}

// ---------------------------------------------------------------------------
// Collection deploy options: `force` and `overrideFirmwarePackages` are
// independent inputs. The first skips the hash diff, the second asks for a
// shadow upload of every in-use firmware-bundled package.
// ---------------------------------------------------------------------------

describe('DeviceDeployment — embedded override option threading', () => {
    /**
     * Build a deployment whose device talks to nothing; only the option flow is under test.
     * @returns {DeviceDeployment} Deployment under test
     */
    function makeDeployment() {
        return new DeviceDeployment({
            deviceConnection: createMockDeviceConnection(),
            collectionManager: createMockCollectionManager(),
            runtimeCollection: { getRuntime: () => null },
            transpiler: createMockTranspiler(),
            i18nService: createMockI18nService(),
            viewManager: {},
        });
    }

    /**
     * Skip the parts of `deployCollection` that talk to the device.
     * @param {DeviceDeployment} deployment - Deployment to patch
     */
    function stubPreflight(deployment) {
        deployment._runDeployInitializationPreflight = async () => {};
        deployment._validateTargetCompatibility = () => {};
        deployment._resolveRuntimeDeployRoutingDecision = async () => ({
            mode: 'embedded',
            source: 'api',
        });
        deployment._resolveMpyCompileProfile = async () => ({ hash: 'h', probe: { mpyAbi: 6 } });
        deployment._resolveMpyAvailabilityReport = async () => ({ available: true });
        deployment._resolveMpyFallbackDecision = async () => 'use-source';
        deployment._applyMpyFallbackDecision = (report) => report;
    }

    /**
     * Minimal collection mock accepted by `deployCollection`.
     * @returns {object} Collection mock
     */
    function makeCollection() {
        return {
            getId: () => 'col-1',
            getTitle: () => 'Collection',
            getTargetId: () => 'generic_micropython',
            getDeviceRuntimeId: () => 'general',
            getGraphArray: () => [{ getNodes: () => [] }],
        };
    }

    it('forwards overrideFirmwarePackages as a forced shadow request', async () => {
        const deployment = makeDeployment();
        stubPreflight(deployment);
        deployment._updateDeviceState({ runtimeId: 'general', runtimeInstalled: true });

        let gateOptions = null;
        deployment._resolveEmbeddedSourceOverrides = async (_collection, options) => {
            gateOptions = options;
            return ['otter_vars/store.py'];
        };
        let received = null;
        deployment._collectionDeployment.deployCollection = async (_collection, options) => {
            received = options;
            return 1;
        };

        await deployment.deployCollection(makeCollection(), {
            overrideFirmwarePackages: true,
            force: true,
        });

        assert.deepEqual(gateOptions, { forceShadow: true });
        assert.deepEqual(received.embeddedLibraryOverridePaths, ['otter_vars/store.py']);
        assert.equal(received.embeddedOverrideMode, 'forced');
        assert.equal(received.force, true, 'force keeps its own meaning');
    });

    it('does not request a shadow when forceUpload is set on its own', async () => {
        const deployment = makeDeployment();
        stubPreflight(deployment);
        deployment._updateDeviceState({ runtimeId: 'general', runtimeInstalled: true });

        let gateOptions = null;
        deployment._resolveEmbeddedSourceOverrides = async (_collection, options) => {
            gateOptions = options;
            return [];
        };
        let received = null;
        deployment._collectionDeployment.deployCollection = async (_collection, options) => {
            received = options;
            return 1;
        };

        await deployment.deployCollection(makeCollection(), { force: true });

        assert.deepEqual(gateOptions, { forceShadow: false });
        assert.equal(
            'embeddedOverrideMode' in received,
            false,
            'force alone never marks the run as a forced shadow'
        );
        assert.equal(received.force, true);
    });
});
