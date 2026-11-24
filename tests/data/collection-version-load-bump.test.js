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

test('loadCollection bumps dirty version and clears dirty flags', async () => {
    await deleteDatabase();

    const store = new CollectionStore();
    const adapter = await store.getAdapter();
    const id = '123e4567-e89b-42d3-a456-426614174000';

    await adapter.put({
        id,
        title: 'Dirty Collection',
        targetId: 'generic_micropython',
        deviceRuntimeId: 'general',
        version: {
            major: 1,
            minor: 2,
            patch: 3,
            dirty: { major: false, minor: true, patch: false },
        },
        graphs: [
            {
                id: 'graph-1',
                name: 'Graph 1',
                triggerIntervalMs: 100,
                highlightColor: '#16a34a',
                nodes: [],
                connections: [],
                nodeCounter: 0,
                viewportConfig: { translateX: 0, translateY: 0, scale: 1 },
            },
        ],
        activeGraphIdx: 0,
    });

    const manager = new CollectionManager({ collectionStore: store });
    const loaded = await manager.loadCollection(id);

    assert.ok(loaded, 'Expected collection to load');
    assert.equal(loaded.getVersionString(), '1.3.0');
    assert.equal(loaded.getVersion().isDirty(), false);

    const persisted = await adapter.get(id);
    assert.deepEqual(persisted.version, {
        major: 1,
        minor: 3,
        patch: 0,
        dirty: { major: false, minor: false, patch: false },
    });
});
