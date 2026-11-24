// Webview radar-display generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    const WEBVIEW_PUBLISH_FUNCTION_NAME =
        'web_interface_module.WEB_INTERFACE.publish_webview_values';
    const WEBVIEW_RADAR_MODULE_ALIAS = '_wv_radar';
    if (!shared) {
        throw new Error(
            'Webview shared generator module must load before radar-display generator.'
        );
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before radar-display generator.');
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
            elementId: buildBindingId('wv_el', 'radar', scopedNodeId, resolvedSlotIndex),
            payloadKey: buildBindingId('wv_bind', 'radar', scopedNodeId, resolvedSlotIndex),
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

    function normalizeRadarPieceCount(value) {
        const numeric = toFiniteInt(value, 24);
        if (numeric < 1) {
            return 1;
        }
        if (numeric > 360) {
            return 360;
        }
        return numeric;
    }

    function normalizeRadarMaxRadiusPx(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 64;
        }
        const integerRadius = Math.floor(numeric);
        return integerRadius < 1 ? 1 : integerRadius;
    }

    function normalizeRadarRadiusNormalized(value, fallbackValue = 0) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallbackValue;
        }
        if (numeric < 0) {
            return 0;
        }
        if (numeric > 1) {
            return 1;
        }
        return numeric;
    }

    function normalizeRadarAngleDeg(value, fallbackValue = 0) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallbackValue;
    }

    function normalizeRadarFillColor(value) {
        const candidate = typeof value === 'string' ? value.trim() : '';
        if (/^#[0-9a-fA-F]{6}$/.test(candidate) || /^#[0-9a-fA-F]{3}$/.test(candidate)) {
            return candidate;
        }
        return '#70d6ff';
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

    function toRadarRadians(angleDeg) {
        return ((Number(angleDeg) || 0) - 90) * (Math.PI / 180);
    }

    function buildRadarSlicePathData(maxRadiusPx, startAngleDeg, endAngleDeg, radiusNormalized) {
        const radius = Math.max(0, Number(maxRadiusPx) * Number(radiusNormalized));
        if (!(radius > 0)) {
            return '';
        }

        const safeMaxRadius = Math.max(1, Number(maxRadiusPx));
        const center = safeMaxRadius;
        const startRad = toRadarRadians(startAngleDeg);
        const endRad = toRadarRadians(endAngleDeg);

        const startX = center + Math.cos(startRad) * radius;
        const startY = center + Math.sin(startRad) * radius;
        const endX = center + Math.cos(endRad) * radius;
        const endY = center + Math.sin(endRad) * radius;

        let delta = endRad - startRad;
        while (delta < 0) {
            delta += Math.PI * 2;
        }
        while (delta >= Math.PI * 2) {
            delta -= Math.PI * 2;
        }
        const largeArcFlag = delta > Math.PI ? 1 : 0;

        return [
            `M ${center.toFixed(3)} ${center.toFixed(3)}`,
            `L ${startX.toFixed(3)} ${startY.toFixed(3)}`,
            `A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArcFlag} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`,
            'Z',
        ].join(' ');
    }

    function buildRadarArcPathData(maxRadiusPx, startAngleDeg, endAngleDeg, radiusNormalized) {
        const radius = Math.max(0, Number(maxRadiusPx) * Number(radiusNormalized));
        if (!(radius > 0)) {
            return '';
        }

        const safeMaxRadius = Math.max(1, Number(maxRadiusPx));
        const center = safeMaxRadius;
        const startRad = toRadarRadians(startAngleDeg);
        const endRad = toRadarRadians(endAngleDeg);
        const startX = center + Math.cos(startRad) * radius;
        const startY = center + Math.sin(startRad) * radius;
        const endX = center + Math.cos(endRad) * radius;
        const endY = center + Math.sin(endRad) * radius;

        let delta = endRad - startRad;
        while (delta < 0) {
            delta += Math.PI * 2;
        }
        while (delta >= Math.PI * 2) {
            delta -= Math.PI * 2;
        }
        const largeArcFlag = delta > Math.PI ? 1 : 0;

        return [
            `M ${startX.toFixed(3)} ${startY.toFixed(3)}`,
            `A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArcFlag} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`,
        ].join(' ');
    }

    function buildRadarBoundaryPathData(maxRadiusPx, angleDeg) {
        const safeMaxRadius = Math.max(1, Number(maxRadiusPx));
        const center = safeMaxRadius;
        const angleRad = toRadarRadians(angleDeg);
        const edgeX = center + Math.cos(angleRad) * safeMaxRadius;
        const edgeY = center + Math.sin(angleRad) * safeMaxRadius;

        return [
            `M ${center.toFixed(3)} ${center.toFixed(3)}`,
            `L ${edgeX.toFixed(3)} ${edgeY.toFixed(3)}`,
        ].join(' ');
    }

    function createWebviewRadarDisplayLoopGenerator() {
        return function (context) {
            const outputs = Array.isArray(context?.outputs) ? context.outputs.slice() : [];
            const safeOutputs = outputs
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);
            const inputs = Array.isArray(context?.inputs) ? context.inputs : [];
            const parentInput =
                typeof inputs[0] === 'string' && inputs[0].trim() ? inputs[0].trim() : 'None';
            const pieceIndexInput =
                typeof inputs[1] === 'string' && inputs[1].trim() ? inputs[1].trim() : 'None';
            const pieceRadiusInput =
                typeof inputs[2] === 'string' && inputs[2].trim() ? inputs[2].trim() : 'None';

            const node = context?.node && typeof context.node === 'object' ? context.node : {};
            const nodeId =
                typeof node.id === 'string' && node.id.trim() ? node.id.trim() : 'unknown';
            const graphId = normalizeGraphId(context?.graph?.id);
            const scopedNodeId = buildScopedNodeId(graphId, nodeId);
            const controls =
                node.controlValues && typeof node.controlValues === 'object'
                    ? node.controlValues
                    : {};
            const pieceCount = normalizeRadarPieceCount(
                normalizeControlValue(controls, 'pieceCount', 24)
            );
            const initialRadiusNormalized = normalizeRadarRadiusNormalized(
                normalizeControlValue(controls, 'initialRadiusNormalized', 0),
                0
            );
            const maxRadiusPx = normalizeRadarMaxRadiusPx(
                normalizeControlValue(controls, 'maxRadiusPx', 64)
            );
            const startAngleDeg = normalizeRadarAngleDeg(
                normalizeControlValue(controls, 'startAngleDeg', -90),
                -90
            );
            const endAngleDeg = normalizeRadarAngleDeg(
                normalizeControlValue(controls, 'endAngleDeg', 90),
                90
            );
            const fillColor = normalizeRadarFillColor(
                normalizeControlValue(controls, 'fillColor', '#70d6ff')
            );

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
            registerStrictRuntimeImports(helpers);
            const registerImport =
                typeof helpers.registerImport === 'function' ? helpers.registerImport : null;
            if (registerImport) {
                registerImport(`import otter_webview.radar as ${WEBVIEW_RADAR_MODULE_ALIAS}`);
            }
            const formatLiteral =
                typeof helpers.formatLiteral === 'function'
                    ? helpers.formatLiteral
                    : (value) => JSON.stringify(value);

            const outputStatement =
                safeOutputs.length > 0 && parentInput !== 'None'
                    ? safeOutputs.map((outputName) => `${outputName} = ${parentInput}`).join('\n')
                    : '# webview:radar-display:loop (output passthrough unavailable)';

            const nodeKeyLiteral = formatLiteral(publishKey);
            const radarStateKeyLiteral = formatLiteral(`radar:${publishKey}`);
            const initialRadiusLiteral = formatLiteral(initialRadiusNormalized);
            const pieceCountLiteral = formatLiteral(pieceCount);

            const loopLines = [
                outputStatement,
                `_wv_radar_bind_key = ${nodeKeyLiteral}`,
                `_wv_radar_slices = ${WEBVIEW_RADAR_MODULE_ALIAS}.ensure_slices(${WEBVIEW_RADAR_MODULE_ALIAS}.state_store(), ${radarStateKeyLiteral}, ${pieceCountLiteral}, ${initialRadiusLiteral})`,
                `_wv_radar_piece_index, _wv_radar_piece_radius, _wv_radar_snapshot = ${WEBVIEW_RADAR_MODULE_ALIAS}.apply_piece_update(_wv_radar_slices, ${pieceIndexInput}, ${pieceRadiusInput}, ${initialRadiusLiteral})`,
                `${WEBVIEW_PUBLISH_FUNCTION_NAME}({_wv_radar_bind_key: { 'kind': 'radar-display', 'maxRadiusPx': ${formatLiteral(maxRadiusPx)}, 'startAngleDeg': ${formatLiteral(startAngleDeg)}, 'endAngleDeg': ${formatLiteral(endAngleDeg)}, 'pieceCount': ${pieceCountLiteral}, 'fillColor': ${formatLiteral(fillColor)}, 'pieceIndex': _wv_radar_piece_index, 'pieceRadiusNormalized': _wv_radar_piece_radius, 'sliceRadiiNormalized': _wv_radar_snapshot }})`,
            ];

            return {
                statement: loopLines.join('\n'),
            };
        };
    }

    globalScope.NodeInitGenerators.webviewRadarDisplay =
        shared.createWebviewDynamicInitGenerator('radar-display');
    globalScope.NodeCodeGenerators.webviewRadarDisplay = createWebviewRadarDisplayLoopGenerator();
    globalScope.NodeHelperGenerators.webviewRadarDisplay = shared.createHelperContributionGenerator(
        'radar-display',
        58
    );

    class RadarDisplayWebviewNode extends WebviewNodeBase {
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
            const normalizeMaxRadius =
                typeof context.normalizeRadarMaxRadiusPx === 'function'
                    ? context.normalizeRadarMaxRadiusPx
                    : (value) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return 64;
                          }
                          const integerRadius = Math.floor(numeric);
                          return integerRadius < 1 ? 1 : integerRadius;
                      };
            const normalizeAngle =
                typeof context.normalizeRadarAngleDeg === 'function'
                    ? context.normalizeRadarAngleDeg
                    : (value, fallbackValue = 0) => {
                          const numeric = Number(value);
                          return Number.isFinite(numeric) ? numeric : fallbackValue;
                      };
            const normalizePieceCount =
                typeof context.normalizeRadarPieceCount === 'function'
                    ? context.normalizeRadarPieceCount
                    : (value) => {
                          const numeric = Number.isFinite(Number(value))
                              ? Math.floor(Number(value))
                              : 24;
                          return Math.max(1, Math.min(360, numeric));
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
            const normalizeRadius =
                typeof context.normalizeRadarRadiusNormalized === 'function'
                    ? context.normalizeRadarRadiusNormalized
                    : (value, fallbackValue = 0) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return fallbackValue;
                          }
                          if (numeric < 0) {
                              return 0;
                          }
                          if (numeric > 1) {
                              return 1;
                          }
                          return numeric;
                      };

            return {
                maxRadiusPx: normalizeMaxRadius(normalizeControlValue(controls, 'maxRadiusPx', 64)),
                startAngleDeg: normalizeAngle(
                    normalizeControlValue(controls, 'startAngleDeg', -90),
                    -90
                ),
                endAngleDeg: normalizeAngle(normalizeControlValue(controls, 'endAngleDeg', 90), 90),
                pieceCount: normalizePieceCount(normalizeControlValue(controls, 'pieceCount', 24)),
                fillColor: normalizeColor(normalizeControlValue(controls, 'fillColor', '#70d6ff')),
                initialRadiusNormalized: normalizeRadius(
                    normalizeControlValue(controls, 'initialRadiusNormalized', 0),
                    0
                ),
            };
        }

        renderRuntimePayload(context) {
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
            const normalizePieceCount =
                typeof context?.normalizeRadarPieceCount === 'function'
                    ? context.normalizeRadarPieceCount
                    : (value) => {
                          const numeric = Number.isFinite(Number(value))
                              ? Math.floor(Number(value))
                              : 24;
                          return Math.max(1, Math.min(360, numeric));
                      };
            const normalizeRadius =
                typeof context?.normalizeRadarRadiusNormalized === 'function'
                    ? context.normalizeRadarRadiusNormalized
                    : (value, fallbackValue = 0) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return fallbackValue;
                          }
                          if (numeric < 0) {
                              return 0;
                          }
                          if (numeric > 1) {
                              return 1;
                          }
                          return numeric;
                      };
            const normalizeMaxRadius =
                typeof context?.normalizeRadarMaxRadiusPx === 'function'
                    ? context.normalizeRadarMaxRadiusPx
                    : (value) => {
                          const numeric = Number(value);
                          if (!Number.isFinite(numeric)) {
                              return 64;
                          }
                          const integerRadius = Math.floor(numeric);
                          return integerRadius < 1 ? 1 : integerRadius;
                      };
            const normalizeAngle =
                typeof context?.normalizeRadarAngleDeg === 'function'
                    ? context.normalizeRadarAngleDeg
                    : (value, fallbackValue = 0) => {
                          const numeric = Number(value);
                          return Number.isFinite(numeric) ? numeric : fallbackValue;
                      };
            const normalizeColor =
                typeof context?.normalizeRadarFillColor === 'function'
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
            const formatLiteral =
                typeof context?.formatLiteral === 'function'
                    ? context.formatLiteral
                    : (value) => JSON.stringify(value);

            const pieceCount = normalizePieceCount(
                normalizeControlValue(controls, 'pieceCount', 24)
            );
            const initialRadiusNormalized = normalizeRadius(
                normalizeControlValue(controls, 'initialRadiusNormalized', 0),
                0
            );
            const maxRadiusPx = normalizeMaxRadius(
                normalizeControlValue(controls, 'maxRadiusPx', 64)
            );
            const startAngleDeg = normalizeAngle(
                normalizeControlValue(controls, 'startAngleDeg', -90),
                -90
            );
            const endAngleDeg = normalizeAngle(
                normalizeControlValue(controls, 'endAngleDeg', 90),
                90
            );
            const fillColor = normalizeColor(
                normalizeControlValue(controls, 'fillColor', '#70d6ff')
            );

            return [
                `{ 'kind': 'radar-display', 'maxRadiusPx': ${formatLiteral(maxRadiusPx)}, 'startAngleDeg': ${formatLiteral(startAngleDeg)}, 'endAngleDeg': ${formatLiteral(endAngleDeg)}, 'pieceCount': ${formatLiteral(pieceCount)}, 'fillColor': ${formatLiteral(fillColor)}, 'sliceRadiiNormalized': [`,
                ...Array.from({ length: pieceCount }, (_, index) => {
                    const separator = index + 1 < pieceCount ? ',' : '';
                    return `    ${formatLiteral(initialRadiusNormalized)}${separator}`;
                }),
                '] }',
            ].join('\n');
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
            const maxRadiusPx = normalizeRadarMaxRadiusPx(controls.maxRadiusPx);
            const startAngleDeg = normalizeRadarAngleDeg(controls.startAngleDeg, -90);
            const endAngleDeg = normalizeRadarAngleDeg(controls.endAngleDeg, 90);
            const pieceCount = normalizeRadarPieceCount(controls.pieceCount);
            const fillColor = normalizeRadarFillColor(controls.fillColor);
            const initialRadiusNormalized = normalizeRadarRadiusNormalized(
                controls.initialRadiusNormalized,
                0
            );
            const diameter = maxRadiusPx * 2;
            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_radar_${normalizeBindingSegment(nodeId)}`;
            const safeNodeSegment = normalizeBindingSegment(nodeId);
            const sweepDeg = endAngleDeg - startAngleDeg;
            const pieceSweepDeg = sweepDeg / pieceCount;

            return [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-content wv-radar-display" data-node-id="${escapeHtml(nodeId)}" data-node-kind="radar-display" data-wv-max-radius-px="${maxRadiusPx}" data-wv-start-angle-deg="${escapeHtml(startAngleDeg)}" data-wv-end-angle-deg="${escapeHtml(endAngleDeg)}" data-wv-piece-count="${pieceCount}" data-wv-fill-color="${escapeHtml(fillColor)}">`,
                `${childIndent}<svg class="wv-radar-svg" role="img" aria-label="Radar display" viewBox="0 0 ${diameter} ${diameter}" width="${diameter}" height="${diameter}">`,
                `${childIndent}  <g class="wv-radar-guides" data-wv-radar-role="guides">`,
                `${childIndent}    <path class="wv-radar-guide" data-wv-radar-guide="boundary-min" d="${escapeHtml(buildRadarBoundaryPathData(maxRadiusPx, startAngleDeg))}"></path>`,
                `${childIndent}    <path class="wv-radar-guide" data-wv-radar-guide="boundary-max" d="${escapeHtml(buildRadarBoundaryPathData(maxRadiusPx, endAngleDeg))}"></path>`,
                `${childIndent}    <path class="wv-radar-guide" data-wv-radar-guide="arc-max" d="${escapeHtml(buildRadarArcPathData(maxRadiusPx, startAngleDeg, endAngleDeg, 1))}"></path>`,
                `${childIndent}    <path class="wv-radar-guide" data-wv-radar-guide="arc-half" d="${escapeHtml(buildRadarArcPathData(maxRadiusPx, startAngleDeg, endAngleDeg, 0.5))}"></path>`,
                `${childIndent}  </g>`,
                `${childIndent}  <g data-wv-radar-role="slices">`,
                ...Array.from({ length: pieceCount }, (_, index) => {
                    const sliceStartDeg = startAngleDeg + pieceSweepDeg * index;
                    const sliceEndDeg = startAngleDeg + pieceSweepDeg * (index + 1);
                    const pathData = buildRadarSlicePathData(
                        maxRadiusPx,
                        sliceStartDeg,
                        sliceEndDeg,
                        initialRadiusNormalized
                    );
                    return `${childIndent}    <path id="wv_radar_piece_${safeNodeSegment}_${index}" class="wv-radar-slice" data-wv-radar-slice-index="${index}" d="${escapeHtml(pathData)}" fill="${escapeHtml(fillColor)}"></path>`;
                }),
                `${childIndent}  </g>`,
                `${childIndent}</svg>`,
                `${indent}</div>`,
            ];
        }

        renderClientUpdateHandler() {
            return [
                'function applyRadarDisplayUpdate(targetElement, entry) {',
                '  if (!Array.isArray(entry.sliceRadiiNormalized)) {',
                '    return false;',
                '  }',
                '  const svgElement = targetElement.querySelector(".wv-radar-svg");',
                '  const slicesElement = targetElement.querySelector("[data-wv-radar-role=slices]");',
                '  if (!svgElement || !slicesElement) {',
                '    return false;',
                '  }',
                '  const rawPieceCount = Number(entry.pieceCount);',
                '  const pieceCount = Number.isFinite(rawPieceCount)',
                '    ? Math.min(360, Math.max(1, Math.floor(rawPieceCount)))',
                '    : Math.min(360, Math.max(1, entry.sliceRadiiNormalized.length));',
                '  const maxRadiusPx = Math.max(1, Number(entry.maxRadiusPx ?? targetElement.getAttribute("data-wv-max-radius-px") ?? 64));',
                '  const startAngleDeg = Number(entry.startAngleDeg ?? targetElement.getAttribute("data-wv-start-angle-deg") ?? -90);',
                '  const endAngleDeg = Number(entry.endAngleDeg ?? targetElement.getAttribute("data-wv-end-angle-deg") ?? 90);',
                '  const fillColor = String(entry.fillColor ?? targetElement.getAttribute("data-wv-fill-color") ?? "#70d6ff");',
                '  const diameter = maxRadiusPx * 2;',
                '  targetElement.setAttribute("data-wv-max-radius-px", String(maxRadiusPx));',
                '  targetElement.setAttribute("data-wv-start-angle-deg", String(startAngleDeg));',
                '  targetElement.setAttribute("data-wv-end-angle-deg", String(endAngleDeg));',
                '  targetElement.setAttribute("data-wv-piece-count", String(pieceCount));',
                '  targetElement.setAttribute("data-wv-fill-color", fillColor);',
                '  svgElement.setAttribute("viewBox", `0 0 ${diameter} ${diameter}`);',
                '  svgElement.setAttribute("width", String(diameter));',
                '  svgElement.setAttribute("height", String(diameter));',
                '  const sweepDeg = endAngleDeg - startAngleDeg;',
                '  const pieceSweepDeg = sweepDeg / pieceCount;',
                '  const guidesMarkup = [',
                '    `<path class="wv-radar-guide" data-wv-radar-guide="boundary-min" d="${buildRadarBoundaryPathData(maxRadiusPx, startAngleDeg)}"></path>`,',
                '    `<path class="wv-radar-guide" data-wv-radar-guide="boundary-max" d="${buildRadarBoundaryPathData(maxRadiusPx, endAngleDeg)}"></path>`,',
                '    `<path class="wv-radar-guide" data-wv-radar-guide="arc-max" d="${buildRadarArcPathData(maxRadiusPx, startAngleDeg, endAngleDeg, 1)}"></path>`,',
                '    `<path class="wv-radar-guide" data-wv-radar-guide="arc-half" d="${buildRadarArcPathData(maxRadiusPx, startAngleDeg, endAngleDeg, 0.5)}"></path>`,',
                '  ];',
                '  let guidesElement = targetElement.querySelector("[data-wv-radar-role=guides]");',
                '  if (!guidesElement) {',
                '    guidesElement = document.createElementNS("http://www.w3.org/2000/svg", "g");',
                '    guidesElement.setAttribute("class", "wv-radar-guides");',
                '    guidesElement.setAttribute("data-wv-radar-role", "guides");',
                '    if (svgElement.firstChild) {',
                '      svgElement.insertBefore(guidesElement, svgElement.firstChild);',
                '    } else {',
                '      svgElement.appendChild(guidesElement);',
                '    }',
                '  }',
                '  guidesElement.innerHTML = guidesMarkup.join("");',
                '  const rows = [];',
                '  for (let index = 0; index < pieceCount; index += 1) {',
                '    const normalizedRadius = Number(entry.sliceRadiiNormalized[index]);',
                '    const clampedRadius = Number.isFinite(normalizedRadius)',
                '      ? Math.max(0, Math.min(1, normalizedRadius))',
                '      : 0;',
                '    const sliceStartDeg = startAngleDeg + pieceSweepDeg * index;',
                '    const sliceEndDeg = startAngleDeg + pieceSweepDeg * (index + 1);',
                '    const pathData = buildRadarSlicePathData(maxRadiusPx, sliceStartDeg, sliceEndDeg, clampedRadius);',
                '    rows.push(`<path class="wv-radar-slice" data-wv-radar-slice-index="${index}" d="${pathData}" fill="${fillColor}"></path>`);',
                '  }',
                '  slicesElement.innerHTML = rows.join("");',
                '  return true;',
                '}',
            ];
        }

        renderClientHelpers() {
            return [
                'function toRadarRadians(angleDeg) {',
                '  return (Number(angleDeg || 0) - 90) * (Math.PI / 180);',
                '}',
                '',
                'function buildRadarSlicePathData(maxRadiusPx, startAngleDeg, endAngleDeg, radiusNormalized) {',
                '  const radius = Math.max(0, Number(maxRadiusPx) * Number(radiusNormalized));',
                '  if (!(radius > 0)) {',
                '    return "";',
                '  }',
                '  const safeMaxRadius = Math.max(1, Number(maxRadiusPx));',
                '  const center = safeMaxRadius;',
                '  const startRad = toRadarRadians(startAngleDeg);',
                '  const endRad = toRadarRadians(endAngleDeg);',
                '  const startX = center + Math.cos(startRad) * radius;',
                '  const startY = center + Math.sin(startRad) * radius;',
                '  const endX = center + Math.cos(endRad) * radius;',
                '  const endY = center + Math.sin(endRad) * radius;',
                '  let delta = endRad - startRad;',
                '  while (delta < 0) {',
                '    delta += Math.PI * 2;',
                '  }',
                '  while (delta >= Math.PI * 2) {',
                '    delta -= Math.PI * 2;',
                '  }',
                '  const largeArcFlag = delta > Math.PI ? 1 : 0;',
                '  return [`M ${center.toFixed(3)} ${center.toFixed(3)}`, `L ${startX.toFixed(3)} ${startY.toFixed(3)}`, `A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArcFlag} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`, "Z"].join(" ");',
                '}',
                '',
                'function buildRadarArcPathData(maxRadiusPx, startAngleDeg, endAngleDeg, radiusNormalized) {',
                '  const radius = Math.max(0, Number(maxRadiusPx) * Number(radiusNormalized));',
                '  if (!(radius > 0)) {',
                '    return "";',
                '  }',
                '  const safeMaxRadius = Math.max(1, Number(maxRadiusPx));',
                '  const center = safeMaxRadius;',
                '  const startRad = toRadarRadians(startAngleDeg);',
                '  const endRad = toRadarRadians(endAngleDeg);',
                '  const startX = center + Math.cos(startRad) * radius;',
                '  const startY = center + Math.sin(startRad) * radius;',
                '  const endX = center + Math.cos(endRad) * radius;',
                '  const endY = center + Math.sin(endRad) * radius;',
                '  let delta = endRad - startRad;',
                '  while (delta < 0) {',
                '    delta += Math.PI * 2;',
                '  }',
                '  while (delta >= Math.PI * 2) {',
                '    delta -= Math.PI * 2;',
                '  }',
                '  const largeArcFlag = delta > Math.PI ? 1 : 0;',
                '  return [`M ${startX.toFixed(3)} ${startY.toFixed(3)}`, `A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArcFlag} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`].join(" ");',
                '}',
                '',
                'function buildRadarBoundaryPathData(maxRadiusPx, angleDeg) {',
                '  const safeMaxRadius = Math.max(1, Number(maxRadiusPx));',
                '  const center = safeMaxRadius;',
                '  const angleRad = toRadarRadians(angleDeg);',
                '  const edgeX = center + Math.cos(angleRad) * safeMaxRadius;',
                '  const edgeY = center + Math.sin(angleRad) * safeMaxRadius;',
                '  return [`M ${center.toFixed(3)} ${center.toFixed(3)}`, `L ${edgeX.toFixed(3)} ${edgeY.toFixed(3)}`].join(" ");',
                '}',
            ];
        }

        renderClientStyleRules() {
            return [
                '    .wv-radar-display { display: inline-flex; align-items: center; justify-content: center; padding: 10px; }',
                '    .wv-radar-svg { display: block; width: auto; max-width: 100%; height: auto; }',
                '    .wv-radar-guides { pointer-events: none; }',
                '    .wv-radar-guide { fill: none; stroke: rgba(180, 220, 255, 0.58); stroke-width: 1; stroke-linecap: round; }',
                '    .wv-radar-slice { fill-opacity: 0.88; stroke: rgba(180, 220, 255, 0.2); stroke-width: 0.5; }',
            ];
        }
    }

    shared.registerNodeKindImplementation('radar-display', new RadarDisplayWebviewNode());
})();
