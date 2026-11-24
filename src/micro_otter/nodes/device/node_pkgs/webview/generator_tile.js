// Webview tile generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error('Webview shared generator module must load before tile generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before tile generator.');
    }

    globalScope.NodeInitGenerators.webviewTile = shared.createRuntimePassthroughGenerator(
        'web-view-tile',
        'init'
    );
    globalScope.NodeCodeGenerators.webviewTile = shared.createRuntimeNoOpGenerator(
        'web-view-tile',
        'loop'
    );
    globalScope.NodeHelperGenerators.webviewTile = shared.createHelperContributionGenerator(
        'web-view-tile',
        35
    );

    class TileWebviewNode extends WebviewNodeBase {
        normalizeControls(controls) {
            const source = controls && typeof controls === 'object' ? controls : {};
            return {
                title: typeof source.title === 'string' ? source.title : '',
            };
        }

        renderMarkup(context) {
            const indent = typeof context?.indent === 'string' ? context.indent : '';
            const childIndent = typeof context?.childIndent === 'string' ? context.childIndent : '';
            const nodeId =
                typeof context?.nodeId === 'string' && context.nodeId.trim()
                    ? context.nodeId.trim()
                    : 'unknown';
            const element =
                context?.element && typeof context.element === 'object' ? context.element : {};
            const escapeHtml =
                typeof context?.helpers?.escapeHtml === 'function'
                    ? context.helpers.escapeHtml
                    : (value) => String(value === undefined || value === null ? '' : value);
            const renderChildren =
                typeof context?.helpers?.renderChildren === 'function'
                    ? context.helpers.renderChildren
                    : () => [];
            const normalizeBindingSegment =
                typeof context?.helpers?.normalizeBindingSegment === 'function'
                    ? context.helpers.normalizeBindingSegment
                    : (value) =>
                          String(value ?? '')
                              .trim()
                              .replace(/[^a-zA-Z0-9_:-]+/g, '_') || 'unknown';

            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_tile_${normalizeBindingSegment(nodeId)}`;

            const title =
                typeof element?.controls?.title === 'string' ? element.controls.title.trim() : '';

            const lines = [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-tile" data-node-id="${escapeHtml(nodeId)}" data-node-kind="web-view-tile">`,
            ];

            if (title) {
                lines.push(`${childIndent}<span class="wv-tile-title">${escapeHtml(title)}</span>`);
            }

            const childLines = renderChildren();
            if (childLines.length > 0) {
                lines.push(...childLines);
            } else {
                lines.push(`${childIndent}<!-- empty-tile -->`);
            }

            lines.push(`${indent}</div>`);
            return lines;
        }

        renderClientUpdateHandler() {
            return [];
        }

        renderClientHelpers() {
            return [];
        }

        renderClientInitHooks() {
            return [];
        }

        renderClientStyleRules() {
            return [
                '    .wv-tile { border: 1px solid var(--wv-tile-border, #4a5568); border-radius: 6px; padding: 8px 10px; background: var(--wv-tile-bg, #1e2535); display: flex; flex-direction: column; gap: 8px; }',
                '    .wv-tile-title { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--wv-tile-title-color, #8fa6c8); padding-bottom: 4px; border-bottom: 1px solid var(--wv-tile-border, #4a5568); }',
            ];
        }
    }

    shared.registerNodeKindImplementation('web-view-tile', new TileWebviewNode());
})();
