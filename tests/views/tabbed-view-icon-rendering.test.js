// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Tab and control icons must render as images whenever the icon value is an image source.
 *
 * `IconProvider` answers inlined `data:` URIs for the registered SVG icons, so a classification
 * that only recognised file-system paths (`.svg`, `.png`, ...) treated every inlined icon as a
 * text glyph and printed the whole base64 document into the tab strip. Text/emoji icons stay text.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDomHarness } from '../helpers/dom-harness.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import { TabbedView } from '../../src/micro_otter/nodes/html/js/views/tabbed-view.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';

class TestView extends ViewBase {
    render() {}
}

describe('TabbedView icon rendering', () => {
    let harness;
    let container;

    beforeEach(() => {
        harness = createDomHarness();
        container = harness.document.createElement('div');
        harness.document.body.appendChild(container);
    });

    afterEach(() => {
        harness.cleanup();
    });

    /**
     * Build a one-tab view attached to the document.
     * @param {string} icon Icon value handed to the view metadata.
     * @returns {TabbedView} Attached instance.
     */
    function attachSingleTab(icon) {
        const view = new TestView({ id: 'tab-1', title: 'Tab One', icon });
        const tabbed = new TabbedView({ views: [view], activeId: 'tab-1' });
        tabbed.attachTo(container);
        return tabbed;
    }

    /**
     * Look up the rendered tab element of the single-tab fixture.
     * @param {string} viewId View id of the tab.
     * @returns {HTMLElement} Tab element.
     */
    function tabFor(viewId) {
        const tab = container.querySelector(`.tabbed-view__tab[data-view-id="${viewId}"]`);
        assert.ok(tab, `tab ${viewId} must be rendered`);
        return tab;
    }

    it('renders an inlined data: icon as an image and keeps the URI out of the text', () => {
        const inlined = IconProvider.palette;
        assert.equal(inlined.startsWith('data:image/svg+xml;base64,'), true, 'palette is inlined');

        attachSingleTab(inlined);
        const tab = tabFor('tab-1');

        const image = tab.querySelector('img.tabbed-view__tab-icon-image');
        assert.ok(image, 'an inlined icon must render as <img>');
        assert.equal(image.getAttribute('src'), inlined);
        assert.equal(tab.querySelector('.tabbed-view__tab-icon'), null, 'no text glyph');
        assert.equal(
            tab.textContent.includes('data:image'),
            false,
            'the URI must never become visible text'
        );
        assert.equal(tab.querySelector('.tabbed-view__tab-label').textContent, 'Tab One');
    });

    it('still renders a served image path as an image', () => {
        attachSingleTab(IconProvider.otterHead64Png);
        const image = tabFor('tab-1').querySelector('img.tabbed-view__tab-icon-image');
        assert.ok(image, 'a path icon must render as <img>');
        assert.match(image.getAttribute('src'), /micro-otter-head-64px\.png$/);
    });

    it('still renders a text or emoji icon as text', () => {
        attachSingleTab('+');
        const tab = tabFor('tab-1');
        const glyph = tab.querySelector('.tabbed-view__tab-icon');
        assert.ok(glyph, 'a text icon must stay a text glyph');
        assert.equal(glyph.textContent, '+');
        assert.equal(tab.querySelector('img.tabbed-view__tab-icon-image'), null);
    });

    it('renders an inlined control icon as an image', () => {
        const tabbed = attachSingleTab(IconProvider.palette);
        tabbed.setControls([{ id: 'add-graph', icon: IconProvider.add, title: 'Add graph' }]);

        const control = container.querySelector(
            '.tabbed-view__tab--control[data-control-id="add-graph"]'
        );
        assert.ok(control, 'control tab must be rendered');
        const image = control.querySelector('img.tabbed-view__control-icon');
        assert.ok(image, 'an inlined control icon must render as <img>');
        assert.equal(image.getAttribute('src'), IconProvider.add);
        assert.equal(control.querySelector('.tabbed-view__tab-icon'), null);
        assert.equal(control.textContent.includes('data:image'), false);
    });

    it('keeps a text control icon as text', () => {
        const tabbed = attachSingleTab(IconProvider.palette);
        tabbed.setControls([{ id: 'add-graph', icon: '+', title: 'Add graph', showLabel: true }]);

        const control = container.querySelector(
            '.tabbed-view__tab--control[data-control-id="add-graph"]'
        );
        assert.ok(control, 'control tab must be rendered');
        const glyph = control.querySelector('.tabbed-view__tab-icon');
        assert.ok(glyph, 'a text control icon must stay a text glyph');
        assert.equal(glyph.textContent, '+');
        assert.equal(control.querySelector('img.tabbed-view__control-icon'), null);
        assert.equal(control.textContent.includes('data:image'), false);
    });
});
