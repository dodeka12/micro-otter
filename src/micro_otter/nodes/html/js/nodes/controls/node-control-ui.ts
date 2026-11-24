// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * NodeControlUi: Abstract base class for node control UI components.
 *
 * Responsibilities:
 * - Define common interface for all control types
 * - Handle value change notifications to parent NodeUi
 * - Provide lifecycle management (render, update, destroy)
 *
 * Subclasses:
 * - NumberControlUi: Number input with constraints
 * - SliderControlUi: Range slider with value display
 * - TextControlUi: Text input field
 * - NodeDropdownControlUi: Select dropdown with options
 * - CheckboxControlUi: Checkbox toggle
 * - ColorControlUi: Color picker with alpha channel
 */

import {
    CONTROL_CANVAS_LABEL_TEXT_COLOR,
    CONTROL_DOM_EDITOR_BACKGROUND_COLOR,
    CONTROL_DOM_EDITOR_BORDER_COLOR,
    CONTROL_DOM_EDITOR_TEXT_COLOR,
    CONTROL_DOM_LABEL_TEXT_COLOR,
    CONTROL_DOM_WRAPPER_BACKGROUND_COLOR,
} from './control-ui-colors.js';
import {
    CONTROL_HEIGHT,
    CONTROL_LABEL_FONT,
    CONTROL_LABEL_MARGIN,
    CONTROL_SPACING,
} from '../node-ui-constants.js';
import { fitTextToWidth, resolveControlLabelText } from '../node-ui-helpers.js';
import type { FittedText, Rect } from '../node-ui-helpers.js';

export type ControlValue = unknown;

export type ControlLabel = string | Record<string, string>;

export interface NodeControlData {
    id: string;
    type: string;
    label?: ControlLabel;
    layout?: 'inline' | 'stacked';
    default?: ControlValue;
    constraints?: Record<string, unknown>;
    value?: ControlValue;
}

export interface NodeDataLike {
    controlValues: Record<string, ControlValue>;
}

export interface NodeUiLike {
    onControlChanged?: (id: string, newValue: ControlValue, oldValue: ControlValue) => void;
    hideEditor?: () => void;
    getCurrentLocale?: () => string;
    _i18nService?: {
        currentLocale?: string;
    };
}

export interface NodeControlUiOptions {
    t?: (key: string) => string;
    logger?: Console;
}

export interface ControlRenderLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    /**
     * Node-wide label column width. Inline renderers must use it instead of measuring
     * their own label, so every control of a node shares one value column.
     */
    labelWidth?: number;
}

export interface ValueLayout {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface EditorScreenPoint {
    x: number;
    y: number;
    width?: number;
}

export interface ControlPoint {
    x: number;
    y: number;
}

export interface HitTestResult {
    hit: boolean;
}

type InputElementLike = HTMLElement & {
    type?: string;
    checked?: boolean;
    value?: unknown;
};

export default class NodeControlUi {
    controlData: NodeControlData;
    nodeData: NodeDataLike;
    nodeUi: NodeUiLike;

    _t: (key: string) => string;
    _logger: Console;

    domElement: HTMLElement | null;
    labelElement: HTMLLabelElement | null;
    inputElement: InputElementLike | null;

    _changeHandler: EventListener | null;

    /**
     * Whether the DOM editor should close automatically on first value change.
     * Default is true (close immediately), suitable for dropdowns and checkboxes.
     * Set to false for text inputs and sliders that require continuous editing.
     */
    closeOnChange: boolean;

    /**
     * Create a new NodeControlUi instance.
     */
    constructor(
        controlData: NodeControlData,
        nodeData: NodeDataLike,
        nodeUi: NodeUiLike,
        options: NodeControlUiOptions = {}
    ) {
        if (new.target === NodeControlUi) {
            throw new TypeError(
                'Cannot construct NodeControlUi instances directly (abstract class)'
            );
        }

        this.controlData = controlData;
        this.nodeData = nodeData;
        this.nodeUi = nodeUi;
        this._t = options.t || ((key: string) => key);
        this._logger = options.logger || console;

        this.domElement = null;
        this.labelElement = null;
        this.inputElement = null;

        this._changeHandler = null;

        this.closeOnChange = true;
    }

    /**
     * Render the control on canvas as part of node display.
     * Called by NodeUi.drawControls() during the render loop.
     * Must be implemented by subclasses.
     * @param _ctx - Canvas rendering context
     * @param _layout - Control layout rectangle
     */
    renderCanvas(_ctx: CanvasRenderingContext2D, _layout: ControlRenderLayout): void {
        throw new Error('renderCanvas(ctx, layout) must be implemented by subclass');
    }

    /**
     * Resolve the label text and column this control draws.
     *
     * Single source of truth for `_renderLabelAndGetValueLayout()` and
     * `getCanvasLabelBounds()`, so the drawn text and the reported rectangle can never
     * disagree. The context font is only borrowed for measuring: the caller's font is
     * restored (and the state pushed/popped) before returning.
     *
     * @param ctx - Canvas context used for measuring.
     * @param layout - Control layout rectangle.
     * @returns Fitted text and width, the layout mode and the label row/column metrics.
     */
    _resolveCanvasLabelMetrics(
        ctx: CanvasRenderingContext2D,
        layout: ControlRenderLayout
    ): {
        text: string;
        width: number;
        stacked: boolean;
        labelRowHeight: number;
        columnWidth: number;
    } {
        const label = this._getLocalizedLabel();
        const stacked = this._isStackedLayout();
        const labelRowHeight = CONTROL_HEIGHT;

        const previousFont = ctx.font;
        ctx.save();
        ctx.font = CONTROL_LABEL_FONT;

        let columnWidth = layout.width;
        let fitted: FittedText;

        if (stacked) {
            fitted = fitTextToWidth(ctx, label, layout.width);
        } else {
            columnWidth = Math.max(
                0,
                layout.labelWidth ?? Math.min(layout.width, ctx.measureText(label).width)
            );
            fitted = fitTextToWidth(ctx, label, columnWidth);
        }

        ctx.restore();
        ctx.font = previousFont;

        return {
            text: fitted.text,
            width: fitted.width,
            stacked,
            labelRowHeight,
            columnWidth,
        };
    }

    /**
     * Helper method to render label and background on canvas.
     * Subclasses call this, then render their control value to the right.
     *
     * Inline controls lay their label out in the node-wide `labelWidth` column (falling
     * back to their own measured label when no column is supplied); labels that do not
     * fit are ellipsised. Stacked controls draw the label on its own full-width row.
     */
    _renderLabelAndGetValueLayout(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        availableWidth: number,
        height: number,
        labelWidth?: number
    ): ValueLayout {
        const { text, columnWidth, stacked, labelRowHeight } = this._resolveCanvasLabelMetrics(
            ctx,
            { x, y, width: availableWidth, height, labelWidth }
        );

        ctx.font = CONTROL_LABEL_FONT;
        ctx.fillStyle = CONTROL_CANVAS_LABEL_TEXT_COLOR;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        if (stacked) {
            ctx.fillText(text, x, y + labelRowHeight / 2);

            const valueY = y + labelRowHeight + CONTROL_SPACING;
            const valueHeight = Math.max(1, height - labelRowHeight - CONTROL_SPACING);

            return {
                x,
                y: valueY,
                width: availableWidth,
                height: valueHeight,
            };
        }

        ctx.fillText(text, x, y + height / 2);

        return {
            x: x + columnWidth + CONTROL_LABEL_MARGIN,
            y,
            width: Math.max(0, availableWidth - columnWidth - CONTROL_LABEL_MARGIN),
            height,
        };
    }

    /**
     * Rectangle of the label this control draws, in the layout's coordinate space.
     *
     * Must stay in sync with `_renderLabelAndGetValueLayout()`; the node renderer uses it to
     * paint the connector-drag highlight pill behind the label without knowing any control
     * type. Returns `null` when no text is drawn. The rect is the *text* rect, without pill
     * padding — expanding it into a pill is the caller's job.
     *
     * @param ctx - Canvas context used for measuring.
     * @param layout - Control layout rectangle.
     * @returns Label text rectangle, or `null` when nothing is drawn.
     */
    getCanvasLabelBounds(ctx: CanvasRenderingContext2D, layout: ControlRenderLayout): Rect | null {
        const { text, width, stacked } = this._resolveCanvasLabelMetrics(ctx, layout);

        if (!text || !Number.isFinite(width) || width <= 0) {
            return null;
        }

        return {
            x: layout.x,
            y: stacked ? layout.y : layout.y + layout.height / 2 - CONTROL_HEIGHT / 2,
            width,
            height: CONTROL_HEIGHT,
        };
    }

    _isStackedLayout(): boolean {
        return this.controlData.layout === 'stacked';
    }

    /**
     * Get the localized label for this control.
     *
     * Uses the shared label rule (`resolveControlLabelText()`) so that rendering, the
     * node-wide label column and hit-testing always agree on the text. A localized map
     * without the current locale and without `en` falls back to its first entry instead
     * of rendering nothing.
     */
    _getLocalizedLabel(): string {
        return resolveControlLabelText(this.controlData, this._getCurrentLanguage());
    }

    /**
     * Get current language code for i18n.
     */
    _getCurrentLanguage(): string {
        if (this.nodeUi && typeof this.nodeUi.getCurrentLocale === 'function') {
            const locale = this.nodeUi.getCurrentLocale();
            if (typeof locale === 'string' && locale.trim()) {
                return locale;
            }
        }
        if (this.nodeUi?._i18nService?.currentLocale) {
            return this.nodeUi._i18nService.currentLocale;
        }
        return 'en';
    }

    /**
     * Get layout requirements for this control.
     * Used by NodeUi to calculate node dimensions and control positioning.
     */
    getLayout(): { height: number; width: number; labelWidth: number } {
        return {
            height: 24,
            width: 150,
            labelWidth: 80,
        };
    }

    /**
     * Create a DOM editor overlay for this control.
     * Handles positioning, styling, and event management.
     */
    createEditor(value: ControlValue, screenPoint: EditorScreenPoint): HTMLElement | null {
        const editor = this._createEditor(value, screenPoint);
        if (!editor) return null;

        editor.style.position = 'absolute';
        editor.style.left = `${screenPoint.x}px`;
        editor.style.top = `${screenPoint.y}px`;
        editor.style.zIndex = '1000';

        const editorWidth = screenPoint.width || this.getEditorWidth();
        editor.style.width = `${editorWidth}px`;

        const editorHeight = this.getEditorHeight();
        if (editorHeight) {
            editor.style.height = `${editorHeight}px`;
        }

        editor.addEventListener('blur', () => {
            (
                this as unknown as NodeControlUi & {
                    _onEditorBlur: (editorElement: HTMLElement) => void;
                }
            )._onEditorBlur(editor);
        });
        editor.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                (
                    this as unknown as NodeControlUi & {
                        _onEditorCommit: (editorElement: HTMLElement) => void;
                    }
                )._onEditorCommit(editor);
            } else if (e.key === 'Escape') {
                (
                    this as unknown as NodeControlUi & {
                        _onEditorCancel: (editorElement: HTMLElement) => void;
                    }
                )._onEditorCancel(editor);
            }
        });

        return editor;
    }

    /**
     * Create the editor element. Override in subclasses.
     * Subclasses should implement this to create type-specific editor inputs.
     * @param _value - Current control value
     * @param _screenPoint - Screen position for the editor
     */
    _createEditor(_value: ControlValue, _screenPoint: EditorScreenPoint): HTMLElement | null {
        throw new Error('_createEditor(value, screenPoint) must be implemented by subclass');
    }

    /**
     * Get preferred editor width in pixels.
     * Subclasses can override for custom editor widths.
     */
    getEditorWidth(): number {
        return 180;
    }

    /**
     * Get preferred editor height in pixels.
     * Optional: return null to use default height.
     * Subclasses can override for custom editor heights.
     */
    getEditorHeight(): number | null {
        return null;
    }

    /**
     * Test if a point hits this control's interactive area.
     * Used by NodeUi for click detection and editor activation.
     */
    hitTest(point: ControlPoint): HitTestResult {
        void point;
        return { hit: true };
    }

    /**
     * Apply standard styling to editor elements.
     * Override in subclasses for custom styling.
     */
    _styleEditor(element: HTMLElement, width?: number): void {
        element.style.fontSize = '12px';
        element.style.padding = '4px 8px';
        element.style.border = `1px solid ${CONTROL_DOM_EDITOR_BORDER_COLOR}`;
        element.style.borderRadius = '4px';
        element.style.backgroundColor = CONTROL_DOM_EDITOR_BACKGROUND_COLOR;
        element.style.color = CONTROL_DOM_EDITOR_TEXT_COLOR;
        element.style.outline = 'none';

        if (width !== undefined) {
            element.style.width = `${width}px`;
        }
    }

    /**
     * Update the UI to reflect current data value.
     * Should be called when controlData.value changes externally.
     */
    update(): void {
        if (this.inputElement && this.controlData.value !== undefined) {
            this.setValue(this.controlData.value);
        }
    }

    /**
     * Get the current control value from NodeData.controlValues.
     * Falls back to controlData.default if value is undefined.
     */
    getValue(): ControlValue {
        const value = this.nodeData.controlValues[this.controlData.id];
        return value !== undefined ? value : this.controlData.default;
    }

    /**
     * Set the control value in NodeData.controlValues and update UI.
     * Updates the source of truth and the DOM input element.
     */
    setValue(value: ControlValue): void {
        this.nodeData.controlValues[this.controlData.id] = value;

        if (this.inputElement) {
            this._updateDOMInputValue(value);
        }
    }

    /**
     * Update input element value.
     * Subclasses should override this for type-specific behavior.
     */
    _updateDOMInputValue(value: ControlValue): void {
        if (!this.inputElement) {
            return;
        }

        if (this.inputElement.type === 'checkbox') {
            this.inputElement.checked = Boolean(value);
        } else {
            this.inputElement.value = value;
        }
    }

    /**
     * Notify parent NodeUi that this control's value changed.
     * Updates NodeData.controlValues and notifies parent for graph synchronization.
     */
    _notifyChange(newValue: ControlValue): void {
        const oldValue = this.nodeData.controlValues[this.controlData.id];

        this.nodeData.controlValues[this.controlData.id] = newValue;

        if (this.nodeUi && typeof this.nodeUi.onControlChanged === 'function') {
            this.nodeUi.onControlChanged(this.controlData.id, newValue, oldValue);
        }
    }

    /**
     * Render control for DOM with label and semi-transparent background.
     * Subclasses should override to provide the control input element.
     * Override _renderDOMControl() instead of this method.
     */
    renderDOM(container?: HTMLElement): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'node-control-ui__wrapper';
        const isStacked = this._isStackedLayout();
        wrapper.style.display = 'inline-flex';
        wrapper.style.flexDirection = isStacked ? 'column' : 'row';
        wrapper.style.alignItems = isStacked ? 'stretch' : 'center';
        wrapper.style.gap = '8px';
        wrapper.style.padding = '6px 10px';
        wrapper.style.backgroundColor = CONTROL_DOM_WRAPPER_BACKGROUND_COLOR;
        wrapper.style.borderRadius = '4px';
        wrapper.style.border = 'none';

        const label = this._createDOMLabel();
        label.style.fontSize = '12px';
        label.style.color = CONTROL_DOM_LABEL_TEXT_COLOR;
        label.style.fontWeight = '600';
        label.style.whiteSpace = 'nowrap';
        label.style.flexShrink = '0';
        if (isStacked) {
            label.style.alignSelf = 'flex-start';
        }
        wrapper.appendChild(label);

        const controlElement = this._renderDOMControl();
        if (controlElement) {
            controlElement.style.flexShrink = '0';
            if (isStacked) {
                controlElement.style.width = '100%';
            }
            wrapper.appendChild(controlElement);
        }

        this.domElement = wrapper;

        if (container) {
            container.appendChild(wrapper);
        }

        return wrapper;
    }

    /**
     * Render the control input element for DOM.
     * Subclasses must override this to return their control element.
     */
    _renderDOMControl(): HTMLElement | null {
        throw new Error('_renderDOMControl() must be implemented by subclass');
    }

    /**
     * Create and return DOM label element.
     * Handles i18n objects with fallback to English.
     * Only used for DOM rendering, not for canvas.
     */
    _createDOMLabel(): HTMLLabelElement {
        const label = document.createElement('label');
        label.className = 'node-control-ui__label';

        let displayLabel: string;
        if (typeof this.controlData.label === 'string') {
            displayLabel = this.controlData.label;
        } else if (typeof this.controlData.label === 'object') {
            displayLabel =
                this.controlData.label[this._getCurrentLanguage()] ||
                this.controlData.label.en ||
                Object.values(this.controlData.label)[0] ||
                this.controlData.id;
        } else {
            displayLabel = this.controlData.id;
        }

        label.textContent = displayLabel;
        label.htmlFor = this._getInputId();

        return label;
    }

    /**
     * Generate unique input ID for label association.
     */
    _getInputId(): string {
        return `control-${this.controlData.id}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Clean up event listeners and DOM.
     */
    destroy(): void {
        if (this.inputElement && this._changeHandler) {
            this.inputElement.removeEventListener('change', this._changeHandler);
            this.inputElement.removeEventListener('input', this._changeHandler);
        }

        if (this.domElement) {
            this.domElement.remove();
            this.domElement = null;
        }

        this.labelElement = null;
        this.inputElement = null;
        this._changeHandler = null;
    }
}
