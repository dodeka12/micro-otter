// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file The one device connection dialog: provider, port, connect/disconnect.
 * @module views/device-connection-dialog-view
 *
 * This dialog is the only provider dropdown, the only port chooser and the only
 * `Connect` / `Disconnect` action in the app (M4t, decision D1). The title-bar
 * device badge opens it; the Device tab keeps its console and its reset actions
 * only.
 *
 * Its `open()` sequencer closes the configuration dialog **before** it connects:
 * `ViewManager.showModal` calls `clearModal()` synchronously, and
 * `DeviceConnection.connect()` opens the first-connect identification dialog through
 * `showFormDialog` → `showModal`. A dialog that awaited its own `close` before
 * clearing the modal layer would fight that second dialog for the layer.
 *
 * The configuration dialog is deliberately **not** a progress surface: it closes before
 * `connect()` runs. `open()` therefore hands the wait to a separate
 * `ConnectingProgressDialogView`, shown after this dialog closes and before `connect()`
 * starts, so the first retry-able error is never silent.
 */

import { ModalDialogView } from './modal-dialog-view.js';
import { ConnectingProgressDialogView } from './connecting-progress-dialog-view.js';
import { DropdownControl } from './controls/dropdown-control.js';
import { ButtonControl } from './controls/custom-runtime-controls.js';
import { IconProvider } from './icon-provider.js';
import { fetchSerialPorts, serialPortOptions } from '../serial/serial-ports.js';
import type { SerialPortEntry } from '../serial/serial-ports.js';
import { isConnectCancelled } from '../serial/serial-connection-base.js';
import type {
    DeviceConnectionProviderLike,
    DeviceConnectionSnapshot,
} from '../serial/device-connection-monitor.js';

/** Options type of the inherited modal, used to borrow its logger/i18n shapes. */
type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];

/** Logger shape the inherited modal accepts. */
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;

/** i18n shape the inherited modal accepts. */
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

/** Provider key of the WebSocket serial bridge, the only provider that names a port here. */
export const WEBSOCKET_PROVIDER_KEY = 'websocket';

/** Baud rate the bridge needs for the MicroPython REPL. */
const BRIDGE_BAUD_RATE = 115200;

/**
 * What confirming the dialog asks the caller to do.
 *
 * The dialog never performs the action itself: it closes first, then `open()`
 * drives the monitor.
 */
export interface DeviceConnectionDialogResult extends Record<string, unknown> {
    /** Which action the user confirmed. */
    readonly action: 'connect' | 'disconnect' | 'cancel-connect';
    /** Provider that was active when the user confirmed. */
    readonly providerKey: string;
    /** Device path for the bridge provider, `null` otherwise. */
    readonly device: string | null;
}

/**
 * Structural contract of the connection the dialog drives.
 *
 * This is the `DeviceConnectionMonitor` surface the dialog needs; declaring it
 * here keeps tests free of the real monitor and of a serial port.
 */
export interface DeviceConnectionDialogConnectionLike {
    /** Current snapshot; the dialog reads the state and the provider key from it. */
    getSnapshot(): DeviceConnectionSnapshot;
    /** Every provider, keyed by provider key. */
    getProviders(): Record<string, DeviceConnectionProviderLike>;
    /** Choose the provider the next connect uses. */
    setActiveProvider(providerKey: string): void;
    /** Open the connection. */
    connect(options?: Record<string, unknown>): Promise<void>;
    /** Close the connection. */
    disconnect(): Promise<void>;
    /** Cancel an in-flight `connect()`; returns whether an attempt was cancelled. */
    cancelConnect(): boolean;
    /** Clear a latched failure before a new attempt. */
    resetError(): void;
    /** Subscribe to snapshot changes; the connecting mode uses it to auto-close. */
    subscribe?(listener: (snapshot: DeviceConnectionSnapshot) => void): () => void;
}

/**
 * Construction options.
 */
export interface DeviceConnectionDialogOptions {
    /** Connection the dialog configures and drives. */
    connection: DeviceConnectionDialogConnectionLike;
    /** Port-list transport; defaults to the bridge's `/api/serial-ports`. */
    fetchPorts?: () => Promise<SerialPortEntry[]>;
    /** Dialog title; defaults to `deviceConnection.dialogTitle`. */
    title?: string;
    /** Explicit view id. */
    id?: string | null;
    /** i18n service forwarded to the dialog and its controls. */
    i18nService?: I18nServiceLike;
    /** Logger forwarded to the dialog and its controls. */
    logger?: LoggerLike;
}

/**
 * Serialized shape, for `ViewFactory` round trips.
 */
export interface DeviceConnectionDialogSerialized extends Record<string, unknown> {
    /** View discriminator. */
    type: 'DeviceConnectionDialogView';
    /** Provider the dialog had selected. */
    providerKey: string;
}

/**
 * Data a `ViewFactory` round trip may carry.
 */
interface DeviceConnectionDialogDeserializeData {
    /** Dialog title. */
    title?: string;
    /** Explicit view id. */
    id?: string | null;
    /** Provider the serialized dialog had selected. */
    providerKey?: string;
}

/**
 * Context a `ViewFactory` round trip carries.
 */
interface DeviceConnectionDialogDeserializeContext {
    /** Connection service; required, because the dialog cannot build one. */
    deviceConnection?: DeviceConnectionDialogConnectionLike | null;
    /** i18n service. */
    i18nService?: I18nServiceLike;
    /** Logger. */
    logger?: LoggerLike;
}

/**
 * View-manager surface `open()` needs.
 */
export interface DeviceConnectionDialogViewManagerLike {
    /** Show the dialog on the modal layer. */
    showModal(
        view: DeviceConnectionDialogView | ConnectingProgressDialogView,
        options?: { scrim?: boolean }
    ): unknown;
    /** Report a failed connect/disconnect. */
    showError(options: Record<string, unknown>): Promise<void>;
}

/**
 * Build the provider-specific connect options for the connection.
 *
 * The bridge needs the port path and the REPL baud rate; the browser WebSerial
 * provider opens its own picker and takes no options.
 * @param providerKey Active provider key.
 * @param device Selected port path, or `null`.
 * @returns Options object for `DeviceConnection.connect()`.
 */
function buildConnectOptions(
    providerKey: string,
    device: string | null
): Record<string, unknown> {
    if (providerKey === WEBSOCKET_PROVIDER_KEY && device) {
        return { device, baudRate: BRIDGE_BAUD_RATE };
    }
    return {};
}

/**
 * The one device connection dialog.
 *
 * Composition: a provider `DropdownControl`, a device `DropdownControl` (bridge
 * provider only), a `role="status"` line for the scan, an icon-only
 * `ButtonControl` that rescans, and one hint paragraph. The action row is the
 * inherited `ModalDialogView` footer, so the buttons are text-only and match every
 * other dialog.
 */
export class DeviceConnectionDialogView extends ModalDialogView {
    /** Connection the dialog configures and drives. */
    readonly connection: DeviceConnectionDialogConnectionLike;

    /** Port-list transport. */
    #fetchPorts: () => Promise<SerialPortEntry[]>;

    /** Provider selected in the dialog. */
    #providerKey: string;

    /** Whether the dialog opened on a connected device, which flips the action to `Disconnect`. */
    #connected: boolean;

    /** Whether the dialog opened while a connect was in flight, which shows only Cancel. */
    #cancelMode: boolean;

    /** Whether the attempt settled on its own while the cancel dialog was open. */
    #stateSettled = false;

    /** Unsubscribe from the snapshot subscription the connecting mode registers. */
    #unsubscribeSnapshot: (() => void) | null = null;

    /** Ports reported by the last successful scan. */
    #ports: SerialPortEntry[] = [];

    /** Port currently selected, or `null`. */
    #selectedDevice: string | null = null;

    /** Whether a scan is in flight; a second click is ignored rather than queued. */
    #scanning = false;

    /** Result the dialog returned, or `null` while unanswered. */
    #result: DeviceConnectionDialogResult | null = null;

    /** Provider dropdown. */
    #providerDropdown: DropdownControl | null = null;

    /** Device (port) dropdown. */
    #deviceDropdown: DropdownControl | null = null;

    /** Host row of the device dropdown, hidden for the WebSerial provider. */
    #deviceRow: HTMLElement | null = null;

    /** Status line under the device row. */
    #statusEl: HTMLElement | null = null;

    /** Rescan button. */
    #scanButton: ButtonControl | null = null;

    /** Primary footer button, disabled while the selection cannot connect. */
    #primaryButton: HTMLButtonElement | null = null;


    /**
     * Build the dialog.
     * @param options Connection, port transport, i18n and logger seams.
     */
    constructor({
        connection,
        fetchPorts = fetchSerialPorts,
        title,
        id = null,
        i18nService = null,
        logger = null,
    }: DeviceConnectionDialogOptions) {
        const snapshot = connection.getSnapshot();
        const connected = snapshot.state === 'connected' || snapshot.state === 'loading';
        const cancelMode = snapshot.state === 'connecting';
        const providers = Object.keys(connection.getProviders());

        super({
            title: title ?? 'Connect Device',
            icon: IconProvider.cable,
            confirmLabel: 'Connect',
            cancelLabel: 'Cancel',
            showCancel: true,
            id,
            i18nService,
            logger,
        });

        this.connection = connection;
        this.#fetchPorts = fetchPorts;
        this.#connected = connected;
        this.#cancelMode = cancelMode;
        this.#providerKey =
            snapshot.providerKey ?? (providers.length > 0 ? providers[0] : '');

        this.title = title ?? this.t('deviceConnection.dialogTitle');
        this.confirmLabel = this.#connected
            ? this.t('deviceConnection.disconnect')
            : this.t('deviceConnection.connect');
        this.cancelLabel = this.t('dialog.cancel');
    }

    /**
     * Translate a key, falling back to the key itself when no service is set.
     * @param key Translation key.
     * @param params Placeholder values.
     * @returns Translated text.
     * @private
     */
    #t(key: string, params: Record<string, unknown> = {}): string {
        return this.t(key, params);
    }

    /**
     * Provider options for the dropdown, in registry order.
     * @returns One option per provider; the label falls back to the key.
     * @private
     */
    #providerOptions(): Array<{ value: string; label: string }> {
        return Object.entries(this.connection.getProviders()).map(([value, provider]) => ({
            value,
            label: provider.name || value,
        }));
    }


    /**
     * Compose the dialog body: provider, device, status, refresh, hint.
     * @returns The body element.
     * @protected
     */
    protected override _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body device-connection-dialog';

        // While a connect is in flight the dialog has nothing to configure; it only
        // offers a way to cancel. The badge reports the progress, not this dialog.
        if (this.#cancelMode) {
            this.#statusEl = document.createElement('p');
            this.#statusEl.className = 'device-connection-dialog__status';
            this.#statusEl.setAttribute('role', 'status');
            this.#statusEl.setAttribute('aria-live', 'polite');
            this.#statusEl.textContent = this.#t('deviceConnection.connecting');
            body.appendChild(this.#statusEl);
            return body;
        }

        const providerRow = document.createElement('div');
        providerRow.className = 'device-connection-dialog__row device-connection-dialog__row--provider';
        this.#providerDropdown = new DropdownControl({
            label: this.#t('deviceConnection.provider'),
            options: this.#providerOptions(),
            value: this.#providerKey,
            onChange: (value) => this.#handleProviderChange(String(value)),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this.#providerDropdown.attachTo(providerRow);
        this._cleanup.push(() => this.#providerDropdown?.detach());
        body.appendChild(providerRow);

        this.#deviceRow = document.createElement('div');
        this.#deviceRow.className =
            'device-connection-dialog__row device-connection-dialog__row--device';
        this.#deviceDropdown = new DropdownControl({
            label: this.#t('deviceConnection.endpoint'),
            options: [],
            placeholder: this.#t('deviceConnection.endpointLoading'),
            onChange: (value) => {
                this.#selectedDevice = String(value);
                this.#updatePrimaryState();
            },
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this.#deviceDropdown.attachTo(this.#deviceRow);
        this._cleanup.push(() => this.#deviceDropdown?.detach());
        body.appendChild(this.#deviceRow);

        this.#statusEl = document.createElement('p');
        this.#statusEl.className = 'device-connection-dialog__status';
        this.#statusEl.setAttribute('role', 'status');
        this.#statusEl.setAttribute('aria-live', 'polite');
        body.appendChild(this.#statusEl);

        const refreshRow = document.createElement('div');
        refreshRow.className =
            'device-connection-dialog__row device-connection-dialog__row--refresh';
        this.#scanButton = new ButtonControl({
            label: this.#t('deviceConnection.refreshEndpoints'),
            style: 'secondary',
            icon: IconProvider.refresh,
            iconOnly: true,
        });
        this.#scanButton.onClick(() => {
            void this.#scanPorts();
        });
        this.#scanButton.render(refreshRow);
        body.appendChild(refreshRow);

        const hint = document.createElement('p');
        hint.className = 'device-connection-dialog__hint';
        hint.textContent = this.#t('deviceConnection.hint');
        body.appendChild(hint);

        return body;
    }

    /**
     * Wire the footer button reference and run the first port scan.
     *
     * The connecting mode skips the scan (there is nothing to configure) and instead
     * subscribes to the snapshot so it can close itself when the attempt settles.
     */
    override afterAttach(): void {
        super.afterAttach();

        if (this.#cancelMode) {
            this.#subscribeToSnapshot();
            return;
        }

        this.#primaryButton =
            this._dialogEl?.querySelector<HTMLButtonElement>('.modal-dialog__btn--primary') ?? null;
        this.#updateDeviceRowVisibility();
        this.#updatePrimaryState();
        void this.#scanPorts();
    }

    /**
     * Override the footer for the connecting mode: exactly one "Cancel connecting"
     * button, matching the inherited primary footer button variant.
     * @returns The footer element.
     * @protected
     */
    protected override _buildFooter(): HTMLElement {
        if (!this.#cancelMode) {
            return super._buildFooter();
        }

        const footer = document.createElement('div');
        footer.className = 'modal-dialog__footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'modal-dialog__btn modal-dialog__btn--primary';
        cancelBtn.textContent = this.#t('deviceConnection.cancelConnecting');
        cancelBtn.addEventListener('click', () => this.cancel());
        footer.appendChild(cancelBtn);

        return footer;
    }

    /**
     * Close the dialog without a result once the in-flight attempt settles on its
     * own, so the user is never offered a cancel for an attempt that is already done.
     * @private
     */
    #subscribeToSnapshot(): void {
        const subscribe = this.connection.subscribe?.bind(this.connection);
        if (!subscribe) {
            return;
        }

        this.#unsubscribeSnapshot = subscribe((snapshot) => {
            if (snapshot.state === 'connecting') {
                return;
            }
            this.#stateSettled = true;
            this.cancel();
        });
        this._cleanup.push(() => {
            this.#unsubscribeSnapshot?.();
            this.#unsubscribeSnapshot = null;
        });
    }


    /**
     * Read the port list once. A second call while a scan is in flight is ignored.
     * @private
     */
    async #scanPorts(): Promise<void> {
        if (this.#scanning) {
            return;
        }
        this.#scanning = true;
        this.#scanButton?.setDisabled(true);
        this.#setStatus(this.#t('deviceConnection.portsLoading'));

        try {
            const ports = await this.#fetchPorts();
            this.#ports = ports;
            this.#renderDeviceOptions();
            this.#setStatus(
                ports.length === 0 ? this.#t('deviceConnection.portsEmpty') : ''
            );
            this.#updatePrimaryState();
        } catch (error) {
            // A transient HTTP failure keeps the options the user already had.
            this._log('port-scan-failed', 'warn', { error });
            this.#setStatus(this.#t('deviceConnection.portsFailed'));
        } finally {
            this.#scanning = false;
            this.#scanButton?.setDisabled(false);
        }
    }

    /**
     * Re-render the device dropdown, keeping the current selection when it is
     * still present and selecting the first port otherwise.
     * @private
     */
    #renderDeviceOptions(): void {
        const options = serialPortOptions(this.#ports);
        const keepSelection = options.some((option) => option.value === this.#selectedDevice);

        if (!keepSelection) {
            this.#selectedDevice = options.length > 0 ? options[0].value : null;
        }

        this.#deviceDropdown?.setOptions(options);
        if (this.#selectedDevice) {
            this.#deviceDropdown?.setValue(this.#selectedDevice);
        }
    }

    /**
     * Switch the provider on the connection and re-render the affected rows.
     *
     * `DeviceConnection.setActiveProvider()` refuses a switch while connected, so
     * the dropdown is restored and the reason goes into the status line.
     * @param value Provider key the user picked.
     * @private
     */
    #handleProviderChange(value: string): void {
        try {
            this.connection.setActiveProvider(value);
            this.#providerKey = value;
        } catch (error) {
            this._log('provider-change-rejected', 'warn', { error });
            this.#providerDropdown?.setValue(this.#providerKey);
            this.#setStatus(this.#t('deviceConnection.errors.changeWhileConnected'));
            return;
        }

        this.#updateDeviceRowVisibility();
        this.#updatePrimaryState();
    }

    /**
     * Show the device row only for the provider that names a port.
     * @private
     */
    #updateDeviceRowVisibility(): void {
        if (this.#deviceRow) {
            this.#deviceRow.hidden = this.#providerKey !== WEBSOCKET_PROVIDER_KEY;
        }
    }

    /**
     * Disable the primary action while the selection cannot connect.
     *
     * An empty provider list can never connect, and the bridge provider needs a
     * port. `Disconnect` stays available regardless, so a user can always get out.
     * @private
     */
    #updatePrimaryState(): void {
        if (!this.#primaryButton) {
            return;
        }
        const hasProviders = Object.keys(this.connection.getProviders()).length > 0;
        const bridgeNeedsPort =
            !this.#connected &&
            this.#providerKey === WEBSOCKET_PROVIDER_KEY &&
            !this.#selectedDevice;

        this.#primaryButton.disabled = !hasProviders || bridgeNeedsPort;
    }

    /**
     * Write the status line.
     * @param text Text to show; an empty string clears it.
     * @private
     */
    #setStatus(text: string): void {
        if (this.#statusEl) {
            this.#statusEl.textContent = text;
        }
    }


    /**
     * Record the confirmed intent. The dialog never calls `connect()` itself.
     * @returns The result `getResult()` will answer.
     * @protected
     */
    protected override _onConfirm(): DeviceConnectionDialogResult {
        this.#result = this.#cancelMode
            ? {
                  action: 'cancel-connect',
                  providerKey: this.#providerKey,
                  device: null,
              }
            : {
                  action: this.#connected ? 'disconnect' : 'connect',
                  providerKey: this.#providerKey,
                  device:
                      this.#providerKey === WEBSOCKET_PROVIDER_KEY ? this.#selectedDevice : null,
              };
        return this.#result;
    }

    /**
     * Treat every dismiss path in the connecting mode as a cancel, so the × button
     * and Escape also cancel the attempt rather than leaving it running with no UI.
     * @returns The base payload (the result is recorded on `#result`).
     * @protected
     */
    protected override _onCancel(): Record<string, unknown> {
        if (this.#cancelMode && !this.#stateSettled) {
            this.#result = {
                action: 'cancel-connect',
                providerKey: this.#providerKey,
                device: null,
            };
        }
        return {};
    }

    /**
     * The confirmed intent, or `null` when the dialog was cancelled or dismissed.
     * @returns The result, or `null`.
     */
    getResult(): DeviceConnectionDialogResult | null {
        return this.#result;
    }

    /**
     * Serialize the dialog for a `ViewFactory` round trip.
     * @returns Serialized view data.
     */
    override serialize(): DeviceConnectionDialogSerialized {
        return {
            ...super.serialize(),
            type: 'DeviceConnectionDialogView',
            providerKey: this.#providerKey,
        };
    }

    /**
     * Rebuild the dialog from serialized data.
     *
     * The dialog cannot construct a connection, so a missing service is a hard
     * error that names the member it needs.
     * @param data Serialized view data.
     * @param createChild Child factory; unused (the dialog owns its controls).
     * @param context Factory context carrying the connection service.
     * @returns A new dialog.
     * @throws {Error} When `context.deviceConnection` is missing.
     */
    static deserialize(
        data: DeviceConnectionDialogDeserializeData = {},
        createChild: ((data: unknown) => unknown) | null = null,
        context: DeviceConnectionDialogDeserializeContext = {}
    ): DeviceConnectionDialogView {
        void createChild;
        const connection = context.deviceConnection ?? null;
        if (!connection) {
            throw new Error(
                'DeviceConnectionDialogView.deserialize requires the device connection service (context.deviceConnection).'
            );
        }

        return new DeviceConnectionDialogView({
            connection,
            title: data.title,
            id: data.id,
            i18nService: context.i18nService ?? null,
            logger: context.logger ?? null,
        });
    }

    /**
     * Show the configuration dialog and run the action it returns.
     *
     * The dialog is shown, the user's answer is awaited, and only then is the
     * modal layer used for anything else; `showModal()` already cleared it
     * synchronously, so the first-connect identification dialog inside
     * `connect()` owns the layer from the moment this method proceeds.
     *
     * A confirmed connect puts the silent wait on `ConnectingProgressDialogView`:
     * the progress dialog replaces the closed configuration dialog before
     * `connect()` starts and follows the monitor snapshot until the attempt
     * settles. Disconnect, dismissal and cancelling a connect never show it.
     * @param viewManager View manager that owns the modal layer.
     * @param options Dialog construction options; `connection` drives the action.
     */
    static async open(
        viewManager: DeviceConnectionDialogViewManagerLike,
        options: DeviceConnectionDialogOptions
    ): Promise<void> {
        const dialog = new DeviceConnectionDialogView(options);
        const closed = new Promise<DeviceConnectionDialogResult | null>((resolve) => {
            dialog.on('close', () => resolve(dialog.getResult()));
        });

        viewManager.showModal(dialog, { scrim: true });
        const result = await closed;

        if (!result) {
            return;
        }

        // Cancelling a connect is the one action that needs no resetError() and no
        // connect/disconnect: the badge already shows `Disconnected`.
        if (result.action === 'cancel-connect') {
            options.connection.cancelConnect();
            return;
        }

        options.connection.resetError();

        let progress: ConnectingProgressDialogView | null = null;
        try {
            if (result.action === 'connect') {
                progress = new ConnectingProgressDialogView({
                    connection: options.connection,
                    i18nService: options.i18nService ?? null,
                    logger: options.logger ?? null,
                });
                viewManager.showModal(progress, { scrim: true });
                await options.connection.connect(
                    buildConnectOptions(result.providerKey, result.device)
                );
                // The happy path without a device-info phase: connect() resolved while the
                // monitor never left `connecting`, so no snapshot will close the dialog.
                progress.markConnectSettled();
            } else {
                await options.connection.disconnect();
            }
        } catch (error) {
            // Close before showError() takes the layer; close() is idempotent when the
            // monitor already closed the dialog on `error` or on a user cancellation.
            progress?.close();
            // A user cancellation is not a failure; the badge stays `Disconnected`.
            if (isConnectCancelled(error)) {
                return;
            }
            await viewManager.showError({
                title: dialog.t('deviceConnection.errors.connectFailed'),
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

