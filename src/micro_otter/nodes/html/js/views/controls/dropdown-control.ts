import { ViewBase } from '../view-base.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type LoggerLike = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLike = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;

export type DropdownValue = string | string[] | null;

export interface DropdownOption {
    value: string;
    label: string;
    icon?: string;
    iconPath?: string;
    iconFilter?: string;
    badge?: string;
    disabled?: boolean;
    /** Tooltip text for this option; replaces the label's ellipsis title when set. */
    description?: string;
}

type DropdownOptionUpdate = Partial<DropdownOption>;
type DropdownBadges = Record<string, string>;
type DropdownChangeHandler = (newValue: string | string[]) => void;

export interface DropdownControlOptions {
    options?: DropdownOption[];
    value?: DropdownValue;
    multiSelect?: boolean;
    showIcons?: boolean;
    showBulkActions?: boolean;
    placeholder?: string;
    label?: string;
    /**
     * Accessible name for the trigger button, for hosts that show no visible title
     * (compact toolbars). Survives the trigger rebuilds that `setValue`/`setOptions` cause.
     */
    ariaLabel?: string;
    /** Tooltip text for the trigger's current value, e.g. the selected option's description. */
    description?: string;
    onChange?: DropdownChangeHandler | null;
    buttonClassName?: string;
    menuClassName?: string;
    disabled?: boolean;
    i18nService?: I18nServiceLike | null;
    logger?: LoggerLike | null;
}

/**
 * Generic dropdown control component for single-select options.
 * Extends ViewBase for consistent lifecycle management.
 */
export class DropdownControl extends ViewBase {
    private _options: DropdownOption[];
    private _multiSelect: boolean;
    private _value: DropdownValue;
    private _showIcons: boolean;
    private _showBulkActions: boolean;
    private _placeholder: string;
    /** Optional title rendered to the left of the trigger button; empty when omitted. */
    private _label: string;
    /** Optional tooltip for the trigger's current value; empty falls back to the label. */
    private _description: string;
    /** Accessible name for the trigger; empty leaves the visible label as the name. */
    private _ariaLabel: string;
    private _onChange: DropdownChangeHandler | null;
    private _buttonClassName: string;
    private _menuClassName: string;

    private _isOpen: boolean;
    private _disabled: boolean;

    private _buttonElement: HTMLButtonElement | null;
    private _menuElement: HTMLDivElement | null;
    private _rootElement: HTMLDivElement | null;
    /** Title span rendered for the `label` option; `null` until `render()` runs and after the title is cleared. */
    private _labelElement: HTMLSpanElement | null;

    private _boundHandleClickOutside: (event: MouseEvent) => void;
    private _boundHandleKeyDown: (event: KeyboardEvent) => void;

    constructor({
        options = [],
        value = null,
        multiSelect = false,
        showIcons = true,
        showBulkActions = false,
        placeholder = 'Select...',
        label = '',
        description = '',
        ariaLabel = '',
        onChange = null,
        buttonClassName = '',
        menuClassName = '',
        disabled = false,
        i18nService = null,
        logger = null,
    }: DropdownControlOptions = {}) {
        super({
            title: 'Dropdown Control',
            i18nService,
            logger,
        });

        this._options = options;
        this._multiSelect = multiSelect;
        this._value = this._normalizeValue(value);
        this._showIcons = showIcons;
        this._showBulkActions = showBulkActions;
        this._placeholder = placeholder;
        this._label = label;
        this._description = description;
        this._ariaLabel = ariaLabel;
        this._onChange = onChange;
        this._buttonClassName = buttonClassName;
        this._menuClassName = menuClassName;

        this._isOpen = false;
        this._disabled = Boolean(disabled);

        this._buttonElement = null;
        this._menuElement = null;
        this._rootElement = null;
        this._labelElement = null;

        this._boundHandleClickOutside = this._handleClickOutside.bind(this);
        this._boundHandleKeyDown = this._handleKeyDown.bind(this);
    }

    override render(container: HTMLElement): void {
        if (!container || !(container instanceof HTMLElement)) {
            throw new Error('DropdownControl.render requires a container HTMLElement.');
        }

        this._rootElement = document.createElement('div');
        this._rootElement.className = 'dropdown-control';

        if (this._label) {
            this._rootElement.classList.add('dropdown-control--labeled');
            const labelElement = document.createElement('span');
            labelElement.className = 'dropdown-control__label';
            labelElement.id = `${this.id}-label`;
            labelElement.textContent = this.t(this._label);
            this._rootElement.appendChild(labelElement);
            this._labelElement = labelElement;
        }

        this._buttonElement = this._renderButton();
        this._rootElement.appendChild(this._buttonElement);

        this._menuElement = this._renderMenu();
        document.body.appendChild(this._menuElement);

        container.appendChild(this._rootElement);

        this._applyDisabledState();

        this._log('dropdown-rendered', 'debug', { optionsCount: this._options.length });
    }

    /**
     * Disable or enable the control.
     *
     * A disabled control cannot open its menu (and closes an open one), its
     * trigger button carries the `disabled` attribute, and the root gains the
     * `dropdown-control--disabled` modifier for styling.
     *
     * @param disabled Whether the control should be disabled.
     */
    setDisabled(disabled: boolean): void {
        this._disabled = Boolean(disabled);
        if (this._disabled) {
            this.close();
        }
        this._applyDisabledState();
        this._log('dropdown-disabled-set', 'debug', { disabled: this._disabled });
    }

    private _applyDisabledState(): void {
        if (this._buttonElement) {
            this._buttonElement.disabled = this._disabled;
        }
        this._rootElement?.classList.toggle('dropdown-control--disabled', this._disabled);
    }

    override afterAttach(): void {
        if (this._buttonElement) {
            this._buttonElement.addEventListener('click', (event) => {
                event.stopPropagation();
                this._toggleDropdown();
            });
        }

        this._log('dropdown-attached', 'debug');
    }

    override beforeDetach(): void {
        this._removeGlobalListeners();

        if (this._menuElement && this._menuElement.parentNode === document.body) {
            document.body.removeChild(this._menuElement);
        }

        super.beforeDetach();
        this._log('dropdown-detached', 'debug');
    }

    setValue(value: string | string[]): void {
        this._value = this._normalizeValue(value);
        this._updateButtonDisplay();
        this._updateMenuSelection();
        this._log('dropdown-value-set', 'debug', { value });
    }

    /**
     * Replace or remove the rendered title without recreating the trigger or the menu.
     *
     * A no-op before `render()` except for storing the value the next render uses. The existing
     * title span keeps its identity across calls, so callers never hold a detached node. An empty
     * label removes the span together with the `dropdown-control--labeled` modifier and the
     * trigger's `aria-labelledby` association.
     *
     * @param label New title text; an empty string removes the title.
     */
    setLabel(label: string): void {
        this._label = String(label ?? '');
        if (this._rootElement === null || this._buttonElement === null) {
            return;
        }

        if (this._labelElement) {
            if (this._label) {
                this._labelElement.textContent = this.t(this._label);
                this._buttonElement.setAttribute('aria-labelledby', this._labelElement.id);
                return;
            }

            this._labelElement.remove();
            this._labelElement = null;
            this._rootElement.classList.remove('dropdown-control--labeled');
            this._buttonElement.removeAttribute('aria-labelledby');
            return;
        }

        if (!this._label) {
            return;
        }

        const labelElement = document.createElement('span');
        labelElement.className = 'dropdown-control__label';
        labelElement.id = `${this.id}-label`;
        labelElement.textContent = this.t(this._label);
        this._rootElement.insertBefore(labelElement, this._buttonElement);
        this._rootElement.classList.add('dropdown-control--labeled');
        this._buttonElement.setAttribute('aria-labelledby', labelElement.id);
        this._labelElement = labelElement;

        this._log('dropdown-label-set', 'debug');
    }

    setOptions(options: DropdownOption[]): void {
        this._options = options;

        if (this._menuElement && this._menuElement.parentNode) {
            const newMenu = this._renderMenu();
            this._menuElement.parentNode.replaceChild(newMenu, this._menuElement);
            this._menuElement = newMenu;
        }

        this._updateButtonDisplay();
        this._log('dropdown-options-updated', 'debug', { count: options.length });
    }

    updateOption(value: string, props: DropdownOptionUpdate): void {
        const option = this._options.find((opt) => opt.value === value);
        if (!option) {
            this._log('dropdown-option-not-found', 'warn', { value });
            return;
        }

        Object.assign(option, props);

        if (this._menuElement) {
            const optionElement = this._menuElement.querySelector(`[data-value="${value}"]`);
            if (optionElement) {
                const badgeElement = optionElement.querySelector('.dropdown-control__option-badge');
                if (badgeElement && props.badge !== undefined) {
                    badgeElement.textContent = props.badge;
                }
            }
        }

        if (this._isSelected(value)) {
            this._updateButtonDisplay();
        }

        this._log('dropdown-option-updated', 'debug', { value, props });
    }

    updateBadges(badges: DropdownBadges): void {
        for (const [value, badge] of Object.entries(badges)) {
            this.updateOption(value, { badge });
        }
    }

    getSelectedValue(): DropdownValue {
        return this._value;
    }

    open(): void {
        if (this._isOpen || this._disabled) {
            return;
        }

        this._isOpen = true;
        this._updateMenuVisibility();
        this._addGlobalListeners();
        this._log('dropdown-opened', 'debug');
    }

    close(): void {
        if (!this._isOpen) {
            return;
        }

        this._isOpen = false;
        this._updateMenuVisibility();
        this._removeGlobalListeners();
        this._log('dropdown-closed', 'debug');
    }

    private _toggleDropdown(): void {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    private _selectOption(value: string): void {
        const option = this._options.find((opt) => opt.value === value);

        if (option && option.disabled) {
            return;
        }

        if (this._multiSelect) {
            const selected = new Set(Array.isArray(this._value) ? this._value : []);
            if (selected.has(value)) {
                selected.delete(value);
            } else {
                selected.add(value);
            }
            this._value = [...selected];
        } else {
            this._value = value;
        }

        this._updateButtonDisplay();
        this._updateMenuSelection();

        if (typeof this._onChange === 'function') {
            const selectedValue = this._multiSelect
                ? [...(Array.isArray(this._value) ? this._value : [])]
                : value;
            this._onChange(selectedValue);
        }

        if (!this._multiSelect) {
            this.close();
        }

        this._log('dropdown-option-selected', 'debug', { value });
    }

    private _renderButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = `dropdown-control__button ${this._buttonClassName}`.trim();
        button.setAttribute('aria-haspopup', 'true');
        button.setAttribute('aria-expanded', 'false');
        if (this._ariaLabel) {
            button.setAttribute('aria-label', this.t(this._ariaLabel));
        }
        if (this._labelElement) {
            button.setAttribute('aria-labelledby', this._labelElement.id);
        }
        button.type = 'button';

        const selectedOptions = this._multiSelect
            ? this._options.filter((opt) => this._isSelected(opt.value))
            : [];
        const selectedOption = this._multiSelect
            ? selectedOptions.length === 1
                ? selectedOptions[0]
                : null
            : this._options.find((opt) => opt.value === this._value) ?? null;

        if (selectedOption?.value) {
            button.setAttribute('data-selected-value', selectedOption.value);
        }

        if (this._showIcons && selectedOption && (selectedOption.icon || selectedOption.iconPath)) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'dropdown-control__button-icon';

            if (selectedOption.iconPath) {
                const img = document.createElement('img');
                img.src = selectedOption.iconPath;
                img.alt = '';
                if (selectedOption.iconFilter) {
                    img.style.filter = selectedOption.iconFilter;
                }
                iconSpan.appendChild(img);
            } else if (selectedOption.icon) {
                iconSpan.textContent = selectedOption.icon;
                iconSpan.classList.add('material-icons');
            }

            button.appendChild(iconSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'dropdown-control__button-label';

        if (selectedOption) {
            labelSpan.textContent = this.t(selectedOption.label);
        } else if (this._multiSelect && selectedOptions.length > 1) {
            labelSpan.textContent = this.t(this._placeholder);
        } else {
            labelSpan.textContent = this.t(this._placeholder);
        }

        // A host may cap the trigger width, which ellipsizes the label; the title keeps the
        // full label readable on hover, and a `description` (if any) takes precedence over it.
        labelSpan.title = this._description || labelSpan.textContent;

        button.appendChild(labelSpan);
        button.title = labelSpan.title;

        if (this._multiSelect) {
            if (selectedOptions.length > 0) {
                const badgeSpan = document.createElement('span');
                badgeSpan.className = 'dropdown-control__button-badge';
                badgeSpan.textContent = `(${selectedOptions.length})`;
                button.appendChild(badgeSpan);
            }
        } else if (selectedOption && selectedOption.badge) {
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'dropdown-control__button-badge';
            badgeSpan.textContent = selectedOption.badge;
            button.appendChild(badgeSpan);
        }

        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'dropdown-control__button-arrow';
        arrowSpan.textContent = '▼';
        button.appendChild(arrowSpan);

        return button;
    }

    private _renderMenu(): HTMLDivElement {
        const menu = document.createElement('div');
        menu.className = `dropdown-control__menu ${this._menuClassName}`.trim();
        menu.setAttribute('role', 'menu');
        menu.hidden = true;

        if (this._multiSelect && this._showBulkActions) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'dropdown-control__actions';

            const selectAllBtn = document.createElement('button');
            selectAllBtn.type = 'button';
            selectAllBtn.className = 'dropdown-control__action';
            selectAllBtn.setAttribute('data-action', 'select-all');
            selectAllBtn.textContent = this.t('console.filter.selectAll');
            selectAllBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this._selectAllOptions();
            });

            const selectNoneBtn = document.createElement('button');
            selectNoneBtn.type = 'button';
            selectNoneBtn.className = 'dropdown-control__action';
            selectNoneBtn.setAttribute('data-action', 'select-none');
            selectNoneBtn.textContent = this.t('console.filter.selectNone');
            selectNoneBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this._clearAllOptions();
            });

            actionsDiv.appendChild(selectAllBtn);
            actionsDiv.appendChild(selectNoneBtn);
            menu.appendChild(actionsDiv);
        }

        this._options.forEach((option) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'dropdown-control__option';
            optionDiv.setAttribute('role', 'menuitem');
            optionDiv.setAttribute('data-value', option.value);

            if (option.disabled) {
                optionDiv.classList.add('dropdown-control__option--disabled');
                optionDiv.setAttribute('aria-disabled', 'true');
            }

            if (this._isSelected(option.value)) {
                optionDiv.setAttribute('aria-selected', 'true');
                optionDiv.classList.add('dropdown-control__option--selected');
            }

            if (this._multiSelect) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'dropdown-control__checkbox';
                checkbox.checked = this._isSelected(option.value);
                checkbox.disabled = option.disabled || false;
                optionDiv.appendChild(checkbox);
            }

            if (this._showIcons && (option.icon || option.iconPath)) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'dropdown-control__option-icon';

                if (option.iconPath) {
                    const img = document.createElement('img');
                    img.src = option.iconPath;
                    img.alt = '';
                    if (option.iconFilter) {
                        img.style.filter = option.iconFilter;
                    }
                    iconSpan.appendChild(img);
                } else if (option.icon) {
                    iconSpan.textContent = option.icon;
                    iconSpan.classList.add('material-icons');
                }

                optionDiv.appendChild(iconSpan);
            }

            const labelSpan = document.createElement('span');
            labelSpan.className = 'dropdown-control__option-label';
            labelSpan.textContent = this.t(option.label);
            // Same reason as the trigger label: a capped menu ellipsizes a long option; the
            // option's own `description` (if any) takes precedence over the label text.
            labelSpan.title = option.description || labelSpan.textContent;
            optionDiv.appendChild(labelSpan);

            if (option.badge) {
                const badgeSpan = document.createElement('span');
                badgeSpan.className = 'dropdown-control__option-badge';
                badgeSpan.textContent = option.badge;
                optionDiv.appendChild(badgeSpan);
            }

            if (!option.disabled) {
                optionDiv.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this._selectOption(option.value);
                });
            }

            menu.appendChild(optionDiv);
        });

        this._updateBulkActionsState();
        return menu;
    }

    private _updateButtonDisplay(): void {
        if (!this._buttonElement || !this._rootElement) {
            return;
        }

        const newButton = this._renderButton();
        // `_renderButton` always starts collapsed; carry the real state over so a value
        // update while the menu is open keeps the trigger's ARIA in sync with the menu.
        newButton.setAttribute('aria-expanded', this._isOpen ? 'true' : 'false');

        this._rootElement.replaceChild(newButton, this._buttonElement);
        this._buttonElement = newButton;

        this._buttonElement.addEventListener('click', (event) => {
            event.stopPropagation();
            this._toggleDropdown();
        });
    }

    private _updateMenuSelection(): void {
        if (!this._menuElement) {
            return;
        }

        const options = this._menuElement.querySelectorAll('.dropdown-control__option');
        options.forEach((optionElement) => {
            const value = optionElement.getAttribute('data-value');
            const isSelected = value !== null && this._isSelected(value);

            if (isSelected) {
                optionElement.setAttribute('aria-selected', 'true');
                optionElement.classList.add('dropdown-control__option--selected');
            } else {
                optionElement.removeAttribute('aria-selected');
                optionElement.classList.remove('dropdown-control__option--selected');
            }

            if (this._multiSelect) {
                const checkbox = optionElement.querySelector('.dropdown-control__checkbox');
                if (checkbox instanceof HTMLInputElement) {
                    checkbox.checked = isSelected;
                }
            }
        });

        this._updateBulkActionsState();
    }

    private _updateMenuVisibility(): void {
        if (!this._menuElement || !this._buttonElement) {
            return;
        }

        if (this._isOpen) {
            this._menuElement.hidden = false;
            this._buttonElement.setAttribute('aria-expanded', 'true');

            requestAnimationFrame(() => {
                this._positionMenu();
            });
        } else {
            this._menuElement.hidden = true;
            this._buttonElement.setAttribute('aria-expanded', 'false');
        }
    }

    private _positionMenu(): void {
        if (!this._menuElement || !this._buttonElement || !this._rootElement) {
            return;
        }

        const buttonRect = this._buttonElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        const top = buttonRect.bottom + 4;
        this._menuElement.style.position = 'fixed';
        this._menuElement.style.top = `${top}px`;
        this._menuElement.style.left = `${buttonRect.left}px`;
        this._menuElement.style.minWidth = `${buttonRect.width}px`;

        const menuWidth = this._menuElement.offsetWidth || buttonRect.width;

        let left = buttonRect.left;
        if (left + menuWidth > viewportWidth) {
            left = Math.max(8, viewportWidth - menuWidth - 8);
            this._menuElement.style.left = `${left}px`;
        }

        const safetyMargin = 24;
        const spaceBelow = viewportHeight - top - safetyMargin;

        const maxHeight = Math.min(320, Math.max(100, spaceBelow));
        this._menuElement.style.maxHeight = `${maxHeight}px`;

        this._log('dropdown-positioned', 'debug', {
            maxHeight,
            spaceBelow,
            viewportHeight,
            top,
            left,
            menuWidth,
            buttonWidth: buttonRect.width,
            safetyMargin,
        });
    }

    private _addGlobalListeners(): void {
        document.addEventListener('click', this._boundHandleClickOutside, true);
        document.addEventListener('keydown', this._boundHandleKeyDown);
    }

    private _removeGlobalListeners(): void {
        document.removeEventListener('click', this._boundHandleClickOutside, true);
        document.removeEventListener('keydown', this._boundHandleKeyDown);
    }

    private _handleClickOutside(event: MouseEvent): void {
        if (!this._rootElement || !this._isOpen) {
            return;
        }

        const eventTarget = event.target;
        if (!(eventTarget instanceof Node)) {
            return;
        }

        const clickedInsideButton = this._rootElement.contains(eventTarget);
        const clickedInsideMenu = this._menuElement?.contains(eventTarget) ?? false;
        if (!clickedInsideButton && !clickedInsideMenu) {
            this.close();
        }
    }

    private _normalizeValue(value: DropdownValue): DropdownValue {
        if (this._multiSelect) {
            if (Array.isArray(value)) {
                return [...value];
            }
            if (value === null || value === undefined || value === '') {
                return [];
            }
            return [value];
        }
        if (Array.isArray(value)) {
            return value[0] ?? null;
        }
        return value;
    }

    private _isSelected(value: string): boolean {
        if (this._multiSelect) {
            return Array.isArray(this._value) && this._value.includes(value);
        }
        return this._value === value;
    }

    private _updateBulkActionsState(): void {
        if (!this._multiSelect || !this._showBulkActions || !this._menuElement) {
            return;
        }

        const selectAllButton = this._menuElement.querySelector('[data-action="select-all"]');
        const selectNoneButton = this._menuElement.querySelector('[data-action="select-none"]');
        if (!(selectAllButton instanceof HTMLButtonElement) || !(selectNoneButton instanceof HTMLButtonElement)) {
            return;
        }

        const enabledOptions = this._options.filter((option) => !option.disabled);
        const enabledCount = enabledOptions.length;
        const selectedCount = enabledOptions.filter((option) => this._isSelected(option.value)).length;

        selectAllButton.disabled = enabledCount === 0 || selectedCount === enabledCount;
        selectNoneButton.disabled = selectedCount === 0;
    }

    private _handleKeyDown(event: KeyboardEvent): void {
        if (!this._isOpen) {
            return;
        }

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                this.close();
                if (this._buttonElement) {
                    this._buttonElement.focus();
                }
                break;
        }
    }

    private _selectAllOptions(): void {
        if (!this._multiSelect) {
            return;
        }

        const selectedValues = this._options
            .filter((option) => !option.disabled)
            .map((option) => option.value);

        this._value = selectedValues;
        this._updateButtonDisplay();
        this._updateMenuSelection();

        if (typeof this._onChange === 'function') {
            this._onChange([...selectedValues]);
        }

        this._log('dropdown-select-all', 'debug', { count: selectedValues.length });
    }

    private _clearAllOptions(): void {
        if (!this._multiSelect) {
            return;
        }

        this._value = [];
        this._updateButtonDisplay();
        this._updateMenuSelection();

        if (typeof this._onChange === 'function') {
            this._onChange([]);
        }

        this._log('dropdown-select-none', 'debug');
    }
}