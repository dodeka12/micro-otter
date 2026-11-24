// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Firmware module plan — the single source of truth for the up-to-date state of every
 * library file a node graph needs during a collection deploy.
 *
 * One function, {@link resolveFirmwareModulePlan}, answers every question the deploy asks
 * about firmware-bundled modules from one set of inputs:
 *
 * - which files must be uploaded from the host (`uploadPaths`),
 * - which files the firmware provides and must never be uploaded or stale-deleted
 *   (`firmwareProvidedPaths`),
 * - which packages must be shadowed as a whole by host source, and why (`shadowPackages`),
 * - which package folders are entirely firmware-owned (`firmwareOwnedPackageIds`),
 * - which files cannot be deployed at all because the host lacks them (`blockedPaths`).
 *
 * A package is only "current" when *both* conditions hold: the firmware-bundled version is at
 * least the host version **and** the firmware inventory lists every needed file. A bundled
 * package whose version is fine but whose inventory misses a needed file is classified
 * `firmware-incomplete` and shadowed as a whole, exactly like an outdated package — this is
 * what used to be a hard "Deployment blocked" error. A firmware version that is missing or
 * not strict `x.y.z` semver is never accepted as evidence of currency; it is classified
 * `firmware-unknown` and shadowed.
 *
 * Version equality alone is not proof of identical bytes: a firmware built from a different
 * revision of the same version string ships different files. `firmware-content-mismatch` is the
 * reason for that case. It is produced by the device-side content probe
 * (`DeviceDeployment._probeEmbeddedContentMismatches`), never by
 * {@link resolveFirmwareModulePlan}, because comparing bytes needs the device connection.
 *
 * The module is pure: every input is passed in, nothing is read from device state, and the
 * host-side file lookup is injected as `hostHasPath` so callers keep their own URL resolution.
 *
 * @module embedded-module-plan
 */

import {
    isFirmwareProvidedModule,
    resolveFirmwareInventoryPath,
} from './deployment-utils.js';

/** A semver comparison between a firmware-bundled package version and the host version. */
export type VersionComparison = 'device-newer' | 'same' | 'host-newer' | 'unknown';

/** Up-to-date state of one declared library path. */
export type FirmwareModuleState =
    | 'host-only'
    | 'firmware-current'
    | 'firmware-outdated'
    | 'firmware-unknown'
    | 'firmware-incomplete'
    | 'firmware-content-mismatch'
    | 'host-missing';

/** A package the firmware does not fully provide and that must be shadowed by host source. */
export type ShadowPackageState =
    | 'firmware-outdated'
    | 'firmware-unknown'
    | 'firmware-incomplete'
    | 'firmware-content-mismatch';

export const FIRMWARE_CURRENT: FirmwareModuleState = 'firmware-current';
export const FIRMWARE_OUTDATED: FirmwareModuleState = 'firmware-outdated';
export const FIRMWARE_UNKNOWN: FirmwareModuleState = 'firmware-unknown';
export const FIRMWARE_INCOMPLETE: FirmwareModuleState = 'firmware-incomplete';
export const FIRMWARE_CONTENT_MISMATCH: FirmwareModuleState = 'firmware-content-mismatch';
export const HOST_ONLY: FirmwareModuleState = 'host-only';
export const HOST_MISSING: FirmwareModuleState = 'host-missing';

/** Inputs to {@link resolveFirmwareModulePlan}. */
export interface FirmwareModulePlanInput {
    /** Whether the runtime is embedded (firmware bundles packages). */
    embeddedMode: boolean;
    /** Library paths the node graph needs (`allLibraries`), before shadow expansion. */
    declaredPaths: Iterable<string>;
    /** Declared path → owning node package id (empty string for host-only paths). */
    pathToPackageId: ReadonlyMap<string, string>;
    /** Package id → complete declared `.py` asset paths (used for whole-package shadowing). */
    packageAssetPaths: ReadonlyMap<string, readonly string[]>;
    /** Package ids bundled in the firmware. */
    globalPackageIds: ReadonlySet<string>;
    /** Global package ids the collection uses (package-level, even with no mpAssets). */
    inScopePackageIds?: ReadonlySet<string>;
    /** Firmware inventory paths of embedded-source files, or null when unreadable. */
    inventoryPaths: ReadonlySet<string> | null;
    /** Package id → firmware-bundled version, or null when no version source is known. */
    firmwareVersions: ReadonlyMap<string, string | null> | null;
    /** Package id → host version (from the runtime's node package manifests). */
    hostVersions: ReadonlyMap<string, string | null>;
    /** Whether the host can provide a declared path as uploadable source. */
    hostHasPath: (path: string) => boolean;
    /** Paths the user already approved for shadowing (consent gate). */
    approvedOverrides?: ReadonlySet<string>;
    /** Module-root folders to delete (a frozen variant's stale other-variant folders). */
    stalePackageFolders?: ReadonlySet<string>;
}

/** The plan's answer for one declared library path. */
export interface FirmwareModuleDecision {
    /** Declared `.py` library path. */
    path: string;
    /** Owning node package id, or null when the path is not package-owned. */
    packageId: string | null;
    /** Up-to-date state for this path. */
    state: FirmwareModuleState;
    /** Firmware-bundled package version, or null when unknown. */
    deviceVersion: string | null;
    /** Host package version, or null when unknown. */
    hostVersion: string | null;
    /** Matched firmware inventory path (`.py` or `.mpy` spelling), or null. */
    inventoryPath: string | null;
}

/** The result of {@link resolveFirmwareModulePlan}. */
export interface FirmwareModulePlan {
    /** Decision per planned path (declared plus whole-package shadow expansion). */
    byPath: ReadonlyMap<string, FirmwareModuleDecision>;
    /** Every planned path (declared plus whole-package shadow expansion). */
    allPlannedPaths: ReadonlySet<string>;
    /** Declared `.py` paths to fetch and upload from the host, sorted. */
    uploadPaths: ReadonlySet<string>;
    /** Paths the firmware demonstrably provides (inventory-confirmed, `.py` or `.mpy`). */
    firmwareProvidedPaths: ReadonlySet<string>;
    /** Package id → why it is shadowed (only shadow packages are present). */
    shadowPackages: ReadonlyMap<string, ShadowPackageState>;
    /** Global packages whose every needed file is firmware-provided (folder cleanup). */
    firmwareOwnedPackageIds: ReadonlySet<string>;
    /** Every package id the firmware provides (built-ins plus frozen add-ons). */
    packageProvidedIds: ReadonlySet<string>;
    /** Module-root folders to delete (frozen variant's stale other-variant folders). */
    stalePackageFolders: ReadonlySet<string>;
    /** Paths that cannot be deployed because neither firmware nor host provides them. */
    blockedPaths: readonly string[];
}

/** Strict `x.y.z` with optional `-prerelease` / `+build` (mirrors the firmware grammar). */
const SEMVER_RE =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface ParsedSemver {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[] | null;
}

/**
 * Parse a strict semver string into its numeric core and prerelease identifiers.
 *
 * Mirrors the firmware build's ``version_semver`` grammar so a version that is invalid there is
 * also invalid here. Build metadata is accepted but ignored.
 *
 * @param {string | null | undefined} value - Version string to parse.
 * @returns {ParsedSemver | null} Parsed version, or null when the value is not strict semver.
 */
export function parseSemver(value: string | null | undefined): ParsedSemver | null {
    if (typeof value !== 'string') {
        return null;
    }
    const match = SEMVER_RE.exec(value.trim());
    if (!match) {
        return null;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split('.') : null,
    };
}

/**
 * Compare two strict semver versions.
 *
 * @param {string | null | undefined} deviceVersion - Firmware-bundled version.
 * @param {string | null | undefined} hostVersion - Host version.
 * @returns {VersionComparison} `host-newer` when host > device, `device-newer` when device > host,
 *   `same` when equal, `unknown` when either side is not strict semver.
 */
export function compareVersions(
    deviceVersion: string | null | undefined,
    hostVersion: string | null | undefined
): VersionComparison {
    const device = parseSemver(deviceVersion);
    const host = parseSemver(hostVersion);
    if (!device || !host) {
        return 'unknown';
    }

    const core =
        device.major !== host.major
            ? device.major - host.major
            : device.minor !== host.minor
              ? device.minor - host.minor
              : device.patch - host.patch;
    if (core !== 0) {
        return core < 0 ? 'host-newer' : 'device-newer';
    }

    const pre = _comparePrerelease(device.prerelease, host.prerelease);
    if (pre < 0) {
        return 'host-newer';
    }
    if (pre > 0) {
        return 'device-newer';
    }
    return 'same';
}

/**
 * Compare two prerelease identifier lists per semver precedence (no prerelease sorts higher).
 *
 * @param {string[] | null} a - Left prerelease identifiers.
 * @param {string[] | null} b - Right prerelease identifiers.
 * @returns {number} Negative when `a` sorts before `b`, positive when after, zero when equal.
 */
function _comparePrerelease(a: string[] | null, b: string[] | null): number {
    if (a === null && b === null) {
        return 0;
    }
    if (a === null) {
        return 1; // a is a release, b is a prerelease → a is newer
    }
    if (b === null) {
        return -1;
    }

    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const aNum = /^\d+$/.test(a[i]);
        const bNum = /^\d+$/.test(b[i]);
        if (aNum && bNum) {
            const diff = Number(a[i]) - Number(b[i]);
            if (diff !== 0) {
                return diff;
            }
        } else if (aNum !== bNum) {
            // Numeric identifiers always sort before alphanumeric ones.
            return aNum ? -1 : 1;
        } else {
            const diff = a[i] < b[i] ? -1 : a[i] > b[i] ? 1 : 0;
            if (diff !== 0) {
                return diff;
            }
        }
    }
    return a.length - b.length;
}


const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const SHADOW_STATES: ReadonlySet<FirmwareModuleState> = new Set<FirmwareModuleState>([
    FIRMWARE_OUTDATED,
    FIRMWARE_UNKNOWN,
    FIRMWARE_INCOMPLETE,
    FIRMWARE_CONTENT_MISMATCH,
]);

/**
 * Compute the firmware module plan for one deploy.
 *
 * The classification is per package first (shadow packages shadow every one of their files),
 * then per path. See the module docstring for the rules.
 *
 * @param {FirmwareModulePlanInput} input - Plan inputs.
 * @returns {FirmwareModulePlan} The resolved plan.
 */
export function resolveFirmwareModulePlan(input: FirmwareModulePlanInput): FirmwareModulePlan {
    const {
        embeddedMode,
        declaredPaths,
        pathToPackageId,
        packageAssetPaths,
        globalPackageIds,
        inScopePackageIds,
        inventoryPaths,
        firmwareVersions,
        hostVersions,
        hostHasPath,
        approvedOverrides,
        stalePackageFolders,
    } = input;

    const approved = approvedOverrides ?? EMPTY_SET;
    const inScope = inScopePackageIds ?? EMPTY_SET;

    // 1. Collect the declared paths once, in stable order. Approved overrides that no package
    //    asset declares are host-provided, so they must still be planned (and host-checked).
    const declared = new Set<string>();
    for (const path of declaredPaths) {
        if (typeof path === 'string' && path) {
            declared.add(path);
        }
    }
    for (const path of approved) {
        if (typeof path === 'string' && path) {
            declared.add(path);
        }
    }

    // 2. Determine which global packages are referenced by the plan or explicitly approved.
    //    Only meaningful in embedded mode: a dynamic runtime has no firmware-bundled packages.
    const scopedPackageIds = new Set<string>();
    if (embeddedMode) {
        for (const pkg of inScope) {
            if (globalPackageIds.has(pkg)) {
                scopedPackageIds.add(pkg);
            }
        }
        for (const path of declared) {
            const pkg = pathToPackageId.get(path);
            if (pkg && globalPackageIds.has(pkg)) {
                scopedPackageIds.add(pkg);
            }
        }
        for (const [pkg, assets] of packageAssetPaths) {
            if (!globalPackageIds.has(pkg)) {
                continue;
            }
            if (assets.some((path) => approved.has(path))) {
                scopedPackageIds.add(pkg);
            }
        }
    }

    // 3. Resolve the package-level verdict for every global package in scope.
    const packageStates = new Map<string, FirmwareModuleState>();
    for (const packageId of scopedPackageIds) {
        const assets = packageAssetPaths.get(packageId) ?? [];
        const neededPaths = assets.filter((path) => declared.has(path));
        const approvedForPackage = assets.some((path) => approved.has(path));

        let state: FirmwareModuleState;
        if (approvedForPackage) {
            // The consent gate already approved shadowing this package.
            state = FIRMWARE_OUTDATED;
        } else if (!embeddedMode || firmwareVersions === null) {
            state = FIRMWARE_UNKNOWN;
        } else {
            const deviceVersion = firmwareVersions.get(packageId) ?? null;
            const hostVersion = hostVersions.get(packageId) ?? null;
            const comparison = compareVersions(deviceVersion, hostVersion);
            if (comparison === 'unknown') {
                state = FIRMWARE_UNKNOWN;
            } else if (comparison === 'host-newer') {
                state = FIRMWARE_OUTDATED;
            } else if (inventoryPaths === null) {
                // Versions prove the firmware copy is current; an unreadable inventory never
                // upgrades that into a false block.
                state = FIRMWARE_CURRENT;
            } else {
                const missing = neededPaths.some(
                    (path) => !isFirmwareProvidedModule(inventoryPaths, path)
                );
                state = missing ? FIRMWARE_INCOMPLETE : FIRMWARE_CURRENT;
            }
        }
        packageStates.set(packageId, state);
    }



    // 4. Expand shadow packages to their complete asset set, then classify every planned path.
    const plannedPaths = new Set<string>(declared);
    const assetToPackage = new Map<string, string>();
    for (const [pkg, assets] of packageAssetPaths) {
        for (const path of assets) {
            assetToPackage.set(path, pkg);
        }
    }
    const shadowPackages = new Map<string, ShadowPackageState>();
    for (const [packageId, state] of packageStates) {
        if (SHADOW_STATES.has(state)) {
            shadowPackages.set(packageId, state as ShadowPackageState);
            for (const path of packageAssetPaths.get(packageId) ?? []) {
                plannedPaths.add(path);
            }
        }
    }

    const byPath = new Map<string, FirmwareModuleDecision>();
    const uploadPaths = new Set<string>();
    const firmwareProvidedPaths = new Set<string>();
    const blockedPaths: string[] = [];
    const firmwareOwnedPackageIds = new Set<string>();

    for (const path of [...plannedPaths].sort()) {
        const packageId = pathToPackageId.get(path) ?? assetToPackage.get(path) ?? null;
        const deviceVersion =
            packageId && firmwareVersions !== null
                ? (firmwareVersions.get(packageId) ?? null)
                : null;
        const hostVersion = packageId ? (hostVersions.get(packageId) ?? null) : null;
        const inventoryPath = resolveFirmwareInventoryPath(inventoryPaths, path);

        let state: FirmwareModuleState;
        if (embeddedMode && packageId && globalPackageIds.has(packageId)) {
            const packageState = packageStates.get(packageId) ?? FIRMWARE_UNKNOWN;
            state = SHADOW_STATES.has(packageState) ? packageState : FIRMWARE_CURRENT;
        } else {
            state = HOST_ONLY;
        }

        // Any path we would upload must exist on the host; firmware-current paths never upload.
        // Only an inventory-confirmed path authorises deleting the user-space copy.
        if (state === FIRMWARE_CURRENT) {
            if (inventoryPath !== null) {
                firmwareProvidedPaths.add(path);
            }
        } else if (!hostHasPath(path)) {
            if (packageId !== null || approved.has(path)) {
                // A package-owned file or an explicitly-approved override must be deployable;
                // otherwise the deploy is blocked.
                state = HOST_MISSING;
                blockedPaths.push(path);
            } else {
                // An undeclared transitive import the host cannot provide is silently skipped,
                // mirroring the legacy fetch-loop behaviour for best-effort dependencies.
                state = HOST_ONLY;
            }
        } else {
            uploadPaths.add(path);
        }

        byPath.set(path, {
            path,
            packageId,
            state,
            deviceVersion,
            hostVersion,
            inventoryPath,
        });
    }

    // 5. Firmware-owned packages: global, fully firmware-current, with at least one needed file.
    //    Folder removal additionally requires the inventory to confirm every needed file — an
    //    unreadable inventory never authorises deleting the user-space copy.
    for (const packageId of scopedPackageIds) {
        if (packageStates.get(packageId) !== FIRMWARE_CURRENT) {
            continue;
        }
        const needed = (packageAssetPaths.get(packageId) ?? []).filter((path) => declared.has(path));
        if (needed.length === 0 || inventoryPaths === null) {
            continue;
        }
        const allPresent = needed.every((path) => isFirmwareProvidedModule(inventoryPaths, path));
        if (allPresent) {
            firmwareOwnedPackageIds.add(packageId);
        }
    }

    blockedPaths.sort();

    return {
        byPath,
        allPlannedPaths: new Set(byPath.keys()),
        uploadPaths,
        firmwareProvidedPaths,
        shadowPackages,
        firmwareOwnedPackageIds,
        packageProvidedIds: new Set(globalPackageIds),
        stalePackageFolders: new Set(stalePackageFolders ?? EMPTY_SET),
        blockedPaths,
    };
}
