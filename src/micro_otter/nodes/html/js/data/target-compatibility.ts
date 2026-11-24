// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * One compatibility rule for a flashed image versus a target id.
 *
 * An image records its single ``buildBaseTargetId``; a target id resolves (via
 * its derivation chain) to a terminal base id. They are compatible when the two
 * base ids agree — no enumeration of derived configs is needed. Older images
 * carry only an ``allowedWebTargetIds`` list, which is expanded through the
 * resolver's base mapping; images with neither field fall back to board
 * comparison, then to "allow" (today's empty-list behaviour).
 */
export interface TargetCompatibilityImage {
    buildBaseTargetId?: string | null;
    allowedWebTargetIds?: string[] | null;
    compileBoard?: string | null;
}

/** The minimal runtime surface the predicate needs to resolve base ids. */
export interface TargetCompatibilityResolver {
    getTargetBuildBaseId?(targetId: string): string | null;
    resolveBuildBaseId?(targetId: string): string | null;
    getCompileTarget?(targetId: string): { board: string; port: string } | null;
}

/**
 * Return whether *targetId* is compatible with the flashed *image*.
 *
 * @param targetId The collection/device target id to check.
 * @param image The flashed image's compatibility metadata.
 * @param resolver The runtime used to resolve base ids and boards.
 */
export function isTargetCompatibleWithImage(
    targetId: string,
    image: TargetCompatibilityImage,
    resolver: unknown
): boolean {
    const runtime = (resolver ?? {}) as TargetCompatibilityResolver;
    const base =
        runtime.getTargetBuildBaseId?.(targetId) ??
        runtime.resolveBuildBaseId?.(targetId) ??
        targetId;

    if (image.buildBaseTargetId && base) {
        return base === image.buildBaseTargetId;
    }

    const legacy = image.allowedWebTargetIds;
    if (legacy && legacy.length > 0) {
        const bases = new Set(
            legacy.map(
                (id) =>
                    runtime.getTargetBuildBaseId?.(id) ??
                    runtime.resolveBuildBaseId?.(id) ??
                    id
            )
        );
        return bases.has(base);
    }

    if (image.compileBoard) {
        const compile = runtime.getCompileTarget?.(targetId);
        return compile?.board === image.compileBoard;
    }

    return true;
}
