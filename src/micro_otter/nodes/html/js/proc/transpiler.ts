// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Transpiler class for converting node graphs to executable Python code.
 *
 * The Transpiler takes node graphs from a collection and converts them to Python code
 * that runs on MicroPython devices. It handles dependency resolution, code generation,
 * and output formatting.
 *
 * **Architecture:**
 * - Depends on V2 data backbone (Collection, NodeGraph, NodeData)
 * - Emits progress events via ProgressEventBus
 * - Uses transpiler-helpers.js for pure utility functions
 * - Tracks collection version to determine when re-transpilation is needed
 *
 * **Progress Events:**
 * - START: Transpilation begins
 * - UPDATE: Per-graph progress updates
 * - COMPLETE: Transpilation succeeded
 * - ERROR: Transpilation failed with error details
 *
 * @module proc/transpiler
 */

import {
    createOutputVariableName,
    getNullLiteral,
    formatLiteral,
    indentMultiLine,
    createObjectLiteral,
    buildOutputConnectionLookup,
    buildInputConnectionLookup,
    computeConnectorMetadata,
    getTopologicallySortedNodeIds,
    getTopologicallySortedNodeIdsForExecutionPhase,
    getPhaseCompatibleConnections,
    registerImportStatement,
    registerPythonFunctionImport,
    renderTemplate,
    resolveGlobalFunction,
    buildAssignmentStatement,
    cloneNodeForGenerator,
    sanitizeGraphFunctionName,
} from './transpiler-helpers.js';
import {
    clampSleepDuration,
    normalizeExecutionType,
    normalizeSignalNames,
    normalizeTriggerName,
} from '../data/graph-execution-settings.js';
import type { ExecutionType } from '../data/graph-execution-settings.js';
import { resolveTypeCompatibility } from '../data/type-conversions.js';
import {
    FUNCTION_NODE_PACKAGE_ID,
    buildFunctionNodeDefinition,
    buildStructuralNodeDefinition,
    isFunctionNodeTypeId,
    resolveFunctionGraphId,
} from '../data/function-node-definition.js';
import {
    buildFunctionParameterNames,
    normalizeFunctionSignature,
} from '../data/graph-function-signature.js';
import type { FunctionSignature } from '../data/graph-function-signature.js';
import {
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_OUTPUT_NODE_TYPE,
    isFunctionStructuralNodeType,
} from '../data/graph-function-nodes.js';

import { ProgressTracker } from '../core/progress-events.js';

type TranspilerLanguage = 'python';

type CollectionVersionLike = string | number | { toString: () => string } | null | undefined;

type TranspilerLogger = {
    debug?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    log?: (...args: unknown[]) => void;
};

type NodeConnectorLike = {
    id?: string;
    name?: string;
    phase?: unknown;
    allowedTypes?: string[];
    outputType?: string;
    defaultControl?: {
        default?: unknown;
        value?: unknown;
        defaultValue?: unknown;
    };
};

type NodeControlLike = {
    id?: string;
};

type NodeDataLike = {
    title?: string;
    executionPhase?: unknown;
    inputs: NodeConnectorLike[];
    outputs: NodeConnectorLike[];
    controls?: NodeControlLike[];
    controlValues?: Record<string, unknown>;
    inputDefaults?: Record<string, unknown>;
    getId: () => string;
    getType: () => string;
};

type GraphConnectionLike = {
    fromNode: string;
    fromIndex: number;
    toNode: string;
    toIndex: number;
};

type ExecutionPlanPhase = 'init' | 'loop';

type PhaseConnectionLike = GraphConnectionLike & {
    outputPhase?: unknown;
    inputPhase?: unknown;
};

type NodeGraphLike = {
    getId?: () => string;
    getName?: () => string;
    getDataTypeKind?: (typeId: string) => 'value' | 'structure';
    getNodes: () => Record<string, NodeDataLike> | NodeDataLike[];
    getConnections: () => GraphConnectionLike[];
    getTriggerInterval?: () => number | string | null | undefined;
    getExecutionType?: () => unknown;
    getTriggerName?: () => unknown;
    getSignalNames?: () => unknown;
    getSignalMode?: () => unknown;
    getRunOnStart?: () => unknown;
    getEnabled?: () => boolean;
    /** Declared function signature; only function graphs provide one. */
    getFunctionSignature?: () => unknown;
};

type CollectionLike = {
    getId?: () => string;
    getTitle?: () => string;
    getVersionString?: () => string;
    getWebAssetGenerationMode?: () => 'compressed' | 'plain';
    getVersion: () => CollectionVersionLike;
    getGraphs: () => Record<string, unknown> | unknown[];
};

type RuntimeImplementation =
    | {
          type: 'regex' | 'function' | 'code-generator';
          value: string;
          imports?: string[];
          initFunction?: string;
      }
    | {
          /**
           * Structural function node: contributes variable mappings and, for the output
           * node, one statement (the `return ...`). It never emits a call of its own.
           */
          type: 'structural';
          outputs?: string[];
          statement?: string;
          imports?: string[];
          initFunction?: string;
      };

type HelperRuntimeImplementation = {
    type: 'helper-generator';
    value: string;
    helperGroup?: string;
};

type NodeDefinitionLike = {
    packageId?: string;
    executionPhase?: unknown;
    inputs?: NodeConnectorLike[];
    outputs?: NodeConnectorLike[];
    implementations?: Partial<Record<TranspilerLanguage | string, RuntimeImplementation>>;
    initImplementations?: Partial<Record<TranspilerLanguage | string, RuntimeImplementation>>;
    helperImplementations?: Partial<
        Record<TranspilerLanguage | string, HelperRuntimeImplementation>
    >;
    initFunction?: string;
    mpAssets?: string[];
    mpModuleRoots?: string[];
};

type DeviceRuntimeLike = {
    id?: string;
    version?: string;
    getNodeType?: (nodeType: string) => NodeDefinitionLike | null | undefined;
    getNodeDefinition?: (nodeType: string) => NodeDefinitionLike | null | undefined;
};

type ConnectorMetaEntry = {
    id?: string;
    name?: string;
    connected?: boolean;
    varName?: string;
};

type ConnectorMetadata = {
    inputsMeta?: ConnectorMetaEntry[];
    outputsMeta?: ConnectorMetaEntry[];
};

type TemplateContextValue = string | number | boolean | null | undefined | string[];

type TemplateContext = {
    nodeId: string;
    nodeType: string;
    title: string;
    inputs: string[];
    [key: string]: TemplateContextValue;
};

type InputLookupMap = Map<string, Record<number, { fromNode: string; fromIndex: number }>>;

type InputSourceReference = {
    fromNode: string;
    fromIndex: number;
    toIndex: number;
};

type OutputRegistryEntry = {
    varName: string;
    outputType: string;
};

type OutputRegistry = Map<string, OutputRegistryEntry>;

type PackageAssetEntry = {
    files: Set<string>;
    moduleRoots: Set<string>;
};

type NormalizedInitContribution = {
    initBlock: string | null;
    initPriority: number;
    executeBlock: string | null;
    order: number;
};

type GraphBlock = {
    name: string;
    executionType: ExecutionType;
    /**
     * `function` blocks are emitted as `async def` bodies and never scheduled; `graph`
     * blocks keep the existing startup/loop/event treatment.
     */
    kind: 'graph' | 'function';
    /** Graph id the block was transpiled from; `null` for anonymous graph mocks. */
    graphId: string | null;
    /** Declared parameter names of a `function` block, in signature order. */
    parameters: string[];
    /** `return ...` emitted after the body of a `function` block, otherwise `null`. */
    returnStatement: string | null;
    /** Whether the hoisted `_init_<functionName>` coroutine is emitted and awaited. */
    emitInit: boolean;
    initStatements: string[];
    sharedInitStatementsByFunction: Map<string, NormalizedInitContribution[]>;
    preLoopStatements: string[];
    statements: string[];
    /** Cadence period in milliseconds; `0` means "yield only, never wait". */
    intervalMs: number;
    /** Trimmed interrupt trigger name when `executionType === 'irq'`, otherwise `null`. */
    irqTriggerName: string | null;
    /** Watched signal names when `executionType === 'event'`, otherwise `[]`. */
    signalNames: string[];
    /** Signal trigger mode when `executionType === 'event'`, otherwise `'any'`. */
    signalMode: 'any' | 'all';
    /** Whether an event graph also runs once at startup. */
    runOnStart: boolean;
    /** Listener key (the graph id) used for `_signals.define`/`wait`. */
    signalKey: string;
    helperContributions: NormalizedHelperContribution[];
};

type TranspileAssets = {
    packages: Record<string, { files: string[]; moduleRoots: string[] }>;
    generatedArtifacts?: GeneratedCollectionArtifact[];
};

type GeneratedCollectionArtifact = {
    targetPath: string;
    content: string | Uint8Array;
    contentType?: string;
    contentEncoding?: 'identity' | 'gzip';
    role?: string;
};

type NormalizedHelperContribution = {
    schemaVersion: 'transpiler-helper-contribution/v1';
    helperGroup: string;
    priority: number;
    orderKey: string;
    data: Record<string, unknown>;
    artifacts: GeneratedCollectionArtifact[];
    webserverSpecPatch: Record<string, unknown>;
    sourceOrder: number;
};

type TranspilerHelperGroupHandoff = {
    mergedData: Record<string, unknown>;
    artifacts: GeneratedCollectionArtifact[];
    webserverSpecPatch: Record<string, unknown>;
};

type TranspilerHelperHandoffV1 = {
    schemaVersion: 'transpiler-helper-handoff/v1';
    helperGroups: Record<string, TranspilerHelperGroupHandoff>;
};

type HelperGroupConsumerContext = {
    language: TranspilerLanguage;
    helperGroup: string;
    group: {
        mergedData: Record<string, unknown>;
        artifacts: GeneratedCollectionArtifact[];
        webserverSpecPatch: Record<string, unknown>;
    };
    helperHandoff: TranspilerHelperHandoffV1;
    collection: {
        id: string | null;
        title: string | null;
        version: string | null;
        webAssetGenerationMode: 'compressed' | 'plain';
    };
    helpers: {
        formatLiteral: (value: unknown) => string;
        createObjectLiteral: (payload: Record<string, unknown>) => string;
    };
};

type HelperGroupConsumerResult = {
    artifacts?: GeneratedCollectionArtifact[];
};

type TranspileResult = {
    code: string;
    assets: TranspileAssets;
    generatedArtifacts?: GeneratedCollectionArtifact[];
    helperHandoff?: TranspilerHelperHandoffV1;
};

type CodeGeneratorResult = {
    expression: string | null;
    statement: string | null;
    outputs: string[];
    imports: string[];
    commentOnlySuppressed: boolean;
    init: {
        block: string | null;
        priority: number | null;
        execute: string | null;
    } | null;
};

type NodeTranspileResult = {
    init: string | null;
    initFunctionName: string | null;
    initContribution: NormalizedInitContribution | null;
    preLoop: string | null;
    loop: string | null;
    /**
     * Statement a structural function node contributes to the end of a function body
     * (the output node's `return ...`); `null` for every other node.
     */
    returnStatement: string | null;
};

/**
 * Stable message ids of the function-graph validation errors.
 *
 * Phase 7 documents these verbatim; tests and the UI match on the id, so the human text
 * may change while the id stays. Each id is also the locale key suffix the UI will use.
 */
export const FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS = {
    /** A function graph contains a call node of itself. */
    selfCall: 'function-graph-self-call',
    /** The call graph contains a cycle through two or more function graphs. */
    cycle: 'function-graph-cycle',
    /** A call node targets an existing function graph that is disabled. */
    disabledCallee: 'function-graph-callee-disabled',
    /** A call node targets a graph id the collection does not contain. */
    unknownCallee: 'function-graph-callee-unknown',
    /** A call node's connectors no longer match the callee's signature. */
    portCountMismatch: 'function-graph-port-count-mismatch',
    /** The signature declares outputs but the graph has no output node. */
    missingOutputNode: 'function-graph-missing-output-node',
    /** A structural input/output node lives in a graph that is not a function graph. */
    structuralInNonFunctionGraph: 'function-graph-structural-in-non-function-graph',
} as const;

/** Union of the ids in {@link FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS}. */
export type FunctionGraphValidationMessageId =
    (typeof FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS)[keyof typeof FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS];

/**
 * Validation failure with a stable message id and structured details.
 *
 * The message keeps the human-readable text (prefixed with the id, so logs stay
 * greppable); `messageId` and `details` are what callers and tests match on.
 */
export class GraphValidationError extends Error {
    /** Stable id from {@link FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS}. */
    readonly messageId: FunctionGraphValidationMessageId;

    /** Names and counts that make the failure actionable. */
    readonly details: Record<string, unknown>;

    /**
     * @param messageId - Stable message id.
     * @param message - Human-readable description.
     * @param details - Graph, node and port names for the message.
     */
    constructor(
        messageId: FunctionGraphValidationMessageId,
        message: string,
        details: Record<string, unknown> = {}
    ) {
        super(`[${messageId}] ${message}`);
        this.name = 'GraphValidationError';
        this.messageId = messageId;
        this.details = details;
    }
}

type TranspilerOptions = {
    logger?: TranspilerLogger;
};

/**
 * Whether generated code contains anything Python will actually execute.
 *
 * Node generators may legitimately contribute comments only: the HA bridge is configured
 * in `init_mqtt` and the MQTT will is published by the runtime, so their loop
 * implementation is a comment. The transpiler additionally prefixes every node with a
 * `# <title> [<type>]` comment, so a graph built from such nodes has a body made of
 * comments alone. Emitting that body unchanged produces an indented block without a
 * statement, which `mpy-cross` (and CPython) rejects with `SyntaxError: invalid syntax`,
 * and the whole generated `main_loop.py` then fails to load - the app never runs, so
 * nothing is ever registered with Home Assistant. Emitters therefore fall back to `pass`.
 *
 * @param statements - Generated blocks, possibly empty, blank or comment-only
 * @returns True when at least one line is neither blank nor a `#` comment
 */
function hasExecutableStatement(
    statements: Array<string | null | undefined> | undefined
): boolean {
    if (!Array.isArray(statements)) {
        return false;
    }

    return statements.some((statement) => {
        if (typeof statement !== 'string') {
            return false;
        }
        return statement.split(/\r?\n/).some((line) => {
            const trimmed = line.trim();
            return trimmed.length > 0 && !trimmed.startsWith('#');
        });
    });
}

/**
 * Transpiler class for converting node graphs to executable Python code.
 *
 * @example
 * const transpiler = new Transpiler({
 *   logger: console
 * });
 *
 * try {
 *   const { code, assets } = await transpiler.transpile(collection, { deviceRuntime });
 *   logger.info('Generated code', code);
 *   logger.info('Assets', assets);
 * } catch (error) {
 *   console.error('Transpilation failed:', error);
 * }
 */
export class Transpiler {
    #logger: TranspilerLogger;

    #lastGeneratedCode: string | null;

    #lastGeneratedAssets: TranspileAssets | null;

    #lastTranspileDate: number | null;

    #lastCollectionId: string | null;

    #lastCollectionVersion: CollectionVersionLike;

    #usedGraphNames: Set<string>;

    #activeDataTypeKindResolver: ((typeId: string) => 'value' | 'structure') | null;

    /**
     * Generated Python function name of the graph currently being transpiled; the scope token for
     * generator-owned module-level names. Valid only during the `#transpileGraph()` call that sets
     * it, like `#activeDataTypeKindResolver`.
     */
    #activeGraphScope: string | null;

    /** Enabled graphs of the current run, by graph id; function definitions resolve through it. */
    #graphsById: Map<string, NodeGraphLike>;

    /** Every graph of the current run, including disabled ones; call validation needs them. */
    #allGraphsById: Map<string, NodeGraphLike>;

    /** Deterministic `_fn_`/`_init_` names per function graph id (D11). */
    #functionNamesByGraphId: Map<string, { functionName: string; initName: string }>;

    /** Function graphs reachable from a scheduled graph; only those hoist an init (D12). */
    #reachableFunctionGraphIds: Set<string>;

    /** Signature of the graph being validated or transpiled; structural nodes mirror it. */
    #activeFunctionSignature: FunctionSignature | null;

    /** Runtime of the current run; `#resolveNodeDefinition()` falls back to it. */
    #activeDeviceRuntime: DeviceRuntimeLike | null;

    /**
     * Create a new Transpiler instance.
     *
     * @param {{
     *   logger?: object
     * }} options - Configuration options
     * @param {object} [options.logger=console] - Logger instance for debug output
     */
    constructor({ logger = console }: TranspilerOptions = {}) {
        this.#logger = logger;
        this.#lastGeneratedCode = null;
        this.#lastGeneratedAssets = null;
        this.#lastTranspileDate = null;
        this.#lastCollectionId = null;
        this.#lastCollectionVersion = null;
        this.#usedGraphNames = new Set();
        this.#activeDataTypeKindResolver = null;
        this.#activeGraphScope = null;
        this.#graphsById = new Map();
        this.#allGraphsById = new Map();
        this.#functionNamesByGraphId = new Map();
        this.#reachableFunctionGraphIds = new Set();
        this.#activeFunctionSignature = null;
        this.#activeDeviceRuntime = null;
    }

    /**
     * Transpile all graphs in a collection to Python code.
     *
     * This is the main entry point for transpilation. It validates the collection,
     * processes all graphs, and assembles the final executable code.
     *
     * **Progress Events:**
     * - Emits START at beginning
     * - Emits UPDATE for each graph processed
     * - Emits COMPLETE on success
     * - Emits ERROR on failure
     *
     * @param {object} collection - Collection instance to transpile
     * @param {{
     *   language?: string,
     *   deviceRuntime: object
     * }} [options] - Transpilation options
     * @param {string} [options.language='python'] - Target language (currently only 'python')
     * @param {object} options.deviceRuntime - Device runtime instance for node definitions
     * @returns {Promise<{code: string, assets: object}>} Generated code and assets
     * @throws {Error} If validation fails or transpilation errors occur
     * @throws {Error} `Collection has no graphs to transpile` when the collection is empty
     * @throws {Error} `Collection has no enabled graphs to transpile` when every graph is disabled
     *
     * @example
     * const result = await transpiler.transpile(collection, { deviceRuntime });
     * logger.info(result.code); // Python code string
     * logger.info(result.assets.imports); // Required imports
     */
    async transpile(
        collection: CollectionLike,
        {
            language = 'python',
            deviceRuntime,
        }: { language?: string; deviceRuntime: DeviceRuntimeLike }
    ): Promise<TranspileResult> {
        const tracker = new ProgressTracker('transpiler', 5);
        const collectionId = collection?.getId?.();
        const collectionTitle = collection?.getTitle?.();
        const collectionVersion = collection?.getVersionString?.();
        const runtimeInfo = deviceRuntime
            ? { id: deviceRuntime.id, version: deviceRuntime.version }
            : null;

        try {
            tracker.start('Starting transpilation...');

            if (this.#logger && typeof this.#logger.debug === 'function') {
                this.#logger.debug('[Transpiler] start', {
                    collectionId,
                    collectionTitle,
                    collectionVersion,
                    language,
                    hasDeviceRuntime: Boolean(deviceRuntime),
                    runtime: runtimeInfo,
                });
            }

            // 1. Validate inputs
            if (!collection) {
                throw new Error('No collection provided');
            }

            if (language !== 'python') {
                throw new Error(
                    `Unsupported language: ${language}. Only 'python' is currently supported.`
                );
            }

            if (!deviceRuntime) {
                throw new Error('Device runtime is required for transpilation');
            }

            // Reset per-run state so graph function names stay deterministic.
            this.#usedGraphNames = new Set();

            // 2. Get graphs
            const allGraphs = Object.values(collection.getGraphs() || {}) as NodeGraphLike[];
            if (!allGraphs || allGraphs.length === 0) {
                throw new Error('Collection has no graphs to transpile');
            }

            // Disabled graphs stay in the collection (and in the deployment payload) but
            // contribute nothing to the generated code, so they are dropped before
            // validation and code generation run.
            const graphs = allGraphs.filter((graph) => this.#isGraphEnabled(graph));
            if (graphs.length === 0) {
                throw new Error('Collection has no enabled graphs to transpile');
            }

            // Function graphs need their emitted names and their callee definitions before
            // anything is emitted: the pre-pass assigns every name up front, so a call site and
            // its definition agree regardless of the iteration order (D11).
            this.#allGraphsById = new Map(
                allGraphs
                    .map((graph) => [graph.getId?.() ?? '', graph] as const)
                    .filter(([graphId]) => graphId.length > 0)
            );
            this.#graphsById = new Map(
                graphs
                    .map((graph) => [graph.getId?.() ?? '', graph] as const)
                    .filter(([graphId]) => graphId.length > 0)
            );
            this.#functionNamesByGraphId = this.#assignFunctionNames(graphs);
            this.#reachableFunctionGraphIds = this.#collectReachableFunctionGraphIds(graphs);
            this.#activeDeviceRuntime = deviceRuntime;

            tracker.update('Validating graph structure...', 1);

            // 3. Validate the function call graph first: its messages (disabled, removed,
            // mismatched or recursive callees) are more specific than the generic
            // "missing node definition" path a generated call node would otherwise take.
            this.#validateFunctionCalls(graphs);

            // 3b. Validate all graphs (fail fast)
            for (const graph of graphs) {
                this.#validateGraph(graph, language, deviceRuntime);
            }

            // 3c. Validate cross-graph trigger bindings (interrupt names).
            this.#validateTriggerBindings(graphs, deviceRuntime);

            // 4. Transpile each graph
            const graphBlocks: GraphBlock[] = [];
            const importCollector = new Set<string>();
            importCollector.add('import uasyncio as asyncio');
            const packageAssets = new Map<string, PackageAssetEntry>();
            const sharedInitStatementsByFunction = new Map<string, NormalizedInitContribution[]>();
            let sharedInitContributionOrder = 0;
            const helperContributions: NormalizedHelperContribution[] = [];
            let helperContributionOrder = 0;

            for (let i = 0; i < graphs.length; i++) {
                const graph = graphs[i];
                const graphName = graph.getName?.() || `graph_${i + 1}`;
                tracker.update(`Processing graph ${graphName}...`, 2 + i);

                const graphCode = await this.#transpileGraph(
                    graph,
                    language,
                    deviceRuntime,
                    importCollector,
                    packageAssets
                );

                if (!graphCode) {
                    // Empty graphs are ignored: they contain no nodes and produce no code.
                    continue;
                }

                graphBlocks.push(graphCode);
                graphCode.sharedInitStatementsByFunction.forEach((contributions, functionName) => {
                    if (!sharedInitStatementsByFunction.has(functionName)) {
                        sharedInitStatementsByFunction.set(functionName, []);
                    }

                    const targetContributions = sharedInitStatementsByFunction.get(functionName);
                    if (!targetContributions) {
                        return;
                    }

                    contributions.forEach((contribution) => {
                        if (!contribution) {
                            return;
                        }

                        const normalizedInitBlock =
                            typeof contribution.initBlock === 'string'
                                ? contribution.initBlock.trim()
                                : '';
                        const normalizedExecuteBlock =
                            typeof contribution.executeBlock === 'string'
                                ? contribution.executeBlock.trim()
                                : '';
                        if (!normalizedInitBlock && !normalizedExecuteBlock) {
                            return;
                        }

                        targetContributions.push({
                            initBlock: normalizedInitBlock || null,
                            initPriority: Number.isFinite(contribution.initPriority)
                                ? Math.floor(contribution.initPriority)
                                : 100,
                            executeBlock: normalizedExecuteBlock || null,
                            order: sharedInitContributionOrder,
                        });
                        sharedInitContributionOrder += 1;
                    });
                });

                graphCode.helperContributions.forEach((contribution) => {
                    helperContributions.push({
                        ...contribution,
                        sourceOrder: helperContributionOrder,
                    });
                    helperContributionOrder += 1;
                });
            }

            tracker.update('Assembling final code...', 4);

            // 5. Assemble final program
            const code = this.#assemblePythonProgram(
                graphBlocks,
                importCollector,
                sharedInitStatementsByFunction
            );

            // 6. Build assets structure
            const assets: TranspileAssets = { packages: {} };
            packageAssets.forEach((entry, pkgId) => {
                const files = Array.from(entry.files || [])
                    .filter(Boolean)
                    .sort();
                const moduleRoots = Array.from(entry.moduleRoots || [])
                    .filter(Boolean)
                    .sort();

                if (files.length > 0 || moduleRoots.length > 0) {
                    assets.packages[pkgId] = { files, moduleRoots };
                }
            });

            const helperHandoff = this.#buildHelperHandoff(helperContributions);
            this.#logger.debug?.('[Transpiler] helper-handoff-built', {
                helperContributionCount: helperContributions.length,
                helperGroupCount: Object.keys(helperHandoff.helperGroups || {}).length,
                helperGroups: Object.keys(helperHandoff.helperGroups || {}).sort(),
            });

            const helperContributionArtifacts =
                this.#collectGeneratedArtifactsFromHelperHandoff(helperHandoff);
            this.#logger.debug?.('[Transpiler] helper-contribution-artifacts-collected', {
                count: helperContributionArtifacts.length,
                targetPaths: helperContributionArtifacts.map((artifact) => artifact.targetPath),
            });

            const helperConsumerArtifacts = await this.#executeHelperGroupConsumers(
                helperHandoff,
                collection,
                language
            );
            this.#logger.debug?.('[Transpiler] helper-consumer-artifacts-collected', {
                count: helperConsumerArtifacts.length,
                targetPaths: helperConsumerArtifacts.map((artifact) => artifact.targetPath),
            });

            const generatedArtifacts = this.#mergeGeneratedArtifacts(
                helperContributionArtifacts,
                helperConsumerArtifacts,
                'helper group consumer'
            );
            this.#logger.debug?.('[Transpiler] generated-artifacts-merged', {
                helperContributionArtifactCount: helperContributionArtifacts.length,
                helperConsumerArtifactCount: helperConsumerArtifacts.length,
                mergedArtifactCount: generatedArtifacts.length,
            });
            if (generatedArtifacts.length > 0) {
                assets.generatedArtifacts = generatedArtifacts;
            }

            // 7. Store results and version
            this.#lastGeneratedCode = code;
            this.#lastGeneratedAssets = assets;
            this.#lastTranspileDate = Date.now();
            this.#lastCollectionId = collection.getId?.() ?? null;
            this.#lastCollectionVersion = collection.getVersion();

            tracker.complete('Transpilation complete');

            return {
                code: this.#lastGeneratedCode,
                assets: this.#lastGeneratedAssets,
                generatedArtifacts: generatedArtifacts.length > 0 ? generatedArtifacts : undefined,
                helperHandoff,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            if (this.#logger && typeof this.#logger.error === 'function') {
                this.#logger.error('[Transpiler] failed', {
                    message: errorMessage,
                    stack: errorStack,
                    collectionId,
                    collectionTitle,
                    collectionVersion,
                    language,
                    runtime: runtimeInfo,
                });
            }
            tracker.error('Transpilation failed', error);
            throw error;
        }
    }

    /**
     * Transpile a single node graph to Python code.
     *
     * This method processes one graph, validates its structure, sorts nodes
     * topologically, and generates executable code for each node.
     *
     * @param {object} graph - NodeGraph instance to transpile
     * @param {string} language - Target language
     * @param {object} deviceRuntime - Device runtime for node definitions
     * @param {Set} importCollector - Set to collect import statements
     * @param {Map} packageAssets - Map to collect package assets
     * @returns {Promise<{name: string, executionType: string, initStatements: string[], preLoopStatements: string[], statements: string[], intervalMs: number, irqTriggerName: string | null} | null>} Graph function data, or null when the graph is empty and therefore ignored
     * @throws {Error} If graph has cycles or other structural issues
     * @private
     *
     * @example
     * const graphData = await transpiler.#transpileGraph(myGraph, 'python', deviceRuntime, imports, assets);
     */
    async #transpileGraph(
        graph: NodeGraphLike,
        language: TranspilerLanguage,
        deviceRuntime: DeviceRuntimeLike,
        importCollector: Set<string>,
        packageAssets: Map<string, PackageAssetEntry>
    ): Promise<GraphBlock | null> {
        this.#activeDataTypeKindResolver =
            typeof graph.getDataTypeKind === 'function'
                ? (typeId: string) => graph.getDataTypeKind?.(typeId) ?? 'value'
                : null;

        const nodesObj = graph.getNodes();

        // Convert nodes object to array
        const nodes = (
            Array.isArray(nodesObj) ? nodesObj : Object.values(nodesObj)
        ) as NodeDataLike[];

        const connections = graph.getConnections();
        const graphName = graph.getName?.() || graph.getId?.() || 'graph';
        const executionType = normalizeExecutionType(graph.getExecutionType?.());
        const irqTriggerName =
            executionType === 'irq' ? normalizeTriggerName(graph.getTriggerName?.()) : null;
        const isEvent = executionType === 'event';
        const signalNames = isEvent ? normalizeSignalNames(graph.getSignalNames?.()) : [];
        const signalMode =
            isEvent && graph.getSignalMode?.() === 'all' ? ('all' as const) : ('any' as const);
        const runOnStart = isEvent ? graph.getRunOnStart?.() !== false : true;
        const signalKey = isEvent ? (graph.getId?.() || graphName) : '';

        const isFunctionGraph = executionType === 'function';
        const graphId = graph.getId?.() ?? null;
        const functionNames =
            isFunctionGraph && graphId ? this.#functionNamesByGraphId.get(graphId) ?? null : null;
        const signature = isFunctionGraph
            ? normalizeFunctionSignature(
                  (graph as NodeGraphLike & { getFunctionSignature?: () => unknown })
                      .getFunctionSignature?.()
              )
            : null;
        if (signature) {
            // Structural nodes of this graph mirror exactly this signature.
            this.#activeFunctionSignature = signature;
        }

        if (nodes.length === 0) {
            if (!isFunctionGraph || !functionNames) {
                // Empty graphs are ignored: they produce no executable code.
                return null;
            }
            // A function graph is published even without nodes: the palette lists it, so a
            // call site must resolve. Declared outputs without an output node are rejected
            // by validation, so an empty body can only return `None`.
            return this.#createEmptyFunctionBlock(graph, functionNames.functionName, graphId);
        }

        // The emitted function name doubles as the scope token for generator-owned module-level
        // names, so `async def <name>()` and `_irq_<scope>_<id>` can never drift apart. Function
        // graphs use the name the pre-pass assigned, so a call site and its definition agree.
        const graphFunctionName = functionNames
            ? functionNames.functionName
            : sanitizeGraphFunctionName(graphName, 'graph', this.#usedGraphNames);
        this.#activeGraphScope = graphFunctionName;

        const nodeMap = new Map<string, NodeDataLike>(nodes.map((n) => [n.getId(), n]));
        const nodeDefinitionById = new Map<string, NodeDefinitionLike | null>();

        nodes.forEach((node) => {
            nodeDefinitionById.set(node.getId(), this.#resolveNodeDefinition(node.getType()));
        });

        // Build connection lookups
        const inputLookup = buildInputConnectionLookup(connections);
        const outputLookup = buildOutputConnectionLookup(connections);

        const phaseConnections = connections.map((connection) => {
            const sourceNode = nodeMap.get(connection.fromNode);
            const targetNode = nodeMap.get(connection.toNode);
            const sourceDefinition = nodeDefinitionById.get(connection.fromNode) || null;
            const targetDefinition = nodeDefinitionById.get(connection.toNode) || null;
            const sourceOutput =
                sourceNode?.outputs?.[connection.fromIndex] ||
                sourceDefinition?.outputs?.[connection.fromIndex];
            const targetInput =
                targetNode?.inputs?.[connection.toIndex] ||
                targetDefinition?.inputs?.[connection.toIndex];

            return {
                ...connection,
                outputPhase: sourceOutput?.phase,
                inputPhase: targetInput?.phase,
            } as PhaseConnectionLike;
        });

        const phaseNodes = nodes.map((node) => ({
            id: node.getId(),
            executionPhase:
                node.executionPhase ?? nodeDefinitionById.get(node.getId())?.executionPhase,
        }));

        // Compute connector metadata
        const connectorMeta = computeConnectorMetadata(
            nodes.map((node) => ({
                id: node.getId(),
                inputs: node.inputs,
                outputs: node.outputs,
            })),
            inputLookup,
            outputLookup
        );

        const helperContributions = this.#collectGraphHelperContributions(
            graph,
            language,
            nodeMap,
            connections,
            connectorMeta,
            deviceRuntime
        );

        // Build phase-specific execution plans from one DAG
        const initOrderedNodeIds = getTopologicallySortedNodeIdsForExecutionPhase(
            phaseNodes,
            phaseConnections,
            'init'
        );
        const loopOrderedNodeIds = getTopologicallySortedNodeIdsForExecutionPhase(
            phaseNodes,
            phaseConnections,
            'loop'
        );

        // Transpile nodes in phase order
        const initStatements: string[] = [];
        const sharedInitStatementsByFunction = new Map<string, NormalizedInitContribution[]>();
        const preLoopStatements: string[] = [];
        const loopStatements: string[] = [];
        // Structural function output nodes contribute the body's `return ...` (D14).
        const returnStatements: string[] = [];
        const outputRegistry: OutputRegistry = new Map();
        const lifecyclePreludeEmittedNodeIds = new Set<string>();
        let localSharedInitContributionOrder = 0;

        const emitExecutionPlan = async (
            orderedNodeIds: string[],
            executionPhase: ExecutionPlanPhase,
            targetStatements: string[]
        ): Promise<void> => {
            const phaseConnectionsForExecution = getPhaseCompatibleConnections(
                phaseNodes,
                phaseConnections,
                executionPhase
            ).flatMap((connection) => {
                const fromIndex = Number.isFinite(connection.fromIndex)
                    ? Math.floor(Number(connection.fromIndex))
                    : null;
                const toIndex = Number.isFinite(connection.toIndex)
                    ? Math.floor(Number(connection.toIndex))
                    : null;
                if (fromIndex === null || toIndex === null) {
                    return [];
                }

                return [
                    {
                        fromNode: connection.fromNode,
                        fromIndex,
                        toNode: connection.toNode,
                        toIndex,
                    },
                ];
            });

            const phaseInputLookup = buildInputConnectionLookup(phaseConnectionsForExecution);

            const emitNode = async (
                nodeId: string,
                targetBuffer: string[]
            ): Promise<void> => {
                const node = nodeMap.get(nodeId);
                if (!node) {
                    return;
                }

                const nodeTitle = node.title || node.getType() || 'node';
                targetBuffer.push(`# ${nodeTitle} [${node.getType()}]`);

                try {
                    const result = await this.#transpileNode(
                        node,
                        graph,
                        language,
                        phaseInputLookup,
                        inputLookup,
                        outputLookup,
                        outputRegistry,
                        importCollector,
                        packageAssets,
                        connectorMeta.get(nodeId)
                    );

                    if (!lifecyclePreludeEmittedNodeIds.has(nodeId)) {
                        if (result.initFunctionName) {
                            if (!sharedInitStatementsByFunction.has(result.initFunctionName)) {
                                sharedInitStatementsByFunction.set(result.initFunctionName, []);
                            }

                            const targetContributions = sharedInitStatementsByFunction.get(
                                result.initFunctionName
                            );
                            if (targetContributions && result.initContribution) {
                                const isDuplicateContribution = targetContributions.some(
                                    (existing) =>
                                        existing.initBlock === result.initContribution?.initBlock &&
                                        existing.executeBlock ===
                                            result.initContribution?.executeBlock &&
                                        existing.initPriority ===
                                            result.initContribution?.initPriority
                                );

                                if (!isDuplicateContribution) {
                                    targetContributions.push({
                                        ...result.initContribution,
                                        order: localSharedInitContributionOrder,
                                    });
                                    localSharedInitContributionOrder += 1;
                                }
                            }
                        } else if (result.init) {
                            initStatements.push(result.init);
                        }
                        if (result.preLoop) {
                            preLoopStatements.push(result.preLoop);
                        }
                        lifecyclePreludeEmittedNodeIds.add(nodeId);
                    }

                    if (result.returnStatement) {
                        // Emitted after the body, never in the middle of it.
                        returnStatements.push(result.returnStatement);
                    } else if (result.loop) {
                        targetBuffer.push(result.loop);
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(
                        `Failed to transpile node ${nodeId} (${nodeTitle}): ${message}`
                    );
                }
            };

            for (const nodeId of orderedNodeIds) {
                await emitNode(nodeId, targetStatements);
            }
        };

        await emitExecutionPlan(initOrderedNodeIds, 'init', initStatements);
        await emitExecutionPlan(loopOrderedNodeIds, 'loop', loopStatements);

        const returnStatement = isFunctionGraph
            ? returnStatements.length > 0
                ? returnStatements[returnStatements.length - 1]
                : 'return None'
            : null;

        return {
            name: graphFunctionName,
            executionType,
            kind: isFunctionGraph ? 'function' : 'graph',
            graphId,
            parameters:
                isFunctionGraph && signature
                    ? buildFunctionParameterNames(signature.inputs)
                    : [],
            returnStatement,
            emitInit:
                isFunctionGraph &&
                !!graphId &&
                this.#reachableFunctionGraphIds.has(graphId) &&
                initStatements.length + preLoopStatements.length > 0,
            irqTriggerName,
            signalNames,
            signalMode,
            runOnStart,
            signalKey,
            initStatements,
            sharedInitStatementsByFunction,
            preLoopStatements,
            statements: loopStatements,
            intervalMs: this.#getGraphIntervalMs(graph),
            helperContributions,
        };
    }

    /**
     * Build the block of a function graph that has no nodes.
     *
     * The palette lists every enabled function graph, so its definition must exist even
     * when the body is empty; validation already rejected declared outputs without an
     * output node, so the body can only `return None`.
     *
     * @param graph - Function graph without nodes.
     * @param functionName - Pre-pass Python name of the function.
     * @param graphId - Graph id, or `null` for an anonymous mock.
     * @returns A function block with an empty body.
     * @private
     */
    #createEmptyFunctionBlock(
        graph: NodeGraphLike,
        functionName: string,
        graphId: string | null
    ): GraphBlock {
        const signature = normalizeFunctionSignature(
            (graph as NodeGraphLike & { getFunctionSignature?: () => unknown })
                .getFunctionSignature?.()
        );

        return {
            name: functionName,
            executionType: 'function',
            kind: 'function',
            graphId,
            parameters: buildFunctionParameterNames(signature.inputs),
            returnStatement: 'return None',
            emitInit: false,
            irqTriggerName: null,
            signalNames: [],
            signalMode: 'any',
            runOnStart: true,
            signalKey: '',
            initStatements: [],
            sharedInitStatementsByFunction: new Map(),
            preLoopStatements: [],
            statements: [],
            intervalMs: 0,
            helperContributions: [],
        };
    }

    #collectGraphHelperContributions(
        graph: NodeGraphLike,
        language: TranspilerLanguage,
        nodeMap: Map<string, NodeDataLike>,
        connections: GraphConnectionLike[],
        connectorMeta: Map<string, ConnectorMetadata>,
        deviceRuntime: DeviceRuntimeLike
    ): NormalizedHelperContribution[] {
        const nodesForSort = Array.from(nodeMap.values()).map((node) => ({ id: node.getId() }));
        const orderedNodeIds = getTopologicallySortedNodeIds(nodesForSort, connections);
        const inputLookup = buildInputConnectionLookup(connections);
        const helperContributions: NormalizedHelperContribution[] = [];

        orderedNodeIds.forEach((nodeId) => {
            const nodeData = nodeMap.get(nodeId);
            if (!nodeData) {
                return;
            }

            const nodeType = nodeData.getType();
            const nodeDefinition =
                (deviceRuntime.getNodeType && deviceRuntime.getNodeType(nodeType)) ||
                (deviceRuntime.getNodeDefinition && deviceRuntime.getNodeDefinition(nodeType));

            if (!nodeDefinition) {
                return;
            }

            const helperImpl = nodeDefinition.helperImplementations?.[language];
            if (!helperImpl) {
                return;
            }

            if (helperImpl.type !== 'helper-generator') {
                throw new Error(
                    `Node type "${nodeType}" has invalid helper implementation type "${String(helperImpl.type)}"; expected "helper-generator"`
                );
            }

            const outputVars = nodeData.outputs.map((_output, idx) =>
                createOutputVariableName(nodeData.getId(), idx)
            );
            const inputRefs = this.#resolveHelperInputReferences(nodeData, inputLookup);

            try {
                const rawContribution = this.#executeHelperGenerator(
                    helperImpl.value,
                    language,
                    graph,
                    nodeData,
                    inputRefs,
                    outputVars,
                    connectorMeta.get(nodeId)
                );

                const normalized = this.#normalizeHelperContribution(
                    rawContribution,
                    helperImpl,
                    nodeData,
                    helperImpl.value
                );

                if (normalized) {
                    helperContributions.push(normalized);
                }
            } catch (error) {
                const graphName = graph.getName?.() || graph.getId?.() || 'unknown';
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                    `Failed helper generator for node ${nodeData.getId()} (${nodeType}) in graph "${graphName}": ${message}`
                );
            }
        });

        return helperContributions;
    }

    #resolveHelperInputReferences(nodeData: NodeDataLike, inputLookup: InputLookupMap): string[] {
        const nodeId = nodeData.getId();
        const incoming = inputLookup.get(nodeId) || {};
        const nullLiteral = getNullLiteral();

        return nodeData.inputs.map((input, idx) => {
            const wiring = incoming[idx];
            if (!wiring) {
                return this.#getInputDefaultLiteral(nodeData, input, idx) ?? nullLiteral;
            }

            return createOutputVariableName(wiring.fromNode, wiring.fromIndex);
        });
    }

    #executeHelperGenerator(
        generatorPath: string,
        language: TranspilerLanguage,
        graph: NodeGraphLike,
        nodeData: NodeDataLike,
        inputRefs: string[],
        outputVars: string[],
        connectorMeta: ConnectorMetadata | undefined
    ): unknown {
        const generatorFn = resolveGlobalFunction(generatorPath);
        if (typeof generatorFn !== 'function') {
            throw new Error(`Generator function "${generatorPath}" was not found`);
        }

        const inputsMeta = Array.isArray(connectorMeta?.inputsMeta)
            ? connectorMeta.inputsMeta.map((entry) => ({ ...entry }))
            : [];

        const outputsMeta = Array.isArray(connectorMeta?.outputsMeta)
            ? connectorMeta.outputsMeta.map((entry) => ({ ...entry }))
            : [];

        const context = {
            language,
            // `scope` is the graph's emitted function name (null outside a `#transpileGraph()` call);
            // generators use it to keep module-level names unique across merged shared-init blocks.
            graph: {
                id: graph?.getId?.() || null,
                name: graph?.getName?.() || null,
                scope: this.#activeGraphScope,
            },
            node: cloneNodeForGenerator(nodeData),
            inputs: Array.isArray(inputRefs) ? inputRefs.slice() : [],
            outputs: Array.isArray(outputVars) ? outputVars.slice() : [],
            inputsMeta,
            outputsMeta,
            helpers: {
                getNullLiteral: () => getNullLiteral(),
                formatLiteral: (value: unknown) => formatLiteral(value),
                createOutputName: (index: number) =>
                    createOutputVariableName(nodeData.getId(), index),
                createObjectLiteral: (payload: Record<string, unknown>) =>
                    createObjectLiteral(payload),
            },
        };

        return generatorFn(context);
    }

    #normalizeHelperContribution(
        rawContribution: unknown,
        helperImpl: HelperRuntimeImplementation,
        nodeData: NodeDataLike,
        generatorPath: string
    ): NormalizedHelperContribution | null {
        if (rawContribution === null || rawContribution === undefined) {
            return null;
        }

        if (!this.#isPlainObject(rawContribution)) {
            throw new Error(
                `Helper generator "${generatorPath}" for node "${nodeData.getId()}" must return an object`
            );
        }

        const schemaVersion = rawContribution.schemaVersion;
        if (schemaVersion !== 'transpiler-helper-contribution/v1') {
            throw new Error(
                `Helper generator "${generatorPath}" must set schemaVersion to "transpiler-helper-contribution/v1"`
            );
        }

        const explicitGroup =
            typeof rawContribution.helperGroup === 'string'
                ? rawContribution.helperGroup.trim()
                : '';
        const fallbackGroup =
            typeof helperImpl.helperGroup === 'string' ? helperImpl.helperGroup.trim() : '';
        const helperGroup = explicitGroup || fallbackGroup;
        if (!helperGroup) {
            throw new Error(
                `Helper generator "${generatorPath}" must provide helperGroup (payload.helperGroup or node definition helperGroup)`
            );
        }

        const priority = Number.isFinite(rawContribution.priority)
            ? Math.floor(Number(rawContribution.priority))
            : 100;
        const orderKey =
            typeof rawContribution.orderKey === 'string' ? rawContribution.orderKey.trim() : '';

        let data: Record<string, unknown> = {};
        if (rawContribution.data !== undefined) {
            if (!this.#isPlainObject(rawContribution.data)) {
                throw new Error(
                    `Helper generator "${generatorPath}" returned invalid data payload; expected object`
                );
            }
            data = { ...rawContribution.data };
        }

        let webserverSpecPatch: Record<string, unknown> = {};
        if (rawContribution.webserverSpecPatch !== undefined) {
            if (!this.#isPlainObject(rawContribution.webserverSpecPatch)) {
                throw new Error(
                    `Helper generator "${generatorPath}" returned invalid webserverSpecPatch; expected object`
                );
            }
            webserverSpecPatch = { ...rawContribution.webserverSpecPatch };
        }

        let artifacts: GeneratedCollectionArtifact[] = [];
        if (rawContribution.artifacts !== undefined) {
            if (!Array.isArray(rawContribution.artifacts)) {
                throw new Error(
                    `Helper generator "${generatorPath}" returned invalid artifacts; expected array`
                );
            }

            artifacts = rawContribution.artifacts.map((artifact, idx) =>
                this.#normalizeGeneratedArtifact(artifact, generatorPath, idx)
            );
        }

        return {
            schemaVersion: 'transpiler-helper-contribution/v1',
            helperGroup,
            priority,
            orderKey,
            data,
            artifacts,
            webserverSpecPatch,
            sourceOrder: 0,
        };
    }

    #normalizeGeneratedArtifact(
        artifact: unknown,
        generatorPath: string,
        artifactIndex: number
    ): GeneratedCollectionArtifact {
        if (!this.#isPlainObject(artifact)) {
            throw new Error(
                `Helper generator "${generatorPath}" artifact #${artifactIndex} must be an object`
            );
        }

        const targetPath =
            typeof artifact.targetPath === 'string' ? artifact.targetPath.trim() : '';
        if (!targetPath) {
            throw new Error(
                `Helper generator "${generatorPath}" artifact #${artifactIndex} is missing targetPath`
            );
        }

        const content = artifact.content;
        if (!(typeof content === 'string' || content instanceof Uint8Array)) {
            throw new Error(
                `Helper generator "${generatorPath}" artifact #${artifactIndex} has invalid content type`
            );
        }

        const normalized: GeneratedCollectionArtifact = {
            targetPath,
            content,
        };

        if (typeof artifact.contentType === 'string' && artifact.contentType.trim()) {
            normalized.contentType = artifact.contentType.trim();
        }

        if (artifact.contentEncoding !== undefined) {
            if (artifact.contentEncoding !== 'identity' && artifact.contentEncoding !== 'gzip') {
                throw new Error(
                    `Helper generator "${generatorPath}" artifact #${artifactIndex} has invalid contentEncoding`
                );
            }
            normalized.contentEncoding = artifact.contentEncoding;
        }

        if (typeof artifact.role === 'string' && artifact.role.trim()) {
            normalized.role = artifact.role.trim();
        }

        return normalized;
    }

    #isPlainObject(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    #buildHelperHandoff(
        helperContributions: NormalizedHelperContribution[]
    ): TranspilerHelperHandoffV1 {
        if (!Array.isArray(helperContributions) || helperContributions.length === 0) {
            return this.#buildEmptyHelperHandoff();
        }

        const sortedContributions = helperContributions.slice().sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            if (a.orderKey !== b.orderKey) {
                return a.orderKey.localeCompare(b.orderKey);
            }
            return a.sourceOrder - b.sourceOrder;
        });

        const helperGroups: Record<string, TranspilerHelperGroupHandoff> = {};

        sortedContributions.forEach((contribution) => {
            const groupName = contribution.helperGroup;
            if (!helperGroups[groupName]) {
                helperGroups[groupName] = {
                    mergedData: {},
                    artifacts: [],
                    webserverSpecPatch: {},
                };
            }

            const group = helperGroups[groupName];

            Object.entries(contribution.data || {}).forEach(([key, value]) => {
                if (
                    Object.prototype.hasOwnProperty.call(group.mergedData, key) &&
                    !this.#areEquivalentHelperValues(group.mergedData[key], value)
                ) {
                    throw new Error(
                        `Helper group "${groupName}" has conflicting data key "${key}"`
                    );
                }
                group.mergedData[key] = value;
            });

            Object.entries(contribution.webserverSpecPatch || {}).forEach(([key, value]) => {
                if (
                    Object.prototype.hasOwnProperty.call(group.webserverSpecPatch, key) &&
                    !this.#areEquivalentHelperValues(group.webserverSpecPatch[key], value)
                ) {
                    throw new Error(
                        `Helper group "${groupName}" has conflicting webserverSpecPatch key "${key}"`
                    );
                }
                group.webserverSpecPatch[key] = value;
            });

            contribution.artifacts.forEach((artifact) => {
                const existing = group.artifacts.find(
                    (candidate) => candidate.targetPath === artifact.targetPath
                );

                if (existing && !this.#areEquivalentArtifacts(existing, artifact)) {
                    throw new Error(
                        `Helper group "${groupName}" has conflicting artifact targetPath "${artifact.targetPath}"`
                    );
                }

                if (!existing) {
                    group.artifacts.push(artifact);
                }
            });
        });

        return {
            schemaVersion: 'transpiler-helper-handoff/v1',
            helperGroups,
        };
    }

    async #executeHelperGroupConsumers(
        helperHandoff: TranspilerHelperHandoffV1,
        collection: CollectionLike,
        language: TranspilerLanguage
    ): Promise<GeneratedCollectionArtifact[]> {
        const generatedArtifacts: GeneratedCollectionArtifact[] = [];
        const helperGroups = helperHandoff.helperGroups || {};
        const groupNames = Object.keys(helperGroups).sort();

        for (const groupName of groupNames) {
            const consumer = this.#resolveHelperGroupConsumer(groupName);
            if (typeof consumer !== 'function') {
                this.#logger.debug?.('[Transpiler] helper-group-consumer-missing', {
                    helperGroup: groupName,
                });
                continue;
            }

            const group = helperGroups[groupName];
            const context: HelperGroupConsumerContext = {
                language,
                helperGroup: groupName,
                group: {
                    mergedData: { ...(group?.mergedData || {}) },
                    artifacts: Array.isArray(group?.artifacts) ? group.artifacts.slice() : [],
                    webserverSpecPatch: { ...(group?.webserverSpecPatch || {}) },
                },
                helperHandoff,
                collection: {
                    id: collection?.getId?.() ?? null,
                    title: collection?.getTitle?.() ?? null,
                    version:
                        typeof collection?.getVersionString?.() === 'string'
                            ? collection.getVersionString()
                            : String(collection?.getVersion?.() ?? ''),
                    webAssetGenerationMode:
                        collection?.getWebAssetGenerationMode?.() === 'plain'
                            ? 'plain'
                            : 'compressed',
                },
                helpers: {
                    formatLiteral: (value: unknown) => formatLiteral(value),
                    createObjectLiteral: (payload: Record<string, unknown>) =>
                        createObjectLiteral(payload),
                },
            };

            const startedAt = Date.now();
            this.#logger.debug?.('[Transpiler] helper-group-consumer-start', {
                helperGroup: groupName,
                mergedDataKeys: Object.keys(context.group.mergedData || {}).length,
                handoffArtifacts: Array.isArray(context.group.artifacts)
                    ? context.group.artifacts.length
                    : 0,
                webserverSpecPatchKeys: Object.keys(context.group.webserverSpecPatch || {}),
            });

            const rawResult = await this.#resolveConsumerResult(consumer(context));
            const normalized = this.#normalizeHelperGroupConsumerResult(rawResult, groupName);
            const normalizedArtifacts = normalized.artifacts || [];
            generatedArtifacts.push(...normalizedArtifacts);

            this.#logger.debug?.('[Transpiler] helper-group-consumer-complete', {
                helperGroup: groupName,
                producedArtifacts: normalizedArtifacts.length,
                durationMs: Date.now() - startedAt,
            });
        }

        return generatedArtifacts;
    }

    async #resolveConsumerResult(result: unknown): Promise<unknown> {
        if (
            result &&
            (typeof result === 'object' || typeof result === 'function') &&
            typeof (result as { then?: unknown }).then === 'function'
        ) {
            return await (result as Promise<unknown>);
        }

        return result;
    }

    #resolveHelperGroupConsumer(
        helperGroup: string
    ): ((context: HelperGroupConsumerContext) => unknown) | null {
        const globalScope = globalThis as {
            NodeHelperHandoffConsumers?: Record<string, unknown>;
        };

        const registry = globalScope.NodeHelperHandoffConsumers;
        if (!registry || typeof registry !== 'object') {
            return null;
        }

        const candidate = registry[helperGroup];
        return typeof candidate === 'function'
            ? (candidate as (context: HelperGroupConsumerContext) => unknown)
            : null;
    }

    #normalizeHelperGroupConsumerResult(
        rawResult: unknown,
        helperGroup: string
    ): HelperGroupConsumerResult {
        if (rawResult === null || rawResult === undefined) {
            return { artifacts: [] };
        }

        if (!this.#isPlainObject(rawResult)) {
            throw new Error(`Helper group consumer "${helperGroup}" must return an object`);
        }

        const normalized: HelperGroupConsumerResult = { artifacts: [] };

        if (rawResult.artifacts !== undefined) {
            if (!Array.isArray(rawResult.artifacts)) {
                throw new Error(
                    `Helper group consumer "${helperGroup}" returned invalid artifacts; expected array`
                );
            }

            normalized.artifacts = rawResult.artifacts.map((artifact, idx) =>
                this.#normalizeGeneratedArtifact(
                    artifact,
                    `NodeHelperHandoffConsumers[${helperGroup}]`,
                    idx
                )
            );
        }

        return normalized;
    }

    #mergeGeneratedArtifacts(
        baseArtifacts: GeneratedCollectionArtifact[],
        additionalArtifacts: GeneratedCollectionArtifact[],
        additionalSourceLabel: string
    ): GeneratedCollectionArtifact[] {
        const merged = Array.isArray(baseArtifacts) ? baseArtifacts.slice() : [];

        (Array.isArray(additionalArtifacts) ? additionalArtifacts : []).forEach((artifact) => {
            const existing = merged.find(
                (candidate) => candidate.targetPath === artifact.targetPath
            );
            if (existing && !this.#areEquivalentArtifacts(existing, artifact)) {
                throw new Error(
                    `Conflicting generated artifact targetPath from ${additionalSourceLabel}: "${artifact.targetPath}"`
                );
            }

            if (!existing) {
                merged.push(artifact);
            }
        });

        return merged;
    }

    #collectGeneratedArtifactsFromHelperHandoff(
        helperHandoff: TranspilerHelperHandoffV1
    ): GeneratedCollectionArtifact[] {
        const artifactsByPath = new Map<string, GeneratedCollectionArtifact>();

        Object.values(helperHandoff.helperGroups || {}).forEach((group) => {
            group.artifacts.forEach((artifact) => {
                const existing = artifactsByPath.get(artifact.targetPath);
                if (existing && !this.#areEquivalentArtifacts(existing, artifact)) {
                    throw new Error(
                        `Conflicting generated artifact targetPath across helper groups: "${artifact.targetPath}"`
                    );
                }

                if (!existing) {
                    artifactsByPath.set(artifact.targetPath, artifact);
                }
            });
        });

        return Array.from(artifactsByPath.values());
    }

    #areEquivalentArtifacts(
        left: GeneratedCollectionArtifact,
        right: GeneratedCollectionArtifact
    ): boolean {
        if (left.targetPath !== right.targetPath) {
            return false;
        }
        if (left.contentType !== right.contentType) {
            return false;
        }
        if (left.contentEncoding !== right.contentEncoding) {
            return false;
        }
        if (left.role !== right.role) {
            return false;
        }

        if (typeof left.content === 'string' && typeof right.content === 'string') {
            return left.content === right.content;
        }

        if (left.content instanceof Uint8Array && right.content instanceof Uint8Array) {
            if (left.content.length !== right.content.length) {
                return false;
            }
            for (let i = 0; i < left.content.length; i += 1) {
                if (left.content[i] !== right.content[i]) {
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    #areEquivalentHelperValues(left: unknown, right: unknown): boolean {
        if (Object.is(left, right)) {
            return true;
        }

        if (left instanceof Uint8Array && right instanceof Uint8Array) {
            if (left.length !== right.length) {
                return false;
            }
            for (let i = 0; i < left.length; i += 1) {
                if (left[i] !== right[i]) {
                    return false;
                }
            }
            return true;
        }

        if (this.#isPlainObject(left) && this.#isPlainObject(right)) {
            const leftKeys = Object.keys(left).sort();
            const rightKeys = Object.keys(right).sort();
            if (leftKeys.length !== rightKeys.length) {
                return false;
            }

            for (let i = 0; i < leftKeys.length; i += 1) {
                if (leftKeys[i] !== rightKeys[i]) {
                    return false;
                }
                const key = leftKeys[i];
                if (!this.#areEquivalentHelperValues(left[key], right[key])) {
                    return false;
                }
            }

            return true;
        }

        if (Array.isArray(left) && Array.isArray(right)) {
            if (left.length !== right.length) {
                return false;
            }
            for (let i = 0; i < left.length; i += 1) {
                if (!this.#areEquivalentHelperValues(left[i], right[i])) {
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    /**
     * Resolve the loop interval of a graph in milliseconds.
     *
     * Delegates to the shared interval rules so the generated cadence matches the
     * value the settings surfaces show: floored, clamped into `0 … MAX_SLEEP_MS`,
     * and `DEFAULT_SLEEP_MS` when the graph exposes no usable value. `0` is a
     * valid interval and means "yield once per iteration".
     *
     * @param {object} graph - Graph being transpiled.
     * @returns {number} Whole milliseconds to use as the cadence period.
     * @private
     */
    #getGraphIntervalMs(graph: NodeGraphLike): number {
        return clampSleepDuration(graph?.getTriggerInterval?.());
    }

    /**
     * Decide whether a graph takes part in transpilation.
     *
     * Graphs without an `enabled` accessor are treated as enabled so structural
     * graph mocks and third-party graph objects keep working unchanged.
     *
     * @param {object} graph - Candidate graph.
     * @returns {boolean} True when the graph should be transpiled.
     * @private
     */
    #isGraphEnabled(graph: NodeGraphLike): boolean {
        return typeof graph.getEnabled === 'function' ? graph.getEnabled() !== false : true;
    }

    /**
     * Read a graph's nodes as an array.
     * @param graph - Graph to read.
     * @returns The nodes in graph order, never `null`.
     * @private
     */
    #graphNodes(graph: NodeGraphLike): NodeDataLike[] {
        const nodesObj = graph.getNodes?.();
        return (Array.isArray(nodesObj) ? nodesObj : Object.values(nodesObj ?? {})) as NodeDataLike[];
    }

    /**
     * Assign the deterministic Python names of every function graph (D11).
     *
     * `sanitizeGraphFunctionName()` already guarantees uniqueness against the shared
     * `#usedGraphNames` set, so a graph coroutine can never take a function name and a
     * function name can never take a graph name, whichever is emitted first. Two graphs
     * named `Foo` and `foo` therefore stay distinct.
     *
     * @param graphs - Enabled graphs of the run, in collection order.
     * @returns `graphId → { functionName, initName }`, in pre-pass order.
     * @private
     */
    #assignFunctionNames(
        graphs: NodeGraphLike[]
    ): Map<string, { functionName: string; initName: string }> {
        const names = new Map<string, { functionName: string; initName: string }>();

        for (const graph of graphs) {
            if (normalizeExecutionType(graph.getExecutionType?.()) !== 'function') {
                continue;
            }
            const graphId = graph.getId?.() ?? '';
            if (!graphId) {
                continue;
            }
            const graphName = graph.getName?.() || graphId;
            const sanitized = sanitizeGraphFunctionName(graphName, 'fn', this.#usedGraphNames);
            const functionName = `_fn_${sanitized}`;
            names.set(graphId, { functionName, initName: `_init_${functionName}` });
        }

        return names;
    }

    /**
     * Collect the function graphs a graph calls directly.
     * @param graph - Graph whose node types are inspected.
     * @returns Callee graph ids, de-duplicated, in node order.
     * @private
     */
    #collectCalledFunctionGraphIds(graph: NodeGraphLike): string[] {
        const called = new Set<string>();

        for (const node of this.#graphNodes(graph)) {
            const typeId = node.getType?.() ?? '';
            if (!isFunctionNodeTypeId(typeId)) {
                continue;
            }
            const graphId = resolveFunctionGraphId(typeId);
            if (graphId) {
                called.add(graphId);
            }
        }

        return Array.from(called);
    }

    /**
     * Collect the function graphs reachable from the scheduled graphs (D12).
     *
     * Only these hoist an init coroutine, so an unused function graph never initializes
     * hardware. Disabled graphs are already filtered out of `graphs`, so a call to one
     * contributes no edge here (call validation rejects it separately).
     *
     * @param graphs - Enabled graphs of the run.
     * @returns Reachable function graph ids.
     * @private
     */
    #collectReachableFunctionGraphIds(graphs: NodeGraphLike[]): Set<string> {
        const edges = new Map<string, string[]>();
        const roots: string[] = [];

        for (const graph of graphs) {
            const graphId = graph.getId?.() ?? '';
            if (!graphId) {
                continue;
            }
            edges.set(graphId, this.#collectCalledFunctionGraphIds(graph));
            if (normalizeExecutionType(graph.getExecutionType?.()) !== 'function') {
                roots.push(graphId);
            }
        }

        const reachable = new Set<string>();
        const queue = [...roots];
        while (queue.length > 0) {
            const graphId = queue.shift() as string;
            for (const calleeId of edges.get(graphId) ?? []) {
                if (reachable.has(calleeId)) {
                    continue;
                }
                reachable.add(calleeId);
                queue.push(calleeId);
            }
        }

        return reachable;
    }

    /**
     * Resolve the definition of a node type for the current run (D13).
     *
     * Generated function nodes win over the runtime for `function_graph.*` ids, so a runtime
     * package can never shadow a call node; the two structural function node types are
     * generated from the signature of the graph being transpiled; every other id keeps the
     * runtime lookup unchanged.
     *
     * @param typeId - Node type id of the node.
     * @returns The definition, or `null` when nothing provides it.
     * @private
     */
    #resolveNodeDefinition(typeId: string): NodeDefinitionLike | null {
        if (isFunctionStructuralNodeType(typeId)) {
            const kind = typeId === FUNCTION_INPUT_NODE_TYPE ? 'input' : 'output';
            return {
                packageId: FUNCTION_NODE_PACKAGE_ID,
                implementations: {
                    python: buildStructuralNodeDefinition(kind, this.#activeFunctionSignature),
                },
            } as NodeDefinitionLike;
        }

        if (isFunctionNodeTypeId(typeId)) {
            const graphId = resolveFunctionGraphId(typeId);
            const graph = graphId ? this.#graphsById.get(graphId) ?? null : null;
            if (!graph || !graphId) {
                return null;
            }
            const pythonFunctionName =
                this.#functionNamesByGraphId.get(graphId)?.functionName ?? null;
            return buildFunctionNodeDefinition(graph, {
                pythonFunctionName,
            }) as NodeDefinitionLike;
        }

        const runtime = this.#activeDeviceRuntime;
        return (
            (runtime?.getNodeType?.(typeId) ?? null) ||
            (runtime?.getNodeDefinition?.(typeId) ?? null)
        );
    }

    /**
     * Validate the function call graph (D10, D15).
     *
     * Reports stale, non-function and disabled callees, a call node whose connectors no
     * longer match the callee's signature, direct self-reference and transitive cycles.
     * Every failure carries a stable message id from
     * {@link FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS} plus the graph and node names.
     *
     * @param graphs - Enabled graphs of the run.
     * @throws {GraphValidationError} On the first invalid call.
     * @private
     */
    #validateFunctionCalls(graphs: NodeGraphLike[]): void {
        const edges = new Map<string, string[]>();
        const graphNameById = new Map<string, string>();

        for (const graph of graphs) {
            const graphId = graph.getId?.() ?? '';
            if (!graphId) {
                continue;
            }
            const graphName = graph.getName?.() || graphId;
            graphNameById.set(graphId, graphName);

            for (const node of this.#graphNodes(graph)) {
                const typeId = node.getType?.() ?? '';
                if (!isFunctionNodeTypeId(typeId)) {
                    continue;
                }
                const calleeId = resolveFunctionGraphId(typeId);
                if (!calleeId) {
                    continue;
                }

                const details = {
                    graphId,
                    graphName,
                    nodeId: node.getId?.() ?? null,
                    calleeGraphId: calleeId,
                    calleeTypeId: typeId,
                };
                const callee = this.#allGraphsById.get(calleeId) ?? null;
                const calleeName = callee?.getName?.() || calleeId;

                if (
                    !callee ||
                    normalizeExecutionType(callee.getExecutionType?.()) !== 'function'
                ) {
                    throw new GraphValidationError(
                        FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.unknownCallee,
                        `Graph "${graphName}" calls "${calleeName}", which is not a function graph of this collection; delete the node or re-create the function.`,
                        details
                    );
                }

                if (!this.#isGraphEnabled(callee)) {
                    throw new GraphValidationError(
                        FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.disabledCallee,
                        `Graph "${graphName}" calls "${calleeName}", which is disabled; enable the function or delete the call node.`,
                        details
                    );
                }

                const signature = normalizeFunctionSignature(callee.getFunctionSignature?.());
                const inputCount = Array.isArray(node.inputs) ? node.inputs.length : 0;
                if (inputCount !== signature.inputs.length) {
                    throw new GraphValidationError(
                        FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.portCountMismatch,
                        `Function "${calleeName}" declares ${signature.inputs.length} input(s), but the call node in graph "${graphName}" has ${inputCount} connector(s); re-create the node so its connectors match the signature.`,
                        {
                            ...details,
                            expectedInputs: signature.inputs.length,
                            actualInputs: inputCount,
                        }
                    );
                }
            }

            edges.set(graphId, this.#collectCalledFunctionGraphIds(graph));
        }

        // Direct self-reference gets its own message so it can name the graph.
        for (const [graphId, calls] of edges) {
            if (calls.includes(graphId)) {
                const graphName = graphNameById.get(graphId) ?? graphId;
                throw new GraphValidationError(
                    FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.selfCall,
                    `Function graph "${graphName}" calls itself; a function cannot recurse.`,
                    { graphId, graphName }
                );
            }
        }

        // Transitive cycles: depth-first walk over the call graph, keeping the current path.
        const visiting = new Set<string>();
        const finished = new Set<string>();
        const walk = (graphId: string, path: string[]): void => {
            if (finished.has(graphId)) {
                return;
            }
            if (visiting.has(graphId)) {
                const cycle = [...path.slice(path.indexOf(graphId)), graphId];
                const names = cycle.map((id) => graphNameById.get(id) ?? id);
                throw new GraphValidationError(
                    FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.cycle,
                    `Function graphs call each other in a cycle: ${names.join(' → ')}.`,
                    { graphIds: cycle, graphNames: names }
                );
            }

            visiting.add(graphId);
            path.push(graphId);
            for (const calleeId of edges.get(graphId) ?? []) {
                walk(calleeId, path);
            }
            path.pop();
            visiting.delete(graphId);
            finished.add(graphId);
        };
        for (const graphId of edges.keys()) {
            walk(graphId, []);
        }
    }

    /**
     * Validate the signature/output-node contract of a function graph (D10).
     *
     * Declaring outputs without an output node would promise values the body never returns,
     * so it is rejected even when the graph has no nodes at all. Declared inputs without an
     * input node are legal: the parameters are simply unused.
     *
     * @param graph - Graph under validation.
     * @param graphName - Display name for the message.
     * @param nodes - The graph's nodes.
     * @param isFunctionGraph - Whether the graph's execution type is `function`.
     * @throws {GraphValidationError} When outputs are declared but no output node exists.
     * @private
     */
    #validateFunctionSignatureShape(
        graph: NodeGraphLike,
        graphName: string,
        nodes: NodeDataLike[],
        isFunctionGraph: boolean
    ): void {
        if (!isFunctionGraph) {
            return;
        }

        const signature = this.#activeFunctionSignature ?? normalizeFunctionSignature(null);
        if (signature.outputs.length === 0) {
            return;
        }

        const hasOutputNode = nodes.some(
            (node) => node.getType?.() === FUNCTION_OUTPUT_NODE_TYPE
        );
        if (hasOutputNode) {
            return;
        }

        throw new GraphValidationError(
            FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.missingOutputNode,
            `Function graph "${graphName}" declares ${signature.outputs.length} output(s) but has no output node; add the output node so the function can return them.`,
            {
                graphId: graph.getId?.() ?? null,
                graphName,
                outputCount: signature.outputs.length,
            }
        );
    }

    /**
     * Transpile a single node to Python code.
     *
     * This method handles node-specific code generation based on implementation type
     * (regex template, function class, or code generator).
     *
     * @param {object} nodeData - NodeData instance to transpile
     * @param {string} language - Target language
     * @param {object} inputLookup - Input connection lookup
     * @param {object} outputLookup - Output connection lookup
     * @param {Map} outputRegistry - Registry of output variable names
     * @param {Set} importCollector - Set to collect import statements
     * @param {Map} packageAssets - Map to collect package assets
     * @param {object} connectorMetadata - Connector metadata for this node
     * @returns {Promise<{init?: string, preLoop?: string, loop?: string}>} Generated code
     * @throws {Error} If node implementation is invalid
     * @private
     *
     * @example
     * const { loop } = await transpiler.#transpileNode(nodeData, 'python', ...);
     */
    async #transpileNode(
        nodeData: NodeDataLike,
        graph: NodeGraphLike,
        language: TranspilerLanguage,
        inputLookup: InputLookupMap,
        baseInputLookup: InputLookupMap,
        outputLookup: Map<string, Set<number>>,
        outputRegistry: OutputRegistry,
        importCollector: Set<string>,
        packageAssets: Map<string, PackageAssetEntry>,
        connectorMetadata: ConnectorMetadata | undefined
    ): Promise<NodeTranspileResult> {
        const nodeId = nodeData.getId();
        const nodeType = nodeData.getType();

        // Get node definition through the run's single seam (runtime, generated function and
        // structural definitions), so validation and emission always agree (D13).
        const nodeDefinition = this.#resolveNodeDefinition(nodeType);

        if (!nodeDefinition) {
            throw new Error(`Missing definition for node type "${nodeType}"`);
        }

        // Register node assets
        this.#registerNodeAssets(nodeDefinition, packageAssets);

        // Get implementation
        const implementations = nodeDefinition.implementations;
        const implementation = implementations?.[language];

        if (!implementation) {
            throw new Error(`Node type "${nodeType}" lacks a ${language} implementation`);
        }

        // Register implementation imports
        if (implementation.imports && Array.isArray(implementation.imports)) {
            implementation.imports.forEach((stmt) =>
                registerImportStatement(importCollector, stmt)
            );
        }

        // Resolve input references
        const inputRefs = this.#resolveInputReferences(nodeData, inputLookup, outputRegistry);
        const inputSourceRefs = this.#resolveInputSourceReferences(nodeData, baseInputLookup);

        // Generate output variable names
        const outputVars = nodeData.outputs.map((_, idx) => createOutputVariableName(nodeId, idx));

        // Generate code based on implementation type
        let finalOutputs = outputVars.slice();
        let expression = '';
        let statement = '';
        let returnStatement: string | null = null;
        const preludes: string[] = [];

        if (implementation.type === 'structural') {
            // Structural function node: map connectors onto expressions, emit no call (D14).
            // The input node resolves its outputs to the generated parameter names; the
            // output node contributes the body's `return ...`, which the graph appends after
            // the last statement instead of running in place.
            const mappedOutputs = Array.isArray(implementation.outputs)
                ? implementation.outputs
                : [];
            finalOutputs = finalOutputs.map((varName, idx) => {
                const mapped = mappedOutputs[idx];
                return typeof mapped === 'string' && mapped.trim() ? mapped.trim() : varName;
            });

            const structuralStatement =
                typeof implementation.statement === 'string'
                    ? implementation.statement.trim()
                    : '';
            if (structuralStatement) {
                returnStatement = renderTemplate(
                    structuralStatement,
                    this.#buildTemplateContext(nodeData, inputRefs)
                );
            }
        } else if (implementation.type === 'regex') {
            // Simple template substitution
            const context = this.#buildTemplateContext(nodeData, inputRefs);
            expression = renderTemplate(implementation.value, context);
        } else if (implementation.type === 'function') {
            // Function instance with prelude
            let functionName = implementation.value;
            const shortName = registerPythonFunctionImport(implementation.value, importCollector);
            if (shortName) {
                functionName = shortName;
            }

            const instanceName = `node_${nodeId}_impl`;
            const prelude = this.#buildFunctionInstancePrelude(
                functionName,
                nodeData,
                connectorMetadata || {}
            );
            if (prelude) {
                preludes.push(prelude);
            }

            const callArgs = inputRefs.join(', ');
            expression = `${instanceName}(${callArgs})`;
        } else if (implementation.type === 'code-generator') {
            // Execute code generator
            const generatorResult = this.#executeCodeGenerator(
                implementation.value,
                language,
                graph,
                nodeData,
                inputRefs,
                outputVars,
                inputSourceRefs,
                importCollector,
                connectorMetadata || {}
            );

            if (generatorResult.outputs) {
                if (generatorResult.outputs.length !== finalOutputs.length) {
                    const outputsMeta = Array.isArray(connectorMetadata?.outputsMeta)
                        ? connectorMetadata.outputsMeta
                        : null;
                    const connectedIndices = outputsMeta
                        ? outputsMeta
                              .map((entry, idx) => (entry?.connected ? idx : null))
                              .filter((idx) => idx !== null)
                        : [];

                    if (outputsMeta && generatorResult.outputs.length === connectedIndices.length) {
                        let connectedIndex = 0;
                        finalOutputs = finalOutputs.map((varName, idx) => {
                            if (outputsMeta[idx]?.connected) {
                                const replacement = generatorResult.outputs[connectedIndex];
                                connectedIndex += 1;
                                return replacement;
                            }
                            const baseName =
                                typeof varName === 'string' && varName.trim()
                                    ? varName.trim()
                                    : `out${idx}`;
                            return baseName.startsWith('_') ? baseName : `_${baseName}`;
                        });
                    } else {
                        throw new Error(
                            `Generator "${implementation.value}" returned ${generatorResult.outputs.length} outputs but node requires ${finalOutputs.length}`
                        );
                    }
                } else {
                    finalOutputs = generatorResult.outputs.slice();
                }
            }

            if (generatorResult.statement) {
                statement = generatorResult.statement;
            } else if (generatorResult.expression) {
                expression = generatorResult.expression;
                if (finalOutputs.length > 0) {
                    statement = buildAssignmentStatement(finalOutputs, expression);
                } else {
                    statement = expression;
                }
            } else if (!generatorResult.commentOnlySuppressed) {
                throw new Error(`Generator "${implementation.value}" did not return code`);
            }
        } else {
            throw new Error(`Unknown implementation type: ${implementation.type}`);
        }

        // Register outputs in the output registry
        finalOutputs.forEach((varName, idx) => {
            const safeName = typeof varName === 'string' ? varName.trim() : '';
            if (!safeName) {
                throw new Error(
                    `Output slot ${idx} for node "${nodeId}" resolved to invalid identifier`
                );
            }
            outputRegistry.set(`${nodeId}:${idx}`, {
                varName: safeName,
                outputType: this.#resolveOutputTypeForIndex(nodeData, idx),
            });
            finalOutputs[idx] = safeName;
        });

        // Build final statement for regex and function types. A structural node emits only
        // the mapping (and, for the output node, the `return ...` collected above).
        if (implementation.type !== 'code-generator' && implementation.type !== 'structural') {
            const hasOutputs = finalOutputs.length > 0;
            statement = hasOutputs
                ? buildAssignmentStatement(finalOutputs, expression)
                : expression;
        }

        // Process initImplementations (pre-loop initialization)
        let initStatement: string | null = null;
        let initFunctionName: string | null = null;
        let initContribution: NormalizedInitContribution | null = null;
        const initImplementations = nodeDefinition.initImplementations;
        const initImpl = initImplementations?.[language];
        const initFunctionCandidate =
            (typeof initImpl?.initFunction === 'string' ? initImpl.initFunction : null) ||
            nodeDefinition.initFunction ||
            null;
        initFunctionName = this.#normalizeInitFunctionName(initFunctionCandidate);

        if (initImpl) {
            if (initImpl.type === 'code-generator') {
                const initResult = this.#executeCodeGenerator(
                    initImpl.value,
                    language,
                    graph,
                    nodeData,
                    inputRefs,
                    outputVars,
                    inputSourceRefs,
                    importCollector,
                    connectorMetadata || {}
                );
                if (initFunctionName) {
                    initContribution = this.#normalizeSharedInitContribution(initResult);
                } else {
                    initStatement = initResult.statement || initResult.expression;
                }
            } else if (initImpl.type === 'regex') {
                const context = this.#buildTemplateContext(nodeData, inputRefs);
                initStatement = renderTemplate(initImpl.value, context);
            } else if (initImpl.type === 'function') {
                // Init functions are less common, but should be supported
                const functionName = initImpl.value;
                const context = this.#buildTemplateContext(nodeData, inputRefs);
                initStatement = `${functionName}(${context.inputs.join(', ')})`;
            }
        }

        if (initFunctionName && !initContribution) {
            initContribution = this.#normalizeSharedInitContribution({
                expression: null,
                statement: initStatement,
                init: null,
            });
        }

        return {
            init: initFunctionName ? null : initStatement,
            initFunctionName,
            initContribution,
            preLoop: preludes.length > 0 ? preludes.join('\n') : null,
            loop: statement,
            returnStatement,
        };
    }

    /**
     * Validate graph structure for transpilation.
     *
     * Checks for:
     * - Cycles in graph (topological sort should fail)
     * - Missing node implementations
     * - Invalid connections
     * - Required capabilities
     *
     * @param {object} graph - NodeGraph to validate
     * @param {string} language - Target language
     * @throws {Error} If validation fails
     * @private
     *
     * @example
     * transpiler.#validateGraph(myGraph, 'python'); // Throws on invalid structure
     */
    #validateGraph(
        graph: NodeGraphLike,
        language: TranspilerLanguage,
        deviceRuntime: DeviceRuntimeLike
    ): void {
        const graphName = graph.getName?.() || graph.getId?.() || 'unknown';
        const nodesObj = graph.getNodes();

        // Convert nodes object to array
        const nodes = (
            Array.isArray(nodesObj) ? nodesObj : Object.values(nodesObj)
        ) as NodeDataLike[];

        const executionType = normalizeExecutionType(graph.getExecutionType?.());
        const isFunctionGraph = executionType === 'function';
        // Structural function nodes mirror the signature of the graph being validated;
        // `#resolveNodeDefinition()` reads it while the node definitions are checked.
        this.#activeFunctionSignature = isFunctionGraph
            ? normalizeFunctionSignature(
                  (graph as NodeGraphLike & { getFunctionSignature?: () => unknown })
                      .getFunctionSignature?.()
              )
            : null;

        // Empty graphs are ignored during transpilation, so there is nothing to validate —
        // except the signature/output-node contract of a function graph, which is checked
        // before the node list matters (D10).
        this.#validateFunctionSignatureShape(graph, graphName, nodes, isFunctionGraph);

        if (!nodes || nodes.length === 0) {
            return;
        }

        // Structural nodes contribute variable mappings only inside function graphs (D14).
        if (!isFunctionGraph) {
            const structuralNode = nodes.find((node) =>
                isFunctionStructuralNodeType(node.getType())
            );
            if (structuralNode) {
                throw new GraphValidationError(
                    FUNCTION_GRAPH_VALIDATION_MESSAGE_IDS.structuralInNonFunctionGraph,
                    `Graph "${graphName}" contains the structural function node "${structuralNode.getType()}", but only a function graph can use it; set the graph's execution type to "function" or delete the node.`,
                    {
                        graphId: graph.getId?.() ?? null,
                        graphName,
                        nodeId: structuralNode.getId(),
                        nodeType: structuralNode.getType(),
                        executionType,
                    }
                );
            }
        }

        // Check for cycles (topological sort will throw on cycles)
        const connections = graph.getConnections();
        try {
            getTopologicallySortedNodeIds(
                nodes.map((n) => ({ id: n.getId() })),
                connections
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Cycle detected in graph "${graphName}": ${message}`);
        }

        // Validate node definitions and implementations
        if (!deviceRuntime) {
            throw new Error('Device runtime not available');
        }

        for (const node of nodes) {
            const nodeType = node.getType();
            const nodeId = node.getId();
            // One seam for runtime, generated function and structural definitions (D13).
            const nodeDefinition = this.#resolveNodeDefinition(nodeType);

            if (!nodeDefinition) {
                throw new Error(
                    `Missing node definition for type: ${nodeType} (node: ${nodeId}) in graph "${graphName}"`
                );
            }

            // Check for implementation
            const implementations = nodeDefinition.implementations;
            if (!implementations || !implementations[language]) {
                throw new Error(
                    `Node type ${nodeType} lacks a ${language} implementation (node: ${nodeId}) in graph "${graphName}"`
                );
            }
        }

        // An enabled event graph must watch at least one signal; a disabled one is dropped
        // before validation, so it never blocks transpilation.
        if (
            graph.getExecutionType?.() === 'event' &&
            normalizeSignalNames(graph.getSignalNames?.()).length === 0
        ) {
            throw new Error(
                `Event-triggered graph "${graphName}" has no signals selected; pick at least one signal in the graph settings.`
            );
        }
    }

    /**
     * Stable comparison key for the GPIO an `interrupt-input` claims.
     *
     * Mirrors `irq/node_capabilities.js#pinKey()`: `undefined`, `null`, and blank all mean `0`
     * (the generator default), a finite `Number(value)` becomes its string, and anything else
     * becomes `raw:<trimmed>` so an unsupported control value only collides with an identical
     * one. The duplication is deliberate, because `js/proc/` must not import a device node
     * package; both copies are pinned by their own tests, so keep them in sync.
     *
     * @param value - Raw `pin` control value.
     * @returns The comparison key.
     * @private
     */
    #irqPinKey(value: unknown): string {
        if (value === undefined || value === null || String(value).trim() === '') {
            return '0';
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? String(numeric) : `raw:${String(value).trim()}`;
    }

    /**
     * Text shown for an {@link #irqPinKey} value in a transpile error.
     * @param pinKey - Comparison key from {@link #irqPinKey}.
     * @returns The raw text of a `raw:` key, otherwise the numeric key itself.
     * @private
     */
    #irqPinLabel(pinKey: string): string {
        return pinKey.startsWith('raw:') ? pinKey.slice(4) : pinKey;
    }

    /**
     * Validate interrupt bindings across the enabled graphs.
     *
     * Runs after {@link #validateGraph} and before code generation. It checks that
     * every `interrupt-input`/`interrupt-enable` name and every `irq` graph's trigger
     * name binds to exactly one declaration, and that no two interrupt inputs claim the
     * same effective GPIO, mirroring the editor graph rules but as hard transpile
     * errors. Signal validation is intentionally not here: phase 7 adds the per-graph
     * watch-list check to {@link #validateGraph}, because signal names have no
     * cross-graph hard error.
     *
     * @param graphs - Enabled graphs to check.
     * @param deviceRuntime - Device runtime used to resolve node types.
     * @throws {Error} On a blank, duplicate or dangling interrupt binding, or on two
     *   interrupt inputs claiming one GPIO.
     * @private
     */
    #validateTriggerBindings(graphs: NodeGraphLike[], deviceRuntime: DeviceRuntimeLike): void {
        const bareTypeId = (type: unknown): string => {
            const value = String(type ?? '');
            const dot = value.indexOf('.');
            return dot >= 0 ? value.slice(dot + 1) : value;
        };
        const nodeName = (node: NodeDataLike): string =>
            String((node.controlValues ?? {}).triggerName ?? '').trim();

        const declarations: Array<{
            name: string;
            pinKey: string;
            graphId: string;
            graphName: string;
            nodeId: string;
        }> = [];
        const enableRefs: Array<{ name: string; graphId: string; graphName: string; nodeId: string }> =
            [];

        for (const graph of graphs) {
            const graphId = String(graph.getId?.() ?? '');
            const graphName = graph.getName?.() || graphId || 'unknown';
            const nodesObj = graph.getNodes();
            const nodes = (
                Array.isArray(nodesObj) ? nodesObj : Object.values(nodesObj ?? {})
            ) as NodeDataLike[];

            for (const node of nodes) {
                const nodeTypeId = String(node.getType() ?? '');
                // Unknown node types are already rejected by #validateGraph; skip
                // defensively so a broken runtime cannot crash the binding pass.
                if (!deviceRuntime.getNodeType?.(nodeTypeId)) {
                    continue;
                }
                const bare = bareTypeId(nodeTypeId);
                if (bare === 'interrupt-input') {
                    declarations.push({
                        name: nodeName(node),
                        pinKey: this.#irqPinKey((node.controlValues ?? {}).pin),
                        graphId,
                        graphName,
                        nodeId: node.getId(),
                    });
                } else if (bare === 'interrupt-enable') {
                    enableRefs.push({ name: nodeName(node), graphId, graphName, nodeId: node.getId() });
                }
            }
        }

        // A declaration must carry a name.
        for (const declaration of declarations) {
            if (!declaration.name) {
                throw new Error(
                    `Graph "${declaration.graphName}": interrupt input node "${declaration.nodeId}" has no interrupt name.`
                );
            }
        }

        // A name may be declared by at most one interrupt input.
        const declarationsByName = new Map<string, typeof declarations>();
        for (const declaration of declarations) {
            if (!declaration.name) {
                continue;
            }
            const list = declarationsByName.get(declaration.name) ?? [];
            list.push(declaration);
            declarationsByName.set(declaration.name, list);
        }
        for (const [name, list] of declarationsByName) {
            if (list.length > 1) {
                const graphNames = list.map((entry) => `"${entry.graphName}"`).join(', ');
                throw new Error(
                    `Graph "${list[0].graphName}": the interrupt name '${name}' is declared by more than one interrupt input (${graphNames}).`
                );
            }
        }

        // One GPIO may be armed by at most one interrupt input: a second `pin.irq(...)`
        // replaces the first handler, leaving the earlier channel registered but deaf.
        // Checked after the duplicate-name loop so a collection with two identical
        // declarations keeps reporting the name problem first.
        const declarationsByPin = new Map<string, typeof declarations>();
        for (const declaration of declarations) {
            const list = declarationsByPin.get(declaration.pinKey) ?? [];
            list.push(declaration);
            declarationsByPin.set(declaration.pinKey, list);
        }
        for (const [pinKey, list] of declarationsByPin) {
            if (list.length > 1) {
                const claims = list
                    .map((entry) => `Graph "${entry.graphName}" node "${entry.nodeId}"`)
                    .join(', ');
                throw new Error(
                    `Graph "${list[0].graphName}": GPIO ${this.#irqPinLabel(pinKey)} is claimed by more than one interrupt input (${claims}). Only one interrupt can own a GPIO.`
                );
            }
        }

        // An enable reference must name an existing declaration.
        const declaredNames = new Set(
            declarations.filter((entry) => entry.name).map((entry) => entry.name)
        );
        for (const ref of enableRefs) {
            if (!ref.name) {
                throw new Error(
                    `Graph "${ref.graphName}": interrupt enable node "${ref.nodeId}" has no interrupt name.`
                );
            }
            if (!declaredNames.has(ref.name)) {
                throw new Error(
                    `Graph "${ref.graphName}": interrupt enable node "${ref.nodeId}" names '${ref.name}', but no interrupt input declares it.`
                );
            }
        }

        // Collect every irq-mode graph and its normalized trigger name.
        const irqGraphs: Array<{ graphId: string; graphName: string; triggerName: string }> = [];
        for (const graph of graphs) {
            if (normalizeExecutionType(graph.getExecutionType?.()) !== 'irq') {
                continue;
            }
            irqGraphs.push({
                graphId: String(graph.getId?.() ?? ''),
                graphName: graph.getName?.() || String(graph.getId?.() ?? '') || 'unknown',
                triggerName: normalizeTriggerName(graph.getTriggerName?.()),
            });
        }

        // Two irq-mode graphs may not bind the same name. Checked before the per-graph
        // binding below so the more specific "two graphs on one name" error wins over
        // "declaration lives in a different graph".
        const irqByName = new Map<string, typeof irqGraphs>();
        for (const irq of irqGraphs) {
            if (!irq.triggerName) {
                continue;
            }
            const list = irqByName.get(irq.triggerName) ?? [];
            list.push(irq);
            irqByName.set(irq.triggerName, list);
        }
        for (const [name, list] of irqByName) {
            if (list.length > 1) {
                const graphNames = list.map((entry) => `"${entry.graphName}"`).join(', ');
                throw new Error(
                    `Graph "${list[0].graphName}": the interrupt name '${name}' is used by more than one irq-mode graph (${graphNames}).`
                );
            }
        }

        // An irq-mode graph must bind to an interrupt input in its own graph.
        for (const irq of irqGraphs) {
            if (!irq.triggerName) {
                throw new Error(`Graph "${irq.graphName}": this irq-mode graph has no interrupt name.`);
            }
            const matching = declarations.filter((entry) => entry.name === irq.triggerName);
            if (matching.length === 0) {
                throw new Error(
                    `Graph "${irq.graphName}": the interrupt name '${irq.triggerName}' is not declared by an interrupt input.`
                );
            }
            if (!matching.some((entry) => entry.graphId === irq.graphId)) {
                throw new Error(
                    `Graph "${irq.graphName}": the interrupt name '${irq.triggerName}' is declared by an interrupt input in a different graph; the interrupt input must be in the same graph as the graph it triggers.`
                );
            }
        }
    }

    /**
     * Format a loop-head wait statement for trigger-driven graphs.
     *
     * Both the `irq` branch (phase 1) and the `event` branch (phase 7) call this so
     * the `await <runtime>.wait(...)` line is formatted in exactly one place; each
     * branch owns its own loop scaffolding (comment, prologue, trailing sleep).
     *
     * @param indent - Indentation prefix (four spaces per level).
     * @param waitLine - The complete `await ...wait(...)` statement.
     * @returns The single indented wait statement.
     * @private
     */
    #emitWaitStatement(indent: string, waitLine: string): string {
        return `${indent}${waitLine}`;
    }

    /**
     * Assemble final Python program from graph functions and imports.
     *
     * Combines imports, library code, graph functions, and main loop into
     * a complete executable Python program. `import utime as _utime` is added
     * only when a continuous graph uses a non-zero cadence interval: an
     * interval-0 loop ends in a bare `asyncio.sleep_ms(0)` and startup graphs
     * never cadence, so neither needs the deadline helpers.
     *
     * @param {Array<{name: string, executionType: string, initStatements: string[], preLoopStatements: string[], statements: string[], intervalMs: number, irqTriggerName: string | null}>} graphBlocks - Transpiled graph data; `intervalMs` is the cadence period in ms, `0` = yield only; `irqTriggerName` is non-null only for `irq` blocks
     * @param {Set} importCollector - Set of import statements
     * @returns {string} Complete Python program
     * @private
     *
     * @example
     * const code = transpiler.#assemblePythonProgram(graphBlocks, imports);
     */
    #assemblePythonProgram(
        graphBlocks: GraphBlock[],
        importCollector: Set<string>,
        sharedInitStatementsByFunction: Map<string, NormalizedInitContribution[]>
    ): string {
        const lines = [];
        const indent = '    ';

        // Register the cadence helpers before the import block is rendered so the
        // statement is emitted once, sorted, and only when the code needs it.
        if (
            graphBlocks.some(
                (block) => block.executionType === 'continuous' && block.intervalMs > 0
            )
        ) {
            registerImportStatement(importCollector, 'import utime as _utime');
        }

        // An interrupt-driven graph waits on the otter_irq registry.
        if (graphBlocks.some((block) => block.irqTriggerName !== null)) {
            registerImportStatement(importCollector, 'import otter_irq.interrupts as _otter_irq');
        }

        // An event-driven graph waits on the otter_vars signal registry.
        if (graphBlocks.some((block) => block.executionType === 'event')) {
            registerImportStatement(importCollector, 'import otter_vars.signals as _signals');
        }

        // 1. Header comment
        lines.push('# Auto-generated MicroPython code');
        lines.push('# Generated by Micro-Otter transpiler');
        lines.push('');

        // 2. Imports
        if (importCollector.size > 0) {
            const sortedImports = Array.from(importCollector).sort();
            lines.push('# Imports');
            sortedImports.forEach((imp) => lines.push(imp));
            lines.push('');
        }

        // 3. Graph functions
        // 3. Shared init functions
        const sharedInitFunctionNames = Array.from(sharedInitStatementsByFunction.keys()).sort();
        const referencedGlobalNames = this.#collectNamesReferencedOutsideSharedInit(graphBlocks);
        sharedInitFunctionNames.forEach((functionName) => {
            const contributions = sharedInitStatementsByFunction.get(functionName) || [];
            const orderedInitBlocks: string[] = [];
            const seenInitBlocks = new Set<string>();
            contributions
                .filter(
                    (entry) =>
                        typeof entry.initBlock === 'string' && entry.initBlock.trim().length > 0
                )
                .slice()
                .sort((a, b) => {
                    if (a.initPriority !== b.initPriority) {
                        return a.initPriority - b.initPriority;
                    }
                    return a.order - b.order;
                })
                .forEach((entry) => {
                    const block = entry.initBlock as string;
                    if (!seenInitBlocks.has(block)) {
                        seenInitBlocks.add(block);
                        orderedInitBlocks.push(block);
                    }
                });
            const orderedExecuteBlocks: string[] = [];
            const seenExecuteBlocks = new Set<string>();
            contributions
                .filter(
                    (entry) =>
                        typeof entry.executeBlock === 'string' &&
                        entry.executeBlock.trim().length > 0
                )
                .slice()
                .sort((a, b) => a.order - b.order)
                .forEach((entry) => {
                    const block = (entry.executeBlock as string).trim();
                    if (!seenExecuteBlocks.has(block)) {
                        seenExecuteBlocks.add(block);
                        orderedExecuteBlocks.push(block);
                    }
                });
            const statements = [...orderedInitBlocks, ...orderedExecuteBlocks];
            const globalNames = this.#collectGlobalNamesForInitStatements(
                statements,
                referencedGlobalNames
            );

            lines.push(`# Shared init: ${functionName}`);
            lines.push(`async def ${functionName}():`);
            // lines.push(`${indent}print('[otter] function-entry ${functionName}')`);

            if (globalNames.length > 0) {
                lines.push(`${indent}global ${globalNames.join(', ')}`);
            }

            // Comment-only contributions (e.g. a bridge that is configured elsewhere)
            // still count as an empty body: `pass` keeps the function parseable.
            if (hasExecutableStatement(statements)) {
                statements.forEach((stmt) => {
                    lines.push(indentMultiLine(stmt, indent));
                });
            } else {
                lines.push(`${indent}pass`);
            }
            lines.push('');
        });

        // 3b. Function blocks: hoisted init and the `async def` body (D10, D12).
        // A function block never receives the main loop, a cadence sleep or the signal/
        // startup scaffolding; its body is emitted verbatim and ends in the output node's
        // `return ...`. The init coroutine runs once at startup, never per call.
        const functionBlocks = graphBlocks.filter((block) => block.kind === 'function');
        const graphBlocksOnly = graphBlocks.filter((block) => block.kind !== 'function');

        functionBlocks.forEach((block) => {
            const hoistedInitStatements = [...block.initStatements, ...block.preLoopStatements];
            // State the hoisted init owns lives at module scope, so a body that writes the same
            // name (`x = push(x)`, the shape of every stateful node) must declare it `global`
            // too. Without the declaration Python binds `x` as a body local, and the first read
            // in `x = push(x)` raises `local variable referenced before assignment`.
            const sharedStateNames = this.#collectSharedFunctionStateNames(
                hoistedInitStatements,
                block.statements,
                block.parameters,
                referencedGlobalNames
            );

            if (block.emitInit) {
                const initName = `_init_${block.name}`;
                const globalNames = this.#collectGlobalNamesForInitStatements(
                    hoistedInitStatements,
                    referencedGlobalNames
                );

                lines.push(`# Function init: ${initName}`);
                lines.push(`async def ${initName}():`);
                if (globalNames.length > 0) {
                    lines.push(`${indent}global ${globalNames.join(', ')}`);
                }
                if (hasExecutableStatement(hoistedInitStatements)) {
                    hoistedInitStatements.forEach((stmt) => {
                        lines.push(indentMultiLine(stmt, indent));
                    });
                } else {
                    lines.push(`${indent}pass`);
                }
                lines.push('');
            }

            lines.push(`# Function: ${block.name}`);
            lines.push(`async def ${block.name}(${block.parameters.join(', ')}):`);
            if (sharedStateNames.length > 0) {
                lines.push(`${indent}global ${sharedStateNames.join(', ')}`);
            }

            const hasBody = hasExecutableStatement(block.statements);
            if (hasBody) {
                block.statements.forEach((stmt) => lines.push(indentMultiLine(stmt, indent)));
            }
            if (block.returnStatement) {
                lines.push(`${indent}${block.returnStatement}`);
            } else if (!hasBody) {
                lines.push(`${indent}pass`);
            }
            lines.push('');
        });

        // 4. Graph functions
        graphBlocksOnly.forEach((block) => {
            lines.push(`# Graph: ${block.name}`);
            lines.push(`async def ${block.name}():`);
            // lines.push(`${indent}print('[otter] function-entry ${block.name}')`);

            // Graph-level initialization (runs once per graph coroutine start)
            if (block.initStatements && block.initStatements.length > 0) {
                lines.push(`${indent}# Initialization`);
                block.initStatements.forEach((stmt) => lines.push(indentMultiLine(stmt, indent)));
                lines.push('');
            }

            // Pre-loop statements (function instances, etc.)
            if (block.preLoopStatements && block.preLoopStatements.length > 0) {
                lines.push(`${indent}# Pre-loop setup`);
                block.preLoopStatements.forEach((stmt) =>
                    lines.push(indentMultiLine(stmt, indent))
                );
                lines.push('');
            }

            if (block.executionType === 'startup') {
                // Startup graph: run its statements once, then return. A graph whose
                // nodes only emit comments (the HA bridge is configured in `init_mqtt`)
                // has no executable statement, so `pass` keeps the function parseable.
                const hasBody =
                    hasExecutableStatement(block.initStatements) ||
                    hasExecutableStatement(block.preLoopStatements) ||
                    hasExecutableStatement(block.statements);
                if (block.statements && block.statements.length > 0) {
                    lines.push(`${indent}# Run once`);
                    block.statements.forEach((stmt) => lines.push(indentMultiLine(stmt, indent)));
                }
                if (!hasBody) {
                    lines.push(`${indent}pass`);
                }
                lines.push('');
                return;
            }

            if (block.executionType === 'irq') {
                // Interrupt graph: wait on the named channel, then run the body once.
                lines.push(`${indent}# Wait for interrupt`);
                lines.push(`${indent}while True:`);
                lines.push(
                    this.#emitWaitStatement(
                        `${indent}${indent}`,
                        `await _otter_irq.wait(${formatLiteral(block.irqTriggerName)})`
                    )
                );
                if (block.statements && block.statements.length > 0) {
                    block.statements.forEach((stmt) => {
                        lines.push(indentMultiLine(stmt, `${indent}${indent}`));
                    });
                }
                lines.push('');
                return;
            }

            if (block.executionType === 'event') {
                // Event graph: wait on its watched signals, then run the body once.
                const signalList = block.signalNames.map((name) => formatLiteral(name)).join(', ');
                const signalTuple = `(${signalList}${block.signalNames.length === 1 ? ',' : ''})`;
                lines.push(
                    `${indent}_signals.define(${formatLiteral(block.signalKey)}, ${signalTuple}, ${formatLiteral(block.signalMode)})`
                );
                lines.push('');
                if (block.runOnStart) {
                    lines.push(`${indent}_first_run = True`);
                }
                lines.push(`${indent}while True:`);
                if (block.runOnStart) {
                    lines.push(`${indent}${indent}if not _first_run:`);
                    lines.push(`${indent}${indent}${indent}# Wait for signal`);
                    lines.push(
                        this.#emitWaitStatement(
                            `${indent}${indent}${indent}`,
                            `await _signals.wait(${formatLiteral(block.signalKey)})`
                        )
                    );
                    lines.push(`${indent}${indent}_first_run = False`);
                } else {
                    lines.push(`${indent}${indent}# Wait for signal`);
                    lines.push(
                        this.#emitWaitStatement(
                            `${indent}${indent}`,
                            `await _signals.wait(${formatLiteral(block.signalKey)})`
                        )
                    );
                }
                if (block.statements && block.statements.length > 0) {
                    block.statements.forEach((stmt) => {
                        lines.push(indentMultiLine(stmt, `${indent}${indent}`));
                    });
                } else {
                    lines.push(`${indent}${indent}pass`);
                }
                lines.push(`${indent}${indent}await asyncio.sleep_ms(0)`);
                lines.push('');
                return;
            }

            // Cadence: keep the period between iteration starts. With interval 0
            // there is no deadline and the loop just yields once per iteration.
            const intervalMs = block.intervalMs;
            const hasCadence = intervalMs > 0;

            if (hasCadence) {
                lines.push(`${indent}_next_run_ms = _utime.ticks_ms()`);
            }
            lines.push(`${indent}while True:`);

            if (block.statements && block.statements.length > 0) {
                block.statements.forEach((stmt) => {
                    lines.push(indentMultiLine(stmt, `${indent}${indent}`));
                });
            } else {
                lines.push(`${indent}${indent}pass`);
            }

            if (hasCadence) {
                lines.push(
                    `${indent}${indent}_next_run_ms = _utime.ticks_add(_next_run_ms, ${intervalMs})`
                );
                lines.push(
                    `${indent}${indent}_wait_ms = _utime.ticks_diff(_next_run_ms, _utime.ticks_ms())`
                );
                lines.push(`${indent}${indent}if _wait_ms > 0:`);
                lines.push(`${indent}${indent}${indent}await asyncio.sleep_ms(_wait_ms)`);
                lines.push(`${indent}${indent}else:`);
                lines.push(`${indent}${indent}${indent}_next_run_ms = _utime.ticks_ms()`);
                lines.push(`${indent}${indent}${indent}await asyncio.sleep_ms(0)`);
            } else {
                lines.push(`${indent}${indent}await asyncio.sleep_ms(0)`);
            }
            lines.push('');
        });

        // 4. Main entry point (called by runtime framework)
        // 5. Main entry point (called by runtime framework)
        lines.push('# Main entry point - called by runtime framework');
        lines.push('async def run():');
        // lines.push(`${indent}print('[otter] function-entry run')`);

        sharedInitFunctionNames.forEach((functionName) => {
            lines.push(`${indent}await ${functionName}()`);
        });

        // Function initializations run once, before any graph task starts (D12).
        functionBlocks.forEach((block) => {
            if (block.emitInit) {
                lines.push(`${indent}await _init_${block.name}()`);
            }
        });

        const startupBlocks = graphBlocksOnly.filter(
            (block) => block.executionType === 'startup'
        );
        // Continuous, IRQ and event graphs all run as long-lived tasks (or are awaited when
        // they are the only one), so the filter keeps everything that is not startup.
        const loopingBlocks = graphBlocksOnly.filter(
            (block) => block.executionType !== 'startup'
        );

        startupBlocks.forEach((block) => {
            lines.push(`${indent}await ${block.name}()`);
        });

        if (loopingBlocks.length === 0) {
            lines.push(`${indent}pass`);
        } else if (loopingBlocks.length === 1) {
            // Single graph - just await it
            lines.push(`${indent}await ${loopingBlocks[0].name}()`);
        } else {
            // Multiple graphs - create tasks for concurrent execution
            lines.push(`${indent}tasks = [`);
            loopingBlocks.forEach((block, idx) => {
                const comma = idx < loopingBlocks.length - 1 ? ',' : '';
                lines.push(`${indent}${indent}asyncio.create_task(${block.name}())${comma}`);
            });
            lines.push(`${indent}]`);
            lines.push(`${indent}await asyncio.gather(*tasks)`);
        }

        lines.push('');

        return lines.join('\n');
    }

    #normalizeInitFunctionName(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, '_');
        if (!sanitized) {
            return null;
        }

        if (/^[0-9]/.test(sanitized)) {
            return `init_${sanitized}`;
        }

        return sanitized;
    }

    #trimCodeOrNull(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }

    #stripGeneratorCommentLines(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const lines = value.split(/\r?\n/);
        const filtered = lines.filter((line) => !line.trim().startsWith('#'));

        while (filtered.length > 0 && filtered[0].trim() === '') {
            filtered.shift();
        }
        while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
            filtered.pop();
        }

        if (filtered.length === 0) {
            return null;
        }

        return filtered.join('\n');
    }

    #normalizeSharedInitContribution(
        generatorResult: Pick<CodeGeneratorResult, 'statement' | 'expression' | 'init'>
    ): NormalizedInitContribution | null {
        if (generatorResult?.init) {
            const initBlock = this.#trimCodeOrNull(generatorResult.init.block);
            const executeBlock = this.#trimCodeOrNull(generatorResult.init.execute);
            if (!initBlock && !executeBlock) {
                return null;
            }

            const initPriority = Number.isFinite(generatorResult.init.priority)
                ? Math.floor(generatorResult.init.priority as number)
                : 100;

            return {
                initBlock,
                initPriority,
                executeBlock,
                order: 0,
            };
        }

        const executeBlock = this.#trimCodeOrNull(
            generatorResult?.statement || generatorResult?.expression
        );
        if (!executeBlock) {
            return null;
        }

        return {
            initBlock: null,
            initPriority: 100,
            executeBlock,
            order: 0,
        };
    }

    #collectGlobalNamesForInitStatements(
        statements: string[],
        referencedNames: Set<string>
    ): string[] {
        const assignedNames = new Set<string>();

        statements.forEach((statement) => {
            this.#collectAssignedGlobalNames(statement).forEach((name) => assignedNames.add(name));
        });

        return Array.from(assignedNames)
            .filter((name) => referencedNames.has(name))
            .sort();
    }

    /**
     * Names a function body shares with its hoisted `_init_<name>` coroutine.
     *
     * The init coroutine assigns these names at module scope. A body that assigns the same
     * name must declare it `global` as well, otherwise Python binds it as a body local and
     * the read part of `x = f(x)` — how every stateful node carries its buffer across calls —
     * raises `local variable referenced before assignment`. A read-only use already resolves
     * to the module global and needs no declaration.
     *
     * @param initStatements - Statements hoisted into `_init_<name>`.
     * @param bodyStatements - Statements emitted inside the function body.
     * @param parameters - Generated parameter names; a parameter can never be `global`.
     * @param referencedNames - Names referenced anywhere in the program.
     * @returns Sorted names to declare `global` at the top of the body.
     * @private
     */
    #collectSharedFunctionStateNames(
        initStatements: string[],
        bodyStatements: string[],
        parameters: string[],
        referencedNames: Set<string>
    ): string[] {
        const assignedByBody = new Set<string>();
        bodyStatements.forEach((statement) => {
            this.#collectAssignedGlobalNames(statement).forEach((name) => assignedByBody.add(name));
        });

        if (assignedByBody.size === 0) {
            return [];
        }

        return this.#collectGlobalNamesForInitStatements(initStatements, referencedNames).filter(
            (name) => assignedByBody.has(name) && !parameters.includes(name)
        );
    }

    #collectNamesReferencedOutsideSharedInit(graphBlocks: GraphBlock[]): Set<string> {
        const referencedNames = new Set<string>();

        graphBlocks.forEach((block) => {
            const allStatements = [
                ...(Array.isArray(block.initStatements) ? block.initStatements : []),
                ...(Array.isArray(block.preLoopStatements) ? block.preLoopStatements : []),
                ...(Array.isArray(block.statements) ? block.statements : []),
            ];

            allStatements.forEach((statement) => {
                this.#collectReferencedIdentifiers(statement).forEach((name) =>
                    referencedNames.add(name)
                );
            });
        });

        return referencedNames;
    }

    #collectReferencedIdentifiers(statement: string): string[] {
        if (typeof statement !== 'string' || !statement.trim()) {
            return [];
        }

        const identifiers = new Set<string>();
        const reserved = new Set([
            'False',
            'None',
            'True',
            'and',
            'as',
            'assert',
            'async',
            'await',
            'break',
            'class',
            'continue',
            'def',
            'del',
            'elif',
            'else',
            'except',
            'finally',
            'for',
            'from',
            'global',
            'if',
            'import',
            'in',
            'is',
            'lambda',
            'nonlocal',
            'not',
            'or',
            'pass',
            'raise',
            'return',
            'try',
            'while',
            'with',
            'yield',
        ]);

        const lines = statement.split(/\r?\n/);

        const addIdentifiersFromCode = (codeLine: string) => {
            const withoutComments = codeLine.split('#')[0] || '';
            const withoutStrings = withoutComments
                .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, '')
                .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '');

            const matches = withoutStrings.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
            matches.forEach((name) => {
                if (!reserved.has(name)) {
                    identifiers.add(name);
                }
            });
        };

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                return;
            }

            const simpleAssignment = trimmed.match(
                /^([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*=(?!=)(.*)$/
            );
            if (simpleAssignment) {
                const rhs = simpleAssignment[2] || '';
                addIdentifiersFromCode(rhs);
                return;
            }

            addIdentifiersFromCode(trimmed);
        });

        return Array.from(identifiers);
    }

    #collectAssignedGlobalNames(statement: string): string[] {
        if (typeof statement !== 'string' || !statement.trim()) {
            return [];
        }

        const names = new Set<string>();
        const lines = statement.split(/\r?\n/);

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                return;
            }

            const globalMatch = trimmed.match(
                /^global\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)$/
            );
            if (globalMatch) {
                globalMatch[1]
                    .split(',')
                    .map((name) => name.trim())
                    .filter(Boolean)
                    .forEach((name) => names.add(name));
                return;
            }

            const tupleAssignmentMatch = trimmed.match(
                /^([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*=(?!=)/
            );
            if (tupleAssignmentMatch) {
                tupleAssignmentMatch[1]
                    .split(',')
                    .map((name) => name.trim())
                    .filter(Boolean)
                    .forEach((name) => names.add(name));
                return;
            }

            const augmentedAssignmentMatch = trimmed.match(
                /^([A-Za-z_][A-Za-z0-9_]*)\s*[+\-*/%&|^]=/
            );
            if (augmentedAssignmentMatch) {
                names.add(augmentedAssignmentMatch[1]);
            }
        });

        return Array.from(names);
    }

    /**
     * Build template context for regex-based node implementations.
     *
     * Creates a context object with input/output/control variable names
     * for template substitution.
     *
     * @param {object} nodeData - NodeData instance
     * @param {string[]} inputRefs - Resolved input variable names
     * @returns {object} Template context
     * @private
     */
    #buildTemplateContext(nodeData: NodeDataLike, inputRefs: string[]): TemplateContext {
        const fallback = getNullLiteral();
        const context: TemplateContext = {
            nodeId: nodeData.getId(),
            nodeType: nodeData.getType(),
            title: nodeData.title || nodeData.getType(),
            inputs: inputRefs,
        };

        // Add input references
        nodeData.inputs.forEach((input, idx) => {
            const ref = inputRefs[idx] ?? fallback;
            if (input.id) {
                context[input.id] = ref;
            }
            context[`in${idx}`] = ref;
        });

        // Add output variable names
        nodeData.outputs.forEach((output, idx) => {
            const varName = createOutputVariableName(nodeData.getId(), idx);
            context[`out${idx}`] = varName;
            if (output.id) {
                context[output.id] = varName;
            }
        });

        // Add control values
        if (nodeData.controls) {
            nodeData.controls.forEach((control) => {
                const controlId = control?.id;
                if (!controlId) {
                    return;
                }
                const controlValue = nodeData.controlValues
                    ? nodeData.controlValues[controlId]
                    : undefined;
                context[controlId] = formatLiteral(controlValue);
            });
        }

        return context;
    }

    /**
     * Resolve input references from connections or default values.
     *
     * @param {object} nodeData - NodeData instance
     * @param {object} inputLookup - Input connection lookup
     * @param {Map} outputRegistry - Output registry map
     * @returns {string[]} Array of input references (variable names or literals)
     * @private
     */
    #resolveInputReferences(
        nodeData: NodeDataLike,
        inputLookup: InputLookupMap,
        outputRegistry: OutputRegistry
    ): string[] {
        const nodeId = nodeData.getId();
        const incoming = inputLookup.get(nodeId) || {};
        const nullLiteral = getNullLiteral();

        return nodeData.inputs.map((input, idx) => {
            const wiring = incoming[idx];
            if (!wiring) {
                // No connection - use default value if available
                const defaultLiteral = this.#getInputDefaultLiteral(nodeData, input, idx);
                return defaultLiteral ?? nullLiteral;
            }

            // Connected - look up output variable
            const key = `${wiring.fromNode}:${wiring.fromIndex}`;
            if (!outputRegistry.has(key)) {
                throw new Error(
                    `Input "${input.name || input.id}" on node "${nodeData.getId()}" is connected to an unresolved output`
                );
            }
            const outputEntry = outputRegistry.get(key) as OutputRegistryEntry;
            const allowedTypes = Array.isArray(input.allowedTypes) ? input.allowedTypes : ['any'];

            return this.#applyImplicitInputConversion(
                outputEntry.varName,
                outputEntry.outputType,
                allowedTypes,
                nodeData,
                input,
                idx
            );
        });
    }

    #resolveInputSourceReferences(
        nodeData: NodeDataLike,
        inputLookup: InputLookupMap
    ): Array<InputSourceReference | null> {
        const nodeId = nodeData.getId();
        const incoming = inputLookup.get(nodeId) || {};

        return nodeData.inputs.map((_input, idx) => {
            const wiring = incoming[idx];
            if (!wiring) {
                return null;
            }

            return {
                fromNode: wiring.fromNode,
                fromIndex: wiring.fromIndex,
                toIndex: idx,
            };
        });
    }

    #resolveOutputTypeForIndex(nodeData: NodeDataLike, outputIndex: number): string {
        const outputDef = nodeData.outputs?.[outputIndex];
        if (!outputDef) {
            return 'any';
        }

        const outputId = typeof outputDef.id === 'string' ? outputDef.id : null;
        const nodeWithDynamicOutputTyping = nodeData as NodeDataLike & {
            getOutputType?: (id: string) => string;
        };

        if (outputId && typeof nodeWithDynamicOutputTyping.getOutputType === 'function') {
            try {
                const dynamicType = nodeWithDynamicOutputTyping.getOutputType(outputId);
                if (typeof dynamicType === 'string' && dynamicType.trim()) {
                    return dynamicType;
                }
            } catch {
                // Best effort: fall back to the declared output type.
            }
        }

        if (typeof outputDef.outputType === 'string' && outputDef.outputType.trim()) {
            return outputDef.outputType;
        }

        return 'any';
    }

    #applyImplicitInputConversion(
        inputExpression: string,
        sourceOutputType: string,
        targetAllowedTypes: string[],
        nodeData: NodeDataLike,
        input: NodeConnectorLike,
        inputIndex: number
    ): string {
        const compatibility = resolveTypeCompatibility(sourceOutputType, targetAllowedTypes, {
            resolveTypeKind: this.#activeDataTypeKindResolver,
        });
        if (!compatibility.compatible) {
            throw new Error(
                `Input "${input.name || input.id || `in${inputIndex}`}" on node "${nodeData.getId()}" cannot accept source type "${sourceOutputType}"`
            );
        }

        if (!compatibility.requiresImplicitConversion || !compatibility.targetType) {
            return inputExpression;
        }

        if (compatibility.targetType === 'float' || compatibility.targetType === 'double') {
            return `float(${inputExpression})`;
        }
        if (compatibility.targetType === 'int') {
            return `int(${inputExpression})`;
        }
        if (compatibility.targetType === 'bool') {
            return `bool(${inputExpression})`;
        }
        if (compatibility.targetType === 'string') {
            return `str(${inputExpression})`;
        }

        return inputExpression;
    }

    /**
     * Get input default value as Python literal.
     *
     * Retrieves default value from data backbone (NodeData) in order of priority:
     * 1. nodeData.inputDefaults[key] - explicit default value storage
     * 2. input.defaultControl.default or input.defaultControl.value - from control definition
     * 3. input.defaultControl.defaultValue - from control instance (if available)
     *
     * Note: NodeControlBase instances may not be available in transpiler context,
     * so we handle both plain object definitions and control instances.
     *
     * @param {object} nodeData - NodeData instance (data backbone)
     * @param {object} input - Input definition from nodeData.inputs
     * @param {number} idx - Input index
     * @returns {string|null} Python literal or null
     * @private
     */
    #getInputDefaultLiteral(
        nodeData: NodeDataLike,
        input: NodeConnectorLike,
        idx: number
    ): string | null {
        let value = null;

        // Priority 1: Check nodeData.inputDefaults (primary data storage)
        if (nodeData.inputDefaults) {
            const key = input.id || `in${idx}`;
            if (Object.prototype.hasOwnProperty.call(nodeData.inputDefaults, key)) {
                value = nodeData.inputDefaults[key];
                if (value !== undefined && value !== null && value !== '') {
                    return formatLiteral(value);
                }
            }
        }

        // Priority 2: Check defaultControl definition
        if (input.defaultControl) {
            // Try plain object 'default' field (from node definition)
            if (input.defaultControl.default !== undefined) {
                value = input.defaultControl.default;
                if (value !== undefined && value !== null && value !== '') {
                    return formatLiteral(value);
                }
            }
            // Try 'value' field (current value in plain object)
            if (input.defaultControl.value !== undefined) {
                value = input.defaultControl.value;
                if (value !== undefined && value !== null && value !== '') {
                    return formatLiteral(value);
                }
            }
            // Try NodeControlBase instance if available (UI context)
            if (input.defaultControl.defaultValue !== undefined) {
                value = input.defaultControl.defaultValue;
                if (value !== undefined && value !== null && value !== '') {
                    return formatLiteral(value);
                }
            }
        }

        return null;
    }

    /**
     * Build function instance prelude for function-based implementations.
     *
     * Generates the instantiation statement for a node function class.
     *
     * @param {string} handlerName - Function handler name
     * @param {object} nodeData - NodeData instance
     * @param {object} connectorMeta - Connector metadata
     * @returns {string} Prelude statement
     * @private
     */
    #buildFunctionInstancePrelude(
        handlerName: string,
        nodeData: NodeDataLike,
        connectorMeta: ConnectorMetadata
    ): string {
        const inputsLiteral = this.#buildConnectorListLiteral(connectorMeta?.inputsMeta, false);
        const outputsLiteral = this.#buildConnectorListLiteral(connectorMeta?.outputsMeta, true);
        const controlsLiteral = this.#buildControlValuesLiteral(nodeData);
        const instanceName = `node_${nodeData.getId()}_impl`;

        return `${instanceName} = ${handlerName}(inputs_meta=${inputsLiteral}, outputs_meta=${outputsLiteral}, controls=${controlsLiteral})`;
    }

    /**
     * Build Python list literal for connector metadata.
     *
     * @param {Array} entries - Connector metadata entries
     * @param {boolean} includeVarName - Whether to include var_name field
     * @returns {string} Python list literal
     * @private
     */
    #buildConnectorListLiteral(
        entries: ConnectorMetaEntry[] | undefined,
        includeVarName = false
    ): string {
        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) {
            return '[]';
        }

        const items = list.map((entry) => {
            const fields = [
                `'id': ${formatLiteral(entry?.id ?? '')}`,
                `'name': ${formatLiteral(entry?.name ?? '')}`,
                `'connected': ${entry?.connected ? 'True' : 'False'}`,
            ];

            if (includeVarName && entry?.varName) {
                fields.push(`'var_name': ${formatLiteral(entry.varName)}`);
            }

            return `{ ${fields.join(', ')} }`;
        });

        return `[${items.join(', ')}]`;
    }

    /**
     * Build Python dict literal for control values.
     *
     * @param {object} nodeData - NodeData instance
     * @returns {string} Python dict literal
     * @private
     */
    #buildControlValuesLiteral(nodeData: NodeDataLike): string {
        if (!nodeData || !Array.isArray(nodeData.controls)) {
            return '{}';
        }

        const payload: Record<string, string> = {};
        nodeData.controls.forEach((control) => {
            const key = control?.id;
            if (!key) {
                return;
            }
            const value = nodeData.controlValues ? nodeData.controlValues[key] : undefined;
            payload[key] = formatLiteral(value);
        });

        return createObjectLiteral(payload);
    }

    /**
     * Execute code generator function.
     *
     * Calls a global code generator function with node context and returns
     * generated code.
     *
     * @param {string} generatorPath - Global path to generator function
     * @param {string} language - Target language
     * @param {object} nodeData - NodeData instance
     * @param {string[]} inputRefs - Input variable references
     * @param {string[]} outputVars - Output variable names
     * @param {Set} importCollector - Import collector
     * @param {object} connectorMeta - Connector metadata
     * @returns {{expression?: string, statement?: string, outputs: string[], imports: string[]}} Generated code
     * @private
     */
    #executeCodeGenerator(
        generatorPath: string,
        language: TranspilerLanguage,
        graph: NodeGraphLike,
        nodeData: NodeDataLike,
        inputRefs: string[],
        outputVars: string[],
        inputSourceRefs: Array<InputSourceReference | null>,
        importCollector: Set<string>,
        connectorMeta: ConnectorMetadata
    ): CodeGeneratorResult {
        const generatorFn = resolveGlobalFunction(generatorPath);
        if (typeof generatorFn !== 'function') {
            throw new Error(`Generator function "${generatorPath}" was not found`);
        }

        const registerImport = (statement: string) => {
            registerImportStatement(importCollector, statement);
        };

        const inputsMeta = Array.isArray(connectorMeta?.inputsMeta)
            ? connectorMeta.inputsMeta.map((entry) => ({ ...entry }))
            : [];

        const outputsMeta = Array.isArray(connectorMeta?.outputsMeta)
            ? connectorMeta.outputsMeta.map((entry) => ({ ...entry }))
            : [];

        const nodeTypeById = new Map<string, string>();
        const rawGraphNodes = graph?.getNodes?.() || [];
        if (Array.isArray(rawGraphNodes)) {
            for (const node of rawGraphNodes) {
                nodeTypeById.set(node.getId(), node.getType());
            }
        } else {
            for (const [id, node] of Object.entries(rawGraphNodes)) {
                nodeTypeById.set(id, node.getType());
            }
        }

        const context = {
            language,
            // `scope` is the graph's emitted function name (null outside a `#transpileGraph()` call);
            // generators use it to keep module-level names unique across merged shared-init blocks.
            graph: {
                id: graph?.getId?.() || null,
                name: graph?.getName?.() || null,
                scope: this.#activeGraphScope,
            },
            node: cloneNodeForGenerator(nodeData),
            inputs: Array.isArray(inputRefs) ? inputRefs.slice() : [],
            outputs: Array.isArray(outputVars) ? outputVars.slice() : [],
            inputSources: Array.isArray(inputSourceRefs)
                ? inputSourceRefs.map((entry) =>
                      entry
                          ? { ...entry, fromType: nodeTypeById.get(entry.fromNode) ?? null }
                          : null
                  )
                : [],
            inputsMeta,
            outputsMeta,
            helpers: {
                getNullLiteral: () => getNullLiteral(),
                formatLiteral: (value: unknown) => formatLiteral(value),
                createOutputName: (index: number) =>
                    createOutputVariableName(nodeData.getId(), index),
                registerImport,
            },
        };

        const rawResult = generatorFn(context);

        // Normalize result
        const normalized: CodeGeneratorResult = {
            expression: null,
            statement: null,
            outputs: Array.isArray(outputVars) ? outputVars.slice() : [],
            imports: [],
            commentOnlySuppressed: false,
            init: null,
        };

        if (typeof rawResult === 'string') {
            normalized.statement = this.#stripGeneratorCommentLines(rawResult);
        } else if (rawResult && typeof rawResult === 'object') {
            if (typeof rawResult.expression === 'string') {
                normalized.expression = this.#stripGeneratorCommentLines(rawResult.expression);
            }
            if (typeof rawResult.statement === 'string') {
                normalized.statement = this.#stripGeneratorCommentLines(rawResult.statement);
            }
            if (Array.isArray(rawResult.outputs)) {
                normalized.outputs = rawResult.outputs.slice();
            }
            if (Array.isArray(rawResult.imports)) {
                normalized.imports = rawResult.imports.slice();
            }
            if (rawResult.init && typeof rawResult.init === 'object') {
                const initBlock =
                    typeof rawResult.init.block === 'string'
                        ? this.#stripGeneratorCommentLines(rawResult.init.block)
                        : null;
                const initPriority = Number.isFinite(rawResult.init.priority)
                    ? Number(rawResult.init.priority)
                    : null;
                const initExecute =
                    typeof rawResult.init.execute === 'string'
                        ? this.#stripGeneratorCommentLines(rawResult.init.execute)
                        : null;
                normalized.init = {
                    block: initBlock,
                    priority: initPriority,
                    execute: initExecute,
                };
            }
        } else {
            throw new Error(`Generator "${generatorPath}" returned an unsupported result type`);
        }

        const hasInitExecute = Boolean(
            normalized.init &&
            typeof normalized.init.execute === 'string' &&
            normalized.init.execute.trim()
        );

        const hasRawExpression = Boolean(
            rawResult &&
            typeof rawResult === 'object' &&
            typeof rawResult.expression === 'string' &&
            rawResult.expression.trim().length > 0
        );
        const hasRawStatement =
            typeof rawResult === 'string'
                ? rawResult.trim().length > 0
                : Boolean(
                      rawResult &&
                      typeof rawResult === 'object' &&
                      typeof rawResult.statement === 'string' &&
                      rawResult.statement.trim().length > 0
                  );
        const hasRawInitExecute = Boolean(
            rawResult &&
            typeof rawResult === 'object' &&
            rawResult.init &&
            typeof rawResult.init === 'object' &&
            typeof rawResult.init.execute === 'string' &&
            rawResult.init.execute.trim().length > 0
        );
        const hadRawCode = hasRawExpression || hasRawStatement || hasRawInitExecute;

        if (!normalized.expression && !normalized.statement && !hasInitExecute) {
            if (hadRawCode) {
                normalized.commentOnlySuppressed = true;
            } else {
                throw new Error(
                    `Generator "${generatorPath}" must return an object containing "statement" or "expression" (or "init.execute")`
                );
            }
        }

        if (!Array.isArray(normalized.outputs)) {
            normalized.outputs = Array.isArray(outputVars) ? outputVars.slice() : [];
        }

        if (normalized.imports && normalized.imports.length) {
            normalized.imports.forEach(registerImport);
        }

        return normalized;
    }

    /**
     * Register node assets in package assets map.
     *
     * Extracts library files and module roots from node definition and
     * adds them to the package assets collection.
     *
     * @param {object} nodeDefinition - Node type definition
     * @param {Map} packageAssets - Package assets map
     * @private
     */
    #registerNodeAssets(
        nodeDefinition: NodeDefinitionLike,
        packageAssets: Map<string, PackageAssetEntry>
    ): void {
        if (!nodeDefinition) {
            return;
        }

        const pkgId = nodeDefinition.packageId || 'core';

        if (!packageAssets.has(pkgId)) {
            packageAssets.set(pkgId, { files: new Set(), moduleRoots: new Set() });
        }

        const entry = packageAssets.get(pkgId);
        if (!entry) {
            return;
        }

        // Register library files
        if (Array.isArray(nodeDefinition.mpAssets)) {
            nodeDefinition.mpAssets.forEach((asset) => {
                const rel = this.#relativizeAssetPath(asset, pkgId);
                if (rel) {
                    entry.files.add(rel);
                }
            });
        }

        // Register module roots
        if (Array.isArray(nodeDefinition.mpModuleRoots)) {
            nodeDefinition.mpModuleRoots.forEach((root) => {
                const rel = this.#relativizeModuleRoot(root, pkgId);
                if (rel) {
                    entry.moduleRoots.add(rel);
                }
            });
        }
    }

    #buildEmptyHelperHandoff(): TranspilerHelperHandoffV1 {
        return {
            schemaVersion: 'transpiler-helper-handoff/v1',
            helperGroups: {},
        };
    }

    /**
     * Relativize asset path for package storage.
     *
     * @param {string} assetPath - Full asset path
     * @param {string} pkgId - Package ID
     * @returns {string|null} Relativized path or null
     * @private
     */
    #relativizeAssetPath(assetPath: string | undefined, pkgId: string): string | null {
        if (!assetPath) {
            return null;
        }

        const normalized = assetPath.replace(/\\/g, '/').trim();
        if (!normalized) {
            return null;
        }

        // Try to extract relative path from /libs/ token
        const libsToken = '/libs/';
        const libsIdx = normalized.lastIndexOf(libsToken);
        if (libsIdx >= 0) {
            const rel = normalized.slice(libsIdx + libsToken.length);
            return rel || null;
        }

        // Try package-specific token
        if (pkgId) {
            const pkgToken = `/${pkgId}/`;
            const pkgIdx = normalized.lastIndexOf(pkgToken);
            if (pkgIdx >= 0) {
                const rel = normalized.slice(pkgIdx + pkgToken.length);
                return rel || null;
            }
        }

        return normalized;
    }

    /**
     * Relativize module root path for package storage.
     *
     * @param {string} rootPath - Full module root path
     * @param {string} pkgId - Package ID
     * @returns {string|null} Relativized path or null
     * @private
     */
    #relativizeModuleRoot(rootPath: string | undefined, pkgId: string): string | null {
        if (!rootPath) {
            return null;
        }

        let normalized = rootPath.replace(/\\/g, '/').trim();
        if (!normalized) {
            return null;
        }

        // Remove trailing slash
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        // Try package-specific token
        if (pkgId) {
            const pkgToken = `/${pkgId}/`;
            const pkgIdx = normalized.lastIndexOf(pkgToken);
            if (pkgIdx >= 0) {
                const rel = normalized.slice(pkgIdx + pkgToken.length);
                return rel || null;
            }
        }

        // Try generic packages directory token
        const pkgDirToken = '/nodes/packages/';
        const dirIdx = normalized.lastIndexOf(pkgDirToken);
        if (dirIdx >= 0) {
            const rel = normalized.slice(dirIdx + pkgDirToken.length);
            return rel || null;
        }

        return normalized;
    }

    /**
     * Get last generated code.
     *
     * Returns the Python code from the most recent transpilation, or null if
     * transpile() has never been called.
     *
     * @returns {string|null} Last generated Python code or null
     *
     * @example
     * const code = transpiler.getLastGeneratedCode();
     * if (code) {
     *   logger.info('Last transpiled code', code);
     * }
     */
    getLastGeneratedCode(): string | null {
        return this.#lastGeneratedCode;
    }

    /**
     * Get last generated assets.
     *
     * Returns the assets (imports, libraries, etc.) from the most recent
     * transpilation, or null if transpile() has never been called.
     *
     * @returns {object|null} Last generated assets or null
     *
     * @example
     * const assets = transpiler.getLastGeneratedAssets();
     * if (assets) {
     *   logger.info('Required imports', assets.imports);
     * }
     */
    getLastGeneratedAssets(): TranspileAssets | null {
        return this.#lastGeneratedAssets;
    }

    /**
     * Check if transpilation is needed for a collection.
     *
     * Compares the collection's current version with the version from the last
     * transpilation. Only major or minor version changes require re-transpilation;
     * patch version changes do NOT require re-transpilation.
     *
     * @param {object} collection - Collection instance to check
     * @returns {boolean} True if transpile() should be called
     *
     * @example
     * if (transpiler.needsTranspile(collection)) {
     *   await transpiler.transpile(collection, { deviceRuntime });
     * } else {
     *   logger.info('Using cached code');
     * }
     */
    needsTranspile(collection: CollectionLike | null | undefined): boolean {
        const collectionId = collection?.getId?.() ?? null;
        // Never transpiled or different collection
        if (!this.#lastGeneratedCode || this.#lastCollectionId !== collectionId) {
            return true;
        }

        if (!collection) {
            return true;
        }

        // No version stored from last transpile
        if (!this.#lastCollectionVersion) {
            return true;
        }

        // Compare major.minor versions (ignore patch)
        const currentVersion = collection.getVersion();
        const lastVersion = this.#lastCollectionVersion;

        // Parse version strings (format: "major.minor.patch")
        const parseMajorMinor = (
            version: CollectionVersionLike
        ): { major: number; minor: number } => {
            const parts = String(version).split('.');
            return {
                major: parseInt(parts[0]) || 0,
                minor: parseInt(parts[1]) || 0,
            };
        };

        const current = parseMajorMinor(currentVersion);
        const last = parseMajorMinor(lastVersion);

        // Transpile needed if major or minor changed
        return current.major !== last.major || current.minor !== last.minor;
    }

    /**
     * Clear cached transpilation results.
     *
     * Forces the next transpile() call to regenerate code even if the collection
     * version hasn't changed. Useful for debugging or when node implementations change.
     *
     * @example
     * transpiler.clearCache();
     * await transpiler.transpile(collection, { deviceRuntime }); // Always regenerates
     */
    clearCache(): void {
        this.#lastGeneratedCode = null;
        this.#lastGeneratedAssets = null;
        this.#lastTranspileDate = null;
        this.#lastCollectionId = null;
        this.#lastCollectionVersion = null;

        this.#logger.log?.('[Transpiler] Cache cleared');
    }

    /**
     * Get transpiler statistics.
     *
     * Returns information about the last transpilation including timing,
     * collection version, and cache state.
     *
     * @returns {{
     *   lastTranspileDate: number|null,
     *   lastCollectionId: string|null,
     *   lastCollectionVersion: string|null,
     *   hasCachedCode: boolean
     * }} Transpiler statistics
     *
     * @example
     * const stats = transpiler.getStats();
     * logger.info('Last transpiled', new Date(stats.lastTranspileDate));
     * logger.info('Collection version', stats.lastCollectionVersion);
     */
    getStats(): {
        lastTranspileDate: number | null;
        lastCollectionId: string | null;
        lastCollectionVersion: string | null;
        hasCachedCode: boolean;
    } {
        return {
            lastTranspileDate: this.#lastTranspileDate,
            lastCollectionId: this.#lastCollectionId,
            lastCollectionVersion:
                this.#lastCollectionVersion === null ? null : String(this.#lastCollectionVersion),
            hasCachedCode: this.#lastGeneratedCode !== null,
        };
    }
}
