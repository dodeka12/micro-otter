// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * NumberControlUi: Number input control with min/max/step constraints.
 *
 * Features:
 * - Real-time validation with visual feedback
 * - Clamping to the `min`/`max` range on every keystroke and on blur
 * - Keyboard input support
 * - Constraint enforcement (min, max, step) taken from the node definition
 */

import NodeControlUi from './node-control-ui.js';
import {
    CONTROL_CANVAS_VALUE_BACKGROUND_COLOR,
    CONTROL_CANVAS_VALUE_BORDER_COLOR,
    CONTROL_CANVAS_VALUE_TEXT_COLOR,
} from './control-ui-colors.js';

export interface NumberControlConstraints {
    min?: number;
    max?: number;
    step?: number;
    [key: string]: unknown;
}

export interface NumberControlPayload {
    id: string;
    type: string;
    label?: string | Record<string, string>;
    default?: unknown;
    value?: unknown;
    constraints?: NumberControlConstraints | Record<string, unknown>;
    /** Node-definition `min` (the schema puts `min`/`max`/`step` at the top level). */
    min?: unknown;
    /** Node-definition `max`. */
    max?: unknown;
    /** Node-definition `step`. */
    step?: unknown;
}

/**
 * Read one numeric constraint from a control definition.
 *
 * Node definitions carry `min`/`max`/`step` as top-level control properties (see the node
 * definition reference), while older callers pass a nested `constraints` object. The nested
 * form wins when both are present so existing payloads keep their behaviour.
 *
 * @param definition - Control definition payload.
 * @param constraints - Nested constraint object from the same definition.
 * @param key - Constraint name to read.
 * @param fallback - Value returned when neither form defines the constraint.
 * @returns The configured constraint or `fallback`.
 */
function resolveNumericConstraint(
    definition: NumberControlPayload,
    constraints: NumberControlConstraints | Record<string, unknown>,
    key: 'min' | 'max' | 'step',
    fallback: number
): unknown {
    const nested = constraints?.[key];
    if (nested !== undefined && nested !== null) {
        return nested;
    }
    const direct = definition?.[key];
    return direct !== undefined && direct !== null ? direct : fallback;
}

/**
 * Clamp a numeric value into a number control's `min`/`max` range.
 *
 * `min`/`max` are read through `resolveNumericConstraint` so the nested `constraints` form
 * keeps its precedence over the top-level definition properties, matching how `NumberControlUi`
 * resolves them. `step` is intentionally ignored here: it is a UI increment hint, not a value
 * constraint, so a value that is off the step lattice is left as-is.
 *
 * @param definition - Control definition payload carrying the bounds.
 * @param value - Numeric value to limit.
 * @returns The value limited to the configured finite bounds.
 */
export function clampNumericControlValue(definition: NumberControlPayload, value: number): number {
    const constraints = (definition?.constraints ?? {}) as NumberControlConstraints;
    const min = Number(resolveNumericConstraint(definition, constraints, 'min', -Infinity));
    const max = Number(resolveNumericConstraint(definition, constraints, 'max', Infinity));
    let clamped = value;
    if (Number.isFinite(min)) {
        clamped = Math.max(clamped, min);
    }
    if (Number.isFinite(max)) {
        clamped = Math.min(clamped, max);
    }
    return clamped;
}

export interface NumberControlNodeState {
    controlValues: Record<string, unknown>;
}

export interface NumberControlNodeUiLike {
    hideEditor?: () => void;
    onControlChanged?: (controlId: string, newValue: unknown, oldValue: unknown) => void;
    _i18nService?: {
        currentLocale?: string;
    };
}

export interface NumberControlLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Node-wide label column width (see `ControlRenderLayout`). */
    labelWidth?: number;
}

export interface NumberControlDimensions {
    height: number;
    width: number;
    labelWidth: number;
}

export interface NumericParsePayload {
    rawValue: string;
    parsedValue: number;
    isValid: boolean;
}

export interface NumericValidationPayload {
    value: number;
    min: unknown;
    max: unknown;
    step: unknown;
}

export default class NumberControlUi extends NodeControlUi {
    declare controlData: NumberControlPayload;
    declare nodeData: NumberControlNodeState;
    declare nodeUi: NumberControlNodeUiLike;
    declare inputElement: HTMLInputElement | null;
    declare _changeHandler: ((event: Event) => void) | null;
    declare _blurHandler: ((event: FocusEvent) => void) | null;
    declare _keydownHandler: ((event: KeyboardEvent) => void) | null;

    _constraints: NumberControlConstraints | Record<string, unknown>;
    _min: unknown;
    _max: unknown;
    _step: unknown;

    declare getValue: () => unknown;
    declare _notifyChange: (newValue: unknown) => void;
    declare _renderLabelAndGetValueLayout: (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        availableWidth: number,
        height: number,
        labelWidth?: number
    ) => NumberControlLayout;
    declare _styleEditor: (element: HTMLElement, width?: number) => void;
    declare _getInputId: () => string;
    declare _removeInvalidState: () => void;

    /**
     * Create a new NumberControlUi instance.
     */
    constructor(
        controlData: NumberControlPayload,
        nodeData: NumberControlNodeState,
        nodeUi: NumberControlNodeUiLike,
        options: Record<string, unknown> = {}
    ) {
        super(controlData, nodeData, nodeUi, options);

        this._constraints = controlData.constraints || {};

        this._min = resolveNumericConstraint(controlData, this._constraints, 'min', -Infinity);
        this._max = resolveNumericConstraint(controlData, this._constraints, 'max', Infinity);
        this._step = resolveNumericConstraint(controlData, this._constraints, 'step', 1);

        // Number controls should not close on each keystroke
        this.closeOnChange = false;
    }

    /**
     * Render control on canvas.
     */
    renderCanvas(ctx: CanvasRenderingContext2D, layout: NumberControlLayout): void {
        const { x, y, width, height } = layout;
        const value = this.getValue();

        // Render label and get the layout for the value display area
        const valueLayout = this._renderLabelAndGetValueLayout(
            ctx,
            x,
            y,
            width,
            height,
            layout.labelWidth
        );

        // Draw value background
        ctx.fillStyle = CONTROL_CANVAS_VALUE_BACKGROUND_COLOR;
        ctx.fillRect(valueLayout.x, valueLayout.y, valueLayout.width, valueLayout.height);

        // Draw value border
        ctx.strokeStyle = CONTROL_CANVAS_VALUE_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(valueLayout.x, valueLayout.y, valueLayout.width, valueLayout.height);

        // Draw value text
        ctx.fillStyle = CONTROL_CANVAS_VALUE_TEXT_COLOR;
        ctx.font =
            '500 12px system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            String(value),
            valueLayout.x + valueLayout.width - 8,
            valueLayout.y + valueLayout.height / 2
        );
    }

    /**
     * Get layout requirements for this control.
     */
    getLayout(): NumberControlDimensions {
        return {
            height: 18,
            width: 80,
            labelWidth: 80,
        };
    }

    /**
     * Render control for DOM with label and background.
     */
    renderDOM(container?: HTMLElement): HTMLElement {
        return super.renderDOM(container);
    }

    /**
     * Create the number input element for DOM rendering.
     */
    _renderDOMControl(): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = (this.getValue() !== undefined ? this.getValue() : 0) as string;
        input.className = 'node-control-ui__input node-control-ui__input--number';
        input.id = this._getInputId();
        input.style.width = '80px';

        // Apply constraints
        if (this._min !== -Infinity) {
            input.min = this._min as unknown as string;
        }
        if (this._max !== Infinity) {
            input.max = this._max as unknown as string;
        }
        if (this._step !== undefined) {
            input.step = this._step as unknown as string;
        }

        // Apply styling (no explicit width - let CSS handle it)
        this._styleEditor(input);

        // Update value on input (but don't close). The stored value is clamped so the
        // node can never hold an out-of-range number, even when the editor closes via a
        // click-away `mousedown` that removes the input instead of blurring it. The typed
        // text is left untouched, so `5` on the way to `500` is not rewritten mid-edit.
        this._changeHandler = () => {
            const parsePayload = this._parseNumericInputValue(input.value);
            if (parsePayload.isValid) {
                const value = this._clampValue(parsePayload.parsedValue);
                this._buildValidationPayload(value);
                this._notifyChange(value);
            }
        };
        input.addEventListener('input', this._changeHandler);

        // Close editor on blur
        this._blurHandler = () => {
            this._commitInputValue(input);
            this._requestClose();
        };
        input.addEventListener('blur', this._blurHandler);

        // Close editor on Enter key
        this._keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                this._commitInputValue(input);
                this._requestClose();
            } else if (e.key === 'Escape') {
                this._requestClose();
            }
        };
        input.addEventListener('keydown', this._keydownHandler);

        // Store reference
        this.inputElement = input;

        return input;
    }

    /**
     * Update DOM input value.
     */
    _updateDOMInputValue(value: number): void {
        this.inputElement!.value = value as unknown as string;
        this._removeInvalidState();
    }

    /**
     * Request the editor to close (for number controls that don't auto-close).
     * This tells the parent NodeUi to hide the editor.
     */
    _requestClose(): void {
        if (this.nodeUi && typeof this.nodeUi.hideEditor === 'function') {
            this.nodeUi.hideEditor();
        }
    }

    /**
     * Clamp a parsed input value into the control's `min … max` range.
     *
     * Constraints arrive as `unknown` from the node definition, so only finite numbers are
     * enforced; a missing or non-numeric bound is ignored.
     *
     * @param value - Parsed numeric input value.
     * @returns The value limited to the configured range.
     */
    _clampValue(value: number): number {
        return clampNumericControlValue(this.controlData, value);
    }

    /**
     * Commit the editor text when the editor closes (blur or Enter).
     *
     * The value is clamped into range and written back into the input, so a closed control
     * shows the value that was actually stored (`5` in a `min: 100` field becomes `100`).
     * Empty or non-numeric text keeps the previously stored value.
     *
     * @param input - The DOM number input being closed.
     */
    _commitInputValue(input: HTMLInputElement): void {
        const parsePayload = this._parseNumericInputValue(input.value);
        if (!parsePayload.isValid) {
            const stored = Number(this.getValue());
            if (Number.isFinite(stored)) {
                input.value = String(stored);
            }
            return;
        }
        const value = this._clampValue(parsePayload.parsedValue);
        this._buildValidationPayload(value);
        this._notifyChange(value);
        if (value !== parsePayload.parsedValue) {
            input.value = String(value);
        }
    }

    /**
     * Parse the raw input text as a number.
     *
     * @param rawValue - Text currently held by the input element.
     * @returns The parsed value plus whether it is a usable number.
     */
    _parseNumericInputValue(rawValue: string): NumericParsePayload {
        const parsedValue = parseFloat(rawValue);
        return {
            rawValue,
            parsedValue,
            isValid: !isNaN(parsedValue),
        };
    }

    _buildValidationPayload(value: number): NumericValidationPayload {
        return {
            value,
            min: this._min,
            max: this._max,
            step: this._step,
        };
    }
}
