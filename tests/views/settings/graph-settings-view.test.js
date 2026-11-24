import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AppEvent, AppPayload } from '../../../src/micro_otter/nodes/html/js/core/app-event.js';
import { GraphSettingsView } from '../../../src/micro_otter/nodes/html/js/views/graph-settings-view.js';

class MockGraphPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

class MockCollectionPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

class MockCollectionManagerPayload extends AppPayload {
    constructor(payloadTypeId, detail = {}) {
        super(payloadTypeId);
        Object.assign(this, detail);
    }
}

class MockGraph {
    constructor({
        id = 'graph-1',
        name = 'Graph One',
        executionType = 'startup',
        intervalMs = 500,
        enabled = true,
        triggerName = '',
        signalNames = [],
        signalMode = 'any',
        runOnStart = true,
    } = {}) {
        this._id = id;
        this._name = name;
        this._executionType = executionType;
        this._intervalMs = intervalMs;
        this._enabled = enabled;
        this._triggerName = triggerName;
        this._signalNames = signalNames;
        this._signalMode = signalMode;
        this._runOnStart = runOnStart;
        this._listeners = new Set();
        this.enabledWrites = [];
        this.triggerNameWrites = [];
        this.signalNameWrites = [];
        this._nodes = [];
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockGraph only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockGraphPayload(payloadTypeId, {
            graphId: this._id,
            ...detail,
        }));
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

    getExecutionType() {
        return this._executionType;
    }

    setExecutionType(executionType) {
        this._executionType = executionType;
        this._emit('executionType', 'NodeGraph.ExecutionTypeChanged.v1', { executionType });
    }

    getTriggerName() {
        return this._triggerName;
    }

    setTriggerName(triggerName) {
        this._triggerName = triggerName;
        this.triggerNameWrites.push(triggerName);
        this._emit('triggerName', 'NodeGraph.TriggerNameChanged.v1', { triggerName });
    }

    getSignalNames() {
        return this._signalNames;
    }

    setSignalNames(signalNames) {
        this._signalNames = signalNames;
        this.signalNameWrites.push(signalNames);
        this._emit('signalTrigger', 'NodeGraph.SignalTriggerChanged.v1', {
            signalNames,
            signalMode: this._signalMode,
            runOnStart: this._runOnStart,
        });
    }

    getSignalMode() {
        return this._signalMode;
    }

    setSignalMode(signalMode) {
        this._signalMode = signalMode;
        this._emit('signalTrigger', 'NodeGraph.SignalTriggerChanged.v1', {
            signalNames: this._signalNames,
            signalMode,
            runOnStart: this._runOnStart,
        });
    }

    getRunOnStart() {
        return this._runOnStart;
    }

    setRunOnStart(runOnStart) {
        this._runOnStart = runOnStart;
        this._emit('signalTrigger', 'NodeGraph.SignalTriggerChanged.v1', {
            signalNames: this._signalNames,
            signalMode: this._signalMode,
            runOnStart,
        });
    }

    getEnabled() {
        return this._enabled;
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        this.enabledWrites.push(enabled);
        this._emit('enabled', 'NodeGraph.EnabledChanged.v1', { enabled });
    }

    getTriggerInterval() {
        return this._intervalMs;
    }

    getNodes() {
        return this._nodes;
    }

    setTriggerInterval(intervalMs) {
        this._intervalMs = intervalMs;
        this._emit('interval', 'NodeGraph.IntervalChanged.v1', { triggerIntervalMs: intervalMs });
    }
}

class MockCollection {
    constructor(graphs = []) {
        this._graphs = graphs;
        this._activeGraphIdx = 0;
        this._listeners = new Set();
        this._title = 'Mock Collection';
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollection only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockCollectionPayload(payloadTypeId, {
            collectionId: 'col-1',
            ...detail,
        }));
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    getActiveGraph() {
        if (this._activeGraphIdx < 0 || this._activeGraphIdx >= this._graphs.length) {
            throw new Error('No active graph');
        }
        return this._graphs[this._activeGraphIdx];
    }

    getTitle() {
        return this._title;
    }

    getGraphArray() {
        return this._graphs;
    }

    setActiveGraphIdx(index) {
        this._activeGraphIdx = index;
        this._emit('activeGraphIdx', 'Collection.ActiveGraphIndexChanged.v1', {
            activeGraphIdx: index,
        });
    }
}

class MockCollectionManager {
    constructor() {
        this._activeCollection = null;
        this._listeners = new Set();
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    on(eventName, listener) {
        if (eventName !== '*') {
            throw new Error('MockCollectionManager only supports wildcard listeners in tests');
        }
        return this.onChange(listener);
    }

    _emit(name, payloadTypeId, detail = {}) {
        const event = new AppEvent(name, new MockCollectionManagerPayload(payloadTypeId, detail));
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    getActiveCollection() {
        return this._activeCollection;
    }

    setActiveCollection(collection) {
        this._activeCollection = collection;
        this._emit('activeCollectionChanged', 'CollectionManager.ActiveCollectionChanged.v1', {
            collectionId: collection ? 'col-1' : null,
        });
    }
}

class MockI18nService {
    constructor() {
        this._listeners = new Map();
        this._translations = {
            'settings.graph.title': 'Graph Settings',
            'settings.graph.name.label': 'Graph Name',
            'settings.graph.enabled.label': 'Enabled',
            'settings.graph.executionType.label': 'Execution Type',
            'settings.graph.executionType.startup': 'Run once on startup',
            'settings.graph.executionType.continuous': 'Run continuously in loop',
            'settings.graph.executionType.irq': 'Run once per interrupt',
            'settings.graph.sleepDuration.label': 'Interval (ms)',
            'settings.graph.sleepDuration.description':
                'Time between the start of consecutive loop iterations. 0 yields without waiting.',
            'settings.graph.triggerName.label': 'Interrupt',
            'settings.graph.triggerName.description': 'Interrupt input whose edges run this graph.',
            'settings.graph.executionType.event': 'Run on signal',
            'settings.graph.executionType.function': 'Provide as callable function',
            'settings.graph.signals.label': 'Signals',
            'settings.graph.signals.listLabel': 'Watched signals',
            'settings.graph.signals.description':
                'Pick the signals that run this graph. Any = one picked signal runs it; All = every picked signal must have fired since the last run.',
            'settings.graph.signals.mode.label': 'Trigger mode',
            'settings.graph.signals.mode.any': 'Any',
            'settings.graph.signals.mode.all': 'All',
            'settings.graph.signals.runOnStart.label': 'Run once at startup',
            'settings.graph.signals.runOnStart.description': 'Also run once at startup.',
            'settings.graph.signals.emptyError': 'Pick at least one signal.',
            'settings.graph.signals.unknownProducer': 'No producer for {{name}}.',
        };
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

    t(key, params) {
        const raw = this._translations[key] || key;
        if (!params || typeof params !== 'object') {
            return raw;
        }
        return raw.replace(/\{\{(\w+)\}\}/g, (match, name) => String(params[name] ?? match));
    }
}

describe('GraphSettingsView', () => {
    let dom;
    let container;
    let collectionManager;
    let i18nService;
    let graphOne;
    let graphTwo;
    let collection;

    beforeEach(() => {
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
        // Run immediately: the dropdown positions its menu through `requestAnimationFrame`, and a
        // queued timer would fire after `afterEach` clears `window`.
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

        container = document.createElement('div');
        document.body.appendChild(container);

        collectionManager = new MockCollectionManager();
        i18nService = new MockI18nService();
        graphOne = new MockGraph({ id: 'graph-1', name: 'Boot Graph', executionType: 'startup', intervalMs: 200 });
        graphTwo = new MockGraph({ id: 'graph-2', name: 'Loop Graph', executionType: 'continuous', intervalMs: 750 });
        collection = new MockCollection([graphOne, graphTwo]);
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

    it('requires a collectionManager instance', () => {
        assert.throws(() => new GraphSettingsView(), /collectionManager instance/);
    });

    it('renders graph controls with current values', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const title = container.querySelector('.view-graph-settings__title');
        const nameInput = container.querySelector('.view-graph-settings__input[type="text"]');
        const executionSelect = container.querySelector('.view-graph-settings__select');
        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');

        assert.equal(title.textContent, 'Graph Settings');
        assert.equal(nameInput.value, 'Boot Graph');
        assert.equal(executionSelect.value, 'startup');
        assert.equal(sleepInput.value, '200');
        assert.equal(sleepInput.min, '0');
        assert.equal(sleepInput.max, '60000');
        assert.equal(sleepInput.step, '1');

        const descriptions = container.querySelectorAll('.view-graph-settings__description');
        const description = descriptions[2];
        assert.ok(description, 'Expected the interval description');
        assert.equal(
            description.textContent,
            'Time between the start of consecutive loop iterations. 0 yields without waiting.'
        );
    });

    it('updates the interval when changed', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelector('.view-graph-settings__select');
        executionSelect.value = 'continuous';
        executionSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        let writes = 0;
        const originalSetTriggerInterval = graphOne.setTriggerInterval.bind(graphOne);
        graphOne.setTriggerInterval = (intervalMs) => {
            writes += 1;
            return originalSetTriggerInterval(intervalMs);
        };

        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');
        sleepInput.value = '1500';
        sleepInput.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(graphOne.getTriggerInterval(), 1500);
        assert.equal(writes, 1);
    });

    it('accepts 0 as the interval', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelector('.view-graph-settings__select');
        executionSelect.value = 'continuous';
        executionSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');
        sleepInput.value = '0';
        sleepInput.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(graphOne.getTriggerInterval(), 0);
        assert.equal(sleepInput.value, '0');
    });

    it('floors and clamps committed interval input', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelector('.view-graph-settings__select');
        executionSelect.value = 'continuous';
        executionSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');

        sleepInput.value = '150.9';
        sleepInput.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(graphOne.getTriggerInterval(), 150);
        assert.equal(sleepInput.value, '150');

        sleepInput.value = '120000';
        sleepInput.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(graphOne.getTriggerInterval(), 60000);
        assert.equal(sleepInput.value, '60000');

        sleepInput.value = '-4';
        sleepInput.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(graphOne.getTriggerInterval(), 0);
        assert.equal(sleepInput.value, '0');
    });

    it('restores the graph value for a blank interval without writing', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelector('.view-graph-settings__select');
        executionSelect.value = 'continuous';
        executionSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        let writes = 0;
        const originalSetTriggerInterval = graphOne.setTriggerInterval.bind(graphOne);
        graphOne.setTriggerInterval = (intervalMs) => {
            writes += 1;
            return originalSetTriggerInterval(intervalMs);
        };

        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');
        sleepInput.value = '';
        sleepInput.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(writes, 0);
        assert.equal(sleepInput.value, '200');
        assert.equal(graphOne.getTriggerInterval(), 200);
    });

    it('shows a 0 ms interval pushed by the graph', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelector('.view-graph-settings__select');
        executionSelect.value = 'continuous';
        executionSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        graphOne.setTriggerInterval(0);

        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');
        assert.equal(graphOne.getTriggerInterval(), 0);
        assert.equal(sleepInput.value, '0');
    });

    it('updates graph name when name changes', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const nameInput = container.querySelector('.view-graph-settings__input[type="text"]');
        nameInput.value = 'Renamed Graph';
        nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(graphOne.getName(), 'Renamed Graph');
    });

    it('updates execution type and toggles sleep visibility', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelector('.view-graph-settings__select');
        const sleepGroup = container.querySelector('.view-graph-settings__group:last-child');

        assert.equal(sleepGroup.style.display, 'none');

        executionSelect.value = 'continuous';
        executionSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(graphOne.getExecutionType(), 'continuous');
        assert.equal(sleepGroup.style.display, '');
    });

    it('updates sleep duration when changed', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelector('.view-graph-settings__select');
        executionSelect.value = 'continuous';
        executionSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');
        sleepInput.value = '1500';
        sleepInput.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.equal(graphOne.getTriggerInterval(), 1500);
    });

    it('switches graph when active graph index changes', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        collection.setActiveGraphIdx(1);

        const nameInput = container.querySelector('.view-graph-settings__input[type="text"]');
        const executionSelect = container.querySelector('.view-graph-settings__select');
        const sleepInput = container.querySelector('.view-graph-settings__input[type="number"]');

        assert.equal(nameInput.value, 'Loop Graph');
        assert.equal(executionSelect.value, 'continuous');
        assert.equal(sleepInput.value, '750');
    });

    it('renders the enabled checkbox first and reflects the graph flag', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const groups = container.querySelectorAll('.view-graph-settings__group');
        const checkbox = groups[0].querySelector('input[type="checkbox"]');

        assert.ok(checkbox, 'Expected the enabled checkbox to lead the form');
        assert.equal(checkbox.checked, true);
        assert.equal(
            groups[0].querySelector('.custom-control__checkbox-label').textContent,
            'Enabled'
        );

        graphTwo.setEnabled(false);
        collection.setActiveGraphIdx(1);

        assert.equal(container.querySelector('input[type="checkbox"]').checked, false);
    });

    it('writes a cleared enabled checkbox into the graph once', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const checkbox = container.querySelector('input[type="checkbox"]');
        checkbox.checked = false;
        checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.deepEqual(graphOne.enabledWrites, [false]);

        // Re-dispatching an unchanged value must not write again.
        checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.deepEqual(graphOne.enabledWrites, [false]);
    });

    it('follows enabled events emitted by the graph', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const checkbox = container.querySelector('input[type="checkbox"]');
        assert.equal(checkbox.checked, true);

        graphOne._enabled = false;
        graphOne._emit('enabled', 'NodeGraph.EnabledChanged.v1', { enabled: false });

        assert.equal(container.querySelector('input[type="checkbox"]').checked, false);
    });

    it('disables the enabled checkbox without a graph or enabled accessor', () => {
        const bareGraph = new MockGraph();
        bareGraph.getEnabled = undefined;
        bareGraph.setEnabled = undefined;

        const view = new GraphSettingsView({
            collectionManager,
            i18nService,
            graph: bareGraph,
        });
        view.attachTo(container);

        assert.equal(container.querySelector('input[type="checkbox"]').disabled, true);

        view.setGraph(null);
        assert.equal(container.querySelector('input[type="checkbox"]').disabled, true);
    });

    it('re-applies the enabled label after a language switch', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        i18nService._translations['settings.graph.enabled.label'] = 'Aktiviert';
        for (const listener of i18nService._listeners.get('languagechange') ?? []) {
            listener(new window.Event('languagechange'));
        }

        assert.equal(
            container.querySelector('.custom-control__checkbox-label').textContent,
            'Aktiviert'
        );
    });

    it('serializes and deserializes with collectionManager context', () => {
        const view = new GraphSettingsView({
            collectionManager,
            i18nService,
            id: 'graph-settings-test',
        });

        const data = view.serialize();
        assert.equal(data.type, 'GraphSettingsView');

        const restored = GraphSettingsView.deserialize(data, null, {
            collectionManager,
            i18nService,
        });

        assert.ok(restored instanceof GraphSettingsView);
        assert.equal(restored.id, 'graph-settings-test');
    });

    it('lists all execution options in order', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const executionSelect = container.querySelectorAll('.view-graph-settings__select')[0];
        assert.deepEqual(
            [...executionSelect.options].map((option) => option.value),
            ['startup', 'continuous', 'irq', 'event', 'function']
        );
    });

    it('shows the trigger group and hides sleep for an irq graph', () => {
        graphOne.setExecutionType('irq');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const groups = container.querySelectorAll('.view-graph-settings__group');
        assert.equal(groups[5].style.display, '');
        assert.equal(groups[6].style.display, 'none');
    });

    it('lists the collection interrupt names in the trigger select', () => {
        graphOne._nodes = [
            { type: 'interrupt-input', id: 'n1', controlValues: { triggerName: 'button' } },
        ];
        graphTwo._nodes = [
            { type: 'interrupt-input', id: 'n2', controlValues: { triggerName: 'motion' } },
        ];
        graphOne.setExecutionType('irq');
        graphOne.setTriggerName('button');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const triggerSelect = container.querySelectorAll('.view-graph-settings__select')[1];
        assert.deepEqual(
            [...triggerSelect.options].map((option) => option.value),
            ['button', 'motion']
        );
        assert.equal(triggerSelect.value, 'button');
    });

    it('keeps a stale trigger name as an extra option', () => {
        graphOne.setExecutionType('irq');
        graphOne.setTriggerName('ghost');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const triggerSelect = container.querySelectorAll('.view-graph-settings__select')[1];
        assert.deepEqual([...triggerSelect.options].map((option) => option.value), ['ghost']);
    });

    it('disables the trigger select when no names exist', () => {
        graphOne.setExecutionType('irq');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const triggerSelect = container.querySelectorAll('.view-graph-settings__select')[1];
        assert.equal(triggerSelect.disabled, true);
    });

    it('writes the trigger name through setTriggerName', () => {
        graphOne._nodes = [
            { type: 'interrupt-input', id: 'n1', controlValues: { triggerName: 'button' } },
        ];
        graphOne.setExecutionType('irq');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const triggerSelect = container.querySelectorAll('.view-graph-settings__select')[1];
        triggerSelect.value = 'button';
        triggerSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

        assert.deepEqual(graphOne.triggerNameWrites, ['button']);
    });

    it('re-renders the trigger select on a triggerName event', () => {
        graphOne._nodes = [
            { type: 'interrupt-input', id: 'n1', controlValues: { triggerName: 'button' } },
            { type: 'interrupt-input', id: 'n2', controlValues: { triggerName: 'motion' } },
        ];
        graphOne.setExecutionType('irq');
        graphOne.setTriggerName('button');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        graphOne._triggerName = 'motion';
        graphOne._emit('triggerName', 'NodeGraph.TriggerNameChanged.v1', { triggerName: 'motion' });

        const triggerSelect = container.querySelectorAll('.view-graph-settings__select')[1];
        assert.equal(triggerSelect.value, 'motion');
    });

    function signalDropdownButton(container) {
        return container.querySelector(
            '.view-graph-settings__signal-control .dropdown-control__button'
        );
    }

    function signalMenu() {
        return document.querySelector('.view-graph-settings__signal-menu');
    }

    function openSignalMenu(container) {
        const button = signalDropdownButton(container);
        if (button.getAttribute('aria-expanded') !== 'true') {
            button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        }
        return signalMenu();
    }

    function signalOptionValues() {
        return [...signalMenu().querySelectorAll('.dropdown-control__option')].map((option) =>
            option.getAttribute('data-value')
        );
    }

    function selectedSignalValues() {
        return [
            ...signalMenu().querySelectorAll('.dropdown-control__option[aria-selected="true"]'),
        ].map((option) => option.getAttribute('data-value'));
    }

    function clickSignalOption(container, value) {
        openSignalMenu(container);
        const option = signalMenu().querySelector(
            `.dropdown-control__option[data-value="${value}"]`
        );
        assert.ok(option, `missing signal option '${value}'`);
        option.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }

    it('shows the signal groups and hides sleep for an event graph', () => {
        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } }];
        graphOne.setExecutionType('event');
        graphOne.setSignalNames(['radar']);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const groups = container.querySelectorAll('.view-graph-settings__group');
        const sleepGroup = groups[groups.length - 1];
        assert.equal(sleepGroup.style.display, 'none');
        assert.equal(groups[6].style.display, '');
        assert.equal(groups[7].style.display, '');
        assert.equal(groups[8].style.display, '');
    });

    it('renders the signals title through the picker labelled variant', () => {
        graphOne.setExecutionType('event');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const signalsGroup = container.querySelectorAll('.view-graph-settings__group')[6];
        const labeled = signalsGroup.querySelectorAll(
            '.view-graph-settings__signal-control .dropdown-control--labeled'
        );
        const label = signalsGroup.querySelector(
            '.view-graph-settings__signal-control .dropdown-control__label'
        );
        const button = signalDropdownButton(container);

        assert.equal(labeled.length, 1);
        assert.ok(label, 'expected the picker title span');
        assert.equal(label.textContent, 'Signals');
        assert.strictEqual(button.previousElementSibling, label);
        assert.equal(button.getAttribute('aria-labelledby'), label.id);
        assert.equal(signalsGroup.querySelector('.view-graph-settings__label'), null);
        assert.equal(
            signalsGroup.querySelector('.view-graph-settings__signal-control .view-graph-settings__label'),
            null
        );
    });

    it('re-translates the signals title after a language switch', () => {
        graphOne.setExecutionType('event');

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const label = container.querySelector(
            '.view-graph-settings__signal-control .dropdown-control__label'
        );

        i18nService._translations['settings.graph.signals.label'] = 'Signale';
        for (const listener of i18nService._listeners.get('languagechange') ?? []) {
            listener(new window.Event('languagechange'));
        }

        const labelAfter = container.querySelector(
            '.view-graph-settings__signal-control .dropdown-control__label'
        );
        const button = signalDropdownButton(container);
        assert.strictEqual(labelAfter, label);
        assert.equal(labelAfter.textContent, 'Signale');
        assert.equal(button.getAttribute('aria-labelledby'), labelAfter.id);
    });

    it('keeps the signals group hidden for non-event graphs', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const signalsGroup = container.querySelectorAll('.view-graph-settings__group')[6];

        for (const executionType of ['startup', 'continuous', 'irq']) {
            graphOne.setExecutionType(executionType);

            assert.equal(signalsGroup.style.display, 'none', executionType);
            assert.equal(
                signalsGroup.querySelectorAll('.dropdown-control__label').length,
                1,
                executionType
            );
        }
    });

    it('keeps the function icon field hidden for non-function graphs', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const iconPicker = container.querySelector('.mdi-icon-picker');
        assert.ok(iconPicker, 'the picker row is mounted');
        assert.equal(iconPicker.closest('.view-graph-settings__group').hidden, true);
    });

    it('disables the new controls without a graph', () => {
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);
        view.setGraph(null);

        assert.equal(signalDropdownButton(container).disabled, true);
        assert.equal(container.querySelectorAll('.view-graph-settings__select')[2].disabled, true);
        assert.equal(container.querySelector('input[id$="graph-signal-new"]'), null);
        assert.equal(container.querySelector('.view-graph-settings__signal-add'), null);
        assert.equal(
            container.querySelector('input[id$="graph-signal-run-on-start"]').disabled,
            true
        );
    });

    it('toggles a declared signal into the watched list', () => {
        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } }];
        graphOne.setExecutionType('event');
        graphOne.setSignalNames([]);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);
        graphOne.signalNameWrites = [];

        clickSignalOption(container, 'radar');
        assert.deepEqual(graphOne.signalNameWrites, [['radar']]);

        clickSignalOption(container, 'radar');
        assert.deepEqual(graphOne.signalNameWrites.at(-1), []);
    });

    it('keeps the menu open across a selection', () => {
        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } }];
        graphOne.setExecutionType('event');
        graphOne.setSignalNames([]);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        clickSignalOption(container, 'radar');

        assert.equal(signalDropdownButton(container).getAttribute('aria-expanded'), 'true');
        assert.equal(signalMenu().querySelectorAll('.dropdown-control__option').length, 1);
    });

    it('writes the mode dropdown and the run-on-start checkbox', () => {
        graphOne.setExecutionType('event');
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const modeSelect = container.querySelectorAll('.view-graph-settings__select')[2];
        modeSelect.value = 'all';
        modeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(graphOne.getSignalMode(), 'all');

        const runOnStart = container.querySelector('input[id$="graph-signal-run-on-start"]');
        runOnStart.checked = false;
        runOnStart.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(graphOne.getRunOnStart(), false);
    });

    it('renders a stored name absent from the collection as ticked', () => {
        graphOne.setExecutionType('event');
        graphOne.setSignalNames(['ghost']);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        openSignalMenu(container);
        assert.deepEqual(signalOptionValues(), ['ghost']);
        assert.deepEqual(selectedSignalValues(), ['ghost']);
    });

    it('shows the error text for an empty selection and the warning for an unproduced name', () => {
        graphOne.setExecutionType('event');
        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        const message = container.querySelectorAll('.view-graph-settings__description')[1];
        assert.equal(message.textContent, 'Pick at least one signal.');
        assert.ok(message.classList.contains('view-graph-settings__description--error'));

        graphOne.setSignalNames(['ghost']);
        assert.equal(message.textContent, 'No producer for ghost.');
        assert.ok(message.classList.contains('view-graph-settings__description--warning'));
    });

    it('refreshes the ticks on a signalTrigger event', () => {
        graphOne._nodes = [
            { type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } },
            { type: 'signal-post', id: 'n2', controlValues: { signal: 'motion' } },
        ];
        graphOne.setExecutionType('event');
        graphOne.setSignalNames(['radar']);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);

        graphOne._signalNames = ['motion'];
        graphOne._emit('signalTrigger', 'NodeGraph.SignalTriggerChanged.v1', {
            signalNames: ['motion'],
            signalMode: 'any',
            runOnStart: true,
        });

        openSignalMenu(container);
        assert.deepEqual(signalOptionValues(), ['motion', 'radar']);
        assert.deepEqual(selectedSignalValues(), ['motion']);
    });

    it('adds the option of a signal-post node added to the graph', () => {
        graphOne.setExecutionType('event');
        graphOne.setSignalNames([]);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);
        openSignalMenu(container);
        assert.deepEqual(signalOptionValues(), []);

        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } }];
        graphOne._emit('node-added', 'NodeGraph.NodeAdded.v1', { nodeId: 'n1' });

        assert.deepEqual(signalOptionValues(), ['radar']);
    });

    it('renames an option when a signal-post control value changes', () => {
        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } }];
        graphOne.setExecutionType('event');
        graphOne.setSignalNames([]);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);
        openSignalMenu(container);
        assert.deepEqual(signalOptionValues(), ['radar']);

        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'sonar' } }];
        graphOne._emit('node-updated', 'NodeGraph.NodeUpdated.v1', {
            nodeId: 'n1',
            patch: { controlValues: { signal: 'sonar' } },
            previous: { controlValues: { signal: 'radar' } },
        });

        assert.deepEqual(signalOptionValues(), ['sonar']);
    });

    it('removes the option of a removed signal-post node', () => {
        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } }];
        graphOne.setExecutionType('event');
        graphOne.setSignalNames([]);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);
        openSignalMenu(container);
        assert.deepEqual(signalOptionValues(), ['radar']);

        graphOne._nodes = [];
        graphOne._emit('node-removed', 'NodeGraph.NodeRemoved.v1', {
            nodeId: 'n1',
            removedConnections: 0,
        });

        assert.deepEqual(signalOptionValues(), []);
    });

    it('leaves the menu untouched on an unrelated node update', () => {
        graphOne._nodes = [{ type: 'signal-post', id: 'n1', controlValues: { signal: 'radar' } }];
        graphOne.setExecutionType('event');
        graphOne.setSignalNames([]);

        const view = new GraphSettingsView({ collectionManager, i18nService });
        view.attachTo(container);
        openSignalMenu(container);
        const menu = signalMenu();

        graphOne._emit('node-updated', 'NodeGraph.NodeUpdated.v1', {
            nodeId: 'n1',
            patch: { controlValues: { level: 3 } },
            previous: { controlValues: { level: 1 } },
        });

        assert.equal(signalMenu(), menu);
        assert.equal(signalDropdownButton(container).getAttribute('aria-expanded'), 'true');
        assert.deepEqual(signalOptionValues(), ['radar']);
    });
});