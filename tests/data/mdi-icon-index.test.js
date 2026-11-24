import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    EMPTY_MDI_INDEX,
    MDI_INDEX_PATH,
    MDI_SEARCH_DEFAULT_LIMIT,
    MDI_SEARCH_MAX_LIMIT,
    countMdiIconMatches,
    formatIconValue,
    getMdiIndexState,
    getMdiIndexVersion,
    loadMdiIconIndex,
    mdiGlyphFromCodepoint,
    normalizeMdiName,
    parseIconValue,
    preloadMdiIconIndex,
    resetMdiIconIndexCache,
    resolveMdiGlyph,
    resolveMdiIconName,
    searchMdiIconPage,
    searchMdiIcons,
} from '../../src/micro_otter/nodes/html/js/data/mdi-icons.js';

const FAKE_INDEX = {
    version: '7.4.47',
    icons: {
        account: 'F0004',
        'account-circle': 'F0005',
        'home-assistant': 'F07D0',
        lightbulb: 'F0335',
        thermometer: 'F050F',
        'thermometer-lines': 'F10A2',
    },
    aliases: {
        // An alias that is also a canonical name: the direct hit must win.
        account: 'account-circle',
        home: 'home-assistant',
        temperature: 'thermometer',
        user: 'account',
    },
};

const REAL_INDEX_PATH = path.resolve('src/micro_otter/nodes/html/vendor/mdi/icon-index.json');

function readRealIndex() {
    return JSON.parse(readFileSync(REAL_INDEX_PATH, 'utf-8'));
}

describe('mdi icon index contract', () => {
    it('serves the generated index next to the vendored webfont', () => {
        assert.equal(MDI_INDEX_PATH, '/html/vendor/mdi/icon-index.json');
    });

    it('provides an empty sentinel with empty maps and no version', () => {
        assert.deepEqual(Object.keys(EMPTY_MDI_INDEX.icons), []);
        assert.deepEqual(Object.keys(EMPTY_MDI_INDEX.aliases), []);
        assert.equal(EMPTY_MDI_INDEX.version, '');
    });

    it('defaults to 300 results with a hard ceiling', () => {
        assert.equal(MDI_SEARCH_DEFAULT_LIMIT, 300);
        assert.equal(MDI_SEARCH_MAX_LIMIT, 500);
        assert.equal(searchMdiIcons(FAKE_INDEX, '').length, Object.keys(FAKE_INDEX.icons).length);
        assert.equal(searchMdiIcons(FAKE_INDEX, '', { limit: 5000 }).length, 6);
    });

    it('reports the unpaged total with every search page', () => {
        const first = searchMdiIconPage(FAKE_INDEX, '', { limit: 2 });

        assert.deepEqual(
            first.hits.map((hit) => hit.name),
            ['account', 'account-circle']
        );
        assert.equal(first.total, 6);
    });

    it('pages through ranked hits with an offset so the tail is reachable', () => {
        const pages = [
            searchMdiIconPage(FAKE_INDEX, '', { limit: 2, offset: 0 }),
            searchMdiIconPage(FAKE_INDEX, '', { limit: 2, offset: 2 }),
            searchMdiIconPage(FAKE_INDEX, '', { limit: 2, offset: 4 }),
            searchMdiIconPage(FAKE_INDEX, '', { limit: 2, offset: 6 }),
        ];

        assert.deepEqual(
            pages.flatMap((page) => page.hits.map((hit) => hit.name)),
            [
                'account',
                'account-circle',
                'home-assistant',
                'lightbulb',
                'thermometer',
                'thermometer-lines',
            ]
        );
        assert.deepEqual(
            pages.map((page) => page.hits.length),
            [2, 2, 2, 0]
        );
        assert.ok(pages.every((page) => page.total === 6));
    });

    it('keeps the page limit clamped and the offset sane', () => {
        assert.equal(searchMdiIconPage(FAKE_INDEX, '', { limit: 5000 }).hits.length, 6);
        assert.equal(searchMdiIconPage(FAKE_INDEX, '', { limit: 0 }).hits.length, 1);
        assert.equal(searchMdiIconPage(FAKE_INDEX, '', { offset: -3 }).hits.length, 6);
        assert.deepEqual(searchMdiIconPage(FAKE_INDEX, '', { offset: Number.NaN }).total, 6);
        assert.deepEqual(
            searchMdiIcons(FAKE_INDEX, '', { limit: 2, offset: 4 }).map((hit) => hit.name),
            ['thermometer', 'thermometer-lines']
        );
    });
});

describe('icon value grammar', () => {
    it('round trips a prefixed value', () => {
        const parsed = parseIconValue('mdi:thermometer');

        assert.deepEqual(parsed, { set: 'mdi', name: 'thermometer' });
        assert.equal(formatIconValue(parsed.name, parsed.set), 'mdi:thermometer');
    });

    it('treats a bare name as the mdi set', () => {
        assert.deepEqual(parseIconValue('thermometer'), { set: 'mdi', name: 'thermometer' });
        assert.equal(formatIconValue('thermometer'), 'mdi:thermometer');
    });

    it('keeps a foreign set untouched', () => {
        assert.deepEqual(parseIconValue('ph:thermometer'), { set: 'ph', name: 'thermometer' });
        assert.equal(formatIconValue('thermometer', 'ph'), 'ph:thermometer');
        assert.deepEqual(parseIconValue('hue:light'), { set: 'hue', name: 'light' });
    });

    it('rejects empty and unusable values', () => {
        for (const value of ['', '   ', ':', 'mdi:', null, undefined, 42, {}, []]) {
            assert.equal(parseIconValue(value), null, `${JSON.stringify(value)} must be rejected`);
        }
    });

    it('normalizes names for lookup', () => {
        assert.equal(normalizeMdiName(' MDI:Thermo Meter '), 'thermo-meter');
        assert.equal(normalizeMdiName('Thermometer'), 'thermometer');
        assert.equal(normalizeMdiName('ph:house'), 'ph:house');
        assert.equal(normalizeMdiName(null), '');
    });

    it('formats an empty name as an empty value', () => {
        assert.equal(formatIconValue(''), '');
        assert.equal(formatIconValue('   '), '');
    });

    it('resolves names and aliases against the index', () => {
        assert.equal(resolveMdiIconName(FAKE_INDEX, 'thermometer'), 'thermometer');
        assert.equal(resolveMdiIconName(FAKE_INDEX, 'mdi:user'), 'account');
        assert.equal(resolveMdiIconName(FAKE_INDEX, 'nonsense'), null);
        assert.equal(resolveMdiIconName(EMPTY_MDI_INDEX, 'thermometer'), null);
    });
});

describe('icon glyph helpers', () => {
    it('turns a hex codepoint into the webfont glyph', () => {
        assert.equal(mdiGlyphFromCodepoint('F050F'), String.fromCodePoint(0xf050f));
        assert.equal(mdiGlyphFromCodepoint('f050f'), String.fromCodePoint(0xf050f));
    });

    it('returns an empty glyph for unusable codepoints', () => {
        for (const codepoint of ['', 'zzzz', '0', '-1', '110000', '  ']) {
            assert.equal(
                mdiGlyphFromCodepoint(codepoint),
                '',
                `${JSON.stringify(codepoint)} must not produce a glyph`
            );
        }
    });

    it('resolves a canonical name and an alias to the same glyph', () => {
        const thermometer = String.fromCodePoint(0xf050f);

        assert.equal(resolveMdiGlyph('mdi:thermometer', FAKE_INDEX), thermometer);
        assert.equal(resolveMdiGlyph('thermometer', FAKE_INDEX), thermometer);
        assert.equal(resolveMdiGlyph('mdi:temperature', FAKE_INDEX), thermometer);
    });

    it('returns null for values the bundled index cannot resolve', () => {
        for (const value of ['', '   ', 'mdi:', 'ph:house', 'mdi:nonsense', 'therm']) {
            assert.equal(
                resolveMdiGlyph(value, FAKE_INDEX),
                null,
                `${JSON.stringify(value)} must not resolve`
            );
        }
        assert.equal(resolveMdiGlyph('mdi:thermometer', EMPTY_MDI_INDEX), null);
    });
});

describe('ranked icon search', () => {
    it('ranks a name prefix first', () => {
        const hits = searchMdiIcons(FAKE_INDEX, 'therm');

        assert.deepEqual(
            hits.map((hit) => hit.name),
            ['thermometer', 'thermometer-lines']
        );
        assert.deepEqual(
            hits.map((hit) => hit.matchedBy),
            ['prefix', 'prefix']
        );
    });

    it('finds an icon through an alias and returns the canonical name', () => {
        const hits = searchMdiIcons(FAKE_INDEX, 'user');

        assert.equal(hits.length, 1);
        assert.equal(hits[0].name, 'account');
        assert.equal(hits[0].alias, 'user');
        assert.equal(hits[0].matchedBy, 'alias');
        assert.equal(hits[0].codepoint, FAKE_INDEX.icons.account);
    });

    it('emits one hit with the stronger rank when a token is an alias and a name', () => {
        const hits = searchMdiIcons(FAKE_INDEX, 'account');

        assert.deepEqual(
            hits.map((hit) => `${hit.name}:${hit.matchedBy}`),
            ['account:exact', 'account-circle:prefix']
        );
    });

    it('ignores the mdi prefix and casing in the query', () => {
        const prefixed = searchMdiIcons(FAKE_INDEX, 'MDI:Thermo');
        const plain = searchMdiIcons(FAKE_INDEX, 'thermo');

        assert.deepEqual(
            prefixed.map((hit) => hit.name),
            plain.map((hit) => hit.name)
        );
        assert.equal(prefixed[0].name, 'thermometer');
    });

    it('browses alphabetically for an empty query', () => {
        const hits = searchMdiIcons(FAKE_INDEX, '   ', { limit: 3 });

        assert.equal(hits.length, 3);
        assert.deepEqual(
            hits.map((hit) => hit.name),
            ['account', 'account-circle', 'home-assistant']
        );
    });

    it('honours the limit', () => {
        assert.equal(searchMdiIcons(FAKE_INDEX, 'therm', { limit: 1 }).length, 1);
        assert.equal(searchMdiIcons(FAKE_INDEX, 'therm', { limit: 0 }).length, 1);
    });

    it('returns nothing for an unmatched query', () => {
        assert.deepEqual(searchMdiIcons(FAKE_INDEX, 'zzzz'), []);
        assert.deepEqual(searchMdiIcons(EMPTY_MDI_INDEX, 'thermometer'), []);
    });

    it('only returns codepoints that exist in the index', () => {
        for (const hit of searchMdiIcons(FAKE_INDEX, 'e')) {
            assert.equal(hit.codepoint, FAKE_INDEX.icons[hit.name]);
        }
    });

    it('counts matches beyond the cap', () => {
        assert.equal(countMdiIconMatches(FAKE_INDEX, 'therm'), 2);
        assert.equal(countMdiIconMatches(FAKE_INDEX, ''), 6);
        assert.equal(countMdiIconMatches(FAKE_INDEX, 'zzzz'), 0);
    });

    it('searches the shipped index fast enough for keystrokes', () => {
        const index = readRealIndex();
        const started = performance.now();
        const hits = searchMdiIcons(index, 'lig', { limit: 300 });
        const elapsed = performance.now() - started;

        assert.ok(hits.length > 0);
        assert.ok(hits.length <= 300);
        assert.ok(elapsed < 50, `3-character query took ${elapsed.toFixed(1)} ms`);
    });
});

describe('lazy index loading', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        resetMdiIconIndexCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        resetMdiIconIndexCache();
    });

    function stubFetch(implementation) {
        const calls = [];
        globalThis.fetch = async (url, init) => {
            calls.push(url);
            return implementation(url, init);
        };
        return calls;
    }

    it('fetches once and reuses the cached promise', async () => {
        const calls = stubFetch(async () => ({ ok: true, json: async () => FAKE_INDEX }));

        assert.equal(getMdiIndexState(), 'idle');

        const first = loadMdiIconIndex();
        assert.equal(getMdiIndexState(), 'loading');

        const firstIndex = await first;
        const secondIndex = await loadMdiIconIndex();

        assert.equal(calls.length, 1);
        assert.equal(calls[0], MDI_INDEX_PATH);
        assert.equal(firstIndex, secondIndex);
        assert.equal(getMdiIndexState(), 'ready');
        assert.equal(getMdiIndexVersion(), '7.4.47');
        assert.equal(firstIndex.icons.thermometer, 'F050F');
    });

    it('preloads without exposing a rejecting promise', () => {
        stubFetch(async () => {
            throw new Error('boom');
        });

        assert.doesNotThrow(() => preloadMdiIconIndex());
    });

    it('degrades to the empty index when the request rejects', async () => {
        const calls = stubFetch(async () => {
            throw new Error('offline');
        });

        assert.equal(await loadMdiIconIndex(), EMPTY_MDI_INDEX);
        assert.equal(getMdiIndexState(), 'failed');
        assert.equal(await loadMdiIconIndex(), EMPTY_MDI_INDEX);
        assert.equal(calls.length, 1, 'a failed load must not retry');
    });

    it('degrades when the response is not ok', async () => {
        stubFetch(async () => ({ ok: false, status: 404, json: async () => FAKE_INDEX }));

        assert.equal(await loadMdiIconIndex(), EMPTY_MDI_INDEX);
        assert.equal(getMdiIndexState(), 'failed');
    });

    it('degrades when the payload is not JSON', async () => {
        stubFetch(async () => ({
            ok: true,
            json: async () => {
                throw new SyntaxError('Unexpected token');
            },
        }));

        assert.equal(await loadMdiIconIndex(), EMPTY_MDI_INDEX);
        assert.equal(getMdiIndexState(), 'failed');
    });

    it('degrades when the payload has the wrong shape', async () => {
        stubFetch(async () => ({ ok: true, json: async () => ({ version: '7.4.47' }) }));

        assert.equal(await loadMdiIconIndex(), EMPTY_MDI_INDEX);
        assert.equal(getMdiIndexState(), 'failed');
    });

    it('degrades when fetch is unavailable', async () => {
        globalThis.fetch = undefined;

        assert.equal(await loadMdiIconIndex(), EMPTY_MDI_INDEX);
        assert.equal(getMdiIndexState(), 'failed');
    });
});

describe('shipped index satisfies the module contract', () => {
    it('parses the committed artifact', async () => {
        const originalFetch = globalThis.fetch;
        resetMdiIconIndexCache();
        globalThis.fetch = async () => ({ ok: true, json: async () => readRealIndex() });

        try {
            const index = await loadMdiIconIndex();

            assert.ok(Object.keys(index.icons).length >= 7400);
            assert.equal(index.icons.thermometer, 'F050F');
            assert.equal(index.aliases.user, 'account');
            assert.equal(index.version, '7.4.47');
            assert.equal(getMdiIndexVersion(), '7.4.47');
        } finally {
            globalThis.fetch = originalFetch;
            resetMdiIconIndexCache();
        }
    });
});
