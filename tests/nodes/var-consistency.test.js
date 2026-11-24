// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: variable reference consistency
 *
 * A variable exists only while exactly one node declares it; every other node references it.
 * These tests pin the reconciliation rules: renames propagate, and a reference whose declaration
 * disappeared is reset to "(not set)" (an empty `name`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    declarationKey,
    declaredVarEntries,
    danglingVarReferences,
    VarReferenceReconciler,
    varReferencePatchesForChange,
} from '../../src/micro_otter/nodes/html/js/nodes/var-consistency.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';
import { registerGraphRules } from '../../src/micro_otter/nodes/device/node_pkgs/vars/node_capabilities.js';

function varNode(id, { store, name, customStore, customName } = {}) {
    const inputDefaults = {};
    const controlValues = {};
    if (store !== undefined) {
        inputDefaults.store = store;
    }
    if (name !== undefined) {
        controlValues.name = name;
    }
    if (customStore !== undefined) {
        controlValues.customStore = customStore;
    }
    if (customName !== undefined) {
        controlValues.customName = customName;
    }
    return { id, type: 'vars.var-read', inputDefaults, controlValues };
}

/**
 * A graph double with in-place `updateNode`, plus a record of every write.
 * @param {...object} nodes - Var nodes the graph starts with.
 */
function fakeGraph(...nodes) {
    const list = nodes.map((node) => ({
        ...node,
        controlValues: { ...node.controlValues },
        inputDefaults: { ...node.inputDefaults },
    }));
    const updates = [];
    return {
        getNodes: () => list,
        updateNode(id, patch, previous) {
            const node = list.find((candidate) => candidate.id === id);
            if (!node) {
                return null;
            }
            if (patch.controlValues) {
                node.controlValues = { ...patch.controlValues };
            }
            updates.push({ id, patch, previous });
            return node;
        },
        updates,
    };
}

describe('declaredVarEntries', () => {
    it('collects only declaration sites with their store and node id', () => {
        const entries = declaredVarEntries([
            varNode('d1', { store: 'presets', name: '__new__', customName: 'temp' }),
            varNode('r1', { store: 'presets', name: 'temp' }),
            varNode('d2', { name: '__new__', customName: 'counter' }),
            varNode('s1', { store: 'presets', name: '__new__', customName: '' }),
        ]);

        assert.deepEqual(entries, [
            { store: 'presets', name: 'temp', nodeId: 'd1' },
            { store: 'default', name: 'counter', nodeId: 'd2' },
        ]);
    });

    it('keys a store/name pair without accidental collisions', () => {
        assert.notEqual(declarationKey('a', 'b'), declarationKey('a\u0000b', ''));
    });
});

describe('varReferencePatchesForChange', () => {
    it('renames references of a declared variable that changed its name', () => {
        const nodes = [
            varNode('d1', { store: 'presets', name: '__new__', customName: 'new' }),
            varNode('r1', { store: 'presets', name: 'old' }),
            varNode('r2', { store: 'presets', name: 'old' }),
            varNode('r3', { store: 'other', name: 'old' }),
            varNode('r4', { store: 'presets', name: 'new' }),
        ];
        const patches = varReferencePatchesForChange(
            { controlValues: { name: '__new__', customName: 'old' } },
            varNode('d1', { store: 'presets', name: '__new__', customName: 'new' }),
            nodes
        );

        assert.deepEqual(patches, [
            { nodeId: 'r1', name: 'new' },
            { nodeId: 'r2', name: 'new' },
        ]);
    });

    it('does not rename when a declaration switches to "use"', () => {
        const nodes = [
            varNode('d1', { store: 'presets', name: 'other' }),
            varNode('r1', { store: 'presets', name: 'old' }),
        ];
        assert.deepEqual(
            varReferencePatchesForChange(
                { controlValues: { name: '__new__', customName: 'old' } },
                varNode('d1', { store: 'presets', name: 'other' }),
                nodes
            ),
            []
        );
    });

    it('does not rename when the declared name is cleared', () => {
        const nodes = [varNode('r1', { store: 'presets', name: 'old' })];
        assert.deepEqual(
            varReferencePatchesForChange(
                { controlValues: { name: '__new__', customName: 'old' } },
                varNode('d1', { store: 'presets', name: '__new__', customName: '' }),
                nodes
            ),
            []
        );
    });

    it('does not treat a store change as a rename', () => {
        const nodes = [varNode('r1', { store: 'oldstore', name: 'temp' })];
        assert.deepEqual(
            varReferencePatchesForChange(
                { inputDefaults: { store: 'oldstore' } },
                varNode('d1', { store: 'newstore', name: '__new__', customName: 'temp' }),
                nodes
            ),
            []
        );
    });
});

describe('danglingVarReferences', () => {
    it('resets references whose declaration is missing', () => {
        const nodes = [
            varNode('d1', { store: 'presets', name: '__new__', customName: 'temp' }),
            varNode('r1', { store: 'presets', name: 'ghost' }),
            varNode('r2', { store: 'presets', name: 'temp' }),
            varNode('r3', { store: 'presets', name: '' }),
            varNode('r4', { store: 'presets', name: '__new__', customName: 'other' }),
        ];

        assert.deepEqual(danglingVarReferences(nodes), [{ nodeId: 'r1', name: '' }]);
    });

    it('returns nothing when every reference resolves', () => {
        const nodes = [
            varNode('d1', { name: '__new__', customName: 'temp' }),
            varNode('r1', { name: 'temp' }),
        ];

        assert.deepEqual(danglingVarReferences(nodes), []);
    });
});

describe('VarReferenceReconciler', () => {
    it('propagates a rename across the nodes of one graph', () => {
        const declaring = varNode('d1', { name: '__new__', customName: 'old' });
        const reference = varNode('r1', { name: 'old' });
        const graph = fakeGraph(declaring, reference);
        const reconciler = new VarReferenceReconciler(() => [graph]);

        graph.getNodes().find((node) => node.id === 'd1').controlValues.customName = 'new';
        reconciler.reconcile({
            nodeId: 'd1',
            previous: { controlValues: { name: '__new__', customName: 'old' } },
        });

        assert.equal(graph.getNodes().find((node) => node.id === 'r1').controlValues.name, 'new');
    });

    it('resets references when the declaring node switches to "use"', () => {
        const declaring = varNode('d1', { name: '__new__', customName: 'temp' });
        const reference = varNode('r1', { name: 'temp' });
        const graph = fakeGraph(declaring, reference);
        const reconciler = new VarReferenceReconciler(() => [graph]);

        graph.getNodes().find((node) => node.id === 'd1').controlValues.name = 'other';
        reconciler.reconcile({
            nodeId: 'd1',
            previous: { controlValues: { name: '__new__', customName: 'temp' } },
        });

        assert.equal(graph.getNodes().find((node) => node.id === 'r1').controlValues.name, '');
    });

    it('resets references when the declaring node is removed', () => {
        const declaring = varNode('d1', { name: '__new__', customName: 'temp' });
        const reference = varNode('r1', { name: 'temp' });
        const graph = fakeGraph(declaring, reference);
        const reconciler = new VarReferenceReconciler(() => [graph]);

        const list = graph.getNodes();
        list.splice(
            list.findIndex((node) => node.id === 'd1'),
            1
        );
        reconciler.reconcile();

        assert.equal(graph.getNodes().find((node) => node.id === 'r1').controlValues.name, '');
    });

    it('repairs a reference in one graph from a declaration in another', () => {
        const declaringGraph = fakeGraph(
            varNode('d1', { store: 'presets', name: '__new__', customName: 'temp' })
        );
        const referenceGraph = fakeGraph(varNode('r1', { store: 'presets', name: 'temp' }));
        const reconciler = new VarReferenceReconciler(() => [declaringGraph, referenceGraph]);

        declaringGraph.getNodes().find((node) => node.id === 'd1').controlValues.customName = 'other';
        reconciler.reconcile({
            nodeId: 'd1',
            previous: { controlValues: { name: '__new__', customName: 'temp' } },
        });

        assert.equal(
            referenceGraph.getNodes().find((node) => node.id === 'r1').controlValues.name,
            'other'
        );
    });

    it('is idempotent: a second pass writes nothing', () => {
        const graph = fakeGraph(
            varNode('d1', { name: '__new__', customName: 'temp' }),
            varNode('r1', { name: 'temp' })
        );
        const reconciler = new VarReferenceReconciler(() => [graph]);

        reconciler.reconcile();
        assert.equal(graph.updates.length, 0, 'no writes when nothing is inconsistent');

        graph.getNodes().find((node) => node.id === 'd1').controlValues.customName = 'renamed';
        reconciler.reconcile({
            nodeId: 'd1',
            previous: { controlValues: { name: '__new__', customName: 'temp' } },
        });
        const writes = graph.updates.length;
        assert.ok(writes > 0);

        reconciler.reconcile();
        assert.equal(graph.updates.length, writes, 'a second pass adds no writes');
    });
});

describe('Collection variable reconciliation', () => {
    const COLLECTION_ID = '123e4567-e89b-42d3-a456-426614174002';

    function varReadNode(id, controlValues, inputDefaults = {}) {
        return {
            id,
            type: 'vars.var-read',
            x: 0,
            y: 0,
            controls: [],
            inputs: [],
            outputs: [],
            controlValues,
            inputDefaults,
        };
    }

    function collectionWith(...nodes) {
        return new Collection({
            id: COLLECTION_ID,
            title: 'Vars Consistency',
            graphs: [
                new NodeGraph({
                    id: 'graph-1',
                    name: 'Graph 1',
                    nodes,
                    connections: [],
                }),
            ],
            activeGraphIdx: 0,
        });
    }

    it('renames references through the node-updated bridge', () => {
        const collection = collectionWith(
            varReadNode('d1', { name: '__new__', customName: 'old' }, { store: 'default' }),
            varReadNode('r1', { name: 'old' }, { store: 'default' })
        );
        const graph = collection.getActiveGraph();

        graph.updateNode(
            'd1',
            { controlValues: { name: '__new__', customName: 'new' } },
            { controlValues: { name: '__new__', customName: 'old' } }
        );

        assert.equal(graph.getNode('r1').controlValues.name, 'new');
    });

    it('resets references when a declaring node is removed through the bridge', () => {
        const collection = collectionWith(
            varReadNode('d1', { name: '__new__', customName: 'temp' }, { store: 'default' }),
            varReadNode('r1', { name: 'temp' }, { store: 'default' })
        );
        const graph = collection.getActiveGraph();

        graph.removeNode('d1');

        assert.equal(graph.getNode('r1').controlValues.name, '');
    });

    it('resets references when the declaring node switches to "use"', () => {
        const collection = collectionWith(
            varReadNode('d1', { name: '__new__', customName: 'temp' }, { store: 'default' }),
            varReadNode('r1', { name: 'temp' }, { store: 'default' })
        );
        const graph = collection.getActiveGraph();

        graph.updateNode(
            'd1',
            { controlValues: { name: 'other', customName: 'temp' } },
            { controlValues: { name: '__new__', customName: 'temp' } }
        );

        assert.equal(graph.getNode('r1').controlValues.name, '');
    });
});

describe('vars duplicate-declaration rule', () => {
    function declaringNode(id, store, customName) {
        return {
            id,
            type: 'vars.var-read',
            inputDefaults: { store },
            controlValues: { name: '__new__', customName },
        };
    }

    function runRule(nodes) {
        const rules = [];
        registerGraphRules((rule) => rules.push(rule));
        const rule = rules.find((candidate) => candidate.id === 'vars-duplicate-declaration');
        assert.ok(rule, 'the duplicate-declaration rule is registered');
        return rule.run({ nodes, collectionNodes: nodes });
    }

    it('flags both nodes that declare the same variable', () => {
        const issues = runRule([
            declaringNode('d1', 'presets', 'temp'),
            declaringNode('d2', 'presets', 'temp'),
        ]);

        assert.deepEqual(issues.map((entry) => entry.nodeId).sort(), ['d1', 'd2']);
        assert.ok(
            issues.every((entry) => entry.source === 'graphRule' && entry.scope === 'node')
        );
    });

    it('does not flag a single declaration', () => {
        assert.deepEqual(runRule([declaringNode('d1', 'presets', 'temp')]), []);
    });

    it('does not flag the same name in different stores', () => {
        assert.deepEqual(
            runRule([
                declaringNode('d1', 'presets', 'temp'),
                declaringNode('d2', 'logs', 'temp'),
            ]),
            []
        );
    });

    it('does not flag a reference node next to the declaration', () => {
        const reference = {
            id: 'r1',
            type: 'vars.var-read',
            inputDefaults: { store: 'presets' },
            controlValues: { name: 'temp' },
        };
        assert.deepEqual(runRule([declaringNode('d1', 'presets', 'temp'), reference]), []);
    });
});

