import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/audio/manifest.json');
const dataTypesPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/audio/data_types.json');

describe('audio package data types', () => {
    it('declares a data types file in the manifest', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.equal(manifest.dataTypes, 'data_types.json');
    });

    it('requires viper', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.deepEqual(manifest.variants.viper.requiredCapabilities, ['viper']);
    });

    it('registers audio.block as a structure kind', () => {
        const dataTypes = JSON.parse(readFileSync(dataTypesPath, 'utf8'));
        assert.equal(dataTypes.types?.['audio.block']?.kind, 'structure');
    });
});
