// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * RuntimeDeployment - Phase 2 Operations
 *
 * Handles runtime installation, upgrade, and management on ESP32 devices.
 * Manages runtime files, base node libraries, and sync manifests.
 */

import { ProgressTracker } from '../core/progress-events.js';
import { HashManifestManager } from './hash-manifest-manager.js';
import { AppPayload } from '../core/app-event.js';
import { toErrorMessage } from '../core/error-utils.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type DeviceStateLike = {
    connected: boolean;
    hasMicroPython?: boolean | null;
    runtimeInstalled?: boolean;
    runtimeVersion?: string | null;
    runtimeId?: string | null;
    [key: string]: unknown;
};

type DeviceConnectionLike = {
    hardReset: () => Promise<void>;
    softReset: (options?: { startRunning?: boolean }) => Promise<void>;
    deleteFile: (path: string) => Promise<void>;
    deleteFolderRecursive: (path: string) => Promise<void>;
    deleteFileSystem: () => Promise<void>;
    listFiles?: (
        path?: string
    ) => Promise<Array<{ name: string; type: 'file' | 'dir' | 'unknown' }>>;
    readTextFile: (path: string) => Promise<string>;
    writeTextFile: (path: string, content: string) => Promise<void>;
    sendFile: (path: string, content: string | Uint8Array) => Promise<void>;
};

type PreservedCollectionLibrary = {
    path: string;
    content: string;
};

type PreservedCollectionData = {
    metadata?: string;
    mainLoop?: string;
    libraries: PreservedCollectionLibrary[];
};

type RuntimeManifestLike = {
    preservedPaths?: string[];
    nodeLibraries?: {
        alwaysInclude?: string[];
    };
    mpySourceExcludes?: string[];
    files?: string[];
    [key: string]: unknown;
};

type DeviceRuntimeLike = {
    id: string;
    name: string;
    version: string;
    manifest?: RuntimeManifestLike;
    resolvedFilesystem?: string[];
    [key: string]: unknown;
};

type RuntimeCollectionLike = {
    getRuntime: (runtimeId: string) => DeviceRuntimeLike | null | undefined;
};

type UpdateDeviceStateFn = (patch: Partial<DeviceStateLike>) => void;

type PreparedToolFile = {
    relativePath: string;
    devicePath: string;
    url: string;
    content: string | Uint8Array;
    hash: string;
    needsUpload?: boolean;
};

type PreparedRuntimeFile = {
    devicePath: string;
    url: string;
    content: string | Uint8Array;
    hash: string;
    deviceHash?: string;
};

type PreparedLibraryFile = {
    devicePath: string;
    url: string;
    content: string | Uint8Array;
};

type MpyCompileProfileLike = {
    hash?: string;
};

type MpyAvailabilityLike = {
    tools?: { hasProfile?: boolean };
    runtime?: { hasProfile?: boolean };
};

type PreparedFiles = {
    tools: PreparedToolFile[];
    runtime: PreparedRuntimeFile[];
    libraries: PreparedLibraryFile[];
};

type RuntimeDeploymentOptions = {
    deviceConnection: DeviceConnectionLike;
    deviceState: DeviceStateLike;
    updateDeviceState: UpdateDeviceStateFn;
    runtimeCollection: RuntimeCollectionLike;
};

class RuntimeDeploymentEventPayload extends AppPayload {
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
 * Manages runtime deployment operations to ESP32 devices.
 * Handles installation, upgrade, removal, and refresh of device runtimes.
 *
 * @extends EventTarget
 * @emits runtime-installed - Runtime installation complete
 * @emits runtime-upgraded - Runtime upgrade complete
 * @emits runtime-removed - Runtime removal complete
 * @emits operation-error - Error during operation
 */
export class RuntimeDeployment extends EventTarget {
    _deviceConnection: DeviceConnectionLike;
    _deviceState: DeviceStateLike;
    _updateDeviceState: UpdateDeviceStateFn;
    _runtimeCollection: RuntimeCollectionLike;
    _hashManager: HashManifestManager;
    _currentOperation: ProgressTracker | null;
    _preparedFiles: PreparedFiles;

    /**
     * @param {Object} options
     * @param {DeviceConnection} options.deviceConnection - Device connection manager
     * @param {import('../data/device-state.js').DeviceState} options.deviceState - DeviceState instance
     * @param {Function} options.updateDeviceState - Function to update device state
     * @param {DeviceRuntimeCollection} options.runtimeCollection - Runtime collection
     */
    constructor({
        deviceConnection,
        deviceState,
        updateDeviceState,
        runtimeCollection,
    }: RuntimeDeploymentOptions) {
        super();

        this._deviceConnection = deviceConnection;
        this._deviceState = deviceState;
        this._updateDeviceState = updateDeviceState;
        this._runtimeCollection = runtimeCollection;

        // Hash manifest manager for centralized hash operations
        this._hashManager = new HashManifestManager(deviceConnection);

        // Operation state
        this._currentOperation = null; // ProgressTracker for active operation

        // Prepared file lists (populated during preparation phase)
        this._preparedFiles = {
            tools: [], // [{relativePath, devicePath, url, content, hash}]
            runtime: [], // [{devicePath, url, content, hash}]
            libraries: [], // [{devicePath, url, content}]
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
     * Ensure runtime execution is halted and raw REPL control is stable
     * before performing filesystem mutations.
     *
     * In-place redeploys can otherwise time out when an existing runtime
     * loop is still active and producing output during command execution.
     */
    async _prepareControlledDeploymentSession(operation: string): Promise<void> {
        this._log('deployment-session-prepare-start', { operation });
        await this._deviceConnection.softReset({ startRunning: false });
        await this._delay(250);
        this._log('deployment-session-prepare-complete', { operation });
    }

    /**
     * Install runtime on device (full install).
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Installation options (reserved for future use)
     * @returns {Promise<void>}
     * @emits runtime-installed - Runtime installation complete
     */
    async installRuntime(runtimeId: string, options: Record<string, unknown> = {}): Promise<void> {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (this._deviceState.hasMicroPython !== true) {
            throw new Error('MicroPython not detected on device');
        }

        // Get runtime from runtime collection
        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        const tracker = new ProgressTracker('runtime-install', 8);
        this._currentOperation = tracker;
        let installPhase = 'init';

        try {
            installPhase = 'start';
            tracker.start(`Installing runtime: ${runtime.name}`);

            installPhase = 'prepare-controlled-session';
            tracker.update('Preparing deployment session...', 1);
            await this._prepareControlledDeploymentSession('runtime-install');

            // Step 1: PREPARATION PHASE
            installPhase = 'prepare-files';
            tracker.update('Preparing files for upload...', 1);
            const preparation = await this.prepareInstall(runtimeId, options);

            // Emit preparation completion with totalFiles in detail
            tracker.update(`Ready to upload ${preparation.totalFiles} files`, 1, {
                totalFiles: preparation.totalFiles,
                breakdown: {
                    tools: preparation.toolsCount,
                    runtime: preparation.runtimeCount,
                    libraries: preparation.libsCount,
                },
            });
            this._log('runtime-install-prepared', {
                runtimeId,
                totalFiles: preparation.totalFiles,
                toolsCount: preparation.toolsCount,
                runtimeCount: preparation.runtimeCount,
                libsCount: preparation.libsCount,
            });

            // Step 2: Preserve files declared in manifest.preservedPaths
            installPhase = 'preserve-runtime-paths';
            tracker.update('Preserving runtime files...', 2);
            const preservedFiles = await this._preserveRuntimePaths(runtime);

            // Step 3: Delete existing runtime files
            installPhase = 'delete-old-runtime-files';
            tracker.update('Removing old runtime files...', 3);
            await this._deleteRuntimeFiles();

            // Step 4: Upload tools folder (from prepared list)
            installPhase = 'upload-tools';
            tracker.update('Uploading tools folder...', 4);
            await this._uploadPreparedTools();

            // Step 5: Upload runtime files (from prepared list)
            installPhase = 'upload-runtime-files';
            tracker.update('Uploading runtime files...', 5);
            await this._uploadPreparedRuntimeFiles();

            // Step 6: Upload runtime base libraries (from prepared list)
            installPhase = 'upload-runtime-libraries';
            tracker.update('Uploading runtime base libraries...', 6);
            await this._uploadPreparedLibraries();

            // Step 7: Save hash manifest with runtime metadata
            installPhase = 'save-hash-manifest';
            tracker.update('Saving hash manifest...', 7);
            this._hashManager.commitStaging('runtime', {
                runtimeId: runtime.id,
                version: runtime.version,
            });
            this._hashManager.commitStaging('tools'); // Commit tools hashes
            await this._hashManager.save();

            // Write device.json marker file for version detection
            installPhase = 'write-device-marker';
            await this._writeDeviceMarker(runtime);

            // Step 8: Restore preserved files
            installPhase = 'restore-preserved-paths';
            tracker.update('Restoring preserved files...', 8);
            await this._restoreRuntimePaths(preservedFiles);

            // Allow device file system to settle after heavy upload operations
            installPhase = 'finalize-filesystem';
            this._log('runtime-install-finalizing');
            await this._delay(1000); // 1 second for file system to flush

            // Hard reset and disconnect to ensure runtime restarts cleanly.
            installPhase = 'hard-reset-disconnect';
            await this._deviceConnection.hardReset();
            await this._delay(500);
            this._log('runtime-install-device-hard-reset-and-disconnected');

            // Update device state
            this._updateDeviceState({
                connected: false,
                runtimeInstalled: true,
                runtimeVersion: runtime.version,
                runtimeId: runtime.id,
            });

            tracker.complete(`Runtime installed: ${runtime.name} v${runtime.version}`);

            this.dispatchEvent(
                new CustomEvent('runtime-installed', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.RuntimeInstalled.v1',
                        { runtimeId, runtime }
                    ),
                })
            );
        } catch (error) {
            const phaseError = new Error(
                `Runtime installation failed at phase '${installPhase}': ${toErrorMessage(error)}`
            );
            tracker.error('Runtime installation failed', phaseError);
            this._log('runtime-install-phase-failed', 'error', {
                runtimeId,
                phase: installPhase,
                error: toErrorMessage(error),
            });

            this.dispatchEvent(
                new CustomEvent('operation-error', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.OperationError.v1',
                        {
                            operation: 'runtime-install',
                            error: phaseError.message,
                        }
                    ),
                })
            );

            throw phaseError;
        } finally {
            this._currentOperation = null;
        }
    }

    /**
     * Upgrade runtime on device (incremental update).
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options
     * @param {boolean} options.preserveCollection - Preserve collection data (default: true)
     * @returns {Promise<void>}
     * @emits runtime-upgraded - Runtime upgrade complete
     */
    async upgradeRuntime(
        runtimeId: string,
        options: { preserveCollection?: boolean } = {}
    ): Promise<void> {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        if (!this._deviceState.runtimeInstalled) {
            throw new Error('No runtime installed to upgrade');
        }

        // Get runtime from runtime collection
        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        // Check if versions match
        if (this._deviceState.runtimeVersion === runtime.version) {
            this._log('runtime-upgrade-same-version', {
                version: runtime.version,
                runtimeId: runtime.id,
            });
            // Note: We still proceed with upgrade to ensure file consistency,
            // but log this for user awareness
        }

        const tracker = new ProgressTracker('runtime-upgrade', 5);
        this._currentOperation = tracker;

        try {
            const versionInfo =
                this._deviceState.runtimeVersion === runtime.version
                    ? ` (same version: ${runtime.version})`
                    : ` (${this._deviceState.runtimeVersion} → ${runtime.version})`;
            tracker.start(`Upgrading runtime: ${runtime.name}${versionInfo}`);

            tracker.update('Preparing deployment session...', 1);
            await this._prepareControlledDeploymentSession('runtime-upgrade');

            // Upgrade only uploads changed files based on hash comparison.
            // Preserved paths are only relevant during refresh operations.

            // Step 1: PREPARATION PHASE
            tracker.update('Preparing files for upload...', 1);
            const preparation = await this.prepareUpgrade(runtimeId, options);

            // Emit preparation completion with totalFiles in detail
            tracker.update(`Ready to upload ${preparation.totalFiles} files`, 1, {
                totalFiles: preparation.totalFiles,
                breakdown: {
                    tools: preparation.toolsCount,
                    runtime: preparation.runtimeCount,
                },
            });

            // Step 2: Upload changed runtime files (from prepared list)
            tracker.update('Uploading changed files...', 2);
            await this._uploadPreparedRuntimeFiles();

            // Step 3: Upload changed tools files (from prepared list)
            tracker.update('Uploading changed tools...', 3);
            await this._uploadPreparedTools();

            // Step 4: Save hash manifest with runtime metadata
            tracker.update('Saving hash manifest...', 4);
            this._hashManager.commitStaging('runtime', {
                runtimeId: runtime.id,
                version: runtime.version,
            });
            this._hashManager.commitStaging('tools');
            await this._hashManager.save();

            // Write device.json marker file for version detection
            await this._writeDeviceMarker(runtime);

            // Allow device file system to settle after upgrade operations
            this._log('runtime-upgrade-finalizing');
            await this._delay(1000); // 1 second for file system to flush

            // Step 5: Hard reset and disconnect to ensure runtime restarts cleanly
            tracker.update('Resetting device...', 5);
            await this._deviceConnection.hardReset();
            await this._delay(500);
            this._log('runtime-upgrade-device-hard-reset-and-disconnected');

            // Update device state
            this._updateDeviceState({
                connected: false,
                runtimeVersion: runtime.version,
                runtimeId: runtime.id,
                runtimeInstalled: true,
                hasMicroPython: null,
            });

            const totalChanged = preparation.totalFiles;
            const changeMsg =
                totalChanged === 0
                    ? 'no files changed'
                    : `${totalChanged} file${totalChanged === 1 ? '' : 's'} changed`;
            tracker.complete(
                `Runtime upgraded: ${runtime.name} v${runtime.version} (${changeMsg})`
            );

            this.dispatchEvent(
                new CustomEvent('runtime-upgraded', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.RuntimeUpgraded.v1',
                        { runtimeId, runtime, filesChanged: totalChanged }
                    ),
                })
            );
        } catch (error) {
            tracker.error('Runtime upgrade failed', error);

            this.dispatchEvent(
                new CustomEvent('operation-error', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.OperationError.v1',
                        {
                            operation: 'runtime-upgrade',
                            error: toErrorMessage(error),
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
     * Remove runtime from device.
     * @param {Object} options - Removal options (reserved for future use)
     * @returns {Promise<void>}
     * @emits runtime-removed - Runtime removal complete
     */
    async removeRuntime(
        options: { deletePreservedFiles?: boolean; deleteFileSystem?: boolean } = {}
    ): Promise<void> {
        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        const deletePreservedFiles = options.deletePreservedFiles || false;
        const deleteFileSystem = options.deleteFileSystem || false;

        // Calculate total steps based on options
        let totalSteps = 6; // Base: runtime folders, nodes, manifest files, hash manifest, boot.py+main.py, state update
        if (deletePreservedFiles) totalSteps++;
        if (deleteFileSystem) totalSteps += 1; // filesystem deletion replaces selective deletion

        const tracker = new ProgressTracker('runtime-remove', totalSteps);
        this._currentOperation = tracker;

        try {
            tracker.start('Removing runtime from device...');
            let currentStep = 1;

            tracker.update('Preparing deployment session...', currentStep++);
            await this._prepareControlledDeploymentSession('runtime-remove');

            // If deleting entire filesystem, do that first
            if (deleteFileSystem) {
                tracker.update('Deleting entire filesystem...', currentStep++);
                await this._deleteFileSystem();

                // Upload default MicroPython files
                tracker.update('Uploading default MicroPython files...', currentStep++);
                await this._uploadDefaultMicroPythonFiles();
            } else {
                // Step 1: Delete runtime folders (tools, libs, app)
                tracker.update('Deleting runtime folders...', currentStep++);
                await this._deleteRuntimeFiles();

                // Step 2: Delete nodes folder
                tracker.update('Deleting nodes folder...', currentStep++);
                try {
                    await this._deleteFolder('nodes');
                } catch (error) {
                    this._log('nodes-folder-delete-failed', { error: toErrorMessage(error) });
                    // Continue - folder might not exist
                }

                // Step 3: Delete manifest files at root
                tracker.update('Deleting runtime manifest files...', currentStep++);
                await this._deleteRuntimeManifestFiles();

                // Step 4: Delete hash manifest
                tracker.update('Removing hash manifest...', currentStep++);
                try {
                    await this._deviceConnection.deleteFile('.micro-otter-sync-manifest');
                    this._log('hash-manifest-deleted', { path: '.micro-otter-sync-manifest' });
                } catch (error) {
                    // Hash file might not exist
                    this._log('hash-manifest-delete-failed', { error: toErrorMessage(error) });
                }

                // Step 5: Optionally delete preserved files
                if (deletePreservedFiles) {
                    tracker.update('Deleting preserved files...', currentStep++);
                    await this._deletePreservedFiles();
                }

                // Step 6: Reset boot.py and main.py to default MicroPython
                tracker.update('Resetting boot.py and main.py to default...', currentStep++);
                await this._uploadDefaultMicroPythonFiles();
            }

            // Update device state
            this._updateDeviceState({
                runtimeInstalled: false,
                runtimeVersion: null,
                runtimeId: null,
                collectionDeployed: false,
                collectionName: null,
                collectionVersion: null,
            });

            tracker.complete('Runtime removed from device');

            this.dispatchEvent(
                new CustomEvent('runtime-removed', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.RuntimeRemoved.v1',
                        {
                            deletedPreservedFiles: deletePreservedFiles,
                        }
                    ),
                })
            );
        } catch (error) {
            tracker.error('Runtime removal failed', error);

            this.dispatchEvent(
                new CustomEvent('operation-error', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.OperationError.v1',
                        {
                            operation: 'runtime-remove',
                            error: toErrorMessage(error),
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
     * Refresh runtime on device (force overwrite all files).
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options
     * @param {boolean} options.preserveCollection - Preserve collection data (default: true)
     * @returns {Promise<void>}
     * @emits runtime-installed - Runtime refresh complete (uses install event)
     */
    async refreshRuntime(
        runtimeId: string,
        options: { preserveCollection?: boolean } = {}
    ): Promise<void> {
        const { preserveCollection = true } = options;

        if (!this._deviceState.connected) {
            throw new Error('Device not connected');
        }

        // Get runtime from runtime collection
        const runtime = this._runtimeCollection?.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        const tracker = new ProgressTracker('runtime-refresh', 6);
        this._currentOperation = tracker;

        try {
            tracker.start(`Refreshing runtime: ${runtime.name}`);

            tracker.update('Preparing deployment session...', 1);
            await this._prepareControlledDeploymentSession('runtime-refresh');

            // Step 1: PREPARATION PHASE
            tracker.update('Preparing files for upload...', 1);
            const preparation = await this.prepareRefresh(runtimeId, options);

            // Emit preparation completion with totalFiles in detail
            tracker.update(`Ready to upload ${preparation.totalFiles} files`, 1, {
                totalFiles: preparation.totalFiles,
                breakdown: {
                    runtime: preparation.runtimeCount,
                    libraries: preparation.libsCount,
                },
            });

            // Step 2: Preserve runtime paths and optionally collection data
            tracker.update('Preserving runtime files...', 2);
            const preservedFiles = await this._preserveRuntimePaths(runtime);

            let collectionData = null;
            if (preserveCollection) {
                collectionData = await this._preserveCollectionData(runtime);
            }

            // Step 3: Force upload all runtime files (from prepared list)
            tracker.update('Force uploading all runtime files...', 3);
            await this._uploadPreparedRuntimeFiles();

            // Step 4: Upload runtime base libraries (from prepared list)
            tracker.update('Uploading runtime base libraries...', 4);
            await this._uploadPreparedLibraries();

            // Step 5: Save hash manifest with runtime metadata
            tracker.update('Saving hash manifest...', 5);
            this._hashManager.commitStaging('runtime', {
                runtimeId: runtime.id,
                version: runtime.version,
            });
            await this._hashManager.save();

            // Step 6: Restore preserved data
            tracker.update('Restoring preserved data...', 6);
            await this._restoreRuntimePaths(preservedFiles);
            if (collectionData) {
                await this._restoreCollectionData(collectionData);
            }

            // Update device state
            this._updateDeviceState({
                runtimeInstalled: true,
                runtimeVersion: runtime.version,
                runtimeId: runtime.id,
            });

            tracker.complete(`Runtime refreshed: ${runtime.name} v${runtime.version}`);

            this.dispatchEvent(
                new CustomEvent('runtime-installed', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.RuntimeInstalled.v1',
                        { runtimeId, runtime, refresh: true }
                    ),
                })
            );
        } catch (error) {
            tracker.error('Runtime refresh failed', error);

            this.dispatchEvent(
                new CustomEvent('operation-error', {
                    detail: new RuntimeDeploymentEventPayload(
                        'RuntimeDeployment.OperationError.v1',
                        {
                            operation: 'runtime-refresh',
                            error: toErrorMessage(error),
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
    // Private: Runtime Operations Helpers
    // ========================================================================

    /**
     * Preserve files/folders declared in runtime manifest preservedPaths.
     * @private
     * @param {DeviceRuntime} runtime
     * @returns {Promise<Map<string, string>>} Map of path → content
     */
    async _preserveRuntimePaths(runtime: DeviceRuntimeLike): Promise<Map<string, string>> {
        const preserved = new Map();
        const preservedPaths = runtime.manifest?.preservedPaths || [];

        for (const path of preservedPaths) {
            try {
                const content = await this._downloadFile(path);
                preserved.set(path, content);
                this._log('runtime-path-preserved', { path, size: content.length });
            } catch (error) {
                this._log('runtime-path-not-found', { path, error: toErrorMessage(error) });
                // Continue - file might not exist yet
            }
        }

        return preserved;
    }

    /**
     * Restore files/folders preserved during runtime operations.
     * @private
     * @param {Map<string, string>} preserved - Map of path → content
     */
    async _restoreRuntimePaths(preserved: Map<string, string>): Promise<void> {
        if (!preserved || preserved.size === 0) return;

        for (const [path, content] of preserved.entries()) {
            try {
                await this._uploadFile(path, path, content);
                this._log('runtime-path-restored', { path });
            } catch (error) {
                this._log('runtime-path-restore-failed', { path, error: toErrorMessage(error) });
                // Don't throw - preservation is best-effort
            }
        }
    }

    /**
     * Delete all runtime files from device.
     * @private
     */
    async _deleteRuntimeFiles() {
        const foldersToDelete = ['tools', 'libs', 'app'];

        for (const folder of foldersToDelete) {
            try {
                await this._deleteFolder(folder);
            } catch (error) {
                this._log('folder-delete-failed', {
                    folder,
                    error: toErrorMessage(error),
                });
                // Continue - folder might not exist
            }
        }
    }

    /**
     * Delete runtime manifest files from device root.
     * This reads the manifest.json to find all files that were deployed with the runtime,
     * then deletes each one individually.
     * @private
     */
    async _deleteRuntimeManifestFiles() {
        try {
            // Download the runtime manifest to see what files need to be deleted
            const manifestContent = await this._downloadFile('manifest.json');
            const manifest = parseJsonFromDeviceText<Record<string, unknown>>(manifestContent);

            // Get all files listed in the manifest
            const filesToDelete = [];

            // Add manifest files if present
            if (manifest.files && Array.isArray(manifest.files)) {
                filesToDelete.push(...manifest.files);
            }

            // Add the manifest.json itself
            filesToDelete.push('manifest.json');

            // Delete each file
            for (const file of filesToDelete) {
                try {
                    await this._deviceConnection.deleteFile(file);
                    this._log('manifest-file-deleted', { path: file });
                } catch (error) {
                    this._log('manifest-file-delete-failed', {
                        path: file,
                        error: toErrorMessage(error),
                    });
                    // Continue - file might not exist
                }
            }
        } catch (error) {
            this._log('manifest-read-failed', { error: toErrorMessage(error) });
            // If manifest doesn't exist or can't be read, try to delete common files
            const commonFiles = ['manifest.json', 'device.json'];
            for (const file of commonFiles) {
                try {
                    await this._deviceConnection.deleteFile(file);
                    this._log('common-file-deleted', { path: file });
                } catch {
                    // Ignore errors for files that don't exist
                }
            }
        }

        // Also delete html folder if it exists (common in many runtimes)
        try {
            await this._deleteFolder('html');
            this._log('html-folder-deleted');
        } catch {
            // Ignore - folder might not exist
        }
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
     * Delete preserved files from device.
     * Gets the list of preserved paths from the current runtime manifest
     * and deletes each file individually.
     * @private
     */
    async _deletePreservedFiles() {
        // Get current runtime to access preservedPaths
        const runtimeId = this._deviceState.runtimeId;
        if (!runtimeId) {
            this._log('no-runtime-for-preserved-files', {
                message: 'No runtime ID in device state',
            });
            return;
        }

        const runtime = this._runtimeCollection.getRuntime(runtimeId);
        if (!runtime || !runtime.manifest) {
            this._log('no-runtime-manifest-for-preserved-files', { runtimeId });
            return;
        }

        const preservedPaths = runtime.manifest.preservedPaths || [];
        if (preservedPaths.length === 0) {
            this._log('no-preserved-paths', { runtimeId });
            return;
        }

        for (const path of preservedPaths) {
            try {
                await this._deviceConnection.deleteFile(path);
                this._log('preserved-file-deleted', { path });
            } catch (error) {
                // File might not exist - continue
                this._log('preserved-file-delete-failed', { path, error: toErrorMessage(error) });
            }
        }
    }

    /**
     * Upload a basic main.py file to device root.
     * This provides a minimal boot script that doesn't cause errors.
     * @private
     */
    async _uploadBasicMainPy() {
        const basicMainPy = `# Micro-Otter Basic Main
# This file is uploaded after runtime removal to ensure device boots without errors.

print("[system] boot: device ready, no runtime installed")
`;

        try {
            await this._uploadFile('main.py', 'main.py', basicMainPy);
            this._log('basic-main-uploaded', { path: 'main.py', size: basicMainPy.length });
        } catch (error) {
            this._log('basic-main-upload-failed', { error: toErrorMessage(error) });
            throw new Error(`Failed to upload main.py: ${toErrorMessage(error)}`);
        }
    }

    /**
     * Delete entire filesystem from device.
     * Recursively removes all files and folders from root.
     * Some system files may be protected and will fail silently.
     * @private
     */
    async _deleteFileSystem() {
        try {
            const result = await this._deviceConnection.deleteFileSystem();
            this._log('filesystem-deleted', { result });
        } catch (error) {
            // Log but continue - some files may be protected
            this._log('filesystem-delete-partial', { error: toErrorMessage(error) });
        }
    }

    /**
     * Upload default MicroPython boot.py and main.py files.
     * These provide a clean default MicroPython setup.
     * @private
     */
    async _uploadDefaultMicroPythonFiles() {
        // Default boot.py - minimal setup
        const bootPy = `# boot.py - Default MicroPython boot file
# This file is executed on every boot (including wake-boot from deepsleep)

import gc
try:
    import webrepl
    webrepl.start()
except:
    pass  # WebREPL may not be available on all devices

# Run garbage collection
gc.collect()

print("[system] boot: complete")
`;

        // Default main.py - empty application
        const mainPy = `# main.py - Default MicroPython main file
# This file is executed after boot.py

print("[system] boot: ready")
`;

        // Upload boot.py
        try {
            await this._uploadFile('boot.py', 'boot.py', bootPy);
            this._log('default-boot-uploaded', { path: 'boot.py', size: bootPy.length });
        } catch (error) {
            this._log('default-boot-upload-failed', { error: toErrorMessage(error) });
            throw new Error(`Failed to upload boot.py: ${toErrorMessage(error)}`);
        }

        // Upload main.py
        try {
            await this._uploadFile('main.py', 'main.py', mainPy);
            this._log('default-main-uploaded', { path: 'main.py', size: mainPy.length });
        } catch (error) {
            this._log('default-main-upload-failed', { error: toErrorMessage(error) });
            throw new Error(`Failed to upload main.py: ${toErrorMessage(error)}`);
        }
    }

    // ====================
    // Preparation Methods
    // ====================

    /**
     * Prepare tools folder upload by fetching files and comparing hashes.
     * @private
     * @param {string} toolsBaseUrl - Base URL for tools (e.g., '/device/tools')
     * @param {Object<string, string>} deviceHashes - Existing device file hashes
     * @returns {Promise<number>} Count of files to upload
     */
    async _prepareToolsUpload(
        toolsBaseUrl: string,
        deviceHashes: Record<string, string>,
        options: {
            mpyProfileHash?: string | null;
            preferMpy?: boolean;
        } = {}
    ): Promise<number> {
        const { mpyProfileHash = null, preferMpy = false } = options;
        // 1. Fetch tools manifest
        const manifestUrl = `${toolsBaseUrl}/manifest.json`;
        const manifestResp = await fetch(manifestUrl);
        if (!manifestResp.ok) {
            throw new Error(`Failed to fetch tools manifest: ${manifestResp.statusText}`);
        }
        const manifest = await manifestResp.json();

        if (!manifest.files || manifest.files.length === 0) {
            this._log('tools-manifest-empty');
            this._preparedFiles.tools = [];
            return 0;
        }

        // 2. Calculate host-side hashes for all tools files and fetch content
        const preparedTools = [];

        for (const relativePath of manifest.files) {
            const sourceUrl = `${toolsBaseUrl}/${relativePath}`;
            const isPythonSource = typeof relativePath === 'string' && relativePath.endsWith('.py');
            const useMpy = preferMpy && isPythonSource && typeof mpyProfileHash === 'string';

            const fileUrl = useMpy
                ? this._buildMpyArtifactUrl(sourceUrl, mpyProfileHash)
                : sourceUrl;
            const devicePath = useMpy
                ? `tools/${relativePath.replace(/\.py$/, '.mpy')}`
                : `tools/${relativePath}`;

            // Fetch file content
            const fileResp = await fetch(fileUrl);
            if (!fileResp.ok) {
                throw new Error(
                    `Failed to fetch tools file ${relativePath}: ${fileResp.statusText}`
                );
            }
            const fileContent = useMpy
                ? new Uint8Array(await fileResp.arrayBuffer())
                : await fileResp.text();

            // Prepare file: calculate hash and stage it
            const { needsUpload, hash } = await this._hashManager.prepareFile(
                'tools',
                devicePath,
                fileContent
            );

            // Store for later upload
            preparedTools.push({
                relativePath,
                devicePath,
                url: fileUrl,
                content: fileContent,
                hash,
                needsUpload,
            });
        }

        // Filter to only files that need upload
        this._preparedFiles.tools = preparedTools.filter((file) => file.needsUpload);

        this._log('tools-preparation-complete', {
            totalFiles: manifest.files.length,
            changedFiles: this._preparedFiles.tools.length,
            skippedFiles: manifest.files.length - this._preparedFiles.tools.length,
        });

        return this._preparedFiles.tools.length;
    }

    /**
     * Prepare runtime files upload by fetching all file contents.
     * @private
     * @param {DeviceRuntime} runtime - Runtime with resolvedFilesystem URLs
     * @returns {Promise<number>} Count of files to upload
     */
    async _prepareRuntimeFilesUpload(
        runtime: DeviceRuntimeLike,
        options: {
            preserveCollection?: boolean;
            mpyProfileHash?: string | null;
            preferMpy?: boolean;
        } = {}
    ): Promise<number> {
        const filesystem = runtime.resolvedFilesystem || [];
        const { preserveCollection = false, mpyProfileHash = null, preferMpy = false } = options;
        const mpySourceExcludes = this._getRuntimeMpySourceExcludes(runtime);

        if (filesystem.length === 0) {
            throw new Error('Runtime has no filesystem entries');
        }

        const preparedFiles = [];

        // Fetch each file and calculate hash
        for (const sourceUrl of filesystem) {
            const sourcePath = this._extractDevicePathFromRuntimeUrl(sourceUrl);
            const isPythonSource = sourcePath.endsWith('.py');
            const useMpy =
                preferMpy &&
                isPythonSource &&
                typeof mpyProfileHash === 'string' &&
                !mpySourceExcludes.has(sourcePath);
            const fileUrl = useMpy
                ? this._buildMpyArtifactUrl(sourceUrl, mpyProfileHash)
                : sourceUrl;

            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch runtime file: ${fileUrl}`);
            }

            const content = useMpy
                ? new Uint8Array(await response.arrayBuffer())
                : await response.text();

            const devicePath = useMpy ? sourcePath.replace(/\.py$/, '.mpy') : sourcePath;

            if (preserveCollection && devicePath === 'app/main_loop.py') {
                this._log('runtime-file-skipped-preserve-collection', { devicePath });
                continue;
            }

            // Prepare file: calculate hash and stage it
            const { needsUpload, hash } = await this._hashManager.prepareFile(
                'runtime',
                devicePath,
                content
            );

            if (needsUpload) {
                preparedFiles.push({
                    devicePath,
                    url: fileUrl,
                    content,
                    hash,
                });
            }
        }

        this._preparedFiles.runtime = preparedFiles;

        this._log('runtime-files-preparation-complete', {
            fileCount: preparedFiles.length,
            preserveCollection,
        });

        return preparedFiles.length;
    }

    /**
     * Prepare runtime base libraries upload by fetching library contents.
     * @private
     * @param {DeviceRuntime} runtime - Runtime with manifest containing alwaysInclude libraries
     * @returns {Promise<number>} Count of files to upload
     */
    async _prepareNodeLibrariesUpload(runtime: DeviceRuntimeLike): Promise<number> {
        const mpyOptions =
            (
                runtime as unknown as {
                    __mpyOptions?: { preferMpy?: boolean; mpyProfileHash?: string | null };
                }
            ).__mpyOptions || {};
        const preferMpy = mpyOptions.preferMpy === true;
        const mpyProfileHash =
            typeof mpyOptions.mpyProfileHash === 'string' ? mpyOptions.mpyProfileHash : null;
        const mpySourceExcludes = this._getRuntimeMpySourceExcludes(runtime);
        const manifest = runtime.manifest || {};
        const alwaysInclude = manifest.nodeLibraries?.alwaysInclude || [];

        if (alwaysInclude.length === 0) {
            this._log('runtime-no-base-libraries', { runtimeId: runtime.id });
            this._preparedFiles.libraries = [];
            return 0;
        }

        // Filter resolvedFilesystem for library files matching alwaysInclude paths
        const allLibraryUrls = (runtime.resolvedFilesystem || []).filter((url) =>
            url.includes('/libs/')
        );

        // Map alwaysInclude paths to full URLs and fetch content
        const preparedLibraries = [];

        for (const libPath of alwaysInclude) {
            // Find URL that ends with this library path
            const matchingUrl = allLibraryUrls.find((url) => {
                const urlObj = new URL(url, window.location.origin);
                const pathParts = urlObj.pathname.split('/');
                const runtimeIndex = pathParts.indexOf('runtime');
                if (runtimeIndex === -1) return false;

                const devicePath = pathParts.slice(runtimeIndex + 2).join('/');
                return devicePath === libPath;
            });

            if (matchingUrl) {
                // Fetch file content
                const response = await fetch(matchingUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch runtime library file: ${matchingUrl}`);
                }

                const sourceDevicePath = this._extractDevicePathFromRuntimeUrl(matchingUrl);
                const isPythonSource = sourceDevicePath.endsWith('.py');
                const useMpy =
                    preferMpy &&
                    isPythonSource &&
                    !!mpyProfileHash &&
                    !mpySourceExcludes.has(sourceDevicePath);
                const resolvedUrl = useMpy
                    ? this._buildMpyArtifactUrl(matchingUrl, mpyProfileHash)
                    : matchingUrl;

                const resolvedResponse = useMpy ? await fetch(resolvedUrl) : response;
                if (!resolvedResponse.ok) {
                    throw new Error(`Failed to fetch runtime library file: ${resolvedUrl}`);
                }

                const content = useMpy
                    ? new Uint8Array(await resolvedResponse.arrayBuffer())
                    : await resolvedResponse.text();

                // Extract device path from URL
                const devicePath = useMpy
                    ? sourceDevicePath.replace(/\.py$/, '.mpy')
                    : sourceDevicePath;

                preparedLibraries.push({
                    devicePath,
                    url: resolvedUrl,
                    content,
                });
            } else {
                this._log('runtime-library-not-found', { libPath });
            }
        }

        this._preparedFiles.libraries = preparedLibraries;

        this._log('runtime-libraries-preparation-complete', {
            libraryCount: preparedLibraries.length,
        });

        return preparedLibraries.length;
    }

    /**
     * Prepare changed runtime files upload by comparing hashes.
     * @private
     * @param {DeviceRuntime} runtime - Runtime with resolvedFilesystem
     * @param {Object<string, string>} deviceHashes - Existing device file hashes
     * @returns {Promise<number>} Count of changed files to upload
     */
    async _prepareChangedRuntimeFilesUpload(
        runtime: DeviceRuntimeLike,
        deviceHashes: Record<string, string>,
        options: {
            preserveCollection?: boolean;
            mpyProfileHash?: string | null;
            preferMpy?: boolean;
        } = {}
    ): Promise<number> {
        const filesystem = runtime.resolvedFilesystem || [];
        const { preserveCollection = false, mpyProfileHash = null, preferMpy = false } = options;
        const mpySourceExcludes = this._getRuntimeMpySourceExcludes(runtime);

        const preparedFiles = [];

        this._log('comparing-file-hashes', { totalFiles: filesystem.length });

        for (const sourceUrl of filesystem) {
            const sourcePath = this._extractDevicePathFromRuntimeUrl(sourceUrl);
            const isPythonSource = sourcePath.endsWith('.py');
            const useMpy =
                preferMpy &&
                isPythonSource &&
                typeof mpyProfileHash === 'string' &&
                !mpySourceExcludes.has(sourcePath);
            const fileUrl = useMpy
                ? this._buildMpyArtifactUrl(sourceUrl, mpyProfileHash)
                : sourceUrl;

            // Fetch file content
            const response = await fetch(fileUrl);
            if (!response.ok) {
                this._log('fetch-failed-skipping', { url: fileUrl });
                continue;
            }

            const content = useMpy
                ? new Uint8Array(await response.arrayBuffer())
                : await response.text();

            const devicePath = useMpy ? sourcePath.replace(/\.py$/, '.mpy') : sourcePath;

            if (preserveCollection && devicePath === 'app/main_loop.py') {
                this._log('runtime-file-skipped-preserve-collection', { devicePath });
                continue;
            }

            // Use HashManifestManager to prepare file and stage its hash
            const { hash: localHash } = await this._hashManager.prepareFile(
                'runtime',
                devicePath,
                content
            );
            const deviceHash = deviceHashes[devicePath];

            // Check if file changed by comparing against actual device hash
            if (localHash !== deviceHash) {
                preparedFiles.push({
                    devicePath,
                    url: fileUrl,
                    content,
                    hash: localHash,
                    deviceHash: deviceHash || 'none',
                });
            }
        }

        this._preparedFiles.runtime = preparedFiles;

        this._log('changed-files-preparation-complete', {
            changedFiles: preparedFiles.length,
            totalFiles: filesystem.length,
            unchangedFiles: filesystem.length - preparedFiles.length,
            preserveCollection,
        });

        return preparedFiles.length;
    }

    /**
     * Prepare runtime installation by building file lists.
     * This method performs all network fetches and calculations upfront.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Installation options
     * @returns {Promise<Object>} Preparation result with file counts
     * @returns {number} return.totalFiles - Total number of files to upload
     * @returns {number} return.toolsCount - Number of tools files
     * @returns {number} return.runtimeCount - Number of runtime files
     * @returns {number} return.libsCount - Number of library files
     */
    async prepareInstall(
        runtimeId: string,
        options: Record<string, unknown> = {}
    ): Promise<{
        totalFiles: number;
        toolsCount: number;
        runtimeCount: number;
        libsCount: number;
    }> {
        const runtime = this._runtimeCollection.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        this._log('prepare-install-start', { runtimeId });

        const mpyProfile = (options.mpyCompileProfile || null) as MpyCompileProfileLike | null;
        const mpyAvailability = (options.mpyAvailability || null) as MpyAvailabilityLike | null;
        const mpyHash = typeof mpyProfile?.hash === 'string' ? mpyProfile.hash : null;

        // Prepare tools (empty device hashes = upload all)
        const toolsCount = await this._prepareToolsUpload(
            '/device/tools',
            {},
            {
                mpyProfileHash: mpyHash,
                preferMpy: mpyAvailability?.tools?.hasProfile === true,
            }
        );

        // Prepare runtime files
        const runtimeCount = await this._prepareRuntimeFilesUpload(runtime, {
            mpyProfileHash: mpyHash,
            preferMpy: mpyAvailability?.runtime?.hasProfile === true,
        });

        // Prepare base libraries
        (
            runtime as unknown as {
                __mpyOptions?: { preferMpy?: boolean; mpyProfileHash?: string | null };
            }
        ).__mpyOptions = {
            preferMpy: mpyAvailability?.runtime?.hasProfile === true,
            mpyProfileHash: mpyHash,
        };
        const libsCount = await this._prepareNodeLibrariesUpload(runtime);

        const totalFiles = toolsCount + runtimeCount + libsCount;

        this._log('prepare-install-complete', {
            toolsCount,
            runtimeCount,
            libsCount,
            totalFiles,
        });

        return { totalFiles, toolsCount, runtimeCount, libsCount };
    }

    /**
     * Prepare runtime upgrade by identifying changed files.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Upgrade options
     * @returns {Promise<Object>} Preparation result with file counts
     */
    async prepareUpgrade(
        runtimeId: string,
        options: {
            preserveCollection?: boolean;
            mpyCompileProfile?: MpyCompileProfileLike;
            mpyAvailability?: MpyAvailabilityLike;
        } = {}
    ): Promise<{ totalFiles: number; toolsCount: number; runtimeCount: number }> {
        const { preserveCollection = true } = options;
        const runtime = this._runtimeCollection.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        this._log('prepare-upgrade-start', { runtimeId });

        // Load hash manifest from device. If missing, create empty one
        // (which will cause full upload on first sync).
        await this._hashManager.load();
        if (!this._hashManager.isLoaded()) {
            this._hashManager.createEmpty();
        }

        // Get device hashes from hash manager
        const deviceRuntimeHashes = this._hashManager.getFiles('runtime');
        const deviceToolsHashes = this._hashManager.getFiles('tools');

        const mpyHash =
            typeof options.mpyCompileProfile?.hash === 'string'
                ? options.mpyCompileProfile.hash
                : null;

        // Prepare only changed files
        const runtimeCount = await this._prepareChangedRuntimeFilesUpload(
            runtime,
            deviceRuntimeHashes,
            {
                preserveCollection,
                mpyProfileHash: mpyHash,
                preferMpy: options.mpyAvailability?.runtime?.hasProfile === true,
            }
        );
        const toolsCount = await this._prepareToolsUpload('/device/tools', deviceToolsHashes, {
            mpyProfileHash: mpyHash,
            preferMpy: options.mpyAvailability?.tools?.hasProfile === true,
        });

        const totalFiles = toolsCount + runtimeCount;

        this._log('prepare-upgrade-complete', {
            toolsCount,
            runtimeCount,
            totalFiles,
            preserveCollection,
        });

        return { totalFiles, toolsCount, runtimeCount };
    }

    /**
     * Prepare runtime refresh by building full runtime file list.
     * @param {string} runtimeId - Runtime identifier
     * @param {Object} options - Refresh options
     * @returns {Promise<Object>} Preparation result with file counts
     */
    async prepareRefresh(
        runtimeId: string,
        options: {
            preserveCollection?: boolean;
            mpyCompileProfile?: MpyCompileProfileLike;
            mpyAvailability?: MpyAvailabilityLike;
        } = {}
    ): Promise<{ totalFiles: number; runtimeCount: number; libsCount: number }> {
        const { preserveCollection = true } = options;
        const runtime = this._runtimeCollection.getRuntime(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime not found: ${runtimeId}`);
        }

        this._log('prepare-refresh-start', { runtimeId });

        const mpyHash =
            typeof options.mpyCompileProfile?.hash === 'string'
                ? options.mpyCompileProfile.hash
                : null;

        // Prepare runtime files (force overwrite, no hash comparison)
        const runtimeCount = await this._prepareRuntimeFilesUpload(runtime, {
            preserveCollection,
            mpyProfileHash: mpyHash,
            preferMpy: options.mpyAvailability?.runtime?.hasProfile === true,
        });

        // Prepare base libraries
        (
            runtime as unknown as {
                __mpyOptions?: { preferMpy?: boolean; mpyProfileHash?: string | null };
            }
        ).__mpyOptions = {
            preferMpy: options.mpyAvailability?.runtime?.hasProfile === true,
            mpyProfileHash: mpyHash,
        };
        const libsCount = await this._prepareNodeLibrariesUpload(runtime);

        const totalFiles = runtimeCount + libsCount;

        this._log('prepare-refresh-complete', {
            runtimeCount,
            libsCount,
            totalFiles,
            preserveCollection,
        });

        return { totalFiles, runtimeCount, libsCount };
    }

    // ====================
    // Upload Methods (using prepared files)
    // ====================

    /**
     * Upload tools folder to device with hash-based incremental updates.
     *
     * Fetches tools manifest, calculates host-side hashes for all files,
     * compares with device hashes, and uploads only changed files.
     *
     * @private
     * @param {string} toolsBaseUrl - Base URL for tools (e.g., '/device/tools')
     * @param {Object<string, string>} deviceHashes - Existing device file hashes
     * @returns {Promise<number>} Count of uploaded files
     * @throws {Error} If manifest fetch fails or file upload fails
     */
    async _uploadToolsFolder(
        toolsBaseUrl: string,
        deviceHashes: Record<string, string>
    ): Promise<number> {
        // Legacy method - delegates to preparation and upload
        const count = await this._prepareToolsUpload(toolsBaseUrl, deviceHashes);
        if (count > 0) {
            await this._uploadPreparedTools();
        }
        return count;
    }

    /**
     * Upload tools files from prepared list.
     * Must call _prepareToolsUpload() first.
     * @private
     * @returns {Promise<Object>} Upload result with counts
     */
    async _uploadPreparedTools() {
        const filesToUpload = this._preparedFiles.tools;

        if (filesToUpload.length === 0) {
            this._log('tools-no-files-to-upload');
            return { uploadCount: 0, skippedCount: 0 };
        }

        const batchTracker = new ProgressTracker('tools-upload', filesToUpload.length);
        batchTracker.start(`Uploading ${filesToUpload.length} tools files...`);

        try {
            let uploadCount = 0;

            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                const fileIndex = i + 1;

                batchTracker.update(
                    `Uploading ${file.devicePath} (${fileIndex}/${filesToUpload.length})`,
                    fileIndex
                );

                await this._uploadFile(file.url, file.devicePath, file.content);
                uploadCount++;

                this._log('tools-file-uploaded', {
                    relativePath: file.relativePath,
                    devicePath: file.devicePath,
                    hash: file.hash.substring(0, 8),
                });
            }

            batchTracker.complete(`Successfully uploaded ${uploadCount} tools files`);

            // Note: Tools hashes already staged during preparation
            // They will be committed to manifest after all uploads succeed

            this._log('tools-upload-complete', {
                uploadedFiles: uploadCount,
            });

            return { uploadCount, skippedCount: 0 };
        } catch (error) {
            batchTracker.error('Failed to upload tools files', error);
            throw error;
        }
    }

    _extractDevicePathFromRuntimeUrl(fileUrl: string): string {
        const urlObj = new URL(fileUrl, window.location.origin);
        const pathParts = urlObj.pathname.split('/');
        const runtimeIndex = pathParts.indexOf('runtime');
        if (runtimeIndex === -1 || runtimeIndex + 2 >= pathParts.length) {
            throw new Error(`Invalid runtime file URL: ${fileUrl}`);
        }
        return pathParts.slice(runtimeIndex + 2).join('/');
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

    _getRuntimeMpySourceExcludes(runtime: DeviceRuntimeLike): Set<string> {
        const rawList = runtime?.manifest?.mpySourceExcludes;
        if (!Array.isArray(rawList)) {
            return new Set<string>();
        }

        const normalized = rawList
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry) => !!entry)
            .map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, ''));

        return new Set<string>(normalized);
    }

    /**
     * Upload runtime files to device.
     * Fetches files via HTTP from webserver using runtime.resolvedFilesystem URLs.
     * @private
     * @param {DeviceRuntime} runtime
     */
    async _uploadRuntimeFiles(runtime: DeviceRuntimeLike): Promise<number> {
        // Legacy method - delegates to preparation and upload
        await this._prepareRuntimeFilesUpload(runtime);
        return await this._uploadPreparedRuntimeFiles();
    }

    /**
     * Upload runtime files from prepared list.
     * Must call _prepareRuntimeFilesUpload() first.
     * @private
     * @returns {Promise<number>} Number of files uploaded
     */
    async _uploadPreparedRuntimeFiles() {
        const filesToUpload = this._preparedFiles.runtime;

        if (filesToUpload.length === 0) {
            this._log('runtime-no-files-to-upload');
            return 0;
        }

        const batchTracker = new ProgressTracker('runtime-files-upload', filesToUpload.length);
        batchTracker.start(`Uploading ${filesToUpload.length} runtime files...`);

        try {
            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                const fileIndex = i + 1;

                batchTracker.update(
                    `Uploading ${file.devicePath} (${fileIndex}/${filesToUpload.length})`,
                    fileIndex
                );

                await this._uploadFile(file.url, file.devicePath, file.content);
            }

            batchTracker.complete(`Successfully uploaded ${filesToUpload.length} runtime files`);

            // Note: Runtime hashes already staged during preparation
            // They will be committed to manifest after all uploads succeed

            this._log('runtime-files-uploaded', { count: filesToUpload.length });

            return filesToUpload.length;
        } catch (error) {
            batchTracker.error('Failed to upload runtime files', error);
            throw error;
        }
    }

    /**
     * Upload runtime base node libraries to device.
     * Only uploads libraries declared in manifest.nodeLibraries.alwaysInclude.
     * This method is collection-independent and used during runtime installation.
     *
     * @private
     * @param {DeviceRuntime} runtime - Runtime with manifest containing alwaysInclude libraries
     */
    async _uploadRuntimeNodeLibraries(runtime: DeviceRuntimeLike): Promise<number> {
        // Legacy method - delegates to preparation and upload
        await this._prepareNodeLibrariesUpload(runtime);
        return await this._uploadPreparedLibraries();
    }

    /**
     * Upload runtime base libraries from prepared list.
     * Must call _prepareNodeLibrariesUpload() first.
     * @private
     * @returns {Promise<number>} Number of files uploaded
     */
    async _uploadPreparedLibraries() {
        const filesToUpload = this._preparedFiles.libraries;

        if (filesToUpload.length === 0) {
            this._log('runtime-no-base-libraries');
            return 0;
        }

        const batchTracker = new ProgressTracker('runtime-libraries-upload', filesToUpload.length);
        batchTracker.start(`Uploading ${filesToUpload.length} base libraries...`);

        try {
            for (let i = 0; i < filesToUpload.length; i++) {
                const file = filesToUpload[i];
                const fileIndex = i + 1;

                batchTracker.update(
                    `Uploading ${file.devicePath} (${fileIndex}/${filesToUpload.length})`,
                    fileIndex
                );

                await this._uploadFile(file.url, file.devicePath, file.content);
            }

            batchTracker.complete(`Successfully uploaded ${filesToUpload.length} base libraries`);
            this._log('runtime-base-libraries-uploaded', { count: filesToUpload.length });

            return filesToUpload.length;
        } catch (error) {
            batchTracker.error('Failed to upload runtime libraries', error);
            throw error;
        }
    }

    /**
     * Upload only changed runtime files.
     * @private
     * @param {DeviceRuntime} runtime
     * @param {Object<string, string>} deviceHashes
     * @returns {Promise<number>} Count of uploaded files
     */
    async _uploadChangedRuntimeFiles(
        runtime: DeviceRuntimeLike,
        deviceHashes: Record<string, string>
    ): Promise<number> {
        // Legacy method - delegates to preparation and upload
        const count = await this._prepareChangedRuntimeFilesUpload(runtime, deviceHashes);
        if (count > 0) {
            await this._uploadPreparedRuntimeFiles();
        }
        return count;
    }

    /**
     * Preserve collection data from device.
     * @private
     * @returns {Promise<Object|null>}
     */
    async _preserveCollectionData(
        runtime: DeviceRuntimeLike
    ): Promise<PreservedCollectionData | null> {
        const preserved: PreservedCollectionData = {
            libraries: [],
        };

        try {
            preserved.metadata = await this._downloadFile('collection/node_graph_cln.json');
        } catch (error) {
            this._log('collection-metadata-not-found', { error: toErrorMessage(error) });
        }

        try {
            preserved.mainLoop = await this._downloadFile('app/main_loop.py');
        } catch (error) {
            this._log('collection-main-loop-not-found', { error: toErrorMessage(error) });
        }

        const runtimeManagedPaths = this._getRuntimeManagedPaths(runtime);
        const collectionLibraryPaths = await this._listCollectionLibraryPaths(runtimeManagedPaths);

        for (const path of collectionLibraryPaths) {
            try {
                const content = await this._downloadFile(path);
                preserved.libraries.push({ path, content });
            } catch (error) {
                this._log('collection-library-preserve-failed', {
                    path,
                    error: toErrorMessage(error),
                });
            }
        }

        if (!preserved.metadata && !preserved.mainLoop && preserved.libraries.length === 0) {
            this._log('collection-data-not-found', { message: 'No collection files to preserve' });
            return null;
        }

        return preserved;
    }

    _getRuntimeManagedPaths(runtime: DeviceRuntimeLike): Set<string> {
        const managedPaths = new Set<string>();
        const filesystem = runtime?.resolvedFilesystem || [];

        for (const fileUrl of filesystem) {
            try {
                const urlObj = new URL(fileUrl, window.location.origin);
                const pathParts = urlObj.pathname.split('/');
                const runtimeIndex = pathParts.indexOf('runtime');
                if (runtimeIndex === -1 || runtimeIndex + 2 >= pathParts.length) {
                    continue;
                }
                const devicePath = pathParts.slice(runtimeIndex + 2).join('/');
                managedPaths.add(devicePath);
            } catch (error) {
                this._log('runtime-managed-path-parse-failed', {
                    fileUrl,
                    error: toErrorMessage(error),
                });
            }
        }

        return managedPaths;
    }

    async _listCollectionLibraryPaths(runtimeManagedPaths: Set<string>): Promise<string[]> {
        if (typeof this._deviceConnection.listFiles !== 'function') {
            this._log('collection-library-list-unsupported');
            return [];
        }

        const discovered: string[] = [];
        const directories: string[] = ['/libs'];

        while (directories.length > 0) {
            const currentDir = directories.pop();
            if (!currentDir) {
                continue;
            }

            let entries: Array<{ name: string; type: 'file' | 'dir' | 'unknown' }> = [];
            try {
                entries = await this._deviceConnection.listFiles(currentDir);
            } catch (error) {
                this._log('collection-library-list-failed', {
                    path: currentDir,
                    error: toErrorMessage(error),
                });
                continue;
            }

            for (const entry of entries) {
                const fullPath = `${currentDir}/${entry.name}`;

                if (entry.type === 'dir') {
                    directories.push(fullPath);
                    continue;
                }

                if (entry.type !== 'file') {
                    continue;
                }

                const normalizedPath = fullPath.replace(/^\/+/, '');
                if (runtimeManagedPaths.has(normalizedPath)) {
                    continue;
                }

                discovered.push(normalizedPath);
            }
        }

        return discovered;
    }

    /**
     * Restore collection data to device.
     * @private
     * @param {Object} data
     */
    async _restoreCollectionData(data: PreservedCollectionData | null): Promise<void> {
        if (!data) return;

        try {
            if (data.metadata) {
                await this._uploadFile(
                    'node_graph_cln.json',
                    'collection/node_graph_cln.json',
                    data.metadata
                );
            }
            if (data.mainLoop) {
                await this._uploadFile('main_loop.py', 'app/main_loop.py', data.mainLoop);
            }
            for (const library of data.libraries || []) {
                await this._uploadFile(library.path, library.path, library.content);
            }
            this._log('collection-data-restored');
        } catch (error) {
            this._log('collection-data-restore-failed', { error: toErrorMessage(error) });
        }
    }

    // ========================================================================
    // Sync Manifest Management
    // ========================================================================

    /**
     * Write device.json marker file for version detection.
     * This file acts as a quick version marker read by listInstalled().
     * Preserves existing fields (targetId, targetConfigPath, etc.) if present.
     * @private
     * @param {DeviceRuntime} runtime
     */
    async _writeDeviceMarker(runtime: DeviceRuntimeLike): Promise<void> {
        // Read existing device.json if it exists to preserve target info
        let deviceInfo: Record<string, unknown> = {};
        try {
            const existingJson = await this._deviceConnection.readTextFile('/device.json');
            deviceInfo = parseJsonFromDeviceText<Record<string, unknown>>(existingJson);
            this._log('device-marker-existing-read', { existing: deviceInfo });
        } catch (error) {
            // File doesn't exist or is malformed - create new
            this._log('device-marker-no-existing', { error: toErrorMessage(error) });
        }

        // Update/add runtime fields while preserving other fields
        deviceInfo.runtime = runtime.id;
        deviceInfo.version = runtime.version;
        deviceInfo.timestamp = Date.now();

        const deviceJson = JSON.stringify(deviceInfo, null, 2);
        await this._deviceConnection.writeTextFile('/device.json', deviceJson);
        this._log('device-marker-written', {
            runtimeId: runtime.id,
            version: runtime.version,
            preserved: Object.keys(deviceInfo).filter(
                (k) => !['runtime', 'version', 'timestamp'].includes(k)
            ),
        });
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
            await this._removeConflictingPySourceForMpy(remotePath);

            // Use MicroPythonProtocol file upload
            await this._deviceConnection.sendFile(remotePath, content);

            this._log('upload-complete', { localPath, remotePath });
        } catch (error) {
            this._log('upload-failed', {
                localPath,
                remotePath,
                error: toErrorMessage(error),
            });
            throw new Error(`Failed to upload ${localPath}: ${toErrorMessage(error)}`);
        }
    }

    async _removeConflictingPySourceForMpy(remotePath: string): Promise<void> {
        if (typeof remotePath !== 'string' || !remotePath.endsWith('.mpy')) {
            return;
        }

        const sourcePath = remotePath.replace(/\.mpy$/, '.py');
        try {
            await this._deviceConnection.deleteFile(sourcePath);
            this._log('mpy-source-removed-before-upload', { sourcePath, mpyPath: remotePath });
        } catch (error) {
            // Source may not exist yet; continue with MPY upload.
            this._log('mpy-source-remove-skipped', {
                sourcePath,
                mpyPath: remotePath,
                error: toErrorMessage(error),
            });
        }
    }

    /**
     * Download a file from the device.
     * @private
     * @param {string} remotePath - Device file path
     * @returns {Promise<string>} File content
     */
    async _downloadFile(remotePath: string): Promise<string> {
        this._log('download-start', { remotePath });

        try {
            const content = await this._deviceConnection.readTextFile(remotePath);

            this._log('download-complete', {
                remotePath,
                size: content.length,
            });

            return content;
        } catch (error) {
            this._log('download-failed', {
                remotePath,
                error: toErrorMessage(error),
            });
            throw new Error(`Failed to download ${remotePath}: ${toErrorMessage(error)}`);
        }
    }

    // ========================================================================
    // Logging & Utilities
    // ========================================================================

    /**
     * Log a message with consistent formatting.
     * @private
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
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
            scopedGlobal.__microOtterLog.log('RuntimeDeployment', reason, level, ...payloadData);
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
