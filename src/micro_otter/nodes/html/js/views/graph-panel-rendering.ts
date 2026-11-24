/**
 * GraphPanelRendering - Canvas rendering logic for GraphPanelView
 *
 * Handles all canvas drawing operations including grid, nodes, connections, and selection boxes.
 * Extracted as part of Phase 5 refactoring (2026-01-26).
 */

import {
    PREVIEW_INPUT_CONNECTOR_FILL_COLOR,
    PREVIEW_INPUT_CONNECTOR_STROKE_COLOR,
    PREVIEW_OUTPUT_CONNECTOR_FILL_COLOR,
    PREVIEW_OUTPUT_CONNECTOR_STROKE_COLOR,
} from '../nodes/connection-preview-colors.js';
import {
    DOCUMENTATION_AREA_BORDER_ALPHA,
    DOCUMENTATION_AREA_FILL_ALPHA,
    rgbaFromHex,
} from '../data/documentation-area.js';
import type { DocumentationAreaData } from '../data/documentation-area.js';
import { getDataTypeColor } from '../nodes/data-type-colors.js';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Bounds = { x: number; y: number; width: number; height: number };
type ConnectorKind = 'input' | 'output';
type RenderQualityMode = 'full' | 'interaction';

type RenderingConstants = {
    GRID_SPACING?: number;
    GRID_MAJOR_INTERVAL?: number;
    GRID_MINOR_COLOR?: string;
    GRID_MAJOR_COLOR?: string;
    CONNECTOR_RADIUS?: number;
    TEMP_CONN_COLOR?: string;
    [key: string]: unknown;
};

type ViewportLike = {
    screenToWorld: (point: Point) => Point;
};

type ConnectionsUiLike = {
    drawConnections: (
        ctx: CanvasRenderingContext2D,
        options: {
            nodeUiMap: Map<string, NodeUiLike>;
            viewportBounds?: Bounds | null;
            qualityMode?: RenderQualityMode;
        }
    ) => void;
    drawTempConnection: (
        ctx: CanvasRenderingContext2D,
        options: {
            start: Point;
            end: Point;
            startKind: string;
            startNodeId?: string;
            startIndex?: number;
        },
        qualityMode?: RenderQualityMode
    ) => void;
};

type NodeUiLike = {
    setSelected: (selected: boolean) => void;
    setRelatedHighlight?: (highlighted: boolean) => void;
    getBounds?: () => Bounds;
    draw: (
        ctx: CanvasRenderingContext2D,
        options?: {
            hoverConnector: HoverConnector | null;
            draggingConnection: TempConnection | null;
        }
    ) => void;
};

type HoverConnector = {
    type?: string;
    kind?: string;
    [key: string]: unknown;
};

type TempConnection = {
    start: Point;
    end: Point;
    startKind?: string;
    startNodeId?: string;
    startIndex?: number;
};

type HoverConnection = {
    fromNode: string;
    fromIndex: number;
    toNode: string;
    toIndex: number;
};

type SelectionBox = {
    start: Point;
    end: Point;
};

type RenderExternal = ((ctx: CanvasRenderingContext2D, size: Size) => void) | null;

type GraphPanelRenderingOptions = {
    constants: RenderingConstants;
    viewport: ViewportLike;
    connectionsUi: ConnectionsUiLike;
    maxGridMajorIntervalsWidth?: number;
    maxGridMajorIntervalsHeight?: number;
    nodeCullOverscanWorld?: number;
    connectionCullOverscanWorld?: number;
};

type RenderOptions = {
    /**
     * Whether to draw the background grid. Independent of grid snapping: snapping only affects
     * node placement and must not control grid line visibility.
     */
    showGrid: boolean;
    nodeUiMap: Map<string, NodeUiLike>;
    nodeOrderList: string[];
    selectedNodeIds: Set<string>;
    activeNodeId?: string | null;
    relatedNodeIds?: Set<string> | null;
    hoverConnector?: HoverConnector | null;
    hoverConnection?: HoverConnection | null;
    tempConnection?: TempConnection | null;
    selectionBox?: SelectionBox | null;
    qualityMode?: RenderQualityMode;
    onRenderExternal?: RenderExternal;
};

type DrawNodesOptions = {
    nodeUiMap: Map<string, NodeUiLike>;
    nodeOrderList: string[];
    selectedNodeIds: Set<string>;
    activeNodeId?: string | null;
    relatedNodeIds?: Set<string> | null;
    hoverConnector?: HoverConnector | null;
    tempConnection?: unknown | null;
    viewportBounds?: Bounds | null;
};

type RenderBackgroundOptions = {
    /** Whether to draw the background grid. */
    showGrid: boolean;
    /** Documentation areas in paint order (later entries paint over earlier ones). */
    documentationAreas?: DocumentationAreaData[];
    /** Area drawn with the thicker active border, if any. */
    activeAreaId?: string | null;
};

type DrawDocumentationAreasOptions = {
    activeAreaId?: string | null;
    viewportBounds?: Bounds | null;
};

/**
 * Axis-aligned intersection test used to cull documentation areas.
 * @param {Bounds} a - Area bounds.
 * @param {Bounds} b - Viewport world bounds.
 * @returns {boolean} True when the two rectangles overlap.
 */
function boundsIntersect(a: Bounds, b: Bounds): boolean {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

/**
 * Order node IDs for painting, moving the active node to the end so it is drawn on top.
 * @param {readonly string[]} nodeOrderList - Base node order.
 * @param {string|null|undefined} activeNodeId - Active node ID, if any.
 * @returns {string[]} Ordered node IDs.
 */
export function orderNodeIdsForDrawing(
    nodeOrderList: readonly string[],
    activeNodeId: string | null | undefined
): string[] {
    const ordered = [...nodeOrderList];
    if (!activeNodeId) {
        return ordered;
    }
    const index = ordered.indexOf(activeNodeId);
    if (index === -1) {
        return ordered;
    }
    ordered.splice(index, 1);
    ordered.push(activeNodeId);
    return ordered;
}

/**
 * Order node IDs for hit-testing, checking the active node first (topmost) and then the
 * remaining nodes in reverse draw order.
 * @param {readonly string[]} nodeOrderList - Base node order.
 * @param {string|null|undefined} activeNodeId - Active node ID, if any.
 * @returns {string[]} Ordered node IDs.
 */
export function orderNodeIdsForHitTesting(
    nodeOrderList: readonly string[],
    activeNodeId: string | null | undefined
): string[] {
    const ordered = [...nodeOrderList].reverse();
    if (!activeNodeId) {
        return ordered;
    }
    const index = ordered.indexOf(activeNodeId);
    if (index === -1) {
        return ordered;
    }
    ordered.splice(index, 1);
    ordered.unshift(activeNodeId);
    return ordered;
}

/**
 * Collect the selected nodes plus their one-hop neighbours (nodes directly connected to a
 * selected node). Used to glow the local topology around a selection.
 * @param {readonly object[]} connections - Graph connections.
 * @param {ReadonlySet<string>} selectedNodeIds - Selected node IDs.
 * @returns {Set<string>} Selected ∪ one-hop neighbour node IDs.
 */
export function collectRelatedNodeIds(
    connections: readonly { fromNode: string; toNode: string }[],
    selectedNodeIds: ReadonlySet<string>
): Set<string> {
    const related = new Set(selectedNodeIds);
    if (selectedNodeIds.size === 0) {
        return related;
    }
    for (const connection of connections) {
        if (selectedNodeIds.has(connection.fromNode) || selectedNodeIds.has(connection.toNode)) {
            related.add(connection.fromNode);
            related.add(connection.toNode);
        }
    }
    return related;
}

export class GraphPanelRendering {
    constants: RenderingConstants;
    viewport: ViewportLike;
    connectionsUi: ConnectionsUiLike;
    maxGridMajorIntervals: Size;
    nodeCullOverscanWorld: number;
    connectionCullOverscanWorld: number;

    /**
     * @param {object} options
     * @param {object} options.constants - Layout constants (GRID_SPACING, colors, etc.)
     * @param {GraphPanelViewport} options.viewport - Viewport module for coordinate transforms
     * @param {ConnectionsUi} options.connectionsUi - Connection rendering manager
     * @param {number} options.maxGridMajorIntervalsWidth - Max major intervals in X direction
     * @param {number} options.maxGridMajorIntervalsHeight - Max major intervals in Y direction
     */
    constructor({
        constants,
        viewport,
        connectionsUi,
        maxGridMajorIntervalsWidth = 4,
        maxGridMajorIntervalsHeight = 3,
        nodeCullOverscanWorld = 24,
        connectionCullOverscanWorld = 24,
    }: GraphPanelRenderingOptions) {
        this.constants = constants;
        this.viewport = viewport;
        this.connectionsUi = connectionsUi;
        this.maxGridMajorIntervals = {
            width: maxGridMajorIntervalsWidth,
            height: maxGridMajorIntervalsHeight,
        };
        this.nodeCullOverscanWorld = nodeCullOverscanWorld;
        this.connectionCullOverscanWorld = connectionCullOverscanWorld;
    }

    /**
     * Main render orchestrator. Draws grid, nodes, connections, and overlays.
     */
    render(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        {
            showGrid,
            nodeUiMap,
            nodeOrderList,
            selectedNodeIds,
            activeNodeId = null,
            relatedNodeIds = null,
            hoverConnector = null,
            hoverConnection = null,
            tempConnection = null,
            selectionBox = null,
            qualityMode = 'full',
            onRenderExternal = null,
        }: RenderOptions
    ): void {
        const nodeViewportBounds = this.getViewportWorldBounds(
            width,
            height,
            this.nodeCullOverscanWorld
        );
        const connectionViewportBounds = this.getViewportWorldBounds(
            width,
            height,
            this.connectionCullOverscanWorld
        );

        if (showGrid) {
            this.drawGrid(ctx, width, height);
        }

        this.drawConnections(
            ctx,
            nodeUiMap,
            hoverConnection,
            connectionViewportBounds,
            qualityMode,
            selectedNodeIds
        );

        this.drawNodes(ctx, {
            nodeUiMap,
            nodeOrderList,
            selectedNodeIds,
            activeNodeId,
            relatedNodeIds,
            hoverConnector,
            tempConnection,
            viewportBounds: nodeViewportBounds,
        });

        if (selectionBox) {
            this.drawSelectionBox(ctx, selectionBox);
        }

        if (tempConnection) {
            this.drawTempConnection(ctx, tempConnection, qualityMode);
        }

        if (typeof onRenderExternal === 'function') {
            onRenderExternal(ctx, { width, height });
        }
    }

    /**
     * Draw the background layer: the grid and the documentation-area shading.
     *
     * This is the pass that the panel runs on the background canvas. It deliberately draws
     * nothing else — connections and nodes belong to `render()` on the node canvas, and the
     * area *text* is DOM (the documentation layer), which is what keeps it selectable.
     * @param {CanvasRenderingContext2D} ctx - Background canvas context (viewport applied).
     * @param {number} width - Canvas width in CSS pixels.
     * @param {number} height - Canvas height in CSS pixels.
     * @param {RenderBackgroundOptions} options - Grid flag plus the areas to shade.
     */
    renderBackground(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        { showGrid, documentationAreas = [], activeAreaId = null }: RenderBackgroundOptions
    ): void {
        if (showGrid) {
            this.drawGrid(ctx, width, height);
        }

        if (!Array.isArray(documentationAreas) || documentationAreas.length === 0) {
            return;
        }

        const viewportBounds = this.getViewportWorldBounds(width, height, 0);
        this.drawDocumentationAreas(ctx, documentationAreas, { activeAreaId, viewportBounds });
    }

    /**
     * Draw translucent rounded rectangles for the graph's documentation areas.
     *
     * Areas paint in array order, so later entries cover earlier ones (matching the DOM layer
     * and the hit-test precedence). An area entirely outside the viewport is skipped.
     * @param {CanvasRenderingContext2D} ctx - Background canvas context (viewport applied).
     * @param {DocumentationAreaData[]} areas - Areas in paint order.
     * @param {DrawDocumentationAreasOptions} options - Active id and viewport cull bounds.
     */
    drawDocumentationAreas(
        ctx: CanvasRenderingContext2D,
        areas: DocumentationAreaData[],
        { activeAreaId = null, viewportBounds = null }: DrawDocumentationAreasOptions = {}
    ): void {
        if (!Array.isArray(areas) || areas.length === 0) {
            return;
        }

        ctx.save();
        try {
            for (const area of areas) {
                const bounds = area?.bounds;
                if (!bounds) {
                    continue;
                }
                if (viewportBounds && !boundsIntersect(bounds, viewportBounds)) {
                    continue;
                }

                this.#traceDocumentationAreaPath(ctx, bounds);
                // Translucency comes from the two shared constants only: the stored colour is
                // plain `#rrggbb`, so nothing can make a box opaque.
                ctx.fillStyle = rgbaFromHex(area.color, DOCUMENTATION_AREA_FILL_ALPHA);
                ctx.fill();
                ctx.strokeStyle = rgbaFromHex(area.color, DOCUMENTATION_AREA_BORDER_ALPHA);
                ctx.lineWidth = activeAreaId === area.id ? 2.5 : 1.5;
                ctx.stroke();
            }
        } finally {
            ctx.restore();
        }
    }

    /**
     * Trace a rounded rectangle without relying on `ctx.roundRect()` availability.
     * @param {CanvasRenderingContext2D} ctx - Canvas context.
     * @param {Bounds} bounds - Rectangle in world coordinates.
     * @private
     */
    #traceDocumentationAreaPath(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
        const { x, y, width, height } = bounds;
        const radius = Math.max(0, Math.min(8, width / 2, height / 2));

        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    /**
     * Draw grid lines in world space.
     */
    drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const GRID_SPACING =
            typeof this.constants.GRID_SPACING === 'number' ? this.constants.GRID_SPACING : 32;
        const GRID_MAJOR_INTERVAL =
            typeof this.constants.GRID_MAJOR_INTERVAL === 'number'
                ? this.constants.GRID_MAJOR_INTERVAL
                : 5;
        const GRID_MINOR_COLOR =
            typeof this.constants.GRID_MINOR_COLOR === 'string'
                ? this.constants.GRID_MINOR_COLOR
                : 'rgba(235, 238, 246, 0.12)';
        const GRID_MAJOR_COLOR =
            typeof this.constants.GRID_MAJOR_COLOR === 'string'
                ? this.constants.GRID_MAJOR_COLOR
                : 'rgba(235, 238, 246, 0.24)';

        const topLeft = this.viewport.screenToWorld({ x: 0, y: 0 });
        const bottomRight = this.viewport.screenToWorld({ x: width, y: height });
        const minX = Math.min(topLeft.x, bottomRight.x);
        const maxX = Math.max(topLeft.x, bottomRight.x);
        const minY = Math.min(topLeft.y, bottomRight.y);
        const maxY = Math.max(topLeft.y, bottomRight.y);

        const majorGridSpacing = GRID_SPACING * GRID_MAJOR_INTERVAL;
        const maxIntervalIdxX = Math.min(
            Math.ceil(maxX / majorGridSpacing),
            this.maxGridMajorIntervals.width
        );
        const minIntervalIdxX = Math.max(0, Math.floor(minX / majorGridSpacing));
        const maxIntervalIdxY = Math.min(
            Math.ceil(maxY / majorGridSpacing),
            this.maxGridMajorIntervals.height
        );
        const minIntervalIdxY = Math.max(0, Math.floor(minY / majorGridSpacing));

        const startX = minIntervalIdxX * majorGridSpacing;
        const endX = maxIntervalIdxX * majorGridSpacing;
        const startY = minIntervalIdxY * majorGridSpacing;
        const endY = maxIntervalIdxY * majorGridSpacing;

        ctx.save();
        ctx.lineCap = 'butt';

        for (let x = startX, idx = 0; x <= endX; x += GRID_SPACING, idx += 1) {
            ctx.strokeStyle = idx % GRID_MAJOR_INTERVAL === 0 ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
            ctx.lineWidth = idx % GRID_MAJOR_INTERVAL === 0 ? 1.2 : 0.8;
            ctx.beginPath();
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
            ctx.stroke();
        }

        for (let y = startY, idx = 0; y <= endY; y += GRID_SPACING, idx += 1) {
            ctx.strokeStyle = idx % GRID_MAJOR_INTERVAL === 0 ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
            ctx.lineWidth = idx % GRID_MAJOR_INTERVAL === 0 ? 1.2 : 0.8;
            ctx.beginPath();
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Draw all nodes on the canvas.
     */
    drawNodes(
        ctx: CanvasRenderingContext2D,
        {
            nodeUiMap,
            nodeOrderList,
            selectedNodeIds,
            activeNodeId = null,
            relatedNodeIds = null,
            hoverConnector,
            tempConnection,
            viewportBounds = null,
        }: DrawNodesOptions
    ): void {
        ctx.save();

        const hoverForUi = hoverConnector
            ? { ...hoverConnector, type: hoverConnector.type || hoverConnector.kind }
            : null;

        const baseOrder = nodeOrderList.length ? nodeOrderList : Array.from(nodeUiMap.keys());
        const orderedIds = orderNodeIdsForDrawing(baseOrder, activeNodeId);

        const draggingConnection =
            tempConnection && typeof tempConnection === 'object'
                ? (tempConnection as TempConnection)
                : null;

        orderedIds.forEach((nodeId) => {
            const nodeUi = nodeUiMap.get(nodeId);
            if (!nodeUi) {
                return;
            }

            const isSelected = selectedNodeIds.has(nodeId);
            nodeUi.setSelected(isSelected);
            if (typeof nodeUi.setRelatedHighlight === 'function') {
                const isRelated = relatedNodeIds ? relatedNodeIds.has(nodeId) : false;
                nodeUi.setRelatedHighlight(isRelated && !isSelected);
            }

            if (viewportBounds && typeof nodeUi.getBounds === 'function') {
                const nodeBounds = nodeUi.getBounds();
                if (this.isRectFullyOutsideViewport(nodeBounds, viewportBounds)) {
                    return;
                }
            }

            nodeUi.draw(ctx, {
                hoverConnector: hoverForUi,
                draggingConnection,
            });
        });

        ctx.restore();
    }

    /**
     * Draw all connections between nodes.
     */
    drawConnections(
        ctx: CanvasRenderingContext2D,
        nodeUiMap: Map<string, NodeUiLike>,
        hoverConnection: HoverConnection | null = null,
        viewportBounds: Bounds | null = null,
        qualityMode: RenderQualityMode = 'full',
        highlightedNodeIds: Set<string> | null = null
    ): void {
        if ((this.connectionsUi as Record<string, unknown>).setHoverConnection) {
            (
                this.connectionsUi as unknown as {
                    setHoverConnection: (value: HoverConnection | null) => void;
                }
            ).setHoverConnection(hoverConnection);
        }
        if ((this.connectionsUi as Record<string, unknown>).setHighlightedNodes) {
            (
                this.connectionsUi as unknown as {
                    setHighlightedNodes: (value: Set<string> | null) => void;
                }
            ).setHighlightedNodes(highlightedNodeIds);
        }
        this.connectionsUi.drawConnections(ctx, {
            nodeUiMap,
            viewportBounds,
            qualityMode,
        });
    }

    getViewportWorldBounds(width: number, height: number, overscan = 0): Bounds {
        const topLeft = this.viewport.screenToWorld({ x: 0, y: 0 });
        const bottomRight = this.viewport.screenToWorld({ x: width, y: height });
        const minX = Math.min(topLeft.x, bottomRight.x) - overscan;
        const maxX = Math.max(topLeft.x, bottomRight.x) + overscan;
        const minY = Math.min(topLeft.y, bottomRight.y) - overscan;
        const maxY = Math.max(topLeft.y, bottomRight.y) + overscan;

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }

    isRectFullyOutsideViewport(rect: Bounds, viewportBounds: Bounds): boolean {
        if (!this.hasFiniteBounds(rect) || !this.hasFiniteBounds(viewportBounds)) {
            return false;
        }

        const rectRight = rect.x + rect.width;
        const rectBottom = rect.y + rect.height;
        const viewportRight = viewportBounds.x + viewportBounds.width;
        const viewportBottom = viewportBounds.y + viewportBounds.height;

        return (
            rectRight < viewportBounds.x ||
            rect.x > viewportRight ||
            rectBottom < viewportBounds.y ||
            rect.y > viewportBottom
        );
    }

    hasFiniteBounds(bounds: Bounds): boolean {
        return (
            Number.isFinite(bounds.x) &&
            Number.isFinite(bounds.y) &&
            Number.isFinite(bounds.width) &&
            Number.isFinite(bounds.height)
        );
    }

    /**
     * Draw an in-progress connection as the user drags between connectors.
     */
    drawTempConnection(
        ctx: CanvasRenderingContext2D,
        { start, end, startKind, startNodeId, startIndex }: TempConnection,
        qualityMode: RenderQualityMode = 'full'
    ): void {
        this.connectionsUi.drawTempConnection(
            ctx,
            {
                start,
                end,
                startKind: startKind || 'output',
                startNodeId,
                startIndex,
            },
            qualityMode
        );
    }

    /**
     * Draw a single connector with optional hover highlight.
     */
    drawConnector(
        ctx: CanvasRenderingContext2D,
        {
            x,
            y,
            kind,
            highlighted = false,
            type = null,
        }: {
            x: number;
            y: number;
            kind: ConnectorKind;
            highlighted?: boolean;
            type?: string | null;
        }
    ): void {
        const CONNECTOR_RADIUS =
            typeof this.constants.CONNECTOR_RADIUS === 'number'
                ? this.constants.CONNECTOR_RADIUS
                : 7;
        const TEMP_CONN_COLOR =
            typeof this.constants.TEMP_CONN_COLOR === 'string'
                ? this.constants.TEMP_CONN_COLOR
                : 'rgba(240, 216, 88, 0.8)';
        const highlightedConnectorColor =
            highlighted && typeof type === 'string' && type.trim()
                ? getDataTypeColor(type)
                : TEMP_CONN_COLOR;
        ctx.save();
        const radius = CONNECTOR_RADIUS;

        if (kind === 'input') {
            ctx.strokeStyle = highlighted
                ? highlightedConnectorColor
                : PREVIEW_INPUT_CONNECTOR_STROKE_COLOR;
            ctx.fillStyle = highlighted
                ? highlightedConnectorColor
                : PREVIEW_INPUT_CONNECTOR_FILL_COLOR;
            ctx.lineWidth = highlighted ? 3 : 2;
            ctx.beginPath();
            ctx.arc(x - radius, y, radius, -Math.PI * 0.5, Math.PI * 0.5);
            ctx.stroke();
            if (highlighted) {
                ctx.globalAlpha = 0.2;
                ctx.beginPath();
                ctx.arc(x - radius, y, radius + 4, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.fillStyle = highlighted
                ? highlightedConnectorColor
                : PREVIEW_OUTPUT_CONNECTOR_FILL_COLOR;
            ctx.strokeStyle = highlighted
                ? highlightedConnectorColor
                : PREVIEW_OUTPUT_CONNECTOR_STROKE_COLOR;
            ctx.lineWidth = highlighted ? 2.5 : 1.5;
            const size = radius;
            ctx.beginPath();
            ctx.roundRect(x - size, y - size, size * 2, size * 2, 3);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Draw the selection box during box selection.
     */
    drawSelectionBox(ctx: CanvasRenderingContext2D, selectionBox: SelectionBox): void {
        if (!selectionBox) {
            return;
        }

        const { start, end } = selectionBox;
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);

        ctx.save();

        ctx.fillStyle = 'rgba(99, 181, 255, 0.15)';
        ctx.fillRect(left, top, width, height);

        ctx.strokeStyle = 'rgba(99, 181, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(left, top, width, height);

        ctx.restore();
    }

    /**
     * Compute input/output connector positions for a node in world space.
     */
    getConnectorPositionsWorld(node: { x?: number; y?: number; width?: number; height?: number }): {
        input: Point;
        output: Point;
    } {
        const x = node.x || 0;
        const y = node.y || 0;
        const w = node.width || 140;
        const h = node.height || 90;
        const centerY = y + h / 2;
        return {
            input: { x, y: centerY },
            output: { x: x + w, y: centerY },
        };
    }
}
