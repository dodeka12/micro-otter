import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerGraphRules } from '../../src/micro_otter/nodes/device/node_pkgs/vars/node_capabilities.js';

function signalNode(id, name) {
    return { id, type: 'signal-post', controlValues: name === undefined ? {} : { signal: name } };
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

describe('signal graph-rule registration', () => {
    it('registers the two signal rules', () => {
        const registered = rules();
        assert.ok(registered.some((rule) => rule.id === 'event-signal-selection'));
        assert.ok(registered.some((rule) => rule.id === 'event-signal-producer'));
    });
});

describe('event-signal-selection', () => {
    it('warns for an event graph with no signals', () => {
        const issues = runRule('event-signal-selection', {
            graphSettings: { executionType: 'event', signalNames: [] },
        });
        assert.equal(issues.length, 1);
        assert.equal(issues[0].nodeId, null);
        assert.match(issues[0].message, /no signals selected/);
    });

    it('stays silent for a non-empty watch list and outside event mode', () => {
        assert.deepEqual(
            runRule('event-signal-selection', {
                graphSettings: { executionType: 'event', signalNames: ['a'] },
            }),
            []
        );
        assert.deepEqual(
            runRule('event-signal-selection', {
                graphSettings: { executionType: 'continuous', signalNames: [] },
            }),
            []
        );
    });
});

describe('event-signal-producer', () => {
    it('warns once per unproduced watched name', () => {
        const issues = runRule('event-signal-producer', {
            graphSettings: { executionType: 'event', signalNames: ['ghost', 'also-ghost'] },
            collectionNodes: [signalNode('n1', 'radar')],
        });
        assert.equal(issues.length, 2);
        assert.deepEqual(
            issues.map((issue) => issue.message),
            [
                "No signal-post node produces the signal 'ghost'.",
                "No signal-post node produces the signal 'also-ghost'.",
            ]
        );
    });

    it('stays silent when every watched name has a producer', () => {
        const issues = runRule('event-signal-producer', {
            graphSettings: { executionType: 'event', signalNames: ['radar'] },
            collectionNodes: [signalNode('n1', 'radar')],
        });
        assert.deepEqual(issues, []);
    });

    it('accepts a producer in another graph', () => {
        const issues = runRule('event-signal-producer', {
            nodes: [],
            graphSettings: { executionType: 'event', signalNames: ['radar'] },
            collectionNodes: [signalNode('n1', 'radar')],
        });
        assert.deepEqual(issues, []);
    });

    it('stays silent outside event mode', () => {
        assert.deepEqual(
            runRule('event-signal-producer', {
                graphSettings: { executionType: 'continuous', signalNames: ['ghost'] },
            }),
            []
        );
    });
});
