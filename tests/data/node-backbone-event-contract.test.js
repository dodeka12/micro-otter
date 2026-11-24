import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assertAppEventPayloadType } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import NodeControlBase from '../../src/micro_otter/nodes/html/js/data/node-control-base.js';
import { NodeData } from '../../src/micro_otter/nodes/html/js/data/node-data.js';

describe('Backbone event contracts: NodeControlBase and NodeData', () => {
    it('NodeControlBase normalizes layout metadata with inline default', () => {
        const defaultLayout = new NodeControlBase({ id: 'a', type: 'text' });
        const explicitStacked = new NodeControlBase({ id: 'b', type: 'text', layout: 'stacked' });
        const invalidLayout = new NodeControlBase({ id: 'c', type: 'text', layout: 'grid' });

        assert.equal(defaultLayout.layout, 'inline');
        assert.equal(defaultLayout.getDefinition().layout, 'inline');
        assert.equal(explicitStacked.layout, 'stacked');
        assert.equal(explicitStacked.getDefinition().layout, 'stacked');
        assert.equal(invalidLayout.layout, 'inline');
        assert.equal(invalidLayout.getDefinition().layout, 'inline');
    });

    it('NodeControlBase.setValue emits AppEvent envelope with typed payload', () => {
        const control = new NodeControlBase({ id: 'speed', type: 'number', default: 1 });
        let received = null;

        control.on('*', (event) => {
            received = event;
        });

        control.setValue(2);

        assert.ok(received);
        assert.equal(received.name, 'value-changed');
        const validated = assertAppEventPayloadType(
            received,
            'NodeControlBase.ValueChanged.v1',
            'NodeControlBase listener'
        );
        assert.equal(validated.detail.controlId, 'speed');
        assert.equal(validated.detail.controlType, 'number');
        assert.equal(validated.detail.previousValue, 1);
        assert.equal(validated.detail.value, 2);
    });

    it('NodeControlBase does not emit when value is unchanged', () => {
        const control = new NodeControlBase({ id: 'speed', type: 'number', default: 5 });
        let emitCount = 0;

        control.on('*', () => {
            emitCount += 1;
        });

        control.setValue(5);

        assert.equal(emitCount, 0);
    });

    it('NodeData.setPosition emits typed position-changed payload', () => {
        const nodeData = new NodeData({ id: 4, x: 10, y: 20 });
        let received = null;

        nodeData.on('*', (event) => {
            received = event;
        });

        nodeData.setPosition(30, 40);

        assert.ok(received);
        assert.equal(received.name, 'position-changed');
        const validated = assertAppEventPayloadType(
            received,
            'NodeData.PositionChanged.v1',
            'NodeData listener'
        );
        assert.equal(validated.detail.nodeId, '4');
        assert.equal(validated.detail.previousX, 10);
        assert.equal(validated.detail.previousY, 20);
        assert.equal(validated.detail.x, 30);
        assert.equal(validated.detail.y, 40);
    });

    it('NodeData.setControlValue emits typed control-value payload', () => {
        const nodeData = new NodeData({ id: 8, controlValues: { out: 12 } });
        let received = null;

        nodeData.on('*', (event) => {
            if (event.name === 'control-value-changed') {
                received = event;
            }
        });

        nodeData.setControlValue('out', 14);

        assert.ok(received);
        const validated = assertAppEventPayloadType(
            received,
            'NodeData.ControlValueChanged.v1',
            'NodeData listener'
        );
        assert.equal(validated.detail.nodeId, '8');
        assert.equal(validated.detail.controlId, 'out');
        assert.equal(validated.detail.previousValue, 12);
        assert.equal(validated.detail.value, 14);
    });

    it('NodeData does not emit when input default is unchanged', () => {
        const nodeData = new NodeData({ id: 9, inputDefaults: { in0: 7 } });
        let emitCount = 0;

        nodeData.on('*', () => {
            emitCount += 1;
        });

        nodeData.setInputDefault('in0', 7);

        assert.equal(emitCount, 0);
    });
});
