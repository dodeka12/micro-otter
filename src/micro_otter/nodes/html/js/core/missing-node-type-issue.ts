// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import type { NodeCapabilityIssue } from './node-capability-validator.js';

/**
 * i18n key for the message shown on a node whose type is absent from the active runtime.
 */
export const MISSING_NODE_TYPE_MESSAGE_KEY = 'graph.nodeTypeMissing';

/**
 * English text used when {@link MISSING_NODE_TYPE_MESSAGE_KEY} has no translation.
 *
 * `I18nService.t()` echoes the key for unknown keys, so a fallback is mandatory here: the message
 * is the only explanation the user sees for the red border.
 */
export const MISSING_NODE_TYPE_MESSAGE_FALLBACK =
    'Unknown node type "{{type}}". Node package "{{package}}" is not installed or does not provide this type. Install the add-on, then reload the workspace.';

/**
 * Split a node type id into its package id.
 *
 * Type ids are `<packageId>.<typeId>` (for example `hello.greet`), so the first segment names the
 * package — and for an add-on package that is exactly the add-on id the user has to install.
 * @param {unknown} typeId - Type id as stored on the node data.
 * @returns {string|null} Package id, or `null` when the id has no package prefix.
 */
export function packageIdForTypeId(typeId: unknown): string | null {
    if (typeof typeId !== 'string') {
        return null;
    }

    const trimmed = typeId.trim();
    const separatorIndex = trimmed.indexOf('.');
    if (separatorIndex <= 0) {
        return null;
    }

    const packageId = trimmed.slice(0, separatorIndex).trim();
    return packageId || null;
}

/**
 * Translate a key, falling back to a provided default when the key is not translated.
 * @param {((key: string, params?: Record<string, unknown>) => string)|null|undefined} translate - Translate function.
 * @param {string} key - i18n key to resolve.
 * @param {Record<string, unknown>} params - Interpolation parameters.
 * @param {string} fallback - Text to use when the key resolves to itself.
 * @returns {string} Resolved or fallback text.
 */
function translateWithFallback(
    translate: ((key: string, params?: Record<string, unknown>) => string) | null | undefined,
    key: string,
    params: Record<string, unknown>,
    fallback: string
): string {
    const resolved = translate?.(key, params);
    if (!resolved || resolved === key) {
        // Interpolate the fallback here: the template placeholders are the same shape the i18n
        // service uses, so both paths read identically.
        return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
            name in params ? String(params[name]) : match
        );
    }
    return resolved;
}

export interface CreateMissingNodeTypeIssueOptions {
    /** Graph node whose type could not be resolved; `null` for graph-level issues. */
    nodeId: string | null;
    /** Type id stored on the node data, e.g. `hello.greet`. */
    typeId: unknown;
    /** Translate function from the view; omitted in tests and headless callers. */
    translate?: ((key: string, params?: Record<string, unknown>) => string) | null;
}

/**
 * Build the capability issue that marks a node whose type the active runtime does not provide.
 *
 * The issue uses the existing capability-issue channel, so the graph panel paints the node with the
 * capability-error border and lists this message in the hover tooltip without any extra rendering
 * path. `source` is `'capabilityCheck'` because `NodeData.setCapabilityIssues` normalizes every
 * issue to that source.
 * @param {CreateMissingNodeTypeIssueOptions} options - Node identity and translate function.
 * @returns {NodeCapabilityIssue} Issue naming the type and the package expected to provide it.
 */
export function createMissingNodeTypeIssue({
    nodeId,
    typeId,
    translate = null,
}: CreateMissingNodeTypeIssueOptions): NodeCapabilityIssue {
    const normalizedTypeId = typeof typeId === 'string' && typeId.trim() ? typeId.trim() : '';
    const packageId = packageIdForTypeId(normalizedTypeId) ?? normalizedTypeId;

    const message = translateWithFallback(
        translate,
        MISSING_NODE_TYPE_MESSAGE_KEY,
        { type: normalizedTypeId, package: packageId },
        MISSING_NODE_TYPE_MESSAGE_FALLBACK
    );

    return {
        nodeId,
        scope: 'node',
        message,
        capability: null,
        controlId: null,
        inputId: null,
        source: 'capabilityCheck',
    };
}
