import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

describe('led package registration', () => {
    it('lists led in the node package index', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');
        const entry = index.packages.find((pkg) => pkg.id === 'led');
        assert.ok(entry, 'expected led in node package index');
        assert.equal(entry.manifest, 'led/manifest.json');
    });

    it('registers led in the general runtime', () => {
        const manifest = readJson('src/micro_otter/nodes/device/runtime/general/manifest.json');
        assert.ok(manifest.nodePackages.global.includes('led'));
    });

    it('bumps the package version past the previously shipped version', () => {
        const manifest = readJson('src/micro_otter/nodes/device/node_pkgs/led/manifest.json');
        assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
        const current = manifest.version.split('.').map(Number);
        const previous = [0, 6, 2];
        assert.ok(
            current[0] > previous[0] ||
                (current[0] === previous[0] && current[1] > previous[1]) ||
                (current[0] === previous[0] &&
                    current[1] === previous[1] &&
                    current[2] > previous[2]),
            `expected manifest version > 0.6.2, got ${manifest.version}`
        );
    });
});
