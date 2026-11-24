import { ModalDialogView } from './modal-dialog-view.js';

type ModalDialogViewOptions = ConstructorParameters<typeof ModalDialogView>[0];

type FormFieldValue = string | boolean;
export type FormFieldResultValue = FormFieldValue | null;

export interface FormFieldChangePayload {
    fieldId: string;
    value: FormFieldResultValue;
    event: Event;
}

export interface FormDropdownOptionObject {
    value: string;
    label?: string;
}

export type FormDropdownOption = FormDropdownOptionObject | string;

export interface FormFieldDefinition {
    id: string;
    type: 'text' | 'dropdown' | 'checkbox' | string;
    label: string;
    /** Optional explanation rendered under the control and linked via `aria-describedby`. */
    description?: string;
    required?: boolean;
    value?: unknown;
    defaultValue?: unknown;
    default?: unknown;
    options?: FormDropdownOption[];
    validator?: (value: FormFieldValue) => boolean | string | undefined;
    placeholder?: string;
    readonly?: boolean;
    multiline?: boolean;
    rows?: number;
    onChange?: (value: FormFieldResultValue, dialog: FormDialogView) => void;
}

export interface FormDialogOptions {
    title?: string;
    message?: string | null;
    fields?: FormFieldDefinition[];
    icon?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    id?: string | null;
    logger?: ModalDialogViewOptions extends { logger?: infer T } ? T : unknown;
    i18nService?: ModalDialogViewOptions extends { i18nService?: infer T } ? T : unknown;
}

export interface SetDropdownOptionsConfig {
    includeEmpty?: boolean;
    selectedValue?: string | null;
}

export interface FormDialogSerialized extends Record<string, unknown> {
    title?: string;
    icon?: string | null;
    id?: string | null;
    message?: string | null;
    fields: FormFieldDefinition[];
    confirmLabel?: string;
    cancelLabel?: string;
    formData?: Record<string, FormFieldValue>;
}

type FormInputElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Generic form dialog with field validation.
 */
export class FormDialogView extends ModalDialogView {
    message: string | null;
    fields: FormFieldDefinition[];

    private _inputs: Map<string, FormInputElement>;
    private _errors: Map<string, HTMLDivElement>;
    private _confirmLabelOverride: string | undefined;
    private _cancelLabelOverride: string | undefined;
    private _confirmBtn: HTMLButtonElement | null;
    private _cancelBtn: HTMLButtonElement | null;

    constructor({
        title = 'Form',
        message = null,
        fields = [],
        icon = '📝',
        confirmLabel,
        cancelLabel,
        id = null,
        logger = null,
        i18nService = null,
    }: FormDialogOptions = {}) {
        super({
            title,
            icon,
            confirmLabel: confirmLabel || 'Submit',
            cancelLabel: cancelLabel || 'Cancel',
            id,
            logger,
            i18nService,
        });
        this.message = message !== null && message !== undefined ? String(message) : null;
        this.fields = fields;
        this._inputs = new Map();
        this._errors = new Map();
        this._confirmLabelOverride = confirmLabel;
        this._cancelLabelOverride = cancelLabel;
        this._confirmBtn = null;
        this._cancelBtn = null;
    }

    _getConfirmLabel(): string {
        return this._confirmLabelOverride || this.t('dialog.submit');
    }

    _getCancelLabel(): string {
        return this._cancelLabelOverride || this.t('dialog.cancel');
    }

    _buildFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'modal-dialog__footer';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'modal-dialog__btn modal-dialog__btn--primary';
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

    _updateButtonLabels(): void {
        if (this._confirmBtn) {
            this._confirmBtn.textContent = this._getConfirmLabel();
        }
        if (this._cancelBtn) {
            this._cancelBtn.textContent = this._getCancelLabel();
        }
    }

    afterAttach(): void {
        super.afterAttach();
        this._subscribeToLanguageChanges(() => this._updateButtonLabels());
    }

    _buildBody(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'modal-dialog__body';

        if (this.message) {
            const messageEl = document.createElement('p');
            messageEl.className = 'form-dialog__message';
            messageEl.textContent = this.message;
            body.appendChild(messageEl);
        }

        const form = document.createElement('form');
        form.className = 'form-dialog__form';
        form.addEventListener('submit', (event: SubmitEvent) => {
            event.preventDefault();
            this.confirm();
        });

        for (const field of this.fields) {
            const fieldContainer = this._buildField(field);
            form.appendChild(fieldContainer);
        }

        body.appendChild(form);
        return body;
    }

    _buildField(field: FormFieldDefinition): HTMLElement {
        const container = document.createElement('div');
        container.className = 'form-dialog__field';

        const label = document.createElement('label');
        label.className = 'form-dialog__label';
        label.textContent = field.label;
        if (field.required) {
            label.textContent += ' *';
        }

        let input: FormInputElement | null = null;
        switch (field.type) {
            case 'text':
                input = this._buildTextInput(field);
                break;
            case 'dropdown':
                input = this._buildDropdown(field);
                break;
            case 'checkbox':
                input = this._buildCheckbox(field);
                label.className += ' form-dialog__label--checkbox';
                break;
            default:
                this._log(`Unknown field type: ${field.type}`);
                return container;
        }

        input.id = `form-field-${field.id}`;
        label.htmlFor = input.id;

        this._inputs.set(field.id, input);

        if (typeof field.onChange === 'function') {
            input.addEventListener('change', () => {
                const value = this.getFieldValue(field.id);
                field.onChange?.(value, this);
            });
        }

        const errorEl = document.createElement('div');
        errorEl.className = 'form-dialog__error';
        errorEl.style.display = 'none';
        this._errors.set(field.id, errorEl);

        if (field.type === 'checkbox') {
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.className = 'form-dialog__checkbox-wrapper';
            checkboxWrapper.appendChild(input);
            checkboxWrapper.appendChild(label);
            container.appendChild(checkboxWrapper);
        } else {
            container.appendChild(label);
            container.appendChild(input);
        }

        if (field.description) {
            container.appendChild(this._buildFieldHint(field, input));
        }

        container.appendChild(errorEl);

        return container;
    }

    /**
     * Build the optional per-field explanation shown under the control.
     *
     * The hint is linked through `aria-describedby` so assistive technology reads it together
     * with the control. Checkbox hints get an extra class that indents them under the label.
     * @param {FormFieldDefinition} field - Field definition supplying `description`
     * @param {FormInputElement} input - Control the hint describes
     * @returns {HTMLParagraphElement} Hint element
     * @private
     */
    _buildFieldHint(field: FormFieldDefinition, input: FormInputElement): HTMLParagraphElement {
        const hintEl = document.createElement('p');
        hintEl.className =
            field.type === 'checkbox'
                ? 'form-dialog__field-hint form-dialog__field-hint--checkbox'
                : 'form-dialog__field-hint';
        hintEl.id = `${input.id}-hint`;
        hintEl.textContent = String(field.description);
        input.setAttribute('aria-describedby', hintEl.id);
        return hintEl;
    }

    _buildTextInput(field: FormFieldDefinition): HTMLInputElement | HTMLTextAreaElement {
        if (field.multiline) {
            const input = document.createElement('textarea');
            input.className = 'form-dialog__input';
            input.required = field.required || false;

            if (field.placeholder) {
                input.placeholder = field.placeholder;
            }

            const initialValue = field.value !== undefined ? field.value : field.defaultValue;
            if (initialValue !== undefined) {
                input.value = String(initialValue);
            }

            if (field.readonly) {
                input.readOnly = true;
                input.classList.add('form-dialog__input--readonly');
            }

            if (field.rows) {
                input.rows = field.rows;
            } else {
                input.rows = 3;
            }

            return input;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-dialog__input';
        input.required = field.required || false;

        if (field.placeholder) {
            input.placeholder = field.placeholder;
        }

        const initialValue = field.value !== undefined ? field.value : field.defaultValue;
        if (initialValue !== undefined) {
            input.value = String(initialValue);
        }

        if (field.readonly) {
            input.readOnly = true;
            input.classList.add('form-dialog__input--readonly');
        }

        return input;
    }

    _buildDropdown(field: FormFieldDefinition): HTMLSelectElement {
        const select = document.createElement('select');
        select.className = 'form-dialog__select';
        select.required = field.required || false;

        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '-- Select --';
        select.appendChild(emptyOption);

        const options = field.options || [];
        for (const opt of options) {
            const option = document.createElement('option');
            if (typeof opt === 'string') {
                option.value = opt;
                option.textContent = opt;
            } else {
                option.value = opt.value;
                option.textContent = opt.label || opt.value;
            }
            select.appendChild(option);
        }

        const initialValue = field.default !== undefined ? field.default : field.defaultValue;
        if (initialValue !== undefined) {
            select.value = String(initialValue);
        }

        return select;
    }

    _buildCheckbox(field: FormFieldDefinition): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'form-dialog__checkbox';
        if (field.defaultValue !== undefined) {
            input.checked = Boolean(field.defaultValue);
        }
        return input;
    }

    getFieldValue(fieldId: string): FormFieldResultValue {
        const input = this._inputs.get(fieldId);
        if (!input) {
            return null;
        }
        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            return input.checked;
        }
        return input.value;
    }

    setFieldValue(fieldId: string, value: string | boolean): boolean {
        const input = this._inputs.get(fieldId);
        if (!input) {
            return false;
        }
        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            input.checked = Boolean(value);
        } else {
            input.value = String(value);
        }
        return true;
    }

    onFieldChange(fieldId: string, handler: (payload: FormFieldChangePayload) => void): () => void {
        if (typeof handler !== 'function') {
            throw new TypeError('Field change handler must be a function');
        }
        const input = this._inputs.get(fieldId);
        if (!input) {
            this._log('field-change-missing-input', 'warn', { fieldId });
            return () => {};
        }
        const listener = (event: Event) => {
            handler({ fieldId, value: this.getFieldValue(fieldId), event });
        };
        input.addEventListener('change', listener);
        return () => input.removeEventListener('change', listener);
    }

    setDropdownOptions(
        fieldId: string,
        options: FormDropdownOption[] = [],
        config: SetDropdownOptionsConfig = {}
    ): boolean {
        const input = this._inputs.get(fieldId);
        if (!(input instanceof HTMLSelectElement)) {
            this._log('set-dropdown-options-invalid', 'warn', { fieldId });
            return false;
        }

        const { includeEmpty = true, selectedValue = null } = config;
        input.innerHTML = '';

        if (includeEmpty) {
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '-- Select --';
            input.appendChild(emptyOption);
        }

        const normalized = Array.isArray(options) ? options : [];
        for (const opt of normalized) {
            const option = document.createElement('option');
            if (typeof opt === 'string') {
                option.value = opt;
                option.textContent = opt;
            } else {
                option.value = opt.value;
                option.textContent = opt.label || opt.value;
            }
            input.appendChild(option);
        }

        if (selectedValue !== null && selectedValue !== undefined) {
            input.value = String(selectedValue);
        } else if (normalized.length > 0) {
            const first = normalized[0];
            input.value = String(typeof first === 'string' ? first : first.value);
        } else if (includeEmpty) {
            input.value = '';
        }

        return true;
    }

    _validateForm(): boolean {
        let isValid = true;

        for (const field of this.fields) {
            const input = this._inputs.get(field.id);
            const errorEl = this._errors.get(field.id);

            if (!input || !errorEl) {
                continue;
            }

            const value: FormFieldValue =
                input instanceof HTMLInputElement && input.type === 'checkbox'
                    ? input.checked
                    : input.value;

            let errorMessage: string | null = null;

            if (field.required && field.type !== 'checkbox') {
                if (value === '' || value === null || value === undefined) {
                    errorMessage = 'This field is required.';
                }
            }

            if (!errorMessage && field.validator && typeof field.validator === 'function') {
                const result = field.validator(value);
                if (result !== true && result !== undefined) {
                    errorMessage = typeof result === 'string' ? result : 'Invalid value.';
                }
            }

            if (errorMessage) {
                errorEl.textContent = errorMessage;
                errorEl.style.display = 'block';
                input.classList.add('is-invalid');
                isValid = false;
            } else {
                errorEl.textContent = '';
                errorEl.style.display = 'none';
                input.classList.remove('is-invalid');
            }
        }

        return isValid;
    }

    _getFormData(): Record<string, FormFieldValue> {
        const data: Record<string, FormFieldValue> = {};
        for (const field of this.fields) {
            const input = this._inputs.get(field.id);
            if (!input) {
                continue;
            }

            if (input instanceof HTMLInputElement && input.type === 'checkbox') {
                data[field.id] = input.checked;
            } else {
                data[field.id] = input.value;
            }
        }
        return data;
    }

    _onConfirm(): { formData: Record<string, FormFieldValue> } {
        if (!this._validateForm()) {
            throw new Error('Form validation failed');
        }
        return { formData: this._getFormData() };
    }

    confirm(): void {
        try {
            super.confirm();
        } catch (err) {
            this._log('Validation prevented confirmation', err);
        }
    }

    serialize(): any {
        return {
            ...super.serialize(),
            type: 'FormDialogView',
            message: this.message,
            fields: this.fields,
            formData: this._getFormData(),
        };
    }

    static deserialize(...args: any[]): any {
        const data: FormDialogSerialized = args[0] ?? { fields: [] };
        const context = args[2] ?? {};
        const logger: FormDialogOptions['logger'] = context.logger ?? null;
        const sourceFields = Array.isArray(data.fields) ? data.fields : [];
        const fields = sourceFields.map((field) => {
            if (data.formData && data.formData[field.id] !== undefined) {
                return { ...field, defaultValue: data.formData[field.id] };
            }
            return field;
        });

        return new FormDialogView({
            title: data.title,
            icon: data.icon ?? '📝',
            id: data.id,
            message: data.message,
            fields,
            confirmLabel: data.confirmLabel,
            cancelLabel: data.cancelLabel,
            logger,
        });
    }
}
