import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import NodePackage from '../../src/micro_otter/nodes/html/js/data/node-package.js';

const NODE_PKGS_ROOT = path.resolve('src/micro_otter/nodes/device/node_pkgs');
const packageRoot = path.join(NODE_PKGS_ROOT, 'irq');
const manifestPath = path.join(packageRoot, 'manifest.json');
const definitionsPath = path.join(packageRoot, 'node_definitions.json');
const hooksPath = path.join(packageRoot, 'node_capabilities.js');

const RUNTIME_ASSETS = ['otter_irq/__init__.py', 'otter_irq/interrupts.py'];

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readManifest() {
    return readJson(manifestPath);
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

describe('irq package registration', () => {
    it('lists irq in the node package index', () => {
        const index = readJson(path.join(NODE_PKGS_ROOT, 'index.json'));
        const entry = index.packages.find((pkg) => pkg.id === 'irq');
        assert.ok(entry, 'expected irq in the node package index');
        assert.equal(entry.manifest, 'irq/manifest.json');
        assert.ok(existsSync(path.join(NODE_PKGS_ROOT, entry.manifest)));
    });

    it('registers irq exactly once in the general runtime', () => {
        const manifest = readJson(
            path.resolve('src/micro_otter/nodes/device/runtime/general/manifest.json')
        );
        const occurrences = manifest.nodePackages.global.filter((id) => id === 'irq');
        assert.equal(occurrences.length, 1);
    });

    it('declares the package manifest and the v2 variant assets', () => {
        const manifest = readManifest();
        assert.equal(manifest.id, 'irq');
        assert.equal(manifest.name, 'Interrupts');
        assert.equal(manifest.description, 'GPIO interrupt input and enable nodes.');
        assert.equal(manifest.version, '0.2.2');
        assert.equal(manifest.assetsRoot, './');
        assert.equal(manifest.nodeDefs, 'node_definitions.json');
        assert.deepEqual(manifest.generators, ['node_generators.js']);
        assert.equal(manifest.capabilityChecks, 'node_capabilities.js');
        assert.deepEqual(manifest.mpModuleRoots, ['']);
        assert.equal(manifest.manifestVersion, 2);
        assert.deepEqual(manifest.variants.py.mpAssets, { '*': RUNTIME_ASSETS });
    });

    it('ships the runtime modules via mpAssets', () => {
        const pyAssets = readManifest().variants.py.mpAssets['*'] || [];
        for (const asset of RUNTIME_ASSETS) {
            assert.ok(pyAssets.includes(asset), `missing mpAssets entry ${asset}`);
            assert.ok(existsSync(path.join(packageRoot, asset)), `missing ${asset} on disk`);
        }
    });

    it('loads through NodePackage with the manifest metadata and resolved assets', async () => {
        // The generator and capability modules are imported by URL, which Node cannot resolve for
        // the served `/device/...` root; the hooks are exercised directly below instead.
        const loadableManifest = { ...readManifest(), generators: [] };
        delete loadableManifest.capabilityChecks;

        const pkg = new NodePackage('/device/node_pkgs/irq/');
        await pkg.load(
            makeFetch({
                'node_pkgs/irq/manifest.json': loadableManifest,
                'node_pkgs/irq/node_definitions.json': readJson(definitionsPath),
            })
        );

        assert.equal(pkg.id, 'irq');
        assert.equal(pkg.version, '0.2.2');
        assert.deepEqual(
            [...(pkg.mpAssets['*'] || [])].sort(),
            RUNTIME_ASSETS.map((asset) => `/device/node_pkgs/irq/${asset}`).sort()
        );
        assert.deepEqual([...pkg.nodeTypes.keys()].sort(), [
            'irq.interrupt-enable',
            'irq.interrupt-input',
        ]);
    });

    it('exports both validation hooks as functions', async () => {
        const module = await import(`${pathToFileURL(hooksPath).href}?test=irq-hooks`);

        assert.equal(typeof module.registerCapabilityChecks, 'function');
        assert.equal(typeof module.registerGraphRules, 'function');
        await module.registerCapabilityChecks(() => {});
        module.registerGraphRules(() => {});
    });
});
