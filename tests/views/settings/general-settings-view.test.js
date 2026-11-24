import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AppEvent, AppPayload } from '../../../src/micro_otter/nodes/html/js/core/app-event.js';

import { GeneralSettingsView } from '../../../src/micro_otter/nodes/html/js/views/general-settings-view.js';

class MockWorkspacePayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

class MockI18nService {
    constructor() {
        this.currentLocale = 'en';
        this.availableLocales = [
            { code: 'en', label: 'English' },
            { code: 'de', label: 'Deutsch' },
        ];
        this._listeners = new Map();
        this._translations = {
            'settings.general.title': 'General Settings',
            'settings.general.theme.label': 'Theme',
            'settings.general.theme.description': 'Choose the editor theme.',
            'settings.general.language.label': 'Language',
            'settings.general.language.description': 'Choose the display language.',
        };
    }

    addEventListener(type, listener) {
        if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
        }
        this._listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
        this._listeners.get(type)?.delete(listener);
    }

    _emit(type, detail = {}) {
        const listeners = this._listeners.get(type);
        if (!listeners) {
            return;
        }
        const event = { type, detail };
        for (const listener of listeners) {
            listener(event);
        }
    }

    t(key) {
        return this._translations[key] || key;
    }

    async setLocale(localeCode) {
        const previousLocale = this.currentLocale;
        this.currentLocale = localeCode;
        this._emit('languagechange', { locale: localeCode, previousLocale });
        return localeCode;
    }
}

function createMockWorkspace() {
    const i18nService = new MockI18nService();
    const changeListeners = new Set();
    const themes = [
        { id: 'standard', label: 'Standard Compact Dark', description: '' },
        { id: 'standard-alt', label: 'Standard Alt', description: '' },
    ];

    const viewManager = {
        theme: 'standard',
        themeEvents: new EventTarget(),
        setTheme(themeId) {
            this.theme = themeId;
            this.themeEvents.dispatchEvent(
                new CustomEvent('themechange', {
                    detail: { theme: themeId },
                })
            );
            return themeId;
        },
        getAvailableThemes() {
            return themes;
        },
    };

    const workspace = {
        config: { theme: 'standard', locale: 'en' },
        i18nService,
        viewManager,
        onChange(listener) {
            changeListeners.add(listener);
            return () => changeListeners.delete(listener);
        },
        on(eventName, listener) {
            if (eventName !== '*') {
                throw new Error('Workspace mock only supports wildcard listeners in tests');
            }
            return this.onChange(listener);
        },
        _emit(event) {
            for (const listener of changeListeners) {
                listener(event);
            }
        },
        getTheme() {
            return this.config.theme;
        },
        listAvailableThemes() {
            return this.viewManager.getAvailableThemes();
        },
        async setTheme(themeId) {
            this.config.theme = this.viewManager.setTheme(themeId);
            this._emit(
                new AppEvent(
                    'configChanged',
                    new MockWorkspacePayload('Workspace.ConfigChanged.v1', {
                        key: 'theme',
                        value: this.config.theme,
                    })
                )
            );
            return this.config.theme;
        },
        async setLocale(localeCode) {
            await this.i18nService.setLocale(localeCode);
            this.config.locale = this.i18nService.currentLocale;
            this._emit(
                new AppEvent(
                    'configChanged',
                    new MockWorkspacePayload('Workspace.ConfigChanged.v1', {
                        key: 'locale',
                        value: this.config.locale,
                    })
                )
            );
            return this.config.locale;
        },
    };

    return workspace;
}

describe('GeneralSettingsView', () => {
    let dom;
    let container;
    let workspace;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });

        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        container = document.createElement('div');
        document.body.appendChild(container);
        workspace = createMockWorkspace();
    });

    afterEach(() => {
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.EventTarget = undefined;
        global.CustomEvent = undefined;
        global.ResizeObserver = undefined;
        dom.window.close();
    });

    it('requires a workspace instance', () => {
        assert.throws(() => new GeneralSettingsView(), /workspace instance/);
    });

    it('renders theme and language controls with current values', () => {
        const view = new GeneralSettingsView({ workspace, i18nService: workspace.i18nService });
        view.attachTo(container);

        const title = container.querySelector('.view-general-settings__title');
        const selects = container.querySelectorAll('.view-general-settings__select');

        assert.equal(title.textContent, 'General Settings');
        assert.equal(selects.length, 2);
        assert.equal(selects[0].value, 'standard');
        assert.equal(selects[1].value, 'en');
    });

    it('updates workspace theme when theme selection changes', async () => {
        const view = new GeneralSettingsView({ workspace, i18nService: workspace.i18nService });
        view.attachTo(container);

        const themeSelect = container.querySelectorAll('.view-general-settings__select')[0];
        themeSelect.value = 'standard-alt';
        themeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(workspace.getTheme(), 'standard-alt');
        assert.equal(workspace.viewManager.theme, 'standard-alt');
    });

    it('updates workspace locale when language selection changes', async () => {
        const view = new GeneralSettingsView({ workspace, i18nService: workspace.i18nService });
        view.attachTo(container);

        const languageSelect = container.querySelectorAll('.view-general-settings__select')[1];
        languageSelect.value = 'de';
        languageSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(workspace.config.locale, 'de');
        assert.equal(workspace.i18nService.currentLocale, 'de');
    });

    it('serializes and deserializes with workspace context', () => {
        const view = new GeneralSettingsView({
            workspace,
            i18nService: workspace.i18nService,
            id: 'general-settings-test',
        });

        const data = view.serialize();
        assert.equal(data.type, 'GeneralSettingsView');

        const restored = GeneralSettingsView.deserialize(data, null, {
            workspace,
            i18nService: workspace.i18nService,
        });

        assert.ok(restored instanceof GeneralSettingsView);
        assert.equal(restored.id, 'general-settings-test');
    });
});
