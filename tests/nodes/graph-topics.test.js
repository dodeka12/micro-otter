import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    collectGraphTopics,
    customTopicControlId,
    effectiveTopicValue,
    GRAPH_TOPIC_NEW_SENTINEL,
} from '../../src/micro_otter/nodes/html/js/nodes/graph-topics.js';

function node(id, type, controls, controlValues) {
    return { id, type, controls, controlValues };
}

function graphOf(...nodes) {
    return { getNodes: () => nodes };
}

const TOPIC_CONTROL = { id: 'topic', type: 'dropdown' };

describe('graph topic collector', () => {
    it('collects and sorts the topics of MQTT nodes', () => {
        const graph = graphOf(
            node('a', 'mqtt-write', [TOPIC_CONTROL], { topic: 'home/zeta' }),
            node('b', 'mqtt-read', [TOPIC_CONTROL], { topic: 'home/alpha' })
        );

        assert.deepEqual(
            collectGraphTopics(graph).map((entry) => entry.topic),
            ['home/alpha', 'home/zeta']
        );
    });

    it('collects topics from package-prefixed node types', () => {
        const graph = graphOf(
            node('a', 'mqtt.mqtt-write', [TOPIC_CONTROL], { topic: 'home/zeta' }),
            node('b', 'hass.hass-sensor', [TOPIC_CONTROL], { topic: 'home/alpha' })
        );

        assert.deepEqual(
            collectGraphTopics(graph).map((entry) => entry.topic),
            ['home/alpha', 'home/zeta']
        );
    });

    it('de-duplicates a topic used by several nodes', () => {
        const graph = graphOf(
            node('a', 'mqtt-read', [TOPIC_CONTROL], { topic: 'home/x' }),
            node('b', 'mqtt-write', [TOPIC_CONTROL], { topic: 'home/x' }),
            node('c', 'mqtt-read', [TOPIC_CONTROL], { topic: 'home/x' })
        );

        const entries = collectGraphTopics(graph);
        assert.equal(entries.length, 1);
        assert.deepEqual(entries[0], { topic: 'home/x', nodeId: 'a', controlId: 'topic' });
    });

    it('ignores empty, whitespace and unresolved sentinel topics', () => {
        const graph = graphOf(
            node('a', 'mqtt-read', [TOPIC_CONTROL], { topic: '' }),
            node('b', 'mqtt-read', [TOPIC_CONTROL], { topic: '   ' }),
            node('c', 'mqtt-read', [TOPIC_CONTROL], { topic: GRAPH_TOPIC_NEW_SENTINEL })
        );

        assert.deepEqual(collectGraphTopics(graph), []);
    });

    it('resolves the new-topic sentinel through its custom control', () => {
        const graph = graphOf(
            node('a', 'mqtt-write', [TOPIC_CONTROL, { id: 'customTopic', type: 'text' }], {
                topic: GRAPH_TOPIC_NEW_SENTINEL,
                customTopic: ' home/new ',
            })
        );

        assert.deepEqual(
            collectGraphTopics(graph).map((entry) => entry.topic),
            ['home/new']
        );
    });

    it('ignores a plain topic control of a non-MQTT node', () => {
        const graph = graphOf(node('a', 'core-const', [TOPIC_CONTROL], { topic: 'not/ours' }));

        assert.deepEqual(collectGraphTopics(graph), []);
    });

    it('ignores a package-prefixed non-MQTT node', () => {
        const graph = graphOf(node('a', 'core.const', [TOPIC_CONTROL], { topic: 'not/ours' }));

        assert.deepEqual(collectGraphTopics(graph), []);
    });

    it('honours a graphTopics descriptor on a non-MQTT node', () => {
        const graph = graphOf(
            node(
                'a',
                'custom-node',
                [{ id: 'topic', type: 'dropdown', dynamicOptions: { source: 'graphTopics' } }],
                { topic: 'home/custom' }
            )
        );

        assert.deepEqual(
            collectGraphTopics(graph).map((entry) => entry.topic),
            ['home/custom']
        );
    });

    it('returns an empty list without a graph or getNodes', () => {
        assert.deepEqual(collectGraphTopics(null), []);
        assert.deepEqual(collectGraphTopics(undefined), []);
        assert.deepEqual(collectGraphTopics({}), []);
    });

    it('skips malformed nodes without throwing', () => {
        const graph = graphOf(null, {}, { id: 'x', type: 'mqtt-read' }, { id: 'y', controls: [] });

        assert.deepEqual(collectGraphTopics(graph), []);
    });

    it('harvests only the requested control ids', () => {
        const graph = graphOf(
            node(
                'a',
                'mqtt-will',
                [{ id: 'willTopic' }, { id: 'topic' }],
                { willTopic: 'home/status', topic: 'home/other' }
            )
        );

        assert.deepEqual(
            collectGraphTopics(graph, ['willTopic']).map((entry) => entry.topic),
            ['home/status']
        );
    });
});

describe('graph topic helpers', () => {
    it('derives the custom control id from the topic control id', () => {
        assert.equal(customTopicControlId('topic'), 'customTopic');
        assert.equal(customTopicControlId('willTopic'), 'customWillTopic');
        assert.equal(customTopicControlId('announceTopic'), 'customAnnounceTopic');
        assert.equal(customTopicControlId('triggerTopic'), 'customTriggerTopic');
    });

    it('resolves the effective topic value with and without the sentinel', () => {
        assert.equal(effectiveTopicValue('topic', { topic: ' home/a ' }), 'home/a');
        assert.equal(
            effectiveTopicValue('topic', {
                topic: GRAPH_TOPIC_NEW_SENTINEL,
                customTopic: 'home/b',
            }),
            'home/b'
        );
        assert.equal(effectiveTopicValue('topic', undefined), '');
        assert.equal(effectiveTopicValue('topic', { topic: GRAPH_TOPIC_NEW_SENTINEL }), '');
    });
});
