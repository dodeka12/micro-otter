import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CollectionManager } from '../../src/micro_otter/nodes/html/js/data/collection-manager.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { DeviceTargetInfo } from '../../src/micro_otter/nodes/html/js/data/device-target.js';

function createCollectionStoreStub() {
    return {
        async getCollection() {
            return null;
        },
        async saveCollection() {},
        async deleteCollection() {},
        async listCollections() {
            return [];
        },
        async clearCollections() {},
    };
}

function installServoCheck() {
    globalThis.NodeCapabilityChecks = {
        servoNode({ nodeData, deviceTarget }) {
            const pin = nodeData?.controlValues?.pin;
            if (pin === undefined || pin === null) {
                return [];
            }
            if (!deviceTarget?.hasPinCapability?.(pin, 'pwm.output')) {
                return [{ message: `Pin ${pin} does not support PWM output.` }];
            }
            return [];
        },
    };
}

function makeRuntime() {
    return {
        getNodeType(typeId) {
            if (typeId === 'stdmo-servo') {
                return { capabilityCheck: 'NodeCapabilityChecks.servoNode' };
            }
            return null;
        },
        getDeviceTarget(targetId) {
            return new DeviceTargetInfo({
                id: targetId,
                pinCapabilities: { 5: { pwm: { output: true } } },
            });
        },
    };
}

function makeCollection(pin) {
    return new Collection({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Servo Transpile Validation',
        deviceRuntimeId: 'general',
        targetId: 'esp32',
        graphs: [
            {
                id: 'graph-1',
                name: 'Graph 1',
                nodes: [{ id: 'node-1', type: 'stdmo-servo', controlValues: { pin } }],
                connections: [],
            },
        ],
    });
}

describe('CollectionManager transpile capability validation', () => {
    it('blocks transpilation when a node pin lacks the required capability', async () => {
        const previousChecks = globalThis.NodeCapabilityChecks;
        installServoCheck();

        try {
            const manager = new CollectionManager({
                collectionStore: createCollectionStoreStub(),
                runtimeCollection: { getRuntime: () => makeRuntime() },
                transpiler: {
                    async transpile() {
                        throw new Error('transpiler should not be called');
                    },
                },
            });

            const collection = makeCollection(3);

            await assert.rejects(
                () => manager.transpileCollection(collection),
                /Graph 1 → node 'node-1' \(stdmo-servo\): Pin 3 does not support PWM output/
            );
        } finally {
            globalThis.NodeCapabilityChecks = previousChecks;
        }
    });

    it('allows transpilation when the pin is valid', async () => {
        const previousChecks = globalThis.NodeCapabilityChecks;
        installServoCheck();

        try {
            let transpiled = false;

            const manager = new CollectionManager({
                collectionStore: createCollectionStoreStub(),
                runtimeCollection: { getRuntime: () => makeRuntime() },
                transpiler: {
                    async transpile() {
                        transpiled = true;
                        return { code: '# generated' };
                    },
                },
            });

            const collection = makeCollection(5);

            await manager.transpileCollection(collection);
            assert.equal(transpiled, true);
        } finally {
            globalThis.NodeCapabilityChecks = previousChecks;
        }
    });
});
