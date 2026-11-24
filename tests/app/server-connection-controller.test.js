// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startServerConnectionController } from '../../src/micro_otter/nodes/html/js/app/server-connection-controller.js';

/** Fake clock value every snapshot uses unless a test overrides it. */
const NOW = 1_000_000;

/** Grace period used by every test, so the recorded delay is easy to assert. */
const GRACE = 15_000;

/** Snapshot the monitor reports before the first probe resolves. */
function unknownSnapshot() {
    return { state: 'unknown', reason: null, detail: null, disconnectedSince: null, checking: false };
}

/** Snapshot of a reachable server. */
function connectedSnapshot() {
    return { state: 'connected', reason: null, detail: null, disconnectedSince: null, checking: false };
}

/**
 * Snapshot of an unreachable server.
 * @param {number|null} [since] Outage start timestamp.
 */
function disconnectedSnapshot(since = NOW) {
    return {
        state: 'disconnected',
        reason: 'unreachable',
        detail: 'Server not reachable',
        disconnectedSince: since,
        checking: false,
    };
}

/**
 * Let every pending promise and timer callback settle.
 *
 * The controller awaits `showConfirmation` and `checkNow`, so a test has to drain
 * more than one microtask before it can assert.
 */
async function flush() {
    for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * Controllable `ServerConnectionLike` stand-in.
 *
 * `emit()` publishes a snapshot like the real monitor does (only on change is the
 * real behaviour, but publishing always keeps the tests direct) and `checkNow()`
 * replays the queued retry answers.
 */
function createFakeMonitor() {
    const listeners = new Set();
    const checkResults = [];
    const checkCalls = [];
    let snapshot = unknownSnapshot();

    return {
        checkCalls,
        getSnapshot() {
            return { ...snapshot };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        listenerCount() {
            return listeners.size;
        },
        /**
         * Publish *next* to every subscriber.
         * @param {object} next Connection snapshot.
         */
        emit(next) {
            snapshot = { ...next };
            for (const listener of [...listeners]) {
                listener({ ...snapshot });
            }
        },
        /**
         * Queue the snapshots the next `checkNow()` calls resolve with.
         * @param {...object} results Connection snapshots to replay.
         */
        pushCheckResult(...results) {
            checkResults.push(...results);
        },
        async checkNow() {
            checkCalls.push({});
            if (checkResults.length > 0) {
                snapshot = { ...checkResults.shift() };
            }
            for (const listener of [...listeners]) {
                listener({ ...snapshot });
            }
            return { ...snapshot };
        },
    };
}

/**
 * Recording scheduler that never runs a callback on its own.
 *
 * `fire()` runs the recorded callback explicitly, so a test decides when the grace
 * period expires instead of waiting 15 s.
 */
function createScheduler() {
    const scheduled = [];
    const cancelled = [];
    let nextId = 1;

    return {
        scheduled,
        cancelled,
        schedule(fn, ms) {
            const handle = { id: nextId };
            nextId += 1;
            scheduled.push({ fn, ms, handle });
            return handle;
        },
        cancelSchedule(handle) {
            cancelled.push(handle);
        },
        /**
         * Run the recorded callback of one scheduled timer.
         * @param {number} [index] Index into `scheduled` (default: the newest).
         */
        async fire(index = scheduled.length - 1) {
            scheduled[index].fn();
            await flush();
        },
    };
}

/**
 * Recording dialog host whose answers stay pending until the test resolves them.
 */
function createDialogHost() {
    const calls = [];
    const resolvers = [];

    return {
        calls,
        showConfirmation(options) {
            calls.push(options);
            return new Promise((resolve) => {
                resolvers.push(resolve);
            });
        },
        /**
         * Answer one open dialog and let the controller continue.
         * @param {boolean} value Answer passed to `showConfirmation`.
         * @param {number} [index] Index into the open dialogs (default: the newest).
         */
        async answer(value, index = resolvers.length - 1) {
            resolvers[index](value);
            await flush();
        },
    };
}

/**
 * Translate stub that returns the key, so assertions can name the expected key.
 * @param {string} key Translation key.
 * @returns {string} The key itself.
 */
function translate(key) {
    return key;
}

/**
 * Build a controller wired to recording fakes.
 * @param {object} [overrides] Option overrides layered over the defaults.
 */
function createController(overrides = {}) {
    const monitor = overrides.monitor ?? createFakeMonitor();
    const viewManager = overrides.viewManager ?? createDialogHost();
    const scheduler = overrides.scheduler ?? createScheduler();
    const stop = startServerConnectionController({
        monitor,
        viewManager,
        t: translate,
        graceMs: GRACE,
        now: () => NOW,
        schedule: scheduler.schedule,
        cancelSchedule: scheduler.cancelSchedule,
        ...overrides.options,
    });
    return { monitor, viewManager, scheduler, stop };
}

describe('server connection controller', () => {
    it('waits out the grace period before prompting', async () => {
        const { monitor, viewManager, scheduler } = createController();

        monitor.emit(disconnectedSnapshot());
        await flush();

        assert.equal(viewManager.calls.length, 0);
        assert.equal(scheduler.scheduled.length, 1);
        assert.equal(scheduler.scheduled[0].ms, GRACE);
    });

    it('prompts once with the reconnect copy when the grace period expires', async () => {
        const { monitor, viewManager, scheduler } = createController();

        monitor.emit(disconnectedSnapshot());
        await scheduler.fire();

        assert.equal(viewManager.calls.length, 1);
        const call = viewManager.calls[0];
        assert.equal(call.title, 'workspace.server.dialogTitle');
        assert.equal(call.message, 'workspace.server.dialogMessage');
        assert.equal(call.detail, 'workspace.server.dialogDetail');
        assert.equal(call.confirmLabel, 'workspace.server.retry');
        assert.ok(call.icon, 'dialog needs an icon');
    });

    it('only waits the remaining grace time when it starts mid-outage', async () => {
        const { monitor, scheduler } = createController();

        monitor.emit(disconnectedSnapshot(NOW - 5_000));

        assert.equal(scheduler.scheduled.length, 1);
        assert.equal(scheduler.scheduled[0].ms, GRACE - 5_000);
    });

    it('does not prompt twice while a dialog is open', async () => {
        const { monitor, viewManager, scheduler } = createController();

        monitor.emit(disconnectedSnapshot());
        await scheduler.fire();
        assert.equal(viewManager.calls.length, 1);

        // A stale timer callback and repeated outage ticks must both stay quiet.
        await scheduler.fire(0);
        monitor.emit(disconnectedSnapshot());
        monitor.emit(disconnectedSnapshot());
        await flush();

        assert.equal(viewManager.calls.length, 1);
        assert.equal(scheduler.scheduled.length, 1);
    });

    it('does not re-prompt when the reconnect succeeds', async () => {
        const { monitor, viewManager, scheduler } = createController();

        monitor.emit(disconnectedSnapshot());
        monitor.pushCheckResult(connectedSnapshot());
        await scheduler.fire();
        await viewManager.answer(true);

        assert.equal(monitor.checkCalls.length, 1);
        assert.equal(scheduler.scheduled.length, 1, 'a successful retry arms nothing');

        // The next outage is a fresh one, so it prompts again after a full grace period.
        monitor.emit(disconnectedSnapshot());
        assert.equal(scheduler.scheduled.length, 2);
        assert.equal(scheduler.scheduled[1].ms, GRACE);

        await scheduler.fire();
        assert.equal(viewManager.calls.length, 2);
    });

    it('waits another grace period when the reconnect fails', async () => {
        const { monitor, viewManager, scheduler } = createController();

        monitor.emit(disconnectedSnapshot());
        monitor.pushCheckResult(disconnectedSnapshot());
        await scheduler.fire();
        await viewManager.answer(true);

        assert.equal(monitor.checkCalls.length, 1);
        assert.equal(viewManager.calls.length, 1, 'no immediate second prompt');
        assert.equal(scheduler.scheduled.length, 2);
        assert.equal(scheduler.scheduled[1].ms, GRACE);
    });

    it('offers the dev escape and stops prompting for the rest of the outage', async () => {
        const { monitor, viewManager, scheduler } = createController({
            options: { dev: true },
        });

        monitor.emit(disconnectedSnapshot());
        await scheduler.fire();

        const call = viewManager.calls[0];
        assert.equal(call.cancelLabel, 'workspace.server.continue');
        assert.equal(call.showCancel, true);

        await viewManager.answer(false);
        assert.equal(monitor.checkCalls.length, 0, 'the escape never probes');

        // Neither the stale timer nor a later outage tick may prompt again.
        await scheduler.fire(0);
        monitor.emit(disconnectedSnapshot());
        await flush();
        assert.equal(viewManager.calls.length, 1);
        assert.equal(scheduler.scheduled.length, 1);

        // A reconnect ends the outage, so the next one prompts again.
        monitor.emit(connectedSnapshot());
        monitor.emit(disconnectedSnapshot());
        assert.equal(scheduler.scheduled.length, 2);
        assert.equal(scheduler.scheduled[1].ms, GRACE);
    });

    it('cannot be dismissed in a production build', async () => {
        const { monitor, viewManager, scheduler } = createController();

        monitor.emit(disconnectedSnapshot());
        await scheduler.fire();

        const call = viewManager.calls[0];
        assert.equal(call.showCancel, false);
        assert.equal(call.disableEscape, true);
        assert.equal(Object.hasOwn(call, 'cancelLabel'), false);
    });

    it('cancels the grace timer when the connection returns', async () => {
        const { monitor, viewManager, scheduler } = createController();

        monitor.emit(disconnectedSnapshot());
        const armed = scheduler.scheduled[0].handle;
        monitor.emit(connectedSnapshot());
        await flush();

        assert.equal(scheduler.cancelled.length, 1);
        assert.equal(scheduler.cancelled[0], armed);
        assert.equal(viewManager.calls.length, 0);
    });

    it('stops polling state and cancels the timer on stop', async () => {
        const { monitor, viewManager, scheduler, stop } = createController();

        monitor.emit(disconnectedSnapshot());
        stop();

        assert.equal(monitor.listenerCount(), 0);
        assert.equal(scheduler.cancelled.length, 1);

        monitor.emit(disconnectedSnapshot());
        await flush();
        assert.equal(scheduler.scheduled.length, 1);
        assert.equal(viewManager.calls.length, 0);
    });

    it('ignores a dialog answer that arrives after stop', async () => {
        const { monitor, viewManager, scheduler, stop } = createController();

        monitor.emit(disconnectedSnapshot());
        await scheduler.fire();
        stop();
        await viewManager.answer(true);

        assert.equal(viewManager.calls.length, 1);
        assert.equal(monitor.checkCalls.length, 0);
        assert.equal(scheduler.scheduled.length, 1);
    });
});

