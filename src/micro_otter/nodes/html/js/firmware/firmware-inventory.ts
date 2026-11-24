// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Client-side model for the server firmware inventory.
 *
 * The server is the single authority for "which images exist" and "which is
 * latest"; this module only decodes its payload and answers two separate
 * questions about it: "can the active collection run on this image?" (see
 * `FirmwareCompatibilityContext`) and "is there already an image for the packages
 * I want to build next?" (see `FirmwareSelection`). The two inputs are distinct
 * types on purpose. No ordering or newest-file picking happens here. The payload
 * shape mirrors ``docs/dev/firmware-compile/firmware-inventory-contract.md``.
 */

/**
 * Runtime id every imported image carries. Mirrors
 * `IMPORTED_RUNTIME_ID` in `.../tools/firmware_compile/imported_firmware.py`, so
 * the two sides cannot drift silently.
 */
export const IMPORTED_RUNTIME_ID = 'imported';

/**
 * Sidecar `source` marker identifying an imported image. Mirrors
 * `IMPORTED_SOURCE` in `.../tools/firmware_compile/imported_firmware.py`.
 */
export const IMPORTED_SOURCE = 'imported-binary';

/** One published firmware image, decoded from a `firmware.list` result. */
export interface FirmwareInventoryEntry {
    path: string;
    filename: string;
    boardId: string;
    runtimeId: string;
    micropythonVersion: string;
    runtimeFirmwareVersion: string;
    contentHash: string | null;
    sizeBytes: number;
    modifiedAt: string;
    hasManifest: boolean;
    embeddedPackages: Record<string, string>;
    notEmbedded: string[];
    addonPackages: Record<string, string>;
    /** Frozen `packageId → variantId`; a v3 sidecar fills it, a v2 one leaves it empty. */
    packageVariants: Record<string, string>;
    selection: Record<string, unknown>;
    channel: string;
    versionSource: string | null;
    isPrerelease: boolean;
    isLatest: boolean;
    isChannelLatest: boolean;
    /** Import provenance marker; `''` for a build image and for older servers. */
    source: string;
    /** The `targetId` the image was imported for; `null` for build images and older servers. */
    targetId: string | null;
    /** The original `.bin` filename supplied at import; `null` otherwise. */
    originalFilename: string | null;
}

/** Result of one `firmware.import` job, decoded from the result's `imported`. */
export interface FirmwareImportResult {
    status: 'installed' | 'already-present';
    filename: string;
    imagePath: string;
    sidecarPath: string | null;
    sha256: string;
    boardKnown: boolean;
}

/** A firmware version split into its base and pre-release tail. */
export interface FirmwareVersionParts {
    base: string;
    preRelease: string | null;
}

/**
 * Split a firmware version at the first `-`, keeping the whole tail verbatim
 * (including any `+build` metadata). Presentation only: the JS side never
 * validates a version.
 */
export function firmwareVersionParts(version: string): FirmwareVersionParts {
    const index = version.indexOf('-');
    if (index === -1) {
        return { base: version, preRelease: null };
    }
    return { base: version.slice(0, index), preRelease: version.slice(index + 1) };
}

/**
 * Return whether an entry is an imported raw binary image.
 *
 * This is the one predicate views use for the imported badge, the board-only
 * listing rule, and the channel-badge suppression. It matches on the imported
 * runtime id or the `imported-binary` source marker, so a legacy payload that
 * carries only one of the two still classifies correctly.
 */
export function isImportedFirmware(entry: FirmwareInventoryEntry): boolean {
    return entry.runtimeId === IMPORTED_RUNTIME_ID || entry.source === IMPORTED_SOURCE;
}

/**
 * How an image's frozen package set compares with everything the target offers.
 *
 * `complete` means the image embeds every node package the target can embed;
 * `partial` means it omits at least one of them; `unknown` means the payloads
 * cannot answer (no sidecar, no package data, or a catalog that is not loaded
 * yet) — then no badge is shown rather than a guessed one.
 */
export type FirmwarePackageCoverage = 'complete' | 'partial' | 'unknown';

/**
 * Return how an image's frozen package set compares with the target's catalog.
 *
 * Reads what the image *actually contains* — `embeddedPackages` for built-in
 * packages plus `addonPackages` for installed add-ons — because that is what the
 * device runs. The sidecar's `selection.packageIds` records the *request*, and
 * staging may drop ids from it, so the selection list alone cannot decide
 * coverage. *availablePackageIds* is the built-in catalog the target offers, so an
 * embedded add-on is extra content and never a gap; an empty catalog means it is
 * not known yet (runtime or target not loaded), and every image answers `unknown`.
 */
export function firmwarePackageCoverage(
    entry: FirmwareInventoryEntry,
    availablePackageIds: readonly string[]
): FirmwarePackageCoverage {
    if (!entry.hasManifest) {
        return 'unknown';
    }
    const available = new Set(
        availablePackageIds.filter((packageId) => typeof packageId === 'string' && packageId !== '')
    );
    if (available.size === 0) {
        return 'unknown';
    }
    const contents = new Set([
        ...Object.keys(entry.embeddedPackages),
        ...Object.keys(entry.addonPackages),
    ]);
    if (contents.size === 0) {
        return 'unknown';
    }
    for (const packageId of available) {
        if (!contents.has(packageId)) {
            return 'partial';
        }
    }
    return 'complete';
}

/** One published image that already contains the packages a build would ask for. */
export interface FirmwareSelectionMatch {
    entry: FirmwareInventoryEntry;
    /** `true` when the image's packages are exactly the selected ones, no extras. */
    exact: boolean;
}

/**
 * The packages the *next build* will ask for — the ticked checklist entries.
 *
 * Distinct from `FirmwareCompatibilityContext` on purpose: the checkboxes say
 * nothing about any image that already exists, and an existing image says nothing
 * about what the next build should contain. Used only by
 * `findFirmwareSelectionMatch()`; the inventory list's compatibility marker must
 * never be fed this set.
 */
export interface FirmwareSelection {
    /** Ticked package ids, built-ins and installed add-ons alike. */
    packageIds: string[];
    runtimeId: string;
    boardId: string;
}

/**
 * Return the published image that best matches the packages a build would ask
 * for, or `null` when no same-target image contains every selected package.
 *
 * Answers "is there already a firmware for this combination?" for the Build
 * Firmware group, so the user can deploy an existing image instead of rebuilding.
 * *selection* is the ticked checklist, **not** what the collection needs — see
 * `FirmwareSelection`. An image qualifies when its manifest lists every selected
 * id — in `embeddedPackages` (built-in) or `addonPackages` (installed add-ons).
 * Preference order is an exact package-set match first, then the newest image
 * (`isLatest`), so a rebuild that only added packages never hides the tighter
 * match.
 *
 * An empty selection matches nothing, because every image would qualify.
 */
export function findFirmwareSelectionMatch(
    entries: readonly FirmwareInventoryEntry[],
    selection: FirmwareSelection
): FirmwareSelectionMatch | null {
    if (selection.packageIds.length === 0) {
        return null;
    }
    const selected = new Set(selection.packageIds);
    const matches: FirmwareSelectionMatch[] = [];
    for (const entry of entries) {
        if (entry.boardId !== selection.boardId || entry.runtimeId !== selection.runtimeId) {
            continue;
        }
        if (!entry.hasManifest) {
            continue;
        }
        const contents = new Set([
            ...Object.keys(entry.embeddedPackages),
            ...Object.keys(entry.addonPackages),
        ]);
        if ([...selected].some((packageId) => !contents.has(packageId))) {
            continue;
        }
        matches.push({ entry, exact: contents.size === selected.size });
    }
    // `Array.prototype.sort` is stable, so equally ranked images keep the
    // inventory order and the winner stays deterministic.
    const rank = (match: FirmwareSelectionMatch): number =>
        (match.exact ? 2 : 0) + (match.entry.isLatest ? 1 : 0);
    return matches.sort((left, right) => rank(right) - rank(left))[0] ?? null;
}

/**
 * Presentational compatibility of one image against what the active collection
 * needs to run. `otherTarget` means the image targets a different board/runtime;
 * the others describe a same-target image whose sidecar manifest does or does not
 * supply those packages.
 */
export type FirmwareCompatibility = 'compatible' | 'incomplete' | 'unknown' | 'otherTarget';

/**
 * The packages the active collection needs an image to supply.
 *
 * Resolved from the collection's node types (the same set the Build Firmware
 * group's "Minimal" button ticks), **not** from the build selection: ticking
 * every package and building a slim subset is a normal workflow, and comparing
 * images against the checkboxes would then withhold the tick from an image that
 * is perfectly usable. Used by `classifyFirmwareCompatibility()`.
 */
export interface FirmwareCompatibilityContext {
    /** Package ids the collection needs; empty means "needs nothing from firmware". */
    requiredPackageIds: string[];
    runtimeId: string;
    boardId: string;
}

/** Result of one compatibility classification. */
export interface FirmwareCompatibilityClassification {
    status: FirmwareCompatibility;
    missingPackageIds: string[];
    otherTarget: boolean;
}

/**
 * Decode a `firmware.list` (or `firmware.delete`) result payload into entries.
 *
 * Never throws: a malformed payload yields an empty list, and any entry missing
 * a string `path` is dropped, matching the defensive decode in
 * `server-capabilities.ts`.
 */
export function decodeFirmwareInventoryResult(payload: unknown): FirmwareInventoryEntry[] {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return [];
    }
    const entries = (payload as Record<string, unknown>).entries;
    if (!Array.isArray(entries)) {
        return [];
    }
    const decoded = entries
        .filter(
            (entry): entry is Record<string, unknown> =>
                !!entry && typeof entry === 'object' && !Array.isArray(entry)
        )
        .filter((entry) => typeof entry.path === 'string' && entry.path.length > 0)
        .map(decodeFirmwareInventoryEntry);

    const latestByChannel = (payload as Record<string, unknown>).latestByChannel;
    if (!latestByChannel || typeof latestByChannel !== 'object' || Array.isArray(latestByChannel)) {
        return decoded;
    }
    const leaderPaths = new Set<string>();
    for (const channels of Object.values(latestByChannel)) {
        if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
            continue;
        }
        for (const path of Object.values(channels)) {
            if (typeof path === 'string') {
                leaderPaths.add(path);
            }
        }
    }
    return decoded.map((entry) => ({
        ...entry,
        isChannelLatest: leaderPaths.has(entry.path),
    }));
}

/**
 * Classify one image against the packages the active collection needs.
 *
 * `otherTarget` wins first (the image is for a different board/runtime), then a
 * missing sidecar is `unknown`, then any needed package absent from the image's
 * contents is `incomplete` (with the missing ids), otherwise `compatible`. An
 * empty requirement list is considered satisfied, so a manifest-bearing image
 * classifies as `compatible` when the collection needs no package.
 *
 * *context* carries what the collection needs, never the build-selection
 * checkboxes — see `FirmwareCompatibilityContext`.
 *
 * "Contents" is `embeddedPackages` (built-ins) *plus* `addonPackages` (add-ons),
 * matching `firmwarePackageCoverage()` and `findFirmwareSelectionMatch()`: a v2
 * sidecar splits the two maps, so a needed add-on lives in the image but never in
 * `embeddedPackages`. Reading only that map would call a freshly built image
 * `incomplete` and drop its tick. The sidecar's `selection.packageIds` records the
 * *request* instead, which staging may narrow, so it is not consulted either.
 */
export function classifyFirmwareCompatibility(
    entry: FirmwareInventoryEntry,
    context: FirmwareCompatibilityContext
): FirmwareCompatibilityClassification {
    // An imported image has no manifest contents, so "unknown" is the honest
    // answer and it must not be hidden behind "other target" just because its
    // `imported` runtime id differs from the context's runtime id.
    if (isImportedFirmware(entry) && entry.boardId === context.boardId) {
        return { status: 'unknown', missingPackageIds: [], otherTarget: false };
    }
    if (entry.boardId !== context.boardId || entry.runtimeId !== context.runtimeId) {
        return { status: 'otherTarget', missingPackageIds: [], otherTarget: true };
    }
    if (!entry.hasManifest) {
        return { status: 'unknown', missingPackageIds: [], otherTarget: false };
    }
    const contents = new Set([
        ...Object.keys(entry.embeddedPackages),
        ...Object.keys(entry.addonPackages),
    ]);
    const missingPackageIds = context.requiredPackageIds.filter((id) => !contents.has(id));
    if (missingPackageIds.length > 0) {
        return { status: 'incomplete', missingPackageIds, otherTarget: false };
    }
    return { status: 'compatible', missingPackageIds: [], otherTarget: false };
}

/**
 * Return a short human-facing name for an image (its filename).
 */
export function firmwareDisplayName(entry: FirmwareInventoryEntry): string {
    return entry.filename;
}

/**
 * Return the channel badge kind for an image, or `null` when it has none.
 *
 * Returns `null` for an empty channel so a legacy payload renders no badge
 * rather than a wrong one, and for an imported image because its `0.0.0`
 * placeholder version would otherwise be classified as a `release`.
 */
export function firmwareChannelBadge(entry: FirmwareInventoryEntry): 'release' | 'dev' | null {
    if (isImportedFirmware(entry)) {
        return null;
    }
    if (entry.channel === 'release' || entry.channel === 'dev') {
        return entry.channel;
    }
    return null;
}

/**
 * Format one package entry, appending the frozen variant when the sidecar recorded it.
 *
 * A pre-v3 sidecar has no variant map, so the label stays `id version` exactly as
 * before; a recorded variant becomes `id version (variant)`. Plain text only — the
 * caller decides where the label is used.
 */
export function firmwarePackageLabel(
    entry: FirmwareInventoryEntry,
    packageId: string,
    version: string
): string {
    const variant = entry.packageVariants[packageId];
    if (typeof variant === 'string' && variant !== '') {
        return `${packageId} ${version} (${variant})`;
    }
    return `${packageId} ${version}`;
}

/**
 * Return stable tooltip lines describing an image's contents.
 *
 * Used by the inventory panel's `title` tooltip and its accessibility label, so
 * the lines are plain text (no markup) and deterministic.
 */
export function firmwareTooltipLines(entry: FirmwareInventoryEntry): string[] {
    const lines = [
        `Target: ${entry.boardId}/${entry.runtimeId}`,
        `MicroPython: ${entry.micropythonVersion}`,
        `Runtime firmware: ${entry.runtimeFirmwareVersion}`,
    ];
    if (entry.channel) {
        lines.push(`Channel: ${entry.channel}`);
    }
    if (entry.versionSource) {
        lines.push(`Version source: ${entry.versionSource}`);
    }
    if (entry.contentHash) {
        lines.push(`Hash: ${entry.contentHash}`);
    }
    if (!entry.hasManifest) {
        lines.push('Contents: no manifest');
        return lines;
    }
    const packages = Object.keys(entry.embeddedPackages);
    if (packages.length === 0) {
        lines.push('Contents: no embedded packages');
    } else {
        lines.push(
            `Packages: ${packages
                .map((id) => firmwarePackageLabel(entry, id, entry.embeddedPackages[id]))
                .join(', ')}`
        );
    }
    // A v2 sidecar keeps add-ons out of `embeddedPackages`, so name them here too:
    // they are part of what the device runs and can satisfy a ticked package.
    const addonIds = Object.keys(entry.addonPackages);
    if (addonIds.length > 0) {
        lines.push(
            `Add-ons: ${addonIds
                .map((id) => firmwarePackageLabel(entry, id, entry.addonPackages[id]))
                .join(', ')}`
        );
    }
    if (entry.notEmbedded.length > 0) {
        lines.push(`Not embedded: ${entry.notEmbedded.join(', ')}`);
    }
    return lines;
}

/**
 * Decode one entry object, coercing every field defensively.
 */
function decodeFirmwareInventoryEntry(entry: Record<string, unknown>): FirmwareInventoryEntry {
    return {
        path: typeof entry.path === 'string' ? entry.path : '',
        filename: typeof entry.filename === 'string' ? entry.filename : '',
        boardId: typeof entry.boardId === 'string' ? entry.boardId : '',
        runtimeId: typeof entry.runtimeId === 'string' ? entry.runtimeId : '',
        micropythonVersion:
            typeof entry.micropythonVersion === 'string' ? entry.micropythonVersion : '',
        runtimeFirmwareVersion:
            typeof entry.runtimeFirmwareVersion === 'string' ? entry.runtimeFirmwareVersion : '',
        contentHash: typeof entry.contentHash === 'string' ? entry.contentHash : null,
        sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : 0,
        modifiedAt: typeof entry.modifiedAt === 'string' ? entry.modifiedAt : '',
        hasManifest: entry.hasManifest === true,
        embeddedPackages: decodeStringMap(entry.embeddedPackages),
        notEmbedded: Array.isArray(entry.notEmbedded)
            ? entry.notEmbedded.filter((item): item is string => typeof item === 'string')
            : [],
        addonPackages: decodeStringMap(entry.addonPackages),
        packageVariants: decodeStringMap(entry.packageVariants),
        selection:
            entry.selection && typeof entry.selection === 'object' && !Array.isArray(entry.selection)
                ? (entry.selection as Record<string, unknown>)
                : {},
        channel: typeof entry.channel === 'string' ? entry.channel : '',
        versionSource: typeof entry.versionSource === 'string' ? entry.versionSource : null,
        isPrerelease: entry.isPrerelease === true,
        isLatest: entry.isLatest === true,
        isChannelLatest: false,
        source: typeof entry.source === 'string' ? entry.source : '',
        targetId: typeof entry.targetId === 'string' ? entry.targetId : null,
        originalFilename: typeof entry.originalFilename === 'string' ? entry.originalFilename : null,
    };
}

/**
 * Coerce an object-of-string-pairs, tolerating a non-object value.
 */
function decodeStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (typeof item === 'string') {
            result[key] = item;
        }
    }
    return result;
}

