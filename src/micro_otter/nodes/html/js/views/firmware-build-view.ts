// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import { IconProvider } from './icon-provider.js';
import { isTargetCompatibleWithImage } from '../data/target-compatibility.js';
import { isHostedBuild, getHostedDocsUrl } from '../core/build-mode.js';
import { CollapsibleView } from './collapsible-view.js';
import { ContentView } from './content-view.js';
import { DataTableView } from './data-table-view.js';
import { CodeView } from './code-view.js';
import { MarkdownView } from './markdown-view.js';
import { SplitView } from './split-view.js';
import { ToolbarView } from './toolbar-view.js';
import { DropdownControl } from './controls/dropdown-control.js';
import {
    fetchSerialPorts,
    serialPortOptions,
    type SerialPortEntry,
} from '../serial/serial-ports.js';
import {
    ButtonControl,
    CheckboxControl,
} from './controls/custom-runtime-controls.js';
import type {
    DisableableControl,
    FirmwareRuntimeLike,
    FirmwareTargetLike,
    FirmwareViewManagerLike,
} from './firmware-build-types.js';
import {
    ServerCapabilitiesStore,
    type ServerCapabilities,
    type ServerCapabilitiesSnapshot,
    type FirmwareBackendDescriptor,
} from '../firmware/server-capabilities.js';
import { FirmwarePackagesPanel } from './firmware-packages-panel.js';
import { FirmwareInventoryPanel } from './firmware-inventory-panel.js';
import { ProgressBarView } from './progress-bar-view.js';
import {
    findBoardForCompileTarget,
    loadBoardCatalog,
    type FirmwareBoardSpec,
} from '../firmware/board-catalog.js';
import { FirmwareJobClient } from '../firmware/firmware-client.js';
import { FilePickerDialogView } from './file-picker-dialog-view.js';
import {
    classifyFirmwareCompatibility,
    decodeFirmwareInventoryResult,
    findFirmwareSelectionMatch,
    type FirmwareCompatibilityContext,
    type FirmwareInventoryEntry,
    type FirmwareSelection,
} from '../firmware/firmware-inventory.js';
import { validateArchiveUrl } from '../firmware/firmware-requests.js';
import {
    describeFirmwareError,
    initialFirmwareJobState,
    markDisconnected,
    reduceFirmwareFrame,
    startJobState,
    FIRMWARE_LOG_LIMIT,
    type FirmwareJobError,
    type FirmwareJobKind,
    type FirmwareJobResult,
    type FirmwareJobState,
    type FirmwareLogLine,
} from '../firmware/firmware-job-state.js';
import {
    buildCompileRequest,
    buildDeployRequest,
    formatBytes,
    isBinaryFirmwareSource,
} from '../firmware/firmware-requests.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;
type FirmwareBuildViewBaseOptions = Omit<
    ViewBaseOptions,
    'title' | 'icon' | 'i18nService' | 'logger'
>;

/**
 * The group pane that owns a job's controls, and therefore its log.
 *
 * `compile` and `scan` report in Build Firmware, `deploy` in Deploy, and
 * `list`/`delete` in Local firmware.
 */
type FirmwareJobGroup = 'build' | 'deploy' | 'inventory';

/** Severity of one client-side notice written to a group's log. */
type FirmwareNoticeSeverity = 'info' | 'warning' | 'error';

/**
 * Structural subset of the serial connection the view needs.
 *
 * `isConnected()` answers the port-busy line and decides whether Deploy has to
 * release the port; `disconnect()` is that release. Nothing else of the
 * connection belongs to this tab.
 */
interface FirmwareDeviceConnectionLike {
    /** Whether the app currently holds the serial port. */
    isConnected(): boolean;
    /** Release the port so the server-side flash can open it. */
    disconnect(): Promise<void>;
    /** The onboard-able target ids of the connected board's firmware, or null. */
    getAllowedWebTargetIds?(): string[] | null;
    /** The terminal build base id the flashed image records, or null. */
    getBuildBaseTargetId?(): string | null;
}

/** Structural subset of a collection: the active runtime id plus its graphs. */
interface FirmwareCollectionLike {
    getId?(): string;
    getDeviceRuntimeId(): string | null;
    getTargetId?(): string | null;
    getGraphArray?(): Array<{ getNodes?(): Array<{ type?: unknown }> }>;
    onGraphChange?(listener: (event: unknown) => void): () => void;
}

/** Structural subset of the collection manager the view subscribes to. */
interface FirmwareCollectionManagerLike {
    on(eventName: string, listener: (event: unknown) => void): () => void;
    getActiveCollection(): FirmwareCollectionLike | null;
}

/** Structural subset of the runtime collection. */
interface FirmwareRuntimeCollectionLike {
    getRuntime(runtimeId: string): FirmwareRuntimeLike | null;
    load(): Promise<unknown>;
}

/** Structural subset of the `WS /firmware` client, injectable for tests. */
interface FirmwareJobClientLike {
    isOpen(): boolean;
    connect(options?: { url?: string; webSocketFactory?: (url: string) => unknown }): Promise<void>;
    close(): void;
    startCompile(request: Record<string, unknown>): void;
    startDeploy(request: Record<string, unknown>): void;
    scanLocal(request: { runtimeId: string }): void;
    listFirmware(): void;
    deleteFirmware(request: { firmwarePath: string }): void;
    importFirmware(request: { path?: string; url?: string; force?: boolean }): void;
    importFirmwareBinary(request: {
        path?: string;
        url?: string;
        targetId: string;
        force?: boolean;
    }): void;
    exportFirmware(request: { firmwarePath: string; destinationDir: string; force?: boolean }): void;
    installAddon(request: { path?: string; url?: string; force?: boolean }): void;
    uninstallAddon(request: { packageIds: string[] }): void;
    listDirectory(request: {
        requestId: string;
        path?: string;
        extensions?: string[];
        showHidden?: boolean;
    }): Promise<{
        path: string;
        parent: string | null;
        roots: { id: string; path: string }[];
        entries: {
            name: string;
            path: string;
            kind: 'directory' | 'file' | 'symlink';
            sizeBytes: number | null;
            modifiedAt: string | null;
        }[];
        truncated: boolean;
    }>;
    cancel(): void;
    on(eventName: string, listener: (event: unknown) => void): () => void;
}

export interface FirmwareBuildViewOptions extends FirmwareBuildViewBaseOptions {
    title?: string;
    icon?: string | null;
    firmwareCapabilities?: ServerCapabilitiesStore;
    deviceConnection: FirmwareDeviceConnectionLike;
    runtimeCollection: FirmwareRuntimeCollectionLike;
    collectionManager: FirmwareCollectionManagerLike;
    viewManager: FirmwareViewManagerLike;
    jobClient?: FirmwareJobClientLike;
    i18nService?: ViewBaseOptions['i18nService'];
    logger?: ViewBaseOptions['logger'];
}

/**
 * The always-present Firmware tab: a renderer of the `WS /firmware` + capabilities
 * contract, never a second implementation of it. It probes once on first
 * activation and renders either its five panes (a `ready` snapshot) or one folded
 * offline Help section (anything else). Server availability, the title-bar offline
 * badge, and the reconnect dialog belong to the app shell
 * (`js/firmware/server-connection.ts`, `js/app/server-connection-controller.ts`),
 * so this view carries no state chrome of its own.
 */
export class FirmwareBuildView extends ViewBase {
    private _firmwareCapabilities: ServerCapabilitiesStore;
    private _deviceConnection: FirmwareDeviceConnectionLike;
    private _runtimeCollection: FirmwareRuntimeCollectionLike;
    private _collectionManager: FirmwareCollectionManagerLike;
    private _viewManager: FirmwareViewManagerLike;

    private _capabilityUnsubscribe: (() => void) | null = null;
    private _controls: Array<{
        control: DisableableControl;
        gate?: (snapshot: ServerCapabilitiesSnapshot | null) => boolean;
    }> = [];
    private _probing = false;

    private _built = false;
    private _contentEl: HTMLElement | null = null;
    /** Host of the vertical `SplitView`; one pane per section. */
    private _splitHostEl: HTMLElement | null = null;
    private _splitView: SplitView | null = null;
    /** Purpose line inside the Help pane: what the tab builds and deploys. */
    private _helpMarkdownView: MarkdownView | null = null;
    private _targetsEl: HTMLElement | null = null;
    private _deployEl: HTMLElement | null = null;
    /** Explainer above the port chooser: Deploy releases the app's connection. */
    private _deployPortNoteView: MarkdownView | null = null;
    private _infoTable: DataTableView | null = null;
    /** Log sub-section per group, opened when that group reports a failure. */
    private _logSubCollapsibles: Partial<Record<FirmwareJobGroup, CollapsibleView>> = {};
    /**
     * Client-side evidence lines per group (refusals, disconnects, and the
     * warnings/errors of the last outcome), rendered above the job's output.
     */
    private _evidenceLines: Record<FirmwareJobGroup, FirmwareLogLine[]> = {
        build: [],
        deploy: [],
        inventory: [],
    };
    /**
     * Capability diagnostic lines prepended to the Build Firmware log.
     *
     * This is the only replacement for the deleted header notice: a backend that
     * cannot compile or flash is reported in the log of the group whose controls it
     * blocks, per the "a job reports in the group that owns its controls" rule.
     */
    private _capabilityDiagnostics: FirmwareLogLine[] = [];
    /** The same capability diagnostics as plain text, for the offline Help body. */
    private _diagnosticTexts: string[] = [];
    /** Path of the last deleted image, so its log can name what was removed. */
    private _lastDeletedPath: string | null = null;
    /** Human summary of the last import, mirrored into the inventory log. */
    private _lastImportNotice: string | null = null;
    /** Whether the last import was a binary import, so the log can post the next-step hint. */
    private _lastImportWasBinary = false;
    /**
     * The import being replayed on overwrite. `kind` never reaches the wire: it
     * exists only so the force re-send replays the *same* frame kind.
     */
    private _pendingImport:
        | { kind: 'package'; path?: string; url?: string; force?: boolean }
        | { kind: 'binary'; path?: string; url?: string; targetId: string; force?: boolean }
        | null = null;
    /** The add-on archive being installed, retained for the replace re-send. */
    private _pendingAddonInstall: {
        path?: string;
        url?: string;
        force?: boolean;
    } | null = null;
    /** The export being requested, retained for the overwrite re-send. */
    private _pendingExport: {
        firmwarePath: string;
        destinationDir: string;
        force?: boolean;
    } | null = null;
    /** Absolute path the last successful export wrote, mirrored into the log. */
    private _lastExportNotice: string | null = null;
    /** Offline explainer section, shown when the capability snapshot is unavailable. */
    private _offlineSectionEl: HTMLElement | null = null;
    /** The single folded Help section the offline host holds. */
    private _offlineCollapsible: CollapsibleView | null = null;
    private _offlineMarkdownView: MarkdownView | null = null;
    /** Host of the per-backend diagnostic rows under the offline explainer. */
    private _offlineDiagnosticsEl: HTMLElement | null = null;
    /** Whether the offline mode is currently entered; drives the collapse-on-entry. */
    private _offlineMode = false;
    /** Human summary lines of the last add-on mutation, mirrored into the build log. */
    private _lastAddonSummary: string[] | null = null;
    private _buildLogView: CodeView | null = null;
    private _deployLogView: CodeView | null = null;
    private _helpCollapsible: CollapsibleView | null = null;
    private _targetsCollapsible: CollapsibleView | null = null;
    private _inventoryCollapsible: CollapsibleView | null = null;
    private _buildFirmwareCollapsible: CollapsibleView | null = null;
    private _packagesSubCollapsible: CollapsibleView | null = null;
    private _addonsSubCollapsible: CollapsibleView | null = null;
    private _deployCollapsible: CollapsibleView | null = null;
    private _addonsSubHostEl: HTMLElement | null = null;

    private _boardCatalog: FirmwareBoardSpec[] = [];
    private _boardCatalogLoaded = false;
    private _runtime: FirmwareRuntimeLike | null = null;
    private _selectedTargetId: string | null = null;
    /** Whether the user explicitly picked a target, so a collection switch must not override it. */
    private _targetPinnedByUser = false;
    /** Collection id the current default selection was derived from; detects collection switches. */
    private _collectionTargetOrigin: string | null = null;
    private _packagesPanel: FirmwarePackagesPanel | null = null;
    private _inventoryPanel: FirmwareInventoryPanel | null = null;
    private _targetDropdown: DropdownControl | null = null;
    private _infoRowEl: HTMLElement | null = null;
    private _collectionUnsubscribe: (() => void) | null = null;
    /** Subscription to the active collection's graph events; see `_subscribeToGraphChanges()`. */
    private _graphUnsubscribe: (() => void) | null = null;

    private _jobClient: FirmwareJobClientLike;
    private _jobState: FirmwareJobState = initialFirmwareJobState();
    private _jobUnsubscribe: (() => void) | null = null;
    private _socketUnsubscribe: (() => void) | null = null;
    private _cancelRequested = false;
    private _lastArtifact: { path: string; targetId: string } | null = null;
    private _ports: SerialPortEntry[] = [];
    /** `loading` while a `/api/serial-ports` read is in flight; see `_fetchPorts()`. */
    private _portStatus: 'ok' | 'empty' | 'error' | 'loading' | null = null;
    /** The in-flight port scan, so repeated rescans share one request. */
    private _portsRequest: Promise<void> | null = null;
    private _portDropdown: DropdownControl | null = null;
    private _deployPortStatusEl: HTMLElement | null = null;
    private _deployFirmwareStatusEl: HTMLElement | null = null;
    private _deployFirmwareHostEl: HTMLElement | null = null;
    private _deployFirmwareTable: DataTableView | null = null;
    private _buildMatchEl: HTMLElement | null = null;
    private _compositionBannerEl: HTMLElement | null = null;
    private _wipeControl: CheckboxControl | null = null;
    private _cleanBuildControl: CheckboxControl | null = null;
    /** First row of the Build Firmware pane: build button, then the clean-build checkbox. */
    private _buildToolbar: ToolbarView | null = null;
    /** First row of the Deploy pane: deploy button, then the wipe checkbox. */
    private _deployToolbar: ToolbarView | null = null;
    private _buildProgressView: ProgressBarView | null = null;
    private _deployProgressView: ProgressBarView | null = null;
    private _buildButton: ButtonControl | null = null;
    private _deployButton: ButtonControl | null = null;
    private _buildLogLines: FirmwareLogLine[] = [];
    private _deployLogLines: FirmwareLogLine[] = [];
    private _inventoryLogLines: FirmwareLogLine[] = [];
    private _buildLogEl: HTMLElement | null = null;
    private _deployLogEl: HTMLElement | null = null;
    private _inventoryLogEl: HTMLElement | null = null;
    private _inventoryLogView: CodeView | null = null;
    private _scanRuntimeId: string | null = null;
    private _firmwareEntries: FirmwareInventoryEntry[] = [];
    private _selectedFirmwarePath: string | null = null;
    private _inventoryRefreshFailed = false;
    /** True once a `firmware.list` result has populated `_firmwareEntries`. */
    private _inventoryLoaded = false;
    private _newlyBuiltPaths = new Set<string>();
    private _lastActionSnapshot: {
        phase: FirmwareJobState['phase'];
        job: FirmwareJobState['job'];
        result: FirmwareJobResult | null;
        error: FirmwareJobError | null;
    } = { phase: 'idle', job: null, result: null, error: null };

    constructor({
        firmwareCapabilities,
        deviceConnection,
        runtimeCollection,
        collectionManager,
        viewManager,
        jobClient = null,
        i18nService = null,
        logger = null,
        title = 'Firmware',
        icon = IconProvider.memory,
        ...rest
    }: FirmwareBuildViewOptions) {
        super({ title, icon, i18nService, logger, ...rest });

        if (!runtimeCollection) {
            throw new Error('FirmwareBuildView requires a runtimeCollection');
        }
        if (!collectionManager) {
            throw new Error('FirmwareBuildView requires a collectionManager');
        }
        if (!deviceConnection) {
            throw new Error('FirmwareBuildView requires a deviceConnection');
        }
        if (!viewManager) {
            throw new Error('FirmwareBuildView requires a viewManager');
        }

        this._firmwareCapabilities = firmwareCapabilities ?? new ServerCapabilitiesStore();
        this._deviceConnection = deviceConnection;
        this._runtimeCollection = runtimeCollection;
        this._collectionManager = collectionManager;
        this._viewManager = viewManager;
        this._jobClient = jobClient ?? new FirmwareJobClient();

        this._packagesPanel = new FirmwarePackagesPanel({
            i18nService: this._i18nService,
            logger: this._logger,
            getRuntime: () => this._runtime,
            getTarget: () => this._selectedTarget(),
            hasFeature: (id) => this._hasFeature(id),
            registerControl: (control, gate) => this._registerControl(control, gate),
            onSelectionChange: () => {
                this._renderBuildSection();
                this._inventoryPanel?.renderInventorySection();
                this._renderDeployFirmwareStatus();
            },
            onRefreshLocalPackages: () => this._refreshLocalPackages(),
            onRefreshAddons: () => this._refreshAddons(),
            isBusy: () => this._jobState.busy,
            onRequestInstallAddon: () => {
                void this._installAddonFromPath();
            },
            onRequestInstallAddonUrl: () => {
                void this._installAddonFromUrl();
            },
            onRemoveAddons: (packageIds) => {
                void this._removeAddons(packageIds);
            },
            getUsedNodeTypeIds: () => this._getUsedNodeTypeIds(),
        });

        this._inventoryPanel = new FirmwareInventoryPanel({
            i18nService: this._i18nService,
            logger: this._logger,
            getEntries: () => this._firmwareEntries,
            getContext: () => this._collectionContext(),
            availablePackageIds: () => this._packagesPanel?.availablePackageIds() ?? [],
            hasFeature: (id) => this._hasFeature(id),
            isBusy: () => this._jobState.busy,
            isRefreshing: () => this._jobState.job === 'list' && this._jobState.busy,
            isAddonPackage: (packageId) =>
                this._runtime?.packageProvenance(packageId) === 'addon',
            registerControl: (control, gate) => this._registerControl(control, gate),
            onSelect: (entry) => {
                this._selectedFirmwarePath = entry ? entry.path : null;
                this._renderDeploySection();
            },
            onRefresh: () => {
                void this._refreshFirmwareInventory();
            },
            onDelete: (entry) => {
                void this._deleteFirmwareImage(entry);
            },
            onRequestImport: () => {
                void this._importFirmwarePackageFromPath();
            },
            onRequestImportUrl: () => {
                void this._importFirmwarePackageFromUrl();
            },
            onExport: (entry) => {
                void this._exportFirmwarePackage(entry);
            },
        });
    }

    /**
     * Build the static skeleton once, then refresh state text. All nodes are
     * created with `document.createElement`; server data is never spliced into
     * `innerHTML`.
     */
    render(container: HTMLElement): void {
        if (!this._built || this._container !== container) {
            container.replaceChildren();
            this._buildShell(container);
            this._built = true;
        }
        this._renderState();
        this._renderPanels();
    }

    afterAttach(): void {
        this._subscribeToLanguageChanges(() => this._rerenderForLocale());
        this._capabilityUnsubscribe = this._firmwareCapabilities.subscribe(() => {
            if (this._container) {
                this._renderState();
                this._renderPanels();
            }
        });
        this._collectionUnsubscribe = this._collectionManager.on('*', (event) => {
            if ((event as { name?: unknown }).name === 'activeCollectionChanged') {
                this._subscribeToGraphChanges();
                this._renderPanels();
            }
        });
        this._subscribeToGraphChanges();
        this._jobUnsubscribe = this._jobClient.on('frame', (event) => {
            this._onFrame((event as { detail?: { frame?: unknown } }).detail?.frame);
        });
        this._socketUnsubscribe = this._jobClient.on('socketState', (event) => {
            const detail = (event as { detail?: { open?: boolean; reason?: string } }).detail;
            if (detail && detail.open === false) {
                this._onSocketClosed(detail.reason ?? 'closed');
            }
        });
        void this._refreshCapabilities();
        void this._fetchPorts();
        void this._refreshFirmwareInventory();
    }

    beforeDetach(): void {
        if (this._capabilityUnsubscribe) {
            this._capabilityUnsubscribe();
            this._capabilityUnsubscribe = null;
        }
        if (this._collectionUnsubscribe) {
            this._collectionUnsubscribe();
            this._collectionUnsubscribe = null;
        }
        if (this._graphUnsubscribe) {
            this._graphUnsubscribe();
            this._graphUnsubscribe = null;
        }
        if (this._jobUnsubscribe) {
            this._jobUnsubscribe();
            this._jobUnsubscribe = null;
        }
        if (this._socketUnsubscribe) {
            this._socketUnsubscribe();
            this._socketUnsubscribe = null;
        }
        this._hideJobProgress();
        this._newlyBuiltPaths.clear();
        this._selectedFirmwarePath = null;
        this._firmwareEntries = [];
        this._inventoryLoaded = false;
        for (const toolbar of [this._buildToolbar, this._deployToolbar]) {
            if (toolbar?.isAttached) {
                toolbar.detach();
            }
        }
        for (const collapsible of [
            this._offlineCollapsible,
            this._packagesSubCollapsible,
            this._addonsSubCollapsible,
            this._helpCollapsible,
            this._targetsCollapsible,
            this._inventoryCollapsible,
            this._buildFirmwareCollapsible,
            this._deployCollapsible,
            ...Object.values(this._logSubCollapsibles),
        ]) {
            if (collapsible?.isAttached) {
                collapsible.detach();
            }
        }
        // The offline body is rebuilt from the locale on the next attach, and the
        // next outage must collapse the section again rather than remember the
        // previous attach's state.
        this._offlineMarkdownView = null;
        this._offlineDiagnosticsEl = null;
        this._offlineMode = false;
        if (this._deployPortNoteView) {
            this._deployPortNoteView.detach();
            this._deployPortNoteView = null;
        }
        super.beforeDetach();
    }

    /**
     * Probe (or re-probe) the capability endpoint. The probing render happens
     * synchronously before the await so the first paint is never a half-enabled
     * form.
     */
    async _refreshCapabilities(force = false): Promise<void> {
        this._probing = true;
        if (this._container) {
            this._renderState();
        }
        await this._firmwareCapabilities.refresh({ force });
        this._probing = false;
        if (this._container) {
            this._renderState();
        }
    }

    /**
     * Re-render text after a locale switch. Never probes: the store snapshot is
     * left untouched, so the probe counter stays the same.
     */
    _rerenderForLocale(): void {
        if (!this._container) {
            return;
        }
        this._renderHelpText();
        this._renderState();
        this._renderPanels();
    }

    /**
     * Apply the capability snapshot to the tab: control availability, the
     * diagnostic lines in the Build log, and panes-vs-offline mode.
     *
     * While `_probing` the snapshot may still be the previous one, so
     * `ready && !this._probing` is what disables every control during a forced
     * re-probe. The per-control gates (`firmware-compile`, `firmware-deploy`,
     * `local-package-scan`, `node-package-addons`, `local-file-access`) decide the
     * rest.
     */
    _renderState(): void {
        const snapshot = this._firmwareCapabilities.getSnapshot();
        this._setControlsEnabled(this._capabilitiesReady());
        this._renderCapabilityDiagnostics(snapshot);
        this._renderOfflineExplainer();
    }

    /**
     * Whether the tab may act on the current snapshot.
     *
     * While `_probing` the snapshot is still the previous one, so a probe in
     * flight counts as "not ready". Every control decision reads this predicate,
     * so no section render can re-enable a control that `_renderState()` just
     * disabled.
     */
    _capabilitiesReady(): boolean {
        return !this._probing && this._firmwareCapabilities.getSnapshot()?.state === 'ready';
    }

    /**
     * Compose the capability diagnostics of a `ready` snapshot as plain lines.
     *
     * A missing `firmware-compile`/`firmware-deploy` feature is explained per
     * backend, so the reader learns *which* toolchain is missing and why; the
     * doctor hint closes the list. The server's `reason` string is echoed
     * untranslated, because it describes a local installation.
     *
     * @param capabilities The `ready` capability payload to describe.
     * @returns One line per unavailable backend, then the doctor hint; `[]` when
     *          both features are advertised.
     */
    _buildDiagnosticLines(capabilities: ServerCapabilities): string[] {
        const lines: string[] = [];
        const describe = (backends: FirmwareBackendDescriptor[]): void => {
            const unavailable = backends.filter((backend) => !backend.available);
            if (unavailable.length === 0) {
                lines.push(this.t('firmwareBuild.doctor.noBackend'));
                return;
            }
            for (const backend of unavailable) {
                lines.push(
                    this.t('firmwareBuild.doctor.backend', {
                        backend: backend.id,
                        reason: backend.reason ?? this.t('firmwareBuild.doctor.noReason'),
                    })
                );
            }
        };

        if (!capabilities.features.includes('firmware-compile')) {
            describe(capabilities.buildBackends);
        }
        if (!capabilities.features.includes('firmware-deploy')) {
            describe(capabilities.flashBackends);
        }
        if (lines.length > 0) {
            lines.push(this.t('firmwareBuild.doctor.hint'));
        }
        return lines;
    }

    /**
     * Rebuild the capability diagnostics and mirror them into the Build log.
     *
     * The lines are derived from the snapshot on every render instead of being
     * appended once, so re-rendering cannot duplicate them; the job render only
     * runs when the text actually changed. An unavailable snapshot clears them:
     * the offline Help section explains that case instead.
     *
     * @param snapshot The current capability snapshot, if any.
     */
    _renderCapabilityDiagnostics(snapshot: ServerCapabilitiesSnapshot | null): void {
        const texts = snapshot?.state === 'ready' ? this._buildDiagnosticLines(snapshot.capabilities) : [];
        const changed =
            texts.length !== this._diagnosticTexts.length ||
            texts.some((text, index) => text !== this._diagnosticTexts[index]);
        if (!changed) {
            return;
        }
        this._diagnosticTexts = texts;
        this._capabilityDiagnostics = texts.map((text) => ({
            stream: 'stdout',
            text: `warning: ${text}\n`,
        }));
        if (this._container) {
            this._renderJobPanels();
        }
    }

    /**
     * Register a control so `_setControlsEnabled` reaches it. An optional gate
     * additionally requires a feature before the control can be enabled. No code
     * may set `disabled` on a registered control directly.
     */
    _registerControl(
        control: DisableableControl,
        gate?: (snapshot: ServerCapabilitiesSnapshot | null) => boolean
    ): void {
        this._controls.push({ control, gate });
    }

    /**
     * Enable or disable every registered control, applying per-control gates.
     */
    _setControlsEnabled(enabled: boolean): void {
        const snapshot = this._firmwareCapabilities.getSnapshot();
        for (const entry of this._controls) {
            const gated = entry.gate ? !entry.gate(snapshot) : false;
            entry.control.setDisabled(!enabled || gated);
        }
    }

    /**
     * Return whether a firmware feature is advertised by the current snapshot.
     * An unavailable snapshot answers `false`, the correct answer for every
     * control.
     */
    _hasFeature(id: string): boolean {
        const snapshot = this._firmwareCapabilities.getSnapshot();
        if (!snapshot || snapshot.state !== 'ready') {
            return false;
        }
        return snapshot.capabilities.features.includes(id);
    }


    /**
     * Resolve the active runtime and render the target + package panels.
     *
     * A visible offline section means the panes are hidden, so there is nothing to
     * render into and the panel work is skipped.
     */
    _renderPanels(): void {
        if (this._offlineSectionEl && !this._offlineSectionEl.hidden) {
            return;
        }
        this._runtime = this._resolveRuntime();
        this._renderTargetsSection();
        this._renderPackagesSection();
        this._renderAddonsSection();
        this._setSectionVisible(
            this._addonsSubHostEl,
            this._firmwareCapabilities.getSnapshot()?.state === 'ready'
        );
        this._inventoryPanel?.renderInventorySection();
        this._renderJobPanels();
        if (!this._boardCatalogLoaded) {
            void this._ensureBoardCatalog();
        }
    }

    /**
     * Resolve the runtime for the active collection, or `null`.
     */
    _resolveRuntime(): FirmwareRuntimeLike | null {
        const collection = this._collectionManager.getActiveCollection();
        const runtimeId = collection?.getDeviceRuntimeId();
        if (!runtimeId) {
            return null;
        }
        return this._runtimeCollection.getRuntime(runtimeId);
    }

    /**
     * Lazily load the board catalog and re-render the info row when it arrives.
     */
    async _ensureBoardCatalog(): Promise<void> {
        if (this._boardCatalogLoaded) {
            return;
        }
        if (this._offlineSectionEl && !this._offlineSectionEl.hidden) {
            return;
        }
        this._boardCatalog = await loadBoardCatalog();
        this._boardCatalogLoaded = true;
        if (this._container) {
            this._renderInfoRow();
            this._inventoryPanel?.renderInventorySection();
        }
    }

    /**
     * Return the currently selected target, or `null`.
     *
     * Reads the same list the dropdown offers, so a target that is no longer
     * selectable (a stored id that names a wildcard target) resolves to `null`
     * and the dependent panels fall back to their "no target" rendering instead
     * of gating on a target this tab cannot build.
     */
    _selectedTarget(): FirmwareTargetLike | null {
        if (!this._selectedTargetId) {
            return null;
        }
        return this._selectableTargets().find((t) => t.id === this._selectedTargetId) ?? null;
    }

    /**
     * Return the targets the target dropdown offers: the ones the server can build.
     *
     * A target is buildable when the runtime's compile-target mapping names a
     * concrete board for it. A wildcard mapping (`compile.board == "*"`, which is
     * what `generic_micropython` declares) resolves to "no board", so the server
     * answers `target-unknown` for every compile and deploy request that names
     * such a target — offering it in the chooser would only stage a guaranteed
     * failure. When the connected board's firmware records `allowedWebTargetIds`
     * the buildable list is intersected with it, so an onboarded board is only
     * offered targets its firmware can actually build. The filter picks the
     * *options*; the board of the chosen target is still resolved server-side
     * from `targetId`.
     *
     * When no target resolves a board (a mapping catalog that failed to load, or
     * a runtime whose targets are all wildcards) the unfiltered list is returned
     * instead of an empty chooser: the info row then names the per-target reason
     * (`firmwareBuild.target.noMapping`) and Build/Deploy stay disabled, which
     * tells the user more than a dropdown with nothing in it.
     */
    _selectableTargets(): FirmwareTargetLike[] {
        const runtime = this._runtime;
        if (!runtime) {
            return [];
        }
        const targets = runtime.listOnboardingTargets
            ? runtime.listOnboardingTargets()
            : runtime.getAvailableTargets();
        const buildable = targets.filter(
            (target) => !!target.id && runtime.getCompileTarget(target.id) !== null
        );
        const image = {
            buildBaseTargetId: this._deviceConnection.getBuildBaseTargetId?.() ?? null,
            allowedWebTargetIds: this._deviceConnection.getAllowedWebTargetIds?.() ?? null,
        };
        if (
            image.buildBaseTargetId ||
            (image.allowedWebTargetIds && image.allowedWebTargetIds.length > 0)
        ) {
            return buildable.filter(
                (target) =>
                    target.id !== null &&
                    isTargetCompatibleWithImage(target.id, image, runtime)
            );
        }
        return buildable.length > 0 ? buildable : targets;
    }

    /**
     * Populate the target dropdown and its info row.
     *
     * The dropdown lists only buildable targets (see `_selectableTargets`). The
     * default selection prefers, in order: the active collection's target (only
     * when it is buildable, which excludes the generic/custom wildcard targets),
     * the runtime's default target, then the first offered target. An explicit user
     * pick is kept across collection switches.
     */
    _renderTargetsSection(): void {
        if (!this._targetDropdown) {
            return;
        }
        const runtime = this._runtime;
        if (!runtime) {
            this._targetDropdown.setOptions([]);
            this._infoTable?.setRows([]);
            return;
        }
        const collection = this._collectionManager.getActiveCollection();
        const collectionId = collection?.getId?.() ?? null;
        if (!this._targetPinnedByUser && this._collectionTargetOrigin !== collectionId) {
            this._selectedTargetId = null;
            this._collectionTargetOrigin = collectionId;
        }
        const targets = this._selectableTargets();
        this._targetDropdown.setOptions(
            targets.map((target) => ({
                value: target.id ?? '',
                label: target.displayName ?? target.id ?? '',
            }))
        );
        if (!this._selectedTargetId || !targets.some((t) => t.id === this._selectedTargetId)) {
            const collectionTargetId = collection?.getTargetId?.() ?? null;
            let preferred: string | null = null;
            if (
                collectionTargetId &&
                targets.some((t) => t.id === collectionTargetId) &&
                runtime.getCompileTarget(collectionTargetId) !== null
            ) {
                preferred = collectionTargetId;
            } else if (
                runtime.defaultDeviceTargetId &&
                targets.some((t) => t.id === runtime.defaultDeviceTargetId)
            ) {
                preferred = runtime.defaultDeviceTargetId;
            }
            this._selectedTargetId = preferred ?? targets[0]?.id ?? null;
        }
        if (this._selectedTargetId) {
            this._targetDropdown.setValue(this._selectedTargetId);
        }
        this._renderInfoRow();
    }

    /**
     * Render the board/chip/offset info row for the selected target.
     */
    _renderInfoRow(): void {
        if (!this._infoTable) {
            return;
        }
        const runtime = this._runtime;
        const target = this._selectedTarget();
        if (!runtime || !target || !target.id) {
            this._infoTable.setRows([this._messageRow(this.t('firmwareBuild.target.noRuntime'))]);
            return;
        }
        const mapping = runtime.getCompileTarget(target.id);
        if (!mapping) {
            this._infoTable.setRows([this._messageRow(this.t('firmwareBuild.target.noMapping'))]);
            return;
        }
        const board = findBoardForCompileTarget(this._boardCatalog, mapping);
        if (!board) {
            this._infoTable.setRows([
                this._messageRow(`${this.t('firmwareBuild.target.unknownBoard')}: ${mapping.board}`),
            ]);
            return;
        }
        const rows = [
            this._infoRow(this.t('firmwareBuild.target.board'), board.displayName),
            this._infoRow(this.t('firmwareBuild.target.port'), board.port),
        ];
        if (board.chip) {
            rows.push(this._infoRow(this.t('firmwareBuild.target.chip'), board.chip));
        }
        if (board.firmwareFlashOffset) {
            rows.push(this._infoRow(this.t('firmwareBuild.target.flashOffset'), board.firmwareFlashOffset));
        }
        this._infoTable.setRows(rows);
    }

    /** Build one label/value row for a two-column `DataTableView`. */
    _infoRow(label: string, value: string): { cells: { text: string }[] } {
        return { cells: [{ text: label }, { text: value }] };
    }

    /** Build a full-width message row (empty label cell, message in the value cell). */
    _messageRow(message: string): { cells: { text: string }[] } {
        return { cells: [{ text: '' }, { text: message }] };
    }


    /**
     * Render the package checklist as a `DataTableView`.
     */
    _renderPackagesSection(): void {
        this._packagesPanel?.renderPackagesSection();
    }

    /** Render the Installed add-ons checklist. */
    _renderAddonsSection(): void {
        this._packagesPanel?.renderAddonsSection();
    }

    /**
     * Refresh local packages via `scan-local`: connect, send, and reload on a
     * successful scan. Refused while any job runs (it never cancels a build).
     */
    async _refreshLocalPackages(): Promise<void> {
        const runtime = this._runtime;
        if (!runtime?.id) {
            return;
        }
        if (this._jobState.busy) {
            this._addGroupNotice('build', 'error', this.t('firmwareBuild.packages.scanFailed'));
            return;
        }
        this._startGroupJob('scan');
        this._renderJobPanels();
        await this._jobClient.connect();
        this._jobClient.scanLocal({ runtimeId: runtime.id });
        this._scanRuntimeId = runtime.id;
    }

    /**
     * Handle a completed scan: reload the runtime collection and re-render.
     */
    _handleScanResult(status: string): void {
        if (this._jobState.job !== 'scan') {
            return;
        }
        if (status === 'succeeded') {
            void this._runtimeCollection.load().then(() => {
                this._renderPanels();
            });
        }
    }

    /**
     * Handle a completed `firmware.list`: decode the payload into
     * `_firmwareEntries`, flag a failure, and re-render the inventory.
     */
    _handleInventoryResult(status: string): void {
        const payload = this._jobState.result?.payload;
        if (status === 'succeeded') {
            this._firmwareEntries = decodeFirmwareInventoryResult(payload);
            this._inventoryRefreshFailed = false;
            this._inventoryLoaded = true;
            const built = this._firmwareEntries.find((entry) =>
                this._newlyBuiltPaths.has(entry.path)
            );
            if (built) {
                this._selectedFirmwarePath = built.path;
                this._inventoryPanel?.selectPath(built.path);
            }
        } else {
            this._firmwareEntries = [];
            this._inventoryRefreshFailed = true;
            this._inventoryLoaded = false;
            this._addGroupNotice(
                'inventory',
                'error',
                this.t('firmwareBuild.inventory.refreshFailed')
            );
        }
        this._inventoryPanel?.setNewPaths(this._newlyBuiltPaths);
        this._inventoryPanel?.setRefreshFailed(this._inventoryRefreshFailed);
        this._inventoryPanel?.renderInventorySection();
        this._renderDeployFirmwareStatus();
    }

    /**
     * Handle a completed `firmware.delete`: the result carries the refreshed
     * inventory, so decode it and clear the selection on success.
     */
    _handleDeleteResult(status: string): void {
        const payload = this._jobState.result?.payload;
        if (status === 'succeeded') {
            this._firmwareEntries = decodeFirmwareInventoryResult(payload);
            this._inventoryRefreshFailed = false;
            this._inventoryLoaded = true;
            this._selectedFirmwarePath = null;
            this._newlyBuiltPaths.clear();
            this._inventoryPanel?.clearSelection();
        }
        this._inventoryPanel?.setNewPaths(this._newlyBuiltPaths);
        this._inventoryPanel?.setRefreshFailed(this._inventoryRefreshFailed);
        this._inventoryPanel?.renderInventorySection();
        this._renderDeployFirmwareStatus();
    }

    /**
     * Refresh installed add-ons: reload the runtime collection (which re-reads the
     * merged index) and re-render the package and add-on panels.
     */
    async _refreshAddons(): Promise<void> {
        await this._runtimeCollection.load();
        this._renderPanels();
    }

    /**
     * Return what the active collection needs from an image: the packages it uses
     * plus the selected board/runtime.
     *
     * Fed to the inventory rows and the composition banner, which answer "can this
     * image run my collection?". Deliberately **not** the package checklist — see
     * `_selectionContext()`.
     */
    _collectionContext(): FirmwareCompatibilityContext {
        return {
            requiredPackageIds: this._packagesPanel?.collectionPackageIds() ?? [],
            runtimeId: this._runtime?.id ?? '',
            boardId: this._selectedBoardSpec()?.slug ?? '',
        };
    }

    /**
     * Return the packages the next build would ask for: the ticked checklist plus
     * the selected board/runtime.
     *
     * Fed only to `findFirmwareSelectionMatch()` ("is there already an image for
     * the combination I am about to build?"). Never fed to the inventory
     * classification: a slim build made from a "Minimal" selection is normally
     * deployed with every package still ticked, and judging images against the
     * checkboxes would withhold the tick from an image that runs the collection.
     */
    _selectionContext(): FirmwareSelection {
        return {
            packageIds: [...(this._packagesPanel?.selectedPackageIds() ?? new Set<string>())],
            runtimeId: this._runtime?.id ?? '',
            boardId: this._selectedBoardSpec()?.slug ?? '',
        };
    }

    /** Return the board-catalog entry for the selected target, or `null`. */
    _selectedBoardSpec(): FirmwareBoardSpec | null {
        const runtime = this._runtime;
        const target = this._selectedTarget();
        if (!runtime || !target?.id) {
            return null;
        }
        const mapping = runtime.getCompileTarget(target.id);
        if (!mapping) {
            return null;
        }
        return findBoardForCompileTarget(this._boardCatalog, mapping);
    }

    /**
     * Refresh the local firmware inventory via `firmware.list`: connect, send,
     * and let the result frame populate `_firmwareEntries`. Refused while any job
     * runs.
     */
    async _refreshFirmwareInventory(): Promise<void> {
        if (this._jobState.busy) {
            return;
        }
        this._inventoryRefreshFailed = false;
        this._startGroupJob('list');
        this._renderJobPanels();
        this._inventoryPanel?.renderInventorySection();
        try {
            await this._jobClient.connect();
            this._jobClient.listFirmware();
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._inventoryRefreshFailed = true;
            if (this._container) {
                this._inventoryPanel?.setRefreshFailed(true);
                this._addGroupNotice(
                    'inventory',
                    'error',
                    this.t('firmwareBuild.errors.disconnected')
                );
            }
        }
    }

    /**
     * Delete one firmware image via `firmware.delete`, after a whole-app
     * `ViewManager.showConfirmation` (destructive, Escape cancels). The refreshed
     * inventory arrives in the delete result frame; selection is cleared there.
     */
    async _deleteFirmwareImage(entry: FirmwareInventoryEntry): Promise<void> {
        if (this._jobState.busy) {
            return;
        }
        const confirmed = await this._viewManager.showConfirmation({
            title: this.t('firmwareBuild.inventory.deleteConfirmTitle'),
            message: this.t('firmwareBuild.inventory.deleteConfirm', {
                name: entry.filename,
            }),
            detail: entry.path,
            confirmLabel: this.t('firmwareBuild.inventory.delete'),
            cancelLabel: this.t('firmwareBuild.inventory.cancel'),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        this._startGroupJob('delete');
        this._lastDeletedPath = entry.path;
        this._renderJobPanels();
        try {
            await this._jobClient.connect();
            this._jobClient.deleteFirmware({ firmwarePath: entry.path });
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._addGroupNotice('inventory', 'error', this.t('firmwareBuild.errors.disconnected'));
        }
    }

    /**
     * Import one firmware package via `firmware.import`, gated on
     * `firmware-compile` exactly like delete. The refreshed inventory arrives in
     * the import result frame; a name collision re-sends with `force` after a
     * whole-app `ViewManager.showConfirmation`.
     */
    async _importFirmwarePackage(payload: {
        path?: string;
        url?: string;
        force?: boolean;
    }): Promise<void> {
        if (this._jobState.busy) {
            return;
        }
        this._pendingImport = { kind: 'package', ...payload };
        this._startGroupJob('import');
        this._renderJobPanels();
        try {
            await this._jobClient.connect();
            this._jobClient.importFirmware(payload);
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._addGroupNotice('inventory', 'error', this.t('firmwareBuild.errors.disconnected'));
        }
    }

    /** Open the server-side picker in file mode and route the chosen name. */
    async _importFirmwarePackageFromPath(): Promise<void> {
        const path = await this._pickServerPath({
            mode: 'file',
            extensions: ['.firmware.zip', '.bin'],
        });
        if (!path) {
            return;
        }
        await this._routeImportSource({ path });
    }

    /**
     * Route a picked path or URL to the package or binary import frame.
     *
     * `isBinaryFirmwareSource` is the single routing decision in this view: a
     * `.bin` name asks for the platform and sends `firmware.import-binary`, every
     * other name keeps the package path unchanged.
     */
    async _routeImportSource(source: { path?: string; url?: string }): Promise<void> {
        const name = source.path ?? source.url ?? '';
        if (isBinaryFirmwareSource(name)) {
            const targetId = await this._promptImportTarget();
            if (!targetId) {
                return;
            }
            await this._importFirmwareBinary({ ...source, targetId });
            return;
        }
        await this._importFirmwarePackage(source);
    }

    /**
     * Ask for the platform that flashes a raw image, reusing the form-dialog
     * dropdown. The platform selects how the image is flashed (chip, flash offset);
     * the image itself carries no runtime, so the runtime is installed afterwards.
     * Returns `null` when the user cancels or no target is selectable.
     */
    async _promptImportTarget(): Promise<string | null> {
        const targets = this._selectableTargets();
        if (targets.length === 0) {
            this._addGroupNotice(
                'inventory',
                'error',
                this.t('firmwareBuild.errors.noTarget')
            );
            return null;
        }
        const defaultValue =
            targets.some((target) => target.id === this._selectedTargetId)
                ? this._selectedTargetId
                : (targets[0]?.id ?? null);
        const result = await this._viewManager.showFormDialog({
            title: this.t('firmwareBuild.inventory.importTargetTitle'),
            message: this.t('firmwareBuild.inventory.importTargetMessage'),
            icon: '📦',
            fields: [
                {
                    id: 'targetId',
                    type: 'dropdown',
                    required: true,
                    label: this.t('firmwareBuild.inventory.importTargetLabel'),
                    options: targets.map((target) => ({
                        value: target.id ?? '',
                        label: target.displayName ?? target.id ?? '',
                    })),
                    defaultValue: defaultValue ?? undefined,
                },
            ],
            confirmLabel: this.t('firmwareBuild.inventory.import'),
            cancelLabel: this.t('firmwareBuild.inventory.cancel'),
        });
        const formData = (result?.formData ?? null) as { targetId?: string } | null;
        if (!result?.confirmed || !formData?.targetId) {
            return null;
        }
        return String(formData.targetId);
    }

    /**
     * Import one raw `.bin` via `firmware.import-binary`, gated on
     * `firmware-compile` exactly like the package import. The platform (`targetId`)
     * is provenance only — the imported image carries no device configuration.
     */
    async _importFirmwareBinary(payload: {
        path?: string;
        url?: string;
        targetId: string;
        force?: boolean;
    }): Promise<void> {
        if (this._jobState.busy) {
            return;
        }
        this._pendingImport = { kind: 'binary', ...payload };
        this._startGroupJob('import');
        this._renderJobPanels();
        try {
            await this._jobClient.connect();
            this._jobClient.importFirmwareBinary(payload);
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._addGroupNotice('inventory', 'error', this.t('firmwareBuild.errors.disconnected'));
        }
    }

    /** Open the *from URL…* dialog and route the entered URL. */
    async _importFirmwarePackageFromUrl(): Promise<void> {
        const result = await this._viewManager.showFormDialog({
            title: this.t('firmwareBuild.inventory.importFromUrlTitle'),
            message: this.t('firmwareBuild.inventory.importFromUrlMessage'),
            icon: '🔗',
            fields: [
                {
                    id: 'url',
                    type: 'text',
                    required: true,
                    label: this.t('firmwareBuild.inventory.urlLabel'),
                    placeholder: 'https://example.com/app.firmware.zip',
                    validator: (value: string) => {
                        const problem = validateArchiveUrl(String(value));
                        return problem === true ? true : this.t(problem);
                    },
                },
            ],
            confirmLabel: this.t('firmwareBuild.inventory.import'),
            cancelLabel: this.t('firmwareBuild.inventory.cancel'),
        });
        const formData = (result?.formData ?? null) as { url?: string } | null;
        if (result?.confirmed && formData?.url) {
            void this._routeImportSource({ url: String(formData.url) });
        }
    }

    /**
     * Ask to replace an existing image, then re-send the pending import with
     * `force: true`. The refused import is already recorded in the inventory log.
     */
    async _confirmImportOverwrite(): Promise<void> {
        const pending = this._pendingImport;
        if (!pending) {
            return;
        }
        const confirmed = await this._viewManager.showConfirmation({
            title: this.t('firmwareBuild.inventory.importConfirmTitle'),
            message: this.t('firmwareBuild.inventory.importConfirm', {
                name: this._sourceDisplayName(pending),
            }),
            confirmLabel: this.t('firmwareBuild.inventory.import'),
            cancelLabel: this.t('firmwareBuild.inventory.cancel'),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        const { kind, ...frame } = pending;
        if (kind === 'binary') {
            const payload: {
                path?: string;
                url?: string;
                targetId: string;
                force: boolean;
            } = { targetId: pending.targetId, force: true };
            if (frame.path !== undefined) {
                payload.path = frame.path;
            }
            if (frame.url !== undefined) {
                payload.url = frame.url;
            }
            await this._importFirmwareBinary(payload);
            return;
        }
        await this._importFirmwarePackage({ ...frame, force: true });
    }

    /**
     * Install one add-on archive via `addon.install`, which the server accepts
     * without a capability gate because it writes only the addons folder. The
     * refreshed add-on table arrives in the result frame; an existing id is refused
     * with `addon-already-installed` and re-sent with `force` after the user
     * confirms, the same two-step the firmware import uses.
     */
    async _installAddon(payload: {
        path?: string;
        url?: string;
        force?: boolean;
    }): Promise<void> {
        if (this._jobState.busy) {
            return;
        }
        this._pendingAddonInstall = payload;
        this._startGroupJob('addon-install');
        this._renderJobPanels();
        try {
            await this._jobClient.connect();
            this._jobClient.installAddon(payload);
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._addGroupNotice('build', 'error', this.t('firmwareBuild.errors.disconnected'));
        }
    }

    /** Open the server-side picker in file mode and install the chosen path. */
    async _installAddonFromPath(): Promise<void> {
        const path = await this._pickServerPath({ mode: 'file', extensions: ['.zip'] });
        if (!path) {
            return;
        }
        await this._installAddon({ path });
    }

    /** Open the *from URL…* dialog and install the entered URL. */
    async _installAddonFromUrl(): Promise<void> {
        const result = await this._viewManager.showFormDialog({
            title: this.t('firmwareBuild.addons.installFromUrlTitle'),
            message: this.t('firmwareBuild.addons.installFromUrlMessage'),
            icon: '🔗',
            fields: [
                {
                    id: 'url',
                    type: 'text',
                    required: true,
                    label: this.t('firmwareBuild.inventory.urlLabel'),
                    placeholder: 'https://example.com/my-nodes.zip',
                    validator: (value: string) => {
                        const problem = validateArchiveUrl(String(value));
                        return problem === true ? true : this.t(problem);
                    },
                },
            ],
            confirmLabel: this.t('firmwareBuild.addons.install'),
            cancelLabel: this.t('firmwareBuild.addons.cancel'),
        });
        const formData = (result?.formData ?? null) as { url?: string } | null;
        if (result?.confirmed && formData?.url) {
            void this._installAddon({ url: String(formData.url) });
        }
    }

    /**
     * Ask to replace an installed add-on, then re-send the pending install with
     * `force: true`. The refused install is already recorded in the build log.
     */
    async _confirmAddonReplace(): Promise<void> {
        const payload = this._pendingAddonInstall;
        if (!payload) {
            return;
        }
        const confirmed = await this._viewManager.showConfirmation({
            title: this.t('firmwareBuild.addons.installConfirmTitle'),
            message: this.t('firmwareBuild.addons.installConfirm', {
                name: this._sourceDisplayName(payload),
            }),
            confirmLabel: this.t('firmwareBuild.addons.install'),
            cancelLabel: this.t('firmwareBuild.addons.cancel'),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await this._installAddon({ ...payload, force: true });
    }

    /**
     * Remove the ticked add-ons via `addon.uninstall`, after a whole-app
     * `ViewManager.showConfirmation` (destructive, Escape cancels).
     */
    async _removeAddons(packageIds: string[]): Promise<void> {
        if (this._jobState.busy || packageIds.length === 0) {
            return;
        }
        const confirmed = await this._viewManager.showConfirmation({
            title: this.t('firmwareBuild.addons.removeConfirmTitle'),
            message: this.t('firmwareBuild.addons.removeConfirm', {
                names: packageIds.join(', '),
            }),
            confirmLabel: this.t('firmwareBuild.addons.remove'),
            cancelLabel: this.t('firmwareBuild.addons.cancel'),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        this._startGroupJob('addon-uninstall');
        this._renderJobPanels();
        try {
            await this._jobClient.connect();
            this._jobClient.uninstallAddon({ packageIds });
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._addGroupNotice('build', 'error', this.t('firmwareBuild.errors.disconnected'));
        }
    }

    /**
     * Handle a completed add-on job: record the summary lines and, on success,
     * refresh the capabilities and the runtime collection.
     *
     * The `node-package-addons` feature flips the moment the first add-on exists, and
     * the served `/device/node_pkgs/index.json` plus the runtime manifest are
     * synthesized per request, so both must be re-read before the table can show the
     * new package. A failure only needs the log lines `_outcomeLines()` derives.
     */
    _handleAddonResult(status: string): void {
        if (status !== 'succeeded') {
            return;
        }
        const payload = this._jobState.result?.payload;
        const installed = this._asRecord(payload?.installed);
        if (typeof installed.id === 'string') {
            this._lastAddonSummary = [
                this.t('firmwareBuild.addons.installSummary', {
                    name: installed.id,
                    version: typeof installed.version === 'string' ? installed.version : '',
                }),
            ];
        }
        if (Array.isArray(payload?.removed)) {
            this._lastAddonSummary = payload.removed
                .map((entry) => this._asRecord(entry))
                .filter((entry) => typeof entry.id === 'string')
                .map((entry) => this.t('firmwareBuild.addons.removeSummary', { name: entry.id }));
        }
        void this._refreshAddonsAfterMutation();
    }

    /**
     * Re-read everything an add-on mutation invalidates, then re-render.
     *
     * Forced, because the capability store must not answer `node-package-addons` from
     * its TTL cache; the runtime reload is what makes the new package appear in the
     * checklist. `renderState()` re-renders the panels and re-applies control gating.
     */
    async _refreshAddonsAfterMutation(): Promise<void> {
        await this._firmwareCapabilities.refresh({ force: true });
        await this._runtimeCollection.load();
        this._renderState();
    }

    /**
     * Package one published image into a caller-picked folder via `firmware.export`.
     *
     * The Export button is only enabled while the snapshot lists `local-file-access`
     * (because `firmware.export` is refused with `fs-not-allowed` otherwise), so a
     * `null` picker result always means the user cancelled. There is deliberately
     * no typed-path fallback: a remote client must run `mo firmware export` on the
     * host.
     */
    async _exportFirmwarePackage(entry: FirmwareInventoryEntry): Promise<void> {
        const destinationDir = await this._pickServerPath({ mode: 'directory' });
        if (!destinationDir) {
            return;
        }
        this._pendingExport = { firmwarePath: entry.path, destinationDir };
        this._startGroupJob('export');
        this._renderJobPanels();
        try {
            await this._jobClient.connect();
            this._jobClient.exportFirmware(this._pendingExport);
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._addGroupNotice('inventory', 'error', this.t('firmwareBuild.errors.disconnected'));
        }
    }

    /**
     * Ask to overwrite the existing package, then re-send the pending export with
     * `force: true`. Same two-step as import and add-on install.
     */
    async _confirmExportOverwrite(): Promise<void> {
        const pending = this._pendingExport;
        if (!pending) {
            return;
        }
        const confirmed = await this._viewManager.showConfirmation({
            title: this.t('firmwareBuild.inventory.exportConfirmTitle'),
            message: this.t('firmwareBuild.inventory.exportConfirm', {
                path: pending.destinationDir,
            }),
            confirmLabel: this.t('firmwareBuild.inventory.export'),
            cancelLabel: this.t('firmwareBuild.inventory.cancel'),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        const request = { ...pending, force: true };
        this._pendingExport = request;
        this._startGroupJob('export');
        this._renderJobPanels();
        try {
            await this._jobClient.connect();
            this._jobClient.exportFirmware(request);
        } catch {
            this._jobState = markDisconnected(this._jobState);
            this._addGroupNotice('inventory', 'error', this.t('firmwareBuild.errors.disconnected'));
        }
    }

    /**
     * Handle a completed `firmware.export`: record the written absolute path.
     * A failure leaves the stable code in the job state for the inventory log.
     */
    _handleExportResult(status: string): void {
        if (status !== 'succeeded') {
            return;
        }
        const exported = this._asRecord(this._jobState.result?.payload?.exported);
        if (typeof exported.path === 'string') {
            this._lastExportNotice = exported.path;
        }
        this._inventoryPanel?.renderInventorySection();
        this._renderDeployFirmwareStatus();
    }

    /** Return a human display name for one path/url source. */
    private _sourceDisplayName(payload: { path?: string; url?: string }): string {
        if (payload.path) {
            return payload.path.split('/').pop() ?? payload.path;
        }
        if (payload.url) {
            return payload.url.split('/').pop() ?? payload.url;
        }
        return '';
    }

    /**
     * Open a `FilePickerDialogView` and resolve with the chosen path, or `null`
     * when the user cancels or closes it.
     *
     * The capability check sits with the buttons that open the dialog, so a
     * server without `local-file-access` never reaches this helper; the one-line
     * `null` return here is belt-and-braces, not a second branch.
     */
    private _pickServerPath(options: {
        mode: 'file' | 'directory';
        extensions?: string[];
        title?: string;
        hint?: string;
    }): Promise<string | null> {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value: string | null): void => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(value);
            };
            const dialog = new FilePickerDialogView({
                mode: options.mode,
                extensions: options.extensions,
                title: options.title,
                hint: options.hint ?? null,
                listDirectory: (request) => this._jobClient.listDirectory(request),
                i18nService: this._i18nService,
                logger: this._logger,
            });
            dialog.on('confirm', (event) => {
                const detail = event.detail as { path?: unknown };
                finish(typeof detail.path === 'string' ? detail.path : null);
            });
            dialog.on('cancel', () => finish(null));
            dialog.on('close', () => finish(null));
            this._viewManager.showModal(dialog, { scrim: true });
        });
    }

    /**
     * Handle a completed `firmware.import`: decode the refreshed inventory, record
     * the imported summary line, and re-render the inventory.
     */
    _handleImportResult(status: string): void {
        const payload = this._jobState.result?.payload;
        if (status === 'succeeded') {
            this._firmwareEntries = decodeFirmwareInventoryResult(payload);
            this._inventoryRefreshFailed = false;
            this._inventoryLoaded = true;
            const imported = this._asRecord((payload as Record<string, unknown> | null)?.imported);
            const importedStatus = typeof imported.status === 'string' ? imported.status : null;
            const filename = typeof imported.filename === 'string' ? imported.filename : null;
            if (importedStatus && filename) {
                if (imported.source === 'imported-binary') {
                    this._lastImportWasBinary = true;
                    this._lastImportNotice = this.t('firmwareBuild.inventory.importedNotice', {
                        status: importedStatus,
                        filename,
                        target: typeof imported.targetId === 'string' ? imported.targetId : '',
                    });
                } else {
                    this._lastImportWasBinary = false;
                    this._lastImportNotice = `${importedStatus}: ${filename}`;
                }
            } else {
                this._lastImportWasBinary = false;
            }
        }
        this._inventoryPanel?.setNewPaths(this._newlyBuiltPaths);
        this._inventoryPanel?.setRefreshFailed(this._inventoryRefreshFailed);
        this._inventoryPanel?.renderInventorySection();
        this._renderDeployFirmwareStatus();
    }

    /**
     * (Re)subscribe to the active collection's graph events so the inventory's
     * compatibility ticks follow the collection as it is edited.
     *
     * The marker answers "can this image run the collection?", so adding or
     * removing a node that uses a different package changes the answer and must
     * refresh the rows and the composition banner. Only `node-added` and
     * `node-removed` are handled: dragging a node or editing a connection cannot
     * change which packages are needed, and rebuilding the table on every viewport
     * event would be wasted work. Called from `afterAttach()` and whenever the
     * active collection changes; any previous subscription is dropped first.
     */
    private _subscribeToGraphChanges(): void {
        if (this._graphUnsubscribe) {
            this._graphUnsubscribe();
            this._graphUnsubscribe = null;
        }
        const collection = this._collectionManager.getActiveCollection();
        if (typeof collection?.onGraphChange !== 'function') {
            return;
        }
        this._graphUnsubscribe = collection.onGraphChange((event) => {
            const name = (event as { name?: unknown }).name;
            if (name !== 'node-added' && name !== 'node-removed') {
                return;
            }
            this._inventoryPanel?.renderInventorySection();
            this._renderCompositionBanner();
        });
    }

    /**
     * Return the distinct node type ids used across every graph of the active
     * collection.
     *
     * Feeds the packages panel, which maps them to package ids for the "Minimal"
     * button and the inventory's compatibility tick.
     */
    _getUsedNodeTypeIds(): string[] {
        const collection = this._collectionManager.getActiveCollection();
        const graphs = collection?.getGraphArray?.() ?? [];
        const ids = new Set<string>();
        for (const graph of graphs) {
            for (const node of graph.getNodes?.() ?? []) {
                if (typeof node.type === 'string' && node.type.trim()) {
                    ids.add(node.type.trim());
                }
            }
        }
        return [...ids];
    }


    /**
     * Render the Build button's label, glyph, and enabled state from job state, and
     * the "does a firmware for this selection already exist?" line above the package
     * checklist.
     *
     * The glyph follows `busy`, not the label: while a build runs or is being
     * cancelled the button still means "stop this build", so it keeps the close
     * glyph and lets the label distinguish *Cancel* from *Cancelling…*.
     */
    _renderBuildSection(): void {
        this._renderBuildMatch();

        const busy = this._jobState.busy;
        const ready = this._capabilitiesReady();
        const board = this._selectedBoard();
        const hasSelection = (this._packagesPanel?.selectedPackageIds().size ?? 0) > 0;

        if (!this._buildButton) {
            return;
        }

        if (busy) {
            this._buildButton.setIcon(IconProvider.close);
            this._buildButton.setLabel(
                this._cancelRequested
                    ? this.t('firmwareBuild.build.cancelling')
                    : this.t('firmwareBuild.build.cancel')
            );
            this._buildButton.setDisabled(false);
        } else {
            this._buildButton.setIcon(IconProvider.deployedCode);
            this._buildButton.setLabel(this.t('firmwareBuild.build.start'));
            this._buildButton.setDisabled(
                !ready || !this._hasFeature('firmware-compile') || !board || !hasSelection
            );
        }
    }

    /**
     * Render the "existing firmware for this selection" line in the Build
     * Firmware group.
     *
     * The Build button only says whether a build *can* run; this line says whether
     * one is needed, so the user can deploy an image that already embeds the
     * ticked packages instead of rebuilding. It stays hidden until the inventory
     * has been read and both a target and at least one package are known: an
     * unknown or empty list would otherwise claim "no firmware exists".
     *
     * An image that merely *contains* the ticked packages is not the same firmware:
     * the wording therefore follows `match.exact`, so a minimal selection never
     * reads as "this exact firmware exists" when the published image carries more
     * packages. Building the slimmer image stays possible either way — the line
     * informs, it does not gate the Build button.
     *
     * Reads `_selectionContext()` (the ticked checklist), not the collection's
     * needs: the question here is about the next build, not about the tick.
     */
    _renderBuildMatch(): void {
        const el = this._buildMatchEl;
        if (!el) {
            return;
        }
        const selection = this._selectionContext();
        if (!this._inventoryLoaded || !selection.boardId || selection.packageIds.length === 0) {
            el.hidden = true;
            el.textContent = '';
            el.removeAttribute('title');
            return;
        }
        const match = findFirmwareSelectionMatch(this._firmwareEntries, selection);
        el.hidden = false;
        el.className = 'firmware-build-view__build-match';
        if (!match) {
            el.textContent = this.t('firmwareBuild.build.noMatchingFirmware');
            el.title = this.t('firmwareBuild.build.noMatchingFirmwareHint');
            return;
        }
        el.classList.add('firmware-build-view__build-match--exists');
        el.textContent = this.t(
            match.exact
                ? 'firmwareBuild.build.matchingFirmware'
                : 'firmwareBuild.build.matchingFirmwareSuperset',
            { version: match.entry.runtimeFirmwareVersion }
        );
        el.title = this.t(
            match.exact
                ? 'firmwareBuild.build.matchingFirmwareHint'
                : 'firmwareBuild.build.matchingFirmwareHintSuperset'
        );
    }

    /**
     * Render the Deploy button's enabled state and the port row.
     */
    _renderDeploySection(): void {
        const busy = this._jobState.busy;
        const ready = this._capabilitiesReady();
        const board = this._selectedBoard();

        this._deployButton?.setDisabled(
            busy || !ready || !this._hasFeature('firmware-deploy') || !board
        );

        this._renderDeployPorts();
        this._renderDeployFirmwareStatus();
        this._renderCompositionBanner();
    }

    /**
     * Render the composition/identity warning banner under the deploy source.
     *
     * The banner answers "will deploying this selection reuse an existing image
     * or need a rebuild?" against the newest published image for the selected
     * board/runtime (default: newest across channels). It never blocks deploying.
     *
     * Uses `_collectionContext()`: an image that lacks what the collection needs
     * cannot run it, whatever the build checklist says.
     */
    _renderCompositionBanner(): void {
        const el = this._compositionBannerEl;
        if (!el) {
            return;
        }
        const context = this._collectionContext();
        const candidates = this._firmwareEntries.filter(
            (entry) =>
                entry.boardId === context.boardId && entry.runtimeId === context.runtimeId
        );
        if (candidates.length === 0) {
            el.hidden = false;
            el.className = 'firmware-build-view__composition-banner';
            el.textContent = this.t('firmwareBuild.inventory.noImage');
            return;
        }
        const reference = candidates.find((entry) => entry.isLatest) ?? candidates[0];
        const classification = classifyFirmwareCompatibility(reference, context);
        if (classification.status === 'compatible' || classification.status === 'otherTarget') {
            el.hidden = true;
            return;
        }
        el.hidden = false;
        el.className = 'firmware-build-view__composition-banner';
        if (classification.status === 'unknown') {
            el.textContent = this.t('firmwareBuild.inventory.unknownContents');
        } else {
            el.textContent = this.t('firmwareBuild.inventory.missingPackages', {
                ids: classification.missingPackageIds.join(', '),
            });
        }
    }

    /**
     * Render the deploy source: the selected image's identity (firmware version /
     * MicroPython / runtime / hash) when an image is selected, otherwise the last
     * same-target build or the server's newest-image default.
     */
    _renderDeployFirmwareStatus(): void {
        const table = this._deployFirmwareTable;
        const status = this._deployFirmwareStatusEl;
        if (!table || !status) {
            return;
        }
        if (this._selectedFirmwarePath) {
            const entry = this._firmwareEntries.find(
                (item) => item.path === this._selectedFirmwarePath
            );
            if (entry) {
                table.setRows([
                    {
                        cells: [
                            { text: this.t('firmwareBuild.inventory.firmwareVersion') },
                            { text: entry.runtimeFirmwareVersion },
                        ],
                    },
                    {
                        cells: [
                            { text: this.t('firmwareBuild.inventory.channel') },
                            {
                                text:
                                    entry.channel ||
                                    this.t('firmwareBuild.inventory.notAvailable'),
                            },
                        ],
                    },
                    {
                        cells: [
                            { text: this.t('firmwareBuild.inventory.versionSource') },
                            {
                                text:
                                    entry.versionSource ??
                                    this.t('firmwareBuild.inventory.notAvailable'),
                            },
                        ],
                    },
                    {
                        cells: [
                            { text: this.t('firmwareBuild.inventory.micropython') },
                            { text: entry.micropythonVersion },
                        ],
                    },
                    {
                        cells: [
                            { text: this.t('firmwareBuild.inventory.runtime') },
                            { text: entry.runtimeId },
                        ],
                    },
                    {
                        cells: [
                            { text: this.t('firmwareBuild.inventory.hash') },
                            {
                                text:
                                    entry.contentHash ??
                                    this.t('firmwareBuild.inventory.notAvailable'),
                            },
                        ],
                    },
                ]);
                if (this._deployFirmwareHostEl) {
                    this._deployFirmwareHostEl.hidden = false;
                }
                status.hidden = true;
                return;
            }
        }
        table.setRows([]);
        if (this._deployFirmwareHostEl) {
            this._deployFirmwareHostEl.hidden = true;
        }
        status.hidden = false;
        if (this._lastArtifact && this._lastArtifact.targetId === this._selectedTargetId) {
            status.textContent = this.t('firmwareBuild.deploy.firmwarePathFromBuild');
            return;
        }
        status.textContent = this.t('firmwareBuild.deploy.firmwarePathNewest');
    }

    /**
     * Re-render every job-driven area (build/deploy actions, log).
     */
    _renderJobPanels(): void {
        this._renderBuildSection();
        this._renderDeploySection();
        this._renderBuildLog();
        this._renderDeployLog();
        this._renderInventoryLog();
        this._renderJobProgress();
        this._packagesPanel?.updateAddonsButtons();
    }

    /**
     * Show the progress readout of the running action job inside its own group,
     * and hide both readouts for every other state.
     *
     * Only a compile can be cancelled (the server records a deploy `cancel` but
     * runs the flash to completion), so only the build readout offers the button.
     */
    _renderJobProgress(): void {
        const job = this._jobState.job;
        const active = this._jobState.busy && (job === 'compile' || job === 'deploy') ? job : null;

        if (active === 'compile') {
            this._buildFirmwareCollapsible?.expand();
        } else if (active === 'deploy') {
            this._deployCollapsible?.expand();
        }

        this._syncProgressView(
            this._buildProgressView,
            'firmwareBuild.progress.building',
            active === 'compile'
        );
        this._syncProgressView(
            this._deployProgressView,
            'firmwareBuild.progress.deploying',
            active === 'deploy'
        );
    }

    /**
     * Drive one in-group progress readout.
     *
     * `show()` is only called on the hidden → visible transition so the elapsed
     * timer is not restarted by every log frame.
     */
    _syncProgressView(view: ProgressBarView | null, labelKey: string, visible: boolean): void {
        if (!view) {
            return;
        }
        if (!visible) {
            view.hide();
            return;
        }
        const label = this.t(labelKey);
        if (view.isVisible()) {
            view.setLabel(label);
        } else {
            view.show(label);
        }
        view.setStatus(this._jobProgressText());
        const cancelLabel = this._cancelRequested
            ? this.t('firmwareBuild.build.cancelling')
            : this.t('firmwareBuild.progress.cancel');
        view.setCancelLabel(cancelLabel);
        view.setCancelEnabled(!this._cancelRequested);
    }

    /**
     * The most specific progress text the current job offers.
     *
     * The stage line names the step (`write-start`, `write-finish`); the elapsed
     * line beside it is the liveness cue, so a step with no measurable percentage
     * still shows that the job is alive.
     */
    _jobProgressText(): string | null {
        return this._jobState.message ?? this._jobState.stage;
    }

    /** Ask the server to stop the running action job (cooperative). */
    _requestCancel(): void {
        if (!this._jobState.busy || this._cancelRequested) {
            return;
        }
        this._cancelRequested = true;
        this._jobClient.cancel();
        this._renderJobPanels();
    }

    /** Hide both in-group progress readouts. */
    _hideJobProgress(): void {
        this._buildProgressView?.hide();
        this._deployProgressView?.hide();
    }

    /**
     * Reduce one server frame and re-render the job area.
     */
    _onFrame(frame: unknown): void {
        this._jobState = reduceFirmwareFrame(this._jobState, frame);
        const group = this._jobState.job ? this._groupKeyForJob(this._jobState.job) : null;
        if (group === 'build') {
            this._buildLogLines = this._jobState.log;
        } else if (group === 'deploy') {
            this._deployLogLines = this._jobState.log;
        } else if (group === 'inventory') {
            this._inventoryLogLines = this._jobState.log;
        }
        const terminalError =
            this._jobState.error !== null && this._jobState.error.code !== 'job-busy';
        const terminalResult = this._jobState.result !== null;
        const disconnected = this._jobState.phase === 'disconnected';
        if (!this._jobState.busy && (terminalError || terminalResult || disconnected)) {
            this._lastActionSnapshot = {
                phase: this._jobState.phase,
                job: this._jobState.job,
                result: this._jobState.result,
                error: this._jobState.error,
            };
        }
        if (this._jobState.job === 'scan' && !this._jobState.busy) {
            this._handleScanResult(this._jobState.phase);
        }
        if (this._jobState.job === 'list' && !this._jobState.busy) {
            this._handleInventoryResult(this._jobState.phase);
        }
        if (this._jobState.job === 'delete' && !this._jobState.busy) {
            this._handleDeleteResult(this._jobState.phase);
        }
        if (this._jobState.job === 'import' && !this._jobState.busy) {
            this._handleImportResult(this._jobState.phase);
        }
        if (this._jobState.job === 'export' && !this._jobState.busy) {
            this._handleExportResult(this._jobState.phase);
        }
        if (
            (this._jobState.job === 'addon-install' || this._jobState.job === 'addon-uninstall') &&
            !this._jobState.busy
        ) {
            this._handleAddonResult(this._jobState.phase);
        }
        if (
            this._jobState.job === 'import' &&
            !this._jobState.busy &&
            this._jobState.error?.code === 'firmware-import-exists'
        ) {
            void this._confirmImportOverwrite();
        }
        if (
            this._jobState.job === 'export' &&
            !this._jobState.busy &&
            this._jobState.error?.code === 'firmware-export-exists'
        ) {
            void this._confirmExportOverwrite();
        }
        if (
            this._jobState.job === 'addon-install' &&
            !this._jobState.busy &&
            this._jobState.error?.code === 'addon-already-installed'
        ) {
            void this._confirmAddonReplace();
        }
        if (this._jobState.phase === 'succeeded' && this._jobState.job === 'compile') {
            this._handleBuildSuccess();
        }
        if (!this._jobState.busy) {
            this._cancelRequested = false;
        }
        if (!this._jobState.busy && this._isTerminalFailure()) {
            this._expandLogForFailure(this._jobState.job);
        }
        this._renderJobPanels();
    }

    /**
     * Whether the current job ended in a failure the owning log must reveal.
     *
     * Covers the terminal `error` frame, a `failed`/`timeout` result, and a
     * mid-job disconnect; `job-busy` and `cancelled` do not count.
     */
    _isTerminalFailure(): boolean {
        return (
            (this._jobState.error !== null && this._jobState.error.code !== 'job-busy') ||
            this._jobState.phase === 'disconnected' ||
            this._jobState.result?.status === 'failed' ||
            this._jobState.result?.status === 'timeout'
        );
    }

    /**
     * Handle a socket close: the server cancels the job, so clear `busy`.
     */
    _onSocketClosed(_reason: string): void {
        if (!this._jobState.busy) {
            return;
        }
        this._jobState = markDisconnected(this._jobState);
        this._cancelRequested = false;
        this._renderJobPanels();
    }

    /**
     * Capture the build artifact for a same-target deploy reuse.
     */
    _captureArtifact(): void {
        const payload = this._jobState.result?.payload;
        const paths = this._asRecord(payload?.paths);
        const path =
            typeof paths.firmwarePublishedArtifact === 'string'
                ? paths.firmwarePublishedArtifact
                : typeof paths.firmwareArtifact === 'string'
                    ? paths.firmwareArtifact
                    : null;
        if (path) {
            this._lastArtifact = { path, targetId: this._selectedTargetId ?? '' };
        }
    }

    /**
     * Handle a successful build: capture the artifact for deploy reuse and, when
     * the build published an image, remember it as "new" and refresh the local
     * inventory so the freshly built image auto-appears (selected).
     */
    _handleBuildSuccess(): void {
        this._captureArtifact();
        const payload = this._jobState.result?.payload;
        const paths = this._asRecord(payload?.paths);
        const published =
            typeof paths.firmwarePublishedArtifact === 'string'
                ? paths.firmwarePublishedArtifact
                : null;
        if (published) {
            this._newlyBuiltPaths.add(published);
            void this._refreshFirmwareInventory();
        }
    }

    /**
     * Build action: gate → refresh → re-check → connect → send.
     */
    async _onBuildAction(): Promise<void> {
        if (this._jobState.busy) {
            this._requestCancel();
            return;
        }
        const board = this._selectedBoard();
        const runtime = this._runtime;
        if (!board || !runtime || (this._packagesPanel?.selectedPackageIds().size ?? 0) === 0) {
            this._addGroupNotice('build', 'error', this.t('firmwareBuild.packages.noneSelected'));
            return;
        }
        if (!(await this._prepareAction('build', 'firmware-compile', 'firmwareBuild.errors.compile-disabled'))) {
            return;
        }
        this._cancelRequested = false;
        this._startGroupJob('compile');
        await this._jobClient.connect();
        this._jobClient.startCompile(
            buildCompileRequest({
                runtimeId: runtime.id ?? '',
                targetId: this._selectedTargetId,
                baseTargetId: this._selectedTargetId
                    ? (runtime.getTargetBuildBaseId?.(this._selectedTargetId) ?? null)
                    : null,
                packageIds: [...(this._packagesPanel?.selectedPackageIds() ?? new Set())],
                packageVariants: this._packagesPanel?.packageVariants() ?? {},
                cleanBuild: this._cleanBuildControl?.getValue() ?? false,
            })
        );
        this._renderJobPanels();
    }

    /**
     * Deploy action: gate → refresh → re-check → connect → send.
     */
    async _onDeployAction(): Promise<void> {
        const board = this._selectedBoard();
        const port = this._selectedPort();
        if (!board || !port) {
            this._addGroupNotice('deploy', 'error', this.t('firmwareBuild.deploy.noPort'));
            return;
        }
        if (!(await this._prepareAction('deploy', 'firmware-deploy', 'firmwareBuild.errors.deploy-disabled'))) {
            return;
        }
        // One writer per serial port: a flash started while the app still holds
        // the port would fail. Release it now - after the capability gate, so a
        // refusal never disconnects a working device, and before the job starts,
        // so a failed release leaves the Deploy group idle and re-deployable.
        const releasedPort = this._deviceConnection.isConnected();
        if (releasedPort) {
            try {
                await this._deviceConnection.disconnect();
            } catch (error) {
                this._addGroupNotice(
                    'deploy',
                    'error',
                    this.t('firmwareBuild.deploy.portReleaseFailed', {
                        error: (error as Error).message,
                    })
                );
                this._renderDeployPortStatus();
                return;
            }
            this._renderDeployPortStatus();
        }
        const firmwarePath =
            this._selectedFirmwarePath ??
            (this._lastArtifact && this._lastArtifact.targetId === this._selectedTargetId
                ? this._lastArtifact.path
                : null);
        this._cancelRequested = false;
        this._startGroupJob('deploy');
        if (releasedPort) {
            // Reported after the job starts, because `_startGroupJob()` clears the
            // group's evidence lines; the user still reads it as the first line of
            // the deploy the release made possible.
            this._addGroupNotice('deploy', 'info', this.t('firmwareBuild.deploy.portReleased'));
        }
        await this._jobClient.connect();
        this._jobClient.startDeploy(
            buildDeployRequest({
                targetId: this._selectedTargetId,
                baseTargetId: this._selectedTargetId
                    ? (this._runtime?.getTargetBuildBaseId?.(this._selectedTargetId) ?? null)
                    : null,
                port,
                firmwarePath,
                wipeFilesystem: this._wipeControl?.getValue() ?? false,
                backendId: null,
            })
        );
        this._renderJobPanels();
    }


    /**
     * Shared gate → stale-refresh → re-check sequence for build and deploy.
     *
     * A refusal is reported in *group*, the pane that owns the pressed control, so
     * the user sees why the action did not start next to the button. Returns `true`
     * when the action may proceed.
     */
    async _prepareAction(
        group: FirmwareJobGroup,
        feature: string,
        disabledKey: string
    ): Promise<boolean> {
        if (this._jobState.busy) {
            return false;
        }
        if (!this._hasFeature(feature)) {
            this._addGroupNotice(group, 'error', this.t(disabledKey));
            return false;
        }
        if (!(await this._refreshCapabilitiesIfStale())) {
            this._addGroupNotice(
                group,
                'error',
                this.t('firmwareBuild.errors.capabilities-unavailable')
            );
            return false;
        }
        if (!this._hasFeature(feature)) {
            this._addGroupNotice(group, 'error', this.t(disabledKey));
            return false;
        }
        return true;
    }

    /**
     * Refresh a stale capability snapshot; returns `false` on failure.
     */
    async _refreshCapabilitiesIfStale(): Promise<boolean> {
        const store = this._firmwareCapabilities as {
            isStale?: () => boolean;
            refresh?: (options: { force: boolean }) => Promise<unknown>;
        };
        if (typeof store.isStale === 'function' && !store.isStale()) {
            return true;
        }
        if (typeof store.refresh === 'function') {
            await store.refresh({ force: true });
        }
        const after = this._firmwareCapabilities.getSnapshot();
        return after !== null && after.state === 'ready';
    }

    /**
     * Resolve the compile board for the selected target, or `null`.
     *
     * Used only for gating and the info row: the build/deploy request sends
     * `targetId` and lets the server resolve the board, so this value never
     * reaches the request.
     */
    _selectedBoard(): string | null {
        const runtime = this._runtime;
        const target = this._selectedTarget();
        if (!runtime || !target?.id) {
            return null;
        }
        return runtime.getCompileTarget(target.id)?.board ?? null;
    }

    /**
     * Resolve the deploy port from the connected-port chooser, or `null` when
     * nothing is selected.
     */
    _selectedPort(): string | null {
        const selected = this._portDropdown?.getSelectedValue();
        return typeof selected === 'string' && selected !== '' ? selected : null;
    }

    /**
     * Return the group pane that owns *job*'s controls, and therefore its log.
     *
     * Both add-on jobs deliberately fall through to `'build'`: they are started from
     * the Installed add-ons toolbar inside the Build Firmware group, so their output,
     * warnings, errors, and summary land next to the buttons that started them (M4l).
     */
    _groupKeyForJob(job: FirmwareJobState['job']): FirmwareJobGroup {
        if (job === 'deploy') {
            return 'deploy';
        }
        if (job === 'list' || job === 'delete' || job === 'import') {
            return 'inventory';
        }
        return 'build';
    }

    /**
     * Write one client-side notice into the log of *group*.
     *
     * A refusal happens before a job starts, so it cannot travel as a server frame:
     * the text is buffered as an evidence line for the group's log, which keeps "a
     * job reports in the group that owns its controls" true for the pre-action paths
     * too. Capability problems travel the same way, as the group's diagnostic lines.
     */
    _addGroupNotice(
        group: FirmwareJobGroup,
        severity: FirmwareNoticeSeverity,
        text: string
    ): void {
        const evidence: FirmwareLogLine = {
            stream: severity === 'error' ? 'stderr' : 'stdout',
            text: `${severity}: ${text}\n`,
        };
        this._evidenceLines[group] = [...this._evidenceLines[group], evidence].slice(
            -FIRMWARE_LOG_LIMIT
        );
        if (this._container) {
            this._renderJobPanels();
        }
    }

    /**
     * Start *job* and clear the log of the group that owns it.
     *
     * Only the owning group is reset, so the other groups keep their log on screen
     * while this job runs.
     */
    _startGroupJob(job: FirmwareJobKind): void {
        const group = this._groupKeyForJob(job);
        this._evidenceLines[group] = [];
        this._lastAddonSummary = null;
        if (group === 'build') {
            this._buildLogLines = [];
        } else if (group === 'deploy') {
            this._deployLogLines = [];
        } else {
            this._inventoryLogLines = [];
            this._lastDeletedPath = null;
            this._lastImportNotice = null;
            this._lastImportWasBinary = false;
        }
        const previous = this._lastActionSnapshot.job;
        if (previous && this._groupKeyForJob(previous) === group) {
            this._lastActionSnapshot = { phase: 'idle', job: null, result: null, error: null };
        }
        this._jobState = startJobState(job);
    }

    /**
     * Fetch the host's serial ports for the deploy chooser.
     *
     * Called on attach and from the rescan button beside the chooser.
     * Concurrent calls share one request, so repeated clicks cannot stack
     * fetches. While a scan runs the status line says so, but the options on
     * screen stay untouched: a slow or failed rescan never empties a chooser the
     * user already picked from.
     */
    async _fetchPorts(): Promise<void> {
        if (this._portsRequest) {
            return this._portsRequest;
        }

        this._portStatus = 'loading';
        if (this._container) {
            this._renderDeployPortStatus();
        }

        this._portsRequest = this._loadPorts().finally(() => {
            this._portsRequest = null;
        });
        return this._portsRequest;
    }

    /**
     * Read `/api/serial-ports` and repopulate the deploy chooser.
     *
     * Called only by `_fetchPorts()`, which coalesces concurrent scans. A failed
     * read keeps the ports that are already known and reports `portsUnavailable`;
     * an empty answer clears them and reports `noPorts`.
     * @private
     */
    async _loadPorts(): Promise<void> {
        let status: 'ok' | 'empty' | 'error' = 'empty';
        try {
            const ports = await fetchSerialPorts();
            if (ports.length > 0) {
                this._ports = ports;
                status = 'ok';
            } else {
                this._ports = [];
            }
        } catch {
            status = 'error';
        }
        this._portStatus = status;
        if (this._container) {
            this._renderDeployPorts();
        }
    }

    /**
     * Populate the deploy port chooser and its status line.
     *
     * Options render the server-formatted ``display`` name via
     * {@link serialPortOptions}, so the chooser matches the Device Connection
     * view exactly. When nothing is selected yet the first port is selected, so
     * the trigger always names an available port rather than a placeholder.
     */
    _renderDeployPorts(): void {
        if (!this._deployPortStatusEl) {
            return;
        }
        const options = serialPortOptions(this._ports);
        this._portDropdown?.setOptions(options);
        if (this._portDropdown?.getSelectedValue() === null && options.length > 0) {
            this._portDropdown.setValue(options[0].value);
        }
        this._renderDeployPortStatus();
    }

    /**
     * Render the port status line from `_portStatus`.
     *
     * `_fetchPorts()` calls this on its own while a scan is in flight, so the
     * options already on screen are not replaced before the answer arrives.
     * @private
     */
    _renderDeployPortStatus(): void {
        const status = this._deployPortStatusEl;
        if (!status) {
            return;
        }
        status.replaceChildren();
        if (this._portStatus === 'loading') {
            status.textContent = this.t('firmwareBuild.deploy.portsLoading');
        } else if (this._portStatus === 'empty') {
            status.textContent = this.t('firmwareBuild.deploy.noPorts');
        } else if (this._portStatus === 'error') {
            status.textContent = this.t('firmwareBuild.deploy.portsUnavailable');
        } else if (this._deviceConnection.isConnected()) {
            status.textContent = this.t('firmwareBuild.deploy.portBusy');
        }
    }

    /**
     * Render one retained log buffer into its `CodeView`.
     *
     * `CodeView` renders plain text, so stderr lines carry a textual `[stderr]`
     * marker. The reducer in `firmware-job-state` already caps retained lines,
     * so the view renders verbatim without its own truncation.
     */
    _renderBuildLog(): void {
        this._renderLogInto(
            this._buildLogView,
            this._buildLogEl,
            this._buildGroupLogLines('build', this._buildLogLines)
        );
    }

    /** Render the Deploy log: deploy output plus the Deploy group's report. */
    _renderDeployLog(): void {
        this._renderLogInto(
            this._deployLogView,
            this._deployLogEl,
            this._buildGroupLogLines('deploy', this._deployLogLines)
        );
    }

    /** Render the Local firmware log: `list`/`delete` output plus its report. */
    _renderInventoryLog(): void {
        this._renderLogInto(
            this._inventoryLogView,
            this._inventoryLogEl,
            this._buildGroupLogLines('inventory', this._inventoryLogLines)
        );
    }

    /**
     * Compose one group's log: the job output, then the capability diagnostics
     * (Build only), then the client-side evidence lines, then the derived outcome
     * lines of the last job.
     *
     * Capability problems sit before the evidence and outcome lines because they
     * exist before any job can start: a missing toolchain is the reason a job could
     * not run, not something the job learned.
     */
    _buildGroupLogLines(
        group: FirmwareJobGroup,
        jobLines: FirmwareLogLine[]
    ): FirmwareLogLine[] {
        return [
            ...jobLines,
            ...(group === 'build' ? this._capabilityDiagnostics : []),
            ...this._evidenceLines[group],
            ...this._outcomeLines(group),
        ];
    }

    /**
     * Render *lines* into a log `CodeView`, toggling the host visibility.
     *
     * The log follows its own tail: output that arrives while the reader sits at
     * the end stays visible, and a reader who scrolled back keeps their place.
     * Without that, every streamed line would re-render the log and drop the view
     * back to its first line, which makes a running deploy look frozen.
     */
    _renderLogInto(
        view: CodeView | null,
        host: HTMLElement | null,
        lines: FirmwareLogLine[]
    ): void {
        this._setSectionVisible(host, lines.length > 0);
        if (!view) {
            return;
        }
        if (lines.length === 0) {
            view.setCode('');
            return;
        }
        const text = lines
            .map((line) => (line.stream === 'stderr' ? `[stderr] ${line.text}` : line.text))
            .join('');
        view.setCode(text, { follow: true });
    }

    /**
     * Lines that mirror the last outcome of *group* in its log.
     *
     * Derived from `_lastActionSnapshot` on every render instead of being appended
     * once, so re-rendering never duplicates a warning or an error. On success the
     * owning group's summary (artifact/deploy/image details) is appended as `info:`
     * lines so the log is the single place a job reports its outcome.
     */
    _outcomeLines(group: FirmwareJobGroup): FirmwareLogLine[] {
        const snapshot = this._lastActionSnapshot;
        if (!snapshot.job || this._groupKeyForJob(snapshot.job) !== group) {
            return [];
        }
        const lines: FirmwareLogLine[] = [];
        const add = (text: string, stream: FirmwareLogLine['stream'] = 'stderr') => {
            lines.push({ stream, text: `${text}\n` });
        };
        if (snapshot.error && snapshot.error.code !== 'job-busy') {
            const hint = snapshot.error.hint ? ` (${snapshot.error.hint})` : '';
            add(`error: ${this._errorLabel(snapshot.error)}${hint}`, 'stdout');
            return lines;
        }
        if (!snapshot.result) {
            if (snapshot.phase === 'disconnected') {
                add(`error: ${this.t('firmwareBuild.errors.disconnected')}`, 'stdout');
            }
            return lines;
        }
        const payload = snapshot.result.payload;
        for (const text of this._warningTexts(payload)) {
            add(`warning: ${text}`, 'stdout');
        }
        if (snapshot.result.status === 'failed') {
            for (const text of this._failureTexts(payload)) {
                add(`error: ${text}`, 'stdout');
            }
        } else if (snapshot.result.status === 'timeout') {
            add(`error: ${this.t('firmwareBuild.result.timeout')}`, 'stdout');
        } else if (snapshot.result.status === 'cancelled') {
            add(`info: ${this.t('firmwareBuild.result.cancelled')}`, 'stdout');
        } else if (snapshot.result.status === 'succeeded') {
            if (snapshot.job === 'compile') {
                this._appendBuildSummary(add, payload);
            } else if (snapshot.job === 'deploy') {
                this._appendDeploySummary(add, payload);
            } else if (snapshot.job === 'list' || snapshot.job === 'delete' || snapshot.job === 'import') {
                this._appendInventorySummary(add, payload);
            } else if (
                snapshot.job === 'addon-install' ||
                snapshot.job === 'addon-uninstall'
            ) {
                this._appendAddonSummary(add);
            }
        }
        return lines;
    }

    /**
     * Append the `info:` summary lines of a successful compile to the log.
     * @param add Function that appends one `FirmwareLogLine` to the group's lines.
     * @param payload Result payload of the succeeded compile job.
     */
    _appendBuildSummary(
        add: (text: string, stream?: FirmwareLogLine['stream']) => void,
        payload: Record<string, unknown> | null
    ): void {
        const paths = this._asRecord(payload?.paths);
        const metadata = this._asRecord(payload?.metadata);
        const runtime = this._asRecord(payload?.runtime);
        const artifact =
            typeof paths.firmwarePublishedArtifact === 'string'
                ? { path: paths.firmwarePublishedArtifact, published: true }
                : typeof paths.firmwareArtifact === 'string'
                    ? { path: paths.firmwareArtifact, published: false }
                    : null;
        if (artifact) {
            add(`info: ${this.t('firmwareBuild.build.artifact')}: ${artifact.path}`, 'stdout');
            if (!artifact.published) {
                add(`info: ${this.t('firmwareBuild.build.artifactUnpublished')}`, 'stdout');
            }
        }
        if (typeof metadata.firmwarePublishStatus === 'string') {
            add(
                `info: ${this.t('firmwareBuild.build.publishStatus')}: ${metadata.firmwarePublishStatus}`,
                'stdout'
            );
        }
        if (typeof runtime.version === 'string') {
            add(`info: ${this.t('firmwareBuild.build.runtimeVersion')}: ${runtime.version}`, 'stdout');
        }
        const packageVariants = this._asRecord(metadata.packageVariants);
        const frozenPackages = Object.entries(packageVariants).filter(
            ([, variant]) => typeof variant === 'string'
        );
        if (frozenPackages.length > 0) {
            add(
                `info: ${this.t('firmwareBuild.build.packages')}: ` +
                    frozenPackages.map(([id, variant]) => `${id}@${variant}`).join(', '),
                'stdout'
            );
        }
        if (typeof metadata.firmwareArtifactSizeBytes === 'number') {
            add(
                `info: ${this.t('firmwareBuild.build.artifactSize')}: ${formatBytes(metadata.firmwareArtifactSizeBytes)}`,
                'stdout'
            );
        }
    }

    /**
     * Append the `info:` summary lines of a successful deploy to the log.
     * @param add Function that appends one `FirmwareLogLine` to the group's lines.
     * @param payload Result payload of the succeeded deploy job.
     */
    _appendDeploySummary(
        add: (text: string, stream?: FirmwareLogLine['stream']) => void,
        payload: Record<string, unknown> | null
    ): void {
        const firmware = this._asRecord(payload?.firmware);
        const board = this._asRecord(payload?.board);
        if (typeof firmware.path === 'string') {
            add(`info: ${this.t('firmwareBuild.deploy.summaryImage')}: ${firmware.path}`, 'stdout');
        }
        if (typeof firmware.sizeBytes === 'number') {
            add(
                `info: ${this.t('firmwareBuild.deploy.summarySize')}: ${formatBytes(firmware.sizeBytes)}`,
                'stdout'
            );
        }
        if (typeof firmware.sha256 === 'string') {
            add(
                `info: ${this.t('firmwareBuild.deploy.summarySha256')}: ${firmware.sha256.slice(0, 12)}`,
                'stdout'
            );
        }
        if (typeof payload?.port === 'string') {
            add(`info: ${this.t('firmwareBuild.deploy.summaryPort')}: ${payload.port}`, 'stdout');
        }
        if (typeof board.id === 'string') {
            add(`info: ${this.t('firmwareBuild.deploy.summaryBoard')}: ${board.id}`, 'stdout');
        }
        if (typeof board.chip === 'string') {
            add(`info: ${this.t('firmwareBuild.deploy.summaryChip')}: ${board.chip}`, 'stdout');
        }
    }

    /**
     * Append the `info:` summary lines of a successful list/delete to the log.
     * @param add Function that appends one `FirmwareLogLine` to the group's lines.
     * @param payload Result payload of the succeeded inventory job.
     */
    _appendInventorySummary(
        add: (text: string, stream?: FirmwareLogLine['stream']) => void,
        payload: Record<string, unknown> | null
    ): void {
        if (this._lastDeletedPath) {
            add(
                `info: ${this.t('firmwareBuild.inventory.delete')}: ${this._lastDeletedPath}`,
                'stdout'
            );
        }
        if (this._lastImportNotice) {
            add(`info: ${this._lastImportNotice}`, 'stdout');
        }
        if (this._lastImportWasBinary) {
            add(`info: ${this.t('firmwareBuild.inventory.importedHint')}`, 'stdout');
        }
        const entries = Array.isArray(payload?.entries) ? payload.entries.length : 0;
        add(
            `info: ${this.t('firmwareBuild.inventory.title')}: ${this.t('firmwareBuild.inventory.count', { count: entries })}`,
            'stdout'
        );
    }

    /**
     * Append the `info:` summary lines of a successful add-on mutation to the log.
     *
     * The lines were built when the result arrived (`_handleAddonResult`), so a
     * re-render can never duplicate them.
     * @param add Function that appends one `FirmwareLogLine` to the group's lines.
     */
    _appendAddonSummary(
        add: (text: string, stream?: FirmwareLogLine['stream']) => void
    ): void {
        for (const line of this._lastAddonSummary ?? []) {
            add(`info: ${line}`, 'stdout');
        }
    }

    /** Translate the `error` frame of *error* into one line of text. */
    _errorLabel(error: FirmwareJobError): string {
        const described = describeFirmwareError(error);
        return described ? this.t(described.key) : error.message;
    }

    /**
     * Expand the pane that owns *job*'s controls and open its log sub-section.
     *
     * A failure is reported in the log, so the pane and the log are revealed; no
     * other pane is touched.
     */
    _expandLogForFailure(job: FirmwareJobState['job']): void {
        if (!job) {
            return;
        }
        const group = this._groupKeyForJob(job);
        if (group === 'build') {
            this._buildFirmwareCollapsible?.expand();
        } else if (group === 'deploy') {
            this._deployCollapsible?.expand();
        } else {
            this._inventoryCollapsible?.expand();
        }
        this._logSubCollapsibles[group]?.expand();
        const logEl =
            group === 'build'
                ? this._buildLogEl
                : group === 'deploy'
                    ? this._deployLogEl
                    : this._inventoryLogEl;
        if (logEl && typeof logEl.scrollIntoView === 'function') {
            logEl.scrollIntoView();
        }
    }


    /** Normalize `payload.warnings` into plain strings. */
    _warningTexts(payload: Record<string, unknown> | null): string[] {
        const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
        return warnings.map((warning) =>
            typeof warning === 'string' ? warning : JSON.stringify(warning)
        );
    }

    /** Normalize `payload.errors[]` into `code` label plus hint. */
    _failureTexts(payload: Record<string, unknown> | null): string[] {
        const errors = Array.isArray(payload?.errors) ? payload.errors : [];
        return errors.map((entry) => {
            const record = this._asRecord(entry);
            const code = typeof record.code === 'string' ? record.code : null;
            const message = typeof record.message === 'string' ? record.message : '';
            const hint = typeof record.hint === 'string' ? record.hint : null;
            const label = code
                ? this.t(`firmwareBuild.errors.${code}`)
                : message || this.t('firmwareBuild.result.failed');
            return hint ? `${label} (${hint})` : label;
        });
    }


    /**
     * Return a plain-object view of an unknown value, or an empty object.
     */
    _asRecord(value: unknown): Record<string, unknown> {
        return !!value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
    }

    _buildShell(container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = 'firmware-build-view';

        this._contentEl = this._buildContentHost();

        root.appendChild(this._contentEl);
        root.appendChild(this._buildOfflineSection());

        container.appendChild(root);
    }

    /**
     * Build the content host: a `split-host` wrapper holding one vertical
     * `SplitView` pane per section. Panes scroll internally, so the tab itself
     * never grows a scrollbar.
     */
    _buildContentHost(): HTMLElement {
        const content = document.createElement('div');
        content.className = 'firmware-build-view__content';

        this._splitHostEl = document.createElement('div');
        this._splitHostEl.className = 'firmware-build-view__split-host';
        content.appendChild(this._splitHostEl);

        this._splitView = new SplitView({
            orientation: 'vertical',
            gap: 4,
            minPaneSize: 32,
            views: this._buildSections(),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._splitView.attachTo(this._splitHostEl);

        return content;
    }

    /**
     * Build the five section collapsibles in reading order and return them for the
     * `SplitView`. Help starts collapsed: it is reference text.
     *
     * There is deliberately no cross-cutting Result pane: every job reports its
     * outcome in the log of the group that owns its controls, so no pane shows a
     * result for a button it does not contain.
     */
    _buildSections(): CollapsibleView[] {
        this._helpCollapsible = this._createSection(
            'firmwareBuild.help.title',
            true,
            () => this._buildHelpSection()
        );

        this._targetsCollapsible = this._createSection(
            'firmwareBuild.target.label',
            false,
            () => this._buildTargetsSection()
        );

        this._inventoryCollapsible = this._createSection(
            'firmwareBuild.inventory.title',
            false,
            () => this._buildInventorySection()
        );

        this._deployCollapsible = this._createSection(
            'firmwareBuild.deploy.title',
            false,
            () => this._buildDeploySection()
        );

        this._buildFirmwareCollapsible = this._createSection(
            'firmwareBuild.packages.title',
            false,
            () => this._buildBuildFirmwareSection()
        );

        return [
            this._helpCollapsible,
            this._targetsCollapsible,
            this._inventoryCollapsible,
            this._deployCollapsible,
            this._buildFirmwareCollapsible,
        ];
    }

    /**
     * Create one collapsible section whose content is a `ContentView` built by
     * `renderFn`.
     *
     * The section opts into `sizeToContent`, the same mode the Settings tab's
     * `General`/`Collection`/`Graph` panels use: the pane is capped at its
     * rendered content height, so a short section no longer claims an equal share
     * of the split and the leftover space stays unused. A section whose content
     * outgrows the available space stays capped and scrolls inside its
     * `ContentView`.
     */
    _createSection(
        titleKey: string,
        collapsed: boolean,
        renderFn: () => HTMLElement
    ): CollapsibleView {
        const contentView = new ContentView({
            renderFn,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        return new CollapsibleView({
            headerTitle: this.t(titleKey),
            collapsed,
            contentView,
            sizeToContent: true,
            i18nService: this._i18nService,
            logger: this._logger,
        });
    }

    /** Toggle a section host's `hidden` attribute. */
    _setSectionVisible(host: HTMLElement | null, visible: boolean): void {
        if (!host) {
            return;
        }
        host.hidden = !visible;
    }

    /**
     * Build the Help pane: what the tab does and the no-reinstall guarantee. The
     * text is Markdown reference material, so the pane starts collapsed.
     */
    _buildHelpSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'firmware-build-view__help';

        const body = document.createElement('div');
        body.className = 'firmware-build-view__help-body';
        section.appendChild(body);

        this._helpMarkdownView = new MarkdownView({
            markdown: '',
            title: 'Help',
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._helpMarkdownView.attachTo(body);
        this._renderHelpText();

        return section;
    }

    /**
     * Locale key of the offline explainer body.
     *
     * The hosted bundle has no server to diagnose, so it explains a different situation in the
     * same explainer: the local-server features are missing on purpose and where to get them. This
     * method is the only place that choice is made.
     * @private
     */
    _offlineBodyKey(): string {
        return isHostedBuild() ? 'firmwareBuild.hosted.body' : 'firmwareBuild.offline.body';
    }

    /**
     * Markdown for the offline explainer: the locale body plus, in a hosted bundle that was built
     * with a docs URL, one line linking the desktop install.
     *
     * No URL is invented here: without `--docs-url` the body ends after the explanation (decision:
     * the build never names a host).
     * @private
     */
    _offlineBodyMarkdown(): string {
        const body = this.t(this._offlineBodyKey());
        if (!isHostedBuild()) {
            return body;
        }
        const docsUrl = getHostedDocsUrl();
        if (!docsUrl) {
            return body;
        }
        return `${body}\n\n${this.t('firmwareBuild.hosted.installLink', { url: docsUrl })}`;
    }

    /**
     * Refresh every locale-dependent text outside the panes: the Help pane, the
     * offline section's header title, its explainer and its diagnostic rows.
     *
     * The offline section is only reachable while the server is not ready, so a
     * language switch must reach it too; nothing here probes the capability store.
     */
    _renderHelpText(): void {
        this._helpMarkdownView?.setMarkdown(this.t('firmwareBuild.help.body'));
        this._deployPortNoteView?.setMarkdown(this.t('firmwareBuild.deploy.portFreeNote'));
        if (this._offlineCollapsible) {
            this._offlineCollapsible.headerTitle = this.t('firmwareBuild.help.title');
        }
        this._offlineMarkdownView?.setMarkdown(this._offlineBodyMarkdown());
        this._renderOfflineDiagnostics();
    }

    /**
     * Build the offline host: one Help section shown instead of the panes when the
     * capability snapshot is not `ready`.
     *
     * It is built folded and hidden; entering the offline mode expands it, so the recovery
     * text is what a user sees first when the server is gone. It sits outside the `SplitView`
     * on purpose, so an offline tab renders no panes at all, and it is built directly from
     * `ContentView`/`CollapsibleView` — the same two classes `_createSection()` uses —
     * because those helpers produce split panes.
     */
    _buildOfflineSection(): HTMLElement {
        const section = document.createElement('section');
        section.className = 'firmware-build-view__offline';
        section.hidden = true;

        const contentView = new ContentView({
            renderFn: () => this._buildOfflineBody(),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._offlineCollapsible = new CollapsibleView({
            headerTitle: this.t('firmwareBuild.help.title'),
            collapsed: true,
            contentView,
            sizeToContent: true,
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._offlineCollapsible.attachTo(section);
        this._offlineSectionEl = section;
        return section;
    }

    /**
     * Build the offline section's body: the explainer Markdown plus the capability
     * diagnostic rows.
     *
     * The Markdown view gets its own host because it mounts with `replaceChildren`
     * on attach: sharing the body would wipe the diagnostic rows on every locale
     * change. Rows are created with `document.createElement` and `textContent`;
     * nothing server-supplied is ever spliced into `innerHTML`.
     */
    _buildOfflineBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'firmware-build-view__offline-body';

        // The Markdown view mounts with `replaceChildren` on attach, so it needs a
        // host of its own: sharing the body would wipe the diagnostic rows on every
        // locale change. The host carries no class because it styles nothing.
        const markdownHost = document.createElement('div');
        body.appendChild(markdownHost);

        this._offlineMarkdownView = new MarkdownView({
            markdown: this._offlineBodyMarkdown(),
            title: this.t('firmwareBuild.help.title'),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._offlineMarkdownView.attachTo(markdownHost);

        this._offlineDiagnosticsEl = document.createElement('div');
        this._offlineDiagnosticsEl.className = 'firmware-build-view__diagnostics';
        body.appendChild(this._offlineDiagnosticsEl);

        this._renderOfflineDiagnostics();
        return body;
    }

    /**
     * Render the diagnostic rows under the offline explainer from the retained
     * capability diagnostics, hiding the list when there is nothing to report
     * (which is the normal case: an unreachable server reports no backends).
     *
     * A hosted bundle renders no rows at all: there is no backend to diagnose, and the hosted
     * body carries the whole explanation.
     */
    _renderOfflineDiagnostics(): void {
        const host = this._offlineDiagnosticsEl;
        if (!host) {
            return;
        }
        host.replaceChildren();
        if (isHostedBuild()) {
            host.hidden = true;
            return;
        }
        for (const text of this._diagnosticTexts) {
            const row = document.createElement('div');
            row.className = 'firmware-build-view__diagnostic';
            row.textContent = text;
            host.appendChild(row);
        }
        host.hidden = this._diagnosticTexts.length === 0;
    }

    /**
     * Toggle the panes vs. the offline Help section.
     *
     * Entering the offline mode always expands the Help section: its body explains why the
     * tab is empty and how to start the server, which is exactly what a user needs at that
     * moment. Re-entering the mode on an unrelated re-render does not touch a section the
     * user just folded away, so a deliberate collapse survives.
     */
    _setOfflineMode(offline: boolean): void {
        if (this._contentEl) {
            this._contentEl.hidden = offline;
        }
        if (this._offlineSectionEl) {
            this._offlineSectionEl.hidden = !offline;
        }
        const entering = offline && !this._offlineMode;
        this._offlineMode = offline;
        if (offline) {
            this._offlineMarkdownView?.setMarkdown(this._offlineBodyMarkdown());
            if (entering) {
                this._offlineCollapsible?.expand();
            }
        }
        this._renderOfflineDiagnostics();
    }

    /** Run at every exit of `_renderState`, so a startup probe never flashes it. */
    _renderOfflineExplainer(): void {
        if (this._probing) {
            this._setOfflineMode(false);
            return;
        }
        const snapshot = this._firmwareCapabilities.getSnapshot();
        this._setOfflineMode(!snapshot || snapshot.state !== 'ready');
    }

    /**
     * Build the first row of the Build Firmware pane: a `ToolbarView` holding the
     * icon-only Build control followed by the clean-build checkbox, attached to
     * *host*. The button carries its label as tooltip and accessible name and uses
     * `style: 'secondary'`, the same variant as every other firmware toolbar button.
     */
    _buildBuildToolbar(host: HTMLElement): void {
        const toolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._buildButton = new ButtonControl({
            label: this.t('firmwareBuild.build.start'),
            style: 'secondary',
            icon: IconProvider.deployedCode,
            iconOnly: true,
        });
        this._buildButton.onClick(() => {
            void this._onBuildAction();
        });
        this._registerControl(this._buildButton, (_snapshot) => this._hasFeature('firmware-compile'));
        toolbar.addControl(this._buildButton, { className: 'firmware-build-view__action' });

        this._cleanBuildControl = new CheckboxControl({
            label: this.t('firmwareBuild.build.cleanBuild'),
            defaultValue: false,
        });
        this._registerControl(this._cleanBuildControl);
        toolbar.addControl(this._cleanBuildControl, { className: 'firmware-build-view__action' });

        toolbar.attachTo(host);
        this._buildToolbar = toolbar;
    }

    /**
     * Build the first row of the Deploy pane: a `ToolbarView` holding the
     * icon-only Deploy control followed by the wipe checkbox, whose host carries
     * the wipe hint as its `title`. Attached to *host*. The button uses
     * `style: 'secondary'`, the same variant as every other firmware toolbar button.
     */
    _buildDeployToolbar(host: HTMLElement): void {
        const toolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._deployButton = new ButtonControl({
            label: this.t('firmwareBuild.deploy.start'),
            style: 'secondary',
            icon: IconProvider.trayArrowUp,
            iconOnly: true,
        });
        this._deployButton.onClick(() => {
            void this._onDeployAction();
        });
        this._registerControl(this._deployButton, (_snapshot) => this._hasFeature('firmware-deploy'));
        toolbar.addControl(this._deployButton, { className: 'firmware-build-view__action' });

        this._wipeControl = new CheckboxControl({
            label: this.t('firmwareBuild.deploy.wipe'),
            defaultValue: false,
        });
        this._registerControl(this._wipeControl);
        const wipeHost = toolbar.addControl(this._wipeControl, {
            className: 'firmware-build-view__wipe',
        });
        wipeHost.title = this.t('firmwareBuild.deploy.wipeHint');

        toolbar.attachTo(host);
        this._deployToolbar = toolbar;
    }

    /**
     * Build the Deploy pane's port row: the connected-port chooser with the
     * rescan button to its right, in one `ToolbarView` row attached to *host*.
     *
     * *host* must be the row's own host element: `ToolbarView` replaces its
     * host's children, so attaching this row to the pane itself would drop the
     * Deploy toolbar above it.
     *
     * The chooser carries a `Device` title label and lists only the ports the
     * host reports, auto-selecting the first one; the rescan button re-reads
     * `/api/serial-ports`, so a board plugged in after the tab opened appears
     * without reopening it. Both controls follow the neighbouring firmware
     * toolbars: icon-only `ButtonControl` in `style: 'secondary'`, each in a
     * `.firmware-build-view__action` wrapper.
     */
    _buildDeployPortRow(host: HTMLElement): void {
        const toolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._portDropdown = new DropdownControl({
            label: this.t('firmwareBuild.deploy.device'),
            buttonClassName: 'firmware-build-view__dropdown--port',
            menuClassName: 'firmware-build-view__dropdown-menu--port',
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._registerControl(this._portDropdown);
        toolbar.addControl(this._portDropdown, { className: 'firmware-build-view__action' });

        const rescanButton = new ButtonControl({
            label: this.t('firmwareBuild.deploy.refreshPorts'),
            style: 'secondary',
            icon: IconProvider.refresh,
            iconOnly: true,
        });
        rescanButton.onClick(() => {
            void this._fetchPorts();
        });
        this._registerControl(rescanButton);
        toolbar.addControl(rescanButton, { className: 'firmware-build-view__action' });

        toolbar.attachTo(host);
    }

    /** Build the Target section root: the target chooser and its info table. */
    _buildTargetsSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'firmware-build-view__targets';
        this._targetsEl = section;

        this._targetDropdown = new DropdownControl({
            placeholder: this.t('firmwareBuild.target.label'),
            buttonClassName: 'firmware-build-view__dropdown--target',
            menuClassName: 'firmware-build-view__dropdown-menu--target',
            onChange: (value) => {
                this._selectedTargetId = typeof value === 'string' ? value : null;
                this._targetPinnedByUser = true;
                this._selectedFirmwarePath = null;
                this._inventoryPanel?.clearSelection();
                this._renderInfoRow();
                this._renderPackagesSection();
                this._renderBuildSection();
                this._renderDeploySection();
            },
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._registerControl(this._targetDropdown);
        this._targetDropdown.attachTo(section);

        this._infoRowEl = document.createElement('div');
        this._infoRowEl.className = 'firmware-build-view__info';
        section.appendChild(this._infoRowEl);

        this._infoTable = new DataTableView({
            columns: [{ label: '' }, { label: '' }],
            dense: true,
            header: false,
            title: 'Target info',
            logger: this._logger,
        });
        this._infoTable.attachTo(this._infoRowEl);

        return section;
    }

    /**
     * Create one nested sub-section inside a group pane.
     *
     * The host is a plain `div` carrying the shared sub-section class plus
     * *hostClass*; the content is a `ContentView` built by *renderFn*. The
     * collapsible renders the shared nested variant (`CollapsibleView` with
     * `nested: true`: one surface step lighter header, lighter title weight,
     * 24 px header, sized to its content) rather than a firmware-specific class.
     *
     * @param titleKey Locale key of the sub-section header.
     * @param collapsed Whether the sub-section starts collapsed.
     * @param hostClass Group-specific host class, kept alongside `__sub`.
     * @param renderFn Builds the sub-section content on attach.
     */
    _createSubSection(
        titleKey: string,
        collapsed: boolean,
        hostClass: string,
        renderFn: () => HTMLElement
    ): { host: HTMLElement; collapsible: CollapsibleView } {
        const host = document.createElement('div');
        host.className = `firmware-build-view__sub ${hostClass}`;

        const contentView = new ContentView({
            renderFn,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        const collapsible = new CollapsibleView({
            headerTitle: this.t(titleKey),
            collapsed,
            contentView,
            headerHeight: 24,
            sizeToContent: true,
            nested: true,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        collapsible.attachTo(host);
        return { host, collapsible };
    }

    /**
     * Build the Build Firmware pane: a toolbar row (Build button, clean-build
     * checkbox), the existing-firmware line, the build progress readout, and
     * four nested sub-sections (Packages, Installed add-ons, Build log, Build
     * Result).
     */
    _buildBuildFirmwareSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'firmware-build-view__build-firmware';
        this._buildBuildToolbar(section);

        this._buildMatchEl = document.createElement('div');
        this._buildMatchEl.className = 'firmware-build-view__build-match';
        this._buildMatchEl.hidden = true;
        section.appendChild(this._buildMatchEl);

        const buildProgressHost = document.createElement('div');
        buildProgressHost.className = 'firmware-build-view__build-progress';
        section.appendChild(buildProgressHost);

        this._buildProgressView = new ProgressBarView({
            title: 'Build progress',
            cancelable: true,
            cancelLabel: this.t('firmwareBuild.progress.cancel'),
            elapsedFormatter: (seconds) => this.t('firmwareBuild.progress.elapsed', { seconds }),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._buildProgressView.onCancel(() => this._requestCancel());
        this._buildProgressView.attachTo(buildProgressHost);

        if (!this._packagesPanel) {
            throw new Error('FirmwarePackagesPanel is not initialised');
        }

        const packages = this._createSubSection(
            'firmwareBuild.buildFirmware.packages',
            false,
            'firmware-build-view__build-firmware-sub',
            () => this._packagesPanel!.buildPackagesSection()
        );
        section.appendChild(packages.host);
        this._packagesSubCollapsible = packages.collapsible;

        const addons = this._createSubSection(
            'firmwareBuild.buildFirmware.addons',
            false,
            'firmware-build-view__addons-sub',
            () => this._packagesPanel!.buildAddonsSection()
        );
        section.appendChild(addons.host);
        this._addonsSubCollapsible = addons.collapsible;
        this._addonsSubHostEl = addons.host;

        const buildLog = this._createSubSection(
            'firmwareBuild.buildFirmware.buildLog',
            true,
            'firmware-build-view__build-log-sub',
            () => {
                const logEl = document.createElement('div');
                logEl.className = 'firmware-build-view__build-log';
                logEl.hidden = true;
                this._buildLogEl = logEl;
                this._buildLogView = new CodeView({
                    code: '',
                    language: 'text',
                    showLineNumbers: false,
                    scrollable: true,
                    title: 'Build log',
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._buildLogView.attachTo(logEl);
                return logEl;
            }
        );
        section.appendChild(buildLog.host);
        this._logSubCollapsibles.build = buildLog.collapsible;

        return section;
    }

    /**
     * Build the Deploy pane: a toolbar row (Deploy button, wipe checkbox), the
     * port row, selected-firmware identity, composition banner, progress, and the
     * two owned sub-sections (Deploy log, Deploy Result).
     */
    _buildDeploySection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'firmware-build-view__deploy';
        this._deployEl = section;
        this._buildDeployToolbar(section);

        // The port rule is read before the chooser: Deploy releases the app's
        // connection, and reconnecting afterwards is one click on the title-bar
        // badge. Rendered by `MarkdownView`, the sanctioned explainer renderer.
        this._deployPortNoteView?.detach();
        const portNoteHost = document.createElement('div');
        portNoteHost.className = 'firmware-build-view__deploy-port-note';
        section.appendChild(portNoteHost);
        this._deployPortNoteView = new MarkdownView({
            markdown: this.t('firmwareBuild.deploy.portFreeNote'),
            scrollable: false,
            title: this.t('firmwareBuild.deploy.title'),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._deployPortNoteView.attachTo(portNoteHost);

        // A `ToolbarView` replaces its host's children, so the port row gets its
        // own host exactly like the Packages and Installed add-ons toolbars.
        const portRowHost = document.createElement('div');
        portRowHost.className = 'firmware-build-view__deploy-port-toolbar';
        section.appendChild(portRowHost);
        this._buildDeployPortRow(portRowHost);

        this._deployPortStatusEl = document.createElement('div');
        this._deployPortStatusEl.className = 'firmware-build-view__deploy-port-status';
        section.appendChild(this._deployPortStatusEl);

        this._deployFirmwareHostEl = document.createElement('div');
        this._deployFirmwareHostEl.className = 'firmware-build-view__deploy-firmware';
        this._deployFirmwareHostEl.hidden = true;
        section.appendChild(this._deployFirmwareHostEl);

        this._deployFirmwareTable = new DataTableView({
            columns: [{ label: '' }, { label: '' }],
            dense: true,
            header: false,
            title: 'Selected firmware',
            logger: this._logger,
        });
        this._deployFirmwareTable.attachTo(this._deployFirmwareHostEl);

        this._deployFirmwareStatusEl = document.createElement('div');
        this._deployFirmwareStatusEl.className = 'firmware-build-view__deploy-firmware-status';
        section.appendChild(this._deployFirmwareStatusEl);

        this._compositionBannerEl = document.createElement('div');
        this._compositionBannerEl.className = 'firmware-build-view__composition-banner';
        this._compositionBannerEl.hidden = true;
        section.appendChild(this._compositionBannerEl);

        const deployProgressHost = document.createElement('div');
        deployProgressHost.className = 'firmware-build-view__deploy-progress';
        section.appendChild(deployProgressHost);

        this._deployProgressView = new ProgressBarView({
            title: 'Deploy progress',
            cancelable: false,
            elapsedFormatter: (seconds) => this.t('firmwareBuild.progress.elapsed', { seconds }),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._deployProgressView.attachTo(deployProgressHost);

        const deployLog = this._createSubSection(
            'firmwareBuild.deploy.log',
            true,
            'firmware-build-view__deploy-log-sub',
            () => {
                const logEl = document.createElement('div');
                logEl.className = 'firmware-build-view__deploy-log';
                logEl.hidden = true;
                this._deployLogEl = logEl;
                this._deployLogView = new CodeView({
                    code: '',
                    language: 'text',
                    showLineNumbers: false,
                    scrollable: true,
                    title: this.t('firmwareBuild.deploy.log'),
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._deployLogView.attachTo(logEl);
                return logEl;
            }
        );
        section.appendChild(deployLog.host);
        this._logSubCollapsibles.deploy = deployLog.collapsible;

        return section;
    }

    /**
     * Build the Local firmware pane: the inventory panel's section, then the two
     * owned sub-sections (Local firmware log, Local firmware Result).
     *
     * The panel keeps owning the table and its `refreshFailed` empty state; the
     * log and result add the job detail the table cannot show: the `list`/`delete`
     * output stream, warnings, and the failure rows of the last inventory job.
     */
    _buildInventorySection(): HTMLElement {
        if (!this._inventoryPanel) {
            throw new Error('FirmwareInventoryPanel is not initialised');
        }
        const section = document.createElement('div');
        section.className = 'firmware-build-view__inventory-group';
        section.appendChild(this._inventoryPanel.buildInventorySection());

        const inventoryLog = this._createSubSection(
            'firmwareBuild.inventory.log',
            true,
            'firmware-build-view__inventory-log',
            () => {
                const logEl = document.createElement('div');
                logEl.className = 'firmware-build-view__inventory-log-lines';
                logEl.hidden = true;
                this._inventoryLogEl = logEl;
                this._inventoryLogView = new CodeView({
                    code: '',
                    language: 'text',
                    showLineNumbers: false,
                    scrollable: true,
                    title: this.t('firmwareBuild.inventory.log'),
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._inventoryLogView.attachTo(logEl);
                return logEl;
            }
        );
        section.appendChild(inventoryLog.host);
        this._logSubCollapsibles.inventory = inventoryLog.collapsible;

        return section;
    }

    /**
     * Rebuild a `FirmwareBuildView` from serialized data.
     *
     * The three runtime services are required and named in the thrown error when
     * missing, so a saved layout restore fails loudly instead of rehydrating an
     * empty tab. `firmwareCapabilities` stays optional: the constructor creates a
     * fresh `ServerCapabilitiesStore` when none is supplied.
     *
     * @param data Serialized view data (`type` is implicit for this class).
     * @param _viewFactory Unused child factory kept for the `ViewFactory` contract.
     * @param context Services injected by `ViewManager.updateViewContext()`.
     */
    static deserialize(
        data: { title?: string; icon?: string | null; id?: string | null } = {},
        _viewFactory: unknown = null,
        context: {
            i18nService?: ViewBaseOptions['i18nService'];
            logger?: ViewBaseOptions['logger'];
            firmwareCapabilities?: ServerCapabilitiesStore;
            deviceConnection?: FirmwareDeviceConnectionLike;
            runtimeCollection?: FirmwareRuntimeCollectionLike;
            collectionManager?: FirmwareCollectionManagerLike;
            viewManager?: FirmwareViewManagerLike;
        } = {}
    ): FirmwareBuildView {
        void _viewFactory;

        const { title = 'Firmware', icon = IconProvider.memory, id = null } = data;
        const {
            i18nService = null,
            logger = null,
            firmwareCapabilities,
            deviceConnection,
            runtimeCollection,
            collectionManager,
            viewManager,
        } = context;

        if (!runtimeCollection) {
            throw new Error('FirmwareBuildView.deserialize requires a runtimeCollection service');
        }
        if (!collectionManager) {
            throw new Error('FirmwareBuildView.deserialize requires a collectionManager service');
        }
        if (!deviceConnection) {
            throw new Error('FirmwareBuildView.deserialize requires a deviceConnection service');
        }
        if (!viewManager) {
            throw new Error('FirmwareBuildView.deserialize requires a viewManager service');
        }

        return new FirmwareBuildView({
            title,
            icon,
            id,
            i18nService,
            logger,
            firmwareCapabilities,
            deviceConnection,
            runtimeCollection,
            collectionManager,
            viewManager,
        });
    }
}

