// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FirmwareBuildView } from '../../../src/micro_otter/nodes/html/js/views/firmware-build-view.js';
import {
    createFakeClient,
    createOptions,
    createRuntime,
    createStore,
    readySnapshot,
    setupDom,
    teardownDom,
    tick,
} from './fixtures.js';

const SECTION_TITLES = [
    'firmwareBuild.help.title',
    'firmwareBuild.target.label',
    'firmwareBuild.inventory.title',
    'firmwareBuild.deploy.title',
    'firmwareBuild.packages.title',
];

describe('FirmwareBuildView sections', () => {
    let dom;
    let container;

    beforeEach(() => {
        ({ dom, container } = setupDom());
        global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ schemaVersion: 1, boards: [] }) });
    });

    afterEach(() => {
        teardownDom({ dom, container });
    });

    async function render(store = createStore(readySnapshot())) {
        const view = new FirmwareBuildView(
            createOptions({ store, runtime: createRuntime(), client: createFakeClient() })
        );
        view.attachTo(container);
        await tick();
        await tick();
        return view;
    }

    /** The pane collapsibles in DOM order, one per section. */
    const panes = () => [...container.querySelectorAll('.split-view__pane > .collapsible-view')];

    /** The pane collapsible that hosts the given section root class. */
    const paneOf = (rootClass) =>
        container.querySelector(rootClass).closest('.collapsible-view');

    it('composes five collapsible panes in the documented order', async () => {
        const view = await render();

        assert.equal(container.querySelectorAll('.split-view').length, 1, 'one split view hosts the panes');
        assert.equal(panes().length, 5, 'one pane per section');
        assert.equal(container.querySelectorAll('.split-view__splitter').length, 4);

        const titles = panes().map(
            (pane) => pane.querySelector('.collapsible-view__title').textContent
        );
        assert.deepEqual(titles, SECTION_TITLES);

        assert.equal(container.querySelector('.firmware-build-view__log'), null, 'no shared log section');
        view.detach();
    });

    it('starts Help collapsed and renders the Markdown body there', async () => {
        const view = await render();
        const help = paneOf('.firmware-build-view__help');

        assert.ok(help.classList.contains('is-collapsed'));
        const markdown = help.querySelector('.view-markdown');
        assert.ok(markdown, 'the Help pane renders a MarkdownView');
        assert.equal(markdown.textContent, 'firmwareBuild.help.body');
        view.detach();
    });

    it('builds the offline reference section beside the panes, outside the split', async () => {
        const view = await render();
        const offline = container.querySelector('.firmware-build-view__offline');

        assert.ok(offline, 'the offline host exists even while the server is ready');
        assert.equal(offline.hidden, true, 'it is hidden while the panes are shown');
        assert.equal(
            offline.closest('.split-view'),
            null,
            'the offline section never becomes a split pane'
        );

        const marks = offline.querySelectorAll('.view-markdown');
        assert.equal(marks.length, 1, 'one explainer Markdown view');
        assert.equal(marks[0].textContent, 'firmwareBuild.offline.body');
        assert.equal(container.querySelector('.firmware-build-view__header'), null, 'no tab header block');
        view.detach();
    });

    it('nests Packages, Installed add-ons and the Build log inside Build Firmware', async () => {
        const view = await render();
        const buildFirmware = container.querySelector('.firmware-build-view__build-firmware');
        const subCollapsibles = [...buildFirmware.querySelectorAll('.collapsible-view')];
        assert.equal(subCollapsibles.length, 3);

        const subTitles = subCollapsibles.map(
            (sub) => sub.querySelector('.collapsible-view__title').textContent
        );
        assert.deepEqual(subTitles, [
            'firmwareBuild.buildFirmware.packages',
            'firmwareBuild.buildFirmware.addons',
            'firmwareBuild.buildFirmware.buildLog',
        ]);
        view.detach();
    });

    it('sizes every pane to its content, like the Settings tab', async () => {
        const view = await render();

        for (const pane of panes()) {
            assert.ok(
                pane.classList.contains('collapsible-view--fit-content'),
                `${pane.className} should opt into sizeToContent`
            );
        }
        view.detach();
    });

    it('renders the three Build Firmware sub-sections with the nested variant', async () => {
        const view = await render();
        const buildFirmware = container.querySelector('.firmware-build-view__build-firmware');
        const subCollapsibles = [...buildFirmware.querySelectorAll('.collapsible-view')];

        assert.equal(subCollapsibles.length, 3);
        for (const sub of subCollapsibles) {
            assert.ok(
                sub.classList.contains('collapsible-view--nested'),
                `${sub.className} should carry the nested variant`
            );
            assert.ok(
                sub.classList.contains('collapsible-view--fit-content'),
                `${sub.className} should size to its content`
            );
            assert.equal(
                sub.querySelector('.collapsible-view__header').style.height,
                '24px',
                'the nested log sub-sections keep their deliberate 24px header'
            );
        }
        view.detach();
    });

    it('keeps the five pane sections on the default header variant', async () => {
        const view = await render();

        for (const pane of panes()) {
            assert.equal(pane.classList.contains('collapsible-view--nested'), false);
            assert.equal(
                pane.querySelector('.collapsible-view__header').style.height,
                '28px',
                `${pane.className} should use the shared 28px header default`
            );
        }
        view.detach();
    });

    it('has no cross-cutting Result pane and no Result sub-sections', async () => {
        const view = await render();

        assert.equal(container.querySelector('.firmware-build-view__result'), null);
        for (const rootClass of [
            '.firmware-build-view__build-result',
            '.firmware-build-view__deploy-result',
            '.firmware-build-view__inventory-result',
        ]) {
            assert.equal(container.querySelector(rootClass), null, `${rootClass} should not exist`);
        }
        view.detach();
    });

    it('collapses only the toggled section', async () => {
        const view = await render();
        const targets = paneOf('.firmware-build-view__targets');
        const inventory = paneOf('.firmware-build-view__inventory');

        inventory.querySelector('.collapsible-view__toggle').click();

        assert.ok(inventory.classList.contains('is-collapsed'));
        assert.ok(!targets.classList.contains('is-collapsed'));
        view.detach();
    });

    it('gives the space freed by content-capped panes to the pane that still needs it', async () => {
        const originalGetBoundingClientRect =
            dom.window.HTMLElement.prototype.getBoundingClientRect;

        try {
            // Real layout cannot run in JSDOM, so the measured heights are stubbed: a 900px tab,
            // a short Help header and a tall Build Firmware section that cannot fit. In fit-content
            // mode the content root of a `ContentView` pane is measured through its
            // `.content-view-wrapper`, which therefore reports the section root's height.
            const sectionHeights = new Map([
                ['firmware-build-view__help', 0],
                ['firmware-build-view__targets', 150],
                ['firmware-build-view__inventory-group', 160],
                ['firmware-build-view__deploy', 180],
                ['firmware-build-view__build-firmware', 700],
            ]);
            dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
                let height = 0;
                if (this.classList?.contains('split-view')) {
                    height = 900;
                } else {
                    const root = this.classList?.contains('content-view-wrapper')
                        ? this.firstElementChild
                        : this;
                    for (const [className, value] of sectionHeights) {
                        if (root?.classList?.contains(className)) {
                            height = value;
                            break;
                        }
                    }
                }
                return {
                    width: 800,
                    height,
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 800,
                    bottom: height,
                    toJSON: () => ({}),
                };
            };

            const view = await render();

            const panesEls = [...container.querySelectorAll('.split-view__pane')];
            assert.deepEqual(
                panesEls.map((pane) => pane.style.maxHeight),
                ['28px', '180px', '190px', '210px', '730px'],
                'every pane is capped at its 28px header plus its measured content'
            );

            // 900px tab minus the 4px inactive Help splitter, three 6px splitters, and eight 4px
            // gaps (five panes and four splitters). The span is 846px regardless of the header
            // height; Help is fixed at 28px, so the four flexible panes share the remaining 818px.
            const available = 900 - (4 + 18) - 32;
            const flexibleShare = (available - 28) / 4;
            const factors = panesEls.map((pane) => Number(pane.style.flexGrow));
            // Flex factors are ratios scaled by the smallest share, so every pane weighs at least
            // one and the space released by the capped panes still reaches Build Firmware. With
            // bare normalized ratios the flexible panes carried ~0.24, CSS Flexbox §9.7 handed out
            // only that fraction of the freed space, and the rest stayed empty below the panes.
            assert.ok(
                factors.every((factor) => factor >= 1 - 1e-9),
                `every pane factor should be at least 1 (got ${factors.join(', ')})`
            );
            assert.ok(
                Math.abs(factors[0] - 1) < 1e-6,
                `the collapsed Help pane sets the unit (got ${factors.join(', ')})`
            );
            for (const factor of factors.slice(1)) {
                assert.ok(Math.abs(factor - flexibleShare / 28) < 0.01);
            }
            assert.ok(
                Math.abs(
                    factors.reduce((sum, factor) => sum + factor, 0) - available / 28
                ) < 0.01,
                'flex factors should add up to the scale (span / fixed Help height)'
            );
            assert.equal(
                container.querySelector('.split-view__filler'),
                null,
                'no filler while the caps exceed the available span'
            );
            view.detach();
        } finally {
            dom.window.HTMLElement.prototype.getBoundingClientRect =
                originalGetBoundingClientRect;
        }
    });

    it('keeps the collapse state across a capability refresh', async () => {
        const store = createStore(readySnapshot());
        const view = await render(store);
        const targets = paneOf('.firmware-build-view__targets');
        const inventory = paneOf('.firmware-build-view__inventory');

        inventory.querySelector('.collapsible-view__toggle').click();
        assert.ok(inventory.classList.contains('is-collapsed'));

        store.listeners.forEach((listener) => listener());
        await tick();

        assert.ok(inventory.classList.contains('is-collapsed'));
        assert.ok(!targets.classList.contains('is-collapsed'));
        view.detach();
    });
});
