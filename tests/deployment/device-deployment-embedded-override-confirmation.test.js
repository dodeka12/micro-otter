// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for the embedded source override consent gate in DeviceDeployment:
// exactly one confirmation per deploy, an opt-in "remember for this version"
// approval, and the fail-closed path when no dialog API exists.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    DeviceDeployment,
    EmbeddedSourceOverrideDeclinedError,
} from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';

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
    /**
     * Encode key and parameters into the returned string for easy assertions.
     * @param {string} key - Translation key
     * @param {object} [params] - Interpolation parameters
     * @returns {string} Encoded translation
     */
    t(key, params = {}) {
        const paramStr = Object.keys(params).length
            ? ':' +
              Object.entries(params)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(',')
            : '';
        return key + paramStr;
    }
}

/**
 * View-manager mock that records every confirmation call.
 * @param {object} [answers] - Answers to return from the dialog
 * @param {boolean} [answers.confirmed] - Confirmation answer
 * @param {boolean} [answers.checkboxChecked] - Checkbox answer
 * @returns {object} View-manager mock exposing the recorded calls
 */
function makeViewManagerMock(answers = {}) {
    const calls = [];
    return {
        calls,
        async showFormDialog() {
            return { confirmed: false };
        },
        async showConfirmationWithCheckbox(options) {
            calls.push(options);
            return {
                confirmed: answers.confirmed !== false,
                checkboxChecked: answers.checkboxChecked === true,
            };
        },
    };
}

function makeRuntime({ hostVersion = '0.20.0' } = {}) {
    return {
        getNodeType() {
            return null;
        },
        nodePackagesGlobal: ['vars'],
        nodePackages: [
            {
                id: 'vars',
                manifest: { version: hostVersion },
                mpAssets: {
                    '*': [
                        '/device/node_pkgs/vars/otter_vars/__init__.py',
                        '/device/node_pkgs/vars/otter_vars/store.py',
                    ],
                    'array-generate': ['/device/node_pkgs/vars/otter_vars/array.py'],
                },
            },
        ],
    };
}

/**
 * Skip the parts of deployCollection/syncCollectionFiles that talk to the device.
 * @param {DeviceDeployment} deployment - Deployment to patch
 */
function stubDeployPreflight(deployment) {
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
 * Apply the device state of an embedded device whose firmware bundles `vars` at a given version.
 * @param {DeviceDeployment} deployment - Deployment to patch
 * @param {string|null} deviceVersion - Firmware `vars` version (null = unknown)
 */
function applyEmbeddedDeviceState(deployment, deviceVersion) {
    deployment._updateDeviceState({
        runtimeId: 'general',
        runtimeInstalled: true,
        runtimeEmbedded: true,
        runtimeDeploymentMode: 'embedded',
        embeddedPackagesSummary:
            deviceVersion === null
                ? null
                : {
                      totalPackages: 1,
                      totalFiles: 2,
                      totalBytes: 100,
                      packages: [{ name: 'vars', version: deviceVersion }],
                  },
        firmwareConstituentVersions: null,
    });
}

/**
 * Build a DeviceDeployment whose device state reports an outdated firmware `vars` package.
 * @param {object} [opts] - Mock configuration
 * @param {object|null} [opts.viewManager] - View-manager mock; `undefined` uses a confirming mock
 * @param {number} [opts.hostVersion] - Host `vars` version
 * @param {string|null} [opts.deviceVersion] - Firmware `vars` version (null = unknown)
 * @returns {DeviceDeployment} Deployment under test
 */
function makeDeployment({
    viewManager = makeViewManagerMock(),
    hostVersion = '0.20.0',
    deviceVersion = '0.19.0',
} = {}) {
    const runtime = makeRuntime({ hostVersion });
    const deployment = new DeviceDeployment({
        deviceConnection: new MockDeviceConnection(),
        collectionManager: new MockCollectionManager(),
        runtimeCollection: { getRuntime: () => runtime },
        transpiler: new MockTranspiler(),
        i18nService: new MockI18nService(),
        viewManager: viewManager || {},
    });

    applyEmbeddedDeviceState(deployment, deviceVersion);

    stubDeployPreflight(deployment);
    return deployment;
}

function makeCollection(nodeTypes = ['vars.array-generate']) {
    return {
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
                        return nodeTypes.map((type, index) => ({ id: `n${index}`, type }));
                    },
                },
            ];
        },
    };
}

/**
 * Replace the collection deployment with a recorder.
 * @param {DeviceDeployment} deployment - Deployment to patch
 * @returns {Array<object>} Recorded option objects of delegated calls
 */
function recordDelegation(deployment) {
    const received = [];
    deployment._collectionDeployment.deployCollection = async (_collection, options) => {
        received.push(options);
        return 3;
    };
    deployment._collectionDeployment.syncCollectionFiles = async (_collection, options) => {
        received.push(options);
        return 3;
    };
    return received;
}

const expectedOverridePaths = [
    'otter_vars/__init__.py',
    'otter_vars/array.py',
    'otter_vars/store.py',
];



describe('DeviceDeployment — embedded source override consent gate', () => {
    it('prompts once and forwards the complete override path list', async () => {
        const viewManager = makeViewManagerMock();
        const deployment = makeDeployment({ viewManager });
        const received = recordDelegation(deployment);

        const uploaded = await deployment.deployCollection(makeCollection());

        assert.equal(uploaded, 3);
        assert.equal(viewManager.calls.length, 1);

        const dialog = viewManager.calls[0];
        assert.ok(String(dialog.title).startsWith('deployment.embeddedOverrideTitle'));
        assert.ok(String(dialog.message).includes('fileCount=3'));
        assert.ok(dialog.table, 'the outdated packages must be listed in a table');
        assert.deepEqual(
            dialog.table.rows.map((row) => row.cells.map((cell) => cell.text)),
            [['vars', '0.19.0', '0.20.0']]
        );
        assert.equal(dialog.checkboxLabel, 'deployment.embeddedOverrideRemember');
        assert.equal(dialog.checkboxChecked, false);
        assert.deepEqual(received[0].embeddedLibraryOverridePaths, expectedOverridePaths);
    });

    it('declining aborts the deploy without delegating', async () => {
        const viewManager = makeViewManagerMock({ confirmed: false });
        const deployment = makeDeployment({ viewManager });
        const received = recordDelegation(deployment);

        await assert.rejects(
            () => deployment.deployCollection(makeCollection()),
            (error) => {
                assert.ok(error instanceof EmbeddedSourceOverrideDeclinedError);
                assert.equal(error.code, 'EMBEDDED_SOURCE_OVERRIDE_DECLINED');
                assert.deepEqual(error.packageIds, ['vars']);
                return true;
            }
        );

        assert.equal(received.length, 0, 'no upload may happen after a decline');
    });

    it('does not prompt when the firmware is up to date', async () => {
        const viewManager = makeViewManagerMock();
        const deployment = makeDeployment({ viewManager, deviceVersion: '0.21.0' });
        const received = recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());

        assert.equal(viewManager.calls.length, 0);
        assert.deepEqual(received[0].embeddedLibraryOverridePaths, []);
    });

    it('prompts and shadows when no version information is available', async () => {
        const viewManager = makeViewManagerMock();
        const deployment = makeDeployment({ viewManager, deviceVersion: null });
        const received = recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());

        assert.equal(viewManager.calls.length, 1, 'the shadow upload must still be consented to');
        const dialog = viewManager.calls[0];
        assert.ok(String(dialog.message).includes('fileCount=3'));
        assert.ok(dialog.table, 'the outdated packages must be listed in a table');
        assert.deepEqual(
            dialog.table.rows.map((row) => row.cells.map((cell) => cell.text)),
            [['vars', 'deployment.embeddedOverrideVersionUnknown', '0.20.0']]
        );
        assert.deepEqual(received[0].embeddedLibraryOverridePaths, expectedOverridePaths);
    });

    it('fails closed when no confirmation API is available', async () => {
        const deployment = makeDeployment({ viewManager: {} });
        const received = recordDelegation(deployment);

        await assert.rejects(
            () => deployment.deployCollection(makeCollection()),
            /confirmation dialog unavailable/
        );

        assert.equal(received.length, 0);
    });

    it('skips the dialog for the same versions after "remember" was ticked', async () => {
        const viewManager = makeViewManagerMock({ checkboxChecked: true });
        const deployment = makeDeployment({ viewManager });
        const received = recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());
        await deployment.deployCollection(makeCollection());

        assert.equal(viewManager.calls.length, 1, 'second deploy must reuse the approval');
        assert.equal(received.length, 2);
        assert.deepEqual(received[1].embeddedLibraryOverridePaths, expectedOverridePaths);
    });

    it('asks again when the checkbox was not ticked', async () => {
        const viewManager = makeViewManagerMock({ checkboxChecked: false });
        const deployment = makeDeployment({ viewManager });
        recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());
        await deployment.deployCollection(makeCollection());

        assert.equal(viewManager.calls.length, 2);
    });

    it('never remembers a decline', async () => {
        const viewManager = makeViewManagerMock({ confirmed: false, checkboxChecked: true });
        const deployment = makeDeployment({ viewManager });
        recordDelegation(deployment);

        await assert.rejects(() => deployment.deployCollection(makeCollection()));
        await assert.rejects(() => deployment.deployCollection(makeCollection()));

        assert.equal(viewManager.calls.length, 2);
    });

    it('asks again when the host version changes', async () => {
        const viewManager = makeViewManagerMock({ checkboxChecked: true });
        const deployment = makeDeployment({ viewManager });
        recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());
        deployment._runtimeCollection.getRuntime = () => makeRuntime({ hostVersion: '0.21.0' });
        await deployment.deployCollection(makeCollection());

        assert.equal(viewManager.calls.length, 2, 'a new host version must ask again');
    });

    it('forgets remembered approvals when the device disconnects', async () => {
        const viewManager = makeViewManagerMock({ checkboxChecked: true });
        const deployment = makeDeployment({ viewManager });
        recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());
        deployment._handleDeviceDisconnect({ detail: {} });
        // The disconnect also clears the device state; restore it as a reconnect would.
        applyEmbeddedDeviceState(deployment, '0.19.0');
        await deployment.deployCollection(makeCollection());

        assert.equal(viewManager.calls.length, 2);
    });

    it('forgets remembered approvals when the device reconnects', async () => {
        const viewManager = makeViewManagerMock({ checkboxChecked: true });
        const deployment = makeDeployment({ viewManager });
        recordDelegation(deployment);
        deployment.detectMicroPython = async () => {};

        await deployment.deployCollection(makeCollection());
        await deployment._handleDeviceConnect({ detail: {} });
        await deployment.deployCollection(makeCollection());

        assert.equal(viewManager.calls.length, 2);
    });

    it('gates through showConfirmation when the checkbox API is unavailable', async () => {
        const calls = [];
        const viewManager = {
            async showFormDialog() {
                return { confirmed: false };
            },
            async showConfirmation(options) {
                calls.push(options);
                return true;
            },
        };
        const deployment = makeDeployment({ viewManager });
        const received = recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());
        await deployment.deployCollection(makeCollection());

        assert.equal(calls.length, 2, 'a plain confirmation can never memoise');
        assert.equal(
            Object.prototype.hasOwnProperty.call(calls[0], 'checkboxLabel'),
            false,
            'no checkbox is offered without the richer API'
        );
        assert.deepEqual(received[1].embeddedLibraryOverridePaths, expectedOverridePaths);
    });

    it('applies the same gate to syncCollectionFiles', async () => {
        const viewManager = makeViewManagerMock({ confirmed: false });
        const deployment = makeDeployment({ viewManager });
        const received = recordDelegation(deployment);

        await assert.rejects(
            () => deployment.syncCollectionFiles(makeCollection()),
            (error) => error instanceof EmbeddedSourceOverrideDeclinedError
        );

        assert.equal(viewManager.calls.length, 1);
        assert.equal(received.length, 0);
    });
});

// ---------------------------------------------------------------------------
// The preflight that feeds the dialog is observable, runs once per deploy and
// fails closed when the embedded runtime itself cannot be resolved.
// ---------------------------------------------------------------------------

describe('DeviceDeployment — embedded override preflight', () => {
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

    it('logs the preflight payload and asks exactly one dialog per deploy', async () => {
        const viewManager = makeViewManagerMock();
        const deployment = makeDeployment({ viewManager });
        recordDelegation(deployment);
        const captured = captureLogs();

        try {
            await deployment.deployCollection(makeCollection());
        } finally {
            captured.restore();
        }

        const preflights = captured.entries.filter(
            (entry) => entry.reason === 'collection-embedded-override-preflight'
        );
        assert.equal(preflights.length, 1, 'the deploy must preflight exactly once');
        const payload = preflights[0].data[0];
        assert.equal(payload.resolved, true);
        assert.equal(payload.runtimeId, 'general');
        assert.equal(payload.runtimeIdSource, 'device-state');
        assert.equal(payload.collectionRuntimeId, 'general');
        assert.equal(payload.runtimeEmbedded, true);
        assert.equal(payload.fileCount, 3);
        assert.deepEqual(payload.packages, [
            {
                packageId: 'vars',
                reason: 'firmware-outdated',
                deviceVersion: '0.19.0',
                hostVersion: '0.20.0',
            },
        ]);
        assert.equal(viewManager.calls.length, 1, 'exactly one dialog per deploy');
    });

    it('aborts the deploy when the embedded runtime cannot be resolved', async () => {
        const viewManager = makeViewManagerMock();
        const deployment = makeDeployment({ viewManager });
        deployment._runtimeCollection.getRuntime = () => null;
        const received = recordDelegation(deployment);

        await assert.rejects(
            () => deployment.deployCollection(makeCollection()),
            /Cannot resolve the embedded runtime/
        );

        assert.equal(viewManager.calls.length, 0, 'no dialog without a plan');
        assert.equal(received.length, 0, 'nothing may be uploaded without a plan');
    });
});

// ---------------------------------------------------------------------------
// Manual escape hatch: the deploy-options checkbox requests a shadow upload even
// when the automatic plan is empty. It always asks and never reuses approvals.
// ---------------------------------------------------------------------------

describe('DeviceDeployment — forced shadow request', () => {
    it('asks and uploads the whole package even when the firmware version matches', async () => {
        const viewManager = makeViewManagerMock();
        const deployment = makeDeployment({ viewManager, deviceVersion: '0.21.0' });
        const received = recordDelegation(deployment);

        await deployment.deployCollection(makeCollection(), { overrideFirmwarePackages: true });

        assert.equal(viewManager.calls.length, 1, 'a forced shadow always asks');
        assert.ok(viewManager.calls[0].table, 'the forced packages must be listed in a table');
        assert.deepEqual(
            viewManager.calls[0].table.rows.map((row) => row.cells.map((cell) => cell.text)),
            [['vars', '0.21.0', '0.20.0']]
        );
        assert.deepEqual(received[0].embeddedLibraryOverridePaths, expectedOverridePaths);
        assert.equal(received[0].embeddedOverrideMode, 'forced');
    });

    it('declining a forced shadow aborts the deploy', async () => {
        const viewManager = makeViewManagerMock({ confirmed: false });
        const deployment = makeDeployment({ viewManager, deviceVersion: '0.21.0' });
        const received = recordDelegation(deployment);

        await assert.rejects(
            () => deployment.deployCollection(makeCollection(), { overrideFirmwarePackages: true }),
            (error) => error instanceof EmbeddedSourceOverrideDeclinedError
        );

        assert.equal(received.length, 0);
    });

    it('ignores a remembered approval for a forced shadow', async () => {
        const viewManager = makeViewManagerMock({ checkboxChecked: true });
        const deployment = makeDeployment({ viewManager });
        recordDelegation(deployment);

        await deployment.deployCollection(makeCollection());
        assert.equal(viewManager.calls.length, 1, 'the first deploy asks');

        await deployment.deployCollection(makeCollection(), { overrideFirmwarePackages: true });
        assert.equal(viewManager.calls.length, 2, 'the forced request must ask again');
    });
});
