// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: interrupt trigger collection
 *
 * An `interrupt-input` node declares an interrupt channel through its `triggerName`; every
 * `interrupt-enable` node and every `irq`-mode graph references that name. One collector defines
 * "which names exist", so the pickers and the graph rules cannot disagree.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    collectIrqTriggerEntries,
    collectIrqTriggerNames,
    IRQ_NAME_SOURCE,
    irqTriggerNameOf,
    isIrqEnableNodeType,
    isIrqInputNodeType,
} from '../../src/micro_otter/nodes/html/js/nodes/irq-triggers.js';

function irqNode(id, { type = 'irq.interrupt-input', triggerName } = {}) {
    const controlValues = {};
    if (triggerName !== undefined) {
        controlValues.triggerName = triggerName;
    }
    return { id, type, controlValues };
}

function graph(id, name, nodes) {
    return { getId: () => id, getName: () => name, getNodes: () => nodes };
}

function collectionOf(...graphs) {
    return { getGraphArray: () => graphs };
}

describe('irq trigger collection', () => {
    it('exposes the stable dynamic-source name', () => {
        assert.equal(IRQ_NAME_SOURCE, 'irqTriggerNames');
    });

    it('matches prefixed and bare node type ids', () => {
        assert.equal(isIrqInputNodeType('irq.interrupt-input'), true);
        assert.equal(isIrqInputNodeType('interrupt-input'), true);
        assert.equal(isIrqInputNodeType('irq.interrupt-enable'), false);
        assert.equal(isIrqEnableNodeType('irq.interrupt-enable'), true);
        assert.equal(isIrqEnableNodeType('interrupt-enable'), true);
        assert.equal(isIrqEnableNodeType('interrupt-input'), false);
    });

    it('trims the stored name', () => {
        assert.equal(irqTriggerNameOf(irqNode('n1', { triggerName: '  button  ' })), 'button');
        assert.equal(irqTriggerNameOf(irqNode('n1', {})), '');
    });

    it('collects across every graph and records the declaring graph', () => {
        const init = graph('graph-init', 'Init', [irqNode('1', { triggerName: 'button' })]);
        const main = graph('graph-1', 'Graph 1', [irqNode('1', { triggerName: 'sensor' })]);

        const entries = collectIrqTriggerEntries(collectionOf(init, main));

        assert.deepEqual(
            entries.map((entry) => entry.name),
            ['button', 'sensor']
        );
        assert.deepEqual(entries[0], {
            name: 'button',
            nodeId: '1',
            graphId: 'graph-init',
            graphName: 'Init',
        });
    });

    it('falls back to the given graph when no collection is available', () => {
        const active = graph('graph-1', 'Graph 1', [irqNode('n1', { triggerName: 'button' })]);

        assert.deepEqual(collectIrqTriggerNames(null, active), ['button']);
        assert.deepEqual(collectIrqTriggerNames(undefined, active), ['button']);
    });

    it('returns nothing when neither a collection nor a graph is given', () => {
        assert.deepEqual(collectIrqTriggerNames(null), []);
    });

    it('skips blank and whitespace-only names', () => {
        const main = graph('graph-1', 'Graph 1', [
            irqNode('n1', { triggerName: '' }),
            irqNode('n2', { triggerName: '   ' }),
            irqNode('n3', { triggerName: 'button' }),
        ]);

        assert.deepEqual(collectIrqTriggerNames(null, main), ['button']);
    });

    it('ignores interrupt-enable nodes: only inputs declare', () => {
        const main = graph('graph-1', 'Graph 1', [
            irqNode('n1', { type: 'irq.interrupt-enable', triggerName: 'button' }),
        ]);

        assert.deepEqual(collectIrqTriggerNames(null, main), []);
    });

    it('collapses duplicate names onto the first declaring node', () => {
        const first = graph('graph-init', 'Init', [irqNode('n1', { triggerName: 'button' })]);
        const second = graph('graph-1', 'Graph 1', [irqNode('n2', { triggerName: 'button' })]);

        const entries = collectIrqTriggerEntries(collectionOf(first, second));

        assert.equal(entries.length, 1);
        assert.equal(entries[0].graphId, 'graph-init');
        assert.equal(entries[0].nodeId, 'n1');
    });

    it('sorts names case-insensitively', () => {
        const main = graph('graph-1', 'Graph 1', [
            irqNode('n1', { triggerName: 'zebra' }),
            irqNode('n2', { triggerName: 'Alpha' }),
            irqNode('n3', { triggerName: 'beta' }),
        ]);

        assert.deepEqual(collectIrqTriggerNames(null, main), ['Alpha', 'beta', 'zebra']);
    });

    it('excludes the resolving node id', () => {
        const main = graph('graph-1', 'Graph 1', [
            irqNode('n1', { triggerName: 'button' }),
            irqNode('n2', { triggerName: 'sensor' }),
        ]);

        assert.deepEqual(collectIrqTriggerNames(null, main, 'n1'), ['sensor']);
    });
});
