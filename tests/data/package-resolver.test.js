import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parsePackageEntries, selectVariant } from '../../src/micro_otter/nodes/html/js/data/package-resolver.js';

function makeEntries() {
    return parsePackageEntries({
        packages: [
            { id: 'core', manifest: 'core/manifest.json' },
            { id: 'audio', manifest: 'audio/manifest.json' },
        ],
    });
}

function makeContext(viperSupported) {
    return {
        isGeneral: (capability) => capability === 'viper',
        hasGeneralCapability: (capability) => capability === 'viper' && viperSupported,
        hasPinCapability: () => false,
    };
}

const manifests = {
    'audio/manifest.json': {
        version: '1.0.0',
        variants: {
            viper: { requiredCapabilities: ['viper'], precedence: 100 },
            py: { requiredCapabilities: [], precedence: 50 },
        },
    },
};

describe('package resolver', () => {
    it('selects the higher-precedence satisfiable variant', async () => {
        const variant = await selectVariant(
            makeEntries(),
            'audio',
            async (manifestRel) => manifests[manifestRel],
            makeContext(true)
        );

        assert.ok(variant);
        assert.equal(variant.variantId, 'viper');
    });

    it('falls back to the pure-python variant without viper', async () => {
        const variant = await selectVariant(
            makeEntries(),
            'audio',
            async (manifestRel) => manifests[manifestRel],
            makeContext(false)
        );

        assert.ok(variant);
        assert.equal(variant.variantId, 'py');
    });

    it('throws for an unknown id', async () => {
        await assert.rejects(
            selectVariant(makeEntries(), 'missing', async () => ({}), makeContext(true)),
            /Unknown node package id/
        );
    });
});
