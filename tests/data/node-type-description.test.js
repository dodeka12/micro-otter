import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NodeType } from '../../src/micro_otter/nodes/html/js/data/node-type.js';

describe('NodeType connector/control descriptions', () => {
    it('normalizes input, output, and control descriptions to a localized map', () => {
        const nodeType = new NodeType({
            type: 'audio.test',
            title: { en: 'Test' },
            inputs: [
                { id: 'block', name: { en: 'Block' }, description: 'Incoming audio block.' },
            ],
            outputs: [
                { id: 'out', name: { en: 'Out' }, description: { en: 'Resulting audio block.' } },
            ],
            controls: [
                {
                    id: 'gain',
                    type: 'number',
                    label: { en: 'Gain' },
                    description: 'Amplitude multiplier.',
                },
            ],
        });

        assert.deepEqual(nodeType.inputs[0].description, { en: 'Incoming audio block.' });
        assert.deepEqual(nodeType.outputs[0].description, { en: 'Resulting audio block.' });
        assert.deepEqual(nodeType.controls[0].description, { en: 'Amplitude multiplier.' });
    });

    it('round-trips descriptions through toDefinition/fromDefinition', () => {
        const nodeType = new NodeType({
            type: 'audio.test',
            title: { en: 'Test' },
            inputs: [{ id: 'block', name: { en: 'Block' }, description: 'Incoming audio block.' }],
            outputs: [
                { id: 'out', name: { en: 'Out' }, description: { en: 'Resulting audio block.' } },
            ],
            controls: [
                { id: 'gain', type: 'number', label: { en: 'Gain' }, description: 'Amplitude multiplier.' },
            ],
        });

        const reloaded = NodeType.fromDefinition(nodeType.toDefinition());

        assert.deepEqual(reloaded.inputs[0].description, { en: 'Incoming audio block.' });
        assert.deepEqual(reloaded.outputs[0].description, { en: 'Resulting audio block.' });
        assert.deepEqual(reloaded.controls[0].description, { en: 'Amplitude multiplier.' });
    });
});
