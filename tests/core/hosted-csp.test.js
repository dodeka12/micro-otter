// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Contract for the hosted Content-Security-Policy: a strict policy injected as a `<meta>` into the
// built `index.html`, and nothing at all in a local build.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HOSTED_CSP_POLICY, hostedCspPlugin } from '../../tools/vite-hosted-csp.mjs';

const SAMPLE_HTML = '<!DOCTYPE html><html><head></head><body></body></html>';

describe('hosted CSP plugin', () => {
    it('is a no-op for a local build', () => {
        const plugin = hostedCspPlugin({ hosted: false });
        assert.equal(plugin.name, 'micro-otter-hosted-csp');
        assert.equal(plugin.transformIndexHtml(SAMPLE_HTML), undefined);
    });

    it('is a no-op when created without options', () => {
        assert.equal(hostedCspPlugin().transformIndexHtml(SAMPLE_HTML), undefined);
    });

    it('injects exactly one CSP meta at the start of the head', () => {
        const result = hostedCspPlugin({ hosted: true }).transformIndexHtml(SAMPLE_HTML);

        assert.equal(result.html, SAMPLE_HTML, 'the plugin only adds a tag');
        assert.equal(result.tags.length, 1);
        const [tag] = result.tags;
        assert.equal(tag.tag, 'meta');
        assert.equal(tag.attrs['http-equiv'], 'Content-Security-Policy');
        assert.equal(tag.attrs.content, HOSTED_CSP_POLICY);
        assert.equal(tag.injectTo, 'head-prepend');
    });

    it('ships the exact policy the docs describe', () => {
        assert.equal(
            HOSTED_CSP_POLICY,
            "default-src 'self'; script-src 'self'; style-src 'self'; " +
                "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
                "base-uri 'none'; form-action 'none'; object-src 'none'"
        );
    });

    it('carries no inline or eval allowance and no framing directive', () => {
        assert.doesNotMatch(HOSTED_CSP_POLICY, /unsafe-inline/);
        assert.doesNotMatch(HOSTED_CSP_POLICY, /unsafe-eval/);
        assert.doesNotMatch(
            HOSTED_CSP_POLICY,
            /frame-ancestors/,
            'frame-ancestors is ignored in a meta tag and belongs to server configuration'
        );
    });
});
