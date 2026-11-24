import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DeviceDeployment } from '../../src/micro_otter/nodes/html/js/deployment/device-deployment.js';
import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';

const AUDIO_NODE_TYPES = [
    'audio.oscillator',
    'audio.i2s-output',
    'audio.gain',
    'audio.bitcrusher',
    'audio.square-fuzz',
];

class MockDeviceConnection extends EventTarget {
    constructor() {
        super();
        this._connected = false;
    }

    setConnected(value) {
        this._connected = value;
    }

    isConnected() {
        return this._connected;
    }

    getState() {
        return this._connected ? 'connected' : 'disconnected';
    }

    async executeCode() {
        return '';
    }

    async loadDeviceInfo() {
        return {
            runtimeInstalled: true,
            runtimeId: 'general',
            deviceTargetInfo: new DeviceTargetInfo({
                id: 'generic_micropython',
                displayName: 'Generic MicroPython',
                capabilityToPins: {},
                generalCapabilities: {},
            }),
        };
    }

    getDeviceInfoData() {
        return null;
    }
}

function createAudioCollection() {
    return {
        getTargetId() {
            return 'generic_micropython';
        },
        getDeviceRuntimeId() {
            return 'general';
        },
        getGraphArray() {
            return [
                {
                    getNodes() {
                        return AUDIO_NODE_TYPES.map((type, index) => ({
                            id: `node-${index}`,
                            type,
                        }));
                    },
                },
            ];
        },
        getTitle() {
            return 'Audio Regression';
        },
        getVersionString() {
            return '1.0.0';
        },
        getId() {
            return 'audio-regression';
        },
    };
}

function createRuntimeCollection() {
    return {
        getRuntime(runtimeId) {
            if (runtimeId !== 'general') {
                return null;
            }
            return {
                id: 'general',
                getNodeType(nodeTypeId) {
                    return AUDIO_NODE_TYPES.includes(nodeTypeId) ? { id: nodeTypeId } : null;
                },
                getDeviceTarget(targetId) {
                    return targetId === 'generic_micropython'
                        ? { id: 'generic_micropython', displayName: 'Generic MicroPython' }
                        : null;
                },
                nodePackagesGlobal: [],
                nodePackages: [],
            };
        },
    };
}

function createViewManager() {
    return {
        async showFormDialog() {
            return { confirmed: false };
        },
        async showError() {},
    };
}

describe('audio node type resolution regression', () => {
    it('validateCollectionCompatibility resolves audio.* node types', async () => {
        const connection = new MockDeviceConnection();
        const deployment = new DeviceDeployment({
            deviceConnection: connection,
            collectionManager: { getNodeType: () => null },
            runtimeCollection: createRuntimeCollection(),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        connection.setConnected(true);
        await deployment.refreshConnectionState();
        await deployment.refreshDeviceInfo();

        const result = await deployment.validateCollectionCompatibility(createAudioCollection());
        assert.equal(result.compatible, true);
        assert.deepEqual(result.errors, []);
    });

    it('validateNodePackages resolves audio.* node types', () => {
        const deployment = new DeviceDeployment({
            deviceConnection: new MockDeviceConnection(),
            collectionManager: { getNodeType: () => null },
            runtimeCollection: createRuntimeCollection(),
            transpiler: {},
            i18nService: { t: (key) => key },
            viewManager: createViewManager(),
        });

        const result = deployment.validateNodePackages(createAudioCollection());
        assert.equal(result.compatible, true);
        assert.deepEqual(result.errors, []);
    });
});
