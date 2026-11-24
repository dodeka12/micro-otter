// Webview content generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error('Webview shared generator module must load before content generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before content generator.');
    }

    globalScope.NodeInitGenerators.webviewContent =
        shared.createWebviewDynamicInitGenerator('content');
    globalScope.NodeCodeGenerators.webviewContent =
        shared.createWebviewDynamicLoopGenerator('content');
    globalScope.NodeHelperGenerators.webviewContent = shared.createHelperContributionGenerator(
        'content',
        50
    );

    const sanitizeSegment = (value) =>
        String(value ?? '')
            .trim()
            .replace(/[^a-zA-Z0-9_:-]+/g, '_') || 'unknown';

    class ContentWebviewNode extends WebviewNodeBase {
        getWebserverCapabilities() {
            return {
                needsWebDataStore: true,
                requiresPostRefresh: true,
            };
        }

        normalizeControls(controls, context = {}) {
            const normalizeControlValue =
                typeof context.normalizeControlValue === 'function'
                    ? context.normalizeControlValue
                    : (controlValues, key, fallbackValue = null) => {
                          if (!controlValues || typeof controlValues !== 'object') {
                              return fallbackValue;
                          }
                          if (!Object.prototype.hasOwnProperty.call(controlValues, key)) {
                              return fallbackValue;
                          }
                          const value = controlValues[key];
                          return value === undefined || value === null ? fallbackValue : value;
                      };

            return {
                title: String(normalizeControlValue(controls, 'title', '')),
                value: normalizeControlValue(controls, 'value', 0),
            };
        }

        renderRuntimePayload(context) {
            const titleInput =
                typeof context?.io?.titleInput === 'string' && context.io.titleInput.trim()
                    ? context.io.titleInput.trim()
                    : typeof context?.titleInput === 'string' && context.titleInput.trim()
                      ? context.titleInput.trim()
                      : 'None';
            const valueInput =
                typeof context?.io?.valueInput === 'string' && context.io.valueInput.trim()
                    ? context.io.valueInput.trim()
                    : typeof context?.valueInput === 'string' && context.valueInput.trim()
                      ? context.valueInput.trim()
                      : 'None';

            return `{ 'kind': 'content', 'title': ${titleInput}, 'value': ${valueInput} }`;
        }

        renderMarkup(context) {
            const indent =
                typeof context?.view?.indent === 'string'
                    ? context.view.indent
                    : typeof context?.indent === 'string'
                      ? context.indent
                      : '';
            const childIndent =
                typeof context?.view?.childIndent === 'string'
                    ? context.view.childIndent
                    : typeof context?.childIndent === 'string'
                      ? context.childIndent
                      : '';
            const nodeId =
                typeof context?.node?.nodeId === 'string' && context.node.nodeId.trim()
                    ? context.node.nodeId.trim()
                    : typeof context?.nodeId === 'string' && context.nodeId.trim()
                      ? context.nodeId.trim()
                      : 'unknown';
            const controls =
                context?.element?.controls && typeof context.element.controls === 'object'
                    ? context.element.controls
                    : {};
            const escapeHtml =
                typeof context?.helpers?.escapeHtml === 'function'
                    ? context.helpers.escapeHtml
                    : typeof context?.escapeHtml === 'function'
                      ? context.escapeHtml
                      : (value) => String(value === undefined || value === null ? '' : value);
            const rawTitle = typeof controls.title === 'string' ? controls.title : '';
            const hasTitle = Boolean(rawTitle.trim());
            const contentTitle = escapeHtml(rawTitle);
            const contentValue = escapeHtml(controls.value ?? '');
            const elementId =
                typeof context?.element?.binding?.elementId === 'string'
                    ? context.element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_content_${sanitizeSegment(nodeId)}`;

            return [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-content" data-node-id="${escapeHtml(nodeId)}" data-node-kind="content">`,
                `${childIndent}<div class="wv-content-row">`,
                `${childIndent}  <span class="wv-content-title" data-wv-content-role="title"${hasTitle ? '' : ' hidden'}>${contentTitle}</span>`,
                `${childIndent}  <span class="wv-content-value" data-wv-content-role="value">${contentValue}</span>`,
                `${childIndent}</div>`,
                `${indent}</div>`,
            ];
        }

        renderClientUpdateHandler() {
            return [
                'function applyContentUpdate(targetElement, entry) {',
                '  const titleElement = targetElement.querySelector("[data-wv-content-role=title]");',
                '  const valueElement = targetElement.querySelector("[data-wv-content-role=value]");',
                '  if (titleElement && hasOwnProperty(entry, "title")) {',
                '    const titleText = String(entry.title ?? "");',
                '    titleElement.textContent = titleText;',
                '    titleElement.hidden = titleText.trim().length === 0;',
                '  }',
                '  if (!hasOwnProperty(entry, "value")) {',
                '    return false;',
                '  }',
                '  if (valueElement) {',
                '    valueElement.textContent = String(entry.value ?? "");',
                '  } else {',
                '    targetElement.textContent = String(entry.value ?? "");',
                '  }',
                '  return true;',
                '}',
            ];
        }

        renderClientStyleRules() {
            return [
                '    .wv-content { padding: 10px 12px; border: 0; border-radius: 0; background: rgba(17, 24, 43, 0.9); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26), 0 0 0 1px rgba(170, 210, 255, 0.28), 0 0 22px rgba(126, 190, 255, 0.34); }',
                '    .wv-content-row { display: flex; align-items: baseline; justify-content: flex-start; gap: 8px; }',
                '    .wv-content-title { color: #b9c8ea; font-weight: 600; white-space: nowrap; }',
                '    .wv-content-value { color: #f2f5ff; margin-left: 0; font-variant-numeric: tabular-nums; }',
                '    @media (max-width: 760px) { .wv-content-row { flex-wrap: wrap; } .wv-content-value { margin-left: 0; } }',
            ];
        }
    }

    shared.registerNodeKindImplementation('content', new ContentWebviewNode());
})();
