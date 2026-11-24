// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file Standalone control classes for custom runtime view rendering.
 *
 * These controls are runtime-view specific and intentionally separated from
 * node editor control classes under `js/nodes/controls`.
 *
 * @module views/controls/custom-runtime-controls
 */

export interface BaseControlOptions<TValue = unknown> {
    label?: string;
    defaultValue?: TValue;
    disabled?: boolean;
}

type DisableCapableElement =
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLButtonElement
    | HTMLTextAreaElement
    | HTMLOptGroupElement
    | HTMLOptionElement
    | HTMLFieldSetElement;

function isDisableCapableElement(element: Element): element is DisableCapableElement {
    return 'disabled' in element;
}

abstract class BaseControl<TValue = unknown, TElement extends HTMLElement = HTMLElement> {
    _label: string;
    _value: TValue;
    _defaultValue: TValue;
    _disabled: boolean;
    _element: TElement | null;
    _changeCallback: ((value: TValue) => void) | null;

    constructor(options: BaseControlOptions<TValue> = {}) {
        if (new.target === BaseControl) {
            throw new TypeError('Cannot construct BaseControl instances directly');
        }

        this._label = options.label || '';
        this._value = options.defaultValue as TValue;
        this._defaultValue = options.defaultValue as TValue;
        this._disabled = options.disabled || false;
        this._element = null;
        this._changeCallback = null;
    }

    abstract render(container: HTMLElement): void;

    getValue(): TValue {
        return this._value;
    }

    setValue(value: TValue): void {
        this._value = value;
        if (this._element) {
            this._updateElement(value);
        }
    }

    setDisabled(disabled: boolean): void {
        this._disabled = !!disabled;
        if (this._element && isDisableCapableElement(this._element)) {
            this._element.disabled = this._disabled;
        }
    }

    protected _updateElement(_value: TValue): void {
        // Override in subclasses
    }

    onChange(callback: (value: TValue) => void): void {
        this._changeCallback = callback;
    }

    protected _notifyChange(value: TValue): void {
        this._value = value;
        if (this._changeCallback) {
            this._changeCallback(value);
        }
    }

    validate(): boolean {
        return true;
    }

    get element(): TElement | null {
        return this._element;
    }

    destroy(): void {
        if (this._element && this._element.parentNode) {
            this._element.parentNode.removeChild(this._element);
        }
        this._element = null;
        this._changeCallback = null;
    }
}

export interface TextControlValidation {
    required?: boolean;
    allowEmpty?: boolean;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
}

export interface TextControlOptions extends BaseControlOptions<unknown> {
    placeholder?: string;
    password?: boolean;
    readonly?: boolean;
    linkifyIpAddress?: boolean;
    validation?: TextControlValidation;
}

export class TextControl extends BaseControl<string, HTMLInputElement | HTMLDivElement> {
    _placeholder: string;
    _password: boolean;
    _readonly: boolean;
    _linkifyIpAddress: boolean;
    _validation?: TextControlValidation;
    _readonlyContentElement: HTMLDivElement | null;

    constructor(options: TextControlOptions = {}) {
        super({ ...options, defaultValue: (options.defaultValue || '') as string });
        this._placeholder = options.placeholder || '';
        this._password = options.password || false;
        this._readonly = options.readonly || false;
        this._linkifyIpAddress = options.linkifyIpAddress || false;
        this._validation = options.validation;
        this._readonlyContentElement = null;
    }

    render(container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-control custom-control--text';

        const label = document.createElement('label');
        label.className = 'custom-control__label';
        label.textContent = this._label;
        wrapper.appendChild(label);

        if (this._readonly) {
            const readonlyContent = document.createElement('div');
            readonlyContent.className = 'custom-control__readonly-content';
            readonlyContent.setAttribute('aria-readonly', 'true');
            this._readonlyContentElement = readonlyContent;
            this._updateReadonlyContent(this._value);
            wrapper.appendChild(readonlyContent);
            this._element = readonlyContent;
        } else {
            const input = document.createElement('input');
            input.type = this._password ? 'password' : 'text';
            input.className = 'custom-control__input';
            input.value = this._value;
            input.placeholder = this._placeholder;
            input.disabled = this._disabled;
            input.readOnly = false;

            input.addEventListener('input', (event: Event) => {
                const target = event.target as HTMLInputElement | null;
                this._notifyChange(target?.value ?? '');
            });

            wrapper.appendChild(input);
            this._element = input;
        }

        container.appendChild(wrapper);
    }

    protected _updateElement(value: string): void {
        if (this._readonly) {
            this._updateReadonlyContent(value);
            return;
        }

        if (this._element instanceof HTMLInputElement) {
            this._element.value = value;
        }
    }

    _updateReadonlyContent(value: string): void {
        if (!this._readonlyContentElement) {
            return;
        }

        this._readonlyContentElement.replaceChildren();

        const textValue = typeof value === 'string' ? value : String(value ?? '');
        if (!this._linkifyIpAddress) {
            this._readonlyContentElement.textContent = textValue;
            return;
        }

        const ipAddress = this._extractIpv4Address(textValue);
        if (!ipAddress) {
            this._readonlyContentElement.textContent = textValue;
            return;
        }

        const startIndex = textValue.indexOf(ipAddress);
        const endIndex = startIndex + ipAddress.length;

        const beforeText = textValue.slice(0, startIndex);
        const afterText = textValue.slice(endIndex);

        if (beforeText.length > 0) {
            this._readonlyContentElement.appendChild(document.createTextNode(beforeText));
        }

        const link = document.createElement('a');
        link.className = 'custom-control__readonly-link';
        link.href = `http://${ipAddress}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = ipAddress;
        this._readonlyContentElement.appendChild(link);

        if (afterText.length > 0) {
            this._readonlyContentElement.appendChild(document.createTextNode(afterText));
        }
    }

    _extractIpv4Address(value: string): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const match = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
        if (!match) {
            return null;
        }

        const octets = match[0].split('.').map((part) => Number(part));
        if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
            return null;
        }

        return match[0];
    }

    validate(): boolean {
        if (!this._validation) {
            return true;
        }

        const value = this._value;

        if (this._validation.required && (!value || value.trim() === '')) {
            return false;
        }

        if (this._validation.allowEmpty && value === '') {
            // An explicitly empty value is valid, e.g. an open access point
            // password; `pattern`/`minLength` only apply to a non-empty value.
            return true;
        }

        if (this._validation.pattern) {
            const regex = new RegExp(this._validation.pattern);
            if (!regex.test(value)) {
                return false;
            }
        }

        if (this._validation.minLength && value.length < this._validation.minLength) {
            return false;
        }
        if (this._validation.maxLength && value.length > this._validation.maxLength) {
            return false;
        }

        return true;
    }
}

export interface NumberControlOptions extends BaseControlOptions<unknown> {
    min?: number;
    max?: number;
    step?: number;
}

export class NumberControl extends BaseControl<number, HTMLInputElement> {
    _min?: number;
    _max?: number;
    _step: number;

    constructor(options: NumberControlOptions = {}) {
        super({ ...options, defaultValue: (options.defaultValue ?? 0) as number });
        this._min = options.min;
        this._max = options.max;
        this._step = options.step ?? 1;
    }

    render(container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-control custom-control--number';

        const label = document.createElement('label');
        label.className = 'custom-control__label';
        label.textContent = this._label;
        wrapper.appendChild(label);

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'custom-control__input';
        input.value = String(this._value);
        input.disabled = this._disabled;

        if (this._min !== undefined) input.min = String(this._min);
        if (this._max !== undefined) input.max = String(this._max);
        if (this._step !== undefined) input.step = String(this._step);

        input.addEventListener('input', (event: Event) => {
            const target = event.target as HTMLInputElement | null;
            const numValue = parseFloat(target?.value ?? '');
            this._notifyChange(Number.isNaN(numValue) ? 0 : numValue);
        });

        wrapper.appendChild(input);
        container.appendChild(wrapper);

        this._element = input;
    }

    protected _updateElement(value: number): void {
        if (this._element) {
            this._element.value = String(value);
        }
    }

    validate(): boolean {
        const value = this._value;

        if (this._min !== undefined && value < this._min) {
            return false;
        }
        if (this._max !== undefined && value > this._max) {
            return false;
        }

        return true;
    }
}

export interface DropdownOption {
    value: unknown;
    label: string;
}

export interface DropdownControlOptions extends BaseControlOptions<unknown> {
    options?: DropdownOption[];
}

export class DropdownControl extends BaseControl<unknown, HTMLSelectElement> {
    _options: DropdownOption[];

    constructor(options: DropdownControlOptions = {}) {
        super(options);
        this._options = options.options || [];
    }

    render(container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-control custom-control--dropdown';

        const label = document.createElement('label');
        label.className = 'custom-control__label';
        label.textContent = this._label;
        wrapper.appendChild(label);

        const select = document.createElement('select');
        select.className = 'custom-control__input';
        select.disabled = this._disabled;

        for (const option of this._options) {
            const optionElement = document.createElement('option');
            optionElement.value = String(option.value);
            optionElement.textContent = option.label;
            if (option.value === this._value) {
                optionElement.selected = true;
            }
            select.appendChild(optionElement);
        }

        select.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLSelectElement | null;
            this._notifyChange(target?.value);
        });

        wrapper.appendChild(select);
        container.appendChild(wrapper);

        this._element = select;
    }

    protected _updateElement(value: unknown): void {
        if (this._element) {
            this._element.value = value as string;
        }
    }

    setValue(value: unknown): void {
        let normalizedValue = value;

        if (typeof value === 'string') {
            const directMatch = this._options.find((option) => option.value === value);
            if (!directMatch) {
                const lowerValue = value.toLowerCase();
                const caseInsensitiveMatch = this._options.find(
                    (option) =>
                        typeof option.value === 'string'
                        && option.value.toLowerCase() === lowerValue
                );
                if (caseInsensitiveMatch) {
                    normalizedValue = caseInsensitiveMatch.value;
                }
            }
        }

        super.setValue(normalizedValue);
    }
}

export type CheckboxControlOptions = BaseControlOptions<unknown>;

export class CheckboxControl extends BaseControl<boolean, HTMLInputElement> {
    constructor(options: CheckboxControlOptions = {}) {
        super({ ...options, defaultValue: (options.defaultValue ?? false) as boolean });
    }

    render(container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-control custom-control--checkbox';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'custom-control__checkbox';
        input.checked = this._value;
        input.disabled = this._disabled;
        input.id = `checkbox-${Math.random().toString(36).substring(2, 9)}`;

        input.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement | null;
            this._notifyChange(target?.checked ?? false);
        });

        const label = document.createElement('label');
        label.className = 'custom-control__checkbox-label';
        label.textContent = this._label;
        label.htmlFor = input.id;

        wrapper.appendChild(input);
        wrapper.appendChild(label);
        container.appendChild(wrapper);

        this._element = input;
    }

    protected _updateElement(value: boolean): void {
        if (this._element) {
            this._element.checked = value;
        }
    }
}

export interface ButtonControlOptions extends BaseControlOptions {
    style?: string;
    icon?: string | null;
    iconOnly?: boolean;
}

export class ButtonControl extends BaseControl<unknown, HTMLButtonElement> {
    _style: string;
    _icon: string | null;
    _iconOnly: boolean;
    _clickCallback: (() => void) | null;

    constructor(options: ButtonControlOptions = {}) {
        super(options);
        this._style = options.style || 'secondary';
        this._icon = options.icon || null;
        this._iconOnly = options.iconOnly || false;
        this._clickCallback = null;
    }

    render(container: HTMLElement): void {
        const button = document.createElement('button');
        button.className = `custom-control__button custom-control__button--${this._style}`;
        if (this._iconOnly) {
            button.classList.add('custom-control__button--icon-only');
            button.title = this._label;
            button.setAttribute('aria-label', this._label || 'Button');
        }
        button.disabled = this._disabled;

        if (typeof this._icon === 'string' && this._icon.trim()) {
            const icon = document.createElement('img');
            icon.className = 'custom-control__button-icon';
            icon.src = this._icon;
            icon.alt = '';
            button.appendChild(icon);
        }

        if (!this._iconOnly) {
            const label = document.createElement('span');
            label.className = 'custom-control__button-label';
            label.textContent = this._label;
            button.appendChild(label);
        }

        button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            if (this._clickCallback) {
                this._clickCallback();
            }
        });

        container.appendChild(button);

        this._element = button;
    }

    onClick(callback: () => void): void {
        this._clickCallback = callback;
    }

    /**
     * Change the rendered label text without recreating the button.
     *
     * A no-op before `render()` (there is nothing to update yet). For icon-only
     * buttons the accessible name is also refreshed, because there is no visible
     * text to fall back on.
     *
     * @param label New label text.
     */
    setLabel(label: string): void {
        this._label = String(label ?? '');
        if (!this._element) {
            return;
        }

        const span = this._element.querySelector<HTMLSpanElement>('.custom-control__button-label');
        if (span) {
            span.textContent = this._label;
        }

        if (this._iconOnly) {
            this._element.title = this._label;
            this._element.setAttribute('aria-label', this._label || 'Button');
        }
    }

    /**
     * Swap or remove the rendered glyph without recreating the button.
     *
     * A no-op before `render()` except for storing the value used by the next
     * render. Passing `null` (or an empty/whitespace string) removes the glyph.
     * The glyph keeps its position in front of the label, so a labelled button
     * never jumps when the icon changes.
     *
     * @param icon Icon URL, or `null` to remove the glyph.
     */
    setIcon(icon: string | null): void {
        this._icon = typeof icon === 'string' && icon.trim() ? icon : null;
        if (!this._element) {
            return;
        }

        const existing = this._element.querySelector<HTMLImageElement>(
            '.custom-control__button-icon'
        );
        if (!this._icon) {
            existing?.remove();
            return;
        }

        if (existing) {
            existing.src = this._icon;
            return;
        }

        const image = document.createElement('img');
        image.className = 'custom-control__button-icon';
        image.src = this._icon;
        image.alt = '';
        const label = this._element.querySelector<HTMLSpanElement>('.custom-control__button-label');
        if (label) {
            this._element.insertBefore(image, label);
        } else {
            this._element.appendChild(image);
        }
    }

    setDisabled(disabled: boolean): void {
        super.setDisabled(disabled);
    }

    getValue(): undefined {
        return undefined;
    }

    setValue(): void {
        // No-op for buttons
    }
}