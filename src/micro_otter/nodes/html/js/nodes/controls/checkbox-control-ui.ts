// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * CheckboxControlUi: Checkbox toggle control for boolean values.
 *
 * Features:
 * - Simple checkbox input
 * - Immediate value updates
 * - Visual toggle state
 */

import NodeControlUi from './node-control-ui.js';
import {
    CONTROL_ACCENT_BORDER_COLOR,
    CONTROL_ACCENT_SOLID_COLOR,
    CONTROL_ACCENT_SOFT_BACKGROUND_COLOR,
    CONTROL_CANVAS_VALUE_BACKGROUND_COLOR,
    CONTROL_CANVAS_VALUE_BORDER_COLOR,
} from './control-ui-colors.js';

export interface CheckboxControlLocalizedLabel {
    [locale: string]: string;
}

export interface CheckboxControlPayload {
    id: string;
    type: string;
    label: string | CheckboxControlLocalizedLabel;
    default: unknown;
    value?: unknown;
    constraints?: Record<string, unknown>;
}

export interface CheckboxControlNodeState {
    controlValues: Record<string, unknown>;
}

export interface CheckboxControlChangeTarget {
    checked: boolean;
}

export interface CheckboxControlNodeUiLike {
    _i18nService?: {
        currentLocale?: string;
    };
    onControlChanged?: (controlId: string, newValue: unknown, oldValue: unknown) => void;
}

export interface CheckboxControlLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Node-wide label column width (see `ControlRenderLayout`). */
    labelWidth?: number;
}

export interface CheckboxControlDimensions {
    height: number;
    width: number;
    labelWidth: number;
}

export default class CheckboxControlUi extends NodeControlUi {
    declare controlData: CheckboxControlPayload;
    declare nodeData: CheckboxControlNodeState;
    declare nodeUi: CheckboxControlNodeUiLike;
    declare inputElement: HTMLInputElement | null;
    declare _changeHandler: ((event: Event) => void) | null;

    declare getValue: () => unknown;
    declare _notifyChange: (newValue: unknown) => void;
    declare _renderLabelAndGetValueLayout: (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        availableWidth: number,
        height: number,
        labelWidth?: number
    ) => CheckboxControlLayout;
    declare _styleEditor: (element: HTMLElement, width?: number) => void;
    declare _getInputId: () => string;

    /**
     * Render control on canvas.
     *
     * @param ctx - Canvas context
     * @param layout - Layout information
     */
    renderCanvas(ctx: CanvasRenderingContext2D, layout: CheckboxControlLayout): void {
        const { x, y, width, height } = layout;
        const checked = Boolean(this.getValue());

        // Render label and get the layout for the value display area
        const valueLayout = this._renderLabelAndGetValueLayout(
            ctx,
            x,
            y,
            width,
            height,
            layout.labelWidth
        );

        // Draw checkbox box
        const boxSize = 16;
        const boxX = valueLayout.x + 4;
        const boxY = valueLayout.y + (valueLayout.height - boxSize) / 2;

        // Background
        ctx.fillStyle = checked
            ? CONTROL_ACCENT_SOFT_BACKGROUND_COLOR
            : CONTROL_CANVAS_VALUE_BACKGROUND_COLOR;
        ctx.fillRect(boxX, boxY, boxSize, boxSize);

        // Border
        ctx.strokeStyle = checked ? CONTROL_ACCENT_BORDER_COLOR : CONTROL_CANVAS_VALUE_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxSize, boxSize);

        // Draw checkmark if checked
        if (checked) {
            ctx.strokeStyle = CONTROL_ACCENT_SOLID_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(boxX + 3, boxY + 8);
            ctx.lineTo(boxX + 6, boxY + 11);
            ctx.lineTo(boxX + 13, boxY + 4);
            ctx.stroke();
        }
    }

    /**
     * Get layout requirements for this control.
     */
    getLayout(): CheckboxControlDimensions {
        return {
            height: 18,
            width: 24,
            labelWidth: 80,
        };
    }

    /**
     * Render control for DOM with label and background.
     * For checkboxes, we don't actually show a DOM editor - just toggle the value.
     *
     * @param _container - Optional container to attach to (unused for checkbox)
     */
    renderDOM(_container?: HTMLElement): HTMLDivElement {
        // Toggle the checkbox value immediately
        const currentValue = Boolean(this.getValue());
        const newValue = !currentValue;

        // Update the value
        this._notifyChange(newValue);

        // Create an empty container (required by the interface)
        // The editor will be closed immediately by closeOnChange=true
        const emptyContainer = document.createElement('div');
        emptyContainer.style.display = 'none'; // Hidden since we don't need it

        return emptyContainer;
    }

    /**
     * Create the checkbox input element for DOM rendering.
     */
    _renderDOMControl(): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(this.getValue());
        input.className = 'node-control-ui__input node-control-ui__input--checkbox';
        input.id = this._getInputId();

        // Apply styling
        this._styleEditor(input);

        // Attach event listener
        this._changeHandler = () => {
            this._notifyChange(input.checked);
        };
        input.addEventListener('change', this._changeHandler);

        // Store reference
        this.inputElement = input;

        return input;
    }

    /**
     * Update DOM input value.
     *
     * @param value - New value
     */
    _updateDOMInputValue(value: boolean): void {
        this.inputElement!.checked = Boolean(value);
    }
}
