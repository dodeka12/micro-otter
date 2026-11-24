import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppPayload, assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

const EXPECTED_TYPES = {
    'documentation-area-added': 'NodeGraph.DocumentationAreaAdded.v1',
    'documentation-area-updated': 'NodeGraph.DocumentationAreaUpdated.v1',
    'documentation-area-bounds-changed': 'NodeGraph.DocumentationAreaBoundsChanged.v1',
    'documentation-area-drag-started': 'NodeGraph.DocumentationAreaDragStarted.v1',
    'documentation-area-drag-ended': 'NodeGraph.DocumentationAreaDragEnded.v1',
    'documentation-area-removed': 'NodeGraph.DocumentationAreaRemoved.v1',
};

function recordAreaEvents(graph) {
    const events = [];
    graph.on('*', (event) => {
        if (typeof event.name === 'string' && event.name.startsWith('documentation-area')) {
            events.push(event);
        }
    });
    return events;
}

function exerciseEveryAreaEvent(graph) {
    const area = graph.addDocumentationArea({ title: 'Doc', color: '#123456' });
    graph.updateDocumentationArea(area.id, { title: 'Renamed' });
    graph.setDocumentationAreaBounds(area.id, { x: 20, y: 30, width: 300, height: 200 });
    graph.startDocumentationAreaDrag(area.id, 'move');
    graph.endDocumentationAreaDrag(area.id);
    graph.removeDocumentationArea(area.id);
    return area;
}

describe('NodeGraph documentation area payloads', () => {
    it('emits every documented event name with a typed payload', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const events = recordAreaEvents(graph);

        exerciseEveryAreaEvent(graph);

        assert.deepEqual(
            events.map((event) => event.name),
            Object.keys(EXPECTED_TYPES)
        );

        for (const event of events) {
            assert.ok(event.detail instanceof AppPayload, `${event.name} payload type`);
            const validated = assertAppEventPayloadType(
                event,
                EXPECTED_TYPES[event.name],
                'documentation area payload test'
            );
            assert.equal(validated.detail.graphId, 'graph-1');
            assert.equal(typeof validated.detail.areaId, 'string');
        }
    });

    it('carries the changed keys only, and does not alias the graph state', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const events = recordAreaEvents(graph);
        const area = graph.addDocumentationArea({ title: 'Doc', markdown: 'body' });

        graph.updateDocumentationArea(area.id, {
            markdown: 'new body',
            color: '#00ff00',
            fontSize: 'small',
        });

        const update = assertAppEventPayloadType(
            events[1],
            'NodeGraph.DocumentationAreaUpdated.v1',
            'documentation area payload test'
        );
        assert.deepEqual(Object.keys(update.detail.patch).sort(), [
            'color',
            'fontSize',
            'markdown',
        ]);
        assert.deepEqual(update.detail.previous, {
            markdown: 'body',
            color: '#4a90d9',
            fontSize: 'normal',
        });

        update.detail.patch.markdown = 'mutated';
        update.detail.previous.markdown = 'mutated';
        assert.equal(area.markdown, 'new body');
        assert.equal(area.fontSize, 'small');
        assert.equal(area.title, 'Doc');
    });
});
