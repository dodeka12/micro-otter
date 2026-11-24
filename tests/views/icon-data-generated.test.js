// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { INLINED_ICONS } from '../../src/micro_otter/nodes/html/js/views/icon-data.generated.js';
import {
    inlineEntries,
    readRegistryEntries,
} from '../../tools/generate-inlined-icons.mjs';

const ICONS_DIR = path.resolve('src/micro_otter/nodes/html/icons');
const URI_PREFIX = 'data:image/svg+xml;base64,';

/** Registry entries whose file extension is `.svg`. */
const svgEntries = readRegistryEntries().filter((entry) => entry.file.endsWith('.svg'));

/**
 * Strip the prolog that precedes the SVG root element in the stored files.
 * @param {string} text File contents as UTF-8 text.
 * @returns {string} Text starting at the root element.
 */
function stripLeadingProlog(text) {
    const pattern = /^(?:\s+|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![Dd][Oo][Cc][Tt][Yy][Pp][Ee][^>]*>)+/;
    let rest = text.replace(/^\uFEFF/, '');
    for (;;) {
        const next = rest.replace(pattern, '');
        if (next === rest) {
            return rest;
        }
        rest = next;
    }
}

describe('inlined app icon module', () => {
    it('covers every registered SVG file and nothing else', () => {
        assert.ok(svgEntries.length > 0, 'the registry must register SVG files');
        for (const entry of svgEntries) {
            assert.equal(
                Object.prototype.hasOwnProperty.call(INLINED_ICONS, entry.name),
                true,
                `${entry.name} (${entry.file}) must have an inlined entry`
            );
        }

        const svgNames = new Set(svgEntries.map((entry) => entry.name));
        for (const key of Object.keys(INLINED_ICONS)) {
            assert.equal(svgNames.has(key), true, `${key} must map to a registered SVG file`);
        }
    });

    it('skips the PNG/ICO brand images', () => {
        for (const entry of readRegistryEntries().filter((item) => !item.file.endsWith('.svg'))) {
            assert.equal(
                Object.prototype.hasOwnProperty.call(INLINED_ICONS, entry.name),
                false,
                `${entry.name} (${entry.file}) must stay URL based`
            );
        }
    });

    it('holds base64 SVG documents behind the svg+xml prefix', () => {
        for (const [key, value] of Object.entries(INLINED_ICONS)) {
            assert.equal(value.startsWith(URI_PREFIX), true, `${key} must use the svg+xml prefix`);
            const decoded = Buffer.from(value.slice(URI_PREFIX.length), 'base64').toString('utf8');
            assert.equal(
                stripLeadingProlog(decoded).slice(0, 4).toLowerCase(),
                '<svg',
                `${key} must decode to an SVG document`
            );
        }
    });

    it('matches the registered files byte for byte', () => {
        const regenerated = inlineEntries(readRegistryEntries());
        assert.deepEqual(INLINED_ICONS, Object.freeze(regenerated));

        for (const entry of svgEntries) {
            const filePath = path.join(ICONS_DIR, entry.file);
            assert.equal(existsSync(filePath), true, `missing icon asset ${entry.file}`);
            assert.deepEqual(
                Buffer.from(INLINED_ICONS[entry.name].slice(URI_PREFIX.length), 'base64'),
                readFileSync(filePath),
                `${entry.name} must inline the current ${entry.file}`
            );
        }
    });
});
