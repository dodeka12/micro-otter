// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Inline the registered app icons so the editor keeps rendering them when the
// server is gone. `IconProvider.get()` answers a `data:` URI from the generated
// module; the URL form stays available through `IconProvider.getPath()`.
//
// Run with `npm run generate:icons`; `npm run check:icons-generated` fails when
// the checked-in module is stale. Add an icon to `ICON_REGISTRY` and rerun.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = process.cwd();

export const PATHS = {
    iconProvider: path.join(ROOT, 'src', 'micro_otter', 'nodes', 'html', 'js', 'views', 'icon-provider.ts'),
    iconsDir: path.join(ROOT, 'src', 'micro_otter', 'nodes', 'html', 'icons'),
    output: path.join(ROOT, 'src', 'micro_otter', 'nodes', 'html', 'js', 'views', 'icon-data.generated.js'),
};

/**
 * MIME type per inlined file extension.
 *
 * Only `.svg` files are inlined today; the PNG/ICO entries exist so the table
 * documents why the brand images stay URL based.
 */
export const MIME_BY_EXTENSION = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const REGISTRY_START = 'const ICON_REGISTRY = {';
const REGISTRY_END = '} as const;';
const ENTRY_PATTERN = /^\s*([A-Za-z0-9_]+):\s*'([^']+)',?$/gm;

/**
 * Read the `ICON_REGISTRY` table from `icon-provider.ts`.
 *
 * Reading the TypeScript source keeps one single source of truth: the generator
 * never maintains a second list that could drift from the runtime registry.
 * @returns {{name: string, file: string}[]} Registry entries in source order.
 * @throws {Error} When the registry slice or its entries cannot be read.
 */
export function readRegistryEntries() {
    const source = fs.readFileSync(PATHS.iconProvider, 'utf-8');
    const start = source.indexOf(REGISTRY_START);
    const end = start === -1 ? -1 : source.indexOf(REGISTRY_END, start);

    if (start === -1 || end === -1) {
        throw new Error(
            `Could not locate the ICON_REGISTRY object in ${path.relative(ROOT, PATHS.iconProvider)}.`
        );
    }

    const slice = source.slice(start, end);
    const entries = [];
    for (const match of slice.matchAll(ENTRY_PATTERN)) {
        entries.push({ name: match[1], file: match[2] });
    }

    if (entries.length === 0) {
        throw new Error(
            `ICON_REGISTRY in ${path.relative(ROOT, PATHS.iconProvider)} has no readable entries.`
        );
    }

    return entries;
}

/**
 * Strip everything that may precede an SVG root element.
 *
 * The stored documents vary: some start with a comment, others with an XML
 * declaration plus an Illustrator comment. Whitespace and every leading
 * declaration, doctype, or comment is skipped so the SVG check looks at the root
 * element. The inlined bytes stay untouched.
 * @param {string} text - File contents as UTF-8 text.
 * @returns {string} Text starting at the first element.
 */
function stripLeadingProlog(text) {
    const pattern = /^(?:\s+|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![Dd][Oo][Cc][Tt][Yy][Pp][Ee][^>]*>)+/;
    let rest = text;
    for (;;) {
        const next = rest.replace(pattern, '');
        if (next === rest) {
            return rest;
        }
        rest = next;
    }
}

/**
 * Build the inlined `data:` URI for one registry entry.
 *
 * The stored documents carry a leading SPDX comment or an XML declaration, so the
 * SVG check skips the prolog before looking for the root element. The bytes that
 * are inlined are the untouched file bytes, so the URI is a byte-for-byte copy.
 * @param {{name: string, file: string}} entry - Registry entry to encode.
 * @returns {string} `data:<mime>;base64,<payload>` for an SVG file.
 * @throws {Error} When the SVG file is missing or does not hold an SVG document.
 */
function inlineEntry(entry) {
    const filePath = path.join(PATHS.iconsDir, entry.file);
    const mime = MIME_BY_EXTENSION[path.extname(entry.file)];
    if (!mime) {
        throw new Error(
            `Icon '${entry.name}' points at '${entry.file}', whose extension is not in MIME_BY_EXTENSION.`
        );
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`Icon '${entry.name}' points at a missing file: ${entry.file}`);
    }

    const buffer = fs.readFileSync(filePath);
    const root = stripLeadingProlog(buffer.toString('utf-8').replace(/^\uFEFF/, ''));
    if (root.slice(0, 4).toLowerCase() !== '<svg') {
        throw new Error(`Icon '${entry.name}' does not hold an SVG document: ${entry.file}`);
    }

    return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Inline every registry entry that is an SVG document.
 *
 * Brand images (`.png`, `.ico`) are deliberately skipped: they are large binary
 * assets that the offline `<img>` path does not need, so `get()` keeps answering
 * a URL for them (D8).
 * @param {{name: string, file: string}[]} entries - Registry entries in source order.
 * @returns {Record<string, string>} Inlined icons keyed by registry name.
 * @throws {Error} When an SVG file is missing or unreadable as SVG.
 */
export function inlineEntries(entries) {
    const map = {};
    entries.forEach((entry) => {
        if (path.extname(entry.file) !== '.svg') {
            return;
        }
        map[entry.name] = inlineEntry(entry);
    });
    return map;
}

/**
 * Render the generated ES module.
 * @param {Record<string, string>} map - Icons to emit.
 * @returns {string} Module source, keys sorted for a stable diff.
 */
export function renderModule(map) {
    const lines = Object.keys(map)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => `    ${key}: '${map[key]}',`);

    return [
        '// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only',
        '// This file is auto-generated by tools/generate-inlined-icons.mjs',
        '// Do not edit by hand. Add the icon to ICON_REGISTRY and rerun the generator.',
        '',
        '/**',
        ' * Registered app icons inlined as `data:` URIs.',
        ' *',
        ' * `IconProvider.get()` answers these values so an `<img>` keeps rendering after the',
        ' * server is gone; `IconProvider.getPath()` answers the URL form. Brand PNG/ICO',
        ' * images have no entry here and stay URL based.',
        ' * @type {Readonly<Record<string, string>>}',
        ' */',
        'export const INLINED_ICONS = Object.freeze({',
        ...lines,
        '});',
        '',
    ].join('\n');
}

/**
 * Regenerate the inlined icon module, writing it only when the bytes differ.
 * @returns {{count: number, written: boolean}} Emitted icon count and write state.
 */
export function main() {
    const map = inlineEntries(readRegistryEntries());
    const count = Object.keys(map).length;
    const source = renderModule(map);
    const current = fs.existsSync(PATHS.output) ? fs.readFileSync(PATHS.output, 'utf-8') : null;

    if (current === source) {
        console.log(`${count} icons up to date`);
        return { count, written: false };
    }

    fs.writeFileSync(PATHS.output, source, 'utf-8');
    console.log(`Wrote ${count} icons`);
    return { count, written: true };
}

const invokedDirectly =
    Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
