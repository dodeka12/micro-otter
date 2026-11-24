import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

describe('node package index schema', () => {
    it('index entries are { id, manifest } objects', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');

        assert.ok(Array.isArray(index.packages), 'expected a packages array');
        for (const entry of index.packages) {
            assert.equal(typeof entry.id, 'string');
            assert.equal(typeof entry.manifest, 'string');
        }
    });

    it('manifest precedence parses as an integer', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');
        const manifestRel = index.packages.find((entry) => entry.id === 'audio').manifest;

        const manifest = readJson(`src/micro_otter/nodes/device/node_pkgs/${manifestRel}`);

        assert.equal(Number.isInteger(manifest.variants.viper.precedence), true);
    });

    it('every package id in the index is registered in the general runtime', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');
        const manifest = readJson('src/micro_otter/nodes/device/runtime/general/manifest.json');
        const global = manifest.nodePackages.global;
        const ids = new Set(index.packages.map((entry) => entry.id));

        for (const id of ids) {
            assert.ok(global.includes(id), `package '${id}' is missing from nodePackages.global`);
        }
    });
});
