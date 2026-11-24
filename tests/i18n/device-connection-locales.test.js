// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const localeDir = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'locales');

/**
 * Read one shipped locale file.
 * @param {string} code Locale code (`en` or `de`).
 */
function loadLocale(code) {
    return JSON.parse(readFileSync(path.join(localeDir, `${code}.json`), 'utf8'));
}

/**
 * Collect every leaf key path of a locale subtree.
 * @param {object} tree Locale subtree.
 * @param {string} prefix Accumulated key prefix.
 */
function collectPaths(tree, prefix = '') {
    const paths = [];
    for (const [key, value] of Object.entries(tree)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            paths.push(...collectPaths(value, full));
        } else {
            paths.push(full);
        }
    }
    return paths.sort();
}

const en = loadLocale('en');
const de = loadLocale('de');

describe('device connection locale parity', () => {
    it('keeps the workspace.device keys identical', () => {
        assert.deepEqual(collectPaths(en.workspace.device), collectPaths(de.workspace.device));
    });

    it('keeps the deviceConnection keys identical', () => {
        assert.deepEqual(collectPaths(en.deviceConnection), collectPaths(de.deviceConnection));
    });

    it('carries the percent placeholder in both loading labels', () => {
        for (const locale of [en, de]) {
            assert.match(locale.workspace.device.loading, /\{\{percent\}\}/);
            assert.match(locale.workspace.device.loadingTitle, /\{\{percent\}\}/);
        }
    });

    it('translates every workspace.device label', () => {
        for (const key of collectPaths(en.workspace.device)) {
            const enValue = key.split('.').reduce((node, part) => node[part], en.workspace.device);
            const deValue = key.split('.').reduce((node, part) => node[part], de.workspace.device);
            assert.equal(typeof enValue, 'string', `en workspace.device.${key} must be a string`);
            assert.equal(typeof deValue, 'string', `de workspace.device.${key} must be a string`);
            assert.notEqual(deValue, '', `de workspace.device.${key} must not be empty`);
        }
    });
});
