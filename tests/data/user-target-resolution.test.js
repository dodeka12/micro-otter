// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeTargetPayload, resolveUserTargetPayload } from '../../src/micro_otter/nodes/html/js/data/target-resolution.js';

const BASE = {
    id: 'esp32_wroom',
    targetId: 'esp32_wroom',
    displayName: 'ESP32-WROOM',
    description: 'Base board',
    openPins: null,
    pinCapabilities: {
        2: { label: 'GPIO2', digital: { input: true, output: true } },
        5: { label: 'GPIO5', digital: { input: true, output: true } },
    },
    resources: { pwm: { channels: 16 }, adc: { units: 2 } },
    generalCapabilities: { wifi: { supported: true }, bluetooth: { supported: false } },
    capabilityToPins: { 'pwm.output': [2, 5] },
};

describe('resolveUserTargetPayload', () => {
    it('replaces scalars with the override', () => {
        const resolved = resolveUserTargetPayload(BASE, {
            displayName: 'My Board',
            description: 'Derived',
        });

        assert.equal(resolved.displayName, 'My Board');
        assert.equal(resolved.description, 'Derived');
        assert.equal(resolved.id, 'esp32_wroom');
    });

    it('merges pinCapabilities per pin and removes a pin on null', () => {
        const resolved = resolveUserTargetPayload(BASE, {
            pinCapabilities: {
                2: { label: 'GPIO2 (renamed)' },
                5: null,
                6: { label: 'GPIO6', digital: { input: true, output: false } },
            },
        });

        const pins = resolved.pinCapabilities;
        assert.equal(pins[2].label, 'GPIO2 (renamed)');
        assert.equal(pins[2].digital.output, true);
        assert.equal(pins[5], undefined);
        assert.equal(pins[6].digital.input, true);
    });

    it('merges resources/generalCapabilities/capabilityToPins key-wise with the user winning', () => {
        const resolved = resolveUserTargetPayload(BASE, {
            resources: { adc: { units: 1 }, dac: { channels: 1 } },
            generalCapabilities: { bluetooth: { supported: true } },
            capabilityToPins: { 'pwm.output': [2] },
        });

        assert.equal(resolved.resources.pwm.channels, 16);
        assert.equal(resolved.resources.adc.units, 1);
        assert.equal(resolved.resources.dac.channels, 1);
        assert.equal(resolved.generalCapabilities.wifi.supported, true);
        assert.equal(resolved.generalCapabilities.bluetooth.supported, true);
        assert.deepEqual(resolved.capabilityToPins['pwm.output'], [2]);
    });

    it('inherits openPins from the base and ignores an override', () => {
        const genericBase = { ...BASE, openPins: { min: 0, max: 255 } };
        const resolved = resolveUserTargetPayload(genericBase, {
            openPins: { min: 0, max: 10 },
        });

        assert.deepEqual(resolved.openPins, { min: 0, max: 255 });
    });

    it('concatenates metadata.notes base-first', () => {
        const withNotes = {
            ...BASE,
            metadata: { notes: ['base note A', 'base note B'], defaultI2cBus: 'i2c0' },
        };
        const resolved = mergeTargetPayload(withNotes, {
            metadata: { notes: ['derived note'], defaultI2cBus: 'i2c1' },
        });

        assert.deepEqual(resolved.metadata.notes, [
            'base note A',
            'base note B',
            'derived note',
        ]);
        assert.equal(resolved.metadata.defaultI2cBus, 'i2c1');
    });

    it('keeps base notes when the override has none', () => {
        const withNotes = { ...BASE, metadata: { notes: ['base note'] } };
        const resolved = mergeTargetPayload(withNotes, { metadata: { defaultI2cBus: 'i2c1' } });

        assert.deepEqual(resolved.metadata.notes, ['base note']);
    });
});
