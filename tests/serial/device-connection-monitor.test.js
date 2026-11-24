// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEVICE_INFO_PROGRESS_SOURCE,
    DeviceConnectionMonitor,
} from '../../src/micro_otter/nodes/html/js/serial/device-connection-monitor.js';
import { ProgressEventType } from '../../src/micro_otter/nodes/html/js/core/progress-events.js';
import { ConnectCancelledError } from '../../src/micro_otter/nodes/html/js/serial/serial-connection-base.js';

/** A promise with exposed resolve/reject, so a test can settle it on demand. */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * Structural connection double.
 *
 * It dispatches plain `{ type, detail }` objects instead of `CustomEvent`s, so the
 * suite needs no DOM; the monitor only reads `detail.state`.
 * @param {object} initial Starting state of the fake.
 */
function createConnection(initial = {}) {
    return {
        state: initial.state ?? 'disconnected',
        connected: initial.connected ?? false,
        providerKey: initial.providerKey ?? 'webserial',
        providers: initial.providers ?? {
            webserial: { name: 'WebSerial' },
            websocket: { name: 'Bridge' },
        },
        listeners: new Set(),
        initializationListeners: new Set(),
        connectCalls: [],
        disconnectCalls: 0,
        cancelCalls: 0,
        cancelResult: initial.cancelResult ?? true,
        connectGate: initial.connectGate ?? null,
        connectError: initial.connectError ?? null,
        disconnectError: initial.disconnectError ?? null,

        isConnected() {
            return this.connected;
        },
        getState() {
            return this.state;
        },
        getProviders() {
            return this.providers;
        },
        getActiveProviderKey() {
            return this.providerKey;
        },
        setActiveProvider(providerKey) {
            this.providerKey = providerKey;
        },
        async connect(options = {}) {
            this.connectCalls.push(options);
            if (this.connectGate) {
                await this.connectGate.promise;
            }
            if (this.connectError) {
                throw this.connectError;
            }
            this.connected = true;
            this.state = 'connected';
            this.emit('connected');
        },
        async disconnect() {
            this.disconnectCalls += 1;
            if (this.disconnectError) {
                throw this.disconnectError;
            }
            this.connected = false;
            this.state = 'disconnected';
            this.emit('disconnected');
        },
        cancelConnect() {
            this.cancelCalls += 1;
            return this.cancelResult;
        },
        addEventListener(type, listener) {
            if (type === 'statechange') {
                this.listeners.add(listener);
            } else if (type === 'device-initialization-status') {
                this.initializationListeners.add(listener);
            }
        },
        removeEventListener(type, listener) {
            if (type === 'statechange') {
                this.listeners.delete(listener);
            } else if (type === 'device-initialization-status') {
                this.initializationListeners.delete(listener);
            }
        },
        /**
         * Dispatch a `statechange` the way `DeviceConnection._setState()` does.
         * @param {string} state State the fake moves to.
         */
        emit(state) {
            this.state = state;
            for (const listener of [...this.listeners]) {
                listener({ type: 'statechange', detail: { state, previousState: null } });
            }
        },
        /**
         * Dispatch a `device-initialization-status` the way the connection does.
         * @param {object|undefined} detail Status detail; `undefined` simulates a missing one.
         */
        emitInitializationStatus(detail) {
            for (const listener of [...this.initializationListeners]) {
                listener({ type: 'device-initialization-status', detail });
            }
        },
    };
}

/**
 * Progress-bus double with a synchronous `emit()` for the tests.
 */
function createProgressBus() {
    const listeners = new Set();
    return {
        listeners,
        subscribe(listener) {
            listeners.add(listener);
        },
        unsubscribe(listener) {
            return listeners.delete(listener);
        },
        emit(event) {
            for (const listener of [...listeners]) {
                listener(event);
            }
        },
    };
}

/**
 * Build a progress event of the device-info family.
 * @param {string} type One of `ProgressEventType`.
 * @param {number|undefined} progress Reported percentage.
 * @param {string} message Tracker message.
 */
function deviceInfoEvent(type, progress, message = 'device info') {
    return { source: DEVICE_INFO_PROGRESS_SOURCE, type, progress, message };
}

/**
 * Record every notification the monitor publishes.
 * @param {DeviceConnectionMonitor} monitor Monitor to observe.
 */
function recordSnapshots(monitor) {
    const seen = [];
    monitor.subscribe((snapshot) => seen.push(snapshot));
    return seen;
}

describe('DeviceConnectionMonitor lifecycle', () => {
    it('starts disconnected with no progress and the connection provider', () => {
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: createConnection({ providerKey: 'websocket' }),
            progressBus: createProgressBus(),
        });

        assert.deepEqual(monitor.getSnapshot(), {
            state: 'disconnected',
            progress: null,
            message: null,
            providerKey: 'websocket',
            error: null,
        });
    });

    it('is idempotent on start() and stop() and ignores events after stop()', () => {
        const connection = createConnection();
        const progressBus = createProgressBus();
        const monitor = new DeviceConnectionMonitor({ deviceConnection: connection, progressBus });
        const seen = recordSnapshots(monitor);

        monitor.start();
        monitor.start();
        assert.equal(connection.listeners.size, 1, 'one statechange listener after a double start');
        assert.equal(progressBus.listeners.size, 1, 'one progress listener after a double start');

        connection.emit('connecting');
        assert.equal(seen.length, 1, 'a double start does not double-deliver');

        monitor.stop();
        monitor.stop();
        assert.equal(connection.listeners.size, 0);
        assert.equal(progressBus.listeners.size, 0);

        connection.state = 'connected';
        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, 55));
        assert.equal(seen.length, 1, 'a stopped monitor ignores later events');
        assert.equal(monitor.getSnapshot().state, 'connecting');
    });

    it('syncs an existing connection when start() runs after the connect', () => {
        const connection = createConnection({ state: 'connected', connected: true });
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: connection,
            progressBus: createProgressBus(),
        });

        monitor.start();

        assert.equal(monitor.getSnapshot().state, 'connected');
    });

    it('returns a working unsubscribe function', () => {
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: createConnection(),
            progressBus: createProgressBus(),
        });
        const seen = [];
        const unsubscribe = monitor.subscribe((snapshot) => seen.push(snapshot));

        unsubscribe();
        monitor.start();
        monitor.deviceConnection.emit('connecting');

        assert.deepEqual(seen, []);
    });

    it('passes the provider map through and publishes a provider switch', () => {
        const connection = createConnection();
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: connection,
            progressBus: createProgressBus(),
        });
        const seen = recordSnapshots(monitor);

        assert.deepEqual(Object.keys(monitor.getProviders()), ['webserial', 'websocket']);

        monitor.setActiveProvider('websocket');

        assert.equal(monitor.getSnapshot().providerKey, 'websocket');
        assert.equal(seen.length, 1, 'the provider change is published once');
        assert.equal(seen[0].state, 'disconnected', 'a provider switch is not a state change');
    });
});


describe('DeviceConnectionMonitor onboarding prompt', () => {
    /**
     * Start a monitor over a fake connection.
     */
    function startedMonitor() {
        const connection = createConnection();
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: connection,
            progressBus: createProgressBus(),
        });
        monitor.start();
        return { connection, monitor };
    }

    it('notifies a subscriber once for an actionable status', () => {
        const { connection, monitor } = startedMonitor();
        let calls = 0;
        monitor.subscribeOnboardingPrompt(() => {
            calls += 1;
        });

        connection.emitInitializationStatus({ onboardingActionable: true });

        assert.equal(calls, 1);
    });

    it('ignores non-actionable, missing and unrelated events', () => {
        const { connection, monitor } = startedMonitor();
        let calls = 0;
        monitor.subscribeOnboardingPrompt(() => {
            calls += 1;
        });

        connection.emitInitializationStatus({ onboardingActionable: false });
        connection.emitInitializationStatus(undefined);
        connection.emitInitializationStatus({ onboardingActionable: 'true' });
        connection.emit('connected');

        assert.equal(calls, 0);
    });

    it('stops delivery through the returned unsubscribe function', () => {
        const { connection, monitor } = startedMonitor();
        let calls = 0;
        const unsubscribe = monitor.subscribeOnboardingPrompt(() => {
            calls += 1;
        });

        connection.emitInitializationStatus({ onboardingActionable: true });
        unsubscribe();
        connection.emitInitializationStatus({ onboardingActionable: true });

        assert.equal(calls, 1);
    });

    it('detaches on stop() and re-attaches on a later start()', () => {
        const { connection, monitor } = startedMonitor();
        let calls = 0;
        monitor.subscribeOnboardingPrompt(() => {
            calls += 1;
        });

        monitor.stop();
        connection.emitInitializationStatus({ onboardingActionable: true });
        assert.equal(calls, 0, 'a stopped monitor observes nothing');
        assert.equal(connection.initializationListeners.size, 0);

        monitor.start();
        connection.emitInitializationStatus({ onboardingActionable: true });
        assert.equal(calls, 1, 'start() re-subscribes to the status event');
    });

    it('delivers to every subscriber and keeps the others after one unsubscribes', () => {
        const { connection, monitor } = startedMonitor();
        let first = 0;
        let second = 0;
        const unsubscribeFirst = monitor.subscribeOnboardingPrompt(() => {
            first += 1;
        });
        monitor.subscribeOnboardingPrompt(() => {
            second += 1;
        });

        connection.emitInitializationStatus({ onboardingActionable: true });
        assert.deepEqual([first, second], [1, 1]);

        unsubscribeFirst();
        connection.emitInitializationStatus({ onboardingActionable: true });
        assert.deepEqual([first, second], [1, 2]);
    });

    it('leaves the snapshot untouched when the prompt fires', () => {
        const { connection, monitor } = startedMonitor();
        const seen = recordSnapshots(monitor);
        const before = monitor.getSnapshot();
        monitor.subscribeOnboardingPrompt(() => {});

        connection.emitInitializationStatus({ onboardingActionable: true });

        assert.deepEqual(monitor.getSnapshot(), before);
        assert.deepEqual(seen, []);
    });
});


describe('DeviceConnectionMonitor statechange table', () => {
    /**
     * Start a monitor over a fake connection and record its notifications.
     * @param {object} initial Fake connection state.
     */
    function startedConnection(initial = {}) {
        const connection = createConnection(initial);
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: connection,
            progressBus: createProgressBus(),
        });
        const seen = recordSnapshots(monitor);
        monitor.start();
        return { connection, monitor, seen };
    }

    it('maps connecting to connecting and clears progress, message and error', () => {
        const { connection, monitor, seen } = startedConnection();

        connection.emit('connecting');

        assert.deepEqual(monitor.getSnapshot(), {
            state: 'connecting',
            progress: null,
            message: null,
            providerKey: 'webserial',
            error: null,
        });
        assert.equal(seen.length, 1);
    });

    it('maps connected to connected from any state but loading', () => {
        const { connection, monitor, seen } = startedConnection();

        connection.emit('connected');

        assert.equal(monitor.getSnapshot().state, 'connected');
        assert.equal(seen.length, 1);
    });

    it('keeps loading when the bridge re-emits connected mid-load', () => {
        const connection = createConnection({ state: 'connected', connected: true });
        const progressBus = createProgressBus();
        const monitor = new DeviceConnectionMonitor({ deviceConnection: connection, progressBus });
        const seen = recordSnapshots(monitor);
        monitor.start();
        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, 55));
        const before = seen.length;

        connection.emit('connected');

        assert.equal(monitor.getSnapshot().state, 'loading');
        assert.equal(monitor.getSnapshot().progress, 55);
        assert.equal(seen.length, before, 'the guard publishes no new snapshot');
    });

    it('maps error to error and carries the last connect rejection message', async () => {
        const connection = createConnection();
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: connection,
            progressBus: createProgressBus(),
        });
        monitor.start();
        connection.connectError = new Error('port busy');
        await assert.rejects(() => monitor.connect(), /port busy/);
        const before = monitor.getSnapshot();

        connection.emit('error');

        assert.equal(monitor.getSnapshot().state, 'error');
        assert.equal(monitor.getSnapshot().error, 'port busy');
        assert.deepEqual(monitor.getSnapshot(), before, 'connect() already published the message');
    });

    it('maps error to error with a null message when no connect failed', () => {
        const { connection, monitor } = startedConnection();

        connection.emit('error');

        assert.equal(monitor.getSnapshot().state, 'error');
        assert.equal(monitor.getSnapshot().error, null);
    });

    it('latches error across the closing disconnected transition', () => {
        const { connection, monitor } = startedConnection();
        connection.emit('error');
        const before = monitor.getSnapshot();

        connection.emit('disconnected');

        assert.equal(monitor.getSnapshot().state, 'error');
        assert.deepEqual(monitor.getSnapshot(), before);
    });

    it('maps disconnected to disconnected from disconnecting and from any other state', () => {
        const { connection, monitor, seen } = startedConnection();

        connection.emit('connecting');
        connection.emit('disconnected');

        assert.equal(monitor.getSnapshot().state, 'disconnected');
        assert.equal(monitor.getSnapshot().error, null);
        assert.equal(seen.length, 2);
    });

    it('refreshes the provider key on every transition', () => {
        const { connection, monitor } = startedConnection();

        connection.providerKey = 'websocket';
        connection.emit('connecting');

        assert.equal(monitor.getSnapshot().providerKey, 'websocket');
    });
});


describe('DeviceConnectionMonitor device-info progress', () => {
    /**
     * A started monitor over a connected device, plus its progress bus.
     */
    function connectedMonitor() {
        const connection = createConnection({ state: 'connected', connected: true });
        const progressBus = createProgressBus();
        const monitor = new DeviceConnectionMonitor({ deviceConnection: connection, progressBus });
        monitor.start();
        return { connection, progressBus, monitor };
    }

    it('reports loading with the rounded percentage and the tracker message', () => {
        const { progressBus, monitor } = connectedMonitor();

        progressBus.emit(deviceInfoEvent(ProgressEventType.START, 0, 'Reading device info'));
        assert.equal(monitor.getSnapshot().state, 'loading');
        assert.equal(monitor.getSnapshot().progress, 0);
        assert.equal(monitor.getSnapshot().message, 'Reading device info');

        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, 55, 'Reading collections'));
        assert.equal(monitor.getSnapshot().progress, 55);
        assert.equal(monitor.getSnapshot().message, 'Reading collections');
    });

    it('clamps progress into 0…100 and keeps a non-finite value null', () => {
        const { progressBus, monitor } = connectedMonitor();

        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, 140));
        assert.equal(monitor.getSnapshot().progress, 100);

        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, -5));
        assert.equal(monitor.getSnapshot().progress, 0);

        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, undefined));
        assert.equal(monitor.getSnapshot().progress, null);

        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, Number.NaN));
        assert.equal(monitor.getSnapshot().progress, null);
    });

    it('settles on connected when the tracker completes', () => {
        const { progressBus, monitor } = connectedMonitor();
        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, 55));

        progressBus.emit(deviceInfoEvent(ProgressEventType.COMPLETE, 100));

        assert.equal(monitor.getSnapshot().state, 'connected');
        assert.equal(monitor.getSnapshot().progress, null);
        assert.equal(monitor.getSnapshot().message, null);
    });

    it('reports error with the tracker message when device info fails', () => {
        const { progressBus, monitor } = connectedMonitor();

        progressBus.emit(deviceInfoEvent(ProgressEventType.ERROR, undefined, 'Device did not answer'));

        assert.equal(monitor.getSnapshot().state, 'error');
        assert.equal(monitor.getSnapshot().message, 'Device did not answer');
        assert.equal(monitor.getSnapshot().error, 'Device did not answer');
        assert.equal(monitor.getSnapshot().progress, null);
    });

    it('ignores another progress source', () => {
        const { progressBus, monitor } = connectedMonitor();

        progressBus.emit({
            source: 'node-packages',
            type: ProgressEventType.UPDATE,
            progress: 50,
            message: 'Loading package 3 of 5',
        });

        assert.equal(monitor.getSnapshot().state, 'connected');
        assert.equal(monitor.getSnapshot().progress, null);
    });

    it('ignores the whole family while the connection reports no device', () => {
        const connection = createConnection();
        const progressBus = createProgressBus();
        const monitor = new DeviceConnectionMonitor({ deviceConnection: connection, progressBus });
        monitor.start();

        progressBus.emit(deviceInfoEvent(ProgressEventType.UPDATE, 55));

        assert.equal(monitor.getSnapshot().state, 'disconnected');
        assert.equal(monitor.getSnapshot().progress, null);
    });
});


describe('DeviceConnectionMonitor connect and disconnect', () => {
    /**
     * Build a started monitor and record its notifications.
     * @param {object} initial Fake connection state.
     */
    function monitorWith(initial = {}) {
        const connection = createConnection(initial);
        const monitor = new DeviceConnectionMonitor({
            deviceConnection: connection,
            progressBus: createProgressBus(),
        });
        const seen = recordSnapshots(monitor);
        monitor.start();
        return { connection, monitor, seen };
    }

    it('publishes connecting and ends connected on the success path', async () => {
        const { connection, monitor, seen } = monitorWith();

        await monitor.connect({ device: '/dev/ttyUSB0', baudRate: 115200 });

        assert.deepEqual(connection.connectCalls, [{ device: '/dev/ttyUSB0', baudRate: 115200 }]);
        assert.equal(monitor.getSnapshot().state, 'connected');
        assert.deepEqual(
            seen.map((snapshot) => snapshot.state),
            ['connecting', 'connected']
        );
    });

    it('records a rejection, publishes error and rethrows to the caller', async () => {
        const { connection, monitor } = monitorWith();
        connection.connectError = new Error('Permission denied');

        await assert.rejects(() => monitor.connect(), /Permission denied/);

        assert.equal(monitor.getSnapshot().state, 'error');
        assert.equal(monitor.getSnapshot().error, 'Permission denied');
    });

    it('leaves the error latch on a retry', async () => {
        const { connection, monitor } = monitorWith();
        connection.connectError = new Error('Permission denied');
        await assert.rejects(() => monitor.connect());

        connection.connectError = null;
        await monitor.connect();

        assert.equal(monitor.getSnapshot().state, 'connected');
        assert.equal(monitor.getSnapshot().error, null);
    });

    it('walks disconnecting to disconnected for a successful disconnect', async () => {
        const { connection, monitor, seen } = monitorWith({ state: 'connected', connected: true });
        const before = seen.length;
        connection.state = 'connected';

        await monitor.disconnect();

        assert.equal(connection.disconnectCalls, 1);
        assert.deepEqual(
            seen.slice(before).map((snapshot) => snapshot.state),
            ['disconnecting', 'disconnected'],
            'the finally block does not repeat the disconnected the fake emitted'
        );
    });

    it('settles on disconnected even when the connection throws', async () => {
        const { connection, monitor } = monitorWith({ state: 'connected', connected: true });
        connection.disconnectError = new Error('transport gone');

        await monitor.disconnect();

        assert.equal(monitor.getSnapshot().state, 'disconnected');
        assert.equal(monitor.getSnapshot().error, null);
    });

    it('clears a latched error back to disconnected', async () => {
        const { connection, monitor, seen } = monitorWith();
        connection.connectError = new Error('Permission denied');
        await assert.rejects(() => monitor.connect());
        const before = seen.length;

        monitor.resetError();

        assert.equal(monitor.getSnapshot().state, 'disconnected');
        assert.equal(monitor.getSnapshot().error, null);
        assert.equal(seen.length, before + 1);
    });

    it('leaves a non-error state alone when resetError() runs', () => {
        const { connection, monitor, seen } = monitorWith();
        connection.emit('connecting');

        monitor.resetError();

        assert.equal(monitor.getSnapshot().state, 'connecting');
        assert.equal(seen.length, 1);
    });

    it('notifies once for a repeated identical state', () => {
        const { connection, monitor, seen } = monitorWith();

        connection.emit('disconnected');
        connection.emit('disconnected');

        assert.equal(seen.length, 0, 'disconnected was already the published state');

        connection.emit('connecting');
        connection.emit('connecting');

        assert.equal(seen.length, 1);
        assert.equal(monitor.getSnapshot().state, 'connecting');
    });

    it('joins a duplicate connect with the running attempt', async () => {
        const gate = deferred();
        const { connection, monitor } = monitorWith({ connectGate: gate });
        const first = monitor.connect();
        const second = monitor.connect();

        assert.equal(connection.connectCalls.length, 1);

        gate.resolve();
        await Promise.all([first, second]);

        assert.equal(monitor.getSnapshot().state, 'connected');
    });

    it('cancelConnect publishes disconnected without latching an error', async () => {
        const gate = deferred();
        const { connection, monitor, seen } = monitorWith({ connectGate: gate });

        const connecting = monitor.connect();
        const before = seen.length;

        assert.equal(monitor.cancelConnect(), true);
        assert.equal(connection.cancelCalls, 1);
        assert.equal(monitor.getSnapshot().state, 'disconnected');
        assert.equal(monitor.getSnapshot().error, null);
        assert.deepEqual(
            seen.slice(before).map((snapshot) => snapshot.state),
            ['disconnected']
        );

        gate.resolve();
        await connecting;
    });

    it('does not latch error for a cancelled connect rejection', async () => {
        const { connection, monitor } = monitorWith();
        connection.connectError = new ConnectCancelledError();

        await assert.rejects(
            () => monitor.connect(),
            (error) => error.name === 'ConnectCancelledError'
        );

        assert.equal(monitor.getSnapshot().state, 'disconnected');
        assert.equal(monitor.getSnapshot().error, null);
    });

    it('cancelConnect outside connecting returns false and publishes nothing', () => {
        const { connection, monitor, seen } = monitorWith({ cancelResult: false });

        assert.equal(monitor.cancelConnect(), false);
        assert.equal(connection.cancelCalls, 1);
        assert.equal(seen.length, 0);
    });
});
