// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * CollectionDeployment - Phase 3 Operations
 *
 * Handles collection deployment to ESP32 devices.
 * Manages collection code generation, validation, file syncing, and removal.
 */

import { ProgressTracker } from '../core/progress-events.js';
import { HashManifestManager } from './hash-manifest-manager.js';
import { AppPayload } from '../core/app-event.js';
import { validateNodeCapabilities } from '../core/node-capability-validator.js';
import { validateGraphResources } from '../core/graph-resource-validator.js';
import {
    evaluateRequiredCapabilities,
    createPackageCapabilityContext,
} from '../core/capability-requirements.js';
import DeviceTargetInfo from '../data/device-target.js';
import { isFunctionGraphManagedNodeType } from '../data/graph-function-nodes.js';
import type { HashManifestRecord } from './hash-manifest-manager.js';
import { calculateFileHash, resolveFirmwareBundledPackageIds, resolveFrozenAddonVersions } from './deployment-utils.js';
import { resolveFirmwareModulePlan } from './embedded-module-plan.js';
import {
    isPackageModuleImport,
    isPackageModulePath,
} from '../data/module-namespace.js';

const UPLOAD_VERIFY_MAX_RETRIES = 3;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface CollectionDeployOptions {
    includeFullDefinition?: boolean;
    force?: boolean;
    deviceHashes?: HashManifestRecord;
    embeddedLibraryOverridePaths?: string[];
    /**
     * How the embedded override paths were obtained.
     *
     * `approved` (default) means the consent gate asked the user. `forced` means the user
     * explicitly requested the shadow upload in the deploy options; it only changes the log to
     * `collection-library-override-forced` so an audited run is recognisable. It never approves a
     * path implicitly — `embeddedLibraryOverridePaths` must still cover every shadow path.
     */
    embeddedOverrideMode?: 'approved' | 'forced';
    mpyProbe?: {
        mpyAbi?: number | null;
        platform?: string | null;
        smallIntBits?: number | null;
    };
    mpyCompileProfile?: {
        hash?: string;
    };
    mpyFallbackDecision?: 'mpy' | 'source' | 'cancel';
    mpyAvailability?: {
        runtime?: { hasProfile?: boolean };
        nodePackages?: Array<{ packageId?: string; hasProfile?: boolean }>;
    };
}

/**
 * Thrown when a shadow package would reach the upload phase without a complete approval.
 *
 * Shadowing replaces a firmware-bundled package with host source, so every file of that package
 * must appear in `embeddedLibraryOverridePaths`. A missing or partial approval is an error that
 * aborts the deploy before a single file is transferred — never a silent fallback to the firmware
 * copy, which is what made a stale package look installed.
 */
export class EmbeddedOverrideApprovalRequiredError extends Error {
    /** Stable machine-readable discriminator for UI callers. */
    code: string;
    /** Packages whose upload paths are not fully covered by the approval. */
    packageIds: string[];
    /** The approved-list gaps that caused the failure. */
    missingPaths: string[];

    /**
     * @param {string[]} packageIds - Shadow packages with unapproved upload paths
     * @param {string[]} missingPaths - Paths that were planned but never approved
     */
    constructor(packageIds: string[] = [], missingPaths: string[] = []) {
        const packageList = Array.isArray(packageIds) ? packageIds.filter(Boolean) : [];
        const pathList = Array.isArray(missingPaths) ? missingPaths.filter(Boolean) : [];
        super(
            packageList.length > 0
                ? `Deployment blocked: embedded override approval is missing for ${packageList.join(
                      ', '
                  )} (${pathList.length} unapproved file${pathList.length === 1 ? '' : 's'})`
                : 'Deployment blocked: embedded override approval is missing'
        );
        this.name = 'EmbeddedOverrideApprovalRequiredError';
        this.code = 'EMBEDDED_OVERRIDE_APPROVAL_REQUIRED';
        this.packageIds = packageList;
        this.missingPaths = pathList;
    }
}

interface CollectionDeployPreparationResult {
    totalFiles: number;
    collectionFiles: number;
    libraries: number;
}

interface TransferProgressPayload {
    totalFiles: number;
    breakdown: {
        collectionFiles: number;
        libraries: number;
    };
}

type CollectionLike = Record<string, any>;

interface DeviceRuntimeLike {
    resolvedFilesystem?: string[];
    nodePackages?: Array<{
        id?: string;
        manifest?: Record<string, unknown> | null;
        mpAssets?: Record<string, string[]>;
        requiredCapabilities?: unknown;
        requiredPackages?: unknown;
    }>;
    [key: string]: any;
}

interface DeviceRuntimeCollectionLike {
    getRuntime(runtimeId: string): DeviceRuntimeLike | null | undefined;
}

interface DependencyContainerLike {
    dependencies?: string[];
    value?: unknown;
}

interface NodeTypeLike extends Record<string, unknown> {
    implementations?: {
        python?: DependencyContainerLike;
    };
    initImplementations?: {
        python?: DependencyContainerLike;
    };
    requiredCapabilities?: unknown;
    capabilityCheck?: string;
}

interface GeneratedCollectionArtifactLike {
    targetPath?: string;
    content?: string | Uint8Array;
}

interface TranspileResultLike {
    code: string;
    generatedArtifacts?: GeneratedCollectionArtifactLike[];
    artifacts?: unknown;
    assets?: {
        generatedArtifacts?: GeneratedCollectionArtifactLike[];
    } | null;
}

interface CollectionManagerLike {
    transpileCollection(
        collection: CollectionLike,
        options: { deviceRuntime: DeviceRuntimeLike }
    ): Promise<TranspileResultLike>;
    getNodeType(nodeTypeId: string): NodeTypeLike | null | undefined;
}

interface DeviceConnectionLike {
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    sendFile(path: string, content: string | Uint8Array): Promise<void>;
    calculateHash(path: string): Promise<string>;
    isExecutionRunning?(): boolean;
    softReset(options?: { startRunning?: boolean }): Promise<void>;
    deleteFile(path: string): Promise<void>;
    deleteFolderRecursive(path: string): Promise<void>;
    /** Optional: recursive / empty-only folder removal that reports the removed entry count. */
    removeFolder?(path: string, options?: { recursive?: boolean }): Promise<number>;
    [key: string]: any;
}

interface DeviceTargetInfoLike {
    id?: string;
    capabilityToPins?: Record<string, unknown> | null;
    generalCapabilities?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    [key: string]: any;
}

interface DeviceStateLike {
    connected: boolean;
    runtimeInstalled: boolean;
    runtimeId?: string | null;
    runtimeName?: string | null;
    runtimeVersion?: string | null;
    runtimeDeploymentMode?: 'dynamic' | 'embedded' | null;
    runtimeEmbedded?: boolean;
    deviceTargetInfo?: DeviceTargetInfoLike | null;
    toJSON?(): unknown;
    [key: string]: any;
}

interface PreparedCollectionFile {
    devicePath: string;
    content: string | Uint8Array;
    hash: string;
}

interface PreparedLibraryFile {
    devicePath: string;
    url: string;
    content: string | Uint8Array;
    manifestTag?: 'dynamic' | 'override-embedded';
}

interface PreparedFilesByType {
    collection: PreparedCollectionFile[];
    libraries: PreparedLibraryFile[];
}

interface ValidationError {
    nodeId?: string;
    nodeType?: string;
    capability?: string;
    message: string;
}

interface GraphConnectionLike {
    fromNode?: string;
    fromIndex?: number;
    toNode?: string;
    toIndex?: number;
}

interface CollectionMetadata {
    name: string;
    uuid: string;
    version: string;
    hasFullDefinition: boolean;
    graphs?: unknown;
    targetId?: string;
    deviceRuntimeId?: string;
    activeGraphIdx?: number;
}

interface CollectionDeploymentConstructorOptions {
    deviceConnection: DeviceConnectionLike;
    deviceState: DeviceStateLike;
    updateDeviceState: (statePatch: Record<string, unknown>) => void;
    collectionManager: CollectionManagerLike;
    runtimeCollection: DeviceRuntimeCollectionLike;
    transpiler: unknown;
}

class CollectionDeploymentEventPayload extends AppPayload {
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

/**
 * Manages collection deployment operations to ESP32 devices.
 * Handles deploy, sync, remove, and validation of node graph collections.
 *
 * @extends EventTarget
 * @emits collection-deployed - Collection deployment complete
 * @emits collection-synced - Collection sync complete
 * @emits collection-removed - Collection removal complete
 * @emits operation-error - Error during operation
 */
export class CollectionDeployment extends EventTarget {
    private _deviceConnection: DeviceConnectionLike;
    private _deviceState: DeviceStateLike;
    private _updateDeviceState: (statePatch: Record<string, unknown>) => void;
    private _collectionManager: CollectionManagerLike;
    private _runtimeCollection: DeviceRuntimeCollectionLike;
    private _transpiler: unknown;
    private _hashManager: HashManifestManager;
    private _currentOperation: ProgressTracker | null;
    private _preparedFiles: PreparedFilesByType;

    /**
     * `libs/` / `otter_*` paths the device user space holds according to the hash manifest.
     *
     * Recorded for display and diagnostics only (Device Info block). It is **never** an input to
     * plan membership: the prepared plan decides what is needed, and the manifest is only the
     * left-hand side of the stale subtraction.
     */
    _dynamicLibraryPathsOnDevice: Set<string> = new Set<string>();

    /**
     * Every library path the node graph needs for the current preparation run (`allLibraries`
     * after whole-package override expansion). Snapshot only — it is read by
     * {@link _getStaleCollectionPaths} to decide whether a manifest path the plan does not upload
     * is still needed, i.e. must stay on the device when the firmware cannot replace it.
     */
    _candidateLibraryPaths: Set<string> = new Set<string>();

    /**
     * Library paths the firmware provides for the current preparation run (`firmwareProvidedPaths`
     * of the module plan). Read by {@link _getStaleCollectionPaths} to keep a still-needed
     * user-space file only when the firmware demonstrably replaces it.
     */
    _firmwareProvidedLibraryPaths: Set<string> = new Set<string>();

    /**
     * Package folders this deploy leaves entirely to the firmware, mapped to their package id.
     * Computed during library preparation; empty unless the firmware is current for every needed
     * file of the package. Consumed by `_removeStaleLibraryFolders`.
     */
    _firmwareOwnedPackageFolders: Map<string, string> = new Map<string, string>();
    _stalePackageFolders: Set<string> = new Set<string>();

    /**
     * @param {Object} options
     * @param {DeviceConnection} options.deviceConnection - Device connection manager
     * @param {import('../data/device-state.js').DeviceState} options.deviceState - DeviceState instance
     * @param {Function} options.updateDeviceState - Function to update device state
     * @param {CollectionManager} options.collectionManager - Collection manager
     * @param {DeviceRuntimeCollection} options.runtimeCollection - Runtime collection
     * @param {Transpiler} options.transpiler - Code transpiler
     */
    constructor({
        deviceConnection,
        deviceState,
        updateDeviceState,
        collectionManager,
        runtimeCollection,
        transpiler,
    }: CollectionDeploymentConstructorOptions) {
        super();

        this._deviceConnection = deviceConnection;
        this._deviceState = deviceState;
        this._updateDeviceState = updateDeviceState;
        this._collectionManager = collectionManager;
        this._runtimeCollection = runtimeCollection;
        this._transpiler = transpiler;

        // Hash manifest manager for centralized hash operations
        this._hashManager = new HashManifestManager(deviceConnection);

        // Operation state
        this._currentOperation = null; // ProgressTracker for active operation

        // Prepared file lists (populated during preparation phase)
        this._preparedFiles = {
            collection: [], // [{devicePath, content, hash}] - transpiled code + metadata
            libraries: [], // [{devicePath, url, content}] - filtered node libraries
        };
    }

    /**
     * Update the DeviceState reference after an immutable update.
     * @param {import('../data/device-state.js').DeviceState} deviceState
     */
    setDeviceState(deviceState: DeviceStateLike): void {
        this._deviceState = deviceState;
    }

    /**
     * Check if device is connected.
     * @returns {boolean}
     */
    isConnected(): boolean {
        return this._deviceState.connected;
    }

    /**
     * Check if runtime is installed.
     * @returns {boolean}
     */
    hasRuntime(): boolean {
        return this._deviceState.runtimeInstalled === true;
    }

    // ====================
    // Preparation Methods
    // ====================

    /**
     * Prepare collection deployment by generating files and resolving libraries.
     * @param {Collection} collection - Collection to deploy
     * @param {Object} options - Deploy options
     * @returns {Promise<Object>} Preparation result with file counts
     */
    async prepareDeployCollection(
        collection: CollectionLike,
        options: CollectionDeployOptions = {}
    ): Promise<CollectionDeployPreparationResult> {
        const { includeFullDefinition = false } = options;

        this._assertEmbeddedRuntimeContract();

        this._log('prepare-deploy-collection-start', {
            collectionName: collection.getTitle(),
        });

        // Validate collection compatibility
        await this._validateCollectionCompatibility(collection);

        // Prepare collection files (transpiled code + metadata)
        const collectionFileCount = await this._prepareCollectionFilesUpload(
            collection,
            includeFullDefinition
        );

        // Prepare node libraries (filtered based on graph usage)
        const libraryCount = await this._prepareNodeLibrariesUpload(collection, options);

        const totalFiles = collectionFileCount + libraryCount;

        this._log('prepare-deploy-collection-complete', {
            collectionFiles: collectionFileCount,
            libraries: libraryCount,
            totalFiles,
        });

        return {
            totalFiles,
            collectionFiles: collectionFileCount,
            libraries: libraryCount,
        };
    }

    /**
     * Prepare collection files upload by transpiling and generating files.
     * @private
     * @param {Collection} collection - Collection to deploy
     * @param {boolean} includeFullDefinition - Include full graph structure in metadata
     * @returns {Promise<number>} Count of files to upload
     */
    async _prepareCollectionFilesUpload(
        collection: CollectionLike,
        includeFullDefinition: boolean,
        transpileResultOverride: TranspileResultLike | null = null
    ): Promise<number> {
        let transpileResult: TranspileResultLike | null = transpileResultOverride;
        if (!transpileResult) {
            // Get device runtime for transpilation
            const runtimeId = this._deviceState.runtimeId;
            if (!runtimeId) {
                throw new Error('Device runtime ID not available');
            }

            const deviceRuntime = this._runtimeCollection?.getRuntime(runtimeId);
            if (!deviceRuntime) {
                throw new Error(`Runtime not found: ${runtimeId}`);
            }

            // Transpile collection to Python code
            transpileResult = await this._collectionManager.transpileCollection(collection, {
                deviceRuntime,
            });
        }

        if (!transpileResult || typeof transpileResult.code !== 'string') {
            throw new Error('Collection transpile result is invalid');
        }

        const preparedFiles: PreparedCollectionFile[] = [];
        const preparedPaths = new Set<string>();

        // 1. Transpiled code (app/main_loop.py) - prepare and stage hash
        const { hash: codeHash } = await this._hashManager.prepareFile(
            'collection',
            'app/main_loop.py',
            transpileResult.code
        );
        preparedFiles.push({
            devicePath: 'app/main_loop.py',
            content: transpileResult.code,
            hash: codeHash,
        });
        preparedPaths.add('app/main_loop.py');

        // 2. Collection metadata (collection/node_graph_cln.json) - prepare and stage hash
        const metadata = this._generateCollectionMetadata(collection, includeFullDefinition);
        const metadataStr = JSON.stringify(metadata, null, 2);
        const { hash: metadataHash } = await this._hashManager.prepareFile(
            'collection',
            'collection/node_graph_cln.json',
            metadataStr
        );
        preparedFiles.push({
            devicePath: 'collection/node_graph_cln.json',
            content: metadataStr,
            hash: metadataHash,
        });
        preparedPaths.add('collection/node_graph_cln.json');

        // 3. Additional generated collection artifacts (in-memory channel)
        const generatedArtifacts = this._collectGeneratedCollectionArtifacts(transpileResult);
        for (const artifact of generatedArtifacts) {
            const targetPath = this._normalizeGeneratedArtifactPath(artifact?.targetPath);
            if (!targetPath) {
                throw new Error('Generated artifact targetPath is required');
            }

            if (!this._isAllowedGeneratedArtifactPath(targetPath)) {
                throw new Error(
                    `Generated artifact targetPath '${targetPath}' must be under 'app/' or 'collection/'`
                );
            }

            if (preparedPaths.has(targetPath)) {
                throw new Error(`Duplicate generated artifact path: ${targetPath}`);
            }

            const content = artifact?.content;
            if (!(typeof content === 'string' || content instanceof Uint8Array)) {
                throw new Error(
                    `Generated artifact '${targetPath}' has invalid content type; expected string or Uint8Array`
                );
            }

            const { hash } = await this._hashManager.prepareFile('collection', targetPath, content);
            preparedFiles.push({
                devicePath: targetPath,
                content,
                hash,
            });
            preparedPaths.add(targetPath);
        }

        this._preparedFiles.collection = preparedFiles;

        this._log('collection-files-preparation-complete', {
            fileCount: preparedFiles.length,
        });

        return preparedFiles.length;
    }

    /**
     * Prepare node libraries upload by resolving dependencies and fetching contents.
     * Scans graphs for node types, resolves dependencies, and recursively walks imports.
     * @private
     * @param {Collection} collection - Collection to analyze for library dependencies
     * @returns {Promise<number>} Count of library files to upload
     */
    async _prepareNodeLibrariesUpload(
        collection: CollectionLike,
        options: CollectionDeployOptions = {}
    ): Promise<number> {
        this._assertEmbeddedRuntimeContract();

        // Reset the snapshots so a failed/partial prepare can never leak the previous run's
        // candidate or firmware-provided set into the stale-cleanup decision.
        this._candidateLibraryPaths = new Set<string>();
        this._firmwareProvidedLibraryPaths = new Set<string>();
        this._firmwareOwnedPackageFolders = new Map<string, string>();

        // Get device runtime
        const runtimeId = this._deviceState.runtimeId;
        if (!runtimeId) {
            throw new Error('Device runtime ID not available');
        }

        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        const embeddedMode = this._isEmbeddedRuntimeMode();
        // The hash manifest must be loaded before the upload phase compares hashes
        // (HashManifestManager.getFilesToUpload). The recorded on-device library inventory is
        // informational only and is never used to decide plan membership.
        this._dynamicLibraryPathsOnDevice = embeddedMode
            ? await this._loadDynamicLibraryPathSet()
            : new Set<string>();
        const embeddedLibraryOverridePaths = this._normalizeEmbeddedOverridePaths(
            options.embeddedLibraryOverridePaths
        );

        // Get all unique node types used in collection
        const nodeTypes = new Set<string>();
        const graphs = collection.getGraphArray?.() || [];
        for (const graph of graphs) {
            const nodes = graph.getNodes?.() || [];
            for (const node of nodes) {
                nodeTypes.add(node.type);
            }
        }

        // Collect all library dependencies from node implementations
        const requiredLibraries = new Set<string>();

        for (const nodeTypeId of nodeTypes) {
            const nodeType = this._collectionManager?.getNodeType(nodeTypeId);
            if (!nodeType) continue;

            // Check Python implementation dependencies
            const pythonImpl = nodeType.implementations?.python;
            this._collectImplementationLibraries(pythonImpl, requiredLibraries);

            // Check init implementation dependencies
            const pythonInitImpl = nodeType.initImplementations?.python;
            this._collectImplementationLibraries(pythonInitImpl, requiredLibraries);
        }

        // Convert library paths to file paths (otter_stdmo.servo → otter_stdmo/servo.py)
        const libraryFiles = Array.from(requiredLibraries).map(
            (libPath) => libPath.replace(/\./g, '/') + '.py'
        );

        // Resolve transitive dependencies by scanning imports
        const transitiveLibraries = await this._resolveTransitiveDependencies(
            libraryFiles,
            runtime
        );
        const allLibraries = new Set(transitiveLibraries);

        // Include package wildcard and node-type-specific assets from mpAssets.
        const packageAssetKeysInUse = new Map<string, Set<string>>();
        for (const nodeTypeId of nodeTypes) {
            const normalized = String(nodeTypeId || '').trim();
            if (!normalized) {
                continue;
            }

            const dotIndex = normalized.indexOf('.');
            const dashIndex = normalized.indexOf('-');
            const splitIndex =
                dotIndex >= 0 && dashIndex >= 0
                    ? Math.min(dotIndex, dashIndex)
                    : Math.max(dotIndex, dashIndex);

            const packageId = splitIndex > 0 ? normalized.slice(0, splitIndex).trim() : normalized;
            if (!packageId) {
                continue;
            }

            const keySet = packageAssetKeysInUse.get(packageId) || new Set<string>();
            keySet.add('*');
            if (splitIndex > 0 && splitIndex + 1 < normalized.length) {
                keySet.add(normalized.slice(splitIndex + 1));
            }
            packageAssetKeysInUse.set(packageId, keySet);
        }

        this._expandRequiredPackages(packageAssetKeysInUse, runtime.nodePackages || []);

        const nodePackages = runtime.nodePackages || [];
        const libPathToPackageId = new Map<string, string>();
        // Complete library path list per package in use, built from ALL mpAssets entries (not
        // just the requested asset keys). Needed to expand an embedded override to the whole
        // package: MicroPython resolves a package's submodules only inside the directory that
        // won the import (`__path__`), so a partial shadow copy breaks imports.
        const packageAssetPathsByPackage = new Map<string, string[]>();
        for (const nodePackage of nodePackages) {
            const packageId = nodePackage?.id || '';
            const requestedAssetKeys = packageAssetKeysInUse.get(packageId);
            if (!requestedAssetKeys || requestedAssetKeys.size === 0) {
                continue;
            }

            const mpAssets = nodePackage?.mpAssets || {};
            for (const assetKey of requestedAssetKeys) {
                const assetList = mpAssets[assetKey];
                if (!Array.isArray(assetList)) {
                    continue;
                }

                for (const assetUrl of assetList) {
                    if (typeof assetUrl !== 'string') {
                        continue;
                    }

                    const assetPath = this._extractLibraryPathFromUrl(assetUrl);
                    if (
                        assetPath &&
                        isPackageModulePath(assetPath)
                    ) {
                        allLibraries.add(assetPath);
                        if (packageId) {
                            libPathToPackageId.set(assetPath, packageId);
                        }
                    }
                }
            }

            const packagePaths = new Set<string>();
            for (const assetList of Object.values(mpAssets)) {
                if (!Array.isArray(assetList)) {
                    continue;
                }

                for (const assetUrl of assetList) {
                    if (typeof assetUrl !== 'string') {
                        continue;
                    }

                    const assetPath = this._extractLibraryPathFromUrl(assetUrl);
                    if (
                        assetPath &&
                        isPackageModulePath(assetPath)
                    ) {
                        packagePaths.add(assetPath);
                    }
                }
            }
            if (packageId && packagePaths.size > 0) {
                packageAssetPathsByPackage.set(packageId, Array.from(packagePaths).sort());
            }
        }

        // Build the single firmware module plan that decides skip / upload / block for every
        // library path. One function answers "is it up to date", "what must be uploaded" and
        // "what is missing" from one set of inputs (see embedded-module-plan.ts).
        const globalPackageIds = resolveFirmwareBundledPackageIds(
            runtime.nodePackagesGlobal ?? [],
            this._deviceState.firmwareConstituentVersions
        );
        const hostVersions = new Map<string, string | null>();
        for (const nodePackage of runtime.nodePackages ?? []) {
            const packageId = nodePackage?.id;
            if (!packageId) {
                continue;
            }
            const hostVersion =
                nodePackage?.manifest && typeof nodePackage.manifest['version'] === 'string'
                    ? (nodePackage.manifest['version'] as string)
                    : null;
            hostVersions.set(packageId, hostVersion);
        }

        const firmwareVersions = this._resolveFirmwareVersions();
        const inventoryPaths = this._getEmbeddedInventoryPathSet();

        const plan = resolveFirmwareModulePlan({
            embeddedMode,
            declaredPaths: allLibraries,
            pathToPackageId: libPathToPackageId,
            packageAssetPaths: packageAssetPathsByPackage,
            globalPackageIds,
            inventoryPaths,
            firmwareVersions,
            hostVersions,
            hostHasPath: (path) => this._findLibraryUrl(path, runtime) !== null,
            approvedOverrides: embeddedLibraryOverridePaths,
        });

        // Fail closed: a shadow package may only reach the upload phase when the consent gate
        // approved every one of its files. A missing or partial approval used to be a log line
        // followed by "keep the firmware copy", which is exactly how a stale package looked
        // deployed while the device kept running the frozen code.
        if (plan.shadowPackages.size > 0) {
            const unapprovedPaths: string[] = [];
            const unapprovedPackageIds = new Set<string>();
            for (const [packageId] of plan.shadowPackages) {
                for (const path of packageAssetPathsByPackage.get(packageId) ?? []) {
                    if (embeddedLibraryOverridePaths.has(path)) {
                        continue;
                    }
                    // Kept from the advisory era: the log still records that the plan expanded
                    // beyond the approved list, now followed by the hard failure below.
                    this._log('collection-library-override-package-expanded', {
                        packageId,
                        path,
                    });
                    unapprovedPaths.push(path);
                    unapprovedPackageIds.add(packageId);
                }
            }

            if (unapprovedPaths.length > 0) {
                throw new EmbeddedOverrideApprovalRequiredError(
                    Array.from(unapprovedPackageIds).sort(),
                    unapprovedPaths.sort()
                );
            }

            if (options.embeddedOverrideMode === 'forced') {
                this._log('collection-library-override-forced', {
                    packageIds: Array.from(plan.shadowPackages.keys()).sort(),
                    fileCount: plan.uploadPaths.size,
                });
            }
        }

        if (plan.blockedPaths.length > 0) {
            throw new Error(
                `Deployment blocked: required library files are not deployable:\n${plan.blockedPaths
                    .map((f) => `  - ${f}`)
                    .join('\n')}`
            );
        }

        // Snapshot the complete library set the graph needs. This is the reference used by
        // `_getStaleCollectionPaths` to keep still-needed libraries the firmware cannot replace.
        this._candidateLibraryPaths = new Set(plan.allPlannedPaths);
        this._firmwareProvidedLibraryPaths = new Set(plan.firmwareProvidedPaths);

        // Fetch all library contents
        const preparedLibraries: PreparedLibraryFile[] = [];
        const preparedLibraryPaths = new Set<string>();
        // Library paths as declared by the node package (`.py`), unlike `preparedLibraryPaths`
        // which holds device paths and may name `.mpy` artifacts. The firmware-owned folder
        // decision compares against package asset paths, so it needs this second set.
        const preparedLibraryLibPaths = new Set<string>();
        const mpyProfileHash =
            typeof options.mpyCompileProfile?.hash === 'string'
                ? options.mpyCompileProfile.hash
                : null;
        const runtimeHasMpyProfile = options.mpyAvailability?.runtime?.hasProfile === true;
        const packageMpyAvailability = new Map<string, boolean>();
        const packageEntries = Array.isArray(options.mpyAvailability?.nodePackages)
            ? options.mpyAvailability.nodePackages
            : [];
        for (const entry of packageEntries) {
            const packageId = typeof entry?.packageId === 'string' ? entry.packageId.trim() : '';
            if (!packageId) {
                continue;
            }
            packageMpyAvailability.set(packageId, entry?.hasProfile === true);
        }

        for (const libPath of plan.uploadPaths) {
            if (preparedLibraryPaths.has(libPath)) {
                continue;
            }

            const decision = plan.byPath.get(libPath);
            const fileUrl = this._findLibraryUrl(libPath, runtime);
            if (!fileUrl) {
                this._log('library-not-found', { path: libPath });
                continue;
            }

            const sourceResponse = await fetch(fileUrl);
            if (!sourceResponse.ok) {
                this._log('library-fetch-failed', { url: fileUrl });
                continue;
            }

            const nodePackageId = this._extractNodePackageIdFromAssetUrl(fileUrl);
            const useMpyForPackage = nodePackageId
                ? packageMpyAvailability.get(nodePackageId) === true
                : false;
            const useMpyForRuntime = !nodePackageId && runtimeHasMpyProfile;
            const useMpy =
                !!mpyProfileHash &&
                libPath.endsWith('.py') &&
                (useMpyForPackage || useMpyForRuntime);

            let resolvedUrl = useMpy ? this._buildMpyArtifactUrl(fileUrl, mpyProfileHash) : fileUrl;
            let resolvedResponse = useMpy ? await fetch(resolvedUrl) : sourceResponse;
            let actuallyUseMpy = useMpy;

            if (useMpy && !resolvedResponse.ok) {
                // Individual .mpy artifact is missing; fall back to .py source for this file
                this._log('library-mpy-fallback', { url: resolvedUrl, fallbackUrl: fileUrl });
                resolvedUrl = fileUrl;
                resolvedResponse = sourceResponse;
                actuallyUseMpy = false;
            }

            if (!resolvedResponse.ok) {
                this._log('library-fetch-failed', { url: resolvedUrl });
                continue;
            }

            const content = actuallyUseMpy
                ? new Uint8Array(await resolvedResponse.arrayBuffer())
                : await resolvedResponse.text();
            const devicePath = actuallyUseMpy ? libPath.replace(/\.py$/, '.mpy') : libPath;
            const manifestTag =
                decision && plan.shadowPackages.has(decision.packageId ?? '')
                    ? 'override-embedded'
                    : 'dynamic';

            preparedLibraries.push({
                devicePath,
                url: resolvedUrl,
                content,
                manifestTag,
            });
            preparedLibraryPaths.add(devicePath);
            preparedLibraryLibPaths.add(libPath);

            this._log('collection-library-decision', {
                action: 'upload',
                path: libPath,
                decision: decision?.state ?? 'missing',
                devicePath,
                manifestTag,
            });

            await this._hashManager.prepareFile('collection', devicePath, content);
        }

        this._preparedFiles.libraries = preparedLibraries;

        this._firmwareOwnedPackageFolders = this._collectFirmwareOwnedPackageFolders({
            embeddedMode,
            packageAssetPathsByPackage,
            firmwareOwnedPackageIds: plan.firmwareOwnedPackageIds,
            plannedLibraryPaths: preparedLibraryLibPaths,
        });

        this._stalePackageFolders = new Set(plan.stalePackageFolders);

        this._log('collection-firmware-owned-package-folders', {
            folders: Array.from(this._firmwareOwnedPackageFolders.entries()).map(
                ([path, packageId]) => ({ path, packageId })
            ),
        });

        this._log('collection-libraries-preparation-complete', {
            libraryCount: preparedLibraries.length,
        });

        return preparedLibraries.length;
    }

    _collectImplementationLibraries(
        implementation: DependencyContainerLike | undefined,
        targetSet: Set<string>
    ): void {
        if (!implementation) {
            return;
        }

        const dependencies = implementation.dependencies;
        if (Array.isArray(dependencies)) {
            for (const dep of dependencies) {
                if (typeof dep === 'string' && dep.trim()) {
                    targetSet.add(dep.trim());
                }
            }
        }

        const implementationValue = implementation.value;
        if (typeof implementationValue !== 'string' || !isPackageModuleImport(implementationValue)) {
            return;
        }

        // Convert callable path to module path:
        // otter_stdmo.servo_callable.ServoNodeFn -> otter_stdmo.servo_callable
        const valueParts = implementationValue.split('.');
        if (valueParts.length >= 2) {
            valueParts.pop();
        }

        const modulePath = valueParts.join('.').trim();
        if (isPackageModuleImport(modulePath) && modulePath.includes('.')) {
            targetSet.add(modulePath);
        }
    }

    /**
     * Add transitively required packages to the in-use asset key map.
     *
     * Every package in use pulls its `requiredPackages` in with the wildcard key '*', so a
     * dependency's package-wide `mpAssets` ship even when the collection contains no node from
     * that package.
     * @param {Map<string, Set<string>>} packageAssetKeysInUse - package id -> requested asset keys
     * @param {Array<Object>} nodePackages - runtime package descriptors with `requiredPackages`
     */
    _expandRequiredPackages(
        packageAssetKeysInUse: Map<string, Set<string>>,
        nodePackages: Array<{ id?: string; requiredPackages?: unknown }>
    ): void {
        const requiredById = new Map<string, string[]>();
        for (const nodePackage of nodePackages) {
            const packageId = String(nodePackage?.id || '').trim();
            if (!packageId) {
                continue;
            }
            requiredById.set(
                packageId,
                Array.isArray(nodePackage?.requiredPackages)
                    ? nodePackage.requiredPackages
                          .map((entry) => String(entry || '').trim())
                          .filter(Boolean)
                    : []
            );
        }

        const queue = Array.from(packageAssetKeysInUse.keys());
        while (queue.length > 0) {
            const packageId = queue.shift() as string;
            for (const dependencyId of requiredById.get(packageId) || []) {
                if (packageAssetKeysInUse.has(dependencyId)) {
                    continue;
                }
                packageAssetKeysInUse.set(dependencyId, new Set<string>(['*']));
                queue.push(dependencyId);
            }
        }
    }

    // ====================
    // Deployment Operations
    // ====================

    /**
     * Deploy collection to device.
     * Defaults to sync when hashes are available; set force to upload everything.
     * @param {Collection} collection - Collection to deploy
     * @param {Object} options - Deploy options
     * @param {boolean} options.includeFullDefinition - Include full graph structure in metadata (default: false)
     * @param {boolean} options.force - Force full upload instead of sync (default: false)
     * @returns {Promise<number>} Number of files uploaded
     * @emits collection-deployed - Collection deployment complete
     */
    async deployCollection(
        collection: CollectionLike,
        options: CollectionDeployOptions = {}
    ): Promise<number> {
        const { force = false } = options;

        if (force) {
            return this._deployCollectionFull(collection, options);
        }

        return this.syncCollectionFiles(collection, options);
    }

    /**
     * Sync collection files to device (incremental update).
     * Falls back to full deploy when hashes are missing.
     * @param {Collection} collection - Collection to sync
     * @param {Object} options - Sync options
     * @param {boolean} options.includeFullDefinition - Include full graph structure in metadata (default: false)
     * @param {Object<string, string>} [options.deviceHashes] - Preloaded hash manifest
     * @returns {Promise<number>} Number of files uploaded
     * @emits collection-synced - Collection sync complete with { collection, filesChanged }
     */
    async syncCollectionFiles(
        collection: CollectionLike,
        options: CollectionDeployOptions = {}
    ): Promise<number> {
        const { includeFullDefinition = false } = options;
        const wasRunningBeforeDeploy = this._deviceConnection.isExecutionRunning?.() === true;

        this._assertEmbeddedRuntimeContract();

        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (!this._deviceState.runtimeInstalled) {
            throw new Error('Runtime not installed on device');
        }

        let tracker: ProgressTracker | null = null;

        try {
            const deviceHashes =
                options.deviceHashes ||
                (await this._hashManager.load(), this._hashManager.getFiles('collection'));

            if (!deviceHashes || Object.keys(deviceHashes).length === 0) {
                this._log('collection-sync-hashes-missing');
                return this._deployCollectionFull(collection, { ...options, force: true });
            }

            tracker = new ProgressTracker('collection-sync', 5);
            this._currentOperation = tracker;
            tracker.start(`Syncing collection: ${collection.getTitle()}`);

            // Step 1: Validate collection compatibility
            tracker.update('Validating collection...', 1);
            await this._validateCollectionCompatibility(collection);

            // Step 2: Transpile collection
            tracker.update('Transpiling node graphs...', 2);
            const runtimeId = this._deviceState.runtimeId;
            if (!runtimeId) {
                throw new Error('Device runtime ID not available');
            }

            const deviceRuntime = this._runtimeCollection?.getRuntime(runtimeId);
            if (!deviceRuntime) {
                throw new Error(`Runtime not found: ${runtimeId}`);
            }

            const transpileResult = await this._collectionManager.transpileCollection(collection, {
                deviceRuntime,
            });

            await this._prepareCollectionFilesUpload(
                collection,
                includeFullDefinition,
                transpileResult
            );

            await this._prepareNodeLibrariesUpload(collection, options);

            // Step 3: Get device file hashes
            tracker.update('Checking for changed files...', 3);

            const resolveDeviceHash = async (devicePath: string): Promise<string | null> => {
                const manifestHash = deviceHashes?.[devicePath];
                if (manifestHash) {
                    return manifestHash;
                }

                try {
                    return await this._deviceConnection.calculateHash(devicePath);
                } catch (error) {
                    this._log('device-hash-unavailable', {
                        file: devicePath,
                        error: error.message,
                    });
                    return null;
                }
            };

            void resolveDeviceHash;

            // Step 4: Compare and upload changed files
            tracker.update('Uploading changed files...', 4);
            let filesUploaded = 0;

            const uploadedCollectionFileCount = await this._uploadPreparedCollectionFiles();
            filesUploaded += uploadedCollectionFileCount;

            const uploadedLibraryCount = await this._uploadPreparedLibraries();
            filesUploaded += uploadedLibraryCount;

            const staleCollectionPaths = this._getStaleCollectionPaths(deviceHashes);
            const removedCollectionFileCount =
                await this._removeStaleCollectionFiles(staleCollectionPaths);
            filesUploaded += removedCollectionFileCount;

            // Removes package folders the firmware now owns wholesale — the per-file subtraction
            // cannot see a folder it never recorded, and an empty remnant still shadows the
            // firmware modules. A real removal is a device change and must reach the soft reset.
            const removedLibraryFolderCount = await this._removeStaleLibraryFolders();
            filesUploaded += removedLibraryFolderCount;

            // Commit staged hashes to manifest
            if (filesUploaded > 0) {
                this._hashManager.commitStaging(
                    'collection',
                    this._buildCollectionManifestMetadata(collection)
                );
                await this._hashManager.save();
                this._log('collection-hashes-saved', {
                    count:
                        this._preparedFiles.collection.length +
                        this._preparedFiles.libraries.length,
                    collectionFilesUploaded: uploadedCollectionFileCount,
                    librariesUploaded: uploadedLibraryCount,
                    staleFilesRemoved: removedCollectionFileCount,
                    staleLibraryFoldersRemoved: removedLibraryFolderCount,
                });
            }

            // Step 5: Soft reset device (only if files changed)
            if (filesUploaded > 0) {
                tracker.update('Resetting device...', 5);
                try {
                    await this._deviceConnection.softReset({
                        startRunning: wasRunningBeforeDeploy,
                    });
                    await this._delay(500);
                    this._log('collection-sync-device-reset-mode-restored', {
                        startRunning: wasRunningBeforeDeploy,
                    });
                } catch (error) {
                    this._log('collection-sync-reset-failed', {
                        error: error.message,
                        phase: 'soft-reset',
                    });
                    // Continue - reset is optional
                }
            } else {
                this._log('no-files-changed', { collection: collection.getTitle() });
            }

            // Update device state
            this._updateDeviceState({
                collectionDeployed: true,
                collectionName: collection.getTitle(),
                collectionVersion: collection.getVersionString(),
            });

            tracker.complete(
                `Collection synced: ${collection.getTitle()} (${filesUploaded} file(s) updated)`
            );

            this.dispatchEvent(
                new CustomEvent('collection-synced', {
                    detail: new CollectionDeploymentEventPayload(
                        'CollectionDeployment.CollectionSynced.v1',
                        {
                            collection,
                            filesChanged: filesUploaded,
                        }
                    ),
                })
            );

            return filesUploaded;
        } catch (error) {
            if (tracker) {
                tracker.error('Collection sync failed', error);
                this.dispatchEvent(
                    new CustomEvent('operation-error', {
                        detail: new CollectionDeploymentEventPayload(
                            'CollectionDeployment.OperationError.v1',
                            {
                                operation: 'collection-sync',
                                error: error.message,
                            }
                        ),
                    })
                );
            }

            throw error;
        } finally {
            this._currentOperation = null;
        }
    }

    /**
     * Deploy collection to device (full deploy with validation).
     * @private
     * @param {Collection} collection - Collection to deploy
     * @param {Object} options - Deploy options
     * @param {boolean} options.includeFullDefinition - Include full graph structure in metadata (default: false)
     * @returns {Promise<number>} Number of files uploaded
     */
    async _deployCollectionFull(
        collection: CollectionLike,
        options: CollectionDeployOptions = {}
    ): Promise<number> {
        const wasRunningBeforeDeploy = this._deviceConnection.isExecutionRunning?.() === true;

        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (!this._deviceState.runtimeInstalled) {
            throw new Error('Runtime not installed on device');
        }

        const tracker = new ProgressTracker('collection-deploy', 4);
        this._currentOperation = tracker;

        try {
            tracker.start(`Deploying collection: ${collection.getTitle()}`);

            // Step 1: PREPARATION PHASE
            tracker.update('Preparing files for upload...', 1);
            const preparation = await this.prepareDeployCollection(collection, options);

            // Emit preparation completion with totalFiles in detail
            const transferProgressPayload: TransferProgressPayload = {
                totalFiles: preparation.totalFiles,
                breakdown: {
                    collectionFiles: preparation.collectionFiles,
                    libraries: preparation.libraries,
                },
            };
            tracker.update(
                `Ready to upload ${preparation.totalFiles} files`,
                1,
                transferProgressPayload
            );

            // Step 2: Upload collection files (from prepared list)
            tracker.update('Uploading collection files...', 2);
            await this._uploadPreparedCollectionFiles({ force: true });

            // Step 3: Upload node libraries (from prepared list)
            tracker.update('Uploading node libraries...', 3);
            await this._uploadPreparedLibraries({ force: true });

            const existingCollectionHashes = this._hashManager.getFiles('collection');
            const staleCollectionPaths = this._getStaleCollectionPaths(existingCollectionHashes);
            const removedCollectionFileCount =
                await this._removeStaleCollectionFiles(staleCollectionPaths);
            const removedLibraryFolderCount = await this._removeStaleLibraryFolders();

            // Commit staged hashes to manifest (hashes were staged during preparation)
            if (
                this._preparedFiles.collection.length > 0 ||
                this._preparedFiles.libraries.length > 0
            ) {
                this._hashManager.commitStaging(
                    'collection',
                    this._buildCollectionManifestMetadata(collection)
                );
                await this._hashManager.save();
                this._log('collection-hashes-saved', {
                    count:
                        this._preparedFiles.collection.length +
                        this._preparedFiles.libraries.length,
                    staleFilesRemoved: removedCollectionFileCount,
                    staleLibraryFoldersRemoved: removedLibraryFolderCount,
                });
            }

            // Allow device file system to settle
            this._log('collection-deploy-finalizing');
            await this._delay(500);

            // Step 4: Soft reset device
            tracker.update('Resetting device...', 4);
            try {
                await this._deviceConnection.softReset({
                    startRunning: wasRunningBeforeDeploy,
                });
                await this._delay(500);
                this._log('collection-deploy-device-reset-mode-restored', {
                    startRunning: wasRunningBeforeDeploy,
                });
            } catch (error) {
                this._log('collection-deploy-reset-failed', {
                    error: error.message,
                    phase: 'soft-reset',
                });
                // Continue - reset is optional
            }

            // Update device state
            this._updateDeviceState({
                collectionDeployed: true,
                collectionName: collection.getTitle(),
                collectionVersion: collection.getVersionString(),
            });

            tracker.complete(
                `Collection deployed: ${collection.getTitle()} v${collection.getVersionString()}`
            );

            this.dispatchEvent(
                new CustomEvent('collection-deployed', {
                    detail: new CollectionDeploymentEventPayload(
                        'CollectionDeployment.CollectionDeployed.v1',
                        { collection }
                    ),
                })
            );

            return preparation.totalFiles;
        } catch (error) {
            tracker.error('Collection deployment failed', error);

            this.dispatchEvent(
                new CustomEvent('operation-error', {
                    detail: new CollectionDeploymentEventPayload(
                        'CollectionDeployment.OperationError.v1',
                        {
                            operation: 'collection-deploy',
                            error: error.message,
                        }
                    ),
                })
            );

            throw error;
        } finally {
            this._currentOperation = null;
        }
    }

    /**
     * Remove collection from device.
     * @param {Object} options - Removal options (reserved for future use)
     * @returns {Promise<void>}
     * @emits collection-removed - Collection removal complete
     */
    async removeCollection(_options: Record<string, unknown> = {}): Promise<void> {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        const tracker = new ProgressTracker('collection-remove', 3);
        this._currentOperation = tracker;

        try {
            tracker.start('Removing collection from device...');

            // Step 1: Delete collection files
            tracker.update('Deleting collection files...', 1);
            await this._deleteCollectionFiles();

            // Step 2: Restore default runtime files removed/overwritten by collection deploy
            tracker.update('Restoring default runtime files...', 2);
            await this._restoreDefaultRuntimeCollectionFiles();

            // Update device state
            this._updateDeviceState({
                collectionDeployed: false,
                collectionName: null,
                collectionVersion: null,
            });

            // Step 3: Complete state update
            tracker.update('Finalizing collection removal...', 3);
            tracker.complete('Collection removed from device');

            this.dispatchEvent(
                new CustomEvent('collection-removed', {
                    detail: new CollectionDeploymentEventPayload(
                        'CollectionDeployment.CollectionRemoved.v1'
                    ),
                })
            );
        } catch (error) {
            tracker.error('Collection removal failed', error);

            this.dispatchEvent(
                new CustomEvent('operation-error', {
                    detail: new CollectionDeploymentEventPayload(
                        'CollectionDeployment.OperationError.v1',
                        {
                            operation: 'collection-remove',
                            error: error.message,
                        }
                    ),
                })
            );

            throw error;
        } finally {
            this._currentOperation = null;
        }
    }

    // ========================================================================
    // Private: Validation
    // ========================================================================

    /**
     * Validate collection compatibility with device runtime.
     * Checks target capabilities against node requirements.
     * @private
     * @param {Collection} collection
     */
    async _validateCollectionCompatibility(collection: CollectionLike): Promise<void> {
        // Get device runtime
        const runtimeId = this._deviceState.runtimeId;
        if (!runtimeId) {
            throw new Error('Device runtime ID not available');
        }

        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        // Get target capabilities from device state (populated during runtime installation)
        const deviceTargetInfo = this._deviceState.deviceTargetInfo;
        if (!deviceTargetInfo) {
            this._log('validation-missing-target', {
                runtimeId,
                deviceState: this._deviceState.toJSON?.() || this._deviceState,
            });
            throw new Error(
                'Device target not configured. Please install or reinstall the runtime to set up the target configuration.'
            );
        }

        this._log('validation-target-check', { targetId: deviceTargetInfo.id, runtimeId });

        // Validate all nodes in collection
        const validationErrors = await this._validateNodePackages(
            collection,
            runtime,
            deviceTargetInfo
        );

        if (validationErrors.length > 0) {
            const errorMsg = validationErrors
                .map((e) => {
                    const parts = [];
                    if (e.nodeType) parts.push(`[${e.nodeType}]`);
                    if (e.nodeId) parts.push(`Node ${e.nodeId}`);
                    if (e.capability) parts.push(`Capability: ${e.capability}`);
                    parts.push(e.message);
                    return parts.join(' ');
                })
                .join('\n');
            throw new Error(`Collection validation failed:\n${errorMsg}`);
        }

        this._log('collection-validated', {
            collectionName: collection.getTitle(),
            targetId: deviceTargetInfo.id,
        });
    }

    _assertEmbeddedRuntimeContract(): void {
        const runtimeMode =
            this._deviceState.runtimeDeploymentMode === 'embedded' ? 'embedded' : 'dynamic';
        const runtimeEmbedded = this._deviceState.runtimeEmbedded === true;
        const embeddedMode = runtimeMode === 'embedded' || runtimeEmbedded;

        if (!embeddedMode) {
            return;
        }

        if ((runtimeMode === 'embedded') !== runtimeEmbedded) {
            throw new Error(
                'Embedded runtime metadata is inconsistent. Refresh device info and reinstall the runtime if the issue persists.'
            );
        }

        const runtimeId = this._normalizeRuntimeIdentityField(this._deviceState.runtimeId);
        if (!runtimeId) {
            throw new Error(
                'Embedded runtime metadata is incomplete: runtime ID is missing. Refresh device info and reinstall the runtime if needed.'
            );
        }

        const runtimeVersion = this._normalizeRuntimeIdentityField(
            this._deviceState.runtimeVersion
        );
        if (!runtimeVersion) {
            throw new Error(
                'Embedded runtime metadata is incomplete: runtime version is missing. Refresh device info and reinstall the runtime if needed.'
            );
        }

        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(
                `Embedded runtime metadata mismatch: runtime '${runtimeId}' is not available in this workspace. Refresh device info and reinstall the runtime metadata if needed.`
            );
        }

        const catalogVersion = this._normalizeRuntimeIdentityField(runtime.version);
        if (catalogVersion && catalogVersion !== runtimeVersion) {
            throw new Error(
                `Embedded runtime metadata mismatch: device runtime version '${runtimeVersion}' does not match workspace runtime '${catalogVersion}' for '${runtimeId}'. Refresh device info and reinstall the runtime if needed.`
            );
        }
    }

    _normalizeRuntimeIdentityField(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    _isEmbeddedRuntimeMode(): boolean {
        return (
            this._deviceState.runtimeDeploymentMode === 'embedded' ||
            this._deviceState.runtimeEmbedded === true
        );
    }

    async _loadDynamicLibraryPathSet(): Promise<Set<string>> {
        try {
            await this._hashManager.load();
        } catch (error) {
            this._log('collection-dynamic-inventory-load-failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new Set<string>();
        }

        const dynamicFiles = this._hashManager.getFiles('collection') || {};
        return new Set(
            Object.keys(dynamicFiles).filter(
                (path) =>
                    typeof path === 'string' &&
                    isPackageModulePath(path)
            )
        );
    }

    /**
     * Return the `libs/` / `otter_*` paths the device user space holds according to the hash
     * manifest. Display-only: the deployment plan never reads this set.
     *
     * Re-loads the manifest so it also works before the first deploy of the session. Failures are
     * swallowed by {@link _loadDynamicLibraryPathSet} (empty set plus a
     * `collection-dynamic-inventory-load-failed` log), so this never throws.
     * @returns {Promise<string[]>} Sorted device paths, `[]` when the manifest is unreadable
     */
    async getDynamicLibraryPathsOnDevice(): Promise<string[]> {
        const paths = await this._loadDynamicLibraryPathSet();
        this._dynamicLibraryPathsOnDevice = paths;
        return Array.from(paths).sort();
    }

    _normalizeEmbeddedOverridePaths(paths: unknown): Set<string> {
        if (!Array.isArray(paths)) {
            return new Set<string>();
        }

        const normalized = new Set<string>();
        for (const path of paths) {
            if (typeof path !== 'string') {
                continue;
            }
            const cleanPath = this._normalizeGeneratedArtifactPath(path);
            if (cleanPath && isPackageModulePath(cleanPath)) {
                normalized.add(cleanPath);
            }
        }

        return normalized;
    }

    _collectLibraryPathTags(): Record<string, 'dynamic' | 'override-embedded'> {
        const tags: Record<string, 'dynamic' | 'override-embedded'> = {};
        for (const file of this._preparedFiles.libraries) {
            if (
                !file?.devicePath ||
                !isPackageModulePath(file.devicePath) ||
                !file?.manifestTag
            ) {
                continue;
            }
            tags[file.devicePath] = file.manifestTag;
        }
        return tags;
    }

    _buildCollectionManifestMetadata(collection: CollectionLike): Record<string, unknown> {
        const metadata: Record<string, unknown> = {
            collectionId: collection.id,
            collectionName: collection.getTitle(),
        };

        const libraryPathTags = this._collectLibraryPathTags();
        if (Object.keys(libraryPathTags).length > 0) {
            metadata.libraryPathTags = libraryPathTags;
        }

        return metadata;
    }

    /**
     * Validate node packages against runtime and device capabilities.
     * @private
     * @param {Collection} collection
     * @param {DeviceRuntime} runtime
     * @param {DeviceTargetInfo} deviceTargetInfo - Target device with full capabilities
     * @returns {Promise<Array>} - Array of validation errors
     */
    async _validateNodePackages(
        collection: CollectionLike,
        runtime: DeviceRuntimeLike,
        deviceTargetInfo: DeviceTargetInfoLike
    ): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];

        // Build capabilities object for capability check functions
        const capabilities = {
            capabilityToPins: deviceTargetInfo.capabilityToPins || {},
            generalCapabilities: deviceTargetInfo.generalCapabilities || {},
            metadata: deviceTargetInfo.metadata || {},
        };

        // Package-level capability gating: a node package may declare
        // `requiredCapabilities` that must be satisfied by the connected target.
        const deviceTarget =
            deviceTargetInfo instanceof DeviceTargetInfo
                ? deviceTargetInfo
                : new DeviceTargetInfo({
                      id: deviceTargetInfo.id,
                      capabilityToPins: deviceTargetInfo.capabilityToPins || {},
                      generalCapabilities: deviceTargetInfo.generalCapabilities || {},
                      metadata: deviceTargetInfo.metadata || {},
                      resources: deviceTargetInfo.resources,
                  });
        const packageCapabilityContext = createPackageCapabilityContext(deviceTarget);
        const nodePackages = Array.isArray(runtime.nodePackages) ? runtime.nodePackages : [];
        for (const nodePackage of nodePackages) {
            const result = evaluateRequiredCapabilities(
                nodePackage?.requiredCapabilities,
                packageCapabilityContext
            );
            for (const group of result.missing) {
                const capability = group.join(' or ');
                errors.push({
                    nodeId: undefined,
                    nodeType: undefined,
                    capability,
                    message: `Node package '${nodePackage?.id || 'unknown'}' requires unsupported capability: ${capability}`,
                });
            }
        }

        interface CapabilityValidationContextLike {
            graphId?: string | null;
            graphNodes?: Record<string, unknown>[];
            graphConnections?: Record<string, unknown>[];
            nodeTypesByNodeId?: Record<string, Record<string, unknown> | null>;
            collectionNodes?: Record<string, unknown>[];
        }
        // Get all graphs and their nodes
        const graphs = collection.getGraphArray?.() || [];

        const collectionNodes: Record<string, unknown>[] = [];
        for (const graph of graphs) {
            const rawNodes = graph.getNodes?.() || [];
            const nodes = Array.isArray(rawNodes) ? rawNodes : Object.values(rawNodes);
            nodes.forEach((entry) => {
                if (entry && typeof entry === 'object') {
                    collectionNodes.push(entry as Record<string, unknown>);
                }
            });
        }

        for (const graph of graphs) {
            const rawNodes = graph.getNodes?.() || [];
            const nodes = Array.isArray(rawNodes) ? rawNodes : Object.values(rawNodes);
            const rawConnections = graph.getConnections?.() || [];
            const graphConnections = Array.isArray(rawConnections)
                ? rawConnections
                : Object.values(rawConnections);

            if (typeof graph?.canConnect === 'function') {
                for (const rawConnection of graphConnections) {
                    const connection = rawConnection as GraphConnectionLike;
                    const fromNode =
                        typeof connection.fromNode === 'string' ? connection.fromNode : null;
                    const fromIndex =
                        typeof connection.fromIndex === 'number' ? connection.fromIndex : null;
                    const toNode = typeof connection.toNode === 'string' ? connection.toNode : null;
                    const toIndex =
                        typeof connection.toIndex === 'number' ? connection.toIndex : null;

                    if (!fromNode || fromIndex === null || !toNode || toIndex === null) {
                        continue;
                    }

                    const validation = graph.canConnect(fromNode, fromIndex, toNode, toIndex, {
                        allowExistingConnectionMatch: true,
                    });

                    if (!validation?.valid) {
                        errors.push({
                            nodeId: toNode,
                            nodeType: undefined,
                            message: validation?.message || 'Graph connection validation failed',
                        });
                    }
                }
            }

            const nodeTypesByNodeId: Record<string, Record<string, unknown> | null> = {};
            for (const node of nodes) {
                if (!node || typeof node !== 'object') {
                    continue;
                }
                const nodeId = typeof node.id === 'string' ? node.id : null;
                const nodeTypeId = typeof node.type === 'string' ? node.type : null;
                if (!nodeId || !nodeTypeId) {
                    continue;
                }
                // Function-graph-managed ids have no runtime definition, so they contribute no
                // resource metadata; leaving them out keeps the graph resource validator on its
                // "unknown type" path instead of inventing an entry.
                if (isFunctionGraphManagedNodeType(nodeTypeId)) {
                    continue;
                }
                const resolvedType = this._collectionManager?.getNodeType(nodeTypeId);
                nodeTypesByNodeId[nodeId] =
                    resolvedType && typeof resolvedType === 'object'
                        ? (resolvedType as Record<string, unknown>)
                        : null;
            }

            const validationContext: CapabilityValidationContextLike = {
                graphId: (typeof graph.getId === 'function' ? graph.getId() : null) || null,
                graphNodes: nodes.filter((entry) => entry && typeof entry === 'object'),
                graphConnections: graphConnections.filter(
                    (entry) => entry && typeof entry === 'object'
                ) as Record<string, unknown>[],
                nodeTypesByNodeId,
                collectionNodes,
            };

            // Validate each node instance
            for (const node of nodes) {
                if (!node || typeof node !== 'object') {
                    continue;
                }
                const nodeTypeId = node.type;

                // Function-graph-managed ids are generated by the transpiler from the owning
                // collection, so a missing runtime definition is expected instead of an error; the
                // callee graph is validated on its own.
                if (isFunctionGraphManagedNodeType(nodeTypeId)) {
                    continue;
                }

                // Get node type definition via CollectionManager (handles runtime priority)
                const nodeType = this._collectionManager?.getNodeType(nodeTypeId);
                if (!nodeType) {
                    errors.push({
                        nodeId: node.id,
                        nodeType: nodeTypeId,
                        message: `Node type not found: ${nodeTypeId}`,
                    });
                    continue;
                }

                const validation = validateNodeCapabilities({
                    node,
                    nodeType,
                    capabilities,
                    targetId: typeof deviceTargetInfo.id === 'string' ? deviceTargetInfo.id : null,
                    validationContext,
                });

                if (validation.issues.length > 0) {
                    this._log('capability-check-issues', {
                        nodeId: node.id,
                        nodeType: nodeTypeId,
                        issueCount: validation.issues.length,
                        issues: validation.issues,
                    });

                    for (const issue of validation.issues) {
                        errors.push({
                            nodeId: issue.nodeId || node.id,
                            nodeType: nodeTypeId,
                            capability: issue.capability || undefined,
                            message: issue.message || 'Capability check failed',
                        });
                    }
                }
            }

            // Graph-level resource/conflict validation.
            const graphTarget =
                deviceTargetInfo instanceof DeviceTargetInfo
                    ? deviceTargetInfo
                    : new DeviceTargetInfo({
                          id: deviceTargetInfo.id,
                          capabilityToPins: deviceTargetInfo.capabilityToPins || {},
                          generalCapabilities: deviceTargetInfo.generalCapabilities || {},
                          metadata: deviceTargetInfo.metadata || {},
                          resources: deviceTargetInfo.resources,
                          pinCapabilities: deviceTargetInfo.pinCapabilities,
                      });
            const graphIssues = validateGraphResources({
                target: graphTarget,
                graphNodes: nodes.filter((entry) => entry && typeof entry === 'object'),
                nodeTypesByNodeId,
            });
            for (const issue of graphIssues) {
                errors.push({
                    nodeId: issue.nodeId || undefined,
                    nodeType: undefined,
                    capability: issue.capability || undefined,
                    message: issue.message,
                });
            }
        }

        return errors;
    }

    // ========================================================================
    // Private: File Upload
    // ========================================================================

    /**     * Generate collection metadata for device storage.
     * @private
     * @param {Collection} collection - Collection to serialize
     * @param {boolean} includeFullDefinition - Include full graph structure
     * @returns {Object} Metadata object
     */
    _generateCollectionMetadata(
        collection: CollectionLike,
        includeFullDefinition = false
    ): CollectionMetadata {
        // Base metadata (always included)
        const metadata: CollectionMetadata = {
            name: collection.getTitle(),
            uuid: collection.getId(), // Collection.getId() returns the UUID
            version: collection.getVersionString(),
            hasFullDefinition: includeFullDefinition,
        };

        // Full definition (optional)
        if (includeFullDefinition) {
            // Use Collection's built-in serialization (follows Data Backbone Architecture)
            const collectionData = collection.toData();

            // Include serialized graphs structure
            metadata.graphs = collectionData.graphs;
            metadata.targetId = collectionData.targetId;
            metadata.deviceRuntimeId = collectionData.deviceRuntimeId;
            metadata.activeGraphIdx = collectionData.activeGraphIdx;
        }

        return metadata;
    }

    /**     * Upload generated Python code to device.
     * @private
     * @param {string} code - Python code
     */
    async _uploadGeneratedCode(code: string): Promise<void> {
        await this._deviceConnection.writeTextFile('app/main_loop.py', code);
        this._log('generated-code-uploaded', { size: code.length });
    }

    /**
     * Upload collection metadata to device.
     * @private
     * @param {Collection} collection - Collection to upload
     * @param {boolean} includeFullDefinition - Include full graph structure (default: false)
     */
    async _uploadCollectionMetadata(
        collection: CollectionLike,
        includeFullDefinition = false
    ): Promise<void> {
        const metadata = this._generateCollectionMetadata(collection, includeFullDefinition);
        const metadataJson = JSON.stringify(metadata, null, 2);

        await this._deviceConnection.writeTextFile('collection/node_graph_cln.json', metadataJson);

        this._log('collection-metadata-uploaded', {
            name: collection.getTitle(),
            version: collection.getVersionString(),
            hasFullDefinition: includeFullDefinition,
            size: metadataJson.length,
        });
    }

    /**
     * Upload prepared collection files (main loop, metadata, generated artifacts).
     * Must call _prepareCollectionFilesUpload() first.
     * @private
     * @returns {Promise<number>} Number of collection files uploaded
     */
    async _uploadPreparedCollectionFiles(options: { force?: boolean } = {}): Promise<number> {
        const { force = false } = options;
        const preparedCollectionFiles = this._preparedFiles.collection;
        const changedPaths = force
            ? null
            : new Set(this._hashManager.getFilesToUpload('collection'));

        const filesToUpload = force
            ? preparedCollectionFiles
            : preparedCollectionFiles.filter((file) => changedPaths?.has(file.devicePath));

        if (filesToUpload.length === 0) {
            this._log('collection-no-files-needed');
            return 0;
        }

        if (!force && preparedCollectionFiles.length > filesToUpload.length) {
            this._log('collection-files-skipped-unchanged', {
                skipped: preparedCollectionFiles.length - filesToUpload.length,
                totalPrepared: preparedCollectionFiles.length,
            });
        }

        const batchTracker = new ProgressTracker('collection-files-upload', filesToUpload.length);
        batchTracker.start(`Uploading ${filesToUpload.length} collection files...`);

        try {
            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                const fileIndex = i + 1;

                batchTracker.update(
                    `Uploading ${file.devicePath} (${fileIndex}/${filesToUpload.length})`,
                    fileIndex
                );

                await this._uploadAndVerify(file.devicePath, file.content, file.hash);
            }

            batchTracker.complete(`Successfully uploaded ${filesToUpload.length} collection files`);
            this._log('collection-files-uploaded', { count: filesToUpload.length });
            return filesToUpload.length;
        } catch (error) {
            batchTracker.error('Failed to upload collection files', error);
            throw error;
        }
    }

    /**
     * Upload filtered node libraries to device.
     * Resolves library dependencies and only uploads required files.
     * @private
     * @param {Collection} collection
     */
    async _uploadFilteredNodeLibraries(collection: CollectionLike): Promise<void> {
        // Legacy method - delegates to preparation and upload
        await this._prepareNodeLibrariesUpload(collection);
        await this._uploadPreparedLibraries({ force: true });
    }

    /**
     * Upload node libraries from prepared list.
     * Must call _prepareNodeLibrariesUpload() first.
     * @private
     * @returns {Promise<number>} Number of library files uploaded
     */
    async _uploadPreparedLibraries(options: { force?: boolean } = {}): Promise<number> {
        const { force = false } = options;
        const preparedLibraries = this._preparedFiles.libraries;
        const changedPaths = force
            ? null
            : new Set(this._hashManager.getFilesToUpload('collection'));

        const filesToUpload = force
            ? preparedLibraries
            : preparedLibraries.filter((file) => changedPaths?.has(file.devicePath));

        if (filesToUpload.length === 0) {
            this._log('collection-no-libraries-needed');
            return 0;
        }

        if (!force && preparedLibraries.length > filesToUpload.length) {
            this._log('collection-libraries-skipped-unchanged', {
                skipped: preparedLibraries.length - filesToUpload.length,
                totalPrepared: preparedLibraries.length,
            });
        }

        const batchTracker = new ProgressTracker(
            'collection-libraries-upload',
            filesToUpload.length
        );
        batchTracker.start(`Uploading ${filesToUpload.length} node libraries...`);

        try {
            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                const fileIndex = i + 1;

                batchTracker.update(
                    `Uploading ${file.devicePath} (${fileIndex}/${filesToUpload.length})`,
                    fileIndex
                );

                await this._uploadAndVerify(file.devicePath, file.content);
            }

            batchTracker.complete(`Successfully uploaded ${filesToUpload.length} node libraries`);
            this._log('filtered-libraries-uploaded', { count: filesToUpload.length });

            return filesToUpload.length;
        } catch (error) {
            batchTracker.error('Failed to upload node libraries', error);
            throw error;
        }
    }

    /**
     * Resolve transitive library dependencies by scanning imports.
     * @private
     * @param {Array<string>} initialLibraries - Initial library file paths
     * @param {DeviceRuntime} runtime
     * @returns {Promise<Array<string>>} - All required library file paths
     */
    async _resolveTransitiveDependencies(
        initialLibraries: string[],
        runtime: DeviceRuntimeLike
    ): Promise<string[]> {
        const resolved = new Set(initialLibraries);
        const toProcess = [...initialLibraries];

        while (toProcess.length > 0) {
            const libPath = toProcess.shift();
            if (!libPath) {
                continue;
            }

            // Find library URL in runtime filesystem
            const libUrl = this._findLibraryUrl(libPath, runtime);
            if (!libUrl) {
                this._log('library-not-found', { path: libPath });
                continue;
            }

            // Fetch and scan for imports
            try {
                const response = await fetch(libUrl);
                if (!response.ok) continue;

                const content = await response.text();
                const imports = this._extractPythonImports(content);

                // Add new imports to queue
                for (const imp of imports) {
                    // Convert import to file path (e.g., "otter_stdmo.base" → "otter_stdmo/base.py")
                    const impPath = imp.replace(/\./g, '/') + '.py';

                    if (!resolved.has(impPath)) {
                        resolved.add(impPath);
                        toProcess.push(impPath);
                    }
                }
            } catch (error) {
                this._log('library-scan-failed', {
                    path: libPath,
                    error: error.message,
                });
            }
        }

        return Array.from(resolved);
    }

    /**
     * Check if a library file path is resolvable on the host (in runtime filesystem or any
     * node package mpAssets). Public interface for sibling classes.
     * @param libPath - Device-relative path (e.g., 'libs/otter/nodes/tile.py')
     * @param runtime - Runtime to search
     */
    isLibraryAvailableOnHost(libPath: string, runtime: unknown): boolean {
        return this.resolveLibraryUrl(libPath, runtime) !== null;
    }

    /**
     * Resolve the host URL of a library file path.
     *
     * The URL is the one the deploy itself would fetch, so a sibling class can read the same
     * source without duplicating the runtime-filesystem / `mpAssets` lookup.
     * @param libPath - Device-relative path (e.g., 'otter_vars/store.py')
     * @param runtime - Runtime to search
     * @returns {string|null} Host URL of the file, or null when the host cannot provide it
     */
    resolveLibraryUrl(libPath: string, runtime: unknown): string | null {
        return this._findLibraryUrl(libPath, runtime as DeviceRuntimeLike);
    }

    /**
     * Extract the device-relative library path from an asset URL.
     * Public interface for sibling classes.
     */
    extractLibraryPathFromUrl(assetUrl: string): string | null {
        return this._extractLibraryPathFromUrl(assetUrl);
    }

    /**
     * Find library URL in runtime filesystem.
     * @private
     * @param {string} libPath - Library file path (e.g., "libs/stdmo/servo.py")
     * @param {DeviceRuntime} runtime
     * @returns {string|null}
     */
    _findLibraryUrl(libPath: string, runtime: DeviceRuntimeLike): string | null {
        const filesystem = runtime.resolvedFilesystem || [];

        const match = filesystem.find((url) => {
            const urlObj = new URL(url, window.location.origin);
            const pathParts = urlObj.pathname.split('/');
            const runtimeIndex = pathParts.indexOf('runtime');
            if (runtimeIndex === -1) return false;

            const devicePath = pathParts.slice(runtimeIndex + 2).join('/');
            return devicePath === libPath;
        });

        if (match) {
            return match;
        }

        const nodePackages = runtime.nodePackages || [];
        for (const nodePackage of nodePackages) {
            const mpAssets = nodePackage?.mpAssets || {};
            for (const assetList of Object.values(mpAssets)) {
                if (!Array.isArray(assetList)) {
                    continue;
                }
                for (const assetUrl of assetList) {
                    if (typeof assetUrl !== 'string') {
                        continue;
                    }
                    const assetPath = this._extractLibraryPathFromUrl(assetUrl);
                    if (assetPath === libPath) {
                        return assetUrl;
                    }
                }
            }
        }

        return null;
    }

    _extractLibraryPathFromUrl(fileUrl: string): string | null {
        try {
            const urlObj = new URL(fileUrl, window.location.origin);
            const normalizedPath = urlObj.pathname.replace(/\\/g, '/');

            // Extract device path from node_pkgs URL: /device/node_pkgs/<id>/...
            const pkgsMarker = '/node_pkgs/';
            const pkgsIndex = normalizedPath.indexOf(pkgsMarker);
            if (pkgsIndex !== -1) {
                const afterPkgs = normalizedPath.slice(pkgsIndex + pkgsMarker.length);
                const slashIndex = afterPkgs.indexOf('/');
                if (slashIndex !== -1) {
                    return afterPkgs.slice(slashIndex + 1);
                }
            }

            // Legacy fallback for /libs/ style paths not under node_pkgs
            const libsIndex = normalizedPath.indexOf('/libs/');
            if (libsIndex !== -1) {
                return normalizedPath.slice(libsIndex + 1);
            }

            return null;
        } catch (error) {
            this._log('library-path-parse-failed', { fileUrl, error: error.message });
            return null;
        }
    }

    _extractNodePackageIdFromAssetUrl(fileUrl: string): string | null {
        const normalized = String(fileUrl || '').replace(/\\/g, '/');
        const marker = '/node_pkgs/';
        const markerIndex = normalized.indexOf(marker);
        if (markerIndex === -1) {
            return null;
        }

        const rest = normalized.slice(markerIndex + marker.length);
        const slashIndex = rest.indexOf('/');
        if (slashIndex === -1) {
            return null;
        }

        const packageId = rest.slice(0, slashIndex).trim();
        return packageId || null;
    }

    _buildMpyArtifactUrl(sourceUrl: string, profileHash: string): string {
        const urlObj = new URL(sourceUrl, window.location.origin);
        const normalizedPath = urlObj.pathname.replace(/\\/g, '/');
        const match = normalizedPath.match(/^(.*\/)([^/]+)\.py$/);
        if (!match) {
            return sourceUrl;
        }

        const [, prefix, stem] = match;
        urlObj.pathname = `${prefix}__mpycache__/${profileHash}/${stem}.mpy`;
        return urlObj.toString();
    }

    _getDesiredCollectionPaths(): Set<string> {
        const desired = new Set<string>();
        for (const file of this._preparedFiles.collection) {
            if (file?.devicePath) {
                desired.add(file.devicePath);
            }
        }
        for (const file of this._preparedFiles.libraries) {
            if (
                file?.devicePath &&
                isPackageModulePath(file.devicePath)
            ) {
                desired.add(file.devicePath);
            }
        }
        return desired;
    }

    /**
     * Device folders that belong exclusively to a node package.
     *
     * `otter_x/a/b.py` → `otter_x`, `libs/x/a.py` → `libs/x`. A path that is not inside such a
     * folder (a bare `libs/foo.py`) yields nothing: there is no folder to own.
     * @private
     * @param {string[]} paths - Library paths of one package
     * @returns {string[]} Deduplicated package folders
     */
    _getPackageFolders(paths: string[]): string[] {
        const folders = new Set<string>();
        for (const path of paths) {
            const segments = String(path).split('/');
            if (segments.length < 2 || !segments[1]) {
                continue;
            }
            if (segments[0] === 'libs') {
                if (segments.length < 3 || !segments[1]) {
                    continue;
                }
                folders.add(`libs/${segments[1]}`);
            } else if (isPackageModuleImport(segments[0])) {
                folders.add(segments[0]);
            }
        }
        return Array.from(folders).sort();
    }

    /**
     * Library folders that become removable once the given files are gone, deepest first.
     *
     * Every ancestor of an `otter_<pkg>/…` or `libs/<pkg>/…` path. `libs` itself is excluded: it is
     * a shared root, not a package folder, and `app/` / `collection/` are never library paths.
     * @private
     * @param {string[]} paths - Paths that were just removed (relative, as stored in the manifest)
     * @returns {string[]} Folders, deepest first
     */
    _collectPrunableFolders(paths: string[]): string[] {
        const folders = new Set<string>();

        for (const path of paths) {
            const segments = String(path).split('/');
            if (segments.length < 2) {
                continue;
            }

            const isLibraryPath = segments[0] === 'libs' || isPackageModuleImport(segments[0]);
            if (!isLibraryPath) {
                continue;
            }

            // Ancestors of a file path: every prefix shorter than the full path, top level included.
            for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
                const folder = segments.slice(0, depth).join('/');
                if (!folder || folder === 'libs') {
                    continue;
                }
                folders.add(folder);
            }
        }

        return Array.from(folders).sort((a, b) => {
            const depthDelta = b.split('/').length - a.split('/').length;
            return depthDelta !== 0 ? depthDelta : a.localeCompare(b);
        });
    }

    /**
     * Remove folders one by one, but only when they are empty.
     *
     * `{ recursive: false }` maps to `os.rmdir`, so a folder that still holds a file the firmware
     * provides (or one this deploy left alone) is untouched. A failure is tolerated: pruning is an
     * optimisation of the folder layout, never a deployment requirement.
     * @private
     * @param {string[]} folders - Folders to prune, deepest first
     * @returns {Promise<number>} Number of folders actually removed
     */
    async _pruneEmptyFolders(folders: string[]): Promise<number> {
        let removedFolderCount = 0;

        for (const folderPath of folders) {
            try {
                const removedEntries = await this._removeFolder(folderPath, { recursive: false });
                if (removedEntries === 0) {
                    continue; // Still populated, or already gone.
                }

                removedFolderCount += 1;
                this._log('collection-folder-removed', {
                    path: folderPath,
                    removalReported: removedEntries !== null,
                });
            } catch (error) {
                this._log('collection-folder-keep-non-empty', {
                    path: folderPath,
                    error: error.message,
                });
            }
        }

        return removedFolderCount;
    }

    /**
     * Decide which package folders this deploy leaves entirely to the firmware.
     *
     * A folder is only collected for packages the module plan marked fully firmware-provided
     * (`firmwareOwnedPackageIds`); otherwise the folder stays. Two packages may share a root
     * (`libs/<name>`), so the prepared plan always wins over the cleanup.
     * @private
     * @param {Object} input - Preparation state of this deploy
     * @param {boolean} input.embeddedMode - Whether the runtime is embedded
     * @param {Map<string, string[]>} input.packageAssetPathsByPackage - Complete asset paths per package in use
     * @param {ReadonlySet<string>} input.firmwareOwnedPackageIds - Packages the firmware fully provides
     * @param {Set<string>} input.plannedLibraryPaths - Library paths this deploy uploads
     * @returns {Map<string, string>} Package folder → package id
     */
    _collectFirmwareOwnedPackageFolders({
        embeddedMode,
        packageAssetPathsByPackage,
        firmwareOwnedPackageIds,
        plannedLibraryPaths,
    }: {
        embeddedMode: boolean;
        packageAssetPathsByPackage: Map<string, string[]>;
        firmwareOwnedPackageIds: ReadonlySet<string>;
        plannedLibraryPaths: Set<string>;
    }): Map<string, string> {
        const folders = new Map<string, string>();
        if (!embeddedMode) {
            return folders;
        }

        const plannedPaths = Array.from(plannedLibraryPaths);

        for (const [packageId, packagePaths] of packageAssetPathsByPackage) {
            if (!firmwareOwnedPackageIds.has(packageId)) {
                continue; // Not fully firmware-provided: user space stays.
            }

            const neededPaths = packagePaths.filter((path) =>
                this._candidateLibraryPaths.has(path)
            );
            if (neededPaths.length === 0) {
                continue; // Nothing of it is imported: file-level cleanup handles the rest.
            }

            for (const folder of this._getPackageFolders(neededPaths)) {
                if (plannedPaths.some((path) => path.startsWith(`${folder}/`))) {
                    this._log('collection-library-folder-keep-planned', {
                        path: folder,
                        packageId,
                    });
                    continue;
                }
                folders.set(folder, packageId);
            }
        }

        return folders;
    }

    /**
     * Firmware package versions keyed by package id, or `null` when no version source is known.
     *
     * Mirrors `DeviceDeployment._resolveFirmwarePackageVersions` so the collection-side plan
     * reads the same device truth as the validation / consent path.
     * @private
     * @returns {Map<string, string | null> | null}
     */
    _resolveFirmwareVersions(): Map<string, string | null> | null {
        const summary = this._deviceState.embeddedPackagesSummary;
        if (summary != null) {
            const versions = new Map<string, string | null>();
            for (const p of summary.packages ?? []) {
                if (p.name && typeof p.version === 'string') {
                    versions.set(p.name, p.version);
                }
            }
            return versions;
        }
        const cv = this._deviceState.firmwareConstituentVersions;
        const nodePackages = cv?.nodePackages;
        if (nodePackages && typeof nodePackages === 'object') {
            return new Map(
                Object.entries({
                    ...nodePackages,
                    ...resolveFrozenAddonVersions(cv),
                }).map(([id, v]) => [id, String(v)])
            );
        }
        return null;
    }

    /**
     * Paths of the files the firmware itself provides (``source === 'embedded'``), or `null` when
     * the inventory is unreadable. Files previously uploaded to user space (`source === 'dynamic'`)
     * are deliberately excluded: they do not prove the firmware provides a module.
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
                .filter((file: { source?: string }) => file?.source === 'embedded')
                .map((file: { path: string }) => file.path)
        );
    }

    _getStaleCollectionPaths(deviceHashes: Record<string, string>): string[] {
        const desiredFiles = this._getDesiredCollectionPaths();
        const embeddedMode = this._isEmbeddedRuntimeMode();

        return Object.keys(deviceHashes || {}).filter((path) => {
            if (!this._isManagedCollectionPath(path)) {
                return false;
            }
            if (desiredFiles.has(path)) {
                return false;
            }

            const isLibraryPath = isPackageModulePath(path);
            if (embeddedMode && isLibraryPath && this._candidateLibraryPaths.has(path)) {
                // The graph still needs this library but this deploy does not upload it, i.e. it is
                // firmware-provided. Only remove the user-space copy when the firmware can replace
                // it; the device must never be left with neither copy.
                if (!this._firmwareProvidedLibraryPaths.has(path)) {
                    this._log('collection-library-stale-keep-firmware-missing', 'warn', {
                        path,
                        reason: 'inventory-unavailable',
                    });
                    return false;
                }
            }

            return true;
        });
    }

    async _removeStaleCollectionFiles(paths: string[]): Promise<number> {
        if (!Array.isArray(paths) || paths.length === 0) {
            return 0;
        }

        let removedCount = 0;
        const removedPaths: string[] = [];
        for (const path of paths) {
            try {
                await this._deleteFile(path);
                this._hashManager.removeFile('collection', path);
                removedCount += 1;
                removedPaths.push(path);
                this._log('collection-file-removed', { path });
            } catch (error) {
                this._log('collection-file-remove-failed', {
                    path,
                    error: error.message,
                });
            }
        }

        // Removed files can leave empty package directories behind, which still shadow the
        // firmware: MicroPython resolves a package's submodules only inside the directory that
        // won the import. Prune them now that their files are gone.
        await this._pruneEmptyFolders(this._collectPrunableFolders(removedPaths));

        return removedCount;
    }

    /**
     * Remove package folders whose whole content the firmware provides at the current version.
     *
     * The per-file subtraction can only remove paths the hash manifest enumerates, so a folder
     * left over from an older deploy keeps shadowing the firmware: MicroPython searches the VFS
     * before the frozen modules and resolves a package's submodules only inside the directory
     * that won the import, so the remnant turns into
     * `ImportError: no module named '<package>.<submodule>'`.
     * @private
     * @returns {Promise<number>} Number of package folders actually removed
     */
    async _removeStaleLibraryFolders(): Promise<number> {
        if (
            this._firmwareOwnedPackageFolders.size === 0 &&
            this._stalePackageFolders.size === 0
        ) {
            return 0;
        }

        const plannedPaths = Array.from(this._getDesiredCollectionPaths());
        let removedFolderCount = 0;

        for (const [folderPath, packageId] of this._firmwareOwnedPackageFolders) {
            if (plannedPaths.some((path) => path.startsWith(`${folderPath}/`))) {
                // The plan wins: a later step of this deploy writes into this folder.
                this._log('collection-library-folder-keep-planned', {
                    path: folderPath,
                    packageId,
                });
                continue;
            }

            try {
                const removedEntries = await this._removeFolder(folderPath);
                if (removedEntries === 0) {
                    // Nothing existed any more: the folder is gone, the device did not change.
                    continue;
                }

                removedFolderCount += 1;
                this._log('collection-library-folder-removed', {
                    path: folderPath,
                    packageId,
                    removalReported: removedEntries !== null,
                    removedEntries: removedEntries ?? 0,
                });
            } catch (error) {
                this._log('collection-library-folder-remove-failed', 'warn', {
                    path: folderPath,
                    packageId,
                    error: error.message,
                });
            }
        }

        // A frozen add-on's other-variant module folder is stale; remove it so the frozen
        // variant's guarded import wins.
        for (const folderPath of this._stalePackageFolders) {
            if (plannedPaths.some((path) => path.startsWith(`${folderPath}/`))) {
                continue;
            }
            try {
                const removedEntries = await this._removeFolder(folderPath);
                if (removedEntries === 0) {
                    continue;
                }
                removedFolderCount += 1;
                this._log('collection-library-folder-removed', {
                    path: folderPath,
                    packageId: '',
                    removalReported: removedEntries !== null,
                    removedEntries: removedEntries ?? 0,
                });
            } catch (error) {
                this._log('collection-library-folder-remove-failed', 'warn', {
                    path: folderPath,
                    packageId: '',
                    error: error.message,
                });
            }
        }

        // Release the snapshot: a later step of the same deploy must not act on it again.
        this._firmwareOwnedPackageFolders = new Map<string, string>();
        this._stalePackageFolders = new Set<string>();

        return removedFolderCount;
    }

    _collectGeneratedCollectionArtifacts(
        transpileResult: TranspileResultLike
    ): GeneratedCollectionArtifactLike[] {
        const directArtifacts = Array.isArray(transpileResult?.generatedArtifacts)
            ? transpileResult.generatedArtifacts
            : [];
        const rootArtifacts = Array.isArray(transpileResult?.artifacts)
            ? (transpileResult.artifacts as GeneratedCollectionArtifactLike[])
            : [];
        const nestedArtifacts = Array.isArray(transpileResult?.assets?.generatedArtifacts)
            ? transpileResult.assets.generatedArtifacts
            : [];

        const deduped = new Set<GeneratedCollectionArtifactLike>();
        const combined = [...directArtifacts, ...rootArtifacts, ...nestedArtifacts];
        for (const artifact of combined) {
            if (artifact && typeof artifact === 'object') {
                deduped.add(artifact);
            }
        }

        return Array.from(deduped);
    }

    _normalizeGeneratedArtifactPath(targetPath: unknown): string | null {
        if (typeof targetPath !== 'string') {
            return null;
        }
        const normalized = targetPath.replace(/\\/g, '/').trim().replace(/^\/+/, '');
        return normalized || null;
    }

    _isAllowedGeneratedArtifactPath(targetPath: string): boolean {
        return targetPath.startsWith('app/') || targetPath.startsWith('collection/');
    }

    _isManagedCollectionPath(path: string): boolean {
        return (
            path.startsWith('app/') ||
            path.startsWith('collection/') ||
            isPackageModulePath(path)
        );
    }

    /**
     * Extract Python imports from source code.
     * @private
     * @param {string} code - Python source code
     * @returns {Array<string>} - Import paths (e.g., ["otter_stdmo.base"])
     */
    _extractPythonImports(code: string): string[] {
        const imports: string[] = [];

        // Match: import otter_stdmo.base
        const importRegex = /^\s*import\s+([\w.]+)/gm;
        let match: RegExpExecArray | null;
        while ((match = importRegex.exec(code)) !== null) {
            imports.push(match[1]);
        }

        // Match: from otter_stdmo import base
        const fromRegex = /^\s*from\s+([\w.]+)\s+import/gm;
        while ((match = fromRegex.exec(code)) !== null) {
            imports.push(match[1]);
        }

        // Filter to only otter_* package imports
        return imports.filter((imp) => isPackageModuleImport(imp));
    }

    /**
     * Delete collection files from device and remove from hash manifest.
     * @private
     */
    async _deleteCollectionFiles(): Promise<void> {
        // Delete hash-tracked collection paths first (covers generated app/* artifacts).
        let hashedCollectionPaths: string[] = [];
        try {
            await this._hashManager.load();
            const collectionHashes = this._hashManager.getFiles('collection');
            hashedCollectionPaths = Object.keys(collectionHashes || {});
        } catch (error) {
            this._log('collection-hash-section-load-failed', { error: error.message });
        }

        for (const path of hashedCollectionPaths) {
            try {
                await this._deleteFile(path);
            } catch (error) {
                this._log('collection-hash-tracked-file-delete-failed', {
                    path,
                    error: error.message,
                });
            }
        }

        // Delete nodes folder (collection metadata)
        try {
            await this._deleteFolder('nodes');
        } catch (error) {
            this._log('nodes-folder-delete-failed', { error: error.message });
        }

        // Delete collection folder (metadata and old hashes)
        try {
            await this._deleteFolder('collection');
        } catch (error) {
            this._log('collection-folder-delete-failed', { error: error.message });
        }

        // Delete generated code
        try {
            await this._deleteFile('app/main_loop.py');
        } catch (error) {
            this._log('main-loop-delete-failed', { error: error.message });
        }

        // Remove collection section from hash manifest
        try {
            this._hashManager.removeSection('collection');
            await this._hashManager.save();
            this._log('collection-hash-section-removed');
        } catch (error) {
            this._log('collection-hash-section-remove-failed', { error: error.message });
        }
    }

    async _restoreDefaultRuntimeCollectionFiles(): Promise<void> {
        const runtimeId =
            typeof this._deviceState.runtimeId === 'string' ? this._deviceState.runtimeId : null;
        if (!runtimeId) {
            this._log('collection-default-restore-skipped', {
                reason: 'runtime-id-missing',
            });
            return;
        }

        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            this._log('collection-default-restore-skipped', {
                reason: 'runtime-not-found',
                runtimeId,
            });
            return;
        }

        await this._restoreRuntimeDefaultFile(runtime, 'app/main_loop.py');
        await this._restoreRuntimeDefaultFile(runtime, 'html/index.html');
    }

    async _restoreRuntimeDefaultFile(
        runtime: DeviceRuntimeLike,
        devicePath: string
    ): Promise<void> {
        const sourceUrl = this._findRuntimeFilesystemUrl(runtime, devicePath);
        if (!sourceUrl) {
            this._log('collection-default-file-missing', {
                devicePath,
                runtimeId: runtime.id,
            });
            return;
        }

        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(
                `Failed to fetch runtime default file ${devicePath}: ${response.statusText}`
            );
        }

        const content = await response.text();
        await this._deviceConnection.writeTextFile(devicePath, content);
        this._log('collection-default-file-restored', {
            devicePath,
            runtimeId: runtime.id,
            sourceUrl,
        });
    }

    _findRuntimeFilesystemUrl(runtime: DeviceRuntimeLike, devicePath: string): string | null {
        const filesystem = runtime.resolvedFilesystem || [];
        const origin =
            typeof window !== 'undefined' && window?.location?.origin
                ? window.location.origin
                : 'http://localhost';

        const match = filesystem.find((url) => {
            const urlObj = new URL(url, origin);
            const pathParts = urlObj.pathname.split('/');
            const runtimeIndex = pathParts.indexOf('runtime');
            if (runtimeIndex === -1) {
                return false;
            }

            const candidatePath = pathParts.slice(runtimeIndex + 2).join('/');
            return candidatePath === devicePath;
        });

        return match || null;
    }

    /**
     * Delete a file from device.
     * @private
     * @param {string} filePath
     */
    async _deleteFile(filePath: string): Promise<void> {
        await this._deviceConnection.deleteFile(filePath);
    }

    /**
     * Delete a folder and its contents from device.
     * @private
     * @param {string} folderPath
     */
    async _deleteFolder(folderPath: string): Promise<void> {
        await this._deviceConnection.deleteFolderRecursive(folderPath);
    }

    /**
     * Remove a device folder and report how many entries were removed.
     *
     * Prefers `DeviceConnection.removeFolder()`, which can say whether anything existed. A
     * connection that only implements the older API falls back to `deleteFolderRecursive()` /
     * `deleteFile()` (for `recursive: false`), where the count is unknowable and `null` is returned.
     * @private
     * @param {string} folderPath - Folder to remove
     * @param {Object} [options] - Removal options
     * @param {boolean} [options.recursive=true] - Remove the tree; `false` removes only an empty folder
     * @returns {Promise<number|null>} Removed entry count, or `null` when the connection cannot report it
     */
    async _removeFolder(
        folderPath: string,
        options: { recursive?: boolean } = {}
    ): Promise<number | null> {
        const removeFolder = this._deviceConnection.removeFolder;
        if (typeof removeFolder === 'function') {
            return await removeFolder.call(this._deviceConnection, folderPath, options);
        }

        if (options.recursive === false) {
            // `deleteFile` tries `os.remove` then `os.rmdir`, i.e. "remove only if empty".
            await this._deleteFile(folderPath);
            return null;
        }

        await this._deleteFolder(folderPath);
        return null;
    }

    // ========================================================================
    // File Operations (delegated to DeviceConnection)
    // ========================================================================

    /**
     * Upload a file to the device.
     * @private
     * @param {string} localPath - Local file path (for logging)
     * @param {string} remotePath - Device file path
     * @param {string|Uint8Array} content - File content
     * @returns {Promise<void>}
     */
    async _uploadFile(
        localPath: string,
        remotePath: string,
        content: string | Uint8Array
    ): Promise<void> {
        this._log('upload-start', { localPath, remotePath, size: content.length });

        try {
            // Use MicroPythonProtocol file upload
            await this._deviceConnection.sendFile(remotePath, content);

            this._log('upload-complete', { localPath, remotePath });
        } catch (error) {
            this._log('upload-failed', {
                localPath,
                remotePath,
                error: error.message,
            });
            throw new Error(`Failed to upload ${localPath}: ${error.message}`);
        }
    }

    /**
     * Upload a file and verify its on-device SHA-256 against the expected hash.
     *
     * Intermittent serial corruption during chunked upload can silently leave a
     * broken file on the device (for example a dropped chunk spliced two lines
     * together). This re-checks the transferred bytes by hashing the file on the
     * device and comparing it to the host-side digest, retrying the full transfer
     * when they do not match.
     *
     * Verification is skipped when the device connection does not expose
     * `calculateHash`, or when the returned value is not a well-formed SHA-256
     * digest, so this path remains safe to use with mock connections.
     *
     * @private
     * @param {string} remotePath - Device file path
     * @param {string|Uint8Array} content - File content to upload
     * @param {string} [expectedHash] - Expected SHA-256 hex digest; computed from content when omitted
     * @returns {Promise<void>}
     * @throws {Error} If the device hash never matches after retries
     */
    async _uploadAndVerify(
        remotePath: string,
        content: string | Uint8Array,
        expectedHash?: string
    ): Promise<void> {
        const canVerify = typeof this._deviceConnection.calculateHash === 'function';
        const targetHash = canVerify
            ? (expectedHash || (await calculateFileHash(content))).toLowerCase()
            : null;

        for (let attempt = 0; attempt <= UPLOAD_VERIFY_MAX_RETRIES; attempt++) {
            await this._uploadFile(remotePath, remotePath, content);

            if (!canVerify || targetHash === null) {
                this._log('upload-verify-skipped', {
                    remotePath,
                    reason: 'calculateHash unavailable',
                });
                return;
            }

            const deviceHashRaw = await this._deviceConnection.calculateHash(remotePath);
            const deviceHash = deviceHashRaw ? deviceHashRaw.trim().toLowerCase() : '';

            if (!/^[0-9a-f]{64}$/.test(deviceHash)) {
                this._log('upload-verify-skipped', {
                    remotePath,
                    reason: 'device hash is not a valid sha256 digest',
                    deviceHash: deviceHash || null,
                });
                return;
            }

            if (deviceHash === targetHash) {
                this._log('upload-verify-ok', {
                    remotePath,
                    hash: targetHash,
                    attempt: attempt + 1,
                });
                return;
            }

            this._log('upload-verify-mismatch', {
                remotePath,
                attempt: attempt + 1,
                expectedHash: targetHash,
                deviceHash,
            });
        }

        throw new Error(
            `Upload verification failed for ${remotePath} after ${UPLOAD_VERIFY_MAX_RETRIES + 1} attempts`
        );
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
            scopedGlobal.__microOtterLog.log('CollectionDeployment', reason, level, ...payloadData);
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
