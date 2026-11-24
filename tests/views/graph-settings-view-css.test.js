// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Structural tests for the graph settings stylesheet.
 *
 * The event-signal styling regressed once because a missing closing brace nested the
 * signal/error/warning rules inside the `:focus-visible` block. These tests keep the file
 * parseable and assert the reusable multi-select sizing rules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const htmlRoot = path.resolve(testDir, '../../src/micro_otter/nodes/html');
const stylesheetPath = path.join(htmlRoot, 'styles/standard/graph-settings-view.css');
const css = fs.readFileSync(stylesheetPath, 'utf8');

/**
 * Count opening and closing braces in a CSS fragment.
 * @param {string} fragment - CSS text to inspect.
 * @returns {{opens: number, closes: number}} Brace counts.
 */
function countBraces(fragment) {
    return {
        opens: fragment.match(/\{/g)?.length ?? 0,
        closes: fragment.match(/\}/g)?.length ?? 0,
    };
}

describe('graph settings stylesheet', () => {
    it('keeps its braces balanced', () => {
        const { opens, closes } = countBraces(css);

        assert.ok(opens > 0, 'Expected at least one CSS rule');
        assert.equal(closes, opens, 'Every opened block must be closed');
    });

    it('closes the focus-visible rule before the signal-control rules', () => {
        const focusIndex = css.indexOf('.view-graph-settings__select:focus-visible');
        const signalControlIndex = css.indexOf('.view-graph-settings__signal-control');

        assert.ok(focusIndex !== -1, 'Expected the select focus-visible rule');
        assert.ok(signalControlIndex !== -1, 'Expected the signal-control rules');
        assert.ok(
            signalControlIndex > focusIndex,
            'The signal-control rules must follow the focus-visible rule'
        );

        const { opens, closes } = countBraces(css.slice(focusIndex, signalControlIndex));
        assert.equal(
            closes,
            opens,
            'The focus-visible block must be closed so the later rules are not nested'
        );
    });

    it('sizes the signal multi-select to the form width', () => {
        assert.match(
            css,
            /\.view-graph-settings__signal-control \.dropdown-control--labeled\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px[^}]*width:\s*100%/
        );
        assert.match(
            css,
            /\.view-graph-settings__signal-control \.dropdown-control__label\s*\{[^}]*flex:\s*0 0 120px/
        );
        assert.match(
            css,
            /\.view-graph-settings__signal-control \.dropdown-control__button\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/
        );
    });

    it('does not flex the bare dropdown root inside the signal control', () => {
        assert.doesNotMatch(
            css,
            /\.view-graph-settings__signal-control \.dropdown-control\s*\{[^}]*display:\s*flex/
        );
    });

    it('sizes the settings split to its content instead of a fixed host height', () => {
        assert.match(
            css,
            /\.view-graph-settings__split-host\s*\{[^}]*display:\s*flex[^}]*flex:\s*1 1 auto/
        );
        assert.match(
            css,
            /\.view-graph-settings__split-host > \.split-view\s*\{[^}]*height:\s*auto[^}]*flex:\s*0 0 auto/
        );
        assert.match(
            css,
            /\.view-graph-settings__split-host > \.split-view > \.split-view__pane\s*\{[^}]*flex-grow:\s*0 !important/
        );
        assert.match(
            css,
            /\.view-graph-settings__split-host > \.split-view > \.split-view__splitter\s*\{[^}]*pointer-events:\s*none/
        );
    });

    it('no longer carries the removed signature preview rules', () => {
        assert.doesNotMatch(css, /\.view-graph-settings__function-preview/);
    });
});
