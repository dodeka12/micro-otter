// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Read-only reader for the board catalog (`boards.json`, schema v2).
 *
 * The catalog is display-only on the client: the flash offset is shown, never
 * used to flash — the flash backend decides. Resolution matches the canonical
 * board `name`/`slug` (no aliases, no case/separator folding of the toolchain
 * name). See ``docs/dev/firmware-compile/board-catalog-contract.md``.
 */

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Board catalog URL, served from the web root (`src/micro_otter/nodes`). */
export const BOARD_CATALOG_URL = '/device/firmware/boards.json';

/** One board entry, null-tolerant for the optional fields. */
export interface FirmwareBoardSpec {
    name: string;
    slug: string;
    displayName: string;
    port: string;
    chip: string | null;
    buildDirName: string;
    firmwareFlashOffset: string | null;
    buildBackend: string | null;
    flashBackend: string | null;
}

interface CatalogPayload {
    schemaVersion?: unknown;
    boards?: unknown;
}

/**
 * Load and normalise the board catalog, never throwing.
 *
 * A missing file, a non-`ok` response, a non-2 `schemaVersion`, or a malformed
 * entry yields `[]` (and malformed entries are skipped individually). A broken
 * catalog disables the info row and deploy's chip check — never the tab.
 */
export async function loadBoardCatalog(options: { fetchImpl?: FetchLike } = {}): Promise<FirmwareBoardSpec[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
        const response = await fetchImpl(BOARD_CATALOG_URL, { cache: 'no-store' });
        if (!response || !response.ok) {
            return [];
        }
        const payload = (await response.json()) as CatalogPayload;
        if (payload.schemaVersion !== 2 || !Array.isArray(payload.boards)) {
            return [];
        }
        return payload.boards
            .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
            .map(normalizeBoard)
            .filter((board): board is FirmwareBoardSpec => board !== null);
    } catch {
        return [];
    }
}

/**
 * Normalise one board entry, returning `null` when required fields are missing.
 */
function normalizeBoard(entry: Record<string, unknown>): FirmwareBoardSpec | null {
    const name = nonEmptyString(entry.name);
    const slug = nonEmptyString(entry.slug);
    if (!name || !slug) {
        return null;
    }
    return {
        name,
        slug,
        displayName: nonEmptyString(entry.displayName) ?? name,
        port: paramsField(entry.build, 'port') ?? '',
        chip: nonEmptyString(entry.chip),
        buildDirName: paramsField(entry.build, 'buildDirName') ?? '',
        firmwareFlashOffset: paramsField(entry.flash, 'offset'),
        buildBackend: nonEmptyString(entry.buildBackend),
        flashBackend: nonEmptyString(entry.flashBackend),
    };
}

/**
 * Normalise a board selector the same way the server does: strip and lowercase.
 */
export function normalizeBoardSelector(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * Find a board by exact `name`/`slug` match after normalisation, or `null`.
 */
export function findBoard(catalog: FirmwareBoardSpec[], selector: string): FirmwareBoardSpec | null {
    const normalized = normalizeBoardSelector(selector);
    if (!normalized) {
        return null;
    }
    for (const board of catalog) {
        if (normalizeBoardSelector(board.name) === normalized) {
            return board;
        }
        if (normalizeBoardSelector(board.slug) === normalized) {
            return board;
        }
    }
    return null;
}

/**
 * Find the catalog board a compile target maps to, or `null`.
 *
 * Matches the mapping's `board` against a normalised board `name`, falling back
 * to a unique `port` match when that is ambiguous or absent.
 */
export function findBoardForCompileTarget(
    catalog: FirmwareBoardSpec[],
    mapping: { board: string; port: string } | null | undefined
): FirmwareBoardSpec | null {
    if (!mapping) {
        return null;
    }
    const nameMatches = catalog.filter(
        (board) => normalizeBoardSelector(board.name) === normalizeBoardSelector(mapping.board)
    );
    if (nameMatches.length === 1) {
        return nameMatches[0];
    }
    const portMatches = catalog.filter(
        (board) => normalizeBoardSelector(board.port) === normalizeBoardSelector(mapping.port)
    );
    return portMatches.length === 1 ? portMatches[0] : null;
}

/**
 * Read a string field from a backend-owned `build`/`flash` params object.
 */
function paramsField(params: unknown, key: string): string | null {
    if (!params || typeof params !== 'object') {
        return null;
    }
    return nonEmptyString((params as Record<string, unknown>)[key]);
}

/**
 * Return a trimmed non-empty string from an unknown value, or `null`.
 */
function nonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
