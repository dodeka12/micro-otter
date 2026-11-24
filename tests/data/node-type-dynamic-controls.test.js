import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';

function loadNodeTypes(pkg) {
    return JSON.parse(
        readFileSync(
            path.resolve(`src/micro_otter/nodes/device/node_pkgs/${pkg}/node_definitions.json`),
            'utf8'
        )
    ).nodeTypes;
}

describe('NodeType dynamic control instances', () => {
    it('preserves dynamicOptions and default on audio I2S controls', () => {
        const audio = loadNodeTypes('audio');
        const nodeType = new NodeType({ ...audio['i2s-input'], type: 'audio.i2s-input' }, '');

        const bclkPin = nodeType.getControlById('bclkPin');
        assert.equal(bclkPin.type, 'dropdown');
        assert.equal(bclkPin.defaultValue, 4);
        assert.equal(bclkPin.dynamicOptions.source, 'targetPinsForCapability');
        assert.equal(bclkPin.dynamicOptions.capabilityKey, 'i2s.bclk');

        const i2sId = nodeType.getControlById('i2sId');
        assert.equal(i2sId.defaultValue, 0);
        assert.equal(i2sId.dynamicOptions.source, 'targetResourceValues');
        assert.equal(i2sId.dynamicOptions.resourceGroup, 'i2s');
        assert.equal(i2sId.dynamicOptions.resourceKey, 'controllers');
    });

    it('preserves dynamicOptions and default on core pin controls', () => {
        const core = loadNodeTypes('core');
        const nodeType = new NodeType({ ...core['digital-input'], type: 'core.digital-input' }, '');

        const pin = nodeType.getControlById('pin');
        assert.equal(pin.type, 'dropdown');
        assert.equal(pin.defaultValue, 0);
        assert.equal(pin.dynamicOptions.capabilityKey, 'digital.input');

        const pull = nodeType.getControlById('pull');
        assert.equal(pull.defaultValue, null);
        assert.equal(pull.dynamicOptions.source, 'targetPinPull');
        assert.deepEqual(pull.dynamicOptions.dependsOn, ['pin']);
    });
});
