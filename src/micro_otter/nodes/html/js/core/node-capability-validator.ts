// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { DeviceTargetInfo } from '../data/device-target.js';
import type { PinCapabilityPayload } from '../data/device-target.js';
import { evaluateRequiredCapabilities, resolveNodeCapabilityRequirements } from './capability-requirements.js';

type UnknownRecord = Record<string, unknown>;

export type NodeCapabilityIssueScope = 'node' | 'control' | 'input-default';

export interface NodeCapabilityIssue {
    nodeId: string | null;
    scope: NodeCapabilityIssueScope;
    message: string;
    capability: string | null;
    controlId: string | null;
    inputId: string | null;
    source: 'requiredCapabilities' | 'capabilityCheck' | 'graphRule';
    severity?: 'info' | 'warn';
}

export interface TargetCapabilitySnapshot {
    id?: string | null;
    capabilityToPins?: Record<string, unknown> | null;
    generalCapabilities?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    pinCapabilities?: Record<string, unknown> | null;
    openPins?: { min: number; max: number } | null;
}

export interface ValidateNodeCapabilitiesArgs {
    node: UnknownRecord | null | undefined;
    nodeType: UnknownRecord | null | undefined;
    capabilities: TargetCapabilitySnapshot | null | undefined;
    targetId?: string | null;
    validationContext?: CapabilityValidationContext | null;
}

export interface CapabilityValidationContext {
    graphId?: string | null;
    graphNodes?: UnknownRecord[];
    graphConnections?: UnknownRecord[];
    nodeTypesByNodeId?: Record<string, UnknownRecord | null | undefined>;
    collectionNodes?: UnknownRecord[];
}

interface DeviceTargetLike {
    id?: string | null;
    capabilityToPins?: Record<string, unknown> | null;
    generalCapabilities?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    getPinsForCapability?: (capabilityKey: string) => unknown;
}

export interface ValidateNodeCapabilitiesResult {
    nodeId: string | null;
    bypassed: boolean;
    issues: NodeCapabilityIssue[];
}

interface RawCapabilityIssue extends UnknownRecord {
    nodeId?: unknown;
    scope?: unknown;
    message?: unknown;
    capability?: unknown;
    controlId?: unknown;
    inputId?: unknown;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeNodeId(value: unknown, fallback: string | null = null): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return fallback;
}

function normalizeScope(scope: unknown): NodeCapabilityIssueScope {
    if (scope === 'control' || scope === 'input-default' || scope === 'node') {
        return scope;
    }
    return 'node';
}

function toDeviceTarget(
    capabilities: TargetCapabilitySnapshot | null | undefined,
    targetId: string | null | undefined
): DeviceTargetInfo {
    const payload = {
        id: normalizeString(targetId) || normalizeString(capabilities?.id) || null,
        capabilityToPins:
            capabilities?.capabilityToPins && typeof capabilities.capabilityToPins === 'object'
                ? capabilities.capabilityToPins
                : undefined,
        generalCapabilities:
            capabilities?.generalCapabilities &&
            typeof capabilities.generalCapabilities === 'object'
                ? capabilities.generalCapabilities
                : {},
        metadata:
            capabilities?.metadata && typeof capabilities.metadata === 'object'
                ? capabilities.metadata
                : {},
        pinCapabilities:
            capabilities?.pinCapabilities && typeof capabilities.pinCapabilities === 'object'
                ? (capabilities.pinCapabilities as Record<string, PinCapabilityPayload>)
                : undefined,
        openPins: capabilities?.openPins ?? undefined,
    };
    return new DeviceTargetInfo(payload);
}

export function normalizeCapabilityIssues(
    issues: unknown,
    fallbackNodeId: string | null,
    source: 'requiredCapabilities' | 'capabilityCheck' = 'capabilityCheck'
): NodeCapabilityIssue[] {
    if (!Array.isArray(issues)) {
        return [];
    }

    const normalized: NodeCapabilityIssue[] = [];

    for (const issue of issues) {
        if (!issue || typeof issue !== 'object') {
            continue;
        }

        const typedIssue = issue as RawCapabilityIssue;
        const message =
            normalizeString(typedIssue.message) || 'Node capability check failed.';

        normalized.push({
            nodeId: normalizeNodeId(typedIssue.nodeId, fallbackNodeId),
            scope: normalizeScope(typedIssue.scope),
            message,
            capability: normalizeString(typedIssue.capability),
            controlId: normalizeString(typedIssue.controlId),
            inputId: normalizeString(typedIssue.inputId),
            source,
        });
    }

    return normalized;
}

function hasCapability(
    capabilityToPins: Record<string, unknown> | null | undefined,
    capabilityKey: string
): boolean {
    if (!capabilityToPins || typeof capabilityToPins !== 'object') {
        return false;
    }
    const pins = capabilityToPins[capabilityKey];
    return Array.isArray(pins) && pins.length > 0;
}

/**
 * True when the target exposes at least one pin for a capability key.
 * @param deviceTarget - Resolved capability map for the collection's target.
 * @param capability - Capability key such as `dac` or `pwm.output`.
 * @returns `true` when the derived `capabilityToPins` map holds a non-empty pin list.
 */
function targetProvidesPinCapability(
    deviceTarget: DeviceTargetInfo,
    capability: string
): boolean {
    const pins = deviceTarget.getPinsForCapability(capability);
    return Array.isArray(pins) && pins.length > 0;
}

function hasGeneralCapability(
    generalCapabilities: Record<string, unknown> | null | undefined,
    capabilityKey: string
): boolean {
    if (!generalCapabilities || typeof generalCapabilities !== 'object') {
        return false;
    }
    const entry = generalCapabilities[capabilityKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return false;
    }
    return (entry as Record<string, unknown>).supported === true;
}

function resolveCapabilityCheckReference(reference: string): ((args: unknown) => unknown) | null {
    const parts = reference.split('.').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) {
        return null;
    }

    let current: unknown = globalThis;
    for (const part of parts) {
        if (!current || typeof current !== 'object') {
            return null;
        }
        current = (current as Record<string, unknown>)[part];
        if (current === undefined) {
            return null;
        }
    }

    return typeof current === 'function' ? (current as (args: unknown) => unknown) : null;
}

function resolveCapabilityCheckHandler(nodeType: UnknownRecord | null | undefined): ((args: unknown) => unknown) | null {
    if (!nodeType || typeof nodeType !== 'object') {
        return null;
    }

    const getHandler = (nodeType as { getCapabilityCheckHandler?: () => unknown })
        .getCapabilityCheckHandler;
    if (typeof getHandler === 'function') {
        const handler = getHandler.call(nodeType);
        if (typeof handler === 'function') {
            return handler as (args: unknown) => unknown;
        }
    }

    const directHandler = (nodeType as { capabilityCheckHandler?: unknown }).capabilityCheckHandler;
    if (typeof directHandler === 'function') {
        return directHandler as (args: unknown) => unknown;
    }

    const reference = normalizeString((nodeType as { capabilityCheck?: unknown }).capabilityCheck);
    if (!reference) {
        return null;
    }

    return resolveCapabilityCheckReference(reference);
}

function normalizeCustomCheckResult(
    result: unknown,
    fallbackNodeId: string | null
): NodeCapabilityIssue[] {
    if (Array.isArray(result)) {
        return normalizeCapabilityIssues(result, fallbackNodeId, 'capabilityCheck');
    }

    if (result && typeof result === 'object') {
        const typedResult = result as Record<string, unknown>;
        const valid = typedResult.valid;
        if (valid === true) {
            return [];
        }
        if (valid === false) {
            const message =
                normalizeString(typedResult.message) || 'Node capability check failed.';
            return [
                {
                    nodeId: fallbackNodeId,
                    scope: 'node',
                    message,
                    capability: normalizeString(typedResult.capability),
                    controlId: normalizeString(typedResult.controlId),
                    inputId: normalizeString(typedResult.inputId),
                    source: 'capabilityCheck',
                },
            ];
        }
    }

    return [];
}

function normalizePhase(value: unknown, fallback: 'loop' | 'both' = 'both'): 'init' | 'loop' | 'both' {
    if (value === 'init' || value === 'loop' || value === 'both') {
        return value;
    }
    return fallback;
}

function phasesCompatible(outputPhase: 'init' | 'loop' | 'both', inputPhase: 'init' | 'loop' | 'both'): boolean {
    if (outputPhase === 'both' || inputPhase === 'both') {
        return true;
    }
    return outputPhase === inputPhase;
}

function getConnectorPhase(
    connectors: unknown,
    index: unknown,
    fallback: 'loop' | 'both' = 'both'
): 'init' | 'loop' | 'both' {
    if (!Array.isArray(connectors)) {
        return fallback;
    }
    const idx = typeof index === 'number' && Number.isInteger(index) ? index : -1;
    if (idx < 0 || idx >= connectors.length) {
        return fallback;
    }
    const connector = connectors[idx];
    if (!connector || typeof connector !== 'object') {
        return fallback;
    }
    return normalizePhase((connector as Record<string, unknown>).phase, fallback);
}

function resolveNodeExecutionPhase(nodeType: UnknownRecord | null | undefined): 'init' | 'loop' | 'both' {
    return normalizePhase((nodeType as { executionPhase?: unknown } | null)?.executionPhase, 'loop');
}

function collectPhaseIssues(
    node: UnknownRecord | null | undefined,
    nodeType: UnknownRecord | null | undefined,
    validationContext: CapabilityValidationContext | null | undefined
): NodeCapabilityIssue[] {
    if (!validationContext || !Array.isArray(validationContext.graphConnections)) {
        return [];
    }

    const nodeId = normalizeNodeId((node as { id?: unknown } | null)?.id, null);
    if (!nodeId) {
        return [];
    }

    const nodeExecutionPhase = resolveNodeExecutionPhase(nodeType);
    const currentNodeInputs = (nodeType as { inputs?: unknown } | null)?.inputs;
    const issues: NodeCapabilityIssue[] = [];

    for (const edge of validationContext.graphConnections) {
        if (!edge || typeof edge !== 'object') {
            continue;
        }

        const typedEdge = edge as Record<string, unknown>;
        const toNode = normalizeNodeId(typedEdge.toNode, null);
        if (!toNode || toNode !== nodeId) {
            continue;
        }

        const fromNode = normalizeNodeId(typedEdge.fromNode, null);
        if (!fromNode) {
            continue;
        }

        const sourceNodeType = validationContext.nodeTypesByNodeId?.[fromNode] || null;
        const sourceExecutionPhase = resolveNodeExecutionPhase(sourceNodeType as UnknownRecord | null);
        const outputPhase = getConnectorPhase(
            (sourceNodeType as { outputs?: unknown } | null)?.outputs,
            typedEdge.fromIndex,
            'both'
        );
        const inputPhase = getConnectorPhase(currentNodeInputs, typedEdge.toIndex, 'both');

        if (phasesCompatible(outputPhase, inputPhase)) {
            continue;
        }

        issues.push({
            nodeId,
            scope: 'node',
            message:
                `Phase mismatch: ${fromNode}[${String(typedEdge.fromIndex)}] (${outputPhase}/${sourceExecutionPhase}) ` +
                `cannot connect to ${nodeId}[${String(typedEdge.toIndex)}] (${inputPhase}/${nodeExecutionPhase}).`,
            capability: null,
            controlId: null,
            inputId: null,
            source: 'capabilityCheck',
        });
    }

    return issues;
}

export function isCustomTargetSelection(
    targetId: string | null | undefined,
    capabilities: DeviceTargetLike | null | undefined
): boolean {
    // The Custom target was removed in M4w: there is no longer a `custom` id that
    // bypasses validation. The `metadata.isCustomTarget` device flag is kept only
    // for legacy onboarded devices; a *newly imported* payload carrying it is
    // rejected by the target-config store before it can reach this check.
    void targetId;

    return Boolean(
        capabilities?.metadata &&
        (capabilities.metadata as Record<string, unknown>).isCustomTarget === true
    );
}

const CLAIM_ROLE_LABELS: Record<string, string> = {
    'console.tx': 'UART0 TX (console)',
    'console.rx': 'UART0 RX (console)',
    'usb.dminus': 'USB D- (native)',
    'usb.dplus': 'USB D+ (native)',
    'onboard.led': 'onboard LED',
    'onboard.led.red': 'onboard red LED',
    'onboard.led.green': 'onboard green LED',
    'onboard.led.blue': 'onboard blue LED',
};

function humanizeClaimRole(role: string): string {
    return CLAIM_ROLE_LABELS[role] || role.replace(/\./g, ' ');
}

function collectResourceUsageIssues(
    node: UnknownRecord | null | undefined,
    nodeType: UnknownRecord | null | undefined,
    deviceTarget: DeviceTargetInfo,
    nodeId: string | null
): NodeCapabilityIssue[] {
    const resourceUsage = nodeType?.resourceUsage;
    if (!Array.isArray(resourceUsage)) {
        return [];
    }

    const rawControlValues = node?.controlValues;
    const controlValues =
        rawControlValues && typeof rawControlValues === 'object'
            ? (rawControlValues as Record<string, unknown>)
            : {};

    // Entries that are not in effect (optional `allowNone` control, unmatched `requiredWhen`) are
    // not consumed, so validating their selected pin would only add noise.
    const requiredCapabilities = new Set<string>();
    for (const requirement of resolveNodeCapabilityRequirements(nodeType, node)) {
        const group = typeof requirement === 'string' ? [requirement] : requirement;
        for (const required of group) {
            requiredCapabilities.add(required);
        }
    }

    const issues: NodeCapabilityIssue[] = [];

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
        if (!controlId || !capability || !requiredCapabilities.has(capability)) {
            continue;
        }

        const pinValue = controlValues[controlId];
        if (pinValue === undefined || pinValue === null) {
            continue;
        }

        if (!deviceTarget.hasPinCapability(pinValue, capability)) {
            issues.push({
                nodeId,
                scope: 'control',
                message: `Pin ${String(pinValue)} does not support ${capability}.`,
                capability,
                controlId,
                inputId: null,
                source: 'requiredCapabilities',
            });
            continue;
        }

        const pin = deviceTarget.getPinCapability(pinValue);
        if (pin?.strapping) {
            issues.push({
                nodeId,
                scope: 'control',
                message: `Pin ${String(pinValue)} is a strapping pin${
                    pin.strapping.role ? ` (${pin.strapping.role})` : ''
                }; avoid driving it during boot.`,
                capability,
                controlId,
                inputId: null,
                source: 'requiredCapabilities',
            });
        }
        if (pin?.reserved) {
            issues.push({
                nodeId,
                scope: 'control',
                message: `Pin ${String(pinValue)} is reserved${
                    pin.reserved.reason ? ` (${pin.reserved.reason})` : ''
                }.`,
                capability,
                controlId,
                inputId: null,
                source: 'requiredCapabilities',
            });
        }

        const conflictingClaims = deviceTarget.hasClaimConflict(pinValue, capability);
        for (const claim of conflictingClaims) {
            issues.push({
                nodeId,
                scope: 'control',
                message: `Pin ${String(pinValue)} is ${humanizeClaimRole(claim.role)} on this target: ${
                    claim.note ?? 'using it here may conflict.'
                }`,
                capability,
                controlId,
                inputId: null,
                source: 'requiredCapabilities',
                severity: claim.severity,
            });
        }

        const value = (record.value as Record<string, unknown> | undefined) || {};
        const declaredFrequency = value.frequency_hz ?? value.frequencyHz;
        if (typeof declaredFrequency === 'number' && pin?.pwm?.frequency_hz) {
            const range = pin.pwm.frequency_hz;
            if (range.min !== null && declaredFrequency < range.min) {
                issues.push({
                    nodeId,
                    scope: 'control',
                    message: `PWM frequency ${declaredFrequency} Hz is below the pin minimum ${range.min} Hz.`,
                    capability,
                    controlId,
                    inputId: null,
                    source: 'requiredCapabilities',
                });
            } else if (range.max !== null && declaredFrequency > range.max) {
                issues.push({
                    nodeId,
                    scope: 'control',
                    message: `PWM frequency ${declaredFrequency} Hz exceeds the pin maximum ${range.max} Hz.`,
                    capability,
                    controlId,
                    inputId: null,
                    source: 'requiredCapabilities',
                });
            }
        }
    }

    return issues;
}

/**
 * Drop per-pin membership lines for capabilities the target does not have at all.
 *
 * A `scope: 'control'` issue survives unless its capability is reported missing by the requirement
 * evaluation *and* the target exposes no pins for it. Running as a post-filter keeps handler-emitted
 * lines (`servoNode`) subject to the same rule, which an in-collector check would miss.
 */
function suppressMissingCapabilityPinIssues(
    issues: NodeCapabilityIssue[],
    missingCapabilities: ReadonlySet<string>,
    deviceTarget: DeviceTargetInfo
): NodeCapabilityIssue[] {
    return issues.filter(
        (issue) =>
            !(
                issue.scope === 'control' &&
                issue.capability !== null &&
                missingCapabilities.has(issue.capability) &&
                !targetProvidesPinCapability(deviceTarget, issue.capability)
            )
    );
}

export function validateNodeCapabilities({
    node,
    nodeType,
    capabilities,
    targetId = null,
    validationContext = null,
}: ValidateNodeCapabilitiesArgs): ValidateNodeCapabilitiesResult {
    const nodeId = normalizeNodeId((node as { id?: unknown } | null)?.id, null);
    const deviceTarget = toDeviceTarget(capabilities, targetId);
    const phaseIssues = collectPhaseIssues(node, nodeType, validationContext);

    if (isCustomTargetSelection(targetId, deviceTarget) || deviceTarget.isOpenPinSet) {
        return {
            nodeId,
            bypassed: true,
            issues: phaseIssues,
        };
    }

    const requirementResult = evaluateRequiredCapabilities(
        resolveNodeCapabilityRequirements(nodeType, node),
        {
            isGeneral(capability) {
                return deviceTarget.capabilityRegistry.getDomain(capability) === 'general';
            },
            hasGeneralCapability(capability) {
                return hasGeneralCapability(deviceTarget.generalCapabilities, capability);
            },
            hasPinCapability(capability) {
                return hasCapability(deviceTarget.capabilityToPins || null, capability);
            },
        }
    );

    const resourceUsageIssues = collectResourceUsageIssues(node, nodeType, deviceTarget, nodeId);
    const handlerIssues: NodeCapabilityIssue[] = [];
    const capabilityCheckHandler = resolveCapabilityCheckHandler(nodeType);
    if (capabilityCheckHandler) {
        try {
            handlerIssues.push(
                ...normalizeCustomCheckResult(
                    capabilityCheckHandler({
                        nodeData: node,
                        deviceTarget,
                        node,
                        capabilities: deviceTarget,
                        validationContext,
                    }),
                    nodeId
                )
            );
        } catch (error) {
            handlerIssues.push({
                nodeId,
                scope: 'node',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Node capability check handler threw an error.',
                capability: null,
                controlId: null,
                inputId: null,
                source: 'capabilityCheck',
            });
        }
    }

    const requirementIssues: NodeCapabilityIssue[] = [];
    for (const group of requirementResult.missing) {
        const capabilityPath = group.join(' or ');
        requirementIssues.push({
            nodeId,
            scope: 'node',
            message: `Missing required capability: ${capabilityPath}`,
            capability: capabilityPath,
            controlId: null,
            inputId: null,
            source: 'requiredCapabilities',
        });
    }

    const missingCapabilities = new Set(requirementResult.missing.flat());
    return {
        nodeId,
        bypassed: false,
        issues: suppressMissingCapabilityPinIssues(
            [...phaseIssues, ...resourceUsageIssues, ...handlerIssues, ...requirementIssues],
            missingCapabilities,
            deviceTarget
        ),
    };
}
