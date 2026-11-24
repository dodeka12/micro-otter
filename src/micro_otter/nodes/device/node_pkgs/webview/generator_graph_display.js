// Webview graph-display generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    const WEBVIEW_PUBLISH_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.publish_webview_values';
    const WEBVIEW_GRAPH_MODULE_ALIAS = '_wv_graph';
    const GRAPH_DEFAULT_TITLE = 'Line Graph';
    const GRAPH_DEFAULT_HEIGHT_PX = 240;
    const GRAPH_MIN_HEIGHT_PX = 80;
    const GRAPH_MAX_HEIGHT_PX = 1200;
    const GRAPH_DEFAULT_TICK_COUNT = 5;
    const GRAPH_MIN_TICK_COUNT = 2;
    const GRAPH_MAX_TICK_COUNT = 12;
    const GRAPH_DEFAULT_MAX_POINTS = 256;
    const GRAPH_MIN_MAX_POINTS = 2;
    const GRAPH_MAX_MAX_POINTS = 2048;
    const GRAPH_DEFAULT_LINE_COLOR = '#70d6ff';
    if (!shared) {
        throw new Error(
            'Webview shared generator module must load before graph-display generator.'
        );
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before graph-display generator.');
    }

    /**
     * Normalizes an optional graph id to a trimmed string or null.
     * @param {*} value Raw graph id value.
     * @returns {string|null} Normalized graph id.
     */
    function normalizeGraphId(value) {
        const rawValue = value === undefined || value === null ? '' : String(value).trim();
        return rawValue || null;
    }

    /**
     * Builds the graph-scoped node id used by bindings and payload keys.
     * @param {string|null} graphId Normalized graph id.
     * @param {*} nodeId Raw node id.
     * @returns {string} Scoped node id.
     */
    function buildScopedNodeId(graphId, nodeId) {
        const normalizedNodeId =
            nodeId === undefined || nodeId === null ? '' : String(nodeId).trim();
        if (!normalizedNodeId) {
            return 'unknown';
        }

        const normalizedGraphId = normalizeGraphId(graphId);
        return normalizedGraphId ? `${normalizedGraphId}:${normalizedNodeId}` : normalizedNodeId;
    }

    /**
     * Normalizes a binding id segment to lowercase snake case.
     * @param {*} value Raw segment value.
     * @param {string} [fallbackValue] Fallback used when the segment is empty.
     * @returns {string} Normalized segment.
     */
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

    /**
     * Builds a deterministic webview binding id.
     * @param {string} prefix Binding id prefix.
     * @param {string} typeCode Short node kind type code.
     * @param {string} nodeId Scoped node id.
     * @param {number|null} [slotIndex] Optional parent output slot index.
     * @returns {string} Binding id.
     */
    function buildBindingId(prefix, typeCode, nodeId, slotIndex = null) {
        const safeTypeCode = normalizeBindingSegment(typeCode, 'node');
        const safeNodeId = normalizeBindingSegment(nodeId, 'unknown');
        const hasSlotIndex = Number.isFinite(slotIndex) && Number(slotIndex) >= 0;
        const slotSuffix = hasSlotIndex ? `_s${Math.floor(Number(slotIndex))}` : '';
        return `${prefix}_${safeTypeCode}_${safeNodeId}${slotSuffix}`;
    }

    /**
     * Builds the fallback web-node payload key for a scoped node id.
     * @param {string} scopedNodeId Scoped node id.
     * @returns {string} Web-node payload key.
     */
    function buildWebNodeKey(scopedNodeId) {
        const normalizedScopedNodeId =
            scopedNodeId === undefined || scopedNodeId === null ? '' : String(scopedNodeId).trim();
        return `webNode:${normalizedScopedNodeId || 'unknown'}`;
    }

    /**
     * Extracts the source node id and output index from a generated output name.
     * @param {*} inputReference Generated input expression.
     * @returns {{nodeId: string, outputIndex: number}|null} Parsed reference or null.
     */
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

    /**
     * Builds the graph-display layout binding for a scoped node id.
     * @param {string} scopedNodeId Scoped node id.
     * @param {number|null} slotIndex Parent output slot index.
     * @returns {{elementId: string, payloadKey: string}} Layout binding.
     */
    function createLayoutBinding(scopedNodeId, slotIndex) {
        const resolvedSlotIndex = Number.isFinite(slotIndex) ? slotIndex : null;
        return {
            elementId: buildBindingId('wv_el', 'graph', scopedNodeId, resolvedSlotIndex),
            payloadKey: buildBindingId('wv_bind', 'graph', scopedNodeId, resolvedSlotIndex),
        };
    }

    /**
     * Reads a control value from the node control map.
     * @param {object} controlValues Node control values.
     * @param {string} key Control id.
     * @param {*} [fallbackValue] Value returned when the control is absent.
     * @returns {*} Control value or fallback.
     */
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

    /**
     * Converts a value to a truncated integer and clamps it to the given bounds.
     * @param {*} value Raw value.
     * @param {number} fallbackValue Fallback integer.
     * @param {number} minValue Lower bound.
     * @param {number} maxValue Upper bound.
     * @returns {number} Clamped integer.
     */
    function clampInteger(value, fallbackValue, minValue, maxValue) {
        if (value === undefined || value === null || value === '') {
            return fallbackValue;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallbackValue;
        }
        const integer = Math.trunc(numeric);
        if (integer < minValue) {
            return minValue;
        }
        if (integer > maxValue) {
            return maxValue;
        }
        return integer;
    }

    /**
     * Normalizes the graph pixel height control.
     * @param {*} value Raw height value.
     * @returns {number} Height in the 80..1200 range.
     */
    function normalizeGraphHeightPx(value) {
        return clampInteger(
            value,
            GRAPH_DEFAULT_HEIGHT_PX,
            GRAPH_MIN_HEIGHT_PX,
            GRAPH_MAX_HEIGHT_PX
        );
    }

    /**
     * Normalizes the graph tick count control.
     * @param {*} value Raw tick count value.
     * @returns {number} Tick count in the 2..12 range.
     */
    function normalizeGraphTickCount(value) {
        return clampInteger(
            value,
            GRAPH_DEFAULT_TICK_COUNT,
            GRAPH_MIN_TICK_COUNT,
            GRAPH_MAX_TICK_COUNT
        );
    }

    /**
     * Normalizes the runtime point cap control.
     * @param {*} value Raw point cap value.
     * @returns {number} Point cap in the 2..2048 range.
     */
    function normalizeGraphMaxPoints(value) {
        return clampInteger(
            value,
            GRAPH_DEFAULT_MAX_POINTS,
            GRAPH_MIN_MAX_POINTS,
            GRAPH_MAX_MAX_POINTS
        );
    }

    /**
     * Normalizes a graph colour to `#rgb`/`#rrggbb`, falling back to the default line colour.
     * @param {*} value Raw colour value.
     * @returns {string} Normalized colour.
     */
    function normalizeGraphLineColor(value) {
        const candidate = typeof value === 'string' ? value.trim() : '';
        if (/^#[0-9a-fA-F]{6}$/.test(candidate) || /^#[0-9a-fA-F]{3}$/.test(candidate)) {
            return candidate;
        }
        return GRAPH_DEFAULT_LINE_COLOR;
    }

    /**
     * Normalizes an axis range mode to `auto` or `manual`.
     * @param {*} value Raw range mode value.
     * @returns {string} Normalized range mode.
     */
    function normalizeGraphRangeMode(value) {
        const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return candidate === 'manual' ? 'manual' : 'auto';
    }

    /**
     * Normalizes a manual axis bound, returning null when it is not a finite number.
     * @param {*} value Raw bound value.
     * @returns {number|null} Finite bound or null.
     */
    function normalizeGraphManualBound(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    /**
     * Normalizes a graph text label.
     * @param {*} value Raw label value.
     * @returns {string} Trimmed label or an empty string.
     */
    function normalizeGraphLabel(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    /**
     * Emits a Python literal for an optional numeric bound.
     * @param {number|null} value Normalized bound.
     * @param {function(*): string} formatLiteral Literal formatter supplied by the transpiler.
     * @returns {string} Python literal.
     */
    function formatOptionalNumber(value, formatLiteral) {
        if (value === null || value === undefined) {
            return 'None';
        }
        return formatLiteral(value);
    }

    /**
     * Registers the runtime graph import when the transpiler exposes an import registrar.
     * @param {object} helperContext Generator helper context.
     * @returns {void}
     */
    function registerGraphRuntimeImports(helperContext) {
        const registerImport =
            helperContext && typeof helperContext.registerImport === 'function'
                ? helperContext.registerImport
                : null;
        if (!registerImport) {
            return;
        }

        registerImport(`import otter_webview.graph as ${WEBVIEW_GRAPH_MODULE_ALIAS}`);
    }

    /**
     * Normalizes the graph control values shared by the payload and the markup.
     * @param {object} controls Raw node control values.
     * @returns {object} Normalized graph configuration.
     */
    function normalizeGraphSettings(controls) {
        const title = normalizeGraphLabel(normalizeControlValue(controls, 'title'));
        return {
            title: title || GRAPH_DEFAULT_TITLE,
            heightPx: normalizeGraphHeightPx(
                normalizeControlValue(controls, 'heightPx', GRAPH_DEFAULT_HEIGHT_PX)
            ),
            tickCount: normalizeGraphTickCount(
                normalizeControlValue(controls, 'tickCount', GRAPH_DEFAULT_TICK_COUNT)
            ),
            maxPoints: normalizeGraphMaxPoints(
                normalizeControlValue(controls, 'maxPoints', GRAPH_DEFAULT_MAX_POINTS)
            ),
            lineColor: normalizeGraphLineColor(normalizeControlValue(controls, 'lineColor')),
            xRangeMode: normalizeGraphRangeMode(
                normalizeControlValue(controls, 'xRangeMode', 'auto')
            ),
            yRangeMode: normalizeGraphRangeMode(
                normalizeControlValue(controls, 'yRangeMode', 'auto')
            ),
            minX: normalizeGraphManualBound(normalizeControlValue(controls, 'minX')),
            maxX: normalizeGraphManualBound(normalizeControlValue(controls, 'maxX')),
            minY: normalizeGraphManualBound(normalizeControlValue(controls, 'minY')),
            maxY: normalizeGraphManualBound(normalizeControlValue(controls, 'maxY')),
            xLabel: normalizeGraphLabel(normalizeControlValue(controls, 'xLabel')),
            yLabel: normalizeGraphLabel(normalizeControlValue(controls, 'yLabel')),
        };
    }

    /**
     * Creates the graph-display loop generator that publishes the series payload.
     * @returns {function(object): {statement: string}} Loop generator.
     */
    function createWebviewGraphDisplayLoopGenerator() {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';
            const titleInput = typeof inputs[1] === 'string' ? inputs[1].trim() : '';
            const xInput =
                typeof inputs[2] === 'string' && inputs[2].trim() ? inputs[2].trim() : 'None';
            const yInput =
                typeof inputs[3] === 'string' && inputs[3].trim() ? inputs[3].trim() : 'None';

            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = normalizeGraphId(context?.graph?.id);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);
            const controls =
                node.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};

            const settings = normalizeGraphSettings(controls);

            const parentLink = parseOutputReference(parentInput);
            const inputSources = Array.isArray(context?.inputSources) ? context.inputSources : [];
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
            registerGraphRuntimeImports(helpers);
            const formatLiteral =
                typeof helpers.formatLiteral === 'function'
                    ? helpers.formatLiteral
                    : (value) => JSON.stringify(value);

            const titleExpression =
                titleInput && titleInput !== 'None'
                    ? titleInput
                    : formatLiteral(settings.title);

            const outputStatements = [];
            if (safeOutputs.length > 0 && parentInput !== 'None') {
                safeOutputs.forEach((outputName) => {
                    outputStatements.push(`${outputName} = ${parentInput}`);
                });
            } else {
                outputStatements.push(
                    '# webview:graph-display:loop (output passthrough unavailable)'
                );
            }

            const loopLines = [
                ...outputStatements,
                `_wv_graph_bind_key = ${formatLiteral(publishKey)}`,
                `_wv_graph_x, _wv_graph_y = ${WEBVIEW_GRAPH_MODULE_ALIAS}.build_series(${xInput}, ${yInput}, ${formatLiteral(settings.maxPoints)})`,
                `${WEBVIEW_PUBLISH_FUNCTION_NAME}({_wv_graph_bind_key: {`,
                "    'kind': 'graph-display',",
                `    'title': ${titleExpression},`,
                "    'xValues': _wv_graph_x,",
                "    'yValues': _wv_graph_y,",
                `    'heightPx': ${formatLiteral(settings.heightPx)},`,
                `    'xRangeMode': ${formatLiteral(settings.xRangeMode)},`,
                `    'yRangeMode': ${formatLiteral(settings.yRangeMode)},`,
                `    'minX': ${formatOptionalNumber(settings.minX, formatLiteral)},`,
                `    'maxX': ${formatOptionalNumber(settings.maxX, formatLiteral)},`,
                `    'minY': ${formatOptionalNumber(settings.minY, formatLiteral)},`,
                `    'maxY': ${formatOptionalNumber(settings.maxY, formatLiteral)},`,
                `    'xLabel': ${formatLiteral(settings.xLabel)},`,
                `    'yLabel': ${formatLiteral(settings.yLabel)},`,
                `    'lineColor': ${formatLiteral(settings.lineColor)},`,
                `    'tickCount': ${formatLiteral(settings.tickCount)},`,
                `    'maxPoints': ${formatLiteral(settings.maxPoints)},`,
                '}})',
            ];

            return {
                statement: loopLines.join('\n'),
            };
        };
    }

    globalScope.NodeInitGenerators.webviewGraphDisplay =
        shared.createWebviewDynamicInitGenerator('graph-display');
    globalScope.NodeCodeGenerators.webviewGraphDisplay =
        createWebviewGraphDisplayLoopGenerator();
    globalScope.NodeHelperGenerators.webviewGraphDisplay = shared.createHelperContributionGenerator(
        'graph-display',
        57
    );

    class GraphDisplayWebviewNode extends WebviewNodeBase {
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
            const normalizeHeight =
                typeof context.normalizeGraphHeightPx === 'function'
                    ? context.normalizeGraphHeightPx
                    : normalizeGraphHeightPx;
            const normalizeTickCount =
                typeof context.normalizeGraphTickCount === 'function'
                    ? context.normalizeGraphTickCount
                    : normalizeGraphTickCount;
            const normalizeMaxPoints =
                typeof context.normalizeGraphMaxPoints === 'function'
                    ? context.normalizeGraphMaxPoints
                    : normalizeGraphMaxPoints;
            const normalizeColor =
                typeof context.normalizeGraphLineColor === 'function'
                    ? context.normalizeGraphLineColor
                    : normalizeGraphLineColor;
            const normalizeRangeMode =
                typeof context.normalizeGraphRangeMode === 'function'
                    ? context.normalizeGraphRangeMode
                    : normalizeGraphRangeMode;
            const normalizeBound =
                typeof context.normalizeGraphManualBound === 'function'
                    ? context.normalizeGraphManualBound
                    : normalizeGraphManualBound;
            const normalizeLabel =
                typeof context.normalizeGraphLabel === 'function'
                    ? context.normalizeGraphLabel
                    : normalizeGraphLabel;
            const title = normalizeLabel(normalizeControlValue(controls, 'title', ''));

            return {
                title: title || GRAPH_DEFAULT_TITLE,
                heightPx: normalizeHeight(normalizeControlValue(controls, 'heightPx', 240)),
                tickCount: normalizeTickCount(normalizeControlValue(controls, 'tickCount', 5)),
                maxPoints: normalizeMaxPoints(normalizeControlValue(controls, 'maxPoints', 256)),
                lineColor: normalizeColor(normalizeControlValue(controls, 'lineColor', '#70d6ff')),
                xRangeMode: normalizeRangeMode(
                    normalizeControlValue(controls, 'xRangeMode', 'auto')
                ),
                yRangeMode: normalizeRangeMode(
                    normalizeControlValue(controls, 'yRangeMode', 'auto')
                ),
                minX: normalizeBound(normalizeControlValue(controls, 'minX')),
                maxX: normalizeBound(normalizeControlValue(controls, 'maxX')),
                minY: normalizeBound(normalizeControlValue(controls, 'minY')),
                maxY: normalizeBound(normalizeControlValue(controls, 'maxY')),
                xLabel: normalizeLabel(normalizeControlValue(controls, 'xLabel', '')),
                yLabel: normalizeLabel(normalizeControlValue(controls, 'yLabel', '')),
            };
        }

        renderRuntimePayload(context) {
            const controls =
                context?.controls && typeof context.controls === 'object' ? context.controls : {};
            const settings = this.normalizeControls(controls, context);
            const formatLiteral =
                typeof context?.formatLiteral === 'function'
                    ? context.formatLiteral
                    : (value) => JSON.stringify(value);

            return [
                '{ ',
                "'kind': 'graph-display', ",
                `'title': ${formatLiteral(settings.title)}, `,
                "'xValues': [], 'yValues': [], ",
                `'heightPx': ${formatLiteral(settings.heightPx)}, `,
                `'xRangeMode': ${formatLiteral(settings.xRangeMode)}, `,
                `'yRangeMode': ${formatLiteral(settings.yRangeMode)}, `,
                `'minX': ${formatOptionalNumber(settings.minX, formatLiteral)}, `,
                `'maxX': ${formatOptionalNumber(settings.maxX, formatLiteral)}, `,
                `'minY': ${formatOptionalNumber(settings.minY, formatLiteral)}, `,
                `'maxY': ${formatOptionalNumber(settings.maxY, formatLiteral)}, `,
                `'xLabel': ${formatLiteral(settings.xLabel)}, `,
                `'yLabel': ${formatLiteral(settings.yLabel)}, `,
                `'lineColor': ${formatLiteral(settings.lineColor)}, `,
                `'tickCount': ${formatLiteral(settings.tickCount)}, `,
                `'maxPoints': ${formatLiteral(settings.maxPoints)}`,
                ' }',
            ].join('');
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
            const settings = normalizeGraphSettings(controls);
            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_graph_${normalizeBindingSegment(nodeId)}`;
            const payloadKey =
                typeof element?.binding?.payloadKey === 'string'
                    ? element.binding.payloadKey.trim()
                    : '';
            const formatBound = (value) =>
                value === null || value === undefined ? '' : String(value);

            return [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-content wv-graph-display" data-node-id="${escapeHtml(nodeId)}" data-node-kind="graph-display" data-wv-payload-key="${escapeHtml(payloadKey)}" data-wv-title="${escapeHtml(settings.title)}" data-wv-height-px="${settings.heightPx}" data-wv-x-range-mode="${escapeHtml(settings.xRangeMode)}" data-wv-y-range-mode="${escapeHtml(settings.yRangeMode)}" data-wv-min-x="${escapeHtml(formatBound(settings.minX))}" data-wv-max-x="${escapeHtml(formatBound(settings.maxX))}" data-wv-min-y="${escapeHtml(formatBound(settings.minY))}" data-wv-max-y="${escapeHtml(formatBound(settings.maxY))}" data-wv-x-label="${escapeHtml(settings.xLabel)}" data-wv-y-label="${escapeHtml(settings.yLabel)}" data-wv-line-color="${escapeHtml(settings.lineColor)}" data-wv-tick-count="${settings.tickCount}">`,
                `${childIndent}<div class="wv-graph-title">${escapeHtml(settings.title)}</div>`,
                `${childIndent}<canvas class="wv-graph-canvas" role="img" aria-label="Line graph"></canvas>`,
                `${indent}</div>`,
            ];
        }

        renderClientUpdateHandler() {
            return [
                'function applyGraphDisplayUpdate(targetElement, entry) {',
                '  if (!targetElement || typeof targetElement.querySelector !== "function") {',
                '    return false;',
                '  }',
                '  const canvas = targetElement.querySelector("canvas.wv-graph-canvas");',
                '  if (!canvas) {',
                '    return false;',
                '  }',
                '  const data = entry && typeof entry === "object" ? entry : {};',
                '  targetElement.graphDisplayEntry = data;',
                '  const title = typeof data.title === "string" ? data.title : "";',
                '  const titleElement = targetElement.querySelector(".wv-graph-title");',
                '  if (titleElement) {',
                '    titleElement.textContent = title;',
                '  }',
                '  targetElement.setAttribute("data-wv-title", title);',
                '  targetElement.setAttribute("data-wv-height-px", String(normalizeGraphHeightPx(data.heightPx)));',
                '  targetElement.setAttribute("data-wv-x-range-mode", normalizeGraphRangeMode(data.xRangeMode));',
                '  targetElement.setAttribute("data-wv-y-range-mode", normalizeGraphRangeMode(data.yRangeMode));',
                '  targetElement.setAttribute("data-wv-min-x", graphBoundAttribute(data.minX));',
                '  targetElement.setAttribute("data-wv-max-x", graphBoundAttribute(data.maxX));',
                '  targetElement.setAttribute("data-wv-min-y", graphBoundAttribute(data.minY));',
                '  targetElement.setAttribute("data-wv-max-y", graphBoundAttribute(data.maxY));',
                '  targetElement.setAttribute("data-wv-x-label", normalizeGraphLabel(data.xLabel));',
                '  targetElement.setAttribute("data-wv-y-label", normalizeGraphLabel(data.yLabel));',
                '  targetElement.setAttribute("data-wv-line-color", normalizeGraphLineColor(data.lineColor));',
                '  targetElement.setAttribute("data-wv-tick-count", String(normalizeGraphTickCount(data.tickCount)));',
                '  ensureGraphResizeObserver(targetElement);',
                '  const wvPerfDrawStartedAt = wvPerfNow();',
                '  drawGraphDisplay(targetElement);',
                '  const wvPerfDrawMs = wvPerfNow() - wvPerfDrawStartedAt;',
                '  wvPerfRecord("graph:draw:update", wvPerfDrawMs);',
                '  const wvPerfDrawBucket = wvPerfStats.parts["graph:draw:update"];',
                '  if (WV_PERF_LOG && wvPerfDrawBucket && (wvPerfDrawBucket.count <= 5 || wvPerfDrawBucket.count % 10 === 0)) {',
                '    wvPerfLog(',
                '      `graph draw #${wvPerfDrawBucket.count} took=${wvPerfFormatMs(wvPerfDrawMs)}`,',
                '      `points=${graphPointCount(targetElement)}`,',
                '      `xLen=${Array.isArray(data.xValues) ? data.xValues.length : 0}`,',
                '      `yLen=${Array.isArray(data.yValues) ? data.yValues.length : 0}`',
                '    );',
                '  }',
                '  return true;',
                '}',
            ];
        }

        renderClientHelpers() {
            return [
                'function graphFiniteNumber(value) {',
                '  if (value === undefined || value === null || value === "") {',
                '    return null;',
                '  }',
                '  const numeric = Number(value);',
                '  return Number.isFinite(numeric) ? numeric : null;',
                '}',
                '',
                'function graphOptionalNumber(value) {',
                '  if (value === undefined || value === null || value === "") {',
                '    return null;',
                '  }',
                '  return graphFiniteNumber(value);',
                '}',
                '',
                'function normalizeGraphLineColor(value) {',
                '  const candidate = typeof value === "string" ? value.trim() : "";',
                '  if (/^#[0-9a-fA-F]{6}$/.test(candidate) || /^#[0-9a-fA-F]{3}$/.test(candidate)) {',
                '    return candidate;',
                '  }',
                '  return "#70d6ff";',
                '}',
                '',
                'function normalizeGraphHeightPx(value) {',
                '  const numeric = graphFiniteNumber(value);',
                '  if (numeric === null) {',
                '    return 240;',
                '  }',
                '  return Math.max(80, Math.min(1200, Math.trunc(numeric)));',
                '}',
                '',
                'function normalizeGraphTickCount(value) {',
                '  const numeric = graphFiniteNumber(value);',
                '  if (numeric === null) {',
                '    return 5;',
                '  }',
                '  return Math.max(2, Math.min(12, Math.trunc(numeric)));',
                '}',
                '',
                'function normalizeGraphRangeMode(value) {',
                '  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";',
                '  return candidate === "manual" ? "manual" : "auto";',
                '}',
                '',
                'function normalizeGraphLabel(value) {',
                '  return typeof value === "string" ? value.trim() : "";',
                '}',
                '',
                'function graphBoundAttribute(value) {',
                '  const numeric = graphOptionalNumber(value);',
                '  return numeric === null ? "" : String(numeric);',
                '}',
                '',
                'function readGraphAttribute(targetElement, attributeName, fallbackValue) {',
                '  if (!targetElement || typeof targetElement.getAttribute !== "function") {',
                '    return fallbackValue;',
                '  }',
                '  const rawValue = targetElement.getAttribute(attributeName);',
                '  return rawValue === null || rawValue === undefined || rawValue === "" ? fallbackValue : rawValue;',
                '}',
                '',
                'function resolveGraphRange(values, mode, minValue, maxValue) {',
                '  const manualMin = graphOptionalNumber(minValue);',
                '  const manualMax = graphOptionalNumber(maxValue);',
                '  if (normalizeGraphRangeMode(mode) === "manual") {',
                '    if (manualMin !== null && manualMax !== null && manualMax > manualMin) {',
                '      return { min: manualMin, max: manualMax };',
                '    }',
                '  }',
                '  const source = Array.isArray(values) ? values : [];',
                '  let low = null;',
                '  let high = null;',
                '  source.forEach((value) => {',
                '    const numeric = graphFiniteNumber(value);',
                '    if (numeric === null) {',
                '      return;',
                '    }',
                '    low = low === null ? numeric : Math.min(low, numeric);',
                '    high = high === null ? numeric : Math.max(high, numeric);',
                '  });',
                '  if (low === null || high === null) {',
                '    return { min: -1, max: 1 };',
                '  }',
                '  if (low === high) {',
                '    return { min: low - 0.5, max: high + 0.5 };',
                '  }',
                '  const padding = (high - low) * 0.05;',
                '  return { min: low - padding, max: high + padding };',
                '}',
                '',
                'function formatGraphTick(value, span) {',
                '  const numeric = graphFiniteNumber(value);',
                '  if (numeric === null) {',
                '    return "0";',
                '  }',
                '  const safeSpan = Math.abs(graphFiniteNumber(span) || 0);',
                '  const decimals = safeSpan >= 10 ? 0 : safeSpan >= 1 ? 1 : safeSpan >= 0.1 ? 2 : 3;',
                '  const text = numeric.toFixed(decimals);',
                '  return Number(text) === 0 ? "0" : text;',
                '}',
                '',
                'const graphResizeObservers = typeof WeakMap === "function" ? new WeakMap() : null;',
                '',
                'function graphPointList(targetElement) {',
                '  const entry =',
                '    targetElement && targetElement.graphDisplayEntry',
                '      ? targetElement.graphDisplayEntry',
                '      : {};',
                '  const xSource = Array.isArray(entry.xValues) ? entry.xValues : [];',
                '  const ySource = Array.isArray(entry.yValues) ? entry.yValues : [];',
                '  const length = Math.min(xSource.length, ySource.length);',
                '  const points = [];',
                '  for (let index = 0; index < length; index += 1) {',
                '    const x = graphFiniteNumber(xSource[index]);',
                '    const y = graphFiniteNumber(ySource[index]);',
                '    if (x === null || y === null) {',
                '      continue;',
                '    }',
                '    points.push({ x, y });',
                '  }',
                '  return points;',
                '}',
                '',
                'function graphPointCount(targetElement) {',
                '  return graphPointList(targetElement).length;',
                '}',
                '',
                'function graphMeasureLabel(context, text) {',
                '  if (!context || typeof context.measureText !== "function") {',
                '    return 0;',
                '  }',
                '  const metrics = context.measureText(text === undefined || text === null ? "" : String(text));',
                '  const width = metrics ? graphFiniteNumber(metrics.width) : null;',
                '  return width !== null && width > 0 ? width : 0;',
                '}',
                '',
                'function graphElementInsets(element) {',
                '  if (!element || typeof window === "undefined" || typeof window.getComputedStyle !== "function") {',
                '    return null;',
                '  }',
                '  const style = window.getComputedStyle(element);',
                '  if (!style) {',
                '    return null;',
                '  }',
                '  const left = graphFiniteNumber(Number.parseFloat(style.paddingLeft));',
                '  const right = graphFiniteNumber(Number.parseFloat(style.paddingRight));',
                '  if (left === null || right === null || left < 0 || right < 0) {',
                '    return null;',
                '  }',
                '  return { horizontal: left + right };',
                '}',
                '',
                'function graphCanvasCssWidth(canvas, targetElement) {',
                '  if (canvas && typeof canvas.getBoundingClientRect === "function") {',
                '    const rect = canvas.getBoundingClientRect();',
                '    const rectWidth = rect ? graphFiniteNumber(rect.width) : null;',
                '    if (rectWidth !== null && rectWidth > 0) {',
                '      return Math.max(1, rectWidth);',
                '    }',
                '  }',
                '  const canvasWidth = canvas ? graphFiniteNumber(canvas.clientWidth) : null;',
                '  if (canvasWidth !== null && canvasWidth > 0) {',
                '    return Math.max(1, canvasWidth);',
                '  }',
                '  const cardWidth = targetElement ? graphFiniteNumber(targetElement.clientWidth) : null;',
                '  const insets = graphElementInsets(targetElement);',
                '  if (cardWidth !== null && cardWidth > 0 && insets !== null) {',
                '    const contentWidth = cardWidth - insets.horizontal;',
                '    if (contentWidth > 0) {',
                '      return Math.max(1, contentWidth);',
                '    }',
                '  }',
                '  return 320;',
                '}',
                '',
                'function drawGraphDisplay(targetElement) {',
                '  if (!targetElement || typeof targetElement.querySelector !== "function") {',
                '    return false;',
                '  }',
                '  const canvas = targetElement.querySelector("canvas.wv-graph-canvas");',
                '  if (!canvas || typeof canvas.getContext !== "function") {',
                '    return false;',
                '  }',
                '  const context = canvas.getContext("2d");',
                '  if (!context) {',
                '    return false;',
                '  }',
                '  const points = graphPointList(targetElement);',
                '  const xRange = resolveGraphRange(',
                '    points.map((point) => point.x),',
                '    readGraphAttribute(targetElement, "data-wv-x-range-mode", "auto"),',
                '    readGraphAttribute(targetElement, "data-wv-min-x", ""),',
                '    readGraphAttribute(targetElement, "data-wv-max-x", "")',
                '  );',
                '  const yRange = resolveGraphRange(',
                '    points.map((point) => point.y),',
                '    readGraphAttribute(targetElement, "data-wv-y-range-mode", "auto"),',
                '    readGraphAttribute(targetElement, "data-wv-min-y", ""),',
                '    readGraphAttribute(targetElement, "data-wv-max-y", "")',
                '  );',
                '  const heightPx = normalizeGraphHeightPx(',
                '    readGraphAttribute(targetElement, "data-wv-height-px", "")',
                '  );',
                '  const tickCount = normalizeGraphTickCount(',
                '    readGraphAttribute(targetElement, "data-wv-tick-count", "")',
                '  );',
                '  const lineColor = normalizeGraphLineColor(',
                '    readGraphAttribute(targetElement, "data-wv-line-color", "")',
                '  );',
                '  const xLabel = normalizeGraphLabel(',
                '    readGraphAttribute(targetElement, "data-wv-x-label", "")',
                '  );',
                '  const yLabel = normalizeGraphLabel(',
                '    readGraphAttribute(targetElement, "data-wv-y-label", "")',
                '  );',
                '  const cssWidth = graphCanvasCssWidth(canvas, targetElement);',
                '  const cssHeight = heightPx;',
                '  const measuredRatio =',
                '    typeof window !== "undefined" ? graphFiniteNumber(window.devicePixelRatio) : null;',
                '  const ratio = measuredRatio !== null && measuredRatio > 0 ? measuredRatio : 1;',
                '  canvas.width = Math.max(1, Math.round(cssWidth * ratio));',
                '  canvas.height = Math.max(1, Math.round(cssHeight * ratio));',
                '  canvas.style.width = "";',
                '  canvas.style.height = `${cssHeight}px`;',
                '  if (typeof context.setTransform === "function") {',
                '    context.setTransform(ratio, 0, 0, ratio, 0, 0);',
                '  } else if (typeof context.scale === "function") {',
                '    context.scale(ratio, ratio);',
                '  }',
                '  const tickFont = "11px system-ui, sans-serif";',
                '  const tickGap = 8;',
                '  const plotMargin = 4;',
                '  const titleBand = yLabel ? 16 : 0;',
                '  const xSpan = xRange.max - xRange.min;',
                '  const ySpan = yRange.max - yRange.min;',
                '  context.font = tickFont;',
                '  const yTickTexts = [];',
                '  const xTickTexts = [];',
                '  for (let index = 0; index <= tickCount; index += 1) {',
                '    const fraction = index / tickCount;',
                '    yTickTexts.push(formatGraphTick(yRange.min + ySpan * fraction, ySpan));',
                '    xTickTexts.push(formatGraphTick(xRange.min + xSpan * fraction, xSpan));',
                '  }',
                '  let maxYLabelWidth = 0;',
                '  for (let index = 0; index < yTickTexts.length; index += 1) {',
                '    maxYLabelWidth = Math.max(maxYLabelWidth, graphMeasureLabel(context, yTickTexts[index]));',
                '  }',
                '  const firstXLabelWidth = graphMeasureLabel(context, xTickTexts[0]);',
                '  const lastXLabelWidth = graphMeasureLabel(context, xTickTexts[xTickTexts.length - 1]);',
                '  const leftLimit = Math.max(1, Math.floor(cssWidth * 0.45));',
                '  const rightLimit = Math.max(1, Math.floor(cssWidth * 0.25));',
                '  const padding = {',
                '    left: Math.min(',
                '      Math.max(',
                '        titleBand + Math.ceil(maxYLabelWidth) + tickGap,',
                '        Math.ceil(firstXLabelWidth / 2) + plotMargin',
                '      ),',
                '      leftLimit',
                '    ),',
                '    right: Math.min(Math.max(Math.ceil(lastXLabelWidth / 2) + plotMargin, plotMargin), rightLimit),',
                '    top: 14,',
                '    bottom: 34,',
                '  };',
                '  const plotWidth = Math.max(1, cssWidth - padding.left - padding.right);',
                '  const plotHeight = Math.max(1, cssHeight - padding.top - padding.bottom);',
                '  context.clearRect(0, 0, cssWidth, cssHeight);',
                '  context.fillStyle = "rgba(15, 21, 38, 0.92)";',
                '  context.fillRect(0, 0, cssWidth, cssHeight);',
                '  context.lineWidth = 1;',
                '  context.strokeStyle = "rgba(140, 170, 220, 0.26)";',
                '  context.fillStyle = "rgba(190, 210, 240, 0.8)";',
                '  context.textAlign = "right";',
                '  context.textBaseline = "middle";',
                '  for (let index = 0; index <= tickCount; index += 1) {',
                '    const fraction = index / tickCount;',
                '    const y = padding.top + plotHeight * (1 - fraction);',
                '    context.beginPath();',
                '    context.moveTo(padding.left, y);',
                '    context.lineTo(padding.left + plotWidth, y);',
                '    context.stroke();',
                '    context.fillText(',
                '      yTickTexts[index],',
                '      padding.left - tickGap,',
                '      y,',
                '      Math.max(1, padding.left - tickGap)',
                '    );',
                '  }',
                '  context.textAlign = "center";',
                '  context.textBaseline = "top";',
                '  for (let index = 0; index <= tickCount; index += 1) {',
                '    const fraction = index / tickCount;',
                '    const x = padding.left + plotWidth * fraction;',
                '    context.beginPath();',
                '    context.moveTo(x, padding.top);',
                '    context.lineTo(x, padding.top + plotHeight);',
                '    context.stroke();',
                '    context.fillText(',
                '      xTickTexts[index],',
                '      x,',
                '      padding.top + plotHeight + 8,',
                '      Math.max(1, 2 * Math.min(x, cssWidth - x))',
                '    );',
                '  }',
                '  context.fillStyle = "rgba(190, 210, 240, 0.92)";',
                '  context.textAlign = "center";',
                '  context.textBaseline = "middle";',
                '  if (xLabel) {',
                '    context.fillText(xLabel, padding.left + plotWidth / 2, cssHeight - 10);',
                '  }',
                '  if (yLabel) {',
                '    context.save();',
                '    context.translate(titleBand / 2, padding.top + plotHeight / 2);',
                '    context.rotate(-Math.PI / 2);',
                '    context.fillText(yLabel, 0, 0);',
                '    context.restore();',
                '  }',
                '  if (points.length > 0) {',
                '    const mapX = (value) =>',
                '      padding.left +',
                '      (xSpan > 0 ? ((value - xRange.min) / xSpan) * plotWidth : plotWidth / 2);',
                '    const mapY = (value) =>',
                '      padding.top +',
                '      plotHeight -',
                '      (ySpan > 0 ? ((value - yRange.min) / ySpan) * plotHeight : plotHeight / 2);',
                '    context.save();',
                '    context.beginPath();',
                '    context.rect(padding.left, padding.top, plotWidth, plotHeight);',
                '    context.clip();',
                '    context.strokeStyle = lineColor;',
                '    context.lineWidth = 2;',
                '    context.beginPath();',
                '    points.forEach((point, index) => {',
                '      const pointX = mapX(point.x);',
                '      const pointY = mapY(point.y);',
                '      if (index === 0) {',
                '        context.moveTo(pointX, pointY);',
                '      } else {',
                '        context.lineTo(pointX, pointY);',
                '      }',
                '    });',
                '    context.stroke();',
                '    if (points.length <= 24) {',
                '      context.fillStyle = lineColor;',
                '      points.forEach((point) => {',
                '        context.beginPath();',
                '        context.arc(mapX(point.x), mapY(point.y), 2.5, 0, Math.PI * 2);',
                '        context.fill();',
                '      });',
                '    }',
                '    context.restore();',
                '  }',
                '  return true;',
                '}',
                '',
                'function ensureGraphResizeObserver(targetElement) {',
                '  if (!graphResizeObservers || !targetElement) {',
                '    return;',
                '  }',
                '  if (typeof ResizeObserver !== "function") {',
                '    return;',
                '  }',
                '  if (graphResizeObservers.has(targetElement)) {',
                '    return;',
                '  }',
                '  const observer = new ResizeObserver(() => {',
                '    const wvPerfResizeStartedAt = wvPerfNow();',
                '    drawGraphDisplay(targetElement);',
                '    wvPerfRecord("graph:draw:resize", wvPerfNow() - wvPerfResizeStartedAt);',
                '    const wvPerfResizeBucket = wvPerfStats.parts["graph:draw:resize"];',
                '    if (WV_PERF_LOG && wvPerfResizeBucket && (wvPerfResizeBucket.count <= 5 || wvPerfResizeBucket.count % 20 === 0)) {',
                '      wvPerfLog(`resize draw #${wvPerfResizeBucket.count} took=${wvPerfFormatMs(wvPerfNow() - wvPerfResizeStartedAt)}`);',
                '    }',
                '  });',
                '  graphResizeObservers.set(targetElement, observer);',
                '  observer.observe(targetElement);',
                '}',
            ];
        }

        renderClientInitHooks() {
            return [
                'if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") { Array.from(document.querySelectorAll(".wv-graph-display")).forEach((element) => { ensureGraphResizeObserver(element); const wvPerfInitStartedAt = wvPerfNow(); drawGraphDisplay(element); wvPerfRecord("graph:draw:init", wvPerfNow() - wvPerfInitStartedAt); }); }',
            ];
        }

        renderClientStyleRules() {
            return [
                '    .wv-graph-display { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 10px; box-sizing: border-box; background: rgba(15, 21, 38, 0.72); border: 1px solid rgba(120, 160, 220, 0.24); border-radius: 8px; }',
                '    .wv-graph-title { font-size: 13px; font-weight: 600; color: #dfe9ff; }',
                '    .wv-graph-canvas { display: block; width: 100%; height: auto; border-radius: 6px; }',
            ];
        }
    }

    shared.registerNodeKindImplementation('graph-display', new GraphDisplayWebviewNode());
})();

