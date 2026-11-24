import { ViewBase } from './view-base.js';
import { AppPayload, assertAppEventPayloadType } from '../core/app-event.js';
import {
    computePaneSpan,
    fillerFlexFactor,
    resolvePaneSizes,
    scaledFlexFactors,
    sizesToShares,
    type SplitViewPaneSpec,
} from './split-view-sizing.js';

type SplitViewDirection = 'horizontal' | 'vertical';
type SplitFlexDirection = 'row' | 'column';
type ViewBaseOptions = ConstructorParameters<typeof ViewBase>[0];

interface SplitViewOptions {
    orientation?: SplitViewDirection;
    minPaneSize?: number;
    gap?: number;
    contentInsetStart?: number;
    contentInsetTop?: number;
    contentInsetGuide?: boolean;
    views?: SplitViewChildView[];
    title?: string;
    icon?: string | null;
    id?: string | null;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
}

interface SplitViewDeserializeData {
    title?: string;
    icon?: string | null;
    id?: string | null;
    orientation?: SplitViewDirection | SplitFlexDirection;
    minPaneSize?: number;
    gap?: number;
    contentInsetStart?: number;
    contentInsetTop?: number;
    contentInsetGuide?: boolean;
    ratios?: number[];
    views?: unknown[];
}

interface SplitViewDeserializeContext {
    i18nService?: ViewBaseOptions extends { i18nService?: infer T } ? T : unknown;
    logger?: ViewBaseOptions extends { logger?: infer T } ? T : unknown;
}

interface SplitViewSerialized {
    type: 'SplitView';
    id: string;
    title: string;
    icon: string | null;
    orientation: SplitViewDirection;
    minPaneSize: number;
    gap: number;
    contentInsetStart: number;
    contentInsetTop: number;
    contentInsetGuide: boolean;
    ratios: number[];
    views: unknown[];
    [key: string]: unknown;
}

interface SplitViewChildView extends ViewBase {
    minWidth: number | null;
    minHeight: number | null;
    maxWidth: number | null;
    maxHeight: number | null;
}

/**
 * Direct pane child that can take part in a solo request. Structural contract: a view opts in
 * with the public `isCollapsible` marker plus the public collapse/expand API, so `SplitView`
 * never touches another class's private collapsed state.
 */
interface SplitViewCollapsibleChild extends SplitViewChildView {
    readonly isCollapsible: true;
    collapse(): void;
    expand(): void;
}

/**
 * Return true when a direct pane child advertises the collapsible solo contract.
 * @param {SplitViewChildView} view - Candidate pane child.
 * @returns {boolean} True when the child opts into solo handling.
 */
function isCollapsiblePaneChild(view: SplitViewChildView): view is SplitViewCollapsibleChild {
    const candidate = view as Partial<SplitViewCollapsibleChild>;
    return (
        candidate?.isCollapsible === true &&
        typeof candidate.collapse === 'function' &&
        typeof candidate.expand === 'function'
    );
}

interface SplitViewPaneConstraints {
    minWidth: number | null;
    minHeight: number | null;
    maxWidth: number | null;
    maxHeight: number | null;
}

interface SplitViewConstraintsDetail {
    min?: unknown;
    minSize?: unknown;
    minWidth?: unknown;
    minHeight?: unknown;
    max?: unknown;
    maxSize?: unknown;
    maxWidth?: unknown;
    maxHeight?: unknown;
}

interface SplitViewConstraintsResponseDetail extends SplitViewConstraintsDetail {
    hosted?: boolean;
    hostId?: string;
    viewId?: string | null;
    paneIndex?: number;
    handled?: boolean;
    constraints?: SplitViewPaneConstraints | null;
}

interface SplitViewMessageTargetEntry {
    target: EventTarget;
    index: number;
    resizeHandler: EventListener;
    queryHandler: EventListener;
    sizeConstraintsHandler: EventListener;
    soloHandler: EventListener;
}

interface SplitViewSoloRequestDetail {
    handled?: boolean;
    hosted?: boolean;
    hostId?: string;
    viewId?: string | null;
    paneIndex?: number;
    collapsedViewIds?: string[];
    [key: string]: unknown;
}

interface SplitViewResizeRequestDetail {
    action?: string;
    value?: unknown;
    reason?: string;
    handled?: boolean;
    hosted?: boolean;
    hostId?: string;
    viewId?: string | null;
    paneIndex?: number;
    [key: string]: unknown;
}

interface SplitViewHostDetail {
    hosted?: boolean;
    hostId?: string;
    viewId?: string | null;
    paneIndex?: number;
    orientation?: SplitViewDirection;
    count?: number;
    handled?: boolean;
}

interface SplitViewLayoutChangePayloadParams {
    source: string;
    viewId: string | null;
    ratios: number[];
    count: number;
    orientation: SplitViewDirection;
}

interface SplitViewSize {
    width: number;
    height: number;
}

interface SplitViewPaneElement extends HTMLDivElement {
    _splitViewChannel?: EventTarget;
}

interface SplitViewSplitterElement extends HTMLDivElement {
    _splitViewDragHandler?: ((event: PointerEvent) => void) | null;
}

function asFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonNegativeFiniteNumber(value: unknown): number | null {
    const numeric = asFiniteNumber(value);
    return numeric !== null && numeric >= 0 ? numeric : null;
}

/**
 * Payload for `layoutChange` events emitted by SplitView.
 */
class SplitViewLayoutChangePayload extends AppPayload {
    source: string;
    viewId: string | null;
    ratios: number[];
    count: number;
    orientation: SplitViewDirection;

    /**
    * @param {object} params - Aggregated payload members for layout-change events.
    * @param {string} params.source - Trigger source that initiated the layout change.
    * @param {string|null} params.viewId - Related view ID when a specific pane triggered the change.
    * @param {number[]} params.ratios - Current normalized pane ratios after update.
    * @param {number} params.count - Current number of panes in the split view.
    * @param {'horizontal'|'vertical'} params.orientation - Split orientation used for layout.
     */
    constructor({ source, viewId, ratios, count, orientation }: SplitViewLayoutChangePayloadParams) {
        super('SplitView.LayoutChange.v1');
        this.source = source;
        this.viewId = viewId;
        this.ratios = ratios;
        this.count = count;
        this.orientation = orientation;
    }
}

/** Event names used by SplitView's per-pane message channel. */
export const SPLIT_VIEW_EVENTS = {
    /** Child view asks its hosting SplitView to resize/collapse. */
    resizeRequest: 'splitview:resize-request',
    /** Child view queries whether it is hosted within a SplitView and receives metadata. */
    queryHost: 'splitview:query-host',
    /** Child view communicates size constraints (min-only) to its hosting SplitView. */
    sizeConstraints: 'splitview:size-constraints',
    /** Child collapsible pane asks to become the only expanded collapsible pane. */
    soloRequest: 'splitview:solo-request',
} as const;

/** Standard resize actions that a child view may request from its parent SplitView. */
export const SPLIT_VIEW_ACTIONS = {
    /** Remove the requesting view's pane (fails when only one pane remains). */
    collapse: 'collapse',
    /** Expand the requesting pane while shrinking siblings to their minimum share. */
    maximize: 'maximize',
    /** Shrink the requesting pane to its minimum share while preserving siblings. */
    minimize: 'minimize',
    /** Restore ratios to the state before the last minimize/maximize action. */
    previous: 'previous',
    /** Set the requesting pane to a relative size between its min and max allowable share. */
    relative: 'relative',
} as const;

/**
 * SplitView composes multiple ViewBase children into resizable panes and exposes a
 * per-pane EventTarget so children can send layout messages to the parent.
 *
 * Child message contract:
 * - Events are dispatched on the pane's `_splitViewChannel` with `CustomEvent.detail`.
 * - `SPLIT_VIEW_EVENTS.queryHost`: detail returns
 *   `{ hosted, hostId, viewId, paneIndex, orientation, count }`.
 * - `SPLIT_VIEW_EVENTS.resizeRequest`: detail expects `action` of `SPLIT_VIEW_ACTIONS` and
 *   responds with `{ handled, reason?, hostId, viewId, paneIndex }` while mutating ratios.
 *   The `relative` action expects `detail.value` between 0 and 1 (0 = minimum share, 1 =
 *   maximum share when all siblings shrink to their minimum).
 * - `SPLIT_VIEW_EVENTS.sizeConstraints`: detail may provide `minWidth`/`minHeight`/`minSize`
 *   and `maxWidth`/`maxHeight`/`maxSize` to declare per-pane limits. Min==max locks pane size
 *   along the resize axis and disables its adjacent splitter.
 * - `SPLIT_VIEW_EVENTS.soloRequest`: direct collapsible children ask to become the only expanded
 *   pane. The host expands the requester and collapses every other direct child that advertises
 *   `isCollapsible` (public marker plus `collapse()`/`expand()`), then reports
 *   `{ handled, hosted, hostId, viewId, paneIndex, collapsedViewIds }`. Non-collapsible panes
 *   (and collapsibles nested deeper than the pane) are left untouched, and `sizeToContent` caps
 *   keep applying to the expanded pane.
 *
 * Layout behavior:
 * - Splitters auto-disable when either neighboring pane is fixed (min == max for the axis).
 * - Minimums scale down proportionally when their sum exceeds the host; a filler pane absorbs the
 *   residual ratio when every pane has a finite max and the container is larger than the total.
 * - Ratio changes clamp to min/max constraints, capture a baseline for `previous`, and reuse
 *   the per-pane EventTarget so children can keep sending resize/constraint updates.
 *
 * CSS hooks:
 * - split-view: host flex container for the entire split layout.
 * - split-view__pane: child pane container wrapping each ViewBase content.
 * - split-view__splitter: draggable separator inserted between adjacent panes.
 *
 * The optional `contentInsetStart` insets the panes from the host's leading edge (logical
 * inline-start) without moving the host itself, so an embedded split can be indented under a
 * surrounding section header. It is published to CSS as `--split-inset-start`, which
 * `split-view.css` applies as `padding-inline-start`.
 *
 * `contentInsetTop` does the same for the block-start edge: it is published as
 * `--split-inset-top` and applied as `padding-block-start`, so the first pane is separated from a
 * header rendered directly above the split.
 *
 * The optional `contentInsetGuide` draws a vertical guide line in the leading inset gutter
 * (from `contentInsetTop` to the host's block end), so the indented panes read as children of the
 * section header above the split. It is published to CSS as the `split-view--inset-guide` class
 * and is only meaningful together with a non-zero `contentInsetStart`.
 *
 * Emitted Events:
 * - `layoutChange` -> `payloadTypeId: SplitView.LayoutChange.v1` -> `SplitViewLayoutChangePayload`
 *
 */
export class SplitView extends ViewBase {
    orientation: SplitFlexDirection;
    minPaneSize: number;
    gap: number;
    /** Leading pane inset in px, applied to the host as `--split-inset-start`. */
    contentInsetStart: number;
    /** Block-start pane inset in px, applied to the host as `--split-inset-top`. */
    contentInsetTop: number;
    /** Draw a vertical guide in the leading inset gutter, published as `split-view--inset-guide`. */
    contentInsetGuide: boolean;
    views: SplitViewChildView[];

    _ratios: number[];
    _host: HTMLDivElement | null;
    _panes: SplitViewPaneElement[];
    _splitters: SplitViewSplitterElement[];
    _filler: HTMLDivElement | null;
    _messageTargets: Map<SplitViewChildView, SplitViewMessageTargetEntry>;
    _previousRatios: number[] | null;
    _paneConstraints: Map<SplitViewChildView, SplitViewPaneConstraints>;
    _desiredSizeUnsubscribers: Map<SplitViewChildView, () => void>;

    /**
     * Create a SplitView container with optional initial children and sizing defaults.
     * @param {object} options
     * @param {'horizontal'|'vertical'} [options.orientation='horizontal'] Flex direction for panes.
     * @param {number} [options.minPaneSize=120] Minimum pixel size for any pane.
     * @param {number} [options.gap=12] Gap size between panes.
     * @param {number} [options.contentInsetStart=0] Leading pane inset in px; indents the panes
     *   from the host's inline-start edge without moving the host itself.
     * @param {number} [options.contentInsetTop=0] Block-start pane inset in px; pushes the panes
     *   down from the host's block-start edge without moving the host itself.
     * @param {boolean} [options.contentInsetGuide=false] Draw a vertical guide line in the leading
     *   inset gutter so the indented panes read as children of the section header above.
     * @param {ViewBase[]} [options.views=[]] Optional child views to attach immediately.
     * @param {string} [options.title='Split View'] Display title metadata.
     * @param {string|null} [options.icon=null] Optional icon metadata.
     * @param {string|null} [options.id=null] Explicit identifier; autogenerated if omitted.
     * @param {Function|null} [options.logger=null] Optional logger function.
     * @param {object|null} [options.i18nService=null] Optional I18nService instance for translations.
     */
    constructor({
        orientation = 'horizontal',
        minPaneSize = 120,
        gap = 0,
        contentInsetStart = 0,
        contentInsetTop = 0,
        contentInsetGuide = false,
        views = [],
        title = 'Split View',
        icon = null,
        id = null,
        logger = null,
        i18nService = null,
    }: SplitViewOptions = {}) {
        super({ title, icon, id, logger, i18nService });
        this.orientation = orientation === 'vertical' ? 'column' : 'row';
        this.minPaneSize = minPaneSize;
        this.gap = gap;
        this.contentInsetStart = Number.isFinite(contentInsetStart)
            ? Math.max(0, contentInsetStart as number)
            : 0;
        this.contentInsetTop = Number.isFinite(contentInsetTop)
            ? Math.max(0, contentInsetTop as number)
            : 0;
        this.contentInsetGuide = Boolean(contentInsetGuide);
        this.views = [];
        this._ratios = [];
        this._host = null;
        this._panes = [];
        this._splitters = [];
        this._filler = null;
        this._messageTargets = new Map();
        this._previousRatios = null;
        this._paneConstraints = new Map();
        this._desiredSizeUnsubscribers = new Map();
        if (views.length) {
            this.setViews(views);
        }
    }

    /**
     * Serialize split view settings and child layout into a JSON-friendly object.
     * @returns {{
     *   type: string,
     *   id: string,
     *   title: string,
     *   icon: string|null,
     *   orientation: 'horizontal'|'vertical',
     *   minPaneSize: number,
     *   gap: number,
     *   contentInsetStart: number,
     *   contentInsetTop: number,
     *   contentInsetGuide: boolean,
     *   ratios: number[],
     *   views: object[]
     * }}
     */
    serialize(): SplitViewSerialized {
        const orientation = this.orientation === 'column' ? 'vertical' : 'horizontal';
        return {
            ...super.serialize(),
            type: 'SplitView',
            orientation,
            minPaneSize: this.minPaneSize,
            gap: this.gap,
            contentInsetStart: this.contentInsetStart,
            contentInsetTop: this.contentInsetTop,
            contentInsetGuide: this.contentInsetGuide,
            ratios: [...this._ratios],
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
     * Deserialize a SplitView, restoring layout, ratios, and children.
     * @param {object} data Serialized split view data.
     * @param {Function} [viewFactory=ViewBase.deserialize] Factory to rehydrate child views.
     * @param {object} [context={}] Context object with i18nService and logger.
     * @returns {SplitView}
     */
    static deserialize(
        data: SplitViewDeserializeData = {},
        viewFactory: ((entry: unknown) => SplitViewChildView) | null =
            ViewBase.deserialize as (entry: unknown) => SplitViewChildView,
        context: SplitViewDeserializeContext = {}
    ): SplitView {
        const {
            title = 'Split View',
            icon = null,
            id = null,
            orientation = 'horizontal',
            minPaneSize = 120,
            gap = 12,
            contentInsetStart = 0,
            contentInsetTop = 0,
            contentInsetGuide = false,
            ratios = [],
            views = [],
        } = data;

        const { i18nService = null, logger = null } = context;

        const normalizedOrientation =
            orientation === 'vertical' || orientation === 'column' ? 'vertical' : 'horizontal';

        const instance = new SplitView({
            title,
            icon,
            id,
            orientation: normalizedOrientation,
            minPaneSize,
            gap,
            contentInsetStart,
            contentInsetTop,
            contentInsetGuide,
            logger,
            i18nService,
        });

        const makeView =
            typeof viewFactory === 'function'
                ? viewFactory
                : (ViewBase.deserialize as (entry: unknown) => SplitViewChildView);
        const children = Array.isArray(views) ? views.map((entry) => makeView(entry)) : [];
        instance._ratios = Array.isArray(ratios) ? [...ratios] : [];
        if (children.length) {
            instance.setViews(children);
        }
        return instance;
    }

    /**
     * Replace all child views and rebuild panes.
     * @param {ViewBase[]} views Ordered child views; must contain at least one entry.
     */
    setViews(views: SplitViewChildView[]): void {
        if (!Array.isArray(views) || views.length === 0) {
            throw new Error('SplitView.setViews requires at least one view.');
        }
        this.views.forEach((view) => view.detach());
        this._pruneMessageTargets(views);
        this.views = views;
        this._ratios = this._normalizeRatios(views.length, this._ratios);
        this._previousRatios = null;
        this._log('setViews', {
            count: views.length,
            ids: views.map((view) =>
                typeof view.getMetadata === 'function' ? view.getMetadata().id : view.id
            ),
        });
        this._renderChildren('setViews');
    }

    /**
     * Insert a view at the given index and rebalance ratios.
     * @param {ViewBase} view Child view to insert.
     * @param {number} [index] Target index (defaults to append).
     * @returns {ViewBase} The inserted view.
     */
    addView(view: SplitViewChildView, index: number = this.views.length): SplitViewChildView {
        if (!view || typeof view.attachTo !== 'function') {
            throw new Error('SplitView.addView requires a ViewBase instance.');
        }

        if (this.views.length === 0) {
            this.setViews([view]);
            return view;
        }

        const insertAt = Math.min(Math.max(0, index), this.views.length);
        const newShare = 1 / (this.views.length + 1);
        const scaledRatios = this._ratios.map((ratio) => ratio * (1 - newShare));
        this._ratios = [
            ...scaledRatios.slice(0, insertAt),
            newShare,
            ...scaledRatios.slice(insertAt),
        ];
        this.views.splice(insertAt, 0, view);
        this._previousRatios = null;
        this._renderChildren('add', view.id);
        return view;
    }

    /**
     * Remove a view (by reference or index) while keeping at least one pane.
     * @param {ViewBase|number} target View instance or index.
     * @returns {ViewBase|null} The removed view or null if not removed.
     */
    removeView(target: SplitViewChildView | number): SplitViewChildView | null {
        if (this.views.length <= 1) {
            this._log('removeView skipped; at least one pane required');
            return null;
        }

        const index = typeof target === 'number' ? target : this.views.indexOf(target);
        if (index < 0 || index >= this.views.length) {
            return null;
        }

        const [removed] = this.views.splice(index, 1);
        this._ratios.splice(index, 1);
        const remainingTotal = this._ratios.reduce((acc, value) => acc + value, 0);
        this._ratios =
            remainingTotal > 0
                ? this._ratios.map((ratio) => ratio / remainingTotal)
                : this._normalizeRatios(this.views.length, []);

        this._teardownMessageTarget(removed);
        removed.detach();
        this._previousRatios = null;
        this._renderChildren('remove', removed?.id);
        return removed;
    }

    /**
     * Create the host container and render child panes.
     * @param {HTMLElement} container Host element provided by parent container.
     */
    render(container: HTMLElement): void {
        void container;
        this._host = document.createElement('div');
        this._host.className = 'split-view';
        this._host.style.flexDirection = this.orientation;
        if (this.gap !== 0) {
            this._host.style.setProperty('--split-gap', `${this.gap}px`);
        }
        if (this.contentInsetStart > 0) {
            this._host.style.setProperty('--split-inset-start', `${this.contentInsetStart}px`);
        }
        if (this.contentInsetTop > 0) {
            this._host.style.setProperty('--split-inset-top', `${this.contentInsetTop}px`);
        }
        this._host.classList.toggle('split-view--inset-guide', this.contentInsetGuide);
        this.mountContent(this._host);
        this._renderChildren('render');
    }

    /** Render panes and splitters based on current views and ratios. */
    _renderChildren(reason = 'render', viewId: string | null = null): void {
        if (!this._host) {
            return;
        }
        this._host.replaceChildren();
        this._panes = [];
        this._splitters = [];
        this._filler = null;

        this._log('_renderChildren called', {
            reason,
            viewId,
            currentRatios: this._ratios,
            viewCount: this.views.length,
            orientation: this.orientation,
        });

        const ratios = this._normalizeRatios(this.views.length, this._ratios);
        this._ratios = ratios;
        const flexScale = this._flexGrowScale();

        this._log('_renderChildren: applying ratios', { ratios, flexScale });

        this.views.forEach((view, index) => {
            const pane = document.createElement('div');
            pane.className = 'split-view__pane';
            pane.style.flexGrow = String(ratios[index] * flexScale);
            pane.style.flexShrink = '1';
            pane.style.flexBasis = '0';
            pane.style.minWidth = `${this.minPaneSize}px`;
            pane.style.minHeight = `${this.minPaneSize}px`;
            pane.dataset.index = String(index);

            this._log(`_renderChildren: pane ${index}`, {
                ratio: ratios[index],
                flexGrow: ratios[index] * flexScale,
                viewId: view?.id,
                viewTitle: view?.title,
            });

            this._host.appendChild(pane);
            this._panes.push(pane);
            this._ensureMessageTarget(view, index, pane);
            this._applyPaneConstraints(index, pane);
            view.attachTo(pane);

            if (index < this.views.length - 1) {
                // A splitter is movable when there is a flexible pane on each side; collapsed
                // (fixed) panes keep their size but do not lock the adjacent splitters.
                const movable =
                    this._hasFlexiblePane(0, index) &&
                    this._hasFlexiblePane(index + 1, this.views.length - 1);
                const disableSplitter = !movable;
                const inactiveSplitter = !movable;

                if (!movable) {
                    this._log('Creating inactive splitter', { index });
                }

                const splitter = this._createSplitter(index, disableSplitter, inactiveSplitter);
                this._splitters.push(splitter);
                this._host.appendChild(splitter);
            }
        });

        // Attaching a pane publishes its height constraints, which can already recalculate
        // `_ratios` mid-loop (and only over the panes created so far). Re-applying the final ratios
        // here keeps every pane's flex factor in step with them instead of the pre-attach snapshot,
        // which would otherwise leave the split under-filled once the caps kick in.
        this._applyRatios();

        this._emitLayoutChange(reason, viewId);
    }

    /** Detach all child views and clear host references. */
    beforeDetach(): void {
        super.beforeDetach(); // ViewBase cleans up ResizeObserver
        // Only detach DOM bindings; keep child list and ratios intact for re-attachment.
        this.views.forEach((view) => view.detach());
        this._host = null;
        this._panes = [];
        this._splitters = [];
    }

    /**
     * Propagate resize events to all child views.
     * @param {object} payload Resize data (shape defined by caller).
     */
    onResize(payload: unknown): void {
        super.onResize(payload as SplitViewSize);
        this._panes.forEach((_, index) => this._applyPaneConstraints(index));
        this.views.forEach((view) => {
            view.onResize(payload as SplitViewSize);
        });
    }

    /** Emit a layout change event for diagnostics. */
    _emitLayoutChange(source = 'render', viewId: string | null = null): void {
        const payload = new SplitViewLayoutChangePayload({
            source,
            viewId,
            ratios: [...this._ratios],
            count: this.views.length,
            orientation: this.orientation === 'row' ? 'horizontal' : 'vertical',
        });
        this._emit('layoutChange', payload);
        this._log('layoutChange', payload);
    }

    _pruneMessageTargets(nextViews: SplitViewChildView[] = []): void {
        const keep = new Set(nextViews);
        this._messageTargets.forEach((entry, view) => {
            if (!keep.has(view)) {
                this._teardownMessageTarget(view);
            }
        });
    }

    /** Remove listeners and cached channel for a detached child view. */
    _teardownMessageTarget(view: SplitViewChildView): void {
        const entry = this._messageTargets.get(view);
        if (!entry) {
            return;
        }
        entry.target.removeEventListener(SPLIT_VIEW_EVENTS.resizeRequest, entry.resizeHandler);
        entry.target.removeEventListener(SPLIT_VIEW_EVENTS.queryHost, entry.queryHandler);
        entry.target.removeEventListener(
            SPLIT_VIEW_EVENTS.sizeConstraints,
            entry.sizeConstraintsHandler
        );
        entry.target.removeEventListener(SPLIT_VIEW_EVENTS.soloRequest, entry.soloHandler);
        this._messageTargets.delete(view);
        this._paneConstraints.delete(view);
        
        // Unsubscribe from desired size events
        const unsub = this._desiredSizeUnsubscribers.get(view);
        if (unsub) {
            unsub();
            this._desiredSizeUnsubscribers.delete(view);
        }
    }

    /** Ensure a dedicated EventTarget exists for a child view and bind it to the pane host. */
    _ensureMessageTarget(
        view: SplitViewChildView,
        paneIndex: number,
        pane: SplitViewPaneElement | null = null
    ): EventTarget {
        let entry = this._messageTargets.get(view);
        if (!entry) {
            const target = new EventTarget();
            entry = {
                target,
                index: paneIndex,
                resizeHandler: () => undefined,
                queryHandler: () => undefined,
                sizeConstraintsHandler: () => undefined,
                soloHandler: () => undefined,
            };
            entry.resizeHandler = (event: Event) =>
                this._handleResizeRequest(view, entry.index, event as CustomEvent<SplitViewResizeRequestDetail>);
            entry.queryHandler = (event: Event) =>
                this._handleHostQuery(view, entry.index, event as CustomEvent<SplitViewHostDetail>);
            entry.sizeConstraintsHandler = (event) =>
                this._handleSizeConstraints(
                    view,
                    entry.index,
                    event as CustomEvent<SplitViewConstraintsResponseDetail>
                );
            entry.soloHandler = (event: Event) =>
                this._handleSoloRequest(view, entry.index, event as CustomEvent<SplitViewSoloRequestDetail>);
            target.addEventListener(SPLIT_VIEW_EVENTS.resizeRequest, entry.resizeHandler);
            target.addEventListener(SPLIT_VIEW_EVENTS.queryHost, entry.queryHandler);
            target.addEventListener(
                SPLIT_VIEW_EVENTS.sizeConstraints,
                entry.sizeConstraintsHandler
            );
            target.addEventListener(SPLIT_VIEW_EVENTS.soloRequest, entry.soloHandler);
            this._messageTargets.set(view, entry);
            
            // Subscribe to desired size events from the child view
            const unsub = view.on('desiredSize', (event: unknown) =>
                this._handleDesiredSize(view, paneIndex, event)
            );
            this._desiredSizeUnsubscribers.set(view, unsub);
        } else {
            entry.index = paneIndex;
        }

        const hostPane = pane || this._panes[paneIndex];
        if (hostPane) {
            hostPane._splitViewChannel = entry.target;
        }
        return entry.target;
    }

    /** Respond to a child host query with SplitView metadata. */
    _handleHostQuery(
        view: SplitViewChildView,
        paneIndex: number,
        event: CustomEvent<SplitViewHostDetail>
    ): void {
        const detail = event?.detail || {};
        detail.hosted = true;
        detail.hostId = this.id;
        detail.viewId = view?.id ?? null;
        detail.paneIndex = paneIndex;
        detail.orientation = this.orientation === 'row' ? 'horizontal' : 'vertical';
        detail.count = this.views.length;
        detail.handled = true;
    }

    /** Apply child-reported size constraints to the pane and update cached minima. */
    _handleSizeConstraints(
        view: SplitViewChildView,
        paneIndex: number,
        event: CustomEvent<SplitViewConstraintsResponseDetail>
    ): void {
        const detail = event?.detail || {};
        detail.hosted = true;
        detail.hostId = this.id;
        detail.viewId = view?.id ?? null;
        detail.paneIndex = paneIndex;

        const wasFixed = this._isPaneFixed(paneIndex);
        const constraints = this._normalizeConstraints(detail);
        
        // null constraints means "clear all constraints" - this is valid
        if (constraints === null) {
            this._paneConstraints.delete(view);
        } else {
            this._paneConstraints.set(view, constraints);
        }
        
        this._applyPaneConstraints(paneIndex);
        this._updateSplitterStates();

        // Recalculate ratios now that we have constraints and potentially have size
        const available = this._availableSpan();
        if (available > 0 && this._panes?.length) {
            if (wasFixed && !this._isPaneFixed(paneIndex) && !this._hasAnyConstrainedPane()) {
                // The last fixed/constrained pane was just released (e.g. an
                // initially-collapsed section expanded). Rebalance the flexible
                // panes so the released pane regains a share instead of keeping
                // the tiny ratio it held while fixed to its header height.
                this._rebalanceFlexiblePanes(view?.id ?? null);
            } else {
                this._recalculateRatiosWithSpace();
            }
        }

        detail.handled = true;
        detail.constraints = constraints;
        this._emitLayoutChange('constraints', view?.id ?? null);
    }

    /**
     * Handle desired size change from a child view.
     * Try to resize the pane to honor the requested size while respecting constraints.
     * @param {ViewBase} view Child view that emitted the desired size
     * @param {number} paneIndex Index of the pane
     * @param {import('../core/app-event.js').AppEvent} event Desired size event envelope.
     */
    _handleDesiredSize(view: SplitViewChildView, paneIndex: number, event: unknown): void {
        const desiredSizeEvent = assertAppEventPayloadType(
            event,
            'ViewBase.DesiredSize.v1',
            'SplitView desiredSize listener'
        );

        const width = desiredSizeEvent.detail.width;
        const height = desiredSizeEvent.detail.height;
        if (!(width === null || Number.isFinite(width))) {
            throw new TypeError(
                'SplitView desiredSize listener: invalid detail field \"width\" (number|null expected)'
            );
        }
        if (!(height === null || Number.isFinite(height))) {
            throw new TypeError(
                'SplitView desiredSize listener: invalid detail field \"height\" (number|null expected)'
            );
        }

        const desiredSizePayload = desiredSizeEvent.detail;
        const desiredSize =
            this.orientation === 'row' ? desiredSizePayload.width : desiredSizePayload.height;
        const numericDesiredSize = asFiniteNumber(desiredSize);
        
        if (numericDesiredSize === null || numericDesiredSize <= 0) {
            // Desired size cleared or invalid - nothing to do
            return;
        }

        // Get constraints for this pane
        const constraints = this._paneConstraints.get(view);
        const minSize = this.orientation === 'row' 
            ? (constraints?.minWidth ?? this.minPaneSize)
            : (constraints?.minHeight ?? this.minPaneSize);
        const maxSize = this.orientation === 'row'
            ? (constraints?.maxWidth ?? null)
            : (constraints?.maxHeight ?? null);

        // Clamp desired size to constraints
        let targetSize = Math.max(numericDesiredSize, minSize);
        if (maxSize !== null) {
            targetSize = Math.min(targetSize, maxSize);
        }

        const available = this._availableSpan();
        if (available <= 0) {
            return;
        }

        // Calculate target share (ratio)
        const targetShare = targetSize / available;
        
        // Use _applyTargetShare to set the size
        this._applyTargetShare(paneIndex, targetShare, 'desiredSize');
    }

    /** Process a child resize action request and mutate layout when possible. */
    _handleResizeRequest(
        view: SplitViewChildView,
        paneIndex: number,
        event: CustomEvent<SplitViewResizeRequestDetail>
    ): void {
        const detail = event?.detail || {};
        detail.hosted = true;
        detail.hostId = this.id;
        detail.viewId = view?.id ?? null;
        detail.paneIndex = paneIndex;

        this._syncConstraintsFromView(view);
        this._applyPaneConstraints(paneIndex);

        switch (detail.action) {
            case SPLIT_VIEW_ACTIONS.collapse: {
                const removed = this.removeView(view);
                detail.handled = Boolean(removed);
                detail.reason = detail.handled ? undefined : 'at-least-one-pane-required';
                break;
            }
            case SPLIT_VIEW_ACTIONS.maximize:
                detail.handled = this._applyMaximize(paneIndex);
                if (!detail.handled) {
                    detail.reason = 'maximize-failed';
                }
                break;
            case SPLIT_VIEW_ACTIONS.minimize:
                detail.handled = this._applyMinimize(paneIndex);
                if (!detail.handled) {
                    detail.reason = 'minimize-failed';
                }
                break;
            case SPLIT_VIEW_ACTIONS.previous:
                detail.handled = this._restorePreviousRatios(paneIndex);
                if (!detail.handled) {
                    detail.reason = 'no-previous-state';
                }
                break;
            case SPLIT_VIEW_ACTIONS.relative:
                detail.handled = this._applyRelative(paneIndex, detail.value);
                if (!detail.handled) {
                    detail.reason = detail.reason || 'relative-invalid';
                }
                break;
            default:
                detail.handled = false;
                detail.reason = 'unknown-action';
                break;
        }
    }

    /**
     * Process a solo request from a direct collapsible pane: expand the requester, then collapse
     * every other direct child that advertises the collapsible solo contract.
     *
     * Only direct children are touched, so collapsibles nested inside another child view (or a
     * nested SplitView) keep their own state, and non-collapsible panes such as a `DummyView` or
     * a `TabbedView` are left alone. Each `collapse()` publishes height constraints through the
     * documented `size-constraints` path, which frees the space for the requester.
     * @param {SplitViewChildView} view - Requesting pane child.
     * @param {number} paneIndex - Index of the requesting pane.
     * @param {CustomEvent<SplitViewSoloRequestDetail>} event - Request carrying the mutable detail.
     */
    _handleSoloRequest(
        view: SplitViewChildView,
        paneIndex: number,
        event: CustomEvent<SplitViewSoloRequestDetail>
    ): void {
        const detail = event?.detail || {};
        detail.hosted = true;
        detail.hostId = this.id;
        detail.viewId = view?.id ?? null;
        detail.paneIndex = paneIndex;

        if (isCollapsiblePaneChild(view)) {
            view.expand();
        }

        // Copy first: every collapse() publishes constraints synchronously and can re-render
        // ratios while the request is still being applied.
        const collapsedViewIds: string[] = [];
        this.views.slice().forEach((sibling) => {
            if (sibling === view || !isCollapsiblePaneChild(sibling)) {
                return;
            }
            sibling.collapse();
            collapsedViewIds.push(sibling.id);
        });

        detail.collapsedViewIds = collapsedViewIds;
        detail.handled = true;
        this._emitLayoutChange('solo', view?.id ?? null);
    }

    _syncConstraintsFromView(view: SplitViewChildView | null | undefined): void {
        if (!view) {
            return;
        }
        const hasWidth = Number.isFinite(view.minWidth) && view.minWidth >= 0;
        const hasHeight = Number.isFinite(view.minHeight) && view.minHeight >= 0;
        const hasMaxWidth = Number.isFinite(view.maxWidth) && view.maxWidth >= 0;
        const hasMaxHeight = Number.isFinite(view.maxHeight) && view.maxHeight >= 0;
        
        // If all constraints are cleared (null), remove the constraints entry
        if (!hasWidth && !hasHeight && !hasMaxWidth && !hasMaxHeight) {
            this._paneConstraints.delete(view);
            return;
        }
        
        this._paneConstraints.set(view, {
            minWidth: hasWidth ? view.minWidth : null,
            minHeight: hasHeight ? view.minHeight : null,
            maxWidth: hasMaxWidth ? view.maxWidth : null,
            maxHeight: hasMaxHeight ? view.maxHeight : null,
        });
    }

    /**
     * Called when the SplitView container first receives a non-zero size.
     * Triggers ratio recalculation for fixed-size panes.
     * @param {{width: number, height: number}} size Initial content rect size
     */
    onInitialSize(size: SplitViewSize): void {
        super.onInitialSize(size); // Emit events
        const available = this._availableSpan();

        if (available > 0 && this._panes?.length) {
            this._recalculateRatiosWithSpace();
        }
    }

    /**
     * Called when the SplitView container is resized after initial attach.
     * Keeps constrained-pane layouts (fixed/max panes) normalized as available space changes.
     * @param {{width: number, height: number}} size Latest content rect size
     */
    onResized(size: SplitViewSize): void {
        super.onResized(size); // Emit events
        const available = this._availableSpan();

        if (available > 0 && this._panes?.length) {
            this._recalculateRatiosWithSpace();
        }
    }

    /**
     * Internal helper that does the actual ratio recalculation when space is available.
     */
    _recalculateRatiosWithSpace(): void {
        // Keep the filler in sync even when no ratio changes are required (for example
        // after a pane changes from capped to unconstrained).
        this._maybeAddFiller();
        const available = this._availableSpan();

        if (available <= 0) {
            this._log('_recalculateRatiosWithSpace: still no space available');
            return;
        }

        // Check if we have any fixed panes or panes with maxSize constraints
        if (!this._hasAnyConstrainedPane()) {
            this._log('_recalculateRatiosWithSpace: skipping (no constrained panes)');
            return;
        }

        // Recalculate ratios with constraint-aware logic
        const newRatios = this._normalizeRatios(this.views.length, this._ratios);

        // Check if ratios actually changed
        const changed = newRatios.some((ratio, index) => ratio !== this._ratios[index]);

        if (changed) {
            this._log('_recalculateRatiosWithSpace: applying new ratios', {
                oldRatios: this._ratios,
                newRatios,
            });
            this._ratios = newRatios;
            this._applyRatios();
        } else {
            this._log('_recalculateRatiosWithSpace: ratios unchanged');
        }
    }

    /**
     * Return whether any pane is fixed (min == max) or has a finite max size.
     */
    _hasAnyConstrainedPane(): boolean {
        for (let i = 0; i < this.views.length; i++) {
            if (this._isPaneFixed(i)) {
                return true;
            }
            const maxSize = this._paneMaxSize(i);
            if (Number.isFinite(maxSize)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Re-equalize the panes after the last constrained pane became flexible.
     *
     * `_normalizeRatios` with an empty ratio array returns equal shares when no
     * pane is fixed, and the fixed-aware shares when some panes still are, so a
     * pane released from a fixed (collapsed) height regains a fair share.
     *
     * @param viewId The released pane's view id, used only for the layout-change log.
     */
    _rebalanceFlexiblePanes(viewId: string | null): void {
        this._log('_rebalanceFlexiblePanes: re-equalizing released pane', { viewId });
        this._ratios = this._normalizeRatios(this.views.length, []);
        this._applyRatios();
        this._emitLayoutChange('constraints', viewId);
    }

    /** Compute a fallback minimum share when host size is unavailable. */
    _effectiveMinShare(): number {
        const computed = this._minimumShare();
        if (Number.isFinite(computed) && computed > 0) {
            return computed;
        }
        return 1 / Math.max(this.views.length * 4, 1);
    }

    /** Maximize a pane by expanding it and shrinking siblings to the minimum share. */
    _applyMaximize(index: number): boolean {
        if (!this.views.length || index < 0 || index >= this.views.length) {
            return false;
        }
        const minShare = this._effectiveMinShare();
        const maxShare = Math.max(minShare, 1 - minShare * (this.views.length - 1));
        return this._applyTargetShare(index, maxShare, 'maximize');
    }

    /** Minimize a pane by clamping it to the minimum share and redistributing remaining space. */
    _applyMinimize(index: number): boolean {
        if (!this.views.length || index < 0 || index >= this.views.length) {
            return false;
        }
        const minShare = this._paneMinShare(index);
        return this._applyTargetShare(index, minShare, 'minimize');
    }

    /** Resize a pane to a relative share between its minimum and maximum allowable size. */
    _applyRelative(index: number, value: unknown): boolean {
        if (!this.views.length || index < 0 || index >= this.views.length) {
            return false;
        }
        const finiteValue = asFiniteNumber(value);
        const numericValue =
            finiteValue !== null ? Math.min(1, Math.max(0, finiteValue)) : null;
        if (numericValue === null) {
            return false;
        }

        if (this.views.length === 1) {
            this._ratios = [1];
            this._applyRatios();
            this._emitLayoutChange('relative', this.views[index]?.id);
            return true;
        }

        const minShare = this._effectiveMinShare();
        const siblingsCount = this.views.length - 1;
        const maxShare = Math.max(minShare, 1 - minShare * siblingsCount);
        const targetShare = minShare + (maxShare - minShare) * numericValue;
        return this._applyTargetShare(index, targetShare, 'relative');
    }

    /**
     * Core ratio applier used by relative/minimize/maximize to size the target pane.
     * @param {number} index Target pane index.
     * @param {number} targetShare Desired share for the target pane (pre-clamp).
     * @param {string} reason Layout change reason for diagnostics.
     * @returns {boolean} True when ratios were updated.
     */
    _applyTargetShare(index: number, targetShare: number, reason = 'resize'): boolean {
        if (!this.views.length || index < 0 || index >= this.views.length) {
            return false;
        }

        if (this.views.length === 1) {
            this._ratios = [1];
            this._applyRatios();
            this._emitLayoutChange(reason, this.views[index]?.id);
            return true;
        }

        const available = this._availableSpan();
        if (!Number.isFinite(available) || available <= 0) {
            return false;
        }

        // Only user actions (maximize/minimize/relative/drag/explicit resize) capture the
        // restore baseline. `desiredSize` hints must not clobber it, and they are capped at the
        // pane's equal share so an expanded section can never starve its siblings.
        const mode = reason === 'desiredSize' ? 'fair' : 'authoritative';
        if (mode === 'authoritative') {
            this._capturePreviousRatios();
        }

        const sizes = resolvePaneSizes(available, this._paneSizingSpecs(), {
            index,
            size: targetShare * available,
            mode,
        });
        if (sizes === null) {
            this._log('_applyTargetShare: request rejected (would starve siblings)', {
                index,
                targetShare,
                reason,
            });
            return false;
        }

        if (mode === 'fair' && sizes[index] < targetShare * available - 1e-6) {
            this._log('_applyTargetShare: capped desiredSize hint at the equal share', {
                index,
                requested: targetShare * available,
                granted: sizes[index],
            });
        }

        this._ratios = sizesToShares(sizes, available);
        this._applyRatios();
        this._emitLayoutChange(reason, this.views[index]?.id);
        return true;
    }

    /**
     * Build the static sizing spec for every pane, in px along the split axis.
     *
     * Min/max come from the already-scaled `_paneMinSize`/`_paneMaxSize` (so the tight-layout
     * scaling in `_minSizeScale` stays authoritative), and `fixed` reuses `_isPaneFixed`.
     * @returns {SplitViewPaneSpec[]} One spec per pane.
     */
    _paneSizingSpecs(): SplitViewPaneSpec[] {
        return this.views.map((_, index) => ({
            minSize: this._paneMinSize(index),
            maxSize: this._paneMaxSize(index),
            fixed: this._isPaneFixed(index),
        }));
    }

    /** Store the current ratios as the baseline for a future "previous" restore. */
    _capturePreviousRatios(): void {
        if (this._previousRatios || !this._ratios?.length) {
            return;
        }
        this._previousRatios = [...this._normalizeRatios(this.views.length, this._ratios)];
    }

    /** Restore ratios to the last captured baseline, if compatible with current panes. */
    _restorePreviousRatios(requestingIndex: number | null = null): boolean {
        if (!Array.isArray(this._previousRatios)) {
            return false;
        }
        if (this._previousRatios.length !== this.views.length) {
            this._previousRatios = null;
            return false;
        }
        this._ratios = [...this._normalizeRatios(this.views.length, this._previousRatios)];
        this._previousRatios = null;
        this._applyRatios();
        const viewId = requestingIndex != null ? this.views[requestingIndex]?.id : null;
        this._emitLayoutChange('previous', viewId);
        return true;
    }

    /**
     * Create a splitter element for the pane pair at the provided index.
     * @param {number} index Index of the pane pair.
     * @param {boolean} disabled Whether the splitter is disabled (non-draggable).
     * @param {boolean} inactive Whether the splitter is inactive (no hover effects).
     * @returns {HTMLDivElement} Splitter element.
     */
    _createSplitter(index: number, disabled = false, inactive = false): SplitViewSplitterElement {
        const splitter = document.createElement('div') as SplitViewSplitterElement;
        splitter.className = 'split-view__splitter';
        splitter.tabIndex = disabled ? -1 : 0;
        splitter.setAttribute('role', 'separator');
        splitter.setAttribute(
            'aria-orientation',
            this.orientation === 'row' ? 'horizontal' : 'vertical'
        );
        splitter.dataset.orientation = this.orientation;
        splitter.dataset.index = String(index);
        if (disabled) {
            splitter.classList.add('split-view__splitter--disabled');
            splitter.setAttribute('aria-disabled', 'true');
            splitter.style.pointerEvents = 'none';
            splitter.style.opacity = '0.35';
        } else {
            const handler = (event: PointerEvent) => this._beginDrag(event, index);
            splitter._splitViewDragHandler = handler;
            splitter.addEventListener('pointerdown', handler);
        }
        if (inactive) {
            splitter.classList.add('split-view__splitter--inactive');
            this._log('Added inactive class to splitter', {
                index,
                classList: splitter.className,
                disabled,
                inactive,
            });
        }
        return splitter;
    }

    /**
     * Recompute disabled/inactive state for all existing splitters based on current pane fixes.
     * This is needed when child views change constraints after initial render (e.g., tab hide/show).
     */
    _updateSplitterStates(): void {
        if (!this._host || !this._splitters?.length) {
            return;
        }

        this._splitters.forEach((splitter, index) => {
            const movable =
                this._hasFlexiblePane(0, index) &&
                this._hasFlexiblePane(index + 1, this.views.length - 1);
            const disableSplitter = !movable;
            const inactiveSplitter = !movable;

            splitter.classList.toggle('split-view__splitter--inactive', inactiveSplitter);

            if (disableSplitter) {
                splitter.classList.add('split-view__splitter--disabled');
                splitter.setAttribute('aria-disabled', 'true');
                splitter.style.pointerEvents = 'none';
                splitter.style.opacity = '0.35';
                splitter.tabIndex = -1;
                if (splitter._splitViewDragHandler) {
                    splitter.removeEventListener('pointerdown', splitter._splitViewDragHandler);
                    splitter._splitViewDragHandler = null;
                }
            } else {
                splitter.classList.remove('split-view__splitter--disabled');
                splitter.removeAttribute('aria-disabled');
                splitter.style.removeProperty('pointer-events');
                splitter.style.removeProperty('opacity');
                splitter.tabIndex = 0;
                if (!splitter._splitViewDragHandler) {
                    const handler = (event: PointerEvent) =>
                        this._beginDrag(event, Number(splitter.dataset.index));
                    splitter._splitViewDragHandler = handler;
                    splitter.addEventListener('pointerdown', handler);
                }
            }
        });
    }

    /**
     * Begin tracking a pointer drag, resizing the nearest flexible pane on each side of the
     * splitter (skipping collapsed/fixed panes).
     * @param {PointerEvent} event Pointer down event.
     * @param {number} index Index of the splitter (pane to its left/top).
     */
    _beginDrag(event: PointerEvent, index: number): void {
        event.preventDefault();
        const isRow = this.orientation === 'row';
        const startPos = isRow ? event.clientX : event.clientY;

        const leftIndex = this._nearestFlexiblePane(index, -1);
        const rightIndex = this._nearestFlexiblePane(index + 1, 1);
        if (leftIndex === null || rightIndex === null) {
            return;
        }

        const paneA = this._panes[leftIndex];
        const paneB = this._panes[rightIndex];
        if (!paneA || !paneB) {
            return;
        }

        const rectA = paneA.getBoundingClientRect();
        const rectB = paneB.getBoundingClientRect();
        const sizeA = isRow ? rectA.width : rectA.height;
        const sizeB = isRow ? rectB.width : rectB.height;
        const pairTotal = sizeA + sizeB;
        const pairShare =
            (this._ratios[leftIndex] ?? 0) + (this._ratios[rightIndex] ?? 0) || 1;

        // Use unscaled (base) minimum sizes during drag to respect actual constraints
        // _paneMinSize() applies scaling which can reduce constraints when space is tight,
        // but during interactive drag we want to enforce the actual min/max values
        const minSizeA = Math.max(8, this._baseMinSize(leftIndex));
        const minSizeB = Math.max(8, this._baseMinSize(rightIndex));
        const maxSizeA = this._paneMaxSize(leftIndex);
        const maxSizeB = this._paneMaxSize(rightIndex);
        const minShareA = pairTotal > 0 ? minSizeA / pairTotal : 0;
        const minShareB = pairTotal > 0 ? minSizeB / pairTotal : 0;

        const moveHandler = (moveEvent: PointerEvent) => {
            const currentPos = isRow ? moveEvent.clientX : moveEvent.clientY;
            const delta = currentPos - startPos;
            let newSizeA = sizeA + delta;
            newSizeA = Math.max(minSizeA, Math.min(newSizeA, pairTotal - minSizeB));
            if (Number.isFinite(maxSizeA)) {
                newSizeA = Math.min(newSizeA, maxSizeA);
            }
            if (Number.isFinite(maxSizeB)) {
                newSizeA = Math.max(newSizeA, pairTotal - maxSizeB);
            }
            const newRatioWithinPair = pairTotal > 0 ? newSizeA / pairTotal : 0;
            let newRatioA = pairShare * newRatioWithinPair;
            newRatioA = Math.max(minShareA, Math.min(newRatioA, pairShare - minShareB));
            const newRatioB = pairShare - newRatioA;
            this._ratios[leftIndex] = newRatioA;
            this._ratios[rightIndex] = newRatioB;
            this._applyRatios();
        };

        const upHandler = () => {
            window.removeEventListener('pointermove', moveHandler);
            window.removeEventListener('pointerup', upHandler);
            this._emitLayoutChange('drag', this.views[index]?.id ?? null);
        };

        window.addEventListener('pointermove', moveHandler);
        window.addEventListener('pointerup', upHandler);
    }

    /**
     * Apply the current ratios to pane flexGrow values.
     *
     * Ratios are multiplied by `_flexGrowScale()` so a pane that is still flexible keeps receiving
     * the space its content-capped siblings release; see that method for the flexbox rule involved.
     */
    _applyRatios(): void {
        const scale = this._flexGrowScale();
        this._panes.forEach((pane, index) => {
            const ratio = this._ratios[index] ?? 1 / this._panes.length;
            pane.style.flexGrow = String(ratio * scale);
        });
        this._maybeAddFiller();
    }

    /**
     * Normalize ratio array to match pane count with enforced minimum share.
     * When panes have fixed sizes (min==max), their ratios are computed based on
     * fixed pixel size, and remaining panes share the rest of the space.
     * @param {number} count Number of panes.
     * @param {number[]} ratios Existing ratios to normalize.
     * @returns {number[]} Normalized ratios.
     */
    _normalizeRatios(count: number, ratios: number[]): number[] {
        this._log('_normalizeRatios called', { count, ratios, viewCount: this.views?.length });

        if (count <= 0) {
            this._log('_normalizeRatios: count <= 0, returning empty');
            return [];
        }

        // Check if we have fixed-size panes and available space to compute proper ratios
        const available = this._availableSpan();
        this._log('_normalizeRatios: available span', { available, orientation: this.orientation });

        if (available > 0) {
            const fixedSizes = [];
            let totalFixedSize = 0;
            let flexibleCount = 0;

            for (let i = 0; i < count; i++) {
                const isFixed = this._isPaneFixed(i);
                this._log(`_normalizeRatios: checking pane ${i}`, { isFixed });

                if (isFixed) {
                    const fixedSize = this._paneMinSize(i);
                    fixedSizes[i] = fixedSize;
                    totalFixedSize += fixedSize;
                    this._log(`_normalizeRatios: pane ${i} is fixed`, { fixedSize });
                } else {
                    fixedSizes[i] = null;
                    flexibleCount++;
                    this._log(`_normalizeRatios: pane ${i} is flexible`);
                }
            }

            this._log('_normalizeRatios: fixed pane summary', {
                totalFixedSize,
                flexibleCount,
                available,
                fixedSizes,
            });

            // If we have at least one fixed pane and space is available
            if (totalFixedSize > 0 && totalFixedSize < available) {
                const remainingSpace = available - totalFixedSize;
                const result = [];

                for (let i = 0; i < count; i++) {
                    if (fixedSizes[i] !== null) {
                        // Fixed pane: ratio based on its fixed size
                        result[i] = fixedSizes[i] / available;
                    } else {
                        // Flexible pane: share remaining space equally
                        result[i] =
                            flexibleCount > 0 ? remainingSpace / available / flexibleCount : 0;
                    }
                }

                this._log('_normalizeRatios: returning fixed-aware ratios', { result });
                return result;
            } else {
                this._log('_normalizeRatios: not using fixed-aware logic', {
                    reason: totalFixedSize === 0 ? 'no fixed panes' : 'fixed size >= available',
                    totalFixedSize,
                    available,
                });
            }
        } else {
            this._log('_normalizeRatios: available <= 0, using fallback');
        }

        // Fallback to original logic when no fixed panes or no available space
        if (!Array.isArray(ratios) || ratios.length !== count) {
            const equal = 1 / count;
            this._log('_normalizeRatios: using equal distribution (no valid ratios)', {
                equal,
                count,
            });
            return Array.from({ length: count }, () => equal);
        }
        const total = ratios.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
        if (total <= 0) {
            const equal = 1 / count;
            this._log('_normalizeRatios: using equal distribution (total <= 0)', { equal, count });
            return Array.from({ length: count }, () => equal);
        }
        const minShare = this._minimumShare();
        const normalized = ratios.map((value) => Math.max(minShare, value / total));
        const normalizedTotal = normalized.reduce((acc, value) => acc + value, 0) || 1;
        const result = normalized.map((value) => value / normalizedTotal);

        // Apply maxSize constraints iteratively
        const maxIterations = 10; // Prevent infinite loops
        let iteration = 0;
        let constraintsViolated = true;
        const cappedIndices = new Set<number>();

        while (constraintsViolated && iteration < maxIterations) {
            constraintsViolated = false;
            iteration++;

            let totalExcessRatio = 0;

            // Find panes that exceed their maxSize. Keep the capped set cumulative so
            // redistributed space is never handed back to a pane already at its cap.
            for (let i = 0; i < count; i++) {
                if (cappedIndices.has(i)) {
                    continue;
                }
                const maxSize = this._paneMaxSize(i);
                if (maxSize != null && Number.isFinite(maxSize)) {
                    const currentSize = result[i] * available;
                    if (currentSize > maxSize + 0.5) {
                        // 0.5px tolerance for rounding
                        const cappedRatio = maxSize / available;
                        const excessRatio = result[i] - cappedRatio;

                        result[i] = cappedRatio;
                        cappedIndices.add(i);
                        totalExcessRatio += excessRatio;
                        constraintsViolated = true;

                        this._log(`_normalizeRatios: capping pane ${i} to maxSize`, {
                            iteration,
                            maxSize,
                            currentSize,
                            cappedRatio,
                            excessRatio,
                        });
                    }
                }
            }

            // Redistribute excess ratio only to flexible panes that are not capped.
            if (totalExcessRatio > 0) {
                const recipients: number[] = [];
                for (let i = 0; i < count; i++) {
                    if (!cappedIndices.has(i) && !this._isPaneFixed(i)) {
                        recipients.push(i);
                    }
                }

                if (recipients.length > 0) {
                    const redistributePerPane = totalExcessRatio / recipients.length;

                    for (const i of recipients) {
                        result[i] += redistributePerPane;
                    }

                    this._log('_normalizeRatios: redistributed excess', {
                        iteration,
                        totalExcessRatio,
                        recipients,
                        redistributePerPane,
                    });
                } else {
                    this._log('_normalizeRatios: all panes capped, leaving excess space', {
                        iteration,
                        totalExcessRatio,
                        resultingRatioTotal: result.reduce((acc, value) => acc + value, 0),
                    });
                }
            }
        }

        if (iteration >= maxIterations) {
            this._log(
                '_normalizeRatios: WARNING - max iterations reached, constraints may not be fully satisfied'
            );
        }

        this._log('_normalizeRatios: using normalized existing ratios', {
            result,
            minShare,
            iterations: iteration,
        });
        return result;
    }

    /**
     * Compute the minimum allowed ratio based on current host size and min pane size.
     * @returns {number} Minimum share per pane (0-0.5).
     */
    _minimumShare(): number {
        if (!this._host) {
            return 0;
        }
        return Math.max(...this.views.map((_, idx) => this._paneMinShare(idx)), 0);
    }

    /**
     * Return the host content-box span along the split axis.
     * The host border and padding are not available to flex children, so they must be
     * excluded before splitter/gap space is subtracted.
     */
    _hostContentSpan(): number {
        if (!this._host) {
            return 0;
        }
        const hostRect = this._host.getBoundingClientRect();
        const size = this.orientation === 'row' ? hostRect.width : hostRect.height;
        if (!Number.isFinite(size)) {
            return size;
        }

        const computedStyle =
            this._host.ownerDocument?.defaultView?.getComputedStyle(this._host) ?? null;
        const readLength = (property: string): number => {
            const raw = computedStyle?.getPropertyValue(property) ?? '';
            const value = Number.parseFloat(raw);
            return Number.isFinite(value) ? value : 0;
        };
        const isRow = this.orientation === 'row';
        const borderSpace = isRow
            ? readLength('border-left-width') + readLength('border-right-width')
            : readLength('border-top-width') + readLength('border-bottom-width');
        const paddingSpace = isRow
            ? readLength('padding-left') + readLength('padding-right')
            : readLength('padding-top') + readLength('padding-bottom');

        return size - borderSpace - paddingSpace;
    }

    _availableSpan(): number {
        if (!this._host) {
            return 0;
        }
        const splitterMovable = [];
        for (let i = 0; i < this.views.length - 1; i++) {
            splitterMovable.push(
                this._hasFlexiblePane(0, i) &&
                    this._hasFlexiblePane(i + 1, this.views.length - 1)
            );
        }
        // Splitter boxes and inter-item gaps are subtracted by the pure solver so the span
        // matches the rendered geometry of the `.split-view__splitter` boxes exactly.
        return computePaneSpan({
            hostSpan: this._hostContentSpan(),
            gap: this.gap,
            splitterMovable,
        });
    }

    _paneMinShare(index: number, availableOverride: number | null = null): number {
        const available = availableOverride ?? this._availableSpan();
        if (!Number.isFinite(available) || available <= 0) {
            return 0;
        }
        const minSize = this._paneMinSize(index);
        return Math.min(0.5, Math.max(0, minSize / available));
    }

    _paneMaxShare(index: number, availableOverride: number | null = null): number {
        const available = availableOverride ?? this._availableSpan();
        if (!Number.isFinite(available) || available <= 0) {
            return 1;
        }
        const maxSize = this._paneMaxSize(index);
        if (!Number.isFinite(maxSize) || maxSize <= 0) {
            return 1;
        }
        return Math.max(0, Math.min(1, maxSize / available));
    }

    /** Compute the maximum (scaled) minimum size among panes. */
    _maxPaneMinSize(): number {
        let max = this.minPaneSize;
        this.views.forEach((_, idx) => {
            const size = this._paneMinSize(idx);
            if (size > max) {
                max = size;
            }
        });
        return max;
    }

    /** Get the effective (possibly scaled) minimum size for a pane. */
    _paneMinSize(index: number): number {
        const base = this._baseMinSize(index);
        const scale = this._minSizeScale();
        const scaled = base * scale;
        const floor = 8;
        return Math.max(floor, scaled);
    }

    /** Apply cached constraints to a pane element (min only). */
    _applyPaneConstraints(index: number, pane: SplitViewPaneElement | null = null): void {
        const hostPane = pane || this._panes[index];
        if (!hostPane) {
            return;
        }
        hostPane.style.removeProperty('max-width');
        hostPane.style.removeProperty('max-height');

        const view = this.views[index];
        const constraints = this._getPaneConstraints(view);
        if (!constraints) {
            return;
        }

        const minSize = this._paneMinSize(index);
        const maxSize = this._paneMaxSize(index);
        const isRow = this.orientation === 'row';
        if (isRow) {
            hostPane.style.minWidth = `${minSize}px`;
            if (Number.isFinite(maxSize)) {
                hostPane.style.maxWidth = `${maxSize}px`;
            }
        } else {
            hostPane.style.minHeight = `${minSize}px`;
            if (Number.isFinite(maxSize)) {
                hostPane.style.maxHeight = `${maxSize}px`;
            }
        }
    }

    /** Normalize a constraints payload from a child view. */
    _normalizeConstraints(detail: SplitViewConstraintsDetail): SplitViewPaneConstraints | null {
        const minSizeRaw = detail.minSize ?? detail.min;
        const minWidth = asNonNegativeFiniteNumber(detail.minWidth);
        const minHeight = asNonNegativeFiniteNumber(detail.minHeight);
        const fallback = asNonNegativeFiniteNumber(minSizeRaw);
        const resolvedMinWidth = minWidth ?? fallback;
        const resolvedMinHeight = minHeight ?? fallback;
        const maxSizeRaw = detail.maxSize ?? detail.max;
        const maxWidth = asNonNegativeFiniteNumber(detail.maxWidth);
        const maxHeight = asNonNegativeFiniteNumber(detail.maxHeight);
        const maxSize = asNonNegativeFiniteNumber(maxSizeRaw);
        const resolvedMaxWidth = maxWidth ?? maxSize;
        const resolvedMaxHeight = maxHeight ?? maxSize;
        if (
            resolvedMinWidth == null &&
            resolvedMinHeight == null &&
            resolvedMaxWidth == null &&
            resolvedMaxHeight == null
        ) {
            return null;
        }
        const normalized: SplitViewPaneConstraints = {
            minWidth: resolvedMinWidth,
            minHeight: resolvedMinHeight,
            maxWidth: resolvedMaxWidth,
            maxHeight: resolvedMaxHeight,
        };
        if (
            normalized.minWidth != null &&
            normalized.maxWidth != null &&
            normalized.maxWidth < normalized.minWidth
        ) {
            normalized.maxWidth = normalized.minWidth;
        }
        if (
            normalized.minHeight != null &&
            normalized.maxHeight != null &&
            normalized.maxHeight < normalized.minHeight
        ) {
            normalized.maxHeight = normalized.minHeight;
        }
        return normalized;
    }

    /** Resolve constraints from dispatched messages or view defaults (min-only). */
    _getPaneConstraints(view: SplitViewChildView | undefined): SplitViewPaneConstraints | null {
        if (!view) {
            return null;
        }
        const constraints = this._paneConstraints.get(view);
        const minWidth =
            constraints?.minWidth ?? (Number.isFinite(view.minWidth) ? view.minWidth : null);
        const minHeight =
            constraints?.minHeight ?? (Number.isFinite(view.minHeight) ? view.minHeight : null);
        const maxWidth =
            constraints?.maxWidth ?? (Number.isFinite(view.maxWidth) ? view.maxWidth : null);
        const maxHeight =
            constraints?.maxHeight ?? (Number.isFinite(view.maxHeight) ? view.maxHeight : null);
        if (minWidth == null && minHeight == null && maxWidth == null && maxHeight == null) {
            return null;
        }
        return { minWidth, minHeight, maxWidth, maxHeight };
    }

    /** Compute the base (unscaled) minimum size for a pane using orientation-aware constraints. */
    _baseMinSize(index: number): number {
        const isRow = this.orientation === 'row';
        const view = this.views[index];
        const constraints = this._getPaneConstraints(view);
        const oriented = isRow
            ? (constraints?.minWidth ?? constraints?.minHeight)
            : (constraints?.minHeight ?? constraints?.minWidth);
        const orientedMax = isRow
            ? (constraints?.maxWidth ?? constraints?.maxHeight)
            : (constraints?.maxHeight ?? constraints?.maxWidth);
        const baseline = Number.isFinite(oriented) && oriented >= 0 ? oriented : this.minPaneSize;
        const capped =
            Number.isFinite(orientedMax) && orientedMax >= 0
                ? Math.min(baseline, orientedMax)
                : baseline;
        return Math.max(8, capped);
    }

    /** Get the effective (unscaled) maximum size for a pane. */
    _paneMaxSize(index: number): number {
        const isRow = this.orientation === 'row';
        const view = this.views[index];
        const constraints = this._getPaneConstraints(view);
        const oriented = isRow
            ? (constraints?.maxWidth ?? constraints?.maxHeight)
            : (constraints?.maxHeight ?? constraints?.maxWidth);
        if (!Number.isFinite(oriented) || oriented <= 0) {
            return Infinity;
        }
        return oriented;
    }

    /** Check whether a pane is fixed (min == max in the resize axis). */
    _isPaneFixed(index: number): boolean {
        const isRow = this.orientation === 'row';
        const view = this.views[index];
        const constraints = this._getPaneConstraints(view);
        if (!constraints) {
            this._log('isPaneFixed: no constraints', { index, viewId: view?.id });
            return false;
        }
        const minSize = isRow
            ? (constraints.minWidth ?? constraints.minHeight)
            : (constraints.minHeight ?? constraints.minWidth);
        const maxSize = isRow
            ? (constraints.maxWidth ?? constraints.maxHeight)
            : (constraints.maxHeight ?? constraints.maxWidth);
        if (minSize == null || maxSize == null) {
            this._log('isPaneFixed: missing min or max', {
                index,
                viewId: view?.id,
                minSize,
                maxSize,
            });
            return false;
        }
        const isFixed =
            Number.isFinite(minSize) &&
            Number.isFinite(maxSize) &&
            minSize >= 0 &&
            maxSize >= 0 &&
            minSize === maxSize;
        this._log('isPaneFixed result', {
            index,
            viewId: view?.id,
            isFixed,
            minSize,
            maxSize,
            isRow,
            constraints,
        });
        return isFixed;
    }

    /** Check whether any pane in the inclusive range is flexible (not fixed). */
    _hasFlexiblePane(fromIndex: number, toIndex: number): boolean {
        const start = Math.max(0, fromIndex);
        const end = Math.min(this.views.length - 1, toIndex);
        for (let i = start; i <= end; i++) {
            if (!this._isPaneFixed(i)) {
                return true;
            }
        }
        return false;
    }

    /** Find the nearest flexible pane at or beyond `index`, searching in `direction`. */
    _nearestFlexiblePane(index: number, direction: -1 | 1): number | null {
        const clamped = Math.max(0, Math.min(index, this.views.length - 1));
        for (let i = clamped; i >= 0 && i < this.views.length; i += direction) {
            if (!this._isPaneFixed(i)) {
                return i;
            }
        }
        return null;
    }

    /** Return the sum of the current pane flex ratios. */
    _paneRatioSum(): number {
        return this._ratios.reduce(
            (sum, ratio) => sum + (Number.isFinite(ratio) ? ratio : 0),
            0
        );
    }

    /**
     * Multiplier converting the normalized ratios into CSS flex-grow factors.
     *
     * CSS resolves positive free space against the flex factors of the panes that are still
     * unfrozen, and when that subset sums to less than one it only hands out `sum x free space`
     * (CSS Flexbox "Resolving Flexible Lengths", step 5). The stored ratios sum to one across *all*
     * panes, so once content-capped panes froze at their `maxHeight` the last flexible pane was
     * offered only its own fraction of the released space and the remainder stayed empty: a tall
     * pane kept scrolling while unused space sat below it. Dividing by the smallest positive ratio
     * preserves the proportions and lifts every factor to at least one, so any non-empty subset of
     * unfrozen panes sums to at least one and the released space always reaches the panes that can
     * still use it.
     *
     * Called by `_renderChildren`, `_applyRatios`, and `_maybeAddFiller` (the filler keeps the same
     * units so it still absorbs only the residual ratio).
     *
     * @returns {number} Scale factor (1 when no pane has a positive ratio).
     */
    _flexGrowScale(): number {
        return scaledFlexFactors(this._ratios);
    }

    /** Remove the filler pane when it is no longer needed. */
    _removeFiller(): void {
        if (!this._filler) {
            return;
        }
        this._filler.remove();
        this._filler = null;
    }

    /**
     * Create, update, or remove the filler pane.
     *
     * The filler must only absorb the unused ratio (`1 - sum(pane ratios)`). Giving it
     * `flexGrow: 1` makes it compete with the panes during flex normalization, which
     * shrinks content-sized panes below their measured max height. It is also removed
     * when no residual ratio exists, so it cannot dilute panes that already fill the host.
     * The residual is scaled by `_flexGrowScale()` like the panes so both sides of the
     * comparison stay in the same units.
     */
    _maybeAddFiller(): void {
        if (!this._host || !this.views.length || !this._panes.length) {
            this._removeFiller();
            return;
        }
        const available = this._availableSpan();
        const maxSizes = this.views.map((_, idx) => this._paneMaxSize(idx));

        // Only add filler if ALL panes have finite maxSize (all are fully constrained)
        // If any pane is unconstrained/flexible, it should absorb excess space instead
        if (maxSizes.some((value) => !Number.isFinite(value))) {
            this._log('_maybeAddFiller: skipping (at least one pane has no maxSize)');
            this._removeFiller();
            return;
        }

        const totalMax = maxSizes.reduce((acc, value) => acc + value, 0);
        const residual = Math.max(0, 1 - this._paneRatioSum());
        if (available <= totalMax || residual <= 1e-6) {
            this._log('_maybeAddFiller: skipping (no residual space)', {
                available,
                totalMax,
                residual,
            });
            this._removeFiller();
            return;
        }

        this._log('_maybeAddFiller: syncing filler', {
            available,
            totalMax,
            residual,
        });

        if (!this._filler) {
            const filler = document.createElement('div');
            filler.className = 'split-view__filler';
            filler.style.flexShrink = '1';
            filler.style.flexBasis = '0';
            filler.style.minWidth = '0';
            filler.style.minHeight = '0';
            filler.style.pointerEvents = 'none';
            this._host.appendChild(filler);
            this._filler = filler;
        }
        this._filler.style.flexGrow = String(fillerFlexFactor(this._ratios));
    }

    /** Compute scaling factor when the sum of minimums exceeds available space. */
    _minSizeScale(): number {
        const available = this._availableSpan();
        if (!Number.isFinite(available) || available <= 0) {
            return 1;
        }
        const baseMins = this._allBaseMinSizes();
        const totalMin = baseMins.reduce((acc, value) => acc + value, 0);
        if (totalMin <= 0) {
            return 1;
        }
        if (totalMin <= available) {
            return 1;
        }
        const scale = available / totalMin;
        return Math.max(scale, 0.05);
    }

    /** Collect base (unscaled) minimum sizes for all panes. */
    _allBaseMinSizes(): number[] {
        return this.views.map((_, idx) => this._baseMinSize(idx));
    }
}
