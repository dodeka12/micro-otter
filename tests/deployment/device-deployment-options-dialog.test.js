// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for the shared deploy/sync options dialog entry points
// (deployCollectionInteractive / syncCollectionFilesInteractive) and the field builder.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    DeviceDeployment,
    DeploymentOptionsCancelledError,
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
    t(key) {
        return key;
    }
}

function makeViewManager({ confirmed = true, formData = {} } = {}) {
    const calls = [];
    return {
        calls,
        async showFormDialog(options) {
            calls.push(options);
            return { confirmed, formData };
        },
    };
}

/**
 * Build a DeviceDeployment with the device-touching parts stubbed out.
 * @param {object} [opts] - Mock configuration
 * @param {object} [opts.viewManager] - View-manager mock
 * @returns {DeviceDeployment} Deployment under test
 */
function makeDeployment({ viewManager = makeViewManager() } = {}) {
    const deployment = new DeviceDeployment({
        deviceConnection: new MockDeviceConnection(),
        collectionManager: new MockCollectionManager(),
        runtimeCollection: { getRuntime: () => ({ nodePackages: [], nodePackagesGlobal: [] }) },
        transpiler: new MockTranspiler(),
        i18nService: new MockI18nService(),
        viewManager,
    });

    deployment.deployCollection = async (_collection, options) => options;
    deployment.syncCollectionFiles = async (_collection, options) => options;
    return deployment;
}

function makeCollection() {
    return {
        getId: () => 'coll-1',
        getTitle: () => 'Test',
        getTargetId: () => 'esp32',
        getDeviceRuntimeId: () => 'general',
        getGraphArray: () => [],
    };
}

describe('DeviceDeployment interactive options dialog', () => {
    it('skips the options dialog for the title-bar quick action', async () => {
        const viewManager = makeViewManager();
        const deployment = makeDeployment({ viewManager });

        const forwarded = await deployment.deployCollectionInteractive(makeCollection(), {
            quickAction: true,
            includeFullDefinition: false,
            force: false,
        });

        assert.equal(viewManager.calls.length, 0, 'no options dialog in quick action');
        assert.deepEqual(forwarded, {
            quickAction: true,
            includeFullDefinition: false,
            force: false,
        });
    });

    it('shows the deploy options dialog and merges the confirmed fields', async () => {
        const viewManager = makeViewManager({
            formData: { includeFullDefinition: true, forceUpload: true },
        });
        const deployment = makeDeployment({ viewManager });

        const forwarded = await deployment.deployCollectionInteractive(makeCollection(), {});

        assert.equal(viewManager.calls.length, 1);
        assert.equal(viewManager.calls[0].title, 'deployment.deploymentOptions');
        assert.deepEqual(
            viewManager.calls[0].fields.map((field) => field.id),
            ['forceUpload', 'includeFullDefinition']
        );
        assert.deepEqual(forwarded, {
            includeFullDefinition: true,
            force: true,
        });
    });

    it('shows the sync options dialog without a force upload field', async () => {
        const viewManager = makeViewManager({ formData: { includeFullDefinition: true } });
        const deployment = makeDeployment({ viewManager });

        const forwarded = await deployment.syncCollectionFilesInteractive(makeCollection(), {});

        assert.equal(viewManager.calls.length, 1);
        assert.equal(viewManager.calls[0].title, 'deployment.syncOptions');
        assert.deepEqual(
            viewManager.calls[0].fields.map((field) => field.id),
            ['includeFullDefinition']
        );
        assert.deepEqual(forwarded, { includeFullDefinition: true });
    });

    it('throws a cancellation error when the dialog is cancelled', async () => {
        const viewManager = makeViewManager({ confirmed: false });
        const deployment = makeDeployment({ viewManager });

        await assert.rejects(
            () => deployment.deployCollectionInteractive(makeCollection(), {}),
            (error) => {
                assert.ok(error instanceof DeploymentOptionsCancelledError);
                assert.equal(error.code, 'DEPLOYMENT_OPTIONS_CANCELLED');
                return true;
            }
        );
    });
});

describe('DeviceDeployment deployment option helpers', () => {
    it('builds the expected deploy and sync field sets', () => {
        const deployment = makeDeployment();

        assert.deepEqual(
            deployment._buildDeploymentOptionFields(true).map((field) => field.id),
            ['forceUpload', 'includeFullDefinition']
        );
        assert.deepEqual(
            deployment._buildDeploymentOptionFields(false).map((field) => field.id),
            ['includeFullDefinition']
        );
    });
});
