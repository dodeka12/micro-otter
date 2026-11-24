// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Web View node validation. Both structural checks are graph rules — a singleton node
// and a forbidden combination — so this module exports only the graph-rule registrar.
// The manifest still names this file via `capabilityChecks`, which is just a module path
// (`data/node-package.ts` calls whichever registrar exports exist on the module).

function normalizeNodeId(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function resolveTypeId(nodeTypeLike) {
    if (!nodeTypeLike || typeof nodeTypeLike !== 'object') {
        return null;
    }

    if (typeof nodeTypeLike.type === 'string' && nodeTypeLike.type.trim()) {
        return nodeTypeLike.type.trim();
    }

    if (typeof nodeTypeLike.typeId === 'string' && nodeTypeLike.typeId.trim()) {
        return nodeTypeLike.typeId.trim();
    }

    return null;
}

function normalizeBindingSegment(value, fallbackValue = 'unknown') {
    const rawValue = value === undefined || value === null ? '' : String(value).trim();
    if (!rawValue) {
        return fallbackValue;
    }

    const normalized = rawValue
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+/, '')
        .replace(/_+$/, '');

    return normalized || fallbackValue;
}

function createPageId(nodeTypeId, nodeId) {
    const typeCode = nodeTypeId === 'webview.web-root' ? 'root' : 'page';
    return `wv_page_${typeCode}_${normalizeBindingSegment(nodeId, 'unknown')}`;
}

function getNodeTypeId(node, context) {
    if (typeof node?.type === 'string' && node.type.trim()) {
        return node.type.trim();
    }

    const nodeId = normalizeNodeId(node?.id);
    const nodeTypesByNodeId = context?.nodeTypesByNodeId;
    if (!nodeId || !nodeTypesByNodeId || typeof nodeTypesByNodeId !== 'object') {
        return null;
    }

    return resolveTypeId(nodeTypesByNodeId[nodeId]);
}

function pageNodesOf(context) {
    return (Array.isArray(context?.nodes) ? context.nodes : [])
        .map((node) => {
            const nodeId = normalizeNodeId(node?.id);
            const nodeTypeId = getNodeTypeId(node, context);
            if (!nodeId || !nodeTypeId) {
                return null;
            }

            if (nodeTypeId !== 'webview.web-root' && nodeTypeId !== 'webview.web-page') {
                return null;
            }

            const controlValues =
                node?.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};

            return {
                nodeId,
                nodeTypeId,
                controlValues,
                pageId: createPageId(nodeTypeId, nodeId),
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

const MISSING_ROOT_MESSAGE =
    'Missing root ownership: multi-page contracts require a Web Root node.';
const DUPLICATE_ROOT_MESSAGE = 'Only one Web Root node is allowed per graph.';

function buildContractIssue(nodeId, message, detail = {}) {
    return {
        nodeId,
        scope: 'node',
        message,
        capability: null,
        controlId: null,
        inputId: null,
        source: 'graphRule',
        ...detail,
    };
}

function reportDuplicateRoots(pageNodes) {
    const rootNodes = pageNodes.filter((entry) => entry.nodeTypeId === 'webview.web-root');
    if (rootNodes.length <= 1) {
        return [];
    }
    return rootNodes.map((entry) => buildContractIssue(entry.nodeId, DUPLICATE_ROOT_MESSAGE));
}

function reportPageContract(pageNodes) {
    const issues = [];
    const anchorNodeId = pageNodes[0].nodeId;

    const pageIdsToNodeIds = new Map();
    pageNodes.forEach((entry) => {
        if (!pageIdsToNodeIds.has(entry.pageId)) {
            pageIdsToNodeIds.set(entry.pageId, []);
        }
        pageIdsToNodeIds.get(entry.pageId).push(entry.nodeId);
    });

    Array.from(pageIdsToNodeIds.entries())
        .map(([pageId, nodeIds]) => ({
            pageId,
            nodeIds: nodeIds.slice().sort((a, b) => a.localeCompare(b)),
        }))
        .filter((entry) => entry.nodeIds.length > 1)
        .sort((a, b) => a.pageId.localeCompare(b.pageId))
        .forEach((entry) => {
            issues.push(
                buildContractIssue(
                    anchorNodeId,
                    `Duplicate page id "${entry.pageId}" detected: ${entry.nodeIds.join(', ')}`,
                    {
                        pageId: entry.pageId,
                    }
                )
            );
        });

    pageNodes.forEach((entry) => {
        const pageName = entry.controlValues.pageName;
        if (
            entry.nodeTypeId === 'webview.web-page' &&
            Object.prototype.hasOwnProperty.call(entry.controlValues, 'pageName') &&
            typeof pageName !== 'string'
        ) {
            issues.push(
                buildContractIssue(
                    anchorNodeId,
                    `Invalid page navigation metadata on node ${entry.nodeId}: pageName must be a string.`,
                    {
                        contractIssue: 'invalid-page-navigation-metadata',
                    }
                )
            );
        }

        const rootTitle = entry.controlValues.title;
        if (
            entry.nodeTypeId === 'webview.web-root' &&
            Object.prototype.hasOwnProperty.call(entry.controlValues, 'title') &&
            typeof rootTitle !== 'string'
        ) {
            issues.push(
                buildContractIssue(
                    anchorNodeId,
                    `Invalid page navigation metadata on node ${entry.nodeId}: title must be a string.`,
                    {
                        contractIssue: 'invalid-page-navigation-metadata',
                    }
                )
            );
        }
    });

    return issues;
}

function hasRoot(pageNodes, context) {
    if (pageNodes.some((entry) => entry.nodeTypeId === 'webview.web-root')) {
        return true;
    }
    const collectionNodes =
        Array.isArray(context?.collectionNodes) && context.collectionNodes.length > 0
            ? context.collectionNodes
            : [];
    return collectionNodes.some((node) => getNodeTypeId(node, context) === 'webview.web-root');
}

function validateWebViewShape(context) {
    const pageNodes = pageNodesOf(context);
    if (pageNodes.length === 0) {
        return [];
    }
    return [...reportDuplicateRoots(pageNodes), ...reportPageContract(pageNodes)];
}

function validateRootOwnership(context) {
    const pageNodes = pageNodesOf(context);
    if (pageNodes.length === 0 || hasRoot(pageNodes, context)) {
        return [];
    }
    return [
        buildContractIssue(pageNodes[0].nodeId, MISSING_ROOT_MESSAGE, {
            contractIssue: 'missing-root-ownership',
        }),
    ];
}

function webviewPageContractRule() {
    return { id: 'webview-page-contract', scope: 'graph', run: validateWebViewShape };
}

function webviewRootOwnershipRule() {
    return { id: 'webview-root-ownership', scope: 'collection', run: validateRootOwnership };
}

export async function registerGraphRules(register) {
    if (typeof register !== 'function') {
        return;
    }

    register(webviewPageContractRule());
    register(webviewRootOwnershipRule());
}

// Script-load path (tests, older core): node packages run as plain scripts and cannot
// import core modules, so register through the global bridge when present. The package
// hook (`registerGraphRules`) above is what `data/node-package.ts` calls in the app.
const globalScope =
    typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
const graphRules = globalScope.GraphRules;
if (graphRules && typeof graphRules.register === 'function') {
    graphRules.register(webviewPageContractRule());
    graphRules.register(webviewRootOwnershipRule());
}

