// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const themesPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'styles', 'themes.json');
const cssPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'styles', 'standard', 'firmware-build-view.css');

const SHARED_COMPONENT_CLASSES = [
    'data-table-view',
    'view-code',
    'collapsible-view',
    'view-toolbar',
    'dropdown-control',
    'custom-control',
];

function readCss() {
    return readFileSync(cssPath, 'utf8');
}

function ruleBody(css, selector) {
    const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : null;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function declarations(css) {
    const results = [];
    const regex = /([a-z-]+)\s*:\s*([^;{}]+);/g;
    let match;
    while ((match = regex.exec(css)) !== null) {
        results.push({ property: match[1], value: match[2].trim() });
    }
    return results;
}

describe('firmware-build-view stylesheet', () => {
    it('is registered in the standard theme manifest', () => {
        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        assert.ok(manifest.styles.includes('firmware-build-view'));
        assert.ok(existsSync(cssPath));
    });

    it('gives the root a flex shell with overflow hidden', () => {
        const body = ruleBody(readCss(), '.firmware-build-view');
        assert.ok(body, 'missing .firmware-build-view rule');
        assert.match(body, /display\s*:\s*flex/);
        assert.match(body, /flex-direction\s*:\s*column/);
        assert.match(body, /overflow\s*:\s*hidden/);
    });

    it('keeps the tab shell free of a whole-view scrollbar', () => {
        const content = ruleBody(readCss(), '.firmware-build-view__content');
        assert.ok(content, 'missing .firmware-build-view__content rule');
        assert.match(content, /overflow\s*:\s*hidden/);
        assert.match(content, /min-height\s*:\s*0/);
    });

    it('gives the split host the flex column layout of a pane stack', () => {
        const splitHost = ruleBody(readCss(), '.firmware-build-view__split-host');
        assert.ok(splitHost, 'missing .firmware-build-view__split-host rule');
        assert.match(splitHost, /flex\s*:\s*1 1 auto/);
        assert.match(splitHost, /min-height\s*:\s*0/);
        assert.match(splitHost, /flex-direction\s*:\s*column/);
        assert.match(splitHost, /overflow\s*:\s*hidden/);
    });

    it('leaves the pane toolbar rows to the shared toolbar', () => {
        const css = readCss();
        assert.equal(ruleBody(css, '.firmware-build-view__build-actions'), null, 'stale header-action row rule');
        assert.equal(ruleBody(css, '.firmware-build-view__deploy-actions'), null, 'stale header-action row rule');
        assert.equal(css.includes('.view-toolbar'), false, 'no toolbar override remains');

        const action = ruleBody(css, '.firmware-build-view__action');
        assert.ok(action, 'missing the control-wrapper rule ToolbarView.addControl() relies on');
        assert.match(action, /display\s*:\s*inline-flex/);
    });

    it('caps the port trigger and its menu so a long by-id name cannot stretch the row', () => {
        const css = readCss();

        const trigger = ruleBody(css, '.firmware-build-view__dropdown--port');
        assert.ok(trigger, 'missing the port trigger width rule');
        const triggerCap = trigger.match(/max-width\s*:\s*([^;]+);/);
        assert.ok(triggerCap, 'the port trigger must declare max-width');
        assert.ok(
            parseFloat(triggerCap[1]) <= 240,
            `the port trigger cap ${triggerCap[1]} is too wide to keep the port row intact`
        );

        const menu = ruleBody(css, '.firmware-build-view__dropdown-menu--port');
        assert.ok(menu, 'missing the port menu width rule');
        const menuCap = menu.match(/max-width\s*:\s*([^;]+);/);
        assert.ok(menuCap, 'the port menu must declare max-width');
        assert.match(menuCap[1], /100vw/, 'the menu cap must shrink with the viewport');
    });

    it('uses theme tokens for every color/background/border declaration', () => {
        const allowedKeywords = new Set(['transparent', 'none', 'inherit', 'initial', 'unset', 'currentColor']);
        const css = readCss();
        for (const { property, value } of declarations(css)) {
            if (!/^(color|background|border)/.test(property)) {
                continue;
            }
            assert.ok(
                value.includes('var(') || allowedKeywords.has(value),
                `.${property} uses a hard-coded value: ${value}`
            );
        }
    });

    it('renders the in-section progress bar with theme tokens only', () => {
        const css = readCss();
        const body = ruleBody(css, '.firmware-inventory__progress-bar');
        assert.ok(body, 'missing .firmware-inventory__progress-bar rule');
        assert.match(body, /background\s*:\s*var\(--mo-/);
    });

    it('highlights the selected row with a distinct token background and accent border', () => {
        const css = readCss();
        const body = ruleBody(css, '.firmware-inventory__row--selected');
        assert.ok(body, 'missing .firmware-inventory__row--selected rule');
        assert.match(body, /background\s*:\s*var\(--mo-surface-3/);
        assert.match(body, /border-left\s*:\s*2px solid var\(--mo-accent/);
    });

    it('carries no rule for the deleted server-state chrome', () => {
        const css = readCss();
        for (const selector of [
            '.firmware-build-view__header',
            '.firmware-build-view__badge',
            '.firmware-build-view__server-version',
            '.firmware-build-view__notice',
            '.firmware-build-view__header-actions',
        ]) {
            assert.equal(ruleBody(css, selector), null, `${selector} is dead chrome`);
        }
        assert.equal(css.includes('data-state'), false, 'the badge state colours go with the badge');
    });

    it('keeps the offline host flexible and its diagnostic rows token-coloured', () => {
        const css = readCss();
        const offline = ruleBody(css, '.firmware-build-view__offline');
        assert.ok(offline, 'missing .firmware-build-view__offline rule');
        assert.match(offline, /flex\s*:\s*1 1 auto/);
        assert.match(offline, /overflow\s*:\s*auto/);
        assert.ok(ruleBody(css, '.firmware-build-view__offline-body'), 'missing the offline body rule');

        const diagnostics = ruleBody(css, '.firmware-build-view__diagnostics');
        assert.ok(diagnostics, 'missing the diagnostic-row list rule');
        assert.match(diagnostics, /flex-direction\s*:\s*column/);
        assert.match(diagnostics, /color\s*:\s*var\(--mo-warning/);

        const diagnostic = ruleBody(css, '.firmware-build-view__diagnostic');
        assert.ok(diagnostic, 'missing the single diagnostic-row rule');
        assert.match(diagnostic, /overflow-wrap\s*:\s*anywhere/);
    });

    it('never styles a shared component class outside the view root', () => {
        const css = readCss();
        const ruleRegex = /([^{}]+)\{/g;
        let match;
        while ((match = ruleRegex.exec(css)) !== null) {
            const selectors = match[1];
            for (const shared of SHARED_COMPONENT_CLASSES) {
                if (selectors.includes(`.${shared}`)) {
                    assert.ok(
                        selectors.includes('.firmware-build-view'),
                        `shared component .${shared} styled without .firmware-build-view scope`
                    );
                }
            }
        }
    });
});
