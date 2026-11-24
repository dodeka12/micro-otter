// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Facade the documentation-area layer calls to render a box body.
 *
 * The layer never imports `marked` or KaTeX directly: this module resolves the browser
 * globals, renders with whatever is currently available and kicks off the lazily loaded
 * KaTeX bundle as soon as a document reports math. That keeps the "render now, upgrade
 * once math support arrives" flow in exactly one place.
 *
 * The first paint therefore never waits for the network: it uses the readable `$…$`
 * fallback and the layer re-renders the math-bearing boxes after `onKatexStateChange`
 * reports `'ready'`.
 */

import { getKatex, getKatexLoadState, loadKaTeX } from './katex-loader.js';
import { renderMarkdown } from './markdown-renderer.js';
import type { MarkdownRenderResult } from './markdown-renderer.js';

/**
 * Render a documentation-area Markdown body with the providers currently available.
 *
 * When the document contains math and KaTeX has not been requested yet, a background load
 * is started. Callers must not await it: the fallback markup is already readable.
 * @param {string} markdown - Raw Markdown stored on the documentation area.
 * @returns {MarkdownRenderResult} Rendered HTML plus the math flags.
 */
export function renderAreaMarkdown(markdown: string): MarkdownRenderResult {
    const result = renderMarkdown(markdown, { katex: getKatex() });

    if (result.hasMath && !result.mathRendered && getKatexLoadState() === 'idle') {
        // Fire and forget: the loader never rejects, and the current fallback stays visible
        // until the layer re-renders on the state transition.
        void loadKaTeX();
    }

    return result;
}
