// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * DeviceDeployment - Main Orchestrator
 *
 * Coordinates device deployment operations across runtime and collection phases.
 * Manages device state, connection events, and delegates phase-specific operations
 * to RuntimeDeployment and CollectionDeployment specialists.
 *
 * Architecture:
 * - Phase 1: Basic file operations (handled by DeviceConnection)
 * - Phase 2: Runtime installation/upgrade (delegated to RuntimeDeployment)
 * - Phase 3: Collection deployment (delegated to CollectionDeployment)
 */

import { RuntimeDeployment } from './runtime-deployment.js';
import { CollectionDeployment } from './collection-deployment.js';
import {
    calculateFileHash,
    resolveFirmwareBundledPackageIds,
    resolveFrozenAddonVersions,
} from './deployment-utils.js';
import { ProgressTracker } from '../core/progress-events.js';
import { DeviceState } from '../data/device-state.js';
import type { EffectiveInventorySummary, EmbeddedInventory } from '../data/device-state.js';
import { addonModuleRoot, isPackageModulePath } from '../data/module-namespace.js';
import { DeviceTargetInfo } from '../data/device-target.js';
import { isTargetCompatibleWithImage } from '../data/target-compatibility.js';
import { isCompleteActiveTargetPayload } from '../data/target-payload.js';
import { isFunctionGraphManagedNodeType } from '../data/graph-function-nodes.js';
import {
    evaluateRequiredCapabilities,
    resolveNodeCapabilityRequirements,
} from '../core/capability-requirements.js';
import { AppPayload } from '../core/app-event.js';
import {
    normalizeBootstrapSetupApplyPayload,
    type BootstrapSetupApplyPayload,
} from './bootstrap-setup-contract.js';
import {
    resolveFirmwareModulePlan,
    type FirmwareModulePlan,
    type ShadowPackageState,
} from './embedded-module-plan.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LooseRecord = Record<string, any>;

type RuntimeDeploymentConnectionType = ConstructorParameters<
    typeof RuntimeDeployment
>[0]['deviceConnection'];
type CollectionDeploymentConnectionType = ConstructorParameters<
    typeof CollectionDeployment
>[0]['deviceConnection'];
type RuntimeDeploymentRuntimeCollectionType = ConstructorParameters<
    typeof RuntimeDeployment
>[0]['runtimeCollection'];
type CollectionDeploymentRuntimeCollectionType = ConstructorParameters<
    typeof CollectionDeployment
>[0]['runtimeCollection'];
type CollectionDeploymentManagerType = ConstructorParameters<
    typeof CollectionDeployment
>[0]['collectionManager'];
type CollectionDeploymentTranspilerType = ConstructorParameters<
    typeof CollectionDeployment
>[0]['transpiler'];

type RuntimeTargetLike = {
    id: string;
    displayName?: string;
    description?: string;
};

type RuntimeNodeTypeLike = {
    requiredCapabilities?: unknown;
};

type RuntimeNodePackageLike = {
    id?: string;
    packageRoot?: string;
    manifest?: Record<string, unknown> | null;
    mpAssets?: Record<string, unknown>;
    requiredPackages?: unknown;
};

type RuntimeLike = {
    id?: string;
    target?: Record<string, unknown> | null;
    getAvailableTargets: () => RuntimeTargetLike[];
    getDeviceTarget?: (targetId: string) => RuntimeTargetLike | null | undefined;
    getNodeType?: (nodeTypeId: string) => RuntimeNodeTypeLike | null | undefined;
    manifest?: Record<string, unknown> | null;
    nodePackages?: RuntimeNodePackageLike[];
    nodePackagesGlobal?: string[];
};

/** Why a firmware-bundled package is shadowed by host source. */
type EmbeddedOverrideReason = ShadowPackageState | 'forced-override';

/**
 * One firmware-bundled package that must be shadowed by host source, with the reason why.
 */
type OutdatedEmbeddedPackage = {
    packageId: string;
    deviceVersion: string;
    hostVersion: string;
    reason: EmbeddedOverrideReason;
};

/**
 * Where the runtime id the embedded plan resolved against came from.
 *
 * `device-state` is the connected board's runtime (the authoritative answer for what the firmware
 * bundles); `collection` is the fallback used when the device has not reported a runtime id yet.
 */
type EmbeddedRuntimeIdSource = 'device-state' | 'collection';

/** The runtime the embedded plan resolved against, plus where its id came from. */
type EmbeddedPlanRuntime = {
    runtimeId: string;
    runtimeIdSource: EmbeddedRuntimeIdSource;
    runtime: RuntimeLike;
};

/**
 * Result of {@link DeviceDeployment._computeEmbeddedOverridePlan}.
 *
 * The runtime, the firmware module plan and the shadow set are computed once here, so the
 * compatibility warnings and the deploy-time consent gate can never disagree about which packages
 * are shadowed.
 */
type EmbeddedOverridePreflight = {
    runtimeId: string;
    runtimeIdSource: EmbeddedRuntimeIdSource;
    collectionRuntimeId: string;
    runtime: RuntimeLike;
    plan: FirmwareModulePlan;
    overridePaths: string[];
    shadowPackages: OutdatedEmbeddedPackage[];
};

/**
 * Sentinel device version used when the firmware exposes no package version source.
 *
 * It is a stable string so approval signatures stay comparable, but it must never be printed
 * verbatim: consumers localise it through `deployment.packageVersionUnknown` /
 * `deployment.embeddedOverrideVersionUnknown`.
 */
const UNKNOWN_DEVICE_VERSION = 'unknown';

/**
 * Maximum number of device hashes one embedded content probe run may request.
 *
 * The probe exists to catch "same version, different bytes" firmware packages. It runs before the
 * consent dialog and costs one device hash per file, so it is capped: a package larger than the
 * remaining budget is skipped (logged as `embedded-content-probe-limit`) instead of stalling the
 * deploy behind a slow serial link.
 */
export const EMBEDDED_CONTENT_PROBE_LIMIT = 24;

/** Matches a lowercase or uppercase SHA-256 hex digest. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Shared empty package-id set, so an absent probe result allocates nothing. */
const EMPTY_PACKAGE_ID_SET: ReadonlySet<string> = new Set<string>();

/**
 * Result of the shared outdated-package analysis, fed by both the compatibility warnings and the
 * deploy-time embedded source override plan.
 */
type OutdatedEmbeddedPackagesPlan = {
    outdated: OutdatedEmbeddedPackage[];
    nodePackages: RuntimeNodePackageLike[];
};

type RuntimeCollectionLike = {
    getRuntime: (runtimeId: string) => RuntimeLike | null | undefined;
};

type FormDialogControllerLike = {
    setFieldValue: (fieldId: string, value: string) => void;
};

type FormDialogFieldLike = {
    id: string;
    type: string;
    label?: string;
    options?: Array<{ value: string; label: string }>;
    required?: boolean;
    default?: string | null;
    value?: string;
    readonly?: boolean;
    multiline?: boolean;
    placeholder?: string;
    description?: string;
    defaultValue?: boolean;
    onChange?: (selectedTargetId: string, dialog: FormDialogControllerLike) => void;
};

type FormDialogResultLike = {
    confirmed?: boolean;
    formData?: unknown;
};

type DeviceConnectionLike = {
    hardReset: () => Promise<void>;
    softReset: (options?: { startRunning?: boolean }) => Promise<void>;
    deleteFile: (path: string) => Promise<void>;
    deleteFolderRecursive: (path: string) => Promise<void>;
    deleteFileSystem: () => Promise<string | void>;
    sendFile: (path: string, content: string | Uint8Array) => Promise<void>;
    getDeviceInfo: () => Promise<unknown>;
    getState: () => string;
    executeCode: (code: string) => Promise<string>;
    ensureDirectory: (path: string) => Promise<void>;
    writeTextFile: (path: string, content: string) => Promise<void>;
    readTextFile: (path: string) => Promise<string>;
    /** Device-side SHA-256 of a file; absent on connections that cannot hash on the board. */
    calculateHash?: (path: string) => Promise<string>;
    isConnected: () => boolean;
    getDeviceInfoData: () => unknown;
    loadDeviceInfo: () => Promise<unknown>;
    /** Reader verdict on the stored target payload; absent on connection doubles. */
    getTargetPayloadIssue?: () => 'missing' | 'incomplete' | null;
    /** Stored target id of a rejected payload, used to prefill the repair dialog. */
    getConfiguredTargetIdHint?: () => string | null;
    /** `targetUserDescription` from `/device.json`, used to prefill the repair dialog. */
    getTargetUserDescription?: () => string;
    setEmbeddedOnboardingAdapter?: (
        adapter: {
            requestSelection: (request: {
                runtimeIdentity: {
                    id: string | null;
                    name: string | null;
                    version: string | null;
                };
                targetConstraints: {
                    compileBoard: string | null;
                    allowedTargetIds: string[] | null;
                };
            }) => Promise<{
                confirmed: boolean;
                selectedTargetId?: string | null;
                userDescription?: string;
                error?: string | null;
            }>;
            uploadTargetConfiguration: (payload: {
                runtimeId: string;
                targetId: string;
                userDescription: string;
            }) => Promise<void>;
            showError?: (payload: {
                title: string;
                message: string;
                details?: string;
            }) => Promise<void>;
        } | null
    ) => void;
    disconnect?: () => Promise<void>;
    addEventListener: (
        eventName: string,
        listener: (event: Event & { detail?: unknown }) => void
    ) => void;
};

type I18nServiceLike = {
    t: (key: string, params?: Record<string, unknown>) => string;
};

type ViewManagerLike = {
    showFormDialog: (options: {
        title: string;
        message: string;
        fields: FormDialogFieldLike[];
        confirmLabel: string;
        cancelLabel: string;
    }) => Promise<FormDialogResultLike | null | undefined>;
    showError: (options: {
        title: string;
        message: string;
        detail?: string;
        details?: string;
    }) => Promise<void>;
    showConfirmation?: (options: Record<string, unknown>) => Promise<boolean>;
    showConfirmationWithCheckbox?: (
        options: Record<string, unknown>
    ) => Promise<ConfirmationDialogResultLike | null | undefined>;
};

/** Answer of a confirmation dialog that can carry an optional checkbox. */
type ConfirmationDialogResultLike = {
    confirmed?: boolean;
    checkboxChecked?: boolean;
};

type DeviceDeploymentOptions = {
    deviceConnection: DeviceConnectionLike;
    collectionManager: unknown;
    runtimeCollection: RuntimeCollectionLike;
    transpiler: unknown;
    i18nService: I18nServiceLike;
    viewManager: ViewManagerLike;
};

type DeviceStateUpdates = Partial<import('../data/device-state.js').DeviceStateData>;

type RuntimeDeploymentStateType = Parameters<RuntimeDeployment['setDeviceState']>[0];
type CollectionDeploymentStateType = Parameters<CollectionDeployment['setDeviceState']>[0];

type TargetSelectionResult = {
    targetId: string;
    userDescription: string;
};

type TargetSelectionOptions = {
    allowedTargetIds?: string[] | null;
    userDescription?: string;
    currentTargetId?: string | null;
};

type TargetConfigLike = {
    id?: string;
    displayName?: string;
    description?: string;
    [key: string]: unknown;
};

type InstalledRuntimeInfo = {
    id: string;
    name: string;
    version: string;
    description: string;
    targetId: string | null;
    targetDisplayName: string | null;
    targetDescription: string | null;
};

type MpyProbeParams = {
    versionMajor: number | null;
    versionMinor: number | null;
    versionPatch: number | null;
    versionSuffix: string | null;
    mpyAbi: number | null;
    platform: string | null;
    machine: string | null;
    release: string | null;
    maxsize: number | null;
    wordBits: number | null;
    smallIntBits: number | null;
};

type MpyCompileParams = {
    mpyCrossVersion: string;
    emit: 'bytecode' | 'native' | 'viper';
    smallIntBits: number | null;
    march: string | null;
    marchFlags: string | null;
};

type MpyCompileProfile = {
    probe: MpyProbeParams;
    compileParams: MpyCompileParams;
    hash: string;
};

type MpyGroupAvailability = {
    required: boolean;
    hasProfile: boolean;
    manifestPath: string;
    packageId?: string;
};

type MpyAvailabilityReport = {
    hash: string;
    tools: MpyGroupAvailability;
    runtime: MpyGroupAvailability;
    nodePackages: MpyGroupAvailability[];
};

type NodePackageMpyAvailabilityEntry = MpyGroupAvailability & {
    missingArtifacts?: string[];
};

type MpyFallbackDecision = 'source' | 'cancel' | 'mpy';

type DeviceInfoRefreshSummary = {
    runtime: { id: string | null; name: string | null; version: string | null } | null;
    collection: { name: string | null; version: string | null } | null;
    target: { id: string | null; displayName: string | null };
};

type ClearedDeploymentStateUpdates = DeviceStateUpdates;

/** Why the stored target configuration cannot be used, or `null` when it is usable. */
type TargetConfigurationIssue = 'missing' | 'incomplete' | 'image-incompatible';

type RuntimeDeployRoutingDecision = {
    mode: 'dynamic' | 'embedded' | 'undetermined';
    source: 'api' | 'fallback';
};

type DeviceInitializationStatusDetail = {
    connectionState?: string;
    runtimeDeploymentMode?: 'embedded' | 'dynamic' | 'unknown';
    runtimePresent?: boolean;
    specificTargetPresent?: boolean;
    initializationVerdict?: 'ready' | 'ready-for-runtime-install' | 'needs-onboarding' | 'unknown';
    onboardingActionable?: boolean;
    reason?: string;
};

const MPY_PROBE_START = 'OTTER_MPY_PROBE_START';
const MPY_PROBE_END = 'OTTER_MPY_PROBE_END';
const OTTER_BOOTSTRAP_APPLY_API_START = 'OTTER_BOOTSTRAP_APPLY_API_START';
const OTTER_BOOTSTRAP_APPLY_API_END = 'OTTER_BOOTSTRAP_APPLY_API_END';

const MPY_PROBE_SNIPPET = `
import sys
import json
try:
    import os
except Exception:
    os = None

impl = getattr(sys, 'implementation', None)
version = getattr(impl, 'version', ()) if impl else ()
mpy_abi = getattr(impl, '_mpy', None) if impl else None
platform = getattr(sys, 'platform', None)
maxsize = getattr(sys, 'maxsize', None)

word_bits = 0
if isinstance(maxsize, int):
    n = maxsize
    while n:
        word_bits += 1
        n //= 2

machine = None
release = None
if os is not None:
    try:
        uname = os.uname()
        machine = getattr(uname, 'machine', None)
        release = getattr(uname, 'release', None)
    except Exception:
        pass

payload = {
    'versionMajor': version[0] if len(version) > 0 else None,
    'versionMinor': version[1] if len(version) > 1 else None,
    'versionPatch': version[2] if len(version) > 2 else None,
    'versionSuffix': version[3] if len(version) > 3 else None,
    'mpyAbi': mpy_abi,
    'platform': platform,
    'machine': machine,
    'release': release,
    'maxsize': maxsize,
    'wordBits': word_bits,
    'smallIntBits': word_bits,
}

print('${MPY_PROBE_START}')
print(json.dumps(payload))
print('${MPY_PROBE_END}')
`.trim();

/**
 * Thrown when the user declines to upload host sources over firmware-bundled packages.
 *
 * Callers can detect the cancellation with `error.code === 'EMBEDDED_SOURCE_OVERRIDE_DECLINED'`
 * and treat it as "the user already answered the only permitted dialog" instead of surfacing an
 * upload failure.
 */
export class TargetNotCompatibleError extends Error {
    /** Stable machine-readable discriminator for UI callers. */
    code: string;
    /** The collection target id the firmware refused. */
    targetId: string;

    /**
     * @param {string} targetId - Collection target id that is not allowed
     * @param {string} [message] - Localised message; falls back to the legacy English sentence
     */
    constructor(targetId: string, message?: string) {
        super(
            message ||
                `Target '${targetId}' is not compatible with the connected board's firmware.`
        );
        this.name = 'TargetNotCompatibleError';
        this.code = 'target-not-compatible';
        this.targetId = targetId;
    }
}

/**
 * Thrown when a collection's target id does not exactly match the connected
 * device's target id.
 *
 * Its stable `code` discriminator lets the deploy catch block route the error
 * to the target-mismatch dialog without a fragile substring match on the
 * message — which would otherwise also match unrelated "does not match"
 * errors such as the embedded-runtime version guard.
 */
export class TargetMismatchError extends Error {
    /** Stable machine-readable discriminator for UI callers. */
    code: string;
    /** The collection target id that was compared. */
    collectionTargetId: string;
    /** The device target id it was compared against. */
    deviceTargetId: string | null | undefined;

    /**
     * @param {string} collectionTargetId - Collection target id that did not match
     * @param {string | null | undefined} deviceTargetId - Device target id it was compared against
     * @param {string} message - Localised mismatch message
     */
    constructor(
        collectionTargetId: string,
        deviceTargetId: string | null | undefined,
        message: string
    ) {
        super(message);
        this.name = 'TargetMismatchError';
        this.code = 'target-mismatch';
        this.collectionTargetId = collectionTargetId;
        this.deviceTargetId = deviceTargetId;
    }
}

export class EmbeddedSourceOverrideDeclinedError extends Error {
    /** Stable machine-readable discriminator for UI callers. */
    code: string;
    /** Packages the user refused to override. */
    packageIds: string[];

    /**
     * @param {string[]} packageIds - Firmware-bundled packages the user refused to override
     */
    constructor(packageIds: string[] = []) {
        const packageList = Array.isArray(packageIds) ? packageIds.filter(Boolean) : [];
        super(
            packageList.length > 0
                ? `Embedded source override declined for: ${packageList.join(', ')}`
                : 'Embedded source override declined'
        );
        this.name = 'EmbeddedSourceOverrideDeclinedError';
        this.code = 'EMBEDDED_SOURCE_OVERRIDE_DECLINED';
        this.packageIds = packageList;
    }
}

/**
 * Thrown when the user cancels the deploy/sync options dialog.
 *
 * The options dialog is part of the shared deploy path (suppressed only by the
 * title-bar quick action), so its cancellation is a normal "do nothing" outcome —
 * never an upload failure. UI callers detect it with
 * `error.code === 'DEPLOYMENT_OPTIONS_CANCELLED'` and stay silent.
 */
export class DeploymentOptionsCancelledError extends Error {
    /** Stable machine-readable discriminator for UI callers. */
    code: string;

    /** Constructor. */
    constructor() {
        super('Deployment options dialog cancelled.');
        this.name = 'DeploymentOptionsCancelledError';
        this.code = 'DEPLOYMENT_OPTIONS_CANCELLED';
    }
}

class DeviceDeploymentEventPayload extends AppPayload {
    /**
     * @param {string} payloadTypeId
     * @param {object} [fields]
     */
    constructor(payloadTypeId: string, fields: Record<string, unknown> = {}) {
        super(payloadTypeId);
        if (fields && typeof fields === 'object') {
            Object.assign(this, fields);
        }
    }
}

function parseJsonFromDeviceText<T>(text: string): T {
    const normalized = String(text ?? '').trim();

    try {
        return JSON.parse(normalized) as T;
    } catch {
        // Fall through to tolerant parsing.
    }

    const isSingleBytesLiteral = normalized.startsWith("b'") && normalized.endsWith("'");
    const isDoubleBytesLiteral = normalized.startsWith('b"') && normalized.endsWith('"');

    if (isSingleBytesLiteral || isDoubleBytesLiteral) {
        const inner = normalized.slice(2, -1);
        const unescaped = inner
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .trim();
        return JSON.parse(unescaped) as T;
    }

    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(normalized.slice(start, end + 1)) as T;
    }

    return JSON.parse(normalized) as T;
}

/**
 * Main deployment coordinator for ESP32 devices.
 * Manages device state and orchestrates runtime and collection operations.
 *
 * @extends EventTarget
 * @emits device-state-changed - Device state updated
 * @emits operation-error - Error during operation
 */
export class DeviceDeployment extends EventTarget {
    _deviceConnection: DeviceConnectionLike;
    _collectionManager: unknown;
    _runtimeCollection: RuntimeCollectionLike;
    _transpiler: unknown;
    _i18nService: I18nServiceLike;
    _viewManager: ViewManagerLike;
    _deviceState: DeviceState;
    _runtimeDeployment: RuntimeDeployment;
    _collectionDeployment: CollectionDeployment;
    _listInstalledRuntimePromise: Promise<InstalledRuntimeInfo | null> | null;
    _lastMpyProbeParams: MpyProbeParams | null;
    _lastMpyCompileProfile: MpyCompileProfile | null;
    _latestInitializationStatus: DeviceInitializationStatusDetail | null;
    /**
     * Approval signatures for embedded source overrides the user explicitly allowed for this
     * page session ("remember for this version"). Never persisted; cleared on connect/disconnect.
     */
    _embeddedOverrideApprovals: Set<string>;
    /**
     * Cache of embedded content-probe verdicts, keyed by
     * `runtimeId|firmwareFullVersion|packageId|deviceVersion|hostVersion`.
     *
     * `true` means "at least one in-use file differs" (shadow it), `false` means "the probed files
     * matched". Cleared on connect/disconnect together with the approvals, because a different
     * board or firmware must be probed again.
     */
    _embeddedContentProbeCache: Map<string, boolean>;
    /**
     * Why the target configuration stored on the device cannot be used by the editor.
     *
     * `missing` / `incomplete` come from the reader's payload verdict, `image-incompatible` means
     * the stored target does not belong to the flashed image's board family. `null` means the
     * stored target is usable (or could not be judged), so `deviceTargetInfo` is authoritative.
     */
    _targetConfigurationIssue: TargetConfigurationIssue | null;

    /**
     * @param {Object} options
     * @param {DeviceConnection} options.deviceConnection - Device connection manager
     * @param {CollectionManager} options.collectionManager - Collection manager
     * @param {DeviceRuntimeCollection} options.runtimeCollection - Runtime collection
     * @param {Transpiler} options.transpiler - Code transpiler
     * @param {I18nService} options.i18nService - Translation service
     * @param {ViewManager} options.viewManager - View manager for dialogs
     */
    constructor({
        deviceConnection,
        collectionManager,
        runtimeCollection,
        transpiler,
        i18nService,
        viewManager,
    }: DeviceDeploymentOptions) {
        super();

        this._deviceConnection = deviceConnection;
        this._collectionManager = collectionManager;
        this._runtimeCollection = runtimeCollection;
        this._transpiler = transpiler;
        this._i18nService = i18nService;
        this._viewManager = viewManager;

        // Device state (immutable DeviceState instance)
        this._deviceState = new DeviceState();

        // Specialist deployment classes
        this._runtimeDeployment = new RuntimeDeployment({
            deviceConnection: this._deviceConnection as unknown as RuntimeDeploymentConnectionType,
            deviceState: this._deviceState as unknown as RuntimeDeploymentStateType,
            updateDeviceState: (updates) => this._updateDeviceState(updates),
            runtimeCollection: this
                ._runtimeCollection as unknown as RuntimeDeploymentRuntimeCollectionType,
        });

        this._collectionDeployment = new CollectionDeployment({
            deviceConnection: this
                ._deviceConnection as unknown as CollectionDeploymentConnectionType,
            deviceState: this._deviceState as unknown as CollectionDeploymentStateType,
            updateDeviceState: (updates) => this._updateDeviceState(updates),
            collectionManager: this._collectionManager as CollectionDeploymentManagerType,
            runtimeCollection: this
                ._runtimeCollection as unknown as CollectionDeploymentRuntimeCollectionType,
            transpiler: this._transpiler as CollectionDeploymentTranspilerType,
        });

        // Forward events from specialists
        this._setupEventForwarding();

        this._listInstalledRuntimePromise = null;
        this._lastMpyProbeParams = null;
        this._lastMpyCompileProfile = null;
        this._latestInitializationStatus = null;
        this._embeddedOverrideApprovals = new Set<string>();
        this._embeddedContentProbeCache = new Map<string, boolean>();
        this._targetConfigurationIssue = null;

        this._configureEmbeddedOnboardingAdapter();

        // Setup connection event listeners
        this._setupConnectionListeners();

        // Sync initial connection state and auto-detect MicroPython if connected
        this._syncConnectionState();

        // If device is already connected, trigger MicroPython detection
        // (Connection event won't fire if device connected before constructor)
        if (this._deviceState.connected) {
            this._log('device-already-connected-on-construction');
            // Use queueMicrotask to ensure constructor completes before detection starts
            queueMicrotask(() => this._scheduleInitialDetection());
        }
    }

    // ========================================================================
    // Public API: State Queries
    // ========================================================================

    /**
     * Get current device state.
     * @returns {DeviceState} Immutable DeviceState instance
     */
    getDeviceState() {
        return this._deviceState;
    }

    /**
     * Return why the target configuration stored on the device cannot be used.
     *
     * `null` means the stored target is usable or could not be judged; `missing` / `incomplete`
     * mirror the reader's payload verdict and `image-incompatible` means the stored target does not
     * belong to the flashed image's board family. `deviceTargetInfo` is `null` for every non-null
     * issue, which is what drives the `needs-onboarding` verdict.
     * @returns {TargetConfigurationIssue | null} The active issue, or null.
     */
    get targetConfigurationIssue(): TargetConfigurationIssue | null {
        return this._targetConfigurationIssue;
    }

    /**
     * Get device connection instance.
     * @returns {Object}
     */
    getDeviceConnection() {
        return this._deviceConnection;
    }

    /**
     * Check if device is connected.
     * @returns {boolean}
     */
    isConnected() {
        return this._deviceConnection.isConnected();
    }

    /**
     * Manually refresh connection state from DeviceConnection.
     * Useful for debugging or recovering from state sync issues.
     * Also triggers MicroPython auto-detection if connected and not yet detected.
     * @returns {Promise<boolean>} - New connection state
     */
    async refreshConnectionState() {
        this._log('manual-refresh-connection-state', {
            beforeRefresh: this._deviceState.connected,
            hasMicroPython: this._deviceState.hasMicroPython,
        });

        const wasConnected = this._deviceState.connected;
        this._syncConnectionState();
        const isConnected = this._deviceState.connected;

        this._log('manual-refresh-complete', {
            afterRefresh: isConnected,
        });

        // Trigger MicroPython detection if:
        // 1. Newly connected (state changed), OR
        // 2. Already connected but MicroPython status unknown (null or false)
        const needsDetection =
            isConnected && (!wasConnected || this._deviceState.hasMicroPython !== true);

        if (needsDetection) {
            this._log('manual-refresh-triggering-micropython-detection', {
                reason: !wasConnected ? 'newly-connected' : 'unknown-status',
            });
            try {
                await this.detectMicroPython();
            } catch (error: any) {
                this._log('manual-refresh-micropython-detection-failed', {
                    error: error.message,
                });
                // Don't throw - detection failure is not critical
            }
        }

        return isConnected;
    }

    /**
     * Check if MicroPython is detected.
     * @returns {boolean|null} - null if unknown
     */
    hasMicroPython() {
        return this._deviceState.hasMicroPython;
    }

    /**
     * Get MicroPython version.
     * @returns {string|null}
     */
    getMicroPythonVersion() {
        return this._deviceState.micropythonVersion;
    }

    /**
     * Check if runtime is installed.
     * @returns {boolean}
     */
    hasRuntime() {
        return this._deviceState.runtimeInstalled === true;
    }

    /**
     * Get installed runtime version.
     * @returns {string|null}
     */
    getRuntimeVersion() {
        return this._deviceState.runtimeVersion;
    }

    /**
     * Check if collection is deployed.
     * @returns {boolean}
     */
    hasCollection() {
        return this._deviceState.collectionDeployed === true;
    }

    /**
     * Get deployed collection name.
     * @returns {string|null}
     */
    getCollectionName() {
        return this._deviceState.collectionName;
    }

    /**
     * Get device hardware information.
     * @returns {Promise<Object>} Device info (chip ID, flash size, etc.)
     * @throws {Error} If not connected or MicroPython not detected
     */
    async getDeviceInfo() {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (!this._deviceState.hasMicroPython) {
            throw new Error('MicroPython not detected');
        }

        try {
            this._log('device-info-query-start');

            const info = await this._deviceConnection.getDeviceInfo();
            this._log('device-info-retrieved', { info });
            return info;
        } catch (error: any) {
            this._log('device-info-query-failed', { error: error.message });
            throw error;
        }
    }

    // ========================================================================
    // Public API: MicroPython Detection
    // ========================================================================

    /**
     * Detect MicroPython on connected device.
     * Updates device state with detection results.
     * @returns {Promise<boolean>}
     */
    async detectMicroPython() {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        try {
            this._log('micropython-detection-start', {
                connected: this._deviceState.connected,
                deviceConnectionState: this._deviceConnection.getState(),
            });

            // Check REPL prompt
            this._log('micropython-detection-checking-repl-prompt');
            const hasPrompt = await this._checkREPLPrompt();
            this._log('micropython-detection-repl-prompt-check-complete', { hasPrompt });

            if (!hasPrompt) {
                this._updateDeviceState({
                    hasMicroPython: false,
                    micropythonVersion: null,
                });
                this._log('micropython-not-detected');
                return false;
            }

            // Get MicroPython version
            this._log('micropython-detection-getting-version');
            const version = await this._getMicroPythonVersion();
            this._log('micropython-detection-version-received', { version });

            this._updateDeviceState({
                hasMicroPython: true,
                micropythonVersion: version,
            });

            this._log('micropython-detected', { version });
            return true;
        } catch (error: any) {
            this._log('micropython-detection-failed', { error: error.message });

            this._updateDeviceState({
                hasMicroPython: false,
                micropythonVersion: null,
            });

            throw error;
        }
    }

    /**
     * Check for MicroPython REPL by attempting to execute a simple command.
     * Raw REPL mode doesn't show >>> prompt, so we just verify we can execute code.
     * @private
     * @returns {Promise<boolean>}
     */
    async _checkREPLPrompt() {
        try {
            this._log('checking-micropython-repl-start', {
                deviceConnectionState: this._deviceConnection.getState(),
            });

            // Try executing a simple Python command
            // If this succeeds, MicroPython is present and responding
            this._log('checking-micropython-repl-executing-test-command');
            const response = await this._deviceConnection.executeCode('print(1+1)');
            this._log('checking-micropython-repl-test-command-complete');

            this._log('micropython-repl-response', {
                response: response,
                responseLength: response.length,
            });

            // Any successful response means MicroPython is working
            // (even if output is just "2" or empty, command executed)
            return true;
        } catch (error: any) {
            const message = String(error?.message || '');
            const isTimeout = /timeout/i.test(message);

            if (isTimeout) {
                this._log('micropython-repl-timeout-retrying-after-soft-reset', {
                    error: message,
                });

                try {
                    await this._deviceConnection.softReset({ startRunning: false });

                    const retryResponse = await this._deviceConnection.executeCode('print(1+1)');
                    this._log('micropython-repl-retry-after-soft-reset-success', {
                        response: retryResponse,
                        responseLength: retryResponse.length,
                    });
                    return true;
                } catch (retryError: any) {
                    this._log('micropython-repl-retry-after-soft-reset-failed', {
                        error: retryError?.message,
                    });
                }
            }

            this._log('micropython-repl-check-error', {
                error: error.message,
                stack: error.stack,
            });
            // Timeout or error means MicroPython not responding
            return false;
        }
    }

    /**
     * Get MicroPython version from device.
     * @private
     * @returns {Promise<string|null>}
     */
    async _getMicroPythonVersion() {
        try {
            const code = `
import sys
print(sys.version)
            `.trim();

            this._log('getting-micropython-version', {
                deviceConnectionState: this._deviceConnection.getState(),
            });
            const output = await this._deviceConnection.executeCode(code);
            this._log('getting-micropython-version-execute-complete');

            this._log('micropython-version-output', {
                output: output,
                outputLength: output.length,
            });

            // Extract version string (e.g., "3.4.0")
            const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
            const version = versionMatch ? versionMatch[1] : 'unknown';

            this._log('micropython-version-parsed', {
                version: version,
                matched: !!versionMatch,
            });

            return version;
        } catch (error: any) {
            this._log('version-detection-failed', {
                error: error.message,
                stack: error.stack,
            });
            return null;
        }
    }

    // ========================================================================
    // Target Selection Dialog
    // ========================================================================

    /**
     * Show target selection dialog.
     * Returns selected target info or null if cancelled.
     * @param {string} runtimeId - Runtime identifier to get available targets
     * @returns {Promise<{targetId: string, userDescription: string}|null>} Selected target info or null if cancelled
     * @private
     */
    async _promptTargetSelection(
        runtimeId: string,
        options: TargetSelectionOptions = {}
    ): Promise<TargetSelectionResult | null> {
        this._log('target-selection-dialog-start', {
            runtimeId,
            hasAllowedTargetFilter: Array.isArray(options.allowedTargetIds),
        });

        // Get runtime to access available targets
        const runtime = this._runtimeCollection.getRuntime(runtimeId);
        if (!runtime) {
            const error = new Error(`Runtime not found: ${runtimeId}`);
            this._log('target-selection-dialog-runtime-not-found', {
                runtimeId,
                error: error.message,
            });
            throw error;
        }

        // Get available targets
        const allTargets = runtime.getAvailableTargets();
        const legacyAllowed =
            Array.isArray(options.allowedTargetIds) && options.allowedTargetIds.length > 0
                ? options.allowedTargetIds
                : this._deviceState.allowedWebTargetIds;
        const image = {
            buildBaseTargetId: this._deviceState.buildBaseTargetId,
            allowedWebTargetIds: legacyAllowed,
        };
        const hasFilter =
            Boolean(image.buildBaseTargetId) ||
            (Array.isArray(image.allowedWebTargetIds) && image.allowedWebTargetIds.length > 0);
        const targets = hasFilter
            ? allTargets.filter((target) =>
                  isTargetCompatibleWithImage(target.id ?? '', image, runtime)
              )
            : allTargets;

        if (hasFilter && targets.length === 0) {
            const error = new Error(this._i18nService.t('deployment.errors.noTargets'));
            this._log('target-selection-dialog-no-allowed-targets', {
                runtimeId,
                buildBaseTargetId: image.buildBaseTargetId,
                allowedWebTargetIds: image.allowedWebTargetIds,
            });
            throw error;
        }

        if (!targets || targets.length === 0) {
            const error = new Error(this._i18nService.t('deployment.errors.noTargets'));
            this._log('target-selection-dialog-no-targets', { runtimeId });
            throw error;
        }

        // Build dropdown options
        const targetOptions = targets.map((target) => ({
            value: target.id,
            label: target.displayName || target.id,
        }));

        // Create map for target lookup by ID
        const targetsById = new Map<string, { id: string; description?: string }>(
            targets.map((t) => [t.id, t])
        );

        // Determine which target to pre-select (current target when available)
        const defaultTargetId =
            options.currentTargetId && targetsById.has(options.currentTargetId)
                ? options.currentTargetId
                : targetOptions[0]?.value ?? null;

        // Get default target description for the pre-selected target
        const defaultTarget = defaultTargetId ? targetsById.get(defaultTargetId) : undefined;
        const defaultDescription = defaultTarget?.description || '';

        // Show form dialog and wait for result
        const result = await this._viewManager.showFormDialog({
            title: this._i18nService.t('deployment.targetDialog.title'),
            message: this._i18nService.t('deployment.targetDialog.message'),
            fields: [
                {
                    id: 'target',
                    type: 'dropdown',
                    label: this._i18nService.t('deployment.targetDialog.targetLabel'),
                    options: targetOptions,
                    required: true,
                    default: defaultTargetId,
                    // Update target description when selection changes
                    onChange: (selectedTargetId, dialog) => {
                        const selectedTarget = targetsById.get(selectedTargetId);
                        const description = selectedTarget?.description || '';
                        dialog.setFieldValue('targetDescription', description);
                    },
                },
                {
                    id: 'targetDescription',
                    type: 'text',
                    label: this._i18nService.t('deployment.targetDialog.targetDescriptionLabel'),
                    value: defaultDescription,
                    readonly: true,
                    multiline: true,
                },
                {
                    id: 'userDescription',
                    type: 'text',
                    label: this._i18nService.t('deployment.targetDialog.userDescriptionLabel'),
                    placeholder: this._i18nService.t(
                        'deployment.targetDialog.userDescriptionPlaceholder'
                    ),
                    multiline: true,
                    value: options.userDescription || '',
                },
            ],
            confirmLabel: this._i18nService.t('deployment.targetDialog.confirm'),
            cancelLabel: this._i18nService.t('deployment.targetDialog.cancel'),
        });

        // Handle result
        const formData = (result?.formData ?? null) as {
            target?: string;
            userDescription?: string;
        } | null;
        if (result?.confirmed && formData?.target) {
            const selectedTargetId = String(formData.target);
            const userDescription = formData.userDescription || '';
            this._log('target-selection-dialog-confirmed', {
                targetId: selectedTargetId,
                userDescription: userDescription,
            });
            return { targetId: selectedTargetId, userDescription };
        } else {
            this._log('target-selection-dialog-cancelled');
            return null;
        }
    }

    // ========================================================================
    // Target Configuration Management
    // ========================================================================

    /**
     * Upload target configuration to device.
     * Also updates device.json with target information.
     * @private
     * @param {string} targetId - Target ID to upload
     * @param {string} runtimeId - Runtime ID being installed
     * @param {string} userDescription - User's custom description
     * @returns {Promise<Object>} Target configuration object
     */
    async _uploadTargetConfiguration(
        targetId: string,
        runtimeId: string,
        userDescription = ''
    ): Promise<TargetConfigLike> {
        this._log('upload-target-start', { targetId, runtimeId });

        try {
            // Load target definition
            const runtime = this._runtimeCollection.getRuntime(runtimeId);
            if (!runtime) {
                throw new Error(`Runtime not found: ${runtimeId}`);
            }
            const effectivePayload =
                (
                    runtime as {
                        getEffectiveTargetPayload?: (
                            id: string
                        ) => Record<string, unknown> | null;
                    }
                ).getEffectiveTargetPayload?.(targetId) ?? null;
            const fallbackTarget = effectivePayload
                ? null
                : (runtime.getAvailableTargets() as TargetConfigLike[]).find(
                      (target) => target.id === targetId
                  ) ?? null;
            if (!effectivePayload && !fallbackTarget) {
                throw new Error(`Target configuration not found: ${targetId}`);
            }

            // The image-family rule is enforced here, inside the only writer of
            // target content, so no caller can bypass it (Locked Decision 3).
            this._assertTargetCompatibleWithImage(targetId, runtime);

            // The writer only adds the delivery header fields below on top of the
            // effective payload; the target content itself is written verbatim.
            const source = (effectivePayload ?? fallbackTarget) as {
                targetId?: unknown;
                displayName?: unknown;
                description?: unknown;
                configVersion?: unknown;
                [key: string]: unknown;
            };

            // Refuse a payload without pin information instead of writing a
            // config the editor could only read back as unusable (Locked Decision 7).
            if (!isCompleteActiveTargetPayload(source)) {
                this._log('upload-target-incomplete-payload', {
                    targetId,
                    keys: Object.keys(source),
                });
                const incompleteError = new Error(
                    this._i18nService.t('deployment.errors.targetIncomplete', { targetId })
                ) as Error & { code?: string };
                incompleteError.code = 'target-incomplete';
                throw incompleteError;
            }

            const sourceTargetId =
                typeof source.targetId === 'string' && source.targetId.trim()
                    ? source.targetId
                    : targetId;
            const sourceDisplayName =
                typeof source.displayName === 'string' && source.displayName.trim()
                    ? source.displayName
                    : targetId;
            const serializedTargetConfig: TargetConfigLike = {
                ...source,
                id: targetId,
                targetId: sourceTargetId,
                displayName: sourceDisplayName,
                description:
                    typeof source.description === 'string' ? source.description : '',
                configVersion:
                    typeof source.configVersion === 'number' &&
                    Number.isFinite(source.configVersion)
                        ? source.configVersion
                        : 1,
            };

            const targetJson = JSON.stringify(serializedTargetConfig, null, 2);

            // Upload to device at /device/targets/active_target.json
            const targetPath = '/device/targets/active_target.json';

            // Ensure the /device/targets directory exists
            await this._deviceConnection.ensureDirectory('/device/targets');

            await this._deviceConnection.writeTextFile(targetPath, targetJson);

            this._log('upload-target-complete', {
                targetId,
                path: targetPath,
                size: targetJson.length,
            });

            // Update device.json with target information
            await this._updateDeviceInfoWithTarget(
                targetId,
                targetPath,
                serializedTargetConfig.displayName,
                serializedTargetConfig.description,
                userDescription
            );

            this.dispatchEvent(
                new CustomEvent('target-uploaded', {
                    detail: new DeviceDeploymentEventPayload('DeviceDeployment.TargetUploaded.v1', {
                        targetId,
                        path: targetPath,
                    }),
                })
            );

            return serializedTargetConfig;
        } catch (error: any) {
            this._log('target-upload-failed', 'error', {
                targetId,
                runtimeId,
                error: error.message,
            });
            // Guard failures keep their message and discriminator so callers can
            // still recognise the image-family and completeness verdicts.
            if (
                error instanceof TargetNotCompatibleError ||
                error?.code === 'target-incomplete'
            ) {
                throw error;
            }
            throw new Error(`Failed to upload target configuration: ${error.message}`);
        }
    }

    /**
     * Update device.json with target information.
     * Reads current device info, updates target fields, and writes back.
     * @private
     * @param {string} targetId - Target ID
     * @param {string} targetConfigPath - Path to target configuration file
     * @param {string} targetDisplayName - Target display name
     * @param {string} targetDescription - Target description
     * @param {string} targetUserDescription - User's custom description
     * @returns {Promise<void>}
     */
    async _updateDeviceInfoWithTarget(
        targetId: string,
        targetConfigPath: string,
        targetDisplayName: string | undefined,
        targetDescription: string | undefined,
        targetUserDescription = ''
    ): Promise<void> {
        this._log('update-device-info-start', {
            targetId,
            targetConfigPath,
            targetDisplayName,
            targetUserDescription,
        });

        try {
            // Read current device info
            let deviceInfo: LooseRecord = {};
            try {
                const deviceInfoJson = await this._deviceConnection.readTextFile('/device.json');
                deviceInfo = parseJsonFromDeviceText<LooseRecord>(deviceInfoJson);
                this._log('device-info-read', { deviceInfo });
            } catch (error: any) {
                // If device.json doesn't exist, create new structure
                this._log('device-info-not-found', { error: error.message });
            }

            // Update target fields
            deviceInfo.targetId = targetId;
            deviceInfo.targetDisplayName = targetDisplayName || targetId;
            deviceInfo.targetDescription = targetDescription || '';
            deviceInfo.targetUserDescription = targetUserDescription || '';
            deviceInfo.targetConfigPath = targetConfigPath;
            deviceInfo.targetUploadedAt = new Date().toISOString();

            // Write updated device info
            const updatedJson = JSON.stringify(deviceInfo, null, 2);
            await this._deviceConnection.writeTextFile('/device.json', updatedJson);

            this._log('device-info-updated', {
                targetId,
                targetDisplayName,
                targetDescription,
                targetUserDescription,
                targetConfigPath,
                timestamp: deviceInfo.targetUploadedAt,
            });

            // Update device state
            this._updateDeviceState({});

            this.dispatchEvent(
                new CustomEvent('device-info-updated', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.DeviceInfoUpdated.v1',
                        {
                            targetId,
                            targetConfigPath,
                        }
                    ),
                })
            );
        } catch (error: any) {
            this._log('device-info-update-failed', 'error', {
                targetId,
                error: error.message,
            });
            throw new Error(`Failed to update device info: ${error.message}`);
        }
    }

    /**
     * Enforce the single image-family rule: a target id is legal only when its
     * terminal build base id equals the flashed image's `buildBaseTargetId`
     * (legacy images fall back to `allowedWebTargetIds` inside
     * `isTargetCompatibleWithImage`).
     *
     * This is the only place where the legality of a target/image pairing is
     * decided, and it throws instead of returning a boolean so no caller can
     * ignore a rejection and write a configuration the image cannot run.
     * @private
     * @param {string} targetId - Collection/device target id to check
     * @param {unknown} runtime - Runtime used to resolve the target's base id
     * @throws {TargetNotCompatibleError} When the target's base id differs from the image's
     */
    _assertTargetCompatibleWithImage(targetId: string, runtime: unknown): void {
        if (
            isTargetCompatibleWithImage(
                targetId,
                {
                    buildBaseTargetId: this._deviceState.buildBaseTargetId,
                    allowedWebTargetIds: this._deviceState.allowedWebTargetIds,
                },
                runtime
            )
        ) {
            return;
        }

        this._log('target-compatibility-not-allowed', {
            targetId,
            buildBaseTargetId: this._deviceState.buildBaseTargetId,
            allowedWebTargetIds: this._deviceState.allowedWebTargetIds,
            result: 'reject',
        });
        throw new TargetNotCompatibleError(
            targetId,
            this._i18nService.t('deployment.errors.targetNotCompatible', { targetId })
        );
    }

    /**
     * Validate target compatibility between collection and device.
     * @private
     * @param {string} collectionTargetId - Collection's target ID
     * @param {string} deviceTargetId - Device's target ID
     * @returns {boolean} True if compatible
     * @throws {Error} If validation fails with detailed message
     */
    _validateTargetCompatibility(
        collectionTargetId: string,
        deviceTargetId: string | null | undefined,
        runtime?: unknown
    ) {
        this._log('validate-target-compatibility', {
            collectionTargetId,
            deviceTargetId,
        });

        // Rule 0: The connected board's firmware is only compatible with target
        // configs that resolve to its recorded build base id. A collection whose
        // target resolves to a different base is refused before any device
        // round-trip. Images built before M4x carry only `allowedWebTargetIds`,
        // which the resolver expands to base ids.
        if (runtime) {
            this._assertTargetCompatibleWithImage(collectionTargetId, runtime);
        }

        // Rule 1: Device with standard target requires EXACT match.
        // (The Custom target was removed in M4w; a derived user target resolves
        // its identity through the base and is treated as a normal target here.)
        if (collectionTargetId !== deviceTargetId) {
            const errorMessage = this._i18nService.t('deployment.errors.targetMismatch', {
                collectionTarget: collectionTargetId,
                deviceTarget: deviceTargetId,
            });

            this._log('target-compatibility-mismatch', {
                collectionTargetId,
                deviceTargetId,
                result: 'reject',
            });

            throw new TargetMismatchError(collectionTargetId, deviceTargetId, errorMessage);
        }

        // Rule 3: Exact match - allow
        this._log('target-compatibility-exact-match', {
            collectionTargetId,
            deviceTargetId,
            result: 'allow',
        });

        return true;
    }

    /**
     * Handle target mismatch error with user-friendly dialog.
     * @private
     * @param {Error} error - Validation error
     * @param {Collection} collection - Collection that failed validation
     */
    async _handleTargetMismatchError(error: any, collection: any): Promise<void> {
        const collectionTarget = collection.getTargetId?.() || 'unknown';
        const deviceTarget = this._deviceState.deviceTargetInfo?.id || 'unknown';

        await this._viewManager.showError({
            title: this._i18nService.t('deployment.errors.title'),
            message: this._i18nService.t('deployment.errors.targetMismatch', {
                collectionTarget,
                deviceTarget,
            }),
            details: [
                `Collection: ${collection.getTitle()}`,
                `Collection Target: ${collectionTarget}`,
                `Device Target: ${deviceTarget}`,
                '',
                'To deploy this collection:',
                '- Use a device with matching target, OR',
                '- Upload a derived target config that matches the device.',
            ].join('\n'),
        });
    }

    // ========================================================================
    // Public API: Runtime Operations (delegated to RuntimeDeployment)
    // ========================================================================

    /**
     * Prepare runtime installation by building file lists.
     * Returns total file count for progress tracking.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Installation options
     * @returns {Promise<Object>} Preparation result with file counts
     */
    async prepareInstallRuntime(runtimeId: string, options: Record<string, unknown> = {}) {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (this._deviceState.hasMicroPython !== true) {
            throw new Error('MicroPython not detected on device');
        }

        // Delegate to RuntimeDeployment
        const preparation = await this._runtimeDeployment.prepareInstall(runtimeId, options);

        this._log('prepare-install-runtime-complete', preparation);

        return preparation;
    }

    /**
     * Prepare runtime upgrade by identifying changed files.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Upgrade options
     * @returns {Promise<Object>} Preparation result with file counts
     */
    async prepareUpgradeRuntime(runtimeId: string, options: Record<string, unknown> = {}) {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (!this._deviceState.runtimeInstalled) {
            throw new Error('No runtime installed to upgrade');
        }

        // Delegate to RuntimeDeployment
        const preparation = await this._runtimeDeployment.prepareUpgrade(runtimeId, options);

        this._log('prepare-upgrade-runtime-complete', preparation);

        return preparation;
    }

    /**
     * Prepare runtime refresh by building full runtime file list.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Refresh options
     * @returns {Promise<Object>} Preparation result with file counts
     */
    async prepareRefreshRuntime(runtimeId: string, options: Record<string, unknown> = {}) {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        // Delegate to RuntimeDeployment
        const preparation = await this._runtimeDeployment.prepareRefresh(runtimeId, options);

        this._log('prepare-refresh-runtime-complete', preparation);

        return preparation;
    }

    /**
     * Prepare collection deployment by generating files and resolving libraries.
     * Returns total file count for progress tracking.
     * @param {Collection} collection - Collection to deploy
     * @param {Object} options - Deploy options
     * @returns {Promise<Object>} Preparation result with file counts
     */
    async prepareDeployCollection(collection: any, options: Record<string, unknown> = {}) {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (!this._deviceState.runtimeInstalled) {
            throw new Error('Runtime not installed on device');
        }

        // Delegate to CollectionDeployment
        const preparation = await this._collectionDeployment.prepareDeployCollection(
            collection,
            options
        );

        this._log('prepare-deploy-collection-complete', preparation);

        return preparation; // { totalFiles, collectionFiles, libraries }
    }

    /**
     * Install runtime on device.
     * Prompts for target selection on first install and uploads target config.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Installation options
     * @returns {Promise<void>}
     */
    async installRuntime(runtimeId: string, options: Record<string, unknown> = {}) {
        this._log('install-runtime-start', { runtimeId, options });

        try {
            const mpyCompileProfile = await this._resolveMpyCompileProfile(runtimeId);
            const mpyAvailability = await this._resolveMpyAvailabilityReport({
                runtimeId,
                hash: mpyCompileProfile.hash,
                includeTools: true,
                includeRuntime: true,
                includeNodePackages: false,
            });
            const mpyFallbackDecision = await this._resolveMpyFallbackDecision(mpyAvailability);
            if (mpyFallbackDecision === 'cancel') {
                throw new Error(
                    'Deployment canceled: no matching precompiled .mpy profile available.'
                );
            }
            const effectiveMpyAvailability = this._applyMpyFallbackDecision(
                mpyAvailability,
                mpyFallbackDecision
            );

            // 1. Check if device already has a target
            let targetId = this._deviceState.deviceTargetInfo?.id;
            let userDescription =
                this._deviceState.deviceTargetInfo?.instanceData?.userDescription || '';

            if (!targetId) {
                // 2. Prompt user to select target
                const selection = await this._promptTargetSelection(runtimeId);

                if (!selection) {
                    // User cancelled
                    throw new Error(
                        this._i18nService.t('deployment.errors.targetSelectionCancelled')
                    );
                }

                targetId = selection.targetId;
                userDescription = selection.userDescription;
            } else {
                this._log('using-existing-target', { targetId });
            }

            if (!targetId) {
                throw new Error(this._i18nService.t('deployment.errors.targetSelectionCancelled'));
            }

            // 3. Upload target configuration to device
            const targetConfig = await this._uploadTargetConfiguration(
                String(targetId),
                runtimeId,
                String(userDescription ?? '')
            );

            // 4. Install runtime files (delegate to RuntimeDeployment)
            await this._runtimeDeployment.installRuntime(runtimeId, {
                ...options,
                mpyProbe: mpyCompileProfile.probe,
                mpyCompileProfile,
                mpyAvailability: effectiveMpyAvailability,
                mpyFallbackDecision,
            });

            // 5. Update device state with DeviceTargetInfo instance
            this._updateDeviceState({
                deviceTargetInfo: new DeviceTargetInfo(targetConfig),
            });

            this._log('install-runtime-complete', {
                runtimeId,
                targetId,
                targetConfig: targetConfig.displayName,
            });

            this.dispatchEvent(
                new CustomEvent('runtime-installed', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.RuntimeInstalled.v1',
                        { runtimeId, targetId, targetConfig }
                    ),
                })
            );
        } catch (error: any) {
            this._log('runtime-install-failed', 'error', { runtimeId, error: error.message });
            this.dispatchEvent(
                new CustomEvent('runtime-install-failed', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.RuntimeInstallFailed.v1',
                        { runtimeId, error: error.message }
                    ),
                })
            );
            throw error;
        }
    }

    /**
     * Upgrade runtime on device.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Upgrade options
     * @returns {Promise<void>}
     */
    async upgradeRuntime(
        runtimeId: string,
        options: { preserveCollection?: boolean } & Record<string, unknown> = {}
    ) {
        const routingDecision = await this._resolveRuntimeDeployRoutingDecision();
        this._log(
            'runtime-upgrade-routing-decision',
            `runtimeId=${runtimeId}; mode=${routingDecision.mode}; source=${routingDecision.source}; stateMode=${this._deviceState.runtimeDeploymentMode || 'unknown'}; runtimeInstalled=${Boolean(this._deviceState.runtimeInstalled)}`
        );
        if (routingDecision.mode === 'embedded') {
            await this._deployEmbeddedRuntimeCompatibility(runtimeId, 'upgrade', routingDecision);
            return;
        }

        const mpyCompileProfile = await this._resolveMpyCompileProfile(runtimeId);
        const mpyAvailability = await this._resolveMpyAvailabilityReport({
            runtimeId,
            hash: mpyCompileProfile.hash,
            includeTools: true,
            includeRuntime: true,
            includeNodePackages: false,
        });
        const mpyFallbackDecision = await this._resolveMpyFallbackDecision(mpyAvailability);
        if (mpyFallbackDecision === 'cancel') {
            throw new Error('Deployment canceled: no matching precompiled .mpy profile available.');
        }
        const effectiveMpyAvailability = this._applyMpyFallbackDecision(
            mpyAvailability,
            mpyFallbackDecision
        );
        return this._runtimeDeployment.upgradeRuntime(runtimeId, {
            ...options,
            mpyCompileProfile,
            mpyAvailability: effectiveMpyAvailability,
        } as { preserveCollection?: boolean });
    }

    /**
     * Remove runtime from device.
     * @param {Object} options - Removal options
     * @returns {Promise<void>}
     */
    async removeRuntime(options = {}) {
        return this._runtimeDeployment.removeRuntime(options);
    }

    /**
     * Refresh runtime on device (force overwrite).
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Refresh options
     * @returns {Promise<void>}
     */
    async refreshRuntime(
        runtimeId: string,
        options: { preserveCollection?: boolean } & Record<string, unknown> = {}
    ) {
        const routingDecision = await this._resolveRuntimeDeployRoutingDecision();
        this._log(
            'runtime-refresh-routing-decision',
            `runtimeId=${runtimeId}; mode=${routingDecision.mode}; source=${routingDecision.source}; stateMode=${this._deviceState.runtimeDeploymentMode || 'unknown'}; runtimeInstalled=${Boolean(this._deviceState.runtimeInstalled)}`
        );
        if (routingDecision.mode === 'embedded') {
            await this._deployEmbeddedRuntimeCompatibility(runtimeId, 'refresh', routingDecision);
            return;
        }

        const mpyCompileProfile = await this._resolveMpyCompileProfile(runtimeId);
        const mpyAvailability = await this._resolveMpyAvailabilityReport({
            runtimeId,
            hash: mpyCompileProfile.hash,
            includeTools: true,
            includeRuntime: true,
            includeNodePackages: false,
        });
        const mpyFallbackDecision = await this._resolveMpyFallbackDecision(mpyAvailability);
        if (mpyFallbackDecision === 'cancel') {
            throw new Error('Deployment canceled: no matching precompiled .mpy profile available.');
        }
        const effectiveMpyAvailability = this._applyMpyFallbackDecision(
            mpyAvailability,
            mpyFallbackDecision
        );
        return this._runtimeDeployment.refreshRuntime(runtimeId, {
            ...options,
            mpyCompileProfile,
            mpyAvailability: effectiveMpyAvailability,
        } as { preserveCollection?: boolean });
    }

    /**
     * Reconfigure the device target by re-opening the target selection dialog.
     * Pre-fills the current target and user description, persists the updated
     * values to the device, and refreshes device info so the UI reflects them.
     * @returns {Promise<void>}
     */
    async reconfigureDeviceTarget(): Promise<void> {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        const runtimeId = this._deviceState.runtimeId;
        if (!runtimeId) {
            throw new Error('No runtime available for target selection');
        }

        this._log('reconfigure-device-target-start', {
            runtimeId,
            currentTargetId: this._deviceState.deviceTargetInfo?.id ?? null,
        });

        const currentTargetId = this._deviceState.deviceTargetInfo?.id ?? null;
        const currentUserDescription =
            (this._deviceState.deviceTargetInfo?.instanceData?.userDescription as string) || '';

        const selection = await this._promptTargetSelection(runtimeId, {
            allowedTargetIds: null,
            userDescription: currentUserDescription,
            currentTargetId,
        });

        if (!selection) {
            this._log('reconfigure-device-target-cancelled');
            return;
        }

        await this._uploadTargetConfiguration(
            selection.targetId,
            runtimeId,
            selection.userDescription
        );

        await this.refreshDeviceInfo();

        this._log('reconfigure-device-target-complete', {
            targetId: selection.targetId,
        });
    }

    async _deployEmbeddedRuntimeCompatibility(
        runtimeId: string,
        operation: 'upgrade' | 'refresh',
        routingDecision: RuntimeDeployRoutingDecision
    ): Promise<void> {
        this._log(
            'embedded-compatibility-deploy-start',
            `runtimeId=${runtimeId}; operation=${operation}; routingMode=${routingDecision.mode}; routingSource=${routingDecision.source}`
        );

        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (this._deviceState.hasMicroPython !== true) {
            throw new Error('MicroPython not detected on device');
        }

        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        const setupOptions: Record<string, unknown> = {
            force: false,
        };

        const setupResult = await this._queryApplyBootstrapSetupApi(setupOptions);
        if (!setupResult) {
            throw new Error(
                'Embedded bootstrap setup API unavailable or returned invalid payload.'
            );
        }

        const hasSetupErrors =
            setupResult.errors.length > 0 ||
            setupResult.results.some((entry) => entry.action === 'error');

        if (hasSetupErrors) {
            const firstError = setupResult.errors[0];
            const fallbackMessage =
                firstError && typeof firstError.message === 'string'
                    ? firstError.message
                    : 'Embedded bootstrap setup failed.';
            const setupError = new Error(fallbackMessage) as Error & {
                setupResult?: BootstrapSetupApplyPayload;
            };
            setupError.setupResult = setupResult;
            throw setupError;
        }

        await this.refreshDeviceInfo();

        const touchedFiles = setupResult.results.map((entry) => entry.path);

        this._log('runtime-embedded-compatibility-deployed', {
            operation,
            runtimeId: runtime.id,
            source: routingDecision.source,
            files: touchedFiles,
            setupOk: setupResult.ok,
        });

        this.dispatchEvent(
            new CustomEvent('runtime-embedded-compatibility-deployed', {
                detail: new DeviceDeploymentEventPayload(
                    'DeviceDeployment.RuntimeEmbeddedCompatibilityDeployed.v1',
                    {
                        operation,
                        runtimeId: runtime.id,
                        source: routingDecision.source,
                        files: touchedFiles,
                        setupResult,
                    }
                ),
            })
        );

        this.dispatchEvent(
            new CustomEvent('runtime-upgraded', {
                detail: new DeviceDeploymentEventPayload('DeviceDeployment.RuntimeUpgraded.v1', {
                    runtimeId: runtime.id,
                    compatibilityMode: true,
                }),
            })
        );
    }

    /**
     * Get the currently installed runtime on device (if any).
     * Note: Device can only have ONE runtime installed at a time.
     * Delegates to DeviceConnection.loadDeviceInfo() for runtime info.
     * Returns cached result if a request is already in flight.
     * @returns {Promise<Object|null>} Runtime info or null if none installed
     */
    async listInstalledRuntime(): Promise<InstalledRuntimeInfo | null> {
        // Prevent concurrent calls - return existing promise if one is in flight
        if (this._listInstalledRuntimePromise) {
            return this._listInstalledRuntimePromise;
        }

        this._listInstalledRuntimePromise = this._listInstalledRuntimeImpl();
        try {
            return await this._listInstalledRuntimePromise;
        } finally {
            this._listInstalledRuntimePromise = null;
        }
    }

    /**
     * Implementation of listInstalledRuntime.
     * @private
     * @returns {Promise<Object|null>}
     */
    async _listInstalledRuntimeImpl(): Promise<InstalledRuntimeInfo | null> {
        // Auto-refresh connection state if needed
        const actuallyConnected = this._deviceConnection.isConnected();
        if (actuallyConnected && !this._deviceState.connected) {
            this._log('list-runtime-auto-syncing-connection-state', {
                deviceConnection: actuallyConnected,
                deviceState: this._deviceState.connected,
            });
            this._syncConnectionState();
        }

        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        this._log('list-runtime-reading-cached-device-info', {
            deviceConnectionState: this._deviceConnection.getState(),
        });

        try {
            const deviceInfo = this._deviceConnection.getDeviceInfoData() as LooseRecord | null;

            if (!deviceInfo) {
                this._log('list-runtime-cached-device-info-missing');
                return null;
            }

            const runtime = (deviceInfo?.runtime as LooseRecord | null) || null;
            const target = (deviceInfo?.target as LooseRecord | null) || null;

            if (!runtime) {
                return null;
            }

            return {
                id: runtime.id || 'unknown',
                name: runtime.name || 'Unknown Runtime',
                version: runtime.version || 'unknown',
                description: runtime.description || '',
                targetId: target?.id || runtime.targetId || null,
                targetDisplayName: target?.displayName || null,
                targetDescription: target?.description || null,
            };
        } catch (error: any) {
            this._log('list-runtime-error', {
                error: error.message,
                stack: error.stack,
                name: error.name,
            });
            return null;
        }
    }

    // ========================================================================
    // Public API: Collection Operations (delegated to CollectionDeployment)
    // ========================================================================

    /**
     * Build the checkbox fields shared by the deploy and sync options dialogs.
     *
     * These are the general deploy options only. The firmware package override is a separate
     * consent dialog raised by the deploy-time gate, so it is deliberately absent here — the
     * "node packages out of date" dialog must be the same from every entry point.
     * @param {boolean} includeForceUpload - Whether the force upload option applies
     * @returns {FormDialogFieldLike[]} Form field definitions in display order
     * @private
     */
    _buildDeploymentOptionFields(includeForceUpload: boolean): FormDialogFieldLike[] {
        const fields: FormDialogFieldLike[] = [];

        if (includeForceUpload) {
            fields.push({
                id: 'forceUpload',
                type: 'checkbox',
                label: this._i18nService.t('deployment.forceUpload'),
                description: this._i18nService.t('deployment.forceUploadHint'),
                defaultValue: false,
            });
        }

        fields.push({
            id: 'includeFullDefinition',
            type: 'checkbox',
            label: this._i18nService.t('deployment.includeFullDefinition'),
            description: this._i18nService.t('deployment.includeFullDefinitionHint'),
            defaultValue: false,
        });

        return fields;
    }

    /**
     * Resolve the deploy/sync options before the actual upload.
     *
     * The title-bar quick action passes `quickAction: true` and skips this dialog; every other
     * entry point shows the same options dialog here, so both buttons follow one deploy path.
     * A cancellation throws {@link DeploymentOptionsCancelledError} so a caller can stay silent.
     * @param {Object} options - Incoming deploy options
     * @param {'deploy' | 'sync'} kind - Which operation's options are being resolved
     * @returns {Promise<Object>} Options merged with the confirmed dialog values
     * @throws {DeploymentOptionsCancelledError} When the user cancels the dialog
     * @private
     */
    async _resolveDeploymentOptionsDialog(
        options: Record<string, unknown>,
        kind: 'deploy' | 'sync'
    ): Promise<Record<string, unknown>> {
        if (options.quickAction === true) {
            return options;
        }

        const fields = this._buildDeploymentOptionFields(kind === 'deploy');
        this._log('deployment-options-dialog-open', {
            kind,
            fieldIds: fields.map((field) => field.id),
        });

        const result = await this._viewManager.showFormDialog({
            title: this._i18nService.t(
                kind === 'deploy' ? 'deployment.deploymentOptions' : 'deployment.syncOptions'
            ),
            message: '',
            fields,
            confirmLabel: this._i18nService.t(
                kind === 'deploy' ? 'deployment.deploy' : 'deployment.sync'
            ),
            cancelLabel: this._i18nService.t('dialog.cancel'),
        });

        if (!result?.confirmed) {
            throw new DeploymentOptionsCancelledError();
        }

        const formData = (result.formData ?? {}) as Record<string, unknown>;
        const merged: Record<string, unknown> = {
            ...options,
            includeFullDefinition: formData.includeFullDefinition === true,
        };
        if (kind === 'deploy') {
            merged.force = formData.forceUpload === true;
        }
        return merged;
    }

    /**
     * Interactive collection deploy entry point shared by the Device tab and the title bar.
     *
     * The title-bar quick action passes `quickAction: true` so the options dialog is hidden and
     * only the node-packages-out-of-date consent dialog remains; every other caller gets the
     * full options dialog first. Both paths then run {@link deployCollection}.
     * @param {Collection} collection - Collection to deploy
     * @param {Object} options - Deploy options (see {@link deployCollection})
     * @returns {Promise<number>} Number of files uploaded
     */
    async deployCollectionInteractive(
        collection: any,
        options: Record<string, unknown> = {}
    ): Promise<number> {
        const resolved = await this._resolveDeploymentOptionsDialog(options, 'deploy');
        return this.deployCollection(collection, resolved);
    }

    /**
     * Interactive collection sync entry point shared by the Device tab and the title bar.
     *
     * Mirrors {@link deployCollectionInteractive} for the sync path.
     * @param {Collection} collection - Collection to sync
     * @param {Object} options - Sync options (see {@link syncCollectionFiles})
     * @returns {Promise<number>} Number of files uploaded
     */
    async syncCollectionFilesInteractive(
        collection: any,
        options: Record<string, unknown> = {}
    ): Promise<number> {
        const resolved = await this._resolveDeploymentOptionsDialog(options, 'sync');
        return this.syncCollectionFiles(collection, resolved);
    }

    /**
     * Deploy collection to device.
     * Defaults to sync when hashes are available; set force to upload everything.
     * Validates target compatibility before deployment.
     * @param {Collection} collection - Collection to deploy
     * @param {Object} options - Deploy options
     * @param {boolean} options.force - Force full upload instead of sync (default: false)
     * @returns {Promise<number>} Number of files uploaded
     */
    async deployCollection(collection: any, options: Record<string, unknown> = {}) {
        this._log('deploy-collection-start', {
            collectionId: collection.getId(),
            collectionName: collection.getTitle(),
            options,
        });

        try {
            // 1. Check if runtime is installed (detect if not already cached)
            if (!this._deviceState.runtimeId) {
                const cachedDeviceInfo =
                    this._deviceConnection.getDeviceInfoData() as LooseRecord | null;
                const cachedRuntime = (cachedDeviceInfo?.runtime as LooseRecord | null) || null;
                const cachedRuntimeId =
                    typeof cachedRuntime?.id === 'string' && cachedRuntime.id.trim().length > 0
                        ? cachedRuntime.id
                        : null;

                if (!cachedRuntime || !cachedRuntimeId) {
                    throw new Error('No runtime installed on device. Install runtime first.');
                }

                // Update device state using canonical DeviceConnection cache.
                this._updateDeviceState({
                    runtimeInstalled: true,
                    runtimeId: cachedRuntimeId,
                    runtimeVersion:
                        typeof cachedRuntime.version === 'string' ? cachedRuntime.version : null,
                });
            }

            // 2. Get collection's target ID
            const collectionTargetId = collection.getTargetId?.() || 'generic_micropython';

            // 3. Ensure onboarding/initialization gate is complete before target checks
            await this._runDeployInitializationPreflight();

            // 4. Validate target compatibility
            this._validateTargetCompatibility(
                collectionTargetId,
                this._deviceState.deviceTargetInfo?.id,
                this._runtimeCollection?.getRuntime?.(collection.getDeviceRuntimeId?.() || '')
            );

            const routingDecision = await this._resolveRuntimeDeployRoutingDecision();
            this._log('collection-deploy-routing-decision', {
                mode: routingDecision.mode,
                source: routingDecision.source,
                note:
                    routingDecision.mode === 'embedded'
                        ? 'embedded compatibility route gate selected'
                        : routingDecision.mode === 'undetermined'
                          ? 'runtime mode undetermined'
                          : 'default dynamic route gate selected',
            });

            if (routingDecision.mode === 'undetermined') {
                throw new Error('Runtime mode could not be determined. Refresh device info and retry.');
            }

            // 5. Deploy collection files (delegate to CollectionDeployment)
            const mpyCompileProfile = await this._resolveMpyCompileProfile(
                this._deviceState.runtimeId
            );
            const mpyAvailability = await this._resolveMpyAvailabilityReport({
                runtimeId: this._deviceState.runtimeId,
                hash: mpyCompileProfile.hash,
                includeTools: false,
                includeRuntime: false,
                includeNodePackages: true,
                collection,
            });
            const mpyFallbackDecision = await this._resolveMpyFallbackDecision(mpyAvailability);
            if (mpyFallbackDecision === 'cancel') {
                throw new Error(
                    'Deployment canceled: no matching precompiled .mpy profile available.'
                );
            }
            const effectiveMpyAvailability = this._applyMpyFallbackDecision(
                mpyAvailability,
                mpyFallbackDecision
            );
            // Compute which globally-bundled package paths need source overrides and ask the user
            // exactly once before any host source may shadow a firmware package. `force` only
            // bypasses the hash diff; `overrideFirmwarePackages` additionally requests the shadow
            // upload itself.
            const forceShadow = options.overrideFirmwarePackages === true;
            this._log('deploy-collection-before-override-gate', {
                forceShadow,
                overrideFirmwarePackages: options.overrideFirmwarePackages,
                runtimeEmbedded: this._deviceState.runtimeEmbedded === true,
                runtimeDeploymentMode: this._deviceState.runtimeDeploymentMode,
                runtimeId: this._deviceState.runtimeId,
            });
            const embeddedOverridePaths = await this._resolveEmbeddedSourceOverrides(collection, {
                forceShadow,
            });
            this._log('deploy-collection-after-override-gate', {
                forceShadow,
                embeddedOverridePaths,
                overridePathCount: Array.isArray(embeddedOverridePaths)
                    ? embeddedOverridePaths.length
                    : null,
            });
            const filesUploaded = await this._collectionDeployment.deployCollection(collection, {
                ...options,
                mpyProbe: mpyCompileProfile.probe,
                mpyCompileProfile,
                mpyAvailability: effectiveMpyAvailability,
                mpyFallbackDecision,
                ...(embeddedOverridePaths !== null
                    ? { embeddedLibraryOverridePaths: embeddedOverridePaths }
                    : {}),
                ...(forceShadow ? { embeddedOverrideMode: 'forced' as const } : {}),
            });

            this._log('deploy-collection-complete', {
                collectionId: collection.getId(),
                collectionTarget: collectionTargetId,
                deviceTarget: this._deviceState.deviceTargetInfo?.id,
            });

            this.dispatchEvent(
                new CustomEvent('collection-deployed', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.CollectionDeployed.v1',
                        {
                            collectionId: collection.getId(),
                            collectionTarget: collectionTargetId,
                            deviceTarget: this._deviceState.deviceTargetInfo?.id,
                        }
                    ),
                })
            );

            return filesUploaded;
        } catch (error: any) {
            // Show user-friendly error for target mismatch. Use the typed
            // discriminator rather than matching the message text, so an
            // unrelated "does not match" error (e.g. the embedded-runtime
            // version guard) is not misrouted to the target-mismatch dialog.
            if (error?.code === 'target-mismatch') {
                await this._handleTargetMismatchError(error, collection);
            }

            this._log('collection-deploy-failed', 'error', {
                collectionId: collection.getId(),
                error: error.message,
            });
            this.dispatchEvent(
                new CustomEvent('collection-deploy-failed', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.CollectionDeployFailed.v1',
                        {
                            collectionId: collection.getId(),
                            error: error.message,
                        }
                    ),
                })
            );
            throw error;
        }
    }

    async _runDeployInitializationPreflight(): Promise<void> {
        const status = this._latestInitializationStatus;

        const onboardingRequired =
            status?.initializationVerdict === 'needs-onboarding' &&
            status?.onboardingActionable === true;

        if (!onboardingRequired) {
            return;
        }

        this._log('deploy-preflight-onboarding-required', {
            initializationVerdict: status?.initializationVerdict,
            runtimeDeploymentMode: status?.runtimeDeploymentMode,
            specificTargetPresent: status?.specificTargetPresent,
        });

        try {
            await this.refreshDeviceInfo();
        } catch (error: any) {
            const message = String(error?.message || error || 'unknown error');
            if (message.includes('targetSelectionCancelled')) {
                throw new Error(
                    'Onboarding required before deployment: specific target selection was cancelled.'
                );
            }
            throw error;
        }

        if (!this._deviceState.deviceTargetInfo?.id) {
            throw new Error(
                'Onboarding required before deployment: specific target is not configured.'
            );
        }
    }

    /**
     * Sync collection files to device (incremental update).
     * @param {Collection} collection - Collection to sync
     * @param {Object} options - Sync options
     * @returns {Promise<number>} Number of files uploaded
     */
    async syncCollectionFiles(collection: any, options: Record<string, unknown> = {}) {
        const routingDecision = await this._resolveRuntimeDeployRoutingDecision();
        this._log('collection-sync-routing-decision', {
            mode: routingDecision.mode,
            source: routingDecision.source,
            note:
                routingDecision.mode === 'embedded'
                    ? 'embedded compatibility route gate selected'
                    : routingDecision.mode === 'undetermined'
                      ? 'runtime mode undetermined'
                      : 'default dynamic route gate selected',
        });

        if (routingDecision.mode === 'undetermined') {
            throw new Error('Runtime mode could not be determined. Refresh device info and retry.');
        }

        const mpyCompileProfile = await this._resolveMpyCompileProfile(this._deviceState.runtimeId);
        const mpyAvailability = await this._resolveMpyAvailabilityReport({
            runtimeId: this._deviceState.runtimeId,
            hash: mpyCompileProfile.hash,
            includeTools: false,
            includeRuntime: false,
            includeNodePackages: true,
            collection,
        });
        const mpyFallbackDecision = await this._resolveMpyFallbackDecision(mpyAvailability);
        if (mpyFallbackDecision === 'cancel') {
            throw new Error('Deployment canceled: no matching precompiled .mpy profile available.');
        }
        const effectiveMpyAvailability = this._applyMpyFallbackDecision(
            mpyAvailability,
            mpyFallbackDecision
        );
        // Compute which globally-bundled package paths need source overrides and ask the user.
        // `force` only bypasses the hash diff; `overrideFirmwarePackages` additionally requests
        // the shadow upload itself. Mirrors deployCollection() so the sync path also skips
        // firmware-bundled modules.
        const forceShadow = options.overrideFirmwarePackages === true;
        const embeddedOverridePaths = await this._resolveEmbeddedSourceOverrides(collection, {
            forceShadow,
        });
        return this._collectionDeployment.syncCollectionFiles(collection, {
            ...options,
            mpyProbe: mpyCompileProfile.probe,
            mpyCompileProfile,
            mpyAvailability: effectiveMpyAvailability,
            mpyFallbackDecision,
            ...(embeddedOverridePaths !== null
                ? { embeddedLibraryOverridePaths: embeddedOverridePaths }
                : {}),
            ...(forceShadow ? { embeddedOverrideMode: 'forced' as const } : {}),
        });
    }

    _manifestHasMpyProfile(manifest: Record<string, unknown> | null, hash: string): boolean {
        if (!manifest || typeof manifest !== 'object') {
            return false;
        }
        const rawProfiles = manifest.mpyCompileProfiles;
        if (!rawProfiles || typeof rawProfiles !== 'object' || Array.isArray(rawProfiles)) {
            return false;
        }
        return Object.prototype.hasOwnProperty.call(rawProfiles, hash);
    }

    _collectUsedNodePackageIds(
        collection: any,
        runtime: RuntimeLike | null | undefined = null
    ): Set<string> {
        const ids = new Set<string>();
        const graphs = collection?.getGraphArray?.() || [];
        for (const graph of graphs) {
            const nodes = graph?.getNodes?.() || [];
            for (const node of nodes) {
                const nodeType = String(node?.type || '').trim();
                if (!nodeType) {
                    continue;
                }

                const dotIndex = nodeType.indexOf('.');
                const dashIndex = nodeType.indexOf('-');
                const splitIndex =
                    dotIndex >= 0 && dashIndex >= 0
                        ? Math.min(dotIndex, dashIndex)
                        : Math.max(dotIndex, dashIndex);

                const packageId = splitIndex > 0 ? nodeType.slice(0, splitIndex) : nodeType;
                if (packageId) {
                    ids.add(packageId);
                }
            }
        }

        this._expandRequiredPackageIds(
            ids,
            (runtime?.nodePackages ?? []) as RuntimeNodePackageLike[]
        );

        return ids;
    }

    _collectUsedNodePackageAssetKeys(
        collection: any,
        runtime: RuntimeLike | null | undefined = null
    ): Map<string, Set<string>> {
        const packageAssetKeysInUse = new Map<string, Set<string>>();
        const graphs = collection?.getGraphArray?.() || [];
        for (const graph of graphs) {
            const nodes = graph?.getNodes?.() || [];
            for (const node of nodes) {
                const nodeType = String(node?.type || '').trim();
                if (!nodeType) {
                    continue;
                }

                const dotIndex = nodeType.indexOf('.');
                const dashIndex = nodeType.indexOf('-');
                const splitIndex =
                    dotIndex >= 0 && dashIndex >= 0
                        ? Math.min(dotIndex, dashIndex)
                        : Math.max(dotIndex, dashIndex);

                const packageId = splitIndex > 0 ? nodeType.slice(0, splitIndex).trim() : nodeType;
                if (!packageId) {
                    continue;
                }

                const keySet = packageAssetKeysInUse.get(packageId) || new Set<string>();
                keySet.add('*');
                if (splitIndex > 0 && splitIndex + 1 < nodeType.length) {
                    keySet.add(nodeType.slice(splitIndex + 1));
                }
                packageAssetKeysInUse.set(packageId, keySet);
            }
        }

        this._expandRequiredPackages(
            packageAssetKeysInUse,
            (runtime?.nodePackages ?? []) as RuntimeNodePackageLike[]
        );

        return packageAssetKeysInUse;
    }

    /**
     * Add transitively required package ids to an in-use id set.
     *
     * Every package in use pulls its `requiredPackages` in, so a dependency is reported as used
     * even when the collection contains no node from that package.
     * @param {Set<string>} ids - package ids in use, extended in place
     * @param {Array<Object>} nodePackages - runtime package descriptors with `requiredPackages`
     */
    _expandRequiredPackageIds(ids: Set<string>, nodePackages: RuntimeNodePackageLike[]): void {
        const requiredById = new Map<string, string[]>();
        for (const nodePackage of nodePackages) {
            const packageId = String(nodePackage?.id || '').trim();
            if (!packageId) {
                continue;
            }
            const rawRequired = nodePackage?.requiredPackages;
            requiredById.set(
                packageId,
                Array.isArray(rawRequired)
                    ? rawRequired.map((entry) => String(entry || '').trim()).filter(Boolean)
                    : []
            );
        }

        const queue = Array.from(ids);
        while (queue.length > 0) {
            const packageId = queue.shift() as string;
            for (const dependencyId of requiredById.get(packageId) || []) {
                if (ids.has(dependencyId)) {
                    continue;
                }
                ids.add(dependencyId);
                queue.push(dependencyId);
            }
        }
    }

    /**
     * Add transitively required packages to the in-use asset key map.
     *
     * Required packages are added with the wildcard key '*', so a dependency's package-wide
     * `mpAssets` ship even when the collection contains no node from that package.
     * @param {Map<string, Set<string>>} packageAssetKeysInUse - package id -> requested asset keys
     * @param {Array<Object>} nodePackages - runtime package descriptors with `requiredPackages`
     */
    _expandRequiredPackages(
        packageAssetKeysInUse: Map<string, Set<string>>,
        nodePackages: RuntimeNodePackageLike[]
    ): void {
        const ids = new Set<string>(packageAssetKeysInUse.keys());
        this._expandRequiredPackageIds(ids, nodePackages);
        for (const packageId of ids) {
            if (!packageAssetKeysInUse.has(packageId)) {
                packageAssetKeysInUse.set(packageId, new Set<string>(['*']));
            }
        }
    }

    _collectNodePackageRequiredSourceAssets(
        nodePackage: { mpAssets?: Record<string, unknown> } | null | undefined,
        requestedKeys: Set<string>
    ): string[] {
        if (!nodePackage || !(requestedKeys instanceof Set) || requestedKeys.size === 0) {
            return [];
        }

        const mpAssets = nodePackage.mpAssets;
        if (!mpAssets || typeof mpAssets !== 'object') {
            return [];
        }

        const required = new Set<string>();
        for (const key of requestedKeys) {
            const rawList = (mpAssets as Record<string, unknown>)[key];
            if (!Array.isArray(rawList)) {
                continue;
            }

            for (const assetUrl of rawList) {
                if (typeof assetUrl !== 'string') {
                    continue;
                }
                if (!assetUrl.endsWith('.py')) {
                    continue;
                }
                required.add(assetUrl);
            }
        }

        return Array.from(required);
    }

    _buildMpyArtifactUrlForSource(sourceUrl: string, profileHash: string): string {
        const baseOrigin =
            typeof window !== 'undefined' && window?.location?.origin
                ? window.location.origin
                : 'http://localhost';
        const urlObj = new URL(sourceUrl, baseOrigin);
        const normalizedPath = urlObj.pathname.replace(/\\/g, '/');
        const match = normalizedPath.match(/^(.*\/)([^/]+)\.py$/);
        if (!match) {
            return sourceUrl;
        }

        const [, dir, fileName] = match;
        urlObj.pathname = `${dir}__mpycache__/${profileHash}/${fileName}.mpy`;
        return urlObj.toString();
    }

    async _findMissingMpyArtifactsForSourceAssets(
        sourceAssets: string[],
        profileHash: string
    ): Promise<string[]> {
        const missing: string[] = [];
        for (const sourceAsset of sourceAssets) {
            const mpyUrl = this._buildMpyArtifactUrlForSource(sourceAsset, profileHash);
            if (mpyUrl === sourceAsset) {
                missing.push(mpyUrl);
                continue;
            }

            try {
                const response = await fetch(mpyUrl, { cache: 'no-store' });
                if (!response.ok) {
                    missing.push(mpyUrl);
                }
            } catch {
                missing.push(mpyUrl);
            }
        }
        return missing;
    }

    async _resolveMpyAvailabilityReport({
        runtimeId,
        hash,
        includeTools,
        includeRuntime,
        includeNodePackages,
        collection = null,
    }: {
        runtimeId: string | null | undefined;
        hash: string;
        includeTools: boolean;
        includeRuntime: boolean;
        includeNodePackages: boolean;
        collection?: any;
    }): Promise<MpyAvailabilityReport> {
        const report: MpyAvailabilityReport = {
            hash,
            tools: {
                required: includeTools,
                hasProfile: false,
                manifestPath: '/device/tools/manifest.json',
            },
            runtime: {
                required: includeRuntime,
                hasProfile: false,
                manifestPath: runtimeId
                    ? `/device/runtime/${runtimeId}/manifest.json`
                    : '/device/runtime/manifest.json',
                packageId: runtimeId || undefined,
            },
            nodePackages: [],
        };

        if (includeTools) {
            try {
                const response = await fetch('/device/tools/manifest.json', { cache: 'no-store' });
                if (response.ok) {
                    const manifest = (await response.json()) as Record<string, unknown>;
                    report.tools.hasProfile = this._manifestHasMpyProfile(manifest, hash);
                }
            } catch (error: any) {
                this._log('mpy-availability-tools-manifest-failed', {
                    error: error.message,
                });
            }
        }

        const resolvedRuntime = runtimeId ? this._runtimeCollection?.getRuntime(runtimeId) : null;
        if (includeRuntime && resolvedRuntime?.manifest) {
            report.runtime.hasProfile = this._manifestHasMpyProfile(
                resolvedRuntime.manifest as Record<string, unknown>,
                hash
            );
        }

        if (includeNodePackages && resolvedRuntime) {
            const usedPackageIds = this._collectUsedNodePackageIds(collection, resolvedRuntime);
            const usedPackageAssetKeys = this._collectUsedNodePackageAssetKeys(
                collection,
                resolvedRuntime
            );
            const nodePackages = Array.isArray(resolvedRuntime.nodePackages)
                ? resolvedRuntime.nodePackages
                : [];
            const globalPackageIds = new Set<string>(
                Array.isArray(resolvedRuntime.nodePackagesGlobal)
                    ? resolvedRuntime.nodePackagesGlobal
                    : []
            );

            for (const nodePackage of nodePackages) {
                const packageId = String(nodePackage?.id || '').trim();
                if (!packageId) {
                    continue;
                }
                if (usedPackageIds.size > 0 && !usedPackageIds.has(packageId)) {
                    continue;
                }

                const manifestPath = `${String(nodePackage.packageRoot || '').replace(/\/$/, '')}/manifest.json`;
                let hasProfile = this._manifestHasMpyProfile(
                    (nodePackage?.manifest || null) as Record<string, unknown> | null,
                    hash
                );
                let missingArtifacts: string[] = [];
                if (hasProfile) {
                    const requestedAssetKeys = usedPackageAssetKeys.get(packageId);
                    if (requestedAssetKeys && requestedAssetKeys.size > 0) {
                        const requiredSourceAssets = this._collectNodePackageRequiredSourceAssets(
                            nodePackage,
                            requestedAssetKeys
                        );
                        missingArtifacts = await this._findMissingMpyArtifactsForSourceAssets(
                            requiredSourceAssets,
                            hash
                        );
                        if (missingArtifacts.length > 0) {
                            hasProfile = false;
                            this._log('mpy-node-package-artifacts-missing', {
                                packageId,
                                hash,
                                missingArtifacts,
                            });
                        }
                    }
                }

                const entry: NodePackageMpyAvailabilityEntry = {
                    required: !globalPackageIds.has(packageId),
                    hasProfile,
                    packageId,
                    manifestPath,
                };
                if (missingArtifacts.length > 0) {
                    entry.missingArtifacts = missingArtifacts;
                }
                report.nodePackages.push(entry);
            }
        }

        this._log('mpy-availability-report-ready', {
            hash,
            tools: report.tools.hasProfile,
            runtime: report.runtime.hasProfile,
            nodePackages: report.nodePackages.map((entry) => ({
                packageId: entry.packageId,
                hasProfile: entry.hasProfile,
            })),
        });

        return report;
    }

    _listMissingMpyProfiles(report: MpyAvailabilityReport): string[] {
        const missing: string[] = [];

        if (report.tools.required && !report.tools.hasProfile) {
            missing.push('tools');
        }

        if (report.runtime.required && !report.runtime.hasProfile) {
            missing.push(`runtime:${report.runtime.packageId || 'unknown'}`);
        }

        for (const nodePackage of report.nodePackages) {
            if (nodePackage.required && !nodePackage.hasProfile) {
                missing.push(`node-package:${nodePackage.packageId || 'unknown'}`);
            }
        }

        return missing;
    }

    async _resolveMpyFallbackDecision(report: MpyAvailabilityReport): Promise<MpyFallbackDecision> {
        const missingProfiles = this._listMissingMpyProfiles(report);
        if (missingProfiles.length === 0) {
            return 'mpy';
        }

        const result = await this._viewManager.showFormDialog({
            title: 'Precompiled MPY Files Not Available',
            message: [
                'No matching precompiled .mpy files are available for this connected device profile.',
                '',
                `Missing profiles: ${missingProfiles.join(', ')}`,
                '',
                'Continue with .py source upload instead? This may cause runtime issues on low-memory devices.',
            ].join('\n'),
            fields: [],
            confirmLabel: 'Continue With Source Upload',
            cancelLabel: 'Cancel Deployment',
        });

        return result?.confirmed ? 'source' : 'cancel';
    }

    _applyMpyFallbackDecision(
        report: MpyAvailabilityReport,
        decision: MpyFallbackDecision
    ): MpyAvailabilityReport {
        if (decision !== 'source') {
            return report;
        }

        return {
            hash: report.hash,
            tools: {
                ...report.tools,
                hasProfile: false,
            },
            runtime: {
                ...report.runtime,
                hasProfile: false,
            },
            nodePackages: report.nodePackages.map((nodePackage) => ({
                ...nodePackage,
                hasProfile: false,
            })),
        };
    }

    async _resolveMpyCompileProfile(runtimeId: string | null = null): Promise<MpyCompileProfile> {
        const probe = await this._probeMpyCompileParameters();
        const emit: MpyCompileParams['emit'] = 'bytecode';
        const fallbackCompileParams: MpyCompileParams = {
            mpyCrossVersion: this._deriveMpyCrossVersionFromProbe(probe),
            emit: 'bytecode',
            smallIntBits: probe.smallIntBits,
            march: this._inferMpyMarch(probe, emit),
            marchFlags: null,
        };

        const manifestMatch = this._resolveManifestMpyCompileProfile(
            runtimeId,
            {
                emit,
                smallIntBits: fallbackCompileParams.smallIntBits,
                march: fallbackCompileParams.march,
                marchFlags: fallbackCompileParams.marchFlags,
            },
            this._deriveMpyVersionPrefix(probe)
        );

        const compileParams = manifestMatch?.compileParams || fallbackCompileParams;

        const hash = manifestMatch?.hash || 'unmatched-profile';
        const profile: MpyCompileProfile = {
            probe,
            compileParams,
            hash,
        };

        this._lastMpyCompileProfile = profile;
        this._log('mpy-compile-profile-ready', {
            hash,
            emit: compileParams.emit,
            smallIntBits: compileParams.smallIntBits,
            march: compileParams.march,
            source: manifestMatch ? 'manifest' : 'probe-derived',
        });

        return profile;
    }

    _deriveMpyVersionPrefix(probe: MpyProbeParams): string {
        const major = probe.versionMajor ?? 0;
        const minor = probe.versionMinor ?? 0;
        const patch = probe.versionPatch ?? 0;
        return `MicroPython v${major}.${minor}.${patch}`;
    }

    _deriveMpyCrossVersionFromProbe(probe: MpyProbeParams): string {
        const suffix = probe.versionSuffix || '';
        const abi = probe.mpyAbi ?? 'unknown';
        return `${this._deriveMpyVersionPrefix(probe)}${suffix}; mpy-abi ${abi}`;
    }

    _inferMpyMarch(probe: MpyProbeParams, emit: MpyCompileParams['emit']): string | null {
        if (emit !== 'native' && emit !== 'viper') {
            return null;
        }

        const platform = (probe.platform || '').toLowerCase();
        const machine = (probe.machine || '').toLowerCase();

        if (platform.includes('esp32') || machine.includes('esp32')) {
            if (machine.includes('c3') || machine.includes('c6') || machine.includes('h2')) {
                return 'rv32imc';
            }
            return 'xtensawin';
        }

        if (platform.includes('rp2') || machine.includes('rpi pico')) {
            return 'armv6m';
        }

        return null;
    }

    _resolveManifestMpyCompileProfile(
        runtimeId: string | null,
        selector: Omit<MpyCompileParams, 'mpyCrossVersion'>,
        mpyVersionPrefix: string
    ): { hash: string; compileParams: MpyCompileParams } | null {
        const normalizedRuntimeId = String(runtimeId || '').trim();
        if (!normalizedRuntimeId) {
            return null;
        }

        const runtime = this._runtimeCollection?.getRuntime(normalizedRuntimeId);
        const manifest = runtime?.manifest;
        if (!manifest || typeof manifest !== 'object') {
            return null;
        }

        const rawProfiles = manifest.mpyCompileProfiles;
        if (!rawProfiles || typeof rawProfiles !== 'object' || Array.isArray(rawProfiles)) {
            return null;
        }

        const matches: Array<{ hash: string; compileParams: MpyCompileParams }> = [];

        for (const [hash, profile] of Object.entries(rawProfiles)) {
            if (typeof hash !== 'string' || !hash) {
                continue;
            }
            if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
                continue;
            }

            const profileObj = profile as Record<string, unknown>;
            const mpyCrossVersion =
                typeof profileObj.mpyCrossVersion === 'string' ? profileObj.mpyCrossVersion : '';
            if (!mpyCrossVersion) {
                continue;
            }

            const emitValue =
                profileObj.emit === 'native' || profileObj.emit === 'viper'
                    ? profileObj.emit
                    : 'bytecode';
            const smallIntBits =
                typeof profileObj.smallIntBits === 'number' &&
                Number.isFinite(profileObj.smallIntBits)
                    ? profileObj.smallIntBits
                    : null;
            const march =
                typeof profileObj.march === 'string' && profileObj.march.trim()
                    ? profileObj.march
                    : null;
            const marchFlags =
                typeof profileObj.marchFlags === 'string' && profileObj.marchFlags.trim()
                    ? profileObj.marchFlags
                    : null;

            if (
                emitValue !== selector.emit ||
                smallIntBits !== selector.smallIntBits ||
                march !== selector.march ||
                marchFlags !== selector.marchFlags
            ) {
                continue;
            }

            matches.push({
                hash,
                compileParams: {
                    mpyCrossVersion,
                    emit: emitValue,
                    smallIntBits,
                    march,
                    marchFlags,
                },
            });
        }

        const versionMatches = matches.filter((match) =>
            match.compileParams.mpyCrossVersion.startsWith(mpyVersionPrefix)
        );
        if (versionMatches.length === 0) {
            return null;
        }

        versionMatches.sort((a, b) => a.hash.localeCompare(b.hash));
        return versionMatches[0];
    }

    async _probeMpyCompileParameters(): Promise<MpyProbeParams> {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        let output = '';
        try {
            output = await this._deviceConnection.executeCode(MPY_PROBE_SNIPPET);
        } catch (error: any) {
            throw new Error(`Failed to probe MPY compile parameters: ${error.message}`);
        }

        const startIndex = output.indexOf(MPY_PROBE_START);
        const endIndex = output.indexOf(MPY_PROBE_END);
        if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
            throw new Error('Failed to probe MPY compile parameters: probe markers not found');
        }

        const payload = output.slice(startIndex + MPY_PROBE_START.length, endIndex).trim();
        let parsed: Record<string, unknown>;
        try {
            parsed = parseJsonFromDeviceText<Record<string, unknown>>(payload);
        } catch (error: any) {
            throw new Error(
                `Failed to probe MPY compile parameters: invalid JSON payload (${error.message})`
            );
        }

        const toIntOrNull = (value: unknown): number | null =>
            typeof value === 'number' && Number.isFinite(value) ? value : null;
        const toStringOrNull = (value: unknown): string | null =>
            typeof value === 'string' && value.trim() ? value : null;

        const result: MpyProbeParams = {
            versionMajor: toIntOrNull(parsed.versionMajor),
            versionMinor: toIntOrNull(parsed.versionMinor),
            versionPatch: toIntOrNull(parsed.versionPatch),
            versionSuffix: toStringOrNull(parsed.versionSuffix),
            mpyAbi: toIntOrNull(parsed.mpyAbi),
            platform: toStringOrNull(parsed.platform),
            machine: toStringOrNull(parsed.machine),
            release: toStringOrNull(parsed.release),
            maxsize: toIntOrNull(parsed.maxsize),
            wordBits: toIntOrNull(parsed.wordBits),
            smallIntBits: toIntOrNull(parsed.smallIntBits),
        };

        this._lastMpyProbeParams = result;
        this._log('mpy-probe-success', {
            mpyAbi: result.mpyAbi,
            platform: result.platform,
            smallIntBits: result.smallIntBits,
        });

        return result;
    }

    /**
     * Remove collection from device.
     * @param {Object} options - Removal options
     * @returns {Promise<void>}
     */
    async removeCollection(options = {}) {
        return this._collectionDeployment.removeCollection(options);
    }

    /**
     * Return the `libs/` / `otter_*` paths the device user space holds according to the sync
     * manifest. Display-only metadata for the Device Info block; deployment never reads it.
     *
     * Because it reads the manifest rather than the device filesystem, it reflects what the host
     * last uploaded (or recorded), not the physical directory listing.
     * @returns {Promise<string[]>} Sorted device paths, `[]` when the manifest is unreadable
     */
    async getDynamicLibraryPathsOnDevice(): Promise<string[]> {
        return this._collectionDeployment.getDynamicLibraryPathsOnDevice();
    }

    /**
     * Validate collection compatibility with device capabilities.
     * Returns validation result without throwing errors.
     *
     * NOTE: This method caches device state discovered during validation (runtime info,
     * target capabilities) and emits a SINGLE 'device-state-changed' event at the end
     * if state was modified. This prevents event loops while still updating the UI.
     * The in-flight deduplication in listInstalledRuntime() prevents concurrent reads.
     *
     * @param {Collection} collection - Collection to validate
     * @returns {Promise<{compatible: boolean, errors: string[]}>} Validation result
     */
    async validateCollectionCompatibility(collection: any) {
        const errors = [];

        // Check device connection (use cached state)
        if (!this._deviceState.connected) {
            errors.push('Device not connected');
            return { compatible: false, errors };
        }

        // Check runtime installed (use cached state - don't load)
        if (!this._deviceState.runtimeInstalled) {
            errors.push('Runtime not installed on device');
            return { compatible: false, errors };
        }

        // Check target capabilities loaded (use cached state). The cached target is only set when
        // the reader adopted a complete payload that matches the flashed image; the reason it is
        // missing decides whether the user must repair or re-select from the same board family.
        if (!this._deviceState.deviceTargetInfo) {
            errors.push(
                this._i18nService.t(
                    this._targetConfigurationIssue === 'image-incompatible'
                        ? 'deployment.errors.deviceTargetIncompatible'
                        : 'deployment.errors.deviceTargetNotConfigured'
                )
            );
            return { compatible: false, errors };
        }

        // Check target compatibility: collection's target must match device's target
        const collectionTargetId = collection.getTargetId?.() || 'generic_micropython';
        const rawTargetInfo = this._deviceState.deviceTargetInfo as unknown as LooseRecord;
        const deviceTargetInfo: DeviceTargetInfo =
            rawTargetInfo instanceof DeviceTargetInfo
                ? rawTargetInfo
                : new DeviceTargetInfo({
                      id: rawTargetInfo.id ?? undefined,
                      displayName: rawTargetInfo.displayName ?? undefined,
                      capabilityToPins: rawTargetInfo.capabilityToPins || {},
                      generalCapabilities: rawTargetInfo.generalCapabilities || {},
                  });
        const deviceTargetId = deviceTargetInfo.id;

        if (collectionTargetId !== deviceTargetId) {
            const deviceDisplayName = deviceTargetInfo.displayName || deviceTargetId;

            // Get the collection target's display name from the runtime
            const collectionRuntimeId = collection.getDeviceRuntimeId?.() || 'general';
            const runtime = this._runtimeCollection?.getRuntime(collectionRuntimeId);
            const collectionTargetInfo = runtime?.getDeviceTarget?.(collectionTargetId);
            const collectionDisplayName = collectionTargetInfo?.displayName || collectionTargetId;

            errors.push(
                `Target mismatch: Collection designed for ${collectionDisplayName} but device is ${deviceDisplayName}`
            );
            return { compatible: false, errors };
        }

        // Pure validation logic - no state mutation
        const collectionRuntimeId = collection.getDeviceRuntimeId?.() || 'general';
        const runtime = this._runtimeCollection?.getRuntime(collectionRuntimeId);

        if (!runtime) {
            errors.push('Cannot validate: runtime not found in collection');
            return { compatible: false, errors };
        }

        // Walk the graphs per node: derived requirements depend on each node's control values.
        const nodes = (collection.getGraphArray?.() || []).flatMap(
            (graph: any) => graph.getNodes?.() || []
        );
        const resolvedTypes = new Map<string, RuntimeNodeTypeLike | null>();
        const reportedMissingTypes = new Set<string>();
        const reportedCapabilityPaths = new Set<string>();

        // Validate each node against capabilities
        for (const node of nodes) {
            const nodeTypeId = String(node.type);
            // Function-graph-managed ids have no runtime node type: the transpiler generates the
            // call node body and the structural signature nodes from the owning collection, and the
            // real work of a call node is validated on the callee graph itself. Reporting them here
            // would block every upload of a collection that uses a function graph.
            if (isFunctionGraphManagedNodeType(nodeTypeId)) {
                continue;
            }
            let nodeType = resolvedTypes.get(nodeTypeId);
            if (nodeType === undefined) {
                nodeType = runtime.getNodeType?.(nodeTypeId) || null;
                resolvedTypes.set(nodeTypeId, nodeType);
            }
            if (!nodeType) {
                if (!reportedMissingTypes.has(nodeTypeId)) {
                    reportedMissingTypes.add(nodeTypeId);
                    errors.push(`Node type not found: ${nodeTypeId}`);
                }
                continue;
            }

            // Check required capabilities (declared plus derived from resourceUsage)
            const required = resolveNodeCapabilityRequirements(nodeType, node);
            const result = evaluateRequiredCapabilities(required, {
                isGeneral(capability) {
                    return deviceTargetInfo.capabilityRegistry.getDomain(capability) === 'general';
                },
                hasGeneralCapability(capability) {
                    const entry = deviceTargetInfo.generalCapabilities[capability];
                    return (
                        !!entry &&
                        typeof entry === 'object' &&
                        (entry as { supported?: unknown }).supported === true
                    );
                },
                hasPinCapability(capability) {
                    const pins = deviceTargetInfo.getPinsForCapability(capability) as
                        | unknown[]
                        | null
                        | undefined;
                    return !!pins && pins.length > 0;
                },
            });
            for (const group of result.missing) {
                const capabilityPath = group.join(' or ');
                const reportedKey = `${nodeTypeId}\u0000${capabilityPath}`;
                if (reportedCapabilityPaths.has(reportedKey)) {
                    continue;
                }
                reportedCapabilityPaths.add(reportedKey);
                errors.push(`Missing required capability for ${nodeTypeId}: ${capabilityPath}`);
            }
        }

        return {
            compatible: errors.length === 0,
            errors,
        };
    }

    /**
     * Read the package versions bundled with the connected device's firmware.
     * Prefers `embeddedPackagesSummary` and falls back to
     * `firmwareConstituentVersions.nodePackages`.
     * @private
     * @returns {Object|null} Package id → version map, or null when no version source is known
     */
    _resolveFirmwarePackageVersions(): Record<string, string> | null {
        const packagesSummary = this._deviceState.embeddedPackagesSummary;
        if (packagesSummary != null) {
            const versions: Record<string, string> = {};
            for (const p of packagesSummary.packages ?? []) {
                if (p.name && typeof p.version === 'string') {
                    versions[p.name] = p.version;
                }
            }
            return versions;
        }
        const cv = this._deviceState.firmwareConstituentVersions;
        if (!cv?.nodePackages) {
            return null;
        }
        return {
            ...cv.nodePackages,
            ...resolveFrozenAddonVersions(cv),
        };
    }

    /**
     * Paths of the files the firmware itself provides (`source === 'embedded'`), or null when
     * the inventory is unreadable. Dynamic (user-space) entries never count as firmware-provided.
     * @private
     * @returns {Set<string>|null}
     */
    _getEmbeddedInventoryPathSet(): Set<string> | null {
        const inventory = this._deviceState.embeddedInventory;
        if (inventory == null) {
            return null;
        }
        return new Set(
            (inventory.files || [])
                .filter((file) => file?.source === 'embedded')
                .map((file) => file.path)
        );
    }

    /**
     * Resolve the collection's declared runtime id, defaulting to `general`.
     *
     * This is the id the collection was authored against; it is only a fallback for the runtime
     * the plan actually uses (see {@link _resolveEmbeddedPlanRuntime}).
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @returns {string} Trimmed runtime id, never empty
     */
    _resolveCollectionRuntimeId(collection: any): string {
        const rawId = collection?.getDeviceRuntimeId?.();
        const runtimeId = typeof rawId === 'string' ? rawId.trim() : '';
        return runtimeId || 'general';
    }

    /**
     * Resolve the one runtime every embedded decision is based on.
     *
     * Resolution order is fixed and documented: the connected device's runtime id first (it is the
     * only source that knows what the firmware really bundles), then the collection's declared
     * runtime id. Returning the runtime *and* its source lets the preflight log explain which one
     * answered, so a device state that has not been loaded yet is visible instead of silent.
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @returns {EmbeddedPlanRuntime|null} Resolved runtime, or null when neither id is known to the
     *          runtime collection
     */
    _resolveEmbeddedPlanRuntime(collection: any): EmbeddedPlanRuntime | null {
        const collectionRuntimeId = this._resolveCollectionRuntimeId(collection);
        const deviceRuntimeId =
            typeof this._deviceState.runtimeId === 'string' && this._deviceState.runtimeId.trim()
                ? this._deviceState.runtimeId.trim()
                : null;

        const candidates: Array<{ runtimeId: string; runtimeIdSource: EmbeddedRuntimeIdSource }> = [];
        if (deviceRuntimeId) {
            candidates.push({ runtimeId: deviceRuntimeId, runtimeIdSource: 'device-state' });
        }
        if (collectionRuntimeId !== deviceRuntimeId) {
            candidates.push({ runtimeId: collectionRuntimeId, runtimeIdSource: 'collection' });
        }

        for (const candidate of candidates) {
            const runtime = this._runtimeCollection?.getRuntime(candidate.runtimeId) as
                | RuntimeLike
                | null
                | undefined;
            if (runtime) {
                return { ...candidate, runtime };
            }
        }

        return null;
    }

    /**
     * Resolve the firmware module plan for a collection about to be deployed.
     *
     * This is the single source of truth for "host source would shadow firmware": the
     * compatibility warnings of {@link validateNodePackages} and the deploy-time override plan of
     * {@link _computeEmbeddedOverridePlan} both read it, so a warning and an actual shadow upload
     * can never disagree.
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @param {RuntimeLike} runtime - Runtime supplying the host package descriptors
     * @returns {FirmwareModulePlan} The resolved plan (empty when not embedded)
     */
    _resolveEmbeddedPlan(collection: any, runtime: RuntimeLike): FirmwareModulePlan {
        const nodePackages = (runtime?.nodePackages ?? []) as RuntimeNodePackageLike[];
        const globalPackageIds = resolveFirmwareBundledPackageIds(
            runtime?.nodePackagesGlobal ?? [],
            this._deviceState.firmwareConstituentVersions
        );
        const packageAssetKeysInUse = this._collectUsedNodePackageAssetKeys(collection, runtime);

        const declaredPaths = new Set<string>();
        const pathToPackageId = new Map<string, string>();
        const packageAssetPaths = new Map<string, string[]>();
        const hostVersions = new Map<string, string | null>();

        for (const nodePackage of nodePackages) {
            const packageId = String(nodePackage?.id || '').trim();
            const hostVersion =
                nodePackage?.manifest && typeof nodePackage.manifest['version'] === 'string'
                    ? (nodePackage.manifest['version'] as string)
                    : null;
            if (packageId) {
                hostVersions.set(packageId, hostVersion);
                packageAssetPaths.set(packageId, this._collectPackageAssetPaths(nodePackage));
            }

            const requestedKeys = packageAssetKeysInUse.get(packageId);
            if (!requestedKeys || requestedKeys.size === 0) {
                continue;
            }

            // A package is in use as a whole: its complete asset set is the declared surface.
            // The exact graph imports are the collection-side plan's concern; the consent plan
            // only needs to know which packages to shadow, and shadowing is always whole-package.
            for (const libPath of packageAssetPaths.get(packageId) ?? []) {
                declaredPaths.add(libPath);
                pathToPackageId.set(libPath, packageId);
            }
        }

        const firmwareVersionsRecord = this._resolveFirmwarePackageVersions();
        const firmwareVersions = firmwareVersionsRecord
            ? new Map<string, string | null>(Object.entries(firmwareVersionsRecord))
            : null;

        // A global package is in scope whenever the collection uses it, even if its manifest
        // declares no mpAssets (a version-only package still drives the shadow decision).
        const inScopePackageIds = new Set<string>();
        for (const packageId of packageAssetKeysInUse.keys()) {
            if (globalPackageIds.has(packageId)) {
                inScopePackageIds.add(packageId);
            }
        }

        // A frozen add-on's other-variant module folder is stale: the firmware froze one
        // implementation, so the leftover folder for the other variant must be removed.
        const frozenAddons = this._deviceState.firmwareConstituentVersions?.frozenAddons ?? {};
        const stalePackageFolders = new Set<string>();
        for (const [packageId, record] of Object.entries(frozenAddons)) {
            const frozenRoot = addonModuleRoot(packageId, record?.variant ?? 'py');
            for (const assetPath of packageAssetPaths.get(packageId) ?? []) {
                const root = assetPath.split('/')[0];
                if (root && root !== frozenRoot && isPackageModulePath(root)) {
                    stalePackageFolders.add(root);
                }
            }
        }

        const plan = resolveFirmwareModulePlan({
            embeddedMode: this._deviceState.runtimeEmbedded === true,
            declaredPaths,
            pathToPackageId,
            packageAssetPaths,
            globalPackageIds,
            inScopePackageIds,
            inventoryPaths: this._getEmbeddedInventoryPathSet(),
            firmwareVersions,
            hostVersions,
            hostHasPath: (path) =>
                this._collectionDeployment.isLibraryAvailableOnHost(path, runtime),
            stalePackageFolders,
        });

        this._log('embedded-plan-resolved', {
            embeddedMode: this._deviceState.runtimeEmbedded === true,
            shadowPackages: Array.from(plan.shadowPackages.keys()),
            firmwareOwnedPackageIds: Array.from(plan.firmwareOwnedPackageIds),
            inScopePackageIds: Array.from(inScopePackageIds),
            globalPackageIds: Array.from(globalPackageIds),
            firmwareVersions: firmwareVersions ? Array.from(firmwareVersions.entries()) : null,
            hostVersions: Array.from(hostVersions.entries()),
            declaredPathCount: declaredPaths.size,
            uploadPathCount: plan.uploadPaths.size,
        });

        return plan;
    }

    /**
     * Build the per-package shadow entries for one resolved plan.
     *
     * Versions come from the firmware's own package version sources
     * (`embeddedPackagesSummary` / `firmwareConstituentVersions.nodePackages`) and the host
     * manifest; the `firmware-unknown` reason keeps the `unknown` sentinel instead of inventing
     * a version.
     * @private
     * @param {FirmwareModulePlan} plan - Resolved firmware module plan
     * @param {Object|null} runtime - Runtime supplying the host package descriptors
     * @returns {Array<Object>} Shadow entries sorted by package id
     */
    _buildOutdatedEmbeddedPackages(
        plan: FirmwareModulePlan,
        runtime: RuntimeLike | null
    ): OutdatedEmbeddedPackage[] {
        const nodePackages = (runtime?.nodePackages ?? []) as RuntimeNodePackageLike[];
        const firmwareVersions = this._resolveFirmwarePackageVersions();
        const entries: OutdatedEmbeddedPackage[] = [];

        for (const [packageId, reason] of plan.shadowPackages) {
            entries.push(
                this._buildEmbeddedPackageEntry(packageId, reason, nodePackages, firmwareVersions)
            );
        }

        entries.sort((a, b) => a.packageId.localeCompare(b.packageId));
        return entries;
    }

    /**
     * Build one shadow entry, resolving both versions from the sources the warnings use.
     * @private
     * @param {string} packageId - Firmware-bundled package id
     * @param {EmbeddedOverrideReason} reason - Why the package is shadowed
     * @param {Array<Object>} nodePackages - Host package descriptors of the resolved runtime
     * @param {Object<string, string>|null} firmwareVersions - Firmware package versions
     * @returns {Object} Entry for the dialog, the logs and the approval signature
     */
    _buildEmbeddedPackageEntry(
        packageId: string,
        reason: EmbeddedOverrideReason,
        nodePackages: RuntimeNodePackageLike[],
        firmwareVersions: Record<string, string> | null
    ): OutdatedEmbeddedPackage {
        const hostPackage = nodePackages.find((p) => p.id === packageId);
        const hostVersion =
            hostPackage?.manifest && typeof hostPackage.manifest['version'] === 'string'
                ? (hostPackage.manifest['version'] as string)
                : UNKNOWN_DEVICE_VERSION;
        const deviceVersion =
            reason === 'firmware-unknown'
                ? UNKNOWN_DEVICE_VERSION
                : (firmwareVersions?.[packageId] ?? UNKNOWN_DEVICE_VERSION);
        return { packageId, deviceVersion, hostVersion, reason };
    }

    /**
     * Resolve which firmware-bundled packages must be shadowed by host source, restricted to
     * packages the collection actually uses. Reads {@link _resolveEmbeddedPlan} so the
     * compatibility warnings and the deploy-time override plan can never disagree.
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @param {Object|null} [runtime] - Runtime supplying the host package versions; omitted means
     *        "resolve it through {@link _resolveEmbeddedPlanRuntime}"
     * @returns {Object|null} Shadowed packages plus the runtime's package descriptors, or null
     *                        when the runtime itself is unknown
     */
    _resolveOutdatedEmbeddedPackages(
        collection: any,
        runtime: RuntimeLike | null = null
    ): OutdatedEmbeddedPackagesPlan | null {
        if (!this._deviceState.runtimeEmbedded) {
            this._log('resolve-outdated-embedded-packages-not-embedded', {
                runtimeEmbedded: false,
                runtimeDeploymentMode: this._deviceState.runtimeDeploymentMode,
            });
            return {
                outdated: [],
                nodePackages: (runtime?.nodePackages ?? []) as RuntimeNodePackageLike[],
            };
        }

        const resolvedRuntime =
            runtime ?? this._resolveEmbeddedPlanRuntime(collection)?.runtime ?? null;
        if (!resolvedRuntime) {
            return null;
        }

        const plan = this._resolveEmbeddedPlan(collection, resolvedRuntime);
        return {
            outdated: this._buildOutdatedEmbeddedPackages(plan, resolvedRuntime),
            nodePackages: (resolvedRuntime.nodePackages ?? []) as RuntimeNodePackageLike[],
        };
    }

    /**
     * Collect the complete asset paths of every firmware-bundled package the collection uses.
     *
     * Only *in-use* packages count: a package the graph does not reference is left untouched by a
     * deploy even when the firmware bundles it. The forced-shadow request needs the same
     * whole-package asset set the plan itself would produce.
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @param {Object} runtime - Resolved runtime supplying `nodePackages` / `nodePackagesGlobal`
     * @returns {Map<string, string[]>} Package id → sorted complete asset paths
     */
    _collectInUseFirmwarePackageAssets(
        collection: any,
        runtime: RuntimeLike
    ): Map<string, string[]> {
        const globalPackageIds = resolveFirmwareBundledPackageIds(
            runtime?.nodePackagesGlobal ?? [],
            this._deviceState.firmwareConstituentVersions
        );
        const packageAssetKeysInUse = this._collectUsedNodePackageAssetKeys(collection, runtime);
        const assets = new Map<string, string[]>();

        for (const nodePackage of (runtime?.nodePackages ?? []) as RuntimeNodePackageLike[]) {
            const packageId = String(nodePackage?.id || '').trim();
            if (!packageId || !globalPackageIds.has(packageId)) {
                continue;
            }
            const requestedKeys = packageAssetKeysInUse.get(packageId);
            if (!requestedKeys || requestedKeys.size === 0) {
                continue;
            }
            const assetPaths = this._collectPackageAssetPaths(nodePackage);
            if (assetPaths.length > 0) {
                assets.set(packageId, assetPaths);
            }
        }

        return assets;
    }

    /**
     * Probe the firmware-bundled packages the plan calls current for content differences.
     *
     * Equal version numbers do not prove equal bytes: a firmware built from a different revision
     * of the same version string keeps its frozen copy and the host source never reaches the
     * device. For every in-use firmware-owned package the probe compares the host SHA-256 of each
     * in-use file the device inventory attributes to the firmware with
     * `deviceConnection.calculateHash(path)`.
     *
     * Every outcome is conservative: a probe error is logged (`embedded-content-probe-error`) and
     * never invents a mismatch, a missing `calculateHash` or inventory skips the probe entirely,
     * and the run is capped by {@link EMBEDDED_CONTENT_PROBE_LIMIT}. Verdicts are cached per
     * runtime, firmware, package and version tuple, so a second deploy of the same session costs
     * nothing.
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @param {Object} runtime - Runtime the plan resolved against
     * @param {FirmwareModulePlan} plan - Firmware module plan of this deploy
     * @returns {Promise<Set<string>>} Package ids with at least one differing in-use file
     */
    async _probeEmbeddedContentMismatches(
        collection: any,
        runtime: RuntimeLike,
        plan: FirmwareModulePlan
    ): Promise<Set<string>> {
        const mismatching = new Set<string>();
        if (this._deviceState.runtimeEmbedded !== true || plan.firmwareOwnedPackageIds.size === 0) {
            return mismatching;
        }

        const calculateHash = this._deviceConnection.calculateHash;
        if (typeof calculateHash !== 'function') {
            this._log('embedded-content-probe-skipped', {
                reason: 'calculateHash unavailable',
                packages: Array.from(plan.firmwareOwnedPackageIds).sort(),
            });
            return mismatching;
        }

        const embeddedPaths = this._getEmbeddedInventoryPathSet();
        if (embeddedPaths === null) {
            this._log('embedded-content-probe-skipped', {
                reason: 'embedded inventory unavailable',
                packages: Array.from(plan.firmwareOwnedPackageIds).sort(),
            });
            return mismatching;
        }

        const inUseAssets = this._collectInUseFirmwarePackageAssets(collection, runtime);
        const nodePackages = (runtime?.nodePackages ?? []) as RuntimeNodePackageLike[];
        const firmwareVersions = this._resolveFirmwarePackageVersions();
        const runtimeId =
            typeof runtime?.id === 'string' && runtime.id.trim()
                ? runtime.id.trim()
                : UNKNOWN_DEVICE_VERSION;
        const firmwareFullVersion = this._deviceState.firmwareFullVersion ?? UNKNOWN_DEVICE_VERSION;

        let probes = 0;
        let limitLogged = false;

        for (const [packageId, assetPaths] of inUseAssets) {
            if (!plan.firmwareOwnedPackageIds.has(packageId)) {
                continue;
            }

            const hostPackage = nodePackages.find((nodePackage) => nodePackage?.id === packageId);
            const hostVersion =
                hostPackage?.manifest && typeof hostPackage.manifest['version'] === 'string'
                    ? (hostPackage.manifest['version'] as string)
                    : UNKNOWN_DEVICE_VERSION;
            const deviceVersion = firmwareVersions?.[packageId] ?? UNKNOWN_DEVICE_VERSION;
            const cacheKey = [
                runtimeId,
                firmwareFullVersion,
                packageId,
                deviceVersion,
                hostVersion,
            ].join('|');

            const cached = this._embeddedContentProbeCache.get(cacheKey);
            if (cached === true) {
                mismatching.add(packageId);
                continue;
            }
            if (cached === false) {
                continue;
            }

            const candidates = assetPaths.filter((path) => embeddedPaths.has(path));
            let differs = false;
            let truncated = false;

            for (const path of candidates) {
                if (probes >= EMBEDDED_CONTENT_PROBE_LIMIT) {
                    truncated = true;
                    if (!limitLogged) {
                        limitLogged = true;
                        this._log('embedded-content-probe-limit', {
                            limit: EMBEDDED_CONTENT_PROBE_LIMIT,
                            packageId,
                            path,
                        });
                    }
                    break;
                }

                const hostUrl = this._collectionDeployment.resolveLibraryUrl(path, runtime);
                if (!hostUrl) {
                    continue;
                }

                probes += 1;
                try {
                    const response = await fetch(hostUrl);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const hostHash = (await calculateFileHash(await response.text())).toLowerCase();
                    const deviceHashRaw = await calculateHash.call(this._deviceConnection, path);
                    const deviceHash =
                        typeof deviceHashRaw === 'string' ? deviceHashRaw.trim().toLowerCase() : '';

                    if (!SHA256_HEX_RE.test(deviceHash)) {
                        this._log('embedded-content-probe-error', {
                            packageId,
                            path,
                            reason: 'device hash is not a valid sha256 digest',
                            deviceHash: deviceHash || null,
                        });
                        continue;
                    }

                    if (hostHash !== deviceHash) {
                        this._log('embedded-content-mismatch', {
                            packageId,
                            path,
                            deviceVersion,
                            hostVersion,
                        });
                        differs = true;
                        break;
                    }
                } catch (error: any) {
                    this._log('embedded-content-probe-error', {
                        packageId,
                        path,
                        error: error?.message ?? String(error),
                    });
                }
            }

            // A capped run may have stopped before the differing file: never cache that verdict.
            if (!truncated) {
                this._embeddedContentProbeCache.set(cacheKey, differs);
            }
            if (differs) {
                mismatching.add(packageId);
            }
        }

        return mismatching;
    }

    /**
     * Compute the embedded override preflight: one runtime, one plan, one shadow set.
     *
     * This is the single plan behind both the compatibility warnings and the deploy-time consent
     * gate. `null` means exactly one thing — the embedded runtime could not be resolved — and
     * callers must treat that as an error: returning an empty plan there is what let a stale
     * firmware copy win silently.
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @param {Object} [options] - Preflight options
     * @param {boolean} [options.forceShadow] - Shadow every in-use firmware-bundled package
     * @param {Set<string>} [options.contentMismatchPackageIds] - Packages the device-side content
     *        probe found to carry different bytes despite an equal version
     * @returns {Object|null} Preflight result, or null when no runtime resolves
     */
    _computeEmbeddedOverridePlan(
        collection: any,
        options: { forceShadow?: boolean; contentMismatchPackageIds?: ReadonlySet<string> } = {}
    ): EmbeddedOverridePreflight | null {
        const forceShadow = options?.forceShadow === true;
        const contentMismatchPackageIds = options?.contentMismatchPackageIds ?? EMPTY_PACKAGE_ID_SET;
        const collectionRuntimeId = this._resolveCollectionRuntimeId(collection);
        const resolved = this._resolveEmbeddedPlanRuntime(collection);

        if (!resolved) {
            this._log('collection-embedded-override-preflight', {
                resolved: false,
                runtimeId: null,
                runtimeIdSource: null,
                collectionRuntimeId,
                runtimeEmbedded: this._deviceState.runtimeEmbedded === true,
                forceShadow,
                fileCount: 0,
                packages: [],
            });
            return null;
        }

        const plan = this._resolveEmbeddedPlan(collection, resolved.runtime);
        const shadowEntries = new Map<string, OutdatedEmbeddedPackage>();
        for (const entry of this._buildOutdatedEmbeddedPackages(plan, resolved.runtime)) {
            shadowEntries.set(entry.packageId, entry);
        }

        if (forceShadow) {
            const firmwareVersions = this._resolveFirmwarePackageVersions();
            const nodePackages = (resolved.runtime.nodePackages ?? []) as RuntimeNodePackageLike[];
            const inUseAssets = this._collectInUseFirmwarePackageAssets(
                collection,
                resolved.runtime
            );
            for (const packageId of inUseAssets.keys()) {
                shadowEntries.set(
                    packageId,
                    this._buildEmbeddedPackageEntry(
                        packageId,
                        'forced-override',
                        nodePackages,
                        firmwareVersions
                    )
                );
            }
        } else if (contentMismatchPackageIds.size > 0) {
            // The device-side probe proved these packages carry different bytes under an equal
            // version number, so they are shadowed like an outdated package.
            const firmwareVersions = this._resolveFirmwarePackageVersions();
            const nodePackages = (resolved.runtime.nodePackages ?? []) as RuntimeNodePackageLike[];
            for (const packageId of contentMismatchPackageIds) {
                shadowEntries.set(
                    packageId,
                    this._buildEmbeddedPackageEntry(
                        packageId,
                        'firmware-content-mismatch',
                        nodePackages,
                        firmwareVersions
                    )
                );
            }
        }

        const shadowPackages = Array.from(shadowEntries.values()).sort((a, b) =>
            a.packageId.localeCompare(b.packageId)
        );
        const shadowPackageIds = new Set(shadowPackages.map((entry) => entry.packageId));

        // Collect every library path of each shadow package. Overrides must never ship a
        // subset of a package (see _collectPackageAssetPaths); the union is sorted so logs,
        // tests and the confirmation message stay deterministic.
        const overridePaths = new Set<string>();
        for (const nodePackage of (resolved.runtime.nodePackages ?? []) as RuntimeNodePackageLike[]) {
            const packageId = nodePackage?.id || '';
            if (!shadowPackageIds.has(packageId)) continue;
            for (const libPath of this._collectPackageAssetPaths(nodePackage)) {
                overridePaths.add(libPath);
            }
        }

        const sortedOverridePaths = Array.from(overridePaths).sort();

        this._log('collection-embedded-override-preflight', {
            resolved: true,
            runtimeId: resolved.runtimeId,
            runtimeIdSource: resolved.runtimeIdSource,
            collectionRuntimeId,
            runtimeEmbedded: this._deviceState.runtimeEmbedded === true,
            forceShadow,
            fileCount: sortedOverridePaths.length,
            packages: shadowPackages.map((entry) => ({
                packageId: entry.packageId,
                reason: entry.reason,
                deviceVersion: entry.deviceVersion,
                hostVersion: entry.hostVersion,
            })),
        });

        return {
            runtimeId: resolved.runtimeId,
            runtimeIdSource: resolved.runtimeIdSource,
            collectionRuntimeId,
            runtime: resolved.runtime,
            plan,
            overridePaths: sortedOverridePaths,
            shadowPackages,
        };
    }

    /**
     * Collect every device library path that belongs to a node package.
     *
     * Embedded overrides must always ship a complete package: MicroPython resolves a package's
     * submodules solely inside the directory that won the import (`__path__`), so a partial
     * shadow copy hides the firmware copy *and* breaks the imports of every module that was
     * left out.
     * @private
     * @param {Object} nodePackage - Runtime node package descriptor providing `mpAssets`
     * @returns {string[]} Sorted, de-duplicated device library paths of the package
     */
    _collectPackageAssetPaths(nodePackage: RuntimeNodePackageLike): string[] {
        const paths = new Set<string>();
        const mpAssets = (nodePackage?.mpAssets || {}) as Record<string, unknown>;
        for (const assetList of Object.values(mpAssets)) {
            if (!Array.isArray(assetList)) continue;
            for (const assetUrl of assetList) {
                if (typeof assetUrl !== 'string') continue;
                const libPath = this._collectionDeployment.extractLibraryPathFromUrl(assetUrl);
                if (libPath) {
                    paths.add(libPath);
                }
            }
        }
        return Array.from(paths).sort();
    }

    /**
     * Build the approval signature for a set of pending embedded overrides.
     *
     * A remembered "yes" must only ever cover the exact situation it was given for, so the
     * signature contains the package id, both versions and the reason for every shadowed package.
     * A different package set, firmware version, host version or reason therefore asks again —
     * including a package that only became outdated because its *content* differs while both
     * version numbers stayed equal.
     * @private
     * @param {Array<Object>} detail - Outdated entries from {@link _resolveOutdatedEmbeddedPackages}
     * @returns {string} Stable, order-independent approval key
     */
    _buildEmbeddedOverrideSignature(detail: OutdatedEmbeddedPackage[]): string {
        return detail
            .map(
                (entry) =>
                    `${entry.packageId}@${entry.deviceVersion}->${entry.hostVersion}#${entry.reason}`
            )
            .sort()
            .join('|');
    }

    /**
     * Format a firmware/host version for the consent dialog table.
     *
     * The `unknown` sentinel is never printed verbatim; it is localised through
     * `deployment.embeddedOverrideVersionUnknown`.
     * @param {string} version - Raw version string or the unknown sentinel
     * @returns {string} Display-ready version text
     * @private
     */
    _formatEmbeddedVersion(version: string): string {
        return version === UNKNOWN_DEVICE_VERSION
            ? this._i18nService.t('deployment.embeddedOverrideVersionUnknown')
            : version;
    }

    /**
     * Decide whether this deploy may upload host sources over firmware-bundled packages, asking
     * the user once per plan signature.
     *
     * This is the single consent gate for shadowed firmware packages: the plan is computed by
     * {@link _computeEmbeddedOverridePlan}, the user answers a confirmation dialog that carries
     * an optional "remember for this version" checkbox, and a remembered answer skips the dialog
     * for the identical signature for the rest of the page session.
     * @private
     * @param {Collection} collection - Collection about to be deployed
     * @param {Object} [gateOptions] - Gate options
     * @param {boolean} [gateOptions.forceShadow] - Shadow every in-use firmware-bundled package
     *        and always ask, ignoring a remembered approval
     * @returns {Promise<string[]|null>} Override paths to upload, `[]` when nothing is outdated and
     *          `null` when the runtime is unknown outside embedded mode
     * @throws {Error} When overrides are pending but no confirmation dialog API is available
     * @throws {Error} When the embedded runtime itself cannot be resolved
     * @throws {EmbeddedSourceOverrideDeclinedError} When the user declines
     */
    async _resolveEmbeddedSourceOverrides(
        collection: any,
        gateOptions: { forceShadow?: boolean } = {}
    ): Promise<string[] | null> {
        const forceShadow = gateOptions?.forceShadow === true;
        this._log('embedded-override-gate-start', {
            forceShadow,
            runtimeEmbedded: this._deviceState.runtimeEmbedded === true,
            runtimeDeploymentMode: this._deviceState.runtimeDeploymentMode,
            collectionRuntimeId: this._resolveCollectionRuntimeId(collection),
        });
        const basePreflight = this._computeEmbeddedOverridePlan(collection, { forceShadow });
        if (basePreflight === null) {
            this._log('embedded-override-gate-null-preflight', {
                forceShadow,
                runtimeEmbedded: this._deviceState.runtimeEmbedded === true,
                runtimeDeploymentMode: this._deviceState.runtimeDeploymentMode,
            });
            if (this._deviceState.runtimeEmbedded !== true) {
                return null;
            }
            // Embedded mode may never fall back to silence: without a plan nothing can be
            // shadowed, and the device keeps running the firmware's frozen copy.
            throw new Error(
                'Cannot resolve the embedded runtime for the source override plan: ' +
                    `collection runtime '${this._resolveCollectionRuntimeId(collection)}' is unknown`
            );
        }

        // Equal version numbers do not prove equal bytes: probe the firmware-owned packages before
        // the approval check, and rebuild the plan with whatever the device proved different.
        const contentMismatches = forceShadow
            ? EMPTY_PACKAGE_ID_SET
            : await this._probeEmbeddedContentMismatches(
                  collection,
                  basePreflight.runtime,
                  basePreflight.plan
              );
        const preflight =
            contentMismatches.size > 0
                ? (this._computeEmbeddedOverridePlan(collection, {
                      forceShadow,
                      contentMismatchPackageIds: contentMismatches,
                  }) ?? basePreflight)
                : basePreflight;

        const plan = preflight.overridePaths;
        this._log('embedded-override-gate-plan', {
            forceShadow,
            overridePathCount: plan.length,
            shadowPackageCount: preflight.shadowPackages.length,
            shadowPackageIds: preflight.shadowPackages.map((entry) => entry.packageId),
            contentMismatchCount: contentMismatches.size,
        });
        if (plan.length === 0) {
            this._log('embedded-override-gate-empty-plan', {
                forceShadow,
                runtimeEmbedded: this._deviceState.runtimeEmbedded === true,
                runtimeDeploymentMode: this._deviceState.runtimeDeploymentMode,
                firmwareVersions: this._resolveFirmwarePackageVersions(),
            });
            return plan;
        }

        const outdated = preflight.shadowPackages;
        const packageIds = outdated.map((entry) => entry.packageId);
        const signature = this._buildEmbeddedOverrideSignature(outdated);

        if (forceShadow) {
            this._log('collection-embedded-override-forced-request', {
                packageIds,
                fileCount: plan.length,
            });
        }

        if (!forceShadow && outdated.length > 0 && this._embeddedOverrideApprovals.has(signature)) {
            this._log('collection-embedded-override-memoized', {
                signature,
                packageIds,
                fileCount: plan.length,
            });
            return plan;
        }

        const showWithCheckbox = this._viewManager?.showConfirmationWithCheckbox;
        const showPlain = this._viewManager?.showConfirmation;
        this._log('embedded-override-gate-dialog', {
            hasCheckboxDialog: typeof showWithCheckbox === 'function',
            hasPlainDialog: typeof showPlain === 'function',
            hasViewManager: Boolean(this._viewManager),
        });
        if (typeof showWithCheckbox !== 'function' && typeof showPlain !== 'function') {
            throw new Error(
                'Cannot confirm embedded source override: confirmation dialog unavailable'
            );
        }

        const table = {
            columns: [
                { label: this._i18nService.t('deployment.embeddedOverrideTablePackage') },
                { label: this._i18nService.t('deployment.embeddedOverrideTableFirmwareVersion') },
                { label: this._i18nService.t('deployment.embeddedOverrideTableHostVersion') },
            ],
            rows: outdated.map((entry) => ({
                cells: [
                    { text: entry.packageId },
                    { text: this._formatEmbeddedVersion(entry.deviceVersion) },
                    { text: this._formatEmbeddedVersion(entry.hostVersion) },
                ],
            })),
        };
        const dialogOptions: Record<string, unknown> = {
            title: this._i18nService.t('deployment.embeddedOverrideTitle'),
            message: this._i18nService.t('deployment.embeddedOverrideMessage', {
                fileCount: plan.length,
            }),
            confirmLabel: this._i18nService.t('deployment.embeddedOverrideConfirm'),
            cancelLabel: this._i18nService.t('dialog.cancel'),
            table,
        };

        let confirmed = false;
        let remember = false;
        if (typeof showWithCheckbox === 'function') {
            const result = await showWithCheckbox.call(this._viewManager, {
                ...dialogOptions,
                checkboxLabel: this._i18nService.t('deployment.embeddedOverrideRemember'),
                checkboxChecked: false,
            });
            confirmed = result?.confirmed === true;
            remember = confirmed && result?.checkboxChecked === true;
        } else if (typeof showPlain === 'function') {
            confirmed = (await showPlain.call(this._viewManager, dialogOptions)) === true;
        }

        this._log('collection-embedded-override-decision', {
            confirmed,
            remember,
            packageIds,
            fileCount: plan.length,
            paths: plan,
        });

        if (!confirmed) {
            throw new EmbeddedSourceOverrideDeclinedError(packageIds);
        }
        if (remember && outdated.length > 0) {
            this._embeddedOverrideApprovals.add(signature);
            this._log('collection-embedded-override-approval-remembered', {
                signature,
                packageIds,
            });
        }

        return plan;
    }

    /**
     * Validate node packages availability, version compatibility, and file availability.
     * Returns validation result without throwing errors.
     *
     * `shadowPackages` exposes the sorted entries the shadow warnings are derived from, so a
     * caller can ask "would the deploy-time gate shadow anything?" without recomputing the plan
     * or parsing localised warning strings.
     * @param {Collection} collection - Collection to validate
     * @returns {{compatible: boolean, errors: string[], warnings: string[], shadowPackages: Array<Object>}} Validation result
     */
    validateNodePackages(collection: any): {
        compatible: boolean;
        errors: string[];
        warnings: string[];
        shadowPackages: OutdatedEmbeddedPackage[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];
        let compatible = true;

        // One runtime for every embedded decision: the device's runtime id first, the collection's
        // declared runtime second (see _resolveEmbeddedPlanRuntime).
        const embeddedMode = this._deviceState.runtimeEmbedded;
        const collectionRuntimeId = this._resolveCollectionRuntimeId(collection);
        const resolvedRuntime = this._resolveEmbeddedPlanRuntime(collection);
        const runtime = (resolvedRuntime?.runtime ?? null) as RuntimeLike | null;

        if (!runtime) {
            // In embedded mode silence is the failure mode this gate exists to remove: no runtime
            // means no plan, no shadow upload, and a device that keeps the firmware's frozen copy.
            errors.push(
                embeddedMode
                    ? `Cannot resolve the embedded runtime: ${collectionRuntimeId}`
                    : `Runtime not found: ${collectionRuntimeId}`
            );
            return { compatible: false, errors, warnings, shadowPackages: [] };
        }

        // Get all unique node types used in collection
        const nodeTypes = new Set<string>();
        const graphs = collection.getGraphArray?.() || [];
        for (const graph of graphs) {
            const nodes = graph.getNodes?.() || [];
            for (const node of nodes) {
                const nodeTypeId = String(node.type);
                // Function-graph-managed ids resolve through neither the runtime nor a node package
                // (the app generates them), so they must not fail the package gate or contribute a
                // phantom `graph` / `function_graph` package id to the asset plan.
                if (isFunctionGraphManagedNodeType(nodeTypeId)) {
                    continue;
                }
                nodeTypes.add(nodeTypeId);
            }
        }

        // Check if each node type is available in the collection's runtime
        for (const nodeTypeId of nodeTypes) {
            const nodeType = runtime.getNodeType?.(nodeTypeId);
            if (!nodeType) {
                errors.push(`Node type not found: ${nodeTypeId}`);
                compatible = false;
            }
        }

        const deviceState = this._deviceState;
        const globalPackageIds = resolveFirmwareBundledPackageIds(
            runtime.nodePackagesGlobal ?? [],
            deviceState.firmwareConstituentVersions
        );

        // Derive package IDs actually used by the collection from node type IDs
        const packageAssetKeysInUse = new Map<string, Set<string>>();
        for (const nodeTypeId of nodeTypes) {
            const dotIdx = nodeTypeId.indexOf('.');
            const dashIdx = nodeTypeId.indexOf('-');
            const splitIdx =
                dotIdx >= 0 && dashIdx >= 0 ? Math.min(dotIdx, dashIdx) : Math.max(dotIdx, dashIdx);
            const packageId = splitIdx > 0 ? nodeTypeId.slice(0, splitIdx) : nodeTypeId;
            const keySet = packageAssetKeysInUse.get(packageId) ?? new Set<string>();
            keySet.add('*');
            if (splitIdx > 0 && splitIdx + 1 < nodeTypeId.length) {
                keySet.add(nodeTypeId.slice(splitIdx + 1));
            }
            packageAssetKeysInUse.set(packageId, keySet);
        }

        this._expandRequiredPackages(
            packageAssetKeysInUse,
            (runtime.nodePackages ?? []) as RuntimeNodePackageLike[]
        );

        // --- Shadow warnings (embedded mode only) ---
        // Same preflight the deploy-time gate consumes, so the warnings, the caller deciding
        // whether to offer the override option, and the actual shadow upload agree by
        // construction. Non-embedded mode has no shadow set.
        const nodePackages = (runtime.nodePackages ?? []) as RuntimeNodePackageLike[];
        const preflight = this._computeEmbeddedOverridePlan(collection);
        const plan = preflight?.plan ?? this._resolveEmbeddedPlan(collection, runtime);
        const shadowPackages =
            embeddedMode && preflight !== null ? preflight.shadowPackages : [];
        if (embeddedMode && preflight !== null) {
            for (const entry of shadowPackages) {
                const key =
                    entry.reason === 'firmware-unknown'
                        ? 'deployment.packageVersionUnknown'
                        : entry.reason === 'firmware-incomplete'
                          ? 'deployment.packageIncomplete'
                          : entry.reason === 'firmware-content-mismatch'
                            ? 'deployment.packageContentMismatch'
                            : 'deployment.packageVersionOutdated';
                warnings.push(
                    this._i18nService.t(key, {
                        packageId: entry.packageId,
                        deviceVersion: entry.deviceVersion,
                        hostVersion: entry.hostVersion,
                    })
                );
            }
        }

        // --- File availability errors (both modes) ---
        // Build libPath → packageId map from the mpAssets of packages in use.
        const libPathToPackageId = new Map<string, string>();
        for (const nodePackage of nodePackages) {
            const packageId = nodePackage?.id || '';
            const requestedKeys = packageAssetKeysInUse.get(packageId);
            if (!requestedKeys || requestedKeys.size === 0) continue;

            const mpAssets = (nodePackage?.mpAssets || {}) as Record<string, unknown>;
            for (const assetKey of requestedKeys) {
                const assetList = mpAssets[assetKey];
                if (!Array.isArray(assetList)) continue;
                for (const assetUrl of assetList) {
                    if (typeof assetUrl !== 'string') continue;
                    const libPath = this._collectionDeployment.extractLibraryPathFromUrl(assetUrl);
                    if (libPath) {
                        libPathToPackageId.set(libPath, packageId);
                    }
                }
            }
        }

        // --- RAM warning for packages the firmware does not bundle (embedded mode only) ---
        // Their source is uploaded into user space, which costs RAM on a device sized for the
        // firmware's own package set. Display-only: it must not block the deploy.
        if (embeddedMode) {
            const nonFirmwarePackages = new Set<string>();
            for (const packageId of libPathToPackageId.values()) {
                if (packageId && !globalPackageIds.has(packageId)) {
                    nonFirmwarePackages.add(packageId);
                }
            }
            for (const packageId of Array.from(nonFirmwarePackages).sort()) {
                warnings.push(
                    this._i18nService.t('deployment.packageNotInFirmware', { packageId })
                );
            }
        }

        // A file can only fail validation when neither the firmware nor the host provides it;
        // a bundled package whose firmware copy is missing or incomplete is shadowed instead.
        for (const libPath of plan.blockedPaths) {
            errors.push(
                this._i18nService.t('deployment.packageFileMissingFromHost', { path: libPath })
            );
            compatible = false;
        }

        return { compatible, errors, warnings, shadowPackages };
    }

    /**
     * Refresh all device information from connected device.
     * Loads runtime, target, and collection state in one operation.
     * Emits 'device-info-loaded' event when complete.
     * @returns {Promise<Object>} - Device info summary
     * @throws {Error} If not connected or read fails
     */
    async refreshDeviceInfo(): Promise<DeviceInfoRefreshSummary> {
        return this._refreshDeviceInfoInternal();
    }

    async _refreshDeviceInfoInternal(): Promise<DeviceInfoRefreshSummary> {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        this._log('refresh-device-info-start', {
            connected: this._deviceState.connected,
            deviceConnectionState: this._deviceConnection.getState(),
            hasMicroPython: this._deviceState.hasMicroPython,
        });

        // Capture previous state for change detection
        const previousState = this._deviceState;

        try {
            this._log('refresh-device-info-loading-device-connection-info');

            // loadDeviceInfo now returns DeviceState instance
            const deviceState = (await this._deviceConnection.loadDeviceInfo()) as LooseRecord;
            const cachedDeviceInfo =
                this._deviceConnection.getDeviceInfoData() as LooseRecord | null;

            const candidateRuntimeMode =
                cachedDeviceInfo?.runtimeDeploymentMode ?? deviceState?.runtimeDeploymentMode;
            const runtimeMode =
                candidateRuntimeMode === 'embedded' ||
                candidateRuntimeMode === 'dynamic' ||
                candidateRuntimeMode === 'unknown'
                    ? (candidateRuntimeMode as 'embedded' | 'dynamic' | 'unknown')
                    : 'unknown';
            const runtimeEmbedded =
                cachedDeviceInfo?.runtimeEmbedded === true || runtimeMode === 'embedded';
            const runtimeIdentity =
                cachedDeviceInfo?.embeddedRuntimeIdentity &&
                typeof cachedDeviceInfo.embeddedRuntimeIdentity === 'object'
                    ? (cachedDeviceInfo.embeddedRuntimeIdentity as LooseRecord)
                    : null;
            const embeddedPackagesSummary =
                cachedDeviceInfo?.embeddedPackagesSummary &&
                typeof cachedDeviceInfo.embeddedPackagesSummary === 'object'
                    ? cachedDeviceInfo.embeddedPackagesSummary
                    : null;
            const embeddedInventory =
                cachedDeviceInfo?.embeddedInventory &&
                typeof cachedDeviceInfo.embeddedInventory === 'object'
                    ? cachedDeviceInfo.embeddedInventory
                    : null;
            const bootstrapSetupStatus =
                cachedDeviceInfo?.bootstrapSetupStatus &&
                typeof cachedDeviceInfo.bootstrapSetupStatus === 'object'
                    ? cachedDeviceInfo.bootstrapSetupStatus
                    : null;

            this._log(
                'refresh-device-info-input-sources',
                `loadDeviceInfo.runtimeInstalled=${Boolean(deviceState.runtimeInstalled)}; loadDeviceInfo.runtimeId=${deviceState.runtimeId || 'none'}; loadDeviceInfo.runtimeVersion=${deviceState.runtimeVersion || 'none'}; metadata.mode=${runtimeMode}; metadata.embedded=${runtimeEmbedded}; metadata.runtimeId=${runtimeIdentity?.id || 'none'}`
            );

            const updates = {
                runtimeInstalled: deviceState.runtimeInstalled,
                runtimeId: deviceState.runtimeId,
                runtimeName: deviceState.runtimeName,
                runtimeVersion: deviceState.runtimeVersion,
                runtimeDescription: deviceState.runtimeDescription,
                runtimeCustomView: deviceState.runtimeCustomView,
                runtimeDeploymentMode: runtimeMode,
                runtimeEmbedded: runtimeEmbedded,
                firmwareFullVersion: deviceState.firmwareFullVersion ?? null,
                runtimeFirmwareVersion: deviceState.runtimeFirmwareVersion ?? null,
                firmwareConstituentVersions: deviceState.firmwareConstituentVersions ?? null,
                embeddedPackagesSummary: embeddedPackagesSummary,
                embeddedInventory: embeddedInventory,
                effectiveInventorySummary: runtimeEmbedded
                    ? this._computeEffectiveInventorySummary(embeddedInventory)
                    : null,
                bootstrapSetupReady:
                    typeof cachedDeviceInfo?.bootstrapSetupReady === 'boolean'
                        ? cachedDeviceInfo.bootstrapSetupReady
                        : (bootstrapSetupStatus?.ready ?? null),
                bootstrapSetupStatus: bootstrapSetupStatus,
                deviceTargetInfo: deviceState.deviceTargetInfo,
                buildBaseTargetId: deviceState.buildBaseTargetId ?? null,
                allowedWebTargetIds: deviceState.allowedWebTargetIds ?? null,
                collectionDeployed: deviceState.collectionDeployed,
                collectionName: deviceState.collectionName,
                collectionVersion: deviceState.collectionVersion,
            };

            if (runtimeEmbedded && runtimeIdentity) {
                if (runtimeIdentity.id) {
                    updates.runtimeId = runtimeIdentity.id as string;
                }
                if (runtimeIdentity.name) {
                    updates.runtimeName = runtimeIdentity.name as string;
                }
                if (runtimeIdentity.version) {
                    updates.runtimeVersion = runtimeIdentity.version as string;
                }
                if (runtimeIdentity.description) {
                    updates.runtimeDescription = runtimeIdentity.description as string;
                }
            }

            // Decide whether the stored target is usable before publishing the state: an unusable
            // target leaves `deviceTargetInfo` null, which is what drives `needs-onboarding` and
            // the repair dialog.
            const targetState = this._resolveTargetConfigurationState(deviceState, updates);
            updates.deviceTargetInfo = targetState.deviceTargetInfo;
            this._targetConfigurationIssue = targetState.issue;

            // Update state (emits 'device-state-changed')
            this._updateDeviceState(updates);

            this._log('refresh-device-info-runtime-loaded', {
                hasRuntime: this._deviceState.runtimeInstalled,
                runtimeId: this._deviceState.runtimeId,
            });

            this._log('refresh-device-info-target-capabilities-loaded', {
                deviceTargetId: this._deviceState.deviceTargetInfo?.id || null,
            });

            this._log('refresh-device-info-collection-checked', {
                hasCollection: this._deviceState.collectionDeployed,
                collectionName: this._deviceState.collectionName,
            });

            // Detect if anything changed using DeviceState.getChangedFields()
            const changedFields = this._deviceState.getChangedFields(previousState);
            const hasChanges = changedFields.length > 0;

            this._log(
                'refresh-device-info-derived-state',
                `runtimeInstalled=${Boolean(this._deviceState.runtimeInstalled)}; runtimeId=${this._deviceState.runtimeId || 'none'}; runtimeVersion=${this._deviceState.runtimeVersion || 'none'}; runtimeMode=${this._deviceState.runtimeDeploymentMode || 'unknown'}; runtimeEmbedded=${Boolean(this._deviceState.runtimeEmbedded)}; changedFields=${changedFields.join(',') || 'none'}; hasChanges=${hasChanges}`
            );

            // Emit dedicated 'device-info-loaded' event
            this.dispatchEvent(
                new CustomEvent('device-info-loaded', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.DeviceInfoLoaded.v1',
                        {
                            state: this._deviceState,
                            changedFields,
                            hasChanges,
                            timestamp: Date.now(),
                        }
                    ),
                })
            );

            return {
                runtime: this._deviceState.runtimeInstalled
                    ? {
                          id: this._deviceState.runtimeId,
                          name: this._deviceState.runtimeName,
                          version: this._deviceState.runtimeVersion,
                      }
                    : null,
                collection: this._deviceState.collectionDeployed
                    ? {
                          name: this._deviceState.collectionName,
                          version: this._deviceState.collectionVersion,
                      }
                    : null,
                target: {
                    id: this._deviceState.deviceTargetInfo?.id || null,
                    displayName: this._deviceState.deviceTargetInfo?.displayName || null,
                },
            };
        } catch (error: any) {
            this._log(
                'refresh-device-info-failed',
                'error',
                `error=${error?.message || String(error)}`
            );

            // Prevent stale deployment metadata from previous sessions/devices
            // when current device info cannot be read (e.g., ENOENT after removal).
            this._updateDeviceState(this._buildClearedDeploymentStateUpdates());
            // The verdict is deployment-owned (not a `DeviceStateData` field), so clear it here too.
            this._targetConfigurationIssue = null;

            // Emit error event but don't throw (allows UI to show error state)
            this.dispatchEvent(
                new CustomEvent('device-info-load-error', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.DeviceInfoLoadError.v1',
                        { error: error.message }
                    ),
                })
            );
            throw error;
        }
    }

    /**
     * Decide whether the target configuration stored on the device can be used.
     *
     * The host never adopts a target it cannot use: a payload the reader rejected (or a target
     * whose base id does not match the flashed image) is dropped instead of being papered over,
     * so the initialization verdict asks for a repair. A target that cannot be judged — no runtime
     * to resolve its base id — is kept, because invalidating it would demand a pointless repair.
     * @private
     * @param {Object} deviceState - State returned by the connection's `loadDeviceInfo()`.
     * @param {Object} updates - Device-state updates about to be applied (runtime and image identity).
     * @returns {{ deviceTargetInfo: DeviceTargetInfo | null, issue: TargetConfigurationIssue | null }}
     *   The target to publish plus the reason it was dropped, or `null`.
     */
    _resolveTargetConfigurationState(
        deviceState: LooseRecord,
        updates: LooseRecord & {
            runtimeId?: string | null;
            buildBaseTargetId?: string | null;
            allowedWebTargetIds?: string[] | null;
        }
    ): {
        deviceTargetInfo: DeviceTargetInfo | null;
        issue: TargetConfigurationIssue | null;
    } {
        const storedTarget = (deviceState?.deviceTargetInfo as DeviceTargetInfo | null) ?? null;

        if (!storedTarget) {
            // Nothing was adopted, so the reader's verdict is the reason (null when it has none).
            return {
                deviceTargetInfo: null,
                issue: this._deviceConnection.getTargetPayloadIssue?.() ?? null,
            };
        }

        const runtime = updates.runtimeId
            ? this._runtimeCollection.getRuntime(updates.runtimeId)
            : null;
        if (!runtime) {
            // Without a runtime there is no build-base chain to compare against: keep the target.
            return { deviceTargetInfo: storedTarget, issue: null };
        }

        const targetId = storedTarget.id ?? '';
        const image = {
            buildBaseTargetId: updates.buildBaseTargetId ?? null,
            allowedWebTargetIds: updates.allowedWebTargetIds ?? null,
        };
        if (isTargetCompatibleWithImage(targetId, image, runtime)) {
            return { deviceTargetInfo: storedTarget, issue: null };
        }

        const targetBaseTargetId =
            (runtime as { getTargetBuildBaseId?: (id: string) => string | null })
                .getTargetBuildBaseId?.(targetId) ?? null;
        this._log('target-config-image-incompatible', {
            targetId,
            targetBaseTargetId,
            buildBaseTargetId: image.buildBaseTargetId,
            allowedWebTargetIds: image.allowedWebTargetIds,
            result: 'reject',
        });
        return { deviceTargetInfo: null, issue: 'image-incompatible' };
    }

    _buildClearedDeploymentStateUpdates(
        overrides: DeviceStateUpdates = {}
    ): ClearedDeploymentStateUpdates {
        return {
            runtimeInstalled: false,
            runtimeId: null,
            runtimeName: null,
            runtimeVersion: null,
            runtimeDescription: null,
            runtimeCustomView: null,
            runtimeDeploymentMode: 'dynamic',
            runtimeEmbedded: false,
            embeddedPackagesSummary: null,
            embeddedInventory: null,
            effectiveInventorySummary: null,
            bootstrapSetupReady: null,
            bootstrapSetupStatus: null,
            deviceTargetInfo: null,
            collectionDeployed: false,
            collectionName: null,
            collectionVersion: null,
            ...overrides,
        };
    }

    /**
     * Clean up resources and event listeners.
     */
    destroy() {
        // Remove connection event listeners
        if (this._deviceConnection) {
            // Note: We don't store handler references, so we can't remove them
            // This is a limitation of the current implementation
            // Future: Store handler references in constructor for proper cleanup
        }

        // Clear device state
        this._deviceState = new DeviceState();
        this._runtimeDeployment?.setDeviceState?.(
            this._deviceState as unknown as RuntimeDeploymentStateType
        );
        this._collectionDeployment?.setDeviceState?.(
            this._deviceState as unknown as CollectionDeploymentStateType
        );
    }

    // ========================================================================
    // Device State Management
    // ========================================================================

    /**
     * Update device state and emit change event (immutable pattern).
     * @private
     * @param {Partial<import('../data/device-state.js').DeviceStateData>} updates - State updates
     */
    _updateDeviceState(updates: DeviceStateUpdates) {
        const previousState = this._deviceState;

        // Create new immutable DeviceState instance with updates
        this._deviceState = this._deviceState.update(updates);

        const collectionManager = this._collectionManager as {
            setAllowedWebTargetIds?: (ids: string[] | null) => void;
            setImageCompatibility?: (image: {
                buildBaseTargetId?: string | null;
                allowedWebTargetIds?: string[] | null;
            }) => void;
        } | null;
        if (typeof collectionManager?.setImageCompatibility === 'function') {
            collectionManager.setImageCompatibility({
                buildBaseTargetId: this._deviceState.buildBaseTargetId,
                allowedWebTargetIds: this._deviceState.allowedWebTargetIds,
            });
        } else if (typeof collectionManager?.setAllowedWebTargetIds === 'function') {
            collectionManager.setAllowedWebTargetIds(this._deviceState.allowedWebTargetIds);
        }

        this._runtimeDeployment?.setDeviceState?.(
            this._deviceState as unknown as RuntimeDeploymentStateType
        );
        this._collectionDeployment?.setDeviceState?.(
            this._deviceState as unknown as CollectionDeploymentStateType
        );

        // Detect which fields changed
        const changedFields = this._deviceState.getChangedFields(previousState);

        this._log('device-state-updated', {
            old: previousState.toJSON(),
            new: this._deviceState.toJSON(),
            changedFields,
        });

        this.dispatchEvent(
            new CustomEvent('device-state-changed', {
                detail: new DeviceDeploymentEventPayload('DeviceDeployment.DeviceStateChanged.v1', {
                    state: this._deviceState,
                    changedFields,
                    previousState,
                }),
            })
        );
    }

    // ========================================================================
    // Connection Event Handling
    // ========================================================================

    /**
     * Setup connection event listeners.
     * @private
     */
    _setupConnectionListeners() {
        this._log('setup-connection-listeners', {
            hasDeviceConnection: !!this._deviceConnection,
            deviceConnectionType: this._deviceConnection?.constructor?.name,
        });

        this._deviceConnection.addEventListener('statechange', (event) => {
            const detail = (event.detail || {}) as {
                state?: string;
                previousState?: string;
            };
            const { state, previousState } = detail;
            this._log('statechange-event-listener-triggered', { state, previousState });

            if (state === 'connected' && previousState !== 'connected') {
                this._handleDeviceConnect(event);
                return;
            }

            if (
                state === 'disconnected' &&
                previousState !== 'disconnected' &&
                this._deviceState.connected
            ) {
                this._handleDeviceDisconnect(event);
            }
        });

        this._deviceConnection.addEventListener('device-initialization-status', (event) => {
            const detail = ((event as CustomEvent).detail ||
                {}) as DeviceInitializationStatusDetail;
            void this._handleDeviceInitializationStatusEvent(detail);
        });
    }

    async _handleDeviceInitializationStatusEvent(
        detail: DeviceInitializationStatusDetail
    ): Promise<void> {
        this._latestInitializationStatus = detail;
        this._log('device-initialization-status-event', detail);

        const shouldRunOnboarding =
            detail.initializationVerdict === 'needs-onboarding' &&
            detail.onboardingActionable === true &&
            this._deviceState.connected;

        if (!shouldRunOnboarding) {
            return;
        }

        // Keep event handling transport/state-only here.
        // refreshDeviceInfo() owns onboarding + post-onboarding full reload to avoid
        // overlapping embedded metadata API probes on the same connection.
        this._log(
            'device-initialization-status-onboarding-deferred',
            'onboarding handled by refreshDeviceInfo pipeline'
        );
    }

    /**
     * Sync initial connection state.
     * Call this after construction to check if device is already connected.
     * @private
     */
    _syncConnectionState() {
        const isConnected = this._deviceConnection.isConnected();
        this._log('syncing-connection-state', {
            connected: isConnected,
            deviceConnectionState: this._deviceConnection.getState(),
        });

        if (isConnected) {
            this._updateDeviceState({
                connected: true,
            });
        } else {
            // Also set disconnected state explicitly
            this._updateDeviceState({
                connected: false,
            });
        }
    }

    _configureEmbeddedOnboardingAdapter(): void {
        if (typeof this._deviceConnection.setEmbeddedOnboardingAdapter !== 'function') {
            return;
        }

        this._deviceConnection.setEmbeddedOnboardingAdapter({
            requestSelection: async ({ runtimeIdentity, targetConstraints }) => {
                const runtimeId =
                    (typeof runtimeIdentity?.id === 'string' && runtimeIdentity.id) ||
                    this._deviceState.runtimeId ||
                    null;

                if (!runtimeId) {
                    return {
                        confirmed: false,
                        error: 'Onboarding failed: runtime id is not available.',
                    };
                }

                const allowedTargetIds = Array.isArray(targetConstraints?.allowedTargetIds)
                    ? targetConstraints.allowedTargetIds
                    : null;

                // A device holding an unusable payload still tells us what the user picked before:
                // prefill it so the repair is one confirmation. `_promptTargetSelection` drops the
                // id when the image filter excludes it and prefills the description unconditionally.
                const selection = await this._promptTargetSelection(runtimeId, {
                    allowedTargetIds,
                    currentTargetId:
                        this._deviceConnection.getConfiguredTargetIdHint?.() ?? null,
                    userDescription: this._deviceConnection.getTargetUserDescription?.() ?? '',
                });

                if (!selection) {
                    return {
                        confirmed: false,
                        error: 'Onboarding cancelled by user.',
                    };
                }

                return {
                    confirmed: true,
                    selectedTargetId: selection.targetId,
                    userDescription: selection.userDescription,
                };
            },
            uploadTargetConfiguration: async ({ runtimeId, targetId, userDescription }) => {
                await this._uploadTargetConfiguration(targetId, runtimeId, userDescription);
            },
            showError: async ({ title, message, details }) => {
                await this._viewManager.showError({
                    title,
                    message,
                    details,
                });
            },
        });
    }

    /**
     * Handle device connection.
     * @private
     * @param {Event} event
     */
    async _handleDeviceConnect(event: any) {
        this._log('device-connected-event-fired', {
            detail: event.detail,
            currentState: this._deviceState.connected,
            deviceConnectionState: this._deviceConnection.getState(),
        });

        // A new link means a possibly different firmware: approvals remembered for this page
        // session no longer apply, and content verdicts must be probed again.
        this._embeddedOverrideApprovals.clear();
        this._embeddedContentProbeCache.clear();

        this._updateDeviceState({
            connected: true,
            deviceInfoLoading: true,
            deviceInfoLoadError: null,
        });

        this._log('device-state-updated-after-connect', {
            connected: this._deviceState.connected,
            deviceConnectionState: this._deviceConnection.getState(),
        });

        // Create progress tracker for device info loading
        const progress = new ProgressTracker('device-info-load', 2);

        try {
            progress.start('Loading device information...');

            // Phase 1: MicroPython Detection
            progress.update('Detecting MicroPython...', 1);
            this._log('handle-device-connect-starting-micropython-detection');
            await this.detectMicroPython();
            this._log('handle-device-connect-micropython-detection-complete', {
                hasMicroPython: this._deviceState.hasMicroPython,
                micropythonVersion: this._deviceState.micropythonVersion,
            });

            // Phase 2: Device Info Loading (if MicroPython detected)
            if (this._deviceState.hasMicroPython === true) {
                progress.update('Loading device configuration...', 2);
                this._log('handle-device-connect-starting-device-info-refresh');
                await this.refreshDeviceInfo();
                this._log('handle-device-connect-device-info-refresh-complete');
            } else {
                // MicroPython not detected - complete with warning
                this._log('handle-device-connect-micropython-not-detected');
                progress.complete('MicroPython not detected on device');
            }

            // Update state: loading complete, no error
            this._updateDeviceState({
                deviceInfoLoading: false,
            });

            // Complete progress only if we haven't already
            if (this._deviceState.hasMicroPython === true) {
                progress.complete('Device info loaded successfully');
            }
        } catch (error: any) {
            this._log('auto-detect-or-info-load-failed', 'error', {
                error: error.message,
                stack: error.stack,
                hasMicroPython: this._deviceState.hasMicroPython,
                deviceConnectionState: this._deviceConnection.getState(),
            });

            // Update state: loading failed
            this._updateDeviceState({
                deviceInfoLoading: false,
                deviceInfoLoadError: error.message,
            });

            // Report error via progress
            progress.error('Device info loading failed', error.message);

            // Emit error event for views
            this.dispatchEvent(
                new CustomEvent('device-info-load-error', {
                    detail: new DeviceDeploymentEventPayload(
                        'DeviceDeployment.DeviceInfoLoadError.v1',
                        {
                            error: error.message,
                            phase:
                                this._deviceState.hasMicroPython === null
                                    ? 'micropython-detection'
                                    : 'device-info-refresh',
                        }
                    ),
                })
            );
        }
    }

    /**
     * Schedule initial device detection when device is already connected at construction.
     * Uses same logic as _handleDeviceConnect but wrapped for constructor use.
     * Called via queueMicrotask to ensure constructor completes first.
     * @private
     */
    async _scheduleInitialDetection() {
        this._log('initial-detection-start');
        await this._handleDeviceConnect({ detail: { source: 'initial-detection' } });
    }

    /**
     * Handle device disconnection.
     * @private
     * @param {Event} event
     */
    _handleDeviceDisconnect(event: any) {
        this._log('device-disconnected', event.detail);

        // Consent to shadow firmware packages is device- and version-specific.
        this._embeddedOverrideApprovals.clear();
        this._embeddedContentProbeCache.clear();
        // The target verdict is deployment-owned (not a `DeviceStateData` field).
        this._targetConfigurationIssue = null;

        this._updateDeviceState(
            this._buildClearedDeploymentStateUpdates({
                connected: false,
                deviceInfoLoading: false,
                deviceInfoLoadError: null,
                hasMicroPython: null,
                micropythonVersion: null,
            })
        );
    }

    _computeEffectiveInventorySummary(
        inventory: EmbeddedInventory | null
    ): EffectiveInventorySummary | null {
        if (!inventory || !Array.isArray(inventory.files)) {
            return null;
        }

        const totalEntries = inventory.files.length;
        const embeddedEntries = inventory.files.filter(
            (file) => file?.source === 'embedded'
        ).length;

        return {
            totalEntries,
            embeddedEntries,
            dynamicEntries: totalEntries - embeddedEntries,
            overriddenEntries: 0,
        };
    }

    async _queryApplyBootstrapSetupApi(
        options: Record<string, unknown> = {}
    ): Promise<BootstrapSetupApplyPayload | null> {
        if (typeof this._deviceConnection.executeCode !== 'function') {
            this._log('bootstrap-setup-apply-query-skipped', 'executeCode unavailable');
            return null;
        }

        this._log('bootstrap-setup-apply-query-start', {
            options,
        });

        const optionsLiteral = JSON.stringify(
            options && typeof options === 'object' ? options : {}
        );

        const code = `
import json
print('${OTTER_BOOTSTRAP_APPLY_API_START}')
try:
    import otter_runtime.embedded_metadata_api as _otter_embedded_metadata_api
    _options = ${optionsLiteral}
    _payload = _otter_embedded_metadata_api.apply_bootstrap_setup(_options)
    print(json.dumps({'ok': True, 'payload': _payload}))
except Exception as _otter_bootstrap_apply_error:
    print(json.dumps({'ok': False, 'error': str(_otter_bootstrap_apply_error)}))
print('${OTTER_BOOTSTRAP_APPLY_API_END}')
        `.trim();

        try {
            const output = await this._deviceConnection.executeCode(code);
            const envelope = this._extractBootstrapApplyApiEnvelope(output);
            if (!envelope) {
                this._log('bootstrap-setup-apply-envelope-missing', {
                    outputLength: typeof output === 'string' ? output.length : 0,
                });
                return null;
            }

            if (envelope.ok !== true) {
                this._log('bootstrap-setup-apply-query-unavailable', {
                    error:
                        typeof envelope.error === 'string'
                            ? envelope.error
                            : 'unknown setup apply api error',
                });
                return null;
            }

            const normalized = normalizeBootstrapSetupApplyPayload(envelope.payload);
            if (!normalized) {
                this._log('bootstrap-setup-apply-payload-invalid', {
                    payloadType: typeof envelope.payload,
                });
                return null;
            }

            this._log('bootstrap-setup-apply-query-success', {
                ok: normalized.ok,
                results: normalized.results.length,
                errors: normalized.errors.length,
            });
            return normalized;
        } catch (error: unknown) {
            this._log('bootstrap-setup-apply-query-failed', 'error', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    _extractBootstrapApplyApiEnvelope(output: string): LooseRecord | null {
        const text = String(output ?? '');
        const start = text.indexOf(OTTER_BOOTSTRAP_APPLY_API_START);
        const end = text.indexOf(OTTER_BOOTSTRAP_APPLY_API_END);
        if (start === -1 || end === -1 || end <= start) {
            return null;
        }

        const payloadText = text.slice(start + OTTER_BOOTSTRAP_APPLY_API_START.length, end).trim();
        if (!payloadText) {
            return null;
        }

        try {
            const parsed = parseJsonFromDeviceText<LooseRecord>(payloadText);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    async _resolveRuntimeDeployRoutingDecision(): Promise<RuntimeDeployRoutingDecision> {
        const info = this._deviceConnection.getDeviceInfoData() as LooseRecord | null;
        const infoMode = info?.runtimeDeploymentMode;
        const stateMode = this._deviceState.runtimeDeploymentMode;

        // The connection cache is authoritative when it reports a concrete mode.
        // The device state is authoritative only for "embedded" (and for the new
        // explicit "unknown" state). A bare default "dynamic" state means we have
        // no authoritative info, so keep the legacy dynamic fallback.
        const runtimeMode =
            infoMode === 'embedded' || infoMode === 'dynamic' || infoMode === 'unknown'
                ? infoMode
                : stateMode === 'embedded' || stateMode === 'unknown'
                  ? stateMode
                  : null;

        if (!runtimeMode) {
            this._log(
                'runtime-deploy-routing-decision',
                'mode=dynamic; source=fallback; reason=device-info-runtime-mode-missing'
            );
            return {
                mode: 'dynamic',
                source: 'fallback',
            };
        }

        if (runtimeMode === 'unknown') {
            this._log(
                'runtime-deploy-routing-decision',
                'mode=undetermined; source=fallback; reason=device-info-runtime-mode-missing'
            );
            return {
                mode: 'undetermined',
                source: 'fallback',
            };
        }

        this._log(
            'runtime-deploy-routing-decision',
            `mode=${runtimeMode}; source=api; runtimeId=${info?.runtime?.id || this._deviceState.runtimeId || 'none'}`
        );
        return {
            mode: runtimeMode,
            source: 'api',
        };
    }

    // ========================================================================
    // Event Forwarding
    // ========================================================================

    /**
     * Forward events from specialist classes to main orchestrator.
     * @private
     */
    _forwardEventWithTypedPayload(eventName: string, payloadTypeId: string, event: any) {
        const sourceDetail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
        // Strip the payload type id from the forwarded fields: it is re-supplied below.
        const forwardedFields: Record<string, unknown> = { ...sourceDetail };
        delete forwardedFields.payloadTypeId;
        this.dispatchEvent(
            new CustomEvent(eventName, {
                detail: new DeviceDeploymentEventPayload(payloadTypeId, forwardedFields),
            })
        );
    }

    /**
     * Forward events from specialist classes to main orchestrator.
     * @private
     */
    _setupEventForwarding() {
        // Forward runtime events
        this._runtimeDeployment.addEventListener('runtime-installed', (event) => {
            this._forwardEventWithTypedPayload(
                'runtime-installed',
                'DeviceDeployment.RuntimeInstalled.v1',
                event
            );
        });

        this._runtimeDeployment.addEventListener('runtime-upgraded', (event) => {
            this._forwardEventWithTypedPayload(
                'runtime-upgraded',
                'DeviceDeployment.RuntimeUpgraded.v1',
                event
            );
        });

        this._runtimeDeployment.addEventListener('runtime-removed', (event) => {
            this._forwardEventWithTypedPayload(
                'runtime-removed',
                'DeviceDeployment.RuntimeRemoved.v1',
                event
            );
        });

        this._runtimeDeployment.addEventListener('operation-error', (event) => {
            this._forwardEventWithTypedPayload(
                'operation-error',
                'DeviceDeployment.OperationError.v1',
                event
            );
        });

        // Forward collection events
        this._collectionDeployment.addEventListener('collection-deployed', (event) => {
            this._forwardEventWithTypedPayload(
                'collection-deployed',
                'DeviceDeployment.CollectionDeployed.v1',
                event
            );
        });

        this._collectionDeployment.addEventListener('collection-synced', (event) => {
            this._forwardEventWithTypedPayload(
                'collection-synced',
                'DeviceDeployment.CollectionSynced.v1',
                event
            );
        });

        this._collectionDeployment.addEventListener('collection-removed', (event) => {
            this._forwardEventWithTypedPayload(
                'collection-removed',
                'DeviceDeployment.CollectionRemoved.v1',
                event
            );
        });

        this._collectionDeployment.addEventListener('operation-error', (event) => {
            this._forwardEventWithTypedPayload(
                'operation-error',
                'DeviceDeployment.OperationError.v1',
                event
            );
        });
    }

    // ========================================================================
    // Logging & Utilities
    // ========================================================================

    /**
     * Log a message with consistent formatting.
     * Uses the global logging system (globalThis.__microOtterLog).
     * @private
     * @param {string} reason - Reason/event identifier
     * @param {string} [level='debug'] - Log level: 'debug' | 'info' | 'warn' | 'error'
     * @param {...any} data - Optional data to log
     */
    _log(reason: string, levelOrData: LogLevel | unknown = 'debug', ...data: unknown[]): void {
        const scopedGlobal = globalThis as typeof globalThis & {
            __microOtterLog?: {
                log(scope: string, reason: string, level: LogLevel, ...data: unknown[]): void;
            };
        };
        const isLogLevel =
            levelOrData === 'debug' ||
            levelOrData === 'info' ||
            levelOrData === 'warn' ||
            levelOrData === 'error';
        const level: LogLevel = isLogLevel ? levelOrData : 'debug';
        const payloadData = isLogLevel ? data : [levelOrData, ...data];

        if (typeof globalThis !== 'undefined' && scopedGlobal.__microOtterLog) {
            scopedGlobal.__microOtterLog.log('DeviceDeployment', reason, level, ...payloadData);
        }
    }

    /**
     * Delay helper for async operations.
     * @private
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    _delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
