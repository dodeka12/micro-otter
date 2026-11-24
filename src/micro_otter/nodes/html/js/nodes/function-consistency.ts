// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Function-call node consistency.
 *
 * A function graph owns its interface; every placed call node (`function_graph.<graphId>`)
 * in every graph of the collection is a snapshot of that interface, taken when the node
 * was dropped from the palette. Connections address connectors by index, so a call node
 * that keeps stale connectors silently wires the wrong parameter, and a reorder that
 * leaves the wires behind silently swaps two arguments.
 *
 * This module closes that gap. `NodeGraph` emits a `functionSignature` change carrying
 * the previous signature and — when a connector moved or disappeared — an old→new index
 * mapping; `FunctionCallNodeReconciler` walks every graph of the collection, rebuilds the
 * call nodes' connectors from the new signature, re-points their wiring and copies the
 * header icon across, so a placed call node always mirrors its source graph.
 *
 * Design rules encoded here:
 *
 * - **Connectors are authoritative by position, wiring follows the mapping.** Port ids are
 *   re-derived from the index on every normalization, so an id is not an identity across an
 *   edit; only the mutation knows where each connector went.
 * - **Detach before patching.** `NodeGraph.updateNode()` prunes wires that point at
 *   connectors it is about to drop, which would discard the very wires this pass has to
 *   move. The pass therefore detaches, patches, then re-attaches.
 * - **Idempotent by construction.** Wiring is only remapped on a side whose connector list
 *   actually changed, so replaying the same event cannot shift a wire twice. When two ports
 *   are indistinguishable (same name, same types), the connector list does not change and
 *   the wires stay where they are — the best available answer for an ambiguous interface.
 * - **Best effort, never throwing.** Edits come from UI change handlers; a wire that the new
 *   interface no longer accepts is dropped with a log entry instead of aborting the pass.
 *
 * @module nodes/function-consistency
 */

import { buildFunctionConnectorDescriptors } from '../data/graph-function-nodes.js';
import {
    buildFunctionNodeTypeId,
    createFunctionPortId,
    normalizeFunctionSignature,
    resolveFunctionPortDefault,
    resolveFunctionPortDefaultControlType,
} from '../data/graph-function-signature.js';
import type {
    FunctionPortIndexMapping,
    FunctionPortKind,
    FunctionSignature,
} from '../data/graph-function-signature.js';

/** One connection, in the shape the reconciler reads and rewrites. */
export interface FunctionCallConnection {
    fromNode: string;
    fromIndex: number;
    toNode: string;
    toIndex: number;
}

/** The subset of a graph the reconciler needs. */
export interface FunctionConsistencyGraph {
    getId?: () => string;
    getNodes?: () => unknown[];
    getConnections?: () => unknown[];
    updateNode?: (id: string, patch: Record<string, unknown>) => unknown;
    addConnection?: (connection: FunctionCallConnection) => unknown;
    removeConnection?: (
        fromNode: string,
        fromIndex: number,
        toNode: string,
        toIndex: number
    ) => unknown;
}

/** A `functionSignature` change as observed from the graph event stream. */
export interface FunctionSignatureChange {
    graphId?: unknown;
    functionSignature?: unknown;
    previousSignature?: unknown;
    indexMapping?: unknown;
}

/** One remap rule: the explicit mapping (or none) plus the new connector count. */
interface ConnectorSidePlan {
    /** Explicit old→new mapping, or `null` when the side keeps its connector indices. */
    mapping: FunctionPortIndexMapping | null;
    /** Number of connectors the side has after the edit. */
    count: number;
}

/** A connection touching a call node, with its endpoints after the edit. */
interface ConnectionRewrite {
    /** Endpoints as they are stored right now. */
    connection: FunctionCallConnection;
    /** Endpoints to restore, or `null` when the edit removed the connector it used. */
    next: FunctionCallConnection | null;
}

/**
 * Read a value as a plain record.
 * @param value - Candidate value.
 * @returns The value as a record, or `null` for non-objects.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Normalize a value to trimmed text.
 * @param value - Candidate value.
 * @returns The trimmed text, or `''`.
 */
function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Normalize a stored connector index.
 * @param value - Candidate value.
 * @returns The integer index, or `-1` when the value is not a non-negative integer.
 */
function normalizeIndex(value: unknown): number {
    return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : -1;
}

/**
 * Normalize a stored connection.
 *
 * Unknown shapes return `null` instead of throwing: connections are read from live graph
 * state, but the reconciler must never abort a pass because one entry is malformed.
 *
 * @param value - Candidate connection.
 * @returns The normalized connection, or `null`.
 */
function normalizeConnection(value: unknown): FunctionCallConnection | null {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const fromNode = normalizeText(record.fromNode);
    const toNode = normalizeText(record.toNode);
    const fromIndex = normalizeIndex(record.fromIndex);
    const toIndex = normalizeIndex(record.toIndex);
    if (!fromNode || !toNode || fromIndex < 0 || toIndex < 0) {
        return null;
    }
    return { fromNode, fromIndex, toNode, toIndex };
}

/**
 * Normalize an event's old→new index mapping.
 *
 * A missing or malformed mapping degrades to `null` ("no connector moved"), which is the
 * safe reading: the pass then keeps every wire on its current index.
 *
 * @param value - `indexMapping` from the `functionSignature` payload.
 * @returns The normalized mapping, or `null`.
 */
function normalizeIndexMapping(value: unknown): FunctionPortIndexMapping | null {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const kind: FunctionPortKind | null =
        record.kind === 'output' ? 'output' : record.kind === 'input' ? 'input' : null;
    if (!kind || !Array.isArray(record.fromOldToNew)) {
        return null;
    }
    return {
        kind,
        fromOldToNew: record.fromOldToNew.map((entry) => {
            const index = normalizeIndex(entry);
            return index < 0 ? null : index;
        }),
    };
}

/**
 * Compare two type lists by value.
 * @param left - Candidate stored list.
 * @param right - Expected list.
 * @returns True when both hold the same type ids in the same order.
 */
function stringListsEqual(left: unknown, right: readonly string[]): boolean {
    if (!Array.isArray(left) || left.length !== right.length) {
        return false;
    }
    return right.every((value, index) => left[index] === value);
}

/**
 * Compare two default-control payloads by value.
 * @param left - Candidate stored control.
 * @param right - Expected control.
 * @returns True when both are absent or carry the same fields.
 */
function defaultControlEquals(left: unknown, right: unknown): boolean {
    const recordLeft = asRecord(left);
    const recordRight = asRecord(right);
    if (!recordLeft || !recordRight) {
        return recordLeft === recordRight;
    }
    return (
        recordLeft.type === recordRight.type &&
        recordLeft.default === recordRight.default &&
        recordLeft.label === recordRight.label &&
        recordLeft.min === recordRight.min &&
        recordLeft.max === recordRight.max &&
        recordLeft.step === recordRight.step
    );
}

/**
 * Test whether a node's connector list mirrors a target descriptor list.
 *
 * Only the fields the signature owns are compared (`id`, `name`, `allowedTypes` and the
 * generated `defaultControl`), so a node that carries extra connector metadata is not
 * rewritten on every pass.
 *
 * @param current - Stored connector list on the node.
 * @param target - Descriptors built from the signature.
 * @returns True when every connector already matches.
 */
function connectorListMatches(
    current: unknown,
    target: ReadonlyArray<{
        id: string;
        name: string;
        allowedTypes: string[];
        defaultControl?: unknown;
    }>
): boolean {
    if (!Array.isArray(current) || current.length !== target.length) {
        return false;
    }
    return target.every((descriptor, index) => {
        const entry = asRecord(current[index]);
        if (!entry) {
            return false;
        }
        return (
            entry.id === descriptor.id &&
            entry.name === descriptor.name &&
            stringListsEqual(entry.allowedTypes, descriptor.allowedTypes) &&
            defaultControlEquals(entry.defaultControl, descriptor.defaultControl)
        );
    });
}

/**
 * Log a failed wire rewrite without interrupting the pass.
 * @param reason - Log tag describing what failed.
 * @param detail - Structured context for the log entry.
 * @param error - Thrown value.
 */
function logRewriteFailure(reason: string, detail: Record<string, unknown>, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(reason, { ...detail, message });
}

/**
 * Resolve the connector index a stored connection must use after a signature edit.
 *
 * With a mapping the answer is the mapping's entry: a `null` entry means the port was
 * removed, so the wire has no destination. Without one the connector keeps its index,
 * which is correct for appends, renames and type edits.
 *
 * @param mapping - Old→new mapping of the edited side, or `null`.
 * @param oldIndex - Connector index stored on the connection.
 * @param connectorCount - Connector count after the edit; omit to skip the bounds check.
 * @returns The new index, or `null` when the wire must be dropped.
 */
export function remapFunctionConnectorIndex(
    mapping: FunctionPortIndexMapping | null,
    oldIndex: number,
    connectorCount?: number
): number | null {
    if (!Number.isInteger(oldIndex) || oldIndex < 0) {
        return null;
    }
    const target = mapping ? mapping.fromOldToNew[oldIndex] : oldIndex;
    if (typeof target !== 'number' || !Number.isInteger(target) || target < 0) {
        return null;
    }
    if (typeof connectorCount === 'number' && target >= connectorCount) {
        return null;
    }
    return target;
}

/**
 * Build the connector patch that re-mirrors a signature onto a placed call node.
 *
 * The descriptors come from `buildFunctionConnectorDescriptors()`, the same builder the
 * structural input/output nodes use, so a call node and the node it mirrors can never
 * disagree about connector ids, names or types. The header `icon` is synced the same way:
 * a stored icon that differs from the signature's is carried in the patch so the node keeps
 * its tint and glyph in step with the source function graph.
 *
 * @param node - Node as stored by the graph (`inputs`/`outputs`/`icon` are read).
 * @param signature - Normalized or raw signature of the source function graph.
 * @returns Only the fields that differ; `{}` when the node is current.
 */
export function buildFunctionCallConnectorPatch(
    node: unknown,
    signature: FunctionSignature | unknown
): Record<string, unknown> {
    const record = asRecord(node);
    const normalized = normalizeFunctionSignature(signature);
    const patch: Record<string, unknown> = {};

    const inputs = buildFunctionConnectorDescriptors(normalized.inputs, 'input', {
        withDefaults: true,
    });
    if (!connectorListMatches(record?.inputs, inputs)) {
        patch.inputs = inputs;
    }

    const outputs = buildFunctionConnectorDescriptors(normalized.outputs, 'output');
    if (!connectorListMatches(record?.outputs, outputs)) {
        patch.outputs = outputs;
    }

    if (normalizeText(record?.icon) !== normalized.icon) {
        patch.icon = normalized.icon;
    }

    return patch;
}

/**
 * Re-key a call node's per-input default values after its inputs were reordered or shrunk.
 *
 * Input defaults are stored per connector id (`in_0`, `in_1`, …), so a value entered for
 * one parameter has to travel with that parameter's connector. Keys that are not input ids
 * are preserved untouched, and values whose connector disappeared are dropped.
 *
 * @param inputDefaults - Current `inputDefaults` map (may be `null`/malformed).
 * @param mapping - Old→new mapping of the input list, or `null`.
 * @returns The re-keyed map, or `null` when nothing had to move.
 */
export function remapFunctionInputDefaults(
    inputDefaults: unknown,
    mapping: FunctionPortIndexMapping | null
): Record<string, unknown> | null {
    if (!mapping || mapping.kind !== 'input') {
        return null;
    }
    const source = asRecord(inputDefaults);
    if (!source) {
        return null;
    }

    const next: Record<string, unknown> = {};
    let changed = false;
    Object.entries(source).forEach(([key, value]) => {
        const match = /^in_(\d+)$/.exec(key);
        if (!match) {
            next[key] = value;
            return;
        }
        const nextIndex = remapFunctionConnectorIndex(mapping, Number(match[1]));
        if (nextIndex === null) {
            changed = true;
            return;
        }
        const nextKey = createFunctionPortId('input', nextIndex);
        if (nextKey !== key) {
            changed = true;
        }
        next[nextKey] = value;
    });

    return changed ? next : null;
}

/**
 * Reconcile a call node's stored input defaults against a signature's default controls.
 *
 * A stored value must stay compatible with the parameter's default control: a `number`
 * control keeps only finite numbers (clamped into the new bounds) and drops everything
 * else, a `checkbox` control keeps only booleans, and a `text` control keeps the stored
 * value unchanged so an `any`-typed parameter can still carry a number or string.
 *
 * @param inputDefaults - Current `inputDefaults` map (may be `null`/malformed).
 * @param signature - Normalized signature of the source function graph.
 * @returns The reconciled map, or `null` when nothing had to change.
 */
export function reconcileFunctionInputDefaults(
    inputDefaults: unknown,
    signature: FunctionSignature
): Record<string, unknown> | null {
    const source = asRecord(inputDefaults);
    if (!source) {
        return null;
    }
    const ports = signature.inputs;
    const next: Record<string, unknown> = {};
    let changed = false;

    Object.entries(source).forEach(([key, value]) => {
        const match = /^in_(\d+)$/.exec(key);
        if (!match) {
            next[key] = value;
            return;
        }
        const index = Number(match[1]);
        const port = ports[index];
        if (!port) {
            changed = true;
            return;
        }

        const defaultValue = resolveFunctionPortDefault(port);
        const controlType = resolveFunctionPortDefaultControlType(defaultValue.type);

        if (controlType === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                changed = true;
                return;
            }
            let numeric = value;
            if (typeof defaultValue.min === 'number' && Number.isFinite(defaultValue.min)) {
                numeric = Math.max(numeric, defaultValue.min);
            }
            if (typeof defaultValue.max === 'number' && Number.isFinite(defaultValue.max)) {
                numeric = Math.min(numeric, defaultValue.max);
            }
            if (numeric !== value) {
                changed = true;
                next[key] = numeric;
            } else {
                next[key] = value;
            }
            return;
        }

        if (controlType === 'checkbox') {
            if (typeof value !== 'boolean') {
                changed = true;
                return;
            }
            next[key] = value;
            return;
        }

        // `text` controls accept any stored value; keep it as-is.
        next[key] = value;
    });

    return changed ? next : null;
}

/**
 * Keep every placed call node of a function graph in sync with that graph's signature.
 *
 * Driven by the collection's `functionSignature` events: for each graph it visits the nodes
 * of type `function_graph.<graphId>`, rebuilds their connectors from the new signature,
 * re-points their wiring through the public `removeConnection()`/`addConnection()` pair and
 * copies the header `icon` (and thus the node tint/glyph) across. Structural input/output
 * nodes are a different type and are left to `NodeGraph` itself.
 */
export class FunctionCallNodeReconciler {
    /** Source of the collection's graphs; evaluated per pass so graph changes are seen. */
    private readonly getGraphs: () => FunctionConsistencyGraph[];

    /** Re-entrancy guard: a nested pass would remap wires that are already remapped. */
    private reconciling = false;

    /**
     * @param getGraphs - Provider for every graph of the owning collection.
     */
    constructor(getGraphs: () => FunctionConsistencyGraph[]) {
        this.getGraphs = getGraphs;
    }

    /**
     * Bring every placed call node of the changed function graph up to date.
     *
     * Drive this from the `functionSignature` event stream, once per event: the mapping
     * describes one edit and is meaningful only relative to the connectors that existed before
     * it. A replayed change is still harmless, because wiring is only remapped on a side whose
     * connector list actually changed. A missing graph id or signature is a no-op, and a nested
     * call (for example from a listener of the emitted node/connection events) is ignored.
     *
     * @param change - Payload of the `functionSignature` event.
     */
    reconcile(change?: FunctionSignatureChange): void {
        if (this.reconciling || !change) {
            return;
        }
        const graphId = normalizeText(change.graphId);
        if (!graphId) {
            return;
        }

        let typeId: string;
        try {
            typeId = buildFunctionNodeTypeId(graphId);
        } catch {
            return;
        }

        const signature = normalizeFunctionSignature(change.functionSignature);
        const mapping = normalizeIndexMapping(change.indexMapping);

        this.reconciling = true;
        try {
            this.getGraphs().forEach((graph) => {
                this.applyToGraph(graph, typeId, signature, mapping);
            });
        } finally {
            this.reconciling = false;
        }
    }

    /**
     * Sync the call nodes of one graph.
     *
     * @param graph - Graph to scan.
     * @param typeId - Generated node type id of the changed function graph.
     * @param signature - New signature.
     * @param mapping - Old→new mapping of the edited port list, or `null`.
     */
    private applyToGraph(
        graph: FunctionConsistencyGraph,
        typeId: string,
        signature: FunctionSignature,
        mapping: FunctionPortIndexMapping | null
    ): void {
        if (!graph || typeof graph.updateNode !== 'function') {
            return;
        }
        const nodes = graph.getNodes?.();
        if (!Array.isArray(nodes)) {
            return;
        }
        nodes.forEach((raw) => {
            const node = asRecord(raw);
            if (!node || node.type !== typeId) {
                return;
            }
            this.applyToCallNode(graph, node, signature, mapping);
        });
    }

    /**
     * Rebuild one call node's connectors and re-point the wiring it carries.
     *
     * The connector patch is computed first because it also decides whether wiring may move
     * at all: a side whose connector list did not change keeps its wires on their indices,
     * which makes the pass idempotent. When only a connector's metadata changed (rename,
     * type edit) the mapping is absent and every wire keeps its index. An icon-only edit
     * produces a bare `{ icon }` patch, so the wiring remap runs with `null` mappings and
     * leaves every connection on its current index.
     *
     * @param graph - Graph that owns the call node.
     * @param node - Call node as stored by the graph.
     * @param signature - New signature.
     * @param mapping - Old→new mapping of the edited port list, or `null`.
     */
    private applyToCallNode(
        graph: FunctionConsistencyGraph,
        node: Record<string, unknown>,
        signature: FunctionSignature,
        mapping: FunctionPortIndexMapping | null
    ): void {
        const nodeId = normalizeText(node.id);
        if (!nodeId) {
            return;
        }

        const connectorPatch = buildFunctionCallConnectorPatch(node, signature);
        const inputsChanged = Object.prototype.hasOwnProperty.call(connectorPatch, 'inputs');
        const outputsChanged = Object.prototype.hasOwnProperty.call(connectorPatch, 'outputs');
        const iconChanged = Object.prototype.hasOwnProperty.call(connectorPatch, 'icon');
        if (!inputsChanged && !outputsChanged && !iconChanged) {
            return;
        }

        const inputSide: ConnectorSidePlan = {
            mapping: inputsChanged && mapping?.kind === 'input' ? mapping : null,
            count: Array.isArray(connectorPatch.inputs)
                ? (connectorPatch.inputs as unknown[]).length
                : Array.isArray(node.inputs)
                  ? node.inputs.length
                  : 0,
        };
        const outputSide: ConnectorSidePlan = {
            mapping: outputsChanged && mapping?.kind === 'output' ? mapping : null,
            count: Array.isArray(connectorPatch.outputs)
                ? (connectorPatch.outputs as unknown[]).length
                : Array.isArray(node.outputs)
                  ? node.outputs.length
                  : 0,
        };

        const rewrites = this.collectConnectionRewrites(graph, nodeId, inputSide, outputSide);

        // Detach before the patch: `updateNode()` prunes wires that point at connectors it
        // is about to drop, which would discard the wires this pass still has to move.
        rewrites.forEach((rewrite) => {
            this.removeConnection(graph, rewrite.connection);
        });

        const patch: Record<string, unknown> = { ...connectorPatch };
        const remapped = remapFunctionInputDefaults(node.inputDefaults, inputSide.mapping);
        let defaults = remapped;
        const reconciled = reconcileFunctionInputDefaults(
            remapped ?? node.inputDefaults,
            signature
        );
        if (reconciled) {
            defaults = reconciled;
        }
        if (defaults) {
            patch.inputDefaults = defaults;
        }

        try {
            graph.updateNode?.(nodeId, patch);
        } catch (error) {
            logRewriteFailure('function-call-node-patch-failed', { nodeId }, error);
        }

        rewrites.forEach((rewrite) => {
            if (rewrite.next) {
                this.addConnection(graph, rewrite.next);
            }
        });
    }

    /**
     * Plan how each connection touching a call node survives the edit.
     *
     * Connections are read before anything is detached, so the plan is complete even though
     * the graph is mutated while it is applied. A connection that also starts at the node
     * (a self-call) has both endpoints remapped in one entry.
     *
     * @param graph - Graph that owns the connections.
     * @param nodeId - Id of the call node.
     * @param inputSide - Remap rule for the node's inputs.
     * @param outputSide - Remap rule for the node's outputs.
     * @returns One entry per connection touching the node.
     */
    private collectConnectionRewrites(
        graph: FunctionConsistencyGraph,
        nodeId: string,
        inputSide: ConnectorSidePlan,
        outputSide: ConnectorSidePlan
    ): ConnectionRewrite[] {
        const rawConnections = graph.getConnections?.();
        if (!Array.isArray(rawConnections)) {
            return [];
        }

        const rewrites: ConnectionRewrite[] = [];
        rawConnections.forEach((raw) => {
            const connection = normalizeConnection(raw);
            if (!connection) {
                return;
            }
            const isTarget = connection.toNode === nodeId;
            const isSource = connection.fromNode === nodeId;
            if (!isTarget && !isSource) {
                return;
            }

            const next: FunctionCallConnection = { ...connection };
            let dropped = false;
            if (isTarget) {
                const toIndex = remapFunctionConnectorIndex(
                    inputSide.mapping,
                    connection.toIndex,
                    inputSide.count
                );
                if (toIndex === null) {
                    dropped = true;
                } else {
                    next.toIndex = toIndex;
                }
            }
            if (isSource) {
                const fromIndex = remapFunctionConnectorIndex(
                    outputSide.mapping,
                    connection.fromIndex,
                    outputSide.count
                );
                if (fromIndex === null) {
                    dropped = true;
                } else {
                    next.fromIndex = fromIndex;
                }
            }

            rewrites.push({ connection, next: dropped ? null : next });
        });

        return rewrites;
    }

    /**
     * Detach one connection, logging instead of throwing on failure.
     *
     * @param graph - Graph that owns the connection.
     * @param connection - Connection to remove.
     */
    private removeConnection(
        graph: FunctionConsistencyGraph,
        connection: FunctionCallConnection
    ): void {
        try {
            graph.removeConnection?.(
                connection.fromNode,
                connection.fromIndex,
                connection.toNode,
                connection.toIndex
            );
        } catch (error) {
            logRewriteFailure('function-call-wire-detach-failed', { ...connection }, error);
        }
    }

    /**
     * Re-attach one connection, dropping it with a log entry when the new interface rejects it.
     *
     * @param graph - Graph that owns the connection.
     * @param connection - Connection with its remapped endpoints.
     */
    private addConnection(
        graph: FunctionConsistencyGraph,
        connection: FunctionCallConnection
    ): void {
        try {
            graph.addConnection?.({ ...connection });
        } catch (error) {
            logRewriteFailure('function-call-wire-reattach-failed', { ...connection }, error);
        }
    }
}
