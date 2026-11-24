// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file The one progress surface for a device connect: status line and determinate bar.
 * @module views/connecting-progress-dialog-view
 *
 * `DeviceConnectionDialogView.open()` shows this dialog after its configuration dialog closes and
 * before it calls `connect()`, so the moment between the click and the first retry-able error is no
 * longer silent. The view reports the connection snapshot; it never drives the connection except
 * for the single cancel action while the state is `connecting`.
 *
 * The dialog is a **progress surface, not a second connection surface**: it has no provider or port
 * controls, and its only action is the state-dependent footer button (`Cancel connecting` while the
 * port opens, `Close` while device information loads).
 *
 * Close rules (all of them keep the modal layer free for the connection's target-selection form):
 *
 * - `error` and `disconnected` close immediately;
 * - `connected` closes only when a `loading` state was observed, so a bridge re-emitting `connected`
 *   before the device-info tracker starts does not close the dialog early;
 * - `markConnectSettled()` closes the happy path when `connect()` resolved without ever entering
 *   `loading`;
 * - the monitor's pre-onboarding signal closes the dialog before the selection form opens.
 *
 * `close()` is idempotent: every close path emits exactly one `close` event, and it also detaches
 * the snapshot and pre-onboarding subscriptions.
 */

import { ModalDialogView } from './modal-dialog-view.js';
import { IconProvider } from './icon-provider.js';
import { ProgressDetailView } from './progress-detail-view.js';
import type { DeviceConnectionSnapshot } from '../serial/device-connection-monitor.js';

/** Options type of the inherited modal, used to borrow its logger/i18n shapes. */
type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];

/** Logger shape the inherited modal accepts. */
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;

/** i18n shape the inherited modal accepts. */
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

/**
 * Structural contract of the connection the dialog reports.
 *
 * This is the `DeviceConnectionMonitor` surface the view needs; the subscription hooks are
 * optional so a minimal fixture can drive the view through `markConnectSettled()` alone.
 */
export interface ConnectingProgressDialogConnectionLike {
    /** Current monitor snapshot; the dialog paints state, progress and message. */
    getSnapshot(): DeviceConnectionSnapshot;
    /** Subscribe to snapshot changes; the close rules run on every notification. */
    subscribe?(listener: (snapshot: DeviceConnectionSnapshot) => void): () => void;
    /** Subscribe to the synchronous pre-onboarding signal. */
    subscribeOnboardingPrompt?(listener: () => void): () => void;
    /** Cancel an in-flight connect; the dialog asks once when the footer is clicked. */
    cancelConnect(): boolean;
}

/**
 * Options accepted by {@link ConnectingProgressDialogView}.
 */
export interface ConnectingProgressDialogOptions {
    /** Connection snapshot source. */
    connection: ConnectingProgressDialogConnectionLike;
    /** Dialog title; defaults to `deviceConnection.progressTitle`. */
    title?: string;
    /** Explicit view id. */
    id?: string | null;
    /** i18n service forwarded to the modal and the hosted progress detail. */
    i18nService?: I18nServiceLike;
    /** Logger forwarded to the modal and the hosted progress detail. */
    logger?: LoggerLike;
}

/** Data accepted by `deserialize()`. */
interface ConnectingProgressDialogDeserializeData {
    /** Dialog title. */
    title?: string;
    /** Explicit view id. */
    id?: string | null;
}

/** Context accepted by `deserialize()`. */
interface ConnectingProgressDialogDeserializeContext {
    /** Connection service; required, because the dialog cannot build one. */
    deviceConnection?: ConnectingProgressDialogConnectionLike | null;
    /** i18n service. */
    i18nService?: I18nServiceLike;
    /** Logger. */
    logger?: LoggerLike;
}

/**
 * Elements `_buildBody()` creates.
 *
 * `null` while detached: `render()` rebuilds the body and syncs it from the stored snapshot, so an
 * evicted dialog replays the live state instead of an empty shell.
 */
interface ConnectingProgressDialogElements {
    root: HTMLElement;
    status: HTMLElement;
    detailHost: HTMLElement;
}

/**
 * The connection progress dialog: one status line and one determinate bar.
 *
 * It hosts the generic `ProgressDetailView` for the overall tier and owns no bar styles. The
 * stylesheet only lays out the status line and the slot, and hides the unused detail tier.
 */
export class ConnectingProgressDialogView extends ModalDialogView {
    /** Connection snapshot source. */
    readonly connection: ConnectingProgressDialogConnectionLike;

    /** Last snapshot received; also the initial value for a dialog created mid-attempt. */
    #snapshot: DeviceConnectionSnapshot;

    /** Whether a `loading` state was observed; the only way a later `connected` closes. */
    #loadingSeen = false;

    /** Whether this dialog has already emitted `close`. */
    #closed = false;

    /** Unsubscribe from the snapshot subscription. */
    #unsubscribeSnapshot: (() => void) | null = null;

    /** Unsubscribe from the pre-onboarding signal. */
    #unsubscribeOnboarding: (() => void) | null = null;

    /** Hosted determinate progress component. */
    #detailView: ProgressDetailView;

    /** Live body elements; `null` while detached. */
    #elements: ConnectingProgressDialogElements | null = null;

    /** Live footer button whose label follows the state. */
    #footerButton: HTMLButtonElement | null = null;

    /**
     * Create the dialog and subscribe to the connection.
     * @param {object} options Dialog options.
     * @param {object} options.connection Connection snapshot source.
     * @param {string} [options.title] Dialog title; defaults to the locale key.
     * @param {string|null} [options.id] Explicit view id.
     * @param {object|null} [options.i18nService] Optional i18n service.
     * @param {Function|null} [options.logger] Optional logger.
     */
    constructor({
        connection,
        title,
        id = null,
        i18nService = null,
        logger = null,
    }: ConnectingProgressDialogOptions) {
        super({
            title: title ?? '',
            icon: IconProvider.cable,
            confirmLabel: 'Close',
            cancelLabel: 'Cancel',
            showCancel: false,
            showDismiss: true,
            disableEscape: false,
            autofocus: false,
            id,
            i18nService,
            logger,
        });

        this.connection = connection;
        this.title = title ?? this.t('deviceConnection.progressTitle');
        this.#snapshot = connection.getSnapshot();
        // A dialog created while device information already loads must still treat the next
        // `connected` as the post-loading one.
        this.#loadingSeen = this.#snapshot.state === 'loading';
        this.#detailView = new ProgressDetailView({
            overallLabel: this.t('deviceConnection.loadingDeviceInfo'),
            title: this.t('deviceConnection.progressTitle'),
            i18nService,
            logger,
        });

        this.#subscribe();
        this._cleanup.push(() => this.#detachSubscriptions());
    }

    /**
     * Rehydrate the dialog for a `ViewFactory` round trip.
     * @param {object} data Serialized view data.
     * @param {Function|null} viewFactory Child factory; unused.
     * @param {object} context Factory context; requires `deviceConnection`.
     * @returns {ConnectingProgressDialogView} The rehydrated dialog.
     */
    static deserialize(
        data: ConnectingProgressDialogDeserializeData = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: ConnectingProgressDialogDeserializeContext = {}
    ): ConnectingProgressDialogView {
        void viewFactory;
        const connection = context.deviceConnection ?? null;
        if (!connection) {
            throw new Error(
                'ConnectingProgressDialogView.deserialize requires the device connection service (context.deviceConnection).'
            );
        }

        return new ConnectingProgressDialogView({
            connection,
            title: data.title,
            id: data.id ?? null,
            i18nService: context.i18nService ?? null,
            logger: context.logger ?? null,
        });
    }

    /**
     * Close the progress surface when `connect()` resolved without entering `loading`.
     *
     * A resolved connect that did read device information already closed on `loading` →
     * `connected`; this is the fallback for providers that settle straight on `connected`. A
     * snapshot still in `connecting`/`loading` is left to its own transition.
     */
    markConnectSettled(): void {
        if (this.#closed || this.#loadingSeen) {
            return;
        }
        if (this.#snapshot.state === 'connecting' || this.#snapshot.state === 'loading') {
            return;
        }
        this.close();
    }

    /**
     * Treat every dismiss path as one close.
     *
     * While the port is opening this cancels the attempt first; while device information loads
     * there is nothing to cancel, so it just closes the progress surface.
     */
    override cancel(): void {
        if (this.connection.getSnapshot().state === 'connecting') {
            this.connection.cancelConnect();
        }
        this.close();
    }

    /**
     * Close the dialog exactly once and detach both subscriptions.
     * @param {object|null} payload Optional close payload.
     */
    override close(payload: Record<string, unknown> | null = null): void {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        this.#detachSubscriptions();
        super.close(payload);
    }

    /**
     * Render the modal structure, attach the hosted progress component and replay the snapshot.
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
     * Detach the hosted progress component and drop the element references.
     */
    override beforeDetach(): void {
        this.#elements = null;
        this.#footerButton = null;
        this.#detailView.detach();
        super.beforeDetach();
    }

    /**
     * Compose the body: a live status line and the slot for the progress detail.
     * @returns {HTMLElement} Body root.
     * @protected
     */
    protected override _buildBody(): HTMLElement {
        const root = document.createElement('div');
        root.className = 'modal-dialog__body connecting-progress-dialog';

        const status = document.createElement('div');
        status.className = 'connecting-progress-dialog__status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        root.appendChild(status);

        const detailHost = document.createElement('div');
        detailHost.className = 'connecting-progress-dialog__detail';
        detailHost.hidden = true;
        root.appendChild(detailHost);

        this.#elements = { root, status, detailHost };

        return root;
    }

    /**
     * Build the one-button footer.
     *
     * The label and the variant follow the state in `#sync()`: `Cancel connecting` is the primary
     * action while the port opens, `Close` is a quiet dismiss while device information loads.
     * @returns {HTMLElement} Footer element.
     * @protected
     */
    protected override _buildFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'modal-dialog__footer';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'modal-dialog__btn modal-dialog__btn--primary';
        button.addEventListener('click', () => this.cancel());
        footer.appendChild(button);

        this.#footerButton = button;

        return footer;
    }

    /**
     * Register the snapshot and pre-onboarding subscriptions.
     *
     * The initial snapshot is read before subscribing, so a dialog created mid-attempt paints the
     * current percentage and already knows whether `loading` happened.
     * @private
     */
    #subscribe(): void {
        const subscribe = this.connection.subscribe?.bind(this.connection);
        if (subscribe) {
            this.#unsubscribeSnapshot = subscribe((snapshot) => this.#onSnapshot(snapshot));
        }

        const subscribeOnboarding = this.connection.subscribeOnboardingPrompt?.bind(this.connection);
        if (subscribeOnboarding) {
            this.#unsubscribeOnboarding = subscribeOnboarding(() => this.close());
        }
    }

    /**
     * Detach the snapshot and pre-onboarding subscriptions; safe to call repeatedly.
     * @private
     */
    #detachSubscriptions(): void {
        this.#unsubscribeSnapshot?.();
        this.#unsubscribeSnapshot = null;
        this.#unsubscribeOnboarding?.();
        this.#unsubscribeOnboarding = null;
    }

    /**
     * Snapshot handler implementing the close rules.
     *
     * `connected` without a preceding `loading` keeps the dialog open: the bridge provider may
     * re-emit `connected` before the device-info tracker starts.
     * @param snapshot New monitor snapshot.
     * @private
     */
    #onSnapshot(snapshot: DeviceConnectionSnapshot): void {
        this.#snapshot = snapshot;
        if (snapshot.state === 'loading') {
            this.#loadingSeen = true;
        }

        if (snapshot.state === 'error' || snapshot.state === 'disconnected') {
            this.close();
            return;
        }
        if (snapshot.state === 'connected' && this.#loadingSeen) {
            this.close();
            return;
        }

        this.#sync();
    }

    /**
     * Repaint the status line, the progress slot and the footer from the stored snapshot.
     * @private
     */
    #sync(): void {
        const snapshot = this.#snapshot;
        const progress = snapshot.progress;
        const hasProgress = typeof progress === 'number' && Number.isFinite(progress);

        if (this.#elements) {
            this.#elements.status.textContent = this.#statusText();
            this.#elements.detailHost.hidden = !hasProgress;
        }
        if (hasProgress) {
            this.#detailView.setOverall(progress, snapshot.message ?? '');
        }

        if (this.#footerButton) {
            const connecting = snapshot.state === 'connecting';
            this.#footerButton.textContent = connecting
                ? this.t('deviceConnection.cancelConnecting')
                : this.t('dialog.close');
            this.#footerButton.classList.toggle('modal-dialog__btn--primary', connecting);
            this.#footerButton.classList.toggle('modal-dialog__btn--ghost', !connecting);
        }
    }

    /**
     * Text for the live status line.
     *
     * A tracker message is more specific than the generic loading line, so it wins while the
     * device reports progress; the fallback still names the step when there is no message.
     * @returns {string} Already translated status text.
     * @private
     */
    #statusText(): string {
        const snapshot = this.#snapshot;
        if (snapshot.state === 'connecting') {
            return this.t('deviceConnection.connecting');
        }
        const message = snapshot.message?.trim();
        if (message) {
            return message;
        }
        return this.t('deviceConnection.loadingDeviceInfo');
    }

    /**
     * Serialize the dialog for a `ViewFactory` round trip.
     * @returns Serialized view data.
     */
    override serialize(): Record<string, unknown> {
        return {
            ...super.serialize(),
            type: 'ConnectingProgressDialogView',
        };
    }
}




