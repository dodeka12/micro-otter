// Webview button generator registration
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
    const WEBVIEW_BUTTON_MODULE_ALIAS = '_wv_button';
    const WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION = 'webview-runtime/strict-v1';

    if (!shared) {
        throw new Error('Webview shared generator module must load before button generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before button generator.');
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
            elementId: buildBindingId('wv_el', 'button', scopedNodeId, resolvedSlotIndex),
            payloadKey: buildBindingId('wv_bind', 'button', scopedNodeId, resolvedSlotIndex),
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

    // -------------------------------------------------------------------------
    // Init generator — element passthrough (no stateful control instance)
    // -------------------------------------------------------------------------

    function createButtonInitGenerator() {
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

            const lines = [`# webview:web-view-button:init id="${nodeId}"`];
            if (elementOutput && parentInput !== 'None') {
                lines.push(`${elementOutput} = ${parentInput}`);
            } else {
                lines.push('# webview:web-view-button:init (no connected element output)');
            }

            return { statement: lines.join('\n') };
        };
    }

    // -------------------------------------------------------------------------
    // Loop generator — consume click and emit a one-cycle true pulse
    // -------------------------------------------------------------------------

    function createButtonLoopGenerator() {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((e) => (typeof e === 'string' ? e.trim() : ''))
                .filter(Boolean);
            const elementOutput = safeOutputs[0] || '';
            const valueOutput = safeOutputs[1] || '';

            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';

            const inputSources = Array.isArray(context?.inputSources) ? context.inputSources : [];

            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = normalizeGraphId(context?.graph?.id);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);

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
                    `import otter_webview.input_control as ${WEBVIEW_BUTTON_MODULE_ALIAS}`
                );
            }

            const pressedVar = `_wv_button_pressed_${normalizeBindingSegment(scopedNodeId)}`;
            const frontendKeyLiteral = formatLiteral(frontendKey);

            const loopLines = [
                `# ${WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION}`,
                `${pressedVar} = ${WEBVIEW_BUTTON_MODULE_ALIAS}.consume_frontend_value(${WEBVIEW_CONSUME_FUNCTION_NAME}, ${frontendKeyLiteral})`,
                valueOutput
                    ? `${valueOutput} = (True if ${pressedVar} is not None else False)`
                    : '# webview:web-view-button:loop (no connected value output)',
                elementOutput && parentInput !== 'None'
                    ? `${elementOutput} = ${parentInput}`
                    : '# webview:web-view-button:loop (no connected element output)',
            ].filter((line) => line !== '');

            return { statement: loopLines.join('\n') };
        };
    }

    // -------------------------------------------------------------------------
    // Register generators
    // -------------------------------------------------------------------------

    globalScope.NodeInitGenerators.webviewButton = createButtonInitGenerator();
    globalScope.NodeCodeGenerators.webviewButton = createButtonLoopGenerator();
    globalScope.NodeHelperGenerators.webviewButton = shared.createHelperContributionGenerator(
        'web-view-button',
        45
    );

    // -------------------------------------------------------------------------
    // WebviewNodeBase subclass
    // -------------------------------------------------------------------------

    class ButtonWebviewNode extends WebviewNodeBase {
        normalizeControls(controls) {
            const source = controls && typeof controls === 'object' ? controls : {};
            return {
                label: typeof source.label === 'string' ? source.label : '',
            };
        }

        getWebserverCapabilities() {
            return { needsWebDataStore: true, requiresPostRefresh: true };
        }

        getRefreshTransientKeyPrefixes() {
            return ['frontend:wv_bind_button'];
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

            const label = typeof controls.label === 'string' ? controls.label : '';
            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId =
                elementId || `wv_el_button_${normalizeBindingSegment(nodeId)}`;
            const payloadKey =
                typeof element?.binding?.payloadKey === 'string'
                    ? element.binding.payloadKey.trim()
                    : '';

            return [
                `${indent}<button id="${escapeHtml(safeElementId)}" class="wv-button" data-wv-payload-key="${escapeHtml(payloadKey)}" data-wv-input-kind="button">`,
                `${childIndent}${escapeHtml(label)}`,
                `${indent}</button>`,
            ];
        }

        renderClientUpdateHandler() {
            return [];
        }

        renderClientHelpers() {
            return [
                'function initializeButtons() {',
                '  const buttonControls = Array.from(document.querySelectorAll(".wv-button"));',
                '  buttonControls.forEach(function (buttonEl) {',
                '    if (buttonEl.getAttribute("data-wv-button-ready") === "true") return;',
                '    buttonEl.addEventListener("click", function () {',
                '      const payloadKey = buttonEl.getAttribute("data-wv-payload-key") || "";',
                '      if (!payloadKey) return;',
                '      const frontendKey = "frontend:" + payloadKey;',
                '      if (typeof document === "undefined" || !document.hidden) {',
                '        postRefreshWithTimeout({ [frontendKey]: { kind: "button", value: true } })',
                '          .catch(() => {});',
                '      }',
                '    });',
                '    buttonEl.addEventListener("pointerdown", function () {',
                '      buttonEl.classList.add("wv-button-pressed");',
                '    });',
                '    buttonEl.addEventListener("pointerup", function () {',
                '      buttonEl.classList.remove("wv-button-pressed");',
                '    });',
                '    buttonEl.addEventListener("pointerleave", function () {',
                '      buttonEl.classList.remove("wv-button-pressed");',
                '    });',
                '    buttonEl.addEventListener("pointercancel", function () {',
                '      buttonEl.classList.remove("wv-button-pressed");',
                '    });',
                '    buttonEl.setAttribute("data-wv-button-ready", "true");',
                '  });',
                '}',
            ];
        }

        renderClientInitHooks() {
            return ['initializeButtons();'];
        }

        renderClientStyleRules() {
            return [
                '    .wv-button { background: var(--wv-input-bg, #0f1526); color: var(--wv-input-color, #d0d8f0); border: 1px solid var(--wv-input-border, #4a5568); border-radius: 4px; padding: 4px 10px; font-size: 0.85rem; cursor: pointer; transition: transform 60ms ease, background-color 60ms ease, border-color 60ms ease, box-shadow 60ms ease; -webkit-tap-highlight-color: transparent; user-select: none; touch-action: manipulation; }',
                '    .wv-button:active, .wv-button.wv-button-pressed { transform: scale(0.96); background: var(--wv-input-bg-active, #1b2742); border-color: var(--wv-input-border-active, #7ea2d0); box-shadow: 0 0 0 1px rgba(126, 190, 255, 0.45); }',
            ];
        }
    }

    shared.registerNodeKindImplementation('web-view-button', new ButtonWebviewNode());
})();
