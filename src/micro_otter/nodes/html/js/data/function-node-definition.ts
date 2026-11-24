// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Generated node definitions for function graphs.
 *
 * Every enabled function graph becomes an ordinary palette node: its type id is
 * `function_graph.<graphId>`, its palette category is the graph's function category and
 * its connectors mirror the declared signature — inputs become parameters, outputs
 * become results. The definition is rebuilt from the graph on every call, so a
 * signature edit can never leave a stale connector list behind.
 *
 * `implementations.python` is emitted **only** when the caller supplies the Python
 * function name: the palette lists call nodes without a body reference, while the
 * transpiler resolves the same definition with the name its pre-pass assigned. A
 * definition therefore never carries a call expression pointing at a name it cannot
 * resolve.
 *
 * Generated definitions are collection-local (D9): only the owning collection lists
 * them, disabled graphs are omitted, and the graph being edited never lists itself.
 *
 * @module data/function-node-definition
 */

import { normalizeExecutionType, normalizeGraphEnabled } from './graph-execution-settings.js';
import {
    FUNCTION_NODE_COLOR,
    FUNCTION_NODE_TYPE_PREFIX,
    buildFunctionInputDefaultControl,
    buildFunctionNodeTypeId,
    buildFunctionParameterNames,
    buildFunctionPortAllowedTypes,
    normalizeFunctionCategory,
    normalizeFunctionSignature,
} from './graph-function-signature.js';
import type {
    FunctionInputDefaultControl,
    FunctionPort,
    FunctionPortKind,
} from './graph-function-signature.js';
import type { LocalizedTextMap } from './node-type.js';

/** Palette package id every generated function node belongs to. */
export const FUNCTION_NODE_PACKAGE_ID = 'function';

/** Fallback label of the function package group when a locale key is missing. */
export const FUNCTION_NODE_PACKAGE_NAME = 'Function';

/** One connector descriptor of a generated definition. */
export interface FunctionNodeConnectorDescriptor {
    /** Port id of the mirrored port (`in_0`, `out_0`, …). */
    id: string;
    /** Free-text port name; display only, never a wiring key. */
    name: string;
    /** Non-empty allowed data types; `['any']` accepts everything. */
    allowedTypes: string[];
    /** Inline editor shown next to an unwired input; inputs only, mirrors the default. */
    defaultControl?: FunctionInputDefaultControl;
    /** Markdown documentation of the port; present only when the port declares one. */
    description?: string;
}

/** Python implementation of a generated call node. */
export interface FunctionNodePythonImplementation {
    /** The transpiler renders `value` as a `{{…}}` template. */
    type: 'regex';
    /** `await <function>({{in0}}, …)` (no arguments when the signature has none). */
    value: string;
}

/** Definition of one generated function node, shaped like a runtime node type. */
export interface FunctionNodeDefinition {
    /** Generated type id (`function_graph.<graphId>`). */
    type: string;
    /** Always {@link FUNCTION_NODE_PACKAGE_ID}. */
    packageId: string;
    /** Palette category, taken from the graph's function category. */
    category: string;
    /** Display name: the function graph's name. */
    title: LocalizedTextMap;
    /** Semantic icon of the signature (`<set>:<name>`), resolved by the view system. */
    icon: string;
    /** Node color: {@link FUNCTION_NODE_COLOR}. */
    color: string;
    /** Declared inputs, in parameter order. */
    inputs: FunctionNodeConnectorDescriptor[];
    /** Declared outputs, in return order. */
    outputs: FunctionNodeConnectorDescriptor[];
    /** Empty for palette entries; carries the call expression for the transpiler. */
    implementations: { python?: FunctionNodePythonImplementation };
    /** Markdown description of the function; present only when the graph declares one. */
    info?: string;
}

/** The graph surface the definition builder reads. */
export interface FunctionNodeDefinitionSource {
    getFunctionNodeTypeId?: () => string;
    getId?: () => string;
    getName?: () => string;
    getFunctionSignature?: () => unknown;
    getFunctionCategory?: () => unknown;
}

/** Options of {@link buildFunctionNodeDefinition}. */
export interface BuildFunctionNodeDefinitionOptions {
    /** Python function name; enables `implementations.python` when supplied. */
    pythonFunctionName?: string | null;
}

/** The collection surface {@link listFunctionNodeDefinitions} reads. */
export interface FunctionNodeCollectionLike {
    getGraphArray?: () => unknown;
}

/** Options of {@link listFunctionNodeDefinitions}. */
export interface ListFunctionNodeDefinitionsOptions {
    /** Graph being edited; it never lists itself (self-call guard, D15). */
    excludeGraphId?: string | null;
}

/**
 * Whether a type id belongs to a generated function node.
 *
 * The suffix must be non-empty, so the bare prefix is not a function node type.
 *
 * @param typeId - Candidate node type id.
 * @returns True for `function_graph.<graphId>`.
 */
export function isFunctionNodeTypeId(typeId: unknown): boolean {
    return resolveFunctionGraphId(typeId) !== null;
}

/**
 * Extract the graph id from a generated function node type id.
 * @param typeId - Candidate node type id.
 * @returns The graph id, or `null` when the id is not a function node type id.
 */
export function resolveFunctionGraphId(typeId: unknown): string | null {
    if (typeof typeId !== 'string' || !typeId.startsWith(FUNCTION_NODE_TYPE_PREFIX)) {
        return null;
    }
    const graphId = typeId.slice(FUNCTION_NODE_TYPE_PREFIX.length).trim();
    return graphId.length > 0 ? graphId : null;
}

/**
 * Map signature ports onto connector descriptors.
 *
 * `allowedTypes` is always non-empty because `NodeData.getInputAllowedTypes()` throws
 * otherwise; the signature normalizer already guarantees a type for every port.
 *
 * @param ports - Normalized signature ports.
 * @returns One connector descriptor per port, in declaration order.
 */
function buildConnectorDescriptors(
    ports: readonly FunctionPort[],
    kind: FunctionPortKind
): FunctionNodeConnectorDescriptor[] {
    return ports.map((port) => {
        const descriptor: FunctionNodeConnectorDescriptor = {
            id: port.id,
            name: port.name,
            allowedTypes: buildFunctionPortAllowedTypes(port),
        };
        if (kind === 'input') {
            descriptor.defaultControl = buildFunctionInputDefaultControl(port);
        }
        if (port.documentation) {
            descriptor.description = port.documentation;
        }
        return descriptor;
    });
}

/**
 * Read the generated type id of a graph.
 * @param graph - Definition source.
 * @returns `function_graph.<graphId>`.
 * @throws {TypeError} When the graph exposes neither a type id nor an id.
 */
function resolveFunctionNodeTypeId(graph: FunctionNodeDefinitionSource): string {
    if (typeof graph.getFunctionNodeTypeId === 'function') {
        return graph.getFunctionNodeTypeId();
    }
    return buildFunctionNodeTypeId(graph.getId?.());
}

/**
 * Build the palette definition of one function graph.
 *
 * Unknown or missing signature members degrade to an empty signature through the
 * phase-1 normalizer, so a graph written before function graphs still yields a valid
 * zero-argument definition instead of throwing.
 *
 * @param graph - Function graph to describe.
 * @param options - Call-site options; `pythonFunctionName` enables the implementation.
 * @returns A definition ready for the palette and the transpiler.
 * @throws {TypeError} When the graph has no usable id.
 */
export function buildFunctionNodeDefinition(
    graph: FunctionNodeDefinitionSource,
    { pythonFunctionName = null }: BuildFunctionNodeDefinitionOptions = {}
): FunctionNodeDefinition {
    const typeId = resolveFunctionNodeTypeId(graph);
    const signature = normalizeFunctionSignature(graph.getFunctionSignature?.());
    const graphName =
        typeof graph.getName === 'function' ? String(graph.getName() ?? '').trim() : '';

    const implementations: FunctionNodeDefinition['implementations'] = {};
    const functionName = typeof pythonFunctionName === 'string' ? pythonFunctionName.trim() : '';
    if (functionName) {
        const args = signature.inputs.map((_port, index) => `{{in${index}}}`).join(', ');
        implementations.python = {
            type: 'regex',
            value: `await ${functionName}(${args})`,
        };
    }

    const definition: FunctionNodeDefinition = {
        type: typeId,
        packageId: FUNCTION_NODE_PACKAGE_ID,
        category: normalizeFunctionCategory(graph.getFunctionCategory?.() ?? signature.category),
        title: { en: graphName || typeId },
        icon: signature.icon,
        color: FUNCTION_NODE_COLOR,
        inputs: buildConnectorDescriptors(signature.inputs, 'input'),
        outputs: buildConnectorDescriptors(signature.outputs, 'output'),
        implementations,
    };
    if (signature.description) {
        definition.info = signature.description;
    }
    return definition;
}

/**
 * List the definitions the owning collection publishes to the palette.
 *
 * Only enabled function graphs are listed (D9), the graph passed as `excludeGraphId` is
 * skipped (D15) and duplicate ids are dropped so a runtime definition can never be
 * shadowed by a generated one.
 *
 * @param collection - Collection whose graphs are listed; `null` yields no entries.
 * @param options - Listing options.
 * @returns One definition per published function graph, in graph order.
 */
export function listFunctionNodeDefinitions(
    collection: FunctionNodeCollectionLike | null | undefined,
    { excludeGraphId = null }: ListFunctionNodeDefinitionsOptions = {}
): FunctionNodeDefinition[] {
    const graphs = collection?.getGraphArray?.();
    if (!Array.isArray(graphs)) {
        return [];
    }

    const definitions: FunctionNodeDefinition[] = [];
    const seenTypeIds = new Set<string>();

    for (const graph of graphs) {
        if (!graph || typeof graph !== 'object') {
            continue;
        }
        const candidate = graph as FunctionNodeDefinitionSource & {
            getExecutionType?: () => unknown;
            getEnabled?: () => unknown;
        };
        if (normalizeExecutionType(candidate.getExecutionType?.()) !== 'function') {
            continue;
        }
        if (!normalizeGraphEnabled(candidate.getEnabled?.())) {
            continue;
        }
        const graphId = typeof candidate.getId === 'function' ? candidate.getId() : null;
        if (excludeGraphId && graphId === excludeGraphId) {
            continue;
        }

        let definition: FunctionNodeDefinition;
        try {
            definition = buildFunctionNodeDefinition(candidate);
        } catch {
            // A graph without a usable id cannot be called; skip it instead of failing the palette.
            continue;
        }
        if (seenTypeIds.has(definition.type)) {
            continue;
        }
        seenTypeIds.add(definition.type);
        definitions.push(definition);
    }

    return definitions;
}

/**
 * Resolve the generated definition behind one node type id.
 *
 * @param collection - Collection that owns the function graph.
 * @param typeId - Node type id (`function_graph.<graphId>`).
 * @returns The definition, or `null` when the id is not generated or its graph is gone.
 */
export function resolveFunctionNodeDefinition(
    collection: FunctionNodeCollectionLike | null | undefined,
    typeId: unknown
): FunctionNodeDefinition | null {
    if (!isFunctionNodeTypeId(typeId)) {
        return null;
    }
    return (
        listFunctionNodeDefinitions(collection).find((definition) => definition.type === typeId) ??
        null
    );
}

/** Implementation of a structural function node: variable mappings, never code of its own. */
export interface FunctionNodeStructuralImplementation {
    /** Marks the implementation as structural; the transpiler emits no call for it. */
    type: 'structural';
    /** Connector index → expression the connector resolves to (input node: the parameters). */
    outputs?: string[];
    /** Statement emitted after the body (output node: the `return ...`). */
    statement?: string;
}

/**
 * Build the implementation of one structural function node.
 *
 * The input node maps its output connectors (the declared inputs) onto the generated
 * parameter names, so every use of a parameter inside the body reads the parameter
 * variable. The output node turns its input connectors (the declared outputs) into the
 * function's `return`: `return None` without declared outputs, a bare value for exactly
 * one, and a tuple for several. The placeholders are the connector ids, which are the
 * port ids, and the transpiler fills them from its regular `{{…}}` context — an
 * unconnected declared output therefore becomes `None` through the normal input default.
 *
 * @param kind - Side of the signature the node mirrors.
 * @param signature - Raw or normalized signature of the graph.
 * @returns The structural implementation for the node type.
 */
export function buildStructuralNodeDefinition(
    kind: FunctionPortKind,
    signature: unknown
): FunctionNodeStructuralImplementation {
    const normalized = normalizeFunctionSignature(signature);

    if (kind === 'input') {
        return {
            type: 'structural',
            outputs: buildFunctionParameterNames(normalized.inputs),
        };
    }

    const placeholders = normalized.outputs.map((port) => `{{${port.id}}}`);
    if (placeholders.length === 0) {
        return { type: 'structural', statement: 'return None' };
    }
    if (placeholders.length === 1) {
        return { type: 'structural', statement: `return ${placeholders[0]}` };
    }
    return { type: 'structural', statement: `return (${placeholders.join(', ')})` };
}
