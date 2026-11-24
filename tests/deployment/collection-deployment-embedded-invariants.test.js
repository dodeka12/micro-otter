import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionDeployment } from '../../src/micro_otter/nodes/html/js/deployment/collection-deployment.js';

function createDeployment({ deviceState = {}, runtimeCollection } = {}) {
    return new CollectionDeployment({
        deviceConnection: {
            isExecutionRunning() {
                return false;
            },
            async softReset() {},
            async writeTextFile() {},
            async sendFile() {},
            async calculateHash() {
                return 'hash';
            },
            async readTextFile() {
                return '';
            },
            async deleteFile() {},
            async deleteFolderRecursive() {},
        },
        deviceState: {
            connected: true,
            runtimeInstalled: true,
            runtimeId: 'general',
            runtimeVersion: '1.0.0',
            runtimeDeploymentMode: 'dynamic',
            runtimeEmbedded: false,
            deviceTargetInfo: {
                id: 'esp32',
            },
            ...deviceState,
        },
        updateDeviceState() {},
        collectionManager: {
            async transpileCollection() {
                return { code: 'print(1)', assets: {} };
            },
            getNodeType() {
                return null;
            },
        },
        runtimeCollection: runtimeCollection || {
            getRuntime(runtimeId) {
                if (runtimeId !== 'general') {
                    return null;
                }
                return {
                    id: 'general',
                    version: '1.0.0',
                    resolvedFilesystem: [],
                };
            },
        },
        transpiler: {},
    });
}

describe('CollectionDeployment embedded runtime invariants', () => {
    it('keeps dynamic mode behavior untouched', () => {
        const deployment = createDeployment({
            deviceState: {
                runtimeDeploymentMode: 'dynamic',
                runtimeEmbedded: false,
                runtimeId: null,
                runtimeVersion: null,
            },
        });

        assert.doesNotThrow(() => {
            deployment._assertEmbeddedRuntimeContract();
        });
    });

    it('fails fast when embedded mode markers are inconsistent', () => {
        const deployment = createDeployment({
            deviceState: {
                runtimeDeploymentMode: 'embedded',
                runtimeEmbedded: false,
            },
        });

        assert.throws(() => {
            deployment._assertEmbeddedRuntimeContract();
        }, /Embedded runtime metadata is inconsistent/);
    });

    it('fails fast when embedded runtime identity is incomplete', () => {
        const deployment = createDeployment({
            deviceState: {
                runtimeDeploymentMode: 'embedded',
                runtimeEmbedded: true,
                runtimeId: '',
                runtimeVersion: '1.0.0',
            },
        });

        assert.throws(() => {
            deployment._assertEmbeddedRuntimeContract();
        }, /runtime ID is missing/);
    });

    it('fails fast when embedded runtime identity mismatches workspace runtime', () => {
        const deployment = createDeployment({
            deviceState: {
                runtimeDeploymentMode: 'embedded',
                runtimeEmbedded: true,
                runtimeId: 'general',
                runtimeVersion: '2.0.0',
            },
            runtimeCollection: {
                getRuntime(runtimeId) {
                    if (runtimeId !== 'general') {
                        return null;
                    }
                    return {
                        id: 'general',
                        version: '1.0.0',
                        resolvedFilesystem: [],
                    };
                },
            },
        });

        assert.throws(() => {
            deployment._assertEmbeddedRuntimeContract();
        }, /does not match workspace runtime/);
    });
});
