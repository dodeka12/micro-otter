// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

describe('DeviceState', () => {
    describe('constructor', () => {
        it('should create instance with default values when no data provided', () => {
            const state = new DeviceState();

            assert.equal(state.connected, false);
            assert.equal(state.hasMicroPython, null);
            assert.equal(state.micropythonVersion, null);
            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.runtimeId, null);
            assert.equal(state.runtimeName, null);
            assert.equal(state.runtimeVersion, null);
            assert.equal(state.firmwareFullVersion, null);
            assert.equal(state.runtimeFirmwareVersion, null);
            assert.equal(state.firmwareConstituentVersions, null);
            assert.equal(state.runtimeDescription, null);
            assert.equal(state.runtimeCustomView, null);
            assert.equal(state.runtimeDeploymentMode, 'dynamic');
            assert.equal(state.runtimeEmbedded, false);
            assert.equal(state.embeddedPackagesSummary, null);
            assert.equal(state.effectiveInventorySummary, null);
            assert.equal(state.bootstrapSetupReady, null);
            assert.equal(state.bootstrapSetupStatus, null);
            assert.equal(state.deviceTargetInfo, null);
            assert.equal(state.collectionDeployed, false);
            assert.equal(state.collectionName, null);
            assert.equal(state.collectionVersion, null);
            assert.equal(state.collectionHasFullDefinition, false);
            assert.equal(state.deviceInfoLoading, false);
            assert.equal(state.deviceInfoLoadError, null);
            assert.ok(typeof state.lastUpdated === 'number');
        });

        it('should create instance with provided data', () => {
            const now = Date.now();
            const targetInfo = { id: 'esp32-test' };

            const state = new DeviceState({
                connected: true,
                hasMicroPython: true,
                micropythonVersion: '1.22.1',
                runtimeInstalled: true,
                runtimeId: 'test-runtime',
                runtimeName: 'Test Runtime',
                runtimeVersion: '1.0.0',
                firmwareFullVersion: '1.24.0-esp32-general-0.3.0',
                runtimeFirmwareVersion: '0.3.0',
                firmwareConstituentVersions: {
                    runtimeSourceVersion: '1.11.0',
                    deviceToolsVersion: '1.2.0',
                },
                runtimeDescription: 'A test runtime',
                runtimeCustomView: 'custom-view.html',
                runtimeDeploymentMode: 'embedded',
                runtimeEmbedded: true,
                embeddedPackagesSummary: {
                    totalPackages: 1,
                    totalFiles: 2,
                    totalBytes: 128,
                    packages: [{ name: 'pkg.alpha', version: '1.0.0', files: 2, bytes: 128 }],
                },
                effectiveInventorySummary: {
                    totalEntries: 5,
                    embeddedEntries: 3,
                    dynamicEntries: 2,
                    overriddenEntries: 1,
                },
                bootstrapSetupReady: false,
                bootstrapSetupStatus: {
                    schemaVersion: 1,
                    ready: false,
                    files: [],
                    missingOrInvalid: [{ path: '/device.json', reason: 'missing' }],
                    errors: [],
                },
                deviceTargetInfo: targetInfo,
                collectionDeployed: true,
                collectionName: 'TestCollection',
                collectionVersion: '2.0.0',
                collectionHasFullDefinition: true,
                deviceInfoLoading: true,
                deviceInfoLoadError: 'Test error',
                lastUpdated: now,
            });

            assert.equal(state.connected, true);
            assert.equal(state.hasMicroPython, true);
            assert.equal(state.micropythonVersion, '1.22.1');
            assert.equal(state.runtimeInstalled, true);
            assert.equal(state.runtimeId, 'test-runtime');
            assert.equal(state.runtimeName, 'Test Runtime');
            assert.equal(state.runtimeVersion, '1.0.0');
            assert.equal(state.firmwareFullVersion, '1.24.0-esp32-general-0.3.0');
            assert.equal(state.runtimeFirmwareVersion, '0.3.0');
            assert.equal(state.firmwareConstituentVersions.runtimeSourceVersion, '1.11.0');
            assert.equal(state.runtimeDescription, 'A test runtime');
            assert.equal(state.runtimeCustomView, 'custom-view.html');
            assert.equal(state.runtimeDeploymentMode, 'embedded');
            assert.equal(state.runtimeEmbedded, true);
            assert.equal(state.embeddedPackagesSummary.totalPackages, 1);
            assert.equal(state.effectiveInventorySummary.totalEntries, 5);
            assert.equal(state.bootstrapSetupReady, false);
            assert.equal(state.bootstrapSetupStatus.schemaVersion, 1);
            assert.equal(state.deviceTargetInfo, targetInfo);
            assert.equal(state.collectionDeployed, true);
            assert.equal(state.collectionName, 'TestCollection');
            assert.equal(state.collectionVersion, '2.0.0');
            assert.equal(state.collectionHasFullDefinition, true);
            assert.equal(state.deviceInfoLoading, true);
            assert.equal(state.deviceInfoLoadError, 'Test error');
            assert.equal(state.lastUpdated, now);
        });

        it('should create instance with partial data', () => {
            const state = new DeviceState({
                connected: true,
                runtimeId: 'runtime-123',
                collectionName: 'MyCollection',
            });

            assert.equal(state.connected, true);
            assert.equal(state.runtimeId, 'runtime-123');
            assert.equal(state.collectionName, 'MyCollection');
            // Verify defaults for unspecified fields
            assert.equal(state.hasMicroPython, null);
            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.collectionDeployed, false);
            assert.equal(state.runtimeDeploymentMode, 'dynamic');
            assert.equal(state.runtimeEmbedded, false);
        });
    });

    describe('getters', () => {
        it('should provide read-only access to all fields', () => {
            const state = new DeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeId: 'test-runtime',
            });

            // Verify getters work
            assert.equal(state.connected, true);
            assert.equal(state.hasMicroPython, true);
            assert.equal(state.runtimeId, 'test-runtime');

            // Verify properties are read-only (cannot be set)
            assert.throws(() => {
                state.connected = false;
            }, TypeError);
        });
    });

    describe('update()', () => {
        it('should create new instance with updated fields', () => {
            const original = new DeviceState({
                connected: false,
                runtimeId: null,
            });

            const updated = original.update({
                connected: true,
                runtimeId: 'new-runtime',
            });

            // Verify new instance has updated values
            assert.equal(updated.connected, true);
            assert.equal(updated.runtimeId, 'new-runtime');

            // Verify original is unchanged
            assert.equal(original.connected, false);
            assert.equal(original.runtimeId, null);

            // Verify they are different instances
            assert.notEqual(original, updated);
        });

        it('should preserve unspecified fields', () => {
            const original = new DeviceState({
                connected: true,
                runtimeId: 'original-runtime',
                runtimeName: 'Original Name',
                collectionName: 'Original Collection',
            });

            const updated = original.update({
                connected: false,
            });

            assert.equal(updated.connected, false);
            assert.equal(updated.runtimeId, 'original-runtime');
            assert.equal(updated.runtimeName, 'Original Name');
            assert.equal(updated.collectionName, 'Original Collection');
            assert.equal(updated.runtimeDeploymentMode, 'dynamic');
        });

        it('should update lastUpdated timestamp', () => {
            const original = new DeviceState();
            const originalTimestamp = original.lastUpdated;

            // Wait a tiny bit to ensure timestamp differs
            const updated = original.update({ connected: true });

            assert.ok(updated.lastUpdated >= originalTimestamp);
        });

        it('should allow updating to null values', () => {
            const original = new DeviceState({
                runtimeId: 'test-runtime',
                collectionName: 'test-collection',
            });

            const updated = original.update({
                runtimeId: null,
                collectionName: null,
            });

            assert.equal(updated.runtimeId, null);
            assert.equal(updated.collectionName, null);
        });
    });

    describe('fromDeviceInfo()', () => {
        it('should create state from complete device info', () => {
            const deviceInfo = {
                microPythonVersion: '1.22.1',
                runtime: {
                    id: 'runtime-1',
                    name: 'Test Runtime',
                    version: '1.0.0',
                    description: 'Test description',
                    customView: 'test-view.html',
                },
                firmware: {
                    fullVersion: '1.24.0-esp32-general-0.3.0',
                    runtimeFirmwareVersion: '0.3.0',
                    constituentVersions: {
                        runtimeSourceVersion: '1.11.0',
                    },
                },
                target: { id: 'esp32-test' },
                collection: {
                    name: 'TestCollection',
                    version: '2.0.0',
                },
            };

            const state = DeviceState.fromDeviceInfo(deviceInfo);

            assert.equal(state.connected, true);
            assert.equal(state.hasMicroPython, true);
            assert.equal(state.micropythonVersion, '1.22.1');
            assert.equal(state.runtimeInstalled, true);
            assert.equal(state.runtimeId, 'runtime-1');
            assert.equal(state.runtimeName, 'Test Runtime');
            assert.equal(state.runtimeVersion, '1.0.0');
            assert.equal(state.firmwareFullVersion, '1.24.0-esp32-general-0.3.0');
            assert.equal(state.runtimeFirmwareVersion, '0.3.0');
            assert.equal(state.firmwareConstituentVersions.runtimeSourceVersion, '1.11.0');
            assert.equal(state.runtimeDescription, 'Test description');
            assert.equal(state.runtimeCustomView, 'test-view.html');
            assert.equal(state.runtimeDeploymentMode, 'dynamic');
            assert.equal(state.runtimeEmbedded, false);
            assert.equal(state.embeddedPackagesSummary, null);
            assert.equal(state.effectiveInventorySummary, null);
            assert.deepEqual(state.deviceTargetInfo, { id: 'esp32-test' });
            assert.equal(state.collectionDeployed, true);
            assert.equal(state.collectionName, 'TestCollection');
            assert.equal(state.collectionVersion, '2.0.0');
            assert.equal(state.collectionHasFullDefinition, false);
        });

        it('should include hasFullDefinition when present in collection info', () => {
            const deviceInfo = {
                microPythonVersion: '1.22.1',
                runtime: {
                    id: 'runtime-1',
                    name: 'Test Runtime',
                    version: '1.0.0',
                },
                target: { id: 'esp32-test' },
                collection: {
                    name: 'TestCollection',
                    version: '2.0.0',
                    hasFullDefinition: true,
                },
            };

            const state = DeviceState.fromDeviceInfo(deviceInfo);

            assert.equal(state.collectionDeployed, true);
            assert.equal(state.collectionName, 'TestCollection');
            assert.equal(state.collectionVersion, '2.0.0');
            assert.equal(state.collectionHasFullDefinition, true);
        });

        it('should default hasFullDefinition to false when not present', () => {
            const deviceInfo = {
                microPythonVersion: '1.22.1',
                runtime: { id: 'runtime-1' },
                target: { id: 'esp32-test' },
                collection: {
                    name: 'TestCollection',
                    version: '2.0.0',
                    // hasFullDefinition not specified
                },
            };

            const state = DeviceState.fromDeviceInfo(deviceInfo);

            assert.equal(state.collectionHasFullDefinition, false);
        });

        it('should handle missing runtime', () => {
            const deviceInfo = {
                microPythonVersion: '1.22.1',
                target: { id: 'esp32-test' },
            };

            const state = DeviceState.fromDeviceInfo(deviceInfo);

            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.runtimeId, null);
            assert.equal(state.runtimeName, null);
            assert.equal(state.runtimeVersion, null);
            assert.equal(state.runtimeDescription, null);
            assert.equal(state.runtimeCustomView, null);
        });

        it('should handle missing collection', () => {
            const deviceInfo = {
                microPythonVersion: '1.22.1',
                runtime: { id: 'runtime-1' },
                target: { id: 'esp32-test' },
            };

            const state = DeviceState.fromDeviceInfo(deviceInfo);

            assert.equal(state.collectionDeployed, false);
            assert.equal(state.collectionName, null);
            assert.equal(state.collectionVersion, null);
        });

        it('should handle missing target', () => {
            const deviceInfo = {
                microPythonVersion: '1.22.1',
                runtime: { id: 'runtime-1' },
            };

            const state = DeviceState.fromDeviceInfo(deviceInfo);

            assert.equal(state.deviceTargetInfo, null);
        });

        it('should handle empty device info', () => {
            const state = DeviceState.fromDeviceInfo({});

            assert.equal(state.connected, true);
            assert.equal(state.hasMicroPython, true);
            assert.equal(state.micropythonVersion, null);
            assert.equal(state.runtimeInstalled, false);
            assert.equal(state.collectionDeployed, false);
            assert.equal(state.deviceTargetInfo, null);
        });

        it('should handle partial runtime info', () => {
            const deviceInfo = {
                runtime: {
                    id: 'runtime-1',
                    // Missing other fields
                },
            };

            const state = DeviceState.fromDeviceInfo(deviceInfo);

            assert.equal(state.runtimeInstalled, true);
            assert.equal(state.runtimeId, 'runtime-1');
            assert.equal(state.runtimeName, null);
            assert.equal(state.runtimeVersion, null);
        });
    });

    describe('toObject()', () => {
        it('should return plain object with all fields', () => {
            const targetInfo = { id: 'esp32-test' };
            const state = new DeviceState({
                connected: true,
                hasMicroPython: true,
                micropythonVersion: '1.22.1',
                runtimeId: 'runtime-1',
                deviceTargetInfo: targetInfo,
                collectionName: 'TestCollection',
            });

            const obj = state.toObject();

            assert.equal(typeof obj, 'object');
            assert.equal(obj.connected, true);
            assert.equal(obj.hasMicroPython, true);
            assert.equal(obj.micropythonVersion, '1.22.1');
            assert.equal(obj.runtimeId, 'runtime-1');
            assert.equal(obj.firmwareFullVersion, null);
            assert.equal(obj.runtimeFirmwareVersion, null);
            assert.equal(obj.firmwareConstituentVersions, null);
            assert.equal(obj.runtimeDeploymentMode, 'dynamic');
            assert.equal(obj.runtimeEmbedded, false);
            assert.equal(obj.embeddedPackagesSummary, null);
            assert.equal(obj.effectiveInventorySummary, null);
            assert.equal(obj.bootstrapSetupReady, null);
            assert.equal(obj.bootstrapSetupStatus, null);
            assert.equal(obj.deviceTargetInfo, targetInfo);
            assert.equal(obj.collectionName, 'TestCollection');
        });

        it('should return object suitable for spreading in update()', () => {
            const original = new DeviceState({
                connected: true,
                runtimeId: 'runtime-1',
            });

            const obj = original.toObject();
            const updated = new DeviceState({
                ...obj,
                connected: false,
            });

            assert.equal(updated.connected, false);
            assert.equal(updated.runtimeId, 'runtime-1');
        });
    });

    describe('toJSON()', () => {
        it('should return JSON-serializable object', () => {
            const state = new DeviceState({
                connected: true,
                hasMicroPython: true,
                micropythonVersion: '1.22.1',
                runtimeId: 'runtime-1',
                collectionName: 'TestCollection',
            });

            const json = state.toJSON();

            assert.equal(typeof json, 'object');
            assert.equal(json.connected, true);
            assert.equal(json.hasMicroPython, true);
            assert.equal(json.micropythonVersion, '1.22.1');
            assert.equal(json.runtimeId, 'runtime-1');
            assert.equal(json.runtimeDeploymentMode, 'dynamic');
            assert.equal(json.runtimeEmbedded, false);
            assert.equal(json.embeddedPackagesSummary, null);
            assert.equal(json.effectiveInventorySummary, null);
            assert.equal(json.bootstrapSetupReady, null);
            assert.equal(json.bootstrapSetupStatus, null);
            assert.equal(json.collectionName, 'TestCollection');

            // Verify it can be stringified
            const jsonString = JSON.stringify(json);
            assert.ok(typeof jsonString === 'string');
        });

        it('should handle deviceTargetInfo with toJSON method', () => {
            const targetInfo = {
                id: 'esp32-test',
                toJSON() {
                    return { id: this.id, serialized: true };
                },
            };

            const state = new DeviceState({
                deviceTargetInfo: targetInfo,
            });

            const json = state.toJSON();

            assert.deepEqual(json.deviceTargetInfo, { id: 'esp32-test', serialized: true });
        });

        it('should handle deviceTargetInfo without toJSON method', () => {
            const targetInfo = { id: 'esp32-test', data: 'value' };

            const state = new DeviceState({
                deviceTargetInfo: targetInfo,
            });

            const json = state.toJSON();

            assert.deepEqual(json.deviceTargetInfo, targetInfo);
        });

        it('should handle null deviceTargetInfo', () => {
            const state = new DeviceState();

            const json = state.toJSON();

            assert.equal(json.deviceTargetInfo, null);
        });
    });

    describe('getChangedFields()', () => {
        it('should detect single field change', () => {
            const state1 = new DeviceState({ connected: false });
            const state2 = new DeviceState({ connected: true });

            const changed = state2.getChangedFields(state1);

            assert.ok(changed.includes('connected'));
            assert.equal(changed.filter((f) => f === 'connected').length, 1);
        });

        it('should detect multiple field changes', () => {
            const state1 = new DeviceState({
                connected: false,
                runtimeId: null,
                collectionName: null,
            });

            const state2 = new DeviceState({
                connected: true,
                runtimeId: 'runtime-1',
                collectionName: 'TestCollection',
            });

            const changed = state2.getChangedFields(state1);

            assert.ok(changed.includes('connected'));
            assert.ok(changed.includes('runtimeId'));
            assert.ok(changed.includes('collectionName'));
        });

        it('should detect all connection-related changes', () => {
            const state1 = new DeviceState({
                connected: false,
                hasMicroPython: null,
                micropythonVersion: null,
            });

            const state2 = new DeviceState({
                connected: true,
                hasMicroPython: true,
                micropythonVersion: '1.22.1',
            });

            const changed = state2.getChangedFields(state1);

            assert.ok(changed.includes('connected'));
            assert.ok(changed.includes('hasMicroPython'));
            assert.ok(changed.includes('micropythonVersion'));
        });

        it('should detect all runtime-related changes', () => {
            const state1 = new DeviceState();
            const state2 = new DeviceState({
                runtimeInstalled: true,
                runtimeId: 'runtime-1',
                runtimeName: 'Test Runtime',
                runtimeVersion: '1.0.0',
                runtimeDescription: 'Description',
                runtimeCustomView: 'view.html',
                runtimeDeploymentMode: 'embedded',
                runtimeEmbedded: true,
                embeddedPackagesSummary: { totalPackages: 1, totalFiles: 2, totalBytes: 3 },
                effectiveInventorySummary: {
                    totalEntries: 10,
                    embeddedEntries: 4,
                    dynamicEntries: 6,
                    overriddenEntries: 2,
                },
                bootstrapSetupReady: true,
                bootstrapSetupStatus: {
                    schemaVersion: 1,
                    ready: true,
                    files: [],
                    missingOrInvalid: [],
                    errors: [],
                },
            });

            const changed = state2.getChangedFields(state1);

            assert.ok(changed.includes('runtimeInstalled'));
            assert.ok(changed.includes('runtimeId'));
            assert.ok(changed.includes('runtimeName'));
            assert.ok(changed.includes('runtimeVersion'));
            assert.ok(changed.includes('runtimeDescription'));
            assert.ok(changed.includes('runtimeCustomView'));
            assert.ok(changed.includes('runtimeDeploymentMode'));
            assert.ok(changed.includes('runtimeEmbedded'));
            assert.ok(changed.includes('embeddedPackagesSummary'));
            assert.ok(changed.includes('effectiveInventorySummary'));
            assert.ok(changed.includes('bootstrapSetupReady'));
            assert.ok(changed.includes('bootstrapSetupStatus'));
        });

        it('should detect all collection-related changes', () => {
            const state1 = new DeviceState();
            const state2 = new DeviceState({
                collectionDeployed: true,
                collectionName: 'TestCollection',
                collectionVersion: '2.0.0',
            });

            const changed = state2.getChangedFields(state1);

            assert.ok(changed.includes('collectionDeployed'));
            assert.ok(changed.includes('collectionName'));
            assert.ok(changed.includes('collectionVersion'));
        });

        it('should detect loading state changes', () => {
            const state1 = new DeviceState();
            const state2 = new DeviceState({
                deviceInfoLoading: true,
                deviceInfoLoadError: 'Error message',
            });

            const changed = state2.getChangedFields(state1);

            assert.ok(changed.includes('deviceInfoLoading'));
            assert.ok(changed.includes('deviceInfoLoadError'));
        });

        it('should detect target info changes', () => {
            const target1 = { id: 'target-1' };
            const target2 = { id: 'target-2' };

            const state1 = new DeviceState({ deviceTargetInfo: target1 });
            const state2 = new DeviceState({ deviceTargetInfo: target2 });

            const changed = state2.getChangedFields(state1);

            assert.ok(changed.includes('deviceTargetInfo'));
        });

        it('should return empty array when nothing changed', () => {
            const state1 = new DeviceState({
                connected: true,
                runtimeId: 'runtime-1',
                collectionName: 'TestCollection',
            });

            const state2 = new DeviceState({
                connected: true,
                runtimeId: 'runtime-1',
                collectionName: 'TestCollection',
            });

            const changed = state2.getChangedFields(state1);

            assert.equal(changed.length, 0);
        });

        it('should only include changed fields', () => {
            const state1 = new DeviceState({
                connected: true,
                runtimeId: 'runtime-1',
                collectionName: 'TestCollection',
            });

            const state2 = new DeviceState({
                connected: true,
                runtimeId: 'runtime-2',
                collectionName: 'TestCollection',
            });

            const changed = state2.getChangedFields(state1);

            assert.equal(changed.length, 1);
            assert.ok(changed.includes('runtimeId'));
            assert.ok(!changed.includes('connected'));
            assert.ok(!changed.includes('collectionName'));
        });
    });

    describe('isReadyForDeployment()', () => {
        it('should return true when all requirements met', () => {
            const state = new DeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
            });

            assert.equal(state.isReadyForDeployment(), true);
        });

        it('should return false when not connected', () => {
            const state = new DeviceState({
                connected: false,
                hasMicroPython: true,
                runtimeInstalled: true,
            });

            assert.equal(state.isReadyForDeployment(), false);
        });

        it('should return false when hasMicroPython is null', () => {
            const state = new DeviceState({
                connected: true,
                hasMicroPython: null,
                runtimeInstalled: true,
            });

            assert.equal(state.isReadyForDeployment(), false);
        });

        it('should return false when hasMicroPython is false', () => {
            const state = new DeviceState({
                connected: true,
                hasMicroPython: false,
                runtimeInstalled: true,
            });

            assert.equal(state.isReadyForDeployment(), false);
        });

        it('should return false when runtime not installed', () => {
            const state = new DeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: false,
            });

            assert.equal(state.isReadyForDeployment(), false);
        });

        it('should return false when no requirements met', () => {
            const state = new DeviceState();

            assert.equal(state.isReadyForDeployment(), false);
        });

        it('should not require collection to be deployed', () => {
            const state = new DeviceState({
                connected: true,
                hasMicroPython: true,
                runtimeInstalled: true,
                collectionDeployed: false,
            });

            assert.equal(state.isReadyForDeployment(), true);
        });
    });

    describe('immutability', () => {
        it('should not allow direct property modification', () => {
            const state = new DeviceState({ connected: false });

            assert.throws(() => {
                state.connected = true;
            }, TypeError);
        });

        it('should preserve original when update() is called', () => {
            const original = new DeviceState({
                connected: false,
                runtimeId: 'original',
                collectionName: 'OriginalCollection',
            });

            const originalConnected = original.connected;
            const originalRuntimeId = original.runtimeId;
            const originalCollectionName = original.collectionName;

            original.update({
                connected: true,
                runtimeId: 'updated',
                collectionName: 'UpdatedCollection',
            });

            // Verify original is unchanged
            assert.equal(original.connected, originalConnected);
            assert.equal(original.runtimeId, originalRuntimeId);
            assert.equal(original.collectionName, originalCollectionName);
        });

        it('should create independent instances', () => {
            const state1 = new DeviceState({ connected: true });
            const state2 = state1.update({ runtimeId: 'runtime-1' });
            const state3 = state2.update({ collectionName: 'Collection' });

            // Each should be independent
            assert.equal(state1.runtimeId, null);
            assert.equal(state1.collectionName, null);

            assert.equal(state2.connected, true);
            assert.equal(state2.runtimeId, 'runtime-1');
            assert.equal(state2.collectionName, null);

            assert.equal(state3.connected, true);
            assert.equal(state3.runtimeId, 'runtime-1');
            assert.equal(state3.collectionName, 'Collection');
        });
    });
});
