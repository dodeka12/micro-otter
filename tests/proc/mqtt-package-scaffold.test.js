import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/mqtt/manifest.json');
const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/mqtt');

function readManifest() {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

describe('mqtt package scaffold', () => {
    it('declares a valid package manifest', () => {
        const manifest = readManifest();
        assert.equal(manifest.id, 'mqtt');
        assert.equal(manifest.nodeDefs, 'node_definitions.json');
        assert.ok(manifest.generators.includes('node_generators.js'));
        assert.deepEqual(manifest.requiredCapabilities, [['wifi', 'ethernet']]);
    });

    it('freezes the runtime and vendored client modules via mpAssets', () => {
        const manifest = readManifest();
        const starAssets = manifest.variants.py.mpAssets['*'] || [];
        for (const asset of [
            'otter_mqtt/__init__.py',
            'otter_mqtt/runtime.py',
            'otter_mqtt/umqtt/__init__.py',
            'otter_mqtt/umqtt/simple.py',
            'otter_mqtt/umqtt/robust.py',
        ]) {
            assert.ok(starAssets.includes(asset), `missing mpAssets entry ${asset}`);
        }
    });

    it('provides the otter_mqtt package init module', () => {
        assert.ok(existsSync(path.join(packageRoot, 'otter_mqtt/__init__.py')));
    });

    it('requires the vars package for the json-store payload mode', () => {
        const manifest = readManifest();
        assert.deepEqual(manifest.requiredPackages, ['vars']);

        // The dependency must not dangle: the vars package has to ship the runtime module.
        const varsManifest = JSON.parse(
            readFileSync(
                path.resolve('src/micro_otter/nodes/device/node_pkgs/vars/manifest.json'),
                'utf8'
            )
        );
        const varsAssets = Object.values(varsManifest.variants.py.mpAssets || {}).flat();
        assert.ok(
            varsAssets.includes('otter_vars/store.py'),
            'the vars package does not ship otter_vars/store.py'
        );
    });
});


describe('vendored umqtt client', () => {
    it('vendors simple and robust under otter_mqtt.umqtt', () => {
        for (const file of [
            'otter_mqtt/umqtt/__init__.py',
            'otter_mqtt/umqtt/simple.py',
            'otter_mqtt/umqtt/robust.py',
        ]) {
            assert.ok(existsSync(path.join(packageRoot, file)), `missing ${file}`);
        }
    });

    it('robust imports simple via a package-relative path, not bare umqtt', () => {
        const robust = readFileSync(
            path.join(packageRoot, 'otter_mqtt/umqtt/robust.py'),
            'utf8'
        );
        assert.doesNotMatch(robust, /\bfrom\s+umqtt\b/);
        assert.doesNotMatch(robust, /\bimport\s+umqtt\b/);
        assert.match(robust, /from \. import simple/);
    });
});
