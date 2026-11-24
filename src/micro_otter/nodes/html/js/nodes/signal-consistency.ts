// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Signal reference consistency (pure functions).
 *
 * A signal name exists only while one `signal-post` node *declares* it. Every `event`
 * graph's `signalNames` merely references names. This module keeps the two in agreement:
 *
 * - a rename of a declared signal rewrites every referencing graph's `signalNames`;
 * - when a declaration disappears (the node cleared or renamed its name, or was removed),
 *   the name is dropped from every referencing graph's `signalNames`.
 *
 * Duplicate declarations are left alone: they are a validation error (a graph rule), and
 * "merging" them would silently pick a winner. A rename onto a name another node already
 * declares is likewise left alone.
 *
 * Only the pure functions live here. The `SignalReferenceReconciler` that applies these
 * patches through `NodeGraph.setSignalNames` lands in phase 6, where the model setter
 * exists.
 */

import {
    SIGNAL_CONTROL_ID,
    CUSTOM_SIGNAL_CONTROL_ID,
    isSignalPostType,
    signalNameOf,
} from './signal-names.js';
import { VAR_NEW_SENTINEL } from './var-stores.js';

/** A declared signal, ready for comparison and reporting. */
export interface SignalDeclaration {
    name: string;
    nodeId: string;
}

/** A new `signalNames` list for one graph. */
export interface SignalReferencePatch {
    graphId: string;
    signalNames: string[];
}

/** A node change as observed from a `node-updated` event. */
export interface SignalConsistencyChange {
    nodeId?: unknown;
    previous?: Record<string, unknown>;
    current?: Record<string, unknown> | null;
}

/** A graph's watched names, as far as reference patching is concerned. */
export interface SignalReferenceGraph {
    graphId: string;
    signalNames: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

function nodeIdOf(value: unknown): string {
    return normalizeText(asRecord(value)?.id);
}

function normalizeNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(normalizeText).filter((name) => name !== '');
}

/** The stored `signal` control value, with the sentinel resolved to `customSignal`. */
function effectiveNameOf(node: unknown): string {
    const controlValues = asRecord(asRecord(node)?.controlValues) || {};
    const raw = normalizeText(controlValues[SIGNAL_CONTROL_ID]);
    if (raw !== VAR_NEW_SENTINEL) {
        return raw;
    }
    return normalizeText(controlValues[CUSTOM_SIGNAL_CONTROL_ID]);
}

/**
 * The `previous → current` name pair of a rename, or `null` when the change is not one.
 *
 * Only a control edit of a still-declaring `signal-post` node can be a rename. Clearing
 * the name and removing the node are handled by the removal path instead.
 *
 * @param change - A `node-updated` change descriptor.
 * @returns The old and new name, or `null`.
 */
function renameForChange(
    change: SignalConsistencyChange
): { previous: string; next: string } | null {
    const previous = asRecord(change?.previous);
    const current = asRecord(change?.current);
    if (!previous || !current || !isSignalPostType(current.type)) {
        return null;
    }
    const prevName = effectiveNameOf(previous);
    const nextName = effectiveNameOf(current);
    if (!prevName || !nextName || prevName === nextName) {
        return null;
    }
    return { previous: prevName, next: nextName };
}

/**
 * The name a change removed, or an empty string when it removed nothing.
 *
 * A removal is a `signal-post` node that previously declared a name and now declares none
 * (cleared its name or was deleted).
 *
 * @param change - A `node-updated` change descriptor.
 * @returns The removed name, or an empty string.
 */
function removedNameForChange(change: SignalConsistencyChange): string {
    const previous = asRecord(change?.previous);
    const current = asRecord(change?.current);
    if (!previous || !isSignalPostType(previous.type)) {
        return '';
    }
    const prevName = effectiveNameOf(previous);
    if (!prevName) {
        return '';
    }
    if (!current || !isSignalPostType(current.type) || !effectiveNameOf(current)) {
        return prevName;
    }
    return '';
}

/**
 * Every signal name declared by the given nodes.
 * @param nodes - Flat list of nodes (any graph).
 * @returns Declared entries, including the id of the node that declares each one.
 */
export function declaredSignalEntries(nodes: unknown[]): SignalDeclaration[] {
    const entries: SignalDeclaration[] = [];
    (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
        const node = asRecord(raw);
        if (!node || !isSignalPostType(node.type)) {
            return;
        }
        const name = signalNameOf(node);
        if (name) {
            entries.push({ name, nodeId: nodeIdOf(node) });
        }
    });
    return entries;
}

/**
 * Watched names that no declaration covers.
 * @param signalNames - A graph's `signalNames` (or any watched-name list).
 * @param declaredNames - The declared names (or the entries carrying them).
 * @returns The dangling watched names, in input order.
 */
export function danglingSignalReferences(signalNames: unknown, declaredNames: unknown): string[] {
    const declared = new Set<string>();
    (Array.isArray(declaredNames) ? declaredNames : []).forEach((entry) => {
        const record = asRecord(entry);
        const name = record ? normalizeText(record.name) : normalizeText(entry);
        if (name) {
            declared.add(name);
        }
    });
    return normalizeNames(signalNames).filter((name) => !declared.has(name));
}


/**
 * Reference patches for a single node change, or an empty list when nothing changes.
 *
 * A rename rewrites the old name to the new one in every referencing graph; a removal
 * drops the removed name from every referencing graph. A rename onto a name another
 * node already declares is left alone, matching the duplicate-declaration rule.
 *
 * @param change - A `node-updated` change descriptor.
 * @param declared - Declared entries over all nodes.
 * @param references - The graphs and their watched names.
 * @returns One patch per graph whose `signalNames` changed.
 */
export function signalReferencePatchesForChange(
    change: SignalConsistencyChange,
    declared: SignalDeclaration[],
    references: SignalReferenceGraph[]
): SignalReferencePatch[] {
    const rename = renameForChange(change);
    if (rename) {
        const declaredByOther = declared.some(
            (entry) => entry.name === rename.next && entry.nodeId !== nodeIdOf(change.current)
        );
        if (declaredByOther) {
            return [];
        }
        return references
            .map((ref) => {
                const names = normalizeNames(ref.signalNames);
                if (!names.includes(rename.previous)) {
                    return null;
                }
                return {
                    graphId: ref.graphId,
                    signalNames: names.map((name) =>
                        name === rename.previous ? rename.next : name
                    ),
                };
            })
            .filter((patch): patch is SignalReferencePatch => patch !== null);
    }

    const removed = removedNameForChange(change);
    if (!removed) {
        return [];
    }
    return references
        .map((ref) => {
            const names = normalizeNames(ref.signalNames);
            if (!names.includes(removed)) {
                return null;
            }
            return {
                graphId: ref.graphId,
                signalNames: names.filter((name) => name !== removed),
            };
        })
        .filter((patch): patch is SignalReferencePatch => patch !== null);
}

/** The subset of a graph the reconciler needs. */
export interface SignalConsistencyGraph {
    getId?: () => string;
    getNodes?: () => unknown[];
    getSignalNames?: () => unknown;
    setSignalNames?: (names: string[]) => unknown;
}

function flatSignalNodes(graphs: SignalConsistencyGraph[]): unknown[] {
    const nodes: unknown[] = [];
    graphs.forEach((graph) => {
        const raw = graph?.getNodes?.() ?? [];
        (Array.isArray(raw) ? raw : []).forEach((node) => nodes.push(node));
    });
    return nodes;
}

/**
 * Apply rename + repair patches across every graph of a collection.
 *
 * A rename of a `signal-post` node rewrites the referencing graphs' `signalNames`; a removal
 * drops the name. Dangling references (a name no declaration covers, e.g. after a load) are
 * reset on every pass. Re-entrant `signalTrigger` events (each `setSignalNames` emits one) are
 * ignored while a pass is in flight, and the pass is idempotent.
 */
export class SignalReferenceReconciler {
    private readonly getGraphs: () => SignalConsistencyGraph[];
    private reconciling = false;

    constructor(getGraphs: () => SignalConsistencyGraph[]) {
        this.getGraphs = getGraphs;
    }

    /**
     * Reconcile the collection after a node change.
     *
     * A rename of a `signal-post` node rewrites the referencing graphs' `signalNames`; a removal
     * or cleared name drops it. Unproduced watched names are intentionally left alone: they are a
     * graph-rule warning, not a hard error, so a graph may watch a signal before its producer
     * exists. Re-entrant `signalTrigger` events (each `setSignalNames` emits one) are ignored while
     * a pass is in flight.
     *
     * @param change - Changed-node descriptor from a `node-updated` event.
     */
    reconcile(change?: SignalConsistencyChange): void {
        if (this.reconciling || !change) {
            return;
        }
        this.reconciling = true;
        try {
            const graphs = this.getGraphs();
            const declared = declaredSignalEntries(flatSignalNodes(graphs));
            const references: SignalReferenceGraph[] = graphs.map((graph) => ({
                graphId: normalizeText(graph?.getId?.()),
                signalNames: normalizeNames(graph?.getSignalNames?.()),
            }));
            this.apply(signalReferencePatchesForChange(change, declared, references), graphs);
        } finally {
            this.reconciling = false;
        }
    }

    /**
     * Write the graph-level patches through each owning graph's `setSignalNames`.
     * @param patches - Patches to apply.
     * @param graphs - Graphs to look patches up in.
     */
    private apply(patches: SignalReferencePatch[], graphs: SignalConsistencyGraph[]): void {
        patches.forEach((patch) => {
            const graph = graphs.find(
                (candidate) => normalizeText(candidate?.getId?.()) === patch.graphId
            );
            if (graph && typeof graph.setSignalNames === 'function') {
                graph.setSignalNames(patch.signalNames);
            }
        });
    }
}

