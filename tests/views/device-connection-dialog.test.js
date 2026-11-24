// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
    DeviceConnectionDialogView,
    WEBSOCKET_PROVIDER_KEY,
} from '../../src/micro_otter/nodes/html/js/views/device-connection-dialog-view.js';
import { ViewFactory } from '../../src/micro_otter/nodes/html/js/views/view-factory.js';
import { ConnectingProgressDialogView } from '../../src/micro_otter/nodes/html/js/views/connecting-progress-dialog-view.js';
import { IconProvider } from '../../src/micro_otter/nodes/html/js/views/icon-provider.js';

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

const THEMES = JSON.parse(
    readFileSync(
        new URL('../../src/micro_otter/nodes/html/styles/themes.json', import.meta.url),
        'utf8'
    )
);

const STYLESHEET = readFileSync(
    new URL(
        '../../src/micro_otter/nodes/html/styles/standard/device-connection-dialog.css',
        import.meta.url
    ),
    'utf8'
);

/**
 * Resolve a dotted key in a locale tree.
 * @param {object} tree Locale document.
 * @param {string} key Dotted key.
 */
function lookup(tree, key) {
    return key.split('.').reduce((node, part) => (node == null ? node : node[part]), tree);
}

/**
 * i18n double over the shipped locale files.
 *
 * Reading the real files keeps the assertions reading like the UI and catches a
 * key the views use but the locales lack.
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
 * Connection double matching the monitor surface the dialog uses.
 * @param {object} initial Snapshot fields and provider map.
 */
function createConnection(initial = {}) {
    const providers = initial.providers ?? {
        webserial: { name: 'WebSerial' },
        websocket: { name: 'WebSocket Bridge' },
    };
    return {
        snapshot: {
            state: initial.state ?? 'disconnected',
            progress: null,
            message: null,
            providerKey: initial.providerKey ?? Object.keys(providers)[0] ?? null,
            error: null,
        },
        providers,
        setActiveProviderCalls: [],
        connectCalls: [],
        disconnectCalls: 0,
        resetErrorCalls: 0,
        cancelCalls: 0,
        listeners: new Set(),
        connectError: initial.connectError ?? null,
        log: initial.log ?? null,

        getSnapshot() {
            return { ...this.snapshot };
        },
        getProviders() {
            return this.providers;
        },
        setActiveProvider(providerKey) {
            this.setActiveProviderCalls.push(providerKey);
            this.snapshot.providerKey = providerKey;
        },
        async connect(options = {}) {
            this.connectCalls.push(options);
            this.log?.push('connect');
            if (this.connectError) {
                throw this.connectError;
            }
        },
        async disconnect() {
            this.disconnectCalls += 1;
            this.log?.push('disconnect');
        },
        resetError() {
            this.resetErrorCalls += 1;
            this.log?.push('resetError');
        },
        cancelConnect() {
            this.cancelCalls += 1;
            this.log?.push('cancelConnect');
            return true;
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
 * View-manager double that mirrors `showModal`'s synchronous `clearModal()`.
 * @param {HTMLElement} host Element the dialog is attached to.
 * @param {string[]} log Shared event log.
 */
function createViewManager(host, log) {
    return {
        shown: null,
        lastError: null,
        showModal(view, options = {}) {
            log.push('clearModal');
            log.push('showModal');
            if (options.scrim !== true) {
                log.push('showModal-without-scrim');
            }
            this.shown = view;
            view.on('close', () => this.clearModal());
            view.attachTo(host);
            return view;
        },
        clearModal() {
            log.push('clearModal');
        },
        async showError(options) {
            log.push('showError');
            this.lastError = options;
        },
    };
}

/**
 * Let queued promise callbacks run.
 */
function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Ports the suites scan.
 */
const PORTS = [
    { device: '/dev/ttyUSB0', label: 'USB serial', display: 'USB Serial Port' },
    { device: '/dev/ttyACM0', label: null, display: null },
];

describe('DeviceConnectionDialogView', () => {
    let dom;
    let container;
    let i18nService;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.CustomEvent = dom.window.CustomEvent;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
        container = document.createElement('div');
        document.body.appendChild(container);
        i18nService = createI18n('en');
    });

    afterEach(() => {
        container.remove();
        delete global.window;
        delete global.document;
        delete global.HTMLElement;
        delete global.CustomEvent;
        delete global.ResizeObserver;
    });

    /**
     * Build and attach a dialog with a deterministic port transport.
     * @param {object} connection Connection double.
     * @param {object} options Extra dialog options.
     */
    async function attach(connection, options = {}) {
        const dialog = new DeviceConnectionDialogView({
            connection,
            fetchPorts: async () => PORTS,
            i18nService,
            ...options,
        });
        dialog.attachTo(container);
        await tick();
        return dialog;
    }

    /**
     * Labels of the port options in the device menu.
     */
    function portOptionLabels() {
        return [...document.body.querySelectorAll('.dropdown-control__option')]
            .filter((option) => (option.dataset.value ?? '').startsWith('/dev/'))
            .map((option) => option.querySelector('.dropdown-control__option-label').textContent);
    }

    /**
     * The confirm button of the inherited footer.
     */
    function primaryButton() {
        return container.querySelector('.modal-dialog__btn--primary');
    }

    /**
     * The device row host.
     */
    function deviceRow() {
        return container.querySelector('.device-connection-dialog__row--device');
    }

    /**
     * The rescan button of the refresh row.
     */
    function refreshButton() {
        return container.querySelector('.device-connection-dialog__row--refresh button');
    }

    /**
     * The status line.
     */
    function statusLine() {
        return container.querySelector('.device-connection-dialog__status');
    }

    describe('body composition', () => {
        it('lists the connection providers and falls back to the key as the label', async () => {
            const connection = createConnection({
                providers: { webserial: { name: '' }, websocket: { name: 'WebSocket Bridge' } },
            });
            await attach(connection);

            const labels = [...document.body.querySelectorAll('.dropdown-control__option')]
                .filter((option) => ['webserial', 'websocket'].includes(option.dataset.value))
                .map((option) => option.querySelector('.dropdown-control__option-label').textContent);

            assert.deepEqual(labels, ['webserial', 'WebSocket Bridge']);
        });

        it('switches the provider on the connection exactly once', async () => {
            const connection = createConnection();
            await attach(connection);

            const option = document.body.querySelector('[data-value="websocket"]');
            option.click();

            assert.deepEqual(connection.setActiveProviderCalls, ['websocket']);
            assert.equal(deviceRow().hidden, false, 'the device row appears for the bridge');
        });

        it('hides the device row for the browser provider and shows it for the bridge', async () => {
            const connection = createConnection({ providerKey: WEBSOCKET_PROVIDER_KEY });
            await attach(connection);
            assert.equal(deviceRow().hidden, false, 'visible for websocket');

            document.body.querySelector('[data-value="webserial"]').click();
            assert.equal(deviceRow().hidden, true, 'hidden for webserial');
        });

        it('renders the hint and the translated status line', async () => {
            const connection = createConnection();
            await attach(connection, {
                fetchPorts: async () => {
                    throw new Error('HTTP 500');
                },
            });

            assert.equal(
                container.querySelector('.device-connection-dialog__hint').textContent,
                LOCALES.en.deviceConnection.hint
            );
            assert.equal(statusLine().textContent, LOCALES.en.deviceConnection.portsFailed);
            assert.equal(statusLine().getAttribute('role'), 'status');
            assert.equal(statusLine().getAttribute('aria-live'), 'polite');
        });

        it('renders the header cable icon as an image, not as its base64 document', async () => {
            await attach(createConnection());

            const iconEl = container.querySelector('.modal-dialog__icon');
            const iconImg = iconEl.querySelector('img.modal-dialog__icon-img');
            assert.ok(iconImg, 'the header icon must render an <img>');
            assert.equal(iconImg.getAttribute('src'), IconProvider.cable);
            assert.equal(iconEl.textContent, '', 'no base64 document may appear as text');
        });
    });

    describe('port scanning', () => {
        it('renders the ports in server order with the display label', async () => {
            await attach(createConnection({ providerKey: WEBSOCKET_PROVIDER_KEY }));

            assert.deepEqual(portOptionLabels(), ['USB Serial Port', '/dev/ttyACM0']);
        });

        it('keeps the previous selection when a refresh still reports it', async () => {
            const dialog = await attach(createConnection({ providerKey: WEBSOCKET_PROVIDER_KEY }));
            document.body.querySelector('[data-value="/dev/ttyACM0"]').click();

            refreshButton().click();
            await tick();

            assert.deepEqual(portOptionLabels(), ['USB Serial Port', '/dev/ttyACM0']);
            assert.match(
                container.querySelector(
                    '.device-connection-dialog__row--device .dropdown-control__button-label'
                ).textContent,
                /ttyACM0/,
                'the trigger still shows the user selection'
            );
            void dialog;
        });

        it('ignores a second click while a scan is in flight', async () => {
            let release;
            let calls = 0;
            const dialog = await attach(createConnection(), {
                fetchPorts: () => {
                    calls += 1;
                    return new Promise((resolve) => {
                        release = () => resolve(PORTS);
                    });
                },
            });
            assert.equal(calls, 1, 'the first scan started on attach');

            container.querySelector('.device-connection-dialog__row--refresh button').click();
            assert.equal(calls, 1, 'the second click while scanning is ignored');

            release();
            await tick();
            container.querySelector('.device-connection-dialog__row--refresh button').click();
            release();
            await tick();
            assert.equal(calls, 2, 'a later click scans again');

            void dialog;
        });

        it('keeps the previous options when a scan fails', async () => {
            let fail = false;
            const dialog = await attach(createConnection({ providerKey: WEBSOCKET_PROVIDER_KEY }), {
                fetchPorts: async () => {
                    if (fail) {
                        throw new Error('HTTP 502');
                    }
                    return PORTS;
                },
            });

            fail = true;
            refreshButton().click();
            await tick();

            assert.deepEqual(portOptionLabels(), ['USB Serial Port', '/dev/ttyACM0']);
            assert.equal(statusLine().textContent, LOCALES.en.deviceConnection.portsFailed);
            void dialog;
        });

        it('reports an empty list and disables the primary action', async () => {
            await attach(createConnection({ providerKey: WEBSOCKET_PROVIDER_KEY }), {
                fetchPorts: async () => [],
            });

            assert.equal(statusLine().textContent, LOCALES.en.deviceConnection.portsEmpty);
            assert.equal(primaryButton().disabled, true);
        });
    });

    describe('footer action and result', () => {
        it('labels the action from the connection state', async () => {
            await attach(createConnection({ state: 'disconnected' }));
            assert.equal(primaryButton().textContent, LOCALES.en.deviceConnection.connect);

            const connectedContainer = document.createElement('div');
            document.body.appendChild(connectedContainer);
            const connected = new DeviceConnectionDialogView({
                connection: createConnection({ state: 'connected' }),
                fetchPorts: async () => PORTS,
                i18nService,
            });
            connected.attachTo(connectedContainer);
            await tick();

            const connectedPrimary = connectedContainer.querySelector('.modal-dialog__btn--primary');
            assert.equal(connectedPrimary.textContent, LOCALES.en.deviceConnection.disconnect);
        });

        it('returns the connect intent with the selected provider and port', async () => {
            const dialog = await attach(createConnection({ providerKey: WEBSOCKET_PROVIDER_KEY }));

            dialog.confirm();

            assert.deepEqual(dialog.getResult(), {
                action: 'connect',
                providerKey: 'websocket',
                device: '/dev/ttyUSB0',
            });
        });

        it('returns the disconnect intent on a connected device', async () => {
            const dialog = await attach(createConnection({ state: 'connected' }));

            dialog.confirm();

            assert.deepEqual(dialog.getResult(), {
                action: 'disconnect',
                providerKey: 'webserial',
                device: null,
            });
        });

        it('returns null when the dialog is cancelled', async () => {
            const dialog = await attach(createConnection());

            dialog.cancel();

            assert.equal(dialog.getResult(), null);
        });

        it('disables the primary action for the bridge without a port', async () => {
            await attach(createConnection({ providerKey: WEBSOCKET_PROVIDER_KEY }), {
                fetchPorts: async () => [],
            });

            assert.equal(primaryButton().disabled, true);
        });

        it('disables the primary action when no provider is registered', async () => {
            await attach(createConnection({ providers: {} }));

            assert.equal(primaryButton().disabled, true);
        });
    });

    describe('stylesheet and factory registration', () => {
        it('registers the stylesheet and styles every class the view emits', () => {
            assert.ok(THEMES.styles.includes('device-connection-dialog'));
            for (const selector of [
                '.device-connection-dialog {',
                '.device-connection-dialog__row {',
                '.device-connection-dialog__row[hidden]',
                '.device-connection-dialog__status',
                '.device-connection-dialog__hint',
                '.device-connection-dialog__row--refresh',
            ]) {
                assert.ok(STYLESHEET.includes(selector), `${selector} must be styled`);
            }
        });

        it('rehydrates through ViewFactory with the injected connection', () => {
            const connection = createConnection();
            const factory = new ViewFactory({ deviceConnection: connection, i18nService });

            const view = factory.create({ type: 'DeviceConnectionDialogView' });

            assert.ok(view instanceof DeviceConnectionDialogView);
            assert.equal(view.connection, connection);
        });

        it('names the missing connection service on a factory round trip', () => {
            const factory = new ViewFactory({ i18nService });

            assert.throws(
                () => factory.create({ type: 'DeviceConnectionDialogView' }),
                /device connection service/
            );
        });
    });

    describe('open() sequencer', () => {
        it('shows the modal twice with a scrim and connects after the modal is cleared', async () => {
            const log = [];
            const connection = createConnection({ log });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.equal(log.filter((entry) => entry === 'showModal').length, 2);
            assert.equal(log.includes('showModal-without-scrim'), false);
            assert.ok(log.includes('connect'));
            assert.ok(
                log.indexOf('clearModal') < log.indexOf('connect'),
                'the modal layer is free before the connect starts'
            );
            assert.ok(
                log.lastIndexOf('clearModal') > log.indexOf('connect'),
                'the progress dialog clears once the attempt settles'
            );
        });

        it('replaces the closed configuration dialog with the connecting progress dialog', async () => {
            const log = [];
            const connection = createConnection({ log });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            assert.ok(viewManager.shown instanceof DeviceConnectionDialogView);

            viewManager.shown.confirm();
            await opened;

            assert.ok(viewManager.shown instanceof ConnectingProgressDialogView);
            assert.equal(viewManager.shown.connection, connection);
            assert.equal(
                log.indexOf('showModal') < log.indexOf('connect'),
                true,
                'the progress dialog is on the layer before connect starts'
            );
            assert.equal(connection.listeners.size, 0, 'the settled dialog detached');
        });

        it('builds bridge options with the port and baud rate', async () => {
            const log = [];
            const connection = createConnection({ log, providerKey: WEBSOCKET_PROVIDER_KEY });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.deepEqual(connection.connectCalls, [
                { device: '/dev/ttyUSB0', baudRate: 115200 },
            ]);
        });

        it('builds no options for the browser provider', async () => {
            const log = [];
            const connection = createConnection({ log, providerKey: 'webserial' });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.deepEqual(connection.connectCalls, [{}]);
        });

        it('disconnects when the dialog opened on a connected device', async () => {
            const log = [];
            const connection = createConnection({ log, state: 'connected' });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.equal(connection.disconnectCalls, 1);
            assert.deepEqual(connection.connectCalls, []);
            assert.equal(
                log.filter((entry) => entry === 'showModal').length,
                1,
                'a disconnect never shows the connect progress dialog'
            );
        });

        it('reports a failed connect through showError and leaves no modal', async () => {
            const log = [];
            const connection = createConnection({ log, connectError: new Error('port busy') });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.equal(viewManager.lastError.message, 'port busy');
            assert.equal(
                viewManager.lastError.title,
                LOCALES.en.deviceConnection.errors.connectFailed
            );
            assert.equal(log[log.length - 1], 'showError');
            assert.ok(viewManager.shown instanceof ConnectingProgressDialogView);
            assert.equal(connection.listeners.size, 0, 'the failed dialog detached');
            assert.ok(
                log.indexOf('connect') < log.indexOf('showError'),
                'the failure surfaces after the attempt'
            );
        });

        it('closes the progress dialog without showError on a user cancellation', async () => {
            const log = [];
            const cancelled = new Error('cancelled by user');
            cancelled.name = 'ConnectCancelledError';
            const connection = createConnection({ log, connectError: cancelled });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.ok(viewManager.shown instanceof ConnectingProgressDialogView);
            assert.equal(connection.listeners.size, 0, 'the cancelled dialog detached');
            assert.equal(log.includes('showError'), false);
            assert.equal(viewManager.lastError, null);
            assert.equal(log.filter((entry) => entry === 'showModal').length, 2);
        });

        it('clears a latched failure before it connects', async () => {
            const log = [];
            const connection = createConnection({ log, state: 'error' });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.equal(connection.resetErrorCalls, 1);
            assert.ok(log.indexOf('resetError') < log.indexOf('connect'));
        });

        it('does nothing when the dialog is dismissed', async () => {
            const log = [];
            const connection = createConnection({ log });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.cancel();
            await opened;

            assert.deepEqual(connection.connectCalls, []);
            assert.equal(connection.disconnectCalls, 0);
            assert.equal(connection.resetErrorCalls, 0);
            assert.equal(log.filter((entry) => entry === 'showModal').length, 1);
        });
    });

    describe('connecting mode', () => {
        it('renders only a status line and a single cancel button', async () => {
            const connection = createConnection({ state: 'connecting' });
            await attach(connection);

            assert.equal(primaryButton().textContent, LOCALES.en.deviceConnection.cancelConnecting);
            assert.equal(container.querySelectorAll('.modal-dialog__footer button').length, 1);
            assert.equal(container.querySelector('.device-connection-dialog__row'), null);
            assert.equal(refreshButton(), null);
            assert.equal(statusLine().textContent, LOCALES.en.deviceConnection.connecting);
        });

        it('returns the cancel-connect intent from confirm', async () => {
            const connection = createConnection({ state: 'connecting' });
            const dialog = await attach(connection);

            dialog.confirm();

            assert.deepEqual(dialog.getResult(), {
                action: 'cancel-connect',
                providerKey: 'webserial',
                device: null,
            });
        });

        it('treats the ×/Escape cancel path as a cancel-connect too', async () => {
            const connection = createConnection({ state: 'connecting' });
            const dialog = await attach(connection);

            dialog.cancel();

            assert.deepEqual(dialog.getResult(), {
                action: 'cancel-connect',
                providerKey: 'webserial',
                device: null,
            });
        });

        it('open() cancels the connection and never connects or resets', async () => {
            const log = [];
            const connection = createConnection({ state: 'connecting', log });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();
            viewManager.shown.confirm();
            await opened;

            assert.equal(connection.cancelCalls, 1);
            assert.deepEqual(connection.connectCalls, []);
            assert.equal(
                log.filter((entry) => entry === 'showModal').length,
                1,
                'cancelling an existing attempt needs no progress dialog'
            );
            assert.equal(connection.resetErrorCalls, 0);
        });

        it('closes without an action when the attempt settles on its own', async () => {
            const log = [];
            const connection = createConnection({ state: 'connecting', log });
            const viewManager = createViewManager(container, log);

            const opened = DeviceConnectionDialogView.open(viewManager, {
                connection,
                fetchPorts: async () => PORTS,
                i18nService,
            });
            await tick();

            connection.push({ state: 'connected' });
            await tick();

            await opened;
            assert.equal(connection.cancelCalls, 0);
            assert.deepEqual(connection.connectCalls, []);
        });
    });
});
