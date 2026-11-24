// Webview column generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error('Webview shared generator module must load before column generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before column generator.');
    }

    globalScope.NodeInitGenerators.webviewColumn = shared.createRuntimePassthroughGenerator(
        'column',
        'init'
    );
    globalScope.NodeCodeGenerators.webviewColumn = shared.createRuntimeNoOpGenerator(
        'column',
        'loop'
    );
    globalScope.NodeHelperGenerators.webviewColumn = shared.createHelperContributionGenerator(
        'column',
        40
    );

    class ColumnWebviewNode extends WebviewNodeBase {
        renderClientStyleRules() {
            return [
                '    .wv-col { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; }',
                '    .wv-row > .wv-col { flex: 1 1 0; min-width: 0; }',
            ];
        }

        getStructuralStrategy() {
            return {
                containerClass: 'wv-col',
                normalizeControls(controls, helpers) {
                    const normalizeControlValue = helpers?.normalizeControlValue;
                    const toFiniteInt = helpers?.toFiniteInt;
                    const rawValue =
                        typeof normalizeControlValue === 'function'
                            ? normalizeControlValue(controls, 'rowCount', 1)
                            : controls?.rowCount;
                    return {
                        rowCount:
                            typeof toFiniteInt === 'function'
                                ? toFiniteInt(rawValue, 1)
                                : Number(rawValue) || 1,
                    };
                },
            };
        }
    }

    shared.registerNodeKindImplementation('column', new ColumnWebviewNode());
})();
