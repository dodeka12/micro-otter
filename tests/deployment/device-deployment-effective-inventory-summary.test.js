// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';

// The embedded inventory summary used to be fetched via a redundant device
// executeCode round-trip (`_queryEmbeddedInventoryHashPayload`). It is now derived
// host-side from the already-loaded `embeddedInventory`. These tests cover the
// pure derivation helper.

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

function makeInventory(files) {
    return {
        files: files.map((f) => ({
            path: f.path,
            packageId: f.packageId ?? null,
            packageVersion: f.packageVersion ?? null,
            fileKind: f.fileKind ?? 'py',
            source: f.source ?? 'embedded',
        })),
    };
}

describe('_computeEffectiveInventorySummary', () => {
    it('derives counts from embedded inventory files', () => {
        const deployment = makeDeployment();
        const result = deployment._computeEffectiveInventorySummary(
            makeInventory([
                { path: 'a.py', source: 'embedded' },
                { path: 'b.py', source: 'embedded' },
                { path: 'c.py', source: 'dynamic' },
            ])
        );

        assert.deepEqual(result, {
            totalEntries: 3,
            embeddedEntries: 2,
            dynamicEntries: 1,
            overriddenEntries: 0,
        });
    });

    it('returns null when inventory is null', () => {
        const deployment = makeDeployment();
        assert.equal(deployment._computeEffectiveInventorySummary(null), null);
    });

    it('returns null when inventory has no files array', () => {
        const deployment = makeDeployment();
        assert.equal(deployment._computeEffectiveInventorySummary({ files: undefined }), null);
    });

    it('returns zeroed summary for an empty inventory', () => {
        const deployment = makeDeployment();
        assert.deepEqual(deployment._computeEffectiveInventorySummary(makeInventory([])), {
            totalEntries: 0,
            embeddedEntries: 0,
            dynamicEntries: 0,
            overriddenEntries: 0,
        });
    });
});
