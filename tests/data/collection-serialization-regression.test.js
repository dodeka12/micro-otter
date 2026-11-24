import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { cloneFixture } from '../helpers/fixtures/loaders.js';

const VALID_ID = '123e4567-e89b-42d3-a456-426614174000';

function createCollectionFixture() {
    return {
        id: VALID_ID,
        title: 'My Workspace',
        targetId: 'generic',
        webAssetGenerationMode: 'plain',
        version: {
            major: 1,
            minor: 2,
            patch: 3,
            dirty: { major: false, minor: true, patch: false },
        },
        graphs: [
            {
                id: 'graph-1',
                name: 'Graph A',
                triggerIntervalMs: 200,
                highlightColor: '#abc',
                nodes: [
                    {
                        id: 'node-1',
                        type: 'const',
                        outputs: [
                            {
                                id: 'out',
                                outputType: 'int',
                                allowedTypes: ['int'],
                                initialTypes: ['int'],
                            },
                        ],
                    },
                    {
                        id: 'node-2',
                        type: 'print',
                        inputs: [
                            {
                                id: 'in',
                                allowedTypes: ['int'],
                                initialTypes: ['int'],
                            },
                        ],
                    },
                ],
                connections: [{ fromNode: 'node-1', fromIndex: 0, toNode: 'node-2', toIndex: 0 }],
                nodeCounter: 5,
                viewportConfig: { translateX: 10, translateY: 20, scale: 1.1 },
            },
        ],
        activeGraphIdx: 0,
    };
}

describe('Collection serialization regression', () => {
    it('produces a stable serializable snapshot via toData()', () => {
        const source = Collection.fromData(createCollectionFixture());
        const snapshot = source.toData();

        assert.equal(snapshot.id, VALID_ID);
        assert.equal(snapshot.title, 'My Workspace');
        assert.equal(snapshot.targetId, 'generic');
        assert.equal(snapshot.webAssetGenerationMode, 'plain');
        assert.deepEqual(snapshot.version, {
            major: 1,
            minor: 2,
            patch: 3,
            dirty: { major: false, minor: true, patch: false },
        });
        assert.equal(snapshot.activeGraphIdx, 0);
        assert.equal(snapshot.graphs.length, 1);

        const [graph] = snapshot.graphs;
        assert.equal(graph.id, 'graph-1');
        assert.equal(graph.name, 'Graph A');
        assert.equal(graph.triggerIntervalMs, 200);
        assert.equal(graph.highlightColor, '#abc');
        assert.equal(graph.nodes.length, 2);
        assert.equal(graph.nodes[0].id, 'node-1');
        assert.equal(graph.nodes[0].type, 'const');
        assert.equal(graph.nodes[1].id, 'node-2');
        assert.equal(graph.nodes[1].type, 'print');
        assert.deepEqual(graph.connections, [
            { fromNode: 'node-1', fromIndex: 0, toNode: 'node-2', toIndex: 0 },
        ]);
        assert.deepEqual(graph.viewportConfig, { translateX: 10, translateY: 20, scale: 1.1 });

        graph.nodes[0].id = 'mutated-node';
        const graphAfterMutation = source.getGraphArray()[0].toData();
        assert.equal(graphAfterMutation.nodes[0].id, 'node-1');
    });

    it('round-trips a serialized snapshot through fromData()', () => {
        const base = createCollectionFixture();
        const source = Collection.fromData(base);
        const roundTripped = Collection.fromData(cloneFixture(source.toData()));

        assert.deepEqual(roundTripped.toData(), source.toData());
    });
});
