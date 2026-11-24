// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Standard two-tier determinate progress display: overall progress plus a detail tier.
 * @module views/progress-detail-view
 *
 * The component answers one question — "how far along is the operation, and what is it doing right
 * now?" — with two labelled determinate bars, a message line under each bar and a divider between
 * the tiers. Every string (labels and messages) comes from the owner, already translated, so the
 * component carries no locale keys and no feature vocabulary.
 *
 * It is pure content: no surface, padding, radius, positioning or self-attachment. A host such as
 * `DeploymentProgressDialogView` supplies the chrome and calls `attachTo()`. The root is
 * `width: 100%; box-sizing: border-box`, so it fills a padded host without spilling past it.
 *
 * Why not `ProgressBarView`: that view is deliberately text-only, because a percentage bar cannot
 * be honest for an indeterminate protocol. This component is for sources that report a real
 * `0…100 %`.
 */

import { ViewBase } from './view-base.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;
type ProgressDetailBaseOptions = Omit<ViewBaseOptions, 'title' | 'i18nService' | 'logger'>;

/**
 * Progress of one tier.
 *
 * `progress` is clamped to `0…100` by the setters; `message` is the human-readable line below the
 * bar and the bar's `aria-valuetext`.
 */
export interface ProgressDetailTierState {
    /** Percentage in `0…100`. */
    progress: number;
    /** Message line below the bar; may be empty. */
    message: string;
}

/**
 * Options accepted by {@link ProgressDetailView}.
 *
 * Labels and messages are supplied by the owner (already translated), because the component has no
 * feature vocabulary of its own.
 */
export interface ProgressDetailViewOptions extends ProgressDetailBaseOptions {
    /** Label above the overall bar, e.g. `Overall progress`. */
    overallLabel?: string;
    /** Label above the detail bar, e.g. `Current file`. */
    detailLabel?: string;
    /** Initial message line of the overall tier. */
    overallMessage?: string;
    /** Initial message line of the detail tier. */
    detailMessage?: string;
    /** View title, used only by serialization; nothing renders it. */
    title?: string;
    /** i18n service forwarded to `ViewBase`; the component looks up no keys itself. */
    i18nService?: ViewBaseOptions['i18nService'];
    /** Logger function forwarded to `ViewBase`. */
    logger?: ViewBaseOptions['logger'];
}

/**
 * Serialized form of {@link ProgressDetailView}.
 *
 * Mirrors `ViewBase.serialize()` and adds both labels and tier snapshots, so a saved layout
 * restores the last painted values instead of an empty progress block.
 */
export interface ProgressDetailViewSerialized {
    type: string;
    id: string;
    title: string;
    icon: string | null;
    overallLabel: string;
    detailLabel: string;
    overall: ProgressDetailTierState;
    detail: ProgressDetailTierState;
    [key: string]: unknown;
}

/** Context accepted by `deserialize()`. */
interface ProgressDetailViewDeserializeContext {
    i18nService?: ViewBaseOptions['i18nService'];
    logger?: ViewBaseOptions['logger'];
}

/**
 * Live elements of the rendered component; `null` while detached.
 *
 * The setters only store state when this is `null`; `render()` repaints the stored state on the
 * next attach, which is what lets an evicted host recover without recreating the component.
 */
interface ProgressDetailViewElements {
    root: HTMLElement;
    overallLabel: HTMLElement;
    overallBar: HTMLElement;
    overallText: HTMLElement;
    detailLabel: HTMLElement;
    detailBar: HTMLElement;
    detailText: HTMLElement;
}

/**
 * ProgressDetailView — two determinate progress tiers with labels and message lines.
 *
 * Architecture integration:
 * - Extends `ViewBase`, so any view or container can host it; it never attaches itself anywhere and
 *   never reaches for an operation tracker.
 * - Pure content: no background, border, radius, padding, positioning or `z-index`. The host owns
 *   the surface, so the same component sits on a modal, in a panel or inside a `StackView` without
 *   inheriting one host's chrome.
 * - Repaints from stored state on every `render()`, so a re-attached host shows the live snapshot
 *   instead of an empty shell.
 *
 * Usage:
 * ```ts
 * const progress = new ProgressDetailView({
 *     overallLabel: this.t('feature.overall'),
 *     detailLabel: this.t('feature.detail'),
 * });
 * progress.attachTo(host);
 * progress.setOverall(42, this.t('feature.writing', { index: 3, total: 7 }));
 * progress.setDetail(17, fileName);
 * ```
 */
export class ProgressDetailView extends ViewBase {
    /** Label above the overall bar. */
    #overallLabel: string;

    /** Label above the detail bar. */
    #detailLabel: string;

    /** Overall tier state. */
    #overall: ProgressDetailTierState;

    /** Detail tier state. */
    #detail: ProgressDetailTierState;

    /** Live elements of the rendered component; `null` while detached. */
    #elements: ProgressDetailViewElements | null = null;

    /**
     * Create the component.
     * @param {object} [options] Component options.
     * @param {string} [options.overallLabel] Label above the overall bar.
     * @param {string} [options.detailLabel] Label above the detail bar.
     * @param {string} [options.overallMessage] Initial overall message line.
     * @param {string} [options.detailMessage] Initial detail message line.
     * @param {string} [options.title] View title used by serialization.
     * @param {object|null} [options.i18nService] Optional i18n service.
     * @param {Function|null} [options.logger] Optional logger function.
     */
    constructor({
        overallLabel = '',
        detailLabel = '',
        overallMessage = '',
        detailMessage = '',
        title = 'Progress Detail',
        i18nService = null,
        logger = null,
        ...rest
    }: ProgressDetailViewOptions = {}) {
        super({
            title,
            i18nService,
            logger,
            ...(rest as ProgressDetailBaseOptions),
        });

        this.#overallLabel = overallLabel;
        this.#detailLabel = detailLabel;
        this.#overall = { progress: 0, message: normalizeMessage(overallMessage) };
        this.#detail = { progress: 0, message: normalizeMessage(detailMessage) };
    }

    /**
     * Snapshot of the overall tier.
     * @returns {ProgressDetailTierState} A copy; mutating it does not affect the view.
     */
    get overall(): ProgressDetailTierState {
        return { ...this.#overall };
    }

    /**
     * Snapshot of the detail tier.
     * @returns {ProgressDetailTierState} A copy; mutating it does not affect the view.
     */
    get detail(): ProgressDetailTierState {
        return { ...this.#detail };
    }

    /**
     * Set the overall tier.
     * @param {number} progress Percentage; clamped to `0…100`, non-finite values keep the previous.
     * @param {string} message Message line of the tier.
     */
    setOverall(progress: number, message: string): void {
        this.#overall = {
            progress: clampProgress(progress, this.#overall.progress),
            message: normalizeMessage(message),
        };
        this.#sync();
    }

    /**
     * Set the detail tier.
     *
     * Independent of `setOverall()`: the overall bar keeps its value while one detail step runs.
     * @param {number} progress Percentage; clamped to `0…100`, non-finite values keep the previous.
     * @param {string} message Message line of the tier.
     */
    setDetail(progress: number, message: string): void {
        this.#detail = {
            progress: clampProgress(progress, this.#detail.progress),
            message: normalizeMessage(message),
        };
        this.#sync();
    }

    /**
     * Replace both message lines without touching the bar widths.
     *
     * This is the terminal-error shape: the failure happened at the current widths, and resetting
     * them would read as "nothing happened".
     * @param {string} overallMessage New overall message line.
     * @param {string} detailMessage New detail message line.
     */
    setMessages(overallMessage: string, detailMessage: string): void {
        this.#overall = { ...this.#overall, message: normalizeMessage(overallMessage) };
        this.#detail = { ...this.#detail, message: normalizeMessage(detailMessage) };
        this.#sync();
    }

    /**
     * Replace the overall label.
     * @param {string} label Already translated label text.
     */
    setOverallLabel(label: string): void {
        this.#overallLabel = label;
        this.#sync();
    }

    /**
     * Replace the detail label.
     * @param {string} label Already translated label text.
     */
    setDetailLabel(label: string): void {
        this.#detailLabel = label;
        this.#sync();
    }

    /**
     * Build the component DOM into the host.
     *
     * Called by `ViewBase.attachTo()`; the host supplies the container. The second and every later
     * call repaints the state the view already holds.
     * @param {HTMLElement} _container Host element (unused; `mountContent` owns the mount).
     */
    override render(_container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = 'progress-detail-view';

        const overall = this.#buildTier();
        root.appendChild(overall.tier);

        const divider = document.createElement('div');
        divider.className = 'progress-detail-view__divider';
        divider.setAttribute('role', 'presentation');
        root.appendChild(divider);

        const detail = this.#buildTier();
        root.appendChild(detail.tier);

        this.#elements = {
            root,
            overallLabel: overall.label,
            overallBar: overall.bar,
            overallText: overall.text,
            detailLabel: detail.label,
            detailBar: detail.bar,
            detailText: detail.text,
        };
        this.#sync();
        this.mountContent(root);
        this._log('render', {
            overall: this.#overall.progress,
            detail: this.#detail.progress,
        });
    }

    /**
     * Drop the element references before detachment so a setter cannot write into detached DOM.
     */
    override beforeDetach(): void {
        this.#elements = null;
        super.beforeDetach();
    }

    /**
     * Build one empty tier: label, bar and message line.
     * @returns Tier parts; `#sync` fills the text and ARIA labels.
     * @private
     */
    #buildTier(): {
        tier: HTMLElement;
        label: HTMLElement;
        bar: HTMLElement;
        text: HTMLElement;
    } {
        const tier = document.createElement('div');
        tier.className = 'progress-detail-view__tier';

        const label = document.createElement('span');
        label.className = 'progress-detail-view__label';
        tier.appendChild(label);

        const barWrapper = document.createElement('div');
        barWrapper.className = 'progress-detail-view__bar-wrapper';
        const bar = document.createElement('div');
        bar.className = 'progress-detail-view__bar';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', '0');
        barWrapper.appendChild(bar);
        tier.appendChild(barWrapper);

        const text = document.createElement('span');
        text.className = 'progress-detail-view__text';
        tier.appendChild(text);

        return { tier, label, bar, text };
    }

    /**
     * Repaint the rendered elements from the stored state.
     *
     * A no-op while detached: the setters still store, and `render()` calls this again on the next
     * attach, which is how a re-shown component recovers its state.
     * @private
     */
    #sync(): void {
        const elements = this.#elements;
        if (!elements) {
            return;
        }

        elements.overallLabel.textContent = this.#overallLabel;
        elements.detailLabel.textContent = this.#detailLabel;
        elements.overallBar.setAttribute('aria-label', this.#overallLabel);
        elements.detailBar.setAttribute('aria-label', this.#detailLabel);

        paintTier(elements.overallBar, elements.overallText, this.#overall);
        paintTier(elements.detailBar, elements.detailText, this.#detail);
    }

    /**
     * Serialize the component state.
     * @returns Base view state plus both labels and tier snapshots.
     */
    override serialize(): ProgressDetailViewSerialized {
        return {
            ...super.serialize(),
            type: 'ProgressDetailView',
            overallLabel: this.#overallLabel,
            detailLabel: this.#detailLabel,
            overall: { ...this.#overall },
            detail: { ...this.#detail },
        };
    }

    /**
     * Rebuild the component from serialized data.
     * @param data Serialized view data.
     * @param viewFactory Child factory; unused (the component owns its markup).
     * @param context Factory context carrying the i18n service and logger.
     * @returns A new component carrying the serialized labels and tier state.
     */
    static override deserialize(
        data: Partial<ProgressDetailViewSerialized> = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: ProgressDetailViewDeserializeContext = {}
    ): ProgressDetailView {
        void viewFactory;
        const view = new ProgressDetailView({
            title: data.title ?? 'Progress Detail',
            icon: data.icon ?? null,
            id: data.id ?? null,
            overallLabel: data.overallLabel ?? '',
            detailLabel: data.detailLabel ?? '',
            i18nService: context.i18nService ?? null,
            logger: context.logger ?? null,
        });
        if (data.overall) {
            view.setOverall(data.overall.progress, data.overall.message);
        }
        if (data.detail) {
            view.setDetail(data.detail.progress, data.detail.message);
        }
        return view;
    }
}

/**
 * Clamp a progress value to `0…100`, keeping the previous value for non-finite input.
 * @param {number} value Reported percentage.
 * @param {number} previous Value to keep when `value` is not a finite number.
 * @returns {number} A value in `0…100`.
 */
function clampProgress(value: number, previous: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return previous;
    }
    return Math.min(100, Math.max(0, value));
}

/**
 * Normalize a progress message to a string.
 * @param {unknown} message Reported message.
 * @returns {string} The message, or `''` when it is missing.
 */
function normalizeMessage(message: unknown): string {
    if (typeof message === 'string') {
        return message;
    }
    return message == null ? '' : String(message);
}

/**
 * Paint one tier's bar and message line.
 * @param {HTMLElement} bar Bar element carrying the ARIA value attributes.
 * @param {HTMLElement} text Message line below the bar.
 * @param {ProgressDetailTierState} state Tier state to paint.
 */
function paintTier(bar: HTMLElement, text: HTMLElement, state: ProgressDetailTierState): void {
    bar.style.width = `${state.progress}%`;
    bar.setAttribute('aria-valuenow', String(state.progress));
    bar.setAttribute('aria-valuetext', state.message);
    text.textContent = state.message;
}
