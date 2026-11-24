// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { DeviceTargetInfo } from '../data/device-target.js';
import type { NodeCapabilityIssue } from './node-capability-validator.js';

type UnknownRecord = Record<string, unknown>;

interface PinUsage {
    nodeId: string;
    capability: string;
}

interface BusUsage {
    nodeId: string;
    type: string;
    instance: string;
}
interface I2sClockUsage {
    nodeId: string;
    instance: string;
    bclkPin: string | null;
    wsPin: string | null;
}


export interface ValidateGraphResourcesArgs {
    target: DeviceTargetInfo;
    graphNodes?: UnknownRecord[];
    nodeTypesByNodeId?: Record<string, UnknownRecord | null | undefined>;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeNodeId(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function collectPinUsages(
    graphNodes: UnknownRecord[],
    nodeTypesByNodeId: Record<string, UnknownRecord | null | undefined>
): Map<string, PinUsage[]> {
    const usages = new Map<string, PinUsage[]>();

    for (const node of graphNodes) {
        const nodeId = normalizeNodeId((node as { id?: unknown })?.id);
        if (!nodeId) {
            continue;
        }
        const nodeType = nodeTypesByNodeId[nodeId];
        const resourceUsage = nodeType?.resourceUsage;
        if (!Array.isArray(resourceUsage)) {
            continue;
        }

        const rawControlValues = (node as { controlValues?: unknown })?.controlValues;
        const controlValues =
            rawControlValues && typeof rawControlValues === 'object'
                ? (rawControlValues as Record<string, unknown>)
                : {};

        for (const entry of resourceUsage) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const record = entry as Record<string, unknown>;
            if (normalizeString(record.kind) !== 'pin') {
                continue;
            }
            const controlId = normalizeString(record.controlId);
            const capability = normalizeString(record.capability);
            if (!controlId || !capability) {
                continue;
            }
            const pinValue = controlValues[controlId];
            if (pinValue === undefined || pinValue === null) {
                continue;
            }
            const pinKey = String(pinValue);
            if (!usages.has(pinKey)) {
                usages.set(pinKey, []);
            }
            usages.get(pinKey)?.push({ nodeId, capability });
        }
    }

    return usages;
}

function collectBusUsages(
    graphNodes: UnknownRecord[],
    nodeTypesByNodeId: Record<string, UnknownRecord | null | undefined>
): BusUsage[] {
    const usages: BusUsage[] = [];

    for (const node of graphNodes) {
        const nodeId = normalizeNodeId((node as { id?: unknown })?.id);
        if (!nodeId) {
            continue;
        }
        const nodeType = nodeTypesByNodeId[nodeId];
        const resourceUsage = nodeType?.resourceUsage;
        if (!Array.isArray(resourceUsage)) {
            continue;
        }

        const rawControlValues = (node as { controlValues?: unknown })?.controlValues;
        const controlValues =
            rawControlValues && typeof rawControlValues === 'object'
                ? (rawControlValues as Record<string, unknown>)
                : {};

        for (const entry of resourceUsage) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const record = entry as Record<string, unknown>;
            if (normalizeString(record.kind) !== 'bus') {
                continue;
            }
            const type = normalizeString(record.type);
            if (!type) {
                continue;
            }

            let instance = '';
            const controlId = normalizeString(record.controlId);
            if (controlId) {
                const controlValue = controlValues[controlId];
                if (controlValue !== undefined && controlValue !== null) {
                    instance = String(controlValue);
                }
            }
            if (!instance) {
                instance = normalizeString(record.bus) ?? '';
            }

            usages.push({ nodeId, type, instance });
        }
    }

    return usages;
}
function collectI2sClockUsages(
    graphNodes: UnknownRecord[],
    nodeTypesByNodeId: Record<string, UnknownRecord | null | undefined>
): I2sClockUsage[] {
    const usages: I2sClockUsage[] = [];

    for (const node of graphNodes) {
        const nodeId = normalizeNodeId((node as { id?: unknown })?.id);
        if (!nodeId) {
            continue;
        }
        const nodeType = nodeTypesByNodeId[nodeId];
        const resourceUsage = nodeType?.resourceUsage;
        if (!Array.isArray(resourceUsage)) {
            continue;
        }

        const rawControlValues = (node as { controlValues?: unknown })?.controlValues;
        const controlValues =
            rawControlValues && typeof rawControlValues === 'object'
                ? (rawControlValues as Record<string, unknown>)
                : {};

        let instance: string | null = null;
        let bclkPin: string | null = null;
        let wsPin: string | null = null;

        for (const entry of resourceUsage) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const record = entry as Record<string, unknown>;
            const kind = normalizeString(record.kind);

            if (kind === 'bus' && normalizeString(record.type) === 'i2s') {
                const controlId = normalizeString(record.controlId);
                if (controlId) {
                    const value = controlValues[controlId];
                    if (value !== undefined && value !== null && value !== '') {
                        instance = String(value);
                    }
                }
                if (!instance) {
                    instance = normalizeString(record.bus);
                }
                continue;
            }

            if (kind === 'pin') {
                const capability = normalizeString(record.capability);
                const controlId = normalizeString(record.controlId);
                if (!capability || !controlId) {
                    continue;
                }
                const value = controlValues[controlId];
                if (value === undefined || value === null || value === '') {
                    continue;
                }
                if (capability === 'i2s.bclk') {
                    bclkPin = String(value);
                } else if (capability === 'i2s.ws') {
                    wsPin = String(value);
                }
            }
        }

        if (instance) {
            usages.push({ nodeId, instance, bclkPin, wsPin });
        }
    }

    return usages;
}


function graphUsesCapability(
    graphNodes: UnknownRecord[],
    nodeTypesByNodeId: Record<string, UnknownRecord | null | undefined>,
    capabilityId: string
): boolean {
    for (const node of graphNodes) {
        const nodeId = normalizeNodeId((node as { id?: unknown })?.id);
        const nodeType = nodeId ? nodeTypesByNodeId[nodeId] : null;

        const required = nodeType?.requiredCapabilities;
        if (Array.isArray(required) && required.includes(capabilityId)) {
            return true;
        }

        const resourceUsage = nodeType?.resourceUsage;
        if (Array.isArray(resourceUsage)) {
            for (const entry of resourceUsage) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                const record = entry as Record<string, unknown>;
                if (record.capability === capabilityId || record.type === capabilityId) {
                    return true;
                }
            }
        }
    }
    return false;
}

function splitLimitKey(limitKey: string): [string, string] | null {
    const index = limitKey.indexOf('.');
    if (index <= 0 || index === limitKey.length - 1) {
        return null;
    }
    return [limitKey.slice(0, index), limitKey.slice(index + 1)];
}

function resolveLimitInstance(
    descriptor: { id: string; limitInstances?: { prefix: string } | null },
    capability: string
): string | null {
    const prefix = descriptor.limitInstances?.prefix;
    if (!prefix) {
        return null;
    }
    const marker = `${descriptor.id}.${prefix}`;
    if (!capability.startsWith(marker) || capability === marker) {
        return null;
    }
    return capability.slice(marker.length);
}

function makeResourceExceededIssue(
    limitKey: string,
    count: number,
    available: string,
    instanceId: string | null = null
): NodeCapabilityIssue {
    const instance = instanceId !== null ? ` (instance '${instanceId}')` : '';
    return {
        nodeId: null,
        scope: 'node',
        message: `Resource '${limitKey}'${instance} exceeded: ${count} used, ${available} available.`,
        capability: null,
        controlId: null,
        inputId: null,
        source: 'capabilityCheck',
    };
}

export function validateGraphResources({
    target,
    graphNodes = [],
    nodeTypesByNodeId = {},
}: ValidateGraphResourcesArgs): NodeCapabilityIssue[] {
    if (target.isOpenPinSet) {
        return [];
    }

    const issues: NodeCapabilityIssue[] = [];
    const pinUsages = collectPinUsages(graphNodes, nodeTypesByNodeId);
    const busUsages = collectBusUsages(graphNodes, nodeTypesByNodeId);

    // 1. Pin-function conflicts: one pin assigned to multiple capabilities.
    for (const [pinKey, usages] of pinUsages) {
        const capabilities = Array.from(new Set(usages.map((usage) => usage.capability)));
        if (capabilities.length > 1) {
            issues.push({
                nodeId: null,
                scope: 'node',
                message: `Pin ${pinKey} is assigned to multiple capabilities: ${capabilities.join(', ')}.`,
                capability: null,
                controlId: null,
                inputId: null,
                source: 'capabilityCheck',
            });
        }

        // 1a. Duplicate same-capability usage: two nodes driving one pin.
        const nodeIdsByCapability = new Map<string, Set<string>>();
        for (const usage of usages) {
            if (!nodeIdsByCapability.has(usage.capability)) {
                nodeIdsByCapability.set(usage.capability, new Set());
            }
            nodeIdsByCapability.get(usage.capability)?.add(usage.nodeId);
        }
        for (const [capability, nodeIds] of nodeIdsByCapability) {
            if (nodeIds.size > 1) {
                issues.push({
                    nodeId: null,
                    scope: 'node',
                    message: `Pin ${pinKey} is used as ${capability} by ${nodeIds.size} nodes; only one driver can own the pin.`,
                    capability,
                    controlId: null,
                    inputId: null,
                    source: 'capabilityCheck',
                });
            }
        }
    }

    // 1b. I2S clock contention: distinct controllers must use distinct BCLK/WS pins.
    const i2sClockUsages = collectI2sClockUsages(graphNodes, nodeTypesByNodeId);
    for (let i = 0; i < i2sClockUsages.length; i += 1) {
        for (let j = i + 1; j < i2sClockUsages.length; j += 1) {
            const a = i2sClockUsages[i];
            const b = i2sClockUsages[j];
            if (a.instance === b.instance) {
                continue;
            }
            if (a.bclkPin && b.bclkPin && a.bclkPin === b.bclkPin) {
                issues.push({
                    nodeId: null,
                    scope: 'node',
                    message:
                        `I2S controllers '${a.instance}' and '${b.instance}' share the BCLK pin ` +
                        `${a.bclkPin}; each I2S controller drives its own clock and must use ` +
                        'separate pins.',
                    capability: 'i2s.bclk',
                    controlId: null,
                    inputId: null,
                    source: 'capabilityCheck',
                });
            }
            if (a.wsPin && b.wsPin && a.wsPin === b.wsPin) {
                issues.push({
                    nodeId: null,
                    scope: 'node',
                    message:
                        `I2S controllers '${a.instance}' and '${b.instance}' share the WS pin ` +
                        `${a.wsPin}; each I2S controller drives its own clock and must use ` +
                        'separate pins.',
                    capability: 'i2s.ws',
                    controlId: null,
                    inputId: null,
                    source: 'capabilityCheck',
                });
            }
        }
    }

    // 2. Shared-pool exhaustion driven by each descriptor's limitKey. A limit may be a
    //    scalar (whole-pool) or a per-instance map (e.g. ADC channels per unit).
    const limitCounts = new Map<string, number>();
    const limitInstanceCounts = new Map<string, Map<string, number>>();
    for (const usages of pinUsages.values()) {
        for (const usage of usages) {
            const descriptor = target.capabilityRegistry
                .getAll()
                .find((entry) => entry.derivedKeys.includes(usage.capability));
            if (descriptor?.countKind === 'bus') {
                // Bus-like resources are counted per bus instance (kind: "bus"), not per pin role.
                continue;
            }
            if (!descriptor?.limitKey) {
                continue;
            }
            const limitKey = descriptor.limitKey;
            limitCounts.set(limitKey, (limitCounts.get(limitKey) || 0) + 1);

            const instance = resolveLimitInstance(descriptor, usage.capability);
            if (instance !== null) {
                let buckets = limitInstanceCounts.get(limitKey);
                if (!buckets) {
                    buckets = new Map<string, number>();
                    limitInstanceCounts.set(limitKey, buckets);
                }
                buckets.set(instance, (buckets.get(instance) || 0) + 1);
            }
        }
    }
    // 2b. Bus/controller pool exhaustion driven by kind: "bus" resourceUsage.
    for (const usage of busUsages) {
        const descriptor = target.capabilityRegistry.get(usage.type);
        if (descriptor?.countKind !== 'bus') {
            continue;
        }
        const limitKey = descriptor.limitKey;
        if (!limitKey) {
            continue;
        }

        // Control-value range check: the selected bus/controller instance must be a valid id.
        if (usage.instance) {
            const parts = splitLimitKey(limitKey);
            const limit = parts ? target.resources?.[parts[0]]?.[parts[1]] : null;
            if (typeof limit === 'number' && limit >= 0) {
                const value = Number(usage.instance);
                if (Number.isInteger(value) && (value < 0 || value >= limit)) {
                    issues.push({
                        nodeId: usage.nodeId,
                        scope: 'control',
                        message: `Resource '${limitKey}' value ${value} is out of range (0..${limit - 1}).`,
                        capability: null,
                        controlId: null,
                        inputId: null,
                        source: 'capabilityCheck',
                    });
                }
            }
        }

        limitCounts.set(limitKey, (limitCounts.get(limitKey) || 0) + 1);
        if (usage.instance) {
            let buckets = limitInstanceCounts.get(limitKey);
            if (!buckets) {
                buckets = new Map<string, number>();
                limitInstanceCounts.set(limitKey, buckets);
            }
            buckets.set(usage.instance, (buckets.get(usage.instance) || 0) + 1);
        }
    }

    // 2c. Exclusive bus/controller instances: an `exclusive` descriptor may be used by one node.
    const exclusiveUsage = new Map<string, string[]>();
    for (const usage of busUsages) {
        const descriptor = target.capabilityRegistry.get(usage.type);
        if (!descriptor?.exclusive || !usage.instance) {
            continue;
        }
        const key = `${usage.type}:${usage.instance}`;
        const nodeIds = exclusiveUsage.get(key) || [];
        nodeIds.push(usage.nodeId);
        exclusiveUsage.set(key, nodeIds);
    }
    for (const [key, nodeIds] of exclusiveUsage) {
        if (nodeIds.length > 1) {
            const separator = key.indexOf(':');
            const type = separator === -1 ? key : key.slice(0, separator);
            const instance = separator === -1 ? '' : key.slice(separator + 1);
            for (const nodeId of nodeIds) {
                issues.push({
                    nodeId,
                    scope: 'control',
                    message: `Resource '${type}' instance '${instance}' is used by multiple nodes; it is exclusive (only one node may use it).`,
                    capability: null,
                    controlId: null,
                    inputId: null,
                    source: 'capabilityCheck',
                });
            }
        }
    }
    for (const [limitKey, totalCount] of limitCounts) {
        const parts = splitLimitKey(limitKey);
        if (!parts) {
            continue;
        }
        const [group, key] = parts;
        const limit = target.resources?.[group]?.[key];
        if (typeof limit === 'number' && limit >= 0) {
            if (totalCount > limit) {
                issues.push(makeResourceExceededIssue(limitKey, totalCount, String(limit)));
            }
            continue;
        }
        if (limit && typeof limit === 'object' && !Array.isArray(limit)) {
            const instanceLimits = limit as Record<string, number>;
            const buckets = limitInstanceCounts.get(limitKey) || new Map<string, number>();
            let totalAvailable = 0;
            let qualifiedCount = 0;
            for (const [instanceId, instanceLimit] of Object.entries(instanceLimits)) {
                if (typeof instanceLimit !== 'number' || instanceLimit < 0) {
                    continue;
                }
                totalAvailable += instanceLimit;
                const count = buckets.get(instanceId) || 0;
                qualifiedCount += count;
                if (count > instanceLimit) {
                    issues.push(
                        makeResourceExceededIssue(limitKey, count, String(instanceLimit), instanceId)
                    );
                }
            }
            const unqualified = totalCount - qualifiedCount;
            if (unqualified > totalAvailable - qualifiedCount) {
                issues.push(
                    makeResourceExceededIssue(
                        limitKey,
                        unqualified,
                        String(totalAvailable - qualifiedCount)
                    )
                );
            }
        }
    }

    // 3. Declarative cross-capability constraints (e.g. ADC2/WiFi coexistence).
    for (const descriptor of target.capabilityRegistry.getAll()) {
        for (const constraint of descriptor.constraints || []) {
            const uses = typeof constraint.when?.uses === 'string' ? constraint.when.uses : null;
            const forbid = Array.isArray(constraint.forbid) ? constraint.forbid : [];
            if (!uses || forbid.length === 0) {
                continue;
            }
            if (!graphUsesCapability(graphNodes, nodeTypesByNodeId, uses)) {
                continue;
            }
            for (const [pinKey, usages] of pinUsages) {
                const conflicting = usages.find((usage) => forbid.includes(usage.capability));
                if (conflicting) {
                    issues.push({
                        nodeId: conflicting.nodeId,
                        scope: 'control',
                        message: `Pin ${pinKey} uses ${conflicting.capability}, which is forbidden while ${uses} is active.`,
                        capability: conflicting.capability,
                        controlId: null,
                        inputId: null,
                        source: 'capabilityCheck',
                    });
                }
            }
        }
    }

    return issues;
}
