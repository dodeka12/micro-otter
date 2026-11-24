// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

import { ViewBase } from './view-base.js';
import NodeTypeUiModule from '../nodes/node-type-ui.js';
import { IconProvider } from './icon-provider.js';
import { NodeInfoView } from './node-info-view.js';
import { buildNodeInfoContent } from './node-info-content.js';
import type { NodeInfoSource } from './node-info-content.js';
import {
    ORGANIZATIONAL_PALETTE_ENTRIES,
    ORGANIZATIONAL_CATEGORY,
} from '../nodes/organizational-palette.js';
import { normalizeExecutionType } from '../data/graph-execution-settings.js';
import {
    FUNCTION_NODE_PACKAGE_ID,
    FUNCTION_NODE_PACKAGE_NAME,
    listFunctionNodeDefinitions,
} from '../data/function-node-definition.js';

type OrganizationMode = 'alphabetical' | 'package' | 'category';
type PaletteViewSize = 'small' | 'large';
type LocalizedText = string | Record<string, string>;

interface NodePaletteNodeType {
    id: string;
    type?: string;
    title?: LocalizedText;
    info?: LocalizedText;
    category?: string | null;
    color?: string;
    icon?: string;
    packageId?: string | null;
    packageName?: string | null;
    [key: string]: unknown;
}

interface NodePackageLike {
    id?: string | null;
    name?: string | null;
    nodeTypes: Map<string, Record<string, unknown>>;
}

interface DeviceRuntimeLike {
    nodePackages: Iterable<NodePackageLike>;
    packageProvenance?: (packageId: string) => 'builtin' | 'addon';
}

interface RuntimeCollectionLike {
    on?: (eventName: string, listener: (event: unknown) => void) => (() => void) | void;
}

interface PaletteGraphLike {
    getId?: () => string;
    getExecutionType?: () => unknown;
    on?: (eventName: string, listener: (event: unknown) => void) => (() => void) | void;
}

interface PaletteCollectionLike {
    getActiveGraph?: () => PaletteGraphLike | null;
    getGraphArray?: () => unknown;
    on?: (eventName: string, listener: (event: unknown) => void) => (() => void) | void;
}

interface PaletteCollectionManagerLike {
    getActiveCollection?: () => PaletteCollectionLike | null;
    on?: (eventName: string, listener: (event: unknown) => void) => (() => void) | void;
}

interface NodePaletteConfig {
    organizationMode?: OrganizationMode;
    viewSize?: PaletteViewSize;
    favorites?: string[];
    recentlyUsed?: string[];
    sectionStates?: Record<string, boolean>;
}

interface NodePaletteI18nServiceLike {
    currentLocale?: string;
    t: (key: string, params?: Record<string, unknown>) => string;
    addEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    removeEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
}

interface WorkspaceConfigLike {
    nodePalette?: NodePaletteConfig;
    [key: string]: unknown;
}

interface PaletteSearchState {
    searchTerm: string;
    debounceDelay: number;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    filteredTypes: NodePaletteNodeType[];
}

interface NodeTypeUiLike {
    domElement: HTMLElement;
    render: () => HTMLElement;
    destroy: () => void;
}

interface NodeTypeUiCtor {
    new (
        nodeType: NodePaletteNodeType,
        size?: PaletteViewSize,
        options?: {
            iconProvider?: unknown;
            t?: (key: string) => string;
            logger?: unknown;
        }
    ): NodeTypeUiLike;
}

interface NodePaletteViewOptions {
    deviceRuntime?: DeviceRuntimeLike | null;
    runtimeCollection?: RuntimeCollectionLike | null;
    collectionManager?: PaletteCollectionManagerLike | null;
    workspaceConfig?: WorkspaceConfigLike | null;
    iconProvider?: unknown;
    i18nService?: NodePaletteI18nServiceLike | null;
    logger?: ((message: string, level?: unknown, ...data: unknown[]) => void) | null;
    title?: string;
    icon?: string | null;
    id?: string | null;
    minWidth?: number | null;
    minHeight?: number | null;
    maxWidth?: number | null;
    maxHeight?: number | null;
    viewManager?: ViewManagerLike | null;
    [key: string]: unknown;
}

interface NodePaletteOverlayLike {
    on: (event: string, handler: (event: unknown) => void) => unknown;
    close: () => void;
}

interface ViewManagerLike {
    addOverlay: (
        view: unknown,
        options?: Record<string, unknown>
    ) => NodePaletteOverlayLike;
}

interface NodePaletteDeserializeData {
    title?: string;
    icon?: string;
    id?: string | null;
    [key: string]: unknown;
}

interface NodePaletteDeserializeContext {
    i18nService?: NodePaletteI18nServiceLike | null;
    logger?: ((message: string, level?: unknown, ...data: unknown[]) => void) | null;
    deviceRuntime?: DeviceRuntimeLike | null;
    runtimeCollection?: RuntimeCollectionLike | null;
    collectionManager?: PaletteCollectionManagerLike | null;
    workspaceConfig?: WorkspaceConfigLike | null;
    iconProvider?: unknown;
    viewManager?: ViewManagerLike | null;
    [key: string]: unknown;
}

const NodeTypeUi = NodeTypeUiModule as unknown as NodeTypeUiCtor;

function isLocalizedRecord(value: unknown): value is Record<string, string> {
    return Boolean(value) && typeof value === 'object';
}

/**
 * NodePaletteView: Displays available node types in an organized, searchable palette.
 *
 * Features:
 * - Three organization modes: alphabetical, by package, by category
 * - Search/filter by name, description, tags, categories
 * - Small and large display modes
 * - Favorites and recently used sections
 * - Auto-responsive grid layout
 *
 * Integration:
 * - Extends ViewBase for lifecycle and i18n
 * - Uses NodeTypeUi instances from Phase 1
 * - Stores preferences in workspace config
 * - Drag operations originate from this view
 */
export class NodePaletteView extends ViewBase {
    private _deviceRuntime: DeviceRuntimeLike;
    private _runtimeCollection: RuntimeCollectionLike | null;
    private _runtimesLoadedUnsubscribe: (() => void) | null;
    private _collectionManager: PaletteCollectionManagerLike | null;
    private _collectionUnsubscribe: (() => void) | null;
    private _graphUnsubscribes: (() => void)[];
    private _activeCollectionUnsubscribes: (() => void)[];
    private _workspaceConfig: WorkspaceConfigLike;
    private _iconProvider: unknown;
    private _viewManager: ViewManagerLike | null;
    private _activeInfoOverlay: NodePaletteOverlayLike | null;

    private _nodeTypes: NodePaletteNodeType[];
    private _nodeTypeUis: Map<string, NodeTypeUiLike>;

    private _searchState: PaletteSearchState;

    private _searchInput: HTMLInputElement | null;
    private _gridContainer: HTMLDivElement | null;
    private _favoritesContainer: HTMLDivElement | null;
    private _recentContainer: HTMLDivElement | null;
    private _organizationalContainer: HTMLDivElement | null;
    private _organizationButtons: Map<OrganizationMode, HTMLButtonElement>;
    private _sizeToggleButton: HTMLButtonElement | null;

    private _organizationMode: OrganizationMode;
    private _viewSize: PaletteViewSize;
    private _favorites: Set<string>;
    private _recentlyUsed: string[];
    private _maxRecent: number;
    private _sectionStates: Map<string, boolean>;

    /**
     * Create a new NodePaletteView instance.
     */
    constructor({
        deviceRuntime = null,
        runtimeCollection = null,
        collectionManager = null,
        workspaceConfig = null,
        iconProvider = null,
        i18nService = null,
        logger = null,
        viewManager = null,
        ...rest
    }: NodePaletteViewOptions = {}) {
        super({
            title: 'Node Palette',
            icon: 'palette',
            minWidth: 200,
            maxWidth: 420,
            i18nService,
            logger,
            ...rest,
        });

        if (!deviceRuntime) {
            throw new Error('NodePaletteView requires deviceRuntime');
        }
        if (!workspaceConfig) {
            throw new Error('NodePaletteView requires workspaceConfig');
        }

        this._deviceRuntime = deviceRuntime;
        this._runtimeCollection = runtimeCollection;
        this._runtimesLoadedUnsubscribe = null;
        this._collectionManager = collectionManager;
        this._collectionUnsubscribe = null;
        this._graphUnsubscribes = [];
        this._activeCollectionUnsubscribes = [];
        this._workspaceConfig = workspaceConfig;
        this._iconProvider = iconProvider;
        this._viewManager = viewManager;
        this._activeInfoOverlay = null;

        this._nodeTypes = [];
        this._nodeTypeUis = new Map();

        this._searchState = {
            searchTerm: '',
            debounceDelay: 150,
            debounceTimer: null,
            filteredTypes: [],
        };

        this._searchInput = null;
        this._gridContainer = null;
        this._favoritesContainer = null;
        this._recentContainer = null;
        this._organizationalContainer = null;
        this._organizationButtons = new Map();
        this._sizeToggleButton = null;

        this._organizationMode = 'category';
        this._viewSize = 'small';
        this._favorites = new Set();
        this._recentlyUsed = [];
        this._maxRecent = 10;
        this._sectionStates = new Map();
    }

    /**
     * Resolve a label, falling back to the English default when the key is not translated.
     *
     * `I18nService.t()` echoes the key for unknown keys, so the fallback must be applied here.
     * @param {string} key - i18n key.
     * @param {string} fallback - English default.
     * @returns {string} Resolved label.
     * @private
     */
    private _tWithFallback(key: string, fallback: string): string {
        const value = this.t(key);
        return !value || value === key ? fallback : value;
    }

    render(container: HTMLElement): void {
        void container;

        this._loadConfig();
        this._loadNodeTypes();

        const wrapper = document.createElement('div');
        wrapper.className = 'node-palette-view';

        const toolbar = this._createToolbar();
        wrapper.appendChild(toolbar);

        // Graph items (documentation areas, …) are not node types, so they never mix into the
        // categorized/alphabetical list: they get their own section pinned to the top, in every
        // organization mode.
        const organizationalSection = this._createOrganizationalSection();
        wrapper.appendChild(organizationalSection);

        const favoritesSection = this._createFavoritesSection();
        wrapper.appendChild(favoritesSection);

        const recentSection = this._createRecentSection();
        wrapper.appendChild(recentSection);

        const gridContainer = this._createGridContainer();
        wrapper.appendChild(gridContainer);

        this.mountContent(wrapper);
        this._renderNodeTypes();

        this._log('render', {
            nodeTypesCount: this._nodeTypes.length,
            organizationMode: this._organizationMode,
            viewSize: this._viewSize,
        });
    }

    afterAttach(): void {
        super.afterAttach();

        this._subscribeToLanguageChanges(() => {
            this._updateLabels();
            this._renderNodeTypes();
        });

        this._subscribeToRuntimeReloads();
        this._subscribeToCollectionChanges();

        this._notifySplitViewConstraints();
    }

    beforeDetach(): void {
        this._closeActiveInfoOverlay();
        this._destroyAllNodeTypeUis();

        if (this._runtimesLoadedUnsubscribe) {
            this._runtimesLoadedUnsubscribe();
            this._runtimesLoadedUnsubscribe = null;
        }

        if (this._collectionUnsubscribe) {
            this._collectionUnsubscribe();
            this._collectionUnsubscribe = null;
        }

        this._activeCollectionUnsubscribes.forEach((unsubscribe) => unsubscribe());
        this._activeCollectionUnsubscribes = [];

        this._graphUnsubscribes.forEach((unsubscribe) => unsubscribe());
        this._graphUnsubscribes = [];

        if (this._searchState.debounceTimer) {
            clearTimeout(this._searchState.debounceTimer);
            this._searchState.debounceTimer = null;
        }

        super.beforeDetach();
    }

    /**
     * Re-render when the runtime collection reloads its node packages.
     *
     * `DeviceRuntimeCollection.load()` runs again after every add-on install and uninstall, and it
     * reloads the runtime instance in place. Without this subscription the palette would keep
     * showing the package list it read at start-up, so a freshly installed add-on stayed invisible
     * and an uninstalled one stayed clickable. The subscription is optional: a palette constructed
     * without a runtime collection (standalone demos, tests) simply never refreshes this way.
     * @private
     */
    private _subscribeToRuntimeReloads(): void {
        if (this._runtimesLoadedUnsubscribe) {
            this._runtimesLoadedUnsubscribe();
            this._runtimesLoadedUnsubscribe = null;
        }

        const on = this._runtimeCollection?.on;
        if (typeof on !== 'function') {
            return;
        }

        const unsubscribe = on.call(this._runtimeCollection, 'runtimesLoaded', () => {
            this._log('runtimes-reloaded');
            this.update();
        });

        this._runtimesLoadedUnsubscribe =
            typeof unsubscribe === 'function' ? unsubscribe : null;
    }

    /**
     * Load persisted palette preferences from the workspace config.
     *
     * A stored `organizationMode` always wins, so existing workspaces keep the mode the
     * user picked earlier. Only a workspace without a stored mode falls back to the
     * default, which is sorting the palette by node category.
     *
     * Called by `render()` before the toolbar and grid are built.
     */
    private _loadConfig(): void {
        const config = this._workspaceConfig.nodePalette || {};

        this._organizationMode = config.organizationMode || 'category';
        this._viewSize = config.viewSize || 'small';

        if (Array.isArray(config.favorites)) {
            this._favorites = new Set(config.favorites);
        }

        if (Array.isArray(config.recentlyUsed)) {
            this._recentlyUsed = config.recentlyUsed.slice(0, this._maxRecent);
        }

        if (config.sectionStates && typeof config.sectionStates === 'object') {
            this._sectionStates = new Map(
                Object.entries(config.sectionStates as Record<string, boolean>)
            );
        }

        this._log('config-loaded', {
            organizationMode: this._organizationMode,
            viewSize: this._viewSize,
            favoritesCount: this._favorites.size,
            recentCount: this._recentlyUsed.length,
        });
    }

    private _saveConfig(): void {
        this._workspaceConfig.nodePalette = {
            organizationMode: this._organizationMode,
            viewSize: this._viewSize,
            favorites: Array.from(this._favorites),
            recentlyUsed: this._recentlyUsed,
            sectionStates: Object.fromEntries(this._sectionStates),
        };

        this._log('config-saved', {
            organizationMode: this._organizationMode,
            viewSize: this._viewSize,
            favoritesCount: this._favorites.size,
            recentCount: this._recentlyUsed.length,
        });
    }

    private _loadNodeTypes(): void {
        this._nodeTypes = [];

        for (const nodePackage of this._deviceRuntime.nodePackages) {
            (nodePackage.nodeTypes as Map<string, Record<string, unknown>>).forEach(
                (nodeType, typeId) => {
                    const nodeTypeData: NodePaletteNodeType = {
                        id: typeId,
                        ...nodeType,
                        packageId: nodePackage.id,
                        packageName: nodePackage.name,
                    };
                    this._nodeTypes.push(nodeTypeData);

                    this._log('node-type-category-debug', {
                        id: typeId,
                        category: nodeType.category,
                        hasCategory: 'category' in nodeType,
                    });
                }
            );
        }

        // Graph items (documentation areas, …) are not node types: they are merged in here so the
        // palette can list them, and every node-only code path skips `type === 'graph-item'`.
        this._nodeTypes.push(...this._createOrganizationalEntries());

        // Generated function nodes are ordinary node types; they are appended last so that a
        // runtime package with the same id keeps winning the dedupe below.
        this._nodeTypes.push(...this._createFunctionNodeEntries());

        this._searchState.filteredTypes = [...this._nodeTypes];

        this._log('node-types-loaded', { count: this._nodeTypes.length });
    }

    /**
     * Map the active collection's function graphs onto palette node types.
     *
     * Each enabled function graph appears under its own palette category and under the
     * `function` package group (D8/D9). The graph being edited never lists itself, a
     * disabled graph disappears, and an id that a runtime package already provides is
     * skipped so a generated definition can never shadow a real node type.
     *
     * @returns {NodePaletteNodeType[]} Entries ready for grouping and search.
     * @private
     */
    private _createFunctionNodeEntries(): NodePaletteNodeType[] {
        const collection = this._collectionManager?.getActiveCollection?.() ?? null;
        if (!collection) {
            return [];
        }

        const runtimeTypeIds = new Set(this._nodeTypes.map((nodeType) => nodeType.id));
        const activeGraphId = collection.getActiveGraph?.()?.getId?.() ?? null;
        const packageName = this._resolveTranslator(
            'nodePalette.functionPackage',
            FUNCTION_NODE_PACKAGE_NAME
        );

        return listFunctionNodeDefinitions(collection, { excludeGraphId: activeGraphId })
            .filter((definition) => !runtimeTypeIds.has(definition.type))
            .map((definition) => ({
                id: definition.type,
                type: 'node-type',
                category: definition.category,
                packageId: FUNCTION_NODE_PACKAGE_ID,
                packageName,
                icon: definition.icon,
                color: definition.color,
                title: definition.title,
                info: definition.info,
                inputs: definition.inputs,
                outputs: definition.outputs,
            }));
    }

    /**
     * Re-render when the active collection or graph changes.
     *
     * The organizational section lists function-graph-only entries, so a graph
     * switch or an execution-type change must rebuild the palette. Two seams are
     * used because neither alone covers every path: the collection manager and the
     * collection report graph switches (`activeCollectionChanged`, `activeGraphIdx`,
     * `graphUpdated`), while `graph.setExecutionType()` emits only on the graph
     * itself — the collection does not re-emit it.
     * @private
     */
    private _subscribeToCollectionChanges(): void {
        if (this._collectionUnsubscribe) {
            this._collectionUnsubscribe();
            this._collectionUnsubscribe = null;
        }

        const managerOn = this._collectionManager?.on;
        if (typeof managerOn === 'function') {
            const unsubscribe = managerOn.call(
                this._collectionManager,
                'activeCollectionChanged',
                () => {
                    this._subscribeToActiveGraph();
                    this.update();
                }
            );
            this._collectionUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
        }

        this._subscribeToActiveGraph();
    }

    /**
     * Watch the active collection and graph for changes that alter the palette.
     * @private
     */
    private _subscribeToActiveGraph(): void {
        this._graphUnsubscribes.forEach((unsubscribe) => unsubscribe());
        this._graphUnsubscribes = [];
        this._activeCollectionUnsubscribes.forEach((unsubscribe) => unsubscribe());
        this._activeCollectionUnsubscribes = [];

        const collection = this._collectionManager?.getActiveCollection?.() ?? null;
        const collectionOn = collection?.on;
        if (typeof collectionOn === 'function') {
            const rerender = () => {
                this._subscribeToActiveGraph();
                this.update();
            };
            const unsubscribes = [
                collectionOn.call(collection, 'activeGraphIdx', rerender),
                // A graph list change can add or remove callable functions, so the graph
                // subscription has to follow the active graph again.
                collectionOn.call(collection, 'graphAdded', rerender),
                collectionOn.call(collection, 'graphRemoved', rerender),
                collectionOn.call(collection, 'graphUpdated', () => this.update()),
            ];
            unsubscribes.forEach((unsubscribe) => {
                if (typeof unsubscribe === 'function') {
                    this._activeCollectionUnsubscribes.push(unsubscribe);
                }
            });
        }

        const graph = collection?.getActiveGraph?.() ?? null;
        const graphOn = graph?.on;
        if (typeof graphOn === 'function') {
            // `executionType` and `functionSignature` change which entries exist;
            // `name` and `enabled` change a generated entry's label or presence.
            for (const eventName of ['executionType', 'functionSignature', 'name', 'enabled']) {
                const unsubscribe = graphOn.call(graph, eventName, () => this.update());
                if (typeof unsubscribe === 'function') {
                    this._graphUnsubscribes.push(unsubscribe);
                }
            }
        }
    }

    /**
     * Whether the active graph is a function graph.
     *
     * Unknown managers, collections or graphs answer `false`, so a palette built
     * without them keeps its pre-function contents.
     * @returns {boolean} True when the active graph's execution type is `function`.
     * @private
     */
    private _isActiveGraphFunctionGraph(): boolean {
        const collection = this._collectionManager?.getActiveCollection?.() ?? null;
        const graph = collection?.getActiveGraph?.() ?? null;
        return normalizeExecutionType(graph?.getExecutionType?.()) === 'function';
    }

    /**
     * Map the organizational graph-item entries onto the palette's node-type shape.
     * @returns {NodePaletteNodeType[]} Entries ready for grouping and search.
     * @private
     */
    private _createOrganizationalEntries(): NodePaletteNodeType[] {
        const language = this._getActiveLanguage();

        const localize = (key: string, fallbackMap: { en: string; de: string }) => {
            const translated = this.t(key);
            if (translated && translated !== key) {
                return translated;
            }
            return {
                en: fallbackMap.en,
                de: fallbackMap.de,
                [language]: fallbackMap[language as 'en' | 'de'] ?? fallbackMap.en,
            };
        };

        const isFunctionGraph = this._isActiveGraphFunctionGraph();

        return ORGANIZATIONAL_PALETTE_ENTRIES.filter(
            (entry) => entry.visibleFor !== 'function-graph' || isFunctionGraph
        ).map((entry) => ({
            id: entry.id,
            type: 'graph-item',
            category: this._resolveTranslator(
                'nodePalette.organizational',
                ORGANIZATIONAL_CATEGORY
            ),
            packageId: null,
            packageName: ORGANIZATIONAL_CATEGORY,
            // Resolve the registry name to a URL: NodeTypeUi assigns `icon` straight to `img.src`.
            icon: IconProvider.get(entry.icon),
            title: localize(entry.i18n.title, entry.title),
            info: localize(entry.i18n.info, entry.description),
        }));
    }

    /**
     * Translate a key, falling back to the given English text when the locale has no entry.
     * @param {string} key - i18n key.
     * @param {string} fallback - English default.
     * @returns {string} Resolved label.
     * @private
     */
    private _resolveTranslator(key: string, fallback: string): string {
        const translated = this.t(key);
        return translated && translated !== key ? translated : fallback;
    }

    /**
     * Language code the palette should resolve localized text for.
     * @returns {string} Language code, or 'en' when unknown.
     * @private
     */
    private _getActiveLanguage(): string {
        const service = this._i18nService as
            | { getCurrentLanguage?: () => string; currentLanguage?: string }
            | null;
        const language =
            typeof service?.getCurrentLanguage === 'function'
                ? service.getCurrentLanguage()
                : service?.currentLanguage;
        return typeof language === 'string' && language ? language.split('-')[0] : 'en';
    }

    /**
     * Whether a palette entry is a graph item rather than a node type.
     * @param {object} nodeType - Palette entry.
     * @returns {boolean} True for graph items.
     * @private
     */
    private _isGraphItem(nodeType: NodePaletteNodeType): boolean {
        return nodeType?.type === 'graph-item';
    }

    /**
     * Whether an id belongs to a graph-item entry.
     * @param {string} nodeTypeId - Palette entry id.
     * @returns {boolean} True for graph items.
     * @private
     */
    private _isGraphItemId(nodeTypeId: string): boolean {
        return this._nodeTypes.some(
            (nodeType) => nodeType.id === nodeTypeId && this._isGraphItem(nodeType)
        );
    }

    private _createToolbar(): HTMLElement {
        const toolbar = document.createElement('div');
        toolbar.className = 'node-palette-view__toolbar';

        this._searchInput = document.createElement('input');
        this._searchInput.type = 'text';
        this._searchInput.className = 'node-palette-view__search-input';
        this._searchInput.placeholder = this._tWithFallback(
            'nodePalette.search',
            'Search nodes...'
        );
        this._searchInput.addEventListener('input', (e: Event) => this._onSearchInput(e));
        toolbar.appendChild(this._searchInput);

        const orgContainer = document.createElement('div');
        orgContainer.className = 'node-palette-view__organization';

        const modes: Array<{
            mode: OrganizationMode;
            label: string;
            icon: string;
        }> = [
            {
                mode: 'alphabetical',
                label: this._tWithFallback('nodePalette.organizeMode.alphabetical', 'Alphabetical'),
                icon: IconProvider.sortByAlpha,
            },
            {
                mode: 'package',
                label: this._tWithFallback('nodePalette.organizeMode.package', 'By Package'),
                icon: IconProvider.nodePackage,
            },
            {
                mode: 'category',
                label: this._tWithFallback('nodePalette.organizeMode.category', 'By Category'),
                icon: IconProvider.nodeCategory,
            },
        ];

        for (const { mode, label, icon } of modes) {
            const button = document.createElement('button');
            button.className = 'node-palette-view__org-button';
            button.title = label;
            button.dataset.mode = mode;

            const img = document.createElement('img');
            img.src = icon;
            img.className = 'node-palette-view__button-icon';
            img.alt = label;
            button.appendChild(img);

            if (mode === this._organizationMode) {
                button.classList.add('is-active');
            }

            button.addEventListener('click', () => this._onOrganizationModeChange(mode));

            this._organizationButtons.set(mode, button);
            orgContainer.appendChild(button);
        }

        toolbar.appendChild(orgContainer);

        this._sizeToggleButton = document.createElement('button');
        this._sizeToggleButton.className = 'node-palette-view__size-toggle';
        this._sizeToggleButton.title =
            this._viewSize === 'small'
                ? this._tWithFallback('nodePalette.viewSize.large', 'Large')
                : this._tWithFallback('nodePalette.viewSize.small', 'Small');

        const sizeIcon = document.createElement('img');
        sizeIcon.src =
            this._viewSize === 'small'
                ? IconProvider.nodeTypeUiSelectLarge
                : IconProvider.nodeTypeUiSelectSmall;
        sizeIcon.className = 'node-palette-view__button-icon';
        sizeIcon.alt = this._sizeToggleButton.title;
        this._sizeToggleButton.appendChild(sizeIcon);

        this._sizeToggleButton.addEventListener('click', () => this._onViewSizeToggle());
        toolbar.appendChild(this._sizeToggleButton);

        return toolbar;
    }

    /**
     * Section that holds the organizational graph items, pinned above Favorites.
     *
     * It is deliberately *not* a collapsible group: it is the palette's "insert a documentation
     * area" affordance and has to stay visible in category, package and alphabetical mode.
     * @returns {HTMLElement} The section wrapper.
     * @private
     */
    private _createOrganizationalSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'node-palette-view__section node-palette-view__organizational';
        section.dataset.section = 'organizational';

        const heading = document.createElement('h3');
        heading.className = 'node-palette-view__section-heading';
        heading.textContent = this._tWithFallback('nodePalette.organizational', 'Organizational');
        section.appendChild(heading);

        this._organizationalContainer = document.createElement('div');
        this._organizationalContainer.className = 'node-palette-view__section-grid';
        section.appendChild(this._organizationalContainer);

        return section;
    }

    private _createFavoritesSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'node-palette-view__section node-palette-view__favorites';

        const heading = document.createElement('h3');
        heading.className = 'node-palette-view__section-heading';
        heading.textContent = this._tWithFallback('nodePalette.favorites', 'Favorites');
        section.appendChild(heading);

        this._favoritesContainer = document.createElement('div');
        this._favoritesContainer.className = 'node-palette-view__section-grid';
        section.appendChild(this._favoritesContainer);

        return section;
    }

    private _createRecentSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'node-palette-view__section node-palette-view__recent';

        const heading = document.createElement('h3');
        heading.className = 'node-palette-view__section-heading';
        heading.textContent = this._tWithFallback('nodePalette.recent', 'Recently Used');
        section.appendChild(heading);

        this._recentContainer = document.createElement('div');
        this._recentContainer.className = 'node-palette-view__section-grid';
        section.appendChild(this._recentContainer);

        return section;
    }

    private _createGridContainer(): HTMLDivElement {
        this._gridContainer = document.createElement('div');
        this._gridContainer.className = 'node-palette-view__grid';
        this._gridContainer.dataset.viewSize = this._viewSize;

        return this._gridContainer;
    }

    private _renderGroupedSections(groups: Map<string, NodePaletteNodeType[]>): void {
        if (!this._gridContainer) {
            return;
        }

        this._gridContainer.className = 'node-palette-view__sections';

        groups.forEach((nodeTypes, groupName) => {
            const section = this._createCollapsibleSection(groupName, nodeTypes);
            this._gridContainer!.appendChild(section);
        });
    }

    private _createCollapsibleSection(
        groupName: string,
        nodeTypes: NodePaletteNodeType[]
    ): HTMLDetailsElement {
        const details = document.createElement('details');
        details.className = 'collapsible-section';

        const isExpanded = this._sectionStates.get(groupName) ?? true;
        if (isExpanded) {
            details.setAttribute('open', '');
        }

        const summary = document.createElement('summary');
        summary.className = 'collapsible-section__header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'collapsible-section__name';
        nameSpan.textContent = groupName;
        summary.appendChild(nameSpan);

        const packageId = nodeTypes.find((nodeType) => !!nodeType.packageId)?.packageId ?? null;
        if (packageId && this._deviceRuntime.packageProvenance?.(packageId) === 'addon') {
            summary.appendChild(this._createAddonBadge());
        }

        details.appendChild(summary);

        const grid = document.createElement('div');
        grid.className = 'collapsible-section__grid';
        grid.dataset.viewSize = this._viewSize;

        nodeTypes.forEach((nodeType) => {
            const nodeTypeUi = this._getOrCreateNodeTypeUi(nodeType);
            grid.appendChild(nodeTypeUi.domElement);
        });

        details.appendChild(grid);

        details.addEventListener('toggle', (event: Event) => {
            this._onSectionToggle(event, groupName);
        });

        return details;
    }

    /**
     * Build the badge that marks a section as an installed add-on package.
     *
     * The marker carries text *and* an `aria-label`, so it is never colour-only, and it
     * reuses the palette's section-header tokens so no theme work is needed.
     * @returns {HTMLSpanElement} The badge element.
     * @private
     */
    private _createAddonBadge(): HTMLSpanElement {
        const badge = document.createElement('span');
        badge.className = 'collapsible-section__badge';
        badge.textContent = this._resolveTranslator('palette.nodePackage.addonBadge', 'Add-on');
        const tooltip = this._resolveTranslator(
            'palette.nodePackage.addonTooltip',
            'Installed from an add-on package'
        );
        badge.title = tooltip;
        badge.setAttribute('aria-label', tooltip);
        return badge;
    }

    private _onSectionToggle(event: Event, groupName: string): void {
        const target = event.target;
        if (!(target instanceof HTMLDetailsElement)) {
            return;
        }

        const isOpen = target.open;

        this._sectionStates.set(groupName, isOpen);
        this._saveConfig();

        this._log('section-toggled', { groupName, isOpen });
    }

    /**
     * Sort a list of palette entries by their display name.
     * @param {NodePaletteNodeType[]} nodeTypes - Entries to sort in place.
     * @private
     */
    private _sortAlphabetically(nodeTypes: NodePaletteNodeType[]): void {
        nodeTypes.sort((a, b) => {
            const nameA = this._getDisplayName(a).toLowerCase();
            const nameB = this._getDisplayName(b).toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }

    /**
     * Group a list of palette entries by package name.
     * @param {NodePaletteNodeType[]} nodeTypes - Entries to group.
     * @returns {Map<string, NodePaletteNodeType[]>} Groups in display order.
     * @private
     */
    private _groupByPackage(
        nodeTypes: NodePaletteNodeType[]
    ): Map<string, NodePaletteNodeType[]> {
        const groups = new Map<string, NodePaletteNodeType[]>();

        for (const nodeType of nodeTypes) {
            const packageName = nodeType.packageName || 'Uncategorized';
            if (!groups.has(packageName)) {
                groups.set(packageName, []);
            }
            groups.get(packageName)!.push(nodeType);
        }

        for (const group of groups.values()) {
            group.sort((a, b) => {
                const nameA = this._getDisplayName(a).toLowerCase();
                const nameB = this._getDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });
        }

        const sortedGroups = new Map(
            Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
        );

        return sortedGroups;
    }

    /**
     * Group a list of palette entries by category.
     * @param {NodePaletteNodeType[]} nodeTypes - Entries to group.
     * @returns {Map<string, NodePaletteNodeType[]>} Groups in display order.
     * @private
     */
    private _groupByCategory(
        nodeTypes: NodePaletteNodeType[]
    ): Map<string, NodePaletteNodeType[]> {
        const groups = new Map<string, NodePaletteNodeType[]>();

        for (const nodeType of nodeTypes) {
            const category = nodeType.category || 'Uncategorized';

            if (!groups.has(category)) {
                groups.set(category, []);
            }
            groups.get(category)!.push(nodeType);
        }

        for (const group of groups.values()) {
            group.sort((a, b) => {
                const nameA = this._getDisplayName(a).toLowerCase();
                const nameB = this._getDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });
        }

        const sortedGroups = new Map(
            Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
        );

        return sortedGroups;
    }

    private _renderNodeTypes(): void {
        this._renderOrganizationalSection();
        this._renderFavoritesSection();
        this._renderRecentSection();

        if (!this._gridContainer) {
            return;
        }

        this._gridContainer.replaceChildren();

        // Graph items live in the pinned Organizational section, never in the node lists.
        const nodeTypes = this._searchState.filteredTypes.filter(
            (nodeType) => !this._isGraphItem(nodeType)
        );

        if (this._organizationMode === 'alphabetical') {
            this._gridContainer.className = 'node-palette-view__grid';
            this._gridContainer.dataset.viewSize = this._viewSize;

            this._sortAlphabetically(nodeTypes);
            for (const nodeType of nodeTypes) {
                const nodeTypeUi = this._getOrCreateNodeTypeUi(nodeType);
                this._gridContainer.appendChild(nodeTypeUi.domElement);
            }
        } else if (this._organizationMode === 'package') {
            const groups = this._groupByPackage(nodeTypes);
            this._renderGroupedSections(groups);
        } else if (this._organizationMode === 'category') {
            const groups = this._groupByCategory(nodeTypes);
            this._renderGroupedSections(groups);
        }

        this._log('render-node-types', {
            filteredCount: this._searchState.filteredTypes.length,
            organizationalCount: this._searchState.filteredTypes.length - nodeTypes.length,
            totalCount: this._nodeTypes.length,
            organizationMode: this._organizationMode,
            viewSize: this._viewSize,
        });
    }

    /**
     * Fill the pinned Organizational section with the graph items that match the search.
     *
     * The section hides itself when the search excludes every entry, so the palette does not show
     * an empty heading.
     * @private
     */
    private _renderOrganizationalSection(): void {
        if (!this._organizationalContainer) {
            return;
        }

        this._organizationalContainer.replaceChildren();

        const graphItems = this._searchState.filteredTypes.filter((nodeType) =>
            this._isGraphItem(nodeType)
        );

        const section = this._organizationalContainer.parentElement as HTMLElement | null;
        if (section) {
            section.style.display = graphItems.length > 0 ? 'block' : 'none';
        }

        for (const nodeType of graphItems) {
            const nodeTypeUi = this._getOrCreateNodeTypeUi(nodeType);
            this._organizationalContainer.appendChild(nodeTypeUi.domElement);
        }
    }

    private _renderFavoritesSection(): void {
        if (!this._favoritesContainer) {
            return;
        }

        this._favoritesContainer.replaceChildren();

        const favoriteTypes = this._nodeTypes.filter(
            (nodeType) => !this._isGraphItem(nodeType) && this._favorites.has(nodeType.id)
        );

        const section = this._favoritesContainer.parentElement as HTMLElement;
        if (favoriteTypes.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        for (const nodeType of favoriteTypes) {
            const nodeTypeUi = this._getOrCreateNodeTypeUi(nodeType);
            this._favoritesContainer.appendChild(nodeTypeUi.domElement);
        }
    }

    private _renderRecentSection(): void {
        if (!this._recentContainer) {
            return;
        }

        this._recentContainer.replaceChildren();

        const recentTypes = this._recentlyUsed
            .map((id) => this._nodeTypes.find((nt) => nt.id === id))
            .filter((nt): nt is NodePaletteNodeType => nt !== undefined)
            .filter((nt) => !this._isGraphItem(nt));

        const section = this._recentContainer.parentElement as HTMLElement;
        if (recentTypes.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        for (const nodeType of recentTypes) {
            const nodeTypeUi = this._getOrCreateNodeTypeUi(nodeType);
            this._recentContainer.appendChild(nodeTypeUi.domElement);
        }
    }

    private _getOrCreateNodeTypeUi(nodeType: NodePaletteNodeType): NodeTypeUiLike {
        const cacheKey = `${nodeType.id}-${this._viewSize}`;

        if (!this._nodeTypeUis.has(cacheKey)) {
            const nodeTypeUi = new NodeTypeUi(nodeType, this._viewSize, {
                iconProvider: this._iconProvider,
                t: (key: string) => this.t(key),
                logger: this._logger,
            });
            nodeTypeUi.render();

            nodeTypeUi.domElement.addEventListener('click', (event: MouseEvent) => {
                if (this._isGraphItem(nodeType)) {
                    // Graph items only exist as drag sources: clicking must never create a node or
                    // open the node-info window.
                    this._log('palette-graph-item-clicked', { graphItemId: nodeType.id });
                    return;
                }

                const currentTarget = event.currentTarget;
                const anchor =
                    currentTarget instanceof HTMLElement
                        ? (() => {
                              const rect = currentTarget.getBoundingClientRect();
                              return { x: rect.left, y: rect.top };
                          })()
                        : undefined;

                this._showNodeInfo(nodeType, anchor);
            });

            this._nodeTypeUis.set(cacheKey, nodeTypeUi);
        }

        return this._nodeTypeUis.get(cacheKey)!;
    }

    private _destroyAllNodeTypeUis(): void {
        for (const nodeTypeUi of this._nodeTypeUis.values()) {
            nodeTypeUi.destroy();
        }
        this._nodeTypeUis.clear();
    }

    private _closeActiveInfoOverlay(): void {
        if (!this._activeInfoOverlay) {
            return;
        }

        this._activeInfoOverlay.close();
        this._activeInfoOverlay = null;
    }

    /**
     * Show the node info window for a palette node type.
     *
     * Reuses the shared NodeInfoView + ViewManager.addOverlay path so palette
     * info matches the graph panel's "Show Info" window.
     *
     * @param {NodePaletteNodeType} nodeType - Node type definition to display.
     * @param {{x: number, y: number}} [anchor] - Optional screen anchor.
     * @private
     */
    private _showNodeInfo(
        nodeType: NodePaletteNodeType,
        anchor?: { x: number; y: number }
    ): void {
        if (!this._viewManager) {
            this._log('show-info-failed', {
                nodeTypeId: nodeType.id,
                reason: 'no view manager available',
            });
            return;
        }

        this._closeActiveInfoOverlay();

        const locale =
            (this._i18nService as NodePaletteI18nServiceLike | null)?.currentLocale || 'en';
        const infoContent = buildNodeInfoContent(
            nodeType as unknown as NodeInfoSource,
            locale,
            typeof nodeType.id === 'string' ? nodeType.id : ''
        );

        const infoView = new NodeInfoView({
            ...infoContent,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        const overlayWidth = 460;
        const overlayHeight = 380;
        const anchorX = anchor?.x ?? 120;
        const anchorY = anchor?.y ?? 120;
        const x = Math.max(8, anchorX - overlayWidth - 16);

        const overlay = this._viewManager.addOverlay(infoView, {
            title: infoContent.nodeName || nodeType.id,
            icon: nodeType.icon || null,
            x,
            y: anchorY,
            width: overlayWidth,
            height: overlayHeight,
            minWidth: overlayWidth,
            minHeight: overlayHeight,
            resizable: false,
            minimizable: false,
            closable: true,
            closeOnOutsideClick: true,
        });

        this._activeInfoOverlay = overlay;

        overlay.on('close', () => {
            if (this._activeInfoOverlay === overlay) {
                this._activeInfoOverlay = null;
            }
        });

        this._log('info-overlay-shown', { nodeTypeId: nodeType.id });
    }

    private _filterNodeTypes(searchTerm: string): void {
        if (!searchTerm || searchTerm.trim() === '') {
            this._searchState.filteredTypes = [...this._nodeTypes];
            return;
        }

        const term = searchTerm.toLowerCase().trim();

        this._searchState.filteredTypes = this._nodeTypes.filter((nodeType) => {
            const name = this._getDisplayName(nodeType).toLowerCase();
            if (name.includes(term)) {
                return true;
            }

            const description = this._getDescription(nodeType).toLowerCase();
            if (description.includes(term)) {
                return true;
            }

            const category = (nodeType.category || '').toLowerCase();
            if (category.includes(term)) {
                return true;
            }

            const packageName = (nodeType.packageName || '').toLowerCase();
            if (packageName.includes(term)) {
                return true;
            }

            return false;
        });
    }

    private _onSearchInput(event: Event): void {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        this._searchState.searchTerm = target.value;

        clearTimeout(this._searchState.debounceTimer as ReturnType<typeof setTimeout>);
        this._searchState.debounceTimer = setTimeout(() => {
            this._filterNodeTypes(this._searchState.searchTerm);
            this._renderNodeTypes();
        }, this._searchState.debounceDelay);
    }

    private _onOrganizationModeChange(mode: OrganizationMode): void {
        if (mode === this._organizationMode) {
            return;
        }

        this._organizationMode = mode;

        for (const [buttonMode, button] of this._organizationButtons) {
            if (buttonMode === mode) {
                button.classList.add('is-active');
            } else {
                button.classList.remove('is-active');
            }
        }

        this._renderNodeTypes();
        this._saveConfig();

        this._log('organization-mode-changed', { mode });
    }

    private _onViewSizeToggle(): void {
        this._viewSize = this._viewSize === 'small' ? 'large' : 'small';

        const title =
            this._viewSize === 'small'
                ? this._tWithFallback('nodePalette.viewSize.large', 'Large')
                : this._tWithFallback('nodePalette.viewSize.small', 'Small');

        if (!this._sizeToggleButton || !this._gridContainer) {
            return;
        }

        this._sizeToggleButton.title = title;

        const icon = this._sizeToggleButton.querySelector('img');
        if (icon) {
            icon.src =
                this._viewSize === 'small'
                    ? IconProvider.nodeTypeUiSelectLarge
                    : IconProvider.nodeTypeUiSelectSmall;
            icon.alt = title;
        }

        this._gridContainer.dataset.viewSize = this._viewSize;

        this._destroyAllNodeTypeUis();
        this._renderNodeTypes();
        this._saveConfig();

        this._log('view-size-toggled', { viewSize: this._viewSize });
    }

    onNodeTypeUsed(nodeTypeId: string): void {
        // Graph items are not node types and must not pollute the recently-used node history.
        if (this._isGraphItemId(nodeTypeId)) {
            this._log('palette-graph-item-used', { graphItemId: nodeTypeId });
            return;
        }

        this._recentlyUsed = this._recentlyUsed.filter((id) => id !== nodeTypeId);
        this._recentlyUsed.unshift(nodeTypeId);

        if (this._recentlyUsed.length > this._maxRecent) {
            this._recentlyUsed = this._recentlyUsed.slice(0, this._maxRecent);
        }

        this._saveConfig();
        this._renderRecentSection();

        this._log('node-type-used', { nodeTypeId });
    }

    toggleFavorite(nodeTypeId: string): void {
        if (this._isGraphItemId(nodeTypeId)) {
            this._log('palette-graph-item-favorite-ignored', { graphItemId: nodeTypeId });
            return;
        }

        if (this._favorites.has(nodeTypeId)) {
            this._favorites.delete(nodeTypeId);
        } else {
            this._favorites.add(nodeTypeId);
        }

        this._saveConfig();
        this._renderFavoritesSection();

        this._log('favorite-toggled', {
            nodeTypeId,
            isFavorite: this._favorites.has(nodeTypeId),
        });
    }

    private _updateLabels(): void {
        if (this._organizationButtons.size > 0) {
            this._organizationButtons.get('alphabetical')!.title = this.t(
                'nodePalette.organizeMode.alphabetical',
                'Alphabetical' as unknown as Record<string, unknown>
            );
            this._organizationButtons.get('package')!.title = this.t(
                'nodePalette.organizeMode.package',
                'By Package' as unknown as Record<string, unknown>
            );
            this._organizationButtons.get('category')!.title = this.t(
                'nodePalette.organizeMode.category',
                'By Category' as unknown as Record<string, unknown>
            );
        }

        if (this._sizeToggleButton) {
            this._sizeToggleButton.title =
                this._viewSize === 'small'
                    ? this._tWithFallback('nodePalette.viewSize.large', 'Large')
                    : this._tWithFallback('nodePalette.viewSize.small', 'Small');
        }

        if (this._searchInput) {
            this._searchInput.placeholder = this._tWithFallback(
                'nodePalette.search',
                'Search nodes...'
            );
        }

        const favoritesHeading = this._favoritesContainer?.parentElement?.querySelector(
            '.node-palette-view__section-heading'
        );
        if (favoritesHeading instanceof HTMLElement) {
            favoritesHeading.textContent = this._tWithFallback(
                'nodePalette.favorites',
                'Favorites'
            );
        }

        const recentHeading = this._recentContainer?.parentElement?.querySelector(
            '.node-palette-view__section-heading'
        );
        if (recentHeading instanceof HTMLElement) {
            recentHeading.textContent = this._tWithFallback('nodePalette.recent', 'Recently Used');
        }

        const organizationalHeading = this._organizationalContainer?.parentElement?.querySelector(
            '.node-palette-view__section-heading'
        );
        if (organizationalHeading instanceof HTMLElement) {
            organizationalHeading.textContent = this._tWithFallback(
                'nodePalette.organizational',
                'Organizational'
            );
        }
    }

    private _getDisplayName(nodeType: NodePaletteNodeType): string {
        if (typeof nodeType.title === 'string') {
            return nodeType.title;
        }
        if (isLocalizedRecord(nodeType.title)) {
            const locale =
                (this._i18nService as NodePaletteI18nServiceLike | null)?.currentLocale || 'en';

            return (
                nodeType.title[locale] ||
                nodeType.title.en ||
                Object.values(nodeType.title)[0] ||
                nodeType.id
            );
        }
        return nodeType.id;
    }

    private _getDescription(nodeType: NodePaletteNodeType): string {
        if (!nodeType.info) {
            return '';
        }

        if (typeof nodeType.info === 'string') {
            return nodeType.info;
        }

        if (isLocalizedRecord(nodeType.info)) {
            const locale =
                (this._i18nService as NodePaletteI18nServiceLike | null)?.currentLocale || 'en';
            return (
                nodeType.info[locale] || nodeType.info.en || Object.values(nodeType.info)[0] || ''
            );
        }
        return '';
    }

    /**
     * Rebuild the palette from the current device-runtime package list.
     *
     * Packages may have appeared, disappeared, or changed their node metadata since the last
     * render (an add-on install/uninstall), so the cached node-type UIs are dropped and every entry
     * is recreated from the freshly read node types.
     */
    update(): void {
        this._destroyAllNodeTypeUis();
        this._loadNodeTypes();
        this._filterNodeTypes(this._searchState.searchTerm);
        this._renderNodeTypes();
    }

    serialize(): {
        type: string;
        id: string;
        title: string;
        icon: string | null;
        [key: string]: unknown;
    } {
        return {
            ...super.serialize(),
            type: 'NodePaletteView',
        };
    }

    static deserialize(
        data: NodePaletteDeserializeData = {},
        viewFactory: unknown = null,
        context: NodePaletteDeserializeContext = {}
    ): NodePaletteView {
        void viewFactory;

        const { title = 'Node Palette', icon = 'palette', id = null } = data;
        const {
            i18nService = null,
            logger = null,
            deviceRuntime = null,
            runtimeCollection = null,
            collectionManager = null,
            workspaceConfig = null,
            iconProvider = null,
            viewManager = null,
        } = context;

        return new NodePaletteView({
            title,
            icon,
            id,
            i18nService,
            logger,
            deviceRuntime,
            runtimeCollection,
            collectionManager,
            workspaceConfig,
            iconProvider,
            viewManager,
        });
    }
}
