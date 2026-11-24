// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FIRMWARE_ERROR_CODES } from '../../src/micro_otter/nodes/html/js/firmware/firmware-job-state.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const localeDir = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'locales');
const jsRoot = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'js');

function loadLocale(code) {
    return JSON.parse(readFileSync(path.join(localeDir, `${code}.json`), 'utf8'));
}

function collectPaths(obj, prefix = '') {
    const paths = [];
    for (const [key, value] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            paths.push(...collectPaths(value, full));
        } else {
            paths.push(full);
        }
    }
    return paths;
}

function placeholders(value) {
    if (typeof value !== 'string') {
        return [];
    }
    return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

describe('firmwareBuild locale parity', () => {
    const en = loadLocale('en').firmwareBuild;
    const de = loadLocale('de').firmwareBuild;

    it('has a firmwareBuild tree in both locales', () => {
        assert.ok(en);
        assert.ok(de);
    });

    it('has identical key paths in en and de', () => {
        const enPaths = collectPaths(en).sort();
        const dePaths = collectPaths(de).sort();
        assert.deepEqual(dePaths, enPaths);
    });

    it('has identical placeholders per key', () => {
        for (const keyPath of collectPaths(en)) {
            const enValue = keyPath.split('.').reduce((o, k) => o?.[k], en);
            const deValue = keyPath.split('.').reduce((o, k) => o?.[k], de);
            assert.deepEqual(placeholders(deValue), placeholders(enValue), keyPath);
        }
    });

    it('names the frozen variant in both locales', () => {
        assert.equal(en.inventory?.detailsVariant, 'Variant');
        assert.equal(de.inventory?.detailsVariant, 'Variante');
        assert.equal(en.build?.packages, 'Packages');
        assert.equal(de.build?.packages, 'Pakete');
    });

    it('names the binary-import copy in both locales', () => {
        const keys = [
            'imported',
            'importedHint',
            'importTargetTitle',
            'importTargetMessage',
            'importTargetLabel',
            'detailsOriginalFile',
            'detailsImportTarget',
            'importedNotice',
        ];
        for (const key of keys) {
            assert.equal(typeof en.inventory?.[key], 'string', `en firmwareBuild.inventory.${key}`);
            assert.equal(typeof de.inventory?.[key], 'string', `de firmwareBuild.inventory.${key}`);
        }
        assert.equal(en.errors?.noTarget, 'No buildable platform is available for this runtime.');
        assert.equal(
            de.errors?.noTarget,
            'Für diese Runtime ist keine baubare Plattform verfügbar.'
        );
        assert.notEqual(en.inventory.imported, de.inventory.imported);
        assert.notEqual(en.inventory.importedHint, de.inventory.importedHint);
        assert.ok(en.inventory.importFromUrlMessage.includes('.bin'));
        assert.ok(de.inventory.importFromUrlMessage.includes('.bin'));
    });

    it('words an exact image differently from one that only includes the selection', () => {
        for (const [code, tree] of [
            ['en', en],
            ['de', de],
        ]) {
            const exact = tree.build?.matchingFirmware;
            const superset = tree.build?.matchingFirmwareSuperset;
            assert.equal(
                typeof superset,
                'string',
                `${code}: firmwareBuild.build.matchingFirmwareSuperset`
            );
            assert.notEqual(
                superset,
                exact,
                `${code}: a superset image must not reuse the exact-match wording`
            );
        }
    });

    it('has no empty values and no key-equals-own-path values', () => {
        for (const keyPath of collectPaths(en)) {
            const value = keyPath.split('.').reduce((o, k) => o?.[k], en);
            assert.notEqual(value, '', keyPath);
            assert.notEqual(value, keyPath, keyPath);
        }
    });

    it('has the Installed add-ons action strings in both locales', () => {
        const keys = [
            'install',
            'remove',
            'cancel',
            'installConfirmTitle',
            'installConfirm',
            'removeConfirmTitle',
            'removeConfirm',
            'archiveInvalid',
            'archiveTooLarge',
            'installSummary',
            'removeSummary',
        ];
        for (const [code, tree] of [
            ['en', en],
            ['de', de],
        ]) {
            for (const key of keys) {
                const value = tree.addons?.[key];
                assert.equal(typeof value, 'string', `${code}: firmwareBuild.addons.${key}`);
                assert.ok(
                    value.trim().length > 0,
                    `${code}: firmwareBuild.addons.${key} is blank`
                );
            }
        }
    });

    it('interpolates {{names}} in both remove-confirmation strings', () => {
        assert.match(en.addons.removeConfirm, /\{\{names\}\}/);
        assert.match(de.addons.removeConfirm, /\{\{names\}\}/);
    });

    it('words the add-on action strings in German, not English', () => {
        for (const key of [
            'install',
            'remove',
            'cancel',
            'removeConfirmTitle',
            'archiveInvalid',
            'installSummary',
            'removeSummary',
            'installFromUrl',
        ]) {
            assert.notEqual(de.addons[key], en.addons[key], `firmwareBuild.addons.${key}`);
        }
    });

    it('has the Help body Markdown in both locales', () => {
        for (const [code, tree] of [
            ['en', en],
            ['de', de],
        ]) {
            const value = tree.help?.body;
            assert.equal(typeof value, 'string', `${code}: firmwareBuild.help.body`);
            assert.ok(value.trim().length > 0, `${code}: firmwareBuild.help.body is blank`);
            assert.match(value, /^## /, `${code}: firmwareBuild.help.body starts with a heading`);
        }
    });

    it('has the offline explainer Markdown in both locales', () => {
        for (const [code, tree] of [
            ['en', en],
            ['de', de],
        ]) {
            const value = tree.offline?.body;
            assert.equal(typeof value, 'string', `${code}: firmwareBuild.offline.body`);
            assert.ok(value.trim().length > 0, `${code}: firmwareBuild.offline.body is blank`);
            assert.match(value, /^## /, `${code}: firmwareBuild.offline.body starts with a heading`);
        }
    });

    it('has the doctor diagnostic strings in both locales', () => {
        for (const [code, tree] of [
            ['en', en],
            ['de', de],
        ]) {
            for (const key of ['hint', 'backend', 'noReason', 'noBackend']) {
                const value = tree.doctor?.[key];
                assert.equal(typeof value, 'string', `${code}: firmwareBuild.doctor.${key}`);
                assert.ok(value.trim().length > 0, `${code}: firmwareBuild.doctor.${key} is blank`);
            }
            assert.deepEqual(
                placeholders(tree.doctor.backend),
                ['backend', 'reason'],
                `${code}: firmwareBuild.doctor.backend must name the backend and the reason`
            );
        }
    });

    it('keeps the server-reported reason untranslated in doctor.backend', () => {
        assert.equal(en.doctor.backend, '{{backend}}: {{reason}}');
        assert.equal(de.doctor.backend, '{{backend}}: {{reason}}');
    });

    it('translates the doctor strings that are not a server reason', () => {
        for (const key of ['hint', 'noReason', 'noBackend']) {
            assert.notEqual(de.doctor[key], en.doctor[key], `firmwareBuild.doctor.${key}`);
        }
    });

    it('carries no key for the deleted server-state chrome', () => {
        for (const code of ['en', 'de']) {
            const tree = loadLocale(code).firmwareBuild;
            assert.equal(tree.state, undefined, `${code}: firmwareBuild.state is dead chrome`);
            assert.equal(tree.notice, undefined, `${code}: firmwareBuild.notice is dead chrome`);
            assert.equal(tree.serverVersion, undefined, `${code}: firmwareBuild.serverVersion is dead chrome`);
            assert.equal(
                tree.offline?.title,
                undefined,
                `${code}: the folded offline section reuses firmwareBuild.help.title`
            );
            for (const key of ['title', 'help', 'doctor', 'offline']) {
                assert.ok(tree[key], `${code}: firmwareBuild.${key} must survive the cleanup`);
            }
        }
    });
});

describe('firmwareBuild error-code locale coverage', () => {
    const en = loadLocale('en').firmwareBuild;
    const de = loadLocale('de').firmwareBuild;

    it('has a locale entry for every reducer error code', () => {
        for (const code of FIRMWARE_ERROR_CODES) {
            assert.ok(en.errors?.[code], `missing en firmwareBuild.errors.${code}`);
            assert.ok(de.errors?.[code], `missing de firmwareBuild.errors.${code}`);
        }
    });

    it('translates the same code set in both locales', () => {
        assert.deepEqual(
            Object.keys(de.errors).sort(),
            Object.keys(en.errors).sort(),
            'a code translated in one language only'
        );
        for (const code of FIRMWARE_ERROR_CODES) {
            assert.notEqual(
                de.errors[code],
                en.errors[code],
                `firmwareBuild.errors.${code} is not translated`
            );
        }
    });
});

describe('firmwareBuild source key references', () => {
    const en = loadLocale('en');

    function resolveKey(keyPath) {
        return keyPath.split('.').reduce((value, part) => value?.[part], en);
    }

    function collectKeyReferences() {
        const files = [
            path.join(jsRoot, 'views', 'firmware-build-view.ts'),
            path.join(jsRoot, 'views', 'firmware-inventory-panel.ts'),
            path.join(jsRoot, 'views', 'firmware-packages-panel.ts'),
            path.join(jsRoot, 'views', 'file-picker-dialog-view.ts'),
            path.join(jsRoot, 'firmware', 'firmware-job-state.ts'),
            path.join(jsRoot, 'firmware', 'firmware-inventory.ts'),
        ];
        const keys = new Set();
        for (const file of files) {
            const content = readFileSync(file, 'utf8');
            const regex = /firmwareBuild\.[A-Za-z0-9_.-]+/g;
            for (const match of content.matchAll(regex)) {
                const key = match[0];
                // A trailing dot means a template literal follows (dynamic key).
                if (key.endsWith('.')) {
                    continue;
                }
                keys.add(key);
            }
        }
        return keys;
    }

    it('every firmwareBuild.* key literal referenced in source exists in en.json', () => {
        for (const key of collectKeyReferences()) {
            assert.notEqual(resolveKey(key), undefined, `missing en locale key: ${key}`);
        }
    });
});

