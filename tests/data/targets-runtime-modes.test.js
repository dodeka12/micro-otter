import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { loadJsonFixture, resolveRepoPath } from '../helpers/fixtures/loaders.js';

const SHIPPED_TARGET_IDS = ['esp32_wroom', 'esp32_s2', 'esp32_s3', 'esp32_s3_mini'];
const WILDCARD_TARGET_IDS = ['generic_micropython'];

describe('Target catalog runtimeModes declaration', () => {
    it('every targets/index.json entry declares a runtimeModes list', async () => {
        const index = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'index.json'
        );

        assert.ok(Array.isArray(index.targets));
        for (const entry of index.targets) {
            assert.ok(Array.isArray(entry.runtimeModes), `runtimeModes missing on ${entry.id}`);
            for (const mode of entry.runtimeModes) {
                assert.ok(
                    mode === 'embedded' || mode === 'dynamic',
                    `unexpected runtimeModes value ${mode} on ${entry.id}`
                );
            }
        }
    });

    it('shipped (concrete board) targets declare the embedded onboarding mode', async () => {
        const index = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'index.json'
        );

        for (const id of SHIPPED_TARGET_IDS) {
            const entry = index.targets.find((candidate) => candidate.id === id);
            assert.ok(entry, `shipped target ${id} present`);
            assert.deepEqual(entry.runtimeModes, ['embedded']);
        }
    });

    it('wildcard targets declare no embedded onboarding mode', async () => {
        const index = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'index.json'
        );

        for (const id of WILDCARD_TARGET_IDS) {
            const entry = index.targets.find((candidate) => candidate.id === id);
            assert.ok(entry, `wildcard target ${id} present`);
            assert.ok(
                !entry.runtimeModes.includes('embedded'),
                `${id} must not declare the embedded mode`
            );
        }
    });

    it('keeps every file referenced by targets index parseable as JSON', async () => {
        const index = await loadJsonFixture(
            'src',
            'micro_otter',
            'nodes',
            'device',
            'targets',
            'index.json'
        );

        for (const entry of index.targets) {
            const targetPath = resolveRepoPath(
                'src',
                'micro_otter',
                'nodes',
                'device',
                'targets',
                entry.file
            );
            const targetSource = await fs.readFile(targetPath, 'utf-8');
            assert.doesNotThrow(() => JSON.parse(targetSource));
        }
    });
});
