// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared variable-store collector: the one definition of "which store namespaces does this
 * collection use" and "which variable names does namespace X hold". Consumed by the
 * `varStores` / `varNames` dynamic-control sources and by the `vars` package generators, so
 * the pickers and the generated Python agree on every name.
 *
 * The module is free of package imports: it only looks at node types, control ids and control
 * values. A namespace lives in an *input default* (`inputDefaults.store` on `var-read` /
 * `var-write`) or in a plain control (`storeNamespace` on the MQTT json-store modes), which is
 * why both storage locations are consulted here instead of in the resolvers.
 */

import { bareNodeTypeId } from './graph-topics.js';
import {
    collectCollectionNodes,
    type AvailabilityCollectionLike,
    type AvailabilityGraphLike,
} from './availability-flags.js';

/** `dynamicOptions.source` of the store picker. */
export const VAR_STORE_SOURCE = 'varStores';

/** `dynamicOptions.source` of the variable-name picker. */
export const VAR_NAME_SOURCE = 'varNames';

/** Sentinel option value meaning "the user types a new name" (same as graphTopics). */
export const VAR_NEW_SENTINEL = '__new__';

/** Namespace used when nothing else is set. */
export const DEFAULT_VAR_STORE = 'default';

/** Control id of the variable-name picker on var-read / var-write. */
export const VAR_NAME_CONTROL_ID = 'name';

/**
 * Input that names a store namespace, per bare node type.
 *
 * `var-read` / `var-write` read a *variable* from a namespace, `var-store-save` /
 * `var-store-load` persist a whole namespace under that name.
 */
export const VAR_STORE_INPUTS: Record<string, string> = {
    'var-read': 'store',
    'var-write': 'store',
    'var-store-save': 'name',
    'var-store-load': 'name',
};

/** Controls in other packages that also create namespaces (`mqtt` json-store mode). */
export const VAR_STORE_NAMESPACE_CONTROLS: string[] = ['storeNamespace'];

/** A collection as far as store collection is concerned (`Collection.getGraphArray()`). */
export type VarStoreCollectionLike = AvailabilityCollectionLike;

/** A graph as far as store collection is concerned (`NodeGraph.getNodes()`). */
export type VarStoreGraphLike = AvailabilityGraphLike;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Control id paired with a sentinel dropdown that reveals it (`name` → `customName`).
 * @param controlId - Id of the dropdown control.
 * @returns The id of the free-text control that holds a newly typed value.
 */
export function customVarControlId(controlId: string): string {
    return `custom${controlId.charAt(0).toUpperCase()}${controlId.slice(1)}`;
}

/**
 * Whether a namespace is owned by a package and must never be offered to a user.
 *
 * The leading underscore is the package namespace marker (`_webcontrol` is written by the
 * webview package), so such a name stays usable as a stored value but never becomes an
 * option.
 *
 * @param name - Candidate namespace.
 * @returns True for reserved (`_`-prefixed) namespaces.
 */
export function isReservedStoreName(name: unknown): boolean {
    return normalizeText(name).startsWith('_');
}

/**
 * Input id that names the store namespace of a node type.
 * @param nodeType - Node type id, package prefixed or bare.
 * @returns The input id, or an empty string when the type does not name a namespace.
 */
export function varStoreInputId(nodeType: unknown): string {
    const inputId = VAR_STORE_INPUTS[bareNodeTypeId(nodeType)];
    return typeof inputId === 'string' ? inputId : '';
}

/**
 * Whether a node type is a variable picker (`var-read` / `var-write`).
 * @param nodeType - Node type id, package prefixed or bare.
 * @returns True for the two node types whose `name` control names a *variable*.
 */
export function isVarNameNode(nodeType: unknown): boolean {
    const type = bareNodeTypeId(nodeType);
    return type === 'var-read' || type === 'var-write';
}


/**
 * Value of an input-row default control, falling back to a same-named control value.
 * @param data - Node data.
 * @param inputId - Input id.
 * @returns The raw stored value, or an empty string when unset.
 */
function inputDefaultValue(data: Record<string, unknown>, inputId: string): string {
    const inputDefaults = asRecord(data.inputDefaults) || {};
    const controlValues = asRecord(data.controlValues) || {};
    return normalizeText(inputDefaults[inputId] ?? controlValues[inputId]);
}

/**
 * Namespace a node actually uses, applying the `__new__` sentinel contract.
 * @param nodeData - Node data carrying `type`, `inputDefaults` and `controlValues`.
 * @returns The effective namespace, or an empty string when none is set.
 */
export function effectiveVarStoreName(nodeData: unknown): string {
    const data = asRecord(nodeData);
    if (!data) {
        return '';
    }
    const inputId = varStoreInputId(data.type);
    const raw = inputId ? inputDefaultValue(data, inputId) : '';
    if (raw !== VAR_NEW_SENTINEL) {
        return raw;
    }
    const controlValues = asRecord(data.controlValues) || {};
    return normalizeText(controlValues[customVarControlId(inputId)]);
}

/**
 * Variable name a node actually uses, applying the `__new__` sentinel contract.
 * @param nodeData - Node data carrying `controlValues`.
 * @returns The effective variable name, or an empty string when none is set.
 */
export function effectiveVarName(nodeData: unknown): string {
    const controlValues = asRecord(asRecord(nodeData)?.controlValues) || {};
    const raw = normalizeText(controlValues[VAR_NAME_CONTROL_ID]);
    if (raw !== VAR_NEW_SENTINEL) {
        return raw;
    }
    return normalizeText(controlValues[customVarControlId(VAR_NAME_CONTROL_ID)]);
}

/** A declared variable: the namespace plus the name its declaring node contributed. */
export interface DeclaredVarEntry {
    store: string;
    name: string;
}

/**
 * Whether a node is currently *declaring* a variable.
 *
 * A declaration site is a `var-read` / `var-write` whose Name picker sits on the `__new__`
 * sentinel and whose companion `customName` control holds a non-empty name. Any other node —
 * including one that only *uses* a plain `name` — is not a declaration site.
 *
 * @param nodeData - Node data carrying `type` and `controlValues`.
 * @returns True when the node declares a variable.
 */
export function isVarNameDeclaration(nodeData: unknown): boolean {
    const data = asRecord(nodeData);
    if (!data || !isVarNameNode(data.type)) {
        return false;
    }
    const controlValues = asRecord(data.controlValues) || {};
    if (normalizeText(controlValues[VAR_NAME_CONTROL_ID]) !== VAR_NEW_SENTINEL) {
        return false;
    }
    return normalizeText(controlValues[customVarControlId(VAR_NAME_CONTROL_ID)]) !== '';
}

/**
 * The `(store, name)` a declaring node contributes, or `null` when it declares nothing.
 *
 * @param nodeData - Node data carrying `type`, `controlValues` and `inputDefaults`.
 * @returns The declared variable, or `null`.
 */
export function declaredVarEntry(nodeData: unknown): DeclaredVarEntry | null {
    if (!isVarNameDeclaration(nodeData)) {
        return null;
    }
    const data = asRecord(nodeData) as Record<string, unknown>;
    const name = normalizeText(
        (asRecord(data.controlValues) || {})[customVarControlId(VAR_NAME_CONTROL_ID)]
    );
    return { store: effectiveVarStoreName(data) || DEFAULT_VAR_STORE, name };
}

/**
 * Every store namespace used in the collection, `default` first and the rest sorted.
 *
 * Reserved (`_`-prefixed) namespaces are filtered: a package owns them, so they are never a
 * user choice. The list spans the whole collection because a `var-read` in one graph may read
 * what a `var-write` in another graph writes.
 *
 * @param collection - Collection exposing `getGraphArray()`.
 * @param graph - Fallback graph when no collection is available.
 * @returns Namespace names, de-duplicated and stable across reloads.
 */
export function collectVarStores(
    collection: VarStoreCollectionLike | null | undefined,
    graph?: VarStoreGraphLike | null
): string[] {
    const stores = [DEFAULT_VAR_STORE];
    const seen = new Set(stores);

    const push = (value: unknown): void => {
        const name = normalizeText(value);
        if (!name || isReservedStoreName(name) || seen.has(name)) {
            return;
        }
        seen.add(name);
        stores.push(name);
    };

    collectCollectionNodes(collection, graph).forEach((rawNode) => {
        const node = asRecord(rawNode);
        if (!node) {
            return;
        }
        push(effectiveVarStoreName(node));
        const controlValues = asRecord(node.controlValues) || {};
        VAR_STORE_NAMESPACE_CONTROLS.forEach((controlId) => push(controlValues[controlId]));
    });

    const [defaultStore, ...rest] = stores;
    rest.sort((left, right) => left.localeCompare(right));
    return [defaultStore, ...rest];
}

/**
 * Every variable *declared* in one namespace, de-duplicated and sorted.
 *
 * Only a `var-read` / `var-write` whose Name picker sits on the sentinel and whose `customName`
 * is non-empty declares a variable; a node that merely *uses* a plain `name` does not make that
 * name exist. `var-store-save` / `var-store-load` name a namespace (not a variable), which
 * already feeds {@link collectVarStores}.
 *
 * @param collection - Collection exposing `getGraphArray()`.
 * @param graph - Fallback graph when no collection is available.
 * @param store - Namespace to list; empty means {@link DEFAULT_VAR_STORE}.
 * @param excludeNodeId - Optional node id to skip, so a declaring node never lists its own name.
 * @returns Declared variable names of that namespace.
 */
export function collectVarNames(
    collection: VarStoreCollectionLike | null | undefined,
    graph: VarStoreGraphLike | null | undefined,
    store: string,
    excludeNodeId?: string
): string[] {
    const wanted = normalizeText(store) || DEFAULT_VAR_STORE;
    const excluded = normalizeText(excludeNodeId);
    const seen = new Set<string>();
    const names: string[] = [];

    collectCollectionNodes(collection, graph).forEach((rawNode) => {
        const node = asRecord(rawNode);
        if (!node) {
            return;
        }
        if (excluded && normalizeText(node.id) === excluded) {
            return;
        }
        const declared = declaredVarEntry(node);
        if (!declared || declared.store !== wanted || seen.has(declared.name)) {
            return;
        }
        seen.add(declared.name);
        names.push(declared.name);
    });

    return names.sort((left, right) => left.localeCompare(right));
}

