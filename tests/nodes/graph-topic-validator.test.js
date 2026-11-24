import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

import {
    clearGraphTopicRules,
    collectTopicBindings,
    getGraphTopicRuleIds,
    registerGraphTopicRule,
    validateGraphTopics,
} from '../../src/micro_otter/nodes/html/js/core/graph-topic-validator.js';
import {
    clearGraphRules,
    getGraphRules,
    registerGraphRule,
    validateGraphRules,
} from '../../src/micro_otter/nodes/html/js/core/graph-rule-registry.js';

const CONTROLS_BY_TYPE = {
    'mqtt-read': [
        { id: 'topic', type: 'dropdown' },
        { id: 'customTopic', type: 'text' },
        { id: 'qos', type: 'dropdown' },
    ],
    'mqtt-write': [
        { id: 'topic', type: 'dropdown' },
        { id: 'customTopic', type: 'text' },
        { id: 'qos', type: 'dropdown' },
        { id: 'retain', type: 'checkbox' },
    ],
    'mqtt-will': [
        { id: 'willTopic', type: 'dropdown' },
        { id: 'customWillTopic', type: 'text' },
        { id: 'willPayload', type: 'text' },
        { id: 'willRetain', type: 'checkbox' },
        { id: 'willQos', type: 'dropdown' },
    ],
    'mqtt-announce': [
        { id: 'announceTopic', type: 'dropdown' },
        { id: 'customAnnounceTopic', type: 'text' },
        { id: 'payload', type: 'text' },
        { id: 'retain', type: 'checkbox' },
        { id: 'triggerTopic', type: 'dropdown' },
        { id: 'customTriggerTopic', type: 'text' },
    ],
};

function node(id, type, controlValues) {
    return { id, type, controlValues, inputs: [], outputs: [] };
}

function bareType(type) {
    const value = String(type ?? '');
    const dot = value.indexOf('.');
    return dot >= 0 ? value.slice(dot + 1) : value;
}

function context(nodes, nodeTypes = {}) {
    const nodeTypesByNodeId = {};
    nodes.forEach((entry) => {
        nodeTypesByNodeId[String(entry.id)] = nodeTypes[entry.type] || {
            controls: CONTROLS_BY_TYPE[entry.type] || CONTROLS_BY_TYPE[bareType(entry.type)] || [],
        };
    });
    return { graphId: 'graph-1', nodes, nodeTypesByNodeId };
}

function messagesFor(issues, nodeId) {
    return issues.filter((issue) => issue.nodeId === nodeId).map((issue) => issue.message);
}

describe('graph topic bindings', () => {
    it('collects publishers and subscribers from MQTT nodes', () => {
        const bindings = collectTopicBindings(
            context([
                node('w1', 'mqtt-write', { topic: 'home/a' }),
                node('r1', 'mqtt-read', { topic: 'home/a' }),
            ])
        );

        assert.deepEqual(bindings.publishers, [
            { nodeId: 'w1', controlId: 'topic', topic: 'home/a' },
        ]);
        assert.deepEqual(bindings.subscribers, [
            { nodeId: 'r1', controlId: 'topic', topic: 'home/a' },
        ]);
        assert.equal(bindings.nodes.length, 2);
    });

    it('collects bindings from package-prefixed node types', () => {
        const bindings = collectTopicBindings(
            context([
                node('w1', 'mqtt.mqtt-write', { topic: 'home/a' }),
                node('r1', 'mqtt.mqtt-read', { topic: 'home/a' }),
            ])
        );

        assert.deepEqual(bindings.publishers, [
            { nodeId: 'w1', controlId: 'topic', topic: 'home/a' },
        ]);
        assert.deepEqual(bindings.subscribers, [
            { nodeId: 'r1', controlId: 'topic', topic: 'home/a' },
        ]);
        assert.equal(bindings.nodes.length, 2);
    });

    it('resolves the new-topic sentinel', () => {
        const bindings = collectTopicBindings(
            context([
                node('w1', 'mqtt-write', { topic: '__new__', customTopic: 'home/typed' }),
            ])
        );

        assert.equal(bindings.publishers[0].topic, 'home/typed');
    });

    it('ignores non-MQTT nodes', () => {
        const bindings = collectTopicBindings(
            context([node('c1', 'const', { topic: 'not/ours' })])
        );

        assert.deepEqual(bindings.nodes, []);
        assert.deepEqual(bindings.publishers, []);
    });

    it('tolerates a missing control definition', () => {
        const bindings = collectTopicBindings({
            graphId: null,
            nodes: [node('w1', 'mqtt-write', { topic: 'home/a' })],
            nodeTypesByNodeId: {},
        });

        assert.equal(bindings.publishers.length, 1);
    });
});

describe('graph topic rule registry', () => {
    const originalRuleCount = getGraphTopicRuleIds().length;

    it('exposes the built-in rule ids', () => {
        assert.deepEqual(getGraphTopicRuleIds().slice(0, originalRuleCount), [
            'mqtt-topic-empty',
            'mqtt-will-require-topic',
            'mqtt-will-duplicate',
            'mqtt-read-unpublished',
            'mqtt-announce-unretained',
        ]);
    });

    it('runs registered rules and de-duplicates identical issues', () => {
        const makeIssue = (nodeId) => ({
            nodeId,
            scope: 'node',
            message: 'duplicate',
            capability: null,
            controlId: null,
            inputId: null,
            source: 'graphRule',
        });
        registerGraphTopicRule('test-duplicate-a', () => [makeIssue('n1')]);
        registerGraphTopicRule('test-duplicate-b', () => [makeIssue('n1')]);

        const issues = validateGraphTopics(context([])).filter(
            (issue) => issue.message === 'duplicate'
        );
        assert.equal(issues.length, 1);
    });

    it('skips a rule that throws', () => {
        registerGraphTopicRule('test-throws', () => {
            throw new Error('boom');
        });
        registerGraphTopicRule('test-after-throw', () => [
            {
                nodeId: 'n1',
                scope: 'node',
                message: 'after',
                capability: null,
                controlId: null,
                inputId: null,
                source: 'graphRule',
            },
        ]);

        const issues = validateGraphTopics(context([]));
        assert.ok(issues.some((issue) => issue.message === 'after'));
    });

    it('rejects an invalid registration', () => {
        assert.throws(() => registerGraphTopicRule('', () => []), /non-empty rule id/);
        assert.throws(() => registerGraphTopicRule('x', null), /rule function/);
    });
});

describe('graph rule registry', () => {
    const registryPath = 'src/micro_otter/nodes/html/js/core/graph-rule-registry.ts';
    const topicValidatorPath = 'src/micro_otter/nodes/html/js/core/graph-topic-validator.ts';

    function issueFor(nodeId, message) {
        return {
            nodeId,
            scope: 'node',
            message,
            capability: null,
            controlId: null,
            inputId: null,
            source: 'graphRule',
        };
    }

    it('shares one registry between validateGraphTopics and validateGraphRules', () => {
        clearGraphTopicRules();
        registerGraphRule({ id: 'test-shared-entry', run: () => [issueFor('n1', 'shared')] });

        const viaTopics = validateGraphTopics(context([])).filter((i) => i.message === 'shared');
        const viaRules = validateGraphRules(context([])).filter((i) => i.message === 'shared');
        assert.equal(viaTopics.length, 1);
        assert.equal(viaRules.length, 1);
    });

    it('passes collectionNodes to a collection rule', () => {
        clearGraphTopicRules();
        let seen = null;
        registerGraphRule({
            id: 'test-collection-sees',
            scope: 'collection',
            run: (ctx) => {
                seen = ctx.collectionNodes;
                return [];
            },
        });
        const collection = [node('b1', 'hass-bridge')];
        validateGraphRules({
            graphId: 'g',
            nodes: [],
            nodeTypesByNodeId: {},
            collectionNodes: collection,
        });
        assert.deepEqual(seen, collection);
    });

    it('treats an absent collectionNodes as an empty array', () => {
        clearGraphTopicRules();
        registerGraphRule({
            id: 'test-collection-absent',
            scope: 'collection',
            run: (ctx) => [issueFor(null, `count=${ctx.collectionNodes.length}`)],
        });
        const issues = validateGraphRules({ graphId: 'g', nodes: [], nodeTypesByNodeId: {} });
        assert.ok(issues.some((i) => i.message === 'count=0'));
    });

    it('normalises an absent graphSettings to an empty object', () => {
        clearGraphTopicRules();
        let seen = null;
        registerGraphRule({
            id: 'test-graph-settings-absent',
            run: (ctx) => {
                seen = ctx.graphSettings;
                return [];
            },
        });

        validateGraphRules({ graphId: 'g', nodes: [], nodeTypesByNodeId: {} });

        assert.deepEqual(seen, {});
        assert.equal(seen.executionType, undefined);
    });

    it('passes graphSettings through to a rule', () => {
        clearGraphTopicRules();
        let seen = null;
        registerGraphRule({
            id: 'test-graph-settings-present',
            run: (ctx) => {
                seen = ctx.graphSettings;
                return [];
            },
        });

        validateGraphRules({
            graphId: 'g',
            nodes: [],
            nodeTypesByNodeId: {},
            graphSettings: { executionType: 'irq', triggerName: 'button' },
        });

        assert.deepEqual(seen, { executionType: 'irq', triggerName: 'button' });
    });

    it('drops collection issues anchored outside the graph with one warning', () => {
        clearGraphTopicRules();
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args);

        registerGraphRule({
            id: 'test-anchor-guard',
            scope: 'collection',
            run: () => [issueFor('n1', 'in-graph'), issueFor('other', 'outside')],
        });

        const issues = validateGraphRules({
            graphId: 'g',
            nodes: [node('n1', 'core.const')],
            nodeTypesByNodeId: {},
        });
        console.warn = originalWarn;

        assert.deepEqual(issues.map((i) => i.message), ['in-graph']);
        assert.equal(warnings.length, 1);
    });

    it('defaults scope to graph and preserves registration order', () => {
        clearGraphRules();
        registerGraphRule({ id: 'a', run: () => [] });
        registerGraphRule({ id: 'b', scope: 'collection', run: () => [] });
        const rules = getGraphRules();
        assert.deepEqual(rules.map((r) => r.id), ['a', 'b']);
        assert.equal(rules[0].scope, 'graph');
        assert.equal(rules[1].scope, 'collection');
    });

    it('passes source graphRule through unchanged', () => {
        clearGraphTopicRules();
        registerGraphRule({ id: 'test-source', run: () => [issueFor('n1', 's')] });
        const issues = validateGraphRules(context([node('n1', 'core.const')]));
        assert.equal(issues.find((i) => i.message === 's').source, 'graphRule');
    });

    it('clearGraphRules empties and clearGraphTopicRules restores the built-ins', () => {
        clearGraphTopicRules();
        registerGraphRule({ id: 'test-extra', run: () => [] });
        assert.ok(getGraphTopicRuleIds().includes('test-extra'));

        clearGraphRules();
        assert.equal(getGraphRules().length, 0);

        clearGraphTopicRules();
        assert.deepEqual(getGraphTopicRuleIds().slice(0, 5), [
            'mqtt-topic-empty',
            'mqtt-will-require-topic',
            'mqtt-will-duplicate',
            'mqtt-read-unpublished',
            'mqtt-announce-unretained',
        ]);
    });

    it('keeps the registry package-agnostic', () => {
        const registrySource = readFileSync(registryPath, 'utf8');
        assert.ok(!/mqtt|hass|graph-topics/i.test(registrySource));

        const topicSource = readFileSync(topicValidatorPath, 'utf8');
        assert.ok(topicSource.includes('collectTopicBindings'));
        assert.ok(topicSource.includes('effectiveTopicValue'));
    });

    it('still degrades a throwing rule to a warning', () => {
        clearGraphTopicRules();
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args);
        registerGraphRule({
            id: 'test-throw-registry',
            run: () => {
                throw new Error('boom');
            },
        });
        registerGraphRule({ id: 'test-after-registry', run: () => [issueFor('n1', 'after')] });

        const issues = validateGraphRules(context([node('n1', 'core.const')]));
        console.warn = originalWarn;

        assert.ok(issues.some((i) => i.message === 'after'));
        assert.equal(warnings.length, 1);
    });

    it('lets collection-scoped built-in rules see collectionNodes', () => {
        clearGraphTopicRules();
        const readNode = node('r1', 'mqtt-read', { topic: 'home/remote' });
        const writeNode = node('w1', 'mqtt-write', { topic: 'home/remote' });
        const ctx = context([readNode]);
        ctx.collectionNodes = [readNode, writeNode];

        const issues = validateGraphRules(ctx);
        assert.ok(!issues.some((i) => i.nodeId === 'r1'));
    });

    it('passes connections through and treats an absent field as empty', () => {
        clearGraphTopicRules();
        const seen = [];
        registerGraphRule({
            id: 'test-connections',
            run: (ctx) => {
                seen.push(ctx.connections.length);
                return [];
            },
        });
        validateGraphRules({
            graphId: 'g',
            nodes: [],
            nodeTypesByNodeId: {},
            connections: [{ fromNode: 'a', toNode: 'b' }],
        });
        validateGraphRules({ graphId: 'g', nodes: [], nodeTypesByNodeId: {} });
        assert.deepEqual(seen, [1, 0]);
    });
});

describe('built-in topic rules', () => {
    const validate = (ctx) => {
        clearGraphTopicRules();
        return validateGraphTopics(ctx);
    };

    it('reports a read on a topic nobody publishes', () => {
        const issues = validate(
            context([node('r1', 'mqtt-read', { topic: 'home/remote' })])
        );

        assert.deepEqual(messagesFor(issues, 'r1'), [
            "No node in the collection publishes to 'home/remote': the messages must come from another device.",
        ]);
        assert.equal(issues[0].scope, 'control');
        assert.equal(issues[0].controlId, 'topic');
    });

    it('accepts a read on a status topic without a publisher', () => {
        const issues = validate(
            context([node('r1', 'mqtt-read', { topic: 'homeassistant/status' })])
        );

        assert.deepEqual(messagesFor(issues, 'r1'), []);
    });

    it('reports a prefixed read on a topic nobody publishes', () => {
        const issues = validate(
            context([node('r1', 'mqtt.mqtt-read', { topic: 'home/remote' })])
        );

        assert.deepEqual(messagesFor(issues, 'r1'), [
            "No node in the collection publishes to 'home/remote': the messages must come from another device.",
        ]);
        assert.equal(issues[0].scope, 'control');
        assert.equal(issues[0].controlId, 'topic');
    });

    it('warns about an unretained prefixed announcement', () => {
        const issues = validate(
            context([
                node('a1', 'mqtt.mqtt-announce', {
                    announceTopic: 'home/a',
                    retain: false,
                }),
            ])
        );

        assert.deepEqual(messagesFor(issues, 'a1'), [
            "MQTT Announce is not retained: a subscriber that connects later will not see 'home/a'.",
        ]);
    });

    it('clears the warning once a publisher exists', () => {
        const issues = validate(
            context([
                node('r1', 'mqtt-read', { topic: 'home/temp' }),
                node('w1', 'mqtt-write', { topic: 'home/temp' }),
            ])
        );

        assert.deepEqual(messagesFor(issues, 'r1'), []);
    });

    it('accepts a read when the publisher lives in another graph', () => {
        const readNode = node('r1', 'mqtt-read', { topic: 'home/remote' });
        const writeNode = node('w1', 'mqtt-write', { topic: 'home/remote' });
        const ctx = context([readNode]);
        ctx.collectionNodes = [readNode, writeNode];

        const issues = validate(ctx);
        assert.deepEqual(messagesFor(issues, 'r1'), []);
    });

    it('falls back to the graph when collectionNodes is empty', () => {
        const readNode = node('r1', 'mqtt-read', { topic: 'home/remote' });
        const ctx = context([readNode]);
        ctx.collectionNodes = [];

        const issues = validate(ctx);
        assert.equal(messagesFor(issues, 'r1').length, 1);
        assert.ok(messagesFor(issues, 'r1')[0].includes('in the collection'));
    });

    it('still exempts a status-topic read published in another graph', () => {
        const readNode = node('r1', 'mqtt-read', { topic: 'homeassistant/status' });
        const writeNode = node('w1', 'mqtt-write', { topic: 'homeassistant/status' });
        const ctx = context([readNode]);
        ctx.collectionNodes = [readNode, writeNode];

        const issues = validate(ctx);
        assert.deepEqual(messagesFor(issues, 'r1'), []);
    });

    it('resolves a collection node whose id collides with a current-graph node', () => {
        const readNode = node('r1', 'mqtt-read', { topic: 'home/remote' });
        // The current graph owns a node '1' whose type declares no topic controls; the
        // collection view must not let the write node '1' inherit that definition.
        const ctx = context([readNode, node('1', 'hass-sensor', {})]);
        ctx.collectionNodes = [...ctx.nodes, node('1', 'mqtt-write', { topic: 'home/remote' })];

        const issues = validate(ctx);
        assert.deepEqual(messagesFor(issues, 'r1'), []);
    });

    it('says nothing about a graph without MQTT nodes', () => {
        const issues = validate(context([node('c1', 'const', { value: 1 })]));
        assert.deepEqual(issues, []);
    });

    it('warns about an unretained announcement only', () => {
        const unretained = validate(
            context([
                node('a1', 'mqtt-announce', {
                    announceTopic: 'home/a',
                    retain: false,
                }),
            ])
        );
        assert.deepEqual(messagesFor(unretained, 'a1'), [
            "MQTT Announce is not retained: a subscriber that connects later will not see 'home/a'.",
        ]);

        const retained = validate(
            context([
                node('a1', 'mqtt-announce', {
                    announceTopic: 'home/a',
                    retain: true,
                }),
            ])
        );
        assert.deepEqual(messagesFor(retained, 'a1'), []);
    });

    it('reports an MQTT node without a topic', () => {
        const issues = validate(context([node('w1', 'mqtt-write', {})]));

        assert.deepEqual(messagesFor(issues, 'w1'), [
            'MQTT Write has no topic: this node never reaches the broker.',
        ]);
    });

    it('accepts a typed topic behind the sentinel', () => {
        const issues = validate(
            context([
                node('w1', 'mqtt-write', { topic: '__new__', customTopic: 'home/new' }),
                node('r1', 'mqtt-read', { topic: 'home/new' }),
            ])
        );

        assert.deepEqual(messagesFor(issues, 'w1'), []);
        assert.deepEqual(messagesFor(issues, 'r1'), []);
    });

    it('reports a will without a topic', () => {
        const issues = validate(context([node('will1', 'mqtt-will', {})]));

        assert.deepEqual(messagesFor(issues, 'will1'), [
            'MQTT Will has no topic: the broker rejects a will without a topic.',
        ]);
    });

    it('reports competing wills on different topics', () => {
        const issues = validate(
            context([
                node('will1', 'mqtt-will', { willTopic: 'home/a/status' }),
                node('will2', 'mqtt-will', { willTopic: 'home/b/status' }),
            ])
        );

        assert.equal(messagesFor(issues, 'will1').length, 1);
        assert.deepEqual(messagesFor(issues, 'will2'), []);
    });

    it('accepts two wills on the same topic', () => {
        const issues = validate(
            context([
                node('will1', 'mqtt-will', { willTopic: 'home/status' }),
                node('will2', 'mqtt-will', { willTopic: 'home/status' }),
            ])
        );

        assert.deepEqual(issues, []);
    });

    it('flags the earlier will when two wills live in different graphs', () => {
        const willA = node('will1', 'mqtt-will', { willTopic: 'home/a/status' });
        const willB = node('will2', 'mqtt-will', { willTopic: 'home/b/status' });
        const ctx = context([willA]);
        ctx.collectionNodes = [willA, willB];

        const issues = validate(ctx);
        assert.equal(messagesFor(issues, 'will1').length, 1);
        assert.deepEqual(messagesFor(issues, 'will2'), []);
        assert.ok(issues.every((issue) => issue.source === 'graphRule'));
    });

    it('accepts two wills on the same topic across two graphs', () => {
        const willA = node('will1', 'mqtt-will', { willTopic: 'home/status' });
        const willB = node('will2', 'mqtt-will', { willTopic: 'home/status' });
        const ctx = context([willA]);
        ctx.collectionNodes = [willA, willB];

        const issues = validate(ctx);
        assert.deepEqual(issues, []);
    });

    it('accepts a single will without collectionNodes', () => {
        const issues = validate(
            context([node('will1', 'mqtt-will', { willTopic: 'home/status' })])
        );
        assert.deepEqual(issues, []);
    });

    it('reports one will issue when a bridge and two wills compete', () => {
        const issues = validate(
            context([
                node('b1', 'hass-bridge', { deviceId: 'otter-demo' }),
                node('will1', 'mqtt-will', { willTopic: 'home/a/status' }),
                node('will2', 'mqtt-will', { willTopic: 'home/b/status' }),
            ])
        );

        const willIssues = issues.filter((issue) => issue.message.includes('Only one will fits'));
        assert.equal(willIssues.length, 1);
    });

    it('publishes the rule registry on the global scope', () => {
        const bridge = globalThis.GraphTopicRules;
        assert.ok(bridge);
        assert.equal(typeof bridge.register, 'function');
        assert.equal(typeof bridge.validate, 'function');
        assert.ok(bridge.getRuleIds().includes('mqtt-topic-empty'));
    });
});
