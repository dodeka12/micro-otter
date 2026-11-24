// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { AppPayload } from '../core/app-event.js';
import { AppEventEmitter } from '../core/app-event-emitter.js';

export interface LocalizedLabelMap {
    [locale: string]: string;
}

export type NodeControlLayout = 'inline' | 'stacked';

export interface NodeControlBaseDefinition extends Record<string, unknown> {
    id?: string;
    type?: string;
    label?: string | LocalizedLabelMap;
    description?: string | LocalizedLabelMap;
    layout?: NodeControlLayout;
    default?: unknown;
}

export interface NodeControlBaseState {
    id: string;
    type: string;
    value: unknown;
    disabled: boolean;
}

/**
 * Payload for NodeControlBase value updates.
 */
export class NodeControlBaseValueChangedPayload extends AppPayload {
    readonly controlId: string;
    readonly controlType: string;
    readonly previousValue: unknown;
    readonly value: unknown;

    constructor(controlId: string, controlType: string, previousValue: unknown, value: unknown) {
        super('NodeControlBase.ValueChanged.v1');
        this.controlId = controlId;
        this.controlType = controlType;
        this.previousValue = previousValue;
        this.value = value;
    }
}

/**
 * Payload for NodeControlBase disabled-state updates.
 */
export class NodeControlBaseDisabledChangedPayload extends AppPayload {
    readonly controlId: string;
    readonly previousDisabled: boolean;
    readonly disabled: boolean;

    constructor(controlId: string, previousDisabled: boolean, disabled: boolean) {
        super('NodeControlBase.DisabledChanged.v1');
        this.controlId = controlId;
        this.previousDisabled = previousDisabled;
        this.disabled = disabled;
    }
}

/**
 * Base container for control data in the v2 UI/data split.
 * Stores the control definition and the mutable value payload.
 *
 * Emitted events (`AppEvent` envelope):
 * - `value-changed` with `NodeControlBase.ValueChanged.v1`
 */
export class NodeControlBase extends AppEventEmitter {
    readonly id: string;
    readonly type: string;
    readonly label: LocalizedLabelMap;
    readonly description: LocalizedLabelMap;
    readonly layout: NodeControlLayout;
    readonly definition: NodeControlBaseDefinition;
    readonly defaultValue: unknown;
    value: unknown;
    disabled: boolean;

    constructor(definition: NodeControlBaseDefinition = {}) {
        super();
        const normalizedLayout = this.#normalizeLayout(definition.layout);
        this.id = definition.id ?? '';
        this.type = definition.type ?? 'unknown';
        this.label = this.#normalizeLabel(definition.label);
        this.description = this.#normalizeLabel(definition.description);
        this.layout = normalizedLayout;
        this.definition = { ...definition, layout: normalizedLayout };
        this.defaultValue = definition.default;
        this.value = definition.default;
        this.disabled = false;
    }

    setValue(value: unknown): unknown {
        const previousValue = this.value;
        if (Object.is(previousValue, value)) {
            return this.value;
        }

        this.value = value;
        this.#emit(
            'value-changed',
            new NodeControlBaseValueChangedPayload(this.id, this.type, previousValue, this.value)
        );
        return this.value;
    }

    getValue(): unknown {
        return this.value;
    }

    setDisabled(value: unknown): boolean {
        const nextDisabled = Boolean(value);
        if (this.disabled === nextDisabled) {
            return this.disabled;
        }

        const previousDisabled = this.disabled;
        this.disabled = nextDisabled;
        this.#emit(
            'disabled-changed',
            new NodeControlBaseDisabledChangedPayload(this.id, previousDisabled, this.disabled)
        );
        return this.disabled;
    }

    isDisabled(): boolean {
        return this.disabled;
    }

    resetValue(): unknown {
        return this.setValue(this.defaultValue);
    }

    getDefinition(): NodeControlBaseDefinition {
        return { ...this.definition };
    }

    toState(): NodeControlBaseState {
        return { id: this.id, type: this.type, value: this.value, disabled: this.disabled };
    }

    #emit(name: string, payload: AppPayload): void {
        this.emit(name, payload);
    }

    #normalizeLabel(
        label: NodeControlBaseDefinition['label'] | null | undefined
    ): LocalizedLabelMap {
        if (label && typeof label === 'object') {
            return { ...label };
        }
        if (label === undefined || label === null) {
            return {};
        }
        return { en: String(label) };
    }

    #normalizeLayout(layout: unknown): NodeControlLayout {
        if (layout === 'inline' || layout === 'stacked') {
            return layout;
        }
        return 'inline';
    }
}

export default NodeControlBase;
