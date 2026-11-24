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
                icon: 'demo-icon',
                color: '#123456',
                defaultWidth: 200,
                minWidth: 180,
                maxWidth: 260,
                inputs: [{ id: 'in', name: { en: 'Input' }, allowedTypes: ['number'] }],
                outputs: [{ id: 'out', name: { en: 'Output' }, outputType: 'number' }],
                controls: [
                    {
                        id: 'mode',
                        type: 'dropdown',
                        label: { en: 'Mode' },
                        defaultValue: 'auto',
                        options: ['auto', 'manual'],
                    },
                ],
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

test('repeated loadCollections cycles do not keep incrementing version without edits', async () => {
    await deleteDatabase();

    const store = new CollectionStore();
    const adapter = await store.getAdapter();
    const id = '123e4567-e89b-42d3-a456-426614174003';

    await adapter.put({
        id,
        title: 'Hard Refresh Stability',
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
                        x: 0,
                        y: 0,
                        width: 140,
                        height: 90,
                        inputs: [],
                        outputs: [],
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

    const firstManager = new CollectionManager({
        collectionStore: store,
        runtimeCollection,
    });
    const firstLoad = await firstManager.loadCollections();
    assert.equal(firstLoad.length, 1);
    assert.equal(firstLoad[0].getVersionString(), '1.1.0');

    const persistedAfterFirstLoad = await adapter.get(id);
    assert.equal(persistedAfterFirstLoad.version.minor, 1);
    assert.deepEqual(persistedAfterFirstLoad.version.dirty, {
        major: false,
        minor: false,
        patch: false,
    });

    const secondManager = new CollectionManager({
        collectionStore: store,
        runtimeCollection,
    });
    const secondLoad = await secondManager.loadCollections();
    assert.equal(secondLoad.length, 1);
    assert.equal(secondLoad[0].getVersionString(), '1.1.0');

    const persistedAfterSecondLoad = await adapter.get(id);
    assert.equal(persistedAfterSecondLoad.version.minor, 1);
    assert.deepEqual(persistedAfterSecondLoad.version.dirty, {
        major: false,
        minor: false,
        patch: false,
    });
});
