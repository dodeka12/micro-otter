import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadNodeTypes(pkg) {
    const filePath = path.resolve(
        `src/micro_otter/nodes/device/node_pkgs/${pkg}/node_definitions.json`
    );
    return JSON.parse(readFileSync(filePath, 'utf8')).nodeTypes;
}

function collectConnectors(nodeTypes) {
    const connectors = [];
    for (const [nodeId, definition] of Object.entries(nodeTypes)) {
        for (const section of ['inputs', 'outputs', 'controls']) {
            for (const entry of definition[section] || []) {
                connectors.push({ nodeId, section, id: entry.id, entry });
            }
        }
    }
    return connectors;
}

describe('audio/power node descriptions', () => {
    for (const pkg of ['audio', 'power']) {
        it(`${pkg}: every input/output/control has a non-empty description.en`, () => {
            const connectors = collectConnectors(loadNodeTypes(pkg));
            assert.ok(connectors.length > 0, `expected connectors in the ${pkg} package`);

            for (const connector of connectors) {
                const description = connector.entry?.description?.en;
                assert.ok(
                    typeof description === 'string' && description.trim().length > 0,
                    `${pkg}/${connector.nodeId}.${connector.section}[${connector.id}] missing description.en`
                );
            }
        });
    }

    it('audio: i2s-input, i2s-output, and oscillator offer 4 kHz and 8 kHz sample rates', () => {
        const nodeTypes = loadNodeTypes('audio');
        for (const nodeId of ['i2s-input', 'i2s-output', 'oscillator']) {
            const def = nodeTypes[nodeId];
            assert.ok(def, `missing ${nodeId}`);
            const control = (def.controls || []).find((entry) => entry.id === 'sampleRate');
            assert.ok(control, `${nodeId} missing sampleRate control`);
            const values = (control.options || []).map((option) => option.value);
            assert.ok(values.includes(4000), `${nodeId} missing 4000`);
            assert.ok(values.includes(8000), `${nodeId} missing 8000`);
        }
    });

    it('audio: pitch-shifter declares semitones and enabled inputs', () => {
        const nodeTypes = loadNodeTypes('audio');
        const def = nodeTypes['pitch-shifter'];
        assert.ok(def, 'missing pitch-shifter');
        const semitones = (def.inputs || []).find((entry) => entry.id === 'semitones');
        assert.ok(semitones, 'missing semitones input');
        assert.equal(semitones.defaultControl.default, 0);
        assert.equal(semitones.defaultControl.min, -12);
        assert.equal(semitones.defaultControl.max, 12);
        assert.ok((def.inputs || []).some((entry) => entry.id === 'enabled'));
        assert.ok((def.outputs || []).some((entry) => entry.id === 'block'));
    });

    it('audio: pitch-shifter manifest asset registers the driver', () => {
        const manifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/audio/manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.ok(manifest.variants.viper.mpAssets['pitch-shifter'].includes('otter_audio_viper/pitch_shifter.py'));
        assert.ok(manifest.variants.viper.mpAssets['filter'].includes('otter_audio_viper/filter.py'));
        assert.ok(manifest.variants.viper.mpAssets['noise'].includes('otter_audio_viper/noise.py'));
    });

    it('audio: filter and noise declare their connectors', () => {
        const nodeTypes = loadNodeTypes('audio');

        const filter = nodeTypes['filter'];
        assert.ok(filter, 'missing filter');
        assert.ok((filter.inputs || []).some((entry) => entry.id === 'lowHz'));
        assert.ok((filter.inputs || []).some((entry) => entry.id === 'highHz'));
        assert.ok((filter.inputs || []).some((entry) => entry.id === 'enabled'));
        assert.ok((filter.controls || []).some((entry) => entry.id === 'sampleRate'));

        const noise = nodeTypes['noise'];
        assert.ok(noise, 'missing noise');
        const level = (noise.inputs || []).find((entry) => entry.id === 'level');
        assert.ok(level, 'missing level input');
        assert.equal(level.defaultControl.default, -60);
        const threshold = (noise.inputs || []).find((entry) => entry.id === 'threshold');
        assert.ok(threshold, 'missing threshold input');
        assert.equal(threshold.defaultControl.default, -60);
        assert.ok((noise.inputs || []).some((entry) => entry.id === 'envelopeFollow'));
        assert.ok((noise.inputs || []).some((entry) => entry.id === 'enabled'));
        assert.ok((noise.outputs || []).some((entry) => entry.id === 'block'));
    });

    it('audio: square-fuzz declares envelopeFollow', () => {
        const nodeTypes = loadNodeTypes('audio');
        const def = nodeTypes['square-fuzz'];
        assert.ok(def, 'missing square-fuzz');
        assert.ok((def.inputs || []).some((entry) => entry.id === 'envelopeFollow'));
    });

    it('audio: overdrive drive is in dB', () => {
        const nodeTypes = loadNodeTypes('audio');
        const def = nodeTypes['overdrive'];
        assert.ok(def, 'missing overdrive');
        const drive = (def.inputs || []).find((entry) => entry.id === 'drive');
        assert.ok(drive, 'missing drive input');
        assert.equal(drive.defaultControl.min, 0);
        assert.equal(drive.defaultControl.max, 40);
        assert.equal(drive.defaultControl.default, 0);
    });
});
