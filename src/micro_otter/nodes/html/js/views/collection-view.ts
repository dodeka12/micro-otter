import { TabbedView } from './tabbed-view.js';
import { GraphPanelView } from './graph-panel-view.js';
import { ConfirmationDialogView } from './confirmation-dialog-view.js';
import { MenuWindow } from './menu-window.js';
import { IconProvider } from './icon-provider.js';
import type { MenuViewActionEntry } from './menu-view.js';
import { NodeGraph } from '../data/node-graph.js';
import { assertAppEventPayloadType } from '../core/app-event.js';
import {
    buildPastedGraphData,
    collectPastedCalleeTypeIds,
    getGraphClipboard,
    hasGraphClipboard,
    setGraphClipboard,
} from '../core/graph-clipboard.js';
import { resolveFunctionGraphId } from '../data/function-node-definition.js';
import { normalizeExecutionType } from '../data/graph-execution-settings.js';

type Unsubscribe = (() => void) | null;
type TabbedViewBaseCtor = new (options?: unknown) => any;
const TabbedViewBase = TabbedView as unknown as TabbedViewBaseCtor;

type GraphLike = {
    getId: () => string;
    getName: () => string;
    setName: (name: string) => void;
    getExecutionType?: () => unknown;
    getEnabled?: () => boolean;
    setEnabled?: (enabled: boolean) => void;
    /** Serialized snapshot used by the graph clipboard; real graphs always provide it. */
    toData?: () => Record<string, unknown>;
    on: (eventName: string, listener: (event: AppEventLike) => void) => Unsubscribe;
};

interface CollectionGraphItem {
    id: string;
    name: string;
}

interface CollectionSelectionState {
    activeGraphId: string | null;
    activeGraphIndex: number;
}

interface CollectionLike {
    title?: string;
    getId: () => string;
    getTitle: () => string;
    getGraphArray: () => GraphLike[];
    getGraphById: (id: string) => GraphLike | null;
    getActiveGraphIdx: () => number;
    getActiveGraph: () => GraphLike | null;
    setActiveGraphIdx: (index: number) => void;
    addGraph: (graph: GraphLike) => void;
    removeGraph: (graphId: string) => boolean;
    getUniqueGraphName: (baseName?: string) => string;
    getUniqueGraphId: () => string;
    on: (eventName: string, listener: (event: AppEventLike) => void) => Unsubscribe;
}

interface CollectionManagerLike {
    removeGraph?: (
        collectionId: string,
        graphId: string,
        options?: { replacementBaseName?: string | null }
    ) => boolean;
    moveGraph?: (collectionId: string, graphId: string, toIndex: number) => boolean;
}

interface WorkspaceLike {
    config?: {
        collection?: {
            maxGraphs?: number;
        };
    };
    collections?: Map<string, CollectionLike>;
    collectionManager?: CollectionManagerLike | null;
    on?: (eventName: string, listener: (event: AppEventLike) => void) => Unsubscribe;
    getActiveCollection?: () => CollectionLike | null;
}

interface ViewManagerLike {
    showModal?: (view: unknown) => void;
    showError?: (options: { title: string; message: string }) => Promise<unknown>;
    addOverlay?: (view: unknown, options?: Record<string, unknown>) => unknown;
}

interface AppEventLike<TDetail = Record<string, unknown>> {
    name: string;
    detail: TDetail;
}

interface TabChangedDetail {
    activeId: string;
}

interface TabRenamedDetail {
    viewId: string;
    oldName: string;
    newName: string;
    accept?: () => void;
    reject?: (reason?: unknown) => void;
}

interface TabMovedDetail {
    viewId: string;
    fromIndex: number;
    toIndex: number;
}

interface TabContextMenuDetail {
    viewId: string;
    clientX: number;
    clientY: number;
}

interface TabContextMenuEntry {
    type?: string;
    label?: string;
    [key: string]: unknown;
}

interface ControlDetail {
    id: string;
}

interface CollectionTitleChangedDetail {
    title?: string;
}

interface CollectionGraphAddedDetail {
    graph: GraphLike;
}

interface CollectionGraphRemovedDetail {
    graphId: string;
}

interface CollectionGraphMovedDetail {
    graphId: string;
    fromIndex: number;
    toIndex: number;
}

interface ModalDialogDetail {
    reason: string;
    id: string;
}

interface CollectionTabPlaceholder {
    id: string;
    title: string;
    placeholder: true;
    readonly tabVariant: string;
}

type CollectionTabEntry =
    | GraphPanelView
    | CollectionTabPlaceholder
    | {
          id: string;
          title?: string;
          [key: string]: unknown;
      };

interface CollectionViewOptions {
    collection: CollectionLike;
    workspace: WorkspaceLike;
    viewManager?: ViewManagerLike | null;
    i18nService?: unknown;
    logger?: unknown;
    title?: string;
    icon?: string;
    reorderable?: boolean;
    [key: string]: unknown;
}

interface CollectionViewSerialized extends Record<string, unknown> {
    type: 'CollectionView';
    collectionId: string;
    activeGraphId: string | null;
    reorderable: boolean;
}

interface CollectionViewDeserializeData {
    collectionId?: string;
    activeGraphId?: string;
    reorderable?: boolean;
}

interface CollectionViewDeserializeContext {
    workspace?: WorkspaceLike;
    collection?: CollectionLike | null;
    viewManager?: ViewManagerLike;
    i18nService?: unknown;
    logger?: unknown;
}

export class CollectionView extends TabbedViewBase {
    collection: CollectionLike;
    workspace: WorkspaceLike;
    viewManager: ViewManagerLike | null;

    graphPanelViews: Map<string, GraphPanelView>;
    maxGraphs: number;
    _workspace: WorkspaceLike | null;
    _workspaceChangeListener: Unsubscribe;

    addGraphControl: unknown;

    _collectionChangeListener: Unsubscribe;
    _graphChangeListeners: Map<string, Unsubscribe>;
    _addGraphControlHandler: ((event: unknown) => void) | null;
    _syncingGraphOrder: boolean;

    constructor({
        collection,
        workspace,
        viewManager = null,
        i18nService,
        logger,
        title,
        icon = 'collection',
        reorderable = true,
        ...rest
    }: CollectionViewOptions) {
        super({
            title: title || collection?.title || 'Collection',
            icon,
            i18nService,
            logger,
            // Tab default for the CollectionView itself (e.g. inside a tab strip).
            // Graph tabs override it explicitly in _createTabPlaceholder(): graphs are
            // deleted from the main menu, not by a tab "x".
            closable: true,
            // Graph tabs are reorderable; pinned special tabs (if a subclass adds any) opt out
            // per tab with `movable: false`.
            reorderable,
            // Right-click / Shift+F10 on a graph tab opens graph-specific actions.
            tabContextMenu: true,
            tabsOnlyControl: false,
            ...rest,
        });

        this.collection = collection;
        this.workspace = workspace;
        this.viewManager = viewManager;

        this.graphPanelViews = new Map();

        this.maxGraphs = workspace?.config?.collection?.maxGraphs || 64;
        this._workspace = workspace || null;
        this._workspaceChangeListener = null;

        this.addGraphControl = null;

        this._collectionChangeListener = null;
        this._graphChangeListeners = new Map();
        this._addGraphControlHandler = null;
        this._syncingGraphOrder = false;

        this._initialize();
    }

    _initialize(): void {
        this._collectionChangeListener = this.collection.on('*', (event) => {
            this._onCollectionChange(event);
        });

        if (this._workspace?.on) {
            this._workspaceChangeListener = this._workspace.on('*', (event) => {
                if (event.name === 'activeCollectionChanged') {
                    assertAppEventPayloadType(
                        event,
                        'Workspace.ActiveCollectionChanged.v1',
                        'CollectionView workspace listener'
                    );
                    const next = this._workspace?.getActiveCollection?.();
                    if (next && next.getId() !== this.collection.getId()) {
                        this._switchCollection(next);
                    }
                }
            });
        }

        this._loadGraphs();

        this._createAddGraphControl();

        this.on('tab-changed', (event: unknown) => {
            const typedEvent = event as AppEventLike<TabChangedDetail>;
            assertAppEventPayloadType(
                typedEvent,
                'TabbedView.TabChanged.v1',
                [
                    {
                        name: 'activeId',
                        validate: (value) => typeof value === 'string' && value.trim().length > 0,
                        expected: 'non-empty string',
                    },
                ],
                'CollectionView tab-changed listener'
            );
            this._onGraphSelected(typedEvent.detail.activeId);
        });

        this.on('tab-renamed', (event: unknown) => {
            const typedEvent = event as AppEventLike<TabRenamedDetail>;
            assertAppEventPayloadType(
                typedEvent,
                'TabbedView.TabRenamed.v1',
                [
                    { name: 'viewId', validate: (value) => typeof value === 'string', expected: 'string' },
                    { name: 'oldName', validate: (value) => typeof value === 'string', expected: 'string' },
                    { name: 'newName', validate: (value) => typeof value === 'string', expected: 'string' },
                    {
                        name: 'accept',
                        validate: (value) => typeof value === 'function',
                        expected: 'function',
                    },
                    {
                        name: 'reject',
                        validate: (value) => typeof value === 'function',
                        expected: 'function',
                    },
                ],
                'CollectionView tab-renamed listener'
            );
            this._onTabRenamed(typedEvent.detail);
        });

        this.on('tab-moved', (event: unknown) => {
            this._onTabMoved(event);
        });

        this.on('tab-context-menu', (event: unknown) => {
            this._onTabContextMenu(event);
        });
    }

    _loadGraphs(): void {
        const graphs = this.collection.getGraphArray();

        if (!graphs || graphs.length === 0) {
            this._ensureOneGraph();
            return;
        }

        graphs.forEach((graph) => {
            this._createTabPlaceholder(graph);
        });

        const activeGraphIdx = this.collection.getActiveGraphIdx();
        const activeGraph = graphs[activeGraphIdx] || graphs[0];
        if (activeGraph) {
            const activeGraphId = activeGraph.getId();

            const graphPanelView = this._createGraphPanelView(activeGraph);

            const placeholderIndex = this.views.findIndex((v: CollectionTabEntry) => v.id === activeGraphId);
            if (placeholderIndex >= 0) {
                this.views[placeholderIndex] = graphPanelView;
            }

            this.graphPanelViews.set(activeGraphId, graphPanelView);

            if (this.activeId === activeGraphId) {
                this.activeId = null;
            }
            this.selectView(activeGraphId);
        }
    }

    _getGraphItems(): CollectionGraphItem[] {
        return this.collection.getGraphArray().map((graph) => ({
            id: graph.getId(),
            name: graph.getName(),
        }));
    }

    _createTabPlaceholder(graph: GraphLike): void {
        const graphId = graph.getId();

        const placeholder: CollectionTabPlaceholder = {
            id: graphId,
            title: graph.getName(),
            placeholder: true,
            get tabVariant() {
                return normalizeExecutionType(graph.getExecutionType?.());
            },
        };

        const firstImmovable = this.views.findIndex(
            (view: CollectionTabEntry) => !this.isViewMovable(view.id)
        );
        const insertAt = firstImmovable >= 0 ? firstImmovable : this.views.length;

        this.addView(
            placeholder as unknown as CollectionTabEntry,
            insertAt,
            false,
            false,
            true
        );

        const graphListener = graph.on('*', (event) => {
            if (event?.name === 'name') {
                const validated = assertAppEventPayloadType(
                    event,
                    'NodeGraph.NameChanged.v1',
                    [
                        {
                            name: 'name',
                            validate: (value) => typeof value === 'string' && value.trim().length > 0,
                            expected: 'non-empty string',
                        },
                    ],
                    'CollectionView graph rename listener'
                ) as unknown as AppEventLike<{ name: string }>;
                this._onGraphRenamed(graphId, validated.detail.name);
            } else if (event?.name === 'executionType') {
                const isKnownView = this.views.some(
                    (view: CollectionTabEntry) => view.id === graphId
                );
                if (isKnownView) {
                    this._renderTabs();
                    this._log('graph-execution-type-changed', { graphId });
                }
            }
        });
        this._graphChangeListeners.set(graphId, graphListener);
    }

    _createGraphPanelView(graph: GraphLike): GraphPanelView {
        const graphId = graph.getId();

        const graphPanelView = new GraphPanelView({
            id: graphId,
            graph,
            collection: this.collection as unknown,
            workspace: this.workspace as unknown,
            viewManager: this.viewManager as unknown as { addOverlay: (view: unknown, options?: Record<string, unknown>) => unknown },
            i18nService: this._i18nService,
            logger: this._logger,
            title: graph.getName(),
        });

        return graphPanelView;
    }

    _createAddGraphControl(): void {
        if (this._addGraphControlHandler) {
            this.off('control', this._addGraphControlHandler);
            this._addGraphControlHandler = null;
        }

        this.removeControl('add-graph');

        const key = 'collection.addGraph';
        const translated = this.t(key);
        const title = translated === key ? 'Add new graph' : translated;

        this.addGraphControl = this.addControl({
            id: 'add-graph',
            icon: '+',
            title,
            align: 'end',
            showLabel: true,
        });

        this._addGraphControlHandler = (event: unknown) => {
            const typedEvent = event as AppEventLike<ControlDetail>;
            assertAppEventPayloadType(
                typedEvent,
                'TabbedView.Control.v1',
                [
                    {
                        name: 'id',
                        validate: (value) => typeof value === 'string' && value.trim().length > 0,
                        expected: 'non-empty string',
                    },
                ],
                'CollectionView control listener'
            );
            if (typedEvent.detail.id === 'add-graph') {
                this._onAddGraph();
            }
        };
        this.on('control', this._addGraphControlHandler);
    }

    _onAddGraph(): void {
        if (this.collection.getGraphArray().length >= this.maxGraphs) {
            this._log('max-graphs-reached', { maxGraphs: this.maxGraphs });

            if (this.viewManager) {
                this._log('collection-max-graphs-warning', {
                    message: `Maximum number of graphs (${this.maxGraphs}) reached.`,
                });
            }
            return;
        }

        const name = this._generateUniqueName();

        const id = this._generateUniqueId();

        const newGraph = new NodeGraph({ id, name }) as unknown as GraphLike;

        try {
            this.collection.addGraph(newGraph);
        } catch (error) {
            console.error('[CollectionView] Error adding graph:', error);
            throw error;
        }

        this.selectView(newGraph.getId());

        this._log('graph-added', { graphId: newGraph.getId(), name });
    }

    _onTabRenamed(event: TabRenamedDetail): void {
        const { viewId, oldName, newName, accept, reject } = event;

        if (!newName || newName.trim() === '') {
            this._log('tab-rename-rejected-empty', { viewId, newName });
            if (reject) {
                reject('Name cannot be empty');
            }
            return;
        }

        const view = this._findViewById(viewId);
        if (!view) {
            this._log('tab-rename-failed-no-view', { viewId, newName });
            if (reject) {
                reject('View not found');
            }
            return;
        }

        const graph = this.collection.getGraphById(viewId);
        if (!graph) {
            this._log('tab-rename-failed-no-graph', { viewId, newName });
            if (reject) {
                reject('Graph not found');
            }
            return;
        }

        const graphId = graph.getId();

        const normalizedNewName = this._normalizeName(newName);
        const isUnique = !this.collection.getGraphArray().some((graph) => {
            const graphName = this._normalizeName(graph.getName());
            return graph.getId() !== graphId && graphName === normalizedNewName;
        });

        if (!isUnique) {
            this._log('tab-rename-rejected-duplicate', { viewId, newName });
            if (reject) {
                reject(`A graph named "${newName}" already exists`);
            }
            if (this.viewManager?.showError) {
                this.viewManager
                    .showError({
                        title: this.t('collection.error.renameTitle'),
                        message: this.t('collection.error.duplicateName', { name: newName }),
                    })
                    .catch((err) => this._log('error-showing-rename-error', err));
            }
            return;
        }

        graph.setName(newName);
        this._log('tab-renamed-success', { viewId, graphId, oldName, newName });
        if (accept) {
            accept();
        }
    }

    /**
     * Forward a user tab move to the data layer.
     * @param {AppEvent} event - `tab-moved` event from TabbedView.
     * @private
     */
    _onTabMoved(event: unknown): void {
        const typedEvent = event as AppEventLike<TabMovedDetail>;
        const validated = assertAppEventPayloadType(
            typedEvent,
            'TabbedView.TabMoved.v1',
            [
                {
                    name: 'viewId',
                    validate: (value) => typeof value === 'string' && value.trim().length > 0,
                    expected: 'non-empty string',
                },
                {
                    name: 'fromIndex',
                    validate: (value) => Number.isInteger(value),
                    expected: 'integer',
                },
                {
                    name: 'toIndex',
                    validate: (value) => Number.isInteger(value),
                    expected: 'integer',
                },
            ],
            'CollectionView tab-moved listener'
        ) as unknown as AppEventLike<TabMovedDetail>;

        // `graphMoved` re-syncs tabs through moveView(); that move must not be forwarded back.
        if (this._syncingGraphOrder) {
            return;
        }

        const graphId = validated.detail.viewId;
        const graphs = this.collection.getGraphArray();
        const graphIndex = graphs.findIndex((graph) => graph.getId() === graphId);
        if (graphIndex < 0) {
            this._log('graph-reorder-ignored', { graphId, reason: 'not-a-graph-tab' });
            return;
        }

        const toIndex = validated.detail.toIndex;
        if (toIndex < 0 || toIndex >= graphs.length || toIndex === graphIndex) {
            this._log('graph-reorder-ignored', {
                graphId,
                toIndex,
                reason: 'out-of-range-or-noop',
            });
            return;
        }

        // The graph block is contiguous and leading, so a graph final index must land on a graph
        // slot. This guard turns a broken layout assumption into a no-op instead of corrupting
        // graph order.
        const targetViewId = this.views[toIndex]?.id;
        if (!targetViewId || !graphs.some((graph) => graph.getId() === targetViewId)) {
            this._log('graph-reorder-ignored', {
                graphId,
                toIndex,
                reason: 'target-not-in-graph-block',
            });
            return;
        }

        const manager = this.workspace?.collectionManager;
        if (!manager || typeof manager.moveGraph !== 'function') {
            this._log('graph-reorder-ignored', {
                graphId,
                reason: 'collection-manager-unavailable',
            });
            return;
        }

        const moved = manager.moveGraph(this.collection.getId(), graphId, toIndex);
        if (!moved) {
            this._log('graph-reorder-not-applied', { graphId, toIndex });
        }
    }

    _normalizeName(name: string): string {
        return String(name || '').trim().toLowerCase();
    }

    _generateUniqueName(): string {
        return this.collection.getUniqueGraphName(this._replacementGraphBaseName());
    }

    _generateUniqueId(): string {
        return this.collection.getUniqueGraphId();
    }

    _isNameTaken(name: string): boolean {
        return this._getGraphItems().some((graph) => graph.name === name);
    }

    _isIdTaken(id: string): boolean {
        return this._getGraphItems().some((graph) => graph.id === id);
    }

    _getSelectionState(graphId: string): CollectionSelectionState | null {
        const graphs = this.collection.getGraphArray();
        const index = graphs.findIndex((g) => g.getId() === graphId);
        if (index < 0) {
            return null;
        }
        return {
            activeGraphId: graphId,
            activeGraphIndex: index,
        };
    }

    _onGraphSelected(graphId: string): void {
        const selection = this._getSelectionState(graphId);
        if (selection) {
            this.collection.setActiveGraphIdx(selection.activeGraphIndex);
            this._log('graph-selected', { graphId: selection.activeGraphId, index: selection.activeGraphIndex });
        }
    }

    _onGraphRenamed(graphId: string, newName: string): boolean {
        const nextName = String(newName || '').trim();
        if (!nextName) {
            this._log('rename-error-empty', { graphId });
            return false;
        }

        let needsRender = false;

        const activeView = this.graphPanelViews.get(graphId);
        if (activeView && activeView.title !== nextName) {
            activeView.title = nextName;
            needsRender = true;
        }

        const tabView = this._findViewById(graphId) as CollectionTabEntry | null;
        if (tabView && tabView.title !== nextName) {
            tabView.title = nextName;
            needsRender = true;
        }

        if (needsRender) {
            this._renderTabs();
        }

        this._log('graph-renamed', { graphId, name: nextName });
        return true;
    }

    async _onGraphCloseRequested(graphId: string): Promise<void> {
        const graph = this.collection.getGraphById(graphId);
        if (!graph) {
            return;
        }

        if (this.viewManager && typeof this.viewManager.showModal === 'function') {
            const dialog = new ConfirmationDialogView({
                title: this.t('collection.closeGraphTitle') || 'Remove Graph',
                message:
                    this.t('collection.closeGraphMessage', { name: graph.getName() }) ||
                    `Are you sure you want to remove "${graph.getName()}"?`,
                detail:
                    this.t('collection.closeGraphDetail') ||
                    'This action will remove the graph from this collection.',
                confirmLabel: this.t('collection.closeGraphConfirm') || 'Remove',
                cancelLabel: this.t('dialog.cancel') || 'Cancel',
                destructive: true,
                i18nService: this._i18nService,
                logger: this._logger,
            });

            this.viewManager.showModal(dialog);

            const result = await new Promise<boolean>((resolve) => {
                dialog.on('confirm', (event: unknown) => {
                    const typedEvent = event as AppEventLike<ModalDialogDetail>;
                    assertAppEventPayloadType(
                        typedEvent,
                        'ModalDialogView.Confirm.v1',
                        [
                            { name: 'reason', validate: (value) => typeof value === 'string' },
                            { name: 'id', validate: (value) => typeof value === 'string' },
                        ],
                        'CollectionView.graphCloseConfirmListener'
                    );
                    resolve(true);
                });
                dialog.on('cancel', (event: unknown) => {
                    const typedEvent = event as AppEventLike<ModalDialogDetail>;
                    assertAppEventPayloadType(
                        typedEvent,
                        'ModalDialogView.Cancel.v1',
                        [
                            { name: 'reason', validate: (value) => typeof value === 'string' },
                            { name: 'id', validate: (value) => typeof value === 'string' },
                        ],
                        'CollectionView.graphCloseCancelListener'
                    );
                    resolve(false);
                });
                dialog.on('close', (event: unknown) => {
                    const typedEvent = event as AppEventLike<ModalDialogDetail>;
                    assertAppEventPayloadType(
                        typedEvent,
                        'ModalDialogView.Close.v1',
                        [
                            { name: 'reason', validate: (value) => typeof value === 'string' },
                            { name: 'id', validate: (value) => typeof value === 'string' },
                        ],
                        'CollectionView.graphCloseCloseListener'
                    );
                    resolve(false);
                });
            });

            if (result) {
                this._removeGraph(graphId);
            }
        } else {
            this._removeGraph(graphId);
        }
    }

    /**
     * Remove a graph through the data layer.
     * @param {string} graphId - Graph to remove.
     * @returns {boolean} True when the graph was removed.
     * @private
     */
    _removeGraph(graphId: string): boolean {
        const manager = this.workspace?.collectionManager ?? null;
        if (!manager || typeof manager.removeGraph !== 'function') {
            this._log('graph-remove-unavailable', 'error', { graphId });
            return false;
        }

        const removed = manager.removeGraph(this.collection.getId(), graphId, {
            replacementBaseName: this._replacementGraphBaseName(),
        });
        this._log(removed ? 'graph-removed' : 'graph-remove-failed', removed ? 'info' : 'warn', {
            graphId,
        });
        return removed;
    }

    /**
     * Localised base name for an automatically created replacement graph.
     * @returns {string} Base name for `Collection.getUniqueGraphName()`.
     * @private
     */
    _replacementGraphBaseName(): string {
        const key = 'collection.defaultGraphName';
        const translated = this.t(key);
        return translated === key ? 'Graph' : translated;
    }

    /**
     * Check whether the active graph may be deleted from the UI.
     * @returns {boolean} True when the active collection holds two or more graphs.
     */
    canDeleteActiveGraph(): boolean {
        return Boolean(this.activeId) && this.collection.getGraphArray().length > 1;
    }

    /**
     * Request deletion of a graph through the regular confirmation flow.
     * @param {string} [graphId] - Graph to delete; defaults to the active graph.
     * @returns {Promise<void>} Resolves once the dialog has been handled.
     */
    async requestGraphDeletion(graphId?: string): Promise<void> {
        const target = graphId ?? this.activeId;
        if (!target || this.collection.getGraphArray().length <= 1) {
            return;
        }

        await this._onGraphCloseRequested(target);
    }

    /**
     * Open the graph-specific menu for a tab context-menu request.
     * @param {unknown} event - `tab-context-menu` event emitted by TabbedView.
     * @private
     */
    _onTabContextMenu(event: unknown): void {
        const typedEvent = assertAppEventPayloadType(
            event,
            'TabbedView.TabContextMenu.v1',
            [
                {
                    name: 'viewId',
                    validate: (value) => typeof value === 'string' && value.length > 0,
                    expected: 'non-empty string',
                },
                {
                    name: 'clientX',
                    validate: (value) => typeof value === 'number' && Number.isFinite(value),
                    expected: 'finite number',
                },
                {
                    name: 'clientY',
                    validate: (value) => typeof value === 'number' && Number.isFinite(value),
                    expected: 'finite number',
                },
            ],
            'CollectionView tab-context-menu listener'
        ) as unknown as AppEventLike<TabContextMenuDetail>;

        const { viewId, clientX, clientY } = typedEvent.detail;
        const graph = this.collection.getGraphById(viewId);
        if (!graph) {
            this._log('graph-tab-context-menu-missing-graph', 'warn', { viewId });
            return;
        }

        this._openGraphTabContextMenu(graph, clientX, clientY);
    }

    /**
     * Build and show the graph tab context menu.
     * @param {object} graph - Graph represented by the tab.
     * @param {number} clientX - Viewport X anchor.
     * @param {number} clientY - Viewport Y anchor.
     * @private
     */
    _openGraphTabContextMenu(graph: GraphLike, clientX: number, clientY: number): void {
        const graphId = graph.getId();
        const menuWindow = new MenuWindow({
            title: graph.getName(),
            items: this._buildGraphTabContextMenuItems(graph),
            onSelect: (item: MenuViewActionEntry) =>
                this._onGraphTabContextMenuSelect(item, graphId),
            x: clientX,
            y: clientY,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        if (this.viewManager && typeof this.viewManager.addOverlay === 'function') {
            this.viewManager.addOverlay(menuWindow);
        } else {
            menuWindow.attachTo(document.body);
        }

        this._log('graph-tab-context-menu-opened', { graphId, clientX, clientY });
    }

    /**
     * Menu entries for a graph tab.
     * @param {object} graph - Graph represented by the tab.
     * @returns {Array<object>} Entries accepted by MenuWindow.
     * @private
     */
    _buildGraphTabContextMenuItems(graph: GraphLike): TabContextMenuEntry[] {
        const canToggleEnabled = typeof graph.setEnabled === 'function';
        const enabled = canToggleEnabled ? graph.getEnabled?.() !== false : true;

        return [
            {
                id: 'rename-graph',
                label: 'collection.tabContextMenu.rename',
                icon: IconProvider.edit,
            },
            {
                id: 'toggle-graph-enabled',
                label: 'collection.tabContextMenu.enabled',
                checked: enabled,
                disabled: !canToggleEnabled,
            },
            {
                id: 'copy-graph',
                label: 'collection.tabContextMenu.copy',
                icon: IconProvider.contentCopy,
            },
            {
                id: 'paste-graph',
                label: 'collection.tabContextMenu.paste',
                icon: IconProvider.contentPaste,
                disabled: !hasGraphClipboard(),
            },
            { type: 'separator' },
            {
                id: 'delete-graph',
                label: 'menu.item.deleteGraph',
                icon: IconProvider.delete,
                disabled: this.collection.getGraphArray().length <= 1,
            },
        ];
    }

    /**
     * Apply a graph tab context-menu selection.
     * @param {object} item - Selected menu entry.
     * @param {string} graphId - Graph that owned the menu.
     * @private
     */
    _onGraphTabContextMenuSelect(item: MenuViewActionEntry, graphId: string): void {
        if (!item?.id) {
            return;
        }

        if (item.id === 'rename-graph') {
            this.beginTabRename(graphId);
            return;
        }

        if (item.id === 'toggle-graph-enabled') {
            const graph = this.collection.getGraphById(graphId);
            if (!graph || typeof graph.setEnabled !== 'function') {
                return;
            }

            const nextEnabled = graph.getEnabled?.() === false;
            graph.setEnabled(nextEnabled);
            this._log('graph-enabled-changed', { graphId, enabled: nextEnabled });
            return;
        }

        if (item.id === 'copy-graph') {
            this._copyGraphToClipboard(graphId);
            return;
        }

        if (item.id === 'paste-graph') {
            this._pasteGraphFromClipboard();
            return;
        }

        if (item.id === 'delete-graph') {
            void this.requestGraphDeletion(graphId);
        }
    }

    /**
     * Copy a graph into the app-wide graph clipboard.
     *
     * The stored payload is a serialized snapshot (`NodeGraph.toData()`), never the live
     * graph, so later edits of the source cannot leak into a paste.
     *
     * @param graphId - Graph that owned the menu.
     * @private
     */
    _copyGraphToClipboard(graphId: string): void {
        const graph = this.collection.getGraphById(graphId);
        if (!graph || typeof graph.toData !== 'function') {
            this._log('graph-copy-unsupported', 'warn', { graphId });
            return;
        }

        setGraphClipboard({
            data: graph.toData(),
            sourceCollectionId: this.collection.getId(),
        });
        this._log('graph-copied', { graphId, name: graph.getName() });
    }

    /**
     * Paste the copied graph into the active collection as a new graph.
     *
     * The target is always this view's collection: the context menu is opened on a tab of
     * the active collection, so "paste into another collection" means the user switched
     * collections first. `addGraph()` marks the collection dirty through the normal model
     * path, which is what the autosave listens to; no extra persistence call is needed.
     *
     * @private
     */
    _pasteGraphFromClipboard(): void {
        const payload = getGraphClipboard();
        if (!payload) {
            this._log('graph-paste-empty', 'warn');
            return;
        }

        const baseName =
            typeof payload.data.name === 'string' && payload.data.name.trim()
                ? payload.data.name
                : 'Graph';
        const graphId = this.collection.getUniqueGraphId();
        const name = this.collection.getUniqueGraphName(baseName);
        const data = buildPastedGraphData(payload, { graphId, name });

        // Callees that only exist in the source collection stay as node data (the canvas can
        // render them from their snapshot), but the user has to re-create the function.
        const missingCalleeTypeIds = collectPastedCalleeTypeIds(data).filter(
            (typeId) => !this._hasFunctionGraphForTypeId(typeId)
        );
        if (missingCalleeTypeIds.length > 0) {
            this._log('graph-paste-missing-callees', 'warn', {
                graphId,
                missingCalleeTypeIds,
                sourceCollectionId: payload.sourceCollectionId,
            });
        }

        const graph = NodeGraph.fromData(data as unknown as Parameters<typeof NodeGraph.fromData>[0]);
        this.collection.addGraph(graph as unknown as GraphLike);
        this.selectView(graph.getId());

        this._log('graph-pasted', {
            graphId: graph.getId(),
            name,
            sourceCollectionId: payload.sourceCollectionId,
        });
    }

    /**
     * Whether the collection contains the function graph behind a generated type id.
     * @param typeId - Node type id (`function_graph.<graphId>`).
     * @returns True when a function graph with that id exists.
     * @private
     */
    _hasFunctionGraphForTypeId(typeId: string): boolean {
        const graphId = resolveFunctionGraphId(typeId);
        if (!graphId) {
            return false;
        }
        const graph = this.collection.getGraphById(graphId);
        return Boolean(graph);
    }

    _removeGraphTracking(graphId: string): void {
        const listener = this._graphChangeListeners.get(graphId);
        if (listener && typeof listener === 'function') {
            listener();
            this._graphChangeListeners.delete(graphId);
        }

        this.graphPanelViews.delete(graphId);
    }

    _ensureOneGraph(): void {
        if (this.collection.getGraphArray().length > 0) {
            return;
        }

        const name = this._generateUniqueName();
        const newGraph = new NodeGraph({ name }) as unknown as GraphLike;
        this.collection.addGraph(newGraph);

        this.selectView(newGraph.getId());

        this._log('graph-auto-created', { graphId: newGraph.getId(), name });
    }

    _onCollectionChange(event: AppEventLike): void {
        if (event.name === 'title') {
            const validated = assertAppEventPayloadType(
                event,
                'Collection.TitleChanged.v1',
                'CollectionView collection listener'
            ) as AppEventLike<CollectionTitleChangedDetail>;
            const newTitle = validated.detail?.title || this.collection.getTitle();
            if (this.title !== newTitle) {
                this.title = newTitle;
            }
        } else if (event.name === 'graphAdded') {
            const validated = assertAppEventPayloadType(
                event,
                'Collection.GraphAdded.v1',
                'CollectionView collection listener'
            ) as unknown as AppEventLike<CollectionGraphAddedDetail>;
            const graphId = validated.detail?.graph?.getId();

            const alreadyExists = this.views.some((v: CollectionTabEntry) => v.id === graphId);

            if (graphId && !alreadyExists) {
                this._createTabPlaceholder(validated.detail.graph);
            }
        } else if (event.name === 'graphMoved') {
            const validated = assertAppEventPayloadType(
                event,
                'Collection.GraphMoved.v1',
                [
                    {
                        name: 'graphId',
                        validate: (value) => typeof value === 'string' && value.trim().length > 0,
                        expected: 'non-empty string',
                    },
                    {
                        name: 'fromIndex',
                        validate: (value) => Number.isInteger(value),
                        expected: 'integer',
                    },
                    {
                        name: 'toIndex',
                        validate: (value) => Number.isInteger(value),
                        expected: 'integer',
                    },
                ],
                'CollectionView collection listener'
            ) as unknown as AppEventLike<CollectionGraphMovedDetail>;

            const { graphId, toIndex } = validated.detail;
            if (this._syncingGraphOrder) {
                this._log('graph-reorder-sync-in-progress', { graphId, toIndex });
                return;
            }
            const currentIndex = this.views.findIndex(
                (view: CollectionTabEntry) => view.id === graphId
            );

            if (currentIndex < 0) {
                this._log('graph-reorder-tab-missing', { graphId, toIndex });
            } else if (currentIndex !== toIndex) {
                this._syncingGraphOrder = true;
                try {
                    this.moveView(graphId, toIndex);
                } finally {
                    this._syncingGraphOrder = false;
                }
            }
        } else if (event.name === 'graphRemoved') {
            const validated = assertAppEventPayloadType(
                event,
                'Collection.GraphRemoved.v1',
                'CollectionView collection listener'
            ) as unknown as AppEventLike<CollectionGraphRemovedDetail>;
            const graphId = validated.detail?.graphId;

            if (graphId) {
                const viewIndex = this.views.findIndex((v: CollectionTabEntry) => v.id === graphId);
                const viewOrPlaceholder = viewIndex >= 0 ? this.views[viewIndex] : null;

                if (viewOrPlaceholder) {
                    TabbedView.prototype.removeView.call(this, viewOrPlaceholder);
                }

                // The data layer clamped #activeGraphIdx and TabbedView picked a fallback tab
                // without emitting `tab-changed`. Prefer a graph tab; a pinned special tab is
                // never a valid representation of the collection's active graph.
                const activeIsGraph = Boolean(
                    this.activeId &&
                        this.collection
                            .getGraphArray()
                            .some((graph) => graph.getId() === this.activeId)
                );

                if (activeIsGraph && this.activeId) {
                    this._onGraphSelected(this.activeId);
                } else {
                    const activeGraph = this.collection.getActiveGraph();
                    if (activeGraph) {
                        this.selectView(activeGraph.getId());
                    }
                }
            }
        }

        this._log('collection-changed', { type: event.name });
    }

    getActiveGraphView(): GraphPanelView | null {
        const activeView = this.getActiveView();
        return activeView instanceof GraphPanelView ? activeView : null;
    }

    _isPlaceholder(view: unknown): boolean {
        return Boolean(view && typeof view === 'object' && (view as { placeholder?: boolean }).placeholder === true);
    }

    _onViewRequested(id: string, existingPlaceholder: unknown): GraphPanelView | null {
        if (this.graphPanelViews.has(id)) {
            return this.graphPanelViews.get(id) || null;
        }

        const graph = this.collection.getGraphById(id);
        if (!graph) {
            this._log('view-requested-no-graph', { id });
            return null;
        }

        const view = this._createGraphPanelView(graph);

        const index = this.views.findIndex((v: CollectionTabEntry) => v.id === id || v === existingPlaceholder);
        if (index >= 0) {
            this.views[index] = view;
        }

        return view;
    }

    _shouldAttachView(view: unknown): boolean {
        return !this._isPlaceholder(view);
    }

    _onViewCreated(view: GraphPanelView, id: string): void {
        this.graphPanelViews.set(id, view);

        this._log('graph-panel-view-created', { graphId: id });

        this._onGraphSelected(id);
    }

    _onViewRemoved(_view: unknown, id: string): void {
        this.graphPanelViews.delete(id);

        const listener = this._graphChangeListeners.get(id);
        if (listener) {
            listener();
            this._graphChangeListeners.delete(id);
        }
    }

    async removeView(target: CollectionTabEntry | string | number): Promise<CollectionTabEntry | null> {
        const index = this._resolveIndex(target);
        if (index < 0 || index >= this.views.length) {
            return null;
        }

        const view = this.views[index] as CollectionTabEntry;
        const graphId = view.id;

        await this._onGraphCloseRequested(graphId);

        return null;
    }

    beforeDetach(): void {
        if (this._addGraphControlHandler) {
            this.off('control', this._addGraphControlHandler);
            this._addGraphControlHandler = null;
        }
        if (this._workspaceChangeListener && typeof this._workspaceChangeListener === 'function') {
            this._workspaceChangeListener();
            this._workspaceChangeListener = null;
        }

        if (this._collectionChangeListener && typeof this._collectionChangeListener === 'function') {
            this._collectionChangeListener();
            this._collectionChangeListener = null;
        }

        this._graphChangeListeners.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this._graphChangeListeners.clear();

        this.graphPanelViews.clear();

        super.beforeDetach();
    }

    _switchCollection(nextCollection: CollectionLike): void {
        if (!nextCollection || nextCollection === this.collection) {
            return;
        }

        if (this._collectionChangeListener && typeof this._collectionChangeListener === 'function') {
            this._collectionChangeListener();
            this._collectionChangeListener = null;
        }

        this._graphChangeListeners.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this._graphChangeListeners.clear();

        this.graphPanelViews.clear();
        this.setViews([]);
        this.setControls([]);

        this.collection = nextCollection;

        this._collectionChangeListener = this.collection.on('*', (event) => {
            this._onCollectionChange(event);
        });

        this._loadGraphs();
        this._createAddGraphControl();
    }

    serialize(): CollectionViewSerialized {
        const parentData = super.serialize();
        return {
            ...parentData,
            type: 'CollectionView',
            collectionId: this.collection.getId(),
            activeGraphId: this.getActiveView()?.id || null,
            reorderable: this.reorderable,
        };
    }

    static deserialize(
        data: CollectionViewDeserializeData,
        _createChild: (entry: unknown) => unknown,
        context: CollectionViewDeserializeContext
    ): CollectionView {
        const workspace = context?.workspace;
        let collection = context?.collection || null;

        if (!collection && workspace?.getActiveCollection) {
            collection = workspace.getActiveCollection();
        }

        if (!collection && workspace?.collections?.has?.(data.collectionId || '')) {
            collection = workspace.collections.get(data.collectionId || '') || null;
        }

        if (!collection && workspace?.collections?.size) {
            collection = workspace.collections.values().next().value || null;
        }

        if (!collection) {
            throw new Error(`Cannot deserialize CollectionView: collection not found (id: ${data.collectionId})`);
        }

        const view = new CollectionView({
            collection,
            workspace: context?.workspace as WorkspaceLike,
            viewManager: context?.viewManager,
            i18nService: context?.i18nService,
            logger: context?.logger,
            // Legacy layouts without the field still opt into graph reordering.
            reorderable: data.reorderable !== false,
        });

        const activeGraph = collection.getActiveGraph();
        if (activeGraph) {
            view.selectView(activeGraph.getId());
        } else if (data.activeGraphId) {
            const hasGraph = collection
                .getGraphArray()
                .some((graph) => graph.getId() === data.activeGraphId);
            if (hasGraph) {
                view.selectView(data.activeGraphId);
            }
        }

        return view;
    }
}
