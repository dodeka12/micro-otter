// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import { ToolbarView } from './toolbar-view.js';
import { TextDialogView } from './text-dialog-view.js';
import { MarkdownView } from './markdown-view.js';
import { IconProvider } from './icon-provider.js';
import { ProgressEventBus, ProgressEventType } from '../core/progress-events.js';
import { SplitView } from './split-view.js';
import { CollapsibleView } from './collapsible-view.js';
import { ContentView } from './content-view.js';
import { DataTableView } from './data-table-view.js';
import { assertAppEventPayloadType } from '../core/app-event.js';
import type { FirmwareConstituentVersions } from '../data/device-state.js';
import { Collection } from '../data/collection.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;
type DeviceDeploymentViewBaseOptions = Omit<
    ViewBaseOptions,
    'title' | 'icon' | 'i18nService' | 'logger'
>;
type ViewBaseSerialized = ReturnType<ViewBase['serialize']>;

type Unsubscribe = (() => void) | null;

interface DeviceTargetInfo {
    id?: string;
    displayName?: string;
    instanceData?: {
        userDescription?: string;
    };
}

interface DeviceDeploymentState {
    connected?: boolean;
    deviceInfoLoading?: boolean;
    hasMicroPython?: boolean | null;
    micropythonVersion?: string | null;
    deviceTargetInfo?: DeviceTargetInfo | null;
    runtimeInstalled?: boolean;
    runtimeDeploymentMode?: 'dynamic' | 'embedded' | 'unknown' | null;
    runtimeEmbedded?: boolean;
    bootstrapSetupReady?: boolean | null;
    bootstrapSetupStatus?: {
        missingOrInvalid?: Array<{ path?: string; reason?: string }>;
        errors?: Array<{ message?: string; path?: string }>;
    } | null;
    embeddedPackagesSummary?: {
        totalPackages?: number;
        totalFiles?: number;
        totalBytes?: number;
    } | null;
    embeddedInventory?: {
        files: Array<{
            path: string;
            packageId: string | null;
            packageVersion: string | null;
            fileKind: string;
            source: string;
        }>;
    } | null;
    runtimeId?: string | null;
    runtimeName?: string | null;
    runtimeVersion?: string | null;
    firmwareFullVersion?: string | null;
    runtimeFirmwareVersion?: string | null;
    firmwareConstituentVersions?: FirmwareConstituentVersions | null;
    collectionDeployed?: boolean;
    collectionName?: string | null;
    collectionVersion?: string | null;
    collectionHasFullDefinition?: boolean;
}

interface DeploymentEventDetail {
    payloadTypeId?: string;
    state?: DeviceDeploymentState;
    error?: string;
}

type DeploymentEventType =
    | 'device-state-changed'
    | 'device-info-loaded'
    | 'device-info-load-error'
    | 'runtime-installed'
    | 'runtime-upgraded'
    | 'runtime-removed'
    | 'collection-deployed'
    | 'collection-synced'
    | 'collection-removed'
    | 'operation-error';

type DeploymentEvent = CustomEvent<DeploymentEventDetail> & { type: DeploymentEventType };

interface ProgressEventLike {
    source: string;
    type: string;
    message: string;
    progress?: number;
}

interface CollectionLike {
    getId: () => string;
    getTitle: () => string;
    getVersionString: () => string;
    getDeviceRuntimeId: () => string | null;
    getTargetId: () => string | null;
    on: (eventName: string, listener: (event: unknown) => void) => Unsubscribe;
}

interface RuntimeLike {
    id: string;
    name?: string;
    version?: string;
}

interface RuntimeCollectionLike {
    runtimesById?: Map<string, RuntimeLike>;
    getRuntime: (runtimeId: string) => RuntimeLike | null | undefined;
}

interface DeviceConnectionLike {
    isConnected: () => boolean;
    connect: () => Promise<void>;
    readTextFile: (path: string) => Promise<string>;
}

interface ValidationResult {
    compatible?: boolean;
    errors: string[];
}

interface NodePackageValidationResult {
    errors?: string[];
    warnings?: string[];
    /** Embedded packages the deploy-time gate would shadow; empty hides the override option. */
    shadowPackages?: Array<{ packageId?: string }>;
}

interface DeviceDeploymentLike {
    addEventListener: (eventName: string, listener: (event: any) => void) => void;
    removeEventListener: (eventName: string, listener: (event: any) => void) => void;
    getDeviceState: () => DeviceDeploymentState;
    getDeviceConnection: () => DeviceConnectionLike | null;
    refreshConnectionState: () => Promise<void>;
    isConnected: () => boolean;
    hasMicroPython: () => boolean;
    refreshDeviceInfo: () => Promise<void>;
    reconfigureDeviceTarget: () => Promise<void>;
    installRuntime: (runtimeId: string) => Promise<void>;
    upgradeRuntime: (runtimeId: string, options: { preserveCollection?: boolean }) => Promise<void>;
    refreshRuntime: (runtimeId: string, options: { preserveCollection?: boolean }) => Promise<void>;
    removeRuntime: (options: {
        deletePreservedFiles?: boolean;
        deleteFileSystem?: boolean;
    }) => Promise<void>;
    validateCollectionCompatibility: (collection: CollectionLike) => Promise<ValidationResult>;
    validateNodePackages: (
        collection: CollectionLike
    ) => Promise<NodePackageValidationResult> | NodePackageValidationResult;
    deployCollection: (
        collection: CollectionLike,
        options: {
            includeFullDefinition?: boolean;
            force?: boolean;
            overrideFirmwarePackages?: boolean;
        }
    ) => Promise<void>;
    syncCollectionFiles: (
        collection: CollectionLike,
        options: { includeFullDefinition?: boolean; overrideFirmwarePackages?: boolean }
    ) => Promise<void>;
    deployCollectionInteractive: (
        collection: CollectionLike,
        options: {
            quickAction?: boolean;
            includeFullDefinition?: boolean;
            force?: boolean;
            overrideFirmwarePackages?: boolean;
        }
    ) => Promise<void>;
    syncCollectionFilesInteractive: (
        collection: CollectionLike,
        options: { quickAction?: boolean; includeFullDefinition?: boolean; overrideFirmwarePackages?: boolean }
    ) => Promise<void>;
    removeCollection: () => Promise<void>;
    getDynamicLibraryPathsOnDevice: () => Promise<string[]>;
}

interface FormDialogResult<TFormData extends Record<string, any>> {
    confirmed: boolean;
    formData: TFormData;
}

interface InstallRuntimeDialogData {
    runtimeId: string;
}

interface UpgradeRuntimeDialogData {
    preserveCollection: boolean;
}

interface RemoveRuntimeDialogData {
    deletePreservedFiles: boolean;
    deleteFileSystem: boolean;
}

interface ViewManagerLike {
    showFormDialog?: (
        options: Record<string, unknown>
    ) => Promise<FormDialogResult<any> | null | undefined>;
    showConfirmation?: (options: Record<string, unknown>) => Promise<boolean>;
    showError?: (options: {
        title: string;
        message: string;
        detail?: string | null;
    }) => Promise<unknown>;
    showInfo?: (options: { title: string; message: string }) => Promise<unknown>;
    showModal?: (view: unknown, options?: Record<string, unknown>) => void;
}

interface CollectionManagerLike {
    on: (eventName: string, listener: (event: any) => void) => Unsubscribe;
    getActiveCollection: () => CollectionLike | null;
    loadCollection: (id: string) => Promise<CollectionLike | null>;
    saveCollection: (collection: CollectionLike) => Promise<void>;
    deleteCollection: (id: string) => Promise<void>;
    setActiveCollectionId: (id: string) => void;
}

interface DeviceCollectionApiResponse {
    uuid: string;
    name?: string;
    collectionName?: string;
    version?: string;
    collectionVersion?: string;
    targetId?: string;
    deviceRuntimeId?: string;
    graphs?: unknown[];
    activeGraphIdx?: number;
    hasFullDefinition?: boolean;
}

interface DeviceCollectionData {
    [key: string]: unknown;
    id: string;
    title: string;
    version: string;
    targetId?: string;
    deviceRuntimeId?: string;
    graphs: unknown[];
    activeGraphIdx: number;
    hasFullDefinition: boolean;
}

type DownloadConfirmDecision = 'overwrite' | 'keep' | 'cancel';

interface DeviceDeploymentViewOptions extends DeviceDeploymentViewBaseOptions {
    deviceDeployment: DeviceDeploymentLike;
    runtimeCollection: RuntimeCollectionLike;
    collectionManager: CollectionManagerLike;
    viewManager: ViewManagerLike;
    i18nService?: ViewBaseOptions['i18nService'];
    logger?: ViewBaseOptions['logger'];
    title?: string;
    icon?: string | null;
}

const DEPLOYMENT_EVENT_PAYLOAD_TYPES = Object.freeze({
    'device-state-changed': 'DeviceDeployment.DeviceStateChanged.v1',
    'device-info-loaded': 'DeviceDeployment.DeviceInfoLoaded.v1',
    'device-info-load-error': 'DeviceDeployment.DeviceInfoLoadError.v1',
    'runtime-installed': 'DeviceDeployment.RuntimeInstalled.v1',
    'runtime-upgraded': 'DeviceDeployment.RuntimeUpgraded.v1',
    'runtime-removed': 'DeviceDeployment.RuntimeRemoved.v1',
    'collection-deployed': 'DeviceDeployment.CollectionDeployed.v1',
    'collection-synced': 'DeviceDeployment.CollectionSynced.v1',
    'collection-removed': 'DeviceDeployment.CollectionRemoved.v1',
    'operation-error': 'DeviceDeployment.OperationError.v1',
});

function assertDeploymentPayloadType(event: any, context: string): DeploymentEvent {
    const eventType = event?.type;
    const expectedPayloadTypeId = DEPLOYMENT_EVENT_PAYLOAD_TYPES[eventType];
    if (!expectedPayloadTypeId) {
        throw new TypeError(`${context}: unsupported event type '${eventType}'`);
    }

    const actualPayloadTypeId = event?.detail?.payloadTypeId;
    if (actualPayloadTypeId !== expectedPayloadTypeId) {
        throw new TypeError(
            `${context}: expected payloadTypeId '${expectedPayloadTypeId}' but received '${actualPayloadTypeId}'`
        );
    }

    return event;
}

/**
 * DeviceDeploymentView - UI for runtime and collection deployment.
 *
 * Composes a toolbar, status panels, compatibility messaging, and
 * two-tier progress bars for deployment operations.
 */
export class DeviceDeploymentView extends ViewBase {
    _deviceDeployment: DeviceDeploymentLike;
    _runtimeCollection: RuntimeCollectionLike;
    _collectionManager: CollectionManagerLike;
    _viewManager: ViewManagerLike;

    _splitView: SplitView | null;
    _splitHost: HTMLDivElement | null;
    _toolbarView: ToolbarView | null;
    _toolbarCollapsible: CollapsibleView | null;
    _toolbarButtons: Map<string, { selector: string; labelKey: string }>;
    _deviceInfoCollapsible: CollapsibleView | null;
    _runtimeInfoCollapsible: CollapsibleView | null;
    _collectionInfoCollapsible: CollapsibleView | null;
    _collectionComparisonCollapsible: CollapsibleView | null;
    _deviceInfoContentView: ContentView | null;
    _runtimeInfoContentView: ContentView | null;
    _collectionInfoContentView: ContentView | null;
    _collectionComparisonContentView: ContentView | null;
    _deviceInfoTable: DataTableView | null;
    _runtimeInfoTable: DataTableView | null;
    _collectionInfoTable: DataTableView | null;
    _constituentVersionsTable: DataTableView | null;
    _nodePackagesTable: DataTableView | null;
    _statusCellTargets: Map<string, { table: DataTableView; rowIndex: number }>;
    _collectionComparisonPanel: HTMLElement | null;
    _collectionComparisonFields: Map<string, HTMLElement>;
    /** Help section used as the sole split pane while no device is connected. */
    _emptyStateCollapsible: CollapsibleView | null;
    _emptyStateContentView: ContentView | null;

    /** Markdown prompt shown in the empty state; names the title-bar badge. */
    _emptyStateHintView: MarkdownView | null;
    _loadingPanel: HTMLElement | null;
    _loadingMessageElement: HTMLElement | null;
    _loadingProgressElement: HTMLElement | null;
    _downloadCollectionButton: HTMLButtonElement | null;

    _deviceStateListener: ((event: DeploymentEvent) => void) | null;
    _deviceInfoLoadedListener: ((event: DeploymentEvent) => void) | null;
    _deviceInfoLoadErrorListener: ((event: DeploymentEvent) => void) | null;
    _deploymentEventListener: ((event: DeploymentEvent) => void) | null;
    _operationErrorListener: ((event: DeploymentEvent) => void) | null;
    _progressListener: ((event: ProgressEventLike) => void) | null;
    _compatibilityRequestId: number;
    _hasShownMicroPythonDialog: boolean;
    _hasShownEmbeddedCompatibilityBootstrapPrompt: boolean;
    _embeddedCompatibilityBootstrapPromptInProgress: boolean;
    _collectionChangeUnsubscribe: Unsubscribe;
    _activeCollectionUnsubscribe: Unsubscribe;
    _activeCollectionId: string | null;

    /**
     * @param {object} options
     * @param {object} options.deviceDeployment
     * @param {object} options.runtimeCollection
     * @param {object} options.collectionManager
     * @param {object} options.viewManager
     * @param {object|null} [options.i18nService]
     * @param {object|null} [options.logger]
     */
    constructor({
        deviceDeployment,
        runtimeCollection,
        collectionManager,
        viewManager,
        i18nService = null,
        logger = null,
        ...rest
    }: DeviceDeploymentViewOptions) {
        super({
            title: 'Deployment',
            icon: IconProvider.upload,
            i18nService,
            logger,
            ...rest,
        });

        if (!deviceDeployment) {
            throw new Error('DeviceDeploymentView requires a deviceDeployment instance');
        }
        if (!runtimeCollection) {
            throw new Error('DeviceDeploymentView requires a runtimeCollection');
        }
        if (!collectionManager) {
            throw new Error('DeviceDeploymentView requires a collectionManager');
        }
        if (!viewManager) {
            throw new Error('DeviceDeploymentView requires a viewManager');
        }
        this._deviceDeployment = deviceDeployment;
        this._runtimeCollection = runtimeCollection;
        this._collectionManager = collectionManager;
        this._viewManager = viewManager;

        this._splitView = null;
        this._splitHost = null;
        this._toolbarView = null;
        this._toolbarCollapsible = null;
        this._toolbarButtons = new Map();
        this._deviceInfoCollapsible = null;
        this._runtimeInfoCollapsible = null;
        this._collectionInfoCollapsible = null;
        this._collectionComparisonCollapsible = null;
        this._deviceInfoContentView = null;
        this._runtimeInfoContentView = null;
        this._collectionInfoContentView = null;
        this._collectionComparisonContentView = null;
        this._deviceInfoTable = null;
        this._runtimeInfoTable = null;
        this._collectionInfoTable = null;
        this._constituentVersionsTable = null;
        this._nodePackagesTable = null;
        this._statusCellTargets = new Map();
        this._collectionComparisonPanel = null;
        this._collectionComparisonFields = new Map();
        this._emptyStateCollapsible = null;
        this._emptyStateContentView = null;
        this._emptyStateHintView = null;
        this._loadingPanel = null;
        this._loadingMessageElement = null;
        this._loadingProgressElement = null;
        this._downloadCollectionButton = null;

        this._deviceStateListener = null;
        this._deviceInfoLoadedListener = null;
        this._deviceInfoLoadErrorListener = null;
        this._deploymentEventListener = null;
        this._operationErrorListener = null;
        this._progressListener = null;
        this._compatibilityRequestId = 0;
        this._hasShownMicroPythonDialog = false;
        this._hasShownEmbeddedCompatibilityBootstrapPrompt = false;
        this._embeddedCompatibilityBootstrapPromptInProgress = false;
        this._collectionChangeUnsubscribe = null;
        this._activeCollectionUnsubscribe = null;
        this._activeCollectionId = null;
    }

    render(container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = 'device-deployment-view';

        // Create toolbar view only once (reuse across renders to preserve state)
        if (!this._toolbarView) {
            this._toolbarView = new ToolbarView({
                height: 40,
                i18nService: this._i18nService,
                logger: this._logger,
            });
            this._createToolbarControls();
        }

        // Wrap the toolbar in a collapsible so it is the first split pane, matching
        // DeviceConnectionView._connectionToolbarCollapsible.
        if (!this._toolbarCollapsible) {
            const toolbarTitle = this.t('deployment.toolbarTitle');
            this._toolbarCollapsible = new CollapsibleView({
                headerTitle: toolbarTitle,
                collapsed: false,
                contentView: this._toolbarView,
                sizeToContent: true,
                title: toolbarTitle,
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        // Create the four status/comparison sections once. Each section owns a
        // ContentView built by _createSection(); the split can re-attach them.
        if (!this._deviceInfoCollapsible) {
            this._deviceInfoCollapsible = this._createSection('deployment.deviceInfo', () =>
                this._createDeviceInfoPanel()
            );
            this._deviceInfoContentView =
                this._deviceInfoCollapsible.contentView as ContentView | null;
        }

        if (!this._runtimeInfoCollapsible) {
            this._runtimeInfoCollapsible = this._createSection('deployment.runtimeInfo', () =>
                this._createRuntimeInfoPanel()
            );
            this._runtimeInfoContentView =
                this._runtimeInfoCollapsible.contentView as ContentView | null;
        }

        if (!this._collectionInfoCollapsible) {
            this._collectionInfoCollapsible = this._createSection('deployment.collectionInfo', () =>
                this._createCollectionInfoPanel()
            );
            this._collectionInfoContentView =
                this._collectionInfoCollapsible.contentView as ContentView | null;
        }

        if (!this._collectionComparisonCollapsible) {
            this._collectionComparisonCollapsible = this._createSection(
                'deviceCollection.comparison.title',
                () => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'deployment-collection-comparison-wrapper';
                    this._collectionComparisonPanel = this._createCollectionComparisonPanel();
                    this._downloadCollectionButton = this._createDownloadCollectionButton();
                    wrapper.append(this._collectionComparisonPanel, this._downloadCollectionButton);
                    return wrapper;
                }
            );
            this._collectionComparisonContentView =
                this._collectionComparisonCollapsible.contentView as ContentView | null;
        }

        // The disconnected state reuses the shell: one Help collapsible as the sole pane.
        if (!this._emptyStateCollapsible) {
            this._emptyStateCollapsible = this._createEmptyStateSection();
        }

        // Create split view with either the connected sections or the Help pane.
        if (!this._splitHost) {
            this._splitHost = document.createElement('div');
            this._splitHost.className = 'device-deployment-view__split-host';
        }

        if (!this._splitView) {
            this._splitView = new SplitView({
                orientation: 'vertical',
                minPaneSize: 40,
                gap: 0,
                views: this._getSplitPaneViews(),
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        // Content views populate this map as the split attaches.
        this._statusCellTargets.clear();
        this._splitView.attachTo(this._splitHost);

        if (this._toolbarView && this._toolbarButtons.size === 0) {
            this._createToolbarControls();
        }
        this._toolbarCollapsible?.refreshSize();

        this._loadingPanel = this._createLoadingPanel();

        root.append(this._splitHost, this._loadingPanel);

        container.replaceChildren(root);

        this._updateUI();
    }

    /**
     * Build the ordered split-pane views for the requested connection state.
     *
     * The connected shell mirrors DeviceConnectionView's pane ordering. The
     * disconnected state keeps the same shell but swaps in the single Help pane.
     * @param {boolean} [isConnected] Connection state to render; defaults to live state.
     * @returns {ViewBase[]} Pane views in display order.
     */
    _getSplitPaneViews(isConnected: boolean = this._isDeviceConnected()): ViewBase[] {
        if (!isConnected) {
            return this._emptyStateCollapsible ? [this._emptyStateCollapsible] : [];
        }

        const views: ViewBase[] = [];
        for (const view of [
            this._toolbarCollapsible,
            this._deviceInfoCollapsible,
            this._runtimeInfoCollapsible,
            this._collectionInfoCollapsible,
            this._collectionComparisonCollapsible,
        ]) {
            if (view) {
                views.push(view);
            }
        }
        return views;
    }

    /**
     * Return whether the split already hosts exactly the requested panes.
     * Called by `_syncSplitPaneViews()` to avoid detaching unchanged views.
     * @param {ViewBase[]} views Desired pane views.
     * @returns {boolean} True when the host pane list matches by identity and order.
     */
    _splitViewsMatch(views: ViewBase[]): boolean {
        const current = this._splitView?.views ?? [];
        return (
            current.length === views.length &&
            current.every((view, index) => view === views[index])
        );
    }

    /**
     * Swap the split's panes when the connection state changes.
     *
     * Detaching the status content views invalidates `_statusCellTargets`, so the
     * map is cleared before the split reattaches the target state's panes.
     * @param {boolean} isConnected Connection state to render.
     */
    _syncSplitPaneViews(isConnected: boolean): void {
        const views = this._getSplitPaneViews(isConnected);
        if (!this._splitView || views.length === 0 || this._splitViewsMatch(views)) {
            return;
        }

        this._statusCellTargets.clear();
        this._splitView.setViews(views);
    }

    /**
     * Build one expanded, content-sized section from a render function.
     * @param {string} titleKey Translation key for the collapsible header.
     * @param {Function} renderFn Builds the section body.
     * @returns {CollapsibleView} The section pane.
     */
    _createSection(titleKey: string, renderFn: () => HTMLElement): CollapsibleView {
        const contentView = new ContentView({
            renderFn,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        return new CollapsibleView({
            headerTitle: this.t(titleKey),
            collapsed: false,
            contentView,
            sizeToContent: true,
            i18nService: this._i18nService,
            logger: this._logger,
        });
    }

    afterAttach(): void {
        super.afterAttach();

        this._deviceStateListener = (event) => {
            assertDeploymentPayloadType(event, 'DeviceDeploymentView device-state listener');
            this._updateUI(event?.detail?.state);
        };
        this._deviceInfoLoadedListener = (event) => this._onDeviceInfoLoaded(event);
        this._deviceInfoLoadErrorListener = (event) => this._onDeviceInfoLoadError(event);
        this._deploymentEventListener = (event) => {
            assertDeploymentPayloadType(event, 'DeviceDeploymentView deployment listener');
            this._updateUI();
        };
        this._operationErrorListener = (event) => this._handleOperationError(event);

        this._deviceDeployment.addEventListener('device-state-changed', this._deviceStateListener);
        this._deviceDeployment.addEventListener(
            'device-info-loaded',
            this._deviceInfoLoadedListener
        );
        this._deviceDeployment.addEventListener(
            'device-info-load-error',
            this._deviceInfoLoadErrorListener
        );
        this._deviceDeployment.addEventListener('runtime-installed', this._deploymentEventListener);
        this._deviceDeployment.addEventListener('runtime-upgraded', this._deploymentEventListener);
        this._deviceDeployment.addEventListener('runtime-removed', this._deploymentEventListener);
        this._deviceDeployment.addEventListener(
            'collection-deployed',
            this._deploymentEventListener
        );
        this._deviceDeployment.addEventListener('collection-synced', this._deploymentEventListener);
        this._deviceDeployment.addEventListener(
            'collection-removed',
            this._deploymentEventListener
        );
        this._deviceDeployment.addEventListener('operation-error', this._operationErrorListener);

        this._progressListener = (event) => this._onProgress(event);
        ProgressEventBus.subscribe(this._progressListener);

        this._subscribeToLanguageChanges(() => this._rerenderForLocale());

        // Listen for active collection changes
        const activeCollectionListener = (event) => {
            if (event?.name !== 'activeCollectionChanged') {
                return;
            }
            assertAppEventPayloadType(
                event,
                'CollectionManager.ActiveCollectionChanged.v1',
                'DeviceDeploymentView collection manager listener'
            );
            const newCollectionId = event.detail?.collectionId;
            if (newCollectionId === this._activeCollectionId) {
                return;
            }

            // Unsubscribe from old collection
            if (this._collectionChangeUnsubscribe) {
                this._collectionChangeUnsubscribe();
                this._collectionChangeUnsubscribe = null;
            }

            // Update active collection ID
            this._activeCollectionId = newCollectionId;

            // Subscribe to new collection's changes
            const activeCollection = this._collectionManager.getActiveCollection();
            if (activeCollection) {
                this._collectionChangeUnsubscribe = activeCollection.on('*', (collectionEvent) =>
                    this._onCollectionChange(collectionEvent)
                );
            }

            // Update collection comparison for new collection
            const state = this._deviceDeployment.getDeviceState();
            this._updateCollectionComparisonPanel(state);
        };

        this._activeCollectionUnsubscribe = this._collectionManager.on(
            '*',
            activeCollectionListener
        );

        // Subscribe to initial active collection
        const activeCollection = this._collectionManager.getActiveCollection();
        if (activeCollection) {
            this._activeCollectionId = activeCollection.getId();
            this._collectionChangeUnsubscribe = activeCollection.on('*', (event) =>
                this._onCollectionChange(event)
            );
        }
    }

    beforeDetach(): void {
        if (this._deviceStateListener) {
            this._deviceDeployment.removeEventListener(
                'device-state-changed',
                this._deviceStateListener
            );
            this._deviceStateListener = null;
        }

        if (this._deviceInfoLoadedListener) {
            this._deviceDeployment.removeEventListener(
                'device-info-loaded',
                this._deviceInfoLoadedListener
            );
            this._deviceInfoLoadedListener = null;
        }

        if (this._deviceInfoLoadErrorListener) {
            this._deviceDeployment.removeEventListener(
                'device-info-load-error',
                this._deviceInfoLoadErrorListener
            );
            this._deviceInfoLoadErrorListener = null;
        }

        if (this._deploymentEventListener) {
            this._deviceDeployment.removeEventListener(
                'runtime-installed',
                this._deploymentEventListener
            );
            this._deviceDeployment.removeEventListener(
                'runtime-upgraded',
                this._deploymentEventListener
            );
            this._deviceDeployment.removeEventListener(
                'runtime-removed',
                this._deploymentEventListener
            );
            this._deviceDeployment.removeEventListener(
                'collection-deployed',
                this._deploymentEventListener
            );
            this._deviceDeployment.removeEventListener(
                'collection-synced',
                this._deploymentEventListener
            );
            this._deviceDeployment.removeEventListener(
                'collection-removed',
                this._deploymentEventListener
            );
            this._deploymentEventListener = null;
        }

        if (this._operationErrorListener) {
            this._deviceDeployment.removeEventListener(
                'operation-error',
                this._operationErrorListener
            );
            this._operationErrorListener = null;
        }

        if (this._progressListener) {
            ProgressEventBus.unsubscribe(this._progressListener);
            this._progressListener = null;
        }

        if (this._collectionChangeUnsubscribe) {
            this._collectionChangeUnsubscribe();
            this._collectionChangeUnsubscribe = null;
        }

        if (this._activeCollectionUnsubscribe) {
            this._activeCollectionUnsubscribe();
            this._activeCollectionUnsubscribe = null;
        }

        this._activeCollectionId = null;

        if (this._splitView) {
            this._splitView.detach();
            this._splitView = null;
        }

        this._splitHost = null;

        if (this._toolbarCollapsible) {
            this._toolbarCollapsible.detach();
            this._toolbarCollapsible = null;
        }

        if (this._toolbarView?.isAttached) {
            this._toolbarView.detach();
        }
        this._toolbarView = null;

        for (const collapsible of [
            this._deviceInfoCollapsible,
            this._runtimeInfoCollapsible,
            this._collectionInfoCollapsible,
            this._collectionComparisonCollapsible,
        ]) {
            if (collapsible?.isAttached) {
                collapsible.detach();
            }
        }
        this._deviceInfoCollapsible = null;
        this._runtimeInfoCollapsible = null;
        this._collectionInfoCollapsible = null;
        this._collectionComparisonCollapsible = null;

        for (const contentView of [
            this._deviceInfoContentView,
            this._runtimeInfoContentView,
            this._collectionInfoContentView,
            this._collectionComparisonContentView,
        ]) {
            if (contentView?.isAttached) {
                contentView.detach();
            }
        }
        this._deviceInfoContentView = null;
        this._runtimeInfoContentView = null;
        this._collectionInfoContentView = null;
        this._collectionComparisonContentView = null;

        if (this._emptyStateCollapsible?.isAttached) {
            this._emptyStateCollapsible.detach();
        }
        this._emptyStateCollapsible = null;
        if (this._emptyStateContentView?.isAttached) {
            this._emptyStateContentView.detach();
        }
        this._emptyStateContentView = null;
        if (this._emptyStateHintView?.isAttached) {
            this._emptyStateHintView.detach();
        }
        this._emptyStateHintView = null;

        super.beforeDetach();
    }

    _rerenderForLocale(): void {
        if (!this._container) {
            return;
        }

        if (this._splitView) {
            this._splitView.detach();
            this._splitView = null;
        }

        this._splitHost = null;

        if (this._toolbarCollapsible) {
            this._toolbarCollapsible.detach();
            this._toolbarCollapsible = null;
        }

        if (this._toolbarView?.isAttached) {
            this._toolbarView.detach();
        }
        this._toolbarView = null;

        for (const collapsible of [
            this._deviceInfoCollapsible,
            this._runtimeInfoCollapsible,
            this._collectionInfoCollapsible,
            this._collectionComparisonCollapsible,
        ]) {
            if (collapsible?.isAttached) {
                collapsible.detach();
            }
        }
        this._deviceInfoCollapsible = null;
        this._runtimeInfoCollapsible = null;
        this._collectionInfoCollapsible = null;
        this._collectionComparisonCollapsible = null;

        for (const contentView of [
            this._deviceInfoContentView,
            this._runtimeInfoContentView,
            this._collectionInfoContentView,
            this._collectionComparisonContentView,
        ]) {
            if (contentView?.isAttached) {
                contentView.detach();
            }
        }
        this._deviceInfoContentView = null;
        this._runtimeInfoContentView = null;
        this._collectionInfoContentView = null;
        this._collectionComparisonContentView = null;

        if (this._emptyStateCollapsible?.isAttached) {
            this._emptyStateCollapsible.detach();
        }
        this._emptyStateCollapsible = null;
        if (this._emptyStateContentView?.isAttached) {
            this._emptyStateContentView.detach();
        }
        this._emptyStateContentView = null;
        if (this._emptyStateHintView?.isAttached) {
            this._emptyStateHintView.detach();
        }
        this._emptyStateHintView = null;

        this.render(this._container);
    }

    _createToolbarControls(): void {
        if (!this._toolbarView) {
            return;
        }

        this._toolbarButtons.clear();
        this._toolbarView.clearControls();

        const addButton = (id, icon, labelKey, onClick, className = '') => {
            const buttonClass = `device-deployment-view__toolbar-btn--${id}`;
            this._toolbarView.addButton({
                icon,
                label: this.t(labelKey),
                onClick,
                className: `${className} ${buttonClass}`.trim(),
            });
            this._toolbarButtons.set(id, { selector: `.${buttonClass}`, labelKey });
        };

        addButton(
            'install-upgrade-runtime',
            IconProvider.installRuntime,
            'deployment.installRuntime',
            () => this._handleInstallOrUpgradeRuntime()
        );
        addButton('remove-runtime', IconProvider.removeRuntime, 'deployment.removeRuntime', () =>
            this._handleRemoveRuntime()
        );
        addButton('refresh-device-info', IconProvider.sync, 'deployment.refreshDeviceInfo', () =>
            this._handleRefreshDeviceInfo()
        );
        addButton(
            'edit-device-target',
            IconProvider.edit,
            'deployment.editDeviceTarget',
            () => this._handleEditDeviceTarget()
        );

        addButton(
            'deploy-collection',
            IconProvider.deployCollection,
            'deployment.deployCollection',
            () => this._handleDeployCollection()
        );
        addButton('sync-collection', IconProvider.syncCollection, 'deployment.syncCollection', () =>
            this._handleSyncCollection()
        );
        addButton(
            'remove-collection',
            IconProvider.removeCollection,
            'deployment.removeCollection',
            () => this._handleRemoveCollection()
        );

        // Render all controls at once (prevents stale references)
        this._toolbarView.renderControls();
        this._toolbarCollapsible?.refreshSize();
    }

    /**
     * Build the Device Information pane body.
     * @returns {HTMLDivElement} Pane body containing the device key/value table.
     */
    _createDeviceInfoPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        panel.className = 'deployment-pane deployment-device-info';

        const deviceTable = this._createKeyValueTable([
            { label: this.t('deployment.connection'), field: 'connection' },
            { label: this.t('deployment.microPythonStatus'), field: 'micropython-status' },
            { label: this.t('deployment.microPythonVersion'), field: 'micropython-version' },
            { label: this.t('deployment.target'), field: 'target' },
            { label: this.t('deployment.userDescription'), field: 'user-description' },
            {
                label: this.t('deployment.dynamicLibrariesOnDevice'),
                field: 'dynamic-libraries-on-device',
            },
        ]);
        this._deviceInfoTable = deviceTable;
        panel.appendChild(this._mountStatusTable(deviceTable));

        return panel;
    }

    /**
     * Build the Runtime Information pane body.
     * @returns {HTMLDivElement} Pane body with runtime and constituent tables.
     */
    _createRuntimeInfoPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        panel.className = 'deployment-pane deployment-runtime-info';

        const runtimeTable = this._createKeyValueTable([
            { label: this.t('deployment.installed'), field: 'runtime-installed' },
            { label: this.t('deployment.runtimeMode'), field: 'runtime-mode' },
            { label: this.t('deployment.name'), field: 'runtime-name' },
            { label: this.t('deployment.version'), field: 'runtime-version' },
            { label: this.t('deployment.firmwareFullVersion'), field: 'firmware-full-version' },
            { label: this.t('deployment.runtimeFirmwareVersion'), field: 'runtime-firmware-version' },
            { label: this.t('deployment.embeddedPackagesSummary'), field: 'embedded-packages-summary' },
        ]);
        this._runtimeInfoTable = runtimeTable;

        const constituentTable = this._createConstituentVersionsTable();
        this._constituentVersionsTable = constituentTable;

        const nodePackagesTable = new DataTableView({
            caption: this.t('deployment.nodePackages'),
            columns: [{}, {}],
            rows: [],
        });
        this._nodePackagesTable = nodePackagesTable;

        const subtables = document.createElement('div');
        subtables.className = 'status-subtables';
        subtables.append(
            this._mountStatusTable(constituentTable),
            this._mountStatusTable(nodePackagesTable)
        );

        panel.append(this._mountStatusTable(runtimeTable), subtables);

        return panel;
    }

    /**
     * Build the Collection on Device pane body.
     * @returns {HTMLDivElement} Pane body containing the collection key/value table.
     */
    _createCollectionInfoPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        panel.className = 'deployment-pane deployment-collection-info';

        const collectionTable = this._createKeyValueTable([
            { label: this.t('deployment.name'), field: 'collection-name' },
            { label: this.t('deployment.version'), field: 'collection-version' },
            { label: this.t('deployment.deployed'), field: 'collection-deployed' },
        ]);
        this._collectionInfoTable = collectionTable;
        panel.appendChild(this._mountStatusTable(collectionTable));

        return panel;
    }

    _createKeyValueTable(items: Array<{ label: string; field: string }>): DataTableView {
        const table = new DataTableView({
            columns: [{}, {}],
            rows: items.map(({ label, field }) => ({
                cells: [{ text: label }, { text: '-', data: { field } }],
            })),
        });

        items.forEach(({ field }, index) => {
            this._statusCellTargets.set(field, { table, rowIndex: index });
        });

        return table;
    }

    _createConstituentVersionsTable(): DataTableView {
        return new DataTableView({
            caption: this.t('deployment.firmwareConstituentVersions'),
            columns: [{}, {}],
            rows: [
                { cells: [{ text: this.t('deployment.microPythonVersion') }, { text: '-' }] },
                { cells: [{ text: this.t('deployment.runtimeSourceVersion') }, { text: '-' }] },
                { cells: [{ text: this.t('deployment.runtimeFirmwareVersion') }, { text: '-' }] },
                { cells: [{ text: this.t('deployment.deviceToolsVersion') }, { text: '-' }] },
            ],
        });
    }

    _mountStatusTable(table: DataTableView): HTMLDivElement {
        const host = document.createElement('div');
        host.className = 'status-table-host';
        table.attachTo(host);
        return host;
    }

    _createCollectionComparisonPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        panel.className = 'deployment-collection-comparison-panel';
        panel.style.display = 'none';

        // Status Section (at top)
        const statusSection = document.createElement('div');
        statusSection.className = 'collection-comparison-section status-section';

        const statusHeading = document.createElement('h4');
        statusHeading.textContent = this.t('deviceCollection.status.title');
        statusSection.appendChild(statusHeading);

        const statusBody = document.createElement('div');
        statusBody.className = 'status-body';
        statusSection.appendChild(statusBody);

        this._collectionComparisonFields.set('status-body', statusBody);

        // Local Collection Section
        const localSection = document.createElement('div');
        localSection.className = 'collection-comparison-section local-collection';

        const localHeading = document.createElement('h4');
        localHeading.textContent = this.t('deviceCollection.local.title');
        localSection.appendChild(localHeading);

        this._addComparisonRow(localSection, 'local-name', 'deviceCollection.local.name');
        this._addComparisonRow(localSection, 'local-version', 'deviceCollection.local.version');
        this._addComparisonRow(localSection, 'local-runtime', 'deviceCollection.local.runtime');
        this._addComparisonRow(localSection, 'local-target', 'deviceCollection.local.target');

        // Device Collection Section
        const deviceSection = document.createElement('div');
        deviceSection.className = 'collection-comparison-section device-collection';

        const deviceHeading = document.createElement('h4');
        deviceHeading.textContent = this.t('deviceCollection.device.title');
        deviceSection.appendChild(deviceHeading);

        this._addComparisonRow(deviceSection, 'device-name', 'deviceCollection.device.name');
        this._addComparisonRow(deviceSection, 'device-version', 'deviceCollection.device.version');
        this._addComparisonRow(deviceSection, 'device-runtime', 'deviceCollection.device.runtime');
        this._addComparisonRow(deviceSection, 'device-target', 'deviceCollection.device.target');
        this._addComparisonRow(
            deviceSection,
            'device-graph-status',
            'deviceCollection.device.graphIncluded'
        );

        panel.append(statusSection, localSection, deviceSection);
        return panel;
    }

    _createDownloadCollectionButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'device-deployment-download-button';
        button.style.display = 'none';
        button.innerHTML = '⬇ ' + this.t('deviceCollection.download.button');
        button.addEventListener('click', () => this._handleDownloadCollection());
        return button;
    }

    _addComparisonRow(container: HTMLElement, fieldKey: string, labelKey: string): void {
        const row = document.createElement('div');
        row.className = 'comparison-row';

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = this.t(labelKey);

        const value = document.createElement('span');
        value.className = 'value';
        value.dataset.field = fieldKey;
        value.textContent = '-';

        row.append(label, value);
        container.appendChild(row);
        this._collectionComparisonFields.set(fieldKey, value);
    }

    /**
     * Build the disconnected Help section used as the split's sole pane.
     *
     * It reuses the standard `CollapsibleView` + `ContentView` shell and renders
     * the prompt through `MarkdownView`, the sanctioned explainer renderer. The
     * pane holds no connect button: connecting belongs to the title-bar badge
     * and the connection dialog.
     * @returns {CollapsibleView} The Help pane, not yet attached to the split.
     */
    _createEmptyStateSection(): CollapsibleView {
        if (this._emptyStateCollapsible) {
            this._emptyStateCollapsible.detach();
            this._emptyStateCollapsible = null;
        }
        if (this._emptyStateHintView?.isAttached) {
            this._emptyStateHintView.detach();
        }
        this._emptyStateContentView = null;
        this._emptyStateHintView = null;

        this._emptyStateContentView = new ContentView({
            renderFn: () => this._createEmptyStateBody(),
            i18nService: this._i18nService,
            logger: this._logger,
        });

        return new CollapsibleView({
            headerTitle: this.t('deployment.helpTitle'),
            collapsed: false,
            contentView: this._emptyStateContentView,
            sizeToContent: true,
            title: this.t('deployment.helpTitle'),
            i18nService: this._i18nService,
            logger: this._logger,
        });
    }

    /**
     * Build the Markdown body of the disconnected Help section.
     * @returns {HTMLDivElement} Host containing the rendered Markdown.
     */
    _createEmptyStateBody(): HTMLDivElement {
        const body = document.createElement('div');
        body.className = 'deployment-empty-state__body';

        const hintHost = document.createElement('div');
        hintHost.className = 'deployment-empty-state__hint';
        body.appendChild(hintHost);

        // A locale switch re-renders the pane, so drop the previous prompt view
        // before building the next one.
        this._emptyStateHintView?.detach();
        this._emptyStateHintView = new MarkdownView({
            markdown: `## ${this.t('deployment.noDeviceConnected')}\n\n${this.t(
                'deployment.connectViaTitleBar'
            )}`,
            scrollable: false,
            title: this.t('deployment.helpTitle'),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._emptyStateHintView.attachTo(hintHost);

        return body;
    }

    _createLoadingPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        panel.className = 'deployment-loading-panel';

        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';

        const message = document.createElement('p');
        message.className = 'deployment-loading-message';
        message.textContent = this.t('deployment.loadingDeviceInfo');

        const progress = document.createElement('div');
        progress.className = 'deployment-loading-progress';
        progress.textContent = '0%';

        panel.append(spinner, message, progress);
        panel.style.display = 'none';

        this._loadingMessageElement = message;
        this._loadingProgressElement = progress;

        return panel;
    }

    async _handleInstallOrUpgradeRuntime(): Promise<void> {
        const state = this._deviceDeployment.getDeviceState();

        this._log(
            'runtime-action-entry',
            `connected=${Boolean(state.connected)}; runtimeInstalled=${Boolean(state.runtimeInstalled)}; runtimeMode=${state.runtimeDeploymentMode || 'unknown'}; runtimeEmbedded=${Boolean(state.runtimeEmbedded)}; runtimeId=${state.runtimeId || 'none'}`
        );

        if (this._needsEmbeddedCompatibilityBootstrap(state)) {
            this._log(
                'runtime-action-bootstrap-route',
                `runtimeId=${state.runtimeId || 'none'}; reason=embedded-runtime-with-missing-markers`
            );
            await this._promptEmbeddedCompatibilityBootstrap(state);
            return;
        }

        // If runtime is already installed, upgrade it
        if (state.runtimeInstalled && state.runtimeId) {
            return this._handleUpgradeRuntime();
        }

        // Otherwise, install a new runtime
        return this._handleInstallRuntime();
    }

    async _handleInstallRuntime(): Promise<void> {
        try {
            const runtimes = Array.from(this._runtimeCollection.runtimesById?.values?.() || []);
            if (!runtimes.length) {
                await this._showError(this.t('deployment.runtimeUnavailable'));
                return;
            }

            const options = runtimes.map((runtime) => ({
                value: runtime.id,
                label: `${runtime.name || runtime.id} (${runtime.version || 'unknown'})`,
            }));

            const result = (await this._viewManager.showFormDialog?.({
                title: this.t('deployment.selectRuntime'),
                fields: [
                    {
                        id: 'runtimeId',
                        type: 'dropdown',
                        label: this.t('deployment.runtimeLabel'),
                        options,
                        required: true,
                        defaultValue: options[0]?.value || '',
                    },
                ],
                confirmLabel: this.t('deployment.install'),
                cancelLabel: this.t('dialog.cancel'),
            })) as FormDialogResult<InstallRuntimeDialogData> | null | undefined;

            if (!result?.confirmed) {
                return;
            }

            await this._deviceDeployment.installRuntime(result.formData.runtimeId);
        } catch (error) {
            await this._showError(error?.message || this.t('deployment.errorGeneric'));
        }
    }

    async _handleUpgradeRuntime(): Promise<void> {
        try {
            const state = this._deviceDeployment.getDeviceState();
            if (!state.runtimeId) {
                await this._showError(this.t('deployment.runtimeNotInstalled'));
                return;
            }

            const result = (await this._viewManager.showFormDialog?.({
                title: this.t('deployment.confirmUpgrade'),
                message: this.t('deployment.confirmUpgradeMessage', {
                    runtime: state.runtimeId,
                    currentVersion: state.runtimeVersion || this.t('deployment.unknown'),
                }),
                fields: [
                    {
                        id: 'preserveCollection',
                        type: 'checkbox',
                        label: this.t('deployment.preserveCollection'),
                        defaultValue: true,
                    },
                ],
                confirmLabel: this.t('deployment.upgrade'),
                cancelLabel: this.t('dialog.cancel'),
            })) as FormDialogResult<UpgradeRuntimeDialogData> | null | undefined;

            if (!result?.confirmed) {
                return;
            }

            await this._deviceDeployment.upgradeRuntime(state.runtimeId, {
                preserveCollection: result.formData.preserveCollection,
            });
        } catch (error) {
            await this._showError(error?.message || this.t('deployment.errorGeneric'));
        }
    }

    async _handleRefreshRuntime(): Promise<void> {
        try {
            const state = this._deviceDeployment.getDeviceState();
            if (!state.runtimeId) {
                await this._showError(this.t('deployment.runtimeNotInstalled'));
                return;
            }

            const result = (await this._viewManager.showFormDialog?.({
                title: this.t('deployment.confirmRefresh'),
                message: this.t('deployment.confirmRefreshMessage', {
                    runtime: state.runtimeId,
                }),
                fields: [
                    {
                        id: 'preserveCollection',
                        type: 'checkbox',
                        label: this.t('deployment.preserveCollection'),
                        defaultValue: true,
                    },
                ],
                confirmLabel: this.t('deployment.refresh'),
                cancelLabel: this.t('dialog.cancel'),
            })) as FormDialogResult<UpgradeRuntimeDialogData> | null | undefined;

            if (!result?.confirmed) {
                return;
            }

            await this._deviceDeployment.refreshRuntime(state.runtimeId, {
                preserveCollection: result.formData.preserveCollection,
            });
        } catch (error) {
            await this._showError(error?.message || this.t('deployment.errorGeneric'));
        }
    }

    async _handleRemoveRuntime(): Promise<void> {
        try {
            const result = (await this._viewManager.showFormDialog?.({
                title: this.t('deployment.confirmRemoveRuntime'),
                message: this.t('deployment.confirmRemoveRuntimeMessage'),
                fields: [
                    {
                        id: 'deletePreservedFiles',
                        type: 'checkbox',
                        label: this.t('deployment.deletePreservedFiles'),
                        defaultValue: false,
                    },
                    {
                        id: 'deleteFileSystem',
                        type: 'checkbox',
                        label: this.t('deployment.deleteFileSystem'),
                        defaultValue: false,
                    },
                ],
                confirmLabel: this.t('deployment.remove'),
                cancelLabel: this.t('dialog.cancel'),
            })) as FormDialogResult<RemoveRuntimeDialogData> | null | undefined;

            if (!result?.confirmed) {
                return;
            }

            await this._deviceDeployment.removeRuntime({
                deletePreservedFiles: result.formData.deletePreservedFiles,
                deleteFileSystem: result.formData.deleteFileSystem,
            });
        } catch (error) {
            await this._showError(error?.message || this.t('deployment.errorGeneric'));
        }
    }

    /**
     * Handle edit device target button.
     * Re-opens the target selection dialog so the user can correct the device
     * target type and custom description, then refreshes the UI.
     * @private
     */
    async _handleEditDeviceTarget(): Promise<void> {
        try {
            await this._deviceDeployment.reconfigureDeviceTarget();
            this._updateUI();
        } catch (error) {
            await this._showError(
                this.t('deployment.errorGeneric'),
                error?.message || this.t('deployment.errorGeneric')
            );
        }
    }

    /**
     * Handle refresh device info button.
     * Forces a re-check of device connection state and reloads device info.
     * @private
     */
    async _handleRefreshDeviceInfo(): Promise<void> {
        try {
            this._showLoading();
            // Allow browser to render loading panel before starting async operations
            await new Promise((resolve) => setTimeout(resolve, 0));

            await this._deviceDeployment.refreshConnectionState();
            // After connection state refresh, load device info if connected
            if (this._isDeviceConnected() && this._deviceDeployment.hasMicroPython()) {
                await this._deviceDeployment.refreshDeviceInfo();
                // _onDeviceInfoLoaded() will hide loading panel when complete
            } else {
                // No device info to load, hide loading immediately
                this._hideLoading();
            }
        } catch (error) {
            this._hideLoading();
            await this._showError(
                this.t('deployment.errorRefreshDeviceInfo'),
                error?.message || this.t('deployment.errorGeneric')
            );
        }
    }

    _isDeviceConnected(): boolean {
        return Boolean(this._deviceDeployment.getDeviceConnection()?.isConnected?.());
    }

    async _handleDeployCollection(): Promise<void> {
        try {
            const collection = this._collectionManager.getActiveCollection();
            if (!collection) {
                await this._showError(this.t('deployment.noActiveCollection'));
                return;
            }

            const validation =
                await this._deviceDeployment.validateCollectionCompatibility(collection);
            if (!validation.compatible) {
                await this._showError(
                    this.t('deployment.incompatible'),
                    validation.errors.join('\n')
                );
                return;
            }


            // Refuse to proceed when the runtime mode could not be determined, so a
            // failed firmware-metadata probe never silently falls back to uploading
            // all bundled Python modules as .py sources.
            for (let attempt = 0; attempt < 3; attempt++) {
                const deviceState = this._deviceDeployment.getDeviceState();
                if (deviceState?.runtimeDeploymentMode !== 'unknown') {
                    break;
                }

                const retry = await this._viewManager.showConfirmation({
                    title: this.t('deployment.undeterminedRuntimeTitle'),
                    message: this.t('deployment.undeterminedRuntimeMessage'),
                    confirmLabel: this.t('deployment.undeterminedRuntimeRetry'),
                    cancelLabel: this.t('dialog.cancel'),
                });
                if (!retry) {
                    return;
                }

                await this._handleRefreshDeviceInfo();
            }

            const resolvedState = this._deviceDeployment.getDeviceState();
            if (resolvedState?.runtimeDeploymentMode === 'unknown') {
                await this._showError(
                    this.t('deployment.undeterminedRuntimeTitle'),
                    this.t('deployment.undeterminedRuntimeFailed')
                );
                return;
            }

            // The deploy options dialog lives in DeviceDeployment.deployCollectionInteractive now,
            // so this view and the title-bar quick action share one dialog path.
            await this._deviceDeployment.deployCollectionInteractive(collection, {});
        } catch (error) {
            await this._reportDeployError(error);
        }
    }

    async _handleSyncCollection(): Promise<void> {
        try {
            const collection = this._collectionManager.getActiveCollection();
            if (!collection) {
                await this._showError(this.t('deployment.noActiveCollection'));
                return;
            }

            await this._deviceDeployment.syncCollectionFilesInteractive(collection, {});
        } catch (error) {
            await this._reportDeployError(error);
        }
    }

    /**
     * Report a deploy/sync error unless it is a user cancellation, which stays silent.
     * @param {unknown} error - Error thrown by the deployment layer
     * @returns {Promise<void>}
     * @private
     */
    async _reportDeployError(error: unknown): Promise<void> {
        const code = (error as { code?: string } | null | undefined)?.code;
        if (code === 'DEPLOYMENT_OPTIONS_CANCELLED' || code === 'EMBEDDED_SOURCE_OVERRIDE_DECLINED') {
            return;
        }
        const message = (error as { message?: string } | null | undefined)?.message;
        await this._showError(message || this.t('deployment.errorGeneric'));
    }

    async _handleRemoveCollection(): Promise<void> {
        try {
            const confirmed = await this._viewManager.showConfirmation({
                title: this.t('deployment.confirmRemoveCollection'),
                message: this.t('deployment.confirmRemoveCollectionMessage'),
                confirmLabel: this.t('deployment.remove'),
                cancelLabel: this.t('dialog.cancel'),
                destructive: true,
            });

            if (!confirmed) {
                return;
            }

            await this._deviceDeployment.removeCollection();
        } catch (error) {
            await this._showError(error?.message || this.t('deployment.errorGeneric'));
        }
    }

    /**
     * Update UI using the latest device state.
     * @param {import('../data/device-state.js').DeviceState} [state]
     */
    _updateUI(state: DeviceDeploymentState = this._deviceDeployment.getDeviceState()): void {
        const isConnected = this._isDeviceConnected();
        if (!isConnected) {
            this._hasShownEmbeddedCompatibilityBootstrapPrompt = false;
            this._embeddedCompatibilityBootstrapPromptInProgress = false;
        }

        // Swap panes first: reconnect reattaches the toolbar, so its buttons must
        // be updated after the split has mounted them again.
        this._updateEmptyState(state, isConnected);
        this._updateToolbarLabels();
        this._updateToolbarStates(state);

        if (!isConnected) {
            this._hideLoading();
            return;
        }

        // Show loading if device info is currently being loaded
        if (state.deviceInfoLoading) {
            this._showLoading();
            return;
        }

        // Hide loading and show content
        this._hideLoading();
        this._updateStatusPanel(state);
        this._updateCollectionComparisonPanel(state);
        this._updateDownloadButtonVisibility(state);
        this._maybeShowMicroPythonDialog(state);
    }

    /**
     * Keep the shell's pane set in step with the connection state.
     *
     * Disconnected shows only the Help collapsible; connected restores the toolbar
     * and four status panes. `state` is accepted for the shared `_updateUI()` call
     * shape and intentionally unused.
     * @param {import('../data/device-state.js').DeviceState} state Current device state.
     * @param {boolean} [isConnected] Connection state to render; defaults to live state.
     */
    _updateEmptyState(
        state: DeviceDeploymentState,
        isConnected: boolean = this._isDeviceConnected()
    ): void {
        void state;
        this._syncSplitPaneViews(isConnected);
    }

    /**
     * @param {import('../data/device-state.js').DeviceState} state
     */
    _updateStatusPanel(state: DeviceDeploymentState): void {
        this._setStatusValue(
            'connection',
            this._isDeviceConnected()
                ? this.t('deployment.connected')
                : this.t('deployment.disconnected')
        );

        let micropythonStatus = this.t('deployment.unknown');
        if (state.hasMicroPython === true) {
            micropythonStatus = this.t('deployment.yes');
        } else if (state.hasMicroPython === false) {
            micropythonStatus = this.t('deployment.no');
        }

        this._setStatusValue('micropython-status', micropythonStatus);
        this._setStatusValue('micropython-version', state.micropythonVersion || '-');

        const targetLabel =
            state.deviceTargetInfo?.displayName ||
            state.deviceTargetInfo?.id ||
            this.t('deployment.unknown');
        this._setStatusValue('target', targetLabel);
        this._setStatusValue(
            'user-description',
            state.deviceTargetInfo?.instanceData?.userDescription || '-'
        );

        this._setStatusValue(
            'runtime-installed',
            state.runtimeInstalled ? this.t('deployment.yes') : this.t('deployment.no')
        );
        const runtimeEmbedded =
            Boolean(state.runtimeEmbedded) || state.runtimeDeploymentMode === 'embedded';
        const runtimeModeLabel = runtimeEmbedded
            ? this.t('deployment.runtimeModeEmbedded')
            : this.t('deployment.runtimeModeDynamic');
        this._setStatusValue('runtime-mode', state.runtimeInstalled ? runtimeModeLabel : '-');
        this._setStatusValue('runtime-name', state.runtimeName || '-');
        this._setStatusValue('runtime-version', state.runtimeVersion || '-');
        this._setStatusValue('firmware-full-version', state.firmwareFullVersion || '-');
        this._setStatusValue('runtime-firmware-version', state.runtimeFirmwareVersion || '-');
        this._updateConstituentVersionsTable(state.firmwareConstituentVersions ?? null);
        this._updateNodePackagesTable(state.firmwareConstituentVersions ?? null);
        this._setStatusValue(
            'embedded-packages-summary',
            this._formatEmbeddedPackagesSummary(
                state.runtimeInstalled ? state.embeddedPackagesSummary || null : null
            )
        );

        this._setStatusValue('collection-name', state.collectionName || '-');
        this._setStatusValue('collection-version', state.collectionVersion || '-');
        this._setStatusValue(
            'collection-deployed',
            state.collectionDeployed ? this.t('deployment.yes') : this.t('deployment.no')
        );
    }

    _setStatusValue(field: string, value: string): void {
        const target = this._statusCellTargets.get(field);
        if (target) {
            target.table.updateCell(target.rowIndex, 1, { text: value, data: { field } });
        }
    }

    _formatEmbeddedPackagesSummary(
        summary: DeviceDeploymentState['embeddedPackagesSummary']
    ): string {
        if (!summary || typeof summary !== 'object') {
            return '-';
        }

        const totalPackages = Number(summary.totalPackages);
        const totalFiles = Number(summary.totalFiles);
        const totalBytes = Number(summary.totalBytes);
        if (
            !Number.isFinite(totalPackages) ||
            !Number.isFinite(totalFiles) ||
            !Number.isFinite(totalBytes)
        ) {
            return '-';
        }

        return `${Math.floor(totalPackages)} pkg, ${Math.floor(totalFiles)} files, ${Math.floor(totalBytes)} B`;
    }

    _updateConstituentVersionsTable(versions: FirmwareConstituentVersions | null): void {
        const table = this._constituentVersionsTable;
        if (!table) {
            return;
        }

        const values = [
            versions?.micropythonVersion || '-',
            versions?.runtimeSourceVersion || '-',
            versions?.runtimeFirmwareVersion || '-',
            versions?.deviceToolsVersion || '-',
        ];
        values.forEach((value, index) => {
            table.updateCell(index, 1, { text: value });
        });
    }

    _updateNodePackagesTable(versions: FirmwareConstituentVersions | null): void {
        const table = this._nodePackagesTable;
        if (!table) {
            return;
        }

        const nodePackages = versions?.nodePackages;
        if (!nodePackages || typeof nodePackages !== 'object') {
            table.setRows([{ cells: [{ text: '-' }, { text: '' }] }]);
            return;
        }

        const entries: Array<[string, string]> = Object.entries(nodePackages).map(
            ([name, version]) => [name, String(version ?? '')]
        );
        for (const [id, version] of Object.entries(versions?.addonPackages ?? {})) {
            const frozen = versions?.frozenAddons?.[id];
            const variant = frozen?.variant ?? 'py';
            entries.push([id, `${String(version ?? '')} (${variant})`]);
        }

        const rows = entries.length
            ? entries.map(([name, value]) => ({
                  cells: [{ text: name }, { text: value }],
              }))
            : [{ cells: [{ text: '-' }, { text: '' }] }];
        table.setRows(rows);
    }

    /**
     * @param {import('../data/device-state.js').DeviceState} state
     */
    _updateToolbarStates(state: DeviceDeploymentState): void {
        const isConnected = this._isDeviceConnected();
        const isLoading = Boolean(state.deviceInfoLoading);
        const runtimeInstalled = Boolean(state.runtimeInstalled);
        const runtimeEmbedded =
            Boolean(state.runtimeEmbedded) || state.runtimeDeploymentMode === 'embedded';
        const hasCollection = Boolean(state.collectionDeployed);
        const activeCollection = this._collectionManager.getActiveCollection();
        const embeddedRuntimeTooltip = this.t('deployment.runtimeActionDisabledEmbedded');

        // Refresh button: enabled when connected (even during loading)
        this._setToolbarDisabled('refresh-device-info', !isConnected);

        // Edit device target button: requires a connected device and a known runtime.
        this._setToolbarDisabled(
            'edit-device-target',
            !isConnected || isLoading || !state.runtimeId
        );

        // Install/upgrade runtime button: disabled when the device reports a
        // micro-otter firmware version (runtime is embedded in firmware).
        const hasMicroOtterFirmware = Boolean(state.firmwareFullVersion);
        const disableInstallUpgrade = !isConnected || isLoading || hasMicroOtterFirmware;
        const disableRemoveRuntime =
            !isConnected || isLoading || !runtimeInstalled || runtimeEmbedded;
        this._setToolbarDisabled('install-upgrade-runtime', disableInstallUpgrade);
        this._setToolbarDisabled('remove-runtime', disableRemoveRuntime);

        const canDeploy = isConnected && !isLoading && runtimeInstalled;
        this._setToolbarDisabled('deploy-collection', !canDeploy);
        this._setToolbarDisabled('sync-collection', !canDeploy || !activeCollection);
        this._setToolbarDisabled('remove-collection', !canDeploy || !hasCollection);

        // Update install/upgrade button label based on runtime state
        this._updateInstallUpgradeButtonLabel(runtimeInstalled);

        this._setToolbarTooltipOverride('install-upgrade-runtime', null);
        this._setToolbarTooltipOverride(
            'remove-runtime',
            runtimeEmbedded ? embeddedRuntimeTooltip : null
        );
    }

    _setToolbarDisabled(id: string, disabled: boolean): void {
        const entry = this._toolbarButtons.get(id);
        const button = entry ? this._getToolbarButton(entry.selector) : null;
        if (button) {
            button.disabled = Boolean(disabled);
        }
    }

    _setToolbarTooltipOverride(id: string, tooltipText: string | null): void {
        const entry = this._toolbarButtons.get(id);
        const button = entry ? this._getToolbarButton(entry.selector) : null;
        if (!button || !entry) {
            return;
        }

        if (typeof tooltipText === 'string' && tooltipText.trim().length > 0) {
            const normalized = tooltipText.trim();
            button.title = normalized;
            button.setAttribute('aria-label', normalized);
            return;
        }

        const defaultLabel = this.t(entry.labelKey);
        button.title = defaultLabel;
        button.setAttribute('aria-label', defaultLabel);
    }

    _updateInstallUpgradeButtonLabel(runtimeInstalled: boolean): void {
        const entry = this._toolbarButtons.get('install-upgrade-runtime');
        const button = entry ? this._getToolbarButton(entry.selector) : null;
        if (!button) {
            return;
        }

        const labelKey = runtimeInstalled
            ? 'deployment.upgradeRuntime'
            : 'deployment.installRuntime';
        const label = this.t(labelKey);
        button.title = label;
        button.setAttribute('aria-label', label);

        // Update the text content of the button label if it exists
        const buttonLabel = button.querySelector('.toolbar-btn__label');
        if (buttonLabel) {
            buttonLabel.textContent = label;
        }
    }

    _updateToolbarLabels(): void {
        if (this._toolbarCollapsible) {
            const title = this.t('deployment.toolbarTitle');
            this._toolbarCollapsible.headerTitle = title;
            this._toolbarCollapsible.title = title;
        }

        this._toolbarButtons.forEach(({ selector, labelKey }) => {
            const button = this._getToolbarButton(selector);
            if (!button) {
                return;
            }
            const label = this.t(labelKey);
            button.title = label;
            button.setAttribute('aria-label', label);
        });
    }

    _getToolbarButton(selector: string): HTMLButtonElement | null {
        if (!selector || !this._toolbarView?.container) {
            return null;
        }
        return this._toolbarView.container.querySelector(selector) as HTMLButtonElement | null;
    }

    /**
     * Handle collection change events (targetId changes, etc.)
     * @param {object} _event - Collection change event
     */
    _onCollectionChange(_event: unknown): void {
        // Update collection comparison on any collection change
        const state = this._deviceDeployment.getDeviceState();
        if (this._isDeviceConnected() && state.runtimeInstalled) {
            this._updateCollectionComparisonPanel(state);
        }
    }

    /**
     * Update collection comparison panel.
     * @param {import('../data/device-state.js').DeviceState} state
     */
    _updateCollectionComparisonPanel(state: DeviceDeploymentState): void {
        if (!this._collectionComparisonPanel) {
            return;
        }

        // Only show comparison when device is connected and has runtime
        if (!this._isDeviceConnected() || !state.runtimeInstalled) {
            this._collectionComparisonPanel.style.display = 'none';
            return;
        }

        const collection = this._collectionManager.getActiveCollection();
        if (!collection) {
            this._collectionComparisonPanel.style.display = 'none';
            return;
        }

        this._collectionComparisonPanel.style.display = '';

        // Update local collection info
        this._setComparisonValue('local-name', collection.getTitle());
        this._setComparisonValue('local-version', collection.getVersionString());
        this._setComparisonValue('local-runtime', collection.getDeviceRuntimeId() || '-');
        this._setComparisonValue('local-target', collection.getTargetId() || '-');

        // Update device collection info
        if (state.collectionDeployed) {
            this._setComparisonValue('device-name', state.collectionName || '-');
            this._setComparisonValue('device-version', state.collectionVersion || '-');
            this._setComparisonValue('device-runtime', state.runtimeId || '-');
            this._setComparisonValue('device-target', state.deviceTargetInfo?.id || '-');

            // Graph status
            if (state.collectionHasFullDefinition) {
                this._setComparisonValue(
                    'device-graph-status',
                    '✓ ' + this.t('deviceCollection.device.graphIncluded')
                );
                this._collectionComparisonFields
                    .get('device-graph-status')
                    ?.classList.add('has-graph');
                this._collectionComparisonFields
                    .get('device-graph-status')
                    ?.classList.remove('no-graph');
            } else {
                this._setComparisonValue(
                    'device-graph-status',
                    '✗ ' + this.t('deviceCollection.device.graphMetadataOnly')
                );
                this._collectionComparisonFields
                    .get('device-graph-status')
                    ?.classList.add('no-graph');
                this._collectionComparisonFields
                    .get('device-graph-status')
                    ?.classList.remove('has-graph');
            }
        } else {
            this._setComparisonValue('device-name', this.t('deviceCollection.device.none'));
            this._setComparisonValue('device-version', '-');
            this._setComparisonValue('device-runtime', '-');
            this._setComparisonValue('device-target', '-');
            this._setComparisonValue('device-graph-status', '-');
        }

        // Update status section
        this._updateCollectionComparisonStatus(state, collection);
    }

    /**
     * Update the status section of the collection comparison with compatibility check.
     * @param {import('../data/device-state.js').DeviceState} state
     * @param {object} collection - Active collection
     */
    _updateCollectionComparisonStatus(
        state: DeviceDeploymentState,
        collection: CollectionLike | null
    ): void {
        const requestId = ++this._compatibilityRequestId;
        const statusBody = this._collectionComparisonFields.get('status-body');
        if (!statusBody) {
            return;
        }

        statusBody.innerHTML = '';

        if (!this._isDeviceConnected()) {
            statusBody.textContent = this.t('deployment.compatibilityDisconnected');
            return;
        }

        // Check if device info is loaded
        if (!state.runtimeInstalled) {
            statusBody.textContent = this.t('deployment.compatibilityWaitingForInfo');
            return;
        }

        if (!collection) {
            statusBody.textContent = this.t('deployment.noActiveCollection');
            return;
        }

        // Check basic compatibility
        const collectionTargetId = collection.getTargetId();
        const deviceTargetId = state.deviceTargetInfo?.id;
        const isCompatible = collectionTargetId === deviceTargetId;

        const compatibilityRow = document.createElement('div');
        compatibilityRow.className = 'status-row';

        const compatibilityBadge = document.createElement('span');
        compatibilityBadge.className = isCompatible
            ? 'status-badge compatible'
            : 'status-badge incompatible';
        compatibilityBadge.textContent = isCompatible
            ? '✓ ' + this.t('deviceCollection.status.compatible')
            : '✗ ' + this.t('deviceCollection.status.incompatible');

        compatibilityRow.appendChild(compatibilityBadge);
        statusBody.appendChild(compatibilityRow);

        // Override warning if device has different collection
        if (
            state.collectionDeployed &&
            collection.getTitle() !== state.collectionName &&
            state.collectionName
        ) {
            const warningRow = document.createElement('div');
            warningRow.className = 'status-row warning';

            const warningText = document.createElement('span');
            warningText.className = 'warning-text';
            warningText.textContent = this.t('deviceCollection.status.overrideWarning', {
                collectionName: state.collectionName,
            });

            warningRow.appendChild(warningText);
            statusBody.appendChild(warningRow);
        }

        const checkingRow = document.createElement('div');
        checkingRow.className = 'status-row';
        checkingRow.textContent = this.t('deployment.compatibilityChecking');
        statusBody.appendChild(checkingRow);

        // Run detailed validation
        Promise.resolve()
            .then(async () => {
                const [collectionValidation, packageValidation] = await Promise.all([
                    this._deviceDeployment.validateCollectionCompatibility(collection),
                    Promise.resolve(this._deviceDeployment.validateNodePackages(collection)),
                ]);

                if (requestId !== this._compatibilityRequestId) {
                    return;
                }

                const errors = [
                    ...(collectionValidation?.errors || []),
                    ...(packageValidation?.errors || []),
                ].filter((e) => typeof e === 'string');

                const warnings = [...(packageValidation?.warnings || [])].filter(
                    (w) => typeof w === 'string'
                );

                if (checkingRow.parentNode) {
                    checkingRow.parentNode.removeChild(checkingRow);
                }

                // Badge is compatible when there are no errors (warnings don't block)
                compatibilityBadge.className =
                    isCompatible && !errors.length
                        ? 'status-badge compatible'
                        : 'status-badge incompatible';
                compatibilityBadge.textContent =
                    isCompatible && !errors.length
                        ? '✓ ' + this.t('deviceCollection.status.compatible')
                        : '✗ ' + this.t('deviceCollection.status.incompatible');

                // Show detailed errors if any
                if (errors.length) {
                    const errorList = document.createElement('div');
                    errorList.className = 'compatibility-errors';

                    const heading = document.createElement('h4');
                    heading.textContent = this.t('deployment.errorListHeading');
                    errorList.appendChild(heading);

                    const list = document.createElement('ul');
                    errors.forEach((error) => {
                        const item = document.createElement('li');
                        item.className = 'error';
                        item.textContent = error;
                        list.appendChild(item);
                    });

                    errorList.appendChild(list);
                    statusBody.appendChild(errorList);
                }

                // Show version warnings if any (non-blocking)
                if (warnings.length) {
                    const warningSection = document.createElement('div');
                    warningSection.className = 'status-row warning';

                    const warningHeading = document.createElement('span');
                    warningHeading.className = 'warning-text';
                    warningHeading.textContent = this.t('deployment.packageVersionWarningHeading');
                    warningSection.appendChild(warningHeading);

                    const warningList = document.createElement('ul');
                    warnings.forEach((warning) => {
                        const item = document.createElement('li');
                        item.className = 'warning-text';
                        item.textContent = warning;
                        warningList.appendChild(item);
                    });

                    warningSection.appendChild(warningList);
                    statusBody.appendChild(warningSection);
                }
            })
            .catch((error) => {
                if (requestId !== this._compatibilityRequestId) {
                    return;
                }

                if (checkingRow.parentNode) {
                    checkingRow.parentNode.removeChild(checkingRow);
                }

                const errorDiv = document.createElement('div');
                errorDiv.className = 'status-row error';
                errorDiv.textContent = this.t('deployment.compatibilityError', {
                    error: error.message,
                });
                statusBody.appendChild(errorDiv);
            });
    }

    _setComparisonValue(field: string, value: string): void {
        const element = this._collectionComparisonFields.get(field);
        if (element) {
            element.textContent = value;
        }
    }

    /**
     * Update the visibility of the download collection button.
     * Button is only visible when:
     * - Device is connected
     * - Collection is deployed on device
     * - Collection has full graph definition
     * @param {import('../data/device-state.js').DeviceState} state
     */
    _updateDownloadButtonVisibility(state: DeviceDeploymentState): void {
        if (!this._downloadCollectionButton) {
            return;
        }

        const isVisible =
            this._isDeviceConnected() &&
            state.collectionDeployed &&
            state.collectionHasFullDefinition;

        this._downloadCollectionButton.style.display = isVisible ? '' : 'none';
    }

    /**
     * Handle download collection button click.
     * Downloads the full collection from the device and imports it into the workspace.
     */
    async _handleDownloadCollection(): Promise<void> {
        try {
            // Get collection data from device
            const collectionData = await this._getDeviceCollectionData();

            if (!collectionData) {
                this._showError(this.t('deviceCollection.download.error.noData'));
                return;
            }

            // Verify full definition is included
            if (!collectionData.hasFullDefinition) {
                this._showError(this.t('deviceCollection.download.error.noFullDefinition'));
                return;
            }

            // Check if collection UUID already exists locally
            const existingCollection = await this._collectionManager.loadCollection(
                collectionData.id
            );

            if (existingCollection) {
                // Show confirmation dialog for UUID conflict
                const result = await this._showDownloadConfirmDialog(
                    existingCollection,
                    collectionData
                );

                if (result === 'cancel') {
                    return;
                }

                if (result === 'overwrite') {
                    await this._collectionManager.deleteCollection(collectionData.id);
                    await this._importCollectionFromDevice(collectionData);
                }
                // If 'keep', do nothing
            } else {
                // No conflict - import directly
                await this._importCollectionFromDevice(collectionData);
            }
        } catch (error) {
            console.error('[DeviceDeploymentView] Download collection failed:', error);
            this._showError(
                this.t('deviceCollection.download.error.failed', { error: error.message })
            );
        }
    }

    /**
     * Get the full collection data from the device.
     * @returns {Promise<object>} Collection data with graphs
     */
    async _getDeviceCollectionData(): Promise<DeviceCollectionData> {
        const connection = this._deviceDeployment.getDeviceConnection();
        if (!connection) {
            throw new Error('Device connection unavailable');
        }

        const jsonText = await connection.readTextFile('/collection/node_graph_cln.json');
        const data = JSON.parse(jsonText) as DeviceCollectionApiResponse;

        // Need to map the metadata format to Collection format
        return {
            id: data.uuid,
            title: data.name || data.collectionName || 'Downloaded Collection',
            version: data.version || data.collectionVersion || '1.0.0',
            targetId: data.targetId,
            deviceRuntimeId: data.deviceRuntimeId,
            graphs: data.graphs || [],
            activeGraphIdx: data.activeGraphIdx || 0,
            hasFullDefinition: data.hasFullDefinition || false,
        };
    }

    /**
     * Import collection from device data.
     * @param {object} collectionData - Collection data
     */
    async _importCollectionFromDevice(collectionData: DeviceCollectionData): Promise<void> {
        const collection = Collection.fromData(collectionData);
        await this._collectionManager.saveCollection(collection);
        this._collectionManager.setActiveCollectionId(collection.getId());

        await this._showSuccess(this.t('deviceCollection.download.success.message'));
    }

    /**
     * Show confirmation dialog for collection download with UUID conflict.
     * @param {object} localCollection - Existing local collection
     * @param {object} deviceCollectionData - Collection data from device
     * @returns {Promise<'overwrite'|'keep'|'cancel'>}
     */
    async _showDownloadConfirmDialog(
        localCollection: CollectionLike,
        deviceCollectionData: DeviceCollectionData
    ): Promise<DownloadConfirmDecision> {
        // Use ViewManager confirmation dialog
        // TODO: Create proper DownloadConfirmDialogView with detailed version comparison
        const localName = localCollection.getTitle();
        const localVersion = localCollection.getVersionString();
        const deviceName = deviceCollectionData.title;
        const deviceVersion = deviceCollectionData.version;

        const message = this.t('deviceCollection.download.confirmOverwrite.message', {
            localName,
            localVersion,
            deviceName,
            deviceVersion,
        });

        const confirmed = await this._viewManager.showConfirmation({
            title: this.t('deviceCollection.download.confirmOverwrite.title'),
            message: message,
            confirmLabel: this.t('deviceCollection.download.confirmOverwrite.overwrite'),
            cancelLabel: this.t('deviceCollection.download.confirmOverwrite.cancel'),
            destructive: true,
        });

        return confirmed ? 'overwrite' : 'cancel';
    }

    /**
     * Show success message to user.
     * @param {string} message
     */
    async _showSuccess(message: string): Promise<void> {
        await this._viewManager.showInfo({
            title: this.t('deviceCollection.download.success.title'),
            message: message,
        });
    }

    /**
     * @param {import('../data/device-state.js').DeviceState} state
     */
    _maybeShowMicroPythonDialog(state: DeviceDeploymentState): void {
        if (!this._isDeviceConnected() || state.hasMicroPython !== false) {
            return;
        }

        if (this._hasShownMicroPythonDialog) {
            return;
        }

        this._hasShownMicroPythonDialog = true;
        const steps = document.createElement('div');
        steps.className = 'deployment-micropython-steps';

        const list = document.createElement('ul');
        list.appendChild(this._makeListItem(this.t('deployment.microPythonInstallStep1')));
        list.appendChild(this._makeListItem(this.t('deployment.microPythonInstallStep2')));
        list.appendChild(this._makeListItem(this.t('deployment.microPythonInstallStep3')));
        steps.appendChild(list);

        const dialog = new TextDialogView({
            title: this.t('deployment.microPythonNotDetected'),
            message: this.t('deployment.microPythonNotDetectedMessage'),
            content: steps,
            confirmLabel: this.t('dialog.ok'),
            showCancel: false,
            i18nService: this._i18nService,
        });

        this._viewManager.showModal(dialog, { scrim: true });
    }

    _makeListItem(text: string): HTMLLIElement {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
    }

    /**
     * Forward the one progress source this view still owns.
     *
     * Deployment and runtime writes are reported by the modal `DeploymentProgressDialogView`
     * (`js/app/deployment-progress-controller.ts`), which subscribes to `ProgressEventBus` on its
     * own. The Device tab keeps only `device-info-load`, because that progress belongs to the
     * loading panel of this tab.
     * @param {ProgressEventLike} event Bus event.
     */
    _onProgress(event: ProgressEventLike): void {
        if (event.source === 'device-info-load') {
            this._onDeviceInfoProgress(event);
        }
    }

    _onDeviceInfoProgress(event: ProgressEventLike): void {
        if (!this._loadingPanel) {
            return;
        }

        if (event.type === ProgressEventType.START || event.type === ProgressEventType.UPDATE) {
            this._showLoading();

            if (this._loadingMessageElement) {
                this._loadingMessageElement.textContent =
                    event.message || this.t('deployment.loadingDeviceInfo');
            }

            if (this._loadingProgressElement) {
                const progress = Number.isFinite(event.progress) ? Math.round(event.progress) : 0;
                this._loadingProgressElement.textContent = `${progress}%`;
            }
            return;
        }

        if (event.type === ProgressEventType.COMPLETE) {
            if (this._loadingMessageElement) {
                this._loadingMessageElement.textContent =
                    event.message || this.t('deployment.loadingDeviceInfo');
            }
            if (this._loadingProgressElement) {
                this._loadingProgressElement.textContent = '100%';
            }
            return;
        }

        if (event.type === ProgressEventType.ERROR) {
            if (this._loadingMessageElement) {
                this._loadingMessageElement.textContent =
                    event.message || this.t('deployment.loadingDeviceInfo');
            }
        }
    }

    async _handleOperationError(event: DeploymentEvent): Promise<void> {
        assertDeploymentPayloadType(event, 'DeviceDeploymentView operation-error listener');
        const detail = event?.detail || {};
        if (!detail.error) {
            return;
        }
        await this._showError(detail.error);
    }

    /**
     * Handle device info loaded event.
     * @private
     */
    _onDeviceInfoLoaded(event: DeploymentEvent): void {
        assertDeploymentPayloadType(event, 'DeviceDeploymentView device-info-loaded listener');
        // Device info loaded, update UI from event state or cached state
        const state = event?.detail?.state || this._deviceDeployment.getDeviceState();
        this._log(
            'device-info-loaded-ui-state',
            `runtimeInstalled=${Boolean(state.runtimeInstalled)}; runtimeMode=${state.runtimeDeploymentMode || 'unknown'}; runtimeEmbedded=${Boolean(state.runtimeEmbedded)}; runtimeId=${state.runtimeId || 'none'}`
        );
        this._updateUI(state);
        void this._refreshDynamicLibrariesOnDevice(state);
        void this._maybePromptEmbeddedCompatibilityBootstrap(state);
    }

    /**
     * Fill the Device Info row with the number of `libs/` / `otter_*` files the device user space
     * holds according to the sync manifest. Display-only: it never influences the deploy plan.
     * @param {DeviceDeploymentState} state - Current device state
     * @returns {Promise<void>} Resolves once the row is updated
     */
    async _refreshDynamicLibrariesOnDevice(state: DeviceDeploymentState): Promise<void> {
        const embedded =
            Boolean(state.runtimeEmbedded) || state.runtimeDeploymentMode === 'embedded';
        if (!embedded) {
            this._setStatusValue('dynamic-libraries-on-device', '-');
            return;
        }

        try {
            const paths = await this._deviceDeployment.getDynamicLibraryPathsOnDevice();
            this._setStatusValue(
                'dynamic-libraries-on-device',
                paths.length > 0
                    ? this.t('deployment.fileCountOnDevice', { count: paths.length })
                    : this.t('deployment.noneOnDevice')
            );
        } catch (error) {
            this._log('dynamic-libraries-on-device-failed', 'debug', {
                error: error instanceof Error ? error.message : String(error),
            });
            this._setStatusValue('dynamic-libraries-on-device', '-');
        }
    }

    _needsEmbeddedCompatibilityBootstrap(state: DeviceDeploymentState): boolean {
        const runtimeEmbedded =
            Boolean(state.runtimeEmbedded) || state.runtimeDeploymentMode === 'embedded';
        const runtimeId =
            typeof state.runtimeId === 'string' && state.runtimeId.trim().length > 0
                ? state.runtimeId.trim()
                : null;

        const bootstrapSetupReady =
            typeof state.bootstrapSetupReady === 'boolean' ? state.bootstrapSetupReady : null;
        const needsFromSetupStatus =
            runtimeEmbedded && bootstrapSetupReady === false && Boolean(runtimeId);

        const needsBootstrap =
            needsFromSetupStatus ||
            (runtimeEmbedded && !Boolean(state.runtimeInstalled) && Boolean(runtimeId));
        this._log(
            'embedded-bootstrap-needs-check',
            `needsBootstrap=${needsBootstrap}; runtimeEmbedded=${runtimeEmbedded}; runtimeInstalled=${Boolean(state.runtimeInstalled)}; bootstrapSetupReady=${bootstrapSetupReady}; runtimeId=${runtimeId || 'none'}`
        );
        return needsBootstrap;
    }

    async _maybePromptEmbeddedCompatibilityBootstrap(state: DeviceDeploymentState): Promise<void> {
        if (this._hasShownEmbeddedCompatibilityBootstrapPrompt) {
            this._log('embedded-bootstrap-prompt-skip', 'already shown in this session');
            return;
        }

        if (!this._needsEmbeddedCompatibilityBootstrap(state)) {
            this._log('embedded-bootstrap-prompt-skip', 'bootstrap conditions not met');
            return;
        }

        this._log('embedded-bootstrap-prompt-trigger', 'auto prompt after device info load');
        await this._promptEmbeddedCompatibilityBootstrap(state);
    }

    async _promptEmbeddedCompatibilityBootstrap(state: DeviceDeploymentState): Promise<void> {
        if (!this._needsEmbeddedCompatibilityBootstrap(state)) {
            this._log('embedded-bootstrap-prompt-abort', 'conditions changed before prompt');
            return;
        }

        if (!this._viewManager?.showConfirmation) {
            this._log('embedded-bootstrap-prompt-abort', 'showConfirmation API unavailable');
            return;
        }

        if (this._embeddedCompatibilityBootstrapPromptInProgress) {
            this._log('embedded-bootstrap-prompt-skip', 'prompt already in progress');
            return;
        }

        const runtimeId = typeof state.runtimeId === 'string' ? state.runtimeId.trim() : '';
        if (!runtimeId) {
            this._log('embedded-bootstrap-prompt-abort', 'runtimeId missing');
            return;
        }

        this._hasShownEmbeddedCompatibilityBootstrapPrompt = true;
        this._embeddedCompatibilityBootstrapPromptInProgress = true;
        this._log('embedded-bootstrap-prompt-open', `runtimeId=${runtimeId}`);

        try {
            const runtimeLabel = state.runtimeName || runtimeId;
            const missingSummary = Array.isArray(state.bootstrapSetupStatus?.missingOrInvalid)
                ? state.bootstrapSetupStatus.missingOrInvalid
                      .map((entry) => {
                          const path = typeof entry.path === 'string' ? entry.path : 'unknown';
                          const reason =
                              typeof entry.reason === 'string' && entry.reason.trim().length > 0
                                  ? ` (${entry.reason})`
                                  : '';
                          return `- ${path}${reason}`;
                      })
                      .join('\n')
                : '';

            const accepted = await this._viewManager.showConfirmation({
                title: 'Runtime Setup Required',
                message: [
                    `Detected embedded runtime '${runtimeLabel}', but bootstrap setup is incomplete.`,
                    '',
                    'Run the firmware setup API now to create/repair required runtime files?',
                    missingSummary ? '' : null,
                    missingSummary || null,
                ]
                    .filter((line) => line !== null)
                    .join('\n'),
                confirmLabel: 'Run Setup API',
                cancelLabel: this.t('dialog.cancel'),
            });

            if (!accepted) {
                this._log('embedded-bootstrap-prompt-declined', `runtimeId=${runtimeId}`);
                return;
            }

            this._log('embedded-bootstrap-prompt-accepted', `runtimeId=${runtimeId}`);

            let setupResultFromEvent: any = null;
            const setupResultListener = (event: CustomEvent) => {
                setupResultFromEvent = event?.detail?.setupResult || null;
            };
            this._deviceDeployment.addEventListener(
                'runtime-embedded-compatibility-deployed',
                setupResultListener
            );

            try {
                await this._deviceDeployment.upgradeRuntime(runtimeId, {
                    preserveCollection: true,
                });
            } finally {
                this._deviceDeployment.removeEventListener(
                    'runtime-embedded-compatibility-deployed',
                    setupResultListener
                );
            }

            await this._showEmbeddedBootstrapSetupResultSummary(setupResultFromEvent);

            this._log(
                'embedded-bootstrap-upgrade-dispatched',
                `runtimeId=${runtimeId}; preserveCollection=true`
            );
        } catch (error: any) {
            this._log(
                'embedded-bootstrap-upgrade-failed',
                'error',
                `runtimeId=${runtimeId}; error=${error?.message || this.t('deployment.errorGeneric')}`
            );

            await this._showEmbeddedBootstrapSetupResultSummary(error?.setupResult || null);
            await this._showError(error?.message || this.t('deployment.errorGeneric'));

            // Keep retry path available after recoverable setup failures.
            this._hasShownEmbeddedCompatibilityBootstrapPrompt = false;
        } finally {
            this._embeddedCompatibilityBootstrapPromptInProgress = false;
            this._log('embedded-bootstrap-prompt-close', `runtimeId=${runtimeId}`);
        }
    }

    async _showEmbeddedBootstrapSetupResultSummary(setupResult: any): Promise<void> {
        if (!setupResult || !Array.isArray(setupResult.results) || !this._viewManager?.showInfo) {
            return;
        }

        const resultLines = setupResult.results.map((entry: any) => {
            const path = typeof entry?.path === 'string' ? entry.path : 'unknown';
            const action = typeof entry?.action === 'string' ? entry.action : 'unknown';
            const reason =
                typeof entry?.reason === 'string' && entry.reason.trim().length > 0
                    ? ` (${entry.reason})`
                    : '';
            return `- ${path}: ${action}${reason}`;
        });

        const header =
            setupResult.ok === true
                ? 'Firmware setup API completed.'
                : 'Firmware setup API completed with issues.';

        await this._viewManager.showInfo({
            title: 'Runtime Setup Result',
            message: [header, '', ...resultLines].join('\n'),
        });
    }

    /**
     * Handle device info load error.
     * @private
     * @param {CustomEvent} event
     */
    async _onDeviceInfoLoadError(event: DeploymentEvent): Promise<void> {
        assertDeploymentPayloadType(event, 'DeviceDeploymentView device-info-load-error listener');
        this._hideLoading();

        // Check if error is ENOENT (file not found) - indicates no runtime installed
        const errorMsg = event.detail.error || '';
        if (errorMsg.includes('ENOENT') || errorMsg.includes('not found')) {
            // Show informational dialog instead of error for missing runtime
            await this._viewManager?.showInfo({
                title: this.t('deployment.noRuntimeTitle'),
                message: this.t('deployment.noRuntimeMessage'),
            });
        } else {
            // Show error dialog for other errors
            await this._showError(
                this.t('deployment.errorLoadingDeviceInfo', {
                    error: event.detail.error,
                })
            );
        }
    }

    /**
     * Show loading panel, hide other panels.
     * @private
     */
    _showLoading(): void {
        if (this._loadingPanel) {
            this._loadingPanel.style.display = '';
        }
        if (this._loadingMessageElement) {
            this._loadingMessageElement.textContent = this.t('deployment.loadingDeviceInfo');
        }
        if (this._loadingProgressElement) {
            this._loadingProgressElement.textContent = '0%';
        }
    }

    /**
     * Hide loading panel, show other panels.
     * @private
     */
    _hideLoading(): void {
        if (this._loadingPanel) {
            this._loadingPanel.style.display = 'none';
        }
        if (this._loadingProgressElement) {
            this._loadingProgressElement.textContent = '0%';
        }
    }

    async _showError(message: string, detail: string | null = null): Promise<void> {
        if (!this._viewManager?.showError) {
            this._log('show-error-fallback', 'error', { message, detail });
            return;
        }

        await this._viewManager.showError({
            title: this.t('deployment.errorTitle'),
            message,
            detail,
        });
    }

    serialize(): ViewBaseSerialized {
        return {
            ...super.serialize(),
            type: 'DeviceDeploymentView',
        };
    }

    static deserialize(
        data: Record<string, any> = {},
        _viewFactory: unknown = null,
        context: Partial<DeviceDeploymentViewOptions> = {}
    ): DeviceDeploymentView {
        const {
            deviceDeployment,
            runtimeCollection,
            collectionManager,
            viewManager,
            i18nService = null,
            logger = null,
        } = context;

        return new DeviceDeploymentView({
            deviceDeployment,
            runtimeCollection,
            collectionManager,
            viewManager,
            i18nService,
            logger,
            title: data.title || 'Deployment',
            icon: data.icon || IconProvider.upload,
            id: data.id || null,
        });
    }
}
