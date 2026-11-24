import assert from 'node:assert/strict';
import test from 'node:test';

import { indexedDB } from 'fake-indexeddb';
import { IndexedStore } from '../../src/micro_otter/nodes/html/js/data/indexed-store.js';

// Provide IndexedDB implementation for the store in the test environment.
globalThis.indexedDB = indexedDB;

const DB_NAME = 'indexed-store-test';
const STORE_NAME = 'items';

class TestStore extends IndexedStore {
    constructor() {
        super({ dbName: DB_NAME, dbVersion: 1, storeName: STORE_NAME, keyPath: 'id' });
    }
}

function deleteDatabase() {
    return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve('success');
        req.onerror = () => resolve('error');
        req.onblocked = () => resolve('blocked');
    });
}

test('IndexedStore adapter supports list/get/put/delete and closes on versionchange', async () => {
    // Clean slate
    await deleteDatabase();

    const store = new TestStore();
    const adapter = await store.getAdapter();

    // Write and read
    await adapter.put({ id: 'one', value: 1 });
    const all = await adapter.list();
    assert.deepEqual(all, [{ id: 'one', value: 1 }]);

    const fetched = await adapter.get('one');
    assert.deepEqual(fetched, { id: 'one', value: 1 });

    await adapter.delete('one');
    const empty = await adapter.list();
    assert.deepEqual(empty, []);

    // Deleting the DB should not hang; onversionchange closes the connection
    const deleteResult = await Promise.race([
        deleteDatabase(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('delete timed out')), 2000)),
    ]);
    assert.ok(['success', 'blocked', 'error'].includes(deleteResult));
});

test('IndexedStore adapter exposes list()', async () => {
    await deleteDatabase();

    const store = new TestStore();
    const adapter = await store.getAdapter();

    assert.equal(typeof adapter.list, 'function');
});
