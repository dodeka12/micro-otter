// Webview joystick-display generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    const WEBVIEW_PUBLISH_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.publish_webview_values';
    const WEBVIEW_CONSUME_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.consume_webview_values_keys';
    const WEBVIEW_UTILS_MODULE_ALIAS = '_wv_utils';
    const WEBVIEW_JOYSTICK_MODULE_ALIAS = '_wv_joystick';
    const WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION = 'webview-runtime/strict-v1';
    if (!shared) {
        throw new Error(
            'Webview shared generator module must load before joystick-display generator.'
        );
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before joystick-display generator.');
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

        return {
            nodeId,
            outputIndex,
        };
    }

    function createLayoutBinding(scopedNodeId, slotIndex) {
        const resolvedSlotIndex = Number.isFinite(slotIndex) ? slotIndex : null;
        return {
            elementId: buildBindingId('wv_el', 'joystick', scopedNodeId, resolvedSlotIndex),
            payloadKey: buildBindingId('wv_bind', 'joystick', scopedNodeId, resolvedSlotIndex),
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

    function toFiniteInt(value, fallbackValue) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallbackValue;
        }
        return Math.floor(numeric);
    }

    function normalizeRadarFillColor(value) {
        const candidate = typeof value === 'string' ? value.trim() : '';
        if (/^#[0-9a-fA-F]{6}$/.test(candidate) || /^#[0-9a-fA-F]{3}$/.test(candidate)) {
            return candidate;
        }
        return '#70d6ff';
    }

    function normalizeJoystickOuterRadiusPx(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 64;
        }
        const integerRadius = Math.floor(numeric);
        return integerRadius < 1 ? 1 : integerRadius;
    }

    function normalizeJoystickInnerRadiusPx(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 10;
        }
        const integerRadius = Math.floor(numeric);
        return integerRadius < 1 ? 1 : integerRadius;
    }

    function normalizeJoystickStrokeWidthPx(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 2;
        }
        if (numeric < 0) {
            return 0;
        }
        return numeric;
    }

    function normalizeJoystickMarkIntervalDeg(value) {
        const numeric = toFiniteInt(value, 30);
        if (numeric === 15 || numeric === 30 || numeric === 45 || numeric === 90) {
            return numeric;
        }
        return 30;
    }

    function normalizeJoystickBoolean(value, fallbackValue = false) {
        if (value === undefined || value === null) {
            return Boolean(fallbackValue);
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') {
                return true;
            }
            if (normalized === 'false') {
                return false;
            }
        }
        return Boolean(value);
    }

    function registerStrictRuntimeImports(helperContext) {
        const registerImport =
            helperContext && typeof helperContext.registerImport === 'function'
                ? helperContext.registerImport
                : null;
        if (!registerImport) {
            return;
        }

        registerImport('import math');
    }

    function toJoystickRadians(angleDeg) {
        return ((Number(angleDeg) || 0) - 90) * (Math.PI / 180);
    }

    function buildJoystickInnerPosition(outerRadiusPx, innerRadiusPx, axis1Raw, axis2Raw) {
        const outerRadius = Math.max(1, Number(outerRadiusPx));
        const innerRadius = Math.max(1, Number(innerRadiusPx));
        const center = outerRadius;
        let axis1 = Number.isFinite(Number(axis1Raw)) ? Number(axis1Raw) : 0;
        let axis2 = Number.isFinite(Number(axis2Raw)) ? Number(axis2Raw) : 0;
        axis1 = Math.max(-1, Math.min(1, axis1));
        axis2 = Math.max(-1, Math.min(1, axis2));
        const maxDistance = Math.max(0, outerRadius - innerRadius);
        return {
            x: center + axis1 * maxDistance,
            // Visualization frame: positive Y is up (screen Y decreases upward).
            y: center - axis2 * maxDistance,
        };
    }

    function buildJoystickMarkLines(outerRadiusPx, intervalDeg) {
        const marks = [];
        const safeOuterRadius = Math.max(1, Number(outerRadiusPx));
        const center = safeOuterRadius;
        const safeInterval = normalizeJoystickMarkIntervalDeg(intervalDeg);
        const markLength = Math.max(4, Math.min(12, safeOuterRadius * 0.12));

        for (let angle = 0; angle < 360; angle += safeInterval) {
            const angleRad = toJoystickRadians(angle);
            const innerRadius = safeOuterRadius - markLength;
            const x1 = center + Math.cos(angleRad) * innerRadius;
            const y1 = center + Math.sin(angleRad) * innerRadius;
            const x2 = center + Math.cos(angleRad) * safeOuterRadius;
            const y2 = center + Math.sin(angleRad) * safeOuterRadius;
            marks.push(
                `<line class="wv-joystick-mark" x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}"></line>`
            );
        }

        return marks;
    }

    function createWebviewJoystickDisplayLoopGenerator() {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const elementOutput = safeOutputs[0] || '';
            const axis1Output = safeOutputs[1] || '';
            const axis2Output = safeOutputs[2] || '';
            const changedOutput = safeOutputs[3] || '';
            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';
            const axis1Input =
                typeof inputs[2] === 'string' && inputs[2].trim() ? inputs[2].trim() : 'None';
            const axis2Input =
                typeof inputs[3] === 'string' && inputs[3].trim() ? inputs[3].trim() : 'None';
            const inputSources = Array.isArray(context?.inputSources) ? context.inputSources : [];
            const hasConnectedAxis1Input = Boolean(
                inputSources[2] && typeof inputSources[2] === 'object'
            );
            const hasConnectedAxis2Input = Boolean(
                inputSources[3] && typeof inputSources[3] === 'object'
            );

            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = normalizeGraphId(context?.graph?.id);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);
            const controls =
                node.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};
            const defaultUseUserInput = normalizeJoystickBoolean(
                normalizeControlValue(controls, 'useUserInput', false),
                false
            );
            const defaultUseUserInputSelector = defaultUseUserInput ? 'True' : 'False';
            const rawUseUserInputSelector = typeof inputs[1] === 'string' ? inputs[1].trim() : '';
            const useUserInputSelector =
                rawUseUserInputSelector && rawUseUserInputSelector !== 'None'
                    ? rawUseUserInputSelector
                    : defaultUseUserInputSelector;

            const outerRadiusPx = normalizeJoystickOuterRadiusPx(
                normalizeControlValue(controls, 'outerRadiusPx', 64)
            );
            const outerStrokeWidthPx = normalizeJoystickStrokeWidthPx(
                normalizeControlValue(controls, 'outerStrokeWidthPx', 2)
            );
            const outerStrokeColor = normalizeRadarFillColor(
                normalizeControlValue(controls, 'outerStrokeColor', '#8db5ff')
            );
            const outerFillColor = normalizeRadarFillColor(
                normalizeControlValue(controls, 'outerFillColor', '#0f1526')
            );
            const innerRadiusPx = normalizeJoystickInnerRadiusPx(
                normalizeControlValue(controls, 'innerRadiusPx', 10)
            );
            const innerFillColor = normalizeRadarFillColor(
                normalizeControlValue(controls, 'innerFillColor', '#70d6ff')
            );
            const showDegreeMarks = normalizeJoystickBoolean(
                normalizeControlValue(controls, 'showDegreeMarks', true),
                true
            );
            const degreeMarkIntervalDeg = normalizeJoystickMarkIntervalDeg(
                normalizeControlValue(controls, 'degreeMarkIntervalDeg', 30)
            );
            const degreeMarkColor = normalizeRadarFillColor(
                normalizeControlValue(controls, 'degreeMarkColor', '#7fa1d6')
            );
            const recenterOnRelease = normalizeJoystickBoolean(
                normalizeControlValue(controls, 'recenterOnRelease', true),
                true
            );

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

            const helpers =
                context?.helpers && typeof context.helpers === 'object' ? context.helpers : {};
            registerStrictRuntimeImports(helpers);
            const registerImport =
                typeof helpers.registerImport === 'function' ? helpers.registerImport : null;
            if (registerImport) {
                registerImport(`import otter_webview.utils as ${WEBVIEW_UTILS_MODULE_ALIAS}`);
                registerImport(`import otter_webview.joystick as ${WEBVIEW_JOYSTICK_MODULE_ALIAS}`);
            }
            const formatLiteral =
                typeof helpers.formatLiteral === 'function'
                    ? helpers.formatLiteral
                    : (value) => JSON.stringify(value);

            const outputStatements = [];
            if (elementOutput && parentInput !== 'None') {
                outputStatements.push(`${elementOutput} = ${parentInput}`);
            } else {
                outputStatements.push(
                    '# webview:joystick-display:loop (output passthrough unavailable)'
                );
            }
            if (axis1Output) {
                outputStatements.push(`${axis1Output} = _wv_joystick_axis1`);
            }
            if (axis2Output) {
                outputStatements.push(`${axis2Output} = _wv_joystick_axis2`);
            }
            if (changedOutput) {
                outputStatements.push(
                    `${changedOutput} = _wv_joystick_state.get('outputChanged', False)`
                );
            } else {
                outputStatements.push(
                    '# webview:joystick-display:loop (no connected changed output)'
                );
            }

            const nodeKeyLiteral = formatLiteral(publishKey);
            const joystickStateKeyLiteral = formatLiteral(`joystick:${publishKey}`);
            const frontendJoystickKeyLiteral = formatLiteral(`frontend:joystick:${publishKey}`);

            const connectorAxis1Expr =
                hasConnectedAxis1Input || hasConnectedAxis2Input
                    ? axis1Input
                    : "_wv_joystick_state.get('axis1', 0.0)";
            const connectorAxis2Expr =
                hasConnectedAxis1Input || hasConnectedAxis2Input
                    ? axis2Input
                    : "_wv_joystick_state.get('axis2', 0.0)";

            const loopLines = [
                `# ${WEBVIEW_STRICT_RUNTIME_CONTRACT_VERSION}`,
                `_wv_joystick_bind_key = ${nodeKeyLiteral}`,
                `_wv_joystick_state = ${WEBVIEW_JOYSTICK_MODULE_ALIAS}.ensure_state(${WEBVIEW_JOYSTICK_MODULE_ALIAS}.state_store(), ${joystickStateKeyLiteral})`,
                `_wv_joystick_use_user_mode = ${WEBVIEW_UTILS_MODULE_ALIAS}.to_bool(${useUserInputSelector}, False)`,
                'if _wv_joystick_use_user_mode:',
                `    _wv_joystick_frontend = ${WEBVIEW_JOYSTICK_MODULE_ALIAS}.consume_frontend_payload(${WEBVIEW_CONSUME_FUNCTION_NAME}, ${frontendJoystickKeyLiteral})`,
                'else:',
                '    _wv_joystick_frontend = None',
                `_wv_joystick_axis1, _wv_joystick_axis2 = ${WEBVIEW_JOYSTICK_MODULE_ALIAS}.resolve_output_values(_wv_joystick_state, _wv_joystick_frontend, ${connectorAxis1Expr}, ${connectorAxis2Expr}, _wv_joystick_use_user_mode)`,
                ...outputStatements,
                `${WEBVIEW_PUBLISH_FUNCTION_NAME}({_wv_joystick_bind_key: { 'kind': 'joystick-display', 'outerRadiusPx': ${formatLiteral(outerRadiusPx)}, 'outerStrokeWidthPx': ${formatLiteral(outerStrokeWidthPx)}, 'outerStrokeColor': ${formatLiteral(outerStrokeColor)}, 'outerFillColor': ${formatLiteral(outerFillColor)}, 'innerRadiusPx': ${formatLiteral(innerRadiusPx)}, 'innerFillColor': ${formatLiteral(innerFillColor)}, 'showDegreeMarks': ${showDegreeMarks ? 'True' : 'False'}, 'degreeMarkIntervalDeg': ${formatLiteral(degreeMarkIntervalDeg)}, 'degreeMarkColor': ${formatLiteral(degreeMarkColor)}, 'recenterOnRelease': ${recenterOnRelease ? 'True' : 'False'}, 'useUserInput': _wv_joystick_use_user_mode, 'axis1': _wv_joystick_axis1, 'axis2': _wv_joystick_axis2 }})`,
            ].filter((line) => line !== '');

            return {
                statement: loopLines.join('\n'),
            };
        };
    }

    globalScope.NodeInitGenerators.webviewJoystickDisplay =
        shared.createWebviewDynamicInitGenerator('joystick-display');
    globalScope.NodeCodeGenerators.webviewJoystickDisplay =
        createWebviewJoystickDisplayLoopGenerator();
    globalScope.NodeHelperGenerators.webviewJoystickDisplay =
        shared.createHelperContributionGenerator('joystick-display', 59);

    class JoystickDisplayWebviewNode extends WebviewNodeBase {
        getRefreshHookImports() {
            return [
                'def _wv_normalize_joystick_frontend_updates(request_payload):',
                '    import otter_webview.joystick as _wv_joystick_module',
                '    normalize_updates = getattr(_wv_joystick_module, "normalize_frontend_updates", None)',
                '    if not callable(normalize_updates):',
                '        raise RuntimeError("Joystick runtime module is missing normalize_frontend_updates(request_payload)")',
                '    normalized_updates = normalize_updates(request_payload)',
                '    if not isinstance(normalized_updates, dict):',
                '        raise RuntimeError("normalize_frontend_updates() must return a dict")',
                '    return normalized_updates',
            ];
        }

        getRefreshRequestValueNormalizers() {
            return ['_wv_normalize_joystick_frontend_updates'];
        }

        getRefreshTransientKeyPrefixes() {
            return ['frontend:joystick:'];
        }

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
            const normalizeOuterRadius =
                typeof context.normalizeJoystickOuterRadiusPx === 'function'
                    ? context.normalizeJoystickOuterRadiusPx
                    : (value) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return 64;
                          }
                          const integerRadius = Math.floor(numeric);
                          return integerRadius < 1 ? 1 : integerRadius;
                      };
            const normalizeStrokeWidth =
                typeof context.normalizeJoystickStrokeWidthPx === 'function'
                    ? context.normalizeJoystickStrokeWidthPx
                    : (value) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return 2;
                          }
                          if (numeric < 0) {
                              return 0;
                          }
                          return numeric;
                      };
            const normalizeInnerRadius =
                typeof context.normalizeJoystickInnerRadiusPx === 'function'
                    ? context.normalizeJoystickInnerRadiusPx
                    : (value) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return 10;
                          }
                          const integerRadius = Math.floor(numeric);
                          return integerRadius < 1 ? 1 : integerRadius;
                      };
            const normalizeMarkInterval =
                typeof context.normalizeJoystickMarkIntervalDeg === 'function'
                    ? context.normalizeJoystickMarkIntervalDeg
                    : (value) => {
                          const numeric = Number.isFinite(Number(value))
                              ? Math.floor(Number(value))
                              : 30;
                          return [15, 30, 45, 90].includes(numeric) ? numeric : 30;
                      };
            const normalizeBool =
                typeof context.normalizeJoystickBoolean === 'function'
                    ? context.normalizeJoystickBoolean
                    : (value, fallbackValue = false) => {
                          if (value === undefined || value === null) {
                              return Boolean(fallbackValue);
                          }
                          if (typeof value === 'string') {
                              const normalized = value.trim().toLowerCase();
                              if (normalized === 'true') {
                                  return true;
                              }
                              if (normalized === 'false') {
                                  return false;
                              }
                          }
                          return Boolean(value);
                      };
            const normalizeColor =
                typeof context.normalizeRadarFillColor === 'function'
                    ? context.normalizeRadarFillColor
                    : (value) => {
                          const candidate = typeof value === 'string' ? value.trim() : '';
                          if (
                              /^#[0-9a-fA-F]{6}$/.test(candidate) ||
                              /^#[0-9a-fA-F]{3}$/.test(candidate)
                          ) {
                              return candidate;
                          }
                          return '#70d6ff';
                      };

            return {
                outerRadiusPx: normalizeOuterRadius(
                    normalizeControlValue(controls, 'outerRadiusPx', 64)
                ),
                outerStrokeWidthPx: normalizeStrokeWidth(
                    normalizeControlValue(controls, 'outerStrokeWidthPx', 2)
                ),
                outerStrokeColor: normalizeColor(
                    normalizeControlValue(controls, 'outerStrokeColor', '#8db5ff')
                ),
                outerFillColor: normalizeColor(
                    normalizeControlValue(controls, 'outerFillColor', '#0f1526')
                ),
                innerRadiusPx: normalizeInnerRadius(
                    normalizeControlValue(controls, 'innerRadiusPx', 10)
                ),
                innerFillColor: normalizeColor(
                    normalizeControlValue(controls, 'innerFillColor', '#70d6ff')
                ),
                showDegreeMarks: normalizeBool(
                    normalizeControlValue(controls, 'showDegreeMarks', true),
                    true
                ),
                degreeMarkIntervalDeg: normalizeMarkInterval(
                    normalizeControlValue(controls, 'degreeMarkIntervalDeg', 30)
                ),
                degreeMarkColor: normalizeColor(
                    normalizeControlValue(controls, 'degreeMarkColor', '#7fa1d6')
                ),
                useUserInput: normalizeBool(
                    normalizeControlValue(controls, 'useUserInput', false),
                    false
                ),
                recenterOnRelease: normalizeBool(
                    normalizeControlValue(controls, 'recenterOnRelease', true),
                    true
                ),
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
            const controls =
                element?.controls && typeof element.controls === 'object' ? element.controls : {};
            const escapeHtml =
                typeof context?.escapeHtml === 'function'
                    ? context.escapeHtml
                    : (value) => String(value === undefined || value === null ? '' : value);
            const outerRadiusPx = normalizeJoystickOuterRadiusPx(controls.outerRadiusPx);
            const outerStrokeWidthPx = normalizeJoystickStrokeWidthPx(controls.outerStrokeWidthPx);
            const outerStrokeColor = String(controls.outerStrokeColor || '#8db5ff');
            const outerFillColor = String(controls.outerFillColor || '#0f1526');
            const innerRadiusPx = normalizeJoystickInnerRadiusPx(controls.innerRadiusPx);
            const innerFillColor = String(controls.innerFillColor || '#70d6ff');
            const showDegreeMarks = normalizeJoystickBoolean(controls.showDegreeMarks, true);
            const degreeMarkIntervalDeg = normalizeJoystickMarkIntervalDeg(
                controls.degreeMarkIntervalDeg
            );
            const degreeMarkColor = String(controls.degreeMarkColor || '#7fa1d6');
            const useUserInput = normalizeJoystickBoolean(controls.useUserInput, false);
            const recenterOnRelease = normalizeJoystickBoolean(controls.recenterOnRelease, true);
            const axis1 = 0;
            const axis2 = 0;
            const diameter = outerRadiusPx * 2;
            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_joystick_${normalizeBindingSegment(nodeId)}`;
            const payloadKey =
                typeof element?.binding?.payloadKey === 'string'
                    ? element.binding.payloadKey.trim()
                    : '';
            const innerPosition = buildJoystickInnerPosition(
                outerRadiusPx,
                innerRadiusPx,
                axis1,
                axis2
            );
            const markLines = showDegreeMarks
                ? buildJoystickMarkLines(outerRadiusPx, degreeMarkIntervalDeg)
                : [];

            return [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-content wv-joystick-display" data-node-id="${escapeHtml(nodeId)}" data-node-kind="joystick-display" data-wv-payload-key="${escapeHtml(payloadKey)}" data-wv-joystick-outer-radius-px="${outerRadiusPx}" data-wv-joystick-outer-stroke-width-px="${escapeHtml(outerStrokeWidthPx)}" data-wv-joystick-outer-stroke-color="${escapeHtml(outerStrokeColor)}" data-wv-joystick-outer-fill-color="${escapeHtml(outerFillColor)}" data-wv-joystick-inner-radius-px="${innerRadiusPx}" data-wv-joystick-inner-fill-color="${escapeHtml(innerFillColor)}" data-wv-joystick-show-degree-marks="${showDegreeMarks ? 'true' : 'false'}" data-wv-joystick-degree-mark-interval-deg="${degreeMarkIntervalDeg}" data-wv-joystick-degree-mark-color="${escapeHtml(degreeMarkColor)}" data-wv-joystick-recenter-on-release="${recenterOnRelease ? 'true' : 'false'}" data-wv-joystick-use-user-input="${useUserInput ? 'true' : 'false'}" data-wv-joystick-axis1="${axis1}" data-wv-joystick-axis2="${axis2}" data-wv-joystick-drag-active="false" data-wv-joystick-drag-end-pending="false">`,
                `${childIndent}<svg class="wv-joystick-svg" role="img" aria-label="Joystick display" viewBox="0 0 ${diameter} ${diameter}" width="${diameter}" height="${diameter}">`,
                `${childIndent}  <rect class="wv-joystick-outer" x="0" y="0" width="${diameter}" height="${diameter}" fill="${escapeHtml(outerFillColor)}" stroke="${escapeHtml(outerStrokeColor)}" stroke-width="${escapeHtml(outerStrokeWidthPx)}"></rect>`,
                `${childIndent}  <g class="wv-joystick-marks" data-wv-joystick-role="marks" stroke="${escapeHtml(degreeMarkColor)}" ${showDegreeMarks ? '' : 'hidden'}>`,
                ...markLines.map((line) => `${childIndent}    ${line}`),
                `${childIndent}  </g>`,
                `${childIndent}  <circle class="wv-joystick-inner" data-wv-joystick-role="inner" cx="${innerPosition.x.toFixed(3)}" cy="${innerPosition.y.toFixed(3)}" r="${innerRadiusPx}" fill="${escapeHtml(innerFillColor)}"></circle>`,
                `${childIndent}</svg>`,
                `${indent}</div>`,
            ];
        }

        renderClientUpdateHandler() {
            return [
                'function applyJoystickDisplayUpdate(targetElement, entry) {',
                '  const localUserUpdate = Boolean(entry && entry._localUserInput === true);',
                '  const dragActive = (targetElement.getAttribute("data-wv-joystick-drag-active") ?? "false").toLowerCase() !== "false";',
                '  const dragEndPending = (targetElement.getAttribute("data-wv-joystick-drag-end-pending") ?? "false").toLowerCase() !== "false";',
                '  const payloadKey = targetElement.getAttribute("data-wv-payload-key") ?? "";',
                '  logJoystickFlow("apply-update:received", {',
                '    payloadKey,',
                '    localUserUpdate,',
                '    dragActive,',
                '    dragEndPending,',
                '    axis1: entry?.axis1,',
                '    axis2: entry?.axis2,',
                '  });',
                '  if (!localUserUpdate && dragActive) {',
                '    logJoystickFlow("apply-update:blocked", { reason: "drag-active", payloadKey });',
                '    return false;',
                '  }',
                '  if (!localUserUpdate && dragEndPending) {',
                '    const incomingAxis1 = Number(entry?.axis1);',
                '    const incomingAxis2 = Number(entry?.axis2);',
                '    const hasIncomingAxes = Number.isFinite(incomingAxis1) && Number.isFinite(incomingAxis2);',
                '    if (hasIncomingAxes && isJoystickReleaseAckMatch(payloadKey, incomingAxis1, incomingAxis2)) {',
                '      targetElement.setAttribute("data-wv-joystick-drag-end-pending", "false");',
                '      clearJoystickReleaseAck(payloadKey);',
                '      logJoystickFlow("drag-end-pending:cleared", { payloadKey, reason: "release-ack", axis1: incomingAxis1, axis2: incomingAxis2 });',
                '    } else {',
                '      logJoystickFlow("apply-update:blocked", { reason: "drag-end-pending", payloadKey, axis1: entry?.axis1, axis2: entry?.axis2 });',
                '      return false;',
                '    }',
                '  }',
                '  const svgElement = targetElement.querySelector(".wv-joystick-svg");',
                '  const innerElement = targetElement.querySelector("[data-wv-joystick-role=inner]");',
                '  const marksElement = targetElement.querySelector("[data-wv-joystick-role=marks]");',
                '  const outerRadiusPx = Math.max(1, Number(entry.outerRadiusPx ?? targetElement.getAttribute("data-wv-joystick-outer-radius-px") ?? 64));',
                '  const outerStrokeWidthPx = Math.max(0, Number(entry.outerStrokeWidthPx ?? targetElement.getAttribute("data-wv-joystick-outer-stroke-width-px") ?? 2));',
                '  const outerStrokeColor = String(entry.outerStrokeColor ?? targetElement.getAttribute("data-wv-joystick-outer-stroke-color") ?? "#8db5ff");',
                '  const outerFillColor = String(entry.outerFillColor ?? targetElement.getAttribute("data-wv-joystick-outer-fill-color") ?? "#0f1526");',
                '  const innerRadiusPx = Math.max(1, Number(entry.innerRadiusPx ?? targetElement.getAttribute("data-wv-joystick-inner-radius-px") ?? 10));',
                '  const innerFillColor = String(entry.innerFillColor ?? targetElement.getAttribute("data-wv-joystick-inner-fill-color") ?? "#70d6ff");',
                '  const degreeMarkIntervalDegRaw = Number(entry.degreeMarkIntervalDeg ?? targetElement.getAttribute("data-wv-joystick-degree-mark-interval-deg") ?? 30);',
                '  const degreeMarkIntervalDeg = [15, 30, 45, 90].includes(degreeMarkIntervalDegRaw) ? degreeMarkIntervalDegRaw : 30;',
                '  const degreeMarkColor = String(entry.degreeMarkColor ?? targetElement.getAttribute("data-wv-joystick-degree-mark-color") ?? "#7fa1d6");',
                '  const showDegreeMarksRaw = entry.showDegreeMarks ?? targetElement.getAttribute("data-wv-joystick-show-degree-marks") ?? "true";',
                '  const showDegreeMarks = String(showDegreeMarksRaw).toLowerCase() !== "false";',
                '  const recenterOnReleaseRaw = entry.recenterOnRelease ?? targetElement.getAttribute("data-wv-joystick-recenter-on-release") ?? "true";',
                '  const recenterOnRelease = String(recenterOnReleaseRaw).toLowerCase() !== "false";',
                '  const useUserInputRaw = entry.useUserInput ?? targetElement.getAttribute("data-wv-joystick-use-user-input") ?? "false";',
                '  const useUserInput = String(useUserInputRaw).toLowerCase() !== "false";',
                '  const axis1Raw = Number(entry.axis1 ?? targetElement.getAttribute("data-wv-joystick-axis1") ?? 0);',
                '  const axis2Raw = Number(entry.axis2 ?? targetElement.getAttribute("data-wv-joystick-axis2") ?? 0);',
                '  let axis1 = Number.isFinite(axis1Raw) ? Math.max(-1, Math.min(1, axis1Raw)) : 0;',
                '  let axis2 = Number.isFinite(axis2Raw) ? Math.max(-1, Math.min(1, axis2Raw)) : 0;',
                '  const diameter = outerRadiusPx * 2;',
                '  targetElement.setAttribute("data-wv-joystick-outer-radius-px", String(outerRadiusPx));',
                '  targetElement.setAttribute("data-wv-joystick-outer-stroke-width-px", String(outerStrokeWidthPx));',
                '  targetElement.setAttribute("data-wv-joystick-outer-stroke-color", outerStrokeColor);',
                '  targetElement.setAttribute("data-wv-joystick-outer-fill-color", outerFillColor);',
                '  targetElement.setAttribute("data-wv-joystick-inner-radius-px", String(innerRadiusPx));',
                '  targetElement.setAttribute("data-wv-joystick-inner-fill-color", innerFillColor);',
                '  targetElement.setAttribute("data-wv-joystick-show-degree-marks", showDegreeMarks ? "true" : "false");',
                '  targetElement.setAttribute("data-wv-joystick-degree-mark-interval-deg", String(degreeMarkIntervalDeg));',
                '  targetElement.setAttribute("data-wv-joystick-degree-mark-color", degreeMarkColor);',
                '  targetElement.setAttribute("data-wv-joystick-recenter-on-release", recenterOnRelease ? "true" : "false");',
                '  targetElement.setAttribute("data-wv-joystick-use-user-input", useUserInput ? "true" : "false");',
                '  targetElement.setAttribute("data-wv-joystick-axis1", String(axis1));',
                '  targetElement.setAttribute("data-wv-joystick-axis2", String(axis2));',
                '  if (typeof entry.payloadKey === "string" && entry.payloadKey.trim()) {',
                '    targetElement.setAttribute("data-wv-payload-key", entry.payloadKey.trim());',
                '  }',
                '  if (!svgElement || !innerElement) {',
                '    return false;',
                '  }',
                '  svgElement.setAttribute("viewBox", `0 0 ${diameter} ${diameter}`);',
                '  svgElement.setAttribute("width", String(diameter));',
                '  svgElement.setAttribute("height", String(diameter));',
                '  const outerElement = svgElement.querySelector(".wv-joystick-outer");',
                '  if (outerElement) {',
                '    outerElement.setAttribute("x", "0");',
                '    outerElement.setAttribute("y", "0");',
                '    outerElement.setAttribute("width", String(diameter));',
                '    outerElement.setAttribute("height", String(diameter));',
                '    outerElement.setAttribute("fill", outerFillColor);',
                '    outerElement.setAttribute("stroke", outerStrokeColor);',
                '    outerElement.setAttribute("stroke-width", String(outerStrokeWidthPx));',
                '  }',
                '  if (marksElement) {',
                '    marksElement.setAttribute("stroke", degreeMarkColor);',
                '    marksElement.hidden = !showDegreeMarks;',
                '    marksElement.innerHTML = showDegreeMarks ? buildJoystickMarkLines(outerRadiusPx, degreeMarkIntervalDeg).join("") : "";',
                '  }',
                '  const maxDistance = Math.max(0, outerRadiusPx - innerRadiusPx);',
                '  const innerX = outerRadiusPx + axis1 * maxDistance;',
                '  const innerY = outerRadiusPx - axis2 * maxDistance;',
                '  innerElement.setAttribute("cx", innerX.toFixed(3));',
                '  innerElement.setAttribute("cy", innerY.toFixed(3));',
                '  innerElement.setAttribute("r", String(innerRadiusPx));',
                '  innerElement.setAttribute("fill", innerFillColor);',
                '  initializeJoystickInput(targetElement);',
                '  logJoystickFlow("apply-update:accepted", {',
                '    payloadKey: targetElement.getAttribute("data-wv-payload-key") ?? "",',
                '    localUserUpdate,',
                '    axis1,',
                '    axis2,',
                '  });',
                '  return true;',
                '}',
            ];
        }

        renderClientHelpers() {
            return [
                'function toJoystickRadians(angleDeg) {',
                '  return (Number(angleDeg || 0) - 90) * (Math.PI / 180);',
                '}',
                '',
                'const pendingJoystickUpdates = Object.create(null);',
                'const pendingJoystickReleaseAcks = Object.create(null);',
                '',
                'function logJoystickFlow() {',
                '  // Debug logging intentionally disabled in generated client output.',
                '}',
                '',
                'function queueJoystickFrontendUpdate(targetElement, axis1Raw, axis2Raw) {',
                '  const payloadKey = targetElement.getAttribute("data-wv-payload-key") ?? "";',
                '  if (!payloadKey) {',
                '    logJoystickFlow("queue-skip", { reason: "missing-payload-key" });',
                '    return;',
                '  }',
                '  let axis1 = Number.isFinite(Number(axis1Raw)) ? Number(axis1Raw) : 0;',
                '  let axis2 = Number.isFinite(Number(axis2Raw)) ? Number(axis2Raw) : 0;',
                '  axis1 = Math.max(-1, Math.min(1, axis1));',
                '  axis2 = Math.max(-1, Math.min(1, axis2));',
                '  pendingJoystickUpdates[payloadKey] = {',
                '    axis1,',
                '    axis2,',
                '  };',
                '  logJoystickFlow("queue-update", { payloadKey, axis1, axis2 });',
                '}',
                '',
                'function clearJoystickReleaseAck(payloadKey) {',
                '  if (!payloadKey) {',
                '    return;',
                '  }',
                '  delete pendingJoystickReleaseAcks[payloadKey];',
                '}',
                '',
                'function trackJoystickReleaseAck(payloadKey, update) {',
                '  if (!payloadKey || !update) {',
                '    return;',
                '  }',
                '  const axis1Raw = Number(update.axis1);',
                '  const axis2Raw = Number(update.axis2);',
                '  if (!Number.isFinite(axis1Raw) || !Number.isFinite(axis2Raw)) {',
                '    return;',
                '  }',
                '  const axis1 = Math.max(-1, Math.min(1, axis1Raw));',
                '  const axis2 = Math.max(-1, Math.min(1, axis2Raw));',
                '  pendingJoystickReleaseAcks[payloadKey] = { axis1, axis2 };',
                '  logJoystickFlow("drag-end-pending:await-ack", { payloadKey, axis1, axis2 });',
                '}',
                '',
                'function isJoystickReleaseAckMatch(payloadKey, axis1Raw, axis2Raw) {',
                '  const expected = pendingJoystickReleaseAcks[payloadKey];',
                '  if (!expected) {',
                '    return false;',
                '  }',
                '  const axis1 = Number(axis1Raw);',
                '  const axis2 = Number(axis2Raw);',
                '  if (!Number.isFinite(axis1) || !Number.isFinite(axis2)) {',
                '    return false;',
                '  }',
                '  const epsilon = 0.001;',
                '  return Math.abs(expected.axis1 - axis1) <= epsilon && Math.abs(expected.axis2 - axis2) <= epsilon;',
                '}',
                '',
                'function takePendingJoystickUpdates() {',
                '  const keys = Object.keys(pendingJoystickUpdates);',
                '  if (keys.length === 0) {',
                '    logJoystickFlow("take-pending", { count: 0 });',
                '    return null;',
                '  }',
                '  const updates = {};',
                '  keys.forEach((key) => {',
                '    updates[key] = pendingJoystickUpdates[key];',
                '    delete pendingJoystickUpdates[key];',
                '  });',
                '  logJoystickFlow("take-pending", { count: keys.length, payloadKeys: keys });',
                '  return updates;',
                '}',
                '',
                'function findJoystickElementByPayloadKey(payloadKey) {',
                '  if (!payloadKey) {',
                '    return null;',
                '  }',
                '  const joystickElements = Array.from(document.querySelectorAll("[data-node-kind=joystick-display]"));',
                '  for (let index = 0; index < joystickElements.length; index += 1) {',
                '    const targetElement = joystickElements[index];',
                '    if ((targetElement.getAttribute("data-wv-payload-key") ?? "") === payloadKey) {',
                '      return targetElement;',
                '    }',
                '  }',
                '  return null;',
                '}',
                '',
                'function buildJoystickMarkLines(outerRadiusPx, intervalDeg) {',
                '  const marks = [];',
                '  const safeOuterRadius = Math.max(1, Number(outerRadiusPx));',
                '  const center = safeOuterRadius;',
                '  const safeInterval = [15, 30, 45, 90].includes(Number(intervalDeg)) ? Number(intervalDeg) : 30;',
                '  const markLength = Math.max(4, Math.min(12, safeOuterRadius * 0.12));',
                '  for (let angle = 0; angle < 360; angle += safeInterval) {',
                '    const angleRad = toJoystickRadians(angle);',
                '    const innerRadius = safeOuterRadius - markLength;',
                '    const x1 = center + Math.cos(angleRad) * innerRadius;',
                '    const y1 = center + Math.sin(angleRad) * innerRadius;',
                '    const x2 = center + Math.cos(angleRad) * safeOuterRadius;',
                '    const y2 = center + Math.sin(angleRad) * safeOuterRadius;',
                '    marks.push(`<line class="wv-joystick-mark" x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}"></line>`);',
                '  }',
                '  return marks;',
                '}',
                '',
                'function initializeJoystickInput(targetElement) {',
                '  if (!targetElement || targetElement.getAttribute("data-wv-joystick-input-ready") === "true") {',
                '    return;',
                '  }',
                '  const svgElement = targetElement.querySelector(".wv-joystick-svg");',
                '  if (!svgElement) {',
                '    return;',
                '  }',
                '  let activePointerId = null;',
                '  const updateFromPointerEvent = (event) => {',
                '    const bounds = svgElement.getBoundingClientRect();',
                '    if (!(bounds.width > 0) || !(bounds.height > 0)) {',
                '      return;',
                '    }',
                '    const outerRadiusPx = Math.max(1, Number(targetElement.getAttribute("data-wv-joystick-outer-radius-px") ?? 64));',
                '    const innerRadiusPx = Math.max(1, Number(targetElement.getAttribute("data-wv-joystick-inner-radius-px") ?? 10));',
                '    const baseDiameter = Math.max(1, outerRadiusPx * 2);',
                '    const scaleX = bounds.width / baseDiameter;',
                '    const scaleY = bounds.height / baseDiameter;',
                '    const centerX = bounds.left + bounds.width / 2;',
                '    const centerY = bounds.top + bounds.height / 2;',
                '    const offsetX = Number(event.clientX) - centerX;',
                '    const offsetY = Number(event.clientY) - centerY;',
                '    const maxDistanceX = Math.max(0, (outerRadiusPx - innerRadiusPx) * scaleX);',
                '    const maxDistanceY = Math.max(0, (outerRadiusPx - innerRadiusPx) * scaleY);',
                '    const axis1 = maxDistanceX > 0',
                '      ? Math.max(-1, Math.min(1, offsetX / maxDistanceX))',
                '      : 0;',
                '    const axis2 = maxDistanceY > 0',
                '      ? Math.max(-1, Math.min(1, -offsetY / maxDistanceY))',
                '      : 0;',
                '    applyJoystickDisplayUpdate(targetElement, {',
                '      axis1,',
                '      axis2,',
                '      _localUserInput: true,',
                '      payloadKey: targetElement.getAttribute("data-wv-payload-key") ?? "",',
                '    });',
                '    queueJoystickFrontendUpdate(targetElement, axis1, axis2);',
                '  };',
                '  targetElement.addEventListener("pointerdown", (event) => {',
                '    const useUserInput = (targetElement.getAttribute("data-wv-joystick-use-user-input") ?? "false").toLowerCase() !== "false";',
                '    if (!useUserInput) {',
                '      return;',
                '    }',
                '    if (event.pointerType === "mouse" && event.button !== 0) {',
                '      logJoystickFlow("pointer-down:ignored", { reason: "non-primary-mouse-button", button: event.button });',
                '      return;',
                '    }',
                '    activePointerId = event.pointerId;',
                '    clearJoystickReleaseAck(targetElement.getAttribute("data-wv-payload-key") ?? "");',
                '    targetElement.setAttribute("data-wv-joystick-drag-active", "true");',
                '    targetElement.setAttribute("data-wv-joystick-drag-end-pending", "false");',
                '    logJoystickFlow("pointer-down", { payloadKey: targetElement.getAttribute("data-wv-payload-key") ?? "", pointerId: event.pointerId });',
                '    if (typeof targetElement.setPointerCapture === "function") {',
                '      targetElement.setPointerCapture(event.pointerId);',
                '    }',
                '    updateFromPointerEvent(event);',
                '    event.preventDefault();',
                '  });',
                '  targetElement.addEventListener("pointermove", (event) => {',
                '    if (activePointerId !== event.pointerId) {',
                '      return;',
                '    }',
                '    updateFromPointerEvent(event);',
                '    logJoystickFlow("pointer-move", { payloadKey: targetElement.getAttribute("data-wv-payload-key") ?? "", pointerId: event.pointerId });',
                '    event.preventDefault();',
                '  });',
                '  const clearPointer = (event) => {',
                '    if (activePointerId !== event.pointerId) {',
                '      return;',
                '    }',
                '    activePointerId = null;',
                '    if (typeof targetElement.releasePointerCapture === "function") {',
                '      try {',
                '        targetElement.releasePointerCapture(event.pointerId);',
                '      } catch (error) {',
                '        // ignore capture release errors',
                '      }',
                '    }',
                '    targetElement.setAttribute("data-wv-joystick-drag-active", "false");',
                '    logJoystickFlow("pointer-up", { payloadKey: targetElement.getAttribute("data-wv-payload-key") ?? "", pointerId: event.pointerId });',
                '    const useUserInput = (targetElement.getAttribute("data-wv-joystick-use-user-input") ?? "false").toLowerCase() !== "false";',
                '    const recenterOnRelease = (targetElement.getAttribute("data-wv-joystick-recenter-on-release") ?? "true").toLowerCase() !== "false";',
                '    if (useUserInput) {',
                '      if (recenterOnRelease) {',
                '        applyJoystickDisplayUpdate(targetElement, {',
                '          axis1: 0,',
                '          axis2: 0,',
                '          _localUserInput: true,',
                '          payloadKey: targetElement.getAttribute("data-wv-payload-key") ?? "",',
                '          useUserInput: true,',
                '        });',
                '        queueJoystickFrontendUpdate(targetElement, 0, 0);',
                '      } else {',
                '        const endAxis1 = Number(targetElement.getAttribute("data-wv-joystick-axis1") ?? 0);',
                '        const endAxis2 = Number(targetElement.getAttribute("data-wv-joystick-axis2") ?? 0);',
                '        queueJoystickFrontendUpdate(targetElement, endAxis1, endAxis2);',
                '      }',
                '      targetElement.setAttribute("data-wv-joystick-drag-end-pending", "true");',
                '      logJoystickFlow("drag-end-pending:set", { payloadKey: targetElement.getAttribute("data-wv-payload-key") ?? "", recenterOnRelease });',
                '    }',
                '  };',
                '  targetElement.addEventListener("pointerup", clearPointer);',
                '  targetElement.addEventListener("pointercancel", clearPointer);',
                '  targetElement.setAttribute("data-wv-joystick-input-ready", "true");',
                '}',
                '',
                'function initializeJoystickInputs() {',
                '  const joystickElements = Array.from(document.querySelectorAll("[data-node-kind=joystick-display]"));',
                '  joystickElements.forEach((targetElement) => initializeJoystickInput(targetElement));',
                '}',
            ];
        }

        renderClientInitHooks() {
            return ['initializeJoystickInputs();'];
        }

        renderClientPollRequestHook() {
            return [
                'function contributeJoystickPollRequest(requestPayload) {',
                '  const joystickUpdates = takePendingJoystickUpdates();',
                '  if (joystickUpdates && Object.keys(joystickUpdates).length > 0) {',
                '    requestPayload.joystickUpdates = joystickUpdates;',
                '    logJoystickFlow("poll-request:send-updates", { payloadKeys: Object.keys(joystickUpdates), count: Object.keys(joystickUpdates).length });',
                '    Object.keys(joystickUpdates).forEach((payloadKey) => {',
                '      const targetElement = findJoystickElementByPayloadKey(payloadKey);',
                '      if (!targetElement) {',
                '        logJoystickFlow("drag-end-pending:clear-skip", { payloadKey, reason: "element-not-found" });',
                '        return;',
                '      }',
                '      const dragActive = (targetElement.getAttribute("data-wv-joystick-drag-active") ?? "false").toLowerCase() !== "false";',
                '      const dragEndPending = (targetElement.getAttribute("data-wv-joystick-drag-end-pending") ?? "false").toLowerCase() !== "false";',
                '      if (!dragActive && dragEndPending) {',
                '        trackJoystickReleaseAck(payloadKey, joystickUpdates[payloadKey]);',
                '      }',
                '    });',
                '  } else {',
                '    logJoystickFlow("poll-request:no-updates", {});',
                '  }',
                '}',
            ];
        }

        renderClientStyleRules() {
            return [
                '    .wv-joystick-display { display: inline-flex; align-items: center; justify-content: center; padding: 10px; touch-action: none; user-select: none; }',
                '    .wv-joystick-svg { display: block; width: auto; max-width: 100%; height: auto; }',
                '    .wv-joystick-outer { fill-opacity: 0.9; }',
                '    .wv-joystick-marks { stroke-width: 1; stroke-linecap: round; }',
            ];
        }
    }

    shared.registerNodeKindImplementation('joystick-display', new JoystickDisplayWebviewNode());
})();
