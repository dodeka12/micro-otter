// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file The one deployment progress dialog: a phase line over a two-tier progress detail.
 * @module views/deployment-progress-dialog-view
 *
 * One surface for every device **write** operation — collection deploy, sync and remove, and
 * runtime install / upgrade / remove / refresh. `js/app/deployment-progress-controller.ts` owns the
 * dialog's lifecycle: it creates the view, feeds the setters from `ProgressEventBus` events, shows
 * it through `ViewManager.showModal()` and closes it when the operation settled. The view itself
 * never touches `ViewManager`, so it is fully unit-testable with `attachTo()` alone.
 *
 * The body is a composition: this dialog owns the phase line and the modal surface, and hosts the
 * generic `ProgressDetailView` for the two determinate tiers. That component is pure content, so
 * this dialog's stylesheet adds no second surface, padding or radius around it.
 *
 * Why the generic component instead of `ProgressBarView`: `ProgressBarView` is deliberately
 * text-only (a percentage bar would be invisible or lying for the indeterminate `WS /firmware`
 * protocol). These device writes *do* report 0–100 %, so a determinate bar is honest here.
 *
 * Why no dismiss button, no Escape and no Cancel: neither `CollectionDeployment` nor
 * `RuntimeDeployment` exposes cancellation, and a cancelled write has no defined device state. The
 * dialog reports a running operation and is closed programmatically after the controller's linger.
 */

import { ModalDialogView } from './modal-dialog-view.js';
import { IconProvider } from './icon-provider.js';
import { ProgressDetailView } from './progress-detail-view.js';
import type { ProgressDetailTierState } from './progress-detail-view.js';

/** Options type of the inherited modal, used to borrow its logger/i18n shapes. */
type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];

/** Logger shape the inherited modal accepts. */
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;

/** i18n shape the inherited modal accepts. */
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

/**
 * Visual state of the phase line.
 *
 * `running` clears a previous error highlight; `complete` and `error` are set by the terminal
 * setters and only cleared by the next `setPhase()`.
 */
export type DeploymentProgressPhaseState = 'running' | 'complete' | 'error';

/**
 * The elements `_buildBody()` creates, kept so the phase line can repaint without re-querying.
 *
 * `null` while the view is detached: `render()` calls `#sync()` after rebuilding the body, which
 * is what lets an evicted dialog recover its phase state on re-attach.
 */
interface DeploymentProgressDialogElements {
    root: HTMLElement;
    phase: HTMLElement;
    detailHost: HTMLElement;
}

/** Data accepted by `deserialize()`. */
interface DeploymentProgressDialogDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
    phase?: string;
    phaseState?: DeploymentProgressPhaseState;
    overall?: ProgressDetailTierState;
    file?: ProgressDetailTierState;
}

/** Context accepted by `deserialize()`. */
interface DeploymentProgressDialogDeserializeContext {
    i18nService?: I18nServiceLike;
    logger?: LoggerLike;
}

/** Options accepted by the dialog constructor. */
export interface DeploymentProgressDialogViewOptions {
    /** Already translated dialog title; the controller passes the operation's label. */
    title?: string;
    /** Header icon; defaults to `IconProvider.deployCollection`. */
    icon?: string | null;
    /** Explicit view id. */
    id?: string | null;
    /** Optional logger function, forwarded to `ModalDialogView`. */
    logger?: LoggerLike;
    /** i18n service; without it the tier labels fall back to their raw keys. */
    i18nService?: I18nServiceLike;
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
 * Modal dialog that reports the progress of one device write operation.
 *
 * The controller is the only caller that mutates it (`setPhase`, `setOverall`, `setFile`,
 * `markComplete`, `markError`); everything else is inherited from `ModalDialogView`.
 */
export class DeploymentProgressDialogView extends ModalDialogView {
    /** Current phase line, e.g. `Syncing collection: Demo`. */
    #phase = '';

    /** State of the phase line; drives the `is-error` / `is-complete` classes. */
    #phaseState: DeploymentProgressPhaseState = 'running';

    /** Generic content component that renders both determinate tiers. */
    #detailView: ProgressDetailView;

    /** Live elements of the rendered body; `null` while detached. */
    #elements: DeploymentProgressDialogElements | null = null;

    /**
     * Create the dialog.
     * @param {object} [options] Dialog options.
     * @param {string} [options.title] Already translated title.
     * @param {string|null} [options.icon] Header icon; defaults to the deploy icon.
     * @param {string|null} [options.id] Explicit view id.
     * @param {Function|null} [options.logger] Optional logger function.
     * @param {object|null} [options.i18nService] i18n service for the tier labels.
     */
    constructor({
        title,
        icon = null,
        id = null,
        logger = null,
        i18nService = null,
    }: DeploymentProgressDialogViewOptions = {}) {
        super({
            title: title ?? '',
            icon: icon ?? IconProvider.deployCollection,
            id,
            showDismiss: false,
            disableEscape: true,
            autofocus: false,
            logger,
            i18nService,
        });
        this.#detailView = new ProgressDetailView({
            overallLabel: this.t('deployment.progressOverall'),
            detailLabel: this.t('deployment.progressCurrentFile'),
            detailMessage: this.t('deployment.progressFileIdle'),
        });
    }

    /**
     * Set the phase line and clear a previous terminal highlight.
     * @param {string} message Phase message, already translated by the bus producer.
     */
    setPhase(message: string): void {
        this.#phase = normalizeMessage(message);
        this.#phaseState = 'running';
        this.#sync();
    }

    /**
     * Set the overall tier.
     * @param {number} progress Percentage; clamped to `0…100`, non-finite values are ignored.
     * @param {string} message Message line of the tier.
     */
    setOverall(progress: number, message: string): void {
        this.#detailView.setOverall(progress, message);
    }

    /**
     * Set the file tier.
     *
     * Independent of `setOverall()`: the overall bar keeps its value while a single file uploads.
     * @param {number} progress Percentage; clamped to `0…100`, non-finite values are ignored.
     * @param {string} message Message line of the tier.
     */
    setFile(progress: number, message: string): void {
        this.#detailView.setDetail(progress, message);
    }

    /**
     * Mark the operation as succeeded: phase and both tiers carry the message, both bars are full.
     * @param {string} message Final message, already translated.
     */
    markComplete(message: string): void {
        const text = normalizeMessage(message);
        this.#phase = text;
        this.#phaseState = 'complete';
        this.#detailView.setOverall(100, text);
        this.#detailView.setDetail(100, text);
        this.#sync();
    }

    /**
     * Mark the operation as failed.
     *
     * The bar widths stay where the operation failed: the failure happened at that point, and a
     * reset-to-zero bar would read as "nothing was written".
     * @param {string} message Failure message, already translated.
     */
    markError(message: string): void {
        const text = normalizeMessage(message);
        this.#phase = text;
        this.#phaseState = 'error';
        this.#detailView.setMessages(text, text);
        this.#sync();
    }

    /**
     * Render the dialog and repaint the state the view already holds.
     *
     * The controller re-shows an evicted dialog instance instead of creating a new one, so a
     * re-attached view must show the live operation state rather than an empty shell.
     * @param {HTMLElement} container Host element.
     */
    override render(container: HTMLElement): void {
        super.render(container);
        if (this.#elements) {
            this.#detailView.attachTo(this.#elements.detailHost);
        }
        this.#sync();
    }

    /**
     * Detach the hosted detail component and drop the element references.
     *
     * Dropping the references first means a setter that fires between detach and re-attach cannot
     * write into detached DOM; the child keeps its own state and repaints it on the next attach.
     */
    override beforeDetach(): void {
        this.#elements = null;
        this.#detailView.detach();
        super.beforeDetach();
    }

    /**
     * Build the dialog body: the phase line and the host for the detail component.
     *
     * The labels and the idle file line are owned by the hosted `ProgressDetailView`; this method
     * only lays out the phase line and the slot. `render()` attaches the child after the modal
     * structure exists, and the child repaints its own state.
     * @returns {HTMLElement} Body root.
     * @protected
     */
    protected override _buildBody(): HTMLElement {
        const root = document.createElement('div');
        root.className = 'deployment-progress-dialog';

        const phase = document.createElement('div');
        phase.className = 'deployment-progress-dialog__phase';
        phase.setAttribute('role', 'status');
        phase.setAttribute('aria-live', 'polite');
        root.appendChild(phase);

        const detailHost = document.createElement('div');
        detailHost.className = 'deployment-progress-dialog__detail';
        root.appendChild(detailHost);

        this.#elements = { root, phase, detailHost };

        return root;
    }

    /**
     * Build the (empty, hidden) footer.
     *
     * The dialog has no action: the user cannot confirm, cancel or dismiss a running write. The
     * footer exists only because `ModalDialogView` expects one; its class is the dialog's own,
     * because `.modal-dialog__footer` sets `display: flex`, which would outrank `[hidden]`.
     * @returns {HTMLElement} Hidden footer element.
     * @protected
     */
    protected override _buildFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'deployment-progress-dialog__footer';
        footer.hidden = true;
        return footer;
    }

    /**
     * Repaint the rendered elements from the stored state.
     *
     * A no-op while detached: the setters still store, and `render()` calls this again on the next
     * attach, which is how a re-shown dialog recovers its state.
     * @private
     */
    #sync(): void {
        const elements = this.#elements;
        if (!elements) {
            return;
        }

        elements.root.classList.toggle('is-complete', this.#phaseState === 'complete');
        elements.root.classList.toggle('is-error', this.#phaseState === 'error');

        elements.phase.textContent = this.#phase;
        elements.phase.classList.toggle('is-error', this.#phaseState === 'error');
    }

    /**
     * Serialize the dialog state.
     * @returns {object} Base dialog state plus the four progress state values.
     */
    override serialize(): any {
        return {
            ...super.serialize(),
            phase: this.#phase,
            phaseState: this.#phaseState,
            overall: this.#detailView.overall,
            file: this.#detailView.detail,
        };
    }

    /**
     * Rebuild the dialog from serialized data.
     * @param data Serialized view data.
     * @param viewFactory Child factory; unused (the dialog owns its markup).
     * @param context Factory context carrying the i18n service and logger.
     * @returns A new dialog carrying the serialized progress state.
     */
    static deserialize(
        data: DeploymentProgressDialogDeserializeData = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: DeploymentProgressDialogDeserializeContext = {}
    ): DeploymentProgressDialogView {
        void viewFactory;
        const view = new DeploymentProgressDialogView({
            title: data.title ?? '',
            icon: data.icon ?? null,
            id: data.id ?? null,
            i18nService: context.i18nService ?? null,
            logger: context.logger ?? null,
        });
        view.#phase = normalizeMessage(data.phase);
        view.#phaseState = data.phaseState ?? 'running';
        if (data.overall) {
            view.#detailView.setOverall(data.overall.progress, data.overall.message);
        }
        if (data.file) {
            view.#detailView.setDetail(data.file.progress, data.file.message);
        }
        return view;
    }
}
