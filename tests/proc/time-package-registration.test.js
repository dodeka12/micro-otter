import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const NODE_PKGS_ROOT = path.resolve('src/micro_otter/nodes/device/node_pkgs');

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

describe('time package registration', () => {
    it('lists time in the node package index', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');
        const entry = index.packages.find((pkg) => pkg.id === 'time');
        assert.ok(entry, 'expected time in node package index');
        assert.equal(entry.manifest, 'time/manifest.json');
        assert.ok(existsSync(path.join(NODE_PKGS_ROOT, entry.manifest)));
    });

    it('registers time exactly once in the general runtime', () => {
        const manifest = readJson('src/micro_otter/nodes/device/runtime/general/manifest.json');
        const occurrences = manifest.nodePackages.global.filter((id) => id === 'time');
        assert.equal(occurrences.length, 1);
    });

    it('points the index entry at the time package manifest', () => {
        const manifest = readJson('src/micro_otter/nodes/device/node_pkgs/time/manifest.json');
        assert.equal(manifest.id, 'time');
        assert.equal(manifest.nodeDefs, 'node_definitions.json');
    });
});
