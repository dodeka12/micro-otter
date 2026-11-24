// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { I18nService } from '../../src/micro_otter/nodes/html/js/i18n/i18n-service.js';

/**
 * Mock fetch for testing without network requests
 * @param {object} responses - Map of URL to the fake response to return
 */
function mockFetch(responses) {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (url, _options) => {
        const response = responses[url];
        if (!response) {
            return Promise.resolve({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });
        }
        
        if (response.error) {
            return Promise.reject(new Error(response.error));
        }
        
        return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () => Promise.resolve(response.data),
        });
    };
    
    return () => {
        globalThis.fetch = originalFetch;
    };
}

test('I18nService constructor initializes with defaults', () => {
    const service = new I18nService();
    
    assert.equal(service.currentLocale, 'en');
    assert.equal(service.loaded, false);
    assert.deepEqual(service.availableLocales, []);
});

test('I18nService constructor accepts custom options', () => {
    const service = new I18nService({
        manifestPath: '/custom/path/locales.json',
        defaultLocale: 'de',
        initialLocale: 'fr',
    });
    
    assert.equal(service.currentLocale, 'de');
    assert.equal(service.loaded, false);
});

test('I18nService loads manifest successfully', async () => {
    const mockManifest = {
        defaultLocale: 'en',
        locales: [
            { code: 'en', label: 'English', file: 'en.json', icon: 'icon-en.svg' },
            { code: 'de', label: 'Deutsch', file: 'de.json', icon: 'icon-de.svg' },
        ],
    };
    
    const mockEnTranslations = {
        dialog: {
            confirm: 'Confirm',
            cancel: 'Cancel',
        },
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockEnTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        assert.equal(service.loaded, true);
        assert.equal(service.currentLocale, 'en');
        assert.equal(service.availableLocales.length, 2);
        assert.equal(service.availableLocales[0].code, 'en');
        assert.equal(service.availableLocales[1].code, 'de');
    } finally {
        restore();
    }
});

test('I18nService uses initialLocale when provided', async () => {
    const mockManifest = {
        defaultLocale: 'en',
        locales: [
            { code: 'en', label: 'English', file: 'en.json' },
            { code: 'de', label: 'Deutsch', file: 'de.json' },
        ],
    };
    
    const mockDeTranslations = {
        dialog: {
            confirm: 'Bestätigen',
        },
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/de.json': { data: mockDeTranslations },
    });
    
    try {
        const service = new I18nService({ initialLocale: 'de' });
        await service.load();
        
        assert.equal(service.currentLocale, 'de');
    } finally {
        restore();
    }
});

test('I18nService rejects invalid manifest (missing locales array)', async () => {
    const restore = mockFetch({
        '/html/locales/locales.json': { data: {} },
    });
    
    try {
        const service = new I18nService();
        await assert.rejects(
            () => service.load(),
            /Locale manifest missing required "locales" array/
        );
    } finally {
        restore();
    }
});

test('I18nService rejects invalid manifest (empty locales array)', async () => {
    const restore = mockFetch({
        '/html/locales/locales.json': { data: { locales: [] } },
    });
    
    try {
        const service = new I18nService();
        await assert.rejects(
            () => service.load(),
            /Locale manifest contains no locales/
        );
    } finally {
        restore();
    }
});

test('I18nService rejects invalid locale entry (missing code)', async () => {
    const restore = mockFetch({
        '/html/locales/locales.json': {
            data: {
                locales: [
                    { file: 'en.json' },
                ],
            },
        },
    });
    
    try {
        const service = new I18nService();
        await assert.rejects(
            () => service.load(),
            /Invalid locale entry: missing required "code" or "file" property/
        );
    } finally {
        restore();
    }
});

test('I18nService setLocale changes locale and dispatches event', async () => {
    const mockManifest = {
        locales: [
            { code: 'en', label: 'English', file: 'en.json' },
            { code: 'de', label: 'Deutsch', file: 'de.json' },
        ],
    };
    
    const mockEnTranslations = { test: 'Test EN' };
    const mockDeTranslations = { test: 'Test DE' };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockEnTranslations },
        '/html/locales/de.json': { data: mockDeTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        let eventFired = false;
        let eventDetail = null;
        
        service.addEventListener('languagechange', (event) => {
            eventFired = true;
            eventDetail = event.detail;
        });
        
        await service.setLocale('de');
        
        assert.equal(service.currentLocale, 'de');
        assert.equal(eventFired, true);
        assert.equal(eventDetail.locale, 'de');
        assert.equal(eventDetail.previousLocale, 'en');
    } finally {
        restore();
    }
});

test('I18nService setLocale caches translations', async () => {
    const mockManifest = {
        locales: [
            { code: 'en', label: 'English', file: 'en.json' },
            { code: 'de', label: 'Deutsch', file: 'de.json' },
        ],
    };
    
    const mockEnTranslations = { test: 'Test EN' };
    const mockDeTranslations = { test: 'Test DE' };
    
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url) => {
        fetchCount++;
        const responses = {
            '/html/locales/locales.json': mockManifest,
            '/html/locales/en.json': mockEnTranslations,
            '/html/locales/de.json': mockDeTranslations,
        };
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(responses[url]),
        });
    };
    
    try {
        const service = new I18nService();
        await service.load(); // Loads manifest + en.json (2 fetches)
        fetchCount = 0;
        
        await service.setLocale('de'); // Loads de.json (1 fetch)
        assert.equal(fetchCount, 1);
        
        await service.setLocale('en'); // Uses cache (0 fetches)
        assert.equal(fetchCount, 1);
        
        await service.setLocale('de'); // Uses cache (0 fetches)
        assert.equal(fetchCount, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('I18nService setLocale falls back to default for unknown locale', async () => {
    const mockManifest = {
        locales: [
            { code: 'en', label: 'English', file: 'en.json' },
        ],
    };
    
    const mockEnTranslations = { test: 'Test EN' };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockEnTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        const result = await service.setLocale('fr');
        assert.equal(result, 'en');
        assert.equal(service.currentLocale, 'en');
    } finally {
        restore();
    }
});

test('I18nService mergeTranslations dispatches languagechange and language-changed', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };

    const mockTranslations = {
        dialog: {
            confirm: 'Confirm',
        },
    };

    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });

    try {
        const service = new I18nService();
        await service.load();

        let languageChangeEvent = null;
        let languageChangedEvent = null;

        service.addEventListener('languagechange', (event) => {
            languageChangeEvent = event.detail;
        });
        service.addEventListener('language-changed', (event) => {
            languageChangedEvent = event.detail;
        });

        service.mergeTranslations('en', {
            generalRuntime: {
                customView: {
                    title: 'General Runtime Configuration',
                },
            },
        });

        assert.equal(
            service.t('generalRuntime.customView.title'),
            'General Runtime Configuration'
        );
        assert.deepEqual(languageChangeEvent, {
            locale: 'en',
            previousLocale: 'en',
        });
        assert.deepEqual(languageChangedEvent, {
            language: 'en',
            previousLanguage: 'en',
        });
    } finally {
        restore();
    }
});

test('I18nService t() translates simple keys', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };
    
    const mockTranslations = {
        welcome: 'Welcome',
        goodbye: 'Goodbye',
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        assert.equal(service.t('welcome'), 'Welcome');
        assert.equal(service.t('goodbye'), 'Goodbye');
    } finally {
        restore();
    }
});

test('I18nService t() supports nested keys with dot notation', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };
    
    const mockTranslations = {
        dialog: {
            confirm: 'Confirm',
            cancel: 'Cancel',
            buttons: {
                ok: 'OK',
            },
        },
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        assert.equal(service.t('dialog.confirm'), 'Confirm');
        assert.equal(service.t('dialog.cancel'), 'Cancel');
        assert.equal(service.t('dialog.buttons.ok'), 'OK');
    } finally {
        restore();
    }
});

test('I18nService t() resolves flat dotted translation keys', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };

    const mockTranslations = {
        'generalRuntime.customView.title': 'General Runtime Configuration',
        'generalRuntime.customView.description': 'Configure runtime settings',
    };

    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });

    try {
        const service = new I18nService();
        await service.load();

        assert.equal(
            service.t('generalRuntime.customView.title'),
            'General Runtime Configuration'
        );
        assert.equal(
            service.t('generalRuntime.customView.description'),
            'Configure runtime settings'
        );
    } finally {
        restore();
    }
});

test('I18nService t() interpolates variables', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };
    
    const mockTranslations = {
        greeting: 'Hello, {{name}}!',
        itemCount: 'You have {{count}} items',
        multiple: '{{user}} has {{count}} messages',
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        assert.equal(service.t('greeting', { name: 'Alice' }), 'Hello, Alice!');
        assert.equal(service.t('itemCount', { count: 5 }), 'You have 5 items');
        assert.equal(
            service.t('multiple', { user: 'Bob', count: 3 }),
            'Bob has 3 messages'
        );
    } finally {
        restore();
    }
});

test('I18nService t() returns key if not found', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };
    
    const mockTranslations = {
        existing: 'Value',
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        assert.equal(service.t('nonexistent'), 'nonexistent');
        assert.equal(service.t('also.missing'), 'also.missing');
    } finally {
        restore();
    }
});

test('I18nService t() falls back to default locale', async () => {
    const mockManifest = {
        defaultLocale: 'en',
        locales: [
            { code: 'en', label: 'English', file: 'en.json' },
            { code: 'de', label: 'Deutsch', file: 'de.json' },
        ],
    };
    
    const mockEnTranslations = {
        common: 'Common String',
        englishOnly: 'English Only',
    };
    
    const mockDeTranslations = {
        common: 'Gemeinsame Zeichenfolge',
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockEnTranslations },
        '/html/locales/de.json': { data: mockDeTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        await service.setLocale('de');
        
        // Key exists in German
        assert.equal(service.t('common'), 'Gemeinsame Zeichenfolge');
        
        // Key only exists in English (default), should fall back
        assert.equal(service.t('englishOnly'), 'English Only');
    } finally {
        restore();
    }
});

test('I18nService t() handles invalid key types gracefully', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };
    
    const mockTranslations = { test: 'Test' };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        assert.equal(service.t(null), '');
        assert.equal(service.t(undefined), '');
        // For non-string types, the service returns them as-is
        const numResult = service.t(123);
        assert.equal(numResult, 123);
        const objResult = service.t({});
        assert.equal(typeof objResult, 'object');
    } finally {
        restore();
    }
});

test('I18nService does not dispatch event when setting same locale', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };
    
    const mockTranslations = { test: 'Test' };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        let eventCount = 0;
        service.addEventListener('languagechange', () => {
            eventCount++;
        });
        
        await service.setLocale('en');
        
        assert.equal(eventCount, 0);
    } finally {
        restore();
    }
});

test('I18nService setLocale throws error if manifest not loaded', async () => {
    const service = new I18nService();
    
    await assert.rejects(
        () => service.setLocale('en'),
        /Manifest not loaded. Call load\(\) first./
    );
});

test('I18nService handles nested params in interpolation', async () => {
    const mockManifest = {
        locales: [{ code: 'en', label: 'English', file: 'en.json' }],
    };
    
    const mockTranslations = {
        message: '{{name}} at {{location}}',
    };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        // Params object should convert to string
        const result = service.t('message', { 
            name: 'Alice', 
            location: 'Home' 
        });
        assert.equal(result, 'Alice at Home');
        
        // Undefined params should remain as placeholders
        const partial = service.t('message', { name: 'Bob' });
        assert.equal(partial, 'Bob at {{location}}');
    } finally {
        restore();
    }
});

test('I18nService uses manifest default locale if specified', async () => {
    const mockManifest = {
        defaultLocale: 'de',
        locales: [
            { code: 'en', label: 'English', file: 'en.json' },
            { code: 'de', label: 'Deutsch', file: 'de.json' },
        ],
    };
    
    const mockDeTranslations = { test: 'Test DE' };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/de.json': { data: mockDeTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        assert.equal(service.currentLocale, 'de');
    } finally {
        restore();
    }
});

test('I18nService falls back to first locale if default not found', async () => {
    const mockManifest = {
        defaultLocale: 'fr',
        locales: [
            { code: 'en', label: 'English', file: 'en.json' },
            { code: 'de', label: 'Deutsch', file: 'de.json' },
        ],
    };
    
    const mockEnTranslations = { test: 'Test EN' };
    
    const restore = mockFetch({
        '/html/locales/locales.json': { data: mockManifest },
        '/html/locales/en.json': { data: mockEnTranslations },
    });
    
    try {
        const service = new I18nService();
        await service.load();
        
        // Should use first locale (en) since default (fr) doesn't exist
        assert.equal(service.currentLocale, 'en');
    } finally {
        restore();
    }
});

describe('controls.iconPicker locale keys', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const localeRoot = path.resolve(testDir, '../../src/micro_otter/nodes/html/locales');

    function readLocale(name) {
        return JSON.parse(fs.readFileSync(path.join(localeRoot, `${name}.json`), 'utf8'));
    }

    function collectKeyPaths(value, prefix = '') {
        if (!value || typeof value !== 'object') {
            return [prefix];
        }
        return Object.entries(value).flatMap(([key, child]) =>
            collectKeyPaths(child, prefix ? `${prefix}.${key}` : key)
        );
    }

    it('keeps the key sets identical across en and de', () => {
        const en = readLocale('en').controls?.iconPicker;
        const de = readLocale('de').controls?.iconPicker;
        assert.ok(en, 'en.json must define controls.iconPicker');
        assert.ok(de, 'de.json must define controls.iconPicker');
        assert.deepEqual(collectKeyPaths(de).sort(), collectKeyPaths(en).sort());
    });

    it('defines every picker string in both locales', () => {
        const expected = ['hint', 'loading', 'unavailable', 'noMatches', 'count', 'clear', 'unknown'];
        for (const name of ['en', 'de']) {
            const picker = readLocale(name).controls?.iconPicker || {};
            for (const key of expected) {
                assert.equal(typeof picker[key], 'string', `${name} iconPicker.${key} missing`);
                assert.ok(
                    picker[key].trim().length > 0,
                    `${name} iconPicker.${key} must not be empty`
                );
            }
        }
    });

    it('keeps no English text in the German strings', () => {
        const de = readLocale('de').controls.iconPicker;
        for (const [key, value] of Object.entries(de)) {
            assert.doesNotMatch(value, /\b(Loading|Clear|No icons match)\b/, `de.${key}`);
        }
    });

    it('keeps the interpolation placeholders in both locales', () => {
        const placeholders = {
            noMatches: '{{query}}',
            count: ['{{shown}}', '{{total}}'],
            unknown: '{{version}}',
        };
        for (const name of ['en', 'de']) {
            const picker = readLocale(name).controls.iconPicker;
            for (const [key, expected] of Object.entries(placeholders)) {
                const tokens = Array.isArray(expected) ? expected : [expected];
                for (const token of tokens) {
                    assert.ok(picker[key].includes(token), `${name}.${key} must keep ${token}`);
                }
            }
        }
    });
});
