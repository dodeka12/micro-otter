import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';

function createMockDeviceConnection() {
    return {
        addEventListener() {},
        removeEventListener() {},
        isConnected() {
            return false;
        },
        getState() {
            return 'disconnected';
        },
        async loadDeviceInfo() {
            throw new Error('load failed');
        },
    };
}

function createMockCollectionManager() {
    return {
        getActiveCollection() {
            return null;
        },
    };
}

function createMockRuntimeCollection() {
    return {
        getRuntime() {
            return null;
        },
    };
}

function createMockTranspiler() {
    return {
        transpile() {
            return { code: '', assets: {} };
        },
    };
}

function createMockI18nService() {
    return {
        t(key) {
            return key;
        },
    };
}

function createMockViewManager() {
    return {
        async showError() {},
        async showInfo() {},
    };
}

describe('DeviceDeployment event contract', () => {
    function createDeployment() {
        return new DeviceDeployment({
            deviceConnection: createMockDeviceConnection(),
            collectionManager: createMockCollectionManager(),
            runtimeCollection: createMockRuntimeCollection(),
            transpiler: createMockTranspiler(),
            i18nService: createMockI18nService(),
            viewManager: createMockViewManager(),
        });
    }

    it('forwards runtime events with typed payloads', () => {
        const deployment = createDeployment();
        let received = null;

        deployment.addEventListener('runtime-upgraded', (event) => {
            received = event;
        });

        deployment._runtimeDeployment.dispatchEvent(
            new CustomEvent('runtime-upgraded', {
                detail: { runtimeId: 'general', runtimeVersion: '1.2.3' },
            })
        );

        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'DeviceDeployment.RuntimeUpgraded.v1');
        assert.equal(received.detail.runtimeId, 'general');
        assert.equal(received.detail.runtimeVersion, '1.2.3');
    });

    it('forwards operation-error events with typed payloads', () => {
        const deployment = createDeployment();
        let received = null;

        deployment.addEventListener('operation-error', (event) => {
            received = event;
        });

        deployment._collectionDeployment.dispatchEvent(
            new CustomEvent('operation-error', {
                detail: { error: 'sync failed', phase: 'collection-sync' },
            })
        );

        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'DeviceDeployment.OperationError.v1');
        assert.equal(received.detail.error, 'sync failed');
        assert.equal(received.detail.phase, 'collection-sync');
    });

    it('emits typed device-info-load-error payload on refresh failure', async () => {
        const deployment = createDeployment();
        deployment._updateDeviceState({ connected: true });

        let received = null;
        deployment.addEventListener('device-info-load-error', (event) => {
            received = event;
        });

        await assert.rejects(async () => {
            await deployment.refreshDeviceInfo();
        });

        assert.ok(received);
        assert.equal(received.detail.payloadTypeId, 'DeviceDeployment.DeviceInfoLoadError.v1');
        assert.equal(received.detail.error, 'load failed');
    });
});
