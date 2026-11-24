// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared utilities for deployment operations.
 *
 * Provides host-side file hashing, hash manifest management, and comparison utilities
 * for incremental deployments. All hashing is performed on the host (not device).
 *
 * @module deployment-utils
 */

export type HashManifest = Record<string, string>;

export interface DeviceConnectionLike {
    readTextFile(path: string): Promise<string>;
    ensureDirectory(path: string): Promise<void>;
    writeTextFile(path: string, content: string): Promise<void>;
}

/** The firmware-constituent fields the deploy helpers read. */
export interface FirmwareConstituentVersionsLike {
    nodePackages?: Record<string, string> | null;
    addonPackages?: Record<string, string> | null;
    packageVariants?: Record<string, string> | null;
    frozenAddons?: Record<string, { variant: string; version: string }> | null;
}

/**
 * Return the set of package ids the connected firmware provides.
 *
 * This is the union of the runtime's global package list, the recorded add-on
 * packages, and the frozen add-on record, so a frozen add-on is never reported as
 * "not bundled in firmware".
 */
export function resolveFirmwareBundledPackageIds(
    nodePackagesGlobal: Iterable<string> | null | undefined,
    constituentVersions: FirmwareConstituentVersionsLike | null | undefined
): Set<string> {
    const ids = new Set<string>(nodePackagesGlobal ?? []);
    for (const key of Object.keys(constituentVersions?.nodePackages ?? {})) {
        ids.add(key);
    }
    for (const key of Object.keys(constituentVersions?.addonPackages ?? {})) {
        ids.add(key);
    }
    for (const key of Object.keys(constituentVersions?.frozenAddons ?? {})) {
        ids.add(key);
    }
    return ids;
}

/**
 * Return the frozen add-on version map, preferring the device's own
 * ``frozenAddons`` record and falling back to ``constituentVersions.addonPackages``.
 */
export function resolveFrozenAddonVersions(
    constituentVersions: FirmwareConstituentVersionsLike | null | undefined
): Record<string, string> {
    const frozen = constituentVersions?.frozenAddons ?? {};
    const addons = constituentVersions?.addonPackages ?? {};
    const versions: Record<string, string> = {};
    for (const id of new Set([...Object.keys(addons), ...Object.keys(frozen)])) {
        const record = frozen[id];
        if (record && typeof record.version === 'string') {
            versions[id] = record.version;
        } else if (typeof addons[id] === 'string') {
            versions[id] = addons[id] as string;
        }
    }
    return versions;
}

/**
 * Calculate SHA-256 hash of content (host-side only).
 *
 * @param {string|Uint8Array} content - Content to hash
 * @returns {Promise<string>} Hex-encoded SHA-256 hash string (64 characters)
 * @throws {Error} If Web Crypto API is unavailable
 * @example
 * const hash = await calculateFileHash('test content');
 * // Returns: '6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72'
 */
export async function calculateFileHash(content: string | Uint8Array): Promise<string> {
    if (!crypto || !crypto.subtle) {
        throw new Error('Web Crypto API not available');
    }

    const encoder = new TextEncoder();
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const digestInput = data as unknown as BufferSource;

    const hashBuffer = await crypto.subtle.digest('SHA-256', digestInput);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download hash manifest from device.
 *
 * Uses native MicroPython file operations (no tools module dependency).
 * Returns empty object if manifest doesn't exist or read fails.
 *
 * @param {DeviceConnection} deviceConnection - Device connection instance
 * @param {string} devicePath - Path on device (e.g., 'tools/hashes.json')
 * @returns {Promise<Object<string, string>>} Map of relative path → hash (empty if not found)
 * @example
 * const hashes = await downloadHashManifest(deviceConnection, 'tools/hashes.json');
 * // Returns: { 'fs_utils.py': 'abc123...', 'wifi_manager.py': 'def456...' }
 */
export async function downloadHashManifest(
    deviceConnection: DeviceConnectionLike,
    devicePath: string
): Promise<HashManifest> {
    try {
        const output = await deviceConnection.readTextFile(devicePath);
        const normalized = normalizeDeviceJsonOutput(output, 'MO_HASH_START', 'MO_HASH_END');
        const parsed: unknown = JSON.parse(normalized);
        return toHashManifest(parsed);
    } catch (error) {
        console.warn(
            `[deployment-utils] Failed to download hash manifest ${devicePath}:`,
            getErrorMessage(error)
        );
        return {}; // Force full upload on error
    }
}

function normalizeDeviceJsonOutput(output: string | null | undefined, startMarker: string, endMarker: string): string {
    const text = (output || '').trim();
    let payload = text;

    const startIndex = text.indexOf(startMarker);
    const endIndex = text.indexOf(endMarker);
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        payload = text.slice(startIndex + startMarker.length, endIndex).trim();
    }

    const trimmed = payload.trim();
    if (trimmed.startsWith("b'") && trimmed.endsWith("'")) {
        return trimmed
            .slice(2, -1)
            .replace(/\\r/g, '\r')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }

    return trimmed || '{}';
}

function toHashManifest(value: unknown): HashManifest {
    if (!isHashManifest(value)) {
        return {};
    }

    return value;
}

function isHashManifest(value: unknown): value is HashManifest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    for (const [key, item] of Object.entries(value)) {
        if (typeof key !== 'string' || typeof item !== 'string') {
            return false;
        }
    }

    return true;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

/**
 * Upload hash manifest to device.
 *
 * Uses native MicroPython file operations (no tools module dependency).
 * Automatically creates parent directories if they don't exist.
 *
 * @param {DeviceConnection} deviceConnection - Device connection instance
 * @param {string} devicePath - Path on device (e.g., 'tools/hashes.json')
 * @param {Object<string, string>} hashes - Map of relative path → hash
 * @returns {Promise<void>}
 * @throws {Error} If write operation fails
 * @example
 * await uploadHashManifest(deviceConnection, 'tools/hashes.json', {
 *     'fs_utils.py': 'abc123...',
 *     'wifi_manager.py': 'def456...'
 * });
 */
export async function uploadHashManifest(
    deviceConnection: DeviceConnectionLike,
    devicePath: string,
    hashes: HashManifest
): Promise<void> {
    const manifestContent = JSON.stringify(hashes, null, 2);

    const pathParts = devicePath.split('/');
    if (pathParts.length > 1) {
        const dirPath = pathParts.slice(0, -1).join('/');
        await deviceConnection.ensureDirectory(dirPath);
    }

    await deviceConnection.writeTextFile(devicePath, manifestContent);
}

/**
 * Compare host and device hashes to determine changed files.
 *
 * A file is considered changed if:
 * - It exists in host hashes but not in device hashes (new file)
 * - Hash values differ between host and device (modified file)
 *
 * Files that exist only on device are ignored (not included in result).
 *
 * @param {Object<string, string>} hostHashes - Host-calculated hashes
 * @param {Object<string, string>} deviceHashes - Device-stored hashes
 * @returns {string[]} Array of relative file paths that changed
 * @example
 * const hostHashes = { 'a.py': 'abc', 'b.py': 'def', 'c.py': 'ghi' };
 * const deviceHashes = { 'a.py': 'abc', 'b.py': 'xyz', 'd.py': 'jkl' };
 * const changed = compareHashes(hostHashes, deviceHashes);
 * // Returns: ['b.py', 'c.py'] (b.py modified, c.py new)
 */
export function compareHashes(hostHashes: HashManifest, deviceHashes: HashManifest): string[] {
    const changedFiles: string[] = [];

    for (const [path, hostHash] of Object.entries(hostHashes)) {
        if (deviceHashes[path] !== hostHash) {
            changedFiles.push(path);
        }
    }

    return changedFiles;
}

/**
 * Resolve the firmware inventory entry that satisfies a declared package module path.
 *
 * Node packages declare their library files as ``.py`` paths, but a firmware built in
 * ``compiled-mpy`` mode reports its embedded inventory as ``.mpy`` paths (``x/y.py`` is
 * frozen as ``x/y.mpy``). Both names denote the same module, so a declared ``.py`` path is
 * considered firmware-provided when the inventory lists either the exact path or its
 * ``.mpy`` alias.
 *
 * @param {ReadonlySet<string> | null} inventoryPaths - Paths the firmware inventory reports,
 *   or `null` when the inventory is unreadable (never treated as provided).
 * @param {string} declaredPath - Library path a node package declares (e.g. ``otter_mqtt/__init__.py``).
 * @returns {string | null} The matching inventory path (the ``.py`` or ``.mpy`` spelling), or
 *   `null` when the firmware does not provide the declared module.
 */
export function resolveFirmwareInventoryPath(
    inventoryPaths: ReadonlySet<string> | null,
    declaredPath: string
): string | null {
    if (inventoryPaths === null) {
        return null;
    }
    if (inventoryPaths.has(declaredPath)) {
        return declaredPath;
    }
    if (declaredPath.endsWith('.py')) {
        const mpyAlias = declaredPath.replace(/\.py$/, '.mpy');
        if (inventoryPaths.has(mpyAlias)) {
            return mpyAlias;
        }
    }
    return null;
}

/**
 * Decide whether a firmware inventory satisfies a declared package module path.
 *
 * See {@link resolveFirmwareInventoryPath} for the ``.py`` / ``.mpy`` alias rules.
 *
 * @param {ReadonlySet<string> | null} inventoryPaths - Paths the firmware inventory reports,
 *   or `null` when the inventory is unreadable (never treated as provided).
 * @param {string} declaredPath - Library path a node package declares (e.g. ``otter_mqtt/__init__.py``).
 * @returns {boolean} True when the firmware provides the declared module.
 */
export function isFirmwareProvidedModule(
    inventoryPaths: ReadonlySet<string> | null,
    declaredPath: string
): boolean {
    return resolveFirmwareInventoryPath(inventoryPaths, declaredPath) !== null;
}
