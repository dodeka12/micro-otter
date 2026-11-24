// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Variable reference consistency.
 *
 * A variable exists only while exactly one `var-read` / `var-write` node *declares* it (Name
 * picker on `__new__` with a non-empty `customName`). Every other node that holds a plain `name`
 * merely references that variable. This module keeps the two in agreement:
 *
 * - a rename of a declared variable rewrites every reference to the new name;
 * - when a declaration disappears (the node switches away, clears the name, changes store, or is
 *   removed), every reference that no longer has a declaration is reset to "not set" (`''`).
 *
 * The logic is split into pure functions (unit-testable over plain node objects) and a small
 * `VarReferenceReconciler` that walks the graphs of a collection and applies the resulting
 * patches through each owning graph's `updateNode`.
 */

import {
    DEFAULT_VAR_STORE,
    VAR_NAME_CONTROL_ID,
    VAR_NEW_SENTINEL,
    customVarControlId,
    declaredVarEntry,
    effectiveVarName,
    effectiveVarStoreName,
    isVarNameDeclaration,
    isVarNameNode,
} from './var-stores.js';

/** A write to one node's `controlValues.name`. */
export interface VarReferencePatch {
    nodeId: string;
    /** Value to store in `controlValues.name`. */
    name: string;
}

/** A declared variable, ready for comparison and reporting. */
export interface VarDeclarationEntry {
    store: string;
    name: string;
    nodeId: string;
}

/** The subset of a graph the reconciler needs. */
export interface VarConsistencyGraph {
    getNodes?: () => unknown[];
    updateNode?: (
        id: string,
        patch: Record<string, unknown>,
        previous?: Record<string, unknown>
    ) => unknown;
}

/** A node change as observed from a `node-updated` event. */
export interface VarConsistencyChange {
    nodeId?: unknown;
    previous?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function nodeIdOf(value: unknown): string {
    return String(asRecord(value)?.id ?? '').trim();
}

function controlValuesOf(node: unknown): Record<string, unknown> {
    return asRecord(asRecord(node)?.controlValues) || {};
}

/** Stable key for a `(store, name)` pair, safe from accidental collisions. */
export function declarationKey(store: string, name: string): string {
    return `${store}\u0000${name}`;
}

/**
 * Every variable declared by the given nodes.
 *
 * @param nodes - Flat list of nodes (any graph).
 * @returns Declared entries, including the id of the node that declares each one.
 */
export function declaredVarEntries(nodes: unknown[]): VarDeclarationEntry[] {
    const entries: VarDeclarationEntry[] = [];
    (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
        const entry = declaredVarEntry(raw);
        if (entry) {
            entries.push({ ...entry, nodeId: nodeIdOf(raw) });
        }
    });
    return entries;
}

/**
 * References that point at a variable no declaration covers.
 *
 * A declaration may disappear because its node switched to "use", cleared the name, changed
 * store, or was deleted. Each such reference gets `name` reset to `''` ("(not set)").
 *
 * @param nodes - Flat list of nodes (any graph).
 * @returns One patch per dangling reference.
 */
export function danglingVarReferences(nodes: unknown[]): VarReferencePatch[] {
    const declarations = new Set(
        declaredVarEntries(nodes).map((entry) => declarationKey(entry.store, entry.name))
    );
    const patches: VarReferencePatch[] = [];

    (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
        const node = asRecord(raw);
        if (!node || !isVarNameNode(node.type) || isVarNameDeclaration(node)) {
            return;
        }
        const name = effectiveVarName(node);
        if (!name) {
            return;
        }
        const store = effectiveVarStoreName(node) || DEFAULT_VAR_STORE;
        if (declarations.has(declarationKey(store, name))) {
            return;
        }
        patches.push({ nodeId: nodeIdOf(node), name: '' });
    });

    return patches;
}

/**
 * Rename patches for a single node change, or an empty list when nothing is renamed.
 *
 * A rename is the one propagation that needs the *previous* value: a declaring node kept
 * declaring and only its `customName` changed. Anything else — switching to "use", clearing the
 * name, changing store, deleting the node — is handled by {@link danglingVarReferences} instead.
 *
 * @param previous - The `previous` snapshot of the changed node (`node-updated.detail.previous`).
 * @param current - The changed node in its current state.
 * @param nodes - Flat list of nodes the references are looked up in.
 * @returns Patches rewriting every reference of the old name to the new name.
 */
export function varReferencePatchesForChange(
    previous: Record<string, unknown> | null | undefined,
    current: unknown,
    nodes: unknown[]
): VarReferencePatch[] {
    if (
        !previous ||
        !Object.prototype.hasOwnProperty.call(previous, 'controlValues') ||
        Object.prototype.hasOwnProperty.call(previous, 'inputDefaults')
    ) {
        // Only a control edit can be a rename; a store (input default) edit is a store change.
        return [];
    }

    const prevControls = asRecord(previous.controlValues) || {};
    const prevWasDeclaring =
        String(prevControls[VAR_NAME_CONTROL_ID] ?? '').trim() === VAR_NEW_SENTINEL &&
        String(prevControls[customVarControlId(VAR_NAME_CONTROL_ID)] ?? '').trim() !== '';
    const entry = declaredVarEntry(current);
    if (!prevWasDeclaring || !entry) {
        return [];
    }

    const prevName = String(prevControls[customVarControlId(VAR_NAME_CONTROL_ID)] ?? '').trim();
    if (!prevName || prevName === entry.name) {
        return [];
    }

    const currentId = nodeIdOf(current);
    const patches: VarReferencePatch[] = [];
    (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
        const node = asRecord(raw);
        if (!node || !isVarNameNode(node.type)) {
            return;
        }
        if (nodeIdOf(node) === currentId) {
            return;
        }
        if (
            (effectiveVarStoreName(node) || DEFAULT_VAR_STORE) === entry.store &&
            effectiveVarName(node) === prevName
        ) {
            patches.push({ nodeId: nodeIdOf(node), name: entry.name });
        }
    });
    return patches;
}

/**
 * Apply rename + repair patches across every graph of a collection.
 *
 * Re-entrant `node-updated` events (each applied patch emits one) are ignored while a pass is in
 * flight, and the pass is idempotent, so it converges after a single extra no-op pass.
 */
export class VarReferenceReconciler {
    private readonly getGraphs: () => VarConsistencyGraph[];
    private reconciling = false;

    constructor(getGraphs: () => VarConsistencyGraph[]) {
        this.getGraphs = getGraphs;
    }

    reconcile(change?: VarConsistencyChange): void {
        if (this.reconciling) {
            return;
        }
        this.reconciling = true;
        try {
            const entries: Array<{
                graph: VarConsistencyGraph;
                node: Record<string, unknown>;
            }> = [];
            this.getGraphs().forEach((graph) => {
                const nodes = graph?.getNodes?.() ?? [];
                (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
                    const node = asRecord(raw);
                    if (node && isVarNameNode(node.type)) {
                        entries.push({ graph, node });
                    }
                });
            });

            if (change) {
                const current = entries.find(
                    (entry) => nodeIdOf(entry.node) === String(change.nodeId ?? '')
                )?.node;
                if (current) {
                    this.apply(
                        varReferencePatchesForChange(
                            change.previous,
                            current,
                            entries.map((entry) => entry.node)
                        ),
                        entries
                    );
                }
            }

            this.apply(danglingVarReferences(entries.map((entry) => entry.node)), entries);
        } finally {
            this.reconciling = false;
        }
    }

    private apply(
        patches: VarReferencePatch[],
        entries: Array<{ graph: VarConsistencyGraph; node: Record<string, unknown> }>
    ): void {
        patches.forEach((patch) => {
            const entry = entries.find((candidate) => nodeIdOf(candidate.node) === patch.nodeId);
            if (!entry || typeof entry.graph?.updateNode !== 'function') {
                return;
            }
            const currentValues = controlValuesOf(entry.node);
            if ((currentValues[VAR_NAME_CONTROL_ID] ?? '') === patch.name) {
                return;
            }
            entry.graph.updateNode(
                patch.nodeId,
                { controlValues: { ...currentValues, [VAR_NAME_CONTROL_ID]: patch.name } },
                { controlValues: currentValues }
            );
        });
    }
}


