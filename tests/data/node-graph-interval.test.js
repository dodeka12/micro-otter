// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Interval normalization tests for the real `NodeGraph` model.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

describe('NodeGraph interval', () => {
    it('defaults to 500 ms when no interval is provided', () => {
        const graph = new NodeGraph({ id: 'graph-default' });

        assert.equal(graph.getTriggerInterval(), 500);
    });

    it('keeps an explicit 0 through construction and serialization', () => {
        const graph = new NodeGraph({ id: 'graph-zero', triggerIntervalMs: 0 });

        assert.equal(graph.getTriggerInterval(), 0);

        const roundTripped = new NodeGraph(graph.toData());

        assert.equal(roundTripped.getTriggerInterval(), 0);
    });

    it('emits exactly one interval event for setTriggerInterval(0)', () => {
        const graph = new NodeGraph({ id: 'graph-events', triggerIntervalMs: 500 });
        const events = [];

        graph.on('*', (event) => {
            if (event.name === 'interval') {
                events.push(event);
            }
        });

        graph.setTriggerInterval(0);

        assert.equal(graph.getTriggerInterval(), 0);
        assert.equal(events.length, 1);

        const validated = assertAppEventPayloadType(
            events[0],
            'NodeGraph.IntervalChanged.v1',
            'NodeGraph listener'
        );

        assert.equal(validated.detail.graphId, 'graph-events');
        assert.equal(validated.detail.triggerIntervalMs, 0);
    });

    it('floors and clamps stored values', () => {
        const graph = new NodeGraph({ id: 'graph-clamp' });

        graph.setTriggerInterval(-25);
        assert.equal(graph.getTriggerInterval(), 0);

        graph.setTriggerInterval('12.9');
        assert.equal(graph.getTriggerInterval(), 12);

        graph.setTriggerInterval(70000);
        assert.equal(graph.getTriggerInterval(), 60000);
    });

    it('falls back to the default for unusable values', () => {
        const graph = new NodeGraph({ id: 'graph-invalid' });

        graph.setTriggerInterval('abc');
        assert.equal(graph.getTriggerInterval(), 500);

        graph.setTriggerInterval(undefined);
        assert.equal(graph.getTriggerInterval(), 500);

        graph.setTriggerInterval(null);
        assert.equal(graph.getTriggerInterval(), 500);
    });

    it('normalizes an unusable constructor value and clamps a negative one', () => {
        const invalid = new NodeGraph({ id: 'graph-invalid-ctor', triggerIntervalMs: 'abc' });
        assert.equal(invalid.getTriggerInterval(), 500);

        const negative = new NodeGraph({ id: 'graph-negative-ctor', triggerIntervalMs: -1 });
        assert.equal(negative.getTriggerInterval(), 0);
    });
});
