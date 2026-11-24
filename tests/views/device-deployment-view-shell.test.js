// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { DeviceDeploymentView } from '../../src/micro_otter/nodes/html/js/views/device-deployment-view.js';
import { DeviceState } from '../../src/micro_otter/nodes/html/js/data/device-state.js';

const EN = JSON.parse(
    readFileSync(
        new URL('../../src/micro_otter/nodes/html/locales/en.json', import.meta.url),
        'utf8'
    )
);
const DE = JSON.parse(
    readFileSync(
        new URL('../../src/micro_otter/nodes/html/locales/de.json', import.meta.url),
        'utf8'
    )
);
const VIEW_PATH = new URL(
    '../../src/micro_otter/nodes/html/js/views/device-deployment-view.ts',
    import.meta.url
);
const CSS_PATH = new URL(
    '../../src/micro_otter/nodes/html/styles/standard/device-deployment-view.css',
    import.meta.url
);

/**
 * Resolve a dotted translation key against a locale object.
 * @param {object} locale Locale data.
 * @param {string} key Dotted key.
 * @param {object} params Placeholder values.
 */
function translate(locale, key, params = {}) {
    const value = key.split('.').reduce((node, part) => (node == null ? node : node[part]), locale);
    if (typeof value !== 'string') {
        return key;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
        params[name] === undefined ? `{{${name}}}` : String(params[name])
    );
}

/**
 * Minimal i18n double over the shipped locales that dispatches languagechange.
 */
function createI18nService() {
    const listeners = new Map();

    return {
        currentLocale: 'en',
        t(key, params) {
            return translate(this.currentLocale === 'de' ? DE : EN, key, params);
        },
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        setLocale(locale) {
            this.currentLocale = locale;
            for (const handler of listeners.get('languagechange') ?? []) {
                handler({ type: 'languagechange' });
            }
        },
    };
}

/**
 * Build the view's service doubles for one device state.
 * @param {DeviceState} state Device state rendered by the view.
 */
function createMocks(state) {
    const deviceConnection = {
        isConnected() {
            return Boolean(state.connected);
        },
        async connect() {},
        async readTextFile() {
            return '{}';
        },
    };

    const deviceDeployment = {
        addEventListener() {},
        removeEventListener() {},
        getDeviceState() {
            return state;
        },
        getDeviceConnection() {
            return deviceConnection;
        },
        async refreshConnectionState() {},
        isConnected() {
            return Boolean(state.connected);
        },
        hasMicroPython() {
            return Boolean(state.hasMicroPython);
        },
        async refreshDeviceInfo() {},
        async reconfigureDeviceTarget() {},
        async installRuntime() {},
        async upgradeRuntime() {},
        async refreshRuntime() {},
        async removeRuntime() {},
        async validateCollectionCompatibility() {
            return { compatible: true, errors: [] };
        },
        async validateNodePackages() {
            return { errors: [] };
        },
        async deployCollection() {},
        async syncCollectionFiles() {},
        async removeCollection() {},
        async getDynamicLibraryPathsOnDevice() {
            return [];
        },
    };

    return {
        options: {
            deviceDeployment,
            runtimeCollection: {
                getRuntime(id) {
                    return { id, name: id };
                },
            },
            collectionManager: {
                getActiveCollection() {
                    return {
                        getId: () => 'collection-1',
                        getTitle: () => 'Collection 1',
                        getVersionString: () => '1.0.0',
                        getDeviceRuntimeId: () => 'general',
                        getTargetId: () => 'esp32-test',
                        on: () => () => {},
                    };
                },
                on() {
                    return () => {};
                },
            },
            viewManager: {
                async showConfirmation() {
                    return false;
                },
                async showError() {},
                async showInfo() {},
                async showFormDialog() {
                    return { confirmed: false, formData: {} };
                },
            },
            i18nService: createI18nService(),
        },
    };
}

/**
 * Read the pane headers in DOM order.
 * @param {HTMLElement} container View container.
 */
function paneHeaders(container) {
    return Array.from(container.querySelectorAll('.split-view__pane')).map(
        (pane) => pane.querySelector('.collapsible-view__title')?.textContent ?? null
    );
}

describe('DeviceDeploymentView standard shell', () => {
    let dom;
    let container;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.document = dom.window.document;
        global.window = dom.window;
        global.HTMLElement = dom.window.HTMLElement;
        global.customElements = dom.window.customElements;
        global.CustomEvent = dom.window.CustomEvent;
        global.EventTarget = dom.window.EventTarget;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container?.remove();
        delete global.document;
        delete global.window;
        delete global.HTMLElement;
        delete global.customElements;
        delete global.CustomEvent;
        delete global.EventTarget;
        dom?.window?.close();
    });

    it('renders five collapsible panes with the toolbar first', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            deviceInfoLoading: false,
        });
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        const panes = Array.from(container.querySelectorAll('.split-view__pane'));
        assert.equal(panes.length, 5);
        assert.deepEqual(paneHeaders(container), [
            EN.deployment.toolbarTitle,
            EN.deployment.deviceInfo,
            EN.deployment.runtimeInfo,
            EN.deployment.collectionInfo,
            EN.deviceCollection.comparison.title,
        ]);

        for (const pane of panes) {
            const collapsible = pane.querySelector('.collapsible-view');
            assert.ok(collapsible, 'every pane is a CollapsibleView');
            assert.ok(collapsible.classList.contains('collapsible-view--fit-content'));
            assert.equal(collapsible.classList.contains('is-collapsed'), false);
            assert.equal(
                collapsible.querySelector('.collapsible-view__header').style.height,
                '28px',
                'every pane uses the shared 28px header default'
            );
        }

        assert.ok(panes[0].querySelector('.collapsible-view .view-toolbar'));
        assert.equal(
            Array.from(panes[0].children).some((child) =>
                child.classList.contains('view-toolbar')
            ),
            false,
            'the toolbar is not a direct split pane'
        );

        view.detach();
    });

    it('re-renders all five panes after a locale switch', () => {
        const state = new DeviceState({
            connected: true,
            hasMicroPython: true,
            runtimeInstalled: true,
            deviceInfoLoading: false,
        });
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        options.i18nService.setLocale('de');

        assert.equal(container.querySelectorAll('.split-view__pane').length, 5);
        assert.deepEqual(paneHeaders(container), [
            DE.deployment.toolbarTitle,
            DE.deployment.deviceInfo,
            DE.deployment.runtimeInfo,
            DE.deployment.collectionInfo,
            DE.deviceCollection.comparison.title,
        ]);

        view.detach();
    });

    it('re-renders the single Help pane after a locale switch', () => {
        const state = new DeviceState({
            connected: false,
            hasMicroPython: false,
            runtimeInstalled: false,
            deviceInfoLoading: false,
        });
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        options.i18nService.setLocale('de');

        assert.equal(container.querySelectorAll('.split-view__pane').length, 1);
        assert.deepEqual(paneHeaders(container), [DE.deployment.helpTitle]);
        assert.match(container.textContent, new RegExp(DE.deployment.noDeviceConnected));
        assert.match(container.textContent, new RegExp(DE.deployment.connectViaTitleBar));

        view.detach();
    });

    it('leaves no duplicate custom runtime view host behind', () => {
        const state = new DeviceState({
            connected: false,
            hasMicroPython: false,
            runtimeInstalled: false,
            deviceInfoLoading: false,
        });
        const { options } = createMocks(state);
        const view = new DeviceDeploymentView(options);
        view.attachTo(container);

        assert.equal(container.querySelector('.deployment-custom-view-container'), null);

        const source = readFileSync(VIEW_PATH, 'utf8');
        for (const symbol of [
            '_customView',
            '_customViewContainer',
            '_createCustomViewContainer',
            '_updateCustomRuntimeView',
            '_loadCustomRuntimeView',
            'deployment.customViewError',
        ]) {
            assert.equal(source.includes(symbol), false, `${symbol} removed from the view`);
        }
        assert.equal(EN.deployment.customViewError, undefined);
        assert.equal(DE.deployment.customViewError, undefined);

        view.detach();
    });

    it('keeps the deployment locale keys in parity', () => {
        assert.deepEqual(Object.keys(EN.deployment).sort(), Object.keys(DE.deployment).sort());
        for (const key of ['toolbarTitle', 'helpTitle']) {
            assert.equal(typeof EN.deployment[key], 'string');
            assert.ok(EN.deployment[key].length > 0);
            assert.equal(typeof DE.deployment[key], 'string');
            assert.ok(DE.deployment[key].length > 0);
        }
    });

    it('matches the shell CSS contract', () => {
        const css = readFileSync(CSS_PATH, 'utf8');
        assert.ok(css.includes('.deployment-pane'));
        for (const selector of [
            '.deployment-custom-view-container',
            '.deployment-status-panel',
            '.deployment-compatibility-panel',
        ]) {
            assert.equal(css.includes(selector), false, `${selector} removed from the stylesheet`);
        }
    });
});
