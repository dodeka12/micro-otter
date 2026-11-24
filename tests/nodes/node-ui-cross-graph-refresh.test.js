// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: cross-graph refresh of collection-scoped dynamic option lists
 *
 * A node's option list can be fed by other graphs (`varNames`, `varStores`, `graphTopics`,
 * `availabilityRefs` all read the whole collection). The node listens to its own graph
 * already; without listening to the *other* graphs a graph tab that was rendered earlier
 * keeps the options it resolved back then, so a variable created in graph A never appeared
 * in the pickers of graph B.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';

/** Minimal event emitter with a listener count, so a test can assert subscriptions. */
function createEmitter() {
    const listeners = new Map();

    return {
        on(event, handler) {
            const bucket = listeners.get(event) || new Set();
            bucket.add(handler);
            listeners.set(event, bucket);
            return () => this.off(event, handler);
        },
        off(event, handler) {
            const bucket = listeners.get(event);
            if (!bucket) {
                return;
            }
            bucket.delete(handler);
            if (bucket.size === 0) {
                listeners.delete(event);
            }
        },
        emit(event, payload) {
            [...(listeners.get(event) || [])].forEach((handler) => handler(payload));
            // `on('*')` listeners (Collection forwards every change on a wildcard).
            if (event !== '*') {
                [...(listeners.get('*') || [])].forEach((handler) => handler(payload));
            }
        },
        listenerCount() {
            let count = 0;
            listeners.forEach((bucket) => {
                count += bucket.size;
            });
            return count;
        },
    };
}

// Graph double: node lookup plus the node events `NodeUi` subscribes to.
function createGraph(nodes) {
    return {
        nodes,
        ...createEmitter(),
        getNode(nodeId) {
            return nodes.find((node) => node.id === nodeId) || null;
        },
        getNodes() {
            return nodes;
        },
        getConnections() {
            return [];
        },
        getConnectionsForNode() {
            return [];
        },
        updateNode(nodeId, patch) {
            const node = nodes.find((entry) => entry.id === nodeId);
            if (node) {
                Object.assign(node, patch);
            }
        },
    };
}

// Collection double: the workspace hands this out as the active collection.
function createCollection(graphs) {
    return {
        graphs,
        ...createEmitter(),
        getGraphArray() {
            return graphs;
        },
    };
}

function createNode(overrides = {}) {
    const node = {
        id: 'var-read-1',
        type: 'vars.var-read',
        x: 100,
        y: 80,
        width: 240,
        height: 200,
        title: 'Variable Read',
        collapsed: false,
        controls: [],
        inputs: [],
        outputs: [],
        controlValues: {},
        inputDefaults: {},
        setPosition(x, y) {
            this.x = x;
            this.y = y;
        },
    };
    Object.assign(node, overrides);
    return node;
}

function varReadNode({ inputDefaults = {}, controlValues = {} } = {}) {
    return createNode({
        inputs: [
            { id: 'value', name: 'Default', defaultControl: { type: 'number' } },
            {
                id: 'store',
                name: 'Store',
                defaultControl: {
                    type: 'dropdown',
                    label: 'Store',
                    default: 'default',
                    affectsControls: true,
                    dynamicOptions: { source: 'varStores', newStoreControls: ['customStore'] },
                },
            },
        ],
        outputs: [{ id: 'value', name: 'Value' }],
        controls: [
            {
                id: 'name',
                type: 'dropdown',
                label: 'Name',
                default: '',
                affectsControls: true,
                dynamicOptions: {
                    source: 'varNames',
                    dependsOn: ['store'],
                    newNameControls: ['customName'],
                },
            },
            { id: 'customStore', type: 'text', label: 'New store' },
            { id: 'customName', type: 'text', label: 'New variable' },
            { id: 'value', type: 'number', label: 'Default' },
        ],
        controlValues,
        inputDefaults,
    });
}

function namespaceNode(id, type, store, name) {
    return {
        id,
        type,
        inputs: [{ id: 'store', name: 'Store' }],
        controls: [{ id: 'name', type: 'dropdown' }],
        inputDefaults: { store },
        // A variable only exists once a node declares it, so these fixtures declare `name`.
        controlValues: { name: '__new__', customName: name },
    };
}

function nameOptions(nodeUi) {
    return nodeUi.controlInstances.get('name').controlData.options.map((option) => option.value);
}

describe('cross-graph option refresh', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('refreshes the name picker when another graph gains a variable', () => {
        const node = varReadNode({ inputDefaults: { store: 'default' } });
        const primary = createGraph([node]);
        const foreign = createGraph([namespaceNode('r1', 'vars.var-read', 'default', 'temp')]);
        const collection = createCollection([primary, foreign]);
        const nodeUi = new NodeUi(primary, node.id, {
            workspace: { getActiveCollection: () => collection },
        });

        assert.deepEqual(nameOptions(nodeUi), ['', 'temp', '__new__']);

        foreign.nodes.push(namespaceNode('w1', 'vars.var-write', 'default', 'pressure'));
        foreign.emit('node-updated', { nodeId: 'w1' });

        assert.deepEqual(nameOptions(nodeUi), ['', 'pressure', 'temp', '__new__']);
    });

    it('refreshes the store picker when another graph names a namespace', () => {
        const node = varReadNode({ inputDefaults: { store: 'default' } });
        const primary = createGraph([node]);
        const foreign = createGraph([]);
        const collection = createCollection([primary, foreign]);
        const nodeUi = new NodeUi(primary, node.id, {
            workspace: { getActiveCollection: () => collection },
        });

        const storeOptions = () =>
            nodeUi.inputDefaultControlInstances
                .get('store')
                .controlData.options.map((option) => option.value);

        assert.deepEqual(storeOptions(), ['default', '__new__']);

        foreign.nodes.push(namespaceNode('r1', 'vars.var-read', 'presets', 'temp'));
        foreign.emit('node-added', { nodeId: 'r1' });

        assert.deepEqual(storeOptions(), ['default', 'presets', '__new__']);
    });

    it('subscribes to the foreign graphs but not to its own twice', () => {
        const node = varReadNode({ inputDefaults: { store: 'default' } });
        const primary = createGraph([node]);
        const foreign = createGraph([]);
        const collection = createCollection([primary, foreign]);

        new NodeUi(primary, node.id, {
            workspace: { getActiveCollection: () => collection },
        });

        // node-added / node-updated / node-removed, once per graph role.
        assert.equal(primary.listenerCount(), 3);
        assert.equal(foreign.listenerCount(), 3);
    });

    it('subscribes to nothing for a node without a cross-node source', () => {
        const plain = createNode({
            id: 'plain-1',
            controls: [{ id: 'qos', type: 'dropdown', options: [] }],
        });
        const primary = createGraph([plain]);
        const foreign = createGraph([]);
        const collection = createCollection([primary, foreign]);

        new NodeUi(primary, plain.id, {
            workspace: { getActiveCollection: () => collection },
        });

        assert.equal(foreign.listenerCount(), 0);
        assert.equal(collection.listenerCount(), 0);
    });

    it('observes a graph that joins the collection later', () => {
        const node = varReadNode({ inputDefaults: { store: 'default' } });
        const primary = createGraph([node]);
        const graphs = [primary];
        const collection = createCollection(graphs);
        const nodeUi = new NodeUi(primary, node.id, {
            workspace: { getActiveCollection: () => collection },
        });

        assert.deepEqual(nameOptions(nodeUi), ['', '__new__']);

        const late = createGraph([namespaceNode('r1', 'vars.var-read', 'default', 'temp')]);
        graphs.push(late);
        collection.emit('graphAdded', { name: 'graphAdded' });

        assert.equal(late.listenerCount(), 3);
        assert.deepEqual(nameOptions(nodeUi), ['', 'temp', '__new__']);
    });

    it('drops the subscriptions of a graph that leaves the collection', () => {
        const node = varReadNode({ inputDefaults: { store: 'default' } });
        const primary = createGraph([node]);
        const foreign = createGraph([]);
        const graphs = [primary, foreign];
        const collection = createCollection(graphs);

        new NodeUi(primary, node.id, {
            workspace: { getActiveCollection: () => collection },
        });
        assert.equal(foreign.listenerCount(), 3);

        graphs.pop();
        collection.emit('graphRemoved', { name: 'graphRemoved' });

        assert.equal(foreign.listenerCount(), 0);
    });

    it('ignores collection events that do not change the graph set', () => {
        const node = varReadNode({ inputDefaults: { store: 'default' } });
        const primary = createGraph([node]);
        const foreign = createGraph([]);
        const collection = createCollection([primary, foreign]);

        new NodeUi(primary, node.id, {
            workspace: { getActiveCollection: () => collection },
        });

        collection.emit('targetId', { name: 'targetId' });

        assert.equal(foreign.listenerCount(), 3);
    });

    it('drops every subscription on destroy', () => {
        const node = varReadNode({ inputDefaults: { store: 'default' } });
        const primary = createGraph([node]);
        const foreign = createGraph([]);
        const collection = createCollection([primary, foreign]);
        const nodeUi = new NodeUi(primary, node.id, {
            workspace: { getActiveCollection: () => collection },
        });

        nodeUi.destroy();

        assert.equal(primary.listenerCount(), 0);
        assert.equal(foreign.listenerCount(), 0);
        assert.equal(collection.listenerCount(), 0);
    });
});
