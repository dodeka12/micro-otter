// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for ProgressDetailView: the two determinate tiers, the ARIA contract, the clamping and
// message rules, the repaint-from-state behaviour on re-attach, serialization, and the
// registration of its stylesheet and ViewFactory entry.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { ProgressDetailView } from '../../src/micro_otter/nodes/html/js/views/progress-detail-view.js';
import { ViewFactory } from '../../src/micro_otter/nodes/html/js/views/view-factory.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlRoot = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html');
const viewPath = path.join(htmlRoot, 'js', 'views', 'progress-detail-view.ts');
const cssPath = path.join(htmlRoot, 'styles', 'standard', 'progress-detail-view.css');
const registryPath = path.join(htmlRoot, 'js', 'views', 'view-theme-registry.ts');
const themesPath = path.join(htmlRoot, 'styles', 'themes.json');

describe('ProgressDetailView', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;

        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
    });

    /**
     * Attach a component and return it.
     * @param {object} [options] Component options.
     * @returns {ProgressDetailView} The attached component.
     */
    function mount(options = {}) {
        const view = new ProgressDetailView({
            overallLabel: 'Overall',
            detailLabel: 'Detail',
            detailMessage: 'Waiting',
            ...options,
        });
        view.attachTo(container);
        return view;
    }

    const root = () => container.querySelector('.progress-detail-view');
    const bars = () => container.querySelectorAll('[role="progressbar"]');
    const tiers = () => container.querySelectorAll('.progress-detail-view__tier');
    const labels = () =>
        Array.from(container.querySelectorAll('.progress-detail-view__label')).map(
            (el) => el.textContent
        );
    const texts = () =>
        Array.from(container.querySelectorAll('.progress-detail-view__text')).map(
            (el) => el.textContent
        );

    it('renders two labelled tiers and a divider with the full ARIA contract', () => {
        mount();

        assert.ok(root(), 'root element');
        assert.equal(tiers().length, 2, 'two tiers');
        assert.deepEqual(labels(), ['Overall', 'Detail']);
        assert.deepEqual(texts(), ['', 'Waiting']);
        assert.equal(bars().length, 2, 'two determinate bars');

        const divider = container.querySelector('.progress-detail-view__divider');
        assert.ok(divider, 'divider exists');
        assert.equal(divider.getAttribute('role'), 'presentation');

        const expectedLabels = ['Overall', 'Detail'];
        const expectedValueTexts = ['', 'Waiting'];
        for (const [index, bar] of Array.from(bars()).entries()) {
            assert.equal(bar.getAttribute('aria-label'), expectedLabels[index]);
            assert.equal(bar.getAttribute('aria-valuemin'), '0');
            assert.equal(bar.getAttribute('aria-valuemax'), '100');
            assert.equal(bar.getAttribute('aria-valuenow'), '0');
            assert.equal(bar.getAttribute('aria-valuetext'), expectedValueTexts[index]);
        }
        assert.equal(
            container.querySelector('.progress-detail-view__bar-wrapper').firstElementChild,
            bars()[0],
            'the bar lives inside the wrapper'
        );
    });

    it('paints the overall tier without touching the detail tier', () => {
        const view = mount();

        view.setOverall(42, 'Writing file 3 of 7');

        const [overallBar, detailBar] = bars();
        assert.equal(overallBar.style.width, '42%');
        assert.equal(overallBar.getAttribute('aria-valuenow'), '42');
        assert.equal(overallBar.getAttribute('aria-valuetext'), 'Writing file 3 of 7');
        assert.equal(texts()[0], 'Writing file 3 of 7');
        assert.equal(detailBar.style.width, '0%', 'detail tier unchanged');
        assert.equal(texts()[1], 'Waiting');
        assert.deepEqual(view.overall, { progress: 42, message: 'Writing file 3 of 7' });
        assert.deepEqual(view.detail, { progress: 0, message: 'Waiting' });
    });

    it('paints the detail tier independently of the overall tier', () => {
        const view = mount();
        view.setOverall(42, 'overall');

        view.setDetail(17, 'sending main.py');

        const [overallBar, detailBar] = bars();
        assert.equal(overallBar.style.width, '42%', 'overall tier unchanged');
        assert.equal(detailBar.style.width, '17%');
        assert.equal(detailBar.getAttribute('aria-valuenow'), '17');
        assert.equal(detailBar.getAttribute('aria-valuetext'), 'sending main.py');
        assert.equal(texts()[1], 'sending main.py');
    });

    it('clamps percentages and keeps the previous width for non-finite values', () => {
        const view = mount();

        view.setOverall(-5, 'under');
        assert.equal(bars()[0].getAttribute('aria-valuenow'), '0');

        view.setOverall(150, 'over');
        assert.equal(bars()[0].getAttribute('aria-valuenow'), '100');

        view.setOverall(33.3, 'fractional');
        assert.equal(bars()[0].getAttribute('aria-valuenow'), '33.3');

        view.setOverall(Number.NaN, 'nan');
        assert.equal(
            bars()[0].getAttribute('aria-valuenow'),
            '33.3',
            'NaN keeps the previous value'
        );
        assert.equal(texts()[0], 'nan', 'the message still updates');

        view.setDetail(Number.POSITIVE_INFINITY, 'infinite');
        assert.equal(bars()[1].getAttribute('aria-valuenow'), '0', 'Infinity keeps the initial 0');
    });

    it('replaces both messages without touching the bar widths', () => {
        const view = mount();
        view.setOverall(42, 'overall');
        view.setDetail(9, 'detail');

        view.setMessages('failed overall', 'failed detail');

        assert.deepEqual(texts(), ['failed overall', 'failed detail']);
        assert.equal(bars()[0].style.width, '42%');
        assert.equal(bars()[1].style.width, '9%');
        assert.equal(bars()[0].getAttribute('aria-valuetext'), 'failed overall');
        assert.equal(bars()[1].getAttribute('aria-valuetext'), 'failed detail');
    });

    it('updates both labels and their bar aria-labels', () => {
        const view = mount();

        view.setOverallLabel('Total');
        view.setDetailLabel('Current step');

        assert.deepEqual(labels(), ['Total', 'Current step']);
        assert.equal(bars()[0].getAttribute('aria-label'), 'Total');
        assert.equal(bars()[1].getAttribute('aria-label'), 'Current step');
    });

    it('survives setters after detach and repaints the stored state on re-attach', () => {
        const view = mount();
        view.setOverall(64, 'before');

        view.detach();
        assert.doesNotThrow(() => view.setDetail(9, 'detached'));
        assert.doesNotThrow(() => view.setMessages('overall later', 'detail later'));
        assert.equal(root(), null);

        view.attachTo(container);

        assert.equal(bars()[0].style.width, '64%', 're-attached component replays its state');
        assert.equal(bars()[1].style.width, '9%');
        assert.deepEqual(texts(), ['overall later', 'detail later']);
        assert.equal(bars()[0].getAttribute('aria-valuenow'), '64');
        assert.equal(bars()[1].getAttribute('aria-valuenow'), '9');
    });

    it('round-trips labels and both tiers through serialize()/deserialize()', () => {
        const view = mount();
        view.setOverall(30, 'overall message');
        view.setDetail(12, 'detail message');

        const data = view.serialize();
        assert.equal(data.type, 'ProgressDetailView');
        assert.deepEqual(data.overall, { progress: 30, message: 'overall message' });
        assert.deepEqual(data.detail, { progress: 12, message: 'detail message' });

        const restored = ProgressDetailView.deserialize(data);
        restored.attachTo(container);

        assert.deepEqual(labels(), ['Overall', 'Detail']);
        assert.deepEqual(restored.serialize().overall, {
            progress: 30,
            message: 'overall message',
        });
        assert.deepEqual(restored.serialize().detail, { progress: 12, message: 'detail message' });
        assert.equal(bars()[0].style.width, '30%');
        assert.equal(bars()[1].style.width, '12%');
        assert.deepEqual(texts(), ['overall message', 'detail message']);
    });

    it('resolves through ViewFactory', () => {
        const factory = new ViewFactory({ i18nService: null });

        const view = factory.create({
            type: 'ProgressDetailView',
            overallLabel: 'Total',
            detailLabel: 'Now',
        });

        assert.ok(view instanceof ProgressDetailView);
        assert.equal(view.serialize().overallLabel, 'Total');
    });

    it('registers its stylesheet in the theme manifest and the fallback style list', () => {
        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        const registrySource = readFileSync(registryPath, 'utf8');

        assert.ok(existsSync(cssPath), 'stylesheet exists (wheel payload)');
        assert.ok(manifest.styles.includes('progress-detail-view'));
        assert.match(registrySource, /['"]progress-detail-view['"]/);
    });

    it('styles every class it renders as plain content with no positioning', () => {
        const source = readFileSync(viewPath, 'utf8');
        const css = readFileSync(cssPath, 'utf8');
        const classes = new Set(
            [...source.matchAll(/'(progress-detail-view(?:__[\w-]+)?)'/g)].map((m) => m[1])
        );

        assert.ok(classes.has('progress-detail-view'));
        assert.ok(classes.has('progress-detail-view__bar'));
        assert.ok(classes.has('progress-detail-view__divider'));
        for (const cls of classes) {
            assert.ok(css.includes(`.${cls}`), `missing rule for .${cls}`);
        }

        const rootRule = css.match(/\.progress-detail-view\s*\{([^}]*)\}/);
        assert.ok(rootRule, 'root rule exists');
        assert.match(rootRule[1], /width:\s*100%/);
        assert.match(rootRule[1], /box-sizing:\s*border-box/);
        assert.match(rootRule[1], /flex-direction:\s*column/);
        assert.equal(/background/.test(rootRule[1]), false, 'the host owns the surface');
        assert.equal(/border-radius/.test(rootRule[1]), false, 'no nested panel');
        assert.equal(/padding/.test(rootRule[1]), false, 'no nested padding');
        assert.equal(/position\s*:/.test(css), false, 'the host owns placement');
        assert.match(css, /linear-gradient/, 'determinate fill keeps its gradient');
    });
});
