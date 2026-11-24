import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';
import { CollectionStore } from '../../src/micro_otter/nodes/html/js/data/collection-store.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';

globalThis.indexedDB = indexedDB;

const DB_NAME = 'micro-otter-collections';

function deleteDatabase() {
    return new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
    });
}

test('CollectionStore repairs out-of-range activeGraphIdx during list load', async () => {
    await deleteDatabase();

    const store = new CollectionStore();
    const adapter = await store.getAdapter();

    const graph = new NodeGraph({ id: 'graph-1', name: 'Graph 1' });
    const recordId = generateUuidV4();

    await adapter.put({
        id: recordId,
        title: 'Broken Collection',
        targetId: 'generic_micropython',
        deviceRuntimeId: 'general',
        version: { version_string: '0.0.0' },
        graphs: [graph.toData()],
        activeGraphIdx: 6,
    });

    const collections = await store.listCollections();

    assert.equal(collections.length, 1);
    assert.equal(collections[0].getId(), recordId);
    assert.equal(collections[0].getActiveGraphIdx(), 0);

    const persisted = await adapter.get(recordId);
    assert.equal(persisted.activeGraphIdx, 0);

    const repairs = store.getLastLoadRepairs();
    assert.equal(repairs.length, 1);
    assert.equal(repairs[0].collectionId, recordId);
    assert.equal(repairs[0].repairs.length, 1);
    assert.equal(repairs[0].repairs[0].field, 'activeGraphIdx');
});

test('CollectionStore reports no repairs for valid collection records', async () => {
    await deleteDatabase();

    const store = new CollectionStore();
    const adapter = await store.getAdapter();

    const graph = new NodeGraph({ id: 'graph-1', name: 'Graph 1' });
    const recordId = generateUuidV4();

    await adapter.put({
        id: recordId,
        title: 'Valid Collection',
        targetId: 'generic_micropython',
        deviceRuntimeId: 'general',
        version: { version_string: '0.0.0' },
        graphs: [graph.toData()],
        activeGraphIdx: 0,
    });

    const collections = await store.listCollections();

    assert.equal(collections.length, 1);
    assert.equal(collections[0].getActiveGraphIdx(), 0);

    const repairs = store.getLastLoadRepairs();
    assert.deepEqual(repairs, []);
});
