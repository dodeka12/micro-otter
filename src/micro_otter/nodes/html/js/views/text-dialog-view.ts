import { ModalDialogView } from './modal-dialog-view.js';

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

type TextDialogCallbackReason = 'confirm' | 'cancel';

interface TextDialogCallbackPayload {
    reason: TextDialogCallbackReason;
    id: string;
}

export interface TextDialogViewOptions {
    title?: string;
    icon?: string | null;
    id?: string | null;
    message?: string;
    content?: unknown;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
    destructive?: boolean;
    disableEscape?: boolean;
    autofocus?: boolean;
    onConfirm?: ((payload: TextDialogCallbackPayload) => void) | null;
    onCancel?: ((payload: TextDialogCallbackPayload) => void) | null;
    logger?: LoggerLike;
    i18nService?: I18nServiceLike;
}

export interface TextDialogViewSerialized extends Record<string, unknown> {
    type: 'TextDialogView';
    message: string;
}

interface TextDialogViewDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
    destructive?: boolean;
    disableEscape?: boolean;
    autofocus?: boolean;
}

/**
 * TextDialogView renders a fixed dialog with message and optional content.
 * Extends ModalDialogView to provide backward-compatible message + content pattern.
 *
 * Supports optional callback handlers (onConfirm, onCancel) for backward compatibility.
 */
export class TextDialogView extends ModalDialogView {
    message: string;
    content: unknown;

    private _onConfirmCallback: ((payload: TextDialogCallbackPayload) => void) | null;
    private _onCancelCallback: ((payload: TextDialogCallbackPayload) => void) | null;
    private _confirmLabelOverride: string | undefined;
    private _cancelLabelOverride: string | undefined;
    private _confirmBtn: HTMLButtonElement | null;
    private _cancelBtn: HTMLButtonElement | null;

    constructor({
        title = 'Modal Dialog',
        icon = null,
        id = null,
        message = '',
        content = null,
        confirmLabel,
        cancelLabel,
        showCancel = true,
        destructive = false,
        disableEscape = false,
        autofocus = true,
        onConfirm = null,
        onCancel = null,
        logger = null,
        i18nService = null,
    }: TextDialogViewOptions = {}) {
        super({
            title,
            icon,
            id,
            confirmLabel: confirmLabel || 'OK',
            cancelLabel: cancelLabel || 'Cancel',
            showCancel,
            destructive,
            disableEscape,
            autofocus,
            logger,
            i18nService,
        });
        this.message = message;
        this.content = content;
        this._onConfirmCallback = typeof onConfirm === 'function' ? onConfirm : null;
        this._onCancelCallback = typeof onCancel === 'function' ? onCancel : null;
        this._confirmLabelOverride = confirmLabel;
        this._cancelLabelOverride = cancelLabel;
        this._confirmBtn = null;
        this._cancelBtn = null;
    }

    private _getConfirmLabel(): string {
        return this._confirmLabelOverride || this.t('dialog.ok');
    }

    private _getCancelLabel(): string {
        return this._cancelLabelOverride || this.t('dialog.cancel');
    }

    protected override _buildFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'modal-dialog__footer';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'modal-dialog__btn modal-dialog__btn--primary';
        if (this.destructive) {
            confirmBtn.classList.add('is-destructive');
        }
        confirmBtn.textContent = this._getConfirmLabel();
        confirmBtn.addEventListener('click', () => this.confirm());
        footer.appendChild(confirmBtn);
        this._confirmBtn = confirmBtn;

        if (this.showCancel) {
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'modal-dialog__btn modal-dialog__btn--ghost';
            cancelBtn.textContent = this._getCancelLabel();
            cancelBtn.addEventListener('click', () => this.cancel());
            footer.appendChild(cancelBtn);
            this._cancelBtn = cancelBtn;
        }

        return footer;
    }

    private _updateButtonLabels(): void {
        if (this._confirmBtn) {
            this._confirmBtn.textContent = this._getConfirmLabel();
        }
        if (this._cancelBtn) {
            this._cancelBtn.textContent = this._getCancelLabel();
        }
    }

    override afterAttach(): void {
        super.afterAttach();
        this._subscribeToLanguageChanges(() => this._updateButtonLabels());
    }

    protected override _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body';

        if (this.message) {
            const messageEl = document.createElement('p');
            messageEl.className = 'modal-dialog__message';
            messageEl.textContent = this.message;
            body.appendChild(messageEl);
        }

        if (this.content) {
            const contentNode =
                this.content instanceof Node
                    ? this.content
                    : (() => {
                          const wrapper = document.createElement('div');
                          wrapper.textContent = String(this.content);
                          return wrapper;
                      })();
            body.appendChild(contentNode);
        }

        return body;
    }

    protected override _onConfirm(): Record<string, never> {
        const payload = {};
        if (this._onConfirmCallback) {
            this._onConfirmCallback({ reason: 'confirm', id: this.id });
        }
        return payload;
    }

    protected override _onCancel(): Record<string, never> {
        const payload = {};
        if (this._onCancelCallback) {
            this._onCancelCallback({ reason: 'cancel', id: this.id });
        }
        return payload;
    }

    override serialize(): TextDialogViewSerialized {
        return {
            ...super.serialize(),
            type: 'TextDialogView',
            message: this.message,
        };
    }

    static deserialize(data: TextDialogViewDeserializeData = {}): TextDialogView {
        return new TextDialogView({
            title: data.title,
            icon: data.icon ?? undefined,
            id: data.id,
            message: data.message,
            confirmLabel: data.confirmLabel,
            cancelLabel: data.cancelLabel,
            showCancel: data.showCancel,
            destructive: data.destructive,
            disableEscape: data.disableEscape,
            autofocus: data.autofocus,
        });
    }
}
