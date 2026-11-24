import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import {
    KATEX_CDN_BASE,
    KATEX_SCRIPT_URL,
    KATEX_STYLESHEET_URL,
    __resetKatexLoaderForTests,
    getKatex,
    getKatexLoadState,
    loadKaTeX,
    onKatexStateChange,
} from '../../src/micro_otter/nodes/html/js/core/katex-loader.js';

function findScript() {
    const scripts = document.head.querySelectorAll('script[data-katex-loader="script"]');
    return scripts.length > 0 ? scripts[scripts.length - 1] : null;
}

function findStylesheet() {
    return document.head.querySelector('link[data-katex-loader="stylesheet"]');
}

describe('katex-loader: no DOM', () => {
    beforeEach(() => {
        __resetKatexLoaderForTests();
    });

    it('resolves unavailable instead of throwing when document is missing', async () => {
        assert.equal(typeof document, 'undefined');

        const outcome = await loadKaTeX();

        assert.equal(outcome, 'unavailable');
        assert.equal(getKatexLoadState(), 'unavailable');
        assert.equal(getKatex(), null);
    });
});

describe('katex-loader: CDN URLs', () => {
    it('derives both asset URLs from the exported CDN base', () => {
        assert.ok(KATEX_CDN_BASE.startsWith('https://cdn.jsdelivr.net/npm/katex@'));
        assert.ok(KATEX_SCRIPT_URL.startsWith(KATEX_CDN_BASE));
        assert.ok(KATEX_STYLESHEET_URL.startsWith(KATEX_CDN_BASE));
        assert.ok(KATEX_SCRIPT_URL.endsWith('katex.min.js'));
        assert.ok(KATEX_STYLESHEET_URL.endsWith('katex.min.css'));
    });
});

describe('katex-loader: DOM loading', () => {
    let harness;

    beforeEach(() => {
        harness = createDomHarness();
        __resetKatexLoaderForTests();
    });

    afterEach(() => {
        harness.cleanup();
    });

    it('injects exactly one stylesheet and one script for concurrent calls', async () => {
        const first = loadKaTeX({ timeoutMs: 50 });
        const second = loadKaTeX({ timeoutMs: 50 });

        assert.equal(first, second);
        assert.equal(getKatexLoadState(), 'loading');
        assert.equal(document.head.querySelectorAll('link[data-katex-loader]').length, 1);
        assert.equal(document.head.querySelectorAll('script[data-katex-loader]').length, 1);

        const script = findScript();
        assert.equal(script.getAttribute('src'), KATEX_SCRIPT_URL);
        assert.equal(findStylesheet().getAttribute('href'), KATEX_STYLESHEET_URL);

        harness.window.katex = { renderToString: () => '<span></span>' };
        script.dispatchEvent(new harness.window.Event('load'));

        assert.equal(await first, 'ready');
        assert.equal(await second, 'ready');
        assert.equal(getKatexLoadState(), 'ready');
        assert.equal(typeof getKatex().renderToString, 'function');
    });

    it('reuses an already present global without injecting anything', async () => {
        const stub = { renderToString: () => '<span></span>' };
        harness.window.katex = stub;

        assert.equal(await loadKaTeX(), 'ready');
        assert.equal(getKatex(), stub);
        assert.equal(document.head.querySelectorAll('script[data-katex-loader]').length, 0);
    });

    it('resolves unavailable on a script error', async () => {
        const pending = loadKaTeX({ timeoutMs: 50 });
        findScript().dispatchEvent(new harness.window.Event('error'));

        assert.equal(await pending, 'unavailable');
        assert.equal(getKatexLoadState(), 'unavailable');
    });

    it('resolves unavailable when the script never arrives', async () => {
        const outcome = await loadKaTeX({ timeoutMs: 10 });

        assert.equal(outcome, 'unavailable');
        assert.equal(getKatexLoadState(), 'unavailable');
    });

    it('notifies subscribers once per transition and stops after unsubscribe', async () => {
        const seen = [];
        const unsubscribe = onKatexStateChange((state) => seen.push(state));

        const pending = loadKaTeX({ timeoutMs: 50 });
        unsubscribe();
        findScript().dispatchEvent(new harness.window.Event('error'));
        await pending;

        assert.deepEqual(seen, ['loading']);
        assert.equal(getKatexLoadState(), 'unavailable');
    });

    it('reports loading then ready to a subscriber', async () => {
        const seen = [];
        onKatexStateChange((state) => seen.push(state));

        const pending = loadKaTeX({ timeoutMs: 50 });
        harness.window.katex = { renderToString: () => '<span></span>' };
        findScript().dispatchEvent(new harness.window.Event('load'));
        await pending;

        assert.deepEqual(seen, ['loading', 'ready']);
    });

    it('allows a second load cycle after the test reset', async () => {
        await loadKaTeX({ timeoutMs: 10 });
        assert.equal(document.head.querySelectorAll('script[data-katex-loader]').length, 1);

        __resetKatexLoaderForTests();
        assert.equal(getKatexLoadState(), 'idle');

        const pending = loadKaTeX({ timeoutMs: 50 });
        assert.equal(document.head.querySelectorAll('script[data-katex-loader]').length, 2);
        assert.equal(document.head.querySelectorAll('link[data-katex-loader]').length, 2);

        harness.window.katex = { renderToString: () => '<span></span>' };
        findScript().dispatchEvent(new harness.window.Event('load'));

        assert.equal(await pending, 'ready');
    });
});
