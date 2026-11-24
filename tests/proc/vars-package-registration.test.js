import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

describe('vars package registration', () => {
    it('lists vars in the node package index', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');
        const entry = index.packages.find((pkg) => pkg.id === 'vars');
        assert.ok(entry, 'expected vars in node package index');
        assert.equal(entry.manifest, 'vars/manifest.json');
    });

    it('registers vars in the general runtime', () => {
        const manifest = readJson('src/micro_otter/nodes/device/runtime/general/manifest.json');
        assert.ok(manifest.nodePackages.global.includes('vars'));
    });

    it('ships the signals runtime and the bumped version', () => {
        const manifest = readJson('src/micro_otter/nodes/device/node_pkgs/vars/manifest.json');
        assert.equal(manifest.version, '0.70.0');
        assert.ok(
            manifest.variants.py.mpAssets['*'].includes('otter_vars/signals.py'),
            'expected otter_vars/signals.py in the py variant assets'
        );
    });
});
