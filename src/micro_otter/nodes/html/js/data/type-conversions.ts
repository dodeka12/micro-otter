// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

const BUILT_IN_TYPE_IDS = new Set(['int', 'float', 'double', 'bool', 'string', 'any']);

const IMPLICIT_CONVERSION_MAP: Record<string, string[]> = {
    bool: ['int', 'float', 'double'],
    int: ['float', 'double'],
    float: ['double'],
};

const NAMESPACED_TYPE_ID_PATTERN = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/;

function uniqueTypes(types: string[]): string[] {
    return Array.from(new Set(types));
}

export type TypeCompatibilityResolution = {
    compatible: boolean;
    targetType: string | null;
    requiresImplicitConversion: boolean;
};

export type DataTypeKind = 'value' | 'structure';

export type TypeCompatibilityOptions = {
    resolveTypeKind?: ((typeId: string) => DataTypeKind | null | undefined) | null;
};

export type BuiltInTypeId = 'int' | 'float' | 'double' | 'bool' | 'string' | 'any';

const DEFAULT_DATA_TYPE_KIND: DataTypeKind = 'value';

function isNamespacedTypeId(typeId: string): boolean {
    return NAMESPACED_TYPE_ID_PATTERN.test(typeId);
}

function assertValidTypeId(typeId: unknown, context: string): string {
    if (typeof typeId !== 'string') {
        throw new TypeError(`${context} must be a string type identifier`);
    }

    const normalized = typeId.trim();
    if (!normalized) {
        throw new TypeError(`${context} must not be empty`);
    }

    if (BUILT_IN_TYPE_IDS.has(normalized) || isNamespacedTypeId(normalized)) {
        return normalized;
    }

    throw new TypeError(
        `${context} '${normalized}' is invalid. Expected one of [int, float, double, bool, string, any] or namespace.type`
    );
}

function isBuiltInTypeId(typeId: string): boolean {
    return BUILT_IN_TYPE_IDS.has(typeId);
}

export function normalizeDataTypeId(typeId: unknown): string {
    return assertValidTypeId(typeId, 'Type identifier');
}

export function normalizeAllowedTypes(allowedTypes: unknown): string[] {
    if (!Array.isArray(allowedTypes)) {
        return [];
    }

    return uniqueTypes(
        allowedTypes
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .filter((value) => value !== 'unknown')
            .map((value) => assertValidTypeId(value, 'Allowed input type'))
            .filter(Boolean)
    );
}

export function getPrimaryAllowedType(allowedTypes: unknown): string {
    const normalized = normalizeAllowedTypes(allowedTypes);
    return normalized[0] || 'any';
}

export function getFirstAllowedTypeForConnectorColor(allowedTypes: unknown): string {
    return getPrimaryAllowedType(allowedTypes);
}

const UNION_WIDENING_ORDER = ['bool', 'int', 'float', 'double'] as const;

/**
 * Normalize an output's declared `typeInputSources` array.
 * @param output - Output definition.
 * @returns Trimmed, non-empty source input ids in declaration order.
 */
export function resolveDeclaredInputSources(output: unknown): string[] {
    const source = output && typeof output === 'object' ? (output as Record<string, unknown>) : {};
    const raw = source.typeInputSources;
    return Array.isArray(raw)
        ? raw
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.trim())
              .filter((value) => value.length > 0)
        : [];
}

/**
 * Input ids an `affectsInputs` dropdown currently leaves visible.
 *
 * This is the single rule shared by connector visibility and union typing, so the UI and
 * the typing engine cannot disagree about which connectors exist.
 *
 * @param nodeData - Node definition with `inputs`, `controls` and `controlValues`.
 * @returns The active input ids, or `null` when nothing narrows the connector list.
 */
export function resolveActiveInputIds(nodeData: unknown): Set<string> | null {
    const node =
        nodeData && typeof nodeData === 'object' ? (nodeData as Record<string, unknown>) : {};
    const controls = Array.isArray(node.controls) ? node.controls : [];
    const controlValues =
        node.controlValues && typeof node.controlValues === 'object'
            ? (node.controlValues as Record<string, unknown>)
            : {};

    const activeInputIds = new Set<string>();

    for (const control of controls) {
        if (!control || typeof control !== 'object') {
            continue;
        }

        const dropdown = control as Record<string, unknown>;
        if (dropdown.type !== 'dropdown' || !dropdown.affectsInputs) {
            continue;
        }

        const controlId = typeof dropdown.id === 'string' ? dropdown.id : '';
        if (!controlId) {
            continue;
        }

        const selectedValue = controlValues[controlId] ?? dropdown.default;
        const options = Array.isArray(dropdown.options) ? dropdown.options : [];
        const selectedOption = options.find((option) => {
            return (
                option !== null &&
                typeof option === 'object' &&
                (option as Record<string, unknown>).value === selectedValue
            );
        }) as Record<string, unknown> | undefined;

        const activeInputs = Array.isArray(selectedOption?.activeInputs)
            ? (selectedOption.activeInputs as unknown[])
            : [];

        for (const inputId of activeInputs) {
            if (typeof inputId !== 'string') {
                continue;
            }
            const normalized = inputId.trim();
            if (normalized.length > 0) {
                activeInputIds.add(normalized);
            }
        }
    }

    return activeInputIds.size > 0 ? activeInputIds : null;
}

/**
 * Resolves the ids of a node's controls that an affecting dropdown hides.
 *
 * Mirrors the "declared membership" rule of `getVisibleControls()`: an affecting dropdown
 * hides only the controls it lists in at least one option and does not select right now. A
 * control no dropdown ever mentions stays visible; ids the node does not declare are never
 * reported.
 *
 * This is the single rule shared by the node UI (`getVisibleControls()`) and by
 * `NodeGraph` when it applies dropdown option connector types, so rendered rows and
 * connector types cannot disagree about which control is hidden.
 *
 * @param nodeData - Node data with `controls`, `controlValues` and optional dropdown
 * `options`.
 * @param extraAffectingDropdowns - Dropdowns outside `nodeData.controls` that still reveal
 * or hide controls (input-row default control pickers).
 * @returns Set of hidden control ids (empty when nothing is hidden).
 */
export function resolveHiddenControlIds(
    nodeData: unknown,
    extraAffectingDropdowns: unknown[] = []
): Set<string> {
    const node =
        nodeData && typeof nodeData === 'object' ? (nodeData as Record<string, unknown>) : {};
    const controls = Array.isArray(node.controls) ? node.controls : [];
    const controlValues =
        node.controlValues && typeof node.controlValues === 'object'
            ? (node.controlValues as Record<string, unknown>)
            : {};

    const affectingDropdowns = [
        ...controls.filter((control) => {
            if (!control || typeof control !== 'object') {
                return false;
            }
            const dropdown = control as Record<string, unknown>;
            return dropdown.type === 'dropdown' && Boolean(dropdown.affectsControls);
        }),
        ...(Array.isArray(extraAffectingDropdowns) ? extraAffectingDropdowns : []),
    ].filter((dropdown) => Boolean(dropdown) && typeof dropdown === 'object');

    const hiddenControlIds = new Set<string>();
    if (affectingDropdowns.length === 0) {
        return hiddenControlIds;
    }

    const declaredIds: Set<string>[] = [];
    const selectedIds: Set<string>[] = [];

    for (const dropdown of affectingDropdowns) {
        const typedDropdown = dropdown as Record<string, unknown>;
        const controlId = typeof typedDropdown.id === 'string' ? typedDropdown.id : '';
        const options = Array.isArray(typedDropdown.options) ? typedDropdown.options : [];

        const declared = new Set<string>();
        for (const option of options) {
            if (!option || typeof option !== 'object') {
                continue;
            }
            const activeControls = (option as Record<string, unknown>).activeControls;
            if (!Array.isArray(activeControls)) {
                continue;
            }
            for (const id of activeControls) {
                if (typeof id === 'string') {
                    declared.add(id);
                }
            }
        }
        declaredIds.push(declared);

        const selectedValue = controlValues[controlId] ?? typedDropdown.default;
        const selectedOption = options.find((option) => {
            return (
                option !== null &&
                typeof option === 'object' &&
                (option as Record<string, unknown>).value === selectedValue
            );
        }) as Record<string, unknown> | undefined;
        const selectedActiveControls = Array.isArray(selectedOption?.activeControls)
            ? (selectedOption.activeControls as unknown[])
            : [];
        const selected = new Set<string>();
        for (const id of selectedActiveControls) {
            if (typeof id === 'string') {
                selected.add(id);
            }
        }
        selectedIds.push(selected);
    }

    controls.forEach((control) => {
        if (!control || typeof control !== 'object') {
            return;
        }
        const controlId = (control as Record<string, unknown>).id;
        if (typeof controlId !== 'string') {
            return;
        }

        for (let index = 0; index < affectingDropdowns.length; index += 1) {
            if (declaredIds[index].has(controlId) && !selectedIds[index].has(controlId)) {
                hiddenControlIds.add(controlId);
                return;
            }
        }
    });

    return hiddenControlIds;
}

/**
 * Representative type for an output whose type is a union of several candidates.
 *
 * A union has to collapse to one string because connector colour and the connection
 * policies are single-valued. The rule is:
 * - no candidates -> `any`
 * - one candidate -> that candidate
 * - `any` present -> `any`
 * - only `bool`/`int`/`float`/`double` -> the widest one (`bool < int < float < double`)
 * - a namespaced id (it contains `.`) among several candidates -> `any`, because a
 *   package type such as `core.tuple` cannot be represented by a scalar connector type
 * - anything else -> the first candidate, in declaration order
 *
 * The namespaced rule runs after numeric widening so numeric unions keep their result,
 * and after deduplication so `['core.tuple', 'core.tuple']` still returns `core.tuple`.
 * It only changes this representative: connection validation still requires every
 * candidate to fit the target input.
 *
 * @param candidates - Declared candidate types (any shape; non-strings are ignored).
 * @returns The representative type id.
 */
export function resolveUnionOutputType(candidates: unknown): string {
    const normalized = uniqueTypes(
        (Array.isArray(candidates) ? candidates : [])
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .filter((value) => value !== 'unknown')
    );

    if (normalized.length === 0) {
        return 'any';
    }
    if (normalized.length === 1) {
        return normalized[0];
    }
    if (normalized.includes('any')) {
        return 'any';
    }

    const numeric = normalized.filter((typeId) =>
        (UNION_WIDENING_ORDER as readonly string[]).includes(typeId)
    );
    if (numeric.length === normalized.length) {
        return numeric.reduce((widest, typeId) =>
            UNION_WIDENING_ORDER.indexOf(typeId as never) >
            UNION_WIDENING_ORDER.indexOf(widest as never)
                ? typeId
                : widest
        );
    }

    if (normalized.some((typeId) => typeId.includes('.'))) {
        return 'any';
    }

    return normalized[0];
}

export function canImplicitlyConvertType(fromType: unknown, toType: unknown): boolean {
    const normalizedFrom = normalizeDataTypeId(fromType);
    const normalizedTo = normalizeDataTypeId(toType);

    if (!isBuiltInTypeId(normalizedFrom) || !isBuiltInTypeId(normalizedTo)) {
        return false;
    }

    return (IMPLICIT_CONVERSION_MAP[normalizedFrom] || []).includes(normalizedTo);
}

export function resolveTypeCompatibility(
    outputType: unknown,
    allowedTypes: unknown,
    { resolveTypeKind = null }: TypeCompatibilityOptions = {}
): TypeCompatibilityResolution {
    const normalizedOutputType = assertValidTypeId(outputType, 'Output type');
    const normalizedAllowedTypes = normalizeAllowedTypes(allowedTypes);

    const getTypeKind = (typeId: string): DataTypeKind => {
        if (typeof resolveTypeKind !== 'function') {
            return DEFAULT_DATA_TYPE_KIND;
        }

        const kind = resolveTypeKind(typeId);
        return kind === 'structure' ? 'structure' : 'value';
    };

    const outputTypeKind = getTypeKind(normalizedOutputType);
    const isValueType = (typeId: string): boolean => getTypeKind(typeId) === 'value';
    const hasValueAllowedType = normalizedAllowedTypes.some((allowedType) =>
        isValueType(allowedType)
    );

    if (!normalizedAllowedTypes.length) {
        return { compatible: false, targetType: null, requiresImplicitConversion: false };
    }

    if (normalizedOutputType === 'any') {
        if (!hasValueAllowedType) {
            return { compatible: false, targetType: null, requiresImplicitConversion: false };
        }

        return {
            compatible: true,
            targetType: normalizedAllowedTypes.includes('any') ? 'any' : normalizedAllowedTypes[0],
            requiresImplicitConversion: false,
        };
    }

    if (normalizedAllowedTypes.includes('any')) {
        if (outputTypeKind !== 'value') {
            return { compatible: false, targetType: null, requiresImplicitConversion: false };
        }

        return {
            compatible: true,
            targetType: 'any',
            requiresImplicitConversion: false,
        };
    }

    if (normalizedAllowedTypes.includes(normalizedOutputType)) {
        return {
            compatible: true,
            targetType: normalizedOutputType,
            requiresImplicitConversion: false,
        };
    }

    if (!isBuiltInTypeId(normalizedOutputType)) {
        return { compatible: false, targetType: null, requiresImplicitConversion: false };
    }

    const primaryTargetType = normalizedAllowedTypes[0];
    if (canImplicitlyConvertType(normalizedOutputType, primaryTargetType)) {
        return {
            compatible: true,
            targetType: primaryTargetType,
            requiresImplicitConversion: true,
        };
    }

    const fallbackTargetType = normalizedAllowedTypes.find((allowedType) =>
        canImplicitlyConvertType(normalizedOutputType, allowedType)
    );

    if (fallbackTargetType) {
        return {
            compatible: true,
            targetType: fallbackTargetType,
            requiresImplicitConversion: true,
        };
    }

    return { compatible: false, targetType: null, requiresImplicitConversion: false };
}
