// Webview row generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error('Webview shared generator module must load before row generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before row generator.');
    }

    globalScope.NodeInitGenerators.webviewRow = shared.createRuntimePassthroughGenerator(
        'row',
        'init'
    );
    globalScope.NodeCodeGenerators.webviewRow = shared.createRuntimeNoOpGenerator('row', 'loop');
    globalScope.NodeHelperGenerators.webviewRow = shared.createHelperContributionGenerator(
        'row',
        30
    );

    class RowWebviewNode extends WebviewNodeBase {
        renderClientStyleRules(context = {}) {
            const pageMode = typeof context?.pageMode === 'string' ? context.pageMode.trim() : '';
            if (pageMode === 'single-page-compat') {
                return ['    .wv-row { display: flex; gap: 12px; align-items: flex-start; }'];
            }
            return [
                '    .wv-row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }',
            ];
        }

        getStructuralStrategy() {
            return {
                containerClass: 'wv-row',
                normalizeControls(controls, helpers) {
                    const normalizeControlValue = helpers?.normalizeControlValue;
                    const toFiniteInt = helpers?.toFiniteInt;
                    const rawValue =
                        typeof normalizeControlValue === 'function'
                            ? normalizeControlValue(controls, 'columnCount', 1)
                            : controls?.columnCount;
                    return {
                        columnCount:
                            typeof toFiniteInt === 'function'
                                ? toFiniteInt(rawValue, 1)
                                : Number(rawValue) || 1,
                    };
                },
            };
        }
    }

    shared.registerNodeKindImplementation('row', new RowWebviewNode());
})();
