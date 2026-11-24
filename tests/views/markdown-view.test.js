// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { MarkdownView } from '../../src/micro_otter/nodes/html/js/views/markdown-view.js';
import { ViewFactory } from '../../src/micro_otter/nodes/html/js/views/view-factory.js';

const require = createRequire(import.meta.url);
const marked = require(
    path.resolve('src/micro_otter/nodes/html/vendor/marked/marked.umd.js')
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const themesPath = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html', 'styles', 'themes.json');
const cssPath = path.join(
    repoRoot,
    'src',
    'micro_otter',
    'nodes',
    'html',
    'styles',
    'standard',
    'markdown-view.css'
);

describe('MarkdownView', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        dom?.window?.close();
    });

    it('renders headings, lists, emphasis and inline code from Markdown', () => {
        const view = new MarkdownView({
            markdown: '## Help\n\n- **bold** point and `inline` code',
            marked,
        });
        view.attachTo(container);

        const root = container.querySelector('.view-markdown');
        assert.ok(root, 'renders the .view-markdown root');
        assert.ok(root.querySelector('h2'), 'renders a heading');
        assert.ok(root.querySelector('ul'), 'renders a list');
        assert.ok(root.querySelector('strong'), 'renders emphasis');
        assert.ok(root.querySelector('code'), 'renders inline code');
        assert.ok(root.classList.contains('view-markdown--scrollable'), 'scrolls by default');

        view.detach();
    });

    it('re-renders when the Markdown source is replaced', () => {
        const view = new MarkdownView({ markdown: '# One', marked });
        view.attachTo(container);
        assert.match(container.textContent, /One/);

        view.setMarkdown('# Two');
        assert.match(container.textContent, /Two/);
        assert.doesNotMatch(container.textContent, /One/);

        view.markdown = '# Three';
        assert.match(container.textContent, /Three/);

        view.detach();
    });

    it('falls back to escaped raw text when marked is disabled', () => {
        const view = new MarkdownView({ markdown: '**bold** <script>x</script>', marked: null });
        view.attachTo(container);

        const root = container.querySelector('.view-markdown');
        assert.ok(root.querySelector('.doc-area__raw'), 'uses the escaped raw fallback');
        assert.doesNotMatch(root.innerHTML, /<script>/);
        assert.match(root.textContent, /<script>x<\/script>/);

        view.detach();
    });

    it('never injects raw HTML or scripts from the Markdown source', () => {
        const view = new MarkdownView({
            markdown: 'safe <img src=x onerror=alert(1)> text',
            marked,
        });
        view.attachTo(container);

        const root = container.querySelector('.view-markdown');
        assert.doesNotMatch(root.innerHTML, /<img/);
        assert.equal(root.querySelector('img'), null, 'no img element is created');

        view.detach();
    });

    it('restores through the ViewFactory', () => {
        const view = new MarkdownView({ markdown: '# Restored', marked });
        const serialized = view.serialize();
        assert.equal(serialized.type, 'MarkdownView');

        const factory = new ViewFactory({});
        const restored = factory.create(serialized);
        assert.ok(restored instanceof MarkdownView);
        assert.equal(restored.getMarkdown(), '# Restored');

        view.detach();
    });

    it('is registered in the standard theme manifest with a stylesheet', () => {
        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        assert.ok(manifest.styles.includes('markdown-view'));
        assert.ok(existsSync(cssPath));
    });
});
