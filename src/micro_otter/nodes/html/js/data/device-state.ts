import type { DeviceTargetInfo } from './device-target.js';

export type RuntimeDeploymentMode = 'dynamic' | 'embedded' | 'unknown';

export interface EmbeddedPackagesSummary {
    totalPackages: number;
    totalFiles: number;
    totalBytes: number;
    packages?: Array<{
        name: string;
        version?: string | null;
        files?: number | null;
        bytes?: number | null;
    }>;
}

export interface EmbeddedInventoryEntry {
    path: string;
    packageId: string | null;
    packageVersion: string | null;
    fileKind: string;
    source: string;
}

export interface EmbeddedInventory {
    files: EmbeddedInventoryEntry[];
}

export interface EffectiveInventorySummary {
    totalEntries: number;
    embeddedEntries: number;
    dynamicEntries: number;
    overriddenEntries: number;
}

export interface BootstrapSetupStatusFile {
    path: string;
    exists: boolean;
    valid: boolean;
    reason?: string | null;
}

export interface BootstrapSetupStatusIssue {
    path: string;
    reason: string;
}

export interface BootstrapSetupStatusError {
    category: string;
    message: string;
    path?: string | null;
}

export interface BootstrapSetupStatusSummary {
    schemaVersion: number;
    ready: boolean;
    files: BootstrapSetupStatusFile[];
    missingOrInvalid: BootstrapSetupStatusIssue[];
    errors: BootstrapSetupStatusError[];
}

export interface FirmwareConstituentVersions {
    micropythonVersion: string | null;
    runtimeSourceVersion: string | null;
    runtimeFirmwareVersion: string | null;
    deviceToolsVersion: string | null;
    nodePackages: Record<string, string> | null;
    addonPackages?: Record<string, string> | null;
    packageVariants?: Record<string, string> | null;
    frozenAddons?: Record<string, { variant: string; version: string }> | null;
}

export interface DeviceStateData {
    connected?: boolean;
    hasMicroPython?: boolean | null;
    micropythonVersion?: string | null;
    runtimeInstalled?: boolean;
    runtimeId?: string | null;
    runtimeName?: string | null;
    runtimeVersion?: string | null;
    firmwareFullVersion?: string | null;
    runtimeFirmwareVersion?: string | null;
    firmwareConstituentVersions?: FirmwareConstituentVersions | null;
    allowedWebTargetIds?: string[] | null;
    buildBaseTargetId?: string | null;
    runtimeDescription?: string | null;
    runtimeCustomView?: string | null;
    runtimeDeploymentMode?: RuntimeDeploymentMode;
    runtimeEmbedded?: boolean;
    embeddedPackagesSummary?: EmbeddedPackagesSummary | null;
    embeddedInventory?: EmbeddedInventory | null;
    effectiveInventorySummary?: EffectiveInventorySummary | null;
    bootstrapSetupReady?: boolean | null;
    bootstrapSetupStatus?: BootstrapSetupStatusSummary | null;
    deviceTargetInfo?: DeviceTargetInfo | null;
    collectionDeployed?: boolean;
    collectionName?: string | null;
    collectionVersion?: string | null;
    collectionHasFullDefinition?: boolean;
    isExecuting?: boolean;
    deviceInfoLoading?: boolean;
    deviceInfoLoadError?: string | null;
    lastUpdated?: number;
}

export interface DeviceInfoPayload {
    microPythonVersion?: string;
    runtime?: {
        id?: string;
        name?: string;
        version?: string;
        description?: string;
        customView?: string;
    };
    firmware?: {
        fullVersion?: string;
        runtimeFirmwareVersion?: string;
        constituentVersions?: FirmwareConstituentVersions | null;
        allowedWebTargetIds?: string[] | null;
        buildBaseTargetId?: string | null;
    };
    target?: DeviceTargetInfo;
    collection?: {
        name?: string;
        version?: string;
        hasFullDefinition?: boolean;
    };
    runtimeDeploymentMode?: RuntimeDeploymentMode;
    runtimeEmbedded?: boolean;
    embeddedPackagesSummary?: EmbeddedPackagesSummary | null;
    embeddedInventory?: EmbeddedInventory | null;
    bootstrapSetupReady?: boolean | null;
    bootstrapSetupStatus?: BootstrapSetupStatusSummary | null;
}

export class DeviceState {
    private readonly _connected: boolean;
    private readonly _hasMicroPython: boolean | null;
    private readonly _micropythonVersion: string | null;
    private readonly _runtimeInstalled: boolean;
    private readonly _runtimeId: string | null;
    private readonly _runtimeName: string | null;
    private readonly _runtimeVersion: string | null;
    private readonly _firmwareFullVersion: string | null;
    private readonly _runtimeFirmwareVersion: string | null;
    private readonly _firmwareConstituentVersions: FirmwareConstituentVersions | null;
    private readonly _allowedWebTargetIds: string[] | null;
    private readonly _buildBaseTargetId: string | null;
    private readonly _runtimeDescription: string | null;
    private readonly _runtimeCustomView: string | null;
    private readonly _runtimeDeploymentMode: RuntimeDeploymentMode;
    private readonly _runtimeEmbedded: boolean;
    private readonly _embeddedPackagesSummary: EmbeddedPackagesSummary | null;
    private readonly _embeddedInventory: EmbeddedInventory | null;
    private readonly _effectiveInventorySummary: EffectiveInventorySummary | null;
    private readonly _bootstrapSetupReady: boolean | null;
    private readonly _bootstrapSetupStatus: BootstrapSetupStatusSummary | null;
    private readonly _deviceTargetInfo: DeviceTargetInfo | null;
    private readonly _collectionDeployed: boolean;
    private readonly _collectionName: string | null;
    private readonly _collectionVersion: string | null;
    private readonly _collectionHasFullDefinition: boolean;
    private readonly _isExecuting: boolean;
    private readonly _deviceInfoLoading: boolean;
    private readonly _deviceInfoLoadError: string | null;
    private readonly _lastUpdated: number;

    constructor(data: DeviceStateData = {}) {
        this._connected = data.connected ?? false;
        this._hasMicroPython = data.hasMicroPython ?? null;
        this._micropythonVersion = data.micropythonVersion ?? null;

        this._runtimeInstalled = data.runtimeInstalled ?? false;
        this._runtimeId = data.runtimeId ?? null;
        this._runtimeName = data.runtimeName ?? null;
        this._runtimeVersion = data.runtimeVersion ?? null;
        this._firmwareFullVersion = data.firmwareFullVersion ?? null;
        this._runtimeFirmwareVersion = data.runtimeFirmwareVersion ?? null;
        this._firmwareConstituentVersions = data.firmwareConstituentVersions ?? null;
        this._allowedWebTargetIds = data.allowedWebTargetIds ?? null;
        this._buildBaseTargetId = data.buildBaseTargetId ?? null;
        this._runtimeDescription = data.runtimeDescription ?? null;
        this._runtimeCustomView = data.runtimeCustomView ?? null;
        this._runtimeDeploymentMode = data.runtimeDeploymentMode ?? 'dynamic';
        this._runtimeEmbedded = data.runtimeEmbedded ?? false;
        this._embeddedPackagesSummary = data.embeddedPackagesSummary ?? null;
        this._embeddedInventory = data.embeddedInventory ?? null;
        this._effectiveInventorySummary = data.effectiveInventorySummary ?? null;
        this._bootstrapSetupReady = data.bootstrapSetupReady ?? null;
        this._bootstrapSetupStatus = data.bootstrapSetupStatus ?? null;

        this._deviceTargetInfo = data.deviceTargetInfo ?? null;

        this._collectionDeployed = data.collectionDeployed ?? false;
        this._collectionName = data.collectionName ?? null;
        this._collectionVersion = data.collectionVersion ?? null;
        this._collectionHasFullDefinition = data.collectionHasFullDefinition ?? false;

        this._isExecuting = data.isExecuting ?? false;

        this._deviceInfoLoading = data.deviceInfoLoading ?? false;
        this._deviceInfoLoadError = data.deviceInfoLoadError ?? null;

        this._lastUpdated = data.lastUpdated ?? Date.now();
    }

    get connected(): boolean {
        return this._connected;
    }

    get hasMicroPython(): boolean | null {
        return this._hasMicroPython;
    }

    get micropythonVersion(): string | null {
        return this._micropythonVersion;
    }

    get runtimeInstalled(): boolean {
        return this._runtimeInstalled;
    }

    get runtimeId(): string | null {
        return this._runtimeId;
    }

    get runtimeName(): string | null {
        return this._runtimeName;
    }

    get runtimeVersion(): string | null {
        return this._runtimeVersion;
    }

    get firmwareFullVersion(): string | null {
        return this._firmwareFullVersion;
    }

    get runtimeFirmwareVersion(): string | null {
        return this._runtimeFirmwareVersion;
    }

    get firmwareConstituentVersions(): FirmwareConstituentVersions | null {
        return this._firmwareConstituentVersions;
    }

    /**
     * Return the target ids the connected board's firmware can onboard, or null
     * when the firmware did not record any (an empty list means "no filter").
     */
    get allowedWebTargetIds(): string[] | null {
        return this._allowedWebTargetIds;
    }

    /**
     * Return the terminal build base id the flashed image records, or null when
     * the image predates the field.
     */
    get buildBaseTargetId(): string | null {
        return this._buildBaseTargetId;
    }

    get runtimeDescription(): string | null {
        return this._runtimeDescription;
    }

    get runtimeCustomView(): string | null {
        return this._runtimeCustomView;
    }

    get runtimeDeploymentMode(): RuntimeDeploymentMode {
        return this._runtimeDeploymentMode;
    }

    get runtimeEmbedded(): boolean {
        return this._runtimeEmbedded;
    }

    get embeddedPackagesSummary(): EmbeddedPackagesSummary | null {
        return this._embeddedPackagesSummary;
    }

    get embeddedInventory(): EmbeddedInventory | null {
        return this._embeddedInventory;
    }

    get effectiveInventorySummary(): EffectiveInventorySummary | null {
        return this._effectiveInventorySummary;
    }

    get bootstrapSetupReady(): boolean | null {
        return this._bootstrapSetupReady;
    }

    get bootstrapSetupStatus(): BootstrapSetupStatusSummary | null {
        return this._bootstrapSetupStatus;
    }

    get deviceTargetInfo(): DeviceTargetInfo | null {
        return this._deviceTargetInfo;
    }

    get collectionDeployed(): boolean {
        return this._collectionDeployed;
    }

    get collectionName(): string | null {
        return this._collectionName;
    }

    get collectionVersion(): string | null {
        return this._collectionVersion;
    }

    get collectionHasFullDefinition(): boolean {
        return this._collectionHasFullDefinition;
    }

    get isExecuting(): boolean {
        return this._isExecuting;
    }

    get deviceInfoLoading(): boolean {
        return this._deviceInfoLoading;
    }

    get deviceInfoLoadError(): string | null {
        return this._deviceInfoLoadError;
    }

    get lastUpdated(): number {
        return this._lastUpdated;
    }

    update(updates: Partial<DeviceStateData>): DeviceState {
        return new DeviceState({
            ...this.toObject(),
            ...updates,
            lastUpdated: Date.now(),
        });
    }

    static fromDeviceInfo(info: DeviceInfoPayload): DeviceState {
        const runtimeMode =
            info.runtimeDeploymentMode === 'embedded' ||
            info.runtimeDeploymentMode === 'dynamic' ||
            info.runtimeDeploymentMode === 'unknown'
                ? info.runtimeDeploymentMode
                : 'dynamic';
        const runtimeEmbedded =
            info.runtimeEmbedded === true || info.runtimeDeploymentMode === 'embedded';

        return new DeviceState({
            connected: true,
            hasMicroPython: true,
            micropythonVersion: info.microPythonVersion || null,
            runtimeInstalled: Boolean(info.runtime),
            runtimeId: info.runtime?.id || null,
            runtimeName: info.runtime?.name || null,
            runtimeVersion: info.runtime?.version || null,
            firmwareFullVersion: info.firmware?.fullVersion || null,
            runtimeFirmwareVersion: info.firmware?.runtimeFirmwareVersion || null,
            firmwareConstituentVersions: info.firmware?.constituentVersions || null,
            allowedWebTargetIds: info.firmware?.allowedWebTargetIds ?? null,
            buildBaseTargetId: info.firmware?.buildBaseTargetId ?? null,
            runtimeDescription: info.runtime?.description || null,
            runtimeCustomView: info.runtime?.customView || null,
            runtimeDeploymentMode: runtimeMode,
            runtimeEmbedded: runtimeEmbedded,
            embeddedPackagesSummary: info.embeddedPackagesSummary ?? null,
            embeddedInventory: info.embeddedInventory ?? null,
            effectiveInventorySummary: null,
            bootstrapSetupReady: info.bootstrapSetupReady ?? null,
            bootstrapSetupStatus: info.bootstrapSetupStatus ?? null,
            deviceTargetInfo: info.target || null,
            collectionDeployed: Boolean(info.collection),
            collectionName: info.collection?.name || null,
            collectionVersion: info.collection?.version || null,
            collectionHasFullDefinition: info.collection?.hasFullDefinition || false,
        });
    }

    toObject(): Required<DeviceStateData> {
        return {
            connected: this._connected,
            hasMicroPython: this._hasMicroPython,
            micropythonVersion: this._micropythonVersion,
            runtimeInstalled: this._runtimeInstalled,
            runtimeId: this._runtimeId,
            runtimeName: this._runtimeName,
            runtimeVersion: this._runtimeVersion,
            firmwareFullVersion: this._firmwareFullVersion,
            runtimeFirmwareVersion: this._runtimeFirmwareVersion,
            firmwareConstituentVersions: this._firmwareConstituentVersions,
            allowedWebTargetIds: this._allowedWebTargetIds,
            buildBaseTargetId: this._buildBaseTargetId,
            runtimeDescription: this._runtimeDescription,
            runtimeCustomView: this._runtimeCustomView,
            runtimeDeploymentMode: this._runtimeDeploymentMode,
            runtimeEmbedded: this._runtimeEmbedded,
            embeddedPackagesSummary: this._embeddedPackagesSummary,
            embeddedInventory: this._embeddedInventory,
            effectiveInventorySummary: this._effectiveInventorySummary,
            bootstrapSetupReady: this._bootstrapSetupReady,
            bootstrapSetupStatus: this._bootstrapSetupStatus,
            deviceTargetInfo: this._deviceTargetInfo,
            collectionDeployed: this._collectionDeployed,
            collectionName: this._collectionName,
            collectionVersion: this._collectionVersion,
            collectionHasFullDefinition: this._collectionHasFullDefinition,
            isExecuting: this._isExecuting,
            deviceInfoLoading: this._deviceInfoLoading,
            deviceInfoLoadError: this._deviceInfoLoadError,
            lastUpdated: this._lastUpdated,
        };
    }

    toJSON(): Record<string, unknown> {
        return {
            connected: this._connected,
            hasMicroPython: this._hasMicroPython,
            micropythonVersion: this._micropythonVersion,
            runtimeInstalled: this._runtimeInstalled,
            runtimeId: this._runtimeId,
            runtimeName: this._runtimeName,
            runtimeVersion: this._runtimeVersion,
            runtimeDescription: this._runtimeDescription,
            runtimeCustomView: this._runtimeCustomView,
            runtimeDeploymentMode: this._runtimeDeploymentMode,
            runtimeEmbedded: this._runtimeEmbedded,
            embeddedPackagesSummary: this._embeddedPackagesSummary,
            embeddedInventory: this._embeddedInventory,
            effectiveInventorySummary: this._effectiveInventorySummary,
            bootstrapSetupReady: this._bootstrapSetupReady,
            bootstrapSetupStatus: this._bootstrapSetupStatus,
            deviceTargetInfo:
                (this._deviceTargetInfo as { toJSON?: () => unknown } | null)?.toJSON?.() ||
                this._deviceTargetInfo,
            collectionDeployed: this._collectionDeployed,
            collectionName: this._collectionName,
            collectionVersion: this._collectionVersion,
            collectionHasFullDefinition: this._collectionHasFullDefinition,
            isExecuting: this._isExecuting,
            deviceInfoLoading: this._deviceInfoLoading,
            deviceInfoLoadError: this._deviceInfoLoadError,
            lastUpdated: this._lastUpdated,
        };
    }

    getChangedFields(other: DeviceState): string[] {
        const changed: string[] = [];

        if (this._connected !== other._connected) changed.push('connected');
        if (this._hasMicroPython !== other._hasMicroPython) changed.push('hasMicroPython');
        if (this._micropythonVersion !== other._micropythonVersion)
            changed.push('micropythonVersion');
        if (this._runtimeInstalled !== other._runtimeInstalled) changed.push('runtimeInstalled');
        if (this._runtimeId !== other._runtimeId) changed.push('runtimeId');
        if (this._runtimeName !== other._runtimeName) changed.push('runtimeName');
        if (this._runtimeVersion !== other._runtimeVersion) changed.push('runtimeVersion');
        if (this._runtimeDescription !== other._runtimeDescription)
            changed.push('runtimeDescription');
        if (this._runtimeCustomView !== other._runtimeCustomView) changed.push('runtimeCustomView');
        if (this._runtimeDeploymentMode !== other._runtimeDeploymentMode)
            changed.push('runtimeDeploymentMode');
        if (this._runtimeEmbedded !== other._runtimeEmbedded) changed.push('runtimeEmbedded');
        if (this._embeddedPackagesSummary !== other._embeddedPackagesSummary)
            changed.push('embeddedPackagesSummary');
        if (this._embeddedInventory !== other._embeddedInventory) changed.push('embeddedInventory');
        if (this._effectiveInventorySummary !== other._effectiveInventorySummary)
            changed.push('effectiveInventorySummary');
        if (this._bootstrapSetupReady !== other._bootstrapSetupReady)
            changed.push('bootstrapSetupReady');
        if (this._bootstrapSetupStatus !== other._bootstrapSetupStatus)
            changed.push('bootstrapSetupStatus');
        if (this._deviceTargetInfo !== other._deviceTargetInfo) changed.push('deviceTargetInfo');
        if (this._collectionDeployed !== other._collectionDeployed)
            changed.push('collectionDeployed');
        if (this._collectionName !== other._collectionName) changed.push('collectionName');
        if (this._collectionVersion !== other._collectionVersion) changed.push('collectionVersion');
        if (this._isExecuting !== other._isExecuting) changed.push('isExecuting');
        if (this._deviceInfoLoading !== other._deviceInfoLoading) changed.push('deviceInfoLoading');
        if (this._deviceInfoLoadError !== other._deviceInfoLoadError)
            changed.push('deviceInfoLoadError');

        return changed;
    }

    isReadyForDeployment(): boolean {
        return this._connected && this._hasMicroPython === true && this._runtimeInstalled;
    }
}
