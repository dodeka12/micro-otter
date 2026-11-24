import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { NodeInfoView } from '../../src/micro_otter/nodes/html/js/views/node-info-view.js';
import {
    __resetKatexLoaderForTests,
    loadKaTeX,
} from '../../src/micro_otter/nodes/html/js/core/katex-loader.js';

const require = createRequire(import.meta.url);
const marked = require(path.resolve('src/micro_otter/nodes/html/vendor/marked/marked.umd.js'));

function createI18nService() {
    const translations = {
        'graph.info.inputs': 'Inputs',
        'graph.info.outputs': 'Outputs',
        'graph.info.controls': 'Controls',
        'graph.info.viewDocs': 'View Documentation',
    };

    return {
        t(key, params = {}) {
            const template = translations[key] || key;
            return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, token) => {
                const value = params[token];
                return value === undefined || value === null ? '' : String(value);
            });
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

describe('NodeInfoView descriptions', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        __resetKatexLoaderForTests();

        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }

        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    it('renders input/output/control description rows', () => {
        const view = new NodeInfoView({
            nodeName: 'Test',
            info: 'A test node.',
            inputs: [{ name: 'Block', description: 'Incoming audio block.' }],
            outputs: [{ name: 'Out', description: 'Resulting audio block.' }],
            controls: [{ name: 'Gain', description: 'Amplitude multiplier.' }],
            i18nService: createI18nService(),
        });

        view.render(container);

        assert.equal(container.querySelectorAll('.node-info-view__table').length, 3);

        const text = container.textContent;
        assert.ok(text.includes('Inputs'));
        assert.ok(text.includes('Outputs'));
        assert.ok(text.includes('Controls'));
        assert.ok(text.includes('Block'));
        assert.ok(text.includes('Incoming audio block.'));
        assert.ok(text.includes('Resulting audio block.'));
        assert.ok(text.includes('Gain'));
        assert.ok(text.includes('Amplitude multiplier.'));
    });

    it('omits empty sections', () => {
        const view = new NodeInfoView({
            nodeName: 'Test',
            info: '',
            inputs: [],
            outputs: [{ name: 'Out', description: 'Resulting audio block.' }],
            controls: [],
            i18nService: createI18nService(),
        });

        view.render(container);

        assert.equal(container.querySelectorAll('.node-info-view__table').length, 1);
        assert.ok(!container.textContent.includes('Inputs'));
        assert.ok(container.textContent.includes('Outputs'));
        assert.ok(!container.textContent.includes('Controls'));
    });

    it('renders Markdown in the info text and description cells', () => {
        dom.window.marked = marked;

        const view = new NodeInfoView({
            nodeName: 'Test',
            info: 'A **bold** note with `code`.',
            inputs: [{ name: 'Block', description: 'reads **pin**' }],
            i18nService: createI18nService(),
        });
        view.render(container);

        const infoEl = container.querySelector('.node-info-view__info-text');
        assert.ok(infoEl.querySelector('strong'), 'info renders strong');
        assert.ok(infoEl.querySelector('code'), 'info renders inline code');

        const descriptionCell = container.querySelector('.node-info-view__cell-description');
        assert.ok(descriptionCell.querySelector('strong'), 'description renders strong');
    });

    it('falls back to escaped plain text when marked is unavailable', () => {
        const view = new NodeInfoView({
            nodeName: 'Test',
            info: '**bold** <script>x</script>',
            inputs: [{ name: 'A', description: '**pin**' }],
            i18nService: createI18nService(),
        });
        view.render(container);

        const infoEl = container.querySelector('.node-info-view__info-text');
        assert.ok(infoEl.querySelector('.doc-area__raw'), 'uses the raw fallback');
        assert.doesNotMatch(infoEl.innerHTML, /<script>/);
        assert.match(infoEl.textContent, /<script>x<\/script>/);
    });

    it('never injects raw HTML or scripts from the description', () => {
        dom.window.marked = marked;

        const view = new NodeInfoView({
            nodeName: 'Test',
            info: 'safe <img src=x onerror=alert(1)> text',
            inputs: [{ name: 'A', description: 'reads **pin**' }],
            i18nService: createI18nService(),
        });
        view.render(container);

        const infoEl = container.querySelector('.node-info-view__info-text');
        assert.doesNotMatch(infoEl.innerHTML, /<img/);
        assert.equal(infoEl.querySelector('img'), null);
    });

    it('renders a math fallback when KaTeX is not loaded', () => {
        __resetKatexLoaderForTests();
        dom.window.marked = marked;

        const view = new NodeInfoView({
            nodeName: 'Test',
            info: 'area = $x^2$',
            inputs: [],
            i18nService: createI18nService(),
        });
        view.render(container);

        assert.ok(container.querySelector('.node-info-view__info-text .doc-area__math-fallback'));
    });

    it('renders math through KaTeX when the instance is available', () => {
        __resetKatexLoaderForTests();
        dom.window.marked = marked;
        dom.window.katex = {
            renderToString: (expr) => `<span class="katex">${expr}</span>`,
        };
        void loadKaTeX();

        const view = new NodeInfoView({
            nodeName: 'Test',
            info: 'area = $x^2$',
            inputs: [],
            i18nService: createI18nService(),
        });
        view.render(container);

        assert.ok(container.querySelector('.node-info-view__info-text .katex'));
        assert.equal(
            container.querySelector('.node-info-view__info-text .doc-area__math-fallback'),
            null
        );
    });

    it('re-renders math once KaTeX becomes ready after attach', () => {
        __resetKatexLoaderForTests();
        dom.window.marked = marked;

        const view = new NodeInfoView({
            nodeName: 'Test',
            info: 'area = $x^2$',
            inputs: [],
            i18nService: createI18nService(),
        });
        view.attachTo(container);

        const infoEl = () => container.querySelector('.node-info-view__info-text');
        assert.ok(infoEl().querySelector('.doc-area__math-fallback'), 'starts with the fallback');

        dom.window.katex = {
            renderToString: (expr) => `<span class="katex">${expr}</span>`,
        };
        const script = document.head.querySelector('script[data-katex-loader="script"]');
        assert.ok(script, 'the loader injected its script');
        script.dispatchEvent(new dom.window.Event('load'));

        assert.ok(infoEl().querySelector('.katex'), 're-renders with KaTeX output');
        assert.equal(infoEl().querySelector('.doc-area__math-fallback'), null);

        view.detach();
    });
});
