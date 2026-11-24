// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file MessageView - Short informational, status, or error text.
 * @module views/message-view
 */

import { ViewBase } from './view-base.js';

type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;

/** Visual tone of a message. */
export type MessageViewTone = 'default' | 'muted' | 'info' | 'success' | 'warning' | 'error';

/** Surface variant of a message. */
export type MessageViewVariant = 'plain' | 'panel';

/** Accessibility role of a message region. */
export type MessageViewRole = 'status' | 'alert' | 'none';

/** Options accepted by {@link MessageView}. */
export interface MessageViewOptions extends ViewBaseOptions {
    /** Message text. */
    text?: string;
    /** Visual tone; defaults to `default`. */
    tone?: MessageViewTone;
    /** `plain` inline text or `panel` bordered surface; defaults to `plain`. */
    variant?: MessageViewVariant;
    /** ARIA role; `status`/`alert` also set a matching live region. */
    role?: MessageViewRole;
    /** Start hidden. */
    hidden?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: ViewBaseOptions['logger'];
    i18nService?: ViewBaseOptions['i18nService'];
}

/**
 * MessageView renders a short piece of text with semantic tone and an optional
 * panel surface. It is deliberately text-only: longer help content belongs in
 * `MarkdownView`, progress belongs in `ProgressBarView` (text-only) or `ProgressDetailView`
 * (determinate tiers).
 */
export class MessageView extends ViewBase {
    private _text: string;
    private _tone: MessageViewTone;
    private _variant: MessageViewVariant;
    private _role: MessageViewRole;
    private _hidden: boolean;
    private _root: HTMLDivElement | null;

    /**
     * @param {MessageViewOptions} options Message configuration.
     */
    constructor({
        text = '',
        tone = 'default',
        variant = 'plain',
        role = 'none',
        hidden = false,
        title = 'Message',
        icon = null,
        id = null,
        logger = null,
        i18nService = null,
        ...rest
    }: MessageViewOptions = {}) {
        super({ title, icon, id, logger, i18nService, ...rest });

        this._text = String(text ?? '');
        this._tone = normalizeTone(tone);
        this._variant = variant === 'panel' ? 'panel' : 'plain';
        this._role = normalizeRole(role);
        this._hidden = Boolean(hidden);
        this._root = null;
    }

    /** Return the current text. */
    get text(): string {
        return this._text;
    }

    /** Set the message text and update the rendered element. */
    set text(value: string) {
        this._text = String(value ?? '');
        if (this._root) {
            this._root.textContent = this._text;
        }
    }

    /** Return the current tone. */
    get tone(): MessageViewTone {
        return this._tone;
    }

    /** Return the current surface variant. */
    get variant(): MessageViewVariant {
        return this._variant;
    }

    /** Return the current ARIA role. */
    get role(): MessageViewRole {
        return this._role;
    }

    /** Return whether the message is hidden. */
    get hidden(): boolean {
        return this._hidden;
    }

    /**
     * Replace the message text.
     * @param {string} text New text.
     */
    setText(text: string): void {
        this.text = text;
    }

    /**
     * Replace the visual tone.
     * @param {MessageViewTone} tone New tone.
     */
    setTone(tone: MessageViewTone): void {
        this._tone = normalizeTone(tone);
        this._syncClasses();
    }

    /**
     * Replace the surface variant.
     * @param {MessageViewVariant} variant New variant.
     */
    setVariant(variant: MessageViewVariant): void {
        this._variant = variant === 'panel' ? 'panel' : 'plain';
        this._syncClasses();
    }

    /**
     * Replace the accessibility role.
     * @param {MessageViewRole} role New role.
     */
    setRole(role: MessageViewRole): void {
        this._role = normalizeRole(role);
        this._syncRole();
    }

    /**
     * Show or hide the message.
     * @param {boolean} hidden New hidden state.
     */
    setHidden(hidden: boolean): void {
        this._hidden = Boolean(hidden);
        if (this._root) {
            this._root.hidden = this._hidden;
        }
    }

    /** Build the message element. */
    render(container: HTMLElement): void {
        const root = document.createElement('div');
        root.className = this._buildClassName();
        root.textContent = this._text;
        root.hidden = this._hidden;

        this._root = root;
        this._syncRole();
        container.replaceChildren(root);
        this._log('render', { tone: this._tone, variant: this._variant });
    }

    /** Detach the rendered root. */
    override beforeDetach(): void {
        super.beforeDetach();
        this._root = null;
    }

    /** Apply the tone and variant classes to the rendered root. */
    private _syncClasses(): void {
        if (!this._root) {
            return;
        }
        this._root.className = this._buildClassName();
    }

    /** Apply or remove the ARIA role and live-region attributes. */
    private _syncRole(): void {
        if (!this._root) {
            return;
        }

        if (this._role === 'none') {
            this._root.removeAttribute('role');
            this._root.removeAttribute('aria-live');
            return;
        }

        this._root.setAttribute('role', this._role);
        this._root.setAttribute('aria-live', this._role === 'alert' ? 'assertive' : 'polite');
    }

    /** Build the root class list from tone and variant. */
    private _buildClassName(): string {
        return [
            'message-view',
            `message-view--${this._tone}`,
            `message-view--${this._variant}`,
        ].join(' ');
    }

    /** Serialize the message configuration. */
    serialize(): ReturnType<ViewBase['serialize']> {
        return {
            ...super.serialize(),
            type: 'MessageView',
            text: this._text,
            tone: this._tone,
            variant: this._variant,
            role: this._role,
            hidden: this._hidden,
        };
    }

    /**
     * Deserialize a message view.
     * @param {MessageViewOptions} data Serialized message data.
     * @returns {MessageView} Restored message view.
     */
    static override deserialize(data: MessageViewOptions = {}): MessageView {
        return new MessageView(data);
    }
}

/**
 * Normalize a tone value.
 * @param {unknown} tone Candidate tone.
 * @returns {MessageViewTone} A valid tone.
 */
function normalizeTone(tone: unknown): MessageViewTone {
    switch (tone) {
        case 'muted':
        case 'info':
        case 'success':
        case 'warning':
        case 'error':
            return tone;
        default:
            return 'default';
    }
}

/**
 * Normalize an ARIA role value.
 * @param {unknown} role Candidate role.
 * @returns {MessageViewRole} A valid role.
 */
function normalizeRole(role: unknown): MessageViewRole {
    return role === 'status' || role === 'alert' ? role : 'none';
}
