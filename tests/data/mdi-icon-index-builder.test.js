import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildIconIndex, MDI_VERSION, PATHS } from '../../tools/generate-mdi-icons.mjs';

const FAKE_META = {
    100: {
        name: 'account',
        codepoint: 'F0004',
        aliases: ['user', 'person'],
        deprecated: false,
    },
    200: {
        name: 'thermometer',
        codepoint: 'F050F',
        aliases: ['temperature'],
        deprecated: false,
    },
    300: {
        name: 'android',
        codepoint: 'F0032',
        aliases: [],
        deprecated: true,
    },
    400: {
        name: 'android-studio',
        codepoint: 'F0034',
        aliases: ['math-compass-variant'],
        deprecated: true,
    },
    500: {
        name: 'broken-alias',
        codepoint: '',
        aliases: ['ghost'],
        deprecated: false,
    },
    600: {
        name: 'account-circle',
        codepoint: 'F0005',
        aliases: [],
        deprecated: false,
    },
};

describe('buildIconIndex', () => {
    const index = buildIconIndex(FAKE_META);

    it('keeps canonical icons including deprecated ones', () => {
        assert.equal(index.icons.account, 'F0004');
        assert.equal(index.icons.thermometer, 'F050F');
        assert.equal(index.icons.android, 'F0032');
        assert.equal(index.icons['android-studio'], 'F0034');
    });

    it('maps aliases to their canonical name', () => {
        assert.equal(index.aliases.user, 'account');
        assert.equal(index.aliases.person, 'account');
        assert.equal(index.aliases.temperature, 'thermometer');
    });

    it('drops aliases of deprecated icons', () => {
        assert.equal(index.aliases['math-compass-variant'], undefined);
    });

    it('drops entries without a codepoint and their aliases', () => {
        assert.equal(index.icons['broken-alias'], undefined);
        assert.equal(index.aliases.ghost, undefined);
    });

    it('records the version and the counts', () => {
        assert.equal(index.version, MDI_VERSION);
        assert.equal(index.counts.icons, Object.keys(index.icons).length);
        assert.equal(index.counts.aliases, Object.keys(index.aliases).length);
    });

    it('sorts icon and alias keys alphabetically', () => {
        assert.deepEqual(Object.keys(index.icons), [
            'account',
            'account-circle',
            'android',
            'android-studio',
            'thermometer',
        ]);
        assert.deepEqual(Object.keys(index.aliases), ['person', 'temperature', 'user']);
    });

    it('tolerates an empty or missing meta object', () => {
        assert.deepEqual(buildIconIndex({}).icons, {});
        assert.deepEqual(buildIconIndex(undefined).aliases, {});
    });
});

describe('buildIconIndex against the installed MDI metadata', () => {
    const metaExists = existsSync(PATHS.metaFile);

    it('produces the full icon set', { skip: !metaExists }, () => {
        const meta = JSON.parse(readFileSync(PATHS.metaFile, 'utf-8'));
        const index = buildIconIndex(meta);

        assert.ok(
            Object.keys(index.icons).length >= 7400,
            `only ${Object.keys(index.icons).length} icons`
        );
        assert.equal(index.icons.thermometer, 'F050F');
        assert.equal(index.aliases.user, 'account');
        assert.equal(index.version, MDI_VERSION);
    });
});

describe('generated index on disk matches the installed metadata', () => {
    const inputsExist = existsSync(PATHS.metaFile) && existsSync(PATHS.outIndexFile);

    it('is byte-identical to a fresh build', { skip: !inputsExist }, () => {
        const meta = JSON.parse(readFileSync(PATHS.metaFile, 'utf-8'));
        const expected = JSON.stringify(buildIconIndex(meta));
        const committed = readFileSync(path.resolve(PATHS.outIndexFile), 'utf-8');

        assert.equal(
            committed,
            expected,
            'icon-index.json is stale; run "npm run generate:mdi" and commit the result'
        );
    });
});
