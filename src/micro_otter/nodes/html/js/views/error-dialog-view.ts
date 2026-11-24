import { ModalDialogView } from './modal-dialog-view.js';

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

export interface ErrorDialogViewOptions {
    title?: string;
    message?: string;
    detail?: string | null;
    detailCollapsible?: boolean;
    icon?: string;
    confirmLabel?: string;
    id?: string | null;
    logger?: LoggerLike;
    i18nService?: I18nServiceLike;
}

export interface ErrorDialogViewSerialized {
    type: 'ErrorDialogView';
    message: string;
    detail: string | null;
    detailCollapsible: boolean;
    detailExpanded: boolean;
    [key: string]: unknown;
}

interface ErrorDialogViewDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
    message?: string;
    detail?: string | null;
    detailCollapsible?: boolean;
    confirmLabel?: string;
    detailExpanded?: boolean;
}

export class ErrorDialogView extends ModalDialogView {
    message: string;
    detail: string | null;
    detailCollapsible: boolean;

    private _detailExpanded: boolean;
    private _confirmLabelOverride: string | undefined;
    private _confirmBtn: HTMLButtonElement | null;
    private _toggleBtn: HTMLButtonElement | null;

    constructor({
        title = 'Error',
        message = '',
        detail = null,
        detailCollapsible = true,
        icon = '❌',
        confirmLabel,
        id = null,
        logger = null,
        i18nService = null,
    }: ErrorDialogViewOptions = {}) {
        super({
            title,
            icon,
            confirmLabel: confirmLabel || 'OK',
            showCancel: false,
            id,
            logger,
            i18nService,
        });
        this.message = String(message);
        this.detail = detail !== null && detail !== undefined ? String(detail) : null;
        this.detailCollapsible = Boolean(detailCollapsible);
        this._detailExpanded = false;
        this._confirmLabelOverride = confirmLabel;
        this._confirmBtn = null;
        this._toggleBtn = null;
    }

    private _getConfirmLabel(): string {
        return this._confirmLabelOverride || this.t('dialog.ok');
    }

    protected override _buildFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'modal-dialog__footer';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'modal-dialog__btn modal-dialog__btn--primary';
        confirmBtn.textContent = this._getConfirmLabel();
        confirmBtn.addEventListener('click', () => this.confirm());
        footer.appendChild(confirmBtn);
        this._confirmBtn = confirmBtn;

        return footer;
    }

    private _updateLabels(): void {
        if (this._confirmBtn) {
            this._confirmBtn.textContent = this._getConfirmLabel();
        }
        if (this._toggleBtn) {
            this._toggleBtn.textContent = this._detailExpanded
                ? this.t('dialog.hideDetails')
                : this.t('dialog.showDetails');
        }
    }

    override afterAttach(): void {
        super.afterAttach();
        this._subscribeToLanguageChanges(() => this._updateLabels());
    }

    protected override _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body';

        if (this.message) {
            const messageEl = document.createElement('p');
            messageEl.className = 'error-dialog__message';
            messageEl.textContent = this.message;
            body.appendChild(messageEl);
        }

        if (this.detail) {
            if (this.detailCollapsible) {
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'error-dialog__toggle';
                toggleBtn.textContent = this.t('dialog.showDetails');

                const detailEl = document.createElement('pre');
                detailEl.className = 'error-dialog__detail';
                detailEl.textContent = this.detail;
                detailEl.style.display = 'none';

                toggleBtn.addEventListener('click', () => {
                    this._detailExpanded = !this._detailExpanded;
                    if (this._detailExpanded) {
                        toggleBtn.textContent = this.t('dialog.hideDetails');
                        detailEl.style.display = 'block';
                    } else {
                        toggleBtn.textContent = this.t('dialog.showDetails');
                        detailEl.style.display = 'none';
                    }
                });

                body.appendChild(toggleBtn);
                this._toggleBtn = toggleBtn;
                body.appendChild(detailEl);
            } else {
                const detailEl = document.createElement('pre');
                detailEl.className = 'error-dialog__detail';
                detailEl.textContent = this.detail;
                body.appendChild(detailEl);
            }
        }

        return body;
    }

    override serialize(): ErrorDialogViewSerialized {
        return {
            ...super.serialize(),
            type: 'ErrorDialogView',
            message: this.message,
            detail: this.detail,
            detailCollapsible: this.detailCollapsible,
            detailExpanded: this._detailExpanded,
        };
    }

    static deserialize(
        data: ErrorDialogViewDeserializeData,
        logger: LoggerLike = null,
    ): ErrorDialogView {
        const dialog = new ErrorDialogView({
            title: data.title,
            icon: data.icon ?? undefined,
            id: data.id,
            message: data.message,
            detail: data.detail,
            detailCollapsible: data.detailCollapsible,
            confirmLabel: data.confirmLabel,
            logger,
        });
        dialog._detailExpanded = data.detailExpanded || false;
        return dialog;
    }
}