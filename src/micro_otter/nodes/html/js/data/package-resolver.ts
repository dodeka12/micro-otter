// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import {
    evaluateRequiredCapabilities,
    type CapabilityRequirementContext,
} from '../core/capability-requirements.js';

export interface PackageIndexEntry {
    id: string;
    manifest: string;
}

export interface ResolvedVariant {
    id: string;
    variantId: string;
    manifestRel: string;
    manifest: Record<string, unknown>;
    precedence: number;
    version: string | null;
}

/**
 * Parse a `node_pkgs/index.json` payload into `{ id, manifest }` entries.
 * Missing or malformed payloads yield an empty list.
 */
export function parsePackageEntries(indexData: unknown): PackageIndexEntry[] {
    const packages =
        indexData && typeof indexData === 'object' && !Array.isArray(indexData)
            ? (indexData as Record<string, unknown>).packages
            : null;
    if (!Array.isArray(packages)) {
        return [];
    }

    const entries: PackageIndexEntry[] = [];
    for (const entry of packages) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const manifest = typeof record.manifest === 'string' ? record.manifest.trim() : '';
        if (id && manifest) {
            entries.push({ id, manifest });
        }
    }
    return entries;
}

export function groupEntriesById(entries: PackageIndexEntry[]): Map<string, PackageIndexEntry[]> {
    const grouped = new Map<string, PackageIndexEntry[]>();
    for (const entry of entries) {
        const list = grouped.get(entry.id) ?? [];
        list.push(entry);
        grouped.set(entry.id, list);
    }
    return grouped;
}

/**
 * Return the single index entry for *packageId*, or throw for an unknown id.
 *
 * A v2 package has exactly one manifest, so the entry is the package's manifest path.
 */
export function resolvePackageEntry(
    entries: PackageIndexEntry[],
    packageId: string
): PackageIndexEntry {
    const variants = groupEntriesById(entries).get(packageId);
    if (!variants || variants.length === 0) {
        throw new Error(`Unknown node package id: ${packageId}`);
    }
    return variants[0];
}

/** Return the ``variants`` dict of a v2 manifest, or an empty object when absent. */
export function packageVariants(
    manifest: Record<string, unknown> | null | undefined
): Record<string, Record<string, unknown>> {
    const declared = manifest?.variants;
    if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
        return {};
    }
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(declared)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = value as Record<string, unknown>;
        }
    }
    return out;
}

function manifestPrecedence(manifest: Record<string, unknown>): number {
    const value = manifest.precedence;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }
    return value >= 0 ? Math.floor(value) : 0;
}

/**
 * Select the satisfiable variant with the highest `precedence`, or the explicitly
 * requested variant id.
 *
 * Returns `null` when no variant is satisfiable, throws for an unknown id, and
 * throws when multiple satisfiable variants share the same precedence.
 */
export async function selectVariant(
    entries: PackageIndexEntry[],
    packageId: string,
    loadManifest: (manifestRel: string) => Promise<Record<string, unknown>>,
    context: CapabilityRequirementContext,
    requestedVariant?: string
): Promise<ResolvedVariant | null> {
    const entry = resolvePackageEntry(entries, packageId);
    const manifest = await loadManifest(entry.manifest);
    const variants = packageVariants(manifest);
    const version = typeof manifest.version === 'string' ? manifest.version : null;

    const packageResult = evaluateRequiredCapabilities(manifest?.requiredCapabilities, context);
    if (!packageResult.satisfied) {
        if (requestedVariant != null) {
            throw new Error(
                `Variant '${requestedVariant}' of node package '${packageId}' is unsatisfiable on this target`
            );
        }
        return null;
    }

    const satisfied: ResolvedVariant[] = [];
    for (const [variantId, variant] of Object.entries(variants)) {
        if (requestedVariant != null && variantId !== requestedVariant) {
            continue;
        }
        const result = evaluateRequiredCapabilities(variant?.requiredCapabilities, context);
        if (result.satisfied) {
            satisfied.push({
                id: packageId,
                variantId,
                manifestRel: entry.manifest,
                manifest: variant,
                precedence: manifestPrecedence(variant),
                version,
            });
        } else if (requestedVariant != null) {
            throw new Error(
                `Variant '${requestedVariant}' of node package '${packageId}' is unsatisfiable on this target`
            );
        }
    }

    if (requestedVariant != null) {
        if (satisfied.length === 0) {
            throw new Error(
                `Unknown variant '${requestedVariant}' for node package '${packageId}'`
            );
        }
        return satisfied[0];
    }

    if (satisfied.length === 0) {
        return null;
    }

    satisfied.sort((a, b) => b.precedence - a.precedence);
    const best = satisfied[0];
    if (satisfied.slice(1).some((variant) => variant.precedence === best.precedence)) {
        throw new Error(
            `Ambiguous node package variants for '${packageId}': multiple satisfiable variants share precedence ${best.precedence}`
        );
    }
    return best;
}

/** Variant id of a package's default implementation. */
export const DEFAULT_VARIANT_ID = 'py';

/** Display name of the default implementation when the variant declares no title. */
export const DEFAULT_VARIANT_TITLE = 'Py';

/** Metadata for one variant of a package, for the firmware picker. */
export interface PackageVariantInfo {
    variantId: string;
    manifestRel: string;
    precedence: number;
    requiredCapabilities: unknown;
    title: Record<string, string> | null;
    hardware: Record<string, string> | null;
    /** i18n ``{en, de}`` text describing the variant; ``null`` when undeclared. */
    description: Record<string, string> | null;
    /** The package-level ``description`` string, used when the variant declares none. */
    packageDescription: string;
}

function stringMap(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(record)) {
        if (typeof entry === 'string') {
            out[key] = entry;
        }
    }
    return Object.keys(out).length > 0 ? out : null;
}

/** Return a trimmed string for a manifest field, or ``''`` for a non-string value. */
function textField(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Return the variant metadata for a package, sorted by precedence descending.
 *
 * The package's one manifest is loaded and each ``variants`` entry is described, so
 * the picker can render each variant without re-deriving the server's rules.
 */
export async function listPackageVariants(
    entries: PackageIndexEntry[],
    packageId: string,
    loadManifest: (manifestRel: string) => Promise<Record<string, unknown>>
): Promise<PackageVariantInfo[]> {
    const entry = resolvePackageEntry(entries, packageId);
    const manifest = await loadManifest(entry.manifest);
    const variants: PackageVariantInfo[] = [];
    for (const [variantId, variant] of Object.entries(packageVariants(manifest))) {
        variants.push({
            variantId,
            manifestRel: entry.manifest,
            precedence: manifestPrecedence(variant),
            requiredCapabilities: variant?.requiredCapabilities ?? null,
            title: stringMap(variant?.title),
            hardware: stringMap(variant?.hardware),
            description: stringMap(variant?.description),
            packageDescription: textField(manifest?.description),
        });
    }
    variants.sort((a, b) => b.precedence - a.precedence);
    return variants;
}

/**
 * Return the localized text for a manifest text field.
 *
 * Accepts a bare string (used as-is) or an i18n ``{en, de}`` map. The lookup order
 * is ``value[locale]`` → ``value.en`` → the first own value, skipping blank
 * entries; ``''`` when nothing matches.
 */
export function localizeVariantText(
    value: Record<string, string> | string | null | undefined,
    locale: string
): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
    }
    if (typeof value[locale] === 'string' && value[locale].trim()) {
        return value[locale].trim();
    }
    if (typeof value.en === 'string' && value.en.trim()) {
        return value.en.trim();
    }
    for (const entry of Object.values(value)) {
        if (typeof entry === 'string' && entry.trim()) {
            return entry.trim();
        }
    }
    return '';
}

/**
 * Return the display name for a variant, falling back to `Py` for the default id.
 */
export function variantDisplayName(variant: PackageVariantInfo, locale = 'en'): string {
    return (
        localizeVariantText(variant.title, locale) ||
        (variant.variantId === DEFAULT_VARIANT_ID ? DEFAULT_VARIANT_TITLE : variant.variantId)
    );
}

/**
 * Return the tooltip text for a variant: `description` → package `description` → `hardware`.
 */
export function variantDescription(variant: PackageVariantInfo, locale = 'en'): string {
    return (
        localizeVariantText(variant.description, locale) ||
        localizeVariantText(variant.packageDescription, locale) ||
        localizeVariantText(variant.hardware, locale)
    );
}

/**
 * Return the manifest the editor should load for *packageId*.
 *
 * Node definitions live in the single manifest that declares ``nodeDefs``; the
 * editor loads that manifest, so a package whose only implementation is a variant
 * still contributes its node definitions.
 */
export async function selectEditorManifest(
    entries: PackageIndexEntry[],
    packageId: string,
    _loadManifest: (manifestRel: string) => Promise<Record<string, unknown>>
): Promise<string> {
    return resolvePackageEntry(entries, packageId).manifest;
}
