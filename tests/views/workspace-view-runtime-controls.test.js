// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';

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

        getSnapshot() {
            return { ...this.snapshot };
        },
        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        },
        push(next) {
            this.snapshot = { ...this.snapshot, ...next };
            for (const listener of [...this.listeners]) {
                listener(this.getSnapshot());
            }
        },
    };
}

/**
 * Minimal core device connection double with the execution surface the title bar uses.
 * @param {object} initial Starting connection/execution state.
 * @param {boolean} [initial.connected] Whether the core connection reports connected.
 * @param {boolean} [initial.executing] Whether the runtime reports running.
 */
function createConnection({ connected = true, executing = false } = {}) {
    const listeners = new Map();
    const connection = {
        connected,
        executing,
        startMainCalls: 0,
        stopExecutionCalls: 0,
        listeners,

        isConnected() {
            return connection.connected;
        },
        isExecutionRunning() {
            return connection.executing;
        },
        async startMain() {
            connection.startMainCalls += 1;
            connection.executing = true;
            connection.emit('execution-started');
        },
        async stopExecution() {
            connection.stopExecutionCalls += 1;
            connection.executing = false;
            connection.emit('execution-stopped');
        },
        emit(type) {
            for (const handler of [...(listeners.get(type) || [])]) {
                handler({ type });
            }
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
        listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
        },
    };
    return connection;
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
        this.deviceConnection = null;
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

/**
 * Device deployment double that reports the core connection used by the deploy button.
 * @param {object} connection Core connection double.
 */
function createDeploymentDouble(connection) {
    return {
        getDeviceConnection: () => connection,
        addEventListener() {},
        removeEventListener() {},
    };
}

/** Let queued promise continuations run. */
async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkspaceView play/stop quick actions', () => {
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
     * Attach a workspace bar with a monitor and optional core connection.
     * @param {object} options View wiring overrides.
     * @param {object} [options.monitor] Device connection monitor double.
     * @param {object|null} [options.connection] Core device connection double.
     * @param {object|null} [options.viewManager] View manager double.
     * @param {object} [options.i18nService] i18n service double.
     */
    function attach({
        monitor = createMonitor({ state: 'connected' }),
        connection = null,
        viewManager = null,
        i18nService = createI18nService(),
    } = {}) {
        workspace.deviceConnection = connection;
        const view = new WorkspaceView({
            workspace,
            deviceConnection: monitor,
            viewManager,
            i18nService,
        });
        view.attachTo(container);
        return view;
    }

    it('renders play and stop directly after the deploy button', () => {
        const view = attach();

        assert.ok(view._runtimePlayButton);
        assert.ok(view._runtimeStopButton);
        assert.equal(view._deployCollectionButton.nextElementSibling, view._runtimePlayButton);
        assert.equal(view._runtimePlayButton.nextElementSibling, view._runtimeStopButton);

        view.detach();
    });

    it('hides both actions until the monitor reports connected', () => {
        const monitor = createMonitor({ state: 'disconnected' });
        const view = attach({ monitor, connection: createConnection() });

        assert.equal(view._runtimePlayButton.style.display, 'none');
        assert.equal(view._runtimeStopButton.style.display, 'none');

        monitor.push({ state: 'connecting' });
        assert.equal(view._runtimePlayButton.style.display, 'none');

        monitor.push({ state: 'connected' });
        assert.equal(view._runtimePlayButton.style.display, 'flex');
        assert.equal(view._runtimeStopButton.style.display, 'flex');

        monitor.push({ state: 'disconnecting' });
        assert.equal(view._runtimePlayButton.style.display, 'none');

        view.detach();
    });

    it('enables play while idle and stop while executing', () => {
        const connection = createConnection({ executing: false });
        const view = attach({ connection });

        assert.equal(view._runtimePlayButton.disabled, false);
        assert.equal(view._runtimeStopButton.disabled, true);

        connection.executing = true;
        connection.emit('execution-started');

        assert.equal(view._runtimePlayButton.disabled, true);
        assert.equal(view._runtimeStopButton.disabled, false);

        connection.executing = false;
        connection.emit('execution-stopped');

        assert.equal(view._runtimePlayButton.disabled, false);
        assert.equal(view._runtimeStopButton.disabled, true);

        view.detach();
    });

    it('starts the runtime from the play button', async () => {
        const connection = createConnection();
        const view = attach({ connection });

        view._runtimePlayButton.click();
        await flush();

        assert.equal(connection.startMainCalls, 1);
        assert.equal(connection.executing, true);
        assert.equal(view._runtimeStopButton.disabled, false);

        view.detach();
    });

    it('stops the runtime from the stop button', async () => {
        const connection = createConnection({ executing: true });
        const view = attach({ connection });

        view._runtimeStopButton.click();
        await flush();

        assert.equal(connection.stopExecutionCalls, 1);
        assert.equal(connection.executing, false);
        assert.equal(view._runtimePlayButton.disabled, false);

        view.detach();
    });

    it('shows the play failure dialog and keeps the controls stable', async () => {
        const connection = createConnection();
        connection.startMain = async () => {
            connection.startMainCalls += 1;
            throw new Error('boom');
        };
        const showError = mock.fn(async () => {});
        const view = attach({ connection, viewManager: { showError } });

        view._runtimePlayButton.click();
        await flush();

        assert.equal(showError.mock.calls.length, 1);
        assert.deepEqual(showError.mock.calls[0].arguments[0], {
            title: 'Start Execution Failed',
            message: 'boom',
        });
        assert.equal(view._runtimePlayButton.disabled, false);
        assert.equal(view._runtimeStopButton.disabled, true);

        view.detach();
    });

    it('shows the stop failure dialog', async () => {
        const connection = createConnection({ executing: true });
        connection.stopExecution = async () => {
            connection.stopExecutionCalls += 1;
            throw new Error('nope');
        };
        const showError = mock.fn(async () => {});
        const view = attach({ connection, viewManager: { showError } });

        view._runtimeStopButton.click();
        await flush();

        assert.equal(showError.mock.calls.length, 1);
        assert.deepEqual(showError.mock.calls[0].arguments[0], {
            title: 'Stop Execution Failed',
            message: 'nope',
        });

        view.detach();
    });

    it('re-labels the buttons on a locale switch', () => {
        const i18nService = createI18nService('en');
        const view = attach({ connection: createConnection(), i18nService });

        assert.equal(view._runtimePlayButton.title, 'Play');
        assert.equal(view._runtimeStopButton.getAttribute('aria-label'), 'Stop');

        i18nService.setLocale('de');

        assert.equal(view._runtimePlayButton.title, 'Abspielen');
        assert.equal(view._runtimePlayButton.getAttribute('aria-label'), 'Abspielen');
        assert.equal(view._runtimeStopButton.title, 'Stoppen');

        view.detach();
    });

    it('subscribes to execution events and drops them on detach', () => {
        const connection = createConnection();
        const view = attach({ connection });

        assert.equal(connection.listenerCount('execution-started'), 1);
        assert.equal(connection.listenerCount('execution-stopped'), 1);

        view.detach();

        assert.equal(connection.listenerCount('execution-started'), 0);
        assert.equal(connection.listenerCount('execution-stopped'), 0);
    });

    it('does not throw when no core connection is injected', async () => {
        const view = attach({ connection: null });

        assert.equal(view._runtimePlayButton.style.display, 'flex');
        view._runtimePlayButton.click();
        await flush();
        view._runtimeStopButton.click();
        await flush();

        view.detach();
    });

    it('hides the deploy button while no device is connected', () => {
        const connection = createConnection({ connected: false });
        workspace.deviceDeployment = createDeploymentDouble(connection);
        const monitor = createMonitor({ state: 'disconnected' });
        const view = attach({ monitor, connection });

        assert.equal(view._deployCollectionButton.style.display, 'none');

        connection.connected = true;
        monitor.push({ state: 'connected' });

        assert.equal(view._deployCollectionButton.style.display, 'flex');

        view.detach();
    });
});
