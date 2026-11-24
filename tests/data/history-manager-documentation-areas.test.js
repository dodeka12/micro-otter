// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../../src/micro_otter/nodes/html/js/data/history-manager.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';

function createCollection() {
    const collection = new Collection({
        id: generateUuidV4(),
        title: 'Documentation area history',
        graphs: [{ id: 'graph-1', name: 'Test Graph', nodes: [], connections: [] }],
    });
    return { collection, graph: collection.getActiveGraph() };
}

function areaTitles(graph) {
    return graph.getDocumentationAreas().map((area) => area.title);
}

describe('HistoryManager documentation areas', () => {
    let collection;
    let historyManager;
    let graph;

    beforeEach(() => {
        ({ collection, graph } = createCollection());
        historyManager = new HistoryManager(collection);
    });

    it('records exactly one operation for a whole move gesture', () => {
        const area = graph.addDocumentationArea({
            title: 'Moved',
            bounds: { x: 0, y: 0, width: 300, height: 200 },
        });
        const depthAfterCreate = historyManager.getHistoryDepth();

        graph.startDocumentationAreaDrag(area.id, 'move');
        graph.setDocumentationAreaBounds(area.id, { x: 20, y: 0, width: 300, height: 200 });
        graph.setDocumentationAreaBounds(area.id, { x: 40, y: 10, width: 300, height: 200 });
        graph.setDocumentationAreaBounds(area.id, { x: 60, y: 20, width: 300, height: 200 });
        graph.endDocumentationAreaDrag(area.id);

        assert.equal(historyManager.getHistoryDepth(), depthAfterCreate + 1);

        historyManager.undo();

        assert.deepEqual(graph.getDocumentationArea(area.id).bounds, {
            x: 0,
            y: 0,
            width: 300,
            height: 200,
        });
    });

    it('labels a resize gesture in the operation description', () => {
        const area = graph.addDocumentationArea({ title: 'Resized' });

        graph.startDocumentationAreaDrag(area.id, 'resize');
        graph.setDocumentationAreaBounds(area.id, { x: 0, y: 0, width: 420, height: 260 });
        graph.endDocumentationAreaDrag(area.id);

        const operation = historyManager.serialize().operations.at(-1);
        assert.equal(operation.description, 'Resize documentation area');
        assert.equal(operation.type, 'documentation-area-bounds-changed');
    });

    it('records nothing for a gesture without a bounds change', () => {
        const area = graph.addDocumentationArea({ title: 'Idle' });
        const depthBefore = historyManager.getHistoryDepth();

        graph.startDocumentationAreaDrag(area.id, 'move');
        graph.endDocumentationAreaDrag(area.id);

        assert.equal(historyManager.getHistoryDepth(), depthBefore);
    });

    it('restores a deleted area with its id and index', () => {
        const first = graph.addDocumentationArea({ title: 'First' });
        const middle = graph.addDocumentationArea({ title: 'Middle', color: '#123456' });
        const last = graph.addDocumentationArea({ title: 'Last' });

        historyManager.beforeDocumentationAreaRemove(middle.id);
        graph.removeDocumentationArea(middle.id);
        assert.deepEqual(
            graph.getDocumentationAreas().map((area) => area.id),
            [first.id, last.id]
        );

        historyManager.undo();

        const restored = graph.getDocumentationAreas();
        assert.deepEqual(
            restored.map((area) => area.id),
            [first.id, middle.id, last.id]
        );
        assert.equal(restored[1].title, 'Middle');
        assert.equal(restored[1].color, '#123456');

        historyManager.redo();
        assert.deepEqual(
            graph.getDocumentationAreas().map((area) => area.id),
            [first.id, last.id]
        );
    });

    it('warns and records nothing when the delete pre-hook never ran', () => {
        const area = graph.addDocumentationArea({ title: 'Uncached' });
        const depthBefore = historyManager.getHistoryDepth();

        graph.removeDocumentationArea(area.id);

        assert.equal(historyManager.getHistoryDepth(), depthBefore);
        assert.equal(graph.getDocumentationAreas().length, 0);
    });

    it('undoes and redoes a create', () => {
        const area = graph.addDocumentationArea({
            title: 'Created',
            markdown: 'body',
            color: '#abcdef',
        });

        historyManager.undo();
        assert.equal(graph.getDocumentationAreas().length, 0);

        historyManager.redo();
        const restored = graph.getDocumentationAreas();
        assert.equal(restored.length, 1);
        assert.equal(restored[0].id, area.id);
        assert.equal(restored[0].title, 'Created');
        assert.equal(restored[0].markdown, 'body');
        assert.equal(restored[0].color, '#abcdef');
    });

    it('undoes each patched field independently', () => {
        const area = graph.addDocumentationArea({ title: 'Original', markdown: 'first' });

        graph.updateDocumentationArea(area.id, { title: 'Renamed' });
        graph.updateDocumentationArea(area.id, { markdown: 'second' });
        assert.equal(historyManager.getHistoryDepth(), 3);

        historyManager.undo();
        assert.equal(graph.getDocumentationArea(area.id).markdown, 'first');
        assert.equal(graph.getDocumentationArea(area.id).title, 'Renamed');

        historyManager.undo();
        assert.equal(graph.getDocumentationArea(area.id).title, 'Original');
    });

    it('undoes a colour change', () => {
        const area = graph.addDocumentationArea({ color: '#111111' });

        graph.updateDocumentationArea(area.id, { color: '#222222' });
        assert.equal(graph.getDocumentationArea(area.id).color, '#222222');

        historyManager.undo();
        assert.equal(graph.getDocumentationArea(area.id).color, '#111111');

        historyManager.redo();
        assert.equal(graph.getDocumentationArea(area.id).color, '#222222');
    });

    it('undoes and redoes a font-size change', () => {
        const area = graph.addDocumentationArea({ fontSize: 'normal' });

        graph.updateDocumentationArea(area.id, { fontSize: 'large' });
        assert.equal(graph.getDocumentationArea(area.id).fontSize, 'large');

        historyManager.undo();
        assert.equal(graph.getDocumentationArea(area.id).fontSize, 'normal');

        historyManager.redo();
        assert.equal(graph.getDocumentationArea(area.id).fontSize, 'large');
    });

    it('does not grow the stack when undoing and redoing', () => {
        const area = graph.addDocumentationArea({ title: 'Stable' });
        graph.updateDocumentationArea(area.id, { title: 'Changed' });
        const depth = historyManager.getHistoryDepth();

        historyManager.undo();
        historyManager.redo();

        assert.equal(historyManager.getHistoryDepth(), depth);
    });

    it('restores a delete after a serialize/deserialize round trip', () => {
        const area = graph.addDocumentationArea({ title: 'Survivor', fontSize: 'small' });
        historyManager.beforeDocumentationAreaRemove(area.id);
        graph.removeDocumentationArea(area.id);

        const serialized = historyManager.serialize();
        const target = createCollection();
        // A foreign id, so restoring the deleted area's own id cannot collide.
        target.graph.restoreDocumentationArea({ id: '99', title: 'placeholder' });
        const restoredManager = HistoryManager.deserialize(serialized, target.collection);

        restoredManager.undo();

        // Restored at the index it was deleted from, with its original id.
        assert.deepEqual(areaTitles(target.graph), ['Survivor', 'placeholder']);
        assert.equal(target.graph.getDocumentationAreas()[0].id, area.id);
        assert.equal(target.graph.getDocumentationAreas()[0].fontSize, 'small');
    });

    it('undoes node and area operations in reverse order', () => {
        const node = graph.addNode({ type: 'test-node', x: 10, y: 10 });
        const area = graph.addDocumentationArea({ title: 'Mixed' });

        graph.startNodeDrag(node.id);
        graph.updateNodePosition(node.id, 40, 50);
        graph.endNodeDrag(node.id);
        graph.startDocumentationAreaDrag(area.id, 'move');
        graph.setDocumentationAreaBounds(area.id, { x: 90, y: 90, width: 300, height: 200 });
        graph.endDocumentationAreaDrag(area.id);

        historyManager.undo();
        assert.deepEqual(graph.getDocumentationArea(area.id).bounds, {
            x: 0,
            y: 0,
            width: 320,
            height: 200,
        });
        assert.equal(graph.getNode(node.id).x, 40);

        historyManager.undo();
        assert.equal(graph.getNode(node.id).x, 10);
        assert.deepEqual(areaTitles(graph), ['Mixed']);
    });

    it('applies a bounds operation for a deleted area without throwing', () => {
        const area = graph.addDocumentationArea({ title: 'Going away' });
        graph.startDocumentationAreaDrag(area.id, 'move');
        graph.setDocumentationAreaBounds(area.id, { x: 70, y: 70, width: 300, height: 200 });
        graph.endDocumentationAreaDrag(area.id);

        historyManager.beforeDocumentationAreaRemove(area.id);
        graph.removeDocumentationArea(area.id);

        assert.doesNotThrow(() => historyManager.undo());
    });

    it('groups a delete into a single undo entry', () => {
        const areaA = graph.addDocumentationArea({ title: 'A' });
        graph.addDocumentationArea({ title: 'B' });
        const depthBefore = historyManager.getHistoryDepth();

        historyManager.beginGroup('Cut selection');
        historyManager.beforeDocumentationAreaRemove(areaA.id);
        graph.removeDocumentationArea(areaA.id);
        historyManager.endGroup();

        assert.equal(historyManager.getHistoryDepth(), depthBefore + 1);

        historyManager.undo();
        assert.deepEqual(areaTitles(graph), ['A', 'B']);
    });
});
