// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Deployment progress controller - one modal progress surface for device writes
 * @module app/deployment-progress-controller
 *
 * Every device **write** operation — collection deploy, sync and remove, runtime install, upgrade,
 * remove and refresh — reports through `DeploymentProgressDialogView`
 * (`../views/deployment-progress-dialog-view.js`). This controller is the only component that
 * touches the modal layer: it opens the dialog on the operation's own `start` event, feeds the
 * setters, marks the terminal state and closes after a linger.
 *
 * Because the signal comes from the operation tracker and not from a call site, the title-bar
 * **Deploy** button, the Device tab and any future trigger all get the dialog with no per-trigger
 * code. The controller is modelled on `server-connection-controller.ts`: a factory returning
 * `stop()`, every collaborator injected, no DOM and no `ViewManager` import (the host is a
 * structural subset), so the suite runs against recording fakes.
 *
 * Two guards keep the single modal slot intact:
 * - **Identity** — `ViewManager.showModal()` clears the layer before showing, and its close watcher
 *   clears it again unconditionally, so a late `close()` would evict whatever dialog owns the layer
 *   by then. Every close path compares `viewManager.modalView` with the dialog *instance*.
 * - **Generation** — a linger timer only closes the operation it was armed for; operation *n*'s
 *   timer can never close operation *n+1*'s dialog.
 */

/** Operation tracker source → dialog title key. Reuses existing locale keys; no new strings. */
export const DEPLOYMENT_PROGRESS_OPERATIONS = {
    'collection-deploy': 'deployment.deployCollection',
    'collection-sync': 'deployment.syncCollection',
    'collection-remove': 'deployment.removeCollection',
    'runtime-install': 'deployment.installRuntime',
    'runtime-upgrade': 'deployment.upgradeRuntime',
    'runtime-remove': 'deployment.removeRuntime',
    'runtime-refresh': 'deployment.refreshRuntime',
} as const;

/** One of the tracker sources that drives the dialog. */
export type DeploymentProgressOperationSource = keyof typeof DEPLOYMENT_PROGRESS_OPERATIONS;

/** Default linger after a successful operation, matching the removed inline panel. */
export const COMPLETE_LINGER_MS = 2000;

/** Default linger after a failed operation, matching the removed inline panel. */
export const ERROR_LINGER_MS = 5000;

/**
 * Structural shape of a `ProgressEvent`.
 *
 * Declared locally so the controller does not import the event class just for typing; the fields
 * are exactly what the routes below read.
 */
export interface ProgressEventLike {
    /** Tracker that published the event, e.g. `collection-sync` or `file-send-main.py`. */
    source: string;
    /** Event type: `start`, `update`, `complete` or `error`. */
    type: string;
    /** Human-readable message; already translated by the producer. */
    message?: string;
    /** Reported percentage, when the producer has one. */
    progress?: number;
    /** Optional producer-specific payload; not read here. */
    detail?: unknown;
}

/** The dialog surface the controller drives; `DeploymentProgressDialogView` implements it. */
export interface DeploymentProgressDialogLike {
    /** Set the phase line. */
    setPhase(message: string): void;
    /** Set the overall tier. */
    setOverall(progress: number, message: string): void;
    /** Set the file tier. */
    setFile(progress: number, message: string): void;
    /** Mark the operation as succeeded. */
    markComplete(message: string): void;
    /** Mark the operation as failed. */
    markError(message: string): void;
}

/**
 * Structural subset of `ViewManager` the controller needs.
 *
 * `modalView` is the identity guard: it tells the controller whether the dialog still owns the
 * single modal slot before it closes anything.
 */
export interface DeploymentProgressModalHost {
    /** Show the dialog in the modal layer. */
    showModal(view: DeploymentProgressDialogLike, options?: { scrim?: boolean }): unknown;
    /** Clear the modal layer (detaches and hides the current content). */
    clearModal(): void;
    /** The view currently owning the modal layer, or `null`. */
    readonly modalView: unknown;
}

/** Construction options. */
export interface DeploymentProgressControllerOptions {
    /** Modal host — the workspace `ViewManager`. */
    viewManager: DeploymentProgressModalHost;
    /** Build a dialog for the translated operation title. */
    createDialog: (title: string) => DeploymentProgressDialogLike;
    /** Subscribe to progress events; returns the unsubscribe function. */
    subscribe: (listener: (event: ProgressEventLike) => void) => () => void;
    /** Translate a locale key. */
    t: (key: string, params?: Record<string, unknown>) => string;
    /** Scheduler seam (default `setTimeout`). */
    setTimeout?: (handler: () => void, ms: number) => unknown;
    /** Cancellation seam (default `clearTimeout`). */
    clearTimeout?: (handle: unknown) => void;
    /** Linger after `complete` (default `COMPLETE_LINGER_MS`). */
    completeLingerMs?: number;
    /** Linger after `error` (default `ERROR_LINGER_MS`). */
    errorLingerMs?: number;
    /** Optional logger for ignored starts. */
    logger?: ((message: string) => void) | null;
}

/** The operation the dialog currently reports. */
interface ActiveOperation {
    /** Tracker source that opened the dialog. */
    source: string;
    /** Dialog instance shown by the controller. */
    dialog: DeploymentProgressDialogLike;
    /** Linger generation; a timer from an older generation must not close this dialog. */
    generation: number;
    /** Last overall percentage, so an `update` without `progress` keeps the bar where it was. */
    overall: number;
    /** Last file percentage, same reason. */
    file: number;
    /** True once a terminal event arrived; the linger is running and a new operation may start. */
    settled: boolean;
}

/**
 * Route `ProgressEventBus` traffic into one dialog lifecycle.
 *
 * Module-private: callers use `startDeploymentProgressController()`, which wires the seams and
 * returns its `stop()`.
 */
class DeploymentProgressController {
    /** Modal host that owns the single modal slot. */
    #viewManager: DeploymentProgressModalHost;

    /** Dialog factory. */
    #createDialog: (title: string) => DeploymentProgressDialogLike;

    /** Bus subscription. */
    #subscribe: (listener: (event: ProgressEventLike) => void) => () => void;

    /** Translator for titles and the idle file text. */
    #t: (key: string, params?: Record<string, unknown>) => string;

    /** Scheduler seam. */
    #setTimeout: (handler: () => void, ms: number) => unknown;

    /** Cancellation seam. */
    #clearTimeout: (handle: unknown) => void;

    /** Linger after success. */
    #completeLingerMs: number;

    /** Linger after failure. */
    #errorLingerMs: number;

    /** Optional logger. */
    #logger: ((message: string) => void) | null;

    /** Operation being reported, or `null` when idle. */
    #active: ActiveOperation | null = null;

    /** Monotonic generation counter for linger timers. */
    #generation = 0;

    /** Pending linger handle, or `null` when nothing is armed. */
    #linger: unknown = null;

    /** Bus unsubscribe function, or `null` before `start()` / after `stop()`. */
    #unsubscribe: (() => void) | null = null;

    /** Set by `stop()`; a stopped controller ignores any event that still reaches it. */
    #stopped = false;

    /**
     * @param options Controller seams and collaborators.
     */
    constructor({
        viewManager,
        createDialog,
        subscribe,
        t,
        setTimeout: schedule = (handler, ms) => setTimeout(handler, ms),
        clearTimeout: cancelSchedule = (handle) =>
            clearTimeout(handle as ReturnType<typeof setTimeout>),
        completeLingerMs = COMPLETE_LINGER_MS,
        errorLingerMs = ERROR_LINGER_MS,
        logger = null,
    }: DeploymentProgressControllerOptions) {
        this.#viewManager = viewManager;
        this.#createDialog = createDialog;
        this.#subscribe = subscribe;
        this.#t = t;
        this.#setTimeout = schedule;
        this.#clearTimeout = cancelSchedule;
        this.#completeLingerMs = completeLingerMs;
        this.#errorLingerMs = errorLingerMs;
        this.#logger = logger;
    }

    /** Subscribe to the bus. */
    start(): void {
        if (this.#unsubscribe || this.#stopped) {
            return;
        }
        this.#unsubscribe = this.#subscribe((event) => this.#onEvent(event));
    }

    /**
     * Detach: unsubscribe, disarm the linger and leave the modal layer only if this controller owns
     * it. Calling `stop()` twice is safe; events delivered after it are ignored.
     */
    stop(): void {
        this.#stopped = true;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#cancelLinger();
        this.#closeIfOwner();
        this.#active = null;
    }

    /**
     * Classify an incoming event and route it.
     *
     * `file-send-*` drives the file tier, the seven operation sources drive the dialog lifecycle,
     * and everything else (`device-info-load`, `transpiler`, `workspace`, `views`,
     * `node-packages`, `fs`, `custom-function-*`, the batch upload trackers, `file-receive-*`) is
     * ignored — the removed inline panel ignored them too.
     * @param {ProgressEventLike} event Bus event.
     * @private
     */
    #onEvent(event: ProgressEventLike): void {
        if (this.#stopped || !event || typeof event.source !== 'string') {
            return;
        }
        if (event.source.startsWith('file-send-')) {
            this.#onFileEvent(event);
            return;
        }
        if (!this.#isOperationSource(event.source)) {
            return;
        }
        if (event.type === 'start') {
            this.#onStart(event.source, event);
            return;
        }
        if (!this.#active) {
            return;
        }
        if (this.#active.source !== event.source) {
            return;
        }
        if (event.type === 'update') {
            this.#onUpdate(event);
        } else if (event.type === 'complete') {
            this.#onComplete(event);
        } else if (event.type === 'error') {
            this.#onError(event);
        }
    }

    /**
     * Whether a source is one of the seven device write operations.
     * @param {string} source Tracker name.
     * @returns {boolean} True for a tracked write operation.
     * @private
     */
    #isOperationSource(source: string): source is DeploymentProgressOperationSource {
        return Object.prototype.hasOwnProperty.call(DEPLOYMENT_PROGRESS_OPERATIONS, source);
    }

    /**
     * Open the dialog for an operation that just started.
     *
     * A start from another source while an operation is active is ignored and logged: the scrim
     * blocks a second trigger through the UI, and flipping the title mid-operation would mislabel
     * the dialog.
     * @param {DeploymentProgressOperationSource} source Tracker that started.
     * @param {ProgressEventLike} event Start event.
     * @private
     */
    #onStart(source: DeploymentProgressOperationSource, event: ProgressEventLike): void {
        if (this.#active && !this.#active.settled) {
            this.#log(`deployment-progress-start-ignored: ${source}`);
            return;
        }
        if (this.#active) {
            // The previous operation already settled and is only lingering. Its close timer must
            // not fire later and clear this operation's dialog.
            this.#active = null;
            this.#cancelLinger();
        }

        const message = event.message ?? '';
        const dialog = this.#createDialog(this.#t(DEPLOYMENT_PROGRESS_OPERATIONS[source]));
        dialog.setPhase(message);
        dialog.setOverall(0, message);
        dialog.setFile(0, this.#t('deployment.progressFileIdle'));

        this.#generation += 1;
        this.#active = {
            source,
            dialog,
            generation: this.#generation,
            overall: 0,
            file: 0,
            settled: false,
        };
        this.#viewManager.showModal(dialog, { scrim: true });
    }

    /**
     * Forward an update to the dialog, keeping the last percentage when the event has none.
     * @param {ProgressEventLike} event Update event.
     * @private
     */
    #onUpdate(event: ProgressEventLike): void {
        const active = this.#active;
        if (!active) {
            return;
        }
        const message = event.message ?? '';
        active.overall = finiteOr(event.progress, active.overall);
        active.dialog.setPhase(message);
        active.dialog.setOverall(active.overall, message);
        this.#ensureVisible();
    }

    /**
     * Mark the operation as succeeded and arm the completion linger.
     * @param {ProgressEventLike} event Completion event.
     * @private
     */
    #onComplete(event: ProgressEventLike): void {
        const active = this.#active;
        if (!active) {
            return;
        }
        active.overall = 100;
        active.settled = true;
        active.dialog.markComplete(event.message ?? '');
        this.#ensureVisible();
        this.#scheduleClose(this.#completeLingerMs);
    }

    /**
     * Mark the operation as failed and arm the error linger.
     * @param {ProgressEventLike} event Error event.
     * @private
     */
    #onError(event: ProgressEventLike): void {
        const active = this.#active;
        if (!active) {
            return;
        }
        active.dialog.markError(event.message ?? '');
        active.settled = true;
        this.#ensureVisible();
        this.#scheduleClose(this.#errorLingerMs);
    }

    /**
     * Forward a `file-send-*` event to the file tier.
     *
     * A file `complete` never closes the dialog: the operation that started the transfer is still
     * running. A file event with no percentage keeps the tier where it was, except `complete`, which
     * fills it, and `start`, which resets it.
     * @param {ProgressEventLike} event File event.
     * @private
     */
    #onFileEvent(event: ProgressEventLike): void {
        const active = this.#active;
        if (!active) {
            return;
        }

        let progress = finiteOr(event.progress, active.file);
        if (event.type === 'start') {
            progress = 0;
        } else if (event.type === 'complete') {
            progress = 100;
        }
        active.file = progress;
        active.dialog.setFile(progress, event.message ?? '');
        this.#ensureVisible();
    }

    /**
     * Re-show the dialog when the modal layer is free.
     *
     * Called on every routed event while active. `modalView` holds this dialog → nothing to do;
     * `null` → the dialog was evicted (or cleared) and is shown again, replaying its stored state;
     * anything else → a foreign dialog owns the layer (an error dialog, a form prompt), and the
     * controller leaves it alone. The stored state keeps updating, so the dialog catches up on the
     * next event once the layer is free again.
     * @private
     */
    #ensureVisible(): void {
        const active = this.#active;
        if (!active) {
            return;
        }
        const current = this.#viewManager.modalView;
        if (current === active.dialog) {
            return;
        }
        if (current === null || current === undefined) {
            this.#viewManager.showModal(active.dialog, { scrim: true });
        }
    }

    /**
     * Arm the close timer for the active operation.
     *
     * An already armed timer wins: an update or a second terminal event during the linger does not
     * extend or re-arm the close (today's behaviour). The timer only closes the dialog when the
     * operation it was armed for is still the active one.
     * @param {number} delayMs Linger in milliseconds.
     * @private
     */
    #scheduleClose(delayMs: number): void {
        const active = this.#active;
        if (!active || this.#linger !== null) {
            return;
        }
        const generation = active.generation;
        this.#linger = this.#setTimeout(() => {
            this.#linger = null;
            const current = this.#active;
            if (!current || current.generation !== generation || !current.settled) {
                return;
            }
            const dialog = current.dialog;
            this.#active = null;
            this.#closeIfOwner(dialog);
        }, delayMs);
    }

    /**
     * Cancel the pending linger, if one is armed.
     * @private
     */
    #cancelLinger(): void {
        if (this.#linger === null) {
            return;
        }
        this.#clearTimeout(this.#linger);
        this.#linger = null;
    }

    /**
     * Clear the modal layer only when this controller's dialog still owns it.
     *
     * `ViewManager.clearModal()` is unconditional, so closing by ownership is the only way a late
     * close avoids evicting a foreign dialog that took the slot in the meantime.
     * @param {DeploymentProgressDialogLike} [dialog] Dialog to close; defaults to the active one.
     * @private
     */
    #closeIfOwner(dialog?: DeploymentProgressDialogLike): void {
        const target = dialog ?? this.#active?.dialog;
        if (!target) {
            return;
        }
        if (this.#viewManager.modalView !== target) {
            return;
        }
        this.#viewManager.clearModal();
    }

    /**
     * Log a diagnostic message through the injected logger, if any.
     * @param {string} message Message to log.
     * @private
     */
    #log(message: string): void {
        this.#logger?.(message);
    }
}

/**
 * Coerce a reported percentage, keeping the previous value when it is not a finite number.
 * @param {number|undefined} value Reported percentage.
 * @param {number} previous Last known percentage.
 * @returns {number} The reported value, or `previous`.
 */
function finiteOr(value: number | undefined, previous: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return previous;
    }
    return value;
}

/**
 * Start the controller for the lifetime of the page.
 *
 * The caller keeps the returned function only to stop the controller in a test harness or a future
 * hot reload; the app starts it once from `App.initialize()` and never stops it.
 * @param options Controller seams and collaborators.
 * @returns Stop function that unsubscribes, disarms the linger and releases the modal layer.
 */
export function startDeploymentProgressController(
    options: DeploymentProgressControllerOptions
): () => void {
    const controller = new DeploymentProgressController(options);
    controller.start();
    return () => controller.stop();
}
