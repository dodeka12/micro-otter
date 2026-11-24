// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * TextControlUi: Text input control for string values.
 *
 * Features:
 * - Simple text input field
 * - Real-time value updates
 * - Support for multiline text (future enhancement)
 */

import NodeControlUi from './node-control-ui.js';
import type { ValueLayout } from './node-control-ui.js';
import {
    CONTROL_CANVAS_VALUE_BACKGROUND_COLOR,
    CONTROL_CANVAS_VALUE_BORDER_COLOR,
    CONTROL_CANVAS_VALUE_TEXT_COLOR,
} from './control-ui-colors.js';

export interface TextControlPayload {
    id: string;
    type: string;
    label?: string | Record<string, string>;
    default?: unknown;
    value?: unknown;
    constraints?: Record<string, unknown>;
}

export interface TextControlNodeState {
    controlValues: Record<string, unknown>;
}

export interface TextControlNodeUiLike {
    hideEditor?: () => void;
    onControlChanged?: (controlId: string, newValue: unknown, oldValue: unknown) => void;
    _i18nService?: {
        currentLocale?: string;
    };
}

export interface TextControlLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Node-wide label column width (see `ControlRenderLayout`). */
    labelWidth?: number;
}

export interface TextControlDimensions {
    height: number;
    width: number;
    labelWidth: number;
}

export interface TextControlUpdatePayload {
    rawValue: string;
    nextValue: string;
    isValid: boolean;
}

export default class TextControlUi extends NodeControlUi {
    declare controlData: TextControlPayload;
    declare nodeData: TextControlNodeState;
    declare nodeUi: TextControlNodeUiLike;
    declare inputElement: HTMLInputElement | null;
    declare _changeHandler: ((event: Event) => void) | null;
    declare _blurHandler: ((event: FocusEvent) => void) | null;
    declare _keydownHandler: ((event: KeyboardEvent) => void) | null;

    declare getValue: () => unknown;
    declare _notifyChange: (newValue: unknown) => void;
    declare _renderLabelAndGetValueLayout: (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        availableWidth: number,
        height: number,
        labelWidth?: number
    ) => TextControlLayout;
    declare _styleEditor: (element: HTMLElement, width?: number) => void;
    declare _getInputId: () => string;

    /**
     * Create a TextControlUi instance.
     */
    constructor(
        controlData: TextControlPayload,
        nodeData: TextControlNodeState,
        nodeUi: TextControlNodeUiLike,
        options: Record<string, unknown> = {}
    ) {
        super(controlData, nodeData, nodeUi, options);
        // Text controls should not close on each keystroke
        this.closeOnChange = false;
    }

    /**
     * Render control on canvas.
     *
     * @param ctx - Canvas context
     * @param layout - Layout information
     */
    renderCanvas(ctx: CanvasRenderingContext2D, layout: TextControlLayout): void {
        const { x, y, width, height } = layout;
        const value = this._coerceTextValue(this.getValue());

        // Render label and get the layout for the value display area
        const valueLayout = this._renderLabelAndGetValueLayout(
            ctx,
            x,
            y,
            width,
            height,
            layout.labelWidth
        );

        // Draw background
        ctx.fillStyle = CONTROL_CANVAS_VALUE_BACKGROUND_COLOR;
        ctx.fillRect(valueLayout.x, valueLayout.y, valueLayout.width, valueLayout.height);

        // Draw border
        ctx.strokeStyle = CONTROL_CANVAS_VALUE_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(valueLayout.x, valueLayout.y, valueLayout.width, valueLayout.height);

        // Subclasses may paint a leading decoration (the icon control draws its glyph) and
        // reserve that much room at the left of the value box.
        const leadingWidth = this._canvasValueLeadingWidth(ctx, valueLayout);
        this._drawCanvasValueLeading(ctx, valueLayout, leadingWidth);

        // Draw text value (truncate if too long)
        ctx.fillStyle = CONTROL_CANVAS_VALUE_TEXT_COLOR;
        ctx.font =
            '500 12px system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Measure and truncate text if needed
        const maxTextWidth = Math.max(0, valueLayout.width - 16 - leadingWidth);
        let displayText = String(value);
        if (ctx.measureText(value).width > maxTextWidth) {
            // Truncate with ellipsis
            for (let i = value.length - 1; i > 0; i--) {
                displayText = value.substring(0, i) + '...';
                if (ctx.measureText(displayText).width <= maxTextWidth) {
                    break;
                }
            }
        }

        ctx.fillText(
            displayText,
            valueLayout.x + 8 + leadingWidth,
            valueLayout.y + valueLayout.height / 2
        );
    }

    /**
     * Width to keep free at the left of the value box for a leading decoration.
     *
     * The inherited canvas rendering adds the returned width to the value text's left
     * padding and subtracts it from the space the text may use, so node metrics stay
     * unchanged. Subclasses that paint nothing return `0`.
     *
     * @param _ctx - Canvas context, available for measuring.
     * @param _valueLayout - Value box the text is drawn into.
     * @returns Reserved width in pixels.
     */
    _canvasValueLeadingWidth(_ctx: CanvasRenderingContext2D, _valueLayout: ValueLayout): number {
        return 0;
    }

    /**
     * Paint the leading decoration inside the area reserved by `_canvasValueLeadingWidth()`.
     *
     * Called after the value box is filled and bordered, before the value text.
     *
     * @param _ctx - Canvas context.
     * @param _valueLayout - Value box the text is drawn into.
     * @param _leadingWidth - Width reserved by `_canvasValueLeadingWidth()`.
     */
    _drawCanvasValueLeading(
        _ctx: CanvasRenderingContext2D,
        _valueLayout: ValueLayout,
        _leadingWidth: number
    ): void {
        // No decoration by default.
    }

    /**
     * Get layout requirements for this control.
     */
    getLayout(): TextControlDimensions {
        return {
            height: 18,
            width: 180,
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
     * Create the text input element for DOM rendering.
     */
    _renderDOMControl(): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this._coerceTextValue(this.getValue());
        input.className = 'node-control-ui__input node-control-ui__input--text';
        input.id = this._getInputId();

        // Apply styling (no explicit width - let CSS handle it)
        this._styleEditor(input);

        // Update value on input (but don't close)
        this._changeHandler = () => {
            const updatePayload = this._buildUpdatePayload(input.value);
            if (updatePayload.isValid) {
                this._notifyChange(updatePayload.nextValue);
            }
        };
        input.addEventListener('input', this._changeHandler);

        // Close editor on blur
        this._blurHandler = () => {
            const updatePayload = this._buildUpdatePayload(input.value);
            if (updatePayload.isValid) {
                this._notifyChange(updatePayload.nextValue);
            }
            this._requestClose();
        };
        input.addEventListener('blur', this._blurHandler);

        // Close editor on Enter key
        this._keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                const updatePayload = this._buildUpdatePayload(input.value);
                if (updatePayload.isValid) {
                    this._notifyChange(updatePayload.nextValue);
                }
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
     * Request the editor to close (for text controls that don't auto-close).
     * This tells the parent NodeUi to hide the editor.
     */
    _requestClose(): void {
        if (this.nodeUi && typeof this.nodeUi.hideEditor === 'function') {
            this.nodeUi.hideEditor();
        }
    }

    /**
     * Update DOM input value.
     */
    _updateDOMInputValue(value: string): void {
        this.inputElement!.value = value !== undefined ? value : '';
    }

    _coerceTextValue(value: unknown): string {
        return value !== undefined && value !== null ? String(value) : '';
    }

    _buildUpdatePayload(rawValue: string): TextControlUpdatePayload {
        return {
            rawValue,
            nextValue: rawValue,
            isValid: true,
        };
    }
}
