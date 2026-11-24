// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import NodeControlBase, { type NodeControlBaseDefinition } from './node-control-base.js';

export interface NodeControlNumberDefinition extends NodeControlBaseDefinition {
    min?: number;
    max?: number;
    step?: number;
}

/**
 * Numeric control data model.
 * Normalizes incoming values, applies min/max clamping, and snaps to step.
 */
export class NodeControlNumber extends NodeControlBase {
    readonly min: number | undefined;
    readonly max: number | undefined;
    readonly step: number | undefined;
    declare readonly defaultValue: number;
    declare value: number;

    constructor(definition: NodeControlNumberDefinition = {}) {
        const min = Number.isFinite(definition.min) ? definition.min : undefined;
        const max = Number.isFinite(definition.max) ? definition.max : undefined;
        const step =
            Number.isFinite(definition.step) && definition.step > 0 ? definition.step : undefined;
        const defaultValue = NodeControlNumber.coerceValue(definition.default, min, max, step);

        super({ ...definition, type: 'number', default: defaultValue });

        this.min = min;
        this.max = max;
        this.step = step;
    }

    setValue(value: unknown): number {
        this.value = this.#coerce(value);
        return this.value;
    }

    #coerce(value: unknown): number {
        return NodeControlNumber.coerceValue(value, this.min, this.max, this.step, this.defaultValue);
    }

    static coerceValue(
        value: unknown,
        min: number | undefined,
        max: number | undefined,
        step: number | undefined,
        defaultValue?: number
    ): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return defaultValue ?? min ?? 0;
        }

        let clamped = numeric;
        if (min !== undefined) {
            clamped = Math.max(clamped, min);
        }
        if (max !== undefined) {
            clamped = Math.min(clamped, max);
        }

        if (step !== undefined) {
            const base = min ?? 0;
            clamped = base + Math.round((clamped - base) / step) * step;
            if (min !== undefined) {
                clamped = Math.max(clamped, min);
            }
            if (max !== undefined) {
                clamped = Math.min(clamped, max);
            }
        }

        return clamped;
    }
}

export default NodeControlNumber;