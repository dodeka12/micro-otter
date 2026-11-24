// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import NodeControlBase from './node-control-base.js';
import type { NodeControlBaseDefinition } from './node-control-base.js';

export interface NodeControlTextDefinition extends NodeControlBaseDefinition {
    default?: unknown;
}

/**
 * Text control data model.
 * Stores string content without UI concerns.
 */
export class NodeControlText extends NodeControlBase {
    declare defaultValue: string;
    declare value: string;

    constructor(definition: NodeControlTextDefinition = {}) {
        super({ ...definition, type: 'text' });
        this.defaultValue = this.#coerce(definition.default ?? '');
        this.value = this.defaultValue;
    }

    setValue(value: unknown): string {
        this.value = this.#coerce(value);
        return this.value;
    }

    #coerce(value: unknown): string {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }
}

export default NodeControlText;
