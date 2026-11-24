// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';
import { ViewportConfig } from './viewport-config.js';
import NodeData from './node-data.js';
import DocumentationArea, {
    areaBoundsEqual,
    normalizeAreaBounds,
    normalizeAreaColor,
    normalizeAreaContentAlign,
    normalizeAreaFontSize,
} from './documentation-area.js';
import type {
    DocumentationAreaBounds,
    DocumentationAreaData,
    DocumentationAreaDragMode,
    DocumentationAreaPatch,
} from './documentation-area.js';
import {
    getPrimaryAllowedType,
    resolveActiveInputIds,
    resolveDeclaredInputSources,
    resolveHiddenControlIds,
    resolveTypeCompatibility,
} from './type-conversions.js';
import {
    DEFAULT_EXECUTION_TYPE,
    DEFAULT_GRAPH_ENABLED,
    DEFAULT_SIGNAL_MODE,
    DEFAULT_SLEEP_MS,
    DEFAULT_TRIGGER_NAME,
    DEFAULT_RUN_ON_START,
    MIN_SLEEP_MS,
    clampSleepDuration,
    normalizeExecutionType,
    normalizeGraphEnabled,
    normalizeRunOnStart,
    normalizeSignalMode,
    normalizeSignalNames,
    normalizeTriggerName,
} from './graph-execution-settings.js';
import type { ExecutionType, SignalTriggerMode } from './graph-execution-settings.js';
import {
    MAX_FUNCTION_PORTS,
    buildFunctionNodeTypeId,
    isEmptyFunctionSignature,
    normalizeFunctionCategory,
    normalizeFunctionDescription,
    normalizeFunctionIcon,
    normalizeFunctionPort,
    normalizeFunctionPorts,
    normalizeFunctionSignature,
} from './graph-function-signature.js';
import type {
    FunctionPort,
    FunctionPortDefault,
    FunctionPortIndexMapping,
    FunctionPortKind,
    FunctionSignature,
} from './graph-function-signature.js';
import {
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_OUTPUT_NODE_TYPE,
    buildFunctionStructuralConnectorPatch,
    buildFunctionStructuralNodePayload,
    resolveFunctionStructuralNodePosition,
} from './graph-function-nodes.js';

const DEFAULT_GRAPH_NAME = 'Graph';
/** Default loop interval in milliseconds (shared with the settings surfaces). */
const DEFAULT_GRAPH_INTERVAL_MS = DEFAULT_SLEEP_MS;
/** Smallest allowed loop interval; `0` means a yield-only cadence. */
const MIN_GRAPH_INTERVAL_MS = MIN_SLEEP_MS;
const DEFAULT_GRAPH_HIGHLIGHT_COLOR = '#5b7fc7';

type NodeIdentifier = string;

type ViewportTransform = {
    translateX: number;
    translateY: number;
    scale: number;
};

type NodeConnection = {
    fromNode: NodeIdentifier;
    fromIndex: number;
    toNode: NodeIdentifier;
    toIndex: number;
};

type ConnectionValidationResult = {
    valid: boolean;
    message?: string;
};

type CanConnectOptions = {
    allowExistingConnectionMatch?: boolean;
    skipCardinalityChecks?: boolean;
    excludeConnections?: readonly NodeConnection[];
};

type UserNameByLocaleDescriptor = {
    locale?: string;
    value?: unknown;
};

type NodeDataLike = NodeData & Record<string, any>;

type NodeGraphData = {
    id?: string;
    name?: string;
    executionType?: string;
    enabled?: boolean;
    triggerName?: string;
    signalNames?: unknown;
    signalMode?: unknown;
    runOnStart?: unknown;
    triggerIntervalMs?: number;
    highlightColor?: string;
    nodes?: Array<NodeData | Record<string, unknown>>;
    connections?: NodeConnection[];
    documentationAreas?: Array<DocumentationAreaData | Record<string, unknown>>;
    nodeCounter?: number;
    viewportConfig?: ViewportConfig | Record<string, unknown> | null;
    dataTypeDefinitionLookup?: DataTypeDefinitionLookup;
    functionSignature?: unknown;
};

type DataTypeConnectionPolicyDirection = {
    maxConnections?: unknown;
};

type DataTypeDefinitionLike = {
    kind?: unknown;
    connectionPolicy?: {
        input?: DataTypeConnectionPolicyDirection;
        output?: DataTypeConnectionPolicyDirection;
    } | null;
};

type DataTypeDefinitionLookup = ((typeId: string) => DataTypeDefinitionLike | null) | null;

type NodeGraphSerializedData = {
    id: string;
    name: string;
    executionType: ExecutionType;
    triggerName: string;
    signalNames: string[];
    signalMode: SignalTriggerMode;
    runOnStart: boolean;
    enabled: boolean;
    triggerIntervalMs: number;
    highlightColor: string;
    nodes: Array<Record<string, unknown>>;
    connections: NodeConnection[];
    documentationAreas: DocumentationAreaData[];
    viewportConfig: ViewportTransform;
    functionSignature?: FunctionSignature;
};

/**
 * Payload for NodeGraph viewport updates.
 */
class NodeGraphViewportChangedPayload extends AppPayload {
    graphId: string;

    viewport: ViewportTransform;

    /**
     * @param {string} graphId - ID of the graph that emitted the viewport change.
     * @param {{translateX:number, translateY:number, scale:number}} viewport - New viewport transform used to sync canvas position/zoom.
     */
    constructor(graphId: string, viewport: ViewportTransform) {
        super('NodeGraph.ViewportChanged.v1');
        this.graphId = graphId;
        this.viewport = viewport;
    }
}

/**
 * Payload for NodeGraph name updates.
 */
class NodeGraphNameChangedPayload extends AppPayload {
    graphId: string;

    name: string;

    /**
     * @param {string} graphId - ID of the graph that emitted the name change.
     * @param {string} name - Normalized graph display name for tabs/settings.
     */
    constructor(graphId: string, name: string) {
        super('NodeGraph.NameChanged.v1');
        this.graphId = graphId;
        this.name = name;
    }
}

/**
 * Payload for NodeGraph execution-type updates.
 */
class NodeGraphExecutionTypeChangedPayload extends AppPayload {
    graphId: string;

    executionType: ExecutionType;

    /**
     * @param {string} graphId - ID of the graph that emitted the execution mode change.
     * @param {string} executionType - Selected execution mode (for example startup/continuous).
     */
    constructor(graphId: string, executionType: ExecutionType) {
        super('NodeGraph.ExecutionTypeChanged.v1');
        this.graphId = graphId;
        this.executionType = executionType;
    }
}

/**
 * Payload for NodeGraph trigger-name updates.
 */
class NodeGraphTriggerNameChangedPayload extends AppPayload {
    graphId: string;

    triggerName: string;

    /**
     * @param {string} graphId - ID of the graph that emitted the trigger-name change.
     * @param {string} triggerName - Normalized interrupt channel name; `''` means unset.
     */
    constructor(graphId: string, triggerName: string) {
        super('NodeGraph.TriggerNameChanged.v1');
        this.graphId = graphId;
        this.triggerName = triggerName;
    }
}

/**
 * Payload for NodeGraph signal-trigger updates.
 */
class NodeGraphSignalTriggerChangedPayload extends AppPayload {
    graphId: string;

    signalNames: string[];

    signalMode: SignalTriggerMode;

    runOnStart: boolean;

    /**
     * @param {string} graphId - ID of the graph whose signal trigger changed.
     * @param {string[]} signalNames - Normalized watched signal names.
     * @param {'any'|'all'} signalMode - Normalized trigger mode.
     * @param {boolean} runOnStart - Whether the graph also runs once at startup.
     */
    constructor(
        graphId: string,
        signalNames: string[],
        signalMode: SignalTriggerMode,
        runOnStart: boolean
    ) {
        super('NodeGraph.SignalTriggerChanged.v1');
        this.graphId = graphId;
        this.signalNames = signalNames;
        this.signalMode = signalMode;
        this.runOnStart = runOnStart;
    }
}

/**
 * Payload for NodeGraph function-signature updates.
 *
 * Emitted by: `NodeGraph.setFunctionCategory()`, `NodeGraph.setFunctionIcon()` and
 * `NodeGraph.setFunctionPorts()`.
 * Consumed by: the structural input/output nodes, the generated function node
 * definition, the palette refresh and the transpiler pre-pass, all of which
 * re-read the signature instead of caching it.
 *
 * `previousSignature` and `indexMapping` exist for the cross-graph sync: a placed
 * call node (`function_graph.<graphId>`) in another graph is a snapshot of the
 * signature taken at drop time, so `FunctionCallNodeReconciler` needs both the old
 * interface and — when the edit moved or removed connectors — the old→new index
 * mapping to rebuild the connectors and re-point the wiring without guessing.
 */
class NodeGraphFunctionSignatureChangedPayload extends AppPayload {
    graphId: string;

    functionSignature: FunctionSignature;

    /** Signature before the change; a deep copy, so listeners cannot mutate graph state. */
    previousSignature: FunctionSignature;

    /**
     * How the edited port list moved, or `null` when no connector changed index
     * (category edits, renames, type edits and appended ports keep every old index).
     */
    indexMapping: FunctionPortIndexMapping | null;

    /**
     * @param {string} graphId - ID of the graph whose function signature changed.
     * @param {object} functionSignature - Normalized category, icon, inputs and outputs after the change.
     * @param {object} previousSignature - Normalized signature before the change.
     * @param {object|null} [indexMapping] - Old→new index mapping of the edited port list.
     */
    constructor(
        graphId: string,
        functionSignature: FunctionSignature,
        previousSignature: FunctionSignature,
        indexMapping: FunctionPortIndexMapping | null = null
    ) {
        super('NodeGraph.FunctionSignatureChanged.v1');
        this.graphId = graphId;
        this.functionSignature = functionSignature;
        this.previousSignature = previousSignature;
        this.indexMapping = indexMapping;
    }
}

/**
 * Payload for NodeGraph enabled-state updates.
 */
class NodeGraphEnabledChangedPayload extends AppPayload {
    graphId: string;

    enabled: boolean;

    /**
     * @param {string} graphId - ID of the graph whose enabled state changed.
     * @param {boolean} enabled - Whether the graph takes part in transpilation.
     */
    constructor(graphId: string, enabled: boolean) {
        super('NodeGraph.EnabledChanged.v1');
        this.graphId = graphId;
        this.enabled = enabled;
    }
}

/**
 * Payload for NodeGraph trigger-interval updates.
 */
class NodeGraphIntervalChangedPayload extends AppPayload {
    graphId: string;

    triggerIntervalMs: number;

    /**
     * @param {string} graphId - ID of the graph that emitted the interval change.
     * @param {number} triggerIntervalMs - Updated scheduler interval in milliseconds.
     */
    constructor(graphId: string, triggerIntervalMs: number) {
        super('NodeGraph.IntervalChanged.v1');
        this.graphId = graphId;
        this.triggerIntervalMs = triggerIntervalMs;
    }
}

/**
 * Payload for NodeGraph highlight-color updates.
 */
class NodeGraphColorChangedPayload extends AppPayload {
    graphId: string;

    highlightColor: string;

    /**
     * @param {string} graphId - ID of the graph that emitted the color change.
     * @param {string} highlightColor - New highlight color used by graph UI rendering.
     */
    constructor(graphId: string, highlightColor: string) {
        super('NodeGraph.ColorChanged.v1');
        this.graphId = graphId;
        this.highlightColor = highlightColor;
    }
}

/**
 * Payload for NodeGraph node-added events.
 */
class NodeGraphNodeAddedPayload extends AppPayload {
    graphId: string;

    nodeId: NodeIdentifier;

    /**
     * @param {string} graphId - ID of the graph where the node was added.
     * @param {string|number} nodeId - Identifier of the newly added node.
     */
    constructor(graphId: string, nodeId: NodeIdentifier) {
        super('NodeGraph.NodeAdded.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
    }
}

/**
 * Payload for NodeGraph node-updated events.
 */
class NodeGraphNodeUpdatedPayload extends AppPayload {
    graphId: string;

    nodeId: NodeIdentifier;

    patch: Record<string, unknown>;

    previous: Record<string, unknown>;

    /**
     * @param {string} graphId - ID of the graph where the node was updated.
     * @param {string|number} nodeId - Identifier of the node that changed.
     * @param {object} patch - Updated fields applied to the node.
     * @param {object} previous - Pre-change field snapshot for history/undo.
     */
    constructor(
        graphId: string,
        nodeId: NodeIdentifier,
        patch: Record<string, unknown>,
        previous: Record<string, unknown>
    ) {
        super('NodeGraph.NodeUpdated.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
        this.patch = patch;
        this.previous = previous;
    }
}

/**
 * Payload for NodeGraph node-position updates.
 */
class NodeGraphNodePositionChangedPayload extends AppPayload {
    graphId: string;

    nodeId: NodeIdentifier;

    x: number;

    y: number;

    /**
     * @param {string} graphId - ID of the graph where node position changed.
     * @param {string|number} nodeId - Identifier of the moved node.
     * @param {number} x - Updated node X coordinate in graph space.
     * @param {number} y - Updated node Y coordinate in graph space.
     */
    constructor(graphId: string, nodeId: NodeIdentifier, x: number, y: number) {
        super('NodeGraph.NodePositionChanged.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
        this.x = x;
        this.y = y;
    }
}

/**
 * Payload for NodeGraph node-drag-started events.
 */
class NodeGraphNodeDragStartedPayload extends AppPayload {
    graphId: string;

    nodeId: NodeIdentifier;

    /**
     * @param {string} graphId - ID of the graph where drag started.
     * @param {string|number} nodeId - Identifier of the node entering drag state.
     */
    constructor(graphId: string, nodeId: NodeIdentifier) {
        super('NodeGraph.NodeDragStarted.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
    }
}

/**
 * Payload for NodeGraph node-drag-ended events.
 */
class NodeGraphNodeDragEndedPayload extends AppPayload {
    graphId: string;

    nodeId: NodeIdentifier;

    /**
     * @param {string} graphId - ID of the graph where drag ended.
     * @param {string|number} nodeId - Identifier of the node leaving drag state.
     */
    constructor(graphId: string, nodeId: NodeIdentifier) {
        super('NodeGraph.NodeDragEnded.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
    }
}

/**
 * Payload for NodeGraph node-removed events.
 */
class NodeGraphNodeRemovedPayload extends AppPayload {
    graphId: string;

    nodeId: NodeIdentifier;

    removedConnections: number;

    /**
     * @param {string} graphId - ID of the graph where the node was removed.
     * @param {string|number} nodeId - Identifier of the removed node.
     * @param {number} removedConnections - Number of connections removed with the node.
     */
    constructor(graphId: string, nodeId: NodeIdentifier, removedConnections: number) {
        super('NodeGraph.NodeRemoved.v1');
        this.graphId = graphId;
        this.nodeId = nodeId;
        this.removedConnections = removedConnections;
    }
}

/**
 * Payload for NodeGraph connection-added events.
 */
class NodeGraphConnectionAddedPayload extends AppPayload {
    graphId: string;

    connection: NodeConnection;

    /**
     * @param {string} graphId - ID of the graph where the connection was created.
     * @param {{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}} connection - Normalized connection endpoints and slot indices.
     */
    constructor(graphId: string, connection: NodeConnection) {
        super('NodeGraph.ConnectionAdded.v1');
        this.graphId = graphId;
        this.connection = connection;
    }
}

/**
 * Payload for NodeGraph connection-removed events.
 */
class NodeGraphConnectionRemovedPayload extends AppPayload {
    graphId: string;

    connection: NodeConnection;

    /**
     * @param {string} graphId - ID of the graph where the connection was removed.
     * @param {{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}} connection - Endpoints identifying the removed connection.
     */
    constructor(graphId: string, connection: NodeConnection) {
        super('NodeGraph.ConnectionRemoved.v1');
        this.graphId = graphId;
        this.connection = connection;
    }
}

/**
 * Payload for NodeGraph connection-validation errors.
 */
class NodeGraphConnectionErrorPayload extends AppPayload {
    graphId: string;

    connection: NodeConnection;

    error: string;

    /**
     * @param {string} graphId - ID of the graph where connection validation failed.
     * @param {{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}} connection - Connection attempt that failed validation.
     * @param {string} error - Validation failure message for UI feedback/logging.
     */
    constructor(graphId: string, connection: NodeConnection, error: string) {
        super('NodeGraph.ConnectionError.v1');
        this.graphId = graphId;
        this.connection = connection;
        this.error = error;
    }
}

/**
 * Payload for NodeGraph documentation-area-added events.
 */
class NodeGraphDocumentationAreaAddedPayload extends AppPayload {
    graphId: string;

    areaId: string;

    /**
     * @param {string} graphId - ID of the graph that gained the documentation area.
     * @param {string} areaId - Identifier the graph assigned to the new documentation area.
     */
    constructor(graphId: string, areaId: string) {
        super('NodeGraph.DocumentationAreaAdded.v1');
        this.graphId = graphId;
        this.areaId = areaId;
    }
}

/**
 * Payload for NodeGraph documentation-area-updated events.
 */
class NodeGraphDocumentationAreaUpdatedPayload extends AppPayload {
    graphId: string;

    areaId: string;

    patch: Record<string, unknown>;

    previous: Record<string, unknown>;

    /**
     * @param {string} graphId - ID of the graph that owns the documentation area.
     * @param {string} areaId - Identifier of the edited documentation area.
     * @param {Record<string, unknown>} patch - Changed fields only (`title`, `markdown`, `color`).
     * @param {Record<string, unknown>} previous - Previous values of exactly those fields.
     */
    constructor(
        graphId: string,
        areaId: string,
        patch: Record<string, unknown>,
        previous: Record<string, unknown>
    ) {
        super('NodeGraph.DocumentationAreaUpdated.v1');
        this.graphId = graphId;
        this.areaId = areaId;
        this.patch = patch;
        this.previous = previous;
    }
}

/**
 * Payload for NodeGraph documentation-area-bounds-changed events.
 */
class NodeGraphDocumentationAreaBoundsChangedPayload extends AppPayload {
    graphId: string;

    areaId: string;

    bounds: DocumentationAreaBounds;

    previousBounds: DocumentationAreaBounds;

    /**
     * @param {string} graphId - ID of the graph that owns the documentation area.
     * @param {string} areaId - Identifier of the moved or resized documentation area.
     * @param {{x:number, y:number, width:number, height:number}} bounds - New normalized bounds.
     * @param {{x:number, y:number, width:number, height:number}} previousBounds - Bounds before the change.
     */
    constructor(
        graphId: string,
        areaId: string,
        bounds: DocumentationAreaBounds,
        previousBounds: DocumentationAreaBounds
    ) {
        super('NodeGraph.DocumentationAreaBoundsChanged.v1');
        this.graphId = graphId;
        this.areaId = areaId;
        this.bounds = bounds;
        this.previousBounds = previousBounds;
    }
}

/**
 * Payload for NodeGraph documentation-area-removed events.
 */
class NodeGraphDocumentationAreaRemovedPayload extends AppPayload {
    graphId: string;

    areaId: string;

    /**
     * @param {string} graphId - ID of the graph the documentation area was removed from.
     * @param {string} areaId - Identifier of the removed documentation area.
     */
    constructor(graphId: string, areaId: string) {
        super('NodeGraph.DocumentationAreaRemoved.v1');
        this.graphId = graphId;
        this.areaId = areaId;
    }
}

/**
 * Payload for NodeGraph documentation-area-drag-started events.
 */
class NodeGraphDocumentationAreaDragStartedPayload extends AppPayload {
    graphId: string;

    areaId: string;

    mode: DocumentationAreaDragMode;

    /**
     * @param {string} graphId - ID of the graph where the gesture started.
     * @param {string} areaId - Identifier of the documentation area being dragged.
     * @param {'move'|'resize'} mode - Gesture kind, so history can describe and label it.
     */
    constructor(graphId: string, areaId: string, mode: DocumentationAreaDragMode) {
        super('NodeGraph.DocumentationAreaDragStarted.v1');
        this.graphId = graphId;
        this.areaId = areaId;
        this.mode = mode;
    }
}

/**
 * Payload for NodeGraph documentation-area-drag-ended events.
 */
class NodeGraphDocumentationAreaDragEndedPayload extends AppPayload {
    graphId: string;

    areaId: string;

    /**
     * @param {string} graphId - ID of the graph where the gesture ended.
     * @param {string} areaId - Identifier of the documentation area that was dragged.
     */
    constructor(graphId: string, areaId: string) {
        super('NodeGraph.DocumentationAreaDragEnded.v1');
        this.graphId = graphId;
        this.areaId = areaId;
    }
}

function assertGraphId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    throw new TypeError('Graph id must be a non-empty string.');
}

function normalizeName(value: unknown): string {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
            return trimmed.slice(0, 120);
        }
    }
    return DEFAULT_GRAPH_NAME;
}

/**
 * Normalize a loop interval into the supported range.
 *
 * Delegates to the shared interval rules: finite values are floored and clamped
 * into `MIN_GRAPH_INTERVAL_MS … MAX_SLEEP_MS` (`0` is valid and means a
 * yield-only cadence), while blank or unusable input falls back to
 * {@link DEFAULT_SLEEP_MS}.
 *
 * @param {unknown} value - Raw interval from storage or user input.
 * @returns {number} Whole milliseconds inside the supported range.
 */
function normalizeInterval(value: unknown): number {
    return clampSleepDuration(value);
}

function normalizeColor(value: unknown): string {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
            return trimmed;
        }
    }
    return DEFAULT_GRAPH_HIGHLIGHT_COLOR;
}

function normalizeNodeCounter(value: unknown, nodesLength: number): number {
    if (Number.isFinite(value) && Number(value) >= 0) {
        return Math.floor(Number(value));
    }
    return Math.max(0, nodesLength);
}

function normalizeNodeIdentifier(value: unknown, fallback = ''): NodeIdentifier {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return fallback;
}

function nodeIdentifierSeed(value: unknown): number {
    const normalized = normalizeNodeIdentifier(value, '');
    if (!normalized) {
        return 0;
    }

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return 0;
    }

    return Math.floor(numeric);
}

function isValidNodeIdentifier(value: unknown): value is NodeIdentifier {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    return false;
}

function assertConnectionShape(conn: unknown): NodeConnection {
    if (!conn || typeof conn !== 'object') {
        throw new TypeError('Connection must be an object.');
    }
    const { fromNode, fromIndex, toNode, toIndex } = conn as NodeConnection;
    if (!isValidNodeIdentifier(fromNode)) {
        throw new TypeError('Connection.fromNode must be a string or number.');
    }
    if (!isValidNodeIdentifier(toNode)) {
        throw new TypeError('Connection.toNode must be a string or number.');
    }
    if (!Number.isInteger(fromIndex) || fromIndex < 0) {
        throw new TypeError('Connection.fromIndex must be a non-negative integer.');
    }
    if (!Number.isInteger(toIndex) || toIndex < 0) {
        throw new TypeError('Connection.toIndex must be a non-negative integer.');
    }
    return {
        fromNode: normalizeNodeIdentifier(fromNode),
        fromIndex,
        toNode: normalizeNodeIdentifier(toNode),
        toIndex,
    };
}

function cloneConnection(conn: NodeConnection): NodeConnection {
    return assertConnectionShape(conn);
}

function cloneNodeInputsForPatch(inputs: unknown): unknown[] {
    if (!Array.isArray(inputs)) {
        return [];
    }

    return inputs.map((input) => {
        if (!input || typeof input !== 'object') {
            return input;
        }

        const clonedInput: Record<string, unknown> = { ...(input as Record<string, unknown>) };
        if (Array.isArray(clonedInput.allowedTypes)) {
            clonedInput.allowedTypes = [...(clonedInput.allowedTypes as unknown[])];
        }
        return clonedInput;
    });
}

function cloneNodeOutputsForPatch(outputs: unknown): unknown[] {
    if (!Array.isArray(outputs)) {
        return [];
    }

    return outputs.map((output) => {
        if (!output || typeof output !== 'object') {
            return output;
        }

        const clonedOutput: Record<string, unknown> = { ...(output as Record<string, unknown>) };
        if (Array.isArray(clonedOutput.allowedTypes)) {
            clonedOutput.allowedTypes = [...(clonedOutput.allowedTypes as unknown[])];
        }
        if (Array.isArray(clonedOutput.initialTypes)) {
            clonedOutput.initialTypes = [...(clonedOutput.initialTypes as unknown[])];
        }
        return clonedOutput;
    });
}

function normalizeTypeList(types: unknown): string[] {
    if (!Array.isArray(types)) {
        return [];
    }

    const unique = new Set<string>();
    const normalized: string[] = [];
    types.forEach((entry) => {
        if (typeof entry !== 'string') {
            return;
        }

        const trimmed = entry.trim();
        if (!trimmed || unique.has(trimmed)) {
            return;
        }
        unique.add(trimmed);
        normalized.push(trimmed);
    });
    return normalized;
}

function arrayEquals(left: unknown[], right: unknown[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index += 1) {
        if (!Object.is(left[index], right[index])) {
            return false;
        }
    }
    return true;
}

function connectionWouldCreateCycle(
    connections: NodeConnection[],
    fromNodeId: string,
    toNodeId: string
): boolean {
    if (fromNodeId === toNodeId) {
        return true;
    }

    const adjacency = new Map<string, string[]>();
    connections.forEach((connection) => {
        const outgoing = adjacency.get(connection.fromNode) || [];
        outgoing.push(connection.toNode);
        adjacency.set(connection.fromNode, outgoing);
    });

    const visited = new Set<string>();
    const stack: string[] = [toNodeId];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }

        if (current === fromNodeId) {
            return true;
        }

        if (visited.has(current)) {
            continue;
        }
        visited.add(current);

        const neighbors = adjacency.get(current) || [];
        neighbors.forEach((neighbor) => {
            if (!visited.has(neighbor)) {
                stack.push(neighbor);
            }
        });
    }

    return false;
}

/**
 * Clone a documentation area from data or another instance.
 *
 * Accepts partial input: missing fields fall back to the `DocumentationArea` defaults and
 * malformed bounds/colours are normalized rather than rejected, so a corrupted collection
 * document cannot brick a graph load.
 * @param {unknown} source - Serialized area or `DocumentationArea` instance.
 * @returns {DocumentationArea} Detached instance.
 */
function cloneDocumentationArea(source: unknown): DocumentationArea {
    if (source instanceof DocumentationArea) {
        return new DocumentationArea(source.toData());
    }

    const data = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>;
    return new DocumentationArea({
        id: normalizeNodeIdentifier(data.id, ''),
        title: typeof data.title === 'string' ? data.title : '',
        markdown: typeof data.markdown === 'string' ? data.markdown : '',
        color: typeof data.color === 'string' ? data.color : undefined,
        contentAlign: normalizeAreaContentAlign(data.contentAlign),
        fontSize: normalizeAreaFontSize(data.fontSize),
        bounds: (data.bounds ?? undefined) as DocumentationAreaBounds | undefined,
    });
}

function cloneNode(node: NodeData | Record<string, unknown>): NodeDataLike {
    if (!node || typeof node !== 'object') {
        throw new TypeError(`Node must be an object or NodeData. ${typeof node} given: ${node}.`);
    }
    if (node instanceof NodeData) {
        return new NodeData(node.toData() as unknown as Record<string, unknown>) as NodeDataLike;
    }
    return new NodeData(node) as NodeDataLike;
}

/**
 * Deep-copy a function signature.
 *
 * Every port array and every `types` array is fresh, so callers can mutate the
 * result without touching graph state.
 *
 * @param signature - Normalized signature to copy.
 * @returns A detached copy.
 */
function cloneFunctionPort(port: FunctionPort): FunctionPort {
    const cloned: FunctionPort = { ...port, types: port.types.slice() };
    if (port.default) {
        cloned.default = { ...port.default };
    }
    return cloned;
}

function cloneFunctionSignature(signature: FunctionSignature): FunctionSignature {
    const cloned: FunctionSignature = {
        category: signature.category,
        icon: signature.icon,
        inputs: signature.inputs.map(cloneFunctionPort),
        outputs: signature.outputs.map(cloneFunctionPort),
    };
    if (signature.description) {
        cloned.description = signature.description;
    }
    return cloned;
}

/**
 * Compare two normalized signatures by value.
 *
 * @param left - First signature.
 * @param right - Second signature.
 * @returns True when the category, the icon and every port id, name and type list match.
 */
function functionSignaturesEqual(left: FunctionSignature, right: FunctionSignature): boolean {
    if (left.category !== right.category || left.icon !== right.icon) {
        return false;
    }
    if ((left.description ?? '') !== (right.description ?? '')) {
        return false;
    }
    if (
        left.inputs.length !== right.inputs.length ||
        left.outputs.length !== right.outputs.length
    ) {
        return false;
    }

    const defaultsEqual = (
        a: FunctionPortDefault | undefined,
        b: FunctionPortDefault | undefined
    ): boolean => {
        if (a === undefined || b === undefined) {
            return a === b;
        }
        return (
            a.type === b.type &&
            a.value === b.value &&
            a.min === b.min &&
            a.max === b.max &&
            a.step === b.step
        );
    };

    const portsEqual = (a: FunctionPort, b: FunctionPort): boolean =>
        a.id === b.id &&
        a.name === b.name &&
        (a.documentation ?? '') === (b.documentation ?? '') &&
        a.types.length === b.types.length &&
        a.types.every((typeId, index) => typeId === b.types[index]) &&
        defaultsEqual(a.default, b.default);

    return (
        left.inputs.every((port, index) => portsEqual(port, right.inputs[index])) &&
        left.outputs.every((port, index) => portsEqual(port, right.outputs[index]))
    );
}

/**
 * Mutable container for a graph's metadata, nodes, connections, and viewport.
 * Validates and normalizes inputs on construction and when mutating internals.
 *
 * Change events emitted via `onChange` listeners (`AppEvent` envelope):
 * - `viewport` with `NodeGraph.ViewportChanged.v1`
 * - `name` with `NodeGraph.NameChanged.v1`
 * - `executionType` with `NodeGraph.ExecutionTypeChanged.v1`
 * - `functionSignature` with `NodeGraph.FunctionSignatureChanged.v1`
 * - `triggerName` with `NodeGraph.TriggerNameChanged.v1`
 * - `enabled` with `NodeGraph.EnabledChanged.v1`
 * - `interval` with `NodeGraph.IntervalChanged.v1`
 * - `color` with `NodeGraph.ColorChanged.v1`
 * - `node-added` with `NodeGraph.NodeAdded.v1`
 * - `node-updated` with `NodeGraph.NodeUpdated.v1`
 * - `node-pos-changed` with `NodeGraph.NodePositionChanged.v1`
 * - `node-drag-started` with `NodeGraph.NodeDragStarted.v1`
 * - `node-drag-ended` with `NodeGraph.NodeDragEnded.v1`
 * - `node-removed` with `NodeGraph.NodeRemoved.v1`
 * - `connection-added` with `NodeGraph.ConnectionAdded.v1`
 * - `connection-removed` with `NodeGraph.ConnectionRemoved.v1`
 * - `connection-error` with `NodeGraph.ConnectionError.v1`
 * - `documentation-area-added` with `NodeGraph.DocumentationAreaAdded.v1`
 * - `documentation-area-updated` with `NodeGraph.DocumentationAreaUpdated.v1`
 * - `documentation-area-bounds-changed` with `NodeGraph.DocumentationAreaBoundsChanged.v1`
 * - `documentation-area-removed` with `NodeGraph.DocumentationAreaRemoved.v1`
 * - `documentation-area-drag-started` with `NodeGraph.DocumentationAreaDragStarted.v1`
 * - `documentation-area-drag-ended` with `NodeGraph.DocumentationAreaDragEnded.v1`
 */
class NodeGraph extends AppEventEmitter {
    #id: string;

    #name: string;

    #executionType: ExecutionType;

    #functionSignature: FunctionSignature;

    #triggerName: string;

    #signalNames: string[];

    #signalMode: SignalTriggerMode;

    #runOnStart: boolean;

    #enabled: boolean;

    #triggerIntervalMs: number;

    #highlightColor: string;

    #nodes: NodeDataLike[];

    #connections: NodeConnection[];

    #documentationAreas: DocumentationArea[];

    #viewportConfig: ViewportConfig;

    #maxNodeId: number;

    #maxDocumentationAreaId: number;

    #enableEvents: boolean;

    #dataTypeDefinitionLookup: DataTypeDefinitionLookup;

    /**
     * Build a graph model with validated defaults.
     * @param {{
     *   id?: string,
     *   name?: string,
     *   executionType?: string,
     *   enabled?: boolean,
     *   triggerName?: string,
     *   triggerIntervalMs?: number,
     *   highlightColor?: string,
     *   nodes?: Array<NodeData|object>,
     *   connections?: Array<{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}>,
     *   documentationAreas?: Array<object>,
     *   nodeCounter?: number,
     *   viewportConfig?: ViewportConfig|object|null,
     *   functionSignature?: object|null,
     * }} [options]
     */
    constructor({
        id = 'graph-1',
        name = 'Graph 1',
        executionType = DEFAULT_EXECUTION_TYPE,
        enabled = DEFAULT_GRAPH_ENABLED,
        triggerName = DEFAULT_TRIGGER_NAME,
        signalNames = [],
        signalMode = DEFAULT_SIGNAL_MODE,
        runOnStart = DEFAULT_RUN_ON_START,
        triggerIntervalMs = DEFAULT_GRAPH_INTERVAL_MS,
        highlightColor = DEFAULT_GRAPH_HIGHLIGHT_COLOR,
        nodes = [],
        connections = [],
        documentationAreas = [],
        nodeCounter = 0,
        viewportConfig = null,
        dataTypeDefinitionLookup = null,
        functionSignature = null,
    }: NodeGraphData = {}) {
        super();
        const normalizedId = assertGraphId(id);
        const normalizedNodes = Array.isArray(nodes) ? nodes.map(cloneNode) : [];
        const normalizedConnections = Array.isArray(connections)
            ? connections.map(cloneConnection)
            : [];
        const normalizedNodeIds = new Set(
            normalizedNodes.map((node) => normalizeNodeIdentifier(node.id))
        );
        const linkedConnections = normalizedConnections.filter((conn) => {
            return normalizedNodeIds.has(conn.fromNode) && normalizedNodeIds.has(conn.toNode);
        });

        this.#id = normalizedId;
        this.#name = normalizeName(name);
        this.#executionType = normalizeExecutionType(executionType);
        this.#functionSignature = normalizeFunctionSignature(functionSignature);
        this.#triggerName = normalizeTriggerName(triggerName);
        this.#signalNames = normalizeSignalNames(signalNames);
        this.#signalMode = normalizeSignalMode(signalMode);
        this.#runOnStart = normalizeRunOnStart(runOnStart);
        this.#enabled = normalizeGraphEnabled(enabled);
        this.#triggerIntervalMs = normalizeInterval(triggerIntervalMs);
        this.#highlightColor = normalizeColor(highlightColor);
        this.#nodes = normalizedNodes;
        this.#connections = linkedConnections;
        this.#documentationAreas = Array.isArray(documentationAreas)
            ? documentationAreas
                  .map((area) => cloneDocumentationArea(area))
                  .filter((area) => area.id.length > 0)
            : [];
        this.#refreshDynamicConnectorTypingForNodes(
            this.#nodes.map((node) => normalizeNodeIdentifier(node.id))
        );
        this.#viewportConfig =
            viewportConfig instanceof ViewportConfig
                ? viewportConfig.clone()
                : ViewportConfig.fromData(viewportConfig);
        this.#enableEvents = true;
        this.#dataTypeDefinitionLookup =
            typeof dataTypeDefinitionLookup === 'function' ? dataTypeDefinitionLookup : null;
        this.#maxNodeId = this.#nodes.reduce((maxId, node) => {
            const nodeId = nodeIdentifierSeed(node.id);
            return nodeId > maxId ? nodeId : maxId;
        }, 0);
        this.#maxDocumentationAreaId = this.#documentationAreas.reduce((maxId, area) => {
            const areaId = nodeIdentifierSeed(area.id);
            return areaId > maxId ? areaId : maxId;
        }, 0);

        normalizeNodeCounter(nodeCounter, normalizedNodes.length);
    }

    /**
     * Log a message with automatic class name capture.
     * @param {string} reason - Reason/event identifier
     * @param {string} [level='debug'] - Log level: 'debug' | 'info' | 'warn' | 'error'
     * @param {...any} data - Optional data to log
     * @private
     */
    _log(reason: string, level: string = 'debug', ...data: unknown[]): void {
        if (typeof globalThis.__microOtterLog !== 'undefined') {
            const { log } = globalThis.__microOtterLog as {
                log: (source: string, reasonText: string, lvl: string, ...args: unknown[]) => void;
            };

            const validLevels = ['debug', 'info', 'warn', 'error'];
            const actualLevel = validLevels.includes(level) ? level : 'debug';
            const actualData = validLevels.includes(level) ? data : [level, ...data];

            log('NodeGraph', reason, actualLevel, ...actualData);
        }
    }

    getNextNodeId(): NodeIdentifier {
        this.#maxNodeId += 1;
        return String(this.#maxNodeId);
    }

    /**
     * Hydrate a graph from plain data.
     * @param {object} [data]
     * @returns {NodeGraph}
     */
    static fromData(data: NodeGraphData = {}): NodeGraph {
        return new NodeGraph(data);
    }

    setDataTypeDefinitionLookup(lookup: DataTypeDefinitionLookup): void {
        this.#dataTypeDefinitionLookup = typeof lookup === 'function' ? lookup : null;
    }

    getDataTypeKind(typeId: string): 'value' | 'structure' {
        if (!this.#dataTypeDefinitionLookup || !typeId) {
            return 'value';
        }

        const definition = this.#dataTypeDefinitionLookup(typeId);
        if (!definition || typeof definition !== 'object') {
            return 'value';
        }

        return definition.kind === 'structure' ? 'structure' : 'value';
    }

    /**
     * Types an output can actually carry, following `typeInputSources` upstream.
     *
     * Ordinary outputs resolve to their declared type. A union output — one whose
     * definition lists `typeInputSources` — resolves each declared source in declaration
     * order: a connected source contributes its upstream resolved types, an unconnected
     * source contributes its primary allowed type. When at least one source is connected,
     * only the connected candidates are returned; when none is connected, the deduplicated
     * fallback candidates are returned (never `['any']` unless a fallback itself is `any`).
     *
     * The union follows the **active, connected** declared sources: a source hidden by the
     * node's `affectsInputs` dropdown is ignored even when a stale connection still points
     * at its connector, so it contributes neither candidates nor fallbacks.
     *
     * @param nodeId - Source node.
     * @param outputIndex - Output index on that node.
     * @param visited - Cycle guard for re-entrant unions.
     * @returns The candidate types, never empty and never throwing.
     */
    getResolvedOutputTypes(
        nodeId: NodeIdentifier,
        outputIndex: number,
        visited: Set<string> = new Set()
    ): string[] {
        const normalizedNodeId = normalizeNodeIdentifier(nodeId, '');
        try {
            const sourceNode = this.#nodes.find(
                (node) => normalizeNodeIdentifier(node.id, '') === normalizedNodeId
            );
            if (!sourceNode) {
                return ['any'];
            }

            const outputEntry = sourceNode.outputs?.[outputIndex] as
                | Record<string, unknown>
                | undefined;
            const declaredSources = resolveDeclaredInputSources(outputEntry);
            if (declaredSources.length === 0) {
                return [this.#resolveOutputTypeForIndex(sourceNode, outputIndex)];
            }

            const guardKey = `${normalizedNodeId}|${outputIndex}`;
            if (visited.has(guardKey)) {
                return ['any'];
            }
            const nextVisited = new Set(visited);
            nextVisited.add(guardKey);

            const candidates: string[] = [];
            const fallbacks: string[] = [];
            let connectedSources = 0;
            const activeInputIds = resolveActiveInputIds(sourceNode);
            declaredSources.forEach((inputId) => {
                if (activeInputIds && !activeInputIds.has(inputId)) {
                    return;
                }
                const inputIndex = (sourceNode.inputs || []).findIndex(
                    (input) => (input as Record<string, unknown>)?.id === inputId
                );
                if (inputIndex < 0) {
                    return;
                }
                const connection = this.#connections.find(
                    (conn) => conn.toNode === normalizedNodeId && conn.toIndex === inputIndex
                );
                if (!connection) {
                    const input = (sourceNode.inputs || [])[inputIndex] as
                        | Record<string, unknown>
                        | undefined;
                    const fallback = getPrimaryAllowedType(input?.allowedTypes);
                    if (fallback && !fallbacks.includes(fallback)) {
                        fallbacks.push(fallback);
                    }
                    return;
                }
                connectedSources += 1;
                this.getResolvedOutputTypes(
                    connection.fromNode,
                    connection.fromIndex,
                    nextVisited
                ).forEach((typeId) => {
                    if (
                        typeof typeId === 'string' &&
                        typeId.trim() &&
                        !candidates.includes(typeId)
                    ) {
                        candidates.push(typeId.trim());
                    }
                });
            });

            if (connectedSources > 0) {
                return candidates.length > 0 ? candidates : ['any'];
            }
            return fallbacks.length > 0 ? fallbacks : ['any'];
        } catch {
            // Connection validation must never break on a malformed node.
            return ['any'];
        }
    }

    #resolveOutputTypeForIndex(sourceNode: NodeDataLike, fromIndex: number): string {
        const outputEntry = sourceNode.outputs?.[fromIndex] as Record<string, unknown> | undefined;
        const outputId = typeof outputEntry?.id === 'string' ? outputEntry.id : '';
        if (!outputId) {
            return 'any';
        }

        try {
            const outputType = sourceNode.getOutputType(outputId);
            return typeof outputType === 'string' && outputType.trim() ? outputType.trim() : 'any';
        } catch (error) {
            const outputTypeMessage = error instanceof Error ? error.message : String(error);
            if (outputTypeMessage.includes('missing required outputType')) {
                return 'any';
            }
            throw error;
        }
    }

    #resolveOutputMaxConnections(outputType: string): number | null {
        if (!this.#dataTypeDefinitionLookup || !outputType) {
            return null;
        }

        const definition = this.#dataTypeDefinitionLookup(outputType);
        if (!definition || typeof definition !== 'object') {
            return null;
        }

        const maxConnections = definition.connectionPolicy?.output?.maxConnections;
        if (typeof maxConnections !== 'number' || !Number.isInteger(maxConnections)) {
            return null;
        }

        if (maxConnections < 0) {
            return null;
        }

        return maxConnections;
    }

    #resolveInputMaxConnections(outputType: string): number | null {
        if (!this.#dataTypeDefinitionLookup || !outputType) {
            return null;
        }

        const definition = this.#dataTypeDefinitionLookup(outputType);
        if (!definition || typeof definition !== 'object') {
            return null;
        }

        const maxConnections = definition.connectionPolicy?.input?.maxConnections;
        if (typeof maxConnections !== 'number' || !Number.isInteger(maxConnections)) {
            return null;
        }

        if (maxConnections < 0) {
            return null;
        }

        return maxConnections;
    }

    /**
     * Serialize the graph to plain objects suitable for storage.
     * @returns {{
     *   id: string,
     *   name: string,
     *   executionType: string,
     *   enabled: boolean,
     *   triggerName: string,
     *   triggerIntervalMs: number,
     *   highlightColor: string,
     *   nodes: Array<object>,
     *   connections: Array<{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}>,
     *   documentationAreas: Array<{id:string, title:string, markdown:string, color:string, bounds:{x:number, y:number, width:number, height:number}}>,
     *   viewportConfig: {translateX:number, translateY:number, scale:number},
     *   functionSignature?: {category:string, icon:string, inputs:Array<object>, outputs:Array<object>},
     * }}
     */
    toData(): NodeGraphSerializedData {
        const data: NodeGraphSerializedData = {
            id: this.#id,
            name: this.#name,
            executionType: this.#executionType,
            enabled: this.#enabled,
            triggerName: this.#triggerName,
            signalNames: this.#signalNames.slice(),
            signalMode: this.#signalMode,
            runOnStart: this.#runOnStart,
            triggerIntervalMs: this.#triggerIntervalMs,
            highlightColor: this.#highlightColor,
            nodes: this.#nodes.map((node) => node.toData() as unknown as Record<string, unknown>),
            connections: this.#connections.map(cloneConnection),
            documentationAreas: this.#documentationAreas.map((area) => area.toData()),
            viewportConfig: this.#viewportConfig.toData(),
        };

        // A signature is only stored when it can mean something: either the graph is a
        // function graph, or a signature survived a switch back to another execution
        // type. Continuous graphs without a signature therefore serialize byte-identically
        // to the pre-function format.
        if (
            this.#executionType === 'function' ||
            !isEmptyFunctionSignature(this.#functionSignature)
        ) {
            data.functionSignature = cloneFunctionSignature(this.#functionSignature);
        }

        return data;
    }

    #emitChange(name: string, payload: AppPayload): void {
        if (!this.#enableEvents) {
            return;
        }

        if (!name) {
            return;
        }

        this.emit(name, payload);
    }

    enableEvents(): void {
        this.#enableEvents = true;
    }

    disableEvents(): void {
        this.#enableEvents = false;
    }

    /**
     * Get the graph identifier.
     * @returns {string}
     */
    getId(): string {
        return this.#id;
    }

    /**
     * Get the graph name.
     * @returns {string}
     */
    getName(): string {
        return this.#name;
    }

    /**
     * Get the current viewport configuration.
     * @returns {ViewportConfig}
     */
    getViewportConfig(): ViewportConfig {
        return this.#viewportConfig;
    }

    /**
     * Get graph execution type.
     * @returns {string}
     */
    getExecutionType(): ExecutionType {
        return this.#executionType;
    }

    /**
     * Get the function signature of this graph.
     *
     * Non-function graphs usually carry an empty signature; the value is
     * normalized either way. The result is a deep copy, so mutating it cannot
     * change graph state.
     *
     * @returns {object} Category, input ports and output ports.
     */
    getFunctionSignature(): FunctionSignature {
        return cloneFunctionSignature(this.#functionSignature);
    }

    /**
     * Get the palette category of this graph's generated function node.
     * @returns {string} Trimmed category, defaulting to `function`.
     */
    getFunctionCategory(): string {
        return this.#functionSignature.category;
    }

    /**
     * Get the header icon of this graph's generated function node.
     * @returns {string} Semantic icon string (`<set>:<name>`), defaulting to `mdi:function`.
     */
    getFunctionIcon(): string {
        return this.#functionSignature.icon;
    }

    /**
     * Get the Markdown description of this graph's generated function node.
     * @returns {string} Trimmed description, or `''` when none is declared.
     */
    getFunctionDescription(): string {
        return this.#functionSignature.description ?? '';
    }

    /**
     * Get the declared function inputs, in emitted parameter order.
     * @returns {Array<object>} Copies of the input ports.
     */
    getFunctionInputPorts(): FunctionPort[] {
        return cloneFunctionSignature(this.#functionSignature).inputs;
    }

    /**
     * Get the declared function outputs, in returned-tuple order.
     * @returns {Array<object>} Copies of the output ports.
     */
    getFunctionOutputPorts(): FunctionPort[] {
        return cloneFunctionSignature(this.#functionSignature).outputs;
    }

    /**
     * Get the generated node type id of this graph's function definition.
     *
     * The id is derived from the graph id alone; whether the definition is
     * published depends on the execution type and is decided by the palette and
     * transpiler seams, not here.
     *
     * @returns {string} `function_graph.<graphId>`.
     */
    getFunctionNodeTypeId(): string {
        return buildFunctionNodeTypeId(this.#id);
    }

    /**
     * Get the structural input or output node of this graph.
     *
     * A function graph may contain at most one of each; graphs without them are
     * valid because the signature stays authoritative (D4).
     *
     * @param {'input'|'output'} kind - Which structural node to look for.
     * @returns {object|null} The node, or `null` when the graph has none.
     */
    getFunctionStructuralNode(kind: FunctionPortKind): NodeDataLike | null {
        const typeId = kind === 'output' ? FUNCTION_OUTPUT_NODE_TYPE : FUNCTION_INPUT_NODE_TYPE;
        return this.#nodes.find((node) => node && node.type === typeId) ?? null;
    }

    /**
     * Ensure the structural input or output node exists.
     *
     * The node is created from the current signature. A caller that knows where the
     * user dropped it passes `position`, so the node lands at the drop point; without
     * one the deterministic `resolveFunctionStructuralNodePosition()` placement keeps
     * the input node left of and the output node right of the existing nodes.
     * Nothing is created — and `position` is ignored — when the node already exists,
     * and no execution-type check happens here: switching types never creates or
     * deletes nodes (D4).
     *
     * Emits: `node-added` when a node is created.
     * @param {'input'|'output'} kind - Which structural node to ensure.
     * @param {{x: number, y: number}} [position] - Top-left world position used on creation.
     * @returns {{node: object, created: boolean}} The node and whether it was new.
     */
    ensureFunctionStructuralNode(
        kind: FunctionPortKind,
        position?: { x: number; y: number }
    ): {
        node: NodeDataLike;
        created: boolean;
    } {
        const existing = this.getFunctionStructuralNode(kind);
        if (existing) {
            return { node: existing, created: false };
        }

        const typeId = kind === 'output' ? FUNCTION_OUTPUT_NODE_TYPE : FUNCTION_INPUT_NODE_TYPE;
        const placement =
            position && Number.isFinite(position.x) && Number.isFinite(position.y)
                ? { x: position.x, y: position.y }
                : resolveFunctionStructuralNodePosition(this.#nodes, typeId);
        const node = this.addNode(
            buildFunctionStructuralNodePayload(typeId, this.getFunctionSignature(), placement)
        );
        return { node, created: true };
    }

    /**
     * Remove the structural input or output node of this graph.
     *
     * Uses `removeNode()`, so its connections are cleaned up and the usual
     * `node-removed` event is emitted.
     *
     * @param {'input'|'output'} kind - Which structural node to remove.
     * @returns {boolean} True when a node was removed.
     */
    removeFunctionStructuralNode(kind: FunctionPortKind): boolean {
        const node = this.getFunctionStructuralNode(kind);
        if (!node) {
            return false;
        }
        return this.removeNode(node.id);
    }

    /**
     * Re-mirror the current signature onto the existing structural nodes.
     *
     * Each node is patched in place through `updateNode()` — never removed and
     * re-added — so its connections, position and undo entry stay intact. Nodes
     * that do not exist are skipped; the signature remains authoritative.
     *
     * Emits: `node-updated` per patched node.
     */
    syncFunctionStructuralNodes(): void {
        const kinds: FunctionPortKind[] = ['input', 'output'];
        kinds.forEach((kind) => {
            const node = this.getFunctionStructuralNode(kind);
            if (!node) {
                return;
            }
            this.updateNode(
                node.id,
                buildFunctionStructuralConnectorPatch(node.type, this.#functionSignature)
            );
        });
    }

    /**
     * Get the declared ports of one side of the signature.
     * @param kind - Which port list to read.
     * @returns Copies of the ports, in declaration order.
     * @private
     */
    #getFunctionPortList(kind: FunctionPortKind): FunctionPort[] {
        return cloneFunctionSignature(this.#functionSignature)[
            kind === 'output' ? 'outputs' : 'inputs'
        ];
    }

    /**
     * Get the index of a declared port.
     *
     * @param kind - Which port list to search.
     * @param portId - Port id (`in_0`, `out_1`, …).
     * @returns Zero-based index, or `-1` when the port does not exist.
     */
    getFunctionPortIndex(kind: FunctionPortKind, portId: string): number {
        return this.#getFunctionPortList(kind).findIndex((port) => port.id === portId);
    }

    /**
     * Append a declared port to one side of the signature.
     *
     * The new port gets the next index-derived id and the supplied name/types;
     * missing values normalize to an empty name and `['any']`. Nothing is added
     * once the side holds `MAX_FUNCTION_PORTS` ports.
     *
     * Emits: `functionSignature` and `node-updated` for the structural node.
     * @param {'input'|'output'} kind - Which port list to extend.
     * @param {object|null} [port] - Optional initial name/types.
     * @returns {{index: number, port: object}|null} The added port, or `null` at the cap.
     */
    addFunctionPort(
        kind: FunctionPortKind,
        port: Record<string, unknown> | null = null
    ): { index: number; port: FunctionPort } | null {
        const ports = this.#getFunctionPortList(kind);
        if (ports.length >= MAX_FUNCTION_PORTS) {
            return null;
        }

        ports.push(normalizeFunctionPort(port, kind, ports.length));
        this.setFunctionPorts(kind, ports);

        const index = ports.length - 1;
        return { index, port: this.#getFunctionPortList(kind)[index] };
    }

    /**
     * Patch one declared port.
     *
     * Unknown port ids are a no-op: the UI calls this from change handlers, so it
     * logs and returns `null` instead of throwing. A name-only patch never touches
     * wiring, because connections key on the connector index, not on the name.
     *
     * Emits: `functionSignature` when the normalized port changed.
     * @param {'input'|'output'} kind - Which port list to patch.
     * @param {string} portId - Port id to patch.
     * @param {object} [patch] - Fields to overwrite (`name`, `types`, `default`,
     *   `documentation`); the whole `default` object is replaced, so callers must send the
     *   merged value.
     * @returns {object|null} The normalized port after the patch, or `null`.
     */
    updateFunctionPort(
        kind: FunctionPortKind,
        portId: string,
        patch: Record<string, unknown> = {}
    ): FunctionPort | null {
        const ports = this.#getFunctionPortList(kind);
        const index = ports.findIndex((port) => port.id === portId);
        if (index === -1) {
            console.warn('function-port-update-ignored', { kind, portId });
            return null;
        }

        ports[index] = normalizeFunctionPort({ ...ports[index], ...patch }, kind, index);
        this.setFunctionPorts(kind, ports);
        return this.#getFunctionPortList(kind)[index];
    }

    /**
     * Remove a declared port and repair the wiring it carried.
     *
     * The structural node's connections on that connector index are removed first,
     * then every connection on a higher index of the same node is re-pointed one
     * index lower. `NodeGraph` has no connection update API, so a re-point is one
     * `removeConnection()` plus one `addConnection()` with the same endpoints; both
     * are public and emit their usual events so the panel and undo stay consistent.
     *
     * Emits: `connection-removed`/`connection-added` for repaired wiring,
     * `functionSignature`, and `node-updated` for the structural node.
     * @param {'input'|'output'} kind - Which port list to shrink.
     * @param {string} portId - Port id to remove.
     * @returns {{index: number, port: object}|null} The removed port, or `null`.
     */
    removeFunctionPort(
        kind: FunctionPortKind,
        portId: string
    ): { index: number; port: FunctionPort } | null {
        const ports = this.#getFunctionPortList(kind);
        const index = ports.findIndex((port) => port.id === portId);
        if (index === -1) {
            console.warn('function-port-removal-ignored', { kind, portId });
            return null;
        }

        const oldLength = ports.length;
        const indexMapping: FunctionPortIndexMapping = {
            kind,
            fromOldToNew: Array.from({ length: oldLength }, (_value, oldIndex) =>
                oldIndex === index ? null : oldIndex > index ? oldIndex - 1 : oldIndex
            ),
        };

        const [removedPort] = ports.splice(index, 1);
        const detached = this.#detachFunctionStructuralConnections(kind);

        this.setFunctionPorts(kind, ports, { indexMapping });

        this.#reattachFunctionStructuralConnections(
            kind,
            detached
                .filter((entry) => entry.index !== index)
                .map((entry) => ({
                    ...entry,
                    index: entry.index > index ? entry.index - 1 : entry.index,
                }))
        );

        return { index, port: removedPort };
    }

    /**
     * Move a declared port and keep its wiring attached.
     *
     * The connection on the moved connector follows the port to its new index;
     * connections on the connectors it passes shift by one. Connections are detached
     * before the connector list changes and re-attached afterwards through the
     * public `removeConnection()`/`addConnection()` pair.
     *
     * Emits: `functionSignature`, `node-updated`, and connection events for the
     * re-pointed wiring.
     * @param {'input'|'output'} kind - Which port list to reorder.
     * @param {number} fromIndex - Current zero-based index of the port.
     * @param {number} toIndex - Target zero-based index of the port.
     * @returns {boolean} True when the list was reordered.
     */
    moveFunctionPort(kind: FunctionPortKind, fromIndex: number, toIndex: number): boolean {
        const ports = this.#getFunctionPortList(kind);
        const from = Number.isInteger(fromIndex) ? fromIndex : -1;
        const to = Number.isInteger(toIndex) ? toIndex : -1;
        if (from < 0 || from >= ports.length || to < 0 || to >= ports.length || from === to) {
            return false;
        }

        const indexMapping = new Map<number, number>();
        const nextPorts = ports.slice();
        const [movedPort] = nextPorts.splice(from, 1);
        nextPorts.splice(to, 0, movedPort);
        const fromOldToNew: Array<number | null> = ports.map(() => null);
        nextPorts.forEach((port, newIndex) => {
            const oldIndex = ports.findIndex((candidate) => candidate.id === port.id);
            if (oldIndex !== -1) {
                indexMapping.set(oldIndex, newIndex);
                fromOldToNew[oldIndex] = newIndex;
            }
        });

        const detached = this.#detachFunctionStructuralConnections(kind);

        this.setFunctionPorts(kind, nextPorts, {
            indexMapping: { kind, fromOldToNew },
        });

        this.#reattachFunctionStructuralConnections(
            kind,
            detached.map((entry) => ({
                ...entry,
                index: indexMapping.get(entry.index) ?? entry.index,
            }))
        );

        return true;
    }

    /**
     * Detach every connection of one structural node.
     *
     * Returns the connector indices the connections used on the structural node's
     * own side, so `#reattachFunctionStructuralConnections()` can put them back on
     * their new indices after the port list changed.
     *
     * @param kind - Structural node side whose connections are detached.
     * @returns Detached connections with their structural-side index.
     * @private
     */
    #detachFunctionStructuralConnections(
        kind: FunctionPortKind
    ): { index: number; connection: NodeConnection }[] {
        const node = this.getFunctionStructuralNode(kind);
        if (!node) {
            return [];
        }

        const nodeId = node.id;
        const detached: { index: number; connection: NodeConnection }[] = [];

        this.#connections
            .filter((connection) =>
                kind === 'input' ? connection.fromNode === nodeId : connection.toNode === nodeId
            )
            .map(cloneConnection)
            .forEach((connection) => {
                detached.push({
                    index: kind === 'input' ? connection.fromIndex : connection.toIndex,
                    connection,
                });
                this.removeConnection(
                    connection.fromNode,
                    connection.fromIndex,
                    connection.toNode,
                    connection.toIndex
                );
            });

        return detached;
    }

    /**
     * Re-attach previously detached structural-node connections.
     *
     * A connection whose endpoints no longer accept it is dropped with a log entry
     * instead of throwing: port edits run from UI change handlers, so a stale entry
     * must not break the graph.
     *
     * @param kind - Structural node side the connections belong to.
     * @param detached - Connections with the structural-side index to restore.
     * @private
     */
    #reattachFunctionStructuralConnections(
        kind: FunctionPortKind,
        detached: { index: number; connection: NodeConnection }[]
    ): void {
        if (detached.length === 0) {
            return;
        }

        detached.forEach(({ index, connection }) => {
            const next: NodeConnection = {
                fromNode: connection.fromNode,
                fromIndex: kind === 'input' ? index : connection.fromIndex,
                toNode: connection.toNode,
                toIndex: kind === 'output' ? index : connection.toIndex,
            };
            try {
                this.addConnection(next);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn('function-port-connection-dropped', { kind, index, message });
            }
        });
    }

    /**
     * Get the interrupt trigger name used by the `irq` execution mode.
     *
     * The name is case-sensitive and refers to an `interrupt-input` node's
     * trigger name. `''` means the graph has no trigger name yet.
     *
     * @returns {string} Trimmed trigger name, or `''` when unset.
     */
    getTriggerName(): string {
        return this.#triggerName;
    }

    /**
     * Get the signal names this graph watches for its `event` mode.
     * @returns {string[]} A copy of the normalized watched names.
     */
    getSignalNames(): string[] {
        return this.#signalNames.slice();
    }

    /**
     * Get the signal trigger mode used by the `event` mode.
     * @returns {'any'|'all'} The normalized trigger mode.
     */
    getSignalMode(): SignalTriggerMode {
        return this.#signalMode;
    }

    /**
     * Get whether an `event` graph also runs once at startup.
     * @returns {boolean} True when the graph runs once at startup.
     */
    getRunOnStart(): boolean {
        return this.#runOnStart;
    }

    /**
     * Get whether this graph takes part in transpilation.
     * @returns {boolean} True when the graph is transpiled.
     */
    getEnabled(): boolean {
        return this.#enabled;
    }

    /**
     * Replace the viewport configuration.
     * Emits: `viewport`.
     * @param {ViewportConfig} viewportConfig
     * @returns {NodeGraph}
     */
    setViewportConfig(viewportConfig: ViewportConfig): NodeGraph {
        if (!(viewportConfig instanceof ViewportConfig)) {
            throw new TypeError('Viewport must be an instance of ViewportConfig.');
        }
        this.#viewportConfig = viewportConfig.clone();
        this.#emitChange(
            'viewport',
            new NodeGraphViewportChangedPayload(this.#id, this.#viewportConfig.toData())
        );
        return this;
    }

    /**
     * Get the graph loop interval in milliseconds.
     *
     * The value is a cadence period between the start of consecutive loop
     * iterations. `0` is valid and means the loop yields once per iteration.
     *
     * @returns {number} Whole milliseconds inside the supported range.
     */
    getTriggerInterval(): number {
        return this.#triggerIntervalMs;
    }

    /**
     * Get the highlight color.
     * @returns {string}
     */
    getHighlightColor(): string {
        return this.#highlightColor;
    }

    /** @returns {number} Number of nodes in the graph. */
    get nodeCount(): number {
        return (this.#nodes as unknown as { size: number }).size;
    }

    /** @returns {number} Number of connections in the graph. */
    get connectionCount(): number {
        return this.#connections.length;
    }

    /**
     * Get array of all nodes as direct references (not copies).
     * Returns the actual NodeData instances.
     * @returns {Array<NodeData>} Array of node references.
     */
    getNodes(): NodeDataLike[] {
        return this.#nodes.slice();
    }

    /**
     * Get array of node IDs without cloning node data.
     * Much more efficient than getNodes() when only IDs are needed.
     * @returns {Array<string|number>} Array of node IDs.
     */
    getNodeIds(): NodeIdentifier[] {
        return this.#nodes.map((node) => normalizeNodeIdentifier(node.id));
    }

    /** @returns {Array<{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}>} Defensive copy of connections. */
    getConnections(): NodeConnection[] {
        return this.#connections.map(cloneConnection);
    }

    /**
     * List connections touching a given node id.
     * @param {string|number} nodeId
     * @returns {Array<{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}>}
     */
    getConnectionsForNode(nodeId: NodeIdentifier): NodeConnection[] {
        const normalizedNodeId = normalizeNodeIdentifier(nodeId, '');
        return this.#connections
            .filter(
                (conn) => conn.fromNode === normalizedNodeId || conn.toNode === normalizedNodeId
            )
            .map(cloneConnection);
    }

    /**
     * Recompute dynamic connector typing for provided nodes (or all nodes when omitted).
     * Useful after bulk metadata refreshes that replace inputs/outputs.
     * @param {Array<string|number>} [nodeIds]
     */
    recomputeDynamicConnectorTyping(nodeIds: NodeIdentifier[] = []): void {
        const targets =
            Array.isArray(nodeIds) && nodeIds.length > 0
                ? nodeIds.map((nodeId) => normalizeNodeIdentifier(nodeId, '')).filter(Boolean)
                : this.#nodes.map((node) => normalizeNodeIdentifier(node.id, '')).filter(Boolean);

        if (!targets.length) {
            return;
        }

        this.#refreshDynamicConnectorTypingForNodes(targets);
    }

    /**
     * Set the graph name with normalization.
     * Emits: `name`.
     * @param {string} name
     * @returns {NodeGraph}
     */
    setName(name: string): NodeGraph {
        const normalizedName = normalizeName(name);
        if (normalizedName === this.#name) {
            return this;
        }

        this.#name = normalizedName;
        this.#emitChange('name', new NodeGraphNameChangedPayload(this.#id, this.#name));
        return this;
    }

    /**
     * Set graph execution type.
     * Emits: `executionType`.
     * @param {string} executionType
     * @returns {NodeGraph}
     */
    setExecutionType(executionType: string): NodeGraph {
        this.#executionType = normalizeExecutionType(executionType);
        this.#emitChange(
            'executionType',
            new NodeGraphExecutionTypeChangedPayload(this.#id, this.#executionType)
        );
        return this;
    }

    /**
     * Set the palette category of this graph's generated function node.
     *
     * Empty or whitespace-only input falls back to `function`. No event is
     * emitted when the normalized category does not change.
     * Emits: `functionSignature`.
     * @param {string} category - Raw category from the settings view.
     * @returns {NodeGraph}
     */
    setFunctionCategory(category: string): NodeGraph {
        const normalizedCategory = normalizeFunctionCategory(category);
        if (normalizedCategory === this.#functionSignature.category) {
            return this;
        }

        const previousSignature = cloneFunctionSignature(this.#functionSignature);
        this.#functionSignature = {
            ...this.#functionSignature,
            category: normalizedCategory,
        };
        this.#emitChange(
            'functionSignature',
            new NodeGraphFunctionSignatureChangedPayload(
                this.#id,
                cloneFunctionSignature(this.#functionSignature),
                previousSignature
            )
        );
        return this;
    }

    /**
     * Set the header icon of this graph's generated function node.
     *
     * The value stays in its semantic `<set>:<name>` form; blank input falls back to
     * `mdi:function` and foreign icon sets are preserved. No event is emitted when the
     * normalized icon does not change.
     * Emits: `functionSignature`.
     * @param {string} icon - Raw icon from the settings view.
     * @returns {NodeGraph}
     */
    setFunctionIcon(icon: string): NodeGraph {
        const normalizedIcon = normalizeFunctionIcon(icon);
        if (normalizedIcon === this.#functionSignature.icon) {
            return this;
        }

        const previousSignature = cloneFunctionSignature(this.#functionSignature);
        this.#functionSignature = {
            ...this.#functionSignature,
            icon: normalizedIcon,
        };
        this.#emitChange(
            'functionSignature',
            new NodeGraphFunctionSignatureChangedPayload(
                this.#id,
                cloneFunctionSignature(this.#functionSignature),
                previousSignature
            )
        );
        return this;
    }

    /**
     * Set the Markdown description of this graph's generated function node.
     *
     * Inner line breaks are preserved; only surrounding whitespace is trimmed, and
     * blank input removes the description. No event is emitted when the normalized
     * description does not change.
     * Emits: `functionSignature`.
     * @param {string} description - Raw Markdown from the settings view.
     * @returns {NodeGraph}
     */
    setFunctionDescription(description: string): NodeGraph {
        const normalizedDescription = normalizeFunctionDescription(description);
        if (normalizedDescription === (this.#functionSignature.description ?? '')) {
            return this;
        }

        const previousSignature = cloneFunctionSignature(this.#functionSignature);
        const nextSignature: FunctionSignature = { ...this.#functionSignature };
        if (normalizedDescription) {
            nextSignature.description = normalizedDescription;
        } else {
            delete nextSignature.description;
        }
        this.#functionSignature = nextSignature;
        this.#emitChange(
            'functionSignature',
            new NodeGraphFunctionSignatureChangedPayload(
                this.#id,
                cloneFunctionSignature(this.#functionSignature),
                previousSignature
            )
        );
        return this;
    }

    /**
     * Replace the declared inputs or outputs of the function signature.
     *
     * Ports are normalized with `normalizeFunctionPorts()`, which re-derives the
     * index-based ids, trims names, applies the type-union rules and enforces
     * `MAX_FUNCTION_PORTS`. Callers therefore always send the **complete** list in
     * its new order when they insert, move or remove a port; connection repair is
     * their responsibility because only they know which structural node mirrors
     * the list. No event is emitted when the normalized list is unchanged.
     *
     * Callers that moved or removed an existing connector pass `options.indexMapping`
     * so the signature event can tell the cross-graph reconciler where each old
     * index went. Without it the event reports "no connector moved" and placed call
     * nodes keep their wiring positionally — correct for append/rename/type edits
     * and for edits made through {@link moveFunctionPort}/{@link removeFunctionPort},
     * which build the mapping themselves.
     *
     * Emits: `functionSignature`.
     * @param {'input'|'output'} kind - Which port list to replace.
     * @param {Array<object>} ports - Complete new port list.
     * @param {object} [options] - Optional edit metadata.
     * @param {object|null} [options.indexMapping] - Old→new index mapping of this list.
     * @returns {NodeGraph}
     */
    setFunctionPorts(
        kind: FunctionPortKind,
        ports: unknown,
        { indexMapping = null }: { indexMapping?: FunctionPortIndexMapping | null } = {}
    ): NodeGraph {
        const normalizedKind: FunctionPortKind = kind === 'output' ? 'output' : 'input';
        const normalizedPorts = normalizeFunctionPorts(ports, normalizedKind);
        const nextSignature: FunctionSignature = {
            category: this.#functionSignature.category,
            icon: this.#functionSignature.icon,
            inputs: normalizedKind === 'input' ? normalizedPorts : this.#functionSignature.inputs,
            outputs:
                normalizedKind === 'output' ? normalizedPorts : this.#functionSignature.outputs,
        };
        if (this.#functionSignature.description) {
            nextSignature.description = this.#functionSignature.description;
        }
        if (functionSignaturesEqual(nextSignature, this.#functionSignature)) {
            return this;
        }

        const previousSignature = cloneFunctionSignature(this.#functionSignature);
        this.#functionSignature = nextSignature;
        this.syncFunctionStructuralNodes();
        this.#emitChange(
            'functionSignature',
            new NodeGraphFunctionSignatureChangedPayload(
                this.#id,
                cloneFunctionSignature(nextSignature),
                previousSignature,
                indexMapping?.kind === normalizedKind ? indexMapping : null
            )
        );
        return this;
    }

    /**
     * Set the graph's interrupt trigger name with normalization.
     *
     * Surrounding whitespace is trimmed; the remaining text is stored as given
     * (case-sensitive, inner spaces preserved). No event is emitted when the
     * normalized value does not change.
     * Emits: `triggerName`.
     * @param {string} name - Raw trigger name from the settings surfaces.
     * @returns {NodeGraph}
     */
    setTriggerName(name: string): NodeGraph {
        const normalizedName = normalizeTriggerName(name);
        if (normalizedName === this.#triggerName) {
            return this;
        }

        this.#triggerName = normalizedName;
        this.#emitChange(
            'triggerName',
            new NodeGraphTriggerNameChangedPayload(this.#id, this.#triggerName)
        );
        return this;
    }

    /**
     * Set the signal names an `event` graph watches.
     *
     * Names are normalized with `normalizeSignalNames()` (arrays only, trimmed,
     * deduplicated, truncated). No event is emitted when the list is unchanged.
     * Emits: `signalTrigger`.
     * @param {unknown} names - Raw watched-name list.
     * @returns {NodeGraph}
     */
    setSignalNames(names: unknown): NodeGraph {
        const normalized = normalizeSignalNames(names);
        const unchanged =
            this.#signalNames.length === normalized.length &&
            this.#signalNames.every((name, index) => name === normalized[index]);
        if (unchanged) {
            return this;
        }

        this.#signalNames = normalized;
        this.#emitChange(
            'signalTrigger',
            new NodeGraphSignalTriggerChangedPayload(
                this.#id,
                this.#signalNames.slice(),
                this.#signalMode,
                this.#runOnStart
            )
        );
        return this;
    }

    /**
     * Set the signal trigger mode of an `event` graph.
     *
     * Only `'all'` (case-insensitive, trimmed) selects `'all'`; anything else
     * becomes `'any'`. No event is emitted when unchanged.
     * Emits: `signalTrigger`.
     * @param {unknown} mode - Raw trigger mode.
     * @returns {NodeGraph}
     */
    setSignalMode(mode: unknown): NodeGraph {
        const normalized = normalizeSignalMode(mode);
        if (normalized === this.#signalMode) {
            return this;
        }

        this.#signalMode = normalized;
        this.#emitChange(
            'signalTrigger',
            new NodeGraphSignalTriggerChangedPayload(
                this.#id,
                this.#signalNames.slice(),
                this.#signalMode,
                this.#runOnStart
            )
        );
        return this;
    }

    /**
     * Set whether an `event` graph also runs once at startup.
     *
     * Only the literal `false` (or its string form) disables the run; anything
     * else keeps it enabled. No event is emitted when unchanged.
     * Emits: `signalTrigger`.
     * @param {unknown} flag - Raw run-on-start flag.
     * @returns {NodeGraph}
     */
    setRunOnStart(flag: unknown): NodeGraph {
        const normalized = normalizeRunOnStart(flag);
        if (normalized === this.#runOnStart) {
            return this;
        }

        this.#runOnStart = normalized;
        this.#emitChange(
            'signalTrigger',
            new NodeGraphSignalTriggerChangedPayload(
                this.#id,
                this.#signalNames.slice(),
                this.#signalMode,
                this.#runOnStart
            )
        );
        return this;
    }

    /**
     * Set whether this graph takes part in transpilation.
     *
     * The value is normalized with `normalizeGraphEnabled()`, so only the literal
     * `false` (or its string form) disables the graph. No event is emitted when the
     * normalized value does not change.
     * Emits: `enabled`.
     * @param {boolean|string} enabled - Raw enabled flag.
     * @returns {NodeGraph}
     */
    setEnabled(enabled: boolean | string): NodeGraph {
        const normalized = normalizeGraphEnabled(enabled);
        if (normalized === this.#enabled) {
            return this;
        }
        this.#enabled = normalized;
        this.#emitChange('enabled', new NodeGraphEnabledChangedPayload(this.#id, this.#enabled));
        return this;
    }

    /**
     * Set the graph loop interval in milliseconds, normalized into the supported
     * range. The value is a cadence period between iteration starts; `0` is valid
     * and means a yield-only cadence. Emits `interval` on every call — the views,
     * not the model, suppress redundant writes.
     * @param {number} ms
     * @returns {NodeGraph}
     */
    setTriggerInterval(ms: number): NodeGraph {
        this.#triggerIntervalMs = normalizeInterval(ms);
        this.#emitChange(
            'interval',
            new NodeGraphIntervalChangedPayload(this.#id, this.#triggerIntervalMs)
        );
        return this;
    }

    /**
     * Set the highlight color.
     * Emits: `color`.
     * @param {string} color
     * @returns {NodeGraph}
     */
    setHighlightColor(color: string): NodeGraph {
        this.#highlightColor = normalizeColor(color);
        this.#emitChange('color', new NodeGraphColorChangedPayload(this.#id, this.#highlightColor));
        return this;
    }

    /**
     * Check whether a node with the given id exists.
     * @param {string|number} id
     * @returns {boolean}
     */
    hasNode(id: NodeIdentifier): boolean {
        const normalizedId = normalizeNodeIdentifier(id, '');
        return this.#nodes.some((node) => node && node.id === normalizedId);
    }

    /**
     * Get a direct reference to a node by id.
     * Returns the actual NodeData instance, not a clone.
     * @param {string|number} id
     * @returns {NodeData|null}
     */
    getNode(id: NodeIdentifier): NodeDataLike | null {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const match = this.#nodes.find((node) => node && node.id === normalizedId);
        return match ? match : null;
    }

    /**
     * Get every documentation area of this graph as serialized data.
     *
     * The array and every `bounds` object are copies: renderers may cache or mutate them
     * without touching the graph.
     * @returns {DocumentationAreaData[]} Detached area data in paint order.
     */
    getDocumentationAreas(): DocumentationAreaData[] {
        return this.#documentationAreas.map((area) => area.toData());
    }

    /**
     * Get a direct reference to a documentation area by id.
     * Returns the actual DocumentationArea instance, not a clone.
     * @param {string} id
     * @returns {DocumentationArea|null}
     */
    getDocumentationArea(id: string): DocumentationArea | null {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const match = this.#documentationAreas.find((area) => area.id === normalizedId);
        return match ? match : null;
    }

    /**
     * Get the array index of a documentation area.
     * @param {string} id
     * @returns {number} Index, or -1 when the area does not exist.
     */
    getDocumentationAreaIndex(id: string): number {
        const normalizedId = normalizeNodeIdentifier(id, '');
        return this.#documentationAreas.findIndex((area) => area.id === normalizedId);
    }

    /**
     * Check whether a documentation area with the given id exists.
     * @param {string} id
     * @returns {boolean}
     */
    hasDocumentationArea(id: string): boolean {
        return this.getDocumentationAreaIndex(id) !== -1;
    }

    /**
     * Reserve the next documentation-area id without creating an area.
     * @returns {string} Next identifier as a numeric string.
     */
    getNextDocumentationAreaId(): string {
        this.#maxDocumentationAreaId += 1;
        return String(this.#maxDocumentationAreaId);
    }

    /**
     * Append a documentation area, assigning the next id.
     * The caller's object is never mutated.
     * Emits: `documentation-area-added`.
     * @param {Partial<DocumentationAreaData>} data
     * @returns {DocumentationArea} Added area instance.
     */
    addDocumentationArea(data: Partial<DocumentationAreaData> = {}): DocumentationArea {
        const cloned = cloneDocumentationArea(data);
        cloned.setId(this.getNextDocumentationAreaId());
        this.#documentationAreas.push(cloned);
        this.#emitChange(
            'documentation-area-added',
            new NodeGraphDocumentationAreaAddedPayload(this.#id, cloned.id)
        );
        return cloned;
    }

    /**
     * Restore a documentation area while preserving its original id, optionally at a
     * specific index (used by undo of a delete).
     * Emits: `documentation-area-added`.
     * @param {DocumentationAreaData|object} data
     * @param {number} [index] - Insert position, clamped to `[0, length]`.
     * @returns {DocumentationArea} Restored area instance.
     */
    restoreDocumentationArea(
        data: DocumentationAreaData | Record<string, unknown>,
        index?: number
    ): DocumentationArea {
        const cloned = cloneDocumentationArea(data);

        if (!cloned.id) {
            throw new TypeError('Restored documentation area must include a valid id.');
        }
        if (this.hasDocumentationArea(cloned.id)) {
            throw new Error(`Documentation area with id '${cloned.id}' already exists.`);
        }

        const length = this.#documentationAreas.length;
        const position =
            typeof index === 'number' && Number.isFinite(index)
                ? Math.min(Math.max(Math.trunc(index), 0), length)
                : length;

        this.#documentationAreas.splice(position, 0, cloned);
        this.#maxDocumentationAreaId = Math.max(
            this.#maxDocumentationAreaId,
            nodeIdentifierSeed(cloned.id)
        );

        this.#emitChange(
            'documentation-area-added',
            new NodeGraphDocumentationAreaAddedPayload(this.#id, cloned.id)
        );
        return cloned;
    }

    /**
     * Patch a documentation area's editable fields.
     *
     * Only `title`, `markdown`, `color`, `contentAlign` and `fontSize` are patchable; the colour is
     * normalized before it is stored, so `rgba(...)` or a colour name can never enter the data.
     * Nothing is emitted when no field actually changes.
     * Emits: `documentation-area-updated`.
     * @param {string} id
     * @param {DocumentationAreaPatch} patch
     * @returns {DocumentationArea|null} The updated area, or null when it does not exist.
     */
    updateDocumentationArea(
        id: string,
        patch: DocumentationAreaPatch = {}
    ): DocumentationArea | null {
        const area = this.getDocumentationArea(id);
        if (!area) {
            return null;
        }

        const applied: Record<string, unknown> = {};
        const previous: Record<string, unknown> = {};

        if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
            const title = typeof patch.title === 'string' ? patch.title : '';
            if (title !== area.title) {
                previous.title = area.title;
                applied.title = title;
                area.setTitle(title);
            }
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'markdown')) {
            const markdown = typeof patch.markdown === 'string' ? patch.markdown : '';
            if (markdown !== area.markdown) {
                previous.markdown = area.markdown;
                applied.markdown = markdown;
                area.setMarkdown(markdown);
            }
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'color')) {
            const color = normalizeAreaColor(patch.color);
            if (color !== area.color) {
                previous.color = area.color;
                applied.color = color;
                area.setColor(color);
            }
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'contentAlign')) {
            const contentAlign = normalizeAreaContentAlign(patch.contentAlign);
            if (contentAlign !== area.contentAlign) {
                previous.contentAlign = area.contentAlign;
                applied.contentAlign = contentAlign;
                area.setContentAlign(contentAlign);
            }
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'fontSize')) {
            const fontSize = normalizeAreaFontSize(patch.fontSize);
            if (fontSize !== area.fontSize) {
                previous.fontSize = area.fontSize;
                applied.fontSize = fontSize;
                area.setFontSize(fontSize);
            }
        }

        if (Object.keys(applied).length === 0) {
            return area;
        }

        this.#emitChange(
            'documentation-area-updated',
            new NodeGraphDocumentationAreaUpdatedPayload(this.#id, area.id, applied, previous)
        );
        return area;
    }

    /**
     * Set the bounds of a documentation area.
     *
     * Bounds are normalized and clamped to the minimum size first; nothing is emitted when
     * the normalized result equals the current bounds, which is what lets the history
     * manager skip no-op gestures.
     * Emits: `documentation-area-bounds-changed`.
     * @param {string} id
     * @param {unknown} bounds
     * @returns {DocumentationArea|null} The updated area, or null when it does not exist.
     */
    setDocumentationAreaBounds(id: string, bounds: unknown): DocumentationArea | null {
        const area = this.getDocumentationArea(id);
        if (!area) {
            return null;
        }

        const previousBounds = area.toData().bounds;
        const nextBounds = normalizeAreaBounds(bounds);

        if (areaBoundsEqual(previousBounds, nextBounds)) {
            return area;
        }

        area.setBounds(nextBounds);
        this.#emitChange(
            'documentation-area-bounds-changed',
            new NodeGraphDocumentationAreaBoundsChangedPayload(
                this.#id,
                area.id,
                { ...nextBounds },
                previousBounds
            )
        );
        return area;
    }

    /**
     * Remove a documentation area. Nodes and connections are untouched.
     * Emits: `documentation-area-removed`.
     * @param {string} id
     * @returns {boolean} True when an area was removed.
     */
    removeDocumentationArea(id: string): boolean {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const index = this.#documentationAreas.findIndex((area) => area.id === normalizedId);
        if (index === -1) {
            return false;
        }

        this.#documentationAreas.splice(index, 1);
        this.#emitChange(
            'documentation-area-removed',
            new NodeGraphDocumentationAreaRemovedPayload(this.#id, normalizedId)
        );
        return true;
    }

    /**
     * Mark the beginning of a move/resize gesture on a documentation area.
     * The geometry is unchanged: the history manager caches the start bounds here.
     * Emits: `documentation-area-drag-started`.
     * @param {string} id
     * @param {DocumentationAreaDragMode} [mode='move']
     * @returns {boolean} True when the gesture was announced.
     */
    startDocumentationAreaDrag(id: string, mode: DocumentationAreaDragMode = 'move'): boolean {
        const area = this.getDocumentationArea(id);
        if (!area) {
            return false;
        }

        this.#emitChange(
            'documentation-area-drag-started',
            new NodeGraphDocumentationAreaDragStartedPayload(
                this.#id,
                area.id,
                mode === 'resize' ? 'resize' : 'move'
            )
        );
        return true;
    }

    /**
     * Mark the end of a move/resize gesture on a documentation area.
     * Emits: `documentation-area-drag-ended`.
     * @param {string} id
     * @returns {boolean} True when the gesture end was announced.
     */
    endDocumentationAreaDrag(id: string): boolean {
        const area = this.getDocumentationArea(id);
        if (!area) {
            return false;
        }

        this.#emitChange(
            'documentation-area-drag-ended',
            new NodeGraphDocumentationAreaDragEndedPayload(this.#id, area.id)
        );
        return true;
    }

    /**
     * Append a node to the graph, updating the counter.
     * Emits: `node-added`.
     * @param {object} node
     * @returns {object} Added node clone.
     */
    addNode(node: NodeData | Record<string, unknown>): NodeDataLike {
        const cloned = cloneNode(node);
        cloned.setId(this.getNextNodeId());
        this.#nodes.push(cloned);
        this.#refreshDynamicConnectorTypingForNodes([cloned.id]);
        this.#emitChange('node-added', new NodeGraphNodeAddedPayload(this.#id, cloned.id));
        return cloned;
    }

    /**
     * Restore a node while preserving its original ID.
     * Emits: `node-added`.
     * @param {object|NodeData} node
     * @returns {object} Restored node clone.
     */
    restoreNode(node: NodeData | Record<string, unknown>): NodeDataLike {
        const cloned = cloneNode(node);
        const restoredId = normalizeNodeIdentifier(cloned.id, '');

        if (!isValidNodeIdentifier(restoredId)) {
            throw new TypeError('Restored node must include a valid id.');
        }
        if (this.hasNode(restoredId)) {
            throw new Error(`Node with id '${restoredId}' already exists.`);
        }

        cloned.setId(restoredId);

        this.#nodes.push(cloned);
        this.#refreshDynamicConnectorTypingForNodes([restoredId]);

        this.#maxNodeId = Math.max(this.#maxNodeId, nodeIdentifierSeed(restoredId));

        this.#emitChange('node-added', new NodeGraphNodeAddedPayload(this.#id, restoredId));
        return cloned;
    }

    /**
     * Patch an existing node by updating its properties in place.
     * Emits: `node-updated` when a node is found.
     * @param {string|number} id
     * @param {object} [updates]
     * @param {object|null} [explicitPrevious] - Optional explicit pre-mutation snapshot of the
     *   fields being updated. When provided, overrides the auto-snapshot so callers that mutate
     *   data before calling updateNode() can still supply the correct previous state.
     * @returns {NodeData|null}
     */
    updateNode(
        id: NodeIdentifier,
        updates: Record<string, any> = {},
        explicitPrevious: Record<string, unknown> | null = null
    ): NodeDataLike | null {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const idx = this.#nodes.findIndex((node) => node && node.id === normalizedId);
        if (idx === -1) {
            return null;
        }
        const node = this.#nodes[idx];

        const previous: Record<string, unknown> = explicitPrevious ?? {};
        if (!explicitPrevious) {
            Object.keys(updates).forEach((key) => {
                if (key !== 'id') {
                    if (key === 'userNameByLocale') {
                        previous.userName =
                            node.userName !== null && typeof node.userName === 'object'
                                ? { ...node.userName }
                                : node.userName;
                        previous.title = node.title;
                        return;
                    }

                    previous[key] =
                        node[key] !== null && typeof node[key] === 'object'
                            ? { ...node[key] }
                            : node[key];
                }
            });
        }

        const normalizedPatch: Record<string, unknown> = {};

        Object.keys(updates).forEach((key) => {
            if (key === 'id') {
                return;
            }

            if (key === 'title' && typeof node.setTitle === 'function') {
                node.setTitle(updates[key]);
                normalizedPatch.title = node.title;
                normalizedPatch.userName = node.userName;
                return;
            }

            if (key === 'userNameByLocale' && typeof node.setUserNameForLocale === 'function') {
                const descriptor = updates[key] as UserNameByLocaleDescriptor | null | undefined;
                const locale = typeof descriptor?.locale === 'string' ? descriptor.locale : 'en';
                const value = typeof descriptor?.value === 'string' ? descriptor.value : null;

                node.setUserNameForLocale(locale, value);
                normalizedPatch.userNameByLocale = {
                    locale,
                    value: node.getUserNameForLocale ? node.getUserNameForLocale(locale) : null,
                };
                normalizedPatch.userName = node.userName;
                normalizedPatch.title = node.title;
                return;
            }

            if (key === 'userName' && typeof node.setUserName === 'function') {
                node.setUserName(updates[key]);
                normalizedPatch.userName = node.userName;
                normalizedPatch.title = node.title;
                return;
            }

            if (key === 'typeName' && typeof node.setTypeName === 'function') {
                node.setTypeName(updates[key]);
                normalizedPatch.typeName =
                    node.typeName && typeof node.typeName === 'object'
                        ? { ...node.typeName }
                        : node.typeName;
                normalizedPatch.title = node.title;
                return;
            }

            node[key] = updates[key];
            normalizedPatch[key] =
                node[key] !== null && typeof node[key] === 'object' ? { ...node[key] } : node[key];
        });

        this.#emitChange(
            'node-updated',
            new NodeGraphNodeUpdatedPayload(this.#id, normalizedId, normalizedPatch, previous)
        );

        const shouldRefreshDynamicTyping =
            Object.prototype.hasOwnProperty.call(normalizedPatch, 'controlValues') ||
            Object.prototype.hasOwnProperty.call(normalizedPatch, 'controls') ||
            Object.prototype.hasOwnProperty.call(normalizedPatch, 'inputs') ||
            Object.prototype.hasOwnProperty.call(normalizedPatch, 'outputs');
        if (shouldRefreshDynamicTyping) {
            this.#refreshDynamicConnectorTypingForNodes([normalizedId]);
        }

        return node;
    }

    updateNodePosition(id: NodeIdentifier, x: number, y: number): NodeDataLike | null {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const idx = this.#nodes.findIndex((node) => node && node.id === normalizedId);
        if (idx === -1) {
            return null;
        }
        const node = this.#nodes[idx];
        node.setPosition(x, y);
        this.#emitChange(
            'node-pos-changed',
            new NodeGraphNodePositionChangedPayload(this.#id, normalizedId, node.x, node.y)
        );
        return this.#nodes[idx];
    }

    startNodeDrag(id: NodeIdentifier): NodeDataLike | null {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const idx = this.#nodes.findIndex((node) => node && node.id === normalizedId);
        if (idx === -1) {
            return null;
        }
        this.#emitChange(
            'node-drag-started',
            new NodeGraphNodeDragStartedPayload(this.#id, normalizedId)
        );
        return this.#nodes[idx];
    }

    endNodeDrag(id: NodeIdentifier): NodeDataLike | null {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const idx = this.#nodes.findIndex((node) => node && node.id === normalizedId);
        if (idx === -1) {
            return null;
        }
        this.#emitChange(
            'node-drag-ended',
            new NodeGraphNodeDragEndedPayload(this.#id, normalizedId)
        );
        return this.#nodes[idx];
    }

    /**
     * Remove a node and any attached connections.
     * Emits: `node-removed` when removed.
     * @param {string|number} id
     * @returns {boolean} True if a node was removed.
     */
    removeNode(id: NodeIdentifier): boolean {
        const normalizedId = normalizeNodeIdentifier(id, '');
        const beforeLength = this.#nodes.length;
        this.#nodes = this.#nodes.filter((node) => !(node && node.id === normalizedId));
        const removed = beforeLength !== this.#nodes.length;
        if (removed) {
            const removedConnections = this.#connections.filter(
                (conn) => conn.fromNode === normalizedId || conn.toNode === normalizedId
            );
            const beforeConn = this.#connections.length;
            this.#connections = this.#connections.filter(
                (conn) => conn.fromNode !== normalizedId && conn.toNode !== normalizedId
            );
            const removedConnectionCount = beforeConn - this.#connections.length;
            this.#emitChange(
                'node-removed',
                new NodeGraphNodeRemovedPayload(this.#id, normalizedId, removedConnectionCount)
            );

            const impactedNodeIds = removedConnections
                .filter((conn) => conn.toNode !== normalizedId)
                .map((conn) => conn.toNode);
            this.#refreshDynamicConnectorTypingForNodes(impactedNodeIds);
        }
        return removed;
    }

    #refreshDynamicConnectorTypingForNodes(nodeIds: NodeIdentifier[]): void {
        const uniqueNodeIds = Array.from(
            new Set(nodeIds.map((nodeId) => normalizeNodeIdentifier(nodeId, '')).filter(Boolean))
        );

        uniqueNodeIds.forEach((nodeId) => {
            this.#refreshDynamicConnectorTypingForNode(nodeId);
        });
    }

    #refreshDynamicConnectorTypingForNode(nodeId: NodeIdentifier): void {
        const normalizedNodeId = normalizeNodeIdentifier(nodeId, '');
        const node = this.getNode(normalizedNodeId);
        if (!node) {
            return;
        }

        const previousInputs = cloneNodeInputsForPatch(node.inputs);
        const previousOutputs = cloneNodeOutputsForPatch(node.outputs);
        let hasConnectorTypeChange = this.#resetConnectorTypesFromInitialTypes(node);
        if (this.#applyDropdownOptionConnectorTypes(node)) {
            hasConnectorTypeChange = true;
        }

        if (!Array.isArray(node.inputs) || node.inputs.length === 0) {
            if (hasConnectorTypeChange) {
                const patch = {
                    outputs: cloneNodeOutputsForPatch(node.outputs),
                };
                const previous = {
                    outputs: previousOutputs,
                };
                this.#emitChange(
                    'node-updated',
                    new NodeGraphNodeUpdatedPayload(this.#id, normalizedNodeId, patch, previous)
                );
            }

            this.#pruneInvalidIncomingConnectionsForNode(normalizedNodeId);
            this.#pruneInvalidOutgoingConnectionsForNode(normalizedNodeId);
            return;
        }

        let hasDynamicInputChange = false;

        node.inputs.forEach((input, inputIndex) => {
            if (!input || typeof input !== 'object') {
                return;
            }

            const typedInput = input as Record<string, unknown>;
            const allowedTypes = typedInput.allowedTypes;
            if (!Array.isArray(allowedTypes) || !allowedTypes.includes('unknown')) {
                return;
            }

            const sourceConnection = this.#connections.find(
                (conn) => conn.toNode === normalizedNodeId && conn.toIndex === inputIndex
            );

            let nextPrimaryType = 'any';
            if (sourceConnection) {
                const sourceNode = this.getNode(sourceConnection.fromNode);
                if (sourceNode && Array.isArray(sourceNode.outputs)) {
                    const outputDef = sourceNode.outputs[sourceConnection.fromIndex] as
                        | Record<string, unknown>
                        | undefined;
                    const outputId = typeof outputDef?.id === 'string' ? outputDef.id : '';
                    if (outputId) {
                        try {
                            const resolvedType = sourceNode.getOutputType(outputId);
                            if (typeof resolvedType === 'string' && resolvedType.trim()) {
                                nextPrimaryType = resolvedType;
                            }
                        } catch {
                            // Best effort: keep the previous primary type when type resolution fails.
                        }
                    }
                }
            }

            if (allowedTypes[0] !== nextPrimaryType) {
                typedInput.allowedTypes = [nextPrimaryType, ...allowedTypes.slice(1)];
                hasDynamicInputChange = true;
            }
        });

        const nextInputs = cloneNodeInputsForPatch(node.inputs);
        const nextOutputs = cloneNodeOutputsForPatch(node.outputs);
        const inputsChanged = JSON.stringify(previousInputs) !== JSON.stringify(nextInputs);
        const outputsChanged = JSON.stringify(previousOutputs) !== JSON.stringify(nextOutputs);
        if (hasConnectorTypeChange || hasDynamicInputChange || inputsChanged || outputsChanged) {
            const patch: Record<string, unknown> = {};
            const previous: Record<string, unknown> = {};
            if (inputsChanged || hasDynamicInputChange || hasConnectorTypeChange) {
                patch.inputs = nextInputs;
                previous.inputs = previousInputs;
            }
            if (outputsChanged || hasConnectorTypeChange) {
                patch.outputs = nextOutputs;
                previous.outputs = previousOutputs;
            }

            this.#emitChange(
                'node-updated',
                new NodeGraphNodeUpdatedPayload(this.#id, normalizedNodeId, patch, previous)
            );
        }

        this.#pruneInvalidIncomingConnectionsForNode(normalizedNodeId);
        this.#pruneInvalidOutgoingConnectionsForNode(normalizedNodeId);
    }

    /**
     * Reapply connector types declared through `initialTypes`.
     *
     * Static connectors must stay in sync with the current runtime definition. Union
     * outputs (`typeInputSources`) are the exception: their `outputType` is the declared
     * representative type and must not be replaced by `initialTypes[0]`, otherwise a
     * `select` output turns into `bool` even though it carries the union of its inputs.
     *
     * Called by `#refreshDynamicConnectorTypingForNode` after a node is added, restored,
     * or patched with a new definition.
     *
     * @param node - Node whose connector metadata should be refreshed.
     * @returns True when at least one connector field changed.
     */
    #resetConnectorTypesFromInitialTypes(node: NodeDataLike): boolean {
        let hasChanges = false;

        if (Array.isArray(node.inputs)) {
            node.inputs.forEach((input) => {
                if (!input || typeof input !== 'object') {
                    return;
                }

                const typedInput = input as Record<string, unknown>;
                const nextAllowedTypes = normalizeTypeList(typedInput.initialTypes);
                if (!nextAllowedTypes.length) {
                    return;
                }

                const currentAllowedTypes = normalizeTypeList(typedInput.allowedTypes);
                if (!arrayEquals(currentAllowedTypes, nextAllowedTypes)) {
                    typedInput.allowedTypes = [...nextAllowedTypes];
                    hasChanges = true;
                }
            });
        }

        if (Array.isArray(node.outputs)) {
            node.outputs.forEach((output) => {
                if (!output || typeof output !== 'object') {
                    return;
                }

                const typedOutput = output as Record<string, unknown>;
                if (resolveDeclaredInputSources(typedOutput).length > 0) {
                    // Union outputs resolve from their sources; keep the declared
                    // representative outputType instead of adopting initialTypes[0].
                    return;
                }

                const nextOutputTypes = normalizeTypeList(typedOutput.initialTypes);
                if (!nextOutputTypes.length) {
                    return;
                }

                const currentOutputTypes = normalizeTypeList(typedOutput.allowedTypes);
                if (!arrayEquals(currentOutputTypes, nextOutputTypes)) {
                    typedOutput.allowedTypes = [...nextOutputTypes];
                    hasChanges = true;
                }

                const nextPrimaryType = nextOutputTypes[0];
                const currentPrimaryType =
                    typeof typedOutput.outputType === 'string' ? typedOutput.outputType.trim() : '';
                if (nextPrimaryType && currentPrimaryType !== nextPrimaryType) {
                    typedOutput.outputType = nextPrimaryType;
                    hasChanges = true;
                }
            });
        }

        return hasChanges;
    }

    #applyDropdownOptionConnectorTypes(node: NodeDataLike): boolean {
        if (!Array.isArray(node.controls) || node.controls.length === 0) {
            return false;
        }

        let hasChanges = false;
        const controlValues =
            node.controlValues && typeof node.controlValues === 'object' ? node.controlValues : {};
        const hiddenControlIds = resolveHiddenControlIds(node);

        node.controls.forEach((control) => {
            if (!control || typeof control !== 'object') {
                return;
            }

            const typedControl = control as Record<string, unknown>;
            if (typedControl.type !== 'dropdown' || !Array.isArray(typedControl.options)) {
                return;
            }

            const controlId = typeof typedControl.id === 'string' ? typedControl.id : '';
            // A hidden dropdown must not retype connectors: `getVisibleControls()` hides its
            // row, so its option overrides would act on a control the user cannot see.
            if (controlId && hiddenControlIds.has(controlId)) {
                return;
            }

            const selectedValue =
                controlId && Object.prototype.hasOwnProperty.call(controlValues, controlId)
                    ? controlValues[controlId]
                    : typedControl.default;

            const selectedOption = (typedControl.options as Record<string, unknown>[]).find(
                (option) => {
                    const optionValue = option?.value;
                    return (
                        optionValue === selectedValue ||
                        String(optionValue) === String(selectedValue)
                    );
                }
            );
            if (!selectedOption || typeof selectedOption !== 'object') {
                return;
            }

            if (this.#applyInputTypeOverrides(node, selectedOption.inputTypes)) {
                hasChanges = true;
            }
            if (this.#applyOutputTypeOverrides(node, selectedOption.outputTypes)) {
                hasChanges = true;
            }
        });

        return hasChanges;
    }

    #applyInputTypeOverrides(node: NodeDataLike, inputTypesMap: unknown): boolean {
        if (!Array.isArray(node.inputs) || !inputTypesMap || typeof inputTypesMap !== 'object') {
            return false;
        }

        let hasChanges = false;
        const overrides = inputTypesMap as Record<string, unknown>;
        node.inputs.forEach((input) => {
            if (!input || typeof input !== 'object') {
                return;
            }

            const typedInput = input as Record<string, unknown>;
            const inputId = typeof typedInput.id === 'string' ? typedInput.id : '';
            if (!inputId || !Object.prototype.hasOwnProperty.call(overrides, inputId)) {
                return;
            }

            const nextAllowedTypes = normalizeTypeList(overrides[inputId]);
            if (!nextAllowedTypes.length) {
                return;
            }

            const currentAllowedTypes = normalizeTypeList(typedInput.allowedTypes);
            if (!arrayEquals(currentAllowedTypes, nextAllowedTypes)) {
                typedInput.allowedTypes = [...nextAllowedTypes];
                hasChanges = true;
            }
        });

        return hasChanges;
    }

    #applyOutputTypeOverrides(node: NodeDataLike, outputTypesMap: unknown): boolean {
        if (!Array.isArray(node.outputs) || !outputTypesMap || typeof outputTypesMap !== 'object') {
            return false;
        }

        let hasChanges = false;
        const overrides = outputTypesMap as Record<string, unknown>;
        node.outputs.forEach((output) => {
            if (!output || typeof output !== 'object') {
                return;
            }

            const typedOutput = output as Record<string, unknown>;
            const outputId = typeof typedOutput.id === 'string' ? typedOutput.id : '';
            if (!outputId || !Object.prototype.hasOwnProperty.call(overrides, outputId)) {
                return;
            }

            const nextOutputTypes = normalizeTypeList(overrides[outputId]);
            if (!nextOutputTypes.length) {
                return;
            }

            const currentOutputTypes = normalizeTypeList(typedOutput.allowedTypes);
            if (!arrayEquals(currentOutputTypes, nextOutputTypes)) {
                typedOutput.allowedTypes = [...nextOutputTypes];
                hasChanges = true;
            }

            const nextPrimaryType = nextOutputTypes[0];
            const currentPrimaryType =
                typeof typedOutput.outputType === 'string' ? typedOutput.outputType.trim() : '';
            if (nextPrimaryType && currentPrimaryType !== nextPrimaryType) {
                typedOutput.outputType = nextPrimaryType;
                hasChanges = true;
            }
        });

        return hasChanges;
    }

    #pruneInvalidIncomingConnectionsForNode(nodeId: NodeIdentifier): void {
        const normalizedNodeId = normalizeNodeIdentifier(nodeId, '');
        const incomingConnections = this.#connections.filter(
            (conn) => conn.toNode === normalizedNodeId
        );

        if (!incomingConnections.length) {
            return;
        }

        incomingConnections.forEach((connection) => {
            const validation = this.canConnect(
                connection.fromNode,
                connection.fromIndex,
                connection.toNode,
                connection.toIndex,
                { allowExistingConnectionMatch: true }
            );

            if (validation.valid) {
                return;
            }

            this.removeConnection(
                connection.fromNode,
                connection.fromIndex,
                connection.toNode,
                connection.toIndex
            );
        });
    }

    #pruneInvalidOutgoingConnectionsForNode(nodeId: NodeIdentifier): void {
        const normalizedNodeId = normalizeNodeIdentifier(nodeId, '');
        const outgoingConnections = this.#connections.filter(
            (conn) => conn.fromNode === normalizedNodeId
        );

        if (!outgoingConnections.length) {
            return;
        }

        const impactedTargetNodes: NodeIdentifier[] = [];
        outgoingConnections.forEach((connection) => {
            const validation = this.canConnect(
                connection.fromNode,
                connection.fromIndex,
                connection.toNode,
                connection.toIndex,
                { allowExistingConnectionMatch: true }
            );

            if (validation.valid) {
                return;
            }

            const removed = this.removeConnection(
                connection.fromNode,
                connection.fromIndex,
                connection.toNode,
                connection.toIndex
            );
            if (removed) {
                impactedTargetNodes.push(connection.toNode);
            }
        });

        if (impactedTargetNodes.length > 0) {
            this.#refreshDynamicConnectorTypingForNodes(impactedTargetNodes);
        }
    }

    /**
     * Validate if a connection can be created between two connectors.
     * Checks data type compatibility.
     *
     * @param {string|number} fromNodeId - Source node ID
     * @param {number} fromIndex - Source output index
     * @param {string|number} toNodeId - Target node ID
     * @param {number} toIndex - Target input index
     * @param {{allowExistingConnectionMatch?: boolean}} [options]
     * @returns {{valid: boolean, message?: string}} Validation result
     */
    canConnect(
        fromNodeId: NodeIdentifier,
        fromIndex: number,
        toNodeId: NodeIdentifier,
        toIndex: number,
        options: CanConnectOptions = {}
    ): ConnectionValidationResult {
        const normalizedFromNodeId = normalizeNodeIdentifier(fromNodeId, '');
        const normalizedToNodeId = normalizeNodeIdentifier(toNodeId, '');
        const sourceNode = this.getNode(normalizedFromNodeId);
        const targetNode = this.getNode(normalizedToNodeId);
        const allowExistingConnectionMatch = options.allowExistingConnectionMatch === true;
        const skipCardinalityChecks = options.skipCardinalityChecks === true;

        const excludedConnectionKeys = new Set<string>();
        if (Array.isArray(options.excludeConnections)) {
            for (const excluded of options.excludeConnections) {
                if (!excluded) {
                    continue;
                }
                excludedConnectionKeys.add(
                    `${normalizeNodeIdentifier(excluded.fromNode, '')}|${excluded.fromIndex}|` +
                        `${normalizeNodeIdentifier(excluded.toNode, '')}|${excluded.toIndex}`
                );
            }
        }
        const isExcludedConnection = (conn: NodeConnection): boolean =>
            excludedConnectionKeys.size > 0 &&
            excludedConnectionKeys.has(
                `${conn.fromNode}|${conn.fromIndex}|${conn.toNode}|${conn.toIndex}`
            );

        if (!sourceNode) {
            return { valid: false, message: `Source node '${normalizedFromNodeId}' not found` };
        }

        if (!targetNode) {
            return { valid: false, message: `Target node '${normalizedToNodeId}' not found` };
        }

        if (!sourceNode.outputs || fromIndex >= sourceNode.outputs.length) {
            return {
                valid: false,
                message: `Source node '${normalizedFromNodeId}' does not have output at index ${fromIndex}`,
            };
        }

        if (!targetNode.inputs || toIndex >= targetNode.inputs.length) {
            return {
                valid: false,
                message: `Target node '${normalizedToNodeId}' does not have input at index ${toIndex}`,
            };
        }

        const identicalConnectionCount = this.#connections.filter((conn) => {
            if (isExcludedConnection(conn)) {
                return false;
            }
            return (
                conn.fromNode === normalizedFromNodeId &&
                conn.fromIndex === fromIndex &&
                conn.toNode === normalizedToNodeId &&
                conn.toIndex === toIndex
            );
        }).length;

        if (identicalConnectionCount > 0) {
            if (!allowExistingConnectionMatch || identicalConnectionCount > 1) {
                return {
                    valid: false,
                    message: 'Duplicate connection is not allowed',
                };
            }
        }

        if (!skipCardinalityChecks) {
            try {
                const outputTypeForPolicy = this.#resolveOutputTypeForIndex(sourceNode, fromIndex);
                const inputMaxConnections = this.#resolveInputMaxConnections(outputTypeForPolicy);
                const outputMaxConnections = this.#resolveOutputMaxConnections(outputTypeForPolicy);

                if (inputMaxConnections !== null && inputMaxConnections > 0) {
                    const existingIncomingConnectionCount = this.#connections.filter((conn) => {
                        if (isExcludedConnection(conn)) {
                            return false;
                        }
                        if (conn.toNode !== normalizedToNodeId || conn.toIndex !== toIndex) {
                            return false;
                        }

                        if (!allowExistingConnectionMatch) {
                            return true;
                        }

                        // Ignore the same edge when re-validating an already-existing connection.
                        return !(
                            conn.fromNode === normalizedFromNodeId && conn.fromIndex === fromIndex
                        );
                    }).length;

                    if (existingIncomingConnectionCount >= inputMaxConnections) {
                        return {
                            valid: false,
                            message:
                                `Input connection limit exceeded for type '${outputTypeForPolicy}': ` +
                                `maxConnections=${inputMaxConnections}, ` +
                                `currentConnections=${existingIncomingConnectionCount}`,
                        };
                    }
                }

                if (outputMaxConnections !== null && outputMaxConnections > 0) {
                    const existingOutgoingConnectionCount = this.#connections.filter((conn) => {
                        if (isExcludedConnection(conn)) {
                            return false;
                        }
                        if (
                            conn.fromNode !== normalizedFromNodeId ||
                            conn.fromIndex !== fromIndex
                        ) {
                            return false;
                        }

                        if (!allowExistingConnectionMatch) {
                            return true;
                        }

                        // Ignore the same edge when re-validating an already-existing connection.
                        return !(conn.toNode === normalizedToNodeId && conn.toIndex === toIndex);
                    }).length;

                    if (existingOutgoingConnectionCount >= outputMaxConnections) {
                        return {
                            valid: false,
                            message:
                                `Output connection limit exceeded for type '${outputTypeForPolicy}': ` +
                                `maxConnections=${outputMaxConnections}, ` +
                                `currentConnections=${existingOutgoingConnectionCount}`,
                        };
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    valid: false,
                    message: `Invalid type configuration: ${message}`,
                };
            }
        }

        if (
            connectionWouldCreateCycle(this.#connections, normalizedFromNodeId, normalizedToNodeId)
        ) {
            return {
                valid: false,
                message: 'Recursive connection detected: this connection would create a cycle',
            };
        }

        const outputId = (sourceNode.outputs[fromIndex] as Record<string, unknown>).id as string;
        const inputId = (targetNode.inputs[toIndex] as Record<string, unknown>).id as string;

        try {
            let outputType = 'any';
            try {
                outputType = sourceNode.getOutputType(outputId);
            } catch (error) {
                const outputTypeMessage = error instanceof Error ? error.message : String(error);
                if (!outputTypeMessage.includes('missing required outputType')) {
                    throw error;
                }
            }

            let allowedTypes: string[] = ['any'];
            try {
                allowedTypes = targetNode.getInputAllowedTypes(inputId);
            } catch (error) {
                const allowedTypesMessage = error instanceof Error ? error.message : String(error);
                if (!allowedTypesMessage.includes('missing required allowedTypes')) {
                    throw error;
                }
            }

            const outputEntry = sourceNode.outputs[fromIndex] as Record<string, unknown>;
            const declaredSources = resolveDeclaredInputSources(outputEntry);
            const outputTypes = declaredSources.length
                ? this.getResolvedOutputTypes(normalizedFromNodeId, fromIndex)
                : [outputType];

            // Every candidate must be acceptable: a mux that may carry a bool is refused
            // by a string-only input, and a mismatched pair is refused by both sides.
            const incompatible = outputTypes.filter(
                (candidate) =>
                    !resolveTypeCompatibility(candidate, allowedTypes, {
                        resolveTypeKind: (typeId) => this.getDataTypeKind(typeId),
                    }).compatible
            );

            if (incompatible.length > 0) {
                const message =
                    outputTypes.length === 1
                        ? `Type mismatch: Cannot connect '${outputTypes[0]}' to input accepting [${allowedTypes.join(', ')}]`
                        : `Type mismatch: Cannot connect union '${outputTypes.join(' | ')}' to input accepting [${allowedTypes.join(', ')}]`;
                return { valid: false, message };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                valid: false,
                message: `Invalid type configuration: ${message}`,
            };
        }

        return { valid: true };
    }

    /**
     * Add a validated connection.
     * Emits: `connection-added` on success, `connection-error` on validation failure.
     * @param {{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}} conn
     * @returns {{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}}
     * @throws {Error} If connection validation fails
     */
    addConnection(conn: NodeConnection): NodeConnection {
        const normalized = cloneConnection(conn);

        const validation = this.canConnect(
            normalized.fromNode,
            normalized.fromIndex,
            normalized.toNode,
            normalized.toIndex
        );

        if (!validation.valid) {
            this.#emitChange(
                'connection-error',
                new NodeGraphConnectionErrorPayload(
                    this.#id,
                    normalized,
                    validation.message as string
                )
            );
            throw new Error(validation.message as string);
        }

        this.#connections.push(normalized);
        this.#emitChange(
            'connection-added',
            new NodeGraphConnectionAddedPayload(this.#id, cloneConnection(normalized))
        );

        this.#refreshDynamicConnectorTypingForNodes([normalized.toNode]);
        return { ...normalized };
    }

    #collectCardinalityPruneCandidates(normalized: NodeConnection): NodeConnection[] {
        const sourceNode = this.getNode(normalized.fromNode);
        if (!sourceNode) {
            return [];
        }

        const outputTypeForPolicy = this.#resolveOutputTypeForIndex(
            sourceNode,
            normalized.fromIndex
        );
        const inputMaxConnections = this.#resolveInputMaxConnections(outputTypeForPolicy);
        const outputMaxConnections = this.#resolveOutputMaxConnections(outputTypeForPolicy);

        const candidates: NodeConnection[] = [];
        const seen = new Set<string>();
        const pushUnique = (connection: NodeConnection): void => {
            const key = `${connection.fromNode}:${connection.fromIndex}->${connection.toNode}:${connection.toIndex}`;
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            candidates.push(cloneConnection(connection));
        };

        if (inputMaxConnections !== null && inputMaxConnections > 0) {
            const existingIncoming = this.#connections.filter((conn) => {
                return conn.toNode === normalized.toNode && conn.toIndex === normalized.toIndex;
            });
            const overflowIncomingCount = existingIncoming.length + 1 - inputMaxConnections;
            if (overflowIncomingCount > 0) {
                existingIncoming.slice(0, overflowIncomingCount).forEach(pushUnique);
            }
        }

        if (outputMaxConnections !== null && outputMaxConnections > 0) {
            const existingOutgoing = this.#connections.filter((conn) => {
                return (
                    conn.fromNode === normalized.fromNode && conn.fromIndex === normalized.fromIndex
                );
            });
            const remainingOutgoing = existingOutgoing.filter((conn) => {
                const key = `${conn.fromNode}:${conn.fromIndex}->${conn.toNode}:${conn.toIndex}`;
                return !seen.has(key);
            });
            const overflowOutgoingCount = remainingOutgoing.length + 1 - outputMaxConnections;
            if (overflowOutgoingCount > 0) {
                remainingOutgoing.slice(0, overflowOutgoingCount).forEach(pushUnique);
            }
        }

        return candidates;
    }

    /**
     * Add a connection from an explicit user action.
     * If maxConnections would be exceeded on input/output, older conflicting connections are pruned first.
     * @param {{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}} conn
     * @returns {{fromNode:string|number, fromIndex:number, toNode:string|number, toIndex:number}}
     */
    addConnectionFromUserAction(conn: NodeConnection): NodeConnection {
        const normalized = cloneConnection(conn);

        const baseValidation = this.canConnect(
            normalized.fromNode,
            normalized.fromIndex,
            normalized.toNode,
            normalized.toIndex,
            { skipCardinalityChecks: true }
        );

        if (!baseValidation.valid) {
            this.#emitChange(
                'connection-error',
                new NodeGraphConnectionErrorPayload(
                    this.#id,
                    normalized,
                    baseValidation.message as string
                )
            );
            throw new Error(baseValidation.message as string);
        }

        const pruneCandidates = this.#collectCardinalityPruneCandidates(normalized);
        pruneCandidates.forEach((existingConnection) => {
            this.removeConnection(
                existingConnection.fromNode,
                existingConnection.fromIndex,
                existingConnection.toNode,
                existingConnection.toIndex
            );
        });

        return this.addConnection(normalized);
    }

    /**
     * Remove a connection matching all endpoints.
     * Emits: `connection-removed` when removed.
     * @param {string|number} fromNode
     * @param {number} fromIndex
     * @param {string|number} toNode
     * @param {number} toIndex
     * @returns {boolean} True if a connection was removed.
     */
    removeConnection(
        fromNode: NodeIdentifier,
        fromIndex: number,
        toNode: NodeIdentifier,
        toIndex: number
    ): boolean {
        const normalizedFromNode = normalizeNodeIdentifier(fromNode, '');
        const normalizedToNode = normalizeNodeIdentifier(toNode, '');
        const beforeLength = this.#connections.length;
        this.#connections = this.#connections.filter((conn) => {
            return !(
                conn.fromNode === normalizedFromNode &&
                conn.fromIndex === fromIndex &&
                conn.toNode === normalizedToNode &&
                conn.toIndex === toIndex
            );
        });
        const removed = this.#connections.length !== beforeLength;
        if (removed) {
            this.#emitChange(
                'connection-removed',
                new NodeGraphConnectionRemovedPayload(this.#id, {
                    fromNode: normalizedFromNode,
                    fromIndex,
                    toNode: normalizedToNode,
                    toIndex,
                })
            );

            this.#refreshDynamicConnectorTypingForNodes([normalizedToNode]);
        }
        return removed;
    }
}

export {
    NodeGraph,
    DEFAULT_GRAPH_NAME,
    DEFAULT_GRAPH_INTERVAL_MS,
    MIN_GRAPH_INTERVAL_MS,
    DEFAULT_GRAPH_HIGHLIGHT_COLOR,
};
