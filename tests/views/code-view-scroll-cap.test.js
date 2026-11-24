// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file CodeView height-cap contract
 *
 * The log boxes of the Firmware tab cap the view with `max-height` instead of
 * giving it a height, and `.view-code` is `overflow: hidden`. A cap that does not
 * reach the scrolling wrapper therefore does not scroll the text, it deletes it:
 * `height: 100%` inside an auto-height host resolves to `auto`, so the wrapper
 * grows with its text, never overflows, and everything past the cap is clipped
 * away with no scrollbar to reach it. jsdom has no layout, so the contract is
 * asserted against the stylesheets.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stylesRoot = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/micro_otter/nodes/html/styles/standard'
);

/**
 * Return the declaration block of the first rule whose selector list is exactly
 * *selectors*, ignoring comments and collapsing whitespace.
 */
function ruleBody(css, selectors) {
    const wanted = selectors.join(',').replace(/\s+/g, '');
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of withoutComments.matchAll(rulePattern)) {
        const found = match[1].replace(/\s+/g, '');
        if (found === wanted) {
            return match[2];
        }
    }
    return null;
}

/** Read one declaration out of a declaration block. */
function declaration(body, property) {
    const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i');
    const match = pattern.exec(body);
    return match ? match[1].trim() : null;
}

describe('CodeView height cap', () => {
    const codeViewCss = fs.readFileSync(path.join(stylesRoot, 'code-view.css'), 'utf8');
    const firmwareCss = fs.readFileSync(
        path.join(stylesRoot, 'firmware-build-view.css'),
        'utf8'
    );

    it('passes a host height cap on to the scrolling wrapper', () => {
        const body = ruleBody(codeViewCss, ['.view-code__scroll-wrapper']);
        assert.ok(body, '.view-code__scroll-wrapper must have its own rule');
        assert.equal(
            declaration(body, 'max-height'),
            'inherit',
            'the wrapper must inherit the cap of .view-code, or the cap clips the text'
        );
        assert.equal(
            declaration(body, 'overflow-y'),
            'auto',
            'the wrapper is the element that scrolls the text'
        );
    });

    it('keeps clipping the outer box, so the cap is never a page-level overflow', () => {
        const body = ruleBody(codeViewCss, ['.view-code']);
        assert.ok(body, '.view-code must have its own rule');
        assert.equal(declaration(body, 'overflow'), 'hidden');
    });

    it('caps the Firmware log boxes, which is what the wrapper inherits', () => {
        const body = ruleBody(firmwareCss, [
            '.firmware-build-view__build-log .view-code',
            '.firmware-build-view__deploy-log .view-code',
            '.firmware-build-view__inventory-log-lines .view-code',
        ]);
        assert.ok(body, 'the Firmware log boxes must cap their CodeView');
        assert.equal(declaration(body, 'max-height'), '240px');
    });
});
