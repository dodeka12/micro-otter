// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * GraphPanelInteraction - Mouse and keyboard interaction handling for GraphPanelView
 *
 * Extracted from GraphPanelView to isolate all interaction logic into a focused module.
 *
 * Responsibilities:
 * - Mouse event handling (down, move, up, leave)
 * - Keyboard shortcuts
 * - Drag operations (nodes, connections, panning)
 * - Hover state management
 * - Box selection (coordinates with GraphPanelSelection)
 */

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type ConnectorKind = 'input' | 'output';
type ResizeEdge = 'left' | 'right';

type NodeDataLike = {
    id?: unknown;
    x: number;
    y: number;
    width?: number;
    height?: number;
};

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

type GraphConnection = {
    fromNode: string;
    fromIndex: number;
    toNode: string;
    toIndex: number;
};

const INSERT_DROP_THRESHOLD_WORLD = 18;
const ALT_DRAG_BYPASS_THRESHOLD_PX = 4;
const CTRL_DRAG_COPY_THRESHOLD_PX = 4;

function isSameConnection(left: GraphConnection, right: GraphConnection): boolean {
    return (
        left.fromNode === right.fromNode &&
        left.fromIndex === right.fromIndex &&
        left.toNode === right.toNode &&
        left.toIndex === right.toIndex
    );
}

function isCardinalityLimitValidationMessage(message: string | undefined): boolean {
    if (typeof message !== 'string' || !message) {
        return false;
    }

    return (
        message.startsWith('Input connection limit exceeded') ||
        message.startsWith('Output connection limit exceeded')
    );
}

type GraphNodeLike = {
    x?: number;
    y?: number;
    inputs?: unknown[];
    outputs?: unknown[];
};

type ConnectorRef = {
    nodeId: string;
    index: number;
    kind?: ConnectorKind;
    type?: ConnectorKind;
    pos?: Point;
};

type DragConnectionStart = {
    nodeId: string;
    index: number;
    kind?: ConnectorKind;
    type?: ConnectorKind;
    pos: Point;
};

type TempConnection = {
    start: Point;
    end: Point;
    startKind: string;
    startNodeId?: string;
    startIndex?: number;
};

type InteractionState = {
    draggingNodeId: string | null;
    dragOffset: Point | null;
    draggingConnection: {
        start: DragConnectionStart;
        currentPos: Point;
    } | null;
    panning: {
        startScreen: Point;
        startTranslate: Point;
    } | null;
    resizingNode: {
        nodeId: string;
        edge: ResizeEdge;
        startPointerX: number;
        startX: number;
        startWidth: number;
        lastX: number;
        lastWidth: number;
    } | null;
};

type PendingCopyDrag = {
    nodeId: string;
    nodeIds: string[];
    startScreen: Point;
    dragOffset: Point;
};

type GraphLike = {
    getConnections?: () => GraphConnection[];
    getNode?: (nodeId: string) => GraphNodeLike | null;
    canConnect?: (
        fromNodeId: string,
        fromIndex: number,
        toNodeId: string,
        toIndex: number,
        options?: { excludeConnections?: GraphConnection[] }
    ) => { valid: boolean; message?: string };
    addConnection?: (connection: GraphConnection) => void;
    addConnectionFromUserAction?: (connection: GraphConnection) => void;
    removeConnection?: (
        fromNode: string,
        fromIndex: number,
        toNode: string,
        toIndex: number
    ) => void;
    startNodeDrag?: (nodeId: string) => void;
    endNodeDrag?: (nodeId: string) => void;
    updateNode?: (
        nodeId: string,
        patch: Record<string, unknown>,
        previous?: Record<string, unknown>
    ) => void;
};

type NodeUiLike = {
    handleClick?: (
        posWorld: Point,
        canvas: HTMLCanvasElement,
        viewport: { pan: Point; zoom: number }
    ) => boolean;
    hitTestNode?: (posWorld: Point) => boolean;
    hitTestControl?: (posWorld: Point) => {
        controlId?: string;
        isInputDefault?: boolean;
    } | null;
    getNodeData?: () => NodeDataLike | null;
    setPosition: (x: number, y: number) => void;
};

type SelectionLike = {
    selectedNodes: Set<string>;
    selectionBox: { start: Point; end: Point } | null;
    _isBoxSelecting: boolean;
    startBoxSelection: (worldPos: Point) => void;
    updateBoxSelection: (worldPos: Point) => void;
    finishBoxSelection: (nodeUiMap: Map<string, NodeUiLike>) => string[];
    clearSelection: () => void;
    addToSelection: (nodeId: string) => void;
    getSelectedNodeIds: () => string[];
};

type ViewportLike = {
    viewport: {
        scale: number;
        translateX: number;
        translateY: number;
    };
    screenToWorld: (point: Point) => Point;
    setViewport: (
        next: { scale?: number; translateX?: number; translateY?: number },
        canvasClientSize: Size
    ) => void;
};

type ConnectionsUiLike = {
    hoverConnector: ConnectorRef | null;
    setHoverConnector: (connector: ConnectorRef | null) => void;
    setHoverConnection?: (connection: GraphConnection | null) => void;
    setTempConnection: (connection: TempConnection | null) => void;
    showInvalidConnection?: (options: { start: Point; end: Point; message?: string }) => void;
};

type ClipboardManagerLike = {
    hasData: () => boolean;
};

type LoggerLike = unknown;

type HandleResult = { handled: boolean };


/** Documentation-area hit as reported by the panel's hit test. */
type DocumentationAreaHitLike = { areaId: string; zone: 'header' | 'resize' | 'body' };

type MouseDownContext = {
    attachDocumentDragListeners?: () => void;
    showContextMenu?: (type: 'node' | 'canvas' | 'documentation-area', event: MouseEvent) => void;
    hitTestDocumentationArea?: (posWorld: Point) => DocumentationAreaHitLike | null;
    onDocumentationAreaMouseDown?: (hit: DocumentationAreaHitLike, event: MouseEvent) => void;
    onDocumentationAreaDoubleClick?: (hit: DocumentationAreaHitLike, event: MouseEvent) => void;
    onDocumentationAreaActivate?: (areaId: string) => void;
    selectSingleNode?: (nodeId: string) => void;
    toggleSelection?: (nodeId: string) => void;
    addToSelection?: (nodeId: string) => void;
    setSelectedNodeId?: (nodeId: string | null) => void;
    setActiveNode?: (nodeId: string) => void;
    beginHistoryGroup?: (description: string) => void;
    endHistoryGroup?: () => void;
    canvas?: HTMLCanvasElement | null;
};

type MouseMoveContext = {
    updateClipboard?: (event: MouseEvent) => void;
    onDocumentationAreaPointerMove?: (posWorld: Point) => boolean;
    canvasSize?: Size;
    canvasClientSize?: Size;
    gridEnabled?: boolean;
    beginHistoryGroup?: (description: string) => void;
    endHistoryGroup?: () => void;
    duplicateNodesForDrag?: (
        nodeIds: string[]
    ) => { originalNodeIds: string[]; newNodeIds: string[] } | null;
    setSelectionNodeIds?: (nodeIds: string[], description?: string) => void;
};

type NodesMovedPayload = {
    nodeIds: string[];
};

type MouseUpContext = {
    onDocumentationAreaPointerUp?: () => boolean;
    updateSelection?: () => void;
    log?: (event: string, data: { count?: number; [key: string]: unknown }) => void;
    detachDocumentDragListeners?: () => void;
    emit?: (event: 'nodes-moved', data: NodesMovedPayload) => void;
    setSelectionNodeIds?: (nodeIds: string[], description?: string) => void;
    clearSelection?: () => void;
    toggleSelection?: (nodeId: string) => void;
    beginHistoryGroup?: (description: string) => void;
    endHistoryGroup?: () => void;
};

type KeyDownContext = {
    onDocumentationAreaKeyDown?: (event: KeyboardEvent) => boolean;
    hasActiveDocumentationArea?: () => boolean;
    showNodeInfo?: (nodeId: string) => void;
    selectedNodeId?: string | null;
    selectAll?: () => void;
    copySelected?: () => void;
    cutSelected?: () => void;
    getLastPointerWorldPosition?: () => Point | null;
    pasteAt?: (pos: Point) => void;
    pasteAtCenter?: () => void;
    duplicateSelected?: () => void;
    deleteSelected?: () => void;
    resizeSelectedNodeWidth?: (delta: number) => void;
    beginHistoryGroup?: (description: string) => void;
    endHistoryGroup?: () => void;
};

type GraphPanelInteractionOptions = {
    viewport: ViewportLike;
    constants: Record<string, unknown>;
    selection: SelectionLike;
    hitTestNode: (posWorld: Point) => NodeDataLike | null;
    hitTestResizeHandle?: (posWorld: Point) => { nodeId: string; edge: ResizeEdge } | null;
    hitTestConnector: (posWorld: Point, posScreen?: Point) => ConnectorRef | null;
    hitTestConnection?: (posWorld: Point, threshold?: number) => GraphConnection | null;
    onInvalidate: () => void;
    getCanvasPosScreenFromEvent: (event: MouseEvent) => Point;
    setCursor: (cursor: string) => void;
    clampToGrid: (x: number, y: number, width: number, height: number) => Point;
    snapNodePosition?: (x: number, y: number, width: number, height: number) => Point;
    graph: GraphLike;
    nodeUiMap: Map<string, NodeUiLike>;
    getNodeHitTestOrder?: () => readonly string[];
    connectionsUi: ConnectionsUiLike;
    clipboardManager: ClipboardManagerLike;
    resizeNodeWidth?: (args: {
        nodeId: string;
        width: number;
        edge: ResizeEdge;
        x?: number;
        commit?: boolean;
    }) => boolean;
    setInteractionQualityMode?: (active: boolean) => void;
    logger?: LoggerLike;
};

export class GraphPanelInteraction {
    viewport: ViewportLike;
    constants: Record<string, unknown>;
    selection: SelectionLike;
    hitTestNode: (posWorld: Point) => NodeDataLike | null;
    hitTestResizeHandle: (posWorld: Point) => { nodeId: string; edge: ResizeEdge } | null;
    hitTestConnector: (posWorld: Point, posScreen?: Point) => ConnectorRef | null;
    hitTestConnection: (posWorld: Point, threshold?: number) => GraphConnection | null;
    onInvalidate: () => void;
    getCanvasPosScreenFromEvent: (event: MouseEvent) => Point;
    setCursor: (cursor: string) => void;
    clampToGrid: (x: number, y: number, width: number, height: number) => Point;
    snapNodePosition: ((x: number, y: number, width: number, height: number) => Point) | null;
    graph: GraphLike;
    nodeUiMap: Map<string, NodeUiLike>;
    getNodeHitTestOrder: (() => readonly string[]) | null;
    connectionsUi: ConnectionsUiLike;
    clipboardManager: ClipboardManagerLike;
    resizeNodeWidth: (args: {
        nodeId: string;
        width: number;
        edge: ResizeEdge;
        x?: number;
        commit?: boolean;
    }) => boolean;
    setInteractionQualityMode: (active: boolean) => void;
    _logger: LoggerLike;

    interaction: InteractionState;
    lastClick: Point | null;
    _lastPointerEvent: MouseEvent | null;
    /**
     * World-space position of the most recent pointer event, recorded from the same
     * screen-to-world transform that positions the dragged nodes. Insert-on-drop probes this
     * point so the hit test follows the pointer instead of the dragged node's centre.
     */
    _lastPointerWorld: Point | null;
    _mouseMovedSinceDown: boolean;
    _pendingCanvasClear: boolean;
    _dragStartPositions: Map<string, Point> | null;
    _pendingAltBypass: { nodeId: string; startScreen: Point } | null;
    _pendingCopyDrag: PendingCopyDrag | null;

    _hitTestNodeControl(posWorld: Point): {
        nodeId: string;
        nodeUi: NodeUiLike;
        controlHit: { controlId?: string; isInputDefault?: boolean };
    } | null {
        const orderedNodeIds = this.getNodeHitTestOrder
            ? this.getNodeHitTestOrder()
            : Array.from(this.nodeUiMap.keys()).reverse();
        for (const nodeId of orderedNodeIds) {
            const nodeUi = this.nodeUiMap.get(nodeId);
            if (!nodeUi) {
                continue;
            }

            const controlHit = nodeUi.hitTestControl?.(posWorld) ?? null;
            if (controlHit) {
                return { nodeId, nodeUi, controlHit };
            }

            // A node body or header painted in front of this one visually covers the
            // controls of every node below it.
            if (nodeUi.hitTestNode?.(posWorld)) {
                return null;
            }
        }
        return null;
    }

    _getOutputConnectorPositions(nodeUi: NodeUiLike): Point[] {
        const maybeNodeUi = nodeUi as unknown;
        if (!maybeNodeUi || typeof maybeNodeUi !== 'object') {
            return [];
        }

        const record = maybeNodeUi as Record<string, unknown>;
        const connectorPositions = record._connectorPositions;
        if (typeof connectorPositions !== 'function') {
            return [];
        }

        const result = connectorPositions.call(maybeNodeUi, 'output') as unknown;
        return Array.isArray(result) ? (result as Point[]) : [];
    }

    _hasConnection(connection: GraphConnection): boolean {
        const connections = this.graph.getConnections?.() || [];
        return connections.some((candidate) => isSameConnection(candidate, connection));
    }

    /**
     * @param {object} options
     * @param {GraphPanelViewport} options.viewport - Viewport module for coordinate transforms
     * @param {object} options.constants - Layout constants (CONNECTOR_RADIUS, GRID_SPACING, etc.)
     * @param {GraphPanelSelection} options.selection - Selection module
     * @param {Function} options.hitTestNode - Callback: (posWorld) => node|null
     * @param {Function} options.hitTestConnector - Callback: (posWorld) => connector|null
     * @param {Function} options.onInvalidate - Callback: () => void (trigger render)
     * @param {Function} options.getCanvasPosScreenFromEvent - Callback: (event) => {x, y}
     * @param {Function} options.setCursor - Callback: (cursor) => void
     * @param {Function} options.clampToGrid - Callback: (x, y, width, height) => {x, y}
     * @param {object} options.graph - NodeGraph instance
     * @param {Map} options.nodeUiMap - Map of node ID to NodeUi instances
     * @param {Function} options.getNodeHitTestOrder - Callback returning node IDs front-to-back
     * @param {ConnectionsUi} options.connectionsUi - Connection rendering manager
     * @param {object} options.clipboardManager - Clipboard operations
     * @param {Function} options.logger - Logging function
     */
    constructor({
        viewport,
        constants,
        selection,
        hitTestNode,
        hitTestResizeHandle,
        hitTestConnector,
        hitTestConnection,
        onInvalidate,
        getCanvasPosScreenFromEvent,
        setCursor,
        clampToGrid,
        snapNodePosition,
        graph,
        nodeUiMap,
        getNodeHitTestOrder,
        connectionsUi,
        clipboardManager,
        resizeNodeWidth,
        setInteractionQualityMode,
        logger = console,
    }: GraphPanelInteractionOptions) {
        this.viewport = viewport;
        this.constants = constants;
        this.selection = selection;
        this.hitTestNode = hitTestNode;
        this.hitTestResizeHandle =
            typeof hitTestResizeHandle === 'function' ? hitTestResizeHandle : () => null;
        this.hitTestConnector = hitTestConnector;
        this.hitTestConnection =
            typeof hitTestConnection === 'function' ? hitTestConnection : () => null;
        this.onInvalidate = onInvalidate;
        this.getCanvasPosScreenFromEvent = getCanvasPosScreenFromEvent;
        this.setCursor = setCursor;
        this.clampToGrid = clampToGrid;
        this.snapNodePosition =
            typeof snapNodePosition === 'function' ? snapNodePosition : null;
        this.graph = graph;
        this.nodeUiMap = nodeUiMap;
        this.getNodeHitTestOrder =
            typeof getNodeHitTestOrder === 'function' ? getNodeHitTestOrder : null;
        this.connectionsUi = connectionsUi;
        this.clipboardManager = clipboardManager;
        this.resizeNodeWidth =
            typeof resizeNodeWidth === 'function' ? resizeNodeWidth : () => false;
        this.setInteractionQualityMode =
            typeof setInteractionQualityMode === 'function' ? setInteractionQualityMode : () => {};
        this._logger = logger;

        // Interaction state
        this.interaction = {
            draggingNodeId: null,
            dragOffset: null,
            draggingConnection: null,
            panning: null,
            resizingNode: null,
        };

        // Tracking state
        this.lastClick = null;
        this._lastPointerEvent = null;
        this._lastPointerWorld = null;
        this._mouseMovedSinceDown = false;
        this._pendingCanvasClear = false;
        this._dragStartPositions = null; // For multi-node drag
        this._pendingAltBypass = null;
        this._pendingCopyDrag = null;
    }

    _syncInteractionQualityMode(): void {
        const hasActiveInteraction =
            this.interaction.panning !== null ||
            this.interaction.draggingConnection !== null ||
            this.interaction.draggingNodeId !== null ||
            this.interaction.resizingNode !== null;
        this.setInteractionQualityMode(hasActiveInteraction);
    }

    cancelInteractions({
        detachDocumentDragListeners,
    }: { detachDocumentDragListeners?: () => void } = {}): void {
        const hadInteraction = this.isInteracting();

        if (this.interaction.draggingNodeId !== null) {
            this.graph.endNodeDrag?.(this.interaction.draggingNodeId);
        }

        this.interaction.draggingNodeId = null;
        this.interaction.dragOffset = null;
        this.interaction.draggingConnection = null;
        this.interaction.panning = null;
        this.interaction.resizingNode = null;

        if (this.selection._isBoxSelecting) {
            this.selection.selectionBox = null;
            this.selection._isBoxSelecting = false;
        }

        this._dragStartPositions = null;
        this._pendingCanvasClear = false;
        this._mouseMovedSinceDown = false;
        this._pendingAltBypass = null;
        this._pendingCopyDrag = null;

        this.connectionsUi.setTempConnection(null);
        this.connectionsUi.setHoverConnector(null);
        this.connectionsUi.setHoverConnection?.(null);
        this.setCursor('grab');

        if (detachDocumentDragListeners) {
            detachDocumentDragListeners();
        }

        this._syncInteractionQualityMode();

        if (hadInteraction) {
            this.onInvalidate();
        }
    }

    _isNodeUnconnected(nodeId: string): boolean {
        const connections = this.graph.getConnections?.() || [];
        return !connections.some((conn) => conn.fromNode === nodeId || conn.toNode === nodeId);
    }

    /**
     * A node can be spliced into an existing connection only when it currently has no
     * connections of its own, so inserting it cannot leave duplicate edges behind.
     * @param {string} nodeId - Node ID of the dragged node.
     * @returns {boolean}
     */
    _canInsertIntoConnection(nodeId: string): boolean {
        return this._isNodeUnconnected(nodeId);
    }

    _findCompatibleInsertion(
        sourceNodeId: string,
        sourceOutputIndex: number,
        insertedNodeId: string,
        targetNodeId: string,
        targetInputIndex: number,
        excludeConnections: GraphConnection[] = []
    ): { inputIndex: number; outputIndex: number } | null {
        const insertedNode = this.graph.getNode?.(insertedNodeId);
        const insertedInputCount = Array.isArray(insertedNode?.inputs)
            ? insertedNode.inputs.length
            : 0;
        const insertedOutputCount = Array.isArray(insertedNode?.outputs)
            ? insertedNode.outputs.length
            : 0;

        if (insertedInputCount <= 0 || insertedOutputCount <= 0) {
            return null;
        }

        for (let inputIndex = 0; inputIndex < insertedInputCount; inputIndex += 1) {
            const firstLegValidation = this.graph.canConnect?.(
                sourceNodeId,
                sourceOutputIndex,
                insertedNodeId,
                inputIndex,
                { excludeConnections }
            );

            if (firstLegValidation && !firstLegValidation.valid) {
                continue;
            }

            for (let outputIndex = 0; outputIndex < insertedOutputCount; outputIndex += 1) {
                const secondLegValidation = this.graph.canConnect?.(
                    insertedNodeId,
                    outputIndex,
                    targetNodeId,
                    targetInputIndex,
                    { excludeConnections }
                );

                if (secondLegValidation && !secondLegValidation.valid) {
                    continue;
                }

                return { inputIndex, outputIndex };
            }
        }

        return null;
    }

    /**
     * Resolve the connection under the insert-on-drop probe, if the dragged node could be spliced
     * into it.
     *
     * The probe point is the pointer's world position: an explicit `pointerWorld` override when
     * supplied, otherwise the last recorded pointer world position. A node grabbed by its edge can
     * therefore preview an insertion whenever the cursor itself is over the connection. Without any
     * known pointer position nothing is probed.
     * @param {string} draggedNodeId - Node ID of the dragged node.
     * @param {Point | null} pointerWorld - Probe point override; defaults to the recorded pointer.
     * @returns {GraphConnection | null} The connection the node would be inserted into.
     */
    _getInsertableConnectionPreview(
        draggedNodeId: string,
        pointerWorld: Point | null = null
    ): GraphConnection | null {
        if (!this.graph || !this.hitTestConnection || !this._canInsertIntoConnection(draggedNodeId)) {
            return null;
        }

        const hitPoint = pointerWorld ?? this._lastPointerWorld;
        if (!hitPoint) {
            return null;
        }

        const hitConnection = this.hitTestConnection(hitPoint, INSERT_DROP_THRESHOLD_WORLD);
        if (!hitConnection) {
            return null;
        }

        const insertion = this._findCompatibleInsertion(
            hitConnection.fromNode,
            hitConnection.fromIndex,
            draggedNodeId,
            hitConnection.toNode,
            hitConnection.toIndex,
            [hitConnection]
        );

        return insertion ? hitConnection : null;
    }

    /**
     * Splice the dragged node into the connection under the insert-on-drop probe.
     *
     * The probe point follows the same resolution as {@link _getInsertableConnectionPreview}: an
     * explicit `pointerWorld` override when supplied, otherwise the last recorded pointer world
     * position. The original connection is replaced with `source → inserted → target` only after the
     * compatibility gates pass.
     * @param {string} draggedNodeId - Node ID of the dragged node.
     * @param {Point | null} pointerWorld - Probe point override; defaults to the recorded pointer.
     * @returns {boolean} Whether the node was spliced into the connection.
     */
    _tryInsertNodeIntoConnection(
        draggedNodeId: string,
        pointerWorld: Point | null = null
    ): boolean {
        if (!this.graph || !this.hitTestConnection || !this._canInsertIntoConnection(draggedNodeId)) {
            return false;
        }

        const hitPoint = pointerWorld ?? this._lastPointerWorld;
        if (!hitPoint) {
            return false;
        }

        const hitConnection = this.hitTestConnection(hitPoint, INSERT_DROP_THRESHOLD_WORLD);
        if (!hitConnection) {
            return false;
        }

        const insertion = this._findCompatibleInsertion(
            hitConnection.fromNode,
            hitConnection.fromIndex,
            draggedNodeId,
            hitConnection.toNode,
            hitConnection.toIndex,
            [hitConnection]
        );

        if (!insertion) {
            return false;
        }

        const hadOriginalConnection = this._hasConnection(hitConnection);
        if (!hadOriginalConnection) {
            return false;
        }

        this.graph.removeConnection?.(
            hitConnection.fromNode,
            hitConnection.fromIndex,
            hitConnection.toNode,
            hitConnection.toIndex
        );

        if (this._hasConnection(hitConnection)) {
            return false;
        }

        const firstLeg: GraphConnection = {
            fromNode: hitConnection.fromNode,
            fromIndex: hitConnection.fromIndex,
            toNode: draggedNodeId,
            toIndex: insertion.inputIndex,
        };
        const secondLeg: GraphConnection = {
            fromNode: draggedNodeId,
            fromIndex: insertion.outputIndex,
            toNode: hitConnection.toNode,
            toIndex: hitConnection.toIndex,
        };

        try {
            this.graph.addConnection?.(firstLeg);
            this.graph.addConnection?.(secondLeg);
            return true;
        } catch {
            // Roll back the partial reconnection before reporting failure.
            this.graph.removeConnection?.(
                firstLeg.fromNode,
                firstLeg.fromIndex,
                firstLeg.toNode,
                firstLeg.toIndex
            );

            try {
                this.graph.addConnection?.(hitConnection);
            } catch {
                // ignore restoration errors
            }
            return false;
        }
    }

    _getIncomingConnections(nodeId: string): GraphConnection[] {
        const connections = this.graph.getConnections?.() || [];
        return connections
            .filter((connection) => connection.toNode === nodeId)
            .sort((left, right) => left.toIndex - right.toIndex);
    }

    _getOutgoingConnections(nodeId: string): GraphConnection[] {
        const connections = this.graph.getConnections?.() || [];
        return connections
            .filter((connection) => connection.fromNode === nodeId)
            .sort((left, right) => left.fromIndex - right.fromIndex);
    }

    _canBypassNode(nodeId: string): boolean {
        return (
            this._getIncomingConnections(nodeId).length > 0 &&
            this._getOutgoingConnections(nodeId).length > 0
        );
    }

    /**
     * Bypass a pass-through node: wire every upstream source directly to the node's
     * downstream targets and drop the incident edges.
     * @param {string} nodeId - Node to take out of its connections.
     * @returns {boolean} True when at least one bypass edge was created.
     */
    _tryBypassNode(nodeId: string): boolean {
        const incoming = this._getIncomingConnections(nodeId);
        const outgoing = this._getOutgoingConnections(nodeId);
        if (incoming.length === 0 || outgoing.length === 0) {
            return false;
        }

        const incidentEdges = [...incoming, ...outgoing];

        // Choose a bypass edge for every outgoing connection, preferring the lowest
        // compatible incoming edge. Validate as if all incident edges were already gone so
        // an occupied target input does not reject the replacement edge.
        const bypassEdges: GraphConnection[] = [];
        for (const out of outgoing) {
            const source = incoming.find((inc) => {
                const validation = this.graph.canConnect?.(
                    inc.fromNode,
                    inc.fromIndex,
                    out.toNode,
                    out.toIndex,
                    { excludeConnections: incidentEdges }
                );
                return !validation || validation.valid;
            });
            if (source) {
                bypassEdges.push({
                    fromNode: source.fromNode,
                    fromIndex: source.fromIndex,
                    toNode: out.toNode,
                    toIndex: out.toIndex,
                });
            }
        }

        if (bypassEdges.length === 0) {
            return false;
        }

        const removedConnections: GraphConnection[] = [];
        const removeConnection = (connection: GraphConnection | null) => {
            if (!connection) {
                return;
            }
            if (!this._hasConnection(connection)) {
                return;
            }

            this.graph.removeConnection?.(
                connection.fromNode,
                connection.fromIndex,
                connection.toNode,
                connection.toIndex
            );

            if (!this._hasConnection(connection)) {
                removedConnections.push(connection);
            }
        };

        // Remove any foreign edge occupying a target input we are about to feed.
        const bypassTargetKeys = new Set(
            bypassEdges.map((edge) => `${edge.toNode}|${edge.toIndex}`)
        );
        const occupyingTargetEdges = (this.graph.getConnections?.() || []).filter(
            (connection) =>
                bypassTargetKeys.has(`${connection.toNode}|${connection.toIndex}`) &&
                !incidentEdges.some((edge) => isSameConnection(edge, connection))
        );

        for (const edge of occupyingTargetEdges) {
            removeConnection(edge);
        }
        for (const edge of incidentEdges) {
            removeConnection(edge);
        }

        try {
            for (const bypassEdge of bypassEdges) {
                this.graph.addConnection?.(bypassEdge);
            }
            return true;
        } catch {
            // Roll back inserted bypass edges before reporting failure.
            for (const bypassEdge of bypassEdges) {
                this.graph.removeConnection?.(
                    bypassEdge.fromNode,
                    bypassEdge.fromIndex,
                    bypassEdge.toNode,
                    bypassEdge.toIndex
                );
            }

            for (const connection of removedConnections) {
                try {
                    this.graph.addConnection?.(connection);
                } catch {
                    // ignore best-effort restoration errors
                }
            }
            return false;
        }
    }

    /**
     * Node IDs that a Ctrl+drag starting on `nodeId` should copy: the whole selection when
     * the pressed node is part of it, otherwise just the pressed node.
     * @param {string} nodeId - Node under the pointer when the drag started.
     * @returns {string[]} Node IDs to copy.
     */
    _getDragCopyNodeIds(nodeId: string): string[] {
        if (!this.selection.selectedNodes.has(nodeId)) {
            return [nodeId];
        }

        const selectedNodeIds = Array.from(this.selection.selectedNodes);
        return selectedNodeIds.length > 0 ? selectedNodeIds : [nodeId];
    }

    /**
     * Put the interaction into a node-drag state for the given node IDs, recording their
     * initial positions so multi-node and copy drags keep their relative layout.
     * @param {string[]} nodeIds - Nodes that follow the pointer.
     * @param {string} primaryNodeId - Node used for positioning/snapping.
     * @param {Point} dragOffset - Pointer offset inside the primary node.
     * @returns {boolean} True when at least one node could be dragged.
     */
    _beginNodeDrag(nodeIds: string[], primaryNodeId: string, dragOffset: Point): boolean {
        const startPositions = new Map<string, Point>();
        for (const nodeId of nodeIds) {
            const node = this.graph.getNode?.(nodeId) as NodeDataLike | null;
            if (node) {
                startPositions.set(nodeId, { x: node.x, y: node.y });
            }
        }

        if (startPositions.size === 0) {
            return false;
        }

        this._dragStartPositions = startPositions;
        for (const dragNodeId of startPositions.keys()) {
            this.graph.startNodeDrag?.(dragNodeId);
        }

        this.interaction.draggingNodeId = primaryNodeId;
        this.interaction.dragOffset = dragOffset;
        this._syncInteractionQualityMode();
        this.onInvalidate();
        return true;
    }

    /**
     * Duplicate the pending Ctrl+drag nodes and drag the copies, leaving the originals in
     * place. Falls back to dragging the original node when the copy cannot be created.
     * @param {PendingCopyDrag} pending - Copy request captured on mouse down.
     * @param {Point} posWorld - Current pointer position in world coordinates.
     * @param {MouseMoveContext} context - Interaction context.
     */
    _startCopyDrag(pending: PendingCopyDrag, posWorld: Point, context: MouseMoveContext): void {
        const duplicated = context.duplicateNodesForDrag?.(pending.nodeIds) || null;
        const copiedNodeIds = (duplicated?.newNodeIds || []).filter(
            (nodeId) => normalizeNodeId(nodeId) !== null
        );

        if (copiedNodeIds.length === 0) {
            this._beginNodeDrag([pending.nodeId], pending.nodeId, pending.dragOffset);
            return;
        }

        const pressedIndex = (duplicated?.originalNodeIds || []).indexOf(pending.nodeId);
        const primaryNodeId =
            copiedNodeIds[pressedIndex >= 0 ? pressedIndex : 0] || copiedNodeIds[0];

        context.setSelectionNodeIds?.(copiedNodeIds, 'Select copied nodes');
        this._beginNodeDrag(copiedNodeIds, primaryNodeId, pending.dragOffset);
    }

    /**
     * Check if any interaction is currently in progress.
     * @returns {boolean}
     */
    isInteracting(): boolean {
        return !!(
            this.interaction.draggingNodeId ||
            this.interaction.draggingConnection ||
            this.interaction.panning ||
            this.interaction.resizingNode ||
            this.selection._isBoxSelecting
        );
    }

    /**
     * Calculate distance between two points.
     * @param {{x:number,y:number}} p1
     * @param {{x:number,y:number}} p2
     * @returns {number}
     */
    distanceBetween(p1: Point, p2: Point): number {
        return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    /**
     * Check if two connector objects are equal.
     * @private
     */
    _areConnectorsEqual(a: ConnectorRef | null, b: ConnectorRef | null): boolean {
        if (a === b) return true;
        if (!a || !b) return false;
        return a.nodeId === b.nodeId && a.type === b.type && a.index === b.index;
    }

    /**
     * Update hover state based on current pointer position.
     * @param {{x:number,y:number}} posWorld - Pointer position in world space
     * @param {boolean} [isPrimaryDown=false] - Whether primary button is pressed
     */
    updateHover(posWorld: Point, isPrimaryDown = false): void {
        const _ignorePrimaryDown = isPrimaryDown;
        void _ignorePrimaryDown;

        const hoverConnector = this.hitTestConnector(posWorld);
        const previousHover = this.connectionsUi.hoverConnector;

        const hoverChanged = !this._areConnectorsEqual(previousHover, hoverConnector);

        if (hoverChanged) {
            this.connectionsUi.setHoverConnector(hoverConnector);
            this.onInvalidate();
        }
    }

    /**
     * Finalize a connection drag, creating a connection when valid.
     * Handles existing connections by moving them to next free input or removing them.
     */
    endDragConnection(): void {
        const dragging = this.interaction.draggingConnection;
        if (!dragging || !this.graph) return;

        const start = dragging.start;
        const target = this.connectionsUi.hoverConnector;

        if (target && target.kind !== start.kind && target.nodeId !== start.nodeId) {
            const newConnection: GraphConnection =
                start.kind === 'output'
                    ? {
                          fromNode: start.nodeId,
                          fromIndex: start.index,
                          toNode: target.nodeId,
                          toIndex: target.index,
                      }
                    : {
                          fromNode: target.nodeId,
                          fromIndex: target.index,
                          toNode: start.nodeId,
                          toIndex: start.index,
                      };

            const preValidation = this.graph.canConnect?.(
                newConnection.fromNode,
                newConnection.fromIndex,
                newConnection.toNode,
                newConnection.toIndex
            );

            const isCardinalityLimitViolation =
                preValidation &&
                !preValidation.valid &&
                isCardinalityLimitValidationMessage(preValidation.message);

            if (preValidation && !preValidation.valid && !isCardinalityLimitViolation) {
                this.connectionsUi.showInvalidConnection?.({
                    start: start.pos,
                    end: target.pos || dragging.currentPos,
                    message: preValidation.message,
                });

                this.interaction.draggingConnection = null;
                this.connectionsUi.setTempConnection(null);
                this.connectionsUi.setHoverConnector(null);
                this._syncInteractionQualityMode();
                this.onInvalidate();
                return;
            }

            // Add the new connection
            try {
                if (this.graph.addConnectionFromUserAction) {
                    this.graph.addConnectionFromUserAction(newConnection);
                } else {
                    this.graph.addConnection?.(newConnection);
                }
            } catch (error) {
                const errorMessage =
                    error instanceof Error && error.message ? error.message : 'Invalid connection';
                this.connectionsUi.showInvalidConnection?.({
                    start: start.pos,
                    end: target.pos || dragging.currentPos,
                    message: errorMessage,
                });
            }
        }

        this.interaction.draggingConnection = null;
        this.connectionsUi.setTempConnection(null);
        this.connectionsUi.setHoverConnector(null);
        this._syncInteractionQualityMode();
        this.onInvalidate();
    }

    /**
     * Handle mouse down event.
     * @param {MouseEvent} event
     * @param {object} context - Additional context (nodeUiMap, canvas, etc.)
     */
    handleMouseDown(event: MouseEvent, context: MouseDownContext = {}): HandleResult | void {
        event.preventDefault();
        if (!this.graph) return;

        const posScreen = this.getCanvasPosScreenFromEvent(event);
        const posWorld = this.viewport.screenToWorld(posScreen);
        const isAltPan = event.altKey || event.button === 1;

        this.lastClick = { x: event.clientX, y: event.clientY };
        this._lastPointerEvent = event;
        this._lastPointerWorld = { x: posWorld.x, y: posWorld.y };
        this._mouseMovedSinceDown = false;
        this._pendingCanvasClear = false;

        const controlTarget = this._hitTestNodeControl(posWorld);
        if (controlTarget && event.button === 0 && context.canvas) {
            const { nodeId, nodeUi, controlHit } = controlTarget;
            context.setActiveNode?.(nodeId);
            if (!this.selection.selectedNodes.has(nodeId)) {
                context.selectSingleNode?.(nodeId);
            }

            const viewportForNodeUi = {
                pan: {
                    x: this.viewport.viewport.translateX,
                    y: this.viewport.viewport.translateY,
                },
                zoom: this.viewport.viewport.scale,
            };

            const handled = nodeUi.handleClick?.(posWorld, context.canvas, viewportForNodeUi);
            void controlHit;

            if (handled) {
                this.onInvalidate();
                return { handled: true };
            }
        }

        const nodeHit = this.hitTestNode(posWorld);

        // Check for connector hit
        const connectorHit = this.hitTestConnector(posWorld, posScreen);
        if (connectorHit && event.button === 0) {
            let actualStart: DragConnectionStart = {
                nodeId: connectorHit.nodeId,
                index: connectorHit.index,
                kind: connectorHit.kind,
                type: connectorHit.type,
                pos: connectorHit.pos || posWorld,
            };

            // If clicking input with existing connection, drag from output instead
            if (connectorHit.kind === 'input') {
                const existing = (this.graph.getConnections?.() || []).find(
                    (conn) =>
                        conn.toNode === connectorHit.nodeId && conn.toIndex === connectorHit.index
                );
                if (existing) {
                    this.graph.removeConnection!(
                        existing.fromNode,
                        existing.fromIndex,
                        existing.toNode,
                        existing.toIndex
                    );

                    const sourceNode = this.nodeUiMap.get(existing.fromNode);
                    if (sourceNode) {
                        const outputPositions = this._getOutputConnectorPositions(sourceNode);
                        const outputPos = outputPositions?.[existing.fromIndex];
                        if (outputPos) {
                            actualStart = {
                                nodeId: existing.fromNode,
                                index: existing.fromIndex,
                                kind: 'output',
                                pos: { x: outputPos.x, y: outputPos.y },
                            };
                        }
                    }
                }
            }

            this.interaction.draggingConnection = {
                start: actualStart,
                currentPos: posWorld,
            };
            const tempConnection = {
                start: actualStart.pos,
                end: posWorld,
                startKind: actualStart.kind || actualStart.type || 'output',
                startNodeId: actualStart.nodeId,
                startIndex: actualStart.index,
            };
            this.connectionsUi.setTempConnection(tempConnection);
            this.connectionsUi.setHoverConnector(null);

            if (context.attachDocumentDragListeners) {
                context.attachDocumentDragListeners();
            }
            this._syncInteractionQualityMode();
            this.onInvalidate();
            return { handled: true };
        }

        const resizeHandleHit = this.hitTestResizeHandle(posWorld);
        if (resizeHandleHit && event.button === 0) {
            const nodeData = this.graph.getNode?.(resizeHandleHit.nodeId) as NodeDataLike | null;
            if (nodeData) {
                this.interaction.resizingNode = {
                    nodeId: resizeHandleHit.nodeId,
                    edge: resizeHandleHit.edge,
                    startPointerX: posWorld.x,
                    startX: nodeData.x,
                    startWidth: Number.isFinite(nodeData.width) ? (nodeData.width as number) : 140,
                    lastX: nodeData.x,
                    lastWidth: Number.isFinite(nodeData.width) ? (nodeData.width as number) : 140,
                };

                this.setCursor('ew-resize');
                if (context.attachDocumentDragListeners) {
                    context.attachDocumentDragListeners();
                }
                this._syncInteractionQualityMode();
                this.onInvalidate();
                return { handled: true };
            }
        }

        const clickedEmptyCanvas =
            event.button === 0 && !nodeHit && !connectorHit && !event.shiftKey && !isAltPan;
        if (clickedEmptyCanvas) {
            this._pendingCanvasClear = true;
        }

        // Right-click context menu
        if (event.button === 2 && context.showContextMenu) {
            event.preventDefault();
            const areaHitOnRightClick =
                context.hitTestDocumentationArea?.(posWorld) ?? null;
            if (areaHitOnRightClick) {
                context.onDocumentationAreaActivate?.(areaHitOnRightClick.areaId);
                context.showContextMenu('documentation-area', event);
                return { handled: true };
            }
            if (nodeHit) {
                const hitNodeId = normalizeNodeId(nodeHit.id);
                if (hitNodeId && !this.selection.selectedNodes.has(hitNodeId)) {
                    context.selectSingleNode?.(hitNodeId);
                }
                context.showContextMenu('node', event);
            } else {
                context.showContextMenu('canvas', event);
            }
            return { handled: true };
        }

        // Handle node selection and dragging
        if (nodeHit && event.button === 0) {
            const ctrl = event.ctrlKey || event.metaKey;
            const alt = event.altKey;
            const shift = event.shiftKey;
            const nodeId = normalizeNodeId(nodeHit.id);

            if (!nodeId) {
                return { handled: false };
            }

            // Any node press makes that node the active (top-most) node.
            context.setActiveNode?.(nodeId);

            // Alt+Drag bypass: disconnect a pass-through node and wire upstream to
            // downstream. Deferred until the pointer actually moves so Alt+Click keeps
            // its toggle-selection behaviour.
            if (alt && !shift && this._canBypassNode(nodeId)) {
                this._pendingAltBypass = { nodeId, startScreen: posScreen };
            } else if (ctrl && !shift) {
                // Ctrl+Drag copies the node (or the whole selection) and drags the copy
                // while the original stays in place. Deferred until the pointer actually
                // moves so Ctrl+Click keeps its toggle-selection behaviour.
                this._pendingCopyDrag = {
                    nodeId,
                    nodeIds: this._getDragCopyNodeIds(nodeId),
                    startScreen: posScreen,
                    dragOffset: { x: posWorld.x - nodeHit.x, y: posWorld.y - nodeHit.y },
                };
                if (context.attachDocumentDragListeners) {
                    context.attachDocumentDragListeners();
                }
                return { handled: true };
            } else if (shift && !ctrl) {
                // Shift+Click: Add to selection
                context.addToSelection?.(nodeId);
            } else if (!this.selection.selectedNodes.has(nodeId)) {
                context.selectSingleNode?.(nodeId);
            }

            // Alt+Drag on a node that cannot be bypassed keeps its previous meaning:
            // pan the canvas instead of moving the node.
            if (alt && !this._pendingAltBypass) {
                return this._startPanning(posScreen, context);
            }

            // Let NodeUi handle internal clicks (controls, header)
            const nodeUi = this.nodeUiMap.get(nodeId);
            if (nodeUi && context.canvas) {
                const viewportForNodeUi = {
                    pan: {
                        x: this.viewport.viewport.translateX,
                        y: this.viewport.viewport.translateY,
                    },
                    zoom: this.viewport.viewport.scale,
                };
                const handled = nodeUi.handleClick?.(posWorld, context.canvas, viewportForNodeUi);
                if (handled) {
                    this.onInvalidate();
                    return { handled: true };
                }
            }

            // Start node drag
            if (this.selection.selectedNodes.has(nodeId)) {
                // Multi-node drag: store initial positions
                this._dragStartPositions = new Map();
                for (const id of this.selection.selectedNodes) {
                    const node = this.graph.getNode!(id);
                    if (node) {
                        this._dragStartPositions.set(id, {
                            x: node.x as number,
                            y: node.y as number,
                        });
                    }
                }
            }

            if (this._dragStartPositions && this._dragStartPositions.size > 1) {
                for (const dragNodeId of this._dragStartPositions.keys()) {
                    this.graph.startNodeDrag!(dragNodeId);
                }
            } else {
                this.graph.startNodeDrag!(nodeId);
            }
            this.interaction.draggingNodeId = nodeId;
            this.interaction.dragOffset = { x: posWorld.x - nodeHit.x, y: posWorld.y - nodeHit.y };

            if (context.attachDocumentDragListeners) {
                context.attachDocumentDragListeners();
            }
            this._syncInteractionQualityMode();
            this.onInvalidate();
            return { handled: true };
        }

        // Legacy single selection (backward compatibility)
        if (context.setSelectedNodeId) {
            context.setSelectedNodeId(nodeHit ? normalizeNodeId(nodeHit.id) : null);
        }

        // Documentation areas: header drag, corner resize or body click. Nodes, connectors and
        // node controls were already tested above, so a node inside a box still wins; Shift+drag
        // and Alt+drag keep their box-selection/panning meaning.
        if (event.button === 0 && !event.shiftKey && !isAltPan) {
            const areaHit = context.hitTestDocumentationArea?.(posWorld) ?? null;
            if (areaHit) {
                this._pendingCanvasClear = false;
                if (event.detail > 1 && areaHit.zone === 'body' && context.onDocumentationAreaDoubleClick) {
                    context.onDocumentationAreaDoubleClick(areaHit, event);
                    return { handled: true };
                }
                context.onDocumentationAreaMouseDown?.(areaHit, event);
                return { handled: true };
            }
        }

        // Start box selection (Shift+drag on empty canvas)
        if (event.button === 0 && event.shiftKey && !nodeHit && !isAltPan) {
            this.selection.startBoxSelection(posWorld);
            this._pendingCanvasClear = false;
            this.setCursor('crosshair');
            this.onInvalidate();
            return { handled: true };
        }

        // Start panning
        if (event.button === 0 || isAltPan) {
            return this._startPanning(posScreen, context);
        }

        return { handled: false };
    }

    /**
     * Start canvas panning from the given screen position.
     * @param {Point} posScreen - Pointer position in screen coordinates.
     * @param {MouseDownContext} context - Interaction context.
     * @returns {HandleResult}
     */
    _startPanning(posScreen: Point, context: MouseDownContext): HandleResult {
        this.interaction.panning = {
            startScreen: posScreen,
            startTranslate: {
                x: this.viewport.viewport.translateX,
                y: this.viewport.viewport.translateY,
            },
        };
        this.setCursor('grabbing');

        // Attach document listeners to continue panning when mouse leaves canvas
        if (context.attachDocumentDragListeners) {
            context.attachDocumentDragListeners();
        }

        this._syncInteractionQualityMode();

        return { handled: true };
    }

    /**
     * Handle mouse move event.
     * @param {MouseEvent} event
     * @param {object} context - Additional context (gridEnabled, updateClipboard, etc.)
     */
    handleMouseMove(event: MouseEvent, context: MouseMoveContext = {}): HandleResult | void {
        if (!this.graph) return;

        const posScreen = this.getCanvasPosScreenFromEvent(event);
        const posWorld = this.viewport.screenToWorld(posScreen);

        this._mouseMovedSinceDown = true;
        this._lastPointerEvent = event;
        this._lastPointerWorld = { x: posWorld.x, y: posWorld.y };

        // Deferred Alt+drag bypass: rewire once the pointer moves past the drag threshold.
        if (this._pendingAltBypass) {
            const pending = this._pendingAltBypass;
            const dx = posScreen.x - pending.startScreen.x;
            const dy = posScreen.y - pending.startScreen.y;
            if (Math.hypot(dx, dy) > ALT_DRAG_BYPASS_THRESHOLD_PX) {
                this._pendingAltBypass = null;
                context.beginHistoryGroup?.('Alt+Drag bypass node');
                try {
                    this._tryBypassNode(pending.nodeId);
                } finally {
                    context.endHistoryGroup?.();
                }
            }
        }

        // Deferred Ctrl+drag copy: duplicate the node(s) once the pointer moves past the
        // drag threshold, then drag the copies while the originals stay in place.
        if (this._pendingCopyDrag) {
            const pendingCopy = this._pendingCopyDrag;
            const dx = posScreen.x - pendingCopy.startScreen.x;
            const dy = posScreen.y - pendingCopy.startScreen.y;
            if (Math.hypot(dx, dy) > CTRL_DRAG_COPY_THRESHOLD_PX) {
                this._pendingCopyDrag = null;
                context.beginHistoryGroup?.('Ctrl+Drag copy nodes');
                try {
                    this._startCopyDrag(pendingCopy, posWorld, context);
                } finally {
                    context.endHistoryGroup?.();
                }
            }
        }

        // Update clipboard pointer tracking
        if (context.updateClipboard) {
            context.updateClipboard(event);
        }

        // Documentation-area gesture (move/resize) or hover feedback.
        if (context.onDocumentationAreaPointerMove?.(posWorld)) {
            this.onInvalidate();
            return { handled: true };
        }

        // Box selection update
        if (this.selection._isBoxSelecting && this.selection.selectionBox) {
            this.selection.updateBoxSelection(posWorld);
            this.onInvalidate();
            return { handled: true };
        }

        // Panning
        if (this.interaction.panning) {
            const start = this.interaction.panning;
            const dx = posScreen.x - start.startScreen.x;
            const dy = posScreen.y - start.startScreen.y;

            this.viewport.setViewport(
                {
                    translateX: start.startTranslate.x + dx,
                    translateY: start.startTranslate.y + dy,
                },
                context.canvasClientSize as Size
            );
            this.onInvalidate();
            return { handled: true };
        }

        // Connection dragging
        if (this.interaction.draggingConnection) {
            this.interaction.draggingConnection.currentPos = posWorld;
            const start = this.interaction.draggingConnection.start;
            const hover = this.hitTestConnector(posWorld);
            const validHover = hover && hover.kind !== start.kind && hover.nodeId !== start.nodeId;
            const nextHover = validHover ? hover : null;

            const tempConnection = {
                start: start.pos,
                end: posWorld,
                startKind: start.kind || start.type || 'output',
                startNodeId: start.nodeId,
                startIndex: start.index,
            };

            this.connectionsUi.setHoverConnection?.(null);
            this.connectionsUi.setHoverConnector(nextHover);
            this.connectionsUi.setTempConnection(tempConnection);
            this.onInvalidate();
            return { handled: true };
        }

        // Node dragging
        if (this.interaction.draggingNodeId !== null) {
            // Multi-node drag
            if (this._dragStartPositions && this._dragStartPositions.size > 0) {
                const startPos = this._dragStartPositions.get(this.interaction.draggingNodeId);
                if (startPos) {
                    const primaryNodeUi = this.nodeUiMap.get(this.interaction.draggingNodeId);
                    const primaryNodeData = primaryNodeUi?.getNodeData?.();
                    const rawX = posWorld.x - (this.interaction.dragOffset?.x || 0);
                    const rawY = posWorld.y - (this.interaction.dragOffset?.y || 0);
                    const snapped = this.snapNodePosition
                        ? this.snapNodePosition(
                              rawX,
                              rawY,
                              primaryNodeData?.width || 140,
                              primaryNodeData?.height || 90
                          )
                        : this.clampToGrid(
                              rawX,
                              rawY,
                              primaryNodeData?.width || 140,
                              primaryNodeData?.height || 90
                          );
                    const deltaX = snapped.x - startPos.x;
                    const deltaY = snapped.y - startPos.y;

                    for (const [nodeId, initialPos] of this._dragStartPositions) {
                        const nodeUi = this.nodeUiMap.get(nodeId);
                        const nodeData = nodeUi?.getNodeData?.();
                        if (nodeUi && nodeData) {
                            const clamped = this.clampToGrid(
                                initialPos.x + deltaX,
                                initialPos.y + deltaY,
                                nodeData.width || 140,
                                nodeData.height || 90
                            );
                            nodeUi.setPosition(clamped.x, clamped.y);
                        }
                    }
                }
            } else {
                // Single node drag (backward compatibility)
                const nodeUi = this.nodeUiMap.get(this.interaction.draggingNodeId);
                const nodeData = nodeUi?.getNodeData?.();
                if (nodeUi && nodeData) {
                    const nextX = posWorld.x - (this.interaction.dragOffset?.x || 0);
                    const nextY = posWorld.y - (this.interaction.dragOffset?.y || 0);
                    const resolved = this.snapNodePosition
                        ? this.snapNodePosition(
                              nextX,
                              nextY,
                              nodeData.width || 140,
                              nodeData.height || 90
                          )
                        : this.clampToGrid(
                              nextX,
                              nextY,
                              nodeData.width || 140,
                              nodeData.height || 90
                          );
                    nodeUi.setPosition(resolved.x, resolved.y);
                }
            }

            const isMultiNodeDrag = Boolean(
                this._dragStartPositions && this._dragStartPositions.size > 1
            );
            const insertPreview = isMultiNodeDrag
                ? null
                : this._getInsertableConnectionPreview(this.interaction.draggingNodeId, posWorld);
            this.connectionsUi.setHoverConnection?.(insertPreview);

            this.onInvalidate();
            return { handled: true };
        }

        if (this.interaction.resizingNode !== null) {
            const activeResize = this.interaction.resizingNode;
            const nodeData = this.graph.getNode?.(activeResize.nodeId) as NodeDataLike | null;
            if (!nodeData) {
                this.interaction.resizingNode = null;
                this._syncInteractionQualityMode();
                return { handled: true };
            }

            const deltaX = posWorld.x - activeResize.startPointerX;
            let nextX = activeResize.startX;
            let nextWidth = activeResize.startWidth;

            if (activeResize.edge === 'right') {
                nextWidth = activeResize.startWidth + deltaX;
            } else {
                nextWidth = activeResize.startWidth - deltaX;
                nextX = activeResize.startX + deltaX;
            }

            if (nextWidth < 1) {
                if (activeResize.edge === 'left') {
                    nextX = activeResize.startX + (activeResize.startWidth - 1);
                }
                nextWidth = 1;
            }

            const roundedWidth = Math.round(nextWidth);
            const roundedX = Math.round(nextX);

            activeResize.lastWidth = roundedWidth;
            activeResize.lastX = roundedX;

            const updated = this.resizeNodeWidth({
                nodeId: activeResize.nodeId,
                width: roundedWidth,
                edge: activeResize.edge,
                x: roundedX,
                commit: false,
            });

            if (!updated) {
                nodeData.x = roundedX;
                nodeData.width = roundedWidth;

                const nodeUi = this.nodeUiMap.get(activeResize.nodeId) as
                    | { invalidateConnectorPositions?: () => void }
                    | undefined;
                nodeUi?.invalidateConnectorPositions?.();
            }

            this.setCursor('ew-resize');
            this.onInvalidate();
            return { handled: true };
        }

        this.connectionsUi.setHoverConnection?.(null);

        // Update hover state
        const isPrimaryDown = (event.buttons & 1) === 1;
        this.updateHover(posWorld, isPrimaryDown);

        if (!isPrimaryDown) {
            const hoverResizeHandle = this.hitTestResizeHandle(posWorld);
            this.setCursor(hoverResizeHandle ? 'ew-resize' : 'grab');
        }

        return { handled: false };
    }

    /**
     * Handle mouse up event.
     * @param {object} context - Additional context (updateSelection, emit, etc.)
     */
    handleMouseUp(context: MouseUpContext = {}): HandleResult | void {
        if (!this.graph) return;

        // A documentation-area gesture ends before any node/pan/box logic: it owns the pointer.
        if (context.onDocumentationAreaPointerUp?.()) {
            this.setCursor('grab');
            if (context.detachDocumentDragListeners) {
                context.detachDocumentDragListeners();
            }
            this._syncInteractionQualityMode();
            return { handled: true };
        }

        // Finalize box selection
        if (this.selection._isBoxSelecting && this.selection.selectionBox) {
            const nodesInBox = this.selection.finishBoxSelection(this.nodeUiMap);
            if (nodesInBox.length > 0) {
                if (context.setSelectionNodeIds) {
                    context.setSelectionNodeIds(nodesInBox, 'Box selection');
                } else {
                    this.selection.clearSelection();
                    nodesInBox.forEach((nodeId) => this.selection.addToSelection(nodeId));
                    if (context.updateSelection) {
                        context.updateSelection();
                    }
                }
                if (context.log) {
                    context.log('box-selection-complete', { count: nodesInBox.length });
                }
            } else {
                this.selection.selectionBox = null;
                this.selection._isBoxSelecting = false;
            }
            this.setCursor('grab');
            this.connectionsUi.setHoverConnection?.(null);
            this.onInvalidate();
            return { handled: true };
        }

        const shouldClearSelection = this._pendingCanvasClear && !this._mouseMovedSinceDown;

        // Ctrl+drag fallback: no real movement means the user performed a Ctrl+Click.
        if (this._pendingCopyDrag) {
            const pendingCopy = this._pendingCopyDrag;
            this._pendingCopyDrag = null;
            if (!this._mouseMovedSinceDown) {
                context.toggleSelection?.(pendingCopy.nodeId);
            }
            if (context.detachDocumentDragListeners) {
                context.detachDocumentDragListeners();
            }
        }

        // Alt+drag fallback: no real movement means the user performed an Alt+Click.
        if (this._pendingAltBypass) {
            const pending = this._pendingAltBypass;
            this._pendingAltBypass = null;
            if (!this._mouseMovedSinceDown) {
                context.toggleSelection?.(pending.nodeId);
            }
        }

        // End panning
        if (this.interaction.panning) {
            this.interaction.panning = null;
            this.setCursor('grab');
            if (context.detachDocumentDragListeners) {
                context.detachDocumentDragListeners();
            }
            this._syncInteractionQualityMode();
        }

        // End connection drag
        if (this.interaction.draggingConnection) {
            this.endDragConnection();
            if (context.detachDocumentDragListeners) {
                context.detachDocumentDragListeners();
            }
            this.connectionsUi.setHoverConnection?.(null);
            this._pendingCanvasClear = false;
            this._mouseMovedSinceDown = false;
            return { handled: true };
        }

        // End node drag
        if (this.interaction.draggingNodeId !== null) {
            const draggedNodeId = this.interaction.draggingNodeId;
            const draggedNodeIds = this._dragStartPositions
                ? Array.from(this._dragStartPositions.keys())
                : [draggedNodeId];
            const isMultiDrag = draggedNodeIds.length > 1;

            if (isMultiDrag) {
                context.beginHistoryGroup?.('Move multiple nodes');
                try {
                    for (const nodeId of draggedNodeIds) {
                        this.graph.endNodeDrag!(nodeId);
                    }
                } finally {
                    context.endHistoryGroup?.();
                }
            } else {
                this.graph.endNodeDrag!(draggedNodeId);
            }

            const insertPointer = this._lastPointerWorld;
            const insertTarget =
                !isMultiDrag && this._mouseMovedSinceDown && insertPointer
                    ? this._getInsertableConnectionPreview(draggedNodeId, insertPointer)
                    : null;
            if (insertTarget) {
                context.beginHistoryGroup?.('Drag-insert node into connection');
                try {
                    this._tryInsertNodeIntoConnection(draggedNodeId, insertPointer);
                } finally {
                    context.endHistoryGroup?.();
                }
            }

            if (this._dragStartPositions) {
                this._dragStartPositions = null;
                if (context.emit) {
                    context.emit('nodes-moved', { nodeIds: this.selection.getSelectedNodeIds() });
                }
            }

            this.interaction.draggingNodeId = null;
            this.interaction.dragOffset = null;

            if (context.detachDocumentDragListeners) {
                context.detachDocumentDragListeners();
            }

            this.connectionsUi.setHoverConnection?.(null);
            this._syncInteractionQualityMode();
        }

        if (this.interaction.resizingNode !== null) {
            const activeResize = this.interaction.resizingNode;
            const committed = this.resizeNodeWidth({
                nodeId: activeResize.nodeId,
                width: activeResize.lastWidth,
                edge: activeResize.edge,
                x: activeResize.lastX,
                commit: true,
            });

            if (!committed) {
                if (
                    this.graph.updateNode &&
                    (!Object.is(activeResize.startX, activeResize.lastX) ||
                        !Object.is(activeResize.startWidth, activeResize.lastWidth))
                ) {
                    this.graph.updateNode(
                        activeResize.nodeId,
                        {
                            x: activeResize.lastX,
                            width: activeResize.lastWidth,
                        },
                        {
                            x: activeResize.startX,
                            width: activeResize.startWidth,
                        }
                    );
                }
            }

            this.interaction.resizingNode = null;

            if (context.detachDocumentDragListeners) {
                context.detachDocumentDragListeners();
            }

            this.setCursor('grab');
            this._syncInteractionQualityMode();
            this.onInvalidate();
            this._pendingCanvasClear = false;
            this._mouseMovedSinceDown = false;
            return { handled: true };
        }

        // Clear selection if clicked empty canvas without moving
        if (shouldClearSelection && context.clearSelection) {
            context.clearSelection();
            this.onInvalidate();
        }

        this._pendingCanvasClear = false;
        this._mouseMovedSinceDown = false;
        return { handled: false };
    }

    /**
     * Handle mouse leaving canvas.
     */
    handleMouseLeave(): void {
        // Don't clear panning/dragging when document listeners are active
        // (allows operations to continue when mouse leaves canvas)
        // Panning, node dragging, and connection dragging will be ended by mouseup

        this.connectionsUi.setHoverConnector(null);
        this.connectionsUi.setHoverConnection?.(null);
        this.onInvalidate();
    }

    /**
     * Handle keyboard shortcuts.
     * @param {KeyboardEvent} e
     * @param {object} context - Callbacks for actions
     * @returns {boolean} True if handled
     */
    handleKeyDown(e: KeyboardEvent, context: KeyDownContext = {}): boolean {
        // Skip if input is focused
        const activeElement = document.activeElement;
        const isInputFocused =
            activeElement &&
            (activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                (activeElement instanceof HTMLElement && activeElement.isContentEditable));

        if (isInputFocused) {
            return false;
        }

        const ctrl = e.ctrlKey || e.metaKey;

        // Documentation areas own Escape/Delete/F2 while they are active.
        if (context.onDocumentationAreaKeyDown?.(e)) {
            return true;
        }

        // F1: Show node info
        if (e.key === 'F1' && context.showNodeInfo) {
            const lastSelected = this.selection.selectedNodes.size
                ? this.selection.getSelectedNodeIds()[this.selection.selectedNodes.size - 1]
                : null;
            const targetNodeId = lastSelected || context.selectedNodeId;
            if (targetNodeId) {
                e.preventDefault();
                context.showNodeInfo(targetNodeId);
                return true;
            }
        }

        // Ctrl+A: Select all
        if (ctrl && e.key === 'a' && context.selectAll) {
            e.preventDefault();
            context.selectAll();
            return true;
        }

        // Ctrl+C: Copy
        const hasActiveArea = Boolean(context.hasActiveDocumentationArea?.());

        if (
            ctrl &&
            e.key === 'c' &&
            (this.selection.selectedNodes.size > 0 || hasActiveArea) &&
            context.copySelected
        ) {
            e.preventDefault();
            context.copySelected();
            return true;
        }

        // Ctrl+X: Cut
        if (
            ctrl &&
            e.key === 'x' &&
            (this.selection.selectedNodes.size > 0 || hasActiveArea) &&
            context.cutSelected
        ) {
            e.preventDefault();
            context.cutSelected();
            return true;
        }

        // Ctrl+V: Paste
        if (ctrl && e.key === 'v' && this.clipboardManager.hasData()) {
            e.preventDefault();
            if (context.pasteAt && context.getLastPointerWorldPosition) {
                const worldPos = context.getLastPointerWorldPosition();
                if (worldPos) {
                    context.pasteAt(worldPos);
                } else if (context.pasteAtCenter) {
                    context.pasteAtCenter();
                }
            }
            return true;
        }

        // Ctrl+D: Duplicate
        if (
            ctrl &&
            e.key === 'd' &&
            this.selection.selectedNodes.size > 0 &&
            context.duplicateSelected
        ) {
            e.preventDefault();
            context.duplicateSelected();
            return true;
        }

        if (!ctrl && (e.key === '[' || e.key === ']') && context.resizeSelectedNodeWidth) {
            e.preventDefault();
            context.resizeSelectedNodeWidth(e.key === ']' ? 10 : -10);
            return true;
        }

        // Delete/Backspace: Delete selected
        if (
            ctrl &&
            e.key === 'Delete' &&
            this.selection.selectedNodes.size > 0 &&
            context.deleteSelected
        ) {
            e.preventDefault();

            const selectedNodeIds = this.selection.getSelectedNodeIds();
            const groupLabel =
                selectedNodeIds.length > 1
                    ? 'Ctrl+Delete bypass multiple nodes'
                    : 'Ctrl+Delete bypass node';

            context.beginHistoryGroup?.(groupLabel);
            try {
                for (const nodeId of selectedNodeIds) {
                    this._tryBypassNode(nodeId);
                }

                context.deleteSelected();
            } finally {
                context.endHistoryGroup?.();
            }
            return true;
        }

        // Delete/Backspace: Delete selected
        if (
            (e.key === 'Delete' || e.key === 'Backspace') &&
            this.selection.selectedNodes.size > 0 &&
            context.deleteSelected
        ) {
            e.preventDefault();
            context.deleteSelected();
            return true;
        }

        return false;
    }
}
