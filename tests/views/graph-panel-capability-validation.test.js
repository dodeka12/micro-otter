// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppEventEmitter } from '../../src/micro_otter/nodes/html/js/core/app-event-emitter.js';
import { AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';
import { RuntimeCollectionRuntimesLoadedPayload } from '../../src/micro_otter/nodes/html/js/data/device-runtime-collection.js';
import {
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_OUTPUT_NODE_TYPE,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-nodes.js';
import { buildFunctionNodeTypeId } from '../../src/micro_otter/nodes/html/js/data/graph-function-signature.js';
import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

class CollectionTargetIdChangedPayload extends AppPayload {
    constructor(collectionId, targetId) {
        super('Collection.TargetIdChanged.v1');
        this.collectionId = collectionId;
        this.targetId = targetId;
    }
}

class NodeGraphNodeUpdatedPayload extends AppPayload {
    constructor(graphId, nodeId, patch = {}) {
        super('NodeGraph.NodeUpdated.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
        this.patch = patch;
        this.previous = {};
    }
}

class GraphStub extends AppEventEmitter {
    constructor(node) {
        super();
        this.id = 'graph-1';
        this.node = node;
    }

    getName() {
        return 'Graph 1';
    }

    getNodeIds() {
        return [this.node.getId()];
    }

    getNode(nodeId) {
        return nodeId === this.node.getId() ? this.node : null;
    }

    getConnections() {
        return [];
    }

    emitNodeUpdated(nodeId, patch) {
        this.emit('node-updated', new NodeGraphNodeUpdatedPayload(this.id, nodeId, patch));
    }
}

class CollectionStub extends AppEventEmitter {
    constructor(targetId) {
        super();
        this._targetId = targetId;
    }

    getTargetId() {
        return this._targetId;
    }

    getDeviceRuntimeId() {
        return 'general';
    }

    setTargetId(nextTargetId) {
        this._targetId = nextTargetId;
        this.emit('targetId', new CollectionTargetIdChangedPayload('collection-1', nextTargetId));
    }
}

describe('GraphPanelView capability validation triggers', () => {
    it('revalidates nodes when collection target changes', async () => {
        const node = new NodeData({
            id: 'node-1',
            type: 'core.pin',
        });

        const graph = new GraphStub(node);
        const collection = new CollectionStub('board-a');

        const runtime = {
            getNodeType() {
                return {
                    requiredCapabilities: ['pwm.output'],
                };
            },
            getDeviceTarget(targetId) {
                if (targetId === 'board-a') {
                    return {
                        capabilityToPins: { 'pwm.output': [1] },
                        generalCapabilities: {},
                        metadata: {},
                    };
                }
                return {
                    capabilityToPins: {},
                    generalCapabilities: {},
                    metadata: {},
                };
            },
        };

        const view = new GraphPanelView({
            graph,
            collection,
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};

        await view.revalidateNodeCapabilities();
        assert.equal(node.getCapabilityIssues().length, 0);

        collection.setTargetId('board-b');
        await new Promise((resolve) => setTimeout(resolve, 0));

        const issues = node.getCapabilityIssues();
        assert.equal(issues.length, 1);
        assert.equal(issues[0].capability, 'pwm.output');
    });

    it('revalidates affected node when control values change', async () => {
        const node = new NodeData({
            id: 'node-1',
            type: 'core.pin',
            controlValues: { pin: 1 },
        });

        const graph = new GraphStub(node);
        const collection = new CollectionStub('board-a');

        const runtime = {
            getNodeType() {
                return {
                    getCapabilityCheckHandler() {
                        return ({ node: nodeData }) => {
                            const pin = nodeData?.controlValues?.pin;
                            if (pin === 1) {
                                return [];
                            }
                            return [
                                {
                                    scope: 'control',
                                    controlId: 'pin',
                                    message: 'Selected pin is not supported',
                                },
                            ];
                        };
                    },
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

        const view = new GraphPanelView({
            graph,
            collection,
            workspace: {
                runtimeCollection: {
                    getRuntime: () => runtime,
                    getActiveRuntime: () => runtime,
                },
                getUserTargetConfig: async () => null,
            },
        });

        view.renderPanel = () => {};

        await view.revalidateNodeCapabilities();
        assert.equal(node.getCapabilityIssues().length, 0);

        node.setControlValue('pin', 2);
        graph.emitNodeUpdated(node.getId(), { controlValues: { pin: 2 } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const issues = node.getCapabilityIssues();
        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'control');
        assert.equal(issues[0].controlId, 'pin');
    });
});

/**
 * Runtime stub whose node-type table a test can change while the view is running.
 * @param {Record<string, unknown>|null} nodeType - Type definition to return, or `null` for an
 * unknown type.
 * @returns {{getNodeType: () => Record<string, unknown>|null, getDeviceTarget: () => {capabilityToPins: Record<string, unknown>, generalCapabilities: Record<string, unknown>, metadata: Record<string, unknown>}, setNodeType: (next: Record<string, unknown>|null) => void}} Runtime stub.
 */
function createMutableRuntime(nodeType) {
    let current = nodeType;
    return {
        getNodeType() {
            return current;
        },
        getDeviceTarget() {
            return { capabilityToPins: {}, generalCapabilities: {}, metadata: {} };
        },
        setNodeType(next) {
            current = next;
        },
    };
}

class RuntimeCollectionStub extends AppEventEmitter {
    constructor(runtime) {
        super();
        this.runtime = runtime;
    }

    getRuntime() {
        return this.runtime;
    }

    getActiveRuntime() {
        return this.runtime;
    }

    emitRuntimesLoaded() {
        this.emit(
            'runtimesLoaded',
            new RuntimeCollectionRuntimesLoadedPayload(['general'], 'general')
        );
    }
}

function createI18nServiceStub() {
    return {
        t: (key) => key,
        addEventListener: () => {},
        removeEventListener: () => {},
    };
}

describe('GraphPanelView unknown node types', () => {
    it('flags a node whose type the active runtime does not provide', async () => {
        const node = new NodeData({ id: 'node-1', type: 'sample_addon.hello' });
        const runtime = createMutableRuntime(null);
        const runtimeCollection = new RuntimeCollectionStub(runtime);

        const view = new GraphPanelView({
            graph: new GraphStub(node),
            collection: new CollectionStub('board-a'),
            i18nService: createI18nServiceStub(),
            workspace: {
                runtimeCollection,
                getUserTargetConfig: async () => null,
            },
        });
        view.renderPanel = () => {};

        await view.revalidateNodeCapabilities();

        const issues = node.getCapabilityIssues();
        assert.equal(issues.length, 1);
        assert.equal(issues[0].scope, 'node');
        assert.equal(issues[0].source, 'capabilityCheck');
        // The tooltip must name the package the user has to install.
        assert.match(issues[0].message, /sample_addon\.hello/);
        assert.match(issues[0].message, /sample_addon/);
    });

    it('clears the issue once the type resolves again', async () => {
        const node = new NodeData({ id: 'node-1', type: 'sample_addon.hello' });
        const runtime = createMutableRuntime(null);
        const runtimeCollection = new RuntimeCollectionStub(runtime);

        const view = new GraphPanelView({
            graph: new GraphStub(node),
            collection: new CollectionStub('board-a'),
            i18nService: createI18nServiceStub(),
            workspace: {
                runtimeCollection,
                getUserTargetConfig: async () => null,
            },
        });
        view.renderPanel = () => {};

        await view.revalidateNodeCapabilities();
        assert.equal(node.getCapabilityIssues().length, 1);

        runtime.setNodeType({ inputs: [], outputs: [], controls: [] });
        await view.revalidateNodeCapability('node-1');

        assert.deepEqual(node.getCapabilityIssues(), []);
    });

    it('leaves a node unflagged when no runtime can answer', async () => {
        const node = new NodeData({ id: 'node-1', type: 'sample_addon.hello' });
        node.setCapabilityIssues([{ scope: 'node', message: 'stale issue' }]);

        const view = new GraphPanelView({
            graph: new GraphStub(node),
            collection: new CollectionStub('board-a'),
            i18nService: createI18nServiceStub(),
            workspace: {
                runtimeCollection: {
                    getRuntime: () => null,
                    getActiveRuntime: () => null,
                },
                getUserTargetConfig: async () => null,
            },
        });
        view.renderPanel = () => {};

        await view.revalidateNodeCapabilities();

        // Without a runtime the missing package cannot be named, so the node must not be painted
        // as an error merely because nothing could be resolved.
        assert.deepEqual(node.getCapabilityIssues(), []);
    });

    it('revalidates when the runtime collection reloads its packages', async () => {
        const node = new NodeData({ id: 'node-1', type: 'sample_addon.hello' });
        const runtime = createMutableRuntime({ inputs: [], outputs: [], controls: [] });
        const runtimeCollection = new RuntimeCollectionStub(runtime);

        const view = new GraphPanelView({
            graph: new GraphStub(node),
            collection: new CollectionStub('board-a'),
            i18nService: createI18nServiceStub(),
            workspace: {
                runtimeCollection,
                getUserTargetConfig: async () => null,
            },
        });
        view.renderPanel = () => {};

        await view.revalidateNodeCapabilities();
        assert.deepEqual(node.getCapabilityIssues(), []);

        // Uninstalling the add-on removes the type from the reloaded runtime.
        runtime.setNodeType(null);
        runtimeCollection.emitRuntimesLoaded();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const issues = node.getCapabilityIssues();
        assert.equal(issues.length, 1);
        assert.match(issues[0].message, /sample_addon/);
    });
});

/**
 * Create a panel whose runtime resolves no node type at all.
 *
 * Every unresolved id therefore takes the missing-package path unless the type is exempt, which is
 * exactly the state in which the function-graph node types used to be flagged.
 * @param {NodeData} node - Only node of the graph.
 * @returns {GraphPanelView} Panel with rendering stubbed out.
 */
function createViewWithUnknownRuntime(node) {
    const runtime = createMutableRuntime(null);
    const view = new GraphPanelView({
        graph: new GraphStub(node),
        collection: new CollectionStub('board-a'),
        i18nService: createI18nServiceStub(),
        workspace: {
            runtimeCollection: new RuntimeCollectionStub(runtime),
            getUserTargetConfig: async () => null,
        },
    });
    view.renderPanel = () => {};
    return view;
}

describe('GraphPanelView function-graph node types', () => {
    it('never reports the structural function nodes as a missing package', async () => {
        for (const typeId of [FUNCTION_INPUT_NODE_TYPE, FUNCTION_OUTPUT_NODE_TYPE]) {
            const node = new NodeData({ id: 'node-1', type: typeId });
            node.setCapabilityIssues([{ scope: 'node', message: 'stale issue' }]);
            const view = createViewWithUnknownRuntime(node);

            await view.revalidateNodeCapabilities();
            assert.deepEqual(node.getCapabilityIssues(), [], `${typeId} must not be flagged`);

            node.setCapabilityIssues([{ scope: 'node', message: 'stale issue' }]);
            await view.revalidateNodeCapability('node-1');
            assert.deepEqual(node.getCapabilityIssues(), [], `${typeId} must not be flagged`);
        }
    });

    it('never reports a generated function call node as a missing package', async () => {
        const node = new NodeData({ id: 'node-1', type: buildFunctionNodeTypeId('graph-7') });
        node.setCapabilityIssues([{ scope: 'node', message: 'stale issue' }]);
        const view = createViewWithUnknownRuntime(node);

        await view.revalidateNodeCapabilities();
        assert.deepEqual(node.getCapabilityIssues(), []);

        node.setCapabilityIssues([{ scope: 'node', message: 'stale issue' }]);
        await view.revalidateNodeCapability('node-1');
        assert.deepEqual(node.getCapabilityIssues(), []);
    });

    it('still reports an add-on type that looks similar to a structural node', async () => {
        // The exemption is a type-id comparison, not a prefix or substring match: an add-on id
        // that merely mentions the structural nodes still names an installable package.
        const node = new NodeData({ id: 'node-1', type: 'sample_addon.graph.function.input' });
        const view = createViewWithUnknownRuntime(node);

        await view.revalidateNodeCapabilities();

        const issues = node.getCapabilityIssues();
        assert.equal(issues.length, 1);
        assert.match(issues[0].message, /sample_addon/);
    });
});

