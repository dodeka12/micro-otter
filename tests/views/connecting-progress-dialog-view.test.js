// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
//
// Tests for ConnectingProgressDialogView: status line, determinate progress, the state-dependent
// footer, every close rule, subscription cleanup, and the registration of its stylesheet and its
// ViewFactory entry.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { ConnectingProgressDialogView } from '../../src/micro_otter/nodes/html/js/views/connecting-progress-dialog-view.js';
import { ViewFactory } from '../../src/micro_otter/nodes/html/js/views/view-factory.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlRoot = path.join(repoRoot, 'src', 'micro_otter', 'nodes', 'html');
const registryPath = path.join(htmlRoot, 'js', 'views', 'view-theme-registry.ts');
const themesPath = path.join(htmlRoot, 'styles', 'themes.json');
const cssPath = path.join(htmlRoot, 'styles', 'standard', 'connecting-progress-dialog.css');

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

/**
 * Connection double matching the monitor surface the dialog reports.
 * @param {object} initial Snapshot fields.
 */
function createConnection(initial = {}) {
    const listeners = new Set();
    const onboardingListeners = new Set();
    const connection = {
        snapshot: {
            state: initial.state ?? 'connecting',
            progress: initial.progress ?? null,
            message: initial.message ?? null,
            providerKey: initial.providerKey ?? 'webserial',
            error: initial.error ?? null,
        },
        listeners,
        onboardingListeners,
        cancelCalls: 0,
        getSnapshot() {
            return { ...connection.snapshot };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        subscribeOnboardingPrompt(listener) {
            onboardingListeners.add(listener);
            return () => onboardingListeners.delete(listener);
        },
        cancelConnect() {
            connection.cancelCalls += 1;
            return true;
        },
        push(next) {
            connection.snapshot = { ...connection.snapshot, ...next };
            for (const listener of [...listeners]) {
                listener(connection.getSnapshot());
            }
        },
        promptOnboarding() {
            for (const listener of [...onboardingListeners]) {
                listener();
            }
        },
    };
    return connection;
}

describe('ConnectingProgressDialogView', () => {
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
     * Attach a dialog over a fake connection.
     * @param {object} connection Connection double.
     * @param {object} [options] Extra dialog options.
     * @returns {ConnectingProgressDialogView} The attached dialog.
     */
    function mount(connection, options = {}) {
        const dialog = new ConnectingProgressDialogView({
            connection,
            i18nService: i18n,
            ...options,
        });
        dialog.attachTo(container);
        return dialog;
    }

    const statusLine = () => container.querySelector('.connecting-progress-dialog__status');
    const detailHost = () => container.querySelector('.connecting-progress-dialog__detail');
    const bar = () => container.querySelector('.progress-detail-view [role="progressbar"]');
    const footerButton = () => container.querySelector('.modal-dialog__footer button');

    it('renders the localized title, cable icon and one status line', () => {
        const connection = createConnection({ state: 'loading' });
        mount(connection);

        const dialog = container.querySelector('.modal-dialog');
        assert.equal(dialog.getAttribute('aria-label'), 'Connecting Device');
        assert.equal(container.querySelectorAll('.connecting-progress-dialog__status').length, 1);
        assert.equal(statusLine().getAttribute('role'), 'status');
        assert.equal(statusLine().getAttribute('aria-live'), 'polite');
        assert.equal(statusLine().textContent, 'Loading device information...');
        assert.equal(container.querySelectorAll('.modal-dialog__footer button').length, 1);
    });

    it('uses the tracker message as the status line when one is present', () => {
        const connection = createConnection({
            state: 'loading',
            progress: 55,
            message: 'Reading device information',
        });
        mount(connection);

        assert.equal(statusLine().textContent, 'Reading device information');
    });

    it('hides the progress slot without a finite percentage', () => {
        const connection = createConnection({ state: 'loading', progress: null });
        const dialog = mount(connection);

        assert.equal(detailHost().hidden, true);
        assert.ok(bar(), 'the hosted bar stays in the hidden slot');

        connection.push({ progress: 0, message: 'Reading device information' });
        assert.equal(detailHost().hidden, false);
        assert.equal(bar().style.width, '0%');

        connection.push({ progress: 55 });
        assert.equal(bar().style.width, '55%');
        assert.equal(bar().getAttribute('aria-valuenow'), '55');

        connection.push({ progress: null });
        assert.equal(detailHost().hidden, true);
        assert.equal(dialog.connection, connection);
    });

    it('paints the loading state of a dialog created mid-attempt', () => {
        const connection = createConnection({
            state: 'loading',
            progress: 42,
            message: 'Reading collections',
        });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        assert.equal(statusLine().textContent, 'Reading collections');
        assert.equal(detailHost().hidden, false);
        assert.equal(bar().style.width, '42%');
        assert.equal(footerButton().textContent, LOCALES.en.dialog.close);

        connection.push({ state: 'connected', progress: null, message: null });
        assert.equal(closes, 1, 'a mid-attempt dialog knows loading already happened');
    });

    it('labels the footer Cancel connecting and cancels exactly once on click', () => {
        const connection = createConnection({ state: 'connecting' });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        assert.equal(footerButton().textContent, LOCALES.en.deviceConnection.cancelConnecting);
        assert.equal(footerButton().classList.contains('modal-dialog__btn--primary'), true);

        footerButton().click();

        assert.equal(connection.cancelCalls, 1);
        assert.equal(closes, 1);
    });

    it('closes without cancelling while device information loads', () => {
        const connection = createConnection({ state: 'loading', progress: 30 });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        assert.equal(footerButton().textContent, LOCALES.en.dialog.close);
        assert.equal(footerButton().classList.contains('modal-dialog__btn--ghost'), true);

        footerButton().click();

        assert.equal(connection.cancelCalls, 0);
        assert.equal(closes, 1);
    });

    it('re-labels the footer when the state moves from connecting to loading', () => {
        const connection = createConnection({ state: 'connecting' });
        mount(connection);

        connection.push({ state: 'loading', progress: 0, message: 'Reading device information' });

        assert.equal(footerButton().textContent, LOCALES.en.dialog.close);
        assert.equal(footerButton().classList.contains('modal-dialog__btn--primary'), false);
        assert.equal(statusLine().textContent, 'Reading device information');
    });

    it('closes on error and on a user-cancel disconnected transition', () => {
        for (const state of ['error', 'disconnected']) {
            const connection = createConnection({ state: 'loading', progress: 20 });
            const dialog = mount(connection);
            let closes = 0;
            dialog.on('close', () => {
                closes += 1;
            });

            connection.push({ state });

            assert.equal(closes, 1, `${state} closes the dialog`);
            dialog.detach();
            container.replaceChildren();
        }
    });

    it('keeps the dialog open on connected until loading has been seen', () => {
        const connection = createConnection({ state: 'connecting' });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        connection.push({ state: 'connected' });
        assert.equal(closes, 0, 'a bridge re-emit must not close the progress surface');

        connection.push({ state: 'loading', progress: 10, message: 'Reading device information' });
        assert.equal(closes, 0);

        connection.push({ state: 'connected', progress: null, message: null });
        assert.equal(closes, 1);
    });

    it('closes on the pre-onboarding signal', () => {
        const connection = createConnection({ state: 'loading', progress: 40 });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        connection.promptOnboarding();

        assert.equal(closes, 1);
        assert.equal(connection.onboardingListeners.size, 0, 'close detaches the signal');
    });

    it('closes through markConnectSettled() when no loading was observed', () => {
        const connection = createConnection({ state: 'connected' });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        dialog.markConnectSettled();

        assert.equal(closes, 1);
    });

    it('leaves markConnectSettled() to a still-running attempt', () => {
        const connection = createConnection({ state: 'connecting' });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        dialog.markConnectSettled();
        assert.equal(closes, 0);

        connection.push({ state: 'loading', progress: 1 });
        dialog.markConnectSettled();
        assert.equal(closes, 0, 'loading owns the close through the connected transition');
    });

    it('emits one close event and detaches both subscriptions on repeated close', () => {
        const connection = createConnection({ state: 'loading' });
        const dialog = mount(connection);
        let closes = 0;
        dialog.on('close', () => {
            closes += 1;
        });

        dialog.close();
        dialog.close();

        assert.equal(closes, 1);
        assert.equal(connection.listeners.size, 0);
        assert.equal(connection.onboardingListeners.size, 0);
    });

    it('detaches both subscriptions when the view is detached', () => {
        const connection = createConnection({ state: 'loading' });
        const dialog = mount(connection);

        assert.equal(connection.listeners.size, 1);
        assert.equal(connection.onboardingListeners.size, 1);

        dialog.detach();

        assert.equal(connection.listeners.size, 0);
        assert.equal(connection.onboardingListeners.size, 0);
    });

    it('serializes with its own type', () => {
        const connection = createConnection({ state: 'loading' });
        const dialog = mount(connection);

        const data = dialog.serialize();

        assert.equal(data.type, 'ConnectingProgressDialogView');
        assert.equal(data.title, 'Connecting Device');
    });

    it('rehydrates through ViewFactory with the injected connection', () => {
        const connection = createConnection({ state: 'connecting' });
        const factory = new ViewFactory({ deviceConnection: connection, i18nService: i18n });

        const view = factory.create({ type: 'ConnectingProgressDialogView' });

        assert.ok(view instanceof ConnectingProgressDialogView);
        assert.equal(view.connection, connection);
        view.close();
    });

    it('names the missing connection service on a factory round trip', () => {
        const factory = new ViewFactory({ i18nService: i18n });

        assert.throws(
            () => factory.create({ type: 'ConnectingProgressDialogView' }),
            /device connection service/
        );
    });

    it('registers its stylesheet in the manifest, the fallback list and the factory', () => {
        const manifest = JSON.parse(readFileSync(themesPath, 'utf8'));
        const registrySource = readFileSync(registryPath, 'utf8');
        const factorySource = readFileSync(
            path.join(htmlRoot, 'js', 'views', 'view-factory.ts'),
            'utf8'
        );

        assert.ok(existsSync(cssPath), 'dialog stylesheet exists (wheel payload)');
        assert.ok(manifest.styles.includes('connecting-progress-dialog'));
        assert.match(registrySource, /['"]connecting-progress-dialog['"]/);
        assert.match(factorySource, /ConnectingProgressDialogView/);
    });

    it('styles only its own chrome and adds no positioning', () => {
        const css = readFileSync(cssPath, 'utf8');

        assert.match(css, /\.connecting-progress-dialog__status/);
        assert.match(css, /\.connecting-progress-dialog__detail/);
        assert.doesNotMatch(css, /(^|[\s;{])(position|z-index|inset)\s*:/m);
    });

    it('ships the title key in both locales', () => {
        for (const locale of ['en', 'de']) {
            assert.equal(
                typeof LOCALES[locale].deviceConnection.progressTitle,
                'string',
                `${locale} has deviceConnection.progressTitle`
            );
        }
    });
});
