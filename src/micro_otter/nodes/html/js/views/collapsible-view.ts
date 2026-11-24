// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file CollapsibleView - Container view with collapsible header and content panel
 * @module views/collapsible-view
 */

import { ViewBase } from './view-base.js';
import { IconProvider } from './icon-provider.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

interface ViewFactoryLike {
    deserialize: (data: unknown, context?: CollapsibleViewDeserializeContext) => ViewBase;
}

type ViewFactoryFunction = (...args: unknown[]) => unknown;

interface CollapsibleViewDeserializeContext {
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    viewFactory?: ViewFactoryLike;
}

interface CollapsibleViewSerialized {
    type: 'CollapsibleView';
    id: string;
    title: string;
    icon: string | null;
    headerTitle: string;
    collapsed: boolean;
    collapsible: boolean;
    headerHeight: number;
    sizeToContent?: boolean;
    nested: boolean;
    contentGuide?: boolean;
    contentView?: unknown;
    [key: string]: unknown;
}

interface CollapsibleViewDeserializeData {
    headerTitle?: string;
    collapsed?: boolean;
    collapsible?: boolean;
    headerHeight?: number;
    sizeToContent?: boolean;
    nested?: boolean;
    contentGuide?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    contentView?: unknown;
}

export interface CollapsibleViewOptions {
    headerTitle?: string;
    collapsed?: boolean;
    /**
     * Whether the header toggles the content. `false` renders a static section
     * header (no toggle or solo button) that is always expanded.
     */
    collapsible?: boolean;
    contentView?: ViewBase | null;
    /**
     * Header height in pixels. Defaults to 28 px and is clamped to a 24 px
     * minimum. Consumers should omit it unless they need a deliberately
     * different height, for example the compact nested Firmware log sections.
     */
    headerHeight?: number;
    sizeToContent?: boolean;
    /**
     * Render the sub-section variant: a header one surface step lighter than a
     * top-level section's (see phase 2 of M4k).
     */
    nested?: boolean;
    /**
     * Draw a vertical guide line down the inline-start edge of the content panel,
     * spanning the content height, so the expanded content reads as a child of the
     * header (one level deeper). The line hides together with the content while the
     * section is collapsed.
     */
    contentGuide?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
}

/**
 * CollapsibleView provides a header with title and toggle button, and a content panel
 * that can accept any ViewBase-based view.
 *
 * Clicking anywhere on the header toggles the view; clicks that land on a header button
 * are left to that button. When the view is attached as a direct SplitView pane, the
 * header also renders a solo button that asks the host to collapse the sibling panes
 * (see `ViewBase.requestSplitViewSolo()`); the `isCollapsible` marker plus the public
 * `collapse()`/`expand()` methods are the contract the host uses for it.
 */
export class CollapsibleView extends ViewBase {
    private _headerTitle: string;
    private _collapsed: boolean;
    private _collapsible: boolean;
    private _contentView: ViewBase | null;
    private _headerHeight: number;
    private _sizeToContent: boolean;
    /**
     * Whether the sub-section header variant is active. Written by the constructor
     * and the `nested` setter; read by `render()`, `serialize()`, and the `nested` getter.
     */
    private _nested: boolean;
    /**
     * Whether the content guide line is active. Written by the constructor and the
     * `contentGuide` setter; read by `render()`, `serialize()`, and the getter.
     */
    private _contentGuide: boolean;
    /** Height captured on a real collapse, restored on expand; `null` when never collapsed. */
    private _heightBeforeCollapse: number | null;

    private _headerElement: HTMLDivElement | null;
    private _toggleButton: HTMLButtonElement | null;
    /** Solo button; only rendered when the view is attached as a direct SplitView pane. */
    private _soloButton: HTMLButtonElement | null;
    private _titleElement: HTMLSpanElement | null;
    private _contentContainer: HTMLDivElement | null;
    private _contentResizeObserver: ResizeObserver | null;
    private _observedContentRoot: HTMLElement | null;

    constructor({
        headerTitle = 'Section',
        collapsed = false,
        collapsible = true,
        contentView = null,
        headerHeight = 28,
        sizeToContent = false,
        nested = false,
        contentGuide = false,
        title = 'Collapsible',
        icon = null,
        id = null,
        logger = null,
        i18nService = null,
    }: CollapsibleViewOptions = {}) {
        super({ title, icon, id, logger, i18nService });

        this._headerTitle = headerTitle;
        this._collapsible = collapsible !== false;
        this._collapsed = this._collapsible ? Boolean(collapsed) : false;
        this._contentView = contentView;
        this._headerHeight = Math.max(24, Number(headerHeight) || 28);
        this._sizeToContent = Boolean(sizeToContent);
        this._nested = Boolean(nested);
        this._contentGuide = Boolean(contentGuide);
        this._heightBeforeCollapse = null;

        this._headerElement = null;
        this._toggleButton = null;
        this._soloButton = null;
        this._titleElement = null;
        this._contentContainer = null;
        this._contentResizeObserver = null;
        this._observedContentRoot = null;

        this._log('constructor-complete', 'debug', {
            headerTitle: this._headerTitle,
            collapsed: this._collapsed,
            collapsible: this._collapsible,
            headerHeight: this._headerHeight,
            sizeToContent: this._sizeToContent,
            nested: this._nested,
            contentGuide: this._contentGuide,
            hasContentView: Boolean(this._contentView),
        });
    }

    /**
     * Public marker for the SplitView solo contract: a direct pane child advertising this flag
     * may be expanded/collapsed by a sibling's solo request. Read by `SplitView`.
     */
    get isCollapsible(): boolean {
        return this._collapsible;
    }

    /** Return whether the header can toggle the content. */
    get collapsible(): boolean {
        return this._collapsible;
    }


    get headerTitle(): string {
        return this._headerTitle;
    }

    set headerTitle(title: string) {
        this._headerTitle = String(title ?? 'Section');
        if (this._titleElement) {
            this._titleElement.textContent = this._headerTitle;
        }
        this._log('header-title-changed', 'debug', { title: this._headerTitle });
    }

    get collapsed(): boolean {
        return this._collapsed;
    }

    set collapsed(collapsed: boolean) {
        if (!this._collapsible) {
            return;
        }

        const newState = Boolean(collapsed);
        if (newState === this._collapsed) {
            return;
        }

        if (newState && this.container) {
            // Only a real collapse remembers a height to restore on expand. The
            // initial collapsed render must not capture anything: an
            // initially-collapsed section has no "before" height, and a stale
            // capture would pin the pane to its collapsed header height.
            this._heightBeforeCollapse = this.container.offsetHeight;
        }

        this._collapsed = newState;
        this._updateCollapsedState();
        this._log('collapsed-state-changed', 'debug', { collapsed: this._collapsed });
    }

    get sizeToContent(): boolean {
        return this._sizeToContent;
    }

    set sizeToContent(value: boolean) {
        const enabled = Boolean(value);
        if (enabled === this._sizeToContent) {
            return;
        }

        this._sizeToContent = enabled;
        if (enabled) {
            this._heightBeforeCollapse = null;
        }

        const root =
            this.container?.querySelector<HTMLDivElement>('.collapsible-view') ?? null;
        root?.classList.toggle('collapsible-view--fit-content', enabled);
        this._syncContentResizeObserver();

        if (!this._collapsed) {
            this.refreshSize();
        }

        this._log('size-to-content-changed', 'debug', { sizeToContent: this._sizeToContent });
    }

    /**
     * Whether the sub-section variant is active.
     */
    get nested(): boolean {
        return this._nested;
    }

    /**
     * Toggle the sub-section header variant on the rendered root. A no-op when the
     * value is unchanged, and safe before `render()` — the class lands with the next render.
     */
    set nested(value: boolean) {
        const enabled = Boolean(value);
        if (enabled === this._nested) {
            return;
        }

        this._nested = enabled;

        const root =
            this.container?.querySelector<HTMLDivElement>('.collapsible-view') ?? null;
        root?.classList.toggle('collapsible-view--nested', enabled);

        this._log('nested-changed', 'debug', { nested: this._nested });
    }

    /**
     * Whether the content guide line is active.
     */
    get contentGuide(): boolean {
        return this._contentGuide;
    }

    /**
     * Toggle the content guide line on the rendered root. A no-op when the value is
     * unchanged, and safe before `render()` — the class lands with the next render.
     */
    set contentGuide(value: boolean) {
        const enabled = Boolean(value);
        if (enabled === this._contentGuide) {
            return;
        }

        this._contentGuide = enabled;

        const root =
            this.container?.querySelector<HTMLDivElement>('.collapsible-view') ?? null;
        root?.classList.toggle('collapsible-view--content-guide', enabled);

        this._log('content-guide-changed', 'debug', { contentGuide: this._contentGuide });
    }

    get contentView(): ViewBase | null {
        return this._contentView;
    }

    set contentView(view: ViewBase | null) {
        if (view && !(view instanceof ViewBase)) {
            throw new Error('CollapsibleView.contentView must be a ViewBase instance or null');
        }

        if (this._contentView && this._contentView.isAttached) {
            this._contentView.detach();
        }

        this._contentView = view;

        if (this._contentView && this._contentContainer) {
            this._contentView.attachTo(this._contentContainer);
        }

        this._syncContentResizeObserver();

        this._log('content-view-changed', 'debug', {
            hasView: Boolean(this._contentView),
        });
    }

    render(container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = [
            'collapsible-view',
            this._sizeToContent ? 'collapsible-view--fit-content' : null,
            this._nested ? 'collapsible-view--nested' : null,
            this._contentGuide ? 'collapsible-view--content-guide' : null,
            this._collapsible ? null : 'collapsible-view--static',
        ]
            .filter(Boolean)
            .join(' ');

        this._headerElement = document.createElement('div');
        this._headerElement.className = 'collapsible-view__header';
        this._headerElement.style.height = `${this._headerHeight}px`;

        this._toggleButton = this._collapsible ? document.createElement('button') : null;
        if (this._toggleButton) {
            this._toggleButton.className = 'collapsible-view__toggle';
            this._toggleButton.type = 'button';
            this._applyToggleLabel();

            const toggleIcon = document.createElement('img');
            toggleIcon.className = 'collapsible-view__toggle-icon';
            toggleIcon.src = IconProvider.arrowDropUp;
            toggleIcon.alt = '';
            this._toggleButton.appendChild(toggleIcon);
        }

        // The solo action only makes sense on a direct SplitView pane: that is the only place a
        // pane channel exists, and only the host can collapse the sibling panes.
        this._soloButton =
            this._collapsible && this.getSplitViewChannel() ? this._createSoloButton() : null;
        this._applySoloLabel();

        this._titleElement = document.createElement('span');
        this._titleElement.className = 'collapsible-view__title';
        this._titleElement.textContent = this._headerTitle;

        if (this._toggleButton) {
            this._headerElement.appendChild(this._toggleButton);
        }
        this._headerElement.appendChild(this._titleElement);
        if (this._soloButton) {
            this._headerElement.appendChild(this._soloButton);
        }

        this._contentContainer = document.createElement('div');
        this._contentContainer.className = 'collapsible-view__content';

        root.append(this._headerElement, this._contentContainer);
        container.replaceChildren(root);

        if (this._contentView) {
            this._contentView.attachTo(this._contentContainer);
        }

        this._updateCollapsedState();
        this._syncContentResizeObserver();

        this._log('render-complete');
    }

    override afterAttach(): void {
        super.afterAttach();

        this._subscribeToLanguageChanges(() => {
            this._applyToggleLabel();
            this._applySoloLabel();
        });

        if (this._toggleButton) {
            this._toggleButton.addEventListener('click', this._onToggleClick);
        }

        if (this._headerElement) {
            this._headerElement.addEventListener('click', this._onHeaderClick);
        }

        if (this._soloButton) {
            this._soloButton.addEventListener('click', this._onSoloClick);
        }

        this._syncContentResizeObserver();

        this._log('after-attach-complete');
    }

    override beforeDetach(): void {
        super.beforeDetach();
        this._teardownContentResizeObserver();

        if (this._toggleButton) {
            this._toggleButton.removeEventListener('click', this._onToggleClick);
        }

        if (this._headerElement) {
            this._headerElement.removeEventListener('click', this._onHeaderClick);
        }

        if (this._soloButton) {
            this._soloButton.removeEventListener('click', this._onSoloClick);
        }

        if (this._contentView && this._contentView.isAttached) {
            this._contentView.detach();
        }

        this._log('before-detach-complete');
    }

    toggle(): void {
        if (!this._collapsible) {
            return;
        }
        this.collapsed = !this._collapsed;
    }

    expand(): void {
        if (!this._collapsible) {
            return;
        }
        this.collapsed = false;
    }

    collapse(): void {
        if (!this._collapsible) {
            return;
        }
        this.collapsed = true;
    }

    /**
     * Recompute the expanded height from the content view's natural height and
     * apply it as a height cap. Call this whenever the content changes size
     * (e.g. an optional control becomes visible).
     */
    refreshSize(): void {
        if (!this.isAttached || this._collapsed) {
            return;
        }

        const contentMinHeight = this._contentView?.minHeight ?? null;
        const contentMaxHeight = this._contentView?.maxHeight ?? null;

        if (this._sizeToContent) {
            const headerHeight = this._measureHeaderHeight();
            const measuredContentHeight = this._measureContentHeight();
            const contentPadding = this._measureContentPadding();
            let maxHeight: number | null;

            if (measuredContentHeight !== null) {
                maxHeight = Math.ceil(
                    headerHeight +
                        Math.max(measuredContentHeight, contentMinHeight ?? 0) +
                        contentPadding +
                        2
                );
            } else if (contentMinHeight !== null && contentMinHeight > 0) {
                maxHeight = this._headerHeight + contentMinHeight + contentPadding;
            } else {
                maxHeight = null;
            }

            this._setHeightConstraintsIfChanged(this._headerHeight, maxHeight);
            return;
        }

        if (contentMaxHeight !== null && contentMaxHeight > 0) {
            // Fixed-height content (e.g. ToolbarView declares min == max): cap the
            // expanded pane at the content's own maximum.
            this._setHeightConstraintsIfChanged(
                this._headerHeight,
                this._headerHeight + Math.max(contentMinHeight ?? 0, contentMaxHeight)
            );
        } else {
            // Free-form / scrollable content: a declared minimum is not a fixed
            // height. CustomRuntimeView, for example, declares only a minimum and
            // must fill the pane; treating that minimum as a cap would clip the
            // whole hosted view to header + minimum.
            this._setHeightConstraintsIfChanged(this._headerHeight, null);
        }
    }

    /**
     * Measure the rendered header height, falling back to the declared
     * `headerHeight` when no measurement is available (JSDOM reports zeros).
     */
    private _measureHeaderHeight(): number {
        const measuredHeight = this._headerElement?.getBoundingClientRect().height ?? 0;
        return Number.isFinite(measuredHeight) && measuredHeight > 0
            ? measuredHeight
            : this._headerHeight;
    }

    /**
     * Measure the natural height of the content view's rendered root, or `null`
     * when it renders nothing measurable. Called only by `refreshSize()`.
     */
    private _measureContentHeight(): number | null {
        const contentRoot = this._getContentRoot();
        if (!contentRoot) {
            return null;
        }

        const measuredHeight = contentRoot.getBoundingClientRect().height;
        return Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : null;
    }

    /**
     * Measure the vertical padding of the content container, which the cap must
     * include.
     *
     * The content root is measured inside `.collapsible-view__content`, so the
     * container's padding is part of the pane but not of the measurement. A theme
     * that pads the container (the Firmware tab pads it 8 px top and bottom) would
     * otherwise get a cap one padding short, and a pane that fits its content would
     * scroll. Returns `0` when the container is unpadded (the Settings panels) or
     * when no computed style is available (JSDOM).
     */
    private _measureContentPadding(): number {
        if (!this._contentContainer) {
            return 0;
        }

        const computedStyle =
            this._contentContainer.ownerDocument?.defaultView?.getComputedStyle(
                this._contentContainer
            ) ?? null;
        const readLength = (property: string): number => {
            const raw = computedStyle?.getPropertyValue(property) ?? '';
            const value = Number.parseFloat(raw);
            return Number.isFinite(value) ? value : 0;
        };

        return readLength('padding-top') + readLength('padding-bottom');
    }

    /**
     * Return the content view's rendered root element, which is what the
     * content-fit mode measures and observes. Called by the measurement and the
     * observer sync.
     */
    private _getContentRoot(): HTMLElement | null {
        return this._contentView?.container?.firstElementChild as HTMLElement | null;
    }

    /**
     * Observe the content root while content-fit mode is active so a growing or
     * shrinking child re-measures the cap. Called after render, after attach, on
     * `sizeToContent` changes, and on content-view changes.
     */
    private _syncContentResizeObserver(): void {
        const contentRoot =
            this._sizeToContent && this.isAttached ? this._getContentRoot() : null;
        const ResizeObserverCtor =
            typeof ResizeObserver !== 'undefined' ? ResizeObserver : null;

        if (
            ResizeObserverCtor &&
            contentRoot &&
            this._contentResizeObserver &&
            this._observedContentRoot === contentRoot
        ) {
            return;
        }

        this._teardownContentResizeObserver();

        if (!ResizeObserverCtor || !contentRoot) {
            return;
        }

        this._contentResizeObserver = new ResizeObserverCtor(() => {
            this.refreshSize();
        });
        this._contentResizeObserver.observe(contentRoot);
        this._observedContentRoot = contentRoot;
    }

    /** Disconnect the content-root observer, if any. Called by the sync and detach paths. */
    private _teardownContentResizeObserver(): void {
        if (this._contentResizeObserver) {
            this._contentResizeObserver.disconnect();
            this._contentResizeObserver = null;
        }
        this._observedContentRoot = null;
    }

    /**
     * Publish new height constraints only when they differ from the current
     * ones, so re-measuring an unchanged section does not churn the hosting
     * `SplitView`.
     */
    private _setHeightConstraintsIfChanged(
        minHeight: number,
        maxHeight: number | null
    ): void {
        const normalizedMaxHeight =
            Number.isFinite(maxHeight) && maxHeight !== null && maxHeight >= 0 ? maxHeight : null;
        if (this.minHeight === minHeight && this.maxHeight === normalizedMaxHeight) {
            return;
        }

        this.setHeightConstraints({ minHeight, maxHeight: normalizedMaxHeight });
    }

    /** Toggle button click handler; mirrors the public `toggle()` API. */
    private _onToggleClick = (): void => {
        this.toggle();
    };

    /**
     * Header click handler: toggles the view unless the click landed on a header button.
     *
     * The buttons stay the keyboard-accessible controls; the header remains a plain container
     * so it can hold them without nesting interactive elements inside a `role="button"`.
     * @param {MouseEvent} event Click event bubbling up from the header.
     */
    private _onHeaderClick = (event: MouseEvent): void => {
        if (!this._collapsible) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (typeof target?.closest === 'function' && target.closest('button')) {
            return;
        }
        this.toggle();
    };

    /**
     * Solo button click handler. The child only states the intent; the hosting SplitView
     * expands this pane and collapses the sibling collapsible panes.
     */
    private _onSoloClick = (): void => {
        this.requestSplitViewSolo();
    };

    /**
     * Build the header solo button. Only called from `render()` when a SplitView pane channel
     * is present, so the button never appears in a standalone or nested container.
     * @returns {HTMLButtonElement} Configured solo button; the caller assigns and labels it.
     */
    private _createSoloButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'collapsible-view__solo';
        button.type = 'button';

        const icon = document.createElement('img');
        icon.className = 'collapsible-view__solo-icon';
        icon.src = IconProvider.add;
        icon.alt = '';
        button.appendChild(icon);

        return button;
    }

    /** Keep the toggle tooltip and accessible label in step with the collapsed state. */
    private _applyToggleLabel(): void {
        if (!this._toggleButton) {
            return;
        }

        const label = this._collapsed
            ? this.t('collapsibleView.expand')
            : this.t('collapsibleView.collapse');
        this._toggleButton.title = label;
        this._toggleButton.setAttribute('aria-label', label);
    }

    /** Apply the translated tooltip and accessible label to the solo button, when rendered. */
    private _applySoloLabel(): void {
        if (!this._soloButton) {
            return;
        }

        const label = this.t('collapsibleView.solo');
        this._soloButton.title = label;
        this._soloButton.setAttribute('aria-label', label);
    }

    /**
     * Apply the collapsed/expanded DOM state and the matching height
     * constraints. Called by `render()` and by the `collapsed` setter.
     */
    private _updateCollapsedState(): void {
        if (!this.isAttached) {
            return;
        }

        if (!this._collapsible) {
            this._collapsed = false;
        }

        const root = this.container?.querySelector<HTMLDivElement>('.collapsible-view') ?? null;
        const toggleIcon =
            this._toggleButton?.querySelector<HTMLImageElement>('.collapsible-view__toggle-icon') ??
            null;

        this._applyToggleLabel();

        if (this._collapsed) {
            if (this._contentContainer) {
                this._contentContainer.style.display = 'none';
            }

            if (toggleIcon) {
                toggleIcon.style.transform = 'rotate(0deg)';
            }

            if (root) {
                root.classList.add('is-collapsed');
            }

            this._setHeightConstraintsIfChanged(this._headerHeight, this._headerHeight);

            this._log('collapsed');
        } else {
            if (this._contentContainer) {
                this._contentContainer.style.display = '';
            }

            if (toggleIcon) {
                toggleIcon.style.transform = 'rotate(90deg)';
            }

            if (root) {
                root.classList.remove('is-collapsed');
            }

            this.refreshSize();

            if (!this._sizeToContent && this._heightBeforeCollapse) {
                this.setDesiredSize({ height: this._heightBeforeCollapse });
            }

            this._log('expanded');
        }
    }

    serialize(): CollapsibleViewSerialized {
        const data: CollapsibleViewSerialized = {
            ...super.serialize(),
            type: 'CollapsibleView',
            id: this.id,
            title: this.title,
            icon: this.icon,
            headerTitle: this._headerTitle,
            collapsed: this._collapsed,
            collapsible: this._collapsible,
            headerHeight: this._headerHeight,
            sizeToContent: this._sizeToContent,
            nested: this._nested,
            contentGuide: this._contentGuide,
        };

        if (this._contentView && typeof this._contentView.serialize === 'function') {
            data.contentView = this._contentView.serialize();
        }

        return data;
    }

    static deserialize(
        data: CollapsibleViewDeserializeData = {},
        viewFactoryOrContext: ViewFactoryFunction | ViewFactoryLike | CollapsibleViewDeserializeContext | null = null,
        context: CollapsibleViewDeserializeContext = {}
    ): CollapsibleView {
        const {
            headerTitle = 'Section',
            collapsed = false,
            collapsible = true,
            headerHeight = 28,
            sizeToContent = false,
            nested = false,
            contentGuide = false,
            title = 'Collapsible',
            icon = null,
            id = null,
            contentView: contentViewData = null,
        } = data;

        const secondArgIsFunction = typeof viewFactoryOrContext === 'function';
        const secondArgIsDeserializerObject =
            Boolean(viewFactoryOrContext) &&
            typeof viewFactoryOrContext === 'object' &&
            typeof (viewFactoryOrContext as { deserialize?: unknown }).deserialize === 'function';

        const resolvedContext =
            !secondArgIsFunction && secondArgIsDeserializerObject
                ? context
                : !secondArgIsFunction && viewFactoryOrContext && typeof viewFactoryOrContext === 'object'
                  ? (viewFactoryOrContext as CollapsibleViewDeserializeContext)
                  : context;

        const resolvedFactory: ViewFactoryFunction | ViewFactoryLike | null = secondArgIsFunction
            ? viewFactoryOrContext
            : secondArgIsDeserializerObject
              ? (viewFactoryOrContext as ViewFactoryLike)
              : (resolvedContext.viewFactory ?? null);

        let contentView: ViewBase | null = null;
        if (contentViewData && resolvedFactory) {
            try {
                if (typeof resolvedFactory === 'function') {
                    contentView = resolvedFactory(contentViewData, resolvedContext) as ViewBase;
                } else {
                    contentView = resolvedFactory.deserialize(contentViewData, resolvedContext);
                }
            } catch (error) {
                console.warn('Failed to deserialize content view:', error);
            }
        }

        return new CollapsibleView({
            headerTitle,
            collapsed,
            collapsible,
            contentView,
            headerHeight,
            sizeToContent,
            nested,
            contentGuide,
            title,
            icon,
            id,
            i18nService: resolvedContext.i18nService,
            logger: resolvedContext.logger,
        });
    }
}
