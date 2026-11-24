// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: dynamic options on an input-row default control
 *
 * The store picker of `var-read` / `var-write` is an *input default*, not a control, so it
 * bypasses `_resolveDynamicControlData()` and the control visibility machinery. These tests
 * pin the three pieces that bridge it: the resolved option list, the synthetic dropdown that
 * makes `customStore` revealable, and the re-resolution that follows a pick.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { createDomHarness } from '../helpers/dom-harness.js';
import { NodeUi } from '../../src/micro_otter/nodes/html/js/nodes/node-ui.js';
import { getVisibleControls } from '../../src/micro_otter/nodes/html/js/nodes/node-ui-helpers.js';
import { NodeDropdownControlUi } from '../../src/micro_otter/nodes/html/js/nodes/controls/index.js';

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

function createGraph(node) {
    const updateCalls = [];
    return {
        updateCalls,
        getNode(nodeId) {
            return nodeId === node.id ? node : null;
        },
        getConnections() {
            return [];
        },
        getConnectionsForNode() {
            return [];
        },
        updateNode(nodeId, patch) {
            updateCalls.push({ nodeId, patch });
            if (nodeId !== node.id) {
                return;
            }
            if (patch.controlValues) {
                node.controlValues = { ...patch.controlValues };
            }
            Object.assign(node, patch);
        },
    };
}

function collectionWorkspaceList(nodes) {
    return {
        getActiveCollection: () => ({ getGraphArray: () => [{ getNodes: () => nodes }] }),
    };
}

function collectionWorkspace(...nodes) {
    return collectionWorkspaceList(nodes);
}

function varReadNode({ inputDefaults = {}, controlValues = {} } = {}) {
    return createNode({
        inputs: [
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
            { id: 'value', name: 'Default', defaultControl: { type: 'number' } },
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

describe('dynamic input-row default controls', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    it('resolves the option list and seeds an unset store on the default namespace', () => {
        const node = varReadNode();
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            workspace: collectionWorkspace(
                namespaceNode('r1', 'vars.var-read', 'presets', 'temp'),
                namespaceNode('w1', 'vars.var-write', 'logs', 'errors')
            ),
        });

        const storeControl = nodeUi.inputDefaultControlInstances.get('store');
        assert.ok(storeControl instanceof NodeDropdownControlUi);
        assert.deepEqual(
            storeControl.controlData.options.map((option) => option.value),
            ['default', 'logs', 'presets', '__new__']
        );
        assert.equal(nodeUi.getNodeData().inputDefaults.store, 'default');
        // The picker names the namespace the generator uses, not the sentinel.
        assert.equal(storeControl._displayLabel(), 'default');
    });

    it('replaces a stored empty store with the default namespace', () => {
        const node = varReadNode({ inputDefaults: { store: '' } });
        const nodeUi = new NodeUi(createGraph(node), node.id, {
            workspace: collectionWorkspace(namespaceNode('r1', 'vars.var-read', 'default', 'temp')),
        });

        assert.equal(nodeUi.getNodeData().inputDefaults.store, 'default');
        assert.equal(nodeUi.inputDefaultControlInstances.get('store')._displayLabel(), 'default');
    });

    it('echoes the typed store on the picker row while the sentinel is selected', () => {
        const node = varReadNode({
            inputDefaults: { store: '__new__' },
            controlValues: { customStore: 'presets' },
        });
        const nodeUi = new NodeUi(createGraph(node), node.id, {
            workspace: collectionWorkspace(namespaceNode('r1', 'vars.var-read', 'presets', 'temp')),
        });

        const storeControl = nodeUi.inputDefaultControlInstances.get('store');
        assert.equal(storeControl.getValue(), '__new__');
        assert.equal(storeControl._displayLabel(), 'presets');

        // The menu entry keeps the sentinel text: the row still reads as "create new".
        const sentinel = storeControl.controlData.options.find(
            (option) => option.value === '__new__'
        );
        assert.equal(sentinel.label, 'New store\u2026');
    });

    it('echoes the typed variable name on the name picker row', () => {
        const node = varReadNode({
            inputDefaults: { store: 'presets' },
            controlValues: { name: '__new__', customName: 'humidity' },
        });
        const nodeUi = new NodeUi(createGraph(node), node.id, {
            workspace: collectionWorkspace(namespaceNode('r1', 'vars.var-read', 'presets', 'temp')),
        });

        const nameControl = nodeUi.controlInstances.get('name');
        assert.equal(nameControl.getValue(), '__new__');
        assert.equal(nameControl._displayLabel(), 'humidity');
    });

    it('never rewrites a stored store value', () => {
        const node = varReadNode({ inputDefaults: { store: 'presets' } });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            workspace: collectionWorkspace(namespaceNode('r1', 'vars.var-read', 'logs', 'errors')),
        });

        const storeControl = nodeUi.inputDefaultControlInstances.get('store');
        assert.equal(nodeUi.getNodeData().inputDefaults.store, 'presets');
        assert.equal(storeControl.controlData.options[0].value, 'presets');
    });

    it('resolves the name list of the selected namespace', () => {
        const node = varReadNode({ inputDefaults: { store: 'presets' } });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            workspace: collectionWorkspace(
                namespaceNode('r1', 'vars.var-read', 'presets', 'temp'),
                namespaceNode('w1', 'vars.var-write', 'presets', 'humidity'),
                namespaceNode('r2', 'vars.var-read', 'logs', 'errors')
            ),
        });

        const nameControl = nodeUi.controlInstances.get('name');
        assert.deepEqual(
            nameControl.controlData.options.map((option) => option.value),
            ['', 'humidity', 'temp', '__new__']
        );
    });

    it('re-resolves the name list when the store input changes', () => {
        const node = varReadNode({ inputDefaults: { store: 'presets' } });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            workspace: collectionWorkspace(
                namespaceNode('r1', 'vars.var-read', 'presets', 'temp'),
                namespaceNode('r2', 'vars.var-read', 'logs', 'errors')
            ),
        });
        assert.deepEqual(
            nodeUi.controlInstances.get('name').controlData.options.map((option) => option.value),
            ['', 'temp', '__new__']
        );

        node.inputDefaults.store = 'logs';
        nodeUi.onControlChanged('store', 'logs', 'presets');

        assert.deepEqual(
            nodeUi.controlInstances.get('name').controlData.options.map((option) => option.value),
            ['', 'errors', '__new__']
        );
    });

    it('writes an input default to inputDefaults only', () => {
        const node = varReadNode({ inputDefaults: { store: 'presets' } });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            workspace: collectionWorkspace(namespaceNode('r1', 'vars.var-read', 'logs', 'errors')),
        });

        node.inputDefaults.store = '__new__';
        nodeUi.onControlChanged('store', '__new__', 'presets');

        assert.equal(graph.updateCalls.at(-1).patch.controlValues, undefined);
        assert.equal(nodeUi.getNodeData().controlValues.store, undefined);
    });
});


describe('input-row reveal and refresh', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.cleanup();
    });

    function storeDropdownExtras(selected, stores = ['presets']) {
        return [
            {
                id: 'store',
                type: 'dropdown',
                affectsControls: true,
                default: selected,
                options: [
                    { value: selected === '__new__' ? '' : selected, label: selected },
                    ...stores
                        .filter((store) => store !== selected)
                        .map((store) => ({ value: store, label: store })),
                    { value: '__new__', label: 'New store\u2026', activeControls: ['customStore'] },
                ],
            },
        ];
    }

    it('hides the companion control while a real store is selected', () => {
        const data = {
            controls: [
                { id: 'customStore', type: 'text' },
                { id: 'customName', type: 'text' },
            ],
            controlValues: {},
            inputDefaults: { store: 'presets' },
        };

        assert.deepEqual(
            getVisibleControls(data, storeDropdownExtras('presets')).map((control) => control.id),
            ['customName']
        );
    });

    it('shows the companion control for the sentinel and keeps unrelated controls', () => {
        const data = {
            controls: [
                { id: 'customStore', type: 'text' },
                { id: 'customName', type: 'text' },
            ],
            controlValues: {},
            inputDefaults: { store: '__new__' },
        };

        assert.deepEqual(
            getVisibleControls(data, storeDropdownExtras('__new__')).map((control) => control.id),
            ['customStore', 'customName']
        );
    });

    it('returns the same cached list until the selection changes', () => {
        const node = varReadNode({ inputDefaults: { store: 'presets' } });
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            workspace: collectionWorkspace(namespaceNode('r1', 'vars.var-read', 'logs', 'errors')),
        });

        const first = nodeUi._getVisibleControls(node);
        assert.ok(!first.some((control) => control.id === 'customStore'));
        assert.equal(nodeUi._getVisibleControls(node), first);

        node.inputDefaults.store = '__new__';
        nodeUi.onControlChanged('store', '__new__', 'presets');

        const afterPick = nodeUi._getVisibleControls(node);
        assert.ok(afterPick.some((control) => control.id === 'customStore'));
        assert.notEqual(afterPick, first);
    });

    it('detects a cross-node source on an input default control', () => {
        const dynamic = varReadNode();
        const dynamicUi = new NodeUi(createGraph(dynamic), dynamic.id, {
            workspace: collectionWorkspace(),
        });
        assert.equal(dynamicUi._hasCrossNodeControl(), true);

        const plain = createNode({
            id: 'plain-1',
            inputs: [{ id: 'store', name: 'Store', defaultControl: { type: 'text' } }],
            controls: [{ id: 'qos', type: 'dropdown', options: [] }],
        });
        const plainUi = new NodeUi(createGraph(plain), plain.id, {
            workspace: collectionWorkspace(),
        });
        assert.equal(plainUi._hasCrossNodeControl(), false);
    });

    it('rebuilds the input default instances on a dynamic refresh', () => {
        const node = varReadNode({ inputDefaults: { store: 'presets' } });
        const nodes = [namespaceNode('r1', 'vars.var-read', 'presets', 'temp')];
        const graph = createGraph(node);
        const nodeUi = new NodeUi(graph, node.id, {
            workspace: collectionWorkspaceList(nodes),
        });
        const before = nodeUi.inputDefaultControlInstances.get('store');
        assert.deepEqual(
            nodeUi.controlInstances.get('name').controlData.options.map((option) => option.value),
            ['', 'temp', '__new__']
        );

        nodes.push(namespaceNode('w1', 'vars.var-write', 'presets', 'humidity'));
        nodeUi._refreshDynamicControls();

        assert.notEqual(nodeUi.inputDefaultControlInstances.get('store'), before);
        assert.deepEqual(
            nodeUi.controlInstances.get('name').controlData.options.map((option) => option.value),
            ['', 'humidity', 'temp', '__new__']
        );
    });
});

