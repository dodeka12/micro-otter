// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import { ActivityPulse } from './activity-pulse.js';
import { MenuView } from './menu-view.js';
import { MenuWindow } from './menu-window.js';
import { FormDialogView } from './form-dialog-view.js';
import { ConfirmationDialogView } from './confirmation-dialog-view.js';
import { ErrorDialogView } from './error-dialog-view.js';
import { LanguagePickerView } from './language-picker-view.js';
import { AboutDialogView } from './about-dialog-view.js';
import { DBRestoreDialogView } from './db-restore-dialog-view.js';
import { IconProvider } from './icon-provider.js';
import { Collection } from '../data/collection.js';
import { assertAppEventPayloadType } from '../core/app-event.js';
import {
    ProgressEventBus,
    ProgressEventType,
    type ProgressEvent,
} from '../core/progress-events.js';
import type { Workspace } from '../core/workspace.js';
import type { ViewManager } from './view-manager.js';
import type { I18nService } from '../i18n/i18n-service.js';
import type {
    ServerConnectionLike,
    ServerConnectionSnapshot,
} from '../firmware/server-connection.js';
import type { DeviceConnectionSnapshot } from '../serial/device-connection-monitor.js';
import {
    DeviceConnectionDialogView,
    type DeviceConnectionDialogConnectionLike,
} from './device-connection-dialog-view.js';

type LoggerFunction = (reason: string, level?: unknown, ...data: unknown[]) => void;
type Unsubscribe = (() => void) | null;
type DeviceStateListener = (() => void) | null;
type HistoryChangeListener = (() => void) | null;
type KeyboardShortcutHandler = ((event: KeyboardEvent) => void) | null;

/**
 * Structural contract of the device connection monitor the title bar consumes.
 *
 * It is the connection the dialog drives (`DeviceConnectionDialogConnectionLike`)
 * plus the read-only subscription the badge needs, so `WorkspaceView` takes a
 * plain fake in tests and `main.ts` passes the one `DeviceConnectionMonitor`.
 */
interface DeviceConnectionMonitorLike extends DeviceConnectionDialogConnectionLike {
    /** Subscribe to snapshot changes; returns an unsubscribe function. */
    subscribe(listener: (snapshot: DeviceConnectionSnapshot) => void): () => void;
}

/** Label key per device badge state; `loading` is rendered from its template. */
const DEVICE_BADGE_LABEL_KEYS: Record<DeviceConnectionSnapshot['state'], string> = {
    disconnected: 'workspace.device.connect',
    connecting: 'workspace.device.connecting',
    loading: 'workspace.device.loading',
    connected: 'workspace.device.connected',
    disconnecting: 'workspace.device.disconnecting',
    error: 'workspace.device.error',
};

/** Tooltip key per device badge state. */
const DEVICE_BADGE_TITLE_KEYS: Record<DeviceConnectionSnapshot['state'], string> = {
    disconnected: 'workspace.device.connectTitle',
    connecting: 'workspace.device.connectingTitle',
    loading: 'workspace.device.loadingTitle',
    connected: 'workspace.device.connectedTitle',
    disconnecting: 'workspace.device.disconnectingTitle',
    error: 'workspace.device.errorTitle',
};

/**
 * Reason the title bar pulses while a device connection attempt is in flight.
 *
 * Kept as a constant so any other surface can release or observe the same reason
 * without re-typing the string.
 */
const DEVICE_CONNECTION_PULSE_REASON = 'device-connection';

interface LocaleInfo {
    code: string;
    icon?: string;
}

interface LanguageSwitcherButton extends HTMLButtonElement {
    _flagImg?: HTMLImageElement;
}

interface WorkspaceViewOptions {
    workspace: Workspace;
    viewManager?: ViewManager | null;
    title?: string;
    appVersion?: string;
    icon?: string | null;
    id?: string | null;
    logger?: LoggerFunction | null;
    i18nService?: I18nService | null;
    serverConnection?: ServerConnectionLike | null;
    deviceConnection?: DeviceConnectionMonitorLike | null;
}

interface WorkspaceViewSerialized {
    title?: string;
    icon?: string | null;
    id?: string | null;
}

interface WorkspaceViewDeserializeContext {
    workspace?: Workspace | null;
    viewManager?: ViewManager | null;
    i18nService?: I18nService | null;
    logger?: LoggerFunction | null;
}

interface LanguagePickerSelectPayload {
    locale: { code: string };
}

interface ModalConfirmPayload {
    reason: string;
    id: string;
    mode?: string;
    results?: unknown;
    formData?: Record<string, unknown>;
}

interface CreateCollectionFormData {
    name: string;
    runtime: string;
    target: string;
}

interface MenuItemSelection {
    id?: string;
}

/**
 * WorkspaceView provides a single-row control panel for workspace management.
 * Includes dropdowns for collection and target selection.
 */
export class WorkspaceView extends ViewBase {
    declare protected _i18nService: I18nService | null;

    workspace: Workspace;

    _appVersion: string;

    _viewManager: ViewManager | null;

    _collectionDropdown: HTMLSelectElement | null;

    _collectionDropdownContainer: HTMLDivElement | null;

    _collectionProgressBackdrop: HTMLDivElement | null;

    _collectionProgressFill: HTMLDivElement | null;

    _collectionProgressText: HTMLDivElement | null;

    _collectionDeployProgressActive: boolean;

    _collectionProgressHideTimeout: number | null;

    _progressListener: ((event: ProgressEvent) => void) | null;

    _versionDisplay: HTMLSpanElement | null;

    _runtimeTargetDisplay: HTMLSpanElement | null;

    _runtimeLabelDisplay: HTMLSpanElement | null;

    _targetSelect: HTMLSelectElement | null;

    _hamburgerButton: HTMLButtonElement | null;

    _languageSwitcher: LanguageSwitcherButton | null;

    _deployCollectionButton: HTMLButtonElement | null;

    _deployInFlight: boolean;

    _unsubscribeWorkspace: Unsubscribe;

    _deviceStateListener: DeviceStateListener;

    _undoButton: HTMLButtonElement | null;

    _redoButton: HTMLButtonElement | null;

    _historyChangeListener: HistoryChangeListener;

    _keyboardShortcutHandler: KeyboardShortcutHandler;

    _serverConnection: ServerConnectionLike | null;

    _serverBadgeButton: HTMLButtonElement | null;

    _serverBadgeLabelEl: HTMLSpanElement | null;

    _unsubscribeServerConnection: Unsubscribe;

    _serverReconnectInFlight: boolean;

    _deviceConnection: DeviceConnectionMonitorLike | null;

    _deviceBadgeButton: HTMLButtonElement | null;

    _deviceBadgeLabelEl: HTMLSpanElement | null;

    _deviceBadgePercentEl: HTMLSpanElement | null;

    _deviceBadgeRingEl: SVGSVGElement | null;

    _deviceBadgeRingValueEl: SVGCircleElement | null;

    _unsubscribeDeviceConnection: Unsubscribe;

    _runtimePlayButton: HTMLButtonElement | null;

    _runtimeStopButton: HTMLButtonElement | null;

    _executionStateListener: ((event: Event) => void) | null;

    _titleBarEl: HTMLElement | null;

    _activityPulse: ActivityPulse | null;

    /**
     * Create the workspace bar view.
     *
     * The optional `serverConnection` service drives the offline badge and the
     * optional `deviceConnection` monitor drives the always-visible device badge.
     * Each is only subscribed when it was injected, which is why this view works
     * unchanged in tests and in any host that passes neither.
     *
     * @param {WorkspaceViewOptions} options View options.
     */
    constructor({
        workspace,
        viewManager = null,
        title = 'Workspace',
        appVersion = '0.0.0-dev',
        icon = null,
        id = null,
        logger = null,
        i18nService = null,
        serverConnection = null,
        deviceConnection = null,
    }: WorkspaceViewOptions) {
        super({ title, icon, id, logger, i18nService, minHeight: 40, maxHeight: 40 });

        if (!workspace) {
            throw new Error('WorkspaceView requires a workspace instance');
        }

        this.workspace = workspace;
        this._appVersion = appVersion;
        this._viewManager = viewManager;
        this._collectionDropdown = null;
        this._collectionDropdownContainer = null;
        this._collectionProgressBackdrop = null;
        this._collectionProgressFill = null;
        this._collectionProgressText = null;
        this._collectionDeployProgressActive = false;
        this._collectionProgressHideTimeout = null;
        this._progressListener = null;
        this._versionDisplay = null;
        this._runtimeTargetDisplay = null;
        this._runtimeLabelDisplay = null;
        this._targetSelect = null;
        this._hamburgerButton = null;
        this._languageSwitcher = null;
        this._deployCollectionButton = null;
        this._deployInFlight = false;
        this._unsubscribeWorkspace = null;
        this._deviceStateListener = null;

        // Undo/redo buttons
        this._undoButton = null;
        this._redoButton = null;
        this._historyChangeListener = null;
        this._keyboardShortcutHandler = null;

        // Server connection badge
        this._serverConnection = serverConnection;
        this._serverBadgeButton = null;
        this._serverBadgeLabelEl = null;
        this._unsubscribeServerConnection = null;
        this._serverReconnectInFlight = false;

        // Device connection badge
        this._deviceConnection = deviceConnection;
        this._deviceBadgeButton = null;
        this._deviceBadgeLabelEl = null;
        this._deviceBadgePercentEl = null;
        this._deviceBadgeRingEl = null;
        this._deviceBadgeRingValueEl = null;
        this._unsubscribeDeviceConnection = null;

        // Play/stop quick actions next to the deploy button
        this._runtimePlayButton = null;
        this._runtimeStopButton = null;
        this._executionStateListener = null;

        // Title-bar activity pulse (soft "something is happening" effect)
        this._titleBarEl = null;
        this._activityPulse = null;
    }

    /** @override */
    render(container: HTMLElement): void {
        void container;
        const wrapper = document.createElement('div');
        wrapper.className = 'view-workspace';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '12px';
        wrapper.style.padding = '8px 12px';
        wrapper.style.backgroundColor = 'rgba(12, 16, 28, 0.92)';
        wrapper.style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)';
        wrapper.style.height = '100%';
        wrapper.style.boxSizing = 'border-box';

        // Hamburger menu button (left side)
        this._hamburgerButton = this._createIconButton(IconProvider.menu, 'Menu');
        this._hamburgerButton.addEventListener('click', (e) => this._handleHamburgerClick(e));
        wrapper.appendChild(this._hamburgerButton);

        // Collection selector
        this._collectionDropdownContainer = document.createElement('div');
        this._collectionDropdownContainer.className = 'workspace-collection-selector';
        this._collectionDropdownContainer.style.position = 'relative';
        this._collectionDropdownContainer.style.minWidth = '150px';
        this._collectionDropdownContainer.style.borderRadius = '4px';
        this._collectionDropdownContainer.style.overflow = 'hidden';

        this._collectionProgressBackdrop = document.createElement('div');
        this._collectionProgressBackdrop.className = 'workspace-collection-progress';
        this._collectionProgressBackdrop.style.position = 'absolute';
        this._collectionProgressBackdrop.style.left = '0';
        this._collectionProgressBackdrop.style.top = '0';
        this._collectionProgressBackdrop.style.right = '0';
        this._collectionProgressBackdrop.style.bottom = '0';
        this._collectionProgressBackdrop.style.backgroundColor = 'var(--mo-surface-1, #121927)';
        this._collectionProgressBackdrop.style.pointerEvents = 'none';
        this._collectionProgressBackdrop.style.opacity = '0';
        this._collectionProgressBackdrop.style.transition = 'opacity 120ms ease';

        this._collectionProgressFill = document.createElement('div');
        this._collectionProgressFill.className = 'workspace-collection-progress__fill';
        this._collectionProgressFill.style.position = 'absolute';
        this._collectionProgressFill.style.left = '0';
        this._collectionProgressFill.style.top = '0';
        this._collectionProgressFill.style.bottom = '0';
        this._collectionProgressFill.style.width = '0%';
        this._collectionProgressFill.style.backgroundColor = 'var(--mo-accent, #63b5ff)';
        this._collectionProgressFill.style.opacity = '0.35';
        this._collectionProgressFill.style.transition = 'width 120ms linear';
        this._collectionProgressBackdrop.appendChild(this._collectionProgressFill);

        this._collectionProgressText = document.createElement('div');
        this._collectionProgressText.className = 'workspace-collection-progress__text';
        this._collectionProgressText.style.position = 'absolute';
        this._collectionProgressText.style.right = '8px';
        this._collectionProgressText.style.top = '50%';
        this._collectionProgressText.style.transform = 'translateY(-50%)';
        this._collectionProgressText.style.fontSize = '10px';
        this._collectionProgressText.style.fontWeight = '600';
        this._collectionProgressText.style.color = 'var(--mo-text, #e5eaf3)';
        this._collectionProgressText.style.opacity = '0.85';
        this._collectionProgressText.style.pointerEvents = 'none';
        this._collectionProgressText.textContent = '';
        this._collectionProgressBackdrop.appendChild(this._collectionProgressText);

        this._collectionDropdown = document.createElement('select');
        this._collectionDropdown.style.padding = '4px 8px';
        this._collectionDropdown.style.borderRadius = '4px';
        this._collectionDropdown.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        this._collectionDropdown.style.backgroundColor = 'rgba(30, 35, 50, 0.9)';
        this._collectionDropdown.style.color = '#e7ebff';
        this._collectionDropdown.style.position = 'relative';
        this._collectionDropdown.style.zIndex = '1';
        this._collectionDropdown.style.minWidth = '150px';

        this._collectionDropdownContainer.appendChild(this._collectionProgressBackdrop);
        this._collectionDropdownContainer.appendChild(this._collectionDropdown);
        wrapper.appendChild(this._collectionDropdownContainer);

        // Upload (deploy / sync) button — directly next to the collection selector
        this._deployCollectionButton = this._createIconButton(
            IconProvider.deployCollection,
            this.t('deployment.deployOrSyncCollection') || 'Deploy / Sync Collection'
        );
        this._deployCollectionButton.addEventListener('click', () => this._handleUploadToDevice());
        wrapper.appendChild(this._deployCollectionButton);

        // Play / Stop quick actions — right of the deploy button and only visible while a
        // device is connected. They drive the same `workspace.deviceConnection` as the Device
        // tab, so both surfaces act on and display the same execution state.
        const playLabel = this.t('deviceConnection.play') || 'Play';
        this._runtimePlayButton = this._createIconButton(IconProvider.playArrow, playLabel);
        this._runtimePlayButton.classList.add('workspace-play-btn');
        this._runtimePlayButton.setAttribute('aria-label', playLabel);
        this._runtimePlayButton.addEventListener('click', () => {
            void this._handleRuntimePlay();
        });
        wrapper.appendChild(this._runtimePlayButton);

        const stopLabel = this.t('deviceConnection.stop') || 'Stop';
        this._runtimeStopButton = this._createIconButton(IconProvider.stop, stopLabel);
        this._runtimeStopButton.classList.add('workspace-stop-btn');
        this._runtimeStopButton.setAttribute('aria-label', stopLabel);
        this._runtimeStopButton.addEventListener('click', () => {
            void this._handleRuntimeStop();
        });
        wrapper.appendChild(this._runtimeStopButton);

        // Version display (next to collection selector)
        this._versionDisplay = document.createElement('span');
        this._versionDisplay.style.padding = '4px 8px';
        this._versionDisplay.style.color = 'rgba(231, 235, 255, 0.7)';
        this._versionDisplay.style.fontSize = '11px';
        this._versionDisplay.style.fontFamily = 'monospace';
        this._versionDisplay.textContent = 'v0.0.0';
        wrapper.appendChild(this._versionDisplay);

        // Runtime name plus the collection's target selector. The selector mirrors the
        // collection settings dropdown: same option source, same `setTargetId` writer, and
        // the Collection.TargetIdChanged event keeps both surfaces in sync.
        this._runtimeTargetDisplay = document.createElement('span');
        this._runtimeTargetDisplay.style.padding = '4px 0';
        this._runtimeTargetDisplay.style.color = 'rgba(231, 235, 255, 0.7)';
        this._runtimeTargetDisplay.style.fontSize = '11px';
        this._runtimeTargetDisplay.style.display = 'inline-flex';
        this._runtimeTargetDisplay.style.alignItems = 'center';
        this._runtimeTargetDisplay.style.gap = '6px';
        wrapper.appendChild(this._runtimeTargetDisplay);

        this._runtimeLabelDisplay = document.createElement('span');
        this._runtimeLabelDisplay.textContent = '—';
        this._runtimeTargetDisplay.appendChild(this._runtimeLabelDisplay);

        this._targetSelect = document.createElement('select');
        this._targetSelect.style.padding = '4px 8px';
        this._targetSelect.style.borderRadius = '4px';
        this._targetSelect.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        this._targetSelect.style.backgroundColor = 'rgba(30, 35, 50, 0.9)';
        this._targetSelect.style.color = '#e7ebff';
        this._targetSelect.style.minWidth = '150px';
        this._targetSelect.style.maxWidth = '220px';
        this._targetSelect.hidden = true;
        this._runtimeTargetDisplay.appendChild(this._targetSelect);

        // Device connection badge — always visible, the only place to connect. It is
        // appended first so the server's offline badge reads to its right.
        this._renderDeviceBadgeButton(wrapper);

        // Server connection badge — hidden while the local server is reachable
        this._renderServerBadgeButton(wrapper);

        // Spacer before action buttons
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        wrapper.appendChild(spacer);

        // Undo/redo buttons
        this._undoButton = this._createIconButton(
            IconProvider.undo,
            this.t('collection.undo') || 'Undo'
        );
        this._undoButton.classList.add('workspace-undo-btn');
        this._undoButton.addEventListener('click', () => this._handleUndo());
        wrapper.appendChild(this._undoButton);

        this._redoButton = this._createIconButton(
            IconProvider.redo,
            this.t('collection.redo') || 'Redo'
        );
        this._redoButton.classList.add('workspace-redo-btn');
        this._redoButton.addEventListener('click', () => this._handleRedo());
        wrapper.appendChild(this._redoButton);

        // Language switcher button (moved to the very right)
        if (this._i18nService) {
            this._languageSwitcher = this._createLanguageSwitcher();
            wrapper.appendChild(this._languageSwitcher);
        }

        // The pulse is bound to the bar element itself; a re-render releases the
        // previous instance so a stale one can never animate a detached node.
        this._titleBarEl = wrapper;
        this._activityPulse?.stopAll();
        this._activityPulse = new ActivityPulse(wrapper);

        this.mountContent(wrapper);
        this._populateDropdowns();
        this._updateDeployButtonState();
        this._updateRuntimeControlStates();
        this._updateUndoRedoButtonStates();
        this._attachEventListeners();
        this._subscribeToWorkspaceChanges();
        this._subscribeToDeviceStateChanges();
        this._subscribeToServerConnection();
        this._subscribeToDeviceConnection();
        this._subscribeToExecutionStateChanges();
        this._setupHistoryListeners();
        this._setupKeyboardShortcuts();
        this._setCollectionDeployProgress(0, false);
    }

    /** @override */
    afterAttach(): void {
        super.afterAttach();
        // React to language changes: refresh the flag icon and re-label the badge
        if (this._i18nService) {
            this._subscribeToLanguageChanges(() => {
                this._updateLanguageSwitcherIcon();
                this._renderServerBadgeFromCurrentSnapshot();
                this._renderDeviceBadgeFromCurrentSnapshot();
                this._updateRuntimeControlLabels();
                this._updateVersionDisplay();
            });
        }

        this._subscribeToProgressEvents();
    }

    /** @override */
    beforeDetach(): void {
        this._unsubscribeWorkspace?.();
        this._unsubscribeWorkspace = null;
        this._unsubscribeFromDeviceStateChanges();
        this._unsubscribeFromServerConnection();
        this._unsubscribeFromDeviceConnection();
        this._unsubscribeFromExecutionStateChanges();

        // Drop the pulse with the bar it animates.
        this._activityPulse?.stopAll();
        this._activityPulse = null;
        this._titleBarEl = null;

        // Cleanup undo/redo listeners
        if (this._historyChangeListener) {
            const activeCollection = this.workspace.getActiveCollection();
            if (activeCollection && typeof this._historyChangeListener === 'function') {
                // The listener is an unsubscribe function from collection.onChange
                this._historyChangeListener();
            }
            this._historyChangeListener = null;
        }

        if (this._keyboardShortcutHandler) {
            window.removeEventListener('keydown', this._keyboardShortcutHandler);
            this._keyboardShortcutHandler = null;
        }

        this._unsubscribeFromProgressEvents();

        super.beforeDetach();
    }

    _subscribeToProgressEvents(): void {
        if (this._progressListener) {
            return;
        }

        this._progressListener = (event: ProgressEvent) => {
            this._onProgressEvent(event);
        };

        ProgressEventBus.subscribe(this._progressListener);
    }

    _unsubscribeFromProgressEvents(): void {
        if (this._progressListener) {
            ProgressEventBus.unsubscribe(this._progressListener);
            this._progressListener = null;
        }

        if (this._collectionProgressHideTimeout !== null) {
            clearTimeout(this._collectionProgressHideTimeout);
            this._collectionProgressHideTimeout = null;
        }

        this._setCollectionDeployProgress(0, false);
    }

    _onProgressEvent(event: ProgressEvent): void {
        const isCollectionDeployProgress =
            event.source === 'collection-deploy' || event.source === 'collection-sync';

        if (!isCollectionDeployProgress) {
            return;
        }

        if (this._collectionProgressHideTimeout !== null) {
            clearTimeout(this._collectionProgressHideTimeout);
            this._collectionProgressHideTimeout = null;
        }

        if (event.type === ProgressEventType.START) {
            this._setCollectionDeployProgress(0, true);
            return;
        }

        if (event.type === ProgressEventType.UPDATE) {
            this._setCollectionDeployProgress(event.progress ?? 0, true);
            return;
        }

        if (event.type === ProgressEventType.COMPLETE) {
            this._setCollectionDeployProgress(100, true);
            this._collectionProgressHideTimeout = window.setTimeout(() => {
                this._setCollectionDeployProgress(0, false);
                this._collectionProgressHideTimeout = null;
            }, 800);
            return;
        }

        if (event.type === ProgressEventType.ERROR) {
            this._setCollectionDeployProgress(0, false);
        }
    }

    _setCollectionDeployProgress(progress: number, active: boolean): void {
        if (
            !this._collectionProgressBackdrop ||
            !this._collectionProgressFill ||
            !this._collectionProgressText ||
            !this._collectionDropdown
        ) {
            return;
        }

        const clampedProgress = Math.max(0, Math.min(100, Number(progress) || 0));

        this._collectionDeployProgressActive = active;
        this._collectionProgressBackdrop.style.opacity = active ? '1' : '0';
        this._collectionProgressFill.style.width = `${clampedProgress}%`;
        this._collectionProgressText.textContent = active ? `${Math.round(clampedProgress)}%` : '';
        this._collectionDropdown.style.backgroundColor = active
            ? 'rgba(30, 35, 50, 0.55)'
            : 'rgba(30, 35, 50, 0.9)';
    }

    /**
     * Populate both dropdowns with current workspace data.
     */
    _populateDropdowns() {
        this._populateCollectionDropdown();
        this._updateVersionDisplay();
    }

    /**
     * Populate the collection dropdown with all available collections.
     */
    _populateCollectionDropdown() {
        if (!this._collectionDropdown) return;

        // Clear existing options
        this._collectionDropdown.innerHTML = '';

        const collectionIds = this.workspace.getCollectionIds();
        const activeCollectionId = this.workspace.getActiveCollectionId();

        for (const collectionId of collectionIds) {
            const option = document.createElement('option');
            option.value = collectionId;

            // Try to get collection title, fallback to ID
            const collection = this.workspace.collections.get(collectionId);
            option.textContent = collection?.getTitle?.() || collectionId;

            if (collectionId === activeCollectionId) {
                option.selected = true;
            }
            this._collectionDropdown.appendChild(option);
        }
    }

    /**
     * Update the version display and the runtime/target area of the title bar to
     * reflect the active collection.
     * @private
     */
    _updateVersionDisplay() {
        if (!this._versionDisplay) return;
        if (!this._runtimeTargetDisplay) return;

        const activeCollection = this.workspace.getActiveCollection();
        if (!activeCollection) {
            this._versionDisplay.textContent = 'v0.0.0';
            if (this._runtimeLabelDisplay) {
                this._runtimeLabelDisplay.textContent = '—';
            }
            this._refreshTargetSelector(null);
            return;
        }

        const versionString =
            typeof activeCollection.getVersionString === 'function'
                ? activeCollection.getVersionString()
                : '0.0.0';
        this._versionDisplay.textContent = `v${versionString}`;

        const runtimeName = this._getRuntimeNameForCollection(activeCollection);
        if (this._runtimeLabelDisplay) {
            this._runtimeLabelDisplay.textContent = `${runtimeName} ·`;
        }
        this._refreshTargetSelector(activeCollection);

        const version =
            typeof activeCollection.getVersion === 'function'
                ? activeCollection.getVersion()
                : null;
        const isDirty = Boolean(
            version && typeof version.isDirty === 'function' && version.isDirty()
        );
        if (isDirty) {
            this._versionDisplay.style.color = 'rgba(255, 200, 100, 0.9)'; // Orange for dirty
        } else {
            this._versionDisplay.style.color = 'rgba(231, 235, 255, 0.7)'; // Default
        }
    }

    /**
     * Refresh the title-bar target selector from the active collection.
     *
     * Mirrors the collection settings target dropdown: both list
     * `CollectionManager.listTargetsForRuntime()` and write through
     * `Collection.setTargetId()`, so `Collection.TargetIdChanged.v1` keeps the two
     * surfaces in sync.
     *
     * @param {Collection | null} collection Active collection, if any.
     * @private
     */
    _refreshTargetSelector(collection: Collection | null): void {
        if (!this._targetSelect) return;

        const runtimeId = collection?.getDeviceRuntimeId?.() || '';
        const collectionManager = this.workspace.collectionManager;
        const targets =
            collectionManager && typeof collectionManager.listTargetsForRuntime === 'function'
                ? collectionManager.listTargetsForRuntime(runtimeId)
                : [];
        const currentTargetId = collection?.getTargetId?.() || null;

        this._targetSelect.replaceChildren();
        this._targetSelect.setAttribute('aria-label', this.t('settings.collection.target.label'));

        for (const target of targets) {
            const option = document.createElement('option');
            option.value = target.id;
            option.textContent = target.name || target.id;
            option.selected = target.id === currentTargetId;
            this._targetSelect.appendChild(option);
        }

        const hasTargets = Boolean(collection) && targets.length > 0;
        this._targetSelect.hidden = !hasTargets;
        this._targetSelect.disabled = !hasTargets;
    }

    _getRuntimeNameForCollection(collection: Collection | null): string {
        const runtimeId = collection?.getDeviceRuntimeId?.();
        if (!runtimeId) {
            return 'Unknown Runtime';
        }
        const runtime = this.workspace
            .listAvailableRuntimes()
            .find((entry) => entry.id === runtimeId);
        return runtime?.name || runtimeId;
    }

    _isDeviceConnected() {
        const deviceDeployment = this.workspace.deviceDeployment;
        const deviceConnection =
            deviceDeployment &&
            typeof deviceDeployment.getDeviceConnection === 'function' &&
            deviceDeployment.getDeviceConnection();
        return Boolean(
            deviceConnection &&
            typeof deviceConnection.isConnected === 'function' &&
            deviceConnection.isConnected()
        );
    }

    /**
     * Show or hide the deploy button and mirror the connection/deploy state.
     *
     * The button is hidden until a device is connected, because a deploy action with
     * no target would only be a disabled stub in the title bar. While a deploy is in
     * flight the button stays visible but disabled.
     */
    _updateDeployButtonState() {
        if (!this._deployCollectionButton) {
            return;
        }

        const connected = this._isDeviceConnected();
        // `_createIconButton` writes an inline `display: flex`; toggling `hidden` would
        // be overruled by it, so drive `display` directly (same pitfall as the badge).
        this._deployCollectionButton.style.display = connected ? 'flex' : 'none';

        const enabled = connected && !this._deployInFlight;
        this._deployCollectionButton.disabled = !enabled;
        this._deployCollectionButton.style.opacity = enabled ? '1' : '0.45';
        this._deployCollectionButton.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    _subscribeToDeviceStateChanges() {
        this._unsubscribeFromDeviceStateChanges();

        const deviceDeployment = this.workspace.deviceDeployment;
        if (!deviceDeployment || typeof deviceDeployment.addEventListener !== 'function') {
            return;
        }

        this._deviceStateListener = () => {
            this._updateDeployButtonState();
        };

        deviceDeployment.addEventListener('device-state-changed', this._deviceStateListener);
    }

    _unsubscribeFromDeviceStateChanges() {
        const deviceDeployment = this.workspace.deviceDeployment;
        if (
            !deviceDeployment ||
            typeof deviceDeployment.removeEventListener !== 'function' ||
            !this._deviceStateListener
        ) {
            this._deviceStateListener = null;
            return;
        }

        deviceDeployment.removeEventListener('device-state-changed', this._deviceStateListener);
        this._deviceStateListener = null;
    }

    /**
     * Show or hide the Play/Stop buttons and mirror the current execution state.
     *
     * Visibility follows the connection monitor, so the quick actions appear exactly
     * when the badge reports `connected` — the only state in which the runtime accepts
     * a Play or Stop request. Execution state is read from
     * `workspace.deviceConnection`, the same object the Device tab drives, so both
     * surfaces agree without sharing view-local state.
     * @private
     */
    _updateRuntimeControlStates(): void {
        const playButton = this._runtimePlayButton;
        const stopButton = this._runtimeStopButton;
        if (!playButton || !stopButton) {
            return;
        }

        const connected = this._deviceConnection?.getSnapshot().state === 'connected';
        // `_createIconButton` writes an inline `display: flex`; toggling `hidden` would
        // be overruled by it, so drive `display` directly (same pitfall as the badge).
        const display = connected ? 'flex' : 'none';
        playButton.style.display = display;
        stopButton.style.display = display;

        const connection = this.workspace.deviceConnection;
        const executing = Boolean(
            connection &&
                typeof connection.isExecutionRunning === 'function' &&
                connection.isExecutionRunning()
        );
        this._setRuntimeButtonEnabled(playButton, connected && !executing);
        this._setRuntimeButtonEnabled(stopButton, connected && executing);
    }

    /**
     * Apply the shared enabled/disabled styling to one runtime control button.
     * @param {HTMLButtonElement} button Button to update.
     * @param {boolean} enabled Whether the button accepts clicks.
     * @private
     */
    _setRuntimeButtonEnabled(button: HTMLButtonElement, enabled: boolean): void {
        button.disabled = !enabled;
        button.style.opacity = enabled ? '1' : '0.45';
        button.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    /**
     * Refresh Play/Stop tooltips and accessible labels after a locale change.
     * @private
     */
    _updateRuntimeControlLabels(): void {
        const entries = [
            { button: this._runtimePlayButton, label: this.t('deviceConnection.play') || 'Play' },
            { button: this._runtimeStopButton, label: this.t('deviceConnection.stop') || 'Stop' },
        ];

        for (const { button, label } of entries) {
            if (!button) {
                continue;
            }
            button.title = label;
            button.setAttribute('aria-label', label);
        }
    }

    /**
     * Subscribe to execution state changes on the workspace's device connection.
     *
     * The Device tab and collection deployment share this connection, so listening to
     * its `execution-started` / `execution-stopped` events keeps the title-bar buttons
     * correct no matter which surface triggered the change.
     * @private
     */
    _subscribeToExecutionStateChanges(): void {
        this._unsubscribeFromExecutionStateChanges();

        const connection = this.workspace.deviceConnection;
        if (!connection || typeof connection.addEventListener !== 'function') {
            return;
        }

        this._executionStateListener = () => {
            this._updateRuntimeControlStates();
        };

        connection.addEventListener('execution-started', this._executionStateListener);
        connection.addEventListener('execution-stopped', this._executionStateListener);
    }

    /**
     * Drop the execution state listeners, if there are any.
     * @private
     */
    _unsubscribeFromExecutionStateChanges(): void {
        const connection = this.workspace.deviceConnection;
        if (
            !connection ||
            typeof connection.removeEventListener !== 'function' ||
            !this._executionStateListener
        ) {
            this._executionStateListener = null;
            return;
        }

        connection.removeEventListener('execution-started', this._executionStateListener);
        connection.removeEventListener('execution-stopped', this._executionStateListener);
        this._executionStateListener = null;
    }

    /**
     * Start or restart the main runtime from the title bar.
     * @private
     */
    async _handleRuntimePlay(): Promise<void> {
        const connection = this.workspace.deviceConnection;
        if (!connection || typeof connection.startMain !== 'function') {
            this._log('runtime-play-unavailable', 'warn');
            return;
        }

        try {
            await connection.startMain();
        } catch (error) {
            const message = (error as { message?: string })?.message;
            this._log('runtime-play-failed', 'error', { error: message });
            void this._showRuntimeError(
                this.t('deviceConnection.errors.playFailed') || 'Start Execution Failed',
                message
            );
        } finally {
            this._updateRuntimeControlStates();
        }
    }

    /**
     * Stop the running runtime from the title bar.
     * @private
     */
    async _handleRuntimeStop(): Promise<void> {
        const connection = this.workspace.deviceConnection;
        if (!connection || typeof connection.stopExecution !== 'function') {
            this._log('runtime-stop-unavailable', 'warn');
            return;
        }

        try {
            await connection.stopExecution();
        } catch (error) {
            const message = (error as { message?: string })?.message;
            this._log('runtime-stop-failed', 'error', { error: message });
            void this._showRuntimeError(
                this.t('deviceConnection.errors.stopFailed') || 'Stop Execution Failed',
                message
            );
        } finally {
            this._updateRuntimeControlStates();
        }
    }

    /**
     * Surface a failed runtime action through the shared error dialog.
     *
     * The connection already emits its own error message to the console, so this only
     * adds the modal the Device tab shows for the same failures.
     * @param {string} title Dialog title.
     * @param {string} [message] Optional detail line.
     * @private
     */
    async _showRuntimeError(title: string, message?: string): Promise<void> {
        if (!this._viewManager || typeof this._viewManager.showError !== 'function') {
            this._log('runtime-error-no-view-manager', 'warn', { title, message });
            return;
        }

        try {
            await this._viewManager.showError({ title, message: message || '' });
        } catch (error) {
            this._log('runtime-error-dialog-failed', 'warn', {
                error: (error as { message?: string })?.message,
            });
        }
    }

    /**
     * Create and append the server connection badge.
     *
     * The badge starts hidden: it only becomes visible once the monitor reports a
     * real outage, so a healthy session looks exactly as it does without this view
     * option. Visibility and styling come from `.workspace-server-badge` in
     * `styles/standard/workspace-view.css`; the button therefore carries no inline
     * chrome, because an inline `display` would defeat the `[hidden]` rule.
     *
     * The glyph is `cloud_off` (M4t): the title bar also carries the device badge,
     * whose glyph is `cable`, so the two facts the app knows about the outside world
     * stay distinguishable at a glance. The badge is appended after the device badge,
     * so an outage reads to the right of the always-visible connect badge.
     *
     * @param {HTMLElement} wrapper Bar element the badge is appended to.
     * @private
     */
    _renderServerBadgeButton(wrapper: HTMLElement): void {
        if (!this._serverConnection) {
            return;
        }

        this._serverBadgeButton = this._createIconButton(
            IconProvider.cloudOff,
            this.t('workspace.server.offlineTitle') || 'Server offline'
        );
        this._serverBadgeButton.classList.add('workspace-server-badge');
        // `_createIconButton` writes the plain icon-button chrome as inline styles, and an
        // inline `display` outranks the `.workspace-server-badge[hidden]` rule, so the badge
        // stayed painted while the server answered (seen in the Vite dev session). The badge
        // owns its appearance through `.workspace-server-badge`, so drop the inline chrome and
        // let that class — including its `[hidden]` rule — decide visibility and look.
        this._serverBadgeButton.removeAttribute('style');
        this._serverBadgeButton.hidden = true;

        this._serverBadgeLabelEl = document.createElement('span');
        this._serverBadgeLabelEl.className = 'workspace-server-badge__label';
        this._serverBadgeButton.appendChild(this._serverBadgeLabelEl);

        this._serverBadgeButton.addEventListener('click', () => {
            void this._handleServerBadgeClick();
        });
        wrapper.appendChild(this._serverBadgeButton);
    }

    /**
     * Re-render the badge from the monitor's current snapshot.
     * @private
     */
    _renderServerBadgeFromCurrentSnapshot(): void {
        if (!this._serverConnection) {
            return;
        }
        this._renderServerBadge(this._serverConnection.getSnapshot());
    }

    /**
     * Paint the badge for *snapshot*.
     *
     * `unknown` and `connected` hide the badge, because "we have not probed yet" is
     * not an outage. A probe in flight switches the badge to the muted
     * `reconnecting` state and disables it so a second click cannot start a second
     * probe.
     *
     * @param {ServerConnectionSnapshot} snapshot Connection snapshot to render.
     * @private
     */
    _renderServerBadge(snapshot: ServerConnectionSnapshot): void {
        const button = this._serverBadgeButton;
        const label = this._serverBadgeLabelEl;
        if (!button) {
            return;
        }

        const reconnecting = this._serverReconnectInFlight;
        button.disabled = reconnecting;
        button.setAttribute('aria-busy', reconnecting ? 'true' : 'false');

        const hidden = snapshot.state === 'connected' || snapshot.state === 'unknown';
        button.hidden = hidden;

        if (hidden) {
            button.removeAttribute('data-state');
            if (label) {
                label.textContent = '';
            }
            return;
        }

        button.dataset.state = reconnecting ? 'reconnecting' : 'offline';

        if (label) {
            label.textContent = reconnecting
                ? this.t('workspace.server.reconnecting') || 'Reconnecting…'
                : this.t('workspace.server.offline') || 'Offline';
        }

        const title = reconnecting
            ? this.t('workspace.server.reconnectingTitle') || 'Trying to reach the Micro-Otter server…'
            : this.t('workspace.server.offlineTitle') ||
              'The Micro-Otter server is not reachable — click to reconnect';
        button.title = title;
        button.setAttribute('aria-label', title);
    }

    /**
     * Probe the server once from the badge.
     *
     * Returns immediately when no connection service is injected or a probe is
     * already in flight, so rapid clicks cannot stack requests.
     * @private
     */
    async _handleServerBadgeClick(): Promise<void> {
        const connection = this._serverConnection;
        if (!connection || this._serverReconnectInFlight) {
            return;
        }

        this._serverReconnectInFlight = true;
        this._renderServerBadge(connection.getSnapshot());

        try {
            const snapshot = await connection.checkNow();
            this._serverReconnectInFlight = false;
            this._renderServerBadge(snapshot);
        } catch (error) {
            this._serverReconnectInFlight = false;
            this._renderServerBadge(connection.getSnapshot());
            this._log('server-badge-check-failed', 'warn', { error });
        }
    }

    /**
     * Subscribe to the server connection monitor, if one was injected.
     * @private
     */
    _subscribeToServerConnection(): void {
        this._unsubscribeFromServerConnection();

        if (!this._serverConnection) {
            return;
        }

        this._unsubscribeServerConnection = this._serverConnection.subscribe((snapshot) =>
            this._renderServerBadge(snapshot)
        );
        this._renderServerBadgeFromCurrentSnapshot();
    }

    /**
     * Drop the server connection subscription, if there is one.
     * @private
     */
    _unsubscribeFromServerConnection(): void {
        if (this._unsubscribeServerConnection) {
            this._unsubscribeServerConnection();
        }
        this._unsubscribeServerConnection = null;
    }

    /**
     * Create and append the device connection badge.
     *
     * The badge is always visible: it is the only place to connect a device, so it
     * must render even before any device exists. It is appended before the server
     * badge, so an outage reads to the right of this always-visible connect badge.
     * Like the server badge it drops the inline chrome `_createIconButton` writes,
     * because an inline `display` would outrank the `.workspace-device-badge` rules
     * that own its look.
     *
     * Composition: the `cable` glyph (the Device tab's glyph), a state label, an
     * `aria-hidden` percentage cell and an inline determinate ring.
     *
     * @param {HTMLElement} wrapper Bar element the badge is appended to.
     * @private
     */
    _renderDeviceBadgeButton(wrapper: HTMLElement): void {
        if (!this._deviceConnection) {
            return;
        }

        this._deviceBadgeButton = this._createIconButton(
            IconProvider.cable,
            this.t('workspace.device.title') || 'Device connection'
        );
        this._deviceBadgeButton.classList.add('workspace-device-badge');
        this._deviceBadgeButton.removeAttribute('style');

        this._deviceBadgeLabelEl = document.createElement('span');
        this._deviceBadgeLabelEl.className = 'workspace-device-badge__label';
        this._deviceBadgeButton.appendChild(this._deviceBadgeLabelEl);

        this._deviceBadgePercentEl = document.createElement('span');
        this._deviceBadgePercentEl.className = 'workspace-device-badge__percent';
        this._deviceBadgePercentEl.setAttribute('aria-hidden', 'true');
        this._deviceBadgeButton.appendChild(this._deviceBadgePercentEl);

        this._deviceBadgeRingEl = this._createDeviceBadgeRing();
        this._deviceBadgeButton.appendChild(this._deviceBadgeRingEl);

        this._deviceBadgeButton.addEventListener('click', () => {
            void this._handleDeviceBadgeClick();
        });
        wrapper.appendChild(this._deviceBadgeButton);
    }

    /**
     * Build the determinate progress ring.
     *
     * `pathLength="100"` lets the painter drive the ring with
     * `stroke-dashoffset = 100 - percent`, so no circumference arithmetic is needed.
     * @returns {SVGSVGElement} The ring element, stored for repainting.
     * @private
     */
    _createDeviceBadgeRing(): SVGSVGElement {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'workspace-device-badge__ring');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');

        const track = document.createElementNS(ns, 'circle');
        track.setAttribute('class', 'workspace-device-badge__ring-track');
        track.setAttribute('cx', '8');
        track.setAttribute('cy', '8');
        track.setAttribute('r', '6');
        track.setAttribute('fill', 'none');
        svg.appendChild(track);

        const value = document.createElementNS(ns, 'circle');
        value.setAttribute('class', 'workspace-device-badge__ring-value');
        value.setAttribute('cx', '8');
        value.setAttribute('cy', '8');
        value.setAttribute('r', '6');
        value.setAttribute('pathLength', '100');
        value.setAttribute('fill', 'none');
        value.setAttribute('stroke-dasharray', '100');
        value.setAttribute('stroke-dashoffset', '100');
        svg.appendChild(value);

        this._deviceBadgeRingValueEl = value;
        return svg;
    }

    /**
     * Re-render the device badge from the monitor's current snapshot.
     * @private
     */
    _renderDeviceBadgeFromCurrentSnapshot(): void {
        if (!this._deviceConnection) {
            return;
        }
        this._renderDeviceBadge(this._deviceConnection.getSnapshot());
    }

    /**
     * Paint one snapshot into the badge.
     *
     * This is the only painter: label, `data-state`, `aria-busy`, the tooltip and
     * the ring all come from *snapshot*, so the badge can never disagree with the
     * connection dialog about the state.
     *
     * @param {DeviceConnectionSnapshot} snapshot Snapshot to render.
     * @private
     */
    _renderDeviceBadge(snapshot: DeviceConnectionSnapshot): void {
        const button = this._deviceBadgeButton;
        if (!button) {
            return;
        }

        const state = snapshot.state;
        const busy =
            state === 'connecting' || state === 'loading' || state === 'disconnecting';
        const percent = state === 'loading' ? snapshot.progress : null;

        button.setAttribute('data-state', state);
        button.setAttribute('aria-busy', busy ? 'true' : 'false');

        const parts = state === 'loading' ? this._deviceLoadingLabelParts(percent) : null;

        if (this._deviceBadgeLabelEl) {
            this._deviceBadgeLabelEl.textContent =
                parts !== null ? parts.label : this.t(DEVICE_BADGE_LABEL_KEYS[state]);
        }

        if (this._deviceBadgePercentEl) {
            this._deviceBadgePercentEl.textContent = parts !== null ? parts.percent : '';
        }

        const title = this._deviceBadgeTitle(snapshot);
        button.title = title;
        button.setAttribute('aria-label', title);

        if (this._deviceBadgeRingEl) {
            if (percent === null) {
                this._deviceBadgeRingEl.setAttribute('hidden', '');
            } else {
                this._deviceBadgeRingEl.removeAttribute('hidden');
            }
        }
        if (this._deviceBadgeRingValueEl) {
            this._deviceBadgeRingValueEl.setAttribute(
                'stroke-dashoffset',
                String(100 - (percent ?? 0))
            );
        }
    }

    /**
     * Split the `workspace.device.loading` template into its word and number parts.
     *
     * The separator cell exists so the bar does not reflow between `9 %` and
     * `100 %`; splitting the localized template on a sentinel keeps both parts
     * translated without hard-coding the percent sign.
     * @param {number|null} percent Percentage to render, or `null`.
     * @returns {{label: string, percent: string}} The two cell texts.
     * @private
     */
    _deviceLoadingLabelParts(percent: number | null): { label: string; percent: string } {
        const marker = '\u0000';
        const [head, tail] = this.t('workspace.device.loading', { percent: marker }).split(marker);
        const label = (head ?? '').trim();

        if (percent === null) {
            return { label, percent: '' };
        }

        const suffix = (tail ?? '').trim();
        return { label, percent: suffix ? `${percent} ${suffix}` : String(percent) };
    }

    /**
     * Tooltip and accessible name for *snapshot*.
     *
     * The tooltip is the only place a failure message can appear without opening a
     * dialog, so the `error` state appends it.
     * @param {DeviceConnectionSnapshot} snapshot Snapshot to describe.
     * @returns {string} Tooltip text.
     * @private
     */
    _deviceBadgeTitle(snapshot: DeviceConnectionSnapshot): string {
        if (snapshot.state === 'error' && snapshot.error) {
            return `${this.t(DEVICE_BADGE_TITLE_KEYS[snapshot.state])}: ${snapshot.error}`;
        }
        if (snapshot.state === 'loading' && snapshot.progress !== null) {
            return this.t('workspace.device.loadingTitle', { percent: snapshot.progress });
        }
        return this.t(DEVICE_BADGE_TITLE_KEYS[snapshot.state]);
    }

    /**
     * Open the connection dialog.
     *
     * Opening also clears a latched failure, so `Failed` is dismissible without a
     * reconnect attempt. The dialog closes itself before it connects, so this method
     * awaits a user decision rather than a connection.
     * @private
     */
    async _handleDeviceBadgeClick(): Promise<void> {
        const connection = this._deviceConnection;
        const viewManager = this._viewManager;
        if (!connection || !viewManager) {
            return;
        }

        // A double click would replace the open dialog (clearModal detaches it without
        // a `close` event), orphaning the first `open()` promise. Skip while it is on
        // screen; a click while `connecting` (no dialog open) still opens the
        // cancel-only dialog.
        if (viewManager.modalView instanceof DeviceConnectionDialogView) {
            return;
        }

        connection.resetError();
        this._renderDeviceBadge(connection.getSnapshot());

        try {
            await DeviceConnectionDialogView.open(viewManager, {
                connection,
                i18nService: this._i18nService,
                logger: this._logger,
            });
        } catch (error) {
            this._log('device-badge-dialog-failed', 'warn', { error });
        }
    }

    /**
     * Start or stop the soft title-bar activity pulse for one named reason.
     *
     * This is the general trigger any event can use; the bar keeps pulsing until
     * every reason has been released, so independent background activities compose
     * instead of cancelling each other. The visual effect itself is the
     * `mo-activity-pulse` class from `styles/standard/activity-pulse.css`.
     *
     * @param {string} reason Name of the activity, e.g. `'device-connection'`.
     * @param {boolean} active Whether that activity currently needs the pulse.
     */
    setActivityPulse(reason: string, active: boolean): void {
        const pulse = this._activityPulse;
        if (!pulse) {
            return;
        }
        if (active) {
            pulse.start(reason);
        } else {
            pulse.stop(reason);
        }
    }

    /**
     * Drive the title-bar pulse from a device connection snapshot.
     *
     * `connecting` and `loading` are the two halves of one attempt: the port opens
     * in `connecting`, device information loads in `loading`. Every idle or terminal
     * state releases the reason, so a failed or cancelled attempt stops pulsing
     * immediately.
     *
     * @param {DeviceConnectionSnapshot} snapshot Snapshot to react to.
     * @private
     */
    _updateActivityPulse(snapshot: DeviceConnectionSnapshot): void {
        const attempting = snapshot.state === 'connecting' || snapshot.state === 'loading';
        this.setActivityPulse(DEVICE_CONNECTION_PULSE_REASON, attempting);
    }

    /**
     * Subscribe to the device connection monitor, if there is one.
     * @private
     */
    _subscribeToDeviceConnection(): void {
        this._unsubscribeFromDeviceConnection();

        if (!this._deviceConnection) {
            return;
        }

        this._unsubscribeDeviceConnection = this._deviceConnection.subscribe((snapshot) => {
            this._renderDeviceBadge(snapshot);
            // The badge is the only connect affordance, so its snapshot also gates the
            // deploy and Play/Stop quick actions in the title bar.
            this._updateDeployButtonState();
            this._updateRuntimeControlStates();
            this._updateActivityPulse(snapshot);
        });
        this._renderDeviceBadgeFromCurrentSnapshot();
        this._updateRuntimeControlStates();
        // A bar attached while an attempt is already in flight has to pulse at once.
        this._updateActivityPulse(this._deviceConnection.getSnapshot());
    }

    /**
     * Drop the device connection subscription, if there is one.
     * @private
     */
    _unsubscribeFromDeviceConnection(): void {
        if (this._unsubscribeDeviceConnection) {
            this._unsubscribeDeviceConnection();
        }
        this._unsubscribeDeviceConnection = null;
    }




    /**
     * Attach change event listeners to dropdowns.
     */
    _attachEventListeners(): void {
        if (this._collectionDropdown) {
            this._collectionDropdown.addEventListener('change', async (event: Event) => {
                const newCollectionId = (event.target as HTMLSelectElement).value;
                try {
                    await this.workspace.setActiveCollectionId(newCollectionId);
                    this._updateVersionDisplay(); // Refresh version for new collection
                    this._log('collection-changed', { collectionId: newCollectionId });
                } catch (error) {
                    this._log('collection-change-failed', 'error', { error: error.message });
                }
            });
        }

        if (this._targetSelect) {
            this._targetSelect.addEventListener('change', (event: Event) => {
                const activeCollection = this.workspace.getActiveCollection();
                if (!activeCollection) {
                    return;
                }
                const targetId = (event.target as HTMLSelectElement).value || null;
                activeCollection.setTargetId(targetId);
                this._log('target-changed', { targetId });
            });
        }
    }

    /**
     * Create the language switcher button with flag icon.
     * @returns {HTMLButtonElement}
     * @private
     */
    _createLanguageSwitcher(): LanguageSwitcherButton {
        const i18nService = this._i18nService as I18nService;
        const currentLocale = i18nService.currentLocale;
        const localeInfo = (i18nService.availableLocales as LocaleInfo[]).find(
            (l) => l.code === currentLocale
        );
        const iconPath = localeInfo?.icon ? `/html/locales/${localeInfo.icon}` : null;

        const button = document.createElement('button') as LanguageSwitcherButton;
        button.title = this.t('workspace.changeLanguage') || 'Change Language';
        button.style.padding = '4px';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.backgroundColor = 'transparent';
        button.style.cursor = 'pointer';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.width = '28px';
        button.style.height = '28px';

        if (iconPath) {
            const img = document.createElement('img');
            img.src = iconPath;
            img.style.width = '20px';
            img.style.height = '20px';
            img.style.display = 'block';
            button.appendChild(img);
            button._flagImg = img; // Store reference for updates
        }

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'transparent';
        });
        button.addEventListener('click', () => this._handleLanguageSwitch());

        return button;
    }

    /**
     * Update the language switcher flag icon to match current locale.
     * @private
     */
    _updateLanguageSwitcherIcon(): void {
        if (!this._languageSwitcher || !this._i18nService) return;

        const currentLocale = this._i18nService.currentLocale;
        const localeInfo = (this._i18nService.availableLocales as LocaleInfo[]).find(
            (l) => l.code === currentLocale
        );
        const iconPath = localeInfo?.icon ? `/html/locales/${localeInfo.icon}` : null;

        if (this._languageSwitcher._flagImg && iconPath) {
            this._languageSwitcher._flagImg.src = iconPath;
        }

        // Update tooltip
        this._languageSwitcher.title = this.t('workspace.changeLanguage') || 'Change Language';
    }

    /**
     * Handle language switcher button click.
     * Opens a LanguagePickerView as a modal dialog.
     * @private
     */
    async _handleLanguageSwitch() {
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for language picker modal',
            });
            return;
        }

        // Create language picker view
        const picker = new LanguagePickerView({
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Handle locale selection
        picker.on('select', async (event) => {
            const validated = assertAppEventPayloadType(
                event,
                'LanguagePickerView.Select.v1',
                [{ name: 'locale', validate: (value) => value && typeof value === 'object' }],
                'WorkspaceView.languagePickerSelectListener'
            );

            const { locale } = validated.detail as unknown as LanguagePickerSelectPayload;
            try {
                await this.workspace.setLocale(locale.code);
                this._viewManager.clearModal();
            } catch (error) {
                this._log('language-change-failed', 'error', { error: error.message });
            }
        });

        // Handle cancel
        picker.on('cancel', (event) => {
            assertAppEventPayloadType(
                event,
                'LanguagePickerView.Cancel.v1',
                'WorkspaceView.languagePickerCancelListener'
            );

            // ViewManager will close the modal on cancel
        });

        this._viewManager.showModal(picker);
    }

    /**
     * Handle hamburger menu button click.
     * Shows a context menu with collection and workspace actions.
     * @param {MouseEvent} _event Click event
     * @private
     */
    async _handleHamburgerClick(_event) {
        if (!this._viewManager) {
            this._log('no-view-manager', 'warn', {
                message: 'ViewManager not available for hamburger menu',
            });
            return;
        }

        // Get button position for menu placement
        const buttonRect = this._hamburgerButton.getBoundingClientRect();

        // Check if device is connected and compatible for upload option
        const deviceDeployment = this.workspace.deviceDeployment;
        const deviceConnection =
            deviceDeployment &&
            typeof deviceDeployment.getDeviceConnection === 'function' &&
            deviceDeployment.getDeviceConnection();
        const isConnected = Boolean(
            deviceConnection &&
            typeof deviceConnection.isConnected === 'function' &&
            deviceConnection.isConnected()
        );
        const activeCollection = this.workspace.getActiveCollection();
        let canUpload = false;

        if (isConnected && activeCollection && deviceDeployment.validateCollectionCompatibility) {
            try {
                const validation =
                    await deviceDeployment.validateCollectionCompatibility(activeCollection);
                canUpload = validation && validation.compatible;
            } catch (error) {
                this._log('compatibility-check-failed', 'warn', { error: error.message });
            }
        }

        const menuItems = this._buildMenuItems({ canUpload });

        // Create and show menu window
        const menuWindow = new MenuWindow({
            items: menuItems,
            onSelect: (item) => this._handleMenuItemSelect(item),
            x: buttonRect.left,
            y: buttonRect.bottom + 4,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._viewManager.addOverlay(menuWindow);
    }

    /**
     * Build the hamburger menu entries.
     * The three daily actions stay leaves so they remain one click away; everything import/export-ish
     * is grouped behind a noun row that opens a side menu (see `_buildMenuGroup()`).
     * Graph deletion and rename live in the graph-tab context menu.
     * @param {object} options - Build options.
     * @param {boolean} options.canUpload - Whether the deploy entry is enabled.
     * @returns {Array} Menu entries for `MenuWindow`.
     * @private
     */
    _buildMenuItems({ canUpload }) {
        return [
            {
                id: 'create-collection',
                label: 'menu.item.createCollection',
                icon: IconProvider.addCollection,
            },
            {
                id: 'upload-to-device',
                label: 'menu.item.uploadToDevice',
                icon: IconProvider.deployCollection,
                disabled: !canUpload,
            },
            {
                id: 'delete-collection',
                label: 'menu.item.deleteCollection',
                icon: IconProvider.delete,
            },
            { type: 'separator' },
            this._buildMenuGroup({
                id: 'group-collection',
                label: 'menu.group.collection',
                icon: IconProvider.syncCollection,
                items: [
                    {
                        id: 'download-json',
                        label: 'menu.item.downloadJSON',
                        icon: IconProvider.download,
                    },
                    {
                        id: 'upload-json',
                        label: 'menu.item.uploadJSON',
                        icon: IconProvider.upload,
                    },
                ],
            }),
            this._buildMenuGroup({
                id: 'group-database',
                label: 'menu.group.database',
                icon: IconProvider.hardDrive,
                items: [
                    {
                        id: 'backup-db',
                        label: 'menu.item.backupDB',
                        icon: IconProvider.archive,
                    },
                    {
                        id: 'restore-db',
                        label: 'menu.item.restoreDB',
                        icon: IconProvider.unarchive,
                    },
                ],
            }),
            this._buildMenuGroup({
                id: 'group-target-config',
                label: 'menu.group.targetConfig',
                icon: IconProvider.dataObject,
                items: [
                    {
                        id: 'upload-target-config',
                        label: 'menu.item.uploadTargetConfig',
                        icon: IconProvider.upload,
                    },
                    {
                        id: 'download-target-config-template',
                        label: 'menu.item.downloadTargetConfigTemplate',
                        icon: IconProvider.download,
                    },
                    {
                        id: 'download-current-target-config',
                        label: 'menu.item.downloadCurrentTargetConfig',
                        icon: IconProvider.download,
                    },
                    {
                        id: 'backup-target-config-db',
                        label: 'workspace.menu.targetConfigDb.backup',
                        icon: IconProvider.archive,
                    },
                    {
                        id: 'restore-target-config-db',
                        label: 'workspace.menu.targetConfigDb.restore',
                        icon: IconProvider.unarchive,
                    },
                ],
            }),
            { type: 'separator' },
            this._buildMenuGroup({
                id: 'group-info',
                label: 'menu.group.info',
                icon: IconProvider.info,
                items: [
                    {
                        id: 'select-language',
                        label: 'menu.item.selectLanguage',
                        icon: IconProvider.language,
                    },
                    {
                        id: 'about',
                        label: 'menu.item.about',
                        icon: IconProvider.info,
                    },
                    {
                        id: 'privacy-notice',
                        label: 'menu.item.privacyNotice',
                        icon: IconProvider.info,
                    },
                ],
            }),
        ];
    }

    /**
     * Build a `menuview` entry: a row that opens a side menu with `items`.
     * The child menu carries no `onSelect`; `MenuWindow` assigns the parent callback when it hosts
     * the menu, so a child selection bubbles up as if the row had been clicked in the parent menu.
     * @param {object} options - Group definition.
     * @param {string} options.id - Row id of the group (never selected, only identifies the row).
     * @param {string} options.label - Translation key of the row; also used as the child menu title.
     * @param {string} options.icon - Icon of the group row.
     * @param {Array} options.items - Child entries of the side menu.
     * @returns {object} `menuview` entry for `MenuWindow`.
     * @private
     */
    _buildMenuGroup({ id, label, icon, items }) {
        return {
            type: 'menuview',
            id,
            label,
            icon,
            menu: new MenuView({
                title: label,
                items,
                i18nService: this._i18nService,
                logger: this._logger,
            }),
        };
    }

    /**
     * Handle menu item selection from hamburger menu.
     * @param {object} item Selected menu item
     * @private
     */
    _handleMenuItemSelect(item: MenuItemSelection): void {
        switch (item.id) {
            case 'create-collection':
                this._handleCreateCollection();
                break;
            case 'upload-to-device':
                this._handleUploadToDevice();
                break;
            case 'delete-collection':
                this._handleDeleteCollection();
                break;
            case 'download-json':
                this._handleExportCollection();
                break;
            case 'upload-json':
                this._handleImportCollection();
                break;
            case 'upload-target-config':
                this._handleUploadTargetConfig();
                break;
            case 'download-target-config-template':
                this._handleDownloadTargetConfigTemplate();
                break;
            case 'download-current-target-config':
                this._handleDownloadCurrentTargetConfig();
                break;
            case 'backup-target-config-db':
                this._handleBackupTargetConfigDB();
                break;
            case 'restore-target-config-db':
                this._handleRestoreTargetConfigDB();
                break;
            case 'backup-db':
                this._handleBackupDB();
                break;
            case 'restore-db':
                this._handleRestoreDB();
                break;
            case 'select-language':
                this._handleLanguageSwitch();
                break;
            case 'about':
                this._handleShowAbout();
                break;
            case 'privacy-notice':
                this._handleOpenPrivacyNotice();
                break;
            default:
                this._log('unknown-menu-item', 'warn', { itemId: item.id });
        }
    }

    /**
     * Deploy the active collection to the connected device.
     *
     * Runs the default deployment path without showing an options dialog so the
     * graph can be edited and re-uploaded quickly. `deployCollection` with
     * `force: false` syncs only hash-changed files when the device has a sync
     * manifest, and falls back to a full upload when it does not.
     *
     * The quick action never raises the deploy options dialog: whether host
     * source may shadow a firmware-bundled package is not a toolbar decision.
     * When the firmware's node packages are out of date, the deploy-time consent
     * dialog inside `DeviceDeployment` is the dialog that appears (confirming it
     * uploads the package sources, declining cancels silently). If the
     * fail-closed approval gate blocks the upload instead, the user gets a
     * dialog that names the affected packages and points at the deploy options
     * that can grant the override.
     *
     * The toolbar deploy button is disabled for the duration of the operation so
     * two deployments cannot run concurrently.
     *
     * @private
     */
    async _handleUploadToDevice() {
        this._log('deploy-quick-action-invoked', {
            connected: this._isDeviceConnected(),
            deployInFlight: this._deployInFlight,
        });

        if (!this._isDeviceConnected() || this._deployInFlight) {
            this._log('deploy-quick-action-bailed', {
                connected: this._isDeviceConnected(),
                deployInFlight: this._deployInFlight,
            });
            return;
        }

        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for upload dialog',
            });
            return;
        }

        const deviceDeployment = this.workspace.deviceDeployment;
        if (!deviceDeployment) {
            this._log('no-device-deployment', 'error');
            const errorDialog = new ErrorDialogView({
                title: 'Upload Failed',
                message: 'Device deployment service not available.',
                i18nService: this._i18nService,
                logger: this._logger,
            });
            this._viewManager.showModal(errorDialog);
            return;
        }

        const activeCollection = this.workspace.getActiveCollection();
        if (!activeCollection) {
            this._log('no-active-collection', 'error');
            const errorDialog = new ErrorDialogView({
                title: 'Upload Failed',
                message: 'No active collection to upload.',
                i18nService: this._i18nService,
                logger: this._logger,
            });
            this._viewManager.showModal(errorDialog);
            return;
        }

        this._log('deploy-quick-action-start', {
            collectionId: activeCollection.getId(),
            collectionName: activeCollection.getTitle(),
        });

        this._deployInFlight = true;
        this._updateDeployButtonState();

        try {
            const validation =
                await deviceDeployment.validateCollectionCompatibility(activeCollection);
            if (!validation.compatible) {
                const errorDialog = new ErrorDialogView({
                    title: 'Upload Failed',
                    message: `Collection is not compatible with device:\n\n${validation.errors.join('\n')}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
                return;
            }

            const quickActionOptions = {
                quickAction: true,
                includeFullDefinition: false,
                force: false,
            };
            this._log('deploy-quick-action-calling-deploy', { quickActionOptions });
            await deviceDeployment.deployCollectionInteractive(activeCollection, quickActionOptions);

            this._log('collection-uploaded', {
                id: activeCollection.getId(),
                title: activeCollection.getTitle(),
            });
        } catch (error) {
            // The user already answered the only dialog this quick action may raise (the embedded
            // source override confirmation, raised one layer down in DeviceDeployment): stay quiet
            // and just re-enable the button.
            if (error?.code === 'EMBEDDED_SOURCE_OVERRIDE_DECLINED') {
                this._log('collection-upload-cancelled-by-user', { packageIds: error.packageIds });
                return;
            }

            // The fail-closed approval gate planned a shadow upload for an outdated firmware
            // package but the approval does not cover it. The quick action has no options dialog,
            // so this must not read as a generic upload failure: name the packages and point at
            // the deploy options that can grant the override.
            if (error?.code === 'EMBEDDED_OVERRIDE_APPROVAL_REQUIRED') {
                const packageIds: string[] = Array.isArray(error.packageIds) ? error.packageIds : [];
                this._log('upload-blocked-firmware-package-override', 'warn', {
                    packageIds,
                    missingFileCount: Array.isArray(error.missingPaths)
                        ? error.missingPaths.length
                        : 0,
                });
                const errorDialog = new ErrorDialogView({
                    title: 'Firmware Packages Outdated',
                    message:
                        'The node packages bundled in the device firmware are out of date, so ' +
                        'their source has to be uploaded instead:\n\n' +
                        `${packageIds.length > 0 ? packageIds.join(', ') : 'unknown packages'}\n\n` +
                        'Nothing was uploaded. Deploy again from the Device tab and tick ' +
                        '"Upload firmware package source" in its deploy options.',
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
                return;
            }

            this._log('upload-error', 'error', { error: error.message });
            const errorDialog = new ErrorDialogView({
                title: 'Upload Failed',
                message: `Error during upload: ${error.message}`,
                i18nService: this._i18nService,
                logger: this._logger,
            });
            this._viewManager.showModal(errorDialog);
        } finally {
            this._deployInFlight = false;
            this._updateDeployButtonState();
        }
    }

    /**
     * Handle backup of user target config DB only.
     * @private
     */
    async _handleBackupTargetConfigDB() {
        try {
            if (typeof this.workspace.listUserTargetConfigs !== 'function') {
                throw new Error('Workspace target config API unavailable');
            }

            const userTargetConfigs = await this.workspace.listUserTargetConfigs();
            if (userTargetConfigs.length === 0) {
                this._log('no-target-configs-to-backup', 'warn');
                return;
            }

            this._log('backup-target-config-db-started', {
                targetConfigsCount: userTargetConfigs.length,
            });

            const backup = {
                version: '1.1',
                timestamp: Date.now(),
                exportDate: new Date().toISOString(),
                targetConfigs: {
                    count: userTargetConfigs.length,
                    items: userTargetConfigs,
                },
            };

            const now = new Date();
            const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
            const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
            const filename = `micro-otter-target-config-backup-${dateStr}-${timeStr}.json`;

            const jsonString = JSON.stringify(backup, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this._log('backup-target-config-db-success', {
                filename,
                targetConfigsCount: userTargetConfigs.length,
            });
        } catch (error) {
            this._log('backup-target-config-db-failed', 'error', { error: error.message });

            if (this._viewManager) {
                const errorDialog = new ErrorDialogView({
                    title: 'Target Config Backup Failed',
                    message: `Failed to create target config backup: ${error.message}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        }
    }

    /**
     * Handle restore of user target config DB only.
     * @private
     */
    _handleRestoreTargetConfigDB(): void {
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for target config restore',
            });
            return;
        }

        if (
            typeof this.workspace.clearUserTargetConfigs !== 'function' ||
            typeof this.workspace.saveUserTargetConfig !== 'function'
        ) {
            this._log('target-config-api-unavailable', 'error');
            const errorDialog = new ErrorDialogView({
                title: 'Target Config Restore Failed',
                message: 'Workspace target config API is unavailable.',
                i18nService: this._i18nService,
                logger: this._logger,
            });
            this._viewManager.showModal(errorDialog);
            return;
        }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';

        fileInput.addEventListener('change', async (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) {
                return;
            }

            try {
                const fileContent = await file.text();
                let backupData;

                try {
                    backupData = JSON.parse(fileContent);
                } catch {
                    const errorDialog = new ErrorDialogView({
                        title: 'Invalid Backup File',
                        message:
                            'The selected file is not valid JSON. Please select a valid target config backup file.',
                        i18nService: this._i18nService,
                        logger: this._logger,
                    });
                    this._viewManager.showModal(errorDialog);
                    return;
                }

                const validationError = this._validateTargetConfigBackupData(backupData);
                if (validationError) {
                    const errorDialog = new ErrorDialogView({
                        title: 'Invalid Backup Format',
                        message: validationError,
                        i18nService: this._i18nService,
                        logger: this._logger,
                    });
                    this._viewManager.showModal(errorDialog);
                    return;
                }

                const normalizedBackupData = {
                    version: typeof backupData.version === 'string' ? backupData.version : '1.1',
                    timestamp: backupData.timestamp ?? Date.now(),
                    collections: Array.isArray(backupData.collections)
                        ? backupData.collections
                        : [],
                    targetConfigs: backupData.targetConfigs,
                };

                const restoreDialog = new DBRestoreDialogView({
                    backupData: normalizedBackupData,
                    workspace: this.workspace,
                    viewManager: this._viewManager,
                    restoreScope: 'targetConfigsOnly',
                    title: 'Restore User Target Config DB',
                    i18nService: this._i18nService,
                    logger: this._logger,
                });

                await restoreDialog.initialize();

                restoreDialog.on('confirm', (event) => {
                    const validated = assertAppEventPayloadType(
                        event,
                        'ModalDialogView.Confirm.v1',
                        [
                            { name: 'reason', validate: (value) => typeof value === 'string' },
                            { name: 'id', validate: (value) => typeof value === 'string' },
                        ],
                        'WorkspaceView.targetConfigRestoreDialogConfirmListener'
                    );

                    const detail = validated.detail as unknown as ModalConfirmPayload;
                    this._log('restore-target-config-db-complete', 'info', {
                        mode: detail.mode,
                        results: detail.results,
                    });
                });

                restoreDialog.on('cancel', (event) => {
                    assertAppEventPayloadType(
                        event,
                        'ModalDialogView.Cancel.v1',
                        [
                            { name: 'reason', validate: (value) => typeof value === 'string' },
                            { name: 'id', validate: (value) => typeof value === 'string' },
                        ],
                        'WorkspaceView.targetConfigRestoreDialogCancelListener'
                    );

                    this._log('restore-target-config-db-cancelled', 'info');
                });

                this._viewManager.showModal(restoreDialog);
            } catch (error) {
                this._log('restore-target-config-db-failed', 'error', { error: error.message });
                const errorDialog = new ErrorDialogView({
                    title: 'Target Config Restore Failed',
                    message: `Failed to restore target config backup: ${error.message}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        });

        fileInput.click();
    }

    /**
     * Handle backup entire database.
     * Exports all collections to a single backup JSON file.
     * @private
     */
    async _handleBackupDB() {
        try {
            const collectionIds = this.workspace.getCollectionIds();
            const userTargetConfigs = await this.workspace.listUserTargetConfigs();

            if (collectionIds.length === 0 && userTargetConfigs.length === 0) {
                this._log('no-collections-to-backup', 'warn');
                return;
            }

            this._log('backup-db-started', {
                collectionsCount: collectionIds.length,
                targetConfigsCount: userTargetConfigs.length,
            });

            // Collect all collections data
            const collections = [];
            for (const collectionId of collectionIds) {
                const collection =
                    await this.workspace.collectionManager.getCollectionById(collectionId);
                if (collection) {
                    // Bump version if dirty, then save before backing up
                    let wasBumped = false;
                    if (typeof collection.bumpVersionIfDirty === 'function') {
                        wasBumped = collection.bumpVersionIfDirty() === true;
                    }
                    if (wasBumped) {
                        await this.workspace.saveCollection(collection);
                    }

                    // Serialize to data format
                    const collectionData = collection.toData();
                    collections.push(collectionData);
                }
            }

            // Create backup structure
            const backup = {
                version: '1.1',
                timestamp: Date.now(),
                exportDate: new Date().toISOString(),
                collectionsCount: collections.length,
                collections: collections,
                targetConfigs: {
                    count: userTargetConfigs.length,
                    items: userTargetConfigs,
                },
            };

            // Generate filename
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
            const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
            const filename = `micro-otter-backup-${dateStr}-${timeStr}.json`;

            // Create blob and trigger download
            const jsonString = JSON.stringify(backup, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this._log('backup-db-success', {
                filename,
                collectionsCount: collections.length,
                targetConfigsCount: userTargetConfigs.length,
            });
        } catch (error) {
            this._log('backup-db-failed', 'error', { error: error.message });

            // Show error dialog
            if (this._viewManager) {
                const errorDialog = new ErrorDialogView({
                    title: 'Backup Failed',
                    message: `Failed to create database backup: ${error.message}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        }
    }

    /**
     * Handle restore database from backup.
     * @private
     */
    _handleRestoreDB(): void {
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for restore DB',
            });
            return;
        }

        // Create file input to select backup file
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';

        fileInput.addEventListener('change', async (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) {
                return;
            }

            try {
                // Read and parse the backup file
                const fileContent = await file.text();
                let backupData;

                try {
                    backupData = JSON.parse(fileContent);
                } catch {
                    const errorDialog = new ErrorDialogView({
                        title: 'Invalid Backup File',
                        message:
                            'The selected file is not valid JSON. Please select a valid backup file.',
                        i18nService: this._i18nService,
                        logger: this._logger,
                    });
                    this._viewManager.showModal(errorDialog);
                    return;
                }

                // Validate backup file structure
                const validationError = this._validateBackupData(backupData);
                if (validationError) {
                    const errorDialog = new ErrorDialogView({
                        title: 'Invalid Backup Format',
                        message: validationError,
                        i18nService: this._i18nService,
                        logger: this._logger,
                    });
                    this._viewManager.showModal(errorDialog);
                    return;
                }

                // Show restore dialog
                const restoreDialog = new DBRestoreDialogView({
                    backupData,
                    workspace: this.workspace,
                    viewManager: this._viewManager,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });

                // Initialize the dialog (loads local collection versions)
                await restoreDialog.initialize();

                restoreDialog.on('confirm', (event) => {
                    const validated = assertAppEventPayloadType(
                        event,
                        'ModalDialogView.Confirm.v1',
                        [
                            { name: 'reason', validate: (value) => typeof value === 'string' },
                            { name: 'id', validate: (value) => typeof value === 'string' },
                        ],
                        'WorkspaceView.restoreDialogConfirmListener'
                    );

                    const detail = validated.detail as unknown as ModalConfirmPayload;
                    this._log('restore-complete', 'info', {
                        mode: detail.mode,
                        results: detail.results,
                    });
                });

                restoreDialog.on('cancel', (event) => {
                    assertAppEventPayloadType(
                        event,
                        'ModalDialogView.Cancel.v1',
                        [
                            { name: 'reason', validate: (value) => typeof value === 'string' },
                            { name: 'id', validate: (value) => typeof value === 'string' },
                        ],
                        'WorkspaceView.restoreDialogCancelListener'
                    );

                    this._log('restore-cancelled', 'info');
                });

                this._viewManager.showModal(restoreDialog);
            } catch (error) {
                this._log('restore-file-read-error', 'error', { error: error.message });
                const errorDialog = new ErrorDialogView({
                    title: 'Error Reading File',
                    message: `Failed to read backup file: ${error.message}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        });

        // Trigger file picker
        fileInput.click();
    }

    /**
     * Validate backup data structure.
     * @param {object} data Backup data to validate.
     * @returns {string|null} Error message if invalid, null if valid.
     * @private
     */
    _validateBackupData(data) {
        if (!data || typeof data !== 'object') {
            return 'Backup data must be an object';
        }

        // Check required fields
        const requiredFields = ['version', 'timestamp', 'collections'];
        const missingFields = requiredFields.filter((field) => !data[field]);
        if (missingFields.length > 0) {
            return `Backup file is missing required fields: ${missingFields.join(', ')}`;
        }

        // Check collections is an array
        if (!Array.isArray(data.collections)) {
            return 'Backup collections must be an array';
        }

        const supportedVersions = new Set(['1.0', '1.1']);
        if (typeof data.version === 'string' && !supportedVersions.has(data.version)) {
            return `Unsupported backup version: ${data.version}`;
        }

        // Validate each collection has required fields
        for (let i = 0; i < data.collections.length; i++) {
            const collection = data.collections[i];
            const requiredCollectionFields = [
                'id',
                'title',
                'targetId',
                'deviceRuntimeId',
                'version',
                'graphs',
                'activeGraphIdx',
            ];
            const missingCollectionFields = requiredCollectionFields.filter(
                (field) => collection[field] === undefined
            );
            if (missingCollectionFields.length > 0) {
                return `Collection ${i + 1} is missing fields: ${missingCollectionFields.join(', ')}`;
            }
        }

        if (data.targetConfigs !== undefined) {
            if (!data.targetConfigs || typeof data.targetConfigs !== 'object') {
                return 'Backup targetConfigs must be an object';
            }

            if (!Array.isArray(data.targetConfigs.items)) {
                return 'Backup targetConfigs.items must be an array';
            }

            for (let i = 0; i < data.targetConfigs.items.length; i++) {
                const targetConfig = data.targetConfigs.items[i];
                const requiredTargetFields = [
                    'id',
                    'displayName',
                    'version',
                    'created',
                    'targetData',
                ];
                const missingTargetFields = requiredTargetFields.filter(
                    (field) => targetConfig[field] === undefined
                );
                if (missingTargetFields.length > 0) {
                    return `Target config ${i + 1} is missing fields: ${missingTargetFields.join(', ')}`;
                }
            }
        }

        return null; // Valid
    }

    /**
     * Validate target config backup data structure.
     * @param {object} data Target config backup data to validate.
     * @returns {string|null} Error message if invalid, null if valid.
     * @private
     */
    _validateTargetConfigBackupData(data) {
        if (!data || typeof data !== 'object') {
            return 'Backup data must be an object';
        }

        if (!data.targetConfigs || typeof data.targetConfigs !== 'object') {
            return 'Backup targetConfigs must be an object';
        }

        if (!Array.isArray(data.targetConfigs.items)) {
            return 'Backup targetConfigs.items must be an array';
        }

        const supportedVersions = new Set(['1.0', '1.1']);
        if (
            data.version !== undefined &&
            typeof data.version === 'string' &&
            !supportedVersions.has(data.version)
        ) {
            return `Unsupported backup version: ${data.version}`;
        }

        for (let i = 0; i < data.targetConfigs.items.length; i++) {
            const targetConfig = data.targetConfigs.items[i];
            const requiredTargetFields = ['id', 'displayName', 'version', 'created', 'targetData'];
            const missingTargetFields = requiredTargetFields.filter(
                (field) => targetConfig[field] === undefined
            );
            if (missingTargetFields.length > 0) {
                return `Target config ${i + 1} is missing fields: ${missingTargetFields.join(', ')}`;
            }
        }

        return null;
    }

    /**
     * Handle show about dialog.
     * @private
     */
    _handleShowAbout() {
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for about dialog',
            });
            return;
        }

        const aboutDialog = new AboutDialogView({
            appVersion: this._appVersion,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        aboutDialog.on('close', (event) => {
            assertAppEventPayloadType(
                event,
                'AboutDialogView.Close.v1',
                'WorkspaceView.aboutDialogCloseListener'
            );

            // ViewManager will handle closing the modal
        });

        this._viewManager.showModal(aboutDialog);
    }

    _handleOpenPrivacyNotice() {
        const privacyUrl = '/privacy.html';

        if (typeof window === 'undefined' || typeof window.open !== 'function') {
            this._log('privacy-notice-open-unavailable', 'warn', {
                message: 'window.open is unavailable for privacy notice',
                url: privacyUrl,
            });
            return;
        }

        window.open(privacyUrl, '_blank', 'noopener,noreferrer');
    }

    /**
     * Create a styled icon button.
     * @param {string} icon Icon text/emoji or icon URL (for image icons).
     * @param {string} title Tooltip text.
     * @returns {HTMLButtonElement}
     * @private
     */
    _createIconButton(icon: string, title: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.title = title;
        button.style.padding = '4px';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.backgroundColor = 'transparent';
        button.style.cursor = 'pointer';
        button.style.fontSize = '14px';
        button.style.lineHeight = '1';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.color = '#e7ebff';

        // The icon is either an image source (inlined `data:` URI or served path) or a text glyph.
        if (IconProvider.isImageSource(icon)) {
            const img = document.createElement('img');
            img.src = icon;
            img.style.width = '20px';
            img.style.height = '20px';
            img.style.display = 'block';
            img.style.filter = 'brightness(0) invert(1)';
            button.appendChild(img);
        } else {
            button.textContent = icon;
        }

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = 'transparent';
        });
        return button;
    }

    /**
     * Handle create collection button click.
     * Opens a form dialog to create a new collection.
     * @private
     */
    async _handleCreateCollection() {
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for create collection dialog',
            });
            return;
        }

        const runtimes = this.workspace.listAvailableRuntimes();

        // Default to first runtime for initial target population
        const selectedRuntime = runtimes.length > 0 ? runtimes[0].id : null;
        const targetOptions = selectedRuntime
            ? this.workspace.listTargetsForRuntime(selectedRuntime)
            : [];

        const fields = [
            {
                id: 'name',
                type: 'text',
                label: 'Collection Name',
                required: true,
                placeholder: 'Enter collection name...',
                validator: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Collection name is required';
                    }
                    return true;
                },
            },
            {
                id: 'runtime',
                type: 'dropdown',
                label: 'Device Runtime',
                required: true,
                options: runtimes.map((r) => ({ value: r.id, label: r.name })),
                defaultValue: selectedRuntime,
            },
            {
                id: 'target',
                type: 'dropdown',
                label: 'Target Device',
                required: true,
                options: targetOptions.map((t) => ({ value: t.id, label: t.name })),
                defaultValue: targetOptions.length > 0 ? targetOptions[0].id : null,
            },
        ];

        const dialog = new FormDialogView({
            title: 'Create Collection',
            icon: '➕',
            fields,
            confirmLabel: 'Create',
            cancelLabel: 'Cancel',
        });

        dialog.on('confirm', async (event) => {
            const validated = assertAppEventPayloadType(
                event,
                'ModalDialogView.Confirm.v1',
                [
                    { name: 'reason', validate: (value) => typeof value === 'string' },
                    { name: 'id', validate: (value) => typeof value === 'string' },
                    {
                        name: 'formData',
                        validate: (value) => value && typeof value === 'object',
                    },
                ],
                'WorkspaceView.createCollectionConfirmListener'
            );

            const { formData } = validated.detail as unknown as {
                formData: CreateCollectionFormData;
            };
            try {
                const collection = await this.workspace.createCollection({
                    title: formData.name.trim(),
                    deviceRuntimeId: formData.runtime,
                    targetId: formData.target,
                });

                this._log('collection-created', {
                    id: collection.getId(),
                    title: collection.getTitle(),
                });
            } catch (error) {
                this._log('collection-create-failed', 'error', { error: error.message });
                // Keep dialog open to show error or allow retry
            }
        });

        dialog.on('cancel', (event) => {
            assertAppEventPayloadType(
                event,
                'ModalDialogView.Cancel.v1',
                [
                    { name: 'reason', validate: (value) => typeof value === 'string' },
                    { name: 'id', validate: (value) => typeof value === 'string' },
                ],
                'WorkspaceView.createCollectionCancelListener'
            );

            // ViewManager will close the modal on cancel
        });

        // Show dialog in modal layer
        this._viewManager.showModal(dialog);

        // After attach, wire up runtime change to update targets using public API
        dialog.on('afterAttach', (event) => {
            assertAppEventPayloadType(
                event,
                'ViewBase.Attach.v1',
                [{ name: 'container', validate: (value) => value instanceof HTMLElement }],
                'WorkspaceView.createCollectionAfterAttachListener'
            );

            const updateTargets = (runtimeId) => {
                const newTargets = this.workspace.listTargetsForRuntime(runtimeId);
                const options = newTargets.map((target) => ({
                    value: target.id,
                    label: target.name,
                }));
                const selectedValue = options.length > 0 ? options[0].value : '';
                dialog.setDropdownOptions('target', options, {
                    includeEmpty: options.length === 0,
                    selectedValue,
                });
            };

            dialog.onFieldChange('runtime', ({ value }) => {
                updateTargets(value);
            });

            const initialRuntime = dialog.getFieldValue('runtime');
            if (initialRuntime) {
                updateTargets(initialRuntime);
            }
        });
    }

    /**
     * Handle delete collection button click.
     * Shows confirmation dialog before deletion. For the last collection,
     * creates a new one before deleting to ensure at least one remains.
     * @private
     */
    async _handleDeleteCollection() {
        this._log('delete-collection-clicked', 'info');

        const collectionIds = this.workspace.getCollectionIds();
        if (collectionIds.length === 0) {
            this._log('no-collections-to-delete', 'warn');
            return;
        }

        const activeCollection = this.workspace.getActiveCollection();
        const collectionTitle = activeCollection?.getTitle?.() || 'this collection';
        const collectionId = activeCollection?.getId();

        if (!collectionId) {
            this._log('no-active-collection', 'warn');
            return;
        }

        // Check if ViewManager is available
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for delete confirmation',
            });
            return;
        }

        const isLastCollection = collectionIds.length === 1;

        let confirmMessage = `Are you sure you want to delete "${collectionTitle}"?\n\nThis action cannot be undone. All nodes and connections will be permanently deleted.`;
        let confirmLabel = 'Delete';

        if (isLastCollection) {
            confirmMessage = `You are about to delete the last collection "${collectionTitle}".\n\nA new empty collection will be created automatically before deletion to ensure at least one collection remains.\n\nDo you want to proceed?`;
            confirmLabel = 'Delete & Create New';
        }

        // Create and show confirmation dialog
        const dialog = new ConfirmationDialogView({
            title: 'Delete Collection',
            message: confirmMessage,
            confirmLabel: confirmLabel,
            cancelLabel: 'Cancel',
            destructive: true,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Show modal and wait for result
        this._viewManager.showModal(dialog);

        // Wait for user response
        const confirmed = await new Promise((resolve) => {
            dialog.on('confirm', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Confirm.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'WorkspaceView.deleteCollectionConfirmListener'
                );
                resolve(true);
            });
            dialog.on('cancel', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Cancel.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'WorkspaceView.deleteCollectionCancelListener'
                );
                resolve(false);
            });
            dialog.on('close', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'WorkspaceView.deleteCollectionCloseListener'
                );
                resolve(false);
            });
        });

        if (!confirmed) {
            this._log('delete-cancelled');
            return;
        }

        try {
            // If this is the last collection, create a new one first
            if (isLastCollection) {
                const runtimes = this.workspace.listAvailableRuntimes();
                if (runtimes.length === 0) {
                    throw new Error('No device runtimes available to create new collection.');
                }

                const defaultRuntime = runtimes[0].id;
                const targets = this.workspace.listTargetsForRuntime(defaultRuntime);
                const defaultTarget = targets.length > 0 ? targets[0].id : null;

                if (!defaultTarget) {
                    throw new Error('No targets available for default runtime.');
                }

                // Create new collection with default name
                const newCollection = await this.workspace.createCollection({
                    title: 'New Collection',
                    deviceRuntimeId: defaultRuntime,
                    targetId: defaultTarget,
                });

                this._log('new-collection-created-before-delete', 'info', {
                    newId: newCollection.getId(),
                    runtime: defaultRuntime,
                    target: defaultTarget,
                });

                // Ensure the new collection is active before deleting the old one
                await this.workspace.setActiveCollectionId(newCollection.getId());
            }

            // Now delete the original collection
            await this.workspace.deleteCollection(collectionId);
            this._log('collection-deleted', 'info', { id: collectionId });

            // UI will update via workspace change events
        } catch (error) {
            this._log('delete-error', 'error', {
                error: error.message,
                stack: error.stack,
            });

            // Show error dialog
            try {
                const errorDialog = new ErrorDialogView({
                    title: 'Delete Failed',
                    message: `Failed to delete collection: ${error.message}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            } catch (dialogError) {
                this._log('error-dialog-failed', 'error', {
                    originalError: error.message,
                    dialogError: dialogError.message,
                    dialogStack: dialogError.stack,
                });
                // Fallback to console if dialog fails
                console.error('Failed to show error dialog:', dialogError);
                console.error('Original error:', error);
            }
        }
    }

    /**
     * Handle export collection button click.
     * Saves the collection (bumping version if needed), then serializes to JSON and triggers download.
     * @private
     */
    async _handleExportCollection() {
        const activeCollection = this.workspace.getActiveCollection();
        if (!activeCollection) {
            this._log('export-no-active-collection', 'error');
            return;
        }

        try {
            // Bump version if dirty, then save before exporting
            let wasBumped = false;
            if (typeof activeCollection.bumpVersionIfDirty === 'function') {
                wasBumped = activeCollection.bumpVersionIfDirty() === true;
            }
            if (wasBumped) {
                await this.workspace.saveActiveCollection();
            }

            const collectionData = activeCollection.toData();
            const jsonString = JSON.stringify(collectionData, null, 2);

            // Create filename: collection-title-vX.Y.Z.json
            const title = activeCollection.getTitle() || 'collection';
            const safeTitle = title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            const version = activeCollection.getVersionString().replace(/\*/g, ''); // Remove dirty flag
            const filename = `${safeTitle}-v${version}.json`;

            // Create blob and trigger download
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this._log('collection-exported', {
                id: activeCollection.getId(),
                filename,
                version: activeCollection.getVersion()?.toString(),
            });
        } catch (error) {
            this._log('export-failed', 'error', { error: error.message });

            // Show error dialog
            if (this._viewManager) {
                const errorDialog = new ErrorDialogView({
                    title: 'Export Failed',
                    message: `Failed to export collection: ${error.message}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        }
    }

    /**
     * Handle import collection button click.
     * Opens file dialog to import a collection from JSON.
     * @private
     */
    async _handleImportCollection() {
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for import collection dialog',
            });
            return;
        }

        // Create file input directly
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', async (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) {
                return;
            }

            try {
                // Read file
                const text = await file.text();
                const fileData = JSON.parse(text);

                // Process the imported file
                await this._processImportedCollection(fileData);
            } catch (error) {
                this._log('import-failed', 'error', { error: error.message });
                if (this._viewManager) {
                    const errorDialog = new ErrorDialogView({
                        title: 'Import Failed',
                        message: `Failed to import the collection: ${error.message || String(error)}`,
                        i18nService: this._i18nService,
                        logger: this._logger,
                    });
                    this._viewManager.showModal(errorDialog);
                }
            } finally {
                // Clean up
                document.body.removeChild(fileInput);
            }
        });

        // Add to document and trigger click
        document.body.appendChild(fileInput);
        fileInput.click();
    }

    _parseJsoncContent(content: string): Record<string, unknown> {
        if (typeof content !== 'string') {
            throw new Error('Target config file content must be text.');
        }

        let inString = false;
        let stringQuote = '';
        let escaped = false;
        let inLineComment = false;
        let inBlockComment = false;
        let withoutComments = '';

        for (let index = 0; index < content.length; index++) {
            const char = content[index];
            const nextChar = content[index + 1];

            if (inLineComment) {
                if (char === '\n') {
                    inLineComment = false;
                    withoutComments += char;
                }
                continue;
            }

            if (inBlockComment) {
                if (char === '*' && nextChar === '/') {
                    inBlockComment = false;
                    index++;
                }
                continue;
            }

            if (inString) {
                withoutComments += char;
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (char === '\\') {
                    escaped = true;
                    continue;
                }
                if (char === stringQuote) {
                    inString = false;
                    stringQuote = '';
                }
                continue;
            }

            if (char === '"' || char === "'") {
                inString = true;
                stringQuote = char;
                withoutComments += char;
                continue;
            }

            if (char === '/' && nextChar === '/') {
                inLineComment = true;
                index++;
                continue;
            }

            if (char === '/' && nextChar === '*') {
                inBlockComment = true;
                index++;
                continue;
            }

            withoutComments += char;
        }

        const withoutTrailingCommas = withoutComments.replace(/,\s*(\}|\])/g, '$1');
        const parsed = JSON.parse(withoutTrailingCommas);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Target config root must be a JSON object.');
        }
        return parsed as Record<string, unknown>;
    }

    _buildTargetConfigTemplateJsonc(): string {
        const today = new Date().toISOString().split('T')[0];
        return `{
    // A derived user target: a shipped base plus sparse overrides.
    "id": "my_esp32_wroom",
    "displayName": "My ESP32-WROOM",
    "version": "1.0.0",
    "created": "${today}",
    "baseTargetId": "esp32_wroom",

    // Sparse overrides merged onto the base (null removes a pin).
    "targetData": {
        "pinCapabilities": {
            "5": null
        },
        "metadata": {
            "notes": ["Overrides the ESP32-WROOM base: pin 5 removed."]
        }
    }
}
`;
    }

    _awaitConfirmationDialogDecision(dialog: ConfirmationDialogView, listenerContext: string) {
        return new Promise<boolean>((resolve) => {
            dialog.on('confirm', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Confirm.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    `${listenerContext}.confirm`
                );
                resolve(true);
            });

            dialog.on('cancel', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Cancel.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    `${listenerContext}.cancel`
                );
                resolve(false);
            });

            dialog.on('close', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    `${listenerContext}.close`
                );
                resolve(false);
            });
        });
    }

    async _showTargetConfigConflictDialog(conflict) {
        if (!this._viewManager) {
            return false;
        }

        const conflictTypeLabel =
            conflict?.type === 'displayName'
                ? this._i18nService
                    ? this.t('workspace.targetConfig.conflict.conflictTypeDisplayName')
                    : 'display name'
                : this._i18nService
                  ? this.t('workspace.targetConfig.conflict.conflictTypeId')
                  : 'id';
        const incomingId = conflict?.incoming?.id || 'unknown';
        const incomingDisplayName = conflict?.incoming?.displayName || incomingId;
        const incomingVersion = conflict?.incoming?.version || 'unknown';
        const existingId = conflict?.existing?.id || 'unknown';
        const existingDisplayName = conflict?.existing?.displayName || existingId;
        const existingVersion = conflict?.existing?.version || 'unknown';

        const message = this._i18nService
            ? this.t('workspace.targetConfig.conflict.message', {
                  conflictType: conflictTypeLabel,
              })
            : `A target config with the same ${conflictTypeLabel} already exists.`;
        const detail = this._i18nService
            ? this.t('workspace.targetConfig.conflict.detail', {
                  incomingDisplayName,
                  incomingId,
                  incomingVersion,
                  existingDisplayName,
                  existingId,
                  existingVersion,
              })
            : `Incoming: ${incomingDisplayName} (id: ${incomingId}, version: ${incomingVersion})\n` +
              `Existing: ${existingDisplayName} (id: ${existingId}, version: ${existingVersion})\n\n` +
              'Do you want to overwrite the existing target config?';

        const dialog = new ConfirmationDialogView({
            title: this._i18nService
                ? this.t('workspace.targetConfig.conflict.title')
                : 'Target Config Conflict',
            message,
            detail,
            confirmLabel: this._i18nService
                ? this.t('workspace.targetConfig.conflict.confirm')
                : 'Overwrite',
            cancelLabel: this._i18nService
                ? this.t('workspace.targetConfig.conflict.cancel')
                : 'Cancel',
            destructive: true,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        const decisionPromise = this._awaitConfirmationDialogDecision(
            dialog,
            'WorkspaceView.targetConfigConflictDialog'
        );
        this._viewManager.showModal(dialog);
        return decisionPromise;
    }

    _showTargetConfigUploadSuccessDialog(saved) {
        if (!this._viewManager) {
            return;
        }

        const displayName = saved?.displayName || saved?.id || 'target config';
        const targetId = saved?.id || 'unknown';
        const message = this._i18nService
            ? this.t('workspace.targetConfig.uploadSuccess.message', {
                  displayName,
              })
            : `"${displayName}" has been uploaded successfully.`;
        const detail = this._i18nService
            ? this.t('workspace.targetConfig.uploadSuccess.detail', {
                  targetId,
              })
            : `Target id: ${targetId}. It is now available in target selection.`;

        const dialog = new ConfirmationDialogView({
            title: this._i18nService
                ? this.t('workspace.targetConfig.uploadSuccess.title')
                : 'Target Config Uploaded',
            message,
            detail,
            confirmLabel: this._i18nService ? this.t('dialog.ok') : 'OK',
            showCancel: false,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        this._viewManager.showModal(dialog);
    }

    async _handleUploadTargetConfig(): Promise<void> {
        if (!this._viewManager) {
            this._log('no-view-manager', 'error', {
                message: 'ViewManager not available for target config upload dialog',
            });
            return;
        }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,.jsonc,application/json';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', async (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) {
                return;
            }

            try {
                const text = await file.text();
                const parsed = this._parseJsoncContent(text);

                let inputRecord: Record<string, unknown>;
                if (parsed.targetData && typeof parsed.targetData === 'object') {
                    inputRecord = parsed;
                } else {
                    const targetId =
                        (typeof parsed.id === 'string' && parsed.id) ||
                        (typeof parsed.targetId === 'string' && parsed.targetId) ||
                        'custom_target';

                    inputRecord = {
                        id: targetId,
                        displayName:
                            (typeof parsed.displayName === 'string' && parsed.displayName) ||
                            targetId,
                        version: (typeof parsed.version === 'string' && parsed.version) || '1.0.0',
                        created:
                            (typeof parsed.created === 'string' && parsed.created) ||
                            new Date().toISOString().split('T')[0],
                        targetData: parsed,
                    };
                }

                let allowOverwrite = false;
                if (typeof this.workspace.getUserTargetConfigConflictDetails === 'function') {
                    const conflict =
                        await this.workspace.getUserTargetConfigConflictDetails(inputRecord);
                    if (conflict) {
                        allowOverwrite = await this._showTargetConfigConflictDialog(conflict);
                        if (!allowOverwrite) {
                            this._log('target-config-upload-cancelled', 'info', {
                                id: conflict.incoming?.id,
                                displayName: conflict.incoming?.displayName,
                            });
                            return;
                        }
                    }
                }

                const saved = await this.workspace.saveUserTargetConfig(inputRecord, {
                    allowOverwrite,
                });

                this._log('target-config-uploaded', 'info', {
                    id: saved.id,
                    displayName: saved.displayName,
                });

                this._showTargetConfigUploadSuccessDialog(saved);
            } catch (error) {
                this._log('target-config-upload-failed', 'error', {
                    error: error?.message || String(error),
                });

                const errorDialog = new ErrorDialogView({
                    title: 'Target Config Upload Failed',
                    message: `Failed to upload target config: ${error?.message || String(error)}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            } finally {
                document.body.removeChild(fileInput);
            }
        });

        document.body.appendChild(fileInput);
        fileInput.click();
    }

    _handleDownloadTargetConfigTemplate(): void {
        try {
            const template = this._buildTargetConfigTemplateJsonc();
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
            const filename = `micro-otter-target-config-template-${dateStr}.jsonc`;

            const blob = new Blob([template], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this._log('target-config-template-downloaded', 'info', { filename });
        } catch (error) {
            this._log('target-config-template-download-failed', 'error', {
                error: error?.message || String(error),
            });

            if (this._viewManager) {
                const errorDialog = new ErrorDialogView({
                    title: 'Template Download Failed',
                    message: `Failed to download target config template: ${error?.message || String(error)}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        }
    }

    _buildRuntimeTargetConfigExportPayload(targetInfo, targetId: string): Record<string, unknown> {
        const pinCapabilities: Record<string, unknown> = {};
        if (targetInfo?.pinCapabilities instanceof Map) {
            for (const [pinId, pin] of targetInfo.pinCapabilities.entries()) {
                pinCapabilities[String(pinId)] = {
                    label: pin?.label || `Pin ${pinId}`,
                    aliases: Array.isArray(pin?.aliases) ? [...pin.aliases] : [],
                    digital: {
                        input: Boolean(pin?.digital?.input),
                        output: Boolean(pin?.digital?.output),
                    },
                    pull: Array.isArray(pin?.pull) ? [...pin.pull] : [],
                    pwm: pin?.pwm
                        ? {
                              input: Boolean(pin.pwm.input),
                              output: Boolean(pin.pwm.output),
                              frequency_hz: pin.pwm.frequency_hz
                                  ? {
                                        min:
                                            typeof pin.pwm.frequency_hz.min === 'number'
                                                ? pin.pwm.frequency_hz.min
                                                : null,
                                        max:
                                            typeof pin.pwm.frequency_hz.max === 'number'
                                                ? pin.pwm.frequency_hz.max
                                                : null,
                                    }
                                  : null,
                          }
                        : null,
                    adc: pin?.adc ? { ...pin.adc } : null,
                    uart: pin?.uart
                        ? {
                              port: pin.uart.port || null,
                              roles: Array.isArray(pin.uart.roles) ? [...pin.uart.roles] : [],
                          }
                        : null,
                    i2c: pin?.i2c
                        ? {
                              bus: pin.i2c.bus || null,
                              roles: Array.isArray(pin.i2c.roles) ? [...pin.i2c.roles] : [],
                              ...(pin.i2c.frequency_hz
                                  ? {
                                        frequency_hz: {
                                            min:
                                                typeof pin.i2c.frequency_hz.min === 'number'
                                                    ? pin.i2c.frequency_hz.min
                                                    : null,
                                            max:
                                                typeof pin.i2c.frequency_hz.max === 'number'
                                                    ? pin.i2c.frequency_hz.max
                                                    : null,
                                        },
                                    }
                                  : {}),
                          }
                        : null,
                    spi: pin?.spi
                        ? {
                              bus: pin.spi.bus || null,
                              roles: Array.isArray(pin.spi.roles) ? [...pin.spi.roles] : [],
                          }
                        : null,
                    notes: Array.isArray(pin?.notes) ? [...pin.notes] : [],
                };
            }
        }

        return {
            id: targetId,
            targetId,
            displayName: targetInfo?.displayName || targetId,
            description: targetInfo?.description || null,
            generalCapabilities: targetInfo?.generalCapabilities || {},
            metadata: targetInfo?.metadata || {},
            instanceData: targetInfo?.instanceData || {},
            pinCapabilities,
            capabilityToPins: targetInfo?.capabilityToPins || {},
        };
    }

    async _handleDownloadCurrentTargetConfig(): Promise<void> {
        try {
            const activeCollection = this.workspace.getActiveCollection();
            if (!activeCollection) {
                throw new Error('No active collection available for target config export.');
            }

            const targetId = activeCollection.getTargetId();
            const runtimeId = activeCollection.getDeviceRuntimeId();

            if (!targetId) {
                throw new Error('Active collection has no target id.');
            }

            const userTargetRecord =
                typeof this.workspace.getUserTargetConfig === 'function'
                    ? await this.workspace.getUserTargetConfig(targetId)
                    : null;

            let payload: Record<string, unknown>;
            let source: 'user' | 'runtime' = 'runtime';
            if (userTargetRecord) {
                source = 'user';
                payload = {
                    id: userTargetRecord.id,
                    displayName: userTargetRecord.displayName,
                    version: userTargetRecord.version,
                    created: userTargetRecord.created,
                    targetData: userTargetRecord.targetData,
                };
            } else {
                const runtime = this.workspace.runtimeCollection?.getRuntime(runtimeId);
                if (!runtime) {
                    throw new Error(`Runtime not found for active collection: ${runtimeId}`);
                }

                const runtimeTarget = runtime.getDeviceTarget(targetId);
                if (!runtimeTarget) {
                    throw new Error(
                        `Target '${targetId}' was not found in runtime '${runtimeId}' or user target configs.`
                    );
                }

                const targetData = this._buildRuntimeTargetConfigExportPayload(
                    runtimeTarget,
                    targetId
                );
                payload = {
                    id: targetId,
                    displayName: runtimeTarget.displayName || targetId,
                    version: '1.0.0',
                    created: new Date().toISOString().split('T')[0],
                    targetData,
                };
            }

            const jsonString = JSON.stringify(payload, null, 2);
            const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const safeTargetId = targetId.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            const filename = `micro-otter-target-config-${safeTargetId}-${dateStr}.json`;

            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this._log('current-target-config-downloaded', 'info', {
                targetId,
                runtimeId,
                source,
                filename,
            });
        } catch (error) {
            this._log('current-target-config-download-failed', 'error', {
                error: error?.message || String(error),
            });

            if (this._viewManager) {
                const errorDialog = new ErrorDialogView({
                    title: 'Target Config Download Failed',
                    message: `Failed to download current target config: ${error?.message || String(error)}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        }
    }

    /**
     * Process imported collection data.
     * @param {Object} fileData Parsed JSON data.
     * @private
     */
    async _processImportedCollection(fileData) {
        const processImport = async ({ fileData }) => {
            try {
                // Validate that fileData looks like a collection
                if (!fileData || typeof fileData !== 'object') {
                    throw new Error('Invalid collection data: not an object');
                }

                if (!fileData.id || !fileData.title) {
                    throw new Error('Invalid collection data: missing required fields (id, title)');
                }

                // Check if deviceRuntimeId is present and valid
                const importedRuntimeId = fileData.deviceRuntimeId;
                if (!importedRuntimeId) {
                    if (this._viewManager) {
                        const errorDialog = new ErrorDialogView({
                            title: 'Invalid Collection',
                            message:
                                'The imported collection does not specify a device runtime. This collection cannot be imported. Device runtime information is required.',
                            i18nService: this._i18nService,
                            logger: this._logger,
                        });
                        this._viewManager.showModal(errorDialog);
                    }
                    return;
                }

                // Check if the runtime is available in the workspace
                const availableRuntimes = this.workspace.listAvailableRuntimes();
                const runtimeExists = availableRuntimes.some((r) => r.id === importedRuntimeId);

                if (!runtimeExists) {
                    const runtimeList = availableRuntimes.map((r) => r.name).join(', ');
                    if (this._viewManager) {
                        const errorDialog = new ErrorDialogView({
                            title: 'Incompatible Runtime',
                            message: `The collection requires device runtime "${importedRuntimeId}" which is not available.\n\nAvailable runtimes: ${runtimeList}`,
                            i18nService: this._i18nService,
                            logger: this._logger,
                        });
                        this._viewManager.showModal(errorDialog);
                    }
                    return;
                }

                // Check if targetId is valid for the runtime
                const importedTargetId = fileData.targetId;
                const availableTargets = this.workspace.listTargetsForRuntime(importedRuntimeId);
                const targetExists = availableTargets.some((t) => t.id === importedTargetId);

                if (!targetExists) {
                    const targetList = availableTargets.map((t) => t.name).join(', ');
                    if (this._viewManager) {
                        const errorDialog = new ErrorDialogView({
                            title: 'Incompatible Target',
                            message: `The collection requires target "${importedTargetId}" which is not available for runtime "${importedRuntimeId}".\n\nAvailable targets: ${targetList}`,
                            i18nService: this._i18nService,
                            logger: this._logger,
                        });
                        this._viewManager.showModal(errorDialog);
                    }
                    return;
                }

                // Check for ID collision
                const existingCollectionIds = this.workspace.getCollectionIds();
                if (existingCollectionIds.includes(fileData.id)) {
                    // Show confirmation dialog for overwrite
                    await this._handleImportCollision(fileData);
                } else {
                    // No collision, create the collection
                    await this._importCollection(fileData);
                }
            } catch (error) {
                this._log('import-failed', 'error', { error: error.message });
                if (this._viewManager) {
                    const errorDialog = new ErrorDialogView({
                        title: 'Import Failed',
                        message: `Failed to import the collection: ${error.message || String(error)}`,
                        i18nService: this._i18nService,
                        logger: this._logger,
                    });
                    this._viewManager.showModal(errorDialog);
                }
            }
        };

        await processImport({ fileData });
    }

    /**
     * Handle import collision by showing version comparison dialog.
     * @param {Object} importedData The imported collection data.
     * @private
     */
    async _handleImportCollision(importedData) {
        if (!this._viewManager) {
            this._log('no-view-manager', { level: 'warn' });
            return;
        }

        const existingCollection = this.workspace.collections.get(importedData.id);
        const existingVersion = existingCollection?.getVersion?.()?.toString() || '0.0.0';

        // Format imported version from the version object structure
        let importedVersion = '0.0.0';
        if (importedData.version && typeof importedData.version === 'object') {
            const { major = 0, minor = 0, patch = 0, dirty } = importedData.version;
            const isDirty = dirty && (dirty.major || dirty.minor || dirty.patch);
            const flag = isDirty ? '*' : '';
            importedVersion = `${major}.${minor}.${patch}${flag}`;
        }

        const message = `A collection with ID "${importedData.id}" already exists.\n\nExisting version: ${existingVersion}\nImported version: ${importedVersion}\n\nDo you want to overwrite the existing collection?`;

        // Create and show confirmation dialog
        const dialog = new ConfirmationDialogView({
            title: 'Collection Already Exists',
            message: message,
            confirmLabel: 'Overwrite',
            cancelLabel: 'Cancel',
            destructive: true,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Show modal and wait for result
        this._viewManager.showModal(dialog);

        // Wait for user response
        const confirmed = await new Promise((resolve) => {
            dialog.on('confirm', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Confirm.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'WorkspaceView.importCollisionConfirmListener'
                );
                resolve(true);
            });
            dialog.on('cancel', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Cancel.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'WorkspaceView.importCollisionCancelListener'
                );
                resolve(false);
            });
            dialog.on('close', (event) => {
                assertAppEventPayloadType(
                    event,
                    'ModalDialogView.Close.v1',
                    [
                        { name: 'reason', validate: (value) => typeof value === 'string' },
                        { name: 'id', validate: (value) => typeof value === 'string' },
                    ],
                    'WorkspaceView.importCollisionCloseListener'
                );
                resolve(false);
            });
        });

        if (confirmed) {
            try {
                // Delete existing collection and import new one
                await this.workspace.deleteCollection(importedData.id);
                await this._importCollection(importedData);
            } catch (error) {
                this._log('overwrite-error', 'error', { error: error.message });
                const errorDialog = new ErrorDialogView({
                    title: 'Import Failed',
                    message: `Failed to overwrite collection: ${error.message}`,
                    i18nService: this._i18nService,
                    logger: this._logger,
                });
                this._viewManager.showModal(errorDialog);
            }
        }
    }

    /**
     * Import a collection from data object.
     * @param {Object} collectionData The collection data to import.
     * @private
     */
    async _importCollection(collectionData) {
        try {
            const collection = Collection.fromData(collectionData);
            await this.workspace.saveCollection(collection);
            await this.workspace.setActiveCollectionId(collection.getId());
            this._log('collection-imported', {
                id: collection.getId(),
                title: collection.getTitle(),
            });
        } catch (error) {
            this._log('import-collection-failed', 'error', { error: error.message });
            throw error;
        }
    }

    /**
     * Subscribe to workspace change events to keep UI in sync.
     */
    _subscribeToWorkspaceChanges() {
        this._unsubscribeWorkspace = this.workspace.on('*', (event) => {
            if (event.name === 'activeCollectionChanged') {
                assertAppEventPayloadType(
                    event,
                    'Workspace.ActiveCollectionChanged.v1',
                    'WorkspaceView workspace listener'
                );
                this._populateCollectionDropdown();
                this._updateVersionDisplay();
                this._updateDeployButtonState();
                this._updateUndoRedoButtonStates();
                this._setupHistoryListeners(); // Re-subscribe to new collection's history
            } else if (event.name === 'collectionCreated' || event.name === 'collectionDeleted') {
                const expectedPayloadTypeId =
                    event.name === 'collectionCreated'
                        ? 'Workspace.CollectionCreated.v1'
                        : 'Workspace.CollectionDeleted.v1';
                assertAppEventPayloadType(
                    event,
                    expectedPayloadTypeId,
                    'WorkspaceView workspace listener'
                );
                this._populateCollectionDropdown();
                this._updateVersionDisplay();
                this._updateDeployButtonState();
                this._updateUndoRedoButtonStates();
            } else if (event.name === 'collectionChanged') {
                assertAppEventPayloadType(
                    event,
                    'Workspace.CollectionChanged.v1',
                    'WorkspaceView workspace listener'
                );
                // Handle collection property changes (title, version, etc.)
                const changeType = event.detail.changeType;
                if (changeType === 'title') {
                    // Refresh dropdown to show updated collection title
                    this._populateCollectionDropdown();
                } else if (changeType === 'version') {
                    // Refresh version display if active collection's version changed
                    const activeCollectionId = this.workspace.getActiveCollectionId();
                    if (event.detail.collectionId === activeCollectionId) {
                        this._updateVersionDisplay();
                    }
                } else if (changeType === 'targetId' || changeType === 'deviceRuntimeId') {
                    const activeCollectionId = this.workspace.getActiveCollectionId();
                    if (event.detail.collectionId === activeCollectionId) {
                        this._updateVersionDisplay();
                    }
                }
            }
        });
    }

    /**
     * Setup listeners for history changes to update button states.
     * @private
     */
    _setupHistoryListeners() {
        // Unsubscribe from previous collection's history if any
        if (this._historyChangeListener && typeof this._historyChangeListener === 'function') {
            this._historyChangeListener();
            this._historyChangeListener = null;
        }

        const activeCollection = this.workspace.getActiveCollection();
        if (!activeCollection) {
            return;
        }

        // Listen for any collection changes to update button states
        this._historyChangeListener = activeCollection.on('*', () => {
            this._updateUndoRedoButtonStates();
        });
    }

    /**
     * Setup keyboard shortcuts for undo/redo.
     * @private
     */
    _setupKeyboardShortcuts() {
        // Only set up once
        if (this._keyboardShortcutHandler) {
            return;
        }

        this._keyboardShortcutHandler = (event) => {
            // Only handle if workspace view is attached
            if (!this.container || !document.body.contains(this.container)) {
                return;
            }

            // Ctrl+Z or Cmd+Z for undo
            if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
                event.preventDefault();
                this._handleUndo();
            }

            // Ctrl+Y or Cmd+Y or Ctrl+Shift+Z for redo
            if (
                (event.ctrlKey || event.metaKey) &&
                (event.key === 'y' || (event.key === 'z' && event.shiftKey))
            ) {
                event.preventDefault();
                this._handleRedo();
            }
        };

        window.addEventListener('keydown', this._keyboardShortcutHandler);
    }

    /**
     * Handle undo action.
     * @private
     */
    _handleUndo() {
        const activeCollection = this.workspace.getActiveCollection();
        if (!activeCollection) {
            return;
        }

        const historyManager = activeCollection.getHistoryManager();
        if (!historyManager) {
            return;
        }

        const success = historyManager.undo();
        if (success) {
            this._log('undo-executed', 'info');
        }
        this._updateUndoRedoButtonStates();
    }

    /**
     * Handle redo action.
     * @private
     */
    _handleRedo() {
        const activeCollection = this.workspace.getActiveCollection();
        if (!activeCollection) {
            return;
        }

        const historyManager = activeCollection.getHistoryManager();
        if (!historyManager) {
            return;
        }

        const success = historyManager.redo();
        if (success) {
            this._log('redo-executed', 'info');
        }
        this._updateUndoRedoButtonStates();
    }

    /**
     * Update undo/redo button states based on history.
     * @private
     */
    _updateUndoRedoButtonStates() {
        if (!this._undoButton || !this._redoButton) {
            return;
        }

        const activeCollection = this.workspace.getActiveCollection();
        const historyManager = activeCollection?.getHistoryManager();

        if (!historyManager) {
            // Disable buttons if no history manager
            this._undoButton.disabled = true;
            this._undoButton.style.opacity = '0.4';
            this._redoButton.disabled = true;
            this._redoButton.style.opacity = '0.4';
            return;
        }

        // Update undo button
        const canUndo = historyManager.canUndo();
        this._undoButton.disabled = !canUndo;
        this._undoButton.style.opacity = canUndo ? '1' : '0.4';

        // Update redo button
        const canRedo = historyManager.canRedo();
        this._redoButton.disabled = !canRedo;
        this._redoButton.style.opacity = canRedo ? '1' : '0.4';
    }

    /** @returns {object} JSON-friendly representation. */
    serialize(): ReturnType<ViewBase['serialize']> {
        return {
            ...super.serialize(),
            type: 'WorkspaceView',
        };
    }

    /**
     * Rehydrate a WorkspaceView from serialized data.
     * Note: workspace instance must be provided externally during app initialization.
     * @param {object} data Serialized view data.
     * @param {Function} [viewFactory] View factory for child views.
     * @param {object} [context] Context with workspace, viewManager, i18nService and logger.
     * @returns {WorkspaceView}
     */
    static deserialize(
        data: WorkspaceViewSerialized = {},
        viewFactory: ((...args: unknown[]) => unknown) | null = null,
        context: WorkspaceViewDeserializeContext = {}
    ): WorkspaceView {
        void viewFactory;
        const { title = 'Workspace', icon = null, id = null } = data;
        const { workspace = null, viewManager = null, i18nService = null, logger = null } = context;
        if (!workspace) {
            throw new Error('WorkspaceView.deserialize requires workspace in context');
        }
        return new WorkspaceView({ workspace, viewManager, title, icon, id, logger, i18nService });
    }
}
