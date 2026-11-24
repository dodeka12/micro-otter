/**
 * Test for Collection.getGraphs() regression
 * 
 * This test verifies that Collection.getGraphs() correctly returns
 * a plain object with graph IDs as keys.
 * 
 * Bug: getGraphs() was calling forEach with Map semantics on an array,
 * causing it to return undefined.
 * 
 * Fix: Changed forEach((graph, graphId) => ...) to forEach((graph) => ...)
 * and use graph.getId() to get the key.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';

test('Collection.getGraphs() returns object keyed by graph IDs', () => {
    const collection = new Collection({
        id: generateUuidV4(),
        title: 'Test',
        deviceRuntimeId: 'general',
        targetId: 'esp32',
        graphs: [
            new NodeGraph({ id: 'graph-1', name: 'First' }),
            new NodeGraph({ id: 'graph-2', name: 'Second' }),
            new NodeGraph({ id: 'graph-3', name: 'Third' })
        ],
        activeGraphIdx: 0
    });

    const graphs = collection.getGraphs();
    
    // Should return a plain object, not undefined
    assert.ok(graphs !== undefined, 'getGraphs() should not return undefined');
    assert.equal(typeof graphs, 'object', 'getGraphs() should return an object');
    
    // Should have correct keys
    const keys = Object.keys(graphs);
    assert.equal(keys.length, 3, 'Should have 3 graphs');
    assert.ok(keys.includes('graph-1'), 'Should have graph-1');
    assert.ok(keys.includes('graph-2'), 'Should have graph-2');
    assert.ok(keys.includes('graph-3'), 'Should have graph-3');
    
    // Should have correct values
    assert.equal(graphs['graph-1'].getName(), 'First');
    assert.equal(graphs['graph-2'].getName(), 'Second');
    assert.equal(graphs['graph-3'].getName(), 'Third');
});

test('Collection.getGraphs() works after serialization round-trip', () => {
    const original = new Collection({
        id: generateUuidV4(),
        title: 'Test',
        deviceRuntimeId: 'general',
        targetId: 'esp32',
        graphs: [
            new NodeGraph({ id: 'graph-a', name: 'Alpha' }),
            new NodeGraph({ id: 'graph-b', name: 'Beta' })
        ],
        activeGraphIdx: 0
    });

    // Serialize and deserialize
    const data = original.toData();
    const restored = Collection.fromData(data);
    
    // getGraphs() should work on restored instance
    const graphs = restored.getGraphs();
    
    assert.ok(graphs !== undefined, 'getGraphs() should not return undefined after restore');
    assert.equal(typeof graphs, 'object', 'getGraphs() should return an object after restore');
    
    const keys = Object.keys(graphs);
    assert.equal(keys.length, 2, 'Should have 2 graphs after restore');
    assert.ok(keys.includes('graph-a'), 'Should have graph-a after restore');
    assert.ok(keys.includes('graph-b'), 'Should have graph-b after restore');
    
    assert.equal(graphs['graph-a'].getName(), 'Alpha');
    assert.equal(graphs['graph-b'].getName(), 'Beta');
});
