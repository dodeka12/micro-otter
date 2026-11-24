// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

type I18nLogLevel = 'debug' | 'info' | 'warn' | 'error';

type TranslationMap = Record<string, unknown>;

interface LocaleEntry {
    code: string;
    label?: string;
    file: string;
    icon?: string;
}

interface LocaleManifest {
    locales: LocaleEntry[];
    defaultLocale?: string;
}

interface LanguageChangeDetail {
    locale: string;
    previousLocale: string;
}

interface LanguageChangedDetail {
    language: string;
    previousLanguage: string;
}

interface I18nLoggerApi {
    log: (className: string, reason: string, level: I18nLogLevel, ...data: unknown[]) => void;
}

interface I18nServiceOptions {
    manifestPath?: string;
    defaultLocale?: string;
    initialLocale?: string | null;
    logger?: unknown;
}

/**
 * I18nService - Centralized internationalization service
 *
 * Features:
 * - EventTarget-based for language change events
 * - Load translations from JSON manifest and locale files
 * - Translation caching with fallback to default locale
 * - Nested key support with dot notation (e.g., "menu.upload")
 * - Variable interpolation in translations (e.g., "{{count}} items")
 *
 * Event: 'languagechange' - Dispatched when locale changes
 *   detail: { locale: string, previousLocale: string }
 */

export class I18nService extends EventTarget {
    _manifestPath: string;
    _defaultLocale: string;
    _initialLocale: string | null;
    _logger: unknown;
    _manifest: LocaleManifest | null;
    _currentLocale: string;
    _translationCache: Map<string, TranslationMap>;
    _loaded: boolean;

    constructor({
        manifestPath = '/html/locales/locales.json',
        defaultLocale = 'en',
        initialLocale = null,
        logger = null,
    }: I18nServiceOptions = {}) {
        super();
        this._manifestPath = manifestPath;
        this._defaultLocale = defaultLocale;
        this._initialLocale = initialLocale; // Locale to use after loading manifest
        this._logger = logger; // Deprecated: kept for backward compatibility, prefer _log()
        
        // State
        this._manifest = null;
        this._currentLocale = defaultLocale;
        this._translationCache = new Map();
        this._loaded = false;
    }

    /**
     * Log a message with automatic class name capture.
     * @param {string} reason - Reason/event identifier
     * @param {string} [level='debug'] - Log level: 'debug' | 'info' | 'warn' | 'error'
     * @param {...any} data - Optional data to log
     * @private
     */
    _log(reason: string, level: I18nLogLevel = 'debug', ...data: unknown[]): void {
        if (typeof globalThis.__microOtterLog !== 'undefined') {
            const { log } = globalThis.__microOtterLog as I18nLoggerApi;
            
            // Support old signature: _log(reason, data) without level
            const validLevels = ['debug', 'info', 'warn', 'error'];
            const actualLevel = validLevels.includes(level) ? level : 'debug';
            const actualData = validLevels.includes(level) ? data : [level, ...data];
            
            log('I18nService', reason, actualLevel, ...actualData);
        }
    }

    /**
     * Get the currently active locale code
     * @returns {string}
     */
    get currentLocale(): string {
        return this._currentLocale;
    }

    /**
     * Get array of available locale objects from manifest
     * @returns {Array<{code: string, label: string, file: string, icon: string}>}
     */
    get availableLocales(): LocaleEntry[] {
        return this._manifest?.locales || [];
    }

    /**
     * Check if the service has loaded its manifest
     * @returns {boolean}
     */
    get loaded(): boolean {
        return this._loaded;
    }

    /**
     * Load the locale manifest file
     * @param {string} [manifestPath] - Override manifest path
     * @returns {Promise<void>}
     */
    async load(manifestPath = this._manifestPath): Promise<void> {
        const url = manifestPath || this._manifestPath;
        
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(
                    `Failed to load locale manifest: ${response.status} ${response.statusText}`
                );
            }
            
            const manifest = (await response.json()) as LocaleManifest;
            
            // Validate manifest structure
            if (!manifest.locales || !Array.isArray(manifest.locales)) {
                throw new Error('Locale manifest missing required "locales" array');
            }
            
            if (manifest.locales.length === 0) {
                throw new Error('Locale manifest contains no locales');
            }
            
            // Validate each locale entry
            for (const locale of manifest.locales) {
                if (!locale.code || !locale.file) {
                    throw new Error(
                        `Invalid locale entry: missing required "code" or "file" property`
                    );
                }
            }
            
            this._manifest = manifest;
            
            // Use manifest default locale if specified
            if (manifest.defaultLocale) {
                this._defaultLocale = manifest.defaultLocale;
            }
            
            // Ensure default locale exists in manifest
            const defaultExists = manifest.locales.some(
                (locale) => locale.code === this._defaultLocale
            );
            if (!defaultExists) {
                this._log(
                    'invalid-manifest',
                    'warn',
                    `Default locale "${this._defaultLocale}" not found in manifest, using first locale`
                );
                this._defaultLocale = manifest.locales[0].code;
            }
            
            this._loaded = true;
            this._log('manifest-loaded', 'info', `Loaded manifest with ${manifest.locales.length} locales`);
            
            // Load initial locale (from workspace config) or default locale
            const targetLocale = this._initialLocale || this._defaultLocale;
            await this.setLocale(targetLocale);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log('manifest-error', 'error', 'Error loading manifest:', errorMessage);
            throw error;
        }
    }

    /**
     * Switch to a new locale and load its translations
     * @param {string} localeCode - The locale code to switch to (e.g., 'en', 'de')
     * @returns {Promise<string>} The locale that was set
     */
    async setLocale(localeCode: string): Promise<string> {
        if (!this._manifest) {
            throw new Error('Manifest not loaded. Call load() first.');
        }
        
        // Find the locale in manifest
        const localeEntry = this._manifest.locales.find(
            (locale) => locale.code === localeCode
        );
        
        if (!localeEntry) {
            this._log(
                'setlocale-no-manifest',
                'warn',
                `Locale "${localeCode}" not found in manifest, falling back to default`
            );
            return this.setLocale(this._defaultLocale);
        }
        
        // Check if translations are already cached
        if (this._translationCache.has(localeCode)) {
            const previousLocale: string = this._currentLocale;
            this._currentLocale = localeCode;
            
            if (previousLocale !== localeCode) {
                this.dispatchEvent(
                    new CustomEvent('languagechange', {
                        detail: { locale: localeCode, previousLocale } as LanguageChangeDetail,
                    })
                );
                // Also dispatch 'language-changed' for compatibility
                this.dispatchEvent(
                    new CustomEvent('language-changed', {
                        detail: {
                            language: localeCode,
                            previousLanguage: previousLocale,
                        } as LanguageChangedDetail,
                    })
                );
                this._log('locale-switched-cached', 'info', `Switched to locale: ${localeCode} (from cache)`);
            }
            
            return localeCode;
        }
        
        // Load translation file
        const translationUrl = `/html/locales/${localeEntry.file}`;
        
        try {
            const response = await fetch(translationUrl, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(
                    `Failed to load translations: ${response.status} ${response.statusText}`
                );
            }
            
            const translations = (await response.json()) as TranslationMap;
            this._translationCache.set(localeCode, translations);
            
            const previousLocale: string = this._currentLocale;
            this._currentLocale = localeCode;
            
            if (previousLocale !== localeCode) {
                this.dispatchEvent(
                    new CustomEvent('languagechange', {
                        detail: { locale: localeCode, previousLocale } as LanguageChangeDetail,
                    })
                );
                // Also dispatch 'language-changed' for compatibility
                this.dispatchEvent(
                    new CustomEvent('language-changed', {
                        detail: {
                            language: localeCode,
                            previousLanguage: previousLocale,
                        } as LanguageChangedDetail,
                    })
                );
            }
            
            this._log('locale-loaded', 'info', `Loaded and switched to locale: ${localeCode}`);
            return localeCode;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._log('locale-load-error', 'error', `Error loading locale "${localeCode}":`, errorMessage);
            
            // If we failed to load a non-default locale, try default
            if (localeCode !== this._defaultLocale) {
                this._log('falling-back-to-default', 'warn', `Falling back to default locale: ${this._defaultLocale}`);
                return this.setLocale(this._defaultLocale);
            }
            
            throw error;
        }
    }

    /**
     * Get the currently active language code (alias for currentLocale getter)
     * @returns {string}
     */
    getCurrentLanguage(): string {
        return this._currentLocale;
    }

    /**
     * Merge additional translations into a specific locale
     * Used for dynamically loading runtime-specific translations
     * 
     * @param {string} localeCode - The locale to merge into (e.g., 'en', 'de')
     * @param {Object} translations - Translation object to merge
     */
    mergeTranslations(localeCode: string, translations: TranslationMap): void {
        if (!translations || typeof translations !== 'object') {
            this._log('merge-translations-invalid', 'warn', 'Invalid translations object provided');
            return;
        }

        // Get existing translations for this locale
        const existingTranslations = this._translationCache.get(localeCode);
        
        if (!existingTranslations) {
            // Locale not loaded yet, create new entry
            this._log('merge-translations-new', 'warn', `No existing translations for locale ${localeCode}, creating new entry`);
            this._translationCache.set(localeCode, translations);
        } else {
            // Merge new translations into existing (shallow merge at top level)
            const merged = { ...existingTranslations, ...translations };
            this._translationCache.set(localeCode, merged);
            this._log('merge-translations', 'info', `Merged translations for locale: ${localeCode}`);
        }
        
        // If this is the current locale, dispatch event to notify views
        if (localeCode === this._currentLocale) {
            this.dispatchEvent(
                new CustomEvent('languagechange', {
                    detail: {
                        locale: localeCode,
                        previousLocale: localeCode,
                    } as LanguageChangeDetail,
                })
            );
            this.dispatchEvent(
                new CustomEvent('language-changed', {
                    detail: {
                        language: localeCode,
                        previousLanguage: localeCode,
                    } as LanguageChangedDetail,
                })
            );
        }
    }

    /**
     * Translate a key with optional parameter interpolation
     * Supports nested keys with dot notation (e.g., "menu.upload")
     * Interpolates {{variable}} placeholders with params object
     *
     * @param {string} key - Translation key (supports dot notation)
     * @param {Object} [params={}] - Parameters for interpolation
     * @returns {string} Translated string or key if not found
     */
    t(key: string, params: Record<string, unknown> = {}): string {
        if (!key || typeof key !== 'string') {
            this._log('invalid-key', 'warn', 't() called with invalid key:', key);
            return key || '';
        }
        
        // Get translations for current locale
        const translations = this._translationCache.get(this._currentLocale);
        
        // Try to find the translation
        let value = this._getNestedValue(translations, key);
        
        // If not found and current locale is not default, try default locale
        if (value === undefined && this._currentLocale !== this._defaultLocale) {
            const defaultTranslations = this._translationCache.get(this._defaultLocale);
            value = this._getNestedValue(defaultTranslations, key);
            
            if (value !== undefined) {
                this._log(
                    'translation-fallback',
                    'debug',
                    `Translation key "${key}" not found in ${this._currentLocale}, using default`
                );
            }
        }
        
        // If still not found, return the key itself
        if (value === undefined) {
            this._log('translation-not-found', 'warn', `Translation key not found: "${key}"`);
            return key;
        }
        
        // Interpolate parameters if any
        if (params && typeof params === 'object' && Object.keys(params).length > 0) {
            return this._interpolate(String(value), params);
        }

        return String(value);
    }

    /**
     * Get a nested value from an object using dot notation
     * @private
     * @param {Object} obj - Object to search in
     * @param {string} path - Dot-notation path (e.g., "menu.upload")
     * @returns {*} Value at path or undefined
     */
    _getNestedValue(obj: unknown, path: string): unknown {
        if (!obj || typeof obj !== 'object') {
            return undefined;
        }

        if (Object.prototype.hasOwnProperty.call(obj, path)) {
            return obj[path];
        }
        
        const keys = path.split('.');
        let current: any = obj;
        
        for (const key of keys) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[key];
        }
        
        return current;
    }

    /**
     * Interpolate {{variable}} placeholders in a string
     * @private
     * @param {string} template - String with {{placeholders}}
     * @param {Object} params - Object with replacement values
     * @returns {string} Interpolated string
     */
    _interpolate(template: unknown, params: Record<string, unknown>): string {
        if (typeof template !== 'string') {
            return String(template ?? '');
        }
        
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            const value = params[key];
            return value !== undefined ? String(value) : match;
        });
    }
}
