// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import NodeData from '../data/node-data.js';
import type { DocumentationAreaData } from '../data/documentation-area.js';
import { isFunctionStructuralNodeType } from '../data/graph-function-nodes.js';

type NodeId = string;

type SerializedClipboardNode = {
    data: Record<string, any>;
    _originalId: NodeId;
};

type SerializedClipboardConnection = {
    fromNode: NodeId;
    fromIndex: number;
    toNode: NodeId;
    toIndex: number;
};

type SerializedClipboardArea = {
    data: DocumentationAreaData;
    _originalId: NodeId;
};

type ClipboardPayload = {
    nodes: SerializedClipboardNode[];
    connections: SerializedClipboardConnection[];
    documentationAreas: SerializedClipboardArea[];
};

type PastePosition = {
    x: number;
    y: number;
};

type CopyOptions = {
    /** Documentation areas to serialize alongside the nodes. */
    areaIds?: string[];
};

type PasteOptions = {
    /**
     * Keep every pasted node at its stored position: no paste offset and no collision
     * resolution. Used by the Ctrl+drag copy gesture, where the copies must start exactly
     * underneath the original nodes.
     */
    exactPositions?: boolean;
};

const MIN_PASTE_ORIGIN_DISTANCE = 16;

function normalizeNodeId(value: unknown): NodeId | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

function normalizeNodeIds(nodeIds: unknown[]): NodeId[] {
    return nodeIds
        .map((nodeId) => normalizeNodeId(nodeId))
        .filter((nodeId): nodeId is NodeId => typeof nodeId === 'string');
}

function toFiniteNumber(value: unknown): number | null {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

/**
 * Normalize a list of documentation-area ids, dropping blanks and duplicates.
 * @param {unknown} values - Candidate ids.
 * @returns {string[]} Usable ids in input order.
 */
function normalizeAreaIds(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    const result: string[] = [];
    for (const value of values) {
        const id = normalizeNodeId(value);
        if (id && !result.includes(id)) {
            result.push(id);
        }
    }
    return result;
}

function extractNodeOrigin(nodeLike: any): PastePosition | null {
    const x = toFiniteNumber(nodeLike?.x);
    const y = toFiniteNumber(nodeLike?.y);
    if (x === null || y === null) {
        return null;
    }

    return { x, y };
}

function resolveOriginCollision(
    candidatePosition: PastePosition,
    occupiedOrigins: PastePosition[],
    minDistance: number
): PastePosition {
    const resolvedPosition = { ...candidatePosition };
    const epsilon = 0.01;
    const maxIterations = 64;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        let nearestCollision: { origin: PastePosition; distance: number } | null = null;

        for (const origin of occupiedOrigins) {
            const deltaX = resolvedPosition.x - origin.x;
            const deltaY = resolvedPosition.y - origin.y;
            const distance = Math.hypot(deltaX, deltaY);

            if (distance >= minDistance) {
                continue;
            }

            if (!nearestCollision || distance < nearestCollision.distance) {
                nearestCollision = { origin, distance };
            }
        }

        if (!nearestCollision) {
            break;
        }

        const awayX = resolvedPosition.x - nearestCollision.origin.x;
        const awayY = resolvedPosition.y - nearestCollision.origin.y;
        const directionLength = Math.hypot(awayX, awayY);

        const normalX = directionLength > 0 ? awayX / directionLength : 1;
        const normalY = directionLength > 0 ? awayY / directionLength : 0;
        const pushDistance = minDistance - nearestCollision.distance + epsilon;

        resolvedPosition.x += normalX * pushDistance;
        resolvedPosition.y += normalY * pushDistance;
    }

    return resolvedPosition;
}

class ClipboardManager {
    private _clipboard: ClipboardPayload | null;

    /** Area ids created by the last paste, in insertion order. */
    private _lastPastedAreaIds: string[] = [];

    constructor() {
        this._clipboard = null;
    }

    copy(graph: any, nodeIds: NodeId[], options: CopyOptions = {}): boolean {
        const normalizedAreaIds = normalizeAreaIds(options.areaIds);
        const rawNodeIds = Array.isArray(nodeIds) ? nodeIds : [];

        if (rawNodeIds.length === 0 && normalizedAreaIds.length === 0) {
            return false;
        }

        const normalizedNodeIds = normalizeNodeIds(rawNodeIds);
        if (normalizedNodeIds.length === 0 && normalizedAreaIds.length === 0) {
            return false;
        }

        const collectedNodes = normalizedNodeIds
            .map((id) => {
                const nodeData = graph.getNode(id);
                if (!nodeData) {
                    return null;
                }

                const serialized = nodeData.toData?.();
                if (!serialized) {
                    return null;
                }

                return {
                    data: serialized,
                    _originalId: normalizeNodeId(nodeData.id) ?? id,
                };
            })
            .filter((entry): entry is SerializedClipboardNode => entry !== null);

        // Structural function nodes are singletons owned by their graph: copying them would
        // let a paste create a second copy or move them out of their function graph.
        const nodes = collectedNodes.filter(
            (entry) => !isFunctionStructuralNodeType(entry.data?.type)
        );
        if (nodes.length !== collectedNodes.length) {
            console.warn('function-structural-node-skipped', {
                operation: 'copy',
                count: collectedNodes.length - nodes.length,
            });
        }

        const documentationAreas: SerializedClipboardArea[] = [];
        for (const areaId of normalizedAreaIds) {
            const area = graph.getDocumentationArea?.(areaId) ?? null;
            const data = area?.toData?.();
            if (!data) {
                continue;
            }
            documentationAreas.push({ data, _originalId: areaId });
        }

        if (nodes.length === 0 && documentationAreas.length === 0) {
            return false;
        }

        const nodeIdSet = new Set(nodes.map((entry) => entry._originalId));
        const connections: SerializedClipboardConnection[] = [];

        for (const conn of graph.getConnections()) {
            const fromNodeId = normalizeNodeId(conn.fromNode);
            const toNodeId = normalizeNodeId(conn.toNode);
            if (!fromNodeId || !toNodeId) {
                continue;
            }

            if (nodeIdSet.has(fromNodeId) && nodeIdSet.has(toNodeId)) {
                connections.push({
                    fromNode: fromNodeId,
                    fromIndex: conn.fromIndex,
                    toNode: toNodeId,
                    toIndex: conn.toIndex,
                });
            }
        }

        this._clipboard = { nodes, connections, documentationAreas };

        return true;
    }

    /**
     * Copy nodes to the clipboard for a cut operation.
     *
     * The manager deliberately does not remove the source nodes: the graph panel removes
     * them immediately after this call, inside its own undoable history group. Deferring
     * the removal until a later paste would make a cut look like a no-op and could delete
     * a node that was restored by undo in the meantime.
     *
     * @param graph Source graph containing the nodes.
     * @param nodeIds Node IDs to cut.
     * @returns True when the nodes were serialized to the clipboard.
     */
    cut(graph: any, nodeIds: NodeId[], options: CopyOptions = {}): boolean {
        return this.copy(graph, nodeIds, options);
    }

    paste(
        targetGraph: any,
        pastePosition: PastePosition | null = null,
        options: PasteOptions = {}
    ): NodeId[] {
        this._lastPastedAreaIds = [];

        if (!this._clipboard || !this.hasData()) {
            return [];
        }

        const { nodes: clipboardNodes, connections } = this._clipboard;
        const exactPositions = options.exactPositions === true;

        // Defense in depth: a payload written before structural nodes were filtered must not
        // create a second structural node either.
        const nodes = clipboardNodes.filter((entry) => !isFunctionStructuralNodeType(entry.data?.type));
        if (nodes.length !== clipboardNodes.length) {
            console.warn('function-structural-node-skipped', {
                operation: 'paste',
                count: clipboardNodes.length - nodes.length,
            });
        }

        let offset = { x: 20, y: 20 };

        if (exactPositions) {
            offset = { x: 0, y: 0 };
        } else if (pastePosition && nodes.length > 0) {
            const positions = nodes
                .map((node) => ({ x: node.data?.x ?? 0, y: node.data?.y ?? 0 }))
                .filter((position) => typeof position.x === 'number' && typeof position.y === 'number');

            if (positions.length > 0) {
                const avgX = positions.reduce((sum, position) => sum + position.x, 0) / positions.length;
                const avgY = positions.reduce((sum, position) => sum + position.y, 0) / positions.length;

                offset = {
                    x: pastePosition.x - avgX,
                    y: pastePosition.y - avgY,
                };
            }
        }

        const idMapping = new Map<NodeId, NodeId>();
        const newNodeIds: NodeId[] = [];
        const occupiedOrigins: PastePosition[] =
            typeof targetGraph?.getNodes === 'function'
                ? targetGraph
                      .getNodes()
                      .map((nodeLike: any) => extractNodeOrigin(nodeLike))
                      .filter((origin: PastePosition | null): origin is PastePosition => origin !== null)
                : [];

        for (const entry of nodes) {
            const nodeData = NodeData.fromData(entry.data);
            const intendedOrigin = {
                x: nodeData.x + offset.x,
                y: nodeData.y + offset.y,
            };

            const resolvedOrigin = exactPositions
                ? intendedOrigin
                : resolveOriginCollision(
                      intendedOrigin,
                      occupiedOrigins,
                      MIN_PASTE_ORIGIN_DISTANCE
                  );

            nodeData.x = resolvedOrigin.x;
            nodeData.y = resolvedOrigin.y;

            const newNodeData = targetGraph.addNode(nodeData.toData());
            const newNodeId = normalizeNodeId(newNodeData?.id);
            if (newNodeId) {
                idMapping.set(entry._originalId, newNodeId);
                newNodeIds.push(newNodeId);

                const pastedOrigin = extractNodeOrigin(newNodeData) || {
                    x: resolvedOrigin.x,
                    y: resolvedOrigin.y,
                };
                occupiedOrigins.push(pastedOrigin);
            }
        }

        for (const conn of connections) {
            const newFromId = idMapping.get(conn.fromNode);
            const newToId = idMapping.get(conn.toNode);

            if (newFromId && newToId) {
                try {
                    targetGraph.addConnection({
                        fromNode: newFromId,
                        fromIndex: conn.fromIndex,
                        toNode: newToId,
                        toIndex: conn.toIndex,
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn('Failed to restore connection during paste:', message);
                }
            }
        }

        this.#pasteAreas(targetGraph, pastePosition, options);

        return newNodeIds;
    }

    /**
     * Paste only the documentation areas of the payload.
     *
     * Used by the area menu and by `Ctrl+V` when the payload carries no nodes. Pasted areas always
     * get a fresh id from the target graph: `_originalId` belongs to the source graph and may
     * already exist in the target with a different meaning.
     * @param {object} targetGraph - Destination graph.
     * @param {{x:number,y:number}|null} pastePosition - World position for the payload's top-left.
     * @param {PasteOptions} options - Paste options (`exactPositions`).
     * @returns {string[]} Newly created area ids.
     */
    pasteAreas(
        targetGraph: any,
        pastePosition: PastePosition | null = null,
        options: PasteOptions = {}
    ): string[] {
        this._lastPastedAreaIds = [];
        this.#pasteAreas(targetGraph, pastePosition, options);
        return [...this._lastPastedAreaIds];
    }

    /**
     * Create the payload's areas in the target graph, translating the combined bounding box.
     * @param {object} targetGraph - Destination graph.
     * @param {{x:number,y:number}|null} pastePosition - World position for the payload's top-left.
     * @param {PasteOptions} options - Paste options.
     */
    #pasteAreas(
        targetGraph: any,
        pastePosition: PastePosition | null,
        options: PasteOptions = {}
    ): void {
        const areas = this._clipboard?.documentationAreas ?? [];
        if (areas.length === 0 || typeof targetGraph?.addDocumentationArea !== 'function') {
            return;
        }

        const exactPositions = options.exactPositions === true;
        const minX = Math.min(...areas.map((entry) => entry.data.bounds.x));
        const minY = Math.min(...areas.map((entry) => entry.data.bounds.y));

        let origin = { x: minX + 20, y: minY + 20 };
        if (exactPositions) {
            origin = { x: minX, y: minY };
        } else if (pastePosition) {
            origin = { x: pastePosition.x, y: pastePosition.y };
        }

        const occupiedOrigins: PastePosition[] = Array.isArray(targetGraph.getDocumentationAreas?.())
            ? targetGraph
                  .getDocumentationAreas()
                  .map((area: DocumentationAreaData) => ({ x: area.bounds.x, y: area.bounds.y }))
            : [];

        const resolvedOrigin = exactPositions
            ? origin
            : resolveOriginCollision(origin, occupiedOrigins, MIN_PASTE_ORIGIN_DISTANCE);

        const deltaX = resolvedOrigin.x - minX;
        const deltaY = resolvedOrigin.y - minY;

        for (const entry of areas) {
            const created = targetGraph.addDocumentationArea({
                title: entry.data.title,
                markdown: entry.data.markdown,
                color: entry.data.color,
                contentAlign: entry.data.contentAlign,
                fontSize: entry.data.fontSize,
                bounds: {
                    x: entry.data.bounds.x + deltaX,
                    y: entry.data.bounds.y + deltaY,
                    width: entry.data.bounds.width,
                    height: entry.data.bounds.height,
                },
            });
            const newId = normalizeNodeId(created?.id);
            if (!newId) {
                continue;
            }
            this._lastPastedAreaIds.push(newId);
            occupiedOrigins.push({
                x: entry.data.bounds.x + deltaX,
                y: entry.data.bounds.y + deltaY,
            });
        }
    }

    /**
     * Area ids created by the most recent paste, in insertion order.
     * @returns {string[]} Pasted area ids.
     */
    getLastPastedAreaIds(): string[] {
        return [...this._lastPastedAreaIds];
    }

    /**
     * Number of areas currently held on the clipboard.
     * @returns {number} Area count.
     */
    getAreaCount(): number {
        return this._clipboard ? this._clipboard.documentationAreas.length : 0;
    }

    duplicate(
        graph: any,
        nodeIds: NodeId[],
        pastePosition: PastePosition | null = null,
        options: PasteOptions = {}
    ): NodeId[] {
        const tempClipboard = this._clipboard;

        if (!this.copy(graph, nodeIds)) {
            this._clipboard = tempClipboard;
            return [];
        }

        const newIds = this.paste(graph, pastePosition, options);

        this._clipboard = tempClipboard;

        return newIds;
    }

    hasData(): boolean {
        if (!this._clipboard) {
            return false;
        }
        return this._clipboard.nodes.length > 0 || this._clipboard.documentationAreas.length > 0;
    }

    getNodeCount(): number {
        return this._clipboard ? this._clipboard.nodes.length : 0;
    }

    clear(): void {
        this._clipboard = null;
        this._lastPastedAreaIds = [];
    }
}

export const clipboardManager = new ClipboardManager();
