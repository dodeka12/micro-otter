import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/time');
const manifestPath = path.join(packageRoot, 'manifest.json');
const varsManifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/vars/manifest.json');
const definitionsPath = path.join(packageRoot, 'node_definitions.json');
const generatorsPath = path.join(packageRoot, 'node_generators.js');

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function packageJsonFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...packageJsonFiles(fullPath));
            continue;
        }
        if (entry.name.endsWith('.json')) {
            files.push(fullPath);
        }
    }
    return files;
}

describe('time package scaffold', () => {
    it('declares a valid package manifest', () => {
        const manifest = readJson(manifestPath);
        assert.equal(manifest.id, 'time');
        assert.equal(manifest.nodeDefs, 'node_definitions.json');
        assert.ok(manifest.generators.includes('node_generators.js'));
        assert.deepEqual(manifest.mpModuleRoots, ['']);
    });

    it('freezes the otter_time modules for every node type', () => {
        const manifest = readJson(manifestPath);
        const wildcard = manifest.variants.py.mpAssets['*'];
        assert.deepEqual(wildcard, [
            'otter_time/__init__.py',
            'otter_time/parts.py',
            'otter_time/service.py',
        ]);
        for (const asset of wildcard) {
            assert.ok(
                existsSync(path.join(packageRoot, asset)),
                `expected mpAssets entry '${asset}' to exist on disk`
            );
        }
    });

    it('carries no package-level capability requirement', () => {
        const manifest = readJson(manifestPath);
        assert.equal(
            manifest.requiredCapabilities,
            undefined,
            'the wifi/ethernet requirement belongs to time-service, not the package'
        );
    });

    it('mirrors the mpy-compile profiles of the vars package', () => {
        const manifest = readJson(manifestPath);
        const varsManifest = readJson(varsManifestPath);
        assert.deepEqual(manifest.mpyCompileProfiles, varsManifest.mpyCompileProfiles);
    });
});

describe('time package icons', () => {
    const ICONS = ['schedule', 'sync', 'timer', 'calendar_month', 'hourglass_bottom', 'text_fields'];

    it('ships the six Material icons normalized for the palette', () => {
        for (const name of ICONS) {
            const iconPath = path.join(packageRoot, 'icons', `${name}_24dp.svg`);
            assert.ok(existsSync(iconPath), `expected icon '${name}_24dp.svg'`);

            const svg = readFileSync(iconPath, 'utf8');
            assert.ok(svg.startsWith('<svg'), `'${name}' must start with <svg`);
            assert.ok(
                svg.includes('viewBox="0 -960 960 960"'),
                `'${name}' must keep the Material Symbols viewBox`
            );
            assert.ok(
                svg.includes('fill="#e3e3e3"'),
                `'${name}' must carry the package fill color`
            );
            assert.match(svg, /<path[^>]*d="[^"]+"/, `'${name}' must contain path data`);
        }
    });
});

describe('time package placeholders', () => {
    let originalSelf;
    let originalWindow;
    let originalNodeCodeGenerators;
    let originalNodeInitGenerators;

    before(async () => {
        originalSelf = globalThis.self;
        originalWindow = globalThis.window;
        originalNodeCodeGenerators = globalThis.NodeCodeGenerators;
        originalNodeInitGenerators = globalThis.NodeInitGenerators;
        globalThis.self = globalThis;
        delete globalThis.window;
        globalThis.NodeCodeGenerators = {};
        globalThis.NodeInitGenerators = {};
        await import(`${pathToFileURL(generatorsPath).href}?test=time-scaffold`);
    });

    after(() => {
        if (originalSelf === undefined) delete globalThis.self;
        else globalThis.self = originalSelf;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalNodeCodeGenerators === undefined) delete globalThis.NodeCodeGenerators;
        else globalThis.NodeCodeGenerators = originalNodeCodeGenerators;
        if (originalNodeInitGenerators === undefined) delete globalThis.NodeInitGenerators;
        else globalThis.NodeInitGenerators = originalNodeInitGenerators;
    });

    it('parses every JSON file in the package', () => {
        const jsonFiles = packageJsonFiles(packageRoot);
        assert.ok(jsonFiles.length >= 2, 'expected manifest.json and node_definitions.json');
        for (const filePath of jsonFiles) {
            assert.doesNotThrow(() => readJson(filePath), `failed to parse ${filePath}`);
        }
    });

    it('keeps the node definitions in a nodeTypes registry', () => {
        const definitions = readJson(definitionsPath);
        assert.equal(typeof definitions.nodeTypes, 'object');
        assert.ok(Object.keys(definitions.nodeTypes).length > 0);
    });

    it('provides the otter_time package marker', () => {
        assert.ok(existsSync(path.join(packageRoot, 'otter_time/__init__.py')));
    });

    it('loads the generator file on a bare global scope', () => {
        assert.deepEqual(Object.keys(globalThis.NodeCodeGenerators).sort(), [
            'timeBetween',
            'timeClockParts',
            'timeDateParts',
            'timeFormat',
            'timeService',
            'timeStatus',
        ]);
        assert.deepEqual(Object.keys(globalThis.NodeInitGenerators), ['timeService']);
    });
});
