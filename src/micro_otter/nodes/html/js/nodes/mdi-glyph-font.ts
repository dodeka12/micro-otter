// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Shared loader for the vendored Material Design Icons webfont on canvas text.
 *
 * `styles/standard/controls/icon-control.css` declares the `micro-otter-mdi` `@font-face`, but a
 * webfont only starts loading once a DOM element uses it. Canvas text is not covered by
 * `font-display: block`, so a glyph painted before the face is ready silently falls back to a
 * tofu box. Loading the face explicitly — once per document, shared by every caller — keeps the
 * canvas honest; whether to repaint afterwards is the caller's decision.
 *
 * @module nodes/mdi-glyph-font
 */

/** Canvas font shorthand of the vendored MDI webfont (declared in `icon-control.css`). */
export const MDI_CANVAS_FONT = '14px "micro-otter-mdi"';

/** Outcome of the webfont load: only `'ready'` allows painting a glyph. */
export type MdiGlyphFontStatus = 'ready' | 'failed';

/** Font set the memoized load belongs to, so a fresh document loads the face again. */
let cachedFontSet: FontFaceSet | null = null;

/** Memoized load for `cachedFontSet`; `null` until the first request. */
let cachedLoad: Promise<MdiGlyphFontStatus> | null = null;

/**
 * Whether this environment exposes a `FontFaceSet` that can load the glyph font.
 *
 * Callers use it to decide synchronously whether a canvas glyph can ever be painted: jsdom and
 * some embedded webviews have no `document.fonts`.
 * @returns `true` when `document.fonts.load()` is available.
 */
export function hasMdiGlyphFontSupport(): boolean {
    const fonts = globalThis.document?.fonts;
    return Boolean(fonts && typeof fonts.load === 'function');
}

/**
 * Load the vendored MDI webfont once per document.
 *
 * Every caller shares the same promise, so two controls — or two repaints of the same node —
 * never ask the browser for the same face twice. A rejection — or a missing `FontFaceSet` —
 * resolves `'failed'` instead of throwing: the caller keeps its text-only rendering for good.
 * @returns Resolves `'ready'` when the face is usable, `'failed'` otherwise.
 */
export function ensureMdiGlyphFont(): Promise<MdiGlyphFontStatus> {
    if (!hasMdiGlyphFontSupport()) {
        return Promise.resolve('failed');
    }

    const fonts = globalThis.document.fonts;
    if (cachedLoad && cachedFontSet === fonts) {
        return cachedLoad;
    }

    cachedFontSet = fonts;
    cachedLoad = fonts.load(MDI_CANVAS_FONT).then(
        (faces): MdiGlyphFontStatus =>
            Array.isArray(faces) && faces.length > 0 ? 'ready' : 'failed',
        (): MdiGlyphFontStatus => 'failed'
    );

    return cachedLoad;
}

/**
 * Forget the memoized load; the test hook that mirrors `resetMdiIconIndexCache()`.
 */
export function resetMdiGlyphFontCache(): void {
    cachedFontSet = null;
    cachedLoad = null;
}
