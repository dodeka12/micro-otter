// Webview web-root generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error('Webview shared generator module must load before web-root generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before web-root generator.');
    }

    globalScope.NodeInitGenerators.webviewRoot = shared.createRuntimeElementTokenGenerator(
        'web-root',
        'init'
    );
    globalScope.NodeCodeGenerators.webviewRoot = shared.createRuntimeNoOpGenerator(
        'web-root',
        'loop'
    );
    globalScope.NodeHelperGenerators.webviewRoot = shared.createHelperContributionGenerator(
        'web-root',
        10
    );

    const FALLBACK_DEFAULT_REFRESH_INTERVAL_MS = 1000;
    const FALLBACK_MIN_REFRESH_INTERVAL_MS = 100;
    const FALLBACK_MAX_REFRESH_INTERVAL_MS = 60000;

    /**
     * Clamps a raw refresh interval into the supported range.
     *
     * The shared helper handoff owns the canonical bounds; the fallbacks repeat
     * them only for callers that normalize the web-root node without helpers.
     *
     * @param {unknown} value - Raw control value.
     * @param {object|null|undefined} helpers - Shared helper handoff.
     * @returns {number} Whole milliseconds inside `min … max`.
     */
    function clampRefreshIntervalMs(value, helpers) {
        const defaultMs = Number.isFinite(helpers?.defaultRefreshIntervalMs)
            ? helpers.defaultRefreshIntervalMs
            : FALLBACK_DEFAULT_REFRESH_INTERVAL_MS;
        const minMs = Number.isFinite(helpers?.minRefreshIntervalMs)
            ? helpers.minRefreshIntervalMs
            : FALLBACK_MIN_REFRESH_INTERVAL_MS;
        const maxMs = Number.isFinite(helpers?.maxRefreshIntervalMs)
            ? helpers.maxRefreshIntervalMs
            : FALLBACK_MAX_REFRESH_INTERVAL_MS;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return defaultMs;
        }
        return Math.min(Math.max(Math.floor(numeric), minMs), maxMs);
    }

    /**
     * Resolves the page refresh interval from the node's control values.
     *
     * Prefers the shared normalizer and falls back to the local clamp, so the
     * 100 ms floor holds on every path (a sub-100 ms interval would poll faster
     * than the device can answer).
     *
     * @param {object|null|undefined} controls - Raw node control values.
     * @param {object|null|undefined} helpers - Shared helper handoff.
     * @returns {number} Interval in milliseconds inside the supported range.
     */
    function resolveRefreshIntervalMs(controls, helpers) {
        const normalizeControlValue = helpers?.normalizeControlValue;
        const rawValue =
            typeof normalizeControlValue === 'function'
                ? normalizeControlValue(
                      controls,
                      'refreshIntervalMs',
                      helpers?.defaultRefreshIntervalMs
                  )
                : controls?.refreshIntervalMs;
        const normalizeRefreshIntervalMs = helpers?.normalizeRefreshIntervalMs;
        if (typeof normalizeRefreshIntervalMs === 'function') {
            return normalizeRefreshIntervalMs(rawValue);
        }
        return clampRefreshIntervalMs(rawValue, helpers);
    }

    class WebRootWebviewNode extends WebviewNodeBase {
        renderClientStyleRules() {
            return ['    .wv-root { }'];
        }

        getStructuralStrategy() {
            return {
                containerClass: 'wv-root',
                isPageScopeKind: true,
                normalizeControls(controls, helpers) {
                    const normalizeControlValue = helpers?.normalizeControlValue;

                    return {
                        title: String(
                            typeof normalizeControlValue === 'function'
                                ? normalizeControlValue(controls, 'title', 'Micro Otter')
                                : (controls?.title ?? 'Micro Otter')
                        ),
                        refreshIntervalMs: resolveRefreshIntervalMs(controls, helpers),
                    };
                },
            };
        }
    }

    shared.registerNodeKindImplementation('web-root', new WebRootWebviewNode());

    shared.registerWebRuntimeHelperHandoffConsumer();
})();
