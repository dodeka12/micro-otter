// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Main v2 application entrypoint.
 *
 * Load order:
 * 0) Feature detection (check browser compatibility FIRST)
 * 1) Initialize Workspace with runtime collection support
 * 2) Build split-view layout with WorkspaceView at top and nested split views below
 */

// ============================================================================
// LOGGING SYSTEM - Import first to ensure globalThis.__microOtterLog is available
// ============================================================================
import '../core/log.js';

import { FeatureDetector } from '../core/feature-detector.js';
import { FirstRunConsentGate } from './first-run-consent-gate.js';
import { startServerConnectionController } from './server-connection-controller.js';
import { startDeploymentProgressController } from './deployment-progress-controller.js';
import { resolveAppVersion } from '../core/app-meta.js';
import { isHostedBuild } from '../core/build-mode.js';
import { ServerCapabilitiesStore } from '../firmware/server-capabilities.js';
import { ServerConnectionMonitor } from '../firmware/server-connection.js';
import { DeviceConnectionMonitor } from '../serial/device-connection-monitor.js';
import {
    ProgressEventBus,
    ProgressEvent,
    ProgressEventType,
    ProgressTracker,
} from '../core/progress-events.js';
import { Workspace } from '../core/workspace.js';
import { CollectionStore } from '../data/collection-store.js';
import { AllSettingsView } from '../views/all-settings-view.js';
import { CollectionView } from '../views/collection-view.js';
import { DeviceConnectionView } from '../views/device-connection-view.js';
import { DeviceDeploymentView } from '../views/device-deployment-view.js';
import { DeploymentProgressDialogView } from '../views/deployment-progress-dialog-view.js';
import { FirmwareBuildView } from '../views/firmware-build-view.js';
import { IconProvider } from '../views/icon-provider.js';
import { NodePaletteView } from '../views/node-palette-view.js';
import { SplashScreen } from '../views/splash-screen.js';
import { SplitView } from '../views/split-view.js';
import { TabbedView } from '../views/tabbed-view.js';
import { TargetConfigView } from '../views/target-config-view.js';
import { TranspilerView } from '../views/transpiler-view.js';
import { WorkspaceView } from '../views/workspace-view.js';

interface BootWorkspaceConfig {
    splashScreen: SplashScreen | null;
}

interface MicroOtterAdminApi {
    clearCollections: () => Promise<void>;
}

interface AppState {
    workspace: Workspace | null;
}

declare global {
    interface Window {
        microOtterFeatures?: FeatureDetector;
        microOtterSplash?: SplashScreen;
    }

    interface GlobalThis {
        microOtterAdmin?: MicroOtterAdminApi;
        workspace?: Workspace | null;
        viewManager?: unknown;
        i18n?: Record<string, unknown>;
    }
}

if (globalThis.__microOtterLog) {
    const logger = (
        globalThis.__microOtterLog as unknown as {
            logger?: {
                setEnabled: (enabled: boolean) => void;
                register: (className: string) => void;
            };
        }
    ).logger;

    if (!logger) {
        console.error('[main-v2] Logging system does not expose logger API');
    } else {
        const isVersionBumpDebugEnabled = false;
        const isRuntimeDetectionDebugEnabled = true;

        (globalThis as Record<string, unknown>).__microOtterDebugVersionBump =
            isVersionBumpDebugEnabled;
        (globalThis as Record<string, unknown>).__microOtterDebugRuntimeDetection =
            isRuntimeDetectionDebugEnabled;

        // Enable logging globally by default so runtime debug output is always visible.
        logger.setEnabled(true);

        // Register classes we want to debug
        // logger.register('NodePaletteView');
        logger.register('TranspilerView');
        if (isRuntimeDetectionDebugEnabled) {
            logger.register('DeviceDeployment');
            logger.register('DeviceConnection');
            logger.register('DeviceDeploymentView');
            logger.register('DeploymentProgressDialogView');
            logger.register('RuntimeDeployment');
            logger.register('CollectionDeployment');
        }
        if (isVersionBumpDebugEnabled) {
            logger.register('Workspace');
            logger.register('CollectionManager');
            logger.register('Collection');
            logger.register('NodeGraph');
        }

        // logger.register('ViewBase');
    }
} else {
    console.error('[main-v2] Logging system not available!');
}

// ============================================================================
// PHASE 0: FEATURE DETECTION
// Check browser compatibility BEFORE initializing app
// ============================================================================

await FirstRunConsentGate.showIfNeeded();

// Create splash screen early for feature detection feedback
const appVersion: string = await resolveAppVersion();
const splash = new SplashScreen({ version: appVersion });
await splash.show();

// Remove initial loading screen now that splash is shown
const initialLoading: HTMLElement | null = document.getElementById('initial-loading');
if (initialLoading) {
    initialLoading.remove();
}

// Run feature detection
const detector = new FeatureDetector();
const results = detector.checkAll();

// Check if required features are missing
if (!results.allRequiredAvailable) {
    console.error('❌ Required browser features are missing:', results.missingRequired);

    // Show feature warnings in splash screen (blocks startup)
    splash.showFeatureWarnings(results.missingRequired, [], results.details);

    // STOP: Do not initialize the app if required features are unavailable
    throw new Error('Cannot start Micro-Otter: Required browser features are missing');
}

// Warn about missing optional features (but allow continuation)
if (results.missingOptional.length > 0) {
    console.warn('⚠️ Optional features not available:', results.missingOptional);
    for (const featureName of results.missingOptional) {
        const detail = detector.getDetails(featureName);
        console.warn(`  - ${featureName}: ${detail?.reason || 'Not supported'}`);
    }

    // Show optional feature warnings in splash screen
    splash.showFeatureWarnings([], results.missingOptional, results.details);

    // Wait for user to acknowledge and continue
    await new Promise<void>((resolve: () => void) => {
        splash._container!.addEventListener(
            'splash-continue',
            () => {
                splash.hideFeatureWarnings();
                resolve();
            },
            { once: true }
        );
    });
}

// Store detector globally for feature checks throughout the app
window.microOtterFeatures = detector;

// Store splash screen globally so workspace can use it
window.microOtterSplash = splash;

// ============================================================================
// PHASE 1: APP INITIALIZATION
// Only reached if all required features are available
// ============================================================================

const RUNTIME_COLLECTION_ROOT = '/device/runtime';

/**
 * Whether this bundle is a dev build.
 *
 * Dev builds get the *Continue without server* escape in the reconnect dialog; a
 * production build cannot dismiss the dialog.
 */
const IS_DEV_BUILD = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

class MicroOtterApp {
    state: AppState;
    started: boolean;

    /**
     * Single owner of "is the server reachable?", shared by the title-bar badge, the
     * Firmware tab, and the reconnect dialog.
     */
    serverConnection: ServerConnectionMonitor | null;

    /**
     * Single owner of "what is the device doing?", shared by the title-bar device
     * badge and the connection dialog.
     */
    deviceConnection: DeviceConnectionMonitor | null;

    /**
     * Stop function of the reconnect controller, kept so a future hot-reload or test
     * harness can detach it. The app itself lives for the page and never stops it.
     */
    stopServerConnection: (() => void) | null;

    /**
     * Stop function of the deployment progress controller, kept so a future hot-reload or
     * test harness can detach it. The app itself lives for the page and never stops it.
     */
    stopDeploymentProgress: (() => void) | null;

    constructor() {
        this.state = {
            workspace: null,
        };
        this.started = false;
        this.serverConnection = null;
        this.deviceConnection = null;
        this.stopServerConnection = null;
        this.stopDeploymentProgress = null;
    }

    async initialize(): Promise<void> {
        if (this.started) {
            return;
        }
        this.started = true;

        // Initialize Workspace with runtime collection support
        // Use globally stored splash screen from feature detection phase (if available)
        const splashScreen = window.microOtterSplash || null;
        const workspaceConfig: BootWorkspaceConfig = { splashScreen };
        this.state.workspace = new Workspace(workspaceConfig);

        // this.state.workspace.viewManager.viewFactory.register('TranspilerView', TranspilerView);

        // Now that Workspace is subscribed to ProgressEventBus, emit feature-detection COMPLETE
        const completionEvent = new ProgressEvent({
            source: 'feature-detection',
            type: ProgressEventType.COMPLETE,
            message: 'Feature detection complete',
            progress: 100,
        });
        ProgressEventBus.emit(completionEvent);

        await this.state.workspace.load().catch((error: unknown) => {
            console.warn('[main-v2] Failed to load workspace from store', error);
        });

        const graph = this.state.workspace.getActiveGraph();
        void graph;
        void RUNTIME_COLLECTION_ROOT;

        // Build or restore the view layout
        // if (!this.state.workspace.viewManager.rootView) {
        //     this.buildDefaultLayout();
        // }
        // One monitor owns reachability for the badge, the Firmware tab, and the dialog.
        // A hosted bundle has no server to reach: no capability probe, no title-bar badge, and no
        // reconnect dialog. `WorkspaceView` already treats a null monitor as "no server", so this
        // guard is the whole gate — do not add a second one inside the views.
        if (!isHostedBuild()) {
            this.serverConnection = new ServerConnectionMonitor({
                store: new ServerCapabilitiesStore(),
            });
        } else {
            this.serverConnection = null;
        }
        // One monitor owns device state for the title-bar badge and the connection
        // dialog. Created before the views so `start()` can run exactly once.
        this.deviceConnection = new DeviceConnectionMonitor({
            deviceConnection: (this.state.workspace as any).deviceConnection,
        });
        this.buildDefaultLayout();

        // Attach viewManager's root element to app container
        if (typeof document !== 'undefined' && document.body) {
            const container = document.createElement('div');
            container.id = 'app-root';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.position = 'fixed';
            container.style.top = '0';
            container.style.left = '0';
            document.body.appendChild(container);

            container.appendChild(this.state.workspace.viewManager.rootElement);
        }

        await this.state.workspace.showPendingCollectionRepairDialog().catch((error: unknown) => {
            console.warn('[main-v2] Failed to show collection repair dialog', error);
        });

        this.registerAdminHelpers();

        // Start the monitor last so the first probe, the badge subscription, and the
        // tab's own attach probe share the store's single in-flight request.
        this.startServerConnection();
        this.startDeploymentProgress();
        this.deviceConnection?.start();
    }

    /**
     * Start the connection monitor and the reconnect controller.
     *
     * Both need the attached view tree: the controller shows its dialog through the
     * workspace `ViewManager` and translates through the workspace i18n service.
     */
    startServerConnection(): void {
        const workspaceRef = this.state.workspace as any;
        const monitor = this.serverConnection;
        if (!monitor || !workspaceRef) {
            return;
        }
        monitor.start();
        this.stopServerConnection = startServerConnectionController({
            monitor,
            viewManager: workspaceRef.viewManager,
            t: (key: string, params?: Record<string, unknown>) =>
                workspaceRef.i18nService?.t(key, params) ?? key,
            dev: IS_DEV_BUILD,
        });
    }

    /**
     * Start the deployment progress controller.
     *
     * It needs the attached view tree: the controller shows its dialog through the workspace
     * `ViewManager` and translates the operation titles through the workspace i18n service. The
     * subscription is the `ProgressEventBus` itself, so every device write — from the title bar,
     * the Device tab, or an embedded bootstrap chain — reports into the same dialog.
     */
    startDeploymentProgress(): void {
        const workspaceRef = this.state.workspace as any;
        if (!workspaceRef?.viewManager) {
            return;
        }
        this.stopDeploymentProgress = startDeploymentProgressController({
            viewManager: workspaceRef.viewManager,
            t: (key: string, params?: Record<string, unknown>) =>
                workspaceRef.i18nService?.t(key, params) ?? key,
            createDialog: (title: string) =>
                new DeploymentProgressDialogView({
                    title,
                    i18nService: workspaceRef.i18nService,
                    logger: console as any,
                }),
            subscribe: (listener) => {
                ProgressEventBus.subscribe(listener);
                return () => ProgressEventBus.unsubscribe(listener);
            },
        });
    }

    buildDefaultLayout(): void {
        const workspace = this.state.workspace;
        if (!workspace) {
            throw new Error('Workspace must be initialized before building layout');
        }

        const workspaceRef = workspace as any;
        const logger = console as any;

        // Create progress tracker for view system initialization
        const progress = new ProgressTracker('views', 6);

        try {
            progress.start('Initializing view system...');

            // Step 1: Create workspace view
            progress.update('Creating workspace view...', 1);
            const workspaceView = new WorkspaceView({
                workspace: workspaceRef,
                viewManager: workspaceRef.viewManager,
                appVersion,
                i18nService: workspaceRef.i18nService,
                serverConnection: this.serverConnection,
                deviceConnection: this.deviceConnection,
            } as any);

            // Step 2: Create collection view with active collection
            progress.update('Creating collection view...', 2);
            const activeCollection = workspaceRef.getActiveCollection();
            if (!activeCollection) {
                throw new Error('No active collection found in workspace');
            }

            const collectionView = new CollectionView({
                workspace: workspaceRef,
                collection: activeCollection,
                viewManager: workspaceRef.viewManager,
                i18nService: workspaceRef.i18nService,
                logger,
            } as any);

            // Step 3: Create node palette view
            progress.update('Creating node palette view...', 3);

            // Get the active device runtime for the collection
            const runtimeId = activeCollection.getDeviceRuntimeId();
            const deviceRuntime = workspaceRef.runtimeCollection.getRuntime(runtimeId);

            if (!deviceRuntime) {
                throw new Error(`Device runtime not found: ${runtimeId}`);
            }

            const nodePaletteView = new NodePaletteView({
                deviceRuntime: deviceRuntime,
                runtimeCollection: workspaceRef.runtimeCollection,
                collectionManager: workspaceRef.collectionManager,
                workspaceConfig: workspaceRef.config,
                i18nService: workspaceRef.i18nService,
                logger,
                viewManager: workspaceRef.viewManager,
                title: 'Palette', // Title shown on hover
                icon: IconProvider.palette, // SVG icon from IconProvider
            } as any);

            const transpilerView = new TranspilerView({
                collectionManager: workspaceRef.collectionManager,
                runtimeCollection: workspaceRef.runtimeCollection,
                transpiler: workspaceRef.transpiler,
                viewManager: workspaceRef.viewManager,
                i18nService: workspaceRef.i18nService,
                logger,
                title: 'Transpiler',
                icon: IconProvider.codeGenerator,
            } as any);

            const deviceConnectionView = new DeviceConnectionView({
                deviceConnection: workspaceRef.deviceConnection,
                i18nService: workspaceRef.i18nService,
                logger,
                title: 'Device',
                icon: IconProvider.cable,
            } as any);

            const deviceDeploymentView = new DeviceDeploymentView({
                deviceDeployment: workspaceRef.deviceDeployment,
                runtimeCollection: workspaceRef.runtimeCollection,
                collectionManager: workspaceRef.collectionManager,
                viewManager: workspaceRef.viewManager,
                i18nService: workspaceRef.i18nService,
                logger,
                title: 'Deploy',
                icon: IconProvider.upload,
            } as any);

            const firmwareBuildView = new FirmwareBuildView({
                deviceConnection: workspaceRef.deviceConnection,
                runtimeCollection: workspaceRef.runtimeCollection,
                collectionManager: workspaceRef.collectionManager,
                viewManager: workspaceRef.viewManager,
                i18nService: workspaceRef.i18nService,
                logger,
                title: 'Firmware',
                icon: IconProvider.memory,
                firmwareCapabilities: this.serverConnection?.store,
            } as any);

            const targetConfigView = new TargetConfigView({
                workspace: workspaceRef,
                collectionManager: workspaceRef.collectionManager,
                i18nService: workspaceRef.i18nService,
                logger,
                title: 'Target Config',
                icon: IconProvider.dataObject,
            } as any);

            const allSettingsView = new AllSettingsView({
                workspace: workspaceRef,
                collectionManager: workspaceRef.collectionManager,
                i18nService: workspaceRef.i18nService,
                logger,
                title: 'Settings',
                icon: IconProvider.settings,
            } as any);

            // Step 4: Create vertical tabbed view (tabs on right) for palette
            progress.update('Creating palette container...', 4);
            const paletteTabbedView = new TabbedView({
                tabPosition: 'right', // Vertical tabs on the right side
                // minWidth will be adopted from NodePaletteView automatically
                i18nService: workspaceRef.i18nService,
            } as any);
            // Add view with closable=false to hide close button
            paletteTabbedView.addView(nodePaletteView, undefined, true, false);
            paletteTabbedView.addView(allSettingsView, undefined, false, false);
            paletteTabbedView.addView(transpilerView, undefined, false, false);
            paletteTabbedView.addView(deviceConnectionView, undefined, false, false);
            paletteTabbedView.addView(deviceDeploymentView, undefined, false, false);
            paletteTabbedView.addView(targetConfigView, undefined, false, false);
            paletteTabbedView.addView(firmwareBuildView, undefined, false, false);

            // Step 5: Create horizontal split (CollectionView left, Palette right)
            progress.update('Creating content split view...', 5);
            const contentSplitView = new SplitView({
                orientation: 'horizontal',
                ratio: 0.86, // 86% for collection, 14% for palette (shows 3 icons initially)
                views: [collectionView, paletteTabbedView],
                i18nService: workspaceRef.i18nService,
            } as any);

            // Step 6: Create root vertical split (WorkspaceView top, content split bottom)
            progress.update('Building root layout...', 6);
            const rootSplitView = new SplitView({
                orientation: 'vertical',
                ratio: 0.08, // Small workspace view at top (~8% height)
                views: [workspaceView, contentSplitView],
                i18nService: workspaceRef.i18nService,
            } as any);

            // Attach to view manager
            workspaceRef.viewManager.attachRoot(rootSplitView);

            progress.complete('View system ready');
        } catch (error: unknown) {
            progress.error('View system initialization failed', error);
            throw error;
        }
    }

    registerAdminHelpers(): void {
        const workspace = this.state.workspace;
        if (!workspace) {
            return;
        }

        const store = new CollectionStore();
        const admin: MicroOtterAdminApi = {
            /**
             * Clears all stored collections from IndexedDB. Use with care.
             */
            clearCollections: async () => {
                await store.clearCollections();
            },
        };

        globalThis.microOtterAdmin = admin;

        // Expose workspace and i18n service for console debugging/testing
        globalThis.workspace = workspace;
        globalThis.viewManager = workspace.viewManager;
        globalThis.i18n = workspace.i18nService as unknown as Record<string, unknown>;
    }
}

export const microOtterApp = new MicroOtterApp();

function bootstrap(): void {
    void microOtterApp.initialize();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
