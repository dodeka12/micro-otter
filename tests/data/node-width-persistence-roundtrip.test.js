import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

describe('Node width persistence roundtrip', () => {
    it('preserves NodeData width across toData/fromData', () => {
        const original = new NodeData({
            id: 'node-1',
            type: 'core.width',
            width: 233,
            height: 90,
            inputs: [],
            outputs: [],
            controls: [],
            controlValues: {},
            inputDefaults: {},
        });

        const serialized = original.toData();
        const restored = NodeData.fromData(serialized);

        assert.equal(serialized.width, 233);
        assert.equal(restored.width, 233);
    });

    it('preserves resized widths across NodeGraph toData/fromData', () => {
        const graph = new NodeGraph({
            id: 'graph-widths',
            nodes: [
                {
                    id: 'node-a',
                    type: 'core.a',
                    x: 10,
                    y: 20,
                    width: 180,
                    height: 90,
                    inputs: [],
                    outputs: [],
                    controls: [],
                    controlValues: {},
                    inputDefaults: {},
                },
                {
                    id: 'node-b',
                    type: 'core.b',
                    x: 120,
                    y: 40,
                    width: 246,
                    height: 90,
                    inputs: [],
                    outputs: [],
                    controls: [],
                    controlValues: {},
                    inputDefaults: {},
                },
            ],
        });

        const serialized = graph.toData();
        const restored = NodeGraph.fromData(serialized);
        const restoredData = restored.toData();

        const widths = restoredData.nodes.map((node) => node.width);
        assert.deepEqual(widths, [180, 246]);
    });
});
