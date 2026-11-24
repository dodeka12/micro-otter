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
                inputs: [
                    {
                        id: 'in',
                        name: { en: 'Input' },
                        icon: 'input-icon',
                        allowedTypes: ['number'],
                    },
                ],
                outputs: [
                    {
                        id: 'out',
                        name: { en: 'Output' },
                        icon: 'output-icon',
                        outputType: 'number',
                    },
                ],
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

test('loadCollection applies runtime migration once and persists clean version', async () => {
    await deleteDatabase();

    const store = new CollectionStore();
    const adapter = await store.getAdapter();
    const id = '123e4567-e89b-42d3-a456-426614174001';

    await adapter.put({
        id,
        title: 'Migration Collection',
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

    const manager = new CollectionManager({
        collectionStore: store,
        runtimeCollection,
    });
    const loaded = await manager.loadCollection(id);

    assert.ok(loaded, 'Expected collection to load');
    assert.equal(loaded.getVersionString(), '1.1.0');
    assert.equal(loaded.getVersion().isDirty(), false);

    const persistedAfterFirstLoad = await adapter.get(id);
    assert.equal(persistedAfterFirstLoad.version.minor, 1);
    assert.equal(persistedAfterFirstLoad.version.patch, 0);
    assert.equal(persistedAfterFirstLoad.version.dirty.minor, false);

    const persistedNode = persistedAfterFirstLoad.graphs[0].nodes[0];
    assert.deepEqual(persistedNode.typeName, { en: 'Demo Node' });
    assert.equal(persistedNode.icon, 'demo-icon');
    assert.equal(persistedNode.color, '#123456');
    assert.equal(persistedNode.width, 180);
    assert.equal(persistedNode.controls.length, 1);
    assert.equal(persistedNode.inputs.length, 1);
    assert.equal(persistedNode.outputs.length, 1);

    const managerReload = new CollectionManager({
        collectionStore: store,
        runtimeCollection,
    });
    const reloaded = await managerReload.loadCollection(id);

    assert.ok(reloaded, 'Expected collection to reload');
    assert.equal(reloaded.getVersionString(), '1.1.0');
    assert.equal(reloaded.getVersion().isDirty(), false);

    const persistedAfterSecondLoad = await adapter.get(id);
    assert.equal(persistedAfterSecondLoad.version.minor, 1);
    assert.equal(persistedAfterSecondLoad.version.patch, 0);
    assert.deepEqual(persistedAfterSecondLoad.version.dirty, {
        major: false,
        minor: false,
        patch: false,
    });
});

test('loadCollection does not bump when outputs only differ by derived dynamic typing fields', async () => {
    await deleteDatabase();

    const store = new CollectionStore();
    const adapter = await store.getAdapter();
    const id = '223e4567-e89b-42d3-a456-426614174002';

    await adapter.put({
        id,
        title: 'Dynamic Output Stable Collection',
        targetId: 'generic_micropython',
        deviceRuntimeId: 'general',
        version: {
            major: 2,
            minor: 5,
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
                        icon: 'demo-icon',
                        color: '#123456',
                        x: 0,
                        y: 0,
                        width: 180,
                        height: 90,
                        inputs: [
                            {
                                id: 'in',
                                name: { en: 'Input' },
                                icon: 'input-icon',
                                allowedTypes: ['number'],
                            },
                        ],
                        outputs: [
                            {
                                id: 'out',
                                name: { en: 'Output' },
                                icon: 'output-icon',
                                typeInputSources: ['in'],
                                initialTypes: ['number'],
                                // Derived fields can be materialized by dynamic typing refresh.
                                allowedTypes: ['number'],
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
                inputs: [
                    {
                        id: 'in',
                        name: { en: 'Input' },
                        icon: 'input-icon',
                        allowedTypes: ['number'],
                    },
                ],
                outputs: [
                    {
                        id: 'out',
                        name: { en: 'Output' },
                        icon: 'output-icon',
                        typeInputSources: ['in'],
                        initialTypes: ['number'],
                        outputType: 'number',
                    },
                ],
                controls: [],
            };
        },
    };

    const runtimeCollection = {
        runtimesById: new Map([['general', runtime]]),
        getRuntime(runtimeId) {
            return runtimeId === 'general' ? runtime : null;
        },
    };

    const manager = new CollectionManager({
        collectionStore: store,
        runtimeCollection,
    });

    const loaded = await manager.loadCollection(id);
    assert.ok(loaded, 'Expected collection to load');
    assert.equal(loaded.getVersionString(), '2.5.0');
    assert.equal(loaded.getVersion().isDirty(), false);

    const persistedAfterLoad = await adapter.get(id);
    assert.equal(persistedAfterLoad.version.minor, 5);
    assert.equal(persistedAfterLoad.version.patch, 0);
    assert.deepEqual(persistedAfterLoad.version.dirty, {
        major: false,
        minor: false,
        patch: false,
    });
});
