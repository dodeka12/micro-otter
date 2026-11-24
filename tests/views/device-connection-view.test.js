// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

class MockDeviceConnection {
    constructor({
        state = 'connected',
        activeProvider = 'webserial',
        executionRunning = false,
        customViewData = null,
    } = {}) {
        this._events = new window.EventTarget();
        this._state = state;
        this._activeProvider = activeProvider;
        this._executionRunning = executionRunning;
        this._customViewData = customViewData;
        this.startMainCalls = 0;
        this.stopExecutionCalls = 0;
        this.customViewActionCalls = [];
        this.commands = [];
    }

    isConnected() {
        return this._state === 'connected';
    }

    isExecutionRunning() {
        return this._executionRunning;
    }

    getCustomViewData() {
        return this._customViewData;
    }

    getProviders() {
        return { webserial: { name: 'Web Serial' } };
    }

    getActiveProviderKey() {
        return this._activeProvider;
    }

    setActiveProvider(providerKey) {
        this._activeProvider = providerKey;
    }

    getState() {
        return this._state;
    }

    async connect() {}

    async disconnect() {
        this._state = 'disconnected';
    }

    async startMain(context = {}) {
        this.startMainCalls += 1;
        this._executionRunning = true;
        this.emitExecutionStarted(context);
    }

    async startExecution() {}

    async stopExecution(context = {}) {
        this.stopExecutionCalls += 1;
        this._executionRunning = false;
        this.emitExecutionStopped(context);
    }

    async softReset() {
        this._executionRunning = false;
    }

    async hardReset() {
        this._executionRunning = false;
        this._state = 'disconnected';
    }

    setExecutionRunning(executionRunning) {
        this._executionRunning = executionRunning;
    }

    setConnectionState(state) {
        this._state = state;
    }

    async executeCode(command) {
        this.commands.push(command);
        return '{}';
    }

    async executeCustomViewAction(functionName, parameters = [], options = {}) {
        const runtimeImpact = options.runtimeImpact || 'none';
        this.customViewActionCalls.push({ functionName, parameters, options: { runtimeImpact } });

        const command =
            `import otter_runtime.custom_settings as custom_settings; print(custom_settings.${functionName}` +
            `(${parameters.map((value) => this._pythonRepr(value)).join(', ')}))`;

        if (runtimeImpact === 'none') {
            return this.executeCode(command);
        }

        if (runtimeImpact === 'stop') {
            await this.stopExecution({
                source: 'custom-view-action',
                cause: 'custom-view-runtime-impact-stop',
                functionName,
                runtimeImpact,
                transitionStep: 'pre-stop',
            });
            return this.executeCode(command);
        }

        await this.stopExecution({
            source: 'custom-view-action',
            cause: 'custom-view-runtime-impact-restart-stop',
            functionName,
            runtimeImpact,
            transitionStep: 'pre-stop',
        });
        const result = await this.executeCode(command);
        await this.startMain({
            source: 'custom-view-action',
            cause: 'custom-view-runtime-impact-restart-start',
            functionName,
            runtimeImpact,
            transitionStep: 'post-restart',
        });
        return result;
    }

    async executeRuntimeCommand(options = {}) {
        const runtimeImpact = options.runtimeImpact || 'none';
        const source = options.source || 'runtime-command';
        const intent = options.intent || 'runtime-command';
        const command = options.command || '';

        if (runtimeImpact === 'none') {
            return this.executeCode(command);
        }

        if (runtimeImpact === 'stop') {
            await this.stopExecution({
                source,
                cause: 'runtime-command-impact-stop',
                functionName: intent,
                runtimeImpact,
            });
            return this.executeCode(command);
        }

        await this.stopExecution({
            source,
            cause: 'runtime-command-impact-restart-stop',
            functionName: intent,
            runtimeImpact,
        });
        const result = await this.executeCode(command);
        await this.startMain({
            source,
            cause: 'runtime-command-impact-restart-start',
            functionName: intent,
            runtimeImpact,
            transitionStep: 'post-restart',
        });
        return result;
    }

    async executeRuntimeRefresh(options = {}) {
        if (!Object.prototype.hasOwnProperty.call(options, 'runtimeImpact')) {
            throw new Error('Runtime refresh runtimeImpact must be declared explicitly');
        }

        return this.executeRuntimeCommand({
            ...options,
            source: options.source || 'runtime-refresh',
        });
    }

    _pythonRepr(value) {
        if (value === null || value === undefined) {
            return 'None';
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (typeof value === 'number') {
            return String(value);
        }
        if (typeof value === 'string') {
            return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        }
        return 'None';
    }

    emitStateChange(state, previousState) {
        this._events.dispatchEvent(
            new window.CustomEvent('statechange', { detail: { state, previousState } })
        );
    }

    emitExecutionStarted(detail = {}) {
        this._events.dispatchEvent(new window.CustomEvent('execution-started', { detail }));
    }

    emitExecutionStopped(detail = {}) {
        this._events.dispatchEvent(new window.CustomEvent('execution-stopped', { detail }));
    }

    addEventListener(type, listener) {
        this._events.addEventListener(type, listener);
    }

    removeEventListener(type, listener) {
        this._events.removeEventListener(type, listener);
    }
}

class MockI18nService {
    constructor() {
        this._events = new window.EventTarget();
        this._prefix = '';
    }

    t(key) {
        return `${this._prefix}${key}`;
    }

    setLocalePrefix(prefix) {
        this._prefix = prefix;
        this._events.dispatchEvent(new window.Event('languagechange'));
    }

    addEventListener(type, listener) {
        this._events.addEventListener(type, listener);
    }

    removeEventListener(type, listener) {
        this._events.removeEventListener(type, listener);
    }
}

function snapshotRuntimeButtons(view) {
    return {
        playDisabled: view._playButton.disabled,
        stopDisabled: view._stopButton.disabled,
    };
}

describe('DeviceConnectionView', () => {
    let dom;
    let DeviceConnectionView;
    let CollapsibleView;

    beforeEach(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.HTMLDetailsElement = dom.window.HTMLDetailsElement;
        global.CustomEvent = dom.window.CustomEvent;
        global.EventTarget = dom.window.EventTarget;
        global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
        global.cancelAnimationFrame = (handle) => clearTimeout(handle);

        const viewModule =
            await import('../../src/micro_otter/nodes/html/js/views/device-connection-view.js');
        DeviceConnectionView = viewModule.DeviceConnectionView;
        const collapsibleModule =
            await import('../../src/micro_otter/nodes/html/js/views/collapsible-view.js');
        CollapsibleView = collapsibleModule.CollapsibleView;
    });

    afterEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.HTMLDetailsElement = undefined;
        global.CustomEvent = undefined;
        global.EventTarget = undefined;
        global.requestAnimationFrame = undefined;
        global.cancelAnimationFrame = undefined;
        dom.window.close();
    });

    test('syncing an already-connected device updates internal connected flag', () => {
        const i18nService = new MockI18nService();
        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: false,
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        assert.equal(view.getConnectionStatus().connected, true);

        view._syncConnectionState();

        assert.equal(view.getConnectionStatus().connected, true);

        return view._handlePlay().then(() => {
            assert.equal(mockDeviceConnection.startMainCalls, 1);
        });
    });

    test('a connect clears the console log before the connecting notice', async () => {
        const i18nService = new MockI18nService();
        const mockDeviceConnection = new MockDeviceConnection({
            state: 'disconnected',
            executionRunning: false,
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);
        view._subscribeToDeviceEvents();

        const consoleView = view.getConsoleView();
        assert.ok(consoleView);
        consoleView.addMessage('system', 'stale message from the previous session');
        assert.equal(consoleView.getMessages().length, 1);

        // The connect is started from the title-bar badge now; the view sees it
        // through the connection's own `statechange` events.
        mockDeviceConnection.emitStateChange('connecting', 'disconnected');
        mockDeviceConnection.setConnectionState('connected');
        mockDeviceConnection.emitStateChange('connected', 'connecting');

        assert.deepEqual(
            consoleView.getMessages().map((message) => message.message),
            ['deviceConnection.connecting', 'deviceConnection.connected']
        );
    });

    test('execution event handling syncs controls from canonical execution getter', () => {
        const i18nService = new MockI18nService();
        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: false,
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);
        view._subscribeToDeviceEvents();
        view._syncConnectionState();

        assert.equal(view._playButton.disabled, false);
        assert.equal(view._stopButton.disabled, true);

        // Event arrival alone must not force executing=true; getter remains authoritative.
        mockDeviceConnection.emitExecutionStarted({ source: 'custom-view-action' });
        assert.equal(view._playButton.disabled, false);
        assert.equal(view._stopButton.disabled, true);

        mockDeviceConnection.setExecutionRunning(true);
        mockDeviceConnection.emitExecutionStarted({ source: 'custom-view-action' });
        assert.equal(view._playButton.disabled, true);
        assert.equal(view._stopButton.disabled, false);

        mockDeviceConnection.setExecutionRunning(false);
        mockDeviceConnection.emitExecutionStopped({ source: 'custom-view-action' });
        assert.equal(view._playButton.disabled, false);
        assert.equal(view._stopButton.disabled, true);
    });

    test('runtime-impacting custom view actions keep runtime controls equivalent to toolbar flows', async () => {
        const i18nService = new MockI18nService();
        const customViewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'runtime',
                    title: 'runtime',
                    controls: [
                        {
                            id: 'custom_stop',
                            type: 'button',
                            label: 'custom stop',
                            function: {
                                name: 'apply_config',
                                parameters: [],
                                runtimeImpact: 'stop',
                            },
                        },
                        {
                            id: 'custom_restart',
                            type: 'button',
                            label: 'custom restart',
                            function: {
                                name: 'deploy_runtime',
                                parameters: [],
                                runtimeImpact: 'restart',
                            },
                        },
                    ],
                },
            ],
        };

        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: true,
            customViewData: customViewDefinition,
        });

        const executionEvents = [];
        mockDeviceConnection.addEventListener('execution-started', (event) => {
            executionEvents.push({ name: 'execution-started', detail: event.detail });
        });
        mockDeviceConnection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);
        view._subscribeToDeviceEvents();
        view._syncConnectionState();

        const renderer = view._customRuntimeView?._renderer;
        assert.ok(renderer, 'Custom runtime renderer should be available');

        const customStopDef = customViewDefinition.sections[0].controls[0];
        const customRestartDef = customViewDefinition.sections[0].controls[1];

        await view._handleStop();
        const toolbarStopSnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(toolbarStopSnapshot, {
            playDisabled: false,
            stopDisabled: true,
        });

        await view._handlePlay();
        const toolbarPlaySnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(toolbarPlaySnapshot, {
            playDisabled: true,
            stopDisabled: false,
        });

        await renderer._executeFunction(customStopDef);
        const customStopSnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(customStopSnapshot, toolbarStopSnapshot);

        await renderer._executeFunction(customRestartDef);
        const customRestartSnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(customRestartSnapshot, toolbarPlaySnapshot);

        const customStopEvent = executionEvents.find(
            (entry) =>
                entry.name === 'execution-stopped' &&
                entry.detail?.source === 'custom-view-action' &&
                entry.detail?.runtimeImpact === 'stop'
        );
        assert.ok(customStopEvent, 'Stop-impact custom action should emit canonical stop event');

        const customRestartStopEvent = executionEvents.find(
            (entry) =>
                entry.name === 'execution-stopped' &&
                entry.detail?.source === 'custom-view-action' &&
                entry.detail?.runtimeImpact === 'restart'
        );
        const customRestartStartEvent = executionEvents.find(
            (entry) =>
                entry.name === 'execution-started' &&
                entry.detail?.source === 'custom-view-action' &&
                entry.detail?.runtimeImpact === 'restart'
        );
        assert.ok(
            customRestartStopEvent,
            'Restart-impact custom action should emit canonical pre-stop event'
        );
        assert.ok(
            customRestartStartEvent,
            'Restart-impact custom action should emit canonical restart-start event'
        );
    });

    test('generic runtime command/refresh actions keep runtime controls and events synchronized', async () => {
        const i18nService = new MockI18nService();
        const customViewDefinition = {
            version: '1.0.0',
            sections: [
                {
                    id: 'runtime',
                    title: 'runtime',
                    controls: [
                        {
                            id: 'custom_restart',
                            type: 'button',
                            label: 'custom restart',
                            function: {
                                name: 'deploy_runtime',
                                parameters: [],
                                runtimeImpact: 'restart',
                            },
                        },
                    ],
                },
            ],
        };

        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: true,
            customViewData: customViewDefinition,
        });

        const executionEvents = [];
        mockDeviceConnection.addEventListener('execution-started', (event) => {
            executionEvents.push({ name: 'execution-started', detail: event.detail });
        });
        mockDeviceConnection.addEventListener('execution-stopped', (event) => {
            executionEvents.push({ name: 'execution-stopped', detail: event.detail });
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);
        view._subscribeToDeviceEvents();
        view._syncConnectionState();

        const renderer = view._customRuntimeView?._renderer;
        assert.ok(renderer, 'Custom runtime renderer should be available');

        const customRestartDef = customViewDefinition.sections[0].controls[0];

        await view._handleStop();
        const toolbarStopSnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(toolbarStopSnapshot, {
            playDisabled: false,
            stopDisabled: true,
        });

        await view._handlePlay();
        const toolbarPlaySnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(toolbarPlaySnapshot, {
            playDisabled: true,
            stopDisabled: false,
        });

        await renderer._executeFunction(customRestartDef);
        const helperRestartSnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(helperRestartSnapshot, toolbarPlaySnapshot);

        await mockDeviceConnection.executeRuntimeCommand({
            intent: 'refresh-runtime-state',
            command: 'print("refresh")',
            runtimeImpact: 'stop',
        });
        const genericStopSnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(genericStopSnapshot, toolbarStopSnapshot);

        await mockDeviceConnection.executeRuntimeRefresh({
            intent: 'wifi-refresh',
            command: 'print("wifi")',
            runtimeImpact: 'restart',
        });
        const refreshRestartSnapshot = snapshotRuntimeButtons(view);
        assert.deepEqual(refreshRestartSnapshot, toolbarPlaySnapshot);

        const genericStopEvent = executionEvents.find(
            (entry) =>
                entry.name === 'execution-stopped' &&
                entry.detail?.source === 'runtime-command' &&
                entry.detail?.cause === 'runtime-command-impact-stop' &&
                entry.detail?.runtimeImpact === 'stop'
        );
        assert.ok(genericStopEvent, 'Generic runtime command should emit canonical stop event');

        const refreshRestartStopEvent = executionEvents.find(
            (entry) =>
                entry.name === 'execution-stopped' &&
                entry.detail?.source === 'runtime-refresh' &&
                entry.detail?.cause === 'runtime-command-impact-restart-stop' &&
                entry.detail?.runtimeImpact === 'restart'
        );
        const refreshRestartStartEvent = executionEvents.find(
            (entry) =>
                entry.name === 'execution-started' &&
                entry.detail?.source === 'runtime-refresh' &&
                entry.detail?.cause === 'runtime-command-impact-restart-start' &&
                entry.detail?.runtimeImpact === 'restart'
        );

        assert.ok(
            refreshRestartStopEvent,
            'Runtime refresh restart should emit canonical pre-stop event'
        );
        assert.ok(
            refreshRestartStartEvent,
            'Runtime refresh restart should emit canonical restart-start event'
        );
    });

    test('groups toolbar, runtime configuration, and device log in collapsible panes', () => {
        const i18nService = new MockI18nService();
        const customViewDefinition = {
            version: '1.0.0',
            title: 'generalRuntime.customView.title',
            description: 'generalRuntime.customView.description',
            sections: [
                {
                    id: 'runtime',
                    title: 'generalRuntime.customView.sections.runtime',
                    controls: [],
                },
            ],
        };
        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: false,
            customViewData: customViewDefinition,
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);

        assert.equal(view._splitView.views.length, 3);
        assert.ok(view._splitView.views.every((pane) => pane instanceof CollapsibleView));
        assert.deepEqual(
            view._splitView.views.map((pane) => pane.headerTitle),
            [
                'deviceConnection.connectionToolbar',
                'generalRuntime.customView.title',
                'deviceConnection.deviceLog',
            ]
        );
        assert.deepEqual(
            Array.from(view._splitView.views).map(
                (pane) => pane.container.querySelector('.collapsible-view__title').textContent
            ),
            [
                'deviceConnection.connectionToolbar',
                'generalRuntime.customView.title',
                'deviceConnection.deviceLog',
            ]
        );
        assert.deepEqual(
            Array.from(view._splitView.views).map(
                (pane) => pane.container.querySelector('.collapsible-view__header').style.height
            ),
            ['28px', '28px', '28px'],
            'every pane inherits the shared 28px header default'
        );

        const runtimeHost = view._customRuntimeCollapsible.contentView.container;
        assert.equal(
            runtimeHost.querySelector('.stack-view > .stack-view__item > .collapsible-view'),
            null,
            'Hosted runtime view must not render a duplicate top-level header'
        );
        assert.equal(
            view._customRuntimeCollapsible.maxHeight,
            null,
            'Runtime pane must fill the split instead of being capped to the content minimum'
        );
        assert.equal(
            host.querySelector('.message-view--muted')?.textContent,
            'generalRuntime.customView.description'
        );
        assert.ok(host.querySelector('.stack-view'));
        assert.ok(host.querySelector('.console-log-view'));
        assert.ok(view._consoleCollapsible.container.querySelector('.console-log-view'));
    });

    test('adds the collapsible runtime pane after a delayed device-info load', () => {
        const i18nService = new MockI18nService();
        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: false,
            customViewData: null,
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);

        assert.equal(view._splitView.views.length, 2);
        assert.deepEqual(
            view._splitView.views.map((pane) => pane.headerTitle),
            ['deviceConnection.connectionToolbar', 'deviceConnection.deviceLog']
        );

        mockDeviceConnection._customViewData = {
            version: '1.0.0',
            title: 'generalRuntime.customView.title',
            sections: [{ id: 'runtime', title: 'Runtime', controls: [] }],
        };
        view._onDeviceInfoLoaded();

        assert.equal(view._splitView.views.length, 3);
        assert.equal(view._splitView.views[1], view._customRuntimeCollapsible);
        assert.deepEqual(
            view._splitView.views.map((pane) => pane.headerTitle),
            [
                'deviceConnection.connectionToolbar',
                'generalRuntime.customView.title',
                'deviceConnection.deviceLog',
            ]
        );
        assert.ok(view._splitView.views.every((pane) => pane instanceof CollapsibleView));
        assert.ok(host.querySelector('.stack-view'));
    });

    test('removes the collapsible runtime pane when the device disconnects', () => {
        const i18nService = new MockI18nService();
        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: false,
            customViewData: {
                version: '1.0.0',
                title: 'generalRuntime.customView.title',
                sections: [{ id: 'runtime', title: 'Runtime', controls: [] }],
            },
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);
        view._subscribeToDeviceEvents();

        assert.equal(view._splitView.views.length, 3);

        mockDeviceConnection.setConnectionState('disconnected');
        mockDeviceConnection.emitStateChange('disconnected', 'connected');

        assert.equal(view._customRuntimeCollapsible, null);
        assert.equal(view._customRuntimeView, null);
        assert.equal(view._splitView.views.length, 2);
        assert.deepEqual(
            view._splitView.views.map((pane) => pane.headerTitle),
            ['deviceConnection.connectionToolbar', 'deviceConnection.deviceLog']
        );
        assert.ok(view._splitView.views.every((pane) => pane instanceof CollapsibleView));
    });

    test('refreshes every collapsible section title on language change', () => {
        const i18nService = new MockI18nService();
        const mockDeviceConnection = new MockDeviceConnection({
            state: 'connected',
            executionRunning: false,
            customViewData: {
                version: '1.0.0',
                title: 'generalRuntime.customView.title',
                sections: [{ id: 'runtime', title: 'Runtime', controls: [] }],
            },
        });

        const view = new DeviceConnectionView({
            deviceConnection: mockDeviceConnection,
            i18nService,
            logger: { log: () => {} },
            viewManager: {
                showError: async () => {},
                showConfirmation: async () => true,
            },
        });

        const host = document.createElement('div');
        view.render(host);
        view.afterAttach();

        i18nService.setLocalePrefix('de:');

        assert.deepEqual(
            view._splitView.views.map((pane) => pane.headerTitle),
            [
                'de:deviceConnection.connectionToolbar',
                'de:generalRuntime.customView.title',
                'de:deviceConnection.deviceLog',
            ]
        );
        assert.equal(view._customRuntimeView.title, 'de:generalRuntime.customView.title');
    });
});
