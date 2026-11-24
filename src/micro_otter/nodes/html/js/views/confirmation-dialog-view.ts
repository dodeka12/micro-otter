import { ModalDialogView } from './modal-dialog-view.js';
import { DataTableView } from './data-table-view.js';
import type {
    DataTableColumn,
    DataTableRow,
} from './data-table-view.js';

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];
type LoggerLike = ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;

/**
 * Optional tabular content rendered inside a confirmation dialog.
 *
 * Reuses {@link DataTableView} so any table in a dialog follows the same themed,
 * dense look as the rest of the app instead of a hand-rolled `<table>`.
 */
export interface ConfirmationDialogTable {
    columns?: DataTableColumn[];
    rows?: DataTableRow[];
    caption?: string | number | null;
    header?: boolean | null;
    dense?: boolean;
    striped?: boolean;
    fixed?: boolean;
}

export interface ConfirmationDialogViewOptions {
    title?: string;
    message?: string;
    detail?: string | null;
    icon?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    disableEscape?: boolean;
    showCancel?: boolean;
    checkboxLabel?: string;
    checkboxChecked?: boolean;
    table?: ConfirmationDialogTable | null;
    id?: string | null;
    logger?: LoggerLike;
    i18nService?: I18nServiceLike;
}

export interface ConfirmationDialogViewSerialized {
    type: 'ConfirmationDialogView';
    message: string;
    detail: string | null;
    checkboxLabel: string | null;
    checkboxChecked: boolean;
    [key: string]: unknown;
}

interface ConfirmationDialogViewDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
    message?: string;
    detail?: string | null;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
    destructive?: boolean;
    disableEscape?: boolean;
    checkboxLabel?: string | null;
    checkboxChecked?: boolean;
}

export class ConfirmationDialogView extends ModalDialogView {
    message: string;
    detail: string | null;
    checkboxLabel: string;
    table: ConfirmationDialogTable | null;

    private _confirmLabelOverride: string | undefined;
    private _cancelLabelOverride: string | undefined;
    private _confirmBtn: HTMLButtonElement | null;
    private _cancelBtn: HTMLButtonElement | null;
    private _checkboxCheckedInitial: boolean;
    private _checkboxInput: HTMLInputElement | null;
    private _tableView: DataTableView | null;

    constructor({
        title = 'Confirm',
        message = '',
        detail = null,
        icon = '⚠️',
        confirmLabel,
        cancelLabel,
        destructive = false,
        disableEscape = false,
        showCancel = true,
        checkboxLabel = '',
        checkboxChecked = false,
        table = null,
        id = null,
        logger = null,
        i18nService = null,
    }: ConfirmationDialogViewOptions = {}) {
        super({
            title,
            icon,
            confirmLabel: confirmLabel || 'Confirm',
            cancelLabel: cancelLabel || 'Cancel',
            showCancel,
            destructive,
            disableEscape,
            id,
            logger,
            i18nService,
        });
        this.message = String(message);
        this.detail = detail !== null && detail !== undefined ? String(detail) : null;
        this.checkboxLabel = typeof checkboxLabel === 'string' ? checkboxLabel.trim() : '';
        this.table = table ?? null;
        this._confirmLabelOverride = confirmLabel;
        this._cancelLabelOverride = cancelLabel;
        this._confirmBtn = null;
        this._cancelBtn = null;
        this._checkboxCheckedInitial = Boolean(checkboxChecked);
        this._checkboxInput = null;
        this._tableView = null;
    }

    /**
     * Current state of the optional checkbox.
     * Returns the initial value before the dialog is attached and `false` when the dialog has
     * no checkbox at all, so callers never need to touch the DOM.
     * @returns {boolean} True when the user ticked the checkbox
     */
    get checkboxChecked(): boolean {
        return this._checkboxInput ? this._checkboxInput.checked : this._checkboxCheckedInitial;
    }

    private _getConfirmLabel(): string {
        return this._confirmLabelOverride || this.t('dialog.confirm');
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

    override beforeDetach(): void {
        if (this._tableView) {
            this._tableView.detach();
            this._tableView = null;
        }
        super.beforeDetach();
    }

    protected override _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body';

        if (this.message) {
            const messageEl = document.createElement('p');
            messageEl.className = 'confirmation-dialog__message';
            messageEl.textContent = this.message;
            body.appendChild(messageEl);
        }

        if (this.table) {
            const tableHost = document.createElement('div');
            tableHost.className = 'confirmation-dialog__table';
            const tableView = new DataTableView(this.table);
            tableView.attachTo(tableHost);
            this._tableView = tableView;
            body.appendChild(tableHost);
        }

        if (this.detail) {
            const detailEl = document.createElement('p');
            detailEl.className = 'confirmation-dialog__detail';
            detailEl.textContent = this.detail;
            body.appendChild(detailEl);
        }

        if (this.checkboxLabel) {
            const optionEl = document.createElement('label');
            optionEl.className = 'confirmation-dialog__option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'confirmation-dialog__checkbox';
            checkbox.checked = this._checkboxCheckedInitial;

            const labelText = document.createElement('span');
            labelText.textContent = this.checkboxLabel;

            optionEl.appendChild(checkbox);
            optionEl.appendChild(labelText);
            body.appendChild(optionEl);
            this._checkboxInput = checkbox;
        }

        return body;
    }

    override serialize(): ConfirmationDialogViewSerialized {
        return {
            ...super.serialize(),
            type: 'ConfirmationDialogView',
            message: this.message,
            detail: this.detail,
            checkboxLabel: this.checkboxLabel || null,
            checkboxChecked: this.checkboxChecked,
        };
    }

    static deserialize(
        data: ConfirmationDialogViewDeserializeData,
        logger: LoggerLike = null,
    ): ConfirmationDialogView {
        return new ConfirmationDialogView({
            title: data.title,
            icon: data.icon ?? undefined,
            id: data.id,
            message: data.message,
            detail: data.detail,
            confirmLabel: data.confirmLabel,
            cancelLabel: data.cancelLabel,
            showCancel: data.showCancel,
            destructive: data.destructive,
            disableEscape: data.disableEscape,
            checkboxLabel: data.checkboxLabel ?? undefined,
            checkboxChecked: data.checkboxChecked,
            logger,
        });
    }
}
