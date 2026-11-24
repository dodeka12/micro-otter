// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for DeploymentProgressDialogView: the phase line, the two determinate tiers, the
// non-dismissible header, the repaint-from-state contract the controller relies on, and the
// registration of its stylesheet and its ViewFactory entry.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { DeploymentProgressDialogView } from '../../src/micro_otter/nodes/html/js/views/deployment-progress-dialog-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';
import { ViewFactory } from '../../src/micro_otter/nodes/html/js/views/view-factory.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlRoot = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html');
const viewPath = path.join(htmlRoot, 'js', 'views', 'deployment-progress-dialog-view.ts');
const registryPath = path.join(htmlRoot, 'js', 'views', 'view-theme-registry.ts');
const themesPath = path.join(htmlRoot, 'styles', 'themes.json');
const cssPath = path.join(htmlRoot, 'styles', 'standard', 'deployment-progress-dialog.css');
const detailCssPath = path.join(htmlRoot, 'styles', 'standard', 'progress-detail-view.css');
const detailViewPath = path.join(htmlRoot, 'js', 'views', 'progress-detail-view.ts');

const LOCALES = {
    en: JSON.parse(readFileSync(path.join(htmlRoot, 'locales', 'en.json'), 'utf8')),
    de: JSON.parse(readFileSync(path.join(htmlRoot, 'locales', 'de.json'), 'utf8')),
};

/**
 * Resolve a dotted key in a locale tree.
 * @param {object} tree Locale document.
 * @param {string} key Dotted key.
 */
function lookup(tree, key) {
    return key.split('.').reduce((node, part) => (node == null ? node : node[part]), tree);
}

/**
 * i18n double over the shipped locale files, so the assertions read like the UI.
 * @param {'en'|'de'} locale Initial locale.
 */
function createI18n(locale = 'en') {
    return {
        currentLocale: locale,
        availableLocales: [],
        t(key, params = {}) {
            const value = lookup(LOCALES[locale], key);
            if (typeof value !== 'string') {
                return key;
            }
            return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? ''));
        },
        addEventListener() {},
        removeEventListener() {},
    };
}

describe('DeploymentProgressDialogView', () => {
    let dom;
    let container;
    let i18n;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;
        i18n = createI18n('en');

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
     * Attach a dialog and return it.
     * @param {object} [options] Dialog options.
     * @returns {DeploymentProgressDialogView} The attached dialog.
     */
    function mount(options = {}) {
        const dialog = new DeploymentProgressDialogView({
            title: 'Sync Collection',
            i18nService: i18n,
            ...options,
        });
        dialog.attachTo(container);
        return dialog;
    }

    const root = () => container.querySelector('.deployment-progress-dialog');
    const phaseEl = () => container.querySelector('.deployment-progress-dialog__phase');
    const bars = () => container.querySelectorAll('.progress-detail-view [role="progressbar"]');
    const labels = () =>
        Array.from(container.querySelectorAll('.progress-detail-view__label')).map(
            (el) => el.textContent
        );
    const texts = () =>
        Array.from(container.querySelectorAll('.progress-detail-view__text')).map(
            (el) => el.textContent
        );

    it('renders a non-dismissible header with the deploy icon and the given title', () => {
        mount();

        assert.equal(
            container.querySelector('.modal-dialog').getAttribute('aria-label'),
            'Sync Collection'
        );
        const img = container.querySelector('.modal-dialog__icon img.modal-dialog__icon-img');
        assert.ok(img, 'header icon rendered as an image');
        assert.equal(img.getAttribute('src'), IconProvider.deployCollection);
        assert.equal(
            container.querySelector('.modal-dialog__btn--icon'),
            null,
            'a running write offers no close affordance'
        );
    });

    it('hosts the generic ProgressDetailView instead of hand-rolling the tiers', () => {
        mount();

        const body = root();
        assert.equal(body.children[0].className, 'deployment-progress-dialog__phase');
        assert.equal(body.children[1].className, 'deployment-progress-dialog__detail');
        assert.equal(
            body.children[1].firstElementChild.className,
            'progress-detail-view',
            'the detail component sits inside the dialog slot'
        );
        assert.equal(container.querySelectorAll('.progress-detail-view').length, 1);
        assert.equal(container.querySelectorAll('.progress-detail-view__tier').length, 2);
        assert.equal(
            container.querySelectorAll('.deployment-progress-dialog__tier').length,
            0,
            'the dialog no longer builds its own tiers'
        );
        assert.equal(container.querySelectorAll('.deployment-progress-dialog__bar').length, 0);
    });

    it('renders both tier labels and the idle file text from the locale files', () => {
        mount();

        assert.deepEqual(labels(), [
            lookup(LOCALES.en, 'deployment.progressOverall'),
            lookup(LOCALES.en, 'deployment.progressCurrentFile'),
        ]);
        assert.deepEqual(texts(), ['', lookup(LOCALES.en, 'deployment.progressFileIdle')]);
        assert.equal(bars().length, 2, 'two determinate bars');
        for (const bar of bars()) {
            assert.equal(bar.getAttribute('aria-valuemin'), '0');
            assert.equal(bar.getAttribute('aria-valuemax'), '100');
            assert.equal(bar.getAttribute('aria-valuenow'), '0');
        }
    });

    it('paints the overall tier without touching the file tier', () => {
        const dialog = mount();

        dialog.setOverall(42, 'Writing file 3 of 7');

        const [overallBar, fileBar] = bars();
        assert.equal(overallBar.style.width, '42%');
        assert.equal(overallBar.getAttribute('aria-valuenow'), '42');
        assert.equal(overallBar.getAttribute('aria-valuetext'), 'Writing file 3 of 7');
        assert.equal(texts()[0], 'Writing file 3 of 7');
        assert.equal(fileBar.style.width, '0%', 'file tier unchanged');
        assert.equal(texts()[1], lookup(LOCALES.en, 'deployment.progressFileIdle'));
    });

    it('paints the file tier independently of the overall tier', () => {
        const dialog = mount();
        dialog.setOverall(42, 'overall');

        dialog.setFile(17, 'sending main.py');

        const [overallBar, fileBar] = bars();
        assert.equal(overallBar.style.width, '42%', 'overall tier unchanged');
        assert.equal(fileBar.style.width, '17%');
        assert.equal(fileBar.getAttribute('aria-valuenow'), '17');
        assert.equal(texts()[1], 'sending main.py');
    });

    it('clamps percentages and ignores non-finite values', () => {
        const dialog = mount();

        dialog.setOverall(-5, 'under');
        assert.equal(bars()[0].getAttribute('aria-valuenow'), '0');

        dialog.setOverall(150, 'over');
        assert.equal(bars()[0].getAttribute('aria-valuenow'), '100');

        dialog.setOverall(33.3, 'fractional');
        assert.equal(bars()[0].getAttribute('aria-valuenow'), '33.3');

        dialog.setOverall(Number.NaN, 'nan');
        assert.equal(
            bars()[0].getAttribute('aria-valuenow'),
            '33.3',
            'NaN keeps the previous value'
        );
        assert.equal(texts()[0], 'nan', 'the message still updates');
    });

    it('marks completion with full bars and the completion class', () => {
        const dialog = mount();
        dialog.setOverall(42, 'partial');

        dialog.markComplete('Collection synced');

        assert.equal(phaseEl().textContent, 'Collection synced');
        assert.equal(root().classList.contains('is-complete'), true);
        assert.equal(root().classList.contains('is-error'), false);
        for (const bar of bars()) {
            assert.equal(bar.style.width, '100%');
            assert.equal(bar.getAttribute('aria-valuenow'), '100');
        }
        assert.deepEqual(texts(), ['Collection synced', 'Collection synced']);
    });

    it('marks an error without resetting the bar widths, and setPhase clears the highlight', () => {
        const dialog = mount();
        dialog.setOverall(42, 'partial');
        dialog.setFile(9, 'sending main.py');

        dialog.markError('Device disconnected');

        assert.equal(phaseEl().textContent, 'Device disconnected');
        assert.equal(phaseEl().classList.contains('is-error'), true);
        assert.equal(root().classList.contains('is-error'), true);
        assert.equal(bars()[0].style.width, '42%', 'failure keeps the overall width');
        assert.equal(bars()[1].style.width, '9%', 'failure keeps the file width');

        dialog.setPhase('Retrying');
        assert.equal(root().classList.contains('is-error'), false);
        assert.equal(phaseEl().classList.contains('is-error'), false);
    });

    it('falls back to the raw keys without throwing when no i18n service is attached', () => {
        const dialog = new DeploymentProgressDialogView({ title: 'No i18n' });

        assert.doesNotThrow(() => dialog.attachTo(container));

        assert.deepEqual(labels(), [
            'deployment.progressOverall',
            'deployment.progressCurrentFile',
        ]);
        assert.deepEqual(texts(), ['', 'deployment.progressFileIdle']);
    });

    it('round-trips phase, state and both tiers through serialize()/deserialize()', () => {
        const dialog = mount();
        dialog.setPhase('Syncing collection: Demo');
        dialog.setOverall(30, 'overall message');
        dialog.setFile(12, 'file message');

        const data = dialog.serialize();
        const restored = DeploymentProgressDialogView.deserialize(data, null, {
            i18nService: i18n,
        });
        restored.attachTo(container);

        assert.equal(restored.title, dialog.title);
        assert.equal(restored.serialize().phase, 'Syncing collection: Demo');
        assert.equal(restored.serialize().phaseState, 'running');
        assert.deepEqual(restored.serialize().overall, {
            progress: 30,
            message: 'overall message',
        });
        assert.deepEqual(restored.serialize().file, { progress: 12, message: 'file message' });
        assert.equal(phaseEl().textContent, 'Syncing collection: Demo');
        assert.equal(bars()[0].style.width, '30%');
        assert.equal(bars()[1].style.width, '12%');
    });

    it('keeps the footer hidden and the Escape policy disabled', () => {
        const dialog = mount();
        const footer = container.querySelector('.deployment-progress-dialog__footer');

        assert.ok(footer, 'footer element exists for ModalDialogView');
        assert.equal(footer.hidden, true);
        assert.equal(footer.children.length, 0, 'no footer buttons');

        const events = [];
        for (const name of ['confirm', 'cancel', 'close']) {
            dialog.on(name, () => events.push(name));
        }
        container
            .querySelector('.modal-dialog')
            .dispatchEvent(
                new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
            );
        assert.deepEqual(events, [], 'Escape cannot cancel a running write');

        dialog.close();
        assert.deepEqual(events, ['close'], 'programmatic close still emits close');
    });

    it('survives setters after detach and repaints the stored state on re-attach', () => {
        const dialog = mount();

        dialog.detach();
        assert.doesNotThrow(() => dialog.setOverall(64, 'later'));
        assert.doesNotThrow(() => dialog.markError('boom'));
        assert.equal(container.querySelector('.deployment-progress-dialog'), null);

        dialog.attachTo(container);

        assert.equal(
            container.querySelector('.deployment-progress-dialog__phase').textContent,
            'boom'
        );
        assert.equal(bars()[0].style.width, '64%', 're-attached dialog replays its state');
        assert.equal(root().classList.contains('is-error'), true);
        assert.equal(
            container.querySelectorAll('.progress-detail-view').length,
            1,
            'the hosted component is attached exactly once'
        );
    });

    it('registers both stylesheets in the theme manifest and the fallback style list', () => {
        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        const registrySource = readFileSync(registryPath, 'utf8');

        assert.ok(existsSync(cssPath), 'dialog stylesheet exists (wheel payload)');
        assert.ok(existsSync(detailCssPath), 'detail stylesheet exists (wheel payload)');
        assert.ok(manifest.styles.includes('deployment-progress-dialog'));
        assert.ok(manifest.styles.includes('progress-detail-view'));
        assert.match(registrySource, /['"]deployment-progress-dialog['"]/);
        assert.match(registrySource, /['"]progress-detail-view['"]/);
    });

    it('styles only its own chrome and leaves the bars to ProgressDetailView', () => {
        const source = readFileSync(viewPath, 'utf8');
        const css = readFileSync(cssPath, 'utf8');
        const detailCss = readFileSync(detailCssPath, 'utf8');
        const detailSource = readFileSync(detailViewPath, 'utf8');
        const classes = new Set(
            [...source.matchAll(/'(deployment-progress-dialog(?:__[\w-]+)?)'/g)].map((m) => m[1])
        );

        assert.ok(classes.has('deployment-progress-dialog'));
        assert.ok(classes.has('deployment-progress-dialog__phase'));
        assert.ok(classes.has('deployment-progress-dialog__detail'));
        assert.ok(classes.has('deployment-progress-dialog__footer'));
        assert.equal(
            classes.has('deployment-progress-dialog__bar'),
            false,
            'the dialog no longer renders bar classes'
        );
        for (const cls of classes) {
            assert.ok(css.includes(`.${cls}`), `missing rule for .${cls}`);
        }

        const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
        const rootRule = declarations.match(/\.deployment-progress-dialog\s*\{([^}]*)\}/);
        assert.ok(rootRule, 'dialog root rule exists');
        assert.match(rootRule[1], /width:\s*100%/);
        assert.match(rootRule[1], /box-sizing:\s*border-box/);
        assert.equal(
            /background/.test(declarations),
            false,
            'the modal surface owns the background'
        );
        assert.equal(/border-radius/.test(declarations), false, 'no nested rounded panel');
        assert.equal(/padding/.test(declarations), false, 'no nested inset');
        assert.equal(
            /__bar/.test(declarations),
            false,
            'bar styles live in progress-detail-view.css'
        );
        assert.equal(/position\s*:/.test(declarations), false, 'the modal layer owns placement');

        assert.match(detailSource, /progress-detail-view__bar/);
        assert.match(detailCss, /\.progress-detail-view__bar\s*\{/);
        assert.match(detailCss, /linear-gradient/, 'determinate fill keeps its gradient');
    });

    it('resolves through ViewFactory and keeps its title', () => {
        const factory = new ViewFactory({ i18nService: i18n });

        const view = factory.create({
            type: 'DeploymentProgressDialogView',
            title: 'Upgrade Runtime',
        });

        assert.ok(view instanceof DeploymentProgressDialogView);
        assert.equal(view.title, 'Upgrade Runtime');
    });
});
