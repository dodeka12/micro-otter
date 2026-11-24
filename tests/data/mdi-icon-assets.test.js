import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const VENDOR_DIR = path.resolve('src/micro_otter/nodes/html/vendor/mdi');
const FONT_PATH = path.join(VENDOR_DIR, 'materialdesignicons-webfont.woff2');
const LICENSE_PATH = path.join(VENDOR_DIR, 'LICENSE');
const INDEX_PATH = path.join(VENDOR_DIR, 'icon-index.json');
const OVERRIDES_PATH = path.resolve('tools/open-source-package-overrides.json');
const OSS_MODULE_PATH = path.resolve(
    'src/micro_otter/nodes/html/js/core/open-source-packages.generated.js'
);

const EXPECTED_VERSION = '7.4.47';
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;

function readJson(relativeOrAbsolutePath) {
    return JSON.parse(readFileSync(relativeOrAbsolutePath, 'utf-8'));
}

const packageJson = readJson(path.join(ROOT, 'package.json'));

describe('vendored MDI packages are pinned', () => {
    it('declares @mdi/font as an exact runtime dependency', () => {
        const version = (packageJson.dependencies || {})['@mdi/font'];

        assert.ok(version, '@mdi/font must be listed in dependencies');
        assert.match(version, EXACT_SEMVER);
        assert.equal(version, EXPECTED_VERSION);
    });

    it('declares @mdi/svg as an exact dev dependency only', () => {
        const devVersion = (packageJson.devDependencies || {})['@mdi/svg'];

        assert.ok(devVersion, '@mdi/svg must be listed in devDependencies');
        assert.match(devVersion, EXACT_SEMVER);
        assert.equal(devVersion, EXPECTED_VERSION);
        assert.equal(
            (packageJson.dependencies || {})['@mdi/svg'],
            undefined,
            '@mdi/svg is build-time only and must not be a runtime dependency'
        );
    });
});

describe('committed MDI artifacts', () => {
    it('ships the webfont, the licence and the index', () => {
        for (const filePath of [FONT_PATH, LICENSE_PATH, INDEX_PATH]) {
            assert.ok(existsSync(filePath), `${path.basename(filePath)} must be committed`);
        }
    });

    it('ships a woff2 webfont of the expected size', () => {
        const buffer = readFileSync(FONT_PATH);

        assert.equal(buffer.subarray(0, 4).toString('latin1'), 'wOF2');
        assert.ok(buffer.length > 300 * 1024, `woff2 is only ${buffer.length} bytes`);
        assert.equal(statSync(FONT_PATH).size, buffer.length);
    });

    it('ships the Pictogrammers licence text', () => {
        assert.match(readFileSync(LICENSE_PATH, 'utf-8'), /Pictogrammers/);
    });

    it('generates an index that matches the module contract', () => {
        const index = readJson(INDEX_PATH);

        assert.equal(index.version, EXPECTED_VERSION);
        assert.ok(Object.keys(index.icons).length >= 7400);
        assert.equal(index.counts.icons, Object.keys(index.icons).length);
        assert.equal(index.counts.aliases, Object.keys(index.aliases).length);
        assert.equal(index.icons.thermometer, 'F050F');
        assert.equal(index.aliases.user, 'account');
    });

    it('stores every codepoint as an uppercase hex string', () => {
        const index = readJson(INDEX_PATH);

        for (const [name, codepoint] of Object.entries(index.icons)) {
            assert.match(codepoint, /^[0-9A-F]{4,6}$/, `${name} has codepoint '${codepoint}'`);
        }
    });

    it('only aliases icons that exist', () => {
        const index = readJson(INDEX_PATH);

        for (const [alias, target] of Object.entries(index.aliases)) {
            assert.ok(
                Object.prototype.hasOwnProperty.call(index.icons, target),
                `alias '${alias}' points at unknown icon '${target}'`
            );
        }
    });
});

describe('MDI attribution', () => {
    it('has an open-source override entry for @mdi/font', () => {
        const overrides = readJson(OVERRIDES_PATH);
        const entry = overrides['@mdi/font'];

        assert.ok(entry, '@mdi/font needs an entry in tools/open-source-package-overrides.json');
        assert.match(entry.name, /Material Design Icons/);
        assert.match(entry.license, /Apache-2\.0/);
        assert.match(entry.url, /^https:\/\//);
    });

    it('lists MDI in the generated About-dialog module', () => {
        const source = readFileSync(OSS_MODULE_PATH, 'utf-8');

        assert.match(source, /Material Design Icons/);
        assert.match(source, /Apache-2\.0/);
    });
});

describe('MDI npm scripts and CI gate', () => {
    it('declares the generator and the staleness gate', () => {
        assert.equal(packageJson.scripts['generate:mdi'], 'node tools/generate-mdi-icons.mjs');
        assert.match(
            packageJson.scripts['check:mdi-generated'],
            /^npm run generate:mdi && git diff/
        );
        assert.match(
            packageJson.scripts['check:mdi-generated'],
            /src\/micro_otter\/nodes\/html\/vendor\/mdi/
        );
    });

    it('runs the gate from check:ci-local:web', () => {
        assert.match(packageJson.scripts['check:ci-local:web'], /check:mdi-generated/);
        assert.match(packageJson.scripts['check:ci-local'], /check:ci-local:web/);
    });
});
