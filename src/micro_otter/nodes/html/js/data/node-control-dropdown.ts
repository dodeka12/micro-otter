// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import NodeControlBase from './node-control-base.js';
import type {
    LocalizedLabelMap,
    NodeControlBaseDefinition,
    NodeControlBaseState,
} from './node-control-base.js';

export interface DropdownOptionDefinition extends Record<string, unknown> {
    value?: unknown;
    label?: string | LocalizedLabelMap;
    /** Text the picker row shows instead of `label` (dynamic "create new…" sentinel). */
    displayLabel?: string | LocalizedLabelMap;
    activeInputs?: unknown[];
    activeOutputs?: unknown[];
    activeControls?: unknown[];
    inputTypes?: Record<string, unknown>;
    outputTypes?: Record<string, unknown>;
}

/** Control type of a dropdown that holds a list of option values. */
export const MULTI_DROPDOWN_TYPE = 'multi-dropdown';

export interface DropdownOptionState {
    value: unknown;
    label: LocalizedLabelMap;
    /** Text the picker row shows instead of `label`, when the option overrides it. */
    displayLabel?: LocalizedLabelMap;
    activeInputs: unknown[];
    activeOutputs: unknown[];
    activeControls: unknown[];
    inputTypes: Record<string, unknown>;
    outputTypes: Record<string, unknown>;
}

export interface NodeControlDynamicOptions extends Record<string, unknown> {
    source?: string;
    dependsOn?: string[];
    includeUndefined?: boolean;
    allowNone?: boolean;
    capabilityKey?: string;
    resourceGroup?: string;
    resourceKey?: string;
}

export interface NodeControlDropdownDefinition extends NodeControlBaseDefinition {
    affectsInputs?: unknown;
    affectsOutputs?: unknown;
    affectsControls?: unknown;
    options?: DropdownOptionDefinition[];
    dynamicOptions?: NodeControlDynamicOptions;
    maxVisibleItems?: number;
}

export interface NodeControlDropdownState extends NodeControlBaseState {
    affectsInputs: boolean;
    affectsOutputs: boolean;
    affectsControls: boolean;
    options: DropdownOptionState[];
    dynamicOptions?: NodeControlDynamicOptions;
}

class DropdownOption {
    value: unknown;
    label: LocalizedLabelMap;
    displayLabel?: LocalizedLabelMap;
    activeInputs: unknown[];
    activeOutputs: unknown[];
    activeControls: unknown[];
    inputTypes: Record<string, unknown>;
    outputTypes: Record<string, unknown>;

    constructor(option: DropdownOptionDefinition = {}) {
        this.value = option.value ?? null;
        this.label = normalizeLabel(option.label);
        // Only a declared override is carried: an absent one must stay absent so the picker
        // falls back to the regular label.
        this.displayLabel =
            option.displayLabel === undefined ? undefined : normalizeLabel(option.displayLabel);
        this.activeInputs = Array.isArray(option.activeInputs) ? option.activeInputs.slice() : [];
        this.activeOutputs = Array.isArray(option.activeOutputs) ? option.activeOutputs.slice() : [];
        this.activeControls = Array.isArray(option.activeControls)
            ? option.activeControls.slice()
            : [];
        this.inputTypes = cloneTypeMap(option.inputTypes);
        this.outputTypes = cloneTypeMap(option.outputTypes);
    }

    toObject(): DropdownOptionState {
        const state: DropdownOptionState = {
            value: this.value,
            label: { ...this.label },
            activeInputs: this.activeInputs.slice(),
            activeOutputs: this.activeOutputs.slice(),
            activeControls: this.activeControls.slice(),
            inputTypes: cloneTypeMap(this.inputTypes),
            outputTypes: cloneTypeMap(this.outputTypes),
        };
        if (this.displayLabel) {
            state.displayLabel = { ...this.displayLabel };
        }
        return state;
    }
}

/**
 * Dropdown control data model.
 * Validates selections against the option list and exposes lookup helpers.
 */
export class NodeControlDropdown extends NodeControlBase {
    affectsInputs: boolean;
    affectsOutputs: boolean;
    affectsControls: boolean;
    options: DropdownOption[];
    optionValues: Set<unknown>;
    dynamicOptions?: NodeControlDynamicOptions;

    constructor(definition: NodeControlDropdownDefinition = {}) {
        const options = Array.isArray(definition.options)
            ? definition.options.map((opt) => new DropdownOption(opt))
            : [];
        const optionValues = new Set(options.map((opt) => opt.value));
        const defaultValue = definition.dynamicOptions
            ? definition.default
            : normalizeValue(definition.default, optionValues, options, definition.default);

        // `multi-dropdown` shares the model: it is a dropdown whose value is a list, so the
        // definition's own type has to survive (`_getControlClassForType` keys off it).
        super({
            ...definition,
            type: definition.type === MULTI_DROPDOWN_TYPE ? MULTI_DROPDOWN_TYPE : 'dropdown',
            default: defaultValue,
        });

        this.affectsInputs = Boolean(definition.affectsInputs);
        this.affectsOutputs = Boolean(definition.affectsOutputs);
        this.affectsControls = Boolean(definition.affectsControls);
        this.dynamicOptions = definition.dynamicOptions
            ? { ...definition.dynamicOptions }
            : undefined;

        this.options = options;
        this.optionValues = optionValues;
        this.value = this.defaultValue;
    }

    setValue(value: unknown): unknown {
        this.value = this.#normalize(value);
        return this.value;
    }

    getOptions(): DropdownOptionState[] {
        return this.options.map((opt) => opt.toObject());
    }

    getSelectedOption(): DropdownOption | null {
        return this.options.find((opt) => opt.value === this.value) || null;
    }

    setOptions(options: DropdownOptionDefinition[]): void {
        const nextOptions = Array.isArray(options)
            ? options.map((opt) => new DropdownOption(opt))
            : [];
        const nextOptionValues = new Set(nextOptions.map((opt) => opt.value));

        this.options = nextOptions;
        this.optionValues = nextOptionValues;
        this.value = this.#normalize(this.value);
    }

    setDisabled(value: unknown): boolean {
        return super.setDisabled(value);
    }

    toState(): NodeControlDropdownState {
        return {
            ...super.toState(),
            affectsInputs: this.affectsInputs,
            affectsOutputs: this.affectsOutputs,
            affectsControls: this.affectsControls,
            options: this.getOptions(),
            dynamicOptions: this.dynamicOptions ? { ...this.dynamicOptions } : undefined,
        };
    }

    #normalize(value: unknown): unknown {
        return normalizeValue(value, this.optionValues, this.options, this.defaultValue);
    }
}

function normalizeValue(
    value: unknown,
    optionValues: Set<unknown>,
    options: DropdownOption[],
    defaultValue: unknown
): unknown {
    if (Array.isArray(value)) {
        // A multi-select holds a list of option values, so there is no single match to test.
        return value.slice();
    }
    if (optionValues.has(value)) {
        return value;
    }
    if (optionValues.has(defaultValue)) {
        return defaultValue;
    }
    if (options.length > 0) {
        return options[0].value;
    }
    return null;
}

function normalizeLabel(label: string | LocalizedLabelMap | null | undefined): LocalizedLabelMap {
    if (label && typeof label === 'object') {
        return { ...label };
    }
    if (label === undefined || label === null) {
        return {};
    }
    return { en: String(label) };
}

function cloneTypeMap(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const cloned: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([connectorId, connectorTypes]) => {
        if (Array.isArray(connectorTypes)) {
            cloned[connectorId] = [...connectorTypes];
            return;
        }
        cloned[connectorId] = connectorTypes;
    });
    return cloned;
}

export default NodeControlDropdown;