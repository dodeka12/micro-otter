// Webview web-page generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error('Webview shared generator module must load before web-page generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before web-page generator.');
    }

    globalScope.NodeInitGenerators.webviewPage = shared.createRuntimeElementTokenGenerator(
        'web-page',
        'init'
    );
    globalScope.NodeCodeGenerators.webviewPage = shared.createRuntimeNoOpGenerator(
        'web-page',
        'loop'
    );
    globalScope.NodeHelperGenerators.webviewPage = shared.createHelperContributionGenerator(
        'web-page',
        20
    );

    class WebPageWebviewNode extends WebviewNodeBase {
        renderClientStyleRules() {
            return ['    .wv-page { }'];
        }

        getStructuralStrategy() {
            return {
                containerClass: 'wv-page',
                isPageScopeKind: true,
                normalizeControls(controls, helpers) {
                    const normalizeControlValue = helpers?.normalizeControlValue;
                    return {
                        pageName: String(
                            typeof normalizeControlValue === 'function'
                                ? normalizeControlValue(controls, 'pageName', '')
                                : (controls?.pageName ?? '')
                        ),
                    };
                },
            };
        }
    }

    shared.registerNodeKindImplementation('web-page', new WebPageWebviewNode());
})();
