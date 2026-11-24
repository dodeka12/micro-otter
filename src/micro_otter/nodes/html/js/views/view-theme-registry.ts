type ThemeRegistryLogger = (...args: unknown[]) => void;

interface ThemeManifestEntry {
    id?: unknown;
    label?: unknown;
    description?: unknown;
    entry?: unknown;
}

interface ThemeManifestPayload {
    styles?: unknown;
    themes?: unknown;
}

interface NormalizedThemeEntry {
    id: string;
    label: string;
    description: string;
    entry: string;
    basePath: string;
}

interface ThemeSetDetail {
    theme?: unknown;
}

interface ThemesLoadedDetail {
    themes: NormalizedThemeEntry[];
}

interface ThemeChangeDetail {
    theme: string;
}

interface ViewThemeRegistryOptions {
    manifestUrl?: string;
    defaultTheme?: string;
    styleNames?: string[];
    logger?: ThemeRegistryLogger | null;
}

const defaultLogger: ThemeRegistryLogger = (...args: unknown[]) => {
    void args;
};

const DEFAULT_THEME_STYLES: string[] = [
    'view-system',
    'activity-pulse',
    'view-manager',
    'split-view',
    'tabbed-view',
    'text-view',
    'overlay-window',
    'modal-dialog',
    'menu',
    'node-info-view',
    'general-settings-view',
    'collection-settings-view',
    'graph-settings-view',
    'graph-panel-view',
    'all-settings-view',
    'transpiler-view',
    'device-connection-view',
    'data-table-view',
    'custom-runtime-controls',
    'collapsible-view',
    'stack-view',
    'message-view',
    'progress-detail-view',
    'deployment-progress-dialog',
    'connecting-progress-dialog',
];

/**
 * Central registry for view system themes backed by a JSON manifest.
 * Responsibilities:
 * - Load and validate styles/themes.json
 * - Track available themes and the active theme id
 * - Swap theme stylesheets via data-theme-style link tags
 * - Emit themechange and themesloaded events; accept set-theme requests
 */
export class ViewThemeRegistry {
    _manifestUrl: string;
    _defaultTheme: string;
    _styleNames: string[];
    _logger: ThemeRegistryLogger;
    _themes: Map<string, NormalizedThemeEntry>;
    _themeList: NormalizedThemeEntry[];
    _currentTheme: string;
    _loaded: boolean;
    _events: EventTarget;
    _lastAppliedBase: string | undefined;

    constructor({
        manifestUrl = '/html/styles/themes.json',
        defaultTheme = 'standard',
        styleNames = DEFAULT_THEME_STYLES,
        logger = null,
    }: ViewThemeRegistryOptions = {}) {
        this._manifestUrl = manifestUrl;
        this._defaultTheme = defaultTheme;
        this._styleNames =
            Array.isArray(styleNames) && styleNames.length ? styleNames : DEFAULT_THEME_STYLES;
        this._logger = logger || defaultLogger;
        this._themes = new Map();
        this._themeList = [];
        this._currentTheme = defaultTheme;
        this._loaded = false;
        this._events = new EventTarget();
        this._events.addEventListener('set-theme', (event: Event) => {
            const customEvent = event as CustomEvent<ThemeSetDetail | string>;
            const detail = customEvent?.detail;
            const requested =
                typeof detail === 'string'
                    ? detail
                    : detail && typeof detail === 'object' && 'theme' in detail
                      ? detail.theme
                      : undefined;
            if (typeof requested === 'string' && requested.trim()) {
                this.setTheme(requested);
            }
        });
    }

    get events(): EventTarget {
        return this._events;
    }

    get themes(): NormalizedThemeEntry[] {
        return [...this._themeList];
    }

    get currentTheme(): string {
        return this._currentTheme;
    }

    get loaded(): boolean {
        return this._loaded;
    }

    async load(manifestUrl: string = this._manifestUrl): Promise<NormalizedThemeEntry[]> {
        const url = manifestUrl || this._manifestUrl;
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(
                `Failed to load theme manifest: ${response.status} ${response.statusText}`
            );
        }
        const payload = (await response.json()) as ThemeManifestPayload;
        const stylesFromManifest = this.#normalizeStyles(payload?.styles);
        const entries = Array.isArray(payload?.themes) ? payload.themes : [];
        if (!entries.length) {
            throw new Error('Theme manifest contained no themes.');
        }
        const normalized = entries
            .map((entry) => this.#normalizeThemeEntry(entry as ThemeManifestEntry))
            .filter((entry): entry is NormalizedThemeEntry => Boolean(entry));
        if (!normalized.length) {
            throw new Error('Theme manifest contained no valid themes.');
        }

        if (stylesFromManifest.length) {
            this._styleNames = stylesFromManifest;
        }

        this._themes.clear();
        this._themeList = normalized;
        normalized.forEach((theme) => this._themes.set(theme.id, theme));
        this._loaded = true;

        if (!this._themes.has(this._currentTheme)) {
            this._currentTheme = normalized[0].id;
        }

        this.applyThemeStyles(this._currentTheme);
        this._events.dispatchEvent(
            new CustomEvent<ThemesLoadedDetail>('themesloaded', { detail: { themes: this.themes } })
        );
        return this.themes;
    }

    /**
     * Apply a theme by id and broadcast themechange.
     * @param themeId Theme id
     * @returns The applied theme id
     */
    setTheme(themeId: string): string {
        const resolved = this.#resolveTheme(themeId) || this.#resolveTheme(this._currentTheme);
        if (!resolved) {
            return this._currentTheme;
        }
        const nextId = resolved.id;
        const changed =
            nextId !== this._currentTheme || this._lastAppliedBase !== resolved.basePath;
        this._currentTheme = nextId;
        this.applyThemeStyles(resolved);
        if (changed) {
            this._events.dispatchEvent(
                new CustomEvent<ThemeChangeDetail>('themechange', {
                    detail: { theme: this._currentTheme },
                })
            );
        }
        return this._currentTheme;
    }

    /**
     * Swap data-theme-style link tags to the paths for the target theme.
     * @param target Theme id or normalized theme record
     * @returns The theme id applied
     */
    applyThemeStyles(target: string | NormalizedThemeEntry): string {
        if (typeof document === 'undefined') {
            return this._currentTheme;
        }
        const theme =
            typeof target === 'string'
                ? this._themes.get(target) || this.#fallbackTheme(target)
                : target;
        const themeId = theme?.id || this._currentTheme;
        const basePath = theme?.basePath || this.#deriveBasePath(themeId);
        this._lastAppliedBase = basePath;

        this._styleNames.forEach((styleName) => {
            const selector = `link[data-theme-style="${styleName}"]`;
            let link = document.querySelector(selector) as HTMLLinkElement | null;
            if (!link) {
                link = document.createElement('link');
                link.rel = 'stylesheet';
                link.setAttribute('data-theme-style', styleName);
                document.head.appendChild(link);
            }
            link.href = `${basePath}/${styleName}.css`;
            link.dataset.theme = themeId;
        });

        this._currentTheme = themeId;
        return themeId;
    }

    #resolveTheme(themeId: string | null | undefined): NormalizedThemeEntry | null {
        const id = typeof themeId === 'string' && themeId.trim() ? themeId.trim() : null;
        if (id && this._themes.has(id)) {
            return this._themes.get(id) ?? null;
        }
        return null;
    }

    #normalizeThemeEntry(entry: ThemeManifestEntry | null | undefined): NormalizedThemeEntry | null {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;
        const label =
            typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id;
        const description =
            typeof entry.description === 'string' && entry.description.trim()
                ? entry.description.trim()
                : '';
        const entryPath =
            typeof entry.entry === 'string' && entry.entry.trim() ? entry.entry.trim() : null;
        if (!id || !label || !entryPath) {
            return null;
        }
        const basePath = this.#deriveBasePath(id, entryPath);
        return { id, label, description, entry: entryPath, basePath };
    }

    #deriveBasePath(themeId: string, entryPath: string | null = null): string {
        const entry = entryPath || `/html/styles/${themeId}/view-system.css`;
        const lastSlash = entry.lastIndexOf('/');
        let base = lastSlash >= 0 ? entry.slice(0, lastSlash) : entry;
        if (base && !base.startsWith('./') && !base.startsWith('/')) {
            base = `/html/${base}`;
        }
        return base;
    }

    #fallbackTheme(themeId: string): NormalizedThemeEntry {
        const id = typeof themeId === 'string' && themeId.trim() ? themeId.trim() : this._defaultTheme;
        return {
            id,
            label: id,
            description: '',
            entry: `/html/styles/${id}/view-system.css`,
            basePath: this.#deriveBasePath(id),
        };
    }

    #normalizeStyles(styles: unknown): string[] {
        if (!Array.isArray(styles)) {
            return [];
        }
        const trimmed = styles
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter((name): name is string => Boolean(name));
        return trimmed.length ? trimmed : [];
    }
}
