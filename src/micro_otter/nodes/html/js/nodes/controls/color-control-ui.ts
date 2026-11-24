// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * ColorControlUi: Color picker control with alpha channel support.
 *
 * Features:
 * - Browser native color picker for RGB
 * - Separate alpha slider
 * - Store as hex with alpha: #RRGGBBAA
 * - Convert between browser format (no alpha) and stored format
 */

import NodeControlUi from './node-control-ui.js';
import { fitTextToWidth } from '../node-ui-helpers.js';

export interface ColorControlLocalizedLabel {
    [locale: string]: string;
}

export interface ColorControlPayload {
    id: string;
    type: string;
    label?: string | ColorControlLocalizedLabel;
    default?: unknown;
    constraints?: Record<string, unknown>;
    value?: unknown;
}

export interface ColorControlNodeState {
    controlValues: Record<string, unknown>;
}

export interface ColorControlNodeUiLike {
    _i18nService?: {
        currentLocale?: string;
    };
    hideEditor?: () => void;
    onControlChanged?: (controlId: string, newValue: unknown, oldValue: unknown) => void;
}

export interface ColorControlLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Node-wide label column width (see `ControlRenderLayout`). */
    labelWidth?: number;
}

export interface ColorControlDimensions {
    height: number;
    width: number;
    labelWidth: number;
}

export interface ColorControlValueLayout {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ParsedColorValue {
    rgb: string;
    alpha: number;
}

export interface RgbaColorValue {
    r: number;
    g: number;
    b: number;
    a?: number;
}

export default class ColorControlUi extends NodeControlUi {
    declare controlData: ColorControlPayload;
    declare nodeData: ColorControlNodeState;
    declare nodeUi: ColorControlNodeUiLike;
    declare inputElement: HTMLInputElement | null;

    alphaSlider: HTMLInputElement | null;
    alphaDisplay: HTMLSpanElement | null;

    _colorBlurHandler: ((event: FocusEvent) => void) | null;
    _keydownHandler: ((event: KeyboardEvent) => void) | null;

    declare getValue: () => unknown;
    declare _notifyChange: (newValue: unknown) => void;
    declare _renderLabelAndGetValueLayout: (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        availableWidth: number,
        height: number,
        labelWidth?: number
    ) => ColorControlValueLayout;
    declare _styleEditor: (element: HTMLElement, width?: number) => void;
    declare _getInputId: () => string;

    /**
     * Create a new ColorControlUi instance.
     */
    constructor(
        controlData: ColorControlPayload,
        nodeData: ColorControlNodeState,
        nodeUi: ColorControlNodeUiLike,
        options: Record<string, unknown> = {}
    ) {
        super(controlData, nodeData, nodeUi, options);

        this.alphaSlider = null;
        this.alphaDisplay = null;
        this._colorBlurHandler = null;
        this._keydownHandler = null;

        // Color controls should not close while adjusting color/alpha
        this.closeOnChange = false;
    }

    /**
     * Render control on canvas.
     */
    renderCanvas(ctx: CanvasRenderingContext2D, layout: ColorControlLayout): void {
        const { x, y, width, height } = layout;
        const colorValue = (this.getValue() as string) || '#ffffffff';
        const { rgb, alpha } = this._parseColorValue(colorValue);

        // Render label and get the layout for the value display area
        const valueLayout = this._renderLabelAndGetValueLayout(
            ctx,
            x,
            y,
            width,
            height,
            layout.labelWidth
        );

        // Draw color swatch
        const swatchSize = valueLayout.height - 4;
        const swatchX = valueLayout.x + 4;
        const swatchY = valueLayout.y + 2;

        // Draw checkerboard background for transparency
        const checkSize = 4;
        for (let cy = 0; cy < swatchSize; cy += checkSize) {
            for (let cx = 0; cx < swatchSize; cx += checkSize) {
                const isLight = (cx / checkSize + cy / checkSize) % 2 === 0;
                ctx.fillStyle = isLight ? '#ccc' : '#999';
                ctx.fillRect(swatchX + cx, swatchY + cy, checkSize, checkSize);
            }
        }

        // Draw color with alpha
        const alphaFloat = alpha / 255;
        ctx.fillStyle = `${rgb}${Math.round(alphaFloat * 255)
            .toString(16)
            .padStart(2, '0')}`;
        ctx.fillRect(swatchX, swatchY, swatchSize, swatchSize);

        // Draw swatch border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(swatchX, swatchY, swatchSize, swatchSize);

        // Draw alpha percentage next to the swatch, but only when it fits the value column
        const alphaCaption = `α${Math.round(alphaFloat * 100)}%`;
        ctx.font = '500 10px system-ui, -apple-system, "Segoe UI", "Roboto", Arial, sans-serif';
        const captionX = swatchX + swatchSize + 6;
        const captionSpace = valueLayout.x + valueLayout.width - captionX;
        const fittedCaption = fitTextToWidth(ctx, alphaCaption, captionSpace);

        if (fittedCaption.text === alphaCaption) {
            ctx.fillStyle = 'rgba(229, 234, 243, 0.7)';
            ctx.fillText(alphaCaption, captionX, valueLayout.y + valueLayout.height / 2);
        }
    }

    /**
     * Get layout requirements for this control.
     */
    getLayout(): ColorControlDimensions {
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
     * Create the color input element for DOM rendering.
     */
    _renderDOMControl(): HTMLDivElement {
        const container = document.createElement('div');
        container.className = 'node-control-ui__color-container';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';
        container.style.flex = '1';

        const { rgb, alpha } = this._parseColorValue((this.getValue() as string) || '#ffffffff');

        // Create color input
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = rgb;
        colorInput.className = 'node-control-ui__input node-control-ui__input--color';
        colorInput.id = this._getInputId();
        colorInput.style.width = '40px';
        colorInput.style.height = '32px';
        colorInput.style.cursor = 'pointer';

        // Create alpha slider
        const alphaSlider = document.createElement('input');
        alphaSlider.type = 'range';
        alphaSlider.min = '0';
        alphaSlider.max = '255';
        alphaSlider.value = String(alpha);
        alphaSlider.className = 'node-control-ui__input node-control-ui__input--alpha-slider';
        alphaSlider.style.flex = '1';

        this._styleEditor(alphaSlider);

        // Create alpha display
        const alphaDisplay = document.createElement('span');
        alphaDisplay.className = 'node-control-ui__alpha-display';
        alphaDisplay.textContent = `α${Math.round((alpha / 255) * 100)}%`;
        alphaDisplay.style.minWidth = '35px';
        alphaDisplay.style.textAlign = 'right';
        alphaDisplay.style.fontSize = '12px';
        alphaDisplay.style.color = '#e5eaf3';

        // Update when color or alpha changes (but don't close)
        const updateValue = (): void => {
            const newAlpha = parseInt(alphaSlider.value, 10);
            const newValue =
                colorInput.value + newAlpha.toString(16).padStart(2, '0').toUpperCase();
            alphaDisplay.textContent = `α${Math.round((newAlpha / 255) * 100)}%`;
            this._notifyChange(newValue);
        };

        colorInput.addEventListener('input', updateValue);
        alphaSlider.addEventListener('input', updateValue);

        // Close only when focus leaves the entire color editor container.
        this._colorBlurHandler = (event: FocusEvent) => {
            const nextFocused = event.relatedTarget;
            if (nextFocused instanceof Node && container.contains(nextFocused)) {
                return;
            }
            this._requestClose();
        };
        container.addEventListener('focusout', this._colorBlurHandler);

        // Close on ESC key from either control
        this._keydownHandler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                this._requestClose();
            }
        };
        colorInput.addEventListener('keydown', this._keydownHandler);
        alphaSlider.addEventListener('keydown', this._keydownHandler);

        container.appendChild(colorInput);
        container.appendChild(alphaSlider);
        container.appendChild(alphaDisplay);

        // Store references
        this.inputElement = colorInput;
        this.alphaSlider = alphaSlider;
        this.alphaDisplay = alphaDisplay;

        return container;
    }

    /**
     * Update DOM input value.
     */
    _updateDOMInputValue(value: unknown): void {
        const { rgb, alpha } = this._parseColorValue(value);

        if (this.inputElement) {
            this.inputElement.value = rgb;
        }
        if (this.alphaSlider) {
            this.alphaSlider.value = String(alpha);
        }
        this._updateAlphaDisplay();
    }

    _parseColorValue(value: unknown): ParsedColorValue {
        const defaultColor: ParsedColorValue = { rgb: '#ffffff', alpha: 255 };

        if (value && typeof value === 'object') {
            const rgba = value as Partial<RgbaColorValue>;
            if (Number.isFinite(rgba.r) && Number.isFinite(rgba.g) && Number.isFinite(rgba.b)) {
                const r = this._clampChannel(rgba.r as number);
                const g = this._clampChannel(rgba.g as number);
                const b = this._clampChannel(rgba.b as number);
                const hasAlpha = Number.isFinite(rgba.a);
                const a = hasAlpha ? this._clampAlphaByte(rgba.a as number) : defaultColor.alpha;

                return {
                    rgb: `#${this._toHexByte(r)}${this._toHexByte(g)}${this._toHexByte(b)}`,
                    alpha: a,
                };
            }
        }

        if (typeof value !== 'string') {
            return defaultColor;
        }

        const normalized = value.trim();
        if (!normalized.startsWith('#')) {
            return defaultColor;
        }

        const hex = normalized.slice(1);
        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            const r = hex[0] + hex[0];
            const g = hex[1] + hex[1];
            const b = hex[2] + hex[2];
            return { rgb: `#${r}${g}${b}`.toLowerCase(), alpha: defaultColor.alpha };
        }

        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            const r = hex[0] + hex[0];
            const g = hex[1] + hex[1];
            const b = hex[2] + hex[2];
            const a = Number.parseInt(hex[3] + hex[3], 16);
            return { rgb: `#${r}${g}${b}`.toLowerCase(), alpha: this._clampAlphaByte(a) };
        }

        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            return { rgb: `#${hex}`.toLowerCase(), alpha: defaultColor.alpha };
        }

        if (/^[0-9a-fA-F]{8}$/.test(hex)) {
            const rgb = `#${hex.slice(0, 6)}`.toLowerCase();
            const alpha = Number.parseInt(hex.slice(6, 8), 16);
            return { rgb, alpha: this._clampAlphaByte(alpha) };
        }

        return defaultColor;
    }

    _updateAlphaDisplay(): void {
        if (!this.alphaDisplay) {
            return;
        }

        const sliderValue = this.alphaSlider ? Number.parseInt(this.alphaSlider.value, 10) : 255;
        const alpha = this._clampAlphaByte(Number.isFinite(sliderValue) ? sliderValue : 255);
        this.alphaDisplay.textContent = `α${Math.round((alpha / 255) * 100)}%`;
    }

    _clampChannel(value: number): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 0;
        }
        return Math.max(0, Math.min(255, Math.round(numeric)));
    }

    _clampAlphaByte(value: number): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 255;
        }

        if (numeric >= 0 && numeric <= 1) {
            return Math.max(0, Math.min(255, Math.round(numeric * 255)));
        }

        return Math.max(0, Math.min(255, Math.round(numeric)));
    }

    _toHexByte(value: number): string {
        return this._clampChannel(value).toString(16).padStart(2, '0');
    }

    /**
     * Request the editor to close (for color controls that don't auto-close).
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
        this.alphaSlider = null;
        this.alphaDisplay = null;
        this._colorBlurHandler = null;
        this._keydownHandler = null;
        super.destroy();
    }
}
