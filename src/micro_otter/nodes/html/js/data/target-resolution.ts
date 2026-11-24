// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import type { DeviceTargetPayload } from './device-target.js';

/**
 * Keys whose values merge key-wise (base keys kept, the override's value winning on
 * conflict) rather than being replaced wholesale by the override.
 */
const KEYWISE_MERGE_KEYS = new Set(['resources', 'generalCapabilities', 'capabilityToPins']);

/**
 * Return whether *value* is a plain object (not an array, not null).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge a base ``pinCapabilities`` map with a sparse override map.
 *
 * Each pin merges per-pin (override keys win); an override of ``null`` removes
 * the pin from the resolved map. The base map is never mutated.
 */
function mergePinCapabilities(
    baseValue: unknown,
    overrideValue: unknown
): Record<string, unknown> {
    const base = isRecord(baseValue) ? baseValue : {};
    const merged: Record<string, unknown> = { ...base };

    if (!isRecord(overrideValue)) {
        return merged;
    }

    for (const [pin, overridePin] of Object.entries(overrideValue)) {
        if (overridePin === null) {
            delete merged[pin];
            continue;
        }
        const basePin = isRecord(base[pin]) ? base[pin] : {};
        merged[pin] = isRecord(overridePin) ? { ...basePin, ...overridePin } : overridePin;
    }

    return merged;
}

/**
 * Merge a base object with a sparse override object key-wise.
 *
 * Base keys are kept; the override's value replaces the base's on conflict.
 * Neither object is mutated.
 */
function mergeKeywise(baseValue: unknown, overrideValue: unknown): Record<string, unknown> {
    const base = isRecord(baseValue) ? baseValue : {};
    const overrides = isRecord(overrideValue) ? overrideValue : {};
    return { ...base, ...overrides };
}

/**
 * Merge base ``metadata`` with override ``metadata``, concatenating ``notes``.
 *
 * Every metadata key is replaced by the override (or kept), except ``notes``,
 * which is ``base.notes ++ override.notes`` so a derived target never repeats
 * its base's notes. Neither object is mutated.
 */
function mergeMetadata(baseValue: unknown, overrideValue: unknown): Record<string, unknown> {
    const base = isRecord(baseValue) ? baseValue : {};
    const overrides = isRecord(overrideValue) ? overrideValue : {};
    const merged: Record<string, unknown> = { ...base, ...overrides };

    const baseNotes = Array.isArray(base.notes) ? base.notes : [];
    const overrideNotes = Array.isArray(overrides.notes) ? overrides.notes : [];
    if (baseNotes.length > 0 || overrideNotes.length > 0) {
        merged.notes = [...baseNotes, ...overrideNotes];
    }

    return merged;
}

/**
 * Merge a base target payload with a sparse override payload.
 *
 * Merge contract:
 * - scalars replace (the override wins);
 * - ``pinCapabilities[pin]`` merges per pin, ``null`` removes the pin;
 * - ``resources`` / ``generalCapabilities`` / ``capabilityToPins`` merge key-wise
 *   with the override winning;
 * - ``metadata`` merges key-wise with ``notes`` concatenated (base first);
 * - ``openPins`` is inheritable-only: an override's ``openPins`` is ignored and the
 *   base's (if any) is inherited.
 *
 * @param base The base target payload the derived target builds on.
 * @param overrides The sparse ``targetData``.
 * @returns A full ``DeviceTargetPayload`` suitable for ``DeviceTargetInfo``.
 */
export function mergeTargetPayload(
    base: DeviceTargetPayload,
    overrides: Record<string, unknown>
): DeviceTargetPayload {
    const baseRecord = isRecord(base) ? base : {};
    const result: Record<string, unknown> = { ...baseRecord };

    for (const [key, value] of Object.entries(overrides)) {
        if (key === 'openPins') {
            // Inheritable-only: never let an override change the base's open pin set.
            continue;
        }
        if (key === 'pinCapabilities') {
            result.pinCapabilities = mergePinCapabilities(baseRecord.pinCapabilities, value);
            continue;
        }
        if (key === 'metadata') {
            result.metadata = mergeMetadata(baseRecord.metadata, value);
            continue;
        }
        if (KEYWISE_MERGE_KEYS.has(key)) {
            result[key] = mergeKeywise(baseRecord[key], value);
            continue;
        }
        result[key] = value;
    }

    return result as DeviceTargetPayload;
}

/**
 * Backwards-compatible alias for :func:`mergeTargetPayload`.
 *
 * @deprecated Use :func:`mergeTargetPayload`; this alias exists so existing
 *             importers and the M4w tests keep resolving during the rename.
 */
export function resolveUserTargetPayload(
    base: DeviceTargetPayload,
    overrides: Record<string, unknown>
): DeviceTargetPayload {
    return mergeTargetPayload(base, overrides);
}
