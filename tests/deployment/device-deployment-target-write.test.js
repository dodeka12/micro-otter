// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DeviceDeployment,
    TargetNotCompatibleError,
} from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';

/**
 * Minimal device connection double that records every write.
 */
class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this.files = new Map();
        this.writeCalls = [];
        this.connected = true;
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
        return null;
    }

    async ensureDirectory() {}

    async writeTextFile(path, content) {
        this.writeCalls.push({ path, content: String(content) });
        this.files.set(path, String(content));
    }

    async readTextFile(path) {
        if (!this.files.has(path)) {
            throw new Error(`File not found: ${path}`);
        }
        return this.files.get(path);
    }

    async sendFile() {}
    async deleteFolderRecursive() {}
    async deleteFile() {}
    async disconnect() {
        this.connected = false;
    }
    async hardReset() {}
    async softReset() {}
    async exitRawRepl() {}
    async calculateHash() {
        return null;
    }
}

/** The shipped English locale, used to render the expected messages. */
const LOCALES = JSON.parse(
    readFileSync(
        new URL('../../src/micro_otter/nodes/html/locales/en.json', import.meta.url),
        'utf8'
    )
);

/**
 * Resolve a dotted locale key.
 * @param {string} key - Dotted key such as `deployment.errors.targetIncomplete`.
 * @returns {string} The locale string.
 */
function localeValue(key) {
    return key.split('.').reduce((node, part) => (node ? node[part] : undefined), LOCALES);
}

/**
 * Render a locale string with `{{param}}` placeholders.
 * @param {string} key - Dotted locale key.
 * @param {Record<string, unknown>} params - Interpolation values.
 * @returns {string} The rendered message.
 */
function renderLocale(key, params = {}) {
    const template = localeValue(key);
    return Object.entries(params).reduce(
        (text, [name, value]) => text.split(`{{${name}}}`).join(String(value)),
        template
    );
}

/**
 * Build the deployment's i18n double backed by the real English locale.
 * @returns {{t: (key: string, params?: Record<string, unknown>) => string}} I18n double.
 */
function createI18n() {
    return {
        t(key, params = {}) {
            return renderLocale(key, params);
        },
    };
}

/**
 * Effective payloads the runtime double resolves for each target id.
 * A derived target (`esp32_s3_mini`) resolves through its base, exactly like
 * `DeviceRuntime.getEffectiveTargetPayload` does in the app.
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
    incomplete_target: {
        targetId: 'incomplete_target',
        displayName: 'Incomplete',
        description: 'Five-key skeleton without pin information',
        configVersion: 1,
        capabilities: {},
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

describe('device deployment target write gate', () => {
    let deployment;
    let deviceConnection;
    let originalWindow;

    beforeEach(() => {
        originalWindow = globalThis.window;
        globalThis.window = { location: { origin: 'http://localhost' } };

        deviceConnection = new MockDeviceConnection();
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
            i18nService: createI18n(),
            viewManager: { async showFormDialog() {}, async showError() {} },
            logger: console,
        });
    });

    afterEach(() => {
        globalThis.window = originalWindow;
        deployment.destroy();
    });

    it('rejects an image-incompatible target without writing anything', async () => {
        deployment._updateDeviceState({ connected: true, buildBaseTargetId: 'esp32_s3' });

        await assert.rejects(
            () => deployment._uploadTargetConfiguration('esp32_wroom', 'general'),
            (error) => {
                assert.equal(error.code, 'target-not-compatible');
                assert.equal(error.targetId, 'esp32_wroom');
                assert.equal(
                    error.message,
                    renderLocale('deployment.errors.targetNotCompatible', {
                        targetId: 'esp32_wroom',
                    })
                );
                return true;
            }
        );

        assert.equal(deviceConnection.writeCalls.length, 0);
    });

    it('writes the full effective payload for a derived target of the image family', async () => {
        deployment._updateDeviceState({ connected: true, buildBaseTargetId: 'esp32_s3' });

        await deployment._uploadTargetConfiguration('esp32_s3_mini', 'general', 'Workshop');

        const targetWrite = deviceConnection.writeCalls.find(
            (call) => call.path === '/device/targets/active_target.json'
        );
        assert.ok(targetWrite, 'expected the target file to be written');

        const uploaded = JSON.parse(targetWrite.content);
        assert.equal(uploaded.targetId, 'esp32_s3_mini');
        assert.equal(uploaded.displayName, 'ESP32-S3 Mini');
        assert.equal(uploaded.description, 'S3 Mini target');
        assert.equal(uploaded.configVersion, 2);
        assert.ok(uploaded.pinCapabilities, 'expected pin capabilities in the written payload');
    });

    it('accepts a derived target when the image only records allowedWebTargetIds', async () => {
        deployment._updateDeviceState({ connected: true, allowedWebTargetIds: ['esp32_s3'] });

        await deployment._uploadTargetConfiguration('esp32_s3_mini', 'general');

        assert.ok(deviceConnection.files.has('/device/targets/active_target.json'));
    });

    it('accepts any target when the image records no compatibility metadata', async () => {
        deployment._updateDeviceState({ connected: true });

        await deployment._uploadTargetConfiguration('esp32_wroom', 'general');

        assert.ok(deviceConnection.files.has('/device/targets/active_target.json'));
    });

    it('rejects an incomplete payload before writing, with the localised message', async () => {
        deployment._updateDeviceState({ connected: true });

        await assert.rejects(
            () => deployment._uploadTargetConfiguration('incomplete_target', 'general'),
            (error) => {
                assert.equal(error.code, 'target-incomplete');
                assert.equal(
                    error.message,
                    renderLocale('deployment.errors.targetIncomplete', {
                        targetId: 'incomplete_target',
                    })
                );
                return true;
            }
        );

        assert.equal(deviceConnection.writeCalls.length, 0);
    });

    it('keeps the legacy English sentence when TargetNotCompatibleError is built without a message', () => {
        const error = new TargetNotCompatibleError('esp32_wroom');
        assert.equal(
            error.message,
            "Target 'esp32_wroom' is not compatible with the connected board's firmware."
        );
        assert.equal(error.code, 'target-not-compatible');
    });
});
