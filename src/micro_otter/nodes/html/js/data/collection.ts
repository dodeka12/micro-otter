// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Collection class encapsulates workspace state and enforces schema integrity.
 *
 * A Collection models a workspace containing:
 * - Multiple graphs (nodes + connections)
 * - An active-graph pointer and viewport state
 * - Metadata (title, target ID, semantic version)
 *
 * Event model
 * ------------
 * Listeners registered via {@link onChange} receive `AppEvent` envelopes:
 * - `title` with `Collection.TitleChanged.v1`
 * - `targetId` with `Collection.TargetIdChanged.v1`
 * - `activeGraphIdx` with `Collection.ActiveGraphIndexChanged.v1`
 * - `viewportConfig` with `Collection.ViewportConfigChanged.v1`
 * - `graphAdded` with `Collection.GraphAdded.v1`
 * - `graphRemoved` with `Collection.GraphRemoved.v1`
 * - `graphMoved` with `Collection.GraphMoved.v1`
 * - `graphUpdated` with `Collection.GraphUpdated.v1`
 * - `graph` with `Collection.GraphEvent.v1` (forwarded NodeGraph metadata)
 * - `version` with `Collection.VersionChanged.v1`
 *
 * Listeners registered via {@link onGraphChange} receive NodeGraph `AppEvent` envelopes
 * emitted by the active {@link NodeGraph} instance. Possible `event.name` values include:
 * `viewport`, `name`, `interval`, `color`, `node-counter`, `node-added`, `node-updated`,
 * `node-removed`, `connection-added`, `connection-removed` (and any future graph-level
 * events the {@link NodeGraph} exposes).
 */

import { FlaggedVersion } from './flagged-version.js';
import { NodeGraph } from './node-graph.js';
import { assertUuidV4, generateUuidV4 } from './uuid.js';
import { DataTypeRegistry } from './data-type-registry.js';
import type { DataTypeDefinition } from './data-type-registry.js';
import { HistoryManager } from './history-manager.js';
import { VarReferenceReconciler } from '../nodes/var-consistency.js';
import { IrqReferenceReconciler } from '../nodes/irq-consistency.js';
import { SignalReferenceReconciler } from '../nodes/signal-consistency.js';
import { FunctionCallNodeReconciler } from '../nodes/function-consistency.js';
import type { FunctionSignatureChange } from '../nodes/function-consistency.js';
import { AppEvent, AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';

const DEFAULT_COLLECTION_TITLE = 'Graph Workspace';
const DEFAULT_TARGET_ID = 'generic_micropython';
const DEFAULT_DEVICE_RUNTIME_ID = 'general';
const DEFAULT_WEB_ASSET_GENERATION_MODE = 'compressed';

type WebAssetGenerationMode = 'compressed' | 'plain';

type JsonRecord = Record<string, unknown>;
type GraphSource = NodeGraph | JsonRecord;
type GraphChangeListener = (event: AppEvent) => void;

interface CollectionConstructorOptions {
    id?: string | null;
    title?: string | null;
    targetId?: string | null;
    deviceRuntimeId?: string | null;
    version?: FlaggedVersion | string | null;
    graphs?: GraphSource[];
    activeGraphIdx?: number | null;
    webAssetGenerationMode?: WebAssetGenerationMode | string | null;
}

interface ActiveGraphIdxNormalizationResult {
    value: number;
    repaired: boolean;
    reason: string | null;
    original: unknown;
}

interface CollectionRepair {
    code: string;
    field: string;
    previousValue: unknown;
    nextValue: unknown;
}

interface CollectionFromDataResult {
    collection: Collection;
    repairedData: JsonRecord;
    repairs: CollectionRepair[];
}

interface CollectionStoredData extends JsonRecord {
    id?: unknown;
    title?: unknown;
    targetId?: unknown;
    deviceRuntimeId?: unknown;
    version?: unknown;
    graphs?: unknown;
    activeGraphIdx?: unknown;
    webAssetGenerationMode?: unknown;
    history?: unknown;
}

/**
 * Payload for collection title updates.
 */
class CollectionTitleChangedPayload extends AppPayload {
    collectionId: string;
    title: string;

    constructor(collectionId: string, title: string) {
        super('Collection.TitleChanged.v1');
        this.collectionId = collectionId;
        this.title = title;
    }
}

function normalizeWebAssetGenerationMode(value: unknown): WebAssetGenerationMode {
    if (typeof value !== 'string') {
        return DEFAULT_WEB_ASSET_GENERATION_MODE;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'plain') {
        return 'plain';
    }
    return 'compressed';
}

/**
 * Payload for collection target updates.
 */
class CollectionTargetIdChangedPayload extends AppPayload {
    collectionId: string;
    targetId: string | null;

    constructor(collectionId: string, targetId: string | null) {
        super('Collection.TargetIdChanged.v1');
        this.collectionId = collectionId;
        this.targetId = targetId;
    }
}

class CollectionWebAssetGenerationModeChangedPayload extends AppPayload {
    collectionId: string;
    webAssetGenerationMode: WebAssetGenerationMode;

    constructor(collectionId: string, webAssetGenerationMode: WebAssetGenerationMode) {
        super('Collection.WebAssetGenerationModeChanged.v1');
        this.collectionId = collectionId;
        this.webAssetGenerationMode = webAssetGenerationMode;
    }
}

/**
 * Payload for active graph index updates.
 */
class CollectionActiveGraphIndexChangedPayload extends AppPayload {
    collectionId: string;
    activeGraphIdx: number;

    constructor(collectionId: string, activeGraphIdx: number) {
        super('Collection.ActiveGraphIndexChanged.v1');
        this.collectionId = collectionId;
        this.activeGraphIdx = activeGraphIdx;
    }
}

/**
 * Payload for viewport configuration updates.
 */
class CollectionViewportConfigChangedPayload extends AppPayload {
    collectionId: string;
    viewportConfig: unknown;

    constructor(collectionId: string, viewportConfig: unknown) {
        super('Collection.ViewportConfigChanged.v1');
        this.collectionId = collectionId;
        this.viewportConfig = viewportConfig;
    }
}

/**
 * Payload for semantic-version updates.
 */
class CollectionVersionChangedPayload extends AppPayload {
    collectionId: string;
    version: string;

    constructor(collectionId: string, version: string) {
        super('Collection.VersionChanged.v1');
        this.collectionId = collectionId;
        this.version = version;
    }
}

/**
 * Payload for graph-added events.
 */
class CollectionGraphAddedPayload extends AppPayload {
    collectionId: string;
    graph: NodeGraph;

    constructor(collectionId: string, graph: NodeGraph) {
        super('Collection.GraphAdded.v1');
        this.collectionId = collectionId;
        this.graph = graph;
    }
}

/**
 * Payload for graph-removed events.
 */
class CollectionGraphRemovedPayload extends AppPayload {
    collectionId: string;
    graphId: string;

    constructor(collectionId: string, graphId: string) {
        super('Collection.GraphRemoved.v1');
        this.collectionId = collectionId;
        this.graphId = graphId;
    }
}

/**
 * Payload for graph-moved events.
 */
class CollectionGraphMovedPayload extends AppPayload {
    collectionId: string;
    graphId: string;
    fromIndex: number;
    toIndex: number;

    /**
     * @param {string} collectionId - Collection that owns the reordered graph.
     * @param {string} graphId - Graph that changed position.
     * @param {number} fromIndex - Zero-based index before the move.
     * @param {number} toIndex - Zero-based index after the move.
     */
    constructor(collectionId: string, graphId: string, fromIndex: number, toIndex: number) {
        super('Collection.GraphMoved.v1');
        this.collectionId = collectionId;
        this.graphId = graphId;
        this.fromIndex = fromIndex;
        this.toIndex = toIndex;
    }
}

/**
 * Payload for graph-updated events.
 */
class CollectionGraphUpdatedPayload extends AppPayload {
    collectionId: string;
    graph: NodeGraph;

    constructor(collectionId: string, graph: NodeGraph) {
        super('Collection.GraphUpdated.v1');
        this.collectionId = collectionId;
        this.graph = graph;
    }
}

/**
 * Payload for forwarded NodeGraph events.
 */
class CollectionGraphEventPayload extends AppPayload {
    collectionId: string;
    type: string;
    graphEventName: string;
    detail: AppPayload;
    graphEventPayloadTypeId: string;
    graphId: string;

    constructor(
        collectionId: string,
        graphEventName: string,
        detail: AppPayload,
        graphEventPayloadTypeId: string,
        graphId: string
    ) {
        super('Collection.GraphEvent.v1');
        this.collectionId = collectionId;
        this.type = graphEventName;
        this.graphEventName = graphEventName;
        this.detail = detail;
        this.graphEventPayloadTypeId = graphEventPayloadTypeId;
        this.graphId = graphId;
    }
}

function assertNodeGraphAppEvent(event: unknown, context = 'Collection graph listener'): AppEvent {
    if (!(event instanceof AppEvent)) {
        throw new TypeError(`${context}: expected AppEvent instance`);
    }

    const payloadTypeId = event.detail?.payloadTypeId;
    if (typeof payloadTypeId !== 'string' || !payloadTypeId.startsWith('NodeGraph.')) {
        throw new TypeError(
            `${context}: expected NodeGraph.* payloadTypeId but received '${payloadTypeId}'`
        );
    }

    return event;
}

/**
 * Sanitize a target ID string.
 */
function sanitizeTargetId(value: unknown, fallback: string | null = null): string | null {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
}

/**
 * Normalize a collection title string.
 */
function normalizeTitle(value: unknown): string {
    if (typeof value !== 'string') {
        return DEFAULT_COLLECTION_TITLE;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : DEFAULT_COLLECTION_TITLE;
}

/**
 * Normalize persisted active graph index so collection loading can recover from stale data.
 */
function normalizeActiveGraphIdx(
    activeGraphIdx: unknown,
    graphCount: number
): ActiveGraphIdxNormalizationResult {
    const safeGraphCount = Number.isInteger(graphCount) && graphCount > 0 ? graphCount : 1;

    if (!Number.isInteger(activeGraphIdx)) {
        return {
            value: 0,
            repaired: true,
            reason: 'invalid-active-graph-index-type',
            original: activeGraphIdx,
        };
    }

    const normalizedActiveGraphIdx = activeGraphIdx as number;

    if (normalizedActiveGraphIdx < 0 || normalizedActiveGraphIdx >= safeGraphCount) {
        return {
            value: 0,
            repaired: true,
            reason: 'active-graph-index-out-of-range',
            original: activeGraphIdx,
        };
    }

    return {
        value: normalizedActiveGraphIdx,
        repaired: false,
        reason: null,
        original: activeGraphIdx,
    };
}

/**
 * Represents a workspace collection containing graphs, metadata, and versioning state.
 * Provides validated accessors and serializers to keep the collection schema consistent.
 */
export class Collection extends AppEventEmitter {
    #id: string;
    #title: string;
    #targetId: string | null;
    #version: FlaggedVersion;
    #graphs: NodeGraph[];
    #graphIdMapping: Map<string, number>;
    #activeGraphIdx: number;
    #graphChangeListeners: Set<GraphChangeListener>;
    #deviceRuntimeId: string;
    #dataTypeRegistry: DataTypeRegistry;
    #webAssetGenerationMode: WebAssetGenerationMode;
    #historyManager: HistoryManager;
    #varReferenceReconciler: VarReferenceReconciler | null = null;
    #irqReferenceReconciler: IrqReferenceReconciler | null = null;

    #signalReferenceReconciler: SignalReferenceReconciler | null = null;

    #functionCallNodeReconciler: FunctionCallNodeReconciler | null = null;

    unregisterGraphChangeHandler: (() => void) | null;

    /**
     * Build a collection from supplied options, validating IDs, version, and graphs.
     * Rebinds graph listeners to the active graph and bumps version if a dirty flag is set.
     */
    constructor({
        id = null,
        title = null,
        targetId = null,
        deviceRuntimeId = null,
        version = null,
        graphs = [],
        activeGraphIdx = null,
        webAssetGenerationMode = null,
    }: CollectionConstructorOptions = {}) {
        super();
        this.#id = assertUuidV4(id);
        this.#title = title && typeof title === 'string' ? title.trim() : DEFAULT_COLLECTION_TITLE;
        this.#targetId =
            targetId && typeof targetId === 'string' ? targetId.trim() : DEFAULT_TARGET_ID;
        this.#version =
            version instanceof FlaggedVersion
                ? version
                : new FlaggedVersion({ version_string: version || '0.0.0' });
        this.#deviceRuntimeId =
            deviceRuntimeId && typeof deviceRuntimeId === 'string'
                ? deviceRuntimeId.trim()
                : DEFAULT_DEVICE_RUNTIME_ID;

        const incomingGraphs = Array.isArray(graphs) ? [...graphs] : [];
        this.#graphs = [];
        this.#graphIdMapping = new Map();
        let defaultActiveGraphIdx = 0;
        if (incomingGraphs.length === 0) {
            incomingGraphs.push(
                new NodeGraph({ id: 'init-graph', name: 'Init', executionType: 'startup' }),
                new NodeGraph({ id: 'graph-1', name: 'Graph 1', executionType: 'continuous' })
            );
            defaultActiveGraphIdx = 1;
        }

        incomingGraphs.forEach((graph, index) => {
            const instance = graph instanceof NodeGraph ? graph : NodeGraph.fromData(graph);
            this.#configureGraphDataTypeLookup(instance);
            const graphId = instance.getId();
            this.#graphs.push(instance);
            this.#graphIdMapping.set(graphId, index);
        });

        this.#activeGraphIdx =
            activeGraphIdx !== null ? activeGraphIdx : defaultActiveGraphIdx;
        this.#graphChangeListeners = new Set();
        this.unregisterGraphChangeHandler = null;
        this.#dataTypeRegistry = new DataTypeRegistry();
        this.#webAssetGenerationMode = normalizeWebAssetGenerationMode(webAssetGenerationMode);
        this.#historyManager = new HistoryManager(this);

        this.setActiveGraphIdx(this.#activeGraphIdx);
    }

    getWebAssetGenerationMode(): WebAssetGenerationMode {
        return this.#webAssetGenerationMode;
    }

    /**
     * Log a message with automatic class name capture.
     */
    _log(reason: string, level: string = 'debug', ...data: unknown[]): void {
        const maybeLogger = (
            globalThis as typeof globalThis & {
                __microOtterLog?: { log: (...args: unknown[]) => void };
            }
        ).__microOtterLog;
        if (maybeLogger) {
            const { log } = maybeLogger;

            const validLevels = ['debug', 'info', 'warn', 'error'];
            const actualLevel = validLevels.includes(level) ? level : 'debug';
            const actualData = validLevels.includes(level) ? data : [level, ...data];

            log('Collection', reason, actualLevel, ...actualData);
        }
    }

    setWebAssetGenerationMode(
        webAssetGenerationMode: WebAssetGenerationMode | string | null
    ): void {
        const normalized = normalizeWebAssetGenerationMode(webAssetGenerationMode);
        if (normalized === this.#webAssetGenerationMode) {
            return;
        }

        this.#webAssetGenerationMode = normalized;
        this.#emitChange(
            'webAssetGenerationMode',
            new CollectionWebAssetGenerationModeChangedPayload(
                this.#id,
                this.#webAssetGenerationMode
            )
        );
        this.markPatchVersionDirty();
    }

    /**
     * Subscribe to graph change events emitted by the active {@link NodeGraph}.
     */
    onGraphChange(listener: GraphChangeListener): () => void {
        if (typeof listener !== 'function') {
            throw new TypeError('Listener must be a function.');
        }
        this.#graphChangeListeners.add(listener);
        return () => this.offGraphChange(listener);
    }

    /**
     * Remove a previously registered graph change listener.
     */
    offGraphChange(listener: GraphChangeListener): void {
        this.#graphChangeListeners.delete(listener);
    }

    /**
     * Internal helper to broadcast collection-level changes.
     */
    #emitChange(name: string, payload: AppPayload): void {
        this.emit(name, payload);
    }

    /**
     * Emit a version change event with the current version string.
     */
    #emitVersionChange(): void {
        this.#emitChange(
            'version',
            new CollectionVersionChangedPayload(this.#id, this.#version.toString())
        );
    }
    #configureGraphDataTypeLookup(graph: NodeGraph): void {
        graph.setDataTypeDefinitionLookup((typeId) => this.getDataType(typeId));
    }

    /**
     * Handle a downstream {@link NodeGraph} change and propagate collection-level events.
     */
    #graphChanged(event: AppEvent): void {
        const validated = assertNodeGraphAppEvent(event, 'Collection graph bridge');
        const eventName = validated.name;

        if (
            ['node-added', 'node-removed', 'connection-added', 'connection-removed'].includes(
                eventName
            )
        ) {
            this.markMajorVersionDirty();
        } else if (['node-updated', 'connection-updated'].includes(eventName)) {
            this.markMinorVersionDirty();
        } else {
            this.markPatchVersionDirty();
        }

        // A variable reference can outlive its declaration: rename references when a declaring
        // node changed its name, and reset dangling references when the declaration disappeared.
        if (eventName === 'node-removed') {
            this.reconcileVarReferences();
            this.reconcileIrqReferences();
            this.reconcileSignalReferences();
        } else if (eventName === 'node-updated') {
            const patch = (validated.detail as { patch?: Record<string, unknown> } | null)?.patch;
            if (
                patch &&
                (Object.prototype.hasOwnProperty.call(patch, 'controlValues') ||
                    Object.prototype.hasOwnProperty.call(patch, 'inputDefaults'))
            ) {
                const detail = validated.detail as {
                    nodeId?: unknown;
                    previous?: Record<string, unknown>;
                };
                const change = { nodeId: detail?.nodeId, previous: detail?.previous };
                this.reconcileVarReferences(change);
                this.reconcileIrqReferences(change);
                this.reconcileSignalReferences(change);
            }
        }

        // A placed call node is a snapshot of its function graph's interface, so every
        // signature edit has to reach the call nodes of the other graphs as well.
        if (eventName === 'functionSignature') {
            this.reconcileFunctionCallNodes(validated.detail);
        }

        for (const listener of this.#graphChangeListeners) {
            try {
                listener(validated);
            } catch (error) {
                console.error('[Collection] Error in graph change listener:', error);
            }
        }

        this.#emitChange(
            'graph',
            new CollectionGraphEventPayload(
                this.#id,
                validated.name,
                validated.detail,
                validated.detail.payloadTypeId,
                (validated.detail as AppPayload & { graphId?: unknown }).graphId as string
            )
        );
    }

    /**
     * Reconcile variable references across every graph of this collection.
     *
     * A `node-updated` change rewrites references when a declaring node renamed its variable, and
     * a repair pass resets references whose declaration disappeared (the node was removed,
     * switched to "use", cleared its name, or changed store). The pass walks all graphs, so a
     * variable declared in one graph can be referenced in another.
     *
     * @param change - Optional changed-node descriptor from a `node-updated` event.
     */
    reconcileVarReferences(change?: {
        nodeId?: unknown;
        previous?: Record<string, unknown>;
    }): void {
        if (!this.#varReferenceReconciler) {
            this.#varReferenceReconciler = new VarReferenceReconciler(() => this.#graphs);
        }
        this.#varReferenceReconciler.reconcile(change);
    }

    /**
     * Reconcile interrupt references across every graph of this collection.
     *
     * A `node-updated` change rewrites `interrupt-enable` references and graph `triggerName`
     * settings when an `interrupt-input` node renamed its channel; a repair pass resets references
     * whose declaration disappeared (the node was removed or cleared its name). The pass walks all
     * graphs, so a channel declared in one graph can be referenced in another.
     *
     * @param change - Optional changed-node descriptor from a `node-updated` event.
     */
    reconcileIrqReferences(change?: {
        nodeId?: unknown;
        previous?: Record<string, unknown>;
    }): void {
        if (!this.#irqReferenceReconciler) {
            this.#irqReferenceReconciler = new IrqReferenceReconciler(() => this.#graphs);
        }
        this.#irqReferenceReconciler.reconcile(change);
    }

    /**
     * Reconcile signal references across every graph of this collection.
     *
     * A `node-updated` change rewrites a referencing graph's `signalNames` when a `signal-post`
     * node renamed its signal, and drops the name when the declaration disappeared (the node was
     * removed or cleared its name). The pass walks all graphs, so a signal posted in one graph
     * can be watched by an `event` graph in another.
     *
     * @param change - Optional changed-node descriptor from a `node-updated` event.
     */
    reconcileSignalReferences(change?: {
        nodeId?: unknown;
        previous?: Record<string, unknown>;
    }): void {
        if (!this.#signalReferenceReconciler) {
            this.#signalReferenceReconciler = new SignalReferenceReconciler(() => this.#graphs);
        }
        this.#signalReferenceReconciler.reconcile(change);
    }

    /**
     * Reconcile placed function-call nodes across every graph of this collection.
     *
     * A `functionSignature` change rebuilds the connectors of every node whose type is
     * `function_graph.<graphId>` and re-points the wiring those connectors carry, so a
     * placed call node can never keep a stale parameter list or a wire on a moved
     * connector. The pass walks all graphs, because the callers live in other graphs than
     * the function they call; the function graph itself is included so a self-call node
     * stays in sync too.
     *
     * @param change - Payload of the forwarded `functionSignature` event.
     */
    reconcileFunctionCallNodes(change?: AppPayload | Record<string, unknown> | null): void {
        if (!this.#functionCallNodeReconciler) {
            this.#functionCallNodeReconciler = new FunctionCallNodeReconciler(() => this.#graphs);
        }
        this.#functionCallNodeReconciler.reconcile(
            (change ?? undefined) as FunctionSignatureChange | undefined
        );
    }

    getId(): string {
        return this.#id;
    }

    getTitle(): string {
        return this.#title;
    }

    getTargetId(): string | null {
        return this.#targetId;
    }

    getDeviceRuntimeId(): string {
        return this.#deviceRuntimeId;
    }

    setDeviceRuntimeId(deviceRuntimeId: string | null): void {
        this.#deviceRuntimeId =
            deviceRuntimeId && typeof deviceRuntimeId === 'string'
                ? deviceRuntimeId.trim()
                : DEFAULT_DEVICE_RUNTIME_ID;
    }

    getGraphs(): Record<string, NodeGraph> {
        const result: Record<string, NodeGraph> = {};
        this.#graphs.forEach((graph) => {
            result[graph.getId()] = graph;
        });
        return result;
    }

    getGraphArray(): NodeGraph[] {
        return Array.from(this.#graphs.values());
    }

    /**
     * Build a graph name that is not yet used in this collection.
     *
     * The rule lives in the model (not in a view) so a replacement graph can also be
     * created without any view attached.
     *
     * @param {string} [baseName='Graph'] - Base pattern; the free name is `${baseName} ${n}`.
     * @returns {string} Free graph name.
     */
    getUniqueGraphName(baseName = 'Graph'): string {
        const base = typeof baseName === 'string' && baseName.trim() ? baseName.trim() : 'Graph';
        const taken = new Set(this.#graphs.map((graph) => graph.getName()));

        let num = 1;
        let name = `${base} ${num}`;
        while (taken.has(name)) {
            num++;
            name = `${base} ${num}`;
        }

        return name;
    }

    /**
     * Build a graph id that is not yet used in this collection.
     * @returns {string} Free graph id of the form `graph-${n}`.
     */
    getUniqueGraphId(): string {
        const taken = new Set(this.#graphs.map((graph) => graph.getId()));

        let num = 1;
        let id = `graph-${num}`;
        while (taken.has(id)) {
            num++;
            id = `graph-${num}`;
        }

        return id;
    }

    getActiveGraphIdx(): number {
        return this.#activeGraphIdx;
    }

    getVersion(): FlaggedVersion {
        return this.#version;
    }

    getVersionString(): string {
        return this.#version.toString();
    }

    getActiveGraph(): NodeGraph {
        const idx = this.#activeGraphIdx;
        const hasActive = Number.isInteger(idx) && idx >= 0 && idx < this.#graphs.length;
        if (!hasActive) {
            throw new Error('Active graph is not set or out of range.');
        }
        return this.#graphs[idx];
    }

    getViewportConfig(): unknown {
        return this.getActiveGraph().getViewportConfig();
    }

    setTitle(title: string): void {
        this.#title = normalizeTitle(title);
        this.#emitChange('title', new CollectionTitleChangedPayload(this.#id, this.#title));
    }

    setTargetId(targetId: string | null): void {
        const oldTargetId = this.#targetId;
        this.#targetId = sanitizeTargetId(targetId, null);
        this._log('target-id-changed', 'info', {
            collectionId: this.#id,
            oldTargetId,
            newTargetId: this.#targetId,
            inputValue: targetId,
        });
        this.#emitChange(
            'targetId',
            new CollectionTargetIdChangedPayload(this.#id, this.#targetId)
        );
        this.markMajorVersionDirty();
    }

    setActiveGraphIdx(graphIdx: number | null | undefined): void {
        if (graphIdx === null || graphIdx === undefined) {
            this.#activeGraphIdx = 0;
            return;
        }
        if (typeof graphIdx !== 'number') {
            throw new Error('Graph index must be a number or null');
        }
        const hasGraph = graphIdx >= 0 && graphIdx < this.#graphs.length;
        if (!hasGraph) {
            throw new Error(
                `Cannot set active graph: graph with index "${graphIdx}" does not exist`
            );
        }
        this.#activeGraphIdx = graphIdx;
        const activeGraph = this.getActiveGraph();
        if (this.unregisterGraphChangeHandler) {
            this.unregisterGraphChangeHandler();
        }
        this.unregisterGraphChangeHandler = activeGraph.on('*', this.#graphChanged.bind(this));
        this.#emitChange(
            'activeGraphIdx',
            new CollectionActiveGraphIndexChangedPayload(this.#id, this.#activeGraphIdx)
        );
    }

    setViewportConfig(viewportConfig: unknown): void {
        this.getActiveGraph().setViewportConfig(viewportConfig as never);
        this.#emitChange(
            'viewportConfig',
            new CollectionViewportConfigChangedPayload(this.#id, viewportConfig)
        );
        this.markPatchVersionDirty();
    }

    setVersion(version: string | FlaggedVersion): void {
        if (version === null || version === undefined) {
            throw new Error('Version cannot be null or undefined');
        }
        if (typeof version === 'string' && version.trim() === '') {
            throw new Error('Version string cannot be empty');
        }
        if (version instanceof FlaggedVersion && version === this.#version) {
            return;
        }

        this.#version =
            version instanceof FlaggedVersion
                ? version
                : new FlaggedVersion({ version_string: version });
        this.#emitVersionChange();
    }

    markPatchVersionDirty(): void {
        if (this.#version.dirty.patch) {
            return;
        }
        this.#version.markDirty('patch');
        this.#emitVersionChange();
    }

    markMinorVersionDirty(): void {
        if (this.#version.dirty.minor) {
            return;
        }
        this.#version.markDirty('minor');
        this.#emitVersionChange();
    }

    markMajorVersionDirty(): void {
        if (this.#version.dirty.major) {
            return;
        }
        this.#version.markDirty('major');
        this.#emitVersionChange();
    }

    bumpVersionIfDirty(): boolean {
        const wasBumped = this.#version.bumpIfDirty();
        if (wasBumped) {
            this.#emitVersionChange();
        }
        return wasBumped;
    }

    getGraphById(graphId: string): NodeGraph {
        const idx = this.#graphIdMapping.get(graphId);
        if (idx !== undefined) {
            return this.#graphs[idx];
        }
        throw new Error(`Graph with ID "${graphId}" does not exist`);
    }

    addGraph(graph: GraphSource): void {
        const instance = graph instanceof NodeGraph ? graph : NodeGraph.fromData(graph);
        const graphId = instance.getId();
        if (this.#graphIdMapping.has(graphId)) {
            throw new Error(`Graph with ID "${graphId}" already exists`);
        }
        this.#graphIdMapping.set(graphId, this.#graphs.length);
        this.#configureGraphDataTypeLookup(instance);
        this.#graphs.push(instance);
        this.#emitChange('graphAdded', new CollectionGraphAddedPayload(this.#id, instance));
        this.markMajorVersionDirty();
    }

    removeGraph(graphId: string): boolean {
        const graphIdx = this.#graphIdMapping.get(graphId);
        if (graphIdx === undefined) {
            return false;
        }
        this.#graphIdMapping.delete(graphId);
        this.#graphs.splice(graphIdx, 1);

        for (const [id, idx] of this.#graphIdMapping.entries()) {
            if (idx > graphIdx) {
                this.#graphIdMapping.set(id, idx - 1);
            }
        }

        if (this.#activeGraphIdx === graphIdx) {
            this.#activeGraphIdx = graphIdx > 0 ? this.#activeGraphIdx - 1 : 0;
        } else if (this.#activeGraphIdx > graphIdx) {
            this.#activeGraphIdx--;
        }

        this.#emitChange('graphRemoved', new CollectionGraphRemovedPayload(this.#id, graphId));
        this.markMajorVersionDirty();
        return true;
    }

    /**
     * Move a graph to another position in the collection's graph order.
     *
     * `toIndex` is the index the graph occupies in the resulting array (not an insertion gap).
     * Out-of-range integers are clamped to the valid range; unknown ids and no-op moves return
     * `false` without emitting an event. The active graph stays active: only its index is remapped.
     *
     * @param {string} graphId - Graph to move.
     * @param {number} toIndex - Target index in the resulting graph array.
     * @returns {boolean} True when the order changed.
     */
    moveGraph(graphId: string, toIndex: number): boolean {
        const fromIndex = this.#graphIdMapping.get(graphId);
        if (fromIndex === undefined || this.#graphs.length < 2) {
            return false;
        }
        if (!Number.isInteger(toIndex)) {
            return false;
        }

        const clampedIndex = Math.min(Math.max(0, toIndex), this.#graphs.length - 1);
        if (clampedIndex === fromIndex) {
            return false;
        }

        const activeGraphId = this.#graphs[this.#activeGraphIdx]?.getId() ?? null;

        const [movedGraph] = this.#graphs.splice(fromIndex, 1);
        this.#graphs.splice(clampedIndex, 0, movedGraph);

        this.#graphIdMapping.clear();
        this.#graphs.forEach((graph, index) => {
            this.#graphIdMapping.set(graph.getId(), index);
        });

        const nextActiveGraphIdx =
            activeGraphId !== null && this.#graphIdMapping.has(activeGraphId)
                ? (this.#graphIdMapping.get(activeGraphId) as number)
                : Math.min(this.#activeGraphIdx, this.#graphs.length - 1);

        const activeIdxChanged = nextActiveGraphIdx !== this.#activeGraphIdx;
        // Update the field before emitting: workspace persistence may serialize synchronously from a
        // `graphMoved` listener, and it must see the remapped active index.
        this.#activeGraphIdx = nextActiveGraphIdx;

        this.#emitChange(
            'graphMoved',
            new CollectionGraphMovedPayload(this.#id, graphId, fromIndex, clampedIndex)
        );

        if (activeIdxChanged) {
            this.#emitChange(
                'activeGraphIdx',
                new CollectionActiveGraphIndexChangedPayload(this.#id, this.#activeGraphIdx)
            );
        }

        this.markMajorVersionDirty();
        return true;
    }

    updateGraph(graphId: string, updates: JsonRecord): boolean {
        const graphIdx = this.#graphIdMapping.get(graphId);
        if (graphIdx === undefined) {
            return false;
        }

        const current = this.#graphs[graphIdx];
        if (!current) {
            return false;
        }
        if (!updates || typeof updates !== 'object') {
            throw new Error('Updates must be an object');
        }
        if (updates.id && updates.id !== graphId) {
            throw new Error('Cannot change graph ID through updateGraph');
        }
        const base = current instanceof NodeGraph ? current.toData() : current;
        const merged = NodeGraph.fromData({ ...base, ...updates, id: graphId });
        this.#configureGraphDataTypeLookup(merged);
        this.#graphs[graphIdx] = merged;
        this.#emitChange('graphUpdated', new CollectionGraphUpdatedPayload(this.#id, merged));
        this.markMajorVersionDirty();
        return true;
    }

    static fromData(data: CollectionStoredData): Collection {
        const { collection } = Collection.fromDataWithRepair(data);
        return collection;
    }

    static fromDataWithRepair(data: CollectionStoredData): CollectionFromDataResult {
        if (!data || typeof data !== 'object') {
            throw new Error('Collection data must be an object');
        }

        const graphs = Array.isArray(data.graphs) ? data.graphs : [];
        const graphCount = graphs.length > 0 ? graphs.length : 1;
        const normalizedActiveGraphIdx = normalizeActiveGraphIdx(data.activeGraphIdx, graphCount);
        const activeGraphIdx = normalizedActiveGraphIdx.value;
        const repairs: CollectionRepair[] = [];

        if (normalizedActiveGraphIdx.repaired) {
            repairs.push({
                code: normalizedActiveGraphIdx.reason as string,
                field: 'activeGraphIdx',
                previousValue: normalizedActiveGraphIdx.original,
                nextValue: activeGraphIdx,
            });
        }

        const repairedData: CollectionStoredData = {
            ...data,
            graphs,
            activeGraphIdx,
        };

        const collection = new Collection({
            id: (repairedData.id as string | null | undefined) || generateUuidV4(),
            title: repairedData.title as string | null | undefined,
            targetId: repairedData.targetId as string | null | undefined,
            deviceRuntimeId: repairedData.deviceRuntimeId as string | null | undefined,
            version: FlaggedVersion.fromData(repairedData.version as JsonRecord),
            graphs: graphs as GraphSource[],
            activeGraphIdx,
            webAssetGenerationMode: repairedData.webAssetGenerationMode as
                | WebAssetGenerationMode
                | string
                | null
                | undefined,
        });

        if (data.history && typeof data.history === 'object') {
            collection.#historyManager.dispose();
            collection.#historyManager = HistoryManager.deserialize(data.history, collection);
        }

        return {
            collection,
            repairedData: {
                ...repairedData,
                id: collection.getId(),
            },
            repairs,
        };
    }

    toData(): JsonRecord {
        const data = {
            id: this.#id,
            title: this.#title,
            targetId: this.#targetId,
            deviceRuntimeId: this.#deviceRuntimeId,
            version: this.#version.toData(),
            webAssetGenerationMode: this.#webAssetGenerationMode,
            graphs: this.#graphs.map((g) => g.toData()),
            activeGraphIdx: this.#activeGraphIdx,
            history: this.#historyManager.serialize(),
        };
        return data;
    }

    clone(): Collection {
        return Collection.fromData(this.toData());
    }

    getDataTypeRegistry(): DataTypeRegistry {
        return this.#dataTypeRegistry;
    }

    getHistoryManager(): HistoryManager {
        return this.#historyManager;
    }

    dispose(): void {
        if (this.#historyManager) {
            this.#historyManager.dispose();
        }
        if (this.unregisterGraphChangeHandler) {
            this.unregisterGraphChangeHandler();
            this.unregisterGraphChangeHandler = null;
        }
        this.#graphChangeListeners.clear();
        this.removeAllListeners();
    }

    registerDataType(typeId: string, definition: DataTypeDefinition): void {
        this.#dataTypeRegistry.register(typeId, definition);
    }

    getDataType(typeId: string): Required<DataTypeDefinition> | null {
        return this.#dataTypeRegistry.get(typeId);
    }

    getAllDataTypes(): Array<{ id: string; definition: Required<DataTypeDefinition> }> {
        return this.#dataTypeRegistry.getAll();
    }
}
