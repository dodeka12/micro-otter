// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';
import { DeviceConnectionDialogView } from '../../src/micro_otter/nodes/html/js/views/device-connection-dialog-view.js';

const WORKSPACE_VIEW_CSS = new URL(
    '../../src/micro_otter/nodes/html/styles/standard/workspace-view.css',
    import.meta.url
);

/**
 * Resolve a dotted key in a locale tree.
 * @param {object} tree Locale document.
 * @param {string} key Dotted key.
 */
function lookup(tree, key) {
    return key.split('.').reduce((node, part) => (node == null ? node : node[part]), tree);
}

const LOCALES = {
    en: JSON.parse(
        readFileSync(
            new URL('../../src/micro_otter/nodes/html/locales/en.json', import.meta.url),
            'utf8'
        )
    ),
    de: JSON.parse(
        readFileSync(
            new URL('../../src/micro_otter/nodes/html/locales/de.json', import.meta.url),
            'utf8'
        )
    ),
};

/**
 * Minimal i18n double over the shipped locales that dispatches `languagechange`.
 * @param {'en'|'de'} locale Initial locale.
 */
function createI18nService(locale = 'en') {
    const listeners = new Set();
    const service = {
        currentLocale: locale,
        availableLocales: [
            { code: 'en', label: 'English', icon: 'en.png' },
            { code: 'de', label: 'Deutsch', icon: 'de.png' },
        ],
        t(key, params = {}) {
            const value = lookup(LOCALES[service.currentLocale], key);
            if (typeof value !== 'string') {
                return key;
            }
            return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? ''));
        },
        addEventListener(type, handler) {
            if (type === 'languagechange') {
                listeners.add(handler);
            }
        },
        removeEventListener(type, handler) {
            if (type === 'languagechange') {
                listeners.delete(handler);
            }
        },
        setLocale(next) {
            service.currentLocale = next;
            for (const handler of [...listeners]) {
                handler({ type: 'languagechange', detail: { locale: next } });
            }
        },
    };
    return service;
}

/**
 * Device connection monitor double.
 * @param {object} initial Starting snapshot fields.
 */
function createMonitor(initial = {}) {
    return {
        snapshot: {
            state: initial.state ?? 'disconnected',
            progress: initial.progress ?? null,
            message: initial.message ?? null,
            providerKey: initial.providerKey ?? 'webserial',
            error: initial.error ?? null,
        },
        listeners: new Set(),
        subscribeCalls: 0,
        resetErrorCalls: 0,

        getSnapshot() {
            return { ...this.snapshot };
        },
        subscribe(listener) {
            this.subscribeCalls += 1;
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        },
        getProviders() {
            return { webserial: { name: 'WebSerial' } };
        },
        setActiveProvider() {},
        async connect() {},
        async disconnect() {},
        resetError() {
            this.resetErrorCalls += 1;
            this.snapshot = { ...this.snapshot, state: 'disconnected', error: null, message: null };
        },
        push(next) {
            this.snapshot = { ...this.snapshot, ...next };
            for (const listener of [...this.listeners]) {
                listener(this.getSnapshot());
            }
        },
    };
}

class MockCollection {
    constructor({ id = 'col-1', title = 'Collection One' } = {}) {
        this._id = id;
        this._title = title;
        this._listeners = new Set();
        this._historyManager = {
            canUndo: () => false,
            canRedo: () => false,
            undo: () => false,
            redo: () => false,
        };
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollection only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    getId() {
        return this._id;
    }

    getTitle() {
        return this._title;
    }

    getVersionString() {
        return '1.0.0';
    }

    getDeviceRuntimeId() {
        return 'general';
    }

    getTargetId() {
        return 'esp32';
    }

    getHistoryManager() {
        return this._historyManager;
    }
}

class MockWorkspace {
    constructor() {
        this.collections = new Map();
        this._listeners = new Set();
        this.deviceDeployment = null;
        this.collections.set('col-1', new MockCollection());
        this.activeCollectionId = 'col-1';
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockWorkspace only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    getCollectionIds() {
        return Array.from(this.collections.keys());
    }

    getActiveCollectionId() {
        return this.activeCollectionId;
    }

    getActiveCollection() {
        return this.collections.get(this.activeCollectionId) || null;
    }

    listAvailableRuntimes() {
        return [{ id: 'general', name: 'General' }];
    }

    listTargetsForRuntime() {
        return [{ id: 'esp32', name: 'ESP32' }];
    }
}


describe('WorkspaceView device connection badge', () => {
    let dom;
    let container;
    let workspace;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        container = document.createElement('div');
        document.body.appendChild(container);
        workspace = new MockWorkspace();
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        delete global.ResizeObserver;
    });

    /**
     * Attach a workspace bar with the given monitor.
     * @param {object|null} monitor Device connection monitor double.
     * @param {object} options Extra view options.
     */
    function attach(monitor, options = {}) {
        const view = new WorkspaceView({
            workspace,
            deviceConnection: monitor,
            i18nService: createI18nService(),
            ...options,
        });
        view.attachTo(container);
        return view;
    }

    /**
     * The device badge element.
     */
    function badge() {
        return container.querySelector('.workspace-device-badge');
    }

    it('renders no badge and does not throw without an injected monitor', () => {
        const view = attach(null);

        assert.equal(badge(), null);

        view.detach();
    });

    it('subscribes once and unsubscribes on detach', () => {
        const monitor = createMonitor();
        const view = attach(monitor);

        assert.equal(monitor.subscribeCalls, 1);
        assert.equal(monitor.listeners.size, 1);

        view.detach();

        assert.equal(monitor.listeners.size, 0);
    });

    it('keeps data-state, aria-busy, title and aria-label in sync', () => {
        const monitor = createMonitor();
        attach(monitor);

        assert.equal(badge().getAttribute('data-state'), 'disconnected');
        assert.equal(badge().getAttribute('aria-busy'), 'false');

        monitor.push({ state: 'connecting' });

        assert.equal(badge().getAttribute('data-state'), 'connecting');
        assert.equal(badge().getAttribute('aria-busy'), 'true');
        assert.equal(badge().getAttribute('aria-label'), LOCALES.en.workspace.device.connectingTitle);
        assert.equal(badge().title, LOCALES.en.workspace.device.connectingTitle);
    });

    it('marks the ring and the percent cell as decorative', () => {
        attach(createMonitor({ state: 'loading', progress: 55 }));

        assert.equal(
            badge().querySelector('.workspace-device-badge__percent').getAttribute('aria-hidden'),
            'true'
        );
        assert.equal(
            badge().querySelector('.workspace-device-badge__ring').getAttribute('aria-hidden'),
            'true'
        );
    });

    it('opens the connection dialog from the badge and clears a latched failure', async () => {
        const monitor = createMonitor({ state: 'error', error: 'port busy' });
        const viewManager = { marker: 'view-manager' };
        const view = attach(monitor, { viewManager });

        const calls = [];
        const originalOpen = DeviceConnectionDialogView.open;
        DeviceConnectionDialogView.open = async (...args) => {
            calls.push(args);
        };

        try {
            badge().click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            DeviceConnectionDialogView.open = originalOpen;
        }

        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], viewManager);
        assert.equal(calls[0][1].connection, monitor);

        assert.equal(monitor.resetErrorCalls, 1);
        assert.equal(badge().getAttribute('data-state'), 'disconnected');

        view.detach();
    });

    it('skips a second dialog while one is already on the modal layer', async () => {
        const monitor = createMonitor();
        const fakeDialog = Object.create(DeviceConnectionDialogView.prototype);
        const viewManager = { marker: 'view-manager', modalView: fakeDialog };
        const view = attach(monitor, { viewManager });

        const calls = [];
        const originalOpen = DeviceConnectionDialogView.open;
        DeviceConnectionDialogView.open = async (...args) => {
            calls.push(args);
        };

        try {
            badge().click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            DeviceConnectionDialogView.open = originalOpen;
        }

        assert.equal(calls.length, 0);
        assert.equal(monitor.resetErrorCalls, 0);

        view.detach();
    });

    it('opens the dialog while connecting, so the cancel surface stays reachable', async () => {
        const monitor = createMonitor({ state: 'connecting' });
        const viewManager = { marker: 'view-manager', modalView: null };
        const view = attach(monitor, { viewManager });

        const calls = [];
        const originalOpen = DeviceConnectionDialogView.open;
        DeviceConnectionDialogView.open = async (...args) => {
            calls.push(args);
        };

        try {
            badge().click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            DeviceConnectionDialogView.open = originalOpen;
        }

        assert.equal(calls.length, 1);

        view.detach();
    });
});


describe('WorkspaceView device badge state table', () => {
    let dom;
    let container;
    let workspace;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
        container = document.createElement('div');
        document.body.appendChild(container);
        workspace = new MockWorkspace();
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.EventTarget;
        delete global.CustomEvent;
        delete global.ResizeObserver;
    });

    /**
     * Attach a bar over a monitor in the given state.
     * @param {object} snapshot Snapshot fields.
     * @param {object} i18nService Optional i18n double.
     */
    function attachState(snapshot, i18nService = createI18nService()) {
        const view = new WorkspaceView({
            workspace,
            deviceConnection: createMonitor(snapshot),
            i18nService,
        });
        view.attachTo(container);
        return view;
    }

    it('renders Connect for a disconnected device and hides the ring', () => {
        attachState({ state: 'disconnected' });
        const badge = container.querySelector('.workspace-device-badge');

        assert.equal(badge.querySelector('.workspace-device-badge__label').textContent, 'Connect');
        assert.equal(badge.getAttribute('data-state'), 'disconnected');
        assert.equal(badge.getAttribute('aria-busy'), 'false');
        assert.ok(
            badge.querySelector('.workspace-device-badge__ring').hasAttribute('hidden'),
            'the ring is hidden outside the loading state'
        );
    });

    it('renders Connecting… as a busy state', () => {
        attachState({ state: 'connecting' });
        const badge = container.querySelector('.workspace-device-badge');

        assert.equal(
            badge.querySelector('.workspace-device-badge__label').textContent,
            'Connecting…'
        );
        assert.equal(badge.getAttribute('aria-busy'), 'true');
    });

    it('renders Loading 55 % with a determinate ring', () => {
        attachState({ state: 'loading', progress: 55 });
        const badge = container.querySelector('.workspace-device-badge');
        const ring = badge.querySelector('.workspace-device-badge__ring');

        assert.equal(badge.querySelector('.workspace-device-badge__label').textContent, 'Loading');
        assert.equal(badge.querySelector('.workspace-device-badge__percent').textContent, '55 %');
        assert.equal(badge.getAttribute('aria-busy'), 'true');
        assert.equal(ring.hasAttribute('hidden'), false);
        assert.equal(
            ring.querySelector('.workspace-device-badge__ring-value').getAttribute('stroke-dashoffset'),
            '45'
        );
    });

    it('keeps the ring hidden when the loading snapshot carries no percentage', () => {
        attachState({ state: 'loading', progress: null });
        const badge = container.querySelector('.workspace-device-badge');

        assert.equal(badge.querySelector('.workspace-device-badge__label').textContent, 'Loading');
        assert.equal(badge.querySelector('.workspace-device-badge__percent').textContent, '');
        assert.ok(badge.querySelector('.workspace-device-badge__ring').hasAttribute('hidden'));
    });

    it('renders Connected as a settled state', () => {
        attachState({ state: 'connected' });
        const badge = container.querySelector('.workspace-device-badge');

        assert.equal(badge.querySelector('.workspace-device-badge__label').textContent, 'Connected');
        assert.equal(badge.getAttribute('aria-busy'), 'false');
    });

    it('renders Disconnecting… as a busy state', () => {
        attachState({ state: 'disconnecting' });
        const badge = container.querySelector('.workspace-device-badge');

        assert.equal(
            badge.querySelector('.workspace-device-badge__label').textContent,
            'Disconnecting…'
        );
        assert.equal(badge.getAttribute('aria-busy'), 'true');
    });

    it('carries the failure message in the tooltip and aria-label', () => {
        attachState({ state: 'error', error: 'port busy' });
        const badge = container.querySelector('.workspace-device-badge');

        assert.equal(badge.querySelector('.workspace-device-badge__label').textContent, 'Failed');
        assert.equal(badge.title, `${LOCALES.en.workspace.device.errorTitle}: port busy`);
        assert.equal(
            badge.getAttribute('aria-label'),
            `${LOCALES.en.workspace.device.errorTitle}: port busy`
        );
    });

    it('re-labels from the current snapshot on a locale switch', () => {
        const i18nService = createI18nService('en');
        attachState({ state: 'connected' }, i18nService);
        const badge = container.querySelector('.workspace-device-badge');
        assert.equal(badge.querySelector('.workspace-device-badge__label').textContent, 'Connected');

        i18nService.setLocale('de');

        assert.equal(badge.querySelector('.workspace-device-badge__label').textContent, 'Verbunden');
    });

    it('styles every class and state selector the badge emits', () => {
        const css = readFileSync(WORKSPACE_VIEW_CSS, 'utf-8');
        for (const selector of [
            '.workspace-device-badge {',
            ".workspace-device-badge[data-state='connected']",
            ".workspace-device-badge[data-state='connecting']",
            ".workspace-device-badge[data-state='loading']",
            ".workspace-device-badge[data-state='disconnecting']",
            ".workspace-device-badge[data-state='error']",
            '.workspace-device-badge__label',
            '.workspace-device-badge__percent',
            '.workspace-device-badge__ring {',
            '.workspace-device-badge__ring[hidden]',
            '.workspace-device-badge__ring-track',
            '.workspace-device-badge__ring-value',
        ]) {
            assert.ok(css.includes(selector), `${selector} must be styled`);
        }
    });
});

