// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file StackView - Flexible vertical/horizontal layout container for views and elements.
 * @module views/stack-view
 */

import { ViewBase } from './view-base.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;

/** Supported stack directions. */
export type StackViewOrientation = 'vertical' | 'horizontal';

/** Alignment values accepted by the underlying flex container. */
export type StackViewAlignment =
    | 'stretch'
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'baseline'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';

/** Options for one item added to a {@link StackView}. */
export interface StackItemOptions {
    /** Stable identifier exposed as `data-item-id` on the item host. */
    itemId?: string | null;
    /** Grow the item to consume remaining space. */
    grow?: boolean;
    /** Fixed width (`number` is interpreted as pixels). */
    width?: string | number | null;
}

/** Options accepted by {@link StackView}. */
export interface StackViewOptions extends ViewBaseOptions {
    /** Stack direction; defaults to `vertical`. */
    orientation?: StackViewOrientation;
    /** Gap between items (`number` is interpreted as pixels). */
    gap?: string | number;
    /** Padding around the items (`number` is interpreted as pixels). */
    padding?: string | number;
    /** Cross-axis alignment; defaults to `stretch` (vertical) or `flex-start` (horizontal). */
    align?: StackViewAlignment;
    /** Main-axis justification. */
    justify?: StackViewAlignment;
    /** Wrap horizontal items; defaults to `false`. */
    wrap?: boolean;
    /** Fill the available height and shrink inside a flex parent. */
    fill?: boolean;
    /** Alternate a subtle background on direct item hosts. */
    striped?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: ViewBaseOptions['logger'];
    i18nService?: ViewBaseOptions['i18nService'];
}

/**
 * One child in a {@link StackView}.
 *
 * The item owns the host element so callers can hide or resize a child without
 * knowing whether it was supplied as a view or as a raw element.
 */
export class StackItem {
    /** Host element that wraps the child. */
    readonly element: HTMLDivElement;
    /** Child view, when the item was added through `addView`. */
    readonly view: ViewBase | null;
    /** Raw child element, when the item was added through `addElement`. */
    readonly content: HTMLElement | null;
    /** Stable caller-provided identifier. */
    readonly itemId: string | null;

    private _hidden: boolean;
    private _grow: boolean;
    private _width: string | null;

    /**
     * @param {object} options Item configuration.
     * @param {ViewBase|null} options.view Child view.
     * @param {HTMLElement|null} options.content Raw child element.
     * @param {string|null} options.itemId Stable identifier.
     * @param {boolean} options.grow Whether the item grows.
     * @param {string|null} options.width Fixed width, already normalized.
     */
    constructor({
        view = null,
        content = null,
        itemId = null,
        grow = false,
        width = null,
    }: {
        view?: ViewBase | null;
        content?: HTMLElement | null;
        itemId?: string | null;
        grow?: boolean;
        width?: string | null;
    }) {
        this.element = document.createElement('div');
        this.element.className = 'stack-view__item';
        this.view = view;
        this.content = content;
        this.itemId = itemId;
        this._hidden = false;
        this._grow = false;
        this._width = null;

        if (itemId) {
            this.element.dataset.itemId = itemId;
        }

        this.setGrow(grow);
        this.setWidth(width);
    }

    /** Return whether the item is hidden. */
    get hidden(): boolean {
        return this._hidden;
    }

    /** Return whether the item grows. */
    get grow(): boolean {
        return this._grow;
    }

    /** Return the normalized fixed width, or `null`. */
    get width(): string | null {
        return this._width;
    }

    /**
     * Show or hide the item. Native `hidden` is applied to both the host and a raw
     * child element so `[data-control-id][hidden]` selectors work.
     * @param {boolean} hidden New hidden state.
     */
    setHidden(hidden: boolean): void {
        this._hidden = Boolean(hidden);
        this.element.hidden = this._hidden;
        if (this.content) {
            this.content.hidden = this._hidden;
        }
    }

    /**
     * Toggle whether the item consumes remaining space.
     * @param {boolean} grow New grow state.
     */
    setGrow(grow: boolean): void {
        this._grow = Boolean(grow);
        this.element.classList.toggle('stack-view__item--grow', this._grow);
        this._syncFlex();
    }

    /**
     * Set a fixed item width; `null` removes the fixed width.
     * @param {string|number|null} width Width in pixels or any CSS length.
     */
    setWidth(width: string | number | null): void {
        this._width = normalizeLength(width);
        this.element.classList.toggle('stack-view__item--fixed', this._width !== null);
        this._syncFlex();
    }

    /** Recalculate the item's inline flex rules from grow/width. */
    private _syncFlex(): void {
        if (this._grow) {
            this.element.style.flex = this._width ? `1 1 ${this._width}` : '1 1 auto';
        } else if (this._width) {
            this.element.style.flex = `0 0 ${this._width}`;
        } else {
            this.element.style.flex = '';
        }

        if (this._width) {
            this.element.style.width = this._width;
        } else {
            this.element.style.removeProperty('width');
        }
    }
}

/**
 * StackView lays out child views and raw elements vertically or horizontally.
 *
 * It is a structural primitive: it owns no visual design beyond theme spacing and
 * the optional striped row variant. View children keep their own lifecycle; raw
 * elements are moved into the item host when the stack renders.
 */
export class StackView extends ViewBase {
    private _orientation: StackViewOrientation;
    private _gap: string | null;
    private _padding: string | null;
    private _align: StackViewAlignment;
    private _justify: StackViewAlignment;
    private _wrap: boolean;
    private _fill: boolean;
    private _striped: boolean;
    private _items: StackItem[];
    private _root: HTMLDivElement | null;

    /**
     * @param {StackViewOptions} options Stack configuration.
     */
    constructor({
        orientation = 'vertical',
        gap = 0,
        padding = 0,
        align = orientation === 'horizontal' ? 'flex-start' : 'stretch',
        justify = 'flex-start',
        wrap = false,
        fill = false,
        striped = false,
        title = 'Stack',
        icon = null,
        id = null,
        logger = null,
        i18nService = null,
        ...rest
    }: StackViewOptions = {}) {
        super({ title, icon, id, logger, i18nService, ...rest });

        this._orientation = orientation === 'horizontal' ? 'horizontal' : 'vertical';
        this._gap = normalizeLength(gap);
        this._padding = normalizeLength(padding);
        this._align = align;
        this._justify = justify;
        this._wrap = Boolean(wrap);
        this._fill = Boolean(fill);
        this._striped = Boolean(striped);
        this._items = [];
        this._root = null;
    }

    /** Return the stack direction. */
    get orientation(): StackViewOrientation {
        return this._orientation;
    }

    /** Return the gap CSS length, or `null`. */
    get gap(): string | null {
        return this._gap;
    }

    /** Return the padding CSS length, or `null`. */
    get padding(): string | null {
        return this._padding;
    }

    /** Return the item list in display order. */
    get items(): readonly StackItem[] {
        return this._items;
    }

    /**
     * Add a view child.
     * @param {ViewBase} view Child view.
     * @param {StackItemOptions} options Item sizing and identifier.
     * @returns {StackItem} The item handle.
     */
    addView(view: ViewBase, options: StackItemOptions = {}): StackItem {
        if (!(view instanceof ViewBase)) {
            throw new Error('StackView.addView requires a ViewBase instance.');
        }

        const item = new StackItem({
            view,
            itemId: options.itemId ?? null,
            grow: options.grow ?? false,
            width: normalizeLength(options.width),
        });
        this._items.push(item);
        this._mountItem(item);
        return item;
    }

    /**
     * Add a raw element child.
     * @param {HTMLElement} element Child element.
     * @param {StackItemOptions} options Item sizing and identifier.
     * @returns {StackItem} The item handle.
     */
    addElement(element: HTMLElement, options: StackItemOptions = {}): StackItem {
        if (!(element instanceof HTMLElement)) {
            throw new Error('StackView.addElement requires an HTMLElement.');
        }

        const item = new StackItem({
            content: element,
            itemId: options.itemId ?? null,
            grow: options.grow ?? false,
            width: normalizeLength(options.width),
        });
        this._items.push(item);
        this._mountItem(item);
        return item;
    }



    /** Remove every item and detach any child views. */
    clear(): void {
        for (const item of this._items) {
            if (item.view?.isAttached) {
                item.view.detach();
            }
            item.element.remove();
        }
        this._items = [];
    }

    /** Build the stack root and mount all items. */
    render(container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = [
            'stack-view',
            `stack-view--${this._orientation}`,
            this._wrap && this._orientation === 'horizontal' ? 'stack-view--wrap' : null,
            this._fill ? 'stack-view--fill' : null,
            this._striped ? 'stack-view--striped' : null,
        ]
            .filter(Boolean)
            .join(' ');

        if (this._gap) {
            root.style.setProperty('--stack-view-gap', this._gap);
        }
        if (this._padding) {
            root.style.setProperty('--stack-view-padding', this._padding);
        }
        root.style.alignItems = this._align;
        root.style.justifyContent = this._justify;

        this._root = root;
        container.replaceChildren(root);

        for (const item of this._items) {
            this._mountItem(item);
        }

        this._log('render', { itemCount: this._items.length });
    }

    /** Detach all child views and release their host elements. */
    override beforeDetach(): void {
        super.beforeDetach();

        for (const item of this._items) {
            if (item.view?.isAttached) {
                item.view.detach();
            }
        }

        this._root = null;
    }

    /**
     * Mount an item into the rendered root, if the stack is attached.
     * @param {StackItem} item Item to mount.
     */
    private _mountItem(item: StackItem): void {
        if (!this._root) {
            return;
        }

        this._root.appendChild(item.element);

        if (item.view) {
            if (item.view.isAttached) {
                item.view.detach();
            }
            item.view.attachTo(item.element);
            return;
        }

        if (item.content && item.content.parentElement !== item.element) {
            item.element.appendChild(item.content);
        }
    }

    /** Serialize the stack metadata and item identifiers. */
    serialize(): ReturnType<ViewBase['serialize']> {
        return {
            ...super.serialize(),
            type: 'StackView',
            orientation: this._orientation,
            gap: this._gap,
            padding: this._padding,
            align: this._align,
            justify: this._justify,
            wrap: this._wrap,
            fill: this._fill,
            striped: this._striped,
            items: this._items.map((item) => ({
                itemId: item.itemId,
                grow: item.grow,
                width: item.width,
                hidden: item.hidden,
            })),
        };
    }

    /**
     * Deserialize stack options. Child views are runtime-owned, so only the
     * structural options are restored.
     * @param {StackViewOptions} data Serialized stack options.
     * @returns {StackView} Restored stack view.
     */
    static override deserialize(data: StackViewOptions = {}): StackView {
        return new StackView(data);
    }
}

/**
 * Normalize a number/CSS length to a CSS string.
 * @param {string|number|null|undefined} value Length value.
 * @returns {string|null} Normalized CSS length, or `null`.
 */
function normalizeLength(value: string | number | null | undefined): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${Math.max(0, value)}px`;
    }

    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) {
            return null;
        }
        return /^\d+(?:\.\d+)?$/.test(normalized) ? `${normalized}px` : normalized;
    }

    return null;
}
