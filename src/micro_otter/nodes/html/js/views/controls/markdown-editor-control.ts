// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Reusable editable-Markdown control for settings forms.
 *
 * Shows the Markdown as a rendered, allowlisted preview plus an **Edit** button. Clicking Edit
 * replaces the preview with a `<textarea>` and a **Done** button; committing (Done, blur, or
 * Ctrl/Cmd+Enter) re-renders the preview and fires `onChange` once with the new source, while
 * Escape restores the previous value without firing. The preview reuses the documentation-area
 * renderer (`renderAreaMarkdown`), so it is XSS-safe by construction and understands the same
 * `$…$` math fallback. The edit flow mirrors `GraphPanelDocumentationLayer`'s
 * `showEditor`/`commitEditor`/`cancelEditor` (`spellcheck=false`, commit on blur +
 * Ctrl/Cmd+Enter, Escape cancels); that canvas-specific layer is left untouched.
 *
 * @module views/controls/markdown-editor-control
 */

import { ViewBase } from '../view-base.js';
import { ButtonControl } from './custom-runtime-controls.js';
import { IconProvider } from '../icon-provider.js';
import { renderAreaMarkdown } from '../../core/render-documentation-markdown.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type LoggerLike = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;

/** Callback invoked after the user commits an edited value. */
export type MarkdownEditorChangeHandler = (value: string) => void;

export interface MarkdownEditorControlOptions {
    /** Visible title rendered above the preview; omitted leaves the control title-less. */
    label?: string;
    /** Initial Markdown source. */
    value?: string;
    /** Placeholder shown while the textarea is empty. */
    placeholder?: string;
    disabled?: boolean;
    /** Accessible/aria label for the Edit button; defaults to `controls.markdownEditor.edit`. */
    editLabel?: string;
    /** Accessible/aria label for the Done button; defaults to `controls.markdownEditor.done`. */
    doneLabel?: string;
    /** Hint shown when the value is empty; defaults to `controls.markdownEditor.empty`. */
    emptyText?: string;
    i18nService?: I18nServiceLike | null;
    logger?: LoggerLike | null;
}

/**
 * Rendered-preview + textarea Markdown editor.
 *
 * Extends ViewBase for the shared lifecycle, i18n and logging plumbing.
 */
export class MarkdownEditorControl extends ViewBase {
    private _label: string;
    private _value: string;
    private _placeholder: string;
    private _disabled: boolean;
    private _editLabel: string;
    private _doneLabel: string;
    private _emptyText: string;
    private _changeCallback: MarkdownEditorChangeHandler | null;

    private _rootElement: HTMLDivElement | null;
    private _labelElement: HTMLSpanElement | null;
    private _headerElement: HTMLDivElement | null;
    private _editButtonHost: HTMLDivElement | null;
    private _doneButtonHost: HTMLDivElement | null;
    private _editButton: ButtonControl | null;
    private _doneButton: ButtonControl | null;
    private _bodyElement: HTMLDivElement | null;
    private _previewElement: HTMLDivElement | null;
    private _emptyElement: HTMLDivElement | null;
    private _textarea: HTMLTextAreaElement | null;

    private _editing: boolean;

    private _boundHandleBlur: (event: FocusEvent) => void;
    private _boundHandleKeyDown: (event: KeyboardEvent) => void;

    constructor({
        label = '',
        value = '',
        placeholder = '',
        disabled = false,
        editLabel = '',
        doneLabel = '',
        emptyText = '',
        i18nService = null,
        logger = null,
    }: MarkdownEditorControlOptions = {}) {
        super({
            title: 'Markdown Editor',
            i18nService,
            logger,
        });

        this._label = label;
        this._value = value == null ? '' : String(value);
        this._placeholder = placeholder;
        this._disabled = !!disabled;
        this._editLabel = editLabel || this._text('controls.markdownEditor.edit', 'Edit');
        this._doneLabel = doneLabel || this._text('controls.markdownEditor.done', 'Done');
        this._emptyText = emptyText || this._text('controls.markdownEditor.empty', 'No description yet.');
        this._changeCallback = null;

        this._rootElement = null;
        this._labelElement = null;
        this._headerElement = null;
        this._editButtonHost = null;
        this._doneButtonHost = null;
        this._editButton = null;
        this._doneButton = null;
        this._bodyElement = null;
        this._previewElement = null;
        this._emptyElement = null;
        this._textarea = null;

        this._editing = false;

        this._boundHandleBlur = () => this._handleBlur();
        this._boundHandleKeyDown = (event: KeyboardEvent) => this._handleKeyDown(event);
    }

    /**
     * Render the control into a host element.
     * @param container - Host element that receives the `.markdown-editor` wrapper.
     */
    render(container: HTMLElement): void {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('MarkdownEditorControl.render requires a container HTMLElement.');
        }

        const root = document.createElement('div');
        root.className = 'markdown-editor';
        this._rootElement = root;

        if (this._label) {
            const label = document.createElement('span');
            label.className = 'markdown-editor__label';
            label.textContent = this._label;
            root.appendChild(label);
            this._labelElement = label;
        }

        const header = document.createElement('div');
        header.className = 'markdown-editor__header';
        root.appendChild(header);
        this._headerElement = header;

        this._editButtonHost = document.createElement('div');
        this._editButtonHost.className = 'markdown-editor__action';
        header.appendChild(this._editButtonHost);
        this._editButton = new ButtonControl({
            label: this._editLabel,
            icon: IconProvider.edit,
            iconOnly: true,
            style: 'secondary',
        });
        this._editButton.render(this._editButtonHost);
        this._editButton.onClick(() => this._enterEdit());

        this._doneButtonHost = document.createElement('div');
        this._doneButtonHost.className = 'markdown-editor__action';
        this._doneButtonHost.hidden = true;
        header.appendChild(this._doneButtonHost);
        this._doneButton = new ButtonControl({
            label: this._doneLabel,
            icon: IconProvider.check,
            iconOnly: true,
            style: 'secondary',
        });
        this._doneButton.render(this._doneButtonHost);
        this._doneButton.onClick(() => this._commit());

        const body = document.createElement('div');
        body.className = 'markdown-editor__body';
        root.appendChild(body);
        this._bodyElement = body;

        const preview = document.createElement('div');
        preview.className = 'markdown-editor__preview';
        body.appendChild(preview);
        this._previewElement = preview;

        const empty = document.createElement('div');
        empty.className = 'markdown-editor__empty';
        empty.textContent = this._emptyText;
        body.appendChild(empty);
        this._emptyElement = empty;

        const textarea = document.createElement('textarea');
        textarea.className = 'markdown-editor__textarea';
        textarea.spellcheck = false;
        textarea.placeholder = this._placeholder;
        textarea.hidden = true;
        textarea.addEventListener('blur', this._boundHandleBlur);
        textarea.addEventListener('keydown', this._boundHandleKeyDown);
        body.appendChild(textarea);
        this._textarea = textarea;

        container.appendChild(root);

        this._renderPreview();
        this._applyDisabledState();
    }

    /**
     * Current Markdown source.
     * @returns The stored value.
     */
    getValue(): string {
        return this._value;
    }

    /**
     * Replace the value from outside (undo, host refresh).
     *
     * Never fires `onChange`; while editing, the preview is left alone so the open
     * textarea keeps the user's draft.
     * @param value - New Markdown source; `null`/`undefined` clears it.
     */
    setValue(value: string | null | undefined): void {
        this._value = value == null ? '' : String(value);
        if (!this._editing) {
            this._renderPreview();
        }
    }

    /**
     * Enable or disable the control.
     * @param disabled - Whether the control accepts input.
     */
    setDisabled(disabled: boolean): void {
        this._disabled = !!disabled;
        this._applyDisabledState();
    }

    /**
     * Register the change callback after construction.
     * @param callback - Receives the committed value.
     */
    onChange(callback: MarkdownEditorChangeHandler | null): void {
        this._changeCallback = callback;
    }

    /**
     * Remove the textarea listeners and clear host references before the base teardown.
     */
    beforeDetach(): void {
        this._textarea?.removeEventListener('blur', this._boundHandleBlur);
        this._textarea?.removeEventListener('keydown', this._boundHandleKeyDown);

        this._rootElement = null;
        this._labelElement = null;
        this._headerElement = null;
        this._editButtonHost = null;
        this._doneButtonHost = null;
        this._editButton = null;
        this._doneButton = null;
        this._bodyElement = null;
        this._previewElement = null;
        this._emptyElement = null;
        this._textarea = null;
        this._editing = false;

        super.beforeDetach();
    }

    /**
     * Resolve one control string, falling back to an English default.
     * @param key - Locale key, e.g. `controls.markdownEditor.edit`.
     * @param fallback - English fallback when the key is missing or no i18n service exists.
     * @returns The localized string or the fallback.
     */
    private _text(key: string, fallback: string): string {
        const value = this.t(key);
        return !value || value === key ? fallback : value;
    }

    /**
     * Mirror the disabled flag onto the buttons, the textarea and the wrapper class.
     */
    private _applyDisabledState(): void {
        this._editButton?.setDisabled(this._disabled);
        this._doneButton?.setDisabled(this._disabled);
        if (this._textarea) {
            this._textarea.disabled = this._disabled;
        }
        this._rootElement?.classList.toggle('markdown-editor--disabled', this._disabled);
    }

    /**
     * Render the preview (or the empty hint) from the current value.
     */
    private _renderPreview(): void {
        if (!this._previewElement || !this._emptyElement) {
            return;
        }

        const hasContent = this._value.trim().length > 0;
        this._previewElement.hidden = !hasContent;
        this._emptyElement.hidden = hasContent;

        if (hasContent) {
            this._previewElement.innerHTML = renderAreaMarkdown(this._value).html;
        } else {
            this._previewElement.replaceChildren();
        }
    }

    /**
     * Swap the preview for the textarea and focus it.
     */
    private _enterEdit(): void {
        if (this._disabled || this._editing || !this._textarea) {
            return;
        }

        this._editing = true;
        this._textarea.value = this._value;
        this._previewElement?.toggleAttribute('hidden', true);
        this._emptyElement?.toggleAttribute('hidden', true);
        this._textarea.hidden = false;
        if (this._editButtonHost) {
            this._editButtonHost.hidden = true;
        }
        if (this._doneButtonHost) {
            this._doneButtonHost.hidden = false;
        }
        this._textarea.focus();
    }

    /**
     * Close edit mode and re-show the preview/empty state.
     */
    private _exitEdit(): void {
        if (!this._editing) {
            return;
        }

        this._editing = false;
        if (this._textarea) {
            this._textarea.hidden = true;
        }
        if (this._editButtonHost) {
            this._editButtonHost.hidden = false;
        }
        if (this._doneButtonHost) {
            this._doneButtonHost.hidden = true;
        }
        this._renderPreview();
    }

    /**
     * Commit the textarea content and fire `onChange` when it actually changed.
     */
    private _commit(): void {
        if (!this._editing || !this._textarea) {
            return;
        }

        const next = this._textarea.value;
        const changed = next !== this._value;
        this._value = next;
        this._exitEdit();
        if (changed && typeof this._changeCallback === 'function') {
            this._changeCallback(next);
        }
    }

    /**
     * Abandon the textarea content without firing `onChange`.
     */
    private _cancel(): void {
        if (!this._editing) {
            return;
        }
        this._exitEdit();
    }

    /**
     * Commit when the textarea loses focus (the documentation-area editor's blur contract).
     */
    private _handleBlur(): void {
        if (!this._editing) {
            return;
        }
        this._commit();
    }

    /**
     * Escape cancels, Ctrl/Cmd+Enter commits; other keys stay inside the textarea.
     * @param event - Keydown event of the textarea.
     */
    private _handleKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this._cancel();
            return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            this._commit();
            return;
        }
        event.stopPropagation();
    }
}
