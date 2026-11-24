// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';
import { isCompleteActiveTargetPayload } from '../../src/micro_otter/nodes/html/js/data/target-payload.js';

/** The shipped English locale, used to render the expected messages. */
const LOCALES = JSON.parse(
    readFileSync(
        new URL('../../src/micro_otter/nodes/html/locales/en.json', import.meta.url),
        'utf8'
    )
);

/**
 * Resolve a dotted locale key.
 * @param {string} key - Dotted key such as `deployment.errors.deviceTargetIncompatible`.
 * @returns {string} The locale string.
 */
function localeValue(key) {
    return key.split('.').reduce((node, part) => (node ? node[part] : undefined), LOCALES);
}

/**
 * Effective payloads the runtime double resolves for each target id.
 * `esp32_s3_mini` is derived, so its build base is `esp32_s3`.
 */
const EFFECTIVE_PAYLOADS = {
    esp32_wroom: {
        targetId: 'esp32_wroom',
        displayName: 'ESP32-WROOM',
        description: 'WROOM target',
        configVersion: 1,
        pinCapabilities: { 2: { label: 'GPIO2' } },
    },
    esp32_s3_mini: {
        targetId: 'esp32_s3_mini',
        displayName: 'ESP32-S3 Mini',
        description: 'S3 Mini target',
        configVersion: 2,
        pinCapabilities: { 4: { label: 'GPIO4' } },
    },
};

/**
 * Build the runtime collection double.
 * @returns {{getRuntime: (runtimeId: string) => object | null}} Runtime collection double.
 */
function createRuntimeCollection() {
    const targets = Object.keys(EFFECTIVE_PAYLOADS).map((id) => ({ id, displayName: id }));
    const runtime = {
        id: 'general',
        name: 'General Runtime',
        version: '1.0.0',
        description: 'General runtime',
        manifest: { preservedPaths: [], nodeLibraries: { alwaysInclude: [] } },
        resolvedFilesystem: [],
        getAvailableTargets() {
            return targets;
        },
        getDeviceTarget(targetId) {
            return targets.find((target) => target.id === targetId) || null;
        },
        getEffectiveTargetPayload(targetId) {
            return EFFECTIVE_PAYLOADS[targetId] ?? null;
        },
        getTargetBuildBaseId(targetId) {
            return targetId === 'esp32_s3_mini' ? 'esp32_s3' : targetId;
        },
        getNodeType() {
            return null;
        },
    };

    return {
        getRuntime(runtimeId) {
            return runtimeId === 'general' ? runtime : null;
        },
    };
}

/**
 * Device connection double that serves a scripted `loadDeviceInfo()` payload.
 *
 * The reader verdict and the prefill hints are settable so tests can model a device whose
 * active-target payload the host rejected.
 */
class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this.files = new Map();
        this.writeCalls = [];
        this.deviceInfo = null;
        this.payloadIssue = null;
        this.targetIdHint = null;
        this.userDescription = '';
        this.onboardingAdapter = null;
    }

    isConnected() {
        return true;
    }

    getState() {
        return 'connected';
    }

    getDeviceInfoData() {
        return this.deviceInfo;
    }

    async loadDeviceInfo() {
        return DeviceState.fromDeviceInfo(this.deviceInfo ?? {});
    }

    getTargetPayloadIssue() {
        return this.payloadIssue;
    }

    getConfiguredTargetIdHint() {
        return this.targetIdHint;
    }

    getTargetUserDescription() {
        return this.userDescription;
    }

    setEmbeddedOnboardingAdapter(adapter) {
        this.onboardingAdapter = adapter;
    }

    async ensureDirectory() {}

    async writeTextFile(path, content) {
        this.files.set(path, String(content));
        this.writeCalls.push({ path, content: String(content) });
    }

    async readTextFile(path) {
        if (!this.files.has(path)) {
            throw new Error(`ENOENT: ${path}`);
        }
        return this.files.get(path);
    }
}

describe('device deployment target validity', () => {
    let deployment;
    let deviceConnection;
    let viewManager;
    let originalWindow;

    /**
     * Build the device-info payload the connection double reports.
     * @param {Object} [options] Overrides.
     * @param {Object | null} [options.target] Adopted target, or null when the reader rejected it.
     * @param {string | null} [options.runtimeId] Runtime id, or null when no runtime is present.
     * @param {Object} [options.firmware] Firmware compatibility metadata.
     * @returns {Object} Device-info payload.
     */
    function buildDeviceInfo({ target = null, runtimeId = 'general', firmware = {} } = {}) {
        return {
            microPythonVersion: '1.23.0',
            runtime: runtimeId
                ? {
                      id: runtimeId,
                      name: 'General Runtime',
                      version: '1.0.0',
                      description: 'General runtime',
                  }
                : null,
            target,
            runtimeDeploymentMode: 'embedded',
            runtimeEmbedded: true,
            firmware,
        };
    }

    beforeEach(() => {
        originalWindow = globalThis.window;
        globalThis.window = { location: { origin: 'http://localhost' } };

        deviceConnection = new MockDeviceConnection();
        deviceConnection.deviceInfo = buildDeviceInfo();
        viewManager = { async showFormDialog() { return null; }, async showError() {} };
        deployment = new DeviceDeployment({
            deviceConnection,
            collectionManager: {
                async transpileCollection() {
                    return { code: '', assets: { packages: {} } };
                },
                getNodeType() {
                    return null;
                },
            },
            runtimeCollection: createRuntimeCollection(),
            transpiler: {},
            i18nService: {
                t(key, params = {}) {
                    const template = localeValue(key);
                    return Object.entries(params).reduce(
                        (text, [name, value]) => text.split(`{{${name}}}`).join(String(value)),
                        template
                    );
                },
            },
            viewManager,
            logger: console,
        });
        deployment._updateDeviceState({ connected: true });
    });

    afterEach(() => {
        globalThis.window = originalWindow;
        deployment.destroy();
    });


    it('publishes an incomplete payload as an unconfigured target', async () => {
        deviceConnection.payloadIssue = 'incomplete';
        deviceConnection.targetIdHint = 'esp32_s3_mini';

        await deployment.refreshDeviceInfo();

        assert.equal(deployment.targetConfigurationIssue, 'incomplete');
        assert.equal(deployment.getDeviceState().deviceTargetInfo, null);
    });

    it('publishes a missing target file as an unconfigured target', async () => {
        deviceConnection.payloadIssue = 'missing';

        await deployment.refreshDeviceInfo();

        assert.equal(deployment.targetConfigurationIssue, 'missing');
        assert.equal(deployment.getDeviceState().deviceTargetInfo, null);
    });

    it('drops a target that does not match the flashed image', async () => {
        deviceConnection.deviceInfo = buildDeviceInfo({
            target: { id: 'esp32_wroom', displayName: 'ESP32-WROOM' },
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });

        await deployment.refreshDeviceInfo();

        assert.equal(deployment.targetConfigurationIssue, 'image-incompatible');
        assert.equal(deployment.getDeviceState().deviceTargetInfo, null);
    });

    it('keeps a compatible target without reporting an issue', async () => {
        deviceConnection.deviceInfo = buildDeviceInfo({
            target: { id: 'esp32_s3_mini', displayName: 'ESP32-S3 Mini' },
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });

        await deployment.refreshDeviceInfo();

        assert.equal(deployment.targetConfigurationIssue, null);
        assert.equal(deployment.getDeviceState().deviceTargetInfo?.id, 'esp32_s3_mini');
    });

    it('keeps a derived target when the image only records allowedWebTargetIds', async () => {
        deviceConnection.deviceInfo = buildDeviceInfo({
            target: { id: 'esp32_s3_mini', displayName: 'ESP32-S3 Mini' },
            firmware: { allowedWebTargetIds: ['esp32_s3'] },
        });

        await deployment.refreshDeviceInfo();

        assert.equal(deployment.targetConfigurationIssue, null);
        assert.equal(deployment.getDeviceState().deviceTargetInfo?.id, 'esp32_s3_mini');
    });

    it('keeps a target it cannot judge when no runtime resolves the build base', async () => {
        deviceConnection.deviceInfo = buildDeviceInfo({
            target: { id: 'esp32_wroom', displayName: 'ESP32-WROOM' },
            runtimeId: null,
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });

        await deployment.refreshDeviceInfo();

        assert.equal(deployment.targetConfigurationIssue, null);
        assert.equal(deployment.getDeviceState().deviceTargetInfo?.id, 'esp32_wroom');
    });

    it('clears the issue when the device disconnects', async () => {
        deviceConnection.payloadIssue = 'incomplete';
        await deployment.refreshDeviceInfo();
        assert.equal(deployment.targetConfigurationIssue, 'incomplete');

        deployment._handleDeviceDisconnect({ detail: { source: 'test' } });

        assert.equal(deployment.targetConfigurationIssue, null);
    });

    it('names the repair reason when a collection is validated', async () => {
        deviceConnection.payloadIssue = 'incomplete';
        await deployment.refreshDeviceInfo();

        const collection = { getTargetId: () => 'esp32_s3_mini' };
        const unconfigured = await deployment.validateCollectionCompatibility(collection);
        assert.deepEqual(unconfigured.errors, [
            localeValue('deployment.errors.deviceTargetNotConfigured'),
        ]);

        deviceConnection.payloadIssue = null;
        deviceConnection.deviceInfo = buildDeviceInfo({
            target: { id: 'esp32_wroom', displayName: 'ESP32-WROOM' },
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });
        await deployment.refreshDeviceInfo();

        const incompatible = await deployment.validateCollectionCompatibility(collection);
        assert.deepEqual(incompatible.errors, [
            localeValue('deployment.errors.deviceTargetIncompatible'),
        ]);
    });

    it('repairs a rejected payload by re-uploading the effective payload', async () => {
        deviceConnection.payloadIssue = 'incomplete';
        deviceConnection.targetIdHint = 'esp32_s3_mini';
        deviceConnection.userDescription = 'Workshop board';
        deviceConnection.deviceInfo = buildDeviceInfo({
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });
        await deployment.refreshDeviceInfo();
        assert.equal(deployment.targetConfigurationIssue, 'incomplete');

        await deployment._uploadTargetConfiguration('esp32_s3_mini', 'general', 'Workshop board');

        const targetWrite = deviceConnection.writeCalls.find(
            (call) => call.path === '/device/targets/active_target.json'
        );
        assert.ok(targetWrite, 'expected the repair to rewrite the target file');
        const uploaded = JSON.parse(targetWrite.content);
        assert.equal(uploaded.targetId, 'esp32_s3_mini');
        assert.ok(uploaded.pinCapabilities, 'expected pin information in the repaired payload');

        const deviceJson = JSON.parse(deviceConnection.files.get('/device.json'));
        assert.equal(deviceJson.targetUserDescription, 'Workshop board');

        // Second refresh models the reconnect: the reader now adopts the repaired payload.
        deviceConnection.payloadIssue = null;
        deviceConnection.deviceInfo = buildDeviceInfo({
            target: { id: 'esp32_s3_mini', displayName: 'ESP32-S3 Mini' },
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });
        await deployment.refreshDeviceInfo();

        assert.equal(deployment.targetConfigurationIssue, null);
        assert.equal(deployment.getDeviceState().deviceTargetInfo?.id, 'esp32_s3_mini');
    });

    it('prefills the repair dialog from the stored target and user description', async () => {
        deviceConnection.payloadIssue = 'incomplete';
        deviceConnection.targetIdHint = 'esp32_s3_mini';
        deviceConnection.userDescription = 'Workshop board';
        deviceConnection.deviceInfo = buildDeviceInfo({
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });
        await deployment.refreshDeviceInfo();

        let dialog = null;
        viewManager.showFormDialog = async (options) => {
            dialog = options;
            return {
                confirmed: true,
                formData: { target: 'esp32_s3_mini', userDescription: 'Workshop board' },
            };
        };

        const selection = await deviceConnection.onboardingAdapter.requestSelection({
            runtimeIdentity: { id: 'general' },
            targetConstraints: { compileBoard: null, allowedTargetIds: null },
        });

        assert.deepEqual(selection, {
            confirmed: true,
            selectedTargetId: 'esp32_s3_mini',
            userDescription: 'Workshop board',
        });
        assert.ok(dialog, 'expected the target dialog to open');
        assert.equal(
            dialog.fields.find((field) => field.id === 'target').default,
            'esp32_s3_mini'
        );
        assert.equal(
            dialog.fields.find((field) => field.id === 'userDescription').value,
            'Workshop board'
        );

        await deviceConnection.onboardingAdapter.uploadTargetConfiguration({
            runtimeId: 'general',
            targetId: selection.selectedTargetId,
            userDescription: selection.userDescription,
        });
        const repaired = JSON.parse(deviceConnection.files.get('/device/targets/active_target.json'));
        assert.equal(isCompleteActiveTargetPayload(repaired), true);
    });

    it('does not offer a target outside the image family in the repair dialog', async () => {
        deviceConnection.payloadIssue = 'incomplete';
        deviceConnection.deviceInfo = buildDeviceInfo({
            firmware: { buildBaseTargetId: 'esp32_s3' },
        });
        await deployment.refreshDeviceInfo();

        let dialog = null;
        viewManager.showFormDialog = async (options) => {
            dialog = options;
            return { confirmed: false, formData: null };
        };

        await deviceConnection.onboardingAdapter.requestSelection({
            runtimeIdentity: { id: 'general' },
            targetConstraints: { compileBoard: null, allowedTargetIds: ['esp32_s3'] },
        });

        assert.ok(dialog, 'expected the target dialog to open');
        const offered = dialog.fields
            .find((field) => field.id === 'target')
            .options.map((option) => option.value);
        assert.ok(offered.includes('esp32_s3_mini'), 'expected the derived target in the list');
        assert.ok(!offered.includes('esp32_wroom'), 'expected the other family to be filtered out');
    });

});

