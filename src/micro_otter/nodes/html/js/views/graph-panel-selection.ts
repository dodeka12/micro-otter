// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * GraphPanelSelection - Selection management for GraphPanelView
 *
 * Handles single selection, multi-selection, and box selection state.
 * Extracted as part of Phase 2 refactoring (2026-01-26).
 */

type SelectionPoint = { x: number; y: number };

export interface SelectionBoxState {
    start: SelectionPoint;
    end: SelectionPoint;
}

type SelectionNodeData = {
    x: number;
    y: number;
    width?: number;
    height?: number;
};

type SelectionNodeUi = {
    getNodeData?: () => SelectionNodeData | null | undefined;
};

type SelectionNodeMap = Map<string, SelectionNodeUi>;

type GraphPanelSelectionSerialized = {
    selectedNodes: string[];
};

type GraphPanelSelectionDeserializeData = {
    selectedNodes?: unknown;
} | null;

function normalizeNodeId(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

export interface GraphPanelSelectionPublicMethods {
    selectSingleNode(nodeId: string | null | undefined): void;
    addToSelection(nodeId: string | null | undefined): void;
    toggleSelection(nodeId: string): void;
    clearSelection(): void;
    selectAll(nodeIds: readonly string[]): void;
    isSelected(nodeId: string): boolean;
    getSelectedNodeIds(): string[];
    getSelectionCount(): number;
    startBoxSelection(worldPos: SelectionPoint): void;
    updateBoxSelection(worldPos: SelectionPoint): void;
    finishBoxSelection(nodeUiMap: SelectionNodeMap): string[];
    isBoxSelecting(): boolean;
    serialize(): GraphPanelSelectionSerialized;
    deserialize(data: GraphPanelSelectionDeserializeData): void;
}

export class GraphPanelSelection implements GraphPanelSelectionPublicMethods {
    selectedNodes: Set<string>;
    selectionBox: SelectionBoxState | null;
    _isBoxSelecting: boolean;

    constructor() {
        // Selection state
        this.selectedNodes = new Set(); // Set of selected node IDs
        this.selectionBox = null; // { start: {x, y}, end: {x, y} } for box selection
        this._isBoxSelecting = false;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Selection Management
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Select a single node (clears other selections).
     * @param {string} nodeId - Node ID to select
     */
    selectSingleNode(nodeId: string | null | undefined): void {
        this.selectedNodes.clear();
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (normalizedNodeId) {
            this.selectedNodes.add(normalizedNodeId);
        }
    }

    /**
     * Add a node to the current selection.
     * @param {string} nodeId - Node ID to add
     */
    addToSelection(nodeId: string | null | undefined): void {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (normalizedNodeId) {
            this.selectedNodes.add(normalizedNodeId);
        }
    }

    /**
     * Toggle a node in the selection.
     * @param {string} nodeId - Node ID to toggle
     */
    toggleSelection(nodeId: string): void {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (!normalizedNodeId) {
            return;
        }

        if (this.selectedNodes.has(normalizedNodeId)) {
            this.selectedNodes.delete(normalizedNodeId);
        } else {
            this.selectedNodes.add(normalizedNodeId);
        }
    }

    /**
     * Clear all selected nodes.
     */
    clearSelection(): void {
        this.selectedNodes.clear();
    }

    /**
     * Select all nodes in the graph.
     * @param {string[]} nodeIds - Array of all node IDs in the graph
     */
    selectAll(nodeIds: readonly string[]): void {
        this.selectedNodes.clear();
        nodeIds.forEach((id) => {
            const normalizedNodeId = normalizeNodeId(id);
            if (normalizedNodeId) {
                this.selectedNodes.add(normalizedNodeId);
            }
        });
    }

    /**
     * Check if a node is selected.
     * @param {string} nodeId - Node ID to check
     * @returns {boolean} True if selected
     */
    isSelected(nodeId: string): boolean {
        const normalizedNodeId = normalizeNodeId(nodeId);
        return normalizedNodeId ? this.selectedNodes.has(normalizedNodeId) : false;
    }

    /**
     * Get array of selected node IDs.
     * @returns {string[]} Array of selected node IDs
     */
    getSelectedNodeIds(): string[] {
        return Array.from(this.selectedNodes);
    }

    /**
     * Get count of selected nodes.
     * @returns {number} Number of selected nodes
     */
    getSelectionCount(): number {
        return this.selectedNodes.size;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Box Selection
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Start box selection at a world position.
     * @param {{x: number, y: number}} worldPos - Starting position in world coordinates
     */
    startBoxSelection(worldPos: SelectionPoint): void {
        this._isBoxSelecting = true;
        this.selectionBox = {
            start: { x: worldPos.x, y: worldPos.y },
            end: { x: worldPos.x, y: worldPos.y },
        };
    }

    /**
     * Update box selection end position.
     * @param {{x: number, y: number}} worldPos - Current position in world coordinates
     */
    updateBoxSelection(worldPos: SelectionPoint): void {
        if (this._isBoxSelecting && this.selectionBox) {
            this.selectionBox.end = { x: worldPos.x, y: worldPos.y };
        }
    }

    /**
     * Finish box selection and return nodes within the box.
     * @param {Map<string, object>} nodeUiMap - Map of node IDs to NodeUi instances
     * @returns {string[]} Array of node IDs within the selection box
     */
    finishBoxSelection(nodeUiMap: SelectionNodeMap): string[] {
        this._isBoxSelecting = false;

        const nodesInBox = this._getNodesInSelectionBox(nodeUiMap);

        // Clear selection box
        this.selectionBox = null;

        return nodesInBox;
    }

    /**
     * Check if currently performing box selection.
     * @returns {boolean} True if box selecting
     */
    isBoxSelecting(): boolean {
        return this._isBoxSelecting;
    }

    /**
     * Get all nodes within the current selection box.
     * @param {Map<string, object>} nodeUiMap - Map of node IDs to NodeUi instances
     * @returns {string[]} Array of node IDs within the box
     * @private
     */
    _getNodesInSelectionBox(nodeUiMap: SelectionNodeMap): string[] {
        if (!this.selectionBox) {
            return [];
        }

        const { start, end } = this.selectionBox;
        const left = Math.min(start.x, end.x);
        const right = Math.max(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const bottom = Math.max(start.y, end.y);

        const nodesInBox: string[] = [];

        for (const [nodeId, nodeUi] of nodeUiMap) {
            const nodeData = nodeUi.getNodeData?.();
            if (!nodeData) continue;

            const nodeLeft = nodeData.x;
            const nodeRight = nodeData.x + (nodeData.width || 140);
            const nodeTop = nodeData.y;
            const nodeBottom = nodeData.y + (nodeData.height || 90);

            // Check if node bounds overlap with selection box
            const overlaps =
                nodeLeft < right && nodeRight > left && nodeTop < bottom && nodeBottom > top;

            if (overlaps) {
                nodesInBox.push(nodeId);
            }
        }

        return nodesInBox;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Serialization
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Serialize selection state.
     * @returns {object} Serialized selection state
     */
    serialize(): GraphPanelSelectionSerialized {
        return {
            selectedNodes: Array.from(this.selectedNodes),
        };
    }

    /**
     * Deserialize selection state.
     * @param {object} data - Serialized selection state
     */
    deserialize(data: GraphPanelSelectionDeserializeData): void {
        this.selectedNodes.clear();
        if (Array.isArray(data?.selectedNodes)) {
            data.selectedNodes.forEach((id) => {
                const normalizedNodeId = normalizeNodeId(id);
                if (normalizedNodeId) {
                    this.selectedNodes.add(normalizedNodeId);
                }
            });
        }
    }
}