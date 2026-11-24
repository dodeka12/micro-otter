import { ViewBase } from './view-base.js';
import { DropdownControl } from './controls/custom-runtime-controls.js';
import { assertAppEventPayloadType } from '../core/app-event.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

type Unsubscribe = () => void;
type ThemeChangedHandler = () => void;

type LoggerOption = ViewBaseOptions extends { logger?: infer T } ? T : unknown;
type I18nServiceOption = ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
type BaseI18nService = Exclude<I18nServiceOption, null | undefined>;

interface ThemeOption {
    id: string;
    label?: string | null;
}

interface LocaleOption {
    code: string;
    label?: string | null;
}

interface DropdownOptionDefinition {
    value: string;
    label: string;
}

interface DropdownControlDefinition {
    label: string;
    options: DropdownOptionDefinition[];
    defaultValue: string;
}

interface DropdownControlLike {
    render: (container: HTMLElement) => void;
}

interface WorkspaceConfigLike {
    locale?: string | null;
}

interface WorkspaceI18nLike extends BaseI18nService {
    currentLocale?: string | null;
    availableLocales?: LocaleOption[] | null;
}

interface ThemeEventsLike {
    addEventListener: (type: 'themechange', listener: ThemeChangedHandler) => void;
    removeEventListener: (type: 'themechange', listener: ThemeChangedHandler) => void;
}

interface ViewManagerLike {
    themeEvents?: ThemeEventsLike | null;
}

interface AppEventLike<TDetail = unknown> {
    name?: string;
    detail?: TDetail;
}

interface WorkspaceConfigChangedDetail {
    payloadTypeId: 'Workspace.ConfigChanged.v1';
    key: string;
}

type WorkspaceEventHandler = (event: AppEventLike) => void;

interface GeneralSettingsWorkspaceModel {
    i18nService?: WorkspaceI18nLike | null;
    config?: WorkspaceConfigLike | null;
    viewManager?: ViewManagerLike | null;
    on: (eventName: '*', listener: WorkspaceEventHandler) => Unsubscribe;
    setTheme: (themeId: string) => Promise<unknown>;
    setLocale: (locale: string) => Promise<unknown>;
    listAvailableThemes: () => ThemeOption[];
    getTheme: () => string;
}

interface GeneralSettingsViewOptions {
    workspace?: GeneralSettingsWorkspaceModel | null;
    i18nService?: I18nServiceOption | null;
    title?: string | null;
    icon?: string | null;
    id?: string | null;
    logger?: LoggerOption | null;
    showTitle?: boolean;
}

interface GeneralSettingsSerializedData extends Record<string, unknown> {
    title?: string | null;
    icon?: string | null;
    id?: string | null;
}

interface GeneralSettingsDeserializeContext {
    workspace?: GeneralSettingsWorkspaceModel | null;
    i18nService?: I18nServiceOption | null;
    logger?: LoggerOption | null;
}

export class GeneralSettingsView extends ViewBase {
    workspace: GeneralSettingsWorkspaceModel;

    private _showTitle: boolean;
    private _themeSelect: HTMLSelectElement | null;
    private _languageSelect: HTMLSelectElement | null;
    private _themeControl: DropdownControlLike | null;
    private _languageControl: DropdownControlLike | null;
    private _titleElement: HTMLHeadingElement | null;
    private _themeLabel: HTMLLabelElement | null;
    private _languageLabel: HTMLLabelElement | null;
    private _unsubscribeWorkspace: Unsubscribe | null;
    private _onThemeChanged: ThemeChangedHandler | null;

    constructor({
        workspace,
        i18nService = null,
        title = null,
        icon = 'settings',
        id = null,
        logger = null,
        showTitle = true,
    }: GeneralSettingsViewOptions = {}) {
        if (!workspace) {
            throw new Error('GeneralSettingsView requires a workspace instance');
        }

        super({
            title: title || 'General Settings',
            icon,
            id,
            logger,
            i18nService: i18nService || workspace.i18nService || null,
        });

        this.workspace = workspace;
        this._showTitle = Boolean(showTitle);
        this._themeSelect = null;
        this._languageSelect = null;
        this._themeControl = null;
        this._languageControl = null;
        this._titleElement = null;
        this._themeLabel = null;
        this._languageLabel = null;
        this._unsubscribeWorkspace = null;
        this._onThemeChanged = null;
    }

    override render(container: HTMLElement): void {
        void container;

        const root = document.createElement('section');
        root.className = 'view-general-settings';

        if (this._showTitle) {
            this._titleElement = document.createElement('h3');
            this._titleElement.className = 'view-general-settings__title';
            root.appendChild(this._titleElement);
        }

        const controls = document.createElement('div');
        controls.className = 'view-general-settings__controls';

        const themeGroup = document.createElement('div');
        themeGroup.className = 'view-general-settings__group';
        const themeControlDefinition: DropdownControlDefinition = {
            label: this.t('settings.general.theme.label'),
            options: [],
            defaultValue: '',
        };
        this._themeControl = new DropdownControl(themeControlDefinition) as DropdownControlLike;
        this._themeControl.render(themeGroup);
        this._themeLabel = themeGroup.querySelector('.custom-control__label');
        this._themeLabel?.classList.add('view-general-settings__label');
        this._themeSelect = themeGroup.querySelector('select');
        if (this._themeSelect) {
            this._themeSelect.classList.add('view-general-settings__select');
            this._themeSelect.id = `${this.id}-theme-select`;
        }
        this._themeLabel?.setAttribute('for', `${this.id}-theme-select`);

        const languageGroup = document.createElement('div');
        languageGroup.className = 'view-general-settings__group';
        const languageControlDefinition: DropdownControlDefinition = {
            label: this.t('settings.general.language.label'),
            options: [],
            defaultValue: '',
        };
        this._languageControl = new DropdownControl(
            languageControlDefinition
        ) as DropdownControlLike;
        this._languageControl.render(languageGroup);
        this._languageLabel = languageGroup.querySelector('.custom-control__label');
        this._languageLabel?.classList.add('view-general-settings__label');
        this._languageSelect = languageGroup.querySelector('select');
        if (this._languageSelect) {
            this._languageSelect.classList.add('view-general-settings__select');
            this._languageSelect.id = `${this.id}-language-select`;
        }
        this._languageLabel?.setAttribute('for', `${this.id}-language-select`);

        controls.appendChild(themeGroup);
        controls.appendChild(languageGroup);
        root.appendChild(controls);

        this.mountContent(root);
        this._bindControlEvents();
        this._applyLocalizedText();
        this._refreshThemeOptions();
        this._refreshLanguageOptions();
    }

    override afterAttach(): void {
        super.afterAttach();

        this._unsubscribeWorkspace = this.workspace.on('*', (event: AppEventLike): void => {
            if (event?.name !== 'configChanged') {
                return;
            }
            assertAppEventPayloadType(
                event,
                'Workspace.ConfigChanged.v1',
                'GeneralSettingsView workspace listener'
            );
            const configChangedEvent = event as AppEventLike<WorkspaceConfigChangedDetail>;
            const key = configChangedEvent.detail?.key;
            if (key === 'theme') {
                this._refreshThemeOptions();
                return;
            }
            if (key === 'locale') {
                this._refreshLanguageOptions();
            }
        });

        const themeEvents = this.workspace.viewManager?.themeEvents;
        if (themeEvents) {
            this._onThemeChanged = (): void => this._refreshThemeOptions();
            themeEvents.addEventListener('themechange', this._onThemeChanged);
        }

        this._subscribeToLanguageChanges((): void => {
            this._applyLocalizedText();
            this._refreshLanguageOptions();
        });
    }

    override beforeDetach(): void {
        this._unsubscribeWorkspace?.();
        this._unsubscribeWorkspace = null;

        const themeEvents = this.workspace.viewManager?.themeEvents;
        if (themeEvents && this._onThemeChanged) {
            themeEvents.removeEventListener('themechange', this._onThemeChanged);
        }
        this._onThemeChanged = null;

        super.beforeDetach();
    }

    private _bindControlEvents(): void {
        if (this._themeSelect) {
            this._themeSelect.addEventListener('change', async (event: Event): Promise<void> => {
                const selectedTheme = (event.target as HTMLSelectElement).value;
                try {
                    await this.workspace.setTheme(selectedTheme);
                } catch (error: unknown) {
                    const message = (error as { message?: unknown })?.message || error;
                    this._log('theme-change-failed', 'warn', message);
                    this._refreshThemeOptions();
                }
            });
        }

        if (this._languageSelect) {
            this._languageSelect.addEventListener('change', async (event: Event): Promise<void> => {
                const selectedLocale = (event.target as HTMLSelectElement).value;
                try {
                    await this.workspace.setLocale(selectedLocale);
                } catch (error: unknown) {
                    const message = (error as { message?: unknown })?.message || error;
                    this._log('locale-change-failed', 'warn', message);
                    this._refreshLanguageOptions();
                }
            });
        }
    }

    private _applyLocalizedText(): void {
        if (this._titleElement) {
            this._titleElement.textContent = this.t('settings.general.title');
        }
        if (this._themeLabel) {
            this._themeLabel.textContent = this.t('settings.general.theme.label');
        }
        if (this._languageLabel) {
            this._languageLabel.textContent = this.t('settings.general.language.label');
        }
    }

    private _refreshThemeOptions(): void {
        if (!this._themeSelect) {
            return;
        }

        const themeOptions = this.workspace.listAvailableThemes();
        const currentTheme = this.workspace.getTheme();
        const select = this._themeSelect;
        select.replaceChildren();

        const resolvedThemeOptions: ThemeOption[] =
            Array.isArray(themeOptions) && themeOptions.length
                ? themeOptions
                : [{ id: currentTheme || 'standard', label: currentTheme || 'standard' }];

        for (const theme of resolvedThemeOptions) {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.label || theme.id;
            if (theme.id === currentTheme) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    }

    private _refreshLanguageOptions(): void {
        if (!this._languageSelect) {
            return;
        }

        const select = this._languageSelect;
        const currentLocale = this.workspace.i18nService?.currentLocale || this.workspace.config?.locale;
        const locales = this.workspace.i18nService?.availableLocales || [];
        select.replaceChildren();

        const resolvedLocales: LocaleOption[] =
            Array.isArray(locales) && locales.length
                ? locales
                : [{ code: currentLocale || 'en', label: currentLocale || 'en' }];

        for (const locale of resolvedLocales) {
            const option = document.createElement('option');
            option.value = locale.code;
            option.textContent = locale.label || locale.code;
            if (locale.code === currentLocale) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    }

    override serialize(): ReturnType<ViewBase['serialize']> {
        return {
            ...super.serialize(),
            type: 'GeneralSettingsView',
        };
    }

    static deserialize(
        data: GeneralSettingsSerializedData = {},
        viewFactory: unknown = null,
        context: GeneralSettingsDeserializeContext = {}
    ): GeneralSettingsView {
        void viewFactory;

        const { title = null, icon = 'settings', id = null } = data;
        const { workspace = null, i18nService = null, logger = null } = context;
        if (!workspace) {
            throw new Error('GeneralSettingsView requires workspace in deserialize context');
        }
        return new GeneralSettingsView({
            workspace,
            i18nService,
            title,
            icon,
            id,
            logger,
        });
    }
}
