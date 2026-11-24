// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tests for graph removal and graph naming in the data layer.
 *
 * `Collection.getUniqueGraphName()` / `getUniqueGraphId()` own the naming rules and
 * `CollectionManager.removeGraph()` is the single command that deletes a graph while
 * keeping the "a collection always has at least one graph" invariant.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

function createManager(collection) {
    const collections = new Map();
    if (collection) {
        collections.set(collection.getId(), collection);
    }
    return new CollectionManager({
        collections,
        collectionStore: createCollectionStoreStub(),
        defaultDeviceRuntimeId: 'general',
    });
}

function createCollection(graphs) {
    return new Collection({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Removal Test',
        deviceRuntimeId: 'general',
        graphs,
    });
}

function recordEvents(collection) {
    const events = [];
    collection.on('*', (event) => {
        if (event.name === 'graphAdded' || event.name === 'graphRemoved') {
            events.push({ name: event.name, detail: event.detail });
        }
    });
    return events;
}

describe('Collection graph naming', () => {
    it('returns the first free graph name', () => {
        const unnamed = createCollection([{ id: 'graph-9', name: 'Solo' }]);
        assert.equal(unnamed.getUniqueGraphName(), 'Graph 1');

        const taken = createCollection([{ id: 'graph-1', name: 'Graph 1' }]);
        assert.equal(taken.getUniqueGraphName(), 'Graph 2');
    });

    it('honours a custom base name', () => {
        const collection = createCollection([
            { id: 'graph-1', name: 'Diagramm 1' },
            { id: 'graph-2', name: 'Diagramm 2' },
        ]);

        assert.equal(collection.getUniqueGraphName('Diagramm'), 'Diagramm 3');
    });

    it('falls back to the default base for an empty base name', () => {
        const collection = createCollection([{ id: 'graph-9', name: 'Solo' }]);

        assert.equal(collection.getUniqueGraphName('   '), 'Graph 1');
    });

    it('returns the first free graph id', () => {
        const unnamed = createCollection([{ id: 'solo', name: 'Solo' }]);
        assert.equal(unnamed.getUniqueGraphId(), 'graph-1');

        const taken = createCollection([
            { id: 'graph-1', name: 'Graph 1' },
            { id: 'graph-2', name: 'Graph 2' },
            { id: 'init-graph', name: 'Init' },
        ]);
        assert.equal(taken.getUniqueGraphId(), 'graph-3');
    });
});

describe('CollectionManager.removeGraph', () => {
    it('ignores unknown collection ids, unknown graph ids and empty ids', () => {
        const collection = createCollection([
            { id: 'graph-1', name: 'Graph 1' },
            { id: 'graph-2', name: 'Graph 2' },
        ]);
        const manager = createManager(collection);
        const events = recordEvents(collection);

        assert.equal(manager.removeGraph('missing-collection', 'graph-1'), false);
        assert.equal(manager.removeGraph('', 'graph-1'), false);
        assert.equal(manager.removeGraph(collection.getId(), 'missing-graph'), false);
        assert.equal(manager.removeGraph(collection.getId(), ''), false);

        assert.deepEqual(events, []);
        assert.equal(collection.getGraphArray().length, 2);
    });

    it('removes one of several graphs', () => {
        const collection = createCollection([
            { id: 'graph-1', name: 'Graph 1' },
            { id: 'graph-2', name: 'Graph 2' },
        ]);
        const manager = createManager(collection);
        const events = recordEvents(collection);

        assert.equal(manager.removeGraph(collection.getId(), 'graph-1'), true);

        assert.deepEqual(
            events.map((event) => event.name),
            ['graphRemoved']
        );
        assert.deepEqual(
            collection.getGraphArray().map((graph) => graph.getId()),
            ['graph-2']
        );
    });

    it('replaces the last graph before removing it', () => {
        const collection = createCollection([{ id: 'graph-9', name: 'Solo' }]);
        const manager = createManager(collection);
        const events = recordEvents(collection);

        assert.equal(manager.removeGraph(collection.getId(), 'graph-9'), true);

        assert.deepEqual(
            events.map((event) => event.name),
            ['graphAdded', 'graphRemoved']
        );

        const graphs = collection.getGraphArray();
        assert.equal(graphs.length, 1);
        assert.equal(graphs[0].getId(), 'graph-1');
        assert.equal(graphs[0].getName(), 'Graph 1');
    });

    it('uses the requested replacement base name', () => {
        const collection = createCollection([{ id: 'graph-9', name: 'Solo' }]);
        const manager = createManager(collection);

        assert.equal(
            manager.removeGraph(collection.getId(), 'graph-9', { replacementBaseName: 'Diagramm' }),
            true
        );

        assert.equal(collection.getGraphArray()[0].getName(), 'Diagramm 1');
    });

    it('refuses to remove the last graph when no replacement is allowed', () => {
        const collection = createCollection([{ id: 'graph-9', name: 'Solo' }]);
        const manager = createManager(collection);
        const events = recordEvents(collection);

        assert.equal(
            manager.removeGraph(collection.getId(), 'graph-9', { replacementBaseName: null }),
            false
        );

        assert.deepEqual(events, []);
        assert.equal(collection.getGraphArray().length, 1);
        assert.equal(collection.getGraphArray()[0].getId(), 'graph-9');
    });

    it('clamps the active graph index into range', () => {
        const collection = createCollection([
            { id: 'graph-1', name: 'Graph 1' },
            { id: 'graph-2', name: 'Graph 2' },
        ]);
        const manager = createManager(collection);

        collection.setActiveGraphIdx(1);
        assert.equal(manager.removeGraph(collection.getId(), 'graph-2'), true);

        const activeIdx = collection.getActiveGraphIdx();
        assert.ok(activeIdx >= 0 && activeIdx < collection.getGraphArray().length);
        assert.equal(collection.getActiveGraph().getId(), 'graph-1');
    });
});
