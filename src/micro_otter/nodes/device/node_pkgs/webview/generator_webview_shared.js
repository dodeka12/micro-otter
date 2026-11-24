// Webview node generators (helper-first runtime contract)
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    if (!globalScope.NodeCodeGenerators) {
        globalScope.NodeCodeGenerators = {};
    }
    if (!globalScope.NodeInitGenerators) {
        globalScope.NodeInitGenerators = {};
    }
    if (!globalScope.NodeHelperGenerators) {
        globalScope.NodeHelperGenerators = {};
    }
    if (!globalScope.NodeHelperHandoffConsumers) {
        globalScope.NodeHelperHandoffConsumers = {};
    }

    const HOOK_CONTRACT_VERSION = 'webserver-hooks/v1';
    const HOOK_MODULE = 'app.webserver_hooks_generated';
    const POST_REFRESH_ROUTE = '/api/webview/refresh';
    const WEBVIEW_CLIENT_ROUTE = '/webview/webview_client.js';
    const DEFAULT_REFRESH_INTERVAL_MS = 1000;
    const MIN_REFRESH_INTERVAL_MS = 100;
    const MAX_REFRESH_INTERVAL_MS = 60000;
    const WEBVIEW_PUBLISH_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.publish_webview_values';
    const WEBVIEW_STRICT_RUNTIME_IMPORTS = Object.freeze(['import math']);
    const WEBVIEW_LAYOUT_SCHEMA_VERSION = 'webview-layout-model/v1';
    const OTTER_BG_LOGO_ASSET_PATH = '/micro-otter-128px-white.svg';
    const OTTER_BG_LOGO_FALLBACK_PATH = 'html/micro-otter-128px-white.svg';
    const OTTER_FAVICON_ROUTE = '/favicon.ico';
    const OTTER_FAVICON_FALLBACK_PATH = 'html/micro-otter-head-64px.svg';
    const OTTER_BG_LOGO_LAYER_CSS =
        'position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0;';
    const OTTER_BG_LOGO_IMAGE_CSS =
        'width: min(56vmin, 420px); height: auto; opacity: 0.13; filter: grayscale(1) brightness(0.42) contrast(1.05);';
    const OTTER_BG_LOGO_MARKUP_LINES = [
        '    <div id="otter-bg-logo" aria-hidden="true">',
        `      <img src="${OTTER_BG_LOGO_ASSET_PATH}" alt="" />`,
        '    </div>',
    ];
    const WEBVIEW_SUPPORTED_NODE_KINDS = new Set([
        'web-root',
        'web-page',
        'row',
        'column',
        'content',
        'value-table',
        'radar-display',
        'joystick-display',
        'graph-display',
        'title-content',
        'web-view-tile',
        'web-view-number-input',
        'web-view-string-input',
        'web-view-slider',
        'web-view-checkbox',
        'web-view-select',
        'web-view-button',
    ]);
    const WEBVIEW_DYNAMIC_NODE_KINDS = new Set([
        'content',
        'value-table',
        'radar-display',
        'joystick-display',
        'graph-display',
        'title-content',
        'web-view-tile',
        'web-view-number-input',
        'web-view-string-input',
        'web-view-slider',
        'web-view-checkbox',
        'web-view-select',
        'web-view-button',
    ]);

    class WebviewNodeBase {
        normalizeControls(controls) {
            const source = controls && typeof controls === 'object' ? controls : {};
            return { ...source };
        }

        renderRuntimePayload() {
            throw new Error(
                `${this.constructor.name}.renderRuntimePayload() must be implemented for dynamic webview nodes`
            );
        }

        renderMarkup() {
            return null;
        }

        renderClientUpdateHandler() {
            return null;
        }

        renderClientHelpers() {
            return null;
        }

        renderClientInitHooks() {
            return null;
        }

        renderClientStyleRules() {
            return null;
        }

        renderClientPollHelpers() {
            return null;
        }

        renderClientPollRequestHook() {
            return null;
        }

        renderClientPollSuccessHook() {
            return null;
        }

        renderClientPollErrorHook() {
            return null;
        }

        getRefreshHookImports() {
            return null;
        }

        getRefreshRequestValueNormalizers() {
            return null;
        }

        getRefreshTransientKeyPrefixes() {
            return null;
        }

        getWebserverCapabilities() {
            return null;
        }

        getStructuralStrategy() {
            return null;
        }
    }

    globalScope.WebviewNodeBase = WebviewNodeBase;

    const WEBVIEW_NODE_IMPLEMENTATION_REGISTRY = Object.create(null);
    const WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY = Object.create(null);
    const WEBVIEW_STRUCTURAL_NODE_STRATEGY_REGISTRY = Object.create(null);
    const WEBVIEW_KIND_TYPE_CODES = {
        'web-root': 'root',
        'web-page': 'page',
        row: 'row',
        column: 'col',
        content: 'content',
        'value-table': 'vtable',
        'radar-display': 'radar',
        'joystick-display': 'joystick',
        'graph-display': 'graph',
        'title-content': 'title',
        'web-view-tile': 'tile',
        'web-view-number-input': 'numinput',
        'web-view-string-input': 'strinput',
        'web-view-slider': 'slider',
        'web-view-checkbox': 'checkbox',
        'web-view-select': 'select',
        'web-view-button': 'button',
    };

    function normalizeContributorNodeKind(nodeKind) {
        const normalized = typeof nodeKind === 'string' ? nodeKind.trim() : '';
        if (!normalized) {
            throw new Error('Webview node contributor nodeKind must be a non-empty string');
        }
        return normalized;
    }

    function normalizeNodeContributor(contributor, nodeKind) {
        if (!contributor || typeof contributor !== 'object') {
            throw new Error(
                `Webview node contributor for "${nodeKind}" must be an object contract payload`
            );
        }

        const entry = {
            renderMarkup:
                typeof contributor.renderMarkup === 'function' ? contributor.renderMarkup : null,
            renderRuntimePayload:
                typeof contributor.renderRuntimePayload === 'function'
                    ? contributor.renderRuntimePayload
                    : null,
            normalizeControls:
                typeof contributor.normalizeControls === 'function'
                    ? contributor.normalizeControls
                    : null,
            getWebserverCapabilities:
                typeof contributor.getWebserverCapabilities === 'function'
                    ? contributor.getWebserverCapabilities
                    : null,
            renderClientUpdateHandler:
                typeof contributor.renderClientUpdateHandler === 'function'
                    ? contributor.renderClientUpdateHandler
                    : null,
            renderClientHelpers:
                typeof contributor.renderClientHelpers === 'function'
                    ? contributor.renderClientHelpers
                    : null,
            renderClientInitHooks:
                typeof contributor.renderClientInitHooks === 'function'
                    ? contributor.renderClientInitHooks
                    : null,
            renderClientStyleRules:
                typeof contributor.renderClientStyleRules === 'function'
                    ? contributor.renderClientStyleRules
                    : null,
            renderClientPollHelpers:
                typeof contributor.renderClientPollHelpers === 'function'
                    ? contributor.renderClientPollHelpers
                    : null,
            renderClientPollRequestHook:
                typeof contributor.renderClientPollRequestHook === 'function'
                    ? contributor.renderClientPollRequestHook
                    : null,
            renderClientPollSuccessHook:
                typeof contributor.renderClientPollSuccessHook === 'function'
                    ? contributor.renderClientPollSuccessHook
                    : null,
            renderClientPollErrorHook:
                typeof contributor.renderClientPollErrorHook === 'function'
                    ? contributor.renderClientPollErrorHook
                    : null,
            getRefreshHookImports:
                typeof contributor.getRefreshHookImports === 'function'
                    ? contributor.getRefreshHookImports
                    : null,
            getRefreshRequestValueNormalizers:
                typeof contributor.getRefreshRequestValueNormalizers === 'function'
                    ? contributor.getRefreshRequestValueNormalizers
                    : null,
            getRefreshTransientKeyPrefixes:
                typeof contributor.getRefreshTransientKeyPrefixes === 'function'
                    ? contributor.getRefreshTransientKeyPrefixes
                    : null,
        };

        const hasKnownSurface =
            entry.renderMarkup ||
            entry.renderRuntimePayload ||
            entry.normalizeControls ||
            entry.getWebserverCapabilities ||
            entry.renderClientUpdateHandler ||
            entry.renderClientHelpers ||
            entry.renderClientInitHooks ||
            entry.renderClientStyleRules ||
            entry.renderClientPollHelpers ||
            entry.renderClientPollRequestHook ||
            entry.renderClientPollSuccessHook ||
            entry.renderClientPollErrorHook ||
            entry.getRefreshHookImports ||
            entry.getRefreshRequestValueNormalizers ||
            entry.getRefreshTransientKeyPrefixes;
        if (!hasKnownSurface) {
            throw new Error(
                `Webview node contributor for "${nodeKind}" must expose at least one contract surface`
            );
        }

        return Object.freeze(entry);
    }

    class WebviewLegacyContributorAdapter extends WebviewNodeBase {
        constructor(nodeKind, contributor) {
            super();
            this.nodeKind = nodeKind;
            this.contributor = normalizeNodeContributor(contributor, nodeKind);
        }

        normalizeControls(controls, context = {}) {
            if (typeof this.contributor.normalizeControls === 'function') {
                return this.contributor.normalizeControls(controls, context);
            }
            return super.normalizeControls(controls, context);
        }

        renderRuntimePayload(context = {}) {
            if (typeof this.contributor.renderRuntimePayload === 'function') {
                return this.contributor.renderRuntimePayload(context);
            }
            return super.renderRuntimePayload(context);
        }

        renderMarkup(context = {}) {
            if (typeof this.contributor.renderMarkup === 'function') {
                return this.contributor.renderMarkup(context);
            }
            return super.renderMarkup(context);
        }

        renderClientUpdateHandler(context = {}) {
            if (typeof this.contributor.renderClientUpdateHandler === 'function') {
                return this.contributor.renderClientUpdateHandler(context);
            }
            return super.renderClientUpdateHandler(context);
        }

        renderClientHelpers(context = {}) {
            if (typeof this.contributor.renderClientHelpers === 'function') {
                return this.contributor.renderClientHelpers(context);
            }
            return super.renderClientHelpers(context);
        }

        renderClientInitHooks(context = {}) {
            if (typeof this.contributor.renderClientInitHooks === 'function') {
                return this.contributor.renderClientInitHooks(context);
            }
            return super.renderClientInitHooks(context);
        }

        renderClientStyleRules(context = {}) {
            if (typeof this.contributor.renderClientStyleRules === 'function') {
                return this.contributor.renderClientStyleRules(context);
            }
            return super.renderClientStyleRules(context);
        }

        renderClientPollHelpers(context = {}) {
            if (typeof this.contributor.renderClientPollHelpers === 'function') {
                return this.contributor.renderClientPollHelpers(context);
            }
            return super.renderClientPollHelpers(context);
        }

        renderClientPollRequestHook(context = {}) {
            if (typeof this.contributor.renderClientPollRequestHook === 'function') {
                return this.contributor.renderClientPollRequestHook(context);
            }
            return super.renderClientPollRequestHook(context);
        }

        renderClientPollSuccessHook(context = {}) {
            if (typeof this.contributor.renderClientPollSuccessHook === 'function') {
                return this.contributor.renderClientPollSuccessHook(context);
            }
            return super.renderClientPollSuccessHook(context);
        }

        renderClientPollErrorHook(context = {}) {
            if (typeof this.contributor.renderClientPollErrorHook === 'function') {
                return this.contributor.renderClientPollErrorHook(context);
            }
            return super.renderClientPollErrorHook(context);
        }

        getRefreshHookImports(context = {}) {
            if (typeof this.contributor.getRefreshHookImports === 'function') {
                return this.contributor.getRefreshHookImports(context);
            }
            return super.getRefreshHookImports(context);
        }

        getRefreshRequestValueNormalizers(context = {}) {
            if (typeof this.contributor.getRefreshRequestValueNormalizers === 'function') {
                return this.contributor.getRefreshRequestValueNormalizers(context);
            }
            return super.getRefreshRequestValueNormalizers(context);
        }

        getRefreshTransientKeyPrefixes(context = {}) {
            if (typeof this.contributor.getRefreshTransientKeyPrefixes === 'function') {
                return this.contributor.getRefreshTransientKeyPrefixes(context);
            }
            return super.getRefreshTransientKeyPrefixes(context);
        }

        getWebserverCapabilities(context = {}) {
            if (typeof this.contributor.getWebserverCapabilities === 'function') {
                return this.contributor.getWebserverCapabilities(context);
            }
            return super.getWebserverCapabilities(context);
        }
    }

    function normalizeNodeImplementation(implementation, nodeKind) {
        if (!(implementation instanceof WebviewNodeBase)) {
            throw new Error(
                `Webview node implementation for "${nodeKind}" must be an instance of WebviewNodeBase`
            );
        }
        return implementation;
    }

    function createContributorViewFromImplementation(implementation) {
        return Object.freeze({
            renderMarkup:
                typeof implementation.renderMarkup === 'function'
                    ? implementation.renderMarkup.bind(implementation)
                    : null,
            renderRuntimePayload:
                typeof implementation.renderRuntimePayload === 'function'
                    ? implementation.renderRuntimePayload.bind(implementation)
                    : null,
            normalizeControls:
                typeof implementation.normalizeControls === 'function'
                    ? implementation.normalizeControls.bind(implementation)
                    : null,
            getWebserverCapabilities:
                typeof implementation.getWebserverCapabilities === 'function'
                    ? implementation.getWebserverCapabilities.bind(implementation)
                    : null,
            renderClientUpdateHandler:
                typeof implementation.renderClientUpdateHandler === 'function'
                    ? implementation.renderClientUpdateHandler.bind(implementation)
                    : null,
            renderClientHelpers:
                typeof implementation.renderClientHelpers === 'function'
                    ? implementation.renderClientHelpers.bind(implementation)
                    : null,
            renderClientInitHooks:
                typeof implementation.renderClientInitHooks === 'function'
                    ? implementation.renderClientInitHooks.bind(implementation)
                    : null,
            renderClientStyleRules:
                typeof implementation.renderClientStyleRules === 'function'
                    ? implementation.renderClientStyleRules.bind(implementation)
                    : null,
            renderClientPollHelpers:
                typeof implementation.renderClientPollHelpers === 'function'
                    ? implementation.renderClientPollHelpers.bind(implementation)
                    : null,
            renderClientPollRequestHook:
                typeof implementation.renderClientPollRequestHook === 'function'
                    ? implementation.renderClientPollRequestHook.bind(implementation)
                    : null,
            renderClientPollSuccessHook:
                typeof implementation.renderClientPollSuccessHook === 'function'
                    ? implementation.renderClientPollSuccessHook.bind(implementation)
                    : null,
            renderClientPollErrorHook:
                typeof implementation.renderClientPollErrorHook === 'function'
                    ? implementation.renderClientPollErrorHook.bind(implementation)
                    : null,
            getRefreshHookImports:
                typeof implementation.getRefreshHookImports === 'function'
                    ? implementation.getRefreshHookImports.bind(implementation)
                    : null,
            getRefreshRequestValueNormalizers:
                typeof implementation.getRefreshRequestValueNormalizers === 'function'
                    ? implementation.getRefreshRequestValueNormalizers.bind(implementation)
                    : null,
            getRefreshTransientKeyPrefixes:
                typeof implementation.getRefreshTransientKeyPrefixes === 'function'
                    ? implementation.getRefreshTransientKeyPrefixes.bind(implementation)
                    : null,
        });
    }

    function registerNodeKindImplementation(nodeKind, implementation) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        if (WEBVIEW_NODE_IMPLEMENTATION_REGISTRY[normalizedNodeKind]) {
            throw new Error(
                `Duplicate webview node implementation registration for "${normalizedNodeKind}"`
            );
        }

        const normalizedImplementation = normalizeNodeImplementation(
            implementation,
            normalizedNodeKind
        );
        WEBVIEW_NODE_IMPLEMENTATION_REGISTRY[normalizedNodeKind] = normalizedImplementation;
        WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY[normalizedNodeKind] =
            createContributorViewFromImplementation(normalizedImplementation);

        const structuralStrategy =
            typeof normalizedImplementation.getStructuralStrategy === 'function'
                ? normalizedImplementation.getStructuralStrategy()
                : null;
        if (structuralStrategy && typeof structuralStrategy === 'object') {
            registerStructuralNodeKindStrategy(normalizedNodeKind, structuralStrategy);
        }

        return normalizedImplementation;
    }

    function getNodeKindImplementation(nodeKind, options = {}) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        const implementation = WEBVIEW_NODE_IMPLEMENTATION_REGISTRY[normalizedNodeKind] || null;
        if (implementation || !options || options.required !== true) {
            return implementation;
        }

        throw new Error(
            `Missing webview node implementation registration for "${normalizedNodeKind}"`
        );
    }

    function listNodeKindImplementations() {
        return Object.keys(WEBVIEW_NODE_IMPLEMENTATION_REGISTRY)
            .sort((left, right) => left.localeCompare(right))
            .map((nodeKind) => ({
                nodeKind,
                implementation: WEBVIEW_NODE_IMPLEMENTATION_REGISTRY[nodeKind],
            }));
    }

    function unregisterNodeKindImplementation(nodeKind) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        if (!WEBVIEW_NODE_IMPLEMENTATION_REGISTRY[normalizedNodeKind]) {
            return false;
        }

        delete WEBVIEW_NODE_IMPLEMENTATION_REGISTRY[normalizedNodeKind];
        delete WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY[normalizedNodeKind];
        return true;
    }

    function normalizeStructuralNodeStrategy(strategy, nodeKind) {
        if (!strategy || typeof strategy !== 'object') {
            throw new Error(
                `Webview structural strategy for "${nodeKind}" must be an object payload`
            );
        }

        const containerClass =
            typeof strategy.containerClass === 'string' ? strategy.containerClass.trim() : '';
        if (!containerClass) {
            throw new Error(
                `Webview structural strategy for "${nodeKind}" must provide containerClass`
            );
        }

        const entry = {
            containerClass,
            isPageScopeKind: strategy.isPageScopeKind === true,
            normalizeControls:
                typeof strategy.normalizeControls === 'function'
                    ? strategy.normalizeControls
                    : null,
        };

        return Object.freeze(entry);
    }

    function registerNodeKindContributor(nodeKind, contributor) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        if (WEBVIEW_NODE_IMPLEMENTATION_REGISTRY[normalizedNodeKind]) {
            throw new Error(
                `Duplicate webview node contributor registration for "${normalizedNodeKind}"`
            );
        }

        const implementation = new WebviewLegacyContributorAdapter(normalizedNodeKind, contributor);
        registerNodeKindImplementation(normalizedNodeKind, implementation);

        return WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY[normalizedNodeKind];
    }

    function registerStructuralNodeKindStrategy(nodeKind, strategy) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        if (WEBVIEW_STRUCTURAL_NODE_STRATEGY_REGISTRY[normalizedNodeKind]) {
            throw new Error(
                `Duplicate webview structural strategy registration for "${normalizedNodeKind}"`
            );
        }

        WEBVIEW_STRUCTURAL_NODE_STRATEGY_REGISTRY[normalizedNodeKind] =
            normalizeStructuralNodeStrategy(strategy, normalizedNodeKind);
        return WEBVIEW_STRUCTURAL_NODE_STRATEGY_REGISTRY[normalizedNodeKind];
    }

    function getStructuralNodeKindStrategy(nodeKind, options = {}) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        const strategy = WEBVIEW_STRUCTURAL_NODE_STRATEGY_REGISTRY[normalizedNodeKind] || null;
        if (strategy || !options || options.required !== true) {
            return strategy;
        }

        throw new Error(
            `Missing webview structural strategy registration for "${normalizedNodeKind}"`
        );
    }

    function listStructuralNodeKindStrategies() {
        return Object.keys(WEBVIEW_STRUCTURAL_NODE_STRATEGY_REGISTRY)
            .sort((left, right) => left.localeCompare(right))
            .map((nodeKind) => ({
                nodeKind,
                strategy: WEBVIEW_STRUCTURAL_NODE_STRATEGY_REGISTRY[nodeKind],
            }));
    }

    function getNodeKindContributor(nodeKind, options = {}) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        const contributor = WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY[normalizedNodeKind] || null;
        if (contributor || !options || options.required !== true) {
            return contributor;
        }

        throw new Error(
            `Missing webview node contributor registration for "${normalizedNodeKind}"`
        );
    }

    function listNodeKindContributors() {
        return Object.keys(WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY)
            .sort((left, right) => left.localeCompare(right))
            .map((nodeKind) => ({
                nodeKind,
                contributor: WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY[nodeKind],
            }));
    }

    function unregisterNodeKindContributor(nodeKind) {
        const normalizedNodeKind = normalizeContributorNodeKind(nodeKind);
        if (!WEBVIEW_NODE_CONTRIBUTOR_VIEW_REGISTRY[normalizedNodeKind]) {
            return false;
        }

        return unregisterNodeKindImplementation(normalizedNodeKind);
    }

    function normalizeContributorMarkupLines(lines) {
        if (!Array.isArray(lines)) {
            return null;
        }

        return lines
            .map((line) => (typeof line === 'string' ? line : String(line ?? '')))
            .filter((line) => line.length > 0);
    }

    function parseFunctionName(updateLines) {
        const firstLine =
            Array.isArray(updateLines) && updateLines.length > 0 ? updateLines[0] : '';
        const match = /^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(String(firstLine));
        return match ? match[1] : '';
    }

    function parseUpdateHandlerName(updateLines) {
        return parseFunctionName(updateLines);
    }

    function normalizeValueTableRowCount(value) {
        const numeric = toFiniteInt(value, 1);
        if (numeric < 1) {
            return 1;
        }
        if (numeric > 5) {
            return 5;
        }
        return numeric;
    }

    function normalizeValueTableDecimalPlaces(value) {
        const numeric = toFiniteInt(value, 2);
        if (numeric < 0) {
            return 0;
        }
        if (numeric > 6) {
            return 6;
        }
        return numeric;
    }

    function registerStrictRuntimeImports(helperContext) {
        const registerImport =
            helperContext && typeof helperContext.registerImport === 'function'
                ? helperContext.registerImport
                : null;
        if (!registerImport) {
            return;
        }
        for (const importStatement of WEBVIEW_STRICT_RUNTIME_IMPORTS) {
            registerImport(importStatement);
        }
    }

    function debugLog(message, detail) {
        if (typeof console === 'undefined' || typeof console.debug !== 'function') {
            return;
        }

        if (detail === undefined) {
            console.debug(`[webview-helper] ${message}`);
            return;
        }

        console.debug(`[webview-helper] ${message}`, detail);
    }

    function normalizeControlValue(controlValues, key, fallbackValue = null) {
        if (!controlValues || typeof controlValues !== 'object') {
            return fallbackValue;
        }
        if (!Object.prototype.hasOwnProperty.call(controlValues, key)) {
            return fallbackValue;
        }
        const value = controlValues[key];
        return value === undefined || value === null ? fallbackValue : value;
    }

    function toFiniteInt(value, fallbackValue) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallbackValue;
        }
        return Math.floor(numeric);
    }

    function normalizeRefreshIntervalMs(value) {
        const normalized = toFiniteInt(value, DEFAULT_REFRESH_INTERVAL_MS);
        if (!Number.isFinite(normalized)) {
            return DEFAULT_REFRESH_INTERVAL_MS;
        }
        if (normalized < MIN_REFRESH_INTERVAL_MS) {
            return MIN_REFRESH_INTERVAL_MS;
        }
        if (normalized > MAX_REFRESH_INTERVAL_MS) {
            return MAX_REFRESH_INTERVAL_MS;
        }
        return normalized;
    }

    function normalizeNodeSummary(nodeKind, node, graphId = null) {
        const nodeId = typeof node?.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
        const normalizedGraphId = normalizeGraphId(graphId);
        const scopedId = buildScopedNodeId(normalizedGraphId, nodeId);
        const controls =
            node?.controlValues && typeof node.controlValues === 'object' ? node.controlValues : {};

        const summary = {
            id: nodeId,
            graphId: normalizedGraphId,
            scopedId,
            kind: nodeKind,
            controls: {},
        };

        const structuralStrategy = getStructuralNodeKindStrategy(nodeKind);
        if (structuralStrategy && typeof structuralStrategy.normalizeControls === 'function') {
            const normalizedControls = structuralStrategy.normalizeControls(controls, {
                normalizeControlValue,
                normalizeRefreshIntervalMs,
                toFiniteInt,
                defaultRefreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
                minRefreshIntervalMs: MIN_REFRESH_INTERVAL_MS,
                maxRefreshIntervalMs: MAX_REFRESH_INTERVAL_MS,
            });
            if (normalizedControls && typeof normalizedControls === 'object') {
                summary.controls = { ...normalizedControls };
            }
        }

        const implementation = getNodeKindImplementation(nodeKind);
        if (implementation && typeof implementation.normalizeControls === 'function') {
            const normalizedControls = implementation.normalizeControls(controls, {
                nodeKind,
                node,
                graphId: normalizedGraphId,
                scopedNodeId: scopedId,
                helpers: {
                    normalizeControlValue,
                    normalizeRefreshIntervalMs,
                    normalizeValueTableRowCount,
                    normalizeValueTableDecimalPlaces,
                    toFiniteInt,
                    defaultRefreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
                    minRefreshIntervalMs: MIN_REFRESH_INTERVAL_MS,
                    maxRefreshIntervalMs: MAX_REFRESH_INTERVAL_MS,
                },
            });
            if (normalizedControls && typeof normalizedControls === 'object') {
                summary.controls = {
                    ...summary.controls,
                    ...normalizedControls,
                };
            }
        }

        return summary;
    }

    function normalizePathSegment(value, fallbackValue = 'default') {
        const candidate = typeof value === 'string' ? value.trim() : '';
        if (!candidate) {
            return fallbackValue;
        }

        const normalized = candidate
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');

        return normalized || fallbackValue;
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

    function normalizeGraphId(value) {
        const rawValue = value === undefined || value === null ? '' : String(value).trim();
        return rawValue || null;
    }

    function buildScopedNodeId(graphId, nodeId) {
        const normalizedNodeId =
            nodeId === undefined || nodeId === null ? '' : String(nodeId).trim();
        if (!normalizedNodeId) {
            return 'unknown';
        }

        const normalizedGraphId = normalizeGraphId(graphId);
        return normalizedGraphId ? `${normalizedGraphId}:${normalizedNodeId}` : normalizedNodeId;
    }

    function buildWebNodeKey(scopedNodeId) {
        const normalizedScopedNodeId =
            scopedNodeId === undefined || scopedNodeId === null ? '' : String(scopedNodeId).trim();
        return `webNode:${normalizedScopedNodeId || 'unknown'}`;
    }

    function resolveContextGraphId(context) {
        return normalizeGraphId(context?.graph?.id);
    }

    function buildBindingId(prefix, typeCode, nodeId, slotIndex = null) {
        const safeTypeCode = normalizeBindingSegment(typeCode, 'node');
        const safeNodeId = normalizeBindingSegment(nodeId, 'unknown');
        const hasSlotIndex = Number.isFinite(slotIndex) && Number(slotIndex) >= 0;
        const slotSuffix = hasSlotIndex ? `_s${Math.floor(Number(slotIndex))}` : '';
        return `${prefix}_${safeTypeCode}_${safeNodeId}${slotSuffix}`;
    }

    function parseOutputReference(inputReference) {
        if (typeof inputReference !== 'string') {
            return null;
        }

        const trimmedReference = inputReference.trim();
        if (!trimmedReference || trimmedReference === 'None') {
            return null;
        }

        const matches = /^node_(.+)_out([0-9]+)$/.exec(trimmedReference);
        if (!matches) {
            return null;
        }

        const nodeId = typeof matches[1] === 'string' ? matches[1].trim() : '';
        const outputIndex = Number.parseInt(matches[2], 10);
        if (!nodeId || !Number.isFinite(outputIndex)) {
            return null;
        }

        return {
            nodeId,
            outputIndex,
        };
    }

    function normalizeNodeTraceMetadata(context, nodeKind) {
        const node = context?.node && typeof context.node === 'object' ? context.node : {};
        const nodeId = typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
        const nodeType =
            typeof node.type === 'string' && node.type.trim() ? node.type.trim() : nodeKind;
        const nodeTitle =
            typeof node.title === 'string' && node.title.trim() ? node.title.trim() : nodeKind;

        return {
            node,
            nodeId,
            nodeType,
            nodeTitle,
        };
    }

    function buildNodeTraceComment(context, nodeKind, stage) {
        const metadata = normalizeNodeTraceMetadata(context, nodeKind);

        return [
            `# webview:${nodeKind}:${stage}`,
            `title=${JSON.stringify(metadata.nodeTitle)}`,
            `id=${JSON.stringify(metadata.nodeId)}`,
            `type=${JSON.stringify(metadata.nodeType)}`,
        ].join(' ');
    }

    function createRuntimeNoOpGenerator(nodeKind, stage) {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const nodeTraceComment = buildNodeTraceComment(context, nodeKind, stage);

            if (safeOutputs.length === 0) {
                return {
                    statement: [
                        nodeTraceComment,
                        `# webview:${nodeKind}:${stage} (no outputs)`,
                    ].join('\n'),
                };
            }

            return {
                statement: [
                    nodeTraceComment,
                    `# webview:${nodeKind}:${stage} (no-op; outputs preserved from init/runtime state)`,
                ].join('\n'),
            };
        };
    }

    function resolveConnectedOutputs(context, safeOutputs) {
        const outputsMeta = Array.isArray(context?.outputsMeta) ? context.outputsMeta : [];
        if (outputsMeta.length !== safeOutputs.length) {
            return safeOutputs.map((outputName, idx) => ({ outputName, outputIndex: idx }));
        }

        return safeOutputs
            .map((outputName, idx) => ({ outputName, outputIndex: idx }))
            .filter((entry) => Boolean(outputsMeta[entry.outputIndex]?.connected));
    }

    function createRuntimeElementTokenGenerator(nodeKind, stage) {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const connectedOutputs = resolveConnectedOutputs(context, safeOutputs);
            const metadata = normalizeNodeTraceMetadata(context, nodeKind);
            const nodeTraceComment = buildNodeTraceComment(context, nodeKind, stage);
            const helpers =
                context?.helpers && typeof context.helpers === 'object' ? context.helpers : {};
            registerStrictRuntimeImports(helpers);
            const formatLiteral =
                typeof helpers.formatLiteral === 'function'
                    ? helpers.formatLiteral
                    : (value) => JSON.stringify(value);

            if (connectedOutputs.length === 0) {
                return {
                    statement: [
                        nodeTraceComment,
                        `# webview:${nodeKind}:${stage} (no connected outputs)`,
                    ].join('\n'),
                };
            }

            return {
                statement: [
                    nodeTraceComment,
                    connectedOutputs
                        .map(
                            (entry) =>
                                `${entry.outputName} = ${formatLiteral(`webElement:${metadata.nodeId}:${entry.outputIndex}`)}`
                        )
                        .join('\n'),
                ].join('\n'),
            };
        };
    }

    function createRuntimePassthroughGenerator(nodeKind, stage) {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const connectedOutputs = resolveConnectedOutputs(context, safeOutputs);
            const nodeTraceComment = buildNodeTraceComment(context, nodeKind, stage);
            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';

            if (connectedOutputs.length === 0) {
                return {
                    statement: [
                        nodeTraceComment,
                        `# webview:${nodeKind}:${stage} (no connected outputs)`,
                    ].join('\n'),
                };
            }

            return {
                statement: [
                    nodeTraceComment,
                    connectedOutputs
                        .map((entry) => `${entry.outputName} = ${parentInput}`)
                        .join('\n'),
                ].join('\n'),
            };
        };
    }

    function createWebviewDynamicLoopGenerator(nodeKind) {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';
            const titleInput =
                typeof inputs[1] === 'string' && inputs[1].trim() ? inputs[1].trim() : 'None';
            const valueInput =
                typeof inputs[2] === 'string' && inputs[2].trim() ? inputs[2].trim() : 'None';
            const valueTableLabelInputs = [];
            const valueTableValueInputs = [];
            for (let rowIndex = 1; rowIndex <= 5; rowIndex += 1) {
                const labelInput =
                    typeof inputs[rowIndex * 2 - 1] === 'string' && inputs[rowIndex * 2 - 1].trim()
                        ? inputs[rowIndex * 2 - 1].trim()
                        : 'None';
                const cellValueInput =
                    typeof inputs[rowIndex * 2] === 'string' && inputs[rowIndex * 2].trim()
                        ? inputs[rowIndex * 2].trim()
                        : 'None';
                valueTableLabelInputs.push(labelInput);
                valueTableValueInputs.push(cellValueInput);
            }

            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = resolveContextGraphId(context);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);
            const controls =
                node.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};
            const parentLink = parseOutputReference(parentInput);
            const inputSources = Array.isArray(context?.inputSources) ? context.inputSources : [];
            const parentSource =
                inputSources[0] && typeof inputSources[0] === 'object' ? inputSources[0] : null;
            const parentSourceOutputIndex = Number.isFinite(parentSource?.fromIndex)
                ? Math.floor(Number(parentSource.fromIndex))
                : null;
            const binding = createLayoutBinding(
                nodeKind,
                scopedNodeId,
                parentLink ? parentLink.outputIndex : parentSourceOutputIndex
            );
            const publishKey =
                typeof binding?.payloadKey === 'string' && binding.payloadKey.trim()
                    ? binding.payloadKey.trim()
                    : buildWebNodeKey(scopedNodeId);

            const helpers =
                context?.helpers && typeof context.helpers === 'object' ? context.helpers : {};
            registerStrictRuntimeImports(helpers);
            const formatLiteral =
                typeof helpers.formatLiteral === 'function'
                    ? helpers.formatLiteral
                    : (value) => JSON.stringify(value);

            const outputStatement =
                safeOutputs.length > 0 && parentInput !== 'None'
                    ? safeOutputs.map((outputName) => `${outputName} = ${parentInput}`).join('\n')
                    : `# webview:${nodeKind}:loop (output passthrough unavailable)`;
            const nodeKeyLiteral = formatLiteral(publishKey);
            const implementation = getNodeKindImplementation(nodeKind, { required: true });
            if (!implementation || typeof implementation.renderRuntimePayload !== 'function') {
                throw new Error(
                    `Missing runtime payload implementation for webview node kind "${nodeKind}"`
                );
            }
            const payloadLiteral = implementation.renderRuntimePayload({
                nodeKind,
                node,
                controls,
                io: {
                    inputs,
                    parentInput,
                    titleInput,
                    valueInput,
                    valueTableLabelInputs,
                    valueTableValueInputs,
                },
                helpers: {
                    normalizeControlValue,
                    normalizeValueTableRowCount,
                    toFiniteInt,
                    formatLiteral,
                },
                // transitional compatibility fields for existing node implementations
                inputs,
                parentInput,
                titleInput,
                valueInput,
                valueTableLabelInputs,
                valueTableValueInputs,
                normalizeControlValue,
                normalizeValueTableRowCount,
                toFiniteInt,
                formatLiteral,
            });
            if (typeof payloadLiteral !== 'string' || payloadLiteral.trim() === '') {
                throw new Error(
                    `Runtime payload implementation for webview node kind "${nodeKind}" must return a non-empty string`
                );
            }

            return {
                statement: [
                    outputStatement,
                    `${WEBVIEW_PUBLISH_FUNCTION_NAME}({${nodeKeyLiteral}: ${payloadLiteral}})`,
                ].join('\n'),
            };
        };
    }

    function createWebviewDynamicInitGenerator(nodeKind) {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const connectedOutputs = resolveConnectedOutputs(context, safeOutputs);
            const nodeTraceComment = buildNodeTraceComment(context, nodeKind, 'init');
            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';
            const helperContext =
                context?.helpers && typeof context.helpers === 'object' ? context.helpers : {};
            const formatLiteral =
                typeof helperContext.formatLiteral === 'function'
                    ? helperContext.formatLiteral
                    : (value) => JSON.stringify(value);
            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = resolveContextGraphId(context);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);
            const parentLink = parseOutputReference(parentInput);
            const inputSources = Array.isArray(context?.inputSources) ? context.inputSources : [];
            const parentSource =
                inputSources[0] && typeof inputSources[0] === 'object' ? inputSources[0] : null;
            const parentSourceOutputIndex = Number.isFinite(parentSource?.fromIndex)
                ? Math.floor(Number(parentSource.fromIndex))
                : null;
            const binding = createLayoutBinding(
                nodeKind,
                scopedNodeId,
                parentLink ? parentLink.outputIndex : parentSourceOutputIndex
            );
            const publishKey =
                typeof binding?.payloadKey === 'string' && binding.payloadKey.trim()
                    ? binding.payloadKey.trim()
                    : buildWebNodeKey(scopedNodeId);

            const registerImport =
                typeof helperContext.registerImport === 'function'
                    ? helperContext.registerImport
                    : null;

            if (registerImport) {
                registerImport('import otter_runtime.web_interface as web_interface_module');
            }

            const outputStatement =
                connectedOutputs.length > 0
                    ? [
                          nodeTraceComment,
                          connectedOutputs
                              .map((entry) => `${entry.outputName} = ${parentInput}`)
                              .join('\n'),
                      ].join('\n')
                    : [nodeTraceComment, `# webview:${nodeKind}:init (no connected outputs)`].join(
                          '\n'
                      );

            return {
                statement: outputStatement,
            };
        };
    }

    function createHelperContributionGenerator(nodeKind, priority) {
        return function (context) {
            const node = context?.node || {};
            const graphId = resolveContextGraphId(context);
            const controls =
                node?.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};
            const nodeSummary = normalizeNodeSummary(nodeKind, node, graphId);
            const scopedNodeId = nodeSummary.scopedId;
            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];

            if (nodeKind !== 'web-root') {
                const parentLink = parseOutputReference(inputs[0]);
                if (parentLink) {
                    nodeSummary.layout = {
                        parentNodeId: parentLink.nodeId,
                        parentGraphId: graphId,
                        parentScopedNodeId: buildScopedNodeId(graphId, parentLink.nodeId),
                        parentOutputIndex: parentLink.outputIndex,
                        parentInputIndex: 0,
                    };
                }
            }

            const data = {
                [buildWebNodeKey(scopedNodeId)]: nodeSummary,
            };

            const webserverSpecPatch = {
                hookContractVersion: HOOK_CONTRACT_VERSION,
                hookTargetModule: HOOK_MODULE,
                postRefreshRoute: POST_REFRESH_ROUTE,
            };

            const implementation = getNodeKindImplementation(nodeKind);
            if (implementation && typeof implementation.getWebserverCapabilities === 'function') {
                const capabilities = implementation.getWebserverCapabilities({
                    nodeKind,
                    node,
                    controls,
                    graphId,
                    scopedNodeId,
                });
                if (capabilities && typeof capabilities === 'object') {
                    if (capabilities.needsWebDataStore === true) {
                        webserverSpecPatch.needsWebDataStore = true;
                    }
                    if (capabilities.requiresPostRefresh === true) {
                        webserverSpecPatch.requiresPostRefresh = true;
                    }
                }
            }

            return {
                schemaVersion: 'transpiler-helper-contribution/v1',
                helperGroup: 'web-runtime',
                priority,
                orderKey: `${priority}:${scopedNodeId}`,
                data,
                webserverSpecPatch,
            };
        };
    }

    function normalizeMergedNodes(mergedData) {
        if (!mergedData || typeof mergedData !== 'object') {
            return [];
        }

        return Object.keys(mergedData)
            .filter((key) => key.startsWith('webNode:'))
            .sort()
            .map((key) => mergedData[key])
            .filter((entry) => entry && typeof entry === 'object');
    }

    function buildLayoutElementKey(scopedNodeId) {
        return `node:${String(scopedNodeId ?? 'unknown').trim() || 'unknown'}`;
    }

    function buildLayoutDiagnostic(code, message, detail = {}) {
        return {
            code,
            message,
            ...detail,
        };
    }

    function compareLayoutNodeOrder(a, b) {
        const aOrder = Number.isFinite(a?.topologicalOrder)
            ? a.topologicalOrder
            : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(b?.topologicalOrder)
            ? b.topologicalOrder
            : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }

        const aConnectorIndex = Number.isFinite(a?.parentOutputIndex)
            ? a.parentOutputIndex
            : Number.MAX_SAFE_INTEGER;
        const bConnectorIndex = Number.isFinite(b?.parentOutputIndex)
            ? b.parentOutputIndex
            : Number.MAX_SAFE_INTEGER;
        if (aConnectorIndex !== bConnectorIndex) {
            return aConnectorIndex - bConnectorIndex;
        }

        return String(a?.nodeId ?? '').localeCompare(String(b?.nodeId ?? ''));
    }

    function resolveLayoutElementKind(nodeKind) {
        if (nodeKind === 'title-content') {
            return 'title';
        }
        if (
            nodeKind === 'content' ||
            nodeKind === 'value-table' ||
            nodeKind === 'radar-display' ||
            nodeKind === 'joystick-display' ||
            nodeKind === 'graph-display'
        ) {
            return 'content';
        }
        return 'container';
    }

    function createLayoutBinding(nodeKind, scopedNodeId, slotIndex) {
        if (!WEBVIEW_DYNAMIC_NODE_KINDS.has(nodeKind)) {
            return null;
        }

        const typeCode = WEBVIEW_KIND_TYPE_CODES[nodeKind] || 'node';
        const resolvedSlotIndex = Number.isFinite(slotIndex) ? slotIndex : null;

        return {
            elementId: buildBindingId('wv_el', typeCode, scopedNodeId, resolvedSlotIndex),
            payloadKey: buildBindingId('wv_bind', typeCode, scopedNodeId, resolvedSlotIndex),
        };
    }

    function createPageId(nodeKind, scopedNodeId) {
        if (nodeKind !== 'web-root' && nodeKind !== 'web-page') {
            return null;
        }

        const typeCode = nodeKind === 'web-root' ? 'root' : 'page';
        const safeNodeId = normalizeBindingSegment(scopedNodeId, 'unknown');
        return `wv_page_${typeCode}_${safeNodeId}`;
    }

    function buildPageRegionId(pageId, fallbackNodeId) {
        const safePageId = normalizeBindingSegment(pageId, 'page');
        const safeFallbackNodeId = normalizeBindingSegment(fallbackNodeId, 'unknown');
        return `wv_page_region_${safePageId || safeFallbackNodeId}`;
    }

    function buildNavigationButtonId(pageId, fallbackNodeId) {
        const safePageId = normalizeBindingSegment(pageId, 'page');
        const safeFallbackNodeId = normalizeBindingSegment(fallbackNodeId, 'unknown');
        return `wv_nav_btn_${safePageId || safeFallbackNodeId}`;
    }

    function resolveCompactNavigationGlyph(label, options = {}) {
        const normalizedLabel = typeof label === 'string' ? label.trim() : '';
        const isRootPage = options?.isRootPage === true;
        const iconCandidates = [
            { pattern: /^(home|main|root)\b/i, icon: '⌂' },
            { pattern: /overview/i, icon: '◈' },
            { pattern: /report/i, icon: '▤' },
            { pattern: /status/i, icon: '◉' },
            { pattern: /setting/i, icon: '⚙' },
        ];

        if (isRootPage) {
            const matchedIcon = iconCandidates.find((entry) => entry.pattern.test(normalizedLabel));
            return matchedIcon?.icon || '⌂';
        }

        const firstGlyph = Array.from(normalizedLabel)[0] || '';
        if (firstGlyph) {
            return firstGlyph.toLocaleUpperCase();
        }

        return '?';
    }

    function resolvePageMode(nodeEntries) {
        const hasExplicitWebPageNodes = (Array.isArray(nodeEntries) ? nodeEntries : []).some(
            (entry) => entry?.kind === 'web-page'
        );

        return hasExplicitWebPageNodes ? 'multi-page' : 'single-page-compat';
    }

    function resolveInitialActivePageId(layoutModel) {
        const rootPageId =
            typeof layoutModel?.pageIdentity?.rootPageId === 'string' &&
            layoutModel.pageIdentity.rootPageId.trim()
                ? layoutModel.pageIdentity.rootPageId.trim()
                : null;
        if (rootPageId) {
            return rootPageId;
        }

        const navigationPages = Array.isArray(layoutModel?.navigation?.pages)
            ? layoutModel.navigation.pages
            : [];
        const firstNavigationPage = navigationPages
            .map((entry) =>
                typeof entry?.pageId === 'string' && entry.pageId.trim()
                    ? entry.pageId.trim()
                    : null
            )
            .find(Boolean);

        return firstNavigationPage || null;
    }

    function buildPageIdentityContract(normalizedNodes, primaryRootNodeId) {
        const pageEntries = (Array.isArray(normalizedNodes) ? normalizedNodes : [])
            .filter((node) => node?.nodeKind === 'web-root' || node?.nodeKind === 'web-page')
            .slice()
            .sort((a, b) =>
                String(a?.scopedNodeId ?? '').localeCompare(String(b?.scopedNodeId ?? ''))
            )
            .map((node) => ({
                nodeId: node.scopedNodeId,
                nodeKind: node.nodeKind,
                pageId: createPageId(node.nodeKind, node.scopedNodeId),
            }))
            .filter((entry) => typeof entry.pageId === 'string' && entry.pageId.trim());

        const pageIdsByNodeId = {};
        pageEntries.forEach((entry) => {
            pageIdsByNodeId[entry.nodeId] = entry.pageId;
        });

        const rootNodeEntry = pageEntries.find((entry) => entry.nodeId === primaryRootNodeId);

        return {
            schemaVersion: 'webview-page-identity/v1',
            rootPageId: rootNodeEntry?.pageId || null,
            pageIdsByNodeId,
        };
    }

    function resolveNavigationLabelForElement(element) {
        const kind = getNodeKindFromElement(element);
        const controls =
            element?.controls && typeof element.controls === 'object' ? element.controls : {};

        if (kind === 'web-root') {
            const title = typeof controls.title === 'string' ? controls.title.trim() : '';
            if (title) {
                return title;
            }
        }

        if (kind === 'web-page') {
            const pageName = typeof controls.pageName === 'string' ? controls.pageName.trim() : '';
            if (pageName) {
                return pageName;
            }
        }

        return typeof element?.nodeId === 'string' && element.nodeId.trim()
            ? element.nodeId.trim()
            : 'unknown';
    }

    function buildNavigationModel(elements, nodeOrderIndex, pageIdentity) {
        const rootPageId =
            typeof pageIdentity?.rootPageId === 'string' && pageIdentity.rootPageId.trim()
                ? pageIdentity.rootPageId.trim()
                : null;

        const pageElementKeys = Object.keys(elements || {})
            .filter((elementKey) => {
                const pageId =
                    typeof elements?.[elementKey]?.pageId === 'string'
                        ? elements[elementKey].pageId.trim()
                        : '';
                return Boolean(pageId);
            })
            .sort((aKey, bKey) =>
                compareLayoutNodeOrder(nodeOrderIndex.get(aKey), nodeOrderIndex.get(bKey))
            );

        const pages = pageElementKeys.map((elementKey) => {
            const element = elements[elementKey];
            const pageId =
                typeof element?.pageId === 'string' && element.pageId.trim()
                    ? element.pageId.trim()
                    : null;
            return {
                pageId,
                nodeId:
                    typeof element?.nodeId === 'string' && element.nodeId.trim()
                        ? element.nodeId.trim()
                        : 'unknown',
                elementKey,
                label: resolveNavigationLabelForElement(element),
                isRoot: Boolean(rootPageId && pageId && pageId === rootPageId),
            };
        });

        // The web-root page must always be the first navigation entry, regardless of
        // topological layout order (which can place it last when sibling pages live in
        // other graphs that sort earlier alphabetically).
        pages.sort((a, b) => {
            const aIsRoot = a.isRoot === true;
            const bIsRoot = b.isRoot === true;
            if (aIsRoot === bIsRoot) {
                return 0;
            }
            return aIsRoot ? -1 : 1;
        });

        return {
            schemaVersion: 'webview-navigation-model/v1',
            rootPageId,
            pages,
        };
    }

    function resolveElementOwnerPageId(elements, elementKey, rootPageId) {
        const visitedKeys = new Set();
        let currentKey = typeof elementKey === 'string' ? elementKey : '';

        while (currentKey && elements[currentKey] && !visitedKeys.has(currentKey)) {
            visitedKeys.add(currentKey);

            const pageId =
                typeof elements[currentKey]?.pageId === 'string'
                    ? elements[currentKey].pageId.trim()
                    : '';
            if (pageId) {
                return pageId;
            }

            const parentKey =
                typeof elements[currentKey]?.parentKey === 'string'
                    ? elements[currentKey].parentKey.trim()
                    : '';
            currentKey = parentKey;
        }

        return rootPageId;
    }

    function buildPageBoundariesModel(elements, nodeOrderIndex, pageIdentity, navigation) {
        const rootPageId =
            typeof pageIdentity?.rootPageId === 'string' && pageIdentity.rootPageId.trim()
                ? pageIdentity.rootPageId.trim()
                : null;

        const orderedElementKeys = Object.keys(elements || {}).sort((aKey, bKey) =>
            compareLayoutNodeOrder(nodeOrderIndex.get(aKey), nodeOrderIndex.get(bKey))
        );

        const pageIdSet = new Set(
            (Array.isArray(navigation?.pages) ? navigation.pages : [])
                .map((entry) =>
                    typeof entry?.pageId === 'string' && entry.pageId.trim()
                        ? entry.pageId.trim()
                        : null
                )
                .filter(Boolean)
        );
        if (rootPageId) {
            pageIdSet.add(rootPageId);
        }

        const pageIds = Array.from(pageIdSet).sort((a, b) => a.localeCompare(b));
        const pagesById = new Map();

        pageIds.forEach((pageId) => {
            pagesById.set(pageId, {
                pageId,
                rootElementKey: null,
                rootNodeId: null,
                ownedElementKeys: [],
            });
        });

        orderedElementKeys.forEach((elementKey) => {
            const element = elements[elementKey];
            if (!element || typeof element !== 'object') {
                return;
            }

            const ownerPageId = resolveElementOwnerPageId(elements, elementKey, rootPageId);
            if (!ownerPageId) {
                return;
            }

            element.ownerPageId = ownerPageId;

            if (!pagesById.has(ownerPageId)) {
                pagesById.set(ownerPageId, {
                    pageId: ownerPageId,
                    rootElementKey: null,
                    rootNodeId: null,
                    ownedElementKeys: [],
                });
            }

            const pageBoundary = pagesById.get(ownerPageId);
            pageBoundary.ownedElementKeys.push(elementKey);

            const elementPageId =
                typeof element?.pageId === 'string' && element.pageId.trim()
                    ? element.pageId.trim()
                    : null;
            if (elementPageId && elementPageId === ownerPageId && !pageBoundary.rootElementKey) {
                pageBoundary.rootElementKey = elementKey;
                pageBoundary.rootNodeId =
                    typeof element?.nodeId === 'string' && element.nodeId.trim()
                        ? element.nodeId.trim()
                        : null;
            }
        });

        const pages = Array.from(pagesById.keys())
            .sort((a, b) => a.localeCompare(b))
            .map((pageId) => pagesById.get(pageId));

        return {
            schemaVersion: 'webview-page-boundaries/v1',
            pages,
        };
    }

    function collectPageIdDuplicates(pageIdsByNodeId) {
        const duplicatesByPageId = new Map();

        Object.entries(pageIdsByNodeId || {}).forEach(([nodeId, rawPageId]) => {
            const pageId = typeof rawPageId === 'string' ? rawPageId.trim() : '';
            if (!pageId) {
                return;
            }

            if (!duplicatesByPageId.has(pageId)) {
                duplicatesByPageId.set(pageId, []);
            }

            duplicatesByPageId.get(pageId).push(String(nodeId));
        });

        return Array.from(duplicatesByPageId.entries())
            .map(([pageId, nodeIds]) => ({
                pageId,
                nodeIds: nodeIds.slice().sort((a, b) => a.localeCompare(b)),
            }))
            .filter((entry) => entry.nodeIds.length > 1)
            .sort((a, b) => a.pageId.localeCompare(b.pageId));
    }

    function validatePageContractIntegrity(elements, pageIdentity, navigation, pageBoundaries) {
        const diagnostics = [];

        const rootPageId =
            typeof pageIdentity?.rootPageId === 'string' && pageIdentity.rootPageId.trim()
                ? pageIdentity.rootPageId.trim()
                : null;

        const pageIdsByNodeId =
            pageIdentity?.pageIdsByNodeId && typeof pageIdentity.pageIdsByNodeId === 'object'
                ? pageIdentity.pageIdsByNodeId
                : {};

        const pageIdDuplicates = collectPageIdDuplicates(pageIdsByNodeId);
        pageIdDuplicates.forEach((entry) => {
            diagnostics.push(
                buildLayoutDiagnostic(
                    'duplicate-page-id',
                    `Duplicate page id "${entry.pageId}" detected in page identity contract`,
                    {
                        pageId: entry.pageId,
                        nodeIds: entry.nodeIds,
                    }
                )
            );
        });

        const navigationPages = Array.isArray(navigation?.pages) ? navigation.pages : [];
        const navigationRootPageId =
            typeof navigation?.rootPageId === 'string' && navigation.rootPageId.trim()
                ? navigation.rootPageId.trim()
                : null;

        if (navigationRootPageId !== rootPageId) {
            diagnostics.push(
                buildLayoutDiagnostic(
                    'invalid-page-navigation-metadata',
                    'Navigation root page id does not match page identity root page id',
                    {
                        reason: 'root-page-id-mismatch',
                        expectedRootPageId: rootPageId,
                        navigationRootPageId,
                    }
                )
            );
        }

        const navigationPageById = new Map();
        navigationPages.forEach((entry, index) => {
            const pageId =
                typeof entry?.pageId === 'string' && entry.pageId.trim() ? entry.pageId.trim() : '';
            const nodeId =
                typeof entry?.nodeId === 'string' && entry.nodeId.trim() ? entry.nodeId.trim() : '';
            const label =
                typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : '';
            const isRoot = entry?.isRoot === true;

            if (!pageId || !nodeId || !label) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'invalid-page-navigation-metadata',
                        'Navigation page entry is missing required fields',
                        {
                            reason: 'missing-required-fields',
                            entryIndex: index,
                            pageId: pageId || null,
                            nodeId: nodeId || null,
                            label: label || null,
                        }
                    )
                );
                return;
            }

            if (navigationPageById.has(pageId)) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'invalid-page-navigation-metadata',
                        `Navigation page id "${pageId}" is duplicated`,
                        {
                            reason: 'duplicate-navigation-page-id',
                            pageId,
                            nodeIds: [navigationPageById.get(pageId), nodeId].sort((a, b) =>
                                a.localeCompare(b)
                            ),
                        }
                    )
                );
            } else {
                navigationPageById.set(pageId, nodeId);
            }

            if (isRoot !== Boolean(rootPageId && pageId === rootPageId)) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'invalid-page-navigation-metadata',
                        `Navigation root marker mismatch for page "${pageId}"`,
                        {
                            reason: 'root-flag-mismatch',
                            pageId,
                            isRoot,
                            expectedIsRoot: Boolean(rootPageId && pageId === rootPageId),
                        }
                    )
                );
            }
        });

        const hasWebRootNode = Object.values(elements || {}).some(
            (element) =>
                typeof element?.nodeType === 'string' &&
                element.nodeType.trim() === 'webview.web-root'
        );

        const boundaryPages = Array.isArray(pageBoundaries?.pages) ? pageBoundaries.pages : [];
        const rootBoundary = rootPageId
            ? boundaryPages.find(
                  (entry) => typeof entry?.pageId === 'string' && entry.pageId.trim() === rootPageId
              )
            : null;

        if (!hasWebRootNode || !rootPageId || !rootBoundary) {
            diagnostics.push(
                buildLayoutDiagnostic('missing-root-ownership', 'Missing root ownership metadata', {
                    reason: !hasWebRootNode
                        ? 'missing-web-root-node'
                        : !rootPageId
                          ? 'missing-root-page-id'
                          : 'missing-root-page-boundary',
                    rootPageId,
                })
            );
        } else {
            const rootElementKey =
                typeof rootBoundary.rootElementKey === 'string' &&
                rootBoundary.rootElementKey.trim()
                    ? rootBoundary.rootElementKey.trim()
                    : null;
            const ownedElementKeys = Array.isArray(rootBoundary.ownedElementKeys)
                ? rootBoundary.ownedElementKeys
                : [];

            if (!rootElementKey || !ownedElementKeys.includes(rootElementKey)) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'missing-root-ownership',
                        'Root page boundary does not own a valid root element',
                        {
                            reason: 'invalid-root-boundary-ownership',
                            rootPageId,
                            rootElementKey,
                        }
                    )
                );
            }
        }

        Object.values(elements || {}).forEach((element) => {
            if (!element || typeof element !== 'object') {
                return;
            }

            const nodeType = typeof element.nodeType === 'string' ? element.nodeType.trim() : '';
            const controls =
                element.controls && typeof element.controls === 'object' ? element.controls : {};

            if (
                nodeType === 'webview.web-page' &&
                Object.prototype.hasOwnProperty.call(controls, 'pageName') &&
                typeof controls.pageName !== 'string'
            ) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'invalid-page-navigation-metadata',
                        'Page navigation label must be a string for web-page nodes',
                        {
                            reason: 'invalid-page-name-type',
                            nodeId: typeof element.nodeId === 'string' ? element.nodeId : null,
                        }
                    )
                );
            }

            if (
                nodeType === 'webview.web-root' &&
                Object.prototype.hasOwnProperty.call(controls, 'title') &&
                typeof controls.title !== 'string'
            ) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'invalid-page-navigation-metadata',
                        'Root navigation label must be a string for web-root nodes',
                        {
                            reason: 'invalid-root-title-type',
                            nodeId: typeof element.nodeId === 'string' ? element.nodeId : null,
                        }
                    )
                );
            }
        });

        return diagnostics;
    }

    function buildWebviewLayoutModel(nodeEntries) {
        const diagnostics = [];
        const normalizedNodes = [];
        const nodeById = new Map();

        (Array.isArray(nodeEntries) ? nodeEntries : []).forEach((entry, entryIndex) => {
            if (!entry || typeof entry !== 'object') {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'invalid-node-entry',
                        'Encountered non-object webview node summary',
                        { entryIndex }
                    )
                );
                return;
            }

            const nodeId =
                typeof entry.id === 'string' && entry.id.trim()
                    ? entry.id.trim()
                    : `unknown-${entryIndex}`;
            const graphId = normalizeGraphId(entry.graphId);
            const scopedNodeId =
                typeof entry.scopedId === 'string' && entry.scopedId.trim()
                    ? entry.scopedId.trim()
                    : buildScopedNodeId(graphId, nodeId);
            const nodeKind =
                typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind.trim() : 'unknown';

            if (!WEBVIEW_SUPPORTED_NODE_KINDS.has(nodeKind)) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'unsupported-node-kind',
                        `Skipping unsupported webview node kind "${nodeKind}"`,
                        { nodeId: scopedNodeId, rawNodeId: nodeId, nodeKind, graphId }
                    )
                );
                return;
            }

            if (nodeById.has(scopedNodeId)) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'duplicate-node-id',
                        `Duplicate webview node id "${scopedNodeId}" detected; keeping first entry`,
                        { nodeId: scopedNodeId, rawNodeId: nodeId, graphId }
                    )
                );
                return;
            }

            const layout = entry.layout && typeof entry.layout === 'object' ? entry.layout : {};
            const parentNodeId =
                typeof layout.parentNodeId === 'string' && layout.parentNodeId.trim()
                    ? layout.parentNodeId.trim()
                    : null;
            const parentGraphId = normalizeGraphId(layout.parentGraphId) || graphId;
            const parentScopedNodeId =
                typeof layout.parentScopedNodeId === 'string' && layout.parentScopedNodeId.trim()
                    ? layout.parentScopedNodeId.trim()
                    : parentNodeId
                      ? buildScopedNodeId(parentGraphId, parentNodeId)
                      : null;
            const parentOutputIndex = Number.isFinite(layout.parentOutputIndex)
                ? Math.floor(Number(layout.parentOutputIndex))
                : null;

            const normalized = {
                nodeId,
                graphId,
                scopedNodeId,
                nodeKind,
                controls:
                    entry.controls && typeof entry.controls === 'object' ? entry.controls : {},
                parentNodeId,
                parentGraphId,
                parentScopedNodeId,
                parentOutputIndex,
            };

            nodeById.set(scopedNodeId, normalized);
            normalizedNodes.push(normalized);
        });

        if (normalizedNodes.length === 0) {
            return {
                schemaVersion: WEBVIEW_LAYOUT_SCHEMA_VERSION,
                root: {
                    id: 'layout-root',
                    children: [],
                    navigation: [],
                },
                elements: {},
                pageIdentity: {
                    schemaVersion: 'webview-page-identity/v1',
                    rootPageId: null,
                    pageIdsByNodeId: {},
                },
                navigation: {
                    schemaVersion: 'webview-navigation-model/v1',
                    rootPageId: null,
                    pages: [],
                },
                pageBoundaries: {
                    schemaVersion: 'webview-page-boundaries/v1',
                    pages: [],
                },
                diagnostics,
            };
        }

        const outgoingByNode = new Map();
        const inDegreeByNode = new Map();

        normalizedNodes.forEach((node) => {
            outgoingByNode.set(node.scopedNodeId, []);
            inDegreeByNode.set(node.scopedNodeId, 0);
        });

        normalizedNodes.forEach((node) => {
            if (!node.parentScopedNodeId) {
                if (node.nodeKind !== 'web-root' && node.nodeKind !== 'web-page') {
                    diagnostics.push(
                        buildLayoutDiagnostic(
                            'missing-parent',
                            `Node "${node.scopedNodeId}" has no parent layout input`,
                            {
                                nodeId: node.scopedNodeId,
                                rawNodeId: node.nodeId,
                                nodeKind: node.nodeKind,
                            }
                        )
                    );
                }
                return;
            }

            if (node.nodeKind === 'web-root') {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'root-has-parent',
                        `Ignoring parent for web-root node "${node.scopedNodeId}"`,
                        {
                            nodeId: node.scopedNodeId,
                            rawNodeId: node.nodeId,
                            parentNodeId: node.parentScopedNodeId,
                        }
                    )
                );
                return;
            }

            if (node.parentScopedNodeId === node.scopedNodeId) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'self-parent',
                        `Node "${node.scopedNodeId}" cannot reference itself as parent`,
                        { nodeId: node.scopedNodeId, rawNodeId: node.nodeId }
                    )
                );
                return;
            }

            if (!nodeById.has(node.parentScopedNodeId)) {
                diagnostics.push(
                    buildLayoutDiagnostic(
                        'parent-not-found',
                        `Parent node "${node.parentScopedNodeId}" not found for "${node.scopedNodeId}"`,
                        {
                            nodeId: node.scopedNodeId,
                            rawNodeId: node.nodeId,
                            parentNodeId: node.parentScopedNodeId,
                        }
                    )
                );
                return;
            }

            const outgoing = outgoingByNode.get(node.parentScopedNodeId);
            if (Array.isArray(outgoing)) {
                outgoing.push({
                    childNodeId: node.scopedNodeId,
                    connectorIndex: node.parentOutputIndex,
                });
            }
            inDegreeByNode.set(node.scopedNodeId, (inDegreeByNode.get(node.scopedNodeId) || 0) + 1);
        });

        outgoingByNode.forEach((edges) => {
            edges.sort((a, b) => {
                const aConnector = Number.isFinite(a?.connectorIndex)
                    ? a.connectorIndex
                    : Number.MAX_SAFE_INTEGER;
                const bConnector = Number.isFinite(b?.connectorIndex)
                    ? b.connectorIndex
                    : Number.MAX_SAFE_INTEGER;
                if (aConnector !== bConnector) {
                    return aConnector - bConnector;
                }
                return String(a?.childNodeId ?? '').localeCompare(String(b?.childNodeId ?? ''));
            });
        });

        const queue = normalizedNodes
            .filter((node) => (inDegreeByNode.get(node.scopedNodeId) || 0) === 0)
            .map((node) => node.scopedNodeId)
            .sort((a, b) => a.localeCompare(b));

        const topologicalOrder = new Map();
        let traversalIndex = 0;

        while (queue.length > 0) {
            const currentNodeId = queue.shift();
            if (!currentNodeId) {
                continue;
            }

            if (topologicalOrder.has(currentNodeId)) {
                continue;
            }

            topologicalOrder.set(currentNodeId, traversalIndex);
            traversalIndex += 1;

            const outgoing = outgoingByNode.get(currentNodeId) || [];
            outgoing.forEach((edge) => {
                const childNodeId = edge?.childNodeId;
                if (!childNodeId || !inDegreeByNode.has(childNodeId)) {
                    return;
                }
                const nextDegree = (inDegreeByNode.get(childNodeId) || 0) - 1;
                inDegreeByNode.set(childNodeId, nextDegree);
                if (nextDegree === 0) {
                    queue.push(childNodeId);
                }
            });
        }

        const unresolvedNodes = normalizedNodes
            .map((node) => node.scopedNodeId)
            .filter((nodeId) => !topologicalOrder.has(nodeId))
            .sort((a, b) => a.localeCompare(b));

        unresolvedNodes.forEach((nodeId) => {
            diagnostics.push(
                buildLayoutDiagnostic(
                    'cycle-or-unresolved-order',
                    `Could not resolve full topological order for node "${nodeId}"`,
                    { nodeId }
                )
            );
            topologicalOrder.set(nodeId, traversalIndex);
            traversalIndex += 1;
        });

        const rootCandidatesByKind = {
            'web-root': normalizedNodes
                .filter((node) => node.nodeKind === 'web-root')
                .map((node) => node.scopedNodeId)
                .sort((a, b) => a.localeCompare(b)),
            'web-page': normalizedNodes
                .filter((node) => node.nodeKind === 'web-page')
                .map((node) => node.scopedNodeId)
                .sort((a, b) => a.localeCompare(b)),
        };

        if (rootCandidatesByKind['web-root'].length > 1) {
            throw new Error(
                `Multiple web-root nodes detected: ${rootCandidatesByKind['web-root'].join(
                    ', '
                )}. At most one web-root node is allowed per collection; use web-page nodes for additional pages.`
            );
        }

        let primaryRootNodeId = null;
        if (rootCandidatesByKind['web-root'].length > 0) {
            [primaryRootNodeId] = rootCandidatesByKind['web-root'];
        } else if (rootCandidatesByKind['web-page'].length > 0) {
            [primaryRootNodeId] = rootCandidatesByKind['web-page'];
        } else {
            const fallbackNode = normalizedNodes.slice().sort((a, b) => {
                const orderComparison = compareLayoutNodeOrder(
                    {
                        topologicalOrder: topologicalOrder.get(a.scopedNodeId),
                        nodeId: a.scopedNodeId,
                    },
                    {
                        topologicalOrder: topologicalOrder.get(b.scopedNodeId),
                        nodeId: b.scopedNodeId,
                    }
                );
                return orderComparison;
            })[0];
            primaryRootNodeId = fallbackNode ? fallbackNode.scopedNodeId : null;
        }

        const pageIdentity = buildPageIdentityContract(normalizedNodes, primaryRootNodeId);

        const elements = {};
        const nodeOrderIndex = new Map();

        normalizedNodes.forEach((node) => {
            const nodeTypeCode = WEBVIEW_KIND_TYPE_CODES[node.nodeKind] || 'node';
            const elementKey = buildLayoutElementKey(node.scopedNodeId);
            const parentKey =
                node.parentScopedNodeId && nodeById.has(node.parentScopedNodeId)
                    ? buildLayoutElementKey(node.parentScopedNodeId)
                    : null;
            const binding = createLayoutBinding(
                node.nodeKind,
                node.scopedNodeId,
                node.parentOutputIndex
            );

            elements[elementKey] = {
                nodeId: node.scopedNodeId,
                rawNodeId: node.nodeId,
                graphId: node.graphId,
                nodeType: `webview.${node.nodeKind}`,
                kind: resolveLayoutElementKind(node.nodeKind),
                controls: { ...(node.controls || {}) },
                parentKey,
                children: [],
            };

            if (binding) {
                elements[elementKey].binding = binding;
            }

            const pageId = createPageId(node.nodeKind, node.scopedNodeId);
            if (pageId) {
                elements[elementKey].pageId = pageId;
            }

            nodeOrderIndex.set(elementKey, {
                nodeId: node.scopedNodeId,
                topologicalOrder: topologicalOrder.get(node.scopedNodeId),
                parentOutputIndex: node.parentOutputIndex,
                typeCode: nodeTypeCode,
            });
        });

        const rootElementKey = primaryRootNodeId
            ? buildLayoutElementKey(primaryRootNodeId)
            : 'layout-root';

        const topLevelChildren = [];

        Object.keys(elements).forEach((elementKey) => {
            if (elementKey === rootElementKey) {
                return;
            }

            const element = elements[elementKey];
            const parentKey = element?.parentKey;
            if (parentKey && elements[parentKey]) {
                elements[parentKey].children.push(elementKey);
                return;
            }

            topLevelChildren.push(elementKey);
        });

        Object.keys(elements).forEach((elementKey) => {
            const element = elements[elementKey];
            if (!Array.isArray(element?.children) || element.children.length === 0) {
                return;
            }
            element.children.sort((aKey, bKey) =>
                compareLayoutNodeOrder(nodeOrderIndex.get(aKey), nodeOrderIndex.get(bKey))
            );
        });

        topLevelChildren.sort((aKey, bKey) =>
            compareLayoutNodeOrder(nodeOrderIndex.get(aKey), nodeOrderIndex.get(bKey))
        );

        const rootChildren =
            rootElementKey !== 'layout-root' && elements[rootElementKey]
                ? [...elements[rootElementKey].children, ...topLevelChildren]
                : topLevelChildren;

        const dedupedRootChildren = [];
        const rootChildSeen = new Set();
        rootChildren.forEach((entry) => {
            if (typeof entry !== 'string' || !entry.trim() || rootChildSeen.has(entry)) {
                return;
            }
            rootChildSeen.add(entry);
            dedupedRootChildren.push(entry);
        });

        if (rootElementKey !== 'layout-root' && elements[rootElementKey]) {
            elements[rootElementKey].children = dedupedRootChildren.slice();
        }

        const navigation = buildNavigationModel(elements, nodeOrderIndex, pageIdentity);
        const pageBoundaries = buildPageBoundariesModel(
            elements,
            nodeOrderIndex,
            pageIdentity,
            navigation
        );
        diagnostics.push(
            ...validatePageContractIntegrity(elements, pageIdentity, navigation, pageBoundaries)
        );
        const rootNavigation = (Array.isArray(navigation?.pages) ? navigation.pages : [])
            .map((entry) => (typeof entry?.pageId === 'string' ? entry.pageId.trim() : ''))
            .filter(Boolean);

        return {
            schemaVersion: WEBVIEW_LAYOUT_SCHEMA_VERSION,
            root: {
                id: rootElementKey,
                children: dedupedRootChildren,
                navigation: rootNavigation,
            },
            elements,
            pageIdentity,
            navigation,
            pageBoundaries,
            diagnostics,
        };
    }

    function escapeHtml(value) {
        const text = String(value === undefined || value === null ? '' : value);
        return text.replace(/[&<>"']/g, (char) => {
            if (char === '&') {
                return '&amp;';
            }
            if (char === '<') {
                return '&lt;';
            }
            if (char === '>') {
                return '&gt;';
            }
            if (char === '"') {
                return '&quot;';
            }
            return '&#39;';
        });
    }

    function normalizeHeadingLevel(value) {
        const numeric = toFiniteInt(value, 2);
        if (numeric < 1) {
            return 1;
        }
        if (numeric > 6) {
            return 6;
        }
        return numeric;
    }

    function getNodeKindFromElement(element) {
        if (!element || typeof element !== 'object') {
            return '';
        }

        const nodeType = typeof element.nodeType === 'string' ? element.nodeType.trim() : '';
        if (!nodeType) {
            return '';
        }

        const segments = nodeType.split('.');
        const lastSegment = segments.length > 0 ? segments[segments.length - 1] : '';
        return typeof lastSegment === 'string' ? lastSegment.trim() : '';
    }

    function isLayoutPageScopeElement(element, enableMultiPageContract) {
        if (!enableMultiPageContract || !element || typeof element !== 'object') {
            return false;
        }

        const nodeKind = getNodeKindFromElement(element);
        const structuralStrategy = getStructuralNodeKindStrategy(nodeKind);
        if (!structuralStrategy || structuralStrategy.isPageScopeKind !== true) {
            return false;
        }

        return typeof element.pageId === 'string' && Boolean(element.pageId.trim());
    }

    function renderLayoutElementMarkup(
        layoutModel,
        elementKey,
        depth,
        renderState,
        activePageId,
        rootPageId,
        enableMultiPageContract
    ) {
        const elements =
            layoutModel?.elements && typeof layoutModel.elements === 'object'
                ? layoutModel.elements
                : {};
        const element = elements[elementKey];
        if (!element || typeof element !== 'object') {
            return [];
        }

        const safeDepth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
        const indent = '  '.repeat(safeDepth);
        const childIndent = '  '.repeat(safeDepth + 1);
        const nodeId =
            typeof element.nodeId === 'string' && element.nodeId.trim()
                ? element.nodeId.trim()
                : 'unknown';
        const nodeKind = getNodeKindFromElement(element);
        const children = Array.isArray(element.children) ? element.children.slice() : [];

        if (renderState.renderPath.has(elementKey)) {
            return [`${indent}<!-- webview-layout-cycle-skip: ${escapeHtml(elementKey)} -->`];
        }

        renderState.renderPath.add(elementKey);

        let lines = [];
        const implementation = getNodeKindImplementation(nodeKind);
        if (implementation && typeof implementation.renderMarkup === 'function') {
            const contributedLines = normalizeContributorMarkupLines(
                implementation.renderMarkup({
                    layoutModel,
                    elementKey,
                    element,
                    node: {
                        nodeId,
                        nodeKind,
                    },
                    view: {
                        depth: safeDepth,
                        indent,
                        childIndent,
                    },
                    helpers: {
                        escapeHtml,
                        normalizeBindingSegment,
                        normalizeValueTableRowCount,
                        renderChildren: (childDepth = safeDepth + 1) => {
                            const result = [];
                            children.forEach((childKey) => {
                                result.push(
                                    ...renderLayoutElementMarkup(
                                        layoutModel,
                                        childKey,
                                        childDepth,
                                        renderState,
                                        activePageId,
                                        rootPageId,
                                        enableMultiPageContract
                                    )
                                );
                            });
                            return result;
                        },
                    },
                    // transitional compatibility fields for existing node implementations
                    nodeId,
                    nodeKind,
                    depth: safeDepth,
                    indent,
                    childIndent,
                    escapeHtml,
                    normalizeBindingSegment,
                    normalizeValueTableRowCount,
                })
            );
            if (Array.isArray(contributedLines)) {
                lines = contributedLines;
            }
        }

        if (lines.length > 0) {
            // contributor-owned render path for node-specific elements
        } else {
            const structuralStrategy = getStructuralNodeKindStrategy(nodeKind);
            const containerClass = structuralStrategy?.containerClass || 'wv-container';
            const isPageScope =
                enableMultiPageContract && structuralStrategy?.isPageScopeKind === true;
            const elementPageId =
                typeof element?.pageId === 'string' && element.pageId.trim()
                    ? element.pageId.trim()
                    : null;
            const isActivePage = Boolean(
                isPageScope && elementPageId && activePageId && elementPageId === activePageId
            );

            if (isPageScope && elementPageId) {
                const pageRegionId = buildPageRegionId(elementPageId, nodeId);
                const pageClasses = `${containerClass} wv-page-scope${isActivePage ? ' is-active' : ''}`;
                lines = [
                    `${indent}<div id="${escapeHtml(pageRegionId)}" class="${pageClasses}" data-node-id="${escapeHtml(nodeId)}" data-node-kind="${escapeHtml(nodeKind || 'container')}" data-page-id="${escapeHtml(elementPageId)}" data-wv-page-scope="true" aria-hidden="${isActivePage ? 'false' : 'true'}"${isActivePage ? '' : ' hidden'}>`,
                ];
            } else {
                lines = [
                    `${indent}<div class="${containerClass}" data-node-id="${escapeHtml(nodeId)}" data-node-kind="${escapeHtml(nodeKind || 'container')}">`,
                ];
            }

            if (children.length === 0) {
                lines.push(`${childIndent}<!-- empty-container -->`);
            } else {
                children.forEach((childKey) => {
                    const childElement = elements[childKey];
                    // Keep page scopes as sibling regions to avoid nested visibility side effects.
                    if (
                        isPageScope &&
                        isLayoutPageScopeElement(childElement, enableMultiPageContract)
                    ) {
                        return;
                    }
                    lines.push(
                        ...renderLayoutElementMarkup(
                            layoutModel,
                            childKey,
                            safeDepth + 1,
                            renderState,
                            activePageId,
                            rootPageId,
                            enableMultiPageContract
                        )
                    );
                });
            }

            lines.push(`${indent}</div>`);
        }

        renderState.renderPath.delete(elementKey);
        return lines;
    }

    function buildWebviewLayoutMarkup(layoutModel, options = {}) {
        const enableMultiPageContract = options?.enableMultiPageContract !== false;
        const schemaVersion =
            typeof layoutModel?.schemaVersion === 'string' ? layoutModel.schemaVersion : '';
        if (schemaVersion !== WEBVIEW_LAYOUT_SCHEMA_VERSION) {
            return ['  <p class="wv-empty">No webview layout model is available.</p>'];
        }

        const elements =
            layoutModel?.elements && typeof layoutModel.elements === 'object'
                ? layoutModel.elements
                : {};
        const root =
            layoutModel?.root && typeof layoutModel.root === 'object' ? layoutModel.root : {};
        const rootId = typeof root.id === 'string' ? root.id.trim() : '';
        const rootChildren = Array.isArray(root.children) ? root.children.slice() : [];

        if (Object.keys(elements).length === 0) {
            return ['  <p class="wv-empty">No webview layout nodes were generated.</p>'];
        }

        const renderState = {
            renderPath: new Set(),
        };
        const activePageId = resolveInitialActivePageId(layoutModel);
        const rootPageId =
            typeof layoutModel?.pageIdentity?.rootPageId === 'string' &&
            layoutModel.pageIdentity.rootPageId.trim()
                ? layoutModel.pageIdentity.rootPageId.trim()
                : '';

        if (rootId && elements[rootId]) {
            const lines = renderLayoutElementMarkup(
                layoutModel,
                rootId,
                1,
                renderState,
                activePageId,
                rootPageId,
                enableMultiPageContract
            );

            const siblingPageScopeKeys = [];
            const seenSiblingPageKeys = new Set();
            const addSiblingPageScopeKey = (candidateKey) => {
                if (typeof candidateKey !== 'string' || !candidateKey.trim()) {
                    return;
                }
                if (candidateKey === rootId || seenSiblingPageKeys.has(candidateKey)) {
                    return;
                }
                if (!isLayoutPageScopeElement(elements[candidateKey], enableMultiPageContract)) {
                    return;
                }

                const candidatePageId =
                    typeof elements[candidateKey]?.pageId === 'string'
                        ? elements[candidateKey].pageId.trim()
                        : '';
                if (candidatePageId && rootPageId && candidatePageId === rootPageId) {
                    return;
                }

                seenSiblingPageKeys.add(candidateKey);
                siblingPageScopeKeys.push(candidateKey);
            };

            rootChildren.forEach((childKey) => addSiblingPageScopeKey(childKey));

            const pageIdsByNodeId =
                layoutModel?.pageIdentity?.pageIdsByNodeId &&
                typeof layoutModel.pageIdentity.pageIdsByNodeId === 'object'
                    ? layoutModel.pageIdentity.pageIdsByNodeId
                    : {};
            Object.keys(pageIdsByNodeId).forEach((nodeId) => {
                const normalizedNodeId = typeof nodeId === 'string' ? nodeId.trim() : '';
                if (!normalizedNodeId) {
                    return;
                }
                addSiblingPageScopeKey(`node:${normalizedNodeId}`);
            });

            siblingPageScopeKeys.forEach((childKey) => {
                lines.push(
                    ...renderLayoutElementMarkup(
                        layoutModel,
                        childKey,
                        1,
                        renderState,
                        activePageId,
                        rootPageId,
                        enableMultiPageContract
                    )
                );
            });

            return lines;
        }

        if (rootChildren.length > 0) {
            const lines = [];
            rootChildren.forEach((childKey) => {
                lines.push(
                    ...renderLayoutElementMarkup(
                        layoutModel,
                        childKey,
                        1,
                        renderState,
                        activePageId,
                        rootPageId,
                        enableMultiPageContract
                    )
                );
            });
            return lines.length > 0
                ? lines
                : ['  <p class="wv-empty">No webview layout nodes were generated.</p>'];
        }

        return ['  <p class="wv-empty">No webview layout nodes were generated.</p>'];
    }

    function resolvePrimaryPageTitle(nodeEntries) {
        const rootEntry = nodeEntries.find((entry) => entry.kind === 'web-root');
        const title = rootEntry?.controls?.title;
        if (typeof title === 'string' && title.trim()) {
            return title.trim();
        }

        return 'Micro Otter';
    }

    function resolvePrimaryRefreshIntervalMs(nodeEntries) {
        const rootEntry = nodeEntries.find((entry) => entry.kind === 'web-root');
        const rawValue = rootEntry?.controls?.refreshIntervalMs;
        return normalizeRefreshIntervalMs(rawValue);
    }

    function buildStaticRouteSpecs(collectionIdSegment, webserverSpecPatch) {
        const webviewRootPath = `collection/webview/${collectionIdSegment}`;
        const compressedOnlyAssets =
            webserverSpecPatch?.compressedOnlyAssets === undefined
                ? false
                : Boolean(webserverSpecPatch.compressedOnlyAssets);

        const indexRoute = {
            route: '/',
            contentType: 'text/html; charset=utf-8',
            fallbackPath: `${webviewRootPath}/index.html`,
            compressedPath: `${webviewRootPath}/index.html.gz`,
            contentEncoding: 'gzip',
            varyAcceptEncoding: true,
            forceCompressedOnly: compressedOnlyAssets,
            isBinaryFallback: false,
        };

        const clientRoute = {
            route: WEBVIEW_CLIENT_ROUTE,
            contentType: 'application/javascript',
            fallbackPath: `${webviewRootPath}/webview_client.js`,
            compressedPath: `${webviewRootPath}/webview_client.js.gz`,
            contentEncoding: 'gzip',
            varyAcceptEncoding: true,
            forceCompressedOnly: compressedOnlyAssets,
            isBinaryFallback: false,
        };

        const logoRoute = {
            route: OTTER_BG_LOGO_ASSET_PATH,
            contentType: 'image/svg+xml',
            fallbackPath: OTTER_BG_LOGO_FALLBACK_PATH,
            compressedPath: null,
            contentEncoding: null,
            varyAcceptEncoding: false,
            forceCompressedOnly: false,
            isBinaryFallback: false,
        };

        const faviconRoute = {
            route: OTTER_FAVICON_ROUTE,
            contentType: 'image/svg+xml',
            fallbackPath: OTTER_FAVICON_FALLBACK_PATH,
            compressedPath: null,
            contentEncoding: null,
            varyAcceptEncoding: false,
            forceCompressedOnly: false,
            isBinaryFallback: false,
        };

        const disableCompressedAssets = Boolean(webserverSpecPatch.disableCompressedAssets);
        if (disableCompressedAssets) {
            indexRoute.compressedPath = null;
            indexRoute.contentEncoding = null;
            indexRoute.varyAcceptEncoding = false;
            indexRoute.forceCompressedOnly = false;
            clientRoute.compressedPath = null;
            clientRoute.contentEncoding = null;
            clientRoute.varyAcceptEncoding = false;
            clientRoute.forceCompressedOnly = false;
        }

        return {
            indexRoute,
            staticRoutes: [clientRoute, logoRoute, faviconRoute],
        };
    }

    function buildWebviewHtml(title, layoutModel, options = {}) {
        const enableMultiPageContract = options?.enableMultiPageContract !== false;
        const pageMode = enableMultiPageContract ? 'multi-page' : 'single-page-compat';
        const safeTitle = typeof title === 'string' && title.trim() ? title.trim() : 'Micro Otter';
        const layoutMarkupLines = buildWebviewLayoutMarkup(layoutModel, {
            enableMultiPageContract,
        });
        const nodeStyleLines = buildNodeClientStyleLines({ pageMode });
        const navigationPages = Array.isArray(layoutModel?.navigation?.pages)
            ? layoutModel.navigation.pages
            : [];
        const activePageId = resolveInitialActivePageId(layoutModel);
        const rootPageId =
            typeof layoutModel?.pageIdentity?.rootPageId === 'string' &&
            layoutModel.pageIdentity.rootPageId.trim()
                ? layoutModel.pageIdentity.rootPageId.trim()
                : '';
        const layoutSchema =
            typeof layoutModel?.schemaVersion === 'string'
                ? layoutModel.schemaVersion
                : WEBVIEW_LAYOUT_SCHEMA_VERSION;
        const layoutRoot =
            typeof layoutModel?.root?.id === 'string' && layoutModel.root.id.trim()
                ? layoutModel.root.id.trim()
                : 'layout-root';

        if (!enableMultiPageContract) {
            return [
                '<!DOCTYPE html>',
                '<html lang="en">',
                '<head>',
                '  <meta charset="utf-8" />',
                '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
                `  <title>${safeTitle}</title>`,
                '  <style>',
                '    :root { color-scheme: dark; }',
                '    * { box-sizing: border-box; }',
                '    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #121826, #05060a 65%); color: #e8ecff; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; padding: clamp(0.75rem, 2vw, 1.5rem); }',
                '    #otter-runtime-shell { position: relative; min-height: calc(100vh - clamp(1.5rem, 4vw, 3rem)); width: 100%; display: flex; align-items: stretch; justify-content: stretch; }',
                `    #otter-bg-logo { ${OTTER_BG_LOGO_LAYER_CSS} }`,
                `    #otter-bg-logo img { ${OTTER_BG_LOGO_IMAGE_CSS} }`,
                '    #otter-dom-root { position: relative; z-index: 1; width: 100%; min-height: 24px; padding: 16px; }',
                ...nodeStyleLines,
                '    .wv-empty { margin: 0; color: #a2b0ce; }',
                '  </style>',
                '</head>',
                '<body>',
                '  <main id="otter-runtime-shell">',
                ...OTTER_BG_LOGO_MARKUP_LINES,
                `    <section id="otter-dom-root" data-otter-dom-mount="true" data-layout-schema="${escapeHtml(layoutSchema)}" data-layout-root="${escapeHtml(layoutRoot)}">`,
                ...layoutMarkupLines.map((line) => `      ${line}`),
                '    </section>',
                '  </main>',
                `  <script src="${WEBVIEW_CLIENT_ROUTE}"></script>`,
                '</body>',
                '</html>',
                '',
            ].join('\n');
        }

        return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '  <meta charset="utf-8" />',
            '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
            `  <title>${safeTitle}</title>`,
            '  <style>',
            '    :root { color-scheme: dark; }',
            '    * { box-sizing: border-box; }',
            '    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #121826, #05060a 65%); color: #e8ecff; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; padding: clamp(0.75rem, 2vw, 1.5rem); }',
            '    #otter-runtime-shell { position: relative; min-height: calc(100vh - clamp(1.5rem, 4vw, 3rem)); width: 100%; display: flex; align-items: stretch; justify-content: stretch; }',
            `    #otter-bg-logo { ${OTTER_BG_LOGO_LAYER_CSS} }`,
            `    #otter-bg-logo img { ${OTTER_BG_LOGO_IMAGE_CSS} }`,
            '    #otter-dom-root { position: relative; z-index: 1; width: 100%; min-height: 24px; }',
            '    .wv-shell { position: relative; display: grid; grid-template-columns: 64px 1fr; min-height: 100%; width: 100%; border: 0; border-radius: 0; background: rgba(9, 14, 27, 0.64); backdrop-filter: blur(2px); overflow: hidden; }',
            '    .wv-shell[data-nav-mode="collapsed"] { grid-template-columns: 64px 1fr; }',
            '    .wv-shell[data-nav-mode="expanded"] { grid-template-columns: 220px 1fr; }',
            `    .wv-shell::before { content: ""; position: absolute; inset: 0; background: url("${OTTER_BG_LOGO_ASSET_PATH}") center/ min(44vmin, 360px) no-repeat; opacity: 0.14; filter: grayscale(1) brightness(0.42) contrast(1.05); pointer-events: none; z-index: 0; }`,
            '    .wv-shell > * { position: relative; z-index: 1; }',
            '    .wv-page-nav { border-right: 0; background: rgba(11, 18, 34, 0.95); padding: 14px 10px; }',
            '    .wv-page-nav-toggle { width: 100%; height: 40px; border: 0; border-radius: 10px; background: rgba(36, 57, 95, 0.62); color: #e8ecff; font-size: 20px; line-height: 1; cursor: pointer; margin: 0 0 10px 0; }',
            '    .wv-page-nav-toggle:hover { background: rgba(55, 82, 133, 0.72); }',
            '    .wv-page-nav-toggle:focus-visible { outline: 2px solid #97bdff; outline-offset: 2px; }',
            '    .wv-page-nav-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }',
            '    .wv-page-nav-button { width: 100%; text-align: left; border: 1px solid transparent; background: transparent; color: inherit; border-radius: 8px; padding: 8px 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-height: 40px; gap: 8px; }',
            '    .wv-shell[data-nav-mode="collapsed"] .wv-page-nav-button { justify-content: center; padding: 8px 6px; }',
            '    .wv-shell[data-nav-mode="expanded"] .wv-page-nav-button { justify-content: flex-start; padding: 8px 10px; }',
            '    .wv-page-nav-label-compact { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; font-weight: 700; text-transform: uppercase; font-size: 24px; line-height: 1; }',
            '    .wv-page-nav-label-full { display: none; }',
            '    .wv-shell[data-nav-mode="expanded"] .wv-page-nav-label-full { display: inline; }',
            '    .wv-page-nav-button:focus-visible { outline: 2px solid #97bdff; outline-offset: 2px; }',
            '    .wv-page-nav-button:hover { background: #1a263f; border-color: #334771; }',
            '    .wv-page-nav-button.is-active { background: #223255; border-color: #4b6ca6; font-weight: 600; }',
            '    .wv-page-content { min-height: 24px; padding: 16px; width: 100%; overflow: auto; }',
            '    .wv-page-scope { display: none; }',
            '    .wv-page-scope.is-active { display: block; }',
            ...nodeStyleLines,
            '    .wv-empty { margin: 0; color: #a2b0ce; }',
            '    @media (max-width: 760px) { body { padding: 0.5rem; } #otter-runtime-shell { min-height: calc(100vh - 1rem); } .wv-shell { grid-template-columns: 1fr; } .wv-page-nav { border-right: 0; border-bottom: 0; } .wv-page-nav-list { flex-direction: row; flex-wrap: wrap; } }',
            '  </style>',
            '</head>',
            '<body>',
            '  <main id="otter-runtime-shell">',
            ...OTTER_BG_LOGO_MARKUP_LINES,
            `    <section id="otter-dom-root" data-otter-dom-mount="true" data-layout-schema="${escapeHtml(layoutSchema)}" data-layout-root="${escapeHtml(layoutRoot)}" data-root-page-id="${escapeHtml(rootPageId)}" data-active-page-id="${escapeHtml(activePageId || '')}" data-nav-mode="collapsed">`,
            '      <div id="wv-nav-shell" class="wv-shell" data-nav-mode="collapsed">',
            `        <aside id="wv-page-nav" class="wv-page-nav" data-root-page-id="${escapeHtml(rootPageId)}">`,
            '          <button id="wv-nav-toggle" class="wv-page-nav-toggle" type="button" aria-label="Toggle navigation" aria-controls="wv-nav-list" aria-expanded="false">&#9776;</button>',
            '          <ul id="wv-nav-list" class="wv-page-nav-list">',
            ...navigationPages.map((entry) => {
                const pageId =
                    typeof entry?.pageId === 'string' && entry.pageId.trim()
                        ? entry.pageId.trim()
                        : '';
                const label =
                    typeof entry?.label === 'string' && entry.label.trim()
                        ? entry.label.trim()
                        : pageId || 'page';
                const nodeId =
                    typeof entry?.nodeId === 'string' && entry.nodeId.trim()
                        ? entry.nodeId.trim()
                        : 'unknown';
                const buttonId = buildNavigationButtonId(pageId, nodeId);
                const isActive = Boolean(activePageId && pageId && pageId === activePageId);
                const buttonClass = `wv-page-nav-button${isActive ? ' is-active' : ''}`;
                const compactLabel = resolveCompactNavigationGlyph(label, {
                    isRootPage: pageId === rootPageId,
                });
                return [
                    '        <li class="wv-page-nav-item">',
                    `          <button id="${escapeHtml(buttonId)}" class="${buttonClass}" type="button" data-wv-page-target="${escapeHtml(pageId)}" aria-current="${isActive ? 'page' : 'false'}" aria-label="${escapeHtml(label)}"><span class="wv-page-nav-label-compact" aria-hidden="true">${escapeHtml(compactLabel)}</span><span class="wv-page-nav-label-full">${escapeHtml(label)}</span></button>`,
                    '        </li>',
                ].join('\n');
            }),
            '          </ul>',
            '        </aside>',
            '        <main class="wv-page-content">',
            ...layoutMarkupLines.map((line) => `          ${line}`),
            '        </main>',
            '      </div>',
            '    </section>',
            '  </main>',
            `  <script src="${WEBVIEW_CLIENT_ROUTE}"></script>`,
            '</body>',
            '</html>',
            '',
        ].join('\n');
    }

    function composeClientScriptSections(scriptLines) {
        if (!Array.isArray(scriptLines) || scriptLines.length === 0) {
            return [];
        }

        const nodeSectionStart = scriptLines.findIndex(
            (line) =>
                typeof line === 'string' &&
                line.includes('function applyContentUpdate(targetElement, entry) {')
        );
        const sharedEpilogueStart = scriptLines.findIndex(
            (line) =>
                typeof line === 'string' && line.includes('function applyRefreshPayload(payload) {')
        );

        if (
            nodeSectionStart < 0 ||
            sharedEpilogueStart < 0 ||
            nodeSectionStart >= sharedEpilogueStart
        ) {
            return scriptLines.slice();
        }

        const sharedPrelude = scriptLines.slice(0, nodeSectionStart);
        const nodeSpecificHandlersAndHelpers = scriptLines.slice(
            nodeSectionStart,
            sharedEpilogueStart
        );
        const sharedEpilogue = scriptLines.slice(sharedEpilogueStart);

        return [...sharedPrelude, ...nodeSpecificHandlersAndHelpers, ...sharedEpilogue];
    }

    function buildNodeClientContributionSections() {
        const sections = {
            updateHandlers: [],
            updateDispatchEntries: [],
            helpers: [],
            initHooks: [],
            pollHelpers: [],
            pollRequestHookEntries: [],
            pollSuccessHookEntries: [],
            pollErrorHookEntries: [],
        };

        const implementationEntries = listNodeKindImplementations()
            .slice()
            .sort((a, b) => {
                const aKind = typeof a?.nodeKind === 'string' ? a.nodeKind : '';
                const bKind = typeof b?.nodeKind === 'string' ? b.nodeKind : '';
                return aKind.localeCompare(bKind);
            });

        implementationEntries.forEach((entry) => {
            const nodeKind = typeof entry?.nodeKind === 'string' ? entry.nodeKind : '';
            if (!nodeKind) {
                return;
            }

            const implementation = getNodeKindImplementation(nodeKind, { required: true });
            if (!implementation) {
                return;
            }

            if (typeof implementation.renderClientUpdateHandler === 'function') {
                const updateLines = normalizeContributorMarkupLines(
                    implementation.renderClientUpdateHandler({ nodeKind })
                );
                if (Array.isArray(updateLines) && updateLines.length > 0) {
                    if (sections.updateHandlers.length > 0) {
                        sections.updateHandlers.push('');
                    }
                    sections.updateHandlers.push(...updateLines);

                    const handlerName = parseUpdateHandlerName(updateLines);
                    if (handlerName) {
                        sections.updateDispatchEntries.push({ nodeKind, handlerName });
                    }
                }
            }

            if (typeof implementation.renderClientHelpers === 'function') {
                const helperLines = normalizeContributorMarkupLines(
                    implementation.renderClientHelpers({ nodeKind })
                );
                if (Array.isArray(helperLines) && helperLines.length > 0) {
                    if (sections.helpers.length > 0) {
                        sections.helpers.push('');
                    }
                    sections.helpers.push(...helperLines);
                }
            }

            if (typeof implementation.renderClientInitHooks === 'function') {
                const initHookLines = normalizeContributorMarkupLines(
                    implementation.renderClientInitHooks({ nodeKind })
                );
                if (Array.isArray(initHookLines) && initHookLines.length > 0) {
                    sections.initHooks.push(...initHookLines);
                }
            }

            if (typeof implementation.renderClientPollHelpers === 'function') {
                const pollHelperLines = normalizeContributorMarkupLines(
                    implementation.renderClientPollHelpers({ nodeKind })
                );
                if (Array.isArray(pollHelperLines) && pollHelperLines.length > 0) {
                    if (sections.pollHelpers.length > 0) {
                        sections.pollHelpers.push('');
                    }
                    sections.pollHelpers.push(...pollHelperLines);
                }
            }

            if (typeof implementation.renderClientPollRequestHook === 'function') {
                const pollRequestLines = normalizeContributorMarkupLines(
                    implementation.renderClientPollRequestHook({ nodeKind })
                );
                if (Array.isArray(pollRequestLines) && pollRequestLines.length > 0) {
                    const hookName = parseFunctionName(pollRequestLines);
                    if (hookName) {
                        sections.pollRequestHookEntries.push({ nodeKind, hookName });
                    }
                    if (sections.pollHelpers.length > 0) {
                        sections.pollHelpers.push('');
                    }
                    sections.pollHelpers.push(...pollRequestLines);
                }
            }

            if (typeof implementation.renderClientPollSuccessHook === 'function') {
                const pollSuccessLines = normalizeContributorMarkupLines(
                    implementation.renderClientPollSuccessHook({ nodeKind })
                );
                if (Array.isArray(pollSuccessLines) && pollSuccessLines.length > 0) {
                    const hookName = parseFunctionName(pollSuccessLines);
                    if (hookName) {
                        sections.pollSuccessHookEntries.push({ nodeKind, hookName });
                    }
                    if (sections.pollHelpers.length > 0) {
                        sections.pollHelpers.push('');
                    }
                    sections.pollHelpers.push(...pollSuccessLines);
                }
            }

            if (typeof implementation.renderClientPollErrorHook === 'function') {
                const pollErrorLines = normalizeContributorMarkupLines(
                    implementation.renderClientPollErrorHook({ nodeKind })
                );
                if (Array.isArray(pollErrorLines) && pollErrorLines.length > 0) {
                    const hookName = parseFunctionName(pollErrorLines);
                    if (hookName) {
                        sections.pollErrorHookEntries.push({ nodeKind, hookName });
                    }
                    if (sections.pollHelpers.length > 0) {
                        sections.pollHelpers.push('');
                    }
                    sections.pollHelpers.push(...pollErrorLines);
                }
            }
        });

        return sections;
    }

    function buildNodeClientStyleLines(options = {}) {
        const pageMode = typeof options?.pageMode === 'string' ? options.pageMode : '';
        const sections = [];
        const seenLines = new Set();

        const implementationEntries = listNodeKindImplementations()
            .slice()
            .sort((a, b) => {
                const aKind = typeof a?.nodeKind === 'string' ? a.nodeKind : '';
                const bKind = typeof b?.nodeKind === 'string' ? b.nodeKind : '';
                return aKind.localeCompare(bKind);
            });

        implementationEntries.forEach((entry) => {
            const nodeKind = typeof entry?.nodeKind === 'string' ? entry.nodeKind : '';
            if (!nodeKind) {
                return;
            }

            const implementation = getNodeKindImplementation(nodeKind, { required: true });
            if (!implementation || typeof implementation.renderClientStyleRules !== 'function') {
                return;
            }

            const styleLines = normalizeContributorMarkupLines(
                implementation.renderClientStyleRules({ nodeKind, pageMode })
            );
            if (!Array.isArray(styleLines) || styleLines.length === 0) {
                return;
            }

            const uniqueStyleLines = [];
            styleLines.forEach((line) => {
                if (seenLines.has(line)) {
                    return;
                }
                seenLines.add(line);
                uniqueStyleLines.push(line);
            });

            if (uniqueStyleLines.length === 0) {
                return;
            }

            if (sections.length > 0) {
                sections.push('');
            }
            sections.push(...uniqueStyleLines);
        });

        return sections;
    }

    /**
     * Emits the shared refresh scheduler: fetch helper, pacing, and backoff.
     *
     * The poll loop is completion-chained: ``pollRefresh()`` schedules the next
     * request from its ``finally`` block, so two refreshes can never overlap and
     * no scheduled tick is wasted while a request is still in flight.
     * ``REFRESH_INTERVAL_MS`` is therefore a floor on the period between poll
     * *starts*; the effective cadence is ``max(interval, device round trip)``.
     *
     * @returns {string[]} Client-script lines appended after the poll loop.
     */
    function buildRefreshSchedulerLines() {
        return [
            'const REFRESH_TIMEOUT_MS = 5000;',
            'const MAX_REFRESH_BACKOFF_MS = 5000;',
            '// A response only counts as slow when the device needs at least this long to',
            '// answer. The floor keeps ordinary ESP32 WiFi round trips (200-400 ms) from',
            '// arming the backoff when REFRESH_INTERVAL_MS is short, which would pin the',
            '// cadence at the backed-off delay instead of the configured interval.',
            'const REFRESH_SLOW_THRESHOLD_MS = Math.max(REFRESH_INTERVAL_MS * 2, 1000);',
            'let refreshSlowStreak = 0;',
            'let refreshTimer = 0;',
            'let lastRefreshDurationMs = 0;',
            '',
            'async function postRefreshWithTimeout(requestPayload) {',
            '  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;',
            '  const timeoutId = controller ? setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS) : 0;',
            '  try {',
            '    const response = await fetch(POST_REFRESH_ROUTE, {',
            '      method: "POST",',
            '      headers: { "Content-Type": "application/json" },',
            '      body: JSON.stringify(requestPayload),',
            '      signal: controller ? controller.signal : undefined,',
            '    });',
            '    // fetch() resolves on the response headers, so the body is read inside the',
            '    // same deadline. Otherwise a stalled body leaves the request pending past',
            '    // the abort timer and every later refresh is skipped as in-flight.',
            '    const bodyText = await response.text();',
            '    return { ok: response.ok, status: response.status, bodyText };',
            '  } finally {',
            '    if (timeoutId) { clearTimeout(timeoutId); }',
            '  }',
            '}',
            '',
            'function refreshPeriodMs() {',
            '  return Math.min(REFRESH_INTERVAL_MS * (refreshSlowStreak + 1), MAX_REFRESH_BACKOFF_MS);',
            '}',
            '',
            'function nextRefreshDelayMs() {',
            '  return Math.max(0, refreshPeriodMs() - lastRefreshDurationMs);',
            '}',
            '',
            'function scheduleNextRefresh(delayMs) {',
            '  if (refreshTimer) { clearTimeout(refreshTimer); }',
            '  const resolvedDelayMs =',
            '    typeof delayMs === "number" && delayMs >= 0 ? delayMs : nextRefreshDelayMs();',
            '  refreshTimer = setTimeout(() => {',
            '    refreshTimer = 0;',
            '    void pollRefresh();',
            '  }, resolvedDelayMs);',
            '}',
            '',
            'if (typeof document !== "undefined") {',
            '  document.addEventListener("visibilitychange", () => {',
            '    if (!document.hidden) {',
            '      refreshSlowStreak = 0;',
            '      void pollRefresh();',
            '    }',
            '  });',
            '}',
        ];
    }

    /**
     * Emits extra client-script lines used for runtime diagnostics.
     *
     * Includes the ``[wv-perf]`` measurement harness, which reports refresh
     * cadence (receive interval), transport phases (``poll:request``,
     * ``poll:body``), render phases (``poll:apply``, ``apply:<kind>``,
     * ``graph:draw:*``) and in-flight skips. The counters always accumulate, but
     * nothing reaches the console unless a developer opts in, either from
     * DevTools with ``localStorage.setItem("wvPerf", "1")`` plus a reload, by
     * flipping ``WV_PERF_LOG`` below, or by calling ``__wvPerfReport()`` for a
     * one-off snapshot. A deployed device therefore keeps a clean console.
     *
     * @returns {string[]} Client-script lines appended to the bootstrap.
     */
    function buildClientDiagnosticsLines() {
        return [
            '// [wv-perf] Refresh cadence and render-cost measurement harness.',
            '// Counters always accumulate; console output is opt-in via localStorage.',
            'function wvPerfLoggingEnabled() {',
            '  try {',
            '    return typeof localStorage !== "undefined" && localStorage.getItem("wvPerf") === "1";',
            '  } catch (error) {',
            '    // Storage can be unavailable (private mode, embedded views); stay silent.',
            '    return false;',
            '  }',
            '}',
            'const WV_PERF_LOG = wvPerfLoggingEnabled();',
            'const WV_PERF_REPORT_EVERY = 50;',
            'const WV_PERF_SAMPLE_LIMIT = 400;',
            'const wvPerfStats = {',
            '  startedAt: 0,',
            '  polls: 0,',
            '  received: 0,',
            '  emptyReceives: 0,',
            '  errors: 0,',
            '  skipped: 0,',
            '  hiddenSkips: 0,',
            '  updates: 0,',
            '  lastPollStartAt: null,',
            '  intervals: [],',
            '  parts: Object.create(null),',
            '};',
            '',
            'function wvPerfNow() {',
            '  return typeof performance !== "undefined" && typeof performance.now === "function"',
            '    ? performance.now()',
            '    : Date.now();',
            '}',
            '',
            'wvPerfStats.startedAt = wvPerfNow();',
            '',
            'function wvPerfFormatMs(value) {',
            '  const numeric = Number(value);',
            '  return value === null || value === undefined || !Number.isFinite(numeric)',
            '    ? "n/a"',
            '    : `${Math.round(numeric)}ms`;',
            '}',
            '',
            '// Unconditional writer; the callers decide whether logging is enabled.',
            'function wvPerfEmit(args) {',
            '  if (typeof console === "undefined" || typeof console.info !== "function") { return; }',
            '  console.info.apply(console, ["[wv-perf]"].concat(args));',
            '}',
            '',
            'function wvPerfLog() {',
            '  if (!WV_PERF_LOG) { return; }',
            '  wvPerfEmit(Array.prototype.slice.call(arguments));',
            '}',
            '',
            'function wvPerfRecord(name, durationMs) {',
            '  if (!Number.isFinite(durationMs)) { return; }',
            '  const bucket = wvPerfStats.parts[name] || { count: 0, totalMs: 0, minMs: 0, maxMs: 0 };',
            '  bucket.count += 1;',
            '  bucket.totalMs += durationMs;',
            '  bucket.minMs = bucket.count === 1 || durationMs < bucket.minMs ? durationMs : bucket.minMs;',
            '  bucket.maxMs = bucket.count === 1 || durationMs > bucket.maxMs ? durationMs : bucket.maxMs;',
            '  wvPerfStats.parts[name] = bucket;',
            '}',
            '',
            'function wvPerfRecordInterval(gapMs) {',
            '  const numeric = Number(gapMs);',
            '  if (gapMs === null || gapMs === undefined || !Number.isFinite(numeric)) { return; }',
            '  wvPerfStats.intervals.push(numeric);',
            '  if (wvPerfStats.intervals.length > WV_PERF_SAMPLE_LIMIT) { wvPerfStats.intervals.shift(); }',
            '}',
            '',
            'function wvPerfMean(values) {',
            '  if (!Array.isArray(values) || values.length === 0) { return null; }',
            '  let total = 0;',
            '  values.forEach((value) => { total += value; });',
            '  return total / values.length;',
            '}',
            '',
            'function wvPerfSummary() {',
            '  const intervals = wvPerfStats.intervals;',
            '  const elapsedMs = Math.max(1, wvPerfNow() - wvPerfStats.startedAt);',
            '  const parts = {};',
            '  Object.keys(wvPerfStats.parts).forEach((name) => {',
            '    const bucket = wvPerfStats.parts[name];',
            '    const count = Math.max(1, bucket.count);',
            '    parts[name] = {',
            '      count: bucket.count,',
            '      meanMs: Math.round((bucket.totalMs / count) * 100) / 100,',
            '      minMs: Math.round(bucket.minMs * 100) / 100,',
            '      maxMs: Math.round(bucket.maxMs * 100) / 100,',
            '      totalMs: Math.round(bucket.totalMs),',
            '    };',
            '  });',
            '  return {',
            '    elapsedSec: Math.round(elapsedMs) / 1000,',
            '    polls: wvPerfStats.polls,',
            '    received: wvPerfStats.received,',
            '    pollHz: Math.round((wvPerfStats.polls / elapsedMs) * 10000) / 10,',
            '    receiveHz: Math.round((wvPerfStats.received / elapsedMs) * 10000) / 10,',
            '    emptyReceives: wvPerfStats.emptyReceives,',
            '    updates: wvPerfStats.updates,',
            '    errors: wvPerfStats.errors,',
            '    skipped: wvPerfStats.skipped,',
            '    hiddenSkips: wvPerfStats.hiddenSkips,',
            '    meanGapMs: wvPerfMean(intervals),',
            '    minGapMs: intervals.length > 0 ? Math.min.apply(null, intervals) : null,',
            '    maxGapMs: intervals.length > 0 ? Math.max.apply(null, intervals) : null,',
            '    refreshIntervalMs: REFRESH_INTERVAL_MS,',
            '    refreshSlowStreak: typeof refreshSlowStreak === "number" ? refreshSlowStreak : null,',
            '    nextDelayMs: typeof nextRefreshDelayMs === "function" ? nextRefreshDelayMs() : null,',
            '    parts,',
            '  };',
            '}',
            '',
            'function wvPerfReport(options) {',
            '  const summary = wvPerfSummary();',
            '  if (!WV_PERF_LOG && !(options && options.log === true)) { return summary; }',
            '  const orderedNames = Object.keys(summary.parts).sort(',
            '    (left, right) => summary.parts[right].totalMs - summary.parts[left].totalMs',
            '  );',
            '  const orderedParts = {};',
            '  orderedNames.forEach((name) => { orderedParts[name] = summary.parts[name]; });',
            '  wvPerfEmit([',
            '    `summary polls=${summary.polls} recv=${summary.received} recvHz=${summary.receiveHz}`,',
            '    `gap=${wvPerfFormatMs(summary.meanGapMs)} min=${wvPerfFormatMs(summary.minGapMs)}`,',
            '    `max=${wvPerfFormatMs(summary.maxGapMs)} interval=${summary.refreshIntervalMs}`,',
            '    `streak=${summary.refreshSlowStreak} next=${wvPerfFormatMs(summary.nextDelayMs)}`,',
            '    `skipped=${summary.skipped} empty=${summary.emptyReceives} errors=${summary.errors}`',
            '  ]);',
            '  if (typeof console !== "undefined" && typeof console.table === "function") {',
            '    console.table(orderedParts);',
            '  } else {',
            '    wvPerfEmit(["parts", orderedParts]);',
            '  }',
            '  return summary;',
            '}',
            '',
            'if (typeof window !== "undefined") {',
            '  window.__wvPerfStats = wvPerfStats;',
            '  window.__wvPerfSummary = wvPerfSummary;',
            '  window.__wvPerfReport = () => wvPerfReport({ log: true });',
            '}',
        ];
    }

    function buildWebviewClientScript(postRefreshRoute, refreshIntervalMs, options = {}) {
        const enableMultiPageContract = options?.enableMultiPageContract !== false;
        const routeLiteral = JSON.stringify(postRefreshRoute || POST_REFRESH_ROUTE);
        const resolvedRefreshIntervalMs = normalizeRefreshIntervalMs(refreshIntervalMs);
        const nodeClientSections = buildNodeClientContributionSections();

        if (!enableMultiPageContract) {
            const scriptLines = [
                '// Auto-generated minimal webview client',
                `const POST_REFRESH_ROUTE = ${routeLiteral};`,
                `const REFRESH_INTERVAL_MS = ${resolvedRefreshIntervalMs};`,
                'const rootElement = document.getElementById("otter-dom-root");',
                ...buildClientDiagnosticsLines(),
                '',
                'function normalizeHeadingLevel(rawLevel) {',
                '  const numeric = Number(rawLevel);',
                '  if (!Number.isFinite(numeric)) {',
                '    return 2;',
                '  }',
                '  const integerLevel = Math.floor(numeric);',
                '  if (integerLevel < 1) {',
                '    return 1;',
                '  }',
                '  if (integerLevel > 6) {',
                '    return 6;',
                '  }',
                '  return integerLevel;',
                '}',
                '',
                'function hasOwnProperty(value, key) {',
                '  return Object.prototype.hasOwnProperty.call(value, key);',
                '}',
                '',
                ...nodeClientSections.updateHandlers,
                '',
                ...nodeClientSections.helpers,
                '',
                ...nodeClientSections.pollHelpers,
                '',
                'function runNodeClientInitHooks() {',
                ...nodeClientSections.initHooks.map(
                    (line) =>
                        `  try { ${line} } catch (error) { if (typeof console !== "undefined" && typeof console.warn === "function") { console.warn("Webview init hook failed", error); } }`
                ),
                '}',
                '',
                'const NODE_POLL_REQUEST_HOOKS = [',
                ...nodeClientSections.pollRequestHookEntries.map((entry) => `  ${entry.hookName},`),
                '];',
                'const NODE_POLL_SUCCESS_HOOKS = [',
                ...nodeClientSections.pollSuccessHookEntries.map((entry) => `  ${entry.hookName},`),
                '];',
                'const NODE_POLL_ERROR_HOOKS = [',
                ...nodeClientSections.pollErrorHookEntries.map((entry) => `  ${entry.hookName},`),
                '];',
                '',
                'function applyNodePollRequestHooks(requestPayload) {',
                '  NODE_POLL_REQUEST_HOOKS.forEach((hook) => {',
                '    if (typeof hook === "function") {',
                '      hook(requestPayload);',
                '    }',
                '  });',
                '}',
                '',
                'function applyNodePollSuccessHooks(payload) {',
                '  NODE_POLL_SUCCESS_HOOKS.forEach((hook) => {',
                '    if (typeof hook === "function") {',
                '      hook(payload);',
                '    }',
                '  });',
                '}',
                '',
                'function applyNodePollErrorHooks(error) {',
                '  NODE_POLL_ERROR_HOOKS.forEach((hook) => {',
                '    if (typeof hook === "function") {',
                '      hook(error);',
                '    }',
                '  });',
                '}',
                '',
                'const NODE_KIND_UPDATE_HANDLERS = {',
                ...nodeClientSections.updateDispatchEntries.map(
                    (entry) => `  "${entry.nodeKind}": ${entry.handlerName},`
                ),
                '};',
                '',
                'function applyUpdateEntry(entry) {',
                '  if (!entry || typeof entry !== "object") {',
                '    return false;',
                '  }',
                '  const elementId = typeof entry.elementId === "string" ? entry.elementId.trim() : "";',
                '  if (!elementId) {',
                '    return false;',
                '  }',
                '  const targetElement = document.getElementById(elementId);',
                '  if (!targetElement) {',
                '    return false;',
                '  }',
                '  const kind = typeof entry.kind === "string" ? entry.kind.trim() : "";',
                '  const handler = NODE_KIND_UPDATE_HANDLERS[kind];',
                '  if (typeof handler !== "function") {',
                '    return false;',
                '  }',
                '  return handler(targetElement, entry);',
                '}',
                '',
                'function applyUpdateList(updates) {',
                '  if (!Array.isArray(updates) || updates.length === 0) {',
                '    return 0;',
                '  }',
                '  let appliedCount = 0;',
                '  const wvPerfListStartedAt = wvPerfNow();',
                '  updates.forEach((entry) => {',
                '    const wvPerfEntryStartedAt = wvPerfNow();',
                '    const applied = applyUpdateEntry(entry);',
                '    const wvPerfKind =',
                '      entry && typeof entry.kind === "string" && entry.kind ? entry.kind : "unknown";',
                '    wvPerfRecord(`apply:${wvPerfKind}`, wvPerfNow() - wvPerfEntryStartedAt);',
                '    if (applied) {',
                '      appliedCount += 1;',
                '    }',
                '  });',
                '  wvPerfRecord("apply:list", wvPerfNow() - wvPerfListStartedAt);',
                '  return appliedCount;',
                '}',
                '',
                'function applyRefreshErrorState(errorMessage) {',
                '  const message = typeof errorMessage === "string" ? errorMessage.trim() : "";',
                '  if (typeof document === "undefined" || typeof document.getElementById !== "function") {',
                '    return;',
                '  }',
                '  let bannerElement = document.getElementById("wv-refresh-error-banner");',
                '  if (!bannerElement) {',
                '    bannerElement = document.createElement("div");',
                '    bannerElement.id = "wv-refresh-error-banner";',
                '    bannerElement.setAttribute("role", "alert");',
                '    bannerElement.style.position = "fixed";',
                '    bannerElement.style.left = "0";',
                '    bannerElement.style.right = "0";',
                '    bannerElement.style.top = "0";',
                '    bannerElement.style.zIndex = "2147483647";',
                '    bannerElement.style.padding = "10px 12px";',
                '    bannerElement.style.background = "#7b1d1d";',
                '    bannerElement.style.color = "#ffffff";',
                '    bannerElement.style.fontFamily = "monospace";',
                '    bannerElement.style.fontSize = "12px";',
                '    bannerElement.style.whiteSpace = "pre-wrap";',
                '    if (document.body) {',
                '      document.body.appendChild(bannerElement);',
                '    }',
                '  }',
                '  if (!message) {',
                '    bannerElement.style.display = "none";',
                '    bannerElement.textContent = "";',
                '    if (rootElement) {',
                '      rootElement.removeAttribute("data-refresh-error");',
                '    }',
                '    return;',
                '  }',
                '  bannerElement.style.display = "block";',
                '  bannerElement.textContent = `Webview refresh error: ${message}`;',
                '  if (rootElement) {',
                '    rootElement.setAttribute("data-refresh-error", message);',
                '    rootElement.setAttribute("data-refresh-state", "error");',
                '  }',
                '}',
                '',
                'function applyRefreshPayload(payload) {',
                '  if (!rootElement || !payload || typeof payload !== "object") {',
                '    return;',
                '  }',
                '  const refreshError = typeof payload.error === "string" ? payload.error.trim() : "";',
                '  applyRefreshErrorState(refreshError);',
                '  if (refreshError) {',
                '    return;',
                '  }',
                '  if (typeof payload.html === "string") {',
                '    const wvPerfHtmlStartedAt = wvPerfNow();',
                '    rootElement.innerHTML = payload.html;',
                '    runNodeClientInitHooks();',
                '    wvPerfRecord("apply:html", wvPerfNow() - wvPerfHtmlStartedAt);',
                '    return;',
                '  }',
                '  if (Array.isArray(payload.updates) && payload.updates.length > 0) {',
                '    applyUpdateList(payload.updates);',
                '  }',
                '  runNodeClientInitHooks();',
                '}',
                '',
                'let refreshInFlight = false;',
                'let refreshSkipCount = 0;',
                'let refreshSeq = 0;',
                'let hasRequestedInitialSync = false;',
                '',
                'async function pollRefresh() {',
                '  if (typeof document !== "undefined" && document.hidden) {',
                '    wvPerfStats.hiddenSkips += 1;',
                '    return;',
                '  }',
                '  if (refreshInFlight) {',
                '    refreshSkipCount += 1;',
                '    wvPerfStats.skipped += 1;',
                '    if (WV_PERF_LOG && (refreshSkipCount <= 5 || refreshSkipCount % 25 === 0)) {',
                '      wvPerfLog(`skip #${refreshSkipCount} request #${refreshSeq} still in-flight`);',
                '    }',
                '    if (typeof window !== "undefined" && window.__wvDebug === true && (refreshSkipCount % 20) === 0) {',
                '      console.warn("Webview refresh skipped (in-flight)", { refreshSkipCount });',
                '    }',
                '    return;',
                '  }',
                '  refreshInFlight = true;',
                '  refreshSeq += 1;',
                '  const requestId = refreshSeq;',
                '  const startedAt = Date.now();',
                '  const wvPerfPollStartedAt = wvPerfNow();',
                '  const wvPerfGapMs =',
                '    wvPerfStats.lastPollStartAt === null ? null : wvPerfPollStartedAt - wvPerfStats.lastPollStartAt;',
                '  wvPerfStats.lastPollStartAt = wvPerfPollStartedAt;',
                '  wvPerfStats.polls += 1;',
                '  try {',
                '    const requestPayload = {};',
                '    if (!hasRequestedInitialSync) {',
                '      requestPayload.initialSync = true;',
                '      hasRequestedInitialSync = true;',
                '    }',
                '    applyNodePollRequestHooks(requestPayload);',
                '    const response = await postRefreshWithTimeout(requestPayload);',
                '    const wvPerfResponseAt = wvPerfNow();',
                '    if (!response.ok) {',
                '      throw new Error(`Refresh HTTP ${response.status}`);',
                '    }',
                '    const payloadText = response.bodyText;',
                '    const wvPerfBodyAt = wvPerfNow();',
                '    let payload = null;',
                '    try {',
                '      payload = JSON.parse(payloadText);',
                '    } catch (parseError) {',
                '      const payloadSnippet = typeof payloadText === "string" ? payloadText.slice(0, 200) : "";',
                '      throw new Error(',
                '        `Refresh payload JSON parse failed (status ${response.status}): ${payloadSnippet}`',
                '      );',
                '    }',
                '    const wvPerfApplyStartedAt = wvPerfNow();',
                '    applyRefreshPayload(payload);',
                '    applyNodePollSuccessHooks(payload);',
                '    const wvPerfDoneAt = wvPerfNow();',
                '    const wvPerfUpdateCount = Array.isArray(payload?.updates) ? payload.updates.length : 0;',
                '    wvPerfStats.received += 1;',
                '    wvPerfStats.updates += wvPerfUpdateCount;',
                '    if (wvPerfUpdateCount === 0 && !(typeof payload?.html === "string")) {',
                '      wvPerfStats.emptyReceives += 1;',
                '    }',
                '    wvPerfRecordInterval(wvPerfGapMs);',
                '    wvPerfRecord("poll:request", wvPerfResponseAt - wvPerfPollStartedAt);',
                '    wvPerfRecord("poll:body", wvPerfBodyAt - wvPerfResponseAt);',
                '    wvPerfRecord("poll:apply", wvPerfDoneAt - wvPerfApplyStartedAt);',
                '    wvPerfRecord("poll:total", wvPerfDoneAt - wvPerfPollStartedAt);',
                '    const wvPerfElapsedMs = wvPerfDoneAt - wvPerfPollStartedAt;',
                '    lastRefreshDurationMs = wvPerfElapsedMs;',
                '    if (wvPerfElapsedMs > REFRESH_SLOW_THRESHOLD_MS) {',
                '      refreshSlowStreak = Math.min(refreshSlowStreak + 1, 4);',
                '    } else {',
                '      refreshSlowStreak = 0;',
                '    }',
                '    wvPerfLog(',
                '      `recv #${requestId} gap=${wvPerfFormatMs(wvPerfGapMs)}`,',
                '      `req=${wvPerfFormatMs(wvPerfResponseAt - wvPerfPollStartedAt)}`,',
                '      `body=${wvPerfFormatMs(wvPerfBodyAt - wvPerfResponseAt)}`,',
                '      `apply=${wvPerfFormatMs(wvPerfDoneAt - wvPerfApplyStartedAt)}`,',
                '      `bytes=${payloadText.length} updates=${wvPerfUpdateCount} interval=${REFRESH_INTERVAL_MS}`,',
                '      `streak=${refreshSlowStreak} next=${wvPerfFormatMs(nextRefreshDelayMs())}`',
                '    );',
                '    if (wvPerfStats.received % WV_PERF_REPORT_EVERY === 0) { wvPerfReport(); }',
                '    if (rootElement) {',
                '      if (!(typeof payload?.error === "string" && payload.error.trim())) {',
                '        rootElement.removeAttribute("data-refresh-state");',
                '      }',
                '    }',
                '    if (typeof window !== "undefined" && window.__wvDebug === true && (requestId % 20) === 0) {',
                '      console.info("Webview refresh ok", { requestId, elapsedMs: Date.now() - startedAt });',
                '    }',
                '  } catch (error) {',
                '    wvPerfStats.errors += 1;',
                '    wvPerfLog(',
                '      `recv #${requestId} ERROR gap=${wvPerfFormatMs(wvPerfGapMs)}`,',
                '      `req=${wvPerfFormatMs(wvPerfNow() - wvPerfPollStartedAt)}`,',
                '      `message=${error && error.message ? error.message : String(error)}`',
                '    );',
                '    applyNodePollErrorHooks(error);',
                '    refreshSlowStreak = Math.min(refreshSlowStreak + 1, 4);',
                '    applyRefreshErrorState(error && typeof error.message === "string" ? error.message : String(error));',
                '    if (rootElement) {',
                '      rootElement.setAttribute("data-refresh-state", "unavailable");',
                '    }',
                '    if (typeof console !== "undefined" && typeof console.warn === "function") {',
                '      console.warn("Webview refresh unavailable", { requestId, elapsedMs: Date.now() - startedAt, error });',
                '    }',
                '  } finally {',
                '    refreshInFlight = false;',
                '    lastRefreshDurationMs = wvPerfNow() - wvPerfPollStartedAt;',
                '    scheduleNextRefresh();',
                '  }',
                '}',
                '',
                ...buildRefreshSchedulerLines(),
                'runNodeClientInitHooks();',
                'void pollRefresh();',
                '',
            ];

            return composeClientScriptSections(scriptLines).join('\n');
        }

        const scriptLines = [
            '// Auto-generated minimal webview client',
            `const POST_REFRESH_ROUTE = ${routeLiteral};`,
            `const REFRESH_INTERVAL_MS = ${resolvedRefreshIntervalMs};`,
            'const rootElement = document.getElementById("otter-dom-root");',
            ...buildClientDiagnosticsLines(),
            'const navListElement = document.getElementById("wv-nav-list");',
            'const navToggleElement = document.getElementById("wv-nav-toggle");',
            'const DEFAULT_NAV_MODE = "collapsed";',
            'let activePageId = rootElement?.getAttribute("data-active-page-id") ?? "";',
            'let navMode = rootElement?.getAttribute("data-nav-mode") ?? DEFAULT_NAV_MODE;',
            '',
            'function normalizeHeadingLevel(rawLevel) {',
            '  const numeric = Number(rawLevel);',
            '  if (!Number.isFinite(numeric)) {',
            '    return 2;',
            '  }',
            '  const integerLevel = Math.floor(numeric);',
            '  if (integerLevel < 1) {',
            '    return 1;',
            '  }',
            '  if (integerLevel > 6) {',
            '    return 6;',
            '  }',
            '  return integerLevel;',
            '}',
            '',
            'function hasOwnProperty(value, key) {',
            '  return Object.prototype.hasOwnProperty.call(value, key);',
            '}',
            '',
            'function normalizeNavMode(rawMode) {',
            '  const mode = typeof rawMode === "string" ? rawMode.trim().toLowerCase() : "";',
            '  return mode === "expanded" ? "expanded" : "collapsed";',
            '}',
            '',
            'function applyNavMode(nextMode) {',
            '  if (!rootElement) {',
            '    return;',
            '  }',
            '  navMode = normalizeNavMode(nextMode);',
            '  rootElement.setAttribute("data-nav-mode", navMode);',
            '  const navShellElement = document.getElementById("wv-nav-shell");',
            '  if (navShellElement) {',
            '    navShellElement.setAttribute("data-nav-mode", navMode);',
            '    navShellElement.classList.toggle("is-nav-collapsed", navMode === "collapsed");',
            '    navShellElement.classList.toggle("is-nav-expanded", navMode === "expanded");',
            '  }',
            '  const nextToggleElement = document.getElementById("wv-nav-toggle");',
            '  if (nextToggleElement) {',
            '    nextToggleElement.setAttribute("aria-expanded", navMode === "expanded" ? "true" : "false");',
            '  }',
            '}',
            '',
            'function getPageScopes() {',
            '  if (!rootElement) {',
            '    return [];',
            '  }',
            '  return Array.from(rootElement.querySelectorAll(\'[data-wv-page-scope="true"]\'));',
            '}',
            '',
            'function resolveFallbackPageId(pageScopes) {',
            '  const rootPageId = rootElement?.getAttribute("data-root-page-id")?.trim() ?? "";',
            '  if (rootPageId) {',
            '    return rootPageId;',
            '  }',
            '  const firstPageScope = pageScopes.find((entry) => {',
            '    const pageId = entry.getAttribute("data-page-id")?.trim() ?? "";',
            '    return Boolean(pageId);',
            '  });',
            '  return firstPageScope?.getAttribute("data-page-id")?.trim() ?? "";',
            '}',
            '',
            'function applyPageState(nextPageId) {',
            '  if (!rootElement) {',
            '    return;',
            '  }',
            '  const pageScopes = getPageScopes();',
            '  if (pageScopes.length === 0) {',
            '    return;',
            '  }',
            '  const normalizedNextPageId = typeof nextPageId === "string" ? nextPageId.trim() : "";',
            '  const hasMatchingTarget = pageScopes.some((entry) => (entry.getAttribute("data-page-id")?.trim() ?? "") === normalizedNextPageId);',
            '  const resolvedPageId = hasMatchingTarget',
            '    ? normalizedNextPageId',
            '    : resolveFallbackPageId(pageScopes);',
            '  activePageId = resolvedPageId;',
            '  rootElement.setAttribute("data-active-page-id", resolvedPageId);',
            '  pageScopes.forEach((pageScope) => {',
            '    const pageId = pageScope.getAttribute("data-page-id")?.trim() ?? "";',
            '    const isActive = Boolean(resolvedPageId && pageId === resolvedPageId);',
            '    pageScope.classList.toggle("is-active", isActive);',
            '    pageScope.hidden = !isActive;',
            '    pageScope.setAttribute("aria-hidden", isActive ? "false" : "true");',
            '  });',
            '  const navButtons = Array.from(document.querySelectorAll("[data-wv-page-target]"));',
            '  navButtons.forEach((button) => {',
            '    const targetPageId = button.getAttribute("data-wv-page-target")?.trim() ?? "";',
            '    const isActive = Boolean(resolvedPageId && targetPageId === resolvedPageId);',
            '    button.classList.toggle("is-active", isActive);',
            '    button.setAttribute("aria-current", isActive ? "page" : "false");',
            '  });',
            '}',
            '',
            ...nodeClientSections.updateHandlers,
            '',
            ...nodeClientSections.helpers,
            '',
            ...nodeClientSections.pollHelpers,
            '',
            'function runNodeClientInitHooks() {',
            ...nodeClientSections.initHooks.map(
                (line) =>
                    `  try { ${line} } catch (error) { if (typeof console !== "undefined" && typeof console.warn === "function") { console.warn("Webview init hook failed", error); } }`
            ),
            '}',
            '',
            'const NODE_POLL_REQUEST_HOOKS = [',
            ...nodeClientSections.pollRequestHookEntries.map((entry) => `  ${entry.hookName},`),
            '];',
            'const NODE_POLL_SUCCESS_HOOKS = [',
            ...nodeClientSections.pollSuccessHookEntries.map((entry) => `  ${entry.hookName},`),
            '];',
            'const NODE_POLL_ERROR_HOOKS = [',
            ...nodeClientSections.pollErrorHookEntries.map((entry) => `  ${entry.hookName},`),
            '];',
            '',
            'function applyNodePollRequestHooks(requestPayload) {',
            '  NODE_POLL_REQUEST_HOOKS.forEach((hook) => {',
            '    if (typeof hook === "function") {',
            '      hook(requestPayload);',
            '    }',
            '  });',
            '}',
            '',
            'function applyNodePollSuccessHooks(payload) {',
            '  NODE_POLL_SUCCESS_HOOKS.forEach((hook) => {',
            '    if (typeof hook === "function") {',
            '      hook(payload);',
            '    }',
            '  });',
            '}',
            '',
            'function applyNodePollErrorHooks(error) {',
            '  NODE_POLL_ERROR_HOOKS.forEach((hook) => {',
            '    if (typeof hook === "function") {',
            '      hook(error);',
            '    }',
            '  });',
            '}',
            '',
            'const NODE_KIND_UPDATE_HANDLERS = {',
            ...nodeClientSections.updateDispatchEntries.map(
                (entry) => `  "${entry.nodeKind}": ${entry.handlerName},`
            ),
            '};',
            '',
            'function applyUpdateEntry(entry) {',
            '  if (!entry || typeof entry !== "object") {',
            '    return false;',
            '  }',
            '  const elementId = typeof entry.elementId === "string" ? entry.elementId.trim() : "";',
            '  if (!elementId) {',
            '    return false;',
            '  }',
            '  const targetElement = document.getElementById(elementId);',
            '  if (!targetElement) {',
            '    return false;',
            '  }',
            '  const kind = typeof entry.kind === "string" ? entry.kind.trim() : "";',
            '  const handler = NODE_KIND_UPDATE_HANDLERS[kind];',
            '  if (typeof handler !== "function") {',
            '    return false;',
            '  }',
            '  return handler(targetElement, entry);',
            '}',
            '',
            'function applyUpdateList(updates) {',
            '  if (!Array.isArray(updates) || updates.length === 0) {',
            '    return 0;',
            '  }',
            '  let appliedCount = 0;',
            '  const wvPerfListStartedAt = wvPerfNow();',
            '  updates.forEach((entry) => {',
            '    const wvPerfEntryStartedAt = wvPerfNow();',
            '    const applied = applyUpdateEntry(entry);',
            '    const wvPerfKind =',
            '      entry && typeof entry.kind === "string" && entry.kind ? entry.kind : "unknown";',
            '    wvPerfRecord(`apply:${wvPerfKind}`, wvPerfNow() - wvPerfEntryStartedAt);',
            '    if (applied) {',
            '      appliedCount += 1;',
            '    }',
            '  });',
            '  wvPerfRecord("apply:list", wvPerfNow() - wvPerfListStartedAt);',
            '  return appliedCount;',
            '}',
            '',
            'function applyRefreshErrorState(errorMessage) {',
            '  const message = typeof errorMessage === "string" ? errorMessage.trim() : "";',
            '  if (typeof document === "undefined" || typeof document.getElementById !== "function") {',
            '    return;',
            '  }',
            '  let bannerElement = document.getElementById("wv-refresh-error-banner");',
            '  if (!bannerElement) {',
            '    bannerElement = document.createElement("div");',
            '    bannerElement.id = "wv-refresh-error-banner";',
            '    bannerElement.setAttribute("role", "alert");',
            '    bannerElement.style.position = "fixed";',
            '    bannerElement.style.left = "0";',
            '    bannerElement.style.right = "0";',
            '    bannerElement.style.top = "0";',
            '    bannerElement.style.zIndex = "2147483647";',
            '    bannerElement.style.padding = "10px 12px";',
            '    bannerElement.style.background = "#7b1d1d";',
            '    bannerElement.style.color = "#ffffff";',
            '    bannerElement.style.fontFamily = "monospace";',
            '    bannerElement.style.fontSize = "12px";',
            '    bannerElement.style.whiteSpace = "pre-wrap";',
            '    if (document.body) {',
            '      document.body.appendChild(bannerElement);',
            '    }',
            '  }',
            '  if (!message) {',
            '    bannerElement.style.display = "none";',
            '    bannerElement.textContent = "";',
            '    if (rootElement) {',
            '      rootElement.removeAttribute("data-refresh-error");',
            '    }',
            '    return;',
            '  }',
            '  bannerElement.style.display = "block";',
            '  bannerElement.textContent = `Webview refresh error: ${message}`;',
            '  if (rootElement) {',
            '    rootElement.setAttribute("data-refresh-error", message);',
            '    rootElement.setAttribute("data-refresh-state", "error");',
            '  }',
            '}',
            '',
            'function applyRefreshPayload(payload) {',
            '  if (!rootElement || !payload || typeof payload !== "object") {',
            '    return;',
            '  }',
            '  const refreshError = typeof payload.error === "string" ? payload.error.trim() : "";',
            '  applyRefreshErrorState(refreshError);',
            '  if (refreshError) {',
            '    return;',
            '  }',
            '  if (typeof payload.html === "string") {',
            '    const wvPerfHtmlStartedAt = wvPerfNow();',
            '    rootElement.innerHTML = payload.html;',
            '    applyNavMode(navMode);',
            '    applyPageState(activePageId);',
            '    runNodeClientInitHooks();',
            '    wvPerfRecord("apply:html", wvPerfNow() - wvPerfHtmlStartedAt);',
            '    return;',
            '  }',
            '  if (Array.isArray(payload.updates) && payload.updates.length > 0) {',
            '    applyUpdateList(payload.updates);',
            '  }',
            '  applyPageState(activePageId);',
            '  runNodeClientInitHooks();',
            '}',
            '',
            'let refreshInFlight = false;',
            'let refreshSkipCount = 0;',
            'let refreshSeq = 0;',
            'let hasRequestedInitialSync = false;',
            '',
            'async function pollRefresh() {',
            '  if (typeof document !== "undefined" && document.hidden) {',
            '    wvPerfStats.hiddenSkips += 1;',
            '    return;',
            '  }',
            '  if (refreshInFlight) {',
            '    refreshSkipCount += 1;',
            '    wvPerfStats.skipped += 1;',
            '    if (WV_PERF_LOG && (refreshSkipCount <= 5 || refreshSkipCount % 25 === 0)) {',
            '      wvPerfLog(`skip #${refreshSkipCount} request #${refreshSeq} still in-flight`);',
            '    }',
            '    if (typeof window !== "undefined" && window.__wvDebug === true && (refreshSkipCount % 20) === 0) {',
            '      console.warn("Webview refresh skipped (in-flight)", { refreshSkipCount });',
            '    }',
            '    return;',
            '  }',
            '  refreshInFlight = true;',
            '  refreshSeq += 1;',
            '  const requestId = refreshSeq;',
            '  const startedAt = Date.now();',
            '  const wvPerfPollStartedAt = wvPerfNow();',
            '  const wvPerfGapMs =',
            '    wvPerfStats.lastPollStartAt === null ? null : wvPerfPollStartedAt - wvPerfStats.lastPollStartAt;',
            '  wvPerfStats.lastPollStartAt = wvPerfPollStartedAt;',
            '  wvPerfStats.polls += 1;',
            '  try {',
            '    const requestPayload = { activePageId };',
            '    if (!hasRequestedInitialSync) {',
            '      requestPayload.initialSync = true;',
            '      hasRequestedInitialSync = true;',
            '    }',
            '    applyNodePollRequestHooks(requestPayload);',
            '    const response = await postRefreshWithTimeout(requestPayload);',
            '    const wvPerfResponseAt = wvPerfNow();',
            '    if (!response.ok) {',
            '      throw new Error(`Refresh HTTP ${response.status}`);',
            '    }',
            '    const payloadText = response.bodyText;',
            '    const wvPerfBodyAt = wvPerfNow();',
            '    let payload = null;',
            '    try {',
            '      payload = JSON.parse(payloadText);',
            '    } catch (parseError) {',
            '      const payloadSnippet = typeof payloadText === "string" ? payloadText.slice(0, 200) : "";',
            '      throw new Error(',
            '        `Refresh payload JSON parse failed (status ${response.status}): ${payloadSnippet}`',
            '      );',
            '    }',
            '    const wvPerfApplyStartedAt = wvPerfNow();',
            '    applyRefreshPayload(payload);',
            '    applyNodePollSuccessHooks(payload);',
            '    const wvPerfDoneAt = wvPerfNow();',
            '    const wvPerfUpdateCount = Array.isArray(payload?.updates) ? payload.updates.length : 0;',
            '    wvPerfStats.received += 1;',
            '    wvPerfStats.updates += wvPerfUpdateCount;',
            '    if (wvPerfUpdateCount === 0 && !(typeof payload?.html === "string")) {',
            '      wvPerfStats.emptyReceives += 1;',
            '    }',
            '    wvPerfRecordInterval(wvPerfGapMs);',
            '    wvPerfRecord("poll:request", wvPerfResponseAt - wvPerfPollStartedAt);',
            '    wvPerfRecord("poll:body", wvPerfBodyAt - wvPerfResponseAt);',
            '    wvPerfRecord("poll:apply", wvPerfDoneAt - wvPerfApplyStartedAt);',
            '    wvPerfRecord("poll:total", wvPerfDoneAt - wvPerfPollStartedAt);',
            '    const wvPerfElapsedMs = wvPerfDoneAt - wvPerfPollStartedAt;',
            '    lastRefreshDurationMs = wvPerfElapsedMs;',
            '    if (wvPerfElapsedMs > REFRESH_SLOW_THRESHOLD_MS) {',
            '      refreshSlowStreak = Math.min(refreshSlowStreak + 1, 4);',
            '    } else {',
            '      refreshSlowStreak = 0;',
            '    }',
            '    wvPerfLog(',
            '      `recv #${requestId} page=${activePageId || "-"} gap=${wvPerfFormatMs(wvPerfGapMs)}`,',
            '      `req=${wvPerfFormatMs(wvPerfResponseAt - wvPerfPollStartedAt)}`,',
            '      `body=${wvPerfFormatMs(wvPerfBodyAt - wvPerfResponseAt)}`,',
            '      `apply=${wvPerfFormatMs(wvPerfDoneAt - wvPerfApplyStartedAt)}`,',
            '      `bytes=${payloadText.length} updates=${wvPerfUpdateCount} interval=${REFRESH_INTERVAL_MS}`,',
            '      `streak=${refreshSlowStreak} next=${wvPerfFormatMs(nextRefreshDelayMs())}`',
            '    );',
            '    if (wvPerfStats.received % WV_PERF_REPORT_EVERY === 0) { wvPerfReport(); }',
            '    if (rootElement) {',
            '      if (!(typeof payload?.error === "string" && payload.error.trim())) {',
            '        rootElement.removeAttribute("data-refresh-state");',
            '      }',
            '    }',
            '    if (typeof window !== "undefined" && window.__wvDebug === true && (requestId % 20) === 0) {',
            '      console.info("Webview refresh ok", { requestId, elapsedMs: Date.now() - startedAt, activePageId });',
            '    }',
            '  } catch (error) {',
            '    wvPerfStats.errors += 1;',
            '    wvPerfLog(',
            '      `recv #${requestId} ERROR page=${activePageId || "-"} gap=${wvPerfFormatMs(wvPerfGapMs)}`,',
            '      `req=${wvPerfFormatMs(wvPerfNow() - wvPerfPollStartedAt)}`,',
            '      `message=${error && error.message ? error.message : String(error)}`',
            '    );',
            '    applyNodePollErrorHooks(error);',
                '    refreshSlowStreak = Math.min(refreshSlowStreak + 1, 4);',
            '    applyRefreshErrorState(error && typeof error.message === "string" ? error.message : String(error));',
            '    if (rootElement) {',
            '      rootElement.setAttribute("data-refresh-state", "unavailable");',
            '    }',
            '    if (typeof console !== "undefined" && typeof console.warn === "function") {',
            '      console.warn("Webview refresh unavailable", { requestId, elapsedMs: Date.now() - startedAt, activePageId, error });',
            '    }',
            '  } finally {',
            '    refreshInFlight = false;',
            '    lastRefreshDurationMs = wvPerfNow() - wvPerfPollStartedAt;',
            '    scheduleNextRefresh();',
            '  }',
            '}',
            '',
            'if (navListElement) {',
            '  navListElement.addEventListener("click", (event) => {',
            '    const button = event.target instanceof Element',
            '      ? event.target.closest("[data-wv-page-target]")',
            '      : null;',
            '    if (!button) {',
            '      return;',
            '    }',
            '    const targetPageId = button.getAttribute("data-wv-page-target")?.trim() ?? "";',
            '    applyPageState(targetPageId);',
            '  });',
            '}',
            'if (navToggleElement) {',
            '  navToggleElement.addEventListener("click", () => {',
            '    applyNavMode(navMode === "expanded" ? "collapsed" : "expanded");',
            '  });',
            '}',
            'applyNavMode(navMode);',
            'applyPageState(activePageId);',
            'runNodeClientInitHooks();',
            '',
            ...buildRefreshSchedulerLines(),
            'void pollRefresh();',
            '',
        ];

        return composeClientScriptSections(scriptLines).join('\n');
    }

    function awaitWithTimeout(promise, timeoutMs) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('timeout')), timeoutMs);
            }),
        ]);
    }

    async function gzipUtf8Content(content) {
        if (
            typeof CompressionStream !== 'function' ||
            typeof TextEncoder !== 'function' ||
            typeof Response !== 'function'
        ) {
            debugLog('gzip-skip-missing-platform-api');
            return null;
        }

        try {
            const text = typeof content === 'string' ? content : String(content ?? '');
            const inputBytes = new TextEncoder().encode(text);
            debugLog('gzip-start', { inputBytes: inputBytes.length });

            const compressionStream = new CompressionStream('gzip');
            const compressedBufferPromise = awaitWithTimeout(
                new Response(compressionStream.readable).arrayBuffer(),
                2000
            );
            const writer = compressionStream.writable.getWriter();

            await awaitWithTimeout(writer.write(inputBytes), 2000);
            await awaitWithTimeout(writer.close(), 2000);

            const compressedBuffer = await compressedBufferPromise;

            debugLog('gzip-complete', {
                inputBytes: inputBytes.length,
                compressedBytes: compressedBuffer?.byteLength || 0,
            });

            return new Uint8Array(compressedBuffer);
        } catch (error) {
            debugLog('gzip-failed-fallback-identity', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    function buildCompressedAssetLookup(staticRoutes) {
        const lookup = new Map();

        if (!Array.isArray(staticRoutes)) {
            return lookup;
        }

        staticRoutes.forEach((routeSpec) => {
            if (!routeSpec || typeof routeSpec !== 'object') {
                return;
            }

            const compressedPath =
                typeof routeSpec.compressedPath === 'string' ? routeSpec.compressedPath.trim() : '';
            const fallbackPath =
                typeof routeSpec.fallbackPath === 'string' ? routeSpec.fallbackPath.trim() : '';

            if (!compressedPath || !fallbackPath) {
                return;
            }

            lookup.set(fallbackPath, compressedPath);
        });

        return lookup;
    }

    async function buildCompressedAssets(identityArtifacts, staticRoutes) {
        const compressedPathByFallbackPath = buildCompressedAssetLookup(staticRoutes);
        const compressedArtifacts = [];

        debugLog('build-compressed-assets-start', {
            identityArtifactCount: Array.isArray(identityArtifacts) ? identityArtifacts.length : 0,
            routeCount: Array.isArray(staticRoutes) ? staticRoutes.length : 0,
        });

        for (const artifact of identityArtifacts) {
            const targetPath =
                typeof artifact?.targetPath === 'string' ? artifact.targetPath.trim() : '';
            if (!targetPath) {
                continue;
            }

            const compressedPath = compressedPathByFallbackPath.get(targetPath);
            if (!compressedPath) {
                continue;
            }

            const compressedContent = await gzipUtf8Content(artifact.content);
            if (!(compressedContent instanceof Uint8Array)) {
                debugLog('build-compressed-assets-skip', {
                    targetPath,
                    reason: 'compression-unavailable-or-failed',
                });
                continue;
            }

            compressedArtifacts.push({
                targetPath: compressedPath,
                content: compressedContent,
                contentType: artifact.contentType,
                contentEncoding: 'gzip',
                role: artifact.role,
            });

            debugLog('build-compressed-assets-entry', {
                sourcePath: targetPath,
                compressedPath,
                bytes: compressedContent.length,
            });
        }

        debugLog('build-compressed-assets-complete', {
            compressedArtifactCount: compressedArtifacts.length,
        });

        return compressedArtifacts;
    }

    function buildPythonStaticRoutesLiteral(staticRoutes) {
        if (!Array.isArray(staticRoutes) || staticRoutes.length === 0) {
            return ['[]'];
        }

        const lines = ['['];
        staticRoutes.forEach((routeSpec) => {
            const compressedPathLiteral =
                typeof routeSpec.compressedPath === 'string' && routeSpec.compressedPath.trim()
                    ? JSON.stringify(routeSpec.compressedPath)
                    : 'None';
            const fallbackPathLiteral =
                typeof routeSpec.fallbackPath === 'string' && routeSpec.fallbackPath.trim()
                    ? JSON.stringify(routeSpec.fallbackPath)
                    : 'None';
            lines.push('    {');
            lines.push(`        'route': ${JSON.stringify(routeSpec.route)},`);
            lines.push(`        'content_type': ${JSON.stringify(routeSpec.contentType)},`);
            lines.push(`        'fallback_path': ${fallbackPathLiteral},`);
            lines.push(`        'compressed_path': ${compressedPathLiteral},`);
            lines.push(
                `        'force_compressed_only': ${routeSpec.forceCompressedOnly ? 'True' : 'False'},`
            );
            lines.push(
                `        'is_binary_fallback': ${routeSpec.isBinaryFallback ? 'True' : 'False'},`
            );
            lines.push('    },');
        });
        lines.push(']');
        return lines;
    }

    function buildRefreshBindingSpecs(layoutModel, options = {}) {
        const enableMultiPageContract = options?.enableMultiPageContract !== false;
        const elements =
            layoutModel?.elements && typeof layoutModel.elements === 'object'
                ? layoutModel.elements
                : {};

        const entries = Object.keys(elements)
            .sort((a, b) => a.localeCompare(b))
            .map((key) => elements[key])
            .filter((element) => element && typeof element === 'object')
            .map((element) => {
                const binding =
                    element.binding && typeof element.binding === 'object' ? element.binding : null;
                const payloadKey =
                    typeof binding?.payloadKey === 'string' ? binding.payloadKey.trim() : '';
                const elementId =
                    typeof binding?.elementId === 'string' ? binding.elementId.trim() : '';
                const kind = getNodeKindFromElement(element);
                const nodeId =
                    typeof element.nodeId === 'string' && element.nodeId.trim()
                        ? element.nodeId.trim()
                        : 'unknown';
                const pageId =
                    enableMultiPageContract &&
                    typeof element.ownerPageId === 'string' &&
                    element.ownerPageId.trim()
                        ? element.ownerPageId.trim()
                        : null;

                if (!payloadKey || !elementId) {
                    return null;
                }

                if (
                    kind !== 'content' &&
                    kind !== 'value-table' &&
                    kind !== 'radar-display' &&
                    kind !== 'joystick-display' &&
                    kind !== 'graph-display' &&
                    kind !== 'title-content' &&
                    kind !== 'web-view-number-input' &&
                    kind !== 'web-view-string-input' &&
                    kind !== 'web-view-slider' &&
                    kind !== 'web-view-checkbox' &&
                    kind !== 'web-view-select'
                ) {
                    return null;
                }

                return {
                    payloadKey,
                    elementId,
                    kind,
                    nodeId,
                    pageId,
                };
            })
            .filter(Boolean);

        const dedupedByPayloadKey = new Map();
        entries.forEach((entry) => {
            if (!dedupedByPayloadKey.has(entry.payloadKey)) {
                dedupedByPayloadKey.set(entry.payloadKey, entry);
            }
        });

        return Array.from(dedupedByPayloadKey.values()).sort((a, b) =>
            a.payloadKey.localeCompare(b.payloadKey)
        );
    }

    function buildPythonRefreshBindingsLiteral(bindingEntries) {
        if (!Array.isArray(bindingEntries) || bindingEntries.length === 0) {
            return ['{}'];
        }

        const lines = ['{'];
        bindingEntries.forEach((entry) => {
            const pageIdLiteral =
                typeof entry.pageId === 'string' && entry.pageId.trim()
                    ? JSON.stringify(entry.pageId)
                    : 'None';
            lines.push(`    ${JSON.stringify(entry.payloadKey)}: {`);
            lines.push(`        'element_id': ${JSON.stringify(entry.elementId)},`);
            lines.push(`        'kind': ${JSON.stringify(entry.kind)},`);
            lines.push(`        'node_id': ${JSON.stringify(entry.nodeId)},`);
            lines.push(`        'page_id': ${pageIdLiteral},`);
            lines.push('    },');
        });
        lines.push('}');
        return lines;
    }

    function buildPythonStringListLiteral(values) {
        if (!Array.isArray(values) || values.length === 0) {
            return ['[]'];
        }

        const lines = ['['];
        values.forEach((value) => {
            lines.push(`    ${JSON.stringify(value)},`);
        });
        lines.push(']');
        return lines;
    }

    function buildPythonExpressionListLiteral(values) {
        if (!Array.isArray(values) || values.length === 0) {
            return ['[]'];
        }

        const lines = ['['];
        values.forEach((value) => {
            lines.push(`    ${value},`);
        });
        lines.push(']');
        return lines;
    }

    function resolvePostRefreshRequestHandling(nodeEntries) {
        if (!Array.isArray(nodeEntries) || nodeEntries.length === 0) {
            return {
                importLines: [],
                normalizerExpressions: [],
            };
        }

        const importLines = [];
        const importLineSet = new Set();
        const normalizerExpressions = [];
        const normalizerExpressionSet = new Set();

        nodeEntries.forEach((nodeEntry) => {
            const nodeKind = typeof nodeEntry?.kind === 'string' ? nodeEntry.kind.trim() : '';
            if (!nodeKind) {
                return;
            }

            const implementation = getNodeKindImplementation(nodeKind);
            if (!implementation) {
                return;
            }

            const context = {
                nodeKind,
                node: nodeEntry,
                controls:
                    nodeEntry?.controls && typeof nodeEntry.controls === 'object'
                        ? nodeEntry.controls
                        : {},
                graphId:
                    typeof nodeEntry?.graphId === 'string' && nodeEntry.graphId.trim()
                        ? nodeEntry.graphId.trim()
                        : null,
                scopedNodeId:
                    typeof nodeEntry?.scopedId === 'string' && nodeEntry.scopedId.trim()
                        ? nodeEntry.scopedId.trim()
                        : null,
            };

            if (typeof implementation.getRefreshHookImports === 'function') {
                const contribution = implementation.getRefreshHookImports(context);
                if (Array.isArray(contribution)) {
                    contribution.forEach((rawLine) => {
                        const line = typeof rawLine === 'string' ? rawLine.trimEnd() : '';
                        if (!line || importLineSet.has(line)) {
                            return;
                        }
                        importLineSet.add(line);
                        importLines.push(line);
                    });
                }
            }

            if (typeof implementation.getRefreshRequestValueNormalizers === 'function') {
                const contribution = implementation.getRefreshRequestValueNormalizers(context);
                if (Array.isArray(contribution)) {
                    contribution.forEach((rawExpression) => {
                        const expression =
                            typeof rawExpression === 'string' ? rawExpression.trim() : '';
                        if (!expression || normalizerExpressionSet.has(expression)) {
                            return;
                        }
                        normalizerExpressionSet.add(expression);
                        normalizerExpressions.push(expression);
                    });
                }
            }
        });

        return {
            importLines,
            normalizerExpressions,
        };
    }

    function resolveRefreshTransientKeyPrefixes(nodeEntries) {
        if (!Array.isArray(nodeEntries) || nodeEntries.length === 0) {
            return [];
        }

        const prefixes = new Set();
        nodeEntries.forEach((nodeEntry) => {
            const nodeKind = typeof nodeEntry?.kind === 'string' ? nodeEntry.kind.trim() : '';
            if (!nodeKind) {
                return;
            }

            const implementation = getNodeKindImplementation(nodeKind);
            if (
                !implementation ||
                typeof implementation.getRefreshTransientKeyPrefixes !== 'function'
            ) {
                return;
            }

            const contribution = implementation.getRefreshTransientKeyPrefixes({
                nodeKind,
                node: nodeEntry,
                controls:
                    nodeEntry?.controls && typeof nodeEntry.controls === 'object'
                        ? nodeEntry.controls
                        : {},
                graphId:
                    typeof nodeEntry?.graphId === 'string' && nodeEntry.graphId.trim()
                        ? nodeEntry.graphId.trim()
                        : null,
                scopedNodeId:
                    typeof nodeEntry?.scopedId === 'string' && nodeEntry.scopedId.trim()
                        ? nodeEntry.scopedId.trim()
                        : null,
            });

            if (!Array.isArray(contribution)) {
                return;
            }

            contribution.forEach((rawPrefix) => {
                const prefix = typeof rawPrefix === 'string' ? rawPrefix.trim() : '';
                if (!prefix) {
                    return;
                }
                prefixes.add(prefix);
            });
        });

        return Array.from(prefixes).sort((a, b) => a.localeCompare(b));
    }

    function buildWebserverHookModuleSource(
        postRefreshRoute,
        staticRoutes,
        refreshBindingEntries,
        transientKeyPrefixes,
        postRefreshRequestHandling
    ) {
        const routeLiteral = JSON.stringify(postRefreshRoute || POST_REFRESH_ROUTE);
        const staticRouteLines = buildPythonStaticRoutesLiteral(staticRoutes);
        const refreshBindingLines = buildPythonRefreshBindingsLiteral(refreshBindingEntries);
        const transientPrefixLines = buildPythonStringListLiteral(transientKeyPrefixes);
        const requestHandling =
            postRefreshRequestHandling && typeof postRefreshRequestHandling === 'object'
                ? postRefreshRequestHandling
                : {};
        const requestImportLines = Array.isArray(requestHandling.importLines)
            ? requestHandling.importLines.slice()
            : [];
        const requestNormalizerExpressionLines = buildPythonExpressionListLiteral(
            Array.isArray(requestHandling.normalizerExpressions)
                ? requestHandling.normalizerExpressions
                : []
        );
        const firstStaticRouteLine = staticRouteLines[0] || '[]';
        const remainingStaticRouteLines = staticRouteLines.slice(1);
        const firstRefreshBindingLine = refreshBindingLines[0] || '{}';
        const remainingRefreshBindingLines = refreshBindingLines.slice(1);
        const firstTransientPrefixLine = transientPrefixLines[0] || '[]';
        const remainingTransientPrefixLines = transientPrefixLines.slice(1);
        const firstRequestNormalizerLine = requestNormalizerExpressionLines[0] || '[]';
        const remainingRequestNormalizerLines = requestNormalizerExpressionLines.slice(1);
        return [
            '# Auto-generated webview hook module',
            '# Generated by webview helper handoff consumer',
            '',
            'from otter_webview.refresh_hook import (',
            '    handle_post_webview_refresh as _handle_post_webview_refresh,',
            '    register_extra_routes as _register_extra_routes,',
            ')',
            'from micropython import const',
            ...requestImportLines,
            '',
            `POST_REFRESH_ROUTE = ${routeLiteral}`,
            `STATIC_ROUTES = ${firstStaticRouteLine}`,
            ...remainingStaticRouteLines,
            `REFRESH_BINDINGS = ${firstRefreshBindingLine}`,
            ...remainingRefreshBindingLines,
            `TRANSIENT_VALUE_KEY_PREFIXES = ${firstTransientPrefixLine}`,
            ...remainingTransientPrefixLines,
            `REQUEST_VALUE_NORMALIZERS = ${firstRequestNormalizerLine}`,
            ...remainingRequestNormalizerLines,
            // TEMP(graph-debug): hook logging is forced on while the Line Graph
            // data line is missing. Restore const(0) to silence it again.
            'WEBVIEW_DEBUG = const(0)',
            '',
            'def register_extra_routes(server, context):',
            '    return _register_extra_routes(',
            '        server=server,',
            '        context=context,',
            '        static_routes=STATIC_ROUTES,',
            '        debug_enabled=bool(WEBVIEW_DEBUG),',
            '    )',
            '',
            'async def handle_index(request, context):',
            '    del request',
            '    del context',
            '    return None',
            '',
            'async def handle_post_webview_refresh(request, context):',
            '    return await _handle_post_webview_refresh(',
            '        request=request,',
            '        context=context,',
            '        refresh_bindings=REFRESH_BINDINGS,',
            '        transient_key_prefixes=TRANSIENT_VALUE_KEY_PREFIXES,',
            '        request_value_normalizers=REQUEST_VALUE_NORMALIZERS,',
            '        post_refresh_route=POST_REFRESH_ROUTE,',
            '        debug_enabled=bool(WEBVIEW_DEBUG),',
            '    )',
        ].join('\n');
    }

    function registerWebRuntimeHelperHandoffConsumer() {
        globalScope.NodeHelperHandoffConsumers['web-runtime'] = async function (context) {
            const consumerStartedAt = Date.now();
            const group = context?.group && typeof context.group === 'object' ? context.group : {};
            const mergedData =
                group?.mergedData && typeof group.mergedData === 'object' ? group.mergedData : {};
            const webserverSpecPatch =
                group?.webserverSpecPatch && typeof group.webserverSpecPatch === 'object'
                    ? group.webserverSpecPatch
                    : {};

            const nodeEntries = normalizeMergedNodes(mergedData);
            const pageMode = resolvePageMode(nodeEntries);
            const enableMultiPageContract = pageMode === 'multi-page';
            const layoutModel = buildWebviewLayoutModel(nodeEntries);
            const refreshBindingEntries = buildRefreshBindingSpecs(layoutModel, {
                enableMultiPageContract,
            });
            const transientKeyPrefixes = resolveRefreshTransientKeyPrefixes(nodeEntries);
            const postRefreshRequestHandling = resolvePostRefreshRequestHandling(nodeEntries);
            const collection =
                context?.collection && typeof context.collection === 'object'
                    ? context.collection
                    : {};
            const explicitAssetMode =
                collection?.webAssetGenerationMode === 'plain' ||
                collection?.webAssetGenerationMode === 'compressed'
                    ? collection.webAssetGenerationMode
                    : null;
            const selectedAssetMode = explicitAssetMode;
            const effectiveWebserverSpecPatch = {
                ...webserverSpecPatch,
                disableCompressedAssets:
                    selectedAssetMode === 'plain'
                        ? true
                        : selectedAssetMode === 'compressed'
                          ? false
                          : webserverSpecPatch.disableCompressedAssets,
                compressedOnlyAssets:
                    selectedAssetMode === 'plain'
                        ? false
                        : selectedAssetMode === 'compressed'
                          ? true
                          : webserverSpecPatch.compressedOnlyAssets,
            };
            const collectionIdRaw =
                typeof collection.id === 'string' && collection.id.trim()
                    ? collection.id.trim()
                    : '';
            const collectionIdSegment = normalizePathSegment(collectionIdRaw || 'default');
            const postRefreshRoute =
                typeof effectiveWebserverSpecPatch.postRefreshRoute === 'string' &&
                effectiveWebserverSpecPatch.postRefreshRoute.trim()
                    ? effectiveWebserverSpecPatch.postRefreshRoute.trim()
                    : POST_REFRESH_ROUTE;
            const pageTitle = resolvePrimaryPageTitle(nodeEntries);
            const refreshIntervalMs = resolvePrimaryRefreshIntervalMs(nodeEntries);
            const staticRouteSpec = buildStaticRouteSpecs(
                collectionIdSegment,
                effectiveWebserverSpecPatch
            );
            const allStaticRoutes = [staticRouteSpec.indexRoute, ...staticRouteSpec.staticRoutes];

            debugLog('consumer-start', {
                collectionId: collectionIdRaw || null,
                nodeEntryCount: nodeEntries.length,
                pageMode,
                layoutElementCount: Object.keys(layoutModel.elements || {}).length,
                layoutDiagnosticCount: Array.isArray(layoutModel.diagnostics)
                    ? layoutModel.diagnostics.length
                    : 0,
                refreshBindingCount: refreshBindingEntries.length,
                transientKeyPrefixCount: transientKeyPrefixes.length,
                staticRouteCount: allStaticRoutes.length,
                needsWebDataStore: Boolean(effectiveWebserverSpecPatch.needsWebDataStore),
                requiresPostRefresh: Boolean(effectiveWebserverSpecPatch.requiresPostRefresh),
            });

            const webviewHtml = buildWebviewHtml(pageTitle, layoutModel, {
                enableMultiPageContract,
            });
            const webviewClientScript = buildWebviewClientScript(
                postRefreshRoute,
                refreshIntervalMs,
                {
                    enableMultiPageContract,
                }
            );
            const identityWebArtifacts = [
                {
                    targetPath: staticRouteSpec.indexRoute.fallbackPath,
                    content: webviewHtml,
                    contentType: 'text/html; charset=utf-8',
                    contentEncoding: 'identity',
                    role: 'web-html',
                },
                {
                    targetPath: staticRouteSpec.staticRoutes[0].fallbackPath,
                    content: webviewClientScript,
                    contentType: 'application/javascript',
                    contentEncoding: 'identity',
                    role: 'web-js',
                },
            ];

            const compressedWebArtifacts = await buildCompressedAssets(
                identityWebArtifacts,
                allStaticRoutes
            );
            const compressedArtifactPaths = new Set(
                compressedWebArtifacts
                    .map((artifact) =>
                        typeof artifact?.targetPath === 'string' ? artifact.targetPath.trim() : ''
                    )
                    .filter(Boolean)
            );
            const effectiveStaticRoutes = allStaticRoutes.map((routeSpec) => {
                const compressedPath =
                    typeof routeSpec?.compressedPath === 'string'
                        ? routeSpec.compressedPath.trim()
                        : '';
                if (compressedPath && compressedArtifactPaths.has(compressedPath)) {
                    if (routeSpec.forceCompressedOnly) {
                        return {
                            ...routeSpec,
                            fallbackPath: null,
                        };
                    }
                    return routeSpec;
                }

                return {
                    ...routeSpec,
                    compressedPath: null,
                    contentEncoding: null,
                    varyAcceptEncoding: false,
                    forceCompressedOnly: false,
                };
            });

            const routeByFallbackPath = new Map();
            allStaticRoutes.forEach((routeSpec) => {
                const fallbackPath =
                    typeof routeSpec?.fallbackPath === 'string'
                        ? routeSpec.fallbackPath.trim()
                        : '';
                if (fallbackPath) {
                    routeByFallbackPath.set(fallbackPath, routeSpec);
                }
            });
            const effectiveRouteByRoute = new Map();
            effectiveStaticRoutes.forEach((routeSpec) => {
                const routeKey = typeof routeSpec?.route === 'string' ? routeSpec.route.trim() : '';
                if (routeKey) {
                    effectiveRouteByRoute.set(routeKey, routeSpec);
                }
            });
            const effectiveIdentityArtifacts = identityWebArtifacts.filter((artifact) => {
                const targetPath =
                    typeof artifact?.targetPath === 'string' ? artifact.targetPath.trim() : '';
                const originalRouteSpec = routeByFallbackPath.get(targetPath);
                if (!originalRouteSpec) {
                    return true;
                }

                const effectiveRouteSpec = effectiveRouteByRoute.get(originalRouteSpec.route);
                if (!effectiveRouteSpec) {
                    return true;
                }

                const hasCompressedPath =
                    typeof effectiveRouteSpec?.compressedPath === 'string' &&
                    effectiveRouteSpec.compressedPath.trim();
                return !effectiveRouteSpec.forceCompressedOnly || !hasCompressedPath;
            });

            const webserverSpec = {
                schemaVersion: 'webview-webserver-spec/v1',
                hookContractVersion:
                    typeof effectiveWebserverSpecPatch.hookContractVersion === 'string'
                        ? effectiveWebserverSpecPatch.hookContractVersion
                        : HOOK_CONTRACT_VERSION,
                hookTargetModule:
                    typeof effectiveWebserverSpecPatch.hookTargetModule === 'string'
                        ? effectiveWebserverSpecPatch.hookTargetModule
                        : HOOK_MODULE,
                hookFunctions: {
                    registerExtraRoutes: 'register_extra_routes',
                    handleIndex: 'handle_index',
                    handlePostWebviewRefresh: 'handle_post_webview_refresh',
                },
                capabilities: [
                    'serve-default-index',
                    'serve-static-route',
                    ...(Boolean(effectiveWebserverSpecPatch.requiresPostRefresh)
                        ? ['post-refresh-endpoint']
                        : []),
                ],
                routes: {
                    indexRoute: staticRouteSpec.indexRoute.route,
                    postRefreshRoute: postRefreshRoute,
                    staticRoutes: effectiveStaticRoutes.map((entry) => ({
                        route: entry.route,
                        contentType: entry.contentType,
                        compressedPath: entry.compressedPath || undefined,
                        fallbackPath: entry.fallbackPath,
                        forceCompressedOnly: Boolean(entry.forceCompressedOnly),
                        contentEncoding: entry.contentEncoding || undefined,
                        varyAcceptEncoding: Boolean(entry.varyAcceptEncoding),
                    })),
                },
                needsWebDataStore: Boolean(effectiveWebserverSpecPatch.needsWebDataStore),
                allocationStrategy: 'reuse-first',
                performanceMode: 'balanced-low-mem',
            };

            const manifest = {
                schemaVersion: 'webview-runtime-handoff/v1',
                collectionId: collectionIdRaw || null,
                collectionName:
                    typeof collection.title === 'string' && collection.title.trim()
                        ? collection.title.trim()
                        : null,
                generatedAtIso: new Date().toISOString(),
                producerVersion: 'webview-producer-v1',
                pageMode,
                hookContractVersion: webserverSpec.hookContractVersion,
                hookTargetModule: webserverSpec.hookTargetModule,
                webserverSpec,
                nodes: nodeEntries,
                layoutModel,
            };

            const runtimeFlags = {
                schemaVersion: 'webview-runtime-flags/v1',
                pageMode,
                needsWebDataStore: Boolean(effectiveWebserverSpecPatch.needsWebDataStore),
                requiresPostRefresh: Boolean(effectiveWebserverSpecPatch.requiresPostRefresh),
                postRefreshRoute,
                pageIdentity:
                    layoutModel?.pageIdentity && typeof layoutModel.pageIdentity === 'object'
                        ? { ...layoutModel.pageIdentity }
                        : {
                              schemaVersion: 'webview-page-identity/v1',
                              rootPageId: null,
                              pageIdsByNodeId: {},
                          },
                staticRoutes: effectiveStaticRoutes.map((entry) => ({
                    route: entry.route,
                    fallbackPath: entry.fallbackPath,
                    compressedPath: entry.compressedPath || null,
                    contentType: entry.contentType,
                    forceCompressedOnly: Boolean(entry.forceCompressedOnly),
                })),
            };

            const producedArtifacts = [
                ...effectiveIdentityArtifacts,
                ...compressedWebArtifacts,
                { targetPath: 'collection/webview_manifest.json' },
                { targetPath: 'collection/webview_layout_model.json' },
                { targetPath: 'app/webserver_hooks_generated.py' },
                { targetPath: 'collection/webview_runtime_flags.json' },
            ];
            debugLog('consumer-complete', {
                durationMs: Date.now() - consumerStartedAt,
                identityArtifactCount: identityWebArtifacts.length,
                compressedArtifactCount: compressedWebArtifacts.length,
                effectiveCompressedRouteCount: effectiveStaticRoutes.filter(
                    (entry) =>
                        typeof entry?.compressedPath === 'string' && entry.compressedPath.trim()
                ).length,
                totalArtifactCount: producedArtifacts.length,
                artifactPaths: producedArtifacts.map((entry) => entry.targetPath),
            });

            return {
                artifacts: [
                    ...effectiveIdentityArtifacts,
                    ...compressedWebArtifacts,
                    {
                        targetPath: 'collection/webview_manifest.json',
                        content: JSON.stringify(manifest, null, 2),
                        contentType: 'application/json',
                        contentEncoding: 'identity',
                        role: 'web-manifest',
                    },
                    {
                        targetPath: 'collection/webview_layout_model.json',
                        content: JSON.stringify(layoutModel, null, 2),
                        contentType: 'application/json',
                        contentEncoding: 'identity',
                        role: 'layout-model',
                    },
                    {
                        targetPath: 'app/webserver_hooks_generated.py',
                        content: buildWebserverHookModuleSource(
                            postRefreshRoute,
                            effectiveStaticRoutes,
                            refreshBindingEntries,
                            transientKeyPrefixes,
                            postRefreshRequestHandling
                        ),
                        contentType: 'text/x-python',
                        contentEncoding: 'identity',
                        role: 'generated-hook-module',
                    },
                    {
                        targetPath: 'collection/webview_runtime_flags.json',
                        content: JSON.stringify(runtimeFlags, null, 2),
                        contentType: 'application/json',
                        contentEncoding: 'identity',
                        role: 'runtime-flags',
                    },
                ],
            };
        };
    }

    globalScope.WebviewGeneratorShared = {
        WebviewNodeBase,
        registerNodeKindImplementation,
        unregisterNodeKindImplementation,
        getNodeKindImplementation,
        listNodeKindImplementations,
        registerNodeKindContributor,
        unregisterNodeKindContributor,
        getNodeKindContributor,
        listNodeKindContributors,
        registerStructuralNodeKindStrategy,
        getStructuralNodeKindStrategy,
        listStructuralNodeKindStrategies,
        createRuntimeElementTokenGenerator,
        createRuntimeNoOpGenerator,
        createRuntimePassthroughGenerator,
        createWebviewDynamicInitGenerator,
        createWebviewDynamicLoopGenerator,
        createHelperContributionGenerator,
        registerWebRuntimeHelperHandoffConsumer,
    };
})();
