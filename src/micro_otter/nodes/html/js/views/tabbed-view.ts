import { ViewBase } from './view-base.js';
import { SPLIT_VIEW_ACTIONS } from './split-view.js';
import { IconProvider } from './icon-provider.js';
import { AppPayload } from '../core/app-event.js';

type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];
type TabPosition = 'top' | 'bottom' | 'left' | 'right';
type TabControlAlign = 'start' | 'end';

interface ViewLikeMetadata {
    id: string;
    title: string;
    icon: string | null;
}

interface TabbedViewEntry {
    id: string;
    title?: string;
    icon?: string | null;
    movable?: boolean;
    /**
     * Opaque presentation token written to the tab's `data-tab-variant` attribute.
     *
     * TabbedView does not interpret the value; it only trims it and omits empty values.
     * Consumers use the attribute to apply variant-specific styling.
     */
    tabVariant?: string | null;
    container?: HTMLElement | null;
    attachTo?: (container: HTMLElement) => void;
    detach?: () => void;
    serialize?: () => Record<string, unknown>;
    getMetadata?: () => ViewLikeMetadata;
    onResize?: (payload: unknown) => void;
    onResized?: (size: { width: number; height: number }) => void;
    onFocus?: () => void;
    applyVisibilityState?: (visible: boolean) => void;
    minWidth?: number | null;
    minHeight?: number | null;
    maxWidth?: number | null;
    maxHeight?: number | null;
}

interface TabbedViewControlInput {
    id?: string;
    icon?: string | null;
    title?: string;
    align?: TabControlAlign;
    toggles?: boolean;
    showLabel?: boolean;
}

interface TabbedViewControl {
    id: string;
    icon: string | null;
    title: string;
    align: TabControlAlign;
    toggles: boolean;
    showLabel: boolean;
}

interface TabbedViewOptions {
    views?: TabbedViewEntry[];
    controls?: TabbedViewControlInput[];
    activeId?: string | null;
    closable?: boolean;
    reorderable?: boolean;
    tabContextMenu?: boolean;
    title?: string;
    icon?: string | null;
    id?: string | null;
    tabPosition?: TabPosition;
    tabLabelRotation?: number | null;
    tabsOnlyControl?: boolean;
    tabsOnlyControlTitle?: string;
    tabsOnlyControlId?: string;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
}

interface TabbedViewSerialized {
    type: 'TabbedView';
    id: string;
    title: string;
    icon: string | null;
    activeId: string | null;
    closable: boolean;
    reorderable: boolean;
    tabPosition: TabPosition;
    tabLabelRotation: number;
    controls: Array<{
        id: string;
        icon: string | null;
        title: string;
        align: TabControlAlign;
        toggles: boolean;
    }>;
    tabsOnlyControl: {
        enabled: boolean;
        title: string;
        id: string;
    };
    tabClosers: Array<{ id: string; closable: boolean }>;
    tabMovability: Array<{ id: string; movable: boolean }>;
    views: Array<Record<string, unknown> | ViewLikeMetadata>;
    [key: string]: unknown;
}

interface TabbedViewDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
    activeId?: string | null;
    closable?: boolean;
    reorderable?: boolean;
    views?: unknown[];
    tabClosers?: Array<{ id: string; closable: boolean }>;
    tabMovability?: Array<{ id: string; movable: boolean }>;
    tabPosition?: TabPosition;
    tabLabelRotation?: number | null;
    controls?: TabbedViewControlInput[];
    tabsOnlyControl?:
        | {
              enabled?: boolean;
              title?: string;
              id?: string;
          }
        | boolean;
}

interface TabbedViewDeserializeContext {
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
}

interface TabbedViewSize {
    width: number;
    height: number;
}

interface TabbedViewSizeConstraints {
    minWidth: number | null;
    minHeight: number | null;
    maxWidth: number | null;
    maxHeight: number | null;
}

type ViewFactory = (data: unknown) => TabbedViewEntry;

const TAB_DRAG_THRESHOLD_PX = 4;

interface TabbedViewDragState {
    viewId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    dropGap: number | null;
    dropIndex: number | null;
}

/**
 * Payload for `tab-changed` events emitted by TabbedView.
 */
class TabbedViewTabChangedPayload extends AppPayload {
    previousId: string | null;
    activeId: string | null;
    previousIndex: number;
    activeIndex: number;
    view: TabbedViewEntry | null;
    /**
    * @param {object} params - Aggregated payload members for tab activation changes.
    * @param {string|null} params.previousId - ID of the previously active tab.
    * @param {string|null} params.activeId - ID of the newly active tab.
    * @param {number} params.previousIndex - Index of the previously active tab.
    * @param {number} params.activeIndex - Index of the newly active tab.
    * @param {ViewBase|object|null} params.view - Active view instance (or placeholder metadata).
     */
    constructor({
        previousId,
        activeId,
        previousIndex,
        activeIndex,
        view,
    }: {
        previousId: string | null;
        activeId: string | null;
        previousIndex: number;
        activeIndex: number;
        view: TabbedViewEntry | null;
    }) {
        super('TabbedView.TabChanged.v1');
        this.previousId = previousId;
        this.activeId = activeId;
        this.previousIndex = previousIndex;
        this.activeIndex = activeIndex;
        this.view = view;
    }
}

/**
 * Payload for `tab-renamed` events emitted by TabbedView.
 */
class TabbedViewTabRenamedPayload extends AppPayload {
    viewId: string;
    oldName: string;
    newName: string;
    accept: () => void;
    reject: (reason?: unknown) => void;
    /**
    * @param {object} params - Aggregated payload members for tab rename flow.
    * @param {string} params.viewId - ID of the tab/view being renamed.
    * @param {string} params.oldName - Current tab name before rename.
    * @param {string} params.newName - Proposed tab name from the user.
    * @param {Function} params.accept - Callback used by listeners to accept the rename.
    * @param {Function} params.reject - Callback used by listeners to reject the rename.
     */
    constructor({
        viewId,
        oldName,
        newName,
        accept,
        reject,
    }: {
        viewId: string;
        oldName: string;
        newName: string;
        accept: () => void;
        reject: (reason?: unknown) => void;
    }) {
        super('TabbedView.TabRenamed.v1');
        this.viewId = viewId;
        this.oldName = oldName;
        this.newName = newName;
        this.accept = accept;
        this.reject = reject;
    }
}

/**
 * Payload for `tab-moved` events emitted by TabbedView.
 */
class TabbedViewTabMovedPayload extends AppPayload {
    viewId: string;
    fromIndex: number;
    toIndex: number;
    view: TabbedViewEntry;
    /**
    * @param {object} params - Aggregated payload members for tab moves.
    * @param {string} params.viewId - ID of the tab that moved.
    * @param {number} params.fromIndex - Zero-based index before the move.
    * @param {number} params.toIndex - Zero-based index after the move.
    * @param {ViewBase|object} params.view - The moved view or placeholder.
     */
    constructor({
        viewId,
        fromIndex,
        toIndex,
        view,
    }: {
        viewId: string;
        fromIndex: number;
        toIndex: number;
        view: TabbedViewEntry;
    }) {
        super('TabbedView.TabMoved.v1');
        this.viewId = viewId;
        this.fromIndex = fromIndex;
        this.toIndex = toIndex;
        this.view = view;
    }
}

/**
 * Payload for `tab-context-menu` events emitted by TabbedView.
 */
class TabbedViewTabContextMenuPayload extends AppPayload {
    viewId: string;
    view: TabbedViewEntry | null;
    clientX: number;
    clientY: number;
    nativeEvent: Event;
    /**
     * @param {object} params - Aggregated payload members for tab context-menu requests.
     * @param {string} params.viewId - ID of the tab that was right-clicked.
     * @param {ViewBase|object|null} params.view - The tab view or placeholder, when found.
     * @param {number} params.clientX - Viewport X coordinate for the menu anchor.
     * @param {number} params.clientY - Viewport Y coordinate for the menu anchor.
     * @param {Event} params.nativeEvent - Original contextmenu or keydown event.
     */
    constructor({
        viewId,
        view,
        clientX,
        clientY,
        nativeEvent,
    }: {
        viewId: string;
        view: TabbedViewEntry | null;
        clientX: number;
        clientY: number;
        nativeEvent: Event;
    }) {
        super('TabbedView.TabContextMenu.v1');
        this.viewId = viewId;
        this.view = view;
        this.clientX = clientX;
        this.clientY = clientY;
        this.nativeEvent = nativeEvent;
    }
}

/**
 * Payload for `control` events emitted by TabbedView.
 */
class TabbedViewControlPayload extends AppPayload {
    id: string;
    control: TabbedViewControl;
    nativeEvent: Event;
    tabbedView: TabbedView;
    tabsOnly: boolean;
    /**
    * @param {object} params - Aggregated payload members for control-tab actions.
    * @param {string} params.id - Activated control identifier.
    * @param {object} params.control - Control definition object for the activated control.
    * @param {Event} params.nativeEvent - Original DOM event that triggered the control.
    * @param {TabbedView} params.tabbedView - Source TabbedView instance emitting the event.
    * @param {boolean} params.tabsOnly - Whether tabs-only mode is active after handling.
     */
    constructor({
        id,
        control,
        nativeEvent,
        tabbedView,
        tabsOnly,
    }: {
        id: string;
        control: TabbedViewControl;
        nativeEvent: Event;
        tabbedView: TabbedView;
        tabsOnly: boolean;
    }) {
        super('TabbedView.Control.v1');
        this.id = id;
        this.control = control;
        this.nativeEvent = nativeEvent;
        this.tabbedView = tabbedView;
        this.tabsOnly = tabsOnly;
    }
}

/**
 * TabbedView hosts multiple ViewBase children and shows exactly one at a time.
 *
 * Usage notes:
 * - Construct with views and optional control tabs; use addView(view) later to append more tabs. The active tab
 *   defaults to the first view unless activeId is provided.
 * - Attach to a container with attachTo(element) to render the tab strip and active content.
 * - Change layout with setTabPosition('top'|'bottom'|'left'|'right', rotationDegrees?) where vertical strips
 *   auto-rotate labels by 90° unless an explicit rotation is provided.
 * - Register control tabs (non-content actions) via constructor controls or setControls(); listen for the
 *   'control' event to respond when a control tab is clicked.
 * - The built-in tabs-only control (arrow icon) minimizes this TabbedView inside a SplitView by sending a
 *   SPLIT_VIEW_ACTIONS.minimize request and restores the previous size when toggled again or when a tab is selected.
 * - Serialize/deserialize via serialize()/TabbedView.deserialize() to persist tabs, closability, orientation,
 *   control tab metadata, and tabs-only control preferences.
 *
 * Emitted Events:
 * - `tab-changed` -> `payloadTypeId: TabbedView.TabChanged.v1` -> `TabbedViewTabChangedPayload`
 * - `tab-renamed` -> `payloadTypeId: TabbedView.TabRenamed.v1` -> `TabbedViewTabRenamedPayload`
 * - `tab-moved` -> `payloadTypeId: TabbedView.TabMoved.v1` -> `TabbedViewTabMovedPayload`
 * - `tab-context-menu` -> `payloadTypeId: TabbedView.TabContextMenu.v1` -> `TabbedViewTabContextMenuPayload`
 * - `control` -> `payloadTypeId: TabbedView.Control.v1` -> `TabbedViewControlPayload`
 *
 * @extends ViewBase
 */
export class TabbedView extends ViewBase {
    views: TabbedViewEntry[];
    activeId: string | null;
    closable: boolean;
    reorderable: boolean;
    tabContextMenu: boolean;
    tabPosition: TabPosition;
    tabLabelRotation: number;
    controls: TabbedViewControl[];
    tabsOnlyControl: boolean;
    tabsOnlyControlTitle: string;

    private _tabsOnlyControlId: string;
    private _tabsOnlyActive: boolean;
    private _savedSizeConstraints: TabbedViewSizeConstraints | null;
    private _tabsOnlyAppliedConstraints: TabbedViewSizeConstraints | null;
    private _closableById: Map<string, boolean>;
    private _movableById: Map<string, boolean>;

    private _host: HTMLDivElement | null;
    private _tabsRow: HTMLDivElement | null;
    private _tabsRail: HTMLDivElement | null;
    private _tabsScroll: HTMLDivElement | null;
    private _tabsEl: HTMLDivElement | null;
    private _tabsControls: HTMLDivElement | null;
    private _tabsOnlyBtn: HTMLDivElement | null;
    private _tabsOnlyIcon: HTMLImageElement | null;
    private _prevBtn: HTMLButtonElement | null;
    private _nextBtn: HTMLButtonElement | null;
    private _contentEl: HTMLDivElement | null;
    private _mountedView: TabbedViewEntry | null;
    private _tabsResizeObserver: ResizeObserver | null;
    private _windowResizeHandler: (() => void) | null;
    private _tabDragState: TabbedViewDragState | null;
    private _tabDragMoveHandler: ((event: PointerEvent) => void) | null;
    private _tabDragEndHandler: ((event: PointerEvent) => void) | null;
    private _tabDragCancelHandler: ((event: Event) => void) | null;
    private _tabDragKeyHandler: ((event: KeyboardEvent) => void) | null;
    private _tabDragBlurHandler: (() => void) | null;
    /**
     * @param {object} [options]
     * @param {ViewBase[]} [options.views=[]] Tabs to register initially.
     * @param {Array<object>} [options.controls=[]] Control tab definitions (non-content).
     * @param {string|null} [options.activeId=null] Id of the tab to activate after render.
     * @param {boolean} [options.closable=true] Default closability for new tabs.
     * @param {boolean} [options.reorderable=false] Enable pointer/keyboard tab reordering.
     * @param {boolean} [options.tabContextMenu=false] Emit `tab-context-menu` for right-click/Shift+F10 on tabs.
     * @param {string} [options.title='Tabbed View'] Metadata title.
     * @param {string|null} [options.icon=null] Metadata icon.
     * @param {string|null} [options.id=null] Explicit id (auto when omitted).
     * @param {'top'|'bottom'|'left'|'right'} [options.tabPosition='top'] Tab strip placement.
     * @param {number|null} [options.tabLabelRotation=null] Explicit label rotation (multiples of 90 when vertical).
     * @param {boolean} [options.tabsOnlyControl=true] Whether to show the built-in tabs-only toggle control.
     * @param {string} [options.tabsOnlyControlTitle='Toggle tabs-only strip'] Tooltip/label for the tabs-only control.
     * @param {string} [options.tabsOnlyControlId='tabbed-tabs-only'] Stable id used for the tabs-only control tab.
     * @param {Function|null} [options.logger=null] Optional logger hook for diagnostics.
     * @param {object|null} [options.i18nService=null] Optional I18nService instance for translations.
     */
    constructor({
        views = [],
        controls = [],
        activeId = null,
        closable = true,
        reorderable = false,
        tabContextMenu = false,
        title = 'Tabbed View',
        icon = null,
        id = null,
        tabPosition = 'top',
        tabLabelRotation = null,
        tabsOnlyControl = true,
        tabsOnlyControlTitle = 'Toggle tabs-only strip',
        tabsOnlyControlId = 'tabbed-tabs-only',
        logger = null,
        i18nService = null,
    }: TabbedViewOptions = {}) {
        super({ title, icon, id, logger, i18nService });
        this.views = [];
        this.activeId = activeId;
        this.closable = closable;
        this.reorderable = Boolean(reorderable);
        this.tabContextMenu = Boolean(tabContextMenu);
        this.tabPosition = this._sanitizeTabPosition(tabPosition);
        this.tabLabelRotation = this._computeLabelRotation(tabLabelRotation, this.tabPosition);
        this.controls = this._normalizeControls(controls);
        this.tabsOnlyControl = tabsOnlyControl !== false;
        this.tabsOnlyControlTitle = tabsOnlyControlTitle || 'Toggle tabs-only strip';
        this._tabsOnlyControlId = tabsOnlyControlId || 'tabbed-tabs-only';
        this._tabsOnlyActive = false;
        this._savedSizeConstraints = null;
        this._tabsOnlyAppliedConstraints = null;
        this._closableById = new Map();
        this._movableById = new Map();
        this._host = null;
        this._tabsRow = null;
        this._tabsRail = null;
        this._tabsScroll = null;
        this._tabsEl = null;
        this._tabsControls = null;
        this._tabsOnlyBtn = null;
        this._tabsOnlyIcon = null;
        this._prevBtn = null;
        this._nextBtn = null;
        this._contentEl = null;
        this._mountedView = null;
        this._tabsResizeObserver = null;
        this._windowResizeHandler = null;
        this._tabDragState = null;
        this._tabDragMoveHandler = null;
        this._tabDragEndHandler = null;
        this._tabDragCancelHandler = null;
        this._tabDragKeyHandler = null;
        this._tabDragBlurHandler = null;

        if (views.length) {
            this.setViews(views, activeId);
        }
    }

    /**
     * Serialize tab settings, control tabs, and child views into a JSON-friendly object.
     * @returns {{
     *   type: string,
     *   id: string,
     *   title: string,
     *   icon: string|null,
     *   activeId: string|null,
     *   closable: boolean,
     *   tabPosition: string,
     *   tabLabelRotation: number,
     *   controls: Array<{id: string, icon: string|null, title: string, align: 'start'|'end', toggles: boolean}>,
     *   tabsOnlyControl: {enabled: boolean, title: string, id: string},
     *   tabClosers: Array<{id: string, closable: boolean}>,
     *   views: object[]
     * }}
     */
    serialize(): TabbedViewSerialized {
        return {
            ...super.serialize(),
            type: 'TabbedView',
            activeId: this.activeId,
            closable: this.closable,
            reorderable: this.reorderable,
            tabPosition: this.tabPosition,
            tabLabelRotation: this.tabLabelRotation,
            controls: this.controls.map((control) => ({
                id: control.id,
                icon: control.icon,
                title: control.title,
                align: control.align,
                toggles: Boolean(control.toggles),
            })),
            tabsOnlyControl: {
                enabled: Boolean(this.tabsOnlyControl),
                title: this.tabsOnlyControlTitle,
                id: this._tabsOnlyControlId,
            },
            tabClosers: this.views.map((view) => ({
                id: view.id,
                closable: this._isClosable(view.id),
            })),
            tabMovability: this.views.map((view) => ({
                id: view.id,
                movable: this.isViewMovable(view.id),
            })),
            views: this.views.map((view) => {
                if (typeof view.serialize === 'function') {
                    return view.serialize();
                }
                if (typeof view.getMetadata === 'function') {
                    return view.getMetadata();
                }
                return {
                    id: view?.id ?? null,
                    title: view?.title ?? 'View',
                    icon: view?.icon ?? null,
                };
            }),
        };
    }

    /**
     * Rehydrate a TabbedView from serialized data, including control tabs and the tabs-only toggle config.
     * @param {object} data Serialized tabbed view data (see serialize()).
     * @param {Function} [viewFactory=ViewBase.deserialize] Factory to restore child views.
     * @param {object} [context={}] Context object with i18nService and logger.
     * @returns {TabbedView}
     */
    static deserialize(
        data: TabbedViewDeserializeData = {},
        viewFactory: ViewFactory | typeof ViewBase.deserialize = ViewBase.deserialize,
        context: TabbedViewDeserializeContext = {}
    ): TabbedView {
        const {
            title = 'Tabbed View',
            icon = null,
            id = null,
            activeId = null,
            closable = true,
            reorderable = false,
            views = [],
            tabClosers = [],
            tabMovability = [],
            tabPosition = 'top',
            tabLabelRotation = null,
            controls = [],
            tabsOnlyControl = { enabled: true },
        } = data;

        const { i18nService = null, logger = null } = context;

        const tabsOnlyConfig =
            tabsOnlyControl && typeof tabsOnlyControl === 'object'
                ? tabsOnlyControl
                : { enabled: Boolean(tabsOnlyControl) };
        const tabsOnlyEnabled = tabsOnlyConfig.enabled !== false;
        const tabsOnlyControlTitle = tabsOnlyConfig.title || 'Toggle tabs-only strip';
        const tabsOnlyControlId = tabsOnlyConfig.id || 'tabbed-tabs-only';

        const instance = new TabbedView({
            title,
            icon,
            id,
            activeId,
            closable,
            reorderable,
            tabPosition,
            tabLabelRotation,
            controls,
            tabsOnlyControl: tabsOnlyEnabled,
            tabsOnlyControlTitle,
            tabsOnlyControlId,
            logger,
            i18nService,
        });
        instance._closableById = new Map(
            Array.isArray(tabClosers)
                ? tabClosers.map((entry) => [entry.id, Boolean(entry.closable)])
                : []
        );
        instance._movableById = new Map(
            Array.isArray(tabMovability)
                ? tabMovability
                      .filter(
                          (entry): entry is { id: string; movable: boolean } =>
                              Boolean(entry) && typeof entry.id === 'string'
                      )
                      .map((entry) => [entry.id, Boolean(entry.movable)])
                : []
        );
        const makeView =
            typeof viewFactory === 'function' ? viewFactory : ((entry: unknown) => ViewBase.deserialize(entry as Record<string, unknown>) as unknown as TabbedViewEntry);
        const children: TabbedViewEntry[] = Array.isArray(views)
            ? views.map((entry) => makeView(entry))
            : [];
        const restoredIds = new Set(children.map((entry) => entry.id));
        instance._movableById = new Map(
            Array.from(instance._movableById.entries()).filter(([id]) => restoredIds.has(id))
        );
        if (children.length) {
            instance.setViews(children, activeId);
        }
        return instance;
    }

    /**
     * Replace all tabs and optionally set the active tab id.
     * @param {ViewBase[]} views List of views to register as tabs.
     * @param {string|null} [activeId] Optional id to make active.
     */
    setViews(views: TabbedViewEntry[], activeId: string | null = null): void {
        if (!Array.isArray(views)) {
            throw new Error('TabbedView.setViews requires an array of views.');
        }

        // Detach all existing views when replacing the entire set
        this.views.forEach((view) => {
            this._detachViewContainer(view);
        });
        if (this._contentEl) {
            this._contentEl.replaceChildren();
        }
        this._mountedView = null;

        this.views = views;
        // Preserve pre-set closable flags when available; default to the TabbedView closable setting.
        this.views.forEach((view) => {
            if (!this._closableById.has(view.id)) {
                this._closableById.set(view.id, this.closable);
            }
        });

        const previousMovability = this._movableById;
        this._movableById = new Map(
            this.views.map((view) => [
                view.id,
                previousMovability.has(view.id)
                    ? Boolean(previousMovability.get(view.id))
                    : view.movable !== false,
            ])
        );
        this.activeId = activeId;
        this._ensureActiveId();
        this._renderTabs();
        this._attachActiveView();
    }

    /**
     * Add a new tab and optionally make it active.
     * @param {ViewBase|object} view View instance or placeholder to add as a tab.
     * @param {number} [index] Insertion index (defaults to append).
     * @param {boolean} [makeActive=true] Whether to activate immediately.
     * @param {boolean} [closable=this.closable] Per-tab closability override.
     * @param {boolean} [movable] Per-tab movability override (defaults to view.movable !== false).
     * @returns {ViewBase|object}
     */
    addView(
        view: TabbedViewEntry,
        index: number = this.views.length,
        makeActive = true,
        closable: boolean = this.closable,
        movable?: boolean
    ): TabbedViewEntry {
        if (!view) {
            throw new Error('TabbedView.addView requires a view object.');
        }
        
        // Call hook to validate/normalize the view
        const validatedView = this._validateView(view);
        if (!validatedView) {
            throw new Error('TabbedView._validateView hook returned null/undefined.');
        }
        
        // If not a placeholder, must have attachTo method (ViewBase requirement)
        if (!this._isPlaceholder(validatedView) && typeof validatedView.attachTo !== 'function') {
            throw new Error('TabbedView.addView requires a ViewBase instance with attachTo method, or a placeholder object.');
        }

        const insertAt = Math.min(Math.max(0, index), this.views.length);
        this.views.splice(insertAt, 0, validatedView);
        this._closableById.set(validatedView.id, closable);
        const isMovable = movable === undefined ? validatedView.movable !== false : Boolean(movable);
        this._movableById.set(validatedView.id, isMovable);
        if (!this.activeId || makeActive) {
            this.activeId = validatedView.id;
        }
        this._renderTabs();
        this._attachActiveView();
        return validatedView;
    }

    /**
     * Detach a view and remove its TabbedView-owned wrapper from the DOM.
     *
     * The view's `container` is the `.tabbed-view__view-container` wrapper created by
     * `_attachActiveView()`, not a child of it. Keeping that distinction here prevents an empty
     * wrapper from surviving `removeView()` and competing with the active tab for flex width.
     *
     * @param {ViewBase|object} view - Tab view to detach.
     * @private
     */
    _detachViewContainer(view: TabbedViewEntry): void {
        if (!view || this._isPlaceholder(view)) {
            return;
        }

        const container = view.container ?? null;
        if (!container) {
            return;
        }

        const wrapper = container.classList.contains('tabbed-view__view-container')
            ? container
            : null;

        if (typeof view.detach === 'function') {
            view.detach();
        }

        wrapper?.remove();
    }

    /**
     * Remove a tab by instance, id, or index.
     * @param {ViewBase|string|number} target Tab to remove (instance, id, or index).
     * @returns {ViewBase|null} The removed view or null if not found.
     */
    removeView(target: TabbedViewEntry | string | number): TabbedViewEntry | null {
        if (!this.views.length) {
            return null;
        }

        const index = this._resolveIndex(target);
        if (index < 0 || index >= this.views.length) {
            return null;
        }

        const [removed] = this.views.splice(index, 1);
        this._closableById.delete(removed.id);
        this._movableById.delete(removed.id);
        
        // Only detach if it's a real view (not a placeholder)
        this._detachViewContainer(removed);
        
        if (removed === this._mountedView) {
            this._mountedView = null;
        }

        if (this.views.length === 0) {
            this.activeId = null;
        } else if (this.activeId === removed.id) {
            const fallback = this.views[index] || this.views[index - 1] || this.views[0];
            this.activeId = fallback?.id ?? null;
        }

        this._renderTabs();
        this._attachActiveView();
        return removed;
    }

    /**
     * Return whether a tab may be reordered.
     *
     * Unknown ids are treated as movable so callers do not need to special-case controls or
     * not-yet-rendered entries. This is the structural flag only: `reorderable` controls whether the
     * user can start a drag or press the keyboard shortcut, not whether code may call `moveView()`.
     *
     * @param {string} id - View id to inspect.
     * @returns {boolean} True when the tab may change position.
     */
    isViewMovable(id: string): boolean {
        if (!id) {
            return false;
        }
        return this._movableById.get(id) !== false;
    }

    /**
     * Pin or unpin a tab for reordering.
     *
     * @param {string} id - View id to update.
     * @param {boolean} [movable=true] - Whether the tab may be reordered.
     */
    setViewMovable(id: string, movable = true): void {
        if (!id || !this.views.some((view) => view.id === id)) {
            return;
        }
        this._movableById.set(id, Boolean(movable));
        this._renderTabs();
    }

    /**
     * Move a tab to another index.
     *
     * `toIndex` is the index the tab occupies in the resulting array (not an insertion gap).
     * Out-of-range integers are clamped. A tab never crosses an immovable tab, so a requested move
     * stops in front of the first wall. No-op, unknown-target and immovable-tab calls return `false`
     * without emitting `tab-moved`.
     *
     * @param {ViewBase|string|number} target - Tab to move (instance, id, or current index).
     * @param {number} toIndex - Target index in the resulting tab array.
     * @returns {boolean} True when the tab order changed.
     */
    moveView(target: TabbedViewEntry | string | number, toIndex: number): boolean {
        if (this.views.length < 2) {
            return false;
        }

        const fromIndex = this._resolveIndex(target);
        if (fromIndex < 0 || fromIndex >= this.views.length) {
            return false;
        }

        const view = this.views[fromIndex];
        if (!this.isViewMovable(view.id)) {
            return false;
        }

        const finalIndex = this._clampMovableTargetIndex(fromIndex, toIndex);
        if (finalIndex === fromIndex) {
            return false;
        }

        this.views.splice(fromIndex, 1);
        this.views.splice(finalIndex, 0, view);

        // Re-render before emitting so listeners observe the final DOM order.
        this._renderTabs();

        this._emit(
            'tab-moved',
            new TabbedViewTabMovedPayload({
                viewId: view.id,
                fromIndex,
                toIndex: finalIndex,
                view,
            })
        );
        return true;
    }

    /**
     * Cancel an in-flight tab drag and remove every global listener/indicator.
     * Safe to call when no drag is active.
     * @private
     */
    _cancelTabDrag(): void {
        if (this._tabDragMoveHandler) {
            window.removeEventListener('pointermove', this._tabDragMoveHandler);
            this._tabDragMoveHandler = null;
        }
        if (this._tabDragEndHandler) {
            window.removeEventListener('pointerup', this._tabDragEndHandler);
            this._tabDragEndHandler = null;
        }
        if (this._tabDragCancelHandler) {
            window.removeEventListener('pointercancel', this._tabDragCancelHandler);
            this._tabDragCancelHandler = null;
        }
        if (this._tabDragKeyHandler) {
            window.removeEventListener('keydown', this._tabDragKeyHandler, true);
            this._tabDragKeyHandler = null;
        }
        if (this._tabDragBlurHandler) {
            window.removeEventListener('blur', this._tabDragBlurHandler);
            this._tabDragBlurHandler = null;
        }

        this._clearTabDropIndicators();
        this._tabDragState = null;
        this._host?.classList.remove('tabbed-view--dragging');
    }

    /** Remove drag/drop indicator classes from every tab. @private */
    _clearTabDropIndicators(): void {
        if (!this._tabsEl) {
            return;
        }
        this._tabsEl
            .querySelectorAll('.tabbed-view__tab')
            .forEach((tab) => tab.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
    }

    /**
     * Begin a pointer-driven tab drag. No state becomes visible until the pointer moves past the
     * activation threshold, so clicks and double-clicks keep working.
     *
     * @param {PointerEvent} event - Pointerdown event on a tab.
     * @param {string} viewId - Tab being dragged.
     * @private
     */
    _beginTabDrag(event: PointerEvent, viewId: string): void {
        if (!this.reorderable || event.button !== 0 || event.isPrimary === false) {
            return;
        }
        if (!this.isViewMovable(viewId)) {
            return;
        }

        const target = event.target;
        if (
            target instanceof Element &&
            target.closest(
                '.tabbed-view__tab-close, .tabbed-view__tab-rename-input, input, textarea, button'
            )
        ) {
            return;
        }

        this._cancelTabDrag();
        this._tabDragState = {
            viewId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            dropGap: null,
            dropIndex: null,
        };

        this._tabDragMoveHandler = (moveEvent) => this._onTabDragMove(moveEvent);
        this._tabDragEndHandler = (endEvent) => this._onTabDragEnd(endEvent);
        this._tabDragCancelHandler = () => this._cancelTabDrag();
        this._tabDragKeyHandler = (keyEvent) => {
            if (keyEvent.key === 'Escape') {
                keyEvent.preventDefault();
                this._cancelTabDrag();
            }
        };
        this._tabDragBlurHandler = () => this._cancelTabDrag();

        window.addEventListener('pointermove', this._tabDragMoveHandler);
        window.addEventListener('pointerup', this._tabDragEndHandler);
        window.addEventListener('pointercancel', this._tabDragCancelHandler);
        window.addEventListener('keydown', this._tabDragKeyHandler, true);
        window.addEventListener('blur', this._tabDragBlurHandler);
    }

    /**
     * Track an active drag and refresh the drop indicator.
     * @param {PointerEvent} event - Window pointermove event.
     * @private
     */
    _onTabDragMove(event: PointerEvent): void {
        const state = this._tabDragState;
        if (!state) {
            return;
        }
        if (
            event.pointerId !== undefined &&
            state.pointerId !== undefined &&
            event.pointerId !== state.pointerId
        ) {
            return;
        }

        if (!state.active) {
            const dx = event.clientX - state.startX;
            const dy = event.clientY - state.startY;
            if (Math.hypot(dx, dy) < TAB_DRAG_THRESHOLD_PX) {
                return;
            }
            state.active = true;
            this._host?.classList.add('tabbed-view--dragging');
        }

        event.preventDefault();

        const fromIndex = this.views.findIndex((view) => view.id === state.viewId);
        if (fromIndex < 0) {
            this._cancelTabDrag();
            return;
        }

        const gap = this._computeTabDropGap(state.viewId, event.clientX, event.clientY);
        if (gap === null) {
            return;
        }

        state.dropGap = gap;
        state.dropIndex = gap > fromIndex ? gap - 1 : gap;
        this._applyTabDropIndicator(state);
    }

    /**
     * Finish a drag and commit the drop, if the drag actually started.
     * @param {PointerEvent} event - Window pointerup event.
     * @private
     */
    _onTabDragEnd(event: PointerEvent): void {
        const state = this._tabDragState;
        if (!state) {
            return;
        }
        if (
            event.pointerId !== undefined &&
            state.pointerId !== undefined &&
            event.pointerId !== state.pointerId
        ) {
            return;
        }

        const { viewId, active, dropIndex } = state;
        this._cancelTabDrag();

        if (!active || dropIndex === null) {
            return;
        }

        this.moveView(viewId, dropIndex);
    }

    /**
     * Find the contiguous movable block that contains a tab.
     *
     * @param {string} viewId - Tab id.
     * @returns {{ start: number, end: number } | null} Inclusive block bounds or null.
     * @private
     */
    _getMovableBlock(viewId: string): { start: number; end: number } | null {
        const index = this.views.findIndex((view) => view.id === viewId);
        if (index < 0 || !this.isViewMovable(viewId)) {
            return null;
        }

        let start = index;
        while (start > 0 && this.isViewMovable(this.views[start - 1].id)) {
            start--;
        }

        let end = index;
        while (end < this.views.length - 1 && this.isViewMovable(this.views[end + 1].id)) {
            end++;
        }

        return { start, end };
    }

    /**
     * Resolve the pointer position to an insertion gap in the current tab order.
     *
     * The gap is a boundary between tabs (`block.start` .. `block.end + 1`), not a final array index.
     * Conversion to the final index happens in the move handler:
     * `gap > fromIndex ? gap - 1 : gap`.
     *
     * @param {string} viewId - Dragged tab id.
     * @param {number} clientX - Pointer x in viewport coordinates.
     * @param {number} clientY - Pointer y in viewport coordinates.
     * @returns {number | null} Gap index, or null when the tab/DOM is unavailable.
     * @private
     */
    _computeTabDropGap(viewId: string, clientX: number, clientY: number): number | null {
        const block = this._getMovableBlock(viewId);
        if (!block || !this._tabsEl) {
            return null;
        }

        const vertical = this._isVertical();
        const point = vertical ? clientY : clientX;
        const tabs = Array.from(
            this._tabsEl.querySelectorAll<HTMLElement>('.tabbed-view__tab[data-view-id]')
        );

        for (let index = block.start; index <= block.end; index += 1) {
            const tab = tabs[index];
            if (!tab) {
                continue;
            }
            const rect = tab.getBoundingClientRect();
            const start = vertical ? rect.top : rect.left;
            const end = vertical ? rect.bottom : rect.right;
            if (point < start + (end - start) / 2) {
                return index;
            }
        }

        return block.end + 1;
    }

    /**
     * Paint the source tab and the insertion indicator for the current drop gap.
     * @param {TabbedViewDragState} state - Active drag state.
     * @private
     */
    _applyTabDropIndicator(state: TabbedViewDragState): void {
        this._clearTabDropIndicators();

        if (state.dropGap === null || state.dropIndex === null) {
            return;
        }

        const fromIndex = this.views.findIndex((view) => view.id === state.viewId);
        const block = this._getMovableBlock(state.viewId);
        if (fromIndex < 0 || !block || state.dropIndex === fromIndex) {
            return;
        }

        const tabs = Array.from(
            this._tabsEl?.querySelectorAll<HTMLElement>('.tabbed-view__tab[data-view-id]') ?? []
        );

        tabs[fromIndex]?.classList.add('is-dragging');

        if (state.dropGap <= block.end) {
            tabs[state.dropGap]?.classList.add('is-drop-before');
        } else {
            tabs[block.end]?.classList.add('is-drop-after');
        }
    }

    /**
     * Emit the opt-in tab context-menu request.
     * @param {string} viewId - Tab id.
     * @param {Event} nativeEvent - Original DOM event.
     * @param {number} clientX - Viewport X anchor.
     * @param {number} clientY - Viewport Y anchor.
     * @private
     */
    _emitTabContextMenu(viewId: string, nativeEvent: Event, clientX: number, clientY: number): void {
        const view = this._findViewById(viewId);
        this._log('tab-context-menu', { viewId, clientX, clientY });
        this._emit(
            'tab-context-menu',
            new TabbedViewTabContextMenuPayload({
                viewId,
                view,
                clientX,
                clientY,
                nativeEvent,
            })
        );
    }

    /**
     * Handle a right-click on a tab when `tabContextMenu` is enabled.
     * @param {MouseEvent} event - DOM contextmenu event.
     * @param {string} viewId - Tab id.
     * @private
     */
    _handleTabContextMenu(event: MouseEvent, viewId: string): void {
        const target = event.target as Element | null;
        if (typeof target?.closest === 'function' && target.closest('input, textarea')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this._cancelTabDrag();

        this._emitTabContextMenu(
            viewId,
            event,
            Number.isFinite(event.clientX) ? event.clientX : 0,
            Number.isFinite(event.clientY) ? event.clientY : 0
        );
    }

    /**
     * Handle `ContextMenu` / `Shift+F10` on a focused tab when `tabContextMenu` is enabled.
     * @param {KeyboardEvent} event - Keydown event on the tab.
     * @param {string} viewId - Tab id.
     * @returns {boolean} True when the event was handled (and default prevented).
     * @private
     */
    _handleTabContextMenuKeydown(event: KeyboardEvent, viewId: string): boolean {
        if (!this.tabContextMenu) {
            return false;
        }
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();

        const tab = event.currentTarget as HTMLElement | null;
        const rect =
            tab && typeof tab.getBoundingClientRect === 'function'
                ? tab.getBoundingClientRect()
                : null;

        this._emitTabContextMenu(
            viewId,
            event,
            typeof rect?.left === 'number' && Number.isFinite(rect.left) ? rect.left : 0,
            typeof rect?.bottom === 'number' && Number.isFinite(rect.bottom) ? rect.bottom + 2 : 0
        );
        return true;
    }

    /**
     * Handle `Alt+Arrow` reordering on a focused tab.
     *
     * @param {KeyboardEvent} event - Keydown event on the tab.
     * @param {string} viewId - Tab id.
     * @returns {boolean} True when the event was handled (and default prevented).
     * @private
     */
    _handleTabReorderKeydown(event: KeyboardEvent, viewId: string): boolean {
        if (!this.reorderable || !this.isViewMovable(viewId) || !event.altKey) {
            return false;
        }

        const vertical = this._isVertical();
        let delta = 0;
        if (vertical && event.key === 'ArrowUp') {
            delta = -1;
        } else if (vertical && event.key === 'ArrowDown') {
            delta = 1;
        } else if (!vertical && event.key === 'ArrowLeft') {
            delta = -1;
        } else if (!vertical && event.key === 'ArrowRight') {
            delta = 1;
        }

        if (delta === 0) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();

        const fromIndex = this.views.findIndex((view) => view.id === viewId);
        if (fromIndex < 0) {
            return true;
        }

        if (this.moveView(viewId, fromIndex + delta)) {
            this._focusTabById(viewId);
        }
        return true;
    }

    /**
     * Find the rendered tab button for a view id.
     * @param {string} viewId - Tab id.
     * @returns {HTMLElement|null} Tab button, or null when the tab is not rendered.
     * @private
     */
    _findTabElement(viewId: string): HTMLElement | null {
        const tabs = Array.from(
            this._tabsEl?.querySelectorAll<HTMLElement>('.tabbed-view__tab[data-view-id]') ?? []
        );
        return tabs.find((tab) => tab.dataset.viewId === viewId) ?? null;
    }

    /**
     * Focus the tab button for a view id after a re-render replaced the DOM nodes.
     * @param {string} viewId - Tab id.
     * @private
     */
    _focusTabById(viewId: string): void {
        this._findTabElement(viewId)?.focus();
    }

    /**
     * Start inline editing of a tab label. The active tab does not change.
     * Used by the tab double-click handler and by consumers that add a Rename entry to their tab
     * context menu.
     * @param {string} viewId - View ID whose tab should be renamed.
     * @returns {boolean} True when the inline editor was opened.
     */
    beginTabRename(viewId: string): boolean {
        if (!this._findViewById(viewId)) {
            return false;
        }

        const tab = this._findTabElement(viewId);
        const label = tab?.querySelector<HTMLElement>('.tabbed-view__tab-label') ?? null;
        if (!label) {
            return false;
        }

        this._enableTabRename(viewId, label);
        return true;
    }

    /**
     * Select a tab by id, render its content, and exit tabs-only mode when active.
     * @param {string} id Tab identifier.
     */
    selectView(id: string): void {
        if (!id) {
            return;
        }
        if (this.activeId === id) {
            return;
        }

        const previousId = this.activeId;
        const previousIndex = this.views.findIndex((view) => view?.id === previousId);
        
        let view = this._findViewById(id);
        
        // Check if view is a placeholder and needs to be loaded
        if (!view || this._isPlaceholder(view)) {
            this._log('view-requested', { id, isPlaceholder: !!view });
            const loadedView = this._onViewRequested(id, view);
            
            if (!loadedView) {
                this._log('view-load-failed', { id });
                return;
            }
            
            view = loadedView;
            
            // Notify subclass of successful creation
            this._onViewCreated(view, id);
        }
        
        if (!view) {
            return;
        }
        
        this.activeId = id;
        this._restoreTabsOnly('tab-select');
        this._attachActiveView();

        const payload = new TabbedViewTabChangedPayload({
            previousId,
            activeId: this.activeId,
            previousIndex,
            activeIndex: this.views.findIndex((entry) => entry?.id === this.activeId),
            view,
        });

        this._emit('tab-changed', payload);
    }

    /** Current active view instance, if any. */
    getActiveView(): TabbedViewEntry | null {
        return this._findViewById(this.activeId);
    }

    /**
     * Expose the tabs-only control id for diagnostics and custom control wiring.
     * The default id is 'tabbed-tabs-only' unless overridden via constructor.
     */
    get tabsOnlyControlId(): string {
        return this._tabsOnlyControlId;
    }

    /**
     * Whether the tabs-only strip is currently active (content hidden, SplitView minimized).
     * Useful for updating surrounding UI when the built-in control is toggled.
     */
    isTabsOnly(): boolean {
        return this._tabsOnlyActive;
    }

    /**
     * Replace all control tab definitions and rerender the strip.
     * Control shape: { id, icon (emoji|text|image path), title, align: 'start'|'end', toggles?: boolean, showLabel?: boolean }.
     */
    setControls(controls: TabbedViewControlInput[] = []): TabbedViewControl[] {
        this.controls = this._normalizeControls(controls);
        this._renderTabs();
        return this.controls;
    }

    /**
     * Insert a control tab at the requested position. Toggle controls set toggles: true to receive pressed styling.
     * Emits a 'control' event with the control definition when clicked.
     */
    addControl(control: TabbedViewControlInput, index: number = this.controls.length): TabbedViewControl | null {
        const normalized = this._normalizeControl(control, index);
        if (!normalized) {
            return null;
        }
        const insertAt = Math.min(Math.max(0, index), this.controls.length);
        this.controls.splice(insertAt, 0, normalized);
        this._renderTabs();
        return normalized;
    }

    /** Remove a control tab by id, instance, or index; returns the removed control when found. */
    removeControl(target: TabbedViewControl | string | number): TabbedViewControl | null {
        if (!this.controls.length) {
            return null;
        }
        const index = this._resolveControlIndex(target);
        if (index < 0 || index >= this.controls.length) {
            return null;
        }
        const [removed] = this.controls.splice(index, 1);
        this._renderTabs();
        return removed;
    }

    /**
     * Toggle whether a specific tab is closable. Useful for pinning welcome/primary tabs.
     * @param {string} id View id to update.
     * @param {boolean} [closable=true] Whether the tab shows a close button.
     */
    enableViewClosability(id: string, closable = true): void {
        if (!id) {
            return;
        }
        this._closableById.set(id, Boolean(closable));
        this._renderTabs();
    }

    /**
     * Build the host container and tab UI.
     * The host is attached through `mountContent`, so the parent element is not touched directly.
     * @param {HTMLElement} _container Host element supplied by parent view.
     */
    render(_container: HTMLElement): void {
        this._host = document.createElement('div');
        this._host.className = 'tabbed-view';

        this._tabsRow = document.createElement('div');
        this._tabsRow.className = 'tabbed-view__tabs-row';

        this._tabsRail = document.createElement('div');
        this._tabsRail.className = 'tabbed-view__tabs-rail';

        this._tabsScroll = document.createElement('div');
        this._tabsScroll.className = 'tabbed-view__tabs-scroll';
        this._tabsScroll.setAttribute('role', 'presentation');
        this._tabsScroll.addEventListener('scroll', () => this._updateScrollControls());

        this._tabsEl = document.createElement('div');
        this._tabsEl.className = 'tabbed-view__tabs';
        this._tabsEl.setAttribute('role', 'tablist');

        this._tabsScroll.appendChild(this._tabsEl);

        this._tabsControls = document.createElement('div');
        this._tabsControls.className = 'tabbed-view__tabs-controls';

        this._prevBtn = document.createElement('button');
        this._prevBtn.type = 'button';
        this._prevBtn.className = 'tabbed-view__tabs-btn tabbed-view__tabs-btn--prev';
        this._prevBtn.addEventListener('click', () => this._scrollTabs(-1));

        this._nextBtn = document.createElement('button');
        this._nextBtn.type = 'button';
        this._nextBtn.className = 'tabbed-view__tabs-btn tabbed-view__tabs-btn--next';
        this._nextBtn.addEventListener('click', () => this._scrollTabs(1));

        this._tabsControls.appendChild(this._prevBtn);
        this._tabsControls.appendChild(this._nextBtn);

        this._tabsRail.appendChild(this._tabsScroll);
        this._tabsRail.appendChild(this._tabsControls);

        if (this.tabsOnlyControl) {
            this._tabsOnlyBtn = this._createTabsOnlyButton();
            this._tabsRow.appendChild(this._tabsOnlyBtn);
        }

        this._tabsRow.appendChild(this._tabsRail);

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'tabbed-view__content';
        this._contentEl.setAttribute('role', 'tabpanel');

        this._host.appendChild(this._tabsRow);
        this._host.appendChild(this._contentEl);

        this._applyOrientationLayout();
        this.mountContent(this._host);
        this._bindResizeWatchers();
        this._renderTabs();
        this._attachActiveView();
        this._applyTabsOnlyState();
        this._applyBaselineSizeConstraints('render');
    }

    /** Detach child view content and clear host references. */
    beforeDetach(): void {
        this._cancelTabDrag();
        // Detach all views when TabbedView itself is being detached
        this.views.forEach((view) => {
            if (view.container && view.container.parentElement) {
                view.detach();
            }
        });
        this._mountedView = null;
        this._host = null;
        this._tabsRow = null;
        this._tabsRail = null;
        this._tabsScroll = null;
        this._tabsEl = null;
        this._tabsControls = null;
        this._tabsOnlyBtn = null;
        this._tabsOnlyIcon = null;
        this._prevBtn = null;
        this._nextBtn = null;
        this._contentEl = null;
        this._savedSizeConstraints = null;
        this._tabsOnlyAppliedConstraints = null;
        if (this._tabsResizeObserver) {
            this._tabsResizeObserver.disconnect();
            this._tabsResizeObserver = null;
        }
        if (this._windowResizeHandler) {
            window.removeEventListener('resize', this._windowResizeHandler);
            this._windowResizeHandler = null;
        }
    }

    /**
     * Called when the view first receives non-zero size.
     * Performs initial tab layout calculations.
     * @param {{width: number, height: number}} size Initial content rect size
     * @override
     */
    onInitialSize(size: TabbedViewSize): void {
        super.onInitialSize(size);
        this._log('initial-size', size);
        this._updateScrollControls();
        const active = this.getActiveView();
        if (active && typeof active.onResize === 'function') {
            active.onResize(size);
        }
    }

    /**
     * Called on subsequent size changes after initial size is detected.
     * Updates tab scroll controls and propagates to active child.
     * @param {{width: number, height: number}} size New content rect size
     * @override
     */
    onResized(size: TabbedViewSize): void {
        super.onResized(size);
        this._log('resized', size);
        this._updateScrollControls();
        const active = this.getActiveView();
        if (active && typeof active.onResize === 'function') {
            active.onResize(size);
        }
    }

    /**
     * Propagate resize to the active view.
     * @param {object} payload Resize payload forwarded from parent containers.
     */
    onResize(payload: TabbedViewSize): void {
        super.onResize(payload);
        const active = this.getActiveView();
        if (active && typeof active.onResize === 'function') {
            active.onResize(payload);
        }
        this._updateScrollControls();
    }

    /** Propagate focus to the active view. */
    onFocus(): void {
        super.onFocus();
        const active = this.getActiveView();
        if (active && typeof active.onFocus === 'function') {
            active.onFocus();
        }
    }

    /** Render tab buttons to reflect current state. */
    _renderTabs(): void {
        if (!this._tabsEl) {
            return;
        }
        const isVertical = this._isVertical();
        this._tabsEl.setAttribute('aria-orientation', isVertical ? 'vertical' : 'horizontal');
        this._tabsEl.classList.toggle('tabbed-view__tabs--vertical', isVertical);
        this._tabsEl.replaceChildren();

        const controls = this._collectControls();
        const hasViews = this.views.length > 0;
        
        if (!hasViews && controls.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tabbed-view__empty';
            empty.textContent = 'No tabs available';
            this._tabsEl.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        const prependControls = controls.filter((control) => control.align === 'start');
        const appendControls = controls.filter((control) => control.align !== 'start');

        prependControls.forEach((control) => {
            const controlTab = this._renderControlTab(control, isVertical);
            if (controlTab) {
                fragment.appendChild(controlTab);
            }
        });

        if (hasViews) {
            this.views.forEach((view) => {
                const meta =
                    typeof view.getMetadata === 'function'
                        ? view.getMetadata()
                        : { id: view.id, title: view.title || 'View', icon: view.icon || null };
                const isActive = meta.id === this.activeId;

                const tab = document.createElement('div');
                tab.className = `tabbed-view__tab${isActive ? ' is-active' : ''}`;
                tab.classList.toggle('tabbed-view__tab--horizontal', !isVertical);
                tab.classList.toggle('tabbed-view__tab--vertical', isVertical);
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
                tab.setAttribute('tabindex', '0');
                tab.dataset.viewId = meta.id;
                const tabVariant =
                    typeof view.tabVariant === 'string' ? view.tabVariant.trim() : '';
                if (tabVariant) {
                    tab.dataset.tabVariant = tabVariant;
                }
                const isMovable = this.reorderable && this.isViewMovable(meta.id);
                tab.classList.toggle('tabbed-view__tab--draggable', isMovable);
                if (isMovable) {
                    tab.setAttribute('aria-roledescription', 'sortable tab');
                    tab.setAttribute(
                        'aria-keyshortcuts',
                        isVertical ? 'Alt+ArrowUp Alt+ArrowDown' : 'Alt+ArrowLeft Alt+ArrowRight'
                    );
                    tab.addEventListener('pointerdown', (event) =>
                        this._beginTabDrag(event, meta.id)
                    );
                }
                tab.addEventListener('click', () => this.selectView(meta.id));
                if (this.tabContextMenu) {
                    tab.setAttribute('aria-haspopup', 'menu');
                    tab.addEventListener('contextmenu', (event) =>
                        this._handleTabContextMenu(event, meta.id)
                    );
                }
                tab.addEventListener('keydown', (e) => {
                    if (this._handleTabContextMenuKeydown(e, meta.id)) {
                        return;
                    }
                    if (this._handleTabReorderKeydown(e, meta.id)) {
                        return;
                    }
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.selectView(meta.id);
                    }
                });

                if (meta.icon) {
                    tab.appendChild(
                        this._createIconElement(
                            meta.icon,
                            meta.title || 'Tab icon',
                            'tabbed-view__tab-icon-image'
                        )
                    );
                }

                const label = document.createElement('span');
                label.className = 'tabbed-view__tab-label';
                label.textContent = meta.title;
                label.classList.toggle('tabbed-view__tab-label--vertical', isVertical);
                label.dataset.rotation = isVertical ? String(this.tabLabelRotation) : '0';
                label.style.setProperty(
                    '--tab-label-rotation',
                    isVertical ? `${this.tabLabelRotation}deg` : '0deg'
                );
                // Double-click to rename tab
                label.addEventListener('dblclick', (event) => {
                    event.stopPropagation();
                    this.beginTabRename(meta.id);
                });
                tab.appendChild(label);

                const isClosable = this._isClosable(meta.id);
                if (isClosable) {
                    const close = document.createElement('img');
                    close.classList.add('tabbed-view__tab-close');
                    close.classList.add(
                        isVertical
                            ? 'tabbed-view__tab-close--vertical'
                            : 'tabbed-view__tab-close--horizontal'
                    );
                    close.title = 'Close tab';
                    close.alt = 'Close tab';
                    close.src = IconProvider.close;
                    close.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this.removeView(meta.id);
                    });
                    tab.appendChild(close);
                }

                fragment.appendChild(tab);
            });
        }

        appendControls.forEach((control) => {
            const controlTab = this._renderControlTab(control, isVertical);
            if (controlTab) {
                fragment.appendChild(controlTab);
            }
        });

        this._tabsEl.appendChild(fragment);

        this._applyTabsOnlyState();
        this._updateScrollControls();
        this._applyBaselineSizeConstraints('renderTabs');
    }

    /** Attach the active view into the content container. */
    _attachActiveView(): void {
        const target = this._findViewById(this.activeId) || this.views[0] || null;
        this._setMountedView(target);
    }

    /** Switch active view by hiding all containers and showing the target one. */
    _setMountedView(view: TabbedViewEntry | null): void {
        if (view && this._tabsOnlyActive) {
            this._restoreTabsOnly('active-view-change');
        }

        // Hide all view containers EXCEPT the one about to become active
        this.views.forEach((v) => {
            // Skip the view that's about to be shown
            if (v === view) {
                return;
            }
            
            if (!this._isPlaceholder(v) && v.container && v.container.parentElement) {
                v.container.style.display = 'none';
                
                // Notify view it's being hidden (if it supports visibility tracking)
                if (typeof v.applyVisibilityState === 'function') {
                    v.applyVisibilityState(false);
                }
            }
        });

        this._mountedView = view || null;
        this.activeId = view ? view.id : null;

        if (this._contentEl && view) {
            // Check if subclass wants to attach this view
            if (!this._shouldAttachView(view)) {
                this._log('view-attachment-skipped', { viewId: view.id });
                this._renderTabs();
                return;
            }
            
            // Attach view if not already attached
            if (!view.container || !view.container.parentElement) {
                // Create a dedicated container for this view
                const viewContainer = document.createElement('div');
                viewContainer.className = 'tabbed-view__view-container';
                viewContainer.style.width = '100%';
                viewContainer.style.height = '100%';
                this._contentEl.appendChild(viewContainer);
                view.attachTo(viewContainer);
            } else {
                // View already attached, just show its container
                view.container.style.display = '';
            }
            
            // Notify view it's now visible (triggers resize/render if needed)
            if (typeof view.applyVisibilityState === 'function') {
                view.applyVisibilityState(true);
            }
            
            // Trigger resize notification for newly visible view
            // This ensures canvas dimensions are recalculated after becoming visible
            if (this._container) {
                const { clientWidth, clientHeight } = this._container;
                if (clientWidth > 0 && clientHeight > 0) {
                    // Call legacy onResize if supported (backwards compatibility)
                    if (typeof view.onResize === 'function') {
                        view.onResize({ width: clientWidth, height: clientHeight });
                    }
                    // Also call onResized if supported (ViewBase hook)
                    if (typeof view.onResized === 'function') {
                        view.onResized({ width: clientWidth, height: clientHeight });
                    }
                }
            }
        }

        this._renderTabs();
        
        // Update TabbedView's constraints to match the active view
        this._updateConstraintsFromActiveView();
    }
    
    /**
     * Update this TabbedView's size constraints to match the active view's constraints.
     * This allows nested views (like NodePaletteView inside TabbedView) to propagate
     * their min/max size requirements to parent containers (like SplitView).
     * Called whenever the active view changes.
     */
    _updateConstraintsFromActiveView(): void {
        const activeView = this.getActiveView();
        
        if (!activeView || this._isPlaceholder(activeView)) {
            // No active view or it's a placeholder - clear constraints
            this._minWidth = null;
            this._maxWidth = null;
            this._minHeight = null;
            this._maxHeight = null;
            this._log('constraints-cleared', { reason: 'no-active-view' });
        } else {
            // Adopt the active view's constraints
            const changed = 
                this._minWidth !== activeView.minWidth ||
                this._maxWidth !== activeView.maxWidth ||
                this._minHeight !== activeView.minHeight ||
                this._maxHeight !== activeView.maxHeight;
            
            this._minWidth = activeView.minWidth;
            this._maxWidth = activeView.maxWidth;
            this._minHeight = activeView.minHeight;
            this._maxHeight = activeView.maxHeight;
            
            if (changed) {
                this._log('constraints-updated', {
                    viewId: activeView.id,
                    viewTitle: activeView.title,
                    minWidth: this._minWidth,
                    maxWidth: this._maxWidth,
                    minHeight: this._minHeight,
                    maxHeight: this._maxHeight
                });
            }
        }
        
        // Notify parent SplitView of the constraint change
        this._notifySplitViewConstraints();
    }

    /** Ensure there is an active id when tabs exist. */
    _ensureActiveId(): void {
        if (!this.views.length) {
            this.activeId = null;
            return;
        }
        if (!this.activeId || !this._findViewById(this.activeId)) {
            this.activeId = this.views[0].id;
        }
    }

    /**
     * Clamp a requested target index to the contiguous movable block around `fromIndex`.
     *
     * Moving is stepwise: the tab may only advance while the next tab is movable, so an immovable tab
     * acts as a wall in both directions. Returns `fromIndex` when no move is possible.
     *
     * @param {number} fromIndex - Current index of the tab being moved.
     * @param {number} toIndex - Requested final index.
     * @returns {number} Final index reachable without crossing an immovable tab.
     * @private
     */
    _clampMovableTargetIndex(fromIndex: number, toIndex: number): number {
        if (!Number.isInteger(toIndex) || this.views.length < 2) {
            return fromIndex;
        }

        const target = Math.min(Math.max(0, toIndex), this.views.length - 1);
        if (target === fromIndex) {
            return fromIndex;
        }

        const step = target > fromIndex ? 1 : -1;
        let index = fromIndex;
        while (index !== target) {
            const nextIndex = index + step;
            const nextView = this.views[nextIndex];
            if (!nextView || !this.isViewMovable(nextView.id)) {
                break;
            }
            index = nextIndex;
        }
        return index;
    }

    /** Resolve index from number, id string, or view instance. */
    _resolveIndex(target: TabbedViewEntry | string | number): number {
        if (typeof target === 'number') {
            return target;
        }
        if (typeof target === 'string') {
            return this.views.findIndex((view) => view.id === target);
        }
        return this.views.indexOf(target);
    }

    _resolveControlIndex(target: TabbedViewControl | string | number): number {
        if (typeof target === 'number') {
            return target;
        }
        if (typeof target === 'string') {
            return this.controls.findIndex((control) => control.id === target);
        }
        return this.controls.indexOf(target);
    }

    /** Find a view by id. */
    _findViewById(id: string | null): TabbedViewEntry | null {
        if (!id) {
            return null;
        }
        return this.views.find((view) => view.id === id) || null;
    }

    // ========================================
    // Hook Methods for Subclass Customization
    // ========================================

    /**
     * Hook: Validate and normalize a view object before adding to views array.
     * Subclasses override this to accept custom view formats (e.g., placeholders).
     * The hook should return a valid view object or throw an error if validation fails.
     * @param {*} view - View object to validate
     * @returns {ViewBase|object} Validated/normalized view object
     * @protected
     */
    _validateView(view: TabbedViewEntry): TabbedViewEntry {
        // Default: return view as-is (backward compatible)
        return view;
    }

    /**
     * Hook: Determine if a view object is a placeholder (not yet fully loaded).
     * Subclasses override this to mark lightweight placeholder objects in views array.
     * @param {*} _view - View object to check
     * @returns {boolean} True if this is a placeholder, false if it's a real ViewBase instance
     * @protected
     */
    _isPlaceholder(_view: TabbedViewEntry): boolean {
        // Default: all views are real ViewBase instances
        return false;
    }

    /**
     * Hook: Called when TabbedView needs a view but finds a placeholder or missing entry.
     * Subclasses override this to create/load the actual view instance on-demand.
     * @param {string} id - View ID that was requested
     * @param {*} existingPlaceholder - The placeholder object found (if any)
     * @returns {ViewBase|null} The loaded ViewBase instance, or null if cannot load
     * @protected
     */
    _onViewRequested(id: string, existingPlaceholder: TabbedViewEntry | null): TabbedViewEntry | null {
        // Default: return as-is (no lazy loading)
        return existingPlaceholder;
    }

    /**
     * Hook: Determine if a view should be attached to its container.
     * Subclasses override this to skip attachment for placeholders.
     * @param {*} _view - View to check
     * @returns {boolean} True to attach the view, false to skip
     * @protected
     */
    _shouldAttachView(_view: TabbedViewEntry): boolean {
        // Default: attach all views
        return true;
    }

    /**
     * Hook: Called after a view is successfully created/loaded.
     * Subclasses override this for bookkeeping (store in maps, subscribe to events, etc.).
     * @param {ViewBase} _view - The view that was created
     * @param {string} _id - The view's ID
     * @protected
     */
    _onViewCreated(_view: TabbedViewEntry, _id: string): void {
        // Default: no-op
    }

    /**
     * Hook: Called before a view is removed from the tab view.
     * Subclasses override this for cleanup (unsubscribe listeners, remove from maps, etc.).
     * @param {*} _view - The view being removed (could be ViewBase or placeholder)
     * @param {string} _id - The view's ID
     * @protected
     */
    _onViewRemoved(_view: TabbedViewEntry, _id: string): void {
        // Default: no-op
    }

    /**
     * Enable inline editing of a tab label.
     * @param {string} viewId - View ID to rename
     * @param {HTMLElement} labelElement - Label span element to convert to input
     * @private
     */
    _enableTabRename(viewId: string, labelElement: HTMLElement): void {
        const view = this._findViewById(viewId);
        if (!view) {
            return;
        }

        const originalText = labelElement.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalText;
        input.className = 'tabbed-view__tab-rename-input';
        
        // Style to match label
        input.style.width = `${Math.max(100, labelElement.offsetWidth)}px`;
        const computedStyle =
            typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
                ? window.getComputedStyle(labelElement)
                : null;
        if (computedStyle) {
            input.style.fontSize = computedStyle.fontSize;
            input.style.fontFamily = computedStyle.fontFamily;
        }
        
        // Replace label with input
        labelElement.replaceWith(input);
        input.focus();
        input.select();

        // Commit on Enter or blur
        const commit = () => {
            const newText = input.value.trim();
            if (newText && newText !== originalText) {
                this._commitTabRename(viewId, originalText, newText);
            }
            // Restore label regardless of whether rename succeeded
            input.replaceWith(labelElement);
        };

        // Cancel on Escape
        const cancel = () => {
            input.replaceWith(labelElement);
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                commit();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
            }
        });
    }

    /**
     * Emit 'tab-renamed' event for external validation and handling.
     * @param {string} viewId - View ID being renamed
     * @param {string} oldName - Previous name
     * @param {string} newName - New name to validate and apply
     * @private
     */
    _commitTabRename(viewId: string, oldName: string, newName: string): void {
        const view = this._findViewById(viewId);
        if (!view) {
            return;
        }

        const payload = new TabbedViewTabRenamedPayload({
            viewId,
            oldName,
            newName,
            accept: () => {
                // Default behavior: update view title
                view.title = newName;
                this._renderTabs();
            },
            reject: (reason) => {
                // External code can call reject() to prevent rename
                this._log('tab-rename-rejected', { viewId, newName, reason });
                this._renderTabs(); // Restore original label
            },
        });

        // Emit event for external validation (e.g., CollectionView checks uniqueness)
        this._emit('tab-renamed', payload);
    }

    /** Build the list of control tabs, including the optional tabs-only toggle. */
    _collectControls(): TabbedViewControl[] {
        const list = Array.isArray(this.controls) ? [...this.controls] : [];
        return list.filter((entry) => entry?.id !== this._tabsOnlyControlId);
    }

    _createTabsOnlyButton(): HTMLDivElement {
        const button = document.createElement('div');
        button.className = 'tabbed-view__tabs-toggle';
        button.title = this.tabsOnlyControlTitle;
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-label', this.tabsOnlyControlTitle);
        button.setAttribute('aria-pressed', 'false');
        const control: TabbedViewControl = {
            id: this._tabsOnlyControlId,
            icon: null,
            title: this.tabsOnlyControlTitle,
            align: 'end',
            toggles: true,
            showLabel: false,
        };
        button.addEventListener('click', (event) => this._handleControlClick(control, event));
        button.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                button.click();
            }
        });

        const icon = document.createElement('img');
        icon.className = 'tabbed-view__tabs-toggle-icon';
        icon.alt = this.tabsOnlyControlTitle;
        icon.src = IconProvider.arrowDropUp;
        this._tabsOnlyIcon = icon;
        this._updateTabsOnlyIconOrientation();
        button.appendChild(icon);

        return button;
    }

    /**
     * Build the icon element of a tab or control tab.
     *
     * Image sources (an inlined `data:` URI from `IconProvider.get()`, a served path, a URL)
     * become an `<img>`; anything else is a text/emoji glyph, so a registered icon can never
     * be printed as text. Called by `_renderTabs` for tab icons and by `_renderControlTab` for
     * control icons.
     * @param {string} value - Icon value from the view metadata or the control definition
     * @param {string} alt - Alt text for the image form
     * @param {string} imageClassName - Class of the image form (tab or control icon sizing)
     * @returns {HTMLElement} `<img>` for image sources, `<span>` for text glyphs
     * @private
     */
    _createIconElement(value: string, alt: string, imageClassName: string): HTMLElement {
        if (IconProvider.isImageSource(value)) {
            const image = document.createElement('img');
            image.src = value;
            image.alt = alt;
            image.className = imageClassName;
            return image;
        }

        const glyph = document.createElement('span');
        glyph.className = 'tabbed-view__tab-icon';
        glyph.textContent = value;
        return glyph;
    }

    /** Render a control tab button. */
    _renderControlTab(control: TabbedViewControl | null, isVertical: boolean): HTMLDivElement | null {
        if (!control) {
            return null;
        }
        const tab = document.createElement('div');
        tab.className = 'tabbed-view__tab tabbed-view__tab--control';
        tab.classList.toggle('tabbed-view__tab--horizontal', !isVertical);
        tab.classList.toggle('tabbed-view__tab--vertical', isVertical);
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '0');
        tab.setAttribute('aria-label', control.title || 'Control tab');
        tab.title = control.title || 'Control tab';
        tab.dataset.controlId = control.id;
        if (control.toggles) {
            tab.setAttribute('aria-pressed', this._tabsOnlyActive ? 'true' : 'false');
        }

        if (control.icon) {
            tab.appendChild(
                this._createIconElement(
                    control.icon,
                    control.title || 'Control',
                    'tabbed-view__control-icon'
                )
            );
        }

        if (control.showLabel !== false) {
            const label = document.createElement('span');
            label.className = 'tabbed-view__tab-label tabbed-view__tab-label--control';
            label.textContent = control.title || control.id || 'Control';
            label.classList.toggle('tabbed-view__tab-label--vertical', isVertical);
            label.dataset.rotation = isVertical ? String(this.tabLabelRotation) : '0';
            label.style.setProperty(
                '--tab-label-rotation',
                isVertical ? `${this.tabLabelRotation}deg` : '0deg'
            );
            tab.appendChild(label);
        }

        tab.addEventListener('click', (event) => this._handleControlClick(control, event));
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this._handleControlClick(control, e);
            }
        });
        return tab;
    }

    _handleControlClick(control: TabbedViewControl, event: Event): void {
        if (control.id === this._tabsOnlyControlId) {
            this._toggleTabsOnly();
        }
        const payload = new TabbedViewControlPayload({
            id: control.id,
            control,
            nativeEvent: event,
            tabbedView: this,
            tabsOnly: this._tabsOnlyActive,
        });

        this._emit('control', payload);
    }

    _toggleTabsOnly(): void {
        if (this._tabsOnlyActive) {
            this._restoreTabsOnly('toggle');
            return;
        }
        this._activateTabsOnly();
    }

    _activateTabsOnly(): void {
        this._applyTabsOnlyConstraints();
        this._tabsOnlyActive = true;
        this.requestSplitViewResize(SPLIT_VIEW_ACTIONS.minimize, {
            reason: 'tabs-only-control',
            controlId: this._tabsOnlyControlId,
        });
        this._applyTabsOnlyState();
    }

    _restoreTabsOnly(reason = 'restore'): boolean {
        if (!this._tabsOnlyActive) {
            return false;
        }
        this._tabsOnlyActive = false;
        this.requestSplitViewResize(
            SPLIT_VIEW_ACTIONS.previous as unknown as Parameters<ViewBase['requestSplitViewResize']>[0],
            {
            reason,
            controlId: this._tabsOnlyControlId,
            }
        );
        this._restoreSavedConstraints();
        this._tabsOnlyAppliedConstraints = null;
        this._applyTabsOnlyState();
        return true;
    }

    _applyTabsOnlyState(): void {
        if (this._host) {
            this._host.classList.toggle('tabbed-view--tabs-only', this._tabsOnlyActive);
        }
        if (this._contentEl) {
            if (this._tabsOnlyActive) {
                this._contentEl.setAttribute('aria-hidden', 'true');
                this._contentEl.style.display = 'none';
            } else {
                this._contentEl.removeAttribute('aria-hidden');
                this._contentEl.style.removeProperty('display');
            }
        }
        if (this._tabsOnlyBtn) {
            this._tabsOnlyBtn.classList.toggle('is-toggled', this._tabsOnlyActive);
            this._tabsOnlyBtn.setAttribute('aria-pressed', this._tabsOnlyActive ? 'true' : 'false');
            this._updateTabsOnlyIconOrientation();
        }
    }

    /** Scroll the tabs container left/right by a step. */
    _scrollTabs(direction: number): void {
        if (!this._tabsScroll) {
            return;
        }
        const isVertical = this._isVertical();
        const measure = isVertical ? this._tabsScroll.clientHeight : this._tabsScroll.clientWidth;
        const step = measure * 0.7;
        this._tabsScroll.scrollBy({
            left: isVertical ? 0 : direction * step,
            top: isVertical ? direction * step : 0,
            behavior: 'smooth',
        });
        // After the scroll completes, update controls; schedule a short delay.
        setTimeout(() => this._updateScrollControls(), 200);
    }

    /** Bind resize observers to update overflow controls when size changes. */
    _bindResizeWatchers(): void {
        if (typeof ResizeObserver !== 'undefined' && this._tabsScroll) {
            this._tabsResizeObserver = new ResizeObserver(() => this._updateScrollControls());
            this._tabsResizeObserver.observe(this._tabsScroll);
        }
        if (typeof window !== 'undefined') {
            this._windowResizeHandler = () => this._updateScrollControls();
            window.addEventListener('resize', this._windowResizeHandler);
        }
    }

    /** Update scroll controls visibility and disabled state. */
    _updateScrollControls(): void {
        if (!this._tabsScroll || !this._tabsControls) {
            return;
        }
        const isVertical = this._isVertical();
        const scrollableSize = isVertical
            ? this._tabsScroll.scrollHeight
            : this._tabsScroll.scrollWidth;
        const clientSize = isVertical
            ? this._tabsScroll.clientHeight
            : this._tabsScroll.clientWidth;
        const overflow = scrollableSize - clientSize > 0.5;
        this._tabsControls.style.display = overflow ? 'flex' : 'none';
        const prevBtn = this._prevBtn;
        const nextBtn = this._nextBtn;
        if (!overflow || !prevBtn || !nextBtn) {
            return;
        }
        const maxScroll = scrollableSize - clientSize;
        const current = isVertical ? this._tabsScroll.scrollTop : this._tabsScroll.scrollLeft;
        prevBtn.disabled = current <= 2;
        nextBtn.disabled = current >= maxScroll - 2;
    }

    /** Determine whether a given tab id is closable. */
    _isClosable(id: string): boolean {
        if (!id) {
            return false;
        }
        if (this._closableById.has(id)) {
            return Boolean(this._closableById.get(id));
        }
        return Boolean(this.closable);
    }

    /**
     * Public setter to change tab strip position at runtime.
     * @param {'top'|'bottom'|'left'|'right'} position Placement for the tab strip.
     * @param {number|null} [labelRotation=null] Optional explicit label rotation (multiples of 90 when vertical).
     */
    setTabPosition(position: TabPosition, labelRotation: number | null = null): void {
        const nextPosition = this._sanitizeTabPosition(position);
        const rotationInput =
            labelRotation !== null && labelRotation !== undefined
                ? labelRotation
                : this._isVertical(nextPosition) && !this._isVertical(this.tabPosition)
                  ? null
                  : this.tabLabelRotation;
        const nextRotation = this._computeLabelRotation(rotationInput, nextPosition);
        this.tabPosition = nextPosition;
        this.tabLabelRotation = nextRotation;
        this._applyOrientationLayout();
        if (this._tabsOnlyActive) {
            this._applyTabsOnlyConstraints();
        }
        this._renderTabs();
        this._updateScrollControls();
        this._applyBaselineSizeConstraints('tabPosition');
    }

    /**
     * Public setter to rotate tab labels (multiples of 90deg).
     * @param {number} [degrees=0] Rotation amount in degrees (rounded to nearest 90).
     */
    setTabLabelRotation(degrees = 0): void {
        const next = this._normalizeRotation(degrees);
        if (this.tabLabelRotation === next) {
            return;
        }
        this.tabLabelRotation = next;
        this._renderTabs();
        this._updateScrollControls();
    }

    /** Apply flex layout and ARIA tweaks based on tab position. */
    _applyOrientationLayout(): void {
        if (
            !this._host ||
            !this._tabsRow ||
            !this._tabsRail ||
            !this._tabsScroll ||
            !this._tabsEl ||
            !this._tabsControls
        ) {
            return;
        }
        const isVertical = this._isVertical();
        const orientation = this.tabPosition;

        const hostDirection =
            orientation === 'bottom'
                ? 'column-reverse'
                : orientation === 'left'
                  ? 'row'
                  : orientation === 'right'
                    ? 'row-reverse'
                    : 'column';
        this._host.classList.remove(
            'tabbed-view--pos-top',
            'tabbed-view--pos-bottom',
            'tabbed-view--pos-left',
            'tabbed-view--pos-right'
        );
        this._host.classList.add(`tabbed-view--pos-${orientation}`);
        this._host.style.flexDirection = hostDirection;

        this._tabsRow.classList.toggle('tabbed-view__tabs-row--vertical', isVertical);
        this._tabsRow.style.flexDirection = isVertical ? 'column' : 'row';
        this._tabsRow.style.height = isVertical ? '100%' : 'auto';
        this._tabsRow.style.width = isVertical ? 'auto' : '100%';

        this._tabsRail.classList.toggle('tabbed-view__tabs-rail--vertical', isVertical);
        this._tabsRail.style.flexDirection = isVertical ? 'column' : 'row';
        this._tabsRail.style.height = isVertical ? '100%' : 'auto';
        this._tabsRail.style.width = isVertical ? 'auto' : '100%';

        this._tabsScroll.classList.toggle('tabbed-view__tabs-scroll--vertical', isVertical);
        this._tabsScroll.style.overflowX = isVertical ? 'hidden' : 'auto';
        this._tabsScroll.style.overflowY = isVertical ? 'auto' : 'hidden';
        // this._tabsScroll.style.maskImage = isVertical
        //     ? 'linear-gradient(0deg, black 0%, black 88%, transparent 100%)'
        //     : 'linear-gradient(90deg, black 0%, black 88%, transparent 100%)';

        this._tabsEl.classList.toggle('tabbed-view__tabs--vertical', isVertical);
        this._tabsEl.setAttribute('aria-orientation', isVertical ? 'vertical' : 'horizontal');

        this._tabsControls.classList.toggle('tabbed-view__tabs-controls--vertical', isVertical);
        this._tabsControls.style.flexDirection = isVertical ? 'column' : 'row';

        if (this._prevBtn && this._nextBtn) {
            this._prevBtn.textContent = isVertical ? '▲' : '◀';
            this._nextBtn.textContent = isVertical ? '▼' : '▶';
            this._prevBtn.setAttribute(
                'aria-label',
                isVertical ? 'Scroll tabs up' : 'Scroll tabs left'
            );
            this._nextBtn.setAttribute(
                'aria-label',
                isVertical ? 'Scroll tabs down' : 'Scroll tabs right'
            );
        }

        if (this._tabsOnlyBtn) {
            this._tabsOnlyBtn.classList.toggle('tabbed-view__tabs-toggle--vertical', isVertical);
        }

        this._updateTabsOnlyIconOrientation();
    }

    _updateTabsOnlyIconOrientation(): void {
        if (!this._tabsOnlyIcon) {
            return;
        }
        const base = this._baseTabsOnlyRotation();
        const rotated = this._tabsOnlyActive ? base + 180 : base;
        const normalized = ((rotated % 360) + 360) % 360;
        this._tabsOnlyIcon.style.setProperty('--tabs-toggle-rotation', `${normalized}deg`);
    }

    _applyTabsOnlyConstraints(): void {
        if (!this._host || !this._tabsRow) {
            this._log('tabsOnly constraints skipped; no host/tabsRow');
            return;
        }
        if (!this._savedSizeConstraints) {
            this._savedSizeConstraints = {
                minWidth: this.minWidth,
                minHeight: this.minHeight,
                maxWidth: this.maxWidth,
                maxHeight: this.maxHeight,
            };
            this._log('tabsOnly constraints saved', this._savedSizeConstraints);
        }

        const applyExtent = (source = 'immediate') => {
            const extent = this._measureTabsExtent();
            if (!extent) {
                this._log('tabsOnly constraints skipped; extent missing', { source });
                return;
            }

            const isVertical = this._isVertical();
            // Add a buffer so max locks include pane padding/splitter gutter and avoid overlap.
            const bufferX = isVertical ? 0 : 6;
            const bufferY = isVertical ? 4 : 6;
            const padded = {
                width: Math.ceil(extent.width + bufferX),
                height: Math.ceil(extent.height + bufferY),
            };

            const minWidth = isVertical ? padded.width : null;
            const minHeight = isVertical ? null : padded.height;
            const maxWidth = minWidth;
            const maxHeight = minHeight;

            const previous = this._tabsOnlyAppliedConstraints;
            const unchanged =
                previous?.minWidth === minWidth &&
                previous?.minHeight === minHeight &&
                previous?.maxWidth === maxWidth &&
                previous?.maxHeight === maxHeight;
            if (unchanged) {
                return;
            }

            this._tabsOnlyAppliedConstraints = { minWidth, minHeight, maxWidth, maxHeight };
            this._log('tabsOnly constraints apply', {
                source,
                minWidth,
                minHeight,
                maxWidth,
                maxHeight,
                extent: padded,
            });
            this.setSizeConstraints({ minWidth, minHeight, maxWidth, maxHeight });
        };

        applyExtent('immediate');
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => applyExtent('animation-frame'));
        }
    }

    _restoreSavedConstraints(): void {
        if (!this._savedSizeConstraints) {
            this._log('tabsOnly constraints restore skipped; none saved');
            return;
        }
        this._log('tabsOnly constraints restore', this._savedSizeConstraints);
        this.setSizeConstraints(this._savedSizeConstraints);
        this._savedSizeConstraints = null;
    }

    _applyBaselineSizeConstraints(reason = 'baseline'): void {
        if (this._tabsOnlyActive) {
            return;
        }
        if (!this._host) {
            return;
        }
        const extent = this._measureTabsExtent();
        if (!extent) {
            this._log('baseline constraints skipped; extent missing', { reason });
            return;
        }
        const contentMin = 120;
        const isVertical = this._isVertical();
        const minWidth = isVertical ? extent.width + contentMin : contentMin;
        const minHeight = isVertical ? contentMin : extent.height + contentMin;
        this._log('baseline constraints apply', { reason, minWidth, minHeight, extent });
        this.setSizeConstraints({ minWidth, minHeight });
    }

    _measureTabsExtent(): { width: number; height: number } | null {
        const target = this._tabsRow || this._tabsRail || this._tabsEl;
        if (!target) {
            return null;
        }

        const rect = target.getBoundingClientRect();
        const widthCandidates = [rect?.width || 0, target.scrollWidth || 0];
        const heightCandidates = [rect?.height || 0, target.scrollHeight || 0];

        // Include the scroll container in case transforms (rotated labels) shrink the visual box.
        if (this._tabsScroll) {
            widthCandidates.push(this._tabsScroll.scrollWidth || 0);
            heightCandidates.push(this._tabsScroll.scrollHeight || 0);
        }

        const width = Math.max(...widthCandidates);
        const height = Math.max(...heightCandidates);
        if (!width && !height) {
            return null;
        }
        return { width: Math.ceil(width), height: Math.ceil(height) };
    }

    _baseTabsOnlyRotation(): number {
        switch (this.tabPosition) {
            case 'bottom':
                return 180;
            case 'left':
                return -90;
            case 'right':
                return 90;
            case 'top':
            default:
                return 0;
        }
    }

    _isVertical(position: TabPosition = this.tabPosition): boolean {
        return position === 'left' || position === 'right';
    }

    _sanitizeTabPosition(position: string): TabPosition {
        const allowed: TabPosition[] = ['top', 'bottom', 'left', 'right'];
        return allowed.includes(position as TabPosition) ? (position as TabPosition) : 'top';
    }

    _normalizeControls(list: TabbedViewControlInput[] = []): TabbedViewControl[] {
        if (!Array.isArray(list)) {
            return [];
        }
        return list.map((entry, index) => this._normalizeControl(entry, index)).filter(Boolean);
    }

    _normalizeControl(control: TabbedViewControlInput | null | undefined, index = 0): TabbedViewControl | null {
        if (!control || typeof control !== 'object') {
            return null;
        }
        const baseId = control.id || `control-${index}-${Math.random().toString(16).slice(2, 8)}`;
        return {
            id: String(baseId),
            icon: control.icon || null,
            title: control.title || 'Control',
            align: control.align === 'start' ? 'start' : 'end',
            toggles: Boolean(control.toggles),
            showLabel: control.showLabel !== false,
        };
    }

    _normalizeRotation(degrees: number): number {
        if (typeof degrees !== 'number' || Number.isNaN(degrees)) {
            return 0;
        }
        const steps = Math.round(degrees / 90);
        const normalized = ((steps % 4) + 4) % 4;
        return normalized * 90;
    }

    _defaultRotationFor(position: TabPosition): number {
        return this._isVertical(position) ? 90 : 0;
    }

    _computeLabelRotation(rotation: number | null, position: TabPosition): number {
        if (!this._isVertical(position)) {
            return 0;
        }
        if (rotation === null || rotation === undefined) {
            return this._defaultRotationFor(position);
        }
        return this._normalizeRotation(rotation);
    }
}
