// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OPEN_SOURCE_PACKAGES } from '../../src/micro_otter/nodes/html/js/core/app-meta.js';

const OVERRIDES_PATH = path.resolve('tools/open-source-package-overrides.json');
const ICONS_LICENSE_PATH = path.resolve('src/micro_otter/nodes/html/icons/LICENSE');
const WORKFLOW_DOC_PATH = path.resolve('docs/workflow/adding-icons.md');
const MATERIAL_SYMBOLS_NAME = 'Google Material Symbols';

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
}

const overrides = readJson(OVERRIDES_PATH);
const vendoredAssets = Array.isArray(overrides.vendoredAssets) ? overrides.vendoredAssets : [];

function findAsset(pattern) {
    return vendoredAssets.find((asset) => pattern.test(asset.name));
}

describe('vendored icon assets', () => {
    it('declares vendoredAssets next to the package override map', () => {
        assert.ok(
            Array.isArray(overrides.vendoredAssets),
            'tools/open-source-package-overrides.json needs a "vendoredAssets" array: the SVGs we ' +
                'download are not npm packages, so the dependency scan cannot find them'
        );
        assert.ok(vendoredAssets.length > 0, 'vendoredAssets must not be empty');
    });

    it('keeps the npm package overrides untouched', () => {
        for (const packageId of ['marked', 'prismjs', '@mdi/font']) {
            const entry = overrides[packageId];

            assert.ok(entry, `${packageId} must keep its override entry`);
            assert.ok(entry.license, `${packageId} needs a license`);
            assert.match(entry.url, /^https:\/\//, `${packageId} needs an https url`);
        }
    });

    it('attributes Google Material Symbols as Apache-2.0 at the licence source', () => {
        const asset = findAsset(/Material Symbols/);

        assert.ok(asset, 'the Material Symbols icon set must be attributed');
        assert.equal(asset.name, MATERIAL_SYMBOLS_NAME);
        assert.match(asset.license, /^Apache-2\.0/, 'Material Symbols is Apache-2.0');
        assert.match(
            asset.url,
            /^https:\/\/github\.com\/google\/material-design-icons/,
            'the row must link to where the Apache-2.0 licence lives'
        );
    });

    it('gives every vendored asset a name, a licence and an https url', () => {
        for (const asset of vendoredAssets) {
            assert.ok(asset.name, `vendored asset ${JSON.stringify(asset)} needs a name`);
            assert.ok(asset.license, `${asset.name} needs a license`);
            assert.match(asset.url, /^https:\/\//, `${asset.name} needs an https url`);
        }
    });
});

describe('About-dialog attribution rows', () => {
    it('shows every vendored asset in the generated list', () => {
        for (const asset of vendoredAssets) {
            const row = OPEN_SOURCE_PACKAGES.find((entry) => entry.name === asset.name);

            assert.ok(row, `${asset.name} is missing from OPEN_SOURCE_PACKAGES`);
            assert.equal(row.license, asset.license);
            assert.equal(row.url, asset.url);
        }
    });

    it('keeps the npm package rows', () => {
        for (const name of ['marked', 'PrismJS', 'Material Design Icons (MDI)']) {
            assert.ok(
                OPEN_SOURCE_PACKAGES.some((entry) => entry.name === name),
                `${name} must stay in the About dialog`
            );
        }
    });

    it('sorts rows by display name without duplicates', () => {
        const names = OPEN_SOURCE_PACKAGES.map((entry) => entry.name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));

        assert.deepEqual(names, sorted, 'rows must stay sorted by display name');
        assert.equal(new Set(names).size, names.length, 'display names must be unique');
    });
});

describe('Material Symbols licence notice', () => {
    it('ships an Apache-2.0 notice inside the icon directory', () => {
        assert.ok(
            existsSync(ICONS_LICENSE_PATH),
            'src/micro_otter/nodes/html/icons/LICENSE must be committed next to the icons'
        );

        const notice = readFileSync(ICONS_LICENSE_PATH, 'utf-8');

        assert.match(notice, /Apache License/);
        assert.match(notice, /Version 2\.0/);
        assert.match(notice, /Material Symbols/, 'the notice must name the icons it covers');
    });

    it('declares the modification we made to the downloaded SVGs', () => {
        const notice = readFileSync(ICONS_LICENSE_PATH, 'utf-8');

        assert.match(
            notice,
            /fill="#e3e3e3"/,
            'Apache-2.0 section 4(b) requires modified files to carry prominent notices'
        );
        assert.match(notice, /github\.com\/google\/material-design-icons/);
    });
});

describe('icon workflow documentation', () => {
    it('covers both icon sets and both destinations', () => {
        assert.ok(existsSync(WORKFLOW_DOC_PATH), 'docs/workflow/adding-icons.md must exist');

        const doc = readFileSync(WORKFLOW_DOC_PATH, 'utf-8');

        assert.match(doc, /Google Material Symbols/);
        assert.match(doc, /Material Design Icons/);
        assert.ok(
            doc.includes('src/micro_otter/nodes/html/icons/'),
            'the app-level icon destination must be spelled out'
        );
        assert.ok(
            doc.includes('node_pkgs/<package>/icons/'),
            'the node-package icon destination must be spelled out'
        );
    });

    it('keeps the Home Assistant MDI font path separate from the SVG workflow', () => {
        const doc = readFileSync(WORKFLOW_DOC_PATH, 'utf-8');

        assert.match(doc, /mdi:</, 'the hass entity icon grammar must be explained');
        assert.match(doc, /html\/vendor\/mdi/);
    });

    it('does not leave the superseded Google-only pages behind', () => {
        for (const staleFile of [
            'docs/workflow/adding-material-icons.md',
            'docs/workflow/adding-material-icons-to-node-packages.md',
        ]) {
            assert.equal(
                existsSync(path.resolve(staleFile)),
                false,
                `${staleFile} was merged into docs/workflow/adding-icons.md`
            );
        }
    });
});
