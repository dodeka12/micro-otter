import { OverlayWindow } from './overlay-window.js';
import { TextDialogView } from './text-dialog-view.js';
import { ConfirmationDialogView } from './confirmation-dialog-view.js';
import { ErrorDialogView } from './error-dialog-view.js';
import { FormDialogView } from './form-dialog-view.js';
import { ViewBase } from './view-base.js';
import { ViewFactory } from './view-factory.js';
import { ViewStore } from '../data/view-store.js';
import { ViewThemeRegistry } from './view-theme-registry.js';
import { I18nService } from '../i18n/i18n-service.js';
import { AppEvent, assertAppEventPayloadType } from '../core/app-event.js';

type ViewManagerLogger = (message: string, payload?: unknown) => void;

type ViewManagerOptions = {
    mount?: HTMLElement | null;
    viewFactory?: ViewFactory | null;
    viewStore?: ViewStore | null;
    logger?: ViewManagerLogger | null;
    logEvents?: boolean;
    theme?: string;
    themeRegistry?: ViewThemeRegistry | null;
    i18nService?: I18nService | null;
};

type ViewManagerContextUpdate = {
    workspace?: unknown;
    viewManager?: unknown;
    deviceRuntime?: unknown;
    runtimeCollection?: unknown;
    workspaceConfig?: unknown;
    collectionManager?: unknown;
    transpiler?: unknown;
    deviceConnection?: unknown;
    deviceDeployment?: unknown;
};

type ViewFactoryContextFields = {
    _workspace?: unknown;
    _viewManager?: unknown;
    _deviceRuntime?: unknown;
    _runtimeCollection?: unknown;
    _workspaceConfig?: unknown;
    _collectionManager?: unknown;
    _transpiler?: unknown;
    _deviceConnection?: unknown;
    _deviceDeployment?: unknown;
};

type OverlayTarget = OverlayWindow | ViewBase;
type OverlayTargetSelector = OverlayWindow | number | null;
type OverlayCreateOptions = { logger?: ViewManagerLogger | null; [key: string]: unknown };
type ModalContent = ViewBase | HTMLElement | unknown;
type ModalOptions = { scrim?: boolean };
type Unsubscribe = (() => void) | void;

/** Answer of a confirmation dialog that may carry an optional checkbox. */
type ConfirmationDialogResult = {
    confirmed: boolean;
    checkboxChecked: boolean;
};

type ModalEventSource = {
    on: (eventName: string, handler: (event: AppEvent) => void) => unknown;
};

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

/**
 * Manages three layered containers (root, overlay, modal) and coordinates view attachment,
 * overlay hosting, modal display, layout persistence, and theme-aware stylesheet swapping.
 * Event handling:
 * - Wires view tree lifecycle events (attach, afterAttach, beforeDetach, detach, resize, focus)
 *   for logging when enabled.
 * - Wires overlay events (attach, detach, focus, minimize, restore, move, resize, close) for logging.
 * - Exposes a theme EventTarget (`themeEvents`) that listens for `set-theme` and emits `themechange`
 *   with `{ theme }` detail after applying styles.
 *
 * Usage:
 * ```js
 * import { ViewManager } from './view-manager.js';
 * import { SplitView } from './split-view.js';
 *
 * const rootEl = document.getElementById('view-root');
 * const manager = new ViewManager({ mount: rootEl, logEvents: true });
 * const rootView = new SplitView({ views: [...] });
 * manager.attachRoot(rootView);
 * manager.addOverlay(new TextView({ text: 'Overlay' }));
 * await manager.saveLayout('demo');
 * ```
 */
export class ViewManager {
    _logger: ViewManagerLogger | null;
    _i18nService: I18nService;
    _viewFactory: ViewFactory;
    _viewStore: ViewStore | null;
    _themeRegistry: ViewThemeRegistry;
    _themeEvents: EventTarget;
    _rootView: ViewBase | null;
    _overlays: Set<OverlayWindow>;
    _modalView: ViewBase | null;
    _modalCleanup: (() => void) | null;
    _logEvents: boolean;
    _logUnsubs: Map<object, Unsubscribe[]>;
    _loggedViews: WeakSet<object>;

    _rootElement: HTMLElement;
    _rootLayer: HTMLDivElement;
    _overlayLayer: HTMLDivElement;
    _modalHost: HTMLDivElement;
    _modalLayer: HTMLDivElement;
    _modalScrim: HTMLDivElement;

    /**
     * @param {object} [options]
     * @param {HTMLElement|null} [options.mount=null] Root element to own layers; created if omitted.
     * @param {ViewFactory|null} [options.viewFactory=null] Factory used for deserialization.
     * @param {ViewStore|null} [options.viewStore=null] Store used for save/load helpers.
     * @param {Function|null} [options.logger=null] Logger sink; defaults to console.
     * @param {boolean} [options.logEvents=false] When true, wires verbose lifecycle logging.
     * @param {string} [options.theme='standard'] Theme identifier; also drives stylesheet swapping.
     * @param {ViewThemeRegistry|null} [options.themeRegistry=null] Theme registry to delegate theme loading and switching.
     * @param {I18nService|null} [options.i18nService=null] I18n service for translations; created if omitted.
     */
    constructor({
        mount = null,
        viewFactory = null,
        viewStore = null,
        logger = null, // Deprecated: kept for backward compatibility
        logEvents = false,
        theme = 'standard',
        themeRegistry = null,
        i18nService = null,
    }: ViewManagerOptions = {}) {
        this._logger = logger;
        this._i18nService = i18nService || new I18nService({ logger: this._logger });
        this._viewFactory =
            viewFactory ||
            new ViewFactory({ i18nService: this._i18nService, logger: this._logger });
        this._viewStore = viewStore || this.#tryCreateStore();
        this._themeRegistry =
            themeRegistry ||
            new ViewThemeRegistry({ defaultTheme: 'standard', logger: this._logger });
        const initialTheme = typeof theme === 'string' && theme.trim() ? theme.trim() : null;
        this._themeRegistry.setTheme(initialTheme || this._themeRegistry.currentTheme);
        this._themeEvents = this._themeRegistry.events;
        // Attempt to load the manifest; fall back silently if unavailable.
        this._themeRegistry
            .load()
            .then(() => {
                this._themeRegistry.setTheme(initialTheme || this._themeRegistry.currentTheme);
            })
            .catch((error) => this.#log('theme-registry-load-failed', error?.message || error));
        // Load i18n manifest on startup (i18nService already created above)
        this._i18nService
            .load()
            .then(() => this.#log('i18n-loaded', { locale: this._i18nService.currentLocale }))
            .catch((error) => this.#log('i18n-load-failed', error?.message || error));
        this._rootView = null;
        this._overlays = new Set();
        this._modalView = null;
        this._modalCleanup = null;
        this._logEvents = Boolean(logEvents);
        this._logUnsubs = new Map();
        this._loggedViews = new WeakSet();

        this._rootElement = mount || document.createElement('div');
        this.#ensureLayers();
        if (this._logEvents) {
            this.#log('event-logging', { enabled: true });
        }
    }

    get rootElement(): HTMLElement {
        return this._rootElement;
    }

    get rootView(): ViewBase | null {
        return this._rootView;
    }

    get overlayLayer(): HTMLDivElement {
        return this._overlayLayer;
    }

    get rootLayer(): HTMLDivElement {
        return this._rootLayer;
    }

    get modalHost(): HTMLDivElement {
        return this._modalHost;
    }

    /**
     * The view currently occupying the modal layer, or `null` when it is empty.
     *
     * Public so callers can decide whether a click would replace an open dialog
     * (for example the device badge skips a second connection dialog while one is
     * already on screen).
     */
    get modalView(): ViewBase | null {
        return this._modalView;
    }

    get modalLayer(): HTMLDivElement {
        return this._modalLayer;
    }

    get overlays(): OverlayWindow[] {
        return Array.from(this._overlays);
    }

    get viewFactory(): ViewFactory {
        return this._viewFactory;
    }

    get viewStore(): ViewStore | null {
        return this._viewStore;
    }

    get theme(): string | null {
        return this._themeRegistry?.currentTheme ?? null;
    }

    get themeEvents(): EventTarget {
        return this._themeEvents;
    }

    /**
     * Return available themes from the active theme registry.
     * @returns {Array<{id: string, label: string, description: string}>}
     */
    getAvailableThemes(): Array<{ id: string; label: string; description: string }> {
        return this._themeRegistry?.themes || [];
    }

    /**
     * Update the context passed to views during deserialization.
     * This allows external code (like Workspace) to provide dependencies
     * without accessing private members.
     * @param {object} context - Context properties to update
     * @param {object} [context.workspace] - Workspace instance
     * @param {object} [context.viewManager] - ViewManager instance reference
     * @param {object} [context.deviceRuntime] - Active DeviceRuntime instance
     * @param {object} [context.runtimeCollection] - DeviceRuntimeCollection instance
     * @param {object} [context.workspaceConfig] - WorkspaceConfig instance
     * @param {object} [context.collectionManager] - Collection manager facade
     * @param {object} [context.transpiler] - Transpiler instance
     * @param {object} [context.deviceConnection] - DeviceConnection instance
     * @param {object} [context.deviceDeployment] - DeviceDeployment instance
     */
    updateViewContext(context: ViewManagerContextUpdate = {}): void {
        const viewFactory = this._viewFactory as unknown as ViewFactoryContextFields;
        if (context.workspace !== undefined) {
            viewFactory._workspace = context.workspace;
        }
        if (context.viewManager !== undefined) {
            viewFactory._viewManager = context.viewManager;
        }
        if (context.deviceRuntime !== undefined) {
            viewFactory._deviceRuntime = context.deviceRuntime;
        }
        if (context.runtimeCollection !== undefined) {
            viewFactory._runtimeCollection = context.runtimeCollection;
        }
        if (context.workspaceConfig !== undefined) {
            viewFactory._workspaceConfig = context.workspaceConfig;
        }
        if (context.collectionManager !== undefined) {
            viewFactory._collectionManager = context.collectionManager;
        }
        if (context.transpiler !== undefined) {
            viewFactory._transpiler = context.transpiler;
        }
        if (context.deviceConnection !== undefined) {
            viewFactory._deviceConnection = context.deviceConnection;
        }
        if (context.deviceDeployment !== undefined) {
            viewFactory._deviceDeployment = context.deviceDeployment;
        }
    }

    get i18nService(): I18nService {
        return this._i18nService;
    }

    get i18nEvents(): EventTarget {
        return this._i18nService; // EventTarget
    }

    /**
     * Attach a root ViewBase tree into the root layer, detaching any previous root.
     * @param {ViewBase} view
     * @returns {ViewBase}
     */
    attachRoot(view: ViewBase): ViewBase {
        if (!(view instanceof ViewBase)) {
            throw new Error('ViewManager.attachRoot requires a ViewBase-derived instance.');
        }
        if (this._logEvents && this._rootView) {
            this.#removeLoggingFor(this._rootView);
        }
        if (this._rootView) {
            this._rootView.detach();
        }
        this._rootView = view;
        view.attachTo(this._rootLayer);
        if (this._logEvents) {
            this.#wireViewTree(view);
        }
        this.#log('root-attach', {
            rootLayerClient: {
                w: this._rootLayer?.clientWidth,
                h: this._rootLayer?.clientHeight,
            },
            rootElementClient: {
                w: this._rootElement?.clientWidth,
                h: this._rootElement?.clientHeight,
            },
        });
        return view;
    }

    /** Detach and clear the current root view. */
    clearRoot(): void {
        if (this._rootView) {
            this._rootView.detach();
            this._rootView = null;
        }
    }

    /**
     * Add an overlay. Accepts either an OverlayWindow instance or a ViewBase to host.
     * @param {OverlayWindow|ViewBase} target
     * @param {object} [options]
     * @returns {OverlayWindow}
     */
    addOverlay(target: OverlayTarget, options: OverlayCreateOptions = {}): OverlayWindow {
        const overlay =
            target instanceof OverlayWindow
                ? target
                : new OverlayWindow({
                      view: target,
                      ...options,
                      logger: options.logger ?? this._logger,
                  });
        overlay.attachTo(this._overlayLayer);
        this._overlays.add(overlay);
        if (this._logEvents) {
            this.#wireOverlayLogging(overlay);
        }
        overlay.on('close', (event) => {
            assertAppEventPayloadType(
                event,
                'OverlayWindow.Close.v1',
                'ViewManager.addOverlay close listener'
            );
            if (this._logEvents) {
                this.#removeLoggingFor(overlay);
            }
            this._overlays.delete(overlay);
        });
        return overlay;
    }

    /** Close a specific overlay by instance or index. */
    closeOverlay(target: OverlayTargetSelector = null): boolean {
        const overlay = this.#resolveOverlay(target);
        if (!overlay) {
            return false;
        }
        overlay.close();
        this._overlays.delete(overlay);
        return true;
    }

    /** Focus a specific overlay by instance or index. */
    focusOverlay(target: OverlayTargetSelector = null): OverlayWindow | null {
        const overlay = this.#resolveOverlay(target);
        if (!overlay) {
            return null;
        }
        overlay.focus();
        return overlay;
    }

    /** Close and clear all overlays. */
    clearOverlays(): void {
        Array.from(this._overlays).forEach((overlay) => overlay.close());
        this._overlays.clear();
    }

    /**
     * Enable or disable event logging after construction.
     * @param {boolean} [enabled=true] Whether verbose lifecycle logging should be active.
     */
    setEventLogging(enabled = true): void {
        const next = Boolean(enabled);
        if (next === this._logEvents) {
            return;
        }
        this._logEvents = next;
        if (!next) {
            this.#clearLogging();
            return;
        }
        this.#log('event-logging', { enabled: true });
        if (this._rootView) {
            this.#wireViewTree(this._rootView);
        }
        this._overlays.forEach((overlay) => this.#wireOverlayLogging(overlay));
    }

    /**
     * Update the active theme and swap linked stylesheets accordingly.
     * @param {string} theme Theme identifier matching folder names under ./styles.
     * @returns {string} The applied theme name.
     */
    setTheme(theme: string): string | null {
        if (!this._themeRegistry) {
            return null;
        }
        return this._themeRegistry.setTheme(theme);
    }

    /**
     * Apply stylesheets for the given theme via the registry.
     * @param {string} [theme=this.theme] Theme identifier to load.
     * @returns {string|null} The theme that was applied.
     */
    applyThemeStyles(theme: string | null = this.theme): string | null {
        if (!this._themeRegistry) {
            return null;
        }
        return this._themeRegistry.applyThemeStyles(theme);
    }

    /** Clamp all overlays to current bounds. */
    constrainOverlays(): void {
        this._overlays.forEach((overlay) => {
            if (typeof overlay.constrainToBounds === 'function') {
                overlay.constrainToBounds();
            }
        });
    }

    /**
     * Show content in the modal layer with optional scrim.
     * @param {ViewBase|HTMLElement|any} content
     * @param {object} [options]
     * @param {boolean} [options.scrim=true]
     * @returns {ViewBase|HTMLElement|null}
     */
    showModal(content: ModalContent, { scrim = true }: ModalOptions = {}): ViewBase | HTMLElement | null {
        this.clearModal();
        this._modalLayer.style.display = 'block';
        this._modalScrim.style.display = scrim ? 'block' : 'none';
        const watchClose = (view: ModalContent): (() => void) | null => {
            const source = view as ModalEventSource;
            if (!source || typeof source.on !== 'function') {
                return null;
            }
            const unsubs = ['close', 'cancel', 'confirm'].map((eventName) =>
                source.on(eventName, (event) => {
                    if (!(event instanceof AppEvent)) {
                        throw new TypeError(
                            `ViewManager.showModal ${eventName} listener: expected AppEvent instance`
                        );
                    }

                    const payloadTypeId = event.detail?.payloadTypeId;
                    if (!payloadTypeId || typeof payloadTypeId !== 'string') {
                        throw new TypeError(
                            `ViewManager.showModal ${eventName} listener: expected detail.payloadTypeId string`
                        );
                    }

                    this.clearModal();
                })
            );
            return () => unsubs.forEach((fn) => (typeof fn === 'function' ? fn() : null));
        };

        if (content instanceof ViewBase) {
            this._modalCleanup = watchClose(content);
            content.attachTo(this._modalHost);
            this._modalView = content;
            return content;
        }

        if (content instanceof HTMLElement) {
            this._modalHost.replaceChildren(content);
            return content;
        }

        if (content !== undefined && content !== null) {
            const wrapper = document.createElement('div');
            wrapper.textContent = String(content);
            this._modalHost.replaceChildren(wrapper);
            return wrapper;
        }

        this._modalHost.replaceChildren();
        return null;
    }

    /** Convenience helper to create and show a TextDialogView. */
    showModalDialog(target: TextDialogView | Record<string, unknown> = {}, options: ModalOptions = {}): TextDialogView {
        const dialog =
            target instanceof TextDialogView ? target : new TextDialogView({ ...target });
        const targetOptions = target instanceof TextDialogView ? null : target;
        const scrim =
            (targetOptions && typeof targetOptions.scrim === 'boolean'
                ? targetOptions.scrim
                : undefined) ??
            options.scrim ??
            true;
        this.showModal(dialog, { scrim });
        return dialog;
    }

    /**
     * Show a confirmation dialog and return a Promise that resolves based on user action.
     * @param {object} options Configuration for ConfirmationDialogView
     * @param {string} [options.title] Dialog title
     * @param {string} [options.message] Main message text
     * @param {string} [options.detail] Optional detailed explanation
     * @param {string} [options.icon] Icon for header
     * @param {string} [options.confirmLabel] Text for confirm button
     * @param {string} [options.cancelLabel] Text for cancel button
     * @param {boolean} [options.destructive=false] If true, styles confirm button as destructive
     * @param {boolean} [options.showCancel=true] If false, hides cancel button (auto-confirms on close)
     * @param {boolean} [options.scrim=true] Show modal scrim background
     * @returns {Promise<boolean>} Resolves to true if confirmed, false if cancelled
     * @example
     * const result = await manager.showConfirmation({
     *     title: 'Delete File',
     *     message: 'Are you sure you want to delete this file?',
     *     confirmLabel: 'Delete',
     *     cancelLabel: 'Cancel',
     *     destructive: true
     * });
     * if (result) {
     *     // User confirmed
     * }
     */
    showConfirmation(options: Record<string, unknown> = {}): Promise<boolean> {
        return this._openConfirmation(options).then((result) => result.confirmed);
    }

    /**
     * Show a confirmation dialog with an optional checkbox and report both answers.
     *
     * Useful when the confirmation carries an extra opt-in (for example "remember this
     * decision for this version"). Everything else behaves exactly like
     * {@link showConfirmation}.
     * @param {object} options Configuration for ConfirmationDialogView
     * @param {string} [options.title] Dialog title
     * @param {string} [options.message] Main message text
     * @param {string} [options.detail] Optional detailed explanation
     * @param {string} [options.confirmLabel] Text for confirm button
     * @param {string} [options.cancelLabel] Text for cancel button
     * @param {string} [options.checkboxLabel] Label of the optional checkbox (omitted when empty)
     * @param {boolean} [options.checkboxChecked=false] Initial checkbox state
     * @param {boolean} [options.destructive=false] If true, styles confirm button as destructive
     * @param {boolean} [options.showCancel=true] If false, hides cancel button
     * @param {boolean} [options.scrim=true] Show modal scrim background
     * @returns {Promise<{confirmed: boolean, checkboxChecked: boolean}>} Confirm answer plus the
     *          checkbox state at the moment the dialog was answered
     * @example
     * const { confirmed, checkboxChecked } = await manager.showConfirmationWithCheckbox({
     *     title: 'Upload override?',
     *     message: 'Host sources will replace the firmware copy.',
     *     checkboxLabel: 'Remember for this version',
     * });
     */
    showConfirmationWithCheckbox(
        options: Record<string, unknown> = {}
    ): Promise<ConfirmationDialogResult> {
        return this._openConfirmation(options);
    }

    /**
     * Create, wire up and show a confirmation dialog.
     * @private
     * @param {object} options Configuration forwarded to ConfirmationDialogView
     * @returns {Promise<{confirmed: boolean, checkboxChecked: boolean}>} Dialog answer
     */
    _openConfirmation(options: Record<string, unknown> = {}): Promise<ConfirmationDialogResult> {
        return new Promise((resolve) => {
            const dialog = new ConfirmationDialogView({
                ...options,
                i18nService: this.i18nService,
            });

            // Listen for confirmation
            dialog.on('confirm', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Confirm.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'ViewManager.showConfirmation confirm listener'
                );
                resolve({ confirmed: true, checkboxChecked: dialog.checkboxChecked });
            });

            // Listen for cancellation or close
            const handleCancel = (event: AppEvent) => {
                const expectedPayloadTypeId =
                    event?.name === 'cancel'
                        ? 'ModalDialogView.Cancel.v1'
                        : 'ModalDialogView.Close.v1';
                assertAppEventPayloadType(
                    event,
                    expectedPayloadTypeId,
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'ViewManager.showConfirmation cancel/close listener'
                );
                resolve({ confirmed: false, checkboxChecked: false });
            };
            dialog.on('cancel', handleCancel);
            dialog.on('close', handleCancel);

            // Show the dialog
            const scrim = asBoolean(options.scrim, true);
            this.showModal(dialog, { scrim });
        });
    }

    /**
     * Show an informational dialog and return a Promise that resolves when dismissed.
     * @param {object} options Configuration for TextDialogView
     * @param {string} [options.title='Information'] Dialog title
     * @param {string} [options.message=''] Main informational message
     * @param {string} [options.icon='ℹ️'] Icon for header
     * @param {string} [options.confirmLabel] Text for OK button (overrides i18n)
     * @param {boolean} [options.scrim=true] Show modal scrim background
     * @returns {Promise<void>} Resolves when dialog is dismissed
     * @example
     * await manager.showInfo({
     *     title: 'No Runtime Installed',
     *     message: 'Please install the Micro-Otter runtime before deploying.',
     * });
     * // User dismissed the info dialog
     */
    showInfo(options: Record<string, unknown> = {}): Promise<void> {
        return new Promise((resolve) => {
            const dialog = new TextDialogView({
                title: asOptionalString(options.title) || 'Information',
                message: asOptionalString(options.message) || '',
                icon: asOptionalString(options.icon) || 'ℹ️',
                confirmLabel: asOptionalString(options.confirmLabel),
                showCancel: false, // Info dialogs only have OK button
                i18nService: this.i18nService,
            });

            // Listen for close/confirm (info dialogs only have OK button)
            const handleClose = (event: AppEvent) => {
                const expectedPayloadTypeId =
                    event?.name === 'confirm'
                        ? 'ModalDialogView.Confirm.v1'
                        : 'ModalDialogView.Close.v1';
                assertAppEventPayloadType(
                    event,
                    expectedPayloadTypeId,
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'ViewManager.showInfo close/confirm listener'
                );
                resolve();
            };
            dialog.on('close', handleClose);
            dialog.on('confirm', handleClose);

            // Show the dialog
            const scrim = asBoolean(options.scrim, true);
            this.showModal(dialog, { scrim });
        });
    }

    /**
     * Show an error dialog and return a Promise that resolves when dismissed.
     * @param {object} options Configuration for ErrorDialogView
     * @param {string} [options.title='Error'] Dialog title
     * @param {string} [options.message=''] Main error message
     * @param {string|null} [options.detail=null] Optional detailed error information
     * @param {boolean} [options.detailCollapsible=true] Allow details to be collapsed/expanded
     * @param {string} [options.icon='❌'] Icon for header
     * @param {string} [options.confirmLabel] Text for OK button (overrides i18n)
     * @param {boolean} [options.scrim=true] Show modal scrim background
     * @returns {Promise<void>} Resolves when dialog is dismissed
     * @example
     * await manager.showError({
     *     title: 'Connection Failed',
     *     message: 'Could not connect to device.',
     *     detail: error.stack
     * });
     * // User dismissed the error
     */
    showError(options: Record<string, unknown> = {}): Promise<void> {
        return new Promise((resolve) => {
            const dialog = new ErrorDialogView({
                ...options,
                i18nService: this.i18nService,
            });

            // Listen for close/confirm (error dialogs only have OK button)
            const handleClose = (event: AppEvent) => {
                const expectedPayloadTypeId =
                    event?.name === 'confirm'
                        ? 'ModalDialogView.Confirm.v1'
                        : 'ModalDialogView.Close.v1';
                assertAppEventPayloadType(
                    event,
                    expectedPayloadTypeId,
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'ViewManager.showError close/confirm listener'
                );
                resolve();
            };
            dialog.on('close', handleClose);
            dialog.on('confirm', handleClose);

            // Show the dialog
            const scrim = asBoolean(options.scrim, true);
            this.showModal(dialog, { scrim });
        });
    }

    /**
     * Show a form dialog and return a Promise that resolves with form data and confirmation status.
     * @param {object} options Configuration for FormDialogView
     * @param {string} [options.title='Form'] Dialog title
     * @param {string|null} [options.message=null] Optional message above form
     * @param {Array<object>} [options.fields=[]] Form field definitions
     * @param {string} [options.icon='📝'] Icon for header
     * @param {string} [options.confirmLabel] Text for confirm button (overrides i18n)
     * @param {string} [options.cancelLabel] Text for cancel button (overrides i18n)
     * @param {boolean} [options.scrim=true] Show modal scrim background
     * @returns {Promise<{confirmed: boolean, formData: object|null}>} Resolves with confirmation status and form data
     * @example
     * const result = await manager.showFormDialog({
     *     title: 'Create Item',
     *     message: 'Enter item details',
     *     fields: [
     *         { id: 'name', type: 'text', label: 'Name', required: true },
     *         { id: 'type', type: 'dropdown', label: 'Type', options: ['A', 'B'], required: true }
     *     ]
     * });
     * if (result.confirmed) {
    *     logger.info('Form data', result.formData);
     * }
     */
    showFormDialog(options: Record<string, unknown> = {}): Promise<{ confirmed: boolean; formData: unknown }> {
        return new Promise((resolve) => {
            const dialog = new FormDialogView({
                ...options,
                i18nService: this.i18nService,
            });

            let resolved = false;

            // Listen for confirmation
            dialog.on('confirm', (event) => {
                const validated = assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Confirm.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'ViewManager.showFormDialog confirm listener'
                );

                if (resolved) {
                    console.warn('[ViewManager.showFormDialog] Already resolved, ignoring confirm');
                    return;
                }
                resolved = true;
                const formData = validated.detail.formData || null;
                resolve({ confirmed: true, formData });
            });

            // Listen for cancellation
            dialog.on('cancel', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Cancel.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'ViewManager.showFormDialog cancel listener'
                );

                if (resolved) {
                    console.warn('[ViewManager.showFormDialog] Already resolved, ignoring cancel');
                    return;
                }
                resolved = true;
                resolve({ confirmed: false, formData: null });
            });

            // Listen for close without confirm/cancel (e.g., ESC key)
            dialog.on('close', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'ViewManager.showFormDialog close listener'
                );

                if (resolved) {
                    console.warn('[ViewManager.showFormDialog] Already resolved, ignoring close');
                    return;
                }
                resolved = true;
                // If close event has no explicit reason, treat as cancel
                resolve({ confirmed: false, formData: null });
            });

            // Show the dialog
            const scrim = asBoolean(options.scrim, true);
            this.showModal(dialog, { scrim });
        });
    }

    /** Clear any modal content and hide the modal layer. */
    clearModal(): void {
        if (typeof this._modalCleanup === 'function') {
            this._modalCleanup();
            this._modalCleanup = null;
        }
        if (this._modalView) {
            this._modalView.detach();
            this._modalView = null;
        }
        this._modalHost.replaceChildren();
        this._modalLayer.style.display = 'none';
    }

    /** Serialize the current root view tree (or null if none). */
    serialize(): Record<string, unknown> | null {
        if (this._rootView && typeof this._rootView.serialize === 'function') {
            return asRecord(this._rootView.serialize());
        }
        return null;
    }

    /**
     * Rehydrate and attach a root view from serialized data.
     * @param {object|null} data Serialized payload produced by serialize().
     * @returns {ViewBase|null}
     */
    deserialize(data: Record<string, unknown> | null): ViewBase | null {
        if (!data) {
            return null;
        }
        const view = this._viewFactory.create(data);
        return this.attachRoot(view);
    }

    /** Persist the current layout via ViewStore. */
    async saveLayout(id = 'view-root', metadata: Record<string, unknown> | undefined = undefined): Promise<unknown | null> {
        if (!this._viewStore) {
            return null;
        }
        const payload = this.serialize();
        if (!payload) {
            return null;
        }
        const meta: Record<string, unknown> = {};
        if (metadata && typeof metadata === 'object') {
            Object.assign(meta, metadata);
        }
        meta.theme = this.theme;
        return this._viewStore.saveLayout(id, payload, meta);
    }

    /** Load and attach a layout via ViewStore. */
    async loadLayout(id = 'view-root'): Promise<ViewBase | null> {
        if (!this._viewStore) {
            return null;
        }
        const record = await this._viewStore.getLayout(id);
        if (!record || !record.payload) {
            return null;
        }
        if (record.metadata && typeof record.metadata === 'object') {
            const theme = (record.metadata as Record<string, unknown>).theme;
            if (typeof theme === 'string') {
                this.setTheme(theme);
            }
        }
        return this.deserialize(record.payload);
    }

    /** Delete a stored layout via ViewStore. */
    async deleteLayout(id = 'view-root'): Promise<boolean> {
        if (!this._viewStore) {
            return false;
        }
        await this._viewStore.deleteLayout(id);
        return true;
    }

    #ensureLayers(): void {
        const root = this._rootElement;
        // Apply strong inline sizing so the manager is stable even before CSS loads.
        root.style.position = root.style.position || 'relative';
        root.style.width = root.style.width || '100vw';
        root.style.height = root.style.height || '100vh';
        root.style.minWidth = root.style.minWidth || '100vw';
        root.style.minHeight = root.style.minHeight || '100vh';
        root.classList.add('view-manager');

        this.#log('root-size-after', {
            styleWidth: root.style.width,
            styleHeight: root.style.height,
            clientWidth: root.clientWidth,
            clientHeight: root.clientHeight,
        });

        this._rootLayer = document.createElement('div');
        this._rootLayer.className = 'view-manager__layer view-manager__layer--root';
        this._rootLayer.style.position = 'absolute';
        this._rootLayer.style.inset = '0';
        this._rootLayer.style.display = 'flex';
        this._rootLayer.style.flexDirection = 'column';
        this._rootLayer.style.width = '100%';
        this._rootLayer.style.height = '100%';
        this._rootLayer.style.minWidth = '100%';
        this._rootLayer.style.minHeight = '100%';

        this._overlayLayer = document.createElement('div');
        this._overlayLayer.className = 'view-manager__layer view-manager__layer--overlay';
        this._overlayLayer.style.position = 'absolute';
        this._overlayLayer.style.inset = '0';
        this._overlayLayer.style.overflow = 'hidden';
        this._overlayLayer.style.zIndex = '10';
        this._overlayLayer.style.width = '100%';
        this._overlayLayer.style.height = '100%';

        this._modalLayer = document.createElement('div');
        this._modalLayer.className = 'view-manager__layer view-manager__layer--modal';
        this._modalLayer.style.position = 'absolute';
        this._modalLayer.style.inset = '0';
        this._modalLayer.style.display = 'none';
        this._modalLayer.style.zIndex = '20';
        this._modalLayer.style.width = '100%';
        this._modalLayer.style.height = '100%';

        this._modalScrim = document.createElement('div');
        this._modalScrim.className = 'view-manager__modal-scrim';
        this._modalScrim.style.position = 'absolute';
        this._modalScrim.style.inset = '0';
        this._modalScrim.style.background = 'rgba(0, 0, 0, 0.25)';

        this._modalHost = document.createElement('div');
        this._modalHost.className = 'view-manager__modal-host';
        this._modalHost.style.position = 'relative';
        this._modalHost.style.width = '100%';
        this._modalHost.style.height = '100%';
        this._modalHost.style.display = 'flex';
        this._modalHost.style.alignItems = 'center';
        this._modalHost.style.justifyContent = 'center';

        this._modalLayer.replaceChildren(this._modalScrim, this._modalHost);
        root.replaceChildren(this._rootLayer, this._overlayLayer, this._modalLayer);

        this.#log('layers-size', {
            rootClient: { w: root.clientWidth, h: root.clientHeight },
            rootLayerClient: { w: this._rootLayer.clientWidth, h: this._rootLayer.clientHeight },
            overlayClient: {
                w: this._overlayLayer.clientWidth,
                h: this._overlayLayer.clientHeight,
            },
            modalClient: { w: this._modalLayer.clientWidth, h: this._modalLayer.clientHeight },
        });
    }

    #wireViewTree(view: ViewBase, label: string | null = null): void {
        if (!view || this._loggedViews.has(view)) {
            return;
        }
        const meta = typeof view.getMetadata === 'function' ? view.getMetadata() : null;
        const derivedLabel = label || `${view.constructor.name}:${meta?.id || view.id || 'view'}`;
        const events = ['attach', 'afterAttach', 'beforeDetach', 'detach', 'resize', 'focus'];
        const unsubs = events.map((event) =>
            view.on(event, (payload) => this.#log(`view:${derivedLabel}:${event}`, payload))
        );
        this._logUnsubs.set(view, unsubs);
        this._loggedViews.add(view);

        const childViews = (view as unknown as { views?: unknown[] }).views;
        if (Array.isArray(childViews)) {
            childViews.forEach((child, index) =>
                child instanceof ViewBase &&
                this.#wireViewTree(child, `${derivedLabel}[${index}]`)
            );
        }
    }

    #wireOverlayLogging(overlay: OverlayWindow): void {
        if (!overlay) {
            return;
        }
        const label = `overlay:${overlay?.view?.title || overlay?.title || 'overlay'}`;
        const events = [
            'attach',
            'detach',
            'focus',
            'minimize',
            'restore',
            'move',
            'resize',
            'close',
        ];
        const unsubs = events.map((event) =>
            overlay.on(event, (payload) => this.#log(`${label}:${event}`, payload))
        );
        this._logUnsubs.set(overlay, unsubs);
    }

    #removeLoggingFor(target: { views?: ViewBase[] } | object | null): void {
        if (!target) {
            return;
        }
        const unsubs = this._logUnsubs.get(target) || [];
        unsubs.forEach((fn) => {
            if (typeof fn === 'function') {
                fn();
            }
        });
        this._logUnsubs.delete(target);
        this._loggedViews.delete(target);

        const childViews = (target as { views?: unknown[] }).views;
        if (Array.isArray(childViews)) {
            childViews.forEach((child) => this.#removeLoggingFor(child as object));
        }
    }

    #clearLogging(): void {
        for (const [, unsubs] of this._logUnsubs.entries()) {
            unsubs.forEach((fn) => {
                if (typeof fn === 'function') {
                    fn();
                }
            });
        }
        this._logUnsubs.clear();
        this._loggedViews = new WeakSet();
    }

    #resolveOverlay(target: OverlayTargetSelector): OverlayWindow | null {
        if (!target) {
            return this.overlays[this.overlays.length - 1] || null;
        }
        if (target instanceof OverlayWindow) {
            return target;
        }
        if (typeof target === 'number') {
            return this.overlays[target] || null;
        }
        return null;
    }

    #tryCreateStore(): ViewStore | null {
        try {
            return new ViewStore();
        } catch (error) {
            this.#log('view-store unavailable', error?.message || error);
            return null;
        }
    }

    #log(event: string, payload: unknown): void {
        if (typeof this._logger === 'function') {
            this._logger(`[ViewManager] ${event}`, payload);
        }
    }
}
