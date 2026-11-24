// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * One completeness rule for a stored ``active_target.json`` payload.
 *
 * A stored target is *complete* when it carries the identity of the target and
 * the pin information the editor needs to build capability maps: either a
 * non-empty ``pinCapabilities`` map (a concrete shipped target) or a valid
 * ``openPins`` range (``generic_micropython`` is open-pins only and has no
 * ``pinCapabilities``). The false case this predicate exists to reject is the
 * legacy firmware bootstrap skeleton — five keys (``targetId``,
 * ``displayName``, ``description``, ``configVersion``, ``capabilities``) with
 * no pin information at all — which used to be adopted silently and made the
 * ``irq`` pin capability disappear on ESP32-S3 Mini devices.
 *
 * The app is the single writer of target content: the predicate runs on the
 * normalized payload in ``DeviceDeployment._uploadTargetConfiguration`` before
 * anything is written, and on the parsed file in
 * ``DeviceConnection.loadDeviceInfo`` before a ``DeviceTargetInfo`` is adopted.
 * It always runs on a *resolved effective payload*, never on a raw derived
 * target file (which only carries ``baseTargetId`` and overrides).
 */

/**
 * Return whether *value* is a plain JSON-style object (not ``null``, not an array).
 * @param value Candidate value.
 * @returns ``true`` for a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Return whether *value* is a plain object with at least one own key.
 * @param value Candidate pin-capability map.
 * @returns ``true`` for a non-empty plain object.
 */
function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
    return isPlainObject(value) && Object.keys(value).length > 0;
}

/**
 * Return whether *value* is a valid open-pin range ``{min, max}``.
 * @param value Candidate ``openPins`` value.
 * @returns ``true`` when both bounds are finite numbers with ``min <= max``.
 */
function hasValidOpenPins(value: unknown): boolean {
    if (!isPlainObject(value)) {
        return false;
    }
    const min = value.min;
    const max = value.max;
    return (
        typeof min === 'number' &&
        Number.isFinite(min) &&
        typeof max === 'number' &&
        Number.isFinite(max) &&
        min <= max
    );
}

/**
 * Return whether *payload* is a complete active-target payload.
 *
 * @param payload Parsed ``active_target.json`` content (or an in-memory payload
 *     about to be written).
 * @returns ``true`` when the payload has a non-empty ``targetId`` and either a
 *     non-empty ``pinCapabilities`` object or a valid ``openPins`` range.
 */
export function isCompleteActiveTargetPayload(payload: unknown): boolean {
    if (!isPlainObject(payload)) {
        return false;
    }
    const targetId = payload.targetId;
    if (typeof targetId !== 'string' || targetId.trim() === '') {
        return false;
    }
    return isNonEmptyObject(payload.pinCapabilities) || hasValidOpenPins(payload.openPins);
}
