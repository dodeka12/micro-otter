// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    DEFAULT_VARIANT_ID,
    DEFAULT_VARIANT_TITLE,
    listPackageVariants,
    variantDescription,
    variantDisplayName,
} from '../../src/micro_otter/nodes/html/js/data/package-resolver.js';

const NODE_PKGS = path.resolve('src/micro_otter/nodes/device/node_pkgs');

function readJson(relativePath) {
    return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

const index = readJson('src/micro_otter/nodes/device/node_pkgs/index.json');

function loadManifest() {
    return async (manifestRel) =>
        JSON.parse(readFileSync(path.resolve(NODE_PKGS, manifestRel), 'utf8'));
}

describe('shipped node package variant metadata', () => {
    it('every package has a name', async () => {
        for (const entry of index.packages) {
            const variants = await listPackageVariants(index.packages, entry.id, loadManifest());
            assert.ok(variants.length > 0, `expected variants for ${entry.id}`);
            for (const variant of variants) {
                assert.ok(variantDisplayName(variant, 'en').trim(), `${entry.id} has a blank name`);
                assert.ok(
                    variantDisplayName(variant, 'de').trim(),
                    `${entry.id} has a blank de name`
                );
            }
        }
    });

    it('audio ships one viper variant', async () => {
        const variants = await listPackageVariants(index.packages, 'audio', loadManifest());

        assert.equal(variants.length, 1);
        const [audio] = variants;
        assert.equal(audio.variantId, 'viper');
        assert.equal(variantDisplayName(audio, 'en'), 'Viper');
        assert.ok(variantDescription(audio, 'en').trim());
        assert.ok(variantDescription(audio, 'de').trim());
    });

    it('every package ships one manifest.json', async () => {
        for (const entry of index.packages) {
            assert.equal(entry.manifest.split('/').pop(), 'manifest.json');
        }
    });

    it('no viper-requiring variant resolves to the default id', async () => {
        for (const entry of index.packages) {
            const variants = await listPackageVariants(index.packages, entry.id, loadManifest());
            for (const variant of variants) {
                const required = variant.requiredCapabilities;
                if (Array.isArray(required) && required.includes('viper')) {
                    assert.notEqual(
                        variant.variantId,
                        DEFAULT_VARIANT_ID,
                        `${entry.id} viper variant claims the default id`
                    );
                }
            }
        }
    });

    it('every non-audio built-in resolves to Py', async () => {
        for (const entry of index.packages) {
            if (entry.id === 'audio') {
                continue;
            }
            const variants = await listPackageVariants(index.packages, entry.id, loadManifest());
            for (const variant of variants) {
                assert.equal(variant.variantId, DEFAULT_VARIANT_ID);
                assert.equal(variantDisplayName(variant, 'en'), DEFAULT_VARIANT_TITLE);
            }
        }
    });

    it("audio's assets stay viper-rooted", () => {
        const manifest = readJson(`${NODE_PKGS}/audio/manifest.json`);
        for (const assetList of Object.values(manifest.variants.viper.mpAssets)) {
            for (const asset of assetList) {
                assert.ok(asset.startsWith('otter_audio_viper/'), `asset ${asset} is not viper-rooted`);
            }
        }
    });
});
