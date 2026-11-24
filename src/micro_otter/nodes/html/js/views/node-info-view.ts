// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import { getDataTypeColor } from '../nodes/data-type-colors.js';
import { renderAreaMarkdown } from '../core/render-documentation-markdown.js';
import { onKatexStateChange } from '../core/katex-loader.js';

type LoggerFunction = (message: string, level?: unknown, ...data: unknown[]) => void;

interface I18nServiceLike {
    t: (key: string, params?: Record<string, unknown>) => string;
    addEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    removeEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
}

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;

export interface NodeInfoRow {
    name: string;
    description: string;
    types?: string[];
}

export interface NodeInfoContent {
    nodeName?: unknown;
    info?: unknown;
    docsUrl?: string | null;
    inputs?: NodeInfoRow[];
    outputs?: NodeInfoRow[];
    controls?: NodeInfoRow[];
    nodeIcon?: string | null;
}

export interface NodeInfoViewOptions extends NodeInfoContent, Omit<ViewBaseOptions, 'title'> {
    i18nService?: I18nServiceLike | null;
    logger?: LoggerFunction | null;
}

/**
 * NodeInfoView - Display node type information.
 * Pure ViewBase descendant for flexible container usage.
 *
 * Note: Markdown is rendered through `renderAreaMarkdown()` (allowlisted, KaTeX-aware);
 * when no Markdown provider is available it falls back to escaped plain text.
 *
 * This view is designed to be container-agnostic and can be used in:
 * - OverlayView (floating window) - primary use case from context menu
 * - SplitView or TabbedView - for persistent info panel
 * - Any other container that accepts ViewBase views
 *
 * Features:
 * - Markdown-formatted info text with syntax highlighting
 * - Node icon display
 * - Per-connector and per-control detail tables (inputs, outputs, controls)
 * - Optional documentation link
 * - Full i18n support
 *
 * @example
 * // Create info view
 * const infoView = new NodeInfoView({
 *   nodeName: 'Servo Motor',
 *   info: 'Controls a servo motor via **PWM** signal.',
 *   docsUrl: 'https://docs.micropython.org/en/latest/library/machine.PWM.html',
 *   inputs: [{ name: 'Signal', description: 'PWM duty cycle (0.0 to 1.0).' }],
 *   outputs: [{ name: 'Out', description: 'Driven PWM signal.' }],
 *   controls: [{ name: 'Pin', description: 'GPIO pin driving the servo.' }],
 *   nodeIcon: '/path/to/servo-icon.svg',
 *   i18nService: i18nService,
 *   logger: logger
 * });
 *
 * // Show in overlay window via ViewManager
 * viewManager.addOverlay(infoView, {
 *   title: 'Node Information',
 *   x: 100,
 *   y: 100,
 *   width: 320,
 *   height: 240,
 *   resizable: false,
 *   minimizable: false,
 *   closable: true
 * });
 */
export class NodeInfoView extends ViewBase {
    nodeName: string;
    info: string;
    docsUrl: string | null;
    inputs: NodeInfoRow[];
    outputs: NodeInfoRow[];
    controls: NodeInfoRow[];
    nodeIcon: string | null;

    private _sectionTitles: Array<{ el: HTMLElement; key: string }>;
    private _docsLink: HTMLAnchorElement | null;
    private _unsubscribeKatex: (() => void) | null;

    /**
     * Create a node info view.
     * @param {object} [options]
     * @param {string} [options.nodeName=''] Name of the node type.
     * @param {string} [options.info=''] Detailed description/info text (supports markdown).
     * @param {string|null} [options.docsUrl=null] Optional documentation URL.
     * @param {number} [options.inputs=0] Number of input connectors.
     * @param {number} [options.outputs=0] Number of output connectors.
     * @param {string|null} [options.nodeIcon=null] Optional node type icon path.
     * @param {object|null} [options.i18nService=null] I18n service for translations.
     * @param {Function|null} [options.logger=null] Optional logger function.
     */
    constructor({
        nodeName = '',
        info = '',
        docsUrl = null,
        inputs = [],
        outputs = [],
        controls = [],
        nodeIcon = null,
        i18nService,
        logger,
        ...rest
    }: NodeInfoViewOptions = {}) {
        super({
            title: 'Node Information',
            i18nService,
            logger,
            ...rest,
        });

        this.nodeName = String(nodeName);
        this.info = String(info);
        this.docsUrl = docsUrl;
        this.inputs = Array.isArray(inputs) ? inputs : [];
        this.outputs = Array.isArray(outputs) ? outputs : [];
        this.controls = Array.isArray(controls) ? controls : [];
        this.nodeIcon = nodeIcon;

        // Store references for label updates
        this._sectionTitles = [];
        this._docsLink = null;
        this._unsubscribeKatex = null;
    }

    /**
     * Render the view content.
     * @param {HTMLElement} container - Container to render into
     */
    render(container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = 'node-info-view';

        this._sectionTitles = [];

        // Node description first, so guidance (e.g. persistence notes) is
        // visible without scrolling past large parameter tables.
        if (this.info) {
            const infoEl = document.createElement('div');
            infoEl.className = 'node-info-view__info-text';
            infoEl.innerHTML = renderAreaMarkdown(this.info).html;
            root.appendChild(infoEl);
        }

        // Documentation link (if available)
        if (this.docsUrl) {
            const docsLink = document.createElement('a');
            docsLink.className = 'node-info-view__docs-link';
            docsLink.href = this.docsUrl;
            docsLink.target = '_blank';
            docsLink.rel = 'noopener noreferrer';
            docsLink.textContent = this.t('graph.info.viewDocs');
            root.appendChild(docsLink);
            this._docsLink = docsLink;
        }

        // Per-connector/per-control detail tables
        this._renderSection(root, 'graph.info.inputs', this.inputs, 'inputs');
        this._renderSection(root, 'graph.info.outputs', this.outputs, 'outputs');
        this._renderSection(root, 'graph.info.controls', this.controls, 'controls');

        container.replaceChildren(root);
    }

    /**
     * Called after view is attached to DOM.
     */
    afterAttach(): void {
        super.afterAttach();

        // Subscribe to language changes
        this._subscribeToLanguageChanges(() => {
            this._updateLabels();
        });

        // Upgrade the `$…$` math fallback to rendered KaTeX once the lazy load completes.
        this._unsubscribeKatex = onKatexStateChange((state) => {
            if (state === 'ready' && this.container) {
                this.render(this.container);
            }
        });
    }

    /**
     * Release the KaTeX subscription before the base teardown.
     */
    beforeDetach(): void {
        this._unsubscribeKatex?.();
        this._unsubscribeKatex = null;
        super.beforeDetach();
    }

    /**
     * Update labels when language changes.
     * @private
     */
    private _updateLabels(): void {
        for (const { el, key } of this._sectionTitles) {
            el.textContent = this.t(key);
        }
        if (this._docsLink) {
            this._docsLink.textContent = this.t('graph.info.viewDocs');
        }
    }

    /**
     * Render a titled table section for a list of connector/control rows.
     * @param {HTMLElement} root - Parent element to append to
     * @param {string} titleKey - i18n key for the section heading
     * @param {NodeInfoRow[]} rows - Rows to render (name + description)
     * @param {'inputs'|'outputs'|'controls'} kind - Section kind; controls render
     *   their widget type without a connector colour
     * @private
     */
    private _renderSection(
        root: HTMLElement,
        titleKey: string,
        rows: NodeInfoRow[],
        kind: 'inputs' | 'outputs' | 'controls'
    ): void {
        if (!Array.isArray(rows) || rows.length === 0) {
            return;
        }

        const section = document.createElement('div');
        section.className = 'node-info-view__section';

        const title = document.createElement('div');
        title.className = 'node-info-view__section-title';
        title.textContent = this.t(titleKey);
        section.appendChild(title);
        this._sectionTitles.push({ el: title, key: titleKey });

        const table = document.createElement('table');
        table.className = 'node-info-view__table';

        const headerRow = document.createElement('tr');
        const headerCells: Array<{ el: HTMLElement; key: string }> = [
            { el: document.createElement('th'), key: 'graph.info.columns.name' },
            { el: document.createElement('th'), key: 'graph.info.columns.type' },
            { el: document.createElement('th'), key: 'graph.info.columns.description' },
        ];
        for (const { el, key } of headerCells) {
            el.className = 'node-info-view__cell-header';
            el.textContent = this.t(key);
            headerRow.appendChild(el);
            this._sectionTitles.push({ el, key });
        }
        table.appendChild(headerRow);

        for (const row of rows) {
            const tr = document.createElement('tr');

            const nameCell = document.createElement('td');
            nameCell.className = 'node-info-view__cell-name';
            nameCell.textContent = row.name;

            const typeCell = document.createElement('td');
            typeCell.className = 'node-info-view__cell-types';
            for (const type of Array.isArray(row.types) ? row.types : []) {
                const chip = document.createElement('span');
                chip.className = 'node-info-view__type';
                chip.textContent = type;
                // Connector types get their data-type colour; control widget
                // types (text/number/checkbox/dropdown/color) are not data-type
                // IDs and must not go through getDataTypeColor().
                if (kind !== 'controls') {
                    chip.style.setProperty('--node-info-type-color', getDataTypeColor(type));
                }
                typeCell.appendChild(chip);
            }

            const descriptionCell = document.createElement('td');
            descriptionCell.className = 'node-info-view__cell-description';
            descriptionCell.innerHTML = row.description
                ? renderAreaMarkdown(row.description).html
                : '';

            tr.appendChild(nameCell);
            tr.appendChild(typeCell);
            tr.appendChild(descriptionCell);
            table.appendChild(tr);
        }
        section.appendChild(table);

        root.appendChild(section);
    }
}
