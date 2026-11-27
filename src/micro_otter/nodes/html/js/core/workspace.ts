// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { Collection } from '../data/collection.js';
import { CollectionManager } from '../data/collection-manager.js';
import { CollectionStore } from '../data/collection-store.js';
import { NodeGraph } from '../data/node-graph.js';
import { WorkspaceConfig } from '../data/workspace-config.js';
import { WorkspaceConfigStore } from '../data/workspace-config-store.js';
import {
    TargetConfigStore,
    type TargetConfigInput,
    type TargetConfigConflict,
    type TargetConfigRecord,
} from '../data/target-config-store.js';
import { generateUuidV4 } from '../data/uuid.js';
import { DeviceRuntimeCollection } from '../data/device-runtime-collection.js';
import { registerRuntimeDataTypesForCollection } from '../data/runtime-data-type-registration.js';
import { ViewManager } from '../views/view-manager.js';
import {
    ProgressTracker,
    ProgressEvent,
    ProgressEventBus,
    ProgressEventType,
} from './progress-events.js';
import { SplashScreen } from '../views/splash-screen.js';
import { I18nService } from '../i18n/i18n-service.js';
import { Transpiler } from '../proc/transpiler.js';
import { DeviceConnection } from '../serial/device-connection.js';
import { WebSerialConnection } from '../serial/webserial-connection.js';
import { WebSocketConnection } from '../serial/websocket-connection.js';
import { DeviceDeployment } from '../deployment/device-deployment.js';
import { setDataTypeColorRegistryResolver } from '../nodes/data-type-colors.js';
import { AppEvent, AppPayload } from './app-event.js';
import { AppEventEmitter } from './app-event-emitter.js';

const RUNTIME_COLLECTION_ROOT = '/device/runtime';

type WorkspaceLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface WorkspaceLoggerApi {
    log: (className: string, reason: string, level: WorkspaceLogLevel, ...data: unknown[]) => void;
}

interface WorkspaceWindow extends Window {
    microOtterWorkspace?: Workspace;
}

interface WorkspaceOptions {
    collectionStore?: CollectionStore | null;
    configStore?: WorkspaceConfigStore | null;
    targetConfigStore?: TargetConfigStore | null;
    viewManager?: ViewManager | null;
    splashScreen?: SplashScreen | null;
    i18nService?: I18nService | null;
}

interface SaveUserTargetConfigOptions {
    allowOverwrite?: boolean;
}

interface UserTargetConfigConflictDetails {
    type: 'id' | 'displayName';
    incoming: TargetConfigRecord;
    existing: TargetConfigRecord;
}

interface CollectionRepairReport {
    collectionId: string;
    repairs?: Array<{ field?: string; previousValue?: unknown; nextValue?: unknown }>;
}

// Expected initialization sources that must complete before hiding splash
const EXPECTED_INITIALIZATION_SOURCES = new Set([
    'feature-detection',
    'workspace',
    'device-runtime',
    'node-packages',
    'views',
]);

/**
 * Payload for active collection switching events.
 */
class WorkspaceActiveCollectionChangedPayload extends AppPayload {
    /**
     * @param {string|null} collectionId - ID of the newly active collection, or null when none is active.
     */
    constructor(collectionId: string | null) {
        super('Workspace.ActiveCollectionChanged.v1');
        this.collectionId = collectionId;
    }
}

/**
 * Payload for workspace-level relayed collection events.
 */
class WorkspaceCollectionChangedPayload extends AppPayload {
    /**
     * @param {string} collectionId - ID of the active collection that produced the change.
     * @param {string} changeType - Collection event name relayed by Workspace.
     * @param {string} collectionEventName - Original collection event name.
     * @param {string} collectionEventPayloadTypeId - Payload type ID from the original collection event.
     * @param {AppPayload} collectionEventDetail - Original collection payload detail for downstream handlers.
     */
    constructor(
        collectionId: string,
        changeType: string,
        collectionEventName: string,
        collectionEventPayloadTypeId: string,
        collectionEventDetail: AppPayload
    ) {
        super('Workspace.CollectionChanged.v1');
        this.collectionId = collectionId;
        this.changeType = changeType;
        this.collectionEventName = collectionEventName;
        this.collectionEventPayloadTypeId = collectionEventPayloadTypeId;
        this.collectionEventDetail = collectionEventDetail;
    }
}

/**
 * Payload for collection creation events.
 */
class WorkspaceCollectionCreatedPayload extends AppPayload {
    /**
     * @param {string} collectionId - ID of the collection that was created or first saved.
     */
    constructor(collectionId: string) {
        super('Workspace.CollectionCreated.v1');
        this.collectionId = collectionId;
    }
}

/**
 * Payload for collection deletion events.
 */
class WorkspaceCollectionDeletedPayload extends AppPayload {
    /**
     * @param {string} collectionId - ID of the collection that was removed from workspace state.
     */
    constructor(collectionId: string) {
        super('Workspace.CollectionDeleted.v1');
        this.collectionId = collectionId;
    }
}

/**
 * Payload for workspace config updates.
 */
class WorkspaceConfigChangedPayload extends AppPayload {
    /**
     * @param {string} key - Config property name that changed.
     * @param {*} value - New value assigned to the config property.
     */
    constructor(key: string, value: unknown) {
        super('Workspace.ConfigChanged.v1');
        this.key = key;
        this.value = value;
    }
}

/**
 * Payload for workspace clear/reset events.
 */
class WorkspaceClearedPayload extends AppPayload {
    constructor() {
        super('Workspace.Cleared.v1');
    }
}

function assertCollectionAppEvent(
    event: AppEvent,
    context = 'Workspace collection listener'
): AppEvent {
    if (!(event instanceof AppEvent)) {
        throw new TypeError(`${context}: expected AppEvent instance`);
    }

    const payloadTypeId = event.detail?.payloadTypeId;
    if (typeof payloadTypeId !== 'string' || !payloadTypeId.startsWith('Collection.')) {
        throw new TypeError(
            `${context}: expected Collection.* payloadTypeId but received '${payloadTypeId}'`
        );
    }

    return event;
}

/**
 * Workspace coordinates collections, persistence stores, and change propagation.
 *
 * Events fired through {@link onChange} listeners:
 * - `activeCollectionChanged` with `Workspace.ActiveCollectionChanged.v1`
 * - `collectionChanged` with `Workspace.CollectionChanged.v1`
 * - `collectionCreated` with `Workspace.CollectionCreated.v1`
 * - `collectionDeleted` with `Workspace.CollectionDeleted.v1`
 * - `configChanged` with `Workspace.ConfigChanged.v1`
 * - `workspaceCleared` with `Workspace.Cleared.v1`
 */
class Workspace extends AppEventEmitter {
    #nodeDragActive: boolean;
    #suppressCollectionPersistenceDuringLoad: boolean;
    #progressListener: ((event: ProgressEvent) => void) | null;
    #completedSources: Set<string>;
    #splashHideTimeout: ReturnType<typeof setTimeout> | null;
    #pendingCollectionRepairReports: CollectionRepairReport[];

    collectionStore: CollectionStore;
    configStore: WorkspaceConfigStore;
    targetConfigStore: TargetConfigStore;
    collectionManager: CollectionManager;
    collections: Map<string, Collection>;
    config: WorkspaceConfig | null;
    runtimeCollection: DeviceRuntimeCollection | null;
    i18nService: I18nService;
    viewManager: ViewManager;
    transpiler: Transpiler | null;
    userTargetConfigsById: Map<string, TargetConfigRecord>;
    deviceConnection: DeviceConnection;
    deviceDeployment: DeviceDeployment | null;
    splashScreen: SplashScreen;
    unregisterCollectionChangeHandler: (() => void) | null;

    /**
     * @param {{
     *  collectionStore?: CollectionStore,
     *  configStore?: WorkspaceConfigStore,
     *  collections?: Collection[],
     *  viewManager?: ViewManager,
     *  splashScreen?: SplashScreen,
     *  i18nService?: I18nService,
     * }} [options]
     */
    constructor({
        collectionStore = null,
        configStore = null,
        targetConfigStore = null,
        viewManager = null,
        splashScreen = null,
        i18nService = null,
    }: WorkspaceOptions = {}) {
        super();
        this._log('constructor', 'debug', 'Constructor called with splashScreen:', splashScreen);

        this.collectionStore = collectionStore || new CollectionStore();
        this.configStore = configStore || new WorkspaceConfigStore();
        this.targetConfigStore =
            targetConfigStore ||
            new TargetConfigStore({
                isShippedTarget: (targetId) => this.#hasRuntimeTargetId(targetId),
                isUserTarget: (targetId) => this.userTargetConfigsById.has(targetId),
            });
        this.collectionManager = new CollectionManager({
            collectionStore: this.collectionStore,
            logger: console as any,
        });
        this.collections = this.collectionManager.getCollections();
        this.config = null;
        this.runtimeCollection = null;
        // Create i18nService first so it can be shared with ViewManager
        this.i18nService = i18nService || new I18nService();
        this.viewManager =
            viewManager ||
            new ViewManager({
                logEvents: false,
                theme: 'standard',
                i18nService: this.i18nService,
            });

        this.transpiler = new Transpiler({
            logger: console as any,
        });
        this.userTargetConfigsById = new Map();

        this.collectionManager.setTranspiler(this.transpiler);

        setDataTypeColorRegistryResolver(
            () => this.getActiveCollection()?.getDataTypeRegistry() || null
        );

        // Create device connection with WebSerial and WebSocket providers
        this.deviceConnection = new DeviceConnection({
            providers: {
                webserial: {
                    name: 'Web Serial',
                    description: 'USB serial connection via Web Serial API',
                    instance: new WebSerialConnection(),
                },
                websocket: {
                    name: 'WebSocket (Bridge)',
                    description: 'Serial connection via the local WebSocket bridge',
                    instance: new WebSocketConnection(),
                },
            },
            defaultProvider: 'webserial',
            logger: console as any,
            i18nService: this.i18nService,
        });

        // Subscribe to connection events for logging
        this.deviceConnection.addEventListener(
            'connection-state',
            (event: Event & { detail?: unknown }) => {
                this._log('device-connection', 'info', 'Connection state:', event.detail);
            }
        );

        // Note: DeviceDeployment is created after runtimeCollection loads in load()
        // to ensure dependencies are properly initialized
        this.deviceDeployment = null;

        // Provide workspace reference to ViewManager for view deserialization
        // deviceRuntime and workspaceConfig will be set later in load()
        this.viewManager.updateViewContext({
            workspace: this,
            viewManager: this.viewManager,
            transpiler: this.transpiler,
            collectionManager: this.collectionManager,
            deviceConnection: this.deviceConnection,
        });

        // Create or use provided splash screen
        this.splashScreen = splashScreen || new SplashScreen();
        this._log('constructor', 'debug', 'Using splash screen:', this.splashScreen);
        this._log('constructor', 'debug', 'Splash isVisible:', this.splashScreen.isVisible);

        this.unregisterCollectionChangeHandler = null;
        this.#nodeDragActive = false;
        this.#suppressCollectionPersistenceDuringLoad = false;
        this.#completedSources = new Set();
        this.#splashHideTimeout = null;
        this.#pendingCollectionRepairReports = [];

        // Subscribe to progress events and forward to splash screen
        this._log('progress-subscription', 'debug', 'Subscribing to ProgressEventBus');
        this.#progressListener = (event) => {
            this._log(
                'progress-event',
                'debug',
                'Progress event received:',
                event.type,
                event.source,
                event.message
            );
            this.splashScreen.updateProgress(event);

            // Track COMPLETE events from initialization sources
            if (event.type === ProgressEventType.COMPLETE) {
                this._log('progress-complete', 'debug', 'COMPLETE event from:', event.source);
                this.#onSourceComplete(event.source);
            }
        };
        ProgressEventBus.subscribe(this.#progressListener);
        this._log('progress-subscription', 'debug', 'Subscribed to ProgressEventBus');

        // Show splash screen immediately during construction
        this._log('splash-show', 'debug', 'Showing splash screen (if not already visible)...');
        this.splashScreen
            .show()
            .catch((error) => {
                console.warn('[Workspace] Failed to show splash screen', error);
            })
            .then(() => {
                this._log(
                    'splash-show',
                    'debug',
                    'Splash show() completed, isVisible:',
                    this.splashScreen.isVisible
                );
            });

        // Export workspace globally for debugging
        if (typeof window !== 'undefined') {
            (window as WorkspaceWindow).microOtterWorkspace = this;
        }
    }

    /**
     * Log a message with automatic class name capture.
     * @param {string} reason - Reason/event identifier
     * @param {string} [level='debug'] - Log level: 'debug' | 'info' | 'warn' | 'error'
     * @param {...any} data - Optional data to log
     * @private
     */
    _log(reason: string, level: WorkspaceLogLevel = 'debug', ...data: unknown[]): void {
        if (typeof globalThis.__microOtterLog !== 'undefined') {
            const { log } = globalThis.__microOtterLog as WorkspaceLoggerApi;

            // Support old signature: _log(reason, data) without level
            const validLevels = ['debug', 'info', 'warn', 'error'];
            const actualLevel = validLevels.includes(level) ? level : 'debug';
            const actualData = validLevels.includes(level) ? data : [level, ...data];

            log('Workspace', reason, actualLevel, ...actualData);
        }
    }

    async load(): Promise<void> {
        // Create progress tracker for workspace initialization
        const progress = new ProgressTracker('workspace', 5);
        this.#suppressCollectionPersistenceDuringLoad = true;

        try {
            progress.start('Initializing workspace...');

            this.collectionManager.setCollections(new Map());
            this.collections = this.collectionManager.getCollections();
            this.config = null;
            let firstCollection = false;

            // Step 1: Load runtime collection
            progress.update('Loading device runtime collection...', 1);
            this.runtimeCollection = new DeviceRuntimeCollection(RUNTIME_COLLECTION_ROOT);
            await this.runtimeCollection.load().catch((error) => {
                console.error('[Workspace] Failed to load runtime collection', error);
                throw new Error('Failed to load runtime collection: ' + error.message);
            });
            this.collectionManager.setDefaultDeviceRuntimeId(
                this.runtimeCollection.getDefaultRuntimeId()
            );
            this.collectionManager.setRuntimeCollection(this.runtimeCollection);

            // Create DeviceDeployment now that runtimeCollection is loaded
            if (!this.deviceDeployment) {
                this.deviceDeployment = new DeviceDeployment({
                    deviceConnection: this.deviceConnection,
                    collectionManager: this.collectionManager,
                    runtimeCollection: this.runtimeCollection,
                    transpiler: this.transpiler,
                    i18nService: this.i18nService,
                    viewManager: this.viewManager,
                });
            }

            this.viewManager.updateViewContext({
                deviceDeployment: this.deviceDeployment,
                runtimeCollection: this.runtimeCollection,
            });

            // Step 2: Load collections from store
            progress.update('Loading collections from store...', 2);
            this._log('load-collections', 'debug', 'Loading collections from store');
            const storedCollections = await this.collectionManager.loadCollections();
            this.#pendingCollectionRepairReports = this.collectionManager.getLastLoadRepairs();
            this._log(
                'load-collections',
                'debug',
                `Loaded ${storedCollections.length} collections from store`
            );

            const userTargetConfigs = await this.targetConfigStore.listTargetConfigs();
            this.userTargetConfigsById.clear();
            for (const configRecord of userTargetConfigs) {
                this.userTargetConfigsById.set(configRecord.id, configRecord);
            }
            this.#syncUserTargetsIntoCollectionManager();

            // Note: ViewFactory's deviceRuntime will be set later after we determine active collection

            // Step 3: Initialize workspace config
            progress.update('Initializing workspace configuration...', 3);
            if (storedCollections.length === 0) {
                firstCollection = true;
                const starter = this.#buildStarterCollection();
                this._log(
                    'starter-collection',
                    'debug',
                    'No collections found; creating starter collection with id',
                    starter.getId()
                );

                storedCollections.push(starter);
                this.config = new WorkspaceConfig({
                    activeCollectionId: starter.getId(),
                    selectedDeviceRuntimeId: this.runtimeCollection.getDefaultRuntimeId(),
                    collectionManager: { activeCollectionId: starter.getId() },
                });
            } else {
                this.config = await this.configStore.getConfig();
                // Ensure selectedDeviceRuntimeId is initialized if not present
                if (!this.config.selectedDeviceRuntimeId) {
                    this.config.selectedDeviceRuntimeId =
                        this.runtimeCollection.getDefaultRuntimeId();
                }
            }

            // Ensure theme is initialized and apply it to ViewManager.
            this.config.theme = this.viewManager.setTheme(
                this.config.theme || this.viewManager.theme
            );

            // Load i18n service with stored locale
            if (this.config.locale) {
                (this.i18nService as any)._initialLocale = this.config.locale;
            }

            // Load i18n manifest and translations
            await this.i18nService.load().catch((error) => {
                console.warn('[Workspace] Failed to load i18n service', error);
            });

            // Step 4: Process collections and validate runtimes
            progress.update('Processing collections...', 4);
            // Create a map of collections, skipping those that reference missing runtimes
            for (const collection of storedCollections) {
                const runtimeId = collection.getDeviceRuntimeId();
                if (!this.runtimeCollection.hasRuntime(runtimeId)) {
                    console.warn(
                        `[Workspace] Collection ${collection.getId()} references missing runtime id:`,
                        runtimeId
                    );
                    this.collectionManager.discardCollection(collection.getId());
                    continue;
                }

                const runtime = this.runtimeCollection.getRuntime(runtimeId);
                registerRuntimeDataTypesForCollection(collection, runtime);
            }
            this.collectionManager.deserialize(this.config.collectionManager || {});

            if (
                !this.collectionManager.getActiveCollectionId() &&
                this.config.activeCollectionId &&
                this.collectionManager.hasCollection(this.config.activeCollectionId)
            ) {
                this.collectionManager.setActiveCollectionId(this.config.activeCollectionId);
            }

            this._log(
                'config-loaded',
                'debug',
                `Workspace config loaded; Available collections=${this.collections.size}, activeCollectionId=${this.config.activeCollectionId}`
            );

            // Step 5: Ensure at least one collection exists and an active one is set
            progress.update('Finalizing workspace setup...', 5);

            // If no collections exist at all, create a starter collection
            if (this.collectionManager.getCollectionIds().length === 0) {
                this._log(
                    'no-collections',
                    'warn',
                    'No collections found, creating starter collection'
                );
                const starter = this.#buildStarterCollection();
                await this.collectionManager.saveCollection(starter);
                this.config.activeCollectionId = starter.getId();
                this.collectionManager.setActiveCollectionId(starter.getId());
                await this.#persistConfig();
            }
            // If collections exist but no active collection is set or active collection was deleted
            else if (
                !this.config.activeCollectionId ||
                !this.collectionManager.hasCollection(this.config.activeCollectionId)
            ) {
                this._log(
                    'invalid-active-collection',
                    'warn',
                    'Active collection missing, setting first available'
                );
                const firstId = this.getCollectionIds()[0];
                this.config.activeCollectionId = firstId;
                this.collectionManager.setActiveCollectionId(firstId);
                await this.#persistConfig();
            }

            // Legacy: handle firstCollection case from old code
            if (firstCollection) {
                await this.saveActiveCollection().catch((error) => {
                    console.warn('[Workspace] Failed to persist starter collection', error);
                });
                await this.#persistConfig();
            }

            const activeCollection = this.getActiveCollection();
            let activeRuntime = null;
            if (activeCollection) {
                this.unregisterCollectionChangeHandler = activeCollection.on(
                    '*',
                    this.#onCollectionChange.bind(this)
                );

                // Get the active collection's device runtime
                const activeRuntimeId = activeCollection.getDeviceRuntimeId();
                activeRuntime = this.runtimeCollection.getRuntime(activeRuntimeId);
                if (!activeRuntime) {
                    console.warn(`[Workspace] Active runtime not found: ${activeRuntimeId}`);
                }
            }

            // ALWAYS update ViewManager context before the layout is built
            // This ensures views like DeviceConnectionView have required dependencies
            this.viewManager.updateViewContext({
                workspaceConfig: this.config,
                deviceRuntime: activeRuntime,
                runtimeCollection: this.runtimeCollection,
                deviceConnection: this.deviceConnection,
                deviceDeployment: this.deviceDeployment,
                collectionManager: this.collectionManager,
                transpiler: this.transpiler,
            });

            // View layout restore is intentionally disabled. The app rebuilds the
            // layout from code on every load (main.ts buildDefaultLayout()), so a
            // restored serialized tree here would only be a throwaway layout that
            // gets replaced immediately.

            progress.complete('Workspace ready');
        } catch (error) {
            progress.error('Workspace initialization failed', error);
            throw error;
        } finally {
            this.#suppressCollectionPersistenceDuringLoad = false;
        }
    }

    /**
     * Show queued data-repair notifications after the app UI has been mounted.
     * @returns {Promise<void>}
     */
    async showPendingCollectionRepairDialog(): Promise<void> {
        if (!Array.isArray(this.#pendingCollectionRepairReports)) {
            this.#pendingCollectionRepairReports = [];
            return;
        }
        if (this.#pendingCollectionRepairReports.length === 0) {
            return;
        }

        const reports = this.#pendingCollectionRepairReports;
        this.#pendingCollectionRepairReports = [];

        const detailLines = reports.map((report) => {
            const repairDescriptions = Array.isArray(report.repairs)
                ? report.repairs.map((repair) => {
                      if (repair?.field === 'activeGraphIdx') {
                          return this.i18nService.t('workspace.repairDetailActiveGraphIdx', {
                              previousValue: repair.previousValue,
                              nextValue: repair.nextValue,
                          });
                      }
                      return this.i18nService.t('workspace.repairDetailUnknown', {
                          field: repair?.field || 'unknown',
                      });
                  })
                : [this.i18nService.t('workspace.repairDetailUnknown', { field: 'unknown' })];
            return `- ${report.collectionId}: ${repairDescriptions.join(', ')}`;
        });

        this._log('collection-repaired', 'warn', {
            repairedCollections: reports.length,
            reports,
        });

        await this.viewManager.showError({
            title: this.i18nService.t('workspace.collectionRepairTitle'),
            message:
                reports.length === 1
                    ? this.i18nService.t('workspace.collectionRepairMessageSingle')
                    : this.i18nService.t('workspace.collectionRepairMessageMultiple', {
                          count: reports.length,
                      }),
            detail: detailLines.join('\n'),
            detailCollapsible: true,
        });
    }

    /**
     * Build a minimal starter collection with one empty graph.
     * @returns {Collection}
     */
    #buildStarterCollection(): Collection {
        const initGraph = new NodeGraph({ id: 'init-graph', name: 'Init', executionType: 'startup' });
        const starterGraph = new NodeGraph({ id: 'graph-1', name: 'Graph 1', executionType: 'continuous' });
        return new Collection({
            id: generateUuidV4(),
            graphs: [initGraph, starterGraph],
            activeGraphIdx: 1,
            deviceRuntimeId: this.runtimeCollection.getDefaultRuntimeId(),
        } as any);
    }

    /**
     * Persist the active collection id into the workspace config store.
     * @param {string|null} collectionId
     */
    async #persistConfig(): Promise<void> {
        // View layout is intentionally not persisted: the layout is rebuilt from
        // code on every load, so persisting the serialized tree would only capture
        // design constants that are never actually restored.
        this.config.collectionManager = this.collectionManager.serialize();
        await this.configStore.saveConfig(this.config);
    }

    /**
     * Notify listeners of a workspace-level event.
     * @param {string} name
     * @param {AppPayload} payload
     */
    #emitChange(name: string, payload: AppPayload): void {
        this.emit(name, payload);
    }

    /**
     * Persist graph-level changes from the active collection and re-emit them at the workspace level.
     * @param {import('../core/app-event.js').AppEvent} event
     */
    async #onCollectionChange(event: AppEvent): Promise<void> {
        assertCollectionAppEvent(event, 'Workspace collection listener');
        const changeType = event.name;
        const collectionDetail = event.detail;
        const isVersionDebugEnabled =
            (globalThis as Record<string, unknown>).__microOtterDebugVersionBump === true;

        const emitVersionDebug = (reason: string, details: Record<string, unknown> = {}) => {
            if (!isVersionDebugEnabled) {
                return;
            }
            const globalLogger = (globalThis as Record<string, unknown>).__microOtterLog as
                | {
                      log?: (
                          className: string,
                          reason: string,
                          level: 'debug' | 'info' | 'warn' | 'error',
                          ...data: unknown[]
                      ) => void;
                  }
                | undefined;
            if (typeof globalLogger?.log === 'function') {
                globalLogger.log('Workspace', 'version-debug', 'info', {
                    reason,
                    ...details,
                });
                return;
            }
            if (typeof console !== 'undefined' && typeof console.log === 'function') {
                console.log('[Workspace:version-debug]', {
                    reason,
                    ...details,
                });
            }
        };

        this._log('collection-change', 'debug', 'Collection change event:', {
            changeType,
            payloadTypeId: collectionDetail?.payloadTypeId,
        });
        emitVersionDebug('collection-change-received', {
            changeType,
            payloadTypeId: collectionDetail?.payloadTypeId,
            detailType: collectionDetail?.type || null,
            suppressingDuringLoad: this.#suppressCollectionPersistenceDuringLoad,
            nodeDragActive: this.#nodeDragActive,
        });
        if (changeType === 'graph') {
            const subType = collectionDetail?.type || '';
            if (subType === 'node-drag-started') {
                this.#nodeDragActive = true;
                emitVersionDebug('collection-change-node-drag-started');
                return;
            }
            if (subType === 'node-drag-ended') {
                this.#nodeDragActive = false;
                this._log('node-drag', 'debug', 'Node drag ended; saving now.');
                emitVersionDebug('collection-change-node-drag-ended');
            }
        }

        if (this.#nodeDragActive) {
            emitVersionDebug('collection-change-skipped-node-drag-active');
            return;
        }

        if (this.#suppressCollectionPersistenceDuringLoad) {
            this._log(
                'collection-change',
                'debug',
                'Skipping persistence during startup hydration window'
            );
            emitVersionDebug('collection-change-skipped-startup-hydration-window');
            return;
        }

        emitVersionDebug('collection-change-persisting-active-collection', {
            activeCollectionId: this.getActiveCollection()?.getId() || null,
        });
        await this.saveActiveCollection().catch((error) => {
            console.warn(
                '[Workspace] Failed to persist active collection after graph change',
                error
            );
            emitVersionDebug('collection-change-persist-failed', {
                error: String((error as Error)?.message || error),
            });
        });

        emitVersionDebug('collection-change-persisted-active-collection', {
            activeCollectionId: this.getActiveCollection()?.getId() || null,
        });

        const collectionId = this.getActiveCollection()?.getId() || null;
        if (collectionId === null) {
            console.warn(
                '[Workspace] Received collection change event but no active collection is set'
            );
        } else {
            this.#emitChange(
                'collectionChanged',
                new WorkspaceCollectionChangedPayload(
                    collectionId,
                    changeType,
                    event.name,
                    collectionDetail.payloadTypeId,
                    collectionDetail
                )
            );
        }
    }

    /**
     * Get active collection id.
     * @returns {string|null}
     */
    getActiveCollectionId(): string | null {
        return this.collectionManager.getActiveCollectionId();
    }

    /**
     * Set the active collection id and persist the config.
     * @param {string|null} collectionId
     * @returns {Promise<void>}
     */
    async setActiveCollectionId(collectionId: string | null): Promise<void> {
        if (collectionId && !this.collectionManager.hasCollection(collectionId)) {
            throw new Error(`Collection id "${collectionId}" does not exist`);
        }

        // Unregister old collection change handler
        this.unregisterCollectionChangeHandler?.();

        // Update active collection ID
        this.config.activeCollectionId = collectionId || null;
        this.collectionManager.setActiveCollectionId(collectionId || null);

        // Register change handler on NEW active collection
        const activeCollection = this.getActiveCollection();
        if (activeCollection) {
            this.unregisterCollectionChangeHandler = activeCollection.on(
                '*',
                this.#onCollectionChange.bind(this)
            );

            const runtime =
                this.runtimeCollection?.getRuntime(activeCollection.getDeviceRuntimeId()) || null;
            registerRuntimeDataTypesForCollection(activeCollection, runtime);
        }

        await this.#persistConfig();
        this.#emitChange(
            'activeCollectionChanged',
            new WorkspaceActiveCollectionChangedPayload(collectionId)
        );
    }

    /**
     * Get the active Collection instance.
     * @returns {Collection|null}
     */
    getActiveCollection(): Collection | null {
        return this.collectionManager.getActiveCollection();
    }

    /**
     * List collection ids currently loaded in memory.
     * @returns {string[]}
     */
    getCollectionIds(): string[] {
        return this.collectionManager.getCollectionIds();
    }

    /**
     * Fetch a collection by id from memory; falls back to the store if missing.
     * @param {string} collectionId
     * @returns {Promise<Collection|null>}
     */
    async getCollection(collectionId: string): Promise<Collection | null> {
        try {
            return await this.collectionManager.loadCollection(collectionId);
        } catch (error) {
            console.warn('[Workspace] Failed to load collection', error);
        }
        return null;
    }

    /**
     * Create and persist a new collection.
     * @param {{title?:string,targetId?:string,deviceRuntimeId?:string,graphs?:Array<object|NodeGraph>}} [options]
     * @returns {Promise<Collection>}
     */
    async createCollection(
        options: {
            title?: string;
            targetId?: string;
            deviceRuntimeId?: string;
            graphs?: Array<object | NodeGraph>;
        } = {}
    ): Promise<Collection> {
        const collection = await this.collectionManager.createCollection({
            title: options.title,
            targetId: options.targetId,
            deviceRuntimeId: options.deviceRuntimeId,
            graphs: options.graphs,
            setActive: true,
        });
        await this.setActiveCollectionId(collection.getId());
        this.#emitChange(
            'collectionCreated',
            new WorkspaceCollectionCreatedPayload(collection.getId())
        );
        return collection;
    }

    /**
     * Save a collection to the store and add it to the workspace.
     * @param {Collection} collection - The collection instance to save
     * @returns {Promise<void>}
     */
    async saveCollection(collection: Collection): Promise<void> {
        const collectionId = collection.getId();
        const isNew = !this.collectionManager.hasCollection(collectionId);
        await this.collectionManager.saveCollection(collection);
        if (isNew) {
            this.#emitChange(
                'collectionCreated',
                new WorkspaceCollectionCreatedPayload(collectionId)
            );
        }
    }

    /**
     * Delete a collection; updates the active id if needed.
     * @param {string} collectionId
     */
    async deleteCollection(collectionId: string): Promise<void> {
        if (!collectionId) {
            return;
        }
        const isActive = this.config.activeCollectionId === collectionId;
        if (isActive) {
            const remainingIds = this.getCollectionIds().filter((id) => id !== collectionId);
            if (remainingIds.length > 0) {
                await this.setActiveCollectionId(remainingIds[0]);
            } else {
                const newCollection = await this.createCollection();
                await this.setActiveCollectionId(newCollection.getId());
            }
        }
        await this.collectionManager.deleteCollection(collectionId, { ensureActive: false });
        this.#emitChange('collectionDeleted', new WorkspaceCollectionDeletedPayload(collectionId));
    }

    /**
     * Remove all collections and config state.
     */
    async clearAll(): Promise<void> {
        await this.collectionManager.clearCollections();
        await this.configStore.clearConfig();
        this.config.activeCollectionId = null;
        this.#emitChange('workspaceCleared', new WorkspaceClearedPayload());
    }

    /**
     * Convenience: ensure an active collection exists, creating one if needed.
     * @returns {Promise<Collection>}
     */
    async ensureActiveCollection(): Promise<Collection> {
        const active = this.getActiveCollection();
        if (active) {
            return active;
        }
        const collection = await this.createCollection();
        return collection;
    }

    /**
     * Save the current active collection if present.
     */
    async saveActiveCollection(): Promise<void> {
        const active = this.getActiveCollection();
        if (!active) {
            throw new Error('No active collection to save');
        }
        await this.collectionManager.saveCollection(active);
    }

    #hasRuntimeTargetId(targetId: string): boolean {
        if (!this.runtimeCollection || !targetId) {
            return false;
        }

        const runtimesById = this.runtimeCollection.runtimesById;
        if (!(runtimesById instanceof Map)) {
            return false;
        }

        for (const runtime of runtimesById.values()) {
            if (runtime.deviceTargetsById.has(targetId)) {
                return true;
            }
        }

        return false;
    }

    #syncUserTargetsIntoCollectionManager(): void {
        const userTargets = Array.from(this.userTargetConfigsById.values()).map((record) => ({
            id: record.id,
            name: record.displayName || record.id,
        }));
        this.collectionManager.setUserTargets(userTargets);

        const records = Array.from(this.userTargetConfigsById.values());
        const runtimesById = this.runtimeCollection?.runtimesById;
        if (runtimesById instanceof Map) {
            for (const runtime of runtimesById.values()) {
                if (typeof runtime?.setUserTargets === 'function') {
                    runtime.setUserTargets(records);
                }
            }
        }
    }

    async getUserTargetConfigConflictDetails(
        targetConfigInput: TargetConfigInput
    ): Promise<UserTargetConfigConflictDetails | null> {
        const prepared = this.targetConfigStore.prepareTargetConfigRecord(targetConfigInput);

        if (this.#hasRuntimeTargetId(prepared.id)) {
            return null;
        }

        const conflict = await this.targetConfigStore.findTargetConfigConflict(prepared);
        if (!conflict) {
            return null;
        }

        return {
            type: conflict.type,
            incoming: conflict.incoming,
            existing: conflict.existing,
        };
    }

    async saveUserTargetConfig(
        targetConfigInput: TargetConfigInput,
        options: SaveUserTargetConfigOptions = {}
    ): Promise<TargetConfigRecord> {
        const prepared = this.targetConfigStore.prepareTargetConfigRecord(targetConfigInput);

        if (this.#hasRuntimeTargetId(prepared.id)) {
            const error = new Error(
                `Target config '${prepared.id}' conflicts with a runtime-shipped target id.`
            ) as Error & { code?: string };
            error.code = 'ERR_TARGET_DUPLICATE_ID';
            throw error;
        }

        const conflict = (await this.targetConfigStore.findTargetConfigConflict(
            prepared
        )) as TargetConfigConflict | null;
        if (conflict && !options.allowOverwrite) {
            const conflictField = conflict.type === 'displayName' ? 'displayName' : 'id';
            const error = new Error(
                `Target config '${prepared.id}' conflicts with existing user target ${conflictField} '${conflict.existing[conflictField]}'.`
            ) as Error & { code?: string };
            error.code = 'ERR_TARGET_DUPLICATE_ID';
            throw error;
        }

        if (
            conflict?.type === 'displayName' &&
            options.allowOverwrite &&
            conflict.existing.id !== prepared.id
        ) {
            await this.targetConfigStore.deleteTargetConfig(conflict.existing.id);
            this.userTargetConfigsById.delete(conflict.existing.id);
        }

        const saved = await this.targetConfigStore.saveTargetConfig(prepared, {
            allowOverwrite: options.allowOverwrite,
        });
        this.userTargetConfigsById.set(saved.id, saved);
        this.#syncUserTargetsIntoCollectionManager();
        return saved;
    }

    async getUserTargetConfig(id: string): Promise<TargetConfigRecord | null> {
        const cached = this.userTargetConfigsById.get(id);
        if (cached) {
            return cached;
        }
        const loaded = await this.targetConfigStore.getTargetConfig(id);
        if (loaded) {
            this.userTargetConfigsById.set(loaded.id, loaded);
            this.#syncUserTargetsIntoCollectionManager();
        }
        return loaded;
    }

    async listUserTargetConfigs(): Promise<TargetConfigRecord[]> {
        if (this.userTargetConfigsById.size === 0) {
            const loaded = await this.targetConfigStore.listTargetConfigs();
            for (const record of loaded) {
                this.userTargetConfigsById.set(record.id, record);
            }
            this.#syncUserTargetsIntoCollectionManager();
        }
        return Array.from(this.userTargetConfigsById.values());
    }

    async deleteUserTargetConfig(id: string): Promise<void> {
        await this.targetConfigStore.deleteTargetConfig(id);
        this.userTargetConfigsById.delete(id);
        this.#syncUserTargetsIntoCollectionManager();
    }

    async clearUserTargetConfigs(): Promise<void> {
        await this.targetConfigStore.clearTargetConfigs();
        this.userTargetConfigsById.clear();
        this.#syncUserTargetsIntoCollectionManager();
    }

    /**
     * Get the active graph from the active collection.
     * @returns {NodeGraph|null}
     */
    getActiveGraph(): NodeGraph | null {
        const activeCollection = this.getActiveCollection();
        if (!activeCollection) {
            return null;
        }
        return activeCollection.getActiveGraph();
    }

    /**
     * Set the active graph index on the active collection.
     * @param {number} graphIdx
     */
    setActiveGraphIdx(graphIdx: number): void {
        const activeCollection = this.getActiveCollection();
        if (!activeCollection) {
            throw new Error('No active collection to set graph on');
        }
        activeCollection.setActiveGraphIdx(graphIdx);
    }

    /**
     * Get the selected device runtime id from workspace config.
     * @returns {string|null}
     */
    getSelectedDeviceRuntimeId(): string | null {
        return this.config?.selectedDeviceRuntimeId || null;
    }

    /**
     * Set the selected device runtime id and persist the config.
     * @param {string|null} runtimeId
     * @returns {Promise<void>}
     */
    async setSelectedDeviceRuntimeId(runtimeId: string | null): Promise<void> {
        if (runtimeId && !this.runtimeCollection?.hasRuntime(runtimeId)) {
            throw new Error(`Runtime id "${runtimeId}" does not exist`);
        }
        this.config.selectedDeviceRuntimeId = runtimeId || null;
        await this.#persistConfig();
        this.#emitChange(
            'configChanged',
            new WorkspaceConfigChangedPayload(
                'selectedDeviceRuntimeId',
                this.config.selectedDeviceRuntimeId
            )
        );
    }

    /**
     * Get the active theme id.
     * @returns {string|null}
     */
    getTheme(): string | null {
        return this.config?.theme || this.viewManager?.theme || null;
    }

    /**
     * Set the active theme and persist the config.
     * @param {string} themeId
     * @returns {Promise<string>} The applied theme id
     */
    async setTheme(themeId: string): Promise<string> {
        if (!this.viewManager) {
            throw new Error('View manager not initialized');
        }
        const appliedTheme = this.viewManager.setTheme(themeId);
        this.config.theme = appliedTheme;
        await this.#persistConfig();
        this.#emitChange('configChanged', new WorkspaceConfigChangedPayload('theme', appliedTheme));
        return appliedTheme;
    }

    /**
     * List all available view themes.
     * @returns {Array<{id: string, label: string, description: string}>}
     */
    listAvailableThemes(): Array<{ id: string; label: string; description: string }> {
        if (!this.viewManager || typeof this.viewManager.getAvailableThemes !== 'function') {
            return [];
        }
        return this.viewManager.getAvailableThemes();
    }

    /**
     * Set the active locale and persist the config.
     * @param {string} localeCode - The locale code to switch to (e.g., 'en', 'de')
     * @returns {Promise<string>} The locale that was set
     */
    async setLocale(localeCode: string): Promise<string> {
        if (!this.i18nService) {
            throw new Error('I18n service not initialized');
        }
        await this.i18nService.setLocale(localeCode);
        this.config.locale = this.i18nService.currentLocale;
        await this.#persistConfig();
        this.#emitChange(
            'configChanged',
            new WorkspaceConfigChangedPayload('locale', this.i18nService.currentLocale)
        );
        return this.i18nService.currentLocale;
    }

    /**
     * List all available device runtime ids and names.
     * @returns {Array<{id: string, name: string}>}
     */
    listAvailableRuntimes(): Array<{ id: string; name: string }> {
        if (!this.runtimeCollection) {
            return [];
        }
        const runtimes = [];
        for (const [runtimeId, runtime] of this.runtimeCollection.runtimesById) {
            runtimes.push({
                id: runtimeId,
                name: runtime.name || runtimeId,
            });
        }
        return runtimes;
    }

    /**
     * List all available target ids and names for a given runtime.
     * @param {string} runtimeId
     * @returns {Array<{id: string, name: string}>}
     */
    listTargetsForRuntime(runtimeId: string): Array<{ id: string; name: string }> {
        const runtimeTargets: Array<{ id: string; name: string }> = [];
        if (this.runtimeCollection) {
            const runtime = this.runtimeCollection.getRuntime(runtimeId);
            if (runtime) {
                for (const [targetId, target] of runtime.deviceTargetsById) {
                    runtimeTargets.push({
                        id: targetId,
                        name: target.displayName || targetId,
                    });
                }
            }
        }

        const targetIds = new Set(runtimeTargets.map((target) => target.id));
        for (const userTarget of this.userTargetConfigsById.values()) {
            if (targetIds.has(userTarget.id)) {
                continue;
            }
            runtimeTargets.push({
                id: userTarget.id,
                name: userTarget.displayName || userTarget.id,
            });
        }

        return runtimeTargets;
    }

    /**
     * Serialize workspace for diagnostics/testing (in-memory snapshot).
     * @returns {{activeCollectionId:string|null, collections:Array<object>}}
     */
    toData(): { activeCollectionId: string | null; collections: Array<object> } {
        return {
            activeCollectionId: this.config.activeCollectionId || null,
            collections: Array.from(this.collectionManager.getCollections().values()).map((c) =>
                c.toData()
            ),
        };
    }

    /**
     * Handle completion of an initialization source.
     * When all expected sources complete, hide the splash screen.
     * @param {string} source - The source that completed
     * @private
     */
    #onSourceComplete(source: string): void {
        // Track this source as completed
        this.#completedSources.add(source);

        // Check if all expected sources have completed
        const allSourcesComplete = Array.from(EXPECTED_INITIALIZATION_SOURCES).every(
            (expectedSource) => this.#completedSources.has(expectedSource)
        );

        if (allSourcesComplete) {
            this._log(
                'splash-hide',
                'debug',
                '✅ All initialization sources complete, hiding splash screen'
            );
            this.#hideSplashScreen();
        }
    }

    /**
     * Hide the splash screen after a brief delay to allow user to read final message.
     * @private
     */
    #hideSplashScreen(): void {
        // Clear any existing timeout
        if (this.#splashHideTimeout) {
            clearTimeout(this.#splashHideTimeout);
        }

        // Wait 500ms for user to read final message, then hide
        this.#splashHideTimeout = setTimeout(async () => {
            try {
                await this.splashScreen.hide();

                // Clean up splash screen DOM after fade-out completes
                // Add extra delay to ensure fade transition completes (300ms transition + buffer)
                setTimeout(() => {
                    if (this.splashScreen && typeof this.splashScreen.destroy === 'function') {
                        this.splashScreen.destroy();
                    }
                }, 1000);
            } catch (error) {
                console.warn('[Workspace] Failed to hide splash screen', error);
            }
        }, 500);
    }

    /**
     * Cleanup workspace resources and unsubscribe from event buses.
     * Call this method when the workspace is no longer needed (e.g., during app shutdown).
     */
    cleanup(): void {
        // Clear splash hide timeout
        if (this.#splashHideTimeout) {
            clearTimeout(this.#splashHideTimeout);
            this.#splashHideTimeout = null;
        }

        // Unsubscribe from progress event bus
        if (this.#progressListener) {
            ProgressEventBus.unsubscribe(this.#progressListener);
            this.#progressListener = null;
        }

        // Unregister collection change handler
        if (this.unregisterCollectionChangeHandler) {
            this.unregisterCollectionChangeHandler();
            this.unregisterCollectionChangeHandler = null;
        }

        // Remove global reference
        if (
            typeof window !== 'undefined' &&
            (window as WorkspaceWindow).microOtterWorkspace === this
        ) {
            delete (window as WorkspaceWindow).microOtterWorkspace;
        }

        this.transpiler = null;
    }
}

export { Workspace };
