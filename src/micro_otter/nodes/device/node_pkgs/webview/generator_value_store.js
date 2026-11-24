// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
// Webview value-store node generators: read/write/save/load the reserved `_webcontrol` namespace.

(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }

    // Reserved store namespace owned by the webview input controls. Users never type it.
    const WEB_CONTROL_STORE_NAME = '_webcontrol';

    function registerImport(context, statement) {
        const helpers = (context && context.helpers) || {};
        if (helpers && typeof helpers.registerImport === 'function') {
            helpers.registerImport(statement);
        }
    }

    function formatLiteral(value, context) {
        const helpers = (context && context.helpers) || {};
        if (helpers && typeof helpers.formatLiteral === 'function') {
            return helpers.formatLiteral(value);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : '0';
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (value === null || value === undefined) {
            return 'None';
        }
        return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }

    function controlValues(context) {
        return (context && context.node && context.node.controlValues) || {};
    }

    function nameLiteral(context) {
        return formatLiteral(controlValues(context).name || '', context);
    }

    function storeLiteral(context) {
        return formatLiteral(WEB_CONTROL_STORE_NAME, context);
    }

    function inputRef(context, index, fallback) {
        const inputs = Array.isArray(context && context.inputs) ? context.inputs : [];
        const value = inputs[index];
        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    }

    function outputRef(context, index) {
        const outputs = Array.isArray(context && context.outputs) ? context.outputs : [];
        return outputs[index] ?? null;
    }

    function ensureImport(context) {
        registerImport(context, 'import otter_vars.store as _store');
    }

    globalScope.NodeCodeGenerators.webStoreRead = function (context) {
        ensureImport(context);
        const out = outputRef(context, 0);
        if (!out) {
            return { statement: '# web-store-read output not connected', outputs: [] };
        }
        const fallback = inputRef(context, 0, '0');
        return {
            statement: `${out} = _store.get(${storeLiteral(context)}, ${nameLiteral(context)}, ${fallback})`,
            outputs: [out],
        };
    };

    globalScope.NodeCodeGenerators.webStoreWrite = function (context) {
        ensureImport(context);
        const value = inputRef(context, 1, 'None');
        const enabled = inputRef(context, 0, 'True');
        return {
            statement: `if bool(${enabled}):\n    _store.set(${storeLiteral(context)}, ${nameLiteral(context)}, ${value})`,
            outputs: [],
        };
    };

    /**
     * Build the graph-scoped node id used as edge-trigger key.
     *
     * @param {string|number|undefined} graphId - Id of the containing graph
     * @param {string|number|undefined} nodeId - Id of the node
     * @returns {string} `<graphId>:<nodeId>`, or `<nodeId>` for id-less graphs
     */
    function buildScopedNodeId(graphId, nodeId) {
        const normalizedNodeId =
            nodeId === undefined || nodeId === null ? '' : String(nodeId).trim();
        if (!normalizedNodeId) {
            return 'unknown';
        }
        const normalizedGraphId =
            graphId === undefined || graphId === null ? '' : String(graphId).trim();
        return normalizedGraphId ? `${normalizedGraphId}:${normalizedNodeId}` : normalizedNodeId;
    }

    function edgeTriggerStatement(context, kind, triggerIndex = 0) {
        ensureImport(context);
        const triggerExpr = inputRef(context, triggerIndex, 'False');
        const nodeId = (context && context.node && context.node.id) || 'unknown';
        const graphId = context && context.graph && context.graph.id;
        const keyLiteral = formatLiteral(
            `${kind}:${buildScopedNodeId(graphId, nodeId)}`,
            context
        );
        const call = kind === 'save' ? 'save' : 'load';
        return {
            statement: [
                `if _store.edge_trigger(${keyLiteral}, ${triggerExpr}):`,
                `    _store.${call}(${storeLiteral(context)})`,
            ].join('\n'),
            outputs: [],
        };
    }

    globalScope.NodeCodeGenerators.webStoreSave = function (context) {
        const enabled = inputRef(context, 0, 'True');
        // While disabled the trigger is not observed, so a held trigger may fire once
        // on the first enabled tick; no hidden state preserves trigger history.
        const indented = edgeTriggerStatement(context, 'save', 1)
            .statement.split('\n')
            .map((line) => '    ' + line)
            .join('\n');
        return { statement: `if bool(${enabled}):\n${indented}`, outputs: [] };
    };

    globalScope.NodeCodeGenerators.webStoreLoad = function (context) {
        return edgeTriggerStatement(context, 'load');
    };
})();
