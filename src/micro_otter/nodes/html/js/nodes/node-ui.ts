// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Node UI v2: draws a node and performs hit tests for the node body and its connectors.
 *
 * Responsibilities:
 * - Render a single node onto a provided 2D canvas context.
 * - Expose hit tests for node body and connectors (inputs/outputs).
 * - Persist changes back into the owning NodeGraph (position, collapse, etc.).
 */
import NodeData from '../data/node-data.js';
import { createLogger } from '../core/log.js';

import { CROSS_NODE_DYNAMIC_SOURCES, DEFAULT_STYLE } from './node-ui-constants.js';
import type { NodeUiStyle } from './node-ui-constants.js';

import {
    calculateNodeHeight,
    computeControlColumnLayout,
    computeNodeMinContentWidth,
    getVisibleControls,
    getVisibleInputs,
    getVisibleOutputs,
    canvasToScreen,
} from './node-ui-helpers.js';
import type {
    ControlColumnLayout,
    ControlDefinition,
    NodeDataLike as HelperNodeDataLike,
    NodeInputDefinition,
    NodeOutputDefinition,
    Point,
    Rect,
    ViewportTransform,
} from './node-ui-helpers.js';

import {
    hitTestNode as hitTestNodeFn,
    hitTestConnector as hitTestConnectorFn,
    hitTestHeader as hitTestHeaderFn,
    hitTestControl as hitTestControlFn,
    hitTestResizeHandle as hitTestResizeHandleFn,
} from './node-ui-hit-testing.js';
import type {
    ConnectorHitResult,
    ConnectorKind,
    ControlHitResult,
    HeaderHitResult,
    ResizeHandleHitResult,
} from './node-ui-hit-testing.js';

import { drawNode, computeConnectorPositions } from './node-ui-rendering.js';

import { IconProvider } from '../views/icon-provider.js';
import { loadMdiIconIndex, resolveMdiGlyph } from '../data/mdi-icons.js';
import { ensureMdiGlyphFont } from './mdi-glyph-font.js';

import NumberControlUi, {
    clampNumericControlValue,
    type NumberControlPayload,
} from './controls/number-control-ui.js';
import TextControlUi from './controls/text-control-ui.js';
import NodeDropdownControlUi from './controls/node-dropdown-control-ui.js';
import CheckboxControlUi from './controls/checkbox-control-ui.js';
import SliderControlUi from './controls/slider-control-ui.js';
import ColorControlUi from './controls/color-control-ui.js';
import IconControlUi from './controls/icon-control-ui.js';

import { descriptorEchoesControl, resolveDynamicControl } from './node-control-dynamic-resolver.js';
import type {
    DeviceTargetInfoLike,
    ResolvedDynamicOption,
} from './node-control-dynamic-resolver.js';

type NodeId = string;
type DrawOptions = Parameters<typeof drawNode>[4];
type ConnectorPosition = ReturnType<typeof computeConnectorPositions>[number];
type BoundLogger = (
    reason: string,
    level?: 'debug' | 'info' | 'warn' | 'error',
    ...data: unknown[]
) => void;

type LocaleMapValue = string | Record<string, unknown> | null | undefined;

type InputDefaultControlLike = {
    type?: string;
    defaultValue?: unknown;
    getDefinition?: () => ControlDefinition;
    [key: string]: unknown;
};

interface NodeInputLike extends NodeInputDefinition {
    id: NodeId;
    defaultControl?: InputDefaultControlLike;
}

interface NodeControlLike extends ControlDefinition {
    id: NodeId;
    type: string;
}

interface NodeState extends HelperNodeDataLike {
    id: NodeId;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    icon?: string | null;
    type?: string;
    collapsed: boolean;
    controls?: NodeControlLike[];
    inputs?: NodeInputLike[];
    outputs?: NodeOutputDefinition[];
    inputDefaults: Record<string, unknown>;
    controlValues: Record<string, unknown>;
    setPosition: (x: number, y: number) => void;
    getUserNameForLocale?: (locale: string) => string | null;
    getUserName?: (locale?: string) => string | null;
}

interface NodeRuntimeTypeLike {
    icon?: string;
    title?: unknown;
}

interface RuntimeLike {
    getNodeType: (type: string | undefined) => NodeRuntimeTypeLike | null;
}

interface RuntimeCollectionLike {
    getActiveRuntime: () => RuntimeLike | null;
}

interface I18nServiceLike {
    currentLocale?: string;
    t?: (key: string) => string;
}

interface WorkspaceLike {
    i18nService?: I18nServiceLike;
    runtimeCollection?: RuntimeCollectionLike;
    getActiveCollection?: () => CollectionSourceLike | null;
}

/**
 * The active collection as an option and event source (`Collection`).
 *
 * `on('*', ...)` is optional: the option sources only need `getGraphArray()`, and a test
 * double may provide nothing else.
 */
interface CollectionSourceLike {
    getGraphArray?: () => unknown[];
    on?: (event: string, listener: (event: unknown) => void) => (() => void) | void;
}

interface NodeGraphLike {
    getNode?: (nodeId: NodeId) => unknown;
    getNodes?: () => unknown[];
    getNodeIds?: () => unknown[];
    getConnections?: () => unknown[];
    updateNodePosition?: (nodeId: NodeId, x: number, y: number) => void;
    updateNode?: (
        nodeId: NodeId,
        patch: Record<string, unknown>,
        previous?: Record<string, unknown>
    ) => void;
    getConnectionsForNode?: (nodeId: NodeId) => unknown[];
    on?: (...args: unknown[]) => unknown;
    off?: (...args: unknown[]) => unknown;
}

function normalizeNodeId(value: unknown, fallback = ''): NodeId {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return fallback;
}

interface ControlUiLike {
    inputElement?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    closeOnChange?: boolean;
    renderDOM: () => HTMLElement;
    getLayout?: () => { height?: number };
    renderCanvas?: (ctx: CanvasRenderingContext2D, bounds: Rect) => void;
    destroy?: () => void;
    /**
     * Replace the option list of a live instance without re-creating it.
     *
     * Only option-list controls (the dropdown) offer it; every other control ignores the
     * in-place refresh and waits for the next rebuild.
     */
    setOptions?: (options: unknown, disabled?: boolean) => void;
    _notifyChange?: (newValue: unknown) => void;
    _requestClose?: () => void;
}

type ControlClass = new (
    controlData: ControlDefinition,
    nodeData: { controlValues: Record<string, unknown> },
    nodeUi: NodeUi,
    options?: {
        t?: (key: string) => string;
        i18nService?: unknown;
        logger?: unknown;
    }
) => ControlUiLike;

export interface NodeUiOptions {
    selected?: boolean;
    style?: Partial<NodeUiStyle>;
    onIconLoad?: (nodeId: NodeId) => void;
    /**
     * Repaint hook for control renderers that paint lazily loaded resources (the MDI webfont
     * of the icon control, for example). Same contract as `onIconLoad`.
     */
    onRepaintRequest?: (nodeId: NodeId) => void;
    i18nService?: I18nServiceLike | null;
    workspace?: WorkspaceLike | null;
    resolveDeviceTarget?: () => DeviceTargetInfoLike | null;
    canvasToScreen?: (point: Point) => Point;
    screenToCanvas?: (point: Point) => Point;
}

function asNode(value: EventTarget | null): Node | null {
    return value instanceof Node ? value : null;
}

function isNodeState(value: unknown): value is NodeState {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<NodeState>;
    return (
        typeof candidate.id === 'string' &&
        typeof candidate.x === 'number' &&
        typeof candidate.y === 'number' &&
        typeof candidate.width === 'number' &&
        typeof candidate.height === 'number'
    );
}

/**
 * Node UI v2 renderer and hit tester for a single graph node.
 */
export class NodeUi {
    graph: NodeGraphLike | null;
    nodeId: NodeId;
    selected: boolean;
    relatedHighlight: boolean;
    style: NodeUiStyle;
    data?: NodeData;

    _log: BoundLogger;
    _unsubscribe: (() => void) | null;
    /** Teardown for the collection-wide subscriptions (cross-graph option sources). */
    _collectionUnsubscribe: (() => void) | null;
    /** Teardown per foreign graph whose node events this node listens to. */
    _foreignGraphUnsubscribe: Map<unknown, () => void>;
    _controlEditorOverlay: HTMLElement | null;
    _activeEditor: HTMLElement | null;
    _activeEditorClickHandler: ((event: MouseEvent) => void) | null;
    _lastClickTime: number;
    _lastClickTarget: 'name' | null;
    _canvasToScreenFn: ((point: Point) => Point) | null;
    _screenToCanvasFn: ((point: Point) => Point) | null;
    _workspace: WorkspaceLike | null;
    _resolveDeviceTarget: (() => DeviceTargetInfoLike | null) | null;
    _onIconLoad: ((nodeId: NodeId) => void) | null;
    _onRepaintRequest: ((nodeId: NodeId) => void) | null;
    _iconImage: HTMLImageElement | null;
    /** MDI glyph painted in the header while the stored icon is an `mdi:` value; `null` otherwise. */
    _iconGlyph: string | null;
    _iconLoaded: boolean;
    _i18nService: I18nServiceLike | null;
    _heightValidated: boolean;
    _lastRequestedWidth: number | null;
    _activeNameControl: ControlUiLike | null;
    _refreshingDynamicControls: boolean;
    _pendingControlRefresh: boolean;
    /**
     * Signature of the option lists the live control instances were built from.
     *
     * `node-updated` fires for every change of every node in the graph, and a rebuild drops
     * and re-creates *all* control instances of this node — the icon control reloads its
     * glyph, which is visible as a flicker. Comparing the freshly resolved lists against this
     * signature restricts the rebuild to the case where a list really changed. An empty string
     * means "unknown", so the next refresh rebuilds.
     */
    _dynamicControlSignature: string;

    i18nService?: unknown;
    logger?: unknown;

    controlInstances: Map<NodeId, ControlUiLike>;
    inputDefaultControlInstances: Map<NodeId, ControlUiLike>;
    /** Resolved option lists of dynamic input-row default controls, keyed by input id. */
    _inputDefaultDynamicOptions: Map<NodeId, ResolvedDynamicOption[]>;

    _cachedVisibleControls: ControlDefinition[] | null;
    _cachedVisibleInputs: NodeInputDefinition[] | null;
    _cachedVisibleOutputs: NodeOutputDefinition[] | null;
    _cachedInputPositions: ConnectorPosition[] | null;
    _cachedOutputPositions: ConnectorPosition[] | null;

    constructor(graph: NodeGraphLike | null, nodeId: NodeId, options: NodeUiOptions = {}) {
        this.graph = graph;
        this.nodeId = normalizeNodeId(nodeId, '');
        this._log = createLogger('NodeUi', () => this.nodeId);
        this.selected = Boolean(options.selected);
        this.relatedHighlight = false;

        this.style = { ...DEFAULT_STYLE, ...(options.style || {}) };

        const rawNodeData = graph?.getNode?.(nodeId);
        const nodeData = isNodeState(rawNodeData) ? rawNodeData : null;
        if (nodeData?.color) {
            this.style.bodyColor = nodeData.color;
        }
        this._unsubscribe = null;
        this._collectionUnsubscribe = null;
        this._foreignGraphUnsubscribe = new Map();
        this._controlEditorOverlay = null;
        this._activeEditor = null;
        this._activeEditorClickHandler = null;
        this._lastClickTime = 0;
        this._lastClickTarget = null;
        this._canvasToScreenFn = options.canvasToScreen || null;
        this._screenToCanvasFn = options.screenToCanvas || null;
        this._workspace = options.workspace || null;
        this._resolveDeviceTarget = options.resolveDeviceTarget || null;
        this._onIconLoad = options.onIconLoad || null;
        this._onRepaintRequest = options.onRepaintRequest || null;
        this._iconImage = null;
        this._iconGlyph = null;
        this._iconLoaded = false;
        this._i18nService = options.i18nService || null;
        this._heightValidated = false;
        this._lastRequestedWidth = null;
        this._activeNameControl = null;
        this._refreshingDynamicControls = false;
        this._pendingControlRefresh = false;
        this._dynamicControlSignature = '';
        this.controlInstances = new Map();
        this.inputDefaultControlInstances = new Map();
        this._inputDefaultDynamicOptions = new Map();

        this._cachedVisibleControls = null;
        this._cachedVisibleInputs = null;
        this._cachedVisibleOutputs = null;
        this._cachedInputPositions = null;
        this._cachedOutputPositions = null;

        this._bindGraph(graph);
        this._bindCollection();
        this._loadIcon();
        this._initializeControls();
        this._initializeInputDefaultControls();
        // The instances were built from the resolution that is current right now: remember it,
        // so the first `node-updated` of the graph does not rebuild them for nothing.
        this._recordDynamicSignature();
    }

    setSelected(selected: boolean): void {
        this.selected = Boolean(selected);
    }

    setRelatedHighlight(highlighted: boolean): void {
        this.relatedHighlight = Boolean(highlighted);
    }

    getCurrentLocale(): string {
        return (
            this._i18nService?.currentLocale || this._workspace?.i18nService?.currentLocale || 'en'
        );
    }

    getI18nService(): I18nServiceLike | null {
        return this._i18nService || this._workspace?.i18nService || null;
    }

    getWorkspace(): WorkspaceLike | null {
        return this._workspace || null;
    }

    setGraph(graph: NodeGraphLike | null, nodeId: NodeId = this.nodeId): void {
        // A graph/node swap invalidates every control instance, and an open editor is one of
        // those instances' elements: drop the editor (and any deferred rebuild) first.
        this._pendingControlRefresh = false;
        this.hideEditor();
        this._unbindGraph();
        this._unbindCollection();
        this._destroyControlInstances();
        this._destroyInputDefaultControlInstances();
        this.graph = graph;
        this.nodeId = normalizeNodeId(nodeId, this.nodeId);
        this._bindGraph(graph);
        this._bindCollection();
        this._initializeControls();
        this._initializeInputDefaultControls();
        this._recordDynamicSignature();
    }

    setNodeId(nodeId: NodeId): void {
        this.nodeId = normalizeNodeId(nodeId, this.nodeId);
        // The signature described the option lists of the node this UI was built for.
        this._dynamicControlSignature = '';
    }

    getNodeData(): NodeState | null {
        if (!this.graph || typeof this.graph.getNode !== 'function') {
            return null;
        }
        const node = this.graph.getNode(this.nodeId);
        return isNodeState(node) ? node : null;
    }

    getData(): NodeData | undefined {
        return this.data;
    }

    setPosition(x: number, y: number): void {
        this._invalidatePositionCache();

        if (this.graph?.updateNodePosition) {
            this.graph.updateNodePosition(this.nodeId, x, y);
            return;
        }
        const data = this.getNodeData();
        if (data) {
            data.setPosition(x, y);
        }
    }

    setCollapsed(collapsed: boolean): void {
        const data = this.getNodeData();
        if (!data) {
            return;
        }

        const wasCollapsed = data.collapsed;
        const isCollapsed = Boolean(collapsed);

        if (wasCollapsed === isCollapsed) {
            return;
        }

        data.collapsed = isCollapsed;
        const newHeight = calculateNodeHeight(
            data,
            (d) => this._getVisibleControls(d),
            (d) => this._getVisibleInputs(d),
            (d) => this._getVisibleOutputs(d)
        );

        this._invalidatePositionCache();

        if (this.graph?.updateNode) {
            this.graph.updateNode(this.nodeId, {
                collapsed: isCollapsed,
                height: newHeight,
            });
        } else {
            data.height = newHeight;
        }
    }

    getBounds(): Rect {
        const data = this.getNodeData();
        if (!data) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        return {
            x: data.x,
            y: data.y,
            width: data.width,
            height: data.height,
        };
    }

    /**
     * Recalculate the node height from its current visible connectors and controls.
     *
     * The visibility and connector-position caches are dropped first: a connector patch
     * (for example a function signature sync) replaces `data.inputs`/`data.outputs`, and a
     * height computed from the previous connector list would never grow or shrink the node.
     * `calculateNodeHeight()` immediately repopulates the caches for the following draw.
     */
    ensureNodeHeight(): void {
        const data = this.getNodeData();
        if (!data) {
            return;
        }

        this._invalidateVisibilityCache();

        const calculatedHeight = calculateNodeHeight(
            data,
            (d) => this._getVisibleControls(d),
            (d) => this._getVisibleInputs(d),
            (d) => this._getVisibleOutputs(d)
        );

        this._heightValidated = true;

        if (data.height !== calculatedHeight) {
            if (this.graph && typeof this.graph.updateNode === 'function') {
                this.graph.updateNode(this.nodeId, { height: calculatedHeight });
            } else {
                data.height = calculatedHeight;
            }
        }
    }

    /**
     * Minimum width this node needs so that every connector row and every panel control
     * stays usable.
     *
     * Derived from the node's own connector labels, default controls and visible panel
     * controls (see `computeNodeMinContentWidth()`), using the current locale and the
     * control instances that actually exist. Returns `0` when the node is collapsed or has
     * neither connector rows nor visible controls.
     *
     * @returns Content-derived minimum width in pixels.
     */
    getMinContentWidth(): number {
        const data = this.getNodeData();
        if (!data) {
            return 0;
        }

        return computeNodeMinContentWidth(data, {
            locale: this.getCurrentLocale(),
            visibleInputs: this._getVisibleInputs(data),
            visibleOutputs: this._getVisibleOutputs(data),
            visibleControls: this._getVisibleControls(data),
            hasDefaultControl: (input) => this.inputDefaultControlInstances.has(input.id),
        });
    }

    /**
     * Grow the node until its connector rows and panel controls have room.
     *
     * Complements `ensureNodeHeight()` for the horizontal axis. The node is only ever
     * made wider, never narrower: shrinking would fight the user's manual resize and
     * re-trigger graph updates on every locale or label change. The request is skipped
     * once the width already satisfies the minimum, and repeated requests for the same
     * width are throttled so a rejecting graph cannot cause a render/patch loop.
     */
    ensureNodeWidth(): void {
        const data = this.getNodeData();
        if (!data || data.collapsed) {
            return;
        }

        const minWidth = this.getMinContentWidth();
        if (!Number.isFinite(minWidth) || minWidth <= 0) {
            return;
        }

        const currentWidth = Number.isFinite(data.width) ? data.width : 0;
        if (currentWidth >= minWidth) {
            this._lastRequestedWidth = null;
            return;
        }

        if (this._lastRequestedWidth === minWidth) {
            return;
        }

        this._lastRequestedWidth = minWidth;
        this._invalidatePositionCache();

        if (this.graph && typeof this.graph.updateNode === 'function') {
            this.graph.updateNode(this.nodeId, { width: minWidth });
        } else {
            data.width = minWidth;
        }
    }

    /**
     * Shared label/value column of this node's inline controls.
     *
     * Pure read of the same computation the renderer and hit-testing use, exposed for
     * editor overlays and tests. Returns `null` when the node has no data.
     *
     * @returns Column geometry, or `null` without node data.
     */
    getControlColumnLayout(): ControlColumnLayout | null {
        const data = this.getNodeData();
        if (!data) {
            return null;
        }

        return computeControlColumnLayout({
            x: data.x,
            width: data.width,
            visibleControls: this._getVisibleControls(data),
            locale: this.getCurrentLocale(),
        });
    }

    _invalidateVisibilityCache(): void {
        this._cachedVisibleControls = null;
        this._cachedVisibleInputs = null;
        this._cachedVisibleOutputs = null;
        this._cachedInputPositions = null;
        this._cachedOutputPositions = null;
    }

    invalidateConnectorPositions(): void {
        this._cachedInputPositions = null;
        this._cachedOutputPositions = null;
    }

    _invalidatePositionCache(): void {
        this.invalidateConnectorPositions();
    }

    /**
     * Synthetic dropdowns that make input-row defaults participate in visibility.
     *
     * An input default control is not part of `data.controls`, so `getVisibleControls()` cannot
     * see the store picker's selection. One synthetic entry per dynamic input default carries
     * the resolved option list and the stored value as its `default`; the list is only used to
     * decide which controls are hidden, never rendered as a row.
     *
     * @param data - Node state as read from the graph.
     * @returns One dropdown entry per dynamic input-row default control.
     */
    _inputDefaultAffectingDropdowns(data: HelperNodeDataLike): ControlDefinition[] {
        const inputDefaults = data.inputDefaults || {};
        const entries: ControlDefinition[] = [];

        (data.inputs || []).forEach((rawInput) => {
            const input = rawInput as NodeInputLike;
            const definition = input.defaultControl?.getDefinition
                ? input.defaultControl.getDefinition()
                : (input.defaultControl as unknown as ControlDefinition);
            if (!definition || definition.type !== 'dropdown' || !definition.dynamicOptions) {
                return;
            }
            const id = normalizeNodeId(input.id, '');
            if (!id) {
                return;
            }
            entries.push({
                ...definition,
                id,
                affectsControls: true,
                default: inputDefaults[id] ?? definition.default,
                options: this._inputDefaultDynamicOptions.get(id) ?? definition.options ?? [],
            });
        });

        return entries;
    }

    _getVisibleControls(nodeData: HelperNodeDataLike): ControlDefinition[] {
        if (this._cachedVisibleControls === null) {
            this._cachedVisibleControls = getVisibleControls(
                this._visibilityNodeData(nodeData),
                this._inputDefaultAffectingDropdowns(nodeData)
            );
        }
        return this._cachedVisibleControls;
    }

    _getVisibleInputs(nodeData: HelperNodeDataLike): NodeInputDefinition[] {
        if (this._cachedVisibleInputs === null) {
            this._cachedVisibleInputs = getVisibleInputs(this._visibilityNodeData(nodeData));
        }
        return this._cachedVisibleInputs;
    }

    _getVisibleOutputs(nodeData: HelperNodeDataLike): NodeOutputDefinition[] {
        if (this._cachedVisibleOutputs === null) {
            this._cachedVisibleOutputs = getVisibleOutputs(this._visibilityNodeData(nodeData));
        }
        return this._cachedVisibleOutputs;
    }

    /**
     * Node data with dynamic options resolved, for visibility computation.
     *
     * A `dynamicOptions` dropdown's option list (and therefore its `activeControls`) only
     * exists after resolution, so `getVisibleControls()` would otherwise see no options at
     * all. The returned object is a copy: the raw `nodeData.controls` stay untouched, and
     * the map runs exactly once so resolution cannot loop.
     *
     * @param data - Node state as read from the graph.
     * @returns The same object when no control is dynamic, otherwise a shallow copy.
     */
    _visibilityNodeData<T extends HelperNodeDataLike>(data: T): T {
        const controls = (data.controls || []) as ControlDefinition[];
        if (!controls.some((control) => Boolean(control.dynamicOptions))) {
            return data;
        }
        const resolved = controls.map((control) =>
            this._resolveDynamicControlData(control, data as unknown as NodeState)
        );
        return { ...data, controls: resolved };
    }

    getConnectors(kind: ConnectorKind): ConnectorPosition[] {
        return this._connectorPositions(kind);
    }

    getConnectorPosition(kind: ConnectorKind, index = 0): ConnectorPosition | null {
        const connectors = this._connectorPositions(kind);
        return connectors.find((connector) => connector.index === index) || null;
    }

    hitTestNode(point: Point, padding?: number): boolean {
        return hitTestNodeFn(point, this.getBounds(), padding);
    }

    hitTestConnector(point: Point): ConnectorHitResult | null {
        const data = this.getNodeData();
        if (!data || data.collapsed) {
            return null;
        }

        const connectors = [
            ...this._connectorPositions('input'),
            ...this._connectorPositions('output'),
        ];
        return hitTestConnectorFn(point, connectors, this.nodeId);
    }

    hitTestHeader(point: Point): HeaderHitResult | null {
        return hitTestHeaderFn(point, this.getNodeData());
    }

    hitTestControl(point: Point): ControlHitResult | null {
        return hitTestControlFn(this, point);
    }

    hitTestResizeHandle(point: Point): ResizeHandleHitResult | null {
        return hitTestResizeHandleFn(point, this.getNodeData());
    }

    draw(ctx: CanvasRenderingContext2D | null, options: DrawOptions = {}): void {
        if (!ctx) return;

        const data = this.getNodeData();
        if (!data) return;

        if (data.color && this.style.bodyColor !== data.color) {
            this.style.bodyColor = data.color;
        }

        if (!this._heightValidated || !data.height || data.height <= 0) {
            this.ensureNodeHeight();
        }

        this.ensureNodeWidth();

        drawNode(
            ctx,
            data,
            this.style,
            this.selected,
            { ...options, relatedHighlight: this.relatedHighlight },
            { image: this._iconImage, mdiGlyph: this._iconGlyph },
            (d) => this._getVisibleControls(d),
            (kind) => this._connectorPositions(kind),
            this
        );
    }

    _connectorPositions(kind: ConnectorKind): ConnectorPosition[] {
        const data = this.getNodeData();

        if (kind === 'input') {
            if (this._cachedInputPositions === null) {
                this._cachedInputPositions = computeConnectorPositions(
                    kind,
                    data,
                    (d) => this._getVisibleControls(d),
                    (controlId) => this.controlInstances.get(controlId)
                );
            }
            return this._cachedInputPositions;
        }

        if (this._cachedOutputPositions === null) {
            this._cachedOutputPositions = computeConnectorPositions(
                kind,
                data,
                (d) => this._getVisibleControls(d),
                (controlId) => this.controlInstances.get(controlId)
            );
        }
        return this._cachedOutputPositions;
    }

    showNameEditor(
        canvasPoint: Point,
        canvasElement: HTMLElement,
        viewport: ViewportTransform
    ): void {
        const data = this.getNodeData();
        if (!data) return;

        this.hideEditor();

        const nodeTopLeft = { x: data.x, y: data.y };
        const screenPoint = this._canvasToScreenFn
            ? this._canvasToScreenFn(nodeTopLeft)
            : canvasToScreen(nodeTopLeft, canvasElement, viewport);

        const activeLocale = this.getCurrentLocale();
        const currentLocaleUserName = data.getUserNameForLocale
            ? data.getUserNameForLocale(activeLocale)
            : data.getUserName
              ? data.getUserName(activeLocale)
              : null;

        const controlDefinition: {
            id: string;
            type: string;
            label: string;
            default: unknown;
        } = {
            id: '_node_name',
            type: 'text',
            label: 'Node Name',
            default: currentLocaleUserName || '',
        };

        const tempNodeData = {
            controlValues: {
                _node_name: currentLocaleUserName || '',
            },
        };

        const nameControl = new TextControlUi(controlDefinition, tempNodeData, this, {
            i18nService: this.i18nService,
            logger: this.logger,
        }) as unknown as ControlUiLike;

        const editor = nameControl.renderDOM();
        editor.style.position = 'absolute';
        editor.style.left = `${screenPoint.x}px`;
        editor.style.top = `${screenPoint.y}px`;
        editor.style.zIndex = '1000';

        this._activeNameControl = nameControl;

        const originalNotify = nameControl._notifyChange?.bind(nameControl);
        nameControl._notifyChange = (newValue: unknown) => {
            const newName = String(newValue).trim();
            const currentUserName = data.getUserNameForLocale
                ? data.getUserNameForLocale(activeLocale)
                : data.getUserName
                  ? data.getUserName(activeLocale)
                  : null;
            const nextUserName = (newName || null) as LocaleMapValue;

            if (nextUserName !== currentUserName) {
                if (this.graph && typeof this.graph.updateNode === 'function') {
                    this.graph.updateNode(this.nodeId, {
                        userNameByLocale: {
                            locale: activeLocale,
                            value: nextUserName,
                        },
                    });
                } else {
                    this._log('node-update', 'warn', {
                        message:
                            'Graph updateNode function not available; cannot update node name.',
                    });
                }
            }

            void originalNotify;
        };

        const originalRequestClose = nameControl._requestClose?.bind(nameControl);
        nameControl._requestClose = () => {
            editor.remove();
            this._activeEditor = null;
            this._activeNameControl = null;
            void originalRequestClose;
        };

        const escapeHandler = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                editor.remove();
                this._activeEditor = null;
                this._activeNameControl = null;
                document.removeEventListener('keydown', escapeHandler);
                if (this._activeEditorClickHandler) {
                    document.removeEventListener('mousedown', this._activeEditorClickHandler, true);
                    this._activeEditorClickHandler = null;
                }
            }
        };
        document.addEventListener('keydown', escapeHandler);

        document.body.appendChild(editor);
        this._activeEditor = editor;

        if (nameControl.inputElement) {
            nameControl.inputElement.focus();
            if (nameControl.inputElement instanceof HTMLInputElement) {
                nameControl.inputElement.select();
            }
        }

        const clickAwayHandler = (event: MouseEvent): void => {
            const target = asNode(event.target);
            if (!target || !editor.contains(target)) {
                this.hideEditor();
                document.removeEventListener('keydown', escapeHandler);
                this._activeNameControl = null;
            }
        };
        document.addEventListener('mousedown', clickAwayHandler, true);
        this._activeEditorClickHandler = clickAwayHandler;
    }

    showControlEditor(
        controlId: NodeId,
        canvasPoint: Point,
        canvasElement: HTMLElement,
        viewport: ViewportTransform,
        bounds: Rect | null = null,
        isInputDefault = false
    ): void {
        const data = this.getNodeData();
        if (!data) return;

        // Close any open editor before the control instances are re-created: the editor *is* a
        // control instance's element, so the rebuild would remove it from the document.
        this.hideEditor();
        this._refreshDynamicControls();

        const controlUi = isInputDefault
            ? this.inputDefaultControlInstances.get(controlId)
            : this.controlInstances.get(controlId);

        if (!controlUi) {
            return;
        }

        const editorPoint = bounds ? { x: bounds.x, y: bounds.y } : canvasPoint;
        const screenPoint = this._canvasToScreenFn
            ? this._canvasToScreenFn(editorPoint)
            : canvasToScreen(editorPoint, canvasElement, viewport);

        const editor = controlUi.renderDOM();
        if (!editor) return;

        editor.style.position = 'absolute';
        editor.style.left = `${screenPoint.x}px`;
        editor.style.top = `${screenPoint.y}px`;
        editor.style.zIndex = '1000';

        document.body.appendChild(editor);
        this._activeEditor = editor;

        const inputElement = controlUi.inputElement;
        if (inputElement) {
            inputElement.focus();
        }

        const clickAwayHandler = (event: MouseEvent): void => {
            const target = asNode(event.target);
            if (!target || !editor.contains(target)) {
                this.hideEditor();
            }
        };
        document.addEventListener('mousedown', clickAwayHandler, true);
        this._activeEditorClickHandler = clickAwayHandler;
    }

    _initializeControls(): void {
        // The editor surface of an open control *is* that control instance's element
        // (`showControlEditor()` renders it and appends it to `document.body`). A rebuild
        // therefore removes the field the user is typing in, so it has to wait until the
        // editor is closed — e.g. a `node-updated` refresh of a cross-node dynamic control
        // (Home Assistant entities resolve `availabilityRefs`) fires on the first keystroke.
        if (this._activeEditor) {
            this._pendingControlRefresh = true;
            return;
        }

        this._destroyControlInstances();

        this._invalidateVisibilityCache();

        const data = this.getNodeData();
        if (!data || !data.controls) return;

        data.controls.forEach((controlData) => {
            try {
                const controlId = normalizeNodeId(controlData.id, '');
                if (!controlId) {
                    return;
                }

                const ControlClass = this._getControlClassForType(controlData.type);
                if (!ControlClass) {
                    return;
                }

                const i18nService = this.getI18nService();
                const resolvedControlData = this._resolveDynamicControlData(controlData, data);
                const instance = new ControlClass(resolvedControlData, data, this, {
                    t: i18nService?.t?.bind(i18nService) || ((k: string) => k),
                });
                this.controlInstances.set(controlId, instance);
            } catch {
                // Error creating control
            }
        });
    }

    _initializeInputDefaultControls(): void {
        // Same rule as `_initializeControls()`: the open editor can *be* one of these
        // instances — the store picker is an input default — so destroying it would remove
        // the element the user is picking in. The rebuild waits for the editor to close.
        if (this._activeEditor) {
            this._pendingControlRefresh = true;
            return;
        }

        this._destroyInputDefaultControlInstances();

        const data = this.getNodeData();

        if (!data || !data.inputs) {
            return;
        }

        data.inputs.forEach((inputData) => {
            if (!inputData.defaultControl) {
                this._log('input-default-control', 'warn', {
                    message: 'Input missing defaultControl; skipping (needs type enrichment fix)',
                    inputId: inputData.id,
                });
                return;
            }

            try {
                const inputId = normalizeNodeId(inputData.id, '');
                if (!inputId) {
                    return;
                }

                const controlDef = this._resolveInputDefaultOptions(inputData, inputId, data);

                const ControlClass = this._getControlClassForType(controlDef.type as string);

                if (!ControlClass) {
                    return;
                }

                const defaultVal =
                    inputData.defaultControl.defaultValue !== undefined
                        ? inputData.defaultControl.defaultValue
                        : controlDef.default;

                if (data.inputDefaults[inputId] === undefined) {
                    data.inputDefaults[inputId] =
                        controlDef.type === 'number'
                            ? clampNumericControlValue(
                                  controlDef as NumberControlPayload,
                                  Number.isFinite(Number(defaultVal)) ? Number(defaultVal) : 0
                              )
                            : defaultVal;
                } else if (controlDef.type === 'number') {
                    // Repair an existing stored default that now falls outside the declared
                    // bounds (for example after a definition or signature edit elsewhere). This
                    // keeps the stored value, the canvas editor and the emitted firmware aligned
                    // without recording a graph history entry.
                    const stored = data.inputDefaults[inputId];
                    if (typeof stored === 'number' && Number.isFinite(stored)) {
                        const clamped = clampNumericControlValue(
                            controlDef as NumberControlPayload,
                            stored
                        );
                        if (clamped !== stored) {
                            data.inputDefaults[inputId] = clamped;
                        }
                    }
                }

                const inputDefaultsWrapper = {
                    controlValues: data.inputDefaults,
                };

                const wrappedDef: ControlDefinition = {
                    ...controlDef,
                    id: inputId,
                };

                const i18nService = this.getI18nService();
                const instance = new ControlClass(wrappedDef, inputDefaultsWrapper, this, {
                    t: i18nService?.t?.bind(i18nService) || ((k: string) => k),
                });

                this.inputDefaultControlInstances.set(inputId, instance);
            } catch (error: unknown) {
                this._log('input-default-control', 'error', {
                    message: 'Error creating input default control',
                    inputId: inputData.id,
                    error,
                });
            }
        });
    }

    /**
     * Definition of an input-row default control with its dynamic option list resolved.
     *
     * Input-row defaults are built outside the control machinery, so they never pass through
     * `_resolveDynamicControlData()`. This mirrors that resolver but never writes
     * `controlValues`: the value of an input default lives in `inputDefaults`, and a stored
     * namespace has to survive even when no other node uses it any more.
     *
     * @param inputData - The input whose default control is being built.
     * @param inputId - Normalised input id, used as the control id for resolution.
     * @param data - Node state, carrying both `inputDefaults` and `controlValues`.
     * @returns The definition to instantiate, with resolved options when it is dynamic.
     */
    _resolveInputDefaultOptions(
        inputData: NodeInputLike,
        inputId: NodeId,
        data: NodeState
    ): ControlDefinition {
        const definition = inputData.defaultControl?.getDefinition
            ? inputData.defaultControl.getDefinition()
            : (inputData.defaultControl as unknown as ControlDefinition);

        if (!definition || definition.type !== 'dropdown' || !definition.dynamicOptions) {
            return definition;
        }

        const deviceTarget = this._resolveDeviceTarget ? this._resolveDeviceTarget() : null;
        const resolution = resolveDynamicControl({
            control: {
                id: inputId,
                type: definition.type,
                default: definition.default,
                options: definition.options,
                dynamicOptions: definition.dynamicOptions as Record<string, unknown>,
            },
            nodeData: data,
            deviceTarget,
            graph: this.graph,
            collection: this._collectionSource(),
        });

        if (!resolution) {
            return definition;
        }

        this._inputDefaultDynamicOptions.set(inputId, resolution.options);

        // Seed an unset value only: a stored namespace is never replaced (the rule the
        // graphTopics resolver follows). An empty string counts as unset — a namespace input
        // reads it as the default store, so the picker must not keep showing a stale blank.
        const storedDefault = data.inputDefaults[inputId];
        if (storedDefault === undefined || storedDefault === null || storedDefault === '') {
            data.inputDefaults[inputId] = resolution.value;
        }

        return {
            ...definition,
            options: resolution.options as ControlDefinition['options'],
            disabled: resolution.disabled,
        };
    }

    _destroyControlInstances(): void {
        this.controlInstances.forEach((controlUi) => {
            if (typeof controlUi.destroy === 'function') {
                controlUi.destroy();
            }
        });
        this.controlInstances.clear();
        // The signature describes the instances that were just dropped.
        this._dynamicControlSignature = '';
    }

    _destroyInputDefaultControlInstances(): void {
        this.inputDefaultControlInstances.forEach((controlUi) => {
            if (typeof controlUi.destroy === 'function') {
                controlUi.destroy();
            }
        });
        this.inputDefaultControlInstances.clear();
        this._inputDefaultDynamicOptions.clear();
        this._dynamicControlSignature = '';
    }

    _getControlClassForType(type: string): ControlClass | null {
        switch (type) {
            case 'number':
                return NumberControlUi as unknown as ControlClass;
            case 'text':
                return TextControlUi as unknown as ControlClass;
            case 'dropdown':
                return NodeDropdownControlUi as unknown as ControlClass;
            case 'multi-dropdown':
                return NodeDropdownControlUi as unknown as ControlClass;
            case 'checkbox':
                return CheckboxControlUi as unknown as ControlClass;
            case 'slider':
                return SliderControlUi as unknown as ControlClass;
            case 'color':
                return ColorControlUi as unknown as ControlClass;
            case 'icon':
                return IconControlUi as unknown as ControlClass;
            default:
                return null;
        }
    }

    _resolveDynamicControlData(controlData: ControlDefinition, data: NodeState): ControlDefinition {
        if (!controlData.dynamicOptions) {
            return controlData;
        }

        const deviceTarget = this._resolveDeviceTarget ? this._resolveDeviceTarget() : null;
        const resolution = resolveDynamicControl({
            control: {
                id: controlData.id,
                type: controlData.type,
                default: controlData.default,
                options: controlData.options,
                dynamicOptions: controlData.dynamicOptions as Record<string, unknown>,
            },
            nodeData: data,
            deviceTarget,
            graph: this.graph,
            collection: this._collectionSource(),
        });

        if (!resolution) {
            return controlData;
        }

        data.controlValues[controlData.id] = resolution.value;

        return {
            ...controlData,
            options: resolution.options as ControlDefinition['options'],
            disabled: resolution.disabled,
        };
    }

    /**
     * Signature of the option lists the node's dynamic controls resolve to right now.
     *
     * Resolving a dynamic control also seeds the value the picker shows (`controlValues` for a
     * control, `inputDefaults` for an input row), so this call doubles as the value refresh.
     * Only what the instances draw goes into the signature: the resolved option lists (which
     * carry the echoed sentinel `displayLabel`) and the disabled flag.
     *
     * @returns A stable string for the current resolution, `''` when nothing is dynamic.
     */
    _dynamicOptionSignature(): string {
        const data = this.getNodeData();
        if (!data) {
            return '';
        }

        const entries: string[] = [];

        (data.controls || []).forEach((controlData) => {
            if (!controlData?.dynamicOptions) {
                return;
            }
            const controlId = normalizeNodeId(controlData.id, '');
            if (!controlId) {
                return;
            }
            const resolved = this._resolveDynamicControlData(controlData, data);
            entries.push(
                JSON.stringify([controlId, resolved.options ?? null, resolved.disabled === true])
            );
        });

        (data.inputs || []).forEach((inputData) => {
            const inputId = normalizeNodeId(inputData.id, '');
            if (!inputId) {
                return;
            }
            const definition = inputData.defaultControl?.getDefinition
                ? inputData.defaultControl.getDefinition()
                : (inputData.defaultControl as unknown as ControlDefinition);
            if (!definition?.dynamicOptions) {
                return;
            }
            const resolved = this._resolveInputDefaultOptions(inputData, inputId, data);
            entries.push(
                JSON.stringify([inputId, resolved.options ?? null, resolved.disabled === true])
            );
        });

        return entries.join('\n');
    }

    /**
     * Remember the current option lists as the state the live instances were built from.
     *
     * Called after a full build (`constructor`, `setGraph()`): without it the first graph
     * event would see an unknown signature and rebuild instances that are already correct.
     */
    _recordDynamicSignature(): void {
        this._dynamicControlSignature = this._activeEditor ? '' : this._dynamicOptionSignature();
    }

    /**
     * Re-resolve the pickers that mirror `controlId` and update their row in place.
     *
     * A picker sitting on its "create new…" sentinel renders the text of a companion control
     * (`newNameControls` / `newStoreControls` / `newTopicControls`), so every keystroke in that
     * companion changes the picker's own row. The companion *is* the open editor, so the
     * rebuild is deferred — and re-creating every instance of the node just to pick up one
     * label would also reload the icon glyph. Updating the live instance keeps the row in step
     * with the keystroke and leaves the rest of the node untouched.
     *
     * @param controlId - Control (or input-row default) the user just changed.
     * @returns True when at least one picker was updated in place.
     */
    _refreshCompanionPickers(controlId: NodeId): boolean {
        const data = this.getNodeData();
        if (!data || !controlId) {
            return false;
        }

        let updated = false;

        (data.controls || []).forEach((controlData) => {
            if (!descriptorEchoesControl(controlData?.dynamicOptions, controlId)) {
                return;
            }
            const id = normalizeNodeId(controlData.id, '');
            const instance = id ? this.controlInstances.get(id) : undefined;
            if (!instance) {
                return;
            }
            const resolved = this._resolveDynamicControlData(controlData, data);
            updated = this._applyResolvedOptions(instance, resolved) || updated;
        });

        (data.inputs || []).forEach((inputData) => {
            const inputId = normalizeNodeId(inputData.id, '');
            if (!inputId) {
                return;
            }
            const definition = inputData.defaultControl?.getDefinition
                ? inputData.defaultControl.getDefinition()
                : (inputData.defaultControl as unknown as ControlDefinition);
            if (!descriptorEchoesControl(definition?.dynamicOptions, controlId)) {
                return;
            }
            const instance = this.inputDefaultControlInstances.get(inputId);
            if (!instance) {
                return;
            }
            const resolved = this._resolveInputDefaultOptions(inputData, inputId, data);
            updated = this._applyResolvedOptions(instance, resolved) || updated;
        });

        if (updated) {
            // The row lives on the canvas, not in the DOM: ask for the frame.
            this.requestRepaint();
        }

        return updated;
    }

    /**
     * Push a freshly resolved option list into a live control instance.
     *
     * @param instance - Control instance to update.
     * @param resolved - Definition carrying the resolved options.
     * @returns True when the instance accepted the new list.
     */
    _applyResolvedOptions(instance: ControlUiLike, resolved: ControlDefinition): boolean {
        if (typeof instance.setOptions !== 'function') {
            return false;
        }
        instance.setOptions(resolved.options, resolved.disabled === true);
        return true;
    }

    _refreshDynamicControls(): void {
        if (this._refreshingDynamicControls) {
            return;
        }
        const data = this.getNodeData();
        const hasDynamic = Boolean(
            data?.controls?.some((control) => Boolean(control?.dynamicOptions)) ||
                data?.inputs?.some((input) => {
                    const defaultControl = (input as NodeInputLike).defaultControl;
                    const definition = defaultControl?.getDefinition
                        ? defaultControl.getDefinition()
                        : (defaultControl as unknown as ControlDefinition);
                    return Boolean(definition?.dynamicOptions);
                })
        );
        if (!hasDynamic) {
            return;
        }
        // Resolving a control may write controlValues, which can emit `node-updated` and
        // re-enter the graph listener: the guard makes exactly one refresh happen.
        this._refreshingDynamicControls = true;
        try {
            const signature = this._dynamicOptionSignature();
            if (signature === this._dynamicControlSignature) {
                // Nothing the controls draw has changed. Rebuilding anyway would replace every
                // instance — and the icon control reloads its glyph on each `node-updated` of
                // the graph, which is the flicker a keystroke in an unrelated node caused.
                return;
            }
            this._initializeControls();
            this._initializeInputDefaultControls();
            // A deferred rebuild (open editor) has not happened yet: leave the signature
            // unknown so the flush after the editor closes still sees a difference.
            this._dynamicControlSignature = this._activeEditor ? '' : signature;
        } finally {
            this._refreshingDynamicControls = false;
        }
    }

    /**
     * The active collection as an option source, or null when the node has no workspace.
     *
     * A control whose options come from *other nodes* (`graphTopics`, `availabilityRefs`)
     * has to see the whole collection: the bridge, the availability flags and the entities
     * may live in different graphs.
     *
     * @returns The active collection, when the workspace exposes one.
     */
    _collectionSource(): CollectionSourceLike | null {
        const workspace = this._workspace;
        const getActiveCollection = workspace?.getActiveCollection;
        if (!workspace || typeof getActiveCollection !== 'function') {
            return null;
        }
        return getActiveCollection.call(workspace) || null;
    }

    /**
     * Whether this node owns a control whose options other nodes provide.
     *
     * Input-row default controls count too: the store picker is an input default, and a node
     * whose only cross-node source is that picker still has to re-render when another node
     * adds, renames or removes a namespace.
     *
     * @returns True when the node's option list depends on other nodes.
     */
    _hasCrossNodeControl(): boolean {
        const data = this.getNodeData();
        const usesCrossNodeSource = (descriptor: unknown): boolean => {
            const source = (descriptor as Record<string, unknown> | undefined)?.source;
            return CROSS_NODE_DYNAMIC_SOURCES.includes(String(source ?? ''));
        };

        if (data?.controls?.some((control) => usesCrossNodeSource(control?.dynamicOptions))) {
            return true;
        }

        return Boolean(
            data?.inputs?.some((input) => {
                const defaultControl = (input as NodeInputLike).defaultControl;
                const definition = defaultControl?.getDefinition
                    ? defaultControl.getDefinition()
                    : (defaultControl as unknown as ControlDefinition);
                return usesCrossNodeSource(definition?.dynamicOptions);
            })
        );
    }

    _controlDependsOn(controlId: NodeId): boolean {
        const data = this.getNodeData();
        if (!data || !Array.isArray(data.controls)) {
            return false;
        }

        return data.controls.some((control) => {
            const dependsOn = (control as { dynamicOptions?: { dependsOn?: unknown } })
                .dynamicOptions?.dependsOn;
            return Array.isArray(dependsOn) && dependsOn.includes(controlId);
        });
    }

    hideEditor(): void {
        const activeEditor = this._activeEditor;
        const activeEditorClickHandler = this._activeEditorClickHandler;

        // Clear references first to prevent re-entrant hide calls (e.g. Enter triggering blur).
        this._activeEditor = null;
        this._activeEditorClickHandler = null;

        if (activeEditorClickHandler) {
            document.removeEventListener('mousedown', activeEditorClickHandler, true);
        }

        if (!activeEditor) {
            return;
        }

        const parentNode = activeEditor.parentNode;
        if (parentNode && parentNode.contains(activeEditor)) {
            parentNode.removeChild(activeEditor);
        }

        this._flushPendingControlRefresh();
    }

    /**
     * Run a control rebuild that was deferred because an editor was open.
     *
     * `_initializeControls()` replaces every control instance, so it cannot run while one of
     * those instances is on screen as the editor.
     */
    _flushPendingControlRefresh(): void {
        if (!this._pendingControlRefresh) {
            return;
        }

        this._pendingControlRefresh = false;
        this._refreshDynamicControls();
        // The rebuild swapped in fresh instances — the row the user just edited now carries
        // the typed text — but the frame on the canvas was painted before the flush, so
        // without this request it keeps the pre-close label (the placeholder).
        this.requestRepaint();
    }

    toggleCollapsed(): void {
        const data = this.getNodeData();
        if (data) {
            this.setCollapsed(!data.collapsed);
        }
    }

    handleClick(point: Point, canvasElement: HTMLElement, viewport: ViewportTransform): boolean {
        const controlHit = this.hitTestControl(point);
        if (controlHit) {
            this.showControlEditor(
                controlHit.controlId,
                point,
                canvasElement,
                viewport,
                controlHit.bounds,
                controlHit.isInputDefault || false
            );
            return true;
        }

        const headerHit = this.hitTestHeader(point);
        if (headerHit) {
            if (headerHit.type === 'collapse') {
                this.toggleCollapsed();
                return true;
            }
            if (headerHit.type === 'name') {
                const now = Date.now();
                const isDoubleClick =
                    this._lastClickTarget === 'name' && now - this._lastClickTime < 400;

                if (isDoubleClick) {
                    this.showNameEditor(point, canvasElement, viewport);
                    this._lastClickTime = 0;
                    this._lastClickTarget = null;
                    return true;
                }

                this._lastClickTime = now;
                this._lastClickTarget = 'name';
                return false;
            }
        }

        this._lastClickTime = 0;
        this._lastClickTarget = null;
        return false;
    }

    destroy(): void {
        // Teardown must not rebuild the instances it is about to drop.
        this._pendingControlRefresh = false;
        this.hideEditor();
        this._destroyControlInstances();
        this._destroyInputDefaultControlInstances();
        this._unbindGraph();
        this._unbindCollection();
    }

    _toggleCheckbox(control: NodeControlLike): void {
        const data = this.getNodeData() as NodeState;
        const controlId = normalizeNodeId(control.id, '');
        if (!controlId) {
            return;
        }

        const currentValue = data.controlValues?.[controlId] ?? control.default ?? false;
        const newValue = !currentValue;
        data.controlValues[controlId] = newValue;
        this._updateControlValue(controlId, newValue, currentValue);
    }

    _updateControlValue(controlId: string, value: unknown, oldValue?: unknown): void {
        const data = this.getNodeData();
        if (!data) return;

        this._invalidateVisibilityCache();

        const previousControlValues =
            oldValue !== undefined ? { ...data.controlValues, [controlId]: oldValue } : undefined;
        const previousConnections =
            this.graph && typeof this.graph.getConnectionsForNode === 'function'
                ? this.graph.getConnectionsForNode(this.nodeId)
                : [];

        const explicitPrevious =
            previousControlValues !== undefined
                ? { controlValues: previousControlValues, connections: previousConnections }
                : { connections: previousConnections };

        const control = data.controls?.find((c) => normalizeNodeId(c.id, '') === controlId);
        const needsHeightRecalc =
            Boolean(control) &&
            control?.type === 'dropdown' &&
            (Boolean(control.affectsControls) ||
                Boolean(control.affectsInputs) ||
                Boolean(control.affectsOutputs));

        if (needsHeightRecalc) {
            const newHeight = calculateNodeHeight(
                data,
                (d) => this._getVisibleControls(d),
                (d) => this._getVisibleInputs(d),
                (d) => this._getVisibleOutputs(d)
            );

            if (this.graph && typeof this.graph.updateNode === 'function') {
                this.graph.updateNode(
                    this.nodeId,
                    { controlValues: data.controlValues, height: newHeight },
                    explicitPrevious
                );
            } else {
                data.height = newHeight;
            }
        } else {
            if (this.graph && typeof this.graph.updateNode === 'function') {
                this.graph.updateNode(
                    this.nodeId,
                    { controlValues: data.controlValues },
                    explicitPrevious
                );
            }
        }
    }

    onControlChanged(controlId: string, newValue: unknown, oldValue?: unknown): void {
        const isInputDefault = this.inputDefaultControlInstances.has(controlId);

        if (isInputDefault) {
            const data = this.getNodeData();
            // A new pick may reveal or hide a companion control, so the cached visibility
            // list has to be recomputed before the height is measured again.
            this._invalidateVisibilityCache();
            if (data && this.graph && typeof this.graph.updateNode === 'function') {
                this.graph.updateNode(this.nodeId, { inputDefaults: data.inputDefaults });
            }
        } else {
            this._updateControlValue(controlId, newValue, oldValue);
        }

        const dependsOnChanged = this._controlDependsOn(controlId);

        // A picker can mirror this control: it echoes the text of its companion field or it
        // lists options that depend on it. The echo is updated in place (the companion *is*
        // the open editor, and re-creating the instances would flicker the icon row), while a
        // real dependency change goes through the deferred, signature-guarded rebuild.
        const mirrored = this._refreshCompanionPickers(controlId);
        if (mirrored || dependsOnChanged) {
            // An input default can be a dependency too (the store picker): a control such as
            // the name picker then needs its option list rebuilt as well.
            this._refreshDynamicControls();
        }

        const controlUi = isInputDefault
            ? this.inputDefaultControlInstances.get(controlId)
            : this.controlInstances.get(controlId);

        if (controlUi && controlUi.closeOnChange) {
            this.hideEditor();
        }
    }

    onControlVisibilityChanged(event: {
        controlId: string;
        activeInputs: string[];
        activeControls: string[];
    }): void {
        const data = this.getNodeData();
        if (!data) {
            return;
        }

        const oldHeight = data.height;
        const newHeight = calculateNodeHeight(
            data,
            (d) => this._getVisibleControls(d),
            (d) => this._getVisibleInputs(d),
            (d) => this._getVisibleOutputs(d)
        );

        if (this.graph && typeof this.graph.updateNode === 'function') {
            this.graph.updateNode(this.nodeId, {
                controlValues: data.controlValues,
                height: newHeight,
            });
        } else {
            data.height = newHeight;
        }

        void oldHeight;
        void event;

        if (!this.graph) {
            // No graph, visibility change stored but no redraw
        }
    }

    reloadIcon(): void {
        this._iconImage = null;
        this._iconGlyph = null;
        this._iconLoaded = false;
        this._loadIcon();
    }

    /**
     * Repaint this node in the graph view.
     *
     * Used by control renderers that draw lazily loaded resources: the icon control paints
     * the MDI glyph on the canvas, which is only possible once the webfont and the icon
     * index have arrived. Without a repaint hook the canvas would keep the text-only
     * rendering until something else redraws the node.
     */
    requestRepaint(): void {
        if (typeof this._onRepaintRequest === 'function') {
            this._onRepaintRequest(this.nodeId);
        }
    }

    _loadIcon(): void {
        const data = this.getNodeData();

        if (!data) {
            return;
        }

        let iconPath: string | null = null;
        if (this._workspace) {
            const runtime = this._workspace.runtimeCollection?.getActiveRuntime();
            if (runtime) {
                const nodeType = runtime.getNodeType(data.type);
                if (nodeType && nodeType.icon) {
                    iconPath = nodeType.icon;
                }
            }
        }

        if (!iconPath) {
            iconPath = data.icon || null;
        }

        if (!iconPath) {
            return;
        }

        this._iconImage = null;
        this._iconGlyph = null;

        const description = IconProvider.describeIcon(iconPath);

        if (description.kind === 'mdi') {
            this._loadMdiGlyph(description.value);
            return;
        }

        if (description.kind === 'text') {
            this._iconGlyph = description.glyph || null;
            return;
        }

        this._iconImage = new Image();
        this._iconImage.onload = () => {
            this._iconLoaded = true;

            if (typeof this._onIconLoad === 'function') {
                this._onIconLoad(this.nodeId);
            }
        };
        this._iconImage.onerror = (_error: unknown) => {
            this._iconImage = null;
            this._iconLoaded = false;
        };
        this._iconImage.src = description.src;
    }

    /**
     * Resolve an `mdi:` icon to its webfont glyph and repaint once it is paintable.
     *
     * Both lazy resources must be ready — the index (codepoint) and the webfont (glyph) — so the
     * glyph is only stored after `ensureMdiGlyphFont()` resolves `'ready'`; until then the header
     * keeps its placeholder square. This mirrors the icon control's async-ready/repaint pattern.
     * @param value - The `mdi:` icon value, e.g. `mdi:function`.
     */
    _loadMdiGlyph(value: string): void {
        void loadMdiIconIndex().then((index) => {
            const glyph = resolveMdiGlyph(value, index);
            if (!glyph) {
                return;
            }

            void ensureMdiGlyphFont().then((status) => {
                if (status === 'ready') {
                    this._iconGlyph = glyph;
                    this.requestRepaint();
                }
            });
        });
    }

    _bindGraph(graph: NodeGraphLike | null): void {
        if (!graph || typeof graph.on !== 'function') {
            return;
        }

        // A topic or flag becomes selectable in *other* nodes only once the graph announces
        // the change, so every node with an option list from other nodes listens for nodes
        // appearing, changing and vanishing.
        const refresh = (): void => {
            if (this._hasCrossNodeControl()) {
                this._refreshDynamicControls();
            }
        };

        graph.on('node-added', refresh);
        graph.on('node-updated', refresh);
        graph.on('node-removed', refresh);

        if (typeof graph.off === 'function') {
            this._unsubscribe = () => {
                graph.off?.('node-added', refresh);
                graph.off?.('node-updated', refresh);
                graph.off?.('node-removed', refresh);
            };
        }
    }

    _unbindGraph(): void {
        if (typeof this._unsubscribe === 'function') {
            try {
                this._unsubscribe();
            } catch {
                // ignore cleanup errors
            }
        }
        this._unsubscribe = null;
    }

    /**
     * Subscribe to the collection this node belongs to.
     *
     * A node's option list may be fed by *other* graphs: `varNames` / `varStores` are
     * collection-wide, and the topic and availability sources span graphs too. `_bindGraph()`
     * only reports changes of this node's own graph, so a graph tab that was rendered earlier
     * would keep the list it resolved back then — a variable created in graph A never showed
     * up in the pickers of graph B. Listening to the foreign graphs closes that gap.
     *
     * Only cross-node sources pay for it: a node whose options are static subscribes to
     * nothing.
     */
    _bindCollection(): void {
        this._unbindCollection();

        if (!this._hasCrossNodeControl()) {
            return;
        }

        const collection = this._collectionSource();
        if (!collection) {
            return;
        }

        this._subscribeForeignGraphs();

        if (typeof collection.on === 'function') {
            // Graphs come and go while this node lives: rebuild the observed set instead of
            // keeping a subscription for a graph that was removed.
            const unsubscribe = collection.on('*', (event: unknown) => {
                this._onCollectionEvent(event);
            });
            this._collectionUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
        }
    }

    _unbindCollection(): void {
        if (typeof this._collectionUnsubscribe === 'function') {
            try {
                this._collectionUnsubscribe();
            } catch {
                // ignore cleanup errors
            }
        }
        this._collectionUnsubscribe = null;

        this._foreignGraphUnsubscribe.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch {
                // ignore cleanup errors
            }
        });
        this._foreignGraphUnsubscribe.clear();
    }

    /**
     * Keep the foreign-graph subscriptions current after the graph set changed.
     *
     * @param event - Collection event envelope.
     */
    _onCollectionEvent(event: unknown): void {
        const name = (event as { name?: string } | null)?.name;
        if (name !== 'graphAdded' && name !== 'graphRemoved') {
            return;
        }

        this._subscribeForeignGraphs();

        if (this._hasCrossNodeControl()) {
            this._refreshDynamicControls();
        }
    }

    /**
     * Observe node events of every graph in the collection except this node's own graph.
     */
    _subscribeForeignGraphs(): void {
        const collection = this._collectionSource();
        const graphs =
            typeof collection?.getGraphArray === 'function' ? collection.getGraphArray() : [];
        const seen = new Set<unknown>();
        if (this.graph) {
            seen.add(this.graph);
        }

        graphs.forEach((graph) => {
            if (!graph || seen.has(graph)) {
                return;
            }
            seen.add(graph);
            if (this._foreignGraphUnsubscribe.has(graph)) {
                return;
            }
            const unsubscribe = this._subscribeGraphNodes(graph as NodeGraphLike);
            if (unsubscribe) {
                this._foreignGraphUnsubscribe.set(graph, unsubscribe);
            }
        });

        // Drop the subscriptions of graphs that left the collection.
        this._foreignGraphUnsubscribe.forEach((unsubscribe, graph) => {
            if (seen.has(graph)) {
                return;
            }
            try {
                unsubscribe();
            } catch {
                // ignore cleanup errors
            }
            this._foreignGraphUnsubscribe.delete(graph);
        });
    }

    /**
     * Refresh this node whenever a node of another graph appears, changes or vanishes.
     *
     * @param graph - Foreign graph to observe.
     * @returns Teardown for the subscriptions, or null when the graph cannot be observed.
     */
    _subscribeGraphNodes(graph: NodeGraphLike): (() => void) | null {
        if (typeof graph.on !== 'function') {
            return null;
        }

        const refresh = (): void => {
            if (this._hasCrossNodeControl()) {
                this._refreshDynamicControls();
            }
        };

        graph.on('node-added', refresh);
        graph.on('node-updated', refresh);
        graph.on('node-removed', refresh);

        return () => {
            graph.off?.('node-added', refresh);
            graph.off?.('node-updated', refresh);
            graph.off?.('node-removed', refresh);
        };
    }
}

export default NodeUi;
