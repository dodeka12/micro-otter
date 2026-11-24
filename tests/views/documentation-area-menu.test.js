import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createDocumentationAreaMenuItems } from '../../src/micro_otter/nodes/html/js/views/documentation-area-menu.js';

const AREA = {
    id: '7',
    title: 'Doc',
    markdown: 'body',
    color: '#4a90d9',
    contentAlign: 'top',
    fontSize: 'normal',
    bounds: { x: 0, y: 0, width: 320, height: 200 },
};

function createContext(overrides = {}) {
    const calls = [];
    const actions = new Proxy(
        {},
        {
            get: (_target, name) => (...args) => {
                calls.push({ action: name, areaId: args[0], fontSize: args[1] });
            },
        }
    );

    return {
        calls,
        context: {
            area: AREA,
            isEditing: false,
            hasClipboardData: false,
            selectedNodeCount: 0,
            t: (key, fallback) => fallback,
            actions,
            ...overrides,
        },
    };
}

function itemIds(items) {
    return items.map((item) => (item.type === 'separator' ? '|' : item.id));
}

describe('createDocumentationAreaMenuItems', () => {
    it('returns the documented ids with separators in place', () => {
        const { context } = createContext();

        assert.deepEqual(itemIds(createDocumentationAreaMenuItems(context)), [
            'edit',
            'color',
            'rename',
            '|',
            'alignTop',
            'alignBottom',
            'fontSize',
            '|',
            'cut',
            'copy',
            'paste',
            'duplicate',
            '|',
            'fit',
            'delete',
        ]);
    });

    it('uses registered IconProvider assets for every item', () => {
        const { context } = createContext();

        const items = createDocumentationAreaMenuItems(context).filter((item) => item.icon);

        assert.equal(items.length, 12);
        for (const item of items) {
            assert.ok(item.icon, `${item.id} needs an icon`);
            assert.equal(typeof item.icon, 'string');
        }
    });

    it('disables the alignment that is already active', () => {
        const top = createDocumentationAreaMenuItems(createContext().context);
        assert.equal(top.find((item) => item.id === 'alignTop').disabled, true);
        assert.equal(top.find((item) => item.id === 'alignBottom').disabled, false);

        const bottom = createDocumentationAreaMenuItems(
            createContext({ area: { ...AREA, contentAlign: 'bottom' } }).context
        );
        assert.equal(bottom.find((item) => item.id === 'alignTop').disabled, false);
        assert.equal(bottom.find((item) => item.id === 'alignBottom').disabled, true);
    });

    it('offers a font-size submenu and disables the active preset', () => {
        for (const fontSize of ['small', 'normal', 'large']) {
            const { context, calls } = createContext({ area: { ...AREA, fontSize } });
            const row = createDocumentationAreaMenuItems(context).find(
                (item) => item.id === 'fontSize'
            );

            assert.equal(row.type, 'menuview');
            assert.deepEqual(
                row.menu.items.map((item) => item.id),
                ['fontSizeSmall', 'fontSizeNormal', 'fontSizeLarge']
            );
            for (const item of row.menu.items) {
                const expectedDisabled =
                    item.id === `fontSize${fontSize[0].toUpperCase()}${fontSize.slice(1)}`;
                assert.equal(item.disabled, expectedDisabled, `${fontSize}:${item.id}`);
            }

            row.menu.items.find((item) => item.id === 'fontSizeLarge').action();
            assert.deepEqual(calls, [
                { action: 'setFontSize', areaId: '7', fontSize: 'large' },
            ]);
        }
    });

    it('treats a malformed stored preset as Normal', () => {
        const { context } = createContext({ area: { ...AREA, fontSize: 'sideways' } });
        const row = createDocumentationAreaMenuItems(context).find(
            (item) => item.id === 'fontSize'
        );

        assert.equal(row.menu.items.find((item) => item.id === 'fontSizeNormal').disabled, true);
        assert.equal(row.menu.items.find((item) => item.id === 'fontSizeSmall').disabled, false);
        assert.equal(row.menu.items.find((item) => item.id === 'fontSizeLarge').disabled, false);
    });

    it('disables paste without clipboard data and fit without a node selection', () => {
        const { context } = createContext();

        const items = createDocumentationAreaMenuItems(context);
        const paste = items.find((item) => item.id === 'paste');
        const fit = items.find((item) => item.id === 'fit');

        assert.equal(paste.disabled, true);
        assert.equal(fit.disabled, true);

        const enabled = createDocumentationAreaMenuItems({
            ...context,
            hasClipboardData: true,
            selectedNodeCount: 2,
        });
        assert.equal(enabled.find((item) => item.id === 'paste').disabled, false);
        assert.equal(enabled.find((item) => item.id === 'fit').disabled, false);
    });

    it('flips the edit label between Edit and Done', () => {
        const { context } = createContext();

        assert.equal(
            createDocumentationAreaMenuItems(context).find((item) => item.id === 'edit').label,
            'Edit'
        );
        assert.equal(
            createDocumentationAreaMenuItems({ ...context, isEditing: true }).find(
                (item) => item.id === 'edit'
            ).label,
            'Done'
        );
    });

    it('routes every action through the shared dispatch table', () => {
        const { context, calls } = createContext();

        for (const item of createDocumentationAreaMenuItems(context)) {
            item.action?.();
        }

        assert.deepEqual(
            calls.map((entry) => entry.action),
            [
                'edit',
                'changeColor',
                'rename',
                'alignContent',
                'alignContent',
                'cut',
                'copy',
                'paste',
                'duplicate',
                'fitToSelection',
                'remove',
            ]
        );
        for (const entry of calls) {
            assert.equal(entry.areaId, '7');
        }
    });

    it('builds independent arrays with no shared mutable state', () => {
        const first = createDocumentationAreaMenuItems(createContext().context);
        const second = createDocumentationAreaMenuItems(
            createContext({ isEditing: true, hasClipboardData: true }).context
        );

        assert.notEqual(first, second);
        assert.notEqual(first[0], second[0]);
        assert.equal(first[0].label, 'Edit');
        assert.equal(second[0].label, 'Done');
    });

    it('resolves labels through the injected translator', () => {
        const seen = [];
        const { context } = createContext({
            t: (key, fallback) => {
                seen.push(key);
                return `x:${fallback}`;
            },
        });

        const items = createDocumentationAreaMenuItems(context);

        assert.ok(seen.includes('documentationArea.menu.edit'));
        assert.ok(seen.includes('documentationArea.menu.fitToSelection'));
        assert.equal(items[0].label, 'x:Edit');
    });
});

describe('documentationArea locale namespace', () => {
    const keysOf = (value, prefix = '') =>
        Object.entries(value).flatMap(([key, entry]) => {
            const path = prefix ? `${prefix}.${key}` : key;
            return entry && typeof entry === 'object' && !Array.isArray(entry)
                ? keysOf(entry, path)
                : [path];
        });

    const readNamespace = (locale) => {
        const data = JSON.parse(
            fs.readFileSync(`src/micro_otter/nodes/html/locales/${locale}.json`, 'utf8')
        );
        return data.documentationArea ?? null;
    };

    it('exists in both shipped locales with identical keys', () => {
        const en = readNamespace('en');
        const de = readNamespace('de');

        assert.ok(en, 'en.json must contain documentationArea');
        assert.ok(de, 'de.json must contain documentationArea');
        assert.deepEqual(keysOf(de).sort(), keysOf(en).sort());
    });

    it('covers every label the menu builder requests', () => {
        const en = readNamespace('en');

        for (const key of [
            'untitled',
            'menuButton',
            'placeholder',
            'duplicateTitle',
            'menu.edit',
            'menu.done',
            'menu.color',
            'menu.rename',
            'menu.alignTop',
            'menu.alignBottom',
            'menu.fontSize',
            'menu.fontSizeSmall',
            'menu.fontSizeNormal',
            'menu.fontSizeLarge',
            'menu.cut',
            'menu.copy',
            'menu.paste',
            'menu.duplicate',
            'menu.fitToSelection',
            'menu.delete',
        ]) {
            const value = key.split('.').reduce((node, part) => node?.[part], en);
            assert.equal(typeof value, 'string', `documentationArea.${key} is missing`);
            assert.ok(value.length > 0, `documentationArea.${key} must not be empty`);
        }
    });
});
