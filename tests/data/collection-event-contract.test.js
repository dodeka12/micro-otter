import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';

describe('Collection event contract', () => {
    function createCollection() {
        return new Collection({
            id: generateUuidV4(),
            title: 'Test Collection',
            graphs: [{ id: 'graph-1', name: 'Graph 1', nodes: [], connections: [] }],
        });
    }

    it('emits typed title event payload', () => {
        const collection = createCollection();
        let received = null;

        collection.on('*', (event) => {
            if (event.name === 'title') {
                received = event;
            }
        });

        collection.setTitle('Renamed Collection');

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'Collection.TitleChanged.v1',
            'Collection listener'
        );
        assert.equal(validated.detail.title, 'Renamed Collection');
        assert.equal(validated.detail.collectionId, collection.getId());
    });

    it('emits typed graphAdded payload with graph reference', () => {
        const collection = createCollection();
        let received = null;

        collection.on('*', (event) => {
            if (event.name === 'graphAdded') {
                received = event;
            }
        });

        const graph = new NodeGraph({ id: 'graph-2', name: 'Graph 2' });
        collection.addGraph(graph);

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'Collection.GraphAdded.v1',
            'Collection listener'
        );
        assert.equal(validated.detail.graph.getId(), 'graph-2');
    });

    it('forwards node graph events through Collection.GraphEvent.v1 payload', () => {
        const collection = createCollection();
        let received = null;

        collection.on('*', (event) => {
            if (event.name === 'graph') {
                received = event;
            }
        });

        const activeGraph = collection.getActiveGraph();
        activeGraph.setName('Graph Renamed');

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'Collection.GraphEvent.v1',
            'Collection graph bridge listener'
        );
        assert.equal(validated.detail.type, 'name');
        assert.equal(validated.detail.graphEventPayloadTypeId, 'NodeGraph.NameChanged.v1');
        assert.equal(validated.detail.graphId, activeGraph.getId());
    });

    it('reconciles interrupt references when a node-updated rename crosses the bridge', () => {
        const collection = new Collection({
            id: generateUuidV4(),
            title: 'Test Collection',
            graphs: [
                {
                    id: 'graph-init',
                    name: 'Init',
                    nodes: [
                        {
                            id: 'd1',
                            type: 'irq.interrupt-input',
                            controlValues: { triggerName: 'old' },
                        },
                    ],
                    connections: [],
                },
                {
                    id: 'graph-irq',
                    name: 'Irq',
                    triggerName: 'old',
                    nodes: [
                        {
                            id: 'r1',
                            type: 'irq.interrupt-enable',
                            controlValues: { triggerName: 'old' },
                        },
                    ],
                    connections: [],
                },
            ],
            activeGraphIdx: 0,
        });

        const declaring = collection.getGraphById('graph-init');
        const irqGraph = collection.getGraphById('graph-irq');

        declaring.updateNode(
            'd1',
            { controlValues: { triggerName: 'new' } },
            { controlValues: { triggerName: 'old' } }
        );

        assert.equal(irqGraph.getNode('r1').controlValues.triggerName, 'new');
        assert.equal(irqGraph.getTriggerName(), 'new');
    });
});
