// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Runtime access to the vendored Material Design Icons (MDI) index.
 *
 * One DOM-free module owns everything "MDI" at runtime: the lazily loaded generated
 * index, the `<set>:<name>` value grammar and the ranked name/alias search. Callers
 * (the icon control, tests) never read the JSON artifact directly.
 */

/** Icon set prefix handled by the bundled index. */
export const MDI_SET = 'mdi';

/** Location of the generated index, served next to the vendored webfont. */
export const MDI_INDEX_PATH = '/html/vendor/mdi/icon-index.json';

/** Number of results the picker asks for by default. */
export const MDI_SEARCH_DEFAULT_LIMIT = 300;

/** Hard ceiling, so a one-letter query cannot render thousands of tiles. */
export const MDI_SEARCH_MAX_LIMIT = 500;

export interface MdiIconIndex {
    /** MDI release the index was generated from. */
    version: string;
    /** Canonical icon name to uppercase hex codepoint. */
    icons: Record<string, string>;
    /** Alias to canonical icon name. */
    aliases: Record<string, string>;
}

/** How a search hit matched the query, strongest first. */
export type MdiMatchKind = 'exact' | 'prefix' | 'name' | 'alias';

export interface MdiSearchHit {
    /** Canonical icon name (never the alias). */
    name: string;
    codepoint: string;
    matchedBy: MdiMatchKind;
    /** Set when `matchedBy === 'alias'`. */
    alias?: string;
}

/** Load state of the bundled index, for the picker footer. */
export type MdiIndexState = 'idle' | 'loading' | 'ready' | 'failed';

/** A parsed `<set>:<name>` icon value. */
export interface IconValue {
    set: string;
    name: string;
}

/** Sentinel used while the index is loading or after a failed load. */
export const EMPTY_MDI_INDEX: MdiIconIndex = Object.freeze({
    version: '',
    icons: {},
    aliases: {},
});

/**
 * Normalize an icon name for lookup and search.
 *
 * Strips the `mdi:` prefix (typed or pasted), trims, lower-cases and turns whitespace
 * runs into single dashes. A foreign set prefix (`ph:` in `ph:house`) is **not**
 * stripped: the caller splits the value first.
 * @param raw - Candidate name, usually straight from an input field.
 * @returns The normalized name, or `''` when nothing usable is left.
 */
export function normalizeMdiName(raw: unknown): string {
    if (typeof raw !== 'string') {
        return '';
    }

    let value = raw.trim().toLowerCase();
    if (value.startsWith(`${MDI_SET}:`)) {
        value = value.slice(MDI_SET.length + 1).trim();
    }

    return value.replace(/\s+/g, '-');
}

/**
 * Parse an icon control value.
 *
 * Accepts `mdi:thermometer` and a bare `thermometer` (which defaults to the `mdi`
 * set). A foreign set (`ph:thermometer`, `hue:light`) keeps its set and is never
 * rewritten. Empty values, a lone `:` and a prefix without a name are rejected.
 * @param raw - Raw control value.
 * @returns The parsed value, or `null` when there is no usable name.
 */
export function parseIconValue(raw: unknown): IconValue | null {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }

    const separator = trimmed.indexOf(':');
    const set =
        (separator === -1 ? MDI_SET : trimmed.slice(0, separator).trim().toLowerCase()) || '';
    const name = normalizeMdiName(separator === -1 ? trimmed : trimmed.slice(separator + 1));

    if (!set || !name) {
        return null;
    }

    return { set, name };
}

/**
 * Format an icon control value.
 *
 * Returns `''` for an empty name, so "clear" produces an empty control value that
 * `configLiteral()` then omits from the generated Python.
 * @param name - Icon name (a leading `mdi:` is tolerated).
 * @param set - Icon set prefix, `mdi` by default.
 * @returns The `<set>:<name>` string, or `''`.
 */
export function formatIconValue(name: string, set: string = MDI_SET): string {
    const normalizedName = normalizeMdiName(name);
    if (!normalizedName) {
        return '';
    }

    const normalizedSet =
        typeof set === 'string' && set.trim() ? set.trim().toLowerCase() : MDI_SET;
    return `${normalizedSet}:${normalizedName}`;
}

/**
 * Check whether the index knows an icon by name or alias.
 * @param index - Icon index to query.
 * @param name - Icon name or alias.
 * @returns The canonical icon name, or `null` when the index does not know it.
 */
export function resolveMdiIconName(index: MdiIconIndex, name: string): string | null {
    const normalizedName = normalizeMdiName(name);
    if (!normalizedName) {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(index.icons, normalizedName)) {
        return normalizedName;
    }

    const canonical = index.aliases[normalizedName];
    if (canonical && Object.prototype.hasOwnProperty.call(index.icons, canonical)) {
        return canonical;
    }

    return null;
}

/**
 * Turn a hex codepoint from the index into the glyph of the vendored MDI webfont.
 *
 * DOM-free and pure: the picker tiles, the canvas icon control and the node header paint the
 * same character, so they share this one conversion.
 * @param codepoint - Uppercase hex codepoint, e.g. `F050F`.
 * @returns The glyph, or `''` when the codepoint is unusable.
 */
export function mdiGlyphFromCodepoint(codepoint: string): string {
    const value = Number.parseInt(codepoint, 16);
    if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) {
        return '';
    }

    try {
        return String.fromCodePoint(value);
    } catch {
        return '';
    }
}

/**
 * Resolve a `<set>:<name>` icon value to the glyph of the vendored MDI webfont.
 *
 * The stored value is never rewritten: a foreign set (`ph:house`), an unknown name or an
 * empty value simply resolves to `null`, and the caller keeps showing the text form.
 * @param value - Raw control value, e.g. `mdi:thermometer`, `thermometer` or `ph:house`.
 * @param index - Icon index to resolve against.
 * @returns The glyph character, or `null` while the value is not a resolvable MDI icon.
 */
export function resolveMdiGlyph(value: string, index: MdiIconIndex): string | null {
    const parsed = parseIconValue(value);
    if (!parsed || parsed.set !== MDI_SET) {
        return null;
    }

    const name = resolveMdiIconName(index, parsed.name);
    const codepoint = name ? index.icons[name] : '';
    return codepoint ? mdiGlyphFromCodepoint(codepoint) || null : null;
}

/** Sorted icon names per index object, so a keystroke does not re-sort 7,400 keys. */
const sortedNameCache = new WeakMap<MdiIconIndex, string[]>();

function compareNames(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}

function getSortedNames(index: MdiIconIndex): string[] {
    const cached = sortedNameCache.get(index);
    if (cached) {
        return cached;
    }

    const names = Object.keys(index.icons).sort(compareNames);
    sortedNameCache.set(index, names);
    return names;
}

function clampLimit(limit: number | undefined): number {
    const requested =
        typeof limit === 'number' && Number.isFinite(limit)
            ? Math.floor(limit)
            : MDI_SEARCH_DEFAULT_LIMIT;

    return Math.min(Math.max(requested, 1), MDI_SEARCH_MAX_LIMIT);
}

function clampOffset(offset: number | undefined): number {
    return typeof offset === 'number' && Number.isFinite(offset) && offset > 0
        ? Math.floor(offset)
        : 0;
}

/**
 * Collect every match in ranked order: exact name, name prefix, name substring, then
 * alias substring. Ordering inside one rank is alphabetical, so results stay stable
 * while the user types.
 * @param index - Icon index to search.
 * @param query - Raw query; `mdi:` prefixes and casing are tolerated.
 * @returns All matches, unclipped.
 */
function collectMatches(index: MdiIconIndex, query: string): MdiSearchHit[] {
    const names = getSortedNames(index);
    const normalizedQuery = normalizeMdiName(query);

    if (!normalizedQuery) {
        return names
            .filter((name) => Boolean(index.icons[name]))
            .map((name) => ({
                name,
                codepoint: index.icons[name],
                matchedBy: 'name' as MdiMatchKind,
            }));
    }

    const hits: MdiSearchHit[] = [];
    const seen = new Set<string>();

    const push = (name: string, matchedBy: MdiMatchKind, alias?: string): void => {
        if (seen.has(name)) {
            return;
        }
        const codepoint = index.icons[name];
        if (!codepoint) {
            return;
        }
        seen.add(name);
        hits.push(alias ? { name, codepoint, matchedBy, alias } : { name, codepoint, matchedBy });
    };

    const prefixHits: string[] = [];
    const substringHits: string[] = [];

    names.forEach((name) => {
        if (!index.icons[name]) {
            return;
        }
        if (name === normalizedQuery) {
            push(name, 'exact');
            return;
        }
        if (name.startsWith(normalizedQuery)) {
            prefixHits.push(name);
            return;
        }
        if (name.includes(normalizedQuery)) {
            substringHits.push(name);
        }
    });

    prefixHits.forEach((name) => push(name, 'prefix'));
    substringHits.forEach((name) => push(name, 'name'));

    Object.keys(index.aliases)
        .sort(compareNames)
        .forEach((alias) => {
            if (!alias.includes(normalizedQuery)) {
                return;
            }
            // An alias that is also a canonical name already produced its own hit.
            if (index.icons[alias]) {
                return;
            }
            const target = index.aliases[alias];
            if (target) {
                push(target, 'alias', alias);
            }
        });

    return hits;
}

/**
 * One window of ranked search hits plus the size of the whole result set.
 */
export interface MdiSearchPage {
    /** Hits inside the requested window. */
    hits: MdiSearchHit[];
    /** Number of hits the query matches in total, independent of the window. */
    total: number;
}

/**
 * Read one page of ranked hits.
 *
 * The picker pages through results instead of rendering every match: an empty query matches
 * all 7,447 icons of the bundled release, and a page keeps a keystroke cheap. `total` comes
 * along for free, so the footer can say "300 of 7447" without a second pass over the index.
 * @param index - Icon index to search.
 * @param query - Raw query, e.g. `therm` or `mdi:therm`; empty browses alphabetically.
 * @param options - `limit` caps the page size (default 300, ceiling 500), `offset` skips
 *   already rendered hits.
 * @returns The page plus the total number of matches.
 */
export function searchMdiIconPage(
    index: MdiIconIndex,
    query: string,
    options: { limit?: number; offset?: number } = {}
): MdiSearchPage {
    const matches = collectMatches(index, query);
    const offset = clampOffset(options.offset);

    return {
        hits: matches.slice(offset, offset + clampLimit(options.limit)),
        total: matches.length,
    };
}

/**
 * Search the bundled index by name and alias.
 * @param index - Icon index to search.
 * @param query - Raw query, e.g. `therm` or `mdi:therm`; empty browses alphabetically.
 * @param options - `limit` caps the result size (default 300, ceiling 500), `offset` skips
 *   already rendered hits.
 * @returns Ranked hits, at most `limit` of them.
 */
export function searchMdiIcons(
    index: MdiIconIndex,
    query: string,
    options: { limit?: number; offset?: number } = {}
): MdiSearchHit[] {
    return searchMdiIconPage(index, query, options).hits;
}

/**
 * Count matches without building the result list's DOM-side limit.
 * @param index - Icon index to search.
 * @param query - Raw query.
 * @returns Number of icons the query matches (the footer's "of N matches").
 */
export function countMdiIconMatches(index: MdiIconIndex, query: string): number {
    return collectMatches(index, query).length;
}

let indexPromise: Promise<MdiIconIndex> | null = null;
let indexState: MdiIndexState = 'idle';
let indexVersion = '';

/**
 * Validate the payload shape and narrow it to `MdiIconIndex`.
 * @param payload - Parsed JSON from the generated index.
 * @returns The index.
 * @throws When the payload does not look like a generated index.
 */
function normalizeIndexPayload(payload: unknown): MdiIconIndex {
    if (!payload || typeof payload !== 'object') {
        throw new Error('MDI icon index is not an object');
    }

    const candidate = payload as Partial<MdiIconIndex>;
    const icons = candidate.icons;
    const aliases = candidate.aliases;

    if (!icons || typeof icons !== 'object' || !aliases || typeof aliases !== 'object') {
        throw new Error('MDI icon index is missing the icons/aliases maps');
    }

    return {
        version: typeof candidate.version === 'string' ? candidate.version : '',
        icons: icons as Record<string, string>,
        aliases: aliases as Record<string, string>,
    };
}

async function fetchMdiIconIndex(): Promise<MdiIconIndex> {
    indexState = 'loading';

    try {
        if (typeof globalThis.fetch !== 'function') {
            throw new Error('fetch is not available');
        }

        const response = await globalThis.fetch(MDI_INDEX_PATH);
        if (!response || !response.ok) {
            throw new Error(
                `MDI icon index request failed (${response ? response.status : 'no response'})`
            );
        }

        const index = normalizeIndexPayload(await response.json());
        indexVersion = index.version;
        indexState = 'ready';
        return index;
    } catch {
        // Degrade to a plain text field instead of blocking the editor.
        indexState = 'failed';
        return EMPTY_MDI_INDEX;
    }
}

/**
 * Load the bundled icon index, at most once per session.
 *
 * Never rejects and never retries: a failed load resolves to `EMPTY_MDI_INDEX` and
 * leaves the state at `'failed'`, so the picker can tell the user to type the name.
 * @returns The index, or `EMPTY_MDI_INDEX` when loading failed.
 */
export function loadMdiIconIndex(): Promise<MdiIconIndex> {
    if (!indexPromise) {
        indexPromise = fetchMdiIconIndex();
    }

    return indexPromise;
}

/**
 * Start loading the index without awaiting it (called on first focus).
 * @returns Nothing; the promise is intentionally not exposed.
 */
export function preloadMdiIconIndex(): void {
    void loadMdiIconIndex();
}

/**
 * Current load state, for the picker footer.
 * @returns `'idle'` before the first load, then `'loading'`, `'ready'` or `'failed'`.
 */
export function getMdiIndexState(): MdiIndexState {
    return indexState;
}

/**
 * Version of the loaded index, e.g. `7.4.47` (empty until the load succeeded).
 * @returns The MDI version string.
 */
export function getMdiIndexVersion(): string {
    return indexVersion;
}

/**
 * Drop the cached index and its load state.
 *
 * Only tests use this; the application loads the index exactly once per session.
 * @returns Nothing.
 */
export function resetMdiIconIndexCache(): void {
    indexPromise = null;
    indexState = 'idle';
    indexVersion = '';
}
