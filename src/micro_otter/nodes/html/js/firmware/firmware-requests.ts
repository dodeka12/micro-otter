// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Pure request builders for the `WS /firmware` endpoint.
 *
 * These are the only place a request frame is assembled. They are side-effect
 * free so they can be unit-tested without a socket.
 */

/** Inputs for `buildCompileRequest`. */
export interface CompileRequestInput {
    runtimeId: string;
    targetId?: string | null;
    baseTargetId?: string | null;
    packageIds: string[];
    packageVariants?: Record<string, string>;
    cleanBuild: boolean;
}

/** Inputs for `buildDeployRequest`. */
export interface DeployRequestInput {
    targetId?: string | null;
    baseTargetId?: string | null;
    port: string;
    firmwarePath?: string | null;
    wipeFilesystem: boolean;
    backendId?: string | null;
}

/**
 * Build a `compile.start` frame.
 *
 * The selected target id is sent and the server resolves it to a board; the
 * client never sends a board it resolved itself. A derived user target also
 * sends its ``baseTargetId`` so the server resolves the board on the base.
 * `modulePackagingMode` is fixed to `compiled-mpy`.
 */
export function buildCompileRequest(input: CompileRequestInput): Record<string, unknown> {
    const request: Record<string, unknown> = {
        type: 'compile.start',
        runtimeId: input.runtimeId,
        packageIds: input.packageIds,
        modulePackagingMode: 'compiled-mpy',
        cleanBuild: input.cleanBuild,
    };
    if (input.targetId) {
        request.targetId = input.targetId;
    }
    if (input.baseTargetId) {
        request.baseTargetId = input.baseTargetId;
    }
    if (input.packageVariants && Object.keys(input.packageVariants).length > 0) {
        request.packageVariants = input.packageVariants;
    }
    return request;
}

/**
 * Build a `deploy.start` frame.
 *
 * The selected target id selects the board server-side; a derived user target
 * also sends ``baseTargetId``. `firmwarePath` is present only for a successful
 * build of the same target, and `wipeFilesystem`/`backendId` only when set, so
 * the server applies its own defaults for everything the view did not
 * explicitly choose.
 */
export function buildDeployRequest(input: DeployRequestInput): Record<string, unknown> {
    const request: Record<string, unknown> = {
        type: 'deploy.start',
        port: input.port,
    };
    if (input.targetId) {
        request.targetId = input.targetId;
    }
    if (input.baseTargetId) {
        request.baseTargetId = input.baseTargetId;
    }
    if (input.firmwarePath) {
        request.firmwarePath = input.firmwarePath;
    }
    if (input.wipeFilesystem) {
        request.wipeFilesystem = true;
    }
    if (input.backendId) {
        request.backendId = input.backendId;
    }
    return request;
}

/**
 * Build a `firmware.list` frame.
 *
 * It carries no fields: the server returns every published image and computes
 * `isLatest` itself, so the client never filters or orders on its own.
 */
export function buildFirmwareListRequest(): Record<string, unknown> {
    return { type: 'firmware.list' };
}

/**
 * Build a `firmware.delete` frame.
 *
 * `firmwarePath` is the absolute path handed back by a `firmware.list` result.
 * An empty path is a programming error, so it throws rather than sending a
 * malformed delete the server would refuse.
 */
export function buildFirmwareDeleteRequest(firmwarePath: string): Record<string, unknown> {
    if (!firmwarePath || !firmwarePath.trim()) {
        throw new Error('firmwarePath must be a non-empty string');
    }
    return { type: 'firmware.delete', firmwarePath: firmwarePath.trim() };
}

/** Inputs for `buildFirmwareImportRequest`. */
export interface FirmwareImportRequestInput {
    path?: string;
    url?: string;
    force?: boolean;
}

/**
 * Build a `firmware.import` frame.
 *
 * The server resolves the source itself, so the browser never reads package
 * bytes: `path` is an absolute `.firmware.zip` on the server's machine and `url`
 * is fetched by the server under the archive-source policy. Exactly one of
 * `path` / `url` is required (mirroring the server's `invalid-frame`), and
 * `force` is only present when true.
 */
export function buildFirmwareImportRequest(
    input: FirmwareImportRequestInput
): Record<string, unknown> {
    const path = (input.path ?? '').trim();
    const url = (input.url ?? '').trim();
    if ((path === '') === (url === '')) {
        throw new Error("firmware.import needs exactly one of 'path' or 'url'");
    }
    const request: Record<string, unknown> = { type: 'firmware.import' };
    if (path !== '') {
        request.path = path;
    } else {
        request.url = url;
    }
    if (input.force) {
        request.force = true;
    }
    return request;
}

/**
 * Decide whether a picked name is a raw MicroPython binary source.
 *
 * The picker and the URL dialog share this one router: a download URL such as
 * `https://host/x.bin?token=…` must still route to the binary import path, so the
 * query and fragment are stripped before the suffix is compared (case-insensitive).
 * A name that is neither `.bin` nor `.firmware.zip` keeps the package path, so
 * today's behaviour is never regressed.
 */
export function isBinaryFirmwareSource(value: string): boolean {
    const path = value.trim().split(/[?#]/)[0];
    return path.toLowerCase().endsWith('.bin');
}

/** Inputs for `buildFirmwareImportBinaryRequest`. */
export interface FirmwareImportBinaryRequestInput {
    path?: string;
    url?: string;
    targetId: string;
    force?: boolean;
}

/**
 * Build a `firmware.import-binary` frame.
 *
 * The server resolves the `.bin` itself, so the browser never reads image bytes.
 * Exactly one of `path` / `url` is required (same rule and error text as the
 * package builder), `targetId` selects the board whose slug becomes part of the
 * published name and the deploy target, and `force` is only present when true.
 */
export function buildFirmwareImportBinaryRequest(
    input: FirmwareImportBinaryRequestInput
): Record<string, unknown> {
    const path = (input.path ?? '').trim();
    const url = (input.url ?? '').trim();
    if ((path === '') === (url === '')) {
        throw new Error("firmware.import-binary needs exactly one of 'path' or 'url'");
    }
    if (!input.targetId || !input.targetId.trim()) {
        throw new Error('targetId must be a non-empty string');
    }
    const request: Record<string, unknown> = {
        type: 'firmware.import-binary',
        targetId: input.targetId.trim(),
    };
    if (path !== '') {
        request.path = path;
    } else {
        request.url = url;
    }
    if (input.force) {
        request.force = true;
    }
    return request;
}

/**
 * Inputs for `buildAddonInstallRequest`.
 */
export interface AddonInstallRequestInput {
    path?: string;
    url?: string;
    force?: boolean;
}

/**
 * Build an `addon.install` frame.
 *
 * The server resolves the source itself, so the browser never reads archive
 * bytes: `path` is an absolute `.zip` on the server's machine and `url` is
 * fetched by the server under the archive-source policy. Exactly one of
 * `path` / `url` is required, and `force` is only present when true.
 */
export function buildAddonInstallRequest(
    input: AddonInstallRequestInput
): Record<string, unknown> {
    const path = (input.path ?? '').trim();
    const url = (input.url ?? '').trim();
    if ((path === '') === (url === '')) {
        throw new Error("addon.install needs exactly one of 'path' or 'url'");
    }
    const request: Record<string, unknown> = { type: 'addon.install' };
    if (path !== '') {
        request.path = path;
    } else {
        request.url = url;
    }
    if (input.force) {
        request.force = true;
    }
    return request;
}

/**
 * Build an `addon.uninstall` frame.
 *
 * The ids are trimmed, blanks dropped, and duplicates removed in first-seen order,
 * so the frame and the confirmation text name the same packages. An empty result
 * throws instead of sending a frame the server would refuse with `invalid-frame`.
 */
export function buildAddonUninstallRequest(packageIds: string[]): Record<string, unknown> {
    const ids = [...new Set(packageIds.map((id) => id.trim()).filter((id) => id !== ''))];
    if (ids.length === 0) {
        throw new Error('packageIds must contain at least one add-on id');
    }
    return { type: 'addon.uninstall', packageIds: ids };
}

/**
 * Format a byte count as a human-readable string with a documented unit list.
 */
/** Inputs for `buildFsListRequest`. */
export interface FsListRequestInput {
    requestId: string;
    path?: string;
    extensions?: string[];
    showHidden?: boolean;
}

/**
 * Build an `fs.list` side-channel frame.
 *
 * An omitted `path` means the server's default start directory, and an empty
 * `extensions` list means every file. A blank `requestId` is a programming error.
 */
export function buildFsListRequest(input: FsListRequestInput): Record<string, unknown> {
    if (!input.requestId || !input.requestId.trim()) {
        throw new Error('requestId must be a non-empty string');
    }
    const request: Record<string, unknown> = {
        type: 'fs.list',
        requestId: input.requestId.trim(),
    };
    if (input.path) {
        request.path = input.path.trim();
    }
    if (input.extensions && input.extensions.length > 0) {
        request.extensions = input.extensions;
    }
    if (input.showHidden) {
        request.showHidden = true;
    }
    return request;
}

/** Inputs for `buildFirmwareExportRequest`. */
export interface FirmwareExportRequestInput {
    firmwarePath: string;
    destinationDir: string;
    force?: boolean;
}

/**
 * Build a `firmware.export` frame.
 *
 * Both paths are trimmed and must be non-blank; the server names the written
 * file, so the browser never invents a path. `force` is only present when true.
 */
export function buildFirmwareExportRequest(
    input: FirmwareExportRequestInput
): Record<string, unknown> {
    const firmwarePath = input.firmwarePath.trim();
    const destinationDir = input.destinationDir.trim();
    if (!firmwarePath) {
        throw new Error('firmwarePath must be a non-empty string');
    }
    if (!destinationDir) {
        throw new Error('destinationDir must be a non-empty string');
    }
    const request: Record<string, unknown> = {
        type: 'firmware.export',
        firmwarePath,
        destinationDir,
    };
    if (input.force) {
        request.force = true;
    }
    return request;
}

/** One `fs.list` entry as the server reports it. */
export interface FsListEntry {
    name: string;
    path: string;
    kind: 'directory' | 'file' | 'symlink';
    sizeBytes: number | null;
    modifiedAt: string | null;
}

/** One `fs.list.result` payload. */
export interface FsListResult {
    path: string;
    parent: string | null;
    roots: { id: string; path: string }[];
    entries: FsListEntry[];
    truncated: boolean;
}

/**
 * Parse one `fs.list.result` frame into a typed listing.
 *
 * Throws on a missing `path` or a non-array `entries`, drops entries whose
 * `kind` is not one of the three literals, and coerces `sizeBytes` / `modifiedAt`
 * to `null` when absent (the dialog renders those as an em dash).
 */
export function parseFsListResult(frame: unknown): FsListResult {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
        throw new Error('fs.list.result must be an object');
    }
    const raw = frame as Record<string, unknown>;
    if (typeof raw.path !== 'string') {
        throw new Error('fs.list.result is missing a path');
    }
    if (!Array.isArray(raw.entries)) {
        throw new Error('fs.list.result is missing entries');
    }
    const roots = Array.isArray(raw.roots)
        ? (raw.roots as { id: string; path: string }[])
        : [];
    const entries: FsListEntry[] = [];
    for (const entry of raw.entries as Record<string, unknown>[]) {
        if (
            !entry ||
            typeof entry !== 'object' ||
            typeof entry.name !== 'string' ||
            typeof entry.path !== 'string'
        ) {
            continue;
        }
        const kind = entry.kind;
        if (kind !== 'directory' && kind !== 'file' && kind !== 'symlink') {
            continue;
        }
        entries.push({
            name: entry.name,
            path: entry.path,
            kind,
            sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : null,
            modifiedAt: typeof entry.modifiedAt === 'string' ? entry.modifiedAt : null,
        });
    }
    return {
        path: raw.path,
        parent: typeof raw.parent === 'string' ? raw.parent : null,
        roots,
        entries,
        truncated: raw.truncated === true,
    };
}

/**
 * Validate a package selection, returning an error message or `null` when ok.
 *
 * Accepts only `.zip` names within the size cap, so an obviously wrong or
 * oversized pick is refused before the server ever sees it. The structural
 * `{ name, size }` shape lets the file picker validate an `fs.list` entry
 * without a browser `File`.
 */
export function validateFirmwarePackageSelection(
    selection: { name: string; size: number },
    maxBytes?: number
): string | null {
    const cap = maxBytes ?? 4 * 1024 * 1024;
    if (!selection.name.toLowerCase().endsWith('.zip')) {
        return 'Only .zip packages can be imported.';
    }
    if (selection.size > cap) {
        const maxMiB = Math.floor(cap / (1024 * 1024));
        return `The package is larger than ${maxMiB} MiB.`;
    }
    return null;
}

/**
 * Pre-validate a URL for the *from URL…* dialog, returning `true` or a locale key.
 *
 * Accepts `https://` anywhere and `http://` only towards `localhost` /
 * `127.0.0.1` / `[::1]`; embedded credentials are refused. It deliberately does
 * not check the suffix — the server decides — so a typo fails inside the dialog
 * instead of after a round trip.
 */
export function validateArchiveUrl(value: string): true | string {
    const url = value.trim();
    if (url.includes('@')) {
        return 'firmwareBuild.inventory.urlInvalid';
    }
    if (url.startsWith('https://')) {
        return true;
    }
    if (url.startsWith('http://')) {
        const host = url.slice('http://'.length).split(/[/?#]/)[0];
        const normalized = host.startsWith('[')
            ? host.slice(1, host.indexOf(']'))
            : host.split(':')[0];
        if (
            normalized === 'localhost' ||
            normalized === '127.0.0.1' ||
            normalized === '::1'
        ) {
            return true;
        }
    }
    return 'firmwareBuild.inventory.urlInvalid';
}



export function formatBytes(bytes: number | null | undefined): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
        return '';
    }
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const rounded = unitIndex === 0 ? value : Math.round(value * 10) / 10;
    return `${rounded} ${units[unitIndex]}`;
}
