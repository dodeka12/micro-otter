// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

/**
 * Mock DeviceConnection for testing loadDeviceInfo() return type
 * 
 * This mock simulates the loadDeviceInfo() method to verify it returns DeviceState.
 * We don't test the full connection logic here, just the return type contract.
 */
class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this._connected = false;
        this._deviceInfo = null;
    }

    _ensureConnected() {
        if (!this._connected) {
            throw new Error('Device not connected');
        }
    }

    async connect() {
        this._connected = true;
    }

    async disconnect() {
        this._connected = false;
    }

    /**
     * Simulates loadDeviceInfo() with mock data
     * @returns {Promise<DeviceState>} Device state as reported to the UI
     */
    async loadDeviceInfo() {
        this._ensureConnected();

        const info = {
            microPythonVersion: '1.22.1',
            runtime: {
                id: 'test-runtime',
                name: 'Test Runtime',
                version: '1.0.0',
                description: 'Mock runtime for testing',
                customView: null,
            },
            target: {
                id: 'esp32-test',
                displayName: 'ESP32 Test',
            },
            collection: {
                name: 'TestCollection',
                version: '2.0.0',
            },
        };

        this._deviceInfo = info;

        // Create DeviceState instance from loaded info (as per Step 2)
        const deviceState = DeviceState.fromDeviceInfo(info);

        this.dispatchEvent(new CustomEvent('device-info-loaded', { detail: info }));

        return deviceState;
    }
}

describe('DeviceConnection - loadDeviceInfo() Step 2 Integration', () => {
    let deviceConnection;

    beforeEach(async () => {
        deviceConnection = new MockDeviceConnection();
        await deviceConnection.connect();
    });

    describe('loadDeviceInfo()', () => {
        it('should return DeviceState instance', async () => {
            const result = await deviceConnection.loadDeviceInfo();

            assert.ok(result instanceof DeviceState, 'Result should be DeviceState instance');
        });

        it('should return DeviceState with all fields populated correctly', async () => {
            const state = await deviceConnection.loadDeviceInfo();

            // Verify connection and MicroPython info
            assert.equal(state.connected, true);
            assert.equal(state.hasMicroPython, true);
            assert.equal(state.micropythonVersion, '1.22.1');

            // Verify runtime info
            assert.equal(state.runtimeInstalled, true);
            assert.equal(state.runtimeId, 'test-runtime');
            assert.equal(state.runtimeName, 'Test Runtime');
            assert.equal(state.runtimeVersion, '1.0.0');
            assert.equal(state.runtimeDescription, 'Mock runtime for testing');

            // Verify target info
            assert.ok(state.deviceTargetInfo !== null);
            assert.deepEqual(state.deviceTargetInfo, {
                id: 'esp32-test',
                displayName: 'ESP32 Test',
            });

            // Verify collection info
            assert.equal(state.collectionDeployed, true);
            assert.equal(state.collectionName, 'TestCollection');
            assert.equal(state.collectionVersion, '2.0.0');
        });

        it('should handle missing runtime', async () => {
            // Create custom mock for this test
            const customMock = new MockDeviceConnection();
            await customMock.connect();
            
            // Override loadDeviceInfo to return info without runtime
            customMock.loadDeviceInfo = async function() {
                this._ensureConnected();
                const info = {
                    microPythonVersion: '1.22.1',
                    target: { id: 'esp32-test' },
                };
                return DeviceState.fromDeviceInfo(info);
            };

            const state = await customMock.loadDeviceInfo();

            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.runtimeId, null);
            assert.equal(state.runtimeName, null);
        });

        it('should handle missing collection', async () => {
            // Create custom mock for this test
            const customMock = new MockDeviceConnection();
            await customMock.connect();
            
            // Override loadDeviceInfo to return info without collection
            customMock.loadDeviceInfo = async function() {
                this._ensureConnected();
                const info = {
                    microPythonVersion: '1.22.1',
                    runtime: { id: 'test-runtime' },
                    target: { id: 'esp32-test' },
                };
                return DeviceState.fromDeviceInfo(info);
            };

            const state = await customMock.loadDeviceInfo();

            assert.equal(state.collectionDeployed, false);
            assert.equal(state.collectionName, null);
            assert.equal(state.collectionVersion, null);
        });

        it('should handle missing target', async () => {
            // Create custom mock for this test
            const customMock = new MockDeviceConnection();
            await customMock.connect();
            
            // Override loadDeviceInfo to return info without target
            customMock.loadDeviceInfo = async function() {
                this._ensureConnected();
                const info = {
                    microPythonVersion: '1.22.1',
                    runtime: { id: 'test-runtime' },
                };
                return DeviceState.fromDeviceInfo(info);
            };

            const state = await customMock.loadDeviceInfo();

            assert.equal(state.deviceTargetInfo, null);
        });

        it('should throw if not connected', async () => {
            await deviceConnection.disconnect();

            await assert.rejects(
                async () => await deviceConnection.loadDeviceInfo(),
                { message: 'Device not connected' }
            );
        });

        it('should return instance that is ready for deployment when requirements met', async () => {
            const state = await deviceConnection.loadDeviceInfo();

            assert.equal(state.isReadyForDeployment(), true);
        });

        it('should return immutable DeviceState instance', async () => {
            const state = await deviceConnection.loadDeviceInfo();

            // Verify getters are read-only
            assert.throws(() => {
                state.connected = false;
            }, TypeError);

            assert.throws(() => {
                state.runtimeId = 'modified';
            }, TypeError);
        });

        it('should emit device-info-loaded event with original info object', async () => {
            let eventDetail = null;

            deviceConnection.addEventListener('device-info-loaded', (event) => {
                eventDetail = event.detail;
            });

            await deviceConnection.loadDeviceInfo();

            assert.ok(eventDetail !== null, 'Event should be emitted');
            assert.equal(eventDetail.microPythonVersion, '1.22.1');
            assert.equal(eventDetail.runtime.id, 'test-runtime');
        });
    });
});
