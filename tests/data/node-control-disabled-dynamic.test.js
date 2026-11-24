import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import NodeControlBase from '../../src/micro_otter/nodes/html/js/data/node-control-base.js';
import NodeControlDropdown from '../../src/micro_otter/nodes/html/js/data/node-control-dropdown.js';

describe('NodeControlBase disabled state', () => {
    it('defaults disabled to false and toggles via setDisabled', () => {
        const control = new NodeControlBase({ id: 'c', type: 'number' });
        assert.equal(control.disabled, false);
        assert.equal(control.toState().disabled, false);

        const events = [];
        control.on('disabled-changed', (event) => events.push(event.detail));

        control.setDisabled(true);
        assert.equal(control.disabled, true);
        assert.equal(control.isDisabled(), true);
        assert.equal(control.toState().disabled, true);
        assert.equal(events.length, 1);
        assert.equal(events[0].controlId, 'c');
        assert.equal(events[0].disabled, true);
        assert.equal(events[0].previousDisabled, false);

        control.setDisabled(true);
        assert.equal(events.length, 1);
    });
});

describe('NodeControlDropdown dynamic options', () => {
    it('setOptions re-normalizes options and clamps the value', () => {
        const control = new NodeControlDropdown({
            id: 'pull',
            type: 'dropdown',
            default: null,
            options: [
                { value: null, label: { en: 'Undefined' } },
                { value: 'up', label: { en: 'Pull Up' } },
                { value: 'down', label: { en: 'Pull Down' } },
            ],
        });
        control.setValue('up');
        assert.equal(control.getValue(), 'up');

        control.setOptions([{ value: null, label: { en: 'Undefined' } }]);
        assert.equal(control.getOptions().length, 1);
        assert.equal(control.getValue(), null);
    });

    it('setDisabled reflects in toState', () => {
        const control = new NodeControlDropdown({
            id: 'pull',
            type: 'dropdown',
            options: [{ value: 'up', label: 'Up' }],
        });
        control.setDisabled(true);
        assert.equal(control.toState().disabled, true);
    });

    it('carries dynamicOptions through toState', () => {
        const control = new NodeControlDropdown({
            id: 'pin',
            type: 'dropdown',
            dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'dac' },
            options: [],
        });
        assert.deepEqual(control.toState().dynamicOptions, {
            source: 'targetPinsForCapability',
            capabilityKey: 'dac',
        });
        assert.equal(control.dynamicOptions.capabilityKey, 'dac');
    });

    it('omits dynamicOptions from state when absent', () => {
        const control = new NodeControlDropdown({ id: 'x', type: 'dropdown', options: [] });
        assert.equal(control.toState().dynamicOptions, undefined);
    });

    it('preserves default for dynamic controls with no static options', () => {
        const control = new NodeControlDropdown({
            id: 'bclkPin',
            type: 'dropdown',
            default: 4,
            dynamicOptions: { source: 'targetPinsForCapability', capabilityKey: 'i2s.bclk' },
        });
        assert.equal(control.defaultValue, 4);
        assert.equal(control.getValue(), 4);
        assert.equal(control.dynamicOptions.capabilityKey, 'i2s.bclk');
    });
});
