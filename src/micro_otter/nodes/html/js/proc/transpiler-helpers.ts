// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @fileoverview Pure utility functions for the transpiler.
 */

type JsonRecord = Record<string, unknown>;

type InputConnectionSource = {
    fromNode: string;
    fromIndex: number;
};

type InputConnectionMap = Record<number, InputConnectionSource>;

type ConnectorLike = {
    id?: string;
    name?: string;
    phase?: unknown;
} | null;

type GraphNodeLike = {
    id: string;
    inputs?: ConnectorLike[];
    outputs?: ConnectorLike[];
};

type NodeLike = {
    id: string;
};

type OutputConnectionLike = {
    fromNode: string;
    fromIndex: number;
};

type GraphConnectionLike = {
    fromNode: string;
    toNode: string;
    fromIndex?: number;
    toIndex?: number;
};

type NodeExecutionPhase = 'init' | 'loop' | 'both';
type ConnectorPhase = 'init' | 'loop' | 'both';
type ExecutionPhase = 'init' | 'loop';

type PhaseNodeLike = {
    id: string;
    executionPhase?: unknown;
};

type PhaseConnectionLike = GraphConnectionLike & {
    outputPhase?: unknown;
    inputPhase?: unknown;
};

type InputConnectionLike = {
    fromNode: string;
    fromIndex: number;
    toNode: string;
    toIndex: number;
};

type ClonableNode = {
    id?: unknown;
    type?: unknown;
    title?: unknown;
    inputs?: unknown;
    outputs?: unknown;
    controls?: unknown;
    controlValues?: unknown;
    inputDefaults?: unknown;
};

function deepCloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function createOutputVariableName(nodeId: string, outputIndex: number): string {
    return `node_${nodeId}_out${outputIndex}`;
}

export function getNullLiteral(): string {
    return 'None';
}

export function formatLiteral(value: unknown): string {
    if (value === undefined || value === null) {
        return getNullLiteral();
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value.toString() : getNullLiteral();
    }
    if (typeof value === 'boolean') {
        return value ? 'True' : 'False';
    }
    if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `'${escaped}'`;
    }
    return String(value);
}

export function indentMultiLine(code: string | null | undefined, indent: string): string {
    if (!code || typeof code !== 'string') {
        return '';
    }
    if (!indent) {
        return code;
    }
    return code
        .split('\n')
        .map((line) => (line.trim() === '' ? '' : `${indent}${line}`))
        .join('\n');
}

export function createObjectLiteral(obj: JsonRecord | null | undefined): string {
    if (!obj) {
        return '{}';
    }
    const entries = Object.entries(obj).filter(([, val]) => val !== undefined && val !== null);
    if (entries.length === 0) {
        return '{}';
    }
    return `{ ${entries.map(([key, val]) => `'${key}': ${val}`).join(', ')} }`;
}

export function buildOutputConnectionLookup(
    connectionsList: OutputConnectionLike[] | null | undefined
): Map<string, Set<number>> {
    const edges = Array.isArray(connectionsList) ? connectionsList : [];
    const map = new Map<string, Set<number>>();
    edges.forEach((conn) => {
        if (!map.has(conn.fromNode)) {
            map.set(conn.fromNode, new Set<number>());
        }
        map.get(conn.fromNode)?.add(conn.fromIndex);
    });
    return map;
}

export function buildInputConnectionLookup(
    connectionsList: InputConnectionLike[] | null | undefined
): Map<string, InputConnectionMap> {
    const edges = Array.isArray(connectionsList) ? connectionsList : [];
    const map = new Map<string, InputConnectionMap>();
    edges.forEach((conn) => {
        if (!map.has(conn.toNode)) {
            map.set(conn.toNode, {});
        }
        const nodeConnections = map.get(conn.toNode);
        if (nodeConnections) {
            nodeConnections[conn.toIndex] = {
                fromNode: conn.fromNode,
                fromIndex: conn.fromIndex,
            };
        }
    });
    return map;
}

export function computeConnectorMetadata(
    graphNodes: GraphNodeLike[] | null | undefined,
    connectionLookup: Map<string, InputConnectionMap>,
    outputLookup: Map<string, Set<number>>
): Map<string, { inputsMeta: Array<{ id: string; name: string; connected: boolean }>; outputsMeta: Array<{ id: string; name: string; varName: string; connected: boolean }> }> {
    const meta = new Map<
        string,
        {
            inputsMeta: Array<{ id: string; name: string; connected: boolean }>;
            outputsMeta: Array<{ id: string; name: string; varName: string; connected: boolean }>;
        }
    >();
    const nodesList = Array.isArray(graphNodes) ? graphNodes : [];
    nodesList.forEach((node) => {
        const inputConnections = connectionLookup.get(node.id) || {};
        const outputConnections = outputLookup.get(node.id) || new Set<number>();
        const inputsMeta = Array.isArray(node.inputs)
            ? node.inputs.map((input, idx) => ({
                  id: input?.id ?? `in${idx}`,
                  name: input?.name ?? input?.id ?? `in${idx}`,
                  connected: Boolean(inputConnections[idx]),
              }))
            : [];
        const outputsMeta = Array.isArray(node.outputs)
            ? node.outputs.map((output, idx) => ({
                  id: output?.id ?? `out${idx}`,
                  name: output?.name ?? output?.id ?? `out${idx}`,
                  varName: createOutputVariableName(node.id, idx),
                  connected: outputConnections.has(idx),
              }))
            : [];
        meta.set(node.id, { inputsMeta, outputsMeta });
    });
    return meta;
}

export function getTopologicallySortedNodeIds(
    nodesList: NodeLike[] | null | undefined,
    connectionsList: GraphConnectionLike[] | null | undefined
): string[] {
    const nodeEntries = Array.isArray(nodesList) ? nodesList : [];
    const edges = Array.isArray(connectionsList) ? connectionsList : [];
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    nodeEntries.forEach((node) => {
        adjacency.set(node.id, []);
        inDegree.set(node.id, 0);
    });

    edges.forEach((conn) => {
        if (!adjacency.has(conn.fromNode)) {
            adjacency.set(conn.fromNode, []);
        }
        adjacency.get(conn.fromNode)?.push(conn.toNode);
        inDegree.set(conn.toNode, (inDegree.get(conn.toNode) || 0) + 1);
    });

    const queue: string[] = [];
    inDegree.forEach((degree, nodeId) => {
        if (degree === 0) {
            queue.push(nodeId);
        }
    });

    const ordered: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        ordered.push(current);
        const neighbors = adjacency.get(current) || [];
        neighbors.forEach((neighbor) => {
            const updated = (inDegree.get(neighbor) || 0) - 1;
            inDegree.set(neighbor, updated);
            if (updated === 0) {
                queue.push(neighbor);
            }
        });
    }

    if (ordered.length !== nodeEntries.length) {
        throw new Error('Cycle detected in node graph. Unable to transpile.');
    }

    return ordered;
}

export function normalizeNodeExecutionPhase(value: unknown): NodeExecutionPhase {
    if (value === 'init' || value === 'loop' || value === 'both') {
        return value;
    }
    return 'loop';
}

export function normalizeConnectorPhase(value: unknown): ConnectorPhase {
    if (value === 'init' || value === 'loop' || value === 'both') {
        return value;
    }
    return 'both';
}

export function isNodeExecutionPhaseCompatible(
    nodeExecutionPhase: unknown,
    executionPhase: ExecutionPhase
): boolean {
    const normalizedNodePhase = normalizeNodeExecutionPhase(nodeExecutionPhase);
    return normalizedNodePhase === 'both' || normalizedNodePhase === executionPhase;
}

export function isEdgePhaseCompatible(
    outputPhase: unknown,
    inputPhase: unknown,
    executionPhase: ExecutionPhase
): boolean {
    const normalizedOutputPhase = normalizeConnectorPhase(outputPhase);
    const normalizedInputPhase = normalizeConnectorPhase(inputPhase);
    const outputCompatible =
        normalizedOutputPhase === 'both' || normalizedOutputPhase === executionPhase;
    const inputCompatible =
        normalizedInputPhase === 'both' || normalizedInputPhase === executionPhase;
    return outputCompatible && inputCompatible;
}

export function getPhaseCompatibleConnections(
    nodesList: PhaseNodeLike[] | null | undefined,
    connectionsList: PhaseConnectionLike[] | null | undefined,
    executionPhase: ExecutionPhase
): PhaseConnectionLike[] {
    const nodeEntries = Array.isArray(nodesList) ? nodesList : [];
    const edges = Array.isArray(connectionsList) ? connectionsList : [];

    const phaseNodeIdSet = new Set(
        nodeEntries
            .filter((node) =>
                isNodeExecutionPhaseCompatible(node.executionPhase, executionPhase)
            )
            .map((node) => node.id)
    );

    return edges.filter((connection) => {
        if (!phaseNodeIdSet.has(connection.fromNode) || !phaseNodeIdSet.has(connection.toNode)) {
            return false;
        }

        return isEdgePhaseCompatible(
            connection.outputPhase,
            connection.inputPhase,
            executionPhase
        );
    });
}

export function getTopologicallySortedNodeIdsForExecutionPhase(
    nodesList: PhaseNodeLike[] | null | undefined,
    connectionsList: PhaseConnectionLike[] | null | undefined,
    executionPhase: ExecutionPhase
): string[] {
    const nodeEntries = Array.isArray(nodesList) ? nodesList : [];
    const phaseNodes = nodeEntries.filter((node) =>
        isNodeExecutionPhaseCompatible(node.executionPhase, executionPhase)
    );
    const phaseEdges = getPhaseCompatibleConnections(nodeEntries, connectionsList, executionPhase);

    return getTopologicallySortedNodeIds(
        phaseNodes.map((node) => ({ id: node.id })),
        phaseEdges
    );
}

export function registerImportStatement(importCollector: Set<string> | null | undefined, statement: string): void {
    if (!importCollector || typeof statement !== 'string') {
        return;
    }
    const trimmed = statement.trim();
    if (trimmed) {
        importCollector.add(trimmed);
    }
}

export function registerPythonFunctionImport(
    path: string,
    importCollector: Set<string> | null | undefined
): string | null {
    if (!importCollector || typeof path !== 'string') {
        return null;
    }
    const trimmedPath = path.trim();
    if (!trimmedPath) {
        return null;
    }
    const segments = trimmedPath.split('.').filter(Boolean);
    if (segments.length < 2) {
        return null;
    }
    const functionName = segments.pop();
    const modulePath = segments.join('.');
    if (!modulePath || !functionName) {
        return null;
    }
    registerImportStatement(importCollector, `from ${modulePath} import ${functionName}`);
    return functionName;
}

export function renderTemplate(template: string, context: JsonRecord): string {
    if (!template) {
        return '';
    }

    return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, key: string) => {
        const trimmedKey = key.trim();
        if (Object.prototype.hasOwnProperty.call(context, trimmedKey)) {
            return String(context[trimmedKey]);
        }
        return '';
    });
}

export function resolveGlobalFunction(path: string): unknown {
    if (!path || typeof path !== 'string') {
        return null;
    }
    const root =
        typeof globalThis !== 'undefined'
            ? (globalThis as Record<string, unknown>)
            : (window as unknown as Record<string, unknown>);

    return path.split('.').reduce<unknown>((acc, segment) => {
        if (!segment) {
            return acc;
        }
        if (acc && typeof acc === 'object') {
            return (acc as Record<string, unknown>)[segment];
        }
        return undefined;
    }, root);
}

export function buildAssignmentStatement(
    outputVars: string[] | null | undefined,
    expression: string | null | undefined
): string {
    const trimmedExpression = (expression || '').trim();
    if (!trimmedExpression) {
        return '';
    }

    if (!outputVars || outputVars.length === 0) {
        return trimmedExpression;
    }

    const lhs = outputVars.length > 1 ? outputVars.join(', ') : outputVars[0];
    return `${lhs} = ${trimmedExpression}`;
}

export function cloneNodeForGenerator(node: ClonableNode | null | undefined): JsonRecord | null {
    if (!node) {
        return null;
    }

    const inputDefaults: Record<string, unknown> =
        node.inputDefaults && typeof node.inputDefaults === 'object'
            ? (node.inputDefaults as Record<string, unknown>)
            : {};
    const controlValues: Record<string, unknown> =
        node.controlValues && typeof node.controlValues === 'object'
            ? (node.controlValues as Record<string, unknown>)
            : {};

    return {
        id: node.id,
        type: node.type,
        title: node.title,
        inputs: deepCloneJson(node.inputs || []),
        outputs: deepCloneJson(node.outputs || []),
        controls: deepCloneJson(node.controls || []),
        controlValues: deepCloneJson({ ...inputDefaults, ...controlValues }),
        inputDefaults: deepCloneJson(inputDefaults),
    };
}

export function sanitizeGraphFunctionName(name: string, fallback: string, usedNames: Set<string>): string {
    const base = (name || '').toString().trim();
    const normalized = base
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+/, '')
        .replace(/_+$/, '');

    let candidate = normalized || fallback || 'graph';
    if (!/^[a-zA-Z_]/.test(candidate)) {
        candidate = `g_${candidate}`;
    }

    let unique = candidate;
    let counter = 2;
    while (usedNames.has(unique)) {
        unique = `${candidate}_${counter++}`;
    }
    usedNames.add(unique);

    return unique;
}
