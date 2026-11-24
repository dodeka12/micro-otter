import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import DeviceRuntime from '../../src/micro_otter/nodes/html/js/data/device-runtime.js';

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

function jsonResponse(data) {
    return { ok: true, status: 200, json: async () => data };
}

function makeFetch(routes) {
    return async (input) => {
        const url = String(input);
        for (const [suffix, data] of Object.entries(routes)) {
            if (url.endsWith(suffix)) {
                return jsonResponse(data);
            }
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
}

describe('audio package registration', () => {
    it('uses audio as the stable package id', () => {
        const manifest = readJson(
            'src/micro_otter/nodes/device/node_pkgs/audio/manifest.json'
        );
        assert.equal(manifest.id, 'audio');
        assert.deepEqual(manifest.variants.viper.requiredCapabilities, ['viper']);

        const mpAssets = Object.values(manifest.variants.viper.mpAssets).flat();
        assert.ok(mpAssets.length > 0, 'expected audio package to declare mpAssets');
        assert.ok(
            mpAssets.every((assetPath) => assetPath.startsWith('otter_audio_viper/')),
            'expected mpAssets to keep pointing under otter_audio_viper/'
        );
    });

    it('maps the audio id to the audio folder in the package index', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');
        const entry = index.packages.find((pkg) => pkg.id === 'audio');
        assert.ok(entry, 'expected audio in node package index');
        assert.equal(entry.manifest, 'audio/manifest.json');
        assert.ok(
            !index.packages.some((pkg) => pkg.id === 'otter_audio_viper'),
            'expected no otter_audio_viper package id in the index'
        );
    });

    it('registers audio in the general runtime', () => {
        const manifest = readJson('src/micro_otter/nodes/device/runtime/general/manifest.json');
        assert.ok(manifest.nodePackages.global.includes('audio'));
        assert.ok(!manifest.nodePackages.global.includes('otter_audio_viper'));
    });

    it('resolves audio.oscillator through the package index', async () => {
        const runtime = new DeviceRuntime('/device/runtime/general');
        await runtime.load(
            makeFetch({
                'runtime/general/manifest.json': {
                    id: 'general',
                    nodePackages: { global: ['audio'], local: [] },
                },
                'node_pkgs/index.json': {
                    version: 1,
                    packages: [{ id: 'audio', manifest: 'audio/manifest.json' }],
                },
                'node_pkgs/audio/manifest.json': {
                    id: 'audio',
                    nodeDefs: 'node_definitions.json',
                },
                'node_pkgs/audio/node_definitions.json': {
                    nodeTypes: {
                        oscillator: {
                            title: { en: 'Oscillator' },
                            inputs: [],
                            outputs: [],
                            controls: [],
                        },
                    },
                },
            }),
            '/device/node_pkgs',
            null
        );

        assert.ok(runtime.getNodePackage('audio'), 'expected audio package under its logical id');
        assert.ok(runtime.getNodeType('audio.oscillator'), 'expected audio.oscillator to resolve');
    });

    it('registers the ring-mod node and its module asset', () => {
        const manifest = readJson(
            'src/micro_otter/nodes/device/node_pkgs/audio/manifest.json'
        );
        assert.deepEqual(manifest.variants.viper.mpAssets['ring-mod'], ['otter_audio_viper/ring_mod.py']);

        const defs = readJson(
            'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
        );
        const ringMod = defs.nodeTypes['ring-mod'];
        assert.ok(ringMod, 'expected ring-mod node definition');
        assert.deepEqual(ringMod.requiredCapabilities, ['viper']);
        assert.deepEqual(
            ringMod.inputs.map((input) => input.id),
            ['block', 'frequency', 'depth', 'enabled']
        );
        assert.equal(ringMod.inputs[1].defaultControl.default, 150);
        assert.equal(ringMod.inputs[2].defaultControl.default, 1);
        assert.equal(ringMod.controls[0].default, 16000);
    });

    it('ships the shared mix ramp module for every effect', () => {
        const manifest = readJson(
            'src/micro_otter/nodes/device/node_pkgs/audio/manifest.json'
        );
        assert.ok(
            manifest.variants.viper.mpAssets['*'].includes('otter_audio_viper/mix_ramp.py'),
            'expected mix_ramp.py in the package wildcard assets'
        );
    });

    it('gives bitcrusher a mix control and four dropped bits by default', () => {
        const defs = readJson(
            'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
        );
        const crush = defs.nodeTypes.bitcrusher;
        assert.deepEqual(
            crush.inputs.map((input) => input.id),
            ['block', 'bits', 'mix', 'enabled']
        );

        const bits = crush.inputs[1].defaultControl;
        assert.equal(bits.default, 4);
        assert.equal(bits.min, 1);
        assert.equal(bits.max, 15);

        const mix = crush.inputs[2].defaultControl;
        assert.equal(mix.default, 1);
        assert.equal(mix.min, 0);
        assert.equal(mix.max, 1);
        assert.equal(mix.step, 0.05);
    });

    it('gives downsampler mix and antiAlias controls after hold', () => {
        const defs = readJson(
            'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
        );
        const ds = defs.nodeTypes.downsampler;
        assert.deepEqual(
            ds.inputs.map((input) => input.id),
            ['block', 'hold', 'mix', 'antiAlias', 'enabled']
        );

        const mix = ds.inputs[2].defaultControl;
        assert.equal(mix.default, 1);
        assert.equal(mix.min, 0);
        assert.equal(mix.max, 1);

        const antiAlias = ds.inputs[3].defaultControl;
        assert.equal(antiAlias.type, 'checkbox');
        assert.equal(antiAlias.default, true);
    });

    it('gives square-fuzz a mix control between level and envelopeFollow', () => {
        const defs = readJson(
            'src/micro_otter/nodes/device/node_pkgs/audio/node_definitions.json'
        );
        const fuzz = defs.nodeTypes['square-fuzz'];
        assert.deepEqual(
            fuzz.inputs.map((input) => input.id),
            ['block', 'level', 'mix', 'envelopeFollow', 'enabled']
        );
        const mix = fuzz.inputs[2].defaultControl;
        assert.equal(mix.default, 0.5);
        assert.equal(mix.min, 0);
        assert.equal(mix.max, 1);
        assert.equal(mix.step, 0.05);
    });
});
