import { TextView, type TextViewUpdateOptions } from './text-view.js';

type TextViewOptions = ConstructorParameters<typeof TextView>[0];
type LoggerLike = TextViewOptions extends { logger?: infer T } ? T : unknown;

interface PrismLike {
    highlightElement: (element: Element) => void;
}

declare global {
    interface Window {
        Prism?: PrismLike;
    }
}

export interface CodeViewOptions {
    code?: string;
    language?: string;
    showLineNumbers?: boolean;
    scrollable?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    i18nService?: unknown;
    logger?: LoggerLike;
}

export type CodeViewSerialized = Omit<ReturnType<TextView['serialize']>, 'type'> & {
    type: 'CodeView';
    language: string;
    showLineNumbers: boolean;
};

interface CodeViewDeserializeData {
    text?: string;
    language?: string;
    showLineNumbers?: boolean;
    scrollable?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
}

interface CodeViewDeserializeContext {
    i18nService?: unknown;
    logger?: LoggerLike;
}

type CreateChildCallback = ((data: unknown, context?: unknown) => unknown) | null;

interface CodeViewHighlightPayload {
    language: string;
    length: number;
}

interface CodeViewRenderPayload extends CodeViewHighlightPayload {
    scrollable: boolean;
    lineNumbers: boolean;
}

export class CodeView extends TextView {
    #language: string;
    #showLineNumbers: boolean;
    #codeElement: HTMLElement | null = null;
    /** The element the rendered code scrolls in, rebuilt by every render. */
    #scrollElement: HTMLElement | null = null;

    constructor({
        code = '',
        language = 'python',
        showLineNumbers = false,
        scrollable = true,
        title = 'Code',
        icon = null,
        id = null,
        i18nService = null,
        logger = null,
    }: CodeViewOptions = {}) {
        const textViewOptions = {
            text: code,
            scrollable,
            title,
            icon,
            id,
            i18nService,
            logger,
        } as unknown as TextViewOptions;

        super(textViewOptions);

        this.#language = language;
        this.#showLineNumbers = showLineNumbers;
    }

    /**
     * Replace the rendered code.
     *
     * `options.follow` keeps the end in view while the reader sits there, so a
     * code view that is fed a tool's output behaves like a console log.
     */
    setCode(code: string, options: TextViewUpdateOptions = {}): void {
        this.setText(code, options);
    }

    getCode(): string {
        return this.getText();
    }

    /**
     * Return the element that scrolls the rendered code.
     *
     * The scrollable element sits inside `.view-code`, because the outer wrapper
     * is sized to its container and never scrolls itself.
     */
    protected override _scrollElement(): HTMLElement | null {
        return this.#scrollElement ?? super._scrollElement();
    }

    setLanguage(language: string): void {
        this.#language = language;
        if (this.container) {
            this.render(this.container);
        }
    }

    getLanguage(): string {
        return this.#language;
    }

    setShowLineNumbers(show: boolean): void {
        this.#showLineNumbers = Boolean(show);
        if (this.container) {
            this.render(this.container);
        }
    }

    override render(container: HTMLElement): void {
        void container;

        const wrapper = document.createElement('div');
        wrapper.className = 'view-code';

        const scrollWrapper = document.createElement('div');
        scrollWrapper.className = 'view-code__scroll-wrapper';
        scrollWrapper.style.overflowY = this.scrollable ? 'auto' : 'hidden';
        scrollWrapper.style.overflowX = 'auto';
        this.#scrollElement = scrollWrapper;

        const preElement = document.createElement('pre');
        preElement.className = this.#showLineNumbers ? 'line-numbers' : '';

        this.#codeElement = document.createElement('code');
        this.#codeElement.className = `language-${this.#language}`;
        this.#codeElement.textContent = this.text;

        preElement.appendChild(this.#codeElement);
        scrollWrapper.appendChild(preElement);
        wrapper.appendChild(scrollWrapper);

        const highlightPayload: CodeViewHighlightPayload = {
            language: this.#language,
            length: this.text.length,
        };

        if (typeof window !== 'undefined' && window.Prism) {
            window.Prism.highlightElement(this.#codeElement);
            this._log('highlight-applied', highlightPayload);
        } else {
            this._log('prism-not-found', 'warn', {
                message: 'Prism.js not loaded, displaying without syntax highlighting',
            });
        }

        this.mountContent(wrapper);

        const renderPayload: CodeViewRenderPayload = {
            ...highlightPayload,
            scrollable: this.scrollable,
            lineNumbers: this.#showLineNumbers,
        };
        this._log('render', renderPayload);
    }

    override serialize(): ReturnType<TextView['serialize']> {
        const serialized: CodeViewSerialized = {
            ...super.serialize(),
            type: 'CodeView',
            language: this.#language,
            showLineNumbers: this.#showLineNumbers,
        };
        return serialized as unknown as ReturnType<TextView['serialize']>;
    }

    static deserialize(
        data: CodeViewDeserializeData = {},
        createChild: CreateChildCallback = null,
        context: CodeViewDeserializeContext = {},
    ): CodeView {
        void createChild;

        const {
            text = '',
            language = 'python',
            showLineNumbers = false,
            scrollable = true,
            title = 'Code',
            icon = null,
            id = null,
        } = data;

        const { i18nService = null, logger = null } = context;

        return new CodeView({
            code: text,
            language,
            showLineNumbers,
            scrollable,
            title,
            icon,
            id,
            i18nService,
            logger,
        });
    }
}
