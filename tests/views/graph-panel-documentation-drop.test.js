// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Drop routing for palette graph items (documentation areas) on the graph panel.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { HistoryManager } from '../../src/micro_otter/nodes/html/js/data/history-manager.js';
import { generateUuidV4 } from '../../src/micro_otter/nodes/html/js/data/uuid.js';
import {
    DOCUMENTATION_AREA_DEFAULT_COLOR,
    DOCUMENTATION_AREA_DEFAULT_SIZE,
} from '../../src/micro_otter/nodes/html/js/data/documentation-area.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';
import { ORGANIZATIONAL_PALETTE_ENTRIES } from '../../src/micro_otter/nodes/html/js/nodes/organizational-palette.js';
import {
    FUNCTION_INPUT_GRAPH_ITEM_ID,
    FUNCTION_OUTPUT_GRAPH_ITEM_ID,
} from '../../src/micro_otter/nodes/html/js/nodes/organizational-palette.js';
import {
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_OUTPUT_NODE_TYPE,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-nodes.js';

globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

const I18N = {
    t: (key) => key,
    addEventListener: () => {},
    removeEventListener: () => {},
    getCurrentLanguage: () => 'en',
};

const getNodeTypeCalls = [];

/** Minimal `Image` stub: jsdom does not provide one and `NodeUi` loads icons eagerly. */
class StubImage {
    src = '';

    onload = null;

    onerror = null;
}

function createRuntime() {
    return {
        nodePackages: [],
        getNodeType(typeId) {
            getNodeTypeCalls.push(typeId);
            return {
                type: typeId,
                title: 'Dropped',
                inputs: [],
                outputs: [],
            };
        },
    };
}

function createPanel({
    graphs = [{ id: 'graph-1', name: 'Graph 1', nodes: [], connections: [] }],
    runtime = createRuntime(),
} = {}) {
    const collection = new Collection({
        id: generateUuidV4(),
        title: 'Drop',
        graphs,
    });
    const graph = collection.getActiveGraph();
    const historyManager = new HistoryManager(collection);
    collection.getHistoryManager = () => historyManager;

    const view = new GraphPanelView({
        graph,
        collection,
        i18nService: I18N,
        logger: { log: () => {} },
        workspace: {
            runtimeCollection: { getActiveRuntime: () => runtime },
            getActiveCollection: () => collection,
        },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    view.attachTo(container);
    view._isVisible = true;
    return { view, graph, historyManager, collection };
}

function dropEvent(payload, { clientX = 100, clientY = 100 } = {}) {
    return {
        clientX,
        clientY,
        preventDefault() {},
        dataTransfer: {
            getData: () => JSON.stringify(payload),
        },
    };
}

describe('GraphPanelView graph-item drop', () => {
    let harness;
    let view;
    let graph;
    let historyManager;

    beforeEach(() => {
        getNodeTypeCalls.length = 0;
        globalThis.Image = StubImage;
        harness = createDomHarness();
        ({ view, graph, historyManager } = createPanel());
    });

    afterEach(() => {
        view?.dispose();
        view = null;
        globalThis.Image = undefined;
        harness.cleanup();
    });

    it('creates one documentation area centred on the drop point', () => {
        const depthBefore = historyManager.getHistoryDepth();
        const posWorld = view.screenToWorld(view.getCanvasPosScreenFromEvent(dropEvent({})));

        view.handleDrop(
            dropEvent({ type: 'graph-item', graphItemId: 'documentation-area', nodeTypeName: 'Doc' })
        );

        const areas = graph.getDocumentationAreas();
        assert.equal(areas.length, 1);
        assert.equal(graph.getNodes().length, 0);
        assert.equal(areas[0].color, DOCUMENTATION_AREA_DEFAULT_COLOR);
        assert.equal(areas[0].title, '');
        assert.equal(areas[0].markdown, '');
        assert.equal(areas[0].bounds.width, DOCUMENTATION_AREA_DEFAULT_SIZE.width);
        assert.equal(areas[0].bounds.height, DOCUMENTATION_AREA_DEFAULT_SIZE.height);
        // Centred on the drop point, then clamped into the graph's world extent (never negative).
        assert.equal(
            areas[0].bounds.x,
            Math.max(0, posWorld.x - DOCUMENTATION_AREA_DEFAULT_SIZE.width / 2)
        );
        assert.equal(
            areas[0].bounds.y,
            Math.max(0, posWorld.y - DOCUMENTATION_AREA_DEFAULT_SIZE.height / 2)
        );
        assert.equal(historyManager.getHistoryDepth(), depthBefore + 1);
        assert.equal(view.activeDocumentationAreaId, areas[0].id);
    });

    it('never looks up a node type for a graph item', () => {
        view.handleDrop(
            dropEvent({ type: 'graph-item', graphItemId: 'documentation-area', nodeTypeName: 'Doc' })
        );

        assert.deepEqual(getNodeTypeCalls, []);
        assert.equal(graph.getNodes().length, 0);
    });

    it('ignores an unknown graph item id', () => {
        const depthBefore = historyManager.getHistoryDepth();

        view.handleDrop(
            dropEvent({ type: 'graph-item', graphItemId: 'unknown-item', nodeTypeName: '?' })
        );

        assert.equal(graph.getDocumentationAreas().length, 0);
        assert.equal(historyManager.getHistoryDepth(), depthBefore);
    });

    it('creates exactly one area per always-visible organizational palette entry', () => {
        const areaEntries = ORGANIZATIONAL_PALETTE_ENTRIES.filter((entry) => !entry.visibleFor);

        for (const entry of areaEntries) {
            view.handleDrop(
                dropEvent({ type: 'graph-item', graphItemId: entry.id, nodeTypeName: entry.id })
            );
        }

        assert.equal(graph.getDocumentationAreas().length, areaEntries.length);
    });

    it('rejects a structural node drop outside a function graph', () => {
        view.handleDrop(
            dropEvent({
                type: 'graph-item',
                graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID,
                nodeTypeName: 'in',
            })
        );

        assert.equal(graph.getNodes().length, 0);
        assert.equal(graph.getDocumentationAreas().length, 0);
    });

    it('places a dropped structural input node at the drop point', () => {
        graph.setExecutionType('function');
        // Bounds clamping only, so the assertion pins the drop position itself.
        view.gridEnabled = false;
        const event = dropEvent({
            type: 'graph-item',
            graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID,
            nodeTypeName: 'in',
        });
        const posWorld = view.screenToWorld(view.getCanvasPosScreenFromEvent(event));

        view.handleDrop(event);

        const [node] = graph.getNodes();
        assert.equal(node.type, FUNCTION_INPUT_NODE_TYPE);
        assert.equal(node.x, posWorld.x);
        assert.equal(node.y, posWorld.y);
        assert.notEqual(node.x, 0, 'the node must not fall back to the graph origin');
    });

    it('places a dropped structural output node at the drop point too', () => {
        graph.setExecutionType('function');
        view.gridEnabled = false;
        const event = dropEvent(
            { type: 'graph-item', graphItemId: FUNCTION_OUTPUT_GRAPH_ITEM_ID, nodeTypeName: 'out' },
            { clientX: 520, clientY: 300 }
        );
        const posWorld = view.screenToWorld(view.getCanvasPosScreenFromEvent(event));

        view.handleDrop(event);

        const [node] = graph.getNodes();
        assert.equal(node.type, FUNCTION_OUTPUT_NODE_TYPE);
        assert.equal(node.x, posWorld.x);
        assert.equal(node.y, posWorld.y);
    });

    it('does not move an existing structural node on a second drop', () => {
        graph.setExecutionType('function');
        view.gridEnabled = false;
        view.handleDrop(
            dropEvent({ type: 'graph-item', graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID })
        );
        const [first] = graph.getNodes();

        view.handleDrop(
            dropEvent(
                { type: 'graph-item', graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID },
                { clientX: 640, clientY: 480 }
            )
        );

        const nodes = graph.getNodes();
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].id, first.id);
        assert.equal(nodes[0].x, first.x);
        assert.equal(nodes[0].y, first.y);
    });

    it('places at most one structural input node per function graph', () => {
        graph.setExecutionType('function');

        view.handleDrop(
            dropEvent({
                type: 'graph-item',
                graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID,
                nodeTypeName: 'in',
            })
        );
        const firstNodeId = graph.getNodes()[0]?.id;

        view.handleDrop(
            dropEvent({
                type: 'graph-item',
                graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID,
                nodeTypeName: 'in',
            })
        );

        const nodes = graph.getNodes();
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].type, FUNCTION_INPUT_NODE_TYPE);
        assert.equal(nodes[0].id, firstNodeId);
        assert.equal(view.selection.getSelectedNodeIds?.()[0] ?? firstNodeId, firstNodeId);
    });

    it('re-renders a structural node when a signature port is added', () => {
        graph.setExecutionType('function');
        view.handleDrop(
            dropEvent({
                type: 'graph-item',
                graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID,
                nodeTypeName: 'in',
            })
        );

        const node = graph.getNodes()[0];
        assert.equal(view.nodeUiMap.get(node.id).getConnectors('output').length, 0);

        graph.addFunctionPort('input', { name: 'A', types: ['int'] });

        assert.equal(view.nodeUiMap.get(node.id).getConnectors('output').length, 1);
    });

    it('still creates a node for a node-type payload', () => {
        view.handleDrop(
            dropEvent({ type: 'node-type', nodeTypeId: 'console', nodeTypeName: 'Console' })
        );

        assert.ok(getNodeTypeCalls.length >= 1, 'expected a runtime node-type lookup');
        assert.ok(getNodeTypeCalls.every((typeId) => typeId === 'console'));
        assert.equal(graph.getNodes().length, 1);
        assert.equal(graph.getDocumentationAreas().length, 0);
    });
});

describe('GraphPanelView function node drop', () => {
    let harness;
    let view;
    let graph;
    let collection;

    beforeEach(() => {
        getNodeTypeCalls.length = 0;
        globalThis.Image = StubImage;
        harness = createDomHarness();
        ({ view, graph, collection } = createPanel({
            graphs: [
                { id: 'graph-1', name: 'Main', nodes: [], connections: [] },
                {
                    id: 'fn-1',
                    name: 'Scale Values',
                    executionType: 'function',
                    functionSignature: {
                        category: 'math',
                        inputs: [{ name: 'pin', types: ['int'] }],
                        outputs: [{ name: 'result', types: ['float'] }],
                    },
                    nodes: [],
                    connections: [],
                },
            ],
        }));
    });

    afterEach(() => {
        view?.dispose();
        view = null;
        globalThis.Image = undefined;
        harness.cleanup();
    });

    it('creates a call node whose connectors mirror the signature', () => {
        view.handleDrop(dropEvent({ type: 'node-type', nodeTypeId: 'function_graph.fn-1' }));

        const nodes = graph.getNodes();
        assert.equal(nodes.length, 1);
        const [node] = nodes;
        assert.equal(node.type, 'function_graph.fn-1');
        assert.deepEqual(node.inputs.map((input) => input.id), ['in_0']);
        assert.equal(node.inputs[0].name, 'pin');
        assert.deepEqual(node.inputs[0].allowedTypes, ['int']);
        assert.deepEqual(node.outputs.map((output) => output.id), ['out_0']);
        assert.equal(node.outputs[0].name, 'result');

        // The snapshot is what lets the canvas render the call node; the runtime never had it.
        const nodeUi = view.nodeUiMap.get(node.id);
        assert.equal(nodeUi.getConnectors('input').length, 1);
        assert.equal(nodeUi.getConnectors('output').length, 1);
    });

    it('creates one independent node per drop', () => {
        view.handleDrop(dropEvent({ type: 'node-type', nodeTypeId: 'function_graph.fn-1' }));
        view.handleDrop(dropEvent({ type: 'node-type', nodeTypeId: 'function_graph.fn-1' }));

        const nodes = graph.getNodes();
        assert.equal(nodes.length, 2);
        assert.notEqual(nodes[0].id, nodes[1].id);
        assert.equal(collection.getGraphArray().length, 2, 'no graph is created by a drop');
    });

    it('refuses a drop of the graph being edited', () => {
        graph.setExecutionType('function');

        view.handleDrop(
            dropEvent({ type: 'node-type', nodeTypeId: graph.getFunctionNodeTypeId() })
        );

        assert.equal(graph.getNodes().length, 0);
        assert.deepEqual(getNodeTypeCalls, []);
    });

    it('degrades a stale generated id to the unknown-type path', () => {
        view.handleDrop(dropEvent({ type: 'node-type', nodeTypeId: 'function_graph.gone' }));

        assert.equal(graph.getNodes().length, 0);
        assert.deepEqual(getNodeTypeCalls, []);
    });
});

describe('GraphPanelView function node capability pass', () => {
    let harness;
    let view;
    let graph;

    beforeEach(() => {
        getNodeTypeCalls.length = 0;
        globalThis.Image = StubImage;
        harness = createDomHarness();
        // A runtime that knows no node type: every id the app generates itself would be reported as
        // an uninstalled package without the exemption under test.
        const unknownRuntime = {
            nodePackages: [],
            getNodeType: () => null,
            getDeviceTarget: () => null,
        };
        ({ view, graph } = createPanel({
            runtime: unknownRuntime,
            graphs: [
                { id: 'graph-1', name: 'Main', nodes: [], connections: [] },
                {
                    id: 'fn-1',
                    name: 'Scale Values',
                    executionType: 'function',
                    functionSignature: {
                        category: 'math',
                        inputs: [{ name: 'pin', types: ['int'] }],
                        outputs: [{ name: 'result', types: ['float'] }],
                    },
                    nodes: [],
                    connections: [],
                },
            ],
        }));
        view.renderPanel = () => {};
    });

    afterEach(() => {
        view?.dispose();
        view = null;
        globalThis.Image = undefined;
        harness.cleanup();
    });

    it('keeps a dropped structural node free of a missing-package issue', async () => {
        graph.setExecutionType('function');
        view.handleDrop(dropEvent({ type: 'graph-item', graphItemId: FUNCTION_INPUT_GRAPH_ITEM_ID }));

        const [node] = graph.getNodes();
        assert.equal(node.type, FUNCTION_INPUT_NODE_TYPE);

        await view.revalidateNodeCapabilities();

        assert.deepEqual(node.getCapabilityIssues(), []);
    });

    it('keeps a dropped call node free of a missing-package issue', async () => {
        view.handleDrop(dropEvent({ type: 'node-type', nodeTypeId: 'function_graph.fn-1' }));

        const [node] = graph.getNodes();
        assert.equal(node.type, 'function_graph.fn-1');

        await view.revalidateNodeCapabilities();

        assert.deepEqual(node.getCapabilityIssues(), []);
    });
});
