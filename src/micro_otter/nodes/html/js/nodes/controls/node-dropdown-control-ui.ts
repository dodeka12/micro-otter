// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * NodeDropdownControlUi: Select dropdown control with options.
 *
 * Features:
 * - Options from node type definition
 * - Support for i18n option labels
 * - Dynamic control/input visibility via affectsInputs/affectsControls
 * - Immediate value updates
 */

import NodeControlUi from './node-control-ui.js';
import {
    CONTROL_CANVAS_VALUE_BACKGROUND_COLOR,
    CONTROL_CANVAS_VALUE_BORDER_COLOR,
    CONTROL_CANVAS_VALUE_TEXT_COLOR,
    CONTROL_DOM_EDITOR_BACKGROUND_COLOR,
    CONTROL_DOM_EDITOR_BORDER_COLOR,
    CONTROL_DOM_EDITOR_TEXT_COLOR,
    CONTROL_ACCENT_SOFT_BACKGROUND_COLOR,
} from './control-ui-colors.js';

const DEFAULT_MAX_VISIBLE_OPTIONS = 8;
const DROPDOWN_OPTION_ROW_HEIGHT = 26;
const DROPDOWN_OPTION_HOVER_BACKGROUND = 'rgba(255, 255, 255, 0.08)';
const DROPDOWN_OPTION_SELECTED_BACKGROUND = CONTROL_ACCENT_SOFT_BACKGROUND_COLOR;

export interface NodeDropdownControlLocalizedLabel {
    [locale: string]: string;
}

export type NodeDropdownOptionLabel = string | NodeDropdownControlLocalizedLabel;

export interface NodeDropdownOption {
    value: string | number | boolean;
    label?: NodeDropdownOptionLabel;
    /**
     * Text the trigger/canvas shows instead of `label`.
     *
     * Set by a dynamic option source for the "create new…" sentinel, so the row echoes what
     * the user typed into the companion control. The menu still renders `label`.
     */
    displayLabel?: NodeDropdownOptionLabel;
    activeInputs?: string[];
    activeOutputs?: string[];
    activeControls?: string[];
    inputTypes?: Record<string, unknown>;
    outputTypes?: Record<string, unknown>;
}

export interface NodeDropdownControlPayload {
    id: string;
    type: string;
    label?: string | NodeDropdownControlLocalizedLabel;
    default?: unknown;
    value?: unknown;
    options?: NodeDropdownOption[];
    disabled?: boolean;
    maxVisibleItems?: number;
    dynamicOptions?: unknown;
    /** Toggle several options instead of picking one (`string[]` value). */
    multiSelect?: boolean;
    affectsInputs?: boolean;
    affectsOutputs?: boolean;
    affectsControls?: boolean;
    constraints?: Record<string, unknown>;
}

export interface NodeDropdownControlNodeState {
    controlValues: Record<string, unknown>;
}

export interface NodeDropdownControlVisibilityChangePayload {
    controlId: string;
    activeInputs: string[];
    activeControls: string[];
}

export interface NodeDropdownControlNodeUiLike {
    _i18nService?: {
        currentLocale?: string;
    };
    hideEditor?: () => void;
    onControlChanged?: (controlId: string, newValue: unknown, oldValue: unknown) => void;
    onControlVisibilityChanged?: (payload: NodeDropdownControlVisibilityChangePayload) => void;
}

export interface NodeDropdownControlLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Node-wide label column width (see `ControlRenderLayout`). */
    labelWidth?: number;
}

export interface NodeDropdownControlDimensions {
    height: number;
    width: number;
    labelWidth: number;
}

export type NodeDropdownSelectedValue = unknown;

export default class NodeDropdownControlUi extends NodeControlUi {
    declare controlData: NodeDropdownControlPayload;
    declare nodeData: NodeDropdownControlNodeState;
    declare nodeUi: NodeDropdownControlNodeUiLike;
    declare inputElement: HTMLButtonElement | null;
    declare _changeHandler: ((event: Event) => void) | null;

    _options: NodeDropdownOption[];
    _multiSelect: boolean;
    _affectsInputs: boolean;
    _affectsOutputs: boolean;
    _affectsControls: boolean;
    _keydownHandler: ((event: KeyboardEvent) => void) | null;
    _triggerElement: HTMLButtonElement | null;
    _menuElement: HTMLDivElement | null;
    _triggerClickHandler: ((event: Event) => void) | null;
    _outsideMouseDownHandler: ((event: Event) => void) | null;
    _autoOpenTimeoutId: ReturnType<typeof setTimeout> | null;

    declare getValue: () => unknown;
    declare _notifyChange: (newValue: unknown) => void;
    declare _renderLabelAndGetValueLayout: (
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        availableWidth: number,
        height: number,
        labelWidth?: number
    ) => NodeDropdownControlLayout;
    declare _styleEditor: (element: HTMLElement, width?: number) => void;
    declare _getInputId: () => string;
    declare _getCurrentLanguage: () => string;

    /**
     * Create a new NodeDropdownControlUi instance.
     *
     * @param controlData - Control data with dropdown options
     * @param nodeData - NodeData instance (source of truth)
     * @param nodeUi - Parent NodeUi instance
     * @param options - Additional options
     */
    constructor(
        controlData: NodeDropdownControlPayload,
        nodeData: NodeDropdownControlNodeState,
        nodeUi: NodeDropdownControlNodeUiLike,
        options: Record<string, unknown> = {}
    ) {
        super(controlData, nodeData, nodeUi, options);

        this._options = controlData.options || [];
        this._multiSelect =
            Boolean(controlData.multiSelect) || controlData.type === 'multi-dropdown';
        this._affectsInputs = Boolean(controlData.affectsInputs);
        this._affectsOutputs = Boolean(controlData.affectsOutputs);
        this._affectsControls = Boolean(controlData.affectsControls);
        this._keydownHandler = null;
        this._triggerElement = null;
        this._menuElement = null;
        this._triggerClickHandler = null;
        this._outsideMouseDownHandler = null;
        this._autoOpenTimeoutId = null;
        if (this._multiSelect) {
            // Toggling one flag must not close the editor: a multi-select is a set of choices.
            this.closeOnChange = false;
        }
    }

    /**
     * Render control on canvas.
     *
     * @param ctx - Canvas context
     * @param layout - Layout information
     */
    renderCanvas(ctx: CanvasRenderingContext2D, layout: NodeDropdownControlLayout): void {
        const { x, y, width, height } = layout;
        const optionLabel = this._displayLabel();

        // Render label and get the layout for the value display area
        const valueLayout = this._renderLabelAndGetValueLayout(
            ctx,
            x,
            y,
            width,
            height,
            layout.labelWidth
        );
        const disabled = Boolean(this.controlData.disabled);

        // Draw background
        ctx.fillStyle = disabled ? 'rgba(30, 36, 48, 0.4)' : CONTROL_CANVAS_VALUE_BACKGROUND_COLOR;
        ctx.fillRect(valueLayout.x, valueLayout.y, valueLayout.width, valueLayout.height);

        // Draw border
        ctx.strokeStyle = disabled ? 'rgba(90, 100, 120, 0.5)' : CONTROL_CANVAS_VALUE_BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(valueLayout.x, valueLayout.y, valueLayout.width, valueLayout.height);

        // Draw dropdown arrow
        ctx.fillStyle = disabled ? 'rgba(229, 234, 243, 0.35)' : '#e5eaf3';
        ctx.beginPath();
        ctx.moveTo(
            valueLayout.x + valueLayout.width - 14,
            valueLayout.y + valueLayout.height / 2 - 3
        );
        ctx.lineTo(
            valueLayout.x + valueLayout.width - 8,
            valueLayout.y + valueLayout.height / 2 + 3
        );
        ctx.lineTo(
            valueLayout.x + valueLayout.width - 2,
            valueLayout.y + valueLayout.height / 2 - 3
        );
        ctx.closePath();
        ctx.fill();

        // Draw selected label (truncate if too long)
        ctx.fillStyle = disabled ? 'rgba(229, 234, 243, 0.45)' : CONTROL_CANVAS_VALUE_TEXT_COLOR;
        ctx.font =
            '500 12px system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Measure and truncate text if needed
        const maxTextWidth = valueLayout.width - 24; // Leave space for arrow
        let displayText = optionLabel;
        if (ctx.measureText(optionLabel).width > maxTextWidth) {
            // Truncate with ellipsis
            for (let i = optionLabel.length - 1; i > 0; i--) {
                displayText = optionLabel.substring(0, i) + '...';
                if (ctx.measureText(displayText).width <= maxTextWidth) {
                    break;
                }
            }
        }

        ctx.fillText(displayText, valueLayout.x + 8, valueLayout.y + valueLayout.height / 2);
    }

    /**
     * Get layout requirements for this control.
     */
    getLayout(): NodeDropdownControlDimensions {
        // Calculate width based on widest option
        const widestOption = this._getWidestOption();
        const width = this._measureOptionWidth(widestOption) + 32; // Add space for arrow and padding

        return {
            height: 18,
            width: Math.min(Math.max(width, 80), 260),
            labelWidth: 80,
        };
    }

    /**
     * Render control for DOM with label and background.
     *
     * @param container - Optional container to attach to
     */
    renderDOM(container?: HTMLElement): HTMLElement {
        return super.renderDOM(container);
    }

    /**
     * Create the select element for DOM rendering.
     */
    _renderDOMControl(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'node-control-ui__dropdown';
        container.style.position = 'relative';
        container.style.display = 'inline-block';
        container.style.width = '100%';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'node-control-ui__dropdown-trigger';
        trigger.id = this._getInputId();
        this._styleEditor(trigger);
        trigger.style.cursor = this.controlData.disabled ? 'not-allowed' : 'pointer';
        trigger.style.display = 'flex';
        trigger.style.alignItems = 'center';
        trigger.style.justifyContent = 'space-between';
        trigger.style.gap = '8px';
        trigger.style.width = '100%';
        if (this.controlData.disabled) {
            trigger.disabled = true;
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'node-control-ui__dropdown-trigger-label';
        labelSpan.textContent = this._currentLabel();
        trigger.appendChild(labelSpan);

        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'node-control-ui__dropdown-trigger-arrow';
        arrowSpan.textContent = '\u25BE';
        arrowSpan.style.fontSize = '10px';
        trigger.appendChild(arrowSpan);

        container.appendChild(trigger);

        const menu = this._buildMenuElement();
        container.appendChild(menu);

        this._triggerElement = trigger;
        this._menuElement = menu;
        this.inputElement = trigger;

        this._triggerClickHandler = () => {
            if (this.controlData.disabled) {
                return;
            }
            if (menu.style.display === 'block') {
                this._closeMenu();
            } else {
                this._openMenu();
            }
        };
        trigger.addEventListener('click', this._triggerClickHandler);

        this._keydownHandler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                this._closeMenu();
                // Small delay to keep behaviour consistent with the previous native select.
                setTimeout(() => this._requestClose(), 10);
            }
        };
        trigger.addEventListener('keydown', this._keydownHandler);

        // Remove any stale outside handler from a previous render before
        // assigning a new one (the handler is recreated per editor open).
        this._detachOutsideMouseDownHandler();

        this._outsideMouseDownHandler = (event: Event) => {
            const target = event.target as Node | null;
            if (target && !container.contains(target)) {
                this._closeMenu();
            }
        };

        // Open the menu immediately so options are visible when the editor appears.
        // Use a timeout to ensure the element is in the DOM first.
        this._autoOpenTimeoutId = setTimeout(() => {
            this._autoOpenTimeoutId = null;
            if (!this.controlData.disabled) {
                this._openMenu();
            }
        }, 10);

        return container;
    }

    /**
     * Extract localized label from option label (i18n support).
     *
     * @param label - Label string or i18n object
     */
    _extractOptionLabel(label: NodeDropdownOptionLabel | undefined): string {
        if (typeof label === 'string') {
            return label;
        } else if (typeof label === 'object' && label !== null) {
            const lang = this._getCurrentLanguage();
            return label[lang] || label.en || Object.values(label)[0] || '';
        }
        return '';
    }

    /**
     * Get widest option for layout calculation.
     */
    _getWidestOption(): NodeDropdownOption | null {
        if (this._options.length === 0) return null;

        let maxWidth = 0;
        let widest = this._options[0];

        this._options.forEach((option) => {
            const label = this._extractOptionLabel(option.label);
            const width = this._measureTextWidth(label);
            if (width > maxWidth) {
                maxWidth = width;
                widest = option;
            }
        });

        return widest;
    }

    /**
     * Measure option label width.
     *
     * @param option - Option object
     */
    _measureOptionWidth(option: NodeDropdownOption | null): number {
        if (!option) return 80;
        const label = this._extractOptionLabel(option.label);
        return this._measureTextWidth(label);
    }

    /**
     * Measure text width using canvas measurement.
     *
     * @param text - Text to measure
     */
    _measureTextWidth(text: string): number {
        // Defensive: return reasonable default if document unavailable (e.g., in tests)
        if (typeof document === 'undefined') {
            return text.length * 7; // Approximate 7px per character
        }

        // Create temporary canvas for measurement
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // If getContext returns null (e.g., jsdom without canvas package), fallback
        if (!ctx) {
            return text.length * 7; // Approximate 7px per character
        }

        ctx.font =
            '500 12px system-ui, -apple-system, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';
        return ctx.measureText(text).width;
    }

    /**
     * Build the popup menu element with a scrollable option list.
     */
    _buildMenuElement(): HTMLDivElement {
        const menu = document.createElement('div');
        menu.className = 'node-control-ui__dropdown-menu';
        menu.setAttribute('role', 'listbox');
        menu.style.display = 'none';
        menu.style.position = 'absolute';
        menu.style.top = '100%';
        menu.style.left = '0';
        menu.style.minWidth = '100%';
        menu.style.zIndex = '1002';
        menu.style.marginTop = '2px';
        menu.style.padding = '2px 0';
        menu.style.backgroundColor = CONTROL_DOM_EDITOR_BACKGROUND_COLOR;
        menu.style.border = `1px solid ${CONTROL_DOM_EDITOR_BORDER_COLOR}`;
        menu.style.borderRadius = '4px';
        menu.style.overflowY = 'auto';
        menu.style.maxHeight = `${this._maxVisibleItems() * DROPDOWN_OPTION_ROW_HEIGHT}px`;

        this._options.forEach((option) => {
            const item = document.createElement('div');
            item.className = 'node-control-ui__dropdown-option';
            item.setAttribute('role', 'option');
            item.dataset.value = String(option.value);
            item.style.padding = '4px 8px';
            item.style.cursor = 'pointer';
            item.style.whiteSpace = 'nowrap';
            item.style.fontSize = '12px';
            item.style.color = CONTROL_DOM_EDITOR_TEXT_COLOR;

            const isSelected = this._isSelected(option.value);
            if (this._multiSelect) {
                // A tick instead of a highlight: several rows are selected at once.
                const tick = document.createElement('span');
                tick.className = 'node-control-ui__dropdown-option-tick';
                tick.textContent = isSelected ? '\u2611' : '\u2610';
                tick.style.marginRight = '6px';
                item.appendChild(tick);
            }

            const labelSpan = document.createElement('span');
            labelSpan.textContent =
                this._extractOptionLabel(option.label) || String(option.value);
            item.appendChild(labelSpan);

            if (isSelected) {
                item.setAttribute('aria-selected', 'true');
                item.style.backgroundColor = DROPDOWN_OPTION_SELECTED_BACKGROUND;
                item.style.fontWeight = '600';
            }

            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = DROPDOWN_OPTION_HOVER_BACKGROUND;
            });
            item.addEventListener('mouseleave', () => {
                // Re-read the selection: a toggle may have happened while hovering.
                item.style.backgroundColor = this._isSelected(option.value)
                    ? DROPDOWN_OPTION_SELECTED_BACKGROUND
                    : '';
            });

            item.addEventListener('click', () => {
                if (this._multiSelect) {
                    this._toggleOption(option.value);
                } else {
                    this._selectOption(option.value);
                }
            });

            menu.appendChild(item);
        });

        return menu;
    }

    /**
     * Resolve the number of options visible before a scrollbar appears.
     */
    _maxVisibleItems(): number {
        const configured = this.controlData.maxVisibleItems;
        if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
            return Math.floor(configured);
        }
        return DEFAULT_MAX_VISIBLE_OPTIONS;
    }

    /**
     * Return the label text for the currently selected value.
     */
    _currentLabel(): string {
        return this._displayLabel();
    }

    /**
     * Value(s) currently selected, as a list of option ids.
     */
    _selectedValues(): string[] {
        const value = this.getValue();
        if (Array.isArray(value)) {
            return value
                .map((entry) => String(entry ?? '').trim())
                .filter((entry) => entry.length > 0);
        }
        const single = String(value ?? '').trim();
        return single ? [single] : [];
    }

    /**
     * Whether one option value is currently selected (membership for a multi-select).
     *
     * @param value - Option value to test
     */
    _isSelected(value: unknown): boolean {
        if (this._multiSelect) {
            return this._selectedValues().includes(String(value));
        }
        const current = this.getValue();
        return String(value) === String(current ?? '');
    }

    /**
     * Text a single option renders: its `displayLabel` override first, then the label.
     *
     * @param option - Option to render
     */
    _optionDisplayText(option: NodeDropdownOption): string {
        return (
            this._extractOptionLabel(option.displayLabel) ||
            this._extractOptionLabel(option.label) ||
            String(option.value)
        );
    }

    /**
     * Label shown on the canvas and on the editor trigger.
     */
    _displayLabel(): string {
        if (!this._multiSelect) {
            const currentValue = this.getValue();
            const option = this._options.find((opt) => opt.value === currentValue);
            if (option) {
                return this._optionDisplayText(option);
            }
            return currentValue === undefined || currentValue === null
                ? ''
                : String(currentValue);
        }

        return this._selectedValues()
            .map((value) => {
                const option = this._options.find((opt) => String(opt.value) === value);
                return option ? this._optionDisplayText(option) : value;
            })
            .join(', ');
    }

    /**
     * Update the trigger label span to reflect the selected value.
     */
    _updateTriggerLabel(): void {
        const labelSpan = this._triggerElement?.querySelector(
            '.node-control-ui__dropdown-trigger-label'
        );
        if (labelSpan) {
            labelSpan.textContent = this._currentLabel();
        }
    }

    /**
     * Replace the option list of this (possibly live) instance.
     *
     * A dynamic option list can change while the instance stays open — the companion text of
     * a "create new…" sentinel is typed into, or another graph creates a variable. Re-creating
     * the control for that would drop the editor element and re-create every other control of
     * the node (the icon control reloads its glyph, which shows up as a flicker). Swapping the
     * list in place keeps the trigger, the open menu and the canvas layout intact.
     *
     * @param options - New option list, already resolved for this control.
     * @param disabled - New disabled state, when the resolution changed it.
     */
    setOptions(options: NodeDropdownOption[] | undefined, disabled?: boolean): void {
        // A resolver that is not registered returns the definition unchanged: keep the list the
        // control was built with instead of emptying it.
        if (Array.isArray(options)) {
            this._options = options;
            // A later `renderDOM()` builds the menu from `controlData.options`.
            this.controlData.options = this._options;
        }
        if (typeof disabled === 'boolean') {
            this.controlData.disabled = disabled;
        }
        this._updateTriggerLabel();
        this._refreshMenuElement();
    }

    /**
     * Rebuild the popup menu in place after the option list changed.
     *
     * The open/closed state is preserved: the user may be scrolling the list while it
     * refreshes, and a menu that vanishes mid-selection would look like a misclick.
     */
    _refreshMenuElement(): void {
        const menu = this._menuElement;
        const parent = menu?.parentNode;
        if (!menu || !parent) {
            return;
        }

        const next = this._buildMenuElement();
        next.style.display = menu.style.display;
        parent.replaceChild(next, menu);
        this._menuElement = next;
    }

    _openMenu(): void {
        if (this._menuElement) {
            this._menuElement.style.display = 'block';
        }
        this._attachOutsideMouseDownHandler();
    }

    _closeMenu(): void {
        this._clearAutoOpenTimeout();
        if (this._menuElement) {
            this._menuElement.style.display = 'none';
        }
        this._detachOutsideMouseDownHandler();
    }

    _attachOutsideMouseDownHandler(): void {
        if (!this._outsideMouseDownHandler) {
            return;
        }
        // Remove any existing registration first so the document only ever has
        // a single, current outside-click listener across open/close cycles.
        this._detachOutsideMouseDownHandler();
        document.addEventListener('mousedown', this._outsideMouseDownHandler);
    }

    _detachOutsideMouseDownHandler(): void {
        if (this._outsideMouseDownHandler) {
            document.removeEventListener('mousedown', this._outsideMouseDownHandler);
        }
    }

    _clearAutoOpenTimeout(): void {
        if (this._autoOpenTimeoutId !== null) {
            clearTimeout(this._autoOpenTimeoutId);
            this._autoOpenTimeoutId = null;
        }
    }

    _selectOption(value: unknown): void {
        if (this.controlData.disabled) {
            return;
        }

        this._closeMenu();

        const newValue = this._resolveOptionValue(String(value));
        this._notifyChange(newValue);

        if (this._affectsInputs || this._affectsOutputs || this._affectsControls) {
            this._notifyVisibilityChange(newValue);
        }
    }

    /**
     * Add or remove one option from a multi-select value; the menu stays open.
     *
     * @param value - Option value to toggle
     */
    _toggleOption(value: unknown): void {
        if (this.controlData.disabled) {
            return;
        }

        const target = String(value);
        const selected = this._selectedValues();
        const remaining = selected.filter((entry) => entry !== target);

        if (remaining.length === selected.length) {
            remaining.push(target);
        }

        this._notifyChange(remaining);
        this._updateTriggerLabel();
        this._refreshMenuSelection();
    }

    /**
     * Re-render the tick marks and highlights of an open menu after a toggle.
     */
    _refreshMenuSelection(): void {
        const menu = this._menuElement;
        if (!menu) {
            return;
        }

        Array.from(menu.querySelectorAll('.node-control-ui__dropdown-option')).forEach((entry) => {
            const item = entry as HTMLElement;
            const isSelected = this._isSelected(item.dataset.value ?? '');
            const tick = item.querySelector('.node-control-ui__dropdown-option-tick');

            if (tick) {
                tick.textContent = isSelected ? '\u2611' : '\u2610';
            }
            if (isSelected) {
                item.setAttribute('aria-selected', 'true');
            } else {
                item.removeAttribute('aria-selected');
            }
            item.style.backgroundColor = isSelected ? DROPDOWN_OPTION_SELECTED_BACKGROUND : '';
            item.style.fontWeight = isSelected ? '600' : '';
        });
    }

    /**
     * Notify parent NodeUi about visibility changes.
     *
     * @param selectedValue - Currently selected option value
     */
    _notifyVisibilityChange(selectedValue: NodeDropdownSelectedValue): void {
        // Find the selected option
        const option = this._options.find(
            (opt) => opt.value === selectedValue || String(opt.value) === String(selectedValue)
        );
        if (!option) return;

        // Get visibility lists
        const activeInputs = option.activeInputs || [];
        const activeControls = option.activeControls || [];

        // Notify parent if it has visibility handler
        if (this.nodeUi && typeof this.nodeUi.onControlVisibilityChanged === 'function') {
            this.nodeUi.onControlVisibilityChanged({
                controlId: this.controlData.id,
                activeInputs,
                activeControls,
            });
        }
    }

    /**
     * Update DOM input value.
     *
     * @param value - New value
     */
    _updateDOMInputValue(value: unknown): void {
        this._updateTriggerLabel();

        // Trigger visibility update
        if (this._affectsInputs || this._affectsOutputs || this._affectsControls) {
            this._notifyVisibilityChange(value);
        }
    }

    /**
     * Get currently selected option data.
     */
    getSelectedOption(): NodeDropdownOption | null {
        const currentValue = this.getValue();
        return (
            this._options.find(
                (opt) => opt.value === currentValue || String(opt.value) === String(currentValue)
            ) || null
        );
    }

    _resolveOptionValue(rawValue: string): string | number | boolean | null {
        const matchingOption = this._options.find((option) => String(option.value) === rawValue);
        return matchingOption
            ? (matchingOption.value as string | number | boolean | null)
            : rawValue;
    }

    /**
     * Clean up event listeners and DOM.
     */
    destroy(): void {
        this._clearAutoOpenTimeout();

        const trigger = this._triggerElement;
        if (trigger) {
            if (this._triggerClickHandler) {
                trigger.removeEventListener('click', this._triggerClickHandler);
            }
            if (this._keydownHandler) {
                trigger.removeEventListener('keydown', this._keydownHandler);
            }
        }

        if (this._outsideMouseDownHandler) {
            document.removeEventListener('mousedown', this._outsideMouseDownHandler);
        }

        if (this.domElement) {
            this.domElement.remove();
            this.domElement = null;
        }

        this.labelElement = null;
        this.inputElement = null;
        this._triggerElement = null;
        this._menuElement = null;
        this._triggerClickHandler = null;
        this._outsideMouseDownHandler = null;
        this._autoOpenTimeoutId = null;
        this._keydownHandler = null;
        this._changeHandler = null;
    }

    /**
     * Request the editor to close (for ESC key handling).
     * This tells the parent NodeUi to hide the editor.
     */
    _requestClose(): void {
        if (this.nodeUi && typeof this.nodeUi.hideEditor === 'function') {
            this.nodeUi.hideEditor();
        }
    }
}
