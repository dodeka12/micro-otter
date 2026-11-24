import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import {
    MDI_CANVAS_FONT,
    ensureMdiGlyphFont,
    hasMdiGlyphFontSupport,
    resetMdiGlyphFontCache,
} from '../../src/micro_otter/nodes/html/js/nodes/mdi-glyph-font.js';

describe('mdi-glyph-font', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
        resetMdiGlyphFontCache();
    });

    afterEach(() => {
        resetMdiGlyphFontCache();
        harness.cleanup();
    });

    it('exposes the canvas shorthand of the vendored webfont', () => {
        assert.equal(MDI_CANVAS_FONT, '14px "micro-otter-mdi"');
    });

    it('reports no support while the environment has no FontFaceSet', () => {
        assert.equal(hasMdiGlyphFontSupport(), false);
    });

    it('reports support when document.fonts.load is available', () => {
        document.fonts = { load: async () => [] };
        assert.equal(hasMdiGlyphFontSupport(), true);
    });

    it('resolves failed without a FontFaceSet', async () => {
        assert.equal(await ensureMdiGlyphFont(), 'failed');
    });

    it('resolves ready when the face loads', async () => {
        document.fonts = { load: async () => [{ family: 'micro-otter-mdi' }] };
        assert.equal(await ensureMdiGlyphFont(), 'ready');
    });

    it('resolves failed when the load returns no faces', async () => {
        document.fonts = { load: async () => [] };
        assert.equal(await ensureMdiGlyphFont(), 'failed');
    });

    it('resolves failed instead of throwing when the load rejects', async () => {
        document.fonts = { load: async () => Promise.reject(new Error('offline')) };
        assert.equal(await ensureMdiGlyphFont(), 'failed');
    });

    it('shares one load per FontFaceSet', async () => {
        let loadCount = 0;
        document.fonts = {
            load: async () => {
                loadCount += 1;
                return [{}];
            },
        };

        await Promise.all([ensureMdiGlyphFont(), ensureMdiGlyphFont()]);

        assert.equal(loadCount, 1);
    });

    it('loads again for a fresh FontFaceSet', async () => {
        let loadCount = 0;
        const makeFonts = () => ({
            load: async () => {
                loadCount += 1;
                return [{}];
            },
        });

        document.fonts = makeFonts();
        await ensureMdiGlyphFont();

        document.fonts = makeFonts();
        await ensureMdiGlyphFont();

        assert.equal(loadCount, 2);
    });

    it('forgets the memoized load on reset', async () => {
        let loadCount = 0;
        document.fonts = {
            load: async () => {
                loadCount += 1;
                return [{}];
            },
        };

        await ensureMdiGlyphFont();
        resetMdiGlyphFontCache();
        await ensureMdiGlyphFont();

        assert.equal(loadCount, 2);
    });
});
