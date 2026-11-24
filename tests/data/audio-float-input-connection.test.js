import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeGraph } from '../../src/micro_otter/nodes/html/js/data/node-graph.js';

const audioDefsPath = path.resolve(
    'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
);

function loadAudioDefinitions() {
    return JSON.parse(readFileSync(audioDefsPath, 'utf8')).nodeTypes;
}

describe('audio integer-style inputs accept float connections', () => {
    it('keeps float in initialTypes so the dynamic-type reset does not narrow bits/hold', () => {
        const defs = loadAudioDefinitions();
        for (const [nodeType, inputId] of [
            ['bitcrusher', 'bits'],
            ['downsampler', 'hold'],
        ]) {
            const input = defs[nodeType].inputs.find((entry) => entry.id === inputId);
            assert.ok(input, `${nodeType}.${inputId} input exists`);
            assert.ok(
                input.allowedTypes.includes('float'),
                `${nodeType}.${inputId} allowedTypes includes float`
            );
            assert.deepEqual(
                input.initialTypes,
                input.allowedTypes,
                `${nodeType}.${inputId} initialTypes must match allowedTypes to avoid narrowing`
            );
        }
    });

    it('connects a float output to the bitcrusher bits input', () => {
        const defs = loadAudioDefinitions();
        const bitcrusher = defs.bitcrusher;

        const graph = new NodeGraph({ id: 'audio-float' });
        const slider = graph.addNode({
            id: 'slider',
            type: 'slider',
            outputs: [{ id: 'out0', outputType: 'float' }],
        });
        const bit = graph.addNode({
            id: 'bit',
            type: 'bitcrusher',
            inputs: bitcrusher.inputs,
            outputs: bitcrusher.outputs,
            controls: bitcrusher.controls || [],
        });

        const bitsIndex = bit.inputs.findIndex((input) => input.id === 'bits');
        assert.ok(bitsIndex >= 0, 'bits input index resolved');

        const validation = graph.canConnect(slider.id, 0, bit.id, bitsIndex);
        assert.equal(validation.valid, true);
    });

    it('connects a float output to the downsampler hold input', () => {
        const defs = loadAudioDefinitions();
        const downsampler = defs.downsampler;

        const graph = new NodeGraph({ id: 'audio-float-hold' });
        const slider = graph.addNode({
            id: 'slider',
            type: 'slider',
            outputs: [{ id: 'out0', outputType: 'float' }],
        });
        const ds = graph.addNode({
            id: 'ds',
            type: 'downsampler',
            inputs: downsampler.inputs,
            outputs: downsampler.outputs,
            controls: downsampler.controls || [],
        });

        const holdIndex = ds.inputs.findIndex((input) => input.id === 'hold');
        assert.ok(holdIndex >= 0, 'hold input index resolved');

        const validation = graph.canConnect(slider.id, 0, ds.id, holdIndex);
        assert.equal(validation.valid, true);
    });
});
