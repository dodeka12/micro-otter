// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Device connection monitor - the single owner of "what is the device doing?"
 * @module serial/device-connection-monitor
 *
 * The monitor wraps one `DeviceConnection` and turns its `statechange` events plus
 * the `device-info-load` progress stream into the six states the shell renders:
 * `disconnected`, `connecting`, `loading`, `connected`, `disconnecting`, `error`.
 *
 * `DeviceConnection` keeps its four-value `ConnectionState`; the monitor adds the two
 * states only the UI needs (`loading` while device information is read, and
 * `disconnecting` while a disconnect the monitor itself started is in flight) and
 * carries the percentage the `device-info-load` tracker already produces. Both the
 * title-bar device badge and the connection dialog read this one snapshot, so they
 * cannot disagree - the same arrangement M4s introduced for server state with
 * `ServerConnectionMonitor`.
 *
 * The module is DOM-free: it talks to a structural connection and an injectable
 * progress bus, so a suite needs neither a serial port nor jsdom.
 */

import { ProgressEventBus, ProgressEventType } from '../core/progress-events.js';
import type { ProgressEvent, ProgressEventListener } from '../core/progress-events.js';
import { toErrorMessage } from '../core/error-utils.js';
import { isConnectCancelled } from './serial-connection-base.js';

/**
 * Progress source both device-info trackers use.
 *
 * `DeviceConnection` and `DeviceDeployment` start `new ProgressTracker('device-info-load')`
 * for the identification exchange, so the monitor can ignore every other source.
 */
export const DEVICE_INFO_PROGRESS_SOURCE = 'device-info-load';

/**
 * Device connection state as the shell renders it.
 *
 * `loading` and `disconnecting` are monitor-owned states: the core class models
 * neither, but the badge has to say "Loading 55 %" and "Disconnecting…".
 */
export type DeviceConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'loading'
    | 'connected'
    | 'disconnecting'
    | 'error';

/**
 * Immutable snapshot of the device connection.
 */
export interface DeviceConnectionSnapshot {
    /** Current shell state. */
    readonly state: DeviceConnectionState;
    /** 0–100 while `state === 'loading'`, otherwise `null`. */
    readonly progress: number | null;
    /** Upstream `device-info-load` message, or `null`. */
    readonly message: string | null;
    /** Active provider key, or `null` before one is chosen. */
    readonly providerKey: string | null;
    /** Last failure message, or `null`. */
    readonly error: string | null;
}

/**
 * One selectable connection provider, as the dialog's dropdown needs it.
 */
export interface DeviceConnectionProviderLike {
    /** Human-readable provider name shown in the dropdown. */
    readonly name?: string;
}

/**
 * The `statechange` detail `DeviceConnection._setState()` dispatches.
 */
export interface DeviceStateChangeDetail {
    /** State the connection moved to. */
    readonly state?: string;
    /** State the connection moved from. */
    readonly previousState?: string;
}

/**
 * The `device-initialization-status` detail the connection dispatches.
 *
 * Only the onboarding flag matters here: the monitor turns it into the
 * pre-onboarding close signal, so a progress surface can clear the modal layer
 * before the connection opens its target-selection form.
 */
export interface DeviceInitializationStatusDetailLike {
    /** Whether the connection is about to request target selection from the user. */
    readonly onboardingActionable?: boolean;
}

/**
 * Connection events the monitor observes.
 *
 * `statechange` drives the snapshot; `device-initialization-status` supplies the
 * synchronous pre-onboarding signal.
 */
export type DeviceConnectionEventType =
    | 'statechange'
    | 'device-initialization-status';


/**
 * Structural contract of the wrapped connection.
 *
 * Declaring the subset here keeps the monitor independent of
 * `device-connection.ts` (and of its `EventTarget` base), so tests pass a plain
 * fake - the same approach as `FirmwareDeviceConnectionLike` in
 * `firmware-build-view.ts` and `ServerConnectionLike` in `server-connection.ts`.
 */
export interface DeviceConnectionLike {
    /** Whether a device is connected right now. */
    isConnected(): boolean;
    /** The core class's four-value state (`disconnected`, `connecting`, `connected`, `error`). */
    getState(): string;
    /** Every registered provider, keyed by provider key. */
    getProviders(): Record<string, DeviceConnectionProviderLike>;
    /** Key of the provider the next `connect()` uses, or `null`. */
    getActiveProviderKey(): string | null;
    /** Choose the provider the next `connect()` uses. */
    setActiveProvider(providerKey: string): void;
    /** Open the connection with provider-specific options. */
    connect(options?: Record<string, unknown>): Promise<void>;
    /** Close the connection. */
    disconnect(): Promise<void>;
    /** Cancel an in-flight `connect()`; returns whether an attempt was cancelled. */
    cancelConnect(): boolean;
    /** Listen for `statechange` or the pre-onboarding status. */
    addEventListener(type: DeviceConnectionEventType, listener: (event: Event) => void): void;
    /** Stop listening for `statechange` or the pre-onboarding status. */
    removeEventListener(type: DeviceConnectionEventType, listener: (event: Event) => void): void;
}

/**
 * Structural contract of the progress bus.
 *
 * `ProgressEventBus` is a static singleton whose `subscribe`/`unsubscribe` take a
 * plain listener, so it satisfies this interface unchanged; tests inject a bus
 * they can drive synchronously.
 */
export interface ProgressBusLike {
    /** Register a listener for progress events. */
    subscribe(listener: ProgressEventListener): void;
    /** Remove a listener; returns whether it was registered. */
    unsubscribe(listener: ProgressEventListener): boolean;
}

/**
 * Minimal logger seam.
 *
 * The monitor never throws on a failed disconnect (the connection swallows its own
 * transport errors), so the only thing it can do with an unexpected failure is
 * record it - the dialog reports the failure to the user.
 */
export interface DeviceConnectionMonitorLoggerLike {
    /** Record a non-fatal problem. */
    warn?: (message: string, detail?: unknown) => void;
}

/**
 * Construction options.
 */
export interface DeviceConnectionMonitorOptions {
    /** Connection the monitor observes and drives. */
    deviceConnection: DeviceConnectionLike;
    /** Progress bus to read device-info progress from; defaults to `ProgressEventBus`. */
    progressBus?: ProgressBusLike;
    /** Optional logger for non-fatal problems. */
    logger?: DeviceConnectionMonitorLoggerLike | null;
}

/**
 * Clamp an upstream progress value into `0…100`.
 *
 * A tracker that carries no finite number (an indeterminate step) answers `null`,
 * which the badge renders without a ring.
 * @param value Raw progress from the event.
 * @returns Rounded percentage, or `null` when the value is not finite.
 */
function normalizeProgress(value: number | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Derive the shell state from the core class's four-value state.
 *
 * Used by `start()` so a monitor created after a connection already exists shows
 * the truth instead of `disconnected`.
 * @param state Value of `DeviceConnection.getState()`.
 * @returns The matching shell state.
 */
function stateFromConnection(state: string): DeviceConnectionState {
    switch (state) {
        case 'connected':
            return 'connected';
        case 'connecting':
            return 'connecting';
        case 'error':
            return 'error';
        default:
            return 'disconnected';
    }
}

/**
 * Read the state out of a `statechange` event.
 * @param event Event dispatched by `DeviceConnection._setState()`.
 * @returns The new state name, or an empty string when the detail is malformed.
 */
function stateFromEvent(event: Event): string {
    const detail = (event as CustomEvent<DeviceStateChangeDetail | undefined>).detail;
    return detail?.state ?? '';
}


/**
 * Owns the device connection state for the badge and the connection dialog.
 *
 * One instance per app session, created before the views and injected into them.
 * The monitor never opens a dialog and never reconnects on its own: it derives
 * state, offers `connect()`/`disconnect()` pass-throughs that report their outcome
 * through the snapshot, and lets the caller decide what to render.
 */
export class DeviceConnectionMonitor {
    /** Connection the monitor observes and drives. */
    readonly deviceConnection: DeviceConnectionLike;

    /** Current published snapshot. */
    #snapshot: DeviceConnectionSnapshot;

    /** Whether `start()` ran and `stop()` did not. */
    #started = false;

    /** Snapshot listeners. */
    #listeners = new Set<(snapshot: DeviceConnectionSnapshot) => void>();

    /**
     * Pre-onboarding listeners.
     *
     * Kept separate from the snapshot listeners because the signal is not part of
     * the snapshot: the progress surface has to close before the connection opens
     * its target-selection form, and a snapshot field would force every existing
     * fixture to grow a value it does not use.
     */
    #onboardingListeners = new Set<() => void>();

    /** Progress bus the monitor subscribes to while started. */
    #progressBus: ProgressBusLike;

    /** Optional logger for non-fatal problems. */
    #logger: DeviceConnectionMonitorLoggerLike | null;

    /**
     * Message of the last failed `connect()`.
     *
     * `DeviceConnection._setState()` dispatches `error` without a reason, so the
     * monitor keeps the rejection message here and attaches it to the next `error`
     * transition.
     */
    #lastConnectError: string | null = null;

    /**
     * The in-flight `connect()` promise, so a duplicate call joins the running
     * attempt instead of publishing a second `connecting`.
     */
    #connectPromise: Promise<void> | null = null;

    /**
     * Build a monitor over *deviceConnection*.
     * @param options Connection, progress bus and logger seams.
     */
    constructor({ deviceConnection, progressBus = ProgressEventBus, logger = null }: DeviceConnectionMonitorOptions) {
        this.deviceConnection = deviceConnection;
        this.#progressBus = progressBus;
        this.#logger = logger;
        this.#snapshot = {
            state: 'disconnected',
            progress: null,
            message: null,
            providerKey: deviceConnection.getActiveProviderKey(),
            error: null,
        };
    }

    /**
     * Start observing the connection. Idempotent.
     *
     * The first call syncs the snapshot from the connection, so a monitor created
     * after a session already connected does not claim `disconnected`.
     */
    start(): void {
        if (this.#started) {
            return;
        }
        this.#started = true;
        this.deviceConnection.addEventListener('statechange', this.#onStateChange);
        this.deviceConnection.addEventListener(
            'device-initialization-status',
            this.#onInitializationStatus
        );
        this.#progressBus.subscribe(this.#onProgress);
        this.#syncFromConnection();
    }

    /**
     * Stop observing the connection and detach every listener. Safe to call
     * repeatedly, so `WorkspaceView.detach()` needs no bookkeeping.
     */
    stop(): void {
        if (!this.#started) {
            return;
        }
        this.#started = false;
        this.deviceConnection.removeEventListener('statechange', this.#onStateChange);
        this.deviceConnection.removeEventListener(
            'device-initialization-status',
            this.#onInitializationStatus
        );
        this.#progressBus.unsubscribe(this.#onProgress);
    }

    /**
     * Return a copy of the current snapshot.
     *
     * A copy keeps callers from mutating the monitor's state.
     * @returns The current snapshot.
     */
    getSnapshot(): DeviceConnectionSnapshot {
        return { ...this.#snapshot };
    }

    /**
     * Subscribe to snapshot changes.
     *
     * Listeners fire only when the snapshot actually changed, so the two
     * `disconnected` paths a disconnect produces (the state transition and the
     * `finally`) are delivered once. Returns an unsubscribe function.
     * @param listener Callback receiving the published snapshot.
     * @returns Unsubscribe function.
     */
    subscribe(listener: (snapshot: DeviceConnectionSnapshot) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /**
     * Subscribe to the synchronous pre-onboarding signal.
     *
     * The listener fires when `DeviceConnection` is about to ask the user to pick a
     * target, immediately before it opens the selection form. A surface that owns the
     * modal layer must close itself here, because the form's `showModal()` clears the
     * layer synchronously. The signal is safe to subscribe to before or after
     * `start()`; `start()` only decides whether the underlying event is observed.
     * @param listener Callback invoked once per actionable status emission.
     * @returns Unsubscribe function.
     */
    subscribeOnboardingPrompt(listener: () => void): () => void {
        this.#onboardingListeners.add(listener);
        return () => {
            this.#onboardingListeners.delete(listener);
        };
    }


    /**
     * Connect, reporting the attempt through the snapshot.
     *
     * `connecting` is published before the await and a latched `error` is cleared,
     * so the badge leaves `Failed` on a retry. A rejection is recorded as `error`
     * and rethrown: the dialog's `open()` sequencer reports it with
     * `ViewManager.showError`, and hiding the failure here would leave the user
     * with a badge that silently returned to `Connect`. A cancellation
     * (`ConnectCancelledError`) is the exception: it settles on `disconnected`
     * without latching `error`.
     *
     * A second call while one is in flight joins the running attempt instead of
     * publishing a second `connecting`.
     * @param options Provider-specific connect options.
     * @throws The connection's own rejection, unchanged.
     */
    async connect(options: Record<string, unknown> = {}): Promise<void> {
        if (this.#connectPromise) {
            return this.#connectPromise;
        }

        this.#lastConnectError = null;
        this.#apply({
            state: 'connecting',
            progress: null,
            message: null,
            error: null,
        });

        const attempt = (async () => {
            try {
                await this.deviceConnection.connect(options);
            } catch (error) {
                if (isConnectCancelled(error)) {
                    this.#lastConnectError = null;
                    this.#apply({
                        state: 'disconnected',
                        progress: null,
                        message: null,
                        error: null,
                    });
                    throw error;
                }
                const message = toErrorMessage(error);
                this.#lastConnectError = message;
                this.#apply({ state: 'error', progress: null, message, error: message });
                throw error;
            }
        })();

        this.#connectPromise = attempt;
        try {
            await attempt;
        } finally {
            if (this.#connectPromise === attempt) {
                this.#connectPromise = null;
            }
        }
    }

    /**
     * Cancel the in-flight connect attempt, if any.
     *
     * Delegates to the connection and, only when an attempt was actually cancelled,
     * settles the snapshot on `disconnected` without latching an error.
     * @returns Whether an attempt was cancelled.
     */
    cancelConnect(): boolean {
        const cancelled = this.deviceConnection.cancelConnect();
        if (cancelled) {
            this.#lastConnectError = null;
            this.#apply({
                state: 'disconnected',
                progress: null,
                message: null,
                error: null,
            });
        }
        return cancelled;
    }

    /**
     * Disconnect, reporting the attempt through the snapshot.
     *
     * `disconnecting` is published before the await and `disconnected` in a
     * `finally`, so a transport that swallows its own error cannot leave the badge
     * spinning.
     */
    async disconnect(): Promise<void> {
        this.#apply({
            state: 'disconnecting',
            progress: null,
            message: null,
            error: null,
        });

        try {
            await this.deviceConnection.disconnect();
        } catch (error) {
            // `DeviceConnection.disconnect()` already swallows transport errors;
            // this branch only runs for a structural fake. The `finally` below
            // still settles the badge on `disconnected`.
            this.#logger?.warn?.('device-connection-monitor: disconnect failed', {
                error: toErrorMessage(error),
            });
        } finally {
            this.#apply({
                state: 'disconnected',
                progress: null,
                message: null,
                error: null,
            });
        }
    }

    /**
     * Clear a latched `error` back to `disconnected`.
     *
     * The badge calls this when its dialog opens, so "Failed" is dismissible
     * without a reconnect attempt. Any other state is left untouched.
     */
    resetError(): void {
        if (this.#snapshot.state !== 'error') {
            return;
        }
        this.#lastConnectError = null;
        this.#apply({
            state: 'disconnected',
            progress: null,
            message: null,
            error: null,
        });
    }

    /**
     * Every provider the connection offers, for the dialog's dropdown.
     * @returns Provider map keyed by provider key.
     */
    getProviders(): Record<string, DeviceConnectionProviderLike> {
        return this.deviceConnection.getProviders();
    }

    /**
     * Choose the provider the next connect uses, and publish the new key.
     *
     * The connection throws when the provider is switched while connected; the
     * dialog catches that and keeps the dropdown on the current value.
     * @param providerKey Provider key from `getProviders()`.
     * @throws When `DeviceConnection` refuses the switch.
     */
    setActiveProvider(providerKey: string): void {
        this.deviceConnection.setActiveProvider(providerKey);
        this.#apply({});
    }


    /**
     * `device-initialization-status` handler for the pre-onboarding signal.
     *
     * Only an actionable status notifies: every other verdict (ready, unknown,
     * runtime-install) describes a device that needs no selection, and a missing
     * detail is treated as non-actionable. Delivery is synchronous so a listener's
     * `close()` clears the modal layer before the connection opens its form.
     * @param event Event dispatched by `DeviceConnection._emitDeviceInitializationStatus()`.
     * @private
     */
    #onInitializationStatus = (event: Event): void => {
        const detail = (event as CustomEvent<DeviceInitializationStatusDetailLike>).detail;
        if (detail?.onboardingActionable !== true) {
            return;
        }
        for (const listener of [...this.#onboardingListeners]) {
            listener();
        }
    };

    /**
     * `statechange` handler: the transition table of the module documentation.
     *
     * `connected` while `loading` is ignored because the bridge provider re-emits
     * `connected` when the WebSocket reconnects mid-load, and resetting there would
     * blank the ring the user is watching. `disconnected` while `error` is ignored
     * because `error` latches until `resetError()` or a retry.
     * @param event Event dispatched by `DeviceConnection._setState()`.
     * @private
     */
    #onStateChange = (event: Event): void => {
        switch (stateFromEvent(event)) {
            case 'connecting':
                this.#apply({
                    state: 'connecting',
                    progress: null,
                    message: null,
                    error: null,
                });
                return;

            case 'connected':
                if (this.#snapshot.state === 'loading') {
                    this.#apply({});
                    return;
                }
                this.#apply({
                    state: 'connected',
                    progress: null,
                    message: null,
                    error: null,
                });
                return;

            case 'error':
                this.#apply({
                    state: 'error',
                    progress: null,
                    message: this.#lastConnectError,
                    error: this.#lastConnectError,
                });
                return;

            case 'disconnected':
                if (this.#snapshot.state === 'error') {
                    // The latch survives the core class's closing transition.
                    this.#apply({});
                    return;
                }
                this.#apply({
                    state: 'disconnected',
                    progress: null,
                    message: null,
                    error: null,
                });
                return;

            default:
                this.#apply({});
        }
    };

    /**
     * `ProgressEventBus` handler for the device-info exchange.
     *
     * Events from any other source are ignored, and so is the whole family while
     * the connection reports no device: a stale tracker from a failed connect must
     * not paint a ring over a disconnected device.
     * @param event Progress event published by a `ProgressTracker`.
     * @private
     */
    #onProgress = (event: ProgressEvent): void => {
        if (event.source !== DEVICE_INFO_PROGRESS_SOURCE) {
            return;
        }
        if (!this.deviceConnection.isConnected()) {
            return;
        }

        switch (event.type) {
            case ProgressEventType.START:
            case ProgressEventType.UPDATE:
                this.#apply({
                    state: 'loading',
                    progress: normalizeProgress(event.progress),
                    message: event.message,
                });
                return;

            case ProgressEventType.COMPLETE:
                this.#apply({ state: 'connected', progress: null, message: null });
                return;

            case ProgressEventType.ERROR:
                this.#apply({
                    state: 'error',
                    progress: null,
                    message: event.message,
                    error: event.message,
                });
                return;

            default:
                return;
        }
    };

    /**
     * Sync the snapshot from the connection's current state.
     *
     * Called by `start()` only; later truth comes from events.
     * @private
     */
    #syncFromConnection(): void {
        const state = stateFromConnection(this.deviceConnection.getState());
        this.#apply({ state, progress: null, message: null, error: null });
    }

    /**
     * Publish a patch of the snapshot and notify listeners when anything changed.
     *
     * `providerKey` is refreshed from the connection on every call, because the
     * dialog changes it through `setActiveProvider()` without a state change.
     * @param patch Fields to overwrite.
     * @private
     */
    #apply(patch: Partial<DeviceConnectionSnapshot>): void {
        const next: DeviceConnectionSnapshot = {
            ...this.#snapshot,
            ...patch,
            providerKey: this.deviceConnection.getActiveProviderKey(),
        };

        const changed =
            next.state !== this.#snapshot.state ||
            next.progress !== this.#snapshot.progress ||
            next.message !== this.#snapshot.message ||
            next.providerKey !== this.#snapshot.providerKey ||
            next.error !== this.#snapshot.error;

        this.#snapshot = next;

        if (!changed || this.#listeners.size === 0) {
            return;
        }

        const published = this.getSnapshot();
        for (const listener of this.#listeners) {
            listener(published);
        }
    }
}
