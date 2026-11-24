import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { renderMarkdown } from '../../src/micro_otter/nodes/html/js/core/markdown-renderer.js';
import { renderAreaMarkdown } from '../../src/micro_otter/nodes/html/js/core/render-documentation-markdown.js';
import {
    __resetKatexLoaderForTests,
    getKatexLoadState,
} from '../../src/micro_otter/nodes/html/js/core/katex-loader.js';
import { createDomHarness } from '../helpers/dom-harness.js';

const require = createRequire(import.meta.url);
const MARKED_PATH = path.resolve(
    'src/micro_otter/nodes/html/vendor/marked/marked.umd.js'
);
const marked = require(MARKED_PATH);

function render(source, options = {}) {
    return renderMarkdown(source, { marked, ...options });
}

function createKatexStub() {
    const calls = [];
    return {
        calls,
        renderToString(expr, options = {}) {
            calls.push({ expr, options });
            return `<span class="katex" data-expr="${expr}"></span>`;
        },
    };
}

describe('markdown-renderer: block structure', () => {
    it('renders paragraphs and inline emphasis', () => {
        const { html, hasMath, mathRendered } = render('Hello **bold** and *italic* and `code`.');

        assert.equal(
            html,
            '<p>Hello <strong>bold</strong> and <em>italic</em> and <code>code</code>.</p>'
        );
        assert.equal(hasMath, false);
        assert.equal(mathRendered, false);
    });

    it('renders headings with clamped depth, rules and blockquotes', () => {
        const { html } = render('### Title\n\n> quoted **text**\n\n---');

        assert.match(html, /<h3>Title<\/h3>/);
        assert.match(html, /<blockquote><p>quoted <strong>text<\/strong><\/p><\/blockquote>/);
        assert.match(html, /<hr>/);
    });

    it('renders nested ordered and unordered lists', () => {
        const { html } = render('1. first\n2. second\n   - nested\n');

        assert.match(html, /<ol>/);
        assert.match(html, /<li>first<\/li>/);
        assert.match(html, /<ul><li>nested<\/li><\/ul>/);
    });

    it('renders fenced code with and without a language name', () => {
        const withLang = render('```python\nprint(1 < 2)\n```').html;
        const withoutLang = render('```\nplain\n```').html;

        assert.match(withLang, /<pre class="doc-area__code"><code class="language-python">/);
        assert.match(withLang, /print\(1 &lt; 2\)/);
        assert.match(withoutLang, /<pre class="doc-area__code"><code>plain<\/code><\/pre>/);
    });

    it('drops an unsafe language name instead of emitting a class', () => {
        const { html } = render('```"><img onerror=x>\ncode\n```');

        assert.doesNotMatch(html, /onerror/);
        assert.doesNotMatch(html, /class="language-/);
    });
});

describe('markdown-renderer: safety', () => {
    it('neutralises raw HTML blocks', () => {
        const { html } = render('<script>alert(1)</script>');

        assert.doesNotMatch(html, /<script/);
        assert.match(html, /&lt;script&gt;/);
    });

    it('neutralises inline HTML with event handlers', () => {
        const { html } = render('text <img src=x onerror=alert(1)> more');

        assert.doesNotMatch(html, /<img/);
        assert.doesNotMatch(html, /<[a-z][^>]*onerror/i);
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    });

    it('keeps only http, https and mailto links', () => {
        const safe = render('[a](https://example.com) [b](mailto:x@y.z) [c](http://x.y)').html;
        const unsafe = render('[a](javascript:alert(1))').html;
        const relative = render('[a](./local.md)').html;

        assert.match(
            safe,
            /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">a<\/a>/
        );
        assert.match(safe, /href="mailto:x@y.z"/);
        assert.match(safe, /href="http:\/\/x.y"/);
        assert.doesNotMatch(unsafe, /href=/);
        assert.doesNotMatch(unsafe, /javascript:/);
        assert.match(unsafe, /<p>a<\/p>/);
        assert.doesNotMatch(relative, /href=/);
    });

    it('escapes an empty-provider fallback', () => {
        const { html } = render('<b>bold</b>', { marked: null });

        assert.equal(html, '<pre class="doc-area__raw">&lt;b&gt;bold&lt;/b&gt;</pre>');
    });
});


describe('markdown-renderer: math', () => {
    it('renders inline math through KaTeX with displayMode false', () => {
        const katex = createKatexStub();
        const { html, hasMath, mathRendered } = render('Euler: $e^{i\\pi}$', { katex });

        assert.equal(katex.calls.length, 1);
        assert.equal(katex.calls[0].expr, 'e^{i\\pi}');
        assert.equal(katex.calls[0].options.displayMode, false);
        assert.equal(katex.calls[0].options.throwOnError, false);
        assert.match(html, /class="katex"/);
        assert.equal(hasMath, true);
        assert.equal(mathRendered, true);
    });

    it('renders display math with displayMode true', () => {
        const katex = createKatexStub();
        const { html, mathRendered } = render('$$x^2 + y^2$$', { katex });

        assert.equal(katex.calls.length, 1);
        assert.equal(katex.calls[0].expr, 'x^2 + y^2');
        assert.equal(katex.calls[0].options.displayMode, true);
        assert.match(html, /class="katex"/);
        assert.equal(mathRendered, true);
    });

    it('falls back to readable source without KaTeX', () => {
        const inline = render('value $x_1$ here');
        const display = render('$$a<b$$');

        assert.match(
            inline.html,
            /<code class="doc-area__math-fallback" data-math>\$x_1\$<\/code>/
        );
        assert.equal(inline.hasMath, true);
        assert.equal(inline.mathRendered, false);
        assert.match(display.html, /\$a&lt;b\$/);
    });

    it('keeps escaped dollars literal', () => {
        const katex = createKatexStub();
        const { html, hasMath } = render('costs \\$5 and \\$6', { katex });

        assert.equal(hasMath, false);
        assert.equal(katex.calls.length, 0);
        assert.match(html, /\$5/);
        assert.match(html, /\$6/);
    });

    it('keeps an unterminated dollar literal', () => {
        const { html, hasMath } = render('price $5 for one line');

        assert.equal(hasMath, false);
        assert.match(html, /\$5/);
    });

    it('does not let the Markdown lexer mangle formula underscores', () => {
        const katex = createKatexStub();
        render('$a_b * c_d$', { katex });

        assert.equal(katex.calls[0].expr, 'a_b * c_d');
    });

    it('survives a KaTeX instance that throws', () => {
        const katex = {
            renderToString() {
                throw new Error('boom');
            },
        };
        const { html, hasMath, mathRendered } = render('$x$', { katex });

        assert.equal(hasMath, true);
        assert.equal(mathRendered, false);
        assert.match(html, /doc-area__math-fallback/);
        assert.match(html, /\$x\$/);
    });

    it('renders every expression of a mixed document', () => {
        const katex = createKatexStub();
        const { html, mathRendered } = render('$a$\n\n$$b$$\n\n$c$', { katex });

        assert.equal(katex.calls.length, 3);
        assert.equal(mathRendered, true);
        assert.equal(html.match(/class="katex"/g).length, 3);
    });
});

describe('markdown-renderer: empty input', () => {
    it('returns an empty result for empty and whitespace-only input', () => {
        for (const source of ['', '   ', '\n\n\t']) {
            assert.deepEqual(render(source), { html: '', hasMath: false, mathRendered: false });
        }
    });
});


describe('renderAreaMarkdown: provider resolution', () => {
    let harness;

    beforeEach(() => {
        __resetKatexLoaderForTests();
    });

    afterEach(() => {
        if (harness) {
            harness.cleanup();
            harness = null;
        }
        __resetKatexLoaderForTests();
    });

    it('falls back to escaped raw text without a browser', () => {
        const result = renderAreaMarkdown('**bold**');

        assert.equal(result.html, '<pre class="doc-area__raw">**bold**</pre>');
        assert.equal(result.hasMath, false);
    });

    it('uses the browser marked global when present', () => {
        harness = createDomHarness();
        harness.window.marked = marked;

        const result = renderAreaMarkdown('# Title\n\n**bold**');

        assert.match(result.html, /<h1>Title<\/h1>/);
        assert.match(result.html, /<strong>bold<\/strong>/);
    });

    it('starts a lazy KaTeX load on the first math-bearing document', () => {
        const result = renderAreaMarkdown('value $x$');

        assert.equal(result.hasMath, true);
        assert.equal(result.mathRendered, false);
        assert.match(result.html, /value \$x\$/);
        assert.equal(getKatexLoadState(), 'unavailable');
    });

    it('upgrades math on the next render once KaTeX is ready', () => {
        harness = createDomHarness();
        harness.window.marked = marked;
        harness.window.katex = {
            renderToString: (expr) => `<span class="katex">${expr}</span>`,
        };

        const first = renderAreaMarkdown('value $x^2$');
        const second = renderAreaMarkdown('value $x^2$');

        assert.match(first.html, /doc-area__math-fallback/);
        assert.equal(getKatexLoadState(), 'ready');
        assert.equal(second.mathRendered, true);
        assert.match(second.html, /<span class="katex">x\^2<\/span>/);
    });
});
