// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * DOM layer for graph documentation areas.
 *
 * The implementation produces two stacked elements, one per job:
 *
 * - the **content layer** (`graph-panel-view__documentation`), sandwiched between the background
 *   and the node canvases. Everything the user *reads* lives there: the title and the rendered
 *   Markdown body. Being below the node canvas, text can never cover a node.
 * - the **chrome layer** (`graph-panel-view__documentation-chrome`), above the node canvas.
 *   Everything the user *clicks and types into* lives there: the burger button and the two inline
 *   editors. Being above the canvas, its controls actually receive pointer and keyboard input —
 *   a DOM control underneath a canvas would never see a click.
 *
 * Both layers share one per-area entry and are transformed with the same viewport matrix, so the
 * burger always sits exactly on the area's top-left corner and an editor always covers the box it
 * belongs to.
 *
 * The layer keeps one element pair per area id and updates it in place (diff by `data-area-id`),
 * so a viewport change or a colour tweak never rebuilds the DOM and never re-parses Markdown.
 */

import {
    DOCUMENTATION_AREA_BORDER_ALPHA,
    DOCUMENTATION_AREA_FILL_ALPHA,
    normalizeAreaContentAlign,
    normalizeAreaFontSize,
    rgbaFromHex,
} from '../data/documentation-area.js';
import type { DocumentationAreaData } from '../data/documentation-area.js';
import { renderAreaMarkdown } from '../core/render-documentation-markdown.js';
import { onKatexStateChange } from '../core/katex-loader.js';
import { IconProvider } from './icon-provider.js';
import type { MarkdownRenderResult } from '../core/markdown-renderer.js';

const LAYER_CLASS = 'graph-panel-view__documentation';
const CHROME_LAYER_CLASS = 'graph-panel-view__documentation-chrome';
const AREA_CLASS = 'graph-panel-doc-area';
const CHROME_CLASS = 'graph-panel-doc-chrome';
const ACTIVE_CLASS = `${AREA_CLASS}--active`;
const HEADER_CLASS = `${AREA_CLASS}__header`;
const TITLE_CLASS = `${AREA_CLASS}__title`;
const BODY_CLASS = `${AREA_CLASS}__body`;
const CONTENT_CLASS = `${AREA_CLASS}__content`;
const RESIZE_CLASS = `${AREA_CLASS}__resize`;
const MENU_CLASS = `${CHROME_CLASS}__menu`;
const EDITOR_CLASS = `${CHROME_CLASS}__editor`;
const TITLE_EDITOR_CLASS = `${CHROME_CLASS}__title-editor`;

const DEFAULT_UNTITLED_LABEL = 'Untitled area';
const DEFAULT_MENU_LABEL = 'Documentation area menu';

type Transform = { translateX: number; translateY: number; scale: number };

export interface DocumentationLayerViewport {
    getTransform?: () => Transform;
    viewport?: Transform;
}

export interface GraphPanelDocumentationLayerOptions {
    /** The canvas host (`position: relative`), between the background and node canvases. */
    host: HTMLElement;
    /** Sibling to insert the content layer before (the node canvas), so DOM order yields the z-stack. */
    before?: HTMLElement | null;
    viewport: DocumentationLayerViewport;
    /** Markdown renderer; defaults to `renderAreaMarkdown()`. */
    renderMarkdown?: (markdown: string) => MarkdownRenderResult;
    /** Called when the burger button is clicked. */
    onAreaMenu?: (areaId: string, anchor: DOMRect) => void;
    /** Called when an area is activated (or with `null` when it is deactivated). */
    onAreaActivate?: (areaId: string | null) => void;
    /** Called once when the Markdown editor commits. */
    onAreaMarkdownCommit?: (areaId: string, markdown: string) => void;
    /** Called once when the title editor commits. */
    onAreaTitleCommit?: (areaId: string, title: string) => void;
    /** Translation resolver; falls back to English labels. */
    translate?: (key: string, fallback: string) => string;
}

interface AreaEntry {
    areaId: string;
    root: HTMLElement;
    chromeRoot: HTMLElement;
    header: HTMLElement;
    titleEl: HTMLElement;
    menuButton: HTMLButtonElement;
    bodyEl: HTMLElement;
    contentEl: HTMLElement;
    resizeEl: HTMLElement;
    markdown: string;
    title: string;
    color: string;
    active: boolean;
    hasMath: boolean;
    mathRendered: boolean;
    editor: HTMLTextAreaElement | null;
    titleEditor: HTMLInputElement | null;
}

export class GraphPanelDocumentationLayer {
    #host: HTMLElement;
    #before: HTMLElement | null;
    #viewport: DocumentationLayerViewport;
    #renderMarkdown: (markdown: string) => MarkdownRenderResult;
    #onAreaMenu: ((areaId: string, anchor: DOMRect) => void) | null;
    #onAreaActivate: ((areaId: string | null) => void) | null;
    #onAreaMarkdownCommit: ((areaId: string, markdown: string) => void) | null;
    #onAreaTitleCommit: ((areaId: string, title: string) => void) | null;
    #translate: (key: string, fallback: string) => string;
    #layerEl: HTMLElement | null = null;
    #chromeLayerEl: HTMLElement | null = null;
    #entries = new Map<string, AreaEntry>();
    #activeAreaId: string | null = null;
    #hoveredAreaId: string | null = null;
    #editingAreaId: string | null = null;
    #renamingAreaId: string | null = null;
    #unsubscribeKatex: (() => void) | null = null;
    #destroyed = false;
    /** Capture-phase document listener that commits editors when a click lands outside them. */
    #documentMouseDownHandler: ((event: MouseEvent) => void) | null = null;

    constructor(options: GraphPanelDocumentationLayerOptions) {
        this.#host = options.host;
        this.#before = options.before ?? null;
        this.#viewport = options.viewport;
        this.#renderMarkdown = options.renderMarkdown ?? renderAreaMarkdown;
        this.#onAreaMenu = options.onAreaMenu ?? null;
        this.#onAreaActivate = options.onAreaActivate ?? null;
        this.#onAreaMarkdownCommit = options.onAreaMarkdownCommit ?? null;
        this.#onAreaTitleCommit = options.onAreaTitleCommit ?? null;
        this.#translate = options.translate ?? ((_key, fallback) => fallback);
        this.#documentMouseDownHandler = (event: MouseEvent) => {
            this.#handleDocumentMouseDown(event);
        };
    }

    /**
     * Create the content and chrome layers.
     *
     * DOM order plus `z-index` in `graph-panel-documentation-areas.css` yields the paint order
     * background canvas → content layer → node canvas → chrome layer. The chrome layer must be
     * above the canvas or its buttons and editors would never receive a click.
     * @returns {HTMLElement|null} The content layer, or null without a DOM.
     */
    mount(): HTMLElement | null {
        if (typeof document === 'undefined') {
            return null;
        }
        if (this.#layerEl) {
            return this.#layerEl;
        }

        const layer = document.createElement('div');
        layer.className = LAYER_CLASS;
        if (this.#before && this.#before.parentElement === this.#host) {
            this.#host.insertBefore(layer, this.#before);
        } else {
            this.#host.appendChild(layer);
        }
        this.#layerEl = layer;

        const chromeLayer = document.createElement('div');
        chromeLayer.className = CHROME_LAYER_CLASS;
        if (this.#before && this.#before.parentElement === this.#host) {
            this.#before.after(chromeLayer);
        } else {
            this.#host.appendChild(chromeLayer);
        }
        this.#chromeLayerEl = chromeLayer;

        if (this.#documentMouseDownHandler) {
            // Capture phase runs before the canvas can call preventDefault(), so an outside click
            // commits the editor even when focus never leaves it.
            document.addEventListener('mousedown', this.#documentMouseDownHandler, true);
        }

        this.#unsubscribeKatex = onKatexStateChange((state) => {
            if (state === 'ready') {
                this.#upgradeMath();
            }
        });

        return layer;
    }

    /**
     * The content layer element, if mounted.
     * @returns {HTMLElement|null} Content layer element.
     */
    getElement(): HTMLElement | null {
        return this.#layerEl;
    }

    /**
     * The chrome layer element, if mounted.
     * @returns {HTMLElement|null} Chrome layer element.
     */
    getChromeElement(): HTMLElement | null {
        return this.#chromeLayerEl;
    }

    /**
     * Diff the rendered areas against the graph's area list.
     * @param {DocumentationAreaData[]} areas - Areas in paint order.
     * @param {{activeAreaId?: string|null}} [options] - Active area id.
     */
    render(areas: DocumentationAreaData[], { activeAreaId = null } = {}): void {
        if (!this.#layerEl) {
            this.mount();
        }
        const layer = this.#layerEl;
        const chromeLayer = this.#chromeLayerEl;
        if (!layer || !chromeLayer) {
            return;
        }

        const list = Array.isArray(areas) ? areas : [];
        const seen = new Set<string>();

        for (const area of list) {
            if (!area || typeof area.id !== 'string' || !area.id) {
                continue;
            }
            seen.add(area.id);
            const entry =
                this.#entries.get(area.id) ?? this.#createEntry(area, layer, chromeLayer);
            this.#updateEntry(entry, area);
        }

        for (const [areaId, entry] of [...this.#entries]) {
            if (seen.has(areaId)) {
                continue;
            }
            if (entry.areaId === this.#editingAreaId) {
                this.#editingAreaId = null;
            }
            if (entry.areaId === this.#renamingAreaId) {
                this.#renamingAreaId = null;
            }
            entry.root.remove();
            entry.chromeRoot.remove();
            this.#entries.delete(areaId);
        }

        this.#reorder(list);
        this.setActiveAreaId(activeAreaId);
    }

    /**
     * Translate and scale both layers so their world coordinates match the canvases.
     */
    syncViewport(): void {
        if (!this.#layerEl) {
            return;
        }
        const transform = this.#readTransform();
        const matrix = `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`;
        for (const element of [this.#layerEl, this.#chromeLayerEl]) {
            if (!element) {
                continue;
            }
            element.style.transform = matrix;
            element.style.transformOrigin = '0 0';
        }
    }

    /**
     * Toggle the active modifier on exactly one area.
     * @param {string|null} areaId - Active area id.
     */
    setActiveAreaId(areaId: string | null): void {
        const normalized = typeof areaId === 'string' && areaId ? areaId : null;
        this.#activeAreaId = normalized;

        for (const entry of this.#entries.values()) {
            const isActive = entry.areaId === normalized;
            if (entry.active === isActive) {
                continue;
            }
            entry.active = isActive;
            entry.root.classList.toggle(ACTIVE_CLASS, isActive);
        }
    }

    /**
     * Currently active area id.
     * @returns {string|null} Active id.
     */
    getActiveAreaId(): string | null {
        return this.#activeAreaId;
    }

    /**
     * Mark one area as hovered (used for the border highlight).
     * @param {string|null} areaId - Hovered area id, or null to clear.
     */
    setHoveredArea(areaId: string | null): void {
        const normalized = typeof areaId === 'string' && areaId ? areaId : null;
        if (this.#hoveredAreaId === normalized) {
            return;
        }

        const previous = this.#hoveredAreaId ? this.#entries.get(this.#hoveredAreaId) : null;
        if (previous) {
            previous.root.dataset.hover = 'false';
        }
        this.#hoveredAreaId = normalized;
        const next = normalized ? this.#entries.get(normalized) : null;
        if (next) {
            next.root.dataset.hover = 'true';
        }
    }

    /**
     * Area currently marked as hovered.
     * @returns {string|null} Hovered id.
     */
    getHoveredAreaId(): string | null {
        return this.#hoveredAreaId;
    }

    /**
     * Area currently in Markdown edit mode.
     * @returns {string|null} Editing id.
     */
    getEditingAreaId(): string | null {
        return this.#editingAreaId;
    }

    /**
     * Open the inline Markdown editor for an area.
     *
     * The textarea lives in the chrome layer, above the node canvas, positioned exactly over the
     * area's body. That is what makes it typeable at all: a control inside the content layer would
     * sit underneath the canvas and never receive a click or a keystroke.
     * @param {string} areaId - Area to edit.
     * @returns {boolean} True when an editor was opened.
     */
    showEditor(areaId: string): boolean {
        const entry = this.#entries.get(areaId);
        if (!entry || typeof document === 'undefined') {
            return false;
        }
        if (entry.editor) {
            entry.editor.focus();
            return true;
        }

        if (this.#editingAreaId && this.#editingAreaId !== areaId) {
            this.cancelEditor();
        }

        const editor = document.createElement('textarea');
        editor.className = EDITOR_CLASS;
        editor.value = entry.markdown;
        editor.spellcheck = false;
        editor.placeholder = this.#translate(
            'documentationArea.placeholder',
            'Write Markdown…  ($…$ for inline math)'
        );
        editor.addEventListener('blur', () => {
            if (this.#editingAreaId === areaId) {
                this.commitEditor();
            }
        });
        editor.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.cancelEditor();
                return;
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.stopPropagation();
                this.commitEditor();
                return;
            }
            // Keep typing inside the textarea from reaching the panel's key handling.
            event.stopPropagation();
        });

        entry.root.dataset.editing = 'true';
        entry.contentEl.hidden = true;
        this.#placeOver(editor, entry.bodyEl);
        entry.chromeRoot.appendChild(editor);
        entry.editor = editor;
        this.#editingAreaId = areaId;
        editor.focus();
        return true;
    }

    /**
     * Commit the open Markdown editor.
     * @returns {string|null} The committed value, or null when no editor was open.
     */
    commitEditor(): string | null {
        const areaId = this.#editingAreaId;
        if (!areaId) {
            return null;
        }
        const entry = this.#entries.get(areaId);
        const editor = entry?.editor ?? null;
        const value = editor ? editor.value : '';

        this.#closeEditor(areaId);
        this.#onAreaMarkdownCommit?.(areaId, value);
        return value;
    }

    /**
     * Abandon the open Markdown editor and restore the previous body.
     * @returns {boolean} True when an editor was open.
     */
    cancelEditor(): boolean {
        const areaId = this.#editingAreaId;
        if (!areaId) {
            return false;
        }
        this.#closeEditor(areaId);
        return true;
    }

    /**
     * Open the inline title editor for an area.
     *
     * The input lives in the chrome layer, positioned exactly over the title, for the same reason
     * as the Markdown editor: it has to be above the node canvas to be editable at all.
     * @param {string} areaId - Area to rename.
     * @returns {boolean} True when a title input was opened.
     */
    showTitleEditor(areaId: string): boolean {
        const entry = this.#entries.get(areaId);
        if (!entry || typeof document === 'undefined') {
            return false;
        }
        if (entry.titleEditor) {
            entry.titleEditor.focus();
            return true;
        }

        if (this.#renamingAreaId && this.#renamingAreaId !== areaId) {
            this.cancelTitleEditor();
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = TITLE_EDITOR_CLASS;
        input.value = entry.title;
        input.placeholder = this.#translate('documentationArea.untitled', DEFAULT_UNTITLED_LABEL);
        input.addEventListener('blur', () => {
            if (this.#renamingAreaId === areaId) {
                this.commitTitleEditor();
            }
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                this.commitTitleEditor();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.cancelTitleEditor();
                return;
            }
            event.stopPropagation();
        });

        entry.root.dataset.renaming = 'true';
        this.#placeOver(input, entry.titleEl);
        entry.chromeRoot.appendChild(input);
        entry.titleEditor = input;
        this.#renamingAreaId = areaId;
        input.focus();
        input.select?.();
        return true;
    }

    /**
     * Commit the open title editor.
     * @returns {string|null} The committed title, or null when no editor was open.
     */
    commitTitleEditor(): string | null {
        const areaId = this.#renamingAreaId;
        if (!areaId) {
            return null;
        }
        const entry = this.#entries.get(areaId);
        const input = entry?.titleEditor ?? null;
        const value = input ? input.value : '';

        this.#closeTitleEditor(areaId);
        this.#onAreaTitleCommit?.(areaId, value);
        return value;
    }

    /**
     * Abandon the open title editor.
     * @returns {boolean} True when a title editor was open.
     */
    cancelTitleEditor(): boolean {
        const areaId = this.#renamingAreaId;
        if (!areaId) {
            return false;
        }
        this.#closeTitleEditor(areaId);
        return true;
    }

    /**
     * Preview a colour without touching the graph (used by the colour picker).
     * @param {string} areaId - Area to tint.
     * @param {string} hex - `#rgb`/`#rrggbb` colour.
     */
    previewAreaColor(areaId: string, hex: string): void {
        const entry = this.#entries.get(areaId);
        if (!entry) {
            return;
        }
        this.#applyColorVariables(entry, hex);
    }

    /**
     * Drop a colour preview and fall back to the stored colour.
     * @param {string} areaId - Area whose preview ends.
     */
    clearAreaColorPreview(areaId: string): void {
        const entry = this.#entries.get(areaId);
        if (!entry) {
            return;
        }
        this.#applyColorVariables(entry, entry.color);
    }

    /**
     * Bounding rect of an area element, in screen coordinates.
     * @param {string} areaId - Area id.
     * @returns {DOMRect|null} Rect or null for an unknown id.
     */
    getAreaElementRect(areaId: string): DOMRect | null {
        const entry = this.#entries.get(areaId);
        if (!entry || typeof entry.root.getBoundingClientRect !== 'function') {
            return null;
        }
        return entry.root.getBoundingClientRect();
    }

    /**
     * Header element of an area (used for cursor feedback and menu anchoring).
     * @param {string} areaId - Area id.
     * @returns {HTMLElement|null} Header or null.
     */
    getHeaderElement(areaId: string): HTMLElement | null {
        return this.#entries.get(areaId)?.header ?? null;
    }

    /**
     * Resize handle element of an area.
     * @param {string} areaId - Area id.
     * @returns {HTMLElement|null} Handle or null.
     */
    getResizeHandleElement(areaId: string): HTMLElement | null {
        return this.#entries.get(areaId)?.resizeEl ?? null;
    }

    /**
     * Body element of an area.
     * @param {string} areaId - Area id.
     * @returns {HTMLElement|null} Body or null.
     */
    getBodyElement(areaId: string): HTMLElement | null {
        return this.#entries.get(areaId)?.bodyEl ?? null;
    }

    /**
     * Commit any editor whose box does not contain the `mousedown` target.
     *
     * Registered once on `document` in the capture phase by `mount()`. The canvas calls
     * `preventDefault()` on every mousedown, which can keep focus in the editor, so the normal
     * `blur` commit cannot be relied on for an outside click. Clicks inside an editor are ignored,
     * and a click that moves between the title and body editors only commits the one left behind.
     * @param {MouseEvent} event - Document-level mousedown event.
     * @private
     */
    #handleDocumentMouseDown(event: MouseEvent): void {
        if (!this.#editingAreaId && !this.#renamingAreaId) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }

        for (const entry of [...this.#entries.values()]) {
            if (
                entry.areaId === this.#editingAreaId &&
                entry.editor &&
                !entry.editor.contains(target)
            ) {
                this.commitEditor();
            }
            if (
                entry.areaId === this.#renamingAreaId &&
                entry.titleEditor &&
                !entry.titleEditor.contains(target)
            ) {
                this.commitTitleEditor();
            }
        }
    }

    /**
     * Remove both layers and release the KaTeX subscription.
     */
    destroy(): void {
        this.#destroyed = true;
        if (this.#documentMouseDownHandler && typeof document !== 'undefined') {
            document.removeEventListener('mousedown', this.#documentMouseDownHandler, true);
        }
        this.#documentMouseDownHandler = null;
        this.#unsubscribeKatex?.();
        this.#unsubscribeKatex = null;
        this.#entries.clear();
        this.#layerEl?.remove();
        this.#layerEl = null;
        this.#chromeLayerEl?.remove();
        this.#chromeLayerEl = null;
        this.#activeAreaId = null;
        this.#hoveredAreaId = null;
        this.#editingAreaId = null;
        this.#renamingAreaId = null;
    }

    /**
     * Read the current viewport transform from the injected collaborator.
     * @returns {Transform} Translate plus scale, defaulting to identity.
     * @private
     */
    #readTransform(): Transform {
        const viewport = this.#viewport;
        const transform =
            typeof viewport.getTransform === 'function' ? viewport.getTransform() : viewport.viewport;
        return {
            translateX: Number.isFinite(transform?.translateX) ? Number(transform?.translateX) : 0,
            translateY: Number.isFinite(transform?.translateY) ? Number(transform?.translateY) : 0,
            scale: Number.isFinite(transform?.scale) ? Number(transform?.scale) : 1,
        };
    }

    /**
     * Build the element pair for one area: readable content plus the interactive chrome.
     * @param {DocumentationAreaData} area - Area data.
     * @param {HTMLElement} layer - Content layer element.
     * @param {HTMLElement} chromeLayer - Chrome layer element (above the node canvas).
     * @returns {AreaEntry} New entry.
     * @private
     */
    #createEntry(
        area: DocumentationAreaData,
        layer: HTMLElement,
        chromeLayer: HTMLElement
    ): AreaEntry {
        const root = document.createElement('section');
        root.className = AREA_CLASS;
        root.dataset.areaId = area.id;

        const header = document.createElement('header');
        header.className = HEADER_CLASS;

        const titleEl = document.createElement('h3');
        titleEl.className = TITLE_CLASS;

        const bodyEl = document.createElement('div');
        bodyEl.className = BODY_CLASS;

        const contentEl = document.createElement('div');
        contentEl.className = CONTENT_CLASS;
        bodyEl.appendChild(contentEl);

        const resizeEl = document.createElement('div');
        resizeEl.className = RESIZE_CLASS;
        resizeEl.dataset.zone = 'resize';
        resizeEl.setAttribute('aria-hidden', 'true');

        header.appendChild(titleEl);
        root.append(header, bodyEl, resizeEl);
        layer.appendChild(root);

        // The burger is the area's only always-visible control, so it lives in the chrome layer
        // above the node canvas: only there can a left click reach it.
        const chromeRoot = document.createElement('div');
        chromeRoot.className = CHROME_CLASS;
        chromeRoot.dataset.areaId = area.id;

        const menuButton = document.createElement('button');
        menuButton.type = 'button';
        menuButton.className = MENU_CLASS;
        menuButton.tabIndex = -1;
        menuButton.setAttribute(
            'aria-label',
            this.#translate('documentationArea.menuButton', DEFAULT_MENU_LABEL)
        );
        const menuIcon = document.createElement('img');
        menuIcon.src = IconProvider.menu;
        menuIcon.alt = '';
        menuIcon.draggable = false;
        menuButton.appendChild(menuIcon);
        chromeRoot.appendChild(menuButton);
        chromeLayer.appendChild(chromeRoot);

        menuButton.addEventListener('mousedown', (event) => {
            if (event.button !== 0) {
                return;
            }
            this.#onAreaActivate?.(area.id);
        });
        menuButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.#onAreaMenu?.(area.id, menuButton.getBoundingClientRect());
        });

        const entry: AreaEntry = {
            areaId: area.id,
            root,
            chromeRoot,
            header,
            titleEl,
            menuButton,
            bodyEl,
            contentEl,
            resizeEl,
            markdown: '',
            title: '',
            color: '',
            active: false,
            hasMath: false,
            mathRendered: false,
            editor: null,
            titleEditor: null,
        };
        this.#entries.set(area.id, entry);
        return entry;
    }

    /**
     * Apply new data to an existing entry, touching only what changed.
     * @param {AreaEntry} entry - Entry to update.
     * @param {DocumentationAreaData} area - New data.
     * @private
     */
    #updateEntry(entry: AreaEntry, area: DocumentationAreaData): void {
        const bounds = area.bounds;
        const fontSize = normalizeAreaFontSize(area.fontSize);
        for (const element of [entry.root, entry.chromeRoot]) {
            element.style.left = `${bounds.x}px`;
            element.style.top = `${bounds.y}px`;
            element.style.width = `${bounds.width}px`;
            element.style.height = `${bounds.height}px`;
            // Both roots carry the preset: the chrome editor inherits the same CSS variable.
            element.dataset.fontSize = fontSize;
        }

        // `top`/`bottom` decide whether the Markdown body hugs the top or the bottom of the box.
        entry.root.dataset.align = normalizeAreaContentAlign(area.contentAlign);

        const color = typeof area.color === 'string' && area.color ? area.color : entry.color;
        if (color && color !== entry.color) {
            entry.color = color;
            this.#applyColorVariables(entry, color);
        }

        const title = typeof area.title === 'string' ? area.title : '';
        entry.title = title;
        if (!entry.titleEditor) {
            // Titles are text, never HTML: a title containing markup stays literal.
            entry.titleEl.textContent = title || this.#translate('documentationArea.untitled', DEFAULT_UNTITLED_LABEL);
            entry.root.dataset.untitled = title ? 'false' : 'true';
        }

        const markdown = typeof area.markdown === 'string' ? area.markdown : '';
        if (markdown !== entry.markdown || entry.root.dataset.empty === undefined) {
            entry.markdown = markdown;
            if (!entry.editor) {
                this.#renderBody(entry, markdown);
            }
        }

        if (!entry.editor) {
            entry.root.dataset.empty = markdown ? 'false' : 'true';
            entry.bodyEl.dataset.empty = markdown ? 'false' : 'true';
        }
        entry.root.title = markdown;
    }

    /**
     * Render (or re-render) an area body from its Markdown.
     * @param {AreaEntry} entry - Entry whose body to fill.
     * @param {string} markdown - Markdown source.
     * @private
     */
    #renderBody(entry: AreaEntry, markdown: string): void {
        const result = this.#renderMarkdown(markdown);
        entry.hasMath = Boolean(result?.hasMath);
        entry.mathRendered = Boolean(result?.mathRendered);
        // The renderer is allowlisted and escapes everything else, so this is the only innerHTML
        // assignment in the layer.
        entry.contentEl.innerHTML = result?.html ?? '';
    }

    /**
     * Position a chrome control exactly over a content element.
     *
     * Both layers share the same origin and scale, so the offsets measured against the area root
     * (the offset parent of both) transfer one-to-one. This keeps the geometry in one place: move
     * the header padding or the body padding in CSS and the editors follow.
     *
     * A degenerate reference (zero width or height — a collapsed or unlaid-out box) is ignored: the
     * element then keeps the inset defaults from the stylesheet instead of shrinking to a sliver.
     * @param {HTMLElement} element - Chrome control to place.
     * @param {HTMLElement} reference - Content element to cover.
     * @private
     */
    #placeOver(element: HTMLElement, reference: HTMLElement): void {
        const width = reference.offsetWidth || 0;
        const height = reference.offsetHeight || 0;
        if (width <= 0 || height <= 0) {
            return;
        }
        element.style.left = `${reference.offsetLeft || 0}px`;
        element.style.top = `${reference.offsetTop || 0}px`;
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
    }

    /**
     * Assign the three colour CSS variables from a `#rrggbb` value.
     * @param {AreaEntry} entry - Entry to tint.
     * @param {string} hex - Colour to apply.
     * @private
     */
    #applyColorVariables(entry: AreaEntry, hex: string): void {
        const fill = rgbaFromHex(hex, DOCUMENTATION_AREA_FILL_ALPHA);
        const border = rgbaFromHex(hex, DOCUMENTATION_AREA_BORDER_ALPHA);
        // The chrome layer is a sibling of the content layer, so the variables are written twice.
        for (const element of [entry.root, entry.chromeRoot]) {
            element.style.setProperty('--doc-area-color', hex);
            element.style.setProperty('--doc-area-fill', fill);
            element.style.setProperty('--doc-area-border', border);
        }
    }

    /**
     * Close the Markdown editor and restore the rendered body.
     * @param {string} areaId - Area whose editor closes.
     * @private
     */
    #closeEditor(areaId: string): void {
        const entry = this.#entries.get(areaId);
        if (this.#editingAreaId === areaId) {
            this.#editingAreaId = null;
        }
        if (!entry) {
            return;
        }
        entry.editor?.remove();
        entry.editor = null;
        entry.root.dataset.editing = 'false';
        // The content element was only hidden while editing, never replaced, so restoring it is a
        // visibility change — no Markdown re-parse is needed when the edit is cancelled.
        entry.contentEl.hidden = false;
        entry.root.dataset.empty = entry.markdown ? 'false' : 'true';
        entry.bodyEl.dataset.empty = entry.markdown ? 'false' : 'true';
    }

    /**
     * Close the title editor and restore the plain title.
     * @param {string} areaId - Area whose title editor closes.
     * @private
     */
    #closeTitleEditor(areaId: string): void {
        const entry = this.#entries.get(areaId);
        if (this.#renamingAreaId === areaId) {
            this.#renamingAreaId = null;
        }
        if (!entry) {
            return;
        }
        entry.titleEditor?.remove();
        entry.titleEditor = null;
        entry.root.dataset.renaming = 'false';
        entry.titleEl.textContent =
            entry.title || this.#translate('documentationArea.untitled', DEFAULT_UNTITLED_LABEL);
    }

    /**
     * Re-render every math-bearing body once KaTeX becomes available.
     * @private
     */
    #upgradeMath(): void {
        if (this.#destroyed) {
            return;
        }
        for (const entry of this.#entries.values()) {
            if (!entry.hasMath || entry.mathRendered || entry.editor) {
                continue;
            }
            this.#renderBody(entry, entry.markdown);
        }
    }

    /**
     * Make the DOM order match the paint order of the data array, in both layers.
     * @param {DocumentationAreaData[]} areas - Areas in paint order.
     * @private
     */
    #reorder(areas: DocumentationAreaData[]): void {
        const layer = this.#layerEl;
        if (!layer) {
            return;
        }

        const desired = areas
            .map((area) => (area && typeof area.id === 'string' ? this.#entries.get(area.id) : null))
            .filter((entry): entry is AreaEntry => Boolean(entry));

        const current = [...this.#entries.values()];
        const alreadyOrdered =
            desired.length === current.length &&
            desired.every((entry, index) => entry === current[index]);
        if (alreadyOrdered) {
            return;
        }

        for (const entry of desired) {
            layer.appendChild(entry.root);
            this.#chromeLayerEl?.appendChild(entry.chromeRoot);
        }
    }
}

