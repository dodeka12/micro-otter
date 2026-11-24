// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Server connection monitor - the single owner of "is the server reachable?"
 * @module firmware/server-connection
 *
 * The monitor wraps one `ServerCapabilitiesStore` and turns its snapshot into a
 * three-valued connection state the shell can render: `connected`, `disconnected`,
 * or `unknown` before the first probe resolves. It polls the capability endpoint
 * adaptively (slow while connected, quick while disconnected), pauses while the
 * page is hidden, and re-probes immediately when the tab becomes visible or the
 * browser reports that it is back online.
 *
 * Nothing else in the app probes for reachability: the title-bar badge, the
 * reconnect dialog, and the Firmware tab all read this monitor's snapshot, so the
 * three surfaces cannot disagree. The module is DOM-free apart from the two
 * injected event targets, and it never throws - every failure is already mapped to
 * an `unavailable` reason by the capability store.
 */

import {
    ServerCapabilitiesStore,
    type CapabilityUnavailableReason,
    type ServerCapabilitiesSnapshot,
} from './server-capabilities.js';

/**
 * Poll cadence while the server answers.
 *
 * One probe per 15 s is enough to notice a stopped server without keeping the dev
 * console busy; the badge only appears after a real failure, so a slow cadence
 * costs nothing in responsiveness.
 */
export const CONNECTED_POLL_MS = 15_000;

/**
 * Poll cadence while the server is unreachable.
 *
 * A shorter interval makes a restarted server reappear within a few seconds, which
 * is the moment the user is most likely watching the tab.
 */
export const DISCONNECTED_POLL_MS = 3_000;

/**
 * How long an outage may last before the shell offers to reconnect.
 *
 * The badge reacts immediately; the dialog waits 15 s so a one-off restart of the
 * dev server does not interrupt the user with a modal.
 */
export const DISCONNECT_GRACE_MS = 15_000;

/**
 * Connection state as the shell renders it.
 *
 * `unknown` is the state before the first probe resolves, never a failure state.
 */
export type ServerConnectionState = 'unknown' | 'connected' | 'disconnected';

/**
 * Immutable snapshot of the connection.
 *
 * `reason`/`detail` are the capability store's values, passed through unchanged so
 * the shell can render the same explanation the tab uses. `disconnectedSince` is
 * the timestamp of the outage start (set once per outage, not per failed probe) and
 * `checking` is true while a probe is in flight.
 */
export interface ServerConnectionSnapshot {
    state: ServerConnectionState;
    reason: CapabilityUnavailableReason | null;
    detail: string | null;
    disconnectedSince: number | null;
    checking: boolean;
}

/**
 * Structural contract the shell consumes.
 *
 * Declaring the interface here lets `WorkspaceView`, the reconnect controller, and
 * their tests take a plain fake without importing the monitor class or the
 * capability store.
 */
export interface ServerConnectionLike {
    /** Return the current snapshot. */
    getSnapshot(): ServerConnectionSnapshot;
    /** Subscribe to snapshot changes; returns an unsubscribe function. */
    subscribe(listener: (snapshot: ServerConnectionSnapshot) => void): () => void;
    /** Probe once, regardless of cadence, and resolve with the resulting snapshot. */
    checkNow(): Promise<ServerConnectionSnapshot>;
}

/** Timer handle type of the injected scheduler. */
type TimeoutHandle = ReturnType<typeof setTimeout>;

/**
 * Construction options.
 *
 * Every timing and environment seam is injectable so the suite runs without jsdom,
 * without real timers, and without touching globals.
 */
export interface ServerConnectionMonitorOptions {
    store?: ServerCapabilitiesStore;
    connectedIntervalMs?: number;
    disconnectedIntervalMs?: number;
    graceMs?: number;
    now?: () => number;
    setTimeoutImpl?: (handler: () => void, delayMs: number) => TimeoutHandle;
    clearTimeoutImpl?: (handle: TimeoutHandle) => void;
    documentRef?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
    windowRef?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/**
 * Adaptive, pausable connection monitor over one capability store.
 *
 * The monitor is the only scheduler of capability probes. It derives `connected`
 * exactly from `snapshot.state === 'ready'`, because the store already reports a
 * failed probe as `unavailable`; there is no second state machine.
 */
export class ServerConnectionMonitor implements ServerConnectionLike {
    /** Capability store shared with `FirmwareBuildView`. */
    readonly store: ServerCapabilitiesStore;

    /** Current published snapshot. */
    #snapshot: ServerConnectionSnapshot;

    /**
     * Generation token. Bumped by `start()` and `stop()`; an asynchronous probe
     * compares it after its await so a probe that resolves after `stop()` neither
     * publishes nor reschedules.
     */
    #generation = 0;

    /** Pending cadence timer, or `null` when nothing is scheduled. */
    #timer: TimeoutHandle | null = null;

    /** Snapshot listeners. */
    #listeners = new Set<(snapshot: ServerConnectionSnapshot) => void>();

    /** Unsubscribe function of the store subscription, or `null` when not started. */
    #unsubscribeStore: (() => void) | null = null;

    /** Whether `start()` ran and `stop()` did not. */
    #started = false;

    /** Cadence while connected. */
    #connectedIntervalMs: number;

    /** Cadence while disconnected. */
    #disconnectedIntervalMs: number;

    /** Outage duration after which `isPastGrace()` reports true. */
    #graceMs: number;

    /** Clock seam. */
    #now: () => number;

    /** Scheduler seam. */
    #setTimeoutImpl: (handler: () => void, delayMs: number) => TimeoutHandle;

    /** Cancellation seam. */
    #clearTimeoutImpl: (handle: TimeoutHandle) => void;

    /** Document seam: only `hidden` and the two listener methods are used. */
    #document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;

    /** Window seam: only the two listener methods are used. */
    #window: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;

    /**
     * Visibility handler. A hidden document stops the cadence; becoming visible
     * probes at once so a returning user never waits for the slow interval.
     */
    #onVisibilityChange = (): void => {
        if (this.#document?.hidden === true) {
            return;
        }
        void this.checkNow();
    };

    /** Online handler: the network came back, so probe once immediately. */
    #onOnline = (): void => {
        void this.checkNow();
    };

    constructor({
        store = new ServerCapabilitiesStore(),
        connectedIntervalMs = CONNECTED_POLL_MS,
        disconnectedIntervalMs = DISCONNECTED_POLL_MS,
        graceMs = DISCONNECT_GRACE_MS,
        now = () => Date.now(),
        setTimeoutImpl = (handler, delayMs) => setTimeout(handler, delayMs),
        clearTimeoutImpl = (handle) => clearTimeout(handle),
        documentRef = typeof document === 'undefined' ? null : document,
        windowRef = typeof window === 'undefined' ? null : window,
    }: ServerConnectionMonitorOptions = {}) {
        this.store = store;
        this.#connectedIntervalMs = connectedIntervalMs;
        this.#disconnectedIntervalMs = disconnectedIntervalMs;
        this.#graceMs = graceMs;
        this.#now = now;
        this.#setTimeoutImpl = setTimeoutImpl;
        this.#clearTimeoutImpl = clearTimeoutImpl;
        this.#document = documentRef ?? null;
        this.#window = windowRef ?? null;
        this.#snapshot = {
            state: 'unknown',
            reason: null,
            detail: null,
            disconnectedSince: null,
            checking: false,
        };
    }

    /**
     * Start polling. Idempotent: a second call while running is a no-op.
     *
     * The first probe runs immediately; the cadence is scheduled from its
     * completion, so a slow probe does not stack requests.
     */
    start(): void {
        if (this.#started) {
            return;
        }
        this.#started = true;
        this.#generation += 1;
        this.#unsubscribeStore = this.store.subscribe(() => {
            this.#derive(this.store.getSnapshot());
        });
        this.#document?.addEventListener('visibilitychange', this.#onVisibilityChange);
        this.#window?.addEventListener('online', this.#onOnline);
        void this.#tick();
    }

    /**
     * Stop polling and detach every listener. Safe to call repeatedly.
     *
     * The generation token prevents an in-flight probe from publishing its result
     * or scheduling a timer after the shell has shut the monitor down.
     */
    stop(): void {
        this.#started = false;
        this.#generation += 1;
        this.#clearTimer();
        this.#unsubscribeStore?.();
        this.#unsubscribeStore = null;
        this.#document?.removeEventListener('visibilitychange', this.#onVisibilityChange);
        this.#window?.removeEventListener('online', this.#onOnline);
    }

    /**
     * Return a copy of the current snapshot.
     *
     * A copy keeps callers from mutating the monitor's state; `unknown` is returned
     * before the first probe resolves.
     */
    getSnapshot(): ServerConnectionSnapshot {
        return { ...this.#snapshot };
    }

    /**
     * Subscribe to snapshot changes.
     *
     * Listeners fire only when the derived state actually changed, so a repeated
     * probe of the same answer never re-renders the shell. Returns an unsubscribe
     * function.
     */
    subscribe(listener: (snapshot: ServerConnectionSnapshot) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /**
     * Probe once, regardless of the cadence.
     *
     * `checking` is true for the duration of the probe, and the cadence is
     * rescheduled from the completion time so a click does not double-probe.
     */
    async checkNow(): Promise<ServerConnectionSnapshot> {
        this.#clearTimer();
        const generation = this.#generation;
        await this.#probe(generation);
        if (generation === this.#generation && this.#started) {
            this.#schedule(this.#nextDelayMs());
        }
        return this.getSnapshot();
    }

    /**
     * Whether the current outage has lasted at least `graceMs`.
     *
     * The reconnect controller asks this to decide when to offer the dialog; the
     * monitor itself never opens a dialog.
     */
    isPastGrace(now: number = this.#now()): boolean {
        if (this.#snapshot.state !== 'disconnected' || this.#snapshot.disconnectedSince === null) {
            return false;
        }
        return now - this.#snapshot.disconnectedSince >= this.#graceMs;
    }

    /**
     * One cadence step: probe unless the page is hidden, then reschedule.
     *
     * A hidden document neither probes nor reschedules - the pending timer is
     * simply allowed to expire, and `visibilitychange` restarts the cadence.
     */
    async #tick(): Promise<void> {
        if (this.#document?.hidden === true) {
            return;
        }
        const generation = this.#generation;
        await this.#probe(generation);
        if (generation !== this.#generation) {
            return;
        }
        this.#schedule(this.#nextDelayMs());
    }

    /**
     * Run one forced probe and publish its result.
     *
     * The store never rejects; the `catch` is a belt-and-braces guard so the
     * monitor can never leak a rejected promise into the shell.
     */
    async #probe(generation: number): Promise<void> {
        this.#apply({ ...this.#snapshot, checking: true });
        let result: ServerCapabilitiesSnapshot;
        try {
            result = await this.store.refresh({ force: true });
        } catch {
            result = {
                state: 'unavailable',
                capabilities: null,
                reason: 'unreachable',
                detail: null,
            };
        }
        if (generation !== this.#generation) {
            return;
        }
        this.#derive(result);
    }

    /**
     * Map a capability snapshot to the connection state and publish it.
     *
     * This is the only place the mapping happens: `ready` means `connected` and
     * clears the outage timestamp, `unavailable` means `disconnected` and keeps the
     * original outage start, and a missing snapshot means `unknown`.
     */
    #derive(capabilities: ServerCapabilitiesSnapshot | null): void {
        const next: ServerConnectionSnapshot = { ...this.#snapshot, checking: false };

        if (!capabilities) {
            next.state = 'unknown';
            next.reason = null;
            next.detail = null;
            next.disconnectedSince = null;
        } else if (capabilities.state === 'ready') {
            next.state = 'connected';
            next.reason = null;
            next.detail = null;
            next.disconnectedSince = null;
        } else {
            const wasDisconnected = this.#snapshot.state === 'disconnected';
            next.state = 'disconnected';
            next.reason = capabilities.reason;
            next.detail = capabilities.detail;
            next.disconnectedSince = wasDisconnected
                ? (this.#snapshot.disconnectedSince ?? this.#now())
                : this.#now();
        }

        this.#apply(next);
    }

    /**
     * Publish *next* and notify listeners when any observable field changed.
     *
     * Field-wise comparison (not object identity) is what keeps an unchanged probe
     * from re-rendering the badge.
     */
    #apply(next: ServerConnectionSnapshot): void {
        const changed =
            next.state !== this.#snapshot.state ||
            next.reason !== this.#snapshot.reason ||
            next.detail !== this.#snapshot.detail ||
            next.disconnectedSince !== this.#snapshot.disconnectedSince ||
            next.checking !== this.#snapshot.checking;

        this.#snapshot = next;

        if (!changed) {
            return;
        }

        const published = this.getSnapshot();
        for (const listener of this.#listeners) {
            listener(published);
        }
    }

    /**
     * Schedule the next cadence step, replacing any pending timer.
     */
    #schedule(delayMs: number): void {
        this.#clearTimer();
        this.#timer = this.#setTimeoutImpl(() => {
            this.#timer = null;
            void this.#tick();
        }, delayMs);
    }

    /**
     * Cancel the pending cadence timer, if any.
     */
    #clearTimer(): void {
        if (this.#timer === null) {
            return;
        }
        this.#clearTimeoutImpl(this.#timer);
        this.#timer = null;
    }

    /**
     * Delay of the next cadence step: the quick interval while disconnected, the
     * slow one otherwise.
     */
    #nextDelayMs(): number {
        return this.#snapshot.state === 'disconnected'
            ? this.#disconnectedIntervalMs
            : this.#connectedIntervalMs;
    }
}
