import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

describe('mqtt package registration', () => {
    it('lists mqtt in the node package index', () => {
        const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');
        const entry = index.packages.find((pkg) => pkg.id === 'mqtt');
        assert.ok(entry, 'expected mqtt in node package index');
        assert.equal(entry.manifest, 'mqtt/manifest.json');
    });

    it('registers mqtt in the general runtime and preserves its settings file', () => {
        const manifest = readJson('src/micro_otter/nodes/device/runtime/general/manifest.json');
        assert.ok(manifest.nodePackages.global.includes('mqtt'));
        assert.ok(manifest.preservedPaths.includes('/mqtt_settings.json'));
        assert.ok(manifest.preservedPaths.includes('/app/mqtt_settings.json'));
    });
});
