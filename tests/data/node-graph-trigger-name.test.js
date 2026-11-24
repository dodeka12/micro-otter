// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Trigger-name normalization and event tests for the real `NodeGraph` model.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

describe('NodeGraph triggerName', () => {
    it('defaults to an empty name', () => {
        const graph = new NodeGraph({ id: 'graph-default' });

        assert.equal(graph.getTriggerName(), '');
    });

    it('trims the name and emits exactly one triggerName event', () => {
        const graph = new NodeGraph({ id: 'graph-events' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'triggerName') {
                events.push(event);
            }
        });

        graph.setTriggerName('  Button ');

        assert.equal(graph.getTriggerName(), 'Button');
        assert.equal(events.length, 1);

        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.TriggerNameChanged.v1',
            'NodeGraph listener'
        );

        assert.equal(validated.detail.graphId, 'graph-events');
        assert.equal(validated.detail.triggerName, 'Button');
    });

    it('keeps the case and inner spaces of a name', () => {
        const graph = new NodeGraph({ id: 'graph-case', triggerName: ' Hall Sensor ' });

        assert.equal(graph.getTriggerName(), 'Hall Sensor');
    });

    it('emits nothing when the normalized value does not change', () => {
        const graph = new NodeGraph({ id: 'graph-noop', triggerName: 'Button' });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'triggerName') {
                events.push(event);
            }
        });

        graph.setTriggerName('  Button  ');
        assert.equal(events.length, 0);

        graph.setTriggerName('Other');
        assert.equal(events.length, 1);
    });

    it('round-trips through toData and reloads a legacy graph without the field', () => {
        const graph = new NodeGraph({ id: 'graph-round-trip', triggerName: 'Button' });
        const data = graph.toData();

        assert.equal(data.triggerName, 'Button');
        assert.equal(new NodeGraph(data).getTriggerName(), 'Button');

        const legacyData = { ...data, id: 'graph-legacy' };
        delete legacyData.triggerName;
        const reloaded = new NodeGraph(legacyData);

        assert.equal(reloaded.getTriggerName(), '');
    });

    it('keeps the irq execution type through construction and serialization', () => {
        const graph = new NodeGraph({
            id: 'graph-irq',
            executionType: 'irq',
            triggerName: 'Button',
        });

        assert.equal(graph.getExecutionType(), 'irq');
        assert.equal(graph.toData().executionType, 'irq');

        const roundTripped = new NodeGraph(graph.toData());
        assert.equal(roundTripped.getExecutionType(), 'irq');
        assert.equal(roundTripped.getTriggerName(), 'Button');
    });
});
