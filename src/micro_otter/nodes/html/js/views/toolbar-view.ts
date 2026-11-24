// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;
type ToolbarBaseOptions = Omit<ViewBaseOptions, 'title' | 'icon' | 'id' | 'i18nService' | 'logger'>;
type ViewBaseSerialized = ReturnType<ViewBase['serialize']>;

export type ToolbarLayoutMode = 'scroll' | 'multi-line';
export type ToolbarButtonIcon = string | HTMLElement;
export type ToolbarButtonClickEvent = MouseEvent;
export type ToolbarButtonAction = (event: ToolbarButtonClickEvent) => void;

export interface ToolbarButtonConfig {
    icon: ToolbarButtonIcon;
    label?: string;
    onClick?: ToolbarButtonAction | null;
    className?: string;
    highlight?: boolean;
}

/**
 * A control that renders itself into a host element.
 *
 * Implemented by the `custom-runtime-controls` classes, which expose
 * `render(container)` and an optional `destroy()`.
 */
export interface ToolbarControlLike {
    render(container: HTMLElement): void;
    destroy?(): void;
}

export interface ToolbarControlOptions {
    className?: string;
}

export interface ToolbarViewOptions extends ToolbarBaseOptions {
    title?: string;
    icon?: string | null;
    height?: number;
    layoutMode?: ToolbarLayoutMode | string;
    id?: string | null;
    i18nService?: unknown;
    logger?: unknown;
}

export interface ToolbarViewSerialized extends ViewBaseSerialized {
    type: 'ToolbarView';
    height: number | null;
    layoutMode: ToolbarLayoutMode;
}

export interface ToolbarViewDeserializeData {
    title?: string;
    icon?: string | null;
    height?: number;
    layoutMode?: ToolbarLayoutMode | string;
    id?: string | null;
}

export interface ToolbarViewDeserializeContext {
    i18nService?: unknown;
    logger?: unknown;
}

interface ToolbarButtonControl {
    type: 'button';
    icon: ToolbarButtonIcon;
    label: string;
    onClick?: ToolbarButtonAction | null;
    className: string;
    highlight: boolean;
    element: HTMLButtonElement | null;
}

interface ToolbarSeparatorControl {
    type: 'separator';
    element: HTMLDivElement | null;
}

interface ToolbarElementControl {
    type: 'element';
    element: HTMLElement;
    destroy?: (() => void) | null;
}

type ToolbarControl = ToolbarButtonControl | ToolbarSeparatorControl | ToolbarElementControl;
type ToolbarGroupedControl = ToolbarButtonControl | ToolbarElementControl;

/**
 * ToolbarView - A generic container for buttons, controls, and status indicators.
 *
 * Architecture Integration:
 * - Extends ViewBase for seamless integration with view system
 * - Provides flexible horizontal layout for controls
 * - Can be used in SplitView, TabbedView, or standalone
 * - Supports dynamic control addition/removal
 * - Theme-integrated styling
 * - Fixed single-row height (minHeight = maxHeight for split view constraint)
 *
 * Features:
 * - Horizontal button/control layout with gaps
 * - Borderless, flat buttons with hover states
 * - Progress indicator support
 * - Status messages
 * - Custom control insertion via slots
 * - Self-rendering control hosting via `addControl()`
 * - Full i18n support
 *
 * Usage:
 * ```javascript
 * const toolbar = new ToolbarView({
 *     title: 'Tools'
 * });
 * toolbar.attachTo(container);
 * toolbar.addButton({ icon: 'save', label: 'Save', onClick: () => save() });
 * toolbar.showProgress(50);
 * ```
 */
export class ToolbarView extends ViewBase {
    #controls: ToolbarControl[] = [];
    #controlsContainer: HTMLDivElement | null = null;
    #progressBar: HTMLProgressElement | null = null;
    #statusMessage: HTMLDivElement | null = null;
    #wrapper: HTMLDivElement | null = null;
    #layoutMode: ToolbarLayoutMode = 'scroll';
    #baseHeight = 36;
    #appliedFixedHeight: number | null = null;

    constructor({
        title = 'Toolbar',
        icon = null,
        height = 36,
        layoutMode = 'multi-line',
        id = null,
        i18nService = null,
        logger = null,
        ...rest
    }: ToolbarViewOptions = {}) {
        super({
            title,
            icon,
            id,
            i18nService: i18nService as ViewBaseOptions['i18nService'],
            logger: logger as ViewBaseOptions['logger'],
            ...(rest as ToolbarBaseOptions),
        });

        this.#baseHeight = height;
        this.setLayoutMode(layoutMode);
    }

    get layoutMode(): ToolbarLayoutMode {
        return this.#layoutMode;
    }

    setLayoutMode(mode: string): void {
        const normalizedMode = this.#normalizeLayoutMode(mode);
        this.#layoutMode = normalizedMode;

        this.#applyFixedHeight(this.#baseHeight);

        this.#applyLayoutModeClasses();
        this.#renderControls();
        this.#updateMeasuredHeight();
    }

    render(_container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'view-toolbar';
        wrapper.style.minHeight = `${this._minHeight}px`;
        wrapper.style.maxHeight = Number.isFinite(this._maxHeight) ? `${this._maxHeight}px` : 'none';
        this.#wrapper = wrapper;

        this.#controlsContainer = document.createElement('div');
        this.#controlsContainer.className = 'view-toolbar__controls';
        wrapper.appendChild(this.#controlsContainer);

        this.#applyLayoutModeClasses();

        this.#progressBar = document.createElement('progress');
        this.#progressBar.className = 'view-toolbar__progress';
        this.#progressBar.max = 100;
        this.#progressBar.value = 0;
        this.#progressBar.style.display = 'none';
        wrapper.appendChild(this.#progressBar);

        this.#statusMessage = document.createElement('div');
        this.#statusMessage.className = 'view-toolbar__status';
        this.#statusMessage.style.display = 'none';
        wrapper.appendChild(this.#statusMessage);

        this.#renderControls();

        this.mountContent(wrapper);
        this.#updateMeasuredHeight();
        this._log('render', { controlCount: this.#controls.length, height: this._minHeight });
    }

    onInitialSize(): void {
        this.#updateMeasuredHeight();
    }

    onResized(): void {
        this.#updateMeasuredHeight();
    }

    addButton({
        icon,
        label = '',
        onClick,
        className = '',
        highlight = false,
    }: ToolbarButtonConfig): ToolbarButtonControl {
        const control: ToolbarButtonControl = {
            type: 'button',
            icon,
            label,
            onClick,
            className,
            highlight,
            element: null,
        };

        this.#controls.push(control);

        return control;
    }

    addSeparator(): ToolbarSeparatorControl {
        const control: ToolbarSeparatorControl = {
            type: 'separator',
            element: null,
        };

        this.#controls.push(control);

        return control;
    }

    addElement(element: HTMLElement): HTMLElement {
        const control: ToolbarElementControl = {
            type: 'element',
            element,
        };

        this.#controls.push(control);

        if (this.#controlsContainer) {
            this.#controlsContainer.appendChild(element);
        }

        return element;
    }

    /**
     * Add a self-rendering control to the toolbar.
     *
     * The control renders itself into a wrapper element, so callers do not have to
     * hand-build the host `<div>` that `addElement()` expects.
     *
     * @param {object} control - Control with a `render(container)` method.
     * @param {object} [options] - Host options.
     * @param {string} [options.className='view-toolbar__control'] - Class of the wrapper element.
     * @returns {HTMLDivElement} The wrapper element the control rendered into.
     */
    addControl(
        control: ToolbarControlLike,
        { className = 'view-toolbar__control' }: ToolbarControlOptions = {}
    ): HTMLDivElement {
        const host = document.createElement('div');
        host.className = className;
        control.render(host);
        this.addElement(host);

        // addElement() stores a fresh record; attach teardown to the stored copy.
        const stored = this.#controls[this.#controls.length - 1];
        if (stored && stored.type === 'element') {
            stored.destroy =
                typeof control.destroy === 'function' ? () => control.destroy?.() : null;
        }

        return host;
    }

    clearControls(): void {
        for (const control of this.#controls) {
            if (control.type === 'element') {
                control.destroy?.();
            }
        }

        this.#controls = [];
        if (this.#controlsContainer) {
            this.#controlsContainer.replaceChildren();
        }
    }

    renderControls(): void {
        this.#renderControls();
    }

    showProgress(value: number | null | undefined): void {
        if (!this.#progressBar) {
            return;
        }

        if (value === null || value === undefined) {
            this.#progressBar.style.display = 'none';
        } else {
            this.#progressBar.value = Math.max(0, Math.min(100, value));
            this.#progressBar.style.display = 'block';
        }
    }

    showStatus(message: string | null | undefined): void {
        if (!this.#statusMessage) {
            return;
        }

        if (message === null || message === undefined || message === '') {
            this.#statusMessage.style.display = 'none';
        } else {
            this.#statusMessage.textContent = message;
            this.#statusMessage.style.display = 'block';
        }
    }

    #renderControls(): void {
        if (!this.#controlsContainer) {
            return;
        }

        this.#controlsContainer.replaceChildren();

        if (this.#layoutMode === 'multi-line') {
            this.#renderGroupedControls();
            return;
        }

        for (const control of this.#controls) {
            const controlElement = this.#createControlElement(control);
            if (controlElement) {
                this.#controlsContainer.appendChild(controlElement);
            }
        }

        this.#updateMeasuredHeight();
    }

    #renderGroupedControls(): void {
        const groups: ToolbarGroupedControl[][] = [];
        let currentGroup: ToolbarGroupedControl[] = [];

        for (const control of this.#controls) {
            if (control.type === 'separator') {
                if (currentGroup.length > 0) {
                    groups.push(currentGroup);
                    currentGroup = [];
                }
                continue;
            }
            currentGroup.push(control);
        }

        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        for (const group of groups) {
            const groupElement = document.createElement('div');
            groupElement.className = 'view-toolbar__group';

            for (const control of group) {
                const controlElement = this.#createControlElement(control);
                if (controlElement) {
                    groupElement.appendChild(controlElement);
                }
            }

            if (groupElement.childElementCount > 0) {
                this.#controlsContainer.appendChild(groupElement);
            }
        }

        this.#updateMeasuredHeight();
    }

    #applyFixedHeight(height: number): void {
        const normalized = Math.max(0, Math.ceil(height || 0));
        if (this.#appliedFixedHeight === normalized) {
            return;
        }

        this.#appliedFixedHeight = normalized;
        this.setHeightConstraints({ minHeight: normalized, maxHeight: normalized });

        if (this.#wrapper) {
            this.#wrapper.style.minHeight = `${normalized}px`;
            this.#wrapper.style.maxHeight = `${normalized}px`;
        }
    }

    #updateMeasuredHeight(): void {
        if (this.#layoutMode !== 'multi-line') {
            this.#applyFixedHeight(this.#baseHeight);
            return;
        }

        if (!this.#wrapper) {
            this.#applyFixedHeight(this.#baseHeight);
            return;
        }

        const measuredHeight = Math.max(this.#baseHeight, Math.ceil(this.#wrapper.scrollHeight || 0));
        this.#applyFixedHeight(measuredHeight);
    }

    #createControlElement(control: ToolbarControl): HTMLElement | null {
        if (control.type === 'button') {
            const button = this.#createButton(control);
            control.element = button;
            return button;
        }

        if (control.type === 'separator') {
            const separator = this.#createSeparator();
            control.element = separator;
            return separator;
        }

        if (control.type === 'element' && control.element) {
            return control.element;
        }

        return null;
    }

    #applyLayoutModeClasses(): void {
        if (this.#wrapper) {
            this.#wrapper.classList.toggle('view-toolbar--scroll', this.#layoutMode === 'scroll');
            this.#wrapper.classList.toggle('view-toolbar--multi-line', this.#layoutMode === 'multi-line');
        }

        if (this.#controlsContainer) {
            this.#controlsContainer.classList.toggle(
                'view-toolbar__controls--scroll',
                this.#layoutMode === 'scroll'
            );
            this.#controlsContainer.classList.toggle(
                'view-toolbar__controls--multi-line',
                this.#layoutMode === 'multi-line'
            );
        }
    }

    #normalizeLayoutMode(mode: unknown): ToolbarLayoutMode {
        if (mode === 'multi-line') {
            return 'multi-line';
        }
        return 'scroll';
    }

    #createButton(config: ToolbarButtonControl): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = `view-toolbar__btn ${config.className}`;
        button.title = config.label || '';
        button.setAttribute('aria-label', config.label || 'Button');

        if (config.highlight) {
            button.classList.add('view-toolbar__btn--highlight');
        }

        const iconContainer = document.createElement('span');
        iconContainer.className = 'view-toolbar__btn-icon';

        if (typeof config.icon === 'string') {
            const img = document.createElement('img');
            img.src = config.icon;
            img.alt = config.label || 'Icon';
            iconContainer.appendChild(img);
        } else if (config.icon instanceof HTMLElement) {
            iconContainer.appendChild(config.icon);
        }

        button.appendChild(iconContainer);

        if (typeof config.onClick === 'function') {
            button.addEventListener('click', (event: MouseEvent) => {
                event.preventDefault();
                config.onClick?.(event);
            });
        }

        return button;
    }

    #createSeparator(): HTMLDivElement {
        const separator = document.createElement('div');
        separator.className = 'view-toolbar__separator';
        separator.setAttribute('role', 'separator');
        separator.setAttribute('aria-orientation', 'vertical');
        return separator;
    }

    override serialize(): ToolbarViewSerialized {
        return {
            ...super.serialize(),
            type: 'ToolbarView',
            height: this._minHeight,
            layoutMode: this.#layoutMode,
        };
    }

    static deserialize(
        data: ToolbarViewDeserializeData = {},
        createChild: unknown = null,
        context: ToolbarViewDeserializeContext = {}
    ): ToolbarView {
        void createChild;

        const {
            title = 'Toolbar',
            icon = null,
            height = 36,
            layoutMode = 'multi-line',
            id = null,
        } = data;
        const { i18nService = null, logger = null } = context;

        return new ToolbarView({
            title,
            icon,
            height,
            layoutMode,
            id,
            i18nService,
            logger,
        });
    }
}
