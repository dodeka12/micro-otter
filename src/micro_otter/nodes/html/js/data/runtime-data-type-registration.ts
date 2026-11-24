// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import type { DataTypeDefinition } from './data-type-registry.js';

type DataTypeRegistryLike = {
    clear: () => void;
};

type CollectionLike = {
    getDataTypeRegistry: () => DataTypeRegistryLike;
    registerDataType: (typeId: string, definition: DataTypeDefinition) => void;
    getDataType: (typeId: string) => Required<DataTypeDefinition> | null;
};

type NodePackageLike = {
    getDataTypes?: () => Record<string, DataTypeDefinition>;
};

type RuntimeLike = {
    nodePackages?: NodePackageLike[];
};

/**
 * Register all package-defined data types from a runtime into the provided collection registry.
 * Built-ins are preserved by clearing custom registrations before applying package declarations.
 * @param collection
 * @param runtime
 * @returns Number of newly registered package data types.
 */
export function registerRuntimeDataTypesForCollection(
    collection: CollectionLike,
    runtime: RuntimeLike | null | undefined
): number {
    const registry = collection.getDataTypeRegistry();
    registry.clear();

    const packages = Array.isArray(runtime?.nodePackages) ? runtime.nodePackages : [];
    let registeredCount = 0;

    for (const nodePackage of packages) {
        const packageDataTypes =
            nodePackage && typeof nodePackage.getDataTypes === 'function'
                ? nodePackage.getDataTypes()
                : {};

        Object.entries(packageDataTypes).forEach(([typeId, definition]) => {
            if (!typeId || !definition || collection.getDataType(typeId)) {
                return;
            }
            collection.registerDataType(typeId, definition);
            registeredCount += 1;
        });
    }

    return registeredCount;
}
