// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { Collection } from './collection.js';
import { CollectionStore } from './collection-store.js';
import { NodeGraph } from './node-graph.js';
import { validateNodeCapabilities } from '../core/node-capability-validator.js';
import { validateGraphResources } from '../core/graph-resource-validator.js';
import DeviceTargetInfo from './device-target.js';
import { collectRuntimeDefinitionNodePatches } from './runtime-node-definition-migration.js';
import { generateUuidV4 } from './uuid.js';
import { AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';
import { isTargetCompatibleWithImage } from './target-compatibility.js';

type LoggerFn = ((...args: unknown[]) => void) | null;
type GraphSource = NodeGraph | Record<string, unknown>;

interface CollectionRepairEntry {
    collectionId: string;
    repairs: Array<{
        code: string;
        field: string;
        previousValue: unknown;
        nextValue: unknown;
    }>;
}

interface DeviceRuntimeTarget {
    id: string;
    displayName?: string;
}

interface DeviceRuntimeLike {
    name?: string;
    getNodePackages?: () => unknown[];
    getNodeType?: (typeId: string) => unknown | null;
    getDeviceTarget?: (targetId: string) => unknown | null;
    getAvailableTargets: () => DeviceRuntimeTarget[];
}

interface DeviceRuntimeCollectionLike {
    runtimesById: Map<string, DeviceRuntimeLike>;
    getRuntime: (runtimeId: string) => DeviceRuntimeLike | null;
}

interface GeneratedCollectionArtifact {
    targetPath: string;
    content: string | Uint8Array;
    contentType?: string;
    contentEncoding?: 'identity' | 'gzip';
    role?: string;
}

interface TranspilerHelperGroupHandoff {
    mergedData: Record<string, unknown>;
    artifacts: GeneratedCollectionArtifact[];
    webserverSpecPatch: Record<string, unknown>;
}

interface TranspilerHelperHandoffV1 {
    schemaVersion: 'transpiler-helper-handoff/v1';
    helperGroups: Record<string, TranspilerHelperGroupHandoff>;
}

interface TranspileResult {
    code: string;
    assets: Record<string, unknown>;
    generatedArtifacts?: GeneratedCollectionArtifact[];
    helperHandoff?: TranspilerHelperHandoffV1;
}

interface CollectionTranspiler {
    transpile: (
        collection: Collection,
        options: { language?: string; deviceRuntime: DeviceRuntimeLike }
    ) => Promise<TranspileResult>;
}

interface CollectionManagerOptions {
    collections?: Map<string, Collection> | null;
    collectionStore?: CollectionStore | null;
    activeCollectionId?: string | null;
    defaultDeviceRuntimeId?: string | null;
    logger?: LoggerFn;
    runtimeCollection?: DeviceRuntimeCollectionLike | null;
    transpiler?: CollectionTranspiler | null;
}

interface CreateCollectionOptions {
    title?: string;
    targetId?: string;
    deviceRuntimeId?: string;
    graphs?: Array<object | NodeGraph>;
    setActive?: boolean;
}

interface DeleteCollectionOptions {
    ensureActive?: boolean;
}

export interface RemoveGraphOptions {
    /**
     * Base name for the replacement graph created when the *last* graph is removed.
     * `null` refuses to remove the last graph instead of replacing it.
     */
    replacementBaseName?: string | null;
}

interface SerializedCollectionManagerData extends Record<string, unknown> {
    activeCollectionId: string | null;
}

interface DeserializedCollectionManagerData {
    activeCollectionId?: string | null;
}

interface TranspileOptions {
    language?: string;
    deviceRuntime?: DeviceRuntimeLike | null;
}

/**
 * Payload for active collection switch events.
 */
class CollectionManagerActiveCollectionChangedPayload extends AppPayload {
    collectionId: string | null;

    constructor(collectionId: string | null) {
        super('CollectionManager.ActiveCollectionChanged.v1');
        this.collectionId = collectionId;
    }
}

/**
 * Payload for collection add/update/remove events.
 */
class CollectionManagerCollectionChangedPayload extends AppPayload {
    collectionId: string;

    constructor(payloadTypeId: string, collectionId: string) {
        super(payloadTypeId);
        this.collectionId = collectionId;
    }
}

/**
 * CollectionManager manages the set of available collections and active selection.
 *
 * Events fired through {@link onChange} listeners:
 * - `activeCollectionChanged` with `CollectionManager.ActiveCollectionChanged.v1`
 * - `collectionAdded` with `CollectionManager.CollectionAdded.v1`
 * - `collectionUpdated` with `CollectionManager.CollectionUpdated.v1`
 * - `collectionRemoved` with `CollectionManager.CollectionRemoved.v1`
 */
export class CollectionManager extends AppEventEmitter {
    #collections: Map<string, Collection>;
    #activeCollectionId: string | null;
    #collectionStore: CollectionStore;
    #defaultDeviceRuntimeId: string | null;
    #logger: LoggerFn;
    #runtimeCollection: DeviceRuntimeCollectionLike | null;
    #transpiler: CollectionTranspiler | null;
    #userTargetsById: Map<string, { id: string; name: string }>;
    #allowedWebTargetIds: string[] | null;
    #buildBaseTargetId: string | null;

    #isVersionDebugEnabled(): boolean {
        return (globalThis as Record<string, unknown>).__microOtterDebugVersionBump === true;
    }

    #debugLog(reason: string, details: Record<string, unknown> = {}): void {
        if (!this.#isVersionDebugEnabled()) {
            return;
        }

        const payload = {
            reason,
            ...details,
        };

        const globalLogger = (globalThis as Record<string, unknown>).__microOtterLog as
            | {
                  log?: (
                      className: string,
                      reason: string,
                      level: 'debug' | 'info' | 'warn' | 'error',
                      ...data: unknown[]
                  ) => void;
              }
            | undefined;
        if (typeof globalLogger?.log === 'function') {
            globalLogger.log('CollectionManager', 'version-debug', 'info', payload);
            return;
        }

        const logger = this.#logger as unknown;
        if (typeof logger === 'function') {
            logger('[CollectionManager:version-debug]', payload);
            return;
        }

        if (
            logger &&
            typeof logger === 'object' &&
            typeof (logger as { debug?: (...args: unknown[]) => void }).debug === 'function'
        ) {
            (logger as { debug: (...args: unknown[]) => void }).debug(
                '[CollectionManager:version-debug]',
                payload
            );
            return;
        }

        if (
            logger &&
            typeof logger === 'object' &&
            typeof (logger as { log?: (...args: unknown[]) => void }).log === 'function'
        ) {
            (logger as { log: (...args: unknown[]) => void }).log(
                '[CollectionManager:version-debug]',
                payload
            );
            return;
        }

        if (typeof console !== 'undefined' && typeof console.log === 'function') {
            console.log('[CollectionManager:version-debug]', payload);
        }
    }

    #summarizeChangedFields(
        diagnostics: Array<{ changedFields?: unknown; nodeId?: unknown }> = []
    ): {
        totalNodes: number;
        fieldCounts: Record<string, number>;
        sample: Array<{ nodeId: string; changedFields: string[] }>;
    } {
        const fieldCounts: Record<string, number> = {};
        const sample: Array<{ nodeId: string; changedFields: string[] }> = [];

        diagnostics.forEach((entry) => {
            const changedFields = Array.isArray(entry?.changedFields)
                ? entry.changedFields.filter((field): field is string => typeof field === 'string')
                : [];

            changedFields.forEach((field) => {
                fieldCounts[field] = (fieldCounts[field] || 0) + 1;
            });

            if (sample.length >= 5) {
                return;
            }
            const nodeId =
                typeof entry?.nodeId === 'string' && entry.nodeId.trim()
                    ? entry.nodeId
                    : '(unknown-node)';
            sample.push({ nodeId, changedFields });
        });

        return {
            totalNodes: diagnostics.length,
            fieldCounts,
            sample,
        };
    }

    constructor({
        collections = null,
        collectionStore = null,
        activeCollectionId = null,
        defaultDeviceRuntimeId = null,
        logger = null,
        runtimeCollection = null,
        transpiler = null,
    }: CollectionManagerOptions = {}) {
        super();
        this.#collections = collections instanceof Map ? collections : new Map();
        this.#collectionStore = collectionStore || new CollectionStore();
        this.#activeCollectionId =
            typeof activeCollectionId === 'string' ? activeCollectionId.trim() || null : null;
        this.#defaultDeviceRuntimeId =
            typeof defaultDeviceRuntimeId === 'string'
                ? defaultDeviceRuntimeId.trim() || null
                : null;
        this.#logger = logger;
        this.#runtimeCollection = runtimeCollection;
        this.#transpiler = transpiler;
        this.#userTargetsById = new Map();
        this.#allowedWebTargetIds = null;
        this.#buildBaseTargetId = null;
    }

    /**
     * Set the target ids the connected board's firmware can onboard, or null/empty
     * for "no filter". The collection target dropdown offers only these ids when
     * a non-empty list is provided.
     */
    setAllowedWebTargetIds(ids: string[] | null): void {
        this.#allowedWebTargetIds =
            ids && ids.length > 0 ? Array.from(new Set(ids)) : null;
        this.#buildBaseTargetId = null;
    }

    /**
     * Set the flashed image's compatibility metadata: its recorded build base id
     * plus (for pre-M4x images) the legacy allowed-target list.
     */
    setImageCompatibility(image: {
        buildBaseTargetId?: string | null;
        allowedWebTargetIds?: string[] | null;
    }): void {
        this.#buildBaseTargetId = image.buildBaseTargetId ?? null;
        this.#allowedWebTargetIds =
            image.allowedWebTargetIds && image.allowedWebTargetIds.length > 0
                ? Array.from(new Set(image.allowedWebTargetIds))
                : null;
    }

    setUserTargets(targets: Array<{ id: string; name: string }>): void {
        this.#userTargetsById.clear();
        for (const target of targets) {
            if (!target?.id) {
                continue;
            }
            this.#userTargetsById.set(target.id, {
                id: target.id,
                name: target.name || target.id,
            });
        }
    }

    setCollections(collections: Map<string, Collection> | null): void {
        this.#collections = collections instanceof Map ? collections : new Map();
    }

    getCollections(): Map<string, Collection> {
        return this.#collections;
    }

    setDefaultDeviceRuntimeId(runtimeId: string | null): void {
        this.#defaultDeviceRuntimeId =
            typeof runtimeId === 'string' ? runtimeId.trim() || null : null;
    }

    getCollectionIds(): string[] {
        return Array.from(this.#collections.keys());
    }

    hasCollection(collectionId: string): boolean {
        if (!collectionId) {
            return false;
        }
        return this.#collections.has(collectionId);
    }

    getCollectionById(collectionId: string): Collection | null {
        if (!collectionId) {
            return null;
        }
        return this.#collections.get(collectionId) || null;
    }

    #getRuntimeForCollection(collection: Collection): DeviceRuntimeLike | null {
        const runtimeId = collection.getDeviceRuntimeId();
        if (!runtimeId || !this.#runtimeCollection?.getRuntime) {
            return null;
        }
        return this.#runtimeCollection.getRuntime(runtimeId);
    }

    #applyRuntimeDefinitionMigration(collection: Collection): boolean {
        const runtime = this.#getRuntimeForCollection(collection);
        const getNodeType = runtime?.getNodeType;
        if (typeof getNodeType !== 'function') {
            this.#debugLog('migration-skipped-no-runtime', {
                collectionId: collection.getId(),
                runtimeId: collection.getDeviceRuntimeId(),
            });
            return false;
        }

        let hasChanges = false;
        collection.getGraphArray().forEach((graph) => {
            const { patches, updatedNodeIds, diagnostics } = collectRuntimeDefinitionNodePatches({
                nodes: graph.getNodes() as Record<string, unknown>[],
                getNodeType: (typeId) => (getNodeType.call(runtime, typeId) as any) || null,
            });

            this.#debugLog('migration-evaluated-graph', {
                collectionId: collection.getId(),
                graphId: graph.getId(),
                patchCount: patches.length,
                updatedNodeIds,
                changedFieldSummary: this.#summarizeChangedFields(diagnostics),
                diagnostics,
            });

            patches.forEach((entry) => {
                graph.updateNode(entry.nodeId, entry.patch);
                hasChanges = true;
            });

            if (
                updatedNodeIds.length > 0 &&
                typeof (graph as any).recomputeDynamicConnectorTyping === 'function'
            ) {
                (graph as any).recomputeDynamicConnectorTyping(updatedNodeIds);
            }
        });

        return hasChanges;
    }

    async loadCollection(collectionId: string): Promise<Collection | null> {
        if (!collectionId) {
            return null;
        }
        if (this.#collections.has(collectionId)) {
            return this.#collections.get(collectionId) || null;
        }
        const loaded = await this.#collectionStore.getCollection(collectionId);
        if (loaded) {
            const hadMigrationChanges = this.#applyRuntimeDefinitionMigration(loaded);
            // A variable or interrupt reference may outlive its declaration across a reload: reset
            // dangling references so the graph never opens in a state that no picker can reproduce.
            loaded.reconcileVarReferences();
            loaded.reconcileIrqReferences();
            if (typeof loaded.bumpVersionIfDirty === 'function') {
                const wasBumped = loaded.bumpVersionIfDirty() === true;
                this.#debugLog('loadCollection-bump-evaluated', {
                    collectionId: loaded.getId(),
                    hadMigrationChanges,
                    wasBumped,
                    nextVersion: loaded.getVersionString(),
                    dirty: loaded.getVersion().dirty,
                });
                if (wasBumped) {
                    await this.#collectionStore.saveCollection(loaded);
                    this.#debugLog('loadCollection-persisted-after-bump', {
                        collectionId: loaded.getId(),
                        persistedVersion: loaded.getVersionString(),
                    });
                }
            }
            this.#collections.set(loaded.getId(), loaded);
            this.#emitChange(
                'collectionAdded',
                new CollectionManagerCollectionChangedPayload(
                    'CollectionManager.CollectionAdded.v1',
                    loaded.getId()
                )
            );
        }
        return loaded || null;
    }

    getAnyCollection(): Collection | null {
        return this.#collections.values().next().value || null;
    }

    getActiveCollectionId(): string | null {
        return this.#activeCollectionId || null;
    }

    getActiveCollection(): Collection | null {
        if (!this.#activeCollectionId) {
            return null;
        }
        return this.getCollectionById(this.#activeCollectionId);
    }

    setActiveCollectionId(collectionId: string | null): void {
        if (collectionId && !this.#collections.has(collectionId)) {
            throw new Error(`Collection id "${collectionId}" does not exist`);
        }
        const nextId = collectionId || null;
        if (this.#activeCollectionId === nextId) {
            return;
        }
        this.#activeCollectionId = nextId;
        this.#emitChange(
            'activeCollectionChanged',
            new CollectionManagerActiveCollectionChangedPayload(nextId)
        );
    }

    async loadCollections(): Promise<Collection[]> {
        const storedCollections = await this.#collectionStore.listCollections();
        this.#collections.clear();
        for (const collection of storedCollections) {
            const hadMigrationChanges = this.#applyRuntimeDefinitionMigration(collection);
            collection.reconcileVarReferences();
            collection.reconcileIrqReferences();
            if (typeof collection.bumpVersionIfDirty === 'function') {
                const wasBumped = collection.bumpVersionIfDirty() === true;
                this.#debugLog('loadCollections-bump-evaluated', {
                    collectionId: collection.getId(),
                    hadMigrationChanges,
                    wasBumped,
                    nextVersion: collection.getVersionString(),
                    dirty: collection.getVersion().dirty,
                });
                if (wasBumped) {
                    await this.#collectionStore.saveCollection(collection);
                    this.#debugLog('loadCollections-persisted-after-bump', {
                        collectionId: collection.getId(),
                        persistedVersion: collection.getVersionString(),
                    });
                }
            }
            this.#collections.set(collection.getId(), collection);
        }
        return storedCollections;
    }

    getLastLoadRepairs(): CollectionRepairEntry[] {
        if (typeof this.#collectionStore.getLastLoadRepairs !== 'function') {
            return [];
        }
        return this.#collectionStore.getLastLoadRepairs();
    }

    async saveCollection(collection: Collection): Promise<void> {
        if (!collection || !(collection instanceof Collection)) {
            throw new Error('CollectionManager.saveCollection expects a Collection instance');
        }
        const isNew = !this.#collections.has(collection.getId());
        this.#collections.set(collection.getId(), collection);
        await this.#collectionStore.saveCollection(collection);
        this.#emitChange(
            isNew ? 'collectionAdded' : 'collectionUpdated',
            new CollectionManagerCollectionChangedPayload(
                isNew
                    ? 'CollectionManager.CollectionAdded.v1'
                    : 'CollectionManager.CollectionUpdated.v1',
                collection.getId()
            )
        );
    }

    async createCollection(options: CreateCollectionOptions = {}): Promise<Collection> {
        const runtimeId =
            typeof options.deviceRuntimeId === 'string'
                ? options.deviceRuntimeId
                : this.#defaultDeviceRuntimeId;
        if (!runtimeId) {
            throw new Error('CollectionManager.createCollection requires a deviceRuntimeId');
        }
        const useDefaultGraphs = !(Array.isArray(options.graphs) && options.graphs.length);
        const graphs = useDefaultGraphs
            ? [
                  new NodeGraph({ id: 'init-graph', name: 'Init', executionType: 'startup' }),
                  new NodeGraph({ id: 'graph-1', name: 'Graph 1', executionType: 'continuous' }),
              ]
            : options.graphs;
        const collectionGraphs = graphs as GraphSource[];
        const collection = new Collection({
            id: generateUuidV4(),
            title: options.title,
            targetId: options.targetId,
            deviceRuntimeId: runtimeId,
            graphs: collectionGraphs,
            activeGraphIdx: useDefaultGraphs ? 1 : 0,
        });
        await this.saveCollection(collection);
        if (options.setActive ?? true) {
            this.setActiveCollectionId(collection.getId());
        }
        return collection;
    }

    /**
     * Remove a graph from a collection, keeping at least one graph in it.
     *
     * When the removed graph is the only one, a replacement graph is added *before* the
     * removal so the collection is never observed without a graph. The change is persisted
     * through the regular autosave path: `Collection.removeGraph()` emits
     * `Collection.GraphRemoved.v1` and marks the collection dirty.
     *
     * @param {string} collectionId - Collection that owns the graph.
     * @param {string} graphId - Graph to remove.
     * @param {object} [options] - Removal options.
     * @param {string|null} [options.replacementBaseName='Graph'] - Replacement name base, or `null`.
     * @returns {boolean} True when a graph was removed.
     */
    removeGraph(
        collectionId: string,
        graphId: string,
        { replacementBaseName = 'Graph' }: RemoveGraphOptions = {}
    ): boolean {
        const collection = collectionId ? this.getCollectionById(collectionId) : null;
        if (!collection || !graphId || !this.#collectionHasGraph(collection, graphId)) {
            return false;
        }

        if (collection.getGraphArray().length <= 1) {
            if (replacementBaseName === null) {
                return false;
            }
            collection.addGraph(
                new NodeGraph({
                    id: collection.getUniqueGraphId(),
                    name: collection.getUniqueGraphName(replacementBaseName),
                })
            );
        }

        return collection.removeGraph(graphId);
    }

    /**
     * Move a graph inside a collection's persisted graph order.
     *
     * Delegates to `Collection.moveGraph()`, so the active graph stays active and the existing
     * autosave path persists the new order. Unknown collections or graphs are ignored.
     *
     * @param {string} collectionId - Collection that owns the graph.
     * @param {string} graphId - Graph to move.
     * @param {number} toIndex - Target index in the resulting graph array.
     * @returns {boolean} True when the order changed.
     */
    moveGraph(collectionId: string, graphId: string, toIndex: number): boolean {
        const collection = collectionId ? this.getCollectionById(collectionId) : null;
        if (!collection || !graphId || !this.#collectionHasGraph(collection, graphId)) {
            return false;
        }

        return collection.moveGraph(graphId, toIndex);
    }

    /**
     * Check whether a collection owns a graph, without throwing for unknown ids.
     * @param {Collection} collection - Collection to inspect.
     * @param {string} graphId - Graph id to look for.
     * @returns {boolean} True when the graph exists in the collection.
     * @private
     */
    #collectionHasGraph(collection: Collection, graphId: string): boolean {
        return Object.prototype.hasOwnProperty.call(collection.getGraphs(), graphId);
    }

    async deleteCollection(
        collectionId: string,
        { ensureActive = true }: DeleteCollectionOptions = {}
    ): Promise<void> {
        if (!collectionId) {
            return;
        }
        await this.#collectionStore.deleteCollection(collectionId);
        this.#removeCollection(collectionId);
        if (ensureActive && this.#activeCollectionId === null) {
            const next = this.getAnyCollection();
            if (next) {
                this.setActiveCollectionId(next.getId());
            } else if (this.#defaultDeviceRuntimeId) {
                await this.createCollection({ deviceRuntimeId: this.#defaultDeviceRuntimeId });
            }
        }
    }

    async clearCollections(): Promise<void> {
        await this.#collectionStore.clearCollections();
        this.#collections.clear();
        this.setActiveCollectionId(null);
    }

    discardCollection(collectionId: string): void {
        this.#removeCollection(collectionId);
    }

    #removeCollection(collectionId: string): void {
        if (!collectionId) {
            return;
        }
        const removed = this.#collections.delete(collectionId);
        if (!removed) {
            return;
        }
        if (this.#activeCollectionId === collectionId) {
            this.#activeCollectionId = null;
        }
        this.#emitChange(
            'collectionRemoved',
            new CollectionManagerCollectionChangedPayload(
                'CollectionManager.CollectionRemoved.v1',
                collectionId
            )
        );
    }

    serialize(): SerializedCollectionManagerData {
        return {
            activeCollectionId: this.#activeCollectionId || null,
        };
    }

    deserialize(data: DeserializedCollectionManagerData = {}): void {
        const nextId =
            typeof data.activeCollectionId === 'string' ? data.activeCollectionId.trim() : null;
        this.#activeCollectionId = nextId || null;
    }

    setRuntimeCollection(runtimeCollection: DeviceRuntimeCollectionLike | null): void {
        this.#runtimeCollection = runtimeCollection;
    }

    setTranspiler(transpiler: CollectionTranspiler | null): void {
        this.#transpiler = transpiler;
    }

    getActiveDeviceRuntime(): DeviceRuntimeLike | null {
        const activeCollection = this.getActiveCollection();
        if (!activeCollection) {
            return null;
        }

        const runtimeId = activeCollection.getDeviceRuntimeId?.() || null;
        if (!runtimeId || !this.#runtimeCollection) {
            return null;
        }

        return this.#runtimeCollection.getRuntime(runtimeId) || null;
    }

    getDeviceRuntimeForCollection(collection: Collection): DeviceRuntimeLike | null {
        if (!collection) {
            return null;
        }

        const runtimeId = collection.getDeviceRuntimeId?.() || null;
        if (!runtimeId || !this.#runtimeCollection) {
            return null;
        }

        return this.#runtimeCollection.getRuntime(runtimeId) || null;
    }

    async transpileActiveCollection(options: TranspileOptions = {}): Promise<TranspileResult> {
        const collection = this.getActiveCollection();
        if (!collection) {
            throw new Error('No active collection available for transpilation');
        }

        return this.transpileCollection(collection, options);
    }

    async transpileCollection(
        collection: Collection,
        { language = 'python', deviceRuntime = null }: TranspileOptions = {}
    ): Promise<TranspileResult> {
        if (!collection) {
            throw new Error('Collection is required for transpilation');
        }

        if (!this.#transpiler) {
            throw new Error('CollectionManager has no transpiler configured');
        }

        let wasBumped = false;
        if (typeof collection.bumpVersionIfDirty === 'function') {
            wasBumped = collection.bumpVersionIfDirty() === true;
        }

        if (wasBumped) {
            await this.saveCollection(collection);
        }

        const runtime = deviceRuntime || this.getDeviceRuntimeForCollection(collection);
        if (!runtime) {
            throw new Error('Device runtime not available for collection transpilation');
        }

        const capabilityErrors = await this._validateCapabilitiesForTranspile(collection, runtime);
        if (capabilityErrors.length > 0) {
            throw new Error(
                `Capability validation failed before transpilation:\n${capabilityErrors.join('\n')}`
            );
        }

        return this.#transpiler.transpile(collection, { language, deviceRuntime: runtime });
    }

    async _validateCapabilitiesForTranspile(
        collection: Collection,
        runtime: DeviceRuntimeLike
    ): Promise<string[]> {
        const errors: string[] = [];

        const getDeviceTarget = runtime.getDeviceTarget;
        if (typeof getDeviceTarget !== 'function') {
            return errors;
        }

        const targetId = collection.getTargetId();
        const target = targetId ? getDeviceTarget.call(runtime, targetId) : null;
        if (!target || typeof target !== 'object') {
            return errors;
        }

        const targetInfo =
            target instanceof DeviceTargetInfo
                ? target
                : new DeviceTargetInfo({
                      id: targetId,
                      ...(target as Record<string, unknown>),
                  });

        const capabilities = {
            capabilityToPins: targetInfo.capabilityToPins || {},
            generalCapabilities: targetInfo.generalCapabilities || {},
            metadata: targetInfo.metadata || {},
        };

        const graphs = collection.getGraphArray();
        for (const graph of graphs) {
            const graphName =
                (typeof graph.getName === 'function' ? graph.getName() : null) ||
                (typeof graph.getId === 'function' ? graph.getId() : null) ||
                'graph';
            const rawNodes = graph.getNodes?.() || [];
            const nodes = Array.isArray(rawNodes) ? rawNodes : Object.values(rawNodes);

            const nodeTypesByNodeId: Record<string, Record<string, unknown> | null> = {};
            for (const node of nodes) {
                if (!node || typeof node !== 'object') {
                    continue;
                }
                const nodeId = (node as { id?: unknown }).id;
                const typeId = (node as { type?: unknown }).type;
                if (typeof nodeId !== 'string' || typeof typeId !== 'string') {
                    continue;
                }
                nodeTypesByNodeId[nodeId] =
                    (runtime.getNodeType?.(typeId) as Record<string, unknown> | null) || null;
            }

            for (const node of nodes) {
                if (!node || typeof node !== 'object') {
                    continue;
                }
                const typeId = (node as { type?: unknown }).type;
                if (typeof typeId !== 'string') {
                    continue;
                }
                const nodeType = runtime.getNodeType?.(typeId) || null;
                if (!nodeType) {
                    continue;
                }
                const validation = validateNodeCapabilities({
                    node: node as Record<string, unknown>,
                    nodeType: nodeType as Record<string, unknown>,
                    capabilities,
                    targetId,
                });
                const nodeId = (node as { id?: unknown }).id;
                const nodeLabel = `node '${String(nodeId)}' (${typeId})`;
                for (const issue of validation.issues) {
                    errors.push(`${graphName} → ${nodeLabel}: ${issue.message}`);
                }
            }

            const graphIssues = validateGraphResources({
                target: targetInfo,
                graphNodes: nodes.filter(
                    (entry) => entry && typeof entry === 'object'
                ) as Record<string, unknown>[],
                nodeTypesByNodeId,
            });
            for (const issue of graphIssues) {
                const nodeRef = issue.nodeId ? `node '${issue.nodeId}'` : 'graph';
                errors.push(`${graphName} → ${nodeRef}: ${issue.message}`);
            }
        }

        return errors;
    }

    getNodePackages(): unknown[] {
        const runtime = this.getActiveDeviceRuntime();
        return runtime?.getNodePackages?.() || [];
    }

    getNodeType(typeId: string): unknown | null {
        const runtime = this.getActiveDeviceRuntime();
        return runtime?.getNodeType?.(typeId) || null;
    }

    listAvailableRuntimes(): Array<{ id: string; name: string }> {
        if (!this.#runtimeCollection) {
            return [];
        }
        const runtimes: Array<{ id: string; name: string }> = [];
        for (const [runtimeId, runtime] of this.#runtimeCollection.runtimesById) {
            runtimes.push({
                id: runtimeId,
                name: runtime?.name || runtimeId,
            });
        }
        return runtimes;
    }

    listTargetsForRuntime(runtimeId: string): Array<{ id: string; name: string }> {
        if (!this.#runtimeCollection || !runtimeId) {
            return Array.from(this.#userTargetsById.values());
        }
        const runtime = this.#runtimeCollection.getRuntime(runtimeId);
        if (!runtime) {
            return Array.from(this.#userTargetsById.values());
        }
        const targets = runtime.getAvailableTargets().map((target) => ({
            id: target.id,
            name: target.displayName || target.id,
        }));

        const targetIds = new Set(targets.map((target) => target.id));
        for (const userTarget of this.#userTargetsById.values()) {
            if (targetIds.has(userTarget.id)) {
                continue;
            }
            targets.push(userTarget);
        }

        const image = {
            buildBaseTargetId: this.#buildBaseTargetId,
            allowedWebTargetIds: this.#allowedWebTargetIds,
        };
        if (image.buildBaseTargetId || image.allowedWebTargetIds !== null) {
            return targets.filter((target) =>
                isTargetCompatibleWithImage(target.id, image, runtime)
            );
        }

        return targets;
    }

    #emitChange(name: string, payload: AppPayload): void {
        this.emit(name, payload);
    }
}
