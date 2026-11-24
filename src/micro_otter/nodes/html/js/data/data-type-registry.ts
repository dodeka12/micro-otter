// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';
import { BUILT_IN_DATA_TYPE_COLORS } from './data-type-color-palette.js';

const BUILT_IN_TYPE_IDS = new Set(['int', 'float', 'double', 'bool', 'string', 'any']);

export interface LocalizedStringMap {
    [locale: string]: string;
}

export interface DataTypeConnectionDirectionPolicy {
    maxConnections: number;
}

export interface DataTypeConnectionPolicy {
    input?: DataTypeConnectionDirectionPolicy;
    output?: DataTypeConnectionDirectionPolicy;
}

export type DataTypeKind = 'value' | 'structure';

const DEFAULT_INPUT_MAX_CONNECTIONS = 1;
const DEFAULT_OUTPUT_MAX_CONNECTIONS = 0;
const DEFAULT_DATA_TYPE_KIND: DataTypeKind = 'value';

export interface DataTypeDefinition {
    name: string | LocalizedStringMap;
    description?: string | LocalizedStringMap | null;
    color?: string | null;
    icon?: string | null;
    kind?: DataTypeKind | null;
    connectionPolicy?: DataTypeConnectionPolicy | null;
}

interface DataTypeRegistryLogger {
    log?: (message: string) => void;
    warn?: (message: string) => void;
}

class DataTypeRegistryTypeRegisteredPayload extends AppPayload {
    readonly typeId: string;
    readonly definition: DataTypeDefinition;

    constructor(typeId: string, definition: DataTypeDefinition) {
        super('DataTypeRegistry.TypeRegistered.v1');
        this.typeId = typeId;
        this.definition = definition;
    }
}

class DataTypeRegistryTypesClearedPayload extends AppPayload {
    constructor() {
        super('DataTypeRegistry.TypesCleared.v1');
    }
}

class DataTypeRegistryTypeRemovedPayload extends AppPayload {
    readonly typeId: string;

    constructor(typeId: string) {
        super('DataTypeRegistry.TypeRemoved.v1');
        this.typeId = typeId;
    }
}

export class DataTypeRegistry extends AppEventEmitter {
    private readonly _types: Map<string, Required<DataTypeDefinition>>;
    private readonly _logger: DataTypeRegistryLogger | null;

    constructor({ logger = null }: { logger?: DataTypeRegistryLogger | null } = {}) {
        super();
        this._types = new Map();
        this._logger = logger;
        this._registerBuiltInTypes();
    }

    private _registerBuiltInTypes(): void {
        this.register('int', {
            name: { en: 'Integer', de: 'Ganzzahl' },
            description: {
                en: 'Whole-number numeric value',
                de: 'Ganzzahliger numerischer Wert',
            },
            color: BUILT_IN_DATA_TYPE_COLORS.int,
            icon: null,
        });

        this.register('float', {
            name: { en: 'Float', de: 'Fließkommazahl' },
            description: {
                en: 'Floating-point numeric value',
                de: 'Fließkomma-Numerischer Wert',
            },
            color: BUILT_IN_DATA_TYPE_COLORS.float,
            icon: null,
        });

        this.register('double', {
            name: { en: 'Double', de: 'Doppelte Genauigkeit' },
            description: {
                en: 'Double-precision floating-point value',
                de: 'Fließkommawert mit doppelter Genauigkeit',
            },
            color: BUILT_IN_DATA_TYPE_COLORS.double,
            icon: null,
        });

        this.register('bool', {
            name: { en: 'Boolean', de: 'Boolean' },
            description: { en: 'True/false value', de: 'Wahr/Falsch-Wert' },
            color: BUILT_IN_DATA_TYPE_COLORS.bool,
            icon: null,
        });

        this.register('string', {
            name: { en: 'String', de: 'Zeichenkette' },
            description: { en: 'Text value', de: 'Textwert' },
            color: BUILT_IN_DATA_TYPE_COLORS.string,
            icon: null,
        });

        this.register('any', {
            name: { en: 'Any', de: 'Beliebig' },
            description: {
                en: 'Any value type',
                de: 'Beliebiger Werttyp',
            },
            color: BUILT_IN_DATA_TYPE_COLORS.any,
            icon: null,
        });
    }

    register(typeId: string, definition: DataTypeDefinition): void {
        if (typeof typeId !== 'string' || typeId.trim() === '') {
            throw new TypeError('Data type ID must be a non-empty string');
        }

        const trimmedId = typeId.trim();

        if (this._types.has(trimmedId)) {
            throw new Error(`Data type '${trimmedId}' is already registered`);
        }

        if (!definition || typeof definition !== 'object') {
            throw new TypeError('Data type definition must be an object');
        }

        if (!definition.name) {
            throw new Error(`Data type '${trimmedId}' missing required 'name' property`);
        }

        this._types.set(trimmedId, {
            name: definition.name,
            description: definition.description || null,
            color: definition.color || '#888888',
            icon: definition.icon || null,
            kind: this._normalizeKind(definition.kind),
            connectionPolicy: this._normalizeConnectionPolicy(definition.connectionPolicy),
        });

        this._logger?.log(`[DataTypeRegistry] Registered type: ${trimmedId}`);
        this.emit(
            'type-registered',
            new DataTypeRegistryTypeRegisteredPayload(trimmedId, definition)
        );
    }

    private _normalizeKind(kind: unknown): DataTypeKind {
        if (kind === 'structure') {
            return 'structure';
        }

        if (kind === 'value') {
            return 'value';
        }

        return DEFAULT_DATA_TYPE_KIND;
    }

    private _normalizeConnectionPolicy(
        policy: DataTypeConnectionPolicy | null | undefined
    ): DataTypeConnectionPolicy {
        const inputValue = policy?.input?.maxConnections;
        const outputValue = policy?.output?.maxConnections;

        const inputMaxConnections =
            typeof inputValue === 'number' && Number.isInteger(inputValue) && inputValue >= 0
                ? inputValue
                : DEFAULT_INPUT_MAX_CONNECTIONS;

        const outputMaxConnections =
            typeof outputValue === 'number' && Number.isInteger(outputValue) && outputValue >= 0
                ? outputValue
                : DEFAULT_OUTPUT_MAX_CONNECTIONS;

        return {
            input: { maxConnections: inputMaxConnections },
            output: { maxConnections: outputMaxConnections },
        };
    }

    get(typeId: string): Required<DataTypeDefinition> | null {
        return this._types.get(typeId) || null;
    }

    has(typeId: string): boolean {
        return this._types.has(typeId);
    }

    getAll(): Array<{ id: string; definition: Required<DataTypeDefinition> }> {
        return Array.from(this._types.entries()).map(([id, definition]) => ({
            id,
            definition,
        }));
    }

    clear(): void {
        this._types.clear();
        this._registerBuiltInTypes();
        this._logger?.log('[DataTypeRegistry] Cleared all custom types, re-registered built-ins');
        this.emit('types-cleared', new DataTypeRegistryTypesClearedPayload());
    }

    remove(typeId: string): boolean {
        if (BUILT_IN_TYPE_IDS.has(typeId)) {
            this._logger?.warn(`[DataTypeRegistry] Cannot remove built-in type: ${typeId}`);
            return false;
        }

        const removed = this._types.delete(typeId);
        if (removed) {
            this._logger?.log(`[DataTypeRegistry] Removed type: ${typeId}`);
            this.emit('type-removed', new DataTypeRegistryTypeRemovedPayload(typeId));
        }
        return removed;
    }
}
