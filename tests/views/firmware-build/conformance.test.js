// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    createOptions,
    createRuntime,
    createStore,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const viewPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'js', 'views', 'firmware-build-view.ts');
const panelPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'js', 'views', 'firmware-packages-panel.ts');
const inventoryPanelPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'js', 'views', 'firmware-inventory-panel.ts');
const progressBarPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'js', 'views', 'progress-bar-view.ts');
const cssPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'styles', 'standard', 'firmware-build-view.css');
const themesPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'styles', 'themes.json');

const readView = () => readFileSync(viewPath, 'utf8');
const readPanel = () => readFileSync(panelPath, 'utf8');
const readInventoryPanel = () => readFileSync(inventoryPanelPath, 'utf8');
const readProgressBar = () => readFileSync(progressBarPath, 'utf8');
const readCss = () => readFileSync(cssPath, 'utf8');

describe('firmware-build-view conformance', () => {
    it('creates no raw select or pre, and only the package checkbox input', () => {
        const viewSrc = readView();
        const panelSrc = readPanel();
        assert.equal(/document\.createElement\(['"]select['"]\)/.test(viewSrc), false);
        assert.equal(/document\.createElement\(['"]pre['"]\)/.test(viewSrc), false);
        const viewInputs = viewSrc.match(/document\.createElement\(['"]input['"]\)/g) ?? [];
        assert.equal(viewInputs.length, 0, 'expected the view to own no raw input');
        const panelInputs = panelSrc.match(/document\.createElement\(['"]input['"]\)/g) ?? [];
        assert.equal(
            panelInputs.length,
            1,
            'expected exactly the package checkbox input (the archive picker is server-side now)'
        );
        assert.match(panelSrc, /checkbox\.type\s*=\s*['"]checkbox['"]/);
    });

    it('writes no inline styles, no innerHTML, and disables via setDisabled except the package checkbox', () => {
        const viewSrc = readView();
        const panelSrc = readPanel();
        assert.equal(/\.style\./.test(viewSrc), false);
        assert.equal(/innerHTML\s*=/.test(viewSrc), false);
        assert.equal((viewSrc.match(/\.disabled\s*=/g) ?? []).length, 0);
        assert.equal(/\.style\./.test(panelSrc), false);
        assert.equal(/innerHTML\s*=/.test(panelSrc), false);
        const panelDisabled = panelSrc.match(/\.disabled\s*=/g) ?? [];
        assert.equal(panelDisabled.length, 1, 'expected only the package checkbox direct disabled write');
        assert.match(panelSrc, /checkbox\.disabled\s*=/);
    });

    it('keeps the inventory panel free of inline styles, innerHTML, and direct disabled writes', () => {
        const inventorySrc = readInventoryPanel();
        assert.equal(/\.style\./.test(inventorySrc), false);
        assert.equal(/innerHTML\s*=/.test(inventorySrc), false);
        assert.equal((inventorySrc.match(/\.disabled\s*=/g) ?? []).length, 0);
    });

    it('keeps the shared progress readout free of inline styles, innerHTML, and direct disabled writes', () => {
        const barSrc = readProgressBar();
        assert.equal(/\.style\./.test(barSrc), false);
        assert.equal(/innerHTML\s*=/.test(barSrc), false);
        assert.equal((barSrc.match(/\.disabled\s*=/g) ?? []).length, 0);
    });

    it('keeps the shared progress readout text-only: no progress element is built', () => {
        const barSrc = readProgressBar();
        assert.equal(
            /createElement\(\s*['"]progress['"]\s*\)/.test(barSrc),
            false,
            'a styled native <progress> is invisible in Blink/WebKit and full in Gecko — the readout stays text-only'
        );
    });

    it('is registered in the standard theme manifest', () => {
        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        assert.ok(manifest.styles.includes('firmware-build-view'));
        assert.ok(existsSync(cssPath));
    });

    it('has full class parity between the source and the stylesheet', () => {
        const src = `${readView()}\n${readPanel()}\n${readInventoryPanel()}`;
        const css = readCss();

        const classes = new Set();
        const sourceClasses = src.match(/firmware-build-view__[a-z0-9-]+/g) ?? [];
        for (const cls of sourceClasses) {
            classes.add(cls);
        }

        for (const cls of classes) {
            assert.ok(css.includes(`.${cls}`), `missing CSS rule for .${cls}`);
        }

        const cssClasses = new Set((css.match(/\.firmware-build-view__[a-z0-9-]+/g) ?? []).map((c) => c.slice(1)));
        for (const cls of cssClasses) {
            assert.ok(classes.has(cls), `CSS selector .${cls} has no source class`);
        }
    });

    it('renders the composed shared views', async () => {
        const { dom, container } = setupDom();
        global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, boards: [] }) });
        try {
            const view = new FirmwareBuildView(
                createOptions({ store: createStore(readySnapshot()), runtime: createRuntime() })
            );
            view.attachTo(container);
            await tick();
            await tick();

            assert.ok(container.querySelector('.collapsible-view'));
            assert.ok(container.querySelector('.data-table-view'));
            assert.ok(container.querySelector('.view-code'));
            assert.ok(container.querySelector('.view-toolbar'));
            assert.ok(container.querySelector('.progress-bar-view'));
            assert.ok(container.querySelector('.custom-control__button'));
            view.detach();
        } finally {
            teardownDom({ dom, container });
        }
    });

    it('keeps the firmware test suites free of positional indexes and selector maps', () => {
        const dir = path.join(repoRoot, 'tests', 'views', 'firmware-build');
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.test.js')) {
                continue;
            }
            const text = readFileSync(path.join(dir, file), 'utf8');
            assert.equal(
                /querySelectorAll\([^)]*\)\s*\[\s*\d+\s*\]/.test(text),
                false,
                `${file} uses a positional querySelectorAll index`
            );
            assert.equal(/sel\s*=\s*\{/.test(text), false, `${file} defines a selector map`);
            assert.equal(/firmware-build-view-test-helpers\.js/.test(text), false, `${file} imports the deleted helper`);
        }
    });
});
