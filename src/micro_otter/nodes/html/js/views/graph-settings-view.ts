import { ViewBase } from './view-base.js';
import {
    ButtonControl,
    CheckboxControl,
    DropdownControl,
    NumberControl,
    TextControl,
} from './controls/custom-runtime-controls.js';
import {
    DropdownControl as MenuDropdownControl,
    type DropdownOption,
} from './controls/dropdown-control.js';
import { CollapsibleView } from './collapsible-view.js';
import { ContentView } from './content-view.js';
import { SplitView } from './split-view.js';
import { ToolbarView } from './toolbar-view.js';
import { IconProvider } from './icon-provider.js';
import { MdiIconPickerControl } from './controls/mdi-icon-picker-control.js';
import { MarkdownEditorControl } from './controls/markdown-editor-control.js';
import { assertAppEventPayloadType } from '../core/app-event.js';
import type { AppEvent } from '../core/app-event.js';
import {
    DEFAULT_EXECUTION_TYPE,
    DEFAULT_GRAPH_ENABLED,
    DEFAULT_SIGNAL_MODE,
    DEFAULT_SLEEP_MS,
    GRAPH_EXECUTION_TYPES,
    MIN_SLEEP_MS,
    MAX_SLEEP_MS,
    clampSleepDuration,
    normalizeExecutionType,
    normalizeGraphEnabled,
    normalizeSignalMode,
    normalizeSignalNames,
    normalizeTriggerName,
} from '../data/graph-execution-settings.js';
import type { ExecutionType } from '../data/graph-execution-settings.js';
import {
    DEFAULT_FUNCTION_CATEGORY,
    DEFAULT_FUNCTION_ICON,
    MAX_FUNCTION_PORTS,
    isNumericFunctionPortType,
    resolveFunctionPortDefaultControlType,
    type FunctionPort,
    type FunctionPortDefault,
    type FunctionPortKind,
} from '../data/graph-function-signature.js';
import { resolveLocalizedName } from '../data/node-name-resolver.js';
import { collectIrqTriggerNames } from '../nodes/irq-triggers.js';
import {
    CUSTOM_SIGNAL_CONTROL_ID,
    SIGNAL_CONTROL_ID,
    collectSignalNames,
} from '../nodes/signal-names.js';

type Unsubscribe = () => void;

type LoggerFunction = (message: string, level?: unknown, ...data: unknown[]) => void;

type WildcardEventHandler = (event: unknown) => void;

interface I18nServiceLike {
    t: (key: string, params?: Record<string, unknown>) => string;
    addEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    removeEventListener: (type: 'languagechange', handler: (event: Event) => void) => void;
    /** Active language code; used to localize collection data-type names. */
    getCurrentLanguage?: () => string;
}

interface RuntimeControl {
    render: (container: HTMLElement) => void;
}

/** A runtime control that reports edits and can be re-synchronized from the model. */
interface RuntimeTextControl extends RuntimeControl {
    onChange: (callback: (value: string) => void) => void;
    setValue?: (value: string) => void;
}

/** A runtime value editor that reports edits as an arbitrary value (number/boolean/string). */
interface RuntimeValueControl extends RuntimeControl {
    onChange?: (callback: (value: unknown) => void) => void;
}

interface GraphLike {
    on?: (eventName: '*', listener: WildcardEventHandler) => Unsubscribe;
    getName: () => string;
    setName: (name: string) => void;
    getEnabled?: () => boolean;
    setEnabled?: (enabled: boolean) => void;
    getExecutionType?: () => unknown;
    setExecutionType: (executionType: ExecutionType) => void;
    getTriggerName?: () => unknown;
    setTriggerName?: (name: string) => void;
    getSignalNames?: () => unknown;
    setSignalNames?: (names: string[]) => void;
    getSignalMode?: () => unknown;
    setSignalMode?: (mode: string) => void;
    getRunOnStart?: () => unknown;
    setRunOnStart?: (flag: boolean) => void;
    getTriggerInterval: () => number;
    setTriggerInterval: (intervalMs: number) => void;
    /** Declared function signature; absent on graphs that predate function graphs. */
    getFunctionSignature?: () => unknown;
    getFunctionCategory?: () => unknown;
    setFunctionCategory?: (category: string) => void;
    getFunctionIcon?: () => unknown;
    setFunctionIcon?: (icon: string) => void;
    getFunctionDescription?: () => unknown;
    setFunctionDescription?: (description: string) => void;
    addFunctionPort?: (
        kind: FunctionPortKind,
        port?: Record<string, unknown> | null
    ) => { index: number; port: FunctionPort } | null;
    updateFunctionPort?: (
        kind: FunctionPortKind,
        portId: string,
        patch?: Record<string, unknown>
    ) => FunctionPort | null;
    removeFunctionPort?: (
        kind: FunctionPortKind,
        portId: string
    ) => { index: number; port: FunctionPort } | null;
    moveFunctionPort?: (kind: FunctionPortKind, fromIndex: number, toIndex: number) => boolean;
}

interface CollectionLike {
    on?: (eventName: '*', listener: WildcardEventHandler) => Unsubscribe;
    getActiveGraph?: () => GraphLike;
    getGraphArray?: () => unknown;
    /** Collection data types offered by the port type multi-select. */
    getAllDataTypes?: () => Array<{ id: string; definition: Record<string, unknown> }>;
}

interface CollectionManagerLike {
    getActiveCollection: () => CollectionLike | null;
    on: (eventName: '*', listener: WildcardEventHandler) => Unsubscribe;
}

interface GraphSettingsViewOptions {
    collectionManager?: CollectionManagerLike | null;
    graph?: GraphLike | null;
    i18nService?: I18nServiceLike | null;
    title?: string | null;
    icon?: string;
    id?: string | null;
    logger?: LoggerFunction | null;
    showTitle?: boolean;
}

interface GraphSettingsViewSerialized {
    type: 'GraphSettingsView';
    id: string;
    title: string;
    icon: string | null;
    [key: string]: unknown;
}

interface GraphSettingsViewDeserializeData {
    title?: string | null;
    icon?: string | null;
    id?: string | null;
}

interface GraphSettingsViewDeserializeContext {
    collectionManager?: CollectionManagerLike | null;
    i18nService?: I18nServiceLike | null;
    logger?: LoggerFunction | null;
}

type CollectionManagerEventName = 'activeCollectionChanged';
type CollectionEventName = 'activeGraphIdx' | 'graphUpdated' | 'graphRemoved';
type GraphEventName =
    | 'name'
    | 'interval'
    | 'executionType'
    | 'triggerName'
    | 'signalTrigger'
    | 'enabled'
    | 'node-added'
    | 'node-updated'
    | 'node-removed'
    | 'functionSignature';

type CollectionEvent = AppEvent & { name: CollectionEventName };
type GraphEvent = AppEvent & { name: GraphEventName };

/** `NodeGraph.NodeUpdated.v1` detail fields the settings view inspects. */
interface NodeUpdatedEventDetail {
    nodeId?: unknown;
    patch?: { controlValues?: Record<string, unknown> } & Record<string, unknown>;
}

/**
 * One rendered port row of the function settings form.
 *
 * The row is rebuilt from the signature on structural changes, so it carries only
 * the handles the light refresh path needs (row title, type multi-select, hints).
 */
interface FunctionPortRow {
    kind: FunctionPortKind;
    portId: string;
    view: CollapsibleView;
    nameInput: HTMLInputElement | null;
    nameMessage: HTMLDivElement | null;
    typesControl: MenuDropdownControl | null;
    anyHint: HTMLDivElement | null;
    defaultTypeHost: HTMLDivElement | null;
    defaultTypeSelect: HTMLSelectElement | null;
    defaultValueHost: HTMLDivElement | null;
    defaultValueInput: HTMLInputElement | null;
    defaultValueControl: RuntimeValueControl | null;
    defaultValueControlKind: string;
    constraintsHost: HTMLDivElement | null;
    constraintsInputs: {
        min: HTMLInputElement | null;
        max: HTMLInputElement | null;
        step: HTMLInputElement | null;
    };
    constraintsMessage: HTMLDivElement | null;
    documentationControl: MarkdownEditorControl | null;
}

/**
 * Header height of one parameter row and of its collapsed pane in the port-list split.
 *
 * One constant for both so the collapsed pane can never be taller than the header it shows;
 * `24` is one step below the section headers' default `28` and matches the compact nested
 * sub-section headers used by the firmware build view.
 */
const FUNCTION_PORT_HEADER_HEIGHT = 24;

/** Leading inset of the parameter panes so they sit indented under the section header. */
const FUNCTION_PORT_SPLIT_INSET_START = 16;

/** Block-start inset separating the first parameter pane from the section header above it. */
const FUNCTION_PORT_SPLIT_INSET_TOP = 4;

/** Minimum pane height of the graph-settings split; its panes are content-sized in CSS, so this
 *  only seeds the pane floor before the content-fit override applies. */
const GRAPH_SETTINGS_MIN_PANE_HEIGHT = 28;

/** Per-execution-type fields that the settings view shows. */
const EXECUTION_FIELD_VISIBILITY: Record<ExecutionType, readonly string[]> = {
    startup: [],
    continuous: ['sleep'],
    irq: ['trigger'],
    event: ['signals'],
    function: ['functionPorts'],
};

function isAppEventWithName<TName extends string>(
    event: unknown,
    names: readonly TName[]
): event is AppEvent & { name: TName } {
    if (!event || typeof event !== 'object') {
        return false;
    }

    const eventName = (event as { name?: unknown }).name;
    return typeof eventName === 'string' && names.includes(eventName as TName);
}

/**
 * Normalize one multi-select edit of a port's data types.
 *
 * `any` accepts every concrete type, so it is exclusive in both directions: picking
 * `any` replaces the whole selection, and picking a concrete type while `any` was
 * selected drops `any`. An empty selection falls back to `['any']`, the same default
 * the graph stores, so the control can never report a type-less port.
 *
 * @param value - Values reported by the multi-select after the edit.
 * @param previous - Types the port declared before the edit.
 * @returns The normalized, non-empty type union to write into the signature.
 */
function normalizePortTypeSelection(value: unknown, previous: readonly string[]): string[] {
    const selected = (Array.isArray(value) ? value : []).filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
    );
    if (selected.length === 0) {
        return ['any'];
    }

    const concrete = selected.filter((entry) => entry !== 'any');
    if (!selected.includes('any') || concrete.length === 0) {
        return selected.includes('any') ? ['any'] : concrete;
    }

    // `any` plus a concrete type: the concrete type was the edit unless `any` was
    // already selected before (then the user just added a concrete type).
    return previous.includes('any') ? concrete : ['any'];
}

/**
 * Test whether a port declares the catch-all type.
 * @param types - Declared type ids.
 * @returns True for the `['any']` union.
 */
function isAnyPortTypes(types: readonly string[]): boolean {
    return types.length === 1 && types[0] === 'any';
}

export class GraphSettingsView extends ViewBase {
    private _collectionManager: CollectionManagerLike;
    private _collection: CollectionLike | null;
    private _graph: GraphLike | null;
    private _showTitle: boolean;

    private _titleElement: HTMLHeadingElement | null;
    private _nameLabel: HTMLElement | null;
    private _nameInput: HTMLInputElement | null;
    private _nameControl: RuntimeControl | null;
    private _enabledGroup: HTMLDivElement | null;
    private _enabledLabel: HTMLElement | null;
    private _enabledInput: HTMLInputElement | null;
    private _enabledControl: RuntimeControl | null;
    private _executionLabel: HTMLElement | null;
    private _executionSelect: HTMLSelectElement | null;
    private _executionControl: RuntimeControl | null;
    private _triggerGroup: HTMLDivElement | null;
    private _triggerLabel: HTMLElement | null;
    private _triggerSelect: HTMLSelectElement | null;
    private _triggerControl: RuntimeControl | null;
    private _triggerDescription: HTMLDivElement | null;
    private _signalsGroup: HTMLDivElement | null;
    private _signalDropdown: MenuDropdownControl | null;
    private _signalOptionValues: string[];
    private _signalMessage: HTMLDivElement | null;
    private _modeGroup: HTMLDivElement | null;
    private _modeLabel: HTMLElement | null;
    private _modeSelect: HTMLSelectElement | null;
    private _modeControl: RuntimeControl | null;
    private _runOnStartGroup: HTMLDivElement | null;
    private _runOnStartInput: HTMLInputElement | null;
    private _runOnStartControl: RuntimeControl | null;
    private _sleepGroup: HTMLDivElement | null;
    private _sleepLabel: HTMLElement | null;
    private _sleepInput: HTMLInputElement | null;
    private _sleepControl: RuntimeControl | null;
    private _sleepDescription: HTMLDivElement | null;

    private _controlsContainer: HTMLDivElement | null;
    private _settingsSplit: SplitView | null;
    private _functionSectionsMounted: boolean;
    private _functionCategoryGroup: HTMLDivElement | null;
    private _functionCategoryLabel: HTMLElement | null;
    private _functionCategoryInput: HTMLInputElement | null;
    private _functionCategoryControl: RuntimeTextControl | null;
    private _functionIconGroup: HTMLDivElement | null;
    private _functionIconControl: MdiIconPickerControl | null;
    private _functionDescriptionGroup: HTMLDivElement | null;
    private _functionDescriptionControl: MarkdownEditorControl | null;
    private _inputsSection: CollapsibleView | null;
    private _outputsSection: CollapsibleView | null;
    private _inputsBody: HTMLDivElement | null;
    private _outputsBody: HTMLDivElement | null;
    private _inputsSplit: SplitView | null;
    private _outputsSplit: SplitView | null;
    private _functionPortRows: FunctionPortRow[];
    private _functionDisposers: Array<() => void>;
    private _portTypeOptions: DropdownOption[];
    private _portCollapsedState: Map<string, boolean>;
    private _suppressSignatureRefresh: boolean;
    private _functionUnsupportedLogged: boolean;

    private _unsubscribeCollectionManager: Unsubscribe | null;
    private _unsubscribeCollection: Unsubscribe | null;
    private _unsubscribeGraph: Unsubscribe | null;

    constructor({
        collectionManager,
        graph = null,
        i18nService = null,
        title = null,
        icon = 'settings',
        id = null,
        logger = null,
        showTitle = true,
    }: GraphSettingsViewOptions = {}) {
        if (!collectionManager) {
            throw new Error('GraphSettingsView requires a collectionManager instance');
        }

        super({
            title: title || 'Graph Settings',
            icon,
            id,
            logger,
            i18nService,
        });

        this._collectionManager = collectionManager;
        this._collection = this._collectionManager.getActiveCollection() || null;
        this._graph = graph || this._resolveActiveGraph(this._collection);
        this._showTitle = Boolean(showTitle);

        this._titleElement = null;
        this._nameLabel = null;
        this._nameInput = null;
        this._nameControl = null;
        this._enabledGroup = null;
        this._enabledLabel = null;
        this._enabledInput = null;
        this._enabledControl = null;
        this._executionLabel = null;
        this._executionSelect = null;
        this._executionControl = null;
        this._triggerGroup = null;
        this._triggerLabel = null;
        this._triggerSelect = null;
        this._triggerControl = null;
        this._triggerDescription = null;
        this._signalsGroup = null;
        this._signalDropdown = null;
        this._signalOptionValues = [];
        this._signalMessage = null;
        this._modeGroup = null;
        this._modeLabel = null;
        this._modeSelect = null;
        this._modeControl = null;
        this._runOnStartGroup = null;
        this._runOnStartInput = null;
        this._runOnStartControl = null;
        this._sleepGroup = null;
        this._sleepLabel = null;
        this._sleepInput = null;
        this._sleepControl = null;
        this._sleepDescription = null;

        this._controlsContainer = null;
        this._settingsSplit = null;
        this._functionSectionsMounted = false;
        this._functionCategoryGroup = null;
        this._functionCategoryLabel = null;
        this._functionCategoryInput = null;
        this._functionCategoryControl = null;
        this._functionIconGroup = null;
        this._functionIconControl = null;
        this._functionDescriptionGroup = null;
        this._functionDescriptionControl = null;
        this._inputsSection = null;
        this._outputsSection = null;
        this._inputsBody = null;
        this._outputsBody = null;
        this._inputsSplit = null;
        this._outputsSplit = null;
        this._functionPortRows = [];
        this._functionDisposers = [];
        this._portTypeOptions = [];
        this._portCollapsedState = new Map();
        this._suppressSignatureRefresh = false;
        this._functionUnsupportedLogged = false;

        this._unsubscribeCollectionManager = null;
        this._unsubscribeCollection = null;
        this._unsubscribeGraph = null;
    }

    render(container: HTMLElement): void {
        void container;

        const root = document.createElement('section');
        root.className = 'view-graph-settings';

        if (this._showTitle) {
            this._titleElement = document.createElement('h3');
            this._titleElement.className = 'view-graph-settings__title';
            root.appendChild(this._titleElement);
        }

        const controls = document.createElement('div');
        controls.className = 'view-graph-settings__controls';
        this._controlsContainer = controls;

        // The enabled flag is the graph's top-level on/off switch, so it leads the form.
        this._enabledGroup = document.createElement('div');
        this._enabledGroup.className = 'view-graph-settings__group';
        this._enabledControl = new CheckboxControl({
            label: this.t('settings.graph.enabled.label'),
            defaultValue: DEFAULT_GRAPH_ENABLED,
        }) as RuntimeControl;
        this._enabledControl.render(this._enabledGroup);
        this._enabledLabel = this._enabledGroup.querySelector('.custom-control__checkbox-label');
        this._enabledLabel?.classList.add('view-graph-settings__label');
        this._enabledInput = this._enabledGroup.querySelector('input[type="checkbox"]');
        if (this._enabledInput) {
            this._enabledInput.classList.add('view-graph-settings__checkbox');
            this._enabledInput.id = `${this.id}-graph-enabled`;
        }
        this._enabledLabel?.setAttribute('for', `${this.id}-graph-enabled`);

        const nameGroup = document.createElement('div');
        nameGroup.className = 'view-graph-settings__group';
        this._nameControl = new TextControl({
            label: this.t('settings.graph.name.label'),
            defaultValue: '',
        }) as RuntimeControl;
        this._nameControl.render(nameGroup);
        this._nameLabel = nameGroup.querySelector('.custom-control__label');
        this._nameLabel?.classList.add('view-graph-settings__label');
        this._nameInput = nameGroup.querySelector('input[type="text"]');
        if (this._nameInput) {
            this._nameInput.classList.add('view-graph-settings__input');
            this._nameInput.id = `${this.id}-graph-name`;
        }
        this._nameLabel?.setAttribute('for', `${this.id}-graph-name`);

        const executionGroup = document.createElement('div');
        executionGroup.className = 'view-graph-settings__group';
        this._executionControl = new DropdownControl({
            label: this.t('settings.graph.executionType.label'),
            options: [],
            defaultValue: DEFAULT_EXECUTION_TYPE,
        }) as RuntimeControl;
        this._executionControl.render(executionGroup);
        this._executionLabel = executionGroup.querySelector('.custom-control__label');
        this._executionLabel?.classList.add('view-graph-settings__label');
        this._executionSelect = executionGroup.querySelector('select');
        if (this._executionSelect) {
            this._executionSelect.classList.add('view-graph-settings__select');
            this._executionSelect.id = `${this.id}-graph-execution-type`;
        }
        this._executionLabel?.setAttribute('for', `${this.id}-graph-execution-type`);

        // Function settings: the generated node's category row (appended below) and the two port
        // sections. The sections are built here but only mounted as split panes while a supported
        // function graph is active, so the form of every other execution type keeps its DOM.
        this._buildFunctionBlock();

        this._triggerGroup = document.createElement('div');
        this._triggerGroup.className = 'view-graph-settings__group';
        this._triggerControl = new DropdownControl({
            label: this.t('settings.graph.triggerName.label'),
            options: [],
            defaultValue: '',
        }) as RuntimeControl;
        this._triggerControl.render(this._triggerGroup);
        this._triggerLabel = this._triggerGroup.querySelector('.custom-control__label');
        this._triggerLabel?.classList.add('view-graph-settings__label');
        this._triggerSelect = this._triggerGroup.querySelector('select');
        if (this._triggerSelect) {
            this._triggerSelect.classList.add('view-graph-settings__select');
            this._triggerSelect.id = `${this.id}-graph-trigger-name`;
        }
        this._triggerLabel?.setAttribute('for', `${this.id}-graph-trigger-name`);
        this._triggerDescription = document.createElement('div');
        this._triggerDescription.className = 'view-graph-settings__description';
        this._triggerGroup.appendChild(this._triggerDescription);

        // Signals group: a multi-select picker replaces the hand-rolled checkbox list and owns the
        // row title through its own labelled variant (title in the row gutter, trigger filling the
        // rest of the line). Names exist only on `signal-post` nodes, so the view never creates
        // them; the group keeps one text row plus the message line.
        this._signalsGroup = document.createElement('div');
        this._signalsGroup.className = 'view-graph-settings__group';
        const signalControlHost = document.createElement('div');
        signalControlHost.className = 'view-graph-settings__signal-control';
        this._signalDropdown = new MenuDropdownControl({
            label: this.t('settings.graph.signals.label'),
            multiSelect: true,
            showIcons: false,
            showBulkActions: false,
            placeholder: 'settings.graph.signals.listLabel',
            menuClassName: 'view-graph-settings__signal-menu',
            i18nService: this._i18nService,
            logger: this._logger,
            onChange: (value) => this._handleSignalSelectionChanged(value),
        });
        this._signalDropdown.attachTo(signalControlHost);
        this._signalsGroup.appendChild(signalControlHost);
        this._signalMessage = document.createElement('div');
        this._signalMessage.className = 'view-graph-settings__description';
        this._signalsGroup.appendChild(this._signalMessage);

        // Mode group (any/all).
        this._modeGroup = document.createElement('div');
        this._modeGroup.className = 'view-graph-settings__group';
        this._modeControl = new DropdownControl({
            label: this.t('settings.graph.signals.mode.label'),
            options: [
                { value: 'any', label: this.t('settings.graph.signals.mode.any') },
                { value: 'all', label: this.t('settings.graph.signals.mode.all') },
            ],
            defaultValue: 'any',
        }) as RuntimeControl;
        this._modeControl.render(this._modeGroup);
        this._modeLabel = this._modeGroup.querySelector('.custom-control__label');
        this._modeLabel?.classList.add('view-graph-settings__label');
        this._modeSelect = this._modeGroup.querySelector('select');
        if (this._modeSelect) {
            this._modeSelect.classList.add('view-graph-settings__select');
            this._modeSelect.id = `${this.id}-graph-signal-mode`;
        }

        // Run on start group.
        this._runOnStartGroup = document.createElement('div');
        this._runOnStartGroup.className = 'view-graph-settings__group';
        this._runOnStartControl = new CheckboxControl({
            label: this.t('settings.graph.signals.runOnStart.label'),
            defaultValue: true,
        }) as RuntimeControl;
        this._runOnStartControl.render(this._runOnStartGroup);
        this._runOnStartInput = this._runOnStartGroup.querySelector('input[type="checkbox"]');
        if (this._runOnStartInput) {
            this._runOnStartInput.classList.add('view-graph-settings__checkbox');
            this._runOnStartInput.id = `${this.id}-graph-signal-run-on-start`;
        }
        this._runOnStartGroup
            .querySelector('.custom-control__checkbox-label')
            ?.setAttribute('for', `${this.id}-graph-signal-run-on-start`);

        this._sleepGroup = document.createElement('div');
        this._sleepGroup.className = 'view-graph-settings__group';
        this._sleepControl = new NumberControl({
            label: this.t('settings.graph.sleepDuration.label'),
            defaultValue: DEFAULT_SLEEP_MS,
            min: MIN_SLEEP_MS,
            max: MAX_SLEEP_MS,
            step: 1,
        }) as RuntimeControl;
        this._sleepControl.render(this._sleepGroup);
        this._sleepLabel = this._sleepGroup.querySelector('.custom-control__label');
        this._sleepLabel?.classList.add('view-graph-settings__label');
        this._sleepInput = this._sleepGroup.querySelector('input[type="number"]');
        if (this._sleepInput) {
            this._sleepInput.classList.add('view-graph-settings__input');
            this._sleepInput.id = `${this.id}-graph-sleep-duration`;
            this._sleepInput.min = String(MIN_SLEEP_MS);
            this._sleepInput.max = String(MAX_SLEEP_MS);
            this._sleepInput.step = '1';
        }
        this._sleepLabel?.setAttribute('for', `${this.id}-graph-sleep-duration`);
        this._sleepDescription = document.createElement('div');
        this._sleepDescription.className = 'view-graph-settings__description';
        this._sleepGroup.appendChild(this._sleepDescription);

        controls.appendChild(this._enabledGroup);
        controls.appendChild(nameGroup);
        controls.appendChild(executionGroup);
        if (this._functionCategoryGroup) {
            controls.appendChild(this._functionCategoryGroup);
        }
        if (this._functionIconGroup) {
            controls.appendChild(this._functionIconGroup);
        }
        if (this._functionDescriptionGroup) {
            controls.appendChild(this._functionDescriptionGroup);
        }
        controls.appendChild(this._triggerGroup);
        controls.appendChild(this._signalsGroup);
        controls.appendChild(this._modeGroup);
        controls.appendChild(this._runOnStartGroup);
        controls.appendChild(this._sleepGroup);

        const splitHost = document.createElement('div');
        splitHost.className = 'view-graph-settings__split-host';
        root.appendChild(splitHost);

        this.mountContent(root);

        this._settingsSplit = new SplitView({
            orientation: 'vertical',
            minPaneSize: GRAPH_SETTINGS_MIN_PANE_HEIGHT,
            gap: 0,
            views: [this._createGeneralPane()],
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._settingsSplit.attachTo(splitHost);

        this._bindControlEvents();
        this._applyLocalizedText();
        this._refreshAllControls();
    }

    /**
     * Build the function settings: the category row (appended to the general pane by `render()`)
     * and the two collapsible port sections, which later become panes of the settings split.
     *
     * The block is built once per render so its sections keep their collapse state and resize
     * wiring; only the port rows inside the section bodies are rebuilt.
     * @private
     */
    private _buildFunctionBlock(): void {
        this._functionCategoryGroup = document.createElement('div');
        this._functionCategoryGroup.className = 'view-graph-settings__function-category';
        this._functionCategoryControl = new TextControl({
            label: this.t('settings.graph.function.category.label'),
            defaultValue: DEFAULT_FUNCTION_CATEGORY,
        }) as RuntimeTextControl;
        this._functionCategoryControl.onChange((value) =>
            this._handleFunctionCategoryChanged(value)
        );
        this._functionCategoryControl.render(this._functionCategoryGroup);
        this._functionCategoryLabel =
            this._functionCategoryGroup.querySelector('.custom-control__label');
        this._functionCategoryLabel?.classList.add('view-graph-settings__label');
        this._functionCategoryInput =
            this._functionCategoryGroup.querySelector('input[type="text"]');
        if (this._functionCategoryInput) {
            this._functionCategoryInput.classList.add('view-graph-settings__input');
            this._functionCategoryInput.id = `${this.id}-graph-function-category`;
        }
        this._functionCategoryLabel?.setAttribute('for', `${this.id}-graph-function-category`);

        this._functionIconGroup = document.createElement('div');
        this._functionIconGroup.className = 'view-graph-settings__group';
        this._functionIconControl = new MdiIconPickerControl({
            label: this.t('settings.graph.function.icon.label'),
            value: DEFAULT_FUNCTION_ICON,
            placeholder: this.t('settings.graph.function.icon.hint'),
            portal: 'body',
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._functionIconControl.onChange((value) => this._handleFunctionIconChanged(value));
        this._functionIconControl.render(this._functionIconGroup);

        this._functionDescriptionGroup = document.createElement('div');
        this._functionDescriptionGroup.className = 'view-graph-settings__group';
        this._functionDescriptionControl = new MarkdownEditorControl({
            label: this.t('settings.graph.function.description.label'),
            value: '',
            placeholder: this.t('settings.graph.function.description.placeholder'),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        this._functionDescriptionControl.onChange((value) =>
            this._handleFunctionDescriptionChanged(value)
        );
        this._functionDescriptionControl.render(this._functionDescriptionGroup);

        this._inputsBody = document.createElement('div');
        this._inputsBody.className = 'view-graph-settings__function-ports';
        this._inputsSection = this._createFunctionSection(
            this._inputsBody,
            'settings.graph.function.inputs.title'
        );

        this._outputsBody = document.createElement('div');
        this._outputsBody.className = 'view-graph-settings__function-ports';
        this._outputsSection = this._createFunctionSection(
            this._outputsBody,
            'settings.graph.function.outputs.title'
        );
    }

    /**
     * Build the first pane of the settings split: a content pane holding the general parameters.
     *
     * The pane reuses the same `controls` element that previously owned the whole form, so every
     * field, id and listener stays intact; `render()` mounts it as the split's leading pane.
     * @returns The content view wrapping the general parameter form.
     * @private
     */
    private _createGeneralPane(): ContentView {
        return new ContentView({
            renderFn: () => this._controlsContainer as HTMLDivElement,
            i18nService: this._i18nService,
            logger: this._logger,
        });
    }

    /**
     * Wrap one port list into its own collapsible section of the settings split.
     *
     * `CollapsibleView` takes a view, not raw DOM, so the body element is handed over through a
     * `ContentView`; the body itself is a stable element the row builder refills without
     * re-attaching anything. The returned section is unattached — `_syncFunctionSectionPanes`
     * mounts it as a pane while a supported function graph is active.
     *
     * @param body - Persistent body element that receives the toolbar, rows and empty line.
     * @param titleKey - Locale key of the section header.
     * @returns The collapsible section view.
     * @private
     */
    private _createFunctionSection(body: HTMLDivElement, titleKey: string): CollapsibleView {
        return new CollapsibleView({
            headerTitle: this.t(titleKey),
            collapsed: false,
            sizeToContent: true,
            contentView: new ContentView({
                renderFn: () => body,
                i18nService: this._i18nService,
                logger: this._logger,
            }),
            logger: this._logger,
            i18nService: this._i18nService,
        });
    }

    afterAttach(): void {
        super.afterAttach();

        this._subscribeCollection();
        this._subscribeGraph();

        this._unsubscribeCollectionManager = this._collectionManager.on('*', (event: unknown) => {
            if (
                !isAppEventWithName<CollectionManagerEventName>(event, ['activeCollectionChanged'])
            ) {
                return;
            }
            assertAppEventPayloadType(
                event,
                'CollectionManager.ActiveCollectionChanged.v1',
                'GraphSettingsView collection manager listener'
            );
            this._setCollection(this._collectionManager.getActiveCollection());
        });

        this._subscribeToLanguageChanges(() => {
            this._applyLocalizedText();
            this._refreshAllControls();
        });
    }

    beforeDetach(): void {
        this._unsubscribeCollectionManager?.();
        this._unsubscribeCollectionManager = null;
        this._unsubscribeCollection?.();
        this._unsubscribeCollection = null;
        this._unsubscribeGraph?.();
        this._unsubscribeGraph = null;
        // The dropdown owns a menu appended to `document.body`; detaching removes it.
        this._signalDropdown?.detach();
        this._signalDropdown = null;
        // The icon picker owns a popover appended to `document.body` (body portal); detaching removes it.
        this._functionIconControl?.detach();
        this._functionIconControl = null;
        this._functionDescriptionControl?.detach();
        this._functionDescriptionControl = null;
        // Port rows and section toolbars own dropdowns and toolbars; release them before the
        // settings split detaches the section views.
        this._clearFunctionSections();
        this._settingsSplit?.detach();
        this._settingsSplit = null;
        this._inputsSection = null;
        this._outputsSection = null;
        this._functionSectionsMounted = false;
        super.beforeDetach();
    }

    setGraph(graph: GraphLike | null): void {
        this._unsubscribeGraph?.();
        this._unsubscribeGraph = null;

        this._graph = graph || null;
        this._subscribeGraph();
        this._refreshAllControls();
    }

    private _resolveActiveGraph(collection: CollectionLike | null): GraphLike | null {
        if (!collection || typeof collection.getActiveGraph !== 'function') {
            return null;
        }
        try {
            return collection.getActiveGraph();
        } catch {
            return null;
        }
    }

    private _setCollection(collection: CollectionLike | null): void {
        this._unsubscribeCollection?.();
        this._unsubscribeCollection = null;

        this._collection = collection || null;
        this._subscribeCollection();
        this.setGraph(this._resolveActiveGraph(this._collection));
    }

    private _subscribeCollection(): void {
        if (!this._collection || typeof this._collection.on !== 'function') {
            return;
        }
        this._unsubscribeCollection = this._collection.on('*', (event: unknown) => {
            if (
                !isAppEventWithName<CollectionEventName>(event, [
                    'activeGraphIdx',
                    'graphUpdated',
                    'graphRemoved',
                ])
            ) {
                return;
            }
            if (event.name === 'activeGraphIdx') {
                assertAppEventPayloadType(
                    event as CollectionEvent,
                    'Collection.ActiveGraphIndexChanged.v1',
                    'GraphSettingsView collection listener'
                );
                this.setGraph(this._resolveActiveGraph(this._collection));
                return;
            }
            if (event.name === 'graphUpdated' || event.name === 'graphRemoved') {
                if (event.name === 'graphUpdated') {
                    assertAppEventPayloadType(
                        event as CollectionEvent,
                        'Collection.GraphUpdated.v1',
                        'GraphSettingsView collection listener'
                    );
                } else {
                    assertAppEventPayloadType(
                        event as CollectionEvent,
                        'Collection.GraphRemoved.v1',
                        'GraphSettingsView collection listener'
                    );
                }
                const activeGraph = this._resolveActiveGraph(this._collection);
                if (activeGraph !== this._graph) {
                    this.setGraph(activeGraph);
                }
            }
        });
    }

    private _subscribeGraph(): void {
        if (!this._graph || typeof this._graph.on !== 'function') {
            return;
        }
        this._unsubscribeGraph = this._graph.on('*', (event: unknown) => {
            if (
                !isAppEventWithName<GraphEventName>(event, [
                    'name',
                    'interval',
                    'executionType',
                    'triggerName',
                    'signalTrigger',
                    'enabled',
                    'node-added',
                    'node-updated',
                    'node-removed',
                    'functionSignature',
                ])
            ) {
                return;
            }
            if (event.name === 'name') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    'NodeGraph.NameChanged.v1',
                    'GraphSettingsView graph listener'
                );
                this._refreshAllControls();
                return;
            }

            if (event.name === 'interval') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    'NodeGraph.IntervalChanged.v1',
                    'GraphSettingsView graph listener'
                );
                this._refreshAllControls();
                return;
            }

            if (event.name === 'executionType') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    'NodeGraph.ExecutionTypeChanged.v1',
                    'GraphSettingsView graph listener'
                );
                this._refreshAllControls();
                return;
            }

            if (event.name === 'triggerName') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    'NodeGraph.TriggerNameChanged.v1',
                    'GraphSettingsView graph listener'
                );
                this._refreshAllControls();
                return;
            }

            if (event.name === 'signalTrigger') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    'NodeGraph.SignalTriggerChanged.v1',
                    'GraphSettingsView graph listener'
                );
                this._refreshAllControls();
                return;
            }

            if (event.name === 'enabled') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    'NodeGraph.EnabledChanged.v1',
                    'GraphSettingsView graph listener'
                );
                this._refreshAllControls();
                return;
            }

            if (event.name === 'functionSignature') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    'NodeGraph.FunctionSignatureChanged.v1',
                    'GraphSettingsView graph listener'
                );
                // Edits made through this form refresh themselves afterwards; rebuilding
                // here would replace the control the user is typing in.
                if (!this._suppressSignatureRefresh) {
                    this._refreshFunctionControls(
                        normalizeExecutionType(this._graph?.getExecutionType?.())
                    );
                }
                return;
            }

            if (event.name === 'node-added' || event.name === 'node-removed') {
                assertAppEventPayloadType(
                    event as GraphEvent,
                    event.name === 'node-added'
                        ? 'NodeGraph.NodeAdded.v1'
                        : 'NodeGraph.NodeRemoved.v1',
                    'GraphSettingsView graph listener'
                );
                this._refreshSignalDropdown();
                return;
            }

            assertAppEventPayloadType(
                event as GraphEvent,
                'NodeGraph.NodeUpdated.v1',
                'GraphSettingsView graph listener'
            );
            const nodeDetail = (event as GraphEvent & { detail?: NodeUpdatedEventDetail }).detail;
            const controlValues = nodeDetail?.patch?.controlValues;
            // Only a `signal-post` name edit can change the picker's option list.
            if (
                controlValues &&
                (Object.prototype.hasOwnProperty.call(controlValues, SIGNAL_CONTROL_ID) ||
                    Object.prototype.hasOwnProperty.call(controlValues, CUSTOM_SIGNAL_CONTROL_ID))
            ) {
                this._refreshSignalDropdown();
            }
        });
    }

    private _bindControlEvents(): void {
        if (this._enabledInput) {
            this._enabledInput.addEventListener('change', (event: Event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) {
                    return;
                }
                this._handleEnabledChanged(target.checked);
            });
        }

        if (this._nameInput) {
            this._nameInput.addEventListener('change', () => this._handleGraphNameCommit());
            this._nameInput.addEventListener('blur', () => this._handleGraphNameCommit());
        }

        if (this._executionSelect) {
            this._executionSelect.addEventListener('change', (event: Event) => {
                const target = event.target;
                if (!(target instanceof HTMLSelectElement)) {
                    return;
                }
                this._handleExecutionTypeChanged(target.value);
            });
        }

        if (this._triggerSelect) {
            this._triggerSelect.addEventListener('change', (event: Event) => {
                const target = event.target;
                if (!(target instanceof HTMLSelectElement)) {
                    return;
                }
                this._handleTriggerNameChanged(target.value);
            });
        }

        if (this._modeSelect) {
            this._modeSelect.addEventListener('change', (event: Event) => {
                const target = event.target;
                if (!(target instanceof HTMLSelectElement)) {
                    return;
                }
                this._handleModeChanged(target.value);
            });
        }

        if (this._runOnStartInput) {
            this._runOnStartInput.addEventListener('change', (event: Event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) {
                    return;
                }
                this._handleRunOnStartChanged(target.checked);
            });
        }

        if (this._sleepInput) {
            this._sleepInput.addEventListener('change', () => this._handleSleepDurationCommit());
            this._sleepInput.addEventListener('blur', () => this._handleSleepDurationCommit());
        }
    }

    private _applyLocalizedText(): void {
        if (this._titleElement) {
            this._titleElement.textContent = this.t('settings.graph.title');
        }
        if (this._nameLabel) {
            this._nameLabel.textContent = this.t('settings.graph.name.label');
        }
        if (this._enabledLabel) {
            this._enabledLabel.textContent = this.t('settings.graph.enabled.label');
        }
        if (this._executionLabel) {
            this._executionLabel.textContent = this.t('settings.graph.executionType.label');
        }
        if (this._triggerLabel) {
            this._triggerLabel.textContent = this.t('settings.graph.triggerName.label');
        }
        if (this._triggerDescription) {
            this._triggerDescription.textContent = this.t('settings.graph.triggerName.description');
        }
        if (this._modeLabel) {
            this._modeLabel.textContent = this.t('settings.graph.signals.mode.label');
        }
        if (this._modeSelect?.options) {
            if (this._modeSelect.options[0]) {
                this._modeSelect.options[0].textContent = this.t('settings.graph.signals.mode.any');
            }
            if (this._modeSelect.options[1]) {
                this._modeSelect.options[1].textContent = this.t('settings.graph.signals.mode.all');
            }
        }
        if (this._signalDropdown) {
            // `setLabel` refreshes the row title without touching the trigger; `setValue` then
            // re-renders the trigger so the translated placeholder is current (the option labels
            // are raw signal names and need no translation).
            this._signalDropdown.setLabel(this.t('settings.graph.signals.label'));
            this._signalDropdown.setValue(
                normalizeSignalNames(this._signalDropdown.getSelectedValue())
            );
        }
        const runOnStartLabel = this._runOnStartGroup?.querySelector(
            '.custom-control__checkbox-label'
        );
        if (runOnStartLabel) {
            runOnStartLabel.textContent = this.t('settings.graph.signals.runOnStart.label');
        }
        if (this._sleepLabel) {
            this._sleepLabel.textContent = this.t('settings.graph.sleepDuration.label');
        }
        if (this._sleepDescription) {
            this._sleepDescription.textContent = this.t('settings.graph.sleepDuration.description');
        }
        if (this._functionCategoryLabel) {
            this._functionCategoryLabel.textContent = this.t(
                'settings.graph.function.category.label'
            );
        }
        const functionIconLabel = this._functionIconGroup?.querySelector('.mdi-icon-picker__label');
        if (functionIconLabel) {
            functionIconLabel.textContent = this.t('settings.graph.function.icon.label');
        }
        const functionDescriptionLabel = this._functionDescriptionGroup?.querySelector(
            '.markdown-editor__label'
        );
        if (functionDescriptionLabel) {
            functionDescriptionLabel.textContent = this.t('settings.graph.function.description.label');
        }
        if (this._inputsSection) {
            this._inputsSection.headerTitle = this.t('settings.graph.function.inputs.title');
        }
        if (this._outputsSection) {
            this._outputsSection.headerTitle = this.t('settings.graph.function.outputs.title');
        }
    }

    private _refreshAllControls(): void {
        if (!this._nameInput || !this._executionSelect || !this._sleepInput) {
            return;
        }

        const graph = this._graph;
        const hasGraph = !!graph;

        this._nameInput.disabled = !hasGraph;
        this._executionSelect.disabled = !hasGraph;
        this._sleepInput.disabled = !hasGraph;

        const executionType = hasGraph
            ? normalizeExecutionType(graph.getExecutionType?.())
            : DEFAULT_EXECUTION_TYPE;

        this._nameInput.value = hasGraph ? graph.getName() : '';
        this._refreshEnabledState(graph);
        this._refreshExecutionTypeOptions(executionType);

        const triggerName = hasGraph ? normalizeTriggerName(graph.getTriggerName?.()) : '';
        this._refreshTriggerOptions(triggerName, hasGraph);

        const triggerInterval = hasGraph ? graph.getTriggerInterval?.() : DEFAULT_SLEEP_MS;
        const normalizedInterval = clampSleepDuration(triggerInterval);
        this._sleepInput.value = String(normalizedInterval);

        this._updateSleepVisibility(executionType);
        this._updateTriggerVisibility(executionType);

        this._refreshSignalDropdown();
        if (this._modeSelect) {
            this._modeSelect.value = normalizeSignalMode(
                hasGraph ? graph.getSignalMode?.() : DEFAULT_SIGNAL_MODE
            );
            this._modeSelect.disabled = !hasGraph;
        }
        if (this._runOnStartInput) {
            this._runOnStartInput.checked = hasGraph ? graph.getRunOnStart?.() !== false : true;
            this._runOnStartInput.disabled = !hasGraph;
        }
        this._updateSignalsVisibility(executionType);
        this._refreshFunctionControls(executionType);
    }

    /**
     * Push the graph's enabled flag into the checkbox.
     * @param {object|null} graph - Graph bound to the view.
     * @private
     */
    private _refreshEnabledState(graph: GraphLike | null): void {
        if (!this._enabledInput) {
            return;
        }

        this._enabledInput.disabled = !graph || typeof graph.getEnabled !== 'function';
        this._enabledInput.checked = normalizeGraphEnabled(graph?.getEnabled?.());
    }

    /**
     * Rebuild the execution-type dropdown from the shared execution-type contract.
     *
     * Reading `GRAPH_EXECUTION_TYPES` instead of a local literal keeps the settings
     * view and the graph model from drifting apart when a type is added.
     *
     * @param {string} currentExecutionType - Execution type to mark as selected.
     * @private
     */
    private _refreshExecutionTypeOptions(currentExecutionType: ExecutionType): void {
        if (!this._executionSelect) {
            return;
        }

        this._executionSelect.replaceChildren();

        GRAPH_EXECUTION_TYPES.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = this.t(`settings.graph.executionType.${value}`);
            if (value === currentExecutionType) {
                option.selected = true;
            }
            this._executionSelect?.appendChild(option);
        });
    }

    private _updateSleepVisibility(executionType: ExecutionType): void {
        if (!this._sleepGroup) {
            return;
        }
        const showSleep = EXECUTION_FIELD_VISIBILITY[executionType].includes('sleep');
        this._sleepGroup.style.display = showSleep ? '' : 'none';
    }

    private _updateTriggerVisibility(executionType: ExecutionType): void {
        if (!this._triggerGroup) {
            return;
        }
        const showTrigger = EXECUTION_FIELD_VISIBILITY[executionType].includes('trigger');
        this._triggerGroup.style.display = showTrigger ? '' : 'none';
    }

    /**
     * Test whether the bound graph exposes the function-signature API.
     *
     * Every member is optional on `GraphLike` so graphs from older storage, demo graphs
     * and test doubles keep working; a graph with only part of the API is treated as
     * unsupported rather than driving half a form.
     *
     * @returns True when the whole API the block needs is present.
     * @private
     */
    private _supportsFunctionSettings(): boolean {
        const graph = this._graph;
        if (!graph) {
            return false;
        }
        return (
            typeof graph.getFunctionSignature === 'function' &&
            typeof graph.getFunctionCategory === 'function' &&
            typeof graph.setFunctionCategory === 'function' &&
            typeof graph.getFunctionIcon === 'function' &&
            typeof graph.setFunctionIcon === 'function' &&
            typeof graph.getFunctionDescription === 'function' &&
            typeof graph.setFunctionDescription === 'function' &&
            typeof graph.addFunctionPort === 'function' &&
            typeof graph.updateFunctionPort === 'function' &&
            typeof graph.removeFunctionPort === 'function' &&
            typeof graph.moveFunctionPort === 'function'
        );
    }

    /**
     * Read one port list of the bound graph.
     * @param kind - Which list to read.
     * @returns The declared ports, or an empty list when the graph declares none.
     * @private
     */
    private _functionPorts(kind: FunctionPortKind): FunctionPort[] {
        const signature = this._graph?.getFunctionSignature?.() as
            | { inputs?: unknown; outputs?: unknown }
            | undefined;
        const ports = kind === 'input' ? signature?.inputs : signature?.outputs;
        return Array.isArray(ports) ? (ports as FunctionPort[]) : [];
    }

    /**
     * Mount or unmount the function settings for the given execution type.
     *
     * The category row lives in the general pane and is simply hidden for other execution types;
     * the Inputs / Outputs sections are panes of the settings split and are added or removed so the
     * fields after them keep their positions for every other execution type.
     *
     * @param executionType - Execution type the graph currently uses.
     * @returns True when the function settings are visible.
     * @private
     */
    private _updateFunctionVisibility(executionType: ExecutionType): boolean {
        if (!this._functionCategoryGroup || !this._controlsContainer || !this._settingsSplit) {
            return false;
        }

        const wanted = EXECUTION_FIELD_VISIBILITY[executionType].includes('functionPorts');
        const visible = wanted && this._supportsFunctionSettings();
        if (wanted && !visible) {
            this._logFunctionUnsupported();
        }

        this._functionCategoryGroup.hidden = !visible;
        if (this._functionIconGroup) {
            this._functionIconGroup.hidden = !visible;
        }
        if (this._functionDescriptionGroup) {
            this._functionDescriptionGroup.hidden = !visible;
        }
        this._syncFunctionSectionPanes(visible);

        return visible;
    }

    /**
     * Add or remove the Inputs / Outputs panes so the settings split holds exactly the panes the
     * current execution type needs.
     *
     * The general pane stays mounted as pane 0; the two sections are inserted at indices 1 and 2.
     * The work is guarded by `_functionSectionsMounted` so repeated refreshes (language changes,
     * graph switches) leave the pane list alone.
     *
     * @param visible - Whether the two section panes should be mounted.
     * @private
     */
    private _syncFunctionSectionPanes(visible: boolean): void {
        const split = this._settingsSplit;
        if (!split || visible === this._functionSectionsMounted) {
            return;
        }

        if (visible) {
            if (this._inputsSection) {
                split.addView(this._inputsSection, 1);
            }
            if (this._outputsSection) {
                split.addView(this._outputsSection, 2);
            }
            this._functionSectionsMounted = true;
            return;
        }

        // Remove the trailing section first so the inputs pane keeps index 1 while removing.
        if (this._outputsSection) {
            split.removeView(this._outputsSection);
        }
        if (this._inputsSection) {
            split.removeView(this._inputsSection);
        }
        this._functionSectionsMounted = false;
    }

    /**
     * Log once that the bound graph cannot drive the function block.
     * @private
     */
    private _logFunctionUnsupported(): void {
        if (this._functionUnsupportedLogged) {
            return;
        }
        this._functionUnsupportedLogged = true;
        this._log('graph-settings-function-unsupported', 'warn', {
            graphName: this._graph?.getName?.() ?? null,
        });
    }

    /**
     * Push the graph's function signature into the block.
     * @param executionType - Execution type the graph currently uses.
     * @private
     */
    private _refreshFunctionControls(executionType: ExecutionType): void {
        if (!this._updateFunctionVisibility(executionType)) {
            this._clearFunctionSections();
            return;
        }

        if (this._functionCategoryInput) {
            this._functionCategoryInput.disabled = !this._graph;
            this._functionCategoryInput.value = this._functionCategory();
        }
        if (this._functionIconControl) {
            this._functionIconControl.setDisabled(!this._graph);
            this._functionIconControl.setValue(this._functionIcon());
        }
        if (this._functionDescriptionControl) {
            this._functionDescriptionControl.setDisabled(!this._graph);
            this._functionDescriptionControl.setValue(this._functionDescription());
        }
        this._refreshFunctionTypeOptions();
        this._rebuildFunctionSections();
    }

    /**
     * Read the stored palette category, defaulting to the shared default.
     * @returns A non-empty category name.
     * @private
     */
    private _functionCategory(): string {
        const category = this._graph?.getFunctionCategory?.();
        return typeof category === 'string' && category.trim()
            ? category
            : DEFAULT_FUNCTION_CATEGORY;
    }

    /**
     * Read the stored function icon, defaulting to the shared default.
     * @returns The semantic icon value, e.g. `mdi:function`.
     * @private
     */
    private _functionIcon(): string {
        const icon = this._graph?.getFunctionIcon?.();
        return typeof icon === 'string' && icon.trim() ? icon : DEFAULT_FUNCTION_ICON;
    }

    /**
     * Read the stored Markdown description of the generated function node.
     * @returns The stored description, or `''` when none is declared.
     * @private
     */
    private _functionDescription(): string {
        const description = this._graph?.getFunctionDescription?.();
        return typeof description === 'string' ? description : '';
    }

    /**
     * Write the Markdown description row into the graph.
     * @param value - Markdown source reported by the control.
     * @private
     */
    private _handleFunctionDescriptionChanged(value: unknown): void {
        if (!this._graph?.setFunctionDescription) {
            return;
        }

        this._suppressSignatureRefresh = true;
        try {
            this._graph.setFunctionDescription(String(value ?? ''));
        } finally {
            this._suppressSignatureRefresh = false;
        }
    }

    /**
     * Rebuild the data-type options offered by the port multi-selects.
     *
     * The list comes from the active collection, so the editor never hardcodes the
     * built-in types and follows renamed or add-on-provided types automatically.
     * @private
     */
    private _refreshFunctionTypeOptions(): void {
        const locale = this._currentLocale();
        const options = (this._collection?.getAllDataTypes?.() ?? []).map(({ id, definition }) => ({
            value: id,
            label: resolveLocalizedName(
                (definition as { name?: unknown } | null)?.name,
                locale,
                id
            ),
        }));
        options.sort((left, right) => left.label.localeCompare(right.label, locale));
        this._portTypeOptions = options;
    }

    /**
     * Read the active language code for data-type name resolution.
     * @returns The language code, or `'en'` when the service does not report one.
     * @private
     */
    private _currentLocale(): string {
        const service = this._i18nService as { getCurrentLanguage?: () => string } | null;
        const code = service?.getCurrentLanguage?.();
        return typeof code === 'string' && code.trim() ? code.trim() : 'en';
    }

    /**
     * Rebuild both port sections from the graph.
     * @private
     */
    private _rebuildFunctionSections(): void {
        this._clearFunctionSections();
        this._rebuildFunctionSection('input');
        this._rebuildFunctionSection('output');
    }

    /**
     * Tear down the rendered port rows and their split containers.
     *
     * The collapse state is captured per port id first, so a rebuild keeps the rows the
     * user opened open, and each dropdown removes the menu it appended to `document.body`.
     * The splits detach before the row disposers so every pane host is cleared exactly once.
     * @private
     */
    private _clearFunctionSections(): void {
        for (const row of this._functionPortRows) {
            this._portCollapsedState.set(row.portId, row.view.collapsed);
        }
        for (const split of [this._inputsSplit, this._outputsSplit]) {
            split?.detach();
        }
        this._inputsSplit = null;
        this._outputsSplit = null;
        for (const dispose of this._functionDisposers) {
            dispose();
        }
        this._functionDisposers = [];
        this._functionPortRows = [];
        this._inputsBody?.replaceChildren();
        this._outputsBody?.replaceChildren();
    }

    /**
     * Fill one port section with a vertical split: one pane per parameter, then the add toolbar.
     *
     * The panes are content-sized by `graph-settings-view.css` because the section lives in the
     * scrolling settings sheet: the split keeps the form's natural height while still giving every
     * parameter its own collapsible pane and the add action its own trailing pane.
     *
     * @param kind - Which port list to render.
     * @private
     */
    private _rebuildFunctionSection(kind: FunctionPortKind): void {
        const body = kind === 'input' ? this._inputsBody : this._outputsBody;
        if (!body) {
            return;
        }

        const ports = this._functionPorts(kind);
        const views: ViewBase[] = [];

        if (ports.length === 0) {
            views.push(this._createFunctionEmptyView(kind));
        } else {
            ports.forEach((port, index) => {
                views.push(this._createFunctionPortRow(kind, port, index, ports.length));
            });
        }
        views.push(this._createFunctionAddToolbar(kind, ports.length));

        const split = new SplitView({
            orientation: 'vertical',
            minPaneSize: FUNCTION_PORT_HEADER_HEIGHT,
            gap: 0,
            contentInsetStart: FUNCTION_PORT_SPLIT_INSET_START,
            contentInsetTop: FUNCTION_PORT_SPLIT_INSET_TOP,
            contentInsetGuide: true,
            views,
            i18nService: this._i18nService,
            logger: this._logger,
        });
        split.attachTo(body);
        if (kind === 'input') {
            this._inputsSplit = split;
        } else {
            this._outputsSplit = split;
        }
    }

    /**
     * Build the empty-state pane of a port-list split.
     * @param kind - Which port list the message describes.
     * @returns Content view rendering the localized empty-state line.
     * @private
     */
    private _createFunctionEmptyView(kind: FunctionPortKind): ContentView {
        const keys = kind === 'input' ? 'inputs' : 'outputs';
        return new ContentView({
            renderFn: () => {
                const empty = document.createElement('div');
                empty.className =
                    'view-graph-settings__description view-graph-settings__function-empty';
                empty.textContent = this.t(`settings.graph.function.${keys}.empty`);
                return empty;
            },
            i18nService: this._i18nService,
            logger: this._logger,
        });
    }

    /**
     * Build the add-port toolbar that occupies the last pane of a port-list split.
     * @param kind - Which port list the button appends to.
     * @param portCount - Current number of ports, used to disable the button at the limit.
     * @returns Toolbar view holding the localized add button.
     * @private
     */
    private _createFunctionAddToolbar(kind: FunctionPortKind, portCount: number): ToolbarView {
        const keys = kind === 'input' ? 'inputs' : 'outputs';
        const toolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });
        const addButton = new ButtonControl({
            label: this.t(`settings.graph.function.${keys}.add`),
            icon: IconProvider.add,
            iconOnly: true,
        });
        addButton.onClick(() => this._handleAddFunctionPort(kind));
        if (portCount >= MAX_FUNCTION_PORTS) {
            addButton.setDisabled(true);
            addButton.setLabel(
                this.t('settings.graph.function.port.limit', { max: MAX_FUNCTION_PORTS })
            );
        }
        toolbar.addControl(addButton, { className: 'view-graph-settings__port-action' });
        this._functionDisposers.push(() => toolbar.detach());
        return toolbar;
    }

    /**
     * Build one nested, collapsible port row.
     *
     * A row owns its toolbar (move up, move down, delete), the name field with its inline
     * validation message and the type multi-select with the `any` hint. The returned view is not
     * attached here: the caller hands it to the port-list `SplitView`, which owns its pane.
     *
     * @param kind - Which port list the row belongs to.
     * @param port - Declared port to render.
     * @param index - Zero-based position inside the list.
     * @param count - Number of ports in the list, used for the move-button edges.
     * @returns The collapsible row view for the split pane.
     * @private
     */
    private _createFunctionPortRow(
        kind: FunctionPortKind,
        port: FunctionPort,
        index: number,
        count: number
    ): CollapsibleView {
        const fields = document.createElement('div');
        fields.className = 'view-graph-settings__port-fields';

        const toolbarHost = document.createElement('div');
        toolbarHost.className = 'view-graph-settings__port-toolbar';
        fields.appendChild(toolbarHost);

        const toolbar = new ToolbarView({
            i18nService: this._i18nService,
            logger: this._logger,
        });
        const upButton = new ButtonControl({
            label: this.t('settings.graph.function.port.moveUp'),
            icon: IconProvider.arrowUpward,
            iconOnly: true,
            disabled: index === 0,
        });
        upButton.onClick(() => this._handleMoveFunctionPort(kind, index, index - 1));
        const downButton = new ButtonControl({
            label: this.t('settings.graph.function.port.moveDown'),
            icon: IconProvider.arrowDownward,
            iconOnly: true,
            disabled: index === count - 1,
        });
        downButton.onClick(() => this._handleMoveFunctionPort(kind, index, index + 1));
        const removeButton = new ButtonControl({
            label: this.t('settings.graph.function.port.remove'),
            icon: IconProvider.delete,
            iconOnly: true,
        });
        removeButton.onClick(() => this._handleRemoveFunctionPort(kind, port.id));
        for (const button of [upButton, downButton, removeButton]) {
            toolbar.addControl(button, { className: 'view-graph-settings__port-action' });
        }
        toolbar.attachTo(toolbarHost);

        const nameHost = document.createElement('div');
        nameHost.className = 'view-graph-settings__port-name';
        fields.appendChild(nameHost);
        const nameControl = new TextControl({
            label: this.t('settings.graph.function.port.name.label'),
            defaultValue: port.name,
        });
        nameControl.render(nameHost);
        nameHost
            .querySelector('.custom-control__label')
            ?.classList.add('view-graph-settings__label');
        const nameInput = nameHost.querySelector<HTMLInputElement>('input[type="text"]');
        if (nameInput) {
            nameInput.classList.add('view-graph-settings__input');
            nameInput.id = `${this.id}-function-${kind}-${port.id}-name`;
        }

        const nameMessage = document.createElement('div');
        nameMessage.className =
            'view-graph-settings__description view-graph-settings__port-message';
        fields.appendChild(nameMessage);
        nameControl.onChange((value) =>
            this._handleFunctionPortNameChanged(kind, port.id, value, nameMessage)
        );

        const typesHost = document.createElement('div');
        typesHost.className = 'view-graph-settings__port-types';
        fields.appendChild(typesHost);
        const typesControl = new MenuDropdownControl({
            options: this._portTypeOptions,
            value: port.types,
            multiSelect: true,
            showIcons: false,
            showBulkActions: false,
            label: this.t('settings.graph.function.port.types.label'),
            placeholder: this.t('settings.graph.function.port.types.placeholder'),
            i18nService: this._i18nService,
            logger: this._logger,
            onChange: (value) => this._handleFunctionPortTypesChanged(kind, port.id, value),
        });
        typesControl.attachTo(typesHost);

        const anyHint = document.createElement('div');
        anyHint.className = 'view-graph-settings__description view-graph-settings__port-any-hint';
        anyHint.textContent = this.t('settings.graph.function.port.types.anyHint');
        anyHint.hidden = !isAnyPortTypes(port.types);
        fields.appendChild(anyHint);

        let defaultTypeHost: HTMLDivElement | null = null;
        let defaultTypeSelect: HTMLSelectElement | null = null;
        let defaultValueHost: HTMLDivElement | null = null;
        let constraintsHost: HTMLDivElement | null = null;
        const constraintsInputs = {
            min: null as HTMLInputElement | null,
            max: null as HTMLInputElement | null,
            step: null as HTMLInputElement | null,
        };
        let constraintsMessage: HTMLDivElement | null = null;

        if (kind === 'input') {
            // Default type: which declared data type the default value is expressed in.
            defaultTypeHost = document.createElement('div');
            defaultTypeHost.className = 'view-graph-settings__port-default-type';
            const defaultTypeControl = new DropdownControl({
                label: this.t('settings.graph.function.port.default.typeLabel'),
                options: this._portDefaultTypeOptions(port),
                defaultValue: port.default?.type ?? port.types[0],
            }) as RuntimeControl;
            defaultTypeControl.render(defaultTypeHost);
            defaultTypeHost
                .querySelector('.custom-control__label')
                ?.classList.add('view-graph-settings__label');
            defaultTypeSelect = defaultTypeHost.querySelector<HTMLSelectElement>('select');
            if (defaultTypeSelect) {
                defaultTypeSelect.classList.add('view-graph-settings__select');
                defaultTypeSelect.id = `${this.id}-function-${kind}-${port.id}-default-type`;
                defaultTypeSelect.addEventListener('change', () =>
                    this._handleFunctionPortDefaultTypeChanged(
                        kind,
                        port.id,
                        defaultTypeSelect?.value
                    )
                );
            }
            defaultTypeHost.hidden = port.types.length <= 1;
            fields.appendChild(defaultTypeHost);

            // Default value editor, re-rendered in place when its control kind changes.
            defaultValueHost = document.createElement('div');
            defaultValueHost.className = 'view-graph-settings__port-default-value';
            fields.appendChild(defaultValueHost);

            // Numeric bounds, shown only while the default type is numeric.
            constraintsHost = document.createElement('div');
            constraintsHost.className = 'view-graph-settings__port-constraints';
            fields.appendChild(constraintsHost);

            const minControl = new TextControl({
                label: this.t('settings.graph.function.port.default.min'),
                defaultValue: '',
            });
            minControl.render(constraintsHost);
            const maxControl = new TextControl({
                label: this.t('settings.graph.function.port.default.max'),
                defaultValue: '',
            });
            maxControl.render(constraintsHost);
            const stepControl = new TextControl({
                label: this.t('settings.graph.function.port.default.step'),
                defaultValue: '',
            });
            stepControl.render(constraintsHost);

            const constraintInputNodes =
                constraintsHost.querySelectorAll<HTMLInputElement>('input[type="text"]');
            constraintsInputs.min = constraintInputNodes[0] ?? null;
            constraintsInputs.max = constraintInputNodes[1] ?? null;
            constraintsInputs.step = constraintInputNodes[2] ?? null;

            const constraintKeys = ['min', 'max', 'step'] as const;
            constraintKeys.forEach((key, keyIndex) => {
                const input = constraintInputNodes[keyIndex] ?? null;
                if (input) {
                    input.classList.add('view-graph-settings__input');
                    input.id = `${this.id}-function-${kind}-${port.id}-default-${key}`;
                }
            });
            for (const labelElement of constraintsHost.querySelectorAll('.custom-control__label')) {
                labelElement.classList.add('view-graph-settings__label');
            }

            minControl.onChange((value) =>
                this._handleFunctionPortConstraintChanged(kind, port.id, 'min', value)
            );
            maxControl.onChange((value) =>
                this._handleFunctionPortConstraintChanged(kind, port.id, 'max', value)
            );
            stepControl.onChange((value) =>
                this._handleFunctionPortConstraintChanged(kind, port.id, 'step', value)
            );

            constraintsMessage = document.createElement('div');
            constraintsMessage.className =
                'view-graph-settings__description view-graph-settings__port-message';
            constraintsHost.appendChild(constraintsMessage);
            constraintsHost.hidden = !isNumericFunctionPortType(port.default?.type);
        }

        const documentationControl = new MarkdownEditorControl({
            label: this.t('settings.graph.function.port.documentation.label'),
            value: port.documentation ?? '',
            placeholder: this.t('settings.graph.function.port.documentation.placeholder'),
            i18nService: this._i18nService,
            logger: this._logger,
        });
        const docHost = document.createElement('div');
        docHost.className = 'view-graph-settings__port-documentation';
        documentationControl.render(docHost);
        documentationControl.onChange((value) =>
            this._handleFunctionPortDocumentationChanged(kind, port.id, value)
        );
        fields.appendChild(docHost);

        const view = new CollapsibleView({
            headerTitle: port.name || this.t('settings.graph.function.port.untitled'),
            collapsed: this._portCollapsedState.get(port.id) ?? false,
            sizeToContent: true,
            nested: true,
            contentGuide: true,
            headerHeight: FUNCTION_PORT_HEADER_HEIGHT,
            contentView: new ContentView({
                renderFn: () => fields,
                i18nService: this._i18nService,
                logger: this._logger,
            }),
            logger: this._logger,
            i18nService: this._i18nService,
        });

        const row: FunctionPortRow = {
            kind,
            portId: port.id,
            view,
            nameInput,
            nameMessage,
            typesControl,
            anyHint,
            defaultTypeHost,
            defaultTypeSelect,
            defaultValueHost,
            defaultValueInput: null,
            defaultValueControl: null,
            defaultValueControlKind: '',
            constraintsHost,
            constraintsInputs,
            constraintsMessage,
            documentationControl,
        };
        this._functionPortRows.push(row);
        if (defaultValueHost) {
            this._renderPortDefaultValueEditor(defaultValueHost, port, row);
        }
        if (kind === 'input') {
            this._refreshPortDefaultRow(row, port);
        }

        this._functionDisposers.push(() => {
            typesControl.detach();
            documentationControl.detach();
            toolbar.detach();
            view.detach();
        });
        return view;
    }

    /**
     * Re-synchronize row titles, type selections and hints after an in-form edit.
     *
     * The controls stay in place, so a name being typed keeps its focus and caret while the row
     * header and type hints follow along.
     * @private
     */
    private _refreshFunctionRowDetails(): void {
        for (const row of this._functionPortRows) {
            const port = this._functionPorts(row.kind).find((entry) => entry.id === row.portId);
            if (!port) {
                continue;
            }
            row.view.headerTitle = port.name || this.t('settings.graph.function.port.untitled');
            row.typesControl?.setValue(port.types);
            if (row.anyHint) {
                row.anyHint.hidden = !isAnyPortTypes(port.types);
            }
            row.documentationControl?.setValue(port.documentation ?? '');
            if (row.kind === 'input') {
                this._refreshPortDefaultRow(row, port);
            }
        }
    }

    /**
     * Write the category row into the graph.
     * @param value - Raw category text reported by the control.
     * @private
     */
    private _handleFunctionCategoryChanged(value: unknown): void {
        if (!this._graph?.setFunctionCategory) {
            return;
        }

        this._suppressSignatureRefresh = true;
        try {
            this._graph.setFunctionCategory(String(value ?? ''));
        } finally {
            this._suppressSignatureRefresh = false;
        }
    }

    /**
     * Write the icon row into the graph.
     * @param value - Raw icon value reported by the picker.
     * @private
     */
    private _handleFunctionIconChanged(value: unknown): void {
        if (!this._graph?.setFunctionIcon) {
            return;
        }

        this._suppressSignatureRefresh = true;
        try {
            this._graph.setFunctionIcon(String(value ?? ''));
        } finally {
            this._suppressSignatureRefresh = false;
        }
    }

    /**
     * Append a default port and open its row for immediate typing.
     * @param kind - Which port list to extend.
     * @private
     */
    private _handleAddFunctionPort(kind: FunctionPortKind): void {
        const graph = this._graph;
        if (!graph?.addFunctionPort) {
            return;
        }

        let added: { index: number; port: FunctionPort } | null = null;
        this._suppressSignatureRefresh = true;
        try {
            added = graph.addFunctionPort(kind) ?? null;
        } finally {
            this._suppressSignatureRefresh = false;
        }

        this._rebuildFunctionSections();
        if (added) {
            const addedPortId = added.port.id;
            this._functionPortRows
                .find((row) => row.kind === kind && row.portId === addedPortId)
                ?.nameInput?.focus();
        }
    }

    /**
     * Move one port and rebuild the rows in their new order.
     * @param kind - Which list to reorder.
     * @param fromIndex - Current position of the port.
     * @param toIndex - Target position of the port.
     * @private
     */
    private _handleMoveFunctionPort(
        kind: FunctionPortKind,
        fromIndex: number,
        toIndex: number
    ): void {
        const graph = this._graph;
        if (!graph?.moveFunctionPort) {
            return;
        }

        this._suppressSignatureRefresh = true;
        try {
            graph.moveFunctionPort(kind, fromIndex, toIndex);
        } finally {
            this._suppressSignatureRefresh = false;
        }

        this._rebuildFunctionSections();
    }

    /**
     * Remove one port, its row and its saved collapse state.
     * @param kind - Which list to shrink.
     * @param portId - Port id to remove.
     * @private
     */
    private _handleRemoveFunctionPort(kind: FunctionPortKind, portId: string): void {
        const graph = this._graph;
        if (!graph?.removeFunctionPort) {
            return;
        }

        this._suppressSignatureRefresh = true;
        try {
            graph.removeFunctionPort(kind, portId);
        } finally {
            this._suppressSignatureRefresh = false;
        }

        this._rebuildFunctionSections();
        this._portCollapsedState.delete(portId);
    }

    /**
     * Validate and write a port name.
     *
     * Names are required and unique within their list (trimmed, case-sensitive — the same
     * rule phase 5 enforces). An invalid name is reported inline and never reaches the
     * model, so the last valid name stays in the signature.
     *
     * @param kind - Which list the port belongs to.
     * @param portId - Port being edited.
     * @param rawValue - Text reported by the name field.
     * @param message - Inline message element of the row.
     * @private
     */
    private _handleFunctionPortNameChanged(
        kind: FunctionPortKind,
        portId: string,
        rawValue: unknown,
        message: HTMLDivElement
    ): void {
        const ports = this._functionPorts(kind);
        const port = ports.find((entry) => entry.id === portId);
        if (!port) {
            return;
        }

        const name = String(rawValue ?? '').trim();
        if (!name) {
            this._setPortNameMessage(message, 'settings.graph.function.port.name.required');
            return;
        }
        if (ports.some((entry) => entry.id !== portId && entry.name === name)) {
            this._setPortNameMessage(message, 'settings.graph.function.port.name.duplicate');
            return;
        }
        this._setPortNameMessage(message, null);

        const graph = this._graph;
        if (name === port.name || !graph?.updateFunctionPort) {
            return;
        }

        this._suppressSignatureRefresh = true;
        try {
            graph.updateFunctionPort(kind, portId, { name });
        } finally {
            this._suppressSignatureRefresh = false;
        }
        this._refreshFunctionRowDetails();
    }

    /**
     * Write the Markdown documentation of a port into the graph.
     * @param kind - Which list the port belongs to.
     * @param portId - Port being edited.
     * @param value - Markdown source reported by the control.
     * @private
     */
    private _handleFunctionPortDocumentationChanged(
        kind: FunctionPortKind,
        portId: string,
        value: unknown
    ): void {
        const port = this._functionPorts(kind).find((entry) => entry.id === portId);
        const graph = this._graph;
        if (!port || !graph?.updateFunctionPort) {
            return;
        }

        const documentation = String(value ?? '');
        if (documentation === (port.documentation ?? '')) {
            return;
        }

        this._suppressSignatureRefresh = true;
        try {
            graph.updateFunctionPort(kind, portId, { documentation });
        } finally {
            this._suppressSignatureRefresh = false;
        }
        this._refreshFunctionRowDetails();
    }

    /**
     * Normalize and write the type union of a port.
     * @param kind - Which list the port belongs to.
     * @param portId - Port being edited.
     * @param value - Values reported by the multi-select after the edit.
     * @private
     */
    private _handleFunctionPortTypesChanged(
        kind: FunctionPortKind,
        portId: string,
        value: unknown
    ): void {
        const port = this._functionPorts(kind).find((entry) => entry.id === portId);
        const graph = this._graph;
        if (!port || !graph?.updateFunctionPort) {
            return;
        }

        const types = normalizePortTypeSelection(value, port.types);
        this._suppressSignatureRefresh = true;
        try {
            graph.updateFunctionPort(kind, portId, { types });
        } finally {
            this._suppressSignatureRefresh = false;
        }
        this._refreshFunctionRowDetails();
    }

    /**
     * Show or clear the inline message under a port name field.
     * @param message - Message element of the row.
     * @param key - Locale key to show, or `null` to clear the message.
     * @private
     */
    private _setPortNameMessage(message: HTMLDivElement, key: string | null): void {
        message.textContent = key ? this.t(key) : '';
        message.classList.toggle('view-graph-settings__description--error', Boolean(key));
    }

    /**
     * Find a rendered port row by list and port id.
     * @param kind - Which port list the row belongs to.
     * @param portId - Port id of the row.
     * @returns The row, or `null` when it is not currently rendered.
     */
    private _findFunctionPortRow(kind: FunctionPortKind, portId: string): FunctionPortRow | null {
        return (
            this._functionPortRows.find(
                (entry) => entry.kind === kind && entry.portId === portId
            ) ?? null
        );
    }

    /**
     * Build the single-select options for a port's default type.
     * @param port - Declared input port.
     * @returns One option per declared type, labelled like the type multi-select.
     */
    private _portDefaultTypeOptions(port: FunctionPort): Array<{ value: string; label: string }> {
        return this._portTypeOptions
            .filter((option) => port.types.includes(option.value))
            .map((option) => ({ value: option.value, label: option.label }));
    }

    /**
     * Render the default-value editor into a row's value host.
     *
     * The editor kind follows the default's data type (`number` / `checkbox` / `text`) and
     * is re-rendered in place whenever that kind changes; the stored value is pushed back
     * into the graph through the shared handler.
     *
     * @param host - Persistent host element of the row.
     * @param port - Declared input port.
     * @param row - Row the editor belongs to.
     */
    private _renderPortDefaultValueEditor(
        host: HTMLDivElement,
        port: FunctionPort,
        row: FunctionPortRow
    ): void {
        host.replaceChildren();

        const defaultValue = port.default ?? { type: port.types[0] ?? 'any', value: '' };
        const controlType = resolveFunctionPortDefaultControlType(defaultValue.type);
        const label = this.t('settings.graph.function.port.default.valueLabel');

        let control: RuntimeValueControl;
        if (controlType === 'number') {
            control = new NumberControl({
                label,
                defaultValue: typeof defaultValue.value === 'number' ? defaultValue.value : 0,
                min: typeof defaultValue.min === 'number' ? defaultValue.min : undefined,
                max: typeof defaultValue.max === 'number' ? defaultValue.max : undefined,
                step: typeof defaultValue.step === 'number' ? defaultValue.step : undefined,
            }) as unknown as RuntimeValueControl;
        } else if (controlType === 'checkbox') {
            control = new CheckboxControl({
                label,
                defaultValue: defaultValue.value === true,
            }) as unknown as RuntimeValueControl;
        } else {
            control = new TextControl({
                label,
                defaultValue:
                    typeof defaultValue.value === 'string'
                        ? defaultValue.value
                        : String(defaultValue.value ?? ''),
            }) as unknown as RuntimeValueControl;
        }

        control.render(host);
        row.defaultValueControl = control;
        row.defaultValueControlKind = controlType;

        const labelElement =
            host.querySelector('.custom-control__label') ??
            host.querySelector('.custom-control__checkbox-label');
        labelElement?.classList.add('view-graph-settings__label');

        const input = host.querySelector<HTMLInputElement>('input');
        if (input) {
            input.classList.add(
                controlType === 'checkbox'
                    ? 'view-graph-settings__checkbox'
                    : 'view-graph-settings__input'
            );
            input.id = `${this.id}-function-${row.kind}-${row.portId}-default-value`;
        }
        row.defaultValueInput = input;

        if (input && controlType === 'number') {
            // Snap the visible text to the stored (already clamped) value on blur, mirroring
            // the canvas editor: intermediate out-of-range text is allowed while the field is
            // focused, and the committed value takes over once the user leaves it.
            input.addEventListener('blur', () => {
                const current = this._functionPorts(row.kind).find(
                    (entry) => entry.id === row.portId
                );
                const currentDefault = current?.default;
                if (
                    currentDefault &&
                    resolveFunctionPortDefaultControlType(currentDefault.type) === 'number'
                ) {
                    input.value = String(currentDefault.value ?? '');
                }
            });
        }

        control.onChange?.((value) =>
            this._handleFunctionPortDefaultValueChanged(row.kind, row.portId, value)
        );
    }

    /**
     * Re-synchronize one row's default type, value editor and bounds from the model.
     *
     * The value editor is re-rendered only when its control kind changed, and the raw input
     * values are left untouched while they hold focus so typing is never interrupted.
     *
     * @param row - Row to refresh.
     * @param port - Declared port backing the row.
     */
    private _refreshPortDefaultRow(row: FunctionPortRow, port: FunctionPort): void {
        const defaultValue = port.default;
        if (!defaultValue) {
            return;
        }

        if (row.defaultTypeHost && row.defaultTypeSelect) {
            const options = this._portDefaultTypeOptions(port);
            row.defaultTypeSelect.replaceChildren();
            options.forEach((option) => {
                const element = document.createElement('option');
                element.value = option.value;
                element.textContent = option.label;
                if (option.value === defaultValue.type) {
                    element.selected = true;
                }
                row.defaultTypeSelect?.appendChild(element);
            });
            row.defaultTypeHost.hidden = port.types.length <= 1;
        }

        const controlType = resolveFunctionPortDefaultControlType(defaultValue.type);
        if (row.defaultValueHost && controlType !== row.defaultValueControlKind) {
            this._renderPortDefaultValueEditor(row.defaultValueHost, port, row);
        } else if (row.defaultValueInput) {
            const input = row.defaultValueInput;
            if (input.type === 'checkbox') {
                input.checked = defaultValue.value === true;
            } else if (document.activeElement !== input) {
                input.value = String(defaultValue.value ?? '');
            }
        }

        if (row.constraintsHost) {
            const show = isNumericFunctionPortType(defaultValue.type);
            row.constraintsHost.hidden = !show;
            if (show) {
                const { min, max, step } = row.constraintsInputs;
                if (min && document.activeElement !== min) {
                    min.value = defaultValue.min !== undefined ? String(defaultValue.min) : '';
                }
                if (max && document.activeElement !== max) {
                    max.value = defaultValue.max !== undefined ? String(defaultValue.max) : '';
                }
                if (step && document.activeElement !== step) {
                    step.value = defaultValue.step !== undefined ? String(defaultValue.step) : '';
                }
            }
        }
        this._clearPortConstraintMessage(row);
    }

    /**
     * Show or clear the inline message under a row's constraint fields.
     * @param row - Row whose message is shown.
     * @param key - Locale key to show, or `null` to clear the message.
     * @param params - Optional interpolation parameters.
     */
    private _setPortConstraintMessage(
        row: FunctionPortRow | null,
        key: string | null,
        params?: Record<string, unknown>
    ): void {
        if (!row?.constraintsMessage) {
            return;
        }
        row.constraintsMessage.textContent = key ? this.t(key, params) : '';
        row.constraintsMessage.classList.toggle(
            'view-graph-settings__description--error',
            Boolean(key)
        );
    }

    /**
     * Clear the inline message under a row's constraint fields.
     * @param row - Row whose message is cleared.
     */
    private _clearPortConstraintMessage(row: FunctionPortRow): void {
        this._setPortConstraintMessage(row, null);
    }

    /**
     * Validate and write a numeric bound (min / max / step).
     *
     * An empty value clears the bound; a non-numeric value, a non-positive step or an
     * inverted min/max pair is reported inline and never written.
     *
     * @param kind - Which port list the row belongs to.
     * @param portId - Port being edited.
     * @param key - Which bound changed.
     * @param rawValue - Text reported by the bound field.
     */
    private _handleFunctionPortConstraintChanged(
        kind: FunctionPortKind,
        portId: string,
        key: 'min' | 'max' | 'step',
        rawValue: string
    ): void {
        const port = this._functionPorts(kind).find((entry) => entry.id === portId);
        const row = this._findFunctionPortRow(kind, portId);
        if (!port || !port.default) {
            return;
        }

        const trimmed = rawValue.trim();
        if (trimmed === '') {
            this._commitFunctionPortDefault(kind, portId, { [key]: undefined });
            return;
        }

        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) {
            this._setPortConstraintMessage(
                row,
                'settings.graph.function.port.default.invalidNumber'
            );
            return;
        }
        if (key === 'step' && numeric <= 0) {
            this._setPortConstraintMessage(row, 'settings.graph.function.port.default.invalidStep');
            return;
        }

        const nextDefault: FunctionPortDefault = { ...port.default, [key]: numeric };
        if (
            typeof nextDefault.min === 'number' &&
            typeof nextDefault.max === 'number' &&
            nextDefault.min > nextDefault.max
        ) {
            this._setPortConstraintMessage(
                row,
                'settings.graph.function.port.default.invalidBounds'
            );
            return;
        }

        this._commitFunctionPortDefault(kind, portId, { [key]: numeric });
    }

    /**
     * Write the chosen default type, re-coercing the value through the model.
     *
     * @param kind - Which port list the row belongs to.
     * @param portId - Port being edited.
     * @param rawValue - Selected type id.
     */
    private _handleFunctionPortDefaultTypeChanged(
        kind: FunctionPortKind,
        portId: string,
        rawValue: unknown
    ): void {
        const port = this._functionPorts(kind).find((entry) => entry.id === portId);
        const graph = this._graph;
        if (!port || !port.default || !graph?.updateFunctionPort) {
            return;
        }

        const type =
            typeof rawValue === 'string' && port.types.includes(rawValue)
                ? rawValue
                : port.default.type;
        if (type === port.default.type) {
            return;
        }

        this._commitFunctionPortDefault(kind, portId, { type, value: port.default.value });
    }

    /**
     * Write a default value, clamping out-of-range numbers into their `min`/`max` bounds.
     *
     * `min`/`max` are hard constraints: a committed value never lands outside them, so the
     * stored default, the editor and the emitted firmware always agree. `step` is deliberately
     * ignored — it is a UI increment hint, not a value constraint.
     *
     * @param kind - Which port list the row belongs to.
     * @param portId - Port being edited.
     * @param value - Value reported by the editor.
     */
    private _handleFunctionPortDefaultValueChanged(
        kind: FunctionPortKind,
        portId: string,
        value: unknown
    ): void {
        const port = this._functionPorts(kind).find((entry) => entry.id === portId);
        const row = this._findFunctionPortRow(kind, portId);
        if (!port || !port.default) {
            return;
        }

        if (resolveFunctionPortDefaultControlType(port.default.type) === 'number') {
            // `NumberControl` reports `0` for anything it cannot parse, so the raw text is the
            // only reliable signal that the field is empty or mid-way through a negative or
            // decimal literal; keep the previous value in those cases.
            const rawText = row?.defaultValueInput?.value.trim() ?? '';
            if (rawText === '' || !Number.isFinite(Number(rawText))) {
                return;
            }

            const numeric = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(numeric)) {
                return;
            }

            const { min, max } = port.default;
            let clamped = numeric;
            if (typeof min === 'number') {
                clamped = Math.max(clamped, min);
            }
            if (typeof max === 'number') {
                clamped = Math.min(clamped, max);
            }

            this._commitFunctionPortDefault(kind, portId, { value: clamped });
            return;
        }

        this._commitFunctionPortDefault(kind, portId, { value });
    }

    /**
     * Write a merged default object into the graph and refresh the row in place.
     *
     * Bounds are dropped when the default type is no longer numeric, mirroring the model's
     * normalizer. The signature refresh is suppressed so the active control keeps focus.
     *
     * @param kind - Which port list the row belongs to.
     * @param portId - Port being edited.
     * @param patch - Fields to merge over the current default.
     */
    private _commitFunctionPortDefault(
        kind: FunctionPortKind,
        portId: string,
        patch: Partial<FunctionPortDefault>
    ): void {
        const port = this._functionPorts(kind).find((entry) => entry.id === portId);
        const graph = this._graph;
        if (!port || !port.default || !graph?.updateFunctionPort) {
            return;
        }

        const nextDefault: FunctionPortDefault = { ...port.default, ...patch };
        if (!isNumericFunctionPortType(nextDefault.type)) {
            delete nextDefault.min;
            delete nextDefault.max;
            delete nextDefault.step;
        }

        this._suppressSignatureRefresh = true;
        try {
            graph.updateFunctionPort(kind, portId, { default: nextDefault });
        } finally {
            this._suppressSignatureRefresh = false;
        }
        this._refreshFunctionRowDetails();
    }

    /**
     * Rebuild the interrupt-name dropdown from the collection's declared names.
     *
     * A stale current value that is no longer declared anywhere is kept as one extra
     * option so the user can still see (and change) the graph's current selection.
     *
     * @param currentTriggerName - The graph's current trigger name, trimmed.
     * @param hasGraph - Whether a graph is bound to the view.
     * @private
     */
    private _refreshTriggerOptions(currentTriggerName: string, hasGraph: boolean): void {
        if (!this._triggerSelect) {
            return;
        }

        this._triggerSelect.replaceChildren();

        const names = collectIrqTriggerNames(
            this._collection as unknown as Parameters<typeof collectIrqTriggerNames>[0],
            this._graph as unknown as Parameters<typeof collectIrqTriggerNames>[1]
        );

        if (currentTriggerName && !names.includes(currentTriggerName)) {
            names.push(currentTriggerName);
        }

        names.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === currentTriggerName) {
                option.selected = true;
            }
            this._triggerSelect?.appendChild(option);
        });

        this._triggerSelect.disabled = !hasGraph || names.length === 0;
    }

    private _handleTriggerNameChanged(nextName: unknown): void {
        if (!this._graph) {
            return;
        }

        const normalized = normalizeTriggerName(nextName);
        const current = normalizeTriggerName(this._graph.getTriggerName?.());
        if (!normalized) {
            this._refreshTriggerOptions(current, true);
            return;
        }
        if (normalized !== current) {
            this._graph.setTriggerName?.(normalized);
        }
    }

    private _handleGraphNameCommit(): void {
        if (!this._graph || !this._nameInput) {
            return;
        }

        const nextValue = this._nameInput.value.trim();
        if (!nextValue) {
            this._nameInput.value = this._graph.getName();
            return;
        }

        if (nextValue !== this._graph.getName()) {
            this._graph.setName(nextValue);
        }
    }

    private _handleEnabledChanged(nextEnabled: unknown): void {
        if (!this._graph || typeof this._graph.setEnabled !== 'function') {
            return;
        }

        const normalized = normalizeGraphEnabled(nextEnabled);
        const current = normalizeGraphEnabled(this._graph.getEnabled?.());
        if (normalized !== current) {
            this._graph.setEnabled(normalized);
        }
    }

    private _handleExecutionTypeChanged(nextExecutionType: unknown): void {
        if (!this._graph) {
            return;
        }

        const normalized = normalizeExecutionType(nextExecutionType);
        const current = normalizeExecutionType(this._graph.getExecutionType?.());
        if (normalized !== current) {
            this._graph.setExecutionType(normalized);
        }

        this._updateSleepVisibility(normalized);
        this._updateTriggerVisibility(normalized);
        this._updateSignalsVisibility(normalized);
        this._refreshFunctionControls(normalized);
    }

    private _commitSignalNames(next: string[]): void {
        if (!this._graph || typeof this._graph.setSignalNames !== 'function') {
            return;
        }
        this._graph.setSignalNames(next);
    }

    private _currentSignalNames(): string[] {
        const names = this._graph?.getSignalNames?.();
        return Array.isArray(names) ? (names as string[]) : [];
    }

    private _declaredSignalNames(): string[] {
        return collectSignalNames(
            this._collection as unknown as Parameters<typeof collectSignalNames>[0],
            this._graph as unknown as Parameters<typeof collectSignalNames>[1]
        );
    }

    /**
     * Rebuild the signals multi-select from the collection's declared names.
     *
     * A stored name the collection no longer produces is still offered (and stays ticked),
     * so a stale selection stays visible until the user changes it; the warning text marks
     * it. The option list is rebuilt only when it changed, so an open menu keeps its state
     * on unrelated refreshes.
     */
    private _refreshSignalDropdown(): void {
        if (!this._signalDropdown) {
            return;
        }
        const selected = normalizeSignalNames(this._currentSignalNames());
        const optionNames = this._signalOptionNames(selected);
        if (!this._sameSignalOptions(optionNames)) {
            this._signalOptionValues = optionNames;
            this._signalDropdown.setOptions(
                optionNames.map((name): DropdownOption => ({ value: name, label: name }))
            );
        }
        this._signalDropdown.setValue(selected);
        this._signalDropdown.setDisabled(!this._graph);
        this._refreshSignalMessage(selected);
    }

    /**
     * Option values for the signals picker: every declared name plus any ticked name.
     * @param selected - Ticked names that must stay offered even when unproduced.
     * @returns De-duplicated names in a stable locale order.
     */
    private _signalOptionNames(selected: string[]): string[] {
        const declared = this._declaredSignalNames();
        return Array.from(new Set([...declared, ...selected])).sort((left, right) =>
            left.localeCompare(right)
        );
    }

    /**
     * Whether a freshly computed option list matches the rendered one.
     * @param names - Candidate option values.
     * @returns True when the dropdown already offers exactly these values.
     */
    private _sameSignalOptions(names: string[]): boolean {
        return (
            names.length === this._signalOptionValues.length &&
            names.every((name, index) => name === this._signalOptionValues[index])
        );
    }

    /**
     * Show the empty-selection error or the unproduced-name warning on the signals group.
     * @param selected - The graph's current watched names.
     */
    private _refreshSignalMessage(selected: string[]): void {
        if (!this._signalMessage) {
            return;
        }
        const isEvent = normalizeExecutionType(this._graph?.getExecutionType?.()) === 'event';
        const reset = (): void => {
            this._signalMessage?.classList.remove('view-graph-settings__description--error');
            this._signalMessage?.classList.remove('view-graph-settings__description--warning');
        };

        if (!this._graph || !isEvent) {
            reset();
            this._signalMessage.textContent = this.t('settings.graph.signals.description');
            return;
        }
        if (selected.length === 0) {
            reset();
            this._signalMessage.textContent = this.t('settings.graph.signals.emptyError');
            this._signalMessage.classList.add('view-graph-settings__description--error');
            return;
        }
        const declared = this._declaredSignalNames();
        const unproduced = selected.filter((name) => !declared.includes(name));
        if (unproduced.length > 0) {
            reset();
            this._signalMessage.textContent = this.t('settings.graph.signals.unknownProducer', {
                name: unproduced[0],
            });
            this._signalMessage.classList.add('view-graph-settings__description--warning');
            return;
        }
        reset();
        this._signalMessage.textContent = this.t('settings.graph.signals.description');
    }

    /**
     * Write the picker's selection to the graph when it actually changed.
     * @param value - Selected values reported by the dropdown.
     */
    private _handleSignalSelectionChanged(value: unknown): void {
        if (!this._graph) {
            return;
        }
        const next = normalizeSignalNames(value);
        const current = normalizeSignalNames(this._currentSignalNames());
        const unchanged =
            next.length === current.length && next.every((name, index) => name === current[index]);
        if (!unchanged) {
            this._commitSignalNames(next);
        }
    }

    private _handleModeChanged(value: unknown): void {
        if (!this._graph || typeof this._graph.setSignalMode !== 'function') {
            return;
        }
        const normalized = normalizeSignalMode(value);
        if (normalized !== normalizeSignalMode(this._graph.getSignalMode?.())) {
            this._graph.setSignalMode(normalized);
        }
    }

    private _handleRunOnStartChanged(checked: boolean): void {
        if (!this._graph || typeof this._graph.setRunOnStart !== 'function') {
            return;
        }
        if (checked !== Boolean(this._graph.getRunOnStart?.())) {
            this._graph.setRunOnStart(checked);
        }
    }

    private _updateSignalsVisibility(executionType: ExecutionType): void {
        const showSignals = EXECUTION_FIELD_VISIBILITY[executionType].includes('signals');
        if (this._signalsGroup) {
            this._signalsGroup.style.display = showSignals ? '' : 'none';
        }
        if (this._modeGroup) {
            this._modeGroup.style.display = showSignals ? '' : 'none';
        }
        if (this._runOnStartGroup) {
            this._runOnStartGroup.style.display = showSignals ? '' : 'none';
        }
    }

    private _handleSleepDurationCommit(): void {
        if (!this._graph || !this._sleepInput) {
            return;
        }

        const rawValue = this._sleepInput.value.trim();
        if (rawValue === '') {
            this._sleepInput.value = String(clampSleepDuration(this._graph.getTriggerInterval()));
            return;
        }

        const normalized = clampSleepDuration(rawValue);
        if (normalized !== this._graph.getTriggerInterval()) {
            this._graph.setTriggerInterval(normalized);
        }
        this._sleepInput.value = String(normalized);
    }

    serialize(): GraphSettingsViewSerialized {
        return {
            ...super.serialize(),
            type: 'GraphSettingsView',
        } as GraphSettingsViewSerialized;
    }

    static deserialize(
        data: GraphSettingsViewDeserializeData = {},
        viewFactory: ((childData: unknown) => unknown) | null = null,
        context: GraphSettingsViewDeserializeContext = {}
    ): GraphSettingsView {
        void viewFactory;

        const { title = null, icon = 'settings', id = null } = data;
        const { collectionManager = null, i18nService = null, logger = null } = context;
        if (!collectionManager) {
            throw new Error('GraphSettingsView requires collectionManager in deserialize context');
        }

        return new GraphSettingsView({
            collectionManager,
            i18nService,
            title,
            icon,
            id,
            logger,
        });
    }
}
