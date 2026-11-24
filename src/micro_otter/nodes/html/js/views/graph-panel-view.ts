/**
 * GraphPanelView extends ViewBase for rendering and interactions with node graphs.
 * Provides canvas-based node rendering, connections, viewport controls, and drop target support.
 *
 * Phase 4 refactoring: Now extends ViewBase for proper lifecycle management, serialization,
 * and integration with ViewManager and i18n services.
 *
 * Modularization Progress (from 3,172 lines):
 * ✅ Phase 1: GraphPanelViewport (247 lines) - Coordinate transforms, pan, zoom
 * ✅ Phase 2: GraphPanelSelection (233 lines) - Selection state and operations
 * ✅ Phase 3: GraphPanelClipboard (184 lines) - Copy/cut/paste/duplicate operations
 * ✅ Phase 4: GraphPanelInteraction (699 lines) - Mouse/keyboard handlers, drag operations
 * ✅ Phase 5: GraphPanelRendering (362 lines) - Canvas rendering logic
 *
 * Current size: ~2,400 lines (down from 3,243 lines, 26% reduction)
 * Remaining: Core orchestration, graph synchronization, event handling, utilities
 *
 * Current size: ~1,900 lines (target: ~1,800-2,000 lines) ✅
 *
 * Key responsibilities:
 * - Canvas rendering (delegated to GraphPanelRendering)
 * - Viewport management (delegated to GraphPanelViewport)
 * - Selection state (delegated to GraphPanelSelection)
 * - Clipboard operations (delegated to GraphPanelClipboard)
 * - User interactions (delegated to GraphPanelInteraction)
 * - Drop target for NodeTypeUi from palette
 * - Serialization of viewport/grid state
 * - Integration with NodeGraph data backbone
 */
import { NodeUi } from '../nodes/node-ui.js';
import ConnectionsUi from '../nodes/connections-ui.js';
import { getConnectionControlOffset } from '../nodes/connection-geometry.js';
import { ViewBase } from './view-base.js';
import NodeData from '../data/node-data.js';
import type {
    DocumentationAreaBounds,
    DocumentationAreaData,
    DocumentationAreaDragMode,
} from '../data/documentation-area.js';
import { clipboardManager } from '../core/clipboard-manager.js';
import { ViewportConfig } from '../data/viewport-config.js';
import { MenuWindow } from './menu-window.js';
import { IconProvider } from './icon-provider.js';
import { ToolbarView } from './toolbar-view.js';
import { GraphPanelDocumentationLayer } from './graph-panel-documentation-layer.js';
import { hitTestDocumentationAreas } from './documentation-area-hit-test.js';
import { createDocumentationAreaMenuItems } from './documentation-area-menu.js';
import { normalizeAreaColor } from '../data/documentation-area.js';
import {
    DOCUMENTATION_AREA_DEFAULT_COLOR,
    DOCUMENTATION_AREA_DEFAULT_SIZE,
    DOCUMENTATION_AREA_MIN_SIZE,
} from '../data/documentation-area.js';
import {
    DropdownControl,
    NumberControl,
} from './controls/custom-runtime-controls.js';
import {
    DropdownControl as SignalDropdownControl,
    type DropdownOption,
} from './controls/dropdown-control.js';
import {
    DEFAULT_EXECUTION_TYPE,
    DEFAULT_SIGNAL_MODE,
    DEFAULT_SLEEP_MS,
    MIN_SLEEP_MS,
    MAX_SLEEP_MS,
    clampSleepDuration,
    normalizeExecutionType,
    normalizeGraphEnabled,
    normalizeRunOnStart,
    normalizeSignalMode,
    normalizeSignalNames,
    normalizeTriggerName,
} from '../data/graph-execution-settings.js';
import {
    CUSTOM_SIGNAL_CONTROL_ID,
    SIGNAL_CONTROL_ID,
    collectSignalNames,
} from '../nodes/signal-names.js';
import {
    isFunctionNodeTypeId,
    resolveFunctionNodeDefinition,
} from '../data/function-node-definition.js';
import {
    FUNCTION_INPUT_GRAPH_ITEM_ID,
    FUNCTION_OUTPUT_GRAPH_ITEM_ID,
} from '../nodes/organizational-palette.js';
import { isFunctionGraphManagedNodeType } from '../data/graph-function-nodes.js';
import { NodeInfoView } from './node-info-view.js';
import { buildNodeInfoContent } from './node-info-content.js';
import type { NodeInfoSource } from './node-info-content.js';
import { resolveDeclaredInputSources } from '../data/type-conversions.js';
import { GraphPanelViewport } from './graph-panel-viewport.js';
import { GraphPanelSelection } from './graph-panel-selection.js';
import { GraphPanelClipboard } from './graph-panel-clipboard.js';
import { GraphPanelInteraction } from './graph-panel-interaction.js';
import {
    GraphPanelRendering,
    collectRelatedNodeIds,
    orderNodeIdsForHitTesting,
} from './graph-panel-rendering.js';
import { AppPayload, assertAppEventPayloadType } from '../core/app-event.js';
import DeviceTargetInfo from '../data/device-target.js';
import {
    validateNodeCapabilities,
    type CapabilityValidationContext,
    type NodeCapabilityIssue,
    type TargetCapabilitySnapshot,
} from '../core/node-capability-validator.js';
import { validateGraphResources } from '../core/graph-resource-validator.js';
import { validateGraphRules } from '../core/graph-rule-registry.js';
import { collectIrqTriggerNames } from '../nodes/irq-triggers.js';
import { createMissingNodeTypeIssue } from '../core/missing-node-type-issue.js';
// Registers the built-in MQTT topic rules (and the global GraphRules/GraphTopicRules
// bridges) into the shared registry at module load.
import '../core/graph-topic-validator.js';
import { resolveNodeWidth, resolveEffectiveMinWidth } from '../data/node-width.js';
import {
    buildControlValuesForRuntimeSnapshot,
    collectRuntimeDefinitionNodePatches,
} from '../data/runtime-node-definition-migration.js';

type NodeId = string;
type Point = { x: number; y: number };
type Size = { width: number; height: number };
type RenderQualityMode = 'full' | 'interaction';
type Nullable<T> = T | null;
type Unsubscribe = (() => void) | null;
type LoggerFn = (message: string, level?: unknown, ...data: unknown[]) => void;
type ViewBaseOptions = NonNullable<ConstructorParameters<typeof ViewBase>[0]>;

interface GraphNodeLike {
    id?: NodeId;
    type?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
    [key: string]: unknown;
}

/** Read-only view of a stored viewport configuration (`ViewportConfig` instance or plain data). */
interface ViewportConfigLike {
    translateX?: number;
    translateY?: number;
    scale?: number;
}

interface GraphLike {
    id?: NodeId;
    nodes?: GraphNodeLike[];
    getName?: () => string;
    getNodeIds?: () => NodeId[];
    getNodes?: () => GraphNodeLike[];
    getNode?: (nodeId: NodeId) => GraphNodeLike | null;
    getExecutionType?: () => unknown;
    setExecutionType?: (executionType: unknown) => void;
    ensureFunctionStructuralNode?: (
        kind: 'input' | 'output',
        position?: { x: number; y: number }
    ) => {
        node: { id?: NodeId } | null;
        created: boolean;
    };
    /** Generated function node type id of this graph (`function_graph.<id>`). */
    getFunctionNodeTypeId?: () => string;
    getTriggerName?: () => unknown;
    setTriggerName?: (name: string) => void;
    getSignalNames?: () => unknown;
    setSignalNames?: (names: string[]) => void;
    getSignalMode?: () => unknown;
    setSignalMode?: (mode: unknown) => void;
    getRunOnStart?: () => unknown;
    getEnabled?: () => boolean;
    setEnabled?: (enabled: boolean) => void;
    getTriggerInterval?: () => number;
    setTriggerInterval?: (intervalMs: number) => void;
    getViewportConfig?: () => ViewportConfigLike | null;
    setViewportConfig?: (config: ViewportConfig) => unknown;
    getConnections?: () => Array<{
        fromNode: NodeId;
        fromIndex: number;
        toNode: NodeId;
        toIndex: number;
    }>;
    addNode?: (node: unknown) => unknown;
    removeNode?: (nodeId: NodeId) => boolean;
    startNodeDrag?: (nodeId: NodeId) => unknown;
    endNodeDrag?: (nodeId: NodeId) => unknown;
    updateNode?: (
        nodeId: NodeId,
        patch: Record<string, unknown>,
        previous?: Record<string, unknown>
    ) => void;
    getDocumentationAreas?: () => DocumentationAreaData[];
    getDocumentationArea?: (areaId: string) => DocumentationAreaLike | null;
    getDocumentationAreaIndex?: (areaId: string) => number;
    hasDocumentationArea?: (areaId: string) => boolean;
    addDocumentationArea?: (data?: Partial<DocumentationAreaData>) => DocumentationAreaLike | null;
    restoreDocumentationArea?: (
        data: DocumentationAreaData,
        index?: number
    ) => DocumentationAreaLike | null;
    updateDocumentationArea?: (
        areaId: string,
        patch: Record<string, unknown>
    ) => DocumentationAreaLike | null;
    setDocumentationAreaBounds?: (areaId: string, bounds: unknown) => DocumentationAreaLike | null;
    removeDocumentationArea?: (areaId: string) => boolean;
    startDocumentationAreaDrag?: (
        areaId: string,
        mode?: DocumentationAreaDragMode
    ) => boolean;
    endDocumentationAreaDrag?: (areaId: string) => boolean;
    on?: (eventName: string, listener: (event: unknown) => void) => Unsubscribe;
}

/**
 * Documentation-area entry points of the clipboard facade.
 *
 * They are optional so the menu keeps its shape while the cross-graph clipboard work lands; the
 * actions simply report `false` until the facade implements them.
 */
interface DocumentationAreaClipboardLike {
    copyArea?: (areaId: string) => boolean;
    cutArea?: (areaId: string) => boolean;
    pasteAreaAt?: (areaId: string, position: { x: number; y: number }) => boolean;
}

/** Live documentation-area instance as seen from the panel (data + a serializer). */
interface DocumentationAreaLike {
    id: string;
    title: string;
    markdown: string;
    color: string;
    bounds: DocumentationAreaBounds;
    toData: () => DocumentationAreaData;
}

/** Minimal shape of a `ToolbarView` button control (see `console-log-view.ts`). */
interface ToolbarButtonControl {
    element: HTMLButtonElement | null;
}

interface CollectionLike {
    getTargetId?: () => string | null;
    getDeviceRuntimeId?: () => string | null;
    getGraphArray?: () => Array<{
        getNodes?: () => unknown[] | Record<string, unknown>;
    }>;
    on?: (eventName: string, listener: (event: unknown) => void) => Unsubscribe;
    getHistoryManager?: () => {
        beforeNodeRemove?: (nodeId: NodeId) => void;
        beforeDocumentationAreaRemove?: (areaId: string) => void;
        beginGroup?: (description: string) => void;
        endGroup?: () => void;
        recordSelectionChange?: (
            previousNodeIds: readonly string[],
            nextNodeIds: readonly string[],
            description?: string
        ) => boolean;
        onSelectionHistoryApplied?: (
            listener: (payload: { selectedNodeIds: NodeId[] }) => void
        ) => () => void;
    } | null;
}

interface RuntimeLike {
    getNodeType: (typeId: string) => NodeTypeLike | null;
    getDeviceTarget?: (targetId: string) => {
        capabilityToPins?: Record<string, unknown>;
        generalCapabilities?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    } | null;
}

interface WorkspaceLike {
    config?: {
        grid?: {
            size?: number;
            intervalMajor?: number;
            snapEnabled?: boolean;
            visible?: boolean;
        };
    };
    /** Active collection; a generated function node is resolved through its graphs. */
    getActiveCollection?: () => { getGraphArray?: () => unknown } | null;
    runtimeCollection?: {
        getActiveRuntime?: () => RuntimeLike | null;
        getRuntime?: (runtimeId: string) => RuntimeLike | null;
        on?: (eventName: string, listener: (event: unknown) => void) => (() => void) | void;
    };
    getUserTargetConfig?: (
        id: string
    ) => Promise<{ targetData?: Record<string, unknown> | null } | null>;
}

interface ViewManagerLike {
    addOverlay: (view: unknown, options?: Record<string, unknown>) => any;
}

interface NodeTypeLike {
    title?: string | Record<string, string>;
    info?: string | Record<string, string>;
    docsUrl?: string;
    icon?: string;
    color?: string;
    defaultWidth?: number;
    minWidth?: number;
    maxWidth?: number;
    inputs?: Array<{
        id: string;
        name: string | Record<string, string>;
        icon?: string;
        defaultControl?: unknown;
        allowedTypes?: string[];
        initialTypes?: string[];
    }>;
    outputs?: Array<{
        id: string;
        name: string | Record<string, string>;
        icon?: string;
        outputType?: string;
        outputTypeControl?: string;
        outputTypeByControlValue?: Record<string, unknown>;
        initialTypes?: string[];
    }>;
    controls?: Array<{
        id: string;
        type: string;
        label: string | Record<string, string>;
        defaultValue?: unknown;
        min?: number;
        max?: number;
        step?: number;
        options?: unknown[];
        getOptions?: () => unknown[];
        affectsControls?: unknown;
        affectsInputs?: unknown;
        affectsOutputs?: unknown;
    }>;
}

interface GraphPanelViewOptions {
    graph?: GraphLike;
    collection?: CollectionLike;
    workspace?: WorkspaceLike | null;
    viewManager?: ViewManagerLike | null;
    onSelect?: ((nodeId: Nullable<NodeId>) => void) | null;
    onRenderExternal?:
        | ((state: { overlay: OverlayState; selectedNodeId: Nullable<NodeId> }) => void)
        | null;
    enableReadabilityCanvas?: boolean;
    maxGridMajorIntervals?: Size;
    title?: string;
    icon?: string | null;
    i18nService?: ViewBaseOptions['i18nService'];
    logger?: LoggerFn;
    [key: string]: unknown;
}

interface OverlayState {
    hoverConnector: unknown;
    hoverConnection?: unknown;
    tempConnection: unknown;
}

interface SelectionChangedPayloadParams {
    selectedNodes: NodeId[];
    count: number;
}

interface NodesMovedPayloadParams {
    nodeIds: NodeId[];
}

/** Multiplicative zoom applied per wheel notch (5 %; one notch used to be 10 %). */
const WHEEL_ZOOM_STEP = 1.05;

/** Debounce for writing interactive viewport changes into the graph document. */
const VIEWPORT_PERSIST_DEBOUNCE_MS = 250;

function normalizeNodeId(value: unknown): NodeId | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

/**
 * Payload for `selection-changed` events emitted by GraphPanelView.
 */
class GraphPanelViewSelectionChangedPayload extends AppPayload {
    selectedNodes: NodeId[];
    count: number;
    /**
     * @param {object} params - Aggregated payload members for selection changes.
     * @param {string[]} params.selectedNodes - IDs of nodes currently selected.
     * @param {number} params.count - Number of selected nodes.
     */
    constructor({ selectedNodes, count }: SelectionChangedPayloadParams) {
        super('GraphPanelView.SelectionChanged.v1');
        this.selectedNodes = selectedNodes;
        this.count = count;
    }
}

/**
 * Payload for `nodes-moved` events emitted by GraphPanelView.
 */
class GraphPanelViewNodesMovedPayload extends AppPayload {
    nodeIds: NodeId[];
    /**
     * @param {object} params - Aggregated payload members for node move operations.
     * @param {string[]} params.nodeIds - IDs of nodes moved during the interaction.
     */
    constructor({ nodeIds }: NodesMovedPayloadParams) {
        super('GraphPanelView.NodesMoved.v1');
        this.nodeIds = nodeIds;
    }
}

/**
 * GraphPanelView hosts graph-canvas interaction and rendering.
 *
 * Emitted Events:
 * - `selection-changed` -> `payloadTypeId: GraphPanelView.SelectionChanged.v1` -> `GraphPanelViewSelectionChangedPayload`
 * - `nodes-moved` -> `payloadTypeId: GraphPanelView.NodesMoved.v1` -> `GraphPanelViewNodesMovedPayload`
 */
export class GraphPanelView extends ViewBase {
    graph: GraphLike | undefined;
    collection: CollectionLike | undefined;
    workspace: WorkspaceLike | null;
    viewManager: ViewManagerLike | null;

    onSelect: (nodeId: Nullable<NodeId>) => void;
    onRenderExternal:
        | ((state: { overlay: OverlayState; selectedNodeId: Nullable<NodeId> }) => void)
        | null;
    enableReadabilityCanvas: boolean;
    maxGridMajorIntervals: Size;

    constants: Record<string, unknown>;
    gridEnabled: boolean;
    showGrid: boolean;

    viewportModule: GraphPanelViewport;
    majorGridSpacing: number;
    gridSizeWorld: Size;

    selection: GraphPanelSelection;
    clipboard: GraphPanelClipboard;
    selectedNodeId: Nullable<NodeId>;
    activeNodeId: Nullable<NodeId>;
    /** Currently activated documentation area (view state only, never persisted). */
    activeDocumentationAreaId: string | null;
    /** DOM layer that renders documentation-area titles and Markdown bodies. */
    documentationLayer: GraphPanelDocumentationLayer | null;
    /** Burger/context-menu entry point for an area; assigned by the menu wiring. */
    _showDocumentationAreaMenu: ((areaId: string, anchor: DOMRect) => void) | null;
    /** Active move/resize gesture on a documentation area, if any. */
    _documentationAreaDrag: {
        areaId: string;
        mode: 'move' | 'resize';
        startBounds: DocumentationAreaBounds;
        startWorld: { x: number; y: number };
    } | null;

    clipboardManager: typeof clipboardManager;
    _activeContextMenu: unknown;
    _activeInfoOverlay: unknown;

    interactionModule: Nullable<GraphPanelInteraction>;

    nodeUiMap: Map<NodeId, NodeUi>;
    nodeOrderList: NodeId[];
    _graphUnsubscribe: Unsubscribe;
    _graphChangeUnsubscribe: Unsubscribe;
    _collectionChangeUnsubscribe: Unsubscribe;
    _runtimeCollectionUnsubscribe: Unsubscribe;
    _historySelectionUnsubscribe: Unsubscribe;
    _isApplyingSelectionHistory: boolean;

    boundHandlers: Array<{
        target: EventTarget;
        type: string;
        handler: EventListenerOrEventListenerObject;
        options?: AddEventListenerOptions | boolean;
    }>;
    canvas: HTMLCanvasElement | null;
    readabilityCanvas: HTMLCanvasElement | null;
    backgroundCanvas: HTMLCanvasElement | null;
    ownsCanvas: boolean;
    ownsReadabilityCanvas: boolean;
    ownsBackgroundCanvas: boolean;
    _windowResizeHandler: ((event: UIEvent) => void) | null;
    _visibilityObserver: IntersectionObserver | null;
    _isVisible: boolean;
    _pendingRenderOnShow: boolean;
    renderQualityMode: RenderQualityMode;
    _renderPending: boolean;
    _renderRafId: number | null;
    resizeObserver: ResizeObserver | null;
    canvasDPR: number;
    _capabilityTooltipEl: HTMLDivElement | null;

    _bound: Record<string, EventListener | null>;
    _documentDragHandlers: {
        mousemove: ((event: MouseEvent) => void) | null;
        mouseup: (() => void) | null;
    };
    _isDraggingActive: boolean;
    _eventsBound: boolean;

    connectionsUi: ConnectionsUi;
    rendering: GraphPanelRendering;
    declare interaction: { draggingConnection: unknown };

    lastClick: Point;
    _resizeDebounceTimer: ReturnType<typeof setTimeout> | null;

    /** Pending debounce timer for persisting viewport changes into the graph document. */
    _viewportPersistTimer: ReturnType<typeof setTimeout> | null;
    /** True once the opening viewport has been resolved for the currently bound graph. */
    _initialViewportApplied: boolean;

    /** Root element of the panel layout (toolbar row above the canvas area). */
    #rootEl: HTMLDivElement | null = null;
    /** Host element for the panel toolbar. */
    #toolbarHost: HTMLDivElement | null = null;
    /** Host element for the canvases and transient overlays. */
    #canvasHost: HTMLDivElement | null = null;

    /** Toolbar mounted in the panel's toolbar host. */
    #toolbarView: ToolbarView | null = null;
    /** Guard so the control set is built exactly once per toolbar instance. */
    #toolbarControlsCreated = false;
    /** Align-to-grid button, kept for label/enabled-state updates. */
    #alignButton: HTMLButtonElement | null = null;
    /** Execution-type dropdown control. */
    #executionTypeControl: DropdownControl | null = null;
    /** Host element of the execution-type control. */
    #executionTypeHost: HTMLDivElement | null = null;
    /** Interrupt-name dropdown control. */
    #triggerNameControl: DropdownControl | null = null;
    /** Host element of the interrupt-name control. */
    #triggerNameHost: HTMLDivElement | null = null;
    /** Signals multi-select control (shared dropdown in its `multiSelect` variant). */
    #signalNamesControl: SignalDropdownControl | null = null;
    /** Host element of the signals multi-select. */
    #signalNamesHost: HTMLDivElement | null = null;
    /** Trigger-mode (`any`/`all`) dropdown control. */
    #signalModeControl: DropdownControl | null = null;
    /** Host element of the trigger-mode control. */
    #signalModeHost: HTMLDivElement | null = null;
    /**
     * Option values currently rendered by the signals picker.
     *
     * The picker is rebuilt only when this list differs, so refreshing on a graph event
     * never resets an open menu.
     */
    #signalOptionValues: string[] = [];
    /** Sleep-duration number control. */
    #sleepControl: NumberControl | null = null;
    /** Host element of the sleep-duration control. */
    #sleepHost: HTMLDivElement | null = null;
    /** True while the opening viewport is resolved; keeps the resolution out of the document. */
    #applyingInitialViewport = false;
    /**
     * Create a new GraphPanelView instance.
     * @param {object} options
     * @param {object} options.graph - NodeGraph instance (data backbone)
     * @param {object} options.collection - Collection instance (parent)
     * @param {object} [options.workspace] - Workspace instance for configuration
     * @param {object} [options.viewManager] - ViewManager instance for overlay management
     * @param {Function} [options.onSelect] - Callback invoked on node selection change
     * @param {Function} [options.onRenderExternal] - Optional external renderer
     * @param {boolean} [options.enableReadabilityCanvas=false] - Whether to use offscreen canvas
     * @param {object} [options.maxGridMajorIntervals] - Max grid intervals {width, height}
     *   bounding the graph canvas in world space (defaults to `{ width: 128, height: 64 }`)
     * @param {string} [options.title] - View title (defaults to graph name)
     * @param {string} [options.icon] - View icon
     * @param {object} [options.i18nService] - I18nService instance
     * @param {Function} [options.logger] - Logger function
     *
     * Emitted Events:
     * - `selection-changed` -> `payloadTypeId: GraphPanelView.SelectionChanged.v1` -> `GraphPanelViewSelectionChangedPayload`
     * - `nodes-moved` -> `payloadTypeId: GraphPanelView.NodesMoved.v1` -> `GraphPanelViewNodesMovedPayload`
     */
    constructor({
        graph,
        collection,
        workspace = null,
        viewManager = null,
        onSelect,
        onRenderExternal,
        enableReadabilityCanvas = false,
        maxGridMajorIntervals = { width: 128, height: 64 },
        title,
        icon = null,
        i18nService,
        logger,
        ...rest
    }: GraphPanelViewOptions = {}) {
        // Call ViewBase constructor with title/icon/i18n
        super({
            title: title || graph?.getName() || 'Graph Panel',
            icon,
            i18nService,
            logger,
            ...rest,
        });

        // Store references to data backbone and view manager
        this.graph = graph;
        this.collection = collection;
        this.workspace = workspace;
        this.viewManager = viewManager;

        // Callbacks
        this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
        this.onRenderExternal = typeof onRenderExternal === 'function' ? onRenderExternal : null;
        this.enableReadabilityCanvas = enableReadabilityCanvas;
        this.maxGridMajorIntervals = maxGridMajorIntervals;

        // Load grid configuration from workspace (Phase 4)
        const workspaceConfig = workspace?.config || {};
        const gridConfig = workspaceConfig.grid || {};

        this.constants = {
            GRID_SPACING: gridConfig.size || 32,
            GRID_MAJOR_INTERVAL: gridConfig.intervalMajor || 5,
            GRID_MINOR_COLOR: 'rgba(235, 238, 246, 0.12)',
            GRID_MAJOR_COLOR: 'rgba(235, 238, 246, 0.24)',
            NODE_FILL: '#51607c',
            NODE_STROKE: '#e8ebf7',
            NODE_SELECTED: '#f0d858',
            NODE_TEXT: '#f5f5f5',
            CONNECTOR_RADIUS: 7,
            TEMP_CONN_COLOR: 'rgba(240, 216, 88, 0.8)',
        };

        // Grid settings (Phase 4)
        this.gridEnabled = gridConfig.snapEnabled !== false; // Default true
        this.showGrid = gridConfig.visible !== false; // Default true

        // Phase 1 Refactoring: Viewport module (2026-01-26)
        this.viewportModule = new GraphPanelViewport({
            constants: this.constants,
            workspace: this.workspace,
            maxGridMajorIntervals: this.maxGridMajorIntervals,
            onViewportChange: () => this.#scheduleViewportPersist(),
        });

        // Convenience accessors for backward compatibility
        this.majorGridSpacing = this.viewportModule.majorGridSpacing;
        this.gridSizeWorld = this.viewportModule.gridSizeWorld;

        // Phase 2 Refactoring: Selection module (2026-01-26)
        this.selection = new GraphPanelSelection();

        // Phase 3 Refactoring: Clipboard module (2026-01-26)
        const clipboardHistoryManager = this.collection?.getHistoryManager?.() || null;
        this.clipboard = new GraphPanelClipboard({
            graph: this.graph,
            clipboardManager: clipboardManager,
            viewport: this.viewportModule,
            getSelectedNodeIds: () => this.selection.getSelectedNodeIds(),
            ensureNodesInsideGrid: (nodeIds) => this._ensureNodesInsideGrid(nodeIds),
            removeNodes: (nodeIds, description) => this._removeNodes(nodeIds, description),
            getActiveDocumentationAreaId: () => this.activeDocumentationAreaId,
            removeDocumentationArea: (areaId, description) =>
                this._removeDocumentationAreaUndoably(areaId, description),
            beginHistoryGroup: (description) => clipboardHistoryManager?.beginGroup?.(description),
            endHistoryGroup: () => clipboardHistoryManager?.endGroup?.(),
        });

        // Legacy single selection (backward compatibility)
        this.selectedNodeId = null;
        this.activeNodeId = null;
        this.activeDocumentationAreaId = null;
        this.documentationLayer = null;
        this._showDocumentationAreaMenu = (areaId, anchor) =>
            this.#showDocumentationAreaMenu(areaId, anchor);
        this._documentationAreaDrag = null;

        // Context menu and overlays (Phase 4.5.3)
        this.clipboardManager = clipboardManager;
        this._activeContextMenu = null;
        this._activeInfoOverlay = null; // Track active info overlay for cleanup

        // Phase 4 Refactoring: Interaction module (2026-01-26)
        // Note: interaction module is created after nodeUiMap/connectionsUi since it needs them
        // Placeholder - will be initialized after those dependencies are created
        this.interactionModule = null;

        // Node UI tracking
        this.nodeUiMap = new Map();
        this.nodeOrderList = [];
        this._graphUnsubscribe = null;
        this._graphChangeUnsubscribe = null;
        this._collectionChangeUnsubscribe = null;
        this._runtimeCollectionUnsubscribe = null;
        this._historySelectionUnsubscribe = null;
        this._isApplyingSelectionHistory = false;

        // Canvas and DOM tracking
        this.boundHandlers = [];
        this.canvas = null;
        this.readabilityCanvas = null;
        this.backgroundCanvas = null;
        this.ownsCanvas = false;
        this.ownsReadabilityCanvas = false;
        this.ownsBackgroundCanvas = false;
        this._windowResizeHandler = null;
        this._visibilityObserver = null;
        this._isVisible = true;
        this._pendingRenderOnShow = false;
        this.renderQualityMode = 'full';
        this._renderPending = false;
        this._renderRafId = null;
        this.resizeObserver = null;
        this.canvasDPR = 1;
        this._eventsBound = false;

        // Event handlers object (for cleanup)
        this._bound = {
            mousedown: null,
            mousemove: null,
            mouseup: null,
            mouseleave: null,
            wheel: null,
            dragover: null,
            drop: null,
            keydown: null,
            contextmenu: null,
        };

        // Document-level drag handlers (attached during drag operations)
        this._documentDragHandlers = {
            mousemove: null,
            mouseup: null,
        };
        this._isDraggingActive = false;

        // Connections UI manager
        this.connectionsUi = new ConnectionsUi({
            graph: this.graph,
            getNodeUi: (nodeId) => {
                const normalizedNodeId = normalizeNodeId(nodeId);
                return normalizedNodeId ? this.nodeUiMap.get(normalizedNodeId) || null : null;
            },
            onInvalidate: () => {
                if (this._isVisible) {
                    this.renderPanel();
                } else {
                    this._pendingRenderOnShow = true;
                }
            },
        });

        // Phase 4: Initialize interaction module (needs nodeUiMap and connectionsUi)
        this.interactionModule = new GraphPanelInteraction({
            viewport: this.viewportModule,
            constants: this.constants,
            selection: this.selection,
            hitTestNode: (posWorld) => this.hitTestNode(posWorld),
            hitTestResizeHandle: (posWorld) => this.hitTestResizeHandle(posWorld),
            hitTestConnector: (posWorld) => this.hitTestConnector(posWorld),
            hitTestConnection: (posWorld) => this.hitTestConnection(posWorld),
            onInvalidate: () => this.renderPanel(),
            getCanvasPosScreenFromEvent: (event) => this.getCanvasPosScreenFromEvent(event),
            setCursor: (cursor) => this.setCursor(cursor),
            clampToGrid: (x, y, w, h) => this.clampToGrid(x, y, w, h),
            snapNodePosition: (x, y, w, h) =>
                this.gridEnabled
                    ? this.viewportModule.snapToGrid(x, y, w, h)
                    : { x, y },
            graph: this.graph,
            nodeUiMap: this.nodeUiMap,
            getNodeHitTestOrder: () =>
                orderNodeIdsForHitTesting(this.nodeOrderList, this.activeNodeId),
            connectionsUi: this.connectionsUi,
            clipboardManager: clipboardManager,
            resizeNodeWidth: ({ nodeId, width, edge, x, commit }) =>
                this._applyNodeWidthUpdate(nodeId, width, edge, {
                    requestedX: x,
                    commitHistory: commit !== false,
                }),
            setInteractionQualityMode: (active) => this.setInteractionQualityMode(active),
            logger: this._logger,
        });

        // Phase 5: Initialize rendering module (2026-01-26)
        this.rendering = new GraphPanelRendering({
            constants: this.constants,
            viewport: this.viewportModule,
            connectionsUi: this.connectionsUi,
            maxGridMajorIntervalsWidth: this.maxGridMajorIntervals.width,
            maxGridMajorIntervalsHeight: this.maxGridMajorIntervals.height,
        });

        // Backward compatibility: expose interaction state from module
        Object.defineProperty(this, 'interaction', {
            get: () => this.interactionModule.interaction,
        });

        this.lastClick = { x: 0, y: 0 };

        // Debounce canvas resize to avoid clearing during rapid events
        this._resizeDebounceTimer = null;
        // Debounce viewport persistence so a pan/zoom gesture writes the document once
        this._viewportPersistTimer = null;
        // Resolve the opening viewport once the canvas has a measurable size
        this._initialViewportApplied = false;

        // Subscribe to graph changes
        this._subscribeToGraphChanges();
        this._subscribeToCollectionChanges();
        this._subscribeToRuntimeCollectionReloads();
        this._subscribeToHistorySelectionChanges();
    }

    /**
     * Viewport accessor for backward compatibility (Phase 1 refactoring)
     * @returns {object} Viewport state from module
     */
    get viewport() {
        return this.viewportModule.viewport;
    }

    /**
     * Tab tint token derived from the graph's execution type.
     * @returns {string} Normalized execution type used as the tab variant.
     */
    get tabVariant() {
        return normalizeExecutionType(this.graph?.getExecutionType?.());
    }

    /**
     * Subscribe to NodeGraph change events (Phase 4 - data backbone integration)
     * @private
     */
    _subscribeToGraphChanges() {
        if (!this.graph) {
            return;
        }

        // Create named listener function for easier debugging
        const listener = (event) => {
            const eventName = event?.name;

            switch (eventName) {
                case 'node-added':
                case 'node-removed':
                    this.syncNodeUisFromGraph();
                    void this.revalidateNodeCapabilities();
                    this._updateToolbarEnabledState();
                    // A `signal-post` node added or removed changes the toolbar picker's names.
                    this.#refreshSignalNamesOptions(this.graph?.getExecutionType?.());
                    this.renderPanel();
                    break;

                case 'node-updated':
                    const nodeUpdatedEvent = assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodeUpdated.v1',
                        'GraphPanelView node-updated listener'
                    ) as any;
                    this.syncNodeUisFromGraph();
                    const nodeUpdatedNodeId = nodeUpdatedEvent.detail?.nodeId;
                    const nodeUpdatedPatch = nodeUpdatedEvent.detail?.patch || {};
                    if (
                        (Object.prototype.hasOwnProperty.call(nodeUpdatedPatch, 'width') ||
                            Object.prototype.hasOwnProperty.call(nodeUpdatedPatch, 'x')) &&
                        nodeUpdatedNodeId !== undefined &&
                        nodeUpdatedNodeId !== null
                    ) {
                        const nodeUi = this.nodeUiMap.get(nodeUpdatedNodeId);
                        nodeUi?.invalidateConnectorPositions?.();
                    }

                    // A patch that replaces connectors (function signature sync) changes the
                    // node's height and connector layout: redraw it instead of waiting for the
                    // next full graph reload.
                    if (
                        (Object.prototype.hasOwnProperty.call(nodeUpdatedPatch, 'inputs') ||
                            Object.prototype.hasOwnProperty.call(nodeUpdatedPatch, 'outputs')) &&
                        nodeUpdatedNodeId !== undefined &&
                        nodeUpdatedNodeId !== null
                    ) {
                        const nodeUi = this.nodeUiMap.get(nodeUpdatedNodeId);
                        if (nodeUi) {
                            // Both helpers drop the caches they read, so the new geometry comes from
                            // the patched connector list rather than the previous one.
                            nodeUi.ensureNodeHeight?.();
                            nodeUi.ensureNodeWidth?.();
                        }
                        this.renderPanel();
                    }

                    // When controlValues change (e.g. undo/redo), the visibility cache and
                    // node height may be stale — invalidate and recalculate before rendering.
                    if (
                        nodeUpdatedEvent.detail?.patch?.controlValues &&
                        nodeUpdatedEvent.detail.nodeId !== undefined &&
                        nodeUpdatedEvent.detail.nodeId !== null
                    ) {
                        const nodeUi = this.nodeUiMap.get(nodeUpdatedEvent.detail.nodeId);
                        if (nodeUi) {
                            if (typeof (nodeUi as any)._invalidateVisibilityCache === 'function') {
                                (nodeUi as any)._invalidateVisibilityCache();
                            }
                            if (typeof nodeUi.ensureNodeHeight === 'function') {
                                nodeUi.ensureNodeHeight();
                            }
                            if (typeof nodeUi.ensureNodeWidth === 'function') {
                                nodeUi.ensureNodeWidth();
                            }
                        }
                    }

                    if (
                        (nodeUpdatedEvent.detail?.patch?.controlValues ||
                            nodeUpdatedEvent.detail?.patch?.inputDefaults) &&
                        nodeUpdatedEvent.detail?.nodeId !== undefined &&
                        nodeUpdatedEvent.detail?.nodeId !== null
                    ) {
                        // Graph-level resource checks (range, exclusivity, pool counts) depend on
                        // control values too, so re-run the full validation pass.
                        void this.revalidateNodeCapabilities();
                    }

                    // Only a `signal-post` name edit can change the picker's option list, and
                    // a drag emits many unrelated updates, so the refresh is gated on it.
                    if (nodeUpdatedPatch.controlValues) {
                        const patchedControlValues = nodeUpdatedPatch.controlValues;
                        if (
                            Object.prototype.hasOwnProperty.call(
                                patchedControlValues,
                                SIGNAL_CONTROL_ID
                            ) ||
                            Object.prototype.hasOwnProperty.call(
                                patchedControlValues,
                                CUSTOM_SIGNAL_CONTROL_ID
                            )
                        ) {
                            this.#refreshSignalNamesOptions(
                                this.graph?.getExecutionType?.()
                            );
                        }
                    }
                    this.renderPanel();
                    break;

                case 'node-pos-changed':
                    const nodePosEvent = assertAppEventPayloadType(
                        event,
                        'NodeGraph.NodePositionChanged.v1',
                        'GraphPanelView node-pos-changed listener'
                    ) as any;
                    // Node position updated (e.g., by undo/redo or programmatic move)
                    // Invalidate connector position cache for the moved node
                    if (
                        nodePosEvent.detail.nodeId !== undefined &&
                        nodePosEvent.detail.nodeId !== null
                    ) {
                        const nodeUi = this.nodeUiMap.get(nodePosEvent.detail.nodeId);
                        if (nodeUi && typeof nodeUi.invalidateConnectorPositions === 'function') {
                            nodeUi.invalidateConnectorPositions();
                        }
                    }
                    this.renderPanel();
                    break;

                case 'connection-added':
                case 'connection-removed':
                    this.renderPanel();
                    break;

                case 'documentation-area-added':
                case 'documentation-area-removed':
                case 'documentation-area-updated':
                case 'documentation-area-bounds-changed':
                    // The background canvas and the DOM documentation layer both repaint from the
                    // same RAF-coalesced path, so shading never lags panning or a drag.
                    this.renderPanel();
                    break;

                case 'executionType':
                case 'triggerName':
                case 'signalTrigger':
                    // These settings feed graph rules (event signal selection, irq trigger name):
                    // mirror the toolbar controls and re-validate so the badges follow the edit.
                    this._syncToolbarControls();
                    void this.revalidateNodeCapabilities();
                    break;

                case 'interval':
                case 'enabled':
                    // Toolbar-only mirrors: no graph rule reads these.
                    this._syncToolbarControls();
                    break;
            }
        };

        // NodeGraph emits AppEvent envelopes via the canonical on(eventName, listener) API.
        this._graphChangeUnsubscribe = this.graph.on('*', listener);
    }

    _subscribeToCollectionChanges() {
        if (!this.collection?.on) {
            return;
        }

        const listener = (event: unknown) => {
            const eventName = (event as { name?: string } | null)?.name;
            if (eventName !== 'targetId') {
                return;
            }

            assertAppEventPayloadType(
                event,
                'Collection.TargetIdChanged.v1',
                'GraphPanelView collection target listener'
            );

            void this.revalidateNodeCapabilities();
            this.renderPanel();
        };

        this._collectionChangeUnsubscribe = this.collection.on('*', listener);
    }

    /**
     * Re-validate every node after the runtime collection reloads its node packages.
     *
     * Installing or uninstalling an add-on reloads the runtimes in place, which changes which node
     * types resolve. Nodes whose package disappeared must gain the unknown-type issue (red border +
     * tooltip naming the add-on) and nodes whose package reappeared must lose it, so the whole graph
     * is re-validated from the reloaded package list.
     * @private
     */
    _subscribeToRuntimeCollectionReloads() {
        const runtimeCollection = this.workspace?.runtimeCollection;
        if (typeof runtimeCollection?.on !== 'function') {
            return;
        }

        const listener = (event: unknown) => {
            const eventName = (event as { name?: string } | null)?.name;
            if (eventName !== 'runtimesLoaded') {
                return;
            }

            assertAppEventPayloadType(
                event,
                'RuntimeCollection.RuntimesLoaded.v1',
                'GraphPanelView runtime collection listener'
            );

            void this.revalidateNodeCapabilities();
            this.renderPanel();
        };

        const unsubscribe = runtimeCollection.on('*', listener);
        this._runtimeCollectionUnsubscribe =
            typeof unsubscribe === 'function' ? unsubscribe : null;
    }

    _subscribeToHistorySelectionChanges() {
        if (this._historySelectionUnsubscribe) {
            this._historySelectionUnsubscribe();
            this._historySelectionUnsubscribe = null;
        }

        const historyManager = this.collection?.getHistoryManager?.() || null;
        const subscribe = historyManager?.onSelectionHistoryApplied;
        if (typeof subscribe !== 'function') {
            return;
        }

        this._historySelectionUnsubscribe = subscribe.call(historyManager, (payload) => {
            const selectedNodeIds = Array.isArray(payload?.selectedNodeIds)
                ? payload.selectedNodeIds
                : [];
            this._applySelectionHistoryState(selectedNodeIds);
        });
    }

    _getCollectionRuntime() {
        const runtimeId = this.collection?.getDeviceRuntimeId?.();
        if (runtimeId && this.workspace?.runtimeCollection?.getRuntime) {
            const runtime = this.workspace.runtimeCollection.getRuntime(runtimeId);
            if (runtime) {
                return runtime;
            }
        }

        return this.workspace?.runtimeCollection?.getActiveRuntime?.() || null;
    }

    _resolveNodeTypeWidthMetadata(node) {
        const runtime = this._getCollectionRuntime();
        const typeId = typeof node?.type === 'string' ? node.type : '';
        const nodeType = runtime?.getNodeType?.(typeId) || null;

        return {
            defaultWidth: nodeType?.defaultWidth,
            minWidth: nodeType?.minWidth,
            maxWidth: nodeType?.maxWidth,
        };
    }

    /**
     * Apply a width change requested by a resize interaction or the keyboard.
     *
     * The resolved width can never fall below the node type's `minWidth` nor below the
     * content-derived minimum of the node itself (connector rows need room for their
     * labels and for input default controls), for pointer and keyboard resizes alike.
     *
     * @param nodeId - Node being resized.
     * @param requestedWidth - Width requested by the interaction.
     * @param edge - Edge that is being dragged.
     * @param options - Optional requested x position and history commit flag.
     * @returns True when the node was actually changed.
     */
    _applyNodeWidthUpdate(
        nodeId,
        requestedWidth,
        edge = 'right',
        options: { requestedX?: number; commitHistory?: boolean } = {}
    ) {
        if (!this.graph?.getNode || !this.graph?.updateNode) {
            return false;
        }

        const node = this.graph.getNode(nodeId);
        if (!node) {
            return false;
        }

        const currentX = Number.isFinite(node.x) ? node.x : 0;
        const currentWidth = Number.isFinite(node.width) ? node.width : 140;
        const metadata = this._resolveNodeTypeWidthMetadata(node);
        const contentMinWidth = this.nodeUiMap.get(nodeId)?.getMinContentWidth?.() ?? 0;
        const requestedX = Number.isFinite(options.requestedX) ? options.requestedX : undefined;
        const commitHistory = options.commitHistory !== false;

        const resolvedWidth = resolveNodeWidth({
            instanceWidth: requestedWidth,
            defaultWidth: metadata.defaultWidth,
            minWidth: resolveEffectiveMinWidth(metadata.minWidth, contentMinWidth),
            maxWidth: metadata.maxWidth,
            legacyFallbackWidth: currentWidth,
        });

        let nextX = currentX;
        if (edge === 'left') {
            if (requestedX !== undefined) {
                const requestedRight = requestedX + requestedWidth;
                nextX = requestedRight - resolvedWidth;
            } else {
                const widthDelta = resolvedWidth - currentWidth;
                nextX = currentX - widthDelta;
            }
        }

        if (Object.is(currentWidth, resolvedWidth) && Object.is(currentX, nextX)) {
            return false;
        }

        if (commitHistory) {
            this.graph.updateNode(
                nodeId,
                {
                    width: resolvedWidth,
                    x: nextX,
                },
                {
                    width: currentWidth,
                    x: currentX,
                }
            );
        } else {
            node.width = resolvedWidth;
            node.x = nextX;
        }

        const nodeUi = this.nodeUiMap.get(nodeId);
        nodeUi?.invalidateConnectorPositions?.();
        this.renderPanel();
        return true;
    }

    _resizeSelectedNodeWidths(delta) {
        if (!Number.isFinite(delta) || delta === 0) {
            return;
        }

        const selectedIds = this.selection.getSelectedNodeIds();
        if (!selectedIds.length || !this.graph?.getNode) {
            return;
        }

        selectedIds.forEach((nodeId) => {
            const node = this.graph.getNode(nodeId);
            if (!node) {
                return;
            }

            const currentWidth = Number.isFinite(node.width) ? node.width : 140;
            this._applyNodeWidthUpdate(nodeId, currentWidth + delta, 'right');
        });
    }

    _cloneLocalizedValue(value) {
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'object' && value !== null) {
            return { ...value };
        }
        return String(value);
    }

    /**
     * Resolve the node definition behind a node type id.
     *
     * Generated function nodes win over the runtime lookup for `function_graph.*` ids, so a
     * runtime package can never shadow a call node; every other id keeps the runtime-first
     * order. A generated id whose graph is gone (deleted, disabled, or pasted from another
     * collection) resolves to `null` and takes the existing unknown-type path.
     *
     * @param {string} typeId - Node type id from the palette drag payload.
     * @returns {object|null} Generated function definition, runtime node type, or `null`.
     * @private
     */
    #resolveNodeDefinition(typeId) {
        if (isFunctionNodeTypeId(typeId)) {
            const collection = this.workspace?.getActiveCollection?.() ?? null;
            // A generated definition carries exactly the members the snapshot reads
            // (`title`, `icon`, `color`, `inputs`, `outputs`) and none of the optional
            // width/control metadata, which the snapshot treats as absent.
            return resolveFunctionNodeDefinition(collection, typeId) as unknown as NodeTypeLike | null;
        }
        const runtime = this.workspace?.runtimeCollection?.getActiveRuntime();
        return runtime?.getNodeType?.(typeId) ?? null;
    }


    _buildNodeTypeSnapshot(nodeType, typeId) {
        const controls =
            nodeType.controls?.map((control) => ({
                id: control.id,
                type: control.type,
                layout: control.layout,
                label: this._cloneLocalizedValue(control.label),
                default: control.defaultValue,
                min: control.min,
                max: control.max,
                step: control.step,
                options: control.getOptions ? control.getOptions() : control.options,
                affectsControls: control.affectsControls,
                affectsInputs: control.affectsInputs,
                affectsOutputs: control.affectsOutputs,
                dynamicOptions: control.dynamicOptions,
                maxVisibleItems: control.maxVisibleItems,
                valueMigration: control.definition?.valueMigration ?? control.valueMigration,
                legacyDefault: control.definition?.legacyDefault ?? control.legacyDefault,
            })) || [];

        return {
            typeName: nodeType.title || typeId,
            icon: nodeType.icon,
            color: nodeType.color,
            inputs:
                nodeType.inputs?.map((input) => {
                    const mappedInput: {
                        id: string;
                        name: unknown;
                        icon?: string;
                        allowedTypes?: string[];
                        initialTypes?: string[];
                        defaultControl?: unknown;
                    } = {
                        id: input.id,
                        name: this._cloneLocalizedValue(input.name),
                        icon: input.icon,
                    };
                    if (Array.isArray((input as any).allowedTypes)) {
                        mappedInput.allowedTypes = [...(input as any).allowedTypes];
                    }
                    if (Array.isArray((input as any).initialTypes)) {
                        mappedInput.initialTypes = [...(input as any).initialTypes];
                    }
                    if (input.defaultControl) {
                        mappedInput.defaultControl = input.defaultControl;
                    }
                    return mappedInput;
                }) || [],
            outputs:
                nodeType.outputs?.map((output) => {
                    const mappedOutput: {
                        id: string;
                        name: unknown;
                        icon?: string;
                        outputType?: string;
                        outputTypeControl?: string;
                        outputTypeByControlValue?: Record<string, unknown>;
                        typeInputSources?: string[];
                    } = {
                        id: output.id,
                        name: this._cloneLocalizedValue(output.name),
                        icon: output.icon,
                    };

                    if (typeof (output as any).outputType === 'string') {
                        mappedOutput.outputType = (output as any).outputType;
                    }
                    if (Array.isArray((output as any).initialTypes)) {
                        (mappedOutput as Record<string, unknown>).initialTypes = [
                            ...((output as any).initialTypes as string[]),
                        ];
                    }
                    if (typeof (output as any).outputTypeControl === 'string') {
                        mappedOutput.outputTypeControl = (output as any).outputTypeControl;
                    }
                    if (
                        (output as any).outputTypeByControlValue &&
                        typeof (output as any).outputTypeByControlValue === 'object'
                    ) {
                        mappedOutput.outputTypeByControlValue = {
                            ...((output as any).outputTypeByControlValue as Record<
                                string,
                                unknown
                            >),
                        };
                    }
                    const unionSources = resolveDeclaredInputSources(output);
                    if (unionSources.length > 0) {
                        mappedOutput.typeInputSources = unionSources;
                    }

                    return mappedOutput;
                }) || [],
            controls,
        };
    }

    _buildControlValuesForSnapshot(
        controls,
        existingControlValues = {},
        existingControls: unknown = undefined
    ) {
        return buildControlValuesForRuntimeSnapshot(
            controls,
            existingControlValues,
            existingControls
        );
    }

    _filterInputDefaults(inputs, existingInputDefaults = {}) {
        const nextInputDefaults = {};
        const sourceDefaults =
            existingInputDefaults && typeof existingInputDefaults === 'object'
                ? existingInputDefaults
                : {};
        const allowedInputIds = new Set(inputs.map((input) => input.id));

        Object.keys(sourceDefaults).forEach((inputId) => {
            if (allowedInputIds.has(inputId)) {
                nextInputDefaults[inputId] = sourceDefaults[inputId];
            }
        });

        return nextInputDefaults;
    }

    _refreshExistingNodesFromRuntimeDefinitions() {
        if (!this.graph?.getNodes || !this.graph?.updateNode) {
            return;
        }

        const runtime = this._getCollectionRuntime();
        if (!runtime?.getNodeType) {
            return;
        }

        const { patches, updatedNodeIds } = collectRuntimeDefinitionNodePatches({
            nodes: this.graph.getNodes(),
            getNodeType: (typeId) => runtime.getNodeType(typeId),
        });

        patches.forEach((entry) => {
            this.graph.updateNode(entry.nodeId, entry.patch);
        });

        if (
            updatedNodeIds.length > 0 &&
            typeof (this.graph as any).recomputeDynamicConnectorTyping === 'function'
        ) {
            (this.graph as any).recomputeDynamicConnectorTyping(updatedNodeIds);
        }
    }

    async _resolveTargetCapabilitiesSnapshot(): Promise<TargetCapabilitySnapshot | null> {
        const targetId = this.collection?.getTargetId?.() || null;
        if (!targetId) {
            return null;
        }

        const runtime = this._getCollectionRuntime();
        const effectivePayload =
            (
                runtime as {
                    getEffectiveTargetPayload?: (
                        id: string
                    ) => Record<string, unknown> | null;
                } | null
            )?.getEffectiveTargetPayload?.(targetId) ?? null;
        if (effectivePayload) {
            const normalized = new DeviceTargetInfo(effectivePayload);
            return {
                capabilityToPins: normalized.capabilityToPins || {},
                generalCapabilities: normalized.generalCapabilities || {},
                metadata: normalized.metadata || {},
                openPins: normalized.pinRange ?? null,
            };
        }

        const runtimeTarget = runtime?.getDeviceTarget?.(targetId) || null;
        if (runtimeTarget) {
            return {
                capabilityToPins: runtimeTarget.capabilityToPins || {},
                generalCapabilities: runtimeTarget.generalCapabilities || {},
                metadata: runtimeTarget.metadata || {},
                openPins:
                    (runtimeTarget as { pinRange?: { min: number; max: number } | null }).pinRange ??
                    null,
            };
        }

        if (!this.workspace?.getUserTargetConfig) {
            return null;
        }

        const userTargetRecord = await this.workspace.getUserTargetConfig(targetId);
        const targetData = userTargetRecord?.targetData;
        if (!targetData || typeof targetData !== 'object') {
            return null;
        }

        const normalized = new DeviceTargetInfo(targetData as Record<string, unknown>);
        return {
            capabilityToPins: normalized.capabilityToPins || {},
            generalCapabilities: normalized.generalCapabilities || {},
            metadata: normalized.metadata || {},
            openPins: normalized.pinRange ?? null,
        };
    }

    async revalidateNodeCapability(nodeId: unknown): Promise<void> {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (!normalizedNodeId || !this.graph?.getNode) {
            return;
        }

        const node = this.graph.getNode(normalizedNodeId);
        if (!node || typeof node !== 'object') {
            return;
        }

        const runtime = this._getCollectionRuntime();
        if (typeof runtime?.getNodeType !== 'function') {
            // Without a runtime that can answer, nothing can be attributed to a missing package:
            // clearing keeps its previous meaning (no device information, no issue).
            (node as { clearCapabilityIssues?: () => void }).clearCapabilityIssues?.();
            return;
        }

        const nodeType = runtime.getNodeType((node as { type?: string }).type || '') || null;
        if (!nodeType) {
            const typeId = (node as { type?: string }).type;
            if (isFunctionGraphManagedNodeType(typeId)) {
                // Structural and generated function nodes have no runtime definition by design:
                // reporting them as a missing package would be a false alarm.
                (node as { clearCapabilityIssues?: () => void }).clearCapabilityIssues?.();
                this.renderPanel();
                return;
            }
            // The type does not resolve: this is the case where a node survived without its
            // add-on (uninstalled, or a workspace loaded without the package). Report it instead
            // of clearing the issues, so the node keeps a red border and a tooltip naming the
            // package that has to be installed.
            (node as { setCapabilityIssues?: (issues: unknown) => void }).setCapabilityIssues?.([
                createMissingNodeTypeIssue({
                    nodeId: normalizedNodeId,
                    typeId: (node as { type?: string }).type,
                    translate: (key, params) => this.t(key, params),
                }),
            ]);
            this.renderPanel();
            return;
        }

        const targetCapabilities = await this._resolveTargetCapabilitiesSnapshot();
        const validationContext = this._buildCapabilityValidationContext(runtime);
        const validation = validateNodeCapabilities({
            node: node as Record<string, unknown>,
            nodeType: nodeType as Record<string, unknown>,
            capabilities: targetCapabilities,
            targetId: this.collection?.getTargetId?.() || null,
            validationContext,
        });

        (node as { setCapabilityIssues?: (issues: unknown) => void }).setCapabilityIssues?.(
            validation.issues
        );
        this.renderPanel();
    }

    async revalidateNodeCapabilities(): Promise<void> {
        const graph = this.graph;
        if (!graph?.getNodeIds || !graph?.getNode) {
            return;
        }

        const runtime = this._getCollectionRuntime();
        const targetCapabilities = await this._resolveTargetCapabilitiesSnapshot();
        if (this.graph !== graph) {
            // The graph was swapped or removed while awaiting the target snapshot.
            return;
        }

        const targetId = this.collection?.getTargetId?.() || null;
        const validationContext = this._buildCapabilityValidationContext(runtime);
        const graphIssues = this._collectGraphIssues(validationContext);

        for (const nodeId of graph.getNodeIds()) {
            const node = graph.getNode(nodeId);
            if (!node || typeof node !== 'object') {
                continue;
            }

            if (typeof runtime?.getNodeType !== 'function') {
                // No runtime can answer: keep the pre-existing meaning and report nothing.
                (node as { clearCapabilityIssues?: () => void }).clearCapabilityIssues?.();
                continue;
            }

            const nodeType = runtime.getNodeType((node as { type?: string }).type || '') || null;
            if (!nodeType) {
                if (isFunctionGraphManagedNodeType((node as { type?: string }).type)) {
                    // Structural and generated function nodes are provided by the app, not by a
                    // node package: the type can never come back by installing anything.
                    (node as { clearCapabilityIssues?: () => void }).clearCapabilityIssues?.();
                    continue;
                }
                // Unknown type: flag the node instead of silently dropping its issues. The package
                // part of the type id names the add-on the user has to (re)install.
                (node as { setCapabilityIssues?: (issues: unknown) => void }).setCapabilityIssues?.(
                    [
                        createMissingNodeTypeIssue({
                            nodeId,
                            typeId: (node as { type?: string }).type,
                            translate: (key, params) => this.t(key, params),
                        }),
                    ]
                );
                continue;
            }

            const validation = validateNodeCapabilities({
                node: node as Record<string, unknown>,
                nodeType: nodeType as Record<string, unknown>,
                capabilities: targetCapabilities,
                targetId,
                validationContext,
            });

            const nodeGraphIssues = graphIssues.filter(
                (issue) => issue.nodeId === nodeId || issue.nodeId === null
            );

            (node as { setCapabilityIssues?: (issues: unknown) => void }).setCapabilityIssues?.([
                ...validation.issues,
                ...nodeGraphIssues,
            ]);
        }

        this.renderPanel();
    }

    _collectGraphIssues(validationContext: CapabilityValidationContext | null): NodeCapabilityIssue[] {
        // Graph rules are a property of the graph (and collection) alone: they must be
        // reported even when no device target (and therefore no capability context) is
        // available.
        const graphRuleIssues = validationContext
            ? validateGraphRules({
                  graphId: validationContext.graphId || null,
                  nodes: validationContext.graphNodes || [],
                  nodeTypesByNodeId: validationContext.nodeTypesByNodeId || {},
                  connections: validationContext.graphConnections || [],
                  collectionNodes: validationContext.collectionNodes || [],
                  graphSettings: {
                      executionType: normalizeExecutionType(this.graph?.getExecutionType?.()),
                      triggerName: normalizeTriggerName(this.graph?.getTriggerName?.()),
                      signalNames: normalizeSignalNames(this.graph?.getSignalNames?.()),
                      signalMode: normalizeSignalMode(this.graph?.getSignalMode?.()),
                      runOnStart: normalizeRunOnStart(this.graph?.getRunOnStart?.()),
                  },
              })
            : [];

        const targetInfo = this._resolveTargetInfo();
        if (!targetInfo || !validationContext) {
            return graphRuleIssues;
        }
        return [
            ...validateGraphResources({
                target: targetInfo,
                graphNodes: validationContext.graphNodes || [],
                nodeTypesByNodeId: validationContext.nodeTypesByNodeId || {},
            }),
            ...graphRuleIssues,
        ];
    }

    _resolveTargetInfo(): DeviceTargetInfo | null {
        const targetId = this.collection?.getTargetId?.() || null;
        if (!targetId) {
            return null;
        }
        const runtime = this._getCollectionRuntime();
        const runtimeTarget = runtime?.getDeviceTarget?.(targetId) || null;
        if (runtimeTarget instanceof DeviceTargetInfo) {
            return runtimeTarget;
        }
        if (runtimeTarget && typeof runtimeTarget === 'object') {
            return new DeviceTargetInfo({
                id: targetId,
                capabilityToPins: runtimeTarget.capabilityToPins || {},
                generalCapabilities: runtimeTarget.generalCapabilities || {},
                metadata: runtimeTarget.metadata || {},
            });
        }
        return null;
    }

    _buildCapabilityValidationContext(runtime: unknown): CapabilityValidationContext | null {
        if (!this.graph?.getConnections || !this.graph?.getNodeIds || !this.graph?.getNode) {
            return null;
        }

        const nodeTypesByNodeId: Record<string, Record<string, unknown> | null> = {};
        const graphNodes: Record<string, unknown>[] = [];
        const collectionNodes: Record<string, unknown>[] = [];

        for (const nodeId of this.graph.getNodeIds()) {
            const node = this.graph.getNode(nodeId);
            if (!node || typeof node !== 'object') {
                continue;
            }
            graphNodes.push(node as Record<string, unknown>);

            const nodeTypeId = (node as { type?: unknown }).type;
            const resolvedNodeType =
                typeof nodeTypeId === 'string'
                    ? (runtime as { getNodeType?: (typeId: string) => unknown })?.getNodeType?.(
                          nodeTypeId
                      )
                    : null;
            nodeTypesByNodeId[nodeId] =
                resolvedNodeType && typeof resolvedNodeType === 'object'
                    ? (resolvedNodeType as Record<string, unknown>)
                    : null;
        }

        const graphs = this.collection?.getGraphArray?.() || [];
        graphs.forEach((graph) => {
            const rawNodes = graph?.getNodes?.() || [];
            const nodes = Array.isArray(rawNodes) ? rawNodes : Object.values(rawNodes);
            nodes.forEach((node) => {
                if (node && typeof node === 'object') {
                    collectionNodes.push(node as Record<string, unknown>);
                }
            });
        });

        return {
            graphId: (this.graph as { getId?: () => string | null })?.getId?.() || null,
            graphNodes,
            graphConnections: this.graph.getConnections() || [],
            nodeTypesByNodeId,
            collectionNodes,
        };
    }

    /**
     * ViewBase render hook - create canvas and set up event listeners.
     * Called when view is attached to a container.
     * @param {HTMLElement} container - Host element
     */
    render(container) {
        // Build (or reuse) the layout skeleton: toolbar row above the canvas area.
        this.#ensureLayout();
        this.mountContent(this.#rootEl);
        this.#ensureToolbar();

        // Create canvas elements
        this.#createCanvas();
        this.#ensureDocumentationLayer();

        // Attach canvas to the canvas host (re-attach after dispose())
        if (this.canvas && this.canvas.parentElement !== this.#canvasHost) {
            (this.#canvasHost || container).appendChild(this.canvas);
        }

        // Re-attach the capability tooltip if it survived a detach/re-attach cycle
        this.#ensureCapabilityTooltipAttached();

        // Sync node UIs after canvas is created
        this.syncNodeUisFromGraph();
        void this.revalidateNodeCapabilities();

        // Bind event handlers
        this.#bindEvents();

        // Note: ViewBase._setupResizeObserver() is called automatically by attachTo()
        // Legacy registerResizeHandlers() removed to prevent duplicate observers

        // Initial render
        this.resizeCanvas();
        this.renderPanel();
        this.#ensureInitialViewport();

        this._log('render-complete', {
            hasCanvas: Boolean(this.canvas),
            hasGraph: Boolean(this.graph),
            nodeCount: this.nodeUiMap.size,
        });
    }

    /**
     * Create the panel layout skeleton once and reuse it across re-attaches.
     *
     * The root element is kept alive between detach/attach cycles so the canvas
     * (and its 2D context) survives a tab switch.
     * @private
     */
    #ensureLayout() {
        if (this.#rootEl || typeof document === 'undefined') {
            return;
        }

        this.#rootEl = document.createElement('div');
        this.#rootEl.className = 'graph-panel-view';

        this.#toolbarHost = document.createElement('div');
        this.#toolbarHost.className = 'graph-panel-view__toolbar';

        this.#canvasHost = document.createElement('div');
        this.#canvasHost.className = 'graph-panel-view__canvas';

        this.#rootEl.append(this.#toolbarHost, this.#canvasHost);
    }

    /**
     * Create the panel toolbar once and mount it in the toolbar host.
     * @returns {ToolbarView|null} The toolbar instance, or null before layout.
     * @private
     */
    #ensureToolbar() {
        if (!this.#toolbarHost) {
            return null;
        }

        if (!this.#toolbarView) {
            this.#toolbarView = new ToolbarView({
                title: 'Graph Toolbar',
                height: 36,
                layoutMode: 'scroll',
                i18nService: this._i18nService,
                logger: this._logger,
            });
        }

        if (!this.#toolbarView.container) {
            this.#toolbarView.attachTo(this.#toolbarHost);
        }

        this.#createToolbarControls();

        return this.#toolbarView;
    }

    /**
     * Build the toolbar control set (idempotent).
     * @private
     */
    #createToolbarControls() {
        if (this.#toolbarControlsCreated || !this.#toolbarView) {
            return;
        }
        this.#toolbarControlsCreated = true;

        // The enabled flag lives in the graph-tab context menu, so the toolbar leads with
        // actions that apply to the graph content itself.
        const alignControl = this.#toolbarView.addButton({
            icon: IconProvider.alignToGrid,
            label: this.t('graph.toolbar.alignToGrid'),
            onClick: () => this._alignNodesToGrid(),
        }) as ToolbarButtonControl;

        this.#toolbarView.addSeparator();

        this.#executionTypeHost = document.createElement('div');
        this.#executionTypeHost.className = 'graph-panel-view__toolbar-control';
        // No visible title in the compact toolbar: the select is named through aria-label
        // (applied by _refreshToolbarControlLabels()) instead of a rendered label.
        this.#executionTypeControl = new DropdownControl({
            defaultValue: DEFAULT_EXECUTION_TYPE,
            options: [
                { value: 'startup', label: this.t('graph.toolbar.executionType.startup') },
                {
                    value: 'continuous',
                    label: this.t('graph.toolbar.executionType.loop'),
                },
                { value: 'irq', label: this.t('graph.toolbar.executionType.irq') },
                { value: 'event', label: this.t('graph.toolbar.executionType.event') },
                { value: 'function', label: this.t('graph.toolbar.executionType.function') },
            ],
        });
        this.#executionTypeControl.render(this.#executionTypeHost);
        this.#executionTypeControl.onChange((value) =>
            this._handleToolbarExecutionTypeChanged(value)
        );
        this.#toolbarView.addElement(this.#executionTypeHost);

        this.#triggerNameHost = document.createElement('div');
        this.#triggerNameHost.className = 'graph-panel-view__toolbar-control';
        // No visible title in the compact toolbar: the select is named through aria-label
        // (applied by _refreshToolbarControlLabels()) instead of a rendered label.
        this.#triggerNameControl = new DropdownControl({
            defaultValue: '',
            options: [],
        });
        this.#triggerNameControl.render(this.#triggerNameHost);
        this.#triggerNameControl.onChange((value) =>
            this._handleToolbarTriggerNameChanged(value)
        );
        this.#toolbarView.addElement(this.#triggerNameHost);

        // Signals multi-select (event graphs only). The shared dropdown is used in its
        // multi-select variant so the toolbar and the settings view share one picker.
        this.#signalNamesHost = document.createElement('div');
        this.#signalNamesHost.className =
            'graph-panel-view__toolbar-control graph-panel-view__toolbar-control--signals';
        this.#signalNamesControl = new SignalDropdownControl({
            multiSelect: true,
            showIcons: false,
            showBulkActions: false,
            placeholder: 'graph.toolbar.signalNames.placeholder',
            ariaLabel: 'graph.toolbar.signalNames.label',
            menuClassName: 'graph-panel-view__signal-menu',
            i18nService: this._i18nService,
            logger: this._logger,
            onChange: (value) => this._handleToolbarSignalNamesChanged(value),
        });
        this.#signalNamesControl.attachTo(this.#signalNamesHost);
        this.#toolbarView.addElement(this.#signalNamesHost);

        this.#signalModeHost = document.createElement('div');
        this.#signalModeHost.className = 'graph-panel-view__toolbar-control';
        // Untitled like the execution-type select: named through aria-label.
        this.#signalModeControl = new DropdownControl({
            defaultValue: DEFAULT_SIGNAL_MODE,
            options: [
                { value: 'any', label: this.t('graph.toolbar.signalMode.any') },
                { value: 'all', label: this.t('graph.toolbar.signalMode.all') },
            ],
        });
        this.#signalModeControl.render(this.#signalModeHost);
        this.#signalModeControl.onChange((value) =>
            this._handleToolbarSignalModeChanged(value)
        );
        this.#toolbarView.addElement(this.#signalModeHost);

        this.#sleepHost = document.createElement('div');
        this.#sleepHost.className = 'graph-panel-view__toolbar-control';
        this.#sleepControl = new NumberControl({
            label: this.t('graph.toolbar.sleepDuration.label'),
            defaultValue: DEFAULT_SLEEP_MS,
            min: MIN_SLEEP_MS,
            max: MAX_SLEEP_MS,
            step: 1,
        });
        this.#sleepControl.render(this.#sleepHost);
        this.#toolbarView.addElement(this.#sleepHost);

        // NumberControl emits on every keystroke, so commit on change/blur only.
        const sleepInput = this.#sleepControl.element;
        sleepInput?.addEventListener('change', () => this._handleToolbarSleepCommit());
        sleepInput?.addEventListener('blur', () => this._handleToolbarSleepCommit());

        this.#toolbarView.renderControls();
        this.#alignButton = alignControl.element;

        this._updateToolbarLabels();
        this._refreshToolbarControlLabels();
        this._syncToolbarControls();
    }

    /**
     * Re-apply localized labels to the toolbar controls.
     */
    _updateToolbarLabels() {
        if (!this.#alignButton) {
            return;
        }

        const label = this.t('graph.toolbar.alignToGrid');
        this.#alignButton.title = label;
        this.#alignButton.setAttribute('aria-label', label);
        const icon = this.#alignButton.querySelector('img');
        if (icon) {
            icon.alt = label;
        }

        this._updateToolbarEnabledState();
    }

    /**
     * Enable the align-to-grid button only when the graph has nodes.
     */
    _updateToolbarEnabledState() {
        if (!this.#alignButton) {
            return;
        }

        const nodeCount = this.graph?.getNodeIds?.().length ?? 0;
        this.#alignButton.disabled = !this.graph || nodeCount === 0;
    }

    /**
     * Reflect the graph's enabled state on the canvas host.
     *
     * Disabled graphs are excluded from transpilation, so the canvas drops to a
     * neutral gray instead of the regular canvas background.
     *
     * @param {object|null} graph - Active graph.
     */
    _applyEnabledVisualState(graph) {
        if (!this.#canvasHost) {
            return;
        }

        const enabled = graph ? normalizeGraphEnabled(graph.getEnabled?.()) : true;
        this.#canvasHost.classList.toggle('graph-panel-view__canvas--disabled', !enabled);
    }

    /**
     * Push the toolbar execution settings into the graph.
     * The enabled flag is edited from the graph-tab context menu, not this toolbar.
     * @param {unknown} value - Raw value from the dropdown.
     */
    _handleToolbarExecutionTypeChanged(value) {
        const graph = this.graph;
        if (!graph?.setExecutionType) {
            return;
        }

        const normalized = normalizeExecutionType(value);
        if (normalized !== normalizeExecutionType(graph.getExecutionType?.())) {
            graph.setExecutionType(normalized);
        }

        this.#updateSleepControlVisibility(normalized);
        this.#updateTriggerNameVisibility(normalized);
        this.#updateSignalControlsVisibility(normalized);
        this.#refreshSignalNamesOptions(normalized);
        this.#refreshSignalModeControl(normalized);
    }

    /**
     * Commit the interval entered in the toolbar to the graph.
     *
     * A blank field makes no write and restores the graph value; non-blank input
     * is clamped with the shared interval rules before it is compared and written.
     */
    _handleToolbarSleepCommit() {
        const graph = this.graph;
        const input = this.#sleepControl?.element;
        if (!graph?.setTriggerInterval || !input) {
            return;
        }

        const rawValue = input.value.trim();
        if (rawValue === '') {
            const current = clampSleepDuration(graph.getTriggerInterval?.());
            input.value = String(current);
            this.#sleepControl?.setValue(current);
            return;
        }

        const clamped = clampSleepDuration(rawValue);
        input.value = String(clamped);
        this.#sleepControl?.setValue(clamped);

        if (clamped !== Number(graph.getTriggerInterval?.())) {
            graph.setTriggerInterval(clamped);
        }
    }

    /**
     * Pull the graph execution settings into the toolbar controls.
     */
    _syncToolbarControls() {
        const graph = this.graph;
        const hasGraph = Boolean(graph);

        this.#executionTypeControl?.setDisabled(!hasGraph);
        this.#sleepControl?.setDisabled(!hasGraph);
        this.#triggerNameControl?.setDisabled(!hasGraph);
        this.#signalModeControl?.setDisabled(!hasGraph);

        if (!hasGraph) {
            if (this.#triggerNameHost) {
                this.#triggerNameHost.hidden = true;
            }
            if (this.#signalNamesHost) {
                this.#signalNamesHost.hidden = true;
            }
            if (this.#signalModeHost) {
                this.#signalModeHost.hidden = true;
            }
            this.#signalNamesControl?.setDisabled(true);
            this._updateToolbarEnabledState();
            this._applyEnabledVisualState(null);
            return;
        }

        const executionType = normalizeExecutionType(graph.getExecutionType?.());
        this.#executionTypeControl?.setValue(executionType);

        const interval = clampSleepDuration(graph.getTriggerInterval?.());
        this.#sleepControl?.setValue(interval);

        this.#refreshTriggerNameOptions(executionType);
        this.#refreshSignalNamesOptions(executionType);
        this.#refreshSignalModeControl(executionType);

        this.#updateSleepControlVisibility(executionType);
        this.#updateTriggerNameVisibility(executionType);
        this.#updateSignalControlsVisibility(executionType);
        this._updateToolbarEnabledState();
        this._applyEnabledVisualState(graph);
    }

    /**
     * Hide the sleep control for run-once graphs (parity with the settings view).
     * @param {unknown} executionType - Execution type to evaluate.
     * @private
     */
    #updateSleepControlVisibility(executionType) {
        if (!this.#sleepHost) {
            return;
        }
        const normalized = normalizeExecutionType(executionType);
        this.#sleepHost.hidden = normalized !== 'continuous';
    }

    /**
     * Hide the interrupt-name control unless the graph runs in `irq` mode.
     * @param {unknown} executionType - Execution type to evaluate.
     * @private
     */
    #updateTriggerNameVisibility(executionType) {
        if (!this.#triggerNameHost) {
            return;
        }
        this.#triggerNameHost.hidden = normalizeExecutionType(executionType) !== 'irq';
    }

    /**
     * Hide the signals and trigger-mode controls unless the graph runs on `event` mode.
     * @param {unknown} executionType - Execution type to evaluate.
     * @private
     */
    #updateSignalControlsVisibility(executionType) {
        const isEvent = normalizeExecutionType(executionType) === 'event';
        if (this.#signalNamesHost) {
            this.#signalNamesHost.hidden = !isEvent;
        }
        if (this.#signalModeHost) {
            this.#signalModeHost.hidden = !isEvent;
        }
    }

    /**
     * Rebuild the signals multi-select from the collection's declared names.
     *
     * A stored name that no `signal-post` node produces stays offered (and ticked) so a
     * stale selection remains visible until the user changes it. The options are replaced
     * only when the name set changed, which keeps an open menu in place across refreshes;
     * the picker is disabled unless the graph runs on `event` mode with names to pick from.
     *
     * @param {unknown} executionType - Execution type to evaluate.
     * @private
     */
    #refreshSignalNamesOptions(executionType) {
        if (!this.#signalNamesControl) {
            return;
        }

        const isEvent = normalizeExecutionType(executionType) === 'event';
        const selected = normalizeSignalNames(this.graph?.getSignalNames?.());
        const names = Array.from(
            new Set([...collectSignalNames(this.collection, this.graph), ...selected])
        ).sort((left, right) => left.localeCompare(right));

        const unchanged =
            names.length === this.#signalOptionValues.length &&
            names.every((name, index) => name === this.#signalOptionValues[index]);
        if (!unchanged) {
            this.#signalOptionValues = names;
            this.#signalNamesControl.setOptions(
                names.map((name): DropdownOption => ({ value: name, label: name }))
            );
        }

        this.#signalNamesControl.setValue(selected);
        this.#signalNamesControl.setDisabled(!isEvent || names.length === 0);
    }

    /**
     * Pull the graph's trigger mode into the toolbar dropdown.
     *
     * The select is disabled unless the graph runs on `event` mode.
     *
     * @param {unknown} executionType - Execution type to evaluate.
     * @private
     */
    #refreshSignalModeControl(executionType) {
        const select = this.#signalModeControl?.element;
        if (!select) {
            return;
        }

        const isEvent = normalizeExecutionType(executionType) === 'event';
        select.value = normalizeSignalMode(this.graph?.getSignalMode?.());
        this.#signalModeControl?.setDisabled(!isEvent);
    }

    /**
     * Push a toolbar signals selection into the graph.
     *
     * The selection is written only when it differs from the stored one, so a refresh that
     * re-applies the graph value never produces a second write.
     *
     * @param {unknown} value - Raw value from the multi-select.
     */
    _handleToolbarSignalNamesChanged(value) {
        const graph = this.graph;
        if (!graph?.setSignalNames) {
            return;
        }

        const next = normalizeSignalNames(value);
        const current = normalizeSignalNames(graph.getSignalNames?.());
        const unchanged =
            next.length === current.length &&
            next.every((name, index) => name === current[index]);
        if (!unchanged) {
            graph.setSignalNames(next);
        }
    }

    /**
     * Push the toolbar trigger mode into the graph.
     * @param {unknown} value - Raw value from the dropdown.
     */
    _handleToolbarSignalModeChanged(value) {
        const graph = this.graph;
        if (!graph?.setSignalMode) {
            return;
        }

        const normalized = normalizeSignalMode(value);
        if (normalized !== normalizeSignalMode(graph.getSignalMode?.())) {
            graph.setSignalMode(normalized);
        }
    }

    /**
     * Rebuild the interrupt-name dropdown from the collection's declared names.
     *
     * A stale current value that is no longer declared anywhere is kept as one extra
     * option; the control is disabled unless the graph is in `irq` mode and has a
     * non-empty list to pick from.
     *
     * @param {unknown} executionType - Execution type to evaluate.
     * @private
     */
    #refreshTriggerNameOptions(executionType) {
        const select = this.#triggerNameControl?.element;
        if (!select) {
            return;
        }

        const isIrq = normalizeExecutionType(executionType) === 'irq';
        const names = collectIrqTriggerNames(this.collection, this.graph);
        const current = normalizeTriggerName(this.graph?.getTriggerName?.());
        if (current && !names.includes(current)) {
            names.push(current);
        }

        select.replaceChildren();
        names.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === current) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        this.#triggerNameControl?.setDisabled(!isIrq || names.length === 0);
    }

    /**
     * Push a toolbar interrupt-name selection into the graph.
     *
     * A blank value (possible when the list is temporarily empty) restores the
     * current graph value instead of writing an empty name.
     *
     * @param {unknown} value - Raw value from the dropdown.
     */
    _handleToolbarTriggerNameChanged(value) {
        const graph = this.graph;
        if (!graph?.setTriggerName) {
            return;
        }

        const normalized = normalizeTriggerName(value);
        const current = normalizeTriggerName(graph.getTriggerName?.());
        if (!normalized) {
            this._syncToolbarControls();
            return;
        }
        if (normalized !== current) {
            graph.setTriggerName(normalized);
        }
    }

    /**
     * Re-apply the localized labels of the toolbar execution, trigger and signal controls.
     *
     * The execution-type, trigger-name and trigger-mode selects carry no visible title (compact
     * toolbar), so their labels are applied as `aria-label` attributes instead of rendered text.
     * `BaseControl` exposes no label setter, so the rendered sleep label and every `<option>` text
     * are updated in place — rebuilding the controls would drop focus during a language switch.
     * The signals multi-select is refreshed by re-applying its value, which re-renders the trigger
     * with the translated placeholder.
     */
    _refreshToolbarControlLabels() {
        this.#executionTypeControl?.element?.setAttribute(
            'aria-label',
            this.t('graph.toolbar.executionType.label')
        );

        const sleepLabel = this.#sleepHost?.querySelector('.custom-control__label');
        if (sleepLabel) {
            sleepLabel.textContent = this.t('graph.toolbar.sleepDuration.label');
        }

        const options = this.#executionTypeControl?.element?.options;
        if (options) {
            if (options[0]) {
                options[0].textContent = this.t('graph.toolbar.executionType.startup');
            }
            if (options[1]) {
                options[1].textContent = this.t('graph.toolbar.executionType.loop');
            }
            if (options[2]) {
                options[2].textContent = this.t('graph.toolbar.executionType.irq');
            }
            if (options[3]) {
                options[3].textContent = this.t('graph.toolbar.executionType.event');
            }
        }

        this.#triggerNameControl?.element?.setAttribute(
            'aria-label',
            this.t('graph.toolbar.triggerName.label')
        );

        // Re-applying the value re-renders the trigger, which re-reads the translated
        // placeholder and the `ariaLabel` option. Both selects only need their texts.
        const selectedSignals = this.#signalNamesControl?.getSelectedValue();
        if (typeof selectedSignals === 'string' || Array.isArray(selectedSignals)) {
            this.#signalNamesControl?.setValue(selectedSignals);
        }

        this.#signalModeControl?.element?.setAttribute(
            'aria-label',
            this.t('graph.toolbar.signalMode.label')
        );

        const signalModeOptions = this.#signalModeControl?.element?.options;
        if (signalModeOptions) {
            if (signalModeOptions[0]) {
                signalModeOptions[0].textContent = this.t('graph.toolbar.signalMode.any');
            }
            if (signalModeOptions[1]) {
                signalModeOptions[1].textContent = this.t('graph.toolbar.signalMode.all');
            }
        }
    }

    /**
     * ViewBase hook called after render completes.
     * Set up visibility observer here.
     */
    afterAttach() {
        super.afterAttach();
        this.registerVisibilityHandler();

        // Subscribe to i18n changes for translated UI elements
        this._subscribeToLanguageChanges(() => {
            this._updateToolbarLabels();
            this._refreshToolbarControlLabels();
            this.renderPanel();
        });
    }

    /**
     * ViewBase hook called before detachment.
     * Clean up event listeners and observers.
     */
    beforeDetach() {
        this.interactionModule?.cancelInteractions({
            detachDocumentDragListeners: () => this.#detachDocumentDragListeners(),
        });

        // Clean up document-level drag listeners
        this.#detachDocumentDragListeners();

        // Cancel pending resize
        clearTimeout(this._resizeDebounceTimer);
        // Never lose a still-debounced pan/zoom on a tab or graph switch
        this.#flushViewportPersist();

        // Clean up keyboard listener
        if (this._bound?.keydown) {
            document.removeEventListener('keydown', this._bound.keydown);
        }

        // Unsubscribe from NodeGraph changes
        if (this._graphChangeUnsubscribe) {
            this._graphChangeUnsubscribe();
            this._graphChangeUnsubscribe = null;
        }

        if (this._collectionChangeUnsubscribe) {
            this._collectionChangeUnsubscribe();
            this._collectionChangeUnsubscribe = null;
        }

        if (this._runtimeCollectionUnsubscribe) {
            this._runtimeCollectionUnsubscribe();
            this._runtimeCollectionUnsubscribe = null;
        }

        if (this._historySelectionUnsubscribe) {
            this._historySelectionUnsubscribe();
            this._historySelectionUnsubscribe = null;
        }

        // Note: ViewBase disconnects ResizeObserver automatically in beforeDetach()

        // Clean up canvas event listeners
        if (this.canvas) {
            for (const [type, handler] of Object.entries(this._bound)) {
                if (handler) {
                    this.canvas.removeEventListener(type, handler);
                }
            }
        }

        // CRITICAL: Reset events bound flag so they can be rebound if view is re-attached
        // This ensures that when TabbedView reattaches this view, #bindEvents() will properly
        // rebind all event listeners to the canvas
        this._eventsBound = false;

        // Clean up visibility observer
        if (this._visibilityObserver) {
            this._visibilityObserver.disconnect();
            this._visibilityObserver = null;
        }

        super.beforeDetach();
    }

    /**
     * ViewBase serialization - save viewport and grid state (Phase 4)
     * @returns {object} Serialized state
     */
    serialize() {
        return {
            ...super.serialize(),
            type: 'GraphPanelView',
            graphId: this.graph?.id || null,
            viewport: this.viewportModule.serialize(),
            grid: {
                enabled: this.gridEnabled,
                visible: this.showGrid,
            },
            selection: this.selection.serialize(),
        };
    }

    /**
     * ViewBase deserialization - restore viewport and grid state (Phase 4)
     * @param {object} data - Serialized state
     * @param {object} _context - Context with i18nService, logger, etc.
     */
    deserialize(data, _context) {
        // Delegate viewport deserialization to module
        this.viewportModule.deserialize(data);

        if (data.grid) {
            this.gridEnabled = data.grid.enabled ?? this.gridEnabled;
            this.showGrid = data.grid.visible ?? this.showGrid;
        }

        // Phase 2: Delegate selection deserialization to module
        if (data.selection) {
            this.selection.deserialize(data.selection);
        }

        // Legacy: support old selectedNodeId field
        if (data.selectedNodeId) {
            this.selection.selectSingleNode(normalizeNodeId(data.selectedNodeId));
        }

        // Restore the active node from the restored selection (last selected wins).
        const restoredSelection = this.selection.getSelectedNodeIds();
        this.activeNodeId =
            restoredSelection.length > 0 ? restoredSelection[restoredSelection.length - 1] : null;

        // Request render if attached
        if (this.isAttached) {
            this.renderPanel();
        }
    }

    /**
     * ViewBase hook for initial size detection (Phase 4)
     * @param {object} size - {width, height} of container
     */
    onInitialSize(size) {
        super.onInitialSize(size);
        this.resizeCanvas();
        this.#ensureInitialViewport(size);
        this.renderPanel();
        this._log('initial-size', size);
    }

    /**
     * ViewBase hook for size changes (Phase 4)
     * @param {object} size - {width, height} of container
     */
    onResized(size) {
        super.onResized(size);

        // Don't resize canvas immediately during rapid events (e.g., splitter drag)
        // because resizing clears the canvas causing flickering
        // Instead, debounce the resize and just update CSS size
        if (this.canvas) {
            const newStyleWidth = `${size.width}px`;
            const newStyleHeight = `${size.height}px`;

            // Update CSS size immediately so container scales
            if (this.canvas.style.width !== newStyleWidth) {
                this.canvas.style.width = newStyleWidth;
            }
            if (this.canvas.style.height !== newStyleHeight) {
                this.canvas.style.height = newStyleHeight;
            }
        }

        // Debounce the actual canvas resize (which clears content)
        clearTimeout(this._resizeDebounceTimer);
        this._resizeDebounceTimer = setTimeout(() => {
            this.resizeCanvas();
            this.#ensureInitialViewport(size);
            this.renderPanel();
        }, 150); // Wait for drag to settle
    }

    /**
     * Determine if the container (and canvas) is currently visible and has a measurable size.
     * This guards rendering when panels are hidden (display: none) or detached.
     * @returns {boolean}
     */
    isContainerVisible() {
        const host = this.container;
        if (!host || !host.isConnected) {
            return false;
        }
        const rects = host.getClientRects ? host.getClientRects() : null;
        if (!rects || rects.length === 0) {
            return false;
        }
        const rect = rects[0];
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * Apply a visibility state change and trigger a render if we were waiting for show.
     * @param {boolean} visible
     * @param {{force?:boolean}} [options]
     */
    applyVisibilityState(visible, { force = false } = {}) {
        const prev = this._isVisible;
        this._isVisible = Boolean(visible);
        if (!this._isVisible) {
            this._pendingRenderOnShow = true;
            return;
        }
        // Becoming visible: ensure canvas sizes are up to date and render if needed.
        if (!prev || this._pendingRenderOnShow || force) {
            this._pendingRenderOnShow = false;
            this.resizeCanvas();
            this.#ensureInitialViewport();
            this.renderPanel();
        }
    }

    /**
     * Clamp a prospective zoom factor to the viewport's allowed range.
     * @param {number} value - Desired scale value.
     * @returns {number} Clamped scale within [minScale, maxScale].
     */
    clampViewportScale(value) {
        return this.viewportModule.clampViewportScale(value);
    }

    /**
     * Apply the current viewport transform to a rendering context.
     * Preserves any existing DPR scaling by using transform() instead of setTransform().
     * @param {CanvasRenderingContext2D} ctx - Target context.
     */
    applyViewport(ctx) {
        return this.viewportModule.applyViewport(ctx);
    }

    /**
     * Convert screen-space coordinates to world-space using the active viewport.
     * @param {{x:number,y:number}} point - Screen position (pixels).
     * @returns {{x:number,y:number}} World position.
     */
    screenToWorld(point) {
        return this.viewportModule.screenToWorld(point);
    }

    /**
     * Convert world-space coordinates to screen-space using the active viewport.
     * @param {{x:number,y:number}} point - World position.
     * @returns {{x:number,y:number}} Screen position (pixels).
     */
    worldToScreen(point) {
        return this.viewportModule.worldToScreen(point);
    }

    /**
     * Resolve an event's position relative to the canvas element.
     * @param {MouseEvent|DragEvent|WheelEvent} event - Pointer event.
     * @returns {{x:number,y:number}} Position in canvas pixels.
     */
    getCanvasPosScreenFromEvent(event) {
        if (!event || !this.canvas || typeof this.canvas.getBoundingClientRect !== 'function') {
            return { x: 0, y: 0 };
        }
        const rect = this.canvas.getBoundingClientRect();
        const posScreen = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
        return posScreen;
    }

    /**
     * Clamp viewport translation so the grid stays within the visible bounds.
     * @param {{translateX:number,translateY:number}} nextT - Proposed translation.
     * @returns {{translateX:number,translateY:number}} Clamped translation.
     */
    clampViewportTranslate(nextT) {
        const canvasClientSize = this.getCanvasClientSizeScreen();
        return this.viewportModule.clampViewportTranslate(nextT, canvasClientSize);
    }

    /**
     * Update viewport scale and translation with clamping safeguards.
     * @param {{scale?:number,translateX?:number,translateY?:number}} next - Desired viewport values.
     */
    setViewport(next) {
        const canvasClientSize = this.getCanvasClientSizeScreen();
        return this.viewportModule.setViewport(next, canvasClientSize);
    }

    /**
     * Zoom around a specific screen point, maintaining that point under the cursor.
     * @param {{x:number,y:number}} posScreen - Anchor in screen space.
     * @param {number} factor - Multiplicative zoom factor.
     */
    zoomAt(posScreen, factor) {
        const canvasClientSize = this.getCanvasClientSizeScreen();
        return this.viewportModule.zoomAt(posScreen, factor, canvasClientSize);
    }

    /**
     * Debounce persisting an interactive viewport change into the graph document.
     *
     * Rapid pan/zoom input collapses into one `graph.setViewportConfig()` write, so the graph emits
     * a single `viewport` event and marks the collection dirty once. Nothing is scheduled while the
     * opening viewport is resolved, which keeps merely opening a graph free of document mutations.
     * @private
     */
    #scheduleViewportPersist() {
        if (this.#applyingInitialViewport) {
            return;
        }
        if (typeof this.graph?.setViewportConfig !== 'function') {
            return;
        }
        if (this._viewportPersistTimer !== null) {
            clearTimeout(this._viewportPersistTimer);
        }
        this._viewportPersistTimer = setTimeout(() => {
            this._viewportPersistTimer = null;
            this.#persistViewport();
        }, VIEWPORT_PERSIST_DEBOUNCE_MS);
    }

    /**
     * Write the current viewport into the graph document unless it already matches the stored value.
     *
     * `NodeGraph#setViewportConfig` emits `viewport` and marks the collection dirty on every call,
     * so the equality check keeps no-op gestures from producing events. The graph is addressed
     * directly: `Collection#setViewportConfig` forwards the same call *and* marks the collection
     * dirty itself, which would double both the event and the dirty mark.
     * @private
     */
    #persistViewport() {
        if (typeof this.graph?.setViewportConfig !== 'function') {
            return;
        }
        const next = this.viewportModule.serialize();
        const current = this.graph.getViewportConfig?.() || null;
        if (
            current &&
            current.scale === next.scale &&
            current.translateX === next.translateX &&
            current.translateY === next.translateY
        ) {
            return;
        }

        this.graph.setViewportConfig(
            new ViewportConfig({
                scale: next.scale,
                translateX: next.translateX,
                translateY: next.translateY,
            })
        );
        this._log('viewport-persisted', {
            scale: next.scale,
            translateX: next.translateX,
            translateY: next.translateY,
        });
    }

    /**
     * Write a pending viewport change immediately.
     *
     * Tab and graph switches detach the panel, so a still-debounced gesture would otherwise be lost.
     * @private
     */
    #flushViewportPersist() {
        if (this._viewportPersistTimer === null) {
            return;
        }
        clearTimeout(this._viewportPersistTimer);
        this._viewportPersistTimer = null;
        this.#persistViewport();
    }

    /**
     * Resolve the opening viewport the first time the panel has a measurable canvas.
     *
     * Runs at most once per bound graph, so later resizes and visibility changes keep whatever the
     * user has panned or zoomed to. A zero-sized container (hidden tab, collapsed split) is
     * ignored and retried by the next hook.
     *
     * The measured canvas wins over the hook-provided size because the canvas sits below the
     * toolbar: the container is taller, and centering against the container would shift the
     * content down by half the toolbar height. The hook size is only a fallback for hosts that
     * cannot measure the canvas yet.
     * @param {{width:number,height:number}} [size] - Container size reported by a view hook.
     * @private
     */
    #ensureInitialViewport(size = null) {
        if (this._initialViewportApplied || !this.graph || !this.canvas) {
            return;
        }

        const measured = this.getCanvasClientSizeScreen();
        const canvasSize = measured.width > 0 && measured.height > 0 ? measured : size;
        if (!(canvasSize?.width > 0) || !(canvasSize?.height > 0)) {
            return;
        }

        this._initialViewportApplied = true;
        this.#resolveInitialViewport(canvasSize);
    }

    /**
     * Restore the stored viewport or center the graph content on the canvas.
     *
     * Opening a graph must never mutate the document, so the change notification that
     * `setViewport` / `centerOnWorldPoint` trigger is suppressed through
     * {@link GraphPanelView.#applyingInitialViewport}. Values are still clamped by the viewport
     * module, which is why near-origin content ends up only as centered as the grid clamp allows.
     * @param {{width:number,height:number}} canvasSize - Canvas dimensions in screen pixels.
     * @private
     */
    #resolveInitialViewport(canvasSize) {
        const stored = this.graph?.getViewportConfig?.() || null;
        const storedScale = stored?.scale;
        const storedTranslateX = stored?.translateX;
        const storedTranslateY = stored?.translateY;
        const scale =
            typeof storedScale === 'number' && Number.isFinite(storedScale)
                ? storedScale
                : this.viewportModule.getDefaultScale();
        const translateX =
            typeof storedTranslateX === 'number' && Number.isFinite(storedTranslateX)
                ? storedTranslateX
                : 0;
        const translateY =
            typeof storedTranslateY === 'number' && Number.isFinite(storedTranslateY)
                ? storedTranslateY
                : 0;
        const hasStoredView = Boolean(
            stored && (scale !== 1 || translateX !== 0 || translateY !== 0)
        );

        this.#applyingInitialViewport = true;
        try {
            if (hasStoredView) {
                this.viewportModule.setViewport({ scale, translateX, translateY }, canvasSize);
                return;
            }

            this.viewportModule.setViewport(
                { scale: this.viewportModule.getDefaultScale(), translateX: 0, translateY: 0 },
                canvasSize
            );
            this.viewportModule.centerOnWorldPoint(this.#computeInitialCenterWorld(), canvasSize);
        } finally {
            this.#applyingInitialViewport = false;
        }
    }

    /**
     * Center of the union of the node and documentation-area bounds in world coordinates.
     *
     * An empty graph falls back to the grid world center so the first open shows the middle of the
     * grid instead of its top-left corner.
     * @returns {{x:number,y:number}} World position to place at the canvas center.
     * @private
     */
    #computeInitialCenterWorld() {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        /**
         * Grow the accumulated box by one rectangle, ignoring incomplete or non-finite geometry.
         * @param {unknown} x
         * @param {unknown} y
         * @param {unknown} width
         * @param {unknown} height
         */
        const includeRect = (x, y, width, height) => {
            if (![x, y, width, height].every((value) => Number.isFinite(value))) {
                return;
            }
            minX = Math.min(minX, x as number);
            minY = Math.min(minY, y as number);
            maxX = Math.max(maxX, (x as number) + (width as number));
            maxY = Math.max(maxY, (y as number) + (height as number));
        };

        const nodes = this.graph?.getNodes?.() ?? [];
        nodes.forEach((node) => includeRect(node?.x, node?.y, node?.width, node?.height));

        const areas = this.graph?.getDocumentationAreas?.() ?? [];
        areas.forEach((area) => {
            const bounds = (area as { bounds?: DocumentationAreaBounds } | undefined)?.bounds;
            includeRect(bounds?.x, bounds?.y, bounds?.width, bounds?.height);
        });

        if (minX === Infinity) {
            return { x: this.gridSizeWorld.width / 2, y: this.gridSizeWorld.height / 2 };
        }

        return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }

    /**
     * Get the current rendering target (readability canvas if enabled).
     * @returns {{ctx:CanvasRenderingContext2D|null,canvas:HTMLCanvasElement|null,readability:boolean}}
     */
    getRenderContext() {
        const targetCanvas = this.readabilityCanvas || this.canvas;
        const ctx = targetCanvas?.getContext('2d') || null;
        return {
            ctx,
            canvas: targetCanvas,
            readability: Boolean(this.readabilityCanvas && targetCanvas === this.readabilityCanvas),
        };
    }

    /**
     * Resize owned canvases to match the host container or window size.
     * Uses devicePixelRatio for sharp rendering on high-DPI displays.
     */
    resizeCanvas() {
        const host =
            this.#canvasHost ||
            this.canvas?.parentElement ||
            this.container ||
            (typeof document !== 'undefined' ? document.body : null);
        const width =
            (host && host.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 0);
        const height =
            (host && host.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : 0);

        // Get device pixel ratio for high-DPI displays
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        this.canvasDPR = dpr; // Store for use in rendering

        if (this.canvas) {
            // Only update CSS dimensions if they changed (prevents resize loops)
            const currentStyleWidth = this.canvas.style.width;
            const currentStyleHeight = this.canvas.style.height;
            const newStyleWidth = `${width}px`;
            const newStyleHeight = `${height}px`;

            if (currentStyleWidth !== newStyleWidth) {
                this.canvas.style.width = newStyleWidth;
            }
            if (currentStyleHeight !== newStyleHeight) {
                this.canvas.style.height = newStyleHeight;
            }

            // Set actual canvas size (device pixels)
            this.canvas.width = width * dpr;
            this.canvas.height = height * dpr;

            // Note: ctx.scale() is applied in renderPanel() after setTransform()
            // to avoid accumulation issues
        }
        if (this.readabilityCanvas) {
            // Only update CSS dimensions if they changed (prevents resize loops)
            const currentStyleWidth = this.readabilityCanvas.style.width;
            const currentStyleHeight = this.readabilityCanvas.style.height;
            const newStyleWidth = `${width}px`;
            const newStyleHeight = `${height}px`;

            if (currentStyleWidth !== newStyleWidth) {
                this.readabilityCanvas.style.width = newStyleWidth;
            }
            if (currentStyleHeight !== newStyleHeight) {
                this.readabilityCanvas.style.height = newStyleHeight;
            }

            // Set actual canvas size (device pixels)
            this.readabilityCanvas.width = width * dpr;
            this.readabilityCanvas.height = height * dpr;

            // Note: ctx.scale() is applied in renderPanel() after setTransform()
            // to avoid accumulation issues
        }
        // The background canvas (grid + documentation shading) shares one resize path with the
        // main canvas: no second ResizeObserver, no second window resize handler.
        if (this.backgroundCanvas) {
            const currentStyleWidth = this.backgroundCanvas.style.width;
            const currentStyleHeight = this.backgroundCanvas.style.height;
            const newStyleWidth = `${width}px`;
            const newStyleHeight = `${height}px`;

            if (currentStyleWidth !== newStyleWidth) {
                this.backgroundCanvas.style.width = newStyleWidth;
            }
            if (currentStyleHeight !== newStyleHeight) {
                this.backgroundCanvas.style.height = newStyleHeight;
            }

            this.backgroundCanvas.width = width * dpr;
            this.backgroundCanvas.height = height * dpr;
        }
    }

    /**
     * Configure canvas context for optimal text rendering.
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @private
     */
    #configureCanvasTextRendering(ctx) {
        // Enable font smoothing for better anti-aliasing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Set text rendering baseline
        ctx.textBaseline = 'middle';
    }

    // Create canvases when a host element wasn’t provided.
    /**
     * Lazily create the main and readability canvases when a host is not supplied.
     * @private
     */
    #createCanvas() {
        if (this.canvas || typeof document === 'undefined') {
            return;
        }
        const host = this.#canvasHost || this.container || document.body;
        const canvas = document.createElement('canvas');
        canvas.id = 'otter-canvas-v2';
        canvas.className = 'graph-panel-view__canvas-node';
        canvas.style.display = 'block';
        canvas.style.position = 'absolute'; // Remove from layout flow to prevent resize loops
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        host.appendChild(canvas);
        this.canvas = canvas;
        this.ownsCanvas = true;
        this.#createBackgroundCanvas();
        this.#createCapabilityTooltip();

        if (this.enableReadabilityCanvas) {
            const readability = document.createElement('canvas');
            readability.style.display = 'none';
            host.appendChild(readability);
            this.readabilityCanvas = readability;
            this.ownsReadabilityCanvas = true;
        }

        this.resizeCanvas();
    }

    /**
     * Create the background canvas that carries the grid and the documentation-area shading.
     *
     * It is inserted **before** the node canvas so DOM order yields the paint order
     * grid/shading → documentation text layer → connections/nodes, without relying on
     * `z-index` support in a particular host.
     * @private
     */
    #createBackgroundCanvas() {
        if (this.backgroundCanvas || !this.canvas || typeof document === 'undefined') {
            return;
        }

        const background = document.createElement('canvas');
        background.className = 'graph-panel-view__canvas-bg';
        background.style.pointerEvents = 'none';
        this.canvas.parentNode?.insertBefore(background, this.canvas);
        this.backgroundCanvas = background;
        this.ownsBackgroundCanvas = true;
    }

    /**
     * Create the documentation layer once the canvas host and node canvas exist.
     * @returns {GraphPanelDocumentationLayer|null} The layer, or null before layout.
     * @private
     */
    #ensureDocumentationLayer() {
        if (this.documentationLayer) {
            return this.documentationLayer;
        }
        const host = this.#canvasHost;
        if (!host || typeof document === 'undefined') {
            return null;
        }

        this.documentationLayer = new GraphPanelDocumentationLayer({
            host,
            before: this.canvas,
            viewport: this.viewportModule,
            translate: (key, fallback) => this._tWithFallback(key, fallback),
            onAreaMenu: (areaId, anchor) => this._showDocumentationAreaMenu?.(areaId, anchor),
            onAreaActivate: (areaId) => this.setActiveDocumentationArea(areaId),
            onAreaMarkdownCommit: (areaId, markdown) =>
                this.graph?.updateDocumentationArea?.(areaId, { markdown }),
            onAreaTitleCommit: (areaId, title) =>
                this.graph?.updateDocumentationArea?.(areaId, { title }),
        });
        this.documentationLayer.mount();
        return this.documentationLayer;
    }

    /**
     * Translate a key, falling back to the English default when no translation exists.
     * @param {string} key - i18n key.
     * @param {string} fallback - English default.
     * @returns {string} Resolved label.
     */
    _tWithFallback(key, fallback) {
        const value = this.t(key);
        return !value || value === key ? fallback : value;
    }

    /**
     * Push the current areas and viewport into the DOM layer.
     * @private
     */
    #syncDocumentationLayer() {
        const layer = this.#ensureDocumentationLayer();
        if (!layer) {
            return;
        }

        const areas = this.graph?.getDocumentationAreas?.() ?? [];
        if (
            this.activeDocumentationAreaId &&
            !areas.some((area) => area.id === this.activeDocumentationAreaId)
        ) {
            this.activeDocumentationAreaId = null;
        }

        layer.syncViewport();
        layer.render(areas, { activeAreaId: this.activeDocumentationAreaId });
    }

    /**
     * Set (or clear) the active documentation area.
     * @param {string|null} areaId - Area to activate.
     */
    setActiveDocumentationArea(areaId) {
        const nextId = typeof areaId === 'string' && areaId ? areaId : null;
        if (this.activeDocumentationAreaId === nextId) {
            return;
        }
        this.activeDocumentationAreaId = nextId;
        this.documentationLayer?.setActiveAreaId(nextId);
        this.renderPanel();
    }

    /**
     * Hit-test documentation areas under a world position.
     * @param {{x:number,y:number}} posWorld - Pointer position in world coordinates.
     * @returns {{areaId:string, zone:string}|null} Hit or null.
     * @private
     */
    _hitTestDocumentationArea(posWorld) {
        const areas = this.graph?.getDocumentationAreas?.() ?? [];
        const scale = this.viewport?.scale ?? 1;
        return hitTestDocumentationAreas(posWorld, areas, scale);
    }

    /**
     * Start a move/resize gesture on a documentation area.
     * @param {{areaId:string, zone:string}} hit - Hit result from the interaction module.
     * @param {MouseEvent} event - Originating mouse event.
     * @private
     */
    _handleDocumentationAreaMouseDown(hit, event) {
        const graph = this.graph;
        if (!graph || !hit) {
            return;
        }

        this.setActiveDocumentationArea(hit.areaId);
        const area = graph.getDocumentationArea?.(hit.areaId) ?? null;
        if (!area) {
            return;
        }

        const posWorld = this.screenToWorld(this.getCanvasPosScreenFromEvent(event));
        const mode = hit.zone === 'resize' ? 'resize' : 'move';

        graph.startDocumentationAreaDrag?.(hit.areaId, mode);
        this._documentationAreaDrag = {
            areaId: hit.areaId,
            mode,
            startBounds: area.toData().bounds,
            startWorld: posWorld,
        };
        this.setCursor(mode === 'resize' ? 'nwse-resize' : 'move');
        this.#attachDocumentDragListeners();
    }

    /**
     * Stream the gesture's bounds, or update hover/cursor feedback when idle.
     * @param {{x:number,y:number}} posWorld - Pointer position in world coordinates.
     * @returns {boolean} True when a gesture consumed the move.
     * @private
     */
    _handleDocumentationAreaPointerMove(posWorld) {
        const drag = this._documentationAreaDrag;
        const graph = this.graph;

        if (!drag || !graph) {
            const hit = this._hitTestDocumentationArea(posWorld);
            this.documentationLayer?.setHoveredArea(hit ? hit.areaId : null);
            if (hit) {
                this.setCursor(
                    hit.zone === 'resize' ? 'nwse-resize' : hit.zone === 'header' ? 'move' : 'grab'
                );
            }
            return false;
        }

        const step = Number.isFinite(this.constants?.GRID_SPACING)
            ? Number(this.constants.GRID_SPACING)
            : 32;
        const snap = this.gridEnabled === true;
        const start = drag.startBounds;
        const deltaX = posWorld.x - drag.startWorld.x;
        const deltaY = posWorld.y - drag.startWorld.y;

        let nextBounds;
        if (drag.mode === 'move') {
            let x = start.x + deltaX;
            let y = start.y + deltaY;
            if (snap) {
                x = Math.round(x / step) * step;
                y = Math.round(y / step) * step;
            }
            nextBounds = { x, y, width: start.width, height: start.height };
        } else {
            let width = Math.max(DOCUMENTATION_AREA_MIN_SIZE.width, start.width + deltaX);
            let height = Math.max(DOCUMENTATION_AREA_MIN_SIZE.height, start.height + deltaY);
            if (snap) {
                width = Math.max(
                    DOCUMENTATION_AREA_MIN_SIZE.width,
                    Math.round((start.x + width) / step) * step - start.x
                );
                height = Math.max(
                    DOCUMENTATION_AREA_MIN_SIZE.height,
                    Math.round((start.y + height) / step) * step - start.y
                );
            }
            nextBounds = { x: start.x, y: start.y, width, height };
        }

        graph.setDocumentationAreaBounds?.(
            drag.areaId,
            this.#clampDocumentationAreaBounds(nextBounds)
        );
        return true;
    }

    /**
     * Keep an area inside the graph's world extent while leaving it reachable.
     * @param {{x:number,y:number,width:number,height:number}} bounds - Candidate bounds.
     * @returns {{x:number,y:number,width:number,height:number}} Clamped bounds.
     * @private
     */
    #clampDocumentationAreaBounds(bounds) {
        const keepVisible = 40;
        const world = this.viewportModule?.gridSizeWorld ?? { width: 0, height: 0 };
        const maxX = Math.max(0, world.width - keepVisible);
        const maxY = Math.max(0, world.height - keepVisible);
        const width = Math.max(
            DOCUMENTATION_AREA_MIN_SIZE.width,
            Math.min(bounds.width, Math.max(world.width, DOCUMENTATION_AREA_MIN_SIZE.width))
        );
        const height = Math.max(
            DOCUMENTATION_AREA_MIN_SIZE.height,
            Math.min(bounds.height, Math.max(world.height, DOCUMENTATION_AREA_MIN_SIZE.height))
        );

        return {
            x: Math.min(Math.max(bounds.x, 0), maxX),
            y: Math.min(Math.max(bounds.y, 0), maxY),
            width,
            height,
        };
    }

    /**
     * End the active documentation-area gesture (the single history step happens here).
     * @returns {boolean} True when a gesture was active.
     * @private
     */
    _handleDocumentationAreaPointerUp() {
        const drag = this._documentationAreaDrag;
        if (!drag) {
            return false;
        }

        this._documentationAreaDrag = null;
        this.graph?.endDocumentationAreaDrag?.(drag.areaId);
        this.setCursor('grab');
        return true;
    }

    /**
     * Cancel the active gesture without recording history (Escape).
     * @returns {boolean} True when a gesture was cancelled.
     * @private
     */
    _cancelDocumentationAreaDrag() {
        const drag = this._documentationAreaDrag;
        if (!drag) {
            return false;
        }

        this._documentationAreaDrag = null;
        this.graph?.setDocumentationAreaBounds?.(drag.areaId, drag.startBounds);
        // Ending after restoring the start bounds makes the capture see no delta, so the undo
        // stack stays untouched.
        this.graph?.endDocumentationAreaDrag?.(drag.areaId);
        this.setCursor('grab');
        this.renderPanel();
        return true;
    }

    /**
     * Open the inline Markdown editor for an area.
     * @param {string} areaId - Area to edit.
     * @private
     */
    _editDocumentationArea(areaId) {
        if (!areaId) {
            return;
        }
        this.setActiveDocumentationArea(areaId);
        this.documentationLayer?.showEditor(areaId);
    }

    /**
     * Open the inline title editor for an area.
     * @param {string} areaId - Area to rename.
     * @private
     */
    _renameDocumentationArea(areaId) {
        if (!areaId) {
            return;
        }
        this.setActiveDocumentationArea(areaId);
        this.documentationLayer?.showTitleEditor(areaId);
    }

    /**
     * Delete the active documentation area undoably.
     *
     * The history pre-hook must run first: it caches the data and index the inverse operation
     * needs to restore the very same box at the very same position in the list.
     * @returns {boolean} True when an area was removed.
     */
    removeActiveDocumentationArea() {
        const areaId = this.activeDocumentationAreaId;
        if (!areaId || !this.graph) {
            return false;
        }

        const historyManager = this.collection?.getHistoryManager?.() || null;
        historyManager?.beforeDocumentationAreaRemove?.(areaId);
        const removed = this.graph.removeDocumentationArea?.(areaId) === true;
        if (removed) {
            this.activeDocumentationAreaId = null;
            this.documentationLayer?.setActiveAreaId(null);
        }
        this.renderPanel();
        return removed;
    }

    /**
     * Keyboard handling for the active documentation area.
     * @param {KeyboardEvent} event - Key event from the interaction module.
     * @returns {boolean} True when the key was consumed.
     * @private
     */
    _handleDocumentationAreaKeyDown(event) {
        if (!event) {
            return false;
        }

        if (event.key === 'Escape') {
            if (this._cancelDocumentationAreaDrag()) {
                event.preventDefault();
                return true;
            }
            if (this.documentationLayer?.getEditingAreaId?.()) {
                this.documentationLayer.cancelEditor();
                event.preventDefault();
                return true;
            }
            if (this.activeDocumentationAreaId) {
                event.preventDefault();
                this.setActiveDocumentationArea(null);
                return true;
            }
            return false;
        }

        if (event.key === 'F2' && this.activeDocumentationAreaId) {
            event.preventDefault();
            this._renameDocumentationArea(this.activeDocumentationAreaId);
            return true;
        }

        if (
            (event.key === 'Delete' || event.key === 'Backspace') &&
            this.activeDocumentationAreaId &&
            this.selection.selectedNodes.size === 0
        ) {
            event.preventDefault();
            this.removeActiveDocumentationArea();
            return true;
        }

        return false;
    }

    /**
     * Open the documentation-area menu (burger button or header right-click).
     * @param {string|null} areaId - Area the menu acts on.
     * @param {DOMRect|null} anchorRect - Screen rect the menu opens beside.
     * @private
     */
    #showDocumentationAreaMenu(areaId, anchorRect) {
        const resolvedId =
            typeof areaId === 'string' && areaId ? areaId : this.activeDocumentationAreaId;
        if (!resolvedId || !this.graph || typeof document === 'undefined') {
            return;
        }

        const area = this.graph.getDocumentationArea?.(resolvedId)?.toData?.() ?? null;
        if (!area) {
            return;
        }

        this.setActiveDocumentationArea(resolvedId);

        const items = createDocumentationAreaMenuItems({
            area,
            isEditing: this.documentationLayer?.getEditingAreaId?.() === resolvedId,
            hasClipboardData: Boolean(this.clipboardManager?.hasData?.()),
            selectedNodeCount: this.selection.selectedNodes.size,
            t: (key, fallback) => this._tWithFallback(key, fallback),
            actions: {
                edit: (id) => this._toggleDocumentationAreaEditing(id),
                changeColor: (id) => this._showDocumentationAreaColorPicker(id),
                rename: (id) => this._renameDocumentationArea(id),
                alignContent: (id, align) => this._setDocumentationAreaContentAlign(id, align),
                setFontSize: (id, fontSize) => this._setDocumentationAreaFontSize(id, fontSize),
                cut: (id) => this._cutDocumentationArea(id),
                copy: (id) => this._copyDocumentationArea(id),
                paste: (id) => this._pasteDocumentationArea(id),
                duplicate: (id) => this._duplicateDocumentationArea(id),
                fitToSelection: (id) => this._fitDocumentationAreaToSelection(id),
                remove: (id) => this._removeDocumentationArea(id),
            },
        });

        const menuWindow = new MenuWindow({
            items,
            anchor: anchorRect ?? undefined,
            x: anchorRect?.left ?? 0,
            y: anchorRect?.bottom ?? 0,
            onSelect: (item) => {
                const action = item?.action;
                if (typeof action === 'function') {
                    action();
                }
            },
            i18nService: this._i18nService,
            logger: this._logger,
        });

        if (this.viewManager) {
            this._activeContextMenu = this.viewManager.addOverlay(menuWindow);
        } else {
            const host = this.container?.ownerDocument?.body || document.body;
            menuWindow.attachTo(host);
            this._activeContextMenu = menuWindow;
        }

        menuWindow.on('close', (event) => {
            assertAppEventPayloadType(
                event,
                'OverlayWindow.Close.v1',
                'GraphPanelView.documentationAreaMenuCloseListener'
            );
            this._activeContextMenu = null;
            });
    }

    /**
     * Toggle the inline Markdown editor for an area.
     * @param {string} areaId - Area to edit.
     * @returns {boolean} True when the edit state changed.
     * @private
     */
    _toggleDocumentationAreaEditing(areaId) {
        const layer = this.documentationLayer;
        if (!layer) {
            return false;
        }
        if (layer.getEditingAreaId?.() === areaId) {
            layer.commitEditor();
            return true;
        }
        this.setActiveDocumentationArea(areaId);
        return layer.showEditor(areaId);
    }

    /**
     * Native colour picker with live preview and a single-step commit.
     * @param {string} areaId - Area to recolour.
     * @private
     */
    _showDocumentationAreaColorPicker(areaId) {
        const area = this.graph?.getDocumentationArea?.(areaId) ?? null;
        if (!area || typeof document === 'undefined') {
            return;
        }

        const storedColor = normalizeAreaColor(area.color);
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = storedColor;
        colorInput.style.position = 'absolute';
        colorInput.style.left = '-9999px';
        document.body.appendChild(colorInput);
        colorInput.click();

        // `input` only previews: dragging through the picker must never create history entries.
        colorInput.addEventListener('input', () => {
            this.documentationLayer?.previewAreaColor?.(areaId, colorInput.value);
        });

        colorInput.addEventListener('change', () => {
            this.graph.updateDocumentationArea?.(areaId, { color: colorInput.value });
            this.documentationLayer?.clearAreaColorPreview?.(areaId);
            this.renderPanel();
            this._log('documentation-area-color-changed', {
                areaId,
                oldColor: storedColor,
                newColor: colorInput.value,
            });
            colorInput.remove();
        });

        // A cancelled picker (blur without change) restores the stored colour.
        colorInput.addEventListener('blur', () => {
            this.documentationLayer?.clearAreaColorPreview?.(areaId);
            setTimeout(() => colorInput.remove(), 100);
        });
    }

    /**
     * Move the Markdown body to the top or the bottom of the box.
     *
     * Routed through `updateDocumentationArea()` so the change lands in the history manager as a
     * regular `documentation-area-updated` operation and can be undone.
     * @param {string} areaId - Area to realign.
     * @param {'top'|'bottom'} contentAlign - Requested placement.
     * @returns {boolean} True when the graph was asked to change the area.
     * @private
     */
    _setDocumentationAreaContentAlign(areaId, contentAlign) {
        const area = this.graph?.getDocumentationArea?.(areaId) ?? null;
        if (!area || typeof this.graph?.updateDocumentationArea !== 'function') {
            return false;
        }
        this.graph.updateDocumentationArea(areaId, { contentAlign });
        return true;
    }

    /**
     * Change the Markdown body/heading font-size preset.
     *
     * Routed through `updateDocumentationArea()` so the change is one regular
     * `documentation-area-updated` history step and can be undone.
     * @param {string} areaId - Area to change.
     * @param {'small'|'normal'|'large'} fontSize - Requested preset.
     * @returns {boolean} True when the graph was asked to change the area.
     * @private
     */
    _setDocumentationAreaFontSize(areaId, fontSize) {
        const area = this.graph?.getDocumentationArea?.(areaId) ?? null;
        if (!area || typeof this.graph?.updateDocumentationArea !== 'function') {
            return false;
        }
        this.graph.updateDocumentationArea(areaId, { fontSize });
        return true;
    }

    /**
     * Duplicate an area offset by (24, 24) in one history step.
     * @param {string} areaId - Area to copy.
     * @returns {boolean} True when a copy was created.
     * @private
     */
    _duplicateDocumentationArea(areaId) {
        const source = this.graph?.getDocumentationArea?.(areaId) ?? null;
        if (!source || !this.graph?.addDocumentationArea) {
            return false;
        }

        const data = source.toData();
        const untitled = this._tWithFallback('documentationArea.untitled', 'Untitled area');
        const titlePattern = this._tWithFallback('documentationArea.duplicateTitle', '{title} copy');
        const created = this.graph.addDocumentationArea({
            title: titlePattern.replace('{title}', data.title || untitled),
            markdown: data.markdown,
            color: data.color,
            contentAlign: data.contentAlign,
            fontSize: data.fontSize,
            bounds: {
                x: data.bounds.x + 24,
                y: data.bounds.y + 24,
                width: data.bounds.width,
                height: data.bounds.height,
            },
        });

        if (created?.id) {
            this.setActiveDocumentationArea(created.id);
        }
        return Boolean(created);
    }

    /**
     * Resize an area around the currently selected nodes.
     * @param {string} areaId - Area to fit.
     * @returns {boolean} True when the bounds were recomputed.
     * @private
     */
    _fitDocumentationAreaToSelection(areaId) {
        const nodeIds = [...this.selection.selectedNodes];
        if (nodeIds.length === 0 || !this.graph) {
            return false;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const nodeId of nodeIds) {
            const node = this.graph.getNode?.(nodeId) ?? null;
            if (!node) {
                continue;
            }
            const uiBounds = this.nodeUiMap.get(nodeId)?.getBounds?.() ?? null;
            const x = Number(node.x) || 0;
            const y = Number(node.y) || 0;
            const width = Number(uiBounds?.width ?? node.width ?? 150) || 150;
            const height = Number(uiBounds?.height ?? node.height ?? 100) || 100;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + width);
            maxY = Math.max(maxY, y + height);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
            return false;
        }

        const padding = 40;
        // A bounds change is only captured between a drag start/end pair, so a fit has to look like
        // a resize gesture to become exactly one undo step.
        this.graph.startDocumentationAreaDrag?.(areaId, 'resize');
        this.graph.setDocumentationAreaBounds?.(areaId, {
            x: minX - padding,
            y: minY - padding,
            width: Math.max(DOCUMENTATION_AREA_MIN_SIZE.width, maxX - minX + 2 * padding),
            height: Math.max(DOCUMENTATION_AREA_MIN_SIZE.height, maxY - minY + 2 * padding),
        });
        this.graph.endDocumentationAreaDrag?.(areaId);
        return true;
    }

    /**
     * Delete a documentation area (menu path; same history contract as the Delete key).
     * @param {string} areaId - Area to delete.
     * @returns {boolean} True when it was removed.
     * @private
     */
    /**
     * Remove a documentation area undoably (clipboard/facade path).
     *
     * Mirrors `removeActiveDocumentationArea()`: the history pre-hook first, then the removal, so
     * undo restores the same id at the same index.
     * @param {string} areaId - Area to remove.
     * @param {string} [description] - Caller description, used for logging only.
     * @returns {boolean} True when the area was removed.
     */
    _removeDocumentationAreaUndoably(areaId, description) {
        if (!this.graph) {
            return false;
        }
        const historyManager = this.collection?.getHistoryManager?.() || null;
        historyManager?.beforeDocumentationAreaRemove?.(areaId);
        const removed = this.graph.removeDocumentationArea?.(areaId) === true;
        if (removed) {
            if (this.activeDocumentationAreaId === areaId) {
                this.activeDocumentationAreaId = null;
                this.documentationLayer?.setActiveAreaId(null);
            }
            this._log('documentation-area-removed', { areaId, description: description ?? null });
        }
        this.renderPanel();
        return removed;
    }

    _removeDocumentationArea(areaId) {
        this.setActiveDocumentationArea(areaId);
        return this.removeActiveDocumentationArea();
    }

    /**
     * View of the clipboard facade that includes the documentation-area entry points.
     * @returns {DocumentationAreaClipboardLike} Clipboard facade with optional area methods.
     * @private
     */
    #documentationAreaClipboard() {
        return this.clipboard as unknown as DocumentationAreaClipboardLike;
    }


    /**
     * Copy an area to the app clipboard.
     * @param {string} areaId - Area to copy.
     * @returns {boolean} True when the clipboard accepted it.
     * @private
     */
    _copyDocumentationArea(areaId) {
        const clipboard = this.#documentationAreaClipboard();
        if (typeof clipboard?.copyArea !== 'function') {
            return false;
        }
        return clipboard.copyArea(areaId);
    }

    /**
     * Cut an area: copy it, then remove it undoably.
     * @param {string} areaId - Area to cut.
     * @returns {boolean} True when it was cut.
     * @private
     */
    _cutDocumentationArea(areaId) {
        const clipboard = this.#documentationAreaClipboard();
        if (typeof clipboard?.cutArea !== 'function') {
            return false;
        }
        return clipboard.cutArea(areaId);
    }

    /**
     * Paste the clipboard's areas to the right of the given area.
     * @param {string} areaId - Anchor area for the paste position.
     * @returns {boolean} True when something was pasted.
     * @private
     */
    _pasteDocumentationArea(areaId) {
        const clipboard = this.#documentationAreaClipboard();
        if (typeof clipboard?.pasteAreaAt !== 'function') {
            return false;
        }
        const bounds = this.graph?.getDocumentationArea?.(areaId)?.toData?.().bounds ?? null;
        if (!bounds) {
            return false;
        }
        return clipboard.pasteAreaAt(areaId, {
            x: bounds.x + bounds.width + 24,
            y: bounds.y,
        });
    }

    #createCapabilityTooltip() {
        if (this._capabilityTooltipEl || typeof document === 'undefined') {
            return;
        }
        const host = this.#canvasHost || this.container || document.body;
        const el = document.createElement('div');
        el.className = 'graph-panel-capability-tooltip';
        el.style.position = 'fixed';
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '9999';
        el.style.backgroundColor = 'rgba(17, 24, 39, 0.95)';
        el.style.color = '#fca5a5';
        el.style.padding = '6px 10px';
        el.style.borderRadius = '6px';
        el.style.fontSize = '12px';
        el.style.maxWidth = '360px';
        el.style.whiteSpace = 'pre-wrap';
        el.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        host.appendChild(el);
        this._capabilityTooltipEl = el;
    }

    /**
     * Re-attach an existing capability tooltip to the canvas host.
     *
     * `#createCanvas()` early-returns once a canvas exists, so after a
     * detach/attach cycle nothing would put the tooltip back into the DOM and
     * capability tooltips would silently stop rendering.
     * @private
     */
    #ensureCapabilityTooltipAttached() {
        const el = this._capabilityTooltipEl;
        if (!el || el.parentElement || typeof document === 'undefined') {
            return;
        }
        (this.#canvasHost || this.container || document.body).appendChild(el);
    }

    _updateCapabilityTooltip(event: MouseEvent): void {
        this.#createCapabilityTooltip();
        const el = this._capabilityTooltipEl;
        if (!el) {
            return;
        }

        const posScreen = this.getCanvasPosScreenFromEvent(event);
        const posWorld = this.screenToWorld(posScreen);
        const node = this.hitTestNode(posWorld);
        const rawIssues = (node as { capabilityIssues?: unknown } | null)?.capabilityIssues;
        const issues = Array.isArray(rawIssues) ? rawIssues : [];

        if (issues.length === 0) {
            el.style.display = 'none';
            return;
        }

        el.textContent = issues
            .map((issue) =>
                issue && typeof (issue as { message?: unknown }).message === 'string'
                    ? ((issue as { message: string }).message as string)
                    : ''
            )
            .filter((line) => line.length > 0)
            .join('\n');
        el.style.left = `${event.clientX + 12}px`;
        el.style.top = `${event.clientY + 12}px`;
        el.style.display = 'block';
    }

    _hideCapabilityTooltip(): void {
        if (this._capabilityTooltipEl) {
            this._capabilityTooltipEl.style.display = 'none';
        }
    }

    /**
     * Keep a NodeUi instance per graph node, updating selection state and pruning removed nodes.
     * @returns {string[]} node IDs from the graph
     */
    syncNodeUisFromGraph() {
        const rawNodeIds = this.graph?.getNodeIds?.() || [];
        const nodeIds = rawNodeIds
            .map((nodeId) => normalizeNodeId(nodeId))
            .filter((nodeId): nodeId is NodeId => typeof nodeId === 'string');
        const seen = new Set<NodeId>();
        this.nodeOrderList = [];

        // Repaint the panel for a lazily loaded resource: a node icon image arriving, or a
        // control renderer (the icon control's webfont) asking for a redraw.
        const requestRepaint = () => {
            if (this._isVisible) {
                this.renderPanel();
            } else {
                this._pendingRenderOnShow = true;
            }
        };

        nodeIds.forEach((nodeId) => {
            if (nodeId === undefined || nodeId === null) {
                return;
            }
            const existing = this.nodeUiMap.get(nodeId);
            if (existing) {
                existing.setSelected(nodeId === this.selectedNodeId);
                // Only update graph if it changed
                if (existing.graph !== this.graph || existing.nodeId !== nodeId) {
                    existing.setGraph(this.graph, nodeId);
                }
            } else {
                const nodeUi = new NodeUi(this.graph, nodeId, {
                    selected: nodeId === this.selectedNodeId,
                    canvasToScreen: this.canvasToScreen.bind(this),
                    screenToCanvas: this.screenToCanvas.bind(this),
                    i18nService: this._i18nService,
                    workspace: this.workspace,
                    resolveDeviceTarget: () => {
                        const targetId = this.collection?.getTargetId?.() || null;
                        if (!targetId) {
                            return null;
                        }
                        const runtime = this._getCollectionRuntime();
                        return runtime?.getDeviceTarget?.(targetId) || null;
                    },
                    onIconLoad: () => {
                        // Re-render panel when any icon finishes loading
                        requestRepaint();
                    },
                    onRepaintRequest: () => {
                        // A control painted something new (e.g. the MDI glyph webfont arrived)
                        requestRepaint();
                    },
                } as any);
                this.nodeUiMap.set(nodeId, nodeUi);
            }
            this.nodeOrderList.push(nodeId);
            seen.add(nodeId);
        });

        // Drop UIs for nodes that no longer exist.
        for (const [nodeId] of this.nodeUiMap) {
            if (!seen.has(nodeId)) {
                this.nodeUiMap.delete(nodeId);
            }
        }

        return nodeIds;
    }

    /**
     * Convert canvas/world coordinates to screen coordinates.
     * @param {{x:number,y:number}} canvasPoint - Point in canvas/world space.
     * @returns {{x:number,y:number}} Point in screen space.
     */
    canvasToScreen(canvasPoint) {
        if (!this.canvas) {
            return { x: canvasPoint.x, y: canvasPoint.y };
        }
        const rect = this.canvas.getBoundingClientRect();
        // First convert world to canvas screen using worldToScreen
        const canvasScreenPoint = this.worldToScreen(canvasPoint);
        // Then add canvas position to get absolute screen position
        return {
            x: canvasScreenPoint.x + rect.left,
            y: canvasScreenPoint.y + rect.top,
        };
    }

    /**
     * Convert screen coordinates to canvas/world coordinates.
     * @param {{x:number,y:number}} screenPoint - Point in screen space.
     * @returns {{x:number,y:number}} Point in canvas/world space.
     */
    screenToCanvas(screenPoint) {
        if (!this.canvas) {
            return { x: screenPoint.x, y: screenPoint.y };
        }
        const rect = this.canvas.getBoundingClientRect();
        // First convert absolute screen to canvas screen
        const canvasScreenPoint = {
            x: screenPoint.x - rect.left,
            y: screenPoint.y - rect.top,
        };
        // Then convert canvas screen to world using screenToWorld
        return this.screenToWorld(canvasScreenPoint);
    }

    // REMOVED: registerGraphListener() and unregisterGraphListener()
    // These were duplicates of _subscribeToGraphChanges().
    // All graph change subscriptions now use _subscribeToGraphChanges() and
    // cleanup via _graphChangeUnsubscribe in beforeDetach().

    /**
     * LEGACY METHOD - No longer needed, ViewBase handles ResizeObserver automatically.
     * Kept as no-op stub for compatibility if called externally.
     * @deprecated ViewBase._setupResizeObserver() handles resize detection
     */
    registerResizeHandlers() {
        // No-op: ViewBase handles this automatically via _setupResizeObserver()
    }

    /**
     * Register visibility observation on the container to avoid rendering hidden panels.
     */
    registerVisibilityHandler() {
        if (!this.container) {
            this.applyVisibilityState(false, { force: true });
            return;
        }
        if (typeof IntersectionObserver === 'undefined') {
            this.applyVisibilityState(this.isContainerVisible(), { force: true });
            return;
        }
        if (this._visibilityObserver) {
            try {
                this._visibilityObserver.disconnect();
            } catch {
                // ignore
            }
        }
        this._visibilityObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.target !== this.container) {
                        return;
                    }
                    const visible = entry.isIntersecting && entry.intersectionRatio > 0;
                    this.applyVisibilityState(visible);
                });
            },
            {
                root:
                    this.container.parentNode instanceof Element ? this.container.parentNode : null,
                threshold: [0, 0.01, 0.1, 0.25, 0.5, 0.75, 1],
            }
        );
        this._visibilityObserver.observe(this.container);
        this.applyVisibilityState(this.isContainerVisible(), { force: true });
    }

    /**
     * LEGACY METHOD - No longer needed, ViewBase cleans up ResizeObserver automatically.
     * Kept as no-op stub for compatibility if called externally.
     * @deprecated ViewBase disconnects observer in beforeDetach()
     */
    unregisterResizeHandlers() {
        // No-op: ViewBase handles cleanup automatically in beforeDetach()
    }

    /**
     * Resize canvases and trigger a render after the container or window size changes.
     */
    handleWindowResize() {
        // Skip expensive work if hidden; mark render for when we become visible again.
        if (!this._isVisible) {
            this._pendingRenderOnShow = true;
            return;
        }
        this.resizeCanvas();
        this.renderPanel();
    }

    /**
     * Compute Euclidean distance between two points.
     * @param {{x:number,y:number}} p1 - First point.
     * @param {{x:number,y:number}} p2 - Second point.
     * @returns {number} Distance in world units.
     */
    /**
     * Hit-test connectors at a world position and return the closest match.
     * @param {{x:number,y:number}} posWorld - World position to test.
     * @returns {{nodeId:number,kind:'input'|'output',index:number,pos:{x:number,y:number}}|null}
     */
    hitTestConnector(posWorld) {
        if (!this.graph) return null;
        const orderedIds = orderNodeIdsForHitTesting(this.nodeOrderList, this.activeNodeId);
        for (const nodeId of orderedIds) {
            const nodeUi = this.nodeUiMap.get(nodeId);
            if (!nodeUi) continue;
            const hit = nodeUi.hitTestConnector(posWorld);
            if (!hit) continue;
            const result = {
                nodeId: nodeId,
                kind: hit.type,
                type: hit.type,
                index: hit.index,
                pos: { x: hit.x, y: hit.y },
                id: hit.id,
            };
            return result;
        }
        return null;
    }

    _pointToSegmentDistance(point, segmentStart, segmentEnd) {
        const dx = segmentEnd.x - segmentStart.x;
        const dy = segmentEnd.y - segmentStart.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared <= 0) {
            return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
        }

        const t = Math.max(
            0,
            Math.min(
                1,
                ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared
            )
        );
        const projected = {
            x: segmentStart.x + t * dx,
            y: segmentStart.y + t * dy,
        };

        return Math.hypot(point.x - projected.x, point.y - projected.y);
    }

    _evaluateBezierPoint(t, start, control1, control2, end) {
        const oneMinusT = 1 - t;
        const oneMinusTSquared = oneMinusT * oneMinusT;
        const tSquared = t * t;

        return {
            x:
                oneMinusTSquared * oneMinusT * start.x +
                3 * oneMinusTSquared * t * control1.x +
                3 * oneMinusT * tSquared * control2.x +
                tSquared * t * end.x,
            y:
                oneMinusTSquared * oneMinusT * start.y +
                3 * oneMinusTSquared * t * control1.y +
                3 * oneMinusT * tSquared * control2.y +
                tSquared * t * end.y,
        };
    }

    _distanceToConnectionCurve(posWorld, fromConnector, toConnector) {
        const fromXExtended = fromConnector.x + (this.constants.CONNECTOR_RADIUS as number);
        const toXExtended = toConnector.x + 4;
        const cpOffset = getConnectionControlOffset(fromXExtended, toConnector.x);

        const start = { x: fromXExtended, y: fromConnector.y };
        const control1 = { x: fromXExtended + cpOffset, y: fromConnector.y };
        const control2 = { x: toConnector.x - cpOffset, y: toConnector.y };
        const end = { x: toXExtended, y: toConnector.y };

        const sampleCount = 24;
        let minDistance = Number.POSITIVE_INFINITY;
        let previous = start;

        for (let index = 1; index <= sampleCount; index += 1) {
            const t = index / sampleCount;
            const current = this._evaluateBezierPoint(t, start, control1, control2, end);
            const distance = this._pointToSegmentDistance(posWorld, previous, current);
            if (distance < minDistance) {
                minDistance = distance;
            }
            previous = current;
        }

        return minDistance;
    }

    hitTestConnection(posWorld, hitThresholdWorld = 12) {
        if (!this.graph || typeof this.graph.getConnections !== 'function') {
            return null;
        }

        let bestDistance = Number.POSITIVE_INFINITY;
        let bestConnection = null;

        const connections = this.graph.getConnections() || [];
        for (const connection of connections) {
            const fromUi = this.nodeUiMap.get(connection.fromNode);
            const toUi = this.nodeUiMap.get(connection.toNode);
            if (!fromUi || !toUi) {
                continue;
            }

            const fromConnector = fromUi.getConnectorPosition('output', connection.fromIndex);
            const toConnector = toUi.getConnectorPosition('input', connection.toIndex);
            if (!fromConnector || !toConnector) {
                continue;
            }

            const distance = this._distanceToConnectionCurve(posWorld, fromConnector, toConnector);
            if (distance <= hitThresholdWorld && distance < bestDistance) {
                bestDistance = distance;
                bestConnection = connection;
            }
        }

        return bestConnection;
    }

    /**
     * Hit-test nodes at a world position.
     * @param {{x:number,y:number}} posWorld - World position to test.
     * @returns {object|null} The hit node or null.
     */
    hitTestNode(posWorld) {
        if (!this.graph) return null;
        const orderedIds = orderNodeIdsForHitTesting(this.nodeOrderList, this.activeNodeId);
        for (const nodeId of orderedIds) {
            const nodeUi = this.nodeUiMap.get(nodeId);
            if (nodeUi && nodeUi.hitTestNode(posWorld)) {
                return nodeUi.getNodeData();
            }
        }
        return null;
    }

    hitTestResizeHandle(posWorld) {
        if (!this.graph) return null;
        const orderedIds = orderNodeIdsForHitTesting(this.nodeOrderList, this.activeNodeId);
        for (const nodeId of orderedIds) {
            const nodeUi = this.nodeUiMap.get(nodeId);
            const handleHit = nodeUi?.hitTestResizeHandle?.(posWorld);
            if (handleHit) {
                return {
                    nodeId,
                    edge: handleHit.edge,
                };
            }
        }
        return null;
    }

    /**
     * Get the current canvas dimensions in screen pixels.
     * @returns {{width:number,height:number}}
     */
    getCanvasSizeScreen() {
        return {
            width: this.canvas?.width || 0,
            height: this.canvas?.height || 0,
        };
    }

    /**
     * Get the current canvas client dimensions in screen pixels.
     * @returns {{width:number,height:number}}
     */
    getCanvasClientSizeScreen() {
        return {
            width: this.canvas?.clientWidth || 0,
            height: this.canvas?.clientHeight || 0,
        };
    }

    /**
     * Compute the world-space bounds that correspond to the visible canvas area.
     * @returns {{x:number,y:number,width:number,height:number}}
     */
    getCanvasBoundsWorld() {
        const canvasSize = this.getCanvasSizeScreen();
        return this.viewportModule.getCanvasBoundsWorld(canvasSize);
    }

    /**
     * Clamp a position to stay within the grid bounds.
     * @param {number} x - Desired x coordinate.
     * @param {number} y - Desired y coordinate.
     * @param {number} [width=0] - Width to keep inside bounds.
     * @param {number} [height=0] - Height to keep inside bounds.
     * @returns {{x:number,y:number}} Clamped position.
     */
    clampToGrid(x, y, width = 0, height = 0) {
        return this.viewportModule.clampToGrid(x, y, width, height);
    }

    /**
     * Resolve a node position for placement, snapping to the grid when snapping is
     * enabled and otherwise only clamping to the grid bounds.
     * @param {number} x - Desired x coordinate.
     * @param {number} y - Desired y coordinate.
     * @param {number} [width=0] - Node width to keep inside bounds.
     * @param {number} [height=0] - Node height to keep inside bounds.
     * @returns {{x:number,y:number}} Resolved position.
     * @private
     */
    _resolveNodePlacement(x, y, width = 0, height = 0) {
        return this.gridEnabled
            ? this.viewportModule.snapToGrid(x, y, width, height)
            : this.viewportModule.clampToGrid(x, y, width, height);
    }

    /**
     * Resolve the world position of a palette drop.
     *
     * Every drop path (runtime node types and graph items) uses this helper, so a
     * dropped node lands under the cursor with the same snapping and clamping.
     * @param {DragEvent} event - Drop event carrying the cursor position.
     * @param {number} width - Width of the node that will be placed.
     * @param {number} [height=100] - Height estimate of the node that will be placed.
     * @returns {{x:number,y:number}} Resolved top-left position.
     * @private
     */
    _resolveNodeDropPosition(event, width, height = 100) {
        const posWorld = this.screenToWorld(this.getCanvasPosScreenFromEvent(event));
        return this._resolveNodePlacement(posWorld.x, posWorld.y, width, height);
    }

    /**
     * Set the cursor style on the canvas.
     * @param {string} value - CSS cursor value.
     */
    setCursor(value) {
        if (!this.canvas) return;
        this.canvas.style.cursor = value;
    }

    /**
     * Add and track a DOM event listener for later cleanup.
     * @param {EventTarget} target - Event target.
     * @param {string} type - Event type.
     * @param {Function} handler - Listener callback.
     * @param {AddEventListenerOptions|boolean} [options] - Listener options.
     */
    addDomListener(target, type, handler, options = undefined) {
        if (!target || !type || !handler) {
            return;
        }
        target.addEventListener(type, handler, options);
        this.boundHandlers.push({ target, type, handler, options });
    }

    /**
     * Handle mouse down events for selection, node drag, connection drag, or panning.
     * @param {MouseEvent} event - Mouse event.
     */
    handleMouseDown(event) {
        const historyManager = this.collection?.getHistoryManager?.() || null;

        const context = {
            attachDocumentDragListeners: () => this.#attachDocumentDragListeners(),
            hitTestDocumentationArea: (posWorld) => this._hitTestDocumentationArea(posWorld),
            onDocumentationAreaMouseDown: (hit, evt) =>
                this._handleDocumentationAreaMouseDown(hit, evt),
            onDocumentationAreaDoubleClick: (hit) => this._editDocumentationArea(hit.areaId),
            onDocumentationAreaActivate: (areaId) => this.setActiveDocumentationArea(areaId),
            showContextMenu: (type, evt) => {
                if (type === 'node') {
                    this._showNodeContextMenu(evt);
                } else if (type === 'documentation-area') {
                    this._showDocumentationAreaMenu?.(this.activeDocumentationAreaId, new DOMRect(
                        evt.clientX,
                        evt.clientY,
                        0,
                        0
                    ));
                } else {
                    this._showCanvasContextMenu(evt);
                }
            },
            selectSingleNode: (nodeId) => this._selectSingleNode(nodeId),
            toggleSelection: (nodeId) => this._toggleSelection(nodeId),
            addToSelection: (nodeId) => this._addToSelection(nodeId),
            setActiveNode: (nodeId) => {
                this.activeNodeId = normalizeNodeId(nodeId);
                // A node press deactivates any activated documentation area.
                this.setActiveDocumentationArea(null);
            },
            setSelectedNodeId: (nodeId) => {
                this.selectedNodeId = nodeId;
                this.onSelect(nodeId);
            },
            beginHistoryGroup: (description) => historyManager?.beginGroup?.(description),
            endHistoryGroup: () => historyManager?.endGroup?.(),
            canvas: this.canvas,
        };

        this.interactionModule.handleMouseDown(event, context);
    }

    /**
     * Handle mouse move events for panning, node dragging, connection dragging, or hover updates.
     * @param {MouseEvent} event - Mouse event.
     */
    handleMouseMove(event) {
        const historyManager = this.collection?.getHistoryManager?.() || null;
        const context = {
            updateClipboard: (evt) => this.clipboard.updateLastPointerPosition(evt),
            onDocumentationAreaPointerMove: (posWorld) =>
                this._handleDocumentationAreaPointerMove(posWorld),
            canvasSize: this.getCanvasSizeScreen(),
            canvasClientSize: this.getCanvasClientSizeScreen(),
            gridEnabled: this.gridEnabled,
            beginHistoryGroup: (description) => historyManager?.beginGroup?.(description),
            endHistoryGroup: () => historyManager?.endGroup?.(),
            duplicateNodesForDrag: (nodeIds) => this._duplicateNodesForDrag(nodeIds),
            setSelectionNodeIds: (nodeIds, description) =>
                this._setSelectionNodeIds(nodeIds, description || 'Selection changed'),
        };

        this.interactionModule.handleMouseMove(event, context);
        this._updateCapabilityTooltip(event);
    }

    /**
     * Handle mouse up events to end drags and reset cursors.
     */
    handleMouseUp() {
        const historyManager = this.collection?.getHistoryManager?.() || null;

        const context = {
            onDocumentationAreaPointerUp: () => this._handleDocumentationAreaPointerUp(),
            updateSelection: () => this._updateSelection(),
            log: (event, data) => this._log(event, data),
            detachDocumentDragListeners: () => this.#detachDocumentDragListeners(),
            emit: (event, data) => {
                if (event === 'nodes-moved') {
                    const nodeIds = Array.isArray(data?.nodeIds) ? [...data.nodeIds] : null;
                    if (!nodeIds) {
                        throw new TypeError(
                            'GraphPanelView.handleMouseUp expected nodes-moved payload with nodeIds array'
                        );
                    }
                    this._emit('nodes-moved', new GraphPanelViewNodesMovedPayload({ nodeIds }));
                    return;
                }

                throw new TypeError(
                    `GraphPanelView.handleMouseUp received unsupported interaction emit event: ${event}`
                );
            },
            setSelectionNodeIds: (nodeIds, description) =>
                this._setSelectionNodeIds(nodeIds, description || 'Selection changed'),
            clearSelection: () => {
                this._clearSelection();
                // Clicking empty canvas also clears the activated area.
                this.setActiveDocumentationArea(null);
            },
            toggleSelection: (nodeId) => this._toggleSelection(nodeId),
            beginHistoryGroup: (description) => historyManager?.beginGroup?.(description),
            endHistoryGroup: () => historyManager?.endGroup?.(),
        };

        this.interactionModule.handleMouseUp(context);
    }

    /**
     * Handle mouse leaving the canvas by clearing hover state.
     * Note: We don't clear dragging state here anymore since document listeners
     * allow dragging to continue outside the canvas.
     */
    handleMouseLeave() {
        this.interactionModule.handleMouseLeave();
        this.documentationLayer?.setHoveredArea(null);
        this._hideCapabilityTooltip();
    }

    setInteractionQualityMode(active) {
        const nextMode = active ? 'interaction' : 'full';
        if (this.renderQualityMode === nextMode) {
            return;
        }

        this.renderQualityMode = nextMode;
        this.renderPanel();
    }

    /**
     * Handle keyboard input for node operations.
     * @param {KeyboardEvent} e - Keyboard event.
     */
    /**
     * Handle keyboard input for node operations (Phase 4.5.3).
     * @param {KeyboardEvent} e - Keyboard event.
     */
    handleKeyDown(e) {
        if (!this._isVisible) {
            return;
        }

        const historyManager = this.collection?.getHistoryManager?.() || null;

        const context = {
            onDocumentationAreaKeyDown: (event) => this._handleDocumentationAreaKeyDown(event),
            hasActiveDocumentationArea: () => Boolean(this.activeDocumentationAreaId),
            showNodeInfo: (nodeId) => this._showNodeInfo(nodeId),
            selectedNodeId: this.selectedNodeId,
            selectAll: () => this._selectAll(),
            copySelected: () => this._copySelected(),
            cutSelected: () => this._cutSelected(),
            getLastPointerWorldPosition: () =>
                (this.clipboard as any)._getLastPointerWorldPosition(this.canvas),
            pasteAt: (pos) => this._pasteAt(pos),
            pasteAtCenter: () => this._pasteAtCenter(),
            duplicateSelected: () => this._duplicateSelected(),
            deleteSelected: () => this._deleteSelected(),
            resizeSelectedNodeWidth: (delta) => this._resizeSelectedNodeWidths(delta),
            beginHistoryGroup: (description) => historyManager?.beginGroup?.(description),
            endHistoryGroup: () => historyManager?.endGroup?.(),
        };

        this.interactionModule.handleKeyDown(e, context);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Node Operations (Phase 4.5.3 - Clipboard & Multi-Selection)
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Copy selected nodes to clipboard.
     * @private
     */
    _copySelected() {
        const success = this.clipboard.copySelected();

        if (success) {
            const nodeIds = this.selection.getSelectedNodeIds();
            this._log('nodes-copied', { nodeIds, count: nodeIds.length });
            // Future: Show toast notification
        }
    }

    /**
     * Cut selected nodes: copy them to the clipboard and remove them from the graph.
     *
     * The node IDs are captured before the cut because the removal clears the selection.
     * @private
     */
    _cutSelected() {
        const nodeIds = this.selection.getSelectedNodeIds();
        const success = this.clipboard.cutSelected();

        if (success) {
            this._log('nodes-cut', { nodeIds, count: nodeIds.length });
        }
    }

    /**
     * Paste nodes from clipboard at center of viewport.
     * @private
     */
    _pasteAtCenter() {
        const canvasSize = this.canvas
            ? {
                  width: this.canvas.width,
                  height: this.canvas.height,
              }
            : null;

        if (!canvasSize) {
            return;
        }

        const historyManager = this.collection?.getHistoryManager?.() || null;
        historyManager?.beginGroup?.('Paste nodes');
        let newNodeIds = [];
        try {
            newNodeIds = this.clipboard.pasteAtCenter(canvasSize);
        } finally {
            historyManager?.endGroup?.();
        }

        if (newNodeIds.length > 0) {
            this._log('nodes-pasted', { count: newNodeIds.length, nodeIds: newNodeIds });

            // Select the pasted nodes
            this._setSelectionNodeIds(newNodeIds, 'Select pasted nodes');
        }
        this._activatePastedDocumentationAreas?.();
    }

    /**
     * Paste nodes at a provided world position.
     * @private
     * @param {{x:number,y:number}} worldPos
     */
    _pasteAt(worldPos) {
        const historyManager = this.collection?.getHistoryManager?.() || null;
        historyManager?.beginGroup?.('Paste nodes');
        let newNodeIds = [];
        try {
            newNodeIds = this.clipboard.pasteAt(worldPos);
        } finally {
            historyManager?.endGroup?.();
        }

        if (newNodeIds.length > 0) {
            this._log('nodes-pasted', { count: newNodeIds.length, nodeIds: newNodeIds });

            this._setSelectionNodeIds(newNodeIds, 'Select pasted nodes');
        }
        this._activatePastedDocumentationAreas?.();
    }

    /**
     * Activate the documentation area created by the most recent paste, if any.
     * @private
     */
    _activatePastedDocumentationAreas() {
        const pastedAreaIds = this.clipboard.getLastPastedAreaIds?.() ?? [];
        if (pastedAreaIds.length === 0) {
            return;
        }
        this._log('documentation-areas-pasted', { areaIds: pastedAreaIds });
        this.setActiveDocumentationArea(pastedAreaIds[pastedAreaIds.length - 1]);
    }

    /**
     * Duplicate selected nodes.
     * @private
     */
    _duplicateSelected() {
        const historyManager = this.collection?.getHistoryManager?.() || null;
        historyManager?.beginGroup?.('Duplicate nodes');
        let newNodeIds = [];
        try {
            newNodeIds = this.clipboard.duplicateSelected(this.canvas);
        } finally {
            historyManager?.endGroup?.();
        }

        if (newNodeIds.length > 0) {
            const originalIds = this.selection.getSelectedNodeIds();
            this._log('nodes-duplicated', {
                originalIds,
                newIds: newNodeIds,
                count: newNodeIds.length,
            });

            // Select the duplicated nodes
            this._setSelectionNodeIds(newNodeIds, 'Select duplicated nodes');
        }
    }

    /**
     * Duplicate nodes at their current positions for a Ctrl+Drag copy gesture. The copies
     * start exactly underneath the originals so the pointer keeps its grab offset while the
     * drag moves the copy away.
     * @param {string[]} nodeIds - Node IDs to copy.
     * @returns {{originalNodeIds: string[], newNodeIds: string[]}|null} Copy result in the
     * same order as the provided node IDs, or null when nothing could be copied.
     * @private
     */
    _duplicateNodesForDrag(nodeIds) {
        const normalizedNodeIds = Array.isArray(nodeIds)
            ? nodeIds.map((nodeId) => normalizeNodeId(nodeId)).filter((nodeId) => nodeId !== null)
            : [];

        if (normalizedNodeIds.length === 0) {
            return null;
        }

        let newNodeIds = [];
        try {
            newNodeIds = this.clipboard.duplicateNodesAtOriginalPositions(normalizedNodeIds);
        } catch (error) {
            this._log('nodes-copy-for-drag-failed', {
                nodeIds: normalizedNodeIds,
                error: error instanceof Error ? error.message : String(error),
            });
            newNodeIds = [];
        }

        if (
            !Array.isArray(newNodeIds) ||
            newNodeIds.length !== normalizedNodeIds.length ||
            newNodeIds.length === 0
        ) {
            return null;
        }

        this._log('nodes-copied-for-drag', {
            originalIds: normalizedNodeIds,
            newIds: newNodeIds,
            count: newNodeIds.length,
        });

        return { originalNodeIds: normalizedNodeIds, newNodeIds };
    }

    /**
     * Ensure the provided nodes are fully inside the grid bounds.
     * If a node extends beyond the grid, clamp its position and update the graph.
     * @param {string[]} nodeIds
     * @private
     */
    _ensureNodesInsideGrid(nodeIds) {
        if (!this.graph || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return;
        }

        nodeIds.forEach((nodeId) => {
            const normalizedNodeId = normalizeNodeId(nodeId);
            if (!normalizedNodeId) {
                return;
            }

            const node = this.graph.getNode?.(normalizedNodeId);
            if (!node) {
                return;
            }

            const nodeWidth = Number(node.width) || 0;
            const nodeHeight = Number(node.height) || 0;
            const currentX = Number(node.x) || 0;
            const currentY = Number(node.y) || 0;

            // Clamp position so the entire node stays inside the grid (snap when enabled).
            const resolved = this._resolveNodePlacement(currentX, currentY, nodeWidth, nodeHeight);

            if (resolved.x !== currentX || resolved.y !== currentY) {
                if (typeof this.graph.updateNode === 'function') {
                    this.graph.updateNode(normalizedNodeId, { x: resolved.x, y: resolved.y });
                } else {
                    node.x = resolved.x;
                    node.y = resolved.y;
                }
            }
        });
    }

    /**
     * Align all nodes to the grid in a single undo step.
     *
     * Uses the viewport's snap helper directly (not `_resolveNodePlacement()`) so
     * the action also snaps when the grid overlay is hidden. Nodes that are
     * already aligned are skipped, and an empty result is a silent no-op.
     */
    _alignNodesToGrid() {
        const graph = this.graph;
        if (!graph?.getNodeIds || !graph?.getNode || !graph?.updateNode) {
            return;
        }

        const snap =
            typeof this.viewportModule?.snapToGrid === 'function'
                ? (x, y, w, h) => this.viewportModule.snapToGrid(x, y, w, h)
                : (x, y, w, h) => this._resolveNodePlacement(x, y, w, h);

        const moves = [];
        for (const nodeId of graph.getNodeIds()) {
            const node = graph.getNode(nodeId);
            if (!node) {
                continue;
            }
            const placement = snap(node.x ?? 0, node.y ?? 0, node.width ?? 0, node.height ?? 0);
            if (!placement) {
                continue;
            }
            if (placement.x === node.x && placement.y === node.y) {
                continue;
            }
            moves.push({ nodeId, x: placement.x, y: placement.y });
        }

        if (moves.length === 0) {
            return;
        }

        const historyManager = this.collection?.getHistoryManager?.() || null;
        historyManager?.beginGroup?.(this.t('graph.toolbar.alignToGridUndo'));
        try {
            for (const move of moves) {
                graph.startNodeDrag?.(move.nodeId);
                graph.updateNode(move.nodeId, { x: move.x, y: move.y });
                graph.endNodeDrag?.(move.nodeId);
            }
        } finally {
            historyManager?.endGroup?.();
        }

        this.renderPanel();
    }

    /**
     * Remove nodes from the active graph as one undoable history group.
     *
     * Shared by Delete and Cut so both actions clear the selection first and record the
     * same reversible node-removal operations. Callers log the user-facing action.
     *
     * @param {string[]} nodeIds - Node IDs to remove.
     * @param {string} description - History group description (for example "Cut node").
     * @returns {number} Number of nodes that were actually removed.
     * @private
     */
    _removeNodes(nodeIds, description) {
        const historyManager = this.collection?.getHistoryManager?.() || null;
        historyManager?.beginGroup?.(description);

        try {
            // Clear selection first so the panel does not render IDs that are about to disappear.
            this._clearSelection();

            let removedCount = 0;
            nodeIds.forEach((nodeId) => {
                historyManager?.beforeNodeRemove?.(nodeId);
                if (this.graph.removeNode(nodeId)) {
                    removedCount++;
                }
            });

            return removedCount;
        } finally {
            historyManager?.endGroup?.();
        }
    }

    /**
     * Delete selected nodes.
     * @private
     */
    _deleteSelected() {
        if (this.selection.selectedNodes.size === 0) {
            return;
        }

        const nodeIds = this.selection.getSelectedNodeIds();
        const removedCount = this._removeNodes(
            nodeIds,
            nodeIds.length > 1 ? 'Delete nodes' : 'Delete node'
        );

        if (removedCount > 0) {
            this._log('nodes-deleted', { nodeIds, count: removedCount });
        }
    }

    /**
     * Select all nodes in the graph.
     * @private
     */
    _selectAll() {
        if (!this.graph) {
            return;
        }

        const allNodeIds = (this.graph.nodes || [])
            .map((node) => normalizeNodeId(node?.id))
            .filter((nodeId): nodeId is NodeId => typeof nodeId === 'string');
        this._setSelectionNodeIds(allNodeIds, 'Select all nodes');
        this._log('select-all', { count: this.selection.getSelectionCount() });
    }

    /**
     * Select a single node (clears other selections).
     * @param {string} nodeId - Node ID to select
     * @private
     */
    _selectSingleNode(nodeId) {
        const normalizedNodeId = normalizeNodeId(nodeId);
        this._setSelectionNodeIds(normalizedNodeId ? [normalizedNodeId] : [], 'Select node');
    }

    /**
     * Add a node to the current selection.
     * @param {string} nodeId - Node ID to add
     * @private
     */
    _addToSelection(nodeId) {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (!normalizedNodeId) {
            return;
        }

        const nextSelection = this.selection.getSelectedNodeIds();
        if (!nextSelection.includes(normalizedNodeId)) {
            nextSelection.push(normalizedNodeId);
        }

        this._setSelectionNodeIds(nextSelection, 'Add node to selection');
    }

    /**
     * Toggle a node in the selection.
     * @param {string} nodeId - Node ID to toggle
     * @private
     */
    _toggleSelection(nodeId) {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (!normalizedNodeId) {
            return;
        }

        const nextSelectionSet = new Set(this.selection.getSelectedNodeIds());
        if (nextSelectionSet.has(normalizedNodeId)) {
            nextSelectionSet.delete(normalizedNodeId);
        } else {
            nextSelectionSet.add(normalizedNodeId);
        }

        this._setSelectionNodeIds(Array.from(nextSelectionSet), 'Toggle node selection');
    }

    /**
     * Clear all selected nodes.
     * @private
     */
    _clearSelection() {
        this._setSelectionNodeIds([], 'Clear selection');
    }

    _setSelectionNodeIds(nodeIds, description = 'Selection changed') {
        const previousSelection = this.selection.getSelectedNodeIds();

        this.selection.clearSelection();
        if (Array.isArray(nodeIds)) {
            nodeIds.forEach((nodeId) => {
                const normalizedNodeId = normalizeNodeId(nodeId);
                if (normalizedNodeId) {
                    this.selection.selectedNodes.add(normalizedNodeId);
                }
            });
        }

        const nextSelection = this.selection.getSelectedNodeIds();

        // Keep the current active node if it is still selected, otherwise fall back to the
        // last selected node so the active node always reflects the most recent interaction.
        const previousActiveId = normalizeNodeId(this.activeNodeId);
        this.activeNodeId =
            previousActiveId && nextSelection.includes(previousActiveId)
                ? previousActiveId
                : nextSelection.length > 0
                  ? nextSelection[nextSelection.length - 1]
                  : null;

        if (!this._isApplyingSelectionHistory) {
            const historyManager = this.collection?.getHistoryManager?.() || null;
            historyManager?.recordSelectionChange?.(previousSelection, nextSelection, description);
        }

        this._updateSelection();
    }

    _applySelectionHistoryState(nodeIds) {
        this._isApplyingSelectionHistory = true;
        try {
            this._setSelectionNodeIds(nodeIds, 'Restore selection from history');
        } finally {
            this._isApplyingSelectionHistory = false;
        }
    }

    /**
     * Update selection visual feedback and notify callbacks.
     * @private
     */
    _updateSelection() {
        // Trigger re-render to update visual selection
        this.renderPanel();

        // Emit selection change event
        this._emit(
            'selection-changed',
            new GraphPanelViewSelectionChangedPayload({
                selectedNodes: this.selection.getSelectedNodeIds(),
                count: this.selection.getSelectionCount(),
            })
        );
    }

    /**
     * Get all nodes within the current selection box.
     * @returns {string[]} Array of node IDs within the box
     * @private
     */
    _getNodesInSelectionBox() {
        return (this.selection as any)._getNodesInSelectionBox(this.nodeUiMap as any);
    }

    /**
     * Render the selection box during box selection.
     * Phase 5: Delegates to GraphPanelRendering module
     * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
     * @private
     */
    _renderSelectionBox(ctx) {
        this.rendering.drawSelectionBox(ctx, this.selection.selectionBox);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // Context Menu Integration (Phase 4.5.3)
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Show context menu for selected nodes.
     * @param {MouseEvent} event - Right-click event
     * @private
     */
    _showNodeContextMenu(event) {
        if (this.selection.selectedNodes.size === 0) {
            return;
        }

        event.preventDefault();

        // Multi-selection aware labels
        const selectedCount = this.selection.selectedNodes.size;
        const isMultiple = selectedCount > 1;

        // Build menu items
        const items = [
            {
                id: 'copy',
                label: isMultiple ? `Copy ${selectedCount} nodes` : 'Copy',
                icon: IconProvider.contentCopy,
                shortcut: 'Ctrl+C',
            },
            {
                id: 'cut',
                label: isMultiple ? `Cut ${selectedCount} nodes` : 'Cut',
                icon: IconProvider.contentCut,
                shortcut: 'Ctrl+X',
            },
            {
                id: 'paste',
                label: 'Paste',
                icon: IconProvider.contentPaste,
                shortcut: 'Ctrl+V',
                disabled: !this.clipboardManager.hasData(),
            },
            {
                id: 'duplicate',
                label: isMultiple ? `Duplicate ${selectedCount} nodes` : 'Duplicate',
                icon: IconProvider.fileCopy,
                shortcut: 'Ctrl+D',
            },
            { type: 'separator' },
            {
                id: 'delete',
                label: isMultiple ? `Delete ${selectedCount} nodes` : 'Delete',
                icon: IconProvider.delete,
                shortcut: 'Del',
            },
            { type: 'separator' },
            {
                id: 'rename',
                label: 'Rename',
                icon: IconProvider.edit,
                disabled: isMultiple, // Disable for multiple selection
            },
            {
                id: 'color',
                label: 'Change Color',
                icon: IconProvider.colorize,
                disabled: isMultiple, // Disable for multiple selection
            },
            {
                id: 'info',
                label: 'Show Information',
                icon: IconProvider.info,
                disabled: isMultiple, // Disable for multiple selection
            },
        ];

        // Create menu window
        const menuWindow = new MenuWindow({
            items,
            onSelect: (item) => this._handleNodeContextMenuSelect(item),
            x: event.clientX,
            y: event.clientY,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Add overlay via ViewManager
        if (this.viewManager) {
            this._activeContextMenu = this.viewManager.addOverlay(menuWindow);
        } else {
            // Fallback: attach directly (shouldn't happen in normal usage)
            const host = this.container?.ownerDocument?.body || document.body;
            menuWindow.attachTo(host);
            this._activeContextMenu = menuWindow;
        }

        // Auto-clear reference when menu closes
        menuWindow.on('close', (event) => {
            assertAppEventPayloadType(
                event,
                'OverlayWindow.Close.v1',
                'GraphPanelView.nodeContextMenuCloseListener'
            );
            this._activeContextMenu = null;
        });
    }

    /**
     * Handle node context menu item selection.
     * @param {object} item - Selected menu item
     * @private
     */
    _handleNodeContextMenuSelect(item) {
        switch (item.id) {
            case 'copy':
                this._copySelected();
                break;

            case 'cut':
                this._cutSelected();
                break;

            case 'paste':
                this._pasteAtCenter();
                break;

            case 'duplicate':
                this._duplicateSelected();
                break;

            case 'delete':
                this._deleteSelected();
                break;

            case 'rename':
                // Get first selected node for rename
                if (this.selection.selectedNodes.size === 1) {
                    const nodeId = this.selection.getSelectedNodeIds()[0];
                    this._showNodeRename(nodeId);
                }
                break;

            case 'color':
                // Get first selected node for color picker
                if (this.selection.selectedNodes.size === 1) {
                    const nodeId = this.selection.getSelectedNodeIds()[0];
                    this._showColorPicker(nodeId);
                }
                break;

            case 'info':
                // Get first selected node for info dialog
                if (this.selection.selectedNodes.size === 1) {
                    const nodeId = this.selection.getSelectedNodeIds()[0];
                    this._showNodeInfo(nodeId);
                }
                break;
        }
    }

    /**
     * Show canvas context menu (right-click on empty area).
     * @param {MouseEvent} event - Right-click event
     * @private
     */
    _showCanvasContextMenu(event) {
        event.preventDefault();

        const items = [
            {
                id: 'paste',
                label: 'Paste',
                icon: IconProvider.contentPaste,
                shortcut: 'Ctrl+V',
                disabled: !this.clipboardManager.hasData(),
            },
            { type: 'separator' },
            {
                id: 'selectAll',
                label: 'Select All',
                icon: IconProvider.selectAll,
                shortcut: 'Ctrl+A',
            },
            { type: 'separator' },
            {
                id: 'gridSnap',
                label: 'Grid Snap',
                checked: this.gridEnabled,
            },
            {
                id: 'showGrid',
                label: 'Show Grid',
                checked: this.showGrid,
            },
        ];

        // Create menu window
        const menuWindow = new MenuWindow({
            items,
            onSelect: (item) => this._handleCanvasContextMenuSelect(item, event),
            x: event.clientX,
            y: event.clientY,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Add overlay via ViewManager
        if (this.viewManager) {
            this._activeContextMenu = this.viewManager.addOverlay(menuWindow);
        } else {
            // Fallback: attach directly (shouldn't happen in normal usage)
            const host = this.container?.ownerDocument?.body || document.body;
            menuWindow.attachTo(host);
            this._activeContextMenu = menuWindow;
        }

        // Auto-clear reference when menu closes
        menuWindow.on('close', (event) => {
            assertAppEventPayloadType(
                event,
                'OverlayWindow.Close.v1',
                'GraphPanelView.canvasContextMenuCloseListener'
            );
            this._activeContextMenu = null;
        });
    }

    /**
     * Handle canvas context menu item selection.
     * @param {object} item - Selected menu item
     * @param {MouseEvent} originalEvent - Original right-click event
     * @private
     */
    _handleCanvasContextMenuSelect(item, originalEvent) {
        switch (item.id) {
            case 'paste':
                // Paste at click position
                const posScreen = this.getCanvasPosScreenFromEvent(originalEvent);
                const clickPos = this.screenToWorld(posScreen);
                const newNodeIds = (this.clipboardManager.paste(this.graph, clickPos) || [])
                    .map((nodeId) => normalizeNodeId(nodeId))
                    .filter((nodeId): nodeId is NodeId => typeof nodeId === 'string');
                if (newNodeIds.length > 0) {
                    // Select pasted nodes
                    this._setSelectionNodeIds(newNodeIds, 'Select pasted nodes');
                }
                break;

            case 'selectAll':
                this._selectAll();
                break;

            case 'gridSnap':
                this.gridEnabled = !this.gridEnabled;
                this.renderPanel();
                this._log('grid-snap-toggled', { enabled: this.gridEnabled });
                break;

            case 'showGrid':
                this.showGrid = !this.showGrid;
                this.renderPanel();
                this._log('grid-visibility-toggled', { visible: this.showGrid });
                break;
        }
    }

    /**
     * Show info dialog for a node.
     * @param {string} nodeId - Node ID
     * @private
     */
    _showNodeInfo(nodeId) {
        const nodeData = this.graph.getNode(nodeId);
        if (!nodeData) {
            this._log('show-info-failed', { nodeId, reason: 'node not found' });
            return;
        }

        // Resolve node type identifier (NodeData uses `type`)
        const typeId = nodeData.type;

        // Get node type definition from runtime
        const runtime = this.workspace?.runtimeCollection?.getActiveRuntime();
        if (!runtime) {
            this._log('show-info-failed', { nodeId, reason: 'no runtime available' });
            return;
        }

        const nodeType = runtime.getNodeType(typeId);
        if (!nodeType) {
            this._log('show-info-failed', {
                nodeId,
                typeId,
                reason: 'node type not found',
            });
            return;
        }

        const locale = (this._i18nService as any)?.currentLocale || 'en';
        const infoContent = buildNodeInfoContent(
            nodeType as unknown as NodeInfoSource,
            locale,
            typeId
        );

        // Calculate anchor position (node position in absolute screen coordinates)
        const nodeScreenPos = this.canvasToScreen({ x: nodeData.x, y: nodeData.y });

        // Create info view
        const infoView = new NodeInfoView({
            ...infoContent,
            i18nService: this._i18nService,
            logger: this._logger,
        });

        // Show in overlay window via ViewManager
        if (!this.viewManager) {
            this._log('show-info-failed', { nodeId, reason: 'no view manager available' });
            return;
        }

        const overlayWidth = Math.max(Number.isFinite(nodeData?.width) ? nodeData.width : 140, 460);
        const overlayHeight = 380;
        const overlay = this.viewManager.addOverlay(infoView, {
            title: infoContent.nodeName || typeId,
            icon: nodeType.icon || null,
            x: nodeScreenPos.x + 150, // Position to right of node
            y: nodeScreenPos.y,
            width: overlayWidth,
            height: overlayHeight,
            minWidth: overlayWidth,
            minHeight: overlayHeight,
            resizable: false, // Fixed size
            minimizable: false, // No minimize button
            closable: true, // Show close icon
        });

        // Store reference for cleanup
        this._activeInfoOverlay = overlay;

        // Auto-close cleanup
        overlay.on('close', (event) => {
            assertAppEventPayloadType(
                event,
                'OverlayWindow.Close.v1',
                'GraphPanelView.infoOverlayCloseListener'
            );
            if (this._activeInfoOverlay === overlay) {
                this._activeInfoOverlay = null;
            }
        });

        this._log('info-overlay-shown', { nodeId, typeId });
    }

    /**
     * Show color picker for a node.
     * @param {string} nodeId - Node ID
     * @private
     */
    _showColorPicker(nodeId) {
        const nodeData = this.graph.getNode(nodeId);
        if (!nodeData) {
            this._log('show-color-picker-failed', { nodeId, reason: 'node not found' });
            return;
        }

        // For now, use browser's native color picker
        // This is a placeholder - full implementation will use ColorPickerDialogView in section 4.5.5
        const currentColor = nodeData.color || '#51607c';

        // Create a temporary input element
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = currentColor;
        colorInput.style.position = 'absolute';
        colorInput.style.left = '-9999px';
        document.body.appendChild(colorInput);

        // Show color picker
        colorInput.click();

        // Handle color selection
        colorInput.addEventListener('change', () => {
            const newColor = colorInput.value;

            // Update node color
            this.graph.updateNode(nodeId, { color: newColor });

            // Update visual
            this.renderPanel();

            this._log('node-color-changed', { nodeId, oldColor: currentColor, newColor });

            // Cleanup
            colorInput.remove();
        });

        // Cleanup if canceled
        colorInput.addEventListener('blur', () => {
            setTimeout(() => colorInput.remove(), 100);
        });
    }

    /**
     * Show the name editor for a node.
     * @param {string} nodeId - ID of the node to rename
     * @private
     */
    _showNodeRename(nodeId) {
        const nodeUi = this.nodeUiMap.get(nodeId);
        if (!nodeUi) {
            this._log('show-rename-failed', { nodeId, reason: 'nodeUi not found' });
            return;
        }

        const nodeData = this.graph.getNode(nodeId);
        if (!nodeData) {
            this._log('show-rename-failed', { nodeId, reason: 'node not found' });
            return;
        }

        // Calculate canvas point for the node's position
        const canvasPoint = { x: nodeData.x, y: nodeData.y };

        // Show the name editor
        nodeUi.showNameEditor(canvasPoint, this.canvas, this.viewport as any);

        this._log('node-rename-opened', { nodeId });
    }

    /**
     * Handle wheel events to zoom the viewport around the pointer.
     *
     * Each notch changes the scale by {@link WHEEL_ZOOM_STEP} (5 %), which keeps trackpad and
     * wheel zooming controllable while the pointer stays anchored to the same world point.
     * @param {WheelEvent} event - Wheel event.
     */
    handleWheel(event) {
        event.preventDefault();
        const zoomFactor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
        const posScreen = this.getCanvasPosScreenFromEvent(event);
        this.zoomAt(posScreen, zoomFactor);
        this.renderPanel();
    }

    /**
     * Allow copy drops over the canvas during drag operations.
     * @param {DragEvent} event - Drag over event.
     */
    handleDragOver(event) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    }

    /**
     * Handle drops from the palette to add a new node at the drop position.
     * @param {DragEvent} event - Drop event.
     */
    /**
     * Create a documentation area for a dropped `graph-item` palette entry.
     * @param {string} graphItemId - Palette entry id (`documentation-area` today).
     * @param {DragEvent} event - Drop event, used for the drop position.
     * @private
     */
    _createDocumentationAreaAtDrop(graphItemId, event) {
        if (graphItemId !== 'documentation-area' || !this.graph?.addDocumentationArea) {
            this._log('graph-item-drop-ignored', { graphItemId });
            return;
        }

        const posWorld = this.screenToWorld(this.getCanvasPosScreenFromEvent(event));
        const size = DOCUMENTATION_AREA_DEFAULT_SIZE;
        const bounds = {
            x: posWorld.x - size.width / 2,
            y: posWorld.y - size.height / 2,
            width: size.width,
            height: size.height,
        };

        const area = this.graph.addDocumentationArea({
            title: '',
            markdown: '',
            color: DOCUMENTATION_AREA_DEFAULT_COLOR,
            bounds: this.#clampDocumentationAreaBounds(bounds),
        });

        if (!area?.id) {
            return;
        }

        this._log('documentation-area-created', { areaId: area.id, bounds });
        // One history step already happened through `addDocumentationArea`; calling
        // `setDocumentationAreaBounds` afterwards would add a second operation.
        this.setActiveDocumentationArea(area.id);
        this.renderPanel();
    }

    /**
     * Place (or focus) a structural function input/output node from a palette drop.
     *
     * Only function graphs accept the drop; other graphs log a rejection. The node
     * is placed at the drop point through the same `_resolveNodeDropPosition()` path
     * as every other node drop. A graph contains at most one of each node, so a
     * second drop selects the existing node instead of adding a duplicate (D4).
     * @param {string} graphItemId - Palette entry id of the structural node.
     * @param {DragEvent} event - Drop event, used for the drop position.
     * @private
     */
    _placeFunctionStructuralNodeAtDrop(graphItemId, event) {
        const kind = graphItemId === FUNCTION_OUTPUT_GRAPH_ITEM_ID ? 'output' : 'input';

        if (normalizeExecutionType(this.graph?.getExecutionType?.()) !== 'function') {
            this._log('function-structural-node-drop-rejected', { kind });
            return;
        }

        if (typeof this.graph?.ensureFunctionStructuralNode !== 'function') {
            this._log('function-structural-node-drop-rejected', { kind });
            return;
        }

        const position = this._resolveNodeDropPosition(event, resolveNodeWidth({}));
        const { node, created } = this.graph.ensureFunctionStructuralNode(kind, position);
        this._log('function-structural-node-placed', { kind, created, position });

        if (node?.id) {
            this.selection.selectSingleNode(node.id);
        }
        this.renderPanel();
    }

    handleDrop(event) {
        event.preventDefault();

        // Get drag data in JSON format (NodeTypeUi uses application/json)
        const jsonData = event.dataTransfer.getData('application/json');
        if (!jsonData) {
            throw new Error('[GraphPanelView] No drag data found - expected application/json');
        }

        let dragData;
        try {
            dragData = JSON.parse(jsonData);
        } catch (err) {
            throw new Error(`[GraphPanelView] Failed to parse drag data: ${err.message}`);
        }

        // Graph items (documentation areas, structural function nodes) take the graph-item
        // path and never touch the runtime. The documentation-area branch stays first so its
        // behavior is unchanged.
        if (dragData.type === 'graph-item') {
            if (
                dragData.graphItemId === FUNCTION_INPUT_GRAPH_ITEM_ID ||
                dragData.graphItemId === FUNCTION_OUTPUT_GRAPH_ITEM_ID
            ) {
                this._placeFunctionStructuralNodeAtDrop(dragData.graphItemId, event);
                return;
            }
            this._createDocumentationAreaAtDrop(dragData.graphItemId, event);
            return;
        }

        const typeId = dragData.nodeTypeId;
        if (!typeId) {
            throw new Error('[GraphPanelView] No nodeTypeId found in drag data');
        }

        // A function graph cannot call itself: the palette already hides the entry, and a
        // stale drag payload is refused here (D15).
        if (
            typeof this.graph?.getFunctionNodeTypeId === 'function' &&
            typeId === this.graph.getFunctionNodeTypeId()
        ) {
            this._log('function-node-drop-self', { typeId });
            return;
        }

        const nodeType = this.#resolveNodeDefinition(typeId);
        if (!nodeType) {
            console.warn(`[GraphPanelView] Node type '${typeId}' not found in runtime`);
            return;
        }

        const resolvedWidth = resolveNodeWidth({
            defaultWidth: nodeType.defaultWidth,
            minWidth: nodeType.minWidth,
            maxWidth: nodeType.maxWidth,
            legacyFallbackWidth: 150,
        });

        const clampedPos = this._resolveNodeDropPosition(event, resolvedWidth);

        const snapshot = this._buildNodeTypeSnapshot(nodeType, typeId);

        // Create node data with full type information using NodeData class
        const nodeData = new NodeData({
            type: typeId,
            typeName: snapshot.typeName,
            userName: null,
            x: clampedPos.x,
            y: clampedPos.y,
            width: resolvedWidth,
            icon: snapshot.icon,
            color: snapshot.color,
            inputs: snapshot.inputs,
            outputs: snapshot.outputs,
            controls: snapshot.controls,
            controlValues: this._buildControlValuesForSnapshot(snapshot.controls),
            inputDefaults: {},
        });

        // Note: height will be calculated by NodeUi when it's first rendered
        // Don't set height here - all node UI concerns belong in NodeUi class

        this.graph?.addNode?.(nodeData);

        this.syncNodeUisFromGraph();
        this.renderPanel();
    }

    /**
     * Attach document-level mousemove and mouseup listeners during drag operations.
     * This allows dragging to continue when the mouse leaves the canvas.
     * @private
     */
    #attachDocumentDragListeners() {
        if (this._isDraggingActive) return; // Already attached

        this._documentDragHandlers.mousemove = this.handleMouseMove.bind(this);
        this._documentDragHandlers.mouseup = this.handleMouseUp.bind(this);

        document.addEventListener('mousemove', this._documentDragHandlers.mousemove);
        document.addEventListener('mouseup', this._documentDragHandlers.mouseup);
        this._isDraggingActive = true;
    }

    /**
     * Remove document-level drag listeners when drag operation completes.
     * @private
     */
    #detachDocumentDragListeners() {
        if (!this._isDraggingActive) return; // Not attached

        if (this._documentDragHandlers.mousemove) {
            document.removeEventListener('mousemove', this._documentDragHandlers.mousemove);
            this._documentDragHandlers.mousemove = null;
        }
        if (this._documentDragHandlers.mouseup) {
            document.removeEventListener('mouseup', this._documentDragHandlers.mouseup);
            this._documentDragHandlers.mouseup = null;
        }
        this._isDraggingActive = false;
    }

    /**
     * Bind all canvas-level event listeners.
     * @private
     */
    #bindEvents() {
        if (!this.canvas) {
            return;
        }
        // Guard: Only bind events once
        if (this._eventsBound) {
            return;
        }
        this._eventsBound = true;

        this._bound.mousedown = this.handleMouseDown.bind(this);
        this._bound.mousemove = this.handleMouseMove.bind(this);
        this._bound.mouseup = this.handleMouseUp.bind(this);
        this._bound.mouseleave = this.handleMouseLeave.bind(this);
        this._bound.wheel = this.handleWheel.bind(this);
        this._bound.dragover = this.handleDragOver.bind(this);
        this._bound.drop = this.handleDrop.bind(this);
        this._bound.keydown = this.handleKeyDown.bind(this);
        this._bound.contextmenu = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        this.addDomListener(this.canvas, 'mousedown', this._bound.mousedown);
        this.addDomListener(this.canvas, 'mousemove', this._bound.mousemove);
        this.addDomListener(this.canvas, 'mouseup', this._bound.mouseup);
        this.addDomListener(this.canvas, 'mouseleave', this._bound.mouseleave);
        this.addDomListener(this.canvas, 'wheel', this._bound.wheel, { passive: false });
        this.addDomListener(this.canvas, 'dragover', this._bound.dragover);
        this.addDomListener(this.canvas, 'drop', this._bound.drop);
        this.addDomListener(this.canvas, 'contextmenu', this._bound.contextmenu);
        // Listen for keyboard events on document to handle Delete key
        this.addDomListener(document, 'keydown', this._bound.keydown);
    }

    /**
     * Draw a simple crosshair for debugging coordinates.
     * @param {CanvasRenderingContext2D} ctx - Target context.
     * @param {{x:number,y:number}} pos - Center position.
     * @param {number} width - Crosshair width.
     * @param {number} height - Crosshair height.
     * @param {string} [style] - Stroke style.
     */
    drawCrosshair(ctx, pos, width, height, style = 'rgba(34, 193, 34, 0.8)') {
        ctx.save();
        ctx.strokeStyle = style;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - height / 2);
        ctx.lineTo(pos.x, pos.y + height / 2);
        ctx.moveTo(pos.x - width / 2, pos.y);
        ctx.lineTo(pos.x + width / 2, pos.y);
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Compute the maximum allowed grid extent in world units.
     * @returns {{x:number,y:number}}
     */
    evalMaxGridPosWorld() {
        return this.viewportModule.evalMaxGridPosWorld();
    }

    /**
     * Compute min/max viewport translations that keep the grid visible.
     * @returns {{minX:number,maxX:number,minY:number,maxY:number}}
     */
    evalGridViewportTranslateRange() {
        const canvasSize = this.getCanvasClientSizeScreen();
        return this.viewportModule.evalGridViewportTranslateRange(canvasSize);
    }
    /**
     * Renders the background grid aligned to world space so it stays synchronized with node positions,
     * even as the viewport is panned. Converts the screen’s top-left and bottom-right corners to world
     * coordinates to determine the visible bounds, then draws minor and major grid lines across that
     * range using the configured spacing and colors.
     *
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context to draw the grid onto.
     * @param {number} width - The current viewport width in screen pixels.
     * @param {number} height - The current viewport height in screen pixels.
     */
    drawGrid(ctx, width, height) {
        this.rendering.drawGrid(ctx, width, height);
    }

    /**
     * Draw all connections between nodes.
     * Phase 5: Delegates to GraphPanelRendering module
     * @param {CanvasRenderingContext2D} ctx - Target context.
     */
    drawConnections(ctx) {
        this.rendering.drawConnections(ctx, this.nodeUiMap);
    }

    /**
     * Draw a single connector with optional hover highlight.
     * Phase 5: Delegates to GraphPanelRendering module
     * @param {CanvasRenderingContext2D} ctx - Target context.
     * @param {{x:number,y:number,kind:'input'|'output',highlighted?:boolean,type?:string|null}} opts - Connector options.
     */
    drawConnector(ctx, { x, y, kind, highlighted = false, type = null }) {
        this.rendering.drawConnector(ctx, { x, y, kind, highlighted, type });
    }

    /**
     * Compute input/output connector positions for a node in world space.
     * Phase 5: Delegates to GraphPanelRendering module
     * @param {object} node - Node with x/y/width/height.
     * @returns {{input:{x:number,y:number},output:{x:number,y:number}}}
     */
    getConnectorPositionsWorld(node) {
        return this.rendering.getConnectorPositionsWorld(node);
    }

    /**
     * Render nodes, including titles and connectors, with selection/hover styling.
     * Phase 5: Delegates to GraphPanelRendering module
     * @param {CanvasRenderingContext2D} ctx - Target context.
     * @param {object} options - Rendering options
     * @param {string} [options.selectedNodeId] - Legacy single selection
     * @param {object} [options.hoverConnector] - Hovered connector state
     */
    drawNodes(ctx, { selectedNodeId = null, hoverConnector = null } = {}) {
        // Add legacy single selection to Set for module
        const selectedNodeIds = new Set(this.selection.selectedNodes);
        const normalizedSelectedNodeId = normalizeNodeId(selectedNodeId);
        if (normalizedSelectedNodeId) {
            selectedNodeIds.add(normalizedSelectedNodeId);
        }

        this.rendering.drawNodes(ctx, {
            nodeUiMap: this.nodeUiMap,
            nodeOrderList: this.nodeOrderList,
            selectedNodeIds: selectedNodeIds,
            activeNodeId: this.activeNodeId,
            hoverConnector: hoverConnector,
            tempConnection: this.interaction.draggingConnection,
        });
    }

    /**
     * Draw an in-progress connection as the user drags between connectors.
     * Phase 5: Delegates to GraphPanelRendering module
     * @param {CanvasRenderingContext2D} ctx - Target context.
     * @param {{start:{x:number,y:number},end:{x:number,y:number},startKind:string}} param1 - Connection endpoints.
     */
    drawTempConnection(ctx, { start, end, startKind }) {
        this.rendering.drawTempConnection(ctx, { start, end, startKind });
    }

    /**
     * Render the entire panel, delegating to an external renderer if provided.
     * Phase 5: Now delegates to GraphPanelRendering module
     */
    renderPanel() {
        if (!this._isVisible) {
            this._pendingRenderOnShow = true;
            return;
        }
        if (typeof this.onRenderExternal === 'function') {
            this.onRenderExternal({
                overlay: this.getOverlay(),
                selectedNodeId: this.selectedNodeId,
            });
            return;
        }

        if (this._renderPending) {
            return;
        }

        this._renderPending = true;

        // Schedule the actual rendering in the next animation frame
        // This ensures the browser paints the changes to the screen
        try {
            this._renderRafId = requestAnimationFrame(() => {
                try {
                    this._doRender();
                } finally {
                    this._renderPending = false;
                    this._renderRafId = null;
                }
            });
        } catch (_error) {
            this._renderPending = false;
            this._renderRafId = null;
            throw _error;
        }
    }

    /**
     * Internal render method that performs the actual canvas drawing
     */
    _doRender() {
        // The DOM layer follows the same invalidation as the canvases, so text and shading never
        // drift apart. It is synced first because it does not depend on a 2D context.
        this.#syncDocumentationLayer();

        const renderContext = this.getRenderContext();

        const { ctx, canvas, readability } = renderContext;
        if (!ctx || !canvas) {
            return;
        }

        const width = canvas.width || 0;
        // Keep render metrics square so viewport math matches the enforced canvas aspect.
        const height = canvas.height || width;

        // Get DPR for proper scaling (default to 1 if not set)
        const dpr = this.canvasDPR || 1;
        const cssWidth = width / dpr;
        const cssHeight = height / dpr;

        // Always clear in screen space before applying viewport transforms to avoid trails.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // The background layer is cleared the same way, in screen space, before any viewport
        // transform. Both layers then paint in the same frame, so the shading never lags panning.
        const backgroundCtx = this.backgroundCanvas?.getContext('2d') || null;
        if (backgroundCtx) {
            backgroundCtx.setTransform(1, 0, 0, 1, 0, 0);
            backgroundCtx.clearRect(0, 0, width, height);
        }

        if (!this.graph) {
            return;
        }

        // Apply DPR scaling so we can work in CSS pixels
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.#configureCanvasTextRendering(ctx);

        if (backgroundCtx) {
            backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            backgroundCtx.save();
            this.applyViewport(backgroundCtx);
            this.rendering.renderBackground(backgroundCtx, cssWidth, cssHeight, {
                showGrid: this.showGrid,
                documentationAreas: this.graph.getDocumentationAreas?.() ?? [],
                activeAreaId: this.activeDocumentationAreaId ?? null,
            });
            backgroundCtx.restore();
        }

        ctx.save();
        // applyViewport uses transform() to combine with DPR scaling
        this.applyViewport(ctx);

        // Phase 5: Delegate to rendering module
        const overlayState = this.getOverlay();
        const relatedNodeIds = collectRelatedNodeIds(
            this.graph?.getConnections?.() || [],
            this.selection.selectedNodes
        );
        this.rendering.render(ctx, cssWidth, cssHeight, {
            // The grid moved to the background canvas; without one, keep the single-canvas behaviour.
            showGrid: this.showGrid && !backgroundCtx,
            nodeUiMap: this.nodeUiMap,
            nodeOrderList: this.nodeOrderList,
            selectedNodeIds: this.selection.selectedNodes,
            activeNodeId: this.activeNodeId,
            relatedNodeIds,
            hoverConnector: overlayState.hoverConnector,
            hoverConnection: overlayState.hoverConnection,
            tempConnection: overlayState.tempConnection,
            selectionBox: this.selection._isBoxSelecting ? this.selection.selectionBox : null,
            qualityMode: this.renderQualityMode,
            onRenderExternal: null,
        });

        ctx.restore();

        // If we rendered to a readability canvas, blit it to the main canvas so the
        // displayed surface stays in sync with the cleared buffer above.
        if (readability && this.canvas && canvas !== this.canvas) {
            const mainCtx = this.canvas.getContext('2d');
            if (mainCtx) {
                const dpr = this.canvasDPR || 1;
                mainCtx.setTransform(1, 0, 0, 1, 0, 0);
                mainCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                // Scale for DPR before blitting
                mainCtx.scale(dpr, dpr);
                this.#configureCanvasTextRendering(mainCtx);
                mainCtx.drawImage(canvas, 0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
            }
        }
    }

    /**
     * Swap the bound graph instance and rerender.
     * @param {object} graph - Graph instance implementing required getters/mutators.
     */
    setGraph(graph) {
        this._log('set-graph', 'debug', {
            newGraphId: graph?.id,
            oldGraphId: this.graph?.id,
            hadUnsubscribe: !!this._graphChangeUnsubscribe,
        });

        // A still-debounced pan/zoom belongs to the outgoing graph: write it there, not on the new one.
        this.#flushViewportPersist();

        // Activation is per graph: a different graph cannot keep the old area selected.
        this.activeDocumentationAreaId = null;
        // The new graph needs its own opening viewport (stored config or content center).
        this._initialViewportApplied = false;

        // Unsubscribe from old graph
        if (this._graphChangeUnsubscribe) {
            this._graphChangeUnsubscribe();
            this._graphChangeUnsubscribe = null;
        }

        // Update graph reference
        this.graph = graph;
        this.connectionsUi.setGraph(graph);
        this.nodeUiMap.clear();

        // Subscribe to new graph
        this._subscribeToGraphChanges();
        this._updateToolbarEnabledState();
        this._syncToolbarControls();

        // Sync and render
        this.syncNodeUisFromGraph();
        void this.revalidateNodeCapabilities();
        this.#ensureInitialViewport();
        if (this._isVisible) {
            this.renderPanel();
        } else {
            this._pendingRenderOnShow = true;
        }
    }

    /**
     * Get the current overlay state (hover/temp connection) from the connection UI.
     * @returns {{hoverConnector:object|null,hoverConnection:object|null,tempConnection:object|null}}
     */
    getOverlay() {
        return {
            hoverConnector: this.connectionsUi?.hoverConnector || null,
            hoverConnection: this.connectionsUi?.hoverConnection || null,
            tempConnection: this.connectionsUi?.tempConnection || null,
        };
    }

    /**
     * Get the id of the currently selected node.
     * @returns {number|null}
     */
    getSelectedNodeId() {
        return this.selectedNodeId;
    }

    /**
     * Clean up listeners and owned DOM elements.
     */
    dispose() {
        if (this._renderRafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._renderRafId);
        }
        this._renderRafId = null;
        this._renderPending = false;

        // Persist anything still inside the debounce window before the canvas is dropped.
        this.#flushViewportPersist();

        // Note: ViewBase disconnects ResizeObserver automatically
        if (this._visibilityObserver) {
            try {
                this._visibilityObserver.disconnect();
            } catch {
                // ignore
            }
        }
        this._visibilityObserver = null;
        this.boundHandlers.forEach(({ target, type, handler, options }) => {
            target.removeEventListener(type, handler, options);
        });
        this.boundHandlers = [];
        if (this.connectionsUi) {
            this.connectionsUi.dispose();
        }
        if (this.ownsCanvas && this.canvas?.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        if (this.ownsReadabilityCanvas && this.readabilityCanvas?.parentNode) {
            this.readabilityCanvas.parentNode.removeChild(this.readabilityCanvas);
        }
        if (this.ownsBackgroundCanvas && this.backgroundCanvas?.parentNode) {
            this.backgroundCanvas.parentNode.removeChild(this.backgroundCanvas);
        }
        if (this.documentationLayer) {
            this.documentationLayer.destroy();
            this.documentationLayer = null;
        }
        if (this._capabilityTooltipEl?.parentNode) {
            this._capabilityTooltipEl.parentNode.removeChild(this._capabilityTooltipEl);
        }
        this._capabilityTooltipEl = null;
        this.canvas = null;
        this.readabilityCanvas = null;
        this.backgroundCanvas = null;
        this.ownsBackgroundCanvas = false;

        // Tear down the toolbar before the layout skeleton is dropped.
        // The signals picker owns a menu appended to `document.body`; detaching removes it.
        this.#signalNamesControl?.detach();
        this.#toolbarView?.detach();
        this.#toolbarView = null;
        this.#alignButton = null;
        this.#toolbarControlsCreated = false;
        this.#executionTypeControl = null;
        this.#executionTypeHost = null;
        this.#triggerNameControl = null;
        this.#triggerNameHost = null;
        this.#signalNamesControl = null;
        this.#signalNamesHost = null;
        this.#signalModeControl = null;
        this.#signalModeHost = null;
        this.#signalOptionValues = [];
        this.#sleepControl = null;
        this.#sleepHost = null;

        // Drop the layout skeleton so a disposed view can be rendered from scratch.
        this.#canvasHost = null;
        this.#toolbarHost = null;
        this.#rootEl = null;
    }
}

/**
 * Convenience factory for GraphPanelUiV2.
 * @param {object} options - Options passed to the GraphPanelUiV2 constructor.
 * @returns {GraphPanelView}
 */
export function createGraphPanelUiV2(options) {
    return new GraphPanelView(options);
}
