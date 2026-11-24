// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * ConnectionsUiV2 owns rendering of graph connections (static and in-progress).
 *
 * Responsibilities:
 * - Draw existing graph connections between node connector anchors.
 * - Draw the temporary connection during drag operations.
 * - Listen for connection add/remove (and node removal) events to stay in sync and invalidate renders.
 *
 * Member functions (alphabetical):
 * - _resolveNodeUi(nodeUiMap, nodeId): locate a NodeUi instance from a map or getter.
 * - _subscribeGraph(): attach graph change listener to track connection changes.
 * - _unsubscribeGraph(): remove any active graph listener.
 * - clearTempConnection(): clear the active temporary connection state.
 * - constructor(options): configure graph reference, node UI accessor, and invalidate hook.
 * - dispose(): tear down listeners and release the graph reference.
 * - draw(ctx, opts): render connections and an in-progress temp connection.
 * - drawConnections(ctx, opts): render all persisted graph connections.
 * - drawTempConnection(ctx, tempConnection): render the current temp connection, if any.
 * - setGraph(graph): swap the bound graph and resubscribe for changes.
 * - setHoverConnector(connector): set the currently hovered connector descriptor.
 * - setTempConnection(tempConnection): set the in-progress temp connection descriptor.
 */
import { CONNECTOR_RADIUS } from './node-ui-constants.js';
import {
    getConnectionControlOffset,
    getDirectedControlOffset,
} from './connection-geometry.js';
import { getDataTypeColor, getInputConnectorType } from './data-type-colors.js';
import {
    HOVER_CONNECTION_GRADIENT_END_COLOR,
    HOVER_CONNECTION_GRADIENT_START_COLOR,
    HOVER_CONNECTION_SHADOW_COLOR,
    INVALID_CONNECTION_LABEL_BACKGROUND_COLOR,
    INVALID_CONNECTION_LABEL_BORDER_COLOR,
    INVALID_CONNECTION_LABEL_TEXT_COLOR,
    INVALID_CONNECTION_SHADOW_COLOR,
    RELATED_CONNECTION_GLOW_COLOR,
    RELATED_CONNECTION_SHADOW_COLOR,
    TEMP_CONNECTION_SHADOW_COLOR,
    TEMP_CONNECTION_FROM_INPUT_COLOR,
    TEMP_CONNECTION_FROM_OUTPUT_COLOR,
    TRANSPARENT_CONNECTION_SHADOW_COLOR,
} from './connection-preview-colors.js';
import { assertAppEventPayloadType } from '../core/app-event.js';
import { log, logEnabled } from '../core/log.js';
import { resolveTypeCompatibility } from '../data/type-conversions.js';

type NodeIdentifier = string;
type ConnectorKind = 'input' | 'output';
type RenderQualityMode = 'full' | 'interaction';

function normalizeNodeId(value: unknown): NodeIdentifier | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

function hasFiniteBounds(bounds: Bounds | null | undefined): bounds is Bounds {
    if (!bounds) {
        return false;
    }

    return (
        Number.isFinite(bounds.x) &&
        Number.isFinite(bounds.y) &&
        Number.isFinite(bounds.width) &&
        Number.isFinite(bounds.height)
    );
}

function rectsIntersect(rect: Bounds, viewportBounds: Bounds): boolean {
    const rectRight = rect.x + rect.width;
    const rectBottom = rect.y + rect.height;
    const viewportRight = viewportBounds.x + viewportBounds.width;
    const viewportBottom = viewportBounds.y + viewportBounds.height;

    return !(
        rectRight < viewportBounds.x ||
        rect.x > viewportRight ||
        rectBottom < viewportBounds.y ||
        rect.y > viewportBottom
    );
}

function getConnectionEnvelopeBounds(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    fromXExtended: number,
    toXExtended: number,
    cpOffset: number
): Bounds {
    const controlPointOneX = fromXExtended + cpOffset;
    const controlPointTwoX = toX - cpOffset;

    const minX = Math.min(fromXExtended, controlPointOneX, controlPointTwoX, toXExtended);
    const maxX = Math.max(fromXExtended, controlPointOneX, controlPointTwoX, toXExtended);
    const minY = Math.min(fromY, toY);
    const maxY = Math.max(fromY, toY);

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

function toRgb(color: string): { red: number; green: number; blue: number } | null {
    const normalized = color.trim();
    const match = normalized.match(/^#([0-9a-f]{6})$/i);
    if (!match) {
        return null;
    }

    const hex = match[1];
    return {
        red: Number.parseInt(hex.slice(0, 2), 16),
        green: Number.parseInt(hex.slice(2, 4), 16),
        blue: Number.parseInt(hex.slice(4, 6), 16),
    };
}

function blendColors(fromColor: string, toColor: string, mix = 0.5): string {
    const fromRgb = toRgb(fromColor);
    const toRgbValue = toRgb(toColor);
    if (!fromRgb || !toRgbValue) {
        return toColor;
    }

    const ratio = Math.max(0, Math.min(1, mix));
    const red = Math.round(fromRgb.red + (toRgbValue.red - fromRgb.red) * ratio);
    const green = Math.round(fromRgb.green + (toRgbValue.green - fromRgb.green) * ratio);
    const blue = Math.round(fromRgb.blue + (toRgbValue.blue - fromRgb.blue) * ratio);
    return `rgb(${red}, ${green}, ${blue})`;
}

type ConnectionPoint = {
    x: number;
    y: number;
};

type Bounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type NodeConnection = {
    fromNode: NodeIdentifier;
    fromIndex: number;
    toNode: NodeIdentifier;
    toIndex: number;
};

type ConnectorReference = {
    nodeId: string;
    index: number;
    kind?: ConnectorKind;
    type?: ConnectorKind;
    id?: string;
    x?: number;
    y?: number;
    pos?: ConnectionPoint;
};

type TempConnectionPayload = {
    start: ConnectionPoint;
    end: ConnectionPoint;
    startKind?: string;
    startNodeId?: string;
    startIndex?: number;
};

type InvalidConnectionOverlay = {
    start: ConnectionPoint;
    end: ConnectionPoint;
    message: string;
    createdAt: number;
    durationMs: number;
};

type InvalidatePayload = {
    type?: string;
    connection?: NodeConnection;
};

type GraphEventEnvelope = {
    name?: string;
    detail?: {
        connection?: NodeConnection;
    };
};

type NodeUiLike = {
    getConnectorPosition?: (
        kind: ConnectorKind,
        index?: number
    ) => ConnectionPoint | null | undefined;
};

type NodeUiMapLike = {
    get?: (nodeId: string) => unknown;
};

type NodeGraphLike = {
    getConnections?: () => NodeConnection[];
    getNode?: (nodeId: string) => unknown;
    getDataTypeKind?: (typeId: string) => 'value' | 'structure';
    on?: (eventName: string, listener: (event: GraphEventEnvelope) => void) => unknown;
};

type NodeInputLike = {
    allowedTypes?: string[];
};

type NodeOutputLike = {
    outputType?: string;
};

type NodeDataLike = {
    inputs?: NodeInputLike[];
    outputs?: NodeOutputLike[];
    getOutputType?: (outputId: string) => string;
};

type ConnectionsUiOptions = {
    graph?: NodeGraphLike | null;
    getNodeUi?: ((nodeId: string) => unknown) | null;
    onInvalidate?: ((event: InvalidatePayload) => void) | null;
};

type DrawConnectionsOptions = {
    nodeUiMap?: NodeUiMapLike | null;
    viewportBounds?: Bounds | null;
    qualityMode?: RenderQualityMode;
};

type DrawOptions = {
    nodeUiMap?: NodeUiMapLike | null;
    hoverConnector?: ConnectorReference | null;
    hoverConnection?: NodeConnection | null;
    tempConnection?: TempConnectionPayload | null;
    qualityMode?: RenderQualityMode;
};

class ConnectionsUi {
    graph: NodeGraphLike | null;
    getNodeUi: (nodeId: NodeIdentifier) => NodeUiLike | null;
    onInvalidate: ((event: InvalidatePayload) => void) | null;
    tempConnection: TempConnectionPayload | null;
    hoverConnector: ConnectorReference | null;
    hoverConnection: NodeConnection | null;
    highlightedNodeIds: Set<NodeIdentifier>;
    invalidConnection: InvalidConnectionOverlay | null;
    _unsubscribe: unknown;
    _invalidConnectionTimer: ReturnType<typeof setInterval> | null;
    connections: NodeConnection[];

    /**
     * Create a new connection renderer/controller.
     * @param {object} [options]
     * @param {import('../data/node-graph.js').default|object|null} [options.graph] Graph instance to observe and render.
    * @param {(nodeId:string)=>object|null} [options.getNodeUi] Lookup for NodeUi instances when no map is provided.
     * @param {(event:{type?:string,connection?:object})=>void} [options.onInvalidate] Callback invoked when graph changes require a redraw.
     */
    constructor({ graph = null, getNodeUi = null, onInvalidate = null }: ConnectionsUiOptions = {}) {
        this.graph = graph;
        this.getNodeUi =
            typeof getNodeUi === 'function'
                ? (nodeId: NodeIdentifier) => (getNodeUi(nodeId) as NodeUiLike | null)
                : () => null;
        this.onInvalidate = typeof onInvalidate === 'function' ? onInvalidate : null;
        this.tempConnection = null;
        this.hoverConnector = null;
        this.hoverConnection = null;
        this.highlightedNodeIds = new Set();
        this.invalidConnection = null;
        this._unsubscribe = null;
        this._invalidConnectionTimer = null;
        this.connections = [];
        this.setGraph(graph);
    }

    /**
     * Replace the bound graph reference and resubscribe to change events.
     * @param {import('../data/node-graph.js').default|object|null} graph
     */
    setGraph(graph: NodeGraphLike | null): void {
        this._unsubscribeGraph();
        this.graph = graph;
        this.connections = this.graph?.getConnections?.() || [];
        this._subscribeGraph();
    }

    /**
     * Attach graph change listener for connection and node removals.
     * @private
     */
    _subscribeGraph(): void {
        if (!this.graph || typeof this.graph.on !== 'function') {
            return;
        }
        this._unsubscribe = this.graph.on('*', (event: GraphEventEnvelope) => {
            const type = event?.name;
            if (
                type !== 'connection-added' &&
                type !== 'connection-removed' &&
                type !== 'node-removed'
            ) {
                return;
            }

            if (type === 'connection-added') {
                assertAppEventPayloadType(
                    event,
                    'NodeGraph.ConnectionAdded.v1',
                    'ConnectionsUi graph listener'
                );
            } else if (type === 'connection-removed') {
                assertAppEventPayloadType(
                    event,
                    'NodeGraph.ConnectionRemoved.v1',
                    'ConnectionsUi graph listener'
                );
            } else if (type === 'node-removed') {
                assertAppEventPayloadType(
                    event,
                    'NodeGraph.NodeRemoved.v1',
                    'ConnectionsUi graph listener'
                );
            }

            this.connections = this.graph?.getConnections?.() || [];
            if (this.onInvalidate) {
                this.onInvalidate({ type, connection: event?.detail?.connection });
            }
        });
    }

    /**
     * Remove any active graph change listener.
     * @private
     */
    _unsubscribeGraph(): void {
        if (typeof this._unsubscribe === 'function') {
            try {
                this._unsubscribe();
            } catch {
                // ignore listener cleanup errors
            }
        }
        this._unsubscribe = null;
    }

    /**
     * Update the currently hovered connector descriptor.
     * @param {object|null} connector
     */
    setHoverConnector(connector: ConnectorReference | null): void {
        this.hoverConnector = connector || null;
    }

    setHoverConnection(connection: NodeConnection | null): void {
        this.hoverConnection = connection || null;
    }

    /**
     * Set the set of node IDs whose connections should render with a highlight halo.
     * @param {Iterable<string>|Set<string>|null} nodeIds - Node IDs to highlight.
     */
    setHighlightedNodes(nodeIds: Iterable<NodeIdentifier> | null): void {
        this.highlightedNodeIds.clear();
        if (!nodeIds) {
            return;
        }
        for (const nodeId of nodeIds) {
            const normalized = normalizeNodeId(nodeId);
            if (normalized) {
                this.highlightedNodeIds.add(normalized);
            }
        }
    }

    /**
     * Set the active temporary connection (drag in progress).
     * @param {{start:{x:number,y:number},end:{x:number,y:number}}|null} tempConnection
     */
    setTempConnection(tempConnection: TempConnectionPayload | null): void {
        this.tempConnection = tempConnection || null;
    }

    /**
     * Clear the temporary connection state.
     */
    clearTempConnection(): void {
        this.tempConnection = null;
    }

    showInvalidConnection(
        {
            start,
            end,
            message,
        }: {
            start: ConnectionPoint;
            end: ConnectionPoint;
            message?: string;
        },
        durationMs = 1000
    ): void {
        const safeDuration = Math.max(300, Math.floor(durationMs));
        this.invalidConnection = {
            start,
            end,
            message: message && message.trim() ? message.trim() : 'Invalid connection',
            createdAt: Date.now(),
            durationMs: safeDuration,
        };

        this._clearInvalidConnectionTimer();
        if (this.onInvalidate) {
            this.onInvalidate({ type: 'connection-invalid' });
        }

        this._invalidConnectionTimer = setInterval(() => {
            const active = this.invalidConnection;
            if (!active) {
                this._clearInvalidConnectionTimer();
                return;
            }

            const elapsed = Date.now() - active.createdAt;
            if (elapsed >= active.durationMs) {
                this.invalidConnection = null;
                this._clearInvalidConnectionTimer();
            }

            if (this.onInvalidate) {
                this.onInvalidate({ type: 'connection-invalid' });
            }
        }, 100);
    }

    _clearInvalidConnectionTimer(): void {
        if (this._invalidConnectionTimer) {
            clearInterval(this._invalidConnectionTimer);
            this._invalidConnectionTimer = null;
        }
    }

    _drawInvalidConnectionOverlay(ctx: CanvasRenderingContext2D): void {
        const overlay = this.invalidConnection;
        if (!overlay) {
            return;
        }

        const elapsed = Date.now() - overlay.createdAt;
        if (elapsed >= overlay.durationMs) {
            this.invalidConnection = null;
            this._clearInvalidConnectionTimer();
            return;
        }

        const pulse = 0.45 + 0.55 * Math.abs(Math.sin((elapsed / 1000) * Math.PI * 6));
        const alpha = Math.min(1, Math.max(0.25, pulse));
        const { start, end, message } = overlay;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;

        ctx.save();
        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = INVALID_CONNECTION_SHADOW_COLOR;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const text = message || 'Invalid connection';
        const padding = 6;
        const textWidth = ctx.measureText(text).width;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = 18;
        const boxX = midX - boxWidth / 2;
        const boxY = midY - 10 - boxHeight;

        ctx.fillStyle = INVALID_CONNECTION_LABEL_BACKGROUND_COLOR;
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        ctx.strokeStyle = INVALID_CONNECTION_LABEL_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        ctx.fillStyle = INVALID_CONNECTION_LABEL_TEXT_COLOR;
        ctx.fillText(text, midX, boxY + boxHeight - 4);
        ctx.restore();
    }

    /**
     * Resolve a NodeUi instance from a map or fallback getter.
     * @param {Map<string, object>|null} nodeUiMap
     * @param {string} nodeId
     * @returns {object|null}
     * @private
     */
    _resolveNodeUi(nodeUiMap: NodeUiMapLike | null, nodeId: NodeIdentifier): NodeUiLike | null {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (!normalizedNodeId) {
            return null;
        }

        if (nodeUiMap && typeof nodeUiMap.get === 'function') {
            return (nodeUiMap.get(normalizedNodeId) as NodeUiLike | null) || null;
        }
        return this.getNodeUi(normalizedNodeId);
    }

    _resolveConnectionColors(conn: NodeConnection): {
        fromColor: string;
        toColor: string;
        requiresImplicitConversion: boolean;
    } {
        if (!this.graph || typeof this.graph.getNode !== 'function') {
            return {
                fromColor: getDataTypeColor('any'),
                toColor: getDataTypeColor('any'),
                requiresImplicitConversion: false,
            };
        }

        const sourceNode = this.graph.getNode(conn.fromNode) as NodeDataLike | null;
        const targetNode = this.graph.getNode(conn.toNode) as NodeDataLike | null;
        let outputType = sourceNode?.outputs?.[conn.fromIndex]?.outputType || 'any';
        const outputDef = sourceNode?.outputs?.[conn.fromIndex];
        if (
            sourceNode &&
            typeof sourceNode.getOutputType === 'function' &&
            outputDef &&
            typeof (outputDef as Record<string, unknown>).id === 'string'
        ) {
            try {
                outputType = sourceNode.getOutputType((outputDef as Record<string, unknown>).id as string);
            } catch {
                // Best effort: fall back to the declared output type.
            }
        }
        const targetAllowedTypes = targetNode?.inputs?.[conn.toIndex]?.allowedTypes || [];
        const inputType = getInputConnectorType(targetAllowedTypes);
        const compatibility = resolveTypeCompatibility(outputType, targetAllowedTypes, {
            resolveTypeKind: (typeId) => this.graph.getDataTypeKind?.(typeId) ?? 'value',
        });

        return {
            fromColor: getDataTypeColor(outputType),
            toColor: getDataTypeColor(inputType),
            requiresImplicitConversion: compatibility.compatible && compatibility.requiresImplicitConversion,
        };
    }

    _resolveConnectorTypeColor(
        nodeId: NodeIdentifier,
        connectorIndex: number,
        kind: ConnectorKind
    ): string {
        if (!this.graph || typeof this.graph.getNode !== 'function') {
            return getDataTypeColor('any');
        }

        const node = this.graph.getNode(nodeId) as NodeDataLike | null;
        if (!node) {
            return getDataTypeColor('any');
        }

        if (kind === 'output') {
            let outputType = node.outputs?.[connectorIndex]?.outputType || 'any';
            const outputDef = node.outputs?.[connectorIndex] as
                | (NodeOutputLike & { id?: string })
                | undefined;
            if (
                typeof node.getOutputType === 'function' &&
                outputDef &&
                typeof outputDef.id === 'string'
            ) {
                try {
                    outputType = node.getOutputType(outputDef.id);
                } catch {
                    // Best effort: fall back to the declared output type.
                }
            }
            return getDataTypeColor(outputType);
        }

        const allowedTypes = node.inputs?.[connectorIndex]?.allowedTypes || [];
        return getDataTypeColor(getInputConnectorType(allowedTypes));
    }

    _resolveTempConnectionGradientColors(activeTemp: TempConnectionPayload): {
        startColor: string;
        endColor: string;
    } {
        const startKind: ConnectorKind = activeTemp.startKind === 'input' ? 'input' : 'output';
        const defaultStartColor =
            startKind === 'input' ? TEMP_CONNECTION_FROM_INPUT_COLOR : TEMP_CONNECTION_FROM_OUTPUT_COLOR;

        let startColor = defaultStartColor;
        if (
            typeof activeTemp.startNodeId === 'string' &&
            Number.isInteger(activeTemp.startIndex) &&
            (activeTemp.startIndex as number) >= 0
        ) {
            startColor = this._resolveConnectorTypeColor(
                activeTemp.startNodeId,
                activeTemp.startIndex as number,
                startKind
            );
        }

        let endColor = startColor;
        const hover = this.hoverConnector;
        const hoverKind = (hover?.kind || hover?.type) as ConnectorKind | undefined;
        const oppositeKind: ConnectorKind = startKind === 'input' ? 'output' : 'input';
        if (
            hover &&
            hoverKind === oppositeKind &&
            typeof hover.nodeId === 'string' &&
            Number.isInteger(hover.index) &&
            (hover.index as number) >= 0
        ) {
            endColor = this._resolveConnectorTypeColor(hover.nodeId, hover.index, oppositeKind);
        }

        return { startColor, endColor };
    }

    /**
     * Draw all persisted graph connections onto the provided context.
     * @param {CanvasRenderingContext2D} ctx
    * @param {{nodeUiMap?: Map<string, object>|null}} [options]
     */
    drawConnections(ctx: CanvasRenderingContext2D | null | undefined, {
        nodeUiMap = null,
        viewportBounds = null,
        qualityMode = 'full',
    }: DrawConnectionsOptions = {}): void {
        if (!ctx || !this.graph) {
            return;
        }
        const interactionQuality = qualityMode === 'interaction';
        const shouldLogConnectionColors = logEnabled(
            'ConnectionsUiRendering',
            'connection-colors',
            'debug'
        );
        ctx.save();
        this.connections.forEach((conn) => {
            const fromUi = this._resolveNodeUi(nodeUiMap, conn.fromNode);
            const toUi = this._resolveNodeUi(nodeUiMap, conn.toNode);
            if (!fromUi || !toUi) {
                return;
            }
            const fromConnector =
                fromUi.getConnectorPosition?.('output', conn.fromIndex) ||
                fromUi.getConnectorPosition?.('output', 0);
            const toConnector =
                toUi.getConnectorPosition?.('input', conn.toIndex) ||
                toUi.getConnectorPosition?.('input', 0);
            if (!fromConnector || !toConnector) {
                return;
            }
            const fromX = fromConnector.x;
            const fromY = fromConnector.y;
            const toX = toConnector.x;
            const toY = toConnector.y;
            // Extend connection line into both connectors (4px deeper into each)
            const fromXExtended = fromX + CONNECTOR_RADIUS; // Extend into output socket
            const toXExtended = toX + 4; // Extend into input socket
            const cpOffset = getConnectionControlOffset(fromXExtended, toX);

            if (hasFiniteBounds(viewportBounds)) {
                const connectionEnvelope = getConnectionEnvelopeBounds(
                    fromX,
                    fromY,
                    toX,
                    toY,
                    fromXExtended,
                    toXExtended,
                    cpOffset
                );
                if (!rectsIntersect(connectionEnvelope, viewportBounds)) {
                    return;
                }
            }

            const isHoveredConnection =
                this.hoverConnection &&
                this.hoverConnection.fromNode === conn.fromNode &&
                this.hoverConnection.fromIndex === conn.fromIndex &&
                this.hoverConnection.toNode === conn.toNode &&
                this.hoverConnection.toIndex === conn.toIndex;

            const isHighlightedConnection =
                !isHoveredConnection &&
                (this.highlightedNodeIds.has(conn.fromNode) ||
                    this.highlightedNodeIds.has(conn.toNode));

            const tracePath = () => {
                ctx.beginPath();
                ctx.moveTo(fromXExtended, fromY);
                // Output connector: curve goes right (+), Input connector: curve goes left (-)
                ctx.bezierCurveTo(
                    fromXExtended + cpOffset,
                    fromY,
                    toX - cpOffset,
                    toY,
                    toXExtended,
                    toY
                );
            };

            if (isHoveredConnection) {
                const gradient = ctx.createLinearGradient(fromXExtended, fromY, toXExtended, toY);
                gradient.addColorStop(0, HOVER_CONNECTION_GRADIENT_START_COLOR);
                gradient.addColorStop(1, HOVER_CONNECTION_GRADIENT_END_COLOR);
                ctx.strokeStyle = gradient;
                ctx.lineWidth = interactionQuality ? 3.25 : 4;
                ctx.shadowColor = interactionQuality
                    ? TRANSPARENT_CONNECTION_SHADOW_COLOR
                    : HOVER_CONNECTION_SHADOW_COLOR;
                ctx.shadowBlur = interactionQuality ? 0 : 10;
                tracePath();
                ctx.stroke();
                return;
            }

            if (isHighlightedConnection) {
                ctx.save();
                tracePath();
                ctx.strokeStyle = RELATED_CONNECTION_GLOW_COLOR;
                ctx.lineWidth = 6;
                ctx.shadowColor = interactionQuality
                    ? TRANSPARENT_CONNECTION_SHADOW_COLOR
                    : RELATED_CONNECTION_SHADOW_COLOR;
                ctx.shadowBlur = interactionQuality ? 0 : 10;
                ctx.stroke();
                ctx.restore();
            }

            const { fromColor, toColor, requiresImplicitConversion } =
                this._resolveConnectionColors(conn);
            const gradient = ctx.createLinearGradient(fromXExtended, fromY, toXExtended, toY);
            gradient.addColorStop(0, fromColor);
            if (requiresImplicitConversion) {
                gradient.addColorStop(0.55, blendColors(fromColor, toColor, 0.6));
            }
            gradient.addColorStop(1, toColor);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 0;

            if (shouldLogConnectionColors) {
                log('ConnectionsUiRendering', 'connection-colors', 'debug', {
                    fromNode: conn.fromNode,
                    fromIndex: conn.fromIndex,
                    toNode: conn.toNode,
                    toIndex: conn.toIndex,
                    fromColor,
                    toColor,
                });
            }

            tracePath();
            ctx.stroke();
        });
        this._drawInvalidConnectionOverlay(ctx);
        ctx.restore();
    }

    /**
     * Draw the in-progress temporary connection line, if present.
     * @param {CanvasRenderingContext2D} ctx
     * @param {{start:{x:number,y:number},end:{x:number,y:number},startKind:string}} [tempConnection]
     */
    drawTempConnection(
        ctx: CanvasRenderingContext2D | null | undefined,
        tempConnection: TempConnectionPayload | null = this.tempConnection,
        qualityMode: RenderQualityMode = 'full'
    ): void {
        const activeTemp = tempConnection || this.tempConnection;
        if (!ctx || !activeTemp || !activeTemp.start || !activeTemp.end) {
            return;
        }
        const interactionQuality = qualityMode === 'interaction';
        ctx.save();
        const { start, end, startKind = 'output' } = activeTemp;
        const { startColor, endColor } = this._resolveTempConnectionGradientColors(activeTemp);

        // If dragging from input, curve goes left initially and comes in from right
        // If dragging from output, curve goes right initially and comes in from left
        const isFromInput = startKind === 'input';

        const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = interactionQuality
            ? TRANSPARENT_CONNECTION_SHADOW_COLOR
            : TEMP_CONNECTION_SHADOW_COLOR;
        ctx.shadowBlur = interactionQuality ? 0 : 12;
        // Extend temp connection into connectors (4px deeper)
        const startXExtended = isFromInput ? start.x + 4 : start.x + 4; // Always extend into start connector
        const endXExtended = end.x + 4; // Always extend into end connector when hovering
        const cpOffset = getDirectedControlOffset(startXExtended, endXExtended, startKind);
        const startCpX = isFromInput ? startXExtended - cpOffset : startXExtended + cpOffset;
        const endCpX = isFromInput ? endXExtended + cpOffset : endXExtended - cpOffset;
        ctx.beginPath();
        ctx.moveTo(startXExtended, start.y);
        ctx.bezierCurveTo(startCpX, start.y, endCpX, end.y, endXExtended, end.y);
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Render connections and any temp connection in one call.
     * @param {CanvasRenderingContext2D} ctx
     * @param {{nodeUiMap?: Map<string|number, object>|null, hoverConnector?: object|null, tempConnection?: object|null}} [options]
     */
    draw(ctx: CanvasRenderingContext2D | null | undefined, {
        nodeUiMap = null,
        hoverConnector = undefined,
        hoverConnection = undefined,
        tempConnection = undefined,
        qualityMode = 'full',
    }: DrawOptions = {}): void {
        if (hoverConnector !== undefined) {
            this.setHoverConnector(hoverConnector);
        }
        if (hoverConnection !== undefined) {
            this.setHoverConnection(hoverConnection);
        }
        if (tempConnection !== undefined) {
            this.setTempConnection(tempConnection);
        }
        this.drawConnections(ctx, { nodeUiMap, qualityMode });
        this.drawTempConnection(ctx, this.tempConnection, qualityMode);
    }

    /**
     * Dispose of listeners and release graph reference.
     */
    dispose(): void {
        this._unsubscribeGraph();
        this._clearInvalidConnectionTimer();
        this.graph = null;
    }
}

export { ConnectionsUi as ConnectionsUiV2 };
export default ConnectionsUi;
