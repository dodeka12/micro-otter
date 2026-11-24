// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import NodeControlBase, { type NodeControlLayout } from './node-control-base.js';
import NodeControlDropdown from './node-control-dropdown.js';
import { MULTI_DROPDOWN_TYPE } from './node-control-dropdown.js';
import NodeControlNumber from './node-control-number.js';
import NodeControlText from './node-control-text.js';

type UnknownRecord = Record<string, unknown>;

export type NodeExecutionPhase = 'init' | 'loop' | 'both';
export type NodeConnectorPhase = 'init' | 'loop' | 'both';

export interface LocalizedTextMap {
    [locale: string]: string;
}

export interface NodeControlDefinition extends UnknownRecord {
    id?: string;
    type?: string;
    label?: string | LocalizedTextMap;
    description?: string | LocalizedTextMap;
    layout?: NodeControlLayout;
    icon?: string;
}

export interface NodeIoDefinition extends UnknownRecord {
    name?: string | LocalizedTextMap;
    description?: string | LocalizedTextMap;
    icon?: string;
    phase?: NodeConnectorPhase;
    defaultControl?: NodeControlBase | NodeControlDefinition;
}

export interface ImplementationDefinition {
    type?: string;
    value?: unknown;
    imports?: string[];
    initFunction?: string;
    helperGroup?: string;
    handler?: ((...args: unknown[]) => unknown) | null;
}

/**
 * Condition under which a `resourceUsage` pin entry becomes a hard requirement.
 * Exactly one of `equals` / `in` is used; `controlId` names another control of the same node.
 */
export interface NodeResourceUsageRequirement {
    controlId?: string;
    equals?: string | number | boolean | null;
    in?: (string | number | boolean)[];
}

export interface NodeResourceUsage {
    kind?: string;
    controlId?: string;
    capability?: string;
    type?: string;
    bus?: string;
    value?: Record<string, unknown>;
    /**
     * Optional condition for a pin entry: the requirement applies only while the named control
     * holds the named value. Absent means the entry is always required unless its own control is
     * `allowNone`.
     */
    requiredWhen?: NodeResourceUsageRequirement;
}

export interface NodeTypeDefinition extends UnknownRecord {
    type?: string;
    title?: string | LocalizedTextMap;
    info?: string | LocalizedTextMap;
    category?: string | null;
    executionPhase?: NodeExecutionPhase;
    color?: string;
    shape?: string;
    icon?: string;
    /**
     * AND-of-OR-groups; the shape mirrors `RequiredCapabilities` in
     * `core/capability-requirements.ts` without importing it, so `data/` stays free of `core/`
     * dependencies.
     */
    requiredCapabilities?: (string | string[])[];
    capabilityCheck?: unknown;
    resourceUsage?: NodeResourceUsage[];
    inputs?: NodeIoDefinition[];
    outputs?: NodeIoDefinition[];
    controls?: NodeControlDefinition[];
    implementations?: Record<string, ImplementationDefinition>;
    initImplementations?: Record<string, ImplementationDefinition>;
    helperImplementations?: Record<string, ImplementationDefinition>;
    initFunction?: string;
    defaultWidth?: number;
    minWidth?: number;
    maxWidth?: number;
}

export interface NodeTypeWidthMetadata {
    defaultWidth: number | null;
    minWidth: number | null;
    maxWidth: number | null;
}

type ControlCtor = new (definition: NodeControlDefinition) => NodeControlBase;
type CapabilityCheckHandler = (...args: unknown[]) => unknown;

const CONTROL_CLASS_BY_TYPE: Record<string, ControlCtor> = {
    dropdown: NodeControlDropdown,
    [MULTI_DROPDOWN_TYPE]: NodeControlDropdown,
    number: NodeControlNumber,
    text: NodeControlText,
};

function cloneLocalized(input: unknown): LocalizedTextMap {
    if (input && typeof input === 'object') {
        return { ...(input as LocalizedTextMap) };
    }
    if (input === undefined || input === null) {
        return {};
    }
    return { en: String(input) };
}

function isAbsolutePath(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    return /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('/');
}

function normalizeLegacyRuntimePath(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }
    if (value.startsWith('/runtime/')) {
        return `/device${value}`;
    }
    if (value.startsWith('runtime/')) {
        return `/device/${value}`;
    }
    return value;
}

function normalizeExecutionPhase(value: unknown): NodeExecutionPhase {
    if (value === 'init' || value === 'loop' || value === 'both') {
        return value;
    }
    return 'loop';
}

function normalizeConnectorPhase(value: unknown): NodeConnectorPhase {
    if (value === 'init' || value === 'loop' || value === 'both') {
        return value;
    }
    return 'both';
}

function normalizeOptionalWidth(
    value: unknown,
    fieldName: 'defaultWidth' | 'minWidth' | 'maxWidth',
    typeId: string
): number | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid ${fieldName} for node type "${typeId}": expected finite number.`);
    }

    if (value < 0) {
        throw new Error(`Invalid ${fieldName} for node type "${typeId}": must be >= 0.`);
    }

    return value;
}

function normalizeWidthMetadata(
    definition: NodeTypeDefinition,
    typeId: string
): NodeTypeWidthMetadata {
    const defaultWidth = normalizeOptionalWidth(definition.defaultWidth, 'defaultWidth', typeId);
    const minWidth = normalizeOptionalWidth(definition.minWidth, 'minWidth', typeId);
    const maxWidth = normalizeOptionalWidth(definition.maxWidth, 'maxWidth', typeId);

    if (minWidth !== null && maxWidth !== null && minWidth > maxWidth) {
        throw new Error(
            `Invalid width bounds for node type "${typeId}": minWidth cannot be greater than maxWidth.`
        );
    }

    if (defaultWidth !== null && minWidth !== null && defaultWidth < minWidth) {
        throw new Error(
            `Invalid defaultWidth for node type "${typeId}": defaultWidth is below minWidth.`
        );
    }

    if (defaultWidth !== null && maxWidth !== null && defaultWidth > maxWidth) {
        throw new Error(
            `Invalid defaultWidth for node type "${typeId}": defaultWidth exceeds maxWidth.`
        );
    }

    return { defaultWidth, minWidth, maxWidth };
}

/**
 * Copy one `resourceUsage` entry so that a caller mutating the source definition cannot alias the
 * instance: the entry, its `value` record and its `requiredWhen` condition (including the `in`
 * array) are copied one level deep.
 */
function cloneResourceUsageEntry(entry: NodeResourceUsage | null | undefined): NodeResourceUsage {
    if (!entry || typeof entry !== 'object') {
        return {};
    }

    const clone: NodeResourceUsage = { ...entry };
    if (clone.value && typeof clone.value === 'object') {
        clone.value = { ...clone.value };
    }

    const condition = clone.requiredWhen;
    if (condition && typeof condition === 'object') {
        const conditionClone: NodeResourceUsageRequirement = { ...condition };
        if (Array.isArray(conditionClone.in)) {
            conditionClone.in = conditionClone.in.slice();
        }
        clone.requiredWhen = conditionClone;
    }

    return clone;
}

/**
 * Lightweight wrapper for implementation descriptors, supporting optional handler functions.
 */
export class ImplementationType {
    type: string;
    value: unknown;
    imports: string[];
    initFunction: string | null;
    helperGroup: string | null;
    handler: CapabilityCheckHandler | null;

    constructor(definition: ImplementationDefinition = {}) {
        this.type = typeof definition.type === 'string' ? definition.type : 'unknown';
        this.value = definition.value ?? null;
        this.imports = Array.isArray(definition.imports)
            ? definition.imports.filter((entry): entry is string => typeof entry === 'string')
            : [];
        this.initFunction =
            typeof definition.initFunction === 'string' && definition.initFunction.trim()
                ? definition.initFunction.trim()
                : null;
        this.helperGroup =
            typeof definition.helperGroup === 'string' && definition.helperGroup.trim()
                ? definition.helperGroup.trim()
                : null;
        this.handler = typeof definition.handler === 'function' ? definition.handler : null;
    }

    toObject(): {
        type: string;
        value: unknown;
        imports?: string[];
        initFunction?: string;
        helperGroup?: string;
    } {
        const result: {
            type: string;
            value: unknown;
            imports?: string[];
            initFunction?: string;
            helperGroup?: string;
        } = {
            type: this.type,
            value: this.value,
        };

        if (this.imports.length > 0) {
            result.imports = this.imports.slice();
        }

        if (this.initFunction) {
            result.initFunction = this.initFunction;
        }

        if (this.helperGroup) {
            result.helperGroup = this.helperGroup;
        }

        return result;
    }
}

/**
 * Node type model holding definition metadata, controls, and registered runtime handlers.
 *
 * Member functions (alphabetical):
 * - fromDefinition: Create a NodeType from a raw definition.
 * - getCapabilityCheckHandler: Access the registered capability check handler.
 * - getControlById: Retrieve a control instance by id.
 * - getImplementation: Get an implementation for a language.
 * - getInitImplementation: Get an init implementation for a language.
 * - resolveAssetPath: Resolve a path relative to the asset base.
 * - setCapabilityCheck: Register a capability check handler.
 * - setImplementation: Register a language implementation.
 * - setInitImplementation: Register a language init implementation.
 * - toDefinition: Serialize to a plain definition without function handlers.
 */
export class NodeType {
    assetBasePath: string;
    type: string;
    title: LocalizedTextMap;
    info: LocalizedTextMap;
    category: string | null;
    executionPhase: NodeExecutionPhase;
    color: string;
    shape: string;
    icon: string;
    /**
     * AND-of-OR-groups mirrored from `RequiredCapabilities`; read-only for consumers that need
     * the raw declaration.
     */
    requiredCapabilities: (string | string[])[];
    capabilityCheck: unknown;
    capabilityCheckHandler: CapabilityCheckHandler | null;
    resourceUsage: NodeResourceUsage[];
    inputs: NodeIoDefinition[];
    outputs: NodeIoDefinition[];
    controls: NodeControlBase[];
    implementations: Record<string, ImplementationType>;
    initImplementations: Record<string, ImplementationType>;
    helperImplementations: Record<string, ImplementationType>;
    initFunction: string | null;
    defaultWidth: number | null;
    minWidth: number | null;
    maxWidth: number | null;

    constructor(definition: NodeTypeDefinition = {}, assetBasePath = '') {
        this.assetBasePath = this.#normalizeBasePath(assetBasePath);

        this.type = typeof definition.type === 'string' ? definition.type : 'unknown';
        this.title = cloneLocalized(definition.title);
        this.info = cloneLocalized(definition.info);
        this.category = typeof definition.category === 'string' ? definition.category : null;
        this.executionPhase = normalizeExecutionPhase(definition.executionPhase);
        this.color = typeof definition.color === 'string' ? definition.color : '#5b7fc7';
        this.shape = typeof definition.shape === 'string' ? definition.shape : 'square';
        this.icon = this.#resolveAssetPath(definition.icon);

        this.requiredCapabilities = Array.isArray(definition.requiredCapabilities)
            ? definition.requiredCapabilities.slice()
            : [];
        this.capabilityCheck = definition.capabilityCheck ?? null;
        this.capabilityCheckHandler = null;
        this.resourceUsage = Array.isArray(definition.resourceUsage)
            ? definition.resourceUsage.map((entry) => cloneResourceUsageEntry(entry))
            : [];

        this.inputs = Array.isArray(definition.inputs)
            ? definition.inputs.map((input) => this.#normalizeInput(input))
            : [];
        this.outputs = Array.isArray(definition.outputs)
            ? definition.outputs.map((output) => this.#cloneIO(output))
            : [];
        this.controls = this.#buildControls(definition.controls);

        this.implementations = this.#buildImplementations(definition.implementations);
        this.initImplementations = this.#buildImplementations(definition.initImplementations);
        this.helperImplementations = this.#buildImplementations(definition.helperImplementations);
        this.initFunction =
            typeof definition.initFunction === 'string' && definition.initFunction.trim()
                ? definition.initFunction.trim()
                : null;

        const widthMetadata = normalizeWidthMetadata(definition, this.type);
        this.defaultWidth = widthMetadata.defaultWidth;
        this.minWidth = widthMetadata.minWidth;
        this.maxWidth = widthMetadata.maxWidth;
    }

    getControlById(controlId: string): NodeControlBase | null {
        return this.controls.find((control) => control.id === controlId) || null;
    }

    getImplementation(language: string): ImplementationType | null {
        return this.implementations[language] ?? null;
    }

    getInitImplementation(language: string): ImplementationType | null {
        return this.initImplementations[language] ?? null;
    }

    setImplementation(
        language: string,
        implementation: ImplementationType | ImplementationDefinition
    ): void {
        if (!language || typeof language !== 'string') {
            return;
        }
        this.implementations[language] = this.#normalizeImplementation(implementation);
    }

    setInitImplementation(
        language: string,
        implementation: ImplementationType | ImplementationDefinition
    ): void {
        if (!language || typeof language !== 'string') {
            return;
        }
        this.initImplementations[language] = this.#normalizeImplementation(implementation);
    }

    setCapabilityCheck(handler: CapabilityCheckHandler): void {
        if (typeof handler === 'function') {
            this.capabilityCheckHandler = handler;
        }
    }

    getCapabilityCheckHandler(): CapabilityCheckHandler | null {
        return this.capabilityCheckHandler;
    }

    resolveAssetPath(assetPath: unknown): string {
        return this.#resolveAssetPath(assetPath);
    }

    toDefinition(): NodeTypeDefinition {
        return {
            type: this.type,
            title: { ...this.title },
            info: { ...this.info },
            category: this.category,
            executionPhase: this.executionPhase,
            color: this.color,
            shape: this.shape,
            icon: this.icon,
            requiredCapabilities: this.requiredCapabilities.slice(),
            capabilityCheck: this.capabilityCheck,
            resourceUsage: this.resourceUsage.map((entry) => cloneResourceUsageEntry(entry)),
            inputs: this.inputs.map((input) => this.#serializeInput(input)),
            outputs: this.outputs.map((output) => this.#serializeOutput(output)),
            controls: this.controls.map((control) => control.getDefinition()),
            implementations: this.#serializeImplementations(this.implementations),
            initImplementations: this.#serializeImplementations(this.initImplementations),
            helperImplementations: this.#serializeImplementations(this.helperImplementations),
            initFunction: this.initFunction || undefined,
            defaultWidth: this.defaultWidth ?? undefined,
            minWidth: this.minWidth ?? undefined,
            maxWidth: this.maxWidth ?? undefined,
        };
    }

    #buildControls(controlDefinitions: NodeControlDefinition[] | undefined): NodeControlBase[] {
        if (!Array.isArray(controlDefinitions)) {
            return [];
        }
        return controlDefinitions.map((definition) => this.#createControl(definition));
    }

    #createControl(definition: NodeControlDefinition = {}): NodeControlBase {
        const preparedDefinition = this.#applyAssetPath(definition);
        const ControlClass = CONTROL_CLASS_BY_TYPE[preparedDefinition.type] ?? NodeControlBase;
        return new ControlClass(preparedDefinition);
    }

    #normalizeInput(input: NodeIoDefinition = {}): NodeIoDefinition {
        const normalized = this.#cloneIO(input);
        if (normalized.defaultControl) {
            normalized.defaultControl =
                normalized.defaultControl instanceof NodeControlBase
                    ? normalized.defaultControl
                    : this.#createControl(normalized.defaultControl);
        }
        return normalized;
    }

    #serializeInput(input: NodeIoDefinition = {}): NodeIoDefinition {
        const serialized = {
            ...input,
            name: cloneLocalized(input.name),
            description: cloneLocalized(input.description),
            phase: normalizeConnectorPhase(input.phase),
        };
        if (input.defaultControl instanceof NodeControlBase) {
            serialized.defaultControl = input.defaultControl.getDefinition();
        }
        return serialized;
    }

    #serializeOutput(output: NodeIoDefinition = {}): NodeIoDefinition {
        return {
            ...output,
            name: cloneLocalized(output.name),
            description: cloneLocalized(output.description),
            phase: normalizeConnectorPhase(output.phase),
        };
    }

    #buildImplementations(
        definitions: Record<string, ImplementationDefinition> | undefined
    ): Record<string, ImplementationType> {
        if (!definitions || typeof definitions !== 'object') {
            return {};
        }
        return Object.entries(definitions).reduce<Record<string, ImplementationType>>(
            (result, [language, definition]) => {
                result[language] = new ImplementationType(definition);
                return result;
            },
            {}
        );
    }

    #serializeImplementations(
        definitions: Record<string, ImplementationType> = {}
    ): Record<string, ImplementationDefinition> {
        return Object.entries(definitions).reduce(
            (result, [language, impl]) => {
                result[language] = impl.toObject();
                return result;
            },
            {} as Record<string, ImplementationDefinition>
        );
    }

    #cloneIO(io: NodeIoDefinition = {}): NodeIoDefinition {
        const cloned = {
            ...io,
            name: cloneLocalized(io.name),
            description: cloneLocalized(io.description),
            phase: normalizeConnectorPhase(io.phase),
        };
        if (cloned.icon) {
            cloned.icon = this.#resolveAssetPath(cloned.icon);
        }
        return cloned;
    }

    #applyAssetPath(definition: NodeControlDefinition = {}): NodeControlDefinition {
        if (!definition || typeof definition !== 'object') {
            return definition;
        }
        const cloned = { ...definition };
        if (cloned.icon) {
            cloned.icon = this.#resolveAssetPath(cloned.icon);
        }
        return cloned;
    }

    #normalizeBasePath(assetBasePath: string): string {
        if (typeof assetBasePath !== 'string') {
            return '';
        }
        const trimmed = assetBasePath.trim();
        if (!trimmed) {
            return '';
        }
        return trimmed.replace(/\/+$/, '');
    }

    #resolveAssetPath(assetPath: unknown): string {
        if (typeof assetPath !== 'string') {
            return '';
        }
        const trimmed = assetPath.trim();
        if (!trimmed) {
            return '';
        }
        if (isAbsolutePath(trimmed) || !this.assetBasePath) {
            return normalizeLegacyRuntimePath(trimmed);
        }
        const cleaned = trimmed.replace(/^\/+/, '');
        return normalizeLegacyRuntimePath(`${this.assetBasePath}/${cleaned}`);
    }

    #normalizeImplementation(
        implementation: ImplementationType | ImplementationDefinition = {}
    ): ImplementationType {
        if (implementation instanceof ImplementationType) {
            return implementation;
        }
        if (!implementation || typeof implementation !== 'object') {
            return new ImplementationType({});
        }
        return new ImplementationType(implementation);
    }

    static fromDefinition(definition: NodeTypeDefinition = {}, assetBasePath = ''): NodeType {
        return new NodeType(definition, assetBasePath);
    }
}

export default NodeType;
