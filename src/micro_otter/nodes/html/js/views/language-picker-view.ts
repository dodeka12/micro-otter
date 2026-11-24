// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import { AppPayload } from '../core/app-event.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type LoggerLike = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceLikeFromBase = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;

interface LocaleOptionEntry {
    code: string;
    label?: string;
    icon?: string;
}

interface LanguagePickerI18nServiceLike extends I18nServiceLikeFromBase {
    t: (key: string, params?: Record<string, unknown>) => string;
    availableLocales: LocaleOptionEntry[];
    currentLocale: string;
}

interface LanguagePickerViewOptions {
    i18nService?: LanguagePickerI18nServiceLike | null;
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: LoggerLike;
    onSelect?: LanguagePickerSelectCallback | null;
}

interface LanguagePickerViewDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
}

interface LanguagePickerViewDeserializeContext {
    i18nService?: LanguagePickerI18nServiceLike | null;
    logger?: LoggerLike;
}

type LanguagePickerViewSerialized = ReturnType<ViewBase['serialize']> & {
    type: 'LanguagePickerView';
};

type LanguagePickerSelectCallback = (locale: LocaleOptionEntry) => void;

type FlagButtonEntry = {
    button: HTMLButtonElement;
    locale: LocaleOptionEntry;
};

interface LanguagePickerSelectPayloadParams {
    locale: LocaleOptionEntry;
}

/**
 * Payload for `select` events emitted by LanguagePickerView.
 */
class LanguagePickerViewSelectPayload extends AppPayload {
    locale: LocaleOptionEntry;

    constructor({ locale }: LanguagePickerSelectPayloadParams) {
        super('LanguagePickerView.Select.v1');
        this.locale = locale;
    }
}

/**
 * Payload for `cancel` events emitted by LanguagePickerView.
 */
class LanguagePickerViewCancelPayload extends AppPayload {
    constructor() {
        super('LanguagePickerView.Cancel.v1');
    }
}

/**
 * LanguagePickerView displays available locales as a grid of flag icons.
 * User can select a locale by clicking its flag.
 *
 * Emitted Events:
 * - `select` -> `payloadTypeId: LanguagePickerView.Select.v1` -> `LanguagePickerViewSelectPayload`
 * - `cancel` -> `payloadTypeId: LanguagePickerView.Cancel.v1` -> `LanguagePickerViewCancelPayload`
 */
export class LanguagePickerView extends ViewBase {
    private _onSelect: LanguagePickerSelectCallback | null;
    private _flagButtons: FlagButtonEntry[];

    constructor({
        i18nService,
        title,
        icon = null,
        id = null,
        logger = null,
        onSelect = null,
    }: LanguagePickerViewOptions = {}) {
        if (!i18nService) {
            throw new Error('LanguagePickerView requires an i18nService instance');
        }

        const viewTitle = title || (i18nService.t('workspace.selectLanguage') || 'Select Language');

        super({ title: viewTitle, icon, id, logger, i18nService });

        this._onSelect = onSelect;
        this._flagButtons = [];
    }

    override render(container: HTMLElement): void {
        void container;

        const wrapper = document.createElement('div');
        wrapper.className = 'view-language-picker';
        wrapper.style.backgroundColor = 'rgba(20, 24, 36, 0.98)';
        wrapper.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        wrapper.style.borderRadius = '8px';
        wrapper.style.padding = '24px';
        wrapper.style.minWidth = '300px';
        wrapper.style.maxWidth = '500px';

        const title = document.createElement('h3');
        title.textContent = this.title;
        title.style.margin = '0 0 20px 0';
        title.style.color = '#e7ebff';
        title.style.fontSize = '18px';
        title.style.fontWeight = '600';
        wrapper.appendChild(title);

        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(80px, 1fr))';
        grid.style.gap = '12px';
        grid.style.marginBottom = '20px';

        const i18nService = this._i18nService as LanguagePickerI18nServiceLike;
        const availableLocales = i18nService.availableLocales;
        const currentLocale = i18nService.currentLocale;

        for (const locale of availableLocales) {
            const item = this._createFlagButton(locale, locale.code === currentLocale);
            this._flagButtons.push({ button: item, locale });
            grid.appendChild(item);
        }

        wrapper.appendChild(grid);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = this.t('dialog.cancel') || 'Cancel';
        cancelBtn.style.padding = '8px 16px';
        cancelBtn.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.backgroundColor = 'rgba(30, 35, 50, 0.9)';
        cancelBtn.style.color = '#e7ebff';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.style.width = '100%';
        cancelBtn.addEventListener('click', () => this._handleCancel());
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.backgroundColor = 'rgba(45, 52, 75, 0.95)';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.backgroundColor = 'rgba(30, 35, 50, 0.9)';
        });
        wrapper.appendChild(cancelBtn);

        this.mountContent(wrapper);
        this._log('render', { locales: availableLocales.length });
    }

    private _createFlagButton(locale: LocaleOptionEntry, isCurrent: boolean): HTMLButtonElement {
        const item = document.createElement('button');
        item.style.display = 'flex';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.padding = '12px';
        item.style.border = isCurrent
            ? '2px solid rgba(100, 150, 255, 0.8)'
            : '1px solid rgba(255, 255, 255, 0.2)';
        item.style.borderRadius = '8px';
        item.style.backgroundColor = isCurrent
            ? 'rgba(45, 52, 75, 0.95)'
            : 'rgba(30, 35, 50, 0.9)';
        item.style.cursor = 'pointer';
        item.style.transition = 'all 0.2s';

        const iconPath = locale.icon ? `/html/locales/${locale.icon}` : null;
        if (iconPath) {
            const img = document.createElement('img');
            img.src = iconPath;
            img.style.width = '40px';
            img.style.height = '40px';
            item.appendChild(img);
        }

        const label = document.createElement('span');
        label.textContent = String(locale.label);
        label.style.fontSize = '12px';
        label.style.color = '#e7ebff';
        label.style.textAlign = 'center';
        item.appendChild(label);

        item.addEventListener('mouseenter', () => {
            if (!isCurrent) {
                item.style.backgroundColor = 'rgba(45, 52, 75, 0.95)';
            }
        });
        item.addEventListener('mouseleave', () => {
            if (!isCurrent) {
                item.style.backgroundColor = 'rgba(30, 35, 50, 0.9)';
            }
        });

        item.addEventListener('click', () => this._handleSelect(locale));

        return item;
    }

    private _handleSelect(locale: LocaleOptionEntry): void {
        this._log('locale-selected', { locale: locale.code });

        this._emit('select', new LanguagePickerViewSelectPayload({ locale }));

        if (typeof this._onSelect === 'function') {
            this._onSelect(locale);
        }
    }

    private _handleCancel(): void {
        this._log('cancelled');
        this._emit('cancel', new LanguagePickerViewCancelPayload());
    }

    override serialize(): LanguagePickerViewSerialized {
        return {
            ...super.serialize(),
            type: 'LanguagePickerView',
        };
    }

    static deserialize(
        data: LanguagePickerViewDeserializeData = {},
        viewFactory: unknown = null,
        context: LanguagePickerViewDeserializeContext = {}
    ): LanguagePickerView {
        void viewFactory;

        const { title, icon = null, id = null } = data;
        const { i18nService = null, logger = null } = context;

        if (!i18nService) {
            throw new Error('LanguagePickerView requires i18nService in context');
        }

        return new LanguagePickerView({
            i18nService,
            title,
            icon,
            id,
            logger,
        });
    }
}
