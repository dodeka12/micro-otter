import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/vars/manifest.json');
const dataTypesPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/vars/data_types.json');

describe('vars package data types', () => {
    it('declares a data types file in the manifest', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.equal(manifest.dataTypes, 'data_types.json');
    });

    it('registers vars.array as a value kind with fan-out output policy', () => {
        const dataTypes = JSON.parse(readFileSync(dataTypesPath, 'utf8'));
        assert.equal(dataTypes.types?.['vars.array']?.kind, 'value');
        assert.equal(dataTypes.types?.['vars.array']?.connectionPolicy?.input?.maxConnections, 1);
        assert.equal(dataTypes.types?.['vars.array']?.connectionPolicy?.output?.maxConnections, 0);
    });

    it('ships the array runtime via mpAssets', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.ok(manifest.variants.py.mpAssets?.['*']?.includes('otter_vars/arrays.py'));
    });
});
