// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tests for persisted graph reordering in Collection.
 *
 * Graph order lives in `Collection.#graphs`; `moveGraph()` remaps the active index by
 * identity and emits `Collection.GraphMoved.v1` once per successful move.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AppEvent, assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

const COLLECTION_ID = '11111111-1111-4111-8111-111111111111';

function createCollection({ ids = ['g0', 'g1', 'g2', 'g3'], activeGraphIdx = 0 } = {}) {
    return new Collection({
        id: COLLECTION_ID,
        title: 'Reorder Collection',
        deviceRuntimeId: 'general',
        graphs: ids.map((id) => ({
            id,
            name: id.toUpperCase(),
            nodes: [],
            connections: [],
        })),
        activeGraphIdx,
    });
}

function graphIds(collection) {
    return collection.getGraphArray().map((graph) => graph.getId());
}

function recordEvents(collection) {
    const events = [];
    collection.on('*', (event) => events.push(event));
    return events;
}

function graphMovedEvents(events) {
    return events.filter((event) => event.name === 'graphMoved');
}

describe('Collection graph reorder contract', () => {
    it('emits a typed Collection.GraphMoved.v1 AppEvent with exact indices', () => {
        const collection = createCollection();
        const events = recordEvents(collection);

        assert.equal(collection.moveGraph('g0', 3), true);

        const moved = graphMovedEvents(events);
        assert.equal(moved.length, 1);
        assert.ok(moved[0] instanceof AppEvent);

        const validated = assertAppEventPayloadType(
            moved[0],
            'Collection.GraphMoved.v1',
            [
                {
                    name: 'collectionId',
                    validate: (value) => value === COLLECTION_ID,
                    expected: 'collection id',
                },
                {
                    name: 'graphId',
                    validate: (value) => value === 'g0',
                    expected: 'graph id',
                },
                {
                    name: 'fromIndex',
                    validate: (value) => value === 0,
                    expected: 'zero',
                },
                {
                    name: 'toIndex',
                    validate: (value) => value === 3,
                    expected: 'last index',
                },
            ],
            'Collection graphMoved listener'
        );

        assert.equal(validated.detail.collectionId, COLLECTION_ID);
        assert.equal(validated.detail.graphId, 'g0');
        assert.equal(validated.detail.fromIndex, 0);
        assert.equal(validated.detail.toIndex, 3);
        assert.equal(validated.detail.payloadTypeId, 'Collection.GraphMoved.v1');
        assert.notEqual(validated.detail.payloadTypeId, 'Collection.GraphMoved.v2');
    });

    it('emits exactly one graphMoved event per successful call', () => {
        const collection = createCollection();
        const events = recordEvents(collection);

        collection.moveGraph('g1', 3);
        collection.moveGraph('g1', 0);

        assert.equal(graphMovedEvents(events).length, 2);
        assert.deepEqual(
            graphMovedEvents(events).map((event) => [event.detail.fromIndex, event.detail.toIndex]),
            [
                [1, 3],
                [3, 0],
            ]
        );
    });
});

describe('Collection.moveGraph', () => {
    it('moves first to last and last to first', () => {
        const collection = createCollection();

        assert.equal(collection.moveGraph('g0', 3), true);
        assert.deepEqual(graphIds(collection), ['g1', 'g2', 'g3', 'g0']);

        assert.equal(collection.moveGraph('g0', 0), true);
        assert.deepEqual(graphIds(collection), ['g0', 'g1', 'g2', 'g3']);
    });

    it('moves middle tabs forward and backward', () => {
        const collection = createCollection();

        assert.equal(collection.moveGraph('g1', 2), true);
        assert.deepEqual(graphIds(collection), ['g0', 'g2', 'g1', 'g3']);

        assert.equal(collection.moveGraph('g1', 1), true);
        assert.deepEqual(graphIds(collection), ['g0', 'g1', 'g2', 'g3']);
    });

    it('treats toIndex as the final index, not an insertion gap', () => {
        const collection = createCollection();

        assert.equal(collection.moveGraph('g0', 2), true);
        assert.deepEqual(graphIds(collection), ['g1', 'g2', 'g0', 'g3']);
    });

    it('clamps out-of-range indices and rejects same-position moves', () => {
        const collection = createCollection();

        assert.equal(collection.moveGraph('g2', -5), true);
        assert.deepEqual(graphIds(collection), ['g2', 'g0', 'g1', 'g3']);

        assert.equal(collection.moveGraph('g2', 999), true);
        assert.deepEqual(graphIds(collection), ['g0', 'g1', 'g3', 'g2']);

        assert.equal(collection.moveGraph('g2', 3), false);
        assert.equal(collection.moveGraph('g0', 0), false);
        assert.deepEqual(graphIds(collection), ['g0', 'g1', 'g3', 'g2']);
    });
});

describe('Collection.moveGraph rejections', () => {
    it('rejects unknown ids and non-integer indices without emitting', () => {
        const collection = createCollection();
        const events = recordEvents(collection);
        const before = graphIds(collection);

        for (const toIndex of [NaN, 1.5, Infinity, -Infinity]) {
            assert.equal(collection.moveGraph('g0', toIndex), false);
        }
        assert.equal(collection.moveGraph('missing', 2), false);
        assert.equal(collection.moveGraph('', 2), false);

        assert.deepEqual(graphIds(collection), before);
        assert.equal(graphMovedEvents(events).length, 0);
        assert.equal(collection.getVersion().isDirty('major'), false);
    });

    it('rejects moves in a single-graph collection', () => {
        const collection = createCollection({ ids: ['only'] });
        const events = recordEvents(collection);

        assert.equal(collection.moveGraph('only', 0), false);
        assert.equal(collection.moveGraph('only', 1), false);
        assert.deepEqual(graphIds(collection), ['only']);
        assert.equal(graphMovedEvents(events).length, 0);
    });
});

describe('Collection.moveGraph mapping coherence', () => {
    it('rebuilds the id mapping after every move', () => {
        const collection = createCollection();

        assert.equal(collection.moveGraph('g0', 2), true);
        assert.deepEqual(graphIds(collection), ['g1', 'g2', 'g0', 'g3']);

        for (const id of ['g0', 'g1', 'g2', 'g3']) {
            assert.equal(collection.getGraphById(id).getId(), id);
        }
        assert.deepEqual(Object.keys(collection.getGraphs()).sort(), ['g0', 'g1', 'g2', 'g3']);

        // A stale mapping would make updateGraph() target the wrong graph.
        assert.equal(collection.updateGraph('g2', { name: 'Renamed Graph' }), true);
        assert.equal(collection.getGraphById('g2').getName(), 'Renamed Graph');
        assert.equal(collection.getGraphById('g0').getName(), 'G0');
    });

    it('keeps the same NodeGraph instances and listener binding', () => {
        const collection = createCollection();
        const before = collection.getGraphArray();
        const unregisterBefore = collection.unregisterGraphChangeHandler;

        assert.equal(collection.moveGraph('g1', 3), true);

        const after = collection.getGraphArray();
        assert.equal(after.length, before.length);
        assert.deepEqual(new Set(after), new Set(before));
        assert.equal(collection.unregisterGraphChangeHandler, unregisterBefore);
    });
});


describe('Collection.moveGraph active graph identity', () => {
    it('keeps a moved active graph active and reports its new index', () => {
        const collection = createCollection({ activeGraphIdx: 1 });

        assert.equal(collection.moveGraph('g1', 3), true);

        assert.deepEqual(graphIds(collection), ['g0', 'g2', 'g3', 'g1']);
        assert.equal(collection.getActiveGraph().getId(), 'g1');
        assert.equal(collection.getActiveGraphIdx(), 3);
    });

    it('remaps the active index when another graph crosses forward', () => {
        const collection = createCollection({ activeGraphIdx: 2 });

        assert.equal(collection.moveGraph('g1', 3), true);

        assert.deepEqual(graphIds(collection), ['g0', 'g2', 'g3', 'g1']);
        assert.equal(collection.getActiveGraph().getId(), 'g2');
        assert.equal(collection.getActiveGraphIdx(), 1);
    });

    it('remaps the active index when another graph crosses backward', () => {
        const collection = createCollection({ activeGraphIdx: 1 });

        assert.equal(collection.moveGraph('g3', 0), true);

        assert.deepEqual(graphIds(collection), ['g3', 'g0', 'g1', 'g2']);
        assert.equal(collection.getActiveGraph().getId(), 'g1');
        assert.equal(collection.getActiveGraphIdx(), 2);
    });

    it('leaves the active index alone when no graph crosses it', () => {
        const collection = createCollection({ activeGraphIdx: 1 });

        assert.equal(collection.moveGraph('g0', 1), true);

        assert.deepEqual(graphIds(collection), ['g1', 'g0', 'g2', 'g3']);
        assert.equal(collection.getActiveGraph().getId(), 'g1');
        assert.equal(collection.getActiveGraphIdx(), 0);
    });
});


describe('Collection.moveGraph events and versioning', () => {
    it('emits activeGraphIdx exactly when the numeric index changes', () => {
        const crossing = createCollection({ activeGraphIdx: 1 });
        const crossingEvents = recordEvents(crossing);

        assert.equal(crossing.moveGraph('g1', 3), true);

        const activeEvents = crossingEvents.filter((event) => event.name === 'activeGraphIdx');
        assert.equal(activeEvents.length, 1);
        assertAppEventPayloadType(
            activeEvents[0],
            'Collection.ActiveGraphIndexChanged.v1',
            'Collection activeGraphIdx listener'
        );
        assert.equal(activeEvents[0].detail.activeGraphIdx, 3);

        const untouched = createCollection({ activeGraphIdx: 2 });
        const untouchedEvents = recordEvents(untouched);

        assert.equal(untouched.moveGraph('g0', 1), true);
        assert.equal(
            untouchedEvents.filter((event) => event.name === 'activeGraphIdx').length,
            0
        );
    });

    it('emits graphMoved before activeGraphIdx', () => {
        const collection = createCollection({ activeGraphIdx: 1 });
        const events = recordEvents(collection);

        assert.equal(collection.moveGraph('g1', 3), true);

        const names = events.map((event) => event.name);
        assert.ok(names.indexOf('graphMoved') >= 0);
        assert.ok(names.indexOf('activeGraphIdx') > names.indexOf('graphMoved'));
    });

    it('marks only the major version dirty', () => {
        const collection = createCollection();
        assert.equal(collection.getVersion().isDirty('major'), false);

        assert.equal(collection.moveGraph('g0', 2), true);

        assert.equal(collection.getVersion().isDirty('major'), true);
        assert.equal(collection.getVersion().isDirty('minor'), false);
        assert.equal(collection.getVersion().isDirty('patch'), false);
    });

    it('round-trips graph order and active index through toData/fromData', () => {
        const collection = createCollection({ activeGraphIdx: 2 });
        assert.equal(collection.moveGraph('g1', 3), true);

        const restored = Collection.fromData(collection.toData());

        assert.deepEqual(graphIds(restored), ['g0', 'g2', 'g3', 'g1']);
        assert.equal(restored.getActiveGraphIdx(), 1);
        assert.equal(restored.getActiveGraph().getId(), 'g2');
        assert.equal(restored.toData().graphs.map((graph) => graph.id).join(','), 'g0,g2,g3,g1');
    });
});


describe('Collection graph reorder regressions', () => {
    it('keeps add, move, remove and re-add coherent', () => {
        const collection = createCollection({ ids: ['g0', 'g1'] });

        collection.addGraph(new NodeGraph({ id: 'g2', name: 'G2' }));
        assert.deepEqual(graphIds(collection), ['g0', 'g1', 'g2']);

        assert.equal(collection.moveGraph('g2', 0), true);
        assert.deepEqual(graphIds(collection), ['g2', 'g0', 'g1']);

        assert.equal(collection.removeGraph('g2'), true);
        assert.deepEqual(graphIds(collection), ['g0', 'g1']);

        collection.addGraph(new NodeGraph({ id: 'g2', name: 'G2 again' }));
        assert.deepEqual(graphIds(collection), ['g0', 'g1', 'g2']);
        assert.equal(collection.getGraphById('g2').getName(), 'G2 again');
        assert.ok(collection.getActiveGraphIdx() >= 0);
        assert.ok(collection.getActiveGraphIdx() < collection.getGraphArray().length);
        assert.equal(collection.getActiveGraph().getId(), 'g0');
    });

    it('applies the previous-graph fallback when the active graph is removed after a move', () => {
        const collection = createCollection({ activeGraphIdx: 2 });

        assert.equal(collection.moveGraph('g3', 0), true);
        assert.deepEqual(graphIds(collection), ['g3', 'g0', 'g1', 'g2']);
        assert.equal(collection.getActiveGraph().getId(), 'g2');

        assert.equal(collection.removeGraph('g2'), true);

        assert.deepEqual(graphIds(collection), ['g3', 'g0', 'g1']);
        assert.equal(collection.getActiveGraphIdx(), 2);
        assert.equal(collection.getActiveGraph().getId(), 'g1');
    });

    it('repairs a stale activeGraphIdx before and after a reorder round-trip', () => {
        const collection = createCollection({ activeGraphIdx: 1 });
        const staleData = { ...collection.toData(), activeGraphIdx: 99 };

        const first = Collection.fromDataWithRepair(staleData);
        assert.equal(first.collection.getActiveGraphIdx(), 0);
        assert.equal(first.repairs.length, 1);
        assert.equal(first.repairs[0].field, 'activeGraphIdx');
        assert.equal(first.repairs[0].nextValue, 0);

        assert.equal(collection.moveGraph('g3', 0), true);
        const reorderedStaleData = { ...collection.toData(), activeGraphIdx: 99 };
        const second = Collection.fromDataWithRepair(reorderedStaleData);

        assert.deepEqual(graphIds(second.collection), ['g3', 'g0', 'g1', 'g2']);
        assert.equal(second.collection.getActiveGraphIdx(), 0);
        assert.equal(second.repairs.length, 1);
        assert.equal(second.repairs[0].field, 'activeGraphIdx');
    });

    it('clone preserves the moved order and active graph', () => {
        const collection = createCollection({ activeGraphIdx: 2 });
        assert.equal(collection.moveGraph('g1', 3), true);

        const clone = collection.clone();

        assert.deepEqual(graphIds(clone), ['g0', 'g2', 'g3', 'g1']);
        assert.equal(clone.getActiveGraphIdx(), 1);
        assert.equal(clone.getActiveGraph().getId(), 'g2');
    });

    it('leaves the workspace persistence path as a regular collection change', () => {
        const collectionSource = readFileSync(
            new URL(
                '../../src/micro_otter/nodes/html/js/data/collection.ts',
                import.meta.url
            ),
            'utf8'
        );
        const workspaceSource = readFileSync(
            new URL('../../src/micro_otter/nodes/html/js/core/workspace.ts', import.meta.url),
            'utf8'
        );

        assert.match(collectionSource, /graphMoved` with `Collection\.GraphMoved\.v1/);
        assert.doesNotMatch(collectionSource, /Collection\.GraphMoved\.v2/);
        assert.doesNotMatch(workspaceSource, /graphMoved/);
    });
});

