// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import type { NodeInfoContent, NodeInfoRow } from './node-info-view.js';
import { resolveDeclaredInputSources } from '../data/type-conversions.js';

export type NodeInfoLocalizedText = string | Record<string, string>;

export interface NodeInfoConnectorSource {
    name?: NodeInfoLocalizedText;
    description?: NodeInfoLocalizedText;
    allowedTypes?: unknown;
    initialTypes?: unknown;
    outputType?: unknown;
    outputTypeControl?: unknown;
    outputTypeByControlValue?: unknown;
    typeInputSources?: unknown;
    [key: string]: unknown;
}

export interface NodeInfoControlSource {
    type?: unknown;
    label?: NodeInfoLocalizedText;
    description?: NodeInfoLocalizedText;
    options?: Array<{
        inputTypes?: unknown;
        outputTypes?: unknown;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
}

export interface NodeInfoSource {
    id?: string | null;
    title?: NodeInfoLocalizedText;
    info?: NodeInfoLocalizedText;
    docsUrl?: string | null;
    icon?: string | null;
    inputs?: Array<NodeInfoConnectorSource>;
    outputs?: Array<NodeInfoConnectorSource>;
    controls?: Array<NodeInfoControlSource>;
    [key: string]: unknown;
}

function localizeNodeText(
    value: NodeInfoLocalizedText | undefined,
    locale: string,
    fallback = ''
): string {
    if (!value) {
        return fallback;
    }

    if (typeof value === 'string') {
        return value;
    }

    return value[locale] || value.en || Object.values(value)[0] || fallback;
}

function normalizeTypeList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const result: string[] = [];
    for (const entry of value) {
        if (typeof entry === 'string') {
            const trimmed = entry.trim();
            if (trimmed && !result.includes(trimmed)) {
                result.push(trimmed);
            }
        }
    }
    return result;
}

function pushTypes(target: string[], value: unknown): void {
    for (const type of normalizeTypeList(value)) {
        if (!target.includes(type)) {
            target.push(type);
        }
    }
}

function collectOptionTypes(
    controls: unknown,
    connectorId: string,
    key: 'inputTypes' | 'outputTypes'
): string[] {
    const result: string[] = [];
    if (!Array.isArray(controls)) {
        return result;
    }

    for (const control of controls as Array<Record<string, unknown>>) {
        if (!control || !Array.isArray(control.options)) {
            continue;
        }
        for (const option of control.options as Array<Record<string, unknown>>) {
            const typeMap = option?.[key];
            if (typeMap && typeof typeMap === 'object') {
                pushTypes(result, (typeMap as Record<string, unknown>)[connectorId]);
            }
        }
    }

    return result;
}

function resolveConnectorTypes(
    definition: Record<string, unknown>,
    controls: unknown,
    direction: 'input' | 'output',
    inputTypesById: Map<string, string[]>
): string[] {
    const types: string[] = [];
    const id = typeof definition?.id === 'string' ? definition.id : '';

    if (direction === 'input') {
        pushTypes(types, definition?.initialTypes);
        pushTypes(types, definition?.allowedTypes);
        pushTypes(types, collectOptionTypes(controls, id, 'inputTypes'));
        return types;
    }

    // Outputs: current declared type first, then alternatives from dynamic typing.
    const unionSources = resolveDeclaredInputSources(definition);
    if (unionSources.length > 0) {
        // A union output is explained by the types that can actually arrive at its
        // source inputs ("bool | string"), not by the representative `outputType`.
        unionSources.forEach((sourceId) => {
            const sourceTypes = inputTypesById.get(sourceId);
            if (sourceTypes) {
                pushTypes(types, sourceTypes);
            }
        });
        pushTypes(types, collectOptionTypes(controls, id, 'outputTypes'));
        return types;
    }

    pushTypes(types, definition?.outputType);
    pushTypes(types, definition?.initialTypes);

    const byControlValue = definition?.outputTypeByControlValue;
    if (byControlValue && typeof byControlValue === 'object') {
        pushTypes(types, Object.values(byControlValue as Record<string, unknown>));
    }

    pushTypes(types, collectOptionTypes(controls, id, 'outputTypes'));
    return types;
}

function toConnectorRows(
    nodeType: NodeInfoSource,
    kind: 'inputs' | 'outputs',
    locale: string
): NodeInfoRow[] {
    const definitions = nodeType[kind];
    if (!Array.isArray(definitions)) {
        return [];
    }

    const inputTypesById = new Map<string, string[]>();
    if (Array.isArray(nodeType.inputs)) {
        for (const input of nodeType.inputs) {
            const record = (input ?? {}) as Record<string, unknown>;
            if (typeof record.id === 'string' && record.id.trim()) {
                const types: string[] = [];
                pushTypes(types, record.initialTypes);
                pushTypes(types, record.allowedTypes);
                inputTypesById.set(record.id.trim(), types);
            }
        }
    }

    return definitions.map((definition) => {
        const record = (definition ?? {}) as Record<string, unknown>;
        return {
            name: localizeNodeText(
                record.name as NodeInfoLocalizedText | undefined,
                locale
            ),
            description: localizeNodeText(
                record.description as NodeInfoLocalizedText | undefined,
                locale
            ),
            types: resolveConnectorTypes(
                record,
                nodeType.controls,
                kind === 'inputs' ? 'input' : 'output',
                inputTypesById
            ),
        };
    });
}

/**
 * Build the content options consumed by NodeInfoView from a node type definition.
 *
 * This is the single source of truth for turning a node type's i18n definition
 * (title/info + input/output/control descriptions) into the shape NodeInfoView
 * renders. GraphPanelView and NodePaletteView both use it so the "Show Info"
 * window stays consistent no matter where it is opened from.
 *
 * Each input/output/control row also carries the resolved `types` list shown in
 * the info view's Type column.
 *
 * @param {NodeInfoSource} nodeType - Node type definition.
 * @param {string} locale - Current locale code (e.g. 'en', 'de').
 * @param {string} fallbackName - Fallback node name when no title is available.
 * @returns {NodeInfoContent} Options for NodeInfoView.
 */
export function buildNodeInfoContent(
    nodeType: NodeInfoSource,
    locale = 'en',
    fallbackName = ''
): NodeInfoContent {
    const resolvedLocale = locale || 'en';
    const fallbackId =
        fallbackName || (typeof nodeType.id === 'string' ? nodeType.id : '');

    const controlRows: NodeInfoRow[] = Array.isArray(nodeType.controls)
        ? nodeType.controls.map((control) => {
              const record = (control ?? {}) as Record<string, unknown>;
              const controlType =
                  typeof record.type === 'string' && record.type.trim()
                      ? [record.type.trim()]
                      : [];
              return {
                  name: localizeNodeText(
                      record.label as NodeInfoLocalizedText | undefined,
                      resolvedLocale
                  ),
                  description: localizeNodeText(
                      record.description as NodeInfoLocalizedText | undefined,
                      resolvedLocale
                  ),
                  types: controlType,
              };
          })
        : [];

    return {
        nodeName: localizeNodeText(nodeType.title, resolvedLocale, fallbackId),
        info: localizeNodeText(nodeType.info, resolvedLocale, ''),
        docsUrl: typeof nodeType.docsUrl === 'string' ? nodeType.docsUrl : null,
        inputs: toConnectorRows(nodeType, 'inputs', resolvedLocale),
        outputs: toConnectorRows(nodeType, 'outputs', resolvedLocale),
        controls: controlRows,
        nodeIcon: typeof nodeType.icon === 'string' ? nodeType.icon : null,
    };
}
