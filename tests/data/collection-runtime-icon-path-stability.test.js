import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';

import { CollectionStore } from '../../src/micro_otter/nodes/html/js/data/collection-store.js';
import { CollectionManager } from '../../src/micro_otter/nodes/html/js/data/collection-manager.js';

const DB_NAME = 'micro-otter-collections';

globalThis.indexedDB = indexedDB;

function deleteDatabase() {
    return new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
    });
}

function createRuntimeCollectionStub() {
    const runtime = {
        getNodeType(typeId) {
            if (typeId !== 'demo-node') {
                return null;
            }
            return {
                title: { en: 'Demo Node' },
                // Legacy-style runtime path that should normalize to /device/runtime/...
                icon: '/runtime/general/icons/demo.svg',
                color: '#123456',
                inputs: [
                    {
                        id: 'in',
                        name: { en: 'Input' },
                        icon: '/runtime/general/icons/input.svg',
                        allowedTypes: ['number'],
                    },
                ],
                outputs: [
                    {
                        id: 'out',
                        name: { en: 'Output' },
                        icon: '/runtime/general/icons/output.svg',
                        outputType: 'number',
                    },
                ],
                controls: [],
            };
        },
    };

    return {
        runtimesById: new Map([['general', runtime]]),
        getRuntime(runtimeId) {
            return runtimeId === 'general' ? runtime : null;
        },
    };
}

test('legacy runtime icon paths do not cause repeated load-time version bumps', async () => {
    await deleteDatabase();

    const store = new CollectionStore();
    const adapter = await store.getAdapter();
    const id = '123e4567-e89b-42d3-a456-426614174004';

    await adapter.put({
        id,
        title: 'Icon Stability',
        targetId: 'generic_micropython',
        deviceRuntimeId: 'general',
        version: {
            major: 1,
            minor: 0,
            patch: 0,
            dirty: { major: false, minor: false, patch: false },
        },
        graphs: [
            {
                id: 'graph-1',
                name: 'Graph 1',
                triggerIntervalMs: 100,
                highlightColor: '#16a34a',
                nodes: [
                    {
                        id: 'node-1',
                        type: 'demo-node',
                        typeName: { en: 'Demo Node' },
                        x: 0,
                        y: 0,
                        width: 180,
                        height: 90,
                        icon: '/device/runtime/general/icons/demo.svg',
                        color: '#123456',
                        inputs: [
                            {
                                id: 'in',
                                name: { en: 'Input' },
                                icon: '/device/runtime/general/icons/input.svg',
                                allowedTypes: ['number'],
                            },
                        ],
                        outputs: [
                            {
                                id: 'out',
                                name: { en: 'Output' },
                                icon: '/device/runtime/general/icons/output.svg',
                                outputType: 'number',
                            },
                        ],
                        controls: [],
                        controlValues: {},
                        inputDefaults: {},
                    },
                ],
                connections: [],
                nodeCounter: 1,
                viewportConfig: { translateX: 0, translateY: 0, scale: 1 },
            },
        ],
        activeGraphIdx: 0,
    });

    const runtimeCollection = createRuntimeCollectionStub();

    const firstManager = new CollectionManager({ collectionStore: store, runtimeCollection });
    const firstLoaded = await firstManager.loadCollections();

    assert.equal(firstLoaded.length, 1);
    assert.equal(firstLoaded[0].getVersionString(), '1.0.0');

    const persistedAfterFirst = await adapter.get(id);
    assert.equal(persistedAfterFirst.version.minor, 0);
    assert.deepEqual(persistedAfterFirst.version.dirty, {
        major: false,
        minor: false,
        patch: false,
    });

    const secondManager = new CollectionManager({ collectionStore: store, runtimeCollection });
    const secondLoaded = await secondManager.loadCollections();

    assert.equal(secondLoaded.length, 1);
    assert.equal(secondLoaded[0].getVersionString(), '1.0.0');

    const persistedAfterSecond = await adapter.get(id);
    assert.equal(persistedAfterSecond.version.minor, 0);
    assert.deepEqual(persistedAfterSecond.version.dirty, {
        major: false,
        minor: false,
        patch: false,
    });
});
