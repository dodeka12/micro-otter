// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Test: interrupt graph rules
 *
 * The `irq` package registers five structural rules: a declaring input needs a name, a name may
 * be declared once, an enable node must reference a declared name, an `irq`-mode graph must name
 * an interrupt input of its own graph, and one GPIO may be claimed by one interrupt input only.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    clearGraphRules,
    registerGraphRule,
    validateGraphRules,
} from '../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js';
import { registerGraphRules } from '../../src/micro_otter/nodes/device/node_pkgs/irq/node_capabilities.js';

function irqNode(id, type, triggerName) {
    return { id, type, controlValues: triggerName === undefined ? {} : { triggerName } };
}

function inputNode(id, triggerName, pin) {
    const node = irqNode(id, 'irq.interrupt-input', triggerName);
    if (pin !== undefined) {
        node.controlValues.pin = pin;
    }
    return node;
}

function enableNode(id, triggerName) {
    return irqNode(id, 'irq.interrupt-enable', triggerName);
}

function rules() {
    const registered = [];
    registerGraphRules((rule) => registered.push(rule));
    return registered;
}

function runRule(id, context) {
    const rule = rules().find((candidate) => candidate.id === id);
    assert.ok(rule, `the rule '${id}' is registered`);
    return rule.run({
        graphId: 'graph-1',
        nodes: [],
        nodeTypesByNodeId: {},
        collectionNodes: [],
        graphSettings: {},
        ...context,
    });
}

describe('irq graph-rule registration', () => {
    it('registers the five rules with stable ids and scopes', () => {
        const registered = rules();

        assert.deepEqual(
            registered.map((rule) => [rule.id, rule.scope]),
            [
                ['irq-name-required', 'graph'],
                ['irq-name-duplicate', 'collection'],
                ['irq-enable-dangling', 'graph'],
                ['irq-graph-trigger', 'graph'],
                ['irq-pin-duplicate', 'collection'],
            ]
        );
    });

    it('tolerates a missing registrar', () => {
        assert.doesNotThrow(() => registerGraphRules(undefined));
    });
});

describe('irq-name-required', () => {
    it('flags an interrupt input without a name', () => {
        const issues = runRule('irq-name-required', { nodes: [inputNode('d1', '')] });

        assert.equal(issues.length, 1);
        assert.equal(issues[0].nodeId, 'd1');
        assert.equal(issues[0].controlId, 'triggerName');
        assert.equal(issues[0].source, 'graphRule');
        assert.equal(issues[0].scope, 'node');
        assert.equal(issues[0].capability, null);
        assert.equal(
            issues[0].message,
            'This interrupt input has no name: irq-mode graphs and interrupt-enable nodes cannot target it.'
        );
    });

    it('flags a whitespace-only name', () => {
        assert.equal(
            runRule('irq-name-required', { nodes: [inputNode('d1', '   ')] }).length,
            1
        );
    });

    it('stays silent for a named input and for enable nodes', () => {
        const issues = runRule('irq-name-required', {
            nodes: [inputNode('d1', 'button'), enableNode('r1', '')],
        });

        assert.deepEqual(issues, []);
    });
});

describe('irq-name-duplicate', () => {
    it('badges both nodes that declare the same name', () => {
        const nodes = [inputNode('d1', 'button'), inputNode('d2', 'button')];
        const issues = runRule('irq-name-duplicate', { nodes, collectionNodes: nodes });

        assert.deepEqual(issues.map((issue) => issue.nodeId).sort(), ['d1', 'd2']);
        assert.ok(issues.every((issue) => issue.controlId === 'triggerName'));
    });

    it('stays silent for a single declaration', () => {
        const nodes = [inputNode('d1', 'button')];

        assert.deepEqual(runRule('irq-name-duplicate', { nodes, collectionNodes: nodes }), []);
    });

    it('does not count enable nodes as declarations', () => {
        const nodes = [
            inputNode('d1', 'button'),
            enableNode('r1', 'button'),
            enableNode('r2', 'button'),
        ];

        assert.deepEqual(runRule('irq-name-duplicate', { nodes, collectionNodes: nodes }), []);
    });

    it('reports only the nodes of the validated graph', () => {
        const issues = runRule('irq-name-duplicate', {
            nodes: [inputNode('d1', 'button')],
            collectionNodes: [inputNode('d1', 'button'), inputNode('d9', 'button')],
        });

        assert.deepEqual(issues.map((issue) => issue.nodeId), ['d1']);
    });

    it('drops cross-graph issues through the registry', () => {
        clearGraphRules();
        registerGraphRule(rules().find((rule) => rule.id === 'irq-name-duplicate'));

        const issues = validateGraphRules({
            graphId: 'graph-1',
            nodes: [inputNode('d1', 'button')],
            nodeTypesByNodeId: {},
            collectionNodes: [inputNode('d1', 'button'), inputNode('d9', 'button')],
        });

        assert.deepEqual(issues.map((issue) => issue.nodeId), ['d1']);
        clearGraphRules();
    });
});


describe('irq-enable-dangling', () => {
    it('flags an enable node that names no declared interrupt', () => {
        const nodes = [enableNode('r1', 'ghost')];
        const issues = runRule('irq-enable-dangling', { nodes, collectionNodes: nodes });

        assert.equal(issues.length, 1);
        assert.equal(issues[0].nodeId, 'r1');
        assert.equal(issues[0].controlId, 'triggerName');
        assert.equal(issues[0].message, "No interrupt input declares the name 'ghost'.");
    });

    it('accepts a declaration from another graph', () => {
        const issues = runRule('irq-enable-dangling', {
            nodes: [enableNode('r1', 'button')],
            collectionNodes: [inputNode('d1', 'button'), enableNode('r1', 'button')],
        });

        assert.deepEqual(issues, []);
    });

    it('does not badge a look-alike node id from another graph', () => {
        const issues = runRule('irq-enable-dangling', {
            nodes: [enableNode('1', 'sensor')],
            collectionNodes: [inputNode('1', 'button'), enableNode('1', 'sensor')],
        });

        assert.deepEqual(issues.map((issue) => issue.nodeId), ['1']);
    });

    it('stays silent for a blank name and for interrupt inputs', () => {
        const nodes = [enableNode('r1', ''), inputNode('d1', '')];
        assert.deepEqual(runRule('irq-enable-dangling', { nodes, collectionNodes: nodes }), []);
    });
});

describe('irq-graph-trigger', () => {
    it('flags an irq-mode graph without a trigger name', () => {
        const issues = runRule('irq-graph-trigger', {
            nodes: [],
            graphSettings: { executionType: 'irq', triggerName: '' },
        });

        assert.equal(issues.length, 1);
        assert.equal(issues[0].nodeId, null);
        assert.equal(issues[0].controlId, null);
        assert.equal(
            issues[0].message,
            'This irq-mode graph has no interrupt name: pick the interrupt input it runs on.'
        );
    });

    it('flags a name that no input of this graph declares', () => {
        const issues = runRule('irq-graph-trigger', {
            nodes: [inputNode('d1', 'button')],
            graphSettings: { executionType: 'irq', triggerName: 'sensor' },
        });

        assert.equal(issues.length, 1);
        assert.equal(
            issues[0].message,
            "The interrupt name 'sensor' is not declared by an interrupt input in this graph."
        );
    });

    it('flags a name declared only in another graph', () => {
        const issues = runRule('irq-graph-trigger', {
            nodes: [],
            collectionNodes: [inputNode('d1', 'sensor')],
            graphSettings: { executionType: 'irq', triggerName: 'sensor' },
        });

        assert.equal(issues.length, 1);
    });

    it('stays silent when the name matches an input of this graph', () => {
        const issues = runRule('irq-graph-trigger', {
            nodes: [inputNode('d1', 'button')],
            graphSettings: { executionType: 'irq', triggerName: 'button' },
        });

        assert.deepEqual(issues, []);
    });

    it('stays silent outside irq mode', () => {
        const issues = runRule('irq-graph-trigger', {
            nodes: [],
            graphSettings: { executionType: 'continuous', triggerName: '' },
        });

        assert.deepEqual(issues, []);
    });

    it('is silent when the registry normalises a missing graphSettings', () => {
        clearGraphRules();
        registerGraphRule(rules().find((rule) => rule.id === 'irq-graph-trigger'));

        const issues = validateGraphRules({
            graphId: 'graph-1',
            nodes: [inputNode('d1', 'button')],
            nodeTypesByNodeId: {},
        });

        assert.deepEqual(issues, []);
        clearGraphRules();
    });

    it('reports through the registry with normalised graphSettings', () => {
        clearGraphRules();
        registerGraphRule(rules().find((rule) => rule.id === 'irq-graph-trigger'));

        const issues = validateGraphRules({
            graphId: 'graph-1',
            nodes: [inputNode('d1', 'button')],
            nodeTypesByNodeId: {},
            collectionNodes: [inputNode('d1', 'button')],
            graphSettings: { executionType: 'irq', triggerName: 'button' },
        });

        assert.deepEqual(issues, []);
        clearGraphRules();
    });
});

describe('irq-pin-duplicate', () => {
    it('badges every input that claims the same GPIO', () => {
        const nodes = [inputNode('d1', 'button', 4), inputNode('d2', 'sensor', 4)];
        const issues = runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes });

        const issueIds = issues.map((issue) => issue.nodeId);
        assert.deepEqual(issueIds, ['d1', 'd2']);
        assert.ok(issues.every((issue) => issue.controlId === 'pin'));
        assert.ok(issues.every((issue) => issue.source === 'graphRule'));
        assert.ok(issues.every((issue) => issue.scope === 'node'));
        assert.equal(
            issues[0].message,
            'GPIO 4 is used by more than one interrupt input: only one interrupt can own a GPIO.'
        );
    });

    it('badges all three inputs when three claim the same GPIO', () => {
        const nodes = [
            inputNode('d1', 'button', 4),
            inputNode('d2', 'sensor', 4),
            inputNode('d3', 'reed', 4),
        ];

        const issueIds = runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes }).map(
            (issue) => issue.nodeId
        );
        assert.deepEqual(issueIds, ['d1', 'd2', 'd3']);
    });

    it('compares numeric strings with numbers', () => {
        const nodes = [inputNode('d1', 'button', '4'), inputNode('d2', 'sensor', 4)];

        assert.equal(runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes }).length, 2);
    });

    it('treats a missing pin as GPIO 0', () => {
        const nodes = [inputNode('d1', 'button'), inputNode('d2', 'sensor')];
        const issues = runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes });

        assert.equal(issues.length, 2);
        assert.equal(
            issues[0].message,
            'GPIO 0 is used by more than one interrupt input: only one interrupt can own a GPIO.'
        );
    });

    it('treats a missing pin and an explicit 0 as the same GPIO', () => {
        const nodes = [inputNode('d1', 'button'), inputNode('d2', 'sensor', 0)];

        assert.equal(runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes }).length, 2);
    });

    it('stays silent when an unset pin and a real pin differ', () => {
        const nodes = [inputNode('d1', 'button'), inputNode('d2', 'sensor', 4)];

        assert.deepEqual(runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes }), []);
    });

    it('stays silent for different GPIOs', () => {
        const nodes = [inputNode('d1', 'button', 4), inputNode('d2', 'sensor', 5)];

        assert.deepEqual(runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes }), []);
    });

    it('stays silent for a single input with no partner', () => {
        const nodes = [inputNode('d1', 'button', 4)];

        assert.deepEqual(runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes }), []);
    });

    it('reports an unsupported pin value by its trimmed text', () => {
        const nodes = [inputNode('d1', 'button', ' abc '), inputNode('d2', 'sensor', 'abc')];
        const issues = runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes });

        assert.equal(issues.length, 2);
        assert.equal(
            issues[0].message,
            'GPIO abc is used by more than one interrupt input: only one interrupt can own a GPIO.'
        );
    });

    it('does not treat interrupt-enable nodes as GPIO owners', () => {
        const nodes = [
            { id: 'r1', type: 'irq.interrupt-enable', controlValues: { triggerName: 'a', pin: 4 } },
            { id: 'r2', type: 'irq.interrupt-enable', controlValues: { triggerName: 'b', pin: 4 } },
        ];

        assert.deepEqual(runRule('irq-pin-duplicate', { nodes, collectionNodes: nodes }), []);
    });

    it('reports only the nodes of the validated graph', () => {
        const issues = runRule('irq-pin-duplicate', {
            nodes: [inputNode('d1', 'button', 4)],
            collectionNodes: [inputNode('d1', 'button', 4), inputNode('d9', 'sensor', 4)],
        });

        const issueIds = issues.map((issue) => issue.nodeId);
        assert.deepEqual(issueIds, ['d1']);
    });

    it('drops cross-graph issues through the registry', () => {
        clearGraphRules();
        registerGraphRule(rules().find((rule) => rule.id === 'irq-pin-duplicate'));

        const issues = validateGraphRules({
            graphId: 'graph-1',
            nodes: [inputNode('d1', 'button', 4)],
            nodeTypesByNodeId: {},
            collectionNodes: [inputNode('d1', 'button', 4), inputNode('d9', 'sensor', 4)],
        });

        assert.deepEqual(
            issues.map((issue) => issue.nodeId),
            ['d1']
        );
        clearGraphRules();
    });
});
