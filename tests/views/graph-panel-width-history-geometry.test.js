import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

class GraphHistoryStub extends AppEventEmitter {
    constructor(node) {
        super();
        this.id = 'graph-history';
        this.node = node;
        this.updateCalls = [];
    }

    getName() {
        return 'Graph History';
    }

    getNodeIds() {
        return [this.node.getId()];
    }

    getNodes() {
        return [this.node];
    }

    getNode(nodeId) {
        return nodeId === this.node.getId() ? this.node : null;
    }

    getConnections() {
        return [];
    }

    updateNode(nodeId, patch, previous = null) {
        if (nodeId !== this.node.getId()) {
            return null;
        }

        this.updateCalls.push({
            nodeId,
            patch: { ...patch },
            previous: previous ? { ...previous } : null,
        });
        Object.assign(this.node, patch);
        return this.node;
    }
}

function createRuntime(typeId) {
    return {
        getNodeType(nodeTypeId) {
            if (nodeTypeId !== typeId) {
                return null;
            }

            return {
                title: { en: 'Resizable' },
                icon: 'icons/resize.svg',
                color: '#5a6f88',
                controls: [],
                inputs: [{ id: 'in0', name: { en: 'In' } }],
                outputs: [{ id: 'out0', name: { en: 'Out' } }],
                defaultWidth: 180,
                minWidth: 120,
                maxWidth: 280,
            };
        },
        getDeviceTarget() {
            return {
                capabilityToPins: {},
                generalCapabilities: {},
                metadata: {},
            };
        },
    };
}

describe('GraphPanelView width history and geometry', () => {
    it('uses the same node-updated patch shape for pointer and keyboard width changes', () => {
        const node = new NodeData({
            id: 'node-1',
            type: 'core.resizable',
            typeName: { en: 'Resizable' },
            width: 180,
            controls: [],
            controlValues: {},
            inputs: [{ id: 'in0', name: 'In' }],
            outputs: [{ id: 'out0', name: 'Out' }],
            inputDefaults: {},
        });

        const graph = new GraphHistoryStub(node);
        const runtime = createRuntime('core.resizable');

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};
        graph.updateCalls.length = 0;

        view.interactionModule.resizeNodeWidth({
            nodeId: 'node-1',
            width: 230,
            edge: 'right',
        });

        view.selection.addToSelection('node-1');
        view._resizeSelectedNodeWidths(-20);

        assert.equal(graph.updateCalls.length, 2);
        assert.deepEqual(Object.keys(graph.updateCalls[0].patch).sort(), ['width', 'x']);
        assert.deepEqual(Object.keys(graph.updateCalls[0].previous).sort(), ['width', 'x']);
        assert.deepEqual(Object.keys(graph.updateCalls[1].patch).sort(), ['width', 'x']);
        assert.deepEqual(Object.keys(graph.updateCalls[1].previous).sort(), ['width', 'x']);

        view.dispose();
    });

    it('keeps connector geometry and hit testing correct after width change', () => {
        global.Image = class {
            set src(_value) {}
        };

        const node = new NodeData({
            id: 'node-geom',
            type: 'core.resizable',
            typeName: { en: 'Resizable' },
            x: 100,
            y: 80,
            width: 180,
            controls: [],
            controlValues: {},
            inputs: [{ id: 'in0', name: 'In' }],
            outputs: [{ id: 'out0', name: 'Out' }],
            inputDefaults: {},
        });

        const graph = new GraphHistoryStub(node);
        const runtime = createRuntime('core.resizable');

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};
        view.syncNodeUisFromGraph();

        const nodeUi = view.nodeUiMap.get('node-geom');
        assert.ok(nodeUi, 'Expected NodeUi for test node');

        const beforeOutput = nodeUi.getConnectorPosition('output', 0);
        assert.ok(beforeOutput, 'Expected output connector before resize');

        view._applyNodeWidthUpdate('node-geom', 240, 'right');

        const afterOutput = nodeUi.getConnectorPosition('output', 0);
        assert.ok(afterOutput, 'Expected output connector after resize');
        assert.ok(
            afterOutput.x > beforeOutput.x,
            'Output connector should move right after width increase'
        );

        const hit = nodeUi.hitTestConnector({ x: afterOutput.x, y: afterOutput.y });
        assert.equal(hit?.type, 'output');
        assert.equal(hit?.index, 0);

        view.dispose();
    });

    it('never resizes below the content-derived minimum width', () => {
        global.Image = class {
            set src(_value) {}
        };

        const node = new NodeData({
            id: 'node-floor',
            type: 'core.resizable',
            typeName: { en: 'Resizable' },
            x: 100,
            y: 80,
            width: 300,
            controls: [],
            controlValues: {},
            inputs: [
                {
                    id: 'in0',
                    name: 'Input',
                    defaultControl: { id: 'in0', type: 'number', default: 0 },
                },
            ],
            outputs: [{ id: 'out0', name: 'Envelope Follow' }],
            inputDefaults: { in0: 0 },
        });

        const graph = new GraphHistoryStub(node);
        const runtime = createRuntime('core.resizable');

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};
        view.syncNodeUisFromGraph();

        const nodeUi = view.nodeUiMap.get('node-floor');
        assert.ok(nodeUi, 'Expected NodeUi for test node');

        const contentMinWidth = nodeUi.getMinContentWidth();
        assert.ok(contentMinWidth > 120, 'Content minimum should exceed the type minimum');

        view._applyNodeWidthUpdate('node-floor', 60, 'right');
        assert.equal(node.width, contentMinWidth);

        view.selection.addToSelection('node-floor');
        const callsBeforeShrink = graph.updateCalls.length;
        view._resizeSelectedNodeWidths(-100);
        assert.equal(node.width, contentMinWidth);
        assert.equal(graph.updateCalls.length, callsBeforeShrink);

        view._applyNodeWidthUpdate('node-floor', 250, 'right');
        assert.equal(node.width, 250);
        assert.equal(graph.updateCalls.length, callsBeforeShrink + 1);
        assert.deepEqual(Object.keys(graph.updateCalls.at(-1).patch).sort(), ['width', 'x']);

        view.dispose();
    });

    it('clamps resizes to the panel-control content minimum', () => {
        global.Image = class {
            set src(_value) {}
        };

        const node = new NodeData({
            id: 'node-controls',
            type: 'core.resizable',
            typeName: { en: 'Resizable' },
            x: 100,
            y: 80,
            width: 320,
            controls: [
                { id: 'count', type: 'number', label: 'Count', default: 4 },
                {
                    id: 'model',
                    type: 'dropdown',
                    label: 'Color Model',
                    default: 'rgb',
                    options: [],
                },
                { id: 'pin', type: 'text', label: 'Data Pin', default: 'gpio1' },
            ],
            controlValues: { count: 4, model: 'rgb', pin: 'gpio1' },
            inputs: [],
            outputs: [],
        });

        const graph = new GraphHistoryStub(node);
        const runtime = createRuntime('core.resizable');

        const view = new GraphPanelView({
            graph,
            collection: {
                getTargetId: () => null,
                getDeviceRuntimeId: () => 'general',
            },
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};
        view.syncNodeUisFromGraph();

        const nodeUi = view.nodeUiMap.get('node-controls');
        assert.ok(nodeUi, 'Expected NodeUi for the control node');

        const contentMinWidth = nodeUi.getMinContentWidth();
        assert.ok(contentMinWidth > 160, 'The control column should raise the minimum');

        view._applyNodeWidthUpdate('node-controls', 60, 'right');
        assert.equal(node.width, contentMinWidth);

        view._applyNodeWidthUpdate('node-controls', contentMinWidth + 40, 'right');
        assert.equal(node.width, contentMinWidth + 40);

        view.dispose();
    });
});
