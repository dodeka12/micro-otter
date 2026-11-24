// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Cross-graph clipboard behaviour for documentation areas.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clipboardManager } from '../../src/micro_otter/nodes/html/js/core/clipboard-manager.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { DOCUMENTATION_AREA_DEFAULT_COLOR } from '../../src/micro_otter/nodes/html/js/data/documentation-area.js';

function buildGraph(id = 'graph-a') {
    const graph = new NodeGraph({ id, name: id });

    graph.addNode({
        type: 'const',
        title: 'Constant',
        x: 100,
        y: 100,
        outputs: [{ id: 'out0', name: 'Value', outputType: 'float' }],
    });
    graph.addNode({
        type: 'print',
        title: 'Print',
        x: 200,
        y: 100,
        inputs: [{ id: 'in0', name: 'Value', allowedTypes: ['float'] }],
    });

    return graph;
}

function addArea(graph, overrides = {}) {
    return graph.addDocumentationArea({
        title: 'Doc',
        markdown: '**body**',
        color: '#4a90d9',
        bounds: { x: 100, y: 100, width: 300, height: 200 },
        ...overrides,
    });
}

describe('clipboard-manager documentation areas', () => {
    beforeEach(() => {
        clipboardManager.clear();
    });

    afterEach(() => {
        clipboardManager.clear();
    });

    it('copies an area without any node selection', () => {
        const graph = buildGraph();
        const area = addArea(graph);

        assert.equal(clipboardManager.copy(graph, [], { areaIds: [area.id] }), true);
        assert.equal(clipboardManager.hasData(), true);
        assert.equal(clipboardManager.getAreaCount(), 1);
        assert.equal(clipboardManager.getNodeCount(), 0);
    });

    it('skips unknown area ids and still returns false for an empty payload', () => {
        const graph = buildGraph();

        assert.equal(clipboardManager.copy(graph, [], { areaIds: ['missing'] }), false);
        assert.equal(clipboardManager.hasData(), false);
        assert.equal(clipboardManager.copy(graph, []), false);
    });

    it('pastes into another graph with a fresh id and the bbox at the paste point', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        const area = addArea(source);

        clipboardManager.copy(source, [], { areaIds: [area.id] });
        const newNodeIds = clipboardManager.paste(target, { x: 400, y: 300 });

        assert.deepEqual(newNodeIds, []);
        const pasted = target.getDocumentationAreas();
        assert.equal(pasted.length, 1);
        // Ids are per graph: the target counter assigns a fresh one ('1' here), never `_originalId`.
        assert.equal(pasted[0].id, '1');
        assert.equal(pasted[0].title, 'Doc');
        assert.equal(pasted[0].markdown, '**body**');
        assert.equal(pasted[0].color, '#4a90d9');
        assert.equal(pasted[0].fontSize, 'normal');
        assert.deepEqual(pasted[0].bounds, { x: 400, y: 300, width: 300, height: 200 });
        assert.deepEqual(clipboardManager.getLastPastedAreaIds(), [pasted[0].id]);
    });

    it('preserves the font-size preset and defaults an older payload', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        const area = addArea(source, { fontSize: 'large' });

        clipboardManager.copy(source, [], { areaIds: [area.id] });
        clipboardManager.paste(target, { x: 400, y: 300 });
        assert.equal(target.getDocumentationAreas()[0].fontSize, 'large');

        delete clipboardManager._clipboard.documentationAreas[0].data.fontSize;
        clipboardManager.paste(target, { x: 700, y: 300 });
        assert.equal(target.getDocumentationAreas()[1].fontSize, 'normal');
    });

    it('leaves the source untouched, including when pasting into the same graph', () => {
        const graph = buildGraph();
        const area = addArea(graph);

        clipboardManager.copy(graph, [], { areaIds: [area.id] });
        clipboardManager.paste(graph, { x: 500, y: 500 });

        const areas = graph.getDocumentationAreas();
        assert.equal(areas.length, 2);
        assert.equal(areas[0].id, area.id);
        assert.deepEqual(areas[0].bounds, { x: 100, y: 100, width: 300, height: 200 });
    });

    it('nudges a second paste so two pastes do not share an origin', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        addArea(source);
        clipboardManager.copy(source, [], { areaIds: ['1'] });

        clipboardManager.paste(target, { x: 400, y: 300 });
        clipboardManager.paste(target, { x: 400, y: 300 });

        const bounds = target.getDocumentationAreas().map((entry) => entry.bounds);
        assert.equal(bounds.length, 2);
        assert.notDeepEqual(
            { x: bounds[0].x, y: bounds[0].y },
            { x: bounds[1].x, y: bounds[1].y }
        );
    });

    it('keeps the relative offsets of several areas', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        const first = addArea(source, { bounds: { x: 100, y: 100, width: 200, height: 100 } });
        const second = addArea(source, { bounds: { x: 400, y: 250, width: 200, height: 100 } });

        clipboardManager.copy(source, [], { areaIds: [first.id, second.id] });
        clipboardManager.paste(target, { x: 1000, y: 1000 });

        const pasted = target.getDocumentationAreas();
        assert.equal(pasted.length, 2);
        assert.equal(pasted[0].bounds.x, 1000);
        assert.equal(pasted[0].bounds.y, 1000);
        assert.equal(pasted[1].bounds.x - pasted[0].bounds.x, 300);
        assert.equal(pasted[1].bounds.y - pasted[0].bounds.y, 150);
        assert.equal(pasted[0].bounds.width, 200);
        assert.equal(pasted[1].bounds.width, 200);
    });

    it('keeps stored coordinates when exactPositions is set', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        addArea(source);
        clipboardManager.copy(source, [], { areaIds: ['1'] });

        clipboardManager.paste(target, { x: 999, y: 999 }, { exactPositions: true });

        assert.deepEqual(target.getDocumentationAreas()[0].bounds, {
            x: 100,
            y: 100,
            width: 300,
            height: 200,
        });
    });

    it('normalizes an invalid pasted colour to the default', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        const area = addArea(source);
        clipboardManager.copy(source, [], { areaIds: [area.id] });
        // Hand-edited payload: neither a picker nor a manual edit may inject rgba().
        clipboardManager._clipboard.documentationAreas[0].data.color = 'rgba(1,2,3,0.5)';

        clipboardManager.paste(target, { x: 10, y: 10 });

        assert.equal(target.getDocumentationAreas()[0].color, DOCUMENTATION_AREA_DEFAULT_COLOR);
    });

    it('pastes areas only through pasteAreas()', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        addArea(source);
        clipboardManager.copy(source, [], { areaIds: ['1'] });

        const areaIds = clipboardManager.pasteAreas(target, { x: 250, y: 250 });

        assert.equal(areaIds.length, 1);
        assert.equal(target.getDocumentationAreas().length, 1);
    });

    it('returns nothing from pasteAreas() for a node-only payload', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        clipboardManager.copy(source, ['1']);

        assert.deepEqual(clipboardManager.pasteAreas(target, { x: 0, y: 0 }), []);
        assert.equal(target.getDocumentationAreas().length, 0);
    });

    it('serializes on cut without deleting anything itself', () => {
        const graph = buildGraph();
        const area = addArea(graph);

        assert.equal(clipboardManager.cut(graph, [], { areaIds: [area.id] }), true);
        assert.equal(graph.getDocumentationAreas().length, 1);
        assert.equal(clipboardManager.getAreaCount(), 1);
    });

    it('clears both halves of the payload', () => {
        const graph = buildGraph();
        addArea(graph);
        clipboardManager.copy(graph, ['1'], { areaIds: ['1'] });
        assert.equal(clipboardManager.getAreaCount(), 1);
        assert.equal(clipboardManager.getNodeCount(), 1);

        clipboardManager.clear();

        assert.equal(clipboardManager.hasData(), false);
        assert.equal(clipboardManager.getAreaCount(), 0);
        assert.equal(clipboardManager.getNodeCount(), 0);
        assert.deepEqual(clipboardManager.getLastPastedAreaIds(), []);
    });

    it('pastes nodes and areas from a mixed payload', () => {
        const source = buildGraph('graph-a');
        const target = buildGraph('graph-b');
        addArea(source);
        clipboardManager.copy(source, ['1'], { areaIds: ['1'] });

        const nodeIds = clipboardManager.paste(target, { x: 600, y: 600 });

        assert.equal(nodeIds.length, 1);
        assert.equal(target.getDocumentationAreas().length, 1);
        const pastedAreaIds = clipboardManager.getLastPastedAreaIds();
        assert.equal(pastedAreaIds.length, 1);
        assert.notEqual(pastedAreaIds[0], undefined);
    });
});
