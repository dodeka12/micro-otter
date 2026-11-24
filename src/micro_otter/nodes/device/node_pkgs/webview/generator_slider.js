// Webview slider generator registration
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
    const WEBVIEW_SLIDER_MODULE_ALIAS = '_wv_slider';
    const WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION = 'webview-runtime/strict-v1';

    if (!shared) {
        throw new Error('Webview shared generator module must load before slider generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before slider generator.');
    }

    // -------------------------------------------------------------------------
    // Local helpers (mirrors number-input pattern)
    // -------------------------------------------------------------------------

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
            elementId: buildBindingId('wv_el', 'slider', scopedNodeId, resolvedSlotIndex),
            payloadKey: buildBindingId('wv_bind', 'slider', scopedNodeId, resolvedSlotIndex),
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

    function toFiniteNumber(value, fallbackValue) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallbackValue;
    }

    function normalizeSliderBounds(controls) {
        const source = controls && typeof controls === 'object' ? controls : {};
        const minValue = toFiniteNumber(source.minValue, 0);
        let maxValue = toFiniteNumber(source.maxValue, 100);
        if (maxValue < minValue) {
            maxValue = minValue;
        }
        let step = toFiniteNumber(source.step, 1);
        if (step < 0.001) {
            step = 0.001;
        }
        return { minValue, maxValue, step };
    }

    function clampValue(value, minValue, maxValue) {
        return Math.min(maxValue, Math.max(minValue, value));
    }

    function buildCtrlVarName(safeNodeId) {
        return `_wv_slider_ctrl_${safeNodeId}`;
    }

    // -------------------------------------------------------------------------
    // Init generator — emits DualInputControl instantiation + element passthrough
    // -------------------------------------------------------------------------

    function createSliderInitGenerator() {
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
            const bounds = normalizeSliderBounds(controls);
            const rawDefaultValue = normalizeControlValue(controls, 'value', 0);
            const defaultNumeric = toFiniteNumber(rawDefaultValue, 0);
            const safeDefaultValue = clampValue(defaultNumeric, bounds.minValue, bounds.maxValue);

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
                    `import otter_webview.input_control as ${WEBVIEW_SLIDER_MODULE_ALIAS}`
                );
            }

            const safeNodeId = normalizeBindingSegment(scopedNodeId);
            const ctrlVar = buildCtrlVarName(safeNodeId);
            const defaultValueLiteral = formatLiteral(safeDefaultValue);
            const initValueLiteral = defaultValueLiteral;

            const lines = [
                `# webview:web-view-slider:init id="${nodeId}"`,
                `${ctrlVar} = ${WEBVIEW_SLIDER_MODULE_ALIAS}.DualInputControl(${initValueLiteral})`,
            ];

            if (elementOutput && parentInput !== 'None') {
                lines.push(`${elementOutput} = ${parentInput}`);
            } else {
                lines.push('# webview:web-view-slider:init (no connected element output)');
            }

            return { statement: lines.join('\n') };
        };
    }

    // -------------------------------------------------------------------------
    // Loop generator — clamps backend, updates control, assigns outputs, publishes
    // -------------------------------------------------------------------------

    function createSliderLoopGenerator() {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((e) => (typeof e === 'string' ? e.trim() : ''))
                .filter(Boolean);
            const elementOutput = safeOutputs[0] || '';
            const valueOutput = safeOutputs[1] || '';
            const changedOutput = safeOutputs[2] || '';

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
            const bounds = normalizeSliderBounds(controls);
            const persistEnabled = normalizeBool(
                normalizeControlValue(controls, 'persist', false),
                false
            );
            const rawDefaultValue = normalizeControlValue(controls, 'value', 0);
            const defaultNumeric = toFiniteNumber(rawDefaultValue, 0);
            const safeDefaultValue = clampValue(defaultNumeric, bounds.minValue, bounds.maxValue);
            const defaultTitle = String(normalizeControlValue(controls, 'title', '') ?? '');

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
                    `import otter_webview.input_control as ${WEBVIEW_SLIDER_MODULE_ALIAS}`
                );
                if (persistEnabled) {
                    registerImport('import otter_vars.store as _store');
                }
            }

            const safeNodeId = normalizeBindingSegment(scopedNodeId);
            const ctrlVar = buildCtrlVarName(safeNodeId);
            const outValVar = `_wv_slider_out_${safeNodeId}`;
            const pushVar = `_wv_slider_push_${safeNodeId}`;

            const hasConnectedValueInput = Boolean(
                inputSources[2] && typeof inputSources[2] === 'object'
            );
            const persistKeyLiteral = formatLiteral(scopedNodeId);
            const fallbackValueExpr =
                hasConnectedValueInput && valueInput && valueInput !== 'None'
                    ? valueInput
                    : formatLiteral(safeDefaultValue);
            const rawValueExpr = persistEnabled
                ? `_store.get('_webcontrol', ${persistKeyLiteral}, ${fallbackValueExpr})`
                : fallbackValueExpr;
            const valueExpr = `min(${formatLiteral(bounds.maxValue)}, max(${formatLiteral(
                bounds.minValue
            )}, ${rawValueExpr}))`;

            const hasConnectedTitleInput = Boolean(
                inputSources[1] && typeof inputSources[1] === 'object'
            );
            const titleExpr =
                hasConnectedTitleInput && titleInput && titleInput !== 'None'
                    ? titleInput
                    : formatLiteral(defaultTitle);

            const frontendKeyLiteral = formatLiteral(frontendKey);
            const publishKeyLiteral = formatLiteral(publishKey);
            const minLiteral = formatLiteral(bounds.minValue);
            const maxLiteral = formatLiteral(bounds.maxValue);
            const stepLiteral = formatLiteral(bounds.step);

            const loopLines = [
                `# ${WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION}`,
                `(${outValVar}, ${pushVar}) = ${ctrlVar}.update(${valueExpr}, ${WEBVIEW_CONSUME_FUNCTION_NAME}, ${frontendKeyLiteral}, sync_epoch=${WEBVIEW_GET_SYNC_EPOCH_FUNCTION_NAME}())`,
                valueOutput
                    ? `${valueOutput} = ${outValVar}`
                    : '# webview:web-view-slider:loop (no connected value output)',
                changedOutput
                    ? `${changedOutput} = ${ctrlVar}.output_changed`
                    : '# webview:web-view-slider:loop (no connected changed output)',
                ...(persistEnabled
                    ? [`_store.set('_webcontrol', ${persistKeyLiteral}, ${outValVar})`]
                    : []),
                elementOutput && parentInput !== 'None'
                    ? `${elementOutput} = ${parentInput}`
                    : '# webview:web-view-slider:loop (no connected element output)',
                `if ${pushVar}:`,
                `    ${WEBVIEW_PUBLISH_FUNCTION_NAME}({${publishKeyLiteral}: {'kind': 'slider', 'value': ${outValVar}, 'title': ${titleExpr}, 'min': ${minLiteral}, 'max': ${maxLiteral}, 'step': ${stepLiteral}}})`,
            ].filter((line) => line !== '');

            return { statement: loopLines.join('\n') };
        };
    }

    // -------------------------------------------------------------------------
    // Register generators
    // -------------------------------------------------------------------------

    globalScope.NodeInitGenerators.webviewSlider = createSliderInitGenerator();
    globalScope.NodeCodeGenerators.webviewSlider = createSliderLoopGenerator();
    globalScope.NodeHelperGenerators.webviewSlider = shared.createHelperContributionGenerator(
        'web-view-slider',
        42
    );

    // -------------------------------------------------------------------------
    // WebviewNodeBase subclass
    // -------------------------------------------------------------------------

    class SliderWebviewNode extends WebviewNodeBase {
        normalizeControls(controls) {
            const source = controls && typeof controls === 'object' ? controls : {};
            const bounds = normalizeSliderBounds(source);
            return {
                minValue: bounds.minValue,
                maxValue: bounds.maxValue,
                step: bounds.step,
                title: typeof source.title === 'string' ? source.title : '',
                value: clampValue(
                    toFiniteNumber(source.value, 0),
                    bounds.minValue,
                    bounds.maxValue
                ),
            };
        }

        getWebserverCapabilities() {
            return { needsWebDataStore: true, requiresPostRefresh: true };
        }

        getRefreshTransientKeyPrefixes() {
            return ['frontend:wv_bind_slider'];
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

            const bounds = normalizeSliderBounds(controls);
            const title = typeof controls.title === 'string' ? controls.title : '';
            const value = clampValue(
                toFiniteNumber(controls.value, 0),
                bounds.minValue,
                bounds.maxValue
            );

            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_slider_${normalizeBindingSegment(nodeId)}`;
            const payloadKey =
                typeof element?.binding?.payloadKey === 'string'
                    ? element.binding.payloadKey.trim()
                    : '';

            return [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-input-control wv-slider" data-wv-payload-key="${escapeHtml(payloadKey)}" data-wv-input-kind="slider" data-wv-min="${bounds.minValue}" data-wv-max="${bounds.maxValue}" data-wv-step="${bounds.step}">`,
                `${childIndent}<div class="wv-slider-track">`,
                `${childIndent}  <input type="range" class="wv-slider-input" min="${bounds.minValue}" max="${bounds.maxValue}" step="${bounds.step}" value="${escapeHtml(String(value))}" />`,
                `${childIndent}  <span class="wv-slider-value">${escapeHtml(String(value))}</span>`,
                `${childIndent}  <span class="wv-slider-label">${escapeHtml(title)}</span>`,
                `${childIndent}</div>`,
                `${indent}</div>`,
            ];
        }

        renderClientUpdateHandler() {
            return [
                'function applySliderUpdate(targetElement, entry) {',
                '  const inputEl = targetElement.querySelector("input.wv-slider-input");',
                '  const labelEl = targetElement.querySelector("span.wv-slider-label");',
                '  const valueEl = targetElement.querySelector("span.wv-slider-value");',
                '  if (inputEl && entry.value !== undefined) {',
                '    const newValue = String(entry.value);',
                '    if (inputEl.value !== newValue) {',
                '      inputEl.value = newValue;',
                '    }',
                '    if (valueEl && valueEl.textContent !== newValue) {',
                '      valueEl.textContent = newValue;',
                '    }',
                '  }',
                '  if (inputEl) {',
                '    if (entry.min !== undefined && inputEl.min !== String(entry.min)) {',
                '      inputEl.min = String(entry.min);',
                '    }',
                '    if (entry.max !== undefined && inputEl.max !== String(entry.max)) {',
                '      inputEl.max = String(entry.max);',
                '    }',
                '    if (entry.step !== undefined && inputEl.step !== String(entry.step)) {',
                '      inputEl.step = String(entry.step);',
                '    }',
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
                'function initializeSliders() {',
                '  const sliderControls = Array.from(document.querySelectorAll(".wv-slider"));',
                '  sliderControls.forEach(function (containerEl) {',
                '    if (containerEl.getAttribute("data-wv-slider-ready") === "true") return;',
                '    const inputEl = containerEl.querySelector("input.wv-slider-input");',
                '    if (!inputEl) return;',
                '    inputEl.addEventListener("input", function () {',
                '      const valueEl = containerEl.querySelector("span.wv-slider-value");',
                '      if (valueEl) {',
                '        valueEl.textContent = inputEl.value;',
                '      }',
                '      const payloadKey = containerEl.getAttribute("data-wv-payload-key") || "";',
                '      if (!payloadKey) return;',
                '      const frontendKey = "frontend:" + payloadKey;',
                '      const existingTimer = containerEl.getAttribute("data-wv-slider-debounce-id");',
                '      if (existingTimer) { clearTimeout(Number(existingTimer)); }',
                '      const timerId = setTimeout(function () {',
                '        const val = Number(inputEl.value);',
                '        if (!Number.isFinite(val)) return;',
                '        if (typeof document === "undefined" || !document.hidden) {',
                '          postRefreshWithTimeout({ [frontendKey]: { kind: "slider", value: val } })',
                '            .catch(() => {});',
                '        }',
                '      }, 50);',
                '      containerEl.setAttribute("data-wv-slider-debounce-id", String(timerId));',
                '    });',
                '    containerEl.setAttribute("data-wv-slider-ready", "true");',
                '  });',
                '}',
            ];
        }

        renderClientInitHooks() {
            return ['initializeSliders();'];
        }

        renderClientStyleRules() {
            return [
                '    .wv-slider-track { position: relative; display: flex; align-items: center; flex: 1 1 auto; min-width: 0; padding-top: 12px; }',
                '    .wv-slider-input { flex: 1 1 auto; min-width: 0; }',
                '    .wv-slider-value { flex: 0 0 auto; min-width: 2.5ch; margin-left: 6px; text-align: right; font-size: 0.8rem; color: var(--wv-input-color, #d0d8f0); }',
                '    .wv-slider-label { position: absolute; left: 0; top: -2px; font-size: 0.75rem; color: var(--wv-input-label-color, #8fa6c8); }',
            ];
        }
    }

    shared.registerNodeKindImplementation('web-view-slider', new SliderWebviewNode());
})();





