// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Server connection reconnect controller - the prompting policy for outages
 * @module app/server-connection-controller
 *
 * The controller owns the *prompting* policy only. It never probes on its own (it
 * asks `monitor.checkNow()` after the user answers the dialog), never renders, and
 * never decides the connection state - that stays in `ServerConnectionMonitor`.
 *
 * The title-bar badge reacts to an outage immediately; this controller waits out
 * `DISCONNECT_GRACE_MS` first, because most outages are a restart of the dev server
 * that heals itself without a modal interrupting the user. The dialog is the shared
 * `ViewManager.showConfirmation`, so the module needs no DOM and no dialog class.
 */

import {
    DISCONNECT_GRACE_MS,
    type ServerConnectionLike,
    type ServerConnectionSnapshot,
} from '../firmware/server-connection.js';

/**
 * Structural subset of `ViewManager` the controller needs.
 *
 * Declaring the subset (instead of importing `ViewManager`) keeps the module
 * DOM-free and lets the suite pass a recording fake.
 */
export interface ServerConnectionDialogHost {
    /** Show a modal confirmation and resolve with the user's answer. */
    showConfirmation(options: Record<string, unknown>): Promise<boolean>;
}

/**
 * Construction options.
 *
 * Timing, clock, and scheduler are injectable so the suite runs without jsdom and
 * without real timers.
 */
export interface ServerConnectionControllerOptions {
    /** Monitor whose snapshots drive the prompting policy. */
    monitor: ServerConnectionLike;
    /** Dialog host - the workspace `ViewManager`. */
    viewManager: ServerConnectionDialogHost;
    /** Host translate function. */
    t: (key: string, params?: Record<string, unknown>) => string;
    /** Whether this is a dev build; enables *Continue without server* (default `false`). */
    dev?: boolean;
    /** Outage duration before prompting (default `DISCONNECT_GRACE_MS`). */
    graceMs?: number;
    /** Clock seam (default `Date.now`). */
    now?: () => number;
    /** Scheduler seam (default `setTimeout`). */
    schedule?: (fn: () => void, ms: number) => unknown;
    /** Cancellation seam (default `clearTimeout`). */
    cancelSchedule?: (handle: unknown) => void;
}

/**
 * Subscribe to the monitor and offer a reconnect dialog once an outage outlasts the
 * grace period.
 *
 * Prompting is at most one dialog at a time: an open dialog, a pending grace timer,
 * and (in a dev build) the *Continue without server* escape each suppress another
 * prompt for the same outage. The returned stop function unsubscribes, cancels the
 * timer, and makes an in-flight dialog result a no-op.
 * @param options Controller seams and collaborators.
 * @returns Stop function that detaches the controller.
 */
export function startServerConnectionController({
    monitor,
    viewManager,
    t,
    dev = false,
    graceMs = DISCONNECT_GRACE_MS,
    now = () => Date.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancelSchedule = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: ServerConnectionControllerOptions): () => void {
    /** Set by the stop function; every async continuation re-checks it. */
    let stopped = false;

    /** True while a dialog is open or its retry probe is running. */
    let prompted = false;

    /** True after the dev escape was chosen; cleared by the next `connected`. */
    let suppressed = false;

    /** Pending grace timer handle, or `null` when nothing is armed. */
    let handle: unknown = null;

    /** Cancel the grace timer, if one is armed. */
    function disarm(): void {
        if (handle === null) {
            return;
        }
        cancelSchedule(handle);
        handle = null;
    }

    /**
     * Arm the grace timer, unless a dialog is open, the outage is suppressed, or a
     * timer is already running - those three cases would double-prompt.
     */
    function arm(delayMs: number): void {
        if (stopped || prompted || suppressed || handle !== null) {
            return;
        }
        handle = schedule(() => {
            handle = null;
            void prompt();
        }, delayMs);
    }

    /**
     * Milliseconds left of this outage's grace period.
     *
     * The controller can start mid-outage (a resumed tab, a test harness), so the
     * remaining time is derived from the monitor's outage start instead of resetting
     * the full grace period. A missing timestamp falls back to the full period.
     */
    function remainingGraceMs(snapshot: ServerConnectionSnapshot): number {
        const since = snapshot.disconnectedSince;
        if (since === null || !Number.isFinite(since)) {
            return graceMs;
        }
        const elapsed = now() - since;
        if (!Number.isFinite(elapsed) || elapsed <= 0) {
            return graceMs;
        }
        return Math.max(0, graceMs - elapsed);
    }

    /** Ask the user to reconnect and act on the answer. */
    async function prompt(): Promise<void> {
        if (stopped || prompted || suppressed) {
            return;
        }
        prompted = true;
        disarm();

        const retry = await viewManager.showConfirmation({
            title: t('workspace.server.dialogTitle'),
            message: t('workspace.server.dialogMessage'),
            detail: t('workspace.server.dialogDetail'),
            icon: '🔌',
            confirmLabel: t('workspace.server.retry'),
            ...(dev
                ? { cancelLabel: t('workspace.server.continue'), showCancel: true }
                : { showCancel: false, disableEscape: true }),
        });

        if (stopped) {
            return;
        }

        if (retry !== true) {
            prompted = false;
            if (dev) {
                // The user chose to keep working without the server: stay quiet until
                // the connection returns, so the same outage cannot prompt twice.
                suppressed = true;
                return;
            }
            // Production dialogs cannot be dismissed, so `false` only happens when the
            // view manager closed it. Ask again after another grace period.
            arm(graceMs);
            return;
        }

        const snapshot = await monitor.checkNow();
        if (stopped) {
            return;
        }
        prompted = false;
        if (snapshot.state !== 'connected') {
            // Retry failed: wait another grace period instead of looping on the modal.
            arm(remainingGraceMs(snapshot));
        }
    }

    /**
     * React to a snapshot: `connected` resets the prompting state, `disconnected`
     * starts the grace timer, `unknown` does nothing.
     */
    function onSnapshot(snapshot: ServerConnectionSnapshot): void {
        if (stopped) {
            return;
        }
        if (snapshot.state === 'connected') {
            disarm();
            suppressed = false;
            prompted = false;
            return;
        }
        if (snapshot.state === 'disconnected') {
            arm(remainingGraceMs(snapshot));
        }
    }

    const unsubscribe = monitor.subscribe(onSnapshot);

    return () => {
        stopped = true;
        unsubscribe();
        disarm();
    };
}
