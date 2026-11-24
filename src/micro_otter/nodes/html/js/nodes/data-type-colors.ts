// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import {
    getFirstAllowedTypeForConnectorColor,
    normalizeDataTypeId,
} from '../data/type-conversions.js';
import {
    BUILT_IN_DATA_TYPE_COLORS,
    DEFAULT_DATA_TYPE_COLOR,
} from '../data/data-type-color-palette.js';

type DataTypeRegistryLike = {
    get: (typeId: string) => { color?: string | null } | null;
};

let dataTypeRegistryResolver: (() => DataTypeRegistryLike | null) | null = null;

export function setDataTypeColorRegistryResolver(
    resolver: (() => DataTypeRegistryLike | null) | null
): void {
    dataTypeRegistryResolver = resolver;
}

export function getDataTypeColor(typeId: string | null | undefined): string {
    const normalized = normalizeDataTypeId(typeId);
    const registry = dataTypeRegistryResolver?.();
    const resolvedColor = registry?.get(normalized)?.color;
    if (typeof resolvedColor === 'string' && resolvedColor.trim()) {
        return resolvedColor;
    }
    return BUILT_IN_DATA_TYPE_COLORS[normalized] || DEFAULT_DATA_TYPE_COLOR;
}

export function getInputConnectorType(allowedTypes: unknown): string {
    return getFirstAllowedTypeForConnectorColor(allowedTypes);
}
