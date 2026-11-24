// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONNECTED_POLL_MS,
    DISCONNECT_GRACE_MS,
    DISCONNECTED_POLL_MS,
    ServerConnectionMonitor,
} from '../../src/micro_otter/nodes/html/js/firmware/server-connection.js';

const READY = {
    state: 'ready',
    capabilities: { serverType: 'micro-otter', version: '1.2.3' },
    reason: null,
    detail: null,
};

const UNREACHABLE = {
    state: 'unavailable',
    capabilities: null,
    reason: 'unreachable',
    detail: null,
};

/**
 * Build a controllable `ServerCapabilitiesStore` stand-in.
 *
 * `refresh()` replays the queued snapshots in order and keeps returning the last
 * one, so a test can describe an outage and a recovery in one queue. With
 * `deferred` the answer of every probe waits for a test-driven resolve, which lets
 * a test observe the in-flight state and resolve a probe after `stop()`.
 * @param {object} [options] Fake-store options.
 * @param {boolean} [options.deferred] Hold every probe answer until the test resolves it.
 */
function createFakeStore({ deferred = false } = {}) {
    const listeners = new Set();
    const queue = [];
    const calls = [];
    const pending = [];
    const state = { current: null };

    /** Notify every store subscriber about the new snapshot. */
    function notify() {
        for (const listener of listeners) {
            listener();
        }
    }

    return {
        calls,
        pending,
        /**
         * Queue snapshots for the next probes (the last one sticks).
         * @param {...object} snapshots Capability snapshots to replay.
         */
        push(...snapshots) {
            queue.push(...snapshots);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot() {
            return state.current;
        },
        listenerCount() {
            return listeners.size;
        },
        async refresh(options = {}) {
            calls.push(options);
            const next = queue.length > 0 ? queue.shift() : state.current;
            if (deferred) {
                return new Promise((resolve) => {
                    pending.push(() => {
                        state.current = next;
                        notify();
                        resolve(next);
                    });
                });
            }
            state.current = next;
            notify();
            return next;
        },
    };
}

/**
 * Build a recording scheduler: timers are plain records the test runs by hand.
 */
function createScheduler() {
    const timers = [];
    return {
        timers,
        setTimeoutImpl(handler, delayMs) {
            const handle = { handler, delayMs, cleared: false, ran: false };
            timers.push(handle);
            return handle;
        },
        clearTimeoutImpl(handle) {
            if (handle) {
                handle.cleared = true;
            }
        },
        /** Return the last timer that was neither cleared nor run. */
        last() {
            for (let index = timers.length - 1; index >= 0; index -= 1) {
                const timer = timers[index];
                if (!timer.cleared && !timer.ran) {
                    return timer;
                }
            }
            return null;
        },
        /** Run the most recently scheduled live timer and settle its probe. */
        async run() {
            const timer = this.last();
            assert.ok(timer, 'expected a scheduled cadence timer');
            timer.ran = true;
            timer.handler();
            await flush();
        },
        /** Delays of every timer that was scheduled, in order. */
        delays() {
            return timers.map((timer) => timer.delayMs);
        },
    };
}

/**
 * Build a fake event target for `documentRef`/`windowRef`.
 */
function createEventTarget() {
    const listeners = new Map();
    return {
        hidden: false,
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type, handler) {
            if (listeners.get(type) === handler) {
                listeners.delete(type);
            }
        },
        /**
         * Invoke the handler registered for *type*, if any.
         * @param {string} type Event type to fire.
         */
        fire(type) {
            listeners.get(type)?.();
        },
        listenerTypes() {
            return [...listeners.keys()];
        },
    };
}

/** Flush microtasks plus one macrotask so awaited probes settle. */
async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Build a monitor wired to fakes, plus the fakes themselves.
 * @param {object} [options] Harness options.
 * @param {object[]} [options.snapshots] Capability snapshots to replay.
 * @param {boolean} [options.deferred] Hold every probe answer until the test resolves it.
 * @param {() => number} [options.now] Clock override; defaults to a controllable fake clock.
 */
function createHarness({ snapshots = [], deferred = false, now } = {}) {
    const store = createFakeStore({ deferred });
    store.push(...snapshots);
    const scheduler = createScheduler();
    const documentRef = createEventTarget();
    const windowRef = createEventTarget();
    let clock = 1_000;

    const monitor = new ServerConnectionMonitor({
        store,
        setTimeoutImpl: scheduler.setTimeoutImpl,
        clearTimeoutImpl: scheduler.clearTimeoutImpl,
        documentRef,
        windowRef,
        now: now ?? (() => clock),
    });

    return {
        monitor,
        store,
        scheduler,
        documentRef,
        windowRef,
        /**
         * Advance the injected clock.
         * @param {number} ms Milliseconds to advance.
         * @returns {number} The new clock value.
         */
        advance(ms) {
            clock += ms;
            return clock;
        },
        /** Read the current fake clock value. */
        now() {
            return clock;
        },
    };
}

describe('ServerConnectionMonitor', () => {
    it('reports unknown with checking false before the first probe resolves', async () => {
        const harness = createHarness({ snapshots: [READY], deferred: true });

        assert.deepEqual(harness.monitor.getSnapshot(), {
            state: 'unknown',
            reason: null,
            detail: null,
            disconnectedSince: null,
            checking: false,
        });

        harness.monitor.start();
        await flush();

        const inFlight = harness.monitor.getSnapshot();
        assert.equal(inFlight.state, 'unknown');
        assert.equal(inFlight.checking, true);

        harness.monitor.stop();
    });

    it('maps a ready probe to connected and schedules the slow cadence', async () => {
        const harness = createHarness({ snapshots: [READY] });

        harness.monitor.start();
        await flush();

        const snapshot = harness.monitor.getSnapshot();
        assert.equal(snapshot.state, 'connected');
        assert.equal(snapshot.reason, null);
        assert.equal(snapshot.detail, null);
        assert.equal(snapshot.disconnectedSince, null);
        assert.equal(snapshot.checking, false);
        assert.deepEqual(harness.store.calls, [{ force: true }]);
        assert.equal(harness.scheduler.delays().at(-1), CONNECTED_POLL_MS);

        harness.monitor.stop();
    });

    it('maps an unavailable probe to disconnected with the outage timestamp', async () => {
        const harness = createHarness({ snapshots: [UNREACHABLE] });

        harness.monitor.start();
        await flush();

        const snapshot = harness.monitor.getSnapshot();
        assert.equal(snapshot.state, 'disconnected');
        assert.equal(snapshot.reason, 'unreachable');
        assert.equal(snapshot.detail, null);
        assert.equal(snapshot.disconnectedSince, harness.now());
        assert.equal(harness.scheduler.delays().at(-1), DISCONNECTED_POLL_MS);

        harness.monitor.stop();
    });

    it('switches cadence in both directions and clears the outage on reconnect', async () => {
        const harness = createHarness({ snapshots: [READY, UNREACHABLE, READY] });

        harness.monitor.start();
        await flush();
        assert.equal(harness.scheduler.delays().at(-1), CONNECTED_POLL_MS);

        await harness.scheduler.run();
        assert.equal(harness.monitor.getSnapshot().state, 'disconnected');
        assert.equal(harness.scheduler.delays().at(-1), DISCONNECTED_POLL_MS);

        await harness.scheduler.run();
        const reconnected = harness.monitor.getSnapshot();
        assert.equal(reconnected.state, 'connected');
        assert.equal(reconnected.disconnectedSince, null);
        assert.equal(harness.scheduler.delays().at(-1), CONNECTED_POLL_MS);

        harness.monitor.stop();
    });

    it('keeps the original disconnectedSince across a second failure', async () => {
        const harness = createHarness({ snapshots: [UNREACHABLE, UNREACHABLE] });

        harness.monitor.start();
        await flush();
        const first = harness.monitor.getSnapshot().disconnectedSince;

        harness.advance(7_000);
        await harness.scheduler.run();
        const second = harness.monitor.getSnapshot().disconnectedSince;

        assert.equal(first, harness.now() - 7_000);
        assert.equal(second, first);

        harness.monitor.stop();
    });

    it('reports isPastGrace at the grace boundary only', async () => {
        const harness = createHarness({ snapshots: [UNREACHABLE] });

        harness.monitor.start();
        await flush();

        const start = harness.now();
        assert.equal(harness.monitor.isPastGrace(start), false);
        assert.equal(harness.monitor.isPastGrace(start + DISCONNECT_GRACE_MS - 1), false);
        assert.equal(harness.monitor.isPastGrace(start + DISCONNECT_GRACE_MS), true);

        harness.monitor.stop();
    });

    it('never reports isPastGrace while connected', async () => {
        const harness = createHarness({ snapshots: [READY] });

        harness.monitor.start();
        await flush();

        assert.equal(harness.monitor.isPastGrace(harness.now() + 60_000), false);

        harness.monitor.stop();
    });

describe('ServerConnectionMonitor scheduling', () => {
    it('probes immediately on checkNow and reschedules from completion', async () => {
        const harness = createHarness({ snapshots: [READY, READY], deferred: true });

        harness.monitor.start();
        harness.store.pending.shift()();
        await flush();
        assert.equal(harness.monitor.getSnapshot().state, 'connected');

        const before = harness.store.calls.length;
        const checking = [];
        const unsubscribe = harness.monitor.subscribe((snapshot) => {
            checking.push(snapshot.checking);
        });

        const pendingCheck = harness.monitor.checkNow();
        await flush();

        assert.equal(harness.store.calls.length, before + 1);
        assert.equal(harness.monitor.getSnapshot().checking, true);
        assert.equal(harness.scheduler.last(), null, 'checkNow clears the pending timer');

        harness.store.pending.shift()();
        await pendingCheck;
        unsubscribe();

        assert.equal(harness.monitor.getSnapshot().checking, false);
        assert.equal(harness.scheduler.delays().at(-1), CONNECTED_POLL_MS);
        assert.deepEqual(checking, [true, false]);

        harness.monitor.stop();
    });

    it('probes on checkNow even when the cadence is not due', async () => {
        const harness = createHarness({ snapshots: [UNREACHABLE, READY] });

        harness.monitor.start();
        await flush();
        assert.equal(harness.monitor.getSnapshot().state, 'disconnected');

        await harness.monitor.checkNow();

        assert.equal(harness.store.calls.length, 2);
        assert.equal(harness.monitor.getSnapshot().state, 'connected');
        assert.equal(harness.scheduler.delays().at(-1), CONNECTED_POLL_MS);

        harness.monitor.stop();
    });

    it('stops probing while the document is hidden and resumes once on visible', async () => {
        const harness = createHarness({ snapshots: [READY, READY] });

        harness.monitor.start();
        await flush();
        const callsBefore = harness.store.calls.length;

        harness.documentRef.hidden = true;
        await harness.scheduler.run();
        assert.equal(harness.store.calls.length, callsBefore);
        assert.equal(harness.scheduler.last(), null, 'a hidden document schedules nothing');

        harness.documentRef.hidden = false;
        harness.documentRef.fire('visibilitychange');
        await flush();

        assert.equal(harness.store.calls.length, callsBefore + 1);
        assert.ok(harness.scheduler.last(), 'becoming visible reschedules the cadence');

        harness.monitor.stop();
    });

    it('probes exactly once when the browser reports online', async () => {
        const harness = createHarness({ snapshots: [UNREACHABLE, READY] });

        harness.monitor.start();
        await flush();
        const callsBefore = harness.store.calls.length;

        harness.windowRef.fire('online');
        await flush();

        assert.equal(harness.store.calls.length, callsBefore + 1);
        assert.equal(harness.monitor.getSnapshot().state, 'connected');

        harness.monitor.stop();
    });

    it('stop clears the timer, unsubscribes the store and removes both listeners', async () => {
        const harness = createHarness({ snapshots: [READY] });

        harness.monitor.start();
        await flush();
        assert.equal(harness.store.listenerCount(), 1);
        assert.deepEqual(harness.documentRef.listenerTypes(), ['visibilitychange']);
        assert.deepEqual(harness.windowRef.listenerTypes(), ['online']);

        harness.monitor.stop();

        assert.equal(harness.store.listenerCount(), 0);
        assert.deepEqual(harness.documentRef.listenerTypes(), []);
        assert.deepEqual(harness.windowRef.listenerTypes(), []);
        assert.equal(harness.scheduler.last(), null);
    });

    it('ignores a probe that resolves after stop', async () => {
        const harness = createHarness({ snapshots: [UNREACHABLE], deferred: true });

        harness.monitor.start();
        await flush();
        const published = [];
        harness.monitor.subscribe((snapshot) => published.push(snapshot));
        const scheduledBefore = harness.scheduler.timers.length;

        harness.monitor.stop();
        harness.store.pending.shift()();
        await flush();

        assert.deepEqual(published, []);
        assert.equal(harness.monitor.getSnapshot().state, 'unknown');
        assert.equal(harness.scheduler.timers.length, scheduledBefore);
    });

    it('notifies subscribers only on a real change and stops after unsubscribe', async () => {
        const harness = createHarness({ snapshots: [READY, READY] });
        const seen = [];
        const unsubscribe = harness.monitor.subscribe((snapshot) => {
            if (seen.at(-1) !== snapshot.state) {
                seen.push(snapshot.state);
            }
        });

        harness.monitor.start();
        await flush();
        await harness.scheduler.run();

        assert.deepEqual(seen, ['unknown', 'connected']);

        unsubscribe();
        await harness.scheduler.run();
        assert.deepEqual(seen, ['unknown', 'connected']);

        harness.monitor.stop();
    });

    it('start is idempotent', async () => {
        const harness = createHarness({ snapshots: [READY] });

        harness.monitor.start();
        harness.monitor.start();
        await flush();

        assert.equal(harness.store.calls.length, 1);
        assert.equal(harness.store.listenerCount(), 1);

        harness.monitor.stop();
    });
});

});
