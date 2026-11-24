// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { WorkspaceView } from '../../src/micro_otter/nodes/html/js/views/workspace-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

const LOCALES_DIR = new URL('../../src/micro_otter/nodes/html/locales/', import.meta.url);
const WORKSPACE_VIEW_CSS = new URL(
    '../../src/micro_otter/nodes/html/styles/standard/workspace-view.css',
    import.meta.url
);

/**
 * Translations the badge touches, kept identical to the shipped locale files so the
 * assertions read like the UI rather than like translation keys.
 */
const TRANSLATIONS = {
    en: {
        'workspace.server.offline': 'Offline',
        'workspace.server.offlineTitle':
            'The Micro-Otter server is not reachable — click to reconnect',
        'workspace.server.reconnecting': 'Reconnecting…',
        'workspace.server.reconnectingTitle': 'Trying to reach the Micro-Otter server…',
        'workspace.changeLanguage': 'Change Language',
    },
    de: {
        'workspace.server.offline': 'Offline',
        'workspace.server.offlineTitle':
            'Der Micro-Otter-Server ist nicht erreichbar — zum Neuverbinden klicken',
        'workspace.server.reconnecting': 'Verbinde neu…',
        'workspace.server.reconnectingTitle': 'Der Micro-Otter-Server wird kontaktiert…',
        'workspace.changeLanguage': 'Sprache wechseln',
    },
};

/**
 * Minimal i18n double that resolves the badge keys per locale and dispatches
 * `languagechange`, so a suite can assert a locale switch re-labels the badge.
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
        t(key) {
            return TRANSLATIONS[service.currentLocale]?.[key] ?? key;
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
 * Connection double: the suite decides when the in-flight probe settles.
 * @param {object} initial Starting snapshot.
 */
function createConnection(initial) {
    return {
        snapshot: initial,
        listeners: new Set(),
        checkNowCalls: 0,
        resolveCheck: null,
        getSnapshot() {
            return this.snapshot;
        },
        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        },
        checkNow() {
            this.checkNowCalls += 1;
            return new Promise((resolve) => {
                this.resolveCheck = resolve;
            });
        },
        push(next) {
            this.snapshot = next;
            for (const listener of [...this.listeners]) {
                listener(next);
            }
            return next;
        },
        settle(next) {
            this.snapshot = next;
            this.resolveCheck?.(next);
            this.resolveCheck = null;
            return next;
        },
    };
}

/**
 * Device connection monitor double that renders the always-visible connect badge.
 */
function createDeviceConnection() {
    return {
        getSnapshot: () => ({
            state: 'disconnected',
            progress: null,
            message: null,
            providerKey: 'webserial',
            error: null,
        }),
        subscribe: () => () => {},
    };
}

/**
 * Build a connection snapshot with the fields the badge reads.
 * @param {'unknown'|'connected'|'disconnected'} state Connection state.
 */
function snapshot(state) {
    return {
        state,
        reason: state === 'disconnected' ? 'unreachable' : null,
        detail: null,
        disconnectedSince: state === 'disconnected' ? 1 : null,
        checking: false,
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

describe('WorkspaceView server connection badge', () => {
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

    function flush() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    /**
     * Attach a workspace bar with the server connection and an optional device monitor.
     * @param {object} connection Server connection double.
     * @param {object|null} i18nService Optional i18n double.
     * @param {object|null} deviceConnection Optional device monitor double.
     */
    function attach(connection, i18nService = null, deviceConnection = null) {
        const view = new WorkspaceView({
            workspace,
            serverConnection: connection,
            deviceConnection,
            i18nService,
        });
        view.attachTo(container);
        return view;
    }

    it('renders the cloud_off glyph so the two title-bar badges stay distinct', () => {
        const connection = createConnection(snapshot('disconnected'));
        const view = attach(connection);

        const image = view._serverBadgeButton.querySelector('img');
        assert.ok(image, 'the badge renders an <img> for the glyph');
        assert.equal(image.src, IconProvider.cloudOff);
        assert.equal(
            image.src.startsWith('data:image/svg+xml;base64,'),
            true,
            'the glyph is inlined, so an outage does not need a network request'
        );

        view.detach();
    });

    it('hides the badge before the first probe resolves', () => {
        const connection = createConnection(snapshot('unknown'));
        const view = attach(connection);

        const badge = view._serverBadgeButton;
        assert.ok(badge, 'the badge element exists once attached');
        assert.equal(badge.hidden, true, 'unknown is not an outage');
        assert.equal(badge.textContent.trim(), '', 'no label is rendered while hidden');

        view.detach();
    });

    it('hides the badge while the server answers', () => {
        const connection = createConnection(snapshot('connected'));
        const view = attach(connection);

        assert.equal(view._serverBadgeButton.hidden, true);

        view.detach();
    });



    it('hides a reachable badge through the stylesheet, not an inline display override', () => {
        const style = document.createElement('style');
        style.textContent = readFileSync(WORKSPACE_VIEW_CSS, 'utf-8');
        document.head.appendChild(style);

        const connection = createConnection(snapshot('connected'));
        const view = attach(connection);
        const badge = view._serverBadgeButton;

        assert.equal(
            badge.hasAttribute('style'),
            false,
            'the icon-button chrome is not written inline'
        );
        assert.equal(
            dom.window.getComputedStyle(badge).display,
            'none',
            'the [hidden] rule hides a reachable badge even though an icon button is flex'
        );

        connection.push(snapshot('disconnected'));
        const visible = dom.window.getComputedStyle(badge);
        assert.equal(visible.display, 'flex', 'an outage shows the badge');
        assert.equal(visible.padding, '4px 8px', 'the badge keeps its own padding');
        assert.equal(visible.fontSize, '11px', 'the badge keeps its own label size');

        connection.push(snapshot('connected'));
        assert.equal(
            dom.window.getComputedStyle(badge).display,
            'none',
            'the badge hides again once the server answers'
        );

        view.detach();
        style.remove();
    });

    it('shows Offline with the localized title while disconnected', () => {
        const connection = createConnection(snapshot('disconnected'));
        const i18nService = createI18nService('en');
        const view = attach(connection, i18nService);

        const badge = view._serverBadgeButton;
        assert.equal(badge.hidden, false);
        assert.equal(badge.dataset.state, 'offline');
        assert.equal(view._serverBadgeLabelEl.textContent, 'Offline');
        assert.equal(badge.title, TRANSLATIONS.en['workspace.server.offlineTitle']);
        assert.equal(
            badge.getAttribute('aria-label'),
            TRANSLATIONS.en['workspace.server.offlineTitle']
        );
        assert.equal(badge.disabled, false, 'the badge is clickable while offline');

        view.detach();
    });

    it('probes once on click and shows Reconnecting… until the probe settles', async () => {
        const connection = createConnection(snapshot('disconnected'));
        const i18nService = createI18nService('en');
        const view = attach(connection, i18nService);

        view._serverBadgeButton.click();

        assert.equal(connection.checkNowCalls, 1);
        assert.equal(
            view._serverBadgeLabelEl.textContent,
            TRANSLATIONS.en['workspace.server.reconnecting']
        );
        assert.equal(view._serverBadgeButton.dataset.state, 'reconnecting');
        assert.equal(view._serverBadgeButton.disabled, true, 'a second click cannot start a probe');
        assert.equal(view._serverBadgeButton.getAttribute('aria-busy'), 'true');
        assert.equal(
            view._serverBadgeButton.title,
            TRANSLATIONS.en['workspace.server.reconnectingTitle']
        );

        connection.settle(snapshot('connected'));
        await flush();

        assert.equal(view._serverBadgeButton.hidden, true, 'the badge hides once the server answers');
        assert.equal(view._serverBadgeButton.disabled, false);

        view.detach();
    });

    it('ignores a second click while a probe is in flight', async () => {
        const connection = createConnection(snapshot('disconnected'));
        const view = attach(connection);

        view._serverBadgeButton.click();
        await view._handleServerBadgeClick();
        view._serverBadgeButton.click();
        await flush();

        assert.equal(connection.checkNowCalls, 1, 'only the first click probes');

        connection.settle(snapshot('disconnected'));
        await flush();
        view.detach();
    });


    it('follows monitor pushes without a click', () => {
        const connection = createConnection(snapshot('connected'));
        const view = attach(connection, createI18nService('en'));

        assert.equal(view._serverBadgeButton.hidden, true);

        connection.push(snapshot('disconnected'));
        assert.equal(view._serverBadgeButton.hidden, false);
        assert.equal(view._serverBadgeLabelEl.textContent, 'Offline');

        connection.push(snapshot('connected'));
        assert.equal(view._serverBadgeButton.hidden, true);

        view.detach();
    });

    it('unsubscribes from the monitor when detached', () => {
        const connection = createConnection(snapshot('disconnected'));
        const view = attach(connection);

        assert.equal(connection.listeners.size, 1);

        view.detach();

        assert.equal(connection.listeners.size, 0, 'beforeDetach drops the subscription');
    });

    it('re-labels a visible badge after a locale switch', () => {
        const connection = createConnection(snapshot('disconnected'));
        const i18nService = createI18nService('en');
        const view = attach(connection, i18nService);

        assert.equal(view._serverBadgeLabelEl.textContent, 'Offline');

        i18nService.setLocale('de');

        assert.equal(
            view._serverBadgeLabelEl.textContent,
            TRANSLATIONS.de['workspace.server.offline']
        );
        assert.equal(view._serverBadgeButton.title, TRANSLATIONS.de['workspace.server.offlineTitle']);

        view.detach();
    });

    it('keeps the en and de workspace.server keys identical', () => {
        const readLocale = (code) =>
            JSON.parse(readFileSync(new URL(`${code}.json`, LOCALES_DIR), 'utf-8'));

        const en = readLocale('en').workspace.server;
        const de = readLocale('de').workspace.server;

        assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort());
        for (const key of Object.keys(en)) {
            assert.equal(typeof de[key], 'string', `de.workspace.server.${key} is a string`);
            assert.ok(de[key].trim().length > 0, `de.workspace.server.${key} is not empty`);
        }
    });


    it('renders no badge and keeps the bar order when no connection is injected', () => {
        const view = new WorkspaceView({ workspace });
        view.attachTo(container);

        const wrapper = container.firstElementChild;
        assert.equal(wrapper.querySelector('.workspace-server-badge'), null);
        assert.equal(view._serverBadgeButton, null);

        const children = Array.from(wrapper.children);
        const runtimeIndex = children.indexOf(view._runtimeTargetDisplay);
        const spacer = children[runtimeIndex + 1];
        assert.equal(
            spacer.style.flexGrow,
            '1',
            'the flex spacer follows the runtime display'
        );

        view.detach();
    });

    it('places the offline badge to the right of the device badge', () => {
        const connection = createConnection(snapshot('disconnected'));
        const view = attach(connection, null, createDeviceConnection());

        const wrapper = container.firstElementChild;
        const deviceBadge = wrapper.querySelector('.workspace-device-badge');
        const offlineBadge = view._serverBadgeButton;
        const children = Array.from(wrapper.children);

        assert.ok(deviceBadge, 'the always-visible device badge is rendered');
        assert.equal(children.indexOf(deviceBadge), children.indexOf(view._runtimeTargetDisplay) + 1);
        assert.equal(children.indexOf(offlineBadge), children.indexOf(deviceBadge) + 1);
        assert.equal(children[children.indexOf(offlineBadge) + 1].style.flexGrow, '1');

        view.detach();
    });
});
