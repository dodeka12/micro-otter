// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import {
    renderMarkdown,
    type KatexLike,
    type MarkedLike,
    type MarkdownRenderResult,
} from '../core/markdown-renderer.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

/**
 * Options for {@link MarkdownView}.
 */
export interface MarkdownViewOptions {
    /** Markdown source to render. */
    markdown?: string;
    /** Whether the rendered body scrolls vertically instead of growing. */
    scrollable?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    /** Markdown provider. `undefined` uses `window.marked`; `null` disables it. */
    marked?: MarkedLike | null;
    /** KaTeX instance for math, when math support is wanted. */
    katex?: KatexLike | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
}

interface MarkdownViewSerialized {
    type: 'MarkdownView';
    id: string;
    markdown: string;
    scrollable: boolean;
    title: string;
    icon: string | null;
    [key: string]: unknown;
}

/**
 * MarkdownView renders Markdown source to a safe HTML subset.
 *
 * It is the reusable view counterpart to the documentation-area renderer: it calls
 * {@link renderMarkdown} (which walks `marked.lexer()` and emits only an allowlisted
 * subset, never `marked.parse()`), so untrusted Markdown cannot introduce markup or
 * script. When no `marked` provider is available the source is shown as escaped text.
 *
 * @example
 * const view = new MarkdownView({ markdown: '## Help\n\n- **bold** point' });
 * view.attachTo(host);
 */
export class MarkdownView extends ViewBase {
    #markdown: string;
    #scrollable: boolean;
    #marked: MarkedLike | null | undefined;
    #katex: KatexLike | null | undefined;

    constructor({
        markdown = '',
        scrollable = true,
        title = 'Markdown',
        icon = null,
        id = null,
        marked,
        katex,
        logger = null,
        i18nService = null,
    }: MarkdownViewOptions = {}) {
        super({ title, icon, id, logger, i18nService });

        this.#markdown = String(markdown ?? '');
        this.#scrollable = Boolean(scrollable);
        this.#marked = marked;
        this.#katex = katex;
    }

    /**
     * Current Markdown source.
     * @returns {string} The Markdown text.
     */
    get markdown(): string {
        return this.#markdown;
    }

    /**
     * Replace the Markdown source and re-render when attached.
     * @param {string} value - New Markdown source.
     */
    set markdown(value: string) {
        this.setMarkdown(value);
    }

    /**
     * Replace the Markdown source and re-render when attached.
     * @param {unknown} value - New Markdown source (coerced to a string).
     * @returns {void}
     */
    setMarkdown(value: unknown): void {
        this.#markdown = String(value ?? '');
        if (this.isAttached && this._container) {
            this.render(this._container);
        }
    }

    /**
     * Current Markdown source.
     * @returns {string} The Markdown text.
     */
    getMarkdown(): string {
        return this.#markdown;
    }

    render(container: HTMLElement): void {
        void container;

        const wrapper = document.createElement('div');
        wrapper.className = 'view-markdown';
        if (this.#scrollable) {
            wrapper.classList.add('view-markdown--scrollable');
        }

        const result: MarkdownRenderResult = renderMarkdown(this.#markdown, {
            marked: this.#marked,
            katex: this.#katex ?? null,
        });
        wrapper.innerHTML = result.html;

        this.mountContent(wrapper);
        this._log('markdown-rendered', {
            length: this.#markdown.length,
            scrollable: this.#scrollable,
            hasMath: result.hasMath,
        });
    }

    serialize(): MarkdownViewSerialized {
        const base = super.serialize();
        return {
            ...base,
            type: 'MarkdownView',
            id: this.id,
            markdown: this.#markdown,
            scrollable: this.#scrollable,
            title: this.title,
            icon: this.icon,
        };
    }

    /**
     * Rehydrate a `MarkdownView` from serialized data.
     * @param {Record<string, unknown>} data Serialized view state.
     * @param {unknown} _viewFactory Unused child factory kept for the `ViewFactory` contract.
     * @param {Record<string, unknown>} context Injected `i18nService` / `logger`.
     * @returns {MarkdownView} Restored view.
     */
    static deserialize(
        data: Record<string, unknown> = {},
        _viewFactory: unknown = null,
        context: Record<string, unknown> = {}
    ): MarkdownView {
        void _viewFactory;

        const { markdown = '', scrollable = true, title = 'Markdown', icon = null, id = null } = data;
        const i18nService = (context.i18nService ?? null) as MarkdownViewOptions['i18nService'];
        const logger = (context.logger ?? null) as MarkdownViewOptions['logger'];

        return new MarkdownView({
            markdown: typeof markdown === 'string' ? markdown : String(markdown ?? ''),
            scrollable: scrollable !== false,
            title: typeof title === 'string' ? title : 'Markdown',
            icon: typeof icon === 'string' ? icon : null,
            id: typeof id === 'string' ? id : null,
            i18nService,
            logger,
        });
    }
}
