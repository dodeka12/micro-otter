// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * DeviceConnectionView - the device console and runtime controls
 *
 * The Device tab no longer offers a way to connect: the title-bar device badge
 * and `DeviceConnectionDialogView` are the one connection surface (M4t). This
 * view keeps what a connected session needs:
 *
 * - Play / Stop / Soft reset / Hard reset in a collapsible toolbar
 * - The device-provided runtime configuration in a collapsible pane
 * - The device log in a collapsible pane
 * - Message routing to the console with type-specific formatting
 * - File transfer progress display
 * - The device-information loading panel, which now reports *any* connect,
 *   including one started from the badge
 * - Error handling with user feedback
 * - ViewBase integration with lifecycle, serialization, i18n
 */

import { ViewBase } from './view-base.js';
import { ToolbarView } from './toolbar-view.js';
import { CollapsibleView } from './collapsible-view.js';
import { ConsoleLogView } from './console-log-view.js';
import { SplitView } from './split-view.js';
import { CustomRuntimeView } from './custom-runtime-view.js';
import { IconProvider } from './icon-provider.js';
import { DeviceState } from '../data/device-state.js';
import { ProgressEventBus, ProgressEventType, type ProgressEvent } from '../core/progress-events.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;
type DeviceConnectionViewBaseOptions = Omit<
    ViewBaseOptions,
    'title' | 'icon' | 'i18nService' | 'logger'
>;
type ViewBaseSerialized = ReturnType<ViewBase['serialize']>;

type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type ToolbarControlButtonName = 'play' | 'stop' | 'softReset' | 'hardReset';

interface DeviceProvider {
    name?: string;
}

type DeviceProviders = Record<string, DeviceProvider>;

interface DeviceConnectionLike {
    isConnected(): boolean;
    isExecutionRunning?(): boolean;
    getCustomViewData(): Record<string, unknown> | null;
    getProviders(): DeviceProviders;
    getActiveProviderKey(): string | null;
    setActiveProvider(providerKey: string): void;
    getState(): ConnectionState;
    connect(options?: Record<string, unknown>): Promise<void>;
    disconnect(): Promise<void>;
    startMain(): Promise<void>;
    startExecution(command: string): Promise<void>;
    stopExecution(): Promise<void>;
    softReset(): Promise<void>;
    hardReset(): Promise<void>;
    addEventListener(type: string, listener: (event: CustomEvent<unknown>) => void): void;
    removeEventListener(type: string, listener: (event: CustomEvent<unknown>) => void): void;
}

interface DeviceConnectionViewOptions extends DeviceConnectionViewBaseOptions {
    deviceConnection: DeviceConnectionLike;
    viewManager?: DeviceConnectionViewManagerLike | null;
    i18nService?: ViewBaseOptions['i18nService'];
    logger?: ViewBaseOptions['logger'];
    title?: string;
    icon?: string;
}

interface DeviceConnectionViewSerialized extends ViewBaseSerialized {
    type: 'DeviceConnectionView';
    toolbar: unknown;
    console: unknown;
}

interface DeviceConnectionViewDeserializeData {
    title?: string;
    icon?: string | null;
    activeProvider?: string | null;
}

interface DeviceConnectionViewDeserializeContext {
    deviceConnection: DeviceConnectionLike;
    i18nService?: ViewBaseOptions['i18nService'];
    logger?: ViewBaseOptions['logger'];
}

interface DeviceInfoLoadingDetail {
    loading?: boolean;
    message?: string;
    progress?: number;
}

interface ConnectionStateChangeDetail {
    state?: ConnectionState;
    previousState?: ConnectionState;
}

interface DeviceMessageDetail {
    type: string;
    message: string;
    timestamp?: number;
}

interface FileTransferProgressDetail {
    operation: string;
    filename: string;
    progress: number;
    bytesTransferred: number;
    totalBytes: number;
}

interface FileTransferCompleteDetail {
    operation: string;
    filename: string;
    bytesTransferred: number;
    duration: number;
}

interface DeviceErrorDetail {
    error: Error;
    context?: string;
    critical?: boolean;
}

interface ConfirmationDialogOptions {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
}

interface ErrorDialogOptions {
    title: string;
    message: string;
}

interface DeviceConnectionViewManagerLike {
    showConfirmation(options: ConfirmationDialogOptions): Promise<boolean>;
    showError(options: ErrorDialogOptions): Promise<void>;
}

/**
 * DeviceConnectionView class
 *
 * @extends ViewBase
 */
export class DeviceConnectionView extends ViewBase {
    _deviceConnection: DeviceConnectionLike;
    _viewManager: DeviceConnectionViewManagerLike | null;

    _connectionToolbarView: ToolbarView | null;
    _connectionToolbarCollapsible: CollapsibleView | null;
    _splitView: SplitView | null;
    _customRuntimeView: CustomRuntimeView | null;
    _customRuntimeCollapsible: CollapsibleView | null;
    _consoleView: ConsoleLogView | null;
    _consoleCollapsible: CollapsibleView | null;
    _loadingPanel: HTMLDivElement | null;
    _loadingMessageElement: HTMLParagraphElement | null;
    _loadingProgressElement: HTMLDivElement | null;
    _deviceInfoLoading: boolean;

    _playButton: HTMLButtonElement | null;
    _stopButton: HTMLButtonElement | null;
    _softResetButton: HTMLButtonElement | null;
    _hardResetButton: HTMLButtonElement | null;
    _buttonEnabledState: Partial<Record<ToolbarControlButtonName, boolean>>;

    _connectionState: ConnectionState;
    _deviceState: DeviceState;

    _deviceListeners: Map<string, (event: CustomEvent<unknown>) => void>;
    _deviceInfoLoadedListener: ((event: CustomEvent<unknown>) => void) | null;
    _deviceInfoLoadErrorListener: ((event: CustomEvent<unknown>) => void) | null;
    _deviceInfoLoadingListener: ((event: CustomEvent<unknown>) => void) | null;
    _progressListener: ((event: ProgressEvent) => void) | null;

    /**
     * @param {Object} options - Configuration options
     * @param {DeviceConnection} options.deviceConnection - Device connection manager instance
     * @param {I18nService} [options.i18nService] - Translation service
     * @param {Object} [options.logger=console] - Logger instance
     * @param {string} [options.title='Device Connection'] - View title
     * @param {string} [options.icon='cable'] - Icon identifier
     */
    constructor({
        deviceConnection,
        viewManager = null,
        i18nService,
        logger = null,
        title = 'Device Connection',
        icon = 'cable',
        ...rest
    }: DeviceConnectionViewOptions) {
        super({ i18nService, logger, title, icon, ...rest });

        if (!deviceConnection) {
            throw new Error('DeviceConnectionView requires deviceConnection parameter');
        }

        this._deviceConnection = deviceConnection;
        this._viewManager = viewManager;

        this._connectionToolbarView = null;
        this._connectionToolbarCollapsible = null;
        this._splitView = null;
        this._customRuntimeView = null;
        this._customRuntimeCollapsible = null;
        this._consoleView = null;
        this._consoleCollapsible = null;
        this._loadingPanel = null;
        this._loadingMessageElement = null;
        this._loadingProgressElement = null;
        this._deviceInfoLoading = false;

        this._playButton = null;
        this._stopButton = null;
        this._softResetButton = null;
        this._hardResetButton = null;
        this._buttonEnabledState = {};

        this._connectionState = 'disconnected';
        this._deviceState = new DeviceState({ connected: false });

        this._deviceListeners = new Map();
        this._deviceInfoLoadedListener = null;
        this._deviceInfoLoadErrorListener = null;
        this._deviceInfoLoadingListener = null;
        this._progressListener = null;

        this._log('constructor-complete');
    }

    /**
     * Render the view structure
     * @param {HTMLElement} container - Parent container
     */
    render(container: HTMLElement): void {
        this._log('render-start');

        const root = document.createElement('div');
        root.className = 'device-connection-view';

        const splitHost = document.createElement('div');
        splitHost.className = 'device-connection-view__split-host';

        if (!this._consoleView) {
            this._consoleView = new ConsoleLogView({
                i18nService: this._i18nService,
                logger: this._logger,
                maxMessages: 1000,
                autoscroll: true,
            });
        }

        if (!this._consoleCollapsible) {
            const consoleTitle = this.t('deviceConnection.deviceLog');
            this._consoleCollapsible = new CollapsibleView({
                headerTitle: consoleTitle,
                collapsed: false,
                contentView: this._consoleView,
                title: consoleTitle,
                icon: 'terminal',
                id: 'device-connection-log-section',
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        if (!this._connectionToolbarView) {
            this._connectionToolbarView = new ToolbarView({
                height: 36,
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        if (!this._connectionToolbarCollapsible) {
            this._connectionToolbarCollapsible = new CollapsibleView({
                headerTitle: this.t('deviceConnection.connectionToolbar'),
                collapsed: false,
                contentView: this._connectionToolbarView,
                title: this.t('deviceConnection.connectionToolbar'),
                icon: 'cable',
                id: 'device-connection-toolbar-section',
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        const viewDefinition = this._deviceConnection?.getCustomViewData();
        if (viewDefinition) {
            this._createCustomRuntimeSection(viewDefinition);
        }

        if (!this._splitView) {
            this._splitView = new SplitView({
                orientation: 'vertical',
                views: this._getSplitPaneViews(),
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        if (!this._loadingPanel) {
            this._loadingPanel = this._createLoadingPanel();
        }

        root.append(splitHost, this._loadingPanel);
        container.replaceChildren(root);

        this._splitView.attachTo(splitHost);

        if (!this._playButton) {
            this._createConnectionToolbarControls();
            this._connectionToolbarCollapsible?.refreshSize();
        }

        this._updateControlStates();
        this._setLoadingState(this._deviceInfoLoading);

        this._log('render-complete');
    }

    /**
     * Build the ordered SplitView pane views, including only the sections currently available.
     * Called from render and whenever the device-info load adds or removes the runtime section.
     * @private
     * @returns {ViewBase[]} Pane views in display order.
     */
    _getSplitPaneViews(): ViewBase[] {
        const views: ViewBase[] = [];
        if (this._connectionToolbarCollapsible) {
            views.push(this._connectionToolbarCollapsible);
        }
        if (this._customRuntimeCollapsible) {
            views.push(this._customRuntimeCollapsible);
        }
        if (this._consoleCollapsible) {
            views.push(this._consoleCollapsible);
        }
        return views;
    }

    /**
     * Wrap the custom runtime view in a collapsible section so its title comes from the
     * device-provided definition instead of the renderer's own top-level header.
     * Called from render and after a delayed device-info load.
     * @private
     * @param {Object} viewDefinition - Device-provided custom view definition.
     */
    _createCustomRuntimeSection(viewDefinition: Record<string, unknown>): void {
        if (this._customRuntimeView && this._customRuntimeCollapsible) {
            return;
        }

        const runtimeTitle = this._resolveCustomViewTitle(viewDefinition);

        if (!this._customRuntimeView) {
            this._customRuntimeView = new CustomRuntimeView({
                viewDefinition,
                deviceConnection: this._deviceConnection,
                i18nService: this._i18nService,
                viewManager: this._viewManager,
                logger: this._logger,
                showHeader: false,
                title: runtimeTitle,
                icon: 'settings',
            });
        }

        if (!this._customRuntimeCollapsible) {
            this._customRuntimeCollapsible = new CollapsibleView({
                headerTitle: runtimeTitle,
                collapsed: false,
                contentView: this._customRuntimeView,
                title: runtimeTitle,
                icon: 'settings',
                id: 'device-connection-runtime-section',
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }
    }

    /**
     * Resolve the translated title for the custom runtime section, falling back to the
     * generic label when the device definition has no title.
     * @private
     * @param {Object|null} viewDefinition - Device-provided custom view definition.
     * @returns {string} Translated section title.
     */
    _resolveCustomViewTitle(viewDefinition: Record<string, unknown> | null): string {
        const title = viewDefinition?.title;
        if (typeof title === 'string' && title.trim().length > 0) {
            return this.t(title);
        }
        return this.t('deviceConnection.customView');
    }

    /**
     * Hook called after view attached
     */
    afterAttach(): void {
        super.afterAttach();

        this._log('after-attach-start');

        this._subscribeToDeviceEvents();

        if (!this._deviceInfoLoadedListener) {
            this._deviceInfoLoadedListener = () => {
                this._onDeviceInfoLoaded();
            };
        }
        if (!this._deviceInfoLoadErrorListener) {
            this._deviceInfoLoadErrorListener = () => {
                this._setLoadingState(false);
            };
        }
        if (!this._deviceInfoLoadingListener) {
            this._deviceInfoLoadingListener = (event: CustomEvent<unknown>) => {
                const detail = (event?.detail ?? {}) as DeviceInfoLoadingDetail;
                this._setLoadingState(Boolean(detail.loading), detail.message, detail.progress);
            };
        }

        this._deviceConnection.addEventListener('device-info-loaded', this._deviceInfoLoadedListener);
        this._deviceConnection.addEventListener(
            'device-info-load-error',
            this._deviceInfoLoadErrorListener
        );
        this._deviceConnection.addEventListener('device-info-loading', this._deviceInfoLoadingListener);

        if (!this._progressListener) {
            this._progressListener = (event: ProgressEvent) => this._onProgressEvent(event);
        }
        ProgressEventBus.subscribe(this._progressListener);

        this._syncConnectionState();

        this._subscribeToLanguageChanges(() => {
            this._updateToolbarLabels();
        });

        this._logToConsole('system', this.t('deviceConnection.initialized'));

        this._log('after-attach-complete');
    }

    /**
     * Hook called before view detached
     */
    beforeDetach(): void {
        this._log('before-detach-start');

        if (this._progressListener) {
            ProgressEventBus.unsubscribe(this._progressListener);
        }

        if (this._deviceInfoLoadedListener) {
            this._deviceConnection.removeEventListener(
                'device-info-loaded',
                this._deviceInfoLoadedListener
            );
        }
        if (this._deviceInfoLoadErrorListener) {
            this._deviceConnection.removeEventListener(
                'device-info-load-error',
                this._deviceInfoLoadErrorListener
            );
        }
        if (this._deviceInfoLoadingListener) {
            this._deviceConnection.removeEventListener(
                'device-info-loading',
                this._deviceInfoLoadingListener
            );
        }

        this._connectionToolbarView = null;
        this._connectionToolbarCollapsible = null;
        this._splitView = null;
        this._customRuntimeView = null;
        this._customRuntimeCollapsible = null;
        this._consoleCollapsible = null;
        this._loadingPanel = null;
        this._loadingMessageElement = null;
        this._loadingProgressElement = null;
        this._playButton = null;
        this._stopButton = null;
        this._softResetButton = null;
        this._hardResetButton = null;

        super.beforeDetach();

        this._log('before-detach-complete');
    }

    /**
     * Serialize view state
     * @returns {Object}
     */
    serialize(): DeviceConnectionViewSerialized {
        return {
            type: 'DeviceConnectionView',
            title: this.title,
            icon: this.icon,
            id: this.id,

            toolbar: this._connectionToolbarView?.serialize(),
            console: this._consoleView?.serialize(),
        };
    }

    /**
     * Deserialize view state
     * @param {Object} data - Serialized state
     * @param {Function} createChild - Child view factory
     * @param {Object} context - Deserialization context
     * @returns {DeviceConnectionView}
     */
    static deserialize(
        data: DeviceConnectionViewDeserializeData,
        _createChild: (data: unknown) => unknown,
        context: DeviceConnectionViewDeserializeContext
    ): DeviceConnectionView {
        const { deviceConnection } = context;

        if (!deviceConnection) {
            throw new Error('DeviceConnectionView requires deviceConnection in context');
        }

        const view = new DeviceConnectionView({
            deviceConnection,
            i18nService: context.i18nService,
            logger: context.logger,
            title: data.title,
            icon: data.icon as string | undefined,
        });

        // A payload may still carry `activeProvider` from before M4t; the
        // provider now belongs to `DeviceConnection` and the connection dialog,
        // so the key is accepted and ignored.
        void data.activeProvider;

        return view;
    }

    /**
     * Get current connection status
     * @returns {Object} { connected: boolean, provider: string|null }
     */
    getConnectionStatus(): { connected: boolean; provider: string | null } {
        return {
            connected: this._isConnected(),
            provider: this._deviceConnection.getActiveProviderKey(),
        };
    }

    _isConnected(): boolean {
        return Boolean(this._deviceConnection.isConnected());
    }

    /**
     * Clear console log
     *
     * Also called from `_onConnectionStateChanged()` whenever a connect attempt
     * starts, so each device session begins with an empty console.
     */
    clearLog(): void {
        if (this._consoleView) {
            this._consoleView.clearMessages();
        }
    }

    /**
     * Get reference to internal ConsoleLogView
     * @returns {ConsoleLogView}
     */
    getConsoleView(): ConsoleLogView | null {
        return this._consoleView;
    }

    // ============================================================================
    // Internal Methods
    // ============================================================================

    /**
     * Create loading overlay panel shown while device info/custom view setup is running.
     * @private
     * @returns {HTMLElement}
     */
    _createLoadingPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        panel.className = 'device-connection-loading-panel';
        panel.style.display = 'none';

        const spinner = document.createElement('div');
        spinner.className = 'device-connection-loading-spinner';

        const message = document.createElement('p');
        message.className = 'device-connection-loading-message';
        message.textContent = this.t('deviceConnection.loadingDeviceInfo');

        const progress = document.createElement('div');
        progress.className = 'device-connection-loading-progress';
        progress.textContent = '0%';

        panel.append(spinner, message, progress);

        this._loadingMessageElement = message;
        this._loadingProgressElement = progress;
        return panel;
    }

    /**
     * Update loading overlay visibility and message.
     * @private
     * @param {boolean} loading
     * @param {string} [message]
     * @param {number} [progress]
     */
    _setLoadingState(loading: boolean, message?: string, progress?: number): void {
        this._deviceInfoLoading = Boolean(loading);
        if (!this._loadingPanel) {
            return;
        }

        const defaultMessage = this.t('deviceConnection.loadingDeviceInfo');
        if (this._loadingMessageElement) {
            this._loadingMessageElement.textContent =
                typeof message === 'string' && message.trim() ? message : defaultMessage;
        }

        if (this._loadingProgressElement) {
            const resolvedProgress = Number.isFinite(progress)
                ? Math.max(0, Math.min(100, Math.round(progress)))
                : this._deviceInfoLoading
                  ? 0
                  : 100;
            this._loadingProgressElement.textContent = `${resolvedProgress}%`;
        }

        this._loadingPanel.style.display = this._deviceInfoLoading ? '' : 'none';
    }

    /**
     * React to ProgressEventBus updates emitted by DeviceConnection.loadDeviceInfo().
     * @private
     * @param {import('../core/progress-events.js').ProgressEvent} event
     */
    _onProgressEvent(event: ProgressEvent): void {
        if (!event || event.source !== 'device-info-load') {
            return;
        }

        if (event.type === ProgressEventType.START || event.type === ProgressEventType.UPDATE) {
            this._setLoadingState(true, event.message, event.progress);
            return;
        }

        if (event.type === ProgressEventType.COMPLETE || event.type === ProgressEventType.ERROR) {
            this._setLoadingState(false, event.message, event.progress);
        }
    }

    /**
     * Handle device-info-loaded event - create CustomRuntimeView if custom view available
     * @private
     */
    _onDeviceInfoLoaded(): void {
        const viewDefinition = this._deviceConnection?.getCustomViewData();

        if (viewDefinition && !this._customRuntimeCollapsible) {
            this._createCustomRuntimeSection(viewDefinition);

            if (this._splitView) {
                this._splitView.setViews(this._getSplitPaneViews());
            }

            this._log('custom-runtime-view-created');
        }

        this._updateControlStates();
        this._setLoadingState(false);
    }

    /**
     * Create the runtime toolbar: Play, Stop, Soft reset, Hard reset.
     *
     * Connecting is not offered here any more: the title-bar badge and the
     * connection dialog own it (M4t).
     * @private
     */
    _createConnectionToolbarControls(): void {
        if (!this._connectionToolbarView) {
            return;
        }

        const playControl = this._connectionToolbarView.addButton({
            icon: IconProvider.playArrow,
            label: this.t('deviceConnection.play'),
            onClick: () => this._handlePlay(),
            className: 'device-play-btn',
        });

        const stopControl = this._connectionToolbarView.addButton({
            icon: IconProvider.stop,
            label: this.t('deviceConnection.stop'),
            onClick: () => this._handleStop(),
            className: 'device-stop-btn',
        });

        const softResetControl = this._connectionToolbarView.addButton({
            icon: IconProvider.restart,
            label: this.t('deviceConnection.softReset'),
            onClick: () => this._handleSoftReset(),
            className: 'device-soft-reset-btn',
        });

        const hardResetControl = this._connectionToolbarView.addButton({
            icon: IconProvider.hardReset,
            label: this.t('deviceConnection.hardReset'),
            onClick: () => this._handleHardReset(),
            className: 'device-hard-reset-btn',
        });

        this._connectionToolbarView.renderControls();

        this._playButton = playControl.element;
        this._stopButton = stopControl.element;
        this._softResetButton = softResetControl.element;
        this._hardResetButton = hardResetControl.element;
    }

    /**
     * Ensure toolbar button references are bound to current DOM elements.
     *
     * This handles cases where ToolbarView re-renders controls and replaces
     * button elements (e.g. language updates or view reattachment).
     * @private
     */
    _syncToolbarButtonReferences(): void {
        const toolbarContainer = this._connectionToolbarView?.container;
        if (!toolbarContainer) {
            return;
        }

        this._playButton = toolbarContainer.querySelector('.device-play-btn');
        this._stopButton = toolbarContainer.querySelector('.device-stop-btn');
        this._softResetButton = toolbarContainer.querySelector('.device-soft-reset-btn');
        this._hardResetButton = toolbarContainer.querySelector('.device-hard-reset-btn');
    }

    /**
     * Set button enabled state and log only when it changes.
     * @private
     * @param {HTMLElement|null} button - Button element
     * @param {string} name - Logical button name for logs
     * @param {boolean} enabled - Whether button should be enabled
     */
    _setButtonEnabled(button: HTMLButtonElement | null, name: ToolbarControlButtonName, enabled: boolean): void {
        if (!button) {
            return;
        }

        const disabled = !enabled;
        button.disabled = disabled;

        if (this._buttonEnabledState[name] !== enabled) {
            this._buttonEnabledState[name] = enabled;
            this._log('button-enabled-changed', 'info', { button: name, enabled });
        }
    }

    /**
     * Subscribe to DeviceConnection events
     * @private
     */
    _subscribeToDeviceEvents(): void {
        if (this._deviceListeners.size > 0) {
            this._log('already-subscribed-to-device-events');
            return;
        }

        const onStateChange = (event: CustomEvent<unknown>) => {
            this._onConnectionStateChanged(event.detail as ConnectionStateChangeDetail | undefined);
        };
        this._deviceConnection.addEventListener('statechange', onStateChange);
        this._deviceListeners.set('statechange', onStateChange);

        const onMessage = (event: CustomEvent<unknown>) => {
            this._onDeviceMessage(event.detail as DeviceMessageDetail);
        };
        this._deviceConnection.addEventListener('message', onMessage);
        this._deviceListeners.set('message', onMessage);

        const onProgress = (event: CustomEvent<unknown>) => {
            this._onTransferProgress(event.detail as FileTransferProgressDetail);
        };
        this._deviceConnection.addEventListener('file-transfer-progress', onProgress);
        this._deviceListeners.set('file-transfer-progress', onProgress);

        const onComplete = (event: CustomEvent<unknown>) => {
            this._onTransferComplete(event.detail as FileTransferCompleteDetail);
        };
        this._deviceConnection.addEventListener('file-transfer-complete', onComplete);
        this._deviceListeners.set('file-transfer-complete', onComplete);

        const onError = (event: CustomEvent<unknown>) => {
            this._onDeviceError(event.detail as DeviceErrorDetail);
        };
        this._deviceConnection.addEventListener('error', onError);
        this._deviceListeners.set('error', onError);

        const onExecutionStarted = (event: CustomEvent<unknown>) => {
            this._syncExecutionStateFromDeviceConnection();
            this._updateControlStates();
            this._log('execution-started', event.detail);
        };
        this._deviceConnection.addEventListener('execution-started', onExecutionStarted);
        this._deviceListeners.set('execution-started', onExecutionStarted);

        const onExecutionStopped = (event: CustomEvent<unknown>) => {
            this._syncExecutionStateFromDeviceConnection();
            this._updateControlStates();
            this._log('execution-stopped', event.detail);
        };
        this._deviceConnection.addEventListener('execution-stopped', onExecutionStopped);
        this._deviceListeners.set('execution-stopped', onExecutionStopped);

        const onRawReplEntered = (event: CustomEvent<unknown>) => {
            this._log('raw-repl-entered', event.detail);
        };
        this._deviceConnection.addEventListener('raw-repl-entered', onRawReplEntered);
        this._deviceListeners.set('raw-repl-entered', onRawReplEntered);

        const onRawReplExited = (event: CustomEvent<unknown>) => {
            this._log('raw-repl-exited', event.detail);
        };
        this._deviceConnection.addEventListener('raw-repl-exited', onRawReplExited);
        this._deviceListeners.set('raw-repl-exited', onRawReplExited);
    }

    /**
     * Sync view state with the current device connection state.
     * @private
     */
    _syncConnectionState(): void {
        const state = this._deviceConnection.getState();
        const provider = this._deviceConnection.getActiveProviderKey();

        this._log('sync-connection-state', { state, provider });

        this._connectionState = state;
        this._syncExecutionStateFromDeviceConnection();
        this._updateControlStates();
    }

    /**
     * Hook invoked by TabbedView when this view becomes visible/hidden.
     *
     * The hook stays because the tabbed host calls it, but the Device tab no
     * longer scans ports: the connection dialog owns the port list, and this view
     * only reports what the connection does.
     * @param {boolean} visible - Whether the view is now visible
     */
    applyVisibilityState(visible: boolean): void {
        void visible;
    }

    /**
     * Handle play button (start execution)
     * @private
     */
    async _handlePlay(): Promise<void> {
        if (!this._isConnected()) {
            this._showErrorDialog(this.t('deviceConnection.errors.notConnected'));
            return;
        }

        try {
            await this._deviceConnection.startMain();
            this._logToConsole('system', this.t('deviceConnection.executionStarted'));
        } catch (error) {
            this._log('play-failed', 'error', error);
            const errorMessage = (error as { message?: string })?.message;
            this._logToConsole('error', this.t('deviceConnection.playFailed', { error: errorMessage }));
            this._showErrorDialog(this.t('deviceConnection.errors.playFailed'), errorMessage);
        }
    }

    /**
     * Handle stop button (stop execution)
     * @private
     */
    async _handleStop(): Promise<void> {
        if (!this._isConnected()) {
            return;
        }

        try {
            await this._deviceConnection.stopExecution();
            this._logToConsole('system', this.t('deviceConnection.executionStopped'));
        } catch (error) {
            this._log('stop-failed', 'error', error);
            const errorMessage = (error as { message?: string })?.message;
            this._logToConsole('error', this.t('deviceConnection.stopFailed', { error: errorMessage }));
            this._showErrorDialog(this.t('deviceConnection.errors.stopFailed'), errorMessage);
        }
    }

    /**
     * Handle soft reset button
     * @private
     */
    async _handleSoftReset(): Promise<void> {
        if (!this._isConnected()) {
            return;
        }

        try {
            await this._deviceConnection.softReset();
            this._logToConsole('system', this.t('deviceConnection.softResetComplete'));

            this._syncExecutionStateFromDeviceConnection();
            this._updateControlStates();
        } catch (error) {
            this._log('soft-reset-failed', 'error', error);
            const errorMessage = (error as { message?: string })?.message;
            this._logToConsole('error', this.t('deviceConnection.softResetFailed', { error: errorMessage }));
            this._showErrorDialog(this.t('deviceConnection.errors.softResetFailed'), errorMessage);
        }
    }

    /**
     * Handle hard reset button
     * @private
     */
    async _handleHardReset(): Promise<void> {
        if (!this._isConnected()) {
            return;
        }

        if (this._viewManager) {
            const viewManager = this._viewManager as unknown as DeviceConnectionViewManagerLike;
            const confirmed = await viewManager.showConfirmation({
                title: this.t('deviceConnection.confirmHardReset.title'),
                message: this.t('deviceConnection.confirmHardReset.message'),
                confirmLabel: this.t('deviceConnection.confirmHardReset.confirm'),
                cancelLabel: this.t('deviceConnection.confirmHardReset.cancel'),
            });

            if (!confirmed) {
                return;
            }
        }

        try {
            await this._deviceConnection.hardReset();
            this._logToConsole('system', this.t('deviceConnection.hardResetComplete'));
            this._logToConsole('system', this.t('deviceConnection.hardResetReconnectRequired'));

            this._syncExecutionStateFromDeviceConnection();
            this._updateControlStates();
        } catch (error) {
            this._log('hard-reset-failed', 'error', error);
            const errorMessage = (error as { message?: string })?.message;
            this._logToConsole('error', this.t('deviceConnection.hardResetFailed', { error: errorMessage }));
            this._showErrorDialog(this.t('deviceConnection.errors.hardResetFailed'), errorMessage);
        }
    }

    /**
     * Handle connection state change event
     *
     * A transition into `connecting` marks the start of a new device session:
     * the console log is cleared and the connecting notice is written, so the
     * log never shows messages of a previous session. Every connect path (the
     * title-bar badge, the deployment view, a custom view action) passes here.
     * @private
     * @param {Object} detail - Event detail { state, previousState }
     */
    _onConnectionStateChanged(detail?: ConnectionStateChangeDetail): void {
        const stateFromEvent = detail?.state;
        const state = stateFromEvent ?? this._deviceConnection.getState();
        const previousState = detail?.previousState;
        const provider = this._deviceConnection.getActiveProviderKey();

        this._connectionState = state;

        this._syncExecutionStateFromDeviceConnection();

        if (state === 'disconnected') {
            this._setLoadingState(false);
        }

        this._updateControlStates();

        if (state === 'connecting' && previousState !== 'connecting') {
            this.clearLog();
            this._logToConsole('system', this.t('deviceConnection.connecting'));
        } else if (state === 'connected') {
            this._logToConsole('system', this.t('deviceConnection.connected', { provider }));
        } else if (state === 'disconnected') {
            this._logToConsole('system', this.t('deviceConnection.disconnected'));

            this._destroyCustomRuntimeView();
            this._updateControlStates();
        }
    }

    /**
     * Destroy custom runtime view and remove from split view
     * @private
     */
    _destroyCustomRuntimeView(): void {
        if (this._customRuntimeCollapsible && this._splitView) {
            this._log('destroying-custom-runtime-view');

            this._customRuntimeCollapsible.detach();
            this._customRuntimeCollapsible = null;
            this._customRuntimeView = null;

            this._splitView.setViews(this._getSplitPaneViews());

            this._syncToolbarButtonReferences();

            this._log('custom-runtime-view-destroyed');
        }
    }

    /**
     * Handle device message event
     * @private
     * @param {Object} detail - Event detail { type, message, timestamp }
     */
    _onDeviceMessage(detail: DeviceMessageDetail): void {
        const { type, message, timestamp } = detail;

        if (type === 'raw') {
            if (this._isProtocolNoise(message)) {
                return;
            }
        }

        void timestamp;
        this._consoleView?.addMessage(type, message);
    }

    /**
     * Check if message is protocol noise that should be filtered from console
     * @private
     * @param {string} message - Message to check
     * @returns {boolean} True if message is protocol noise
     */
    _isProtocolNoise(message: string): boolean {
        const trimmed = message.trim();

        if (!trimmed) {
            return true;
        }

        const protocolPatterns = [
            />OK(?:OK)?/i,
            /raw REPL; CTRL-B to exit/i,
            />>>/,
            /\.\.\./,
            /^MicroPython v[\d.]+ on .+/i,
            /^Type "help\(\)" for more information\./i,
            /MPY: soft reboot/i,
            /WebREPL is not configured/i,
            /\[MicroPython\] Boot complete/i,
            /^b'.*'$/s,
            /^b".*"$/s,
        ];

        const fullMessagePatterns = [/^>$/, /^OK$/i];

        for (const pattern of fullMessagePatterns) {
            if (pattern.test(trimmed)) {
                return true;
            }
        }

        const hasKeyboardInterrupt = message.includes('KeyboardInterrupt');
        const hasTraceback = message.includes('Traceback (most recent call last)');

        if (hasKeyboardInterrupt && hasTraceback) {
            if (message.includes('asyncio/core.py') || message.includes('File "main.py"')) {
                return true;
            }
        }

        let protocolNoiseCount = 0;
        for (const pattern of protocolPatterns) {
            const matches = trimmed.match(new RegExp(pattern, 'g'));
            if (matches) {
                protocolNoiseCount += matches.reduce((sum, match) => sum + match.length, 0);
            }
        }

        if (protocolNoiseCount > trimmed.length * 0.5) {
            return true;
        }

        return protocolPatterns.some((pattern) => pattern.test(trimmed));
    }

    /**
     * Handle file transfer progress event
     * @private
     * @param {Object} detail - Progress detail
     */
    _onTransferProgress(detail: FileTransferProgressDetail): void {
        const { operation, filename, progress, bytesTransferred, totalBytes } = detail;

        const percent = Math.round(progress * 100);
        const transferred = this._formatBytes(bytesTransferred);
        const total = this._formatBytes(totalBytes);

        const message = this.t('deviceConnection.transferProgress', {
            operation,
            filename,
            percent,
            transferred,
            total,
        });

        this._consoleView.addMessage('system', message);
    }

    /**
     * Handle file transfer complete event
     * @private
     * @param {Object} detail - Completion detail
     */
    _onTransferComplete(detail: FileTransferCompleteDetail): void {
        const { operation, filename, bytesTransferred, duration } = detail;

        const transferred = this._formatBytes(bytesTransferred);
        const seconds = (duration / 1000).toFixed(2);

        const message = this.t('deviceConnection.transferComplete', {
            operation,
            filename,
            transferred,
            seconds,
        });

        this._consoleView.addMessage('system', message);
    }

    /**
     * Handle device error event
     * @private
     * @param {Object} detail - Error detail { error, context, critical }
     */
    _onDeviceError(detail: DeviceErrorDetail): void {
        const { error, context } = detail;

        const message = context
            ? this.t('deviceConnection.errorWithContext', { error: error.message, context })
            : this.t('deviceConnection.error', { error: error.message });

        this._consoleView.addMessage('error', message);

        if (detail.critical) {
            this._showErrorDialog(this.t('deviceConnection.errors.critical'), error.message);
        }
    }

    /**
     * Update the runtime control states from the live connection state.
     *
     * Play / Stop / the reset actions are the only controls this view owns; the
     * connect and disconnect actions moved to the title-bar badge and the
     * connection dialog (M4t).
     * @private
     */
    _updateControlStates(): void {
        if (!this._connectionToolbarView) return;

        this._syncToolbarButtonReferences();

        const liveConnectionState = this._deviceConnection?.getState?.() || this._connectionState;
        this._connectionState = liveConnectionState;

        this._syncExecutionStateFromDeviceConnection();

        const isConnected = this._isConnected();
        const isExecuting = this._deviceState.isExecuting;

        this._setButtonEnabled(this._playButton, 'play', isConnected && !isExecuting);
        this._setButtonEnabled(this._stopButton, 'stop', isConnected && isExecuting);
        this._setButtonEnabled(this._softResetButton, 'softReset', isConnected);
        this._setButtonEnabled(this._hardResetButton, 'hardReset', isConnected);
    }

    _syncExecutionStateFromDeviceConnection(): void {
        const liveConnectionState = this._deviceConnection?.getState?.() || this._connectionState;
        const disconnected = liveConnectionState === 'disconnected';
        const hasExecutionGetter = typeof this._deviceConnection?.isExecutionRunning === 'function';

        const isExecuting =
            !disconnected && hasExecutionGetter
                ? Boolean(this._deviceConnection.isExecutionRunning?.())
                                : disconnected
                                    ? false
                                    : this._deviceState.isExecuting;

        this._deviceState = this._deviceState.update({ isExecuting });
    }

    /**
     * Update toolbar labels (for i18n language change)
     * @private
     */
    _updateToolbarLabels(): void {
        const toolbarTitle = this.t('deviceConnection.connectionToolbar');
        if (this._connectionToolbarCollapsible) {
            this._connectionToolbarCollapsible.headerTitle = toolbarTitle;
            this._connectionToolbarCollapsible.title = toolbarTitle;
        }

        const consoleTitle = this.t('deviceConnection.deviceLog');
        if (this._consoleCollapsible) {
            this._consoleCollapsible.headerTitle = consoleTitle;
            this._consoleCollapsible.title = consoleTitle;
        }

        if (this._customRuntimeCollapsible) {
            const runtimeTitle = this._resolveCustomViewTitle(
                this._deviceConnection?.getCustomViewData() ?? null
            );
            this._customRuntimeCollapsible.headerTitle = runtimeTitle;
            this._customRuntimeCollapsible.title = runtimeTitle;
            if (this._customRuntimeView) {
                this._customRuntimeView.title = runtimeTitle;
            }
        }

        if (!this._connectionToolbarView) return;

        this._connectionToolbarView.clearControls();
        this._createConnectionToolbarControls();

        this._updateControlStates();
    }

    /**
     * Log message to console view
     * @private
     * @param {string} type - Message type
     * @param {string} message - Message text
     */
    _logToConsole(type: string, message: string): void {
        if (!this._consoleView) return;
        this._consoleView.addMessage(type, message);
    }

    /**
     * Format bytes for display
     * @private
     * @param {number} bytes - Byte count
     * @returns {string} Formatted string (e.g., "1.2 KB")
     */
    _formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    /**
     * Show error dialog
     * @private
     * @param {string} title - Dialog title
     * @param {string} [message] - Optional detailed message
     */
    async _showErrorDialog(title: string, message?: string): Promise<void> {
        if (!this._viewManager) {
            this._log('show-error-dialog-missing-view-manager', 'error', { title, message });
            return;
        }

        const viewManager = this._viewManager as unknown as DeviceConnectionViewManagerLike;
        await viewManager.showError({
            title,
            message: message || '',
        });
    }
}
