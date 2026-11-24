import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';

function buildCollection() {
    const collection = new Collection({
        id: generateUuidV4(),
        title: 'Documentation areas',
        deviceRuntimeId: 'general',
        targetId: 'esp32',
        graphs: [
            new NodeGraph({ id: 'graph-a', name: 'Graph A' }),
            new NodeGraph({ id: 'graph-b', name: 'Graph B' }),
        ],
        activeGraphIdx: 0,
    });

    const graphs = collection.getGraphs();
    return { collection, graphA: graphs['graph-a'], graphB: graphs['graph-b'] };
}

describe('Collection documentation areas', () => {
    it('keeps areas attached to their own graph across a save/load cycle', () => {
        const { collection, graphA, graphB } = buildCollection();

        graphA.addDocumentationArea({
            title: 'A one',
            markdown: '**a**',
            color: '#112233',
            fontSize: 'large',
            bounds: { x: 10, y: 20, width: 300, height: 200 },
        });
        graphA.addDocumentationArea({ title: 'A two' });
        graphB.addDocumentationArea({ title: 'B one', color: '#445566' });

        const reloaded = Collection.fromData(collection.toData());
        const reloadedGraphs = reloaded.getGraphs();

        assert.deepEqual(
            reloadedGraphs['graph-a'].getDocumentationAreas().map((area) => area.title),
            ['A one', 'A two']
        );
        assert.deepEqual(
            reloadedGraphs['graph-b'].getDocumentationAreas().map((area) => area.title),
            ['B one']
        );
        assert.equal(reloadedGraphs['graph-b'].getDocumentationAreas()[0].color, '#445566');
        assert.equal(reloadedGraphs['graph-a'].getDocumentationAreas()[0].fontSize, 'large');
    });

    it('preserves areas through a graph metadata update', () => {
        const { collection, graphA } = buildCollection();
        graphA.addDocumentationArea({ title: 'Keep me', markdown: 'body' });

        assert.equal(collection.updateGraph('graph-a', { name: 'Renamed' }), true);

        const updated = collection.getGraphs()['graph-a'];
        assert.equal(updated.getName(), 'Renamed');
        assert.deepEqual(
            updated.getDocumentationAreas().map((area) => area.title),
            ['Keep me']
        );
    });

    it('loads a legacy document that has no documentationAreas key', () => {
        const { collection, graphA } = buildCollection();
        graphA.addDocumentationArea({ title: 'Doomed' });

        const legacyData = collection.toData();
        for (const graph of legacyData.graphs) {
            delete graph.documentationAreas;
        }

        const reloaded = Collection.fromData(legacyData);

        assert.deepEqual(reloaded.getGraphs()['graph-a'].getDocumentationAreas(), []);
        assert.deepEqual(reloaded.getGraphs()['graph-b'].getDocumentationAreas(), []);
    });

    it('tolerates a null or invalid documentationAreas array', () => {
        const { collection } = buildCollection();
        const data = collection.toData();
        data.graphs[0].documentationAreas = null;
        data.graphs[1].documentationAreas = 'not-an-array';

        const reloaded = Collection.fromData(data);

        assert.deepEqual(reloaded.getGraphs()['graph-a'].getDocumentationAreas(), []);
        assert.deepEqual(reloaded.getGraphs()['graph-b'].getDocumentationAreas(), []);
    });
});



describe('Collection documentation area event channel', () => {
    it('forwards area events to onGraphChange listeners', () => {
        const { collection, graphA } = buildCollection();
        const seen = [];
        collection.onGraphChange((event) => seen.push(event.name));

        const area = graphA.addDocumentationArea({ title: 'Forwarded' });
        graphA.updateDocumentationArea(area.id, { markdown: 'body' });
        graphA.setDocumentationAreaBounds(area.id, { x: 5, y: 5, width: 300, height: 200 });
        graphA.startDocumentationAreaDrag(area.id);
        graphA.endDocumentationAreaDrag(area.id);
        graphA.removeDocumentationArea(area.id);

        assert.deepEqual(seen, [
            'documentation-area-added',
            'documentation-area-updated',
            'documentation-area-bounds-changed',
            'documentation-area-drag-started',
            'documentation-area-drag-ended',
            'documentation-area-removed',
        ]);
    });

    it('re-emits each area event on the collection event channel', () => {
        const { collection, graphA } = buildCollection();
        const seen = [];
        collection.on('graph', (event) => seen.push(event.detail.graphEventName));

        graphA.addDocumentationArea({ title: 'Bubbled' });

        assert.deepEqual(seen, ['documentation-area-added']);
        assert.equal(seen.length, 1);
    });

    it('marks the collection patch version dirty for an area edit', () => {
        const { collection, graphA } = buildCollection();
        const before = collection.toData().version;

        graphA.addDocumentationArea({ title: 'Dirty' });

        assert.equal(collection.bumpVersionIfDirty(), true);
        const after = collection.toData().version;
        assert.equal(after.dirty.major, false);
        assert.equal(after.dirty.minor, false);
        assert.equal(after.dirty.patch, false);
        assert.equal(after.major, before.major);
        assert.equal(after.minor, before.minor);
        assert.equal(after.patch, before.patch + 1);
    });
});
