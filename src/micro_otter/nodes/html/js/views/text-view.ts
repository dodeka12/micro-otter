import { ViewBase } from './view-base.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

export interface TextViewOptions {
    text?: string;
    scrollable?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
}

export interface TextViewSerialized {
    type: 'TextView';
    text: string;
    scrollable: boolean;
    id: string;
    title: string;
    icon: string | null;
    [key: string]: unknown;
}

export interface TextViewUpdateOptions {
    /**
     * Treat the text as a growing log: keep its end in view while the reader sits
     * at the end, and hold the reader's offset while they sit anywhere else.
     *
     * An update rebuilds the rendered content, so without this option every
     * update starts again from the top: a reader of a log that is still being
     * written would only ever see its first line.
     */
    follow?: boolean;
}

/** How far from the end, in pixels, a reader still counts as reading the end. */
const FOLLOW_END_TOLERANCE_PX = 50;

/** The reader's scroll position, captured before a text update rebuilds the text. */
interface TextViewScrollSnapshot {
    /** Offset the reader had scrolled to. */
    top: number;
    /** Whether the reader sat at the end of the text. */
    atEnd: boolean;
}

/**
 * TextView renders plain text content with wrapping and optional vertical scrolling.
 */
export class TextView extends ViewBase {
    text: string;
    scrollable: boolean;

    /**
     * Offset a followed update pinned the text to, or `null` while the view has
     * pinned nothing.
     *
     * A pin is the view's own placement, so the next update can tell "the reader
     * left it alone" from "the reader scrolled away": a collapsed or empty box
     * reports no geometry at all, and only this record keeps a log following its
     * tail across a section being expanded.
     */
    #pinnedTop: number | null = null;

    constructor({
        text = '',
        scrollable = true,
        title = 'Text',
        icon = null,
        id = null,
        logger = null,
    }: TextViewOptions = {}) {
        super({ title, icon, id, logger });
        this.text = text;
        this.scrollable = scrollable;
    }

    /**
     * Replace the rendered text.
     *
     * With ``follow`` the view behaves like a console log: a reader who sits at
     * the end keeps the end in view after the update, and a reader who scrolled
     * back keeps the offset they were reading.
     */
    setText(text: unknown, options: TextViewUpdateOptions = {}): void {
        const snapshot = options.follow === true ? this.#captureScroll() : null;
        if (snapshot === null) {
            this.#pinnedTop = null;
        }
        this.text = String(text ?? '');
        if (this.container) {
            this.render(this.container);
        }
        if (snapshot !== null) {
            this.#restoreScroll(snapshot);
        }
    }

    getText(): string {
        return this.text;
    }

    /**
     * Return the element that scrolls this view's text, or `null` while the view is
     * unattached.
     *
     * `CodeView` overrides this: its text scrolls inside the rendered wrapper
     * instead of in the wrapper itself.
     */
    protected _scrollElement(): HTMLElement | null {
        // The rendered content is the only child, and for an HTML document it is
        // always an HTMLElement (`firstElementChild` alone allows any Element).
        return (this.container?.firstElementChild as HTMLElement | null | undefined) ?? null;
    }

    /** Capture the reader's scroll position before the text is rebuilt. */
    #captureScroll(): TextViewScrollSnapshot | null {
        const element = this._scrollElement();
        if (!element) {
            return null;
        }
        const top = element.scrollTop;
        const distanceToEnd = element.scrollHeight - top - element.clientHeight;
        return {
            top,
            // Sitting at the end, or sitting exactly where the last update put the
            // reader (a collapsed box reports 0/0/0 for both, so the pin is the
            // only thing that keeps a hidden log following once it is expanded).
            atEnd: distanceToEnd <= FOLLOW_END_TOLERANCE_PX || top === this.#pinnedTop,
        };
    }

    /** Apply a captured position, pinning the end when the reader was there. */
    #restoreScroll(snapshot: TextViewScrollSnapshot): void {
        const element = this._scrollElement();
        if (!element) {
            return;
        }
        if (!snapshot.atEnd) {
            element.scrollTop = snapshot.top;
            return;
        }
        element.scrollTop = element.scrollHeight;
        // Read the offset back: a browser clamps it to the real scroll range.
        this.#pinnedTop = element.scrollTop;
    }

    render(container: HTMLElement): void {
        void container;
        const wrapper: HTMLDivElement = document.createElement('div');
        wrapper.className = 'view-text';
        wrapper.style.overflowY = this.scrollable ? 'auto' : 'hidden';
        wrapper.textContent = this.text;
        this.mountContent(wrapper);
        this._log('render', { length: this.text.length, scrollable: this.scrollable });
    }

    serialize(): TextViewSerialized {
        const base = super.serialize();
        return {
            ...base,
            type: 'TextView',
            id: this.id,
            text: this.text,
            scrollable: this.scrollable,
        };
    }

    static deserialize(data: TextViewOptions = {}): TextView {
        const { text = '', scrollable = true, title = 'Text', icon = null, id = null } = data;
        return new TextView({ text, scrollable, title, icon, id });
    }
}
