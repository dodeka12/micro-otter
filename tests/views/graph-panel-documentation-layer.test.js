// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file DOM layer tests for documentation areas (structure, diffing, editors, viewport sync).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDomHarness } from '../helpers/dom-harness.js';
import { GraphPanelDocumentationLayer } from '../../src/micro_otter/nodes/html/js/views/graph-panel-documentation-layer.js';
import {
    __resetKatexLoaderForTests,
    loadKaTeX,
} from '../../src/micro_otter/nodes/html/js/core/katex-loader.js';

function area(id, overrides = {}) {
    return {
        id,
        title: `Title ${id}`,
        markdown: `**body ${id}**`,
        color: '#4a90d9',
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        ...overrides,
    };
}

function createRendererStub() {
    const calls = [];
    const renderMarkdown = (markdown) => {
        calls.push(markdown);
        return {
            html: markdown ? `<p>${markdown}</p>` : '',
            hasMath: markdown.includes('$'),
            mathRendered: markdown.includes('$'),
        };
    };
    return { calls, renderMarkdown };
}

describe('GraphPanelDocumentationLayer', () => {
    let harness;
    let host;
    let backgroundCanvas;
    let nodeCanvas;
    let layer;
    let renderer;
    let commits;
    let titleCommits;
    let menus;

    beforeEach(() => {
        harness = createDomHarness();
        host = document.createElement('div');
        host.className = 'graph-panel-view__canvas';
        backgroundCanvas = document.createElement('canvas');
        backgroundCanvas.className = 'graph-panel-view__canvas-bg';
        nodeCanvas = document.createElement('canvas');
        nodeCanvas.className = 'graph-panel-view__canvas-node';
        host.append(backgroundCanvas, nodeCanvas);
        document.body.appendChild(host);

        renderer = createRendererStub();
        commits = [];
        titleCommits = [];
        menus = [];
        layer = new GraphPanelDocumentationLayer({
            host,
            before: nodeCanvas,
            viewport: { viewport: { translateX: 40, translateY: 60, scale: 2 } },
            renderMarkdown: renderer.renderMarkdown,
            onAreaMenu: (areaId) => menus.push(areaId),
            onAreaMarkdownCommit: (areaId, markdown) => commits.push({ areaId, markdown }),
            onAreaTitleCommit: (areaId, title) => titleCommits.push({ areaId, title }),
        });
        layer.mount();
    });

    afterEach(() => {
        layer.destroy();
        harness.cleanup();
    });

    it('inserts the content layer below and the chrome layer above the node canvas', () => {
        const children = Array.from(host.children);

        assert.equal(children.length, 4);
        assert.equal(children[0], backgroundCanvas);
        assert.equal(children[1].className, 'graph-panel-view__documentation');
        assert.equal(children[2], nodeCanvas);
        assert.equal(children[3].className, 'graph-panel-view__documentation-chrome');
    });

    it('puts the burger in the chrome layer so a left click can reach it', () => {
        layer.render([area('1')]);

        const section = host.querySelector('section[data-area-id="1"]');
        assert.equal(section.querySelector('button'), null, 'no control may sit under the canvas');

        const chromeRoot = host.querySelector('.graph-panel-doc-chrome[data-area-id="1"]');
        assert.ok(chromeRoot, 'expected a chrome root');
        const button = chromeRoot.querySelector('button');
        assert.ok(button);

        button.click();
        assert.deepEqual(menus, ['1']);
    });

    it('creates one section per area with the title as text', () => {
        layer.render([area('1'), area('2')]);

        const sections = host.querySelectorAll('section[data-area-id]');
        assert.equal(sections.length, 2);
        assert.equal(sections[0].dataset.areaId, '1');
        assert.equal(sections[0].querySelector('.graph-panel-doc-area__title').textContent, 'Title 1');
        assert.equal(
            sections[1].querySelector('.graph-panel-doc-area__body').textContent,
            '**body 2**'
        );
    });

    it('keeps element identity when the same data is rendered twice', () => {
        const areas = [area('1')];
        layer.render(areas);
        const section = host.querySelector('section[data-area-id="1"]');
        const body = section.querySelector('.graph-panel-doc-area__body');

        layer.render(areas);

        assert.equal(host.querySelector('section[data-area-id="1"]'), section);
        assert.equal(section.querySelector('.graph-panel-doc-area__body'), body);
        assert.equal(renderer.calls.length, 1);
    });

    it('re-renders the body only when the markdown changes', () => {
        layer.render([area('1', { markdown: 'first' })]);
        assert.equal(renderer.calls.length, 1);

        layer.render([area('1', { markdown: 'second' })]);
        assert.equal(renderer.calls.length, 2);
        assert.equal(renderer.calls[1], 'second');

        layer.render([area('1', { markdown: 'second', color: '#ff0000' })]);
        assert.equal(renderer.calls.length, 2);
    });

    it('writes the three colour variables with the fixed alphas', () => {
        layer.render([area('1', { color: '#4A90D9' })]);
        const section = host.querySelector('section[data-area-id="1"]');

        assert.equal(section.style.getPropertyValue('--doc-area-color'), '#4A90D9');
        assert.equal(
            section.style.getPropertyValue('--doc-area-fill'),
            'rgba(74, 144, 217, 0.16)'
        );
        assert.equal(
            section.style.getPropertyValue('--doc-area-border'),
            'rgba(74, 144, 217, 0.65)'
        );
    });

    it('updates the colour variables in place without touching the renderer', () => {
        layer.render([area('1', { color: '#4a90d9' })]);
        const section = host.querySelector('section[data-area-id="1"]');
        const callsBefore = renderer.calls.length;

        layer.render([area('1', { color: '#00ff00' })]);

        assert.equal(section.style.getPropertyValue('--doc-area-color'), '#00ff00');
        assert.equal(
            section.style.getPropertyValue('--doc-area-fill'),
            'rgba(0, 255, 0, 0.16)'
        );
        assert.equal(renderer.calls.length, callsBefore);
    });

    it('removes exactly the element whose area disappeared', () => {
        layer.render([area('1'), area('2'), area('3')]);

        layer.render([area('1'), area('3')]);

        assert.equal(host.querySelectorAll('section[data-area-id]').length, 2);
        assert.equal(host.querySelector('section[data-area-id="2"]'), null);
        assert.ok(host.querySelector('section[data-area-id="3"]'));
    });

    it('writes the viewport transform with the injected values', () => {
        layer.render([area('1')]);
        layer.syncViewport();

        const layerEl = host.querySelector('.graph-panel-view__documentation');
        assert.equal(layerEl.style.transform, 'translate(40px, 60px) scale(2)');
        assert.equal(layerEl.style.transformOrigin, '0 0');
    });

    it('activates exactly one area at a time', () => {
        layer.render([area('1'), area('2')], { activeAreaId: '2' });

        const active = host.querySelectorAll('.graph-panel-doc-area--active');
        assert.equal(active.length, 1);
        assert.equal(active[0].dataset.areaId, '2');

        layer.render([area('1'), area('2')], { activeAreaId: '1' });
        const nextActive = host.querySelectorAll('.graph-panel-doc-area--active');
        assert.equal(nextActive.length, 1);
        assert.equal(nextActive[0].dataset.areaId, '1');
    });

    it('marks an empty Markdown area empty and renders no body markup', () => {
        layer.render([area('1', { markdown: '' })]);

        const section = host.querySelector('section[data-area-id="1"]');
        const body = section.querySelector('.graph-panel-doc-area__body');
        assert.equal(section.dataset.empty, 'true');
        assert.equal(body.dataset.empty, 'true');
        assert.equal(body.textContent, '');
    });

    it('applies the stored content alignment as a data attribute', () => {
        layer.render([area('1'), area('2', { contentAlign: 'bottom' })]);

        const top = host.querySelector('section[data-area-id="1"]');
        const bottom = host.querySelector('section[data-area-id="2"]');
        // Missing/garbage values must fall back to `top` instead of inventing a third state.
        assert.equal(top.dataset.align, 'top');
        assert.equal(bottom.dataset.align, 'bottom');

        layer.render([area('2', { contentAlign: 'bottom' }), area('1', { contentAlign: 'sideways' })]);
        assert.equal(host.querySelector('section[data-area-id="1"]').dataset.align, 'top');
    });

    it('writes the normalized font-size preset on both layer roots', () => {
        layer.render([
            area('1', { fontSize: 'small' }),
            area('2', { fontSize: 'large' }),
            area('3'),
            area('4', { fontSize: 'sideways' }),
        ]);

        for (const [id, expected] of [
            ['1', 'small'],
            ['2', 'large'],
            ['3', 'normal'],
            ['4', 'normal'],
        ]) {
            const section = host.querySelector(`section[data-area-id="${id}"]`);
            const chromeRoot = host.querySelector(`.graph-panel-doc-chrome[data-area-id="${id}"]`);

            assert.equal(section.dataset.fontSize, expected, `section ${id}`);
            assert.equal(chromeRoot.dataset.fontSize, expected, `chrome ${id}`);
        }
    });

    it('keeps markup in a title literal', () => {
        layer.render([area('1', { title: '<img src=x onerror=alert(1)>' })]);

        const title = host.querySelector('.graph-panel-doc-area__title');
        assert.equal(title.textContent, '<img src=x onerror=alert(1)>');
        assert.equal(title.querySelectorAll('img').length, 0);
    });

    it('falls back to the untitled label without storing it', () => {
        layer.render([area('1', { title: '' })]);

        const section = host.querySelector('section[data-area-id="1"]');
        assert.equal(section.querySelector('.graph-panel-doc-area__title').textContent, 'Untitled area');
        assert.equal(section.dataset.untitled, 'true');
    });

    it('exposes the accessors for hit-testing and returns null for unknown ids', () => {
        layer.render([area('1')]);

        assert.ok(layer.getAreaElementRect('1'));
        assert.ok(layer.getHeaderElement('1'));
        assert.ok(layer.getResizeHandleElement('1'));
        assert.ok(layer.getBodyElement('1'));
        assert.equal(layer.getAreaElementRect('missing'), null);
        assert.equal(layer.getHeaderElement('missing'), null);
        assert.equal(layer.getResizeHandleElement('missing'), null);
    });

    it('opens an editor over the body in the chrome layer and commits once', () => {
        layer.render([area('1', { markdown: '**raw**' })]);
        const section = host.querySelector('section[data-area-id="1"]');
        const chromeRoot = host.querySelector('.graph-panel-doc-chrome[data-area-id="1"]');

        assert.equal(layer.showEditor('1'), true);
        const textarea = chromeRoot.querySelector('textarea');
        assert.ok(textarea, 'expected a textarea in the chrome layer');
        assert.equal(textarea.value, '**raw**');
        assert.equal(layer.getEditingAreaId(), '1');
        assert.equal(section.dataset.editing, 'true');

        textarea.value = '# changed';
        assert.equal(layer.commitEditor(), '# changed');

        assert.deepEqual(commits, [{ areaId: '1', markdown: '# changed' }]);
        assert.equal(chromeRoot.querySelector('textarea'), null);
        assert.equal(layer.getEditingAreaId(), null);
    });

    it('restores the previous body when the editor is cancelled', () => {
        layer.render([area('1', { markdown: 'keep me' })]);
        const section = host.querySelector('section[data-area-id="1"]');
        const chromeRoot = host.querySelector('.graph-panel-doc-chrome[data-area-id="1"]');

        layer.showEditor('1');
        chromeRoot.querySelector('textarea').value = 'discard me';
        assert.equal(layer.cancelEditor(), true);

        assert.deepEqual(commits, []);
        assert.equal(chromeRoot.querySelector('textarea'), null);
        assert.equal(
            section.querySelector('.graph-panel-doc-area__body').textContent,
            'keep me'
        );
    });

    it('ignores editor commands when no editor is open', () => {
        assert.equal(layer.commitEditor(), null);
        assert.equal(layer.cancelEditor(), false);
        assert.equal(layer.showEditor('missing'), false);
    });

    it('opens a title editor seeded with the current title', () => {
        layer.render([area('1', { title: 'Old' })]);
        const section = host.querySelector('section[data-area-id="1"]');
        const chromeRoot = host.querySelector('.graph-panel-doc-chrome[data-area-id="1"]');

        assert.equal(layer.showTitleEditor('1'), true);
        const input = chromeRoot.querySelector('input');
        assert.equal(input.value, 'Old');

        layer.cancelTitleEditor();
        assert.equal(chromeRoot.querySelector('input'), null);
        assert.equal(
            section.querySelector('.graph-panel-doc-area__title').textContent,
            'Old'
        );
    });

    it('commits the body editor on a document-level outside click', () => {
        layer.render([area('1', { markdown: 'keep me' })]);
        const chromeRoot = host.querySelector('.graph-panel-doc-chrome[data-area-id="1"]');

        layer.showEditor('1');
        const textarea = chromeRoot.querySelector('textarea');
        textarea.value = 'committed';

        textarea.dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }));
        assert.equal(layer.getEditingAreaId(), '1');

        document.body.dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }));

        assert.deepEqual(commits, [{ areaId: '1', markdown: 'committed' }]);
        assert.equal(layer.getEditingAreaId(), null);
        assert.equal(chromeRoot.querySelector('textarea'), null);
    });

    it('commits the title editor on an outside click but not inside its input', () => {
        layer.render([area('1', { title: 'Old' })]);
        const chromeRoot = host.querySelector('.graph-panel-doc-chrome[data-area-id="1"]');

        layer.showTitleEditor('1');
        const input = chromeRoot.querySelector('input');
        input.value = 'New';

        input.dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }));
        assert.equal(chromeRoot.querySelector('input'), input);

        document.body.dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }));

        assert.deepEqual(titleCommits, [{ areaId: '1', title: 'New' }]);
        assert.equal(chromeRoot.querySelector('input'), null);
    });

    it('ignores outside clicks after destroy removes the document listener', () => {
        layer.render([area('1', { markdown: 'unchanged' })]);
        layer.showEditor('1');

        layer.destroy();
        assert.doesNotThrow(() =>
            document.body.dispatchEvent(new harness.window.MouseEvent('mousedown', { bubbles: true }))
        );

        assert.deepEqual(commits, []);
    });

    it('removes both layers on destroy', () => {
        layer.render([area('1')]);

        layer.destroy();

        assert.equal(host.querySelector('.graph-panel-view__documentation'), null);
        assert.equal(host.querySelector('.graph-panel-view__documentation-chrome'), null);
        assert.equal(layer.getElement(), null);
        assert.equal(layer.getChromeElement(), null);
    });

    it('stops re-rendering math after destroy', async () => {
        __resetKatexLoaderForTests();
        layer.render([area('1', { markdown: 'value $x$' })]);
        const callsBefore = renderer.calls.length;
        layer.destroy();

        const pending = loadKaTeX({ timeoutMs: 20 });
        harness.window.katex = { renderToString: () => '<span class="katex"></span>' };
        harness.document.head
            .querySelectorAll('script[data-katex-loader="script"]')
            .forEach((script) => script.dispatchEvent(new harness.window.Event('load')));
        await pending;

        assert.equal(renderer.calls.length, callsBefore);
        __resetKatexLoaderForTests();
    });
});
