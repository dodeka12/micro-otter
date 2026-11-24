import assert from 'node:assert/strict';
import test from 'node:test';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

test('explicit node updates still mark collection dirty and bump minor version', () => {
    const graph = new NodeGraph({
        id: 'graph-1',
        name: 'Graph 1',
        nodes: [
            {
                id: 'node-1',
                type: 'core.math',
                x: 0,
                y: 0,
                controls: [],
                inputs: [],
                outputs: [],
                controlValues: {},
                inputDefaults: {},
            },
        ],
        connections: [],
    });

    const collection = new Collection({
        id: '123e4567-e89b-42d3-a456-426614174002',
        title: 'Explicit Edit Collection',
        deviceRuntimeId: 'general',
        version: '1.0.0',
        graphs: [graph],
        activeGraphIdx: 0,
    });

    assert.equal(collection.getVersionString(), '1.0.0');
    assert.equal(collection.getVersion().isDirty(), false);

    graph.updateNode('node-1', { x: 42 }, { x: 0 });

    assert.equal(collection.getVersion().dirty.minor, true);
    assert.equal(collection.getVersion().isDirty(), true);

    const wasBumped = collection.bumpVersionIfDirty();
    assert.equal(wasBumped, true);
    assert.equal(collection.getVersionString(), '1.1.0');
    assert.equal(collection.getVersion().isDirty(), false);
});
