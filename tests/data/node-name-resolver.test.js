// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    cloneUserNameMap,
    cloneLocalizedName,
    normalizeUserName,
    normalizeUserNameMap,
    resolveLocalizedName,
    resolveNodeDisplayName,
    resolveUserNameForLocale,
} from '../../src/micro_otter/nodes/html/js/data/node-name-resolver.js';

describe('node-name-resolver', () => {
    describe('normalizeUserName()', () => {
        it('returns trimmed user name for valid strings', () => {
            assert.equal(normalizeUserName('  My Node  '), 'My Node');
        });

        it('returns null for empty or non-string values', () => {
            assert.equal(normalizeUserName('   '), null);
            assert.equal(normalizeUserName(null), null);
            assert.equal(normalizeUserName(undefined), null);
            assert.equal(normalizeUserName(42), null);
        });
    });

    describe('normalizeUserNameMap()', () => {
        it('normalizes map entries and removes empty values', () => {
            const normalized = normalizeUserNameMap({ en: '  Node ', de: '   ', fr: 'Noeud' });
            assert.deepEqual(normalized, { en: 'Node', fr: 'Noeud' });
        });

        it('converts scalar values to default locale map for compatibility', () => {
            const normalized = normalizeUserNameMap('Custom', 'de');
            assert.deepEqual(normalized, { de: 'Custom' });
        });
    });

    describe('resolveUserNameForLocale()', () => {
        it('returns only locale-specific entry (no cross-locale fallback)', () => {
            const userName = { en: 'Custom EN', de: 'Custom DE' };
            assert.equal(resolveUserNameForLocale(userName, 'de'), 'Custom DE');
            assert.equal(resolveUserNameForLocale(userName, 'fr'), null);
        });
    });

    describe('cloneUserNameMap()', () => {
        it('clones normalized user name map', () => {
            const source = { en: 'Node', de: 'Knoten' };
            const clone = cloneUserNameMap(source);
            assert.deepEqual(clone, source);
            assert.notEqual(clone, source);
        });
    });

    describe('cloneLocalizedName()', () => {
        it('wraps strings as localized objects', () => {
            assert.deepEqual(cloneLocalizedName('Constant'), { en: 'Constant' });
        });

        it('clones localization objects', () => {
            const source = { en: 'Constant', de: 'Konstante' };
            const clone = cloneLocalizedName(source);
            assert.deepEqual(clone, source);
            assert.notEqual(clone, source);
        });

        it('falls back to provided fallback for invalid values', () => {
            assert.deepEqual(cloneLocalizedName(null, 'math.add'), { en: 'math.add' });
        });
    });

    describe('resolveLocalizedName()', () => {
        it('prefers active locale, then en, then first entry', () => {
            assert.equal(resolveLocalizedName({ en: 'Constant', de: 'Konstante' }, 'de'), 'Konstante');
            assert.equal(resolveLocalizedName({ en: 'Constant', de: 'Konstante' }, 'fr'), 'Constant');
            assert.equal(resolveLocalizedName({ fr: 'Constante' }, 'de'), 'Constante');
        });

        it('uses fallback when value cannot resolve', () => {
            assert.equal(resolveLocalizedName(null, 'de', 'node.type'), 'node.type');
        });
    });

    describe('resolveNodeDisplayName()', () => {
        it('returns locale-specific user name when present', () => {
            const name = resolveNodeDisplayName({
                userName: { en: 'Living room light', de: 'Wohnzimmer Licht' },
                typeName: { en: 'GPIO Output', de: 'GPIO Ausgang' },
                type: 'gpio.output',
                locale: 'de',
            });
            assert.equal(name, 'Wohnzimmer Licht');
        });

        it('returns localized type name when locale-specific user name is missing', () => {
            const name = resolveNodeDisplayName({
                userName: { en: 'Living room light' },
                typeName: { en: 'GPIO Output', de: 'GPIO Ausgang' },
                type: 'gpio.output',
                locale: 'de',
            });
            assert.equal(name, 'GPIO Ausgang');
        });

        it('falls back to node type id', () => {
            const name = resolveNodeDisplayName({
                userName: null,
                typeName: null,
                type: 'core.math.add',
                locale: 'de',
            });
            assert.equal(name, 'core.math.add');
        });
    });
});
