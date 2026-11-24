// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';
import {
    normalizeCapabilityIssues,
    type NodeCapabilityIssue,
} from '../core/node-capability-validator.js';
import {
    cloneLocalizedName,
    cloneUserNameMap,
    normalizeUserName,
    normalizeUserNameMap,
    resolveUserNameForLocale,
    resolveNodeDisplayName,
} from './node-name-resolver.js';
import NodeControlBase from './node-control-base.js';
import NodeControlDropdown from './node-control-dropdown.js';
import { MULTI_DROPDOWN_TYPE } from './node-control-dropdown.js';
import NodeControlNumber from './node-control-number.js';
import NodeControlText from './node-control-text.js';
import type { NodeControlBaseDefinition } from './node-control-base.js';
import { resolveNodeWidth } from './node-width.js';

type NodeId = string;
type LocalizedNameMap = Record<string, string>;
type UserNameMap = Record<string, string> | null;
type ValueMap = Record<string, unknown>;

interface NodeInput extends Record<string, unknown> {
    id?: string;
    icon?: unknown;
    allowedTypes?: string[];
    defaultControl?: unknown;
}

interface NodeOutput extends Record<string, unknown> {
    id?: string;
    icon?: unknown;
    outputType?: string;
    typeInputSources?: string[];
}

interface NodeDataPayload extends Record<string, unknown> {
    id?: unknown;
    type?: unknown;
    typeName?: unknown;
    userName?: unknown;
    title?: unknown;
    icon?: unknown;
    color?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    inputs?: unknown;
    outputs?: unknown;
    controls?: unknown;
    controlValues?: unknown;
    inputDefaults?: unknown;
    collapsed?: unknown;
    capabilityIssues?: unknown;
}

interface NodeDataState {
    id: NodeId;
    type: string;
    typeName: LocalizedNameMap;
    userName: UserNameMap;
    title: string;
    icon: string | null;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
    inputs: Array<NodeInput | unknown>;
    outputs: NodeOutput[];
    controls: unknown[];
    controlValues: ValueMap;
    inputDefaults: ValueMap;
    collapsed: boolean;
}

type ControlConstructor = new (definition?: NodeControlBaseDefinition) => NodeControlBase;

const CONTROL_CLASS_BY_TYPE: Record<string, ControlConstructor> = {
    dropdown: NodeControlDropdown,
    [MULTI_DROPDOWN_TYPE]: NodeControlDropdown,
    number: NodeControlNumber,
    text: NodeControlText,
};

/**
 * Payload for NodeData position updates.
 */
export class NodeDataPositionChangedPayload extends AppPayload {
    readonly nodeId: NodeId;
    readonly previousX: number;
    readonly previousY: number;
    readonly x: number;
    readonly y: number;

    constructor(nodeId: NodeId, previousX: number, previousY: number, x: number, y: number) {
        super('NodeData.PositionChanged.v1');
        this.nodeId = nodeId;
        this.previousX = previousX;
        this.previousY = previousY;
        this.x = x;
        this.y = y;
    }
}

/**
 * Payload for NodeData title updates.
 */
export class NodeDataTitleChangedPayload extends AppPayload {
    readonly nodeId: NodeId;
    readonly previousTitle: string | object;
    readonly title: string | object;

    constructor(nodeId: NodeId, previousTitle: string | object, title: string | object) {
        super('NodeData.TitleChanged.v1');
        this.nodeId = nodeId;
        this.previousTitle = previousTitle;
        this.title = title;
    }
}

/**
 * Payload for NodeData control value updates.
 */
export class NodeDataControlValueChangedPayload extends AppPayload {
    readonly nodeId: NodeId;
    readonly controlId: string;
    readonly previousValue: unknown;
    readonly value: unknown;

    constructor(nodeId: NodeId, controlId: string, previousValue: unknown, value: unknown) {
        super('NodeData.ControlValueChanged.v1');
        this.nodeId = nodeId;
        this.controlId = controlId;
        this.previousValue = previousValue;
        this.value = value;
    }
}

/**
 * Payload for NodeData input default updates.
 */
export class NodeDataInputDefaultChangedPayload extends AppPayload {
    readonly nodeId: NodeId;
    readonly inputKey: string;
    readonly previousValue: unknown;
    readonly value: unknown;

    constructor(nodeId: NodeId, inputKey: string, previousValue: unknown, value: unknown) {
        super('NodeData.InputDefaultChanged.v1');
        this.nodeId = nodeId;
        this.inputKey = inputKey;
        this.previousValue = previousValue;
        this.value = value;
    }
}

/**
 * Payload for NodeData capability issue updates.
 */
export class NodeDataCapabilityIssuesChangedPayload extends AppPayload {
    readonly nodeId: NodeId;
    readonly previousIssues: NodeCapabilityIssue[];
    readonly issues: NodeCapabilityIssue[];

    constructor(
        nodeId: NodeId,
        previousIssues: NodeCapabilityIssue[],
        issues: NodeCapabilityIssue[]
    ) {
        super('NodeData.CapabilityIssuesChanged.v1');
        this.nodeId = nodeId;
        this.previousIssues = previousIssues;
        this.issues = issues;
    }
}

function normalizeLegacyRuntimePath(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    if (value.startsWith('/runtime/')) {
        return `/device${value}`;
    }
    if (value.startsWith('runtime/')) {
        return `/device/${value}`;
    }
    return value;
}

function normalizeNodeId(value: unknown, fallback = '0'): NodeId {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return fallback;
}

function localizedNameEquals(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    return aKeys.every((key) =>
        Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
}

function userNameMapEquals(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (!a && !b) {
        return true;
    }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }

    return aKeys.every((key) =>
        Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
}

function capabilityIssuesEqual(a: NodeCapabilityIssue[], b: NodeCapabilityIssue[]): boolean {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        const left = a[index];
        const right = b[index];
        if (
            left.nodeId !== right.nodeId ||
            left.scope !== right.scope ||
            left.message !== right.message ||
            left.capability !== right.capability ||
            left.controlId !== right.controlId ||
            left.inputId !== right.inputId ||
            left.source !== right.source
        ) {
            return false;
        }
    }
    return true;
}

/**
 * Mutable data container for a single node instance in a graph.
 * Keeps position, metadata, connector descriptors, and control/input values.
 *
 * Emitted events (`AppEvent` envelope):
 * - `position-changed` with `NodeData.PositionChanged.v1`
 * - `title-changed` with `NodeData.TitleChanged.v1`
 * - `control-value-changed` with `NodeData.ControlValueChanged.v1`
 * - `input-default-changed` with `NodeData.InputDefaultChanged.v1`
 * - `capability-issues-changed` with `NodeData.CapabilityIssuesChanged.v1`
 */
export class NodeData extends AppEventEmitter {
    id: NodeId;
    type: string;
    typeName: LocalizedNameMap;
    userName: UserNameMap;
    title: string;
    icon: string | null;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
    inputs: Array<NodeInput | unknown>;
    outputs: NodeOutput[];
    controls: unknown[];
    controlValues: ValueMap;
    inputDefaults: ValueMap;
    collapsed: boolean;
    capabilityIssues: NodeCapabilityIssue[];

    constructor(payload: NodeDataPayload = {}) {
        super();
        this.id = normalizeNodeId(payload.id, '0');
        this.type = typeof payload.type === 'string' ? payload.type : 'default';
        const typeNameSource = payload.typeName ?? payload.title ?? this.type;
        this.typeName = cloneLocalizedName(typeNameSource, this.type);
        this.userName = normalizeUserNameMap(payload.userName, 'en');
        this.title = resolveNodeDisplayName({
            userName: this.userName,
            typeName: this.typeName,
            type: this.type,
        });
        this.icon = (normalizeLegacyRuntimePath(payload.icon) as string | null) || null;
        this.color = typeof payload.color === 'string' ? payload.color : '#5b7fc7';

        this.x = Number.isFinite(payload.x) ? (payload.x as number) : 0;
        this.y = Number.isFinite(payload.y) ? (payload.y as number) : 0;
        this.width = resolveNodeWidth({
            instanceWidth: payload.width,
        });
        this.height = Number.isFinite(payload.height) ? (payload.height as number) : 90;

        this.inputs = Array.isArray(payload.inputs)
            ? payload.inputs.map((inp) => this.#enrichInput(inp))
            : [];
        this.outputs = Array.isArray(payload.outputs)
            ? payload.outputs.map((out) => ({
                  ...(out as NodeOutput),
                  icon: normalizeLegacyRuntimePath((out as NodeOutput)?.icon),
              }))
            : [];
        this.controls = Array.isArray(payload.controls) ? payload.controls.slice() : [];
        this.controlValues =
            payload.controlValues && typeof payload.controlValues === 'object'
                ? { ...(payload.controlValues as ValueMap) }
                : {};
        this.inputDefaults =
            payload.inputDefaults && typeof payload.inputDefaults === 'object'
                ? { ...(payload.inputDefaults as ValueMap) }
                : {};
        this.collapsed = Boolean(payload.collapsed);
        this.capabilityIssues = normalizeCapabilityIssues(payload.capabilityIssues, this.id);
    }

    #enrichInput(input: unknown): NodeInput | unknown {
        if (!input || typeof input !== 'object') {
            return input;
        }

        const enriched: NodeInput = {
            ...((input as NodeInput) ?? {}),
            icon: normalizeLegacyRuntimePath((input as NodeInput).icon),
        };

        if (enriched.defaultControl && !(enriched.defaultControl instanceof NodeControlBase)) {
            const controlDef =
                enriched.defaultControl && typeof enriched.defaultControl === 'object'
                    ? (enriched.defaultControl as NodeControlBaseDefinition)
                    : {};
            const controlType = typeof controlDef.type === 'string' ? controlDef.type : '';
            const ControlClass = CONTROL_CLASS_BY_TYPE[controlType] ?? NodeControlBase;
            enriched.defaultControl = new ControlClass(controlDef);
        }

        return enriched;
    }

    setId(id: NodeId): void {
        this.id = normalizeNodeId(id, this.id || '0');
    }

    getId(): NodeId {
        return this.id;
    }

    getType(): string {
        return this.type;
    }

    getTypeName(): LocalizedNameMap {
        return { ...this.typeName };
    }

    getUserName(locale = 'en'): string | null {
        return resolveUserNameForLocale(this.userName, locale);
    }

    getUserNames(): UserNameMap {
        return cloneUserNameMap(this.userName);
    }

    getUserNameForLocale(locale: string): string | null {
        return resolveUserNameForLocale(this.userName, locale);
    }

    getDisplayName(locale = 'en'): string {
        return resolveNodeDisplayName({
            userName: this.userName,
            typeName: this.typeName,
            type: this.type,
            locale,
        });
    }

    setTypeName(typeName: unknown): void {
        const normalizedTypeName = cloneLocalizedName(typeName, this.type);
        if (localizedNameEquals(this.typeName, normalizedTypeName)) {
            return;
        }

        const previousTitle = this.title;
        this.typeName = normalizedTypeName;
        this.title = this.getDisplayName();
        this.#emitTitleChangedIfNeeded(previousTitle);
    }

    setUserName(userName: unknown, locale = 'en'): void {
        if (userName && typeof userName === 'object' && !Array.isArray(userName)) {
            this.setUserNames(userName as Record<string, unknown>);
            return;
        }

        this.setUserNameForLocale(locale, userName as string | null);
    }

    setUserNames(userNameMap: Record<string, unknown> | null): void {
        const normalizedUserNameMap = normalizeUserNameMap(userNameMap, 'en');
        if (userNameMapEquals(this.userName, normalizedUserNameMap)) {
            return;
        }

        const previousTitle = this.title;
        this.userName = normalizedUserNameMap;
        this.title = this.getDisplayName();
        this.#emitTitleChangedIfNeeded(previousTitle);
    }

    setUserNameForLocale(locale: string, userNameValue: string | null): void {
        const normalizedLocale = typeof locale === 'string' && locale.trim() ? locale.trim() : 'en';
        const normalizedValue = normalizeUserName(userNameValue);
        const nextMap: Record<string, string> = this.userName ? { ...this.userName } : {};

        if (normalizedValue) {
            nextMap[normalizedLocale] = normalizedValue;
        } else {
            delete nextMap[normalizedLocale];
        }

        const normalizedNextMap = Object.keys(nextMap).length > 0 ? nextMap : null;
        if (userNameMapEquals(this.userName, normalizedNextMap)) {
            return;
        }

        const previousTitle = this.title;
        this.userName = normalizedNextMap;
        this.title = this.getDisplayName();
        this.#emitTitleChangedIfNeeded(previousTitle);
    }

    clearUserName(locale = 'en'): void {
        this.setUserNameForLocale(locale, null);
    }

    clearAllUserNames(): void {
        this.setUserNames(null);
    }

    setPosition(x: number, y: number): void {
        const previousX = this.x;
        const previousY = this.y;
        const nextX = Number.isFinite(x) ? x : this.x;
        const nextY = Number.isFinite(y) ? y : this.y;

        if (Object.is(previousX, nextX) && Object.is(previousY, nextY)) {
            return;
        }

        this.x = nextX;
        this.y = nextY;
        this.#emit(
            'position-changed',
            new NodeDataPositionChangedPayload(this.id, previousX, previousY, this.x, this.y)
        );
    }

    setTitle(title: unknown): void {
        if (title === undefined || title === null || title === '') {
            return;
        }

        if (typeof title === 'object') {
            this.setTypeName(title);
            return;
        }

        this.setUserNameForLocale('en', title as string);
    }

    setControlValue(controlId: string, value: unknown): void {
        if (!controlId) {
            return;
        }
        const previousValue = this.controlValues[controlId];
        if (Object.is(previousValue, value)) {
            return;
        }

        this.controlValues[controlId] = value;
        this.#emit(
            'control-value-changed',
            new NodeDataControlValueChangedPayload(this.id, controlId, previousValue, value)
        );
    }

    setInputDefault(inputKey: string, value: unknown): void {
        if (!inputKey) {
            return;
        }
        const previousValue = this.inputDefaults[inputKey];
        if (Object.is(previousValue, value)) {
            return;
        }

        this.inputDefaults[inputKey] = value;
        this.#emit(
            'input-default-changed',
            new NodeDataInputDefaultChangedPayload(this.id, inputKey, previousValue, value)
        );
    }

    setCapabilityIssues(issues: unknown): void {
        const normalizedIssues = normalizeCapabilityIssues(issues, this.id);
        if (capabilityIssuesEqual(this.capabilityIssues, normalizedIssues)) {
            return;
        }

        const previousIssues = this.getCapabilityIssues();
        this.capabilityIssues = normalizedIssues;
        this.#emit(
            'capability-issues-changed',
            new NodeDataCapabilityIssuesChangedPayload(
                this.id,
                previousIssues,
                this.getCapabilityIssues()
            )
        );
    }

    clearCapabilityIssues(): void {
        this.setCapabilityIssues([]);
    }

    getCapabilityIssues(): NodeCapabilityIssue[] {
        return this.capabilityIssues.map((issue) => ({ ...issue }));
    }

    hasCapabilityIssues(): boolean {
        return this.capabilityIssues.length > 0;
    }

    getInputAllowedTypes(inputId: string): string[] {
        const input = this.inputs.find(
            (inp): inp is NodeInput =>
                Boolean(inp) && typeof inp === 'object' && (inp as NodeInput).id === inputId
        );
        if (!input) {
            throw new Error(`Input '${inputId}' not found in node '${this.id}'`);
        }
        if (!input.allowedTypes || input.allowedTypes.length === 0) {
            throw new Error(
                `Input '${inputId}' in node '${this.id}' missing required allowedTypes`
            );
        }
        return input.allowedTypes;
    }

    getOutputType(outputId: string): string {
        const output = this.outputs.find((out) => out.id === outputId);
        if (!output) {
            throw new Error(`Output '${outputId}' not found in node '${this.id}'`);
        }

        const dynamicTypeControlId = (output as Record<string, unknown>).outputTypeControl;
        const dynamicTypeMap = (output as Record<string, unknown>).outputTypeByControlValue;
        if (
            typeof dynamicTypeControlId === 'string' &&
            dynamicTypeControlId.trim() &&
            dynamicTypeMap &&
            typeof dynamicTypeMap === 'object'
        ) {
            const selectedValue = this.controlValues?.[dynamicTypeControlId];
            const resolvedType = (dynamicTypeMap as Record<string, unknown>)[
                String(selectedValue ?? '')
            ];
            if (typeof resolvedType === 'string' && resolvedType.trim()) {
                return resolvedType;
            }
        }

        if (!output.outputType) {
            throw new Error(
                `Output '${outputId}' in node '${this.id}' missing required outputType`
            );
        }
        return output.outputType;
    }

    toData(): NodeDataState {
        return {
            id: this.id,
            type: this.type,
            typeName: { ...this.typeName },
            userName: cloneUserNameMap(this.userName),
            title: this.title,
            icon: this.icon,
            color: this.color,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            inputs: this.inputs.map((inp) => this.#serializeInput(inp)),
            outputs: this.outputs.slice(),
            controls: this.controls.slice(),
            controlValues: { ...this.controlValues },
            inputDefaults: { ...this.inputDefaults },
            collapsed: this.collapsed,
        };
    }

    #serializeInput(input: unknown): NodeInput | unknown {
        if (!input || typeof input !== 'object') {
            return input;
        }

        const serialized: NodeInput = { ...((input as NodeInput) ?? {}) };

        if (serialized.defaultControl instanceof NodeControlBase) {
            serialized.defaultControl = serialized.defaultControl.getDefinition();
        }

        return serialized;
    }

    static fromData(data: NodeDataPayload = {}): NodeData {
        return new NodeData(data);
    }

    #emitTitleChangedIfNeeded(previousTitle: string | object): void {
        if (Object.is(previousTitle, this.title)) {
            return;
        }

        this.#emit(
            'title-changed',
            new NodeDataTitleChangedPayload(this.id, previousTitle, this.title)
        );
    }

    #emit(name: string, payload: AppPayload): void {
        this.emit(name, payload);
    }
}

export default NodeData;
