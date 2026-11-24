import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/hass');
const manifestPath = path.join(packageRoot, 'manifest.json');
const indexPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/index.json');

function readManifest() {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

describe('hass package scaffold', () => {
    it('declares a valid package manifest', () => {
        const manifest = readManifest();
        assert.equal(manifest.id, 'hass');
        assert.equal(manifest.nodeDefs, 'node_definitions.json');
        assert.ok(manifest.generators.includes('node_generators.js'));
        assert.equal(manifest.capabilityChecks, 'node_capabilities.js');
        assert.deepEqual(manifest.requiredCapabilities, [['wifi', 'ethernet']]);
        assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    });

    it('requires the mqtt package', () => {
        assert.deepEqual(readManifest().requiredPackages, ['mqtt']);
    });

    it('ships the runtime modules via mpAssets', () => {
        const starAssets = readManifest().variants.py.mpAssets['*'] || [];
        for (const asset of ['otter_hass/__init__.py', 'otter_hass/runtime.py']) {
            assert.ok(starAssets.includes(asset), `missing mpAssets entry ${asset}`);
            assert.ok(existsSync(path.join(packageRoot, asset)), `missing ${asset} on disk`);
        }
    });

    it('is registered after mqtt in the package index', () => {
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        const ids = index.packages.map((entry) => entry.id);

        assert.ok(ids.includes('hass'));
        assert.ok(ids.indexOf('hass') > ids.indexOf('mqtt'));
        const entry = index.packages.find((candidate) => candidate.id === 'hass');
        assert.equal(entry.manifest, 'hass/manifest.json');
    });

    it('registers hass in the general runtime after mqtt', () => {
        const runtimeManifest = JSON.parse(
            readFileSync(
                path.resolve('src/micro_otter/nodes/device/runtime/general/manifest.json'),
                'utf8'
            )
        );
        const globalIds = runtimeManifest.nodePackages.global;

        assert.ok(globalIds.includes('hass'), 'expected hass in nodePackages.global');
        assert.ok(
            globalIds.indexOf('hass') > globalIds.indexOf('mqtt'),
            'expected hass to load after mqtt'
        );
    });

    it('parses the node definitions', () => {
        const definitions = JSON.parse(
            readFileSync(path.join(packageRoot, 'node_definitions.json'), 'utf8')
        );
        assert.equal(typeof definitions.nodeTypes, 'object');
    });

    it('loads the generators module without throwing', async () => {
        const { pathToFileURL } = await import('node:url');
        const url = pathToFileURL(path.join(packageRoot, 'node_generators.js'));

        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};

        await import(`${url.href}?test=hass-scaffold`);

        assert.equal(typeof globalThis.NodeCodeGenerators, 'object');
        assert.equal(typeof globalThis.NodeInitGenerators, 'object');
    });
});
