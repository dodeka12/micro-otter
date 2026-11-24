import { generateUuidV4 } from './uuid.js';
import { assertAppEventPayloadType } from '../core/app-event.js';
import { resolveNodeDisplayName } from './node-name-resolver.js';
import { areaBoundsEqual, normalizeAreaFontSize } from './documentation-area.js';
import type {
    DocumentationAreaBounds,
    DocumentationAreaData,
    DocumentationAreaDragMode,
} from './documentation-area.js';

const DEFAULT_MAX_DEPTH = 50;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type NodeId = string;

interface HistoryManagerLoggerApi {
    log: (className: string, reason: string, level: LogLevel, ...data: unknown[]) => void;
}

interface NodePosition {
    x: number;
    y: number;
}

interface NodeConnection {
    fromNode: NodeId;
    fromIndex: number;
    toNode: NodeId;
    toIndex: number;
    [key: string]: unknown;
}

interface NodeDataSnapshot {
    id?: NodeId;
    type?: string;
}

interface NodeLike {
    id: NodeId;
    x: number;
    y: number;
    type?: string;
    userName?: unknown;
    typeName?: unknown;
    title?: unknown;
    toData: () => NodeDataSnapshot;
    setId?: (id: NodeId) => void;
    [key: string]: unknown;
}

interface GraphDataSnapshot {
    id?: string;
    name?: string;
    [key: string]: unknown;
}

interface NodeGraphLike {
    getId: () => string;
    getName: () => string;
    setName: (name: string) => void;
    toData: () => GraphDataSnapshot;
    getNode: (nodeId: NodeId) => NodeLike | null;
    hasNode: (nodeId: NodeId) => boolean;
    addNode: (nodeData: Record<string, unknown>) => NodeLike;
    removeNode: (nodeId: NodeId) => void;
    restoreNode?: (nodeData: Record<string, unknown>) => NodeLike;
    updateNodePosition: (nodeId: NodeId, x: number, y: number) => void;
    updateNode: (nodeId: NodeId, patch: Record<string, unknown>) => void;
    addConnection: (connection: NodeConnection) => void;
    removeConnection: (
        fromNode: NodeId,
        fromIndex: number,
        toNode: NodeId,
        toIndex: number
    ) => void;
    getConnectionsForNode?: (nodeId: NodeId) => NodeConnection[];
    getDocumentationAreas?: () => DocumentationAreaData[];
    getDocumentationArea?: (areaId: string) => DocumentationAreaLike | null;
    getDocumentationAreaIndex?: (areaId: string) => number;
    hasDocumentationArea?: (areaId: string) => boolean;
    restoreDocumentationArea?: (data: DocumentationAreaData, index?: number) => unknown;
    updateDocumentationArea?: (areaId: string, patch: Record<string, unknown>) => unknown;
    setDocumentationAreaBounds?: (areaId: string, bounds: unknown) => unknown;
    removeDocumentationArea?: (areaId: string) => boolean;
}

/** Live documentation-area instance as seen by the history manager. */
interface DocumentationAreaLike {
    id: string;
    toData: () => DocumentationAreaData;
}

interface CollectionLike {
    on: (eventName: string, listener: (event: GraphChangeEvent) => void) => () => void;
    onGraphChange: (listener: (event: GraphChangeEvent) => void) => () => void;
    getActiveGraph: () => NodeGraphLike;
    getGraphById: (graphId: string) => NodeGraphLike | null;
    getGraphArray: () => NodeGraphLike[];
    addGraph: (graphData: GraphDataSnapshot) => void;
    removeGraph: (graphId: string) => void;
}

interface GraphChangeEvent {
    name: string;
    detail: Record<string, unknown>;
}

interface HistoryManagerOptions {
    maxDepth?: number;
}

type OperationType =
    | 'node-added'
    | 'node-removed'
    | 'node-pos-changed'
    | 'node-width-changed'
    | 'connection-added'
    | 'connection-removed'
    | 'graph-added'
    | 'graph-removed'
    | 'graph-renamed'
    | 'control-value-changed'
    | 'selection-changed'
    | 'documentation-area-added'
    | 'documentation-area-updated'
    | 'documentation-area-removed'
    | 'documentation-area-bounds-changed'
    | 'operation-group';

type HistoryDirection = 'undo' | 'redo';

interface SelectionHistoryAppliedPayload {
    selectedNodeIds: NodeId[];
    direction: HistoryDirection;
    description: string;
}

type SelectionHistoryAppliedListener = (payload: SelectionHistoryAppliedPayload) => void;

interface OperationBase {
    id: string;
    type: OperationType;
    timestamp: number;
    description: string;
}

interface DeltaOperation extends OperationBase {
    type: Exclude<OperationType, 'operation-group'>;
    forward: Record<string, unknown>;
    inverse: Record<string, unknown>;
}

interface OperationGroup extends OperationBase {
    type: 'operation-group';
    operations: HistoryOperation[];
}

type HistoryOperation = DeltaOperation | OperationGroup;

interface NodeDragCachedState {
    timestamp: number;
    data: NodeDataSnapshot;
    startPosition: NodePosition;
    currentPosition: NodePosition;
}

interface NodeRemoveCachedState {
    timestamp: number;
    nodeData: NodeDataSnapshot;
    connections: NodeConnection[];
}

interface DocumentationAreaDragCachedState {
    timestamp: number;
    mode: DocumentationAreaDragMode;
    startBounds: DocumentationAreaBounds;
    currentBounds: DocumentationAreaBounds;
}

interface DocumentationAreaRemoveCachedState {
    timestamp: number;
    data: DocumentationAreaData;
    index: number;
}

interface GraphRemoveCachedState {
    timestamp: number;
    graphData: GraphDataSnapshot;
    graphIndex: number;
}

interface GraphRenameCachedState {
    timestamp: number;
    oldName: string;
}

type CachedState =
    | NodeDragCachedState
    | NodeRemoveCachedState
    | GraphRemoveCachedState
    | GraphRenameCachedState
    | DocumentationAreaDragCachedState
    | DocumentationAreaRemoveCachedState;

interface SerializedHistoryData {
    version: number;
    maxDepth: number;
    currentIndex: number;
    operations: HistoryOperation[];
}

function isOperationGroup(operation: HistoryOperation): operation is OperationGroup {
    return operation.type === 'operation-group';
}

function toRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeNodeId(value: unknown): NodeId {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return '';
}

function toNodeId(value: unknown): NodeId {
    return normalizeNodeId(value);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
    return Number.isFinite(value) ? Number(value) : fallback;
}

/**
 * Whether a value is a usable documentation-area id.
 */
function isAreaIdLike(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Whether a value looks like a documentation-area bounds object with finite members.
 */
function isAreaBoundsLike(value: unknown): boolean {
    const record = toRecord(value);
    return (
        Number.isFinite(record.x) &&
        Number.isFinite(record.y) &&
        Number.isFinite(record.width) &&
        Number.isFinite(record.height)
    );
}

/**
 * Copy a bounds-like value into a detached `DocumentationAreaBounds`.
 */
function toAreaBounds(value: unknown): DocumentationAreaBounds {
    const record = toRecord(value);
    return {
        x: toFiniteNumber(record.x),
        y: toFiniteNumber(record.y),
        width: toFiniteNumber(record.width),
        height: toFiniteNumber(record.height),
    };
}

/**
 * Copy a serialized documentation area into a detached data object.
 *
 * Restoring goes through the graph, which re-normalizes colour and bounds, so this only has to
 * produce a well-shaped plain object.
 * @param value - Serialized area from an operation payload.
 * @returns Detached area data.
 */
function toAreaData(value: unknown): DocumentationAreaData {
    const record = toRecord(value);
    return {
        id: typeof record.id === 'string' ? record.id : String(record.id ?? ''),
        title: typeof record.title === 'string' ? record.title : '',
        markdown: typeof record.markdown === 'string' ? record.markdown : '',
        color: typeof record.color === 'string' ? record.color : '',
        contentAlign: record.contentAlign === 'bottom' ? 'bottom' : 'top',
        fontSize: normalizeAreaFontSize(record.fontSize),
        bounds: toAreaBounds(record.bounds),
    };
}

function toNodeConnection(value: unknown): NodeConnection | null {
    const record = toRecord(value);
    const fromNode = toNodeId(record.fromNode);
    const toNode = toNodeId(record.toNode);
    const fromIndex = toFiniteNumber(record.fromIndex, -1);
    const toIndex = toFiniteNumber(record.toIndex, -1);

    if (!fromNode || !toNode) {
        return null;
    }

    if (
        !Number.isInteger(fromIndex) ||
        fromIndex < 0 ||
        !Number.isInteger(toIndex) ||
        toIndex < 0
    ) {
        return null;
    }

    return {
        fromNode,
        fromIndex,
        toNode,
        toIndex,
    };
}

function normalizeSelectionNodeIds(nodeIds: readonly unknown[]): NodeId[] {
    const normalized: NodeId[] = [];
    const seen = new Set<NodeId>();

    for (const nodeId of nodeIds) {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (!normalizedNodeId || seen.has(normalizedNodeId)) {
            continue;
        }

        seen.add(normalizedNodeId);
        normalized.push(normalizedNodeId);
    }

    return normalized;
}

function cloneOperation(operation: HistoryOperation): HistoryOperation {
    if (isOperationGroup(operation)) {
        return {
            ...operation,
            operations: operation.operations.map((subOperation) => cloneOperation(subOperation)),
        };
    }

    return {
        ...operation,
        forward: { ...operation.forward },
        inverse: { ...operation.inverse },
    };
}

export class HistoryManager {
    #operations: HistoryOperation[] = [];
    #currentIndex = -1;
    #maxDepth = DEFAULT_MAX_DEPTH;
    #collection: CollectionLike;
    #isApplying = false;
    #stateCache: Map<string, CachedState> = new Map();
    #groupStack: OperationGroup[] = [];
    #unsubscribeCollection: (() => void) | null = null;
    #unsubscribeGraph: (() => void) | null = null;
    #selectionHistoryAppliedListeners: Set<SelectionHistoryAppliedListener> = new Set();

    constructor(collection: CollectionLike, options: HistoryManagerOptions = {}) {
        if (!collection) {
            throw new TypeError('Collection is required');
        }

        this.#collection = collection;
        this.#maxDepth = this.#validateMaxDepth(options.maxDepth);
        this.#setupEventListeners();
    }

    _log(reason: string, level: unknown = 'debug', ...data: unknown[]): void {
        if (typeof globalThis.__microOtterLog !== 'undefined') {
            const { log } = globalThis.__microOtterLog as HistoryManagerLoggerApi;
            const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
            const resolvedLevel = validLevels.includes(level as LogLevel)
                ? (level as LogLevel)
                : 'debug';
            const resolvedData = validLevels.includes(level as LogLevel) ? data : [level, ...data];
            log('HistoryManager', reason, resolvedLevel, ...resolvedData);
        }
    }

    #errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    #errorStack(error: unknown): string | undefined {
        return error instanceof Error ? error.stack : undefined;
    }

    #validateMaxDepth(value: unknown): number {
        if (value === undefined || value === null) {
            return DEFAULT_MAX_DEPTH;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 1) {
            return DEFAULT_MAX_DEPTH;
        }
        return Math.floor(numeric);
    }

    #setupEventListeners(): void {
        const collectionUnsubscribers = [
            this.#collection.on('title', (event: GraphChangeEvent) => {
                if (this.#isApplying) return;
                assertAppEventPayloadType(
                    event,
                    'Collection.TitleChanged.v1',
                    'HistoryManager collection listener'
                );
                this.#captureCollectionTitleChange(toRecord(event.detail));
            }),
            this.#collection.on('targetId', (event: GraphChangeEvent) => {
                if (this.#isApplying) return;
                assertAppEventPayloadType(
                    event,
                    'Collection.TargetIdChanged.v1',
                    'HistoryManager collection listener'
                );
                this.#captureCollectionTargetChange(toRecord(event.detail));
            }),
            this.#collection.on('graphAdded', (event: GraphChangeEvent) => {
                if (this.#isApplying) return;
                assertAppEventPayloadType(
                    event,
                    'Collection.GraphAdded.v1',
                    'HistoryManager collection listener'
                );
                this.#captureGraphAdded(toRecord(event.detail));
            }),
            this.#collection.on('graphRemoved', (event: GraphChangeEvent) => {
                if (this.#isApplying) return;
                assertAppEventPayloadType(
                    event,
                    'Collection.GraphRemoved.v1',
                    'HistoryManager collection listener'
                );
                this.#captureGraphRemoved(toRecord(event.detail));
            }),
            this.#collection.on('graphUpdated', (event: GraphChangeEvent) => {
                if (this.#isApplying) return;
                assertAppEventPayloadType(
                    event,
                    'Collection.GraphUpdated.v1',
                    'HistoryManager collection listener'
                );
                this.#captureGraphUpdated(toRecord(event.detail));
            }),
        ];

        this.#unsubscribeCollection = () => {
            for (const unsubscribe of collectionUnsubscribers) {
                unsubscribe();
            }
        };

        this.#unsubscribeGraph = this.#collection.onGraphChange((event: GraphChangeEvent) => {
            if (this.#isApplying) return;

            switch (event.name) {
                case 'node-drag-started':
                    this._log('event-node-drag-started', 'info', { nodeId: event.detail.nodeId });
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodeDragStarted.v1',
                        [
                            {
                                name: 'nodeId',
                                validate: (value) => value !== null && value !== undefined,
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#cacheNodeState(toNodeId(event.detail.nodeId));
                    break;
                case 'node-pos-changed':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodePositionChanged.v1',
                        [
                            {
                                name: 'nodeId',
                                validate: (value) => value !== null && value !== undefined,
                            },
                            {
                                name: 'x',
                                validate: (value) => Number.isFinite(value),
                                expected: 'finite number',
                            },
                            {
                                name: 'y',
                                validate: (value) => Number.isFinite(value),
                                expected: 'finite number',
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this._log('event-node-pos-changed', 'debug', {
                        nodeId: event.detail.nodeId,
                        x: event.detail.x,
                        y: event.detail.y,
                    });
                    this.#updateCachedPosition(
                        toNodeId(event.detail.nodeId),
                        toFiniteNumber(event.detail.x),
                        toFiniteNumber(event.detail.y)
                    );
                    break;
                case 'node-drag-ended':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodeDragEnded.v1',
                        [
                            {
                                name: 'nodeId',
                                validate: (value) => value !== null && value !== undefined,
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this._log('event-node-drag-ended', 'info', { nodeId: event.detail.nodeId });
                    this.#captureNodeMove(toRecord(event.detail));
                    break;
                case 'node-added':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodeAdded.v1',
                        [
                            {
                                name: 'nodeId',
                                validate: (value) => value !== null && value !== undefined,
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureNodeAdded(toRecord(event.detail));
                    break;
                case 'node-removed':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodeRemoved.v1',
                        [
                            {
                                name: 'nodeId',
                                validate: (value) => value !== null && value !== undefined,
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureNodeRemoved(toRecord(event.detail));
                    break;
                case 'connection-added':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.ConnectionAdded.v1',
                        [
                            {
                                name: 'connection',
                                validate: (value) => Boolean(value && typeof value === 'object'),
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureConnectionAdded(toRecord(event.detail));
                    break;
                case 'connection-removed':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.ConnectionRemoved.v1',
                        [
                            {
                                name: 'connection',
                                validate: (value) => Boolean(value && typeof value === 'object'),
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureConnectionRemoved(toRecord(event.detail));
                    break;
                case 'name':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.NameChanged.v1',
                        [
                            {
                                name: 'graphId',
                                validate: (value) =>
                                    typeof value === 'string' && value.trim().length > 0,
                                expected: 'non-empty string',
                            },
                            {
                                name: 'name',
                                validate: (value) =>
                                    typeof value === 'string' && value.trim().length > 0,
                                expected: 'non-empty string',
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureGraphRenamed(toRecord(event.detail));
                    break;
                case 'node-updated':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodeUpdated.v1',
                        [
                            {
                                name: 'nodeId',
                                validate: (value) => value !== null && value !== undefined,
                            },
                            {
                                name: 'patch',
                                validate: (value) => Boolean(value && typeof value === 'object'),
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    {
                        const detail = toRecord(event.detail);
                        this.#captureNodeControlChanged(detail);
                        this.#captureNodeWidthChanged(detail);
                    }
                    break;
                case 'documentation-area-drag-started':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.DocumentationAreaDragStarted.v1',
                        [
                            {
                                name: 'areaId',
                                validate: (value) => isAreaIdLike(value),
                                expected: 'non-empty string',
                            },
                            {
                                name: 'mode',
                                validate: (value) => value === 'move' || value === 'resize',
                                expected: "'move' or 'resize'",
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#cacheDocumentationAreaBounds(
                        String(event.detail.areaId),
                        event.detail.mode as DocumentationAreaDragMode
                    );
                    break;
                case 'documentation-area-bounds-changed':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.DocumentationAreaBoundsChanged.v1',
                        [
                            {
                                name: 'areaId',
                                validate: (value) => isAreaIdLike(value),
                                expected: 'non-empty string',
                            },
                            {
                                name: 'bounds',
                                validate: (value) => isAreaBoundsLike(value),
                                expected: 'bounds object with finite x/y/width/height',
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    // Only the cached gesture state is refreshed: a bounds change never pushes an
                    // operation on its own, so a whole drag collapses into one undo step.
                    this.#updateCachedDocumentationAreaBounds(
                        String(event.detail.areaId),
                        toAreaBounds(event.detail.bounds)
                    );
                    break;
                case 'documentation-area-drag-ended':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.DocumentationAreaDragEnded.v1',
                        [
                            {
                                name: 'areaId',
                                validate: (value) => isAreaIdLike(value),
                                expected: 'non-empty string',
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureDocumentationAreaBounds(String(event.detail.areaId));
                    break;
                case 'documentation-area-added':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.DocumentationAreaAdded.v1',
                        [
                            {
                                name: 'areaId',
                                validate: (value) => isAreaIdLike(value),
                                expected: 'non-empty string',
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureDocumentationAreaAdded(String(event.detail.areaId));
                    break;
                case 'documentation-area-updated':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.DocumentationAreaUpdated.v1',
                        [
                            {
                                name: 'areaId',
                                validate: (value) => isAreaIdLike(value),
                                expected: 'non-empty string',
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureDocumentationAreaUpdated(
                        String(event.detail.areaId),
                        toRecord(event.detail.patch),
                        toRecord(event.detail.previous)
                    );
                    break;
                case 'documentation-area-removed':
                    assertAppEventPayloadType(
                        event,
                        'NodeGraph.DocumentationAreaRemoved.v1',
                        [
                            {
                                name: 'areaId',
                                validate: (value) => isAreaIdLike(value),
                                expected: 'non-empty string',
                            },
                        ],
                        'HistoryManager graph listener'
                    );
                    this.#captureDocumentationAreaRemoved(String(event.detail.areaId));
                    break;
            }
        });
    }

    dispose(): void {
        if (this.#unsubscribeCollection) {
            this.#unsubscribeCollection();
            this.#unsubscribeCollection = null;
        }
        if (this.#unsubscribeGraph) {
            this.#unsubscribeGraph();
            this.#unsubscribeGraph = null;
        }
        this.#stateCache.clear();
        this.#operations = [];
        this.#currentIndex = -1;
    }

    canUndo(): boolean {
        return this.#currentIndex >= 0;
    }

    canRedo(): boolean {
        return this.#currentIndex < this.#operations.length - 1;
    }

    undo(): boolean {
        if (!this.canUndo()) {
            return false;
        }

        this.#isApplying = true;
        try {
            const operation = this.#operations[this.#currentIndex];
            this._log('undo', 'info', {
                type: operation.type,
                description: operation.description,
                index: this.#currentIndex,
            });

            this.#applyInverse(operation);
            this.#currentIndex--;
            return true;
        } catch (error: unknown) {
            this._log('undo-error', 'error', {
                error: this.#errorMessage(error),
                stack: this.#errorStack(error),
            });
            return false;
        } finally {
            this.#isApplying = false;
        }
    }

    redo(): boolean {
        if (!this.canRedo()) {
            return false;
        }

        this.#isApplying = true;
        try {
            this.#currentIndex++;
            const operation = this.#operations[this.#currentIndex];
            this._log('redo', 'info', {
                type: operation.type,
                description: operation.description,
                index: this.#currentIndex,
            });

            this.#applyForward(operation);
            return true;
        } catch (error: unknown) {
            this._log('redo-error', 'error', {
                error: this.#errorMessage(error),
                stack: this.#errorStack(error),
            });
            this.#currentIndex--;
            return false;
        } finally {
            this.#isApplying = false;
        }
    }

    getHistoryDepth(): number {
        return this.#operations.length;
    }

    getUndoDescription(): string | null {
        if (!this.canUndo()) {
            return null;
        }
        return this.#operations[this.#currentIndex].description;
    }

    getRedoDescription(): string | null {
        if (!this.canRedo()) {
            return null;
        }
        return this.#operations[this.#currentIndex + 1].description;
    }

    clear(): void {
        this.#operations = [];
        this.#currentIndex = -1;
        this.#stateCache.clear();
        this._log('clear', 'info');
    }

    setMaxDepth(depth: number): void {
        this.#maxDepth = this.#validateMaxDepth(depth);
        this.#enforceMaxDepth();
    }

    onSelectionHistoryApplied(listener: SelectionHistoryAppliedListener): () => void {
        if (typeof listener !== 'function') {
            return () => {};
        }

        this.#selectionHistoryAppliedListeners.add(listener);
        return () => {
            this.#selectionHistoryAppliedListeners.delete(listener);
        };
    }

    recordSelectionChange(
        previousNodeIds: readonly unknown[],
        nextNodeIds: readonly unknown[],
        description = 'Selection changed'
    ): boolean {
        const previous = normalizeSelectionNodeIds(previousNodeIds);
        const next = normalizeSelectionNodeIds(nextNodeIds);

        if (
            previous.length === next.length &&
            previous.every((nodeId, index) => nodeId === next[index])
        ) {
            return false;
        }

        const operation: DeltaOperation = {
            id: generateUuidV4(),
            type: 'selection-changed',
            timestamp: Date.now(),
            description,
            forward: {
                selectedNodeIds: next,
            },
            inverse: {
                selectedNodeIds: previous,
            },
        };

        this.#pushOperation(operation);
        return true;
    }

    getMaxDepth(): number {
        return this.#maxDepth;
    }

    #pushOperation(operation: HistoryOperation): void {
        if (this.#currentIndex < this.#operations.length - 1) {
            this.#operations = this.#operations.slice(0, this.#currentIndex + 1);
        }

        if (this.#groupStack.length > 0) {
            const currentGroup = this.#groupStack[this.#groupStack.length - 1];
            currentGroup.operations.push(operation);
            return;
        }

        this.#operations.push(operation);
        this.#currentIndex++;
        this.#enforceMaxDepth();

        this._log('operation-captured', 'debug', {
            type: operation.type,
            description: operation.description,
            depth: this.#operations.length,
        });
    }

    #enforceMaxDepth(): void {
        while (this.#operations.length > this.#maxDepth) {
            this.#operations.shift();
            this.#currentIndex--;
        }

        if (this.#currentIndex < -1) {
            this.#currentIndex = -1;
        }
    }

    #emitSelectionHistoryApplied(
        selectedNodeIds: readonly unknown[],
        direction: HistoryDirection,
        description: string
    ): void {
        if (this.#selectionHistoryAppliedListeners.size === 0) {
            return;
        }

        const normalizedNodeIds = normalizeSelectionNodeIds(selectedNodeIds);
        const payload: SelectionHistoryAppliedPayload = {
            selectedNodeIds: normalizedNodeIds,
            direction,
            description,
        };

        for (const listener of this.#selectionHistoryAppliedListeners) {
            try {
                listener(payload);
            } catch (error: unknown) {
                this._log('selection-history-listener-error', 'warn', {
                    error: this.#errorMessage(error),
                    direction,
                    description,
                });
            }
        }
    }

    #cacheNodeState(nodeId: NodeId): void {
        try {
            const graph = this.#collection.getActiveGraph();
            const node = graph.getNode(nodeId);
            if (node) {
                const key = `node-${String(nodeId)}`;
                const position = { x: node.x, y: node.y };
                this.#stateCache.set(key, {
                    timestamp: Date.now(),
                    data: node.toData(),
                    startPosition: position,
                    currentPosition: position,
                });
                this._log('cache-node-state', 'info', {
                    nodeId,
                    startPosition: position,
                });
            }
        } catch (error: unknown) {
            this._log('cache-error', 'warn', { nodeId, error: this.#errorMessage(error) });
        }
    }

    #updateCachedPosition(nodeId: NodeId, x: number, y: number): void {
        const key = `node-${String(nodeId)}`;
        const cached = this.#stateCache.get(key) as NodeDragCachedState | undefined;
        if (cached) {
            cached.currentPosition = { x, y };
            this._log('update-cached-position', 'debug', {
                nodeId,
                newPosition: { x, y },
                startPosition: cached.startPosition,
            });
        } else {
            this._log('update-cached-position-failed', 'warn', {
                nodeId,
                reason: 'no-cached-state',
            });
        }
    }

    #getCachedNodeState(nodeId: NodeId): NodeDragCachedState | null {
        const key = `node-${String(nodeId)}`;
        const cached = this.#stateCache.get(key) as NodeDragCachedState | undefined;
        this.#stateCache.delete(key);
        return cached ?? null;
    }

    beforeNodeRemove(nodeId: NodeId): void {
        try {
            const graph = this.#collection.getActiveGraph();
            const node = graph.getNode(nodeId);
            const connections =
                typeof graph.getConnectionsForNode === 'function'
                    ? graph.getConnectionsForNode(nodeId)
                    : [];

            if (node) {
                const key = `node-remove-${String(nodeId)}`;
                this.#stateCache.set(key, {
                    timestamp: Date.now(),
                    nodeData: node.toData(),
                    connections,
                });
                this._log('cache-node-before-remove', 'debug', {
                    nodeId,
                    connectionCount: connections.length,
                });
            }
        } catch (error: unknown) {
            this._log('before-remove-error', 'warn', { nodeId, error: this.#errorMessage(error) });
        }
    }

    #getCachedRemovalState(nodeId: NodeId): NodeRemoveCachedState | null {
        const key = `node-remove-${String(nodeId)}`;
        const cached = this.#stateCache.get(key) as NodeRemoveCachedState | undefined;
        this.#stateCache.delete(key);
        return cached ?? null;
    }

    /**
     * Seed the undo cache for the **current geometry** of a documentation area before it is
     * edited, without recording anything.
     *
     * The panel calls this on the first paint of a move/resize gesture, so the history manager
     * knows where the gesture started no matter how many bounds events follow.
     * @param areaId - Documentation area being moved or resized.
     * @param mode - Gesture kind, deciding the operation description.
     */
    #cacheDocumentationAreaBounds(
        areaId: string,
        mode: DocumentationAreaDragMode = 'move'
    ): void {
        try {
            const graph = this.#collection.getActiveGraph();
            const area = graph.getDocumentationArea?.(areaId) ?? null;
            if (!area) {
                this._log('cache-documentation-area-bounds-failed', 'warn', {
                    areaId,
                    reason: 'area-not-found',
                });
                return;
            }

            const bounds = area.toData().bounds;
            this.#stateCache.set(`documentation-area-drag-${areaId}`, {
                timestamp: Date.now(),
                mode: mode === 'resize' ? 'resize' : 'move',
                startBounds: { ...bounds },
                currentBounds: { ...bounds },
            });
            this._log('cache-documentation-area-bounds', 'debug', { areaId, mode, bounds });
        } catch (error: unknown) {
            this._log('cache-documentation-area-error', 'warn', {
                areaId,
                error: this.#errorMessage(error),
            });
        }
    }

    /**
     * Refresh the cached end state while a gesture streams bounds changes.
     * @param areaId - Documentation area being moved or resized.
     * @param bounds - Latest normalized bounds.
     */
    #updateCachedDocumentationAreaBounds(areaId: string, bounds: DocumentationAreaBounds): void {
        const cached = this.#stateCache.get(
            `documentation-area-drag-${areaId}`
        ) as DocumentationAreaDragCachedState | undefined;

        if (!cached) {
            this._log('update-cached-documentation-area-bounds-failed', 'debug', {
                areaId,
                reason: 'no-cached-state',
            });
            return;
        }

        cached.currentBounds = { ...bounds };
    }

    /**
     * Read and clear the gesture cache.
     * @param areaId - Documentation area whose gesture ended.
     * @returns Cached gesture state, or null when the panel never announced a gesture.
     */
    #getCachedDocumentationAreaBounds(areaId: string): DocumentationAreaDragCachedState | null {
        const key = `documentation-area-drag-${areaId}`;
        const cached = this.#stateCache.get(key) as DocumentationAreaDragCachedState | undefined;
        this.#stateCache.delete(key);
        return cached ?? null;
    }

    /**
     * Capture a documentation area's data and index right before it is removed.
     *
     * This is the counterpart of `beforeNodeRemove()`: the panel must call it immediately
     * before `graph.removeDocumentationArea(id)`, so undo can restore the very same id at the
     * very same index.
     * @param areaId - Documentation area about to be deleted.
     */
    beforeDocumentationAreaRemove(areaId: string): void {
        try {
            const graph = this.#collection.getActiveGraph();
            const area = graph.getDocumentationArea?.(areaId) ?? null;
            if (!area) {
                this._log('cache-documentation-area-before-remove-failed', 'warn', {
                    areaId,
                    reason: 'area-not-found',
                });
                return;
            }

            const index = graph.getDocumentationAreaIndex?.(areaId) ?? -1;
            this.#stateCache.set(`documentation-area-remove-${areaId}`, {
                timestamp: Date.now(),
                data: area.toData(),
                index: index >= 0 ? index : 0,
            });
            this._log('cache-documentation-area-before-remove', 'debug', { areaId, index });
        } catch (error: unknown) {
            this._log('cache-documentation-area-before-remove-error', 'warn', {
                areaId,
                error: this.#errorMessage(error),
            });
        }
    }

    /**
     * Read and clear the pre-removal cache.
     * @param areaId - Removed documentation area.
     * @returns Cached data plus index, or null when the pre-hook never ran.
     */
    #getCachedDocumentationAreaRemoval(areaId: string): DocumentationAreaRemoveCachedState | null {
        const key = `documentation-area-remove-${areaId}`;
        const cached = this.#stateCache.get(key) as DocumentationAreaRemoveCachedState | undefined;
        this.#stateCache.delete(key);
        return cached ?? null;
    }

    beforeGraphRemove(graphId: string): void {
        try {
            const graph = this.#collection.getGraphById(graphId);
            const graphs = this.#collection.getGraphArray();
            const graphIndex = graphs.findIndex(
                (graphCandidate) => graphCandidate.getId() === graphId
            );

            if (graph) {
                const key = `graph-remove-${graphId}`;
                this.#stateCache.set(key, {
                    timestamp: Date.now(),
                    graphData: graph.toData(),
                    graphIndex,
                });
                this._log('cache-graph-before-remove', 'debug', {
                    graphId,
                    graphName: graph.getName(),
                    graphIndex,
                });
            }
        } catch (error: unknown) {
            this._log('before-graph-remove-error', 'warn', {
                graphId,
                error: this.#errorMessage(error),
            });
        }
    }

    #getCachedGraphState(graphId: string): GraphRemoveCachedState | null {
        const key = `graph-remove-${graphId}`;
        const cached = this.#stateCache.get(key) as GraphRemoveCachedState | undefined;
        this.#stateCache.delete(key);
        return cached ?? null;
    }

    beforeGraphRename(graphId: string): void {
        try {
            const graph = this.#collection.getGraphById(graphId);

            if (graph) {
                const key = `graph-rename-${graphId}`;
                this.#stateCache.set(key, {
                    timestamp: Date.now(),
                    oldName: graph.getName(),
                });
                this._log('cache-graph-before-rename', 'debug', {
                    graphId,
                    oldName: graph.getName(),
                });
            }
        } catch (error: unknown) {
            this._log('before-graph-rename-error', 'warn', {
                graphId,
                error: this.#errorMessage(error),
            });
        }
    }

    #getCachedRenameState(graphId: string): GraphRenameCachedState | null {
        const key = `graph-rename-${graphId}`;
        const cached = this.#stateCache.get(key) as GraphRenameCachedState | undefined;
        this.#stateCache.delete(key);
        return cached ?? null;
    }

    #captureNodeAdded(detail: Record<string, unknown>): void {
        try {
            const graph = this.#collection.getActiveGraph();
            const nodeId = toNodeId(detail.nodeId);
            const node = graph.getNode(nodeId);

            if (!node) {
                this._log('capture-node-added-failed', 'warn', {
                    nodeId,
                    reason: 'node-not-found',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'node-added',
                timestamp: Date.now(),
                description: `Add ${node.type || 'node'}`,
                forward: {
                    nodeId: node.id,
                    nodeData: node.toData(),
                },
                inverse: {
                    nodeId: node.id,
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'node-added',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureNodeRemoved(detail: Record<string, unknown>): void {
        try {
            const nodeId = toNodeId(detail.nodeId);
            const cached = this.#getCachedRemovalState(nodeId);

            if (!cached) {
                this._log('capture-node-removed-failed', 'warn', {
                    nodeId,
                    reason: 'no-cached-state',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'node-removed',
                timestamp: Date.now(),
                description: `Delete ${cached.nodeData.type || 'node'}`,
                forward: {
                    nodeId,
                },
                inverse: {
                    nodeData: cached.nodeData,
                    connections: cached.connections,
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'node-removed',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureNodeMove(detail: Record<string, unknown>): void {
        try {
            const nodeId = toNodeId(detail.nodeId);
            const cached = this.#getCachedNodeState(nodeId);

            if (!cached) {
                this._log('capture-node-move-failed', 'warn', {
                    nodeId,
                    reason: 'no-cached-state',
                });
                return;
            }

            const oldPosition = cached.startPosition;
            const newPosition = cached.currentPosition;

            if (oldPosition.x === newPosition.x && oldPosition.y === newPosition.y) {
                this._log('capture-node-move-skipped', 'debug', {
                    nodeId,
                    reason: 'no-position-change',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'node-pos-changed',
                timestamp: Date.now(),
                description: 'Move node',
                forward: {
                    nodeId,
                    oldPosition,
                    newPosition,
                },
                inverse: {
                    nodeId,
                    oldPosition,
                    newPosition,
                },
            };

            this._log('capture-node-move', 'info', {
                nodeId,
                oldPosition: { x: oldPosition.x, y: oldPosition.y },
                newPosition: { x: newPosition.x, y: newPosition.y },
                operationId: operation.id,
            });

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'node-move',
                error: this.#errorMessage(error),
            });
        }
    }

    /**
     * Capture the creation of a documentation area, reading its data from the graph.
     * @param areaId - Id the graph assigned to the new area.
     */
    #captureDocumentationAreaAdded(areaId: string): void {
        try {
            const graph = this.#collection.getActiveGraph();
            const area = graph.getDocumentationArea?.(areaId) ?? null;
            if (!area) {
                this._log('capture-documentation-area-added-failed', 'warn', {
                    areaId,
                    reason: 'area-not-found',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'documentation-area-added',
                timestamp: Date.now(),
                description: 'Create documentation area',
                forward: { areaData: area.toData() },
                inverse: { areaId },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'documentation-area-added',
                error: this.#errorMessage(error),
            });
        }
    }

    /**
     * Capture the removal of a documentation area from the pre-removal cache.
     * @param areaId - Id of the removed area.
     */
    #captureDocumentationAreaRemoved(areaId: string): void {
        try {
            const cached = this.#getCachedDocumentationAreaRemoval(areaId);
            if (!cached) {
                this._log('capture-documentation-area-removed-failed', 'warn', {
                    areaId,
                    reason: 'no-cached-state',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'documentation-area-removed',
                timestamp: Date.now(),
                description: 'Delete documentation area',
                forward: { areaId },
                inverse: { areaData: cached.data, index: cached.index },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'documentation-area-removed',
                error: this.#errorMessage(error),
            });
        }
    }

    /**
     * Capture an edit of a documentation area's title, body, colour, alignment or font size.
     * @param areaId - Edited area.
     * @param patch - Fields that changed.
     * @param previous - Previous values of exactly those fields.
     */
    #captureDocumentationAreaUpdated(
        areaId: string,
        patch: Record<string, unknown>,
        previous: Record<string, unknown>
    ): void {
        try {
            if (Object.keys(patch).length === 0) {
                this._log('capture-documentation-area-updated-skipped', 'debug', {
                    areaId,
                    reason: 'empty-patch',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'documentation-area-updated',
                timestamp: Date.now(),
                description: 'Edit documentation area',
                forward: { areaId, patch: { ...patch } },
                inverse: { areaId, patch: { ...previous } },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'documentation-area-updated',
                error: this.#errorMessage(error),
            });
        }
    }

    /**
     * Capture a finished move/resize gesture as exactly one operation.
     * @param areaId - Area whose gesture just ended.
     */
    #captureDocumentationAreaBounds(areaId: string): void {
        try {
            const cached = this.#getCachedDocumentationAreaBounds(areaId);
            if (!cached) {
                this._log('capture-documentation-area-bounds-failed', 'warn', {
                    areaId,
                    reason: 'no-cached-state',
                });
                return;
            }

            if (areaBoundsEqual(cached.startBounds, cached.currentBounds)) {
                this._log('capture-documentation-area-bounds-skipped', 'debug', {
                    areaId,
                    reason: 'no-bounds-change',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'documentation-area-bounds-changed',
                timestamp: Date.now(),
                description:
                    cached.mode === 'resize'
                        ? 'Resize documentation area'
                        : 'Move documentation area',
                forward: {
                    areaId,
                    oldBounds: { ...cached.startBounds },
                    newBounds: { ...cached.currentBounds },
                },
                inverse: {
                    areaId,
                    oldBounds: { ...cached.startBounds },
                    newBounds: { ...cached.currentBounds },
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'documentation-area-bounds-changed',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureConnectionAdded(detail: Record<string, unknown>): void {
        try {
            const connection = toNodeConnection(detail.connection);
            if (!connection) {
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'connection-added',
                timestamp: Date.now(),
                description: 'Connect nodes',
                forward: {
                    fromNode: connection.fromNode,
                    fromIndex: connection.fromIndex,
                    toNode: connection.toNode,
                    toIndex: connection.toIndex,
                },
                inverse: {
                    fromNode: connection.fromNode,
                    fromIndex: connection.fromIndex,
                    toNode: connection.toNode,
                    toIndex: connection.toIndex,
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'connection-added',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureConnectionRemoved(detail: Record<string, unknown>): void {
        try {
            const connection = toNodeConnection(detail.connection);
            if (!connection) {
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'connection-removed',
                timestamp: Date.now(),
                description: 'Disconnect nodes',
                forward: {
                    fromNode: connection.fromNode,
                    fromIndex: connection.fromIndex,
                    toNode: connection.toNode,
                    toIndex: connection.toIndex,
                },
                inverse: {
                    fromNode: connection.fromNode,
                    fromIndex: connection.fromIndex,
                    toNode: connection.toNode,
                    toIndex: connection.toIndex,
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'connection-removed',
                error: this.#errorMessage(error),
            });
        }
    }

    #restoreConnections(graph: NodeGraphLike, nodeId: NodeId, connections: unknown): void {
        if (!Array.isArray(connections)) return;

        const current =
            typeof graph.getConnectionsForNode === 'function'
                ? graph.getConnectionsForNode(nodeId)
                : [];
        for (const connection of current) {
            graph.removeConnection(
                connection.fromNode,
                connection.fromIndex,
                connection.toNode,
                connection.toIndex
            );
        }

        for (const connectionValue of connections) {
            const connection = toNodeConnection(connectionValue);
            if (!connection) {
                continue;
            }

            try {
                graph.addConnection(connection);
            } catch (error: unknown) {
                this._log('restore-connection-failed', 'warn', {
                    connection,
                    error: this.#errorMessage(error),
                });
            }
        }
    }

    #captureNodeControlChanged(detail: Record<string, unknown>): void {
        try {
            const nodeId = toNodeId(detail.nodeId);
            const patch = toRecord(detail.patch);
            const previous = toRecord(detail.previous);

            if (!Object.prototype.hasOwnProperty.call(patch, 'controlValues')) {
                return;
            }

            const newValues = toRecord(patch.controlValues);
            const oldValues = toRecord(previous.controlValues);

            if (JSON.stringify(oldValues) === JSON.stringify(newValues)) {
                return;
            }

            const graph = this.#collection.getActiveGraph();
            const node = graph?.getNode(nodeId);
            const locale =
                typeof globalThis.i18n?.currentLocale === 'string' &&
                globalThis.i18n.currentLocale.trim()
                    ? globalThis.i18n.currentLocale.trim()
                    : 'en';
            const nodeLabel = node
                ? resolveNodeDisplayName({
                      userName: node.userName,
                      typeName: node.typeName ?? node.title,
                      type: node.type,
                      locale,
                  })
                : String(nodeId);

            const connectionsAfter =
                graph && typeof graph.getConnectionsForNode === 'function'
                    ? graph.getConnectionsForNode(nodeId)
                    : [];
            const connectionsBefore = Array.isArray(previous.connections)
                ? (previous.connections as NodeConnection[])
                : connectionsAfter;

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'control-value-changed',
                timestamp: Date.now(),
                description: `Edit control on "${nodeLabel}"`,
                forward: {
                    nodeId,
                    controlValues: { ...newValues },
                    connections: connectionsAfter,
                },
                inverse: {
                    nodeId,
                    controlValues: { ...oldValues },
                    connections: connectionsBefore,
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'control-value-changed',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureNodeWidthChanged(detail: Record<string, unknown>): void {
        try {
            const nodeId = toNodeId(detail.nodeId);
            const patch = toRecord(detail.patch);
            const previous = toRecord(detail.previous);

            const hasWidthPatch = Object.prototype.hasOwnProperty.call(patch, 'width');
            const hasXPatch = Object.prototype.hasOwnProperty.call(patch, 'x');
            if (!hasWidthPatch && !hasXPatch) {
                return;
            }

            const nextWidth = hasWidthPatch ? toFiniteNumber(patch.width) : undefined;
            const nextX = hasXPatch ? toFiniteNumber(patch.x) : undefined;
            const prevWidth = hasWidthPatch ? toFiniteNumber(previous.width) : undefined;
            const prevX = hasXPatch ? toFiniteNumber(previous.x) : undefined;

            if (
                (!hasWidthPatch || Object.is(nextWidth, prevWidth)) &&
                (!hasXPatch || Object.is(nextX, prevX))
            ) {
                return;
            }

            const graph = this.#collection.getActiveGraph();
            const node = graph?.getNode(nodeId);
            const locale =
                typeof globalThis.i18n?.currentLocale === 'string' &&
                globalThis.i18n.currentLocale.trim()
                    ? globalThis.i18n.currentLocale.trim()
                    : 'en';
            const nodeLabel = node
                ? resolveNodeDisplayName({
                      userName: node.userName,
                      typeName: node.typeName ?? node.title,
                      type: node.type,
                      locale,
                  })
                : String(nodeId);

            const forwardPatch: Record<string, unknown> = {};
            const inversePatch: Record<string, unknown> = {};

            if (hasWidthPatch) {
                forwardPatch.width = nextWidth;
                inversePatch.width = prevWidth;
            }

            if (hasXPatch) {
                forwardPatch.x = nextX;
                inversePatch.x = prevX;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'node-width-changed',
                timestamp: Date.now(),
                description: `Resize node "${nodeLabel}"`,
                forward: {
                    nodeId,
                    patch: forwardPatch,
                },
                inverse: {
                    nodeId,
                    patch: inversePatch,
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'node-width-changed',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureCollectionTitleChange(_event: Record<string, unknown>): void {
        this._log('capture-not-implemented', 'debug', { type: 'collection-title-change' });
    }

    #captureCollectionTargetChange(_event: Record<string, unknown>): void {
        this._log('capture-not-implemented', 'debug', { type: 'collection-target-change' });
    }

    #captureGraphAdded(detail: Record<string, unknown>): void {
        try {
            const graph = detail.graph as NodeGraphLike;
            const graphData = graph.toData();

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'graph-added',
                timestamp: Date.now(),
                description: `Create graph "${graph.getName()}"`,
                forward: {
                    graphData,
                },
                inverse: {
                    graphId: graph.getId(),
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'graph-added',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureGraphRemoved(detail: Record<string, unknown>): void {
        try {
            const graphId = String(detail.graphId ?? '');
            const cached = this.#getCachedGraphState(graphId);

            if (!cached) {
                this._log('capture-graph-removed-failed', 'warn', {
                    graphId,
                    reason: 'no-cached-state - call beforeGraphRemove() first',
                });
                return;
            }

            const operation: DeltaOperation = {
                id: generateUuidV4(),
                type: 'graph-removed',
                timestamp: Date.now(),
                description: `Delete graph "${cached.graphData.name || 'Untitled'}"`,
                forward: {
                    graphId,
                },
                inverse: {
                    graphData: cached.graphData,
                    graphIndex: cached.graphIndex,
                },
            };

            this.#pushOperation(operation);
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'graph-removed',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureGraphUpdated(detail: Record<string, unknown>): void {
        try {
            const graph = detail.graph as NodeGraphLike;
            const graphId = graph.getId();
            const cached = this.#getCachedRenameState(graphId);

            if (cached) {
                const operation: DeltaOperation = {
                    id: generateUuidV4(),
                    type: 'graph-renamed',
                    timestamp: Date.now(),
                    description: `Rename graph "${cached.oldName}" → "${graph.getName()}"`,
                    forward: {
                        graphId,
                        oldName: cached.oldName,
                        newName: graph.getName(),
                    },
                    inverse: {
                        graphId,
                        oldName: cached.oldName,
                        newName: graph.getName(),
                    },
                };

                this.#pushOperation(operation);
                return;
            }

            this._log('capture-not-implemented', 'debug', {
                type: 'graph-updated',
                hint: 'Non-rename updates not yet supported',
            });
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'graph-updated',
                error: this.#errorMessage(error),
            });
        }
    }

    #captureGraphRenamed(detail: Record<string, unknown>): void {
        try {
            const graphId = String(detail.graphId ?? '');
            const newName = String(detail.name ?? '');
            const cached = this.#getCachedRenameState(graphId);

            if (cached) {
                const operation: DeltaOperation = {
                    id: generateUuidV4(),
                    type: 'graph-renamed',
                    timestamp: Date.now(),
                    description: `Rename graph "${cached.oldName}" → "${newName}"`,
                    forward: {
                        graphId,
                        oldName: cached.oldName,
                        newName,
                    },
                    inverse: {
                        graphId,
                        oldName: cached.oldName,
                        newName,
                    },
                };

                this.#pushOperation(operation);
                return;
            }

            this._log('capture-graph-renamed-failed', 'debug', {
                newName,
                graphId,
                reason: 'no-cached-state - call beforeGraphRename() first',
            });
        } catch (error: unknown) {
            this._log('capture-error', 'error', {
                operation: 'graph-renamed',
                error: this.#errorMessage(error),
            });
        }
    }

    #applyInverse(operation: HistoryOperation): void {
        if (isOperationGroup(operation)) {
            for (let index = operation.operations.length - 1; index >= 0; index -= 1) {
                this.#applyInverse(operation.operations[index]);
            }
            return;
        }

        const graph = this.#collection.getActiveGraph();

        switch (operation.type) {
            case 'node-added':
                graph.removeNode(toNodeId(operation.inverse.nodeId));
                break;

            case 'node-removed': {
                const inverseNodeData = toRecord(operation.inverse.nodeData);
                if (typeof graph.restoreNode === 'function') {
                    graph.restoreNode(inverseNodeData);
                } else {
                    const originalId = toNodeId(inverseNodeData.id);
                    const restoredNode = graph.addNode(inverseNodeData);
                    restoredNode.setId?.(originalId);
                }

                const inverseConnections = Array.isArray(operation.inverse.connections)
                    ? operation.inverse.connections
                    : [];

                inverseConnections.forEach((connectionValue) => {
                    const connection = toNodeConnection(connectionValue);
                    if (!connection) {
                        return;
                    }

                    try {
                        graph.addConnection(connection);
                    } catch (error: unknown) {
                        this._log('restore-connection-failed', 'warn', {
                            connection,
                            error: this.#errorMessage(error),
                        });
                    }
                });
                break;
            }

            case 'node-pos-changed': {
                const oldPosition = toRecord(operation.inverse.oldPosition);
                this._log('undo-node-move', 'info', {
                    nodeId: operation.inverse.nodeId,
                    restoringPosition: {
                        x: oldPosition.x,
                        y: oldPosition.y,
                    },
                    operationId: operation.id,
                });
                graph.updateNodePosition(
                    toNodeId(operation.inverse.nodeId),
                    toFiniteNumber(oldPosition.x),
                    toFiniteNumber(oldPosition.y)
                );
                break;
            }

            case 'connection-added':
                graph.removeConnection(
                    toNodeId(operation.inverse.fromNode),
                    toFiniteNumber(operation.inverse.fromIndex),
                    toNodeId(operation.inverse.toNode),
                    toFiniteNumber(operation.inverse.toIndex)
                );
                break;

            case 'connection-removed':
                {
                    const connection = toNodeConnection(operation.inverse);
                    if (!connection) {
                        break;
                    }

                    try {
                        graph.addConnection(connection);
                    } catch (error: unknown) {
                        this._log('restore-connection-failed', 'warn', {
                            connection: operation.inverse,
                            error: this.#errorMessage(error),
                        });
                    }
                }
                break;

            case 'graph-added':
                this.#collection.removeGraph(String(operation.inverse.graphId ?? ''));
                break;

            case 'graph-removed': {
                const graphData = toRecord(operation.inverse.graphData) as GraphDataSnapshot;
                this.#collection.addGraph(graphData);
                break;
            }

            case 'graph-renamed': {
                const renamedGraph = this.#collection.getGraphById(
                    String(operation.inverse.graphId ?? '')
                );
                if (renamedGraph) {
                    renamedGraph.setName(String(operation.inverse.oldName ?? ''));
                }
                break;
            }

            case 'control-value-changed': {
                const controlGraph = this.#collection.getActiveGraph();
                if (controlGraph) {
                    controlGraph.updateNode(toNodeId(operation.inverse.nodeId), {
                        controlValues: { ...toRecord(operation.inverse.controlValues) },
                    });
                    this.#restoreConnections(
                        controlGraph,
                        toNodeId(operation.inverse.nodeId),
                        operation.inverse.connections
                    );
                }
                break;
            }

            case 'node-width-changed': {
                const widthGraph = this.#collection.getActiveGraph();
                if (widthGraph) {
                    widthGraph.updateNode(toNodeId(operation.inverse.nodeId), {
                        ...toRecord(operation.inverse.patch),
                    });
                }
                break;
            }

            case 'selection-changed':
                this.#emitSelectionHistoryApplied(
                    Array.isArray(operation.inverse.selectedNodeIds)
                        ? operation.inverse.selectedNodeIds
                        : [],
                    'undo',
                    operation.description
                );
                break;

            case 'documentation-area-added':
                graph.removeDocumentationArea?.(String(operation.inverse.areaId ?? ''));
                break;

            case 'documentation-area-removed': {
                const areaData = toAreaData(operation.inverse.areaData);
                const index = toFiniteNumber(operation.inverse.index, 0);
                try {
                    graph.restoreDocumentationArea?.(areaData, index);
                } catch (error: unknown) {
                    this._log('restore-documentation-area-failed', 'warn', {
                        areaId: operation.inverse.areaId,
                        error: this.#errorMessage(error),
                    });
                }
                break;
            }

            case 'documentation-area-updated': {
                const areaId = String(operation.inverse.areaId ?? '');
                if (!graph.hasDocumentationArea?.(areaId)) {
                    this._log('apply-documentation-area-update-failed', 'warn', {
                        areaId,
                        reason: 'area-not-found',
                    });
                    break;
                }
                graph.updateDocumentationArea?.(areaId, toRecord(operation.inverse.patch));
                break;
            }

            case 'documentation-area-bounds-changed': {
                const areaId = String(operation.inverse.areaId ?? '');
                if (!graph.hasDocumentationArea?.(areaId)) {
                    this._log('apply-documentation-area-bounds-failed', 'warn', {
                        areaId,
                        reason: 'area-not-found',
                    });
                    break;
                }
                graph.setDocumentationAreaBounds?.(
                    areaId,
                    toAreaBounds(operation.inverse.oldBounds)
                );
                break;
            }

            default:
                this._log('unknown-operation-type', 'warn', {
                    type: (operation as HistoryOperation).type,
                });
        }
    }

    #applyForward(operation: HistoryOperation): void {
        if (isOperationGroup(operation)) {
            for (const subOperation of operation.operations) {
                this.#applyForward(subOperation);
            }
            return;
        }

        const graph = this.#collection.getActiveGraph();

        switch (operation.type) {
            case 'node-added': {
                const nodeData = toRecord(operation.forward.nodeData);
                if (typeof graph.restoreNode === 'function') {
                    graph.restoreNode(nodeData);
                } else {
                    const originalId = toNodeId(nodeData.id);
                    const restoredNode = graph.addNode(nodeData);
                    restoredNode.setId?.(originalId);
                }
                break;
            }

            case 'node-removed':
                graph.removeNode(toNodeId(operation.forward.nodeId));
                break;

            case 'node-pos-changed': {
                const newPosition = toRecord(operation.forward.newPosition);
                this._log('redo-node-move', 'info', {
                    nodeId: operation.forward.nodeId,
                    applyingPosition: {
                        x: newPosition.x,
                        y: newPosition.y,
                    },
                    operationId: operation.id,
                });
                graph.updateNodePosition(
                    toNodeId(operation.forward.nodeId),
                    toFiniteNumber(newPosition.x),
                    toFiniteNumber(newPosition.y)
                );
                break;
            }

            case 'connection-added':
                {
                    const connection = toNodeConnection(operation.forward);
                    if (!connection) {
                        break;
                    }

                    try {
                        graph.addConnection(connection);
                    } catch (error: unknown) {
                        this._log('redo-connection-failed', 'warn', {
                            connection: operation.forward,
                            error: this.#errorMessage(error),
                        });
                    }
                }
                break;

            case 'connection-removed':
                graph.removeConnection(
                    toNodeId(operation.forward.fromNode),
                    toFiniteNumber(operation.forward.fromIndex),
                    toNodeId(operation.forward.toNode),
                    toFiniteNumber(operation.forward.toIndex)
                );
                break;

            case 'graph-added': {
                const graphData = toRecord(operation.forward.graphData) as GraphDataSnapshot;
                this.#collection.addGraph(graphData);
                break;
            }

            case 'graph-removed':
                this.#collection.removeGraph(String(operation.forward.graphId ?? ''));
                break;

            case 'graph-renamed': {
                const renamedGraph = this.#collection.getGraphById(
                    String(operation.forward.graphId ?? '')
                );
                if (renamedGraph) {
                    renamedGraph.setName(String(operation.forward.newName ?? ''));
                }
                break;
            }

            case 'control-value-changed': {
                const controlGraph = this.#collection.getActiveGraph();
                if (controlGraph) {
                    controlGraph.updateNode(toNodeId(operation.forward.nodeId), {
                        controlValues: { ...toRecord(operation.forward.controlValues) },
                    });
                    this.#restoreConnections(
                        controlGraph,
                        toNodeId(operation.forward.nodeId),
                        operation.forward.connections
                    );
                }
                break;
            }

            case 'node-width-changed': {
                const widthGraph = this.#collection.getActiveGraph();
                if (widthGraph) {
                    widthGraph.updateNode(toNodeId(operation.forward.nodeId), {
                        ...toRecord(operation.forward.patch),
                    });
                }
                break;
            }

            case 'selection-changed':
                this.#emitSelectionHistoryApplied(
                    Array.isArray(operation.forward.selectedNodeIds)
                        ? operation.forward.selectedNodeIds
                        : [],
                    'redo',
                    operation.description
                );
                break;

            case 'documentation-area-added': {
                const areaData = toAreaData(operation.forward.areaData);
                if (operation.forward.areaData) {
                    try {
                        graph.restoreDocumentationArea?.(areaData);
                    } catch (error: unknown) {
                        this._log('restore-documentation-area-failed', 'warn', {
                            areaId: operation.forward.areaId,
                            error: this.#errorMessage(error),
                        });
                    }
                }
                break;
            }

            case 'documentation-area-removed':
                graph.removeDocumentationArea?.(String(operation.forward.areaId ?? ''));
                break;

            case 'documentation-area-updated': {
                const areaId = String(operation.forward.areaId ?? '');
                if (!graph.hasDocumentationArea?.(areaId)) {
                    this._log('apply-documentation-area-update-failed', 'warn', {
                        areaId,
                        reason: 'area-not-found',
                    });
                    break;
                }
                graph.updateDocumentationArea?.(areaId, toRecord(operation.forward.patch));
                break;
            }

            case 'documentation-area-bounds-changed': {
                const areaId = String(operation.forward.areaId ?? '');
                if (!graph.hasDocumentationArea?.(areaId)) {
                    this._log('apply-documentation-area-bounds-failed', 'warn', {
                        areaId,
                        reason: 'area-not-found',
                    });
                    break;
                }
                graph.setDocumentationAreaBounds?.(
                    areaId,
                    toAreaBounds(operation.forward.newBounds)
                );
                break;
            }

            default:
                this._log('unknown-operation-type', 'warn', {
                    type: (operation as HistoryOperation).type,
                });
        }
    }

    serialize(): SerializedHistoryData {
        return {
            version: 1,
            maxDepth: this.#maxDepth,
            currentIndex: this.#currentIndex,
            operations: this.#operations.map((operation) => cloneOperation(operation)),
        };
    }

    static deserialize(data: unknown, collection: CollectionLike): HistoryManager {
        if (!data || typeof data !== 'object') {
            return new HistoryManager(collection);
        }

        const parsed = data as Partial<SerializedHistoryData>;
        const manager = new HistoryManager(collection, {
            maxDepth: parsed.maxDepth || DEFAULT_MAX_DEPTH,
        });

        if (Array.isArray(parsed.operations)) {
            manager.#operations = parsed.operations.map((operation) => cloneOperation(operation));
        }

        if (typeof parsed.currentIndex === 'number') {
            manager.#currentIndex = parsed.currentIndex;
        }

        manager._log('deserialized', 'info', {
            operationCount: manager.#operations.length,
            currentIndex: manager.#currentIndex,
        });

        return manager;
    }

    beginGroup(description: string): void {
        this.#groupStack.push({
            id: generateUuidV4(),
            type: 'operation-group',
            timestamp: Date.now(),
            description: description || 'Group operation',
            operations: [],
        });
        this._log('begin-group', 'debug', { description });
    }

    endGroup(): void {
        if (this.#groupStack.length === 0) {
            this._log('end-group-error', 'warn', { reason: 'no-active-group' });
            return;
        }

        const group = this.#groupStack.pop();
        if (!group) {
            this._log('end-group-error', 'warn', { reason: 'failed-to-pop-group' });
            return;
        }

        if (group.operations.length === 0) {
            this._log('end-group-empty', 'debug');
            return;
        }

        if (group.operations.length === 1) {
            this.#pushOperation(group.operations[0]);
            this._log('end-group-single', 'debug');
            return;
        }

        this.#pushOperation(group);
        this._log('end-group', 'debug', { operationCount: group.operations.length });
    }
}
