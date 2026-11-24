// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Boolean (CNF) capability requirement evaluation.
 *
 * `requiredCapabilities` is an AND-of-OR-groups: a top-level array whose elements are
 * either a single capability id (an OR-group of one) or an array of capability ids
 * (an OR-group). This is backward-compatible with the previous flat `string[]` form,
 * which was simply `["a", "b"]` meaning `a AND b`.
 */

export type CapabilityRequirement = string | string[];

export type RequiredCapabilities = CapabilityRequirement[];

export interface CapabilityRequirementContext {
    isGeneral(capability: string): boolean;
    hasGeneralCapability(capability: string): boolean;
    hasPinCapability(capability: string): boolean;
}

export interface CapabilityRequirementResult {
    satisfied: boolean;
    /** Unsatisfied OR-groups; each group is the list of capabilities that all failed. */
    missing: string[][];
}

function normalizeRequirementList(requirements: unknown): RequiredCapabilities {
    if (!Array.isArray(requirements)) {
        return [];
    }

    const normalized: RequiredCapabilities = [];
    for (const entry of requirements) {
        if (typeof entry === 'string') {
            const trimmed = entry.trim();
            if (trimmed) {
                normalized.push(trimmed);
            }
            continue;
        }

        if (Array.isArray(entry)) {
            const group = entry
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean);
            if (group.length > 0) {
                normalized.push(group);
            }
        }
    }
    return normalized;
}

function satisfiesSingle(
    capability: string,
    context: CapabilityRequirementContext
): boolean {
    return context.isGeneral(capability)
        ? context.hasGeneralCapability(capability)
        : context.hasPinCapability(capability);
}

export function evaluateRequiredCapabilities(
    requirements: unknown,
    context: CapabilityRequirementContext
): CapabilityRequirementResult {
    const normalized = normalizeRequirementList(requirements);
    const missing: string[][] = [];

    for (const requirement of normalized) {
        const group = typeof requirement === 'string' ? [requirement] : requirement;
        const unsatisfied = group.filter(
            (capability) => !satisfiesSingle(capability, context)
        );
        if (unsatisfied.length > 0 && unsatisfied.length === group.length) {
            missing.push(unsatisfied);
        }
    }

    return { satisfied: missing.length === 0, missing };
}

/**
 * Combine a node type's declared requirements with those implied by its pin usage.
 *
 * Declared `requiredCapabilities` groups come first, unchanged. Each `resourceUsage` pin entry adds
 * a single-id OR-group unless its control is optional (`dynamicOptions.allowNone`) or its
 * `requiredWhen` condition does not match the node's current control values. Keys already covered by
 * a declaration are skipped, so a repeated key such as three `pwm.output` pins yields one group.
 */
export function resolveNodeCapabilityRequirements(
    nodeType: unknown,
    node: unknown
): RequiredCapabilities {
    const record =
        nodeType && typeof nodeType === 'object' && !Array.isArray(nodeType)
            ? (nodeType as Record<string, unknown>)
            : null;

    const resolved = normalizeRequirementList(record?.requiredCapabilities);
    const covered = new Set<string>();
    for (const requirement of resolved) {
        for (const capability of typeof requirement === 'string' ? [requirement] : requirement) {
            covered.add(capability);
        }
    }

    const resourceUsage = record?.resourceUsage;
    if (!Array.isArray(resourceUsage)) {
        return resolved;
    }

    const rawControlValues =
        node && typeof node === 'object' && !Array.isArray(node)
            ? (node as { controlValues?: unknown }).controlValues
            : null;
    const controlValues =
        rawControlValues && typeof rawControlValues === 'object' && !Array.isArray(rawControlValues)
            ? (rawControlValues as Record<string, unknown>)
            : {};

    for (const entry of resourceUsage) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const usage = entry as Record<string, unknown>;
        const kind = typeof usage.kind === 'string' ? usage.kind.trim() : '';
        if (kind !== 'pin') {
            continue;
        }

        const controlId = typeof usage.controlId === 'string' ? usage.controlId.trim() : '';
        const capability = typeof usage.capability === 'string' ? usage.capability.trim() : '';
        if (!controlId || !capability) {
            continue;
        }

        if (isOptionalPinControl(record, controlId)) {
            continue;
        }
        if (usage.requiredWhen !== undefined && !matchesRequiredWhen(usage.requiredWhen, controlValues)) {
            continue;
        }
        if (covered.has(capability)) {
            continue;
        }

        covered.add(capability);
        resolved.push(capability);
    }

    return resolved;
}

/**
 * True when the named control opts out of being required through `dynamicOptions.allowNone`.
 * Reads raw control definitions and `NodeControlBase` instances alike; an unknown control is
 * *not* optional, so a typo keeps the requirement and fails the data test instead.
 */
function isOptionalPinControl(nodeType: unknown, controlId: string): boolean {
    const controls = (nodeType as { controls?: unknown } | null | undefined)?.controls;
    if (!Array.isArray(controls)) {
        return false;
    }

    const control = controls.find((candidate) => {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }
        return (candidate as { id?: unknown }).id === controlId;
    });
    if (!control || typeof control !== 'object') {
        return false;
    }

    const dynamicOptions = (control as { dynamicOptions?: unknown }).dynamicOptions;
    return Boolean(
        dynamicOptions &&
            typeof dynamicOptions === 'object' &&
            !Array.isArray(dynamicOptions) &&
            (dynamicOptions as { allowNone?: unknown }).allowNone === true
    );
}

/**
 * True when the node's control values satisfy a `requiredWhen` condition.
 * `in` wins over `equals` when both are present; a missing condition, missing control id or
 * missing/`null` control value matches nothing.
 */
function matchesRequiredWhen(condition: unknown, controlValues: unknown): boolean {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
        return false;
    }

    const record = condition as Record<string, unknown>;
    const controlId = typeof record.controlId === 'string' ? record.controlId.trim() : '';
    if (!controlId) {
        return false;
    }

    if (!controlValues || typeof controlValues !== 'object' || Array.isArray(controlValues)) {
        return false;
    }
    const value = (controlValues as Record<string, unknown>)[controlId];
    if (value === undefined || value === null) {
        return false;
    }

    if (Array.isArray(record.in)) {
        return record.in.some((candidate) => candidate === value);
    }
    if ('equals' in record) {
        return record.equals === value;
    }

    return false;
}

/**
 * Read a dotted-path value out of a target's `resources` map (e.g. `i2s.controllers`).
 * Returns the value only when it is a finite number, otherwise `null`.
 */
export function getResourceValue(
    resources: unknown,
    dottedPath: string | null | undefined
): number | null {
    if (!dottedPath) {
        return null;
    }
    if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
        return null;
    }

    let current: unknown = resources;
    for (const part of dottedPath.split('.')) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            return null;
        }
        current = (current as Record<string, unknown>)[part];
    }

    return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

export interface PackageCapabilityTarget {
    capabilityRegistry: {
        getDomain(id: string): 'pin' | 'general';
        get(id: string): { limitKey?: string | null } | null;
    };
    generalCapabilities?: Record<string, unknown> | null;
    resources?: Record<string, unknown> | null;
}

/**
 * Build a package-level capability context. Pin capabilities are satisfied by a positive
 * `resources` count at the descriptor's `limitKey` (e.g. `i2s.controllers`), while general
 * capabilities are satisfied by `generalCapabilities[id].supported === true`.
 */
export function createPackageCapabilityContext(
    target: PackageCapabilityTarget
): CapabilityRequirementContext {
    return {
        isGeneral(id) {
            return target.capabilityRegistry.getDomain(id) === 'general';
        },
        hasGeneralCapability(id) {
            const entry = target.generalCapabilities?.[id];
            return !!entry && typeof entry === 'object' && !Array.isArray(entry)
                ? (entry as Record<string, unknown>).supported === true
                : false;
        },
        hasPinCapability(id) {
            const descriptor = target.capabilityRegistry.get(id);
            if (!descriptor?.limitKey) {
                return false;
            }
            const value = getResourceValue(target.resources, descriptor.limitKey);
            return typeof value === 'number' && value > 0;
        },
    };
}
