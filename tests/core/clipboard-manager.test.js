import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clipboardManager } from '../../src/micro_otter/nodes/html/js/core/clipboard-manager.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

function buildGraph() {
    const graph = new NodeGraph({ id: 'graph-a', name: 'Graph A' });

    const source = graph.addNode({
        type: 'const',
        title: 'Constant',
        x: 100,
        y: 100,
        color: '#336699',
        collapsed: true,
        controlValues: { value: 42 },
        outputs: [{ id: 'out0', name: 'Value', outputType: 'float' }],
    });

    const sink = graph.addNode({
        type: 'print',
        title: 'Print',
        x: 200,
        y: 100,
        inputDefaults: { title: 'Output' },
        inputs: [
            { id: 'title', name: 'Title', allowedTypes: ['string'] },
            { id: 'in0', name: 'Value', allowedTypes: ['float'] },
        ],
    });

    const secondSource = graph.addNode({
        type: 'const',
        title: 'Second Constant',
        x: 120,
        y: 220,
        controlValues: { value: 10 },
        outputs: [{ id: 'out0', name: 'Value', outputType: 'float' }],
    });

    graph.addConnection({
        fromNode: source.id,
        fromIndex: 0,
        toNode: sink.id,
        toIndex: 1,
    });

    return { graph, source, sink, secondSource };
}

describe('clipboard-manager behavior migration', () => {
    beforeEach(() => {
        clipboardManager.clear();
    });

    afterEach(() => {
        clipboardManager.clear();
    });

    it('copies selected nodes and paste restores internal selected connections', () => {
        const { graph, source, sink } = buildGraph();

        const copied = clipboardManager.copy(graph, [source.id, sink.id]);
        const pastedIds = clipboardManager.paste(graph);

        assert.equal(copied, true);
        assert.equal(clipboardManager.hasData(), true);
        assert.equal(clipboardManager.getNodeCount(), 2);
        assert.equal(pastedIds.length, 2);
        assert.equal(graph.getConnections().length, 2);
    });

    it('does not copy when node selection is empty or invalid', () => {
        const { graph } = buildGraph();

        assert.equal(clipboardManager.copy(graph, []), false);
        assert.equal(clipboardManager.copy(graph, ['missing-node']), false);
        assert.equal(clipboardManager.hasData(), false);
    });

    it('pastes with default offset and preserves control/color/collapsed properties', () => {
        const { graph, source } = buildGraph();

        const copied = clipboardManager.copy(graph, [source.id]);
        const pastedIds = clipboardManager.paste(graph);
        const pastedNode = graph.getNode(pastedIds[0]);

        assert.equal(copied, true);
        assert.equal(pastedIds.length, 1);
        assert.ok(pastedNode);
        assert.equal(pastedNode.x, source.x + 20);
        assert.equal(pastedNode.y, source.y + 20);
        assert.deepEqual(pastedNode.controlValues, source.controlValues);
        assert.equal(pastedNode.color, source.color);
        assert.equal(pastedNode.collapsed, source.collapsed);
    });

    it('pastes around the requested custom position', () => {
        const { graph, source, sink } = buildGraph();

        const copied = clipboardManager.copy(graph, [source.id, sink.id]);
        const pastePosition = { x: 520, y: 340 };
        const pastedIds = clipboardManager.paste(graph, pastePosition);

        const pastedPositions = pastedIds
            .map((id) => graph.getNode(id))
            .filter(Boolean)
            .map((node) => ({ x: node.x, y: node.y }));

        const avgX = pastedPositions.reduce((sum, pos) => sum + pos.x, 0) / pastedPositions.length;
        const avgY = pastedPositions.reduce((sum, pos) => sum + pos.y, 0) / pastedPositions.length;

        assert.equal(copied, true);
        assert.equal(pastedIds.length, 2);
        assert.ok(Math.abs(avgX - pastePosition.x) < 1);
        assert.ok(Math.abs(avgY - pastePosition.y) < 1);
    });

    it('nudges pasted node origin to keep at least 16px from existing node origins', () => {
        const { graph, source } = buildGraph();

        const copied = clipboardManager.copy(graph, [source.id]);
        const pastedIds = clipboardManager.paste(graph, { x: source.x, y: source.y });
        const pastedNode = graph.getNode(pastedIds[0]);

        assert.equal(copied, true);
        assert.equal(pastedIds.length, 1);
        assert.ok(pastedNode);

        const distance = Math.hypot(pastedNode.x - source.x, pastedNode.y - source.y);
        assert.ok(distance >= 16, `expected pasted origin distance >= 16, got ${distance}`);
    });

    it('cut copies nodes without removing them from the source graph', () => {
        const { graph, source } = buildGraph();
        const originalCount = graph.getNodes().length;

        const cut = clipboardManager.cut(graph, [source.id]);

        assert.equal(cut, true);
        assert.equal(clipboardManager.getNodeCount(), 1);
        assert.equal(graph.getNodes().length, originalCount);
        assert.notEqual(graph.getNode(source.id), null);
    });

    it('paste after cut creates copies and leaves the source graph unchanged', () => {
        const { graph, source } = buildGraph();
        const originalCount = graph.getNodes().length;

        const cut = clipboardManager.cut(graph, [source.id]);
        const pastedIds = clipboardManager.paste(graph);

        assert.equal(cut, true);
        assert.equal(pastedIds.length, 1);
        assert.equal(graph.getNodes().length, originalCount + 1);
        assert.notEqual(graph.getNode(source.id), null);
        assert.ok(graph.getNode(pastedIds[0]));
    });

    it('cut+paste in a different graph leaves source graph unchanged', () => {
        const { graph, source } = buildGraph();
        const sourceCountBefore = graph.getNodes().length;

        const targetGraph = new NodeGraph({ id: 'graph-b', name: 'Graph B' });
        const cut = clipboardManager.cut(graph, [source.id]);
        const pastedIds = clipboardManager.paste(targetGraph);

        assert.equal(cut, true);
        assert.equal(pastedIds.length, 1);
        assert.equal(graph.getNodes().length, sourceCountBefore);
        assert.notEqual(graph.getNode(source.id), null);
        assert.equal(targetGraph.getNodes().length, 1);
    });

    it('duplicate returns new ids without overriding existing clipboard selection', () => {
        const { graph, source, sink, secondSource } = buildGraph();

        assert.equal(clipboardManager.copy(graph, [source.id, sink.id]), true);
        assert.equal(clipboardManager.getNodeCount(), 2);

        const pastePosition = { x: 80, y: 120 };
        const duplicatedIds = clipboardManager.duplicate(graph, [secondSource.id], pastePosition);
        const duplicatedNode = graph.getNode(duplicatedIds[0]);

        assert.equal(duplicatedIds.length, 1);
        assert.ok(duplicatedNode);
        assert.equal(duplicatedNode.x, pastePosition.x);
        assert.equal(duplicatedNode.y, pastePosition.y);
        assert.equal(clipboardManager.getNodeCount(), 2);
    });

    it('paste with exactPositions keeps nodes at their original origins', () => {
        const { graph, source, secondSource } = buildGraph();

        assert.equal(clipboardManager.copy(graph, [source.id, secondSource.id]), true);

        const pastedIds = clipboardManager.paste(graph, null, { exactPositions: true });
        const pastedSource = graph.getNode(pastedIds[0]);
        const pastedSecondSource = graph.getNode(pastedIds[1]);

        assert.equal(pastedIds.length, 2);
        assert.deepEqual(
            { x: pastedSource.x, y: pastedSource.y },
            { x: source.x, y: source.y }
        );
        assert.deepEqual(
            { x: pastedSecondSource.x, y: pastedSecondSource.y },
            { x: secondSource.x, y: secondSource.y }
        );
        assert.notEqual(pastedIds[0], source.id);
        assert.equal(graph.getConnections().length, 1);
    });

    it('duplicate with exactPositions keeps nodes underneath the originals', () => {
        const { graph, source } = buildGraph();

        const duplicatedIds = clipboardManager.duplicate(graph, [source.id], null, {
            exactPositions: true,
        });
        const duplicatedNode = graph.getNode(duplicatedIds[0]);

        assert.deepEqual(
            { x: duplicatedNode.x, y: duplicatedNode.y },
            { x: source.x, y: source.y }
        );
        assert.equal(clipboardManager.getNodeCount(), 0);
    });

    it('skips a structural function node when copying and duplicating', () => {
        const graph = new NodeGraph({ id: 'graph-fn', executionType: 'function' });
        const { node: structuralNode } = graph.ensureFunctionStructuralNode('input');
        const source = graph.addNode({
            type: 'const',
            title: 'Constant',
            x: 100,
            y: 100,
            outputs: [{ id: 'out0', name: 'Value', outputType: 'float' }],
        });

        const originalWarn = console.warn;
        const warnings = [];
        console.warn = (...args) => warnings.push(args);
        try {
            assert.equal(clipboardManager.copy(graph, [structuralNode.id]), false);
            assert.equal(clipboardManager.getNodeCount(), 0);

            const duplicatedIds = clipboardManager.duplicate(graph, [
                structuralNode.id,
                source.id,
            ]);

            assert.equal(duplicatedIds.length, 1);
            assert.equal(graph.getNode(duplicatedIds[0]).type, 'const');
            assert.equal(
                graph.getNodes().filter((node) => node.type === 'graph.function.input').length,
                1
            );
        } finally {
            console.warn = originalWarn;
        }

        assert.ok(
            warnings.some((args) => args[0] === 'function-structural-node-skipped'),
            'expected a skip log entry'
        );
    });
});
