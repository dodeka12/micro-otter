// Copyright (c) 2026 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

export interface NodeWidthBounds {
    minWidth: number | null;
    maxWidth: number | null;
}

export interface ResolveNodeWidthOptions {
    instanceWidth?: unknown;
    defaultWidth?: unknown;
    minWidth?: unknown;
    maxWidth?: unknown;
    legacyFallbackWidth?: number;
}

export const LEGACY_DEFAULT_NODE_WIDTH = 140;

function normalizePositiveWidth(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    if (value <= 0) {
        return null;
    }

    return value;
}

function normalizeOptionalBound(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    if (value < 0) {
        return null;
    }

    return value;
}

function normalizeRoundedWidth(value: number): number {
    const rounded = Math.round(value);
    return rounded > 0 ? rounded : 1;
}

export function clampNodeWidth(width: number, bounds: NodeWidthBounds): number {
    const minWidth = normalizeOptionalBound(bounds.minWidth);
    const maxWidth = normalizeOptionalBound(bounds.maxWidth);

    let normalized = normalizeRoundedWidth(width);

    if (minWidth !== null) {
        normalized = Math.max(normalized, normalizeRoundedWidth(minWidth));
    }

    if (maxWidth !== null) {
        normalized = Math.min(normalized, normalizeRoundedWidth(maxWidth));
    }

    return normalized;
}

/**
 * Merge the node type's `minWidth` with the content-derived minimum of a node.
 *
 * The connector row layout needs room for labels and input default controls, which can
 * exceed the width a node type declares. Both bounds apply, so the stricter one wins.
 * Invalid or negative values are ignored (`null`).
 *
 * @param metadataMinWidth - `minWidth` declared by the node type.
 * @param contentMinWidth - Minimum width derived from the node's own content.
 * @returns The effective minimum width, or `null` when neither bound is usable.
 */
export function resolveEffectiveMinWidth(
    metadataMinWidth: unknown,
    contentMinWidth: unknown
): number | null {
    const metadataBound = normalizeOptionalBound(metadataMinWidth);
    const contentBound = normalizeOptionalBound(contentMinWidth);

    if (metadataBound === null) {
        return contentBound;
    }

    if (contentBound === null) {
        return metadataBound;
    }

    return Math.max(metadataBound, contentBound);
}

export function resolveNodeWidth(options: ResolveNodeWidthOptions = {}): number {
    const minWidth = normalizeOptionalBound(options.minWidth);
    const maxWidth = normalizeOptionalBound(options.maxWidth);

    const instanceWidth = normalizePositiveWidth(options.instanceWidth);
    const defaultWidth = normalizePositiveWidth(options.defaultWidth);

    const normalizedFallback = normalizePositiveWidth(options.legacyFallbackWidth);
    const legacyFallbackWidth =
        normalizedFallback !== null ? normalizedFallback : LEGACY_DEFAULT_NODE_WIDTH;

    const candidateWidth = instanceWidth ?? defaultWidth ?? legacyFallbackWidth;
    return clampNodeWidth(candidateWidth, { minWidth, maxWidth });
}
