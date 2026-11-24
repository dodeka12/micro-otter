// Webview value-table generator registration
(function () {
    const globalScope = typeof window !== 'undefined' ? window : self;
    const shared = globalScope.WebviewGeneratorShared;
    const WebviewNodeBase = globalScope.WebviewNodeBase || shared?.WebviewNodeBase;
    if (!shared) {
        throw new Error('Webview shared generator module must load before value-table generator.');
    }
    if (typeof WebviewNodeBase !== 'function') {
        throw new Error('WebviewNodeBase must load before value-table generator.');
    }

    globalScope.NodeInitGenerators.webviewValueTable =
        shared.createWebviewDynamicInitGenerator('value-table');
    globalScope.NodeCodeGenerators.webviewValueTable =
        shared.createWebviewDynamicLoopGenerator('value-table');
    globalScope.NodeHelperGenerators.webviewValueTable = shared.createHelperContributionGenerator(
        'value-table',
        55
    );

    class ValueTableWebviewNode extends WebviewNodeBase {
        getWebserverCapabilities() {
            return {
                needsWebDataStore: true,
                requiresPostRefresh: true,
            };
        }

        normalizeControls(controls, context = {}) {
            const normalizeControlValue =
                typeof context?.helpers?.normalizeControlValue === 'function'
                    ? context.helpers.normalizeControlValue
                    : typeof context.normalizeControlValue === 'function'
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
            const normalizeRowCount =
                typeof context?.helpers?.normalizeValueTableRowCount === 'function'
                    ? context.helpers.normalizeValueTableRowCount
                    : typeof context.normalizeValueTableRowCount === 'function'
                      ? context.normalizeValueTableRowCount
                      : (value) => {
                            const numeric = Number.isFinite(Number(value))
                                ? Math.floor(Number(value))
                                : 1;
                            return Math.max(1, Math.min(5, numeric));
                        };
            const normalizeDecimalPlaces =
                typeof context?.helpers?.normalizeValueTableDecimalPlaces === 'function'
                    ? context.helpers.normalizeValueTableDecimalPlaces
                    : typeof context.normalizeValueTableDecimalPlaces === 'function'
                      ? context.normalizeValueTableDecimalPlaces
                      : (value) => {
                            const numeric = Number.isFinite(Number(value))
                                ? Math.floor(Number(value))
                                : 2;
                            return Math.max(0, Math.min(6, numeric));
                        };

            return {
                rowCount: normalizeRowCount(normalizeControlValue(controls, 'rowCount', 1)),
                decimalPlaces: normalizeDecimalPlaces(
                    normalizeControlValue(controls, 'decimalPlaces', 2)
                ),
            };
        }

        renderRuntimePayload(context) {
            const normalizeControlValue =
                typeof context?.helpers?.normalizeControlValue === 'function'
                    ? context.helpers.normalizeControlValue
                    : typeof context?.normalizeControlValue === 'function'
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
            const normalizeRowCount =
                typeof context?.helpers?.normalizeValueTableRowCount === 'function'
                    ? context.helpers.normalizeValueTableRowCount
                    : typeof context?.normalizeValueTableRowCount === 'function'
                      ? context.normalizeValueTableRowCount
                      : (value) => {
                            const numeric = Number.isFinite(Number(value))
                                ? Math.floor(Number(value))
                                : 1;
                            return Math.max(1, Math.min(5, numeric));
                        };
            const normalizeDecimalPlaces =
                typeof context?.helpers?.normalizeValueTableDecimalPlaces === 'function'
                    ? context.helpers.normalizeValueTableDecimalPlaces
                    : typeof context?.normalizeValueTableDecimalPlaces === 'function'
                      ? context.normalizeValueTableDecimalPlaces
                      : (value) => {
                            const numeric = Number.isFinite(Number(value))
                                ? Math.floor(Number(value))
                                : 2;
                            return Math.max(0, Math.min(6, numeric));
                        };
            const controls =
                context?.controls && typeof context.controls === 'object' ? context.controls : {};
            const valueTableLabelInputs = Array.isArray(context?.io?.valueTableLabelInputs)
                ? context.io.valueTableLabelInputs
                : Array.isArray(context?.valueTableLabelInputs)
                  ? context.valueTableLabelInputs
                  : [];
            const valueTableValueInputs = Array.isArray(context?.io?.valueTableValueInputs)
                ? context.io.valueTableValueInputs
                : Array.isArray(context?.valueTableValueInputs)
                  ? context.valueTableValueInputs
                  : [];

            const rowCount = normalizeRowCount(normalizeControlValue(controls, 'rowCount', 1));
            const decimalPlaces = normalizeDecimalPlaces(
                normalizeControlValue(controls, 'decimalPlaces', 2)
            );

            return [
                `{ 'kind': 'value-table', 'decimalPlaces': ${decimalPlaces}, 'rows': [`,
                ...Array.from({ length: rowCount }, (_, index) => {
                    const labelInput =
                        typeof valueTableLabelInputs[index] === 'string' &&
                        valueTableLabelInputs[index].trim()
                            ? valueTableLabelInputs[index].trim()
                            : 'None';
                    const valueInput =
                        typeof valueTableValueInputs[index] === 'string' &&
                        valueTableValueInputs[index].trim()
                            ? valueTableValueInputs[index].trim()
                            : 'None';
                    const separator = index + 1 < rowCount ? ',' : '';
                    return `    { 'label': ${labelInput}, 'value': ${valueInput} }${separator}`;
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
            const escapeHtml =
                typeof context?.escapeHtml === 'function'
                    ? context.escapeHtml
                    : (value) => String(value === undefined || value === null ? '' : value);
            const normalizeBindingSegment =
                typeof context?.normalizeBindingSegment === 'function'
                    ? context.normalizeBindingSegment
                    : (value) =>
                          String(value ?? '')
                              .trim()
                              .replace(/[^a-zA-Z0-9_:-]+/g, '_') || 'unknown';
            const normalizeRowCount =
                typeof context?.normalizeValueTableRowCount === 'function'
                    ? context.normalizeValueTableRowCount
                    : (value) => {
                          const numeric = Number.isFinite(Number(value))
                              ? Math.floor(Number(value))
                              : 1;
                          return Math.max(1, Math.min(5, numeric));
                      };

            const configuredRowCount = normalizeRowCount(element?.controls?.rowCount);
            const elementId =
                typeof element?.binding?.elementId === 'string'
                    ? element.binding.elementId.trim()
                    : '';
            const safeElementId = elementId || `wv_el_vtable_${normalizeBindingSegment(nodeId)}`;

            return [
                `${indent}<div id="${escapeHtml(safeElementId)}" class="wv-content wv-value-table" data-node-id="${escapeHtml(nodeId)}" data-node-kind="value-table" data-wv-row-count="${configuredRowCount}">`,
                `${childIndent}<table class="wv-value-table-grid" role="table" aria-label="Value table">`,
                `${childIndent}  <tbody>`,
                ...Array.from({ length: configuredRowCount }, (_, index) => {
                    const rowNumber = index + 1;
                    return [
                        `${childIndent}    <tr class="wv-value-table-row" data-wv-row-index="${rowNumber}">`,
                        `${childIndent}      <td class="wv-value-table-label" data-wv-cell-role="label"></td>`,
                        `${childIndent}      <td class="wv-value-table-value" data-wv-cell-role="value"></td>`,
                        `${childIndent}    </tr>`,
                    ].join('\n');
                }),
                `${childIndent}  </tbody>`,
                `${childIndent}</table>`,
                `${indent}</div>`,
            ];
        }

        renderClientUpdateHandler() {
            return [
                'function applyValueTableUpdate(targetElement, entry) {',
                '  if (!Array.isArray(entry.rows)) {',
                '    return false;',
                '  }',
                '  const requestedDecimalPlaces = Number(entry.decimalPlaces);',
                '  const decimalPlaces = Number.isFinite(requestedDecimalPlaces)',
                '    ? Math.min(6, Math.max(0, Math.floor(requestedDecimalPlaces)))',
                '    : 2;',
                '  const tableBody = targetElement.querySelector("tbody");',
                '  if (!tableBody) {',
                '    return false;',
                '  }',
                '  function formatValueTableCellValue(value) {',
                '    if (value === null || value === undefined) {',
                '      return "";',
                '    }',
                '    const numericValue = Number(value);',
                '    if (Number.isFinite(numericValue)) {',
                '      return numericValue.toFixed(decimalPlaces);',
                '    }',
                '    return String(value ?? "");',
                '  }',
                '  const existingRows = Array.from(tableBody.querySelectorAll("[data-wv-row-index]"));',
                '  const rowCount = Math.min(5, Math.max(1, entry.rows.length));',
                '  if (existingRows.length !== rowCount) {',
                '    const rowMarkup = [];',
                '    for (let index = 0; index < rowCount; index += 1) {',
                '      const rowNumber = index + 1;',
                '      rowMarkup.push(`<tr class="wv-value-table-row" data-wv-row-index="${rowNumber}"><td class="wv-value-table-label" data-wv-cell-role="label"></td><td class="wv-value-table-value" data-wv-cell-role="value"></td></tr>`);',
                '    }',
                '    tableBody.innerHTML = rowMarkup.join("");',
                '  }',
                '  const rows = Array.from(tableBody.querySelectorAll("[data-wv-row-index]"));',
                '  rows.forEach((rowElement, index) => {',
                '    const row = entry.rows[index] && typeof entry.rows[index] === "object" ? entry.rows[index] : {};',
                '    const labelElement = rowElement.querySelector("[data-wv-cell-role=label]");',
                '    const valueElement = rowElement.querySelector("[data-wv-cell-role=value]");',
                '    if (labelElement) {',
                '      labelElement.textContent = String(row.label ?? "");',
                '    }',
                '    if (valueElement) {',
                '      valueElement.textContent = formatValueTableCellValue(row.value);',
                '    }',
                '  });',
                '  targetElement.setAttribute("data-wv-row-count", String(rowCount));',
                '  targetElement.setAttribute("data-wv-decimal-places", String(decimalPlaces));',
                '  return true;',
                '}',
            ];
        }

        renderClientStyleRules() {
            return [
                '    .wv-value-table { width: fit-content; max-width: 100%; }',
                '    .wv-value-table-grid { width: auto; max-width: 100%; border-collapse: collapse; border-spacing: 0; border: 0; table-layout: auto; }',
                '    .wv-value-table-grid tbody, .wv-value-table-grid tr, .wv-value-table-grid td { border: 0; }',
                '    .wv-value-table-grid td { padding: 2px 0; }',
                '    .wv-value-table-label { color: #b9c8ea; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 14px; min-width: 8ch; }',
                '    .wv-value-table-value { color: #f2f5ff; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; min-width: 10ch; }',
            ];
        }
    }

    shared.registerNodeKindImplementation('value-table', new ValueTableWebviewNode());
})();
