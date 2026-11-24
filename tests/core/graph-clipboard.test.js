// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Single-graph clipboard: slot semantics, snapshot independence and paste data.
 *
 * The clipboard holds one serialized graph; a paste must produce a detached copy with
 * fresh ids, remapped connections, a reset viewport and the function-graph rules of D16.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPastedGraphData,
    clearGraphClipboard,
    collectPastedCalleeTypeIds,
    getGraphClipboard,
    hasGraphClipboard,
    setGraphClipboard,
} from '../../src/micro_otter/nodes/html/js/core/graph-clipboard.js';

/**
 * Build a serialized graph snapshot.
 * @param {object} [overrides] - Fields that replace the defaults.
 * @returns {object} Serialized graph data.
 */
function createGraphData(overrides = {}) {
    return {
        id: 'graph-1',
        name: 'Source',
        executionType: 'continuous',
        enabled: true,
        triggerName: '',
        signalNames: [],
        signalMode: 'any',
        runOnStart: true,
        triggerIntervalMs: 500,
        highlightColor: '#123456',
        nodes: [
            { id: '1', type: 'console', typeName: 'Console', inputs: [], outputs: [] },
            { id: '2', type: 'emit', typeName: 'Emit', inputs: [], outputs: [] },
        ],
        connections: [{ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 }],
        documentationAreas: [{ id: '1', title: 'Notes', bounds: { x: 0, y: 0 } }],
        viewportConfig: { translateX: 120, translateY: -40, scale: 2 },
        ...overrides,
    };
}

describe('graph clipboard slot', () => {
    beforeEach(() => {
        clearGraphClipboard();
    });

    it('starts empty and clears on null', () => {
        assert.equal(hasGraphClipboard(), false);
        assert.equal(getGraphClipboard(), null);

        setGraphClipboard({ data: createGraphData(), sourceCollectionId: 'col-1' });
        assert.equal(hasGraphClipboard(), true);

        setGraphClipboard(null);
        assert.equal(hasGraphClipboard(), false);
        assert.equal(getGraphClipboard(), null);
    });

    it('stores a snapshot that later source edits cannot change', () => {
        const data = createGraphData();
        setGraphClipboard({ data, sourceCollectionId: 'col-1' });

        data.name = 'Mutated';
        data.nodes[0].type = 'mutated';
        data.nodes.push({ id: '3', type: 'extra' });

        const payload = getGraphClipboard();
        assert.equal(payload.data.name, 'Source');
        assert.equal(payload.data.nodes.length, 2);
        assert.equal(payload.data.nodes[0].type, 'console');
        assert.equal(payload.sourceCollectionId, 'col-1');
    });

    it('hands out copies so a read cannot change the slot', () => {
        setGraphClipboard({ data: createGraphData(), sourceCollectionId: 'col-1' });

        const payload = getGraphClipboard();
        payload.data.name = 'Changed through the copy';
        payload.data.nodes.length = 0;

        const reread = getGraphClipboard();
        assert.equal(reread.data.name, 'Source');
        assert.equal(reread.data.nodes.length, 2);
    });

    it('ignores a payload without graph data', () => {
        setGraphClipboard({ data: createGraphData(), sourceCollectionId: 'col-1' });
        setGraphClipboard({ data: null, sourceCollectionId: 'col-1' });

        assert.equal(hasGraphClipboard(), false);
    });
});

describe('buildPastedGraphData', () => {
    it('renames the copy, renumbers ids and remaps connections', () => {
        const payload = { data: createGraphData(), sourceCollectionId: 'col-1' };

        const pasted = buildPastedGraphData(payload, { graphId: 'graph-7', name: 'Source 2' });

        assert.equal(pasted.id, 'graph-7');
        assert.equal(pasted.name, 'Source 2');
        assert.deepEqual(
            pasted.nodes.map((node) => node.id),
            ['1', '2']
        );
        assert.deepEqual(
            pasted.connections.map((connection) => [connection.fromNode, connection.toNode]),
            [['1', '2']]
        );
        assert.deepEqual(
            pasted.documentationAreas.map((area) => area.id),
            ['1']
        );
        assert.deepEqual(pasted.viewportConfig, { translateX: 0, translateY: 0, scale: 1 });
        assert.equal(pasted.triggerIntervalMs, 500);
        assert.equal(pasted.highlightColor, '#123456');
    });

    it('renumbers nodes when the source ids are sparse', () => {
        const payload = {
            data: createGraphData({
                nodes: [
                    { id: '5', type: 'console' },
                    { id: '9', type: 'emit' },
                ],
                connections: [{ fromNode: '5', fromIndex: 0, toNode: '9', toIndex: 1 }],
                documentationAreas: [{ id: '4', title: 'A' }, { id: '8', title: 'B' }],
            }),
            sourceCollectionId: 'col-1',
        };

        const pasted = buildPastedGraphData(payload, { graphId: 'graph-2', name: 'Copy' });

        assert.deepEqual(
            pasted.nodes.map((node) => node.id),
            ['1', '2']
        );
        assert.deepEqual(pasted.connections[0], {
            fromNode: '1',
            fromIndex: 0,
            toNode: '2',
            toIndex: 1,
        });
        assert.deepEqual(
            pasted.documentationAreas.map((area) => area.id),
            ['1', '2']
        );
    });

    it('does not mutate the stored payload', () => {
        const payload = { data: createGraphData(), sourceCollectionId: 'col-1' };

        buildPastedGraphData(payload, { graphId: 'graph-2', name: 'Copy' });

        assert.equal(payload.data.id, 'graph-1');
        assert.equal(payload.data.name, 'Source');
        assert.equal(payload.data.nodes[0].id, '1');
        assert.equal(payload.data.viewportConfig.translateX, 120);
    });

    it('keeps the signature and structural nodes of a function graph', () => {
        const signature = {
            category: 'math',
            inputs: [{ id: 'in_0', name: 'channel', types: ['int'] }],
            outputs: [{ id: 'out_0', name: 'value', types: ['int'] }],
        };
        const payload = {
            data: createGraphData({
                executionType: 'function',
                functionSignature: signature,
                nodes: [
                    { id: '1', type: 'graph.function.input' },
                    { id: '2', type: 'graph.function.output' },
                ],
                connections: [{ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 }],
            }),
            sourceCollectionId: 'col-1',
        };

        const pasted = buildPastedGraphData(payload, { graphId: 'graph-2', name: 'Copy' });

        assert.deepEqual(pasted.functionSignature, signature);
        assert.deepEqual(
            pasted.nodes.map((node) => node.type),
            ['graph.function.input', 'graph.function.output']
        );
        assert.equal(pasted.connections.length, 1);
    });

    it('keeps a custom icon on a pasted function graph', () => {
        const payload = {
            data: createGraphData({
                executionType: 'function',
                functionSignature: {
                    category: 'math',
                    icon: 'mdi:thermometer',
                    inputs: [{ id: 'in_0', name: 'channel', types: ['int'] }],
                    outputs: [],
                },
                nodes: [],
                connections: [],
            }),
            sourceCollectionId: 'col-1',
        };

        const pasted = buildPastedGraphData(payload, { graphId: 'graph-2', name: 'Copy' });

        assert.equal(pasted.functionSignature.icon, 'mdi:thermometer');
    });

    it('drops structural nodes from a pasted non-function graph', () => {
        const payload = {
            data: createGraphData({
                nodes: [
                    { id: '1', type: 'graph.function.input' },
                    { id: '2', type: 'console' },
                ],
                connections: [{ fromNode: '1', fromIndex: 0, toNode: '2', toIndex: 0 }],
            }),
            sourceCollectionId: 'col-1',
        };

        const pasted = buildPastedGraphData(payload, { graphId: 'graph-2', name: 'Copy' });

        assert.deepEqual(
            pasted.nodes.map((node) => node.type),
            ['console']
        );
        assert.deepEqual(pasted.connections, []);
    });

    it('remaps a self call of the copied graph onto the pasted id', () => {
        const payload = {
            data: createGraphData({
                nodes: [
                    { id: '1', type: 'function_graph.graph-1' },
                    { id: '2', type: 'console' },
                ],
                connections: [],
            }),
            sourceCollectionId: 'col-1',
        };

        const pasted = buildPastedGraphData(payload, { graphId: 'graph-2', name: 'Copy' });

        assert.deepEqual(
            pasted.nodes.map((node) => node.type),
            ['function_graph.graph-2', 'console']
        );
    });

    it('accepts an empty payload', () => {
        const pasted = buildPastedGraphData(null, { graphId: 'graph-2', name: 'Copy' });

        assert.equal(pasted.id, 'graph-2');
        assert.equal(pasted.name, 'Copy');
        assert.deepEqual(pasted.nodes, []);
        assert.deepEqual(pasted.connections, []);
        assert.deepEqual(pasted.documentationAreas, []);
    });
});

describe('collectPastedCalleeTypeIds', () => {
    it('lists each called function graph once', () => {
        const data = createGraphData({
            nodes: [
                { id: '1', type: 'function_graph.fn-1' },
                { id: '2', type: 'function_graph.fn-2' },
                { id: '3', type: 'function_graph.fn-1' },
                { id: '4', type: 'console' },
            ],
        });

        assert.deepEqual(collectPastedCalleeTypeIds(data), [
            'function_graph.fn-1',
            'function_graph.fn-2',
        ]);
        assert.deepEqual(collectPastedCalleeTypeIds(null), []);
    });
});
