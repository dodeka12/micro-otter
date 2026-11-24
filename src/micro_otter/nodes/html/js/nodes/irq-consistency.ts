// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Interrupt reference consistency.
 *
 * An interrupt channel exists only while one `interrupt-input` node *declares* it (a non-blank
 * `triggerName`). Every `interrupt-enable` node and every `irq`-mode graph that names a channel
 * merely references it. This module keeps the two in agreement:
 *
 * - a rename of a declared channel rewrites every reference to the new name, including the
 *   `triggerName` a graph stores for its `irq` mode;
 * - when a declaration disappears (the node cleared or renamed its name, or was removed), every
 *   reference that no longer has a declaration is reset to "not set" (`''`).
 *
 * Duplicate declarations are left alone: they are a validation error (the
 * `irq-name-duplicate` graph rule), and "merging" them would silently pick a winner.
 *
 * The logic is split into pure functions (unit-testable over plain node objects) and a small
 * `IrqReferenceReconciler` that walks the graphs of a collection and applies the resulting
 * patches through each owning graph's `updateNode` / `setTriggerName`.
 */

import {
    IRQ_TRIGGER_NAME_CONTROL_ID,
    irqTriggerNameOf,
    isIrqEnableNodeType,
    isIrqInputNodeType,
} from './irq-triggers.js';

/** A write to one node's `controlValues.triggerName`. */
export interface IrqReferencePatch {
    nodeId: string;
    /** Value to store in `controlValues.triggerName`. */
    name: string;
}

/** A declared interrupt channel, ready for comparison and reporting. */
export interface IrqTriggerDeclaration {
    name: string;
    nodeId: string;
}

/** The subset of a graph the reconciler needs. */
export interface IrqConsistencyGraph {
    getId?: () => string;
    getNodes?: () => unknown[];
    updateNode?: (
        id: string,
        patch: Record<string, unknown>,
        previous?: Record<string, unknown>
    ) => unknown;
    getTriggerName?: () => unknown;
    setTriggerName?: (name: string) => unknown;
}

/** A node change as observed from a `node-updated` event. */
export interface IrqConsistencyChange {
    nodeId?: unknown;
    previous?: Record<string, unknown>;
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

function controlValuesOf(node: unknown): Record<string, unknown> {
    return asRecord(asRecord(node)?.controlValues) || {};
}

/**
 * The `previous → current` name pair of a rename, or `null` when the change is not one.
 *
 * Only a control edit of a still-declaring `interrupt-input` node can be a rename. Clearing the
 * name, changing the pin, and deleting the node are handled by {@link danglingIrqReferences}.
 *
 * @param previous - `node-updated.detail.previous` of the changed node.
 * @param current - The changed node in its current state.
 * @returns The old and new name, or `null`.
 */
function renamePairForChange(
    previous: Record<string, unknown> | null | undefined,
    current: unknown
): { previous: string; next: string } | null {
    if (
        !previous ||
        !Object.prototype.hasOwnProperty.call(previous, 'controlValues') ||
        Object.prototype.hasOwnProperty.call(previous, 'inputDefaults')
    ) {
        // Only a control edit can be a rename; an input-default edit is not one.
        return null;
    }
    const currentNode = asRecord(current);
    if (!currentNode || !isIrqInputNodeType(currentNode.type)) {
        return null;
    }
    const prevName = normalizeText(
        (asRecord(previous.controlValues) || {})[IRQ_TRIGGER_NAME_CONTROL_ID]
    );
    const nextName = irqTriggerNameOf(currentNode);
    if (!prevName || !nextName || prevName === nextName) {
        return null;
    }
    return { previous: prevName, next: nextName };
}

/**
 * Every interrupt channel declared by the given nodes.
 * @param nodes - Flat list of nodes (any graph).
 * @returns Declared entries, including the id of the node that declares each one.
 */
export function declaredIrqEntries(nodes: unknown[]): IrqTriggerDeclaration[] {
    const entries: IrqTriggerDeclaration[] = [];
    (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
        const node = asRecord(raw);
        if (!node || !isIrqInputNodeType(node.type)) {
            return;
        }
        const name = irqTriggerNameOf(node);
        if (name) {
            entries.push({ name, nodeId: nodeIdOf(node) });
        }
    });
    return entries;
}

/**
 * References that point at a channel no declaration covers.
 *
 * A declaration may disappear because its node cleared the name or was deleted. Each such
 * `interrupt-enable` reference gets `triggerName` reset to `''` ("(not set)"). Graph-level
 * `triggerName` values are repaired by the reconciler, which owns the graphs.
 *
 * @param nodes - Flat list of nodes (any graph).
 * @returns One patch per dangling `interrupt-enable` reference.
 */
export function danglingIrqReferences(nodes: unknown[]): IrqReferencePatch[] {
    const declarations = new Set(declaredIrqEntries(nodes).map((entry) => entry.name));
    const patches: IrqReferencePatch[] = [];

    (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
        const node = asRecord(raw);
        if (!node || !isIrqEnableNodeType(node.type)) {
            return;
        }
        const name = irqTriggerNameOf(node);
        if (!name || declarations.has(name)) {
            return;
        }
        patches.push({ nodeId: nodeIdOf(node), name: '' });
    });

    return patches;
}

/**
 * Rename patches for a single node change, or an empty list when nothing is renamed.
 *
 * @param previous - The `previous` snapshot of the changed node (`node-updated.detail.previous`).
 * @param current - The changed node in its current state.
 * @param nodes - Flat list of nodes the references are looked up in.
 * @returns Patches rewriting every `interrupt-enable` reference of the old name.
 */
export function irqReferencePatchesForChange(
    previous: Record<string, unknown> | null | undefined,
    current: unknown,
    nodes: unknown[]
): IrqReferencePatch[] {
    const rename = renamePairForChange(previous, current);
    if (!rename) {
        return [];
    }

    const currentId = nodeIdOf(current);
    const patches: IrqReferencePatch[] = [];
    (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
        const node = asRecord(raw);
        if (!node || !isIrqEnableNodeType(node.type) || nodeIdOf(node) === currentId) {
            return;
        }
        if (irqTriggerNameOf(node) === rename.previous) {
            patches.push({ nodeId: nodeIdOf(node), name: rename.next });
        }
    });
    return patches;
}

/**
 * Apply rename + repair patches across every graph of a collection.
 *
 * Re-entrant `node-updated` events (each applied patch emits one) are ignored while a pass is in
 * flight, and the pass is idempotent, so it converges after a single extra no-op pass. Graph
 * `triggerName` values are rewritten through `setTriggerName()`, which emits its own event and is
 * likewise ignored while the pass is in flight.
 */
export class IrqReferenceReconciler {
    private readonly getGraphs: () => IrqConsistencyGraph[];
    private reconciling = false;

    constructor(getGraphs: () => IrqConsistencyGraph[]) {
        this.getGraphs = getGraphs;
    }

    /**
     * Reconcile the collection after a node change (or as a plain repair pass).
     * @param change - Optional changed-node descriptor from a `node-updated` event.
     */
    reconcile(change?: IrqConsistencyChange): void {
        if (this.reconciling) {
            return;
        }
        this.reconciling = true;
        try {
            const graphs = this.getGraphs();
            const entries: Array<{
                graph: IrqConsistencyGraph;
                node: Record<string, unknown>;
            }> = [];
            graphs.forEach((graph) => {
                const nodes = graph?.getNodes?.() ?? [];
                (Array.isArray(nodes) ? nodes : []).forEach((raw) => {
                    const node = asRecord(raw);
                    if (
                        node &&
                        (isIrqInputNodeType(node.type) || isIrqEnableNodeType(node.type))
                    ) {
                        entries.push({ graph, node });
                    }
                });
            });
            const nodes = entries.map((entry) => entry.node);

            if (change) {
                const current = entries.find(
                    (entry) => nodeIdOf(entry.node) === normalizeText(change.nodeId)
                )?.node;
                if (current) {
                    const rename = renamePairForChange(change.previous, current);
                    this.apply(
                        irqReferencePatchesForChange(change.previous, current, nodes),
                        entries
                    );
                    if (rename) {
                        this.renameGraphTriggers(graphs, rename);
                    }
                }
            }

            this.apply(danglingIrqReferences(nodes), entries);
            this.clearDanglingGraphTriggers(graphs, nodes);
        } finally {
            this.reconciling = false;
        }
    }

    /**
     * Rewrite every graph whose `irq` trigger name equals the previous name.
     * @param graphs - All graphs of the collection.
     * @param rename - The old and new name.
     */
    private renameGraphTriggers(
        graphs: IrqConsistencyGraph[],
        rename: { previous: string; next: string }
    ): void {
        graphs.forEach((graph) => {
            if (normalizeText(graph?.getTriggerName?.()) !== rename.previous) {
                return;
            }
            if (typeof graph.setTriggerName === 'function') {
                graph.setTriggerName(rename.next);
            }
        });
    }

    /**
     * Reset every graph trigger name that no declaration covers.
     * @param graphs - All graphs of the collection.
     * @param nodes - Flat list of declared/referencing nodes.
     */
    private clearDanglingGraphTriggers(
        graphs: IrqConsistencyGraph[],
        nodes: unknown[]
    ): void {
        const declarations = new Set(declaredIrqEntries(nodes).map((entry) => entry.name));
        graphs.forEach((graph) => {
            const name = normalizeText(graph?.getTriggerName?.());
            if (!name || declarations.has(name)) {
                return;
            }
            if (typeof graph.setTriggerName === 'function') {
                graph.setTriggerName('');
            }
        });
    }

    /**
     * Write the node patches through their owning graph.
     * @param patches - Patches to apply.
     * @param entries - Nodes with the graph they belong to.
     */
    private apply(
        patches: IrqReferencePatch[],
        entries: Array<{ graph: IrqConsistencyGraph; node: Record<string, unknown> }>
    ): void {
        patches.forEach((patch) => {
            const entry = entries.find((candidate) => nodeIdOf(candidate.node) === patch.nodeId);
            if (!entry || typeof entry.graph?.updateNode !== 'function') {
                return;
            }
            const currentValues = controlValuesOf(entry.node);
            if ((currentValues[IRQ_TRIGGER_NAME_CONTROL_ID] ?? '') === patch.name) {
                return;
            }
            entry.graph.updateNode(
                patch.nodeId,
                {
                    controlValues: {
                        ...currentValues,
                        [IRQ_TRIGGER_NAME_CONTROL_ID]: patch.name,
                    },
                },
                { controlValues: currentValues }
            );
        });
    }
}

