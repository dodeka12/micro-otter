// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared interrupt-trigger collector: the one definition of "which interrupt names does this
 * collection declare". Consumed by the `irqTriggerNames` dynamic-control source and by the
 * `irq` package graph rules, so the pickers and the badges agree on every name.
 *
 * The module is free of package imports: it only looks at node types and control values. It
 * spans the whole collection because an `irq`-mode graph may live in a different graph than the
 * `interrupt-input` node that declares its channel; the entry therefore carries the graph id and
 * name of the declaring node as well.
 */

import { bareNodeTypeId } from './graph-topics.js';
import {
    collectCollectionNodes,
    type AvailabilityCollectionLike,
    type AvailabilityGraphLike,
} from './availability-flags.js';

/** `dynamicOptions.source` of the interrupt-name picker. */
export const IRQ_NAME_SOURCE = 'irqTriggerNames';

/** Control id that holds an interrupt name on `interrupt-input` / `interrupt-enable`. */
export const IRQ_TRIGGER_NAME_CONTROL_ID = 'triggerName';

/** Bare node type id of the node that declares an interrupt name. */
export const IRQ_INPUT_NODE_TYPE = 'interrupt-input';

/** Bare node type id of the node that references an interrupt name. */
export const IRQ_ENABLE_NODE_TYPE = 'interrupt-enable';

/** One declared interrupt name, with the node and graph that declared it. */
export interface IrqTriggerEntry {
    name: string;
    nodeId: string;
    graphId: string;
    graphName: string;
}

/** A graph as far as trigger collection is concerned. */
export interface IrqTriggerGraphLike extends AvailabilityGraphLike {
    getId?: () => unknown;
    getName?: () => unknown;
}

/** A collection as far as trigger collection is concerned (`Collection.getGraphArray()`). */
export type IrqTriggerCollectionLike = AvailabilityCollectionLike;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Interrupt name stored on a node, trimmed.
 * @param node - A graph node carrying `controlValues`.
 * @returns The stored name, or an empty string when the node is unset.
 */
export function irqTriggerNameOf(node: unknown): string {
    const values = asRecord(asRecord(node)?.controlValues);
    return normalizeText(values?.[IRQ_TRIGGER_NAME_CONTROL_ID]);
}

/**
 * Whether a node type declares an interrupt name (`interrupt-input`).
 * @param type - Node type id, package prefixed or bare.
 * @returns True for the declaring node type.
 */
export function isIrqInputNodeType(type: unknown): boolean {
    return bareNodeTypeId(type) === IRQ_INPUT_NODE_TYPE;
}

/**
 * Whether a node type references an interrupt name (`interrupt-enable`).
 * @param type - Node type id, package prefixed or bare.
 * @returns True for the referencing node type.
 */
export function isIrqEnableNodeType(type: unknown): boolean {
    return bareNodeTypeId(type) === IRQ_ENABLE_NODE_TYPE;
}

/**
 * Graphs to walk: every graph of the collection, or the active graph when there is no collection.
 *
 * The active graph is only the fallback for detached nodes (tests, a node before the collection
 * bridge is attached); otherwise the whole collection has to be visible, because a declaration
 * in one graph feeds the pickers of every other graph.
 *
 * @param collection - Collection exposing `getGraphArray()`.
 * @param graph - Fallback graph exposing `getNodes()`.
 * @returns The graphs to collect from, in collection order.
 */
function graphsToCollect(
    collection: IrqTriggerCollectionLike | null | undefined,
    graph?: IrqTriggerGraphLike | null
): IrqTriggerGraphLike[] {
    const graphs =
        typeof collection?.getGraphArray === 'function' ? collection.getGraphArray() : [];
    if (Array.isArray(graphs) && graphs.length > 0) {
        return graphs as IrqTriggerGraphLike[];
    }
    return graph ? [graph] : [];
}

/**
 * Every interrupt name declared in the collection.
 *
 * Only an `interrupt-input` node with a non-blank, trimmed name declares one. Entries are
 * de-duplicated by name (the first declaring node wins) and sorted, exactly like
 * `collectVarNames()`, so the picker and the duplicate rule see the same list.
 *
 * @param collection - Collection exposing `getGraphArray()`.
 * @param graph - Fallback graph when no collection is available.
 * @returns One entry per declared name, naming the declaring node and graph.
 */
export function collectIrqTriggerEntries(
    collection: IrqTriggerCollectionLike | null | undefined,
    graph?: IrqTriggerGraphLike | null
): IrqTriggerEntry[] {
    const seen = new Set<string>();
    const entries: IrqTriggerEntry[] = [];

    graphsToCollect(collection, graph).forEach((entryGraph) => {
        collectCollectionNodes(null, entryGraph).forEach((rawNode) => {
            const node = asRecord(rawNode);
            if (!node || !isIrqInputNodeType(node.type)) {
                return;
            }
            const name = irqTriggerNameOf(node);
            if (!name || seen.has(name)) {
                return;
            }
            seen.add(name);
            entries.push({
                name,
                nodeId: normalizeText(node.id),
                graphId: normalizeText(entryGraph?.getId?.()),
                graphName: normalizeText(entryGraph?.getName?.()),
            });
        });
    });

    entries.sort((left, right) => left.name.localeCompare(right.name));
    return entries;
}

/**
 * Every declared interrupt name of the collection.
 * @param collection - Collection exposing `getGraphArray()`.
 * @param graph - Fallback graph when no collection is available.
 * @param excludeNodeId - Optional node id to skip, so a declaring node never lists its own name.
 * @returns Declared names, de-duplicated and sorted.
 */
export function collectIrqTriggerNames(
    collection: IrqTriggerCollectionLike | null | undefined,
    graph?: IrqTriggerGraphLike | null,
    excludeNodeId?: string
): string[] {
    const excluded = normalizeText(excludeNodeId);
    return collectIrqTriggerEntries(collection, graph)
        .filter((entry) => !excluded || entry.nodeId !== excluded)
        .map((entry) => entry.name);
}
