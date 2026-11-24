// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Single-graph clipboard (D16).
 *
 * The node clipboard (`core/clipboard-manager.ts`) holds nodes and documentation areas of
 * one graph; this module holds **one whole `NodeGraph.toData()` snapshot** app-wide. Copy
 * snapshots the graph (a deep copy), so later edits of the source never leak into a paste,
 * and paste always produces a *new* graph: fresh graph id and name, renumbered node and
 * documentation-area ids, connection endpoints remapped through one old→new map and a
 * reset viewport so the copy never lands off-screen.
 *
 * Function graphs keep their `functionSignature`, and their structural nodes travel as
 * ordinary node data with fresh ids, so the pasted graph still holds at most one of each.
 * A pasted non-function graph drops structural nodes a stale payload may carry, because
 * the transpiler rejects them outside a function graph (D4/D14).
 *
 * The slot is in-memory only: nothing is written to storage, so a reload starts empty.
 * @module core/graph-clipboard
 */

import { isFunctionStructuralNodeType } from '../data/graph-function-nodes.js';
import { FUNCTION_NODE_TYPE_PREFIX } from '../data/graph-function-signature.js';
import { resolveFunctionGraphId } from '../data/function-node-definition.js';

/** Serialized graph as `NodeGraph.toData()` produces it; unknown extra fields survive. */
export interface GraphClipboardGraphData {
    id?: string;
    name?: string;
    executionType?: string;
    nodes?: Array<Record<string, unknown>>;
    connections?: Array<Record<string, unknown>>;
    documentationAreas?: Array<Record<string, unknown>>;
    viewportConfig?: Record<string, unknown>;
    functionSignature?: unknown;
    [key: string]: unknown;
}

/** One copied graph plus the collection it came from. */
export interface GraphClipboardPayload {
    /** Snapshot of the copied graph; never the live graph object. */
    data: GraphClipboardGraphData;
    /** Id of the collection the graph was copied from. */
    sourceCollectionId: string;
}

/** Identity a paste gives the new graph. */
export interface PastedGraphIdentity {
    /** Fresh, collection-unique graph id. */
    graphId: string;
    /** Fresh, collection-unique graph name. */
    name: string;
}

/** The app-wide slot; `null` when nothing was copied. */
let graphClipboard: GraphClipboardPayload | null = null;

/**
 * Deep-copy a serialized graph.
 *
 * `NodeGraph.toData()` returns fresh objects, but keeping every read and write behind a
 * copy makes the slot immune to a caller mutating what it stored or retrieved.
 *
 * @param data - Serialized graph.
 * @returns An independent copy.
 */
function copyGraphData(data: GraphClipboardGraphData): GraphClipboardGraphData {
    return JSON.parse(JSON.stringify(data ?? {})) as GraphClipboardGraphData;
}

/**
 * Store a copied graph.
 *
 * Passing `null` (or a payload without graph data) clears the slot.
 *
 * @param payload - Snapshot to store, or `null` to clear.
 */
export function setGraphClipboard(payload: GraphClipboardPayload | null): void {
    if (!payload || !payload.data || typeof payload.data !== 'object') {
        graphClipboard = null;
        return;
    }

    graphClipboard = {
        data: copyGraphData(payload.data),
        sourceCollectionId:
            typeof payload.sourceCollectionId === 'string' ? payload.sourceCollectionId : '',
    };
}

/**
 * Read the copied graph.
 * @returns An independent copy of the payload, or `null` when the slot is empty.
 */
export function getGraphClipboard(): GraphClipboardPayload | null {
    if (!graphClipboard) {
        return null;
    }

    return {
        data: copyGraphData(graphClipboard.data),
        sourceCollectionId: graphClipboard.sourceCollectionId,
    };
}

/**
 * Whether a graph can be pasted.
 * @returns True when the slot holds a graph.
 */
export function hasGraphClipboard(): boolean {
    return graphClipboard !== null;
}

/** Empty the slot. */
export function clearGraphClipboard(): void {
    graphClipboard = null;
}

/**
 * Map a node type id that pointed at the copied graph onto the pasted graph's id.
 *
 * A copy of a graph that called itself would otherwise point at the source graph; the
 * transpiler rejects self-reference anyway, so this is a repair, not a feature.
 *
 * @param typeId - Node type id of a pasted node.
 * @param sourceGraphId - Graph id the snapshot came from.
 * @param pastedGraphId - Graph id the copy receives.
 * @returns The remapped type id, or the input unchanged.
 */
function remapSelfCallTypeId(
    typeId: unknown,
    sourceGraphId: string,
    pastedGraphId: string
): unknown {
    if (typeof typeId !== 'string' || !sourceGraphId || !pastedGraphId) {
        return typeId;
    }
    if (typeId !== `${FUNCTION_NODE_TYPE_PREFIX}${sourceGraphId}`) {
        return typeId;
    }
    return `${FUNCTION_NODE_TYPE_PREFIX}${pastedGraphId}`;
}

/**
 * Build the serialized data of a pasted graph.
 *
 * Nodes and documentation areas are renumbered in data order (`1…n`), which keeps the
 * graph's id counters clean and cannot collide with anything in the target graph.
 * Connections whose endpoint disappeared (a dropped structural node) are dropped with it.
 *
 * @param payload - Copied graph and its source collection.
 * @param identity - Fresh graph id and name.
 * @returns Independent serialized graph data ready for `NodeGraph.fromData()`.
 */
export function buildPastedGraphData(
    payload: GraphClipboardPayload | null | undefined,
    { graphId, name }: PastedGraphIdentity
): GraphClipboardGraphData {
    const source = copyGraphData(payload?.data ?? {});
    const sourceGraphId = typeof source.id === 'string' ? source.id : '';
    const isFunctionGraph = source.executionType === 'function';

    const nodeIdMap = new Map<string, string>();
    const nodes: Array<Record<string, unknown>> = [];
    for (const node of Array.isArray(source.nodes) ? source.nodes : []) {
        if (!node || typeof node !== 'object') {
            continue;
        }
        if (!isFunctionGraph && isFunctionStructuralNodeType(node.type)) {
            // A stale payload from a graph that used to be a function graph.
            continue;
        }

        const pastedNodeId = String(nodes.length + 1);
        const sourceNodeId = typeof node.id === 'string' ? node.id : '';
        if (sourceNodeId) {
            nodeIdMap.set(sourceNodeId, pastedNodeId);
        }
        nodes.push({
            ...node,
            id: pastedNodeId,
            type: remapSelfCallTypeId(node.type, sourceGraphId, graphId),
        });
    }

    const documentationAreas: Array<Record<string, unknown>> = [];
    for (const area of Array.isArray(source.documentationAreas) ? source.documentationAreas : []) {
        if (!area || typeof area !== 'object') {
            continue;
        }
        documentationAreas.push({ ...area, id: String(documentationAreas.length + 1) });
    }

    const connections: Array<Record<string, unknown>> = [];
    for (const connection of Array.isArray(source.connections) ? source.connections : []) {
        if (!connection || typeof connection !== 'object') {
            continue;
        }
        const fromNode = nodeIdMap.get(String(connection.fromNode ?? ''));
        const toNode = nodeIdMap.get(String(connection.toNode ?? ''));
        if (!fromNode || !toNode) {
            continue;
        }
        connections.push({ ...connection, fromNode, toNode });
    }

    return {
        ...source,
        id: graphId,
        name,
        nodes,
        connections,
        documentationAreas,
        // A paste starts at the origin so the copy is visible whatever the source view was.
        viewportConfig: { translateX: 0, translateY: 0, scale: 1 },
    };
}

/**
 * Collect the function-graph type ids a pasted graph calls.
 *
 * The collection view compares these with the target collection's graphs to warn about
 * callees that only exist in the source collection; the nodes themselves are kept so the
 * canvas can still render and later repair them (D9).
 *
 * @param data - Serialized graph data.
 * @returns Unique `function_graph.<id>` type ids in node order.
 */
export function collectPastedCalleeTypeIds(
    data: GraphClipboardGraphData | null | undefined
): string[] {
    const typeIds = new Set<string>();

    for (const node of Array.isArray(data?.nodes) ? data.nodes : []) {
        const typeId = node?.type;
        if (typeof typeId !== 'string' || resolveFunctionGraphId(typeId) === null) {
            continue;
        }
        typeIds.add(typeId);
    }

    return Array.from(typeIds);
}
