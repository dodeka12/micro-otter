// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Package-usage inference shared by the firmware build UI and the deploy path.
 *
 * A full node-type id is ``<packageId>.<shortId>`` (the editor also accepts a
 * legacy dash-only form ``<packageId>-<shortId>``). The two helpers here turn a set
 * of node-type ids into the set of package ids a firmware image must contain,
 * closing over each package's ``requiredPackages``.
 */

import { isFunctionGraphManagedNodeType } from './graph-function-nodes.js';

/**
 * Return the package id a full node-type id belongs to.
 *
 * The split is at the first ``.`` or ``-`` separator (whichever comes first); a
 * bare id with no separator is already a package id. This mirrors the inline split
 * the collection-deploy path performs, so the firmware "Minimal" button and the
 * deploy resolver agree on the same boundary.
 *
 * @param {string} typeId - a full node-type id such as ``led.led-neopixel-output``.
 * @returns {string} the package id, or ``""`` for a blank id.
 */
export function packageIdForNodeType(typeId: string): string {
    const normalized = String(typeId ?? '').trim();
    if (!normalized) {
        return '';
    }

    const dotIndex = normalized.indexOf('.');
    const dashIndex = normalized.indexOf('-');
    const splitIndex =
        dotIndex >= 0 && dashIndex >= 0
            ? Math.min(dotIndex, dashIndex)
            : Math.max(dotIndex, dashIndex);

    return splitIndex > 0 ? normalized.slice(0, splitIndex).trim() : normalized;
}

/**
 * Return the package ids used by *nodeTypeIds*, including transitively required packages.
 *
 * The initial set is every package id derived from the node-type ids; then each
 * package's ``requiredPackages`` is walked breadth-first and added. Cycles and
 * unknown ids terminate because membership is checked before re-queuing.
 *
 * Function-graph-managed ids (``function_graph.<graphId>`` call nodes and the
 * structural ``graph.function.*`` nodes) are skipped: the app generates them, so no
 * firmware package provides them and they must not count as an unresolved package.
 *
 * @param {string[]} nodeTypeIds - full node-type ids from the active collection.
 * @param {Array<{id: string | null; requiredPackages?: string[] | null}>} packages -
 *     package descriptors carrying the ``requiredPackages`` closure.
 * @returns {Set<string>} the set of package ids in use, in no guaranteed order.
 */
export function collectUsedPackageIds(
    nodeTypeIds: string[],
    packages: Array<{ id: string | null; requiredPackages?: string[] | null }>
): Set<string> {
    const requiredById = new Map<string, string[]>();
    for (const nodePackage of packages) {
        const packageId = String(nodePackage?.id ?? '').trim();
        if (!packageId) {
            continue;
        }
        requiredById.set(
            packageId,
            Array.isArray(nodePackage?.requiredPackages)
                ? nodePackage.requiredPackages
                      .map((entry) => String(entry ?? '').trim())
                      .filter(Boolean)
                : []
        );
    }

    const used = new Set<string>();
    for (const nodeTypeId of nodeTypeIds) {
        if (isFunctionGraphManagedNodeType(nodeTypeId)) {
            continue;
        }
        const packageId = packageIdForNodeType(nodeTypeId);
        if (packageId) {
            used.add(packageId);
        }
    }

    const queue = Array.from(used);
    while (queue.length > 0) {
        const packageId = queue.shift() as string;
        for (const dependencyId of requiredById.get(packageId) || []) {
            if (used.has(dependencyId)) {
                continue;
            }
            used.add(dependencyId);
            queue.push(dependencyId);
        }
    }

    return used;
}
