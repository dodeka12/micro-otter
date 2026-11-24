import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import {
    DOCUMENTATION_AREA_DEFAULT_COLOR,
    DOCUMENTATION_AREA_MIN_SIZE,
} from '../../src/micro_otter/nodes/html/js/data/documentation-area.js';

const AREA_EVENT_PREFIX = 'documentation-area';

function collectAreaEvents(graph) {
    const events = [];
    graph.on('*', (event) => {
        if (typeof event.name === 'string' && event.name.startsWith(AREA_EVENT_PREFIX)) {
            events.push(event);
        }
    });
    return events;
}

describe('NodeGraph documentation areas: creation', () => {
    it('assigns sequential ids and applies defaults', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const events = collectAreaEvents(graph);

        const first = graph.addDocumentationArea();
        const second = graph.addDocumentationArea({ title: 'Second' });

        assert.equal(first.id, '1');
        assert.equal(second.id, '2');
        assert.equal(first.title, '');
        assert.equal(first.markdown, '');
        assert.equal(first.color, DOCUMENTATION_AREA_DEFAULT_COLOR);
        assert.equal(first.fontSize, 'normal');
        assert.deepEqual(first.toData().bounds, { x: 0, y: 0, width: 320, height: 200 });
        assert.equal(events.length, 2);

        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.DocumentationAreaAdded.v1',
            'documentation area listener'
        );
        assert.equal(validated.detail.graphId, 'graph-1');
        assert.equal(validated.detail.areaId, '1');
    });

    it('does not mutate the caller input object', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const input = {
            title: 'Title',
            markdown: 'body',
            color: '#ABCDEF',
            fontSize: 'large',
            bounds: { x: 10, y: 20, width: 300, height: 200 },
        };

        const area = graph.addDocumentationArea(input);

        assert.equal(input.id, undefined);
        assert.equal(input.color, '#ABCDEF');
        assert.equal(input.fontSize, 'large');
        assert.equal(area.color, '#abcdef');
        assert.equal(area.fontSize, 'large');
        assert.equal(graph.getDocumentationAreas().length, 1);
    });

    it('returns detached area data from getDocumentationAreas()', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        graph.addDocumentationArea({ bounds: { x: 1, y: 2, width: 300, height: 200 } });

        const data = graph.getDocumentationAreas();
        data[0].bounds.x = 999;
        data.push({ id: 'x' });

        assert.equal(graph.getDocumentationArea('1').bounds.x, 1);
        assert.equal(graph.getDocumentationAreas().length, 1);
    });

    it('exposes live instances and index lookups', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({ title: 'A' });

        assert.equal(graph.getDocumentationArea(area.id), area);
        assert.equal(graph.getDocumentationArea('missing'), null);
        assert.equal(graph.getDocumentationAreaIndex(area.id), 0);
        assert.equal(graph.getDocumentationAreaIndex('missing'), -1);
        assert.equal(graph.hasDocumentationArea(area.id), true);
        assert.equal(graph.hasDocumentationArea('missing'), false);
    });
});

describe('NodeGraph documentation areas: restore', () => {
    it('preserves the id, inserts at the requested index and bumps the counter', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        graph.addDocumentationArea({ title: 'A' });
        graph.addDocumentationArea({ title: 'B' });

        const restored = graph.restoreDocumentationArea(
            { id: '7', title: 'Restored', markdown: '', color: '#123456' },
            1
        );

        assert.equal(restored.id, '7');
        assert.deepEqual(
            graph.getDocumentationAreas().map((area) => area.id),
            ['1', '7', '2']
        );

        const next = graph.addDocumentationArea();
        assert.equal(next.id, '8');
    });

    it('appends when no index is given and clamps out-of-range indexes', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        graph.restoreDocumentationArea({ id: 'A' });
        graph.restoreDocumentationArea({ id: 'B' }, 99);
        graph.restoreDocumentationArea({ id: 'C' }, -5);

        assert.deepEqual(
            graph.getDocumentationAreas().map((area) => area.id),
            ['C', 'A', 'B']
        );
    });

    it('rejects a duplicate or an invalid id', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        graph.restoreDocumentationArea({ id: '1' });

        assert.throws(() => graph.restoreDocumentationArea({ id: '1' }), /already exists/);
        assert.throws(() => graph.restoreDocumentationArea({ title: 'no id' }), TypeError);
    });

    it('continues the id sequence of a loaded graph', () => {
        const graph = NodeGraph.fromData({
            id: 'graph-1',
            documentationAreas: [
                { id: '3', title: 'three' },
                { id: '9', title: 'nine' },
            ],
        });

        assert.equal(graph.getDocumentationAreas().length, 2);
        assert.equal(graph.addDocumentationArea().id, '10');
    });

    it('skips entries without a usable id instead of throwing', () => {
        const graph = NodeGraph.fromData({
            id: 'graph-1',
            documentationAreas: [{ id: '2', title: 'kept' }, { title: 'dropped' }, null],
        });

        assert.deepEqual(
            graph.getDocumentationAreas().map((area) => area.id),
            ['2']
        );
    });

    it('normalizes font sizes loaded from document data', () => {
        const graph = NodeGraph.fromData({
            id: 'graph-1',
            documentationAreas: [
                { id: '1', fontSize: 'large' },
                { id: '2', fontSize: 'gigantic' },
                { id: '3' },
            ],
        });

        assert.deepEqual(
            graph.getDocumentationAreas().map((area) => area.fontSize),
            ['large', 'normal', 'normal']
        );
    });
});


describe('NodeGraph documentation areas: update', () => {
    it('patches only the provided keys and reports the previous values', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({ title: 'Old', markdown: 'body', color: '#111111' });
        const events = collectAreaEvents(graph);

        graph.updateDocumentationArea(area.id, { title: 'New' });

        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.DocumentationAreaUpdated.v1',
            'documentation area listener'
        );
        assert.deepEqual(validated.detail.patch, { title: 'New' });
        assert.deepEqual(validated.detail.previous, { title: 'Old' });
        assert.equal(area.title, 'New');
        assert.equal(area.markdown, 'body');
        assert.equal(area.color, '#111111');
    });

    it('normalizes an invalid colour to the default', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({ color: '#123456' });

        graph.updateDocumentationArea(area.id, { color: 'rgba(1,2,3,0.5)' });

        assert.equal(area.color, DOCUMENTATION_AREA_DEFAULT_COLOR);
    });

    it('records a font-size change and normalizes malformed presets', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({ fontSize: 'normal' });
        const events = collectAreaEvents(graph);

        graph.updateDocumentationArea(area.id, { fontSize: 'large' });

        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.DocumentationAreaUpdated.v1',
            'documentation area listener'
        );
        assert.deepEqual(validated.detail.patch, { fontSize: 'large' });
        assert.deepEqual(validated.detail.previous, { fontSize: 'normal' });
        assert.equal(area.fontSize, 'large');

        graph.updateDocumentationArea(area.id, { fontSize: 'gigantic' });
        assert.equal(area.fontSize, 'normal');
    });

    it('emits nothing when nothing changes', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({ title: 'Same', color: '#123456' });
        const events = collectAreaEvents(graph);

        graph.updateDocumentationArea(area.id, { title: 'Same' });
        graph.updateDocumentationArea(area.id, { color: '#123456' });
        graph.updateDocumentationArea(area.id, { fontSize: 'normal' });
        graph.updateDocumentationArea(area.id, {});

        assert.equal(events.length, 0);
    });

    it('returns null or false for an unknown id', () => {
        const graph = new NodeGraph({ id: 'graph-1' });

        assert.equal(graph.updateDocumentationArea('missing', { title: 'x' }), null);
        assert.equal(graph.setDocumentationAreaBounds('missing', { x: 1 }), null);
        assert.equal(graph.removeDocumentationArea('missing'), false);
        assert.equal(graph.startDocumentationAreaDrag('missing'), false);
        assert.equal(graph.endDocumentationAreaDrag('missing'), false);
    });
});


describe('NodeGraph documentation areas: bounds', () => {
    it('clamps to the minimum size and emits fresh bounds objects', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({
            bounds: { x: 0, y: 0, width: 300, height: 200 },
        });
        const events = collectAreaEvents(graph);

        graph.setDocumentationAreaBounds(area.id, { x: 40, y: 50, width: 10, height: 5 });

        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.DocumentationAreaBoundsChanged.v1',
            'documentation area listener'
        );
        assert.deepEqual(validated.detail.bounds, {
            x: 40,
            y: 50,
            width: DOCUMENTATION_AREA_MIN_SIZE.width,
            height: DOCUMENTATION_AREA_MIN_SIZE.height,
        });
        assert.deepEqual(validated.detail.previousBounds, {
            x: 0,
            y: 0,
            width: 300,
            height: 200,
        });

        validated.detail.bounds.x = 999;
        validated.detail.previousBounds.x = 999;
        assert.equal(area.bounds.x, 40);
        assert.deepEqual(graph.getDocumentationAreas()[0].bounds, {
            x: 40,
            y: 50,
            width: 120,
            height: 80,
        });
    });

    it('emits nothing for an unchanged or re-normalized identical input', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({
            bounds: { x: 10, y: 20, width: 300, height: 200 },
        });
        const events = collectAreaEvents(graph);


        graph.setDocumentationAreaBounds(area.id, { x: 10, y: 20, width: 300, height: 200 });
        graph.setDocumentationAreaBounds(area.id, { x: 10, y: 20, width: 300.0, height: 200 });

        assert.equal(events.length, 0);
    });
});




describe('NodeGraph documentation areas: removal and drag events', () => {
    it('removes an area without touching nodes or connections', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const source = graph.addNode({
            type: 'source',
            outputs: [{ id: 'out0', outputType: 'float' }],
        });
        const target = graph.addNode({
            type: 'target',
            inputs: [{ id: 'in0', allowedTypes: ['float'] }],
        });
        graph.addConnection({ fromNode: source.id, fromIndex: 0, toNode: target.id, toIndex: 0 });
        const area = graph.addDocumentationArea();
        const events = collectAreaEvents(graph);

        assert.equal(graph.removeDocumentationArea(area.id), true);

        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.DocumentationAreaRemoved.v1',
            'documentation area listener'
        );
        assert.equal(validated.detail.areaId, area.id);
        assert.equal(graph.getNodes().length, 2);
        assert.equal(graph.getConnections().length, 1);
        assert.equal(graph.removeDocumentationArea(area.id), false);
    });

    it('emits drag start with the gesture mode and drag end', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea();
        const events = collectAreaEvents(graph);

        assert.equal(graph.startDocumentationAreaDrag(area.id, 'resize'), true);
        assert.equal(graph.endDocumentationAreaDrag(area.id), true);

        const started = assertAppEventPayloadType(
            events[0],
            'NodeGraph.DocumentationAreaDragStarted.v1',
            'documentation area listener'
        );
        const ended = assertAppEventPayloadType(
            events[1],
            'NodeGraph.DocumentationAreaDragEnded.v1',
            'documentation area listener'
        );
        assert.equal(started.detail.mode, 'resize');
        assert.equal(started.detail.areaId, area.id);
        assert.equal(ended.detail.areaId, area.id);
    });

    it('defaults an unknown drag mode to move', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea();
        const events = collectAreaEvents(graph);

        graph.startDocumentationAreaDrag(area.id, 'bogus');

        assert.equal(events[0].detail.mode, 'move');
    });

    it('emits no area events while events are disabled', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const events = collectAreaEvents(graph);

        graph.disableEvents();
        const area = graph.addDocumentationArea();
        graph.updateDocumentationArea(area.id, { title: 'x' });
        graph.setDocumentationAreaBounds(area.id, { x: 5, y: 5, width: 300, height: 200 });
        graph.startDocumentationAreaDrag(area.id);
        graph.endDocumentationAreaDrag(area.id);
        graph.removeDocumentationArea(area.id);
        graph.enableEvents();

        assert.equal(events.length, 0);
    });
});

describe('NodeGraph documentation areas: serialization', () => {
    it('round-trips several areas through toData()/fromData()', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        graph.addDocumentationArea({
            title: 'First',
            markdown: '# heading',
            color: '#abc123',
            bounds: { x: 10, y: 20, width: 300, height: 250 },
        });
        graph.addDocumentationArea({
            title: 'Second',
            markdown: '$$x^2$$',
            color: '#000001',
            bounds: { x: -40, y: 100, width: 500, height: 400 },
        });

        const reloaded = NodeGraph.fromData(graph.toData());

        assert.deepEqual(reloaded.getDocumentationAreas(), graph.getDocumentationAreas());
    });

    it('degrades to an empty list for missing, null or non-array input', () => {
        for (const data of [
            {},
            { documentationAreas: null },
            { documentationAreas: 'nope' },
            { documentationAreas: 42 },
        ]) {
            assert.deepEqual(NodeGraph.fromData({ id: 'graph-1', ...data }).getDocumentationAreas(), []);
        }
    });

    it('detaches the serialized areas from the live graph', () => {
        const graph = new NodeGraph({ id: 'graph-1' });
        const area = graph.addDocumentationArea({ title: 'Live' });

        const data = graph.toData();
        data.documentationAreas[0].title = 'mutated';
        data.documentationAreas[0].bounds.x = 999;

        assert.equal(area.title, 'Live');
        assert.equal(area.bounds.x, 0);
    });
});
