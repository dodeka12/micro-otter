// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * SliderControlUi: Range slider control with value display.
 *
 * Features:
 * - Range slider with min/max/step constraints
 * - Live value display
 * - Real-time updates during drag
 * - Combines slider and number display
 */

import NodeControlUi from './node-control-ui.js';
import {
    CONTROL_ACCENT_SOLID_COLOR,
    CONTROL_CANVAS_VALUE_TEXT_COLOR,
    CONTROL_SLIDER_FILL_COLOR,
    CONTROL_SLIDER_THUMB_BORDER_COLOR,
    CONTROL_SLIDER_TRACK_COLOR,
} from './control-ui-colors.js';

export interface SliderControlConstraints {
    min?: number;
    max?: number;
    step?: number;
    [key: string]: unknown;
}

export interface SliderControlPayload {
    id: string;
    type: string;
    label?: string | Record<string, string>;
    default?: unknown;
    value?: unknown;
    constraints?: SliderControlConstraints | Record<string, unknown>;
}

export interface SliderControlNodeState {
    controlValues: Record<string, unknown>;
}

export interface SliderControlNodeUiLike {
    hideEditor?: () => void;
    onControlChanged?: (controlId: string, newValue: unknown, oldValue: unknown) => void;
    _i18nService?: {
        currentLocale?: string;
    };
}

export interface SliderControlLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Node-wide label column width (see `ControlRenderLayout`). */
    labelWidth?: number;
}

export interface SliderControlDimensions {
    height: number;
    width: number;
    labelWidth: number;
}

export default class SliderControlUi extends NodeControlUi {
    declare controlData: SliderControlPayload;
    declare nodeData: SliderControlNodeState;
    declare nodeUi: SliderControlNodeUiLike;
    declare inputElement: HTMLInputElement | null;
    declare _blurHandler: ((event: FocusEvent) => void) | null;
    declare _keydownHandler: ((event: KeyboardEvent) => void) | null;

    _constraints: SliderControlConstraints | Record<string, unknown>;
    _min: unknown;
    _max: unknown;
    _step: unknown;

    valueDisplay: HTMLSpanElement | null;

    declare getValue: () => unknown;
    declare _notifyChange: (newValue: unknown) => void;
    declare _renderLabelAndGetValueLayout: (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        availableWidth: number,
        height: number,
        labelWidth?: number
    ) => SliderControlLayout;
    declare _styleEditor: (element: HTMLElement, width?: number) => void;
    declare _getInputId: () => string;

    /**
     * Create a new SliderControlUi instance.
     */
    constructor(
        controlData: SliderControlPayload,
        nodeData: SliderControlNodeState,
        nodeUi: SliderControlNodeUiLike,
        options: Record<string, unknown> = {}
    ) {
        super(controlData, nodeData, nodeUi, options);

        this._constraints = controlData.constraints || {};

        const constraints = this._constraints as {
            min?: unknown;
            max?: unknown;
            step?: unknown;
        };

        this._min = constraints.min !== undefined ? constraints.min : 0;
        this._max = constraints.max !== undefined ? constraints.max : 100;
        this._step = constraints.step !== undefined ? constraints.step : 1;

        this.valueDisplay = null;

        // Slider controls should not close while dragging
        this.closeOnChange = false;
    }

    /**
     * Render control on canvas.
     */
    renderCanvas(ctx: CanvasRenderingContext2D, layout: SliderControlLayout): void {
        const { x, y, width, height } = layout;
        const value = this.getValue() as number;

        // Render label and get the layout for the value display area
        const valueLayout = this._renderLabelAndGetValueLayout(
            ctx,
            x,
            y,
            width,
            height,
            layout.labelWidth
        );

        const normalizedValue =
            (value - (this._min as number)) / ((this._max as number) - (this._min as number));

        // Draw slider track
        const trackY = valueLayout.y + valueLayout.height / 2;
        const trackHeight = 4;
        const trackWidth = valueLayout.width - 60; // Leave space for value display

        // Background track
        ctx.fillStyle = CONTROL_SLIDER_TRACK_COLOR;
        ctx.fillRect(valueLayout.x, trackY - trackHeight / 2, trackWidth, trackHeight);

        // Filled track (up to current value)
        ctx.fillStyle = CONTROL_SLIDER_FILL_COLOR;
        ctx.fillRect(
            valueLayout.x,
            trackY - trackHeight / 2,
            trackWidth * normalizedValue,
            trackHeight
        );

        // Draw slider thumb
        const thumbX = valueLayout.x + trackWidth * normalizedValue;
        const thumbRadius = 8;

        ctx.fillStyle = CONTROL_ACCENT_SOLID_COLOR;
        ctx.beginPath();
        ctx.arc(thumbX, trackY, thumbRadius, 0, Math.PI * 2);
        ctx.fill();

        // Draw border for thumb
        ctx.strokeStyle = CONTROL_SLIDER_THUMB_BORDER_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(thumbX, trackY, thumbRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Draw value text
        ctx.fillStyle = CONTROL_CANVAS_VALUE_TEXT_COLOR;
        ctx.font =
            '500 12px system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), valueLayout.x + valueLayout.width - 4, trackY);
    }

    /**
     * Get layout requirements for this control.
     */
    getLayout(): SliderControlDimensions {
        return {
            height: 18,
            width: 200,
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
     * Create the slider element for DOM rendering.
     */
    _renderDOMControl(): HTMLDivElement {
        const container = document.createElement('div');
        container.className = 'node-control-ui__slider-container';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';
        container.style.flex = '1';

        // Create range input
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = this._min as unknown as string;
        slider.max = this._max as unknown as string;
        slider.step = this._step as unknown as string;
        slider.value = this.getValue() as unknown as string;
        slider.className = 'node-control-ui__input node-control-ui__input--slider';
        slider.id = this._getInputId();
        slider.style.flex = '1';

        this._styleEditor(slider);

        // Create value display
        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'node-control-ui__slider-value';
        valueDisplay.textContent = String(this.getValue());
        valueDisplay.style.minWidth = '40px';
        valueDisplay.style.textAlign = 'right';
        valueDisplay.style.fontSize = '12px';
        valueDisplay.style.color = CONTROL_CANVAS_VALUE_TEXT_COLOR;

        // Update display when slider changes (but don't close)
        const updateDisplay = (): void => {
            valueDisplay.textContent = String(slider.value);
            this._notifyChange(parseFloat(slider.value));
        };

        slider.addEventListener('input', updateDisplay);

        // Close editor on mouse release (change event)
        slider.addEventListener('change', () => {
            this._notifyChange(parseFloat(slider.value));
            this._requestClose();
        });

        // Close editor on blur
        this._blurHandler = () => {
            this._requestClose();
        };
        slider.addEventListener('blur', this._blurHandler);

        // Close editor on ESC key
        this._keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this._requestClose();
            }
        };
        slider.addEventListener('keydown', this._keydownHandler);

        container.appendChild(slider);
        container.appendChild(valueDisplay);

        // Store references
        this.inputElement = slider;
        this.valueDisplay = valueDisplay;

        return container;
    }

    /**
     * Handle editor blur.
     * For slider, commit on blur.
     */
    _onEditorBlur(editor: HTMLElement): void {
        void editor;
        const nextValue = this.inputElement ? parseFloat(this.inputElement.value) : this.getValue();
        this._notifyChange(nextValue);
        this._requestClose();
    }

    /**
     * Update DOM input value and display.
     */
    _updateDOMInputValue(value: number): void {
        this.inputElement!.value = value as unknown as string;
        if (this.valueDisplay) {
            this.valueDisplay.textContent = value as unknown as string;
        }
    }

    /**
     * Request the editor to close (for slider controls that don't auto-close).
     * This tells the parent NodeUi to hide the editor.
     */
    _requestClose(): void {
        if (this.nodeUi && typeof this.nodeUi.hideEditor === 'function') {
            this.nodeUi.hideEditor();
        }
    }

    /**
     * Clean up event listeners and DOM.
     */
    destroy(): void {
        this.valueDisplay = null;
        super.destroy();
    }
}
