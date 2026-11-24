// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import NodeData from '../../src/micro_otter/nodes/html/js/data/node-data.js';

describe('NodeData capability issues', () => {
    it('normalizes capability issue payloads at construction', () => {
        const node = new NodeData({
            id: 'node-1',
            type: 'example',
            capabilityIssues: [
                {
                    scope: 'control',
                    controlId: 'pin',
                    capability: 'pwm.output',
                    message: 'Pin does not support PWM output',
                },
            ],
        });

        const issues = node.getCapabilityIssues();
        assert.equal(issues.length, 1);
        assert.equal(issues[0].nodeId, 'node-1');
        assert.equal(issues[0].scope, 'control');
        assert.equal(node.hasCapabilityIssues(), true);
    });

    it('emits capability-issues-changed when issues change', () => {
        const node = new NodeData({ id: 'node-2', type: 'example' });
        let payload = null;

        node.on('capability-issues-changed', ({ detail }) => {
            payload = detail;
        });

        node.setCapabilityIssues([
            {
                scope: 'node',
                capability: 'i2c.sda',
                message: 'Missing required capability: i2c.sda',
            },
        ]);

        assert.ok(payload);
        assert.equal(payload.nodeId, 'node-2');
        assert.equal(payload.previousIssues.length, 0);
        assert.equal(payload.issues.length, 1);
    });

    it('does not include capability issues in serialized graph data', () => {
        const node = new NodeData({
            id: 'node-3',
            type: 'example',
            capabilityIssues: [
                {
                    scope: 'node',
                    message: 'Any issue',
                },
            ],
        });

        const serialized = node.toData();

        assert.equal(Object.hasOwn(serialized, 'capabilityIssues'), false);
    });

    it('clears issues via clearCapabilityIssues()', () => {
        const node = new NodeData({
            id: 'node-4',
            type: 'example',
            capabilityIssues: [
                {
                    scope: 'node',
                    message: 'Any issue',
                },
            ],
        });

        node.clearCapabilityIssues();

        assert.deepEqual(node.getCapabilityIssues(), []);
        assert.equal(node.hasCapabilityIssues(), false);
    });
});
