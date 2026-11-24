// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared signal-name collector: the one definition of "which signal names does this
 * collection declare". Consumed by the `signalNames` dynamic-control source and by the
 * signal consistency reconciler, so the picker and the generated Python agree on every
 * name.
 *
 * The module is free of package imports: it only looks at node types and control values.
 * It spans the whole collection because an `event` graph may watch a signal posted by a
 * `signal-post` node in a different graph.
 */

import { bareNodeTypeId } from './graph-topics.js';
import {
    collectCollectionNodes,
    type AvailabilityCollectionLike,
    type AvailabilityGraphLike,
} from './availability-flags.js';
import { VAR_NEW_SENTINEL } from './var-stores.js';

/** `dynamicOptions.source` of the signal-name picker. */
export const SIGNAL_NAME_SOURCE = 'signalNames';

/** Bare node type id of the node that posts a signal. */
export const SIGNAL_POST_NODE_TYPE = 'signal-post';

/** Control id that holds the signal name on `signal-post`. */
export const SIGNAL_CONTROL_ID = 'signal';

/** Control id that holds a newly typed name next to the sentinel picker. */
export const CUSTOM_SIGNAL_CONTROL_ID = 'customSignal';

/** A collection as far as signal collection is concerned (`Collection.getGraphArray()`). */
export type SignalCollectionLike = AvailabilityCollectionLike;

/** A graph as far as signal collection is concerned (`NodeGraph.getNodes()`). */
export type SignalGraphLike = AvailabilityGraphLike;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Whether a node type posts a signal (`signal-post`).
 * @param type - Node type id, package prefixed or bare.
 * @returns True for the posting node type.
 */
export function isSignalPostType(type: unknown): boolean {
    return bareNodeTypeId(type) === SIGNAL_POST_NODE_TYPE;
}

/**
 * Signal name a `signal-post` node posts, applying the `__new__` sentinel contract.
 *
 * A plain `signal` control value is used as-is; the sentinel resolves to the companion
 * `customSignal` text. The sentinel is shared with the var-name picker, so both pickers
 * keep the same "type a new name" contract.
 *
 * @param node - A graph node carrying `controlValues`.
 * @returns The effective name, or an empty string when unset.
 */
export function signalNameOf(node: unknown): string {
    const record = asRecord(node);
    if (!record || !isSignalPostType(record.type)) {
        return '';
    }
    const controlValues = asRecord(record.controlValues) || {};
    const raw = normalizeText(controlValues[SIGNAL_CONTROL_ID]);
    if (raw !== VAR_NEW_SENTINEL) {
        return raw;
    }
    return normalizeText(controlValues[CUSTOM_SIGNAL_CONTROL_ID]);
}

/**
 * Every distinct non-empty signal name declared in the collection.
 *
 * Only a `signal-post` node with an effective name declares one. The list spans the whole
 * collection because an `event` graph may watch a signal posted in another graph, and it
 * is sorted so the picker order is stable across reloads.
 *
 * @param collection - Collection exposing `getGraphArray()`.
 * @param graph - Fallback graph when no collection is available.
 * @returns Signal names, de-duplicated and sorted with `localeCompare`.
 */
export function collectSignalNames(
    collection: SignalCollectionLike | null | undefined,
    graph?: SignalGraphLike | null
): string[] {
    const seen = new Set<string>();
    const names: string[] = [];

    collectCollectionNodes(collection, graph).forEach((rawNode) => {
        const node = asRecord(rawNode);
        if (!node || !isSignalPostType(node.type)) {
            return;
        }
        const name = signalNameOf(node);
        if (!name || seen.has(name)) {
            return;
        }
        seen.add(name);
        names.push(name);
    });

    return names.sort((left, right) => left.localeCompare(right));
}
