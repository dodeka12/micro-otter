import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

describe('NodeGraph ID normalization', () => {
    it('normalizes legacy numeric node and connection IDs to strings on load', () => {
        const graph = NodeGraph.fromData({
            id: 'graph-legacy',
            nodes: [
                {
                    id: 1,
                    type: 'source',
                    outputs: [{ id: 'out0', outputType: 'float' }],
                },
                {
                    id: 2,
                    type: 'target',
                    inputs: [{ id: 'in0', allowedTypes: ['float'] }],
                },
            ],
            connections: [{ fromNode: 1, fromIndex: 0, toNode: 2, toIndex: 0 }],
        });

        const ids = graph.getNodeIds();
        assert.deepEqual(ids, ['1', '2']);
        assert.equal(graph.getNode(1)?.id, '1');
        assert.equal(graph.getNode('2')?.id, '2');

        const [connection] = graph.getConnections();
        assert.equal(connection.fromNode, '1');
        assert.equal(connection.toNode, '2');
    });

    it('generates string node IDs for newly added nodes', () => {
        const graph = new NodeGraph({ id: 'graph-new' });

        const nodeA = graph.addNode({ type: 'test' });
        const nodeB = graph.addNode({ type: 'test' });

        assert.equal(typeof nodeA.id, 'string');
        assert.equal(typeof nodeB.id, 'string');
        assert.equal(nodeA.id, '1');
        assert.equal(nodeB.id, '2');
    });
});
