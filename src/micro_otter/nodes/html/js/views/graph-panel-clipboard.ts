// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * GraphPanelClipboard - Clipboard operations for GraphPanelView
 *
 * Handles copy, cut (copy + immediate removal), paste, duplicate operations for nodes.
 * Extracted as part of Phase 3 refactoring (2026-01-26).
 */

type NodeId = string;

type Point = {
    x: number;
    y: number;
};

type CanvasSize = {
    width: number;
    height: number;
};

type GraphLike = unknown;

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

function normalizeNodeIds(values: unknown[]): NodeId[] {
    return values
        .map((value) => normalizeNodeId(value))
        .filter((value): value is NodeId => typeof value === 'string');
}

type ClipboardManagerLike = {
    copy: (
        graph: GraphLike,
        nodeIds: NodeId[],
        options?: { areaIds?: string[] }
    ) => boolean;
    cut: (
        graph: GraphLike,
        nodeIds: NodeId[],
        options?: { areaIds?: string[] }
    ) => boolean;
    paste: (graph: GraphLike, worldPos: Point) => unknown[];
    pasteAreas?: (graph: GraphLike, worldPos: Point) => string[];
    getLastPastedAreaIds?: () => string[];
    getAreaCount?: () => number;
    duplicate: (
        graph: GraphLike,
        nodeIds: NodeId[],
        pastePosition: Point | null,
        options?: { exactPositions?: boolean }
    ) => unknown[];
    hasData: () => boolean;
};

type ViewportLike = {
    screenToWorld: (point: Point) => Point;
};

type GraphPanelClipboardOptions = {
    graph: GraphLike;
    clipboardManager: ClipboardManagerLike;
    viewport: ViewportLike;
    getSelectedNodeIds: () => NodeId[];
    ensureNodesInsideGrid: (nodeIds: NodeId[]) => void;
    /**
     * Remove the source nodes of a cut from the graph as one undoable action.
     * The panel supplies this callback so the clipboard module stays free of
     * history and selection wiring.
     */
    removeNodes: (nodeIds: NodeId[], description: string) => void;
    /** Active documentation area, if any; area copy/cut/paste uses it. */
    getActiveDocumentationAreaId?: () => string | null;
    /** Remove a documentation area undoably (history pre-hook included). */
    removeDocumentationArea?: (areaId: string, description: string) => void;
    /** Open a history group so a mixed cut undoes as one step. */
    beginHistoryGroup?: (description: string) => void;
    /** Close the history group opened by `beginHistoryGroup`. */
    endHistoryGroup?: () => void;
};

export class GraphPanelClipboard {
    graph: GraphLike;
    clipboardManager: ClipboardManagerLike;
    viewport: ViewportLike;
    getSelectedNodeIds: () => NodeId[];
    ensureNodesInsideGrid: (nodeIds: NodeId[]) => void;
    removeNodes: (nodeIds: NodeId[], description: string) => void;
    getActiveDocumentationAreaId: (() => string | null) | null;
    removeDocumentationArea: ((areaId: string, description: string) => void) | null;
    beginHistoryGroup: ((description: string) => void) | null;
    endHistoryGroup: (() => void) | null;
    _lastPointerEvent: MouseEvent | null;
    /** Documentation-area ids created by the most recent paste. */
    _lastPastedAreaIds: string[];

    /**
     * @param {object} options
     * @param {object} options.graph - NodeGraph instance
     * @param {object} options.clipboardManager - Clipboard manager instance
     * @param {object} options.viewport - GraphPanelViewport instance
     * @param {Function} options.getSelectedNodeIds - Function that returns array of selected node IDs
     * @param {Function} options.ensureNodesInsideGrid - Function to clamp nodes to grid bounds
     * @param {Function} options.removeNodes - Function that removes cut nodes as one undoable action
     */
    constructor({
        graph,
        clipboardManager,
        viewport,
        getSelectedNodeIds,
        ensureNodesInsideGrid,
        removeNodes,
        getActiveDocumentationAreaId = null,
        removeDocumentationArea = null,
        beginHistoryGroup = null,
        endHistoryGroup = null,
    }: GraphPanelClipboardOptions) {
        this.graph = graph;
        this.clipboardManager = clipboardManager;
        this.viewport = viewport;
        this.getSelectedNodeIds = getSelectedNodeIds;
        this.ensureNodesInsideGrid = ensureNodesInsideGrid;
        this.removeNodes = removeNodes;
        this.getActiveDocumentationAreaId =
            typeof getActiveDocumentationAreaId === 'function'
                ? getActiveDocumentationAreaId
                : null;
        this.removeDocumentationArea =
            typeof removeDocumentationArea === 'function' ? removeDocumentationArea : null;
        this.beginHistoryGroup =
            typeof beginHistoryGroup === 'function' ? beginHistoryGroup : null;
        this.endHistoryGroup = typeof endHistoryGroup === 'function' ? endHistoryGroup : null;
        this._lastPastedAreaIds = [];

        // Track last pointer position for paste-at-cursor
        this._lastPointerEvent = null;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Pointer Position Tracking
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Update last pointer position for paste-at-cursor functionality.
     * @param {MouseEvent} event - Mouse event
     */
    updateLastPointerPosition(event: MouseEvent): void {
        this._lastPointerEvent = event;
    }

    /**
     * Get the last pointer position in world coords if available and within canvas.
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @returns {{x:number,y:number}|null}
     * @private
     */
    _getLastPointerWorldPosition(canvas: HTMLCanvasElement | null): Point | null {
        if (!this._lastPointerEvent || !canvas) {
            return null;
        }

        const rect = canvas.getBoundingClientRect();
        const { clientX, clientY } = this._lastPointerEvent;

        const within =
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom;

        if (!within) {
            return null;
        }

        const posScreen: Point = {
            x: clientX - rect.left,
            y: clientY - rect.top,
        };

        return this.viewport.screenToWorld(posScreen);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Clipboard Operations
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Copy selected nodes to clipboard.
     * @returns {boolean} True if nodes were copied
     */
    copySelected(): boolean {
        const nodeIds = normalizeNodeIds(this.getSelectedNodeIds());
        const areaIds = this.#activeAreaIds();
        if (nodeIds.length === 0 && areaIds.length === 0) {
            return false;
        }

        return this.clipboardManager.copy(this.graph, nodeIds, { areaIds });
    }

    /**
     * Cut selected nodes: copy them to the clipboard and remove them from the graph
     * immediately. The removal goes through the panel's removeNodes callback so the
     * whole cut is recorded as one undoable history group and the selection is cleared.
     * @returns {boolean} True if nodes were copied and removed
     */
    cutSelected(): boolean {
        const nodeIds = normalizeNodeIds(this.getSelectedNodeIds());
        const areaIds = this.#activeAreaIds();
        if (nodeIds.length === 0 && areaIds.length === 0) {
            return false;
        }

        const success = this.clipboardManager.cut(this.graph, nodeIds, { areaIds });
        if (!success) {
            return false;
        }

        // Both removals happen inside one history group so a mixed cut undoes as one step.
        const grouped = nodeIds.length > 0 && areaIds.length > 0;
        if (grouped) {
            this.beginHistoryGroup?.('Cut selection');
        }
        try {
            if (nodeIds.length > 0) {
                this.removeNodes(nodeIds, nodeIds.length === 1 ? 'Cut node' : 'Cut nodes');
            }
            for (const areaId of areaIds) {
                this.removeDocumentationArea?.(areaId, 'Cut documentation area');
            }
        } finally {
            if (grouped) {
                this.endHistoryGroup?.();
            }
        }
        return true;
    }

    /**
     * Paste nodes from clipboard at center of viewport.
     * @param {{width: number, height: number}} canvasSize - Canvas size in screen pixels
     * @returns {string[]} Array of new node IDs
     */
    pasteAtCenter(canvasSize: CanvasSize): NodeId[] {
        if (!this.clipboardManager.hasData()) {
            return [];
        }

        // Calculate center of visible viewport
        const centerScreen: Point = {
            x: canvasSize.width / 2,
            y: canvasSize.height / 2,
        };

        const centerWorld = this.viewport.screenToWorld(centerScreen);
        const newNodeIds = normalizeNodeIds(this.clipboardManager.paste(this.graph, centerWorld));
        this.#rememberPastedAreaIds();

        if (newNodeIds.length > 0) {
            this.ensureNodesInsideGrid(newNodeIds);
        } else if (this._lastPastedAreaIds.length === 0) {
            // Payload held no nodes: fall back to the area-only path.
            this.pasteAreas(centerWorld);
        }

        return newNodeIds;
    }

    /**
     * Paste nodes at a provided world position.
     * @param {{x:number,y:number}} worldPos - Target position in world coordinates
     * @returns {string[]} Array of new node IDs
     */
    pasteAt(worldPos: Point): NodeId[] {
        if (!this.clipboardManager.hasData()) {
            return [];
        }

        const newNodeIds = normalizeNodeIds(this.clipboardManager.paste(this.graph, worldPos));
        this.#rememberPastedAreaIds();

        if (newNodeIds.length > 0) {
            this.ensureNodesInsideGrid(newNodeIds);
        } else if (this._lastPastedAreaIds.length === 0) {
            // Payload held no nodes: fall back to the area-only path.
            this.pasteAreas(worldPos);
        }

        return newNodeIds;
    }

    /**
     * Duplicate selected nodes.
     * @param {HTMLCanvasElement} canvas - Canvas element for cursor position detection
     * @returns {string[]} Array of new node IDs
     */
    duplicateSelected(canvas: HTMLCanvasElement | null): NodeId[] {
        const nodeIds = normalizeNodeIds(this.getSelectedNodeIds());
        if (nodeIds.length === 0) {
            return [];
        }

        const targetPos = this._getLastPointerWorldPosition(canvas);
        const newNodeIds = normalizeNodeIds(
            this.clipboardManager.duplicate(this.graph, nodeIds, targetPos || null)
        );

        if (newNodeIds.length > 0) {
            this.ensureNodesInsideGrid(newNodeIds);
        }

        return newNodeIds;
    }

    /**
     * Duplicate nodes at their current positions (no paste offset, no collision resolution).
     * Used by the Ctrl+drag copy gesture so the copies start exactly underneath the originals.
     * @param {string[]} nodeIds - Node IDs to duplicate
     * @returns {string[]} New node IDs in the same order as the provided node IDs
     */
    duplicateNodesAtOriginalPositions(nodeIds: NodeId[]): NodeId[] {
        const normalizedNodeIds = normalizeNodeIds(nodeIds);
        if (normalizedNodeIds.length === 0) {
            return [];
        }

        return normalizeNodeIds(
            this.clipboardManager.duplicate(this.graph, normalizedNodeIds, null, {
                exactPositions: true,
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Documentation Areas
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Copy a single documentation area, ignoring the node selection.
     * @param {string} areaId - Area to copy.
     * @returns {boolean} True when the clipboard accepted it.
     */
    copyArea(areaId: string): boolean {
        const normalizedId = normalizeNodeId(areaId);
        if (!normalizedId) {
            return false;
        }
        return this.clipboardManager.copy(this.graph, [], { areaIds: [normalizedId] });
    }

    /**
     * Cut a single documentation area: copy it, then remove it undoably.
     * @param {string} areaId - Area to cut.
     * @returns {boolean} True when it was copied and removed.
     */
    cutArea(areaId: string): boolean {
        if (!this.copyArea(areaId)) {
            return false;
        }
        this.removeDocumentationArea?.(areaId, 'Cut documentation area');
        return true;
    }

    /**
     * Paste the clipboard's documentation areas near a world position.
     * @param {string|null} areaId - Anchor area id, used for logging only.
     * @param {{x:number,y:number}} worldPos - Target position in world coordinates.
     * @returns {string[]} Newly created area ids.
     */
    pasteAreaAt(areaId: string | null, worldPos: Point): string[] {
        const newAreaIds = this.pasteAreas(worldPos);
        if (newAreaIds.length === 0) {
            console.debug?.('[clipboard] paste-area-into skipped', { areaId });
        }
        return newAreaIds;
    }

    /**
     * Paste only the area part of the payload.
     * @param {{x:number,y:number}} worldPos - Target position in world coordinates.
     * @returns {string[]} Newly created area ids.
     */
    pasteAreas(worldPos: Point): string[] {
        const pasteAreas = this.clipboardManager.pasteAreas;
        if (typeof pasteAreas !== 'function') {
            return [];
        }

        const newAreaIds = normalizeNodeIds(pasteAreas.call(this.clipboardManager, this.graph, worldPos));
        this._lastPastedAreaIds = newAreaIds;
        return newAreaIds;
    }

    /**
     * Area ids created by the most recent paste, in insertion order.
     * @returns {string[]} Pasted area ids.
     */
    getLastPastedAreaIds(): string[] {
        return [...this._lastPastedAreaIds];
    }

    /**
     * Active area ids for copy/cut (empty when no area is active).
     * @returns {string[]} Zero or one id.
     * @private
     */
    #activeAreaIds(): string[] {
        const activeId = normalizeNodeId(this.getActiveDocumentationAreaId?.() ?? null);
        return activeId ? [activeId] : [];
    }

    /**
     * Read the area ids the manager reported for the last paste.
     * @private
     */
    #rememberPastedAreaIds(): void {
        const reported = this.clipboardManager.getLastPastedAreaIds?.() ?? [];
        this._lastPastedAreaIds = normalizeNodeIds(reported);
    }

    /**
     * Check if clipboard has data available.
     * @returns {boolean} True if clipboard has data
     */
    hasData(): boolean {
        return this.clipboardManager.hasData();
    }
}
