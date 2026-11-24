// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Vendor the Material Design Icons webfont and generate the compact icon index.
// The icons ship with the app: no CDN, no network at runtime. Only the WOFF2 (all
// modern targets) and the generated name/alias index are committed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = process.cwd();

/**
 * The single place a Material Design Icons bump happens. Home Assistant lags MDI
 * releases, so the version is pinned instead of floating.
 */
export const MDI_VERSION = '7.4.47';

const OUT_DIR = path.join(ROOT, 'src', 'micro_otter', 'nodes', 'html', 'vendor', 'mdi');

export const PATHS = {
    fontFile: path.join(
        ROOT,
        'node_modules',
        '@mdi',
        'font',
        'fonts',
        'materialdesignicons-webfont.woff2'
    ),
    licenseFile: path.join(ROOT, 'node_modules', '@mdi', 'font', 'LICENSE'),
    metaFile: path.join(ROOT, 'node_modules', '@mdi', 'svg', 'meta.json'),
    outDir: OUT_DIR,
    outFontFile: path.join(OUT_DIR, 'materialdesignicons-webfont.woff2'),
    outLicenseFile: path.join(OUT_DIR, 'LICENSE'),
    outIndexFile: path.join(OUT_DIR, 'icon-index.json'),
};

/**
 * Sorted-key object so regenerated output is byte-stable and diff friendly.
 * @param {Record<string, string>} map - Unsorted name/value map.
 * @returns {Record<string, string>} Map with alphabetically sorted keys.
 */
function sortRecord(map) {
    const sorted = {};
    Object.keys(map)
        .sort((a, b) => a.localeCompare(b))
        .forEach((key) => {
            sorted[key] = map[key];
        });
    return sorted;
}

/**
 * Transform the `@mdi/svg` `meta.json` into the compact picker index.
 *
 * Canonical icons are kept even when deprecated: Home Assistant users still have those
 * names in their YAML. Aliases of a deprecated icon are dropped (they are old renames of
 * removed icons), as are aliases whose target icon is unknown.
 * @param {Record<string, {name?: string, codepoint?: string, aliases?: string[], deprecated?: boolean}>} meta
 *   The `@mdi/svg` metadata, keyed by internal id.
 * @returns {{version: string, counts: {icons: number, aliases: number}, icons: Record<string, string>, aliases: Record<string, string>}}
 *   The generated icon index.
 */
export function buildIconIndex(meta) {
    const icons = {};
    const aliases = {};
    const entries = Object.values(meta || {}).filter(
        (entry) =>
            entry &&
            typeof entry.name === 'string' &&
            entry.name.length > 0 &&
            typeof entry.codepoint === 'string' &&
            entry.codepoint.length > 0
    );

    entries.forEach((entry) => {
        icons[entry.name] = entry.codepoint;
    });

    entries.forEach((entry) => {
        if (entry.deprecated) {
            return;
        }
        if (!Object.prototype.hasOwnProperty.call(icons, entry.name)) {
            return;
        }
        const entryAliases = Array.isArray(entry.aliases) ? entry.aliases : [];
        entryAliases.forEach((alias) => {
            if (typeof alias !== 'string' || !alias || alias === entry.name) {
                return;
            }
            aliases[alias] = entry.name;
        });
    });

    const sortedIcons = sortRecord(icons);
    const sortedAliases = sortRecord(aliases);

    return {
        version: MDI_VERSION,
        counts: {
            icons: Object.keys(sortedIcons).length,
            aliases: Object.keys(sortedAliases).length,
        },
        icons: sortedIcons,
        aliases: sortedAliases,
    };
}

/**
 * Write a file only when its bytes differ, so regeneration stays idempotent
 * (`check:mdi-generated` relies on a clean `git diff`).
 * @param {string} filePath - Destination path.
 * @param {Buffer|string} content - Desired content.
 * @returns {boolean} `true` when the file was written.
 */
function writeIfChanged(filePath, content) {
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');

    if (fs.existsSync(filePath)) {
        const current = fs.readFileSync(filePath);
        if (current.equals(next)) {
            return false;
        }
    }

    fs.writeFileSync(filePath, next);
    return true;
}

/**
 * Fail with a readable message when an installed source file is missing, so a broken
 * `npm install` cannot silently ship an empty index.
 * @param {string} filePath - Path that must exist.
 * @param {string} hint - Package that provides the file.
 */
function requireFile(filePath, hint) {
    if (fs.existsSync(filePath)) {
        return;
    }
    throw new Error(
        [
            `Missing MDI source file: ${path.relative(ROOT, filePath)}`,
            '',
            `Run "npm install" so that ${hint} is installed, then retry "npm run generate:mdi".`,
        ].join('\n')
    );
}

export function main() {
    requireFile(PATHS.fontFile, `@mdi/font@${MDI_VERSION}`);
    requireFile(PATHS.licenseFile, `@mdi/font@${MDI_VERSION}`);
    requireFile(PATHS.metaFile, `@mdi/svg@${MDI_VERSION}`);

    const meta = JSON.parse(fs.readFileSync(PATHS.metaFile, 'utf-8'));
    const index = buildIconIndex(meta);

    fs.mkdirSync(PATHS.outDir, { recursive: true });

    const wroteFont = writeIfChanged(PATHS.outFontFile, fs.readFileSync(PATHS.fontFile));
    const wroteLicense = writeIfChanged(PATHS.outLicenseFile, fs.readFileSync(PATHS.licenseFile));
    const wroteIndex = writeIfChanged(PATHS.outIndexFile, JSON.stringify(index));

    const changed = [wroteFont, wroteLicense, wroteIndex].filter(Boolean).length;
    console.log(
        `Generated ${path.relative(ROOT, PATHS.outDir)} with MDI ${MDI_VERSION} ` +
            `(${index.counts.icons} icons, ${index.counts.aliases} aliases, ` +
            `${changed} file(s) updated).`
    );
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
