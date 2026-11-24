import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { CollectionManager } from '../../src/micro_otter/nodes/html/js/data/collection-manager.js';

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

describe('CollectionManager event contract', () => {
    function createCollectionManager() {
        return new CollectionManager({
            collectionStore: createCollectionStoreStub(),
            defaultDeviceRuntimeId: 'general',
        });
    }

    it('emits typed activeCollectionChanged payload', async () => {
        const manager = createCollectionManager();
        const collection = await manager.createCollection({ setActive: false });

        let received = null;
        manager.on('*', (event) => {
            if (event.name === 'activeCollectionChanged') {
                received = event;
            }
        });

        manager.setActiveCollectionId(collection.getId());

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'CollectionManager.ActiveCollectionChanged.v1',
            'CollectionManager listener'
        );
        assert.equal(validated.detail.collectionId, collection.getId());
    });

    it('emits typed collectionAdded and collectionUpdated payloads', async () => {
        const manager = createCollectionManager();
        const collection = new Collection({
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Contract Test',
            deviceRuntimeId: 'general',
            graphs: [{ id: 'graph-1', name: 'Graph 1', nodes: [], connections: [] }],
        });

        const received = [];
        manager.on('*', (event) => {
            if (event.name === 'collectionAdded' || event.name === 'collectionUpdated') {
                received.push(event);
            }
        });

        await manager.saveCollection(collection);
        await manager.saveCollection(collection);

        assert.equal(received.length, 2);
        assertAppEventPayloadType(
            received[0],
            'CollectionManager.CollectionAdded.v1',
            'CollectionManager listener'
        );
        assertAppEventPayloadType(
            received[1],
            'CollectionManager.CollectionUpdated.v1',
            'CollectionManager listener'
        );
        assert.equal(received[0].detail.collectionId, collection.getId());
        assert.equal(received[1].detail.collectionId, collection.getId());
    });

    it('emits typed collectionRemoved payload', async () => {
        const manager = createCollectionManager();
        const collection = await manager.createCollection({ setActive: true });

        let received = null;
        manager.on('*', (event) => {
            if (event.name === 'collectionRemoved') {
                received = event;
            }
        });

        await manager.deleteCollection(collection.getId(), { ensureActive: false });

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'CollectionManager.CollectionRemoved.v1',
            'CollectionManager listener'
        );
        assert.equal(validated.detail.collectionId, collection.getId());
    });

    it('moves graphs through the collection manager and forwards the typed event', async () => {
        const manager = createCollectionManager();
        const collection = new Collection({
            id: '22222222-2222-4222-8222-222222222222',
            title: 'Manager Reorder',
            deviceRuntimeId: 'general',
            graphs: [
                { id: 'g0', name: 'G0', nodes: [], connections: [] },
                { id: 'g1', name: 'G1', nodes: [], connections: [] },
                { id: 'g2', name: 'G2', nodes: [], connections: [] },
            ],
            activeGraphIdx: 0,
        });
        await manager.saveCollection(collection);

        const managed = manager.getCollectionById(collection.getId());
        const events = [];
        managed.on('*', (event) => events.push(event));

        assert.equal(manager.moveGraph(collection.getId(), 'g2', 0), true);

        assert.deepEqual(
            managed.getGraphArray().map((graph) => graph.getId()),
            ['g2', 'g0', 'g1']
        );
        const moved = events.filter((event) => event.name === 'graphMoved');
        assert.equal(moved.length, 1);
        assertAppEventPayloadType(
            moved[0],
            'Collection.GraphMoved.v1',
            'CollectionManager collection listener'
        );
        assert.equal(moved[0].detail.collectionId, collection.getId());
        assert.equal(moved[0].detail.graphId, 'g2');
        assert.equal(moved[0].detail.fromIndex, 2);
        assert.equal(moved[0].detail.toIndex, 0);
    });

    it('ignores unknown collections and graphs without emitting', async () => {
        const manager = createCollectionManager();
        const collection = new Collection({
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Manager Reorder Guards',
            deviceRuntimeId: 'general',
            graphs: [
                { id: 'g0', name: 'G0', nodes: [], connections: [] },
                { id: 'g1', name: 'G1', nodes: [], connections: [] },
            ],
            activeGraphIdx: 0,
        });
        await manager.saveCollection(collection);

        const managed = manager.getCollectionById(collection.getId());
        const events = [];
        managed.on('*', (event) => events.push(event));
        const before = managed.getGraphArray().map((graph) => graph.getId());

        assert.equal(manager.moveGraph('missing-collection', 'g0', 1), false);
        assert.equal(manager.moveGraph(collection.getId(), 'missing-graph', 1), false);
        assert.equal(manager.moveGraph(collection.getId(), '', 1), false);
        assert.equal(manager.moveGraph(collection.getId(), 'g0', NaN), false);

        assert.deepEqual(
            managed.getGraphArray().map((graph) => graph.getId()),
            before
        );
        assert.equal(events.filter((event) => event.name === 'graphMoved').length, 0);
    });

    it('passes through the data layer no-op result', async () => {
        const manager = createCollectionManager();
        const collection = new Collection({
            id: '44444444-4444-4444-8444-444444444444',
            title: 'Manager Reorder No-op',
            deviceRuntimeId: 'general',
            graphs: [
                { id: 'g0', name: 'G0', nodes: [], connections: [] },
                { id: 'g1', name: 'G1', nodes: [], connections: [] },
            ],
            activeGraphIdx: 0,
        });
        await manager.saveCollection(collection);

        assert.equal(manager.moveGraph(collection.getId(), 'g0', 0), false);
    });

    it('emits one graphMoved event per consecutive move', async () => {
        const manager = createCollectionManager();
        const collection = new Collection({
            id: '55555555-5555-4555-8555-555555555555',
            title: 'Manager Reorder Sequence',
            deviceRuntimeId: 'general',
            graphs: [
                { id: 'g0', name: 'G0', nodes: [], connections: [] },
                { id: 'g1', name: 'G1', nodes: [], connections: [] },
                { id: 'g2', name: 'G2', nodes: [], connections: [] },
            ],
            activeGraphIdx: 0,
        });
        await manager.saveCollection(collection);

        const managed = manager.getCollectionById(collection.getId());
        const moved = [];
        managed.on('*', (event) => {
            if (event.name === 'graphMoved') {
                moved.push(event);
            }
        });

        assert.equal(manager.moveGraph(collection.getId(), 'g0', 2), true);
        assert.equal(manager.moveGraph(collection.getId(), 'g0', 0), true);

        assert.equal(moved.length, 2);
        assert.deepEqual(
            moved.map((event) => [event.detail.fromIndex, event.detail.toIndex]),
            [
                [0, 2],
                [2, 0],
            ]
        );
    });
});

