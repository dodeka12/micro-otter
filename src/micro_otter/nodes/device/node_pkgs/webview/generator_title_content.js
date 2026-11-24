// Webview title-content generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error(
            'Webview shared generator module must load before title-content generator.'
        );
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before title-content generator.');
    }

    globalScope.NodeInitGenerators.webviewTitleContent = shared.createWebviewDynamicInitGenerator(
        'title-content',
        'init'
    );
    globalScope.NodeCodeGenerators.webviewTitleContent =
        shared.createWebviewDynamicLoopGenerator('title-content');
    globalScope.NodeHelperGenerators.webviewTitleContent = shared.createHelperContributionGenerator(
        'title-content',
        60
    );

    class TitleContentWebviewNode extends WebviewNodeBase {
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
            const toFiniteInt =
                typeof context.toFiniteInt === 'function'
                    ? context.toFiniteInt
                    : (value, fallbackValue) => {
                          const numeric = Number(value);
                          return Number.isFinite(numeric) ? Math.floor(numeric) : fallbackValue;
                      };

            return {
                title: String(normalizeControlValue(controls, 'title', '')),
                headingLevel: toFiniteInt(normalizeControlValue(controls, 'headingLevel', 2), 2),
            };
        }

        renderRuntimePayload(context) {
            const titleInput =
                typeof context?.titleInput === 'string' && context.titleInput.trim()
                    ? context.titleInput.trim()
                    : 'None';
            const controls =
                context?.controls && typeof context.controls === 'object' ? context.controls : {};
            const normalizeControlValue =
                typeof context?.normalizeControlValue === 'function'
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
            const toFiniteInt =
                typeof context?.toFiniteInt === 'function'
                    ? context.toFiniteInt
                    : (value, fallbackValue) => {
                          const numeric = Number(value);
                          return Number.isFinite(numeric) ? Math.floor(numeric) : fallbackValue;
                      };
            const formatLiteral =
                typeof context?.formatLiteral === 'function'
                    ? context.formatLiteral
                    : (value) => JSON.stringify(value);
            const headingLevel = toFiniteInt(normalizeControlValue(controls, 'headingLevel', 2), 2);

            return `{ 'kind': 'title-content', 'title': ${titleInput}, 'headingLevel': ${formatLiteral(headingLevel)} }`;
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
                typeof context?.escapeHtml === 'function'
                    ? context.escapeHtml
                    : (value) => String(value === undefined || value === null ? '' : value);
            const normalizeHeadingLevel =
                typeof context?.normalizeHeadingLevel === 'function'
                    ? context.normalizeHeadingLevel
                    : (value) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return 2;
                          }
                          const integerLevel = Math.floor(numeric);
                          if (integerLevel < 1) {
                              return 1;
                          }
                          if (integerLevel > 6) {
                              return 6;
                          }
                          return integerLevel;
                      };
            const normalizeBindingSegment =
                typeof context?.normalizeBindingSegment === 'function'
                    ? context.normalizeBindingSegment
                    : (value) =>
                          String(value ?? '')
                              .trim()
                              .replace(/[^a-zA-Z0-9_:-]+/g, '_') || 'unknown';

            const headingLevel = normalizeHeadingLevel(element?.controls?.headingLevel);
            const titleText = escapeHtml(element?.controls?.title ?? '');
            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_title_${normalizeBindingSegment(nodeId)}`;

            return [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-title-content" data-node-id="${escapeHtml(nodeId)}" data-node-kind="title-content">`,
                `${childIndent}<h${headingLevel}>${titleText}</h${headingLevel}>`,
                `${indent}</div>`,
            ];
        }

        renderClientUpdateHandler() {
            return [
                'function applyTitleContentUpdate(targetElement, entry) {',
                '  const currentHeading = targetElement.querySelector("h1, h2, h3, h4, h5, h6");',
                '  const levelSource = hasOwnProperty(entry, "headingLevel")',
                '    ? entry.headingLevel',
                '    : currentHeading?.tagName?.slice(1) ?? 2;',
                '  const headingLevel = normalizeHeadingLevel(levelSource);',
                '  const headingTag = `h${headingLevel}`;',
                '  const heading = document.createElement(headingTag);',
                '  if (hasOwnProperty(entry, "title")) {',
                '    heading.textContent = String(entry.title ?? "");',
                '  } else if (currentHeading) {',
                '    heading.textContent = currentHeading.textContent ?? "";',
                '  } else {',
                '    heading.textContent = "";',
                '  }',
                '  targetElement.replaceChildren(heading);',
                '  return true;',
                '}',
            ];
        }

        renderClientStyleRules() {
            return [
                '    .wv-title-content { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }',
                '    .wv-title-content h1, .wv-title-content h2, .wv-title-content h3, .wv-title-content h4, .wv-title-content h5, .wv-title-content h6 { margin: 0; }',
            ];
        }
    }

    shared.registerNodeKindImplementation('title-content', new TitleContentWebviewNode());
})();
