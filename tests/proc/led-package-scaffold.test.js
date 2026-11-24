import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('src/micro_otter/nodes/device/node_pkgs/led/manifest.json');
const packageRoot = path.resolve('src/micro_otter/nodes/device/node_pkgs/led');

function readManifest() {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

describe('led package scaffold', () => {
    it('declares a valid package manifest', () => {
        const manifest = readManifest();
        assert.equal(manifest.id, 'led');
        assert.equal(manifest.nodeDefs, 'node_definitions.json');
        assert.ok(manifest.generators.includes('node_generators.js'));
    });

    it('freezes the pattern and driver modules via mpAssets', () => {
        const manifest = readManifest();
        assert.ok(manifest.variants.py.mpAssets['*'].includes('otter_led/__init__.py'));
        assert.ok(manifest.variants.py.mpAssets['led-neopixel-output'].includes('otter_led/drivers/neopixel.py'));
        assert.ok(manifest.variants.py.mpAssets['led-pwm-strip-output'].includes('otter_led/drivers/pwm_strip.py'));
        assert.ok(manifest.variants.py.mpAssets['led-single-output'].includes('otter_led/drivers/single.py'));
    });

    it('provides the otter_led package init module', () => {
        assert.ok(existsSync(path.join(packageRoot, 'otter_led/__init__.py')));
    });
});
