// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * @file jsdom tests for the function block of the graph settings view.
 *
 * A function graph declares its signature in the settings form: one category row, an
 * inputs section and an outputs section, each holding reorderable port rows. The tests
 * drive the rendered controls and assert the phase-2 graph API calls behind them, the
 * inline validation, the `any` exclusivity, the cap-disabled add button and the localized
 * type options. The two port sections are panes of the settings split, so the tests also
 * assert that split layout.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AppEvent, AppPayload } from '../../src/micro_otter/nodes/html/js/core/app-event.js';
import { GraphSettingsView } from '../../src/micro_otter/nodes/html/js/views/graph-settings-view.js';
import {
    DEFAULT_FUNCTION_ICON,
    MAX_FUNCTION_PORTS,
    normalizeFunctionPort,
    normalizeFunctionPorts,
} from '../../src/micro_otter/nodes/html/js/data/graph-function-signature.js';

/** Strings the view asks for; a missing key would otherwise surface as the raw key. */
const TRANSLATIONS = {
    'settings.graph.title': 'Graph Settings',
    'settings.graph.name.label': 'Graph Name',
    'settings.graph.enabled.label': 'Enabled',
    'settings.graph.executionType.label': 'Execution Type',
    'settings.graph.executionType.startup': 'Run once on startup',
    'settings.graph.executionType.continuous': 'Run continuously in loop',
    'settings.graph.executionType.irq': 'Run once per interrupt',
    'settings.graph.executionType.event': 'Run on signal',
    'settings.graph.executionType.function': 'Provide as callable function',
    'settings.graph.sleepDuration.label': 'Interval (ms)',
    'settings.graph.sleepDuration.description': 'Time between loop iterations.',
    'settings.graph.triggerName.label': 'Interrupt',
    'settings.graph.triggerName.description': 'Interrupt input whose edges run this graph.',
    'settings.graph.signals.label': 'Signals',
    'settings.graph.signals.listLabel': 'Watched signals',
    'settings.graph.signals.description': 'Pick the signals that run this graph.',
    'settings.graph.signals.mode.label': 'Trigger mode',
    'settings.graph.signals.mode.any': 'Any',
    'settings.graph.signals.mode.all': 'All',
    'settings.graph.signals.runOnStart.label': 'Run once at startup',
    'settings.graph.function.category.label': 'Category',
    'settings.graph.function.icon.label': 'Icon',
    'settings.graph.function.icon.hint': 'Type or pick an MDI icon, e.g. mdi:function',
    'settings.graph.function.description.label': 'Description',
    'settings.graph.function.description.placeholder': 'Describe what this function does…',
    'controls.iconPicker.hint': 'Type to filter, e.g. thermometer or user (alias)',
    'controls.markdownEditor.edit': 'Edit',
    'controls.markdownEditor.done': 'Done',
    'controls.markdownEditor.empty': 'No description yet.',
    'settings.graph.function.inputs.title': 'Inputs',
    'settings.graph.function.inputs.add': 'Add input',
    'settings.graph.function.inputs.empty': 'No inputs declared.',
    'settings.graph.function.outputs.title': 'Outputs',
    'settings.graph.function.outputs.add': 'Add output',
    'settings.graph.function.outputs.empty': 'No outputs declared.',
    'settings.graph.function.port.name.label': 'Name',
    'settings.graph.function.port.name.required': 'A port name is required.',
    'settings.graph.function.port.name.duplicate': 'Another port already uses this name.',
    'settings.graph.function.port.types.label': 'Data types',
    'settings.graph.function.port.types.placeholder': 'Pick data types',
    'settings.graph.function.port.types.anyHint': '"Any" accepts every data type.',
    'settings.graph.function.port.documentation.label': 'Documentation',
    'settings.graph.function.port.documentation.placeholder': 'Describe this port…',
    'settings.graph.function.port.default.typeLabel': 'Default type',
    'settings.graph.function.port.default.valueLabel': 'Default value',
    'settings.graph.function.port.default.min': 'Min',
    'settings.graph.function.port.default.max': 'Max',
    'settings.graph.function.port.default.step': 'Step (UI)',
    'settings.graph.function.port.default.invalidNumber': 'Enter a number.',
    'settings.graph.function.port.default.invalidStep': 'Step must be greater than 0.',
    'settings.graph.function.port.default.invalidBounds': 'Min must not exceed max.',
    'settings.graph.function.port.moveUp': 'Move up',
    'settings.graph.function.port.moveDown': 'Move down',
    'settings.graph.function.port.remove': 'Delete port',
    'settings.graph.function.port.untitled': 'Untitled port',
    'settings.graph.function.port.limit': 'A list holds at most {{max}} ports.',
};

/** German overrides for the strings a language switch must re-translate. */
const DE_TRANSLATIONS = {
    'settings.graph.function.category.label': 'Kategorie',
    'settings.graph.function.inputs.title': 'Eingaben',
    'settings.graph.function.outputs.title': 'Ausgaben',
    'settings.graph.function.port.untitled': 'Unbenannter Port',
};

class MockPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

class MockGraph {
    constructor({ id = 'graph-1', name = 'Scale Values', executionType = 'function' } = {}) {
        this._id = id;
        this._name = name;
        this._executionType = executionType;
        this._category = 'function';
        this._icon = DEFAULT_FUNCTION_ICON;
        this._description = '';
        this._inputs = [];
        this._outputs = [];
        this._intervalMs = 500;
        this._listeners = new Set();
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockGraph only supports wildcard listeners in tests');
        }
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(
            name,
            new MockPayload(payloadTypeId, { graphId: this._id, ...detail })
        );
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    getId() {
        return this._id;
    }

    getName() {
        return this._name;
    }

    setName(name) {
        this._name = name;
        this._emit('name', 'NodeGraph.NameChanged.v1', { name });
    }

    getEnabled() {
        return true;
    }

    getExecutionType() {
        return this._executionType;
    }

    setExecutionType(executionType) {
        this._executionType = executionType;
        this._emit('executionType', 'NodeGraph.ExecutionTypeChanged.v1', { executionType });
    }

    getTriggerName() {
        return '';
    }

    setTriggerName(triggerName) {
        this._emit('triggerName', 'NodeGraph.TriggerNameChanged.v1', { triggerName });
    }

    getSignalNames() {
        return [];
    }

    setSignalNames(signalNames) {
        this._emit('signalTrigger', 'NodeGraph.SignalTriggerChanged.v1', {
            signalNames,
            signalMode: 'any',
            runOnStart: true,
        });
    }

    getSignalMode() {
        return 'any';
    }

    setSignalMode(signalMode) {
        this._emit('signalTrigger', 'NodeGraph.SignalTriggerChanged.v1', {
            signalNames: [],
            signalMode,
            runOnStart: true,
        });
    }

    getRunOnStart() {
        return true;
    }

    setRunOnStart(runOnStart) {
        this._emit('signalTrigger', 'NodeGraph.SignalTriggerChanged.v1', {
            signalNames: [],
            signalMode: 'any',
            runOnStart,
        });
    }

    getTriggerInterval() {
        return this._intervalMs;
    }

    setTriggerInterval(intervalMs) {
        this._intervalMs = intervalMs;
        this._emit('interval', 'NodeGraph.IntervalChanged.v1', { triggerIntervalMs: intervalMs });
    }

    getNodes() {
        return [];
    }

    getFunctionSignature() {
        const signature = {
            category: this._category,
            icon: this._icon,
            inputs: this._inputs,
            outputs: this._outputs,
        };
        if (this._description) {
            signature.description = this._description;
        }
        return signature;
    }

    getFunctionCategory() {
        return this._category;
    }

    setFunctionCategory(category) {
        const normalized = String(category ?? '').trim() || 'function';
        if (normalized === this._category) {
            return;
        }
        this._category = normalized;
        this._emitSignature();
    }

    getFunctionIcon() {
        return this._icon;
    }

    setFunctionIcon(icon) {
        const normalized = String(icon ?? '').trim() || DEFAULT_FUNCTION_ICON;
        if (normalized === this._icon) {
            return;
        }
        this._icon = normalized;
        this._emitSignature();
    }

    getFunctionDescription() {
        return this._description;
    }

    setFunctionDescription(description) {
        const normalized = String(description ?? '').trim();
        if (normalized === this._description) {
            return;
        }
        this._description = normalized;
        this._emitSignature();
    }

    _list(kind) {
        return kind === 'output' ? this._outputs : this._inputs;
    }

    _emitSignature() {
        this._emit('functionSignature', 'NodeGraph.FunctionSignatureChanged.v1', {
            functionSignature: this.getFunctionSignature(),
        });
    }

    addFunctionPort(kind, port = null) {
        const ports = this._list(kind);
        if (ports.length >= MAX_FUNCTION_PORTS) {
            return null;
        }
        const added = normalizeFunctionPort(port, kind, ports.length);
        ports.push(added);
        this._emitSignature();
        return { index: ports.length - 1, port: { ...added } };
    }

    updateFunctionPort(kind, portId, patch = {}) {
        const ports = this._list(kind);
        const index = ports.findIndex((port) => port.id === portId);
        if (index === -1) {
            return null;
        }
        ports[index] = normalizeFunctionPort({ ...ports[index], ...patch }, kind, index);
        this._emitSignature();
        return { ...ports[index] };
    }

    removeFunctionPort(kind, portId) {
        const ports = this._list(kind);
        const index = ports.findIndex((port) => port.id === portId);
        if (index === -1) {
            return null;
        }
        const [removed] = ports.splice(index, 1);
        this._list(kind).splice(0, ports.length, ...normalizeFunctionPorts(ports, kind));
        this._emitSignature();
        return { index, port: removed };
    }

    moveFunctionPort(kind, fromIndex, toIndex) {
        const ports = this._list(kind);
        if (fromIndex < 0 || fromIndex >= ports.length || toIndex < 0 || toIndex >= ports.length) {
            return false;
        }
        const [moved] = ports.splice(fromIndex, 1);
        ports.splice(toIndex, 0, moved);
        this._list(kind).splice(0, ports.length, ...normalizeFunctionPorts(ports, kind));
        this._emitSignature();
        return true;
    }
}

class MockCollection {
    constructor(graphs = []) {
        this._graphs = graphs;
        this._activeGraphIdx = 0;
        this._listeners = new Set();
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollection only supports wildcard listeners in tests');
        }
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    getActiveGraph() {
        return this._graphs[this._activeGraphIdx];
    }

    getGraphArray() {
        return this._graphs;
    }

    getAllDataTypes() {
        return [
            { id: 'any', definition: { name: { en: 'Any', de: 'Beliebig' } } },
            { id: 'bool', definition: { name: { en: 'Boolean', de: 'Boolean' } } },
            { id: 'float', definition: { name: { en: 'Float', de: 'Kommazahl' } } },
            { id: 'int', definition: { name: { en: 'Integer', de: 'Ganzzahl' } } },
            { id: 'string', definition: { name: { en: 'String', de: 'Zeichenkette' } } },
        ];
    }
}

class MockCollectionManager {
    constructor() {
        this._activeCollection = null;
        this._listeners = new Set();
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollectionManager only supports wildcard listeners in tests');
        }
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    getActiveCollection() {
        return this._activeCollection;
    }

    setActiveCollection(collection) {
        this._activeCollection = collection;
    }
}

class MockI18nService {
    constructor() {
        this._language = 'en';
        this._listeners = new Map();
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

    getCurrentLanguage() {
        return this._language;
    }

    setLanguage(language) {
        this._language = language;
        for (const listener of this._listeners.get('languagechange') ?? []) {
            listener({ type: 'languagechange', detail: { language } });
        }
    }

    t(key, params) {
        const overrides = this._language === 'de' ? DE_TRANSLATIONS : null;
        const raw = overrides?.[key] ?? TRANSLATIONS[key] ?? key;
        if (!params || typeof params !== 'object') {
            return raw;
        }
        return raw.replace(/\{\{(\w+)\}\}/g, (match, name) => String(params[name] ?? match));
    }
}

describe('GraphSettingsView function ports', () => {
    let dom;
    let container;
    let collectionManager;
    let i18nService;
    let graph;
    let collection;

    /**
     * Point the shared DOM globals at a fresh window and create the mock graph.
     * @returns {void}
     */
    function setupDom() {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.HTMLElement = dom.window.HTMLElement;
        global.HTMLInputElement = dom.window.HTMLInputElement;
        global.HTMLSelectElement = dom.window.HTMLSelectElement;
        global.HTMLButtonElement = dom.window.HTMLButtonElement;
        global.Node = dom.window.Node;
        global.MouseEvent = dom.window.MouseEvent;
        global.KeyboardEvent = dom.window.KeyboardEvent;
        global.EventTarget = dom.window.EventTarget;
        global.CustomEvent = dom.window.CustomEvent;
        // Run immediately: the dropdown positions its menu through `requestAnimationFrame`,
        // and a queued timer would fire after `afterEach` cleared `window`.
        global.requestAnimationFrame = (callback) => {
            callback(0);
            return 0;
        };
        global.cancelAnimationFrame = () => {};
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }

    beforeEach(() => {
        setupDom();
        container = document.createElement('div');
        document.body.appendChild(container);

        i18nService = new MockI18nService();
        graph = new MockGraph({ executionType: 'startup' });
        collection = new MockCollection([graph]);
        collectionManager = new MockCollectionManager();
        collectionManager.setActiveCollection(collection);
    });

    afterEach(() => {
        global.window = undefined;
        global.document = undefined;
        global.HTMLElement = undefined;
        global.HTMLInputElement = undefined;
        global.HTMLSelectElement = undefined;
        global.HTMLButtonElement = undefined;
        global.Node = undefined;
        global.MouseEvent = undefined;
        global.KeyboardEvent = undefined;
        global.EventTarget = undefined;
        global.CustomEvent = undefined;
        global.requestAnimationFrame = undefined;
        global.cancelAnimationFrame = undefined;
        global.ResizeObserver = undefined;
        dom.window.close();
    });

    /** Attach a settings view to a function graph and return it. */
    function attachFunctionView() {
        graph._executionType = 'function';
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);
        return view;
    }

    /** The settings split host that stacks the general pane and the two port sections. */
    function settingsSplit() {
        return container.querySelector('.view-graph-settings__split-host > .split-view');
    }

    /** Direct pane children of the settings split, in render order. */
    function settingsPanes() {
        return [...settingsSplit().children].filter((child) =>
            child.classList.contains('split-view__pane')
        );
    }

    /** The category row, rendered in the general pane and hidden for non-function graphs. */
    function categoryGroup() {
        return container.querySelector('.view-graph-settings__function-category');
    }

    /** The function icon picker row (the `.view-graph-settings__group` hosting the picker). */
    function iconGroup() {
        return container.querySelector('.mdi-icon-picker')?.closest('.view-graph-settings__group') ?? null;
    }

    /** The picker's text input. */
    function iconInput() {
        return container.querySelector('.mdi-icon-picker__input');
    }

    /** The collapsible section view of one port list (`kind` is `input` or `output`). */
    function sectionPane(kind) {
        const index = kind === 'input' ? 1 : 2;
        return settingsPanes()[index].querySelector('.collapsible-view');
    }

    /** Header title of one port section. */
    function sectionTitle(kind) {
        return sectionPane(kind).querySelector('.collapsible-view__title').textContent;
    }

    /** Every rendered port row, inputs first. */
    function rows() {
        return [
            ...container.querySelectorAll('.view-graph-settings__function-ports .collapsible-view'),
        ];
    }

    /** Port-list `SplitView` of one section (`kind` is `input` or `output`). */
    function sectionSplit(kind) {
        const bodies = container.querySelectorAll('.view-graph-settings__function-ports');
        const body = kind === 'input' ? bodies[0] : bodies[1];
        return body.querySelector('.split-view');
    }

    /** Direct pane children of one port-list split, in render order. */
    function sectionPanes(kind) {
        return [...sectionSplit(kind).children].filter((child) =>
            child.classList.contains('split-view__pane')
        );
    }

    /** Header title of one rendered port row. */
    function rowTitle(index) {
        return rows()[index].querySelector('.collapsible-view__title').textContent;
    }

    /** Inline name message of one rendered port row. */
    function rowMessage(index) {
        return rows()[index].querySelector('.view-graph-settings__port-message');
    }

    /** The `any` hint of one rendered port row. */
    function rowAnyHint(index) {
        return rows()[index].querySelector('.view-graph-settings__port-any-hint');
    }

    /** Name field of one rendered port row. */
    function portNameInput(index) {
        return rows()[index].querySelector('.view-graph-settings__port-name input');
    }

    /** Default-type select of one rendered port row, or `null` for output rows. */
    function portDefaultTypeSelect(index) {
        return rows()[index].querySelector('.view-graph-settings__port-default-type select');
    }

    /** Default-value editor input of one rendered port row, or `null` for output rows. */
    function portDefaultValueInput(index) {
        return rows()[index].querySelector('.view-graph-settings__port-default-value input');
    }

    /** Numeric-bounds wrapper of one rendered port row, or `null` for output rows. */
    function portConstraintsHost(index) {
        return rows()[index].querySelector('.view-graph-settings__port-constraints');
    }

    /** The three bound fields (min, max, step) of one rendered port row, in order. */
    function portConstraintInputs(index) {
        return [
            ...rows()[index].querySelectorAll(
                '.view-graph-settings__port-constraints input[type="text"]'
            ),
        ];
    }

    /** Icon button of a row toolbar, addressed by its tooltip label. */
    function rowToolbarButton(index, label) {
        return [
            ...rows()[index].querySelectorAll('.view-graph-settings__port-toolbar button'),
        ].find((button) => button.title === label);
    }

    /** The section's add button (`kind` is `input` or `output`), which lives in the last pane. */
    function sectionAddButton(kind) {
        const panes = sectionPanes(kind);
        return panes[panes.length - 1].querySelector('.view-toolbar button');
    }

    /** Switch the active execution type through the rendered select. */
    function switchExecutionType(executionType) {
        const select = container.querySelectorAll('.view-graph-settings__select')[0];
        select.value = executionType;
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
    }

    /** Open the type multi-select of one row and return its menu. */
    function openTypeMenu(index) {
        const button = rows()[index].querySelector(
            '.view-graph-settings__port-types .dropdown-control__button'
        );
        if (button.getAttribute('aria-expanded') !== 'true') {
            button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        }
        return [...document.querySelectorAll('.dropdown-control__menu')].find(
            (menu) => !menu.hidden
        );
    }

    /** Toggle one type option of a row through its open menu. */
    function clickTypeOption(index, value) {
        const menu = openTypeMenu(index);
        assert.ok(menu, 'expected an open type menu');
        const option = menu.querySelector(`.dropdown-control__option[data-value="${value}"]`);
        assert.ok(option, `expected a type option for ${value}`);
        option.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }

    /** Option values of a type menu, in rendered order. */
    function typeOptionValues(menu) {
        return [...menu.querySelectorAll('.dropdown-control__option')].map((option) =>
            option.getAttribute('data-value')
        );
    }

    /** Option labels of a type menu, in rendered order. */
    function typeOptionLabels(menu) {
        return [...menu.querySelectorAll('.dropdown-control__option')].map((option) =>
            option.textContent.trim()
        );
    }

    /** The graph description row (the `.view-graph-settings__group` hosting the Markdown editor). */
    function descriptionGroup() {
        const editor = container.querySelector('.view-graph-settings__group .markdown-editor');
        return editor ? editor.closest('.view-graph-settings__group') : null;
    }

    /** The Markdown editor element of the graph description field. */
    function descriptionEditor() {
        return container.querySelector('.view-graph-settings__group .markdown-editor');
    }

    /** Commit the graph description through the editor's Edit → textarea → Done flow. */
    function commitDescription(value) {
        const editor = descriptionEditor();
        editor.querySelector('button[aria-label="Edit"]').click();
        const textarea = editor.querySelector('textarea');
        textarea.value = value;
        editor.querySelector('button[aria-label="Done"]').click();
    }

    /** The Markdown editor element of one port row's documentation field. */
    function portDocumentationEditor(index) {
        return rows()[index].querySelector('.view-graph-settings__port-documentation .markdown-editor');
    }

    /** Commit one port row's documentation through the Edit → textarea → Done flow. */
    function commitPortDocumentation(index, value) {
        const editor = portDocumentationEditor(index);
        editor.querySelector('button[aria-label="Edit"]').click();
        const textarea = editor.querySelector('textarea');
        textarea.value = value;
        editor.querySelector('button[aria-label="Done"]').click();
    }

    it('mounts the port sections only while a function graph is active', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        assert.equal(settingsPanes().length, 1, 'a startup graph shows only the general pane');
        assert.equal(categoryGroup().hidden, true, 'the category row is hidden for other types');

        switchExecutionType('function');
        assert.equal(settingsPanes().length, 3, 'a function graph adds the two port sections');
        assert.equal(categoryGroup().hidden, false);
        assert.equal(sectionTitle('input'), 'Inputs');
        assert.equal(sectionTitle('output'), 'Outputs');
        assert.equal(
            categoryGroup().previousElementSibling.querySelector('.custom-control__label')
                .textContent,
            'Execution Type',
            'the category row follows the execution type row'
        );
        assert.equal(
            iconGroup(),
            categoryGroup().nextElementSibling,
            'the icon row follows the category row'
        );
        assert.equal(
            descriptionGroup(),
            iconGroup().nextElementSibling,
            'the description row follows the icon row'
        );
        assert.equal(
            descriptionGroup().nextElementSibling.querySelector('.custom-control__label').textContent,
            'Interrupt',
            'the description row precedes the trigger row'
        );

        switchExecutionType('startup');
        assert.equal(settingsPanes().length, 1, 'switching away removes the port sections');
        assert.equal(categoryGroup().hidden, true, 'the category row hides again');
    });

    it('leaves the form unchanged for a graph without the signature API', () => {
        const plainGraph = new MockGraph({ executionType: 'function' });
        plainGraph.addFunctionPort = undefined;
        collectionManager.setActiveCollection(new MockCollection([plainGraph]));

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        assert.equal(settingsPanes().length, 1, 'no port sections for an unsupported graph');
        assert.equal(categoryGroup().hidden, true, 'the category row stays hidden');
        assert.ok(container.querySelector('.view-graph-settings__select'), 'form still renders');
    });

    it('renders the empty-state line for an empty port list', () => {
        attachFunctionView();

        const empties = container.querySelectorAll('.view-graph-settings__function-empty');
        assert.equal(empties.length, 2);
        assert.equal(empties[0].textContent, 'No inputs declared.');
        assert.equal(empties[1].textContent, 'No outputs declared.');
    });

    it('renders each port list as a vertical split with the add toolbar in the last pane', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'a' }, { name: 'b' }], 'input');
        attachFunctionView();

        const split = sectionSplit('input');
        assert.ok(split, 'the input list renders a split view');
        assert.equal(split.style.flexDirection, 'column');
        assert.equal(
            split.style.getPropertyValue('--split-inset-start'),
            '16px',
            'the panes are indented under the section header'
        );
        assert.equal(
            split.style.getPropertyValue('--split-inset-top'),
            '4px',
            'the first parameter pane is separated from the section header above it'
        );
        assert.ok(
            split.classList.contains('split-view--inset-guide'),
            'the indented parameter panes carry the inset guide line'
        );

        const panes = sectionPanes('input');
        assert.equal(panes.length, 3, 'one pane per parameter plus the add toolbar pane');
        assert.equal(panes[0].querySelector('.collapsible-view__title').textContent, 'a');
        assert.equal(panes[1].querySelector('.collapsible-view__title').textContent, 'b');
        assert.equal(
            panes[0].querySelector('.collapsible-view__header').style.height,
            '24px',
            'parameter headers are more compact than the section headers'
        );
        for (const pane of panes.slice(0, 2)) {
            assert.equal(pane.style.minHeight, '24px', 'panes collapse to their header height');
        }

        const addButton = sectionAddButton('input');
        assert.ok(addButton, 'the add button lives in the trailing pane');
        assert.equal(addButton.title, 'Add input');
        assert.equal(
            panes[panes.length - 1].querySelector('.view-graph-settings__port-toolbar'),
            null,
            'the add action is not rendered as a parameter-row toolbar'
        );
    });

    it('renders the empty state in its own pane above the add toolbar', () => {
        attachFunctionView();

        const panes = sectionPanes('output');
        assert.equal(panes.length, 2, 'the empty-state pane plus the add toolbar pane');
        assert.equal(
            panes[0].querySelector('.view-graph-settings__function-empty').textContent,
            'No outputs declared.'
        );
        assert.equal(sectionAddButton('output').title, 'Add output');
        assert.equal(rows().length, 0);
    });

    it('keeps the add toolbar last after ports are added and removed', () => {
        attachFunctionView();

        sectionAddButton('input').click();
        assert.equal(sectionPanes('input').length, 2);
        assert.equal(rows().length, 1);
        assert.equal(sectionAddButton('input').title, 'Add input');

        rowToolbarButton(0, 'Delete port').click();
        assert.equal(sectionPanes('input').length, 2, 'back to the empty-state pane');
        assert.ok(sectionPanes('input')[0].querySelector('.view-graph-settings__function-empty'));
        assert.equal(sectionAddButton('input').title, 'Add input');
    });

    it('adds ports through the graph API and renders their rows', () => {
        attachFunctionView();

        sectionAddButton('input').click();

        assert.equal(graph._inputs.length, 1);
        assert.equal(graph._inputs[0].id, 'in_0');
        assert.equal(rows().length, 1);
        assert.equal(rowTitle(0), 'Untitled port');
        assert.equal(document.activeElement, portNameInput(0), 'the new row is focused');

        sectionAddButton('output').click();
        assert.equal(graph._outputs.length, 1);
        assert.equal(graph._outputs[0].id, 'out_0');
        assert.equal(rows().length, 2);
    });

    it('writes a renamed port and updates the row title', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'pin', types: ['int'] }], 'input');
        graph._outputs = normalizeFunctionPorts([{ name: 'total', types: ['int'] }], 'output');
        attachFunctionView();

        const input = portNameInput(0);
        assert.equal(input.value, 'pin');
        input.value = 'count';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        assert.equal(graph._inputs[0].name, 'count');
        assert.equal(rowTitle(0), 'count');
    });

    it('reports empty and duplicate names inline without writing them', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'a' }, { name: 'b' }], 'input');
        attachFunctionView();

        const input = portNameInput(1);
        input.value = 'a';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(graph._inputs[1].name, 'b', 'a duplicate name never reaches the model');
        assert.equal(rowMessage(1).textContent, 'Another port already uses this name.');
        assert.ok(rowMessage(1).classList.contains('view-graph-settings__description--error'));

        input.value = '   ';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(graph._inputs[1].name, 'b');
        assert.equal(rowMessage(1).textContent, 'A port name is required.');

        input.value = 'c';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(graph._inputs[1].name, 'c');
        assert.equal(rowMessage(1).textContent, '');
        assert.equal(
            rowMessage(1).classList.contains('view-graph-settings__description--error'),
            false
        );
    });

    it('reorders and removes ports through the row toolbar', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'a' }, { name: 'b' }], 'input');
        attachFunctionView();

        assert.equal(rowToolbarButton(0, 'Move up').disabled, true);
        assert.equal(rowToolbarButton(1, 'Move down').disabled, true);
        assert.equal(rowToolbarButton(0, 'Move down').disabled, false);

        rowToolbarButton(0, 'Move down').click();
        assert.deepEqual(
            graph._inputs.map((port) => port.name),
            ['b', 'a']
        );
        assert.equal(rowTitle(0), 'b');

        rowToolbarButton(1, 'Delete port').click();
        assert.deepEqual(
            graph._inputs.map((port) => port.name),
            ['b']
        );
        assert.equal(rows().length, 1);
        assert.equal(rowToolbarButton(0, 'Move down').disabled, true);
    });

    it('keeps `any` exclusive in the type multi-select', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'a', types: ['int', 'float'] }], 'input');
        attachFunctionView();

        assert.equal(rowAnyHint(0).hidden, true);

        clickTypeOption(0, 'any');
        assert.deepEqual(graph._inputs[0].types, ['any']);
        assert.equal(rowAnyHint(0).hidden, false);

        clickTypeOption(0, 'int');
        assert.deepEqual(graph._inputs[0].types, ['int']);
        assert.equal(rowAnyHint(0).hidden, true);
    });

    it('lists the collection data types with their localized names', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'a' }], 'input');
        attachFunctionView();

        let menu = openTypeMenu(0);
        assert.deepEqual(typeOptionValues(menu), ['any', 'bool', 'float', 'int', 'string']);
        assert.deepEqual(typeOptionLabels(menu), ['Any', 'Boolean', 'Float', 'Integer', 'String']);

        i18nService.setLanguage('de');

        assert.equal(sectionTitle('input'), 'Eingaben');
        menu = openTypeMenu(0);
        assert.deepEqual(typeOptionValues(menu), ['any', 'bool', 'int', 'float', 'string']);
        assert.deepEqual(typeOptionLabels(menu), [
            'Beliebig',
            'Boolean',
            'Ganzzahl',
            'Kommazahl',
            'Zeichenkette',
        ]);
    });

    it('disables the add button at the port limit', () => {
        graph._inputs = normalizeFunctionPorts(
            Array.from({ length: MAX_FUNCTION_PORTS }, (_, index) => ({ name: `p${index}` })),
            'input'
        );
        attachFunctionView();

        const add = sectionAddButton('input');
        assert.equal(add.disabled, true);
        assert.equal(add.title, 'A list holds at most 32 ports.');
        assert.equal(sectionAddButton('output').disabled, false);
    });

    it('rebuilds the sections for a signature change from another surface', () => {
        attachFunctionView();

        graph.addFunctionPort('input', { name: 'ext', types: ['int'] });

        assert.equal(rows().length, 1);
        assert.equal(rowTitle(0), 'ext');
    });

    it('writes the category row into the graph', () => {
        attachFunctionView();

        const category = container.querySelector('.view-graph-settings__function-category input');
        assert.equal(category.value, 'function');

        category.value = 'math';
        category.dispatchEvent(new window.Event('input', { bubbles: true }));

        assert.equal(graph.getFunctionCategory(), 'math');
    });

    it('renders the icon field with the default mdi:function for a function graph', () => {
        attachFunctionView();

        assert.ok(iconGroup(), 'the icon row is mounted');
        assert.equal(iconGroup().hidden, false);
        assert.equal(iconInput().value, 'mdi:function');
    });

    it('hides the icon field for a non-function execution type', () => {
        attachFunctionView();
        switchExecutionType('continuous');

        assert.equal(iconGroup().hidden, true);
    });

    it('writes a typed icon into the graph on commit', () => {
        attachFunctionView();

        const input = iconInput();
        input.value = 'mdi:thermometer';
        input.dispatchEvent(new window.FocusEvent('blur', { bubbles: true, relatedTarget: null }));

        assert.equal(graph.getFunctionIcon(), 'mdi:thermometer');
    });

    it('refreshes the icon field for a signature change from another surface', () => {
        attachFunctionView();

        graph._icon = 'mdi:thermometer';
        graph._emitSignature();

        assert.equal(iconInput().value, 'mdi:thermometer');
    });

    it('renders a default type selector only for multi-type inputs', () => {
        graph._inputs = normalizeFunctionPorts(
            [
                { name: 'multi', types: ['int', 'float'] },
                { name: 'single', types: ['int'] },
            ],
            'input'
        );
        attachFunctionView();

        const multiSelect = portDefaultTypeSelect(0);
        assert.ok(multiSelect, 'multi-type inputs offer a default type selector');
        assert.deepEqual(
            [...multiSelect.options].map((option) => option.value),
            ['float', 'int']
        );
        assert.equal(multiSelect.value, 'int');
        assert.equal(
            rows()[0].querySelector('.view-graph-settings__port-default-type').hidden,
            false
        );
        assert.equal(
            rows()[1].querySelector('.view-graph-settings__port-default-type').hidden,
            true,
            'single-type inputs hide the selector'
        );
    });

    it('renders a bounded number editor for int defaults and a text editor for any', () => {
        graph._inputs = normalizeFunctionPorts(
            [
                {
                    name: 'amount',
                    types: ['int'],
                    default: { type: 'int', value: 4, min: 1, max: 10, step: 1 },
                },
                { name: 'label', types: ['any'] },
            ],
            'input'
        );
        attachFunctionView();

        const amount = portDefaultValueInput(0);
        assert.equal(amount.type, 'number');
        assert.equal(amount.value, '4');
        assert.equal(portConstraintsHost(0).hidden, false);
        assert.deepEqual(
            portConstraintInputs(0).map((input) => input.value),
            ['1', '10', '1']
        );

        assert.equal(portDefaultValueInput(1).type, 'text');
        assert.equal(portDefaultValueInput(1).value, '');
        assert.equal(portConstraintsHost(1).hidden, true);
    });

    it('writes a default value and its bounds through the graph API', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'amount', types: ['int'] }], 'input');
        attachFunctionView();

        const value = portDefaultValueInput(0);
        value.value = '7';
        value.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(graph._inputs[0].default.value, 7);

        const [min, max, step] = portConstraintInputs(0);
        min.value = '0';
        min.dispatchEvent(new window.Event('input', { bubbles: true }));
        max.value = '20';
        max.dispatchEvent(new window.Event('input', { bubbles: true }));
        step.value = '2';
        step.dispatchEvent(new window.Event('input', { bubbles: true }));

        assert.deepEqual(graph._inputs[0].default, {
            type: 'int',
            value: 7,
            min: 0,
            max: 20,
            step: 2,
        });
    });

    it('clamps an out-of-range default into its bounds and snaps the text on blur', () => {
        graph._inputs = normalizeFunctionPorts(
            [
                {
                    name: 'amount',
                    types: ['int'],
                    default: { type: 'int', value: 4, min: 1, max: 10 },
                },
            ],
            'input'
        );
        attachFunctionView();

        const value = portDefaultValueInput(0);
        assert.equal(value.min, '1');
        assert.equal(value.max, '10');

        value.focus();
        value.value = '999';
        value.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(graph._inputs[0].default.value, 10);
        assert.equal(value.value, '999', 'focused text is not rewritten mid-keystroke');

        value.dispatchEvent(new window.Event('blur'));
        assert.equal(value.value, '10', 'blur snaps the text to the clamped stored value');
    });

    it('keeps the previous value when the default field is cleared', () => {
        graph._inputs = normalizeFunctionPorts(
            [
                {
                    name: 'amount',
                    types: ['int'],
                    default: { type: 'int', value: 4, min: 1, max: 10 },
                },
            ],
            'input'
        );
        attachFunctionView();

        const value = portDefaultValueInput(0);
        value.focus();
        value.value = '';
        value.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(graph._inputs[0].default.value, 4);
    });

    it('labels the step field as a UI increment, not a value constraint', () => {
        graph._inputs = normalizeFunctionPorts(
            [
                {
                    name: 'amount',
                    types: ['int'],
                    default: { type: 'int', value: 4, min: 1, max: 10, step: 1 },
                },
            ],
            'input'
        );
        attachFunctionView();

        const labels = [...portConstraintsHost(0).querySelectorAll('.custom-control__label')].map(
            (label) => label.textContent
        );
        assert.deepEqual(labels, ['Min', 'Max', 'Step (UI)']);
    });

    it('reports invalid bounds inline without writing them', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'amount', types: ['int'] }], 'input');
        attachFunctionView();

        const [min, max] = portConstraintInputs(0);
        max.value = '10';
        max.dispatchEvent(new window.Event('input', { bubbles: true }));
        min.value = '20';
        min.dispatchEvent(new window.Event('input', { bubbles: true }));

        const message = rows()[0].querySelector(
            '.view-graph-settings__port-constraints .view-graph-settings__port-message'
        );
        assert.equal(message.textContent, 'Min must not exceed max.');
        assert.equal(graph._inputs[0].default.max, 10);
        assert.equal(graph._inputs[0].default.min, undefined);
    });

    it('output rows never render default fields', () => {
        graph._outputs = normalizeFunctionPorts([{ name: 'result', types: ['int'] }], 'output');
        attachFunctionView();

        assert.equal(rows().length, 1);
        assert.equal(portDefaultTypeSelect(0), null);
        assert.equal(portDefaultValueInput(0), null);
        assert.equal(portConstraintsHost(0), null);
    });

    it('swaps the value editor when the default type changes', () => {
        graph._inputs = normalizeFunctionPorts(
            [{ name: 'value', types: ['int', 'string'] }],
            'input'
        );
        attachFunctionView();

        assert.equal(portDefaultValueInput(0).type, 'number');

        const select = portDefaultTypeSelect(0);
        select.value = 'string';
        select.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(graph._inputs[0].default.type, 'string');
        assert.equal(graph._inputs[0].default.value, '0');
        assert.equal(portDefaultValueInput(0).type, 'text');
        assert.equal(portConstraintsHost(0).hidden, true);
    });

    it('renders the description field for a function graph and hides it otherwise', () => {
        attachFunctionView();

        assert.ok(descriptionGroup(), 'the description row is mounted');
        assert.equal(descriptionGroup().hidden, false);
        assert.equal(
            descriptionEditor().querySelector('.markdown-editor__label').textContent,
            'Description'
        );

        switchExecutionType('continuous');
        assert.equal(descriptionGroup().hidden, true);
    });

    it('commits an edited description through the graph API', () => {
        attachFunctionView();

        commitDescription('does *math*');

        assert.equal(graph.getFunctionDescription(), 'does *math*');
    });

    it('refreshes the description for a signature change from another surface', () => {
        attachFunctionView();

        graph._description = 'from outside';
        graph._emitSignature();

        const preview = descriptionEditor().querySelector('.markdown-editor__preview');
        assert.equal(preview.hidden, false);
        assert.match(preview.textContent, /from outside/);
    });

    it('renders a documentation field on every input and output row', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'a' }], 'input');
        graph._outputs = normalizeFunctionPorts([{ name: 'b' }], 'output');
        attachFunctionView();

        assert.equal(rows().length, 2);
        assert.ok(portDocumentationEditor(0), 'input row has a documentation editor');
        assert.ok(portDocumentationEditor(1), 'output row has a documentation editor');
    });

    it('commits a port documentation through the graph API', () => {
        graph._inputs = normalizeFunctionPorts([{ name: 'a', types: ['int'] }], 'input');
        attachFunctionView();

        commitPortDocumentation(0, 'reads **pin**');

        assert.equal(graph._inputs[0].documentation, 'reads **pin**');
    });
});
