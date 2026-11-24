// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Layout skeleton tests for GraphPanelView (toolbar host above canvas host).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Minimal JSDOM setup: HTMLElement/EventTarget globals are needed by ViewBase.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.EventTarget = dom.window.EventTarget;
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

import { GraphPanelView } from '../../src/micro_otter/nodes/html/js/views/graph-panel-view.js';

const collectionStub = {
    getTargetId: () => null,
    getDeviceRuntimeId: () => 'general',
};

function createView(overrides = {}) {
    return new GraphPanelView({
        graph: null,
        collection: collectionStub,
        i18nService: {
            t: (key) => key,
            addEventListener: () => {},
            removeEventListener: () => {},
        },
        logger: { log: () => {} },
        ...overrides,
    });
}

function createContainer() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
}
describe('GraphPanelView canvas layers', () => {
    it('inserts the background canvas before the node canvas', () => {
        const view = createView();
        const container = createContainer();

        view.attachTo(container);

        const canvases = Array.from(container.querySelectorAll('.graph-panel-view__canvas canvas'));
        assert.equal(canvases.length, 2);
        assert.equal(canvases[0].className, 'graph-panel-view__canvas-bg');
        assert.equal(canvases[1].className, 'graph-panel-view__canvas-node');
        assert.equal(view.backgroundCanvas, canvases[0]);
        assert.equal(view.canvas, canvases[1]);

        view.dispose();
    });

    it('sizes both canvases to the same CSS and device pixel dimensions', () => {
        const view = createView();
        const container = createContainer();
        Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1000 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 800 });

        view.attachTo(container);

        const canvasHost = container.querySelector('.graph-panel-view__canvas');
        Object.defineProperty(canvasHost, 'clientWidth', { configurable: true, value: 640 });
        Object.defineProperty(canvasHost, 'clientHeight', { configurable: true, value: 480 });

        view.resizeCanvas();

        const dpr = global.window.devicePixelRatio || 1;
        assert.equal(view.canvas.width, 640 * dpr);
        assert.equal(view.canvas.height, 480 * dpr);
        assert.equal(view.backgroundCanvas.width, view.canvas.width);
        assert.equal(view.backgroundCanvas.height, view.canvas.height);
        assert.equal(view.backgroundCanvas.style.width, '640px');
        assert.equal(view.backgroundCanvas.style.height, '480px');

        view.dispose();
    });

    it('removes both canvases on dispose and recreates them on re-attach', () => {
        const view = createView();
        const firstContainer = createContainer();

        view.attachTo(firstContainer);
        assert.equal(firstContainer.querySelectorAll('canvas').length, 2);

        view.dispose();

        assert.equal(view.canvas, null);
        assert.equal(view.backgroundCanvas, null);
        assert.equal(firstContainer.querySelectorAll('canvas').length, 0);

        const secondContainer = createContainer();
        view.attachTo(secondContainer);
        assert.equal(secondContainer.querySelectorAll('canvas').length, 2);

        view.dispose();
    });

    it('stacks the three layers by DOM order (background, documentation, node canvas)', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(css, /\.graph-panel-view__canvas-bg\s*\{[^}]*z-index:\s*0/);
        assert.match(css, /\.graph-panel-view__documentation\s*\{[^}]*z-index:\s*1/);
        assert.match(css, /\.graph-panel-view__canvas-node\s*\{[^}]*z-index:\s*2/);
    });
});

describe('GraphPanelView layout skeleton', () => {
    it('mounts a single root element with toolbar and canvas hosts in order', () => {
        const view = createView();
        const container = createContainer();

        view.attachTo(container);

        assert.equal(container.children.length, 1, 'Expected exactly one root element');
        const root = container.firstElementChild;
        assert.equal(root.className, 'graph-panel-view');
        assert.equal(root.children.length, 2, 'Expected two host elements');
        assert.equal(root.children[0].className, 'graph-panel-view__toolbar');
        assert.equal(root.children[1].className, 'graph-panel-view__canvas');

        view.dispose();
    });

    it('places the canvas inside the canvas host and keeps its inline positioning', () => {
        const view = createView();
        const container = createContainer();

        view.attachTo(container);

        const canvasHost = container.querySelector('.graph-panel-view__canvas');
        assert.ok(view.canvas, 'Expected a canvas instance');
        assert.equal(view.canvas.parentElement, canvasHost);
        // Two canvases: the background layer (grid + documentation shading) and the node canvas.
        assert.equal(canvasHost.querySelectorAll('canvas').length, 2);
        assert.equal(view.canvas.style.position, 'absolute');
        assert.equal(view.canvas.style.top, '0px');
        assert.equal(view.canvas.style.left, '0px');
        assert.ok(view.canvas.style.width.endsWith('px'), 'Expected a pixel width');
        assert.ok(view.canvas.style.height.endsWith('px'), 'Expected a pixel height');

        view.dispose();
    });

    it('reuses the skeleton on re-attach without duplicating the canvas', () => {
        const view = createView();
        const firstContainer = createContainer();
        const secondContainer = createContainer();

        view.attachTo(firstContainer);
        const canvas = view.canvas;

        view.attachTo(secondContainer);

        assert.equal(firstContainer.children.length, 0, 'Old container should be cleared');
        assert.equal(
            secondContainer.querySelectorAll('.graph-panel-view').length,
            1,
            'Expected exactly one root element after re-attach'
        );
        assert.equal(
            secondContainer.querySelectorAll('.graph-panel-view__canvas canvas').length,
            2,
            'Expected the background and node canvases inside the new canvas host'
        );
        assert.equal(firstContainer.querySelectorAll('canvas').length, 0);
        assert.equal(view.canvas, canvas, 'Expected the same canvas instance to be reused');
        assert.equal(
            view.canvas.parentElement,
            secondContainer.querySelector('.graph-panel-view__canvas')
        );

        view.dispose();
    });

    it('sizes the canvas from the canvas host, not from the tab container', () => {
        const view = createView();
        const container = createContainer();
        Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1000 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 800 });

        view.attachTo(container);

        const canvasHost = container.querySelector('.graph-panel-view__canvas');
        Object.defineProperty(canvasHost, 'clientWidth', { configurable: true, value: 640 });
        Object.defineProperty(canvasHost, 'clientHeight', { configurable: true, value: 480 });

        view.resizeCanvas();

        const dpr = global.window.devicePixelRatio || 1;
        assert.equal(view.canvas.width, 640 * dpr);
        assert.equal(view.canvas.height, 480 * dpr);
        assert.equal(view.canvas.style.width, '640px');
        assert.equal(view.canvas.style.height, '480px');

        view.dispose();
    });

    it('tears down the canvas and tooltip on dispose and rebuilds on re-attach', () => {
        const view = createView();
        const firstContainer = createContainer();

        view.attachTo(firstContainer);
        assert.equal(
            firstContainer.querySelectorAll('.graph-panel-capability-tooltip').length,
            1,
            'Expected the capability tooltip inside the canvas host'
        );

        view.dispose();

        assert.equal(view.canvas, null);
        assert.equal(firstContainer.querySelectorAll('canvas').length, 0);
        assert.equal(
            firstContainer.querySelectorAll('.graph-panel-capability-tooltip').length,
            0
        );

        const secondContainer = createContainer();
        view.attachTo(secondContainer);

        assert.ok(view.canvas, 'Expected a fresh canvas after re-attach');
        assert.equal(secondContainer.querySelectorAll('.graph-panel-view__canvas canvas').length, 2);
        assert.equal(secondContainer.querySelectorAll('.graph-panel-view').length, 1);

        view.dispose();
    });

    it('builds the skeleton when attaching without a graph', () => {
        const view = createView();
        const container = createContainer();

        view.setGraph(null);
        assert.doesNotThrow(() => view.attachTo(container));
        assert.equal(container.querySelectorAll('.graph-panel-view').length, 1);
        assert.equal(container.querySelectorAll('.graph-panel-view__toolbar').length, 1);
        assert.equal(container.querySelectorAll('.graph-panel-view__canvas canvas').length, 2);

        view.dispose();
    });
});

const testDir = path.dirname(fileURLToPath(import.meta.url));
const htmlRoot = path.resolve(testDir, '../../src/micro_otter/nodes/html');
const stylesheetPath = path.join(htmlRoot, 'styles/standard/graph-panel-view.css');

describe('graph panel stylesheet registration', () => {
    it('registers the stylesheet in the theme manifest', () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(htmlRoot, 'styles/themes.json'), 'utf8')
        );
        const styleNames = manifest.styles || [];

        assert.ok(
            styleNames.includes('graph-panel-view'),
            'styles/themes.json must list graph-panel-view'
        );
        assert.ok(
            styleNames.indexOf('graph-panel-view') > styleNames.indexOf('graph-settings-view'),
            'graph-panel-view must follow graph-settings-view in the manifest'
        );
    });

    it('ships the layout stylesheet with the flex skeleton rules', () => {
        assert.ok(fs.existsSync(stylesheetPath), 'Expected graph-panel-view.css to exist');

        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(css, /\.graph-panel-view\s*\{/);
        assert.match(css, /\.graph-panel-view__toolbar\s*\{[^}]*flex:\s*0 0 auto/);
        assert.match(css, /\.graph-panel-view__canvas\s*\{[^}]*flex:\s*1 1 auto/);
        assert.match(css, /\.graph-panel-view__toolbar:empty\s*\{[^}]*display:\s*none/);
    });

    it('scopes the compact toolbar rules to the panel', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(css, /\.graph-panel-view__toolbar \.view-toolbar__controls\s*\{/);
        assert.match(css, /\.graph-panel-view__toolbar \.view-toolbar__separator\s*\{/);
        assert.match(
            css,
            /\.graph-panel-view__toolbar \.view-toolbar__separator\s*\{[^}]*background:\s*currentColor/,
            'The separator must be visible against the toolbar surface'
        );
        assert.doesNotMatch(
            css,
            /\.graph-panel-view__toolbar \.view-toolbar\s*\{[^}]*height:/,
            'The panel must not override the toolbar height set by ToolbarView'
        );
    });

    it('compacts the inline dropdown and number controls', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');

        assert.match(css, /\.graph-panel-view__toolbar-control \.custom-control__label\s*\{/);
        assert.match(
            css,
            /\.graph-panel-view__toolbar-control \.custom-control__label:empty\s*\{[^}]*display:\s*none/,
            'The untitled dropdown label must collapse'
        );
        assert.match(css, /\.graph-panel-view__toolbar-control\[hidden\]\s*\{[^}]*display:\s*none/);
        assert.match(
            css,
            /\.graph-panel-view__toolbar-control \.dropdown-control__button\s*\{[^}]*height:\s*24px[^}]*padding:\s*0 4px[^}]*font-size:\s*0\.7rem/,
            'The reusable dropdown trigger must match the compact toolbar inputs'
        );
        assert.match(
            css,
            /\.graph-panel-view__toolbar-control \.custom-control--number \.custom-control__input\s*\{[^}]*width:\s*calc\(5ch \+ \d+px\)/,
            'The sleep input must fit five digits'
        );
        assert.doesNotMatch(
            css,
            /\.view-toolbar\s*\{[^}]*height:/,
            'The stylesheet must not set an explicit toolbar height'
        );
    });

    it('paints the canvas host from the theme so disabled graphs can gray out', () => {
        const css = fs.readFileSync(stylesheetPath, 'utf8');
        const themeCss = fs.readFileSync(
            path.join(htmlRoot, 'styles/standard/view-system.css'),
            'utf8'
        );

        assert.match(
            css,
            /\.graph-panel-view__canvas\s*\{[^}]*background-color:\s*var\(--mo-graph-canvas-bg/,
            'The canvas host must paint the canvas background so the app shell never shows through'
        );
        assert.match(
            css,
            /\.graph-panel-view__canvas--disabled\s*\{[^}]*var\(--mo-graph-canvas-bg-disabled/,
            'Disabled graphs must drop to the muted canvas background'
        );
        assert.match(
            themeCss,
            /:root\s*\{[^}]*--mo-graph-canvas-bg:/,
            'view-system.css must define --mo-graph-canvas-bg'
        );
        assert.match(
            themeCss,
            /:root\s*\{[^}]*--mo-graph-canvas-bg-disabled:/,
            'view-system.css must define --mo-graph-canvas-bg-disabled'
        );
    });

    it('registers the documentation-area stylesheet right after the panel stylesheet', () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(htmlRoot, 'styles/themes.json'), 'utf8')
        );
        const styleNames = manifest.styles || [];
        const panelIndex = styleNames.indexOf('graph-panel-view');
        const areaIndex = styleNames.indexOf('graph-panel-documentation-areas');

        assert.ok(areaIndex !== -1, 'styles/themes.json must list graph-panel-documentation-areas');
        assert.equal(
            areaIndex,
            panelIndex + 1,
            'graph-panel-documentation-areas must follow graph-panel-view in the manifest'
        );
    });

    it('ships the documentation-area stylesheet with the layer rules', () => {
        const areaStylesheetPath = path.join(
            htmlRoot,
            'styles/standard/graph-panel-documentation-areas.css'
        );
        assert.ok(fs.existsSync(areaStylesheetPath), 'Expected the documentation-area stylesheet');

        const css = fs.readFileSync(areaStylesheetPath, 'utf8');
        assert.match(css, /\.graph-panel-view__documentation\s*\{/);
        assert.match(css, /\.graph-panel-doc-area\s*\{/);
        // The chrome layer must be above the node canvas, otherwise clicks never reach it.
        assert.match(css, /\.graph-panel-view__documentation-chrome\s*\{[^}]*z-index:\s*3/);
        assert.match(css, /\.graph-panel-doc-chrome__menu\s*\{[^}]*pointer-events:\s*auto/);
        assert.match(css, /\.graph-panel-doc-chrome__editor[\s\S]*?pointer-events:\s*auto/);
    });

    it('ships the documentation-area typography contract', () => {
        const areaStylesheetPath = path.join(
            htmlRoot,
            'styles/standard/graph-panel-documentation-areas.css'
        );
        const css = fs.readFileSync(areaStylesheetPath, 'utf8');

        assert.match(css, /--doc-area-font-size:\s*11px/);
        assert.match(css, /\[data-font-size='small'\][\s\S]*?--doc-area-font-size:\s*9px/);
        assert.match(css, /\[data-font-size='normal'\][\s\S]*?--doc-area-font-size:\s*11px/);
        assert.match(css, /\[data-font-size='large'\][\s\S]*?--doc-area-font-size:\s*14px/);
        assert.match(
            css,
            /\.graph-panel-doc-area__body\s*\{[^}]*font-size:\s*var\(--doc-area-font-size,\s*11px\)/
        );
        assert.match(
            css,
            /\.graph-panel-doc-chrome__editor\s*\{[^}]*font-size:\s*var\(--doc-area-font-size,\s*11px\)/
        );
        assert.match(css, /\.graph-panel-doc-area__body h1\s*\{[^}]*\+\s*4px/);
        assert.match(css, /\.graph-panel-doc-area__body h2\s*\{[^}]*\+\s*3px/);
        assert.match(css, /\.graph-panel-doc-area__body h3\s*\{[^}]*\+\s*2px/);
        assert.match(css, /\.graph-panel-doc-area__title\s*\{[^}]*font-size:\s*16px/);
        assert.match(css, /\.graph-panel-doc-chrome__title-editor\s*\{[^}]*font-size:\s*16px/);
        assert.match(
            css,
            /\.graph-panel-doc-area__header\s*\{[^}]*justify-content:\s*center[^}]*padding:\s*4px\s+32px/
        );
        assert.match(css, /\.graph-panel-doc-area__title\s*\{[^}]*text-align:\s*center/);
        assert.match(css, /\.graph-panel-doc-chrome__menu\s*\{[^}]*top:\s*4px/);
        assert.match(css, /\.graph-panel-doc-chrome__menu\s*\{[^}]*width:\s*24px/);
        assert.match(css, /\.graph-panel-doc-chrome__menu\s*\{[^}]*height:\s*24px/);
        assert.match(
            css,
            /\.graph-panel-doc-chrome__menu img,\s*\.graph-panel-doc-chrome__menu svg\s*\{[^}]*width:\s*20px[^}]*height:\s*20px/
        );
        assert.match(
            css,
            /\.graph-panel-doc-chrome__title-editor\s*\{[^}]*right:\s*32px[^}]*left:\s*32px[^}]*text-align:\s*center/
        );
    });

});
