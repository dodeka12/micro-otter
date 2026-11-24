// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * NodeTypeUi: Visual representation of node types for the node palette.
 *
 * Responsibilities:
 * - Render a draggable node type item with icon, name, and colors
 * - Support small and large display modes
 * - Handle drag & drop with ghost preview
 * - Provide fallback icon if missing
 *
 * Integration:
 * - Used by NodePaletteView to display available node types
 * - Creates NodeData instances when dropped on GraphPanelView
 * - Integrates with IconProvider for fallback icons
 */

import { IconProvider } from '../views/icon-provider.js';
import { loadMdiIconIndex, resolveMdiGlyph } from '../data/mdi-icons.js';

export type NodeTypeUiSize = 'small' | 'large';

export type NodeTypeLocalizedText = string | Record<string, string>;

export interface NodeTypeUiNodeTypePayload {
    id: string;
    title?: NodeTypeLocalizedText;
    info?: NodeTypeLocalizedText;
    description?: NodeTypeLocalizedText;
    color?: string;
    icon?: string;
    packageId?: string | null;
    [key: string]: unknown;
}

export type NodeTypeUiDragPayload =
    | { type: 'node-type'; nodeTypeId: string; nodeTypeName: string }
    | { type: 'graph-item'; graphItemId: string; nodeTypeName: string };

export interface NodeTypeUiIconMetadata {
    source: 'nodeTypeIcon' | 'fallbackIcon';
    iconPath: string | null;
    packageId: string | null;
    hasIconProvider: boolean;
}

export interface NodeTypeUiLabelMetadata {
    displayName: string;
    language: string;
    titleKind: 'string' | 'localized-map' | 'fallback-id';
}

export interface NodeTypeUiIconProvider {
    createIcon: (name: string, options?: { className?: string }) => HTMLElement;
}

export interface NodeTypeUiLogger {
    debug?: (...data: unknown[]) => void;
    warn?: (...data: unknown[]) => void;
    log?: (...data: unknown[]) => void;
}

export type NodeTypeUiLogFn = (reason: string, level?: string, ...data: unknown[]) => void;

export interface NodeTypeUiOptions {
    iconProvider?: NodeTypeUiIconProvider | null;
    t?: (key: string) => string;
    logger?: NodeTypeUiLogger | NodeTypeUiLogFn | null;
}

const INFO_TOOLTIP_SHOW_DELAY_MS = 250;
const NAME_TOOLTIP_SHOW_DELAY_MS = 150;

function isLocalizedTextRecord(value: unknown): value is Record<string, string> {
    return Boolean(value) && typeof value === 'object';
}

export default class NodeTypeUi {
    public nodeType: NodeTypeUiNodeTypePayload;
    public size: NodeTypeUiSize;
    public domElement: HTMLDivElement | null;
    public iconElement: HTMLDivElement | null;
    public nameElement: HTMLDivElement | null;
    public isDragging: boolean;

    private _iconProvider: NodeTypeUiIconProvider | null;
    private _t: (key: string) => string;
    private _logger: NodeTypeUiLogger | null;
    private _logFn: NodeTypeUiLogFn | null;

    private _dragStartHandler: ((event: DragEvent) => void) | null;
    private _dragEndHandler: ((event: DragEvent) => void) | null;
    private _ghostElement: HTMLDivElement | null;
    private _infoIndicatorElement: HTMLDivElement | null;
    private _infoTooltipElement: HTMLDivElement | null;
    private _infoTooltipShowTimer: ReturnType<typeof setTimeout> | null;
    private _infoIndicatorMouseEnterHandler: ((event: MouseEvent) => void) | null;
    private _infoIndicatorMouseLeaveHandler: ((event: MouseEvent) => void) | null;
    private _nameTooltipElement: HTMLDivElement | null;
    private _nameTooltipShowTimer: ReturnType<typeof setTimeout> | null;
    private _cardMouseOverHandler: ((event: MouseEvent) => void) | null;
    private _cardMouseOutHandler: ((event: MouseEvent) => void) | null;

    constructor(
        nodeType: NodeTypeUiNodeTypePayload,
        size: NodeTypeUiSize = 'small',
        options: NodeTypeUiOptions = {}
    ) {
        this.nodeType = nodeType;
        this.size = size;
        this._iconProvider = options.iconProvider || null;
        this._t = options.t || ((key: string) => key);
        this._logger = typeof options.logger === 'function' ? null : options.logger || null;
        this._logFn = typeof options.logger === 'function' ? options.logger : null;

        this.domElement = null;
        this.iconElement = null;
        this.nameElement = null;
        this.isDragging = false;

        this._dragStartHandler = null;
        this._dragEndHandler = null;
        this._ghostElement = null;
        this._infoIndicatorElement = null;
        this._infoTooltipElement = null;
        this._infoTooltipShowTimer = null;
        this._infoIndicatorMouseEnterHandler = null;
        this._infoIndicatorMouseLeaveHandler = null;
        this._nameTooltipElement = null;
        this._nameTooltipShowTimer = null;
        this._cardMouseOverHandler = null;
        this._cardMouseOutHandler = null;
    }

    _logEvent(reason: string, level: 'debug' | 'warn' | 'log' = 'debug', ...data: unknown[]): void {
        if (this._logFn) {
            this._logFn(reason, level, ...data);
            return;
        }
        if (!this._logger) {
            return;
        }
        if (typeof this._logger[level] === 'function') {
            this._logger[level](...data);
            return;
        }
        if (typeof this._logger.log === 'function') {
            this._logger.log(...data);
        }
    }

    /**
     * Create and return the DOM structure for this node type.
     *
     * @returns {HTMLElement} Root container element
     */
    render(): HTMLDivElement {
        this.domElement = document.createElement('div');
        this.domElement.className = `node-type-ui node-type-ui--${this.size}`;
        if (this.nodeType.type === 'graph-item') {
            // Styling/test hook: the palette renders graph items (documentation areas) alongside node
            // types, and every node-only code path keys off this marker.
            this.domElement.dataset.graphItem = 'true';
        }
        this.domElement.draggable = true;

        this.iconElement = this._createIcon();
        this.domElement.appendChild(this.iconElement);

        if (this.size === 'large') {
            this.nameElement = this._createName();
            this.domElement.appendChild(this.nameElement);
            this.domElement.appendChild(this._createInfoIndicator());
        }

        this._applyColors();
        this._makeDraggable();
        this._attachCardTooltipHandlers();

        return this.domElement;
    }

    /**
     * Create the icon element from node type definition.
     * Falls back to default icon if not found or invalid.
     *
     * @private
     * @returns {HTMLElement} Icon container element
     */
    _createIcon(): HTMLDivElement {
        const iconContainer = document.createElement('div');
        iconContainer.className = 'node-type-ui__icon';

        const icon = this.nodeType.icon;
        if (!icon) {
            iconContainer.appendChild(this._createFallbackIcon());
            return iconContainer;
        }

        const description = IconProvider.describeIcon(String(icon));

        if (description.kind === 'image') {
            const img = document.createElement('img');
            img.className = 'node-type-ui__icon-img';
            img.src = description.src;

            img.onerror = () => {
                this._logEvent(
                    'icon-load-failed',
                    'warn',
                    `Failed to load icon for node type ${this.nodeType.id}, using fallback`
                );
                img.remove();
                iconContainer.appendChild(this._createFallbackIcon());
            };

            iconContainer.appendChild(img);
            return iconContainer;
        }

        // MDI values resolve to a webfont glyph asynchronously (index fetch), matching the
        // node header; text values (emoji, foreign icon sets) are painted verbatim.
        const glyph = document.createElement('span');
        glyph.className = 'node-type-ui__icon-glyph';
        glyph.setAttribute('aria-hidden', 'true');

        if (description.kind === 'mdi') {
            this._resolveMdiGlyphInto(description.value, glyph, iconContainer);
        } else {
            glyph.textContent = description.glyph;
        }

        iconContainer.appendChild(glyph);
        return iconContainer;
    }

    /**
     * Resolve an `mdi:` value to its glyph and paint it, falling back to the placeholder when
     * the index does not know the icon.
     *
     * The load is a shared, cached promise, so every palette card waits on one fetch; a card
     * whose icon the index cannot resolve swaps the glyph span for the fallback square.
     * @param value - The `<set>:<name>` value to resolve.
     * @param glyphElement - The span that receives the glyph.
     * @param iconContainer - The icon box, used for the fallback swap.
     * @private
     */
    _resolveMdiGlyphInto(
        value: string,
        glyphElement: HTMLSpanElement,
        iconContainer: HTMLDivElement
    ): void {
        void loadMdiIconIndex().then((index) => {
            const glyph = resolveMdiGlyph(value, index);
            if (glyph) {
                glyphElement.textContent = glyph;
                return;
            }

            glyphElement.remove();
            iconContainer.appendChild(this._createFallbackIcon());
        });
    }

    /**
     * Create fallback icon using IconProvider if available.
     *
     * @private
     * @returns {HTMLElement} Fallback icon element
     */
    _createFallbackIcon(): HTMLElement {
        if (this._iconProvider) {
            return this._iconProvider.createIcon('node', {
                className: 'node-type-ui__icon-fallback',
            });
        }

        const fallback = document.createElement('div');
        fallback.className = 'node-type-ui__icon-fallback';
        fallback.style.width = '100%';
        fallback.style.height = '100%';
        fallback.style.border = '2px solid currentColor';
        fallback.style.borderRadius = '4px';
        return fallback;
    }

    /**
     * Create the name text element.
     * Handles i18n objects with fallback to English.
     *
     * @private
     * @returns {HTMLElement} Name label element
     */
    _createName(): HTMLDivElement {
        const nameEl = document.createElement('div');
        nameEl.className = 'node-type-ui__name';

        const labelMetadata = this._getLabelMetadata();
        nameEl.textContent = labelMetadata.displayName;
        nameEl.title = labelMetadata.displayName;

        return nameEl;
    }

    /**
     * Create a non-interactive info indicator for large cards.
     * Tooltip and interaction behavior are implemented separately.
     *
     * @private
     * @returns {HTMLElement} Info indicator element
     */
    _createInfoIndicator(): HTMLDivElement {
        const indicator = document.createElement('div');
        indicator.className = 'node-type-ui__info-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        const tooltipText = this._getDescriptionTooltip();
        indicator.setAttribute('data-tooltip', tooltipText);
        this._attachInfoTooltipHandlers(indicator, tooltipText);
        this._infoIndicatorElement = indicator;

        if (this._iconProvider) {
            const icon = this._iconProvider.createIcon('info', {
                className: 'node-type-ui__info-icon',
            });
            indicator.appendChild(icon);
            return indicator;
        }

        if (IconProvider.has('info')) {
            const icon = document.createElement('img');
            icon.className = 'node-type-ui__info-icon';
            icon.src = IconProvider.info;
            icon.alt = '';
            icon.setAttribute('aria-hidden', 'true');
            indicator.appendChild(icon);
            return indicator;
        }

        const fallbackIcon = document.createElement('span');
        fallbackIcon.className = 'node-type-ui__info-icon node-type-ui__info-icon--fallback';
        fallbackIcon.textContent = 'i';
        indicator.appendChild(fallbackIcon);

        return indicator;
    }

    _attachInfoTooltipHandlers(indicator: HTMLDivElement, tooltipText: string): void {
        this._infoIndicatorMouseEnterHandler = (event: MouseEvent) => {
            this._cancelInfoTooltipTimer();
            this._infoTooltipShowTimer = setTimeout(() => {
                this._showInfoTooltip(indicator, tooltipText);
            }, INFO_TOOLTIP_SHOW_DELAY_MS);
            void event;
        };

        this._infoIndicatorMouseLeaveHandler = (_event: MouseEvent) => {
            this._cancelInfoTooltipTimer();
            this._hideInfoTooltip();
        };

        indicator.addEventListener('mouseenter', this._infoIndicatorMouseEnterHandler);
        indicator.addEventListener('mouseleave', this._infoIndicatorMouseLeaveHandler);
    }

    _cancelInfoTooltipTimer(): void {
        if (!this._infoTooltipShowTimer) {
            return;
        }
        clearTimeout(this._infoTooltipShowTimer);
        this._infoTooltipShowTimer = null;
    }

    _showInfoTooltip(indicator: HTMLDivElement, tooltipText: string): void {
        this._hideInfoTooltip();

        const tooltip = this._createTooltipElement(tooltipText);

        const indicatorRect = indicator.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        const viewportPadding = 8;
        const desiredLeft = indicatorRect.right - tooltipRect.width;
        const maxLeft = window.innerWidth - tooltipRect.width - viewportPadding;
        const left = Math.max(viewportPadding, Math.min(desiredLeft, maxLeft));

        let top = indicatorRect.top - tooltipRect.height - 8;
        if (top < viewportPadding) {
            top = indicatorRect.bottom + 8;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        this._infoTooltipElement = tooltip;
    }

    _hideInfoTooltip(): void {
        if (!this._infoTooltipElement) {
            return;
        }
        this._infoTooltipElement.remove();
        this._infoTooltipElement = null;
    }

    _createTooltipElement(tooltipText: string): HTMLDivElement {
        const tooltip = document.createElement('div');
        tooltip.className = 'node-type-ui__info-tooltip';
        tooltip.textContent = tooltipText;
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);
        return tooltip;
    }

    /**
     * Attach hover handlers that show the node name as a tooltip on the card.
     *
     * Uses mouseover/mouseout so the info icon keeps its own description
     * tooltip without the name tooltip also appearing on top of it.
     *
     * @private
     */
    _attachCardTooltipHandlers(): void {
        if (!this.domElement) {
            return;
        }

        this._cardMouseOverHandler = (event: MouseEvent) => {
            const target = event.target;
            if (
                target instanceof Node &&
                this._infoIndicatorElement &&
                this._infoIndicatorElement.contains(target)
            ) {
                this._cancelNameTooltipTimer();
                this._hideNameTooltip();
                return;
            }

            this._cancelNameTooltipTimer();
            this._nameTooltipShowTimer = setTimeout(() => {
                this._showNameTooltip();
            }, NAME_TOOLTIP_SHOW_DELAY_MS);
        };

        this._cardMouseOutHandler = (event: MouseEvent) => {
            const relatedTarget = event.relatedTarget;
            if (
                relatedTarget instanceof Node &&
                this.domElement &&
                this.domElement.contains(relatedTarget)
            ) {
                return;
            }

            this._cancelNameTooltipTimer();
            this._hideNameTooltip();
        };

        this.domElement.addEventListener('mouseover', this._cardMouseOverHandler);
        this.domElement.addEventListener('mouseout', this._cardMouseOutHandler);
    }

    _cancelNameTooltipTimer(): void {
        if (!this._nameTooltipShowTimer) {
            return;
        }
        clearTimeout(this._nameTooltipShowTimer);
        this._nameTooltipShowTimer = null;
    }

    _showNameTooltip(): void {
        if (!this.domElement) {
            return;
        }

        this._hideNameTooltip();

        const tooltip = this._createTooltipElement(this._getDisplayName());
        const cardRect = this.domElement.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        const viewportPadding = 8;
        const desiredLeft = cardRect.left + (cardRect.width - tooltipRect.width) / 2;
        const maxLeft = window.innerWidth - tooltipRect.width - viewportPadding;
        const left = Math.max(viewportPadding, Math.min(desiredLeft, maxLeft));

        let top = cardRect.top - tooltipRect.height - 8;
        if (top < viewportPadding) {
            top = cardRect.bottom + 8;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        this._nameTooltipElement = tooltip;
    }

    _hideNameTooltip(): void {
        if (!this._nameTooltipElement) {
            return;
        }
        this._nameTooltipElement.remove();
        this._nameTooltipElement = null;
    }

    _getDescriptionTooltip(): string {
        const infoText = this._getLocalizedNodeTypeText(this.nodeType.info);
        if (infoText) {
            return infoText;
        }

        const descriptionText = this._getLocalizedNodeTypeText(this.nodeType.description);
        if (descriptionText) {
            return descriptionText;
        }

        const fallbackKey = 'nodePalette.infoTooltipFallback';
        const translatedFallback = this._t(fallbackKey);
        if (translatedFallback && translatedFallback !== fallbackKey) {
            return translatedFallback;
        }

        return 'No description available.';
    }

    _getLocalizedNodeTypeText(value: NodeTypeLocalizedText | undefined): string {
        if (!value) {
            return '';
        }

        if (typeof value === 'string') {
            return value.trim();
        }

        const language = this._getCurrentLanguage();
        const resolved = value[language] || value.en || Object.values(value)[0] || '';
        return typeof resolved === 'string' ? resolved.trim() : '';
    }

    _getLabelMetadata(): NodeTypeUiLabelMetadata {
        const language = this._getCurrentLanguage();

        if (typeof this.nodeType.title === 'string') {
            return {
                displayName: this.nodeType.title,
                language,
                titleKind: 'string',
            };
        }

        if (isLocalizedTextRecord(this.nodeType.title)) {
            const displayName =
                this.nodeType.title[language] ||
                this.nodeType.title.en ||
                Object.values(this.nodeType.title)[0] ||
                this.nodeType.id;
            return {
                displayName,
                language,
                titleKind: 'localized-map',
            };
        }

        return {
            displayName: this.nodeType.id,
            language,
            titleKind: 'fallback-id',
        };
    }

    _getIconMetadata(): NodeTypeUiIconMetadata {
        if (this.nodeType.icon) {
            return {
                source: 'nodeTypeIcon',
                iconPath: this.nodeType.icon,
                packageId: this.nodeType.packageId || null,
                hasIconProvider: Boolean(this._iconProvider),
            };
        }

        return {
            source: 'fallbackIcon',
            iconPath: null,
            packageId: this.nodeType.packageId || null,
            hasIconProvider: Boolean(this._iconProvider),
        };
    }

    /**
     * Get current language code for i18n.
     *
     * @private
     * @returns {string} Language code (e.g., 'en', 'de')
     */
    _getCurrentLanguage(): string {
        return 'en';
    }

    /**
     * Apply background/foreground colors from node type definition.
     * Generates contrasting text color automatically.
     *
     * @private
     */
    _applyColors(): void {
        if (!this.domElement) return;

        const color = this.nodeType.color || '#5b7fc7';
        this.domElement.style.backgroundColor = color;

        const textColor = this._getContrastingColor(color);
        this.domElement.style.color = textColor;
    }

    /**
     * Calculate contrasting text color (black or white) for given background.
     *
     * @private
     * @param {string} hexColor - Background color in hex format
     * @returns {string} '#000000' or '#ffffff'
     */
    _getContrastingColor(hexColor: string): string {
        const hex = hexColor.replace('#', '');

        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    /**
     * Attach drag event listeners to enable drag & drop.
     *
     * @private
     */
    _makeDraggable(): void {
        if (!this.domElement) return;

        this._dragStartHandler = (event: DragEvent) => this._onDragStart(event);
        this._dragEndHandler = (event: DragEvent) => this._onDragEnd(event);

        this.domElement.addEventListener('dragstart', this._dragStartHandler);
        this.domElement.addEventListener('dragend', this._dragEndHandler);
    }

    /**
     * Handle drag start event.
     * Sets drag data and creates ghost preview.
     *
     * @private
     * @param {DragEvent} event - Drag start event
     */
    _onDragStart(event: DragEvent): void {
        this.isDragging = true;
        this.domElement?.classList.add('is-dragging');

        // Graph items (documentation areas, …) are not node types: the payload's discriminator tells
        // the drop handler which creation path to use.
        const dragData: NodeTypeUiDragPayload =
            this.nodeType.type === 'graph-item'
                ? {
                      type: 'graph-item',
                      graphItemId: this.nodeType.id,
                      nodeTypeName: this._getDisplayName(),
                  }
                : {
                      type: 'node-type',
                      nodeTypeId: this.nodeType.id,
                      nodeTypeName: this._getDisplayName(),
                  };

        const dataTransfer = event.dataTransfer as DataTransfer;
        dataTransfer.setData('application/json', JSON.stringify(dragData));
        dataTransfer.effectAllowed = 'copy';

        this._createDragGhost(event);

        this._logEvent('drag-start', 'debug', dragData);
    }

    /**
     * Create and set drag ghost image.
     *
     * @private
     * @param {DragEvent} event - Drag start event
     */
    _createDragGhost(event: DragEvent): void {
        if (!this.domElement) {
            return;
        }

        this._ghostElement = this.domElement.cloneNode(true) as HTMLDivElement;
        this._ghostElement.classList.add('node-type-ui--ghost');
        this._ghostElement.style.position = 'absolute';
        this._ghostElement.style.top = '-9999px';
        this._ghostElement.style.left = '-9999px';
        this._ghostElement.style.pointerEvents = 'none';
        this._ghostElement.style.opacity = '0.7';

        if (this.size === 'small') {
            this._ghostElement.style.width = '48px';
            this._ghostElement.style.height = '48px';
        } else {
            this._ghostElement.style.maxWidth = '200px';
        }

        document.body.appendChild(this._ghostElement);

        const width = this.size === 'small' ? 48 : Math.min(this.domElement.offsetWidth, 200);
        const height = this.size === 'small' ? 48 : this.domElement.offsetHeight;
        (event.dataTransfer as DataTransfer).setDragImage(
            this._ghostElement,
            width / 2,
            height / 2
        );
    }

    /**
     * Handle drag end event.
     * Cleans up drag state and ghost element.
     *
     * @private
     * @param {DragEvent} event - Drag end event
     */
    _onDragEnd(_event: DragEvent): void {
        this.isDragging = false;
        this.domElement?.classList.remove('is-dragging');

        if (this._ghostElement) {
            this._ghostElement.remove();
            this._ghostElement = null;
        }

        this._logEvent('drag-end', 'debug');
    }

    /**
     * Get display name for this node type.
     *
     * @private
     * @returns {string} Display name
     */
    _getDisplayName(): string {
        return this._getLabelMetadata().displayName;
    }

    /**
     * Update visual state if node type changes.
     * Re-renders icon, name, and colors.
     */
    update(): void {
        if (!this.domElement) return;

        if (this.iconElement) {
            this.iconElement.remove();
            this.iconElement = this._createIcon();
            if (this.nameElement) {
                this.domElement.insertBefore(this.iconElement, this.nameElement);
            } else {
                this.domElement.appendChild(this.iconElement);
            }
        }

        if (this.size === 'large' && this.nameElement) {
            this.nameElement.textContent = this._getDisplayName();
        }

        if (this._infoIndicatorElement) {
            const tooltipText = this._getDescriptionTooltip();
            this._infoIndicatorElement.setAttribute('data-tooltip', tooltipText);
        }

        this._applyColors();
    }

    /**
     * Clean up event listeners and DOM.
     */
    destroy(): void {
        if (this.domElement) {
            if (this._dragStartHandler) {
                this.domElement.removeEventListener('dragstart', this._dragStartHandler);
            }
            if (this._dragEndHandler) {
                this.domElement.removeEventListener('dragend', this._dragEndHandler);
            }
            if (this._cardMouseOverHandler) {
                this.domElement.removeEventListener('mouseover', this._cardMouseOverHandler);
            }
            if (this._cardMouseOutHandler) {
                this.domElement.removeEventListener('mouseout', this._cardMouseOutHandler);
            }
        }

        if (this._infoIndicatorElement) {
            if (this._infoIndicatorMouseEnterHandler) {
                this._infoIndicatorElement.removeEventListener(
                    'mouseenter',
                    this._infoIndicatorMouseEnterHandler
                );
            }
            if (this._infoIndicatorMouseLeaveHandler) {
                this._infoIndicatorElement.removeEventListener(
                    'mouseleave',
                    this._infoIndicatorMouseLeaveHandler
                );
            }
        }

        this._cancelInfoTooltipTimer();
        this._hideInfoTooltip();
        this._cancelNameTooltipTimer();
        this._hideNameTooltip();

        if (this._ghostElement) {
            this._ghostElement.remove();
            this._ghostElement = null;
        }

        if (this.domElement) {
            this.domElement.remove();
            this.domElement = null;
        }

        this.iconElement = null;
        this.nameElement = null;
        this._dragStartHandler = null;
        this._dragEndHandler = null;
        this._infoIndicatorElement = null;
        this._infoIndicatorMouseEnterHandler = null;
        this._infoIndicatorMouseLeaveHandler = null;
        this._nameTooltipElement = null;
        this._nameTooltipShowTimer = null;
        this._cardMouseOverHandler = null;
        this._cardMouseOutHandler = null;
    }
}
