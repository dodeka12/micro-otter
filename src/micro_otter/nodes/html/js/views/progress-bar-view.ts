// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import { ButtonControl } from './controls/custom-runtime-controls.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;
type ProgressBarBaseOptions = Omit<ViewBaseOptions, 'title' | 'i18nService' | 'logger'>;

/**
 * Options accepted by {@link ProgressBarView}.
 *
 * Every user-facing string is supplied by the owner (already translated), so the
 * view itself carries no locale keys.
 */
export interface ProgressBarViewOptions extends ProgressBarBaseOptions {
    /** Initial label, e.g. `Building firmware…`. */
    label?: string;
    /** Initial status line: a stage id or a free-form progress message. */
    status?: string | null;
    /** Whether a Cancel button is offered. */
    cancelable?: boolean;
    /** Cancel button label. */
    cancelLabel?: string;
    /** Formats the elapsed line from the elapsed whole seconds. */
    elapsedFormatter?: ((seconds: number) => string) | null;
    title?: string;
    i18nService?: unknown;
    logger?: unknown;
}

/** Default elapsed formatter, used when the owner supplies none. */
const defaultElapsedFormatter = (seconds: number): string => `${seconds}s`;

/**
 * ProgressBarView — a labelled progress *readout* for ONE long-running operation.
 *
 * Architecture integration:
 * - Extends `ViewBase`, so any view or container can host it; it never attaches
 *   itself anywhere and never reaches for the job client.
 * - Renders **text only**: the label, the stage/message line, the elapsed timer
 *   and an optional Cancel button, inside a `role="status"` live region. It
 *   deliberately draws no bar. The `WS /firmware` protocol carries no
 *   percentage, and a native `<progress>` is not a portable feedback surface:
 *   once it is styled, Chromium and WebKit paint nothing for the indeterminate
 *   state, while Gecko paints a full bar that reads as "100 %". A bar would
 *   therefore be invisible or lying — the ticking elapsed line is the cue.
 * - Every visible string (label, status, cancel label, elapsed line) comes from
 *   the owner, which keeps the view free of feature-specific locale keys.
 *
 * Usage:
 * ```ts
 * const readout = new ProgressBarView({
 *     elapsedFormatter: (seconds) => this.t('feature.elapsed', { seconds }),
 * });
 * readout.onCancel(() => this.requestCancel());
 * readout.attachTo(host);
 * readout.show('Building firmware…');
 * readout.setStatus('precompile');
 * ```
 */
export class ProgressBarView extends ViewBase {
    /** Root element; its `hidden` attribute drives the whole readout. */
    #root: HTMLElement | null = null;
    #labelEl: HTMLElement | null = null;
    #statusEl: HTMLElement | null = null;
    #elapsedEl: HTMLElement | null = null;
    /** Host of the optional Cancel button. */
    #cancelHost: HTMLElement | null = null;
    #cancelButton: ButtonControl | null = null;
    #onCancel: (() => void) | null = null;
    /** Interval handle for the elapsed line; only runs while the readout is visible. */
    #timer: ReturnType<typeof setInterval> | null = null;
    /** `Date.now()` of the last `show()`, used to derive the elapsed seconds. */
    #startedAt = 0;
    #formatter: (seconds: number) => string;
    #label: string;
    #status: string | null;
    #cancelable: boolean;
    #cancelLabel: string;
    #cancelEnabled = true;
    #visible = false;

    constructor({
        label = '',
        status = null,
        cancelable = false,
        cancelLabel = 'Cancel',
        elapsedFormatter = null,
        title = 'Progress',
        i18nService = null,
        logger = null,
        ...rest
    }: ProgressBarViewOptions = {}) {
        super({
            title,
            i18nService: i18nService as ViewBaseOptions['i18nService'],
            logger: logger as ViewBaseOptions['logger'],
            ...(rest as ProgressBarBaseOptions),
        });

        this.#label = label;
        this.#status = status;
        this.#cancelable = Boolean(cancelable);
        this.#cancelLabel = cancelLabel;
        this.#formatter = elapsedFormatter ?? defaultElapsedFormatter;
    }

    /** Build the readout DOM; called by `ViewBase.attachTo`. */
    render(_container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = 'progress-bar-view';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');

        const head = document.createElement('div');
        head.className = 'progress-bar-view__head';
        root.appendChild(head);

        this.#labelEl = document.createElement('span');
        this.#labelEl.className = 'progress-bar-view__label';
        head.appendChild(this.#labelEl);

        this.#statusEl = document.createElement('span');
        this.#statusEl.className = 'progress-bar-view__status';
        head.appendChild(this.#statusEl);

        this.#elapsedEl = document.createElement('span');
        this.#elapsedEl.className = 'progress-bar-view__elapsed';
        head.appendChild(this.#elapsedEl);

        this.#cancelHost = document.createElement('span');
        this.#cancelHost.className = 'progress-bar-view__cancel';
        head.appendChild(this.#cancelHost);

        this.#cancelButton = new ButtonControl({ label: this.#cancelLabel, style: 'secondary' });
        this.#cancelButton.onClick(() => this.#onCancel?.());
        this.#cancelButton.render(this.#cancelHost);

        this.#root = root;
        this.#sync();
        this.mountContent(root);
        this._log('render', { status: this.#status, cancelable: this.#cancelable });
    }

    /** Return whether the readout is currently shown. */
    isVisible(): boolean {
        return this.#visible;
    }

    /**
     * Show the readout and restart the elapsed timer.
     *
     * @param label Optional new label; the current label is kept when omitted.
     */
    show(label?: string): void {
        if (label !== undefined) {
            this.#label = label;
        }
        this.#visible = true;
        this.#startedAt = Date.now();
        this.#startTimer();
        this.#sync();
    }

    /** Hide the readout and stop the elapsed timer. */
    hide(): void {
        this.#visible = false;
        this.#clearTimer();
        this.#sync();
    }

    /** Replace the label line. */
    setLabel(label: string): void {
        this.#label = label;
        this.#sync();
    }

    /** Replace the status line; `null` removes it. */
    setStatus(status: string | null): void {
        this.#status = status ?? null;
        this.#sync();
    }

    /** Show or hide the Cancel button. */
    setCancelable(cancelable: boolean): void {
        this.#cancelable = Boolean(cancelable);
        this.#sync();
    }

    /** Replace the Cancel button label. */
    setCancelLabel(label: string): void {
        this.#cancelLabel = label;
        this.#cancelButton?.setLabel(label);
    }

    /** Enable or disable the Cancel button (e.g. after a cancel request). */
    setCancelEnabled(enabled: boolean): void {
        this.#cancelEnabled = Boolean(enabled);
        this.#cancelButton?.setDisabled(!this.#cancelEnabled);
    }

    /** Register the Cancel callback. */
    onCancel(callback: () => void): void {
        this.#onCancel = callback;
    }

    /** Stop the elapsed timer and drop element references when detached. */
    override beforeDetach(): void {
        this.#clearTimer();
        this.#root = null;
        this.#labelEl = null;
        this.#statusEl = null;
        this.#elapsedEl = null;
        this.#cancelHost = null;
        this.#cancelButton = null;
        super.beforeDetach();
    }

    /** Reconcile every element with the current state. */
    #sync(): void {
        if (this.#root) {
            this.#root.hidden = !this.#visible;
        }
        if (this.#labelEl) {
            this.#labelEl.textContent = this.#label;
        }
        if (this.#statusEl) {
            this.#statusEl.textContent = this.#status ?? '';
            this.#statusEl.hidden = !this.#status;
        }
        if (this.#cancelHost) {
            this.#cancelHost.hidden = !this.#cancelable;
        }
        this.#cancelButton?.setLabel(this.#cancelLabel);
        this.#cancelButton?.setDisabled(!this.#cancelEnabled);
        this.#tickElapsed();
    }

    /** Update the elapsed line from `#startedAt`; empty while hidden. */
    #tickElapsed(): void {
        if (!this.#elapsedEl) {
            return;
        }
        if (!this.#visible) {
            this.#elapsedEl.textContent = '';
            this.#elapsedEl.hidden = true;
            return;
        }
        const seconds = Math.max(0, Math.round((Date.now() - this.#startedAt) / 1000));
        this.#elapsedEl.textContent = this.#formatter(seconds);
        this.#elapsedEl.hidden = false;
    }

    /** Start (or restart) the 1 s elapsed timer. */
    #startTimer(): void {
        this.#clearTimer();
        const timer = setInterval(() => this.#tickElapsed(), 1000);
        // Node timers keep the process alive; the elapsed tick must never delay exit.
        (timer as unknown as { unref?: () => void }).unref?.();
        this.#timer = timer;
    }

    /** Stop the elapsed timer, if it runs. */
    #clearTimer(): void {
        if (this.#timer !== null) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
    }
}
