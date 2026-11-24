// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: interrupt reference consistency
 *
 * An interrupt channel exists only while one `interrupt-input` node declares it. These tests pin
 * the reconciliation rules: a rename rewrites every `interrupt-enable` reference and every graph
 * `triggerName`, and a reference whose declaration disappeared is reset to "not set" (`''`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    danglingIrqReferences,
    declaredIrqEntries,
    IrqReferenceReconciler,
    irqReferencePatchesForChange,
} from '../../src/micro_otter/nodes/html/js/nodes/irq-consistency.js';
import { Collection } from '../../src/micro_otter/nodes/html/js/data/collection.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

function irqNode(id, type, triggerName) {
    return { id, type, controlValues: triggerName === undefined ? {} : { triggerName } };
}

function inputNode(id, triggerName) {
    return irqNode(id, 'irq.interrupt-input', triggerName);
}

function enableNode(id, triggerName) {
    return irqNode(id, 'irq.interrupt-enable', triggerName);
}

function fakeGraph(nodes, { id = 'graph-1', name = 'Graph 1', triggerName = '' } = {}) {
    const list = nodes.map((node) => ({ ...node, controlValues: { ...node.controlValues } }));
    const updates = [];
    const triggers = [];
    let currentTrigger = triggerName;
    return {
        getId: () => id,
        getName: () => name,
        getNodes: () => list,
        updateNode(nodeId, patch) {
            const node = list.find((candidate) => candidate.id === nodeId);
            if (!node) {
                return null;
            }
            if (patch.controlValues) {
                node.controlValues = { ...patch.controlValues };
            }
            updates.push({ id: nodeId, patch });
            return node;
        },
        getTriggerName: () => currentTrigger,
        setTriggerName(next) {
            currentTrigger = next;
            triggers.push(next);
            return this;
        },
        updates,
        triggers,
        node: (nodeId) => list.find((candidate) => candidate.id === nodeId),
    };
}

describe('declaredIrqEntries', () => {
    it('lists only named interrupt inputs, with their node id', () => {
        const nodes = [
            inputNode('d1', 'button'),
            inputNode('d2', '   '),
            enableNode('r1', 'button'),
        ];

        assert.deepEqual(declaredIrqEntries(nodes), [{ name: 'button', nodeId: 'd1' }]);
    });
});

describe('danglingIrqReferences', () => {
    it('resets enable nodes whose declaration disappeared', () => {
        const nodes = [
            inputNode('d1', 'button'),
            enableNode('r1', 'button'),
            enableNode('r2', 'ghost'),
            enableNode('r3', ''),
        ];

        assert.deepEqual(danglingIrqReferences(nodes), [{ nodeId: 'r2', name: '' }]);
    });

    it('keeps duplicate declarations alone', () => {
        const nodes = [
            inputNode('d1', 'button'),
            inputNode('d2', 'button'),
            enableNode('r1', 'button'),
        ];

        assert.deepEqual(danglingIrqReferences(nodes), []);
    });
});

describe('irqReferencePatchesForChange', () => {
    it('rewrites enable nodes that referenced the previous name', () => {
        const nodes = [
            inputNode('d1', 'new'),
            enableNode('r1', 'old'),
            enableNode('r2', 'new'),
        ];

        const patches = irqReferencePatchesForChange(
            { controlValues: { triggerName: 'old' } },
            inputNode('d1', 'new'),
            nodes
        );

        assert.deepEqual(patches, [{ nodeId: 'r1', name: 'new' }]);
    });

    it('rewrites references across graphs', () => {
        const patches = irqReferencePatchesForChange(
            { controlValues: { triggerName: 'old' } },
            inputNode('d1', 'new'),
            [inputNode('d1', 'new'), enableNode('r1', 'old')]
        );

        assert.deepEqual(patches, [{ nodeId: 'r1', name: 'new' }]);
    });

    it('does not rewrite anything when the name is cleared', () => {
        const patches = irqReferencePatchesForChange(
            { controlValues: { triggerName: 'old' } },
            inputNode('d1', ''),
            [inputNode('d1', ''), enableNode('r1', 'old')]
        );

        assert.deepEqual(patches, []);
    });

    it('does not treat an input-default edit as a rename', () => {
        const patches = irqReferencePatchesForChange(
            { inputDefaults: { pin: 4 } },
            inputNode('d1', 'new'),
            [enableNode('r1', 'old')]
        );

        assert.deepEqual(patches, []);
    });
});


describe('IrqReferenceReconciler', () => {
    it('rewrites enable nodes in another graph on rename', () => {
        const declaring = fakeGraph([inputNode('d1', 'old')], { id: 'graph-init', name: 'Init' });
        const referencing = fakeGraph([enableNode('r1', 'old')]);
        const reconciler = new IrqReferenceReconciler(() => [declaring, referencing]);

        declaring.node('d1').controlValues.triggerName = 'new';
        reconciler.reconcile({
            nodeId: 'd1',
            previous: { controlValues: { triggerName: 'old' } },
        });

        assert.equal(referencing.node('r1').controlValues.triggerName, 'new');
    });

    it('rewrites a graph trigger name through setTriggerName', () => {
        const declaring = fakeGraph([inputNode('d1', 'old')]);
        const irqGraph = fakeGraph([], { id: 'graph-irq', name: 'Irq', triggerName: 'old' });
        const reconciler = new IrqReferenceReconciler(() => [declaring, irqGraph]);

        declaring.node('d1').controlValues.triggerName = 'new';
        reconciler.reconcile({
            nodeId: 'd1',
            previous: { controlValues: { triggerName: 'old' } },
        });

        assert.equal(irqGraph.getTriggerName(), 'new');
        assert.deepEqual(irqGraph.triggers, ['new']);
    });

    it('clears every reference when the declaring node is removed', () => {
        const graph = fakeGraph([inputNode('d1', 'button'), enableNode('r1', 'button')], {
            triggerName: 'button',
        });
        const reconciler = new IrqReferenceReconciler(() => [graph]);

        graph.getNodes().splice(0, 1);
        reconciler.reconcile();

        assert.equal(graph.node('r1').controlValues.triggerName, '');
        assert.equal(graph.getTriggerName(), '');
    });

    it('clears a graph trigger name whose declaration was deleted elsewhere', () => {
        const declaring = fakeGraph([inputNode('d1', 'button')], { id: 'graph-init' });
        const irqGraph = fakeGraph([], { id: 'graph-irq', triggerName: 'button' });
        const reconciler = new IrqReferenceReconciler(() => [declaring, irqGraph]);

        declaring.getNodes().splice(0, 1);
        reconciler.reconcile();

        assert.equal(irqGraph.getTriggerName(), '');
    });

    it('writes nothing when everything is consistent', () => {
        const graph = fakeGraph([inputNode('d1', 'button'), enableNode('r1', 'button')], {
            triggerName: 'button',
        });
        const reconciler = new IrqReferenceReconciler(() => [graph]);

        reconciler.reconcile();

        assert.equal(graph.updates.length, 0);
        assert.deepEqual(graph.triggers, []);
    });

    it('is idempotent and ignores re-entrant events', () => {
        const graph = fakeGraph([inputNode('d1', 'old'), enableNode('r1', 'old')]);
        const reentrant = [];
        let reconciler = null;
        const updateNode = graph.updateNode;
        graph.updateNode = (nodeId, patch, previous) => {
            reentrant.push(nodeId);
            reconciler?.reconcile({ nodeId, previous });
            return updateNode(nodeId, patch, previous);
        };
        reconciler = new IrqReferenceReconciler(() => [graph]);

        graph.node('d1').controlValues.triggerName = 'new';
        reconciler.reconcile({
            nodeId: 'd1',
            previous: { controlValues: { triggerName: 'old' } },
        });

        const writes = graph.updates.length;
        assert.equal(writes, 1);

        reconciler.reconcile();
        assert.equal(graph.updates.length, writes, 'a second pass adds no writes');
        assert.deepEqual(reentrant, ['r1'], 'the re-entrant event was ignored');
    });

    it('keeps duplicate declarations and their references', () => {
        const graph = fakeGraph([inputNode('d1', 'button'), inputNode('d2', 'button')]);
        const referencing = fakeGraph([enableNode('r1', 'button')]);
        const reconciler = new IrqReferenceReconciler(() => [graph, referencing]);

        reconciler.reconcile();

        assert.equal(graph.updates.length, 0);
        assert.equal(referencing.updates.length, 0);
        assert.equal(referencing.node('r1').controlValues.triggerName, 'button');
    });
});


describe('Collection interrupt reconciliation', () => {
    const COLLECTION_ID = '123e4567-e89b-42d3-a456-426614174003';

    function graphNode(id, type, triggerName) {
        return {
            id,
            type,
            x: 0,
            y: 0,
            controls: [],
            inputs: [],
            outputs: [],
            controlValues: { triggerName },
            inputDefaults: {},
        };
    }

    function collectionWith(graphs) {
        return new Collection({
            id: COLLECTION_ID,
            title: 'Irq Consistency',
            graphs: graphs.map(
                (graph) =>
                    new NodeGraph({
                        id: graph.id,
                        name: graph.name,
                        nodes: graph.nodes,
                        connections: [],
                        triggerName: graph.triggerName || '',
                    })
            ),
            activeGraphIdx: 0,
        });
    }

    it('renames enable references and graph triggers through the node-updated bridge', () => {
        const collection = collectionWith([
            {
                id: 'graph-init',
                name: 'Init',
                nodes: [graphNode('d1', 'irq.interrupt-input', 'old')],
            },
            {
                id: 'graph-irq',
                name: 'Irq',
                triggerName: 'old',
                nodes: [graphNode('r1', 'irq.interrupt-enable', 'old')],
            },
        ]);
        const declaring = collection.getGraphById('graph-init');
        const referencing = collection.getGraphById('graph-irq');

        declaring.updateNode(
            'd1',
            { controlValues: { triggerName: 'new' } },
            { controlValues: { triggerName: 'old' } }
        );

        assert.equal(referencing.getNode('r1').controlValues.triggerName, 'new');
        assert.equal(referencing.getTriggerName(), 'new');
    });

    it('resets references when the declaring node is removed through the bridge', () => {
        const collection = collectionWith([
            {
                id: 'graph-1',
                name: 'Graph 1',
                triggerName: 'button',
                nodes: [
                    graphNode('d1', 'irq.interrupt-input', 'button'),
                    graphNode('r1', 'irq.interrupt-enable', 'button'),
                ],
            },
        ]);
        const graph = collection.getActiveGraph();

        graph.removeNode('d1');

        assert.equal(graph.getNode('r1').controlValues.triggerName, '');
        assert.equal(graph.getTriggerName(), '');
    });

    it('repairs dangling references on load', () => {
        const collection = collectionWith([
            {
                id: 'graph-1',
                name: 'Graph 1',
                triggerName: 'ghost',
                nodes: [graphNode('r1', 'irq.interrupt-enable', 'ghost')],
            },
        ]);
        const graph = collection.getActiveGraph();

        collection.reconcileIrqReferences();

        assert.equal(graph.getNode('r1').controlValues.triggerName, '');
        assert.equal(graph.getTriggerName(), '');
    });
});

