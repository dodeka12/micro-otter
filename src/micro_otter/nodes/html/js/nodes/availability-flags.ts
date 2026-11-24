// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared availability-flag collector: the one definition of "which availability flags does
 * this collection offer". Consumed by the `availabilityRefs` dynamic-control source and by
 * the `hass` graph rules, so the option list and the duplicate check agree on every id.
 *
 * The module is free of package imports: it only looks at node types and control values. Its
 * id sanitisation mirrors `_sanitize_id()` in `hass/otter_hass/runtime.py` — the runtime is
 * what actually builds the topic, so a disagreement would silently point at another topic.
 */

import { bareNodeTypeId } from './graph-topics.js';

/** Dynamic-control source that lists the availability flags of the collection. */
export const AVAILABILITY_REF_SOURCE = 'availabilityRefs';

/** Node type that defines one availability flag. */
export const AVAILABILITY_FLAG_NODE_TYPE = 'hass-availability';

/** Control id that holds the flag id. */
export const AVAILABILITY_FLAG_CONTROL_ID = 'id';

/**
 * Reserved option value for the bridge's device availability topic.
 *
 * It is a UI value only; the generator strips it and never passes it to the runtime. The
 * value is also reserved as a flag id, so a `hass-availability` node cannot create a second
 * option with the same value.
 */
export const DEVICE_AVAILABILITY_ENTRY = '__device__';

/** Label of the reserved device availability option. */
export const DEVICE_AVAILABILITY_LABEL = 'Device';

export interface AvailabilityFlagOption {
    value: string;
    label: string;
}

/** A collection as far as flag collection is concerned (`Collection.getGraphArray()`). */
export interface AvailabilityCollectionLike {
    getGraphArray?: () => unknown[];
}

/** A graph as far as flag collection is concerned (`NodeGraph.getNodes()`). */
export interface AvailabilityGraphLike {
    getNodes?: () => unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function nodeList(source: unknown): unknown[] {
    const record = asRecord(source);
    if (!record || typeof record.getNodes !== 'function') {
        return [];
    }
    const nodes = record.getNodes();
    return Array.isArray(nodes) ? nodes : [];
}

/**
 * Reduce a flag id to the characters that survive in a topic segment.
 * @param value - Raw flag id as typed on the node.
 * @returns The sanitised id, or an empty string when nothing usable is left.
 */
export function sanitizeAvailabilityId(value: unknown): string {
    return String(value ?? '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .replace(/^_+|_+$/g, '');
}

/**
 * Whether a graph node defines an availability flag.
 * @param node - A graph node (`type` is package prefixed on the graph).
 * @returns True for `hass-availability` nodes.
 */
export function isAvailabilityFlagNode(node: unknown): boolean {
    return bareNodeTypeId(asRecord(node)?.type) === AVAILABILITY_FLAG_NODE_TYPE;
}

/**
 * Flag id exactly as stored on a flag node (trimmed, not sanitised).
 * @param node - A graph node.
 * @returns The raw id, or an empty string when the node is unset.
 */
export function availabilityFlagIdOf(node: unknown): string {
    const values = asRecord(asRecord(node)?.controlValues);
    return String(values?.[AVAILABILITY_FLAG_CONTROL_ID] ?? '').trim();
}

/**
 * Every availability flag of the collection, de-duplicated by sanitised id and sorted.
 *
 * The reserved device entry is not a real flag node; a node whose id equals it is skipped
 * so the option list can never contain the value twice.
 *
 * @param nodes - All nodes of the collection.
 * @returns Raw ids, one per distinct topic segment.
 */
export function collectAvailabilityFlagIds(nodes: unknown): string[] {
    const entries = Array.isArray(nodes) ? nodes : [];
    const seen = new Set<string>();
    const ids: string[] = [];

    entries.forEach((node) => {
        if (!isAvailabilityFlagNode(node)) {
            return;
        }
        const id = availabilityFlagIdOf(node);
        const sanitized = sanitizeAvailabilityId(id);
        if (!id || !sanitized || id === DEVICE_AVAILABILITY_ENTRY || seen.has(sanitized)) {
            return;
        }
        seen.add(sanitized);
        ids.push(id);
    });

    return ids.sort((left, right) => left.localeCompare(right));
}

/**
 * Dropdown options for the collection's availability flags.
 *
 * The device availability entry always comes first: it belongs to the bridge rather than
 * to a flag node, so it exists even while the collection has no `hass-availability` node.
 *
 * @param nodes - All nodes of the collection.
 * @returns The device option followed by one option per named flag.
 */
export function availabilityFlagOptions(nodes: unknown): AvailabilityFlagOption[] {
    return [
        { value: DEVICE_AVAILABILITY_ENTRY, label: DEVICE_AVAILABILITY_LABEL },
        ...collectAvailabilityFlagIds(nodes).map((id) => {
            const sanitized = sanitizeAvailabilityId(id);
            return {
                value: id,
                label: sanitized === id ? id : `${id} \u2192 ${sanitized}`,
            };
        }),
    ];
}

/**
 * Every node of the collection, falling back to the current graph.
 *
 * A flag lives next to the bridge, not next to the entity, so the option list has to span the
 * collection. The graph is only used when no collection is available (tests, detached nodes).
 *
 * @param collection - Collection exposing `getGraphArray()`.
 * @param graph - Fallback graph exposing `getNodes()`.
 * @returns The nodes of every graph of the collection.
 */
export function collectCollectionNodes(
    collection: AvailabilityCollectionLike | null | undefined,
    graph?: AvailabilityGraphLike | null
): unknown[] {
    const graphs = typeof collection?.getGraphArray === 'function' ? collection.getGraphArray() : [];
    const nodes: unknown[] = [];

    if (Array.isArray(graphs)) {
        graphs.forEach((entry) => nodes.push(...nodeList(entry)));
    }

    return nodes.length > 0 ? nodes : nodeList(graph);
}
