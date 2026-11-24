// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

interface HtmlViewOptions {
    html?: string;
    title?: string;
    icon?: string | null;
    scrollable?: boolean;
    id?: string | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
}

interface HtmlViewSerialized {
    type: 'HtmlView';
    id: string;
    html: string;
    scrollable: boolean;
    title: string;
    icon: string | null;
    [key: string]: unknown;
}

interface HtmlViewDeserializeData {
    html?: string;
    scrollable?: boolean;
    title?: string;
    icon?: string | null;
}

/**
 * HtmlView - Displays HTML content
 *
 * A simple view that renders arbitrary HTML content. Useful for headers,
 * formatted text, or embedding custom HTML structures in the view system.
 */
export class HtmlView extends ViewBase {
    private _html: string;
    private _scrollable: boolean;

    /**
     * @param {Object} options - Configuration options
     * @param {string} options.html - HTML content to render
     * @param {string} [options.title] - View title
     * @param {string} [options.icon] - View icon
     * @param {boolean} [options.scrollable=false] - Whether content should be scrollable
     * @param {Object} [options.logger] - Logger instance
     * @param {Object} [options.i18nService] - I18n service instance
     */
    constructor({ html = '', scrollable = false, ...rest }: HtmlViewOptions = {}) {
        super({
            title: 'HTML View',
            icon: 'code',
            ...rest,
        });

        this._html = html;
        this._scrollable = scrollable;
    }

    /**
     * Get the current HTML content
     * @returns {string}
     */
    get html(): string {
        return this._html;
    }

    /**
     * Set new HTML content and re-render if attached
     * @param {string} value - New HTML content
     */
    set html(value: string) {
        this._html = value;
        if (this.isAttached) {
            this.render(this.container);
        }
    }

    /**
     * Render the HTML content
     * @param {HTMLElement} container - Container element
     */
    render(container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'view-html';

        if (this._scrollable) {
            wrapper.classList.add('view-html--scrollable');
        }

        wrapper.innerHTML = this._html;
        container.replaceChildren(wrapper);

        this._log('html-rendered', {
            htmlLength: this._html.length,
            scrollable: this._scrollable,
        });
    }

    /**
     * Serialize the view state
     * @returns {Object}
     */
    serialize(): HtmlViewSerialized {
        const base = super.serialize();
        return {
            ...base,
            type: 'HtmlView',
            id: this.id,
            html: this._html,
            scrollable: this._scrollable,
            title: this.title,
            icon: this.icon,
        };
    }

    /**
     * Deserialize and restore view state
     * @param {Object} data - Serialized state
     * @param {Object} context - Deserialization context
     */
    deserialize(data: HtmlViewDeserializeData, context: unknown): void {
        void context;

        this._html = data.html || '';
        this._scrollable = data.scrollable !== undefined ? data.scrollable : false;

        if (data.title !== undefined) {
            this.title = data.title;
        }
        if (data.icon !== undefined) {
            this.icon = data.icon;
        }
    }
}