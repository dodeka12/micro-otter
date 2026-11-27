// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Source-level contract for hosted mode: the server monitor is gated, the Firmware tab picks its
// offline body through one helper, `index.html` carries no inline code, and the startup feature
// probes use no dynamic evaluation. Assertions use stable substrings, never line numbers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Read one repository file.
 * @param {...string} segments Path segments below the repository root.
 * @returns {string} File contents.
 */
function readSource(...segments) {
    return readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

/**
 * Count the occurrences of a fixed substring.
 * @param {string} source Text to search.
 * @param {string} needle Fixed substring.
 * @returns {number} Occurrence count.
 */
function countOccurrences(source, needle) {
    return source.split(needle).length - 1;
}

const mainSource = readSource('src', 'micro_otter', 'nodes', 'html', 'js', 'app', 'main.ts');
const firmwareSource = readSource(
    'src',
    'micro_otter',
    'nodes',
    'html',
    'js',
    'views',
    'firmware-build-view.ts'
);
const indexSource = readSource('src', 'micro_otter', 'nodes', 'index.html');
const featureSource = readSource(
    'src',
    'micro_otter',
    'nodes',
    'html',
    'js',
    'core',
    'feature-requirements.ts'
);

describe('main.ts — hosted gating', () => {
    it('imports the build-mode flag', () => {
        assert.match(mainSource, /import \{ isHostedBuild \} from '\.\.\/core\/build-mode\.js';/);
    });

    it('constructs the server monitor only outside a hosted build', () => {
        assert.match(
            mainSource,
            /if \(!isHostedBuild\(\)\) \{\s*this\.serverConnection = new ServerConnectionMonitor\(\{[\s\S]*?\}\);\s*\} else \{\s*this\.serverConnection = null;\s*\}/
        );
    });

    it('states the three consequences of the guard', () => {
        const guard = mainSource.indexOf('if (!isHostedBuild())');
        assert.ok(guard >= 0, 'the guard is present');
        const context = mainSource.slice(Math.max(0, guard - 400), guard);
        for (const phrase of ['capability probe', 'badge', 'reconnect dialog']) {
            assert.ok(
                context.includes(phrase),
                `the comment above the guard names "${phrase}"`
            );
        }
    });
});

describe('firmware-build-view.ts — hosted notice', () => {
    it('picks the offline body key in exactly one helper', () => {
        assert.match(firmwareSource, /_offlineBodyKey\(\): string \{/);
        assert.equal(countOccurrences(firmwareSource, "'firmwareBuild.hosted.body'"), 1);
        assert.equal(countOccurrences(firmwareSource, "'firmwareBuild.offline.body'"), 1);
    });

    it('renders every offline body through the helper', () => {
        const sites = countOccurrences(firmwareSource, 'this._offlineBodyMarkdown()');
        assert.ok(sites >= 3, `expected at least three body sites, found ${sites}`);
        assert.equal(
            countOccurrences(firmwareSource, "setMarkdown(this.t('firmwareBuild.offline.body'))"),
            0,
            'no site bypasses the helper'
        );
    });

    it('renders no capability diagnostics in a hosted build', () => {
        assert.match(
            firmwareSource,
            /_renderOfflineDiagnostics\(\): void \{[\s\S]*?if \(isHostedBuild\(\)\) \{[\s\S]*?return;/
        );
    });

    it('appends the install link only when a docs url was built in', () => {
        assert.match(firmwareSource, /getHostedDocsUrl\(\)/);
        assert.match(firmwareSource, /'firmwareBuild\.hosted\.installLink'/);
    });
});

describe('index.html — no inline code', () => {
    it('has no style element', () => {
        assert.doesNotMatch(indexSource, /<style[\s>]/);
    });

    it('has no script without a src attribute', () => {
        const tags = indexSource.match(/<script\b[^>]*>/g) ?? [];
        assert.ok(tags.length > 0, 'the page still loads its scripts');
        for (const tag of tags) {
            assert.match(tag, /\ssrc=/, `script tag needs a src: ${tag}`);
        }
    });

    it('loads the splash module above the app module', () => {
        const splash = indexSource.indexOf('html/js/app/initial-loading.js');
        const main = indexSource.indexOf('html/js/app/main.js');
        assert.ok(splash >= 0, 'the splash module is referenced');
        assert.ok(main >= 0, 'the app module is referenced');
        assert.ok(splash < main, 'document order runs the splash bootstrap first');
        assert.match(
            indexSource,
            /<script type="module" src="html\/js\/app\/initial-loading\.js"><\/script>/
        );
    });

    it('links the extracted initial-loading stylesheet after the splash styles', () => {
        const splashStyles = indexSource.indexOf('html/styles/standard/splash-screen.css');
        const initialStyles = indexSource.indexOf('html/styles/standard/initial-loading.css');
        assert.ok(initialStyles > splashStyles, 'the reset follows the splash stylesheet');
    });
});

describe('feature-requirements.ts — no dynamic evaluation', () => {
    it('probes the syntax without eval', () => {
        assert.equal(featureSource.includes('eval('), false);
    });

    it('keeps the three probes registered', () => {
        for (const name of ["['Async/Await'", "['ES6 Classes'", "['Arrow Functions'"]) {
            assert.ok(featureSource.includes(name), `${name} stays in the required map`);
        }
    });
});
