// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_VARIANT_ID,
    DEFAULT_VARIANT_TITLE,
    listPackageVariants,
    parsePackageEntries,
    selectEditorManifest,
    variantDescription,
    variantDisplayName,
} from '../../src/micro_otter/nodes/html/js/data/package-resolver.js';

function loadManifest(map) {
    return async (manifestRel) => map[manifestRel];
}

describe('listPackageVariants', () => {
    it('sorts by precedence and reads each variants entry', async () => {
        const entries = parsePackageEntries({
            packages: [{ id: 'pulse', manifest: 'pulse/manifest.json' }],
        });

        const variants = await listPackageVariants(entries, 'pulse', loadManifest({
            'pulse/manifest.json': {
                description: 'Example add-on.',
                variants: {
                    py: { requiredCapabilities: [], precedence: 0 },
                    viper: {
                        requiredCapabilities: ['viper'],
                        precedence: 10,
                        title: { en: 'Viper' },
                        description: { en: 'Fast path' },
                        hardware: { en: 'ESP32' },
                    },
                },
            },
        }));

        assert.equal(variants.length, 2);
        assert.equal(variants[0].variantId, 'viper');
        assert.deepEqual(variants[0].title, { en: 'Viper' });
        assert.deepEqual(variants[0].description, { en: 'Fast path' });
        assert.deepEqual(variants[0].hardware, { en: 'ESP32' });
        assert.equal(variants[1].variantId, DEFAULT_VARIANT_ID);
        assert.equal(variants[1].packageDescription, 'Example add-on.');
    });
});

describe('selectEditorManifest', () => {
    it('returns the single manifest regardless of variants', async () => {
        const entries = parsePackageEntries({
            packages: [{ id: 'pulse', manifest: 'pulse/manifest.json' }],
        });

        const rel = await selectEditorManifest(entries, 'pulse', loadManifest({
            'pulse/manifest.json': { variants: { py: { precedence: 0 } } },
        }));

        assert.equal(rel, 'pulse/manifest.json');
    });
});

describe('variantDisplayName and variantDescription', () => {
    it('falls back to Py for the default variant id', () => {
        assert.equal(
            variantDisplayName({ variantId: DEFAULT_VARIANT_ID, title: null }, 'en'),
            DEFAULT_VARIANT_TITLE
        );
        assert.equal(
            variantDisplayName({ variantId: 'viper', title: { en: 'Viper' } }, 'en'),
            'Viper'
        );
    });

    it('falls back from the variant description to hardware', () => {
        assert.equal(
            variantDescription(
                { variantId: 'viper', description: { en: 'Schnell' }, hardware: null, packageDescription: '' },
                'en'
            ),
            'Schnell'
        );
    });
});
