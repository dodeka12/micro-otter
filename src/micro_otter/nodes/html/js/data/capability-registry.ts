// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import pinDescriptors from '../../../device/capabilities/pins.json';
import generalDescriptors from '../../../device/capabilities/general.json';

export type CapabilityCheckStrategy =
    | { kind: 'membership' }
    | { kind: 'count'; limitKey: string }
    | { kind: 'constraint'; rule: ConstraintRule };

export interface ConstraintRule {
    when?: Record<string, unknown>;
    forbid?: string[];
}

export interface CapabilityRange {
    min: number | null;
    max: number | null;
}

export type CapabilityDefinition =
    | { kind: 'digital'; input: boolean; output: boolean; openDrain: boolean }
    | { kind: 'pwm'; input: boolean; output: boolean; frequency_hz: CapabilityRange | null }
    | {
          kind: 'adc';
          unit: 1 | 2 | null;
          channel: number | null;
          resolution_bits: number | null;
          wifiConflict: boolean;
      }
    | { kind: 'dac'; channel: number | null; resolution_bits: number | null }
    | { kind: 'touch'; channel: number | null }
    | { kind: 'uart'; port: string | null; role: string }
    | { kind: 'i2c'; bus: string | null; role: string; frequency_hz: CapabilityRange | null }
    | { kind: 'spi'; bus: string | null; role: string }
    | { kind: 'i2s'; controller: number | null; role: string }
    | { kind: 'generic'; id: string; payload: Record<string, unknown> };

export interface CapabilityDescriptor {
    id: string;
    kind?: string | null;
    domain?: 'pin' | 'general';
    derivedKeys: string[];
    icon: string | null;
    glyph?: string | null;
    limitKey: string | null;
    limitInstances?: { prefix: string } | null;
    countKind?: 'pin' | 'bus';
    exclusive?: boolean;
    check: CapabilityCheckStrategy;
    normalize?: (raw: unknown) => unknown;
    constraints?: ConstraintRule[];
}

interface CapabilityRegistryLogger {
    log?: (message: string) => void;
    warn?: (message: string) => void;
}

const GENERIC_PERIPHERAL_FIELDS = [
    'role',
    'bus',
    'port',
    'controller',
    'channel',
    'slot',
    'resolution_bits',
    'resolutionBits',
] as const;

export function normalizeGenericPeripheral(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of GENERIC_PERIPHERAL_FIELDS) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            result[key] = value.trim();
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            result[key] = value;
        }
    }
    return Object.keys(result).length ? result : null;
}

export class CapabilityRegistry {
    private readonly _descriptors: Map<string, CapabilityDescriptor>;
    private readonly _logger: CapabilityRegistryLogger | null;

    constructor({ logger = null }: { logger?: CapabilityRegistryLogger | null } = {}) {
        this._descriptors = new Map();
        this._logger = logger;
        this._registerBuiltIns();
    }

    private _registerBuiltIns(): void {
        // Descriptors are authored as JSON under src/micro_otter/nodes/device/capabilities/
        // so this registry and the Python firmware resolver share one source of truth.
        // index.json (read by the Python loader) must list these files; this module imports
        // them directly so the registry stays synchronous.
        const builtIns = [
            ...pinDescriptors.capabilities,
            ...generalDescriptors.capabilities,
        ] as unknown as CapabilityDescriptor[];

        for (const descriptor of builtIns) {
            this.register(descriptor);
        }
    }

    register(descriptor: CapabilityDescriptor): void {
        if (!descriptor || typeof descriptor !== 'object') {
            throw new TypeError('Capability descriptor must be an object');
        }
        const id = typeof descriptor.id === 'string' ? descriptor.id.trim() : '';
        if (!id) {
            throw new Error('Capability descriptor requires a non-empty string id');
        }
        if (this._descriptors.has(id)) {
            throw new Error(`Capability '${id}' is already registered`);
        }
        if (!Array.isArray(descriptor.derivedKeys) || descriptor.derivedKeys.length === 0) {
            throw new Error(`Capability '${id}' requires a non-empty derivedKeys array`);
        }
        this._descriptors.set(id, descriptor);
        this._logger?.log(`[CapabilityRegistry] Registered capability: ${id}`);
    }

    get(id: string): CapabilityDescriptor | null {
        return this._descriptors.get(id) || null;
    }

    has(id: string): boolean {
        return this._descriptors.has(id);
    }

    getDomain(id: string): 'pin' | 'general' {
        return this._descriptors.get(id)?.domain ?? 'pin';
    }

    getAll(): CapabilityDescriptor[] {
        return Array.from(this._descriptors.values());
    }
}
