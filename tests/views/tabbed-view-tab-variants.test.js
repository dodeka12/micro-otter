// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file TabbedView must expose opaque per-tab presentation variants as `data-tab-variant`.
 *
 * The component trims the hook and omits empty values, but otherwise passes the token
 * through unchanged. Styling and validation belong to the consumer.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDomHarness } from '../helpers/dom-harness.js';
import { TabbedView } from '../../src/micro_otter/nodes/html/js/views/tabbed-view.js';
import { ViewBase } from '../../src/micro_otter/nodes/html/js/views/view-base.js';

const STANDARD_STYLES_URL = new URL(
    '../../src/micro_otter/nodes/html/styles/standard/',
    import.meta.url
);

/**
 * Read a stylesheet from the standard theme.
 * @param {string} name Stylesheet filename.
 * @returns {string} Stylesheet source.
 */
function readStandardStyle(name) {
    return readFileSync(new URL(name, STANDARD_STYLES_URL), 'utf8');
}

class TestView extends ViewBase {
    render() {}
}

describe('TabbedView tab variants', () => {
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
     * Build a view whose presentation variant is the supplied value.
     * @param {string} id View id.
     * @param {unknown} tabVariant Value assigned to the presentation hook.
     * @returns {TestView} View ready for a TabbedView.
     */
    function createView(id, tabVariant) {
        const view = new TestView({ id, title: `Tab ${id}` });
        view.tabVariant = tabVariant;
        return view;
    }

    /**
     * Attach a tabbed view containing the supplied views.
     * @param {TestView[]} views Views to render.
     * @returns {TabbedView} Attached tabbed view.
     */
    function attachTabs(views) {
        const tabbed = new TabbedView({ views, activeId: views[0]?.id ?? null });
        tabbed.attachTo(container);
        return tabbed;
    }

    /**
     * Look up a rendered tab element by view id.
     * @param {string} viewId View id of the tab.
     * @returns {HTMLElement} Tab element.
     */
    function tabFor(viewId) {
        const tab = container.querySelector(`.tabbed-view__tab[data-view-id="${viewId}"]`);
        assert.ok(tab, `tab ${viewId} must be rendered`);
        return tab;
    }

    it('renders the exact variant token on the existing tab element', () => {
        attachTabs([createView('tab-1', 'startup')]);
        const tab = tabFor('tab-1');

        assert.equal(tab.dataset.tabVariant, 'startup');
        assert.equal(tab.classList.contains('tabbed-view__tab'), true);
        assert.equal(tab.querySelector('.tabbed-view__tab-label').textContent, 'Tab tab-1');
    });

    it('keeps each tab variant independent', () => {
        attachTabs([
            createView('startup-tab', 'startup'),
            createView('loop-tab', 'continuous'),
            createView('irq-tab', 'irq'),
        ]);

        assert.equal(tabFor('startup-tab').dataset.tabVariant, 'startup');
        assert.equal(tabFor('loop-tab').dataset.tabVariant, 'continuous');
        assert.equal(tabFor('irq-tab').dataset.tabVariant, 'irq');
    });

    it('omits the attribute for undefined, null, empty, and whitespace-only values', () => {
        attachTabs([
            createView('undefined-tab', undefined),
            createView('null-tab', null),
            createView('empty-tab', ''),
            createView('whitespace-tab', ' \t\n '),
        ]);

        for (const id of ['undefined-tab', 'null-tab', 'empty-tab', 'whitespace-tab']) {
            assert.equal(
                tabFor(id).hasAttribute('data-tab-variant'),
                false,
                `${id} must not render data-tab-variant`
            );
        }
    });

    it('passes unknown tokens through unchanged after trimming', () => {
        attachTabs([createView('custom-tab', '  custom-token  ')]);

        assert.equal(tabFor('custom-tab').dataset.tabVariant, 'custom-token');
    });

    it('never attaches a variant to a control tab', () => {
        const tabbed = attachTabs([createView('tab-1', 'event')]);
        tabbed.setControls([{ id: 'add-graph', icon: '+', title: 'Add graph', align: 'end' }]);

        const control = container.querySelector(
            '.tabbed-view__tab--control[data-control-id="add-graph"]'
        );
        assert.ok(control, 'control tab must be rendered');
        assert.equal(control.hasAttribute('data-tab-variant'), false);
        assert.equal(tabFor('tab-1').dataset.tabVariant, 'event');
    });
});

describe('TabbedView execution tab styles', () => {
    const executionTypes = ['startup', 'continuous', 'irq', 'event', 'function'];
    const gradientSuffixes = ['bg', 'bg-hover', 'bg-active'];
    const tokenSuffixes = [...gradientSuffixes, 'border'];
    const aliasSuffixes = ['bg', 'bg-hover', 'bg-active', 'border'];

    it('defines all twenty execution tint tokens in the standard theme', () => {
        const viewSystemCss = readStandardStyle('view-system.css');

        for (const type of executionTypes) {
            for (const suffix of tokenSuffixes) {
                const token = `--mo-tab-execution-${type}-${suffix}`;
                assert.match(
                    viewSystemCss,
                    new RegExp(`${token}:\\s*[^;]+;`),
                    `${token} must be defined`
                );
            }
        }
    });

    it('defines every gradient token with a gradient and rgba stops', () => {
        const viewSystemCss = readStandardStyle('view-system.css');

        for (const type of executionTypes) {
            for (const suffix of gradientSuffixes) {
                const token = `--mo-tab-execution-${type}-${suffix}`;
                const match = viewSystemCss.match(new RegExp(`${token}:\\s*([^;]+);`));
                assert.ok(match, `${token} must be defined`);
                assert.match(match[1], /linear-gradient\(/, `${token} must be a gradient`);
                assert.match(match[1], /rgba\(/, `${token} must use rgba stops`);
            }
        }
    });

    it('maps each tab variant selector to its matching tokens', () => {
        const tabbedViewCss = readStandardStyle('tabbed-view.css');

        for (const type of executionTypes) {
            const selector = new RegExp(
                `\\.tabbed-view__tab\\[data-tab-variant='${type}'\\]\\s*\\{([^}]*)\\}`
            );
            const match = tabbedViewCss.match(selector);
            assert.ok(match, `${type} variant mapping must exist`);

            for (const suffix of aliasSuffixes) {
                assert.match(
                    match[1],
                    new RegExp(
                        `--tab-variant-${suffix}:\\s*var\\(--mo-tab-execution-${type}-${suffix}\\);`
                    ),
                    `${type} mapping must reference --mo-tab-execution-${type}-${suffix}`
                );
            }
        }
    });

    it('applies base, hover/focus, then active variant rules in source order', () => {
        const tabbedViewCss = readStandardStyle('tabbed-view.css');
        const baseIndex = tabbedViewCss.indexOf('.tabbed-view__tab[data-tab-variant] {');
        const hoverIndex = tabbedViewCss.indexOf('.tabbed-view__tab[data-tab-variant]:hover');
        const activeIndex = tabbedViewCss.indexOf(
            '.tabbed-view__tab[data-tab-variant].is-active {'
        );

        assert.ok(baseIndex >= 0, 'base variant rule must exist');
        assert.ok(hoverIndex > baseIndex, 'hover/focus rule must follow the base rule');
        assert.ok(activeIndex > hoverIndex, 'active rule must follow the hover/focus rule');
    });
});
