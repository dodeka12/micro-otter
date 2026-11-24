// Webview select generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    const WEBVIEW_PUBLISH_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.publish_webview_values';
    const WEBVIEW_CONSUME_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.consume_webview_values_keys';
    const WEBVIEW_GET_SYNC_EPOCH_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.get_webview_sync_epoch';
    const WEBVIEW_SELECT_MODULE_ALIAS = '_wv_select';
    const WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION = 'webview-runtime/strict-v1';

    if (!shared) {
        throw new Error('Webview shared generator module must load before select generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before select generator.');
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

    function buildBindingId(prefix, typeCode, nodeId, slotIndex = null) {
        const safeTypeCode = normalizeBindingSegment(typeCode, 'node');
        const safeNodeId = normalizeBindingSegment(nodeId, 'unknown');
        const hasSlotIndex = Number.isFinite(slotIndex) && Number(slotIndex) >= 0;
        const slotSuffix = hasSlotIndex ? `_s${Math.floor(Number(slotIndex))}` : '';
        return `${prefix}_${safeTypeCode}_${safeNodeId}${slotSuffix}`;
    }

    function buildWebNodeKey(scopedNodeId) {
        const normalizedScopedNodeId =
            scopedNodeId === undefined || scopedNodeId === null ? '' : String(scopedNodeId).trim();
        return `webNode:${normalizedScopedNodeId || 'unknown'}`;
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
        return { nodeId, outputIndex };
    }

    function createLayoutBinding(scopedNodeId, slotIndex) {
        const resolvedSlotIndex = Number.isFinite(slotIndex) ? slotIndex : null;
        return {
            elementId: buildBindingId('wv_el', 'select', scopedNodeId, resolvedSlotIndex),
            payloadKey: buildBindingId('wv_bind', 'select', scopedNodeId, resolvedSlotIndex),
        };
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

    function normalizeBool(value, fallbackValue = false) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (value === 1 || value === '1' || value === 'true' || value === true) {
            return true;
        }
        if (value === 0 || value === '0' || value === 'false' || value === '' || value === null) {
            return false;
        }
        return fallbackValue;
    }

    function normalizeOptionCount(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 1;
        }
        const n = Math.floor(numeric);
        return n < 0 ? 0 : n > 8 ? 8 : n;
    }

    function normalizeDefaultIndex(value, optionCount) {
        const numeric = Number(value);
        const index = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
        const max = Math.max(0, optionCount - 1);
        if (index < 0) {
            return 0;
        }
        if (index > max) {
            return max;
        }
        return index;
    }

    function buildCtrlVarName(safeNodeId) {
        return `_wv_select_ctrl_${safeNodeId}`;
    }

    function resolveOptionDefaults(controls, optionCount, formatLiteral) {
        const valueDefaults = [];
        const labelDefaults = [];
        for (let k = 1; k <= optionCount; k++) {
            const labelDefault = String(
                normalizeControlValue(controls, `label_${k}`, `Option ${k}`) ?? `Option ${k}`
            );
            const valueDefault = normalizeControlValue(controls, `value_${k}`, '');
            labelDefaults.push(formatLiteral(labelDefault));
            valueDefaults.push(formatLiteral(valueDefault));
        }
        return { valueDefaults, labelDefaults };
    }

    // -------------------------------------------------------------------------
    // Init generator — emits SelectControl instantiation + element passthrough
    // -------------------------------------------------------------------------

    function createSelectInitGenerator() {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((e) => (typeof e === 'string' ? e.trim() : ''))
                .filter(Boolean);
            const elementOutput = safeOutputs[0] || '';

            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';

            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = normalizeGraphId(context?.graph?.id);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);

            const controls =
                node.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};
            const optionCount = normalizeOptionCount(
                normalizeControlValue(controls, 'optionCount', 1)
            );
            const defaultIndex = normalizeDefaultIndex(
                normalizeControlValue(controls, 'defaultIndex', 0),
                optionCount
            );

            const helperContext =
                context?.helpers && typeof context.helpers === 'object' ? context.helpers : {};
            const registerImport =
                typeof helperContext.registerImport === 'function'
                    ? helperContext.registerImport
                    : null;
            const formatLiteral =
                typeof helperContext.formatLiteral === 'function'
                    ? helperContext.formatLiteral
                    : (v) => JSON.stringify(v);

            if (registerImport) {
                registerImport('import otter_runtime.web_interface as web_interface_module');
                registerImport(
                    `import otter_webview.input_control as ${WEBVIEW_SELECT_MODULE_ALIAS}`
                );
            }

            const { valueDefaults, labelDefaults } = resolveOptionDefaults(
                controls,
                optionCount,
                formatLiteral
            );

            const safeNodeId = normalizeBindingSegment(scopedNodeId);
            const ctrlVar = buildCtrlVarName(safeNodeId);
            const valuesLiteral = `[${valueDefaults.join(', ')}]`;
            const labelsLiteral = `[${labelDefaults.join(', ')}]`;
            const defaultIndexLiteral = formatLiteral(defaultIndex);
            const initIndexLiteral = defaultIndexLiteral;

            const lines = [
                `# webview:web-view-select:init id="${nodeId}"`,
                `${ctrlVar} = ${WEBVIEW_SELECT_MODULE_ALIAS}.SelectControl(${valuesLiteral}, ${labelsLiteral}, ${initIndexLiteral})`,
            ];

            if (elementOutput && parentInput !== 'None') {
                lines.push(`${elementOutput} = ${parentInput}`);
            } else {
                lines.push('# webview:web-view-select:init (no connected element output)');
            }

            return { statement: lines.join('\n') };
        };
    }

    // -------------------------------------------------------------------------
    // Loop generator — updates options, resolves selection, assigns outputs
    // -------------------------------------------------------------------------

    function createSelectLoopGenerator() {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((e) => (typeof e === 'string' ? e.trim() : ''))
                .filter(Boolean);
            const elementOutput = safeOutputs[0] || '';
            const valueOutput = safeOutputs[1] || '';
            const labelOutput = safeOutputs[2] || '';
            const changedOutput = safeOutputs[3] || '';

            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';
            const titleInput = typeof inputs[1] === 'string' ? inputs[1].trim() : '';
            const valueInput = typeof inputs[2] === 'string' ? inputs[2].trim() : '';

            const inputSources = Array.isArray(context?.inputSources) ? context.inputSources : [];

            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = normalizeGraphId(context?.graph?.id);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);

            const controls =
                node.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};
            const optionCount = normalizeOptionCount(
                normalizeControlValue(controls, 'optionCount', 1)
            );
            const persistEnabled = normalizeBool(
                normalizeControlValue(controls, 'persist', false),
                false
            );
            const defaultIndex = normalizeDefaultIndex(
                normalizeControlValue(controls, 'defaultIndex', 0),
                optionCount
            );
            const defaultTitle = String(normalizeControlValue(controls, 'title', '') ?? '');

            const helperContext =
                context?.helpers && typeof context.helpers === 'object' ? context.helpers : {};
            const registerImport =
                typeof helperContext.registerImport === 'function'
                    ? helperContext.registerImport
                    : null;
            const formatLiteral =
                typeof helperContext.formatLiteral === 'function'
                    ? helperContext.formatLiteral
                    : (v) => JSON.stringify(v);

            if (registerImport) {
                registerImport('import otter_runtime.web_interface as web_interface_module');
                registerImport(
                    `import otter_webview.input_control as ${WEBVIEW_SELECT_MODULE_ALIAS}`
                );
                if (persistEnabled) {
                    registerImport('import otter_vars.store as _store');
                }
            }

            const parentLink = parseOutputReference(parentInput);
            const parentSource =
                inputSources[0] && typeof inputSources[0] === 'object' ? inputSources[0] : null;
            const parentSourceOutputIndex = Number.isFinite(parentSource?.fromIndex)
                ? Math.floor(Number(parentSource.fromIndex))
                : null;
            const binding = createLayoutBinding(
                scopedNodeId,
                parentLink ? parentLink.outputIndex : parentSourceOutputIndex
            );
            const publishKey =
                typeof binding?.payloadKey === 'string' && binding.payloadKey.trim()
                    ? binding.payloadKey.trim()
                    : buildWebNodeKey(scopedNodeId);
            const frontendKey = `frontend:${publishKey}`;

            const valueExprs = [];
            const labelExprs = [];
            for (let k = 1; k <= optionCount; k++) {
                const labelInputIndex = 3 + 2 * (k - 1);
                const valueInputIndex = 4 + 2 * (k - 1);
                const labelDefault = String(
                    normalizeControlValue(controls, `label_${k}`, `Option ${k}`) ?? `Option ${k}`
                );
                const valueDefault = normalizeControlValue(controls, `value_${k}`, '');
                const labelConnected = Boolean(
                    inputSources[labelInputIndex] &&
                        typeof inputSources[labelInputIndex] === 'object'
                );
                const valueConnected = Boolean(
                    inputSources[valueInputIndex] &&
                        typeof inputSources[valueInputIndex] === 'object'
                );
                const labelExpr =
                    labelConnected &&
                    inputs[labelInputIndex] &&
                    inputs[labelInputIndex] !== 'None'
                        ? inputs[labelInputIndex]
                        : formatLiteral(labelDefault);
                const valueExpr =
                    valueConnected &&
                    inputs[valueInputIndex] &&
                    inputs[valueInputIndex] !== 'None'
                        ? inputs[valueInputIndex]
                        : formatLiteral(valueDefault);
                labelExprs.push(labelExpr);
                valueExprs.push(valueExpr);
            }

            const hasConnectedValueInput = Boolean(
                inputSources[2] && typeof inputSources[2] === 'object'
            );
            const valueDefault = normalizeControlValue(controls, 'value', '');
            const backendValueExpr =
                hasConnectedValueInput && valueInput && valueInput !== 'None'
                    ? valueInput
                    : formatLiteral(String(valueDefault ?? ''));

            const hasConnectedTitleInput = Boolean(
                inputSources[1] && typeof inputSources[1] === 'object'
            );
            const titleExpr =
                hasConnectedTitleInput && titleInput && titleInput !== 'None'
                    ? titleInput
                    : formatLiteral(defaultTitle);

            const safeNodeId = normalizeBindingSegment(scopedNodeId);
            const ctrlVar = buildCtrlVarName(safeNodeId);
            const valsVar = `_wv_select_vals_${safeNodeId}`;
            const labelsVar = `_wv_select_labels_${safeNodeId}`;
            const outValVar = `_wv_select_out_${safeNodeId}`;
            const outLabelVar = `_wv_select_outlabel_${safeNodeId}`;
            const pushVar = `_wv_select_push_${safeNodeId}`;

            const frontendKeyLiteral = formatLiteral(frontendKey);
            const publishKeyLiteral = formatLiteral(publishKey);
            const persistKeyLiteral = formatLiteral(scopedNodeId);
            const defaultIndexLiteral = formatLiteral(defaultIndex);

            const persistIdxVar = `_wv_select_persistidx_${safeNodeId}`;
            const persistBackendVar = `_wv_select_backend_${safeNodeId}`;
            const persistPreludeLines = persistEnabled
                ? [
                      `${persistIdxVar} = _store.get('_webcontrol', ${persistKeyLiteral}, ${defaultIndexLiteral})`,
                      `${persistBackendVar} = ${backendValueExpr}`,
                      `if isinstance(${persistIdxVar}, int) and 0 <= ${persistIdxVar} < len(${valsVar}):`,
                      `    ${persistBackendVar} = ${valsVar}[${persistIdxVar}]`,
                  ]
                : [];
            const updateValueExpr = persistEnabled ? persistBackendVar : backendValueExpr;

            const loopLines = [
                `# ${WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION}`,
                `${valsVar} = [${valueExprs.join(', ')}]`,
                `${labelsVar} = [${labelExprs.join(', ')}]`,
                `${ctrlVar}._option_values = ${valsVar}`,
                `${ctrlVar}._option_labels = ${labelsVar}`,
                ...persistPreludeLines,
                `(${outValVar}, ${outLabelVar}, ${pushVar}) = ${ctrlVar}.update(${updateValueExpr}, ${WEBVIEW_CONSUME_FUNCTION_NAME}, ${frontendKeyLiteral}, sync_epoch=${WEBVIEW_GET_SYNC_EPOCH_FUNCTION_NAME}())`,
                valueOutput
                    ? `${valueOutput} = ${outValVar}`
                    : '# webview:web-view-select:loop (no connected value output)',
                labelOutput
                    ? `${labelOutput} = ${outLabelVar}`
                    : '# webview:web-view-select:loop (no connected label output)',
                changedOutput
                    ? `${changedOutput} = ${ctrlVar}.output_changed`
                    : '# webview:web-view-select:loop (no connected changed output)',
                ...(persistEnabled
                    ? [
                          `_store.set('_webcontrol', ${persistKeyLiteral}, ${ctrlVar}._selected_index)`,
                      ]
                    : []),
                elementOutput && parentInput !== 'None'
                    ? `${elementOutput} = ${parentInput}`
                    : '# webview:web-view-select:loop (no connected element output)',
                `if ${pushVar}:`,
                `    ${WEBVIEW_PUBLISH_FUNCTION_NAME}({${publishKeyLiteral}: {'kind': 'select', 'selectedIndex': ${ctrlVar}._selected_index, 'title': ${titleExpr}, 'options': [{'value': v, 'label': l} for v, l in zip(${valsVar}, ${labelsVar})]}})`,
            ].filter((line) => line !== '');

            return { statement: loopLines.join('\n') };
        };
    }

    // -------------------------------------------------------------------------
    // Register generators
    // -------------------------------------------------------------------------

    globalScope.NodeInitGenerators.webviewSelect = createSelectInitGenerator();
    globalScope.NodeCodeGenerators.webviewSelect = createSelectLoopGenerator();
    globalScope.NodeHelperGenerators.webviewSelect = shared.createHelperContributionGenerator(
        'web-view-select',
        44
    );

    // -------------------------------------------------------------------------
    // WebviewNodeBase subclass
    // -------------------------------------------------------------------------

    class SelectWebviewNode extends WebviewNodeBase {
        normalizeControls(controls) {
            const source = controls && typeof controls === 'object' ? controls : {};
            const optionCount = normalizeOptionCount(source.optionCount ?? 1);
            const normalized = {
                optionCount,
                defaultIndex: normalizeDefaultIndex(source.defaultIndex ?? 0, optionCount),
                title: typeof source.title === 'string' ? source.title : '',
            };
            for (let k = 1; k <= optionCount; k++) {
                normalized[`label_${k}`] = String(
                    source[`label_${k}`] ?? `Option ${k}`
                );
                normalized[`value_${k}`] =
                    source[`value_${k}`] === undefined ? '' : source[`value_${k}`];
            }
            return normalized;
        }

        getWebserverCapabilities() {
            return { needsWebDataStore: true, requiresPostRefresh: true };
        }

        getRefreshTransientKeyPrefixes() {
            return ['frontend:wv_bind_select'];
        }

        getRefreshHookImports() {
            return [
                'def _wv_normalize_input_frontend_updates(request_payload):',
                '    import otter_webview.input_control as _wv_input_control_module',
                '    normalize_updates = getattr(_wv_input_control_module, "normalize_frontend_updates", None)',
                '    if not callable(normalize_updates):',
                '        raise RuntimeError("Input control module is missing normalize_frontend_updates(request_payload)")',
                '    normalized_updates = normalize_updates(request_payload)',
                '    if not isinstance(normalized_updates, dict):',
                '        raise RuntimeError("normalize_frontend_updates() must return a dict")',
                '    return normalized_updates',
            ];
        }

        getRefreshRequestValueNormalizers() {
            return ['_wv_normalize_input_frontend_updates'];
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
            const controls =
                element?.controls && typeof element.controls === 'object' ? element.controls : {};
            const escapeHtml =
                typeof context?.escapeHtml === 'function'
                    ? context.escapeHtml
                    : (v) =>
                          String(v === undefined || v === null ? '' : v)
                              .replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/"/g, '&quot;');

            const optionCount = normalizeOptionCount(controls.optionCount ?? 1);
            const defaultIndex = normalizeDefaultIndex(controls.defaultIndex ?? 0, optionCount);
            const title = typeof controls.title === 'string' ? controls.title : '';

            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_select_${normalizeBindingSegment(nodeId)}`;
            const payloadKey =
                typeof element?.binding?.payloadKey === 'string'
                    ? element.binding.payloadKey.trim()
                    : '';

            const lines = [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-input-control wv-select" data-wv-payload-key="${escapeHtml(payloadKey)}" data-wv-input-kind="select">`,
                `${childIndent}<label class="wv-input-label">${escapeHtml(title)}</label>`,
                `${childIndent}<select class="wv-select-input">`,
            ];
            for (let k = 1; k <= optionCount; k++) {
                const label = String(controls[`label_${k}`] ?? `Option ${k}`);
                const value = controls[`value_${k}`] === undefined ? '' : controls[`value_${k}`];
                const selectedAttr = k - 1 === defaultIndex ? ' selected' : '';
                const encodedValue = JSON.stringify(value);
                lines.push(
                    `${childIndent}  <option value="${escapeHtml(encodedValue)}"${selectedAttr}>${escapeHtml(label)}</option>`
                );
            }
            lines.push(`${childIndent}</select>`);
            lines.push(`${indent}</div>`);
            return lines;
        }

        renderClientUpdateHandler() {
            return [
                'function applySelectUpdate(targetElement, entry) {',
                '  const selectEl = targetElement.querySelector("select.wv-select-input");',
                '  const labelEl = targetElement.querySelector("label.wv-input-label");',
                '  if (selectEl && Array.isArray(entry.options)) {',
                '    selectEl.innerHTML = "";',
                '    entry.options.forEach(function (opt) {',
                '      const optionEl = document.createElement("option");',
                '      optionEl.value = JSON.stringify(opt.value);',
                '      optionEl.textContent = opt.label;',
                '      selectEl.appendChild(optionEl);',
                '    });',
                '  }',
                '  if (selectEl && entry.selectedIndex !== undefined) {',
                '    selectEl.selectedIndex = entry.selectedIndex;',
                '  }',
                '  if (labelEl && typeof entry.title === "string" && labelEl.textContent !== entry.title) {',
                '    labelEl.textContent = entry.title;',
                '  }',
                '  return true;',
                '}',
            ];
        }

        renderClientHelpers() {
            return [
                'function initializeSelects() {',
                '  const selectControls = Array.from(document.querySelectorAll(".wv-select"));',
                '  selectControls.forEach(function (containerEl) {',
                '    if (containerEl.getAttribute("data-wv-select-ready") === "true") return;',
                '    const selectEl = containerEl.querySelector("select.wv-select-input");',
                '    if (!selectEl) return;',
                '    selectEl.addEventListener("change", function () {',
                '      const payloadKey = containerEl.getAttribute("data-wv-payload-key") || "";',
                '      if (!payloadKey) return;',
                '      const frontendKey = "frontend:" + payloadKey;',
                '      if (typeof document === "undefined" || !document.hidden) {',
                '        postRefreshWithTimeout({ [frontendKey]: { kind: "select", index: selectEl.selectedIndex } })',
                '          .catch(() => {});',
                '      }',
                '    });',
                '    containerEl.setAttribute("data-wv-select-ready", "true");',
                '  });',
                '}',
            ];
        }

        renderClientInitHooks() {
            return ['initializeSelects();'];
        }

        renderClientStyleRules() {
            return [
                '    .wv-select-input { background: var(--wv-input-bg, #0f1526); color: var(--wv-input-color, #d0d8f0); border: 1px solid var(--wv-input-border, #4a5568); border-radius: 4px; padding: 2px 4px; font-size: 0.85rem; }',
            ];
        }
    }

    shared.registerNodeKindImplementation('web-view-select', new SelectWebviewNode());
})();





